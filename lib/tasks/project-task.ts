// AI-038.4a ProjectTask contract (pure; no I/O).
//
// A ProjectTask is the Owner-level unit of intent ("what needs to be done") inside one registered
// project. It is NOT the FeaturePlan `DevelopmentTask` (lib/contracts/development-plan.ts), which is a
// node inside an in-memory FeaturePlan. Future shape: ProjectTask → FeaturePlan → DevelopmentTask[] →
// Runs; AI-038.4a only establishes ProjectTask ↔ linked Runs (Task = objective, Run = attempt).
// Task status is factual persisted state; it is never derived from run status.
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { developmentPriorities } from "../contracts/development-plan.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { riskLevels } from "../contracts/domain.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { workflowRunStatuses } from "../contracts/workflow-run.ts";

export const projectTaskTypes = Object.freeze(["feature", "fix", "investigation", "roadmap"] as const);
export type ProjectTaskType = (typeof projectTaskTypes)[number];

export const projectTaskStatuses = Object.freeze([
  "draft", "ready", "planning", "approved", "running", "verifying", "waiting_owner",
  "blocked", "recovery_required", "completed", "failed", "cancelled",
] as const);
export type ProjectTaskStatus = (typeof projectTaskStatuses)[number];

// Status categories (documented semantics):
//   DRAFT     — draft: intent captured, not ready to work on.
//   ACTIVE    — ready, planning, approved, running, verifying: being worked on.
//   ATTENTION — waiting_owner, blocked, recovery_required, failed: needs the Owner.
//   TERMINAL  — completed (with factual completed_at), cancelled.
export const activeTaskStatuses = Object.freeze(["ready", "planning", "approved", "running", "verifying"] as const);
export const attentionTaskStatuses = Object.freeze(["waiting_owner", "blocked", "recovery_required", "failed"] as const);
export const terminalTaskStatuses = Object.freeze(["completed", "cancelled"] as const);
// "Current Tasks" = ACTIVE ∪ ATTENTION (never draft, completed or cancelled).
export const currentTaskStatuses = Object.freeze([...activeTaskStatuses, ...attentionTaskStatuses]);

export type ProjectTaskPriority = (typeof developmentPriorities)[number];
export type ProjectTaskRisk = (typeof riskLevels)[number];

// Server-fixed views; each is one bounded statement. Display limits in the console are lower.
export const projectTaskViews = Object.freeze(["all", "current", "attention", "completed"] as const);
export type ProjectTaskView = (typeof projectTaskViews)[number];
export const projectTaskViewLimits: Readonly<Record<ProjectTaskView, number>> = Object.freeze({
  all: 100,
  current: 50,
  attention: 50,
  completed: 25,
});
export const projectTaskLimits = Object.freeze({ maxLinkedRuns: 50, maxTitleLength: 200, maxGoalLength: 4000 });

export const taskKeyPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export type ProjectTaskRunSummary = Readonly<{
  runId: string;
  projectId: string;
  workflowId: string;
  status: (typeof workflowRunStatuses)[number];
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}>;

export type PublicProjectTaskSummary = Readonly<{
  taskId: string;
  projectId: string;
  title: string;
  goal: string | null;
  type: ProjectTaskType;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority | null;
  riskLevel: ProjectTaskRisk | null;
  linkedRunCount: number;
  latestRun: Readonly<{ runId: string; status: ProjectTaskRunSummary["status"]; createdAt: string; completedAt: string | null }> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;

export type PublicProjectTaskDetail = Readonly<{
  task: PublicProjectTaskSummary;
  // Newest first, at most maxLinkedRuns; linkedRunCount on the task is the factual total.
  runs: readonly ProjectTaskRunSummary[];
  runsTruncated: boolean;
}>;

const statusSet = new Set<string>(projectTaskStatuses);
const typeSet = new Set<string>(projectTaskTypes);
const prioritySet = new Set<string>(developmentPriorities);
const riskSet = new Set<string>(riskLevels);
const titleControl = /[\u0000-\u001f\u007f]/u;
// Newlines and tabs are allowed in a goal; other control characters are not.
const goalControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export const isTaskKey = (input: unknown): input is string =>
  typeof input === "string" && input.length <= 64 && taskKeyPattern.test(input);
export const isProjectTaskStatus = (input: unknown): input is ProjectTaskStatus => typeof input === "string" && statusSet.has(input);
export const isProjectTaskType = (input: unknown): input is ProjectTaskType => typeof input === "string" && typeSet.has(input);
export const isProjectTaskView = (input: unknown): input is ProjectTaskView =>
  typeof input === "string" && (projectTaskViews as readonly string[]).includes(input);

export function isTaskTitle(input: unknown): input is string {
  return typeof input === "string" && input.length >= 1 && input.length <= projectTaskLimits.maxTitleLength
    && input === input.trim() && !titleControl.test(input);
}

export function isTaskGoal(input: unknown): input is string | null {
  return input === null || (typeof input === "string" && input.length >= 1
    && input.length <= projectTaskLimits.maxGoalLength && !goalControl.test(input));
}

export function timestamp(input: unknown): string | null {
  if (!(input instanceof Date) && typeof input !== "string") return null;
  const value = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

export function optionalTimestamp(input: unknown): string | null | undefined {
  return input === null ? null : timestamp(input) ?? undefined;
}

// Task columns → validated task fields, or null when ANY field is malformed or the completed_at
// invariant is violated. The caller fails the whole read closed.
export function taskFieldsFromRow(row: Readonly<Record<string, unknown>>): Omit<PublicProjectTaskSummary, "linkedRunCount" | "latestRun"> | null {
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  const completedAt = optionalTimestamp(row.completed_at);
  const priority = row.priority;
  const risk = row.risk_level;
  if (!isTaskKey(row.task_key) || !isTaskKey(row.project_key) || !isTaskTitle(row.title) || !isTaskGoal(row.goal)
    || !isProjectTaskType(row.task_type) || !isProjectTaskStatus(row.status)
    || (priority !== null && (typeof priority !== "string" || !prioritySet.has(priority)))
    || (risk !== null && (typeof risk !== "string" || !riskSet.has(risk)))
    || !createdAt || !updatedAt || completedAt === undefined
    || (row.status === "completed") !== (completedAt !== null)) {
    return null;
  }
  return {
    taskId: row.task_key,
    projectId: row.project_key,
    title: row.title,
    goal: row.goal as string | null,
    type: row.task_type,
    status: row.status,
    priority: priority as ProjectTaskPriority | null,
    riskLevel: risk as ProjectTaskRisk | null,
    createdAt,
    updatedAt,
    completedAt,
  };
}
