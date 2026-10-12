import assert from "node:assert/strict";
import test from "node:test";

const contract = (await import(
  new URL("../lib/contracts/agent-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/agent-manifest");
const contextContract = (await import(
  new URL("../lib/contracts/project-context.ts", import.meta.url).href
)) as typeof import("../lib/contracts/project-context");

const {
  agentCatalogVerdicts,
  agentManifestLimits,
  agentManifestStatuses,
  agentOutputTypes,
  agentRoleCodes,
  evaluateWorkspaceAgentCatalog,
  isAgentCatalogVerdict,
  isAgentManifestStatus,
  isAgentOutputType,
  isAgentRoleCode,
  parseAgentCatalogVerdict,
  parseAgentManifestStatus,
  parseAgentOutputType,
  parseAgentRoleCode,
  resolveAgentExecutionProfile,
  validateAndNormalizeAgentManifest,
} = contract;

function makeBudget(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    maxConcurrentRuns: 4,
    maxAttemptsPerRun: 2,
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
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
      additionalRequiredApprovalActions: [`department-review-${suffix}`],
      additionalForbiddenActions: [`Department ${suffix} publication is forbidden`],
    },
    budget: makeBudget({
      maxConcurrentRuns: 2,
      maxAttemptsPerRun: 1,
      maxRunMinutes: 60,
      dailyTokenBudget: 500_000,
      monthlyCostBudgetUsdCents: 100_000,
    }),
    ...overrides,
  };
}

function makeBinding(suffix = "one", overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `binding-${suffix}`,
    projectId: `project-${suffix}`,
    departmentId: `department-${suffix}`,
    version: 7,
    status: "active",
    kind: "agent",
    subjectId: `agent-${suffix}`,
    requestedResources: [{ resourceId: `repository-${suffix}`, capabilities: ["read_metadata"] }],
    requestedModelProfileIds: ["model-shared", `model-${suffix}`],
    requestedKnowledgeCollectionIds: [`knowledge-${suffix}`],
    requestedBudget: makeBudget({
      maxConcurrentRuns: 1,
      maxAttemptsPerRun: 1,
      maxRunMinutes: 30,
      dailyTokenBudget: 250_000,
      monthlyCostBudgetUsdCents: 50_000,
    }),
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    additionalRequiredApprovalActions: [`binding-review-${suffix}`],
    additionalForbiddenActions: [`Binding ${suffix} external actions are forbidden`],
    ...overrides,
  };
}

function makeContext(suffix = "one", overrides: Readonly<Record<string, unknown>> = {}) {
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
    outputTypes: ["test_report", "patch", "test_report"],
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
    additionalRequiredApprovalActions: [`agent-review-${suffix}`],
    additionalForbiddenActions: [`Agent ${suffix} deploy is forbidden`],
    ...overrides,
  };
}

function makeCatalog(suffixes: readonly string[] = ["one"]) {
  return {
    registry: makeRegistry(suffixes),
    agents: suffixes.map((suffix) => ({ bindingId: `binding-${suffix}`, agentManifest: makeAgent(suffix) })),
  };
}

function resolutionInput(catalog: unknown = makeCatalog()) {
  return { catalog, projectId: "project-one", agentId: "agent-one", bindingId: "binding-one" };
}

function codes(decision: Readonly<{ reasons: readonly { code: string }[] }>) {
  return decision.reasons.map((reason) => reason.code);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

test("exports frozen canonical enums and limits", () => {
  assert.deepEqual(agentManifestStatuses, ["draft", "active", "paused", "disabled"]);
  assert.equal(agentRoleCodes.length, 11);
  assert.equal(agentOutputTypes.length, 14);
  assert.deepEqual(agentCatalogVerdicts, ["allow", "deny"]);
  assert.equal(agentManifestLimits.maxCatalogEntries, 8_192);
  assert.ok(Object.isFrozen(agentManifestStatuses));
  assert.ok(Object.isFrozen(agentRoleCodes));
  assert.ok(Object.isFrozen(agentOutputTypes));
  assert.ok(Object.isFrozen(agentManifestLimits));
});

for (const value of agentManifestStatuses) {
  test(`status guard and parser accept ${value}`, () => {
    assert.equal(isAgentManifestStatus(value), true);
    assert.equal(parseAgentManifestStatus(value), value);
  });
}

for (const value of agentRoleCodes) {
  test(`role guard and parser accept ${value}`, () => {
    assert.equal(isAgentRoleCode(value), true);
    assert.equal(parseAgentRoleCode(value), value);
  });
}

for (const value of agentOutputTypes) {
  test(`output guard and parser accept ${value}`, () => {
    assert.equal(isAgentOutputType(value), true);
    assert.equal(parseAgentOutputType(value), value);
  });
}

for (const value of agentCatalogVerdicts) {
  test(`catalog verdict guard and parser accept ${value}`, () => {
    assert.equal(isAgentCatalogVerdict(value), true);
    assert.equal(parseAgentCatalogVerdict(value), value);
  });
}

test("enum guards and parsers reject unknown values", () => {
  assert.equal(isAgentManifestStatus("archived"), false);
  assert.equal(parseAgentManifestStatus("archived"), null);
  assert.equal(isAgentRoleCode("provider-specific"), false);
  assert.equal(parseAgentRoleCode("provider-specific"), null);
  assert.equal(isAgentOutputType("raw_model_output"), false);
  assert.equal(parseAgentOutputType("raw_model_output"), null);
  assert.equal(isAgentCatalogVerdict("maybe"), false);
  assert.equal(parseAgentCatalogVerdict("maybe"), null);
});

test("role codes are provider-neutral", () => {
  const providerNames = ["codex", "qwen", "claude", "deepseek", "openai", "anthropic"];
  assert.deepEqual(agentRoleCodes.filter((role) => providerNames.includes(role)), []);
});

test("valid AgentManifest is normalized, deduplicated, canonically ordered, and frozen", () => {
  const input = makeAgent("one", {
    name: "  Developer\r\none  ",
    goals: [" Goal\rOne ", "Goal\nOne"],
    allowedToolIds: ["tool-read", "tool-read"],
  });
  const result = validateAndNormalizeAgentManifest(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, "Developer\none");
  assert.deepEqual(result.value.goals, ["Goal\nOne"]);
  assert.deepEqual(result.value.outputTypes, ["patch", "test_report"]);
  assert.deepEqual(result.value.allowedToolIds, ["tool-read"]);
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.value.modelRouting));
  assert.notStrictEqual(result.value, input);
});

