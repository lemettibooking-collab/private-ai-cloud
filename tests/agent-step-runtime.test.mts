import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial runtime fixtures cross unknown boundaries */

const runtimeContract = (await import(
  new URL("../lib/workflows/agent-step-runtime.ts", import.meta.url).href
)) as typeof import("../lib/workflows/agent-step-runtime");
const runContract = (await import(
  new URL("../lib/contracts/workflow-run.ts", import.meta.url).href
)) as typeof import("../lib/contracts/workflow-run");
const routeContract = (await import(
  new URL("../lib/contracts/model-provider-registry.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-provider-registry");
const invocationContract = (await import(
  new URL("../lib/contracts/model-invocation.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-invocation");
const adapterContract = (await import(
  new URL("../lib/contracts/model-provider-adapter.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-provider-adapter");

const {
  agentStepRuntimeLimits,
  agentStepRuntimeStatuses,
  agentStepRuntimeVerdicts,
  executeAgentStep,
  isAgentStepRuntimeStatus,
  isAgentStepRuntimeVerdict,
  parseAgentStepRuntimeStatus,
  parseAgentStepRuntimeVerdict,
} = runtimeContract;
const { createWorkflowRunSnapshot, evaluateWorkflowRunTransition } = runContract;
const { resolveModelInvocationRoute } = routeContract;
const {
  validateAndNormalizeModelInvocationRequest,
  validateAndNormalizeModelInvocationResult,
} = invocationContract;
const { validateAndNormalizeModelProviderHealth } = adapterContract;

type Counters = {
  facts: number;
  requirements: number;
  evidence: number;
  clock: number;
  health: number;
  run: number;
};

type RuntimeFacts = {
  snapshot: any;
  projectRegistry: any;
  modelProviderRegistry: any;
  existingRequests: any[];
};

const factsByInput = new WeakMap<object, RuntimeFacts>();

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
  const transition = evaluateWorkflowRunTransition({
    snapshot,
    event: {
      eventId: `fixture-event-${index}`,
      runId: snapshot.runId,
      kind,
      sequence: snapshot.revision + 1,
      occurredAt: `2026-08-26T10:15:${30 + index}.000Z`,
      actorKind: "owner",
      actorId: "owner-one",
      ...extra,
    },
  });
  assert.equal(transition.verdict, "allow", JSON.stringify(transition.reasons));
  assert.ok(transition.nextSnapshot);
  return transition.nextSnapshot;
}

function snapshotAt(stage: "dependency_incomplete" | "ready" | "running" | "success" = "ready", dataEgressMode = "forbidden") {
  const created = createWorkflowRunSnapshot(creation(dataEgressMode));
  assert.equal(created.verdict, "allow", JSON.stringify(created.reasons));
  assert.ok(created.snapshot);
  let snapshot = apply(created.snapshot, "run_started", 1);
  if (stage === "dependency_incomplete") return snapshot;
  snapshot = apply(snapshot, "approval_requested", 2, {
    stepId: "approve-one",
    approvalRequestId: "approval-one",
  });
  snapshot = apply(snapshot, "approval_granted", 3, {
    stepId: "approve-one",
    approvalRequestId: "approval-one",
  });
  if (stage === "ready") return snapshot;
  snapshot = apply(snapshot, "step_started", 4, { stepId: "execute-one" });
  if (stage === "running") return snapshot;
  return apply(snapshot, "step_succeeded", 5, { stepId: "execute-one", outputArtifactIds: [] });
}

function retryReadySnapshot() {
  return apply(snapshotAt("running"), "step_failed", 5, {
    stepId: "execute-one",
    error: { code: "retryable_failure", message: "Retryable failure.", retryable: true },
  });
}

function registryProvider(providerId: string, deploymentMode: "local" | "remote", dataEgressMode: string) {
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
    modelProfiles: [{
      modelProfileId: "model-shared",
      status: "active",
      requiredCapabilities: ["messages", "tool_calls"],
      supportedOutputTypes: ["patch", "test_report"],
      candidates: specs.map(([, deploymentId], index) => ({ deploymentId, priority: index + 1 })),
    }, {
      modelProfileId: "model-one",
      status: "active",
      requiredCapabilities: ["messages"],
      supportedOutputTypes: ["patch", "test_report"],
      candidates: [{ deploymentId: specs[0][1], priority: 1 }],
    }],
  };
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

function runtimeInput(options: {
  dataEgressMode?: string;
  deploymentMode?: "local" | "remote";
  twoCandidates?: boolean;
  snapshot?: any;
  draftOverrides?: Record<string, unknown>;
} = {}) {
  const dataEgressMode = options.dataEgressMode ?? "forbidden";
  const snapshot = options.snapshot ?? snapshotAt("ready", dataEgressMode);
  const input = {
    runId: snapshot.runId,
    stepId: "execute-one",
    executionId: "runtime-one",
    expectedRevision: snapshot.revision,
    expectedAttemptNumber: 1,
    invocationDraft: draft(options.draftOverrides),
  };
  factsByInput.set(input, {
    snapshot,
    projectRegistry: projectRegistry(dataEgressMode),
    modelProviderRegistry: providerRegistry({
      dataEgressMode,
      deploymentMode: options.deploymentMode,
      twoCandidates: options.twoCandidates,
    }),
    existingRequests: [],
  });
  return input;
}

function runtimeFacts(input: object): RuntimeFacts {
  const facts = factsByInput.get(input);
  assert.ok(facts, "runtime facts fixture must exist");
  return facts;
}

function changedInput(
  input: ReturnType<typeof runtimeInput>,
  changes: Record<string, unknown>,
): ReturnType<typeof runtimeInput> {
  const changed = { ...input, ...changes } as ReturnType<typeof runtimeInput>;
  factsByInput.set(changed, runtimeFacts(input));
  return changed;
}

function capability(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function expectedRoute(input: ReturnType<typeof runtimeInput>) {
  const facts = runtimeFacts(input);
  const start = evaluateWorkflowRunTransition({
    snapshot: facts.snapshot,
    event: {
      eventId: `${input.executionId}.start`,
      runId: facts.snapshot.runId,
      kind: "step_started",
      sequence: facts.snapshot.revision + 1,
      occurredAt: "2026-08-26T10:15:40.000Z",
      actorKind: "system",
      actorId: "agent-step-runtime",
      stepId: input.stepId,
    },
  });
  assert.equal(start.verdict, "allow", JSON.stringify(start.reasons));
  assert.ok(start.nextSnapshot);
  const routeInput = {
    projectRegistry: facts.projectRegistry,
    modelProviderRegistry: facts.modelProviderRegistry,
    invocationAdmission: {
      snapshot: start.nextSnapshot,
      draft: input.invocationDraft,
      existingRequests: facts.existingRequests,
    },
  };
  const route = resolveModelInvocationRoute(routeInput);
  assert.equal(route.verdict, "allow", JSON.stringify(route.reasons));
  assert.ok(route.routePlan?.primary && route.invocationAdmissionDecision?.normalizedRequest);
  return { route, request: route.invocationAdmissionDecision.normalizedRequest };
}

function result(request: any, providerId: string, overrides: Record<string, unknown> = {}) {
  return {
    invocationId: request.invocationId,
    outcome: "succeeded",
    finishReason: "stop",
    providerId,
    providerModelId: `${providerId}/model:v1`,
    providerModelVersion: "version-1",
    outputText: "Deterministic Agent Step output.",
    structuredOutput: null,
    toolCallProposals: [],
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    latencyMs: 5,
    costUsdMicros: 0,
    error: null,
    ...overrides,
  };
}

function provider(
  input: ReturnType<typeof runtimeInput>,
  counters: Counters,
  candidateIndex = 0,
  options: {
    healthStatus?: string;
    throwHealth?: boolean;
    throwRun?: boolean;
    resultOverrides?: Record<string, unknown>;
    observe?: (value: unknown) => void;
  } = {},
) {
  const facts = expectedRoute(input);
  const candidates = [facts.route.routePlan!.primary, ...facts.route.routePlan!.fallbacks];
  const selected = candidates[candidateIndex]!;
  const identity = {
    providerId: selected.providerId,
    providerKind: selected.providerKind,
    deploymentId: selected.deploymentId,
    providerModelId: selected.providerModelId,
    providerModelVersion: selected.providerModelVersion,
  };
  return {
    identity,
    async health() {
      counters.health += 1;
      if (options.throwHealth) throw new Error("health-hostile-sentinel");
      return validateAndNormalizeModelProviderHealth({
        providerId: selected.providerId,
        deploymentId: selected.deploymentId,
        status: options.healthStatus ?? "healthy",
        observedAt: "2026-08-26T10:15:40.000Z",
        latencyMs: 1,
        detailCode: null,
      });
    },
    async run(value: unknown) {
      counters.run += 1;
      options.observe?.(value);
      if (options.throwRun) throw new Error("run-hostile-sentinel");
      const requestDecision = validateAndNormalizeModelInvocationRequest(value);
      assert.ok(requestDecision.normalizedRequest);
      const normalizedResult = result(
        requestDecision.normalizedRequest,
        selected.providerId,
        options.resultOverrides,
      );
      const resultDecision = validateAndNormalizeModelInvocationResult(normalizedResult);
      return { verdict: "allow", reasons: [], requestDecision, resultDecision, normalizedResult };
    },
  };
}

function dependencies(
  input: ReturnType<typeof runtimeInput>,
  counters: Counters,
  requirementOverrides: Record<string, unknown> = {},
  factsOverride?: unknown,
) {
  return {
    factsResolver: {
      async resolve(value: unknown) {
        counters.facts += 1;
        assert.equal(deeplyFrozen(value), true);
        assert.deepEqual(value, { runId: input.runId, stepId: input.stepId });
        return factsOverride ?? runtimeFacts(input);
      },
    },
    requirementsResolver: {
      async resolve(value: unknown) {
        counters.requirements += 1;
        assert.equal(deeplyFrozen(value), true);
        return capability(requirementOverrides);
      },
    },
    runtimeContext: {
      now() {
        counters.clock += 1;
        return "2026-08-26T10:15:40.000Z";
      },
    },
  };
}

async function execute(
  input: ReturnType<typeof runtimeInput>,
  providers: unknown,
  counters: Counters,
  requirementOverrides: Record<string, unknown> = {},
  evidenceResolver?: unknown,
) {
  const trusted = dependencies(input, counters, requirementOverrides);
  return executeAgentStep(
    input,
    trusted.factsResolver,
    providers,
    trusted.requirementsResolver,
    evidenceResolver,
    trusted.runtimeContext,
  );
}

function freshCounters(): Counters {
  return { facts: 0, requirements: 0, evidence: 0, clock: 0, health: 0, run: 0 };
}

function assertNoRuntimeCalls(counters: Counters) {
  assert.equal(counters.clock, 0);
  assert.equal(counters.health, 0);
  assert.equal(counters.run, 0);
  assert.equal(counters.evidence, 0);
}

test("exports exact frozen runtime enums, guards, parsers, and limits", () => {
  assert.deepEqual(agentStepRuntimeVerdicts, ["allow", "deny"]);
  assert.deepEqual(agentStepRuntimeStatuses, [
    "completed", "denied", "failed", "approval_required", "unsupported_runtime",
    "recovery_required",
  ]);
  assert.equal(Object.isFrozen(agentStepRuntimeVerdicts), true);
  assert.equal(Object.isFrozen(agentStepRuntimeStatuses), true);
  assert.equal(Object.isFrozen(agentStepRuntimeLimits), true);
  for (const value of agentStepRuntimeVerdicts) {
    assert.equal(isAgentStepRuntimeVerdict(value), true);
    assert.equal(parseAgentStepRuntimeVerdict(value), value);
  }
  for (const value of agentStepRuntimeStatuses) {
    assert.equal(isAgentStepRuntimeStatus(value), true);
    assert.equal(parseAgentStepRuntimeStatus(value), value);
  }
  assert.equal(parseAgentStepRuntimeVerdict("unknown"), null);
  assert.equal(parseAgentStepRuntimeStatus("running"), null);
});

test("untrusted envelope rejects all factual state and configuration fields before resolution", async () => {
  const factualValues = {
    snapshot: snapshotAt(),
    projectRegistry: projectRegistry(),
    modelProviderRegistry: providerRegistry(),
    existingRequests: [],
  };
  for (const [field, factualValue] of Object.entries(factualValues)) {
    const base = runtimeInput();
    const input = changedInput(base, { [field]: factualValue });
    const counters = freshCounters();
    const trusted = dependencies(input, counters);
    const decision = await executeAgentStep(
      input,
      trusted.factsResolver,
      [],
      trusted.requirementsResolver,
      undefined,
      trusted.runtimeContext,
    );
    assert.equal(decision.verdict, "deny", field);
    assert.equal(decision.reasons[0]?.code, "invalid_input", field);
    assert.equal(counters.facts, 0, field);
    assert.equal(counters.requirements, 0, field);
    assertNoRuntimeCalls(counters);
  }
});

test("fabricated valid snapshot and registries cannot override trusted runtime facts", async () => {
  const base = runtimeInput({ snapshot: snapshotAt("running") });
  const fabricated = changedInput(base, {
    snapshot: snapshotAt("ready"),
    projectRegistry: projectRegistry(),
    modelProviderRegistry: providerRegistry({ twoCandidates: true }),
    existingRequests: [],
  });
  const counters = freshCounters();
  const trusted = dependencies(fabricated, counters);
  const decision = await executeAgentStep(
    fabricated,
    trusted.factsResolver,
    [],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
  );
  assert.equal(decision.reasons[0]?.code, "invalid_input");
  assert.equal(counters.facts, 0);
  assertNoRuntimeCalls(counters);
});

test("trusted facts resolver is exact, accessor-free, proxy-free, and invoked at most once", async () => {
  const input = runtimeInput();
  let getterReads = 0;
  const accessor = Object.defineProperty({}, "resolve", {
    enumerable: true,
    get() { getterReads += 1; return async () => runtimeFacts(input); },
  });
  const transparentProxy = new Proxy({ resolve: async () => runtimeFacts(input) }, {});
  const revoked = Proxy.revocable({ resolve: async () => runtimeFacts(input) }, {});
  revoked.revoke();
  const symbolResolver = { resolve: async () => runtimeFacts(input), [Symbol("extra")]: true };
  const cases = [
    accessor,
    transparentProxy,
    revoked.proxy,
    symbolResolver,
    { resolve: async () => runtimeFacts(input), extra: true },
  ];
  for (const factsResolver of cases) {
    let requirementsCalls = 0;
    const decision = await executeAgentStep(
      input,
      factsResolver,
      [],
      { async resolve() { requirementsCalls += 1; return capability(); } },
      undefined,
      { now: () => "2026-08-26T10:15:40.000Z" },
    );
    assert.equal(decision.reasons[0]?.code, "facts_resolver_invalid");
    assert.equal(requirementsCalls, 0);
  }
  assert.equal(getterReads, 0);

  let calls = 0;
  const counters = freshCounters();
  const decision = await executeAgentStep(
    input,
    { async resolve() { calls += 1; return runtimeFacts(input); } },
    [provider(input, counters)],
    { async resolve() { return capability(); } },
    undefined,
    { now: () => "2026-08-26T10:15:40.000Z" },
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(calls, 1);
});

test("hostile trusted facts output fails closed before requirements or provider calls", async () => {
  const input = runtimeInput();
  let getterReads = 0;
  const accessorOutput = Object.defineProperty({}, "snapshot", {
    enumerable: true,
    get() { getterReads += 1; return snapshotAt(); },
  });
  const outputs = [
    accessorOutput,
    new Proxy(runtimeFacts(input), {}),
    { ...runtimeFacts(input), unknown: true },
    { ...runtimeFacts(input), existingRequests: new Proxy([], {}) },
  ];
  for (const output of outputs) {
    const counters = freshCounters();
    const decision = await executeAgentStep(
      input,
      { async resolve() { counters.facts += 1; return output; } },
      [],
      { async resolve() { counters.requirements += 1; return capability(); } },
      undefined,
      { now() { counters.clock += 1; return "2026-08-26T10:15:40.000Z"; } },
    );
    assert.equal(decision.verdict, "deny");
    assert.equal(counters.facts, 1);
    assert.equal(counters.requirements, 0);
    assertNoRuntimeCalls(counters);
  }
  assert.equal(getterReads, 0);
});

for (const [taskClass, requestedCapability] of [
  ["classification", "economy"],
  ["analysis", "reasoning"],
  ["security_analysis", "advanced_reasoning"],
] as const) {
  test(`${requestedCapability} factual capability executes one local Agent Step`, async () => {
    const input = runtimeInput();
    const counters = freshCounters();
    const decision = await execute(
      input,
      [provider(input, counters)],
      counters,
      { taskClass, requestedCapability },
    );
    assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
    assert.equal(decision.status, "completed");
    assert.equal(decision.capabilityDecision?.authorizedCapability, requestedCapability);
    assert.equal(decision.modelExecutionDecision?.verdict, "allow");
    assert.equal(decision.normalizedResult?.outcome, "succeeded");
    assert.equal(decision.previousSnapshot?.revision, runtimeFacts(input).snapshot.revision);
    assert.equal(decision.nextSnapshot?.revision, runtimeFacts(input).snapshot.revision + 2);
    assert.equal(decision.nextSnapshot?.stepStates.find((step) => step.stepId === "execute-one")?.status, "success");
    assert.equal(decision.nextSnapshot?.events.at(-2)?.kind, "step_started");
    assert.equal(decision.nextSnapshot?.events.at(-1)?.kind, "step_succeeded");
    assert.deepEqual(counters, {
      facts: 1, requirements: 1, evidence: 0, clock: 1, health: 1, run: 1,
    });
    assert.equal(deeplyFrozen(decision), true);
  });
}

test("missing step denies before requirements, clock, or provider calls", async () => {
  const base = runtimeInput();
  const input = changedInput(base, { stepId: "missing-step" });
  const counters = freshCounters();
  const trusted = dependencies(input, counters);
  const decision = await executeAgentStep(
    input,
    trusted.factsResolver,
    [],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
  );
  assert.equal(decision.status, "denied");
  assert.equal(decision.reasons[0]?.code, "step_not_found");
  assert.equal(counters.requirements, 0);
  assertNoRuntimeCalls(counters);
});

for (const stage of ["running", "success", "dependency_incomplete"] as const) {
  test(`${stage} factual step cannot be executed as a ready pending step`, async () => {
    const input = runtimeInput({ snapshot: snapshotAt(stage) });
    input.expectedRevision = runtimeFacts(input).snapshot.revision;
    const counters = freshCounters();
    const trusted = dependencies(input, counters);
    const decision = await executeAgentStep(
      input,
      trusted.factsResolver,
      [],
      trusted.requirementsResolver,
      undefined,
      trusted.runtimeContext,
    );
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.reasons[0]?.code, "step_not_executable");
    assert.equal(counters.requirements, 0);
    assertNoRuntimeCalls(counters);
  });
}

test("invalid snapshot and stale revision or attempt deny before runtime calls", async () => {
  const invalid = runtimeInput();
  runtimeFacts(invalid).snapshot = {
    ...clone(runtimeFacts(invalid).snapshot),
    revision: runtimeFacts(invalid).snapshot.revision + 1,
  };
  const staleRevision = runtimeInput();
  const staleAttempt = runtimeInput();
  for (const input of [
    invalid,
    changedInput(staleRevision, { expectedRevision: 999 }),
    changedInput(staleAttempt, { expectedAttemptNumber: 2 }),
  ]) {
    const counters = freshCounters();
    const trusted = dependencies(input, counters);
    const decision = await executeAgentStep(
      input,
      trusted.factsResolver,
      [],
      trusted.requirementsResolver,
      undefined,
      trusted.runtimeContext,
    );
    assert.equal(decision.verdict, "deny");
    assert.equal(counters.requirements, 0);
    assertNoRuntimeCalls(counters);
  }
});

test("trusted run, revision, and current attempt control factual linkage", async () => {
  const runMismatchBase = runtimeInput();
  const runMismatch = changedInput(runMismatchBase, { runId: "run-other" });
  const staleRevisionBase = runtimeInput();
  const staleRevision = changedInput(staleRevisionBase, {
    expectedRevision: staleRevisionBase.expectedRevision - 1,
  });
  const staleAttempt = runtimeInput({ snapshot: retryReadySnapshot() });
  staleAttempt.expectedAttemptNumber = 1;

  for (const [input, expectedCode] of [
    [runMismatch, "factual_linkage_mismatch"],
    [staleRevision, "stale_runtime_input"],
    [staleAttempt, "stale_runtime_input"],
  ] as const) {
    const counters = freshCounters();
    const trusted = dependencies(input, counters);
    const decision = await executeAgentStep(
      input,
      trusted.factsResolver,
      [],
      trusted.requirementsResolver,
      undefined,
      trusted.runtimeContext,
    );
    assert.equal(decision.reasons[0]?.code, expectedCode);
    assert.equal(counters.facts, 1);
    assert.equal(counters.requirements, 0);
    assertNoRuntimeCalls(counters);
  }
});

test("trusted existing invocation history cannot be erased and stops factual replay", async () => {
  const input = runtimeInput();
  const factualSnapshotBefore = clone(runtimeFacts(input).snapshot);
  const priorRequest = expectedRoute(input).request;
  runtimeFacts(input).existingRequests = [clone(priorRequest)];
  const counters = freshCounters();
  const decision = await execute(input, [], counters);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.reasons[0]?.code, "invocation_replay_detected");
  assert.deepEqual(decision.previousSnapshot, factualSnapshotBefore);
  assert.deepEqual(runtimeFacts(input).snapshot, factualSnapshotBefore);
  assert.equal(decision.nextSnapshot, null);
  assert.equal(decision.modelExecutionDecision, null);
  assert.equal(decision.normalizedResult, null);
  assert.equal(decision.previousSnapshot?.events.some((event) => event.kind === "step_failed"), false);
  assert.deepEqual(counters, {
    facts: 1, requirements: 1, evidence: 0, clock: 1, health: 0, run: 0,
  });

  const erased = changedInput(input, { existingRequests: [] });
  const erasedCounters = freshCounters();
  const trusted = dependencies(erased, erasedCounters);
  const erasedDecision = await executeAgentStep(
    erased,
    trusted.factsResolver,
    [],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
  );
  assert.equal(erasedDecision.reasons[0]?.code, "invalid_input");
  assert.equal(erasedCounters.facts, 0);
  assertNoRuntimeCalls(erasedCounters);
});

test("durable invocation ledger reserves before provider and records bounded factual usage", async () => {
  const input = runtimeInput();
  const expected = expectedRoute(input);
  const before = clone(input);
  const counters = freshCounters();
  const trusted = dependencies(input, counters);
  const calls: string[] = [];
  let reservation: any = null;
  let outcome: any = null;
  const ledger = {
    async reserve(value: unknown) {
      calls.push("reserve");
      assert.deepEqual({ health: counters.health, run: counters.run }, { health: 0, run: 0 });
      assert.equal(deeplyFrozen(value), true);
      reservation = clone(value);
      assert.equal(JSON.stringify(value).includes("messages"), false);
      assert.match((value as any).requestFingerprint, /^sha256:[0-9a-f]{64}$/u);
      return { status: "reserved" as const };
    },
    async authorizeProviderStart(value: unknown) {
      calls.push("fence");
      assert.deepEqual(value, reservation);
      assert.deepEqual({ health: counters.health, run: counters.run }, { health: 0, run: 0 });
      return { status: "started" as const };
    },
    async recordOutcome(value: unknown) {
      calls.push("outcome");
      assert.equal(counters.run, 1);
      assert.equal(deeplyFrozen(value), true);
      outcome = clone(value);
      return { status: "recorded" as const };
    },
  };
  const decision = await executeAgentStep(
    input,
    trusted.factsResolver,
    [provider(input, counters)],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
    undefined,
    ledger,
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.deepEqual(calls, ["reserve", "fence", "outcome"]);
  assert.deepEqual(reservation, {
    workspaceId: "workspace-primary",
    runId: "run-one",
    workflowExecutionId: "runtime-one",
    invocationId: "invocation-one",
    runRevision: expected.request.runRevision,
    projectId: "project-one",
    workflowId: "workflow-one",
    agentId: "agent-one",
    agentBindingId: expected.request.agentBindingId,
    stepId: "execute-one",
    attemptNumber: 1,
    modelProfileId: expected.request.modelProfileId,
    requestFingerprint: reservation.requestFingerprint,
    providerId: expected.route.routePlan!.primary.providerId,
    deploymentId: expected.route.routePlan!.primary.deploymentId,
    providerModelId: expected.route.routePlan!.primary.providerModelId,
    providerModelVersion: "version-1",
  });
  assert.deepEqual(outcome, {
    workspaceId: "workspace-primary",
    runId: "run-one",
    invocationId: "invocation-one",
    requestFingerprint: reservation.requestFingerprint,
    status: "succeeded",
    outcome: "succeeded",
    finishReason: "stop",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    latencyMs: 5,
    costUsdMicros: 0,
    errorCode: null,
  });
  assert.deepEqual(input, before);
  assert.equal(deeplyFrozen(decision), true);
});

test("durable replay, collision, and unresolved invocation stop before provider", async () => {
  for (const [ledgerStatus, reasonCode] of [
    ["replay", "invocation_replay_detected"],
    ["conflict", "invocation_ledger_conflict"],
    ["recovery_required", "invocation_ledger_recovery_required"],
  ] as const) {
    const input = runtimeInput();
    const counters = freshCounters();
    const trusted = dependencies(input, counters);
    let outcomeCalls = 0;
    const decision = await executeAgentStep(
      input,
      trusted.factsResolver,
      [provider(input, counters)],
      trusted.requirementsResolver,
      undefined,
      trusted.runtimeContext,
      undefined,
      {
        async reserve() { return { status: ledgerStatus }; },
        async authorizeProviderStart() { return { status: "started" as const }; },
        async recordOutcome() { outcomeCalls += 1; return { status: "recorded" as const }; },
      },
    );
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.reasons.at(-1)?.code, reasonCode);
    assert.deepEqual({ health: counters.health, run: counters.run, outcomeCalls }, {
      health: 0, run: 0, outcomeCalls: 0,
    });
    assert.equal(decision.nextSnapshot, null);
    assert.equal(decision.normalizedResult, null);
  }
});

test("provider run ambiguity is durably outcome_unknown without fabricated usage", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const trusted = dependencies(input, counters);
  let recorded: any = null;
  const decision = await executeAgentStep(
    input,
    trusted.factsResolver,
    [provider(input, counters, 0, { throwRun: true })],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
    undefined,
    {
      async reserve() { return { status: "reserved" as const }; },
      async authorizeProviderStart() { return { status: "started" as const }; },
      async recordOutcome(value) { recorded = clone(value); return { status: "recorded" as const }; },
    },
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.status, "recovery_required");
  assert.equal(decision.nextSnapshot, null);
  assert.equal(decision.normalizedResult, null);
  assert.equal(counters.run, 1);
  assert.deepEqual(recorded, {
    workspaceId: "workspace-primary",
    runId: "run-one",
    invocationId: "invocation-one",
    requestFingerprint: recorded.requestFingerprint,
    status: "outcome_unknown",
    outcome: null,
    finishReason: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    latencyMs: null,
    costUsdMicros: null,
    errorCode: "provider_exception",
  });
});

test("hostile or malformed invocation ledger fails closed before runtime facts and provider", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const trusted = dependencies(input, counters);
  let getterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, "reserve", {
    enumerable: true,
    get() { getterCalls += 1; throw new Error("secret ledger getter"); },
  });
  Object.defineProperty(hostile, "recordOutcome", {
    enumerable: true,
    value: async () => ({ status: "recorded" }),
  });
  Object.defineProperty(hostile, "authorizeProviderStart", {
    enumerable: true,
    value: async () => ({ status: "started" }),
  });
  const decision = await executeAgentStep(
    input,
    trusted.factsResolver,
    [provider(input, counters)],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
    undefined,
    hostile as never,
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.reasons[0]?.code, "invocation_ledger_failed");
  assert.equal(getterCalls, 0);
  assert.deepEqual(counters, freshCounters());
  assert.equal(JSON.stringify(decision).includes("secret ledger getter"), false);
});

test("requirements and routing derive only from trusted factual snapshot and registries", async () => {
  const input = runtimeInput({ twoCandidates: true });
  const facts = runtimeFacts(input);
  const beforeFacts = clone(facts);
  const counters = freshCounters();
  let requirementsContext: any = null;
  const trusted = dependencies(input, counters);
  const decision = await executeAgentStep(
    input,
    trusted.factsResolver,
    [provider(input, counters, 0)],
    {
      async resolve(value: unknown) {
        counters.requirements += 1;
        requirementsContext = value;
        return capability();
      },
    },
    undefined,
    trusted.runtimeContext,
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(requirementsContext.runId, facts.snapshot.runId);
  assert.equal(requirementsContext.projectId, facts.snapshot.projectId);
  assert.equal(requirementsContext.agentId, "agent-one");
  assert.equal(requirementsContext.modelProfileId, "model-shared");
  assert.equal(Object.hasOwn(requirementsContext, "messages"), false);
  assert.equal(decision.modelExecutionDecision?.selectedCandidate?.providerId, "provider-a");
  assert.deepEqual(facts, beforeFacts);
});

test("AI-028.1 deny and approval-required risk stop before clock and provider calls", async () => {
  for (const overrides of [
    { requiresModel: false },
    { taskClass: "security_analysis", requestedCapability: "advanced_reasoning", riskLevel: "high" },
  ]) {
    const input = runtimeInput();
    const counters = freshCounters();
    const decision = await execute(input, [provider(input, counters)], counters, overrides);
    assert.equal(decision.verdict, "deny");
    assert.ok(["denied", "approval_required"].includes(decision.status));
    assert.equal(counters.requirements, 1);
    assertNoRuntimeCalls(counters);
    assert.equal(decision.nextSnapshot, null);
  }
});

test("trusted exact risk approval resolver permits only the singular risk gate", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const trusted = dependencies(input, counters, {
    taskClass: "security_analysis",
    requestedCapability: "advanced_reasoning",
    riskLevel: "high",
  });
  let observedQuery: unknown = null;
  const allowed = await executeAgentStep(
    input,
    trusted.factsResolver,
    [provider(input, counters)],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
    {
      async resolve(query: unknown) {
        observedQuery = query;
        return { approved: true };
      },
    },
  );
  assert.equal(allowed.verdict, "allow", JSON.stringify(allowed.reasons));
  assert.equal((observedQuery as any).runId, input.runId);
  assert.equal((observedQuery as any).stepId, input.stepId);
  assert.equal((observedQuery as any).riskLevel, "high");
  assert.match((observedQuery as any).policyFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(counters.health, 1);
  assert.equal(counters.run, 1);
});

test("missing, false, or caller-computable risk approval never enters the provider boundary", async () => {
  const input = runtimeInput();
  for (const resolver of [undefined, { resolve: async () => ({ approved: false }) }]) {
    const counters = freshCounters();
    const trusted = dependencies(input, counters, {
      taskClass: "security_analysis",
      requestedCapability: "advanced_reasoning",
      riskLevel: "high",
    });
    const denied = await executeAgentStep(
      input,
      trusted.factsResolver,
      [provider(input, counters)],
      trusted.requirementsResolver,
      undefined,
      trusted.runtimeContext,
      resolver,
    );
    assert.equal(denied.status, "approval_required");
    assert.equal(denied.reasons[0]?.code, "approval_required");
    assert.equal(counters.health, 0);
    assert.equal(counters.run, 0);
  }

  const callerCounters = freshCounters();
  const trusted = dependencies(input, callerCounters);
  const fingerprintOnly = await executeAgentStep(
    { ...input, policyFingerprint: "a".repeat(64) },
    trusted.factsResolver,
    [provider(input, callerCounters)],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
  );
  assert.equal(fingerprintOnly.verdict, "deny");
  assert.equal(callerCounters.facts, 0);
  assertNoRuntimeCalls(callerCounters);
});

test("malformed risk approval resolver and approved multi-reason policy fail closed", async () => {
  const input = runtimeInput();
  for (const approvalResult of [{ approved: "yes" }, { approved: true, extra: true }]) {
    const counters = freshCounters();
    const trusted = dependencies(input, counters, {
      taskClass: "security_analysis",
      requestedCapability: "advanced_reasoning",
      riskLevel: "high",
    });
    const denied = await executeAgentStep(
      input,
      trusted.factsResolver,
      [provider(input, counters)],
      trusted.requirementsResolver,
      undefined,
      trusted.runtimeContext,
      { resolve: async () => approvalResult },
    );
    assert.equal(denied.verdict, "deny");
    assert.equal(denied.reasons[0]?.code, "risk_approval_resolution_failed");
    assertNoRuntimeCalls(counters);
  }

  const counters = freshCounters();
  const trusted = dependencies(input, counters, {
    taskClass: "security_analysis",
    requestedCapability: "advanced_reasoning",
    riskLevel: "high",
    requiresRepositoryWrite: true,
  });
  const denied = await executeAgentStep(
    input,
    trusted.factsResolver,
    [provider(input, counters)],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
    { resolve: async () => ({ approved: true }) },
  );
  assert.equal(denied.verdict, "deny");
  assert.equal(denied.riskApprovalScope, null);
  assert.equal(counters.health, 0);
  assert.equal(counters.run, 0);
});

test("deterministic capability uses no model and returns unsupported runtime", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const decision = await execute(input, [provider(input, counters)], counters, {
    taskClass: "deterministic_operation",
    requestedCapability: "deterministic",
    requiresModel: false,
    requiresRepositoryRead: false,
  });
  assert.equal(decision.status, "unsupported_runtime");
  assert.equal(decision.reasons[0]?.code, "deterministic_runtime_unavailable");
  assert.equal(decision.capabilityDecision?.modelExecutionAllowed, false);
  assert.equal(counters.requirements, 1);
  assertNoRuntimeCalls(counters);
});

test("eligible coding capability does not invoke a model or Coding Worker", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const decision = await execute(input, [provider(input, counters)], counters, {
    taskClass: "implementation",
    requestedCapability: "coding",
    requiresRepositoryWrite: true,
    requiresCommandExecution: true,
  });
  assert.equal(decision.status, "unsupported_runtime");
  assert.equal(decision.reasons[0]?.code, "coding_runtime_unavailable");
  assert.equal(decision.capabilityDecision?.repositoryWriteRequired, true);
  assert.equal(counters.requirements, 1);
  assertNoRuntimeCalls(counters);
});

test("capability budget cannot exceed factual Workflow budget", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const decision = await execute(input, [provider(input, counters)], counters, {
    budget: { maxInputTokens: 900_000, maxOutputTokens: 200_000, maxCostUsdMicros: 500_000 },
  });
  assert.equal(decision.reasons[0]?.code, "capability_budget_exceeded");
  assert.equal(counters.requirements, 1);
  assertNoRuntimeCalls(counters);
});

