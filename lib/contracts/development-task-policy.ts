import type {
  DevelopmentTask,
  FeaturePlan,
} from "./development-plan";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { findEligibleDevelopmentTaskIds } from "./development-plan.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeFeaturePlan } from "./development-plan.ts";

export const developmentTaskAdmissionVerdicts = [
  "deny",
  "require_approval",
  "allow",
] as const;

export type DevelopmentTaskAdmissionVerdict =
  (typeof developmentTaskAdmissionVerdicts)[number];

export const developmentTaskAdmissionLimits = Object.freeze({
  maxPathLength: 512,
  maxCollectionItems: 64,
  maxReasons: 256,
});

export const systemForbiddenRepositoryPathPolicies = Object.freeze([
  ".git",
  "node_modules",
  ".next",
] as const);

export const systemForbiddenRepositoryPathSegments = Object.freeze([
  ".env",
  ".npmrc",
] as const);

export const systemForbiddenRepositoryPathSegmentPrefixes = Object.freeze([
  ".env.",
] as const);

export const sensitiveRepositoryPathPolicies = Object.freeze([
  ".github/workflows",
  "package.json",
  "package-lock.json",
  "db",
  "app/api",
  "lib/auth",
  "lib/security",
  "middleware.ts",
  "proxy.ts",
] as const);

export type DevelopmentTaskAdmissionReasonCode =
  | "invalid_input"
  | "invalid_plan"
  | "invalid_task_id"
  | "unknown_task_id"
  | "invalid_completed_task_ids"
  | "invalid_active_task_ids"
  | "invalid_repository_allowlist"
  | "invalid_owner_approval"
  | "plan_not_approved"
  | "task_already_completed"
  | "task_already_active"
  | "task_dependencies_incomplete"
  | "inconsistent_completed_task_state"
  | "unknown_active_task_id"
  | "completed_task_marked_active"
  | "invalid_repository_path"
  | "path_outside_repository_allowlist"
  | "system_forbidden_path"
  | "active_task_path_overlap"
  | "task_declares_owner_approval"
  | "risk_requires_owner_approval"
  | "priority_requires_owner_approval"
  | "sensitive_path_requires_owner_approval";

export type DevelopmentTaskAdmissionReason = Readonly<{
  code: DevelopmentTaskAdmissionReasonCode;
  path: string;
  message: string;
  relatedTaskId?: string;
}>;

export type DevelopmentTaskAdmissionInput = Readonly<{
  plan: unknown;
  taskId: unknown;
  completedTaskIds: unknown;
  activeTaskIds: unknown;
  repositoryAllowlist: unknown;
  taskOwnerApprovalGranted: unknown;
}>;

export type DevelopmentTaskAdmissionDecision = Readonly<{
  verdict: DevelopmentTaskAdmissionVerdict;
  taskId: string | null;
  reasons: readonly DevelopmentTaskAdmissionReason[];
  normalizedAllowedPaths: readonly string[];
  conflictingTaskIds: readonly string[];
  ownerApprovalRequired: boolean;
  ownerApprovalSatisfied: boolean;
}>;

export type RepositoryPathNormalizationResult =
  | { ok: true; value: string }
  | { ok: false; reason: DevelopmentTaskAdmissionReason };

type ParsedStringCollection = Readonly<{
  values: readonly string[];
  errors: readonly DevelopmentTaskAdmissionReason[];
}>;

type NormalizedTaskPath = Readonly<{
  value: string;
  sourceIndex: number;
}>;

type NormalizedTaskPaths = Readonly<{
  entries: readonly NormalizedTaskPath[];
  errors: readonly DevelopmentTaskAdmissionReason[];
}>;

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const schemePattern = /^[a-z][a-z0-9+.-]*:/iu;
const globCharacterPattern = /[*?\[\]{}]/u;

