import assert from "node:assert/strict";
import test from "node:test";

const demoModule = (await import(
  new URL("../lib/development-execution-demo.ts", import.meta.url).href
)) as typeof import("../lib/development-execution-demo");
const executionModule = (await import(
  new URL("../lib/contracts/development-execution.ts", import.meta.url).href
)) as typeof import("../lib/contracts/development-execution");

const {
  createDevelopmentExecutionDemoScenario,
  developmentExecutionDemoNextActionLabels,
  developmentExecutionDemoScenarioIds,
  developmentExecutionDemoScenarios,
  developmentExecutionDemoStatusLabels,
  getDevelopmentExecutionDemoCurrentAttemptFailure,
  getDevelopmentExecutionDemoHistoricalFailures,
} = demoModule;
const {
  developmentExecutionNextActions,
  developmentExecutionStatuses,
  getDevelopmentExecutionNextAction,
  transitionDevelopmentExecutionRun,
  validateAndNormalizeDevelopmentExecutionRun,
} = executionModule;

type ScenarioId = (typeof developmentExecutionDemoScenarioIds)[number];
type Timeline = import("../lib/development-execution-demo").DevelopmentExecutionDemoTimeline;

function getTimeline(scenarioId: ScenarioId): Timeline {
  const result = createDevelopmentExecutionDemoScenario(scenarioId);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  assert.equal(result.ok, true, `scenario ${scenarioId} must build`);
  return result.value;
}

function getFinalRun(scenarioId: ScenarioId) {
  const timeline = getTimeline(scenarioId);
  const finalStep = timeline.steps.at(-1);
  assert.ok(finalStep, `scenario ${scenarioId} must contain a final step`);
  return finalStep.snapshot;
}

test("scenario IDs are unique and match exported metadata", () => {
  assert.equal(
    new Set(developmentExecutionDemoScenarioIds).size,
    developmentExecutionDemoScenarioIds.length,
  );
  assert.deepEqual(
    developmentExecutionDemoScenarios.map((scenario) => scenario.id),
    developmentExecutionDemoScenarioIds,
  );
});

test("every scenario is deterministic", () => {
  for (const scenarioId of developmentExecutionDemoScenarioIds) {
    assert.deepEqual(
      createDevelopmentExecutionDemoScenario(scenarioId),
      createDevelopmentExecutionDemoScenario(scenarioId),
    );
  }
});

test("all timeline snapshots pass canonical validation and next-action derivation", () => {
  for (const scenarioId of developmentExecutionDemoScenarioIds) {
    for (const step of getTimeline(scenarioId).steps) {
      const validation = validateAndNormalizeDevelopmentExecutionRun(
        step.snapshot,
      );
      assert.equal(
        validation.ok,
        true,
        `${scenarioId}/${step.id} must be canonical`,
      );

      const nextAction = getDevelopmentExecutionNextAction(step.snapshot);
      assert.equal(nextAction.ok, true);
      if (nextAction.ok) {
        assert.equal(nextAction.value, step.nextAction);
        assert.equal(nextAction.value, step.snapshot.nextAction);
      }
    }
  }
});

test("success_first_attempt completes on attempt 1", () => {
  const finalRun = getFinalRun("success_first_attempt");
  assert.equal(finalRun.status, "completed");
  assert.equal(finalRun.currentAttemptNumber, 1);
  assert.equal(finalRun.attempts.length, 1);
});

test("verification correction completes on attempt 2 after verification failure", () => {
  const timeline = getTimeline("verification_correction_success");
  const finalRun = getFinalRun("verification_correction_success");
  const firstFailedStep = timeline.steps.find(
    (step) => step.status === "awaiting_correction",
  );
  const correctiveAttemptStep = timeline.steps.find(
    (step) =>
      step.status === "implementing" && step.snapshot.currentAttemptNumber === 2,
  );
  const correctiveLifecycleSteps = timeline.steps.filter(
    (step) =>
      step.snapshot.currentAttemptNumber === 2 &&
      ["implementing", "verifying", "reviewing", "completed"].includes(
        step.status,
      ),
  );

  assert.ok(firstFailedStep);
  assert.ok(firstFailedStep.failureReason);
  assert.equal(
    getDevelopmentExecutionDemoCurrentAttemptFailure(firstFailedStep.snapshot)
      ?.attemptNumber,
    1,
  );
  assert.ok(correctiveAttemptStep);
  assert.equal(
    getDevelopmentExecutionDemoCurrentAttemptFailure(
      correctiveAttemptStep.snapshot,
    ),
    null,
  );
  assert.deepEqual(
    correctiveLifecycleSteps.map((step) => step.status),
    ["implementing", "verifying", "reviewing", "completed"],
  );
  assert.ok(
    correctiveLifecycleSteps.every(
      (step) =>
        getDevelopmentExecutionDemoCurrentAttemptFailure(step.snapshot) ===
        null,
    ),
  );
  assert.equal(finalRun.status, "completed");
  assert.equal(finalRun.currentAttemptNumber, 2);
  assert.equal(finalRun.attempts.length, 2);
  assert.equal(finalRun.failures[0]?.attemptNumber, 1);
  assert.equal(finalRun.failures[0]?.phase, "verification");
  assert.equal(
    finalRun.failures.some((failure) => failure.attemptNumber === 2),
    false,
  );
  assert.equal(getDevelopmentExecutionDemoCurrentAttemptFailure(finalRun), null);
});

