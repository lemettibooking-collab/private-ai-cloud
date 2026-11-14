import assert from "node:assert/strict";
import test from "node:test";

const contract = (await import(
  new URL("../lib/contracts/project-context.ts", import.meta.url).href
)) as typeof import("../lib/contracts/project-context");

const {
  evaluateProjectContext,
  evaluateWorkspaceProjectContexts,
  isProjectBindingStatus,
  isProjectContextVerdict,
  parseProjectBindingStatus,
  parseProjectContextVerdict,
  projectBindingStatuses,
  projectContextLimits,
  projectContextVerdicts,
  resolveProjectExecutionContext,
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
    resources: [
      {
        id: `repository-${suffix}`,
        kind: "code_repository",
        label: `Repository ${suffix}`,
        status: "connected",
        connectionId: `connection-${suffix}`,
        resourceRef: `owner/repository-${suffix}`,
        capabilities: ["read_metadata", "read_content", "propose_change"],
      },
    ],
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
        capabilities: ["read_metadata", "propose_change"],
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
      {
        resourceId: `repository-${suffix}`,
        capabilities: ["read_metadata"],
      },
    ],
    requestedModelProfileIds: ["model-shared"],
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

function reasonCodes(decision: Readonly<{ reasons: readonly { code: string }[] }>) {
  return decision.reasons.map((reason) => reason.code);
}

function assertContextDenied(input: unknown, code: string) {
  const decision = evaluateProjectContext(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedContext, null);
  assert.ok(reasonCodes(decision).includes(code), JSON.stringify(decision));
  return decision;
}

function assertRegistryDenied(input: unknown, code: string) {
  const decision = evaluateWorkspaceProjectContexts(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedRegistry, null);
  assert.ok(reasonCodes(decision).includes(code), JSON.stringify(decision));
  return decision;
}

function assertResolutionDenied(input: unknown, code: string) {
  const decision = resolveProjectExecutionContext(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.snapshot, null);
  assert.ok(reasonCodes(decision).includes(code), JSON.stringify(decision));
  return decision;
}

test("exports canonical immutable Project Context enums and limits", () => {
  assert.deepEqual(projectBindingStatuses, ["draft", "active", "paused", "disabled"]);
  assert.deepEqual(projectContextVerdicts, ["allow", "deny"]);
  assert.deepEqual(projectContextLimits, {
    maxIdLength: 64,
    maxProjects: 32,
    maxDepartmentsPerProject: 10,
    maxBindingsPerProject: 256,
    maxErrors: 512,
  });
  assert.equal(Object.isFrozen(projectBindingStatuses), true);
  assert.equal(Object.isFrozen(projectContextVerdicts), true);
  assert.equal(Object.isFrozen(projectContextLimits), true);
});

for (const status of projectBindingStatuses) {
  test(`recognizes binding status ${status}`, () => {
    assert.equal(isProjectBindingStatus(status), true);
    assert.equal(parseProjectBindingStatus(status), status);
  });
}

for (const verdict of projectContextVerdicts) {
  test(`recognizes Project Context verdict ${verdict}`, () => {
    assert.equal(isProjectContextVerdict(verdict), true);
    assert.equal(parseProjectContextVerdict(verdict), verdict);
  });
}

test("guards and parsers reject non-canonical values", () => {
  for (const input of [null, undefined, 1, "ACTIVE", " allow ", {}, []]) {
    assert.equal(isProjectBindingStatus(input), false);
    assert.equal(parseProjectBindingStatus(input), null);
    assert.equal(isProjectContextVerdict(input), false);
    assert.equal(parseProjectContextVerdict(input), null);
  }
});

for (const hostile of [null, undefined, true, 1, "context", [], new Set()]) {
  test(`fails closed for hostile Project Context envelope ${String(hostile)}`, () => {
    assert.doesNotThrow(() => evaluateProjectContext(hostile));
    assertContextDenied(hostile, "invalid_input");
  });
}

test("rejects unknown and inherited Project Context fields", () => {
  assertContextDenied({ ...makeContext(), selectedProjectId: "project-one" }, "invalid_input");
  const inherited = Object.create(makeContext()) as Record<string, unknown>;
  assertContextDenied(inherited, "invalid_input");
});

