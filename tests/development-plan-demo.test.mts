import assert from "node:assert/strict";
import test from "node:test";

const demoModule = (await import(
  new URL("../lib/development-plan-demo.ts", import.meta.url).href
)) as typeof import("../lib/development-plan-demo");
const planModule = (await import(
  new URL("../lib/contracts/development-plan.ts", import.meta.url).href
)) as typeof import("../lib/contracts/development-plan");
const policyModule = (await import(
  new URL("../lib/contracts/development-task-policy.ts", import.meta.url).href
)) as typeof import("../lib/contracts/development-task-policy");

const {
  createDevelopmentPlanDemoAdmissionInput,
  createDevelopmentPlanDemoPlan,
  developmentPlanDemoScenarioIds,
  developmentPlanDemoScenarios,
  developmentPlanDemoVerdictLabels,
  evaluateDevelopmentPlanDemoScenario,
} = demoModule;
const { buildDevelopmentTaskWaves, validateAndNormalizeFeaturePlan } =
  planModule;
const {
  developmentTaskAdmissionVerdicts,
  evaluateDevelopmentTaskAdmission,
  isSystemForbiddenRepositoryPath,
} = policyModule;

test("demo FeaturePlan passes canonical validation", () => {
  const result = validateAndNormalizeFeaturePlan(
    createDevelopmentPlanDemoPlan(),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.id, "development-plan-simulator");
    assert.equal(result.value.tasks.length, 5);
  }
});

test("canonical validation and wave building do not mutate the source fixture", () => {
  const plan = createDevelopmentPlanDemoPlan();
  const snapshot = structuredClone(plan);

  validateAndNormalizeFeaturePlan(plan);
  buildDevelopmentTaskWaves(plan);

  assert.deepEqual(plan, snapshot);
});

test("base demo plan contains no system-forbidden paths", () => {
  const plan = createDevelopmentPlanDemoPlan();

  for (const task of plan.tasks) {
    for (const path of task.allowedPaths) {
      assert.equal(
        isSystemForbiddenRepositoryPath(path),
        false,
        `${task.id} must not contain system-forbidden path ${path}`,
      );
    }
  }
});

test("dependency waves use the expected canonical order", () => {
  const result = buildDevelopmentTaskWaves(createDevelopmentPlanDemoPlan());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.value.map((wave) => wave.map((task) => task.id)),
      [
        ["repository-analysis"],
        ["feature-implementation"],
        ["unit-tests", "qa-security-review"],
        ["prepare-handoff"],
      ],
    );
  }
});

test("allow scenario returns canonical allow verdict", () => {
  const result = evaluateDevelopmentPlanDemoScenario("allow");

  assert.equal(result.decision.verdict, "allow");
  assert.deepEqual(result.decision.reasons, []);
  assert.equal(
    result.plan.tasks.some((task) => task.allowedPaths.includes(".git/config")),
    false,
  );
});

test("unfinished dependency scenario returns deny with dependency reason", () => {
  const result = evaluateDevelopmentPlanDemoScenario("dependency-blocked");

  assert.equal(result.decision.verdict, "deny");
  assert.ok(
    result.decision.reasons.some(
      (reason) => reason.code === "task_dependencies_incomplete",
    ),
  );
  assert.match(result.decision.reasons[0]?.message ?? "", /feature-implementation/u);
});

test("approval scenario requires Owner confirmation by default", () => {
  const result = evaluateDevelopmentPlanDemoScenario("approval-required");

  assert.equal(result.decision.verdict, "require_approval");
  assert.equal(result.decision.ownerApprovalRequired, true);
  assert.equal(result.decision.ownerApprovalSatisfied, false);
});

test("approval scenario becomes allow after Owner confirmation", () => {
  const result = evaluateDevelopmentPlanDemoScenario(
    "approval-required",
    true,
  );

  assert.equal(result.decision.verdict, "allow");
  assert.equal(result.decision.ownerApprovalRequired, true);
  assert.equal(result.decision.ownerApprovalSatisfied, true);
});

test("path conflict scenario returns deny and the expected conflicting task", () => {
  const result = evaluateDevelopmentPlanDemoScenario("path-conflict");

  assert.equal(result.decision.verdict, "deny");
  assert.deepEqual(result.decision.conflictingTaskIds, [
    "qa-security-review",
  ]);
  assert.ok(
    result.decision.reasons.some(
      (reason) => reason.code === "active_task_path_overlap",
    ),
  );
});

test("forbidden active path scenario returns deny", () => {
  const result = evaluateDevelopmentPlanDemoScenario(
    "forbidden-active-path",
  );

  assert.equal(result.decision.verdict, "deny");
});

test("forbidden active path exposes system_forbidden_path reason", () => {
  const result = evaluateDevelopmentPlanDemoScenario(
    "forbidden-active-path",
  );

  assert.ok(
    result.decision.reasons.some(
      (reason) =>
        reason.code === "system_forbidden_path" &&
        reason.relatedTaskId === "qa-security-review",
    ),
  );
});

