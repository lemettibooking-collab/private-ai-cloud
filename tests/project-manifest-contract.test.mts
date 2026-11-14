import assert from "node:assert/strict";
import test from "node:test";

const contract = (await import(
  new URL("../lib/contracts/project-manifest.ts", import.meta.url).href
)) as typeof import("../lib/contracts/project-manifest");

const {
  evaluateProjectChildScope,
  isProjectApprovalAction,
  isProjectChildScopeKind,
  isProjectDataClassification,
  isProjectDataEgressMode,
  isProjectExternalActionMode,
  isProjectManifestKind,
  isProjectManifestStatus,
  isProjectResourceCapability,
  isProjectResourceKind,
  isProjectResourceStatus,
  isProjectScopeVerdict,
  parseProjectApprovalAction,
  parseProjectChildScopeKind,
  parseProjectDataClassification,
  parseProjectDataEgressMode,
  parseProjectExternalActionMode,
  parseProjectManifestKind,
  parseProjectManifestStatus,
  parseProjectResourceCapability,
  parseProjectResourceKind,
  parseProjectResourceStatus,
  parseProjectScopeVerdict,
  projectApprovalActions,
  projectChildScopeKinds,
  projectDataClassifications,
  projectDataEgressModes,
  projectExternalActionModes,
  projectManifestKinds,
  projectManifestLimits,
  projectManifestStatuses,
  projectResourceCapabilities,
  projectResourceKinds,
  projectResourceStatuses,
  projectScopeVerdicts,
  systemForbiddenProjectActions,
  systemRequiredProjectApprovalActions,
  validateAndNormalizeProjectManifest,
} = contract;

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

function makeResource(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id,
    kind: "code_repository",
    label: `Resource ${id}`,
    status: "connected",
    connectionId: "integration-primary",
    resourceRef: `owner/${id}`,
    capabilities: ["read_metadata", "read_content", "propose_change"],
    ...overrides,
  };
}

function makeManifest(overrides: Readonly<Record<string, unknown>> = {}) {
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
    goals: ["Ship safely", "Keep owner control"],
    nonGoals: ["Automatic deployment"],
    tags: ["private-ai", "control-center"],
    resources: [
      makeResource("workspace", {
        kind: "local_workspace",
        status: "configured",
        connectionId: null,
        resourceRef: "/Users/owner/Private AI Cloud",
      }),
      makeResource("repository"),
      makeResource("channel", {
        kind: "telegram_channel",
        resourceRef: "@private_ai_cloud",
        capabilities: [
          "read_metadata",
          "read_content",
          "create_draft",
          "request_external_action",
        ],
      }),
    ],
    allowedModelProfileIds: ["model-primary", "model-reviewer"],
    knowledgeCollectionIds: ["kb-product", "kb-policy"],
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode: "redacted_only",
      requiredApprovalActions: ["owner_review"],
      forbiddenActions: ["Production deletion is forbidden"],
    },
    budget: makeBudget(),
    ...overrides,
  };
}

function makeScope(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    manifest: makeManifest(),
    scopeKind: "department",
    scopeId: "department-product",
    requestedResources: [
      {
        resourceId: "repository",
        capabilities: ["propose_change", "read_metadata"],
      },
      {
        resourceId: "workspace",
        capabilities: ["read_content"],
      },
    ],
    requestedModelProfileIds: ["model-reviewer", "model-primary"],
    requestedKnowledgeCollectionIds: ["kb-policy", "kb-product"],
    requestedBudget: makeBudget({
      maxConcurrentRuns: 2,
      maxAttemptsPerRun: 2,
      maxRunMinutes: 60,
      dailyTokenBudget: 500_000,
      monthlyCostBudgetUsdCents: 100_000,
    }),
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    requiredApprovalActions: [
      ...systemRequiredProjectApprovalActions,
      "owner_review",
    ],
    additionalForbiddenActions: ["Department cannot publish directly"],
    ...overrides,
  };
}

function requireValidManifest(input: unknown) {
  const result = validateAndNormalizeProjectManifest(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) {
    throw new Error("Expected a valid ProjectManifest");
  }
  return result.value;
}

function errorCodes(input: unknown): string[] {
  const result = validateAndNormalizeProjectManifest(input);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

function assertDeniedWith(input: unknown, code: string) {
  const decision = evaluateProjectChildScope(input);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedScope, null);
  assert.ok(
    decision.reasons.some((reason) => reason.code === code),
    `Expected ${code}: ${JSON.stringify(decision)}`,
  );
  return decision;
}

test("exports every enum in its exact canonical order", () => {
  assert.deepEqual(projectManifestStatuses, ["draft", "active", "paused", "archived"]);
  assert.deepEqual(projectManifestKinds, [
    "internal_product",
    "client_project",
    "managed_service",
    "experiment",
  ]);
  assert.deepEqual(projectDataClassifications, [
    "public",
    "internal",
    "confidential",
    "restricted",
  ]);
  assert.deepEqual(projectResourceKinds, [
    "local_workspace",
    "code_repository",
    "telegram_channel",
    "instagram_account",
    "website",
    "support_inbox",
    "email_account",
    "crm",
    "analytics",
    "file_storage",
    "custom",
  ]);
  assert.deepEqual(projectResourceStatuses, ["configured", "connected", "disabled", "error"]);
  assert.deepEqual(projectResourceCapabilities, [
    "read_metadata",
    "read_content",
    "create_draft",
    "propose_change",
    "request_external_action",
  ]);
  assert.deepEqual(projectExternalActionModes, ["locked", "approval_required"]);
  assert.deepEqual(projectDataEgressModes, ["forbidden", "redacted_only", "approved_minimum"]);
  assert.deepEqual(projectChildScopeKinds, ["department", "agent", "workflow"]);
  assert.deepEqual(projectScopeVerdicts, ["allow", "deny"]);
  assert.deepEqual(projectApprovalActions, [
    "code_run",
    "code_publication",
    "content_publication",
    "message_send",
    "customer_contact",
    "data_export",
    "configuration_change",
    "credential_change",
    "production_change",
    "financial_action",
  ]);
});

test("exports the exact fail-closed contract limits", () => {
  assert.deepEqual(projectManifestLimits, {
    maxIdLength: 64,
    maxNameLength: 160,
    maxSlugLength: 64,
    maxSummaryLength: 4096,
    maxLocaleLength: 16,
    maxTimeZoneLength: 64,
    maxDataRegionLength: 64,
    maxGoals: 32,
    maxNonGoals: 32,
    maxTags: 32,
    maxResources: 64,
    maxResourceLabelLength: 160,
    maxResourceRefLength: 512,
    maxResourceCapabilities: 5,
    maxModelProfileIds: 32,
    maxKnowledgeCollectionIds: 64,
    maxUserApprovalActions: 64,
    maxChildAdditionalApprovalActions: 64,
    maxUserForbiddenActions: 64,
    maxTextListItemLength: 1024,
    maxChildResourceGrants: 64,
    maxErrors: 256,
  });
});