const requiredManifestFields = [
  "id", "projectId", "departmentId", "version", "roleCode", "name", "summary", "status",
  "instructionProfileId", "goals", "nonGoals", "outputTypes", "allowedWorkflowIds", "allowedToolIds",
  "allowedModelProfileIds", "knowledgeCollectionIds", "modelRouting",
  "additionalRequiredApprovalActions", "additionalForbiddenActions",
] as const;

for (const field of requiredManifestFields) {
  test(`AgentManifest rejects missing required field ${field}`, () => {
    const input = makeAgent() as Record<string, unknown>;
    delete input[field];
    const result = validateAndNormalizeAgentManifest(input);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((error) => error.code === "required_field" && error.path === field));
  });
}

test("AgentManifest rejects unknown and inherited fields", () => {
  const unknown = validateAndNormalizeAgentManifest({ ...makeAgent(), rawPrompt: "secret" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.ok(unknown.errors.some((error) => error.code === "unknown_field" && error.path === "rawPrompt"));
  const inherited = Object.create(makeAgent());
  const inheritedResult = validateAndNormalizeAgentManifest(inherited);
  assert.equal(inheritedResult.ok, false);
});

test("AgentManifest rejects primitive, null, and Array roots", () => {
  for (const input of [null, undefined, true, 1, "agent", []]) {
    const result = validateAndNormalizeAgentManifest(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors[0]?.code, "invalid_input");
  }
});

test("AgentManifest rejects invalid IDs and versions", () => {
  for (const input of [
    makeAgent("one", { id: "UPPER" }),
    makeAgent("one", { projectId: "space id" }),
    makeAgent("one", { instructionProfileId: "x".repeat(65) }),
    makeAgent("one", { version: 0 }),
    makeAgent("one", { version: 1.5 }),
  ]) assert.equal(validateAndNormalizeAgentManifest(input).ok, false);
});

test("AgentManifest enforces string and collection boundaries", () => {
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { name: "x".repeat(161) })).ok, false);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { summary: "x".repeat(4_097) })).ok, false);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { goals: Array.from({ length: 33 }, (_, index) => `goal-${index}`) })).ok, false);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { allowedToolIds: Array.from({ length: 65 }, (_, index) => `tool-${index}`) })).ok, false);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { additionalForbiddenActions: ["x".repeat(1_025)] })).ok, false);
});

test("AgentManifest requires non-empty output and model collections", () => {
  for (const input of [makeAgent("one", { outputTypes: [] }), makeAgent("one", { allowedModelProfileIds: [] })]) {
    const result = validateAndNormalizeAgentManifest(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((error) => error.code === "empty_collection"));
  }
});

test("AgentManifest validates all model routing invariants", () => {
  const cases = [
    ["primary_model_not_allowed", { primaryModelProfileId: "model-other", fallbackModelProfileIds: [], reviewerModelProfileId: null, independentReviewRequired: false }],
    ["fallback_model_not_allowed", { primaryModelProfileId: "model-shared", fallbackModelProfileIds: ["model-other"], reviewerModelProfileId: null, independentReviewRequired: false }],
    ["primary_model_in_fallback", { primaryModelProfileId: "model-shared", fallbackModelProfileIds: ["model-shared"], reviewerModelProfileId: null, independentReviewRequired: false }],
    ["reviewer_model_not_allowed", { primaryModelProfileId: "model-shared", fallbackModelProfileIds: [], reviewerModelProfileId: "model-other", independentReviewRequired: false }],
    ["reviewer_required", { primaryModelProfileId: "model-shared", fallbackModelProfileIds: [], reviewerModelProfileId: null, independentReviewRequired: true }],
    ["reviewer_matches_primary", { primaryModelProfileId: "model-shared", fallbackModelProfileIds: [], reviewerModelProfileId: "model-shared", independentReviewRequired: true }],
  ] as const;
  for (const [code, modelRouting] of cases) {
    const result = validateAndNormalizeAgentManifest(makeAgent("one", { modelRouting }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((error) => error.code === code), code);
  }
});

test("AgentManifest rejects arrays, cyclic field values, throwing getters, and proxies without throw", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const throwing = { ...makeAgent() };
  Object.defineProperty(throwing, "name", { enumerable: true, get() { throw new Error("no"); } });
  const proxy = new Proxy(makeAgent(), { ownKeys() { throw new Error("no"); } });
  for (const input of [[], { ...makeAgent(), goals: cyclic }, throwing, proxy]) {
    assert.doesNotThrow(() => validateAndNormalizeAgentManifest(input));
    assert.equal(validateAndNormalizeAgentManifest(input).ok, false);
  }
});

test("AgentManifest rejects Set, Map, and array-like collection substitutes", () => {
  for (const goals of [new Set(["goal"]), new Map([["goal", true]]), { 0: "goal", length: 1 }]) {
    const result = validateAndNormalizeAgentManifest(makeAgent("one", { goals }));
    assert.equal(result.ok, false);
  }
});

