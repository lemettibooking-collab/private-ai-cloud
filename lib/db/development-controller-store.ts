import type { WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
import type { RoadmapTask, RoadmapCommand } from "./roadmap-store";
import type { FeaturePlan } from "../contracts/development-plan";
import type { DevelopmentExecutionRun, DevelopmentExecutionEvent } from "../contracts/development-execution";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { captureRoadmapConfig, roadmapCommand, lockRoadmapProject, readRoadmapTaskInTransaction, journalRoadmapTask, transitionRoadmapTaskInTransaction,claimRoadmapTaskInTransaction } from "./roadmap-store.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { readRoadmapPlanApproval } from "./roadmap-approvals.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { captureRoadmapData, roadmapFingerprint, isRoadmapFingerprint, deriveRoadmapTaskClass } from "../roadmap/roadmap-contract.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { exactOwnData, Conflict, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { inTransaction } from "./executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { isTaskKey, isProjectTaskStatus } from "../tasks/project-task.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { validateAndNormalizeDevelopmentExecutionRun, createDevelopmentExecutionRun, transitionDevelopmentExecutionRun } from "../contracts/development-execution.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { evaluateDevelopmentTaskAdmission, repositoryPathsOverlap } from "../contracts/development-task-policy.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { buildDevelopmentTaskWaves } from "../contracts/development-plan.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { deriveExecutorAuthorityFacts } from "../executors/executor-current-authority.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { normalizeDevelopmentQualityEvidence, normalizeDevelopmentSecurityEvidence, developmentQualityEvent, developmentSecurityEvent } from "../roadmap/development-gates.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { createExecutorHistoricalOutcomeReader } from "./executor-start-store.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { normalizeExecutorTarget } from "../executors/executor-start-boundary.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { revokeControllerExecutorAuthorities } from "./executor-controller-binding.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { normalizeSubscriptionIntent, subscriptionIntentFingerprint, subscriptionExecutorIdentity } from "../executors/ai044-subscription-intent.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { normalizeAI044SubscriptionContextManifest } from "../executors/ai044-subscription-context.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { readAI044SubscriptionOutcomeInTransaction } from "./ai044-subscription-approvals.ts";

export type ControllerApprovedPlan = Readonly<{ plan: FeaturePlan; planId: string; revision: number; draftFingerprint: string; executionFingerprint: string; approvalRequestId: string; approvalTaskVersion: number }>;
export type ControllerDevelopmentRun = Readonly<{ run: DevelopmentExecutionRun; revision: number; fingerprint: string }>;
export type ControllerAttemptIntent = Readonly<{ developmentRunId: string; attemptNumber: number; projectTaskStateVersion: number; runRevision: number;
  configuration: unknown; configurationFingerprint: string; invocation: unknown; invocationFingerprint: string; context: unknown; contextFingerprint: string;
  route: unknown; routeFingerprint: string; executionPolicy: unknown; executionPolicyFingerprint: string; intentFingerprint: string }>;
export type ControllerOperation = Readonly<{ operationId: string; developmentRunId: string; runRevision: number; attemptNumber: number; kind: "executor" | "quality" | "security";
  status: "pending" | "recorded"; intentFingerprint: string; evidence: unknown; evidenceFingerprint: string | null; outcomeFingerprint: string | null }>;
export type DevelopmentControllerState = Readonly<{ task: RoadmapTask; revision: number; approvedPlan: ControllerApprovedPlan | null;
  runs: readonly ControllerDevelopmentRun[]; attempts: readonly ControllerAttemptIntent[]; operations: readonly ControllerOperation[] }>;
export type DevelopmentControllerCommand = RoadmapCommand & Readonly<{ expectedControllerRevision: number }>;
export type DevelopmentControllerDecision = Readonly<{ status: "applied" | "replayed"; state: DevelopmentControllerState }>
  | Readonly<{ status: "invalid_input" | "conflict" | "unavailable" | "recovery_required" | "blocked"; state: null }>;
export type ControllerCreateRunInput = DevelopmentControllerCommand & Readonly<{ developmentRunId: string; developmentTaskId: string; admission: unknown }>;
export type ControllerTransitionRunInput = DevelopmentControllerCommand & Readonly<{ developmentRunId: string; expectedRunRevision: number; event: DevelopmentExecutionEvent }>;

// Implemented below; exported shared transaction helpers remain server-internal, never caller APIs.
export type ControllerTransactionFacts = Readonly<{ client: WorkflowRuntimeSqlClient; tenant: ResolvedWorkflowRuntimeTenant; state: DevelopmentControllerState }>;

const deny = (status: "invalid_input"|"conflict"|"unavailable"|"recovery_required"|"blocked"):DevelopmentControllerDecision=>Object.freeze({status,state:null});
const requireFact=(condition:unknown):void=>{if(!condition)throw new Unavailable();};
export const controllerRunFingerprint=(run:DevelopmentExecutionRun):string=>roadmapFingerprint(["pac.controller-development-run.v1",run]);
export function controllerAttemptIntentFingerprint(projectTaskId:string,intent:Omit<ControllerAttemptIntent,"configurationFingerprint"|"invocationFingerprint"|"contextFingerprint"|"routeFingerprint"|"executionPolicyFingerprint"|"intentFingerprint">):string{
  return roadmapFingerprint(["pac.controller-attempt-intent.v1",{projectTaskId,...intent}]);
}
/** Parent status/version are external CAS facts, not a mutable copy inside controller ownership. */
function ownedStateFingerprint(state:DevelopmentControllerState):string{
  return roadmapFingerprint(["pac.controller-state.v1",{projectId:state.task.projectId,taskId:state.task.taskId,revision:state.revision,approvedPlan:state.approvedPlan,runs:state.runs,attempts:state.attempts,operations:state.operations}]);
}
export function controllerResultAcceptanceFingerprint(state:DevelopmentControllerState):string{
  return roadmapFingerprint(["pac.controller-result-acceptance.v1",{taskId:state.task.taskId,projectId:state.task.projectId,taskVersion:state.task.version,approvedPlan:state.approvedPlan,runs:state.runs,
    gates:state.operations.filter(o=>o.status==="recorded"&&(o.kind==="quality"||o.kind==="security"))}]);
}
function normalizedRun(raw:unknown):DevelopmentExecutionRun{
  const captured=captureRoadmapData(raw),v=validateAndNormalizeDevelopmentExecutionRun(captured);if(!v.ok||roadmapFingerprint(v.value)!==roadmapFingerprint(captured))throw new Unavailable();
  return captureRoadmapData(v.value) as DevelopmentExecutionRun;
}
function normalizeStoredState(raw:unknown):DevelopmentControllerState{
  const s=exactOwnData(captureRoadmapData(raw),["task","revision","approvedPlan","runs","attempts","operations"]);if(!s||!Number.isSafeInteger(s.revision)||!Array.isArray(s.runs)||!Array.isArray(s.attempts)||!Array.isArray(s.operations))throw new Unavailable();
  const task=s.task as RoadmapTask;requireFact(task&&isTaskKey(task.projectId)&&isTaskKey(task.taskId)&&isProjectTaskStatus(task.status));
  for(const r of s.runs){const x=r as ControllerDevelopmentRun;requireFact(controllerRunFingerprint(normalizedRun(x.run))===x.fingerprint&&Number.isSafeInteger(x.revision));}
  return Object.freeze(s) as DevelopmentControllerState;
}
/** Caller holds the short per-project guard. All snapshots/history are canonical-validated on read. */
export async function readDevelopmentControllerStateInTransaction(client:WorkflowRuntimeSqlClient,tenant:ResolvedWorkflowRuntimeTenant,projectId:string,taskId:string,verify=true,overridePlan?:ControllerApprovedPlan|null,overrideRevision?:number,lockRows=true):Promise<DevelopmentControllerState>{
  const task=await readRoadmapTaskInTransaction(client,tenant,projectId,taskId,lockRows);if(!task)throw new Unavailable();
  const q=await client.query(`select * from controller_project_tasks where workspace_id=$1 and project_key=$2 and task_key=$3 ${lockRows?"for update":""}`,[tenant.workspaceDatabaseId,projectId,taskId]);requireFact(q.rowCount<=1);
  const row=q.rows[0];let approvedPlan:ControllerApprovedPlan|null=null;
  if(overridePlan!==undefined)approvedPlan=overridePlan;
  else if(row?.plan_approval_request_id!==null&&row?.plan_approval_request_id!==undefined){
    const plan=await readRoadmapPlanApproval(client,tenant,projectId,taskId,row.plan_approval_request_id as string,row.approval_task_version as number);if(!plan)throw new Unavailable();
    requireFact(plan.planId===row.plan_key&&plan.revision===row.plan_revision&&plan.draftFingerprint===row.draft_fingerprint&&plan.executionFingerprint===row.approved_fingerprint&&roadmapFingerprint(plan.plan)===roadmapFingerprint(row.plan_json)&&task.version>(row.approval_task_version as number));
    approvedPlan=Object.freeze({plan:plan.plan,planId:plan.planId,revision:plan.revision,draftFingerprint:plan.draftFingerprint,executionFingerprint:plan.executionFingerprint,approvalRequestId:plan.approvalRequestId,approvalTaskVersion:row.approval_task_version as number});
  }
  const runRows=await client.query(`select * from controller_development_runs where workspace_id=$1 and project_key=$2 and project_task_key=$3 order by development_run_id limit 257`,[tenant.workspaceDatabaseId,projectId,taskId]);requireFact(runRows.rowCount<=256);
  const runs:ControllerDevelopmentRun[]=[];
  for(const r of runRows.rows){
    const run=normalizedRun(r.run_snapshot);requireFact(approvedPlan&&run.id===r.development_run_id&&run.planId===approvedPlan.planId&&r.plan_key===approvedPlan.planId&&r.plan_revision===approvedPlan.revision
      &&r.draft_fingerprint===approvedPlan.draftFingerprint&&r.approved_fingerprint===approvedPlan.executionFingerprint&&approvedPlan.plan.tasks.some(t=>t.id===run.taskId)&&controllerRunFingerprint(run)===r.run_fingerprint&&Number.isSafeInteger(r.run_revision));
    const history=await client.query(`select run_revision,event_json,run_snapshot,run_fingerprint from controller_development_events where workspace_id=$1 and development_run_id=$2 order by run_revision limit 257`,[tenant.workspaceDatabaseId,run.id]);
    requireFact(history.rowCount===(r.run_revision as number)+1&&history.rowCount<=256);let previous:DevelopmentExecutionRun|null=null;
    for(const [index,event]of history.rows.entries()){
      requireFact(event.run_revision===index);const evidence=captureRoadmapData(event.event_json) as Record<string,unknown>;
      const replay=index===0&&evidence.type==="created"?createDevelopmentExecutionRun(evidence.creation):previous?transitionDevelopmentExecutionRun(previous,evidence):null;
      const historical=normalizedRun(event.run_snapshot);requireFact(replay?.ok&&roadmapFingerprint(replay.value)===roadmapFingerprint(historical)&&controllerRunFingerprint(historical)===event.run_fingerprint);previous=historical;
    }
    requireFact(previous&&roadmapFingerprint(previous)===roadmapFingerprint(run));runs.push(Object.freeze({run,revision:r.run_revision as number,fingerprint:r.run_fingerprint as string}));
  }
  const intentRows=await client.query(`select i.* from controller_attempt_intents i join controller_development_runs r on r.workspace_id=i.workspace_id and r.development_run_id=i.development_run_id where r.workspace_id=$1 and r.project_key=$2 and r.project_task_key=$3 order by i.development_run_id,i.attempt_number limit 769`,[tenant.workspaceDatabaseId,projectId,taskId]);requireFact(intentRows.rowCount<=768);
  const attempts:ControllerAttemptIntent[]=intentRows.rows.map(r=>{
    const base={developmentRunId:r.development_run_id as string,attemptNumber:r.attempt_number as number,projectTaskStateVersion:r.project_task_state_version as number,runRevision:r.run_revision as number,
      configuration:captureRoadmapData(r.configuration_json),invocation:captureRoadmapData(r.invocation_json),context:captureRoadmapData(r.context_json),route:captureRoadmapData(r.route_json),executionPolicy:captureRoadmapData(r.execution_policy_json)};
    const result=Object.freeze({...base,configurationFingerprint:roadmapFingerprint(base.configuration),invocationFingerprint:roadmapFingerprint(base.invocation),contextFingerprint:roadmapFingerprint(base.context),routeFingerprint:roadmapFingerprint(base.route),executionPolicyFingerprint:roadmapFingerprint(base.executionPolicy),intentFingerprint:controllerAttemptIntentFingerprint(taskId,base)});
    requireFact(result.configurationFingerprint===r.configuration_fingerprint&&result.invocationFingerprint===r.invocation_fingerprint&&result.contextFingerprint===r.context_fingerprint&&result.routeFingerprint===r.route_fingerprint&&result.executionPolicyFingerprint===r.execution_policy_fingerprint&&result.intentFingerprint===r.intent_fingerprint&&task.version>=result.projectTaskStateVersion);return result;
  });
  const opRows=await client.query(`select * from controller_operations where workspace_id=$1 and project_key=$2 and project_task_key=$3 order by operation_id limit 2305`,[tenant.workspaceDatabaseId,projectId,taskId]);requireFact(opRows.rowCount<=2304);
  const operations:ControllerOperation[]=opRows.rows.map(r=>{
    requireFact(["executor","quality","security"].includes(r.kind as string)&&["pending","recorded"].includes(r.status as string)&&isRoadmapFingerprint(r.intent_fingerprint));
    const evidence=r.evidence_json===null?null:captureRoadmapData(r.evidence_json);requireFact((r.status==="pending"&&evidence===null&&r.evidence_fingerprint===null)||(r.status==="recorded"&&evidence!==null&&roadmapFingerprint(evidence)===r.evidence_fingerprint));
    return Object.freeze({operationId:r.operation_id as string,developmentRunId:r.development_run_id as string,runRevision:r.run_revision as number,attemptNumber:r.attempt_number as number,kind:r.kind as ControllerOperation["kind"],status:r.status as ControllerOperation["status"],intentFingerprint:r.intent_fingerprint as string,evidence,evidenceFingerprint:r.evidence_fingerprint as string|null,outcomeFingerprint:r.outcome_fingerprint as string|null});
  });
  const state=Object.freeze({task,revision:overrideRevision??row?.controller_revision as number??0,approvedPlan,runs:Object.freeze(runs),attempts:Object.freeze(attempts),operations:Object.freeze(operations)});
  if(verify&&row){requireFact(ownedStateFingerprint(state)===row.current_fingerprint);const e=await client.query(`select result_state,state_fingerprint from controller_state_events where workspace_id=$1 and task_key=$2 and controller_revision=$3`,[tenant.workspaceDatabaseId,taskId,state.revision]);requireFact(e.rowCount===1&&e.rows[0].state_fingerprint===row.current_fingerprint&&ownedStateFingerprint(normalizeStoredState(e.rows[0].result_state))===row.current_fingerprint);}
  return state;
}

function parseCommand(raw:unknown,extra:readonly string[]=[]) {
  const c=roadmapCommand(raw,["expectedControllerRevision",...extra]);
  if(!c||!Number.isSafeInteger(c.expectedControllerRevision)||(c.expectedControllerRevision as number)<0)return null;
  try{return captureRoadmapData(c) as Record<string,unknown>&DevelopmentControllerCommand;}catch{return null;}
}
const baseCommand=(c:DevelopmentControllerCommand)=>({commandId:c.commandId,projectId:c.projectId,taskId:c.taskId,expectedVersion:c.expectedVersion,expectedControllerRevision:c.expectedControllerRevision});
async function replayCommand(client:WorkflowRuntimeSqlClient,tenant:ResolvedWorkflowRuntimeTenant,command:DevelopmentControllerCommand,intent?:string):Promise<DevelopmentControllerDecision|null>{
  const q=await client.query(`/* controller:command-read */ select project_key,task_key,command_base_fingerprint,intent_fingerprint,result_state,state_fingerprint from controller_state_events where workspace_id=$1 and command_id=$2`,[tenant.workspaceDatabaseId,command.commandId]);if(!q.rowCount)return null;const r=q.rows[0];
  if(r.project_key!==command.projectId||r.task_key!==command.taskId||r.command_base_fingerprint!==roadmapFingerprint(["pac.controller-command-base.v1",baseCommand(command)])||intent!==undefined&&r.intent_fingerprint!==intent)return deny("conflict");
  const state=normalizeStoredState(r.result_state);if(ownedStateFingerprint(state)!==r.state_fingerprint)return deny("recovery_required");return Object.freeze({status:"replayed",state});
}
export function createDevelopmentControllerStore(raw:unknown){
  const {database,tenant}=captureRoadmapConfig(raw);
  async function read(projectId:string,taskId:string):Promise<DevelopmentControllerState|null>{
    if(!isTaskKey(projectId)||!isTaskKey(taskId))return null;
    try{return await inTransaction(database,async c=>{await lockRoadmapProject(c,tenant,projectId);return readDevelopmentControllerStateInTransaction(c,tenant,projectId,taskId);});}catch{return null;}
  }
  /** Immutable historical evidence only. Never reconstructs current authority or a start handle. */
  async function readRevision(projectId:string,taskId:string,revision:number):Promise<DevelopmentControllerState|null>{
    if(!isTaskKey(projectId)||!isTaskKey(taskId)||!Number.isSafeInteger(revision)||revision<1)return null;
    try{return await inTransaction(database,async client=>{
      const q=await client.query(`select result_state,state_fingerprint from controller_state_events where workspace_id=$1 and project_key=$2 and task_key=$3 and controller_revision=$4`,[tenant.workspaceDatabaseId,projectId,taskId,revision]);
      if(q.rowCount!==1)return null;const state=normalizeStoredState(q.rows[0].result_state);
      return state.task.projectId===projectId&&state.task.taskId===taskId&&state.revision===revision&&ownedStateFingerprint(state)===q.rows[0].state_fingerprint?state:null;
    });}catch{return null;}
  }
  async function replay(raw:unknown):Promise<DevelopmentControllerDecision|null>{const c=parseCommand(raw);if(!c)return deny("invalid_input");try{return await inTransaction(database,client=>replayCommand(client,tenant,c));}catch{return deny("recovery_required");}}
  async function mutate(input:unknown,extra:readonly string[],kind:string,work:(client:WorkflowRuntimeSqlClient,state:DevelopmentControllerState,c:Record<string,unknown>&DevelopmentControllerCommand)=>Promise<ControllerApprovedPlan|null|void>):Promise<DevelopmentControllerDecision>{
    const command=parseCommand(input,extra);if(!command)return deny("invalid_input");const intent=roadmapFingerprint(["pac.controller-command.v1",kind,command]);let workCompleted=false;
    try{return await inTransaction(database,async c=>{
      await lockRoadmapProject(c,tenant,command.projectId);const old=await replayCommand(c,tenant,command,intent);if(old)return old;
      const state=await readDevelopmentControllerStateInTransaction(c,tenant,command.projectId,command.taskId);
      if(state.task.version!==command.expectedVersion||state.revision!==command.expectedControllerRevision)throw new Conflict();
      const planPatch=await work(c,state,command);const after=await readDevelopmentControllerStateInTransaction(c,tenant,command.projectId,command.taskId,false,planPatch===undefined?state.approvedPlan:planPatch,state.revision+1),fingerprint=ownedStateFingerprint(after),plan=after.approvedPlan;
      if(state.revision===0)await c.query(`insert into controller_project_tasks(workspace_id,project_key,task_key,controller_revision,plan_approval_request_id,approval_task_version,plan_key,plan_revision,draft_fingerprint,approved_fingerprint,plan_json,current_fingerprint) values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,[tenant.workspaceDatabaseId,command.projectId,command.taskId,plan?.approvalRequestId??null,plan?.approvalTaskVersion??null,plan?.planId??null,plan?.revision??null,plan?.draftFingerprint??null,plan?.executionFingerprint??null,plan?JSON.stringify(plan.plan):null,fingerprint]);
      else{const updated=await c.query(`/* controller:state-cas */ update controller_project_tasks set controller_revision=controller_revision+1,plan_approval_request_id=$5,approval_task_version=$6,plan_key=$7,plan_revision=$8,draft_fingerprint=$9,approved_fingerprint=$10,plan_json=$11::jsonb,current_fingerprint=$12 where workspace_id=$1 and project_key=$2 and task_key=$3 and controller_revision=$4 returning task_key`,[tenant.workspaceDatabaseId,command.projectId,command.taskId,state.revision,plan?.approvalRequestId??null,plan?.approvalTaskVersion??null,plan?.planId??null,plan?.revision??null,plan?.draftFingerprint??null,plan?.executionFingerprint??null,plan?JSON.stringify(plan.plan):null,fingerprint]);if(updated.rowCount!==1)throw new Conflict();}
      await c.query(`insert into controller_state_events(workspace_id,project_key,task_key,command_id,intent_fingerprint,controller_revision,result_state,state_fingerprint,command_base_fingerprint) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,[tenant.workspaceDatabaseId,command.projectId,command.taskId,command.commandId,intent,after.revision,JSON.stringify(after),fingerprint,roadmapFingerprint(["pac.controller-command-base.v1",baseCommand(command)])]);
      await c.query(`insert into audit_events(workspace_id,event_type,entity_type,entity_id,metadata) select $1,'controller.transition','project_task',id,$2::jsonb from project_tasks where workspace_id=$1 and task_key=$3`,[tenant.workspaceDatabaseId,JSON.stringify({projectId:command.projectId,taskId:command.taskId,revision:after.revision,operation:kind}),command.taskId]);workCompleted=true;return Object.freeze({status:"applied" as const,state:after});
    });}catch(error){if(error instanceof Conflict)return deny("conflict");if(!workCompleted)return deny("unavailable");try{return await inTransaction(database,async c=>await replayCommand(c,tenant,command,intent)??deny("recovery_required"));}catch{return deny("recovery_required");}}
  }
  async function changeTaskState(input:unknown){return mutate(input,["nextStatus"],"task_state",async(client,state,c)=>{
    if(!isProjectTaskStatus(c.nextStatus)||["completed","approved","draft","ready"].includes(c.nextStatus))throw new Conflict();
    const result=await transitionRoadmapTaskInTransaction(client,tenant,c,roadmapFingerprint(["controller.task-state.v1",c]),state.task,c.nextStatus);if(result.status!=="applied")throw new Conflict();
    if(["blocked","recovery_required","cancelled","waiting_owner"].includes(c.nextStatus))await revokeControllerExecutorAuthorities(client,tenant,c.projectId,c.taskId);
  });}
  async function claimReady(input:unknown){return mutate(input,[],"claim_ready",async(client,_state,c)=>{const r=await claimRoadmapTaskInTransaction(client,tenant,c,roadmapFingerprint(["controller.claim.v1",c]));if(r.status!=="applied")throw new Conflict();});}
  async function consumePlanApproval(input:unknown){return mutate(input,["approvalRequestId"],"consume_plan",async(client,state,c)=>{
    if(state.approvedPlan||typeof c.approvalRequestId!=="string"||!["planning","waiting_owner"].includes(state.task.status))throw new Conflict();
    const plan=await readRoadmapPlanApproval(client,tenant,c.projectId,c.taskId,c.approvalRequestId,c.expectedVersion);if(!plan)throw new Conflict();
    const updated=await client.query(`update project_tasks set status='approved',state_version=state_version+1 where workspace_id=$1 and project_key=$2 and task_key=$3 and state_version=$4 returning task_key`,[tenant.workspaceDatabaseId,c.projectId,c.taskId,c.expectedVersion]);if(updated.rowCount!==1)throw new Conflict();
    await journalRoadmapTask(client,tenant,c,roadmapFingerprint(["controller.consume-plan.v1",c]),state.task,"approved","state_changed");
    return Object.freeze({plan:plan.plan,planId:plan.planId,revision:plan.revision,draftFingerprint:plan.draftFingerprint,executionFingerprint:plan.executionFingerprint,approvalRequestId:plan.approvalRequestId,approvalTaskVersion:c.expectedVersion});
  });}
  async function createRun(input:unknown){return mutate(input,["developmentRunId","developmentTaskId","admission"],"create_run",async(client,state,c)=>{
    const plan=state.approvedPlan;if(!plan||!isTaskKey(c.developmentRunId)||!isTaskKey(c.developmentTaskId)||!["approved","running","verifying"].includes(state.task.status)||state.runs.some(r=>r.run.taskId===c.developmentTaskId))throw new Conflict();
    const task=plan.plan.tasks.find(t=>t.id===c.developmentTaskId);if(!task)throw new Conflict();
    const completed=state.runs.filter(r=>r.run.status==="completed").map(r=>r.run.taskId),active=state.runs.filter(r=>!["completed","cancelled","blocked"].includes(r.run.status)).map(r=>r.run.taskId);
    const waves=buildDevelopmentTaskWaves(plan.plan);if(!waves.ok||!task.dependencyIds.every(id=>completed.includes(id)))throw new Conflict();
    const proposed=exactOwnData(c.admission,["plan","taskId","completedTaskIds","activeTaskIds","repositoryAllowlist","taskOwnerApprovalGranted"]);
    if(!proposed||roadmapFingerprint(proposed.plan)!==roadmapFingerprint(plan.plan)||proposed.taskId!==task.id||proposed.taskOwnerApprovalGranted!==true)throw new Conflict();
    const admission=evaluateDevelopmentTaskAdmission({...proposed,completedTaskIds:completed,activeTaskIds:active});if(admission.verdict!=="allow")throw new Conflict();
    const others=await client.query(`select r.run_snapshot,(exists(select 1 from executor_attempt_exposures e where e.workspace_id=r.workspace_id and e.development_run_id=r.development_run_id and e.state in ('start_committed','reconciliation_required'))
      or exists(select 1 from ai044_subscription_approval_bindings s where s.workspace_id=r.workspace_id and s.development_run_id=r.development_run_id and s.state in ('consumed','started','outcome_unknown'))) as unresolved_started
      from controller_development_runs r where r.workspace_id=$1 and r.project_key=$2 and r.project_task_key<>$3 limit 257`,[tenant.workspaceDatabaseId,c.projectId,c.taskId]);if(others.rowCount>256)throw new Conflict();
    for(const row of others.rows){const other=normalizedRun(row.run_snapshot);if((row.unresolved_started===true||!["completed","cancelled","blocked"].includes(other.status))&&other.admittedAllowedPaths.some(a=>admission.normalizedAllowedPaths.some(b=>repositoryPathsOverlap(a,b))))throw new Conflict();}
    const creation={id:c.developmentRunId,planId:plan.planId,taskId:task.id,admissionDecision:admission,requiredVerificationCommands:task.verificationCommands,protectedPaths:[]};
    const result=createDevelopmentExecutionRun(creation);if(!result.ok)throw new Conflict();const run=captureRoadmapData(result.value) as DevelopmentExecutionRun;
    await client.query(`insert into controller_development_runs(workspace_id,project_key,project_task_key,development_run_id,plan_key,plan_revision,draft_fingerprint,approved_fingerprint,run_revision,run_snapshot,run_fingerprint) values($1,$2,$3,$4,$5,$6,$7,$8,0,$9::jsonb,$10)`,[tenant.workspaceDatabaseId,c.projectId,c.taskId,run.id,plan.planId,plan.revision,plan.draftFingerprint,plan.executionFingerprint,JSON.stringify(run),controllerRunFingerprint(run)]);
    await client.query(`insert into controller_development_events(workspace_id,development_run_id,run_revision,event_json,run_snapshot,run_fingerprint) values($1,$2,0,$3::jsonb,$4::jsonb,$5)`,[tenant.workspaceDatabaseId,run.id,JSON.stringify({type:"created",creation}),JSON.stringify(run),controllerRunFingerprint(run)]);
    if(state.task.status==="approved")await transitionRoadmapTaskInTransaction(client,tenant,c,roadmapFingerprint(["controller.task-running.v1",c]),state.task,"running");
  });}
  async function durableOutcome(client:WorkflowRuntimeSqlClient,state:DevelopmentControllerState,run:DevelopmentExecutionRun){
    const intent=state.attempts.find(i=>i.developmentRunId===run.id&&i.attemptNumber===run.currentAttemptNumber);if(!intent)throw new Conflict();
    const subscriptionPolicy=exactOwnData(intent.executionPolicy,["profile","intent"]);
    if(subscriptionPolicy?.profile==="ai044_subscription"){
      const approved=normalizeSubscriptionIntent(subscriptionPolicy.intent);if(!approved)throw new Conflict();
      const factual=await readAI044SubscriptionOutcomeInTransaction(client,tenant,{projectId:state.task.projectId,projectTaskId:state.task.taskId,
        configuration:intent.configuration,invocation:intent.invocation,intentFingerprint:subscriptionIntentFingerprint(approved)});
      if(!factual)throw new Conflict();
      return Object.freeze({result:factual.normalizedResult,fingerprint:factual.resultFingerprint,intent});
    }
    const policy=intent.executionPolicy as import("./executor-controller-binding").ExecutorControllerExecutionPolicy;
    const reader=createExecutorHistoricalOutcomeReader({tenant,projectId:state.task.projectId,configuration:intent.configuration,target:policy.target,financialPolicy:policy.financialPolicy});
    const factual=await reader.inspectOutcomeInTransaction(client,intent.invocation);
    if(factual.verdict!=="allow"||!factual.normalizedResult||!factual.resultFingerprint)throw new Conflict();
    return Object.freeze({result:factual.normalizedResult,fingerprint:factual.resultFingerprint,intent});
  }
  async function transitionRun(input:unknown){return mutate(input,["developmentRunId","expectedRunRevision","event"],"transition_run",async(client,state,c)=>{
    const record=state.runs.find(r=>r.run.id===c.developmentRunId);if(!record||record.revision!==c.expectedRunRevision||!["running","verifying","approved"].includes(state.task.status))throw new Conflict();
    const event=c.event as DevelopmentExecutionEvent,run=record.run;
    if(event.type==="submit_patch"||event.type==="submit_analysis"||event.type==="implementation_failed"){
      const factual=await durableOutcome(client,state,run);let expected:DevelopmentExecutionEvent;
      if(factual.result.status==="succeeded"){
        const invocation=factual.intent.invocation as {mode:unknown};
        if(invocation.mode==="analysis_only"){
          if(!factual.result.report||factual.result.changes.length!==0)throw new Conflict();
          expected={type:"submit_analysis",reportFingerprint:factual.result.report.sha256};
        }else expected={type:"submit_patch",changedPaths:factual.result.changes.map(p=>p.path)};
      }
      else expected={type:"implementation_failed",failure:{phase:"implementation",code:"executor_failed",fingerprint:roadmapFingerprint(["pac.controller.executor-failure.v1",factual.result.failureCode]),summary:"Executor returned a definitive failure.",retryable:factual.result.status==="failed",scopeExpansionRequired:false,protectedPathViolation:false,systemForbiddenPathViolation:false}};
      if(roadmapFingerprint(event)!==roadmapFingerprint(expected))throw new Conflict();
    }else if(["verification_passed","verification_failed","review_passed","review_failed"].includes(event.type)){
      const kind=event.type.startsWith("verification_")?"quality":"security",op=state.operations.find(o=>o.developmentRunId===run.id&&o.attemptNumber===run.currentAttemptNumber&&o.kind===kind&&o.status==="recorded");
      if(!op||!op.evidence)throw new Conflict();const expected=kind==="quality"?developmentQualityEvent(op.evidence as Parameters<typeof developmentQualityEvent>[0]):developmentSecurityEvent(op.evidence as Parameters<typeof developmentSecurityEvent>[0]);
      if(roadmapFingerprint(expected)!==roadmapFingerprint(event))throw new Conflict();
    }else if(event.type==="start_attempt"){
      if(run.status==="awaiting_correction"){
        const unresolved=await client.query(`select development_run_id from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2 and state in ('start_committed','reconciliation_required')
          union all select development_run_id from ai044_subscription_approval_bindings where workspace_id=$1 and development_run_id=$2 and state in ('consumed','started','outcome_unknown') limit 1`,[tenant.workspaceDatabaseId,run.id]);if(unresolved.rowCount)throw new Conflict();
      }
    }else if(event.type!=="cancel")throw new Conflict();
    const result=transitionDevelopmentExecutionRun(run,event);if(!result.ok)throw new Conflict();const next=captureRoadmapData(result.value) as DevelopmentExecutionRun;
    const changed=await client.query(`/* controller:run-cas */ update controller_development_runs set run_revision=run_revision+1,run_snapshot=$4::jsonb,run_fingerprint=$5 where workspace_id=$1 and development_run_id=$2 and run_revision=$3 returning development_run_id`,[tenant.workspaceDatabaseId,run.id,record.revision,JSON.stringify(next),controllerRunFingerprint(next)]);if(changed.rowCount!==1)throw new Conflict();
    await client.query(`insert into controller_development_events(workspace_id,development_run_id,run_revision,event_json,run_snapshot,run_fingerprint) values($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,[tenant.workspaceDatabaseId,run.id,record.revision+1,JSON.stringify(event),JSON.stringify(next),controllerRunFingerprint(next)]);
    const all=state.runs.map(r=>r.run.id===run.id?next:r.run);
    const parent=all.some(r=>r.status==="blocked")?"blocked":all.some(r=>r.status==="awaiting_owner_decision")?"waiting_owner"
      :all.some(r=>["ready","implementing","awaiting_correction"].includes(r.status))?"running"
      :all.some(r=>["verifying","reviewing","completed"].includes(r.status))?"verifying":null;
    if(parent&&parent!==state.task.status){const changedParent=await transitionRoadmapTaskInTransaction(client,tenant,c,roadmapFingerprint(["controller.parent-projection.v1",c]),state.task,parent);if(changedParent.status!=="applied")throw new Conflict();}
    if(next.status==="blocked"||next.status==="awaiting_owner_decision"||next.status==="cancelled")await revokeControllerExecutorAuthorities(client,tenant,c.projectId,c.taskId);
  });}
  async function saveAttemptIntent(input:unknown){return mutate(input,["developmentRunId","expectedRunRevision","configuration","invocation","context","route","executionPolicy"],"attempt_intent",async(client,state,c)=>{
    const record=state.runs.find(r=>r.run.id===c.developmentRunId),run=record?.run;if(!record||!run||run.status!=="implementing"||record.revision!==c.expectedRunRevision||state.task.status!=="running")throw new Conflict();
    if(state.attempts.some(i=>i.developmentRunId===run.id&&i.attemptNumber===run.currentAttemptNumber))throw new Conflict();
    const configuration=captureRoadmapData(c.configuration),invocation=captureRoadmapData(c.invocation),context=captureRoadmapData(c.context),route=captureRoadmapData(c.route),executionPolicy=captureRoadmapData(c.executionPolicy);
    const facts=deriveExecutorAuthorityFacts(configuration),adapter=createExecutorAdapterContract(configuration).adapter,valid=adapter?.validateInvocation(invocation).normalizedInvocation;
    if(!valid||facts.developmentRunId!==run.id||facts.taskId!==run.taskId||facts.planId!==run.planId||facts.attemptNumber!==run.currentAttemptNumber)throw new Conflict();
    const config=configuration as {identity:unknown;admission:{plan:unknown};developmentRun:unknown};if(roadmapFingerprint(config.developmentRun)!==roadmapFingerprint(run)||roadmapFingerprint(config.admission.plan)!==roadmapFingerprint(state.approvedPlan!.plan))throw new Conflict();
    const r=exactOwnData(route,["decision","taskClass"]),decision=r&&exactOwnData(r.decision,["verdict","reasons","selectedRoute","ranking","rejected","routeFingerprint","requirementsFingerprint","candidateSetFingerprint","dispatchAuthorized","runtimeDispatchAllowed"]);
    const selection=decision&&exactOwnData(decision.selectedRoute,["routeId","executor","providerId","environment","accessMode"]);
    if(!r||!decision||!selection||decision.verdict!=="allow"||decision.dispatchAuthorized!==false||decision.runtimeDispatchAllowed!==false||!isRoadmapFingerprint(decision.routeFingerprint)
      ||roadmapFingerprint(selection.executor)!==roadmapFingerprint(config.identity)||!["openai","anthropic"].includes(selection.providerId as string)||r.taskClass!==deriveRoadmapTaskClass(state.task.taskType,run.currentAttemptNumber>1))throw new Conflict();
    if(valid.identity.id===subscriptionExecutorIdentity.id){
      // Narrow subscription proposal identity only; never invent a paid monetary policy or unlock dispatch.
      const policy=exactOwnData(executionPolicy,["profile","intent"]),approved=policy?.profile==="ai044_subscription"?normalizeSubscriptionIntent(policy.intent):null;
      const manifest=normalizeAI044SubscriptionContextManifest(context),environment=exactOwnData(selection.environment,["id","kind"]);
      if(!approved||!manifest||!environment||environment.kind!=="patch_proposal_only"||selection.providerId!=="openai"||selection.accessMode!=="subscription_session"
        ||valid.identity.version!==subscriptionExecutorIdentity.version||valid.capability!=="coding"||valid.mode!=="patch_proposal"
        ||approved.workspaceId!==tenant.workspaceId||approved.workspaceDatabaseId!==tenant.workspaceDatabaseId||approved.projectId!==state.task.projectId||approved.projectTaskId!==state.task.taskId
        ||approved.planId!==state.approvedPlan!.planId||approved.planRevision!==state.approvedPlan!.revision||approved.planFingerprint!==state.approvedPlan!.draftFingerprint
        ||approved.taskId!==run.taskId||approved.invocationId!==valid.invocationId||roadmapFingerprint(approved.attempt)!==roadmapFingerprint(valid.attempt)
        ||roadmapFingerprint(approved.repository)!==roadmapFingerprint(valid.repository)||approved.contextFingerprint!==manifest.fingerprint
        ||roadmapFingerprint(approved.allowedWritePaths)!==roadmapFingerprint(valid.allowedPaths)
        ||manifest.binding.projectTaskId!==approved.projectTaskId||manifest.binding.planId!==approved.planId||manifest.binding.planRevision!==approved.planRevision||manifest.binding.planFingerprint!==approved.planFingerprint
        ||manifest.binding.taskId!==approved.taskId||roadmapFingerprint(manifest.binding.attempt)!==roadmapFingerprint(approved.attempt)
        ||roadmapFingerprint(manifest.binding.repository)!==roadmapFingerprint(approved.repository)
        ||roadmapFingerprint(manifest.binding.allowedWritePaths)!==roadmapFingerprint(approved.allowedWritePaths)
        ||roadmapFingerprint(manifest.orderedPaths)!==roadmapFingerprint(approved.readContextPaths))throw new Conflict();
    }else{
      const policy=exactOwnData(executionPolicy,["target","financialPolicy","requestPolicyIdentity"]),financial=policy&&exactOwnData(policy.financialPolicy,["maximumExposureUsdMicros","totalExposureUsdMicros","reservationTtlMs"]);
      if(!policy||!financial||!isRoadmapFingerprint(policy.requestPolicyIdentity))throw new Conflict();const target=normalizeExecutorTarget(policy.target);
      if(target.providerId!==selection.providerId||![financial.maximumExposureUsdMicros,financial.totalExposureUsdMicros,financial.reservationTtlMs].every(n=>Number.isSafeInteger(n)&&(n as number)>0)||(financial.maximumExposureUsdMicros as number)>(financial.totalExposureUsdMicros as number))throw new Conflict();
    }
    const base={developmentRunId:run.id,attemptNumber:run.currentAttemptNumber,projectTaskStateVersion:state.task.version,runRevision:record.revision,configuration,invocation,context,route,executionPolicy};
    await client.query(`insert into controller_attempt_intents(workspace_id,development_run_id,attempt_number,project_task_state_version,run_revision,configuration_json,configuration_fingerprint,invocation_json,invocation_fingerprint,context_json,context_fingerprint,route_json,route_fingerprint,execution_policy_json,execution_policy_fingerprint,intent_fingerprint)
      values($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10::jsonb,$11,$12::jsonb,$13,$14::jsonb,$15,$16)`,[tenant.workspaceDatabaseId,run.id,run.currentAttemptNumber,state.task.version,record.revision,JSON.stringify(configuration),roadmapFingerprint(configuration),JSON.stringify(invocation),roadmapFingerprint(invocation),JSON.stringify(context),roadmapFingerprint(context),JSON.stringify(route),roadmapFingerprint(route),JSON.stringify(executionPolicy),roadmapFingerprint(executionPolicy),controllerAttemptIntentFingerprint(c.taskId,base)]);
  });}
  async function requestOperation(input:unknown){return mutate(input,["developmentRunId","expectedRunRevision","kind"],"operation_request",async(client,state,c)=>{
    const record=state.runs.find(r=>r.run.id===c.developmentRunId),run=record?.run;
    if(!run||!record||record.revision!==c.expectedRunRevision||!["executor","quality","security"].includes(c.kind as string)||!["running","verifying"].includes(state.task.status))throw new Conflict();
    const intent=state.attempts.find(i=>i.developmentRunId===run.id&&i.attemptNumber===run.currentAttemptNumber);if(!intent)throw new Conflict();
    if(c.kind==="executor"&&run.status!=="implementing"||c.kind==="quality"&&run.status!=="verifying"||c.kind==="security"&&run.status!=="reviewing")throw new Conflict();
    if(state.operations.some(o=>o.developmentRunId===run.id&&o.runRevision===record.revision&&o.kind===c.kind))throw new Conflict();
    const outcome=c.kind==="executor"?null:await durableOutcome(client,state,run),binding={developmentRunId:run.id,runRevision:record.revision,attemptNumber:run.currentAttemptNumber,kind:c.kind,intentFingerprint:intent.intentFingerprint,outcomeFingerprint:outcome?.fingerprint??null};
    const fp=roadmapFingerprint(["pac.controller-operation.v1",binding]),id=`operation-${fp.slice(0,32)}`;
    await client.query(`insert into controller_operations(workspace_id,project_key,project_task_key,operation_id,development_run_id,run_revision,attempt_number,kind,status,intent_fingerprint,outcome_fingerprint) values($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)`,[tenant.workspaceDatabaseId,c.projectId,c.taskId,id,run.id,record.revision,run.currentAttemptNumber,c.kind,fp,outcome?.fingerprint??null]);
  });}
  async function recordOperationEvidence(input:unknown){return mutate(input,["operationId","evidence"],"operation_evidence",async(client,state,c)=>{
    const operation=state.operations.find(o=>o.operationId===c.operationId&&o.status==="pending"),record=operation&&state.runs.find(r=>r.run.id===operation.developmentRunId);if(!operation||!record||record.revision!==operation.runRevision||record.run.currentAttemptNumber!==operation.attemptNumber)throw new Conflict();
    const factual=await durableOutcome(client,state,record.run);let evidence:unknown;
    const binding={runId:record.run.id,attemptNumber:record.run.currentAttemptNumber,outcomeFingerprint:factual.fingerprint,operationId:operation.operationId};
    if(operation.kind==="quality")evidence=normalizeDevelopmentQualityEvidence(c.evidence,{...binding,requiredCommands:record.run.requiredVerificationCommands});
    else if(operation.kind==="security")evidence=normalizeDevelopmentSecurityEvidence(c.evidence,{...binding,producerExecutorId:factual.result.identity.id});
    else evidence={...binding,phase:"executor",outcome:factual.result.status};
    if(!evidence||operation.kind!=="executor"&&operation.outcomeFingerprint!==factual.fingerprint)throw new Conflict();
    const q=await client.query(`update controller_operations set status='recorded',evidence_json=$3::jsonb,evidence_fingerprint=$4 where workspace_id=$1 and operation_id=$2 and status='pending' returning operation_id`,[tenant.workspaceDatabaseId,operation.operationId,JSON.stringify(evidence),roadmapFingerprint(evidence)]);if(q.rowCount!==1)throw new Conflict();
  });}
  async function completeProjectTask(input:unknown){return mutate(input,["resultApprovalRequestId"],"complete_project_task",async(client,state,c)=>{
    if(!state.approvedPlan||state.task.status!=="waiting_owner"||typeof c.resultApprovalRequestId!=="string"||state.runs.length!==state.approvedPlan.plan.tasks.length||state.runs.some(r=>r.run.status!=="completed"))throw new Conflict();
    for(const record of state.runs){await durableOutcome(client,state,record.run);for(const kind of ["quality","security"]){const evidence=state.operations.find(o=>o.developmentRunId===record.run.id&&o.attemptNumber===record.run.currentAttemptNumber&&o.kind===kind&&o.status==="recorded")?.evidence as {outcome?:unknown}|null;if(evidence?.outcome!=="pass")throw new Conflict();}}
    const held=await client.query(`select e.development_run_id from executor_attempt_exposures e join controller_development_runs r on r.workspace_id=e.workspace_id and r.development_run_id=e.development_run_id where r.workspace_id=$1 and r.project_task_key=$2 and e.state not in ('settled','cancelled')
      union all select s.development_run_id from ai044_subscription_approval_bindings s join controller_development_runs r on r.workspace_id=s.workspace_id and r.development_run_id=s.development_run_id where r.workspace_id=$1 and r.project_task_key=$2 and s.state in ('consumed','started','outcome_unknown') limit 1`,[tenant.workspaceDatabaseId,c.taskId]);if(held.rowCount)throw new Conflict();
    const approval=await client.query(`select b.state_fingerprint from controller_owner_gate_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id join approval_decisions d on d.workspace_id=r.workspace_id and d.approval_request_id=r.id where b.workspace_id=$1 and b.project_key=$2 and b.task_key=$3 and b.approval_request_id=$4 and b.purpose='result_acceptance' and b.expected_task_version=$5 and r.status='approved' and d.decision='approved' and r.approved_by::text=d.decided_by_actor_id and r.resolved_at is not null`,[tenant.workspaceDatabaseId,c.projectId,c.taskId,c.resultApprovalRequestId,state.task.version]);if(approval.rowCount!==1||approval.rows[0].state_fingerprint!==controllerResultAcceptanceFingerprint(state))throw new Conflict();
    const q=await client.query(`update project_tasks set status='completed',completed_at=clock_timestamp(),state_version=state_version+1 where workspace_id=$1 and project_key=$2 and task_key=$3 and state_version=$4 returning task_key`,[tenant.workspaceDatabaseId,c.projectId,c.taskId,state.task.version]);if(q.rowCount!==1)throw new Conflict();await journalRoadmapTask(client,tenant,c,roadmapFingerprint(["controller.complete.v1",c]),state.task,"completed","state_changed");
  });}
  return Object.freeze({read,readRevision,replay,claimReady,changeTaskState,consumePlanApproval,createRun,transitionRun,saveAttemptIntent,requestOperation,recordOperationEvidence,completeProjectTask});
}
