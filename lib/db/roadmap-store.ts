import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
import type { ProjectTaskStatus, ProjectTaskType } from "../tasks/project-task";
import type { RoadmapMetadata } from "../roadmap/roadmap-contract";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { isResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { exactOwnData, capturedMethod, Conflict, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { inTransaction } from "./executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { isTaskKey, isProjectTaskStatus, isProjectTaskType } from "../tasks/project-task.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { normalizeRoadmapMetadata, normalizeRoadmapDependencies, roadmapFingerprint, isRoadmapCommandId, isRoadmapFingerprint, roadmapTaskTransitions, validateRoadmapGraph } from "../roadmap/roadmap-contract.ts";

export type RoadmapTask = Readonly<{ projectId: string; taskId: string; taskType: ProjectTaskType; status: ProjectTaskStatus; version: number;
  milestoneId: string; metadata: RoadmapMetadata; metadataFingerprint: string; dependencyIds: readonly string[]; priority: string | null; risk: string | null }>;
export type RoadmapTaskMutation = Readonly<{ status: "applied" | "replayed"; task: RoadmapTask }> | Readonly<{ status: "invalid_input" | "conflict" | "unavailable" | "recovery_required" | "blocked" }>;
export type RoadmapCommand = Readonly<{ commandId: string; projectId: string; taskId: string; expectedVersion: number }>;
export function roadmapCommand(raw: unknown, extra: readonly string[] = []): (Record<string, unknown> & RoadmapCommand) | null {
  const f = exactOwnData(raw, ["commandId", "projectId", "taskId", "expectedVersion", ...extra]);
  return f && isRoadmapCommandId(f.commandId) && isTaskKey(f.projectId) && isTaskKey(f.taskId) && Number.isSafeInteger(f.expectedVersion) && (f.expectedVersion as number) >= 0
    ? f as Record<string, unknown> & RoadmapCommand : null;
}
export function captureRoadmapConfig(raw: unknown, extra: readonly string[] = []): Readonly<{ database: WorkflowRuntimeDatabase; tenant: ResolvedWorkflowRuntimeTenant; fields: Record<string, unknown> }> {
  const f = exactOwnData(raw, ["database", "tenant", ...extra]), connect = f && capturedMethod(f.database, "connect");
  if (!f || !connect || !isResolvedWorkflowRuntimeTenant(f.tenant)) throw new Error("Invalid roadmap store configuration.");
  return Object.freeze({ database: Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]> }), tenant: f.tenant, fields: f });
}
/** SHARE authority/project, per-project short transaction guard, then task UPDATE. */
export async function lockRoadmapProject(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, projectId: string): Promise<void> {
  const p = await client.query(`/* roadmap:project-lock */ select p.project_key from projects p join workspaces w on w.id=p.workspace_id
    where p.workspace_id=$1 and p.project_key=$2 and p.status='active' and w.status in ('active','demo') for share of p,w`, [tenant.workspaceDatabaseId, projectId]);
  if (p.rowCount !== 1) throw new Unavailable();
  await client.query(`insert into roadmap_project_guards(workspace_id,project_key) values($1,$2) on conflict do nothing`, [tenant.workspaceDatabaseId, projectId]);
  await client.query(`/* roadmap:project-guard */ select project_key from roadmap_project_guards where workspace_id=$1 and project_key=$2 for update`, [tenant.workspaceDatabaseId, projectId]);
}
export async function readRoadmapTaskInTransaction(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, projectId: string, taskId: string, lock = false, verifyJournal = true): Promise<RoadmapTask | null> {
  const q = await client.query(`/* roadmap:task-read */ select task_key,project_key,task_type,status,state_version,milestone_key,roadmap_metadata,roadmap_metadata_fingerprint,priority,risk_level
    from project_tasks where workspace_id=$1 and project_key=$2 and task_key=$3 ${lock ? "for update" : ""}`, [tenant.workspaceDatabaseId, projectId, taskId]);
  if (!q.rowCount) return null;
  const r = q.rows[0], metadata = normalizeRoadmapMetadata(r.roadmap_metadata);
  if (!isTaskKey(r.task_key) || !isTaskKey(r.project_key) || !isProjectTaskType(r.task_type) || !isProjectTaskStatus(r.status)
    || !Number.isSafeInteger(r.state_version) || (r.state_version as number) < 1 || !isTaskKey(r.milestone_key) || !metadata
    || !isRoadmapFingerprint(r.roadmap_metadata_fingerprint) || roadmapFingerprint(metadata) !== r.roadmap_metadata_fingerprint) throw new Unavailable();
  const d = await client.query(`select dependency_task_key from roadmap_task_dependencies where workspace_id=$1 and project_key=$2 and task_key=$3 order by dependency_task_key limit 65`, [tenant.workspaceDatabaseId, projectId, taskId]);
  const dependencies = normalizeRoadmapDependencies(d.rows.map(x => x.dependency_task_key)); if (!dependencies || dependencies.length !== d.rowCount) throw new Unavailable();
  const task = Object.freeze({ projectId, taskId, taskType: r.task_type, status: r.status, version: r.state_version as number, milestoneId: r.milestone_key,
    metadata, metadataFingerprint: r.roadmap_metadata_fingerprint, dependencyIds: dependencies, priority: r.priority as string | null, risk: r.risk_level as string | null });
  if(verifyJournal){const e=await client.query(`select result_task from roadmap_task_events where workspace_id=$1 and project_key=$2 and task_key=$3 and next_version=$4`,[tenant.workspaceDatabaseId,projectId,taskId,task.version]);
    if(e.rowCount!==1||roadmapFingerprint(e.rows[0].result_task)!==roadmapFingerprint(task))throw new Unavailable();}
  return task;
}
export async function roadmapReplay(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, command: RoadmapCommand, fingerprint: string): Promise<RoadmapTaskMutation | null> {
  const q = await client.query(`/* roadmap:command-read */ select project_key,task_key,intent_fingerprint,next_version,next_status,result_task from roadmap_task_events where workspace_id=$1 and command_id=$2`, [tenant.workspaceDatabaseId, command.commandId]);
  if (!q.rowCount) return null;
  const r = q.rows[0]; if (r.project_key !== command.projectId || r.task_key !== command.taskId || r.intent_fingerprint !== fingerprint) return Object.freeze({ status: "conflict" });
  const task = exactOwnData(r.result_task, ["projectId","taskId","taskType","status","version","milestoneId","metadata","metadataFingerprint","dependencyIds","priority","risk"]);
  const metadata = task && normalizeRoadmapMetadata(task.metadata), dependencies = task && normalizeRoadmapDependencies(task.dependencyIds);
  if (!task || !metadata || !dependencies || task.projectId !== command.projectId || task.taskId !== command.taskId || !isProjectTaskType(task.taskType)
    || !isTaskKey(task.milestoneId) || !isProjectTaskStatus(task.status) || task.status !== r.next_status || task.version !== r.next_version
    || task.metadataFingerprint !== roadmapFingerprint(metadata)) return Object.freeze({ status: "recovery_required" });
  return Object.freeze({ status: "replayed", task: Object.freeze({ ...task, metadata, dependencyIds: dependencies }) as RoadmapTask });
}
export async function journalRoadmapTask(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, command: RoadmapCommand, fingerprint: string, before: Readonly<{ status: ProjectTaskStatus; version: number }>, next: ProjectTaskStatus,
  kind: "enrolled" | "metadata_changed" | "claimed" | "state_changed" | "owner_replanning", actor: string | null = null): Promise<void> {
  const resultTask = await readRoadmapTaskInTransaction(client, tenant, command.projectId, command.taskId, false, false); if (!resultTask) throw new Unavailable();
  await client.query(`/* roadmap:journal */ insert into roadmap_task_events(workspace_id,project_key,task_key,command_id,intent_fingerprint,previous_version,next_version,previous_status,next_status,event_kind,actor_user_id,result_task)
    values($1,$2,$3,$4,$5,$6,$6+1,$7,$8,$9,$10,$11::jsonb)`, [tenant.workspaceDatabaseId, command.projectId, command.taskId, command.commandId, fingerprint, before.version, before.status, next, kind, actor, JSON.stringify(resultTask)]);
  await client.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata)
    select $1,$2,'roadmap.task_transition','project_task',id,$3::jsonb from project_tasks where workspace_id=$1 and project_key=$4 and task_key=$5`,
  [tenant.workspaceDatabaseId, actor, JSON.stringify({ projectId: command.projectId, taskId: command.taskId, previousVersion: before.version, nextVersion: before.version + 1, from: before.status, to: next, kind }), command.projectId, command.taskId]);
}
/** Must be invoked under lockRoadmapProject + task UPDATE. No completion authority here. */
export async function transitionRoadmapTaskInTransaction(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, command: RoadmapCommand, fingerprint: string, task: RoadmapTask, next: ProjectTaskStatus, actor: string | null = null): Promise<RoadmapTaskMutation> {
  if (next === "completed" || next === "approved" || task.version !== command.expectedVersion || !roadmapTaskTransitions[task.status].includes(next)) throw new Conflict();
  const q = await client.query(`/* roadmap:task-cas */ update project_tasks set status=$4,state_version=state_version+1,completed_at=null where workspace_id=$1 and project_key=$2 and task_key=$3 and state_version=$5 returning task_key`, [tenant.workspaceDatabaseId, command.projectId, command.taskId, next, command.expectedVersion]);
  if (q.rowCount !== 1) throw new Conflict();
  await journalRoadmapTask(client, tenant, command, fingerprint, task, next, next === "planning" ? "claimed" : next === "draft" ? "owner_replanning" : "state_changed", actor);
  const updated = await readRoadmapTaskInTransaction(client, tenant, command.projectId, command.taskId); if (!updated) throw new Unavailable();
  return Object.freeze({ status: "applied", task: updated });
}
/** A lost COMMIT ACK is reconciled by durable command evidence AFTER its session is released. Never repeat work. */
export async function executeRoadmapCommand(database: WorkflowRuntimeDatabase, tenant: ResolvedWorkflowRuntimeTenant, command: RoadmapCommand, fingerprint: string,
  work: (client: WorkflowRuntimeSqlClient) => Promise<RoadmapTaskMutation>, authorizeReconciliation?: (client: WorkflowRuntimeSqlClient) => Promise<void>): Promise<RoadmapTaskMutation> {
  let workCompleted=false;
  try { return await inTransaction(database, async c=>{const result=await work(c);workCompleted=true;return result;}); }
  catch (error) {
    if (error instanceof Conflict) return Object.freeze({ status: "conflict" });
    if(!workCompleted)return Object.freeze({status:"unavailable"});
    try { return await inTransaction(database, async c => {if(authorizeReconciliation)await authorizeReconciliation(c);return await roadmapReplay(c, tenant, command, fingerprint) ?? Object.freeze({ status: "recovery_required" as const });}); }
    catch { return Object.freeze({ status: "recovery_required" }); }
  }
}
/** Shared atomic readiness/claim algorithm; controller wraps this in its own command journal. */
export async function claimRoadmapTaskInTransaction(c:WorkflowRuntimeSqlClient,tenant:ResolvedWorkflowRuntimeTenant,command:RoadmapCommand,fingerprint:string):Promise<RoadmapTaskMutation>{
  const task = await readRoadmapTaskInTransaction(c, tenant, command.projectId, command.taskId, true); if (!task) throw new Unavailable();
  if (task.status !== "ready" || task.version !== command.expectedVersion) throw new Conflict();
  const m = await c.query(`select status from roadmap_milestones where workspace_id=$1 and project_key=$2 and milestone_key=$3 and status='active' for share`, [tenant.workspaceDatabaseId, command.projectId, task.milestoneId]);
  if (m.rowCount !== 1) return Object.freeze({ status: "blocked" });
  const deps = await c.query(`select t.status from roadmap_task_dependencies d join project_tasks t on t.workspace_id=d.workspace_id and t.project_key=d.project_key and t.task_key=d.dependency_task_key
    where d.workspace_id=$1 and d.project_key=$2 and d.task_key=$3 order by t.task_key for share of t`, [tenant.workspaceDatabaseId, command.projectId, command.taskId]);
  if (deps.rowCount !== task.dependencyIds.length || deps.rows.some(d => d.status !== "completed")) return Object.freeze({ status: "blocked" });
  return transitionRoadmapTaskInTransaction(c, tenant, command, fingerprint, task, "planning");
}
export function createRoadmapStore(raw: unknown) {
  const { database, tenant } = captureRoadmapConfig(raw);
  async function readTask(projectId: string, taskId: string): Promise<RoadmapTask | null> {
    if (!isTaskKey(projectId) || !isTaskKey(taskId)) return null;
    try { return await inTransaction(database, c => readRoadmapTaskInTransaction(c, tenant, projectId, taskId)); } catch { return null; }
  }
  async function claimReady(input: unknown): Promise<RoadmapTaskMutation> {
    const command = roadmapCommand(input); if (!command) return Object.freeze({ status: "invalid_input" });
    const fingerprint = roadmapFingerprint(["roadmap.claim.v1", command]);
    return executeRoadmapCommand(database, tenant, command, fingerprint, async c => {
      await lockRoadmapProject(c, tenant, command.projectId);
      const replay = await roadmapReplay(c, tenant, command, fingerprint); if (replay) return replay;
      return claimRoadmapTaskInTransaction(c,tenant,command,fingerprint);
    });
  }
  async function projectGraph(projectId: string) {
    if (!isTaskKey(projectId)) return null;
    try { return await inTransaction(database, async c => {
      const q = await c.query(`select t.task_key,t.status,t.priority,coalesce(array_agg(d.dependency_task_key order by d.dependency_task_key) filter(where d.dependency_task_key is not null),'{}') as deps
        from project_tasks t left join roadmap_task_dependencies d on d.workspace_id=t.workspace_id and d.project_key=t.project_key and d.task_key=t.task_key
        where t.workspace_id=$1 and t.project_key=$2 group by t.task_key,t.status,t.priority order by t.task_key limit 257`, [tenant.workspaceDatabaseId, projectId]);
      const nodes = q.rows.map(r => ({ taskId: r.task_key as string, status: r.status as ProjectTaskStatus, priority: r.priority as string | null, dependencyIds: r.deps as string[] }));
      return validateRoadmapGraph(nodes) ? Object.freeze(nodes.map(n => Object.freeze({ ...n, dependencyIds: Object.freeze(n.dependencyIds) }))) : null;
    }); } catch { return null; }
  }
  return Object.freeze({ readTask, claimReady, projectGraph });
}
