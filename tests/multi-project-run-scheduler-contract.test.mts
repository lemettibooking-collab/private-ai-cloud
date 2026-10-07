import assert from "node:assert/strict";
import test from "node:test";

const schedulerContract = (await import(
  new URL("../lib/contracts/multi-project-run-scheduler.ts", import.meta.url).href
)) as typeof import("../lib/contracts/multi-project-run-scheduler");

const {
  admissionVerdicts,
  buildMultiProjectRunDispatchPlan,
  evaluateMultiProjectRunAdmission,
  isAdmissionVerdict,
  isMultiProjectRunAdmissionVerdict,
  isMultiProjectRunDispatchPlanVerdict,
  isMultiProjectRunSchedulerStatus,
  isProjectRunPriority,
  isRunPriority,
  isSchedulerPlanVerdict,
  isSchedulerStatus,
  multiProjectRunAdmissionVerdicts,
  multiProjectRunDispatchPlanVerdicts,
  multiProjectRunSchedulerLimits,
  multiProjectRunSchedulerStatuses,
  parseAdmissionVerdict,
  parseMultiProjectRunAdmissionVerdict,
  parseMultiProjectRunDispatchPlanVerdict,
  parseMultiProjectRunSchedulerStatus,
  parseProjectRunPriority,
  parseRunPriority,
  parseSchedulerPlanVerdict,
  parseSchedulerStatus,
  projectRunPriorities,
  runPriorities,
  schedulerPlanVerdicts,
  schedulerStatuses,
} = schedulerContract;

function makeBudget(maxConcurrentRuns = 8) {
  return {
    maxConcurrentRuns,
    maxAttemptsPerRun: 2,
    maxRunMinutes: 120,
    dailyTokenBudget: 1_000_000,
    monthlyCostBudgetUsdCents: 250_000,
  };
}

function makeProject(
  suffix = "one",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id: `project-${suffix}`,
    workspaceId: "workspace-primary",
    version: 3,
    name: `Project ${suffix}`,
    slug: `project-${suffix}`,
    summary: "Owner-controlled scheduler fixture.",
    kind: "internal_product",
    status: "active",
    defaultLocale: "ru-RU",
    timeZone: "Europe/Moscow",
    dataRegion: "eu",
    dataClassification: "confidential",
    goals: ["Run safely"],
    nonGoals: ["Autonomous external actions"],
    tags: [suffix],
    resources: [
      {
        id: `repository-${suffix}`,
        kind: "code_repository",
        label: `Repository ${suffix}`,
        status: "connected",
        connectionId: `connection-${suffix}`,
        resourceRef: `owner/repository-${suffix}`,
        capabilities: ["read_metadata", "propose_change"],
      },
    ],
    allowedModelProfileIds: ["model-shared", `model-${suffix}`],
    knowledgeCollectionIds: [`knowledge-${suffix}`],
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode: "redacted_only",
      requiredApprovalActions: [`project-review-${suffix}`],
      forbiddenActions: [`Project ${suffix} external actions are forbidden`],
    },
    budget: makeBudget(),
    ...overrides,
  };
}

function makeDepartment(
  suffix = "one",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id: `department-${suffix}`,
    projectId: `project-${suffix}`,
    version: 5,
    code: "development",
    name: `Development ${suffix}`,
    summary: "Reviewed development work.",
    status: "active",
    operatingMode: "approval_gated",
    goals: ["Build reviewed patches"],
    nonGoals: ["Deploy automatically"],
    resourceGrants: [
      {
        resourceId: `repository-${suffix}`,
        capabilities: ["read_metadata"],
      },
    ],
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
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
      additionalRequiredApprovalActions: [`department-review-${suffix}`],
      additionalForbiddenActions: [`Department ${suffix} publication is forbidden`],
    },
    budget: makeBudget(4),
    ...overrides,
  };
}

function makeBinding(
  suffix = "one",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id: `binding-${suffix}`,
    projectId: `project-${suffix}`,
    departmentId: `department-${suffix}`,
    version: 7,
    status: "active",
    kind: "agent",
    subjectId: `agent-${suffix}`,
    requestedResources: [
      { resourceId: `repository-${suffix}`, capabilities: ["read_metadata"] },
    ],
    requestedModelProfileIds: ["model-shared", `model-${suffix}`],
    requestedKnowledgeCollectionIds: [`knowledge-${suffix}`],
    requestedBudget: makeBudget(2),
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    additionalRequiredApprovalActions: [`binding-review-${suffix}`],
    additionalForbiddenActions: [`Binding ${suffix} external actions are forbidden`],
    ...overrides,
  };
}

function makeContext(
  suffix = "one",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    projectManifest: makeProject(suffix),
    departmentManifests: [makeDepartment(suffix)],
    bindings: [makeBinding(suffix)],
    ...overrides,
  };
}

function makeRegistry(suffixes: readonly string[] = ["one"]) {
  return {
    workspaceId: "workspace-primary",
    projects: suffixes.map((suffix) => makeContext(suffix)),
  };
}

function makeProjectPolicy(
  suffix = "one",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    projectId: `project-${suffix}`,
    status: "active",
    maxQueuedRuns: 256,
    allowedPriorities: [...projectRunPriorities],
    ...overrides,
  };
}

function makePolicy(
  suffixes: readonly string[] = ["one"],
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    workspaceId: "workspace-primary",
    status: "active",
    maxConcurrentRuns: 8,
    maxQueuedRuns: 512,
    projectPolicies: suffixes.map((suffix) => makeProjectPolicy(suffix)),
    ...overrides,
  };
}

function makeRequest(
  suffix = "one",
  index = 1,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id: `request-${suffix}-${index}`,
    workspaceId: "workspace-primary",
    projectId: `project-${suffix}`,
    bindingId: `binding-${suffix}`,
    modelProfileId: "model-shared",
    idempotencyKey: `idempotency-${suffix}-${index}`,
    priority: "P2",
    sequence: index,
    ...overrides,
  };
}