test("review correction completes on attempt 2 after review failure", () => {
  const timeline = getTimeline("review_correction_success");
  const finalRun = getFinalRun("review_correction_success");
  const successfulAttemptSteps = timeline.steps.filter(
    (step) =>
      step.snapshot.currentAttemptNumber === 2 &&
      ["implementing", "verifying", "reviewing", "completed"].includes(
        step.status,
      ),
  );
  assert.equal(finalRun.status, "completed");
  assert.equal(finalRun.currentAttemptNumber, 2);
  assert.equal(finalRun.attempts.length, 2);
  assert.equal(finalRun.failures[0]?.attemptNumber, 1);
  assert.equal(finalRun.failures[0]?.phase, "review");
  assert.equal(
    finalRun.failures.some((failure) => failure.attemptNumber === 2),
    false,
  );
  assert.ok(
    successfulAttemptSteps.every(
      (step) =>
        getDevelopmentExecutionDemoCurrentAttemptFailure(step.snapshot) ===
        null,
    ),
  );
  assert.equal(getDevelopmentExecutionDemoCurrentAttemptFailure(finalRun), null);
});

test("repeated failure is blocked with canonical reason", () => {
  const finalRun = getFinalRun("repeated_failure_blocked");
  assert.equal(finalRun.status, "blocked");
  assert.ok(
    finalRun.blockingReasons.some(
      (reason) => reason.code === "repeated_failure",
    ),
  );
  assert.equal(finalRun.failures[0]?.fingerprint, finalRun.failures[1]?.fingerprint);
  assert.equal(
    getDevelopmentExecutionDemoCurrentAttemptFailure(finalRun)?.attemptNumber,
    2,
  );
});

test("attempt budget stops after exactly three attempts", () => {
  const finalRun = getFinalRun("attempt_budget_exhausted");
  assert.equal(finalRun.status, "blocked");
  assert.equal(finalRun.attempts.length, 3);
  assert.equal(finalRun.attempts[3], undefined);
  assert.equal(finalRun.currentAttemptNumber, 3);
  assert.ok(
    finalRun.blockingReasons.some(
      (reason) => reason.code === "attempt_budget_exhausted",
    ),
  );
  assert.equal(
    getDevelopmentExecutionDemoCurrentAttemptFailure(finalRun)?.attemptNumber,
    3,
  );
});

test("owner decision scenario waits for new scope decision", () => {
  const finalRun = getFinalRun("owner_decision_required");
  assert.equal(finalRun.status, "awaiting_owner_decision");
  assert.ok(
    finalRun.blockingReasons.some(
      (reason) => reason.code === "scope_expansion_required",
    ),
  );
});

test("forbidden path is blocked before verification and review", () => {
  const finalRun = getFinalRun("forbidden_path_blocked");
  assert.equal(finalRun.status, "blocked");
  assert.ok(
    finalRun.blockingReasons.some(
      (reason) => reason.code === "system_forbidden_path",
    ),
  );
  assert.equal(finalRun.attempts.length, 1);
  assert.deepEqual(finalRun.attempts[0]?.changedPaths, [".git/config"]);
  assert.deepEqual(finalRun.attempts[0]?.verificationChecks, []);
  assert.equal(finalRun.attempts[0]?.reviewStatus, "not_started");
  assert.equal(
    getTimeline("forbidden_path_blocked").steps.some(
      (step) => step.status === "verifying" || step.status === "reviewing",
    ),
    false,
  );
});

test("timeline step IDs are unique and numbers are sequential", () => {
  for (const scenarioId of developmentExecutionDemoScenarioIds) {
    const steps = getTimeline(scenarioId).steps;
    assert.equal(new Set(steps.map((step) => step.id)).size, steps.length);
    assert.deepEqual(
      steps.map((step) => step.number),
      steps.map((_, index) => index + 1),
    );
    assert.ok(steps.every((step) => !("isCurrent" in step)));
  }
});

