import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial executable fixtures intentionally cross unknown boundaries */

const executionContract = (await import(
  new URL("../lib/contracts/model-invocation-execution.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-invocation-execution");
const invocationContract = (await import(
  new URL("../lib/contracts/model-invocation.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-invocation");
const registryContract = (await import(
  new URL("../lib/contracts/model-provider-registry.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-provider-registry");
const adapterContract = (await import(
  new URL("../lib/contracts/model-provider-adapter.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-provider-adapter");
const mockContract = (await import(
  new URL("../lib/providers/deterministic-mock-model-provider.ts", import.meta.url).href
)) as typeof import("../lib/providers/deterministic-mock-model-provider");
const dataHandlingContract = (await import(
  new URL("../lib/contracts/model-invocation-data-handling.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-invocation-data-handling");
const openAIContract = (await import(
  new URL("../lib/providers/openai-model-provider.ts", import.meta.url).href
)) as typeof import("../lib/providers/openai-model-provider");
const runContract = (await import(
  new URL("../lib/contracts/workflow-run.ts", import.meta.url).href
)) as typeof import("../lib/contracts/workflow-run");

const {
  executeModelInvocation: executeModelInvocationContract,
  isModelInvocationExecutionStatus,
  isModelInvocationExecutionVerdict,
  modelInvocationExecutionLimits,
  modelInvocationExecutionStatuses,
  modelInvocationExecutionVerdicts,
  parseModelInvocationExecutionStatus,
  parseModelInvocationExecutionVerdict,
} = executionContract;
const {
  modelInvocationLimits,
  validateAndNormalizeModelInvocationRequest,
  validateAndNormalizeModelInvocationResult,
} = invocationContract;
const {
  modelProviderRegistryLimits,
  resolveModelInvocationRoute,
} = registryContract;
const {
  modelProviderAdapterLimits,
  validateAndNormalizeModelProviderHealth,
} = adapterContract;
const { createDeterministicMockModelProvider } = mockContract;
const {
  createModelInvocationRequestFingerprint,
} = dataHandlingContract;
const { createOpenAIModelProvider } = openAIContract;
const { createWorkflowRunSnapshot, evaluateWorkflowRunTransition } = runContract;

type Counters = { health: number; run: number; tool: number };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deeplyFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

function budget() {
  return {
    maxConcurrentRuns: 4,
    maxAttemptsPerRun: 3,
    maxRunMinutes: 120,
    dailyTokenBudget: 1_000_000,
    monthlyCostBudgetUsdCents: 250_000,
  };
}

function project(dataEgressMode = "forbidden") {
  return {
    id: "project-one",
    workspaceId: "workspace-primary",
    version: 3,
    name: "Project one",
    slug: "project-one",
    summary: "Owner-controlled project context.",
    kind: "internal_product",
    status: "active",
    defaultLocale: "en-US",
    timeZone: "UTC",
    dataRegion: "eu",
    dataClassification: "confidential",
    goals: ["Operate safely"],
    nonGoals: ["Autonomous actions"],
    tags: ["one"],
    resources: [{
      id: "repository-one",
      kind: "code_repository",
      label: "Repository one",
      status: "connected",
      connectionId: "connection-one",
      resourceRef: "owner/repository-one",
      capabilities: ["read_metadata", "propose_change"],
    }],
    allowedModelProfileIds: ["model-shared", "model-one"],
    knowledgeCollectionIds: ["knowledge-one"],
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode,
      requiredApprovalActions: ["project-review-one"],
      forbiddenActions: ["Project action forbidden"],
    },
    budget: budget(),
  };
}

function department(dataEgressMode = "forbidden") {
  return {
    id: "department-one",
    projectId: "project-one",
    version: 5,
    code: "development",
    name: "Department one",
    summary: "Reviewed work.",
    status: "active",
    operatingMode: "approval_gated",
    goals: ["Build reviewed artifacts"],
    nonGoals: ["Deploy automatically"],
    resourceGrants: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }],
    allowedModelProfileIds: ["model-shared", "model-one"],
    knowledgeCollectionIds: ["knowledge-one"],
    enabledWorkflowIds: ["workflow-one"],
    operatorRoleIds: ["role-owner"],
    modelRouting: {
      primaryModelProfileId: "model-shared",
      fallbackModelProfileIds: ["model-one"],
      reviewerModelProfileId: "model-one",
      independentReviewRequired: true,
    },
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode,
      additionalRequiredApprovalActions: ["department-review-one"],
      additionalForbiddenActions: ["Department publish forbidden"],
    },
    budget: { ...budget(), maxConcurrentRuns: 3, maxAttemptsPerRun: 2, maxRunMinutes: 60 },
  };
}

function binding(kind: "agent" | "workflow", dataEgressMode = "forbidden") {
  return {
    id: `${kind}-binding-one`,
    projectId: "project-one",
    departmentId: "department-one",
    version: kind === "agent" ? 7 : 8,
    status: "active",
    kind,
    subjectId: `${kind}-one`,
    requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }],
    requestedModelProfileIds: ["model-shared", "model-one"],
    requestedKnowledgeCollectionIds: ["knowledge-one"],
    requestedBudget: { ...budget(), maxConcurrentRuns: 1, maxAttemptsPerRun: 2, maxRunMinutes: 30 },
    externalActionMode: "approval_required",
    dataEgressMode,
    additionalRequiredApprovalActions: [kind === "workflow" ? "workflow-external-one" : "agent-review-one"],
    additionalForbiddenActions: [`${kind} deploy forbidden`],
  };
}

function projectRegistry(dataEgressMode = "forbidden") {
  return {
    workspaceId: "workspace-primary",
    projects: [{
      projectManifest: project(dataEgressMode),
      departmentManifests: [department(dataEgressMode)],
      bindings: [binding("agent", dataEgressMode), binding("workflow", dataEgressMode)],
    }],
  };
}

function agent(toolIds: string[] = ["tool-read"]) {
  return {
    id: "agent-one",
    projectId: "project-one",
    departmentId: "department-one",
    version: 11,
    roleCode: "developer",
    name: "Developer one",
    summary: "Creates bounded artifacts.",
    status: "active",
    instructionProfileId: "instructions-one",
    goals: ["Create reviewed artifacts"],
    nonGoals: ["Deploy automatically"],
    outputTypes: ["patch", "test_report"],
    allowedWorkflowIds: ["workflow-one"],
    allowedToolIds: toolIds,
    allowedModelProfileIds: ["model-shared", "model-one"],
    knowledgeCollectionIds: ["knowledge-one"],
    modelRouting: {
      primaryModelProfileId: "model-shared",
      fallbackModelProfileIds: ["model-one"],
      reviewerModelProfileId: "model-one",
      independentReviewRequired: true,
    },
    additionalRequiredApprovalActions: ["agent-review-one", "workflow-external-one"],
    additionalForbiddenActions: ["Agent deploy forbidden"],
  };
}

function workflow(toolIds: string[] = ["tool-read"]) {
  return {
    id: "workflow-one",
    projectId: "project-one",
    departmentId: "department-one",
    version: 13,
    name: "Workflow one",
    summary: "Runs bounded approved work.",
    status: "active",
    triggerMode: "manual",
    goals: ["Produce reviewed output"],
    nonGoals: ["Deploy automatically"],
    steps: [{
      id: "execute-one",
      kind: "agent_task",
      name: "Execute approved task",
      dependsOnStepIds: ["approve-one"],
      agentId: "agent-one",
      agentBindingId: "agent-binding-one",
      outputType: "patch",
      requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }],
      modelProfileId: "model-shared",
      knowledgeCollectionIds: ["knowledge-one"],
      toolIds,
      maxAttempts: 2,
      timeoutMinutes: 30,
      actionMode: "external_action",
      requiredApprovalAction: "workflow-external-one",
    }, {
      id: "approve-one",
      kind: "approval_gate",
      name: "Owner approval",
      dependsOnStepIds: [],
      approvalAction: "workflow-external-one",
    }],
    finalStepIds: ["execute-one"],
    additionalRequiredApprovalActions: ["workflow-review-one"],
    additionalForbiddenActions: ["Workflow publish forbidden"],
  };
}

function creation(dataEgressMode = "forbidden", toolIds: string[] = ["tool-read"]) {
  const registry = projectRegistry(dataEgressMode);
  return {
    runId: "run-one",
    requestId: "request-one",
    createdAt: "2026-08-26T10:15:30.000Z",
    schedulerInput: {
      registry: clone(registry),
      policy: {
        workspaceId: "workspace-primary",
        status: "active",
        maxConcurrentRuns: 8,
        maxQueuedRuns: 512,
        projectPolicies: [{
          projectId: "project-one",
          status: "active",
          maxQueuedRuns: 256,
          allowedPriorities: ["P0", "P1", "P2", "P3", "P4"],
        }],
      },
      queuedRequests: [{
        id: "request-one",
        workspaceId: "workspace-primary",
        projectId: "project-one",
        bindingId: "workflow-binding-one",
        modelProfileId: "model-shared",
        idempotencyKey: "idempotency-one",
        priority: "P2",
        sequence: 1,
      }],
      runningRuns: [],
      lastDispatchedProjectId: null,
    },
    workflowCatalog: {
      registry,
      agents: [{ bindingId: "agent-binding-one", agentManifest: agent(toolIds) }],
      workflows: [{ bindingId: "workflow-binding-one", workflowManifest: workflow(toolIds) }],
    },
  };
}

function apply(snapshot: any, kind: string, index: number, extra: Record<string, unknown> = {}) {
  const decision = evaluateWorkflowRunTransition({
    snapshot,
    event: {
      eventId: `event-${index}`,
      runId: snapshot.runId,
      kind,
      sequence: snapshot.revision + 1,
      occurredAt: `2026-08-26T10:15:${30 + index}.000Z`,
      actorKind: "owner",
      actorId: "owner-one",
      ...extra,
    },
  });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.ok(decision.nextSnapshot);
  return decision.nextSnapshot;
}

function runningSnapshot(dataEgressMode = "forbidden", toolIds: string[] = ["tool-read"]) {
  const created = createWorkflowRunSnapshot(creation(dataEgressMode, toolIds));
  assert.equal(created.verdict, "allow", JSON.stringify(created.reasons));
  assert.ok(created.snapshot);
  let snapshot = apply(created.snapshot, "run_started", 1);
  snapshot = apply(snapshot, "approval_requested", 2, {
    stepId: "approve-one",
    approvalRequestId: "approval-one",
  });
  snapshot = apply(snapshot, "approval_granted", 3, {
    stepId: "approve-one",
    approvalRequestId: "approval-one",
  });
  return apply(snapshot, "step_started", 4, { stepId: "execute-one" });
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    invocationId: "invocation-one",
    invocationSequence: 1,
    stepId: "execute-one",
    messages: [
      { role: "system", content: "Follow bounded instructions.", toolCallId: null },
      { role: "user", content: "Prepare the proposal.", toolCallId: null },
    ],
    contextArtifactIds: ["artifact-one"],
    ...overrides,
  };
}

function registryProvider(
  providerId: string,
  deploymentMode: "local" | "remote",
  dataEgressMode: string,
) {
  return {
    id: providerId,
    kind: "mock",
    status: "active",
    deploymentMode,
    supportedDataRegions: ["eu"],
    supportedDataEgressModes: [dataEgressMode],
    capabilities: ["messages", "tool_calls", "structured_output"],
  };
}

function registryDeployment(providerId: string, deploymentId: string) {
  return {
    id: deploymentId,
    providerId,
    status: "active",
    providerModelId: `${providerId}/model:v1`,
    providerModelVersion: "version-1",
    capabilities: ["messages", "tool_calls", "structured_output"],
    supportedOutputTypes: ["patch", "test_report"],
    maxInputTokens: 128_000,
    maxOutputTokens: 16_000,
    inputCostUsdMicrosPerMillionTokens: 1_000_000,
    outputCostUsdMicrosPerMillionTokens: 2_000_000,
    latencyClass: "standard",
    qualityTier: "reasoning",
  };
}

function providerRegistry(options: {
  dataEgressMode?: string;
  deploymentMode?: "local" | "remote";
  twoCandidates?: boolean;
} = {}) {
  const dataEgressMode = options.dataEgressMode ?? "forbidden";
  const deploymentMode = options.deploymentMode ?? "local";
  const specs = options.twoCandidates
    ? [["provider-a", "deployment-a"], ["provider-b", "deployment-b"]] as const
    : [["provider-mock", "deployment-mock"]] as const;
  return {
    workspaceId: "workspace-primary",
    version: 1,
    providers: specs.map(([providerId]) => registryProvider(providerId, deploymentMode, dataEgressMode)),
    deployments: specs.map(([providerId, deploymentId]) => registryDeployment(providerId, deploymentId)),
    modelProfiles: [
      {
        modelProfileId: "model-shared",
        status: "active",
        requiredCapabilities: ["messages", "tool_calls"],
        supportedOutputTypes: ["patch", "test_report"],
        candidates: specs.map(([, deploymentId], index) => ({ deploymentId, priority: index + 1 })),
      },
      {
        modelProfileId: "model-one",
        status: "active",
        requiredCapabilities: ["messages"],
        supportedOutputTypes: ["patch", "test_report"],
        candidates: [{ deploymentId: specs[0][1], priority: 1 }],
      },
    ],
  };
}

function routeInput(options: {
  dataEgressMode?: string;
  deploymentMode?: "local" | "remote";
  twoCandidates?: boolean;
  draftOverrides?: Record<string, unknown>;
  toolIds?: string[];
} = {}) {
  const dataEgressMode = options.dataEgressMode ?? "forbidden";
  return {
    projectRegistry: projectRegistry(dataEgressMode),
    modelProviderRegistry: providerRegistry({
      dataEgressMode,
      deploymentMode: options.deploymentMode,
      twoCandidates: options.twoCandidates,
    }),
    invocationAdmission: {
      snapshot: runningSnapshot(dataEgressMode, options.toolIds),
      draft: draft(options.draftOverrides),
      existingRequests: [],
    },
  };
}

function executionInput(
  input: unknown,
  candidateIdentity?: unknown,
) {
  const route = resolveModelInvocationRoute(input);
  const candidate = route.routePlan?.primary;
  return {
    routeInput: input,
    candidateIdentity: candidateIdentity ?? (candidate
      ? {
          providerId: candidate.providerId,
          providerKind: candidate.providerKind,
          deploymentId: candidate.deploymentId,
          providerModelId: candidate.providerModelId,
          providerModelVersion: candidate.providerModelVersion,
        }
      : identity()),
  };
}

function runtimeContext(evaluatedAt: unknown = "2026-08-26T10:15:40.000Z") {
  return { now: () => evaluatedAt };
}

async function executeModelInvocation(
  input: unknown,
  providers: unknown,
  evidenceResolver?: unknown,
  trustedRuntimeContext: unknown = runtimeContext(),
) {
  return executeModelInvocationContract(
    executionInput(input),
    providers,
    evidenceResolver,
    trustedRuntimeContext,
  );
}

function factualRequest(input: unknown) {
  const route = resolveModelInvocationRoute(input);
  assert.equal(route.verdict, "allow", JSON.stringify(route.reasons));
  assert.ok(route.invocationAdmissionDecision?.normalizedRequest);
  return clone(route.invocationAdmissionDecision.normalizedRequest);
}

function identity(providerId = "provider-mock", deploymentId = "deployment-mock") {
  return {
    providerId,
    providerKind: "mock",
    deploymentId,
    providerModelId: `${providerId}/model:v1`,
    providerModelVersion: "version-1",
  };
}

function health(providerId = "provider-mock", deploymentId = "deployment-mock", status = "healthy") {
  return {
    providerId,
    deploymentId,
    status,
    observedAt: "2026-08-26T10:15:30.000Z",
    latencyMs: 5,
    detailCode: null,
  };
}

function result(
  request: ReturnType<typeof factualRequest>,
  providerId = "provider-mock",
  overrides: Record<string, unknown> = {},
) {
  return {
    invocationId: request.invocationId,
    outcome: "succeeded",
    finishReason: "stop",
    providerId,
    providerModelId: `${providerId}/model:v1`,
    providerModelVersion: "version-1",
    outputText: "Deterministic execution output.",
    structuredOutput: null,
    toolCallProposals: [],
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    latencyMs: 5,
    costUsdMicros: 0,
    error: null,
    ...overrides,
  };
}

function routeFacts(input: unknown, candidateIndex = 0) {
  const route = resolveModelInvocationRoute(input);
  assert.equal(route.verdict, "allow", JSON.stringify(route.reasons));
  assert.ok(route.routePlan && route.invocationAdmissionDecision?.normalizedRequest);
  const candidate = [route.routePlan.primary, ...route.routePlan.fallbacks][candidateIndex];
  assert.ok(candidate);
  return {
    route,
    request: clone(route.invocationAdmissionDecision.normalizedRequest),
    candidate,
    candidateIdentity: {
      providerId: candidate.providerId,
      providerKind: candidate.providerKind,
      deploymentId: candidate.deploymentId,
      providerModelId: candidate.providerModelId,
      providerModelVersion: candidate.providerModelVersion,
    },
  };
}

function redactionEvidence(
  input: unknown,
  candidateIndex = 0,
  overrides: Record<string, unknown> = {},
) {
  const facts = routeFacts(input, candidateIndex);
  const assessments = facts.request.messages.map((message, messageIndex) => {
    const start = message.content.indexOf("SECRET_SENTINEL");
    return start < 0
      ? { messageIndex, assessment: "no_sensitive_data", spans: [] }
      : {
          messageIndex,
          assessment: "redacted",
          spans: [{ start, end: start + "SECRET_SENTINEL".length, category: "credential" }],
        };
  });
  return {
    kind: "redaction",
    evidenceId: "evidence-redaction-one",
    workspaceId: facts.request.workspaceId,
    projectId: facts.request.projectId,
    runId: facts.request.runId,
    invocationId: facts.request.invocationId,
    runRevision: facts.request.runRevision,
    stepId: facts.request.stepId,
    attemptNumber: facts.request.attemptNumber,
    modelProfileId: facts.request.modelProfileId,
    candidateIdentity: facts.candidateIdentity,
    sourceRequestFingerprint: createModelInvocationRequestFingerprint(facts.request),
    assessedAt: "2026-08-26T10:15:35.000Z",
    detectorId: "detector-one",
    detectorVersion: "version-one",
    messages: assessments,
    ...overrides,
  };
}

function approvalEvidence(
  input: unknown,
  candidateIndex = 0,
  overrides: Record<string, unknown> = {},
) {
  const facts = routeFacts(input, candidateIndex);
  return {
    kind: "approval",
    evidenceId: "evidence-approval-one",
    approvalRequestId: "approval-egress-one",
    status: "approved",
    workspaceId: facts.request.workspaceId,
    projectId: facts.request.projectId,
    runId: facts.request.runId,
    invocationId: facts.request.invocationId,
    runRevision: facts.request.runRevision,
    stepId: facts.request.stepId,
    attemptNumber: facts.request.attemptNumber,
    modelProfileId: facts.request.modelProfileId,
    candidateIdentity: facts.candidateIdentity,
    sourceRequestFingerprint: createModelInvocationRequestFingerprint(facts.request),
    purpose: "model_data_egress",
    approvedByActorKind: "owner",
    approvedByActorId: "owner-one",
    decidedAt: "2026-08-26T10:15:35.000Z",
    expiresAt: "2026-08-26T10:16:00.000Z",
    reason: null,
    ...overrides,
  };
}

function directProvider(
  input: unknown,
  counters: Counters,
  candidateIndex = 0,
  observe?: (request: unknown) => void,
) {
  const facts = routeFacts(input, candidateIndex);
  return {
    identity: facts.candidateIdentity,
    async health() {
      counters.health += 1;
      return validateAndNormalizeModelProviderHealth({
        providerId: facts.candidate.providerId,
        deploymentId: facts.candidate.deploymentId,
        status: "healthy",
        observedAt: "2026-08-26T10:15:40.000Z",
        latencyMs: 1,
        detailCode: null,
      });
    },
    async run(requestInput: unknown) {
      counters.run += 1;
      observe?.(requestInput);
      const requestDecision = validateAndNormalizeModelInvocationRequest(requestInput);
      assert.ok(requestDecision.normalizedRequest);
      const normalizedResult = result(
        requestDecision.normalizedRequest,
        facts.candidate.providerId,
      );
      const resultDecision = validateAndNormalizeModelInvocationResult(normalizedResult);
      return {
        verdict: "allow",
        reasons: [],
        requestDecision,
        resultDecision,
        normalizedResult,
      };
    },
  };
}

function mockProvider(
  input: unknown,
  providerId = "provider-mock",
  deploymentId = "deployment-mock",
  status = "healthy",
  resultOverrides: Record<string, unknown> = {},
) {
  const request = factualRequest(input);
  const factory = createDeterministicMockModelProvider({
    identity: identity(providerId, deploymentId),
    health: health(providerId, deploymentId, status),
    scripts: [{ request, result: result(request, providerId, resultOverrides) }],
  });
  assert.equal(factory.verdict, "allow", JSON.stringify(factory.reasons));
  assert.ok(factory.provider);
  return factory.provider;
}

function instrument(
  provider: { identity: unknown; health: () => Promise<unknown>; run: (input: unknown) => Promise<unknown> },
  counters: Counters,
  overrides: {
    health?: () => unknown | Promise<unknown>;
    run?: (input: unknown) => unknown | Promise<unknown>;
  } = {},
) {
  const capturedHealth = provider.health;
  const capturedRun = provider.run;
  return {
    identity: provider.identity,
    async health() {
      counters.health += 1;
      return overrides.health ? overrides.health() : capturedHealth();
    },
    async run(input: unknown) {
      counters.run += 1;
      return overrides.run ? overrides.run(input) : capturedRun(input);
    },
  };
}

function reasonCodes(decision: { reasons: readonly { code: string }[] }) {
  return decision.reasons.map((reason) => reason.code);
}

function assertDeny(decision: Awaited<ReturnType<typeof executeModelInvocation>>) {
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.status, "denied");
  assert.equal(decision.selectedCandidate, null);
  assert.equal(decision.normalizedResult, null);
  assert.equal(decision.dataHandlingPermit, null);
  assert.equal(deeplyFrozen(decision), true);
}

