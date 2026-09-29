/* eslint-disable @typescript-eslint/no-explicit-any -- runtime fixtures cross unknown adapter boundaries */
// Runtime builders for the live PostgreSQL suite: the canonical repository state fixture plus a
// local deterministic mock provider (no network, no real model provider).
import assert from "node:assert/strict";

const fixtureContract = (await import(
  new URL("../../helpers/workflow-runtime-state-fixture.mts", import.meta.url).href
)) as { createWorkflowRuntimeStateFixture(): any; transitionRuntimeState(state: any, kind: string): any };
const invocationContract = (await import(
  new URL("../../../lib/contracts/model-invocation.ts", import.meta.url).href
)) as typeof import("../../../lib/contracts/model-invocation");
const adapterContract = (await import(
  new URL("../../../lib/contracts/model-provider-adapter.ts", import.meta.url).href
)) as typeof import("../../../lib/contracts/model-provider-adapter");
const dataHandlingContract = (await import(
  new URL("../../../lib/contracts/model-invocation-data-handling.ts", import.meta.url).href
)) as typeof import("../../../lib/contracts/model-invocation-data-handling");
const leasePolicy = (await import(
  new URL("../../../lib/contracts/provider-claim-lease-policy.ts", import.meta.url).href
)) as typeof import("../../../lib/contracts/provider-claim-lease-policy");
const serviceContract = (await import(
  new URL("../../../lib/workflows/workflow-runtime-service.ts", import.meta.url).href
)) as typeof import("../../../lib/workflows/workflow-runtime-service");

export const { createWorkflowRuntimeStateFixture, transitionRuntimeState } = fixtureContract;

export const runId = "run-one";
export const stepId = "step-one";

// AI-037.6a: the trusted provider timing a real composition binds to both the provider client and
// the store (default 300 s claim lease; 20 s provider timeout + 10 s margin).
export function providerExecutionTiming(providerTimeoutMs = 20_000, claimLeaseDurationMs = 300_000) {
  const decision = leasePolicy.validateProviderClaimLeaseTiming({ providerTimeoutMs, claimLeaseDurationMs });
  assert.equal(decision.verdict, "allow");
  return decision.timing as NonNullable<typeof decision.timing>;
}

export function localMockModelProviderRegistry() {
  return {
    workspaceId: "workspace-primary",
    version: 1,
    providers: [{
      id: "provider-mock",
      kind: "mock",
      status: "active",
      deploymentMode: "local",
      supportedDataRegions: ["eu"],
      supportedDataEgressModes: ["forbidden"],
      capabilities: ["messages"],
    }],
    deployments: [{
      id: "deployment-mock",
      providerId: "provider-mock",
      status: "active",
      providerModelId: "mock/model:alias",
      providerRequestModelId: "mock/model:v1",
      providerModelVersion: "version-1",
      capabilities: ["messages"],
      supportedOutputTypes: ["patch"],
      maxInputTokens: 128_000,
      maxOutputTokens: 16_000,
      inputCostUsdMicrosPerMillionTokens: 1_000_000,
      outputCostUsdMicrosPerMillionTokens: 2_000_000,
      latencyClass: "standard",
      qualityTier: "reasoning",
    }],
    modelProfiles: [{
      modelProfileId: "model-shared",
      status: "active",
      requiredCapabilities: ["messages"],
      supportedOutputTypes: ["patch"],
      candidates: [{ deploymentId: "deployment-mock", priority: 1 }],
    }],
  };
}

// Canonical fixture state (queued Run "run-one", one agent Step "step-one") that the durable
// ledger path can execute against the local mock deployment.
export function executableRuntimeState() {
  return { ...createWorkflowRuntimeStateFixture(), modelProviderRegistry: localMockModelProviderRegistry() };
}

export type MockDispatch = Readonly<{ invocationId: string; stepId: string; outputText: string }>;

export const mockUsage = Object.freeze({ inputTokens: 100, outputTokens: 5, totalTokens: 105, costUsdMicros: 200 });

