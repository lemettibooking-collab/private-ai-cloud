import type { AuthenticatedOwnerReadDecision } from "./authenticated-owner-read-runtime";
import type { OwnerReadBackend } from "./owner-read-runtime";
import type { ProjectSelector } from "../projects/project-context";
import type { FeaturePlan } from "../contracts/development-plan";
import type { FeaturePlanRevisionSummary, PlanCreationBlock, TaskFeaturePlans } from "../development/feature-plan-model";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { fingerprintPattern, planCreationBlock, planKeyPattern } from "../development/feature-plan-model.ts";

// AI-038.3 / AI-038.3.2 Owner Console read seam (pure; no runtime imports). Application code uses
// `./owner-console-read.server`, which binds the real request-scoped Auth.js identity and a
// per-request PostgreSQL pool.
//
//   React Server Component
//     → load*() (this module; read-only, UI-oriented)
//     → withRuntime(trusted domainWorkspaceId) → createRequestOwnerReadRuntime (AI-038.2a/.1/.0)
//     → OwnerReadBackend (existing read methods only; nothing is added to the backend here)
//
// Two different contexts, never conflated:
//   * WORKSPACE — the tenant/security boundary, chosen ONLY by trusted server configuration.
//   * PROJECT   — a registered product inside that workspace. A `?project=` selector from the browser
//                 is untrusted: it is honoured only if the authenticated `listProjects()` returns it.
//                 "All Projects" is the absence of a selector, never a registry row.
// Every result is an explicit allowlist projection: no database, session, identity, actor id,
// fingerprint, snapshot or raw error ever leaves. Nothing is cached: each call re-authorizes.

export type OwnerConsoleWorkspace = Readonly<{ slug: string; displayName: string }>;

export type OwnerConsoleProject = Readonly<{
  projectId: string;
  displayName: string;
  status: "active" | "paused" | "archived";
  repository: Readonly<{ url: string; defaultBranch: string | null }> | null;
}>;

export type OwnerConsoleScope = Readonly<{ mode: "all" }> | Readonly<{ mode: "project"; project: OwnerConsoleProject }>;

export type OwnerConsoleApproval = Readonly<{
  approvalRequestId: string;
  runId: string;
  stepId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  riskLevel: "low" | "medium" | "high" | "critical";
  requestedCapability: string;
  requestedAt: string;
  resolvedAt: string | null;
}>;

export type OwnerConsoleRunStatus =
  | "queued" | "running" | "waiting_approval" | "review" | "completed" | "failed" | "blocked" | "cancelled";

// Factual run summary from the project-scoped run discovery (listRuns).
export type OwnerConsoleProjectRun = Readonly<{
  runId: string;
  projectId: string;
  workflowId: string;
  status: OwnerConsoleRunStatus;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}>;

export type OwnerConsoleRunSummary = Readonly<{
  runId: string;
  projectId: string;
  workflowId: string;
  status: OwnerConsoleRunStatus;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStepIds: readonly string[];
  readyStepIds: readonly string[];
  approval: Readonly<{ status: OwnerConsoleApproval["status"]; riskLevel: OwnerConsoleApproval["riskLevel"]; stepId: string; requestedCapability: string }> | null;
}>;

export type OwnerConsoleUsage = Readonly<{
  invocationCount: number;
  succeededCount: number;
  failedCount: number;
  ambiguousCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsdMicros: number;
  lastProviderId: string | null;
  lastProviderModelId: string | null;
  lastProviderModelVersion: string | null;
}>;

export type OwnerConsoleInvocation = Readonly<{
  invocationId: string;
  stepId: string;
  attemptNumber: number;
  status: "running" | "succeeded" | "failed" | "outcome_unknown";
  providerId: string;
  providerModelId: string;
  providerModelVersion: string;
  createdAt: string;
  completedAt: string | null;
}>;

export type OwnerConsoleAuditItem = Readonly<{ eventType: string; actorKind: string; createdAt: string }>;

export type OwnerConsoleRunDetail = Readonly<{
  run: OwnerConsoleRunSummary;
  latestModelInvocation: OwnerConsoleInvocation | null;
  usage: OwnerConsoleUsage;
  audit: Readonly<{ state: "available"; items: readonly OwnerConsoleAuditItem[]; limit: number }> | Readonly<{ state: "unavailable" }>;
}>;

// AI-038.4a Owner / Project Task (objective). Runs are attempts linked to it; never the same thing.
export type OwnerConsoleTaskStatus =
  | "draft" | "ready" | "planning" | "approved" | "running" | "verifying" | "waiting_owner"
  | "blocked" | "recovery_required" | "completed" | "failed" | "cancelled";