test("throwing Project Context getters and proxies fail closed", () => {
  const getter = Object.defineProperty({}, "projectManifest", {
    enumerable: true,
    get() {
      throw new Error("hostile getter");
    },
  });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("hostile proxy"); } });
  assertContextDenied(getter, "invalid_input");
  assertContextDenied(proxy, "invalid_input");
});

test("allows a valid active Project Context", () => {
  const decision = evaluateProjectContext(makeContext());
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.reasons.length, 0);
  assert.equal(decision.normalizedContext?.projectId, "project-one");
  assert.equal(decision.normalizedContext?.bindings.length, 1);
});

test("rejects an invalid ProjectManifest without partial context", () => {
  assertContextDenied(makeContext("one", { projectManifest: { id: "broken" } }), "invalid_project_manifest");
});

test("rejects an inactive project", () => {
  const context = makeContext("one", { projectManifest: makeProject("one", { status: "paused" }) });
  assertContextDenied(context, "project_not_active");
});

test("requires ordinary arrays for departments and bindings", () => {
  assertContextDenied(makeContext("one", { departmentManifests: new Set() }), "invalid_department_manifest");
  assertContextDenied(makeContext("one", { bindings: new Set() }), "invalid_binding");
});

test("rejects an invalid DepartmentManifest", () => {
  assertContextDenied(makeContext("one", { departmentManifests: [{ id: "broken" }] }), "invalid_department_manifest");
});

test("rejects a DepartmentManifest from another project through real evaluation", () => {
  const context = makeContext("one", { departmentManifests: [makeDepartment("one", { projectId: "project-other" })] });
  assertContextDenied(context, "department_scope_denied");
});

test("rejects duplicate Department IDs", () => {
  const duplicate = makeDepartment("one", { code: "qa-code-review" });
  assertContextDenied(makeContext("one", { departmentManifests: [makeDepartment("one"), duplicate] }), "duplicate_department_id");
});

test("rejects duplicate Department codes", () => {
  const duplicate = makeDepartment("one", { id: "department-second" });
  assertContextDenied(makeContext("one", { departmentManifests: [makeDepartment("one"), duplicate] }), "duplicate_department_code");
});

test("enforces exact Department collection limit", () => {
  const departments = Array.from({ length: projectContextLimits.maxDepartmentsPerProject }, (_, index) =>
    makeDepartment("one", { id: `department-${index}`, code: ["support", "marketing", "community", "sales", "customer-success", "product", "development", "qa-code-review", "executive-analytics", "legal-documents"][index] }),
  );
  const allowed = evaluateProjectContext(makeContext("one", { departmentManifests: departments, bindings: [] }));
  assert.equal(allowed.verdict, "allow");
  assertContextDenied(makeContext("one", { departmentManifests: [...departments, makeDepartment("one")] }), "limit_exceeded");
});

test("allows a valid Agent binding", () => {
  const decision = evaluateProjectContext(makeContext());
  assert.equal(decision.normalizedContext?.bindings[0]?.kind, "agent");
  assert.equal(decision.normalizedContext?.bindings[0]?.normalizedScope.scopeId, "agent-one");
});

test("allows an enabled Workflow binding", () => {
  const binding = makeBinding("one", { kind: "workflow", subjectId: "workflow-one" });
  const decision = evaluateProjectContext(makeContext("one", { bindings: [binding] }));
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.normalizedContext?.bindings[0]?.kind, "workflow");
});

test("rejects an unknown Workflow through AI-015 membership", () => {
  const binding = makeBinding("one", { kind: "workflow", subjectId: "workflow-unknown" });
  const decision = assertContextDenied(makeContext("one", { bindings: [binding] }), "binding_scope_denied");
  assert.match(decision.reasons[0]?.message ?? "", /workflow_not_enabled/u);
});

test("rejects malformed binding identity and version", () => {
  assertContextDenied(makeContext("one", { bindings: [makeBinding("one", { id: "Bad ID", version: 0 })] }), "invalid_binding");
});

test("rejects unknown binding fields and non-array nested collections", () => {
  assertContextDenied(makeContext("one", { bindings: [makeBinding("one", { selected: true })] }), "invalid_binding");
  assertContextDenied(makeContext("one", { bindings: [makeBinding("one", { requestedResources: new Set() })] }), "invalid_binding");
});

