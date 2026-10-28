import assert from "node:assert/strict";
import test from "node:test";

const developmentPlanModule = (await import(
  new URL("../lib/contracts/development-plan.ts", import.meta.url).href
)) as typeof import("../lib/contracts/development-plan");

const {
  buildDevelopmentTaskWaves,
  developmentPlanLimits,
  developmentPriorities,
  featurePlanStatuses,
  findEligibleDevelopmentTaskIds,
  isDevelopmentPriority,
  isFeaturePlanStatus,
  parseDevelopmentPriority,
  parseFeaturePlanStatus,
  validateAndNormalizeFeaturePlan,
} = developmentPlanModule;

function makeTask(
  id: string,
  sequence: number,
  dependencyIds: readonly string[] = [],
) {
  return {
    id,
    sequence,
    title: `Implement ${id}`,
    goal: `Deliver ${id}`,
    scope: [`Scope ${id}`],
    nonGoals: [],
    allowedPaths: [`lib/${id}.ts`],
    acceptanceCriteria: [`${id} is deterministic`],
    verificationCommands: ["npm test"],
    dependencyIds: [...dependencyIds],
    riskLevel: "medium",
    priority: "P3",
    requiresOwnerApproval: true,
  };
}

function makePlan(
  tasks: readonly Record<string, unknown>[] = [makeTask("task-a", 1)],
) {
  return {
    id: "feature-a",
    title: "Feature A",
    goal: "Deliver Feature A",
    status: "approved",
    tasks,
  };
}

function makeChainPlan() {
  return makePlan([
    makeTask("task-c", 3, ["task-b"]),
    makeTask("task-a", 1),
    makeTask("task-b", 2, ["task-a"]),
  ]);
}

function requireValid(input: unknown = makePlan()) {
  const result = validateAndNormalizeFeaturePlan(input);

  if (!result.ok) {
    throw new Error(`Expected a valid plan: ${JSON.stringify(result.errors)}`);
  }

  assert.equal(result.ok, true);
  return result.value;
}

function requireInvalid(input: unknown) {
  const result = validateAndNormalizeFeaturePlan(input);

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("Expected plan validation to fail.");
  }

  return result.errors;
}

function assertHasError(
  errors: readonly { code: string; path: string }[],
  code: string,
  path?: string,
) {
  assert.ok(
    errors.some(
      (error) => error.code === code && (path === undefined || error.path === path),
    ),
    `Expected ${code}${path ? ` at ${path}` : ""}: ${JSON.stringify(errors)}`,
  );
}

test("FeaturePlanStatus values match the exact lifecycle contract", () => {
  assert.deepEqual(featurePlanStatuses, [
    "draft",
    "awaiting_approval",
    "approved",
    "in_progress",
    "blocked",
    "completed",
    "cancelled",
  ]);
});

test("DevelopmentPriority values match the exact priority contract", () => {
  assert.deepEqual(developmentPriorities, ["P0", "P1", "P2", "P3", "P4"]);
});

test("FeaturePlanStatus guard and parser accept canonical values and fail closed", () => {
  for (const status of featurePlanStatuses) {
    assert.equal(isFeaturePlanStatus(status), true);
    assert.equal(parseFeaturePlanStatus(status), status);
  }

  for (const invalid of ["waiting_approval", " approved ", "unknown", 1, null]) {
    assert.equal(isFeaturePlanStatus(invalid), false);
    assert.equal(parseFeaturePlanStatus(invalid), null);
  }
});

test("DevelopmentPriority guard and parser accept canonical values and fail closed", () => {
  for (const priority of developmentPriorities) {
    assert.equal(isDevelopmentPriority(priority), true);
    assert.equal(parseDevelopmentPriority(priority), priority);
  }

  for (const invalid of ["p0", " P1 ", "urgent", 0, null]) {
    assert.equal(isDevelopmentPriority(invalid), false);
    assert.equal(parseDevelopmentPriority(invalid), null);
  }
});

test("a complete valid FeaturePlan returns all typed task fields", () => {
  const input = makePlan([
    {
      ...makeTask("task-a", 1),
      nonGoals: ["No persistence"],
      riskLevel: "critical",
      priority: "P2",
      requiresOwnerApproval: false,
    },
  ]);
  const value = requireValid(input);

  assert.deepEqual(value, input);
  assert.equal(value.tasks[0]?.riskLevel, "critical");
  assert.equal(value.tasks[0]?.requiresOwnerApproval, false);
});