test("all enum guards and parsers accept canonical values", () => {
  const cases = [
    [projectManifestStatuses, isProjectManifestStatus, parseProjectManifestStatus],
    [projectManifestKinds, isProjectManifestKind, parseProjectManifestKind],
    [projectDataClassifications, isProjectDataClassification, parseProjectDataClassification],
    [projectResourceKinds, isProjectResourceKind, parseProjectResourceKind],
    [projectResourceStatuses, isProjectResourceStatus, parseProjectResourceStatus],
    [projectResourceCapabilities, isProjectResourceCapability, parseProjectResourceCapability],
    [projectExternalActionModes, isProjectExternalActionMode, parseProjectExternalActionMode],
    [projectDataEgressModes, isProjectDataEgressMode, parseProjectDataEgressMode],
    [projectChildScopeKinds, isProjectChildScopeKind, parseProjectChildScopeKind],
    [projectScopeVerdicts, isProjectScopeVerdict, parseProjectScopeVerdict],
    [projectApprovalActions, isProjectApprovalAction, parseProjectApprovalAction],
  ] as const;
  for (const [values, guard, parser] of cases) {
    for (const value of values) {
      assert.equal(guard(value), true);
      assert.equal(parser(value), value);
    }
  }
});

test("all enum guards and parsers reject invalid and hostile values", () => {
  const functions = [
    [isProjectManifestStatus, parseProjectManifestStatus],
    [isProjectManifestKind, parseProjectManifestKind],
    [isProjectDataClassification, parseProjectDataClassification],
    [isProjectResourceKind, parseProjectResourceKind],
    [isProjectResourceStatus, parseProjectResourceStatus],
    [isProjectResourceCapability, parseProjectResourceCapability],
    [isProjectExternalActionMode, parseProjectExternalActionMode],
    [isProjectDataEgressMode, parseProjectDataEgressMode],
    [isProjectChildScopeKind, parseProjectChildScopeKind],
    [isProjectScopeVerdict, parseProjectScopeVerdict],
    [isProjectApprovalAction, parseProjectApprovalAction],
  ] as const;
  for (const [guard, parser] of functions) {
    for (const value of ["unknown", " active ", null, 1, {}, [], Symbol("hostile")]) {
      assert.doesNotThrow(() => guard(value));
      assert.doesNotThrow(() => parser(value));
      assert.equal(guard(value), false);
      assert.equal(parser(value), null);
    }
  }
});

test("validates a complete draft manifest", () => {
  assert.equal(requireValidManifest(makeManifest({ status: "draft" })).status, "draft");
});

test("validates a complete active manifest", () => {
  const manifest = requireValidManifest(makeManifest());
  assert.equal(manifest.status, "active");
  assert.equal(manifest.resources.length, 3);
});

test("trims strings and normalizes CRLF and CR to LF", () => {
  const manifest = requireValidManifest(
    makeManifest({
      name: "  Private AI Cloud  ",
      summary: "  Line one\r\nLine two\rLine three  ",
      goals: ["  First\r\nsecond  "],
    }),
  );
  assert.equal(manifest.name, "Private AI Cloud");
  assert.equal(manifest.summary, "Line one\nLine two\nLine three");
  assert.deepEqual(manifest.goals, ["First\nsecond"]);
});

test("removes empty list items and stable-deduplicates the rest", () => {
  const manifest = requireValidManifest(
    makeManifest({
      goals: [" first ", "", "first", "second", "  "],
      tags: ["one", "two", "one"],
      allowedModelProfileIds: ["model-reviewer", "model-primary", "model-reviewer"],
    }),
  );
  assert.deepEqual(manifest.goals, ["first", "second"]);
  assert.deepEqual(manifest.tags, ["one", "two"]);
  assert.deepEqual(manifest.allowedModelProfileIds, ["model-reviewer", "model-primary"]);
});

test("always prepends every system approval action", () => {
  const manifest = requireValidManifest(
    makeManifest({
      policy: {
        externalActionMode: "locked",
        dataEgressMode: "forbidden",
        requiredApprovalActions: [],
        forbiddenActions: [],
      },
    }),
  );
  assert.deepEqual(manifest.policy.requiredApprovalActions, systemRequiredProjectApprovalActions);
  assert.deepEqual(systemRequiredProjectApprovalActions, projectApprovalActions);
  assert.equal(Object.isFrozen(systemRequiredProjectApprovalActions), true);
});

test("always prepends every system forbidden action", () => {
  const manifest = requireValidManifest(
    makeManifest({
      policy: {
        externalActionMode: "locked",
        dataEgressMode: "forbidden",
        requiredApprovalActions: [],
        forbiddenActions: [],
      },
    }),
  );
  assert.deepEqual(manifest.policy.forbiddenActions, systemForbiddenProjectActions);
  assert.equal(systemForbiddenProjectActions.length, 5);
  assert.equal(Object.isFrozen(systemForbiddenProjectActions), true);
});

test("preserves user approval and forbidden values after system values", () => {
  const manifest = requireValidManifest(
    makeManifest({
      policy: {
        externalActionMode: "approval_required",
        dataEgressMode: "redacted_only",
        requiredApprovalActions: ["owner_review", "code_run", "owner_review"],
        forbiddenActions: [
          "Custom prohibition",
          systemForbiddenProjectActions[0],
          "Custom prohibition",
        ],
      },
    }),
  );
  assert.deepEqual(manifest.policy.requiredApprovalActions, [
    ...systemRequiredProjectApprovalActions,
    "owner_review",
  ]);
  assert.deepEqual(manifest.policy.forbiddenActions, [
    ...systemForbiddenProjectActions,
    "Custom prohibition",
  ]);
});

test("accepts the full 64-item project custom approval boundary", () => {
  const customApprovals = Array.from(
    { length: projectManifestLimits.maxUserApprovalActions },
    (_, index) => `project-approval-${index}`,
  );
  const manifest = requireValidManifest(
    makeManifest({
      policy: {
        ...makeManifest().policy,
        requiredApprovalActions: customApprovals,
      },
    }),
  );
  assert.deepEqual(manifest.policy.requiredApprovalActions, [
    ...systemRequiredProjectApprovalActions,
    ...customApprovals,
  ]);
  assert.equal(manifest.policy.requiredApprovalActions.length, 74);
  const repeated = requireValidManifest(manifest);
  assert.deepEqual(repeated, manifest);
});