function makeRunning(
  suffix = "one",
  index = 1,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    runId: `run-${suffix}-${index}`,
    requestId: `running-request-${suffix}-${index}`,
    workspaceId: "workspace-primary",
    projectId: `project-${suffix}`,
    bindingId: `binding-${suffix}`,
    modelProfileId: "model-shared",
    idempotencyKey: `running-idempotency-${suffix}-${index}`,
    priority: "P2",
    startedSequence: index,
    ...overrides,
  };
}

function makeAdmissionInput(
  suffixes: readonly string[] = ["one"],
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    registry: makeRegistry(suffixes),
    policy: makePolicy(suffixes),
    queuedRequests: [],
    runningRuns: [],
    request: makeRequest(suffixes[0] ?? "one"),
    ...overrides,
  };
}

function makePlanInput(
  suffixes: readonly string[] = ["one"],
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    registry: makeRegistry(suffixes),
    policy: makePolicy(suffixes),
    queuedRequests: suffixes.map((suffix, index) => makeRequest(suffix, index + 1)),
    runningRuns: [],
    lastDispatchedProjectId: null,
    ...overrides,
  };
}

function codes(decision: Readonly<{ reasons: readonly { code: string }[] }>) {
  return decision.reasons.map((reason) => reason.code);
}

function blockedCodes(
  decision: ReturnType<typeof buildMultiProjectRunDispatchPlan>,
  requestId: string,
) {
  return decision.plan?.blockedRequests
    .find((blocked) => blocked.requestId === requestId)
    ?.reasons.map((reason) => reason.code) ?? [];
}

function assertAdmissionDenied(input: unknown, code: string) {
  const decision = evaluateMultiProjectRunAdmission(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedRequest, null);
  assert.equal(decision.executionContext, null);
  assert.ok(codes(decision).includes(code), JSON.stringify(decision));
  return decision;
}

function assertPlanDenied(input: unknown, code: string) {
  const decision = buildMultiProjectRunDispatchPlan(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.plan, null);
  assert.ok(codes(decision).includes(code), JSON.stringify(decision));
  return decision;
}

test("exports exact immutable scheduler enums and limits", () => {
  assert.deepEqual(projectRunPriorities, ["P0", "P1", "P2", "P3", "P4"]);
  assert.deepEqual(multiProjectRunSchedulerStatuses, ["active", "paused", "disabled"]);
  assert.deepEqual(multiProjectRunAdmissionVerdicts, ["admit", "deny"]);
  assert.deepEqual(multiProjectRunDispatchPlanVerdicts, ["allow", "deny"]);
  assert.deepEqual(multiProjectRunSchedulerLimits, {
    maxIdLength: 64,
    maxProjectPolicies: 32,
    maxQueuedRuns: 512,
    maxQueuedRunsPerProject: 256,
    maxRunningRuns: 128,
    maxWorkspaceConcurrentRuns: 128,
    maxErrors: 512,
  });
  for (const value of [projectRunPriorities, multiProjectRunSchedulerStatuses, multiProjectRunAdmissionVerdicts, multiProjectRunDispatchPlanVerdicts, multiProjectRunSchedulerLimits]) assert.equal(Object.isFrozen(value), true);
  assert.strictEqual(runPriorities, projectRunPriorities);
  assert.strictEqual(schedulerStatuses, multiProjectRunSchedulerStatuses);
  assert.strictEqual(admissionVerdicts, multiProjectRunAdmissionVerdicts);
  assert.strictEqual(schedulerPlanVerdicts, multiProjectRunDispatchPlanVerdicts);
});

for (const priority of projectRunPriorities) {
  test(`priority guard/parser accepts ${priority}`, () => {
    assert.equal(isProjectRunPriority(priority), true);
    assert.equal(parseProjectRunPriority(priority), priority);
    assert.equal(isRunPriority(priority), true);
    assert.equal(parseRunPriority(priority), priority);
  });
}

for (const status of multiProjectRunSchedulerStatuses) {
  test(`scheduler status guard/parser accepts ${status}`, () => {
    assert.equal(isMultiProjectRunSchedulerStatus(status), true);
    assert.equal(parseMultiProjectRunSchedulerStatus(status), status);
    assert.equal(isSchedulerStatus(status), true);
    assert.equal(parseSchedulerStatus(status), status);
  });
}

for (const verdict of multiProjectRunAdmissionVerdicts) {
  test(`admission verdict guard/parser accepts ${verdict}`, () => {
    assert.equal(isMultiProjectRunAdmissionVerdict(verdict), true);
    assert.equal(parseMultiProjectRunAdmissionVerdict(verdict), verdict);
    assert.equal(isAdmissionVerdict(verdict), true);
    assert.equal(parseAdmissionVerdict(verdict), verdict);
  });
}

for (const verdict of multiProjectRunDispatchPlanVerdicts) {
  test(`plan verdict guard/parser accepts ${verdict}`, () => {
    assert.equal(isMultiProjectRunDispatchPlanVerdict(verdict), true);
    assert.equal(parseMultiProjectRunDispatchPlanVerdict(verdict), verdict);
    assert.equal(isSchedulerPlanVerdict(verdict), true);
    assert.equal(parseSchedulerPlanVerdict(verdict), verdict);
  });
}

test("all guards and parsers reject non-canonical unknown values", () => {
  for (const input of [null, undefined, 1, {}, [], "p0", " P0 ", "ACTIVE", "allow "]) {
    assert.equal(isProjectRunPriority(input), false);
    assert.equal(parseProjectRunPriority(input), null);
    assert.equal(isMultiProjectRunSchedulerStatus(input), false);
    assert.equal(parseMultiProjectRunSchedulerStatus(input), null);
    assert.equal(isMultiProjectRunAdmissionVerdict(input), false);
    assert.equal(parseMultiProjectRunAdmissionVerdict(input), null);
    assert.equal(isMultiProjectRunDispatchPlanVerdict(input), false);
    assert.equal(parseMultiProjectRunDispatchPlanVerdict(input), null);
  }
});