test("invalid binding resource diagnostics retain the exact binding prefix", () => {
  const binding = makeBinding("one", {
    requestedResources: [{ resourceId: "repository-one", capabilities: [] }],
  });
  const context = makeContext("one", { bindings: [binding] });
  const beforeContext = structuredClone(context);
  const beforeBinding = structuredClone(binding);
  const decision = assertContextDenied(context, "invalid_binding");
  assert.ok(
    decision.reasons.some(
      (reason) => reason.path === "bindings[0].requestedResources[0]",
    ),
    JSON.stringify(decision),
  );
  assert.deepEqual(context, beforeContext);
  assert.deepEqual(binding, beforeBinding);
});

test("invalid binding budget diagnostics retain the exact binding prefix", () => {
  const binding = makeBinding("one", {
    requestedBudget: makeBudget({ maxConcurrentRuns: 17 }),
  });
  const context = makeContext("one", { bindings: [binding] });
  const beforeContext = structuredClone(context);
  const beforeBinding = structuredClone(binding);
  const decision = assertContextDenied(context, "invalid_binding");
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.path === "bindings[0].requestedBudget.maxConcurrentRuns",
    ),
    JSON.stringify(decision),
  );
  assert.deepEqual(context, beforeContext);
  assert.deepEqual(binding, beforeBinding);
});

test("rejects binding project mismatch before Department lookup", () => {
  const decision = assertContextDenied(makeContext("one", { bindings: [makeBinding("one", { projectId: "project-other", departmentId: "department-missing" })] }), "binding_project_mismatch");
  assert.equal(reasonCodes(decision).includes("department_not_found"), false);
});

test("rejects unknown binding Department", () => {
  assertContextDenied(makeContext("one", { bindings: [makeBinding("one", { departmentId: "department-missing" })] }), "department_not_found");
});

test("rejects duplicate binding IDs", () => {
  assertContextDenied(makeContext("one", { bindings: [makeBinding("one"), makeBinding("one", { subjectId: "agent-second" })] }), "duplicate_binding_id");
});

test("rejects duplicate kind and subject identity", () => {
  assertContextDenied(makeContext("one", { bindings: [makeBinding("one"), makeBinding("one", { id: "binding-second" })] }), "duplicate_subject_binding");
});

test("allows the same subject ID for different binding kinds when workflow is enabled", () => {
  const department = makeDepartment("one", { enabledWorkflowIds: ["agent-one"] });
  const workflow = makeBinding("one", { id: "binding-workflow", kind: "workflow" });
  const decision = evaluateProjectContext(makeContext("one", { departmentManifests: [department], bindings: [makeBinding("one"), workflow] }));
  assert.equal(decision.verdict, "allow");
});

const deniedBindingCases = [
  ["resource outside project", { requestedResources: [{ resourceId: "repository-unknown", capabilities: ["read_metadata"] }] }],
  ["resource outside Department", { requestedResources: [{ resourceId: "repository-one", capabilities: ["read_content"] }] }],
  ["model outside project", { requestedModelProfileIds: ["model-unknown"] }],
  ["model outside Department", { requestedModelProfileIds: ["model-one"], departmentOverride: { allowedModelProfileIds: ["model-shared"], modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: [], reviewerModelProfileId: null, independentReviewRequired: false } } }],
  ["Knowledge outside project", { requestedKnowledgeCollectionIds: ["knowledge-unknown"] }],
  ["Knowledge outside Department", { requestedKnowledgeCollectionIds: ["knowledge-one"], departmentOverride: { knowledgeCollectionIds: [] } }],
  ["budget above Project", { requestedBudget: makeBudget({ maxConcurrentRuns: 5 }) }],
  ["budget above Department", { requestedBudget: makeBudget({ maxConcurrentRuns: 3, maxAttemptsPerRun: 1, maxRunMinutes: 60, dailyTokenBudget: 500_000, monthlyCostBudgetUsdCents: 100_000 }) }],
  ["external action policy relaxation", { externalActionMode: "approval_required" }],
  ["data egress policy relaxation", { dataEgressMode: "redacted_only" }],
] as const;

