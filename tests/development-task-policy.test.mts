import assert from "node:assert/strict";
import test from "node:test";

const policyModule = (await import(
  new URL("../lib/contracts/development-task-policy.ts", import.meta.url).href
)) as typeof import("../lib/contracts/development-task-policy");

const {
  developmentTaskAdmissionLimits,
  developmentTaskAdmissionVerdicts,
  evaluateDevelopmentTaskAdmission,
  isDevelopmentTaskAdmissionVerdict,
  isSensitiveRepositoryPath,
  isSystemForbiddenRepositoryPath,
  normalizeRepositoryPath,
  parseDevelopmentTaskAdmissionVerdict,
  repositoryPathContains,
  repositoryPathsOverlap,
  sensitiveRepositoryPathPolicies,
} = policyModule;

function makeTask(
  id = "task-a",
  sequence = 1,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id,
    sequence,
    title: `Implement ${id}`,
    goal: `Deliver ${id}`,
    scope: [`Scope ${id}`],
    nonGoals: [],
    allowedPaths: ["lib/feature.ts"],
    acceptanceCriteria: [`${id} is deterministic`],
    verificationCommands: ["npm test"],
    dependencyIds: [],
    riskLevel: "low",
    priority: "P3",
    requiresOwnerApproval: false,
    ...overrides,
  };
}

function makePlan(
  tasks: readonly Record<string, unknown>[] = [makeTask()],
  status = "approved",
) {
  return {
    id: "feature-a",
    title: "Feature A",
    goal: "Deliver Feature A",
    status,
    tasks,
  };
}

function makeInput(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    plan: makePlan(),
    taskId: "task-a",
    completedTaskIds: [],
    activeTaskIds: [],
    repositoryAllowlist: ["lib"],
    taskOwnerApprovalGranted: false,
    ...overrides,
  };
}

function reasonCodes(input: unknown): string[] {
  return evaluateDevelopmentTaskAdmission(input).reasons.map(
    (reason) => reason.code,
  );
}

function assertDeniedWith(input: unknown, code: string) {
  const decision = evaluateDevelopmentTaskAdmission(input);

  assert.equal(decision.verdict, "deny");
  assert.ok(
    decision.reasons.some((reason) => reason.code === code),
    `Expected ${code}: ${JSON.stringify(decision)}`,
  );
  return decision;
}

function makeOverlapInput(
  candidatePath: string,
  activePath: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return makeInput({
    plan: makePlan([
      makeTask("task-active", 1, { allowedPaths: [activePath] }),
      makeTask("task-candidate", 2, { allowedPaths: [candidatePath] }),
    ]),
    taskId: "task-candidate",
    activeTaskIds: ["task-active"],
    repositoryAllowlist: [candidatePath],
    ...overrides,
  });
}

function makeActivePathInput(
  activePath: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return makeInput({
    plan: makePlan([
      makeTask("task-active", 1, { allowedPaths: [activePath] }),
      makeTask("task-candidate", 2, { allowedPaths: ["lib/feature.ts"] }),
    ]),
    taskId: "task-candidate",
    activeTaskIds: ["task-active"],
    repositoryAllowlist: ["lib"],
    ...overrides,
  });
}