test("exports exact frozen execution enums, guards, parsers, and canonical limits", () => {
  assert.deepEqual(modelInvocationExecutionVerdicts, ["allow", "deny"]);
  assert.deepEqual(modelInvocationExecutionStatuses, ["completed", "denied"]);
  for (const value of [
    modelInvocationExecutionVerdicts,
    modelInvocationExecutionStatuses,
    modelInvocationExecutionLimits,
  ]) assert.equal(Object.isFrozen(value), true);
  for (const value of modelInvocationExecutionVerdicts) {
    assert.equal(isModelInvocationExecutionVerdict(value), true);
    assert.equal(parseModelInvocationExecutionVerdict(value), value);
  }
  for (const value of modelInvocationExecutionStatuses) {
    assert.equal(isModelInvocationExecutionStatus(value), true);
    assert.equal(parseModelInvocationExecutionStatus(value), value);
  }
  assert.equal(parseModelInvocationExecutionVerdict("unknown"), null);
  assert.equal(parseModelInvocationExecutionStatus("unknown"), null);
  assert.equal(modelInvocationExecutionLimits.maxProviders, modelProviderRegistryLimits.maxProviders);
  assert.equal(modelInvocationExecutionLimits.maxReasons, modelProviderAdapterLimits.maxReasons);
  assert.equal(modelInvocationExecutionLimits.maxResultDepth, modelInvocationLimits.maxEnvelopeDepth);
});