for (const hostile of [null, undefined, true, 1, "input", [], new Set()]) {
  test(`admission fails closed for hostile envelope ${String(hostile)}`, () => {
    assert.doesNotThrow(() => evaluateMultiProjectRunAdmission(hostile));
    assertAdmissionDenied(hostile, "invalid_input");
  });
}

test("throwing admission and plan getters/proxies fail closed", () => {
  const getter = Object.defineProperty({}, "registry", { enumerable: true, get() { throw new Error("getter"); } });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("proxy"); } });
  assertAdmissionDenied(getter, "invalid_input");
  assertAdmissionDenied(proxy, "invalid_input");
  assertPlanDenied(getter, "invalid_input");
  assertPlanDenied(proxy, "invalid_input");
});

test("unknown, inherited, and selected project fields are rejected", () => {
  assertAdmissionDenied({ ...makeAdmissionInput(), selectedProjectId: "project-one" }, "invalid_input");
  assertPlanDenied({ ...makePlanInput(), currentProjectId: "project-one" }, "invalid_input");
  assertAdmissionDenied(Object.create(makeAdmissionInput()), "invalid_input");
  assertPlanDenied(Object.create(makePlanInput()), "invalid_input");
});

test("Set is rejected for every required scheduler collection", () => {
  assertAdmissionDenied(makeAdmissionInput(["one"], { queuedRequests: new Set() }), "invalid_input");
  assertAdmissionDenied(makeAdmissionInput(["one"], { runningRuns: new Set() }), "invalid_input");
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { projectPolicies: new Set() }) }), "invalid_policy");
});

test("invalid AI-016 Registry denies without partial admission", () => {
  assertAdmissionDenied(makeAdmissionInput(["one"], { registry: { workspaceId: "workspace-primary", projects: [] } }), "invalid_registry");
});

test("policy requires exactly one entry for every Registry project", () => {
  assertAdmissionDenied(makeAdmissionInput(["one", "two"], { policy: makePolicy(["one"]) }), "project_policy_not_found");
});

test("policy rejects unknown and duplicate project entries", () => {
  const unknown = makePolicy(["one"], { projectPolicies: [makeProjectPolicy("one"), makeProjectPolicy("other")] });
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: unknown }), "project_policy_unknown");
  const duplicate = makePolicy(["one"], { projectPolicies: [makeProjectPolicy("one"), makeProjectPolicy("one")] });
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: duplicate }), "invalid_policy");
});

test("policy rejects invalid and duplicate priorities", () => {
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { projectPolicies: [makeProjectPolicy("one", { allowedPriorities: ["P2", "PX"] })] }) }), "invalid_policy");
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { projectPolicies: [makeProjectPolicy("one", { allowedPriorities: ["P2", "P2"] })] }) }), "invalid_policy");
});

test("policy rejects unknown fields, inherited values, and workspace mismatch", () => {
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: { ...makePolicy(["one"]), selectedProjectId: "project-one" } }), "invalid_policy");
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: Object.create(makePolicy(["one"])) }), "invalid_policy");
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { workspaceId: "workspace-other" }) }), "workspace_id_mismatch");
});

test("policy concurrency and queue limits enforce exact absolute boundaries", () => {
  const boundary = makePolicy(["one"], { maxConcurrentRuns: 128, maxQueuedRuns: 512 });
  assert.equal(evaluateMultiProjectRunAdmission(makeAdmissionInput(["one"], { policy: boundary })).verdict, "admit");
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { maxConcurrentRuns: 129 }) }), "invalid_policy");
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { maxQueuedRuns: 513 }) }), "invalid_policy");
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { projectPolicies: [makeProjectPolicy("one", { maxQueuedRuns: 257 })] }) }), "invalid_policy");
});

test("project policy collection accepts exact maxProjects and rejects one extra", () => {
  const suffixes = Array.from(
    { length: multiProjectRunSchedulerLimits.maxProjectPolicies },
    (_, index) => `p${index}`,
  );
  assert.equal(
    evaluateMultiProjectRunAdmission(makeAdmissionInput(suffixes)).verdict,
    "admit",
  );
  const policy = makePolicy(suffixes, {
    projectPolicies: [...makePolicy(suffixes).projectPolicies, makeProjectPolicy("overflow")],
  });
  assertAdmissionDenied(
    makeAdmissionInput(suffixes, { policy }),
    "limit_exceeded",
  );
});

test("valid exact projectId and bindingId admission returns AI-016 snapshot", () => {
  const decision = evaluateMultiProjectRunAdmission(makeAdmissionInput());
  assert.equal(decision.verdict, "admit");
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.normalizedRequest?.projectId, "project-one");
  assert.equal(decision.executionContext?.bindingId, "binding-one");
  assert.equal(Object.isFrozen(decision.executionContext), true);
});

test("binding from another project and unknown binding deny with no fallback", () => {
  assertAdmissionDenied(makeAdmissionInput(["one", "two"], { request: makeRequest("one", 1, { bindingId: "binding-two" }) }), "execution_context_denied");
  assertAdmissionDenied(makeAdmissionInput(["one"], { request: makeRequest("one", 1, { bindingId: "binding-missing" }) }), "execution_context_denied");
});

test("inactive binding is denied by real AI-016 resolution", () => {
  const registry = makeRegistry(["one"]);
  registry.projects[0] = makeContext("one", { bindings: [makeBinding("one", { status: "paused" })] });
  assertAdmissionDenied(makeAdmissionInput(["one"], { registry }), "execution_context_denied");
});

test("model must belong to resolved binding allowlist", () => {
  assert.equal(evaluateMultiProjectRunAdmission(makeAdmissionInput(["one"], { request: makeRequest("one", 1, { modelProfileId: "model-one" }) })).verdict, "admit");
  assertAdmissionDenied(makeAdmissionInput(["one"], { request: makeRequest("one", 1, { modelProfileId: "model-unknown" }) }), "model_not_allowed");
});