test("remote redaction composes through AI-028 once and exposes no evidence", async () => {
  const input = runtimeInput({
    dataEgressMode: "redacted_only",
    deploymentMode: "remote",
    draftOverrides: {
      messages: [{ role: "user", content: "Handle SECRET_SENTINEL safely.", toolCallId: null }],
    },
  });
  const counters = freshCounters();
  let providerInput: unknown = null;
  const evidenceResolver = {
    async resolve(value: any) {
      counters.evidence += 1;
      const messages = value.messages.map((message: any, messageIndex: number) => {
        const start = message.content.indexOf("SECRET_SENTINEL");
        return start < 0
          ? { messageIndex, assessment: "no_sensitive_data", spans: [] }
          : { messageIndex, assessment: "redacted", spans: [{ start, end: start + 15, category: "credential" }] };
      });
      return {
        kind: "redaction",
        evidenceId: "redaction-one",
        workspaceId: value.workspaceId,
        projectId: value.projectId,
        runId: value.runId,
        invocationId: value.invocationId,
        runRevision: value.runRevision,
        stepId: value.stepId,
        attemptNumber: value.attemptNumber,
        modelProfileId: value.modelProfileId,
        candidateIdentity: value.candidateIdentity,
        sourceRequestFingerprint: value.sourceRequestFingerprint,
        assessedAt: "2026-08-26T10:15:40.000Z",
        detectorId: "detector-one",
        detectorVersion: "version-one",
        messages,
      };
    },
  };
  const decision = await execute(
    input,
    [provider(input, counters, 0, { observe: (value) => { providerInput = value; } })],
    counters,
    {},
    evidenceResolver,
  );
  assert.equal(
    decision.verdict,
    "allow",
    JSON.stringify(decision.modelExecutionDecision ?? decision.reasons),
  );
  assert.deepEqual(counters, {
    facts: 1, requirements: 1, evidence: 1, clock: 1, health: 1, run: 1,
  });
  assert.equal(JSON.stringify(providerInput).includes("SECRET_SENTINEL"), false);
  assert.equal(JSON.stringify(providerInput).includes("[REDACTED:CREDENTIAL]"), true);
  assert.equal(JSON.stringify(decision).includes("redaction-one"), false);
  assert.equal(JSON.stringify(decision).includes("SECRET_SENTINEL"), false);
});