test("AgentManifest requires a strict routing boolean", () => {
  const agent = makeAgent();
  agent.modelRouting.independentReviewRequired = 1 as unknown as boolean;
  const result = validateAndNormalizeAgentManifest(agent);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.path === "modelRouting.independentReviewRequired"));
});

test("AgentManifest exact scalar boundaries allow max and deny max plus one", () => {
  const id64 = `a${"b".repeat(63)}`;
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { id: id64, name: "n".repeat(160), summary: "s".repeat(4_096), version: Number.MAX_SAFE_INTEGER })).ok, true);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { id: `${id64}c` })).ok, false);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { name: "n".repeat(161) })).ok, false);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { summary: "s".repeat(4_097) })).ok, false);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { version: Number.MAX_SAFE_INTEGER + 1 })).ok, false);
});

const collectionBoundaries = [
  ["goals", agentManifestLimits.maxGoals, (index: number) => `goal-${index}`],
  ["nonGoals", agentManifestLimits.maxNonGoals, (index: number) => `non-goal-${index}`],
  ["allowedWorkflowIds", agentManifestLimits.maxWorkflowIds, (index: number) => `workflow-${index}`],
  ["allowedToolIds", agentManifestLimits.maxToolIds, (index: number) => `tool-${index}`],
  ["knowledgeCollectionIds", agentManifestLimits.maxKnowledgeCollectionIds, (index: number) => `knowledge-${index}`],
  ["additionalRequiredApprovalActions", agentManifestLimits.maxAdditionalApprovalActions, (index: number) => `Approval ${index}`],
  ["additionalForbiddenActions", agentManifestLimits.maxAdditionalForbiddenActions, (index: number) => `Forbidden ${index}`],
] as const;

for (const [field, limit, item] of collectionBoundaries) {
  test(`AgentManifest enforces exact ${field} collection boundary`, () => {
    assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { [field]: Array.from({ length: limit }, (_, index) => item(index)) })).ok, true);
    assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { [field]: Array.from({ length: limit + 1 }, (_, index) => item(index)) })).ok, false);
  });
}

test("AgentManifest enforces output, model, and fallback exact boundaries", () => {
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { outputTypes: [...agentOutputTypes] })).ok, true);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { outputTypes: [...agentOutputTypes, "summary"] })).ok, false);
  const models = Array.from({ length: agentManifestLimits.maxModelProfileIds }, (_, index) => `model-${index}`);
  const routing = { primaryModelProfileId: models[0], fallbackModelProfileIds: models.slice(1, 9), reviewerModelProfileId: models[9], independentReviewRequired: true };
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { allowedModelProfileIds: models, modelRouting: routing })).ok, true);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { allowedModelProfileIds: [...models, "model-over"], modelRouting: routing })).ok, false);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { allowedModelProfileIds: models, modelRouting: { ...routing, fallbackModelProfileIds: models.slice(1, 10) } })).ok, false);
});

test("AgentManifest enforces exact text-list item boundary", () => {
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { goals: ["x".repeat(agentManifestLimits.maxTextListItemLength)] })).ok, true);
  assert.equal(validateAndNormalizeAgentManifest(makeAgent("one", { goals: ["x".repeat(agentManifestLimits.maxTextListItemLength + 1)] })).ok, false);
});

test("AgentManifest caps errors and returns fresh values without mutating input", () => {
  const input = makeAgent();
  const before = clone(input);
  const first = validateAndNormalizeAgentManifest(input);
  const second = validateAndNormalizeAgentManifest(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.notStrictEqual(first.value, second.value);
    assert.notStrictEqual(first.value.goals, second.value.goals);
  }
  const hostile = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`unknown-${index}`, true]));
  const denied = validateAndNormalizeAgentManifest(hostile);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.errors.length, agentManifestLimits.maxErrors);
});

test("valid catalog uses the factual AI-016 decision and canonical entries", () => {
  const decision = evaluateWorkspaceAgentCatalog(makeCatalog(["two", "one"]));
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.registryDecision?.verdict, "allow");
  assert.deepEqual(decision.normalizedCatalog?.agents.map((entry) => entry.agentManifest.id), ["agent-one", "agent-two"]);
  assert.ok(Object.isFrozen(decision.normalizedCatalog));
  assert.ok(Object.isFrozen(decision.normalizedCatalog?.agents));
  assert.equal(decision.normalizedCatalog?.agents.every((entry) => entry.agentManifest.roleCode === "developer"), true);
  assert.equal(decision.normalizedCatalog?.agents.every((entry) => entry.agentManifest.allowedModelProfileIds.includes("model-shared")), true);
});

test("valid catalog is reverse-order deterministic", () => {
  const forward = makeCatalog(["one", "two"]);
  const reverse = { registry: makeRegistry(["two", "one"]), agents: [...forward.agents].reverse() };
  assert.deepEqual(evaluateWorkspaceAgentCatalog(forward), evaluateWorkspaceAgentCatalog(reverse));
});

test("catalog evaluation is repeated-call deterministic and returns fresh normalized values", () => {
  const input = makeCatalog();
  const first = evaluateWorkspaceAgentCatalog(input);
  const second = evaluateWorkspaceAgentCatalog(input);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.normalizedCatalog, second.normalizedCatalog);
});

test("catalog evaluation does not mutate Registry, entries, bindings, or manifests", () => {
  const input = makeCatalog(["one", "two"]);
  const before = clone(input);
  evaluateWorkspaceAgentCatalog(input);
  assert.deepEqual(input, before);
});

test("catalog denies invalid envelope and entry shapes", () => {
  for (const input of [null, {}, { ...makeCatalog(), extra: true }, { registry: makeRegistry(), agents: {} }, { registry: makeRegistry(), agents: [{ bindingId: "binding-one" }] }]) {
    const decision = evaluateWorkspaceAgentCatalog(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.normalizedCatalog, null);
  }
});

