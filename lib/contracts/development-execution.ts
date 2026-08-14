import type { DevelopmentTaskAdmissionDecision } from "./development-task-policy";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isSystemForbiddenRepositoryPath } from "./development-task-policy.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { normalizeRepositoryPath } from "./development-task-policy.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { repositoryPathContains } from "./development-task-policy.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { repositoryPathsOverlap } from "./development-task-policy.ts";

export const developmentExecutionStatuses = [
  "ready",
  "implementing",
  "verifying",
  "reviewing",
  "awaiting_correction",
  "awaiting_owner_decision",
  "completed",
  "blocked",
  "cancelled",
] as const;

export type DevelopmentExecutionStatus =
  (typeof developmentExecutionStatuses)[number];

export const developmentExecutionNextActions = [
  "start_initial_attempt",
  "submit_patch_or_failure",
  "report_verification",
  "report_review",
  "start_corrective_attempt",
  "owner_decision_required",
  "none",
] as const;

export type DevelopmentExecutionNextAction =
  (typeof developmentExecutionNextActions)[number];

export const developmentExecutionAttemptKinds = [
  "initial",
  "corrective",
] as const;

export type DevelopmentExecutionAttemptKind =
  (typeof developmentExecutionAttemptKinds)[number];

export const developmentExecutionAttemptStatuses = [
  "in_progress",
  "failed",
  "passed",
] as const;

export type DevelopmentExecutionAttemptStatus =
  (typeof developmentExecutionAttemptStatuses)[number];

export const developmentExecutionFailurePhases = [
  "implementation",
  "verification",
  "review",
] as const;

export type DevelopmentExecutionFailurePhase =
  (typeof developmentExecutionFailurePhases)[number];

export const developmentExecutionReviewStatuses = [
  "not_started",
  "pending",
  "passed",
  "failed",
] as const;

export type DevelopmentExecutionReviewStatus =
  (typeof developmentExecutionReviewStatuses)[number];

export const developmentExecutionAttemptClosureKinds = [
  "none",
  "domain_failure",
  "policy_block",
  "cancelled",
  "successful_completion",
] as const;

export type DevelopmentExecutionAttemptClosureKind =
  (typeof developmentExecutionAttemptClosureKinds)[number];

export const developmentExecutionBlockingReasonCodes = [
  "admission_not_allowed",
  "admission_task_mismatch",
  "invalid_admitted_path",
  "system_forbidden_path",
  "path_outside_admitted_scope",
  "protected_path_modified",
  "non_retryable_failure",
  "repeated_failure",
  "attempt_budget_exhausted",
  "scope_expansion_required",
  "invalid_transition",
  "invalid_verification_evidence",
  "cancelled_by_owner",
] as const;

export type DevelopmentExecutionBlockingReasonCode =
  (typeof developmentExecutionBlockingReasonCodes)[number];

