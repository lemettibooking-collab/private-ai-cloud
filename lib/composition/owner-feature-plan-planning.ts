import { createHash } from "node:crypto";
import type { ModelInvocationMessage } from "../contracts/model-invocation";
import type { ModelInvocationDataHandlingEvidenceResolver } from "../contracts/model-invocation-execution";
import type { FeaturePlanPlanningPolicy } from "../development/feature-plan-planning-run";
import type { BegunPlanningRequest, FeaturePlanPlanningRequests, PlanningRequestSettlement } from "../development/feature-plan-planning-requests";
import type { PlanningModelFailure, PlanningModelPort, PlanningRequestContext } from "../development/feature-plan-planner";
import type { AgentStepCapabilityRequirementsResolver, AgentStepRuntimeContext } from "../workflows/agent-step-runtime";
import type { WorkflowRuntimeCommandAuthorizer, WorkflowRuntimeResponse, WorkflowRuntimeService } from "../workflows/workflow-runtime-service";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createFeaturePlanPlanningRunState, featurePlanPlanningWorkflow, planningAdvanceCommand, planningRequirementsResolver, planningRunIds } from "../development/feature-plan-planning-run.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { oneShotOwnerEgressApproval } from "./owner-egress-approval.ts";

// AI-039.1 run-backed PlanningModelPort (server-side composition; provider-neutral).
//
//   draftFeaturePlanCandidate → complete({ context, messages, maxOutputTokens })
//     → planning request begin (Owner + task + project locks, idempotency key + request fingerprint,
//       audit) — replay never dispatches again
//     → ONE real planning Workflow Run through the EXISTING runtime (composeRuntime = the trusted
//       provider + PostgreSQL composition, injected by the server binding):
//         stateStore.create → service.start → service.advance (one invocation draft)
//         = route → data handling (one-shot Owner egress approval) → invocation ledger → preflight
//           → budget reservation → provider-start fence → provider call (SDK retries 0)
//           → usage / cost settlement + DURABLE step result (same transaction) → snapshot commit
//     → the durable step result read back from PostgreSQL (re-fingerprinted)
//     → planning request settled once (audit) → output text to the strict candidate parser
//
// This module never imports a provider SDK and never calls a provider directly: the only way to the
// model is the runtime's advance. Every ambiguity after `start` (an exception, outcome_unknown, a
// run that did not reach completion after a successful invocation, a failed settlement) is
// `recovery_required`: the budget stays held by the runtime and nothing is retried.

export type PlanningRuntimeParts = Readonly<{
  authorizer: WorkflowRuntimeCommandAuthorizer;
  requirementsResolver: AgentStepCapabilityRequirementsResolver;
  evidenceResolver: ModelInvocationDataHandlingEvidenceResolver;
  runtimeContext: AgentStepRuntimeContext;
}>;

export type PlanningRuntime = Readonly<{
  service: Pick<WorkflowRuntimeService, "start" | "advance">;
  stateStore: Readonly<{
    create(input: Readonly<{ state: never }>): Promise<void>;
    load(input: Readonly<{ runId: string }>): Promise<unknown>;
    readModelInvocationResult(input: Readonly<{ runId: string; invocationId: string }>): Promise<Readonly<{
      status: "running" | "succeeded" | "failed" | "outcome_unknown"; errorCode: string | null; outputText: string | null;
    }> | null>;
  }>;
  close(): Promise<void>;
}>;

export type RunBackedPlanningDependencies = Readonly<{
  policy: FeaturePlanPlanningPolicy;
  // Trusted server configuration (the domain workspace of the Owner Console). Never request data.
  domainWorkspaceId: string;
  // A request-scoped planning request boundary (authenticated Owner identity, per-call pool).
  withRequests<T>(work: (requests: FeaturePlanPlanningRequests) => Promise<T>): Promise<T>;
  // The trusted provider + PostgreSQL runtime for ONE planning request (null = not composable).
  composeRuntime(parts: PlanningRuntimeParts): Promise<PlanningRuntime | null>;
  now(): string;
}>;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const failure = (status: PlanningModelFailure) => freeze({ status });
const settlement = (outcome: PlanningRequestSettlement["outcome"], outputFingerprint: string | null = null): PlanningRequestSettlement =>
  freeze({ outcome, outputFingerprint });
