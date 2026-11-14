// M2 local smoke: ONE supervised generation attempt through the composed real-provider runtime.
//
// Builds a minimal single-Step Workflow Run whose Project allows only Owner-approved minimum data
// egress (`approved_minimum` → the route requires approval evidence), then performs exactly one
// `advance`. The only data sent to the provider is the fixed synthetic prompt below. Egress is
// authorized by an ephemeral, one-shot Owner approval (see realProviderSmokeEgressApproval) that the
// Owner grants explicitly at the local boundary; it is latched on first use, bound to exactly this
// Run, Step, invocation, revision, attempt, candidate identity and request fingerprint, and expires
// ten minutes after that first use without renewal.
//
// Evidence is read only through the existing sanitized views (read model, recovery inspection,
// signal snapshot): no prompt, no provider output, no credentials, no database identifiers.
import type { ModelInvocationDataHandlingEvidenceResolverInput } from "../contracts/model-invocation-execution";
import type { ModelProviderIdentity } from "../contracts/model-provider-adapter";
import type { WorkflowRuntimeCommandAuthorizationInput } from "../workflows/workflow-runtime-service";
import type { RealProviderRuntime, RealProviderRuntimeInput } from "./real-provider-runtime";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createWorkflowRunSnapshot } from "../contracts/workflow-run.ts";

export const realProviderSmokeLimits = Object.freeze({
  // Generation ceiling for the one smoke call (tokens), and the per-invocation cost ceiling.
  maxOutputTokens: 16,
  maxInputTokens: 2_000,
  maxCostUsdMicros: 20_000, // USD 0.02
  // Aggregate windows for the smoke Project.
  dailyTokenBudget: 10_000,
  monthlyCostBudgetUsdCents: 100, // USD 1.00
  egressApprovalValidityMs: 10 * 60 * 1_000,
});

export const realProviderSmokeStepId = "smoke-step";
const projectId = "m2-smoke-project";
const departmentId = "m2-smoke-department";
const agentId = "m2-smoke-agent";
const workflowId = "m2-smoke-workflow";
const modelProfileId = "m2-smoke-model";
const smokeMessages = Object.freeze([
  Object.freeze({ role: "system" as const, content: "You are a connectivity check. Answer in one word.", toolCallId: null }),
  Object.freeze({ role: "user" as const, content: "Reply with the single word OK.", toolCallId: null }),
]);

export type RealProviderSmokeModel = RealProviderRuntimeInput["openAI"];

function budget() {
  return {
    maxConcurrentRuns: 1,
    maxAttemptsPerRun: 1,
    maxRunMinutes: 30,
    dailyTokenBudget: realProviderSmokeLimits.dailyTokenBudget,
    monthlyCostBudgetUsdCents: realProviderSmokeLimits.monthlyCostBudgetUsdCents,
  };
}