test("executes a factual AI-021 through AI-024 local Mock Provider end to end", async () => {
  const input = routeInput();
  const provider = mockProvider(input);
  const before = clone(input);
  const decision = await executeModelInvocation(input, [provider]);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.status, "completed");
  assert.equal(decision.routeDecision.verdict, "allow");
  assert.equal(decision.selectedCandidate?.providerId, "provider-mock");
  assert.equal(decision.healthDecision?.normalizedHealth?.status, "healthy");
  assert.equal(decision.providerDecision?.verdict, "allow");
  assert.equal(decision.resultDecision?.verdict, "allow");
  assert.equal(decision.normalizedResult?.outputText, "Deterministic execution output.");
  assert.equal(decision.dataHandlingPermit?.requirement, "local_only");
  assert.deepEqual(decision.dataHandlingPermit?.candidateIdentity, identity());
  assert.equal(deeplyFrozen(decision), true);
  assert.deepEqual(input, before);
});

test("accepts a factual failed provider outcome as a safely evaluated execution", async () => {
  const input = routeInput();
  const provider = mockProvider(input, "provider-mock", "deployment-mock", "healthy", {
    outcome: "failed",
    finishReason: "error",
    outputText: null,
    error: {
      category: "provider_error",
      code: "mock-failure",
      message: "Deterministic provider failure.",
      retryable: false,
    },
  });
  const decision = await executeModelInvocation(input, [provider]);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.normalizedResult?.outcome, "failed");
});