test("project priority allowlist is enforced", () => {
  const policy = makePolicy(["one"], { projectPolicies: [makeProjectPolicy("one", { allowedPriorities: ["P1"] })] });
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy }), "priority_not_allowed");
});

test("paused workspace and project still admit within queue limits", () => {
  assert.equal(evaluateMultiProjectRunAdmission(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { status: "paused" }) })).verdict, "admit");
  const projectPaused = makePolicy(["one"], { projectPolicies: [makeProjectPolicy("one", { status: "paused" })] });
  assert.equal(evaluateMultiProjectRunAdmission(makeAdmissionInput(["one"], { policy: projectPaused })).verdict, "admit");
});

test("disabled workspace and project deny new admission", () => {
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: makePolicy(["one"], { status: "disabled" }) }), "scheduler_disabled");
  const projectDisabled = makePolicy(["one"], { projectPolicies: [makeProjectPolicy("one", { status: "disabled" })] });
  assertAdmissionDenied(makeAdmissionInput(["one"], { policy: projectDisabled }), "project_disabled");
});

test("workspace and project queue boundaries deny the next request", () => {
  const queued = [makeRequest("one", 1), makeRequest("two", 2)];
  const policy = makePolicy(["one", "two"], { maxQueuedRuns: 2, projectPolicies: [makeProjectPolicy("one", { maxQueuedRuns: 2 }), makeProjectPolicy("two", { maxQueuedRuns: 2 })] });
  assertAdmissionDenied(makeAdmissionInput(["one", "two"], { queuedRequests: queued, policy, request: makeRequest("one", 3) }), "queue_capacity_exceeded");
  const projectPolicy = makePolicy(["one"], { maxQueuedRuns: 2, projectPolicies: [makeProjectPolicy("one", { maxQueuedRuns: 1 })] });
  assertAdmissionDenied(makeAdmissionInput(["one"], { queuedRequests: [makeRequest("one", 1)], policy: projectPolicy, request: makeRequest("one", 2) }), "project_queue_capacity_exceeded");
});

test("absolute queued and running collection limits fail before expensive resolution", () => {
  const tooManyQueued = Array.from({ length: 513 }, (_, index) => ({ index }));
  assertAdmissionDenied(makeAdmissionInput(["one"], { queuedRequests: tooManyQueued }), "limit_exceeded");
  const tooManyRunning = Array.from({ length: 129 }, (_, index) => ({ index }));
  assertAdmissionDenied(makeAdmissionInput(["one"], { runningRuns: tooManyRunning }), "limit_exceeded");
});

test("exact 512 queued requests form valid state and block only the next admission", () => {
  const queued = ["one", "two"].flatMap((suffix) =>
    Array.from({ length: 256 }, (_, index) => makeRequest(suffix, index + 1)),
  );
  const policy = makePolicy(["one", "two"], {
    maxQueuedRuns: 512,
    projectPolicies: [makeProjectPolicy("one"), makeProjectPolicy("two")],
  });
  const decision = assertAdmissionDenied(
    makeAdmissionInput(["one", "two"], {
      queuedRequests: queued,
      policy,
      request: makeRequest("one", 300),
    }),
    "queue_capacity_exceeded",
  );
  assert.ok(codes(decision).includes("project_queue_capacity_exceeded"));
});

test("exact 128 valid running references pass the absolute state limit", () => {
  const suffixes = Array.from({ length: 32 }, (_, index) => `r${index}`);
  const projects = suffixes.map((suffix) =>
    makeContext(suffix, {
      projectManifest: makeProject(suffix, { budget: makeBudget(4) }),
      departmentManifests: [makeDepartment(suffix, { budget: makeBudget(4) })],
      bindings: [makeBinding(suffix, { requestedBudget: makeBudget(4) })],
    }),
  );
  const registry = { workspaceId: "workspace-primary", projects };
  const runningRuns = suffixes.flatMap((suffix) =>
    Array.from({ length: 4 }, (_, index) => makeRunning(suffix, index + 1)),
  );
  const policy = makePolicy(suffixes, { maxConcurrentRuns: 128 });
  const decision = evaluateMultiProjectRunAdmission(
    makeAdmissionInput(suffixes, {
      registry,
      policy,
      runningRuns,
      request: makeRequest("r0", 100),
    }),
  );
  assert.equal(decision.verdict, "admit");
});

test("duplicate request, run, and idempotency identities fail closed", () => {
  assertAdmissionDenied(makeAdmissionInput(["one"], { queuedRequests: [makeRequest("one", 1), makeRequest("one", 1)] }), "duplicate_request_id");
  assertAdmissionDenied(makeAdmissionInput(["one"], { runningRuns: [makeRunning("one", 1), makeRunning("one", 2, { runId: "run-one-1" })] }), "duplicate_run_id");
  assertAdmissionDenied(makeAdmissionInput(["one"], { queuedRequests: [makeRequest("one", 1)], request: makeRequest("one", 2, { idempotencyKey: "idempotency-one-1" }) }), "duplicate_idempotency_key");
});

test("one request cannot be queued and running or admitted twice", () => {
  const queued = makeRequest("one", 1);
  const running = makeRunning("one", 1, { requestId: queued.id });
  assertAdmissionDenied(makeAdmissionInput(["one"], { queuedRequests: [queued], runningRuns: [running] }), "request_already_running");
  assertAdmissionDenied(makeAdmissionInput(["one"], { runningRuns: [makeRunning("one", 1, { requestId: "request-one-1" })] }), "request_already_running");
});

test("malformed queued request or running run denies all state", () => {
  assertAdmissionDenied(makeAdmissionInput(["one"], { queuedRequests: [{ id: "broken" }] }), "invalid_request");
  assertAdmissionDenied(makeAdmissionInput(["one"], { runningRuns: [{ runId: "broken" }] }), "invalid_running_run");
});