test("permanent provider registration denial remains non-retryable", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const decision = await execute(input, [], counters);
  const lastEvent = decision.nextSnapshot?.events.at(-1);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.status, "failed");
  assert.equal(decision.normalizedResult, null);
  assert.equal(decision.nextSnapshot?.status, "failed");
  assert.equal(decision.modelExecutionDecision?.reasons.some(
    (reason) => reason.code === "provider_not_registered",
  ), true);
  assert.equal(lastEvent?.kind, "step_failed");
  if (lastEvent?.kind === "step_failed") assert.equal(lastEvent.error.retryable, false);
  assert.equal(counters.health, 0);
  assert.equal(counters.run, 0);
});

for (const scenario of [
  {
    name: "provider unavailable",
    options: { healthStatus: "unavailable" },
    expectedHealth: 1,
    expectedRun: 0,
    reasonCode: "provider_unavailable",
  },
  {
    name: "provider health exception",
    options: { throwHealth: true },
    expectedHealth: 1,
    expectedRun: 0,
    reasonCode: "provider_exception",
  },
] as const) {
  test(`${scenario.name} preserves one canonical retryable failure without retrying`, async () => {
    const input = runtimeInput();
    const counters = freshCounters();
    const decision = await execute(
      input,
      [provider(input, counters, 0, scenario.options)],
      counters,
    );
    const stepState = decision.nextSnapshot?.stepStates.find(
      (step) => step.stepId === "execute-one",
    );
    const lastEvent = decision.nextSnapshot?.events.at(-1);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.status, "failed");
    assert.equal(decision.normalizedResult, null);
    assert.equal(decision.nextSnapshot?.status, "running");
    assert.equal(stepState?.status, "pending");
    assert.equal(stepState?.attemptCount, 1);
    assert.equal(decision.nextSnapshot?.readyStepIds.includes("execute-one"), true);
    assert.equal(decision.nextSnapshot?.events.at(-2)?.kind, "step_started");
    assert.equal(lastEvent?.kind, "step_failed");
    if (lastEvent?.kind === "step_failed") assert.equal(lastEvent.error.retryable, true);
    assert.equal(decision.modelExecutionDecision?.reasons.some(
      (reason) => reason.code === scenario.reasonCode,
    ), true);
    assert.equal(counters.health, scenario.expectedHealth);
    assert.equal(counters.run, scenario.expectedRun);
  });
}