export const developmentExecutionLimits = Object.freeze({
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

export type DevelopmentExecutionFailure = Readonly<{
  attemptNumber: number;
  phase: DevelopmentExecutionFailurePhase;
  code: string;
  fingerprint: string;
  summary: string;
  retryable: boolean;
  scopeExpansionRequired: boolean;
  protectedPathViolation: boolean;
  systemForbiddenPathViolation: boolean;
}>;

export type DevelopmentExecutionAttempt = Readonly<{
  number: number;
  kind: DevelopmentExecutionAttemptKind;
  status: DevelopmentExecutionAttemptStatus;
  changedPaths: readonly string[];
  failureFingerprints: readonly string[];
  verificationChecks: readonly DevelopmentExecutionVerificationCheck[];
  reviewStatus: DevelopmentExecutionReviewStatus;
  closureKind: DevelopmentExecutionAttemptClosureKind;
}>;

export type DevelopmentExecutionBlockingReason = Readonly<{
  code: DevelopmentExecutionBlockingReasonCode;
  path: string;
  message: string;
  attemptNumber?: number;
  failureFingerprint?: string;
}>;

export type DevelopmentExecutionRun = Readonly<{
  id: string;
  planId: string;
  taskId: string;
  status: DevelopmentExecutionStatus;
  admittedAllowedPaths: readonly string[];
  requiredVerificationCommands: readonly string[];
  protectedPaths: readonly string[];
  maxAttempts: 3;
  attempts: readonly DevelopmentExecutionAttempt[];
  failures: readonly DevelopmentExecutionFailure[];
  blockingReasons: readonly DevelopmentExecutionBlockingReason[];
  currentAttemptNumber: number;
  nextAction: DevelopmentExecutionNextAction;
}>;

export type DevelopmentExecutionVerificationCheck = Readonly<{
  command: string;
  exitCode: number;
}>;

export type DevelopmentExecutionFailureReport = Omit<
  DevelopmentExecutionFailure,
  "attemptNumber"
>;

export type DevelopmentExecutionEvent =
  | Readonly<{ type: "start_attempt" }>
  | Readonly<{ type: "submit_patch"; changedPaths: readonly string[] }>
  | Readonly<{
      type: "implementation_failed";
      failure: DevelopmentExecutionFailureReport;
    }>
  | Readonly<{
      type: "verification_passed";
      checks: readonly DevelopmentExecutionVerificationCheck[];
    }>
  | Readonly<{
      type: "verification_failed";
      failure: DevelopmentExecutionFailureReport;
    }>
  | Readonly<{ type: "review_passed" }>
  | Readonly<{
      type: "review_failed";
      failure: DevelopmentExecutionFailureReport;
    }>
  | Readonly<{ type: "cancel" }>;

export type DevelopmentExecutionResult =
  | { ok: true; value: DevelopmentExecutionRun }
  | { ok: false; errors: readonly DevelopmentExecutionBlockingReason[] };

export type DevelopmentExecutionNextActionResult =
  | { ok: true; value: DevelopmentExecutionNextAction }
  | { ok: false; errors: readonly DevelopmentExecutionBlockingReason[] };

type MutableErrors = DevelopmentExecutionBlockingReason[];

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const safeFingerprintPattern = /^[a-z0-9][a-z0-9._:/-]*$/u;
const disallowedControlCharacterPattern =
  /[\u0000-\u0009\u000b-\u001f\u007f]/u;

function includesValue<const Values extends readonly string[]>(
  values: Values,
  input: unknown,
): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function normalizeText(input: string): string {
  return input.replace(/\r\n?/gu, "\n").trim();
}

function createReason(
  code: DevelopmentExecutionBlockingReasonCode,
  path: string,
  message: string,
  options: Readonly<{
    attemptNumber?: number;
    failureFingerprint?: string;
  }> = {},
): DevelopmentExecutionBlockingReason {
  return {
    code,
    path,
    message,
    ...(options.attemptNumber === undefined
      ? {}
      : { attemptNumber: options.attemptNumber }),
    ...(options.failureFingerprint === undefined
      ? {}
      : { failureFingerprint: options.failureFingerprint }),
  };
}

function addReason(
  errors: MutableErrors,
  code: DevelopmentExecutionBlockingReasonCode,
  path: string,
  message: string,
  options?: Readonly<{
    attemptNumber?: number;
    failureFingerprint?: string;
  }>,
): void {
  if (errors.length < developmentExecutionLimits.maxFailures) {
    errors.push(createReason(code, path, message, options));
  }
}

function normalizeRequiredText(
  input: unknown,
  path: string,
  maxLength: number,
  code: DevelopmentExecutionBlockingReasonCode,
  errors: MutableErrors,
): string | null {
  if (typeof input !== "string") {
    addReason(errors, code, path, `${path} must be a string.`);
    return null;
  }

  const value = normalizeText(input);
  if (value.length === 0) {
    addReason(errors, code, path, `${path} must not be empty.`);
    return null;
  }

  if (value.length > maxLength) {
    addReason(
      errors,
      code,
      path,
      `${path} must be at most ${maxLength} characters.`,
    );
    return null;
  }

  if (disallowedControlCharacterPattern.test(value)) {
    addReason(errors, code, path, `${path} contains a control character.`);
    return null;
  }

  return value;
}

function normalizeId(
  input: unknown,
  path: string,
  errors: MutableErrors,
): string | null {
  const value = normalizeRequiredText(
    input,
    path,
    64,
    "invalid_transition",
    errors,
  );

  if (value !== null && !safeIdPattern.test(value)) {
    addReason(
      errors,
      "invalid_transition",
      path,
      `${path} must be a lowercase safe ID.`,
    );
    return null;
  }

  return value;
}

function normalizeFingerprint(
  input: unknown,
  path: string,
  errors: MutableErrors,
): string | null {
  const value = normalizeRequiredText(
    input,
    path,
    developmentExecutionLimits.maxFingerprintLength,
    "invalid_transition",
    errors,
  );

  if (
    value !== null &&
    (value.includes("\n") || !safeFingerprintPattern.test(value))
  ) {
    addReason(
      errors,
      "invalid_transition",
      path,
      `${path} must be a lowercase single-line failure fingerprint.`,
    );
    return null;
  }

  return value;
}

export function isDevelopmentExecutionStatus(
  input: unknown,
): input is DevelopmentExecutionStatus {
  return includesValue(developmentExecutionStatuses, input);
}

export function parseDevelopmentExecutionStatus(
  input: unknown,
): DevelopmentExecutionStatus | null {
  return isDevelopmentExecutionStatus(input) ? input : null;
}

export function isDevelopmentExecutionNextAction(
  input: unknown,
): input is DevelopmentExecutionNextAction {
  return includesValue(developmentExecutionNextActions, input);
}

export function parseDevelopmentExecutionNextAction(
  input: unknown,
): DevelopmentExecutionNextAction | null {
  return isDevelopmentExecutionNextAction(input) ? input : null;
}

export function isDevelopmentExecutionAttemptKind(
  input: unknown,
): input is DevelopmentExecutionAttemptKind {
  return includesValue(developmentExecutionAttemptKinds, input);
}

export function parseDevelopmentExecutionAttemptKind(
  input: unknown,
): DevelopmentExecutionAttemptKind | null {
  return isDevelopmentExecutionAttemptKind(input) ? input : null;
}

export function isDevelopmentExecutionAttemptStatus(
  input: unknown,
): input is DevelopmentExecutionAttemptStatus {
  return includesValue(developmentExecutionAttemptStatuses, input);
}

export function parseDevelopmentExecutionAttemptStatus(
  input: unknown,
): DevelopmentExecutionAttemptStatus | null {
  return isDevelopmentExecutionAttemptStatus(input) ? input : null;
}

export function isDevelopmentExecutionFailurePhase(
  input: unknown,
): input is DevelopmentExecutionFailurePhase {
  return includesValue(developmentExecutionFailurePhases, input);
}

export function parseDevelopmentExecutionFailurePhase(
  input: unknown,
): DevelopmentExecutionFailurePhase | null {
  return isDevelopmentExecutionFailurePhase(input) ? input : null;
}

function getNextActionForStatus(
  status: DevelopmentExecutionStatus,
): DevelopmentExecutionNextAction {
  switch (status) {
    case "ready":
      return "start_initial_attempt";
    case "implementing":
      return "submit_patch_or_failure";
    case "verifying":
      return "report_verification";
    case "reviewing":
      return "report_review";
    case "awaiting_correction":
      return "start_corrective_attempt";
    case "awaiting_owner_decision":
      return "owner_decision_required";
    case "completed":
    case "blocked":
    case "cancelled":
      return "none";
  }
}

function normalizePathCollection(
  input: unknown,
  path: string,
  options: Readonly<{
    required: boolean;
    maxItems: number;
    forbidSystemPaths: boolean;
  }>,
  errors: MutableErrors,
): readonly string[] | null {
  if (!Array.isArray(input)) {
    addReason(errors, "invalid_admitted_path", path, `${path} must be an array.`);
    return null;
  }

  let hasError = false;
  if (input.length > options.maxItems) {
    addReason(
      errors,
      "invalid_admitted_path",
      path,
      `${path} must contain at most ${options.maxItems} paths.`,
    );
    hasError = true;
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.slice(0, options.maxItems).entries()) {
    const result = normalizeRepositoryPath(item);
    if (!result.ok) {
      addReason(
        errors,
        "invalid_admitted_path",
        `${path}[${index}]`,
        `${path}[${index}] is not a valid repository path.`,
      );
      hasError = true;
      continue;
    }

    if (options.forbidSystemPaths && isSystemForbiddenRepositoryPath(result.value)) {
      addReason(
        errors,
        "system_forbidden_path",
        result.value,
        `Path ${result.value} is forbidden by system policy.`,
      );
      hasError = true;
      continue;
    }

    if (!seen.has(result.value)) {
      seen.add(result.value);
      values.push(result.value);
    }
  }

  if (options.required && values.length === 0) {
    addReason(
      errors,
      "invalid_admitted_path",
      path,
      `${path} must contain at least one valid path.`,
    );
    hasError = true;
  }

  values.sort(compareStrings);
  return hasError ? null : values;
}

function normalizeVerificationCommands(
  input: unknown,
  path: string,
  errors: MutableErrors,
): readonly string[] | null {
  if (!Array.isArray(input)) {
    addReason(
      errors,
      "invalid_verification_evidence",
      path,
      `${path} must be an array.`,
    );
    return null;
  }

  let hasError = false;
  if (input.length > developmentExecutionLimits.maxVerificationCommands) {
    addReason(
      errors,
      "invalid_verification_evidence",
      path,
      `${path} must contain at most ${developmentExecutionLimits.maxVerificationCommands} commands.`,
    );
    hasError = true;
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input
    .slice(0, developmentExecutionLimits.maxVerificationCommands)
    .entries()) {
    const value = normalizeRequiredText(
      item,
      `${path}[${index}]`,
      developmentExecutionLimits.maxStringLength,
      "invalid_verification_evidence",
      errors,
    );
    if (value === null) {
      hasError = true;
    } else if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }

  if (values.length === 0) {
    addReason(
      errors,
      "invalid_verification_evidence",
      path,
      `${path} must contain at least one command.`,
    );
    hasError = true;
  }

  return hasError ? null : values;
}

function normalizeFailureInternal(
  input: unknown,
  path: string,
  expectedPhase: DevelopmentExecutionFailurePhase | null,
):
  | { ok: true; value: DevelopmentExecutionFailureReport }
  | { ok: false; errors: readonly DevelopmentExecutionBlockingReason[] } {
  const errors: MutableErrors = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createReason(
          "invalid_transition",
          path,
          `${path} must be a failure object.`,
        ),
      ],
    };
  }

  const phase = parseDevelopmentExecutionFailurePhase(input.phase);
  if (phase === null) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.phase`,
      `${path}.phase must be a canonical failure phase.`,
    );
  } else if (expectedPhase !== null && phase !== expectedPhase) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.phase`,
      `${path}.phase must be ${expectedPhase} for this event.`,
    );
  }

  const code = normalizeId(input.code, `${path}.code`, errors);
  const fingerprint = normalizeFingerprint(
    input.fingerprint,
    `${path}.fingerprint`,
    errors,
  );
  const summary = normalizeRequiredText(
    input.summary,
    `${path}.summary`,
    developmentExecutionLimits.maxSummaryLength,
    "invalid_transition",
    errors,
  );

  const booleanFields = [
    "retryable",
    "scopeExpansionRequired",
    "protectedPathViolation",
    "systemForbiddenPathViolation",
  ] as const;
  for (const field of booleanFields) {
    if (typeof input[field] !== "boolean") {
      addReason(
        errors,
        "invalid_transition",
        `${path}.${field}`,
        `${path}.${field} must be a boolean.`,
      );
    }
  }

  if (
    errors.length > 0 ||
    phase === null ||
    code === null ||
    fingerprint === null ||
    summary === null ||
    typeof input.retryable !== "boolean" ||
    typeof input.scopeExpansionRequired !== "boolean" ||
    typeof input.protectedPathViolation !== "boolean" ||
    typeof input.systemForbiddenPathViolation !== "boolean"
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      phase,
      code,
      fingerprint,
      summary,
      retryable: input.retryable,
      scopeExpansionRequired: input.scopeExpansionRequired,
      protectedPathViolation: input.protectedPathViolation,
      systemForbiddenPathViolation: input.systemForbiddenPathViolation,
    },
  };
}