function projectRegistry(workspaceId: string) {
  const binding = (kind: "agent" | "workflow", subjectId: string) => ({
    id: `${subjectId}-binding`, projectId, departmentId, version: 1, status: "active", kind, subjectId,
    requestedResources: [], requestedModelProfileIds: [modelProfileId], requestedKnowledgeCollectionIds: [],
    requestedBudget: budget(), externalActionMode: "approval_required", dataEgressMode: "approved_minimum",
    additionalRequiredApprovalActions: [], additionalForbiddenActions: [],
  });
  return {
    workspaceId,
    projects: [{
      projectManifest: {
        id: projectId, workspaceId, version: 1, name: "M2 provider smoke", slug: projectId,
        summary: "Owner-supervised real-provider connectivity check.", kind: "internal_product", status: "active",
        defaultLocale: "en-US", timeZone: "UTC", dataRegion: "eu", dataClassification: "internal",
        goals: ["Prove one supervised provider call"], nonGoals: ["Any external action"], tags: ["m2"],
        resources: [], allowedModelProfileIds: [modelProfileId], knowledgeCollectionIds: [],
        policy: {
          externalActionMode: "approval_required", dataEgressMode: "approved_minimum",
          requiredApprovalActions: [], forbiddenActions: [],
        },
        budget: budget(),
      },
      departmentManifests: [{
        id: departmentId, projectId, version: 1, code: "development", name: "M2 smoke",
        summary: "Single supervised provider call.", status: "active", operatingMode: "approval_gated",
        goals: ["One provider call"], nonGoals: ["Deploy"], resourceGrants: [],
        allowedModelProfileIds: [modelProfileId], knowledgeCollectionIds: [], enabledWorkflowIds: [workflowId],
        operatorRoleIds: ["role-owner"],
        modelRouting: {
          primaryModelProfileId: modelProfileId, fallbackModelProfileIds: [], reviewerModelProfileId: null,
          independentReviewRequired: false,
        },
        policy: {
          externalActionMode: "approval_required", dataEgressMode: "approved_minimum",
          additionalRequiredApprovalActions: [], additionalForbiddenActions: [],
        },
        budget: budget(),
      }],
      bindings: [binding("agent", agentId), binding("workflow", workflowId)],
    }],
  };
}

function agentManifest() {
  return {
    id: agentId, projectId, departmentId, version: 1, roleCode: "developer", name: "M2 smoke agent",
    summary: "Performs the one supervised provider call.", status: "active", instructionProfileId: "m2-smoke",
    goals: ["Answer the connectivity check"], nonGoals: ["Deploy"], outputTypes: ["patch"],
    allowedWorkflowIds: [workflowId], allowedToolIds: [], allowedModelProfileIds: [modelProfileId],
    knowledgeCollectionIds: [],
    modelRouting: {
      primaryModelProfileId: modelProfileId, fallbackModelProfileIds: [], reviewerModelProfileId: null,
      independentReviewRequired: false,
    },
    additionalRequiredApprovalActions: [], additionalForbiddenActions: [],
  };
}

function workflowManifest() {
  return {
    id: workflowId, projectId, departmentId, version: 1, name: "M2 provider smoke",
    summary: "One Step, one provider call.", status: "active", triggerMode: "manual",
    goals: ["One provider call"], nonGoals: ["Deploy"],
    steps: [{
      id: realProviderSmokeStepId, kind: "agent_task", name: "Connectivity check", dependsOnStepIds: [],
      agentId, agentBindingId: `${agentId}-binding`, outputType: "patch", requestedResources: [],
      modelProfileId, knowledgeCollectionIds: [], toolIds: [], maxAttempts: 1, timeoutMinutes: 30,
      actionMode: "proposal_only", requiredApprovalAction: null,
    }],
    finalStepIds: [realProviderSmokeStepId], additionalRequiredApprovalActions: [], additionalForbiddenActions: [],
  };
}

// The model registry pins exactly the composed provider's identity, limits and prices, so the
// runtime's route, preflight budget and cost arithmetic use one configuration.
function modelProviderRegistry(workspaceId: string, model: RealProviderSmokeModel) {
  const identity = model.identity;
  return {
    workspaceId, version: 1,
    providers: [{
      id: identity.providerId, kind: identity.providerKind, status: "active", deploymentMode: "remote",
      supportedDataRegions: ["eu"], supportedDataEgressModes: ["approved_minimum"], capabilities: ["messages"],
    }],
    deployments: [{
      id: identity.deploymentId, providerId: identity.providerId, status: "active",
      providerModelId: identity.providerModelId, providerRequestModelId: identity.providerRequestModelId,
      providerModelVersion: identity.providerModelVersion, capabilities: ["messages"], supportedOutputTypes: ["patch"],
      maxInputTokens: model.maxInputTokens, maxOutputTokens: model.maxOutputTokens,
      inputCostUsdMicrosPerMillionTokens: model.inputCostUsdMicrosPerMillionTokens,
      outputCostUsdMicrosPerMillionTokens: model.outputCostUsdMicrosPerMillionTokens,
      latencyClass: "standard", qualityTier: "reasoning",
    }],
    modelProfiles: [{
      modelProfileId, status: "active", requiredCapabilities: ["messages"], supportedOutputTypes: ["patch"],
      candidates: [{ deploymentId: identity.deploymentId, priority: 1 }],
    }],
  };
}