test("queued and running objects require own exact fields", () => {
  assertAdmissionDenied(
    makeAdmissionInput(["one"], { queuedRequests: [Object.create(makeRequest("one", 1))] }),
    "invalid_request",
  );
  assertAdmissionDenied(
    makeAdmissionInput(["one"], { runningRuns: [{ ...makeRunning("one", 1), snapshot: {} }] }),
    "invalid_running_run",
  );
});

test("throwing nested request and running values fail closed", () => {
  const requestProxy = new Proxy({}, { ownKeys() { throw new Error("request proxy"); } });
  const runningGetter = Object.defineProperty({}, "runId", {
    enumerable: true,
    get() {
      throw new Error("running getter");
    },
  });
  assertAdmissionDenied(
    makeAdmissionInput(["one"], { queuedRequests: [requestProxy] }),
    "invalid_input",
  );
  assertAdmissionDenied(
    makeAdmissionInput(["one"], { runningRuns: [runningGetter] }),
    "invalid_running_run",
  );
});

test("queued and running workspace IDs must match the Registry", () => {
  assertAdmissionDenied(
    makeAdmissionInput(["one"], {
      queuedRequests: [makeRequest("one", 1, { workspaceId: "workspace-other" })],
    }),
    "workspace_id_mismatch",
  );
  assertAdmissionDenied(
    makeAdmissionInput(["one"], {
      runningRuns: [makeRunning("one", 1, { workspaceId: "workspace-other" })],
    }),
    "workspace_id_mismatch",
  );
});

test("running references re-resolve exact binding and model through AI-016", () => {
  assertAdmissionDenied(
    makeAdmissionInput(["one"], {
      runningRuns: [makeRunning("one", 1, { bindingId: "binding-missing" })],
    }),
    "execution_context_denied",
  );
  assertAdmissionDenied(
    makeAdmissionInput(["one"], {
      runningRuns: [makeRunning("one", 1, { modelProfileId: "model-unknown" })],
    }),
    "model_not_allowed",
  );
});

test("queued resolution keeps the caller index after canonical sorting", () => {
  const queuedRequests = [
    makeRequest("one", 1, { id: "request-z" }),
    makeRequest("one", 2, {
      id: "request-a",
      bindingId: "binding-missing",
    }),
  ];
  const input = makeAdmissionInput(["one"], { queuedRequests });
  const before = structuredClone(input);
  const first = assertAdmissionDenied(input, "execution_context_denied");
  const second = evaluateMultiProjectRunAdmission(input);
  assert.ok(
    first.reasons.some(
      (reason) => reason.path === "queuedRequests[1].bindingId",
    ),
    JSON.stringify(first),
  );
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});

test("running resolution keeps the caller index after canonical sorting", () => {
  const runningRuns = [
    makeRunning("one", 1, { runId: "run-z" }),
    makeRunning("one", 2, {
      runId: "run-a",
      bindingId: "binding-missing",
    }),
  ];
  const input = makeAdmissionInput(["one"], { runningRuns });
  const before = structuredClone(input);
  const first = assertAdmissionDenied(input, "execution_context_denied");
  const second = evaluateMultiProjectRunAdmission(input);
  assert.ok(
    first.reasons.some(
      (reason) => reason.path === "runningRuns[1].bindingId",
    ),
    JSON.stringify(first),
  );
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});

test("unknown project policy keeps its caller index after canonical sorting", () => {
  const policy = makePolicy(["one"], {
    projectPolicies: [
      makeProjectPolicy("one"),
      makeProjectPolicy("a-unknown"),
    ],
  });
  const input = makeAdmissionInput(["one"], { policy });
  const before = structuredClone(input);
  const first = assertAdmissionDenied(input, "project_policy_unknown");
  const second = evaluateMultiProjectRunAdmission(input);
  assert.ok(
    first.reasons.some(
      (reason) => reason.path === "policy.projectPolicies[1].projectId",
    ),
    JSON.stringify(first),
  );
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});

test("admission is deterministic, fresh, and input-immutable", () => {
  const input = makeAdmissionInput();
  const before = structuredClone(input);
  const first = evaluateMultiProjectRunAdmission(input);
  const second = evaluateMultiProjectRunAdmission(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.notStrictEqual(first.normalizedRequest, second.normalizedRequest);
  assert.notStrictEqual(first.executionContext, second.executionContext);
});

test("three free slots dispatch one same-priority request from each of three projects", () => {
  const input = makePlanInput(["one", "two", "three"], { policy: makePolicy(["one", "two", "three"], { maxConcurrentRuns: 3 }) });
  const decision = buildMultiProjectRunDispatchPlan(input);
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.projectId), ["project-one", "project-three", "project-two"]);
});

test("one project cannot consume all same-priority slots before another project", () => {
  const queued = [makeRequest("one", 1), makeRequest("one", 2), makeRequest("two", 1)];
  const policy = makePolicy(["one", "two"], { maxConcurrentRuns: 2 });
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two"], { queuedRequests: queued, policy }));
  assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.projectId), ["project-one", "project-two"]);
  assert.deepEqual(decision.plan?.retainedRequestIds, ["request-one-2"]);
});

test("priorities dispatch strictly P0 through P4", () => {
  const queued = ["P4", "P2", "P0", "P3", "P1"].map((priority, index) => makeRequest("one", index + 1, { priority }));
  const registry = { workspaceId: "workspace-primary", projects: [makeContext("one", { departmentManifests: [makeDepartment("one", { budget: makeBudget(5) })], bindings: [makeBinding("one", { requestedBudget: makeBudget(5) })] })] };
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one"], { registry, queuedRequests: queued, policy: makePolicy(["one"], { maxConcurrentRuns: 5 }) }));
  assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.priority), ["P0", "P1", "P2", "P3", "P4"]);
});