function normalizeStoredFailure(
  input: unknown,
  index: number,
  errors: MutableErrors,
): DevelopmentExecutionFailure | null {
  const path = `failures[${index}]`;
  if (!isRecord(input)) {
    addReason(errors, "invalid_transition", path, `${path} must be a failure object.`);
    return null;
  }

  let attemptNumber: number | null = null;
  if (
    typeof input.attemptNumber !== "number" ||
    !Number.isSafeInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    input.attemptNumber > developmentExecutionLimits.maxAttempts
  ) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.attemptNumber`,
      `${path}.attemptNumber must be between 1 and ${developmentExecutionLimits.maxAttempts}.`,
    );
  } else {
    attemptNumber = input.attemptNumber;
  }

  const failure = normalizeFailureInternal(input, path, null);
  if (!failure.ok) {
    errors.push(...failure.errors);
  }

  return attemptNumber === null || !failure.ok
    ? null
    : { attemptNumber, ...failure.value };
}

function normalizeStoredVerificationChecks(
  input: unknown,
  path: string,
  errors: MutableErrors,
): readonly DevelopmentExecutionVerificationCheck[] | null {
  if (!Array.isArray(input)) {
    addReason(
      errors,
      "invalid_verification_evidence",
      path,
      `${path} must be an array.`,
    );
    return null;
  }

  if (input.length > developmentExecutionLimits.maxVerificationCommands) {
    addReason(
      errors,
      "invalid_verification_evidence",
      path,
      `${path} must contain at most ${developmentExecutionLimits.maxVerificationCommands} checks.`,
    );
  }

  const checks: DevelopmentExecutionVerificationCheck[] = [];
  for (const [index, checkInput] of input
    .slice(0, developmentExecutionLimits.maxVerificationCommands)
    .entries()) {
    const checkPath = `${path}[${index}]`;
    if (!isRecord(checkInput)) {
      addReason(
        errors,
        "invalid_verification_evidence",
        checkPath,
        `${checkPath} must be an object.`,
      );
      continue;
    }

    const command = normalizeRequiredText(
      checkInput.command,
      `${checkPath}.command`,
      developmentExecutionLimits.maxStringLength,
      "invalid_verification_evidence",
      errors,
    );
    if (
      typeof checkInput.exitCode !== "number" ||
      !Number.isSafeInteger(checkInput.exitCode)
    ) {
      addReason(
        errors,
        "invalid_verification_evidence",
        `${checkPath}.exitCode`,
        `${checkPath}.exitCode must be a safe integer.`,
      );
    } else if (command !== null) {
      checks.push({ command, exitCode: checkInput.exitCode });
    }
  }

  return checks;
}

function normalizeAttempt(
  input: unknown,
  index: number,
  errors: MutableErrors,
): DevelopmentExecutionAttempt | null {
  const path = `attempts[${index}]`;
  if (!isRecord(input)) {
    addReason(errors, "invalid_transition", path, `${path} must be an object.`);
    return null;
  }

  const initialErrorCount = errors.length;
  let number: number | null = null;
  if (
    typeof input.number !== "number" ||
    !Number.isSafeInteger(input.number) ||
    input.number < 1 ||
    input.number > developmentExecutionLimits.maxAttempts
  ) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.number`,
      `${path}.number must be between 1 and ${developmentExecutionLimits.maxAttempts}.`,
    );
  } else {
    number = input.number;
  }

  const kind = parseDevelopmentExecutionAttemptKind(input.kind);
  if (kind === null) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.kind`,
      `${path}.kind must be initial or corrective.`,
    );
  }

  const status = parseDevelopmentExecutionAttemptStatus(input.status);
  if (status === null) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.status`,
      `${path}.status must be a canonical attempt status.`,
    );
  }

  const changedPaths = normalizePathCollection(
    input.changedPaths,
    `${path}.changedPaths`,
    {
      required: false,
      maxItems: developmentExecutionLimits.maxChangedPaths,
      forbidSystemPaths: false,
    },
    errors,
  );

  let failureFingerprints: readonly string[] | null = null;
  if (!Array.isArray(input.failureFingerprints)) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.failureFingerprints`,
      `${path}.failureFingerprints must be an array.`,
    );
  } else if (input.failureFingerprints.length > 1) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.failureFingerprints`,
      `${path}.failureFingerprints must contain at most one value.`,
    );
  } else {
    const values: string[] = [];
    for (const [fingerprintIndex, item] of input.failureFingerprints.entries()) {
      const value = normalizeFingerprint(
        item,
        `${path}.failureFingerprints[${fingerprintIndex}]`,
        errors,
      );
      if (value !== null) {
        values.push(value);
      }
    }
    failureFingerprints = values;
  }

  const verificationChecks = normalizeStoredVerificationChecks(
    input.verificationChecks,
    `${path}.verificationChecks`,
    errors,
  );

  const reviewStatus = includesValue(
    developmentExecutionReviewStatuses,
    input.reviewStatus,
  )
    ? input.reviewStatus
    : null;
  if (reviewStatus === null) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.reviewStatus`,
      `${path}.reviewStatus must be a canonical review status.`,
    );
  }

  const closureKind = includesValue(
    developmentExecutionAttemptClosureKinds,
    input.closureKind,
  )
    ? input.closureKind
    : null;
  if (closureKind === null) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.closureKind`,
      `${path}.closureKind must be a canonical attempt closure kind.`,
    );
  }

  if (
    errors.length !== initialErrorCount ||
    number === null ||
    kind === null ||
    status === null ||
    changedPaths === null ||
    failureFingerprints === null ||
    verificationChecks === null ||
    reviewStatus === null ||
    closureKind === null
  ) {
    return null;
  }

  return {
    number,
    kind,
    status,
    changedPaths,
    failureFingerprints,
    verificationChecks,
    reviewStatus,
    closureKind,
  };
}

function normalizeBlockingReason(
  input: unknown,
  index: number,
  errors: MutableErrors,
): DevelopmentExecutionBlockingReason | null {
  const path = `blockingReasons[${index}]`;
  if (!isRecord(input)) {
    addReason(errors, "invalid_transition", path, `${path} must be an object.`);
    return null;
  }

  const initialErrorCount = errors.length;
  const code = includesValue(developmentExecutionBlockingReasonCodes, input.code)
    ? input.code
    : null;
  if (code === null) {
    addReason(
      errors,
      "invalid_transition",
      `${path}.code`,
      `${path}.code must be a canonical blocking reason code.`,
    );
  }

  const reasonPath = normalizeRequiredText(
    input.path,
    `${path}.path`,
    developmentExecutionLimits.maxStringLength,
    "invalid_transition",
    errors,
  );
  const message = normalizeRequiredText(
    input.message,
    `${path}.message`,
    developmentExecutionLimits.maxStringLength,
    "invalid_transition",
    errors,
  );

  let attemptNumber: number | undefined;
  if (input.attemptNumber !== undefined) {
    if (
      typeof input.attemptNumber !== "number" ||
      !Number.isSafeInteger(input.attemptNumber) ||
      input.attemptNumber < 1 ||
      input.attemptNumber > developmentExecutionLimits.maxAttempts
    ) {
      addReason(
        errors,
        "invalid_transition",
        `${path}.attemptNumber`,
        `${path}.attemptNumber must be a valid attempt number.`,
      );
    } else {
      attemptNumber = input.attemptNumber;
    }
  }

  let failureFingerprint: string | undefined;
  if (input.failureFingerprint !== undefined) {
    failureFingerprint =
      normalizeFingerprint(
        input.failureFingerprint,
        `${path}.failureFingerprint`,
        errors,
      ) ?? undefined;
  }

  if (
    errors.length !== initialErrorCount ||
    code === null ||
    reasonPath === null ||
    message === null
  ) {
    return null;
  }

  return createReason(code, reasonPath, message, {
    attemptNumber,
    failureFingerprint,
  });
}

function hasCompleteVerificationEvidence(
  attempt: DevelopmentExecutionAttempt,
  requiredCommands: readonly string[],
): boolean {
  return (
    attempt.verificationChecks.length === requiredCommands.length &&
    attempt.verificationChecks.every(
      (check, index) =>
        check.command === requiredCommands[index] && check.exitCode === 0,
    )
  );
}

function requireVerificationEvidence(
  attempt: DevelopmentExecutionAttempt,
  index: number,
  requiredCommands: readonly string[],
  errors: MutableErrors,
): void {
  if (!hasCompleteVerificationEvidence(attempt, requiredCommands)) {
    addReason(
      errors,
      "invalid_verification_evidence",
      `attempts[${index}].verificationChecks`,
      `Attempt ${attempt.number} must contain every required verification command exactly once, with exitCode 0, in canonical order.`,
    );
  }
}

function requireNoVerificationEvidence(
  attempt: DevelopmentExecutionAttempt,
  index: number,
  errors: MutableErrors,
): void {
  if (attempt.verificationChecks.length > 0) {
    addReason(
      errors,
      "invalid_verification_evidence",
      `attempts[${index}].verificationChecks`,
      `Attempt ${attempt.number} cannot contain verification evidence in this lifecycle phase.`,
    );
  }
}

type FailurePolicyExpectation = Readonly<{
  status:
    | "awaiting_correction"
    | "awaiting_owner_decision"
    | "blocked";
  reasonCodes: readonly DevelopmentExecutionBlockingReasonCode[];
}>;