test("only forbidden scenario injects .git/config into its active task", () => {
  for (const scenarioId of developmentPlanDemoScenarioIds) {
    const input = createDevelopmentPlanDemoAdmissionInput(scenarioId);
    const tasksWithForbiddenPath = input.plan.tasks.filter((task) =>
      task.allowedPaths.includes(".git/config"),
    );

    if (scenarioId === "forbidden-active-path") {
      assert.deepEqual(input.activeTaskIds, ["qa-security-review"]);
      assert.deepEqual(
        tasksWithForbiddenPath.map((task) => task.id),
        ["qa-security-review"],
      );
    } else {
      assert.deepEqual(tasksWithForbiddenPath, []);
    }
  }
});

test("Owner confirmation cannot bypass a forbidden active path", () => {
  const result = evaluateDevelopmentPlanDemoScenario(
    "forbidden-active-path",
    true,
  );

  assert.equal(result.decision.verdict, "deny");
  assert.ok(
    result.decision.reasons.some(
      (reason) => reason.code === "system_forbidden_path",
    ),
  );
});

test("forbidden scenario creation does not mutate the base plan or other scenarios", () => {
  const basePlan = createDevelopmentPlanDemoPlan();
  const allowInput = createDevelopmentPlanDemoAdmissionInput("allow");
  const baseSnapshot = structuredClone(basePlan);
  const allowSnapshot = structuredClone(allowInput);

  const forbiddenInput = createDevelopmentPlanDemoAdmissionInput(
    "forbidden-active-path",
  );

  assert.deepEqual(basePlan, baseSnapshot);
  assert.deepEqual(allowInput, allowSnapshot);
  assert.notEqual(forbiddenInput.plan, basePlan);
  assert.notEqual(forbiddenInput.plan.tasks, basePlan.tasks);
  assert.deepEqual(
    forbiddenInput.plan.tasks.find(
      (task) => task.id === "qa-security-review",
    )?.allowedPaths,
    [".git/config"],
  );
  assert.equal(
    basePlan.tasks.some((task) => task.allowedPaths.includes(".git/config")),
    false,
  );
});

test("all demo scenarios are deterministic", () => {
  for (const scenarioId of developmentPlanDemoScenarioIds) {
    assert.deepEqual(
      evaluateDevelopmentPlanDemoScenario(scenarioId),
      evaluateDevelopmentPlanDemoScenario(scenarioId),
    );
    assert.deepEqual(
      evaluateDevelopmentPlanDemoScenario(scenarioId, true),
      evaluateDevelopmentPlanDemoScenario(scenarioId, true),
    );
  }
});

test("demo evaluation does not mutate plan or serialized collections", () => {
  const input = createDevelopmentPlanDemoAdmissionInput("path-conflict");
  const snapshot = structuredClone(input);

  evaluateDevelopmentTaskAdmission(input);

  assert.deepEqual(input, snapshot);
});

test("scenario IDs are unique and match exported metadata", () => {
  assert.equal(
    new Set(developmentPlanDemoScenarioIds).size,
    developmentPlanDemoScenarioIds.length,
  );
  assert.deepEqual(
    developmentPlanDemoScenarios.map((scenario) => scenario.id),
    developmentPlanDemoScenarioIds,
  );
});

test("presentation labels cover all canonical admission verdicts", () => {
  assert.deepEqual(Object.keys(developmentPlanDemoVerdictLabels), [
    ...developmentTaskAdmissionVerdicts,
  ]);
  assert.deepEqual(developmentPlanDemoVerdictLabels, {
    deny: "Нет, сначала нужно устранить причину",
    require_approval: "Нужно ваше подтверждение",
    allow: "Да, следующий этап можно начинать",
  });
  for (const verdict of developmentTaskAdmissionVerdicts) {
    assert.ok(developmentPlanDemoVerdictLabels[verdict].length > 0);
  }
});

test("scenario inputs are rebuilt without shared mutable arrays", () => {
  const first = createDevelopmentPlanDemoAdmissionInput("allow");
  const second = createDevelopmentPlanDemoAdmissionInput("allow");

  assert.notEqual(first.plan, second.plan);
  assert.notEqual(first.plan.tasks, second.plan.tasks);
  assert.notEqual(first.completedTaskIds, second.completedTaskIds);
  assert.notEqual(first.activeTaskIds, second.activeTaskIds);
  assert.notEqual(first.repositoryAllowlist, second.repositoryAllowlist);

  (first.completedTaskIds as string[]).push("unit-tests");
  (first.repositoryAllowlist as string[]).push(".git");
  (first.plan.tasks[0]?.allowedPaths as string[]).push("node_modules");

  assert.deepEqual(second.completedTaskIds, ["repository-analysis"]);
  assert.deepEqual(second.repositoryAllowlist, ["components/domain"]);
  assert.deepEqual(second.plan.tasks[0]?.allowedPaths, [
    "lib/development-plan-demo.ts",
  ]);
});