test("FIFO sequence and request ID tie-break apply within one project", () => {
  const queued = [makeRequest("one", 3, { sequence: 2 }), makeRequest("one", 2, { sequence: 1, id: "request-z" }), makeRequest("one", 1, { sequence: 1, id: "request-a" })];
  const registry = { workspaceId: "workspace-primary", projects: [makeContext("one", { departmentManifests: [makeDepartment("one", { budget: makeBudget(3) })], bindings: [makeBinding("one", { requestedBudget: makeBudget(3) })] })] };
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one"], { registry, queuedRequests: queued, policy: makePolicy(["one"], { maxConcurrentRuns: 3 }) }));
  assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.id), ["request-a", "request-z", "request-one-3"]);
});

test("round-robin cursor starts after the previous project and records the last dispatch", () => {
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two", "three"], { lastDispatchedProjectId: "project-one", policy: makePolicy(["one", "two", "three"], { maxConcurrentRuns: 2 }) }));
  assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.projectId), ["project-three", "project-two"]);
  assert.equal(decision.plan?.nextLastDispatchedProjectId, "project-two");
});

test("cursor rotates the full project registry even when cursor project has no request", () => {
  const queued = [makeRequest("two", 1), makeRequest("three", 1)];
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two", "three"], { queuedRequests: queued, lastDispatchedProjectId: "project-one", policy: makePolicy(["one", "two", "three"], { maxConcurrentRuns: 1 }) }));
  assert.equal(decision.plan?.dispatches[0]?.request.projectId, "project-three");
});

test("no dispatch preserves the cursor", () => {
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one"], { queuedRequests: [], lastDispatchedProjectId: "project-one" }));
  assert.equal(decision.plan?.nextLastDispatchedProjectId, "project-one");
});

test("paused workspace retains every request with scheduler_paused", () => {
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two"], { policy: makePolicy(["one", "two"], { status: "paused" }) }));
  assert.deepEqual(decision.plan?.dispatches, []);
  assert.equal(decision.plan?.retainedRequestIds.length, 2);
  for (const blocked of decision.plan?.blockedRequests ?? []) assert.ok(blocked.reasons.some((reason) => reason.code === "scheduler_paused"));
});

test("disabled workspace retains requests without cancellation", () => {
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one"], { policy: makePolicy(["one"], { status: "disabled" }) }));
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.plan?.dispatches, []);
  assert.deepEqual(blockedCodes(decision, "request-one-1"), ["scheduler_disabled"]);
});

test("queued priority removed from project allowlist is retained, not globally denied", () => {
  const policy = makePolicy(["one"], {
    projectPolicies: [makeProjectPolicy("one", { allowedPriorities: ["P1"] })],
  });
  const decision = buildMultiProjectRunDispatchPlan(
    makePlanInput(["one"], { policy }),
  );
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.plan?.dispatches, []);
  assert.ok(blockedCodes(decision, "request-one-1").includes("priority_not_allowed"));
});

test("paused and disabled projects do not block active projects", () => {
  for (const status of ["paused", "disabled"] as const) {
    const policy = makePolicy(["one", "two"], { projectPolicies: [makeProjectPolicy("one", { status }), makeProjectPolicy("two")] });
    const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two"], { policy }));
    assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.projectId), ["project-two"]);
    assert.ok(blockedCodes(decision, "request-one-1").includes(status === "paused" ? "project_paused" : "project_disabled"));
  }
});

test("workspace concurrency ceiling blocks queued requests without global deny", () => {
  const policy = makePolicy(["one", "two"], { maxConcurrentRuns: 1 });
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two"], { policy, runningRuns: [makeRunning("one", 1)] }));
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.plan?.dispatches, []);
  assert.ok(blockedCodes(decision, "request-two-2").includes("workspace_concurrency_exceeded"));
});

test("already selected dispatches immediately consume workspace capacity", () => {
  const policy = makePolicy(["one", "two"], { maxConcurrentRuns: 1 });
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two"], { policy }));
  assert.equal(decision.plan?.dispatches.length, 1);
  assert.equal(decision.plan?.retainedRequestIds.length, 1);
  const retained = decision.plan?.retainedRequestIds[0] ?? "";
  assert.ok(blockedCodes(decision, retained).includes("workspace_concurrency_exceeded"));
});

function makeDualBindingContext(
  options: Readonly<{ projectMax?: number; departmentMax?: number; bindingAMax?: number; bindingBMax?: number }> = {},
) {
  const projectMax = options.projectMax ?? 4;
  const departmentMax = options.departmentMax ?? 4;
  const department = makeDepartment("one", { budget: makeBudget(departmentMax) });
  const bindingA = makeBinding("one", { id: "binding-one-a", subjectId: "agent-one-a", requestedBudget: makeBudget(options.bindingAMax ?? 1) });
  const bindingB = makeBinding("one", { id: "binding-one-b", subjectId: "agent-one-b", requestedBudget: makeBudget(options.bindingBMax ?? 1) });
  return makeContext("one", { projectManifest: makeProject("one", { budget: makeBudget(projectMax) }), departmentManifests: [department], bindings: [bindingA, bindingB] });
}

function requestForBinding(bindingId: string, index: number) {
  return makeRequest("one", index, { bindingId, id: `request-${bindingId}-${index}`, idempotencyKey: `idempotency-${bindingId}-${index}` });
}

function runningForBinding(bindingId: string, index: number) {
  return makeRunning("one", index, { bindingId, runId: `run-${bindingId}-${index}`, requestId: `running-${bindingId}-${index}`, idempotencyKey: `running-idempotency-${bindingId}-${index}` });
}

test("binding ceiling blocks only that binding", () => {
  const registry = { workspaceId: "workspace-primary", projects: [makeDualBindingContext()] };
  const queued = [requestForBinding("binding-one-a", 1), requestForBinding("binding-one-b", 2)];
  const running = [runningForBinding("binding-one-a", 1)];
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one"], { registry, queuedRequests: queued, runningRuns: running, policy: makePolicy(["one"], { maxConcurrentRuns: 4 }) }));
  assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.bindingId), ["binding-one-b"]);
  assert.ok(blockedCodes(decision, "request-binding-one-a-1").includes("binding_concurrency_exceeded"));
});