function getFailurePolicyExpectation(
  failure: DevelopmentExecutionFailure,
  previousFailures: readonly DevelopmentExecutionFailure[],
): FailurePolicyExpectation {
  const policyReasonCodes: DevelopmentExecutionBlockingReasonCode[] = [];
  if (failure.systemForbiddenPathViolation) {
    policyReasonCodes.push("system_forbidden_path");
  }
  if (failure.protectedPathViolation) {
    policyReasonCodes.push("protected_path_modified");
  }
  if (policyReasonCodes.length > 0) {
    return { status: "blocked", reasonCodes: policyReasonCodes };
  }

  if (failure.scopeExpansionRequired) {
    return {
      status: "awaiting_owner_decision",
      reasonCodes: ["scope_expansion_required"],
    };
  }

  const reasonCodes: DevelopmentExecutionBlockingReasonCode[] = [];
  if (!failure.retryable) {
    reasonCodes.push("non_retryable_failure");
  }
  if (
    previousFailures.some(
      (previousFailure) =>
        previousFailure.fingerprint === failure.fingerprint,
    )
  ) {
    reasonCodes.push("repeated_failure");
  }
  if (failure.attemptNumber >= developmentExecutionLimits.maxAttempts) {
    reasonCodes.push("attempt_budget_exhausted");
  }

  return reasonCodes.length > 0
    ? { status: "blocked", reasonCodes }
    : { status: "awaiting_correction", reasonCodes: [] };
}

