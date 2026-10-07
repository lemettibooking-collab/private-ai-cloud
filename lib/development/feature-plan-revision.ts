// AI-039: server-side FeaturePlan revision normalization and fingerprints (no I/O).
//
// Untrusted plan content → strict plain-data copy → id + status "draft" set by the server →
// validateAndNormalizeFeaturePlan (the ONE FeaturePlan contract) → canonical form → sha256 fingerprints.
// Fingerprints are computed from the canonical normalized plan, never from raw form data, so two
// submissions that normalize to the same plan have the same fingerprint.
import { createHash, randomBytes } from "node:crypto";
import { isProxy } from "node:util/types";
import type { DevelopmentPlanValidationErrorCode, FeaturePlan } from "../contracts/development-plan";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { developmentPlanLimits, validateAndNormalizeFeaturePlan } from "../contracts/development-plan.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { canonicalFeaturePlan, planKeyPattern } from "./feature-plan-model.ts";

// A validation problem as the Owner sees it: the contract's code, the field and the 0-based step
// position only — never the contract's message text, values or internal paths.
export type PublicPlanError = Readonly<{
  code: DevelopmentPlanValidationErrorCode;
  field: "planTitle" | "planGoal" | "tasks" | "title" | "goal" | "scope" | "nonGoals" | "allowedPaths" | "acceptanceCriteria"
    | "verificationCommands" | "dependencyIds" | "riskLevel" | "priority" | "requiresOwnerApproval" | "id" | "sequence" | "plan";
  step: number | null;
}>;

export type DraftPlanNormalization =
  | Readonly<{ ok: true; plan: FeaturePlan }>
  | Readonly<{ ok: false; errors: readonly PublicPlanError[] }>;

export const maxPublicPlanErrors = 12;

const contentFields = ["title", "goal", "tasks"] as const;
const taskFields = new Set(["title", "goal", "scope", "nonGoals", "allowedPaths", "acceptanceCriteria", "verificationCommands", "dependencyIds", "riskLevel", "priority", "requiresOwnerApproval", "id", "sequence"]);
const knownCodes = new Set<string>(["invalid_type", "invalid_input", "required", "invalid_id", "invalid_sequence", "invalid_status", "invalid_priority",
  "invalid_risk_level", "too_long", "too_many_items", "duplicate_task_id", "duplicate_sequence", "missing_dependency", "self_dependency", "dependency_cycle"]);

const INVALID = Symbol("invalid");
const maxStringLength = developmentPlanLimits.maxGoalLength + 1;
const maxArrayLength = Math.max(developmentPlanLimits.maxTasks, developmentPlanLimits.maxListItems) + 1;

// Strict plain-data copy of untrusted input: plain objects (Object.prototype / null prototype) with
// own data properties, arrays, strings, finite numbers, booleans and null — no Proxy, accessor, symbol
// key, function or exotic object, bounded depth / size. Getters never run. Anything else → INVALID.
function plainData(value: unknown, depth: number, budget: { nodes: number }): unknown {
  budget.nodes -= 1;
  if (budget.nodes < 0 || depth > 5) return INVALID;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length <= maxStringLength ? value : INVALID;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID;
  if (typeof value !== "object" || isProxy(value)) return INVALID;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > maxArrayLength) return INVALID;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) return INVALID; // indices + "length" only (no holes, no extras)
    const copy: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return INVALID;
      const item = plainData(descriptor.value, depth + 1, budget);
      if (item === INVALID) return INVALID;
      copy.push(item);
    }
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return INVALID;
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key === "__proto__") return INVALID;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return INVALID;
    const item = plainData(descriptor.value, depth + 1, budget);
    if (item === INVALID) return INVALID;
    copy[key] = item;
  }
  return copy;
}

function publicError(code: string, path: string): PublicPlanError {
  const safeCode = (knownCodes.has(code) ? code : "invalid_input") as DevelopmentPlanValidationErrorCode;
  if (path === "title") return { code: safeCode, field: "planTitle", step: null };
  if (path === "goal") return { code: safeCode, field: "planGoal", step: null };
  if (path === "tasks") return { code: safeCode, field: "tasks", step: null };
  const match = /^tasks\[(\d{1,3})\]\.([A-Za-z]+)/u.exec(path);
  if (match && taskFields.has(match[2])) return { code: safeCode, field: match[2] as PublicPlanError["field"], step: Number(match[1]) };
  if (/^tasks\[(\d{1,3})\]$/u.test(path)) return { code: safeCode, field: "tasks", step: Number(/\d+/u.exec(path)![0]) };
  return { code: safeCode, field: "plan", step: null };
}

// Plan content { title, goal, tasks } + a server plan id → the canonical validated draft FeaturePlan,
// or bounded public errors. The status is always "draft"; the caller never supplies id or status.
export function normalizeDraftPlan(content: unknown, planId: string): DraftPlanNormalization {
  if (!planKeyPattern.test(planId)) return { ok: false, errors: [{ code: "invalid_input", field: "plan", step: null }] };
  const copy = plainData(content, 0, { nodes: 40_000 });
  if (copy === INVALID || typeof copy !== "object" || copy === null || Array.isArray(copy)) {
    return { ok: false, errors: [{ code: "invalid_input", field: "plan", step: null }] };
  }
  const keys = Object.keys(copy);
  if (keys.length !== contentFields.length || !contentFields.every((field) => keys.includes(field))) {
    return { ok: false, errors: [{ code: "invalid_input", field: "plan", step: null }] };
  }
  const record = copy as Record<string, unknown>;
  const result = validateAndNormalizeFeaturePlan({ id: planId, title: record.title, goal: record.goal, status: "draft", tasks: record.tasks });
  if (!result.ok) {
    const seen = new Set<string>();
    const errors: PublicPlanError[] = [];
    for (const error of result.errors) {
      const mapped = publicError(error.code, error.path);
      const key = `${mapped.code}|${mapped.field}|${mapped.step}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(Object.freeze(mapped));
      if (errors.length >= maxPublicPlanErrors) break;
    }
    return { ok: false, errors: Object.freeze(errors) };
  }
  if (result.value.status !== "draft" || result.value.id !== planId) return { ok: false, errors: [{ code: "invalid_input", field: "plan", step: null }] };
  return { ok: true, plan: canonicalFeaturePlan(result.value) };
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// sha256 of the canonical serialization (canonicalFeaturePlan fixes every key order).
export function featurePlanFingerprint(plan: FeaturePlan): string {
  return sha256(JSON.stringify(canonicalFeaturePlan(plan)));
}

// The immutable save intent: WHICH task and WHAT plan content (the server-assigned plan id excluded,
// so an exact replay matches before and after the id exists). Versioned.
export function saveIntentFingerprint(taskId: string, plan: FeaturePlan): string {
  return sha256(JSON.stringify(["pac.feature-plan-save.v1", taskId, { ...canonicalFeaturePlan(plan), id: null }]));
}

// Server-generated plan key: 80 bits of CSPRNG entropy, never derived from task, title or time.
export function newPlanKey(): string {
  return `plan-${randomBytes(10).toString("hex")}`;
}

// A placeholder id used ONLY to validate content before the real key is known (never stored).
export const provisionalPlanKey = "plan-00000000000000000000";