function assertActiveForbiddenPath(path: string) {
  const decision = assertDeniedWith(
    makeActivePathInput(path),
    "system_forbidden_path",
  );
  const reason = decision.reasons.find(
    (item) => item.code === "system_forbidden_path",
  );

  assert.equal(reason?.path, "plan.tasks[0].allowedPaths[0]");
  assert.equal(reason?.relatedTaskId, "task-active");
  assert.match(reason?.message ?? "", /Active task task-active/u);
  assert.match(reason?.message ?? "", new RegExp(path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.deepEqual(decision.conflictingTaskIds, []);
}

test("admission verdict values match the exact public contract", () => {
  assert.deepEqual(developmentTaskAdmissionVerdicts, [
    "deny",
    "require_approval",
    "allow",
  ]);
});

test("admission verdict guard and parser accept canonical values and fail closed", () => {
  for (const verdict of developmentTaskAdmissionVerdicts) {
    assert.equal(isDevelopmentTaskAdmissionVerdict(verdict), true);
    assert.equal(parseDevelopmentTaskAdmissionVerdict(verdict), verdict);
  }

  for (const invalid of ["approved", " allow ", "unknown", 1, null]) {
    assert.equal(isDevelopmentTaskAdmissionVerdict(invalid), false);
    assert.equal(parseDevelopmentTaskAdmissionVerdict(invalid), null);
  }
});

test("valid repository paths are trimmed and normalized", () => {
  assert.deepEqual(normalizeRepositoryPath("  app/workflows/page.tsx  "), {
    ok: true,
    value: "app/workflows/page.tsx",
  });
  assert.deepEqual(normalizeRepositoryPath("package.json"), {
    ok: true,
    value: "package.json",
  });
});

test("trailing slash normalization and stable deduplication preserve first path", () => {
  assert.deepEqual(normalizeRepositoryPath(" app/workflows/ "), {
    ok: true,
    value: "app/workflows",
  });

  const decision = evaluateDevelopmentTaskAdmission(
    makeInput({
      plan: makePlan([
        makeTask("task-a", 1, {
          allowedPaths: ["components/domain/", " components/domain"],
        }),
      ]),
      repositoryAllowlist: ["components", "components/"],
    }),
  );
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.normalizedAllowedPaths, ["components/domain"]);
});

test("absolute, home, dot, dotdot, backslash, and double-slash paths are rejected", () => {
  for (const path of [
    "/app/page.tsx",
    "~",
    "~/app",
    "$HOME/app",
    "${HOME}/app",
    ".",
    "app/./page.tsx",
    "app/../page.tsx",
    "app\\page.tsx",
    "app//page.tsx",
  ]) {
    assert.equal(normalizeRepositoryPath(path).ok, false, path);
  }
});

test("URL, glob, control, and shell-interpolation paths are rejected", () => {
  for (const path of [
    "https://example.com/file",
    "file:app/page.tsx",
    "app/*.tsx",
    "app/page?.tsx",
    "app/[id]",
    "app/{one,two}",
    "app\npage.tsx",
    "app\u0000page.tsx",
    "app/$(whoami)",
    "app/`whoami`",
  ]) {
    assert.equal(normalizeRepositoryPath(path).ok, false, path);
  }
});

test("repository containment is segment-aware", () => {
  assert.equal(repositoryPathContains("app", "app"), true);
  assert.equal(repositoryPathContains("app", "app/page.tsx"), true);
  assert.equal(
    repositoryPathContains("app", "app/workflows/run/page.tsx"),
    true,
  );
  assert.equal(repositoryPathContains("app", "app-old"), false);
  assert.equal(repositoryPathContains("app", "application"), false);
  assert.equal(repositoryPathContains("app/page.tsx", "app"), false);
});

test("repository path overlap detects equal, parent, and child policies", () => {
  assert.equal(repositoryPathsOverlap("app", "app"), true);
  assert.equal(repositoryPathsOverlap("app", "app/workflows"), true);
  assert.equal(repositoryPathsOverlap("app/workflows", "app"), true);
});

test("repository path overlap has no app versus app-old false positive", () => {
  assert.equal(repositoryPathsOverlap("app", "app-old"), false);
  assert.equal(repositoryPathsOverlap("app", "application"), false);
});

test("low and medium P2-P4 tasks can be admitted without approval", () => {
  for (const riskLevel of ["low", "medium"]) {
    for (const priority of ["P2", "P3", "P4"]) {
      const decision = evaluateDevelopmentTaskAdmission(
        makeInput({
          plan: makePlan([
            makeTask("task-a", 1, {
              riskLevel,
              priority,
              requiresOwnerApproval: false,
            }),
          ]),
        }),
      );

      assert.equal(decision.verdict, "allow", `${riskLevel}/${priority}`);
      assert.equal(decision.ownerApprovalRequired, false);
      assert.equal(decision.ownerApprovalSatisfied, false);
      assert.deepEqual(decision.reasons, []);
    }
  }
});

test("invalid FeaturePlan is denied", () => {
  assertDeniedWith(makeInput({ plan: makePlan([]) }), "invalid_plan");
});

test("invalid and unknown task IDs are denied separately", () => {
  assertDeniedWith(makeInput({ taskId: "Task A" }), "invalid_task_id");
  assertDeniedWith(makeInput({ taskId: "task-unknown" }), "unknown_task_id");
});

test("plans outside approved and in_progress are denied", () => {
  for (const status of [
    "draft",
    "awaiting_approval",
    "blocked",
    "completed",
    "cancelled",
  ]) {
    assertDeniedWith(
      makeInput({ plan: makePlan([makeTask()], status) }),
      "plan_not_approved",
    );
  }
});

test("an already completed candidate is denied", () => {
  assertDeniedWith(
    makeInput({ completedTaskIds: ["task-a"] }),
    "task_already_completed",
  );
});

test("an already active candidate is denied", () => {
  assertDeniedWith(
    makeInput({ activeTaskIds: ["task-a"] }),
    "task_already_active",
  );
});

test("a candidate with incomplete dependencies is denied", () => {
  const plan = makePlan([
    makeTask("task-a", 1),
    makeTask("task-b", 2, { dependencyIds: ["task-a"] }),
  ]);

  assertDeniedWith(
    makeInput({ plan, taskId: "task-b" }),
    "task_dependencies_incomplete",
  );
});

test("an inconsistent completed dependency closure is denied", () => {
  const plan = makePlan([
    makeTask("task-a", 1),
    makeTask("task-b", 2, { dependencyIds: ["task-a"] }),
    makeTask("task-c", 3, { dependencyIds: ["task-b"] }),
  ]);
  const decision = assertDeniedWith(
    makeInput({
      plan,
      taskId: "task-c",
      completedTaskIds: ["task-b"],
    }),
    "inconsistent_completed_task_state",
  );

  assert.doesNotMatch(
    JSON.stringify(decision),
    /"verdict":"(?:allow|require_approval)"/u,
  );
});

test("unknown completed task IDs are denied as invalid collection state", () => {
  assertDeniedWith(
    makeInput({ completedTaskIds: ["task-unknown"] }),
    "invalid_completed_task_ids",
  );
});

test("an unknown active task ID is denied", () => {
  assertDeniedWith(
    makeInput({ activeTaskIds: ["task-unknown"] }),
    "unknown_active_task_id",
  );
});

test("a task marked both completed and active is denied", () => {
  const decision = assertDeniedWith(
    makeInput({
      completedTaskIds: ["task-a"],
      activeTaskIds: ["task-a"],
    }),
    "completed_task_marked_active",
  );

  assert.ok(
    decision.reasons.some((reason) => reason.code === "task_already_completed"),
  );
  assert.ok(
    decision.reasons.some((reason) => reason.code === "task_already_active"),
  );
});

test("invalid serialized collections are denied", () => {
  const decision = evaluateDevelopmentTaskAdmission(
    makeInput({
      completedTaskIds: new Set<string>(),
      activeTaskIds: "task-a",
      repositoryAllowlist: "lib",
    }),
  );

  assert.equal(decision.verdict, "deny");
  assert.deepEqual(reasonCodes({
    ...makeInput(),
    completedTaskIds: new Set<string>(),
    activeTaskIds: "task-a",
    repositoryAllowlist: "lib",
  }), [
    "invalid_completed_task_ids",
    "invalid_active_task_ids",
    "invalid_repository_allowlist",
  ]);
});

test("non-boolean Owner approval is denied without coercion", () => {
  for (const value of ["true", 1, 0, null]) {
    assertDeniedWith(
      makeInput({ taskOwnerApprovalGranted: value }),
      "invalid_owner_approval",
    );
  }
});

test("candidate paths outside the repository allowlist are denied", () => {
  const decision = assertDeniedWith(
    makeInput({ repositoryAllowlist: ["app"] }),
    "path_outside_repository_allowlist",
  );

  assert.deepEqual(decision.normalizedAllowedPaths, ["lib/feature.ts"]);
});

test("invalid task repository paths are denied", () => {
  assertDeniedWith(
    makeInput({
      plan: makePlan([
        makeTask("task-a", 1, { allowedPaths: ["app//page.tsx"] }),
      ]),
      repositoryAllowlist: ["app"],
    }),
    "invalid_repository_path",
  );
});

test("invalid repository allowlist paths are denied", () => {
  assertDeniedWith(
    makeInput({ repositoryAllowlist: ["app/**"] }),
    "invalid_repository_allowlist",
  );
});

test("system forbidden roots and secret configuration segments are denied", () => {
  const forbiddenPaths = [
    ".git",
    ".git/config",
    "node_modules/pkg",
    ".next/cache",
    ".env",
    ".env.local",
    "config/.env.production",
    "services/api/.npmrc",
  ];

  for (const path of forbiddenPaths) {
    assert.equal(isSystemForbiddenRepositoryPath(path), true, path);
    assertDeniedWith(
      makeInput({
        plan: makePlan([makeTask("task-a", 1, { allowedPaths: [path] })]),
        repositoryAllowlist: [path],
      }),
      "system_forbidden_path",
    );
  }
});

test("Owner approval never overrides a system forbidden path", () => {
  const decision = assertDeniedWith(
    makeInput({
      plan: makePlan([
        makeTask("task-a", 1, {
          allowedPaths: ["node_modules/pkg"],
          riskLevel: "critical",
          priority: "P0",
          requiresOwnerApproval: true,
        }),
      ]),
      repositoryAllowlist: ["node_modules"],
      taskOwnerApprovalGranted: true,
    }),
    "system_forbidden_path",
  );

  assert.equal(decision.verdict, "deny");
});

test("a task-level Owner approval declaration requires approval", () => {
  const decision = evaluateDevelopmentTaskAdmission(
    makeInput({
      plan: makePlan([
        makeTask("task-a", 1, { requiresOwnerApproval: true }),
      ]),
    }),
  );

  assert.equal(decision.verdict, "require_approval");
  assert.deepEqual(reasonCodes(makeInput({
    plan: makePlan([makeTask("task-a", 1, { requiresOwnerApproval: true })]),
  })), ["task_declares_owner_approval"]);
});

test("high and critical risk require Owner approval", () => {
  for (const riskLevel of ["high", "critical"]) {
    const input = makeInput({
      plan: makePlan([makeTask("task-a", 1, { riskLevel })]),
    });
    const decision = evaluateDevelopmentTaskAdmission(input);

    assert.equal(decision.verdict, "require_approval");
    assert.deepEqual(reasonCodes(input), ["risk_requires_owner_approval"]);
  }
});

test("P0 and P1 priority require Owner approval", () => {
  for (const priority of ["P0", "P1"]) {
    const input = makeInput({
      plan: makePlan([makeTask("task-a", 1, { priority })]),
    });
    const decision = evaluateDevelopmentTaskAdmission(input);

    assert.equal(decision.verdict, "require_approval");
    assert.deepEqual(reasonCodes(input), ["priority_requires_owner_approval"]);
  }
});

test("every sensitive path policy requires Owner approval", () => {
  for (const path of sensitiveRepositoryPathPolicies) {
    assert.equal(isSensitiveRepositoryPath(path), true, path);
    const input = makeInput({
      plan: makePlan([makeTask("task-a", 1, { allowedPaths: [path] })]),
      repositoryAllowlist: [path],
    });
    const decision = evaluateDevelopmentTaskAdmission(input);

    assert.equal(decision.verdict, "require_approval", path);
    assert.ok(
      decision.reasons.some(
        (reason) => reason.code === "sensitive_path_requires_owner_approval",
      ),
      path,
    );
  }
});

test("all approval triggers are returned in stable policy order", () => {
  const decision = evaluateDevelopmentTaskAdmission(
    makeInput({
      plan: makePlan([
        makeTask("task-a", 1, {
          allowedPaths: ["package.json"],
          riskLevel: "critical",
          priority: "P0",
          requiresOwnerApproval: true,
        }),
      ]),
      repositoryAllowlist: ["package.json"],
    }),
  );

  assert.equal(decision.verdict, "require_approval");
  assert.deepEqual(
    decision.reasons.map((reason) => reason.code),
    [
      "task_declares_owner_approval",
      "risk_requires_owner_approval",
      "priority_requires_owner_approval",
      "sensitive_path_requires_owner_approval",
    ],
  );
  assert.equal(decision.ownerApprovalRequired, true);
  assert.equal(decision.ownerApprovalSatisfied, false);
});

test("granted Owner approval changes require_approval to admission allow", () => {
  const decision = evaluateDevelopmentTaskAdmission(
    makeInput({
      plan: makePlan([
        makeTask("task-a", 1, {
          allowedPaths: ["package.json"],
          riskLevel: "critical",
          priority: "P0",
          requiresOwnerApproval: true,
        }),
      ]),
      repositoryAllowlist: ["package.json"],
      taskOwnerApprovalGranted: true,
    }),
  );

  assert.equal(decision.verdict, "allow");
  assert.equal(decision.ownerApprovalRequired, true);
  assert.equal(decision.ownerApprovalSatisfied, true);
  assert.deepEqual(decision.reasons, []);
});

test("active path overlap denies admission even when approval was granted", () => {
  const decision = assertDeniedWith(
    makeOverlapInput("components/domain", "components/domain", {
      plan: makePlan([
        makeTask("task-active", 1, { allowedPaths: ["components/domain"] }),
        makeTask("task-candidate", 2, {
          allowedPaths: ["components/domain"],
          riskLevel: "critical",
          requiresOwnerApproval: true,
        }),
      ]),
      taskOwnerApprovalGranted: true,
    }),
    "active_task_path_overlap",
  );

  assert.equal(decision.verdict, "deny");
});

test("exact, parent, and child active path overlaps are denied", () => {
  for (const [candidatePath, activePath] of [
    ["components/domain", "components/domain"],
    ["components", "components/domain"],
    ["components/domain", "components"],
  ] as const) {
    const decision = assertDeniedWith(
      makeOverlapInput(candidatePath, activePath),
      "active_task_path_overlap",
    );
    assert.deepEqual(decision.conflictingTaskIds, ["task-active"]);
  }
});

test("non-overlapping active paths do not block admission", () => {
  const decision = evaluateDevelopmentTaskAdmission(
    makeOverlapInput("components/candidate", "lib/active"),
  );

  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.conflictingTaskIds, []);
});