test("validation trims strings and normalizes CRLF and CR to LF", () => {
  const input = {
    ...makePlan(),
    id: " feature-a ",
    title: "  Feature\r\nA  ",
    goal: " Goal one\rGoal two ",
    status: " approved ",
    tasks: [
      {
        ...makeTask("task-a", 1),
        title: " Task\r\nA ",
        goal: " Goal\rA ",
        scope: [" Scope\r\nline "],
        riskLevel: " critical ",
        priority: " P2 ",
      },
    ],
  };
  const value = requireValid(input);

  assert.equal(value.id, "feature-a");
  assert.equal(value.title, "Feature\nA");
  assert.equal(value.goal, "Goal one\nGoal two");
  assert.equal(value.tasks[0]?.title, "Task\nA");
  assert.deepEqual(value.tasks[0]?.scope, ["Scope\nline"]);
  assert.equal(value.tasks[0]?.riskLevel, "critical");
  assert.equal(value.tasks[0]?.priority, "P2");
});

test("lists drop empty values and deduplicate in first-seen order", () => {
  const input = makePlan([
    {
      ...makeTask("task-c", 3, [" task-a ", "", "task-b", "task-a"]),
      scope: [" First ", "", "Second", "First", "  "],
      nonGoals: ["None", "None", ""],
      allowedPaths: [" lib/a.ts ", "lib/b.ts", "lib/a.ts"],
      acceptanceCriteria: ["Pass", "Pass", "Stable"],
      verificationCommands: ["npm test", "", "npm test", "npm run lint"],
    },
    makeTask("task-a", 1),
    makeTask("task-b", 2),
  ]);
  const value = requireValid(input);
  const task = value.tasks[0];

  assert.deepEqual(task?.scope, ["First", "Second"]);
  assert.deepEqual(task?.nonGoals, ["None"]);
  assert.deepEqual(task?.allowedPaths, ["lib/a.ts", "lib/b.ts"]);
  assert.deepEqual(task?.acceptanceCriteria, ["Pass", "Stable"]);
  assert.deepEqual(task?.verificationCommands, ["npm test", "npm run lint"]);
  assert.deepEqual(task?.dependencyIds, ["task-a", "task-b"]);
});

test("validation does not mutate its input", () => {
  const input = makePlan([
    {
      ...makeTask("task-b", 2, [" task-a ", "task-a"]),
      scope: [" Scope ", "Scope"],
    },
    makeTask("task-a", 1),
  ]);
  const snapshot = structuredClone(input);

  requireValid(input);

  assert.deepEqual(input, snapshot);
});

test("plan and task IDs must use the lowercase safe format", () => {
  assertHasError(requireInvalid({ ...makePlan(), id: "Feature-A" }), "invalid_id", "id");
  assertHasError(
    requireInvalid(makePlan([{ ...makeTask("task-a", 1), id: "Task A" }])),
    "invalid_id",
    "tasks[0].id",
  );
});

test("a plan must contain at least one task", () => {
  assertHasError(requireInvalid(makePlan([])), "required", "tasks");
});

test("plan and task titles and goals must remain non-empty after trimming", () => {
  assertHasError(
    requireInvalid({ ...makePlan(), title: " \r\n ", goal: " \r " }),
    "required",
    "title",
  );
  const errors = requireInvalid(
    makePlan([{ ...makeTask("task-a", 1), title: "  ", goal: "\r\n" }]),
  );
  assertHasError(errors, "required", "tasks[0].title");
  assertHasError(errors, "required", "tasks[0].goal");
});

test("task IDs must be unique", () => {
  const errors = requireInvalid(
    makePlan([makeTask("task-a", 1), makeTask("task-a", 2)]),
  );

  assertHasError(errors, "duplicate_task_id", "tasks[1].id");
});

test("task sequences must be unique", () => {
  const errors = requireInvalid(
    makePlan([makeTask("task-a", 1), makeTask("task-b", 1)]),
  );

  assertHasError(errors, "duplicate_sequence", "tasks[1].sequence");
});

test("task sequence must be a positive safe integer", () => {
  for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    const errors = requireInvalid(
      makePlan([{ ...makeTask("task-a", 1), sequence }]),
    );
    assertHasError(errors, "invalid_sequence", "tasks[0].sequence");
  }
});

