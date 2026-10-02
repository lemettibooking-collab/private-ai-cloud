// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { parseRiskLevel, type RiskLevel } from "./domain.ts";

export const featurePlanStatuses = [
  "draft",
  "awaiting_approval",
  "approved",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;

export type FeaturePlanStatus = (typeof featurePlanStatuses)[number];

export const developmentPriorities = ["P0", "P1", "P2", "P3", "P4"] as const;

export type DevelopmentPriority = (typeof developmentPriorities)[number];

export const developmentPlanLimits = {
  maxIdLength: 64,
  maxTitleLength: 256,
  maxGoalLength: 4096,
  maxTasks: 64,
  maxListItems: 64,
  maxListItemLength: 1024,
  maxDependenciesPerTask: 63,
  maxCompletedTaskIds: 64,
} as const;

export type DevelopmentTask = Readonly<{
  id: string;
  sequence: number;
  title: string;
  goal: string;
  scope: readonly string[];
  nonGoals: readonly string[];
  allowedPaths: readonly string[];
  acceptanceCriteria: readonly string[];
  verificationCommands: readonly string[];
  dependencyIds: readonly string[];
  riskLevel: RiskLevel;
  priority: DevelopmentPriority;
  requiresOwnerApproval: boolean;
}>;

export type FeaturePlan = Readonly<{
  id: string;
  title: string;
  goal: string;
  status: FeaturePlanStatus;
  tasks: readonly DevelopmentTask[];
}>;

export type DevelopmentPlanValidationErrorCode =
  | "invalid_type"
  | "invalid_input"
  | "required"
  | "invalid_id"
  | "invalid_sequence"
  | "invalid_status"
  | "invalid_priority"
  | "invalid_risk_level"
  | "too_long"
  | "too_many_items"
  | "duplicate_task_id"
  | "duplicate_sequence"
  | "missing_dependency"
  | "self_dependency"
  | "dependency_cycle"
  | "invalid_completed_task_id"
  | "unknown_completed_task_id"
  | "inconsistent_completed_task_state";

export type DevelopmentPlanValidationError = Readonly<{
  code: DevelopmentPlanValidationErrorCode;
  path: string;
  message: string;
}>;

export type DevelopmentPlanValidationResult =
  | { ok: true; value: FeaturePlan }
  | { ok: false; errors: readonly DevelopmentPlanValidationError[] };

export type DevelopmentTaskWavesResult =
  | { ok: true; value: readonly (readonly DevelopmentTask[])[] }
  | { ok: false; errors: readonly DevelopmentPlanValidationError[] };

export type EligibleDevelopmentTaskIdsResult =
  | { ok: true; value: readonly string[] }
  | { ok: false; errors: readonly DevelopmentPlanValidationError[] };

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function includesValue<const Values extends readonly string[]>(
  values: Values,
  input: unknown,
): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input);
}

function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export function isFeaturePlanStatus(input: unknown): input is FeaturePlanStatus {
  return includesValue(featurePlanStatuses, input);
}

export function parseFeaturePlanStatus(
  input: unknown,
): FeaturePlanStatus | null {
  return isFeaturePlanStatus(input) ? input : null;
}

export function isDevelopmentPriority(
  input: unknown,
): input is DevelopmentPriority {
  return includesValue(developmentPriorities, input);
}

export function parseDevelopmentPriority(
  input: unknown,
): DevelopmentPriority | null {
  return isDevelopmentPriority(input) ? input : null;
}