test("active .git/config path denies a non-overlapping candidate", () => {
  assertActiveForbiddenPath(".git/config");
});

test("active .env.local path denies a non-overlapping candidate", () => {
  assertActiveForbiddenPath(".env.local");
});

test("active nested .env.production path denies a non-overlapping candidate", () => {
  assertActiveForbiddenPath("config/.env.production");
});

test("active nested .npmrc path denies a non-overlapping candidate", () => {
  assertActiveForbiddenPath("services/api/.npmrc");
});

test("active node_modules path denies a non-overlapping candidate", () => {
  assertActiveForbiddenPath("node_modules/pkg");
});

test("active .next path denies a non-overlapping candidate", () => {
  assertActiveForbiddenPath(".next/cache");
});

test("granted Owner approval cannot override an active forbidden path", () => {
  const decision = assertDeniedWith(
    makeActivePathInput(".git/config", {
      plan: makePlan([
        makeTask("task-active", 1, { allowedPaths: [".git/config"] }),
        makeTask("task-candidate", 2, {
          allowedPaths: ["lib/feature.ts"],
          riskLevel: "critical",
          requiresOwnerApproval: true,
        }),
      ]),
      taskOwnerApprovalGranted: true,
    }),
    "system_forbidden_path",
  );

  assert.equal(decision.verdict, "deny");
  assert.equal(decision.reasons[0]?.relatedTaskId, "task-active");
});

