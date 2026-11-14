import { randomUUID } from "node:crypto";
import type { ExecutorAdapterConfiguration, ExecutorInvocationInput } from "../contracts/executor-adapter";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
import type { AuthenticatedIdentitySource } from "./authenticated-owner-read-runtime";
import type { OwnerAI044ProofPolicy } from "./owner-ai044-proof";
import type { OpenAIApiCredentialStore } from "../integrations/openai-api/openai-api-credential-store";
import type { OpenAIApiPrice } from "../integrations/openai-api/openai-api-policy";
import type { AI044ExactObjectPort } from "../executors/ai044-subscription-context";
import type { OwnerOpenAIApiProofView } from "../../types/openai-api-proof";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeOwnerAI044ProofPolicy, ownerCheckedDatabase } from "./owner-ai044-proof.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData,inTransaction } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { resolveSessionOwner } from "../integrations/chatgpt/chatgpt-owner-authority.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockOwnerAuthority } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createDevelopmentControllerStore,readDevelopmentControllerStateInTransaction } from "../db/development-controller-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresExecutorCurrentAuthorityStore } from "../db/executor-current-authority-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { controllerAdmission,controllerInvocationId,controllerTaskClass } from "../roadmap/development-controller-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createAI044SubscriptionContextSource,ai044SubscriptionContextManifest } from "../executors/ai044-subscription-context.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { prepareOpenAIApiRequest,createOpenAIApiPatchExecutor } from "../executors/openai-api-patch-executor.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeOpenAIApiIntent,openAIApiExecutorIdentity,openAIApiIntentFingerprint,openAIApiIntentCurrent } from "../executors/openai-api-intent.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { openAIApiMaximumCost } from "../integrations/openai-api/openai-api-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044Fingerprint,captureAI044Data,freezeAI044 } from "../executors/ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createOpenAIApiApprovals,readOpenAIApiHistoricalOutcome } from "../db/openai-api-approvals.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorRouter } from "../executors/executor-router.ts";

function fact(v:unknown):asserts v {if(!v)throw Error("api_proof_unavailable");}
const unavailable=():OwnerOpenAIApiProofView=>Object.freeze({status:"unavailable"});
export type OwnerOpenAIApiProofDependencies=Readonly<{
  database:WorkflowRuntimeDatabase;domainWorkspaceId:string;identitySource:AuthenticatedIdentitySource;policy:OwnerAI044ProofPolicy;
  credentials:OpenAIApiCredentialStore;pricing(model:string,now:number):Promise<OpenAIApiPrice|null>;
  contextSource:AI044ExactObjectPort;transport:typeof fetch;clock():number;
}>;
export function ownerOpenAIApiProofInput(form:unknown) {
  try {
    if(!(form instanceof FormData)||Object.getPrototypeOf(form)!==FormData.prototype)return null;
    const values=new Map<string,string>();let count=0;
    for(const [k,v] of form){if(++count>32||k.length>256)return null;if(k.startsWith("$ACTION_"))continue;
      if(!["mode","action","selection"].includes(k)||values.has(k)||typeof v!=="string"||v.length>128)return null;values.set(k,v);}
    if(values.size!==3||values.get("mode")!=="openai_api"||!/^[a-f0-9]{64}$/u.test(values.get("selection")??"")||!["prepare","request","approve","reject","invoke"].includes(values.get("action")??""))return null;
    return {mode:"openai_api",action:values.get("action"),selection:values.get("selection")};
  } catch{return null;}
}
/** Same controller, authority, exact-object context, contract and patch validator as subscription.
 * Only the access/profile and USD-cost reservation differ. No fallback, loop or global switch. */