function validateAndNormalizeDevelopmentExecutionRunInternal(
  input: unknown,
): DevelopmentExecutionResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createReason(
          "invalid_transition",
          "$",
          "DevelopmentExecutionRun input must be an object.",
        ),
      ],
    };
  }

  const errors: MutableErrors = [];
  const id = normalizeId(input.id, "id", errors);
  const planId = normalizeId(input.planId, "planId", errors);
  const taskId = normalizeId(input.taskId, "taskId", errors);

  const status = parseDevelopmentExecutionStatus(input.status);
  if (status === null) {
    addReason(
      errors,
      "invalid_transition",
      "status",
      "status must be a canonical DevelopmentExecutionStatus.",
    );
  }

  const admittedAllowedPaths = normalizePathCollection(
    input.admittedAllowedPaths,
    "admittedAllowedPaths",
    {
      required: true,
      maxItems: developmentExecutionLimits.maxAllowedPaths,
      forbidSystemPaths: true,
    },
    errors,
  );
  const requiredVerificationCommands = normalizeVerificationCommands(
    input.requiredVerificationCommands,
    "requiredVerificationCommands",
    errors,
  );
  const protectedPaths = normalizePathCollection(
    input.protectedPaths,
    "protectedPaths",
    {
      required: false,
      maxItems: developmentExecutionLimits.maxProtectedPaths,
      forbidSystemPaths: false,
    },
    errors,
  );

  if (input.maxAttempts !== developmentExecutionLimits.maxAttempts) {
    addReason(
      errors,
      "attempt_budget_exhausted",
      "maxAttempts",
      `maxAttempts is system-fixed at ${developmentExecutionLimits.maxAttempts}.`,
    );
  }

  const attempts: DevelopmentExecutionAttempt[] = [];
  if (!Array.isArray(input.attempts)) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "attempts must be an array.",
    );
  } else {
    if (input.attempts.length > developmentExecutionLimits.maxAttempts) {
      addReason(
        errors,
        "attempt_budget_exhausted",
        "attempts",
        `attempts must contain at most ${developmentExecutionLimits.maxAttempts} attempts.`,
      );
    }
    for (const [index, attemptInput] of input.attempts
      .slice(0, developmentExecutionLimits.maxAttempts)
      .entries()) {
      const attempt = normalizeAttempt(attemptInput, index, errors);
      if (attempt) {
        attempts.push(attempt);
      }
    }
  }

  const failures: DevelopmentExecutionFailure[] = [];
  if (!Array.isArray(input.failures)) {
    addReason(
      errors,
      "invalid_transition",
      "failures",
      "failures must be an array.",
    );
  } else {
    if (input.failures.length > developmentExecutionLimits.maxFailures) {
      addReason(
        errors,
        "invalid_transition",
        "failures",
        `failures must contain at most ${developmentExecutionLimits.maxFailures} items.`,
      );
    }
    for (const [index, failureInput] of input.failures
      .slice(0, developmentExecutionLimits.maxFailures)
      .entries()) {
      const failure = normalizeStoredFailure(failureInput, index, errors);
      if (failure) {
        failures.push(failure);
      }
    }
  }

  const blockingReasons: DevelopmentExecutionBlockingReason[] = [];
  if (!Array.isArray(input.blockingReasons)) {
    addReason(
      errors,
      "invalid_transition",
      "blockingReasons",
      "blockingReasons must be an array.",
    );
  } else {
    if (input.blockingReasons.length > developmentExecutionLimits.maxFailures) {
      addReason(
        errors,
        "invalid_transition",
        "blockingReasons",
        `blockingReasons must contain at most ${developmentExecutionLimits.maxFailures} items.`,
      );
    }
    for (const [index, reasonInput] of input.blockingReasons
      .slice(0, developmentExecutionLimits.maxFailures)
      .entries()) {
      const reason = normalizeBlockingReason(reasonInput, index, errors);
      if (reason) {
        blockingReasons.push(reason);
      }
    }
  }

  let currentAttemptNumber: number | null = null;
  if (
    typeof input.currentAttemptNumber !== "number" ||
    !Number.isSafeInteger(input.currentAttemptNumber) ||
    input.currentAttemptNumber < 0 ||
    input.currentAttemptNumber > developmentExecutionLimits.maxAttempts
  ) {
    addReason(
      errors,
      "invalid_transition",
      "currentAttemptNumber",
      "currentAttemptNumber must be between 0 and 3.",
    );
  } else {
    currentAttemptNumber = input.currentAttemptNumber;
  }

  const nextAction = parseDevelopmentExecutionNextAction(input.nextAction);
  if (nextAction === null) {
    addReason(
      errors,
      "invalid_transition",
      "nextAction",
      "nextAction must be a canonical DevelopmentExecutionNextAction.",
    );
  }

  if (
    errors.length > 0 ||
    status === null ||
    requiredVerificationCommands === null
  ) {
    return { ok: false, errors };
  }

  for (const [index, attempt] of attempts.entries()) {
    const expectedNumber = index + 1;
    const expectedKind = index === 0 ? "initial" : "corrective";
    if (attempt.number !== expectedNumber) {
      addReason(
        errors,
        "invalid_transition",
        `attempts[${index}].number`,
        `Attempt numbers must be sequential; expected ${expectedNumber}.`,
      );
    }
    if (attempt.kind !== expectedKind) {
      addReason(
        errors,
        "invalid_transition",
        `attempts[${index}].kind`,
        `Attempt ${expectedNumber} must have kind ${expectedKind}.`,
      );
    }
    if (index < attempts.length - 1 && attempt.status !== "failed") {
      addReason(
        errors,
        "invalid_transition",
        `attempts[${index}].status`,
        "Only a failed attempt may precede another attempt.",
      );
    }
    if (
      index < attempts.length - 1 &&
      attempt.closureKind !== "domain_failure"
    ) {
      addReason(
        errors,
        "invalid_transition",
        `attempts[${index}].closureKind`,
        "Only a retryable domain-failure closure may precede another attempt.",
      );
    }

    const expectedClosureStatus =
      attempt.closureKind === "none"
        ? "in_progress"
        : attempt.closureKind === "successful_completion"
          ? "passed"
          : "failed";
    if (attempt.status !== expectedClosureStatus) {
      addReason(
        errors,
        "invalid_transition",
        `attempts[${index}].closureKind`,
        `Closure ${attempt.closureKind} requires attempt status ${expectedClosureStatus}.`,
      );
    }

    if (
      attempt.closureKind !== "domain_failure" &&
      attempt.failureFingerprints.length > 0
    ) {
      addReason(
        errors,
        "invalid_transition",
        `attempts[${index}].failureFingerprints`,
        `Closure ${attempt.closureKind} cannot contain a failure fingerprint.`,
      );
    }

    if (attempt.closureKind === "policy_block") {
      requireNoVerificationEvidence(attempt, index, errors);
      if (
        attempt.changedPaths.length === 0 ||
        attempt.reviewStatus !== "not_started"
      ) {
        addReason(
          errors,
          "invalid_transition",
          `attempts[${index}]`,
          "A policy-blocked attempt must close during patch submission.",
        );
      }
    }

    if (attempt.closureKind === "successful_completion") {
      requireVerificationEvidence(
        attempt,
        index,
        requiredVerificationCommands,
        errors,
      );
      if (attempt.reviewStatus !== "passed") {
        addReason(
          errors,
          "invalid_transition",
          `attempts[${index}].reviewStatus`,
          "A successfully completed attempt requires explicit passed review evidence.",
        );
      }
    }

    if (attempt.closureKind === "cancelled") {
      if (attempt.reviewStatus === "pending") {
        requireVerificationEvidence(
          attempt,
          index,
          requiredVerificationCommands,
          errors,
        );
      } else if (attempt.reviewStatus === "not_started") {
        requireNoVerificationEvidence(attempt, index, errors);
      } else {
        addReason(
          errors,
          "invalid_transition",
          `attempts[${index}].reviewStatus`,
          "A cancelled active attempt may only have not_started or pending review state.",
        );
      }
    }
  }

  const activeAttempts = attempts.filter(
    (attempt) => attempt.status === "in_progress",
  );
  if (activeAttempts.length > 1) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "Only one attempt may be in progress.",
    );
  }

  const lastAttempt = attempts.at(-1);
  const activeStatus =
    status === "implementing" || status === "verifying" || status === "reviewing";
  if (activeStatus && lastAttempt?.status !== "in_progress") {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      `Status ${status} requires one active attempt.`,
    );
  }
  if (!activeStatus && activeAttempts.length > 0) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      `Status ${status} cannot contain an active attempt.`,
    );
  }
  if (status === "ready" && attempts.length !== 0) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "A ready run cannot contain attempts.",
    );
  }
  if (status === "implementing" && lastAttempt) {
    requireNoVerificationEvidence(lastAttempt, attempts.length - 1, errors);
    if (
      lastAttempt.changedPaths.length > 0 ||
      lastAttempt.reviewStatus !== "not_started" ||
      lastAttempt.closureKind !== "none"
    ) {
      addReason(
        errors,
        "invalid_transition",
        "attempts",
        "An implementing attempt cannot contain submitted paths or review evidence.",
      );
    }
  }
  if (status === "verifying" && lastAttempt) {
    requireNoVerificationEvidence(lastAttempt, attempts.length - 1, errors);
    if (
      lastAttempt.reviewStatus !== "not_started" ||
      lastAttempt.closureKind !== "none"
    ) {
      addReason(
        errors,
        "invalid_transition",
        "attempts",
        "A verifying attempt cannot contain review or closure evidence.",
      );
    }
  }
  if (status === "reviewing" && lastAttempt) {
    requireVerificationEvidence(
      lastAttempt,
      attempts.length - 1,
      requiredVerificationCommands,
      errors,
    );
    if (
      lastAttempt.reviewStatus !== "pending" ||
      lastAttempt.closureKind !== "none"
    ) {
      addReason(
        errors,
        "invalid_transition",
        "attempts",
        "A reviewing attempt requires pending review evidence and no closure.",
      );
    }
  }
  if (
    (status === "verifying" || status === "reviewing") &&
    lastAttempt?.changedPaths.length === 0
  ) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      `Status ${status} requires submitted changed paths.`,
    );
  }
  if (
    (status === "awaiting_correction" ||
      status === "awaiting_owner_decision") &&
    lastAttempt?.status !== "failed"
  ) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      `Status ${status} requires a failed last attempt.`,
    );
  }
  if (status === "completed" && lastAttempt?.status !== "passed") {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "A completed run requires a passed last attempt.",
    );
  }
  if (
    status === "completed" &&
    lastAttempt?.closureKind !== "successful_completion"
  ) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "A completed run requires successful completion closure evidence.",
    );
  }
  if (status === "blocked" && lastAttempt?.status !== "failed") {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "A blocked run requires a failed last attempt.",
    );
  }
  if (
    status === "cancelled" &&
    lastAttempt !== undefined &&
    lastAttempt.status !== "failed"
  ) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "A cancelled run must close its last attempt as failed.",
    );
  }

  const statusesRequiringEmptyBlockingReasons = [
    "ready",
    "implementing",
    "verifying",
    "reviewing",
    "awaiting_correction",
    "completed",
  ] as const;
  if (
    includesValue(statusesRequiringEmptyBlockingReasons, status) &&
    blockingReasons.length > 0
  ) {
    addReason(
      errors,
      "invalid_transition",
      "blockingReasons",
      `Status ${status} requires empty blockingReasons.`,
    );
  }
  if (status === "blocked" && blockingReasons.length === 0) {
    addReason(
      errors,
      "invalid_transition",
      "blockingReasons",
      "A blocked run requires at least one blocking reason.",
    );
  }
  if (
    status === "awaiting_owner_decision" &&
    !blockingReasons.some(
      (reason) => reason.code === "scope_expansion_required",
    )
  ) {
    addReason(
      errors,
      "invalid_transition",
      "blockingReasons",
      "An awaiting_owner_decision run requires a scope expansion reason.",
    );
  }
  if (
    status === "cancelled" &&
    !blockingReasons.some((reason) => reason.code === "cancelled_by_owner")
  ) {
    addReason(
      errors,
      "invalid_transition",
      "blockingReasons",
      "A cancelled run requires a cancelled_by_owner reason.",
    );
  }
  if (
    lastAttempt?.closureKind === "cancelled" &&
    status !== "cancelled"
  ) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "A cancelled attempt closure requires cancelled run status.",
    );
  }
  if (status === "cancelled") {
    const cancellationReasons = blockingReasons.filter(
      (reason) => reason.code === "cancelled_by_owner",
    );
    const expectedAttemptNumber =
      currentAttemptNumber === 0 ? undefined : currentAttemptNumber;
    if (
      cancellationReasons.length !== 1 ||
      cancellationReasons[0]?.attemptNumber !== expectedAttemptNumber ||
      cancellationReasons[0]?.failureFingerprint !== undefined ||
      (lastAttempt !== undefined &&
        lastAttempt.closureKind !== "cancelled" &&
        lastAttempt.closureKind !== "domain_failure")
    ) {
      addReason(
        errors,
        "invalid_transition",
        "blockingReasons",
        "A cancelled run requires one matching cancellation reason and a reachable attempt closure.",
      );
    }
    if (
      lastAttempt?.closureKind !== "domain_failure" &&
      blockingReasons.some((reason) => reason.code !== "cancelled_by_owner")
    ) {
      addReason(
        errors,
        "invalid_transition",
        "blockingReasons",
        "Cancellation without a domain failure permits only cancelled_by_owner evidence.",
      );
    }
  }

  if (currentAttemptNumber !== attempts.length) {
    addReason(
      errors,
      "invalid_transition",
      "currentAttemptNumber",
      "currentAttemptNumber must equal the number of attempts.",
    );
  }

  const failedByDomain = attempts.filter(
    (attempt) => attempt.closureKind === "domain_failure",
  );
  if (failedByDomain.length !== failures.length) {
    addReason(
      errors,
      "invalid_transition",
      "failures",
      "Each domain-failed attempt must have exactly one stored failure.",
    );
  }

  for (const [failureIndex, attempt] of failedByDomain.entries()) {
    const failure = failures[failureIndex];
    const attemptIndex = attempt.number - 1;
    if (!failure) {
      continue;
    }
    if (
      failure.attemptNumber !== attempt.number ||
      attempt.failureFingerprints.length !== 1 ||
      attempt.failureFingerprints[0] !== failure.fingerprint
    ) {
      addReason(
        errors,
        "invalid_transition",
        `failures[${failureIndex}]`,
        `Failure ${failureIndex + 1} must match attempt ${attempt.number} and its single fingerprint.`,
      );
    }

    if (failure.phase === "implementation") {
      requireNoVerificationEvidence(attempt, attemptIndex, errors);
      if (
        attempt.changedPaths.length > 0 ||
        attempt.reviewStatus !== "not_started"
      ) {
        addReason(
          errors,
          "invalid_transition",
          `attempts[${attemptIndex}]`,
          "An implementation failure must occur before patch submission.",
        );
      }
    } else if (failure.phase === "verification") {
      requireNoVerificationEvidence(attempt, attemptIndex, errors);
      if (
        attempt.changedPaths.length === 0 ||
        attempt.reviewStatus !== "not_started"
      ) {
        addReason(
          errors,
          "invalid_transition",
          `attempts[${attemptIndex}]`,
          "A verification failure requires submitted paths and no review evidence.",
        );
      }
    } else {
      requireVerificationEvidence(
        attempt,
        attemptIndex,
        requiredVerificationCommands,
        errors,
      );
      if (
        attempt.changedPaths.length === 0 ||
        attempt.reviewStatus !== "failed"
      ) {
        addReason(
          errors,
          "invalid_transition",
          `attempts[${attemptIndex}]`,
          "A review failure requires successful verification and failed review evidence.",
        );
      }
    }

    if (attempt.number < attempts.length) {
      const expectation = getFailurePolicyExpectation(
        failure,
        failures.slice(0, failureIndex),
      );
      if (expectation.status !== "awaiting_correction") {
        addReason(
          errors,
          "invalid_transition",
          `attempts[${attemptIndex}]`,
          `Attempt ${attempt.number} could not reach a corrective attempt after status ${expectation.status}.`,
        );
      }
    }
  }

  const lastFailure = failures.at(-1);
  const lastClosure = lastAttempt?.closureKind;
  if (lastClosure === "domain_failure" && lastFailure) {
    const expectation = getFailurePolicyExpectation(
      lastFailure,
      failures.slice(0, -1),
    );
    if (status !== "cancelled" && status !== expectation.status) {
      addReason(
        errors,
        "invalid_transition",
        "status",
        `The last domain failure can only reach status ${expectation.status}.`,
      );
    }
    if (status === "cancelled" && expectation.status === "blocked") {
      addReason(
        errors,
        "invalid_transition",
        "status",
        "A blocked domain failure cannot transition to cancelled.",
      );
    }

    if (status === expectation.status || status === "cancelled") {
      const actualFailureReasons = blockingReasons.filter(
        (reason) => reason.code !== "cancelled_by_owner",
      );
      if (
        actualFailureReasons.length !== expectation.reasonCodes.length ||
        expectation.reasonCodes.some(
          (code, index) => actualFailureReasons[index]?.code !== code,
        ) ||
        actualFailureReasons.some(
          (reason) =>
            reason.attemptNumber !== lastFailure.attemptNumber ||
            reason.failureFingerprint !== lastFailure.fingerprint,
        )
      ) {
        addReason(
          errors,
          "invalid_transition",
          "blockingReasons",
          "Blocking reasons must exactly match the reachable failure-policy outcome.",
        );
      }
    }
  }

  if (
    (status === "awaiting_correction" || status === "awaiting_owner_decision") &&
    lastClosure !== "domain_failure"
  ) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      `Status ${status} requires a matching domain failure closure.`,
    );
  }

  if (status === "blocked" && lastAttempt?.closureKind === "policy_block") {
    const systemForbiddenPaths = lastAttempt.changedPaths.filter(
      isSystemForbiddenRepositoryPath,
    );
    const outsideScopePaths = lastAttempt.changedPaths.filter(
      (path) =>
        !admittedAllowedPaths?.some((admittedPath) =>
          repositoryPathContains(admittedPath, path),
        ),
    );
    const protectedChangedPaths = lastAttempt.changedPaths.filter(
      (changedPath) =>
        protectedPaths?.some((protectedPath) =>
          repositoryPathsOverlap(protectedPath, changedPath),
        ),
    );
    const expectedPolicyReasons =
      systemForbiddenPaths.length > 0
        ? systemForbiddenPaths.map((path) => ({
            code: "system_forbidden_path" as const,
            path,
          }))
        : outsideScopePaths.length > 0
          ? outsideScopePaths.map((path) => ({
              code: "path_outside_admitted_scope" as const,
              path,
            }))
          : protectedChangedPaths.map((path) => ({
              code: "protected_path_modified" as const,
              path,
            }));
    if (
      blockingReasons.length !== expectedPolicyReasons.length ||
      expectedPolicyReasons.some(
        (expected, index) =>
          blockingReasons[index]?.code !== expected.code ||
          blockingReasons[index]?.path !== expected.path,
      ) ||
      blockingReasons.some(
        (reason) =>
          reason.attemptNumber !== lastAttempt.number ||
          reason.failureFingerprint !== undefined,
      )
    ) {
      addReason(
        errors,
        "invalid_transition",
        "blockingReasons",
        "A policy-blocked attempt requires matching changed-path policy reasons.",
      );
    }
  } else if (
    status === "blocked" &&
    lastClosure !== "domain_failure"
  ) {
    addReason(
      errors,
      "invalid_transition",
      "attempts",
      "A blocked run requires domain-failure or policy-block closure evidence.",
    );
  }

  const expectedNextAction = getNextActionForStatus(status);
  if (nextAction !== expectedNextAction) {
    addReason(
      errors,
      "invalid_transition",
      "nextAction",
      `Status ${status} requires nextAction ${expectedNextAction}.`,
    );
  }

  if (
    errors.length > 0 ||
    id === null ||
    planId === null ||
    taskId === null ||
    admittedAllowedPaths === null ||
    requiredVerificationCommands === null ||
    protectedPaths === null ||
    currentAttemptNumber === null ||
    nextAction === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      id,
      planId,
      taskId,
      status,
      admittedAllowedPaths,
      requiredVerificationCommands,
      protectedPaths,
      maxAttempts: 3,
      attempts,
      failures,
      blockingReasons,
      currentAttemptNumber,
      nextAction,
    },
  };
}

