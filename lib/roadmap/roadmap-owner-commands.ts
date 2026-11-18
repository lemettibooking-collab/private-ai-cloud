import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant";
import type { RoadmapCommand, RoadmapTaskMutation } from "../db/roadmap-store";
import type { ProjectTaskStatus } from "../tasks/project-task";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { exactOwnData, capturedMethod, resolveUserId, lockOwnerAuthority, Conflict, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { inTransaction } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { isTaskKey } from "../tasks/project-task.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { normalizeRoadmapMetadata, normalizeRoadmapDependencies, roadmapFingerprint, isRoadmapCommandId, validateRoadmapGraph } from "./roadmap-contract.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { captureRoadmapConfig, roadmapCommand, lockRoadmapProject, roadmapReplay, executeRoadmapCommand, readRoadmapTaskInTransaction, journalRoadmapTask, transitionRoadmapTaskInTransaction } from "../db/roadmap-store.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { revokeControllerExecutorAuthorities } from "../db/executor-controller-binding.ts";

export type RoadmapOwnerResult = Readonly<{ status: "applied" | "replayed"; milestoneId: string }> | Readonly<{ status: "invalid_input" | "conflict" | "unavailable" | "unauthenticated" | "recovery_required" }>;
const statusResult = <S extends string>(status: S) => Object.freeze({ status });
export async function replayRoadmapOwnerCommand(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, commandId: string, fingerprint: string): Promise<Readonly<Record<string, unknown>> | null> {
  const r = await client.query(`/* roadmap-owner:command-read */ select intent_fingerprint,result from roadmap_owner_commands where workspace_id=$1 and command_id=$2`, [tenant.workspaceDatabaseId, commandId]);
  if (!r.rowCount) return null;
  if (r.rows[0].intent_fingerprint !== fingerprint) throw new Conflict();
  const result = r.rows[0].result; if (!result || typeof result !== "object" || Array.isArray(result)) throw new Unavailable();
  return Object.freeze({ ...result as Record<string, unknown>, status: "replayed" });
}
export async function recordRoadmapOwnerCommand(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, commandId: string, fingerprint: string, result: Readonly<Record<string, unknown>>): Promise<void> {
  await client.query(`insert into roadmap_owner_commands(workspace_id,command_id,intent_fingerprint,result) values($1,$2,$3,$4::jsonb)`, [tenant.workspaceDatabaseId, commandId, fingerprint, JSON.stringify(result)]);
}
export async function executeRoadmapOwnerCommand(database: WorkflowRuntimeDatabase, tenant: ResolvedWorkflowRuntimeTenant, commandId: string, fingerprint: string,
  work: (client: WorkflowRuntimeSqlClient) => Promise<Readonly<Record<string, unknown>>>, authorizeReconciliation?: (client: WorkflowRuntimeSqlClient) => Promise<void>): Promise<Readonly<Record<string, unknown>>> {
  let workCompleted=false;
  try { return await inTransaction(database, async c=>{const result=await work(c);workCompleted=true;return result;}); }
  catch (error) {
    if (error instanceof Conflict) return statusResult("conflict");
    if(!workCompleted)return statusResult("unavailable");
    try { return await inTransaction(database, async c => {if(authorizeReconciliation)await authorizeReconciliation(c);return await replayRoadmapOwnerCommand(c, tenant, commandId, fingerprint) ?? statusResult("recovery_required");}); }
    catch { return statusResult("recovery_required"); }
  }
}
export function createRoadmapOwnerCommands(raw: unknown) {
  const { database, tenant, fields } = captureRoadmapConfig(raw, ["identitySource"]), resolve = capturedMethod(fields.identitySource, "resolve");
  if (!resolve) throw new Error("Invalid roadmap Owner identity source.");
  async function authenticate(): Promise<string | null> { return resolveUserId(resolve!); }
  async function createMilestone(input: unknown): Promise<RoadmapOwnerResult> {
    const f = exactOwnData(input, ["commandId","projectId","milestoneId","title","goal","priority"]);
    if (!f || !isRoadmapCommandId(f.commandId) || !isTaskKey(f.projectId) || !isTaskKey(f.milestoneId)
      || typeof f.title !== "string" || f.title.length < 1 || f.title.length > 200 || /[\u0000-\u001f\u007f]/u.test(f.title)
      || typeof f.goal !== "string" || f.goal.length < 1 || f.goal.length > 1000 || /[\u0000-\u001f\u007f]/u.test(f.goal)
      || !Number.isSafeInteger(f.priority) || (f.priority as number)<0 || (f.priority as number)>1000000) return statusResult("invalid_input");
    const user = await authenticate(); if (!user) return statusResult("unauthenticated");
    const fp = roadmapFingerprint(["roadmap.milestone.v1", f]);
    return await executeRoadmapOwnerCommand(database, tenant, f.commandId, fp, async c => {
      await lockOwnerAuthority(c,tenant,user); await lockRoadmapProject(c,tenant,f.projectId as string);
      const replay = await replayRoadmapOwnerCommand(c,tenant,f.commandId as string,fp); if(replay) return replay;
      await c.query(`insert into roadmap_milestones(workspace_id,project_key,milestone_key,title,goal,status,priority) values($1,$2,$3,$4,$5,'active',$6)`, [tenant.workspaceDatabaseId,f.projectId,f.milestoneId,f.title,f.goal,f.priority]);
      await c.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,metadata) values($1,$2,'roadmap.milestone_created','roadmap_milestone',$3::jsonb)`,[tenant.workspaceDatabaseId,user,JSON.stringify({ projectId:f.projectId,milestoneId:f.milestoneId })]);
      const result = Object.freeze({status:"applied",milestoneId:f.milestoneId}); await recordRoadmapOwnerCommand(c,tenant,f.commandId as string,fp,result);return result;
    },c=>lockOwnerAuthority(c,tenant,user)) as RoadmapOwnerResult;
  }
  async function enroll(input: unknown): Promise<RoadmapTaskMutation | Readonly<{ status:"unauthenticated" }>> {
    const command = roadmapCommand(input,["milestoneId","metadata","dependencyIds"]), metadata = command && normalizeRoadmapMetadata(command.metadata), dependencies = command && normalizeRoadmapDependencies(command.dependencyIds);
    if (!command || !isTaskKey(command.milestoneId) || !metadata || !dependencies || dependencies.includes(command.taskId)) return statusResult("invalid_input");
    const user=await authenticate();if(!user)return statusResult("unauthenticated");
    const fp=roadmapFingerprint(["roadmap.enroll.v1",command.commandId,command.projectId,command.taskId,command.expectedVersion,command.milestoneId,metadata,dependencies]);
    return executeRoadmapCommand(database,tenant,command,fp,async c=>{
      await lockOwnerAuthority(c,tenant,user);await lockRoadmapProject(c,tenant,command.projectId);
      const replay=await roadmapReplay(c,tenant,command,fp);if(replay)return replay;
      const q=await c.query(`select status,state_version,milestone_key from project_tasks where workspace_id=$1 and project_key=$2 and task_key=$3 for update`,[tenant.workspaceDatabaseId,command.projectId,command.taskId]);
      if(q.rowCount!==1)throw new Unavailable();const before=q.rows[0];
      if(before.state_version!==command.expectedVersion || !["draft","ready"].includes(before.status as string)
        || before.milestone_key!==null && before.milestone_key!==command.milestoneId)throw new Conflict();
      const m=await c.query(`select milestone_key from roadmap_milestones where workspace_id=$1 and project_key=$2 and milestone_key=$3 and status='active' for share`,[tenant.workspaceDatabaseId,command.projectId,command.milestoneId]);if(m.rowCount!==1)throw new Conflict();
      const graph=await c.query(`select t.task_key,t.status,t.priority,coalesce(array_agg(d.dependency_task_key order by d.dependency_task_key) filter(where d.dependency_task_key is not null),'{}') deps
        from project_tasks t left join roadmap_task_dependencies d on d.workspace_id=t.workspace_id and d.project_key=t.project_key and d.task_key=t.task_key
        where t.workspace_id=$1 and t.project_key=$2 group by t.task_key,t.status,t.priority order by t.task_key limit 257`,[tenant.workspaceDatabaseId,command.projectId]);
      if(!validateRoadmapGraph(graph.rows.map(r=>({taskId:r.task_key as string,status:r.status as ProjectTaskStatus,priority:r.priority as string|null,dependencyIds:r.task_key===command.taskId?dependencies:r.deps as string[]}))))throw new Conflict();
      await c.query(`update project_tasks set milestone_key=$4,roadmap_metadata=$5::jsonb,roadmap_metadata_fingerprint=$6,state_version=state_version+1
        where workspace_id=$1 and project_key=$2 and task_key=$3 and state_version=$7`,[tenant.workspaceDatabaseId,command.projectId,command.taskId,command.milestoneId,JSON.stringify(metadata),roadmapFingerprint(metadata),command.expectedVersion]);
      await c.query(`delete from roadmap_task_dependencies where workspace_id=$1 and project_key=$2 and task_key=$3`,[tenant.workspaceDatabaseId,command.projectId,command.taskId]);
      for(const dep of dependencies)await c.query(`insert into roadmap_task_dependencies(workspace_id,project_key,task_key,dependency_task_key) values($1,$2,$3,$4)`,[tenant.workspaceDatabaseId,command.projectId,command.taskId,dep]);
      await journalRoadmapTask(c,tenant,command,fp,{status:before.status as ProjectTaskStatus,version:command.expectedVersion},before.status as ProjectTaskStatus,before.milestone_key===null?"enrolled":"metadata_changed",user);
      const task=await readRoadmapTaskInTransaction(c,tenant,command.projectId,command.taskId);if(!task)throw new Unavailable();return Object.freeze({status:"applied" as const,task});
    },c=>lockOwnerAuthority(c,tenant,user));
  }
  async function changeState(input:unknown):Promise<RoadmapTaskMutation|Readonly<{status:"unauthenticated"}>>{
    const command=roadmapCommand(input,["nextStatus"]);if(!command||!["ready","draft","cancelled"].includes(command.nextStatus as string))return statusResult("invalid_input");
    const user=await authenticate();if(!user)return statusResult("unauthenticated");const fp=roadmapFingerprint(["roadmap.owner-state.v1",command]);
    return executeRoadmapCommand(database,tenant,command,fp,async c=>{
      await lockOwnerAuthority(c,tenant,user);await lockRoadmapProject(c,tenant,command.projectId);const replay=await roadmapReplay(c,tenant,command,fp);if(replay)return replay;
      const task=await readRoadmapTaskInTransaction(c,tenant,command.projectId,command.taskId,true);if(!task)throw new Unavailable();
      // Replanning is only pre-execution; controller/gate rows must be checked by its later adapter.
      if(command.nextStatus==="draft" && !["ready","planning","waiting_owner","blocked"].includes(task.status))throw new Conflict();
      if(command.nextStatus==="cancelled")await revokeControllerExecutorAuthorities(c,tenant,command.projectId,command.taskId);
      return transitionRoadmapTaskInTransaction(c,tenant,command as RoadmapCommand,fp,task,command.nextStatus as ProjectTaskStatus,user);
    },c=>lockOwnerAuthority(c,tenant,user));
  }
  return Object.freeze({createMilestone,enroll,changeState});
}