test("catalog enforces its derived maximum before Registry evaluation", () => {
  const agents = Array.from({ length: agentManifestLimits.maxCatalogEntries + 1 }, () => null);
  const decision = evaluateWorkspaceAgentCatalog({ registry: new Proxy({}, { ownKeys() { throw new Error("must not inspect"); } }), agents });
  assert.equal(decision.verdict, "deny");
  assert.deepEqual(codes(decision), ["limit_exceeded"]);
  assert.equal(decision.registryDecision, null);
});

test("catalog exact maximum crosses the limit stage without an off-by-one denial", () => {
  const agents = Array.from({ length: agentManifestLimits.maxCatalogEntries }, () => null);
  const decision = evaluateWorkspaceAgentCatalog({ registry: null, agents });
  assert.deepEqual(codes(decision), ["invalid_registry"]);
});

test("catalog preserves factual Registry denial", () => {
  const catalog = makeCatalog();
  catalog.registry.workspaceId = "workspace-other";
  const factualDecision = contextContract.evaluateWorkspaceProjectContexts(catalog.registry);
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedCatalog, null);
  assert.equal(decision.registryDecision?.verdict, "deny");
  assert.deepEqual(decision.registryDecision, factualDecision);
  assert.deepEqual(codes(decision), ["invalid_registry"]);
});

test("catalog maps manifest errors to source-accurate paths", () => {
  const catalog = makeCatalog(["two", "one"]);
  catalog.agents[1] = { bindingId: "binding-one", agentManifest: makeAgent("one", { roleCode: "unknown" }) };
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reasons.some((reason) => reason.path === "agents[1].agentManifest.roleCode"));
});

test("catalog preserves caller paths after canonical sorting", () => {
  const catalog = makeCatalog(["two", "one"]);
  catalog.agents[1].agentManifest = makeAgent("one", { allowedWorkflowIds: ["workflow-missing"] });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.reasons[0]?.path, "agents[1].agentManifest.allowedWorkflowIds[0]");
});

test("catalog rejects duplicate binding entries", () => {
  const catalog = makeCatalog();
  catalog.agents.push({ bindingId: "binding-one", agentManifest: makeAgent("one", { id: "agent-copy" }) });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.ok(codes(decision).includes("duplicate_agent_binding"));
  assert.equal(decision.normalizedCatalog, null);
});

test("catalog rejects globally duplicate Agent IDs", () => {
  const catalog = makeCatalog(["one", "two"]);
  catalog.registry.projects[1].bindings[0].subjectId = "agent-one";
  catalog.agents[1].agentManifest = makeAgent("two", { id: "agent-one" });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.ok(codes(decision).includes("duplicate_agent_id"));
});

test("catalog rejects missing Agent manifests but does not require workflow manifests", () => {
  const missing = evaluateWorkspaceAgentCatalog({ registry: makeRegistry(), agents: [] });
  assert.ok(codes(missing).includes("missing_agent_manifest"));
  const registry = makeRegistry();
  registry.projects[0].bindings[0] = makeBinding("one", { kind: "workflow", subjectId: "workflow-one" });
  const workflowOnly = evaluateWorkspaceAgentCatalog({ registry, agents: [] });
  assert.equal(workflowOnly.verdict, "allow");
});

test("catalog rejects orphan, wrong-project, and non-Agent bindings", () => {
  const orphan = makeCatalog();
  orphan.agents.push({ bindingId: "binding-missing", agentManifest: makeAgent("one", { id: "agent-orphan" }) });
  assert.ok(codes(evaluateWorkspaceAgentCatalog(orphan)).includes("binding_not_found"));
  const wrong = makeCatalog(["one", "two"]);
  wrong.agents[0].bindingId = "binding-two";
  wrong.agents[1].bindingId = "binding-one";
  assert.ok(codes(evaluateWorkspaceAgentCatalog(wrong)).includes("agent_project_mismatch"));
  const workflow = makeCatalog();
  workflow.registry.projects[0].bindings[0].kind = "workflow";
  workflow.registry.projects[0].bindings[0].subjectId = "workflow-one";
  assert.ok(codes(evaluateWorkspaceAgentCatalog(workflow)).includes("binding_not_agent"));
});

test("catalog enforces exact project, Department, and subject linkage", () => {
  const cases = [
    ["agent_project_mismatch", makeAgent("one", { projectId: "project-two" })],
    ["agent_department_mismatch", makeAgent("one", { departmentId: "department-missing" })],
    ["agent_subject_mismatch", makeAgent("one", { id: "agent-different" })],
  ] as const;
  for (const [code, manifest] of cases) {
    const catalog = code === "agent_project_mismatch" ? makeCatalog(["one", "two"]) : makeCatalog();
    if (code === "agent_project_mismatch") {
      catalog.agents[0].bindingId = "binding-one";
    }
    catalog.agents[0].agentManifest = manifest;
    assert.ok(codes(evaluateWorkspaceAgentCatalog(catalog)).includes(code), code);
  }
});

test("catalog enforces Department workflow subset", () => {
  const catalog = makeCatalog();
  catalog.agents[0].agentManifest = makeAgent("one", { allowedWorkflowIds: ["workflow-other"] });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.ok(codes(decision).includes("workflow_not_enabled"));
  assert.equal(decision.normalizedCatalog, null);
});

test("catalog allows an empty workflow subset for a manual advisory Agent", () => {
  const catalog = makeCatalog();
  catalog.agents[0].agentManifest = makeAgent("one", { allowedWorkflowIds: [] });
  assert.equal(evaluateWorkspaceAgentCatalog(catalog).verdict, "allow");
});