function includesValue<const Values extends readonly string[]>(
  values: Values,
  input: unknown,
): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input);
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function compareTasks(left: DevelopmentTask, right: DevelopmentTask): number {
  return left.sequence - right.sequence || compareStrings(left.id, right.id);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function createReason(
  code: DevelopmentTaskAdmissionReasonCode,
  path: string,
  message: string,
  relatedTaskId?: string,
): DevelopmentTaskAdmissionReason {
  return relatedTaskId === undefined
    ? { code, path, message }
    : { code, path, message, relatedTaskId };
}

function appendReason(
  reasons: DevelopmentTaskAdmissionReason[],
  reason: DevelopmentTaskAdmissionReason,
): void {
  if (reasons.length < developmentTaskAdmissionLimits.maxReasons) {
    reasons.push(reason);
  }
}

function appendReasons(
  target: DevelopmentTaskAdmissionReason[],
  source: readonly DevelopmentTaskAdmissionReason[],
): void {
  for (const reason of source) {
    appendReason(target, reason);
  }
}

function createDecision(
  verdict: DevelopmentTaskAdmissionVerdict,
  options: Readonly<{
    taskId?: string | null;
    reasons?: readonly DevelopmentTaskAdmissionReason[];
    normalizedAllowedPaths?: readonly string[];
    conflictingTaskIds?: readonly string[];
    ownerApprovalRequired?: boolean;
    ownerApprovalSatisfied?: boolean;
  }> = {},
): DevelopmentTaskAdmissionDecision {
  return {
    verdict,
    taskId: options.taskId ?? null,
    reasons: [...(options.reasons ?? [])].slice(
      0,
      developmentTaskAdmissionLimits.maxReasons,
    ),
    normalizedAllowedPaths: [...(options.normalizedAllowedPaths ?? [])],
    conflictingTaskIds: [...(options.conflictingTaskIds ?? [])],
    ownerApprovalRequired: options.ownerApprovalRequired ?? false,
    ownerApprovalSatisfied: options.ownerApprovalSatisfied ?? false,
  };
}

export function isDevelopmentTaskAdmissionVerdict(
  input: unknown,
): input is DevelopmentTaskAdmissionVerdict {
  return includesValue(developmentTaskAdmissionVerdicts, input);
}

export function parseDevelopmentTaskAdmissionVerdict(
  input: unknown,
): DevelopmentTaskAdmissionVerdict | null {
  return isDevelopmentTaskAdmissionVerdict(input) ? input : null;
}

function normalizeRepositoryPathAt(
  input: unknown,
  path: string,
): RepositoryPathNormalizationResult {
  const invalid = (message: string): RepositoryPathNormalizationResult => ({
    ok: false,
    reason: createReason("invalid_repository_path", path, message),
  });

  if (typeof input !== "string") {
    return invalid(`${path} must be a repository-relative POSIX path string.`);
  }

  if (controlCharacterPattern.test(input)) {
    return invalid(`${path} must not contain control characters or line breaks.`);
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return invalid(`${path} must not be empty.`);
  }

  if (trimmed.length > developmentTaskAdmissionLimits.maxPathLength) {
    return invalid(
      `${path} must be at most ${developmentTaskAdmissionLimits.maxPathLength} characters.`,
    );
  }

  if (trimmed.startsWith("/")) {
    return invalid(`${path} must be repository-relative, not absolute.`);
  }

  if (trimmed.includes("\\")) {
    return invalid(`${path} must use POSIX separators only.`);
  }

  if (trimmed.includes("//")) {
    return invalid(`${path} must not contain empty path segments.`);
  }

  if (schemePattern.test(trimmed)) {
    return invalid(`${path} must not contain a URL or scheme-like prefix.`);
  }

  if (
    trimmed.startsWith("~") ||
    trimmed === "$HOME" ||
    trimmed.startsWith("$HOME/") ||
    trimmed === "${HOME}" ||
    trimmed.startsWith("${HOME}/")
  ) {
    return invalid(`${path} must not use a home-directory alias.`);
  }

  if (globCharacterPattern.test(trimmed)) {
    return invalid(`${path} must not contain glob characters.`);
  }

  if (trimmed.includes("$(") || trimmed.includes("`")) {
    return invalid(`${path} must not contain shell interpolation markers.`);
  }

  const normalized = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  if (normalized.length === 0) {
    return invalid(`${path} must not be empty.`);
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    return invalid(`${path} must not contain empty path segments.`);
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return invalid(`${path} must not contain . or .. segments.`);
  }

  return { ok: true, value: normalized };
}

export function normalizeRepositoryPath(
  input: unknown,
): RepositoryPathNormalizationResult {
  try {
    return normalizeRepositoryPathAt(input, "$path");
  } catch {
    return {
      ok: false,
      reason: createReason(
        "invalid_repository_path",
        "$path",
        "Repository path could not be safely inspected.",
      ),
    };
  }
}

export function repositoryPathContains(
  parentInput: unknown,
  candidateInput: unknown,
): boolean {
  const parent = normalizeRepositoryPath(parentInput);
  const candidate = normalizeRepositoryPath(candidateInput);

  return (
    parent.ok &&
    candidate.ok &&
    (parent.value === candidate.value ||
      candidate.value.startsWith(`${parent.value}/`))
  );
}

export function repositoryPathsOverlap(
  leftInput: unknown,
  rightInput: unknown,
): boolean {
  return (
    repositoryPathContains(leftInput, rightInput) ||
    repositoryPathContains(rightInput, leftInput)
  );
}

export function isSystemForbiddenRepositoryPath(input: unknown): boolean {
  const normalized = normalizeRepositoryPath(input);
  if (!normalized.ok) {
    return false;
  }

  if (
    systemForbiddenRepositoryPathPolicies.some((policy) =>
      repositoryPathContains(policy, normalized.value),
    )
  ) {
    return true;
  }

  return normalized.value.split("/").some(
    (segment) =>
      systemForbiddenRepositoryPathSegments.some(
        (forbiddenSegment) => segment === forbiddenSegment,
      ) ||
      systemForbiddenRepositoryPathSegmentPrefixes.some((prefix) =>
        segment.startsWith(prefix),
      ),
  );
}

export function isSensitiveRepositoryPath(input: unknown): boolean {
  const normalized = normalizeRepositoryPath(input);
  return (
    normalized.ok &&
    sensitiveRepositoryPathPolicies.some((policy) =>
      repositoryPathsOverlap(policy, normalized.value),
    )
  );
}

function normalizeId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const normalized = input.trim();
  return safeIdPattern.test(normalized) ? normalized : null;
}

