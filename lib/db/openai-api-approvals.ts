import { randomUUID } from "node:crypto";
import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
import type { ExecutorAdapterConfiguration } from "../contracts/executor-adapter";
import type { OpenAIApiIntent } from "../executors/openai-api-intent";
import type { AuthenticatedIdentitySource } from "../composition/authenticated-owner-read-runtime";
import type { ExecutorControllerBinding } from "./executor-controller-binding";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, inTransaction } from "./executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockOwnerAuthority, resolveUserId, Conflict } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockRoadmapProject, readRoadmapTaskInTransaction } from "./roadmap-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { readLatestRoadmapPlan } from "./roadmap-approvals.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { deriveExecutorAuthorityFacts } from "../executors/executor-current-authority.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockExecutorWorkspaceProject, lockExecutorAuthority, executorAuthorityMatches } from "./executor-current-authority-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockExecutorControllerBinding, normalizeExecutorControllerBinding } from "./executor-controller-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorPredecessorsClear } from "./executor-predecessor-barrier.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeOpenAIApiIntent, openAIApiIntentPayload, openAIApiIntentFingerprint, openAIApiIntentCurrent } from "../executors/openai-api-intent.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureAI044Data, ai044Fingerprint, freezeAI044 } from "../executors/ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { canonicalResultPayload, subscriptionResultFingerprint, validateCanonicalResult } from "./ai044-subscription-approvals.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { readOpenAIApiOutcome } from "../executors/openai-api-patch-executor.ts";