for (const [name, rawOverrides] of deniedBindingCases) {
  test(`denies binding ${name} without partial normalized context`, () => {
    const overrides = { ...rawOverrides } as Record<string, unknown>;
    const departmentOverride = overrides.departmentOverride as Record<string, unknown> | undefined;
    delete overrides.departmentOverride;
    const context = makeContext("one", {
      departmentManifests: [makeDepartment("one", departmentOverride)],
      bindings: [makeBinding("one", overrides)],
    });
    assertContextDenied(context, "binding_scope_denied");
  });
}

test("inherits automatic approvals and forbidden actions into effective binding scope", () => {
  const decision = evaluateProjectContext(makeContext());
  const binding = decision.normalizedContext?.bindings[0];
  assert.ok(binding?.effectiveRequiredApprovalActions.includes("project-review-one"));
  assert.ok(binding?.effectiveRequiredApprovalActions.includes("department-review-one"));
  assert.ok(binding?.effectiveRequiredApprovalActions.includes("binding-review-one"));
  assert.ok(binding?.effectiveForbiddenActions.includes("Project one production actions are forbidden"));
  assert.ok(binding?.effectiveForbiddenActions.includes("Department one publication is forbidden"));
  assert.ok(binding?.effectiveForbiddenActions.includes("Binding one external actions are forbidden"));
});

test("Project Context evaluation is deterministic, fresh, and input-immutable", () => {
  const input = makeContext();
  const before = structuredClone(input);
  const first = evaluateProjectContext(input);
  const second = evaluateProjectContext(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.notStrictEqual(first.normalizedContext, second.normalizedContext);
  assert.notStrictEqual(first.normalizedContext?.bindings, second.normalizedContext?.bindings);
});

test("enforces exact binding ID and collection limits", () => {
  const boundaryBindings = Array.from(
    { length: projectContextLimits.maxBindingsPerProject },
    (_, index) =>
      makeBinding("one", {
        id: `binding-b${index}`,
        subjectId: `agent-b${index}`,
      }),
  );
  const boundary = evaluateProjectContext(
    makeContext("one", { bindings: boundaryBindings }),
  );
  assert.equal(boundary.verdict, "allow");
  assertContextDenied(
    makeContext("one", {
      bindings: [...boundaryBindings, makeBinding("one", { id: "binding-overflow", subjectId: "agent-overflow" })],
    }),
    "limit_exceeded",
  );
  assert.equal(
    evaluateProjectContext(
      makeContext("one", { bindings: [makeBinding("one", { id: "a".repeat(64) })] }),
    ).verdict,
    "allow",
  );
  assertContextDenied(
    makeContext("one", { bindings: [makeBinding("one", { id: "a".repeat(65) })] }),
    "invalid_binding",
  );
});

test("allows one valid project in a Registry", () => {
  const decision = evaluateWorkspaceProjectContexts(makeRegistry());
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.normalizedRegistry?.projects.length, 1);
});

test("allows three active projects simultaneously", () => {
  const decision = evaluateWorkspaceProjectContexts(makeRegistry(["one", "two", "three"]));
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.normalizedRegistry?.projects.map((project) => project.projectId), ["project-one", "project-three", "project-two"]);
});

test("enforces exact Registry project limits", () => {
  const suffixes = Array.from({ length: projectContextLimits.maxProjects }, (_, index) => `p${index}`);
  assert.equal(evaluateWorkspaceProjectContexts(makeRegistry(suffixes)).verdict, "allow");
  assertRegistryDenied(makeRegistry([...suffixes, "overflow"]), "limit_exceeded");
  assertRegistryDenied(makeRegistry([]), "limit_exceeded");
});

test("requires ordinary Registry project arrays and rejects unknown fields", () => {
  assertRegistryDenied({ workspaceId: "workspace-primary", projects: new Set([makeContext()]) }, "invalid_input");
  assertRegistryDenied({ ...makeRegistry(), selectedProjectId: "project-one" }, "invalid_input");
});

test("Registry hostile envelopes, getters, proxies, and inherited fields fail closed", () => {
  for (const input of [null, true, [], new Set()]) {
    assertRegistryDenied(input, "invalid_input");
  }
  const getter = Object.defineProperty({}, "workspaceId", {
    enumerable: true,
    get() {
      throw new Error("hostile getter");
    },
  });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("hostile proxy"); } });
  const inherited = Object.create(makeRegistry()) as Record<string, unknown>;
  assertRegistryDenied(getter, "invalid_input");
  assertRegistryDenied(proxy, "invalid_input");
  assertRegistryDenied(inherited, "invalid_input");
});