export function createOwnerOpenAIApiProof(d:OwnerOpenAIApiProofDependencies) {
  const p=normalizeOwnerAI044ProofPolicy(d.policy),source=createAI044SubscriptionContextSource(d.contextSource);
  async function snapshot() {
    const o=await resolveSessionOwner(d.database,d.domainWorkspaceId,d.identitySource);fact(o.status==="owner");
    const tenant=await createPostgresWorkflowRuntimeTenantResolver(d.database).resolve(d.domainWorkspaceId);fact(tenant);
    const state=await inTransaction(d.database,async c=>{await lockOwnerAuthority(c,tenant,o.ownerUserId);
      await c.query(`select project_key from roadmap_project_guards where workspace_id=$1 and project_key=$2 for share`,[tenant.workspaceDatabaseId,p.projectId]);
      return readDevelopmentControllerStateInTransaction(c,tenant,p.projectId,p.projectTaskId,true,undefined,undefined,false);});
    fact(state.approvedPlan&&state.approvedPlan.revision===p.planRevision&&state.approvedPlan.draftFingerprint===p.planFingerprint);
    const record=state.runs.find(r=>r.run.id===p.developmentRunId);fact(record);
    const stored=state.attempts.find(a=>a.developmentRunId===record.run.id&&a.attemptNumber===record.run.currentAttemptNumber);
    let configuration:ExecutorAdapterConfiguration;
    if(stored)configuration=captureAI044Data(stored.configuration) as ExecutorAdapterConfiguration;
    else {
      const previous=state.attempts.find(a=>a.developmentRunId===record.run.id);
      const admission=previous?(previous.configuration as ExecutorAdapterConfiguration).admission:controllerAdmission(state,record.run.taskId,p.repositoryAllowlist);fact(admission);
      fact(Array.isArray(admission.activeTaskIds));
      configuration={identity:openAIApiExecutorIdentity,capabilities:{tasks:["coding"],modes:["patch_proposal"],artifacts:["patch","report"]},repository:p.repository,
        admission:{...admission,activeTaskIds:admission.activeTaskIds.filter(t=>t!==record.run.taskId)},developmentRun:record.run};
    }
    fact(configuration.identity.id==="openai-api-patch"&&configuration.identity.version==="v1"&&ai044Fingerprint(configuration.repository)===ai044Fingerprint(p.repository)
      &&ai044Fingerprint(configuration.admission.plan)===ai044Fingerprint(state.approvedPlan.plan));
    if(record.run.status==="implementing")fact(ai044Fingerprint(configuration.developmentRun)===ai044Fingerprint(record.run));
    const policy=stored&&exactOwnData(stored.executionPolicy,["profile","intent"]),intent=policy&&policy.profile==="ai044_openai_api"?normalizeOpenAIApiIntent(policy.intent):null;
    if(stored)fact(intent&&intent.projectTaskId===p.projectTaskId&&intent.projectId===p.projectId&&intent.attempt.developmentRunId===record.run.id&&intent.attempt.number===record.run.currentAttemptNumber
      &&intent.planId===record.run.planId&&intent.taskId===record.run.taskId&&intent.planRevision===p.planRevision&&intent.planFingerprint===p.planFingerprint
      &&ai044Fingerprint(intent.readContextPaths)===ai044Fingerprint(p.readContextPaths)&&ai044Fingerprint(intent.allowedWritePaths)===ai044Fingerprint([...record.run.admittedAllowedPaths].sort()));
    const actor={ownerUserId:o.ownerUserId,domainWorkspaceId:tenant.workspaceId};
    const credentials=await d.credentials.facts(actor);fact(credentials);
    const pricing=await d.pricing(credentials.limits.model,d.clock());
    const maximum=openAIApiMaximumCost(credentials.limits,pricing,credentials.limits.maxInputTokens,d.clock());
    // Historical results stay readable if pricing expired; a fresh preparation/invoke cannot.
    if(!stored)fact(pricing&&maximum);
    const selection=ai044Fingerprint(["pac.api-proof.selection.v1",actor,p,record,stored?.intentFingerprint??null,credentials]);
    return {tenant,state,record,stored,configuration,intent,actor,credentials,pricing,maximum,selection};
  }
  type Snapshot=Awaited<ReturnType<typeof snapshot>>;
  function invocation(s:Snapshot):ExecutorInvocationInput {
    const r=s.record.run,a=r.attempts.find(a=>a.number===r.currentAttemptNumber)!;
    return {schemaVersion:1,invocationId:controllerInvocationId(r.id,r.currentAttemptNumber),identity:openAIApiExecutorIdentity,planId:r.planId,taskId:r.taskId,repository:p.repository,
      capability:"coding",mode:"patch_proposal",attempt:{developmentRunId:r.id,number:r.currentAttemptNumber,kind:a.kind}};
  }
  async function context(s:Snapshot) {
    const i=invocation(s),prepared=await source.prepare({repository:p.repository,projectTaskId:p.projectTaskId,planId:i.planId,planRevision:p.planRevision,planFingerprint:p.planFingerprint,
      taskId:i.taskId,attempt:i.attempt,allowedWritePaths:s.record.run.admittedAllowedPaths,readContextPaths:p.readContextPaths},p.readContextPaths);fact(prepared.context);return prepared.context;
  }
  function approvals(s:Snapshot) {fact(s.stored);return createOpenAIApiApprovals({database:d.database,tenant:s.tenant,projectId:p.projectId,projectTaskId:p.projectTaskId,
    configuration:s.configuration,identitySource:d.identitySource,controllerBinding:{projectTaskId:p.projectTaskId,intentFingerprint:s.stored.intentFingerprint}});}
  async function view(s:Snapshot):Promise<OwnerOpenAIApiProofView> {
    return inTransaction(d.database,async c=>{
      await lockOwnerAuthority(c,s.tenant,s.actor.ownerUserId);
      const q=s.intent?await c.query(`select b.approval_request_id::text,b.state,r.status from ai044_api_approval_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
        where b.workspace_id=$1 and b.project_key=$2 and b.project_task_key=$3 and b.intent_fingerprint=$4`,[s.tenant.workspaceDatabaseId,p.projectId,p.projectTaskId,openAIApiIntentFingerprint(s.intent)]):null;
      fact(!q||q.rowCount<=1);const b=q?.rows[0];
      let phase:Extract<OwnerOpenAIApiProofView,{status:"available"}>["phase"]=s.intent?"PREPARED":"NOT_PREPARED";
      if(b)phase=b.state==="completed"?"COMPLETED":b.state==="failed"?"FAILED":b.state==="ready"?(b.status==="approved"?"APPROVED":b.status==="rejected"?"REJECTED":"AWAITING_OWNER_APPROVAL"):"RECOVERY_REQUIRED";
      if(s.intent&&!["COMPLETED","FAILED","REJECTED"].includes(phase)&&(!openAIApiIntentCurrent(s.intent,d.clock())||s.intent.credentialGeneration!==s.credentials.generation||ai044Fingerprint(s.intent.pricing)!==ai044Fingerprint(s.pricing)))phase="RECOVERY_REQUIRED";
      const budget=await c.query(`select coalesce(sum(case when state in ('completed','failed') then actual_cost_usd_micros else reserved_cost_usd_micros end),0)::text as used
        from ai044_api_approval_bindings where workspace_id=$1 and budget_day=(clock_timestamp() at time zone 'UTC')::date`,[s.tenant.workspaceDatabaseId]);
      const remaining=Math.max(0,s.credentials.limits.dailyBudgetUsdMicros-Number(budget.rows[0].used));
      const historical=b&&["completed","failed"].includes(b.state as string)?await readOpenAIApiHistoricalOutcome(c,s.tenant,{projectId:p.projectId,projectTaskId:p.projectTaskId,configuration:s.configuration,invocation:invocation(s),intentFingerprint:openAIApiIntentFingerprint(s.intent!)}):null;
      if(b&&["completed","failed"].includes(b.state as string))fact(historical);
      return freezeAI044({status:"available",mode:"openai_api",phase,selection:s.selection,projectId:p.projectId,projectTaskId:p.projectTaskId,developmentTaskId:s.record.run.taskId,
        attemptNumber:s.record.run.currentAttemptNumber,planRevision:p.planRevision,baseline:p.repository.baseline,repositoryId:p.repository.id,model:s.intent?.model??s.credentials.limits.model,registration:null,
        readContextPaths:p.readContextPaths,allowedWritePaths:s.record.run.admittedAllowedPaths,expiresAt:s.intent?.expiresAt??null,intentFingerprint:s.intent?openAIApiIntentFingerprint(s.intent):null,
        approvalRequestId:b?.approval_request_id as string??null,maximumCostUsdMicros:s.intent?.maximumCostUsdMicros??s.maximum!.maximumCostUsdMicros,remainingDailyBudgetUsdMicros:remaining,
        result:historical?{status:historical.normalizedResult.status,changedPaths:historical.normalizedResult.changes.map(c=>c.path),fingerprint:historical.resultFingerprint,ownerDecisionRequired:true,verificationStatus:"not_run",automaticRetryAllowed:false}:null,
        runtimeDispatchAllowed:false,productionLiveDispatch:"BLOCKED"});
    });
  }
  async function act(raw:unknown):Promise<OwnerOpenAIApiProofView> {
    try {
      const r=exactOwnData(raw,["mode","action","selection"]);fact(r&&r.mode==="openai_api"&&["prepare","request","approve","reject","invoke"].includes(r.action as string));
      const s=await snapshot();fact(r.selection===s.selection);const before=await view(s);fact(before.status==="available");
      fact(s.state.task.status==="running"&&s.record.run.status==="implementing");
      if(r.action==="prepare") {
        fact(!s.stored&&s.pricing&&s.maximum);const ctx=await context(s),inv=invocation(s),request=prepareOpenAIApiRequest(s.configuration,inv,ctx,s.credentials.limits.model,s.credentials.limits.maxOutputTokens);
        fact(request&&Buffer.byteLength(JSON.stringify(request.body))<=s.credentials.limits.maxContextBytes);
        const now=d.clock(),intent=normalizeOpenAIApiIntent({schemaVersion:1,workspaceId:s.tenant.workspaceId,workspaceDatabaseId:s.tenant.workspaceDatabaseId,projectId:p.projectId,projectTaskId:p.projectTaskId,
          planId:inv.planId,planRevision:p.planRevision,planFingerprint:p.planFingerprint,taskId:inv.taskId,invocationId:inv.invocationId,attempt:inv.attempt,executor:openAIApiExecutorIdentity,accessMode:"api_key",model:s.credentials.limits.model,
          credentialGeneration:s.credentials.generation,repository:p.repository,contextFingerprint:ctx.fingerprint,allowedWritePaths:s.record.run.admittedAllowedPaths,readContextPaths:p.readContextPaths,limits:s.credentials.limits,pricing:s.pricing,
          maximumCostUsdMicros:s.maximum.maximumCostUsdMicros,requestFingerprint:request.requestFingerprint,createdAt:now,expiresAt:Math.min(now+15*60*1000,s.pricing.expiresAt)});fact(intent);
        const fp=ai044Fingerprint([s.credentials,s.pricing]);
        const router=createExecutorRouter([{routeId:"ai044-openai-api",executor:openAIApiExecutorIdentity,providerId:"openai",capabilities:["coding"],modes:["patch_proposal"],artifacts:["patch","report"],taskClasses:["implementation","repair"],maxRisk:"high",
          repositoryFeatures:["exact_baseline","bounded_context","allowed_paths","patch_artifacts"],environment:{id:"api-no-environment",kind:"patch_proposal_only"},accessModes:["api_key"],availability:{state:"available",fingerprint:fp},
          quota:{state:"unknown",fingerprint:null},estimatedCostUsdMicros:{value:intent.maximumCostUsdMicros,fingerprint:fp},estimatedLatencyMs:null,quality:null}]).router;fact(router);
        const route=router.select({admission:s.configuration.admission,developmentRun:s.configuration.developmentRun,repository:p.repository,capability:"coding",mode:"patch_proposal",taskClass:controllerTaskClass(s.state,s.record.run.currentAttemptNumber),
          policy:{environment:{kinds:["patch_proposal_only"],capabilities:[],residency:null,privacy:[]},accessModes:["api_key"],requireQuota:false,maxCostUsdMicros:intent.limits.maxInvocationCostUsdMicros,maxLatencyMs:null,minQualityBasisPoints:null,requiredExecutorId:"openai-api-patch",preferredExecutorIds:[]}});fact(route.verdict==="allow");
        const database=ownerCheckedDatabase(d.database,s.tenant,s.actor.ownerUserId,p),controller=createDevelopmentControllerStore({database,tenant:s.tenant});
        const saved=await controller.saveAttemptIntent({commandId:`api-${randomUUID()}`.slice(0,40),projectId:p.projectId,taskId:p.projectTaskId,expectedVersion:s.state.task.version,expectedControllerRevision:s.state.revision,
          developmentRunId:s.record.run.id,expectedRunRevision:s.record.revision,configuration:s.configuration,invocation:inv,context:ai044SubscriptionContextManifest(ctx),route:{decision:route,taskClass:controllerTaskClass(s.state,s.record.run.currentAttemptNumber)},executionPolicy:{profile:"ai044_openai_api",intent}});fact(saved.state);
        const stored=saved.state.attempts.find(a=>a.developmentRunId===s.record.run.id&&a.attemptNumber===s.record.run.currentAttemptNumber);fact(stored);
        const authority=createPostgresExecutorCurrentAuthorityStore({database,tenant:s.tenant,projectId:p.projectId,configuration:s.configuration,controllerBinding:{projectTaskId:p.projectTaskId,intentFingerprint:stored.intentFingerprint}});
        fact((s.record.run.currentAttemptNumber===1?await authority.registerCurrentAuthority():await authority.advanceCurrentAuthority()).verdict==="allow");
      } else {
        fact(s.intent&&s.stored&&openAIApiIntentCurrent(s.intent,d.clock())&&s.intent.credentialGeneration===s.credentials.generation
          &&ai044Fingerprint(s.intent.limits)===ai044Fingerprint(s.credentials.limits)&&ai044Fingerprint(s.intent.pricing)===ai044Fingerprint(s.pricing));
        const a=approvals(s),i=s.intent;
        if(r.action==="request") {fact(before.phase==="PREPARED");fact((await a.request(i)).verdict==="allow");}
        else if(r.action==="approve"||r.action==="reject") {fact(before.phase==="AWAITING_OWNER_APPROVAL");fact((await a.decide(before.approvalRequestId,i,r.action==="approve"?"approved":"rejected")).verdict==="allow");}
        else {
          fact(before.phase==="APPROVED");const ctx=await context(s);
          fact(ai044Fingerprint(ai044SubscriptionContextManifest(ctx))===ai044Fingerprint(s.stored.context)&&ctx.fingerprint===i.contextFingerprint);
          // Key/configuration cannot change between exact check, reserve, final fence and dispatch.
          await d.credentials.withKey(s.actor,i.credentialGeneration,async(key,limits)=>{
            fact(ai044Fingerprint(limits)===ai044Fingerprint(i.limits));
            const consumed=await a.consume(before.approvalRequestId,i);if(consumed.verdict!=="allow"||!consumed.capability)return;
            const executor=createOpenAIApiPatchExecutor(s.configuration,d.transport,d.clock);
            const outcome=await executor.execute({invocation:invocation(s),context:ctx,intent:i,key,approvalCapability:consumed.capability,fence:async()=>{
              fact(ai044Fingerprint(await d.pricing(i.model,d.clock()))===ai044Fingerprint(i.pricing));
              const start=await a.fence(consumed.capability);return start.capability;
            }});
            if(outcome)await a.recordOutcome(before.approvalRequestId,outcome); // ACK loss => durable held state, never retry.
          });
        }
      }
      return view(await snapshot());
    } catch{return unavailable();}
  }
  return Object.freeze({async load():Promise<OwnerOpenAIApiProofView>{try{return await view(await snapshot());}catch{return unavailable();}},act});
}
