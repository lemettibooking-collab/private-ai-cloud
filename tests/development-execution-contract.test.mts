import assert from "node:assert/strict";
import test from "node:test";

const executionModule = (await import(
  new URL("../lib/contracts/development-execution.ts", import.meta.url).href
)) as typeof import("../lib/contracts/development-execution");
const policyModule = (await import(
  new URL("../lib/contracts/development-task-policy.ts", import.meta.url).href
)) as typeof import("../lib/contracts/development-task-policy");

const {
  createDevelopmentExecutionRun,
  developmentExecutionAttemptKinds,
  developmentExecutionAttemptStatuses,
  developmentExecutionLimits,
  developmentExecutionNextActions,
  developmentExecutionStatuses,
  getDevelopmentExecutionNextAction,
  isDevelopmentExecutionAttemptKind,
  isDevelopmentExecutionAttemptStatus,
  isDevelopmentExecutionNextAction,
  isDevelopmentExecutionStatus,
  parseDevelopmentExecutionAttemptKind,
  parseDevelopmentExecutionAttemptStatus,
  parseDevelopmentExecutionNextAction,
  parseDevelopmentExecutionStatus,
  transitionDevelopmentExecutionRun,
  validateAndNormalizeDevelopmentExecutionRun,
} = executionModule;
const { evaluateDevelopmentTaskAdmission } = policyModule;

type ExecutionRun = import("../lib/contracts/development-execution").DevelopmentExecutionRun;
type Failure = import("../lib/contracts/development-execution").DevelopmentExecutionFailureReport;
type FailurePhase = import("../lib/contracts/development-execution").DevelopmentExecutionFailurePhase;

function makeTask(
  taskId = "task-a",
  allowedPaths: readonly string[] = ["lib"],
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id: taskId,
    sequence: 1,
    title: `Implement ${taskId}`,
    goal: `Deliver ${taskId}`,
    scope: [`Scope ${taskId}`],
    nonGoals: [],
    allowedPaths: [...allowedPaths],
    acceptanceCriteria: [`${taskId} is deterministic`],
    verificationCommands: ["npm run lint", "npm test"],
    dependencyIds: [],
    riskLevel: "low",
    priority: "P3",
    requiresOwnerApproval: false,
    ...overrides,
  };
}

function makeAdmissionDecision(
  allowedPaths: readonly string[] = ["lib"],
  taskOverrides: Readonly<Record<string, unknown>> = {},
  ownerApprovalGranted = true,
) {
  return evaluateDevelopmentTaskAdmission({
    plan: {
      id: "feature-a",
      title: "Feature A",
      goal: "Deliver Feature A",
      status: "approved",
      tasks: [makeTask("task-a", allowedPaths, taskOverrides)],
    },
    taskId: "task-a",
    completedTaskIds: [],
    activeTaskIds: [],
    repositoryAllowlist: [...allowedPaths],
    taskOwnerApprovalGranted: ownerApprovalGranted,
  });
}

function makeCreationInput(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id: "execution-a",
    planId: "feature-a",
    taskId: "task-a",
    admissionDecision: makeAdmissionDecision(),
    requiredVerificationCommands: ["npm run lint", "npm test"],
    protectedPaths: ["lib/protected.ts"],
    ...overrides,
  };
}

function requireCreated(
  overrides: Readonly<Record<string, unknown>> = {},
): ExecutionRun {
  const result = createDevelopmentExecutionRun(makeCreationInput(overrides));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) {
    throw new Error(`Expected run creation to succeed: ${JSON.stringify(result)}`);
  }
  return result.value;
}

function requireTransition(run: unknown, event: unknown): ExecutionRun {
  const result = transitionDevelopmentExecutionRun(run, event);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) {
    throw new Error(`Expected transition to succeed: ${JSON.stringify(result)}`);
  }
  return result.value;
}

function reasonCodes(result: {
  ok: boolean;
  errors?: readonly { code: string }[];
  value?: ExecutionRun;
}): string[] {
  return result.ok
    ? (result.value?.blockingReasons.map((reason) => reason.code) ?? [])
    : (result.errors?.map((error) => error.code) ?? []);
}

function makeFailure(
  phase: FailurePhase,
  fingerprint: string,
  overrides: Readonly<Partial<Failure>> = {},
): Failure {
  return {
    phase,
    code: `${phase}_failed`,
    fingerprint,
    summary: `${phase} failed`,
    retryable: true,
    scopeExpansionRequired: false,
    protectedPathViolation: false,
    systemForbiddenPathViolation: false,
    ...overrides,
  };
}

function startRun(run: ExecutionRun = requireCreated()): ExecutionRun {
  return requireTransition(run, { type: "start_attempt" });
}

function submitPatch(
  run: ExecutionRun = startRun(),
  changedPaths: readonly string[] = ["lib/feature.ts"],
): ExecutionRun {
  return requireTransition(run, { type: "submit_patch", changedPaths });
}

function passVerification(run: ExecutionRun = submitPatch()): ExecutionRun {
  return requireTransition(run, {
    type: "verification_passed",
    checks: [
      { command: "npm run lint", exitCode: 0 },
      { command: "npm test", exitCode: 0 },
    ],
  });
}

function completeRun(run: ExecutionRun = passVerification()): ExecutionRun {
  return requireTransition(run, { type: "review_passed" });
}