test("route deny has strict precedence and invokes neither health nor run", async () => {
  const input = routeInput({ draftOverrides: { stepId: "missing-step" } });
  const counters = { health: 0, run: 0, tool: 0 };
  const provider = instrument(mockProvider(routeInput()), counters);
  const decision = await executeModelInvocation(input, [provider]);
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["route_denied"]);
  assert.equal(decision.routeDecision.verdict, "deny");
  assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
});

test("invalid route envelope and no eligible route preserve factual AI-023 denial", async () => {
  const invalid = await executeModelInvocation({}, []);
  assertDeny(invalid);
  assert.equal(invalid.routeDecision.verdict, "deny");
  const noRouteInput = routeInput() as any;
  noRouteInput.modelProviderRegistry.providers[0].status = "paused";
  const noRoute = await executeModelInvocation(noRouteInput, []);
  assertDeny(noRoute);
  assert.equal(noRoute.routeDecision.verdict, "deny");
});

for (const dataEgressMode of ["redacted_only", "approved_minimum"]) {
  test(`${dataEgressMode} remote route without a trusted resolver denies before provider health and run`, async () => {
    const input = routeInput({ dataEgressMode, deploymentMode: "remote" });
    const provider = mockProvider(input);
    const counters = { health: 0, run: 0, tool: 0 };
    const decision = await executeModelInvocation(input, [instrument(provider, counters)]);
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["data_handling_evidence_source_unavailable"]);
    assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
  });
}

test("remote redaction uses one least-privilege resolver call and only the AI-027 prepared request", async () => {
  const input = routeInput({
    dataEgressMode: "redacted_only",
    deploymentMode: "remote",
    draftOverrides: {
      messages: [
        { role: "system", content: "Follow bounded instructions.", toolCallId: null },
        { role: "user", content: "Send SECRET_SENTINEL safely.", toolCallId: null },
      ],
      contextArtifactIds: ["artifact-sensitive-sentinel"],
    },
  });
  const counters = { health: 0, run: 0, tool: 0 };
  const before = clone(input);
  let resolverCalls = 0;
  let resolverInput: unknown = null;
  let providerInput: unknown = null;
  const resolver = {
    async resolve(value: unknown) {
      resolverCalls += 1;
      resolverInput = value;
      assert.equal(deeplyFrozen(value), true);
      return redactionEvidence(input);
    },
  };
  const decision = await executeModelInvocation(
    input,
    [directProvider(input, counters, 0, (value) => { providerInput = value; })],
    resolver,
  );

  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(resolverCalls, 1);
  assert.deepEqual(counters, { health: 1, run: 1, tool: 0 });
  assert.equal(deeplyFrozen(providerInput), true);
  const resolverJson = JSON.stringify(resolverInput);
  assert.equal(resolverJson.includes("messages"), true);
  for (const forbidden of [
    "artifact-sensitive-sentinel", "projectRegistry", "modelProviderRegistry",
    "routeInput", "credentials", "endpoint",
  ]) assert.equal(resolverJson.includes(forbidden), false, forbidden);
  const providerJson = JSON.stringify(providerInput);
  assert.equal(providerJson.includes("SECRET_SENTINEL"), false);
  assert.equal(providerJson.includes("[REDACTED:CREDENTIAL]"), true);
  assert.equal(providerJson.includes("artifact-sensitive-sentinel"), false);
  assert.deepEqual((providerInput as { contextArtifactIds: unknown }).contextArtifactIds, []);
  assert.equal(decision.dataHandlingPermit?.requirement, "redaction_required");
  assert.equal(
    decision.dataHandlingPermit?.preparedRequestFingerprint,
    createModelInvocationRequestFingerprint(providerInput),
  );
  const decisionJson = JSON.stringify(decision);
  assert.equal(decisionJson.includes("SECRET_SENTINEL"), false);
  assert.equal(decisionJson.includes("artifact-sensitive-sentinel"), false);
  assert.deepEqual(input, before);
  const repeatedCounters = { health: 0, run: 0, tool: 0 };
  const repeated = await executeModelInvocation(
    input,
    [directProvider(input, repeatedCounters)],
    { async resolve() { return redactionEvidence(input); } },
  );
  assert.deepEqual(repeated, decision);
  assert.notEqual(repeated, decision);
  assert.notEqual(repeated.dataHandlingPermit, decision.dataHandlingPermit);
  assert.equal(deeplyFrozen(repeated), true);
  assert.deepEqual(repeatedCounters, { health: 1, run: 1, tool: 0 });
});

test("remote approval resolver receives no messages and provider receives exact approved messages", async () => {
  const input = routeInput({
    dataEgressMode: "approved_minimum",
    deploymentMode: "remote",
    draftOverrides: {
      messages: [{ role: "user", content: "Approved exact message.", toolCallId: null }],
      contextArtifactIds: ["artifact-approval-sentinel"],
    },
  });
  const facts = routeFacts(input);
  const counters = { health: 0, run: 0, tool: 0 };
  let resolverInput: unknown = null;
  let providerInput: unknown = null;
  const decision = await executeModelInvocation(
    input,
    [directProvider(input, counters, 0, (value) => { providerInput = value; })],
    {
      async resolve(value: unknown) {
        resolverInput = value;
        return approvalEvidence(input);
      },
    },
  );

  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.deepEqual(counters, { health: 1, run: 1, tool: 0 });
  const resolverJson = JSON.stringify(resolverInput);
  for (const forbidden of ["messages", "artifact-approval-sentinel", "routeInput", "credentials"]) {
    assert.equal(resolverJson.includes(forbidden), false, forbidden);
  }
  assert.deepEqual((providerInput as { messages: unknown }).messages, facts.request.messages);
  assert.deepEqual((providerInput as { contextArtifactIds: unknown }).contextArtifactIds, []);
  const providerJson = JSON.stringify(providerInput);
  assert.equal(providerJson.includes("evidence-approval-one"), false);
  assert.equal(providerJson.includes("approval-egress-one"), false);
  assert.equal(decision.dataHandlingPermit?.requirement, "approval_required");
  assert.equal(JSON.stringify(decision).includes("artifact-approval-sentinel"), false);
});