test("required task lists reject empty normalized content while nonGoals may be empty", () => {
  for (const field of [
    "scope",
    "allowedPaths",
    "acceptanceCriteria",
    "verificationCommands",
  ] as const) {
    const errors = requireInvalid(
      makePlan([{ ...makeTask("task-a", 1), [field]: ["", "  "] }]),
    );
    assertHasError(errors, "required", `tasks[0].${field}`);
  }

  assert.deepEqual(requireValid(makePlan()).tasks[0]?.nonGoals, []);
});

test("missing dependencies fail closed with a structured path", () => {
  const errors = requireInvalid(
    makePlan([makeTask("task-a", 1, ["task-missing"])]),
  );

  assertHasError(
    errors,
    "missing_dependency",
    "tasks[0].dependencyIds[0]",
  );
});

test("dependency IDs must use the lowercase safe format", () => {
  const errors = requireInvalid(
    makePlan([makeTask("task-a", 1, ["Task A"])]),
  );

  assertHasError(errors, "invalid_id", "tasks[0].dependencyIds[0]");
});

test("self-dependency fails closed", () => {
  const errors = requireInvalid(
    makePlan([makeTask("task-a", 1, ["task-a"])]),
  );

  assertHasError(errors, "self_dependency", "tasks[0].dependencyIds[0]");
});

test("a direct dependency cycle fails closed", () => {
  const errors = requireInvalid(
    makePlan([
      makeTask("task-a", 1, ["task-b"]),
      makeTask("task-b", 2, ["task-a"]),
    ]),
  );

  assertHasError(errors, "dependency_cycle");
});

test("a multi-step dependency cycle fails closed", () => {
  const errors = requireInvalid(
    makePlan([
      makeTask("task-a", 1, ["task-b"]),
      makeTask("task-b", 2, ["task-c"]),
      makeTask("task-c", 3, ["task-a"]),
    ]),
  );

  assertHasError(errors, "dependency_cycle");
});

test("canonical critical risk is accepted and legacy blocked risk is rejected", () => {
  assert.equal(
    validateAndNormalizeFeaturePlan(
      makePlan([{ ...makeTask("task-a", 1), riskLevel: "critical" }]),
    ).ok,
    true,
  );

  const errors = requireInvalid(
    makePlan([{ ...makeTask("task-a", 1), riskLevel: "blocked" }]),
  );
  assertHasError(errors, "invalid_risk_level", "tasks[0].riskLevel");
});

test("unknown plan status and task priority are rejected fail closed", () => {
  assertHasError(
    requireInvalid({ ...makePlan(), status: "waiting_approval" }),
    "invalid_status",
    "status",
  );
  assertHasError(
    requireInvalid(
      makePlan([{ ...makeTask("task-a", 1), priority: "urgent" }]),
    ),
    "invalid_priority",
    "tasks[0].priority",
  );
});

test("requiresOwnerApproval rejects strings and numbers without coercion", () => {
  for (const requiresOwnerApproval of ["true", 1, 0, null]) {
    const errors = requireInvalid(
      makePlan([
        { ...makeTask("task-a", 1), requiresOwnerApproval },
      ]),
    );
    assertHasError(errors, "invalid_type", "tasks[0].requiresOwnerApproval");
  }
});

test("hostile or otherwise invalid unknown input never throws", () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("getter must not escape");
      },
    },
  );

  assert.doesNotThrow(() => validateAndNormalizeFeaturePlan(hostile));
  const result = validateAndNormalizeFeaturePlan(hostile);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assertHasError(result.errors, "invalid_input", "$");
  }
});

test("linear dependencies produce one sequence-ordered task per wave", () => {
  const result = buildDevelopmentTaskWaves(
    makePlan([
      makeTask("task-c", 30, ["task-b"]),
      makeTask("task-a", 10),
      makeTask("task-b", 20, ["task-a"]),
    ]),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.value.map((wave) => wave.map((task) => task.id)),
      [["task-a"], ["task-b"], ["task-c"]],
    );
  }
});