const fact=(v:unknown):void=>{if(!v)throw new Conflict();};
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v);
const approvals=new WeakMap<object,{owner:object;id:string;intent:OpenAIApiIntent;used:boolean;executorClaimed:boolean}>();
const starts=new WeakMap<object,{intent:OpenAIApiIntent;used:boolean}>();
export function consumeOpenAIApiApprovalForExecutor(raw:unknown):OpenAIApiIntent|null {
  const e=raw&&typeof raw==="object"?approvals.get(raw):null;if(!e||e.used||e.executorClaimed)return null;e.executorClaimed=true;return e.intent;
}
export function consumeOpenAIApiStartCapability(raw:unknown):OpenAIApiIntent|null {
  const e=raw&&typeof raw==="object"?starts.get(raw):null;if(!e||e.used)return null;e.used=true;return e.intent;
}
const deny=()=>Object.freeze({verdict:"deny" as const,status:"recovery_required" as const,approvalRequestId:null,capability:null});
const allow=(status:string,id:string,capability:object|null=null)=>Object.freeze({verdict:"allow" as const,status,approvalRequestId:id,capability});
type Decision=ReturnType<typeof deny>|ReturnType<typeof allow>;
export function createOpenAIApiApprovals(input:Readonly<{database:WorkflowRuntimeDatabase;tenant:ResolvedWorkflowRuntimeTenant;projectId:string;projectTaskId:string;
  configuration:ExecutorAdapterConfiguration;identitySource:AuthenticatedIdentitySource;controllerBinding:ExecutorControllerBinding}>) {
  const {database,tenant,projectId,projectTaskId}=input, configuration=freezeAI044(captureAI044Data(input.configuration)) as ExecutorAdapterConfiguration;
  const binding=normalizeExecutorControllerBinding(input.controllerBinding), facts=deriveExecutorAuthorityFacts(configuration), owner=Object.freeze({});
  if(!isResolvedWorkflowRuntimeTenant(tenant)||configuration.identity.id!=="openai-api-patch"||binding.projectTaskId!==projectTaskId)throw Error("invalid_api_approvals");
  let uncertain=false;
  const bound=(i:OpenAIApiIntent)=>i.workspaceId===tenant.workspaceId&&i.workspaceDatabaseId===tenant.workspaceDatabaseId&&i.projectId===projectId&&i.projectTaskId===projectTaskId
    &&i.planId===facts.planId&&i.taskId===facts.taskId&&i.attempt.developmentRunId===facts.developmentRunId&&i.attempt.number===facts.attemptNumber
    &&ai044Fingerprint(i.repository)===ai044Fingerprint(configuration.repository)&&ai044Fingerprint(i.allowedWritePaths)===ai044Fingerprint([...configuration.developmentRun.admittedAllowedPaths].sort());
  async function clock(client:WorkflowRuntimeSqlClient) {
    const q=await client.query(`/* api:clock */ select floor(extract(epoch from clock_timestamp())*1000)::text as now_ms,(clock_timestamp() at time zone 'UTC')::date::text as day`);
    const n=Number(q.rows[0]?.now_ms);fact(q.rowCount===1&&Number.isSafeInteger(n));return {now:n,day:q.rows[0].day as string};
  }
  async function active(client:WorkflowRuntimeSqlClient,actor:string,i:OpenAIApiIntent) {
    fact(bound(i));await lockOwnerAuthority(client,tenant,actor);fact(await lockExecutorWorkspaceProject(client,tenant,projectId,true));await lockRoadmapProject(client,tenant,projectId);
    const task=await readRoadmapTaskInTransaction(client,tenant,projectId,projectTaskId,true),plan=await readLatestRoadmapPlan(client,tenant,projectId,projectTaskId);
    fact(task?.status==="running"&&plan&&plan.planId===i.planId&&plan.revision===i.planRevision&&plan.draftFingerprint===i.planFingerprint&&ai044Fingerprint(plan.plan)===ai044Fingerprint(configuration.admission.plan));
    fact(await lockExecutorControllerBinding(client,tenant,projectId,facts,configuration,binding));
    const saved=await client.query(`/* api:exact-controller-policy */ select execution_policy_json from controller_attempt_intents where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 for share`,
      [tenant.workspaceDatabaseId,i.attempt.developmentRunId,i.attempt.number]);
    fact(saved.rowCount===1);
    const policy=exactOwnData(captureAI044Data(saved.rows[0].execution_policy_json),["profile","intent"]);
    const approvedIntent=policy?.profile==="ai044_openai_api"?normalizeOpenAIApiIntent(policy.intent):null;
    fact(approvedIntent&&openAIApiIntentFingerprint(approvedIntent)===openAIApiIntentFingerprint(i));
    const authority=await lockExecutorAuthority(client,tenant.workspaceDatabaseId,i.attempt.developmentRunId);
    fact(authority&&authority.status==="active"&&executorAuthorityMatches(authority,projectId,facts));
    await client.query(`/* api:existing-budget-serialization */ select workspace_id from executor_exposure_budgets where workspace_id=$1 for update`,[tenant.workspaceDatabaseId]);
    fact(await executorPredecessorsClear(client,tenant.workspaceDatabaseId,i.attempt.developmentRunId,i.attempt.number));
    fact(openAIApiIntentCurrent(i,(await clock(client)).now));return authority!;
  }
  async function audit(client:WorkflowRuntimeSqlClient,actor:string,id:string,event:string,i:OpenAIApiIntent,resultFingerprint?:string|null) {
    await client.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,$3,'approval_request',$4,$5::jsonb)`,
      [tenant.workspaceDatabaseId,actor,`ai044.api_${event}`,id,JSON.stringify({projectId,projectTaskId,intentFingerprint:openAIApiIntentFingerprint(i),...(resultFingerprint?{resultFingerprint}:{})})]);
  }
  async function execute(work:(c:WorkflowRuntimeSqlClient,actor:string)=>Promise<Decision>):Promise<Decision> {
    if(uncertain)return deny();
    const actor=await resolveUserId(input.identitySource.resolve);if(!actor)return deny();
    try{return await inTransaction(database,c=>work(c,actor));}catch(e){if(!(e instanceof Conflict))uncertain=true;return deny();}
  }
  async function row(client:WorkflowRuntimeSqlClient,id:string,i:OpenAIApiIntent) {
    const q=await client.query(`/* api:approval-lock */ select b.*,b.budget_day::text as budget_day_text,r.status as approval_status,r.action_type,r.approved_by::text,r.rejected_by::text,r.resolved_at as approval_resolved,
      d.id::text as actual_decision_id,d.decision,d.decided_by_actor_id from ai044_api_approval_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
      left join approval_decisions d on d.workspace_id=r.workspace_id and d.approval_request_id=r.id where b.workspace_id=$1 and b.approval_request_id=$2 for update of b,r`,[tenant.workspaceDatabaseId,id]);
    fact(q.rowCount===1);const b=q.rows[0];fact(b.intent_payload===openAIApiIntentPayload(i)&&b.intent_fingerprint===openAIApiIntentFingerprint(i)&&b.action_type==="ai044_openai_api_executor");return b;
  }
  const approved=(b:Record<string,unknown>,actor:string)=>b.approval_status==="approved"&&b.decision==="approved"&&uuid(b.actual_decision_id)
    &&b.approved_by===actor&&b.decided_by_actor_id===actor&&b.rejected_by===null&&b.approval_resolved!==null;
  async function request(raw:unknown) {
    const i=normalizeOpenAIApiIntent(raw);if(!i||!bound(i))return deny();
    return execute(async(c,actor)=>{
      await active(c,actor,i);
      const old=await c.query(`select approval_request_id::text from ai044_api_approval_bindings where workspace_id=$1 and intent_fingerprint=$2`,[tenant.workspaceDatabaseId,openAIApiIntentFingerprint(i)]);
      if(old.rowCount===1)return allow("idempotent",old.rows[0].approval_request_id as string);fact(old.rowCount===0);
      const id=randomUUID();
      await c.query(`insert into approval_requests(id,workspace_id,action_type,status,risk_level,allowed_approver_role_codes,original_payload) values($1,$2,'ai044_openai_api_executor','pending','high',array['owner'],$3::jsonb)`,[id,tenant.workspaceDatabaseId,JSON.stringify({projectId,projectTaskId,intentFingerprint:openAIApiIntentFingerprint(i)})]);
      await c.query(`insert into ai044_api_approval_bindings(workspace_id,approval_request_id,project_key,project_task_key,plan_key,plan_revision,development_run_id,attempt_number,intent_payload,intent_fingerprint,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11::double precision/1000))`,[tenant.workspaceDatabaseId,id,projectId,projectTaskId,i.planId,i.planRevision,i.attempt.developmentRunId,i.attempt.number,openAIApiIntentPayload(i),openAIApiIntentFingerprint(i),i.expiresAt]);
      await audit(c,actor,id,"approval_requested",i);return allow("requested",id);
    });
  }
  async function decide(id:unknown,raw:unknown,decision:unknown) {
    const i=normalizeOpenAIApiIntent(raw);if(!uuid(id)||!i||!bound(i)||!["approved","rejected"].includes(decision as string))return deny();
    return execute(async(c,actor)=>{
      await active(c,actor,i);const b=await row(c,id,i);fact(b.state==="ready");
      if(b.approval_status===decision)return allow("idempotent",id);fact(b.approval_status==="pending");
      await c.query(`insert into approval_decisions(workspace_id,approval_request_id,decision,decided_by_actor_id,command_id) values($1,$2,$3,$4,$5)`,[tenant.workspaceDatabaseId,id,decision,actor,`api-${randomUUID()}`.slice(0,40)]);
      await c.query(`update approval_requests set status=$3,resolved_at=clock_timestamp(),approved_by=case when $3='approved' then $4::uuid else null end,rejected_by=case when $3='rejected' then $4::uuid else null end where workspace_id=$1 and id=$2`,[tenant.workspaceDatabaseId,id,decision,actor]);
      await c.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,'ai044.api_approval_decided','approval_request',$3,$4::jsonb)`,[tenant.workspaceDatabaseId,actor,id,JSON.stringify({projectId,projectTaskId,decision,intentFingerprint:openAIApiIntentFingerprint(i)})]);
      return allow(decision as string,id);
    });
  }
  async function daily(c:WorkflowRuntimeSqlClient,day:string,limit:number) {
    await c.query(`insert into openai_api_daily_budgets(workspace_id,budget_day,limit_usd_micros) values($1,$2::date,$3) on conflict(workspace_id,budget_day) do nothing`,[tenant.workspaceDatabaseId,day,limit]);
    await c.query(`select workspace_id from openai_api_daily_budgets where workspace_id=$1 and budget_day=$2::date for update`,[tenant.workspaceDatabaseId,day]);
    const used=await c.query(`select coalesce(sum(case when state in ('completed','failed') then actual_cost_usd_micros else reserved_cost_usd_micros end),0)::text as used
      from ai044_api_approval_bindings where workspace_id=$1 and budget_day=$2::date`,[tenant.workspaceDatabaseId,day]);
    const n=Number(used.rows[0].used);fact(Number.isSafeInteger(n)&&n>=0);return n;
  }
  async function consume(id:unknown,raw:unknown) {
    const i=normalizeOpenAIApiIntent(raw);if(!uuid(id)||!i||!bound(i))return deny();
    const result=await execute(async(c,actor)=>{
      const a=await active(c,actor,i),b=await row(c,id,i);fact(approved(b,actor)&&b.state==="ready");
      const {day}=await clock(c),used=await daily(c,day,i.limits.dailyBudgetUsdMicros);fact(used+i.maximumCostUsdMicros<=i.limits.dailyBudgetUsdMicros);
      await c.query(`update openai_api_daily_budgets set limit_usd_micros=$3 where workspace_id=$1 and budget_day=$2::date`,[tenant.workspaceDatabaseId,day,i.limits.dailyBudgetUsdMicros]);
      await c.query(`update ai044_api_approval_bindings set state='consumed',consumed_at=clock_timestamp(),decision_id=$3,owner_actor_id=$4,authority_generation=$5,canonical_run_fingerprint=$6,admission_fingerprint=$7,
        budget_day=$8::date,reserved_cost_usd_micros=$9 where workspace_id=$1 and approval_request_id=$2 and state='ready'`,[tenant.workspaceDatabaseId,id,b.actual_decision_id,actor,a.generation,a.canonicalRunFingerprint,a.admissionFingerprint,day,i.maximumCostUsdMicros]);
      await audit(c,actor,id,"consumed",i);return allow("consumed",id);
    });
    if(result.verdict!=="allow")return result;const cap=Object.freeze({kind:"openai_api_approval"});approvals.set(cap,{owner,id,intent:i,used:false,executorClaimed:false});return allow("consumed",id,cap);
  }
  async function fence(raw:unknown) {
    const e=raw&&typeof raw==="object"?approvals.get(raw):null;if(!e||e.owner!==owner||e.used||!e.executorClaimed)return deny();e.used=true;
    const result=await execute(async(c,actor)=>{
      const a=await active(c,actor,e.intent),b=await row(c,e.id,e.intent);fact(approved(b,actor)&&b.state==="consumed"&&b.authority_generation===a.generation&&b.canonical_run_fingerprint===a.canonicalRunFingerprint&&b.admission_fingerprint===a.admissionFingerprint);
      const day=b.budget_day_text as string;
      fact(day===(await clock(c)).day); // A midnight crossing needs recovery, never a free new-day dispatch.
      const used=await daily(c,day,e.intent.limits.dailyBudgetUsdMicros);
      fact(used<=e.intent.limits.dailyBudgetUsdMicros);
      await c.query(`update ai044_api_approval_bindings set state='started',started_at=clock_timestamp() where workspace_id=$1 and approval_request_id=$2 and state='consumed'`,[tenant.workspaceDatabaseId,e.id]);
      await audit(c,actor,e.id,"started",e.intent);return allow("started",e.id);
    });
    if(result.verdict!=="allow")return result;const cap=Object.freeze({kind:"openai_api_start"});starts.set(cap,{intent:e.intent,used:false});return allow("started",e.id,cap);
  }
  async function recordOutcome(id:unknown,raw:unknown) {
    const e=readOpenAIApiOutcome(raw);if(!uuid(id)||!e||!bound(e.intent))return deny();const i=e.intent;
    const invocation={schemaVersion:1,identity:i.executor,invocationId:i.invocationId,planId:i.planId,taskId:i.taskId,repository:i.repository,capability:"coding",mode:"patch_proposal",attempt:i.attempt};
    const valid=e.normalizedResult&&validateCanonicalResult(configuration,invocation,e.normalizedResult);
    if(e.state!=="outcome_unknown"&&!valid)return deny();
    const fp=valid?subscriptionResultFingerprint(valid):null;
    return execute(async(c,actor)=>{
      // Historical settlement is permitted after cancellation/authority advance; no active-start check.
      await lockOwnerAuthority(c,tenant,actor);fact(await lockExecutorWorkspaceProject(c,tenant,projectId,false));await lockRoadmapProject(c,tenant,projectId);
      await lockExecutorAuthority(c,tenant.workspaceDatabaseId,i.attempt.developmentRunId);
      await c.query(`select workspace_id from executor_exposure_budgets where workspace_id=$1 for update`,[tenant.workspaceDatabaseId]);
      const b=await row(c,id,i);fact(approved(b,actor));
      if(b.state===e.state&&b.result_fingerprint===fp&&String(b.actual_cost_usd_micros)===String(e.costUsdMicros)
        &&String(b.actual_input_tokens)===String(e.inputTokens)&&String(b.actual_output_tokens)===String(e.outputTokens))return allow("idempotent",id);
      fact(e.started?b.state==="started":b.state==="consumed"&&e.state==="failed"&&e.costUsdMicros===0);
      await daily(c,b.budget_day_text as string,i.limits.dailyBudgetUsdMicros);
      await c.query(`update ai044_api_approval_bindings set state=$3,resolved_at=clock_timestamp(),normalized_result_payload=$4,result_fingerprint=$5,actual_input_tokens=$6,actual_output_tokens=$7,actual_cost_usd_micros=$8
        where workspace_id=$1 and approval_request_id=$2`,[tenant.workspaceDatabaseId,id,e.state,valid?canonicalResultPayload(valid):null,fp,e.inputTokens,e.outputTokens,e.costUsdMicros]);
      await audit(c,actor,id,e.state,i,fp);return allow(e.state,id);
    });
  }
  return Object.freeze({request,decide,consume,fence,recordOutcome});
}