test("resolver failures and invalid candidate-specific evidence deny before health and run", async () => {
  const redactionInput = routeInput({ dataEgressMode: "redacted_only", deploymentMode: "remote" });
  const approvalInput = routeInput({ dataEgressMode: "approved_minimum", deploymentMode: "remote" });
  const redactionFacts = routeFacts(redactionInput);
  const hostileGetter = Object.defineProperty({}, "kind", {
    enumerable: true,
    get() { throw new Error("resolver-getter-sentinel"); },
  });
  const hostileCycle: Record<string, unknown> = {};
  hostileCycle.self = hostileCycle;
  const cases: Array<{ input: unknown; resolve: () => unknown | Promise<unknown> }> = [
    { input: redactionInput, resolve: () => { throw new Error("resolver-error-sentinel"); } },
    { input: redactionInput, resolve: () => null },
    { input: redactionInput, resolve: () => approvalEvidence(approvalInput) },
    { input: redactionInput, resolve: () => redactionEvidence(redactionInput, 0, { sourceRequestFingerprint: `sha256:${"0".repeat(64)}` }) },
    { input: redactionInput, resolve: () => redactionEvidence(redactionInput, 0, { runId: "run-other" }) },
    { input: redactionInput, resolve: () => redactionEvidence(redactionInput, 0, { runRevision: redactionFacts.request.runRevision + 1 }) },
    { input: redactionInput, resolve: () => redactionEvidence(redactionInput, 0, { stepId: "step-other" }) },
    { input: redactionInput, resolve: () => redactionEvidence(redactionInput, 0, { attemptNumber: redactionFacts.request.attemptNumber + 1 }) },
    { input: redactionInput, resolve: () => redactionEvidence(redactionInput, 0, { candidateIdentity: { ...redactionFacts.candidateIdentity, deploymentId: "deployment-other" } }) },
    { input: redactionInput, resolve: () => redactionEvidence(redactionInput, 0, { assessedAt: "2026-08-26T10:15:41.000Z" }) },
    { input: redactionInput, resolve: () => hostileGetter },
    { input: redactionInput, resolve: () => hostileCycle },
    { input: redactionInput, resolve: () => new Set(["resolver-set-sentinel"]) },
    { input: approvalInput, resolve: () => approvalEvidence(approvalInput, 0, { expiresAt: "2026-08-26T10:15:39.999Z" }) },
    { input: approvalInput, resolve: () => approvalEvidence(approvalInput, 0, { status: "revoked", expiresAt: null, reason: "rejected-reason-sentinel" }) },
    { input: approvalInput, resolve: () => approvalEvidence(approvalInput, 0, { status: "rejected", expiresAt: null, reason: "rejected-reason-sentinel" }) },
  ];
  for (const scenario of cases) {
    const counters = { health: 0, run: 0, tool: 0 };
    let resolverCalls = 0;
    const decision = await executeModelInvocation(
      scenario.input,
      [directProvider(scenario.input, counters)],
      { async resolve() { resolverCalls += 1; return scenario.resolve(); } },
    );
    assertDeny(decision);
    assert.equal(resolverCalls, 1);
    assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
    const json = JSON.stringify(decision);
    for (const sentinel of [
      "resolver-error-sentinel", "resolver-getter-sentinel", "resolver-set-sentinel",
      "rejected-reason-sentinel", "deployment-other",
    ]) {
      assert.equal(json.includes(sentinel), false);
    }
  }
});

test("local_only never calls a supplied trusted resolver", async () => {
  const input = routeInput();
  const counters = { health: 0, run: 0, tool: 0 };
  let resolverCalls = 0;
  const decision = await executeModelInvocation(input, [directProvider(input, counters)], {
    async resolve() {
      resolverCalls += 1;
      throw new Error("local resolver must not run");
    },
  });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(resolverCalls, 0);
  assert.deepEqual(counters, { health: 1, run: 1, tool: 0 });
  assert.equal(decision.dataHandlingPermit?.requirement, "local_only");
});

test("resolver dependency rejects accessors, proxies, and unknown fields without invocation", async () => {
  const input = routeInput({ dataEgressMode: "redacted_only", deploymentMode: "remote" });
  const counters = { health: 0, run: 0, tool: 0 };
  let getterReads = 0;
  const accessor = Object.defineProperty({}, "resolve", {
    enumerable: true,
    get() { getterReads += 1; return async () => redactionEvidence(input); },
  });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("resolver-proxy-sentinel"); } });
  const unknown = { async resolve() { throw new Error("must not run"); }, extra: true };
  for (const resolver of [accessor, proxy, unknown]) {
    const decision = await executeModelInvocation(input, [directProvider(input, counters)], resolver);
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["invalid_input"]);
    assert.equal(JSON.stringify(decision).includes("resolver-proxy-sentinel"), false);
  }
  assert.equal(getterReads, 0);
  assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
});

test("caller-supplied evidence, permits, prepared requests, and trusted booleans deny before runtime calls", async () => {
  for (const field of [
    "evidence", "permit", "dataHandlingPermit", "preparedRequest", "routePlan",
    "routeDecision", "dataHandlingDecision", "trusted", "approved", "redacted",
    "requirement", "providerResult",
  ]) {
    const input = { ...executionInput(routeInput()), [field]: "hostile-unknown-sentinel" };
    const decision = await executeModelInvocationContract(input, [], undefined, runtimeContext());
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["invalid_input"]);
    assert.equal(JSON.stringify(decision).includes("hostile-unknown-sentinel"), false);
  }
});

test("caller-controlled time fields are rejected by the exact execution envelope", async () => {
  const input = routeInput();
  for (const field of ["evaluatedAt", "timestamp", "now", "currentTime", "trustedTime"]) {
    let clockCalls = 0;
    const decision = await executeModelInvocationContract(
      { ...executionInput(input), [field]: "2026-08-26T10:15:00.000Z" },
      [mockProvider(input)],
      undefined,
      { now() { clockCalls += 1; return "2026-08-26T10:30:00.000Z"; } },
    );
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["invalid_input"]);
    assert.equal(clockCalls, 0);
  }
});

test("trusted runtime time is captured once and an expired approval cannot be revived", async () => {
  const input = routeInput({ dataEgressMode: "approved_minimum", deploymentMode: "remote" });
  const counters = { health: 0, run: 0, tool: 0 };
  let resolverCalls = 0;
  let clockCalls = 0;
  const trustedRuntime = {
    now() {
      clockCalls += 1;
      return "2026-08-26T10:30:00.000Z";
    },
  };
  const resolver = {
    async resolve() {
      resolverCalls += 1;
      return approvalEvidence(input, 0, { expiresAt: "2026-08-26T10:20:00.000Z" });
    },
  };
  const callerTimeAttempt = await executeModelInvocationContract(
    { ...executionInput(input), evaluatedAt: "2026-08-26T10:15:00.000Z" },
    [directProvider(input, counters)],
    resolver,
    trustedRuntime,
  );
  assertDeny(callerTimeAttempt);
  assert.equal(clockCalls, 0);
  assert.equal(resolverCalls, 0);

  const decision = await executeModelInvocationContract(
    executionInput(input),
    [directProvider(input, counters)],
    resolver,
    trustedRuntime,
  );
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["data_handling_denied"]);
  assert.equal(clockCalls, 1);
  assert.equal(resolverCalls, 1);
  assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
});

test("trusted runtime time is deterministic and is shared with resolver and permit checks", async () => {
  const input = routeInput({ dataEgressMode: "approved_minimum", deploymentMode: "remote" });
  const observedTimes: string[] = [];
  const run = async () => {
    let clockCalls = 0;
    const counters = { health: 0, run: 0, tool: 0 };
    const decision = await executeModelInvocation(
      input,
      [directProvider(input, counters)],
      {
        async resolve(value: any) {
          observedTimes.push(value.evaluatedAt);
          return approvalEvidence(input);
        },
      },
      { now() { clockCalls += 1; return "2026-08-26T10:15:40.000Z"; } },
    );
    assert.equal(clockCalls, 1);
    assert.equal(decision.dataHandlingPermit?.evaluatedAt, "2026-08-26T10:15:40.000Z");
    return decision;
  };
  const first = await run();
  const second = await run();
  assert.deepEqual(second, first);
  assert.deepEqual(observedTimes, [
    "2026-08-26T10:15:40.000Z",
    "2026-08-26T10:15:40.000Z",
  ]);
});

test("trusted runtime context rejects accessors, proxies, unknown fields, throws, and non-canonical time", async () => {
  const input = routeInput();
  let getterReads = 0;
  const accessor = Object.defineProperty({}, "now", {
    enumerable: true,
    get() { getterReads += 1; return () => "2026-08-26T10:15:40.000Z"; },
  });
  const contexts = [
    undefined,
    accessor,
    new Proxy({}, { ownKeys() { throw new Error("clock-proxy-sentinel"); } }),
    { now: () => "2026-08-26T10:15:40.000Z", extra: true },
    { now() { throw new Error("clock-throw-sentinel"); } },
    { now: () => "2026-08-26T10:15:40Z" },
  ];
  for (const trustedRuntime of contexts) {
    const decision = await executeModelInvocationContract(
      executionInput(input),
      [mockProvider(input)],
      undefined,
      trustedRuntime,
    );
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["invalid_input"]);
    const json = JSON.stringify(decision);
    assert.equal(json.includes("clock-proxy-sentinel"), false);
    assert.equal(json.includes("clock-throw-sentinel"), false);
  }
  assert.equal(getterReads, 0);
});

