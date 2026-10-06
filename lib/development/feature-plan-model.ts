// AI-039 Development Workflow: pure FeaturePlan revision model (no I/O, no crypto; safe for the
// Plan Builder client component).
//
// ProjectTask IS the Owner-level development request. Its FeaturePlans are persisted as immutable
// revisions (db/migrations/0011). The FeaturePlan / DevelopmentTask shape, its validation and its
// dependency waves come ONLY from lib/contracts/development-plan.ts; this module adds presentation
// projections (aggregate risk, verification plan) and the factual "not available yet" states. It never
// computes an executor, an admission decision or a repository action.
import type { DevelopmentTask, FeaturePlan } from "../contracts/development-plan";
import type { RiskLevel } from "../contracts/domain";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { buildDevelopmentTaskWaves, developmentPlanLimits } from "../contracts/development-plan.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { riskLevels } from "../contracts/domain.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isProjectKey } from "../projects/project-registry.ts";

// Plan Builder bounds. Narrower than the domain limits (developmentPlanLimits), never wider: the
// bounded form parser and the builder's HTML maxLength both use these; the mutation contract
// re-validates with the domain contract. Sized (AI-039 L-1) so the maximum browser-generated form —
// every field at its maxLength in 3-byte UTF-8, every dependency checked, plus Server Action metadata
// — stays far below Next.js's default 1 MB Server Action body limit (tests/feature-plan-transport).
export const featurePlanBuilderLimits = Object.freeze({
  maxSteps: 16,
  maxListItems: 12,
  maxListItemLength: 200,
  maxPlanTitleLength: developmentPlanLimits.maxTitleLength,
  maxPlanGoalLength: developmentPlanLimits.maxGoalLength,
  maxStepTitleLength: developmentPlanLimits.maxTitleLength,
  maxStepGoalLength: 1000,
  maxHistory: 20,
});

// Builder step ids: stable local identities that become the saved DevelopmentTask ids.
export const stepIdPattern = /^step-[1-9][0-9]?$/u;
// Server-generated plan key (FeaturePlan.id), one lineage per ProjectTask.
export const planKeyPattern = /^plan-[0-9a-f]{20}$/u;
export const fingerprintPattern = /^[0-9a-f]{64}$/u;

// The list fields of a DevelopmentTask (one item per line in the builder).
export const developmentTaskListFields = Object.freeze(["scope", "nonGoals", "allowedPaths", "acceptanceCriteria", "verificationCommands"] as const);
export type DevelopmentTaskListField = (typeof developmentTaskListFields)[number];

export type FeaturePlanRevisionSummary = Readonly<{
  planId: string;
  revision: number;
  createdAt: string;
  fingerprint: string;
}>;

// A ProjectTask's persisted plans as the browser receives them: the latest revision in full (already
// validated, re-fingerprinted and canonical) and a bounded, newest-first revision history.
export type TaskFeaturePlans = Readonly<{
  taskId: string;
  projectId: string;
  revisionCount: number;
  latest: (FeaturePlanRevisionSummary & Readonly<{ plan: FeaturePlan }>) | null;
  history: readonly FeaturePlanRevisionSummary[];
  historyTruncated: boolean;
}>;

const compareIds = (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1);

// Canonical form of an ALREADY VALIDATED FeaturePlan (validateAndNormalizeFeaturePlan output): fixed
// key order, tasks by sequence (then id), dependency ids by the dependency's sequence (then id). List
// items keep their (deduplicated, trimmed) order — it is meaningful to the Owner. Idempotent.
export function canonicalFeaturePlan(plan: FeaturePlan): FeaturePlan {
  const tasks = [...plan.tasks].sort((left, right) => left.sequence - right.sequence || compareIds(left.id, right.id));
  const sequenceOf = new Map(tasks.map((task) => [task.id, task.sequence] as const));
  return {
    id: plan.id,
    title: plan.title,
    goal: plan.goal,
    status: plan.status,
    tasks: tasks.map((task): DevelopmentTask => ({
      id: task.id,
      sequence: task.sequence,
      title: task.title,
      goal: task.goal,
      scope: [...task.scope],
      nonGoals: [...task.nonGoals],
      allowedPaths: [...task.allowedPaths],
      acceptanceCriteria: [...task.acceptanceCriteria],
      verificationCommands: [...task.verificationCommands],
      dependencyIds: [...task.dependencyIds].sort((left, right) => (sequenceOf.get(left) ?? 0) - (sequenceOf.get(right) ?? 0) || compareIds(left, right)),
      riskLevel: task.riskLevel,
      priority: task.priority,
      requiresOwnerApproval: task.requiresOwnerApproval,
    })),
  };
}