test("catalog enforces binding-effective model subset", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].projectManifest.allowedModelProfileIds.push("model-other");
  catalog.registry.projects[0].departmentManifests[0].allowedModelProfileIds.push("model-other");
  catalog.agents[0].agentManifest = makeAgent("one", {
    allowedModelProfileIds: ["model-shared", "model-other"],
    modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: [], reviewerModelProfileId: null, independentReviewRequired: false },
  });
  assert.ok(codes(evaluateWorkspaceAgentCatalog(catalog)).includes("model_not_granted"));
});

test("catalog enforces binding-effective Knowledge subset", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].projectManifest.knowledgeCollectionIds.push("knowledge-other");
  catalog.registry.projects[0].departmentManifests[0].knowledgeCollectionIds.push("knowledge-other");
  catalog.agents[0].agentManifest = makeAgent("one", { knowledgeCollectionIds: ["knowledge-other"] });
  assert.ok(codes(evaluateWorkspaceAgentCatalog(catalog)).includes("knowledge_not_granted"));
});

test("catalog stably inherits and deduplicates approval and forbidden policy", () => {
  const catalog = makeCatalog();
  catalog.agents[0].agentManifest = makeAgent("one", {
    additionalRequiredApprovalActions: ["binding-review-one", "agent-review-one"],
    additionalForbiddenActions: ["Binding one external actions are forbidden", "Agent one deploy is forbidden"],
  });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(decision.verdict, "allow");
  const entry = decision.normalizedCatalog?.agents[0];
  assert.equal(entry?.effectiveRequiredApprovalActions.filter((value) => value === "binding-review-one").length, 1);
  assert.equal(entry?.effectiveForbiddenActions.filter((value) => value === "Binding one external actions are forbidden").length, 1);
  assert.equal(entry?.effectiveRequiredApprovalActions.at(-1), "agent-review-one");
});

test("catalog applies parent ordering to workflow, model, and Knowledge subsets", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].departmentManifests[0].enabledWorkflowIds = ["workflow-extra", "workflow-one"];
  catalog.registry.projects[0].bindings[0].requestedModelProfileIds = ["model-one", "model-shared"];
  catalog.registry.projects[0].projectManifest.knowledgeCollectionIds = ["knowledge-one", "knowledge-extra"];
  catalog.registry.projects[0].departmentManifests[0].knowledgeCollectionIds = ["knowledge-one", "knowledge-extra"];
  catalog.registry.projects[0].bindings[0].requestedKnowledgeCollectionIds = ["knowledge-extra", "knowledge-one"];
  catalog.agents[0].agentManifest = makeAgent("one", {
    allowedWorkflowIds: ["workflow-one", "workflow-extra"],
    allowedModelProfileIds: ["model-one", "model-shared"],
    knowledgeCollectionIds: ["knowledge-extra", "knowledge-one"],
    modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: ["model-one"], reviewerModelProfileId: "model-one", independentReviewRequired: true },
  });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.normalizedCatalog?.agents[0].agentManifest.allowedWorkflowIds, ["workflow-extra", "workflow-one"]);
  assert.deepEqual(decision.normalizedCatalog?.agents[0].agentManifest.allowedModelProfileIds, ["model-shared", "model-one"]);
  assert.deepEqual(decision.normalizedCatalog?.agents[0].agentManifest.knowledgeCollectionIds, ["knowledge-one", "knowledge-extra"]);
});

test("Project with 64 custom approvals remains catalog-valid without Agent additions", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].projectManifest.policy.requiredApprovalActions = Array.from(
    { length: 64 },
    (_, index) => `Project approval ${index}`,
  );
  catalog.registry.projects[0].departmentManifests = [];
  catalog.registry.projects[0].bindings = [];
  catalog.agents = [];
  assert.equal(evaluateWorkspaceAgentCatalog(catalog).verdict, "allow");
});

test("Project with 64 custom forbidden actions remains catalog-valid without Agent additions", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].projectManifest.policy.forbiddenActions = Array.from(
    { length: 64 },
    (_, index) => `Project forbidden action ${index}`,
  );
  catalog.registry.projects[0].departmentManifests = [];
  catalog.registry.projects[0].bindings = [];
  catalog.agents = [];
  assert.equal(evaluateWorkspaceAgentCatalog(catalog).verdict, "allow");
});

test("maximum inherited approvals plus 64 Agent approvals are allowed", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].projectManifest.policy.requiredApprovalActions = Array.from(
    { length: 64 },
    (_, index) => `Project approval ${index}`,
  );
  catalog.registry.projects[0].departmentManifests[0].policy.additionalRequiredApprovalActions = Array.from(
    { length: 64 },
    (_, index) => `Department approval ${index}`,
  );
  catalog.registry.projects[0].bindings[0].additionalRequiredApprovalActions = [];
  const additions = Array.from({ length: 64 }, (_, index) => `Agent approval ${index}`);
  catalog.agents[0].agentManifest = makeAgent("one", { additionalRequiredApprovalActions: additions });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.normalizedCatalog?.agents[0].effectiveRequiredApprovalActions.length, 202);
  assert.deepEqual(decision.normalizedCatalog?.agents[0].effectiveRequiredApprovalActions.slice(-64), additions);
});

test("maximum inherited forbidden actions plus 64 Agent additions are allowed", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].projectManifest.policy.forbiddenActions = Array.from(
    { length: 64 },
    (_, index) => `Project forbidden action ${index}`,
  );
  catalog.registry.projects[0].departmentManifests[0].policy.additionalForbiddenActions = Array.from(
    { length: 64 },
    (_, index) => `Department forbidden action ${index}`,
  );
  catalog.registry.projects[0].bindings[0].additionalForbiddenActions = [];
  const additions = Array.from({ length: 64 }, (_, index) => `Agent forbidden action ${index}`);
  catalog.agents[0].agentManifest = makeAgent("one", { additionalForbiddenActions: additions });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.normalizedCatalog?.agents[0].effectiveForbiddenActions.length, 197);
  assert.deepEqual(decision.normalizedCatalog?.agents[0].effectiveForbiddenActions.slice(-64), additions);
});

