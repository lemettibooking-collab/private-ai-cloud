import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import type { ProjectTaskStatus, ProjectTaskType } from "../tasks/project-task";
import type { FeaturePlan } from "../contracts/development-plan";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { exactOwnData } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { isTaskKey, isProjectTaskStatus } from "../tasks/project-task.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { normalizeDraftPlan, featurePlanFingerprint } from "../development/feature-plan-revision.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { validateAndNormalizeFeaturePlan, buildDevelopmentTaskWaves } from "../contracts/development-plan.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { canonicalFeaturePlan } from "../development/feature-plan-model.ts";

export const roadmapLimits = Object.freeze({ maxTasks: 256, maxDependencies: 64, maxItems: 32, maxText: 1000 });
export const roadmapPurposes = Object.freeze(["feature_plan_approval", "scope_change", "budget_or_risk_increase", "architecture_change", "result_acceptance"] as const);
export type RoadmapApprovalPurpose = typeof roadmapPurposes[number];
export type RoadmapTaskClass = "implementation" | "repair" | "analysis";
export const compareRoadmapIds = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
/** Detached bounded canonical data only. Never stringify caller/proxy/accessor objects. */
export function captureRoadmapData(raw: unknown): unknown {
  const budget = { nodes: 100000, characters: 1048576 };
  function copy(value: unknown, depth: number): unknown {
    if (--budget.nodes < 0 || depth > 16) throw new Error("Invalid bounded roadmap data.");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { budget.characters -= value.length; if (value.length > 16384 || budget.characters < 0) throw new Error("Invalid bounded roadmap data."); return value; }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || isProxy(value)) throw new Error("Invalid bounded roadmap data.");
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 4096 || Reflect.ownKeys(value).length !== value.length + 1) throw new Error("Invalid bounded roadmap data.");
      const out: unknown[] = []; for (let i=0;i<value.length;i++) { const d=Object.getOwnPropertyDescriptor(value,i); if(!d||!("value" in d))throw new Error("Invalid bounded roadmap data.");out.push(copy(d.value,depth+1)); }return Object.freeze(out);
    }
    if (Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)throw new Error("Invalid bounded roadmap data.");
    const keys=Reflect.ownKeys(value);if(keys.length>64||keys.some(k=>typeof k!=="string"||k==="__proto__"||k.length>256))throw new Error("Invalid bounded roadmap data.");
    for(const key of keys as string[]){budget.characters-=key.length;if(budget.characters<0)throw new Error("Invalid bounded roadmap data.");}
    const out:Record<string,unknown>={};for(const key of (keys as string[]).sort(compareRoadmapIds)){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!("value" in d))throw new Error("Invalid bounded roadmap data.");out[key]=copy(d.value,depth+1);}return Object.freeze(out);
  }
  return copy(raw,0);
}
export const roadmapFingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(captureRoadmapData(value))).digest("hex");
export const isRoadmapFingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export const isRoadmapCommandId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,39}$/u.test(value);

/** Called only with the persisted ProjectTask type, never route/provider caller preferences. */
export function deriveRoadmapTaskClass(type: ProjectTaskType, corrective: boolean): RoadmapTaskClass {
  if (!["feature","fix","investigation","roadmap"].includes(type) || typeof corrective !== "boolean") throw new Error("Invalid persisted task type.");
  if (corrective) return "repair";
  switch (type) { case "feature": return "implementation"; case "fix": return "repair"; case "investigation": case "roadmap": return "analysis"; default: throw new Error("Invalid persisted task type."); }
}
export type RoadmapMetadata = Readonly<{ scope: readonly string[]; nonGoals: readonly string[]; acceptanceCriteria: readonly string[];
  artifacts: readonly string[]; requiredQuality: true; requiredSecurity: true; approvalPolicy: "owner"; changeEvidence: string }>;
