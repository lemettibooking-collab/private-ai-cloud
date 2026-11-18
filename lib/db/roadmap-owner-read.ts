import type { WorkflowRuntimeDatabase } from "./workflow-runtime-store";
import type { ProjectTaskStatus } from "../tasks/project-task";
import type { PublicProjectSummary } from "../projects/project-registry";
import type { DevelopmentControllerState } from "./development-controller-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, capturedMethod, inTransaction } from "./executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { resolveUserId, lockOwnerAuthority, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver } from "./workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isTaskKey, isTaskTitle } from "../tasks/project-task.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { projectSummaryFromRow } from "../projects/project-registry.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { parseProjectSelector } from "../projects/project-context.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { readDevelopmentControllerStateInTransaction } from "./development-controller-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureRoadmapData } from "../roadmap/roadmap-contract.ts";

export type OwnerRoadmapGateStatus = "not_run" | "pending" | "pass" | "fail_retryable" | "fail_owner_required" | "hard_stop";
export type OwnerRoadmapNode = Readonly<{ developmentTaskId: string; status: string; attemptNumber: number; selectedExecutor: "openai-agents/v1" | "claude-managed-agents/v1" | null; quality: OwnerRoadmapGateStatus; security: OwnerRoadmapGateStatus }>;
export type OwnerRoadmapTask = Readonly<{ taskId: string; projectId: string; milestoneId: string; title: string; status: ProjectTaskStatus; ready: boolean;
  controllerRevision: number; completedNodes: number; totalNodes: number; nodes: readonly OwnerRoadmapNode[]; pendingOwnerPurposes: readonly string[]; heldExposureUsdMicros: number }>;
export type OwnerRoadmapMilestone = Readonly<{ milestoneId: string; projectId: string; title: string; status: "planned" | "active" | "blocked" | "completed" | "cancelled"; totalTasks: number; completedTasks: number }>;
export type OwnerRoadmapView = Readonly<{ state: "available"; projects: readonly PublicProjectSummary[]; scope: Readonly<{ mode: "all" }> | Readonly<{ mode: "project"; project: PublicProjectSummary }>;
  milestones: readonly OwnerRoadmapMilestone[]; tasks: readonly OwnerRoadmapTask[]; truncated: boolean; runtimeDispatchAllowed: false }>
  | Readonly<{ state: "unauthenticated" | "unavailable" | "project_unavailable" }>;
const denied = (state: "unauthenticated" | "unavailable" | "project_unavailable"): OwnerRoadmapView => Object.freeze({ state });
function integer(raw: unknown): number { const n = typeof raw === "string" && /^\d{1,16}$/u.test(raw) ? Number(raw) : raw; if (!Number.isSafeInteger(n) || (n as number) < 0) throw new Unavailable(); return n as number; }
const requireFact = (fact: unknown) => { if (!fact) throw new Unavailable(); };
const purposes = ["feature_plan_approval", "scope_change", "budget_or_risk_increase", "architecture_change", "result_acceptance"];
function nodeProjection(state: DevelopmentControllerState): readonly OwnerRoadmapNode[] {
  return Object.freeze(state.runs.map(({ run }) => {
    const intent = state.attempts.find(a => a.developmentRunId === run.id && a.attemptNumber === run.currentAttemptNumber);
    let selectedExecutor: OwnerRoadmapNode["selectedExecutor"] = null;
    if (intent) {
      const configuration = intent.configuration as { identity: { id: string; version: string } };
      const key = `${configuration.identity.id}/${configuration.identity.version}`;
      requireFact(key === "openai-agents/v1" || key === "claude-managed-agents/v1"); selectedExecutor = key as OwnerRoadmapNode["selectedExecutor"];
    }
    const gate = (kind: "quality" | "security"): OwnerRoadmapGateStatus => {
      const op = state.operations.find(o => o.developmentRunId === run.id && o.attemptNumber === run.currentAttemptNumber && o.kind === kind);
      if (!op) return "not_run"; if (op.status === "pending") return "pending";
      const outcome = (op.evidence as { outcome?: unknown })?.outcome;
      requireFact(["pass", "fail_retryable", "fail_owner_required", "hard_stop"].includes(outcome as string)); return outcome as OwnerRoadmapGateStatus;
    };
    return Object.freeze({ developmentTaskId: run.taskId, status: run.status, attemptNumber: run.currentAttemptNumber, selectedExecutor, quality: gate("quality"), security: gate("security") });
  }));
}