test("65 Agent-specific policy additions fail structural validation", () => {
  for (const field of ["additionalRequiredApprovalActions", "additionalForbiddenActions"] as const) {
    const result = validateAndNormalizeAgentManifest(makeAgent("one", {
      [field]: Array.from({ length: 65 }, (_, index) => `Agent policy ${index}`),
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((error) => error.code === "limit_exceeded" && error.path === field));
  }
});

test("Agent additions repeated from inherited policy do not consume effective capacity", () => {
  const catalog = makeCatalog();
  catalog.agents[0].agentManifest = makeAgent("one", {
    additionalRequiredApprovalActions: ["binding-review-one", ...Array.from({ length: 63 }, (_, index) => `Agent approval ${index}`)],
    additionalForbiddenActions: ["Binding one external actions are forbidden", ...Array.from({ length: 63 }, (_, index) => `Agent forbidden ${index}`)],
  });
  const decision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(decision.verdict, "allow");
  const entry = decision.normalizedCatalog?.agents[0];
  assert.equal(entry?.effectiveRequiredApprovalActions.filter((value) => value === "binding-review-one").length, 1);
  assert.equal(entry?.effectiveForbiddenActions.filter((value) => value === "Binding one external actions are forbidden").length, 1);
});

test("AgentManifest exposes no mechanism for removing inherited restrictions", () => {
  const result = validateAndNormalizeAgentManifest({ ...makeAgent(), requiredApprovalActions: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.code === "unknown_field"));
});

test("inactive Agent and binding states remain catalog-valid", () => {
  const pausedAgent = makeCatalog();
  pausedAgent.agents[0].agentManifest = makeAgent("one", { status: "paused" });
  assert.equal(evaluateWorkspaceAgentCatalog(pausedAgent).verdict, "allow");
  const pausedBinding = makeCatalog();
  pausedBinding.registry.projects[0].bindings[0].status = "paused";
  assert.equal(evaluateWorkspaceAgentCatalog(pausedBinding).verdict, "allow");
});

test("catalog fails closed for throwing getters and proxies", () => {
  const throwing = makeCatalog();
  Object.defineProperty(throwing.agents[0], "agentManifest", { enumerable: true, get() { throw new Error("no"); } });
  for (const input of [throwing, new Proxy(makeCatalog(), { ownKeys() { throw new Error("no"); } })]) {
    assert.doesNotThrow(() => evaluateWorkspaceAgentCatalog(input));
    const decision = evaluateWorkspaceAgentCatalog(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.normalizedCatalog, null);
  }
});

test("valid resolution returns exact frozen owner-safe profile", () => {
  const decision = resolveAgentExecutionProfile(resolutionInput());
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.catalogDecision.verdict, "allow");
  assert.equal(decision.contextDecision?.verdict, "allow");
  assert.ok(decision.profile);
  assert.deepEqual(Object.keys(decision.profile ?? {}).sort(), [
    "agentId", "agentManifestVersion", "allowedModelProfileIds", "allowedToolIds",
    "allowedWorkflowIds", "bindingId", "bindingVersion", "budget", "dataEgressMode",
    "departmentId", "departmentManifestVersion", "externalActionMode", "forbiddenActions", "instructionProfileId",
    "knowledgeCollectionIds", "modelRouting", "outputTypes", "projectId", "projectManifestVersion", "requiredApprovalActions",
    "resources", "roleCode", "workspaceId",
  ].sort());
  assert.ok(Object.isFrozen(decision.profile));
  assert.ok(Object.isFrozen(decision.profile?.resources));
  assert.equal(decision.profile?.resources.every((resource) => Object.isFrozen(resource) && Object.isFrozen(resource.capabilities)), true);
  assert.ok(Object.isFrozen(decision.profile?.modelRouting));
  assert.ok(Object.isFrozen(decision.profile?.budget));
  assert.ok(Object.isFrozen(decision.profile?.requiredApprovalActions));
  assert.ok(Object.isFrozen(decision.profile?.forbiddenActions));
  assert.ok(decision.profile?.requiredApprovalActions.includes("agent-review-one"));
  assert.equal("agentManifest" in (decision.profile ?? {}), false);
  assert.equal("resourceRef" in (decision.profile?.resources[0] ?? {}), false);
  assert.equal("connectionId" in (decision.profile?.resources[0] ?? {}), false);
});

test("stateful catalog Registry getter fails closed before Registry A/B can be mixed", () => {
  const registryA = makeRegistry();
  const registryB = clone(registryA);
  registryB.projects[0].bindings[0].version += 1;
  registryB.projects[0].bindings[0].requestedResources[0].capabilities.push("propose_change");
  registryB.projects[0].bindings[0].requestedBudget.maxConcurrentRuns = 2;
  let reads = 0;
  const catalog = {
    agents: [{ bindingId: "binding-one", agentManifest: makeAgent() }],
    get registry() {
      reads += 1;
      return reads === 1 ? registryA : registryB;
    },
  };
  const decision = resolveAgentExecutionProfile(resolutionInput(catalog));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.profile, null);
  assert.equal(decision.contextDecision, null);
  assert.deepEqual(codes(decision), ["invalid_input"]);
  assert.equal(reads, 0);
});