test("normalization is idempotent at the 64-item custom forbidden boundary", () => {
  const customForbidden = Array.from(
    { length: projectManifestLimits.maxUserForbiddenActions },
    (_, index) => `Project forbidden action ${index}`,
  );
  const manifest = requireValidManifest(makeManifest({
    policy: {
      ...makeManifest().policy,
      forbiddenActions: customForbidden,
    },
  }));
  assert.deepEqual(manifest.policy.forbiddenActions, [
    ...systemForbiddenProjectActions,
    ...customForbidden,
  ]);
  assert.equal(manifest.policy.forbiddenActions.length, 69);
  assert.deepEqual(requireValidManifest(manifest), manifest);
});

test("65 custom Project policy values remain denied", () => {
  const cases = [
    ["requiredApprovalActions", projectManifestLimits.maxUserApprovalActions] as const,
    ["forbiddenActions", projectManifestLimits.maxUserForbiddenActions] as const,
  ];
  for (const [field, limit] of cases) {
    const result = validateAndNormalizeProjectManifest(makeManifest({
      policy: {
        ...makeManifest().policy,
        [field]: Array.from({ length: limit + 1 }, (_, index) => `Custom policy ${index}`),
      },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((error) => error.code === "limit_exceeded" && error.path === `policy.${field}`));
  }
});

test("oversized repetitions of canonical system policy values deny within an absolute bound", () => {
  const cases = [
    ["requiredApprovalActions", projectManifestLimits.maxUserApprovalActions, systemRequiredProjectApprovalActions] as const,
    ["forbiddenActions", projectManifestLimits.maxUserForbiddenActions, systemForbiddenProjectActions] as const,
  ];
  for (const [field, userLimit, systemValues] of cases) {
    const result = validateAndNormalizeProjectManifest(makeManifest({
      policy: {
        ...makeManifest().policy,
        [field]: Array.from(
          { length: userLimit + systemValues.length + 1 },
          () => systemValues[0],
        ),
      },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((error) => error.code === "limit_exceeded" && error.path === `policy.${field}`));
  }
});

test("allows a child to inherit all system and 64 project approvals", () => {
  const customApprovals = Array.from(
    { length: projectManifestLimits.maxUserApprovalActions },
    (_, index) => `project-approval-${index}`,
  );
  const manifest = makeManifest({
    policy: {
      ...makeManifest().policy,
      requiredApprovalActions: customApprovals,
    },
  });
  const decision = evaluateProjectChildScope(
    makeScope({
      manifest,
      requiredApprovalActions: [
        ...systemRequiredProjectApprovalActions,
        ...customApprovals,
      ],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.equal(decision.normalizedScope?.requiredApprovalActions.length, 74);
});

test("allows up to 64 additional stricter child approvals", () => {
  const projectApprovals = Array.from(
    { length: projectManifestLimits.maxUserApprovalActions },
    (_, index) => `project-approval-${index}`,
  );
  const childApprovals = Array.from(
    { length: projectManifestLimits.maxChildAdditionalApprovalActions },
    (_, index) => `child-approval-${index}`,
  );
  const manifest = makeManifest({
    policy: {
      ...makeManifest().policy,
      requiredApprovalActions: projectApprovals,
    },
  });
  const decision = evaluateProjectChildScope(
    makeScope({
      manifest,
      requiredApprovalActions: [
        ...systemRequiredProjectApprovalActions,
        ...projectApprovals,
        ...childApprovals,
      ],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.equal(decision.normalizedScope?.requiredApprovalActions.length, 138);
});

test("deterministically denies a 65th child-specific approval", () => {
  const projectApprovals = Array.from(
    { length: projectManifestLimits.maxUserApprovalActions },
    (_, index) => `project-approval-${index}`,
  );
  const childApprovals = Array.from(
    { length: projectManifestLimits.maxChildAdditionalApprovalActions + 1 },
    (_, index) => `child-approval-${index}`,
  );
  const manifest = makeManifest({
    policy: {
      ...makeManifest().policy,
      requiredApprovalActions: projectApprovals,
    },
  });
  const input = makeScope({
    manifest,
    requiredApprovalActions: [
      ...systemRequiredProjectApprovalActions,
      ...projectApprovals,
      ...childApprovals,
    ],
  });
  const first = assertDeniedWith(input, "invalid_scope_input");
  assert.deepEqual(evaluateProjectChildScope(input), first);
});

test("cannot remove any approval from a maximum-size project policy", () => {
  const projectApprovals = Array.from(
    { length: projectManifestLimits.maxUserApprovalActions },
    (_, index) => `project-approval-${index}`,
  );
  const manifest = makeManifest({
    policy: {
      ...makeManifest().policy,
      requiredApprovalActions: projectApprovals,
    },
  });
  assertDeniedWith(
    makeScope({
      manifest,
      requiredApprovalActions: [
        ...systemRequiredProjectApprovalActions,
        ...projectApprovals.slice(0, -1),
      ],
    }),
    "required_approval_missing",
  );
});

test("does not mutate deeply nested manifest input", () => {
  const input = makeManifest();
  const before = structuredClone(input);
  requireValidManifest(input);
  assert.deepEqual(input, before);
});

test("returns fresh objects and arrays without sharing mutable input", () => {
  const input = makeManifest();
  const first = requireValidManifest(input);
  const second = requireValidManifest(input);
  assert.notEqual(first, second);
  assert.notEqual(first.resources, input.resources);
  assert.notEqual(first.resources[0], input.resources[0]);
  assert.notEqual(first.resources[0].capabilities, input.resources[0].capabilities);
  assert.notEqual(first.policy, input.policy);
  assert.notEqual(first.policy.requiredApprovalActions, input.policy.requiredApprovalActions);
  assert.notEqual(first.budget, input.budget);
  assert.notEqual(first.resources, second.resources);
});

test("rejects invalid project, workspace, connection, and resource IDs", () => {
  const cases = [
    makeManifest({ id: "Project" }),
    makeManifest({ workspaceId: "workspace/primary" }),
    makeManifest({ resources: [makeResource("bad id")] }),
    makeManifest({ resources: [makeResource("repo", { connectionId: "BAD" })] }),
  ];
  for (const input of cases) {
    assert.ok(errorCodes(input).includes("invalid_id"));
  }
});

test("rejects invalid slugs and accepts the 64-character slug boundary", () => {
  assert.ok(errorCodes(makeManifest({ slug: "Private_AI" })).includes("invalid_slug"));
  assert.equal(requireValidManifest(makeManifest({ slug: `a${"b".repeat(63)}` })).slug.length, 64);
  assert.ok(errorCodes(makeManifest({ slug: `a${"b".repeat(64)}` })).includes("invalid_slug"));
});

test("requires version to be a positive safe integer", () => {
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.ok(errorCodes(makeManifest({ version })).includes("invalid_integer"));
  }
  assert.equal(requireValidManifest(makeManifest({ version: Number.MAX_SAFE_INTEGER })).version, Number.MAX_SAFE_INTEGER);
});

test("rejects duplicate resource IDs with the exact duplicate path", () => {
  const result = validateAndNormalizeProjectManifest(
    makeManifest({ resources: [makeResource("same"), makeResource("same")] }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.code === "duplicate_resource_id" && error.path === "resources[1].id"));
  }
});

test("rejects empty or wholly invalid resource capabilities", () => {
  assert.ok(
    errorCodes(makeManifest({ resources: [makeResource("repo", { capabilities: [] })] })).includes(
      "empty_capabilities",
    ),
  );
  assert.ok(
    errorCodes(
      makeManifest({ resources: [makeResource("repo", { capabilities: ["deploy"] })] }),
    ).includes("empty_capabilities"),
  );
});

test("rejects unknown values for every manifest enum field", () => {
  const cases = [
    makeManifest({ kind: "department" }),
    makeManifest({ status: "running" }),
    makeManifest({ dataClassification: "secret" }),
    makeManifest({ resources: [makeResource("repo", { kind: "shell" })] }),
    makeManifest({ resources: [makeResource("repo", { status: "ready" })] }),
    makeManifest({
      policy: {
        externalActionMode: "automatic",
        dataEgressMode: "redacted_only",
        requiredApprovalActions: [],
        forbiddenActions: [],
      },
    }),
  ];
  for (const input of cases) {
    assert.ok(errorCodes(input).includes("invalid_enum"));
  }
});

test("rejects unknown fields at manifest, resource, policy, and budget paths", () => {
  const cases = [
    [makeManifest({ execute: true }), "execute"],
    [makeManifest({ resources: [makeResource("repo", { token: "x" })] }), "resources[0].token"],
    [
      makeManifest({
        policy: {
          externalActionMode: "locked",
          dataEgressMode: "forbidden",
          requiredApprovalActions: [],
          forbiddenActions: [],
          bypass: true,
        },
      }),
      "policy.bypass",
    ],
    [makeManifest({ budget: makeBudget({ unlimited: true }) }), "budget.unlimited"],
  ] as const;
  for (const [input, path] of cases) {
    const result = validateAndNormalizeProjectManifest(input);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((error) => error.code === "unknown_field" && error.path === path));
    }
  }
});

test("reports missing own fields and rejects inherited manifest permissions", () => {
  const missing = structuredClone(makeManifest());
  Reflect.deleteProperty(missing, "status");
  const missingResult = validateAndNormalizeProjectManifest(missing);
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) {
    assert.ok(missingResult.errors.some((error) => error.code === "required_field" && error.path === "status"));
  }

  const inherited = Object.create(makeManifest()) as Record<string, unknown>;
  const inheritedResult = validateAndNormalizeProjectManifest(inherited);
  assert.equal(inheritedResult.ok, false);
  if (!inheritedResult.ok) {
    assert.ok(inheritedResult.errors.some((error) => error.code === "required_field" && error.path === "id"));
  }
});

test("enforces scalar string limits and accepts each exact boundary", () => {
  const fields = [
    ["name", projectManifestLimits.maxNameLength],
    ["summary", projectManifestLimits.maxSummaryLength],
    ["defaultLocale", projectManifestLimits.maxLocaleLength],
    ["timeZone", projectManifestLimits.maxTimeZoneLength],
    ["dataRegion", projectManifestLimits.maxDataRegionLength],
  ] as const;
  for (const [field, limit] of fields) {
    assert.equal(validateAndNormalizeProjectManifest(makeManifest({ [field]: "a".repeat(limit) })).ok, true);
    assert.ok(errorCodes(makeManifest({ [field]: "a".repeat(limit + 1) })).includes("limit_exceeded"));
  }
  assert.equal(
    validateAndNormalizeProjectManifest(
      makeManifest({ resources: [makeResource("repo", { label: "a".repeat(projectManifestLimits.maxResourceLabelLength) })] }),
    ).ok,
    true,
  );
  assert.ok(
    errorCodes(
      makeManifest({ resources: [makeResource("repo", { label: "a".repeat(projectManifestLimits.maxResourceLabelLength + 1) })] }),
    ).includes("limit_exceeded"),
  );
  assert.equal(
    validateAndNormalizeProjectManifest(
      makeManifest({ resources: [makeResource("repo", { resourceRef: "a".repeat(projectManifestLimits.maxResourceRefLength) })] }),
    ).ok,
    true,
  );
  assert.ok(
    errorCodes(
      makeManifest({ resources: [makeResource("repo", { resourceRef: "a".repeat(projectManifestLimits.maxResourceRefLength + 1) })] }),
    ).includes("limit_exceeded"),
  );
  assert.equal(requireValidManifest(makeManifest({ id: `a${"b".repeat(63)}` })).id.length, projectManifestLimits.maxIdLength);
  assert.ok(errorCodes(makeManifest({ id: `a${"b".repeat(64)}` })).includes("invalid_id"));
});

test("enforces all text-list count and item-length boundaries", () => {
  const lists = [
    ["goals", projectManifestLimits.maxGoals],
    ["nonGoals", projectManifestLimits.maxNonGoals],
    ["tags", projectManifestLimits.maxTags],
  ] as const;
  for (const [field, limit] of lists) {
    const values = Array.from({ length: limit }, (_, index) => `${field}-${index}`);
    assert.equal(validateAndNormalizeProjectManifest(makeManifest({ [field]: values })).ok, true);
    assert.ok(errorCodes(makeManifest({ [field]: [...values, `${field}-over`] })).includes("limit_exceeded"));
  }
  assert.equal(validateAndNormalizeProjectManifest(makeManifest({ goals: ["a".repeat(projectManifestLimits.maxTextListItemLength)] })).ok, true);
  assert.ok(errorCodes(makeManifest({ goals: ["a".repeat(projectManifestLimits.maxTextListItemLength + 1)] })).includes("limit_exceeded"));
});

test("enforces resource, capability, model, knowledge, and forbidden-list limits", () => {
  const resources = Array.from({ length: projectManifestLimits.maxResources }, (_, index) => makeResource(`r-${index}`));
  assert.equal(validateAndNormalizeProjectManifest(makeManifest({ resources })).ok, true);
  assert.ok(errorCodes(makeManifest({ resources: [...resources, makeResource("r-over")] })).includes("limit_exceeded"));

  assert.equal(validateAndNormalizeProjectManifest(makeManifest({ resources: [makeResource("all", { capabilities: [...projectResourceCapabilities] })] })).ok, true);
  assert.ok(errorCodes(makeManifest({ resources: [makeResource("all", { capabilities: [...projectResourceCapabilities, "read_metadata"] })] })).includes("limit_exceeded"));

  const models = Array.from({ length: projectManifestLimits.maxModelProfileIds }, (_, index) => `m-${index}`);
  const knowledge = Array.from({ length: projectManifestLimits.maxKnowledgeCollectionIds }, (_, index) => `k-${index}`);
  assert.equal(validateAndNormalizeProjectManifest(makeManifest({ allowedModelProfileIds: models, knowledgeCollectionIds: knowledge })).ok, true);
  assert.ok(errorCodes(makeManifest({ allowedModelProfileIds: [...models, "m-over"] })).includes("limit_exceeded"));
  assert.ok(errorCodes(makeManifest({ knowledgeCollectionIds: [...knowledge, "k-over"] })).includes("limit_exceeded"));

  const forbiddenActions = Array.from({ length: projectManifestLimits.maxUserForbiddenActions }, (_, index) => `Forbidden ${index}`);
  const policy = makeManifest().policy;
  assert.equal(validateAndNormalizeProjectManifest(makeManifest({ policy: { ...policy, forbiddenActions } })).ok, true);
  assert.ok(errorCodes(makeManifest({ policy: { ...policy, forbiddenActions: [...forbiddenActions, "over"] } })).includes("limit_exceeded"));
  assert.ok(projectManifestLimits.maxErrors >= 256);
});

test("accepts every budget boundary and treats zero token and cost budgets as zero", () => {
  const minimum = makeBudget({
    maxConcurrentRuns: 1,
    maxAttemptsPerRun: 1,
    maxRunMinutes: 1,
    dailyTokenBudget: 0,
    monthlyCostBudgetUsdCents: 0,
  });
  const maximum = makeBudget({
    maxConcurrentRuns: 16,
    maxAttemptsPerRun: 3,
    maxRunMinutes: 240,
    dailyTokenBudget: 1_000_000_000,
    monthlyCostBudgetUsdCents: 100_000_000,
  });
  assert.deepEqual(requireValidManifest(makeManifest({ budget: minimum })).budget, minimum);
  assert.deepEqual(requireValidManifest(makeManifest({ budget: maximum })).budget, maximum);
});

test("rejects out-of-range, fractional, unsafe, and non-number budgets", () => {
  const cases = [
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
    ["maxRunMinutes", 1.5],
    ["dailyTokenBudget", Number.MAX_SAFE_INTEGER + 1],
    ["monthlyCostBudgetUsdCents", "100"],
  ] as const;
  for (const [field, value] of cases) {
    assert.ok(errorCodes(makeManifest({ budget: makeBudget({ [field]: value }) })).includes("invalid_integer"));
  }
});

test("never throws for primitive, cyclic, or otherwise malformed unknown inputs", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const input of [undefined, null, false, 1, "manifest", [], cyclic]) {
    assert.doesNotThrow(() => validateAndNormalizeProjectManifest(input));
    assert.equal(validateAndNormalizeProjectManifest(input).ok, false);
    assert.doesNotThrow(() => evaluateProjectChildScope(input));
    assert.equal(evaluateProjectChildScope(input).verdict, "deny");
  }
});

test("converts throwing getters and proxies into stable fail-closed results", () => {
  const throwingGetter = Object.defineProperty({}, "id", {
    enumerable: true,
    get() {
      throw new Error("hostile getter");
    },
  });
  const throwingProxy = new Proxy({}, {
    ownKeys() {
      throw new Error("hostile proxy");
    },
  });
  for (const input of [throwingGetter, throwingProxy]) {
    const manifest = validateAndNormalizeProjectManifest(input);
    assert.deepEqual(manifest, {
      ok: false,
      errors: [{ code: "invalid_input", path: "$", message: "ProjectManifest input could not be safely inspected." }],
    });
    assert.equal(evaluateProjectChildScope(input).verdict, "deny");
  }
});

test("rejects credential-like and executable resource references", () => {
  const refs = [
    "path\nwith-newline",
    "path\rwith-return",
    "path\u0000with-nul",
    "https://user:password@example.com/repo",
    "https://example.com/repo?token=value",
    "https://example.com/repo#password=value",
    "https://example.com/?secret=value",
    "https://example.com/?api_key=value",
    "https://example.com/?apikey=value",
    "Bearer abcdef",
    "-----BEGIN PRIVATE KEY-----",
    "$(whoami)",
    "`whoami`",
  ];
  for (const resourceRef of refs) {
    assert.ok(
      errorCodes(makeManifest({ resources: [makeResource("repo", { resourceRef })] })).includes(
        "secret_material_not_allowed",
      ),
      resourceRef,
    );
  }
});

test("rejects every extended credential parameter alias case-insensitively", () => {
  const keys = [
    "access_token",
    "access-token",
    "refresh_token",
    "refresh-token",
    "id_token",
    "id-token",
    "bot_token",
    "bot-token",
    "auth_token",
    "auth-token",
    "client_secret",
    "client-secret",
    "webhook_secret",
    "webhook-secret",
    "private_key",
    "private-key",
    "api-key",
    "x-api-key",
  ];
  for (const key of keys) {
    for (const candidate of [key, key.toUpperCase()]) {
      const resourceRef = `https://example.com/resource?${candidate}=value`;
      assert.ok(
        errorCodes(
          makeManifest({ resources: [makeResource("repo", { resourceRef })] }),
        ).includes("secret_material_not_allowed"),
        resourceRef,
      );
    }
  }
});

test("accepts safe near-match resource parameter names", () => {
  const keys = [
    "tokenizer=model",
    "secretary=team",
    "passwordless=true",
    "api_key_name=primary",
    "monkey=value",
  ];
  for (const parameter of keys) {
    const resourceRef = `https://example.com/resource?${parameter}`;
    assert.equal(
      validateAndNormalizeProjectManifest(
        makeManifest({ resources: [makeResource("repo", { resourceRef })] }),
      ).ok,
      true,
      resourceRef,
    );
  }
});

test("accepts safe local, GitHub, Telegram, Instagram, website, and inbox references", () => {
  const refs = [
    "/Users/owner/Private AI Cloud",
    "owner/repository",
    "@telegram_channel",
    "@instagram_account",
    "public.example.com/project",
    "support-inbox-primary",
  ];
  for (const [index, resourceRef] of refs.entries()) {
    assert.equal(
      validateAndNormalizeProjectManifest(
        makeManifest({ resources: [makeResource(`safe-${index}`, { resourceRef })] }),
      ).ok,
      true,
      resourceRef,
    );
  }
});

test("allows an active child scope and canonicalizes all inherited collections", () => {
  const decision = evaluateProjectChildScope(makeScope());
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(decision.reasons, []);
  assert.ok(decision.normalizedScope);
  assert.deepEqual(decision.normalizedScope.resources, [
    { resourceId: "workspace", capabilities: ["read_content"] },
    { resourceId: "repository", capabilities: ["read_metadata", "propose_change"] },
  ]);
  assert.deepEqual(decision.normalizedScope.modelProfileIds, ["model-primary", "model-reviewer"]);
  assert.deepEqual(decision.normalizedScope.knowledgeCollectionIds, ["kb-product", "kb-policy"]);
});

test("denies draft, paused, and archived project manifests", () => {
  for (const status of ["draft", "paused", "archived"]) {
    assertDeniedWith(makeScope({ manifest: makeManifest({ status }) }), "project_not_active");
  }
});

test("denies an unknown requested resource", () => {
  assertDeniedWith(
    makeScope({ requestedResources: [{ resourceId: "unknown", capabilities: ["read_metadata"] }] }),
    "resource_not_found",
  );
});

test("reports the exact array path for an unknown requested resource", () => {
  const decision = assertDeniedWith(
    makeScope({
      requestedResources: [
        { resourceId: "workspace", capabilities: ["read_metadata"] },
        { resourceId: "unknown", capabilities: ["read_metadata"] },
      ],
    }),
    "resource_not_found",
  );
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === "resource_not_found" &&
        reason.path === "requestedResources[1].resourceId",
    ),
  );
});

test("denies disabled and error resources", () => {
  for (const status of ["disabled", "error"]) {
    const manifest = makeManifest({ resources: [makeResource("repository", { status })] });
    assertDeniedWith(
      makeScope({
        manifest,
        requestedResources: [{ resourceId: "repository", capabilities: ["read_metadata"] }],
      }),
      "resource_unavailable",
    );
  }
});

test("reports the exact array path for an unavailable resource", () => {
  const manifest = makeManifest({
    resources: [
      makeResource("workspace", {
        kind: "local_workspace",
        status: "configured",
        connectionId: null,
        resourceRef: "/workspace",
      }),
      makeResource("repository", { status: "disabled" }),
    ],
  });
  const decision = assertDeniedWith(
    makeScope({
      manifest,
      requestedResources: [
        { resourceId: "workspace", capabilities: ["read_metadata"] },
        { resourceId: "repository", capabilities: ["read_metadata"] },
      ],
    }),
    "resource_unavailable",
  );
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === "resource_unavailable" &&
        reason.path === "requestedResources[1].resourceId",
    ),
  );
});