const fingerprintText = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

// sha256 over the canonical planning request: workflow version, budget policy, pinned provider identity,
// task, project, output ceiling and the exact messages (the Owner's answers are inside the messages).
export function planningRequestFingerprint(policy: FeaturePlanPlanningPolicy, context: PlanningRequestContext, messages: readonly ModelInvocationMessage[]): string {
  const identity = policy.identity;
  return fingerprintText(JSON.stringify([
    featurePlanPlanningWorkflow.version, featurePlanPlanningWorkflow.budgetPolicy,
    identity.providerId, identity.providerKind, identity.deploymentId, identity.providerModelId, identity.providerRequestModelId, identity.providerModelVersion,
    context.taskId, context.projectId, policy.maxOutputTokens,
    messages.map((message) => [message.role, message.content]),
  ]));
}

function ownRecord(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : null;
}

// Whether the factual (durable) planning Step failed with a retryable, i.e. transient, provider error.
async function failedTransiently(runtime: PlanningRuntime, runId: string, stepId: string): Promise<boolean> {
  try {
    const state = ownRecord(await runtime.stateStore.load({ runId }));
    const snapshot = ownRecord(state?.snapshot);
    const steps = Array.isArray(snapshot?.stepStates) ? snapshot.stepStates as unknown[] : [];
    const step = steps.map(ownRecord).find((candidate) => candidate?.stepId === stepId);
    return ownRecord(step?.lastError)?.retryable === true;
  } catch {
    return false;
  }
}