function parseIdCollection(
  input: unknown,
  path: "completedTaskIds" | "activeTaskIds",
  errorCode: "invalid_completed_task_ids" | "invalid_active_task_ids",
): ParsedStringCollection {
  const errors: DevelopmentTaskAdmissionReason[] = [];
  if (!Array.isArray(input)) {
    return {
      values: [],
      errors: [createReason(errorCode, path, `${path} must be an array.`)],
    };
  }

  if (input.length > developmentTaskAdmissionLimits.maxCollectionItems) {
    appendReason(
      errors,
      createReason(
        errorCode,
        path,
        `${path} must contain at most ${developmentTaskAdmissionLimits.maxCollectionItems} items.`,
      ),
    );
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input
    .slice(0, developmentTaskAdmissionLimits.maxCollectionItems)
    .entries()) {
    const normalized = normalizeId(item);
    if (normalized === null) {
      appendReason(
        errors,
        createReason(
          errorCode,
          `${path}[${index}]`,
          `${path}[${index}] must be a lowercase safe task ID.`,
        ),
      );
    } else if (!seen.has(normalized)) {
      seen.add(normalized);
      values.push(normalized);
    }
  }

  return { values, errors };
}

function parseRepositoryAllowlist(input: unknown): ParsedStringCollection {
  const errors: DevelopmentTaskAdmissionReason[] = [];
  if (!Array.isArray(input)) {
    return {
      values: [],
      errors: [
        createReason(
          "invalid_repository_allowlist",
          "repositoryAllowlist",
          "repositoryAllowlist must be an array.",
        ),
      ],
    };
  }

  if (input.length > developmentTaskAdmissionLimits.maxCollectionItems) {
    appendReason(
      errors,
      createReason(
        "invalid_repository_allowlist",
        "repositoryAllowlist",
        `repositoryAllowlist must contain at most ${developmentTaskAdmissionLimits.maxCollectionItems} items.`,
      ),
    );
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input
    .slice(0, developmentTaskAdmissionLimits.maxCollectionItems)
    .entries()) {
    const result = normalizeRepositoryPathAt(
      item,
      `repositoryAllowlist[${index}]`,
    );
    if (!result.ok) {
      appendReason(
        errors,
        createReason(
          "invalid_repository_allowlist",
          result.reason.path,
          result.reason.message,
        ),
      );
    } else if (!seen.has(result.value)) {
      seen.add(result.value);
      values.push(result.value);
    }
  }

  return { values, errors };
}