test("allows a strict subset of resource capabilities", () => {
  const decision = evaluateProjectChildScope(
    makeScope({
      requestedResources: [{ resourceId: "repository", capabilities: ["read_content"] }],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(decision.normalizedScope?.resources[0].capabilities, ["read_content"]);
});

test("denies capability expansion even when approvals are present", () => {
  assertDeniedWith(
    makeScope({
      requestedResources: [
        { resourceId: "repository", capabilities: ["request_external_action"] },
      ],
    }),
    "capability_not_allowed",
  );
});

test("reports the exact array path for a forbidden capability", () => {
  const decision = assertDeniedWith(
    makeScope({
      requestedResources: [
        { resourceId: "workspace", capabilities: ["read_metadata"] },
        {
          resourceId: "repository",
          capabilities: ["read_metadata", "request_external_action"],
        },
      ],
    }),
    "capability_not_allowed",
  );
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === "capability_not_allowed" &&
        reason.path === "requestedResources[1].capabilities[1]",
    ),
  );
});

test("allows a model-profile subset and restores manifest ordering", () => {
  const decision = evaluateProjectChildScope(
    makeScope({ requestedModelProfileIds: ["model-reviewer"] }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(decision.normalizedScope?.modelProfileIds, ["model-reviewer"]);
});

test("denies a model profile outside the manifest allowlist", () => {
  assertDeniedWith(
    makeScope({ requestedModelProfileIds: ["model-unknown"] }),
    "model_profile_not_allowed",
  );
});

test("reports the exact array path for an unknown model profile", () => {
  const decision = assertDeniedWith(
    makeScope({ requestedModelProfileIds: ["model-primary", "model-unknown"] }),
    "model_profile_not_allowed",
  );
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === "model_profile_not_allowed" &&
        reason.path === "requestedModelProfileIds[1]",
    ),
  );
});

test("allows a Knowledge Collection subset and restores manifest ordering", () => {
  const decision = evaluateProjectChildScope(
    makeScope({ requestedKnowledgeCollectionIds: ["kb-policy"] }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(decision.normalizedScope?.knowledgeCollectionIds, ["kb-policy"]);
});

test("denies a Knowledge Collection outside the manifest allowlist", () => {
  assertDeniedWith(
    makeScope({ requestedKnowledgeCollectionIds: ["kb-unknown"] }),
    "knowledge_collection_not_allowed",
  );
});

test("reports the exact array path for an unknown Knowledge Collection", () => {
  const decision = assertDeniedWith(
    makeScope({
      requestedKnowledgeCollectionIds: ["kb-product", "kb-unknown"],
    }),
    "knowledge_collection_not_allowed",
  );
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === "knowledge_collection_not_allowed" &&
        reason.path === "requestedKnowledgeCollectionIds[1]",
    ),
  );
});

test("allows budget values equal to or lower than every project ceiling", () => {
  for (const requestedBudget of [makeBudget(), makeScope().requestedBudget]) {
    const decision = evaluateProjectChildScope(makeScope({ requestedBudget }));
    assert.equal(decision.verdict, "allow", JSON.stringify(decision));
    assert.deepEqual(decision.normalizedScope?.budget, requestedBudget);
  }
});

test("denies expansion of each individual budget field", () => {
  const expansions = {
    maxConcurrentRuns: 5,
    maxAttemptsPerRun: 4,
    maxRunMinutes: 121,
    dailyTokenBudget: 1_000_001,
    monthlyCostBudgetUsdCents: 250_001,
  };
  for (const [field, value] of Object.entries(expansions)) {
    assertDeniedWith(
      makeScope({ requestedBudget: makeBudget({ [field]: value }) }),
      "budget_ceiling_exceeded",
    );
  }
});

test("denies invalid absolute child budget values even below a project ceiling", () => {
  assertDeniedWith(
    makeScope({ requestedBudget: makeBudget({ maxConcurrentRuns: 0 }) }),
    "invalid_scope_input",
  );
  assertDeniedWith(
    makeScope({ requestedBudget: makeBudget({ dailyTokenBudget: -1 }) }),
    "invalid_scope_input",
  );
});

test("locked external actions cannot be relaxed while approval-required can narrow", () => {
  const lockedManifest = makeManifest({
    policy: {
      ...makeManifest().policy,
      externalActionMode: "locked",
    },
  });
  assertDeniedWith(
    makeScope({ manifest: lockedManifest, externalActionMode: "approval_required" }),
    "external_action_policy_relaxed",
  );
  assert.equal(
    evaluateProjectChildScope(makeScope({ externalActionMode: "locked" })).verdict,
    "allow",
  );
});

test("data-egress policy can only stay equal or become stricter", () => {
  assertDeniedWith(
    makeScope({ dataEgressMode: "approved_minimum" }),
    "data_egress_policy_relaxed",
  );
  assert.equal(evaluateProjectChildScope(makeScope({ dataEgressMode: "redacted_only" })).verdict, "allow");
  assert.equal(evaluateProjectChildScope(makeScope({ dataEgressMode: "forbidden" })).verdict, "allow");
});

test("a child cannot remove a project approval but may add stricter approvals", () => {
  assertDeniedWith(
    makeScope({ requiredApprovalActions: [...systemRequiredProjectApprovalActions] }),
    "required_approval_missing",
  );
  const decision = evaluateProjectChildScope(
    makeScope({
      requiredApprovalActions: [
        ...systemRequiredProjectApprovalActions,
        "owner_review",
        "security_review",
      ],
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(decision.normalizedScope?.requiredApprovalActions, [
    ...systemRequiredProjectApprovalActions,
    "owner_review",
    "security_review",
  ]);
});

test("effective forbidden actions retain all project and system prohibitions", () => {
  const decision = evaluateProjectChildScope(makeScope());
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(decision.normalizedScope?.forbiddenActions, [
    ...systemForbiddenProjectActions,
    "Production deletion is forbidden",
    "Department cannot publish directly",
  ]);
});

test("normalization is deterministic across request and Set insertion order", () => {
  const first = evaluateProjectChildScope(makeScope());
  const second = evaluateProjectChildScope(
    makeScope({
      requestedResources: new Set([
        { resourceId: "workspace", capabilities: new Set(["read_content"]) },
        {
          resourceId: "repository",
          capabilities: new Set(["read_metadata", "propose_change"]),
        },
      ]),
      requestedModelProfileIds: new Set(["model-primary", "model-reviewer"]),
      requestedKnowledgeCollectionIds: new Set(["kb-product", "kb-policy"]),
      requiredApprovalActions: new Set([
        "owner_review",
        ...[...systemRequiredProjectApprovalActions].reverse(),
      ]),
      additionalForbiddenActions: new Set(["Department cannot publish directly"]),
    }),
  );
  assert.deepEqual(second, first);
  assert.deepEqual(evaluateProjectChildScope(makeScope()), first);
});

test("invalid requested-resource Sets produce deep-equal deny decisions in either insertion order", () => {
  const unknown = {
    resourceId: "unknown-resource",
    capabilities: new Set(["read_metadata"]),
  };
  const expanded = {
    resourceId: "repository",
    capabilities: new Set(["request_external_action", "read_metadata"]),
  };
  const first = evaluateProjectChildScope(
    makeScope({ requestedResources: new Set([unknown, expanded]) }),
  );
  const second = evaluateProjectChildScope(
    makeScope({
      requestedResources: new Set([
        { ...expanded, capabilities: new Set(expanded.capabilities) },
        { ...unknown, capabilities: new Set(unknown.capabilities) },
      ]),
    }),
  );
  assert.equal(first.verdict, "deny");
  assert.equal(first.normalizedScope, null);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.reasons.map((reason) => reason.code),
    ["resource_not_found", "capability_not_allowed"],
  );
});

test("invalid model and knowledge Sets produce deep-equal canonically ordered reasons", () => {
  const first = evaluateProjectChildScope(
    makeScope({
      requestedModelProfileIds: new Set(["model-z", "model-a"]),
      requestedKnowledgeCollectionIds: new Set(["kb-z", "kb-a"]),
    }),
  );
  const second = evaluateProjectChildScope(
    makeScope({
      requestedModelProfileIds: new Set(["model-a", "model-z"]),
      requestedKnowledgeCollectionIds: new Set(["kb-a", "kb-z"]),
    }),
  );
  assert.equal(first.verdict, "deny");
  assert.equal(first.normalizedScope, null);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.reasons.map((reason) => [reason.code, reason.path]),
    [
      ["model_profile_not_allowed", "requestedModelProfileIds[0]"],
      ["model_profile_not_allowed", "requestedModelProfileIds[1]"],
      ["knowledge_collection_not_allowed", "requestedKnowledgeCollectionIds[0]"],
      ["knowledge_collection_not_allowed", "requestedKnowledgeCollectionIds[1]"],
    ],
  );
});

test("a deeply nested object inside a Set deterministically denies without throwing", () => {
  let nested: Record<string, unknown> = { leaf: "value" };
  for (let depth = 0; depth < 32; depth += 1) {
    nested = { nested };
  }
  const input = makeScope({ requestedModelProfileIds: new Set([nested]) });
  const first = evaluateProjectChildScope(input);
  const second = evaluateProjectChildScope(input);
  assert.equal(first.verdict, "deny");
  assert.equal(first.normalizedScope, null);
  assert.ok(
    first.reasons.some(
      (reason) =>
        reason.code === "invalid_scope_input" &&
        reason.path === "requestedModelProfileIds" &&
        reason.message.includes("nesting-depth limit"),
    ),
  );
  assert.deepEqual(second, first);
});

test("a very wide object inside a Set denies at the inspection-entry limit", () => {
  const wide: Record<string, unknown> = {};
  for (let index = 0; index < 1_100; index += 1) {
    wide[`field-${index}`] = index;
  }
  const decision = evaluateProjectChildScope(
    makeScope({ requestedModelProfileIds: new Set([wide]) }),
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedScope, null);
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === "invalid_scope_input" &&
        reason.path === "requestedModelProfileIds" &&
        reason.message.includes("field/element limit"),
    ),
  );
});

