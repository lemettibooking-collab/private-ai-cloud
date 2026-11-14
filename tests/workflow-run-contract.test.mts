import assert from "node:assert/strict";
import test from "node:test";

const contract = (await import(
  new URL("../lib/contracts/workflow-run.ts", import.meta.url).href
)) as typeof import("../lib/contracts/workflow-run");
const agentContract = (await import(
  new URL("../lib/contracts/agent-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/agent-manifest");
const projectContract = (await import(
  new URL("../lib/contracts/project-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/project-manifest");

const {
  createWorkflowRunSnapshot,
  evaluateWorkflowRunTransition,
  isTerminalWorkflowRunStatus,
  isWorkflowRunActorKind,
  isWorkflowRunEventKind,
  isWorkflowRunStatus,
  isWorkflowRunStepStatus,
  isWorkflowRunVerdict,
  parseTerminalWorkflowRunStatus,
  parseWorkflowRunActorKind,
  parseWorkflowRunEventKind,
  parseWorkflowRunStatus,
  parseWorkflowRunStepStatus,
  parseWorkflowRunVerdict,
  terminalWorkflowRunStatuses,
  validateAndNormalizeWorkflowRunSnapshot,
  workflowRunActorKinds,
  workflowRunEventKinds,
  workflowRunLimits,
  workflowRunStatuses,
  workflowRunStepStatuses,
  workflowRunVerdicts,
} = contract;
const { agentManifestLimits } = agentContract;
const { projectManifestLimits } = projectContract;

function clone<T>(value: T): T {
  return structuredClone(value);
}

type MutableStepState = {
  status: string;
  attemptCount: number;
  approvalRequestId: string | null;
  outputArtifactIds: string[];
  lastError: { code: string; message: string; retryable: boolean } | null;
  raw?: unknown;
};

type MutableSnapshot = {
  status: string;
  stepStates: MutableStepState[];
  readyStepIds: string[];
  events: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type MutableExecutionProfile = DeepMutable<
  import("../lib/contracts/workflow-run").WorkflowRunSnapshot["executionProfile"]
>;

function mutableSnapshot(snapshot = requireInitial()): MutableSnapshot {
  return clone(snapshot) as unknown as MutableSnapshot;
}

function mutableProfile(snapshot: MutableSnapshot): MutableExecutionProfile {
  return snapshot.executionProfile as MutableExecutionProfile;
}

function mutableAgentTask(profile: MutableExecutionProfile) {
  const step = profile.steps.find((candidate) => candidate.kind === "agent_task");
  assert.ok(step && step.kind === "agent_task");
  return step;
}

function mutableAgent(profile: MutableExecutionProfile) {
  const agent = profile.agents[0];
  assert.ok(agent);
  return agent;
}

function makeBudget(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    maxConcurrentRuns: 4,
    maxAttemptsPerRun: 3,
    maxRunMinutes: 120,
    dailyTokenBudget: 1_000_000,
    monthlyCostBudgetUsdCents: 250_000,
    ...overrides,
  };
}

function makeProject(suffix = "one", overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `project-${suffix}`,
    workspaceId: "workspace-primary",
    version: 3,
    name: `Project ${suffix}`,
    slug: `project-${suffix}`,
    summary: "Owner-controlled project context.",
    kind: "internal_product",
    status: "active",
    defaultLocale: "ru-RU",
    timeZone: "Europe/Moscow",
    dataRegion: "eu",
    dataClassification: "confidential",
    goals: ["Operate safely"],
    nonGoals: ["Autonomous external actions"],
    tags: [suffix],
    resources: [{
      id: `repository-${suffix}`,
      kind: "code_repository",
      label: `Repository ${suffix}`,
      status: "connected",
      connectionId: `connection-${suffix}`,
      resourceRef: `owner/repository-${suffix}`,
      capabilities: ["read_metadata", "read_content", "propose_change"],
    }],
    allowedModelProfileIds: ["model-shared", `model-${suffix}`],
    knowledgeCollectionIds: [`knowledge-${suffix}`],
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode: "redacted_only",
      requiredApprovalActions: [`project-review-${suffix}`],
      forbiddenActions: [`Project ${suffix} production actions are forbidden`],
    },
    budget: makeBudget(),
    ...overrides,
  };
}

function makeDepartment(suffix = "one", overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `department-${suffix}`,
    projectId: `project-${suffix}`,
    version: 5,
    code: suffix === "one" ? "development" : "qa-code-review",
    name: `Department ${suffix}`,
    summary: "Reviewed work.",
    status: "active",
    operatingMode: "approval_gated",
    goals: ["Build reviewed artifacts"],
    nonGoals: ["Deploy automatically"],
    resourceGrants: [{ resourceId: `repository-${suffix}`, capabilities: ["read_metadata", "propose_change"] }],
    allowedModelProfileIds: ["model-shared", `model-${suffix}`],
    knowledgeCollectionIds: [`knowledge-${suffix}`],
    enabledWorkflowIds: [`workflow-${suffix}`],
    operatorRoleIds: ["role-owner"],
    modelRouting: {
      primaryModelProfileId: "model-shared",
      fallbackModelProfileIds: [`model-${suffix}`],
      reviewerModelProfileId: `model-${suffix}`,
      independentReviewRequired: true,
    },
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode: "forbidden",
      additionalRequiredApprovalActions: [`department-review-${suffix}`],
      additionalForbiddenActions: [`Department ${suffix} publication is forbidden`],
    },
    budget: makeBudget({ maxConcurrentRuns: 3, maxAttemptsPerRun: 2, maxRunMinutes: 60 }),
    ...overrides,
  };
}

function makeBinding(suffix = "one", kind: "agent" | "workflow" = "agent", overrides: Readonly<Record<string, unknown>> = {}) {
  const workflow = kind === "workflow";
  return {
    id: `${kind}-binding-${suffix}`,
    projectId: `project-${suffix}`,
    departmentId: `department-${suffix}`,
    version: workflow ? 8 : 7,
    status: "active",
    kind,
    subjectId: `${workflow ? "workflow" : "agent"}-${suffix}`,
    requestedResources: [{ resourceId: `repository-${suffix}`, capabilities: ["read_metadata", "propose_change"] }],
    requestedModelProfileIds: ["model-shared", `model-${suffix}`],
    requestedKnowledgeCollectionIds: [`knowledge-${suffix}`],
    requestedBudget: makeBudget({ maxConcurrentRuns: 1, maxAttemptsPerRun: 2, maxRunMinutes: 30 }),
    externalActionMode: "approval_required",
    dataEgressMode: "forbidden",
    additionalRequiredApprovalActions: [workflow ? `workflow-external-${suffix}` : `agent-review-${suffix}`],
    additionalForbiddenActions: [`${kind} ${suffix} deploy is forbidden`],
    ...overrides,
  };
}

function makeAgent(suffix = "one", overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `agent-${suffix}`,
    projectId: `project-${suffix}`,
    departmentId: `department-${suffix}`,
    version: 11,
    roleCode: "developer",
    name: `Developer ${suffix}`,
    summary: "Creates bounded artifacts.",
    status: "active",
    instructionProfileId: `instructions-${suffix}`,
    goals: ["Create reviewed artifacts"],
    nonGoals: ["Deploy automatically"],
    outputTypes: ["patch", "test_report"],
    allowedWorkflowIds: [`workflow-${suffix}`],
    allowedToolIds: ["tool-read", "tool-patch"],
    allowedModelProfileIds: ["model-shared", `model-${suffix}`],
    knowledgeCollectionIds: [`knowledge-${suffix}`],
    modelRouting: {
      primaryModelProfileId: "model-shared",
      fallbackModelProfileIds: [`model-${suffix}`],
      reviewerModelProfileId: `model-${suffix}`,
      independentReviewRequired: true,
    },
    additionalRequiredApprovalActions: [`agent-review-${suffix}`, `workflow-external-${suffix}`],
    additionalForbiddenActions: [`Agent ${suffix} deploy is forbidden`],
    ...overrides,
  };
}