test("retryable provider failure still respects the factual max-attempt boundary", async () => {
  const input = runtimeInput({ snapshot: retryReadySnapshot() });
  input.expectedAttemptNumber = 2;
  const counters = freshCounters();
  const decision = await execute(
    input,
    [provider(input, counters, 0, { healthStatus: "unavailable" })],
    counters,
  );
  const stepState = decision.nextSnapshot?.stepStates.find(
    (step) => step.stepId === "execute-one",
  );
  const lastEvent = decision.nextSnapshot?.events.at(-1);
  assert.equal(decision.status, "failed");
  assert.equal(decision.nextSnapshot?.status, "failed");
  assert.equal(stepState?.status, "failed");
  assert.equal(stepState?.attemptCount, 2);
  assert.equal(lastEvent?.kind, "step_failed");
  if (lastEvent?.kind === "step_failed") assert.equal(lastEvent.error.retryable, true);
  assert.equal(counters.health, 1);
  assert.equal(counters.run, 0);
});

test("a failed validated provider result transitions canonically without retrying", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const decision = await execute(input, [provider(input, counters, 0, {
    resultOverrides: {
      outcome: "failed",
      finishReason: "error",
      outputText: null,
      error: { category: "provider_error", code: "failure", message: "Provider failed.", retryable: true },
    },
  })], counters);
  assert.equal(decision.status, "failed");
  assert.equal(decision.nextSnapshot?.status, "running");
  assert.equal(decision.nextSnapshot?.stepStates.find((step) => step.stepId === "execute-one")?.status, "pending");
  assert.equal(decision.nextSnapshot?.stepStates.find((step) => step.stepId === "execute-one")?.attemptCount, 1);
  assert.equal(decision.nextSnapshot?.readyStepIds.includes("execute-one"), true);
  assert.equal(counters.run, 1);
});