function normalizeTaskPaths(
  task: DevelopmentTask,
  taskIndex: number,
): NormalizedTaskPaths {
  const entries: NormalizedTaskPath[] = [];
  const errors: DevelopmentTaskAdmissionReason[] = [];
  const seen = new Set<string>();

  for (const [pathIndex, pathInput] of task.allowedPaths.entries()) {
    const result = normalizeRepositoryPathAt(
      pathInput,
      `plan.tasks[${taskIndex}].allowedPaths[${pathIndex}]`,
    );
    if (!result.ok) {
      appendReason(errors, result.reason);
    } else if (!seen.has(result.value)) {
      seen.add(result.value);
      entries.push({ value: result.value, sourceIndex: pathIndex });
    }
  }

  return { entries, errors };
}

function mapPlanValidationReasons(
  planInput: unknown,
):
  | { ok: true; plan: FeaturePlan }
  | { ok: false; reasons: readonly DevelopmentTaskAdmissionReason[] } {
  const validation = validateAndNormalizeFeaturePlan(planInput);
  if (validation.ok) {
    return { ok: true, plan: validation.value };
  }

  return {
    ok: false,
    reasons: validation.errors.map((error) =>
      createReason(
        "invalid_plan",
        error.path === "$" ? "plan" : `plan.${error.path}`,
        `FeaturePlan validation failed (${error.code}): ${error.message}`,
      ),
    ),
  };
}

function findTaskIndex(plan: FeaturePlan, taskId: string): number {
  return plan.tasks.findIndex((task) => task.id === taskId);
}