export function validateAndNormalizeDevelopmentExecutionRun(
  input: unknown,
): DevelopmentExecutionResult {
  try {
    return validateAndNormalizeDevelopmentExecutionRunInternal(input);
  } catch {
    return {
      ok: false,
      errors: [
        createReason(
          "invalid_transition",
          "$",
          "DevelopmentExecutionRun input could not be safely inspected.",
        ),
      ],
    };
  }
}

function createDevelopmentExecutionRunInternal(
  input: unknown,
): DevelopmentExecutionResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createReason(
          "invalid_transition",
          "$",
          "Development execution creation input must be an object.",
        ),
      ],
    };
  }

  const errors: MutableErrors = [];
  const id = normalizeId(input.id, "id", errors);
  const planId = normalizeId(input.planId, "planId", errors);
  const taskId = normalizeId(input.taskId, "taskId", errors);

  const decision = isRecord(input.admissionDecision)
    ? input.admissionDecision
    : null;
  if (decision === null || decision.verdict !== "allow") {
    addReason(
      errors,
      "admission_not_allowed",
      "admissionDecision.verdict",
      "An execution run requires an AI-009 allow decision.",
    );
  } else {
    if (
      typeof decision.ownerApprovalRequired !== "boolean" ||
      typeof decision.ownerApprovalSatisfied !== "boolean" ||
      (decision.ownerApprovalRequired && !decision.ownerApprovalSatisfied) ||
      (!decision.ownerApprovalRequired && decision.ownerApprovalSatisfied)
    ) {
      addReason(
        errors,
        "admission_not_allowed",
        "admissionDecision.ownerApprovalSatisfied",
        "The allow decision must contain a consistent, already-accounted Owner approval state.",
      );
    }

    if (!Array.isArray(decision.reasons) || decision.reasons.length !== 0) {
      addReason(
        errors,
        "admission_not_allowed",
        "admissionDecision.reasons",
        "An allow decision must not contain admission blocking reasons.",
      );
    }

    if (
      !Array.isArray(decision.conflictingTaskIds) ||
      decision.conflictingTaskIds.length !== 0
    ) {
      addReason(
        errors,
        "admission_not_allowed",
        "admissionDecision.conflictingTaskIds",
        "An allow decision must not contain conflicting task IDs.",
      );
    }
  }

  const admittedTaskId =
    decision === null
      ? null
      : normalizeId(decision.taskId, "admissionDecision.taskId", errors);
  if (
    taskId !== null &&
    admittedTaskId !== null &&
    taskId !== admittedTaskId
  ) {
    addReason(
      errors,
      "admission_task_mismatch",
      "admissionDecision.taskId",
      `Admission task ${admittedTaskId} does not match requested task ${taskId}.`,
    );
  }

  const admittedAllowedPaths = normalizePathCollection(
    decision?.normalizedAllowedPaths,
    "admissionDecision.normalizedAllowedPaths",
    {
      required: true,
      maxItems: developmentExecutionLimits.maxAllowedPaths,
      forbidSystemPaths: true,
    },
    errors,
  );
  const requiredVerificationCommands = normalizeVerificationCommands(
    input.requiredVerificationCommands,
    "requiredVerificationCommands",
    errors,
  );
  const protectedPaths = normalizePathCollection(
    input.protectedPaths,
    "protectedPaths",
    {
      required: false,
      maxItems: developmentExecutionLimits.maxProtectedPaths,
      forbidSystemPaths: false,
    },
    errors,
  );

  if (
    errors.length > 0 ||
    id === null ||
    planId === null ||
    taskId === null ||
    admittedAllowedPaths === null ||
    requiredVerificationCommands === null ||
    protectedPaths === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      id,
      planId,
      taskId,
      status: "ready",
      admittedAllowedPaths,
      requiredVerificationCommands,
      protectedPaths,
      maxAttempts: 3,
      attempts: [],
      failures: [],
      blockingReasons: [],
      currentAttemptNumber: 0,
      nextAction: "start_initial_attempt",
    },
  };
}