function assertHasReason(
  result: ReturnType<typeof transitionDevelopmentExecutionRun>,
  code: string,
) {
  const reasons = result.ok ? result.value.blockingReasons : result.errors;
  assert.ok(
    reasons.some((reason) => reason.code === code),
    `Expected ${code}: ${JSON.stringify(result)}`,
  );
}

test("DevelopmentExecutionStatus values match the exact lifecycle", () => {
  assert.deepEqual(developmentExecutionStatuses, [
    "ready",
    "implementing",
    "verifying",
    "reviewing",
    "awaiting_correction",
    "awaiting_owner_decision",
    "completed",
    "blocked",
    "cancelled",
  ]);
});

test("DevelopmentExecutionNextAction values match the exact contract", () => {
  assert.deepEqual(developmentExecutionNextActions, [
    "start_initial_attempt",
    "submit_patch_or_failure",
    "report_verification",
    "report_review",
    "start_corrective_attempt",
    "owner_decision_required",
    "none",
  ]);
});

test("attempt kind and status arrays match the exact contracts", () => {
  assert.deepEqual(developmentExecutionAttemptKinds, ["initial", "corrective"]);
  assert.deepEqual(developmentExecutionAttemptStatuses, [
    "in_progress",
    "failed",
    "passed",
  ]);
});

test("status and next-action guards and parsers fail closed", () => {
  for (const status of developmentExecutionStatuses) {
    assert.equal(isDevelopmentExecutionStatus(status), true);
    assert.equal(parseDevelopmentExecutionStatus(status), status);
  }
  for (const invalid of ["running", " ready ", 1, null]) {
    assert.equal(isDevelopmentExecutionStatus(invalid), false);
    assert.equal(parseDevelopmentExecutionStatus(invalid), null);
  }
  for (const action of developmentExecutionNextActions) {
    assert.equal(isDevelopmentExecutionNextAction(action), true);
    assert.equal(parseDevelopmentExecutionNextAction(action), action);
  }
  assert.equal(parseDevelopmentExecutionNextAction("none "), null);
});

test("attempt guards and parsers fail closed", () => {
  for (const kind of developmentExecutionAttemptKinds) {
    assert.equal(isDevelopmentExecutionAttemptKind(kind), true);
    assert.equal(parseDevelopmentExecutionAttemptKind(kind), kind);
  }
  for (const status of developmentExecutionAttemptStatuses) {
    assert.equal(isDevelopmentExecutionAttemptStatus(status), true);
    assert.equal(parseDevelopmentExecutionAttemptStatus(status), status);
  }
  assert.equal(parseDevelopmentExecutionAttemptKind("initial "), null);
  assert.equal(parseDevelopmentExecutionAttemptStatus("cancelled"), null);
});

test("an AI-009 allow decision creates a normalized ready run", () => {
  const decision = {
    ...makeAdmissionDecision(),
    normalizedAllowedPaths: [" lib/z/ ", "lib/a", "lib/z"],
  };
  const run = requireCreated({
    admissionDecision: decision,
    requiredVerificationCommands: [" npm test ", "npm test", "npm run lint"],
    protectedPaths: [" lib/z/protected/ ", "lib/a/protected"],
  });
  assert.equal(run.status, "ready");
  assert.equal(run.maxAttempts, 3);
  assert.deepEqual(run.admittedAllowedPaths, ["lib/a", "lib/z"]);
  assert.deepEqual(run.requiredVerificationCommands, ["npm test", "npm run lint"]);
  assert.deepEqual(run.protectedPaths, ["lib/a/protected", "lib/z/protected"]);
  assert.equal(run.nextAction, "start_initial_attempt");
});

test("deny and require_approval admissions cannot create a run", () => {
  const deny = createDevelopmentExecutionRun(
    makeCreationInput({
      admissionDecision: { ...makeAdmissionDecision(), verdict: "deny" },
    }),
  );
  assert.equal(deny.ok, false);
  assert.deepEqual(reasonCodes(deny), ["admission_not_allowed"]);

  const requiresApproval = makeAdmissionDecision(
    ["lib"],
    { riskLevel: "high" },
    false,
  );
  assert.equal(requiresApproval.verdict, "require_approval");
  const approval = createDevelopmentExecutionRun(
    makeCreationInput({ admissionDecision: requiresApproval }),
  );
  assert.equal(approval.ok, false);
  assert.deepEqual(reasonCodes(approval), ["admission_not_allowed"]);
});

test("a forged allow cannot bypass unresolved Owner approval or conflicts", () => {
  const decision = makeAdmissionDecision();
  const unresolvedApproval = createDevelopmentExecutionRun(
    makeCreationInput({
      admissionDecision: {
        ...decision,
        ownerApprovalRequired: true,
        ownerApprovalSatisfied: false,
      },
    }),
  );
  assert.equal(unresolvedApproval.ok, false);
  assertHasReason(unresolvedApproval, "admission_not_allowed");

  const conflicts = createDevelopmentExecutionRun(
    makeCreationInput({
      admissionDecision: {
        ...decision,
        conflictingTaskIds: ["task-active"],
      },
    }),
  );
  assert.equal(conflicts.ok, false);
  assertHasReason(conflicts, "admission_not_allowed");
});

