// AI-039 Plan Builder: bounded parser for the untrusted Server Action FormData (no I/O).
//
// The form carries: the hidden opaque idempotency key, the ProjectTask id (a public lookup key, NEVER
// authority — the server re-resolves it inside the trusted workspace), the plan title / goal, the
// ordered step ids (`steps`, one value per step) and, per step, `step.<id>.<field>`. Every other field
// name (except React's own `$ACTION_*` transport fields), any repeated single field, any oversize value
// and any File fails closed (null). Workspace, project, user, plan id, status and revision are never
// read from the form. Content validity (required lists, dependencies, cycles) is NOT judged here: the
// mutation contract validates with the canonical FeaturePlan contract.
import { isProxy } from "node:util/types";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { developmentTaskListFields, featurePlanBuilderLimits, stepIdPattern } from "./feature-plan-model.ts";

export const featurePlanFormFields = Object.freeze(["idempotencyKey", "taskId", "planTitle", "planGoal", "steps"] as const);
export const featurePlanStepTextFields = Object.freeze(["title", "goal", "riskLevel", "priority"] as const);
export const featurePlanStepFields = Object.freeze([...featurePlanStepTextFields, ...developmentTaskListFields, "dependsOn", "requiresOwnerApproval"] as const);

export type FeaturePlanSaveInput = Readonly<{
  idempotencyKey: string;
  taskId: string;
  plan: Readonly<{
    title: string;
    goal: string;
    tasks: readonly Readonly<{
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
      riskLevel: string;
      priority: string;
      requiresOwnerApproval: boolean;
    }>[];
  }>;
}>;

const limits = featurePlanBuilderLimits;
const stepFieldPattern = /^step\.(step-[1-9][0-9]?)\.([A-Za-z]+)$/u;
const stepFieldSet = new Set<string>(featurePlanStepFields);
// Upper bound on FormData entries: singles + step ids + every step field + every dependency choice.
const maxEntries = featurePlanFormFields.length + limits.maxSteps * (featurePlanStepFields.length + limits.maxSteps) + 16;
const maxListRaw = limits.maxListItems * (limits.maxListItemLength + 2);

// One item per line: trimmed, blank lines dropped; bounded count and length. null when over a bound.
function lines(raw: string): string[] | null {
  if (raw.length > maxListRaw) return null;
  const items = raw.split(/\r\n|\r|\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
  if (items.length > limits.maxListItems || items.some((line) => line.length > limits.maxListItemLength)) return null;
  return items;
}

const bounded = (raw: string, max: number): string | null => (raw.length <= max + 64 && raw.trim().length <= max ? raw.trim() : null);

export function featurePlanInputFromForm(form: unknown): FeaturePlanSaveInput | null {
  try {
    if (typeof FormData === "undefined" || !(form instanceof FormData) || isProxy(form)) return null;
    // 1. Every entry: a string value under an allowed name; bounded entry count.
    const singles = new Map<string, string[]>();
    const stepValues = new Map<string, Map<string, string[]>>();
    const stepOrder: string[] = [];
    let entries = 0;
    for (const [name, value] of form.entries()) {
      entries += 1;
      if (entries > maxEntries) return null;
      if (name.startsWith("$ACTION_")) continue;
      if (typeof value !== "string") return null;
      if (name === "steps") {
        stepOrder.push(value);
        continue;
      }
      if ((featurePlanFormFields as readonly string[]).includes(name)) {
        singles.set(name, [...(singles.get(name) ?? []), value]);
        continue;
      }
      const match = stepFieldPattern.exec(name);
      if (!match || !stepFieldSet.has(match[2])) return null;
      const fields = stepValues.get(match[1]) ?? new Map<string, string[]>();
      fields.set(match[2], [...(fields.get(match[2]) ?? []), value]);
      stepValues.set(match[1], fields);
    }
    // 2. Singles exactly once.
    const single = (name: string): string | null => {
      const values = singles.get(name);
      return values && values.length === 1 ? values[0] : null;
    };
    const idempotencyKey = single("idempotencyKey");
    const taskId = single("taskId");
    const planTitle = single("planTitle");
    const planGoal = single("planGoal");
    if (idempotencyKey === null || taskId === null || planTitle === null || planGoal === null) return null;
    if (idempotencyKey.length > 128 || taskId.length > 64) return null;
    const title = bounded(planTitle, limits.maxPlanTitleLength);
    const goal = bounded(planGoal, limits.maxPlanGoalLength);
    if (title === null || goal === null) return null;
    // 3. Steps: 1..maxSteps unique ids in submitted order; fields only for listed steps.
    if (stepOrder.length === 0 || stepOrder.length > limits.maxSteps || new Set(stepOrder).size !== stepOrder.length
      || stepOrder.some((id) => !stepIdPattern.test(id))) return null;
    for (const id of stepValues.keys()) if (!stepOrder.includes(id)) return null;
    const tasks = [];
    for (const [index, id] of stepOrder.entries()) {
      const fields = stepValues.get(id) ?? new Map<string, string[]>();
      const one = (field: string): string | null => {
        const values = fields.get(field);
        return values && values.length === 1 ? values[0] : null;
      };
      const stepTitle = one("title");
      const stepGoal = one("goal");
      const riskLevel = one("riskLevel");
      const priority = one("priority");
      if (stepTitle === null || stepGoal === null || riskLevel === null || priority === null) return null;
      const boundedTitle = bounded(stepTitle, limits.maxStepTitleLength);
      const boundedGoal = bounded(stepGoal, limits.maxStepGoalLength);
      if (boundedTitle === null || boundedGoal === null || riskLevel.length > 16 || priority.length > 4) return null;
      const lists: Record<string, string[]> = {};
      for (const field of developmentTaskListFields) {
        const raw = one(field);
        const parsed = raw === null ? null : lines(raw);
        if (parsed === null) return null;
        lists[field] = parsed;
      }
      const dependsOn = fields.get("dependsOn") ?? [];
      if (dependsOn.length >= limits.maxSteps || new Set(dependsOn).size !== dependsOn.length || dependsOn.some((dependency) => !stepIdPattern.test(dependency))) return null;
      const approval = fields.get("requiresOwnerApproval") ?? [];
      if (approval.length > 1 || (approval.length === 1 && approval[0] !== "yes")) return null;
      tasks.push(Object.freeze({
        id,
        sequence: index + 1,
        title: boundedTitle,
        goal: boundedGoal,
        scope: Object.freeze(lists.scope),
        nonGoals: Object.freeze(lists.nonGoals),
        allowedPaths: Object.freeze(lists.allowedPaths),
        acceptanceCriteria: Object.freeze(lists.acceptanceCriteria),
        verificationCommands: Object.freeze(lists.verificationCommands),
        dependencyIds: Object.freeze([...dependsOn]),
        riskLevel,
        priority,
        requiresOwnerApproval: approval.length === 1,
      }));
    }
    return Object.freeze({ idempotencyKey, taskId, plan: Object.freeze({ title, goal, tasks: Object.freeze(tasks) }) });
  } catch {
    return null;
  }
}