export function createRealProviderSmokeState(input: Readonly<{
  workspaceId: string; runId: string; createdAt: string; model: RealProviderSmokeModel;
}>) {
  const registry = projectRegistry(input.workspaceId);
  const created = createWorkflowRunSnapshot({
    runId: input.runId,
    requestId: `${input.runId}-request`,
    createdAt: input.createdAt,
    schedulerInput: {
      registry: structuredClone(registry),
      policy: {
        workspaceId: input.workspaceId, status: "active", maxConcurrentRuns: 1, maxQueuedRuns: 1,
        projectPolicies: [{ projectId, status: "active", maxQueuedRuns: 1, allowedPriorities: ["P2"] }],
      },
      queuedRequests: [{
        id: `${input.runId}-request`, workspaceId: input.workspaceId, projectId,
        bindingId: `${workflowId}-binding`, modelProfileId, idempotencyKey: `${input.runId}-idempotency`,
        priority: "P2", sequence: 1,
      }],
      runningRuns: [],
      lastDispatchedProjectId: null,
    },
    workflowCatalog: {
      registry,
      agents: [{ bindingId: `${agentId}-binding`, agentManifest: agentManifest() }],
      workflows: [{ bindingId: `${workflowId}-binding`, workflowManifest: workflowManifest() }],
    },
  });
  if (created.verdict !== "allow" || !created.snapshot) throw new Error("M2 smoke Run definition is invalid.");
  return {
    snapshot: created.snapshot,
    projectRegistry: registry,
    modelProviderRegistry: modelProviderRegistry(input.workspaceId, input.model),
    existingRequests: [],
    pause: null,
  };
}

// The runner uses only the default attempt. `label` names a later, separately authorized attempt
// (used by the recovery and retry proofs); each attempt has its own execution and invocation.
export function realProviderSmokeIds(runId: string, label?: string) {
  const prefix = label === undefined ? runId : `${runId}-${label}`;
  return Object.freeze({
    runId,
    stepId: realProviderSmokeStepId,
    executionId: `${prefix}-execution`,
    invocationId: `${prefix}-invocation`,
    commandId: `${prefix}-advance`,
  });
}

// Owner-only command authority for the smoke Run.
export function realProviderSmokeAuthorizer(ownerId: string) {
  return Object.freeze({
    authorize: (input: WorkflowRuntimeCommandAuthorizationInput) => input.actorId === ownerId,
  });
}

// The smoke's capability requirements: the exact per-invocation token and cost ceiling.
export const realProviderSmokeRequirementsResolver = Object.freeze({
  resolve: () => ({
    taskClass: "analysis",
    requestedCapability: "reasoning",
    riskLevel: "medium",
    requiresModel: true,
    requiresRepositoryRead: false,
    requiresRepositoryWrite: false,
    requiresCommandExecution: false,
    requiresNetwork: false,
    budget: {
      maxInputTokens: realProviderSmokeLimits.maxInputTokens,
      maxOutputTokens: realProviderSmokeLimits.maxOutputTokens,
      maxCostUsdMicros: realProviderSmokeLimits.maxCostUsdMicros,
    },
  }),
});

// Explicit Owner data-egress approval: ephemeral (process-local, lost on restart), one-shot and
// NON-RENEWABLE. For each explicitly pre-approved invocation the first matching resolution latches
// exactly one immutable evidence object: every request binding, decidedAt (= that first factual
// evaluation time) and expiresAt (= decidedAt + 10 minutes) are fixed then and never change.
// Later resolutions return that same object only if every binding still matches; anything else
// gets null. An expired latch is still returned unchanged, so the data-handling contract denies it;
// a replacement is never minted. Approval of one invocation never authorizes another.
const identityFields = [
  "providerId", "providerKind", "deploymentId", "providerModelId", "providerRequestModelId", "providerModelVersion",
] as const;

