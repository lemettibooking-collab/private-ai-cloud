import assert from "node:assert/strict";
import test from "node:test";

const projectContract = (await import(
  new URL("../lib/contracts/project-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/project-manifest");

const departmentContract = (await import(
  new URL("../lib/contracts/department-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/department-manifest");

const {
  evaluateProjectChildScope,
  projectManifestLimits,
  projectResourceCapabilities,
  systemForbiddenProjectActions,
  systemRequiredProjectApprovalActions,
  validateAndNormalizeProjectManifest,
} = projectContract;

const {
  aiDepartmentCodes,
  departmentChildScopeKinds,
  departmentManifestLimits,
  departmentManifestStatuses,
  departmentOperatingModes,
  departmentScopeVerdicts,
  evaluateDepartmentChildScope,
  evaluateDepartmentManifest,
  isAiDepartmentCode,
  isDepartmentChildScopeKind,
  isDepartmentManifestStatus,
  isDepartmentOperatingMode,
  isDepartmentScopeVerdict,
  parseAiDepartmentCode,
  parseDepartmentChildScopeKind,
  parseDepartmentManifestStatus,
  parseDepartmentOperatingMode,
  parseDepartmentScopeVerdict,
  validateAndNormalizeDepartmentManifest,
} = departmentContract;

function makeProjectBudget(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    maxConcurrentRuns: 4,
    maxAttemptsPerRun: 2,
    maxRunMinutes: 120,
    dailyTokenBudget: 1_000_000,
    monthlyCostBudgetUsdCents: 250_000,
    ...overrides,
  };
}

function makeProject(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "project-primary",
    workspaceId: "workspace-primary",
    version: 1,
    name: "Private AI Cloud",
    slug: "private-ai-cloud",
    summary: "Owner-controlled AI operations.",
    kind: "internal_product",
    status: "active",
    defaultLocale: "ru-RU",
    timeZone: "Europe/Moscow",
    dataRegion: "eu",
    dataClassification: "confidential",
    goals: ["Ship safely"],
    nonGoals: ["Autonomous production changes"],
    tags: ["private-ai"],
    resources: [
      {
        id: "repository",
        kind: "code_repository",
        label: "Repository",
        status: "connected",
        connectionId: "github-primary",
        resourceRef: "owner/repository",
        capabilities: ["read_metadata", "read_content", "propose_change"],
      },
      {
        id: "channel",
        kind: "telegram_channel",
        label: "Channel",
        status: "configured",
        connectionId: null,
        resourceRef: "@project_channel",
        capabilities: [
          "read_metadata",
          "read_content",
          "create_draft",
          "request_external_action",
        ],
      },
      {
        id: "disabled-resource",
        kind: "file_storage",
        label: "Disabled storage",
        status: "disabled",
        connectionId: null,
        resourceRef: "storage/disabled",
        capabilities: ["read_metadata"],
      },
    ],
    allowedModelProfileIds: [
      "model-codex-openai",
      "model-claude-code-anthropic",
      "model-qwen-reviewer",
      "model-deepseek-research",
    ],
    knowledgeCollectionIds: ["kb-product", "kb-policy", "kb-extra"],
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode: "redacted_only",
      requiredApprovalActions: ["project-owner-review"],
      forbiddenActions: ["Project production changes are forbidden"],
    },
    budget: makeProjectBudget(),
    ...overrides,
  };
}

function makeDepartmentBudget(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    maxConcurrentRuns: 2,
    maxAttemptsPerRun: 1,
    maxRunMinutes: 60,
    dailyTokenBudget: 500_000,
    monthlyCostBudgetUsdCents: 100_000,
    ...overrides,
  };
}

function makeDepartment(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "department-development",
    projectId: "project-primary",
    version: 1,
    code: "development",
    name: "Development",
    summary: "Build reviewed changes without autonomous publication.",
    status: "active",
    operatingMode: "approval_gated",
    goals: ["Deliver reviewed patches"],
    nonGoals: ["Deploy automatically"],
    resourceGrants: [
      {
        resourceId: "repository",
        capabilities: ["read_metadata", "propose_change"],
      },
    ],
    allowedModelProfileIds: [
      "model-codex-openai",
      "model-claude-code-anthropic",
    ],
    knowledgeCollectionIds: ["kb-product", "kb-policy"],
    enabledWorkflowIds: ["workflow-development"],
    operatorRoleIds: ["role-owner", "role-developer"],
    modelRouting: {
      primaryModelProfileId: "model-codex-openai",
      fallbackModelProfileIds: ["model-claude-code-anthropic"],
      reviewerModelProfileId: "model-claude-code-anthropic",
      independentReviewRequired: true,
    },
    policy: {
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
      additionalRequiredApprovalActions: ["department-owner-review"],
      additionalForbiddenActions: ["Department publication is forbidden"],
    },
    budget: makeDepartmentBudget(),
    ...overrides,
  };
}

function makeChild(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    projectManifest: makeProject(),
    departmentManifest: makeDepartment(),
    scopeKind: "agent",
    scopeId: "agent-development-primary",
    requestedResources: [
      { resourceId: "repository", capabilities: ["read_metadata"] },
    ],
    requestedModelProfileIds: ["model-codex-openai"],
    requestedKnowledgeCollectionIds: ["kb-product"],
    requestedBudget: {
      maxConcurrentRuns: 1,
      maxAttemptsPerRun: 1,
      maxRunMinutes: 30,
      dailyTokenBudget: 250_000,
      monthlyCostBudgetUsdCents: 50_000,
    },
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    additionalRequiredApprovalActions: [],
    additionalForbiddenActions: [],
    ...overrides,
  };
}