test("rejects duplicate Project IDs", () => {
  assertRegistryDenied({ workspaceId: "workspace-primary", projects: [makeContext("one"), makeContext("one")] }, "duplicate_project_id");
});

test("rejects Project workspace mismatch", () => {
  const context = makeContext("one", { projectManifest: makeProject("one", { workspaceId: "workspace-other" }) });
  assertRegistryDenied({ workspaceId: "workspace-primary", projects: [context] }, "workspace_id_mismatch");
});

test("rejects duplicate binding IDs across projects", () => {
  const second = makeContext("two", { bindings: [makeBinding("two", { id: "binding-one" })] });
  assertRegistryDenied({ workspaceId: "workspace-primary", projects: [makeContext("one"), second] }, "duplicate_binding_id");
});

test("rejects duplicate Department IDs across projects", () => {
  const secondDepartment = makeDepartment("two", { id: "department-one" });
  const secondBinding = makeBinding("two", { departmentId: "department-one" });
  const second = makeContext("two", { departmentManifests: [secondDepartment], bindings: [secondBinding] });
  assertRegistryDenied({ workspaceId: "workspace-primary", projects: [makeContext("one"), second] }, "duplicate_department_id");
});

test("allows shared Model Profile IDs across projects", () => {
  assert.equal(evaluateWorkspaceProjectContexts(makeRegistry(["one", "two"])).verdict, "allow");
});

test("rejects cross-project resource identity collision", () => {
  const projectTwo = makeProject("two");
  const resource = projectTwo.resources[0] as Record<string, unknown>;
  const colliding = makeProject("two", { resources: [{ ...resource, resourceRef: " owner/repository-one " }] });
  const second = makeContext("two", { projectManifest: colliding });
  const decision = assertRegistryDenied({ workspaceId: "workspace-primary", projects: [makeContext("one"), second] }, "cross_project_resource_collision");
  assert.match(decision.reasons[0]?.message ?? "", /project-one/u);
  assert.match(decision.reasons[0]?.message ?? "", /repository-two/u);
});

test("resource collision deny is canonical across forward and reverse project order", () => {
  const projectTwo = makeProject("two");
  const resource = projectTwo.resources[0] as Record<string, unknown>;
  const second = makeContext("two", {
    projectManifest: makeProject("two", {
      resources: [{ ...resource, resourceRef: "owner/repository-one" }],
    }),
  });
  const projectOne = makeContext("one");
  const forward = {
    workspaceId: "workspace-primary",
    projects: [projectOne, second],
  };
  const reverse = {
    workspaceId: "workspace-primary",
    projects: [second, projectOne],
  };
  const forwardBefore = structuredClone(forward);
  const reverseBefore = structuredClone(reverse);
  const forwardDecision = evaluateWorkspaceProjectContexts(forward);
  const reverseDecision = evaluateWorkspaceProjectContexts(reverse);
  assert.equal(forwardDecision.verdict, "deny");
  assert.equal(reverseDecision.verdict, "deny");
  assert.equal(forwardDecision.normalizedRegistry, null);
  assert.equal(reverseDecision.normalizedRegistry, null);
  assert.deepEqual(forwardDecision, reverseDecision);
  assert.deepEqual(forward, forwardBefore);
  assert.deepEqual(reverse, reverseBefore);
});

test("allows equal resourceRef values with different resource kinds", () => {
  const projectTwo = makeProject("two");
  const resource = projectTwo.resources[0] as Record<string, unknown>;
  const distinct = makeProject("two", { resources: [{ ...resource, kind: "file_storage", resourceRef: "owner/repository-one" }] });
  assert.equal(evaluateWorkspaceProjectContexts({ workspaceId: "workspace-primary", projects: [makeContext("one"), makeContext("two", { projectManifest: distinct })] }).verdict, "allow");
});