test("provider registry requires a bounded ordinary dense array", async () => {
  const input = routeInput();
  for (const providers of [null, {}, new Set(), Object.setPrototypeOf([], {})]) {
    assertDeny(await executeModelInvocation(input, providers));
  }
  const sparse = Array(2);
  sparse[0] = mockProvider(input);
  assertDeny(await executeModelInvocation(input, sparse));
  const oversized = Array(modelInvocationExecutionLimits.maxProviders + 1).fill(null);
  const limited = await executeModelInvocation(input, oversized);
  assertDeny(limited);
  assert.ok(reasonCodes(limited).includes("limit_exceeded"));
});

test("maximum runtime provider count is accepted and unrelated providers stay isolated", async () => {
  const input = routeInput();
  const exact = mockProvider(input);
  const providers = Array.from(
    { length: modelInvocationExecutionLimits.maxProviders - 1 },
    (_, index) => ({
      identity: identity(`unrelated-${index}`, `unrelated-deployment-${index}`),
      async health() { throw new Error("unrelated health must not run"); },
      async run() { throw new Error("unrelated run must not run"); },
    }),
  );
  providers.push(exact as any);
  const decision = await executeModelInvocation(input, providers.reverse());
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.selectedCandidate?.providerId, "provider-mock");
});

test("empty or missing exact runtime provider fails closed", async () => {
  const input = routeInput();
  const empty = await executeModelInvocation(input, []);
  assertDeny(empty);
  assert.ok(reasonCodes(empty).includes("provider_not_registered"));
  const unrelated = await executeModelInvocation(input, [{
    identity: identity("provider-other", "deployment-other"),
    async health() { return validateAndNormalizeModelProviderHealth(health("provider-other", "deployment-other")); },
    async run() { throw new Error("must not run"); },
  }]);
  assertDeny(unrelated);
});

test("duplicate runtime provider identity is a global deterministic deny", async () => {
  const input = routeInput();
  const provider = mockProvider(input);
  const decision = await executeModelInvocation(input, [provider, provider]);
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["duplicate_provider_identity"]);
});

test("exact pair with provider kind, model, or version mismatch blocks fallback", async () => {
  const input = routeInput({ twoCandidates: true });
  const fallback = mockProvider(input, "provider-b", "deployment-b");
  for (const overrides of [
    { providerKind: "local" },
    { providerModelId: "wrong/model" },
    { providerModelVersion: "wrong-version" },
  ]) {
    const mismatch = {
      identity: { ...identity("provider-a", "deployment-a"), ...overrides },
      async health() { throw new Error("mismatched health must not run"); },
      async run() { throw new Error("mismatched run must not run"); },
    };
    const decision = await executeModelInvocation(input, [fallback, mismatch]);
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["provider_identity_mismatch"]);
  }
});

test("unknown and partially matching caller candidates deny before resolver, health, and run", async () => {
  const input = routeInput({ dataEgressMode: "redacted_only", deploymentMode: "remote" });
  const facts = routeFacts(input);
  for (const candidateIdentity of [
    { ...facts.candidateIdentity, deploymentId: "deployment-unknown-sentinel" },
    { ...facts.candidateIdentity, providerModelVersion: "version-unknown-sentinel" },
  ]) {
    const counters = { health: 0, run: 0, tool: 0 };
    let resolverCalls = 0;
    const decision = await executeModelInvocationContract(
      executionInput(input, candidateIdentity),
      [directProvider(input, counters)],
      { async resolve() { resolverCalls += 1; return redactionEvidence(input); } },
      runtimeContext(),
    );
    assertDeny(decision);
    assert.equal(resolverCalls, 0);
    assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
    assert.equal(JSON.stringify(decision).includes("unknown-sentinel"), false);
  }
});

test("exact fallback identity and fallback-specific evidence cannot select a fallback", async () => {
  const input = routeInput({
    dataEgressMode: "redacted_only",
    deploymentMode: "remote",
    twoCandidates: true,
  });
  const fallback = routeFacts(input, 1);
  const counters = { health: 0, run: 0, tool: 0 };
  let resolverCalls = 0;
  const decision = await executeModelInvocationContract(
    executionInput(input, fallback.candidateIdentity),
    [directProvider(input, counters, 1)],
    { async resolve() { resolverCalls += 1; return redactionEvidence(input, 1); } },
    runtimeContext(),
  );
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["provider_not_registered"]);
  assert.equal(resolverCalls, 0);
  assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
});

test("provider objects reject inherited fields, accessors, proxies, and revoked proxies", async () => {
  const input = routeInput();
  const inherited = Object.create(mockProvider(input));
  const accessor = { run: async () => null, health: async () => null } as Record<string, unknown>;
  let reads = 0;
  Object.defineProperty(accessor, "identity", {
    enumerable: true,
    get() { reads += 1; return identity(); },
  });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const provider of [inherited, accessor, proxy, revoked.proxy]) {
    const decision = await executeModelInvocation(input, [provider]);
    assertDeny(decision);
    assert.ok(reasonCodes(decision).includes("invalid_provider_registry"));
  }
  assert.equal(reads, 0);
});

test("captured mutable identity cannot create an async TOCTOU substitution", async () => {
  const input = routeInput();
  const base = mockProvider(input);
  const mutableIdentity = clone(base.identity) as any;
  const provider = {
    identity: mutableIdentity,
    async health() {
      mutableIdentity.providerId = "provider-substituted";
      return base.health();
    },
    async run(request: unknown) {
      return base.run(request);
    },
  };
  const decision = await executeModelInvocation(input, [provider]);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.selectedCandidate?.providerId, "provider-mock");
  assert.equal(mutableIdentity.providerId, "provider-substituted");
});

test("healthy and degraded primary candidates preserve canonical priority", async () => {
  for (const status of ["healthy", "degraded"]) {
    const input = routeInput({ twoCandidates: true });
    const primary = mockProvider(input, "provider-a", "deployment-a", status);
    const fallback = mockProvider(input, "provider-b", "deployment-b");
    const countersA = { health: 0, run: 0, tool: 0 };
    const countersB = { health: 0, run: 0, tool: 0 };
    const decision = await executeModelInvocation(input, [
      instrument(fallback, countersB),
      instrument(primary, countersA),
    ]);
    assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
    assert.equal(decision.selectedCandidate?.providerId, "provider-a");
    assert.deepEqual(countersA, { health: 1, run: 1, tool: 0 });
    assert.deepEqual(countersB, { health: 0, run: 0, tool: 0 });
  }
});

test("unavailable or missing exact candidate denies without automatic fallback", async () => {
  const input = routeInput({ twoCandidates: true });
  const unavailable = mockProvider(input, "provider-a", "deployment-a", "unavailable");
  const fallback = mockProvider(input, "provider-b", "deployment-b");
  const fallbackCounters = { health: 0, run: 0, tool: 0 };
  const first = await executeModelInvocation(input, [
    unavailable,
    instrument(fallback, fallbackCounters),
  ]);
  assertDeny(first);
  assert.deepEqual(reasonCodes(first), ["provider_unavailable"]);
  const missing = await executeModelInvocation(input, [instrument(fallback, fallbackCounters)]);
  assertDeny(missing);
  assert.deepEqual(reasonCodes(missing), ["provider_not_registered"]);
  assert.deepEqual(fallbackCounters, { health: 0, run: 0, tool: 0 });
});