test("oversized nested arrays and Sets deny without partial normalization", () => {
  const oversizedArray = Array.from({ length: 1_100 }, (_, index) => index);
  const oversizedSet = new Set(
    Array.from({ length: 1_100 }, (_, index) => `value-${index}`),
  );
  const decision = evaluateProjectChildScope(
    makeScope({
      requestedModelProfileIds: new Set([oversizedArray]),
      requestedKnowledgeCollectionIds: new Set([oversizedSet]),
    }),
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedScope, null);
  assert.deepEqual(
    decision.reasons.map((reason) => [reason.code, reason.path]),
    [
      ["invalid_scope_input", "requestedModelProfileIds"],
      ["invalid_scope_input", "requestedKnowledgeCollectionIds"],
    ],
  );
});

test("an oversized canonical sort key produces a structured deny", () => {
  const decision = evaluateProjectChildScope(
    makeScope({ requestedModelProfileIds: new Set(["x".repeat(20_000)]) }),
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedScope, null);
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === "invalid_scope_input" &&
        reason.path === "requestedModelProfileIds" &&
        reason.message.includes("sort key exceeds its length limit"),
    ),
  );
});

test("oversized combined Set sort keys deny with bounded retained state", () => {
  const additionalApprovals = Array.from(
    { length: 20 },
    (_, index) => `child-${index}-${"x".repeat(15_000)}`,
  );
  const decision = evaluateProjectChildScope(
    makeScope({
      requiredApprovalActions: new Set([
        ...systemRequiredProjectApprovalActions,
        "owner_review",
        ...additionalApprovals,
      ]),
    }),
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedScope, null);
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === "invalid_scope_input" &&
        reason.path === "requiredApprovalActions" &&
        reason.message.includes("combined length limit"),
    ),
  );
});