export async function readOpenAIApiHistoricalOutcome(client:WorkflowRuntimeSqlClient,tenant:ResolvedWorkflowRuntimeTenant,input:{projectId:string;projectTaskId:string;configuration:unknown;invocation:unknown;intentFingerprint:string}) {
  if(!isResolvedWorkflowRuntimeTenant(tenant))return null;
  try {
    const q=await client.query(`select b.*,exists(select 1 from audit_events a where a.workspace_id=b.workspace_id and a.entity_id=b.approval_request_id and a.event_type='ai044.api_'||b.state
      and a.metadata->>'intentFingerprint'=b.intent_fingerprint and a.metadata->>'resultFingerprint'=b.result_fingerprint) as audited
      from ai044_api_approval_bindings b where b.workspace_id=$1 and b.project_key=$2 and b.project_task_key=$3 and b.intent_fingerprint=$4 and b.state in ('completed','failed')`,[tenant.workspaceDatabaseId,input.projectId,input.projectTaskId,input.intentFingerprint]);
    if(q.rowCount!==1||q.rows[0].audited!==true)return null;const b=q.rows[0];
    const i=normalizeOpenAIApiIntent(JSON.parse(b.intent_payload as string));if(!i||openAIApiIntentFingerprint(i)!==input.intentFingerprint)return null;
    const result=validateCanonicalResult(input.configuration,input.invocation,JSON.parse(b.normalized_result_payload as string));
    if(!result||canonicalResultPayload(result)!==b.normalized_result_payload||subscriptionResultFingerprint(result)!==b.result_fingerprint)return null;
    return freezeAI044({normalizedResult:result,resultFingerprint:b.result_fingerprint as string});
  } catch{return null;}
}