function sameIdentity(left: ModelProviderIdentity, right: ModelProviderIdentity): boolean {
  return identityFields.every((field) => left[field] === right[field]);
}

type LatchedEgressApproval = Readonly<{
  kind: "approval"; evidenceId: string; approvalRequestId: string; status: "approved";
  workspaceId: string; projectId: string; runId: string; invocationId: string; runRevision: number;
  stepId: string; attemptNumber: number; modelProfileId: string; candidateIdentity: ModelProviderIdentity;
  sourceRequestFingerprint: string; purpose: "model_data_egress"; approvedByActorKind: "owner";
  approvedByActorId: string; decidedAt: string; expiresAt: string; reason: null;
}>;

export function realProviderSmokeEgressApproval(input: Readonly<{
  ownerId: string; runId: string; expectedIdentity: ModelProviderIdentity; attemptLabels?: readonly (string | undefined)[];
}>) {
  const expectedIdentity: ModelProviderIdentity = Object.freeze(
    Object.fromEntries(identityFields.map((field) => [field, input.expectedIdentity[field]])) as ModelProviderIdentity,
  );
  const ownerId = input.ownerId;
  const runId = input.runId;
  // One independent latch per explicitly approved invocation; no wildcard.
  const latches = new Map<string, LatchedEgressApproval | null>(
    (input.attemptLabels ?? [undefined]).map((label) => [realProviderSmokeIds(runId, label).invocationId, null]),
  );
  return Object.freeze({
    async resolve(request: ModelInvocationDataHandlingEvidenceResolverInput) {
      if (request.requirement !== "approval_required" || request.runId !== runId
        || request.stepId !== realProviderSmokeStepId || !latches.has(request.invocationId)
        || !sameIdentity(request.candidateIdentity, expectedIdentity)) return null;
      const latched = latches.get(request.invocationId);
      if (latched) {
        const bound = request.workspaceId === latched.workspaceId && request.projectId === latched.projectId
          && request.runRevision === latched.runRevision && request.attemptNumber === latched.attemptNumber
          && request.modelProfileId === latched.modelProfileId
          && request.sourceRequestFingerprint === latched.sourceRequestFingerprint
          && sameIdentity(request.candidateIdentity, latched.candidateIdentity);
        return bound ? latched : null;
      }
      const decidedMs = Date.parse(request.evaluatedAt);
      if (!Number.isFinite(decidedMs)) return null;
      const evidence: LatchedEgressApproval = Object.freeze({
        kind: "approval",
        evidenceId: `${request.invocationId}-egress`,
        approvalRequestId: `${request.invocationId}-egress-request`,
        status: "approved",
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        runId: request.runId,
        invocationId: request.invocationId,
        runRevision: request.runRevision,
        stepId: request.stepId,
        attemptNumber: request.attemptNumber,
        modelProfileId: request.modelProfileId,
        candidateIdentity: expectedIdentity,
        sourceRequestFingerprint: request.sourceRequestFingerprint,
        purpose: "model_data_egress",
        approvedByActorKind: "owner",
        approvedByActorId: ownerId,
        decidedAt: new Date(decidedMs).toISOString(),
        expiresAt: new Date(decidedMs + realProviderSmokeLimits.egressApprovalValidityMs).toISOString(),
        reason: null, // the contract requires a null reason on approved evidence
      });
      latches.set(request.invocationId, evidence);
      return evidence;
    },
  });
}