function makePolicyAdditions(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index}`);
}

function requireValidProject(input: unknown) {
  const result = validateAndNormalizeProjectManifest(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected valid ProjectManifest");
  return result.value;
}

function requireValidDepartment(input: unknown) {
  const result = validateAndNormalizeDepartmentManifest(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected valid DepartmentManifest");
  return result.value;
}

function validationErrors(input: unknown) {
  const result = validateAndNormalizeDepartmentManifest(input);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.errors;
}

function validationCodes(input: unknown): string[] {
  return validationErrors(input).map((error) => error.code);
}

function assertDepartmentDenied(input: unknown, code: string) {
  const decision = evaluateDepartmentManifest(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedDepartment, null);
  assert.ok(
    decision.reasons.some((reason) => reason.code === code),
    `Expected ${code}: ${JSON.stringify(decision)}`,
  );
  return decision;
}

function assertChildDenied(input: unknown, code: string) {
  const decision = evaluateDepartmentChildScope(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedScope, null);
  assert.ok(
    decision.reasons.some((reason) => reason.code === code),
    `Expected ${code}: ${JSON.stringify(decision)}`,
  );
  return decision;
}

test("exports canonical department codes and enums in exact order", () => {
  assert.deepEqual(aiDepartmentCodes, [
    "support",
    "marketing",
    "community",
    "sales",
    "customer-success",
    "product",
    "development",
    "qa-code-review",
    "executive-analytics",
    "legal-documents",
  ]);
  assert.deepEqual(departmentManifestStatuses, ["draft", "active", "paused", "disabled"]);
  assert.deepEqual(departmentOperatingModes, ["draft_only", "assisted", "approval_gated"]);
  assert.deepEqual(departmentChildScopeKinds, ["agent", "workflow"]);
  assert.deepEqual(departmentScopeVerdicts, ["allow", "deny"]);
  for (const value of [
    aiDepartmentCodes,
    departmentManifestStatuses,
    departmentOperatingModes,
    departmentChildScopeKinds,
    departmentScopeVerdicts,
    departmentManifestLimits,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test("guards and parsers accept canonical values and reject unknown values", () => {
  for (const code of aiDepartmentCodes) {
    assert.equal(isAiDepartmentCode(code), true);
    assert.equal(parseAiDepartmentCode(code), code);
  }
  for (const status of departmentManifestStatuses) {
    assert.equal(isDepartmentManifestStatus(status), true);
    assert.equal(parseDepartmentManifestStatus(status), status);
  }
  for (const mode of departmentOperatingModes) {
    assert.equal(isDepartmentOperatingMode(mode), true);
    assert.equal(parseDepartmentOperatingMode(mode), mode);
  }
  for (const kind of departmentChildScopeKinds) {
    assert.equal(isDepartmentChildScopeKind(kind), true);
    assert.equal(parseDepartmentChildScopeKind(kind), kind);
  }
  for (const verdict of departmentScopeVerdicts) {
    assert.equal(isDepartmentScopeVerdict(verdict), true);
    assert.equal(parseDepartmentScopeVerdict(verdict), verdict);
  }
  for (const invalid of ["autonomous", "department", "archived", "ALLOW", null, 1, {}]) {
    assert.equal(isAiDepartmentCode(invalid), false);
    assert.equal(isDepartmentManifestStatus(invalid), false);
    assert.equal(isDepartmentOperatingMode(invalid), false);
    assert.equal(isDepartmentChildScopeKind(invalid), false);
    assert.equal(isDepartmentScopeVerdict(invalid), false);
    assert.equal(parseAiDepartmentCode(invalid), null);
    assert.equal(parseDepartmentManifestStatus(invalid), null);
    assert.equal(parseDepartmentOperatingMode(invalid), null);
    assert.equal(parseDepartmentChildScopeKind(invalid), null);
    assert.equal(parseDepartmentScopeVerdict(invalid), null);
  }
});

test("exports the exact immutable DepartmentManifest limits", () => {
  assert.deepEqual(departmentManifestLimits, {
    maxIdLength: 64,
    maxNameLength: 160,
    maxSummaryLength: 4096,
    maxGoals: 32,
    maxNonGoals: 32,
    maxResourceGrants: 64,
    maxModelProfileIds: 32,
    maxFallbackModelProfileIds: 8,
    maxKnowledgeCollectionIds: 64,
    maxWorkflowIds: 64,
    maxOperatorRoleIds: 32,
    maxAdditionalApprovalActions: 64,
    maxAdditionalForbiddenActions: 64,
    maxTextListItemLength: 1024,
    maxErrors: 256,
  });
});

test("validates a manifest for every canonical department code", () => {
  for (const code of aiDepartmentCodes) {
    const result = validateAndNormalizeDepartmentManifest(
      makeDepartment({ id: `department-${code}`, code, name: code }),
    );
    assert.equal(result.ok, true, `${code}: ${JSON.stringify(result)}`);
  }
});

test("rejects primitives, null, and arrays without throwing", () => {
  for (const input of [null, undefined, true, 1, "department", [], Symbol("department")]) {
    assert.doesNotThrow(() => validateAndNormalizeDepartmentManifest(input));
    assert.deepEqual(validationCodes(input), ["invalid_input"]);
  }
});

test("rejects unknown fields at every manifest nesting level", () => {
  assert.ok(validationCodes({ ...makeDepartment(), unknown: true }).includes("unknown_field"));
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      resourceGrants: [
        { resourceId: "repository", capabilities: ["read_metadata"], unknown: true },
      ],
    }).includes("unknown_field"),
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      modelRouting: { ...makeDepartment().modelRouting, unknown: true },
    }).includes("unknown_field"),
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      policy: { ...makeDepartment().policy, unknown: true },
    }).includes("unknown_field"),
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      budget: { ...makeDepartmentBudget(), unknown: 1 },
    }).includes("unknown_field"),
  );
});

test("requires own fields and ignores inherited values", () => {
  const inherited = Object.create(makeDepartment()) as Record<string, unknown>;
  const errors = validationErrors(inherited);
  assert.ok(errors.some((error) => error.code === "required_field" && error.path === "id"));
});

test("rejects every missing required own field", () => {
  for (const field of [
    "id",
    "projectId",
    "version",
    "code",
    "name",
    "summary",
    "status",
    "operatingMode",
    "goals",
    "nonGoals",
    "resourceGrants",
    "allowedModelProfileIds",
    "knowledgeCollectionIds",
    "enabledWorkflowIds",
    "operatorRoleIds",
    "modelRouting",
    "policy",
    "budget",
  ]) {
    const input = { ...makeDepartment() } as Record<string, unknown>;
    delete input[field];
    assert.ok(
      validationErrors(input).some(
        (error) => error.code === "required_field" && error.path === field,
      ),
      field,
    );
  }
});

test("rejects malformed nested values and Set collection substitutes", () => {
  for (const [field, value] of [
    ["resourceGrants", new Set()],
    ["allowedModelProfileIds", new Set(["model-codex-openai"])],
    ["knowledgeCollectionIds", new Set()],
    ["enabledWorkflowIds", new Set()],
    ["operatorRoleIds", new Set()],
    ["goals", new Set()],
    ["nonGoals", new Set()],
  ] as const) {
    assert.ok(validationCodes({ ...makeDepartment(), [field]: value }).includes("invalid_type"));
  }
  assert.ok(validationCodes({ ...makeDepartment(), modelRouting: [] }).includes("invalid_type"));
  assert.ok(validationCodes({ ...makeDepartment(), policy: "locked" }).includes("invalid_type"));
  assert.ok(validationCodes({ ...makeDepartment(), budget: [] }).includes("invalid_type"));
});

test("throwing getters and proxies fail closed deterministically", () => {
  const getter = { ...makeDepartment() };
  Object.defineProperty(getter, "name", {
    enumerable: true,
    get() {
      throw new Error("blocked getter");
    },
  });
  const proxy = new Proxy(makeDepartment(), {
    ownKeys() {
      throw new Error("blocked proxy");
    },
  });
  for (const input of [getter, proxy]) {
    const first = validateAndNormalizeDepartmentManifest(input);
    const second = validateAndNormalizeDepartmentManifest(input);
    assert.deepEqual(first, second);
    assert.deepEqual(first, {
      ok: false,
      errors: [
        {
          code: "invalid_input",
          path: "$",
          message: "DepartmentManifest input could not be safely inspected.",
        },
      ],
    });
  }
});

test("rejects invalid IDs, versions, enums, and non-boolean review flags", () => {
  for (const field of ["id", "projectId"] as const) {
    assert.ok(validationCodes({ ...makeDepartment(), [field]: "../unsafe" }).includes("invalid_id"));
  }
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.ok(validationCodes({ ...makeDepartment(), version }).includes("invalid_integer"));
  }
  assert.ok(validationCodes({ ...makeDepartment(), code: "unknown" }).includes("invalid_enum"));
  assert.ok(validationCodes({ ...makeDepartment(), status: "archived" }).includes("invalid_enum"));
  assert.ok(validationCodes({ ...makeDepartment(), operatingMode: "autonomous" }).includes("invalid_enum"));
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      modelRouting: { ...makeDepartment().modelRouting, independentReviewRequired: "true" },
    }).includes("invalid_type"),
  );
});

test("normalizes CRLF, trims strings, and stable-deduplicates collections", () => {
  const input = makeDepartment({
    name: "  Development  ",
    summary: " First\r\nSecond\rThird ",
    goals: [" Ship\r\nsafely ", "Ship\n safely", "", "Review"],
    allowedModelProfileIds: [
      " model-codex-openai ",
      "model-claude-code-anthropic",
      "model-codex-openai",
    ],
    modelRouting: {
      ...makeDepartment().modelRouting,
      fallbackModelProfileIds: [
        "model-claude-code-anthropic",
        "model-claude-code-anthropic",
      ],
    },
  });
  const value = requireValidDepartment(input);
  assert.equal(value.name, "Development");
  assert.equal(value.summary, "First\nSecond\nThird");
  assert.deepEqual(value.goals, ["Ship\nsafely", "Ship\n safely", "Review"]);
  assert.deepEqual(value.allowedModelProfileIds, [
    "model-codex-openai",
    "model-claude-code-anthropic",
  ]);
  assert.deepEqual(value.modelRouting.fallbackModelProfileIds, [
    "model-claude-code-anthropic",
  ]);
});

test("validation returns deeply fresh data without mutating input", () => {
  const input = makeDepartment();
  const before = structuredClone(input);
  const first = requireValidDepartment(input);
  const second = requireValidDepartment(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.resourceGrants, second.resourceGrants);
  assert.notEqual(first.resourceGrants[0].capabilities, second.resourceGrants[0].capabilities);
  assert.notEqual(first.modelRouting, second.modelRouting);
  assert.notEqual(first.policy, second.policy);
  assert.notEqual(first.budget, second.budget);
});

test("rejects duplicate resource grants and empty capabilities", () => {
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      resourceGrants: [
        { resourceId: "repository", capabilities: ["read_metadata"] },
        { resourceId: "repository", capabilities: ["propose_change"] },
      ],
    }).includes("duplicate_resource_id"),
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      resourceGrants: [{ resourceId: "repository", capabilities: [] }],
    }).includes("empty_capabilities"),
  );
});

test("accepts the exact capability boundary and rejects one extra item", () => {
  assert.equal(
    validateAndNormalizeDepartmentManifest({
      ...makeDepartment(),
      resourceGrants: [
        { resourceId: "repository", capabilities: [...projectResourceCapabilities] },
      ],
    }).ok,
    true,
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      resourceGrants: [
        {
          resourceId: "repository",
          capabilities: [...projectResourceCapabilities, "read_metadata"],
        },
      ],
    }).includes("limit_exceeded"),
  );
});

test("accepts exact ID and scalar text limits and rejects limit plus one", () => {
  assert.equal(
    validateAndNormalizeDepartmentManifest({
      ...makeDepartment(),
      id: `d${"a".repeat(63)}`,
      name: "n".repeat(departmentManifestLimits.maxNameLength),
      summary: "s".repeat(departmentManifestLimits.maxSummaryLength),
    }).ok,
    true,
  );
  assert.ok(validationCodes({ ...makeDepartment(), id: `d${"a".repeat(64)}` }).includes("invalid_id"));
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      name: "n".repeat(departmentManifestLimits.maxNameLength + 1),
    }).includes("limit_exceeded"),
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      summary: "s".repeat(departmentManifestLimits.maxSummaryLength + 1),
    }).includes("limit_exceeded"),
  );
});

test("enforces every top-level collection boundary", () => {
  const cases = [
    ["goals", departmentManifestLimits.maxGoals, (index: number) => `Goal ${index}`],
    ["nonGoals", departmentManifestLimits.maxNonGoals, (index: number) => `Non-goal ${index}`],
    ["knowledgeCollectionIds", departmentManifestLimits.maxKnowledgeCollectionIds, (index: number) => `kb-${index}`],
    ["enabledWorkflowIds", departmentManifestLimits.maxWorkflowIds, (index: number) => `workflow-${index}`],
    ["operatorRoleIds", departmentManifestLimits.maxOperatorRoleIds, (index: number) => `role-${index}`],
  ] as const;
  for (const [field, limit, createItem] of cases) {
    const boundary = Array.from({ length: limit }, (_, index) => createItem(index));
    assert.equal(validateAndNormalizeDepartmentManifest({ ...makeDepartment(), [field]: boundary }).ok, true, field);
    assert.ok(
      validationCodes({ ...makeDepartment(), [field]: [...boundary, createItem(limit)] }).includes(
        "limit_exceeded",
      ),
      field,
    );
  }
});

test("enforces resource, model, fallback, approval, and forbidden boundaries", () => {
  const resourceBoundary = Array.from(
    { length: departmentManifestLimits.maxResourceGrants },
    (_, index) => ({ resourceId: `resource-${index}`, capabilities: ["read_metadata"] }),
  );
  assert.equal(
    validateAndNormalizeDepartmentManifest({ ...makeDepartment(), resourceGrants: resourceBoundary }).ok,
    true,
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      resourceGrants: [
        ...resourceBoundary,
        { resourceId: "resource-over", capabilities: ["read_metadata"] },
      ],
    }).includes("limit_exceeded"),
  );

  const modelBoundary = [
    "model-codex-openai",
    "model-claude-code-anthropic",
    ...Array.from(
      { length: departmentManifestLimits.maxModelProfileIds - 2 },
      (_, index) => `model-${index}`,
    ),
  ];
  assert.equal(
    validateAndNormalizeDepartmentManifest({ ...makeDepartment(), allowedModelProfileIds: modelBoundary }).ok,
    true,
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      allowedModelProfileIds: [...modelBoundary, "model-over"],
    }).includes("limit_exceeded"),
  );

  const fallbackBoundary = Array.from(
    { length: departmentManifestLimits.maxFallbackModelProfileIds },
    (_, index) => `fallback-${index}`,
  );
  const fallbackAllowed = [
    "model-codex-openai",
    "model-claude-code-anthropic",
    ...fallbackBoundary,
  ];
  assert.equal(
    validateAndNormalizeDepartmentManifest({
      ...makeDepartment(),
      allowedModelProfileIds: fallbackAllowed,
      modelRouting: {
        ...makeDepartment().modelRouting,
        fallbackModelProfileIds: fallbackBoundary,
      },
    }).ok,
    true,
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      allowedModelProfileIds: [...fallbackAllowed, "fallback-over"],
      modelRouting: {
        ...makeDepartment().modelRouting,
        fallbackModelProfileIds: [...fallbackBoundary, "fallback-over"],
      },
    }).includes("limit_exceeded"),
  );

  for (const [field, limit] of [
    ["additionalRequiredApprovalActions", departmentManifestLimits.maxAdditionalApprovalActions],
    ["additionalForbiddenActions", departmentManifestLimits.maxAdditionalForbiddenActions],
  ] as const) {
    const boundary = Array.from({ length: limit }, (_, index) => `${field} ${index}`);
    assert.equal(
      validateAndNormalizeDepartmentManifest({
        ...makeDepartment(),
        policy: { ...makeDepartment().policy, [field]: boundary },
      }).ok,
      true,
    );
    assert.ok(
      validationCodes({
        ...makeDepartment(),
        policy: { ...makeDepartment().policy, [field]: [...boundary, `${field} over`] },
      }).includes("limit_exceeded"),
    );
  }
});

test("enforces text-list item and error-count boundaries", () => {
  assert.equal(
    validateAndNormalizeDepartmentManifest({
      ...makeDepartment(),
      goals: ["g".repeat(departmentManifestLimits.maxTextListItemLength)],
    }).ok,
    true,
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      goals: ["g".repeat(departmentManifestLimits.maxTextListItemLength + 1)],
    }).includes("limit_exceeded"),
  );
  const hostile = Object.fromEntries(
    Array.from({ length: departmentManifestLimits.maxErrors + 50 }, (_, index) => [
      `unknown-${index}`,
      true,
    ]),
  );
  assert.equal(validationErrors(hostile).length, departmentManifestLimits.maxErrors);
});

test("uses the real AI-013 budget validator for shape and absolute ranges", () => {
  assert.ok(
    validationCodes({ ...makeDepartment(), budget: { ...makeDepartmentBudget(), unknown: 1 } }).includes(
      "unknown_field",
    ),
  );
  for (const [field, value] of [
    ["maxConcurrentRuns", 17],
    ["maxAttemptsPerRun", 4],
    ["maxRunMinutes", 241],
    ["dailyTokenBudget", 1_000_000_001],
    ["monthlyCostBudgetUsdCents", 100_000_001],
  ] as const) {
    assert.ok(
      validationCodes({
        ...makeDepartment(),
        budget: { ...makeDepartmentBudget(), [field]: value },
      }).includes("invalid_integer"),
      field,
    );
  }
});

test("requires a primary model from the allowlist", () => {
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      modelRouting: { ...makeDepartment().modelRouting, primaryModelProfileId: "model-unknown" },
    }).includes("primary_model_not_allowed"),
  );
});

test("rejects fallback models outside the allowlist and primary duplication", () => {
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      modelRouting: { ...makeDepartment().modelRouting, fallbackModelProfileIds: ["model-unknown"] },
    }).includes("fallback_model_not_allowed"),
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      modelRouting: {
        ...makeDepartment().modelRouting,
        fallbackModelProfileIds: ["model-codex-openai"],
      },
    }).includes("primary_model_in_fallback"),
  );
});

test("rejects reviewer models outside the allowlist", () => {
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      modelRouting: { ...makeDepartment().modelRouting, reviewerModelProfileId: "model-unknown" },
    }).includes("reviewer_model_not_allowed"),
  );
});

test("independent review requires a distinct reviewer", () => {
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      modelRouting: { ...makeDepartment().modelRouting, reviewerModelProfileId: null },
    }).includes("reviewer_required"),
  );
  assert.ok(
    validationCodes({
      ...makeDepartment(),
      modelRouting: {
        ...makeDepartment().modelRouting,
        reviewerModelProfileId: "model-codex-openai",
      },
    }).includes("reviewer_matches_primary"),
  );
  assert.equal(validateAndNormalizeDepartmentManifest(makeDepartment()).ok, true);
});

test("reviewer may be absent when independent review is disabled", () => {
  assert.equal(
    validateAndNormalizeDepartmentManifest({
      ...makeDepartment(),
      modelRouting: {
        ...makeDepartment().modelRouting,
        reviewerModelProfileId: null,
        independentReviewRequired: false,
      },
    }).ok,
    true,
  );
});

test("allows a valid active DepartmentManifest through real project inheritance", () => {
  const decision = evaluateDepartmentManifest({
    projectManifest: makeProject(),
    departmentManifest: makeDepartment(),
  });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(decision.reasons, []);
  assert.ok(decision.normalizedDepartment);
  assert.equal(decision.projectDecision?.verdict, "allow");
  assert.deepEqual(decision.normalizedDepartment.effectiveModelProfileIds, [
    "model-codex-openai",
    "model-claude-code-anthropic",
  ]);
  assert.deepEqual(decision.normalizedDepartment.effectiveKnowledgeCollectionIds, [
    "kb-product",
    "kb-policy",
  ]);
});

test("denies projectId mismatch before project scope evaluation", () => {
  const decision = assertDepartmentDenied(
    {
      projectManifest: makeProject(),
      departmentManifest: makeDepartment({ projectId: "project-other" }),
    },
    "project_id_mismatch",
  );
  assert.equal(decision.projectDecision, null);
});

test("inactive ProjectManifest denies through the real AI-013 evaluator", () => {
  for (const status of ["draft", "paused", "archived"]) {
    const decision = assertDepartmentDenied(
      {
        projectManifest: makeProject({ status }),
        departmentManifest: makeDepartment(),
      },
      "project_not_active",
    );
    assert.equal(decision.projectDecision?.verdict, "deny");
  }
});

test("project inheritance denies unknown and unavailable resources", () => {
  assertDepartmentDenied(
    {
      projectManifest: makeProject(),
      departmentManifest: makeDepartment({
        resourceGrants: [{ resourceId: "unknown-resource", capabilities: ["read_metadata"] }],
      }),
    },
    "resource_not_found",
  );
  for (const status of ["disabled", "error"]) {
    const resources = makeProject().resources.map((resource) =>
      resource.id === "disabled-resource" ? { ...resource, status } : resource,
    );
    assertDepartmentDenied(
      {
        projectManifest: makeProject({ resources }),
        departmentManifest: makeDepartment({
          resourceGrants: [
            { resourceId: "disabled-resource", capabilities: ["read_metadata"] },
          ],
        }),
      },
      "resource_unavailable",
    );
  }
});

test("project inheritance denies capability, model, and Knowledge expansion", () => {
  assertDepartmentDenied(
    {
      projectManifest: makeProject(),
      departmentManifest: makeDepartment({
        resourceGrants: [
          { resourceId: "repository", capabilities: ["request_external_action"] },
        ],
      }),
    },
    "capability_not_allowed",
  );
  assertDepartmentDenied(
    {
      projectManifest: makeProject(),
      departmentManifest: makeDepartment({
        allowedModelProfileIds: [
          "model-codex-openai",
          "model-claude-code-anthropic",
          "model-outside-project",
        ],
        modelRouting: {
          ...makeDepartment().modelRouting,
          fallbackModelProfileIds: ["model-outside-project"],
        },
      }),
    },
    "model_profile_not_allowed",
  );
  assertDepartmentDenied(
    {
      projectManifest: makeProject(),
      departmentManifest: makeDepartment({
        knowledgeCollectionIds: ["kb-product", "kb-outside-project"],
      }),
    },
    "knowledge_collection_not_allowed",
  );
});

test("every Department budget field is bounded by ProjectManifest", () => {
  const cases = [
    ["maxConcurrentRuns", 5],
    ["maxAttemptsPerRun", 3],
    ["maxRunMinutes", 121],
    ["dailyTokenBudget", 1_000_001],
    ["monthlyCostBudgetUsdCents", 250_001],
  ] as const;
  for (const [field, value] of cases) {
    assertDepartmentDenied(
      {
        projectManifest: makeProject(),
        departmentManifest: makeDepartment({
          budget: makeDepartmentBudget({ [field]: value }),
        }),
      },
      "budget_ceiling_exceeded",
    );
  }
});

test("Department policy can strengthen but cannot relax project policy", () => {
  assert.equal(
    evaluateDepartmentManifest({
      projectManifest: makeProject(),
      departmentManifest: makeDepartment(),
    }).verdict,
    "allow",
  );
  assertDepartmentDenied(
    {
      projectManifest: makeProject({
        policy: { ...makeProject().policy, externalActionMode: "locked" },
      }),
      departmentManifest: makeDepartment({
        policy: { ...makeDepartment().policy, externalActionMode: "approval_required" },
      }),
    },
    "external_action_policy_relaxed",
  );
  assertDepartmentDenied(
    {
      projectManifest: makeProject({
        policy: { ...makeProject().policy, dataEgressMode: "forbidden" },
      }),
      departmentManifest: makeDepartment({
        policy: { ...makeDepartment().policy, dataEgressMode: "redacted_only" },
      }),
    },
    "data_egress_policy_relaxed",
  );
});

test("normalized Department preserves effective approvals and forbidden actions", () => {
  const decision = evaluateDepartmentManifest({
    projectManifest: makeProject(),
    departmentManifest: makeDepartment(),
  });
  assert.equal(decision.verdict, "allow");
  assert.ok(decision.normalizedDepartment);
  for (const approval of [
    ...systemRequiredProjectApprovalActions,
    "project-owner-review",
    "department-owner-review",
  ]) {
    assert.ok(decision.normalizedDepartment.effectiveRequiredApprovalActions.includes(approval));
  }
  for (const action of [
    ...systemForbiddenProjectActions,
    "Project production changes are forbidden",
    "Department publication is forbidden",
  ]) {
    assert.ok(decision.normalizedDepartment.effectiveForbiddenActions.includes(action));
  }
});

test("Department evaluation preserves the exact real AI-013 decision", () => {
  const project = requireValidProject(makeProject());
  const department = requireValidDepartment(makeDepartment());
  const expected = evaluateProjectChildScope({
    manifest: project,
    scopeKind: "department",
    scopeId: department.id,
    requestedResources: department.resourceGrants,
    requestedModelProfileIds: department.allowedModelProfileIds,
    requestedKnowledgeCollectionIds: department.knowledgeCollectionIds,
    requestedBudget: department.budget,
    externalActionMode: department.policy.externalActionMode,
    dataEgressMode: department.policy.dataEgressMode,
    requiredApprovalActions: [
      ...project.policy.requiredApprovalActions,
      ...department.policy.additionalRequiredApprovalActions,
    ],
    additionalForbiddenActions: department.policy.additionalForbiddenActions,
  });
  const actual = evaluateDepartmentManifest({
    projectManifest: project,
    departmentManifest: department,
  });
  assert.deepEqual(actual.projectDecision, expected);
  assert.equal(actual.verdict, expected.verdict);
  assert.deepEqual(actual.normalizedDepartment?.projectScope, expected.normalizedScope);
});

test("Department evaluation is deterministic and does not mutate either parent", () => {
  const project = makeProject();
  const department = makeDepartment();
  const projectBefore = structuredClone(project);
  const departmentBefore = structuredClone(department);
  const first = evaluateDepartmentManifest({ projectManifest: project, departmentManifest: department });
  const second = evaluateDepartmentManifest({ projectManifest: project, departmentManifest: department });
  assert.deepEqual(first, second);
  assert.deepEqual(project, projectBefore);
  assert.deepEqual(department, departmentBefore);
});

test("hostile Department evaluation input follows fail-closed precedence", () => {
  assertDepartmentDenied(null, "invalid_input");
  assertDepartmentDenied(
    { projectManifest: null, departmentManifest: null },
    "invalid_project_manifest",
  );
  assertDepartmentDenied(
    { projectManifest: makeProject(), departmentManifest: null },
    "invalid_department_manifest",
  );
  const throwing = new Proxy({}, { ownKeys: () => { throw new Error("blocked"); } });
  assert.doesNotThrow(() => evaluateDepartmentManifest(throwing));
  assertDepartmentDenied(throwing, "invalid_input");
});

test("allows valid agent and workflow child scopes", () => {
  const agent = evaluateDepartmentChildScope(makeChild());
  assert.equal(agent.verdict, "allow", JSON.stringify(agent));
  assert.ok(agent.normalizedScope);
  assert.equal(agent.normalizedScope.scopeKind, "agent");
  const workflow = evaluateDepartmentChildScope(
    makeChild({ scopeKind: "workflow", scopeId: "workflow-development" }),
  );
  assert.equal(workflow.verdict, "allow", JSON.stringify(workflow));
  assert.equal(workflow.normalizedScope?.scopeKind, "workflow");
});

test("workflow outside enabledWorkflowIds is denied before project evaluation", () => {
  const decision = assertChildDenied(
    makeChild({ scopeKind: "workflow", scopeId: "workflow-not-enabled" }),
    "workflow_not_enabled",
  );
  assert.equal(decision.scopeKind, "workflow");
  assert.equal(decision.scopeId, "workflow-not-enabled");
  assert.equal(decision.reasons[0]?.path, "scopeId");
  assert.ok(decision.departmentDecision);
  assert.equal(decision.projectDecision, null);
  assert.equal(decision.normalizedScope, null);
});

test("an empty enabledWorkflowIds list denies every workflow", () => {
  assertChildDenied(
    makeChild({
      departmentManifest: makeDepartment({ enabledWorkflowIds: [] }),
      scopeKind: "workflow",
      scopeId: "workflow-development",
    }),
    "workflow_not_enabled",
  );
});

test("workflow membership uses exact IDs without prefix matching", () => {
  assertChildDenied(
    makeChild({
      departmentManifest: makeDepartment({
        enabledWorkflowIds: ["workflow-development-preview"],
      }),
      scopeKind: "workflow",
      scopeId: "workflow-development",
    }),
    "workflow_not_enabled",
  );
});

test("agent scopes are not restricted by enabledWorkflowIds", () => {
  const decision = evaluateDepartmentChildScope(
    makeChild({ departmentManifest: makeDepartment({ enabledWorkflowIds: [] }) }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
});

test("additional approvals cannot bypass workflow_not_enabled", () => {
  const decision = assertChildDenied(
    makeChild({
      scopeKind: "workflow",
      scopeId: "workflow-not-enabled",
      additionalRequiredApprovalActions: ["owner-approved-workflow"],
    }),
    "workflow_not_enabled",
  );
  assert.equal(decision.projectDecision, null);
});

test("workflow allow and deny remain deterministic in reverse evaluation order", () => {
  const allowedInput = makeChild({
    scopeKind: "workflow",
    scopeId: "workflow-development",
  });
  const deniedInput = makeChild({
    scopeKind: "workflow",
    scopeId: "workflow-not-enabled",
  });
  const forward = [
    evaluateDepartmentChildScope(allowedInput),
    evaluateDepartmentChildScope(deniedInput),
  ];
  const reverse = [
    evaluateDepartmentChildScope(deniedInput),
    evaluateDepartmentChildScope(allowedInput),
  ];
  assert.deepEqual([reverse[1], reverse[0]], forward);
  assert.deepEqual(
    evaluateDepartmentChildScope(deniedInput),
    evaluateDepartmentChildScope(deniedInput),
  );
});

test("child evaluation preserves the exact real AI-013 project decision", () => {
  const input = makeChild();
  const project = requireValidProject(input.projectManifest);
  const department = requireValidDepartment(input.departmentManifest);
  const child = input;
  const expected = evaluateProjectChildScope({
    manifest: project,
    scopeKind: child.scopeKind,
    scopeId: child.scopeId,
    requestedResources: child.requestedResources,
    requestedModelProfileIds: child.requestedModelProfileIds,
    requestedKnowledgeCollectionIds: child.requestedKnowledgeCollectionIds,
    requestedBudget: child.requestedBudget,
    externalActionMode: child.externalActionMode,
    dataEgressMode: child.dataEgressMode,
    requiredApprovalActions: [
      ...project.policy.requiredApprovalActions,
      ...department.policy.additionalRequiredApprovalActions,
      ...child.additionalRequiredApprovalActions,
    ],
    additionalForbiddenActions: [
      ...department.policy.additionalForbiddenActions,
      ...child.additionalForbiddenActions,
    ],
  });
  const actual = evaluateDepartmentChildScope(input);
  assert.deepEqual(actual.projectDecision, expected);
  assert.equal(actual.verdict, expected.verdict);
  assert.deepEqual(actual.normalizedScope, expected.normalizedScope);
});

test("draft, paused, and disabled Departments deny child scopes", () => {
  for (const status of ["draft", "paused", "disabled"]) {
    assertChildDenied(
      makeChild({ departmentManifest: makeDepartment({ status }) }),
      "department_not_active",
    );
  }
});

test("child cannot use a project resource outside DepartmentManifest", () => {
  assertChildDenied(
    makeChild({
      requestedResources: [{ resourceId: "channel", capabilities: ["read_metadata"] }],
    }),
    "resource_not_found",
  );
});

test("child cannot expand a Department resource capability", () => {
  assertChildDenied(
    makeChild({
      requestedResources: [{ resourceId: "repository", capabilities: ["read_content"] }],
    }),
    "capability_not_allowed",
  );
});

test("child cannot use project models or Knowledge outside DepartmentManifest", () => {
  assertChildDenied(
    makeChild({ requestedModelProfileIds: ["model-qwen-reviewer"] }),
    "model_profile_not_allowed",
  );
  assertChildDenied(
    makeChild({ requestedKnowledgeCollectionIds: ["kb-extra"] }),
    "knowledge_collection_not_allowed",
  );
});

test("every child budget field is bounded by DepartmentManifest", () => {
  const cases = [
    ["maxConcurrentRuns", 3],
    ["maxAttemptsPerRun", 2],
    ["maxRunMinutes", 61],
    ["dailyTokenBudget", 500_001],
    ["monthlyCostBudgetUsdCents", 100_001],
  ] as const;
  for (const [field, value] of cases) {
    assertChildDenied(
      makeChild({ requestedBudget: { ...makeChild().requestedBudget, [field]: value } }),
      "budget_ceiling_exceeded",
    );
  }
});

test("child may strengthen policy but cannot relax Department policy", () => {
  const stricter = evaluateDepartmentChildScope(
    makeChild({
      departmentManifest: makeDepartment({
        policy: {
          ...makeDepartment().policy,
          externalActionMode: "approval_required",
          dataEgressMode: "redacted_only",
        },
      }),
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
    }),
  );
  assert.equal(stricter.verdict, "allow", JSON.stringify(stricter));
  assertChildDenied(
    makeChild({ externalActionMode: "approval_required" }),
    "external_action_policy_relaxed",
  );
  assertChildDenied(
    makeChild({ dataEgressMode: "redacted_only" }),
    "data_egress_policy_relaxed",
  );
});

test("empty child approval additions automatically inherit Department approvals", () => {
  const allowed = evaluateDepartmentChildScope(
    makeChild({ additionalRequiredApprovalActions: [] }),
  );
  assert.equal(allowed.verdict, "allow", JSON.stringify(allowed));
  assert.ok(
    allowed.normalizedScope?.requiredApprovalActions.includes("department-owner-review"),
  );
});

test("a child-specific approval is appended after inherited Department approvals", () => {
  const allowed = evaluateDepartmentChildScope(
    makeChild({
      additionalRequiredApprovalActions: ["z-child-sensitive-review"],
    }),
  );
  assert.equal(allowed.verdict, "allow", JSON.stringify(allowed));
  const approvals = allowed.normalizedScope?.requiredApprovalActions ?? [];
  assert.ok(approvals.indexOf("department-owner-review") >= 0);
  assert.ok(
    approvals.indexOf("z-child-sensitive-review") >
      approvals.indexOf("department-owner-review"),
  );
});

test("empty child forbidden additions automatically inherit Department actions", () => {
  const allowed = evaluateDepartmentChildScope(
    makeChild({ additionalForbiddenActions: [] }),
  );
  assert.equal(allowed.verdict, "allow", JSON.stringify(allowed));
  assert.ok(
    allowed.normalizedScope?.forbiddenActions.includes(
      "Department publication is forbidden",
    ),
  );
});

test("a child-specific forbidden action is appended after inherited values", () => {
  const allowed = evaluateDepartmentChildScope(
    makeChild({
      additionalForbiddenActions: ["Z child customer contact is forbidden"],
    }),
  );
  assert.equal(allowed.verdict, "allow", JSON.stringify(allowed));
  const forbidden = allowed.normalizedScope?.forbiddenActions ?? [];
  assert.ok(forbidden.indexOf("Department publication is forbidden") >= 0);
  assert.ok(
    forbidden.indexOf("Z child customer contact is forbidden") >
      forbidden.indexOf("Department publication is forbidden"),
  );
});

test("repeated Department restrictions in child input are stably deduplicated", () => {
  const decision = evaluateDepartmentChildScope(
    makeChild({
      additionalRequiredApprovalActions: ["department-owner-review"],
      additionalForbiddenActions: ["Department publication is forbidden"],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.equal(
    decision.normalizedScope?.requiredApprovalActions.filter(
      (approval) => approval === "department-owner-review",
    ).length,
    1,
  );
  assert.equal(
    decision.normalizedScope?.forbiddenActions.filter(
      (action) => action === "Department publication is forbidden",
    ).length,
    1,
  );
});

test("64 Department approval additions and no child additions are allowed", () => {
  const inherited = makePolicyAdditions(
    "Department approval",
    projectManifestLimits.maxChildAdditionalApprovalActions,
  );
  const decision = evaluateDepartmentChildScope(
    makeChild({
      departmentManifest: makeDepartment({
        policy: {
          ...makeDepartment().policy,
          additionalRequiredApprovalActions: inherited,
        },
      }),
      additionalRequiredApprovalActions: [],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.ok(inherited.every((approval) => decision.normalizedScope?.requiredApprovalActions.includes(approval)));
});

test("63 Department approval additions and one child addition are allowed", () => {
  const inherited = makePolicyAdditions(
    "Department approval",
    projectManifestLimits.maxChildAdditionalApprovalActions - 1,
  );
  const decision = evaluateDepartmentChildScope(
    makeChild({
      departmentManifest: makeDepartment({
        policy: {
          ...makeDepartment().policy,
          additionalRequiredApprovalActions: inherited,
        },
      }),
      additionalRequiredApprovalActions: ["Child approval"],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.ok(decision.normalizedScope?.requiredApprovalActions.includes("Child approval"));
});

test("64 Department approval additions plus one new child addition deny deterministically", () => {
  const inherited = makePolicyAdditions(
    "Department approval",
    projectManifestLimits.maxChildAdditionalApprovalActions,
  );
  const input = makeChild({
    departmentManifest: makeDepartment({
      policy: {
        ...makeDepartment().policy,
        additionalRequiredApprovalActions: inherited,
      },
    }),
    additionalRequiredApprovalActions: ["Child approval over capacity"],
  });
  const first = assertChildDenied(input, "inherited_policy_capacity_exceeded");
  const second = evaluateDepartmentChildScope(input);
  assert.deepEqual(first, second);
  assert.equal(first.reasons[0]?.path, "additionalRequiredApprovalActions");
  assert.equal(first.projectDecision, null);
});

test("64 Department forbidden additions and no child additions are allowed", () => {
  const inherited = makePolicyAdditions(
    "Department forbidden action",
    projectManifestLimits.maxUserForbiddenActions,
  );
  const decision = evaluateDepartmentChildScope(
    makeChild({
      departmentManifest: makeDepartment({
        policy: {
          ...makeDepartment().policy,
          additionalForbiddenActions: inherited,
        },
      }),
      additionalForbiddenActions: [],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.ok(inherited.every((action) => decision.normalizedScope?.forbiddenActions.includes(action)));
});

test("63 Department forbidden additions and one child addition are allowed", () => {
  const inherited = makePolicyAdditions(
    "Department forbidden action",
    projectManifestLimits.maxUserForbiddenActions - 1,
  );
  const decision = evaluateDepartmentChildScope(
    makeChild({
      departmentManifest: makeDepartment({
        policy: {
          ...makeDepartment().policy,
          additionalForbiddenActions: inherited,
        },
      }),
      additionalForbiddenActions: ["Child forbidden action"],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.ok(decision.normalizedScope?.forbiddenActions.includes("Child forbidden action"));
});

test("64 Department forbidden additions plus one new child addition deny deterministically", () => {
  const inherited = makePolicyAdditions(
    "Department forbidden action",
    projectManifestLimits.maxUserForbiddenActions,
  );
  const input = makeChild({
    departmentManifest: makeDepartment({
      policy: {
        ...makeDepartment().policy,
        additionalForbiddenActions: inherited,
      },
    }),
    additionalForbiddenActions: ["Child forbidden action over capacity"],
  });
  const first = assertChildDenied(input, "inherited_policy_capacity_exceeded");
  const second = evaluateDepartmentChildScope(input);
  assert.deepEqual(first, second);
  assert.equal(first.reasons[0]?.path, "additionalForbiddenActions");
  assert.equal(first.projectDecision, null);
});

test("allowed scope contains Project, Department, and child policy restrictions", () => {
  const decision = evaluateDepartmentChildScope(
    makeChild({
      additionalRequiredApprovalActions: ["child-sensitive-review"],
      additionalForbiddenActions: ["Child customer contact is forbidden"],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.ok(decision.normalizedScope);
  for (const approval of [
    ...systemRequiredProjectApprovalActions,
    "project-owner-review",
    "department-owner-review",
    "child-sensitive-review",
  ]) {
    assert.ok(decision.normalizedScope.requiredApprovalActions.includes(approval));
  }
  for (const action of [
    ...systemForbiddenProjectActions,
    "Project production changes are forbidden",
    "Department publication is forbidden",
    "Child customer contact is forbidden",
  ]) {
    assert.ok(decision.normalizedScope.forbiddenActions.includes(action));
  }
});

test("Owner approval fields cannot bypass any child deny", () => {
  const decision = assertChildDenied(
    {
      ...makeChild({ requestedModelProfileIds: ["model-qwen-reviewer"] }),
      ownerApproved: true,
    },
    "invalid_child_input",
  );
  assert.equal(decision.normalizedScope, null);
});

test("combined child reasons follow deterministic fail-closed order", () => {
  const decision = evaluateDepartmentChildScope(
    makeChild({
      requestedResources: [{ resourceId: "channel", capabilities: ["read_metadata"] }],
      requestedModelProfileIds: ["model-qwen-reviewer"],
      requestedKnowledgeCollectionIds: ["kb-extra"],
      requestedBudget: { ...makeChild().requestedBudget, maxConcurrentRuns: 3 },
      externalActionMode: "approval_required",
      dataEgressMode: "redacted_only",
      additionalRequiredApprovalActions: [],
      additionalForbiddenActions: [],
    }),
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedScope, null);
  assert.deepEqual(
    decision.reasons.map((reason) => reason.code),
    [
      "resource_not_found",
      "model_profile_not_allowed",
      "knowledge_collection_not_allowed",
      "budget_ceiling_exceeded",
      "external_action_policy_relaxed",
      "data_egress_policy_relaxed",
    ],
  );
});

test("every child deny returns no partial normalized scope", () => {
  const denied = [
    makeChild({ requestedResources: [{ resourceId: "channel", capabilities: ["read_metadata"] }] }),
    makeChild({ requestedModelProfileIds: ["model-qwen-reviewer"] }),
    makeChild({ requestedKnowledgeCollectionIds: ["kb-extra"] }),
    makeChild({ requestedBudget: { ...makeChild().requestedBudget, maxConcurrentRuns: 3 } }),
    makeChild({ externalActionMode: "approval_required" }),
    makeChild({ scopeKind: "workflow", scopeId: "workflow-not-enabled" }),
  ];
  for (const input of denied) {
    const decision = evaluateDepartmentChildScope(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.normalizedScope, null);
  }
});

test("child evaluation is deterministic and preserves all caller collections", () => {
  const departmentApprovals = ["department-owner-review"];
  const departmentForbidden = ["Department publication is forbidden"];
  const childApprovals = ["child-sensitive-review"];
  const childForbidden = ["Child customer contact is forbidden"];
  const input = makeChild({
    departmentManifest: makeDepartment({
      policy: {
        ...makeDepartment().policy,
        additionalRequiredApprovalActions: departmentApprovals,
        additionalForbiddenActions: departmentForbidden,
      },
    }),
    additionalRequiredApprovalActions: childApprovals,
    additionalForbiddenActions: childForbidden,
  });
  const before = structuredClone(input);
  const first = evaluateDepartmentChildScope(input);
  const second = evaluateDepartmentChildScope(input);
  assert.equal(first.verdict, "allow", JSON.stringify(first));
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.deepEqual(departmentApprovals, ["department-owner-review"]);
  assert.deepEqual(departmentForbidden, ["Department publication is forbidden"]);
  assert.deepEqual(childApprovals, ["child-sensitive-review"]);
  assert.deepEqual(childForbidden, ["Child customer contact is forbidden"]);
});

test("invalid child input and throwing proxies fail closed without throwing", () => {
  for (const input of [null, [], "child", { ...makeChild(), requestedResources: new Set() }]) {
    assert.doesNotThrow(() => evaluateDepartmentChildScope(input));
    const decision = evaluateDepartmentChildScope(input);
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.normalizedScope, null);
  }
  const proxy = new Proxy(makeChild(), {
    get() {
      throw new Error("blocked child proxy");
    },
  });
  assert.doesNotThrow(() => evaluateDepartmentChildScope(proxy));
  assertChildDenied(proxy, "invalid_input");
});