function normalizeString(input: string): string {
  return input.replace(/\r\n?/gu, "\n").trim();
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function addError(
  errors: DevelopmentPlanValidationError[],
  code: DevelopmentPlanValidationErrorCode,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

function normalizeRequiredString(
  input: unknown,
  path: string,
  maxLength: number,
  errors: DevelopmentPlanValidationError[],
): string | null {
  if (typeof input !== "string") {
    addError(errors, "invalid_type", path, `${path} must be a string.`);
    return null;
  }

  const value = normalizeString(input);

  if (value.length === 0) {
    addError(errors, "required", path, `${path} must not be empty.`);
    return null;
  }

  if (value.length > maxLength) {
    addError(
      errors,
      "too_long",
      path,
      `${path} must be at most ${maxLength} characters.`,
    );
    return null;
  }

  return value;
}

function normalizeId(
  input: unknown,
  path: string,
  errors: DevelopmentPlanValidationError[],
): string | null {
  if (typeof input !== "string") {
    addError(errors, "invalid_type", path, `${path} must be a string.`);
    return null;
  }

  const value = normalizeString(input);

  if (!safeIdPattern.test(value)) {
    addError(
      errors,
      "invalid_id",
      path,
      `${path} must match ^[a-z0-9][a-z0-9._-]{0,63}$.`,
    );
    return null;
  }

  return value;
}

function normalizeStringList(
  input: unknown,
  path: string,
  options: Readonly<{ required: boolean; maxItems: number }>,
  errors: DevelopmentPlanValidationError[],
): readonly string[] | null {
  if (!Array.isArray(input)) {
    addError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }

  let hasError = false;
  if (input.length > options.maxItems) {
    addError(
      errors,
      "too_many_items",
      path,
      `${path} must contain at most ${options.maxItems} items.`,
    );
    hasError = true;
  }

  const values: string[] = [];
  const seen = new Set<string>();
  const inspectedItems = input.slice(0, options.maxItems);

  for (const [index, item] of inspectedItems.entries()) {
    const itemPath = `${path}[${index}]`;

    if (typeof item !== "string") {
      addError(errors, "invalid_type", itemPath, `${itemPath} must be a string.`);
      hasError = true;
      continue;
    }

    const value = normalizeString(item);
    if (value.length === 0) {
      continue;
    }

    if (value.length > developmentPlanLimits.maxListItemLength) {
      addError(
        errors,
        "too_long",
        itemPath,
        `${itemPath} must be at most ${developmentPlanLimits.maxListItemLength} characters.`,
      );
      hasError = true;
      continue;
    }

    if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }

  if (options.required && values.length === 0) {
    addError(errors, "required", path, `${path} must contain at least one item.`);
    hasError = true;
  }

  return hasError ? null : values;
}

function normalizeDependencyIds(
  input: unknown,
  path: string,
  errors: DevelopmentPlanValidationError[],
): readonly string[] | null {
  const values = normalizeStringList(
    input,
    path,
    { required: false, maxItems: developmentPlanLimits.maxDependenciesPerTask },
    errors,
  );

  if (values === null) {
    return null;
  }

  let hasError = false;
  for (const [index, value] of values.entries()) {
    if (!safeIdPattern.test(value)) {
      addError(
        errors,
        "invalid_id",
        `${path}[${index}]`,
        `${path}[${index}] must match ^[a-z0-9][a-z0-9._-]{0,63}$.`,
      );
      hasError = true;
    }
  }

  return hasError ? null : values;
}

type ParsedTask = Readonly<{ task: DevelopmentTask; sourceIndex: number }>;

function normalizeTask(
  input: unknown,
  sourceIndex: number,
  errors: DevelopmentPlanValidationError[],
): ParsedTask | null {
  const path = `tasks[${sourceIndex}]`;
  if (!isRecord(input)) {
    addError(errors, "invalid_type", path, `${path} must be an object.`);
    return null;
  }

  const initialErrorCount = errors.length;
  const id = normalizeId(input.id, `${path}.id`, errors);

  let sequence: number | null = null;
  if (
    typeof input.sequence !== "number" ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence <= 0
  ) {
    addError(
      errors,
      "invalid_sequence",
      `${path}.sequence`,
      `${path}.sequence must be a positive safe integer.`,
    );
  } else {
    sequence = input.sequence;
  }

  const title = normalizeRequiredString(
    input.title,
    `${path}.title`,
    developmentPlanLimits.maxTitleLength,
    errors,
  );
  const goal = normalizeRequiredString(
    input.goal,
    `${path}.goal`,
    developmentPlanLimits.maxGoalLength,
    errors,
  );
  const scope = normalizeStringList(
    input.scope,
    `${path}.scope`,
    { required: true, maxItems: developmentPlanLimits.maxListItems },
    errors,
  );
  const nonGoals = normalizeStringList(
    input.nonGoals,
    `${path}.nonGoals`,
    { required: false, maxItems: developmentPlanLimits.maxListItems },
    errors,
  );
  const allowedPaths = normalizeStringList(
    input.allowedPaths,
    `${path}.allowedPaths`,
    { required: true, maxItems: developmentPlanLimits.maxListItems },
    errors,
  );
  const acceptanceCriteria = normalizeStringList(
    input.acceptanceCriteria,
    `${path}.acceptanceCriteria`,
    { required: true, maxItems: developmentPlanLimits.maxListItems },
    errors,
  );
  const verificationCommands = normalizeStringList(
    input.verificationCommands,
    `${path}.verificationCommands`,
    { required: true, maxItems: developmentPlanLimits.maxListItems },
    errors,
  );
  const dependencyIds = normalizeDependencyIds(
    input.dependencyIds,
    `${path}.dependencyIds`,
    errors,
  );

  const normalizedRisk =
    typeof input.riskLevel === "string"
      ? normalizeString(input.riskLevel)
      : input.riskLevel;
  const riskLevel = parseRiskLevel(normalizedRisk);
  if (riskLevel === null) {
    addError(
      errors,
      "invalid_risk_level",
      `${path}.riskLevel`,
      `${path}.riskLevel must be a canonical RiskLevel.`,
    );
  }

  const normalizedPriority =
    typeof input.priority === "string"
      ? normalizeString(input.priority)
      : input.priority;
  const priority = parseDevelopmentPriority(normalizedPriority);
  if (priority === null) {
    addError(
      errors,
      "invalid_priority",
      `${path}.priority`,
      `${path}.priority must be one of ${developmentPriorities.join(", ")}.`,
    );
  }

  let requiresOwnerApproval: boolean | null = null;
  if (typeof input.requiresOwnerApproval !== "boolean") {
    addError(
      errors,
      "invalid_type",
      `${path}.requiresOwnerApproval`,
      `${path}.requiresOwnerApproval must be a boolean.`,
    );
  } else {
    requiresOwnerApproval = input.requiresOwnerApproval;
  }

  if (
    errors.length !== initialErrorCount ||
    id === null ||
    sequence === null ||
    title === null ||
    goal === null ||
    scope === null ||
    nonGoals === null ||
    allowedPaths === null ||
    acceptanceCriteria === null ||
    verificationCommands === null ||
    dependencyIds === null ||
    riskLevel === null ||
    priority === null ||
    requiresOwnerApproval === null
  ) {
    return null;
  }

  return {
    sourceIndex,
    task: {
      id,
      sequence,
      title,
      goal,
      scope,
      nonGoals,
      allowedPaths,
      acceptanceCriteria,
      verificationCommands,
      dependencyIds,
      riskLevel,
      priority,
      requiresOwnerApproval,
    },
  };
}

function findCycleError(
  parsedTasks: readonly ParsedTask[],
): DevelopmentPlanValidationError | null {
  const orderedTasks = [...parsedTasks].sort(
    (left, right) =>
      left.task.sequence - right.task.sequence ||
      compareIds(left.task.id, right.task.id),
  );
  const taskById = new Map(orderedTasks.map((entry) => [entry.task.id, entry]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (taskId: string): DevelopmentPlanValidationError | null => {
    state.set(taskId, 1);
    stack.push(taskId);

    const entry = taskById.get(taskId);
    if (!entry) {
      return {
        code: "invalid_input",
        path: "tasks",
        message: "The dependency graph contains an unknown task.",
      };
    }

    const dependencies = [...entry.task.dependencyIds].sort((left, right) => {
      const leftTask = taskById.get(left)?.task;
      const rightTask = taskById.get(right)?.task;
      return (
        (leftTask?.sequence ?? 0) - (rightTask?.sequence ?? 0) ||
        compareIds(left, right)
      );
    });

    for (const dependencyId of dependencies) {
      const dependencyState = state.get(dependencyId) ?? 0;
      if (dependencyState === 0) {
        const nestedError = visit(dependencyId);
        if (nestedError) {
          return nestedError;
        }
      } else if (dependencyState === 1) {
        const cycleStart = stack.indexOf(dependencyId);
        const cycle = [...stack.slice(cycleStart), dependencyId];
        const dependencyIndex = entry.task.dependencyIds.indexOf(dependencyId);

        return {
          code: "dependency_cycle",
          path: `tasks[${entry.sourceIndex}].dependencyIds[${dependencyIndex}]`,
          message: `Dependency cycle detected: ${cycle.join(" -> ")}.`,
        };
      }
    }

    stack.pop();
    state.set(taskId, 2);
    return null;
  };

  for (const { task } of orderedTasks) {
    if ((state.get(task.id) ?? 0) === 0) {
      const error = visit(task.id);
      if (error) {
        return error;
      }
    }
  }

  return null;
}

function validateAndNormalizeFeaturePlanInternal(
  input: unknown,
): DevelopmentPlanValidationResult {
  const errors: DevelopmentPlanValidationError[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_type",
          path: "$",
          message: "FeaturePlan input must be an object.",
        },
      ],
    };
  }

  const id = normalizeId(input.id, "id", errors);
  const title = normalizeRequiredString(
    input.title,
    "title",
    developmentPlanLimits.maxTitleLength,
    errors,
  );
  const goal = normalizeRequiredString(
    input.goal,
    "goal",
    developmentPlanLimits.maxGoalLength,
    errors,
  );

  const normalizedStatus =
    typeof input.status === "string" ? normalizeString(input.status) : input.status;
  const status = parseFeaturePlanStatus(normalizedStatus);
  if (status === null) {
    addError(
      errors,
      "invalid_status",
      "status",
      `status must be one of ${featurePlanStatuses.join(", ")}.`,
    );
  }

  const parsedTasks: ParsedTask[] = [];
  if (!Array.isArray(input.tasks)) {
    addError(errors, "invalid_type", "tasks", "tasks must be an array.");
  } else if (input.tasks.length === 0) {
    addError(errors, "required", "tasks", "tasks must contain at least one task.");
  } else {
    if (input.tasks.length > developmentPlanLimits.maxTasks) {
      addError(
        errors,
        "too_many_items",
        "tasks",
        `tasks must contain at most ${developmentPlanLimits.maxTasks} tasks.`,
      );
    }

    for (const [index, taskInput] of input.tasks
      .slice(0, developmentPlanLimits.maxTasks)
      .entries()) {
      const parsedTask = normalizeTask(taskInput, index, errors);
      if (parsedTask) {
        parsedTasks.push(parsedTask);
      }
    }
  }

  if (
    errors.length > 0 ||
    id === null ||
    title === null ||
    goal === null ||
    status === null
  ) {
    return { ok: false, errors };
  }

  const firstTaskIndexById = new Map<string, number>();
  const firstTaskIndexBySequence = new Map<number, number>();
  for (const { task, sourceIndex } of parsedTasks) {
    const firstIdIndex = firstTaskIndexById.get(task.id);
    if (firstIdIndex !== undefined) {
      addError(
        errors,
        "duplicate_task_id",
        `tasks[${sourceIndex}].id`,
        `Task id ${task.id} duplicates tasks[${firstIdIndex}].id.`,
      );
    } else {
      firstTaskIndexById.set(task.id, sourceIndex);
    }

    const firstSequenceIndex = firstTaskIndexBySequence.get(task.sequence);
    if (firstSequenceIndex !== undefined) {
      addError(
        errors,
        "duplicate_sequence",
        `tasks[${sourceIndex}].sequence`,
        `Task sequence ${task.sequence} duplicates tasks[${firstSequenceIndex}].sequence.`,
      );
    } else {
      firstTaskIndexBySequence.set(task.sequence, sourceIndex);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const taskIds = new Set(parsedTasks.map(({ task }) => task.id));
  for (const { task, sourceIndex } of parsedTasks) {
    for (const [dependencyIndex, dependencyId] of task.dependencyIds.entries()) {
      const path = `tasks[${sourceIndex}].dependencyIds[${dependencyIndex}]`;
      if (dependencyId === task.id) {
        addError(
          errors,
          "self_dependency",
          path,
          `Task ${task.id} cannot depend on itself.`,
        );
      } else if (!taskIds.has(dependencyId)) {
        addError(
          errors,
          "missing_dependency",
          path,
          `Dependency ${dependencyId} does not reference a task in this plan.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const cycleError = findCycleError(parsedTasks);
  if (cycleError) {
    return { ok: false, errors: [cycleError] };
  }

  return {
    ok: true,
    value: {
      id,
      title,
      goal,
      status,
      tasks: parsedTasks.map(({ task }) => task),
    },
  };
}

export function validateAndNormalizeFeaturePlan(
  input: unknown,
): DevelopmentPlanValidationResult {
  try {
    return validateAndNormalizeFeaturePlanInternal(input);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_input",
          path: "$",
          message: "FeaturePlan input could not be safely inspected.",
        },
      ],
    };
  }
}

function sortTasksBySequence(tasks: readonly DevelopmentTask[]): DevelopmentTask[] {
  return [...tasks].sort(
    (left, right) =>
      left.sequence - right.sequence || compareIds(left.id, right.id),
  );
}

/**
 * A dependency wave is only a logical dependency grouping. It does not
 * authorize parallel editing or execution.
 */
export function buildDevelopmentTaskWaves(
  input: unknown,
): DevelopmentTaskWavesResult {
  const validation = validateAndNormalizeFeaturePlan(input);
  if (!validation.ok) {
    return validation;
  }

  const remaining = new Map(
    validation.value.tasks.map((task) => [task.id, task] as const),
  );
  const completed = new Set<string>();
  const waves: DevelopmentTask[][] = [];

  while (remaining.size > 0) {
    const wave = sortTasksBySequence(
      [...remaining.values()].filter((task) =>
        task.dependencyIds.every((dependencyId) => completed.has(dependencyId)),
      ),
    );

    if (wave.length === 0) {
      return {
        ok: false,
        errors: [
          {
            code: "dependency_cycle",
            path: "tasks",
            message: "Dependency waves cannot be built from an invalid graph.",
          },
        ],
      };
    }

    waves.push(wave);
    for (const task of wave) {
      remaining.delete(task.id);
      completed.add(task.id);
    }
  }

  return { ok: true, value: waves };
}

function normalizeCompletedTaskIds(
  input: unknown,
  plan: FeaturePlan,
):
  | { ok: true; value: ReadonlySet<string> }
  | { ok: false; errors: readonly DevelopmentPlanValidationError[] } {
  if (!(input instanceof Set)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_type",
          path: "completedTaskIds",
          message: "completedTaskIds must be a ReadonlySet of task IDs.",
        },
      ],
    };
  }

  const errors: DevelopmentPlanValidationError[] = [];
  if (input.size > developmentPlanLimits.maxCompletedTaskIds) {
    addError(
      errors,
      "too_many_items",
      "completedTaskIds",
      `completedTaskIds must contain at most ${developmentPlanLimits.maxCompletedTaskIds} IDs.`,
    );
  }

  const completedIds: string[] = [];
  let index = 0;
  for (const item of input) {
    if (index >= developmentPlanLimits.maxCompletedTaskIds) {
      break;
    }

    const path = `completedTaskIds[${index}]`;
    if (typeof item !== "string") {
      addError(
        errors,
        "invalid_completed_task_id",
        path,
        `${path} must be a task ID string.`,
      );
      index += 1;
      continue;
    }

    const value = normalizeString(item);
    if (!safeIdPattern.test(value)) {
      addError(
        errors,
        "invalid_completed_task_id",
        path,
        `${path} must match ^[a-z0-9][a-z0-9._-]{0,63}$.`,
      );
      index += 1;
      continue;
    }

    completedIds.push(value);
    index += 1;
  }

  const knownIds = new Set(plan.tasks.map((task) => task.id));
  for (const taskId of [...new Set(completedIds)].sort(compareIds)) {
    if (!knownIds.has(taskId)) {
      addError(
        errors,
        "unknown_completed_task_id",
        "completedTaskIds",
        `Completed task ID ${taskId} does not reference a task in this plan.`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const completedIdSet = new Set(completedIds);
  const taskById = new Map(plan.tasks.map((task) => [task.id, task] as const));
  const completedTasks = sortTasksBySequence(
    plan.tasks.filter((task) => completedIdSet.has(task.id)),
  );

  for (const task of completedTasks) {
    const orderedDependencies = [...task.dependencyIds].sort((left, right) => {
      const leftTask = taskById.get(left);
      const rightTask = taskById.get(right);

      return (
        (leftTask?.sequence ?? 0) - (rightTask?.sequence ?? 0) ||
        compareIds(left, right)
      );
    });

    for (const dependencyId of orderedDependencies) {
      if (!completedIdSet.has(dependencyId)) {
        addError(
          errors,
          "inconsistent_completed_task_state",
          "completedTaskIds",
          `Completed task ${task.id} depends on incomplete task ${dependencyId}.`,
        );
      }
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: completedIdSet };
}

/**
 * Returns dependency-ready candidates only. It does not authorize execution
 * and does not evaluate requiresOwnerApproval, risk policy, path ownership,
 * path overlap, or security gates.
 */
export function findEligibleDevelopmentTaskIds(
  input: unknown,
  completedTaskIds: ReadonlySet<string>,
): EligibleDevelopmentTaskIdsResult {
  try {
    const validation = validateAndNormalizeFeaturePlan(input);
    if (!validation.ok) {
      return validation;
    }

    const completed = normalizeCompletedTaskIds(
      completedTaskIds,
      validation.value,
    );
    if (!completed.ok) {
      return completed;
    }

    if (
      validation.value.status !== "approved" &&
      validation.value.status !== "in_progress"
    ) {
      return { ok: true, value: [] };
    }

    const eligibleIds = sortTasksBySequence(validation.value.tasks)
      .filter(
        (task) =>
          !completed.value.has(task.id) &&
          task.dependencyIds.every((dependencyId) =>
            completed.value.has(dependencyId),
          ),
      )
      .map((task) => task.id);

    return { ok: true, value: eligibleIds };
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_input",
          path: "$",
          message: "Eligibility input could not be safely inspected.",
        },
      ],
    };
  }
}