function evaluateDevelopmentTaskAdmissionInternal(
  input: unknown,
): DevelopmentTaskAdmissionDecision {
  if (!isRecord(input)) {
    return createDecision("deny", {
      reasons: [
        createReason(
          "invalid_input",
          "$",
          "DevelopmentTaskAdmissionInput must be an object.",
        ),
      ],
    });
  }

  const parseReasons: DevelopmentTaskAdmissionReason[] = [];
  const planResult = mapPlanValidationReasons(input.plan);
  if (!planResult.ok) {
    appendReasons(parseReasons, planResult.reasons);
  }

  const taskId = normalizeId(input.taskId);
  if (taskId === null) {
    appendReason(
      parseReasons,
      createReason(
        "invalid_task_id",
        "taskId",
        "taskId must be a lowercase safe task ID.",
      ),
    );
  }

  const completed = parseIdCollection(
    input.completedTaskIds,
    "completedTaskIds",
    "invalid_completed_task_ids",
  );
  appendReasons(parseReasons, completed.errors);

  const active = parseIdCollection(
    input.activeTaskIds,
    "activeTaskIds",
    "invalid_active_task_ids",
  );
  appendReasons(parseReasons, active.errors);

  const repositoryAllowlist = parseRepositoryAllowlist(
    input.repositoryAllowlist,
  );
  appendReasons(parseReasons, repositoryAllowlist.errors);

  const ownerApprovalGranted = input.taskOwnerApprovalGranted;
  if (typeof ownerApprovalGranted !== "boolean") {
    appendReason(
      parseReasons,
      createReason(
        "invalid_owner_approval",
        "taskOwnerApprovalGranted",
        "taskOwnerApprovalGranted must be a boolean.",
      ),
    );
  }

  if (
    parseReasons.length > 0 ||
    !planResult.ok ||
    taskId === null ||
    typeof ownerApprovalGranted !== "boolean"
  ) {
    return createDecision("deny", { taskId, reasons: parseReasons });
  }

  const plan = planResult.plan;
  const taskIndex = findTaskIndex(plan, taskId);
  if (taskIndex < 0) {
    return createDecision("deny", {
      taskId,
      reasons: [
        createReason(
          "unknown_task_id",
          "taskId",
          `Task ID ${taskId} does not reference a task in this plan.`,
        ),
      ],
    });
  }

  const task = plan.tasks[taskIndex];
  if (!task) {
    return createDecision("deny", {
      taskId,
      reasons: [
        createReason(
          "invalid_plan",
          "plan.tasks",
          "Validated plan does not contain the requested task.",
        ),
      ],
    });
  }

  const stateReasons: DevelopmentTaskAdmissionReason[] = [];
  if (plan.status !== "approved" && plan.status !== "in_progress") {
    appendReason(
      stateReasons,
      createReason(
        "plan_not_approved",
        "plan.status",
        `Plan status ${plan.status} does not permit task admission.`,
      ),
    );
  }

  const completedSet = new Set(completed.values);
  const activeSet = new Set(active.values);
  const readiness = findEligibleDevelopmentTaskIds(plan, completedSet);
  if (!readiness.ok) {
    for (const error of readiness.errors) {
      appendReason(
        stateReasons,
        createReason(
          error.code === "inconsistent_completed_task_state"
            ? "inconsistent_completed_task_state"
            : "invalid_completed_task_ids",
          "completedTaskIds",
          error.message,
        ),
      );
    }
  }

  const taskById = new Map(plan.tasks.map((planTask) => [planTask.id, planTask]));
  const unknownActiveIds = [...activeSet]
    .filter((activeTaskId) => !taskById.has(activeTaskId))
    .sort(compareStrings);
  for (const activeTaskId of unknownActiveIds) {
    appendReason(
      stateReasons,
      createReason(
        "unknown_active_task_id",
        "activeTaskIds",
        `Active task ID ${activeTaskId} does not reference a task in this plan.`,
        activeTaskId,
      ),
    );
  }

  const completedAndActiveTasks = plan.tasks
    .filter(
      (planTask) => completedSet.has(planTask.id) && activeSet.has(planTask.id),
    )
    .sort(compareTasks);
  for (const inconsistentTask of completedAndActiveTasks) {
    appendReason(
      stateReasons,
      createReason(
        "completed_task_marked_active",
        "activeTaskIds",
        `Task ${inconsistentTask.id} cannot be both completed and active.`,
        inconsistentTask.id,
      ),
    );
  }

  if (completedSet.has(task.id)) {
    appendReason(
      stateReasons,
      createReason(
        "task_already_completed",
        "completedTaskIds",
        `Task ${task.id} is already completed.`,
        task.id,
      ),
    );
  }

  if (activeSet.has(task.id)) {
    appendReason(
      stateReasons,
      createReason(
        "task_already_active",
        "activeTaskIds",
        `Task ${task.id} is already active.`,
        task.id,
      ),
    );
  }

  if (
    readiness.ok &&
    (plan.status === "approved" || plan.status === "in_progress") &&
    !completedSet.has(task.id) &&
    !readiness.value.includes(task.id)
  ) {
    const incompleteDependencies = task.dependencyIds
      .filter((dependencyId) => !completedSet.has(dependencyId))
      .map((dependencyId) => taskById.get(dependencyId))
      .filter((dependency): dependency is DevelopmentTask => dependency !== undefined)
      .sort(compareTasks)
      .map((dependency) => dependency.id);

    appendReason(
      stateReasons,
      createReason(
        "task_dependencies_incomplete",
        `plan.tasks[${taskIndex}].dependencyIds`,
        `Task ${task.id} has incomplete dependencies: ${incompleteDependencies.join(", ")}.`,
        task.id,
      ),
    );
  }

  if (stateReasons.length > 0) {
    return createDecision("deny", { taskId, reasons: stateReasons });
  }

  const candidatePaths = normalizeTaskPaths(task, taskIndex);
  const normalizedAllowedPaths = candidatePaths.entries.map(
    (entry) => entry.value,
  );
  const pathReasons: DevelopmentTaskAdmissionReason[] = [];
  appendReasons(pathReasons, candidatePaths.errors);

  for (const entry of candidatePaths.entries) {
    const path = `plan.tasks[${taskIndex}].allowedPaths[${entry.sourceIndex}]`;
    if (
      !repositoryAllowlist.values.some((allowlistPath) =>
        repositoryPathContains(allowlistPath, entry.value),
      )
    ) {
      appendReason(
        pathReasons,
        createReason(
          "path_outside_repository_allowlist",
          path,
          `Task path ${entry.value} is outside the repository allowlist.`,
        ),
      );
    }

    if (isSystemForbiddenRepositoryPath(entry.value)) {
      appendReason(
        pathReasons,
        createReason(
          "system_forbidden_path",
          path,
          `Task path ${entry.value} is forbidden by system policy.`,
        ),
      );
    }
  }

  if (pathReasons.length > 0) {
    return createDecision("deny", {
      taskId,
      reasons: pathReasons,
      normalizedAllowedPaths,
    });
  }

  const activeTasks = plan.tasks
    .filter((planTask) => activeSet.has(planTask.id))
    .sort(compareTasks);
  const activeTaskPaths = new Map<string, readonly NormalizedTaskPath[]>();
  const activePathReasons: DevelopmentTaskAdmissionReason[] = [];
  for (const activeTask of activeTasks) {
    const activeTaskIndex = findTaskIndex(plan, activeTask.id);
    const paths = normalizeTaskPaths(activeTask, activeTaskIndex);
    activeTaskPaths.set(activeTask.id, paths.entries);
    for (const reason of paths.errors) {
      appendReason(
        activePathReasons,
        { ...reason, relatedTaskId: activeTask.id },
      );
    }
  }

  if (activePathReasons.length > 0) {
    return createDecision("deny", {
      taskId,
      reasons: activePathReasons,
      normalizedAllowedPaths,
    });
  }

  const activeForbiddenPathReasons: DevelopmentTaskAdmissionReason[] = [];
  for (const activeTask of activeTasks) {
    const activeTaskIndex = findTaskIndex(plan, activeTask.id);
    const orderedActivePathEntries = [
      ...(activeTaskPaths.get(activeTask.id) ?? []),
    ].sort(
      (left, right) =>
        compareStrings(left.value, right.value) ||
        left.sourceIndex - right.sourceIndex,
    );

    for (const entry of orderedActivePathEntries) {
      if (isSystemForbiddenRepositoryPath(entry.value)) {
        appendReason(
          activeForbiddenPathReasons,
          createReason(
            "system_forbidden_path",
            `plan.tasks[${activeTaskIndex}].allowedPaths[${entry.sourceIndex}]`,
            `Active task ${activeTask.id} declares system-forbidden path ${entry.value}.`,
            activeTask.id,
          ),
        );
      }
    }
  }

  if (activeForbiddenPathReasons.length > 0) {
    return createDecision("deny", {
      taskId,
      reasons: activeForbiddenPathReasons,
      normalizedAllowedPaths,
    });
  }

  const conflictingTaskIds: string[] = [];
  const overlapReasons: DevelopmentTaskAdmissionReason[] = [];
  const orderedCandidatePaths = [...normalizedAllowedPaths].sort(compareStrings);
  for (const activeTask of activeTasks) {
    const orderedActivePaths = [
      ...(activeTaskPaths.get(activeTask.id) ?? []),
    ]
      .map((entry) => entry.value)
      .sort(compareStrings);
    let overlapPair: readonly [string, string] | null = null;

    for (const candidatePath of orderedCandidatePaths) {
      for (const activePath of orderedActivePaths) {
        if (repositoryPathsOverlap(candidatePath, activePath)) {
          overlapPair = [candidatePath, activePath];
          break;
        }
      }
      if (overlapPair) {
        break;
      }
    }

    if (overlapPair) {
      conflictingTaskIds.push(activeTask.id);
      appendReason(
        overlapReasons,
        createReason(
          "active_task_path_overlap",
          `plan.tasks[${taskIndex}].allowedPaths`,
          `Task ${task.id} path ${overlapPair[0]} overlaps active task ${activeTask.id} path ${overlapPair[1]}.`,
          activeTask.id,
        ),
      );
    }
  }

  if (overlapReasons.length > 0) {
    return createDecision("deny", {
      taskId,
      reasons: overlapReasons,
      normalizedAllowedPaths,
      conflictingTaskIds,
    });
  }

  const approvalReasons: DevelopmentTaskAdmissionReason[] = [];
  if (task.requiresOwnerApproval) {
    appendReason(
      approvalReasons,
      createReason(
        "task_declares_owner_approval",
        `plan.tasks[${taskIndex}].requiresOwnerApproval`,
        `Task ${task.id} explicitly requires Owner approval.`,
        task.id,
      ),
    );
  }

  if (task.riskLevel === "high" || task.riskLevel === "critical") {
    appendReason(
      approvalReasons,
      createReason(
        "risk_requires_owner_approval",
        `plan.tasks[${taskIndex}].riskLevel`,
        `Risk level ${task.riskLevel} requires Owner approval.`,
        task.id,
      ),
    );
  }

  if (task.priority === "P0" || task.priority === "P1") {
    appendReason(
      approvalReasons,
      createReason(
        "priority_requires_owner_approval",
        `plan.tasks[${taskIndex}].priority`,
        `Priority ${task.priority} requires Owner approval.`,
        task.id,
      ),
    );
  }

  const sensitivePaths = normalizedAllowedPaths
    .filter(isSensitiveRepositoryPath)
    .sort(compareStrings);
  if (sensitivePaths.length > 0) {
    appendReason(
      approvalReasons,
      createReason(
        "sensitive_path_requires_owner_approval",
        `plan.tasks[${taskIndex}].allowedPaths`,
        `Sensitive task paths require Owner approval: ${sensitivePaths.join(", ")}.`,
        task.id,
      ),
    );
  }

  const ownerApprovalRequired = approvalReasons.length > 0;
  if (ownerApprovalRequired && !ownerApprovalGranted) {
    return createDecision("require_approval", {
      taskId,
      reasons: approvalReasons,
      normalizedAllowedPaths,
      ownerApprovalRequired: true,
      ownerApprovalSatisfied: false,
    });
  }

  return createDecision("allow", {
    taskId,
    normalizedAllowedPaths,
    ownerApprovalRequired,
    ownerApprovalSatisfied: ownerApprovalRequired && ownerApprovalGranted,
  });
}

/**
 * Produces an admission-only policy decision. An allow verdict does not run a
 * task or authorize shell, Git, publish, deployment, or any external action.
 */
export function evaluateDevelopmentTaskAdmission(
  input: unknown,
): DevelopmentTaskAdmissionDecision {
  try {
    return evaluateDevelopmentTaskAdmissionInternal(input);
  } catch {
    return createDecision("deny", {
      reasons: [
        createReason(
          "invalid_input",
          "$",
          "DevelopmentTaskAdmissionInput could not be safely inspected.",
        ),
      ],
    });
  }
}