test("admission mismatch and forbidden admitted paths are rejected", () => {
  const mismatch = createDevelopmentExecutionRun(
    makeCreationInput({
      admissionDecision: { ...makeAdmissionDecision(), taskId: "task-b" },
    }),
  );
  assert.equal(mismatch.ok, false);
  assertHasReason(mismatch, "admission_task_mismatch");

  const forbidden = createDevelopmentExecutionRun(
    makeCreationInput({
      admissionDecision: {
        ...makeAdmissionDecision(),
        normalizedAllowedPaths: [".git/config"],
      },
    }),
  );
  assert.equal(forbidden.ok, false);
  assertHasReason(forbidden, "system_forbidden_path");
});

test("empty admitted paths and verification commands fail closed", () => {
  const emptyPaths = createDevelopmentExecutionRun(
    makeCreationInput({
      admissionDecision: {
        ...makeAdmissionDecision(),
        normalizedAllowedPaths: [],
      },
    }),
  );
  assert.equal(emptyPaths.ok, false);
  assertHasReason(emptyPaths, "invalid_admitted_path");

  const emptyCommands = createDevelopmentExecutionRun(
    makeCreationInput({ requiredVerificationCommands: [] }),
  );
  assert.equal(emptyCommands.ok, false);
  assertHasReason(emptyCommands, "invalid_verification_evidence");
});

test("caller cannot increase the system attempt limit", () => {
  const run = requireCreated({ maxAttempts: 99 });
  assert.equal(run.maxAttempts, developmentExecutionLimits.maxAttempts);
});

test("run creation does not mutate admission, command, or protected path arrays", () => {
  const decision = {
    ...makeAdmissionDecision(),
    normalizedAllowedPaths: [" lib/z/ ", "lib/a"],
  };
  const commands = [" npm test ", "npm run lint"];
  const protectedPaths = [" lib/a/protected/ "];
  const snapshot = structuredClone({ decision, commands, protectedPaths });

  createDevelopmentExecutionRun(
    makeCreationInput({
      admissionDecision: decision,
      requiredVerificationCommands: commands,
      protectedPaths,
    }),
  );

  assert.deepEqual({ decision, commands, protectedPaths }, snapshot);
});

test("hostile public inputs never throw", () => {
  const hostile = new Proxy({}, { get() { throw new Error("hostile getter"); } });
  assert.doesNotThrow(() => createDevelopmentExecutionRun(hostile));
  assert.doesNotThrow(() => validateAndNormalizeDevelopmentExecutionRun(hostile));
  assert.doesNotThrow(() => transitionDevelopmentExecutionRun(hostile, hostile));
  assert.equal(createDevelopmentExecutionRun(hostile).ok, false);
  assert.equal(validateAndNormalizeDevelopmentExecutionRun(hostile).ok, false);
  assert.equal(transitionDevelopmentExecutionRun(hostile, hostile).ok, false);
});

test("ready transitions to implementing with initial attempt 1", () => {
  const run = startRun();
  assert.equal(run.status, "implementing");
  assert.equal(run.currentAttemptNumber, 1);
  assert.deepEqual(run.attempts, [
    {
      number: 1,
      kind: "initial",
      status: "in_progress",
      changedPaths: [],
      failureFingerprints: [],
      verificationChecks: [],
      reviewStatus: "not_started",
      closureKind: "none",
    },
  ]);
  assert.equal(run.nextAction, "submit_patch_or_failure");
});

test("submit_patch normalizes paths and transitions to verifying", () => {
  const run = submitPatch(startRun(), [
    " lib/z.ts ",
    "lib/a.ts/",
    "lib/z.ts",
  ]);
  assert.equal(run.status, "verifying");
  assert.deepEqual(run.attempts[0]?.changedPaths, ["lib/a.ts", "lib/z.ts"]);
  assert.equal(run.nextAction, "report_verification");
});

test("successful verification transitions to reviewing", () => {
  const run = passVerification();
  assert.equal(run.status, "reviewing");
  assert.equal(run.attempts[0]?.status, "in_progress");
  assert.equal(run.nextAction, "report_review");
});

test("review success completes only the verified attempt", () => {
  const run = completeRun();
  assert.equal(run.status, "completed");
  assert.equal(run.attempts[0]?.status, "passed");
  assert.equal(run.nextAction, "none");
  assert.deepEqual(getDevelopmentExecutionNextAction(run), {
    ok: true,
    value: "none",
  });
});

test("the complete happy path is deterministic", () => {
  const execute = () => completeRun();
  assert.deepEqual(execute(), execute());
  assert.equal(JSON.stringify(execute()), JSON.stringify(execute()));
});

test("getNextAction matches every reachable lifecycle state", () => {
  const ready = requireCreated();
  const implementing = startRun(ready);
  const verifying = submitPatch(implementing);
  const reviewing = passVerification(verifying);
  const completed = completeRun(reviewing);
  const awaitingCorrection = requireTransition(verifying, {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:first"),
  });
  const awaitingOwner = requireTransition(implementing, {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:scope", {
      scopeExpansionRequired: true,
    }),
  });
  const blocked = requireTransition(implementing, {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:fatal", {
      retryable: false,
    }),
  });
  const cancelled = requireTransition(ready, { type: "cancel" });

  for (const [run, action] of [
    [ready, "start_initial_attempt"],
    [implementing, "submit_patch_or_failure"],
    [verifying, "report_verification"],
    [reviewing, "report_review"],
    [awaitingCorrection, "start_corrective_attempt"],
    [awaitingOwner, "owner_decision_required"],
    [completed, "none"],
    [blocked, "none"],
    [cancelled, "none"],
  ] as const) {
    assert.deepEqual(getDevelopmentExecutionNextAction(run), {
      ok: true,
      value: action,
    });
  }
});