test("throwing, rejected, and malformed health deny without fallback or run", async () => {
  for (const healthBehavior of [
    () => { throw new Error("health throw"); },
    () => Promise.reject(new Error("health reject")),
    () => ({ malformed: true }),
  ]) {
    const input = routeInput({ twoCandidates: true });
    const primary = mockProvider(input, "provider-a", "deployment-a");
    const fallback = mockProvider(input, "provider-b", "deployment-b");
    const counters = { health: 0, run: 0, tool: 0 };
    const decision = await executeModelInvocation(input, [
      instrument(primary, counters, { health: healthBehavior }),
      fallback,
    ]);
    assertDeny(decision);
    assert.equal(counters.run, 0);
  }
});

test("health identity mismatch is a configuration deny and cannot be hidden by fallback", async () => {
  const input = routeInput({ twoCandidates: true });
  const primary = mockProvider(input, "provider-a", "deployment-a");
  const fallback = mockProvider(input, "provider-b", "deployment-b");
  const mismatchedHealth = validateAndNormalizeModelProviderHealth(
    health("provider-other", "deployment-a"),
  );
  const decision = await executeModelInvocation(input, [
    instrument(primary, { health: 0, run: 0, tool: 0 }, { health: () => mismatchedHealth }),
    fallback,
  ]);
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["invalid_health_decision"]);
});

test("an unavailable exact candidate does not inspect or run fallback", async () => {
  const input = routeInput({ twoCandidates: true });
  const countersA = { health: 0, run: 0, tool: 0 };
  const countersB = { health: 0, run: 0, tool: 0 };
  const decision = await executeModelInvocation(input, [
    instrument(mockProvider(input, "provider-a", "deployment-a", "unavailable"), countersA),
    instrument(mockProvider(input, "provider-b", "deployment-b", "unavailable"), countersB),
  ]);
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["provider_unavailable"]);
  assert.deepEqual(countersA, { health: 1, run: 0, tool: 0 });
  assert.deepEqual(countersB, { health: 0, run: 0, tool: 0 });
});

test("provider run is invoked exactly once with only the factual normalized request", async () => {
  const input = routeInput();
  const base = mockProvider(input);
  const expected = factualRequest(input);
  const counters = { health: 0, run: 0, tool: 0 };
  let observed: unknown = null;
  const provider = instrument(base, counters, {
    run: async (request) => {
      observed = request;
      return base.run(request);
    },
  });
  const decision = await executeModelInvocation(input, [provider]);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.deepEqual(observed, expected);
  assert.notEqual(observed, input);
  assert.deepEqual(counters, { health: 1, run: 1, tool: 0 });
});

test("provider run deny is preserved safely with no fallback, retry, or partial result", async () => {
  const input = routeInput({ twoCandidates: true });
  const primary = mockProvider(input, "provider-a", "deployment-a");
  const fallback = mockProvider(input, "provider-b", "deployment-b");
  const primaryCounters = { health: 0, run: 0, tool: 0 };
  const fallbackCounters = { health: 0, run: 0, tool: 0 };
  const decision = await executeModelInvocation(input, [
    instrument(primary, primaryCounters, {
      run: (request) => ({
        verdict: "deny",
        reasons: [{
          code: "script_not_found",
          path: "$.invocationId",
          message: "No deterministic script.",
          providerId: "provider-a",
          deploymentId: "deployment-a",
          invocationId: factualRequest(input).invocationId,
        }],
        requestDecision: validateAndNormalizeModelInvocationRequest(request),
        resultDecision: null,
        normalizedResult: null,
      }),
    }),
    instrument(fallback, fallbackCounters),
  ]);
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["provider_run_denied"]);
  assert.equal(decision.providerDecision?.verdict, "deny");
  assert.equal(primaryCounters.run, 1);
  assert.equal(fallbackCounters.health + fallbackCounters.run, 0);
});

test("provider throw and rejected Promise deny deterministically without fallback", async () => {
  for (const behavior of [
    () => { throw new Error("run throw"); },
    () => Promise.reject(new Error("run reject")),
  ]) {
    const input = routeInput({ twoCandidates: true });
    const primary = mockProvider(input, "provider-a", "deployment-a");
    const fallback = mockProvider(input, "provider-b", "deployment-b");
    const fallbackCounters = { health: 0, run: 0, tool: 0 };
    const decision = await executeModelInvocation(input, [
      instrument(primary, { health: 0, run: 0, tool: 0 }, { run: behavior }),
      instrument(fallback, fallbackCounters),
    ]);
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["provider_exception"]);
    assert.equal(fallbackCounters.health + fallbackCounters.run, 0);
  }
});

test("malformed and hostile provider decisions deny without exception", async () => {
  const input = routeInput();
  const base = mockProvider(input);
  const hostile = Object.defineProperty({}, "verdict", {
    enumerable: true,
    get() { throw new Error("decision getter"); },
  });
  const cycle: any = {};
  cycle.self = cycle;
  for (const returned of [{}, hostile, cycle, new Set()]) {
    const decision = await executeModelInvocation(input, [
      instrument(base, { health: 0, run: 0, tool: 0 }, { run: () => returned }),
    ]);
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["invalid_provider_decision"]);
  }
});

test("provider requestDecision must exactly match the factual AI-023 request", async () => {
  const input = routeInput();
  const base = mockProvider(input);
  const request = factualRequest(input);
  const providerResult = result(request);
  const providerResultDecision = validateAndNormalizeModelInvocationResult(providerResult);
  const changedRequest = { ...request, invocationId: "invocation-other" };
  const decision = await executeModelInvocation(input, [
    instrument(base, { health: 0, run: 0, tool: 0 }, {
      run: () => ({
        verdict: "allow",
        reasons: [],
        requestDecision: validateAndNormalizeModelInvocationRequest(changedRequest),
        resultDecision: providerResultDecision,
        normalizedResult: providerResult,
      }),
    }),
  ]);
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["invalid_provider_decision"]);
});

test("resultDecision and normalizedResult must be exact factual matches", async () => {
  const input = routeInput();
  const base = mockProvider(input);
  const request = factualRequest(input);
  const firstResult = result(request);
  const secondResult = result(request, "provider-mock", { outputText: "Changed output." });
  const requestDecision = validateAndNormalizeModelInvocationRequest(request);
  for (const returned of [
    {
      verdict: "allow",
      reasons: [],
      requestDecision,
      resultDecision: validateAndNormalizeModelInvocationResult(secondResult),
      normalizedResult: firstResult,
    },
    {
      verdict: "allow",
      reasons: [],
      requestDecision,
      resultDecision: null,
      normalizedResult: firstResult,
    },
  ]) {
    const decision = await executeModelInvocation(input, [
      instrument(base, { health: 0, run: 0, tool: 0 }, { run: () => returned }),
    ]);
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["invalid_provider_decision"]);
  }
});

test("result invocation and provider/model/version identities are rechecked", async () => {
  const input = routeInput();
  const base = mockProvider(input);
  const request = factualRequest(input);
  for (const overrides of [
    { invocationId: "invocation-other" },
    { providerId: "provider-other" },
    { providerModelId: "other/model" },
    { providerModelVersion: "other-version" },
  ]) {
    const candidateResult = result(request, "provider-mock", overrides);
    const returned = {
      verdict: "allow",
      reasons: [],
      requestDecision: validateAndNormalizeModelInvocationRequest(request),
      resultDecision: validateAndNormalizeModelInvocationResult(candidateResult),
      normalizedResult: candidateResult,
    };
    const decision = await executeModelInvocation(input, [
      instrument(base, { health: 0, run: 0, tool: 0 }, { run: () => returned }),
    ]);
    assertDeny(decision);
  }
});

test("forbidden tool proposal is rejected by factual AI-022 result evaluation and never executed", async () => {
  const input = routeInput();
  const base = mockProvider(input);
  const request = factualRequest(input);
  const proposed = result(request, "provider-mock", {
    finishReason: "tool_calls",
    outputText: null,
    toolCallProposals: [{ toolCallId: "call-one", toolId: "tool-write", arguments: {} }],
  });
  const counters = { health: 0, run: 0, tool: 0 };
  const returned = {
    verdict: "allow",
    reasons: [],
    requestDecision: validateAndNormalizeModelInvocationRequest(request),
    resultDecision: validateAndNormalizeModelInvocationResult(proposed),
    normalizedResult: proposed,
  };
  const decision = await executeModelInvocation(input, [
    instrument(base, counters, { run: () => returned }),
  ]);
  assertDeny(decision);
  assert.deepEqual(reasonCodes(decision), ["result_evaluation_denied"]);
  assert.equal(decision.resultDecision?.verdict, "deny");
  assert.equal(counters.tool, 0);
});