test("actual token or cost usage over capability ceiling fails before step success", async () => {
  for (const resultOverrides of [
    { usage: { inputTokens: 16_001, outputTokens: 5, totalTokens: 16_006 } },
    { costUsdMicros: 500_001 },
  ]) {
    const input = runtimeInput();
    const counters = freshCounters();
    const decision = await execute(
      input,
      [provider(input, counters, 0, { resultOverrides })],
      counters,
    );
    assert.equal(decision.reasons[0]?.code, "budget_exceeded");
    assert.equal(decision.nextSnapshot?.stepStates.find((step) => step.stepId === "execute-one")?.status, "failed");
  }
});

test("allowed tool proposals are never executed and cannot complete the step", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const decision = await execute(input, [provider(input, counters, 0, {
    resultOverrides: {
      finishReason: "tool_calls",
      outputText: null,
      toolCallProposals: [{ toolCallId: "call-one", toolId: "tool-read", arguments: {} }],
    },
  })], counters);
  assert.equal(decision.reasons[0]?.code, "tool_runtime_unavailable");
  assert.equal(decision.nextSnapshot?.status, "failed");
  assert.equal(counters.run, 1);
});

test("primary unavailable never inspects or runs the factual fallback", async () => {
  const input = runtimeInput({ twoCandidates: true });
  const primaryCounters = freshCounters();
  const fallbackCounters = freshCounters();
  const sharedCounters = freshCounters();
  const trusted = dependencies(input, sharedCounters);
  const decision = await executeAgentStep(
    input,
    trusted.factsResolver,
    [
      provider(input, primaryCounters, 0, { healthStatus: "unavailable" }),
      provider(input, fallbackCounters, 1),
    ],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
  );
  assert.equal(decision.status, "failed");
  assert.equal(decision.nextSnapshot?.status, "running");
  assert.equal(decision.nextSnapshot?.stepStates.find(
    (step) => step.stepId === "execute-one",
  )?.status, "pending");
  assert.equal(decision.nextSnapshot?.stepStates.find(
    (step) => step.stepId === "execute-one",
  )?.attemptCount, 1);
  assert.equal(primaryCounters.health, 1);
  assert.equal(primaryCounters.run, 0);
  assert.equal(fallbackCounters.health, 0);
  assert.equal(fallbackCounters.run, 0);
});