test("multiple active forbidden paths are ordered by task then normalized path", () => {
  const plan = makePlan([
    makeTask("task-z", 30, {
      allowedPaths: [".git/config", ".env.local"],
    }),
    makeTask("task-candidate", 40, { allowedPaths: ["lib/feature.ts"] }),
    makeTask("task-b", 20, { allowedPaths: [".next/cache"] }),
    makeTask("task-a", 10, { allowedPaths: ["node_modules/pkg"] }),
  ]);
  const decision = evaluateDevelopmentTaskAdmission(
    makeInput({
      plan,
      taskId: "task-candidate",
      activeTaskIds: ["task-z", "task-a", "task-b"],
      repositoryAllowlist: ["lib"],
    }),
  );

  assert.equal(decision.verdict, "deny");
  assert.deepEqual(
    decision.reasons.map((reason) => ({
      code: reason.code,
      path: reason.path,
      relatedTaskId: reason.relatedTaskId,
    })),
    [
      {
        code: "system_forbidden_path",
        path: "plan.tasks[3].allowedPaths[0]",
        relatedTaskId: "task-a",
      },
      {
        code: "system_forbidden_path",
        path: "plan.tasks[2].allowedPaths[0]",
        relatedTaskId: "task-b",
      },
      {
        code: "system_forbidden_path",
        path: "plan.tasks[0].allowedPaths[1]",
        relatedTaskId: "task-z",
      },
      {
        code: "system_forbidden_path",
        path: "plan.tasks[0].allowedPaths[0]",
        relatedTaskId: "task-z",
      },
    ],
  );
});