// Aggregate plan risk: the maximum canonical RiskLevel of its tasks (low < medium < high < critical)
// and the count per level. A presentation projection, not a new risk-scoring contract.
export function aggregatePlanRisk(plan: FeaturePlan): Readonly<{ max: RiskLevel; counts: Readonly<Record<RiskLevel, number>> }> {
  const order = riskLevels as readonly RiskLevel[];
  const counts = Object.fromEntries(order.map((level) => [level, 0])) as Record<RiskLevel, number>;
  let max = order[0];
  for (const task of plan.tasks) {
    counts[task.riskLevel] += 1;
    if (order.indexOf(task.riskLevel) > order.indexOf(max)) max = task.riskLevel;
  }
  return Object.freeze({ max, counts: Object.freeze(counts) });
}

// The verification plan is ONLY the commands written in the plan: per task, and consolidated as the
// unique commands in stable first-seen order (tasks by sequence). Nothing is added or inferred.
export function verificationPlan(plan: FeaturePlan): Readonly<{
  perTask: readonly Readonly<{ taskId: string; sequence: number; title: string; commands: readonly string[] }>[];
  consolidated: readonly string[];
}> {
  const tasks = [...plan.tasks].sort((left, right) => left.sequence - right.sequence || compareIds(left.id, right.id));
  const seen = new Set<string>();
  const consolidated: string[] = [];
  for (const task of tasks) {
    for (const command of task.verificationCommands) {
      if (!seen.has(command)) {
        seen.add(command);
        consolidated.push(command);
      }
    }
  }
  return Object.freeze({
    perTask: Object.freeze(tasks.map((task) => Object.freeze({ taskId: task.id, sequence: task.sequence, title: task.title, commands: Object.freeze([...task.verificationCommands]) }))),
    consolidated: Object.freeze(consolidated),
  });
}

// Dependency waves come ONLY from the canonical contract (no second graph algorithm here). A wave is
// logical dependency readiness; it does NOT authorize parallel editing, execution or admission.
export function planDependencyWaves(plan: FeaturePlan): readonly (readonly DevelopmentTask[])[] | null {
  const result = buildDevelopmentTaskWaves(plan);
  return result.ok ? result.value : null;
}

// Executor recommendation: there is no ExecutorRouter yet (Roadmap v1.4: AI-041.3), so the only
// factual state is "unavailable" with no executor. Never a computed or placeholder executor.
export const executorRecommendation = Object.freeze({
  status: "unavailable" as const,
  executor: null,
  // The component whose absence makes this unavailable, and the roadmap task that introduces it.
  component: "ExecutorRouter" as const,
  roadmapDependency: "AI-041.3" as const,
});

// Repository mutation: AI-039 is a planning boundary and never touches a repository.
export const repositoryMutation = Object.freeze({ status: "not_started" as const });

// Which ProjectTask may receive a new revision (narrow fail-closed rule for the first version).
export type PlanCreationBlock = "task_not_draft" | "project_not_active" | "plans_unavailable";
export function planCreationBlock(taskStatus: string, projectStatus: string | null, plansAvailable: boolean): PlanCreationBlock | null {
  if (!plansAvailable) return "plans_unavailable";
  if (taskStatus !== "draft") return "task_not_draft";
  if (projectStatus !== "active") return "project_not_active";
  return null;
}

// The Development Workflow page of a task; the project is context only (validated ids, never authority).
export function developmentHref(taskId: string, projectId: string | null): string {
  const base = `/tasks/${encodeURIComponent(taskId)}/development`;
  return projectId !== null && isProjectKey(projectId) ? `${base}?project=${encodeURIComponent(projectId)}` : base;
}