test("rejects cross-project Knowledge Collection collision", () => {
  const projectTwo = makeProject("two", { knowledgeCollectionIds: ["knowledge-one"] });
  const departmentTwo = makeDepartment("two", { knowledgeCollectionIds: ["knowledge-one"] });
  const bindingTwo = makeBinding("two", { requestedKnowledgeCollectionIds: ["knowledge-one"] });
  const second = makeContext("two", { projectManifest: projectTwo, departmentManifests: [departmentTwo], bindings: [bindingTwo] });
  assertRegistryDenied({ workspaceId: "workspace-primary", projects: [makeContext("one"), second] }, "cross_project_knowledge_collision");
});

test("Knowledge collision deny is canonical across forward and reverse project order", () => {
  const second = makeContext("two", {
    projectManifest: makeProject("two", {
      knowledgeCollectionIds: ["knowledge-one"],
    }),
    departmentManifests: [
      makeDepartment("two", { knowledgeCollectionIds: ["knowledge-one"] }),
    ],
    bindings: [
      makeBinding("two", {
        requestedKnowledgeCollectionIds: ["knowledge-one"],
      }),
    ],
  });
  const projectOne = makeContext("one");
  const forward = {
    workspaceId: "workspace-primary",
    projects: [projectOne, second],
  };
  const reverse = {
    workspaceId: "workspace-primary",
    projects: [second, projectOne],
  };
  const forwardBefore = structuredClone(forward);
  const reverseBefore = structuredClone(reverse);
  const forwardDecision = evaluateWorkspaceProjectContexts(forward);
  const reverseDecision = evaluateWorkspaceProjectContexts(reverse);
  assert.equal(forwardDecision.verdict, "deny");
  assert.equal(reverseDecision.verdict, "deny");
  assert.equal(forwardDecision.normalizedRegistry, null);
  assert.equal(reverseDecision.normalizedRegistry, null);
  assert.deepEqual(forwardDecision, reverseDecision);
  assert.deepEqual(forward, forwardBefore);
  assert.deepEqual(reverse, reverseBefore);
});

test("repeated canonical collision evaluation returns a deep-equal decision", () => {
  const projectTwo = makeProject("two");
  const resource = projectTwo.resources[0] as Record<string, unknown>;
  const registry = {
    workspaceId: "workspace-primary",
    projects: [
      makeContext("one"),
      makeContext("two", {
        projectManifest: makeProject("two", {
          resources: [{ ...resource, resourceRef: "owner/repository-one" }],
        }),
      }),
    ],
  };
  const before = structuredClone(registry);
  const first = evaluateWorkspaceProjectContexts(registry);
  const second = evaluateWorkspaceProjectContexts(registry);
  assert.deepEqual(first, second);
  assert.equal(first.normalizedRegistry, null);
  assert.deepEqual(registry, before);
});

test("one invalid Project Context denies the whole Registry without partial output", () => {
  const invalid = makeContext("two", { projectManifest: makeProject("two", { status: "paused" }) });
  assertRegistryDenied({ workspaceId: "workspace-primary", projects: [makeContext("one"), invalid] }, "project_not_active");
});

test("Registry evaluation is reverse-order deterministic, fresh, and input-immutable", () => {
  const input = makeRegistry(["one", "two", "three"]);
  const before = structuredClone(input);
  const first = evaluateWorkspaceProjectContexts(input);
  const repeated = evaluateWorkspaceProjectContexts(input);
  const reversed = evaluateWorkspaceProjectContexts({ ...input, projects: [...input.projects].reverse() });
  assert.deepEqual(first, repeated);
  assert.deepEqual(first, reversed);
  assert.deepEqual(input, before);
  assert.notStrictEqual(first.normalizedRegistry, repeated.normalizedRegistry);
});

test("resolves an active Agent by exact projectId and bindingId", () => {
  const decision = resolveProjectExecutionContext({ registry: makeRegistry(), projectId: "project-one", bindingId: "binding-one" });
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.snapshot?.subjectId, "agent-one");
});

test("resolves an active enabled Workflow", () => {
  const registry = makeRegistry();
  registry.projects[0] = makeContext("one", { bindings: [makeBinding("one", { kind: "workflow", subjectId: "workflow-one" })] });
  const decision = resolveProjectExecutionContext({ registry, projectId: "project-one", bindingId: "binding-one" });
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.snapshot?.bindingKind, "workflow");
});

test("resolution revalidates and denies an invalid raw Registry", () => {
  const registry = makeRegistry();
  registry.projects[0].projectManifest.status = "paused";
  assertResolutionDenied({ registry, projectId: "project-one", bindingId: "binding-one" }, "project_not_active");
});