test("missing verification evidence is rejected without changing the run", () => {
  const run = submitPatch();
  const snapshot = structuredClone(run);
  const result = transitionDevelopmentExecutionRun(run, {
    type: "verification_passed",
    checks: [{ command: "npm test", exitCode: 0 }],
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_verification_evidence");
  assert.deepEqual(run, snapshot);
});

test("duplicate verification commands are rejected", () => {
  const result = transitionDevelopmentExecutionRun(submitPatch(), {
    type: "verification_passed",
    checks: [
      { command: "npm run lint", exitCode: 0 },
      { command: "npm run lint", exitCode: 0 },
      { command: "npm test", exitCode: 0 },
    ],
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_verification_evidence");
});

test("unknown verification commands are rejected", () => {
  const result = transitionDevelopmentExecutionRun(submitPatch(), {
    type: "verification_passed",
    checks: [
      { command: "npm run lint", exitCode: 0 },
      { command: "npm test", exitCode: 0 },
      { command: "npm run unknown", exitCode: 0 },
    ],
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_verification_evidence");
});

test("non-zero verification evidence cannot pass", () => {
  const result = transitionDevelopmentExecutionRun(submitPatch(), {
    type: "verification_passed",
    checks: [
      { command: "npm run lint", exitCode: 1 },
      { command: "npm test", exitCode: 0 },
    ],
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_verification_evidence");
});

test("every required command exactly once with exit 0 is accepted", () => {
  const run = passVerification();
  assert.equal(run.status, "reviewing");
});

test("verification_passed stores exact canonical immutable evidence", () => {
  const verifying = submitPatch();
  const checks = [
    { command: " npm test ", exitCode: 0 },
    { command: "npm run lint", exitCode: 0 },
  ];
  const snapshot = structuredClone(checks);
  const reviewing = requireTransition(verifying, {
    type: "verification_passed",
    checks,
  });

  assert.deepEqual(reviewing.attempts[0]?.verificationChecks, [
    { command: "npm run lint", exitCode: 0 },
    { command: "npm test", exitCode: 0 },
  ]);
  assert.equal(reviewing.attempts[0]?.reviewStatus, "pending");
  assert.deepEqual(checks, snapshot);
  assert.notEqual(reviewing.attempts[0]?.verificationChecks, checks);
});

test("review_passed stores explicit successful review evidence", () => {
  const completed = completeRun();
  assert.equal(completed.attempts[0]?.reviewStatus, "passed");
  assert.equal(
    completed.attempts[0]?.closureKind,
    "successful_completion",
  );
  assert.deepEqual(completed.attempts[0]?.verificationChecks, [
    { command: "npm run lint", exitCode: 0 },
    { command: "npm test", exitCode: 0 },
  ]);
});

test("first retryable verification failure awaits correction", () => {
  const run = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:first"),
  });
  assert.equal(run.status, "awaiting_correction");
  assert.equal(run.attempts[0]?.status, "failed");
  assert.deepEqual(run.attempts[0]?.failureFingerprints, ["verification:first"]);
  assert.equal(run.nextAction, "start_corrective_attempt");
});

test("the second attempt is corrective and sequential", () => {
  const failed = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:first"),
  });
  const run = startRun(failed);
  assert.equal(run.currentAttemptNumber, 2);
  assert.deepEqual(run.attempts.map(({ number, kind }) => ({ number, kind })), [
    { number: 1, kind: "initial" },
    { number: 2, kind: "corrective" },
  ]);
});

test("a different review failure after attempt 2 permits attempt 3", () => {
  const firstFailed = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:first"),
  });
  const secondReview = passVerification(submitPatch(startRun(firstFailed)));
  const secondFailed = requireTransition(secondReview, {
    type: "review_failed",
    failure: makeFailure("review", "review:second"),
  });
  assert.equal(secondFailed.status, "awaiting_correction");
  const third = startRun(secondFailed);
  assert.equal(third.currentAttemptNumber, 3);
  assert.equal(third.attempts[2]?.kind, "corrective");
});

function makeThirdVerifyingAttempt(): ExecutionRun {
  const firstFailed = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:first"),
  });
  const secondFailed = requireTransition(submitPatch(startRun(firstFailed)), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:second"),
  });
  return submitPatch(startRun(secondFailed));
}

test("failure on attempt 3 blocks and exhausts the budget", () => {
  const run = requireTransition(makeThirdVerifyingAttempt(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:third"),
  });
  assert.equal(run.status, "blocked");
  assert.ok(
    run.blockingReasons.some(
      (reason) => reason.code === "attempt_budget_exhausted",
    ),
  );
  assert.equal(run.attempts[2]?.status, "failed");
  assert.equal(validateAndNormalizeDevelopmentExecutionRun(run).ok, true);
});