export function createRunBackedPlanningModel(dependencies: RunBackedPlanningDependencies): PlanningModelPort {
  const { policy, domainWorkspaceId, withRequests, composeRuntime, now } = dependencies;

  async function compose(parts: PlanningRuntimeParts): Promise<PlanningRuntime | null> {
    try {
      return await composeRuntime(parts);
    } catch {
      return null;
    }
  }

  // Replay of a settled `completed` request: re-read the durable result (no provider involvement).
  async function durableOutput(planningKey: string, expectedFingerprint: string | null): Promise<Readonly<{ status: "completed"; outputText: string }> | null> {
    const ids = planningRunIds(planningKey);
    const runtime = await compose({
      authorizer: { authorize: () => false },
      requirementsResolver: planningRequirementsResolver(policy),
      evidenceResolver: { resolve: async () => null },
      runtimeContext: { now },
    });
    if (!runtime) return null;
    try {
      const facts = await runtime.stateStore.readModelInvocationResult({ runId: ids.runId, invocationId: ids.invocationId });
      if (!facts || facts.status !== "succeeded" || facts.outputText === null || fingerprintText(facts.outputText) !== expectedFingerprint) return null;
      return freeze({ status: "completed" as const, outputText: facts.outputText });
    } catch {
      return null;
    } finally {
      await runtime.close().catch(() => undefined);
    }
  }

  async function classify(runtime: PlanningRuntime, response: WorkflowRuntimeResponse, runId: string, invocationId: string, stepId: string): Promise<Readonly<{ settlement: PlanningRequestSettlement; outputText: string | null }>> {
    const facts = await runtime.stateStore.readModelInvocationResult({ runId, invocationId });
    if (facts?.status === "outcome_unknown" || facts?.status === "running" || response.status === "recovery_required") {
      return { settlement: settlement("recovery_required"), outputText: null };
    }
    if (facts?.status === "succeeded") {
      // A paid, durable result whose Run did not reach completion needs an operator, not a guess.
      if (response.status !== "completed" || facts.outputText === null) {
        return { settlement: settlement(response.status === "completed" ? "planning_failed" : "recovery_required"), outputText: null };
      }
      return { settlement: settlement("completed", fingerprintText(facts.outputText)), outputText: facts.outputText };
    }
    if (facts?.status === "failed") {
      // The final generation authority (aggregate budget reservation) denied dispatch: nothing was spent.
      if (facts.errorCode === "generation_not_authorized") return { settlement: settlement("budget_denied"), outputText: null };
      return { settlement: settlement(await failedTransiently(runtime, runId, stepId) ? "provider_unavailable" : "planning_failed"), outputText: null };
    }
    // No invocation was admitted (route / data handling / capability denied before the ledger).
    return { settlement: settlement("planning_failed"), outputText: null };
  }

  async function execute(begun: BegunPlanningRequest, context: PlanningRequestContext, messages: readonly ModelInvocationMessage[]): Promise<Readonly<{ settlement: PlanningRequestSettlement; outputText: string | null }>> {
    const ids = planningRunIds(begun.planningKey);
    const owner = begun.ownerUserId;
    const runtime = await compose({
      authorizer: { authorize: (command) => command.actorId === owner && command.runId === ids.runId },
      requirementsResolver: planningRequirementsResolver(policy),
      evidenceResolver: oneShotOwnerEgressApproval({
        ownerUserId: owner, workspaceId: domainWorkspaceId, projectId: begun.projectId, runId: ids.runId,
        stepId: ids.stepId, invocationId: ids.invocationId, expectedIdentity: policy.identity,
      }),
      runtimeContext: { now },
    });
    if (!runtime) return { settlement: settlement("planning_failed"), outputText: null };
    // Until `advance` is called no provider call is possible: a failure before it is definitive.
    let advancing = false;
    try {
      const state = createFeaturePlanPlanningRunState({
        workspaceId: domainWorkspaceId, planningKey: begun.planningKey,
        project: { projectId: begun.projectId, displayName: context.projectName }, createdAt: now(), policy,
      });
      if (!state) return { settlement: settlement("planning_failed"), outputText: null };
      await runtime.stateStore.create({ state: state as never });
      const started = await runtime.service.start({ kind: "start", commandId: ids.startCommandId, runId: ids.runId, expectedRevision: 0, actorId: owner });
      if (started.status !== "running" || started.revision === null) return { settlement: settlement("planning_failed"), outputText: null };
      advancing = true;
      const response = await runtime.service.advance(planningAdvanceCommand(begun.planningKey, owner, started.revision, messages));
      return await classify(runtime, response, ids.runId, ids.invocationId, ids.stepId);
    } catch {
      return { settlement: settlement(advancing ? "recovery_required" : "planning_failed"), outputText: null };
    } finally {
      await runtime.close().catch(() => undefined);
    }
  }

  async function complete(input: Parameters<PlanningModelPort["complete"]>[0]): Promise<Awaited<ReturnType<PlanningModelPort["complete"]>>> {
    const { context, messages } = input;
    // The policy's output ceiling must fit the planner's bound (the policy parser guarantees it).
    if (policy.maxOutputTokens > input.maxOutputTokens) return failure("unavailable");
    const requestFingerprint = planningRequestFingerprint(policy, context, messages);
    return withRequests(async (requests) => {
      const begun = await requests.begin({
        idempotencyKey: context.idempotencyKey, taskId: context.taskId, requestFingerprint,
        providerId: policy.identity.providerId, providerModelId: policy.identity.providerModelId,
      });
      if (begun.status !== "started" && begun.status !== "replayed") {
        return failure(begun.status === "invalid_input" || begun.status === "unavailable" ? "failed" : begun.status);
      }
      if (begun.status === "replayed") {
        const settled = begun.settlement;
        // In flight, crashed or ambiguously settled: never executed again.
        if (!settled || settled.outcome === "recovery_required") return failure("recovery_required");
        if (settled.outcome === "completed") return (await durableOutput(begun.planningKey, settled.outputFingerprint)) ?? failure("recovery_required");
        return failure(settled.outcome === "planning_failed" ? "failed" : settled.outcome);
      }
      // The task's project is server-side truth; a mismatch with the read the Owner saw fails closed.
      const executed = begun.projectId === context.projectId
        ? await execute(begun, context, messages)
        : { settlement: settlement("planning_failed"), outputText: null };
      if (await begun.settle(executed.settlement) !== "settled") return failure("recovery_required");
      const outcome = executed.settlement.outcome;
      if (outcome === "completed" && executed.outputText !== null) return freeze({ status: "completed" as const, outputText: executed.outputText });
      return failure(outcome === "completed" || outcome === "planning_failed" ? "failed" : outcome);
    });
  }

  return Object.freeze({ complete });
}