test("equivalent hostile Sets deny identically in reverse insertion order", () => {
  function makeDeepValue() {
    let value: Record<string, unknown> = { leaf: "value" };
    for (let depth = 0; depth < 32; depth += 1) {
      value = { value };
    }
    return value;
  }
  function makeWideValue() {
    const value: Record<string, unknown> = {};
    for (let index = 0; index < 1_100; index += 1) {
      value[`field-${index}`] = index;
    }
    return value;
  }
  const first = evaluateProjectChildScope(
    makeScope({
      requestedModelProfileIds: new Set([makeDeepValue(), makeWideValue()]),
    }),
  );
  const second = evaluateProjectChildScope(
    makeScope({
      requestedModelProfileIds: new Set([makeWideValue(), makeDeepValue()]),
    }),
  );
  assert.equal(first.verdict, "deny");
  assert.equal(first.normalizedScope, null);
  assert.deepEqual(second, first);
});

test("bounded sorting preserves valid primitive and requested-resource Sets", () => {
  const decision = evaluateProjectChildScope(
    makeScope({
      requestedResources: new Set([
        {
          resourceId: "repository",
          capabilities: new Set(["propose_change", "read_metadata"]),
        },
        { resourceId: "workspace", capabilities: new Set(["read_content"]) },
      ]),
      requestedModelProfileIds: new Set(["model-reviewer", "model-primary"]),
      requestedKnowledgeCollectionIds: new Set(["kb-policy", "kb-product"]),
    }),
  );
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.deepEqual(decision.normalizedScope?.resources, [
    { resourceId: "workspace", capabilities: ["read_content"] },
    { resourceId: "repository", capabilities: ["read_metadata", "propose_change"] },
  ]);
});