test("stateful nested binding, budget, and resource getters fail closed without access", () => {
  const cases = [
    (catalog: ReturnType<typeof makeCatalog>, onRead: () => void) => {
      Object.defineProperty(catalog.registry.projects[0].bindings[0], "version", {
        enumerable: true,
        get() { onRead(); return 7; },
      });
    },
    (catalog: ReturnType<typeof makeCatalog>, onRead: () => void) => {
      Object.defineProperty(catalog.registry.projects[0].bindings[0].requestedBudget, "maxConcurrentRuns", {
        enumerable: true,
        get() { onRead(); return 1; },
      });
    },
    (catalog: ReturnType<typeof makeCatalog>, onRead: () => void) => {
      Object.defineProperty(catalog.registry.projects[0].bindings[0].requestedResources[0], "capabilities", {
        enumerable: true,
        get() { onRead(); return ["read_metadata"]; },
      });
    },
  ];
  for (const installGetter of cases) {
    const catalog = makeCatalog();
    let reads = 0;
    installGetter(catalog, () => { reads += 1; });
    const decision = resolveAgentExecutionProfile(resolutionInput(catalog));
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.profile, null);
    assert.equal(decision.contextDecision, null);
    assert.equal(reads, 0);
  }
});

test("proxied Registry cannot bypass the canonical snapshot boundary", () => {
  const catalog = makeCatalog();
  catalog.registry = new Proxy(catalog.registry, {});
  const decision = resolveAgentExecutionProfile(resolutionInput(catalog));
  assert.equal(decision.verdict, "deny");
  assert.deepEqual(codes(decision), ["invalid_input"]);
  assert.equal(decision.contextDecision, null);
  assert.equal(decision.profile, null);
});

test("stateful Registry denials are deterministic across reverse variants and repeated calls", () => {
  function makeStateful(suffixes: readonly string[]) {
    const registryA = makeRegistry(suffixes);
    const registryB = clone(registryA);
    registryB.projects[0].bindings[0].version += 1;
    let reads = 0;
    return {
      agents: suffixes.map((suffix) => ({ bindingId: `binding-${suffix}`, agentManifest: makeAgent(suffix) })),
      get registry() { reads += 1; return reads === 1 ? registryA : registryB; },
    };
  }
  const forwardInput = { catalog: makeStateful(["one", "two"]), projectId: "project-one", agentId: "agent-one", bindingId: "binding-one" };
  const reverseInput = { catalog: makeStateful(["two", "one"]), projectId: "project-one", agentId: "agent-one", bindingId: "binding-one" };
  const first = resolveAgentExecutionProfile(forwardInput);
  const repeated = resolveAgentExecutionProfile(forwardInput);
  const reverse = resolveAgentExecutionProfile(reverseInput);
  assert.deepEqual(first, repeated);
  assert.deepEqual(first, reverse);
  assert.equal(first.verdict, "deny");
  assert.equal(first.profile, null);
});

test("resolution reevaluates raw catalog and rejects caller-supplied normalized decisions", () => {
  const normalized = evaluateWorkspaceAgentCatalog(makeCatalog());
  const decision = resolveAgentExecutionProfile(resolutionInput(normalized));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.profile, null);
  assert.equal(decision.catalogDecision.verdict, "deny");
});

test("resolution precedence returns catalog denial before identifier validation", () => {
  const catalog = makeCatalog();
  catalog.agents = [];
  const decision = resolveAgentExecutionProfile({ catalog, projectId: "INVALID", agentId: "INVALID", bindingId: "INVALID" });
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("missing_agent_manifest"));
  assert.equal(codes(decision).includes("invalid_input"), false);
});

test("resolution denies invalid envelope and identifiers with all nullable outputs null", () => {
  for (const input of [null, { ...resolutionInput(), extra: true }, { ...resolutionInput(), agentId: "INVALID" }]) {
    const decision = resolveAgentExecutionProfile(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.profile, null);
    assert.equal(decision.contextDecision, null);
  }
});

test("resolution distinguishes unknown project, Agent, and binding", () => {
  const cases = [
    ["project_not_found", { ...resolutionInput(), projectId: "project-missing" }],
    ["agent_not_found", { ...resolutionInput(), agentId: "agent-missing" }],
    ["binding_not_found", { ...resolutionInput(), bindingId: "binding-missing" }],
  ] as const;
  for (const [code, input] of cases) {
    const decision = resolveAgentExecutionProfile(input);
    assert.equal(decision.verdict, "deny");
    assert.ok(codes(decision).includes(code), code);
    assert.equal(decision.profile, null);
  }
});

test("resolution never falls back by Agent name, role, slug, or UI selection", () => {
  const catalog = makeCatalog();
  for (const agentId of ["developer-one", "developer", "project-one"]) {
    const decision = resolveAgentExecutionProfile({ ...resolutionInput(catalog), agentId });
    assert.ok(codes(decision).includes("agent_not_found"));
  }
  const selected = resolveAgentExecutionProfile({ ...resolutionInput(catalog), selectedProjectId: "project-one" });
  assert.equal(selected.verdict, "deny");
  assert.deepEqual(codes(selected), ["invalid_input"]);
});

test("an Agent cannot resolve through another Project binding", () => {
  const catalog = makeCatalog(["one", "two"]);
  const decision = resolveAgentExecutionProfile({ catalog, projectId: "project-one", agentId: "agent-one", bindingId: "binding-two" });
  assert.equal(decision.verdict, "deny");
  assert.ok(codes(decision).includes("binding_not_found"));
  assert.equal(decision.profile, null);
});

test("resolution denies inactive Agent before binding resolution", () => {
  const catalog = makeCatalog();
  catalog.agents[0].agentManifest = makeAgent("one", { status: "paused" });
  const decision = resolveAgentExecutionProfile(resolutionInput(catalog));
  assert.ok(codes(decision).includes("agent_not_active"));
  assert.equal(decision.contextDecision, null);
});

for (const status of ["draft", "paused", "disabled"] as const) {
  test(`resolution denies ${status} Agent manifests`, () => {
    const catalog = makeCatalog();
    catalog.agents[0].agentManifest = makeAgent("one", { status });
    const decision = resolveAgentExecutionProfile(resolutionInput(catalog));
    assert.equal(decision.verdict, "deny");
    assert.ok(codes(decision).includes("agent_not_active"));
    assert.equal(decision.profile, null);
  });
}