test("a fourth attempt cannot be created", () => {
  const blocked = requireTransition(makeThirdVerifyingAttempt(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:third"),
  });
  const result = transitionDevelopmentExecutionRun(blocked, {
    type: "start_attempt",
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("a repeated fingerprint blocks on its second occurrence", () => {
  const firstFailed = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:repeat"),
  });
  const blocked = requireTransition(submitPatch(startRun(firstFailed)), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:repeat"),
  });
  assert.equal(blocked.status, "blocked");
  assert.ok(
    blocked.blockingReasons.some(
      (reason) =>
        reason.code === "repeated_failure" &&
        reason.failureFingerprint === "verification:repeat",
    ),
  );
  assert.equal(validateAndNormalizeDevelopmentExecutionRun(blocked).ok, true);
});

test("different fingerprints are not treated as repeated", () => {
  const firstFailed = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:first"),
  });
  const secondFailed = requireTransition(submitPatch(startRun(firstFailed)), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:second"),
  });
  assert.equal(secondFailed.status, "awaiting_correction");
  assert.equal(
    secondFailed.blockingReasons.some(
      (reason) => reason.code === "repeated_failure",
    ),
    false,
  );
});

test("a non-retryable failure blocks immediately", () => {
  const run = requireTransition(startRun(), {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:fatal", {
      retryable: false,
    }),
  });
  assert.equal(run.status, "blocked");
  assert.deepEqual(reasonCodes({ ok: true, value: run }), [
    "non_retryable_failure",
  ]);
});

test("scope expansion awaits a new Owner decision", () => {
  const run = requireTransition(startRun(), {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:scope", {
      scopeExpansionRequired: true,
    }),
  });
  assert.equal(run.status, "awaiting_owner_decision");
  assert.equal(run.nextAction, "owner_decision_required");
  assert.deepEqual(reasonCodes({ ok: true, value: run }), [
    "scope_expansion_required",
  ]);
});

test("start_attempt cannot continue an awaiting_owner_decision run", () => {
  const awaitingOwner = requireTransition(startRun(), {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:scope", {
      scopeExpansionRequired: true,
    }),
  });
  const result = transitionDevelopmentExecutionRun(awaitingOwner, {
    type: "start_attempt",
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("system and protected violations outrank scope expansion", () => {
  const run = requireTransition(startRun(), {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:policy", {
      scopeExpansionRequired: true,
      protectedPathViolation: true,
      systemForbiddenPathViolation: true,
    }),
  });
  assert.equal(run.status, "blocked");
  assert.deepEqual(reasonCodes({ ok: true, value: run }), [
    "system_forbidden_path",
    "protected_path_modified",
  ]);
});

test("scope expansion outranks non-retryable when policy paths are safe", () => {
  const run = requireTransition(startRun(), {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:new-scope", {
      retryable: false,
      scopeExpansionRequired: true,
    }),
  });
  assert.equal(run.status, "awaiting_owner_decision");
  assert.deepEqual(reasonCodes({ ok: true, value: run }), [
    "scope_expansion_required",
  ]);
});