export function createDevelopmentExecutionRun(
  input: unknown,
): DevelopmentExecutionResult {
  try {
    return createDevelopmentExecutionRunInternal(input);
  } catch {
    return {
      ok: false,
      errors: [
        createReason(
          "invalid_transition",
          "$",
          "Development execution creation input could not be safely inspected.",
        ),
      ],
    };
  }
}

export function getDevelopmentExecutionNextAction(
  input: unknown,
): DevelopmentExecutionNextActionResult {
  try {
    const validation = validateAndNormalizeDevelopmentExecutionRunInternal(input);
    return validation.ok
      ? { ok: true, value: getNextActionForStatus(validation.value.status) }
      : validation;
  } catch {
    return {
      ok: false,
      errors: [
        createReason(
          "invalid_transition",
          "$",
          "DevelopmentExecutionRun input could not be safely inspected.",
        ),
      ],
    };
  }
}

function transitionError(
  path: string,
  message: string,
  code: DevelopmentExecutionBlockingReasonCode = "invalid_transition",
): DevelopmentExecutionResult {
  return { ok: false, errors: [createReason(code, path, message)] };
}

function withStatus(
  run: DevelopmentExecutionRun,
  status: DevelopmentExecutionStatus,
  updates: Partial<DevelopmentExecutionRun> = {},
): DevelopmentExecutionRun {
  return {
    ...run,
    ...updates,
    status,
    nextAction: getNextActionForStatus(status),
  };
}

function replaceLastAttempt(
  attempts: readonly DevelopmentExecutionAttempt[],
  update: (
    attempt: DevelopmentExecutionAttempt,
  ) => DevelopmentExecutionAttempt,
): readonly DevelopmentExecutionAttempt[] {
  return attempts.map((attempt, index) =>
    index === attempts.length - 1 ? update(attempt) : attempt,
  );
}

function closeAttemptForPolicyBlock(
  run: DevelopmentExecutionRun,
  changedPaths: readonly string[],
  reasons: readonly DevelopmentExecutionBlockingReason[],
): DevelopmentExecutionRun {
  return withStatus(run, "blocked", {
    attempts: replaceLastAttempt(run.attempts, (attempt) => ({
      ...attempt,
      status: "failed",
      changedPaths: [...changedPaths],
      closureKind: "policy_block",
    })),
    blockingReasons: [...run.blockingReasons, ...reasons],
  });
}

function applyFailurePolicy(
  run: DevelopmentExecutionRun,
  failureReport: DevelopmentExecutionFailureReport,
): DevelopmentExecutionRun {
  const attemptNumber = run.currentAttemptNumber;
  const failure: DevelopmentExecutionFailure = {
    attemptNumber,
    ...failureReport,
  };
  const failureOptions = {
    attemptNumber,
    failureFingerprint: failure.fingerprint,
  } as const;
  const attempts = replaceLastAttempt(run.attempts, (attempt) => ({
    ...attempt,
    status: "failed",
    failureFingerprints: [failure.fingerprint],
    reviewStatus: failure.phase === "review" ? "failed" : attempt.reviewStatus,
    closureKind: "domain_failure",
  }));
  const failures = [...run.failures, failure];

  const policyViolationReasons: DevelopmentExecutionBlockingReason[] = [];
  if (failure.systemForbiddenPathViolation) {
    policyViolationReasons.push(
      createReason(
        "system_forbidden_path",
        "failure.systemForbiddenPathViolation",
        "The failure reports a system-forbidden path violation.",
        failureOptions,
      ),
    );
  }
  if (failure.protectedPathViolation) {
    policyViolationReasons.push(
      createReason(
        "protected_path_modified",
        "failure.protectedPathViolation",
        "The failure reports a protected-path violation.",
        failureOptions,
      ),
    );
  }
  if (policyViolationReasons.length > 0) {
    return withStatus(run, "blocked", {
      attempts,
      failures,
      blockingReasons: [...run.blockingReasons, ...policyViolationReasons],
    });
  }

  if (failure.scopeExpansionRequired) {
    return withStatus(run, "awaiting_owner_decision", {
      attempts,
      failures,
      blockingReasons: [
        ...run.blockingReasons,
        createReason(
          "scope_expansion_required",
          "failure.scopeExpansionRequired",
          "Continuing requires a new Owner decision and admission scope.",
          failureOptions,
        ),
      ],
    });
  }

  const blockingReasons: DevelopmentExecutionBlockingReason[] = [];
  if (!failure.retryable) {
    blockingReasons.push(
      createReason(
        "non_retryable_failure",
        "failure.retryable",
        "The reported failure is not retryable.",
        failureOptions,
      ),
    );
  }

  if (
    run.failures.some(
      (previousFailure) =>
        previousFailure.fingerprint === failure.fingerprint,
    )
  ) {
    blockingReasons.push(
      createReason(
        "repeated_failure",
        "failure.fingerprint",
        `Failure fingerprint ${failure.fingerprint} has occurred before.`,
        failureOptions,
      ),
    );
  }

  if (attemptNumber >= developmentExecutionLimits.maxAttempts) {
    blockingReasons.push(
      createReason(
        "attempt_budget_exhausted",
        "currentAttemptNumber",
        `The execution used all ${developmentExecutionLimits.maxAttempts} attempts.`,
        failureOptions,
      ),
    );
  }

  if (blockingReasons.length > 0) {
    return withStatus(run, "blocked", {
      attempts,
      failures,
      blockingReasons: [...run.blockingReasons, ...blockingReasons],
    });
  }

  return withStatus(run, "awaiting_correction", { attempts, failures });
}

function normalizeVerificationChecks(
  input: unknown,
  run: DevelopmentExecutionRun,
):
  | { ok: true; value: readonly DevelopmentExecutionVerificationCheck[] }
  | { ok: false; errors: readonly DevelopmentExecutionBlockingReason[] } {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      errors: [
        createReason(
          "invalid_verification_evidence",
          "event.checks",
          "event.checks must be an array.",
        ),
      ],
    };
  }

  const errors: MutableErrors = [];
  if (input.length > developmentExecutionLimits.maxVerificationCommands) {
    addReason(
      errors,
      "invalid_verification_evidence",
      "event.checks",
      `event.checks must contain at most ${developmentExecutionLimits.maxVerificationCommands} checks.`,
    );
  }

  const checks: DevelopmentExecutionVerificationCheck[] = [];
  for (const [index, checkInput] of input
    .slice(0, developmentExecutionLimits.maxVerificationCommands)
    .entries()) {
    const path = `event.checks[${index}]`;
    if (!isRecord(checkInput)) {
      addReason(
        errors,
        "invalid_verification_evidence",
        path,
        `${path} must be an object.`,
      );
      continue;
    }

    const command = normalizeRequiredText(
      checkInput.command,
      `${path}.command`,
      developmentExecutionLimits.maxStringLength,
      "invalid_verification_evidence",
      errors,
    );
    if (
      typeof checkInput.exitCode !== "number" ||
      !Number.isSafeInteger(checkInput.exitCode)
    ) {
      addReason(
        errors,
        "invalid_verification_evidence",
        `${path}.exitCode`,
        `${path}.exitCode must be a safe integer.`,
      );
    } else if (command !== null) {
      checks.push({ command, exitCode: checkInput.exitCode });
    }
  }

  const counts = new Map<string, number>();
  for (const check of checks) {
    counts.set(check.command, (counts.get(check.command) ?? 0) + 1);
  }

  const requiredSet = new Set(run.requiredVerificationCommands);
  for (const command of [...counts.keys()].sort(compareStrings)) {
    if (!requiredSet.has(command)) {
      addReason(
        errors,
        "invalid_verification_evidence",
        "event.checks",
        `Unknown verification command: ${command}.`,
      );
    } else if ((counts.get(command) ?? 0) !== 1) {
      addReason(
        errors,
        "invalid_verification_evidence",
        "event.checks",
        `Verification command ${command} must appear exactly once.`,
      );
    }
  }

  for (const command of run.requiredVerificationCommands) {
    if (!counts.has(command)) {
      addReason(
        errors,
        "invalid_verification_evidence",
        "event.checks",
        `Missing required verification command: ${command}.`,
      );
    }
  }

  for (const check of [...checks].sort((left, right) =>
    compareStrings(left.command, right.command),
  )) {
    if (requiredSet.has(check.command) && check.exitCode !== 0) {
      addReason(
        errors,
        "invalid_verification_evidence",
        "event.checks",
        `Verification command ${check.command} exited with ${check.exitCode}.`,
      );
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: run.requiredVerificationCommands.map((command) => ({
          command,
          exitCode: 0,
        })),
      };
}