const metadataFields = ["scope", "nonGoals", "acceptanceCriteria", "artifacts", "requiredQuality", "requiredSecurity", "approvalPolicy", "changeEvidence"] as const;
const secret = /(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{8,}|github_pat_|bearer\s|private key|DATABASE_URL|(?:token|password|api[_-]?key)\s*[:=])/iu;
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 1000 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value) && !secret.test(value); }
function strings(value: unknown, max: number, allowEmpty: boolean, key = false): readonly string[] | null {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || (!allowEmpty && !value.length)) return null;
  if (Reflect.ownKeys(value).length !== value.length + 1) return null;
  const copy: string[] = [];
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, i); if (!d || !("value" in d) || !(key ? isTaskKey(d.value) : text(d.value))) return null; copy.push(d.value); }
  return Object.freeze([...new Set(copy)].sort(compareRoadmapIds));
}
export function normalizeRoadmapMetadata(raw: unknown): RoadmapMetadata | null {
  try {
    const f = exactOwnData(raw, metadataFields); if (!f || f.requiredQuality !== true || f.requiredSecurity !== true || f.approvalPolicy !== "owner" || !text(f.changeEvidence)) return null;
    const scope = strings(f.scope, 32, false), nonGoals = strings(f.nonGoals, 32, true), acceptanceCriteria = strings(f.acceptanceCriteria, 32, false), artifacts = strings(f.artifacts, 32, false);
    return scope && nonGoals && acceptanceCriteria && artifacts ? Object.freeze({ scope, nonGoals, acceptanceCriteria, artifacts, requiredQuality: true, requiredSecurity: true, approvalPolicy: "owner", changeEvidence: f.changeEvidence }) : null;
  } catch { return null; }
}
export function normalizeRoadmapDependencies(raw: unknown): readonly string[] | null { try { return strings(raw, 64, true, true); } catch { return null; } }
export type RoadmapNode = Readonly<{ taskId: string; status: ProjectTaskStatus; dependencyIds: readonly string[]; priority: string | null }>;
function captureGraph(raw: unknown): readonly RoadmapNode[] | null {
  try { const nodes=captureRoadmapData(raw);if(!Array.isArray(nodes)||nodes.length>256)return null;
    const out:RoadmapNode[]=[];for(const item of nodes){const n=exactOwnData(item,["taskId","status","dependencyIds","priority"]), deps=n&&normalizeRoadmapDependencies(n.dependencyIds);
      if(!n||!deps||!isTaskKey(n.taskId)||!isProjectTaskStatus(n.status)||(n.priority!==null&&!["P0","P1","P2","P3","P4"].includes(n.priority as string)))return null;
      out.push(Object.freeze({taskId:n.taskId,status:n.status,dependencyIds:deps,priority:n.priority as string|null}));}return Object.freeze(out);
  }catch{return null;}
}
/** Separate ProjectTask dependency graph; DevelopmentTask waves still use the accepted contract. */
export function validateRoadmapGraph(nodes: readonly RoadmapNode[]): boolean {
  try {
    const captured=captureGraph(nodes);if(!captured)return false;
    const map = new Map<string, readonly string[]>();
    for (const n of captured) {
      if (map.has(n.taskId) || n.dependencyIds.includes(n.taskId)) return false;
      map.set(n.taskId, n.dependencyIds);
    }
    const completed = new Set<string>();
    for (let pass = 0; pass <= nodes.length; pass++) { let progress = false;
      for (const [id, deps] of map) { if (deps.some(d => !map.has(d))) return false; if (!completed.has(id) && deps.every(d => completed.has(d))) { completed.add(id); progress = true; } }
      if (completed.size === map.size) return true; if (!progress) return false;
    }
    return false;
  } catch { return false; }
}
export function planRoadmapReadiness(nodes: readonly RoadmapNode[], projectActive: boolean, milestoneActive: boolean): Readonly<{ ready: readonly string[]; blocked: readonly string[] }> | null {
  const captured=captureGraph(nodes);if (!captured || !validateRoadmapGraph(captured) || typeof projectActive!=="boolean" || typeof milestoneActive!=="boolean") return null;
  const byId = new Map(captured.map(n => [n.taskId, n]));
  const sorted = [...captured].sort((a, b) => compareRoadmapIds(a.priority ?? "P4", b.priority ?? "P4") || compareRoadmapIds(a.taskId, b.taskId));
  const ready = sorted.filter(n => projectActive && milestoneActive && n.status === "ready" && n.dependencyIds.every(id => byId.get(id)?.status === "completed")).map(n => n.taskId);
  return Object.freeze({ ready: Object.freeze(ready), blocked: Object.freeze(sorted.filter(n => !ready.includes(n.taskId) && n.status !== "completed" && n.status !== "cancelled").map(n => n.taskId)) });
}
export function materializeApprovedRoadmapPlan(raw: unknown, planId: string, storedFingerprint: string): Readonly<{ draft: FeaturePlan; plan: FeaturePlan; draftFingerprint: string; executionFingerprint: string; allowedPaths: readonly string[]; risk: string }> | null {
  try {
    const f = exactOwnData(raw, ["id", "title", "goal", "status", "tasks"]); if (!f || f.id !== planId || f.status !== "draft") return null;
    const draft = normalizeDraftPlan({ title: f.title, goal: f.goal, tasks: f.tasks }, planId); if (!draft.ok || featurePlanFingerprint(draft.plan) !== storedFingerprint) return null;
    const approved = validateAndNormalizeFeaturePlan({ ...draft.plan, status: "approved" }); if (!approved.ok || !buildDevelopmentTaskWaves(approved.value).ok) return null;
    const plan = canonicalFeaturePlan(approved.value), risks = ["low", "medium", "high", "critical"];
    const risk = plan.tasks.reduce((a, t) => risks.indexOf(t.riskLevel) > risks.indexOf(a) ? t.riskLevel : a, "low");
    return Object.freeze({ draft: captureRoadmapData(draft.plan) as FeaturePlan, plan: captureRoadmapData(plan) as FeaturePlan, draftFingerprint: storedFingerprint, executionFingerprint: featurePlanFingerprint(plan), allowedPaths: Object.freeze([...new Set(plan.tasks.flatMap(t => t.allowedPaths))].sort(compareRoadmapIds)), risk });
  } catch { return null; }
}
const transitions: Record<ProjectTaskStatus, ProjectTaskStatus[]> = {
  draft: ["ready", "cancelled"], ready: ["planning", "draft", "blocked", "cancelled"], planning: ["approved", "waiting_owner", "draft", "blocked", "recovery_required", "cancelled"],
  approved: ["running", "waiting_owner", "blocked", "recovery_required", "cancelled"], running: ["verifying", "waiting_owner", "blocked", "recovery_required", "failed", "cancelled"],
  verifying: ["running", "waiting_owner", "blocked", "recovery_required", "failed", "cancelled"], waiting_owner: ["draft", "approved", "running", "blocked", "recovery_required", "completed", "failed", "cancelled"],
  blocked: ["draft", "cancelled"], recovery_required: ["waiting_owner", "blocked", "cancelled"], completed: [], failed: [], cancelled: [],
};
export const roadmapTaskTransitions: Readonly<Record<ProjectTaskStatus, readonly ProjectTaskStatus[]>> = Object.freeze(Object.fromEntries(Object.entries(transitions).map(([k,v])=>[k,Object.freeze(v)]))) as Readonly<Record<ProjectTaskStatus, readonly ProjectTaskStatus[]>>;
