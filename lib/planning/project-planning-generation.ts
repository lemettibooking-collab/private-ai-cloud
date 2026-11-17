// @ts-expect-error Direct Node execution requires extension.
import { isResolvedWorkflowRuntimeTenant } from '../db/workflow-runtime-tenant.ts';
// @ts-expect-error Direct Node execution requires extension.
import { openAIApiUsageCost } from '../integrations/openai-api/openai-api-policy.ts';
import type { ResolvedWorkflowRuntimeTenant } from '../db/workflow-runtime-tenant';
import type { AgentStepModelBudgetReservation } from '../workflows/agent-step-runtime';
// @ts-expect-error Direct Node execution requires extension.
import { reservePlanningApi,startPlanningApi,settlePlanningApi } from '../db/project-planning-api-reservations.ts';
import { randomBytes, createHash } from 'node:crypto';
import type { WorkflowRuntimeSqlClient } from '../db/workflow-runtime-store';
import type { createProjectOwnerAccess, ProjectOwnerContext } from '../projects/project-owner-access';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { exactOwnData } from '../db/executor-start-transaction.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { projectAIPlanningInput } from './project-planning-form.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { prepareAuthorizedProjectGeneration } from './project-planning.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { planDigest, parsePlanningJSON, validateProjectPlan } from './project-planning-contract.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { projectGenerationPolicy, generationOfferFingerprint } from '../composition/project-planning-generation-config.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { projectGenerationInvocationFingerprint } from './project-planning-generation-run.ts';
export const generationRuntimeDispatchAllowed=false;
export const outputDigest=(s:string)=>'sha256:'+createHash('sha256').update(s,'utf8').digest('hex');
export function validateGeneratedProposal(text:string,count:number){
 try{return validateProjectPlan(parsePlanningJSON(text),count);}catch{return validateProjectPlan(null,count);}
}
class Conflict extends Error {}
class Unavailable extends Error {}
type Access=ReturnType<typeof createProjectOwnerAccess>;
type Row=Record<string,unknown>;
export type GenerationOutcome='proposal_available'|'invalid_output'|'budget_denied'|'provider_unavailable'|'recovery_required'|'authorization_denied';
const hash=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
const operation=(s:unknown):s is string=>typeof s==='string'&&/^pp-[a-f0-9]{32}$/u.test(s);
export function canonicalUtc(value:unknown):string|null{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))return null;
 const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?value:null;
}
async function audit(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,row:Row,event:string,status?:string){
 await client.query(`/* project-generation:audit */ insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata)values($1,$2,$3,'project_planning_generation',$4::uuid,$5::jsonb)`,[c.workspaceId,c.userId,event,row.id,JSON.stringify({requestFingerprint:row.request_fingerprint,...(status?{status}:{})})]);
}
export function createProjectGenerationRequests(input:Readonly<{access:Access;identityFingerprint:string;domainWorkspaceId:string;policy:()=>unknown}>){
 const {access,identityFingerprint}=input;
 // Project generation owns its conflict signal; it never imports a task mutation contract.
 async function run<T>(projectId:unknown,write:boolean,work:(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext)=>Promise<T>){
  let conflict=false;
  const result=await access.run(projectId,write,async(client,c)=>{
   try{return await work(client,c);}catch(error){if(error instanceof Conflict)conflict=true;throw error;}
  });
  return conflict&&result.status==='unavailable'?{status:'conflict' as const}:result;
 }
 function policy(){const p=projectGenerationPolicy(input.policy());if(!p)throw new Unavailable();return p;}
 async function capture(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,selected:NonNullable<ReturnType<typeof projectAIPlanningInput>>){
  const prepared=await prepareAuthorizedProjectGeneration(client,c,selected),p=policy();
  return {prepared,policy:p,offerFingerprint:generationOfferFingerprint(prepared.preparationFingerprint,p)};
 }
 async function evidence(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,row:Row){
  if(row.requested_by!==c.userId||row.identity_fingerprint!==identityFingerprint)throw new Unavailable();
  const sources=await client.query(`/* project-generation:sources */ select source_index,filename,version,sha256 from project_planning_generation_sources where workspace_id=$1 and project_key=$2 and generation_id=$3 order by source_index`,[c.workspaceId,row.project_key,row.id]);
  const manifest=sources.rows.map((s,i)=>{if(s.source_index!==i)throw new Unavailable();return{filename:s.filename,version:s.version,sha256:s.sha256};});
  const storedManifest=projectAIPlanningInput({projectId:row.project_key,sources:row.manifest_json});
  if(!storedManifest||planDigest(manifest)!==planDigest(storedManifest.sources))throw new Unavailable();
  const selected=projectAIPlanningInput({projectId:row.project_key,sources:manifest});if(!selected)throw new Unavailable();
  const prepared=await prepareAuthorizedProjectGeneration(client,c,selected);
  const storedPolicy=projectGenerationPolicy(row.policy_json,new Date(row.authorized_at as string).getTime());if(!storedPolicy||prepared.preparationFingerprint!==row.preparation_fingerprint||generationOfferFingerprint(prepared.preparationFingerprint,storedPolicy)!==row.offer_fingerprint)throw new Unavailable();
  const authorizedAt=new Date(row.authorized_at as string).toISOString(),expiresAt=new Date(row.expires_at as string).toISOString();
  const runtimeFp=projectGenerationInvocationFingerprint({workspaceId:input.domainWorkspaceId,planningKey:row.run_id as string,project:{projectId:row.project_key as string,displayName:c.project.display_name as string},createdAt:authorizedAt,policy:storedPolicy},prepared.messages as never);
  if(!runtimeFp||runtimeFp!==row.runtime_request_fingerprint)throw new Unavailable();
  const fp=planDigest(['pac.project-generation-request.v1',runtimeFp,c.workspaceId,row.project_key,row.operation_key,row.run_id,c.userId,identityFingerprint,row.offer_fingerprint,authorizedAt,expiresAt]);
  if(fp!==row.request_fingerprint)throw new Unavailable();
  const events=await client.query(`/* project-generation:evidence */ select event_type,actor_user_id::text,metadata from audit_events where workspace_id=$1 and entity_type='project_planning_generation' and entity_id=$2 order by event_type`,[c.workspaceId,row.id]);
  const start=events.rows.filter(e=>e.event_type==='project.planning_generation_authorized'),end=events.rows.filter(e=>e.event_type==='project.planning_generation_settled');
  if(start.length!==1||start[0].actor_user_id!==c.userId||planDigest(start[0].metadata)!==planDigest({requestFingerprint:fp})||end.length!==(row.status==='started'?0:1)||end.some(e=>e.actor_user_id!==c.userId||!exactOwnData(e.metadata,['requestFingerprint','status'])||(e.metadata as Record<string,unknown>).requestFingerprint!==fp||(e.metadata as Record<string,unknown>).status!==row.status))throw new Unavailable();
  return {prepared,policy:storedPolicy,selected,authorizedAt,expiresAt};
 }
 return Object.freeze({
  async prepare(raw:unknown){
   const selected=projectAIPlanningInput(raw);if(!selected)return{status:'invalid_input' as const};
   return run(selected.projectId,true,async(client,c)=>{
    const v=await capture(client,c,selected);
    return Object.freeze({sources:selected.sources,preparationFingerprint:v.prepared.preparationFingerprint,offerFingerprint:v.offerFingerprint,policy:v.policy,runtimeDispatchAllowed:false as const});
   });
  },
  async begin(raw:unknown){
   const f=exactOwnData(raw,['projectId','sources','offerFingerprint','operationKey','consent']);
   const selected=f&&projectAIPlanningInput({projectId:f.projectId,sources:f.sources});
   if(!f||!selected||!hash(f.offerFingerprint)||!operation(f.operationKey)||f.consent!==true)return{status:'invalid_input' as const};
   return run(selected.projectId,true,async(client,c)=>{
    const v=await capture(client,c,selected);if(v.offerFingerprint!==f.offerFingerprint)throw new Conflict();
    const existing=await client.query(`/* project-generation:replay */ select * from project_planning_generations where workspace_id=$1 and operation_key=$2`,[c.workspaceId,f.operationKey]);
    if(existing.rowCount){const row=existing.rows[0];if(row.project_key!==selected.projectId||row.offer_fingerprint!==f.offerFingerprint)throw new Conflict();await evidence(client,c,row);return{kind:'replayed' as const,row};}
    const time=await client.query(`/* project-generation:clock */ select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`);
    const authorizedAt=canonicalUtc(time.rows[0]?.now);if(!authorizedAt)throw new Unavailable();
    const expiresAt=new Date(Date.parse(authorizedAt)+600000).toISOString(),runId='ppg-'+randomBytes(10).toString('hex');
    const runtimeFp=projectGenerationInvocationFingerprint({workspaceId:input.domainWorkspaceId,planningKey:runId,project:{projectId:selected.projectId,displayName:c.project.display_name as string},createdAt:authorizedAt,policy:v.policy},v.prepared.messages as never);if(!runtimeFp)throw new Unavailable();
    const fp=planDigest(['pac.project-generation-request.v1',runtimeFp,c.workspaceId,selected.projectId,f.operationKey,runId,c.userId,identityFingerprint,v.offerFingerprint,authorizedAt,expiresAt]);
    const inserted=await client.query(`/* project-generation:insert */ insert into project_planning_generations(workspace_id,project_key,operation_key,run_id,requested_by,identity_fingerprint,preparation_fingerprint,offer_fingerprint,request_fingerprint,policy_json,manifest_json,authorized_at,expires_at,runtime_request_fingerprint)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14) returning *`,[c.workspaceId,selected.projectId,f.operationKey,runId,c.userId,identityFingerprint,v.prepared.preparationFingerprint,v.offerFingerprint,fp,JSON.stringify(v.policy),JSON.stringify(selected.sources),authorizedAt,expiresAt,runtimeFp]);
    if(inserted.rowCount!==1)throw new Unavailable();const row=inserted.rows[0];
    for(const [index,doc] of v.prepared.documents.entries())await client.query(`/* project-generation:source-insert */ insert into project_planning_generation_sources(workspace_id,project_key,generation_id,source_index,document_id,filename,version,sha256)values($1,$2,$3,$4,$5,$6,$7,$8)`,[c.workspaceId,selected.projectId,row.id,index,doc.documentId,doc.filename,doc.version,doc.sha256]);
    if(v.policy.api)await reservePlanningApi(client,c,row,v.policy);
    await audit(client,c,row,'project.planning_generation_authorized');
    return{kind:'started' as const,row};
   });
  },
  async admit(projectId:string,operationKey:string){
   return run(projectId,true,async(client,c)=>{
    const result=await client.query(`/* project-generation:admit */ select * from project_planning_generations where workspace_id=$1 and project_key=$2 and operation_key=$3 for update`,[c.workspaceId,projectId,operationKey]);
    if(result.rowCount!==1)throw new Unavailable();const row=result.rows[0],v=await evidence(client,c,row);
    const now=new Date().toISOString();if(row.status!=='started'||now<v.authorizedAt||now>=v.expiresAt||generationOfferFingerprint(v.prepared.preparationFingerprint,policy())!==row.offer_fingerprint)throw new Unavailable();
    return{row,...v,ownerUserId:c.userId,projectName:c.project.display_name as string};
   });
  },
  async startInTransaction(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,reservation:AgentStepModelBudgetReservation,tenant:ResolvedWorkflowRuntimeTenant){
   if(!isResolvedWorkflowRuntimeTenant(tenant)||tenant.workspaceDatabaseId!==c.workspaceId||tenant.workspaceId!==reservation.workspaceId)throw new Unavailable();
   const q=await client.query(`select * from project_planning_generations where workspace_id=$1 and project_key=$2 and run_id=$3 for update`,[c.workspaceId,reservation.projectId,reservation.runId]);
   if(q.rowCount!==1)throw new Unavailable();const row=q.rows[0],v=await evidence(client,c,row);
   const time=await client.query(`select clock_timestamp() as now`),now=new Date(time.rows[0].now as string).toISOString();
   if(row.status!=='started'||now<v.authorizedAt||now>=v.expiresAt||row.runtime_request_fingerprint!==reservation.requestFingerprint||generationOfferFingerprint(v.prepared.preparationFingerprint,policy())!==row.offer_fingerprint||!v.policy.api)throw new Unavailable();
   await startPlanningApi(client,c,row,v.policy,()=>generationOfferFingerprint(v.prepared.preparationFingerprint,policy())===row.offer_fingerprint);
  },
  async settle(projectId:string,operationKey:string,outcome:GenerationOutcome,text:string|null){
   return run(projectId,true,async(client,c)=>{
    const rows=await client.query(`/* project-generation:settle-lock */ select * from project_planning_generations where workspace_id=$1 and project_key=$2 and operation_key=$3 for update`,[c.workspaceId,projectId,operationKey]);
    if(rows.rowCount!==1)throw new Unavailable();const row=rows.rows[0],v=await evidence(client,c,row);
    if(row.status!=='started')throw new Conflict();
    const validated=text===null?null:validateGeneratedProposal(text,v.selected.sources.length).plan;
    const status=text===null?outcome:validated?'proposal_available':'invalid_output';
    if(text===null&&['proposal_available','invalid_output'].includes(status))throw new Unavailable();
    await client.query(`/* project-generation:settle */ update project_planning_generations set status=$4,output_fingerprint=$5,plan_fingerprint=$6,settled_at=now() where workspace_id=$1 and project_key=$2 and operation_key=$3`,[c.workspaceId,projectId,operationKey,status,text===null?null:outputDigest(text),validated?planDigest(validated):null]);
    if(v.policy.api&&text!==null){
     const cost=await client.query(`select o.input_tokens::text as input,o.output_tokens::text as output from workflow_model_invocations o join workflow_runs r on r.workspace_id=o.workspace_id and r.id=o.workflow_run_id where r.workspace_id=$1 and r.runtime_id=$2`,[c.workspaceId,row.run_id]);
     if(cost.rowCount!==1)throw new Unavailable();const actual=openAIApiUsageCost(v.policy.api.pricing,Number(cost.rows[0].input),Number(cost.rows[0].output));if(actual===null)throw new Unavailable();await settlePlanningApi(client,c,row,actual,v.policy);
    }
    await audit(client,c,row,'project.planning_generation_settled',status);return{status};
   });
  },
  async read(projectId:string,operationKey:string){
   if(!operation(operationKey))return{status:'invalid_input' as const};
   return run(projectId,false,async(client,c)=>{
    const rows=await client.query(`/* project-generation:read */ select * from project_planning_generations where workspace_id=$1 and project_key=$2 and operation_key=$3`,[c.workspaceId,projectId,operationKey]);
    if(rows.rowCount!==1)throw new Unavailable();const row=rows.rows[0],v=await evidence(client,c,row);
    if(!['proposal_available','invalid_output'].includes(row.status as string))return{status:row.status==='started'?'recovery_required':row.status as string};
    const results=await client.query(`/* project-generation:result */ select o.output_text,o.output_fingerprint from workflow_runs r join workflow_model_invocations i on i.workspace_id=r.workspace_id and i.workflow_run_id=r.id join workflow_model_invocation_results o on o.workspace_id=i.workspace_id and o.workflow_run_id=r.id and o.model_invocation_id=i.id where r.workspace_id=$1 and r.project_id=$2 and r.runtime_id=$3 and i.invocation_id=$4 and i.status='succeeded' and i.outcome='succeeded' and i.request_fingerprint=$5`,[c.workspaceId,projectId,row.run_id,row.run_id+'-invocation',row.runtime_request_fingerprint]);
    const result=results.rows[0];if(results.rowCount!==1||typeof result.output_text!=='string'||result.output_fingerprint!==row.output_fingerprint||outputDigest(result.output_text)!==row.output_fingerprint)throw new Unavailable();
    const validated=validateGeneratedProposal(result.output_text,v.selected.sources.length);
    if((validated.plan?planDigest(validated.plan):null)!==row.plan_fingerprint)throw new Unavailable();
    return{status:row.status as string,proposal:validated.plan,findings:validated.findings,sources:v.selected.sources,runtimeDispatchAllowed:false as const};
   });
  },
 });
}