test("caller cannot inject policy, authority, evidence, candidate, result, or trusted time", async () => {
  for (const field of [
    "snapshot", "projectRegistry", "modelProviderRegistry", "existingRequests",
    "capabilityDecision", "riskLevel", "requiresRepositoryWrite", "requiresCommandExecution",
    "requiresNetwork", "evidence", "approval", "candidateIdentity", "routeDecision",
    "providerResult", "evaluatedAt", "timestamp",
  ]) {
    const base = runtimeInput();
    const input = changedInput(base, { [field]: "untrusted-hostile-sentinel" });
    const counters = freshCounters();
    const trusted = dependencies(input, counters);
    const decision = await executeAgentStep(
      input,
      trusted.factsResolver,
      [],
      trusted.requirementsResolver,
      undefined,
      trusted.runtimeContext,
    );
    assert.equal(decision.reasons[0]?.code, "invalid_input");
    assert.equal(JSON.stringify(decision).includes("untrusted-hostile-sentinel"), false);
    assert.equal(counters.requirements, 0);
    assert.equal(counters.facts, 0);
    assertNoRuntimeCalls(counters);
  }
});

test("hostile runtime input and trusted dependencies fail closed without invocation", async () => {
  let getterReads = 0;
  const accessor = Object.defineProperty({}, "runId", {
    enumerable: true,
    get() { getterReads += 1; return "run-one"; },
  });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("proxy-hostile-sentinel"); } });
  const input = runtimeInput();
  const transparentProxy = new Proxy(input, {});
  const nestedProxyInput = changedInput(input, {
    invocationDraft: new Proxy(input.invocationDraft, {}),
  });
  const resolverAccessor = Object.defineProperty({}, "resolve", {
    enumerable: true,
    get() { getterReads += 1; return async () => capability(); },
  });
  const clockAccessor = Object.defineProperty({}, "now", {
    enumerable: true,
    get() { getterReads += 1; return () => "2026-08-26T10:15:40.000Z"; },
  });
  const trusted = dependencies(input, freshCounters());
  for (const scenario of [
    () => executeAgentStep(accessor, trusted.factsResolver, [], { resolve: async () => capability() }, undefined, { now: () => "2026-08-26T10:15:40.000Z" }),
    () => executeAgentStep(proxy, trusted.factsResolver, [], { resolve: async () => capability() }, undefined, { now: () => "2026-08-26T10:15:40.000Z" }),
    () => executeAgentStep(transparentProxy, trusted.factsResolver, [], { resolve: async () => capability() }, undefined, { now: () => "2026-08-26T10:15:40.000Z" }),
    () => executeAgentStep(nestedProxyInput, trusted.factsResolver, [], { resolve: async () => capability() }, undefined, { now: () => "2026-08-26T10:15:40.000Z" }),
    () => executeAgentStep(input, trusted.factsResolver, [], resolverAccessor, undefined, { now: () => "2026-08-26T10:15:40.000Z" }),
    () => executeAgentStep(input, trusted.factsResolver, [], { resolve: async () => capability() }, undefined, clockAccessor),
  ]) {
    const decision = await scenario();
    assert.equal(decision.verdict, "deny");
    assert.equal(JSON.stringify(decision).includes("proxy-hostile-sentinel"), false);
  }
  assert.equal(getterReads, 0);
});