test("active forbidden-path near matches do not create false positives", () => {
  for (const path of [
    ".git-safe",
    "node_modules-safe",
    ".next-cache",
    ".environment",
    ".envrc",
    ".npmrc-backup",
  ]) {
    const decision = evaluateDevelopmentTaskAdmission(makeActivePathInput(path));

    assert.equal(decision.verdict, "allow", path);
    assert.equal(
      decision.reasons.some((reason) => reason.code === "system_forbidden_path"),
      false,
      path,
    );
  }
});

test("invalid active-task paths remain denied with relatedTaskId", () => {
  const decision = assertDeniedWith(
    makeActivePathInput("app//invalid"),
    "invalid_repository_path",
  );
  const reason = decision.reasons.find(
    (item) => item.code === "invalid_repository_path",
  );

  assert.equal(reason?.path, "plan.tasks[0].allowedPaths[0]");
  assert.equal(reason?.relatedTaskId, "task-active");
});

test("active sensitive paths are not denied when they do not overlap", () => {
  const decision = evaluateDevelopmentTaskAdmission(
    makeActivePathInput("app/api"),
  );

  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.reasons, []);
});

test("candidate repository allowlist is not applied to active task paths", () => {
  const decision = evaluateDevelopmentTaskAdmission(
    makeActivePathInput("components/active"),
  );

  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.reasons, []);
});