function makeAgentStep(suffix = "one", overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `execute-${suffix}`,
    kind: "agent_task",
    name: "Execute approved task",
    dependsOnStepIds: [`approve-${suffix}`],
    agentId: `agent-${suffix}`,
    agentBindingId: `agent-binding-${suffix}`,
    outputType: "patch",
    requestedResources: [{ resourceId: `repository-${suffix}`, capabilities: ["read_metadata", "propose_change"] }],
    modelProfileId: "model-shared",
    knowledgeCollectionIds: [`knowledge-${suffix}`],
    toolIds: ["tool-read"],
    maxAttempts: 2,
    timeoutMinutes: 30,
    actionMode: "external_action",
    requiredApprovalAction: `workflow-external-${suffix}`,
    ...overrides,
  };
}

function makeGate(suffix = "one", overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `approve-${suffix}`,
    kind: "approval_gate",
    name: "Owner approval",
    dependsOnStepIds: [],
    approvalAction: `workflow-external-${suffix}`,
    ...overrides,
  };
}

function makeWorkflow(suffix = "one", overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `workflow-${suffix}`,
    projectId: `project-${suffix}`,
    departmentId: `department-${suffix}`,
    version: 13,
    name: `Workflow ${suffix}`,
    summary: "Runs bounded approved work.",
    status: "active",
    triggerMode: "manual",
    goals: ["Produce reviewed output"],
    nonGoals: ["Deploy automatically"],
    steps: [makeAgentStep(suffix), makeGate(suffix)],
    finalStepIds: [`execute-${suffix}`],
    additionalRequiredApprovalActions: [`workflow-review-${suffix}`],
    additionalForbiddenActions: [`Workflow ${suffix} publish is forbidden`],
    ...overrides,
  };
}

function makeContext(suffix = "one") {
  return {
    projectManifest: makeProject(suffix),
    departmentManifests: [makeDepartment(suffix)],
    bindings: [makeBinding(suffix, "agent"), makeBinding(suffix, "workflow")],
  };
}

function makeRegistry(suffixes: readonly string[] = ["one"]) {
  return { workspaceId: "workspace-primary", projects: suffixes.map(makeContext) };
}

function makeCatalog(suffixes: readonly string[] = ["one"]) {
  return {
    registry: makeRegistry(suffixes),
    agents: suffixes.map((suffix) => ({ bindingId: `agent-binding-${suffix}`, agentManifest: makeAgent(suffix) })),
    workflows: suffixes.map((suffix) => ({ bindingId: `workflow-binding-${suffix}`, workflowManifest: makeWorkflow(suffix) })),
  };
}

function makePolicy(suffixes: readonly string[] = ["one"]) {
  return {
    workspaceId: "workspace-primary",
    status: "active",
    maxConcurrentRuns: 8,
    maxQueuedRuns: 512,
    projectPolicies: suffixes.map((suffix) => ({
      projectId: `project-${suffix}`,
      status: "active",
      maxQueuedRuns: 256,
      allowedPriorities: ["P0", "P1", "P2", "P3", "P4"],
    })),
  };
}

function makeRequest(suffix = "one", index = 1, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `request-${suffix}-${index}`,
    workspaceId: "workspace-primary",
    projectId: `project-${suffix}`,
    bindingId: `workflow-binding-${suffix}`,
    modelProfileId: "model-shared",
    idempotencyKey: `idempotency-${suffix}-${index}`,
    priority: "P2",
    sequence: index,
    ...overrides,
  };
}

function makeSchedulerInput(suffixes: readonly string[] = ["one"], registry = makeRegistry(suffixes)) {
  return {
    registry,
    policy: makePolicy(suffixes),
    queuedRequests: suffixes.map((suffix, index) => makeRequest(suffix, index + 1)),
    runningRuns: [],
    lastDispatchedProjectId: null,
  };
}

function makeCreation(suffixes: readonly string[] = ["one"]) {
  const workflowCatalog = makeCatalog(suffixes);
  return {
    runId: "run-one",
    requestId: "request-one-1",
    createdAt: "2026-08-23T10:15:30.000Z",
    schedulerInput: makeSchedulerInput(suffixes, clone(workflowCatalog.registry)),
    workflowCatalog,
  };
}

function codes(decision: Readonly<{ reasons: readonly { code: string }[] }>) {
  return decision.reasons.map((reason) => reason.code);
}

function requireInitial(input: unknown = makeCreation()) {
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  if (!decision.snapshot) throw new Error("Expected initial snapshot.");
  return decision.snapshot;
}

function event(
  snapshot: Readonly<{ runId: string; revision: number }>,
  kind: string,
  index: number,
  extra: Readonly<Record<string, unknown>> = {},
) {
  return {
    eventId: `event-${index}`,
    runId: snapshot.runId,
    kind,
    sequence: snapshot.revision + 1,
    occurredAt: `2026-08-23T10:15:${String(30 + index).padStart(2, "0")}.000Z`,
    actorKind: "owner",
    actorId: "owner-one",
    ...extra,
  };
}

function apply(snapshot: unknown, lifecycleEvent: unknown) {
  const decision = evaluateWorkflowRunTransition({ snapshot, event: lifecycleEvent });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  if (!decision.nextSnapshot) throw new Error("Expected next snapshot.");
  return decision.nextSnapshot;
}

function startRun(snapshot = requireInitial()) {
  return apply(snapshot, event(snapshot, "run_started", 1));
}

function reachAgentReady(snapshot = startRun()) {
  const requested = apply(snapshot, event(snapshot, "approval_requested", 2, {
    stepId: "approve-one",
    approvalRequestId: "approval-one",
  }));
  return apply(requested, event(requested, "approval_granted", 3, {
    stepId: "approve-one",
    approvalRequestId: "approval-one",
  }));
}

function completeSteps(snapshot = reachAgentReady()) {
  const started = apply(snapshot, event(snapshot, "step_started", 4, { stepId: "execute-one" }));
  return apply(started, event(started, "step_succeeded", 5, {
    stepId: "execute-one",
    outputArtifactIds: ["artifact-one", "artifact-one", "artifact-two"],
  }));
}

test("exports exact frozen enums and limits", () => {
  assert.deepEqual(workflowRunStatuses, ["queued", "running", "waiting_approval", "review", "completed", "failed", "blocked", "cancelled"]);
  assert.deepEqual(terminalWorkflowRunStatuses, ["completed", "failed", "blocked", "cancelled"]);
  assert.deepEqual(workflowRunStepStatuses, ["pending", "running", "waiting_approval", "success", "failed", "blocked", "cancelled"]);
  assert.deepEqual(workflowRunEventKinds, ["run_started", "step_started", "step_succeeded", "step_failed", "approval_requested", "approval_granted", "approval_rejected", "review_started", "run_completed", "run_blocked", "run_cancelled"]);
  assert.deepEqual(workflowRunActorKinds, ["owner", "system", "agent", "reviewer"]);
  assert.deepEqual(workflowRunVerdicts, ["allow", "deny"]);
  for (const value of [workflowRunStatuses, terminalWorkflowRunStatuses, workflowRunStepStatuses, workflowRunEventKinds, workflowRunActorKinds, workflowRunVerdicts, workflowRunLimits]) assert.equal(Object.isFrozen(value), true);
});