test("failure phase must match the event", () => {
  const result = transitionDevelopmentExecutionRun(startRun(), {
    type: "implementation_failed",
    failure: makeFailure("verification", "verification:wrong-phase"),
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("changed paths are normalized and source arrays are not mutated", () => {
  const paths = [" lib/z.ts/ ", "lib/a.ts", "lib/z.ts"];
  const snapshot = structuredClone(paths);
  const run = submitPatch(startRun(), paths);
  assert.deepEqual(run.attempts[0]?.changedPaths, ["lib/a.ts", "lib/z.ts"]);
  assert.deepEqual(paths, snapshot);
});

test("a changed path outside admitted scope blocks the run", () => {
  const run = submitPatch(startRun(), ["app/page.tsx"]);
  assert.equal(run.status, "blocked");
  assert.deepEqual(reasonCodes({ ok: true, value: run }), [
    "path_outside_admitted_scope",
  ]);
  assert.equal(run.attempts[0]?.status, "failed");
});

test("a system-forbidden changed path blocks before scope checks", () => {
  const run = submitPatch(startRun(), [".git/config"]);
  assert.equal(run.status, "blocked");
  assert.deepEqual(reasonCodes({ ok: true, value: run }), [
    "system_forbidden_path",
  ]);
});

test("a changed path overlapping a protected path blocks the run", () => {
  const run = submitPatch(startRun(), ["lib/protected.ts/child"]);
  assert.equal(run.status, "blocked");
  assert.deepEqual(reasonCodes({ ok: true, value: run }), [
    "protected_path_modified",
  ]);
});

test("segment-aware containment does not treat app-old as inside app", () => {
  const run = requireCreated({
    admissionDecision: makeAdmissionDecision(["app"]),
    protectedPaths: [],
  });
  const blocked = submitPatch(startRun(run), ["app-old/page.tsx"]);
  assert.equal(blocked.status, "blocked");
  assertHasReason({ ok: true, value: blocked }, "path_outside_admitted_scope");
});

test("near-match protected paths do not create a false overlap", () => {
  const run = requireCreated({
    admissionDecision: makeAdmissionDecision(["app"]),
    protectedPaths: ["app/protected"],
  });
  const verifying = submitPatch(startRun(run), ["app/protected-old/file.ts"]);
  assert.equal(verifying.status, "verifying");
});

test("empty changed paths fail closed without a partial transition", () => {
  const run = startRun();
  const snapshot = structuredClone(run);
  const result = transitionDevelopmentExecutionRun(run, {
    type: "submit_patch",
    changedPaths: [],
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_admitted_path");
  assert.deepEqual(run, snapshot);
});

test("submit_patch before start_attempt is rejected", () => {
  const result = transitionDevelopmentExecutionRun(requireCreated(), {
    type: "submit_patch",
    changedPaths: ["lib/feature.ts"],
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("review_passed before verification is rejected", () => {
  const result = transitionDevelopmentExecutionRun(startRun(), {
    type: "review_passed",
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("start_attempt while an attempt is active is rejected", () => {
  const result = transitionDevelopmentExecutionRun(startRun(), {
    type: "start_attempt",
  });
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("cancel closes an active attempt and cancels a non-terminal run", () => {
  const run = requireTransition(startRun(), { type: "cancel" });
  assert.equal(run.status, "cancelled");
  assert.equal(run.attempts[0]?.status, "failed");
  assert.equal(run.nextAction, "none");
  assert.deepEqual(reasonCodes({ ok: true, value: run }), [
    "cancelled_by_owner",
  ]);
});

test("cancel is allowed from ready without creating an attempt", () => {
  const run = requireTransition(requireCreated(), { type: "cancel" });
  assert.equal(run.status, "cancelled");
  assert.deepEqual(run.attempts, []);
  assert.equal(run.currentAttemptNumber, 0);
});

test("cancel is allowed from every remaining non-terminal status", () => {
  const implementing = startRun();
  const verifying = submitPatch(implementing);
  const reviewing = passVerification(verifying);
  const awaitingCorrection = requireTransition(verifying, {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:cancel"),
  });
  const awaitingOwner = requireTransition(implementing, {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:cancel", {
      scopeExpansionRequired: true,
    }),
  });

  for (const run of [
    implementing,
    verifying,
    reviewing,
    awaitingCorrection,
    awaitingOwner,
  ]) {
    const cancelled = requireTransition(run, { type: "cancel" });
    assert.equal(cancelled.status, "cancelled", run.status);
    assert.equal(cancelled.nextAction, "none", run.status);
    assert.equal(
      cancelled.attempts.some((attempt) => attempt.status === "in_progress"),
      false,
      run.status,
    );
  }
});

test("terminal runs cannot be cancelled", () => {
  const completed = completeRun();
  const alreadyCancelled = requireTransition(requireCreated(), {
    type: "cancel",
  });
  const blocked = submitPatch(startRun(), [".git/config"]);
  for (const run of [completed, alreadyCancelled, blocked]) {
    const result = transitionDevelopmentExecutionRun(run, { type: "cancel" });
    assert.equal(result.ok, false, run.status);
    assertHasReason(result, "invalid_transition");
  }
});

test("invalid events return structured errors", () => {
  for (const event of [null, {}, { type: "unknown_event" }, "cancel"]) {
    const result = transitionDevelopmentExecutionRun(requireCreated(), event);
    assert.equal(result.ok, false);
    assertHasReason(result, "invalid_transition");
  }
});

test("run and event inputs are never mutated", () => {
  const run = startRun();
  const event = {
    type: "submit_patch",
    changedPaths: [" lib/feature.ts/ ", "lib/feature.ts"],
  };
  const runSnapshot = structuredClone(run);
  const eventSnapshot = structuredClone(event);
  transitionDevelopmentExecutionRun(run, event);
  assert.deepEqual(run, runSnapshot);
  assert.deepEqual(event, eventSnapshot);
});

test("run validation rejects non-sequential and active terminal attempts", () => {
  const implementing = startRun();
  const invalid = {
    ...implementing,
    status: "blocked",
    nextAction: "none",
    attempts: [
      {
        ...implementing.attempts[0],
        number: 2,
      },
    ],
  };
  const result = validateAndNormalizeDevelopmentExecutionRun(invalid);
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("forged reviewing without verification evidence fails closed", () => {
  const verifying = submitPatch();
  const forged = {
    ...verifying,
    status: "reviewing",
    nextAction: "report_review",
    attempts: [
      {
        ...verifying.attempts[0],
        reviewStatus: "pending",
        verificationChecks: [],
      },
    ],
  };
  const result = validateAndNormalizeDevelopmentExecutionRun(forged);
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_verification_evidence");
});

test("forged completed without verification evidence fails closed", () => {
  const completed = completeRun();
  const forged = {
    ...completed,
    attempts: [
      {
        ...completed.attempts[0],
        verificationChecks: [],
      },
    ],
  };
  const result = validateAndNormalizeDevelopmentExecutionRun(forged);
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_verification_evidence");
});

test("completed without explicit successful review fails closed", () => {
  const completed = completeRun();
  const forged = {
    ...completed,
    attempts: [
      {
        ...completed.attempts[0],
        reviewStatus: "pending",
      },
    ],
  };
  const result = validateAndNormalizeDevelopmentExecutionRun(forged);
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("verification evidence is rejected in impossible lifecycle phases", () => {
  const verifying = submitPatch();
  const forged = {
    ...verifying,
    attempts: [
      {
        ...verifying.attempts[0],
        verificationChecks: [
          { command: "npm run lint", exitCode: 0 },
          { command: "npm test", exitCode: 0 },
        ],
      },
    ],
  };
  const result = validateAndNormalizeDevelopmentExecutionRun(forged);
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_verification_evidence");
});

test("stored verification evidence must match required commands and order", () => {
  const completed = completeRun();
  const forged = {
    ...completed,
    attempts: [
      {
        ...completed.attempts[0],
        verificationChecks: [
          { command: "npm test", exitCode: 0 },
          { command: "npm run lint", exitCode: 0 },
        ],
      },
    ],
  };
  const result = validateAndNormalizeDevelopmentExecutionRun(forged);
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_verification_evidence");
});

test("awaiting_correction requires one matching domain failure", () => {
  const awaitingCorrection = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:missing"),
  });
  const forged = {
    ...awaitingCorrection,
    failures: [],
  };
  const result = validateAndNormalizeDevelopmentExecutionRun(forged);
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("a forged attempt cannot continue after a blocking failure", () => {
  const first = requireTransition(startRun(), {
    type: "implementation_failed",
    failure: makeFailure("implementation", "implementation:fatal-history", {
      retryable: false,
    }),
  });
  const forged = {
    ...first,
    status: "implementing",
    nextAction: "submit_patch_or_failure",
    currentAttemptNumber: 2,
    blockingReasons: [],
    attempts: [
      first.attempts[0],
      {
        number: 2,
        kind: "corrective",
        status: "in_progress",
        changedPaths: [],
        failureFingerprints: [],
        verificationChecks: [],
        reviewStatus: "not_started",
        closureKind: "none",
      },
    ],
  };
  const result = validateAndNormalizeDevelopmentExecutionRun(forged);
  assert.equal(result.ok, false);
  assertHasReason(result, "invalid_transition");
});

test("stored failure attemptNumber and fingerprint must match its attempt", () => {
  const awaitingCorrection = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:matching"),
  });
  assert.equal(awaitingCorrection.failures[0]?.attemptNumber, 1);

  for (const failure of [
    { ...awaitingCorrection.failures[0], attemptNumber: 2 },
    { ...awaitingCorrection.failures[0], fingerprint: "verification:forged" },
  ]) {
    const result = validateAndNormalizeDevelopmentExecutionRun({
      ...awaitingCorrection,
      failures: [failure],
    });
    assert.equal(result.ok, false);
    assertHasReason(result, "invalid_transition");
  }
});

test("active and completed statuses reject stale blocking reasons", () => {
  const awaitingCorrection = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:stale"),
  });
  const runs = [
    requireCreated(),
    startRun(),
    submitPatch(),
    passVerification(),
    awaitingCorrection,
    completeRun(),
  ];
  const staleReason = {
    code: "invalid_transition",
    path: "status",
    message: "Stale reason.",
  };

  for (const run of runs) {
    const result = validateAndNormalizeDevelopmentExecutionRun({
      ...run,
      blockingReasons: [staleReason],
    });
    assert.equal(result.ok, false, run.status);
    assertHasReason(result, "invalid_transition");
  }
});

test("policy-block and cancellation closures remain validator-reachable", () => {
  const policyBlocked = submitPatch(startRun(), [".git/config"]);
  const cancelledActive = requireTransition(passVerification(), {
    type: "cancel",
  });
  const cancelledAfterFailure = requireTransition(
    requireTransition(submitPatch(), {
      type: "verification_failed",
      failure: makeFailure("verification", "verification:cancel-later"),
    }),
    { type: "cancel" },
  );

  assert.equal(policyBlocked.attempts[0]?.closureKind, "policy_block");
  assert.equal(cancelledActive.attempts[0]?.closureKind, "cancelled");
  for (const run of [policyBlocked, cancelledActive, cancelledAfterFailure]) {
    assert.equal(validateAndNormalizeDevelopmentExecutionRun(run).ok, true);
  }
});

test("validation and transition errors are deterministic", () => {
  const invalidRun = {
    ...requireCreated(),
    maxAttempts: 4,
    nextAction: "none",
  };
  assert.deepEqual(
    validateAndNormalizeDevelopmentExecutionRun(invalidRun),
    validateAndNormalizeDevelopmentExecutionRun(structuredClone(invalidRun)),
  );

  const run = startRun();
  const event = { type: "submit_patch", changedPaths: ["app/z", "app/a"] };
  assert.deepEqual(
    transitionDevelopmentExecutionRun(run, event),
    transitionDevelopmentExecutionRun(structuredClone(run), structuredClone(event)),
  );
});

test("path collection limits accept the boundary and reject one extra", () => {
  const allowedAtLimit = Array.from(
    { length: developmentExecutionLimits.maxAllowedPaths },
    (_, index) => `lib/path-${index}`,
  );
  const decision = {
    ...makeAdmissionDecision(),
    normalizedAllowedPaths: allowedAtLimit,
  };
  assert.equal(
    createDevelopmentExecutionRun(
      makeCreationInput({ admissionDecision: decision, protectedPaths: [] }),
    ).ok,
    true,
  );
  assert.equal(
    createDevelopmentExecutionRun(
      makeCreationInput({
        admissionDecision: {
          ...decision,
          normalizedAllowedPaths: [...allowedAtLimit, "lib/over-limit"],
        },
      }),
    ).ok,
    false,
  );

  const protectedAtLimit = Array.from(
    { length: developmentExecutionLimits.maxProtectedPaths },
    (_, index) => `lib/protected-${index}`,
  );
  assert.equal(
    requireCreated({ protectedPaths: protectedAtLimit }).protectedPaths.length,
    developmentExecutionLimits.maxProtectedPaths,
  );
  assert.equal(
    createDevelopmentExecutionRun(
      makeCreationInput({
        protectedPaths: [...protectedAtLimit, "lib/protected-over-limit"],
      }),
    ).ok,
    false,
  );
});

test("verification command limits accept the boundary and reject one extra", () => {
  const commands = Array.from(
    { length: developmentExecutionLimits.maxVerificationCommands },
    (_, index) => `verify-${index}`,
  );
  assert.equal(
    requireCreated({ requiredVerificationCommands: commands })
      .requiredVerificationCommands.length,
    developmentExecutionLimits.maxVerificationCommands,
  );
  assert.equal(
    createDevelopmentExecutionRun(
      makeCreationInput({
        requiredVerificationCommands: [...commands, "verify-over-limit"],
      }),
    ).ok,
    false,
  );
});

test("changed path limits accept the boundary and reject one extra", () => {
  const paths = Array.from(
    { length: developmentExecutionLimits.maxChangedPaths },
    (_, index) => `lib/change-${index}.ts`,
  );
  const atLimit = transitionDevelopmentExecutionRun(startRun(), {
    type: "submit_patch",
    changedPaths: paths,
  });
  assert.equal(atLimit.ok, true);
  if (atLimit.ok) {
    assert.equal(
      atLimit.value.attempts[0]?.changedPaths.length,
      developmentExecutionLimits.maxChangedPaths,
    );
  }

  const overLimit = transitionDevelopmentExecutionRun(startRun(), {
    type: "submit_patch",
    changedPaths: [...paths, "lib/change-over-limit.ts"],
  });
  assert.equal(overLimit.ok, false);
  assertHasReason(overLimit, "invalid_admitted_path");
});

test("string, summary, and fingerprint limits enforce exact boundaries", () => {
  const commandAtLimit = "x".repeat(developmentExecutionLimits.maxStringLength);
  assert.equal(
    createDevelopmentExecutionRun(
      makeCreationInput({ requiredVerificationCommands: [commandAtLimit] }),
    ).ok,
    true,
  );
  assert.equal(
    createDevelopmentExecutionRun(
      makeCreationInput({ requiredVerificationCommands: [`${commandAtLimit}x`] }),
    ).ok,
    false,
  );

  const summaryAtLimit = "s".repeat(developmentExecutionLimits.maxSummaryLength);
  assert.equal(
    transitionDevelopmentExecutionRun(startRun(), {
      type: "implementation_failed",
      failure: makeFailure("implementation", "implementation:summary", {
        summary: summaryAtLimit,
      }),
    }).ok,
    true,
  );
  assert.equal(
    transitionDevelopmentExecutionRun(startRun(), {
      type: "implementation_failed",
      failure: makeFailure("implementation", "implementation:summary", {
        summary: `${summaryAtLimit}s`,
      }),
    }).ok,
    false,
  );

  const fingerprintAtLimit = `f${"a".repeat(
    developmentExecutionLimits.maxFingerprintLength - 1,
  )}`;
  assert.equal(
    transitionDevelopmentExecutionRun(startRun(), {
      type: "implementation_failed",
      failure: makeFailure("implementation", fingerprintAtLimit),
    }).ok,
    true,
  );
  assert.equal(
    transitionDevelopmentExecutionRun(startRun(), {
      type: "implementation_failed",
      failure: makeFailure("implementation", `${fingerprintAtLimit}a`),
    }).ok,
    false,
  );
});

test("failure report normalizes text and rejects boolean coercion", () => {
  const normalized = requireTransition(startRun(), {
    type: "implementation_failed",
    failure: {
      ...makeFailure("implementation", "implementation:normalized"),
      code: " implementation_failed ",
      summary: " first\r\nsecond ",
    },
  });
  assert.equal(normalized.failures[0]?.summary, "first\nsecond");
  assert.equal(normalized.failures[0]?.code, "implementation_failed");

  const invalid = transitionDevelopmentExecutionRun(startRun(), {
    type: "implementation_failed",
    failure: {
      ...makeFailure("implementation", "implementation:invalid"),
      retryable: "true",
    },
  });
  assert.equal(invalid.ok, false);
  assertHasReason(invalid, "invalid_transition");
});

test("failure report rejects control characters and malformed fingerprints", () => {
  for (const failure of [
    {
      ...makeFailure("implementation", "implementation:control"),
      summary: "bad\u0000summary",
    },
    makeFailure("implementation", "UPPERCASE"),
    makeFailure("implementation", "line\nbreak"),
  ]) {
    const result = transitionDevelopmentExecutionRun(startRun(), {
      type: "implementation_failed",
      failure,
    });
    assert.equal(result.ok, false);
    assertHasReason(result, "invalid_transition");
  }
});

test("one failed attempt cannot contain multiple failure fingerprints", () => {
  const failed = requireTransition(submitPatch(), {
    type: "verification_failed",
    failure: makeFailure("verification", "verification:first"),
  });
  const forged = {
    ...failed,
    attempts: [
      {
        ...failed.attempts[0],
        failureFingerprints: ["verification:first", "verification:second"],
      },
    ],
  };
  assert.equal(validateAndNormalizeDevelopmentExecutionRun(forged).ok, false);
});

test("exported limits are exact and frozen", () => {
  assert.deepEqual(developmentExecutionLimits, {
    maxAttempts: 3,
    maxChangedPaths: 64,
    maxAllowedPaths: 64,
    maxProtectedPaths: 64,
    maxVerificationCommands: 32,
    maxFailures: 64,
    maxStringLength: 1024,
    maxSummaryLength: 4096,
    maxFingerprintLength: 256,
  });
  assert.equal(Object.isFrozen(developmentExecutionLimits), true);
  assert.throws(() => {
    (developmentExecutionLimits as { maxAttempts: number }).maxAttempts = 4;
  }, TypeError);
  assert.equal(developmentExecutionLimits.maxAttempts, 3);
});