test("multiple path conflicts are sorted by task sequence and ID", () => {
  const plan = makePlan([
    makeTask("task-z", 30, { allowedPaths: ["components/z"] }),
    makeTask("task-candidate", 40, { allowedPaths: ["components"] }),
    makeTask("task-b", 20, { allowedPaths: ["components/b"] }),
    makeTask("task-a", 10, { allowedPaths: ["components/a"] }),
  ]);

  const decision = evaluateDevelopmentTaskAdmission(
    makeInput({
      plan,
      taskId: "task-candidate",
      activeTaskIds: ["task-z", "task-b", "task-a"],
      repositoryAllowlist: ["components"],
    }),
  );

  assert.equal(decision.verdict, "deny");
  assert.deepEqual(decision.conflictingTaskIds, ["task-a", "task-b", "task-z"]);
  assert.deepEqual(
    decision.reasons.map((reason) => reason.relatedTaskId),
    ["task-a", "task-b", "task-z"],
  );
});

test("sharing a dependency wave does not permit overlapping active paths", () => {
  const plan = makePlan([
    makeTask("task-a", 1, { allowedPaths: ["components/domain"] }),
    makeTask("task-b", 2, { allowedPaths: ["components/domain/card.tsx"] }),
  ]);

  assertDeniedWith(
    makeInput({
      plan,
      taskId: "task-b",
      activeTaskIds: ["task-a"],
      repositoryAllowlist: ["components"],
    }),
    "active_task_path_overlap",
  );
});