test("branching dependencies produce stable sequence-ordered waves", () => {
  const result = buildDevelopmentTaskWaves(
    makePlan([
      makeTask("task-d", 40, ["task-c", "task-b"]),
      makeTask("task-c", 30, ["task-a"]),
      makeTask("task-a", 10),
      makeTask("task-b", 20, ["task-a"]),
    ]),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.value.map((wave) => wave.map((task) => task.id)),
      [["task-a"], ["task-b", "task-c"], ["task-d"]],
    );
  }
});

test("invalid plans never produce partial dependency waves", () => {
  const result = buildDevelopmentTaskWaves(
    makePlan([
      makeTask("task-a", 1),
      makeTask("task-b", 2, ["task-missing"]),
    ]),
  );

  assert.equal(result.ok, false);
  assert.equal("value" in result, false);
});

test("validation, waves, and error ordering are deterministic", () => {
  const validInput = makePlan([
    makeTask("task-c", 3, ["task-a"]),
    makeTask("task-a", 1),
    makeTask("task-b", 2, ["task-a"]),
  ]);
  const invalidInput = makePlan([
    makeTask("task-a", 1, ["task-missing"]),
    makeTask("task-b", 2, ["task-b"]),
  ]);

  assert.deepEqual(
    validateAndNormalizeFeaturePlan(validInput),
    validateAndNormalizeFeaturePlan(structuredClone(validInput)),
  );
  assert.deepEqual(
    buildDevelopmentTaskWaves(validInput),
    buildDevelopmentTaskWaves(structuredClone(validInput)),
  );
  assert.deepEqual(
    validateAndNormalizeFeaturePlan(invalidInput),
    validateAndNormalizeFeaturePlan(structuredClone(invalidInput)),
  );
});

test("approved plans expose only incomplete tasks whose dependencies are complete", () => {
  const plan = makePlan([
    makeTask("task-d", 40, ["task-b", "task-c"]),
    makeTask("task-c", 30, ["task-a"]),
    makeTask("task-a", 10),
    makeTask("task-b", 20, ["task-a"]),
  ]);

  assert.deepEqual(findEligibleDevelopmentTaskIds(plan, new Set()), {
    ok: true,
    value: ["task-a"],
  });
  assert.deepEqual(
    findEligibleDevelopmentTaskIds(plan, new Set(["task-a"])),
    { ok: true, value: ["task-b", "task-c"] },
  );
  assert.deepEqual(
    findEligibleDevelopmentTaskIds(
      plan,
      new Set(["task-a", "task-b", "task-c"]),
    ),
    { ok: true, value: ["task-d"] },
  );
});

test("completed task B without dependency A fails closed", () => {
  const result = findEligibleDevelopmentTaskIds(
    makeChainPlan(),
    new Set(["task-b"]),
  );

  assert.deepEqual(result, {
    ok: false,
    errors: [
      {
        code: "inconsistent_completed_task_state",
        path: "completedTaskIds",
        message: "Completed task task-b depends on incomplete task task-a.",
      },
    ],
  });
  assert.equal("value" in result, false);
});

test("completed task C without dependency B fails closed", () => {
  const result = findEligibleDevelopmentTaskIds(
    makeChainPlan(),
    new Set(["task-c"]),
  );

  assert.deepEqual(result, {
    ok: false,
    errors: [
      {
        code: "inconsistent_completed_task_state",
        path: "completedTaskIds",
        message: "Completed task task-c depends on incomplete task task-b.",
      },
    ],
  });
});

test("completed tasks A and C without B fail closed", () => {
  const result = findEligibleDevelopmentTaskIds(
    makeChainPlan(),
    new Set(["task-a", "task-c"]),
  );

  assert.deepEqual(result, {
    ok: false,
    errors: [
      {
        code: "inconsistent_completed_task_state",
        path: "completedTaskIds",
        message: "Completed task task-c depends on incomplete task task-b.",
      },
    ],
  });
});

test("completed tasks A and B make only C eligible", () => {
  assert.deepEqual(
    findEligibleDevelopmentTaskIds(
      makeChainPlan(),
      new Set(["task-a", "task-b"]),
    ),
    { ok: true, value: ["task-c"] },
  );
});