test("historical failures stay separate from the current attempt and are not mutated", () => {
  const finalRun = getFinalRun("verification_correction_success");
  const failureSnapshot = structuredClone(finalRun.failures);
  const historicalFailures =
    getDevelopmentExecutionDemoHistoricalFailures(finalRun);

  assert.deepEqual(
    historicalFailures.map((failure) => ({
      attemptNumber: failure.attemptNumber,
      phase: failure.phase,
      fingerprint: failure.fingerprint,
    })),
    [
      {
        attemptNumber: 1,
        phase: "verification",
        fingerprint: "verification/unit-test-failure",
      },
    ],
  );
  assert.notEqual(historicalFailures, finalRun.failures);
  assert.notEqual(historicalFailures[0], finalRun.failures[0]);
  assert.deepEqual(finalRun.failures, failureSnapshot);
});

test("all scenario terminal results remain unchanged", () => {
  const expectedResults = {
    success_first_attempt: ["completed", 1, 0],
    verification_correction_success: ["completed", 2, 1],
    review_correction_success: ["completed", 2, 1],
    repeated_failure_blocked: ["blocked", 2, 2],
    attempt_budget_exhausted: ["blocked", 3, 3],
    owner_decision_required: ["awaiting_owner_decision", 1, 1],
    forbidden_path_blocked: ["blocked", 1, 0],
  } as const;

  for (const scenarioId of developmentExecutionDemoScenarioIds) {
    const finalRun = getFinalRun(scenarioId);
    const [status, attemptNumber, failureCount] = expectedResults[scenarioId];
    assert.equal(finalRun.status, status);
    assert.equal(finalRun.currentAttemptNumber, attemptNumber);
    assert.equal(finalRun.failures.length, failureCount);
  }
});

test("timeline stores successive canonical transitions, not final-verdict fixtures", () => {
  for (const scenarioId of developmentExecutionDemoScenarioIds) {
    const steps = getTimeline(scenarioId).steps;
    assert.equal(steps[0]?.status, "ready");
    assert.equal(steps[0]?.snapshot.attempts.length, 0);
    assert.ok(steps.length >= 3);
    for (let index = 1; index < steps.length; index += 1) {
      assert.notDeepEqual(steps[index]?.snapshot, steps[index - 1]?.snapshot);
    }
  }
});

test("canonical transition and validation do not mutate demo snapshots", () => {
  const timeline = getTimeline("success_first_attempt");
  const source = timeline.steps[0]?.snapshot;
  assert.ok(source);
  const sourceCopy = structuredClone(source);

  validateAndNormalizeDevelopmentExecutionRun(source);
  transitionDevelopmentExecutionRun(source, { type: "start_attempt" });

  assert.deepEqual(source, sourceCopy);
});

test("factory calls return independent arrays and objects", () => {
  const first = getTimeline("verification_correction_success");
  const second = getTimeline("verification_correction_success");

  assert.notEqual(first, second);
  assert.notEqual(first.scenario, second.scenario);
  assert.notEqual(first.steps, second.steps);
  assert.notEqual(first.steps[0], second.steps[0]);
  assert.notEqual(first.steps[0]?.snapshot, second.steps[0]?.snapshot);

  (first.steps as unknown as Array<unknown>).push({});
  (first.steps[0]?.snapshot.attempts as unknown as Array<unknown>).push({});

  assert.equal(second.steps.length, 8);
  assert.equal(second.steps[0]?.snapshot.attempts.length, 0);
});

test("Russian presentation labels cover every canonical status and next action", () => {
  assert.deepEqual(Object.keys(developmentExecutionDemoStatusLabels), [
    ...developmentExecutionStatuses,
  ]);
  assert.deepEqual(Object.keys(developmentExecutionDemoNextActionLabels), [
    ...developmentExecutionNextActions,
  ]);

  for (const label of Object.values(developmentExecutionDemoStatusLabels)) {
    assert.match(label, /[А-Яа-яЁё]/u);
  }
  for (const label of Object.values(developmentExecutionDemoNextActionLabels)) {
    assert.match(label, /[А-Яа-яЁё]/u);
  }
});

test("hostile scenario IDs fail closed without throwing", () => {
  const hostileInputs: readonly unknown[] = [
    "__proto__",
    "success_first_attempt/../../.git/config",
    "<script>alert(1)</script>",
    { toString: () => {
      throw new Error("hostile");
    } },
    null,
  ];

  for (const input of hostileInputs) {
    assert.doesNotThrow(() => createDevelopmentExecutionDemoScenario(input));
    const result = createDevelopmentExecutionDemoScenario(input);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "invalid_scenario_id");
      assert.deepEqual(result.error.reasonCodes, ["invalid_scenario_id"]);
    }
  }
});