test("hostile input never throws and fails closed", () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("getter must not escape");
      },
    },
  );

  assert.doesNotThrow(() => evaluateDevelopmentTaskAdmission(hostile));
  assert.deepEqual(evaluateDevelopmentTaskAdmission(hostile), {
    verdict: "deny",
    taskId: null,
    reasons: [
      {
        code: "invalid_input",
        path: "$",
        message: "DevelopmentTaskAdmissionInput could not be safely inspected.",
      },
    ],
    normalizedAllowedPaths: [],
    conflictingTaskIds: [],
    ownerApprovalRequired: false,
    ownerApprovalSatisfied: false,
  });
});

test("admission evaluation does not mutate input, plan, or arrays", () => {
  const input = makeInput({
    plan: makePlan([
      makeTask("task-b", 2, {
        dependencyIds: ["task-a"],
        allowedPaths: [" components/domain/ "],
      }),
      makeTask("task-a", 1),
    ]),
    taskId: " task-b ",
    completedTaskIds: [" task-a ", "task-a"],
    activeTaskIds: [],
    repositoryAllowlist: [" components ", "components/"],
  });
  const snapshot = structuredClone(input);

  evaluateDevelopmentTaskAdmission(input);

  assert.deepEqual(input, snapshot);
});

test("the same input produces a deepEqual deterministic decision", () => {
  const input = makeInput({
    plan: makePlan([
      makeTask("task-active", 1, { allowedPaths: ["components/domain"] }),
      makeTask("task-a", 2, { allowedPaths: ["components"] }),
    ]),
    activeTaskIds: ["task-active"],
    repositoryAllowlist: ["components"],
  });

  assert.deepEqual(
    evaluateDevelopmentTaskAdmission(input),
    evaluateDevelopmentTaskAdmission(structuredClone(input)),
  );
});

test("path, collection, and reason limits enforce exact boundaries", () => {
  const pathAtLimit = "a".repeat(developmentTaskAdmissionLimits.maxPathLength);
  assert.deepEqual(normalizeRepositoryPath(pathAtLimit), {
    ok: true,
    value: pathAtLimit,
  });
  assert.equal(
    normalizeRepositoryPath(`${pathAtLimit}a`).ok,
    false,
  );

  const allowlistAtLimit = Array.from(
    { length: developmentTaskAdmissionLimits.maxCollectionItems },
    () => "lib",
  );
  assert.equal(
    evaluateDevelopmentTaskAdmission(
      makeInput({ repositoryAllowlist: allowlistAtLimit }),
    ).verdict,
    "allow",
  );
  assertDeniedWith(
    makeInput({ repositoryAllowlist: [...allowlistAtLimit, "lib"] }),
    "invalid_repository_allowlist",
  );

  const invalidTasks = Array.from(
    { length: developmentTaskAdmissionLimits.maxCollectionItems },
    () => ({}),
  );
  const capped = evaluateDevelopmentTaskAdmission(
    makeInput({ plan: makePlan(invalidTasks) }),
  );
  assert.equal(capped.verdict, "deny");
  assert.equal(
    capped.reasons.length,
    developmentTaskAdmissionLimits.maxReasons,
  );
});