function transitionDevelopmentExecutionRunInternal(
  runInput: unknown,
  eventInput: unknown,
): DevelopmentExecutionResult {
  const validation = validateAndNormalizeDevelopmentExecutionRunInternal(runInput);
  if (!validation.ok) {
    return validation;
  }
  const run = validation.value;

  if (!isRecord(eventInput) || typeof eventInput.type !== "string") {
    return transitionError(
      "event",
      "Development execution event must be a discriminated object.",
    );
  }

  switch (eventInput.type) {
    case "start_attempt": {
      if (run.status !== "ready" && run.status !== "awaiting_correction") {
        return transitionError(
          "event.type",
          `start_attempt is not allowed from status ${run.status}.`,
        );
      }
      if (run.attempts.length >= developmentExecutionLimits.maxAttempts) {
        return transitionError(
          "attempts",
          `No more than ${developmentExecutionLimits.maxAttempts} attempts are allowed.`,
          "attempt_budget_exhausted",
        );
      }

      const number = run.attempts.length + 1;
      const attempt: DevelopmentExecutionAttempt = {
        number,
        kind: number === 1 ? "initial" : "corrective",
        status: "in_progress",
        changedPaths: [],
        failureFingerprints: [],
        verificationChecks: [],
        reviewStatus: "not_started",
        closureKind: "none",
      };
      return {
        ok: true,
        value: withStatus(run, "implementing", {
          attempts: [...run.attempts, attempt],
          currentAttemptNumber: number,
        }),
      };
    }

    case "submit_patch": {
      if (run.status !== "implementing") {
        return transitionError(
          "event.type",
          `submit_patch is not allowed from status ${run.status}.`,
        );
      }

      const pathErrors: MutableErrors = [];
      const changedPaths = normalizePathCollection(
        eventInput.changedPaths,
        "event.changedPaths",
        {
          required: true,
          maxItems: developmentExecutionLimits.maxChangedPaths,
          forbidSystemPaths: false,
        },
        pathErrors,
      );
      if (changedPaths === null) {
        return { ok: false, errors: pathErrors };
      }

      const systemForbiddenReasons = changedPaths
        .filter(isSystemForbiddenRepositoryPath)
        .map((path) =>
          createReason(
            "system_forbidden_path",
            path,
            `Changed path ${path} is forbidden by system policy.`,
            { attemptNumber: run.currentAttemptNumber },
          ),
        );
      if (systemForbiddenReasons.length > 0) {
        return {
          ok: true,
          value: closeAttemptForPolicyBlock(
            run,
            changedPaths,
            systemForbiddenReasons,
          ),
        };
      }

      const outsideScopeReasons = changedPaths
        .filter(
          (path) =>
            !run.admittedAllowedPaths.some((admittedPath) =>
              repositoryPathContains(admittedPath, path),
            ),
        )
        .map((path) =>
          createReason(
            "path_outside_admitted_scope",
            path,
            `Changed path ${path} is outside the admitted scope.`,
            { attemptNumber: run.currentAttemptNumber },
          ),
        );
      if (outsideScopeReasons.length > 0) {
        return {
          ok: true,
          value: closeAttemptForPolicyBlock(
            run,
            changedPaths,
            outsideScopeReasons,
          ),
        };
      }

      const protectedPathReasons: DevelopmentExecutionBlockingReason[] = [];
      for (const changedPath of changedPaths) {
        const protectedPath = run.protectedPaths.find((path) =>
          repositoryPathsOverlap(path, changedPath),
        );
        if (protectedPath) {
          protectedPathReasons.push(
            createReason(
              "protected_path_modified",
              changedPath,
              `Changed path ${changedPath} overlaps protected path ${protectedPath}.`,
              { attemptNumber: run.currentAttemptNumber },
            ),
          );
        }
      }
      if (protectedPathReasons.length > 0) {
        return {
          ok: true,
          value: closeAttemptForPolicyBlock(
            run,
            changedPaths,
            protectedPathReasons,
          ),
        };
      }

      return {
        ok: true,
        value: withStatus(run, "verifying", {
          attempts: replaceLastAttempt(run.attempts, (attempt) => ({
            ...attempt,
            changedPaths: [...changedPaths],
          })),
        }),
      };
    }

    case "implementation_failed":
    case "verification_failed":
    case "review_failed": {
      const expectedStatus =
        eventInput.type === "implementation_failed"
          ? "implementing"
          : eventInput.type === "verification_failed"
            ? "verifying"
            : "reviewing";
      const expectedPhase =
        eventInput.type === "implementation_failed"
          ? "implementation"
          : eventInput.type === "verification_failed"
            ? "verification"
            : "review";
      if (run.status !== expectedStatus) {
        return transitionError(
          "event.type",
          `${eventInput.type} is not allowed from status ${run.status}.`,
        );
      }

      const failure = normalizeFailureInternal(
        eventInput.failure,
        "event.failure",
        expectedPhase,
      );
      if (!failure.ok) {
        return failure;
      }

      return { ok: true, value: applyFailurePolicy(run, failure.value) };
    }

    case "verification_passed": {
      if (run.status !== "verifying") {
        return transitionError(
          "event.type",
          `verification_passed is not allowed from status ${run.status}.`,
        );
      }
      const checks = normalizeVerificationChecks(eventInput.checks, run);
      if (!checks.ok) {
        return checks;
      }
      return {
        ok: true,
        value: withStatus(run, "reviewing", {
          attempts: replaceLastAttempt(run.attempts, (attempt) => ({
            ...attempt,
            verificationChecks: checks.value.map((check) => ({ ...check })),
            reviewStatus: "pending",
          })),
        }),
      };
    }

    case "review_passed": {
      if (run.status !== "reviewing") {
        return transitionError(
          "event.type",
          `review_passed is not allowed from status ${run.status}.`,
        );
      }
      return {
        ok: true,
        value: withStatus(run, "completed", {
          attempts: replaceLastAttempt(run.attempts, (attempt) => ({
            ...attempt,
            status: "passed",
            reviewStatus: "passed",
            closureKind: "successful_completion",
          })),
        }),
      };
    }

    case "cancel": {
      if (
        run.status === "completed" ||
        run.status === "blocked" ||
        run.status === "cancelled"
      ) {
        return transitionError(
          "event.type",
          `cancel is not allowed from terminal status ${run.status}.`,
        );
      }

      const attempts = replaceLastAttempt(run.attempts, (attempt) =>
        attempt.status === "in_progress"
          ? {
              ...attempt,
              status: "failed",
              closureKind: "cancelled",
            }
          : attempt,
      );
      return {
        ok: true,
        value: withStatus(run, "cancelled", {
          attempts,
          blockingReasons: [
            ...run.blockingReasons,
            createReason(
              "cancelled_by_owner",
              "status",
              "The development execution was cancelled by Owner.",
              run.currentAttemptNumber === 0
                ? {}
                : { attemptNumber: run.currentAttemptNumber },
            ),
          ],
        }),
      };
    }

    default:
      return transitionError(
        "event.type",
        `Unknown development execution event: ${eventInput.type}.`,
      );
  }
}

/**
 * Applies a pure execution-state transition. It never runs commands, agents,
 * Git operations, network requests, or any other external action.
 */
export function transitionDevelopmentExecutionRun(
  run: unknown,
  event: unknown,
): DevelopmentExecutionResult {
  try {
    return transitionDevelopmentExecutionRunInternal(run, event);
  } catch {
    return {
      ok: false,
      errors: [
        createReason(
          "invalid_transition",
          "$",
          "Development execution transition could not be safely inspected.",
        ),
      ],
    };
  }
}

export type DevelopmentExecutionCreationInput = Readonly<{
  id: string;
  planId: string;
  taskId: string;
  admissionDecision: DevelopmentTaskAdmissionDecision;
  requiredVerificationCommands: readonly string[];
  protectedPaths: readonly string[];
}>;