/** Request-scoped authenticated read only. No mutation facade, project-guard upsert or controller tick. */
export function createRoadmapOwnerReader(raw: unknown) {
  const f = exactOwnData(raw, ["database", "domainWorkspaceId", "identitySource"]), connect = f && capturedMethod(f.database, "connect"), resolve = f && capturedMethod(f.identitySource, "resolve");
  if (!f || !connect || !resolve || !isTaskKey(f.domainWorkspaceId)) throw Error("invalid_roadmap_read_configuration");
  const domainWorkspaceId = f.domainWorkspaceId;
  const database: WorkflowRuntimeDatabase = Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]> });
  async function read(rawProject: unknown = undefined): Promise<OwnerRoadmapView> {
    if (typeof window !== "undefined") return denied("unavailable");
    try {
      const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(domainWorkspaceId); if (!tenant) return denied("unavailable");
      const userId = await resolveUserId(resolve!); if (!userId) return denied("unauthenticated");
      return await inTransaction(database, async client => {
        // The same trusted Owner predicate/locks as existing Owner writes; SELECT only.
        // Every negative authorization exits before the first roadmap/raw business read.
        await lockOwnerAuthority(client, tenant, userId);
        const selector = parseProjectSelector(rawProject); if (selector.kind === "invalid") return denied("project_unavailable");
        const registry = await client.query(`/* roadmap-owner:projects */ select project_key,display_name,status,repository_url,default_branch from projects
          where workspace_id=$1 and status in ('active','paused') order by project_key limit 101 for share`, [tenant.workspaceDatabaseId]);
        requireFact(registry.rowCount <= 100);
        const projects = registry.rows.map(row => { const p = projectSummaryFromRow(row); if (!p || p.status === "archived") throw new Unavailable(); return p; });
        const selected = selector.kind === "candidate" ? projects.find(p => p.projectId === selector.projectId) : null;
        if (selector.kind === "candidate" && !selected) return denied("project_unavailable");
        const scopeProjects = selected ? [selected] : projects, ids = scopeProjects.map(p => p.projectId);
        // Read locks on EXISTING guards serialize against controller state writes. Never insert a guard from GET/render.
        const guards = await client.query(`/* roadmap-owner:guards */ select project_key from roadmap_project_guards where workspace_id=$1 and project_key=any($2::text[]) order by project_key for share`, [tenant.workspaceDatabaseId, ids]);
        const guarded = new Set(guards.rows.map(row => row.project_key));
        const milestonesRaw = await client.query(`/* roadmap-owner:milestones */ select m.project_key,m.milestone_key,m.title,m.status,
          (select count(*)::text from project_tasks t where t.workspace_id=m.workspace_id and t.project_key=m.project_key and t.milestone_key=m.milestone_key) as total_tasks,
          (select count(*)::text from project_tasks t where t.workspace_id=m.workspace_id and t.project_key=m.project_key and t.milestone_key=m.milestone_key and t.status='completed') as completed_tasks
          from roadmap_milestones m where m.workspace_id=$1 and m.project_key=any($2::text[]) order by m.priority,m.project_key,m.milestone_key limit 65`, [tenant.workspaceDatabaseId, ids]);
        requireFact(milestonesRaw.rowCount <= 64);
        const milestones = milestonesRaw.rows.map(row => {
          requireFact(isTaskKey(row.project_key) && ids.includes(row.project_key as string) && guarded.has(row.project_key) && isTaskKey(row.milestone_key) && isTaskTitle(row.title)
            && ["planned", "active", "blocked", "completed", "cancelled"].includes(row.status as string));
          const totalTasks = integer(row.total_tasks), completedTasks = integer(row.completed_tasks); requireFact(completedTasks <= totalTasks);
          return Object.freeze({ milestoneId: row.milestone_key as string, projectId: row.project_key as string, title: row.title as string, status: row.status as OwnerRoadmapMilestone["status"], totalTasks, completedTasks });
        });
        const rows = await client.query(`/* roadmap-owner:tasks */ select t.project_key,t.task_key,t.title,t.status,t.state_version,t.milestone_key,
          (t.status='ready' and p.status='active' and m.status='active' and not exists(select 1 from roadmap_task_dependencies d join project_tasks dep
            on dep.workspace_id=d.workspace_id and dep.project_key=d.project_key and dep.task_key=d.dependency_task_key
            where d.workspace_id=t.workspace_id and d.project_key=t.project_key and d.task_key=t.task_key and dep.status<>'completed')) as roadmap_ready
          from project_tasks t join projects p on p.workspace_id=t.workspace_id and p.project_key=t.project_key
          join roadmap_milestones m on m.workspace_id=t.workspace_id and m.project_key=t.project_key and m.milestone_key=t.milestone_key
          where t.workspace_id=$1 and t.project_key=any($2::text[]) and t.milestone_key is not null
          order by coalesce(t.priority,'P4'),t.project_key,t.task_key limit 65`, [tenant.workspaceDatabaseId, ids]);
        requireFact(rows.rowCount <= 65);
        const tasks: OwnerRoadmapTask[] = [];
        for (const row of rows.rows.slice(0, 64)) {
          requireFact(isTaskKey(row.project_key) && ids.includes(row.project_key as string) && guarded.has(row.project_key) && isTaskKey(row.task_key) && isTaskTitle(row.title) && typeof row.roadmap_ready === "boolean");
          const state = await readDevelopmentControllerStateInTransaction(client, tenant, row.project_key as string, row.task_key as string, true, undefined, undefined, false);
          requireFact(state.task.status === row.status && state.task.version === row.state_version && state.task.milestoneId === row.milestone_key
            && milestones.some(m => m.projectId === state.task.projectId && m.milestoneId === state.task.milestoneId));
          const queue = await client.query(`/* roadmap-owner:approvals */ select purpose from (
            select b.purpose from roadmap_approval_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
              where b.workspace_id=$1 and b.project_key=$2 and b.task_key=$3 and b.expected_task_version=$4 and r.status='pending'
            union all select b.purpose from controller_owner_gate_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
              where b.workspace_id=$1 and b.project_key=$2 and b.task_key=$3 and b.expected_task_version=$4 and r.status='pending') q order by purpose limit 17`, [tenant.workspaceDatabaseId, state.task.projectId, state.task.taskId, state.task.version]);
          requireFact(queue.rowCount <= 16 && queue.rows.every(r => purposes.includes(r.purpose as string)));
          const exposure = await client.query(`/* roadmap-owner:held */ select coalesce(sum(e.maximum_exposure_usd_micros) filter(where e.state in ('reserved','prepared','start_committed','reconciliation_required')),0)::text as held
            from executor_attempt_exposures e join controller_development_runs d on d.workspace_id=e.workspace_id and d.development_run_id=e.development_run_id
            where d.workspace_id=$1 and d.project_key=$2 and d.project_task_key=$3`, [tenant.workspaceDatabaseId, state.task.projectId, state.task.taskId]);
          requireFact(exposure.rowCount === 1);
          tasks.push(Object.freeze({ taskId: state.task.taskId, projectId: state.task.projectId, milestoneId: state.task.milestoneId, title: row.title as string, status: state.task.status, ready: row.roadmap_ready as boolean,
            controllerRevision: state.revision, completedNodes: state.runs.filter(r => r.run.status === "completed").length, totalNodes: state.approvedPlan?.plan.tasks.length ?? 0, nodes: nodeProjection(state),
            pendingOwnerPurposes: Object.freeze([...new Set(queue.rows.map(r => r.purpose as string))]), heldExposureUsdMicros: integer(exposure.rows[0].held) }));
        }
        // Explicit projection only. No snapshot, context, provider/session/account IDs, paths or digest leaves this boundary.
        return captureRoadmapData({ state: "available", projects, scope: selected ? { mode: "project", project: selected } : { mode: "all" }, milestones, tasks, truncated: rows.rowCount > 64, runtimeDispatchAllowed: false }) as OwnerRoadmapView;
      });
    } catch { return denied("unavailable"); }
  }
  return Object.freeze({ read });
}