for (const value of workflowRunStatuses) test(`run status guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowRunStatus(value), true);
  assert.equal(parseWorkflowRunStatus(value), value);
});
for (const value of terminalWorkflowRunStatuses) test(`terminal status guard/parser accepts ${value}`, () => {
  assert.equal(isTerminalWorkflowRunStatus(value), true);
  assert.equal(parseTerminalWorkflowRunStatus(value), value);
});
for (const value of workflowRunStepStatuses) test(`step status guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowRunStepStatus(value), true);
  assert.equal(parseWorkflowRunStepStatus(value), value);
});
for (const value of workflowRunEventKinds) test(`event guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowRunEventKind(value), true);
  assert.equal(parseWorkflowRunEventKind(value), value);
});
for (const value of workflowRunActorKinds) test(`actor guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowRunActorKind(value), true);
  assert.equal(parseWorkflowRunActorKind(value), value);
});
for (const value of workflowRunVerdicts) test(`verdict guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowRunVerdict(value), true);
  assert.equal(parseWorkflowRunVerdict(value), value);
});

test("guards and parsers reject unknown values", () => {
  for (const [guard, parser] of [
    [isWorkflowRunStatus, parseWorkflowRunStatus],
    [isTerminalWorkflowRunStatus, parseTerminalWorkflowRunStatus],
    [isWorkflowRunStepStatus, parseWorkflowRunStepStatus],
    [isWorkflowRunEventKind, parseWorkflowRunEventKind],
    [isWorkflowRunActorKind, parseWorkflowRunActorKind],
    [isWorkflowRunVerdict, parseWorkflowRunVerdict],
  ] as const) {
    assert.equal(guard("unknown" as never), false);
    assert.equal(parser("unknown" as never), null);
  }
});

test("creation uses factual AI-017 dispatch and AI-020 resolution", () => {
  const input = makeCreation();
  const before = clone(input);
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.schedulerDecision?.verdict, "allow");
  assert.equal(decision.schedulerRegistryDecision?.verdict, "allow");
  assert.equal(decision.workflowCatalogDecision?.verdict, "allow");
  assert.equal(decision.workflowResolutionDecision?.verdict, "allow");
  assert.deepEqual(input, before);
});

for (const triggerMode of ["manual", "event", "scheduled", "api"] as const) test(`canonical ${triggerMode} trigger survives creation, validation, and run start`, () => {
  const input = makeCreation();
  input.workflowCatalog.workflows[0].workflowManifest.triggerMode = triggerMode;
  const creation = createWorkflowRunSnapshot(input);
  assert.equal(creation.verdict, "allow", JSON.stringify(creation.reasons));
  assert.ok(creation.snapshot);
  assert.equal(creation.snapshot.executionProfile.triggerMode, triggerMode);
  assert.equal(validateAndNormalizeWorkflowRunSnapshot(creation.snapshot).verdict, "allow");
  assert.equal(evaluateWorkflowRunTransition({
    snapshot: creation.snapshot,
    event: event(creation.snapshot, "run_started", 1),
  }).verdict, "allow");
});

test("non-canonical schedule trigger is denied", () => {
  const input = makeCreation();
  input.workflowCatalog.workflows[0].workflowManifest.triggerMode = "schedule";
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
});

test("creation final barrier denies an AI-020 profile that is not embedded-self-consistent", () => {
  const input = makeCreation();
  input.workflowCatalog.agents[0].agentManifest.additionalRequiredApprovalActions = ["agent-review-one"];
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.schedulerDecision?.verdict, "allow");
  assert.equal(decision.workflowCatalogDecision?.verdict, "allow");
  assert.equal(decision.workflowResolutionDecision?.verdict, "allow");
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
  assert.ok(codes(decision).includes("invalid_snapshot"));
});

test("initial snapshot is queued, exact, fresh, deeply frozen, and safe", () => {
  const first = requireInitial();
  const second = requireInitial();
  assert.equal(first.status, "queued");
  assert.equal(first.revision, 0);
  assert.equal(first.updatedAt, first.createdAt);
  assert.deepEqual(first.readyStepIds, ["approve-one"]);
  assert.deepEqual(first.events, []);
  assert.deepEqual(first.stepStates.map((step) => [step.stepId, step.kind, step.status, step.attemptCount, step.approvalRequestId, step.outputArtifactIds, step.lastError]), [
    ["approve-one", "approval_gate", "pending", 0, null, [], null],
    ["execute-one", "agent_task", "pending", 0, null, [], null],
  ]);
  assert.deepEqual(second, first);
  assert.notStrictEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.executionProfile), true);
  assert.equal(Object.isFrozen(first.stepStates[0]), true);
  const serialized = JSON.stringify(first);
  for (const raw of ["schedulerInput", "workflowCatalog", "resourceRef", "connectionId", "selectedProjectId", "owner/repository-one", "connection-one"]) assert.equal(serialized.includes(raw), false);
});

const creationFields = ["runId", "requestId", "createdAt", "schedulerInput", "workflowCatalog"] as const;
for (const field of creationFields) test(`creation rejects missing ${field}`, () => {
  const input = makeCreation() as unknown as Record<string, unknown>;
  delete input[field];
  assert.equal(createWorkflowRunSnapshot(input).verdict, "deny");
});

test("creation rejects unknown and UI-selected project fields", () => {
  for (const field of ["dispatch", "executionContext", "workflowId", "normalizedCatalog", "selectedProjectId", "activeProjectId", "currentProjectId"]) {
    const decision = createWorkflowRunSnapshot({ ...makeCreation(), [field]: "project-one" });
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.snapshot, null);
  }
});

test("creation rejects invalid IDs and non-canonical timestamps", () => {
  for (const overrides of [
    { runId: "UPPER" }, { requestId: "missing id" },
    { createdAt: "2026-08-23T10:15:30Z" }, { createdAt: "2026-02-30T10:15:30.000Z" },
  ]) assert.equal(createWorkflowRunSnapshot({ ...makeCreation(), ...overrides }).verdict, "deny");
});

test("creation ID and generic snapshot string limits are exact", () => {
  const exactId = makeCreation();
  exactId.runId = "r".repeat(workflowRunLimits.maxIdLength);
  assert.equal(createWorkflowRunSnapshot(exactId).verdict, "allow");
  const longId = makeCreation();
  longId.runId = "r".repeat(workflowRunLimits.maxIdLength + 1);
  assert.equal(createWorkflowRunSnapshot(longId).verdict, "deny");

  const exactString = {
    ...makeCreation(),
    extra: "x".repeat(workflowRunLimits.maxStringLength),
  };
  const exactDecision = createWorkflowRunSnapshot(exactString);
  assert.equal(exactDecision.verdict, "deny");
  assert.ok(!codes(exactDecision).includes("limit_exceeded"));
  const oversizedDecision = createWorkflowRunSnapshot({
    ...makeCreation(),
    extra: "x".repeat(workflowRunLimits.maxStringLength + 1),
  });
  assert.equal(oversizedDecision.verdict, "deny");
  assert.ok(codes(oversizedDecision).includes("limit_exceeded"));
});

test("creation rejects hostile roots, getters, proxies, cycles, Set/Map, and derived arrays without throw", () => {
  let calls = 0;
  const getter = makeCreation();
  Object.defineProperty(getter, "runId", { enumerable: true, get() { calls += 1; return "run-one"; } });
  const proxy = new Proxy(makeCreation(), { ownKeys() { throw new Error("no"); } });
  const cyclic = makeCreation() as unknown as Record<string, unknown>;
  cyclic.self = cyclic;
  class Derived<T> extends Array<T> {}
  const derived = makeCreation();
  derived.schedulerInput.queuedRequests = new Derived(...derived.schedulerInput.queuedRequests);
  for (const input of [null, [], new Set(), new Map(), getter, proxy, cyclic, derived, { ...makeCreation(), schedulerInput: { 0: "x", length: 1 } }]) {
    assert.doesNotThrow(() => createWorkflowRunSnapshot(input));
    assert.equal(createWorkflowRunSnapshot(input).verdict, "deny");
  }
  assert.equal(calls, 0);
});

test("creation rejects sparse arrays and inherited roots", () => {
  const sparse = makeCreation();
  sparse.schedulerInput.queuedRequests = Array(1) as never;
  assert.equal(createWorkflowRunSnapshot(sparse).verdict, "deny");
  assert.equal(createWorkflowRunSnapshot(Object.create(makeCreation())).verdict, "deny");
});

test("retained or blocked request cannot create a Run", () => {
  const input = makeCreation();
  input.schedulerInput.policy.status = "paused";
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
  assert.ok(codes(decision).includes("request_not_dispatched"));
  assert.ok(decision.schedulerDecision?.plan?.retainedRequestIds.includes(input.requestId));
});

test("locally capacity-blocked request cannot create a Run", () => {
  const input = makeCreation();
  const runningRuns = input.schedulerInput.runningRuns as unknown as Array<Record<string, unknown>>;
  runningRuns.push({
    runId: "running-one",
    requestId: "running-request-one",
    workspaceId: "workspace-primary",
    projectId: "project-one",
    bindingId: "workflow-binding-one",
    modelProfileId: "model-shared",
    idempotencyKey: "running-idempotency-one",
    priority: "P2",
    startedSequence: 1,
  });
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.schedulerDecision?.verdict, "allow");
  assert.ok(decision.schedulerDecision?.plan?.blockedRequests.some((entry) => entry.requestId === input.requestId));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
  assert.ok(codes(decision).includes("request_not_dispatched"));
});

function addOtherProjectRunningRun(input: ReturnType<typeof makeCreation>) {
  for (const registry of [input.schedulerInput.registry, input.workflowCatalog.registry]) {
    const project = registry.projects.find((candidate) => candidate.projectManifest.id === "project-two");
    const binding = project?.bindings.find((candidate) => candidate.id === "workflow-binding-two");
    assert.ok(binding);
    binding.requestedBudget.maxConcurrentRuns = 2;
  }
  const runningRuns = input.schedulerInput.runningRuns as unknown as Array<Record<string, unknown>>;
  runningRuns.push({
    runId: "existing-workflow-run",
    requestId: "running-request-two",
    workspaceId: "workspace-primary",
    projectId: "project-two",
    bindingId: "workflow-binding-two",
    modelProfileId: "model-shared",
    idempotencyKey: "running-idempotency-two",
    priority: "P2",
    startedSequence: 1,
  });
}

test("duplicate runId is denied after factual dispatch and before AI-020 evaluation", () => {
  const input = makeCreation(["one", "two"]);
  input.runId = "existing-workflow-run";
  addOtherProjectRunningRun(input);
  const before = clone(input);
  const first = createWorkflowRunSnapshot(input);
  const repeated = createWorkflowRunSnapshot(input);
  assert.equal(first.schedulerDecision?.verdict, "allow");
  assert.ok(first.schedulerDecision?.plan?.dispatches.some((dispatch) => dispatch.request.id === input.requestId));
  assert.equal(first.verdict, "deny");
  assert.deepEqual(codes(first), ["duplicate_run_id"]);
  assert.equal(first.snapshot, null);
  assert.equal(first.schedulerRegistryDecision, null);
  assert.equal(first.workflowCatalogDecision, null);
  assert.equal(first.workflowResolutionDecision, null);
  assert.deepEqual(repeated, first);
  assert.deepEqual(input, before);

  const distinctRun = clone(input);
  distinctRun.runId = "new-workflow-run";
  assert.equal(createWorkflowRunSnapshot(distinctRun).verdict, "allow");
});

test("duplicate runId decision is canonical across reversed Project, queue, and policy order", () => {
  const forward = makeCreation(["one", "two"]);
  forward.runId = "existing-workflow-run";
  addOtherProjectRunningRun(forward);
  const reverse = clone(forward);
  reverse.schedulerInput.registry.projects.reverse();
  reverse.schedulerInput.policy.projectPolicies.reverse();
  reverse.schedulerInput.queuedRequests.reverse();
  reverse.workflowCatalog.registry.projects.reverse();
  reverse.workflowCatalog.agents.reverse();
  reverse.workflowCatalog.workflows.reverse();
  assert.deepEqual(createWorkflowRunSnapshot(reverse), createWorkflowRunSnapshot(forward));
});

test("invalid scheduler state preserves factual deny", () => {
  const input = makeCreation();
  input.schedulerInput.policy.maxConcurrentRuns = 0;
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.schedulerDecision?.verdict, "deny");
  assert.ok(codes(decision).includes("invalid_scheduler_decision"));
});

test("unknown request is denied without partial snapshot", () => {
  const decision = createWorkflowRunSnapshot({ ...makeCreation(), requestId: "request-missing" });
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
  assert.ok(codes(decision).includes("request_not_dispatched"));
});

test("Agent binding dispatch cannot create a Workflow Run", () => {
  const input = makeCreation();
  input.schedulerInput.queuedRequests[0].bindingId = "agent-binding-one";
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("workflow_binding_not_found"));
});

test("scheduler/catalog Registry mismatch fails closed", () => {
  const input = makeCreation();
  input.schedulerInput.registry.projects[0].projectManifest.version = 4;
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
  assert.ok(codes(decision).includes("registry_context_mismatch"));
});

test("model mismatch is denied by factual scheduler or Workflow allowlist", () => {
  const input = makeCreation();
  input.schedulerInput.queuedRequests[0].modelProfileId = "model-one";
  Object.assign(input.workflowCatalog.workflows[0].workflowManifest.steps[0], {
    modelProfileId: "model-shared",
  });
  const allowed = createWorkflowRunSnapshot(input);
  assert.equal(allowed.verdict, "allow");
  const denied = makeCreation();
  denied.schedulerInput.queuedRequests[0].modelProfileId = "model-missing";
  assert.equal(createWorkflowRunSnapshot(denied).verdict, "deny");
});

for (const status of ["draft", "paused", "disabled"] as const) test(`inactive Workflow ${status} cannot create Run`, () => {
  const input = makeCreation();
  input.workflowCatalog.workflows[0].workflowManifest.status = status;
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
  assert.ok(codes(decision).includes("workflow_resolution_denied"));
});

for (const status of ["draft", "paused", "disabled"] as const) test(`inactive Workflow binding ${status} cannot create Run`, () => {
  const input = makeCreation();
  input.schedulerInput.registry.projects[0].bindings[1].status = status;
  input.workflowCatalog.registry.projects[0].bindings[1].status = status;
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
});

test("multi-project creation uses exact factual request without fallback", () => {
  const input = makeCreation(["one", "two"]);
  const decision = createWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.equal(decision.snapshot?.projectId, "project-one");
  assert.equal(decision.snapshot?.workflowId, "workflow-one");
  assert.equal(decision.snapshot?.workflowBindingId, "workflow-binding-one");
});

test("reverse scheduler/catalog order remains deterministic", () => {
  const forward = makeCreation(["one", "two"]);
  const reverse = makeCreation(["two", "one"]);
  const reverseRequest = reverse.schedulerInput.queuedRequests.find(
    (request) => request.projectId === "project-one",
  );
  assert.ok(reverseRequest);
  reverseRequest.id = "request-one-1";
  reverseRequest.idempotencyKey = "idempotency-one-1";
  reverseRequest.sequence = 1;
  reverse.requestId = reverseRequest.id;
  const forwardDecision = createWorkflowRunSnapshot(forward);
  const reverseDecision = createWorkflowRunSnapshot(reverse);
  assert.equal(forwardDecision.verdict, "allow");
  assert.equal(reverseDecision.verdict, "allow");
  assert.deepEqual(reverseDecision.snapshot, forwardDecision.snapshot);
});

test("queued accepts only run_started, explicit block, or explicit cancel", () => {
  const initial = requireInitial();
  for (const invalid of [
    event(initial, "review_started", 1),
    event(initial, "run_completed", 1),
    event(initial, "step_started", 1, { stepId: "execute-one" }),
  ]) {
    const decision = evaluateWorkflowRunTransition({ snapshot: initial, event: invalid });
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.nextSnapshot, null);
  }
  assert.equal(apply(initial, event(initial, "run_blocked", 1, { reasonCode: "owner-block", message: "Blocked by Owner" })).status, "blocked");
  assert.equal(apply(initial, event(initial, "run_cancelled", 1, { reasonCode: "owner-cancel", message: "Cancelled by Owner" })).status, "cancelled");
});

test("queued to running recomputes exact root readiness", () => {
  const initial = requireInitial();
  const running = startRun(initial);
  assert.equal(running.status, "running");
  assert.equal(running.revision, 1);
  assert.deepEqual(running.readyStepIds, ["approve-one"]);
  assert.equal(initial.status, "queued");
  assert.equal(initial.revision, 0);
});

test("approval request and grant enforce exact placeholder reference", () => {
  const running = startRun();
  const waiting = apply(running, event(running, "approval_requested", 2, { stepId: "approve-one", approvalRequestId: "approval-one" }));
  assert.equal(waiting.status, "waiting_approval");
  assert.equal(waiting.stepStates[0].status, "waiting_approval");
  assert.equal(waiting.stepStates[0].approvalRequestId, "approval-one");
  assert.deepEqual(waiting.readyStepIds, []);
  const wrong = evaluateWorkflowRunTransition({ snapshot: waiting, event: event(waiting, "approval_granted", 3, { stepId: "approve-one", approvalRequestId: "approval-other" }) });
  assert.equal(wrong.verdict, "deny");
  assert.ok(codes(wrong).includes("approval_mismatch"));
  const granted = apply(waiting, event(waiting, "approval_granted", 3, { stepId: "approve-one", approvalRequestId: "approval-one" }));
  assert.equal(granted.status, "running");
  assert.equal(granted.stepStates[0].status, "success");
  assert.equal(granted.stepStates[0].approvalRequestId, "approval-one");
  assert.deepEqual(granted.readyStepIds, ["execute-one"]);
});

test("approval rejection blocks run and every non-terminal step", () => {
  const running = startRun();
  const waiting = apply(running, event(running, "approval_requested", 2, { stepId: "approve-one", approvalRequestId: "approval-one" }));
  const rejected = apply(waiting, event(waiting, "approval_rejected", 3, { stepId: "approve-one", approvalRequestId: "approval-one", reason: "Owner rejected" }));
  assert.equal(rejected.status, "blocked");
  assert.deepEqual(rejected.stepStates.map((step) => step.status), ["blocked", "blocked"]);
});

test("approval events reject Agent tasks and execution events reject gates", () => {
  const running = startRun();
  const agentApproval = evaluateWorkflowRunTransition({ snapshot: running, event: event(running, "approval_requested", 2, { stepId: "execute-one", approvalRequestId: "approval-one" }) });
  assert.equal(agentApproval.verdict, "deny");
  assert.ok(codes(agentApproval).includes("wrong_step_kind"));
  const gateStart = evaluateWorkflowRunTransition({ snapshot: running, event: event(running, "step_started", 2, { stepId: "approve-one" }) });
  assert.equal(gateStart.verdict, "deny");
  assert.ok(codes(gateStart).includes("wrong_step_kind"));
});

test("dependency prevents Agent start before approval success", () => {
  const running = startRun();
  const decision = evaluateWorkflowRunTransition({ snapshot: running, event: event(running, "step_started", 2, { stepId: "execute-one" }) });
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("step_not_ready"));
});

test("Agent task start increments attempt and success deduplicates artifacts", () => {
  const ready = reachAgentReady();
  const started = apply(ready, event(ready, "step_started", 4, { stepId: "execute-one" }));
  assert.equal(started.stepStates[1].status, "running");
  assert.equal(started.stepStates[1].attemptCount, 1);
  const succeeded = apply(started, event(started, "step_succeeded", 5, { stepId: "execute-one", outputArtifactIds: ["artifact-two", "artifact-one", "artifact-two"] }));
  assert.equal(succeeded.stepStates[1].status, "success");
  assert.deepEqual(succeeded.stepStates[1].outputArtifactIds, ["artifact-two", "artifact-one"]);
  assert.equal(succeeded.stepStates[1].lastError, null);
});

test("retryable failure below max attempts returns step to ready pending", () => {
  const ready = reachAgentReady();
  const started = apply(ready, event(ready, "step_started", 4, { stepId: "execute-one" }));
  const failed = apply(started, event(started, "step_failed", 5, { stepId: "execute-one", error: { code: "temporary", message: "Try again", retryable: true } }));
  assert.equal(failed.status, "running");
  assert.equal(failed.stepStates[1].status, "pending");
  assert.equal(failed.stepStates[1].attemptCount, 1);
  assert.deepEqual(failed.stepStates[1].lastError, { code: "temporary", message: "Try again", retryable: true });
  assert.deepEqual(failed.readyStepIds, ["execute-one"]);
});

test("retryable failure at max attempts fails run and blocks remaining", () => {
  const ready = reachAgentReady();
  const firstStart = apply(ready, event(ready, "step_started", 4, { stepId: "execute-one" }));
  const firstFailure = apply(firstStart, event(firstStart, "step_failed", 5, { stepId: "execute-one", error: { code: "temporary", message: "Again", retryable: true } }));
  const secondStart = apply(firstFailure, event(firstFailure, "step_started", 6, { stepId: "execute-one" }));
  const finalFailure = apply(secondStart, event(secondStart, "step_failed", 7, { stepId: "execute-one", error: { code: "temporary", message: "Still failing", retryable: true } }));
  assert.equal(finalFailure.status, "failed");
  assert.equal(finalFailure.stepStates[1].status, "failed");
  assert.equal(finalFailure.stepStates[1].attemptCount, 2);
});

test("non-retryable failure immediately fails run", () => {
  const ready = reachAgentReady();
  const started = apply(ready, event(ready, "step_started", 4, { stepId: "execute-one" }));
  const failed = apply(started, event(started, "step_failed", 5, { stepId: "execute-one", error: { code: "fatal", message: "Cannot continue", retryable: false } }));
  assert.equal(failed.status, "failed");
  assert.equal(failed.stepStates[1].status, "failed");
});

test("review requires every step success and completion requires review", () => {
  const running = startRun();
  assert.equal(evaluateWorkflowRunTransition({ snapshot: running, event: event(running, "review_started", 2) }).verdict, "deny");
  const complete = completeSteps();
  assert.equal(evaluateWorkflowRunTransition({ snapshot: complete, event: event(complete, "run_completed", 6) }).verdict, "deny");
  const review = apply(complete, event(complete, "review_started", 6));
  assert.equal(review.status, "review");
  const finished = apply(review, event(review, "run_completed", 7));
  assert.equal(finished.status, "completed");
});

test("explicit block and cancel affect every non-terminal step", () => {
  for (const [kind, expected] of [["run_blocked", "blocked"], ["run_cancelled", "cancelled"]] as const) {
    const running = startRun();
    const next = apply(running, event(running, kind, 2, { reasonCode: "owner-stop", message: "Owner stopped run" }));
    assert.equal(next.status, expected);
    assert.ok(next.stepStates.every((step) => step.status === expected));
  }
});

for (const terminal of ["completed", "failed", "blocked", "cancelled"] as const) test(`terminal ${terminal} rejects every next event`, () => {
  let snapshot;
  if (terminal === "completed") {
    const complete = completeSteps();
    const review = apply(complete, event(complete, "review_started", 6));
    snapshot = apply(review, event(review, "run_completed", 7));
  } else if (terminal === "failed") {
    const ready = reachAgentReady();
    const started = apply(ready, event(ready, "step_started", 4, { stepId: "execute-one" }));
    snapshot = apply(started, event(started, "step_failed", 5, { stepId: "execute-one", error: { code: "fatal", message: "Failed", retryable: false } }));
  } else {
    const running = startRun();
    const kind = terminal === "blocked" ? "run_blocked" : "run_cancelled";
    snapshot = apply(running, event(running, kind, 2, { reasonCode: "stop", message: "Stopped" }));
  }
  const decision = evaluateWorkflowRunTransition({ snapshot, event: event(snapshot, "run_cancelled", 9, { reasonCode: "again", message: "Again" }) });
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("terminal_run"));
});

test("parallel root Agent tasks can run concurrently", () => {
  const input = makeCreation();
  input.workflowCatalog.workflows[0].workflowManifest.steps = [
    makeAgentStep("one", { id: "parallel-a", dependsOnStepIds: [], actionMode: "none", requiredApprovalAction: null }),
    makeAgentStep("one", { id: "parallel-b", dependsOnStepIds: [], actionMode: "none", requiredApprovalAction: null }),
  ];
  input.workflowCatalog.workflows[0].workflowManifest.finalStepIds = ["parallel-a", "parallel-b"];
  const initial = requireInitial(input);
  assert.deepEqual(initial.readyStepIds, ["parallel-a", "parallel-b"]);
  const running = startRun(initial);
  const first = apply(running, event(running, "step_started", 2, { stepId: "parallel-a" }));
  const second = apply(first, event(first, "step_started", 3, { stepId: "parallel-b" }));
  assert.deepEqual(second.stepStates.map((step) => step.status), ["running", "running"]);
});

test("waiting approval prevents starting another otherwise-ready Agent step", () => {
  const input = makeCreation();
  input.workflowCatalog.workflows[0].workflowManifest.steps = [
    makeGate(),
    makeAgentStep("one", { id: "parallel", dependsOnStepIds: [], actionMode: "none", requiredApprovalAction: null }),
    makeAgentStep(),
  ];
  input.workflowCatalog.workflows[0].workflowManifest.finalStepIds = ["parallel", "execute-one"];
  const initial = requireInitial(input);
  const running = startRun(initial);
  const waiting = apply(running, event(running, "approval_requested", 2, { stepId: "approve-one", approvalRequestId: "approval-one" }));
  const decision = evaluateWorkflowRunTransition({ snapshot: waiting, event: event(waiting, "step_started", 3, { stepId: "parallel" }) });
  assert.equal(decision.verdict, "deny");
});

test("event contract rejects missing, unknown, and wrong discriminant fields", () => {
  const running = startRun();
  const valid = event(running, "approval_requested", 2, { stepId: "approve-one", approvalRequestId: "approval-one" });
  for (const candidate of [
    { ...valid, unknown: true },
    (() => { const value = { ...valid } as Record<string, unknown>; delete value.eventId; return value; })(),
    { ...valid, outputArtifactIds: [] },
  ]) {
    const decision = evaluateWorkflowRunTransition({ snapshot: running, event: candidate });
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.normalizedEvent, null);
    assert.equal(decision.nextSnapshot, null);
  }
});

test("event rejects wrong run ID, duplicate ID, sequence gaps, and timestamp regression", () => {
  const initial = requireInitial();
  const running = startRun(initial);
  const cases = [
    event(running, "run_cancelled", 2, { runId: "run-other", reasonCode: "x", message: "x" }),
    event(running, "run_cancelled", 2, { eventId: "event-1", reasonCode: "x", message: "x" }),
    event(running, "run_cancelled", 2, { sequence: 9, reasonCode: "x", message: "x" }),
    event(running, "run_cancelled", 2, { occurredAt: "2026-08-23T10:15:29.000Z", reasonCode: "x", message: "x" }),
  ];
  const expected = ["run_id_mismatch", "duplicate_event_id", "invalid_sequence", "timestamp_regression"];
  cases.forEach((candidate, index) => assert.ok(codes(evaluateWorkflowRunTransition({ snapshot: running, event: candidate })).includes(expected[index])));
});

test("output artifact IDs enforce exact limit and stable deduplication", () => {
  const ready = reachAgentReady();
  const started = apply(ready, event(ready, "step_started", 4, { stepId: "execute-one" }));
  const exact = Array.from({ length: workflowRunLimits.maxOutputArtifactIds }, (_, index) => `artifact-${index}`);
  const success = apply(started, event(started, "step_succeeded", 5, { stepId: "execute-one", outputArtifactIds: exact }));
  assert.equal(success.stepStates[1].outputArtifactIds.length, workflowRunLimits.maxOutputArtifactIds);
  const overflow = evaluateWorkflowRunTransition({ snapshot: started, event: event(started, "step_succeeded", 5, { stepId: "execute-one", outputArtifactIds: [...exact, "artifact-overflow"] }) });
  assert.equal(overflow.verdict, "deny");
  assert.ok(codes(overflow).includes("limit_exceeded"));
});

test("invalid artifact IDs fail closed instead of being silently discarded", () => {
  const ready = reachAgentReady();
  const started = apply(ready, event(ready, "step_started", 4, { stepId: "execute-one" }));
  const decision = evaluateWorkflowRunTransition({
    snapshot: started,
    event: event(started, "step_succeeded", 5, {
      stepId: "execute-one",
      outputArtifactIds: ["artifact-valid", "INVALID ARTIFACT"],
    }),
  });
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedEvent, null);
  assert.equal(decision.nextSnapshot, null);
  assert.ok(codes(decision).includes("invalid_event"));
});

test("actor and bounded lifecycle text limits accept exact values and deny limit plus one", () => {
  const initial = requireInitial();
  assert.equal(evaluateWorkflowRunTransition({
    snapshot: initial,
    event: { ...event(initial, "run_started", 1), actorId: "a".repeat(workflowRunLimits.maxActorIdLength) },
  }).verdict, "allow");
  assert.equal(evaluateWorkflowRunTransition({
    snapshot: initial,
    event: { ...event(initial, "run_started", 1), actorId: "a".repeat(workflowRunLimits.maxActorIdLength + 1) },
  }).verdict, "deny");

  const ready = reachAgentReady();
  const started = apply(ready, event(ready, "step_started", 4, { stepId: "execute-one" }));
  const exactError = {
    code: "c".repeat(workflowRunLimits.maxErrorCodeLength),
    message: "m".repeat(workflowRunLimits.maxErrorMessageLength),
    retryable: true,
  };
  const exactFailure = event(started, "step_failed", 5, {
    stepId: "execute-one",
    error: exactError,
  });
  assert.equal(evaluateWorkflowRunTransition({ snapshot: started, event: exactFailure }).verdict, "allow");
  const oversizedFailure = event(started, "step_failed", 5, {
    stepId: "execute-one",
    error: { ...exactError, message: `${exactError.message}m` },
  });
  assert.equal(evaluateWorkflowRunTransition({ snapshot: started, event: oversizedFailure }).verdict, "deny");
});

test("snapshot validation rejects nested execution profile schema tampering", () => {
  const unknownStepField = mutableSnapshot();
  const profileWithUnknown = unknownStepField.executionProfile as { steps: Array<Record<string, unknown>> };
  profileWithUnknown.steps[0].rawPayload = "not-authoritative";
  assert.equal(validateAndNormalizeWorkflowRunSnapshot(unknownStepField).verdict, "deny");

  const alteredDependency = mutableSnapshot();
  const alteredProfile = alteredDependency.executionProfile as { steps: Array<{ dependsOnStepIds: string[] }> };
  alteredProfile.steps[1].dependsOnStepIds = ["step-missing"];
  assert.equal(validateAndNormalizeWorkflowRunSnapshot(alteredDependency).verdict, "deny");
});

type ProfileTamper = (profile: MutableExecutionProfile) => void;

const profileTamperCases: readonly (readonly [string, ProfileTamper])[] = [
  ["unknown Agent role", (profile) => {
    mutableAgent(profile).roleCode = "unknown-role" as never;
  }],
  ["unknown Agent output type", (profile) => {
    mutableAgent(profile).outputTypes[0] = "unknown-output" as never;
  }],
  ["step output outside Agent grants", (profile) => {
    mutableAgent(profile).outputTypes = ["test_report"];
  }],
  ["step model outside Workflow grants", (profile) => {
    const agent = mutableAgent(profile);
    agent.allowedModelProfileIds.push("model-agent-only");
    mutableAgentTask(profile).modelProfileId = "model-agent-only";
  }],
  ["step model outside Agent grants", (profile) => {
    profile.modelProfileIds.push("model-workflow-only");
    mutableAgentTask(profile).modelProfileId = "model-workflow-only";
  }],
  ["Knowledge outside Workflow grants", (profile) => {
    mutableAgent(profile).knowledgeCollectionIds.push("knowledge-agent-only");
    mutableAgentTask(profile).knowledgeCollectionIds = ["knowledge-agent-only"];
  }],
  ["Knowledge outside Agent grants", (profile) => {
    profile.knowledgeCollectionIds.push("knowledge-workflow-only");
    mutableAgentTask(profile).knowledgeCollectionIds = ["knowledge-workflow-only"];
  }],
  ["tool outside Agent grants", (profile) => {
    mutableAgentTask(profile).toolIds = ["tool-not-granted"];
  }],
  ["resource outside Workflow grants", (profile) => {
    mutableAgent(profile).resources.push({ resourceId: "resource-agent-only", capabilities: ["read_metadata"] });
    mutableAgentTask(profile).requestedResources = [{ resourceId: "resource-agent-only", capabilities: ["read_metadata"] }];
  }],
  ["resource outside Agent grants", (profile) => {
    profile.resources.push({ resourceId: "resource-workflow-only", capabilities: ["read_metadata"] });
    mutableAgentTask(profile).requestedResources = [{ resourceId: "resource-workflow-only", capabilities: ["read_metadata"] }];
  }],
  ["capability outside one grant side", (profile) => {
    const task = mutableAgentTask(profile);
    task.requestedResources[0].capabilities.push("read_content");
    profile.resources[0].capabilities.push("read_content");
  }],
  ["maxAttempts above embedded ceiling", (profile) => {
    const agent = mutableAgent(profile);
    mutableAgentTask(profile).maxAttempts = Math.min(profile.budget.maxAttemptsPerRun, agent.budget.maxAttemptsPerRun) + 1;
  }],
  ["timeoutMinutes above embedded ceiling", (profile) => {
    const agent = mutableAgent(profile);
    mutableAgentTask(profile).timeoutMinutes = Math.min(profile.budget.maxRunMinutes, agent.budget.maxRunMinutes) + 1;
  }],
  ["invalid action mode and approval combination", (profile) => {
    mutableAgentTask(profile).actionMode = "none";
  }],
  ["external action without matching ancestral gate", (profile) => {
    const gate = profile.steps.find((step) => step.kind === "approval_gate");
    assert.ok(gate && gate.kind === "approval_gate");
    gate.approvalAction = "workflow-review-one";
  }],
  ["duplicate embedded Agent identity", (profile) => {
    profile.agents.push(clone(mutableAgent(profile)));
  }],
  ["unused embedded Agent identity", (profile) => {
    const unused = clone(mutableAgent(profile));
    unused.agentId = "agent-unused";
    unused.bindingId = "agent-binding-unused";
    profile.agents.push(unused);
  }],
  ["duplicate canonical grants", (profile) => {
    profile.modelProfileIds.push(profile.modelProfileIds[0]);
  }],
];

for (const [name, tamper] of profileTamperCases) test(`embedded profile denies ${name}`, () => {
  const snapshot = mutableSnapshot();
  tamper(mutableProfile(snapshot));
  const before = clone(snapshot);
  const first = validateAndNormalizeWorkflowRunSnapshot(snapshot);
  const repeated = validateAndNormalizeWorkflowRunSnapshot(snapshot);
  assert.equal(first.verdict, "deny");
  assert.equal(first.normalizedSnapshot, null);
  assert.deepEqual(repeated, first);
  const transition = evaluateWorkflowRunTransition({
    snapshot,
    event: event(snapshot as unknown as { runId: string; revision: number }, "run_started", 1),
  });
  assert.equal(transition.verdict, "deny");
  assert.equal(transition.normalizedEvent, null);
  assert.equal(transition.nextSnapshot, null);
  assert.deepEqual(snapshot, before);
});

function exactGrantIds(required: readonly string[], count: number, prefix: string): string[] {
  const values = [...new Set(required)];
  for (let index = 0; values.length < count; index += 1) values.push(`${prefix}-${index}`);
  return values;
}

function assertEmbeddedSnapshotAllowed(snapshot: MutableSnapshot) {
  const before = clone(snapshot);
  const first = validateAndNormalizeWorkflowRunSnapshot(snapshot);
  const repeated = validateAndNormalizeWorkflowRunSnapshot(snapshot);
  assert.equal(first.verdict, "allow", JSON.stringify(first.reasons));
  assert.ok(first.normalizedSnapshot);
  assert.deepEqual(repeated, first);
  assert.notStrictEqual(repeated.normalizedSnapshot, first.normalizedSnapshot);
  assert.equal(Object.isFrozen(first.normalizedSnapshot), true);
  assert.equal(Object.isFrozen(first.normalizedSnapshot.executionProfile), true);
  assert.equal(evaluateWorkflowRunTransition({
    snapshot,
    event: event(snapshot as unknown as { runId: string; revision: number }, "run_started", 1),
  }).verdict, "allow");
  assert.deepEqual(snapshot, before);
}

function assertEmbeddedSnapshotDenied(snapshot: MutableSnapshot) {
  const before = clone(snapshot);
  const first = validateAndNormalizeWorkflowRunSnapshot(snapshot);
  const repeated = validateAndNormalizeWorkflowRunSnapshot(snapshot);
  assert.equal(first.verdict, "deny");
  assert.equal(first.normalizedSnapshot, null);
  assert.deepEqual(repeated, first);
  const transition = evaluateWorkflowRunTransition({
    snapshot,
    event: event(snapshot as unknown as { runId: string; revision: number }, "run_started", 1),
  });
  assert.equal(transition.verdict, "deny");
  assert.equal(transition.normalizedEvent, null);
  assert.equal(transition.nextSnapshot, null);
  assert.deepEqual(snapshot, before);
}

test("Workflow model grants enforce the canonical AI-013 boundary", () => {
  const exact = mutableSnapshot();
  const exactProfile = mutableProfile(exact);
  exactProfile.modelProfileIds = exactGrantIds(
    [exact.modelProfileId as string, mutableAgentTask(exactProfile).modelProfileId],
    projectManifestLimits.maxModelProfileIds,
    "workflow-model",
  );
  assertEmbeddedSnapshotAllowed(exact);
  const overflow = clone(exact);
  mutableProfile(overflow).modelProfileIds.push("workflow-model-overflow");
  assertEmbeddedSnapshotDenied(overflow);
});

test("Workflow Knowledge grants enforce the canonical AI-013 boundary", () => {
  const exact = mutableSnapshot();
  const profile = mutableProfile(exact);
  profile.knowledgeCollectionIds = exactGrantIds(
    mutableAgentTask(profile).knowledgeCollectionIds,
    projectManifestLimits.maxKnowledgeCollectionIds,
    "workflow-knowledge",
  );
  assertEmbeddedSnapshotAllowed(exact);
  const overflow = clone(exact);
  mutableProfile(overflow).knowledgeCollectionIds.push("workflow-knowledge-overflow");
  assertEmbeddedSnapshotDenied(overflow);
});

test("Agent Workflow grants enforce the canonical AI-019 boundary", () => {
  const exact = mutableSnapshot();
  const profile = mutableProfile(exact);
  mutableAgent(profile).allowedWorkflowIds = exactGrantIds(
    [profile.workflowId],
    agentManifestLimits.maxWorkflowIds,
    "agent-workflow",
  );
  assertEmbeddedSnapshotAllowed(exact);
  const overflow = clone(exact);
  mutableAgent(mutableProfile(overflow)).allowedWorkflowIds.push("agent-workflow-overflow");
  assertEmbeddedSnapshotDenied(overflow);
});

test("Agent tool grants enforce the canonical AI-019 boundary", () => {
  const exact = mutableSnapshot();
  const profile = mutableProfile(exact);
  mutableAgent(profile).allowedToolIds = exactGrantIds(
    mutableAgentTask(profile).toolIds,
    agentManifestLimits.maxToolIds,
    "agent-tool",
  );
  assertEmbeddedSnapshotAllowed(exact);
  const overflow = clone(exact);
  mutableAgent(mutableProfile(overflow)).allowedToolIds.push("agent-tool-overflow");
  assertEmbeddedSnapshotDenied(overflow);
});

test("Agent model grants enforce the canonical AI-019 boundary", () => {
  const exact = mutableSnapshot();
  const profile = mutableProfile(exact);
  const agent = mutableAgent(profile);
  agent.allowedModelProfileIds = exactGrantIds(
    [agent.modelRouting.primaryModelProfileId, ...agent.modelRouting.fallbackModelProfileIds, agent.modelRouting.reviewerModelProfileId as string],
    agentManifestLimits.maxModelProfileIds,
    "agent-model",
  );
  assertEmbeddedSnapshotAllowed(exact);
  const overflow = clone(exact);
  mutableAgent(mutableProfile(overflow)).allowedModelProfileIds.push("agent-model-overflow");
  assertEmbeddedSnapshotDenied(overflow);
});

test("Agent fallback models enforce the canonical AI-019 boundary", () => {
  const exact = mutableSnapshot();
  const profile = mutableProfile(exact);
  const agent = mutableAgent(profile);
  const fallback = exactGrantIds(
    [agent.modelRouting.reviewerModelProfileId as string],
    agentManifestLimits.maxFallbackModelProfileIds,
    "fallback-model",
  );
  agent.allowedModelProfileIds = exactGrantIds(
    [agent.modelRouting.primaryModelProfileId, ...fallback],
    agentManifestLimits.maxModelProfileIds,
    "agent-model",
  );
  agent.modelRouting.fallbackModelProfileIds = fallback;
  assertEmbeddedSnapshotAllowed(exact);
  const overflow = clone(exact);
  mutableAgent(mutableProfile(overflow)).modelRouting.fallbackModelProfileIds.push("agent-model-9");
  assertEmbeddedSnapshotDenied(overflow);
});

test("Agent Knowledge grants enforce the canonical AI-019 boundary", () => {
  const exact = mutableSnapshot();
  const profile = mutableProfile(exact);
  mutableAgent(profile).knowledgeCollectionIds = exactGrantIds(
    mutableAgentTask(profile).knowledgeCollectionIds,
    agentManifestLimits.maxKnowledgeCollectionIds,
    "agent-knowledge",
  );
  assertEmbeddedSnapshotAllowed(exact);
  const overflow = clone(exact);
  mutableAgent(mutableProfile(overflow)).knowledgeCollectionIds.push("agent-knowledge-overflow");
  assertEmbeddedSnapshotDenied(overflow);
});

const minimumProjectBudget = {
  maxConcurrentRuns: 1,
  maxAttemptsPerRun: 1,
  maxRunMinutes: 1,
  dailyTokenBudget: 0,
  monthlyCostBudgetUsdCents: 0,
};
const maximumProjectBudget = {
  maxConcurrentRuns: 16,
  maxAttemptsPerRun: 3,
  maxRunMinutes: 240,
  dailyTokenBudget: 1_000_000_000,
  monthlyCostBudgetUsdCents: 100_000_000,
};

function applyEmbeddedBudget(snapshot: MutableSnapshot, budget: typeof minimumProjectBudget) {
  const profile = mutableProfile(snapshot);
  profile.budget = { ...budget };
  mutableAgent(profile).budget = { ...budget };
  mutableAgentTask(profile).maxAttempts = Math.min(mutableAgentTask(profile).maxAttempts, budget.maxAttemptsPerRun);
  mutableAgentTask(profile).timeoutMinutes = Math.min(mutableAgentTask(profile).timeoutMinutes, budget.maxRunMinutes);
}

test("AI-013 minimum and maximum budgets remain valid embedded snapshots", () => {
  const minimum = mutableSnapshot();
  applyEmbeddedBudget(minimum, minimumProjectBudget);
  assertEmbeddedSnapshotAllowed(minimum);
  const maximum = mutableSnapshot();
  applyEmbeddedBudget(maximum, maximumProjectBudget);
  assertEmbeddedSnapshotAllowed(maximum);
});

const invalidBudgetValues = [
  ["maxConcurrentRuns", 0],
  ["maxConcurrentRuns", 17],
  ["maxAttemptsPerRun", 0],
  ["maxAttemptsPerRun", 4],
  ["maxRunMinutes", 0],
  ["maxRunMinutes", 241],
  ["dailyTokenBudget", -1],
  ["dailyTokenBudget", 1_000_000_001],
  ["monthlyCostBudgetUsdCents", -1],
  ["monthlyCostBudgetUsdCents", 100_000_001],
] as const;

for (const [field, value] of invalidBudgetValues) test(`AI-013 budget denies ${field}=${value}`, () => {
  const snapshot = mutableSnapshot();
  const profile = mutableProfile(snapshot);
  Object.assign(profile.budget, { [field]: value });
  assertEmbeddedSnapshotDenied(snapshot);
});

test("snapshot validation replays valid history deterministically and freshly", () => {
  const snapshot = completeSteps();
  const first = validateAndNormalizeWorkflowRunSnapshot(snapshot);
  const repeated = validateAndNormalizeWorkflowRunSnapshot(snapshot);
  assert.equal(first.verdict, "allow");
  assert.deepEqual(repeated, first);
  assert.notStrictEqual(repeated.normalizedSnapshot, first.normalizedSnapshot);
  assert.equal(Object.isFrozen(repeated.normalizedSnapshot), true);
});

const tamperCases = [
  ["status", (snapshot: MutableSnapshot) => { snapshot.status = "completed"; }],
  ["step status", (snapshot: MutableSnapshot) => { snapshot.stepStates[0].status = "pending"; }],
  ["attempt", (snapshot: MutableSnapshot) => { snapshot.stepStates[1].attemptCount = 99; }],
  ["approval", (snapshot: MutableSnapshot) => { snapshot.stepStates[0].approvalRequestId = "approval-other"; }],
  ["output", (snapshot: MutableSnapshot) => { snapshot.stepStates[1].outputArtifactIds = ["altered"]; }],
  ["last error", (snapshot: MutableSnapshot) => { snapshot.stepStates[1].lastError = { code: "x", message: "x", retryable: false }; }],
  ["ready", (snapshot: MutableSnapshot) => { snapshot.readyStepIds = ["execute-one"]; }],
  ["removed event", (snapshot: MutableSnapshot) => { snapshot.events.splice(1, 1); }],
  ["reordered event", (snapshot: MutableSnapshot) => { snapshot.events.reverse(); }],
  ["modified event", (snapshot: MutableSnapshot) => { snapshot.events[1].stepId = "execute-one"; }],
] as const;
for (const [name, mutate] of tamperCases) test(`snapshot replay rejects altered ${name}`, () => {
  const input = mutableSnapshot(completeSteps());
  mutate(input);
  const decision = validateAndNormalizeWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedSnapshot, null);
});

test("snapshot rejects duplicate/missing/unknown step state", () => {
  const snapshot = mutableSnapshot();
  snapshot.stepStates.push(clone(snapshot.stepStates[0]));
  assert.equal(validateAndNormalizeWorkflowRunSnapshot(snapshot).verdict, "deny");
  const missing = mutableSnapshot();
  missing.stepStates.pop();
  assert.equal(validateAndNormalizeWorkflowRunSnapshot(missing).verdict, "deny");
  const unknown = mutableSnapshot();
  unknown.stepStates[0].raw = true;
  assert.equal(validateAndNormalizeWorkflowRunSnapshot(unknown).verdict, "deny");
});

test("snapshot validation rejects hostile values and never throws", () => {
  let calls = 0;
  const getter = clone(requireInitial());
  Object.defineProperty(getter, "status", { enumerable: true, get() { calls += 1; return "queued"; } });
  const proxy = new Proxy(clone(requireInitial()), { ownKeys() { throw new Error("no"); } });
  const cyclic = clone(requireInitial()) as unknown as Record<string, unknown>;
  cyclic.self = cyclic;
  for (const input of [null, [], new Set(), new Map(), getter, proxy, cyclic, Object.create(requireInitial())]) {
    assert.doesNotThrow(() => validateAndNormalizeWorkflowRunSnapshot(input));
    assert.equal(validateAndNormalizeWorkflowRunSnapshot(input).verdict, "deny");
  }
  assert.equal(calls, 0);
});

test("history is bounded at lifecycle limit", () => {
  const snapshot = mutableSnapshot();
  snapshot.events = Array(workflowRunLimits.maxLifecycleEvents + 1).fill(null);
  assert.equal(validateAndNormalizeWorkflowRunSnapshot(snapshot).verdict, "deny");
});

test("previous snapshots stay unchanged and successful outputs are fresh", () => {
  const initial = requireInitial();
  const before = clone(initial);
  const firstDecision = evaluateWorkflowRunTransition({ snapshot: initial, event: event(initial, "run_started", 1) });
  const secondDecision = evaluateWorkflowRunTransition({ snapshot: initial, event: event(initial, "run_started", 1) });
  assert.equal(firstDecision.verdict, "allow");
  assert.deepEqual(secondDecision, firstDecision);
  assert.notStrictEqual(secondDecision.nextSnapshot, firstDecision.nextSnapshot);
  assert.deepEqual(initial, before);
  assert.equal(Object.isFrozen(firstDecision.nextSnapshot?.events), true);
});

test("validation errors are capped", () => {
  const input = clone(requireInitial()) as unknown as Record<string, unknown>;
  for (let index = 0; index < 300; index += 1) input[`unknown-${index}`] = true;
  const decision = validateAndNormalizeWorkflowRunSnapshot(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reasons.length <= workflowRunLimits.maxValidationErrors);
});

test("contract source exposes no runtime, random, provider, network, filesystem, shell, queue, or persistence operations", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../lib/contracts/workflow-run.ts", import.meta.url), "utf8");
  for (const forbidden of ["Date" + ".now", "Math" + ".random", "fetch(", "child_process", "BullMQ", "Redis", "writeFile", "executeTool", "providerClient", "persist("]) assert.equal(source.includes(forbidden), false);
  assert.equal(source.includes("budget" + "Ranges"), false);
});