export function realProviderSmokeAdvanceCommand(runId: string, ownerId: string, expectedRevision: number, label?: string) {
  const ids = realProviderSmokeIds(runId, label);
  return {
    kind: "advance" as const,
    commandId: ids.commandId,
    runId,
    expectedRevision,
    actorId: ownerId,
    agentInputs: [{
      stepId: ids.stepId,
      executionId: ids.executionId,
      invocationDraft: {
        invocationId: ids.invocationId,
        invocationSequence: 1,
        stepId: ids.stepId,
        messages: smokeMessages.map((message) => ({ ...message })),
        contextArtifactIds: [],
      },
    }],
  };
}

// Sanitized evidence: statuses, identity, usage, cost, budget status, audit event names, signals.
export async function collectRealProviderSmokeEvidence(runtime: RealProviderRuntime, runId: string) {
  const ids = realProviderSmokeIds(runId);
  const overview = await runtime.readModel.getRunOverview(runId);
  const audit = await runtime.readModel.getRunAuditTimeline(runId);
  const recovery = await runtime.stateStore.inspectExecutionRecovery({
    runId, stepId: ids.stepId, executionId: ids.executionId,
  });
  const run = overview.data;
  return {
    runStatus: run?.status ?? null,
    runRevision: run?.revision ?? null,
    stepStatus: recovery.step?.status ?? null,
    executionStatus: recovery.execution?.status ?? null,
    invocation: run?.latestModelInvocation
      ? {
        status: run.latestModelInvocation.status,
        outcome: recovery.invocation?.outcome ?? null,
        providerId: run.latestModelInvocation.providerId,
        deploymentId: run.latestModelInvocation.deploymentId,
        providerModelId: run.latestModelInvocation.providerModelId,
        providerRequestModelId: run.latestModelInvocation.providerRequestModelId,
        providerModelVersion: run.latestModelInvocation.providerModelVersion,
      }
      : null,
    usage: run
      ? {
        inputTokens: run.modelUsage.inputTokens,
        outputTokens: run.modelUsage.outputTokens,
        totalTokens: run.modelUsage.totalTokens,
        costUsdMicros: run.modelUsage.totalCostUsdMicros,
        invocationCount: run.modelUsage.invocationCount,
      }
      : null,
    budgetStatus: recovery.budget?.status ?? null,
    recoveryEligible: recovery.eligible,
    auditEvents: (audit.data ?? []).map((item) => item.eventType),
    signals: runtime.signals(),
  };
}

export type RealProviderSmokeOutcome = Readonly<{
  status: "completed" | "stopped";
  responseStatus: string;
  responseReasons: readonly string[];
  evidence: Awaited<ReturnType<typeof collectRealProviderSmokeEvidence>>;
}>;

// Exactly one generation attempt: create, start, ONE advance. Never retries; the caller must stop
// on anything but `completed` (outcome_unknown, failure, usage mismatch, ambiguous persistence).
export async function runRealProviderSmokeAttempt(
  runtime: RealProviderRuntime,
  input: Readonly<{ workspaceId: string; runId: string; ownerId: string; model: RealProviderSmokeModel; now: string }>,
): Promise<RealProviderSmokeOutcome> {
  await runtime.stateStore.create({
    state: createRealProviderSmokeState({
      workspaceId: input.workspaceId, runId: input.runId, createdAt: input.now, model: input.model,
    }) as never,
  });
  const started = await runtime.service.start({
    kind: "start", commandId: `${input.runId}-start`, runId: input.runId, expectedRevision: 0, actorId: input.ownerId,
  });
  const response = started.status === "running"
    ? await runtime.service.advance(realProviderSmokeAdvanceCommand(input.runId, input.ownerId, started.revision ?? 1))
    : started;
  return Object.freeze({
    status: response.status === "completed" ? "completed" as const : "stopped" as const,
    responseStatus: response.status,
    responseReasons: Object.freeze(response.reasons.map((reason) => reason.code)),
    evidence: await collectRealProviderSmokeEvidence(runtime, input.runId),
  });
}