function makeDualDepartmentContext() {
  const project = makeProject("one", { budget: makeBudget(4) });
  const departmentA = makeDepartment("one", { id: "department-one-a", code: "development", budget: makeBudget(1) });
  const departmentB = makeDepartment("one", { id: "department-one-b", code: "support", budget: makeBudget(1) });
  const bindingA = makeBinding("one", { id: "binding-one-a", departmentId: "department-one-a", subjectId: "agent-one-a", requestedBudget: makeBudget(1) });
  const bindingB = makeBinding("one", { id: "binding-one-b", departmentId: "department-one-b", subjectId: "agent-one-b", requestedBudget: makeBudget(1) });
  return makeContext("one", { projectManifest: project, departmentManifests: [departmentA, departmentB], bindings: [bindingA, bindingB] });
}

test("admission denies workspace running state above its ceiling", () => {
  const input = makeAdmissionInput(["one", "two"], {
    policy: makePolicy(["one", "two"], { maxConcurrentRuns: 1 }),
    runningRuns: [makeRunning("one", 1), makeRunning("two", 1)],
    request: makeRequest("one", 100),
  });
  const decision = assertAdmissionDenied(input, "running_state_capacity_exceeded");
  assert.equal(decision.normalizedRequest, null);
  assert.equal(decision.executionContext, null);
});

test("admission denies Project running state above its ceiling", () => {
  const context = makeDualDepartmentContext();
  context.projectManifest = makeProject("one", { budget: makeBudget(1) });
  const registry = { workspaceId: "workspace-primary", projects: [context] };
  const input = makeAdmissionInput(["one"], {
    registry,
    policy: makePolicy(["one"], { maxConcurrentRuns: 4 }),
    runningRuns: [
      runningForBinding("binding-one-a", 1),
      runningForBinding("binding-one-b", 2),
    ],
    request: makeRequest("one", 100, { bindingId: "binding-one-a" }),
  });
  const decision = assertAdmissionDenied(input, "running_state_capacity_exceeded");
  assert.ok(decision.reasons.some((reason) => reason.projectId === "project-one"));
});

test("admission denies Department running state above its ceiling", () => {
  const registry = {
    workspaceId: "workspace-primary",
    projects: [
      makeDualBindingContext({
        projectMax: 4,
        departmentMax: 1,
        bindingAMax: 1,
        bindingBMax: 1,
      }),
    ],
  };
  const input = makeAdmissionInput(["one"], {
    registry,
    policy: makePolicy(["one"], { maxConcurrentRuns: 4 }),
    runningRuns: [
      runningForBinding("binding-one-a", 1),
      runningForBinding("binding-one-b", 2),
    ],
    request: requestForBinding("binding-one-a", 100),
  });
  const decision = assertAdmissionDenied(input, "running_state_capacity_exceeded");
  assert.ok(decision.reasons.some((reason) => reason.departmentId === "department-one"));
});

test("admission denies Binding running state above its ceiling", () => {
  const registry = {
    workspaceId: "workspace-primary",
    projects: [makeDualBindingContext({ bindingAMax: 1 })],
  };
  const input = makeAdmissionInput(["one"], {
    registry,
    policy: makePolicy(["one"], { maxConcurrentRuns: 4 }),
    runningRuns: [
      runningForBinding("binding-one-a", 1),
      runningForBinding("binding-one-a", 2),
    ],
    request: requestForBinding("binding-one-b", 100),
  });
  const decision = assertAdmissionDenied(input, "running_state_capacity_exceeded");
  assert.ok(decision.reasons.some((reason) => reason.bindingId === "binding-one-a"));
});

test("admission accepts running state exactly at every ceiling", () => {
  const registry = {
    workspaceId: "workspace-primary",
    projects: [
      makeContext("one", {
        projectManifest: makeProject("one", { budget: makeBudget(2) }),
        departmentManifests: [makeDepartment("one", { budget: makeBudget(2) })],
        bindings: [makeBinding("one", { requestedBudget: makeBudget(2) })],
      }),
    ],
  };
  const input = makeAdmissionInput(["one"], {
    registry,
    policy: makePolicy(["one"], { maxConcurrentRuns: 2 }),
    runningRuns: [makeRunning("one", 1), makeRunning("one", 2)],
    request: makeRequest("one", 100),
  });
  const decision = evaluateMultiProjectRunAdmission(input);
  assert.equal(decision.verdict, "admit");
  assert.notEqual(decision.normalizedRequest, null);
  assert.notEqual(decision.executionContext, null);
});

test("running-capacity admission denial is deterministic and input-immutable", () => {
  const registry = {
    workspaceId: "workspace-primary",
    projects: [makeDualBindingContext({ bindingAMax: 1 })],
  };
  const input = makeAdmissionInput(["one"], {
    registry,
    policy: makePolicy(["one"], { maxConcurrentRuns: 4 }),
    runningRuns: [
      runningForBinding("binding-one-a", 1),
      runningForBinding("binding-one-a", 2),
    ],
    request: requestForBinding("binding-one-b", 100),
  });
  const before = structuredClone(input);
  const first = evaluateMultiProjectRunAdmission(input);
  const second = evaluateMultiProjectRunAdmission(input);
  assert.deepEqual(first, second);
  assert.equal(first.normalizedRequest, null);
  assert.equal(first.executionContext, null);
  assert.deepEqual(input, before);
});