test("resolution rejects missing project with no fallback", () => {
  assertResolutionDenied({ registry: makeRegistry(), projectId: "project-missing", bindingId: "binding-one" }, "project_not_found");
});

test("resolution rejects binding from another project as mismatch", () => {
  assertResolutionDenied({ registry: makeRegistry(["one", "two"]), projectId: "project-one", bindingId: "binding-two" }, "binding_project_mismatch");
});

test("resolution rejects an absent binding", () => {
  assertResolutionDenied({ registry: makeRegistry(), projectId: "project-one", bindingId: "binding-missing" }, "binding_not_found");
});

for (const status of ["draft", "paused", "disabled"] as const) {
  test(`resolution rejects ${status} binding`, () => {
    const registry = makeRegistry();
    registry.projects[0] = makeContext("one", { bindings: [makeBinding("one", { status })] });
    assertResolutionDenied({ registry, projectId: "project-one", bindingId: "binding-one" }, "binding_not_active");
  });
}

test("resolution rejects selectedProjectId and other UI state", () => {
  assertResolutionDenied({ registry: makeRegistry(), projectId: "project-one", bindingId: "binding-one", selectedProjectId: "project-one" }, "invalid_input");
});

test("snapshot contains exact identities and versions", () => {
  const decision = resolveProjectExecutionContext({ registry: makeRegistry(), projectId: "project-one", bindingId: "binding-one" });
  assert.equal(decision.snapshot?.workspaceId, "workspace-primary");
  assert.equal(decision.snapshot?.projectManifestVersion, 3);
  assert.equal(decision.snapshot?.departmentManifestVersion, 5);
  assert.equal(decision.snapshot?.bindingVersion, 7);
  assert.equal(decision.snapshot?.departmentCode, "development");
});

test("snapshot omits raw manifests, resourceRef, connectionId, and credentials", () => {
  const decision = resolveProjectExecutionContext({ registry: makeRegistry(), projectId: "project-one", bindingId: "binding-one" });
  const serialized = JSON.stringify(decision.snapshot);
  assert.doesNotMatch(serialized, /resourceRef|connectionId/iu);
  assert.equal(Object.hasOwn(decision.snapshot ?? {}, "projectManifest"), false);
  assert.equal(Object.hasOwn(decision.snapshot ?? {}, "departmentManifest"), false);
  assert.equal(Object.hasOwn(decision.snapshot ?? {}, "credentials"), false);
  assert.deepEqual(Object.keys(decision.snapshot?.resources[0] ?? {}).sort(), ["capabilities", "resourceId"]);
});

test("snapshot is deeply frozen and each resolution returns fresh data", () => {
  const input = { registry: makeRegistry(), projectId: "project-one", bindingId: "binding-one" };
  const first = resolveProjectExecutionContext(input);
  const second = resolveProjectExecutionContext(input);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first.snapshot, second.snapshot);
  assert.equal(Object.isFrozen(first.snapshot), true);
  assert.equal(Object.isFrozen(first.snapshot?.resources), true);
  assert.equal(Object.isFrozen(first.snapshot?.resources[0]), true);
  assert.equal(Object.isFrozen(first.snapshot?.resources[0]?.capabilities), true);
  assert.equal(Object.isFrozen(first.snapshot?.budget), true);
});

test("resolving Project B cannot mutate an earlier Project A snapshot", () => {
  const registry = makeRegistry(["one", "two"]);
  const first = resolveProjectExecutionContext({ registry, projectId: "project-one", bindingId: "binding-one" });
  const before = structuredClone(first.snapshot);
  const second = resolveProjectExecutionContext({ registry, projectId: "project-two", bindingId: "binding-two" });
  assert.equal(second.verdict, "allow");
  assert.deepEqual(first.snapshot, before);
  assert.equal(first.snapshot?.projectId, "project-one");
  assert.equal(second.snapshot?.projectId, "project-two");
});

test("resolution functions fail closed for throwing getters and proxies", () => {
  const getter = Object.defineProperty({}, "registry", { enumerable: true, get() { throw new Error("getter"); } });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("proxy"); } });
  assertResolutionDenied(getter, "invalid_input");
  assertResolutionDenied(proxy, "invalid_input");
});