test("throwing or malformed trusted requirements resolution is fail-closed and at most once", async () => {
  const input = runtimeInput();
  let throwingCalls = 0;
  const cases = [
    {
      resolver: {
        async resolve() {
          throwingCalls += 1;
          throw new Error("requirements-hostile-sentinel");
        },
      },
      calls: () => throwingCalls,
    },
    { resolver: { async resolve() { return capability(); }, extra: true }, calls: () => 0 },
    {
      resolver: new Proxy({}, { ownKeys() { throw new Error("requirements-proxy-sentinel"); } }),
      calls: () => 0,
    },
  ];
  for (const scenario of cases) {
    const counters = freshCounters();
    const trusted = dependencies(input, counters);
    const decision = await executeAgentStep(
      input,
      trusted.factsResolver,
      [],
      scenario.resolver,
      undefined,
      { now() { counters.clock += 1; return "2026-08-26T10:15:40.000Z"; } },
    );
    assert.equal(decision.verdict, "deny");
    assert.ok(scenario.calls() <= 1);
    assert.equal(counters.clock, 0);
    assert.equal(JSON.stringify(decision).includes("hostile-sentinel"), false);
    assert.equal(JSON.stringify(decision).includes("proxy-sentinel"), false);
  }
});

test("trusted clock throw or non-canonical time is captured once and prevents transitions", async () => {
  const input = runtimeInput();
  for (const now of [
    () => { throw new Error("clock-hostile-sentinel"); },
    () => "2026-08-26T10:15:40Z",
  ]) {
    let clockCalls = 0;
    const trusted = dependencies(input, freshCounters());
    const decision = await executeAgentStep(
      input,
      trusted.factsResolver,
      [],
      { async resolve() { return capability(); } },
      undefined,
      { now() { clockCalls += 1; return now(); } },
    );
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.reasons[0]?.code, "trusted_time_invalid");
    assert.equal(clockCalls, 1);
    assert.equal(decision.nextSnapshot, null);
    assert.equal(JSON.stringify(decision).includes("clock-hostile-sentinel"), false);
  }
});