// Local deterministic provider following the adapter contract used by the durable ledger
// (preflight + run). The output text embeds the invocation id so each dispatch is distinguishable.
// `outcome` selects what a dispatched call returns: `succeeded` (default), a definitive provider
// `failed` result, or `lost` (the outcome is unknown after dispatch). `failPreflight` rejects before
// any dispatch.
export function localMockProvider(options: {
  beforeRun?: (invocationId: string) => void | Promise<void>;
  outcome?: () => "succeeded" | "failed" | "lost";
  failPreflight?: () => boolean;
} = {}) {
  const dispatches: MockDispatch[] = [];
  const adapter = {
    identity: {
      providerId: "provider-mock",
      providerKind: "mock",
      deploymentId: "deployment-mock",
      providerModelId: "mock/model:alias",
      providerRequestModelId: "mock/model:v1",
      providerModelVersion: "version-1",
    },
    async preflight(input: unknown, budgetInput: any) {
      if (options.failPreflight?.()) throw new Error("mock preflight unavailable");
      const requestDecision = invocationContract.validateAndNormalizeModelInvocationRequest(input);
      assert.ok(requestDecision.normalizedRequest);
      const sourceRequestFingerprint = dataHandlingContract.createModelInvocationRequestFingerprint(
        requestDecision.normalizedRequest,
      );
      const effectiveMaxOutputTokens = Math.min(
        budgetInput.authorizedMaxOutputTokens,
        budgetInput.deploymentMaxOutputTokens,
      );
      return {
        verdict: "allow" as const,
        reasons: [],
        requestDecision,
        normalizedPreflight: {
          providerId: "provider-mock",
          deploymentId: "deployment-mock",
          providerModelId: "mock/model:alias",
          providerRequestModelId: "mock/model:v1",
          providerModelVersion: "version-1",
          sourceRequestFingerprint,
          inputEnvelopeFingerprint: `sha256:${"e".repeat(64)}`,
          canonicalRequestFingerprint: `sha256:${"f".repeat(64)}`,
          inputTokenCount: mockUsage.inputTokens,
          effectiveMaxOutputTokens,
          maximumTotalTokens: mockUsage.inputTokens + effectiveMaxOutputTokens,
          maximumCostUsdMicros: 500,
        },
      };
    },
    async health() {
      return adapterContract.validateAndNormalizeModelProviderHealth({
        providerId: "provider-mock",
        deploymentId: "deployment-mock",
        status: "healthy",
        observedAt: new Date().toISOString(),
        latencyMs: 1,
        detailCode: null,
      });
    },
    async run(input: any) {
      const requestDecision = invocationContract.validateAndNormalizeModelInvocationRequest(input?.request ?? input);
      assert.ok(requestDecision.normalizedRequest);
      const request = requestDecision.normalizedRequest;
      await options.beforeRun?.(request.invocationId);
      const outputText = `Output of ${request.invocationId}`;
      dispatches.push(Object.freeze({ invocationId: request.invocationId, stepId: request.stepId, outputText }));
      const outcome = options.outcome?.() ?? "succeeded";
      if (outcome === "lost") {
        return {
          verdict: "deny" as const,
          reasons: [{
            code: "provider_exception",
            path: "response",
            message: "Provider request outcome is unknown after dispatch.",
            providerId: "provider-mock",
            deploymentId: "deployment-mock",
            invocationId: request.invocationId,
          }],
          requestDecision,
          resultDecision: null,
          normalizedResult: null,
        };
      }
      const failed = outcome === "failed";
      const normalizedResult = {
        invocationId: request.invocationId,
        outcome: failed ? "failed" : "succeeded",
        finishReason: failed ? "error" : "stop",
        providerId: "provider-mock",
        providerModelId: "mock/model:alias",
        providerRequestModelId: "mock/model:v1",
        providerModelVersion: "version-1",
        outputText: failed ? null : outputText,
        structuredOutput: null,
        toolCallProposals: [],
        usage: failed
          ? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
          : {
            inputTokens: mockUsage.inputTokens,
            outputTokens: mockUsage.outputTokens,
            totalTokens: mockUsage.totalTokens,
          },
        latencyMs: 5,
        costUsdMicros: failed ? 0 : mockUsage.costUsdMicros,
        error: failed
          ? { category: "rate_limited", code: "rate_limited", message: "Rate limited.", retryable: true }
          : null,
      };
      const resultDecision = invocationContract.validateAndNormalizeModelInvocationResult(normalizedResult);
      return { verdict: "allow" as const, reasons: [], requestDecision, resultDecision, normalizedResult };
    },
  };
  return { adapter, dispatches };
}