test("full Department does not block another Department", () => {
  const registry = { workspaceId: "workspace-primary", projects: [makeDualDepartmentContext()] };
  const queued = [requestForBinding("binding-one-a", 1), requestForBinding("binding-one-b", 2)];
  const running = [runningForBinding("binding-one-a", 1)];
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one"], { registry, queuedRequests: queued, runningRuns: running, policy: makePolicy(["one"], { maxConcurrentRuns: 4 }) }));
  assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.bindingId), ["binding-one-b"]);
  assert.ok(blockedCodes(decision, "request-binding-one-a-1").includes("department_concurrency_exceeded"));
});

test("full Project A does not block Project B", () => {
  const contexts = [
    makeContext("one", { projectManifest: makeProject("one", { budget: makeBudget(1) }), departmentManifests: [makeDepartment("one", { budget: makeBudget(1) })], bindings: [makeBinding("one", { requestedBudget: makeBudget(1) })] }),
    makeContext("two"),
  ];
  const registry = { workspaceId: "workspace-primary", projects: contexts };
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two"], { registry, runningRuns: [makeRunning("one", 1)], policy: makePolicy(["one", "two"], { maxConcurrentRuns: 4 }) }));
  assert.deepEqual(decision.plan?.dispatches.map((dispatch) => dispatch.request.projectId), ["project-two"]);
  assert.ok(blockedCodes(decision, "request-one-1").includes("project_concurrency_exceeded"));
});

test("existing running state above any ceiling is a global deny", () => {
  const registry = { workspaceId: "workspace-primary", projects: [makeDualBindingContext({ bindingAMax: 1 })] };
  const running = [runningForBinding("binding-one-a", 1), runningForBinding("binding-one-a", 2)];
  assertPlanDenied(makePlanInput(["one"], { registry, queuedRequests: [], runningRuns: running, policy: makePolicy(["one"], { maxConcurrentRuns: 4 }) }), "running_state_capacity_exceeded");
});

test("Project ceiling accounts for selected dispatches", () => {
  const context = makeDualBindingContext({ projectMax: 2, departmentMax: 2, bindingAMax: 2, bindingBMax: 2 });
  const registry = { workspaceId: "workspace-primary", projects: [context] };
  const queued = [requestForBinding("binding-one-a", 1), requestForBinding("binding-one-b", 2), requestForBinding("binding-one-a", 3)];
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one"], { registry, queuedRequests: queued, policy: makePolicy(["one"], { maxConcurrentRuns: 4 }) }));
  assert.equal(decision.plan?.dispatches.length, 2);
  assert.ok(blockedCodes(decision, "request-binding-one-a-3").includes("project_concurrency_exceeded"));
});

test("reverse queued, running, and project policy input preserve deep-equal plans", () => {
  const suffixes = ["one", "two", "three"];
  const queued = [makeRequest("one", 2), makeRequest("two", 1), makeRequest("three", 3), makeRequest("one", 1)];
  const running = [makeRunning("two", 2), makeRunning("three", 1)];
  const policy = makePolicy(suffixes, { maxConcurrentRuns: 6 });
  const input = makePlanInput(suffixes, { queuedRequests: queued, runningRuns: running, policy });
  const baseline = buildMultiProjectRunDispatchPlan(input);
  assert.deepEqual(baseline, buildMultiProjectRunDispatchPlan({ ...input, queuedRequests: [...queued].reverse() }));
  assert.deepEqual(baseline, buildMultiProjectRunDispatchPlan({ ...input, runningRuns: [...running].reverse() }));
  assert.deepEqual(baseline, buildMultiProjectRunDispatchPlan({ ...input, policy: { ...policy, projectPolicies: [...policy.projectPolicies].reverse() } }));
});

test("repeated plan evaluation is deterministic, fresh, and input-immutable", () => {
  const input = makePlanInput(["one", "two", "three"]);
  const before = structuredClone(input);
  const first = buildMultiProjectRunDispatchPlan(input);
  const second = buildMultiProjectRunDispatchPlan(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.notStrictEqual(first.plan, second.plan);
  assert.notStrictEqual(first.plan?.dispatches, second.plan?.dispatches);
  assert.notStrictEqual(first.plan?.dispatches[0]?.executionContext, second.plan?.dispatches[0]?.executionContext);
});

test("dispatch snapshots remain frozen and resolving Project B cannot mutate Project A", () => {
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput(["one", "two"], { policy: makePolicy(["one", "two"], { maxConcurrentRuns: 2 }) }));
  const first = decision.plan?.dispatches.find((dispatch) => dispatch.request.projectId === "project-one")?.executionContext;
  const before = structuredClone(first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first?.resources), true);
  assert.deepEqual(first, before);
});

test("plan contains no raw manifests, resource references, connections, or credentials", () => {
  const decision = buildMultiProjectRunDispatchPlan(makePlanInput());
  const serialized = JSON.stringify(decision.plan);
  assert.doesNotMatch(serialized, /"(?:resourceRef|connectionId|projectManifest|departmentManifest|credentials)"/u);
  const dispatch = decision.plan?.dispatches[0];
  assert.deepEqual(Object.keys(dispatch?.request ?? {}).sort(), ["bindingId", "id", "idempotencyKey", "modelProfileId", "priority", "projectId", "sequence", "workspaceId"]);
  assert.equal(Object.hasOwn(dispatch?.executionContext ?? {}, "credentials"), false);
});

test("invalid cursor and selected/current project fallback fields deny globally", () => {
  assertPlanDenied(makePlanInput(["one"], { lastDispatchedProjectId: "project-missing" }), "invalid_input");
  assertPlanDenied({ ...makePlanInput(), activeProjectId: "project-one" }, "invalid_input");
  assertPlanDenied({ ...makePlanInput(), currentProjectSlug: "project-one" }, "invalid_input");
});

test("scheduler results are pure plans and perform no queue or runtime action", () => {
  const input = makePlanInput(["one", "two"]);
  const before = structuredClone(input);
  const decision = buildMultiProjectRunDispatchPlan(input);
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(decision.plan ?? {}).sort(), ["blockedRequests", "dispatches", "nextLastDispatchedProjectId", "retainedRequestIds"]);
});
