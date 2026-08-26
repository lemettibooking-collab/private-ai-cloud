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
const runContract = (await import(
  new URL("../lib/contracts/workflow-run.ts", import.meta.url).href
)) as typeof import("../lib/contracts/workflow-run");

const {
  executeModelInvocation,
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

function agent() {
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
    allowedToolIds: ["tool-read"],
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

function workflow() {
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
      toolIds: ["tool-read"],
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

function creation(dataEgressMode = "forbidden") {
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
      agents: [{ bindingId: "agent-binding-one", agentManifest: agent() }],
      workflows: [{ bindingId: "workflow-binding-one", workflowManifest: workflow() }],
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

function runningSnapshot(dataEgressMode = "forbidden") {
  const created = createWorkflowRunSnapshot(creation(dataEgressMode));
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
      snapshot: runningSnapshot(dataEgressMode),
      draft: draft(options.draftOverrides),
      existingRequests: [],
    },
  };
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
  test(`${dataEgressMode} remote route denies before provider health and run`, async () => {
    const input = routeInput({ dataEgressMode, deploymentMode: "remote" });
    const provider = mockProvider(input);
    const counters = { health: 0, run: 0, tool: 0 };
    const decision = await executeModelInvocation(input, [instrument(provider, counters)]);
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["data_handling_not_executable"]);
    assert.deepEqual(counters, { health: 0, run: 0, tool: 0 });
  });
}

test("caller-supplied approval or redaction claims are rejected by factual routing", async () => {
  for (const field of ["approved", "redacted"]) {
    const input = { ...routeInput(), [field]: true };
    const decision = await executeModelInvocation(input, []);
    assertDeny(decision);
    assert.deepEqual(reasonCodes(decision), ["route_denied"]);
  }
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

test("unavailable or missing primary falls back to the next healthy candidate", async () => {
  const input = routeInput({ twoCandidates: true });
  const unavailable = mockProvider(input, "provider-a", "deployment-a", "unavailable");
  const fallback = mockProvider(input, "provider-b", "deployment-b");
  const first = await executeModelInvocation(input, [unavailable, fallback]);
  assert.equal(first.verdict, "allow", JSON.stringify(first.reasons));
  assert.equal(first.selectedCandidate?.providerId, "provider-b");
  const missing = await executeModelInvocation(input, [fallback]);
  assert.equal(missing.verdict, "allow", JSON.stringify(missing.reasons));
  assert.equal(missing.selectedCandidate?.providerId, "provider-b");
});

test("throwing, rejected, and malformed health can fall back without running primary", async () => {
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
    assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
    assert.equal(decision.selectedCandidate?.providerId, "provider-b");
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

test("all unavailable candidates deny and no provider run starts", async () => {
  const input = routeInput({ twoCandidates: true });
  const countersA = { health: 0, run: 0, tool: 0 };
  const countersB = { health: 0, run: 0, tool: 0 };
  const decision = await executeModelInvocation(input, [
    instrument(mockProvider(input, "provider-a", "deployment-a", "unavailable"), countersA),
    instrument(mockProvider(input, "provider-b", "deployment-b", "unavailable"), countersB),
  ]);
  assertDeny(decision);
  assert.ok(reasonCodes(decision).includes("provider_unavailable"));
  assert.ok(reasonCodes(decision).includes("no_available_provider"));
  assert.equal(countersA.run + countersB.run, 0);
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

test("production source has one provider run call and no side-effect mechanisms", () => {
  const source = readFileSync(
    new URL("../lib/contracts/model-invocation-execution.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/captured\.run\(/gu) ?? []).length, 1);
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