test("branching completed state reports missing dependencies in task order", () => {
  const plan = makePlan([
    makeTask("task-d", 40, ["task-c", "task-b"]),
    makeTask("task-c", 30, ["task-a"]),
    makeTask("task-a", 10),
    makeTask("task-b", 20, ["task-a"]),
  ]);
  const result = findEligibleDevelopmentTaskIds(plan, new Set(["task-d"]));

  assert.deepEqual(result, {
    ok: false,
    errors: [
      {
        code: "inconsistent_completed_task_state",
        path: "completedTaskIds",
        message: "Completed task task-d depends on incomplete task task-b.",
      },
      {
        code: "inconsistent_completed_task_state",
        path: "completedTaskIds",
        message: "Completed task task-d depends on incomplete task task-c.",
      },
    ],
  });
});

test("completed-state errors do not depend on Set insertion order", () => {
  const plan = makePlan([
    makeTask("task-d", 4, ["task-c", "task-b"]),
    makeTask("task-c", 3, ["task-a"]),
    makeTask("task-a", 1),
    makeTask("task-b", 2, ["task-a"]),
  ]);
  const first = findEligibleDevelopmentTaskIds(
    plan,
    new Set(["task-d", "task-b"]),
  );
  const second = findEligibleDevelopmentTaskIds(
    plan,
    new Set(["task-b", "task-d"]),
  );

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    ok: false,
    errors: [
      {
        code: "inconsistent_completed_task_state",
        path: "completedTaskIds",
        message: "Completed task task-b depends on incomplete task task-a.",
      },
      {
        code: "inconsistent_completed_task_state",
        path: "completedTaskIds",
        message: "Completed task task-d depends on incomplete task task-c.",
      },
    ],
  });
});

test("completed-state closure validation does not mutate plan or Set", () => {
  const plan = makeChainPlan();
  const completed = new Set(["task-b"]);
  const planSnapshot = structuredClone(plan);
  const completedSnapshot = [...completed];

  const result = findEligibleDevelopmentTaskIds(plan, completed);

  assert.equal(result.ok, false);
  assert.deepEqual(plan, planSnapshot);
  assert.deepEqual([...completed], completedSnapshot);
});

test("in_progress plans use the same dependency readiness rules", () => {
  const plan = {
    ...makePlan([
      makeTask("task-b", 2, ["task-a"]),
      makeTask("task-a", 1),
    ]),
    status: "in_progress",
  };

  assert.deepEqual(
    findEligibleDevelopmentTaskIds(plan, new Set(["task-a"])),
    { ok: true, value: ["task-b"] },
  );
});

test("unapproved, blocked, and terminal plans expose no eligible tasks", () => {
  for (const status of [
    "draft",
    "awaiting_approval",
    "blocked",
    "completed",
    "cancelled",
  ]) {
    assert.deepEqual(
      findEligibleDevelopmentTaskIds({ ...makePlan(), status }, new Set()),
      { ok: true, value: [] },
    );
  }
});

test("unknown completed task IDs fail closed instead of being ignored", () => {
  const result = findEligibleDevelopmentTaskIds(
    makePlan(),
    new Set(["task-unknown"]),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assertHasError(result.errors, "unknown_completed_task_id", "completedTaskIds");
  }
});

test("completed task input rejects non-Set values and malformed IDs", () => {
  const nonSetResult = findEligibleDevelopmentTaskIds(
    makePlan(),
    ["task-a"] as unknown as ReadonlySet<string>,
  );
  assert.equal(nonSetResult.ok, false);
  if (!nonSetResult.ok) {
    assertHasError(nonSetResult.errors, "invalid_type", "completedTaskIds");
  }

  const malformedResult = findEligibleDevelopmentTaskIds(
    makePlan(),
    new Set(["Task A"]),
  );
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) {
    assertHasError(
      malformedResult.errors,
      "invalid_completed_task_id",
      "completedTaskIds[0]",
    );
  }
});

test("waves and readiness do not mutate plans or completed task sets", () => {
  const plan = makePlan([
    makeTask("task-b", 2, ["task-a"]),
    makeTask("task-a", 1),
  ]);
  const completed = new Set(["task-a"]);
  const planSnapshot = structuredClone(plan);
  const completedSnapshot = [...completed];

  buildDevelopmentTaskWaves(plan);
  findEligibleDevelopmentTaskIds(plan, completed);

  assert.deepEqual(plan, planSnapshot);
  assert.deepEqual([...completed], completedSnapshot);
});