export type OwnerConsoleTask = Readonly<{
  taskId: string;
  projectId: string;
  title: string;
  goal: string | null;
  type: "feature" | "fix" | "investigation" | "roadmap";
  status: OwnerConsoleTaskStatus;
  priority: "P0" | "P1" | "P2" | "P3" | "P4" | null;
  riskLevel: "low" | "medium" | "high" | "critical" | null;
  linkedRunCount: number;
  latestRun: Readonly<{ runId: string; status: OwnerConsoleRunStatus; createdAt: string; completedAt: string | null }> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;

// Factual Task Result: aggregation of the task and its linked runs only (no agent report).
export type OwnerConsoleTaskResult = Readonly<{
  status: OwnerConsoleTaskStatus;
  completedAt: string | null;
  linkedRunCount: number;
  latestRun: OwnerConsoleTask["latestRun"];
  completedRuns: number;
  failedOrBlockedRuns: number;
  activeRuns: number;
  // Counts above cover the shown (newest) runs only when this is true.
  runsTruncated: boolean;
}>;

export type OwnerConsoleTaskDetail = Readonly<{
  task: OwnerConsoleTask;
  runs: readonly OwnerConsoleProjectRun[];
  runsTruncated: boolean;
  result: OwnerConsoleTaskResult;
}>;

type TaskList = Readonly<{ tasks: readonly OwnerConsoleTask[]; truncated: boolean }>;

// Dashboard task surfaces (factual project_tasks only; never inferred from runs).
export type OwnerConsoleDashboardTasks = Readonly<{ current: TaskList; recentlyCompleted: TaskList }>;

type Gate<T> =
  | Readonly<{ state: "available"; workspace: OwnerConsoleWorkspace } & T>
  | Readonly<{ state: "unauthenticated"; workspace: OwnerConsoleWorkspace | null }>
  | Readonly<{ state: "unavailable"; workspace: OwnerConsoleWorkspace | null }>
  // A `?project=` selector that is malformed, duplicated, unknown, foreign or archived. One opaque
  // state; it never falls back to All Projects.
  | Readonly<{ state: "project_unavailable"; workspace: OwnerConsoleWorkspace | null }>;

type ProjectList = Readonly<{ projects: readonly OwnerConsoleProject[]; projectsTruncated: boolean }>;

// Shell: the top-bar bell stays WORKSPACE-GLOBAL (an urgent approval in another project must stay
// visible); the switcher receives only registry projects.
export type OwnerConsoleShell = Gate<{
  pendingApprovals: number;
  highRiskApprovals: number;
  queueTruncated: boolean;
  projectsAvailable: boolean;
  projects: readonly OwnerConsoleProject[];
  projectsTruncated: boolean;
}>;

export type OwnerConsoleProjectActivity = Readonly<{
  projectId: string;
  available: boolean;
  // Counts over the runs fetched for this project (at most runsPerProjectLimit, newest first).
  recentRuns: number;
  activeRuns: number;
  blockedRuns: number;
  truncated: boolean;
}>;

// Bounded All-Projects run aggregation (application fan-out over registry projects).
export type OwnerConsoleRunAggregate = Readonly<{
  runs: readonly OwnerConsoleProjectRun[];
  byProject: readonly OwnerConsoleProjectActivity[];
  projectsConsidered: number;
  projectsNotConsidered: number;
  projectsUnavailable: readonly string[];
  runsPerProjectLimit: number;
  displayLimit: number;
  runsTruncated: boolean;
}>;

// Project approvals classified by the FACTUAL run project.
export type OwnerConsoleProjectApprovals = Readonly<{
  approvals: readonly OwnerConsoleApproval[];
  pendingApprovals: number;
  highRiskApprovals: number;
  // Workspace approvals whose run project could not be established (never assigned to a project).
  unresolvedApprovals: number;
  queueTruncated: boolean;
}>;

export type OwnerConsoleDashboard = Gate<
  | (ProjectList & Readonly<{
    mode: "all";
    scope: Readonly<{ mode: "all" }>;
    approvals: readonly OwnerConsoleApproval[];
    pendingApprovals: number;
    highRiskApprovals: number;
    queueTruncated: boolean;
    aggregate: OwnerConsoleRunAggregate;
    tasks: OwnerConsoleDashboardTasks;
  }>)
  | (ProjectList & Readonly<{
    mode: "project";
    scope: Readonly<{ mode: "project"; project: OwnerConsoleProject }>;
    runs: readonly OwnerConsoleProjectRun[];
    runsTruncated: boolean;
    runsLimit: number;
    projectApprovals: OwnerConsoleProjectApprovals;
    tasks: OwnerConsoleDashboardTasks;
  }>)
>;

export type OwnerConsoleRuns = Gate<
  | (ProjectList & Readonly<{ mode: "all"; scope: Readonly<{ mode: "all" }>; aggregate: OwnerConsoleRunAggregate }>)
  | (ProjectList & Readonly<{ mode: "project"; scope: Readonly<{ mode: "project"; project: OwnerConsoleProject }>; runs: readonly OwnerConsoleProjectRun[]; runsTruncated: boolean; runsLimit: number }>)
>;

export type OwnerConsoleApprovals = Gate<
  | (ProjectList & Readonly<{ mode: "all"; scope: Readonly<{ mode: "all" }>; approvals: readonly OwnerConsoleApproval[]; pendingApprovals: number; highRiskApprovals: number; queueTruncated: boolean }>)
  | (ProjectList & Readonly<{ mode: "project"; scope: Readonly<{ mode: "project"; project: OwnerConsoleProject }>; projectApprovals: OwnerConsoleProjectApprovals }>)
>;

export type OwnerConsoleProjects = Gate<ProjectList>;

export type OwnerConsoleTasks = Gate<ProjectList & Readonly<{ mode: "all" | "project"; scope: OwnerConsoleScope } & TaskList>>;

// AI-038.4b Quick Create form data (a READ; the write goes through ./owner-task-create). Only ACTIVE
// registry projects are offered: createTask accepts nothing else (and re-checks under lock anyway).
//   choose      — All Projects: the Owner picks one of `creatableProjects`.
//   project     — a validated active project is preselected (the only entry of `creatableProjects`).
//   project_paused — a validated paused project: creation is unavailable (no creatable target).
export type OwnerConsoleQuickCreate = Gate<ProjectList & Readonly<{
  scope: OwnerConsoleScope;
  target: "choose" | "project" | "project_paused";
  creatableProjects: readonly OwnerConsoleProject[];
}>>;

export type OwnerConsoleTaskView = Gate<ProjectList & Readonly<{
  scope: OwnerConsoleScope;
  task: Readonly<{ state: "available"; detail: OwnerConsoleTaskDetail }> | Readonly<{ state: "unavailable" }>;
}>>;

// AI-039 Development Workflow of ONE ProjectTask (the Owner-level development request): the task, its
// factual project, its persisted FeaturePlan revisions, and whether a new draft revision may be saved.
export type OwnerConsoleTaskDevelopment = Gate<ProjectList & Readonly<{
  scope: OwnerConsoleScope;
  development: Readonly<{ state: "unavailable" }> | Readonly<{
    state: "available";
    task: OwnerConsoleTask;
    project: OwnerConsoleProject | null;
    plans: Readonly<{ state: "available"; data: TaskFeaturePlans }> | Readonly<{ state: "unavailable" }>;
    creationBlock: PlanCreationBlock | null;
  }>;
}>>;

// My Attention: attention-status tasks + pending approvals (workspace, or factually one project).
export type OwnerConsoleAttention = Gate<
  | (ProjectList & Readonly<{ mode: "all"; scope: Readonly<{ mode: "all" }>; attentionTasks: TaskList; approvals: readonly OwnerConsoleApproval[]; pendingApprovals: number; highRiskApprovals: number; queueTruncated: boolean }>)
  | (ProjectList & Readonly<{ mode: "project"; scope: Readonly<{ mode: "project"; project: OwnerConsoleProject }>; attentionTasks: TaskList; projectApprovals: OwnerConsoleProjectApprovals }>)
>;

export type OwnerConsoleRunView = Gate<ProjectList & Readonly<{
  scope: OwnerConsoleScope;
  run: Readonly<{ state: "available"; detail: OwnerConsoleRunDetail }> | Readonly<{ state: "unavailable" }>;
}>>;

export type OwnerConsoleDependencies = Readonly<{
  // Trusted server configuration only (e.g. APP_DEMO_WORKSPACE_SLUG). Never request data.
  workspaceSlug: unknown;
  // Opens ONE request-scoped authenticated Owner runtime for the trusted workspace, runs `read`,
  // and releases its resources before returning.
  withRuntime<T>(domainWorkspaceId: string, read: (decision: AuthenticatedOwnerReadDecision) => Promise<T>): Promise<T>;
}>;

// Every bound of the Owner Console in one place (see the AI-038.3.2 report for the read-count table).
export const ownerConsoleLimits = Object.freeze({
  approvalQueueLimit: 100,
  auditTimelineLimit: 50,
  maxRunIdLength: 64,
  // Project registry: the backend maximum.
  projectListLimit: 100,
  // All-Projects run aggregation: at most this many registry projects are read, this many runs each.
  aggregationProjectLimit: 12,
  aggregationRunsPerProject: 15,
  dashboardActiveWorkLimit: 12,
  runsPageDisplayLimit: 50,
  // One selected project.
  projectRunsLimit: 50,
  // Approval classification: one listRuns(project, 100) proves membership for recent runs; at most
  // this many other distinct runs are classified via getRunOverview; the rest stay unresolved.
  classificationRunListLimit: 100,
  maxOverviewClassifications: 40,
  // Concurrent backend reads (the per-request PostgreSQL pool has two connections).
  readConcurrency: 2,
  // AI-038.4a display limits (backend views are bounded at ≤ 100 server-side).
  dashboardCurrentTasks: 10,
  dashboardRecentlyCompleted: 5,
});

const slugPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
// Same stable-id rule the tenant-bound facade applies to runId (it remains the authoritative gate).
const runIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const highRisk = new Set(["high", "critical"]);
const activeStatuses = new Set(["queued", "running", "waiting_approval", "review"]);
const blockedStatuses = new Set(["blocked", "failed"]);

function trustedWorkspace(slug: unknown): OwnerConsoleWorkspace | null {
  if (typeof slug !== "string" || !slugPattern.test(slug)) return null;
  const displayName = slug.split(/[-._]+/u).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  return Object.freeze({ slug, displayName });
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const ids = (value: unknown): readonly string[] =>
  Object.freeze(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

// Bounded-concurrency map, preserving input order.
async function mapBounded<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function projectView(input: Record<string, unknown>): OwnerConsoleProject | null {
  const repository = input.repository as Record<string, unknown> | null | undefined;
  const projectId = str(input.projectId);
  const status = str(input.status);
  if (!runIdPattern.test(projectId) || !["active", "paused", "archived"].includes(status)) return null;
  return Object.freeze({
    projectId,
    displayName: str(input.displayName) || projectId,
    status: status as OwnerConsoleProject["status"],
    repository: repository && typeof repository === "object" && typeof repository.url === "string"
      ? Object.freeze({ url: repository.url, defaultBranch: strOrNull(repository.defaultBranch) })
      : null,
  });
}

function projectRunView(input: Record<string, unknown>): OwnerConsoleProjectRun {
  return Object.freeze({
    runId: str(input.runId),
    projectId: str(input.projectId),
    workflowId: str(input.workflowId),
    status: str(input.status) as OwnerConsoleRunStatus,
    revision: num(input.revision),
    createdAt: str(input.createdAt),
    startedAt: strOrNull(input.startedAt),
    completedAt: strOrNull(input.completedAt),
  });
}

function approvalView(input: Record<string, unknown>): OwnerConsoleApproval {
  return Object.freeze({
    approvalRequestId: str(input.approvalRequestId),
    runId: str(input.runId),
    stepId: str(input.stepId),
    status: str(input.status) as OwnerConsoleApproval["status"],
    riskLevel: str(input.riskLevel) as OwnerConsoleApproval["riskLevel"],
    requestedCapability: str(input.requestedCapability),
    requestedAt: str(input.requestedAt),
    resolvedAt: strOrNull(input.resolvedAt),
  });
}

function runSummary(input: Record<string, unknown>): OwnerConsoleRunSummary {
  const approval = input.approval as Record<string, unknown> | null | undefined;
  return Object.freeze({
    runId: str(input.runId),
    projectId: str(input.projectId),
    workflowId: str(input.workflowId),
    status: str(input.status) as OwnerConsoleRunStatus,
    revision: num(input.revision),
    createdAt: str(input.createdAt),
    startedAt: strOrNull(input.startedAt),
    completedAt: strOrNull(input.completedAt),
    currentStepIds: ids(input.currentStepIds),
    readyStepIds: ids(input.readyStepIds),
    approval: approval && typeof approval === "object"
      ? Object.freeze({
        status: str(approval.status) as OwnerConsoleApproval["status"],
        riskLevel: str(approval.riskLevel) as OwnerConsoleApproval["riskLevel"],
        stepId: str(approval.stepId),
        requestedCapability: str(approval.requestedCapability),
      })
      : null,
  });
}

function usageView(input: Record<string, unknown> | null | undefined): OwnerConsoleUsage {
  const u = input ?? {};
  return Object.freeze({
    invocationCount: num(u.invocationCount),
    succeededCount: num(u.succeededCount),
    failedCount: num(u.failedCount),
    ambiguousCount: num(u.ambiguousCount),
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    totalTokens: num(u.totalTokens),
    totalCostUsdMicros: num(u.totalCostUsdMicros),
    lastProviderId: strOrNull(u.lastProviderId),
    lastProviderModelId: strOrNull(u.lastProviderModelId),
    lastProviderModelVersion: strOrNull(u.lastProviderModelVersion),
  });
}

function invocationView(input: Record<string, unknown> | null | undefined): OwnerConsoleInvocation | null {
  if (!input || typeof input !== "object") return null;
  return Object.freeze({
    invocationId: str(input.invocationId),
    stepId: str(input.stepId),
    attemptNumber: num(input.attemptNumber),
    status: str(input.status) as OwnerConsoleInvocation["status"],
    providerId: str(input.providerId),
    providerModelId: str(input.providerModelId),
    providerModelVersion: str(input.providerModelVersion),
    createdAt: str(input.createdAt),
    completedAt: strOrNull(input.completedAt),
  });
}

const taskStatuses = new Set(["draft", "ready", "planning", "approved", "running", "verifying", "waiting_owner",
  "blocked", "recovery_required", "completed", "failed", "cancelled"]);
const taskTypes = new Set(["feature", "fix", "investigation", "roadmap"]);

// AI-039: the backend's FeaturePlan projection, re-checked structurally for THIS task (the read path
// already validated and re-fingerprinted the stored plan; any shape surprise is `unavailable`).
function featurePlansView(input: unknown, taskId: string, projectId: string): TaskFeaturePlans | null {
  if (typeof input !== "object" || input === null) return null;
  const data = input as Record<string, unknown>;
  const revision = (item: unknown): FeaturePlanRevisionSummary | null => {
    if (typeof item !== "object" || item === null) return null;
    const row = item as Record<string, unknown>;
    return typeof row.planId === "string" && planKeyPattern.test(row.planId) && Number.isSafeInteger(row.revision) && (row.revision as number) >= 1
      && typeof row.createdAt === "string" && typeof row.fingerprint === "string" && fingerprintPattern.test(row.fingerprint)
      ? Object.freeze({ planId: row.planId, revision: row.revision as number, createdAt: row.createdAt, fingerprint: row.fingerprint })
      : null;
  };
  const history = Array.isArray(data.history) ? data.history.map(revision) : null;
  const count = data.revisionCount;
  if (data.taskId !== taskId || data.projectId !== projectId || !history || history.some((item) => item === null)
    || !Number.isSafeInteger(count) || typeof data.historyTruncated !== "boolean") return null;
  if (data.latest === null) {
    return count === 0 && history.length === 0 ? Object.freeze({ taskId, projectId, revisionCount: 0, latest: null, history: Object.freeze([]), historyTruncated: false }) : null;
  }
  const latest = revision(data.latest);
  const plan = (data.latest as Record<string, unknown>).plan as FeaturePlan | null | undefined;
  if (!latest || typeof plan !== "object" || plan === null || plan.id !== latest.planId || plan.status !== "draft" || !Array.isArray(plan.tasks)
    || history.length === 0 || history[0]!.revision !== latest.revision || count !== latest.revision) return null;
  return Object.freeze({
    taskId,
    projectId,
    revisionCount: count as number,
    latest: Object.freeze({ ...latest, plan }),
    history: Object.freeze(history as FeaturePlanRevisionSummary[]),
    historyTruncated: data.historyTruncated,
  });
}

function taskView(input: Record<string, unknown>): OwnerConsoleTask | null {
  const latest = input.latestRun as Record<string, unknown> | null | undefined;
  const taskId = str(input.taskId);
  const projectId = str(input.projectId);
  if (!runIdPattern.test(taskId) || !runIdPattern.test(projectId) || !taskStatuses.has(str(input.status)) || !taskTypes.has(str(input.type))) return null;
  return Object.freeze({
    taskId,
    projectId,
    title: str(input.title),
    goal: strOrNull(input.goal),
    type: str(input.type) as OwnerConsoleTask["type"],
    status: str(input.status) as OwnerConsoleTaskStatus,
    priority: strOrNull(input.priority) as OwnerConsoleTask["priority"],
    riskLevel: strOrNull(input.riskLevel) as OwnerConsoleTask["riskLevel"],
    linkedRunCount: num(input.linkedRunCount),
    latestRun: latest && typeof latest === "object"
      ? Object.freeze({ runId: str(latest.runId), status: str(latest.status) as OwnerConsoleRunStatus, createdAt: str(latest.createdAt), completedAt: strOrNull(latest.completedAt) })
      : null,
    createdAt: str(input.createdAt),
    updatedAt: str(input.updatedAt),
    completedAt: strOrNull(input.completedAt),
  });
}

class ProjectUnavailable extends Error {}

// Server-fixed bounds of the backend task views (truncation is reported when a view is full).
const serverViewLimit = Object.freeze({ all: 100, current: 50, attention: 50, completed: 25 });
const completedRunStatuses = new Set(["completed"]);
const failedRunStatuses = new Set(["failed", "blocked"]);
const activeRunStatusSet = new Set(["queued", "running", "waiting_approval", "review"]);

const newestFirst = (a: OwnerConsoleProjectRun, b: OwnerConsoleProjectRun) =>
  a.createdAt === b.createdAt ? (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : (a.projectId < b.projectId ? 1 : -1))
    : a.createdAt < b.createdAt ? 1 : -1;

export function createOwnerConsoleReader(dependencies: OwnerConsoleDependencies) {
  const workspace = trustedWorkspace(dependencies.workspaceSlug);
  const withRuntime = dependencies.withRuntime;
  const unavailable = Object.freeze({ state: "unavailable" as const, workspace });
  const projectUnavailable = Object.freeze({ state: "project_unavailable" as const, workspace });

  // One authenticated, request-scoped composition per call; any failure is the same generic state.
  async function gate<T extends object>(read: (backend: OwnerReadBackend) => Promise<T>): Promise<Gate<T>> {
    if (!workspace) return unavailable;
    try {
      return await withRuntime(workspace.slug, async (decision) => {
        if (decision.verdict !== "allow") {
          return decision.reason === "unauthenticated"
            ? Object.freeze({ state: "unauthenticated" as const, workspace })
            : unavailable;
        }
        try {
          const data = await read(decision.backend);
          return Object.freeze({ state: "available" as const, workspace, ...data });
        } catch (error) {
          if (error instanceof ProjectUnavailable) return projectUnavailable;
          throw error;
        }
      });
    } catch {
      return unavailable;
    }
  }

  async function projectList(backend: OwnerReadBackend): Promise<ProjectList> {
    const result = await backend.listProjects(ownerConsoleLimits.projectListLimit);
    if (result.verdict !== "allow") throw new Error("unavailable");
    const projects = result.data.map((item) => projectView(item as unknown as Record<string, unknown>));
    if (projects.some((item) => item === null)) throw new Error("unavailable");
    return {
      projects: Object.freeze(projects as OwnerConsoleProject[]),
      projectsTruncated: projects.length >= ownerConsoleLimits.projectListLimit,
    };
  }

  // The selector narrows only to a project the authenticated registry read returned.
  function resolveScope(selector: ProjectSelector, list: ProjectList): OwnerConsoleScope {
    if (selector.kind === "all") return Object.freeze({ mode: "all" as const });
    if (selector.kind !== "candidate") throw new ProjectUnavailable();
    const project = list.projects.find((item) => item.projectId === selector.projectId);
    if (!project) throw new ProjectUnavailable();
    return Object.freeze({ mode: "project" as const, project });
  }

  async function approvalQueue(backend: OwnerReadBackend) {
    const queue = await backend.listApprovalQueue(ownerConsoleLimits.approvalQueueLimit);
    if (queue.verdict !== "allow") throw new Error("unavailable");
    const approvals = Object.freeze(queue.data.map((item) => approvalView(item as unknown as Record<string, unknown>)));
    return {
      approvals,
      queueTruncated: approvals.length >= ownerConsoleLimits.approvalQueueLimit,
      pendingApprovals: approvals.filter((item) => item.status === "pending").length,
      highRiskApprovals: approvals.filter((item) => item.status === "pending" && highRisk.has(item.riskLevel)).length,
    };
  }

  async function projectRuns(backend: OwnerReadBackend, projectId: string, limit: number) {
    const result = await backend.listRuns(projectId, limit);
    if (result.verdict !== "allow") return null;
    return Object.freeze(result.data.map((item) => projectRunView(item as unknown as Record<string, unknown>))
      .filter((run) => run.projectId === projectId));
  }

  // Bounded application fan-out: the first N registry projects (deterministic registry order), M
  // runs each, merged newest first, labelled with their factual project. A project whose list is
  // unavailable is reported, never counted as zero and never allowed to corrupt the others.
  async function aggregateRuns(backend: OwnerReadBackend, list: ProjectList, displayLimit: number): Promise<OwnerConsoleRunAggregate> {
    const considered = list.projects.slice(0, ownerConsoleLimits.aggregationProjectLimit);
    const perProject = ownerConsoleLimits.aggregationRunsPerProject;
    const results = await mapBounded(considered, ownerConsoleLimits.readConcurrency,
      async (project) => ({ project, runs: await projectRuns(backend, project.projectId, perProject).catch(() => null) }));
    const merged = results.flatMap((item) => item.runs ?? []).sort(newestFirst);
    return Object.freeze({
      runs: Object.freeze(merged.slice(0, displayLimit)),
      byProject: Object.freeze(results.map((item) => Object.freeze({
        projectId: item.project.projectId,
        available: item.runs !== null,
        recentRuns: item.runs?.length ?? 0,
        activeRuns: item.runs?.filter((run) => activeStatuses.has(run.status)).length ?? 0,
        blockedRuns: item.runs?.filter((run) => blockedStatuses.has(run.status)).length ?? 0,
        truncated: (item.runs?.length ?? 0) >= perProject,
      }))),
      projectsConsidered: considered.length,
      projectsNotConsidered: list.projects.length - considered.length,
      projectsUnavailable: Object.freeze(results.filter((item) => item.runs === null).map((item) => item.project.projectId)),
      runsPerProjectLimit: perProject,
      displayLimit,
      runsTruncated: merged.length > displayLimit || results.some((item) => (item.runs?.length ?? 0) >= perProject),
    });
  }

  // One bounded task read (workspace or one validated project) → validated list; fails the whole read
  // closed on any malformed or out-of-scope task.
  async function taskList(backend: OwnerReadBackend, view: "all" | "current" | "attention" | "completed", projectId: string | null, displayLimit?: number): Promise<TaskList> {
    const result = projectId === null ? await backend.listTasks(view) : await backend.listProjectTasks(projectId, view);
    if (result.verdict !== "allow") throw new Error("unavailable");
    const tasks = result.data.map((item) => taskView(item as unknown as Record<string, unknown>));
    if (tasks.some((task) => task === null || (projectId !== null && task.projectId !== projectId))) throw new Error("unavailable");
    const all = tasks as OwnerConsoleTask[];
    const limit = displayLimit ?? all.length;
    return Object.freeze({ tasks: Object.freeze(all.slice(0, limit)), truncated: all.length > limit || all.length >= serverViewLimit[view] });
  }

  async function dashboardTasks(backend: OwnerReadBackend, projectId: string | null): Promise<OwnerConsoleDashboardTasks> {
    return Object.freeze({
      current: await taskList(backend, "current", projectId, ownerConsoleLimits.dashboardCurrentTasks),
      recentlyCompleted: await taskList(backend, "completed", projectId, ownerConsoleLimits.dashboardRecentlyCompleted),
    });
  }

  // Approvals of ONE project, classified by the factual run project only:
  //   1. membership proof from one listRuns(project, 100) (snapshot-validated factual runs);
  //   2. every other distinct run id → getRunOverview(runId).projectId, at most N reads;
  //   3. anything not established stays UNRESOLVED and is never assigned.
  async function classifyProjectApprovals(backend: OwnerReadBackend, projectId: string): Promise<OwnerConsoleProjectApprovals> {
    const queue = await approvalQueue(backend);
    const recent = await projectRuns(backend, projectId, ownerConsoleLimits.classificationRunListLimit);
    const knownMembers = new Set((recent ?? []).map((run) => run.runId));
    const pendingRunIds = [...new Set(queue.approvals.map((item) => item.runId))]
      .filter((runId) => !knownMembers.has(runId) && runIdPattern.test(runId));
    const toResolve = pendingRunIds.slice(0, ownerConsoleLimits.maxOverviewClassifications);
    const resolved = new Map<string, string>();
    await mapBounded(toResolve, ownerConsoleLimits.readConcurrency, async (runId) => {
      try {
        const overview = await backend.getRunOverview(runId);
        if (overview.verdict === "allow") {
          const factualProject = str((overview.data as unknown as Record<string, unknown>).projectId);
          if (runIdPattern.test(factualProject)) resolved.set(runId, factualProject);
        }
      } catch {
        // stays unresolved
      }
    });
    const projectOf = (runId: string): string | null => (knownMembers.has(runId) ? projectId : resolved.get(runId) ?? null);
    const approvals = Object.freeze(queue.approvals.filter((item) => projectOf(item.runId) === projectId));
    return Object.freeze({
      approvals,
      pendingApprovals: approvals.filter((item) => item.status === "pending").length,
      highRiskApprovals: approvals.filter((item) => item.status === "pending" && highRisk.has(item.riskLevel)).length,
      unresolvedApprovals: queue.approvals.filter((item) => projectOf(item.runId) === null).length,
      queueTruncated: queue.queueTruncated,
    });
  }

  return Object.freeze({
    async loadOwnerShell(): Promise<OwnerConsoleShell> {
      return gate(async (backend) => {
        const { pendingApprovals, highRiskApprovals, queueTruncated } = await approvalQueue(backend);
        let list: ProjectList | null = null;
        try {
          list = await projectList(backend);
        } catch {
          list = null;
        }
        return {
          pendingApprovals, highRiskApprovals, queueTruncated,
          projectsAvailable: list !== null,
          projects: list?.projects ?? Object.freeze([]),
          projectsTruncated: list?.projectsTruncated ?? false,
        };
      });
    },

    async loadOwnerProjects(): Promise<OwnerConsoleProjects> {
      return gate(async (backend) => projectList(backend));
    },

    async loadOwnerDashboard(selector: ProjectSelector): Promise<OwnerConsoleDashboard> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        if (scope.mode === "all") {
          const queue = await approvalQueue(backend);
          const aggregate = await aggregateRuns(backend, list, ownerConsoleLimits.dashboardActiveWorkLimit);
          return { ...list, mode: "all" as const, scope, ...queue, aggregate, tasks: await dashboardTasks(backend, null) };
        }
        const runs = await projectRuns(backend, scope.project.projectId, ownerConsoleLimits.projectRunsLimit);
        if (runs === null) throw new Error("unavailable");
        const projectApprovals = await classifyProjectApprovals(backend, scope.project.projectId);
        const tasks = await dashboardTasks(backend, scope.project.projectId);
        return { ...list, mode: "project" as const, scope, runs, runsTruncated: runs.length >= ownerConsoleLimits.projectRunsLimit, runsLimit: ownerConsoleLimits.projectRunsLimit, projectApprovals, tasks };
      });
    },

    async loadOwnerRuns(selector: ProjectSelector): Promise<OwnerConsoleRuns> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        if (scope.mode === "all") {
          return { ...list, mode: "all" as const, scope, aggregate: await aggregateRuns(backend, list, ownerConsoleLimits.runsPageDisplayLimit) };
        }
        const runs = await projectRuns(backend, scope.project.projectId, ownerConsoleLimits.projectRunsLimit);
        if (runs === null) throw new Error("unavailable");
        return { ...list, mode: "project" as const, scope, runs, runsTruncated: runs.length >= ownerConsoleLimits.projectRunsLimit, runsLimit: ownerConsoleLimits.projectRunsLimit };
      });
    },

    async loadOwnerApprovals(selector: ProjectSelector): Promise<OwnerConsoleApprovals> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        if (scope.mode === "all") return { ...list, mode: "all" as const, scope, ...(await approvalQueue(backend)) };
        return { ...list, mode: "project" as const, scope, projectApprovals: await classifyProjectApprovals(backend, scope.project.projectId) };
      });
    },

    // AI-038.4a Tasks list: All Projects (workspace) or one validated project; factual tasks only.
    async loadOwnerTasks(selector: ProjectSelector): Promise<OwnerConsoleTasks> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        const tasks = await taskList(backend, "all", scope.mode === "project" ? scope.project.projectId : null);
        return { ...list, mode: scope.mode, scope, ...tasks };
      });
    },

    // AI-038.4b Quick Create: which projects may receive a new task. A selector that is invalid,
    // unknown, foreign or archived keeps the existing opaque `project_unavailable`.
    async loadOwnerQuickCreate(selector: ProjectSelector): Promise<OwnerConsoleQuickCreate> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        if (scope.mode === "all") {
          return { ...list, scope, target: "choose" as const, creatableProjects: Object.freeze(list.projects.filter((item) => item.status === "active")) };
        }
        if (scope.project.status === "active") return { ...list, scope, target: "project" as const, creatableProjects: Object.freeze([scope.project]) };
        if (scope.project.status === "paused") return { ...list, scope, target: "project_paused" as const, creatableProjects: Object.freeze([]) };
        throw new ProjectUnavailable();
      });
    },

    // AI-038.4a Task Detail. The ONLY target is the stable Task ID; the project selector never
    // authorizes access. Under a selected project, a task of another project is the same opaque
    // `unavailable` as an unknown task. The Task Result is factual aggregation only.
    async loadOwnerTask(taskId: unknown, selector: ProjectSelector): Promise<OwnerConsoleTaskView> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        const opaque = { ...list, scope, task: Object.freeze({ state: "unavailable" as const }) };
        if (typeof taskId !== "string" || !runIdPattern.test(taskId)) return opaque;
        let result;
        try {
          result = await backend.getTask(taskId);
        } catch {
          result = null;
        }
        if (!result || result.verdict !== "allow") return opaque;
        const data = result.data as unknown as Record<string, unknown>;
        const task = taskView(data.task as Record<string, unknown>);
        if (!task || task.taskId !== taskId) return opaque;
        if (scope.mode === "project" && task.projectId !== scope.project.projectId) return opaque;
        const runs = Object.freeze((Array.isArray(data.runs) ? data.runs : []).map((item) => projectRunView(item as Record<string, unknown>)));
        if (runs.some((run) => run.projectId !== task.projectId)) return opaque;
        const runsTruncated = data.runsTruncated === true;
        return {
          ...list,
          scope,
          task: Object.freeze({
            state: "available" as const,
            detail: Object.freeze({
              task,
              runs,
              runsTruncated,
              result: Object.freeze({
                status: task.status,
                completedAt: task.completedAt,
                linkedRunCount: task.linkedRunCount,
                latestRun: task.latestRun,
                completedRuns: runs.filter((run) => completedRunStatuses.has(run.status)).length,
                failedOrBlockedRuns: runs.filter((run) => failedRunStatuses.has(run.status)).length,
                activeRuns: runs.filter((run) => activeRunStatusSet.has(run.status)).length,
                runsTruncated,
              }),
            }),
          }),
        };
      });
    },

    // AI-039 Development Workflow. Same targeting as Task Detail: the ONLY target is the stable Task
    // ID, the project selector never authorizes access, and a task of another project under a selected
    // project is the same opaque `unavailable` as an unknown task. Plans that the backend cannot
    // present (corrupted, inconsistent, unreadable) are `unavailable` — never partial, never demo.
    async loadOwnerTaskDevelopment(taskId: unknown, selector: ProjectSelector): Promise<OwnerConsoleTaskDevelopment> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        const opaque = { ...list, scope, development: Object.freeze({ state: "unavailable" as const }) };
        if (typeof taskId !== "string" || !runIdPattern.test(taskId)) return opaque;
        let detail;
        try {
          detail = await backend.getTask(taskId);
        } catch {
          detail = null;
        }
        if (!detail || detail.verdict !== "allow") return opaque;
        const task = taskView((detail.data as unknown as Record<string, unknown>).task as Record<string, unknown>);
        if (!task || task.taskId !== taskId) return opaque;
        if (scope.mode === "project" && task.projectId !== scope.project.projectId) return opaque;
        let plans: Readonly<{ state: "available"; data: TaskFeaturePlans }> | Readonly<{ state: "unavailable" }> = Object.freeze({ state: "unavailable" as const });
        try {
          const result = await backend.getTaskFeaturePlans(taskId);
          const data = result.verdict === "allow" ? featurePlansView(result.data, task.taskId, task.projectId) : null;
          if (data) plans = Object.freeze({ state: "available" as const, data });
        } catch {
          // plans stay unavailable
        }
        const project = list.projects.find((item) => item.projectId === task.projectId) ?? null;
        return {
          ...list,
          scope,
          development: Object.freeze({
            state: "available" as const,
            task,
            project,
            plans,
            creationBlock: planCreationBlock(task.status, project?.status ?? null, plans.state === "available"),
          }),
        };
      });
    },

    // AI-038.4a My Attention: attention-status tasks + pending approvals. A selected project narrows
    // BOTH factually (approvals via the AI-038.3.2 classification, not a second algorithm).
    async loadOwnerAttention(selector: ProjectSelector): Promise<OwnerConsoleAttention> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        if (scope.mode === "all") {
          const attentionTasks = await taskList(backend, "attention", null);
          return { ...list, mode: "all" as const, scope, attentionTasks, ...(await approvalQueue(backend)) };
        }
        const attentionTasks = await taskList(backend, "attention", scope.project.projectId);
        return { ...list, mode: "project" as const, scope, attentionTasks, projectApprovals: await classifyProjectApprovals(backend, scope.project.projectId) };
      });
    },

    // Run Detail. The ONLY runtime target is `runId`; the project selector never authorizes access.
    // Under a selected project, a run whose FACTUAL project differs is the same opaque `unavailable`
    // as a missing run: it is never presented under the wrong project.
    async loadOwnerRun(runId: unknown, selector: ProjectSelector): Promise<OwnerConsoleRunView> {
      return gate(async (backend) => {
        if (selector.kind === "invalid") throw new ProjectUnavailable();
        const list = await projectList(backend);
        const scope = resolveScope(selector, list);
        const opaque = { ...list, scope, run: Object.freeze({ state: "unavailable" as const }) };
        if (typeof runId !== "string" || runId.length > ownerConsoleLimits.maxRunIdLength || !runIdPattern.test(runId)) return opaque;
        let overview;
        try {
          overview = await backend.getRunOverview(runId);
        } catch {
          overview = null;
        }
        if (!overview || overview.verdict !== "allow") return opaque;
        const data = overview.data as unknown as Record<string, unknown>;
        if (scope.mode === "project" && str(data.projectId) !== scope.project.projectId) return opaque;
        let audit: OwnerConsoleRunDetail["audit"] = Object.freeze({ state: "unavailable" as const });
        try {
          const timeline = await backend.getRunAuditTimeline(runId, ownerConsoleLimits.auditTimelineLimit);
          if (timeline.verdict === "allow") {
            audit = Object.freeze({
              state: "available" as const,
              limit: ownerConsoleLimits.auditTimelineLimit,
              items: Object.freeze(timeline.data.map((item) => Object.freeze({
                eventType: str(item.eventType), actorKind: str(item.actorKind), createdAt: str(item.createdAt),
              }))),
            });
          }
        } catch {
          // audit stays unavailable
        }
        let usage = usageView(data.modelUsage as Record<string, unknown>);
        try {
          const fresh = await backend.getRunModelUsage(runId);
          if (fresh.verdict === "allow") usage = usageView(fresh.data as unknown as Record<string, unknown>);
        } catch {
          // keep the overview's usage
        }
        return {
          ...list,
          scope,
          run: Object.freeze({
            state: "available" as const,
            detail: Object.freeze({
              run: runSummary(data),
              latestModelInvocation: invocationView(data.latestModelInvocation as Record<string, unknown>),
              usage,
              audit,
            }),
          }),
        };
      });
    },
  });
}

export type OwnerConsoleReader = ReturnType<typeof createOwnerConsoleReader>;