test("resolution denies inactive binding before AI-016 context resolution", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].bindings[0].status = "paused";
  const decision = resolveAgentExecutionProfile(resolutionInput(catalog));
  assert.ok(codes(decision).includes("binding_not_active"));
  assert.equal(decision.contextDecision, null);
});

test("resolution is deterministic, fresh, and input-immutable", () => {
  const input = resolutionInput();
  const before = clone(input);
  const first = resolveAgentExecutionProfile(input);
  const second = resolveAgentExecutionProfile(input);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first.profile, second.profile);
  assert.deepEqual(input, before);
});

test("resolution preserves the factual AI-016 context decision and inherited values", () => {
  const catalog = makeCatalog();
  const factual = contextContract.resolveProjectExecutionContext({ registry: catalog.registry, projectId: "project-one", bindingId: "binding-one" });
  const decision = resolveAgentExecutionProfile(resolutionInput(catalog));
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.contextDecision, factual);
  assert.deepEqual(decision.profile?.resources, factual.snapshot?.resources);
  assert.deepEqual(decision.profile?.budget, factual.snapshot?.budget);
  assert.equal(decision.profile?.externalActionMode, factual.snapshot?.externalActionMode);
  assert.equal(decision.profile?.dataEgressMode, factual.snapshot?.dataEgressMode);
  for (const approval of factual.snapshot?.requiredApprovalActions ?? []) assert.ok(decision.profile?.requiredApprovalActions.includes(approval));
  for (const forbidden of factual.snapshot?.forbiddenActions ?? []) assert.ok(decision.profile?.forbiddenActions.includes(forbidden));
});

test("execution profile preserves maximum inherited policy plus all unique Agent additions", () => {
  const catalog = makeCatalog();
  catalog.registry.projects[0].projectManifest.policy.requiredApprovalActions = Array.from(
    { length: 64 },
    (_, index) => `Project approval ${index}`,
  );
  catalog.registry.projects[0].projectManifest.policy.forbiddenActions = Array.from(
    { length: 64 },
    (_, index) => `Project forbidden action ${index}`,
  );
  catalog.registry.projects[0].departmentManifests[0].policy.additionalRequiredApprovalActions = Array.from(
    { length: 64 },
    (_, index) => `Department approval ${index}`,
  );
  catalog.registry.projects[0].departmentManifests[0].policy.additionalForbiddenActions = Array.from(
    { length: 64 },
    (_, index) => `Department forbidden action ${index}`,
  );
  catalog.registry.projects[0].bindings[0].additionalRequiredApprovalActions = [];
  catalog.registry.projects[0].bindings[0].additionalForbiddenActions = [];
  const agentApprovals = Array.from({ length: 64 }, (_, index) => `Agent approval ${index}`);
  const agentForbidden = Array.from({ length: 64 }, (_, index) => `Agent forbidden action ${index}`);
  catalog.agents[0].agentManifest = makeAgent("one", {
    additionalRequiredApprovalActions: agentApprovals,
    additionalForbiddenActions: agentForbidden,
  });
  const before = clone(catalog);
  const catalogDecision = evaluateWorkspaceAgentCatalog(catalog);
  const repeatedCatalogDecision = evaluateWorkspaceAgentCatalog(catalog);
  assert.equal(catalogDecision.verdict, "allow");
  assert.deepEqual(repeatedCatalogDecision, catalogDecision);
  const decision = resolveAgentExecutionProfile(resolutionInput(catalog));
  const repeatedDecision = resolveAgentExecutionProfile(resolutionInput(catalog));
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(repeatedDecision, decision);
  assert.notStrictEqual(repeatedDecision.profile, decision.profile);
  assert.deepEqual(catalog, before);
  assert.deepEqual(
    decision.profile?.requiredApprovalActions,
    catalogDecision.normalizedCatalog?.agents[0].effectiveRequiredApprovalActions,
  );
  assert.deepEqual(
    decision.profile?.forbiddenActions,
    catalogDecision.normalizedCatalog?.agents[0].effectiveForbiddenActions,
  );
  assert.equal(decision.profile?.requiredApprovalActions.length, 202);
  assert.equal(decision.profile?.forbiddenActions.length, 197);
  assert.deepEqual(decision.profile?.requiredApprovalActions.slice(-64), agentApprovals);
  assert.deepEqual(decision.profile?.forbiddenActions.slice(-64), agentForbidden);
});

test("every representative resolution denial returns no partial profile", () => {
  const invalidCatalog = makeCatalog();
  invalidCatalog.agents = [];
  const cases = [
    null,
    resolutionInput(invalidCatalog),
    { ...resolutionInput(), projectId: "project-missing" },
    { ...resolutionInput(), agentId: "agent-missing" },
    { ...resolutionInput(), bindingId: "binding-missing" },
  ];
  for (const input of cases) {
    const decision = resolveAgentExecutionProfile(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.profile, null);
  }
});

test("resolution fails closed for hostile catalog and identifier access", () => {
  const throwing = resolutionInput();
  Object.defineProperty(throwing, "agentId", { enumerable: true, get() { throw new Error("no"); } });
  for (const input of [throwing, new Proxy(resolutionInput(), { ownKeys() { throw new Error("no"); } })]) {
    assert.doesNotThrow(() => resolveAgentExecutionProfile(input));
    const decision = resolveAgentExecutionProfile(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.profile, null);
  }
});

test("successful resolution does not perform runtime, network, or external actions", () => {
  const before = clone(makeCatalog());
  const input = resolutionInput(before);
  const decision = resolveAgentExecutionProfile(input);
  assert.equal(decision.verdict, "allow");
  assert.equal(typeof decision.profile, "object");
  assert.deepEqual(input.catalog, before);
});