export function runtimeService(store: any, provider: ReturnType<typeof localMockProvider>, signals?: unknown) {
  return serviceContract.createWorkflowRuntimeService({
    ...(signals === undefined ? {} : { signals }),
    store,
    authorizer: { async authorize(input: any) { return input.actorId === "owner-one"; } },
    providers: [provider.adapter as any],
    requirementsResolver: {
      async resolve() {
        return {
          taskClass: "analysis",
          requestedCapability: "reasoning",
          riskLevel: "medium",
          requiresModel: true,
          requiresRepositoryRead: true,
          requiresRepositoryWrite: false,
          requiresCommandExecution: false,
          requiresNetwork: false,
          budget: { maxInputTokens: 16_000, maxOutputTokens: 4_000, maxCostUsdMicros: 500_000 },
        };
      },
    },
    runtimeContext: { now: () => new Date().toISOString() },
  } as any);
}

type StartCommand = import("../../../lib/workflows/workflow-runtime-service").WorkflowRuntimeStartCommand;
type AdvanceCommand = import("../../../lib/workflows/workflow-runtime-service").WorkflowRuntimeAdvanceCommand;

export function startCommand(): StartCommand {
  return { kind: "start" as const, commandId: "start-run-one", runId, expectedRevision: 0, actorId: "owner-one" };
}

export function advanceCommand(revision: number, commandId: string, suffix: string): AdvanceCommand {
  return {
    kind: "advance" as const,
    commandId,
    runId,
    expectedRevision: revision,
    actorId: "owner-one",
    agentInputs: [{
      stepId,
      executionId: `execution-${stepId}-${suffix}`,
      invocationDraft: {
        invocationId: `invocation-${stepId}-${suffix}`,
        invocationSequence: 1,
        stepId,
        messages: [
          { role: "system" as const, content: "Follow bounded instructions.", toolCallId: null },
          { role: "user" as const, content: `Execute ${stepId}.`, toolCallId: null },
        ],
        contextArtifactIds: [],
      },
    }],
  };
}

export function responseSummary(response: any) {
  return {
    verdict: response.verdict as string,
    status: response.status as string,
    revision: response.revision as number | null,
    reasons: (response.reasons ?? []).map((reason: any) => reason.code as string),
  };
}

// Delegating store that records every call's outcome (status or thrown), for reconciliation evidence.
export function recordingStore(real: any) {
  const calls: Array<{ method: string; status: string }> = [];
  const methods = ["load", "beginCommand", "completeCommand", "abandonCommand", "markCommandEffectful", "claim",
    "startExecution", "recordKnownExecutionOutcome", "compareAndSwap", "checkRiskApproval", "releaseClaim",
    "reserveModelInvocation", "authorizeModelInvocationPreflight", "reserveModelInvocationBudget",
    "releaseModelInvocationBudget", "recordModelInvocationOutcome"];
  const store: Record<string, unknown> = {};
  for (const method of methods) {
    store[method] = async (input: unknown) => {
      try {
        const result = await real[method](input);
        calls.push({ method, status: String(result?.status ?? (result === undefined ? "void" : typeof result)) });
        return result;
      } catch (error) {
        calls.push({ method, status: `threw:${error instanceof Error ? error.message : "unknown"}` });
        throw error;
      }
    };
  }
  return { store, calls };
}

export async function ledger(admin: any) {
  const rows = async (sql: string) => (await admin.query(sql)).rows;
  return {
    runs: await rows("select runtime_id, status, revision::int as revision from workflow_runs where runtime_id is not null order by runtime_id"),
    steps: await rows(`select step.step_key, step.status, step.attempt_count from workflow_step_runs as step
      join workflow_runs as run on run.id = step.run_id where run.runtime_id is not null order by step.step_key`),
    executions: await rows(`select step_id, attempt_number, expected_revision::int as expected_revision, execution_id, status
      from workflow_runtime_executions order by created_at, execution_id`),
    invocations: await rows(`select invocation_id, status, total_tokens::int as total_tokens, cost_usd_micros::int as cost
      from workflow_model_invocations order by created_at, invocation_id`),
    budgets: await rows(`select invocation_id, status, actual_total_tokens::int as actual_tokens,
      actual_cost_usd_micros::int as actual_cost from workflow_model_budget_reservations order by invocation_id`),
    windows: await rows(`select window_kind, reserved_amount::bigint::text as reserved, consumed_amount::bigint::text as consumed
      from workflow_model_budget_windows order by window_kind`),
  };
}