test("stale Workflow Run and admission deny before runtime provider calls", async () => {
  const input = routeInput() as any;
  const snapshot = input.invocationAdmission.snapshot;
  input.invocationAdmission.snapshot = apply(snapshot, "step_succeeded", 5, {
    stepId: "execute-one",
    outputArtifactIds: ["artifact-output"],
  });
  const counters = { health: 0, run: 0, tool: 0 };
  const provider = instrument(mockProvider(routeInput()), counters);
  const decision = await executeModelInvocation(input, [provider]);
  assertDeny(decision);
  assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
});

test("deferred health cannot create caller-input TOCTOU substitution", async () => {
  const input = routeInput({
    draftOverrides: {
      messages: [{ role: "user", content: "Original factual message.", toolCallId: null }],
      contextArtifactIds: ["artifact-original"],
    },
  }) as any;
  const facts = routeFacts(input);
  let releaseHealth: (value: unknown) => void = () => {
    throw new Error("Deferred health was not initialized.");
  };
  const healthPending = new Promise<unknown>((resolve) => { releaseHealth = resolve; });
  let observedRequest: unknown = null;
  const provider = {
    identity: facts.candidateIdentity,
    async health() { return healthPending; },
    async run(value: unknown) {
      observedRequest = value;
      const requestDecision = validateAndNormalizeModelInvocationRequest(value);
      assert.ok(requestDecision.normalizedRequest);
      const normalizedResult = result(requestDecision.normalizedRequest);
      return {
        verdict: "allow",
        reasons: [],
        requestDecision,
        resultDecision: validateAndNormalizeModelInvocationResult(normalizedResult),
        normalizedResult,
      };
    },
  };
  const pending = executeModelInvocation(input, [provider]);
  input.invocationAdmission.draft.messages[0].content = "Mutated caller sentinel.";
  input.invocationAdmission.draft.contextArtifactIds[0] = "artifact-mutated";
  releaseHealth(validateAndNormalizeModelProviderHealth(health()));
  const decision = await pending;

  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal((observedRequest as any).messages[0].content, "Original factual message.");
  assert.deepEqual((observedRequest as any).contextArtifactIds, ["artifact-original"]);
  assert.equal(deeplyFrozen(observedRequest), true);
  const json = JSON.stringify(decision);
  assert.equal(json.includes("Mutated caller sentinel"), false);
  assert.equal(json.includes("artifact-mutated"), false);
});

test("repeated and reverse-provider executions are deterministic, fresh, frozen, and immutable", async () => {
  const input = routeInput();
  const provider = mockProvider(input);
  const unrelated = {
    identity: identity("provider-other", "deployment-other"),
    async health() { throw new Error("unrelated"); },
    async run() { throw new Error("unrelated"); },
  };
  const before = clone(input);
  const first = await executeModelInvocation(input, [unrelated, provider]);
  const second = await executeModelInvocation(input, [provider, unrelated]);
  assert.equal(first.verdict, "allow", JSON.stringify(first.reasons));
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.routeDecision, second.routeDecision);
  assert.notEqual(first.normalizedResult, second.normalizedResult);
  assert.equal(deeplyFrozen(first), true);
  assert.deepEqual(input, before);
  const previous = clone(first);
  await executeModelInvocation(input, [provider]);
  assert.deepEqual(first, previous);
});

test("every execution deny is fail closed", async () => {
  const input = routeInput();
  const cases = [
    executeModelInvocation({}, []),
    executeModelInvocation(input, null),
    executeModelInvocation(input, []),
  ];
  for (const pending of cases) assertDeny(await pending);
});

test("real AI-026 adapter composes through redaction and an injected fake client without network", async () => {
  const input = routeInput({
    dataEgressMode: "redacted_only",
    deploymentMode: "remote",
    toolIds: [],
    draftOverrides: {
      messages: [{ role: "user", content: "Send SECRET_SENTINEL safely.", toolCallId: null }],
      contextArtifactIds: ["artifact-openai-sentinel"],
    },
  }) as any;
  input.modelProviderRegistry.providers[0].id = "provider-openai";
  input.modelProviderRegistry.providers[0].kind = "openai";
  input.modelProviderRegistry.deployments[0].id = "deployment-openai";
  input.modelProviderRegistry.deployments[0].providerId = "provider-openai";
  input.modelProviderRegistry.deployments[0].providerModelId = "gpt-test-alias";
  input.modelProviderRegistry.deployments[0].providerModelVersion = "gpt-test-version";
  for (const profile of input.modelProviderRegistry.modelProfiles) {
    profile.candidates[0].deploymentId = "deployment-openai";
  }
  const facts = routeFacts(input);
  const responseRequests: unknown[] = [];
  const retrievedModels: string[] = [];
  const times = [10, 11, 20, 21];
  const factory = createOpenAIModelProvider({
    identity: facts.candidateIdentity,
    timeoutMs: 5_000,
    maxInputTokens: 128_000,
    maxOutputTokens: 16_000,
    inputCostUsdMicrosPerMillionTokens: 1_000_000,
    outputCostUsdMicrosPerMillionTokens: 2_000_000,
  }, { apiKey: "fake-test-key" }, {
    createClient() {
      return {
        responses: {
          async create(value) {
            responseRequests.push(clone(value));
            return {
              model: "gpt-test-version",
              status: "completed",
              error: null,
              incomplete_details: null,
              output: [{
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "Safe fake OpenAI output." }],
              }],
              usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            };
          },
        },
        models: {
          async retrieve(model) {
            retrievedModels.push(model);
            return { id: model };
          },
        },
      };
    },
    monotonicNow: () => times.shift() ?? 30,
    observedAt: () => "2026-08-26T10:15:40.000Z",
  });
  assert.equal(factory.verdict, "allow", JSON.stringify(factory.reasons));
  assert.ok(factory.provider);

  const decision = await executeModelInvocation(
    input,
    [factory.provider],
    { async resolve() { return redactionEvidence(input); } },
  );

  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.normalizedResult?.outputText, "Safe fake OpenAI output.");
  assert.equal(responseRequests.length, 1);
  assert.deepEqual(retrievedModels, ["gpt-test-alias"]);
  const clientJson = JSON.stringify(responseRequests[0]);
  assert.equal(clientJson.includes("SECRET_SENTINEL"), false);
  assert.equal(clientJson.includes("[REDACTED:CREDENTIAL]"), true);
  assert.equal(clientJson.includes("artifact-openai-sentinel"), false);
  assert.equal(clientJson.includes("fake-test-key"), false);
});

test("production source has one provider, resolver, and trusted-clock call site with primary-only authority", () => {
  const source = readFileSync(
    new URL("../lib/contracts/model-invocation-execution.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/captured\.health\(/gu) ?? []).length, 1);
  assert.equal((source.match(/captured\.run\(/gu) ?? []).length, 1);
  assert.equal((source.match(/capturedResolver\.resolve\(/gu) ?? []).length, 1);
  assert.equal((source.match(/capturedRuntimeContext\.now\(/gu) ?? []).length, 1);
  assert.equal(source.includes("plan." + "fallbacks"), false);
  assert.match(source, /evaluateModelInvocationDataHandling/u);
  assert.match(source, /createModelInvocationRequestFingerprint/u);
  for (const token of [
    "JSON" + ".stringify",
    "locale" + "Compare",
    "Date" + ".now",
    "Math" + ".random",
    "set" + "Timeout",
    "set" + "Interval",
    "fet" + "ch(",
    "process" + ".env",
    "node:" + "fs",
    "child_" + "process",
    "Open" + "AI",
    "Anth" + "ropic",
    "Deep" + "Seek",
    "Q" + "wen",
    "evaluateWorkflowRunTransition",
    ".execute(",
  ]) assert.equal(source.includes(token), false, token);
});