test("wrong invocation step binding fails after one start and before provider calls", async () => {
  const input = runtimeInput({ draftOverrides: { stepId: "approve-one" } });
  const counters = freshCounters();
  const decision = await execute(input, [], counters);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.reasons[0]?.code, "route_denied");
  assert.equal(decision.nextSnapshot?.events.at(-2)?.kind, "step_started");
  assert.equal(decision.nextSnapshot?.events.at(-1)?.kind, "step_failed");
  assert.equal(counters.health, 0);
  assert.equal(counters.run, 0);
});

test("caller mutation while trusted facts resolution is pending cannot change factual execution", async () => {
  const input = runtimeInput() as any;
  const originalFacts = clone(runtimeFacts(input));
  const counters = freshCounters();
  let releaseFacts: (value: unknown) => void = () => { throw new Error("not initialized"); };
  const pendingFacts = new Promise<unknown>((resolve) => { releaseFacts = resolve; });
  let observedQuery: unknown = null;
  let observedProviderRequest: unknown = null;
  const trusted = dependencies(input, counters);
  const pending = executeAgentStep(
    input,
    {
      async resolve(query: unknown) {
        counters.facts += 1;
        observedQuery = query;
        return pendingFacts;
      },
    },
    [provider(input, counters, 0, { observe: (value) => { observedProviderRequest = value; } })],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
  );
  input.runId = "run-mutated";
  input.stepId = "step-mutated";
  input.expectedRevision = 999;
  input.invocationDraft.messages[1].content = "Mutation during facts resolution.";
  releaseFacts(originalFacts);
  const decision = await pending;
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.deepEqual(observedQuery, { runId: "run-one", stepId: "execute-one" });
  assert.equal(decision.stepId, "execute-one");
  assert.equal(JSON.stringify(observedProviderRequest).includes("Mutation during facts resolution"), false);
  assert.equal(counters.facts, 1);
  assert.equal(counters.health, 1);
  assert.equal(counters.run, 1);
});

test("caller mutation while provider health is pending cannot alter factual request or snapshots", async () => {
  const input = runtimeInput() as any;
  const counters = freshCounters();
  const base = provider(input, counters);
  let releaseHealth: (value: unknown) => void = () => { throw new Error("not initialized"); };
  const pendingHealth = new Promise<unknown>((resolve) => { releaseHealth = resolve; });
  let markHealthEntered: () => void = () => { throw new Error("not initialized"); };
  const healthEntered = new Promise<void>((resolve) => { markHealthEntered = resolve; });
  let observedRequest: unknown = null;
  const delayed = {
    identity: base.identity,
    async health() { counters.health += 1; markHealthEntered(); return pendingHealth; },
    async run(value: unknown) { counters.run += 1; observedRequest = value; return base.run(value); },
  };
  const trusted = dependencies(input, counters);
  const pending = executeAgentStep(
    input,
    trusted.factsResolver,
    [delayed],
    trusted.requirementsResolver,
    undefined,
    trusted.runtimeContext,
  );
  await healthEntered;
  input.invocationDraft.messages[1].content = "Mutated caller sentinel.";
  input.invocationDraft.contextArtifactIds[0] = "artifact-mutated";
  input.stepId = "missing-step";
  runtimeFacts(input).snapshot = snapshotAt("running");
  runtimeFacts(input).existingRequests = [expectedRoute(runtimeInput()).request];
  releaseHealth(validateAndNormalizeModelProviderHealth({
    providerId: "provider-mock",
    deploymentId: "deployment-mock",
    status: "healthy",
    observedAt: "2026-08-26T10:15:40.000Z",
    latencyMs: 1,
    detailCode: null,
  }));
  const decision = await pending;
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(JSON.stringify(observedRequest).includes("Mutated caller sentinel"), false);
  assert.equal(JSON.stringify(observedRequest).includes("artifact-mutated"), false);
  assert.equal(decision.stepId, "execute-one");
});

test("repeated executions are deterministic, fresh, deeply frozen, and input-immutable", async () => {
  const input = runtimeInput();
  const before = clone(input);
  const firstCounters = freshCounters();
  const secondCounters = freshCounters();
  const first = await execute(input, [provider(input, firstCounters)], firstCounters);
  const second = await execute(input, [provider(input, secondCounters)], secondCounters);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
  assert.notEqual(second.nextSnapshot, first.nextSnapshot);
  assert.notEqual(second.normalizedResult, first.normalizedResult);
  assert.equal(deeplyFrozen(first), true);
  assert.equal(deeplyFrozen(second), true);
  assert.deepEqual(input, before);
});

test("successful runtime starts and completes only the selected step", async () => {
  const input = runtimeInput();
  const counters = freshCounters();
  const decision = await execute(input, [provider(input, counters)], counters);
  assert.equal(decision.nextSnapshot?.events.length, runtimeFacts(input).snapshot.events.length + 2);
  assert.deepEqual(decision.nextSnapshot?.events.slice(-2).map((event) => event.kind), [
    "step_started", "step_succeeded",
  ]);
  assert.equal(decision.nextSnapshot?.stepStates.find((step) => step.stepId === "approve-one")?.status, "success");
  assert.equal(decision.nextSnapshot?.status, "running");
});

test("production source composes canonical contracts once and contains no prohibited runtime mechanisms", () => {
  const source = readFileSync(
    new URL("../lib/workflows/agent-step-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/evaluateModelCapabilityRoutingPolicy\(/gu) ?? []).length, 1);
  assert.equal((source.match(/executeModelInvocation\(/gu) ?? []).length, 1);
  assert.equal((source.match(/capturedFactsResolver\.resolve\(/gu) ?? []).length, 1);
  assert.equal((source.match(/capturedRequirementsResolver\.resolve\(/gu) ?? []).length, 1);
  assert.equal((source.match(/capturedRuntimeContext\.now\(/gu) ?? []).length, 1);
  assert.equal((source.match(/evaluateWorkflowRunTransition\(/gu) ?? []).length, 1);
  for (const token of [
    "Open" + "AI", "Anth" + "ropic", "Deep" + "Seek", "Q" + "wen", "Cod" + "ex",
    "fetch(", "http://", "https://", "node:fs", "child_process", "process.env",
    "exec(", "spawn(", "writeFile", "readFile", "git ", "prisma", "postgres",
    "setTimeout", "setInterval", "while (", "for (;;)" , "plan." + "fallbacks",
  ]) assert.equal(source.includes(token), false, token);
});