test("ID, text, list item, and list count limits enforce exact boundaries", () => {
  const maxId = `a${"b".repeat(developmentPlanLimits.maxIdLength - 1)}`;
  assert.equal(validateAndNormalizeFeaturePlan({ ...makePlan(), id: maxId }).ok, true);
  assertHasError(
    requireInvalid({ ...makePlan(), id: `${maxId}c` }),
    "invalid_id",
    "id",
  );

  assert.equal(
    validateAndNormalizeFeaturePlan({
      ...makePlan(),
      title: "t".repeat(developmentPlanLimits.maxTitleLength),
      goal: "g".repeat(developmentPlanLimits.maxGoalLength),
    }).ok,
    true,
  );
  assertHasError(
    requireInvalid({
      ...makePlan(),
      title: "t".repeat(developmentPlanLimits.maxTitleLength + 1),
    }),
    "too_long",
    "title",
  );
  assertHasError(
    requireInvalid({
      ...makePlan(),
      goal: "g".repeat(developmentPlanLimits.maxGoalLength + 1),
    }),
    "too_long",
    "goal",
  );

  const atListLimits = makeTask("task-a", 1);
  atListLimits.scope = Array.from(
    { length: developmentPlanLimits.maxListItems },
    (_, index) => `scope-${index}`,
  );
  atListLimits.allowedPaths = [
    "a".repeat(developmentPlanLimits.maxListItemLength),
  ];
  assert.equal(validateAndNormalizeFeaturePlan(makePlan([atListLimits])).ok, true);

  assertHasError(
    requireInvalid(
      makePlan([
        {
          ...makeTask("task-a", 1),
          scope: Array.from(
            { length: developmentPlanLimits.maxListItems + 1 },
            (_, index) => `scope-${index}`,
          ),
        },
      ]),
    ),
    "too_many_items",
    "tasks[0].scope",
  );
  assertHasError(
    requireInvalid(
      makePlan([
        {
          ...makeTask("task-a", 1),
          allowedPaths: [
            "a".repeat(developmentPlanLimits.maxListItemLength + 1),
          ],
        },
      ]),
    ),
    "too_long",
    "tasks[0].allowedPaths[0]",
  );
});

test("task, dependency, and completed-ID count limits enforce exact boundaries", () => {
  const maximumTasks = Array.from(
    { length: developmentPlanLimits.maxTasks },
    (_, index) => makeTask(`task-${index}`, index + 1),
  );
  const maximumPlan = makePlan(maximumTasks);
  assert.equal(validateAndNormalizeFeaturePlan(maximumPlan).ok, true);

  assertHasError(
    requireInvalid(
      makePlan([
        ...maximumTasks,
        makeTask("task-over-limit", developmentPlanLimits.maxTasks + 1),
      ]),
    ),
    "too_many_items",
    "tasks",
  );

  const dependencyIds = maximumTasks
    .slice(0, developmentPlanLimits.maxDependenciesPerTask)
    .map((task) => task.id);
  const dependencyBoundaryPlan = makePlan([
    ...maximumTasks.slice(0, -1),
    makeTask(
      maximumTasks.at(-1)?.id ?? "task-last",
      developmentPlanLimits.maxTasks,
      dependencyIds,
    ),
  ]);
  assert.equal(validateAndNormalizeFeaturePlan(dependencyBoundaryPlan).ok, true);

  assertHasError(
    requireInvalid(
      makePlan([
        ...maximumTasks.slice(0, -1),
        makeTask(
          maximumTasks.at(-1)?.id ?? "task-last",
          developmentPlanLimits.maxTasks,
          [...dependencyIds, maximumTasks.at(-1)?.id ?? "task-last"],
        ),
      ]),
    ),
    "too_many_items",
    `tasks[${developmentPlanLimits.maxTasks - 1}].dependencyIds`,
  );

  const allCompleted = new Set(maximumTasks.map((task) => task.id));
  assert.deepEqual(findEligibleDevelopmentTaskIds(maximumPlan, allCompleted), {
    ok: true,
    value: [],
  });
  const overCompletedLimit = new Set([...allCompleted, "task-over-limit"]);
  const readiness = findEligibleDevelopmentTaskIds(maximumPlan, overCompletedLimit);
  assert.equal(readiness.ok, false);
  if (!readiness.ok) {
    assertHasError(readiness.errors, "too_many_items", "completedTaskIds");
  }
});