test("throwing Set-element getters and proxies remain fail-closed", () => {
  const throwingGetter = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      throw new Error("hostile getter");
    },
  });
  const throwingProxy = new Proxy({}, {
    ownKeys() {
      throw new Error("hostile proxy");
    },
  });
  for (const value of [throwingGetter, throwingProxy]) {
    const decision = evaluateProjectChildScope(
      makeScope({ requestedModelProfileIds: new Set([value]) }),
    );
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.normalizedScope, null);
    assert.ok(decision.reasons.some((reason) => reason.code === "invalid_scope_input"));
  }
});

test("child evaluation does not mutate request Sets, arrays, or manifest", () => {
  const input = makeScope({
    requestedModelProfileIds: new Set(["model-reviewer", "model-primary"]),
    requestedKnowledgeCollectionIds: new Set(["kb-policy", "kb-product"]),
  });
  const manifestBefore = structuredClone(input.manifest);
  const resourceBefore = structuredClone(input.requestedResources);
  const modelsBefore = [...input.requestedModelProfileIds];
  evaluateProjectChildScope(input);
  assert.deepEqual(input.manifest, manifestBefore);
  assert.deepEqual(input.requestedResources, resourceBefore);
  assert.deepEqual([...input.requestedModelProfileIds], modelsBefore);
});

