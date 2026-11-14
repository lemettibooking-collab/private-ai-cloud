import assert from "node:assert/strict";
import test from "node:test";

const contract = (await import(
  new URL("../lib/contracts/workflow-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/workflow-manifest");

const {
  evaluateWorkspaceWorkflowCatalog,
  isWorkflowActionMode,
  isWorkflowCatalogVerdict,
  isWorkflowManifestStatus,
  isWorkflowStepKind,
  isWorkflowTriggerMode,
  parseWorkflowActionMode,
  parseWorkflowCatalogVerdict,
  parseWorkflowManifestStatus,
  parseWorkflowStepKind,
  parseWorkflowTriggerMode,
  resolveWorkflowExecutionProfile,
  validateAndNormalizeWorkflowManifest,
  workflowActionModes,
  workflowCatalogVerdicts,
  workflowManifestLimits,
  workflowManifestStatuses,
  workflowStepKinds,
  workflowTriggerModes,
} = contract;

function clone<T>(value: T): T {
  return structuredClone(value);
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
    code: "development",
    name: `Development ${suffix}`,
    summary: "Reviewed development work.",
    status: "active",
    operatingMode: "approval_gated",
    goals: ["Build reviewed patches"],
    nonGoals: ["Deploy automatically"],
    resourceGrants: [{
      resourceId: `repository-${suffix}`,
      capabilities: ["read_metadata", "propose_change"],
    }],
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

function makeBinding(
  suffix = "one",
  kind: "agent" | "workflow" = "agent",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const isWorkflow = kind === "workflow";
  return {
    id: `${kind}-binding-${suffix}`,
    projectId: `project-${suffix}`,
    departmentId: `department-${suffix}`,
    version: isWorkflow ? 8 : 7,
    status: "active",
    kind,
    subjectId: `${isWorkflow ? "workflow" : "agent"}-${suffix}`,
    requestedResources: [{
      resourceId: `repository-${suffix}`,
      capabilities: ["read_metadata", "propose_change"],
    }],
    requestedModelProfileIds: ["model-shared", `model-${suffix}`],
    requestedKnowledgeCollectionIds: [`knowledge-${suffix}`],
    requestedBudget: makeBudget({
      maxConcurrentRuns: 1,
      maxAttemptsPerRun: 2,
      maxRunMinutes: 30,
      dailyTokenBudget: 250_000,
      monthlyCostBudgetUsdCents: 50_000,
    }),
    externalActionMode: "approval_required",
    dataEgressMode: "forbidden",
    additionalRequiredApprovalActions: [
      isWorkflow ? `workflow-external-${suffix}` : `agent-review-${suffix}`,
    ],
    additionalForbiddenActions: [
      `${isWorkflow ? "Workflow" : "Agent binding"} ${suffix} deploy is forbidden`,
    ],
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
    summary: "Creates bounded, reviewable patches.",
    status: "active",
    instructionProfileId: `instructions-${suffix}`,
    goals: ["Create reviewed patches"],
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
    additionalRequiredApprovalActions: [`agent-manifest-review-${suffix}`],
    additionalForbiddenActions: [`Agent ${suffix} runtime deploy is forbidden`],
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
    requestedResources: [{
      resourceId: `repository-${suffix}`,
      capabilities: ["read_metadata", "propose_change"],
    }],
    modelProfileId: "model-shared",
    knowledgeCollectionIds: [`knowledge-${suffix}`],
    toolIds: ["tool-read", "tool-patch"],
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
    summary: "Runs bounded work only after explicit approval.",
    status: "active",
    triggerMode: "manual",
    goals: ["Produce a reviewed patch"],
    nonGoals: ["Deploy automatically"],
    steps: [makeAgentStep(suffix), makeGate(suffix)],
    finalStepIds: [`execute-${suffix}`],
    additionalRequiredApprovalActions: [`workflow-manifest-review-${suffix}`],
    additionalForbiddenActions: [`Workflow manifest ${suffix} publish is forbidden`],
    ...overrides,
  };
}

function makeProjectContext(suffix = "one") {
  return {
    projectManifest: makeProject(suffix),
    departmentManifests: [makeDepartment(suffix)],
    bindings: [makeBinding(suffix, "agent"), makeBinding(suffix, "workflow")],
  };
}

function makeCatalog(suffixes: readonly string[] = ["one"]) {
  return {
    registry: {
      workspaceId: "workspace-primary",
      projects: suffixes.map(makeProjectContext),
    },
    agents: suffixes.map((suffix) => ({
      bindingId: `agent-binding-${suffix}`,
      agentManifest: makeAgent(suffix),
    })),
    workflows: suffixes.map((suffix) => ({
      bindingId: `workflow-binding-${suffix}`,
      workflowManifest: makeWorkflow(suffix),
    })),
  };
}

function makeResolution(catalog: unknown = makeCatalog(), overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    catalog,
    projectId: "project-one",
    workflowId: "workflow-one",
    bindingId: "workflow-binding-one",
    ...overrides,
  };
}

function codes(decision: Readonly<{ reasons: readonly { code: string }[] }>) {
  return decision.reasons.map((reason) => reason.code);
}

function requireManifest(input: unknown = makeWorkflow()) {
  const result = validateAndNormalizeWorkflowManifest(input);
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}:${error.path}`).join(", "));
  assert.equal(result.ok, true);
  return result.value;
}

test("exports exact frozen canonical enums and immutable limits", () => {
  assert.deepEqual(workflowManifestStatuses, ["draft", "active", "paused", "disabled"]);
  assert.deepEqual(workflowTriggerModes, ["manual", "event", "scheduled", "api"]);
  assert.deepEqual(workflowStepKinds, ["agent_task", "approval_gate"]);
  assert.deepEqual(workflowActionModes, ["none", "proposal_only", "external_action"]);
  assert.deepEqual(workflowCatalogVerdicts, ["allow", "deny"]);
  for (const value of [workflowManifestStatuses, workflowTriggerModes, workflowStepKinds, workflowActionModes, workflowCatalogVerdicts, workflowManifestLimits]) assert.equal(Object.isFrozen(value), true);
  assert.equal(workflowManifestLimits.maxErrors, 256);
  assert.ok(workflowManifestLimits.maxGraphInspections >= workflowManifestLimits.maxSteps);
});

for (const value of workflowManifestStatuses) test(`status guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowManifestStatus(value), true);
  assert.equal(parseWorkflowManifestStatus(value), value);
});
for (const value of workflowTriggerModes) test(`trigger guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowTriggerMode(value), true);
  assert.equal(parseWorkflowTriggerMode(value), value);
});
for (const value of workflowStepKinds) test(`step kind guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowStepKind(value), true);
  assert.equal(parseWorkflowStepKind(value), value);
});
for (const value of workflowActionModes) test(`action guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowActionMode(value), true);
  assert.equal(parseWorkflowActionMode(value), value);
});
for (const value of workflowCatalogVerdicts) test(`verdict guard/parser accepts ${value}`, () => {
  assert.equal(isWorkflowCatalogVerdict(value), true);
  assert.equal(parseWorkflowCatalogVerdict(value), value);
});

test("all enum guards and parsers reject unknown values", () => {
  assert.equal(isWorkflowManifestStatus("archived"), false);
  assert.equal(parseWorkflowManifestStatus("archived"), null);
  assert.equal(isWorkflowTriggerMode("provider"), false);
  assert.equal(parseWorkflowTriggerMode("provider"), null);
  assert.equal(isWorkflowStepKind("tool"), false);
  assert.equal(parseWorkflowStepKind("tool"), null);
  assert.equal(isWorkflowActionMode("execute"), false);
  assert.equal(parseWorkflowActionMode("execute"), null);
  assert.equal(isWorkflowCatalogVerdict("maybe"), false);
  assert.equal(parseWorkflowCatalogVerdict("maybe"), null);
});

test("valid WorkflowManifest normalizes text, deduplicates lists, orders waves, and freezes deeply", () => {
  const input = makeWorkflow("one", {
    name: "  Workflow\r\none  ",
    goals: [" Goal\r\nOne ", "Goal\nOne"],
    additionalRequiredApprovalActions: ["extra", "extra"],
  });
  const before = clone(input);
  const manifest = requireManifest(input);
  assert.equal(manifest.name, "Workflow\none");
  assert.deepEqual(manifest.goals, ["Goal\nOne"]);
  assert.deepEqual(manifest.additionalRequiredApprovalActions, ["extra"]);
  assert.deepEqual(manifest.steps.map((step) => step.id), ["approve-one", "execute-one"]);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.steps), true);
  assert.equal(Object.isFrozen((manifest.steps[1] as { requestedResources: unknown }).requestedResources), true);
  assert.deepEqual(input, before);
  assert.notStrictEqual(manifest, input);
});

const manifestFields = [
  "id", "projectId", "departmentId", "version", "name", "summary", "status", "triggerMode",
  "goals", "nonGoals", "steps", "finalStepIds", "additionalRequiredApprovalActions",
  "additionalForbiddenActions",
] as const;

for (const field of manifestFields) test(`WorkflowManifest rejects missing field ${field}`, () => {
  const input = makeWorkflow() as Record<string, unknown>;
  delete input[field];
  const result = validateAndNormalizeWorkflowManifest(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.code === "required_field" && error.path === field));
});

test("WorkflowManifest rejects unknown and inherited fields", () => {
  const unknown = validateAndNormalizeWorkflowManifest({ ...makeWorkflow(), providerConfig: "secret" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.ok(unknown.errors.some((error) => error.code === "unknown_field" && error.path === "providerConfig"));
  assert.equal(validateAndNormalizeWorkflowManifest(Object.create(makeWorkflow())).ok, false);
});

test("WorkflowManifest rejects hostile and non-object roots without throw", () => {
  for (const input of [null, undefined, true, 1, "workflow", [], new Set(), new Map()]) {
    assert.doesNotThrow(() => validateAndNormalizeWorkflowManifest(input));
    assert.equal(validateAndNormalizeWorkflowManifest(input).ok, false);
  }
});

test("WorkflowManifest rejects getters without invoking them", () => {
  let calls = 0;
  const input = makeWorkflow();
  Object.defineProperty(input, "name", { enumerable: true, get() { calls += 1; return "unsafe"; } });
  assert.equal(validateAndNormalizeWorkflowManifest(input).ok, false);
  assert.equal(calls, 0);
});

test("WorkflowManifest rejects throwing and stateful proxies fail-closed", () => {
  const throwing = new Proxy(makeWorkflow(), { ownKeys() { throw new Error("no"); } });
  assert.doesNotThrow(() => validateAndNormalizeWorkflowManifest(throwing));
  assert.equal(validateAndNormalizeWorkflowManifest(throwing).ok, false);
  let reads = 0;
  const stateful = new Proxy(makeWorkflow(), {
    getOwnPropertyDescriptor(target, property) {
      reads += 1;
      if (reads > 2) throw new Error("changed");
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  assert.equal(validateAndNormalizeWorkflowManifest(stateful).ok, false);
});

test("WorkflowManifest rejects cycles, array-like substitutes, and nested Set/Map", () => {
  const cyclic = makeWorkflow() as Record<string, unknown>;
  cyclic.self = cyclic;
  assert.equal(validateAndNormalizeWorkflowManifest(cyclic).ok, false);
  assert.equal(validateAndNormalizeWorkflowManifest({ ...makeWorkflow(), goals: { 0: "goal", length: 1 } }).ok, false);
  assert.equal(validateAndNormalizeWorkflowManifest({ ...makeWorkflow(), goals: new Set(["goal"]) }).ok, false);
  assert.equal(validateAndNormalizeWorkflowManifest({ ...makeWorkflow(), goals: new Map() }).ok, false);
});

test("WorkflowManifest rejects Array subclasses as non-ordinary arrays", () => {
  class HostileArray<T> extends Array<T> {}
  const input = makeWorkflow();
  input.goals = new HostileArray("goal");
  assert.equal(validateAndNormalizeWorkflowManifest(input).ok, false);
});

test("WorkflowManifest rejects sparse and accessor arrays", () => {
  const sparse = makeWorkflow();
  sparse.goals = Array(1);
  assert.equal(validateAndNormalizeWorkflowManifest(sparse).ok, false);
  const accessor = makeWorkflow();
  Object.defineProperty(accessor.goals, "0", { enumerable: true, get() { return "goal"; } });
  assert.equal(validateAndNormalizeWorkflowManifest(accessor).ok, false);
});

const fieldBoundaries = [
  ["name", workflowManifestLimits.maxNameLength],
  ["summary", workflowManifestLimits.maxSummaryLength],
] as const;
for (const [field, limit] of fieldBoundaries) test(`${field} accepts exact limit and denies limit + 1`, () => {
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { [field]: "x".repeat(limit) })).ok, true);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { [field]: "x".repeat(limit + 1) })).ok, false);
});

const listBoundaries = [
  ["goals", workflowManifestLimits.maxGoals, "Goal"],
  ["nonGoals", workflowManifestLimits.maxNonGoals, "Non goal"],
  ["additionalRequiredApprovalActions", workflowManifestLimits.maxAdditionalApprovalActions, "Approval"],
  ["additionalForbiddenActions", workflowManifestLimits.maxAdditionalForbiddenActions, "Forbidden"],
] as const;
for (const [field, limit, prefix] of listBoundaries) test(`${field} accepts exact item limit and denies limit + 1`, () => {
  const exact = Array.from({ length: limit }, (_, index) => `${prefix} ${index}`);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { [field]: exact })).ok, true);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { [field]: [...exact, `${prefix} overflow`] })).ok, false);
});

test("text list items enforce exact length and control-character validation", () => {
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { goals: ["x".repeat(workflowManifestLimits.maxTextListItemLength)] })).ok, true);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { goals: ["x".repeat(workflowManifestLimits.maxTextListItemLength + 1)] })).ok, false);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { goals: ["unsafe\u0000goal"] })).ok, false);
});

test("steps enforce exact count limit and reject limit + 1", () => {
  const steps = Array.from({ length: workflowManifestLimits.maxSteps }, (_, index) => makeGate("one", {
    id: `gate-${String(index).padStart(3, "0")}`,
    approvalAction: "workflow-external-one",
  }));
  const finals = steps.map((step) => step.id);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps, finalStepIds: finals })).ok, true);
  const overflow = [...steps, makeGate("one", { id: "gate-overflow" })];
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: overflow, finalStepIds: [...finals, "gate-overflow"] })).ok, false);
});

test("dependencies enforce exact limit and reject limit + 1", () => {
  const roots = Array.from({ length: workflowManifestLimits.maxDependenciesPerStep + 1 }, (_, index) => makeGate("one", { id: `gate-${index}`, approvalAction: "workflow-external-one" }));
  const exactTask = makeAgentStep("one", { dependsOnStepIds: roots.slice(0, workflowManifestLimits.maxDependenciesPerStep).map((step) => step.id) });
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [...roots.slice(0, -1), exactTask], finalStepIds: [exactTask.id] })).ok, true);
  const overflowTask = makeAgentStep("one", { dependsOnStepIds: roots.map((step) => step.id) });
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [...roots, overflowTask], finalStepIds: [overflowTask.id] })).ok, false);
});

test("resource, Knowledge, and tool arrays enforce their limits", () => {
  const resources = Array.from({ length: workflowManifestLimits.maxResourcesPerStep }, (_, index) => ({ resourceId: `resource-${index}`, capabilities: ["read_metadata"] }));
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { requestedResources: resources })] })).ok, true);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { requestedResources: [...resources, { resourceId: "overflow", capabilities: ["read_metadata"] }] })] })).ok, false);
  const knowledge = Array.from({ length: workflowManifestLimits.maxKnowledgeCollectionIds }, (_, index) => `knowledge-${index}`);
  const tools = Array.from({ length: workflowManifestLimits.maxToolIds }, (_, index) => `tool-${index}`);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { knowledgeCollectionIds: knowledge, toolIds: tools })] })).ok, true);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { knowledgeCollectionIds: [...knowledge, "knowledge-overflow"] })] })).ok, false);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { toolIds: [...tools, "tool-overflow"] })] })).ok, false);
});

test("capabilities reject empty, unknown, and limit + 1 arrays", () => {
  for (const capabilities of [[], ["unknown"], ["read_metadata", "read_content", "propose_change", "execute", "publish", "read_metadata"]]) {
    assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { requestedResources: [{ resourceId: "repository-one", capabilities }] })] })).ok, false);
  }
});

test("step discriminants reject fields belonging to the other kind", () => {
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [{ ...makeGate(), agentId: "agent-one" }, makeAgentStep()] })).ok, false);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), { ...makeAgentStep(), approvalAction: "extra" }] })).ok, false);
});

test("agent_task outputType uses the canonical AI-019 enum", () => {
  const result = validateAndNormalizeWorkflowManifest(makeWorkflow("one", {
    steps: [makeGate(), makeAgentStep("one", { outputType: "provider-output" })],
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.code === "invalid_enum" && error.path === "steps[1].outputType"));
});

test("resource entries reject missing and unknown fields", () => {
  for (const resource of [
    { capabilities: ["read_metadata"] },
    { resourceId: "repository-one" },
    { resourceId: "repository-one", capabilities: ["read_metadata"], rawConnection: "secret" },
  ]) {
    assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", {
      steps: [makeGate(), makeAgentStep("one", { requestedResources: [resource] })],
    })).ok, false);
  }
});

test("approval_gate requires approvalAction", () => {
  const gate = makeGate() as Record<string, unknown>;
  delete gate.approvalAction;
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [gate] })).ok, false);
});

const commonStepFields = ["id", "kind", "name", "dependsOnStepIds"] as const;
for (const field of commonStepFields) test(`steps reject missing common field ${field}`, () => {
  const step = makeAgentStep() as Record<string, unknown>;
  delete step[field];
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), step] })).ok, false);
});

const agentFields = [
  "agentId", "agentBindingId", "outputType", "requestedResources", "modelProfileId",
  "knowledgeCollectionIds", "toolIds", "maxAttempts", "timeoutMinutes", "actionMode",
  "requiredApprovalAction",
] as const;
for (const field of agentFields) test(`agent_task rejects missing field ${field}`, () => {
  const step = makeAgentStep() as Record<string, unknown>;
  delete step[field];
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), step] })).ok, false);
});

test("actionMode nullable rules are structural and fail-closed", () => {
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeAgentStep("one", { dependsOnStepIds: [], actionMode: "none", requiredApprovalAction: null })] })).ok, true);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeAgentStep("one", { dependsOnStepIds: [], actionMode: "proposal_only", requiredApprovalAction: null })] })).ok, true);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeAgentStep("one", { dependsOnStepIds: [], actionMode: "none", requiredApprovalAction: "approval" })] })).ok, false);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeAgentStep("one", { dependsOnStepIds: [], actionMode: "external_action", requiredApprovalAction: null })] })).ok, false);
});

test("positive integer boundaries are enforced for version, attempts, and timeout", () => {
  for (const input of [
    makeWorkflow("one", { version: 0 }),
    makeWorkflow("one", { version: 1.5 }),
    makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { maxAttempts: 0 })] }),
    makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { maxAttempts: workflowManifestLimits.maxStepAttempts + 1 })] }),
    makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { timeoutMinutes: 0 })] }),
    makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { timeoutMinutes: workflowManifestLimits.maxStepTimeoutMinutes + 1 })] }),
  ]) assert.equal(validateAndNormalizeWorkflowManifest(input).ok, false);
});

test("parallel DAG produces deterministic lexical topological waves", () => {
  const steps = [
    makeAgentStep("one", { id: "finish", dependsOnStepIds: ["beta", "alpha"], actionMode: "none", requiredApprovalAction: null }),
    makeGate("one", { id: "beta" }),
    makeGate("one", { id: "alpha" }),
  ];
  const manifest = requireManifest(makeWorkflow("one", { steps, finalStepIds: ["finish"] }));
  assert.deepEqual(manifest.steps.map((step) => step.id), ["alpha", "beta", "finish"]);
});

test("graph rejects unknown dependency with exact source path", () => {
  const result = validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeAgentStep("one", { dependsOnStepIds: ["missing"] })] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.code === "unknown_step_dependency" && error.path === "steps[0].dependsOnStepIds[0]"));
});

test("graph rejects self-dependency", () => {
  const result = validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeAgentStep("one", { dependsOnStepIds: ["execute-one"] })] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.code === "self_dependency"));
});

test("graph rejects direct and indirect cycles", () => {
  const direct = makeWorkflow("one", { steps: [makeGate("one", { dependsOnStepIds: ["execute-one"] }), makeAgentStep()] });
  assert.equal(validateAndNormalizeWorkflowManifest(direct).ok, false);
  const indirect = makeWorkflow("one", { steps: [
    makeGate("one", { id: "a", dependsOnStepIds: ["c"] }),
    makeGate("one", { id: "b", dependsOnStepIds: ["a"] }),
    makeGate("one", { id: "c", dependsOnStepIds: ["b"] }),
  ], finalStepIds: ["c"] });
  const result = validateAndNormalizeWorkflowManifest(indirect);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.code === "workflow_cycle"));
});

test("graph rejects duplicate step IDs and duplicate dependencies", () => {
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), makeGate()] })).ok, false);
  assert.equal(validateAndNormalizeWorkflowManifest(makeWorkflow("one", { steps: [makeGate(), makeAgentStep("one", { dependsOnStepIds: ["approve-one", "approve-one"] })] })).ok, false);
});

test("finalStepIds must contain every and only sink exactly once", () => {
  for (const finalStepIds of [[], ["approve-one"], ["execute-one", "approve-one"], ["missing"], ["execute-one", "execute-one"]]) {
    const result = validateAndNormalizeWorkflowManifest(makeWorkflow("one", { finalStepIds }));
    assert.equal(result.ok, false);
  }
  const duplicate = validateAndNormalizeWorkflowManifest(makeWorkflow("one", {
    finalStepIds: ["execute-one", "execute-one"],
  }));
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.ok(duplicate.errors.some((error) => error.code === "invalid_final_step"));
});

test("validation errors are capped at 256", () => {
  const input = makeWorkflow() as Record<string, unknown>;
  for (let index = 0; index < 300; index += 1) input[`unknown-${index}`] = true;
  const result = validateAndNormalizeWorkflowManifest(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.length, workflowManifestLimits.maxErrors);
});

test("catalog allow uses factual AI-016 and AI-019 decisions and has no partial/raw state", () => {
  const input = makeCatalog();
  const before = clone(input);
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.registryDecision?.verdict, "allow");
  assert.equal(decision.agentCatalogDecision?.verdict, "allow");
  assert.equal(decision.normalizedCatalog?.workflows.length, 1);
  assert.deepEqual(decision.normalizedCatalog?.workflows[0].executionWaves, [["approve-one"], ["execute-one"]]);
  assert.equal(Object.isFrozen(decision.normalizedCatalog), true);
  assert.equal("registry" in (decision.normalizedCatalog ?? {}), false);
  assert.equal("agents" in (decision.normalizedCatalog ?? {}), false);
  assert.deepEqual(input, before);
});

test("catalog deny preserves factual invalid Agent Catalog decision and no partial catalog", () => {
  const input = makeCatalog();
  input.agents = [];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedCatalog, null);
  assert.equal(decision.agentCatalogDecision?.verdict, "deny");
  assert.ok(codes(decision).includes("invalid_agent_catalog"));
});

test("catalog deny preserves factual invalid Registry decision", () => {
  const input = makeCatalog();
  input.registry.workspaceId = "wrong-workspace";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedCatalog, null);
  assert.equal(decision.agentCatalogDecision?.registryDecision?.verdict, "deny");
});

test("every workflow binding requires exactly one manifest", () => {
  const missing = makeCatalog();
  missing.workflows = [];
  const missingDecision = evaluateWorkspaceWorkflowCatalog(missing);
  assert.equal(missingDecision.verdict, "deny");
  assert.ok(codes(missingDecision).includes("missing_workflow_manifest"));
  const duplicate = makeCatalog();
  duplicate.workflows.push(clone(duplicate.workflows[0]));
  const duplicateDecision = evaluateWorkspaceWorkflowCatalog(duplicate);
  assert.equal(duplicateDecision.verdict, "deny");
  assert.ok(codes(duplicateDecision).includes("duplicate_workflow_binding"));
});

test("manifest without a Workflow binding is denied", () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings = input.registry.projects[0].bindings.filter(
    (binding) => binding.kind !== "workflow",
  );
  input.workflows[0].bindingId = "missing-binding";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("workflow_binding_not_found"));
});

test("Workflow IDs are globally unique", () => {
  const input = makeCatalog(["one", "two"]);
  input.workflows[1].workflowManifest.id = "workflow-one";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("duplicate_workflow_id"));
});

test("binding kind must be workflow", () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings = input.registry.projects[0].bindings.filter(
    (binding) => binding.kind !== "workflow",
  );
  input.workflows[0].bindingId = "agent-binding-one";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("binding_not_workflow"));
});

const linkageCases = [
  ["projectId", "project-other", "workflow_project_mismatch"],
  ["departmentId", "department-other", "workflow_department_mismatch"],
  ["id", "workflow-other", "workflow_subject_mismatch"],
] as const;
for (const [field, value, code] of linkageCases) test(`exact Workflow linkage denies mismatched ${field}`, () => {
  const input = makeCatalog();
  input.workflows[0].workflowManifest[field] = value;
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes(code));
});

test("Department enabledWorkflowIds membership is mandatory", () => {
  const input = makeCatalog();
  input.registry.projects[0].departmentManifests[0].enabledWorkflowIds = [];
  input.agents[0].agentManifest.allowedWorkflowIds = [];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("workflow_not_enabled"));
});

test("cross-project Agent assignment is denied without fallback", () => {
  const input = makeCatalog(["one", "two"]);
  const step = input.workflows[0].workflowManifest.steps[0] as unknown as Record<string, unknown>;
  step.agentId = "agent-two";
  step.agentBindingId = "agent-binding-two";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("agent_project_mismatch"));
});

test("cross-department Agent assignment is denied", () => {
  const input = makeCatalog();
  input.agents[0].agentManifest.departmentId = "department-other";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedCatalog, null);
});

test("coherent Agent in another Department of the same Project is denied", () => {
  const input = makeCatalog();
  const sourceDepartment = input.registry.projects[0].departmentManifests[0];
  input.registry.projects[0].departmentManifests.push({
    ...clone(sourceDepartment),
    id: "department-two",
    code: "qa-code-review",
    name: "QA Department",
  });
  const sourceBinding = input.registry.projects[0].bindings[0];
  input.registry.projects[0].bindings.push({
    ...clone(sourceBinding),
    id: "agent-binding-two",
    departmentId: "department-two",
    subjectId: "agent-two",
  });
  input.agents.push({
    bindingId: "agent-binding-two",
    agentManifest: {
      ...clone(input.agents[0].agentManifest),
      id: "agent-two",
      departmentId: "department-two",
      instructionProfileId: "instructions-two",
    },
  });
  const step = input.workflows[0].workflowManifest.steps[0] as unknown as Record<string, unknown>;
  step.agentId = "agent-two";
  step.agentBindingId = "agent-binding-two";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("agent_department_mismatch"));
});

test("Agent must explicitly allow the Workflow", () => {
  const input = makeCatalog();
  input.agents[0].agentManifest.allowedWorkflowIds = [];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("agent_workflow_not_allowed"));
});

test("agent_workflow_not_allowed preserves the raw agent_task index", () => {
  const input = makeCatalog();
  input.agents[0].agentManifest.allowedWorkflowIds = [];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reasons.some((reason) =>
    reason.code === "agent_workflow_not_allowed"
    && reason.path === "workflows[0].workflowManifest.steps[0].agentId"
  ));
});

test("agent_project_mismatch preserves the raw agent_task index", () => {
  const input = makeCatalog(["one", "two"]);
  const step = input.workflows[0].workflowManifest.steps[0] as unknown as Record<string, unknown>;
  step.agentId = "agent-two";
  step.agentBindingId = "agent-binding-two";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reasons.some((reason) =>
    reason.code === "agent_project_mismatch"
    && reason.path === "workflows[0].workflowManifest.steps[0].agentId"
  ));
});

test("agent_not_found preserves the raw agent_task index", () => {
  const input = makeCatalog();
  const step = input.workflows[0].workflowManifest.steps[0] as unknown as Record<string, unknown>;
  step.agentId = "agent-missing";
  step.agentBindingId = "agent-binding-missing";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reasons.some((reason) =>
    reason.code === "agent_not_found"
    && reason.path === "workflows[0].workflowManifest.steps[0].agentId"
  ));
});

test("reverse Workflow order preserves raw Workflow and agent_task indexes deterministically", () => {
  const input = makeCatalog(["two", "one"]);
  const agent = input.agents.find((candidate) =>
    candidate.agentManifest.id === "agent-one"
  );
  assert.ok(agent);
  agent.agentManifest.allowedWorkflowIds = [];
  const before = clone(input);
  const first = evaluateWorkspaceWorkflowCatalog(input);
  const repeated = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(first.verdict, "deny");
  assert.equal(first.normalizedCatalog, null);
  assert.deepEqual(repeated, first);
  assert.ok(first.reasons.some((reason) =>
    reason.code === "agent_workflow_not_allowed"
    && reason.path === "workflows[1].workflowManifest.steps[0].agentId"
  ));
  assert.deepEqual(input, before);
});

const stepScopeCases = [
  ["requestedResources", [{ resourceId: "resource-other", capabilities: ["read_metadata"] }], "resource_not_granted"],
  ["requestedResources", [{ resourceId: "repository-one", capabilities: ["read_content"] }], "capability_not_granted"],
  ["modelProfileId", "model-other", "model_not_granted"],
  ["knowledgeCollectionIds", ["knowledge-other"], "knowledge_not_granted"],
  ["toolIds", ["tool-other"], "tool_not_allowed"],
  ["outputType", "owner_report", "output_not_allowed"],
] as const;
for (const [field, value, code] of stepScopeCases) test(`step scope expansion ${field} fails closed`, () => {
  const input = makeCatalog();
  const step = input.workflows[0].workflowManifest.steps[0] as unknown as Record<string, unknown>;
  step[field] = clone(value);
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedCatalog, null);
  assert.ok(codes(decision).includes(code));
});

test("resource capability must be granted by both Workflow and Agent bindings", () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings[0].requestedResources[0].capabilities = ["read_metadata"];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("capability_not_granted"));
});

test("maxAttempts and timeout accept minimum boundary and deny boundary + 1", () => {
  const allow = evaluateWorkspaceWorkflowCatalog(makeCatalog());
  assert.equal(allow.verdict, "allow");
  for (const [field, value] of [["maxAttempts", 3], ["timeoutMinutes", 31]] as const) {
    const input = makeCatalog();
    const step = input.workflows[0].workflowManifest.steps[0] as unknown as Record<string, unknown>;
    step[field] = value;
    const decision = evaluateWorkspaceWorkflowCatalog(input);
    assert.equal(decision.verdict, "deny");
    assert.ok(codes(decision).includes("budget_ceiling_exceeded"));
  }
});

test("approval gate must be transitively ancestral, not merely present", () => {
  const input = makeCatalog();
  input.workflows[0].workflowManifest.steps[0].dependsOnStepIds = [];
  input.workflows[0].workflowManifest.finalStepIds = ["approve-one", "execute-one"];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("approval_gate_missing"));
});

test("transitive matching approval gate allows external action configuration", () => {
  const input = makeCatalog();
  input.workflows[0].workflowManifest.steps = [
    makeGate(),
    makeAgentStep("one", { id: "prepare", dependsOnStepIds: ["approve-one"], actionMode: "none", requiredApprovalAction: null }),
    makeAgentStep("one", { dependsOnStepIds: ["prepare"] }),
  ];
  assert.equal(evaluateWorkspaceWorkflowCatalog(input).verdict, "allow");
});

test("locked external actions are denied", () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings[1].externalActionMode = "locked";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("policy_relaxation"));
});

test("Agent binding locked mode also denies an external-action step", () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings[0].externalActionMode = "locked";
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("policy_relaxation"));
});

test("approval gates cannot invent or use forbidden actions", () => {
  const invented = makeCatalog();
  const gate = invented.workflows[0].workflowManifest.steps[1] as unknown as Record<string, unknown>;
  gate.approvalAction = "invented-approval";
  assert.ok(codes(evaluateWorkspaceWorkflowCatalog(invented)).includes("policy_relaxation"));
  const forbidden = makeCatalog();
  forbidden.workflows[0].workflowManifest.additionalForbiddenActions = ["workflow-external-one"];
  const decision = evaluateWorkspaceWorkflowCatalog(forbidden);
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("forbidden_action"));
});

test("Agent binding effective forbidden policy denies a Workflow external action", () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings[0].additionalForbiddenActions = [
    "workflow-external-one",
  ];
  const before = clone(input);
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedCatalog, null);
  const reason = decision.reasons.find((candidate) =>
    candidate.code === "forbidden_action"
    && candidate.path === "workflows[0].workflowManifest.steps[0].requiredApprovalAction"
  );
  assert.deepEqual(reason, {
    code: "forbidden_action",
    path: "workflows[0].workflowManifest.steps[0].requiredApprovalAction",
    message: "Approval workflow-external-one is forbidden by the Workflow or assigned Agent effective policy.",
    projectId: "project-one",
    departmentId: "department-one",
    workflowId: "workflow-one",
    workflowBindingId: "workflow-binding-one",
    stepId: "execute-one",
    agentId: "agent-one",
    agentBindingId: "agent-binding-one",
  });
  assert.deepEqual(input, before);
});

test("AgentManifest effective forbidden policy denies a Workflow external action", () => {
  const input = makeCatalog();
  input.agents[0].agentManifest.additionalForbiddenActions = [
    "workflow-external-one",
  ];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedCatalog, null);
  assert.ok(decision.reasons.some((reason) =>
    reason.code === "forbidden_action"
    && reason.path === "workflows[0].workflowManifest.steps[0].requiredApprovalAction"
  ));
});

test("Workflow and Agent forbidding the same action produce one canonical step reason", () => {
  const input = makeCatalog();
  input.workflows[0].workflowManifest.additionalForbiddenActions = [
    "workflow-external-one",
  ];
  input.agents[0].agentManifest.additionalForbiddenActions = [
    "workflow-external-one",
  ];
  const first = evaluateWorkspaceWorkflowCatalog(input);
  const repeated = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(first.verdict, "deny");
  assert.equal(first.normalizedCatalog, null);
  assert.deepEqual(repeated, first);
  assert.equal(first.reasons.filter((reason) =>
    reason.code === "forbidden_action"
    && reason.path === "workflows[0].workflowManifest.steps[0].requiredApprovalAction"
  ).length, 1);
});

test("unrelated Agent forbidden actions do not block an approved Workflow action", () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings[0].additionalForbiddenActions = [
    "agent-forbidden-unrelated",
  ];
  input.agents[0].agentManifest.additionalForbiddenActions = [
    "agent-manifest-forbidden-unrelated",
  ];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "allow");
  assert.notEqual(decision.normalizedCatalog, null);
});

test("Agent forbidden reason preserves original Workflow and step indexes after sorting", () => {
  const input = makeCatalog(["two", "one"]);
  const project = input.registry.projects.find((candidate) =>
    candidate.projectManifest.id === "project-one"
  );
  const binding = project?.bindings.find((candidate) =>
    candidate.id === "agent-binding-one"
  );
  assert.ok(binding);
  binding.additionalForbiddenActions = ["workflow-external-one"];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reasons.some((reason) =>
    reason.code === "forbidden_action"
    && reason.path === "workflows[1].workflowManifest.steps[0].requiredApprovalAction"
  ));
});

test("Agent forbidden deny is deterministic across Registry/Agent order and has no partial profile", () => {
  const input = makeCatalog(["one", "two"]);
  input.agents[0].agentManifest.additionalForbiddenActions = [
    "workflow-external-one",
  ];
  const before = clone(input);
  const first = evaluateWorkspaceWorkflowCatalog(input);
  const repeated = evaluateWorkspaceWorkflowCatalog(input);
  const reversed = clone(input);
  reversed.registry.projects.reverse();
  reversed.agents.reverse();
  const reverseDecision = evaluateWorkspaceWorkflowCatalog(reversed);
  assert.deepEqual(repeated, first);
  assert.deepEqual(reverseDecision, first);
  assert.deepEqual(input, before);
  const resolution = resolveWorkflowExecutionProfile(makeResolution(input));
  assert.equal(resolution.verdict, "deny");
  assert.equal(resolution.catalogDecision.normalizedCatalog, null);
  assert.equal(resolution.profile, null);
  assert.equal(resolution.contextDecision, null);
  assert.deepEqual(resolution.agentDecisions, []);
});

test("Workflow policy additions preserve inherited-first order at 64-item boundary", () => {
  const input = makeCatalog();
  const approvals = Array.from({ length: workflowManifestLimits.maxAdditionalApprovalActions }, (_, index) => `Workflow approval ${index}`);
  const forbidden = Array.from({ length: workflowManifestLimits.maxAdditionalForbiddenActions }, (_, index) => `Workflow forbidden ${index}`);
  input.workflows[0].workflowManifest.additionalRequiredApprovalActions = approvals;
  input.workflows[0].workflowManifest.additionalForbiddenActions = forbidden;
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "allow");
  const entry = decision.normalizedCatalog?.workflows[0];
  assert.deepEqual(entry?.effectiveRequiredApprovalActions.slice(-64), approvals);
  assert.deepEqual(entry?.effectiveForbiddenActions.slice(-64), forbidden);
});

test("catalog evaluation is deterministic, fresh, order-independent, and immutable", () => {
  const input = makeCatalog(["one", "two"]);
  const before = clone(input);
  const first = evaluateWorkspaceWorkflowCatalog(input);
  const repeated = evaluateWorkspaceWorkflowCatalog(input);
  const reversed = makeCatalog(["two", "one"]);
  const reverseDecision = evaluateWorkspaceWorkflowCatalog(reversed);
  assert.equal(first.verdict, "allow");
  assert.deepEqual(repeated, first);
  assert.deepEqual(reverseDecision, first);
  assert.notStrictEqual(repeated.normalizedCatalog, first.normalizedCatalog);
  assert.deepEqual(input, before);
});

test("invalid manifest reason retains caller source path after canonical sorting", () => {
  const input = makeCatalog(["two", "one"]);
  input.workflows[1].workflowManifest.steps[0].dependsOnStepIds = ["missing"];
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reasons.some((reason) => reason.path === "workflows[1].workflowManifest.steps[0].dependsOnStepIds[0]"));
});

test("catalog hostile input, getters, proxy, and cycles deny without partial output", () => {
  const cyclic = makeCatalog() as unknown as Record<string, unknown>;
  cyclic.self = cyclic;
  let calls = 0;
  const getter = makeCatalog();
  Object.defineProperty(getter, "agents", { enumerable: true, get() { calls += 1; return []; } });
  const proxy = new Proxy(makeCatalog(), { getOwnPropertyDescriptor() { throw new Error("no"); } });
  for (const input of [null, [], new Set(), cyclic, getter, proxy]) {
    const decision = evaluateWorkspaceWorkflowCatalog(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.normalizedCatalog, null);
  }
  assert.equal(calls, 0);
});

test("catalog absolute entry limit denies before partial evaluation", () => {
  const input = makeCatalog();
  input.workflows = Array(workflowManifestLimits.maxCatalogEntries + 1).fill(null) as never;
  const decision = evaluateWorkspaceWorkflowCatalog(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedCatalog, null);
  assert.ok(codes(decision).includes("limit_exceeded"));
});

test("resolution allows exact active Workflow and preserves factual decisions", () => {
  const input = makeResolution();
  const before = clone(input);
  const decision = resolveWorkflowExecutionProfile(input);
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.catalogDecision.verdict, "allow");
  assert.equal(decision.contextDecision?.verdict, "allow");
  assert.equal(decision.agentDecisions.length, 1);
  assert.equal(decision.agentDecisions[0].verdict, "allow");
  assert.equal(decision.profile?.workflowId, "workflow-one");
  assert.deepEqual(decision.profile?.executionWaves, [["approve-one"], ["execute-one"]]);
  assert.equal(Object.isFrozen(decision.profile), true);
  assert.equal(Object.isFrozen(decision.profile?.agents[0]), true);
  assert.deepEqual(input, before);
});

test("resolution is deterministic, fresh, and deeply frozen", () => {
  const input = makeResolution();
  const first = resolveWorkflowExecutionProfile(input);
  const repeated = resolveWorkflowExecutionProfile(input);
  assert.deepEqual(repeated, first);
  assert.notStrictEqual(repeated.profile, first.profile);
  assert.notStrictEqual(repeated.profile?.agents[0], first.profile?.agents[0]);
  assert.equal(Object.isFrozen(repeated.profile?.steps), true);
  assert.equal(Object.isFrozen(repeated.profile?.resources[0].capabilities), true);
});

for (const status of ["draft", "paused", "disabled"] as const) test(`resolution denies Workflow status ${status}`, () => {
  const input = makeCatalog();
  input.workflows[0].workflowManifest.status = status;
  const decision = resolveWorkflowExecutionProfile(makeResolution(input));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.profile, null);
  assert.ok(codes(decision).includes("workflow_not_active"));
});

for (const status of ["draft", "paused", "disabled"] as const) test(`resolution denies Workflow binding status ${status}`, () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings[1].status = status;
  const decision = resolveWorkflowExecutionProfile(makeResolution(input));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.profile, null);
  assert.ok(codes(decision).includes("binding_not_active"));
});

for (const status of ["draft", "paused", "disabled"] as const) test(`catalog permits but resolution denies Agent status ${status}`, () => {
  const input = makeCatalog();
  input.agents[0].agentManifest.status = status;
  assert.equal(evaluateWorkspaceWorkflowCatalog(input).verdict, "allow");
  const decision = resolveWorkflowExecutionProfile(makeResolution(input));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.profile, null);
  assert.ok(codes(decision).includes("agent_resolution_denied"));
});

for (const status of ["draft", "paused", "disabled"] as const) test(`catalog permits but resolution denies Agent binding status ${status}`, () => {
  const input = makeCatalog();
  input.registry.projects[0].bindings[0].status = status;
  assert.equal(evaluateWorkspaceWorkflowCatalog(input).verdict, "allow");
  const decision = resolveWorkflowExecutionProfile(makeResolution(input));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.profile, null);
  assert.ok(codes(decision).includes("agent_resolution_denied"));
});

test("resolution uses exact project, Workflow, and binding IDs without fallback", () => {
  for (const overrides of [
    { projectId: "project-missing" },
    { workflowId: "workflow-missing" },
    { bindingId: "workflow-binding-missing" },
    { projectId: "project-two", workflowId: "workflow-one", bindingId: "workflow-binding-one" },
  ]) {
    const decision = resolveWorkflowExecutionProfile(makeResolution(makeCatalog(["one", "two"]), overrides));
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.profile, null);
  }
});

test("resolution hostile envelope, getters, proxies, and cycles fail closed", () => {
  let calls = 0;
  const getter = makeResolution();
  Object.defineProperty(getter, "catalog", { enumerable: true, get() { calls += 1; return makeCatalog(); } });
  const cyclic = makeResolution() as unknown as Record<string, unknown>;
  cyclic.self = cyclic;
  const proxy = new Proxy(makeResolution(), { ownKeys() { throw new Error("no"); } });
  for (const input of [null, [], getter, cyclic, proxy]) {
    const decision = resolveWorkflowExecutionProfile(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.profile, null);
  }
  assert.equal(calls, 0);
});

test("resolution profile excludes raw and sensitive fields", () => {
  const decision = resolveWorkflowExecutionProfile(makeResolution());
  assert.equal(decision.verdict, "allow");
  const profile = decision.profile as unknown as Record<string, unknown>;
  for (const field of ["registry", "manifests", "decisions", "resourceRef", "connectionId", "credentials", "providerConfig", "runtimeCounters"]) assert.equal(Object.hasOwn(profile, field), false);
  const serialized = JSON.stringify(profile);
  assert.equal(serialized.includes("owner/repository-one"), false);
  assert.equal(serialized.includes("connection-one"), false);
});

test("all global denies return no partial catalog/profile", () => {
  const invalidCatalog = makeCatalog();
  invalidCatalog.workflows[0].workflowManifest.projectId = "project-other";
  const catalogDecision = evaluateWorkspaceWorkflowCatalog(invalidCatalog);
  assert.equal(catalogDecision.normalizedCatalog, null);
  const resolutionDecision = resolveWorkflowExecutionProfile(makeResolution(invalidCatalog));
  assert.equal(resolutionDecision.profile, null);
  assert.equal(resolutionDecision.contextDecision, null);
  assert.deepEqual(resolutionDecision.agentDecisions, []);
});

test("contract performs configuration evaluation only and exposes no runtime mutation API", () => {
  const exported = Object.keys(contract).sort();
  for (const forbidden of ["run", "dispatch", "publish", "send", "retry", "persist", "schedule", "executeTool"]) assert.equal(exported.includes(forbidden), false);
});
