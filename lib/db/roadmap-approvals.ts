import { randomUUID } from "node:crypto";
import type { WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { capturedMethod, resolveUserId, lockOwnerAuthority, Conflict, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { captureRoadmapConfig, roadmapCommand, lockRoadmapProject, readRoadmapTaskInTransaction } from "./roadmap-store.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { replayRoadmapOwnerCommand, recordRoadmapOwnerCommand, executeRoadmapOwnerCommand } from "../roadmap/roadmap-owner-commands.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { materializeApprovedRoadmapPlan, roadmapFingerprint, isRoadmapFingerprint } from "../roadmap/roadmap-contract.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { exactOwnData } from "../tasks/owner-task-mutations.ts";

export type RoadmapApprovalResult = Readonly<{ status: "applied" | "replayed"; approvalRequestId: string; bindingFingerprint: string }>
  | Readonly<{ status: "invalid_input" | "conflict" | "unavailable" | "unauthenticated" | "recovery_required" }>;
const outcome = <S extends string>(status:S)=>Object.freeze({status});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
/** Reads latest stored immutable draft; a historical revision is NEVER silently treated as current. */
export async function readLatestRoadmapPlan(client:WorkflowRuntimeSqlClient,tenant:ResolvedWorkflowRuntimeTenant,projectId:string,taskId:string){
  const q=await client.query(`select plan_key,revision,plan_json,plan_fingerprint from project_task_feature_plans where workspace_id=$1 and project_key=$2 and task_key=$3 order by revision desc limit 1`,[tenant.workspaceDatabaseId,projectId,taskId]);
  if(q.rowCount!==1)return null;const row=q.rows[0];
  if(typeof row.plan_key!=="string"||!Number.isSafeInteger(row.revision)||!isRoadmapFingerprint(row.plan_fingerprint))throw new Unavailable();
  const materialized=materializeApprovedRoadmapPlan(row.plan_json,row.plan_key,row.plan_fingerprint);if(!materialized)throw new Unavailable();
  return Object.freeze({...materialized,planId:row.plan_key,revision:row.revision as number});
}
/** Controller can ask for approval, but has no decide() operation or Owner identity. */
export function createRoadmapApprovalRequests(raw:unknown){
  const {database,tenant}=captureRoadmapConfig(raw);
  async function requestPlanApproval(input:unknown):Promise<RoadmapApprovalResult>{
    const command=roadmapCommand(input)??roadmapCommand(input,["expectedControllerRevision"]);
    if(!command||Object.hasOwn(command,"expectedControllerRevision")&&(!Number.isSafeInteger(command.expectedControllerRevision)||(command.expectedControllerRevision as number)<0))return outcome("invalid_input");
    const intent=roadmapFingerprint(["roadmap.plan-approval-request.v1",command]);
    return await executeRoadmapOwnerCommand(database,tenant,command.commandId,intent,async c=>{
      await lockRoadmapProject(c,tenant,command.projectId);
      const replay=await replayRoadmapOwnerCommand(c,tenant,command.commandId,intent);if(replay)return replay;
      if(Object.hasOwn(command,"expectedControllerRevision")){
        const current=await c.query(`select controller_revision from controller_project_tasks where workspace_id=$1 and project_key=$2 and task_key=$3`,[tenant.workspaceDatabaseId,command.projectId,command.taskId]);
        if(current.rowCount>1||(current.rows[0]?.controller_revision??0)!==command.expectedControllerRevision)throw new Conflict();
      }
      const task=await readRoadmapTaskInTransaction(c,tenant,command.projectId,command.taskId,true);
      if(!task||task.version!==command.expectedVersion||!["draft","ready","planning","waiting_owner"].includes(task.status))throw new Conflict();
      const plan=await readLatestRoadmapPlan(c,tenant,command.projectId,command.taskId);if(!plan)throw new Conflict();
      const binding=Object.freeze({workspaceId:tenant.workspaceId,projectId:command.projectId,taskId:command.taskId,purpose:"feature_plan_approval",taskVersion:task.version,
        planId:plan.planId,revision:plan.revision,draftFingerprint:plan.draftFingerprint,executionFingerprint:plan.executionFingerprint,allowedPaths:plan.allowedPaths,risk:plan.risk});
      const bindingFingerprint=roadmapFingerprint(["roadmap.approval-binding.v1",binding]);
      const old=await c.query(`select approval_request_id::text from roadmap_approval_bindings where workspace_id=$1 and task_key=$2 and purpose='feature_plan_approval' and expected_task_version=$3 and binding_fingerprint=$4`,[tenant.workspaceDatabaseId,command.taskId,task.version,bindingFingerprint]);
      const approvalRequestId=old.rowCount===1?old.rows[0].approval_request_id as string:randomUUID();
      if(!old.rowCount){
        await c.query(`insert into approval_requests(id,workspace_id,action_type,status,risk_level,allowed_approver_role_codes,original_payload)
          values($1,$2,'development_feature_plan_approval','pending',$3,array['owner'],$4::jsonb)`,[approvalRequestId,tenant.workspaceDatabaseId,plan.risk,JSON.stringify({projectId:command.projectId,taskId:command.taskId,bindingFingerprint})]);
        await c.query(`insert into roadmap_approval_bindings(workspace_id,project_key,task_key,approval_request_id,purpose,expected_task_version,plan_key,plan_revision,draft_fingerprint,execution_fingerprint,allowed_paths,risk_level,binding_fingerprint)
          values($1,$2,$3,$4,'feature_plan_approval',$5,$6,$7,$8,$9,$10,$11,$12)`,[tenant.workspaceDatabaseId,command.projectId,command.taskId,approvalRequestId,task.version,plan.planId,plan.revision,plan.draftFingerprint,plan.executionFingerprint,plan.allowedPaths,plan.risk,bindingFingerprint]);
        await c.query(`insert into audit_events(workspace_id,event_type,entity_type,entity_id,metadata) values($1,'roadmap.approval_requested','approval_request',$2,$3::jsonb)`,[tenant.workspaceDatabaseId,approvalRequestId,JSON.stringify({projectId:command.projectId,taskId:command.taskId,purpose:"feature_plan_approval"})]);
      }
      const result=Object.freeze({status:"applied",approvalRequestId,bindingFingerprint});await recordRoadmapOwnerCommand(c,tenant,command.commandId,intent,result);return result;
    }) as RoadmapApprovalResult;
  }
  return Object.freeze({requestPlanApproval});
}
/** Only the authenticated Owner boundary can write the existing approval_decisions table. */
export function createRoadmapOwnerApprovalDecisions(raw:unknown){
  const {database,tenant,fields}=captureRoadmapConfig(raw,["identitySource"]),resolve=capturedMethod(fields.identitySource,"resolve");if(!resolve)throw new Error("Invalid roadmap Owner identity source.");
  async function decide(input:unknown):Promise<RoadmapApprovalResult>{
    const f=exactOwnData(input,["commandId","projectId","taskId","expectedVersion","approvalRequestId","bindingFingerprint","decision"]);
    const command=roadmapCommand(input,["approvalRequestId","bindingFingerprint","decision"]);
    if(!f||!command||typeof f.approvalRequestId!=="string"||!uuid.test(f.approvalRequestId)||!isRoadmapFingerprint(f.bindingFingerprint)||!["approved","rejected"].includes(f.decision as string))return outcome("invalid_input");
    const user=await resolveUserId(resolve!);if(!user)return outcome("unauthenticated");
    const intent=roadmapFingerprint(["roadmap.plan-approval-decision.v1",f]);
    return await executeRoadmapOwnerCommand(database,tenant,command.commandId,intent,async c=>{
      await lockOwnerAuthority(c,tenant,user);await lockRoadmapProject(c,tenant,command.projectId);
      const replay=await replayRoadmapOwnerCommand(c,tenant,command.commandId,intent);if(replay)return replay;
      const task=await readRoadmapTaskInTransaction(c,tenant,command.projectId,command.taskId,true);
      if(!task||task.version!==command.expectedVersion)throw new Conflict();
      const bound=await readRoadmapPlanApproval(c,tenant,command.projectId,command.taskId,f.approvalRequestId as string,command.expectedVersion,false);
      if(!bound||bound.bindingFingerprint!==f.bindingFingerprint)throw new Conflict();
      const request=await c.query(`select status from approval_requests where workspace_id=$1 and id=$2 and action_type='development_feature_plan_approval' for update`,[tenant.workspaceDatabaseId,f.approvalRequestId]);
      if(request.rowCount!==1||request.rows[0].status!=="pending")throw new Conflict();
      await c.query(`insert into approval_decisions(workspace_id,approval_request_id,decision,decided_by_actor_id,command_id) values($1,$2,$3,$4,$5)`,[tenant.workspaceDatabaseId,f.approvalRequestId,f.decision,user,command.commandId]);
      await c.query(`update approval_requests set status=$3,resolved_at=clock_timestamp(),approved_by=case when $3='approved' then $4::uuid else null end,rejected_by=case when $3='rejected' then $4::uuid else null end where workspace_id=$1 and id=$2`,[tenant.workspaceDatabaseId,f.approvalRequestId,f.decision,user]);
      await c.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,'roadmap.approval_decided','approval_request',$3,$4::jsonb)`,[tenant.workspaceDatabaseId,user,f.approvalRequestId,JSON.stringify({projectId:command.projectId,taskId:command.taskId,decision:f.decision})]);
      const result=Object.freeze({status:"applied",approvalRequestId:f.approvalRequestId,bindingFingerprint:f.bindingFingerprint});await recordRoadmapOwnerCommand(c,tenant,command.commandId,intent,result);return result;
    },c=>lockOwnerAuthority(c,tenant,user)) as RoadmapApprovalResult;
  }
  return Object.freeze({decide});
}
/** Binding/current-version validation shared with controller's one-time approval consumption. */
export async function readRoadmapPlanApproval(client:WorkflowRuntimeSqlClient,tenant:ResolvedWorkflowRuntimeTenant,projectId:string,taskId:string,approvalRequestId:string,expectedVersion:number,requireApproved=true){
  if(!uuid.test(approvalRequestId))return null;
  const q=await client.query(`select b.*,r.status as approval_status,r.action_type,r.approved_by::text,r.rejected_by::text,r.resolved_at,d.decision,d.decided_by_actor_id,d.id::text as decision_id
    from roadmap_approval_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
    left join approval_decisions d on d.workspace_id=r.workspace_id and d.approval_request_id=r.id
    where b.workspace_id=$1 and b.project_key=$2 and b.task_key=$3 and b.approval_request_id=$4 and b.purpose='feature_plan_approval' and b.expected_task_version=$5`,[tenant.workspaceDatabaseId,projectId,taskId,approvalRequestId,expectedVersion]);
  if(q.rowCount!==1)return null;const row=q.rows[0],plan=await readLatestRoadmapPlan(client,tenant,projectId,taskId);if(!plan)return null;
  const binding={workspaceId:tenant.workspaceId,projectId,taskId,purpose:"feature_plan_approval",taskVersion:expectedVersion,planId:plan.planId,revision:plan.revision,draftFingerprint:plan.draftFingerprint,executionFingerprint:plan.executionFingerprint,allowedPaths:plan.allowedPaths,risk:plan.risk};
  if(row.action_type!=="development_feature_plan_approval"||row.plan_key!==plan.planId||row.plan_revision!==plan.revision||row.draft_fingerprint!==plan.draftFingerprint||row.execution_fingerprint!==plan.executionFingerprint
    ||roadmapFingerprint(row.allowed_paths)!==roadmapFingerprint(plan.allowedPaths)||row.risk_level!==plan.risk||row.binding_fingerprint!==roadmapFingerprint(["roadmap.approval-binding.v1",binding])
    ||requireApproved&&(row.approval_status!=="approved"||row.decision!=="approved"||!row.decision_id||typeof row.decided_by_actor_id!=="string"||!uuid.test(row.decided_by_actor_id)
      ||row.approved_by!==row.decided_by_actor_id||row.rejected_by!==null||row.resolved_at===null))return null;
  return Object.freeze({...plan,approvalRequestId,bindingFingerprint:row.binding_fingerprint as string,decisionId:row.decision_id as string|null,ownerActorId:row.decided_by_actor_id as string|null});
}