test("multiple violations produce one deny with no partial normalized scope", () => {
  const decision = evaluateProjectChildScope(
    makeScope({
      requestedResources: [
        { resourceId: "unknown", capabilities: ["read_metadata"] },
        { resourceId: "repository", capabilities: ["request_external_action"] },
      ],
      requestedModelProfileIds: ["model-unknown"],
      requestedKnowledgeCollectionIds: ["kb-unknown"],
      requestedBudget: makeBudget({ maxConcurrentRuns: 5 }),
      dataEgressMode: "approved_minimum",
      requiredApprovalActions: [],
    }),
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.normalizedScope, null);
  assert.ok(decision.reasons.length > 5);
  assert.ok(decision.reasons.some((reason) => reason.code === "resource_not_found"));
  assert.ok(decision.reasons.some((reason) => reason.code === "capability_not_allowed"));
  assert.ok(decision.reasons.some((reason) => reason.code === "budget_ceiling_exceeded"));
});

test("invalid manifests cannot be bypassed by complete child approvals", () => {
  assertDeniedWith(
    makeScope({ manifest: makeManifest({ execute: true }) }),
    "invalid_project_manifest",
  );
});

test("allow decisions contain configuration only and no execution side effects", () => {
  const decision = evaluateProjectChildScope(makeScope());
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  const serialized = JSON.stringify(decision);
  for (const forbiddenKey of ["execute", "runCommand", "deploy", "merge", "publish", "network", "filesystem"]) {
    assert.equal(serialized.includes(`\"${forbiddenKey}\"`), false);
  }
});

test("scope input rejects unknown fields, duplicate resources, and over-limit grants", () => {
  assertDeniedWith(makeScope({ bypass: true }), "invalid_scope_input");
  assertDeniedWith(
    makeScope({
      requestedResources: [
        { resourceId: "repository", capabilities: ["read_metadata"] },
        { resourceId: "repository", capabilities: ["read_content"] },
      ],
    }),
    "invalid_scope_input",
  );
  const grants = Array.from(
    { length: projectManifestLimits.maxChildResourceGrants + 1 },
    (_, index) => ({ resourceId: `unknown-${index}`, capabilities: ["read_metadata"] }),
  );
  assertDeniedWith(makeScope({ requestedResources: grants }), "invalid_scope_input");
});
