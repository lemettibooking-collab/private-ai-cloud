/* eslint-disable @typescript-eslint/no-explicit-any -- fake provider captures canonical runtime requests */
import assert from 'node:assert/strict';
import test from 'node:test';
const live=await import(new URL('./helpers/live-pg.ts',import.meta.url).href);
const pg=await import(new URL('../../lib/db/postgres.ts',import.meta.url).href);
const accessModule=await import(new URL('../../lib/projects/project-owner-access.ts',import.meta.url).href);
const kb=await import(new URL('../../lib/projects/project-knowledge.ts',import.meta.url).href);
const composition=await import(new URL('../../lib/composition/owner-project-planning-generation.ts',import.meta.url).href);
const mock=await import(new URL('../../lib/providers/deterministic-mock-model-provider.ts',import.meta.url).href);
const db=await live.useLiveDatabase('projectgeneration'),A=live.primaryWorkspace;
await live.insertWorkspace(db.admin,A);
const owner='00000000-0000-4000-8000-000000009101';
await db.admin.query("insert into users(id,email,name,status)values($1,'generation@pac.test','Test','active')",[owner]);
await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github','9101','active')",[owner]);
const member=(await db.admin.query("insert into workspace_members(workspace_id,user_id,status)values($1,$2,'active')returning id",[A.id,owner])).rows[0].id;
const role=(await db.admin.query("insert into roles(workspace_id,code,name)values($1,'owner','Owner')returning id",[A.id])).rows[0].id;
await db.admin.query('insert into member_role_assignments(member_id,role_id)values($1,$2)',[member,role]);
const database=pg.createWorkflowRuntimePostgresDatabase({connectionString:db.url,maxConnections:8});
const session={pacIdentity:{provider:'github',providerSubject:'9101'}};
const access=accessModule.createProjectOwnerAccess({database,domainWorkspaceId:A.domain,session});
const knowledge=kb.createProjectKnowledge(access);
const identity={providerId:'mock',providerKind:'mock',deploymentId:'mock-deployment',providerModelId:'mock-model',providerRequestModelId:'mock-model-v1',providerModelVersion:'mock-model-v1'};
const policy={version:1,purpose:'project_document_planning',destination:'deterministic:local',identity,maxInputTokens:1000,maxOutputTokens:1000,maxCostUsdMicros:1000,dailyTokenBudget:2000,monthlyCostBudgetUsdCents:100,inputCostUsdMicrosPerMillionTokens:100,outputCostUsdMicrosPerMillionTokens:200,pricesVerifiedOn:'2020-01-01'};
const plan=(count=1)=>JSON.stringify({schemaVersion:'pac-project-plan/v1',title:'Generated project',tasks:[{id:'task-1',title:'Review outcome',goal:'Deliver outcome',description:'Review source data',type:'feature',priority:'P2',dependencyIds:[],acceptanceCriteria:['Verified'],scope:['Proposal only'],sourceReferences:[count-1]}]});
let serial=0;
async function fixture(count=1){
 const projectId='generation-'+(++serial);await db.admin.query('insert into projects(workspace_id,project_key,display_name)values($1,$2,$2)',[A.id,projectId]);
 const sources=[];
 for(let i=0;i<count;i++){
  const filename=`source-${i}.md`,r=await knowledge.upload({projectId,filename,expectedVersion:0,requestId:`generation-doc-${serial}-${i}`,bytes:Buffer.from('Untrusted source '+i)});
  assert.equal(r.status,'ok');sources.push({filename,version:r.value.document.version,sha256:r.value.document.sha256});
 }
 return{projectId,sources};
}
function provider(text:string,mode='success'){
 let counts=0,runs=0;const delegates=new Map<string,any>();
 const p={identity,async health(){return{verdict:"allow",reasons:[],normalizedHealth:{providerId:identity.providerId,deploymentId:identity.deploymentId,status:"healthy",observedAt:new Date().toISOString(),latencyMs:1,detailCode:null}};},
 async preflight(request:any,budget:any){counts++;
 const result={invocationId:request.invocationId,outcome:'succeeded',finishReason:'stop',providerId:identity.providerId,providerModelId:identity.providerModelId,providerRequestModelId:identity.providerRequestModelId,providerModelVersion:identity.providerModelVersion,outputText:text,structuredOutput:null,toolCallProposals:[],usage:{inputTokens:10,outputTokens:5,totalTokens:15},latencyMs:5,costUsdMicros:1,error:null};
 const made=mock.createDeterministicMockModelProvider({identity,health:{providerId:identity.providerId,deploymentId:identity.deploymentId,status:'healthy',observedAt:new Date().toISOString(),latencyMs:1,detailCode:null},scripts:[{request,result}]});
 assert.equal(made.verdict,'allow',JSON.stringify(made.reasons));delegates.set(request.invocationId,made.provider);return made.provider!.preflight(request,budget);
 },async run(request:any){runs++;if(mode==='unknown')throw Error('fake timeout');return delegates.get((request.request??request).invocationId).run(request);}};
 return{p,counts:()=>counts,runs:()=>runs};
}
function service(fake:ReturnType<typeof provider>,getPolicy=()=>policy,s:unknown=session){return composition.createProjectPlanningGeneration({database,domainWorkspaceId:A.domain,session:s,policy:getPolicy,provider:fake.p});}
async function offer(s:any,f:any,key?:string){const r=await s.prepare(f);assert.equal(r.status,'ok',JSON.stringify(r));return{...f,offerFingerprint:r.value.offerFingerprint,operationKey:key??'pp-'+(++serial).toString(16).padStart(32,'0'),consent:true};}
test('one/four sources: actual runtime -> durable proposal; exact replay does not dispatch',async()=>{
 for(const count of [1,4]){
  const f=await fixture(count),fake=provider(plan(count)),s=service(fake),input=await offer(s,f);
  const r=await s.generate(input);const trace=(await db.admin.query("select status,revision,runtime_snapshot->'stepStates' as steps from workflow_runs where workspace_id=$1 and project_id=$2",[A.id,f.projectId])).rows;assert.equal(r.status,'proposal_available',JSON.stringify({r,trace,counts:fake.counts(),runs:fake.runs()}));assert.equal(fake.runs(),1);assert.equal(r.sources.length,count);assert.equal(r.runtimeDispatchAllowed,false);
  assert.deepEqual(await s.generate(input),r);assert.equal(fake.runs(),1);
  assert.equal((await db.admin.query('select count(*)::int n from project_tasks where workspace_id=$1 and project_key=$2',[A.id,f.projectId])).rows[0].n,0);
 }
});
test('changed reviewed policy, no consent, revoked original identity and paused project dispatch zero',async()=>{
 const f=await fixture(),fake=provider(plan());let current={...policy};const s=service(fake,()=>current),input=await offer(s,f);
 for(const update of [{maxCostUsdMicros:999},{destination:'deterministic:other'},{inputCostUsdMicrosPerMillionTokens:101},{identity:{...identity,providerModelVersion:'other'}}]){current={...policy,...update};assert.notEqual((await s.generate(input)).status,'proposal_available');}
 current=policy;assert.equal((await s.generate({...input,consent:false})).status,'invalid_input');
 await db.admin.query("update projects set status='paused' where workspace_id=$1 and project_key=$2",[A.id,f.projectId]);assert.notEqual((await s.generate(input)).status,'proposal_available');
 await db.admin.query("update projects set status='active' where workspace_id=$1 and project_key=$2",[A.id,f.projectId]);await db.admin.query("update auth_identities set status='disabled' where provider_subject='9101'");assert.notEqual((await s.generate(input)).status,'proposal_available');await db.admin.query("update auth_identities set status='active' where provider_subject='9101'");assert.equal(fake.counts(),0);assert.equal(fake.runs(),0);
});
test('malformed output is durably charged and rejected; unknown outcome never redispatches',async()=>{
 for(const text of ['{"title":1,"title":2}',plan().replace('"sourceReferences":[0]','"sourceReferences":[1]')]){
 const f=await fixture(),fake=provider(text),s=service(fake),input=await offer(s,f);assert.equal((await s.generate(input)).status,'invalid_output');assert.equal((await s.generate(input)).status,'invalid_output');assert.equal(fake.runs(),1);
 }
 const f=await fixture(),fake=provider(plan(),'unknown'),s=service(fake),input=await offer(s,f);assert.equal((await s.generate(input)).status,'recovery_required');assert.equal((await s.generate(input)).status,'recovery_required');assert.equal(fake.runs(),1);
});
test('same operation concurrent replay dispatches at most once; fixed binding shares aggregate windows',async()=>{
 const f=await fixture(),fake=provider(plan()),s=service(fake),input=await offer(s,f);
 const r=await Promise.all([s.generate(input),s.generate(input)]);assert(r.some(v=>v.status==='proposal_available'));assert.equal(fake.runs(),1);
 const binding='pac-project-document-plan-planning-binding';
 await db.admin.query("update workflow_model_budget_windows set consumed_amount=1999 where workspace_id=$1 and project_id=$2 and workflow_binding_id=$3 and window_kind='daily_tokens'",[A.id,f.projectId,binding]);
 assert.equal((await s.generate(await offer(s,f))).status,'budget_denied');assert.equal(fake.runs(),1);
 const windows=(await db.admin.query('select distinct workflow_binding_id from workflow_model_budget_windows where workspace_id=$1 and project_id=$2',[A.id,f.projectId])).rows;assert.deepEqual(windows,[{workflow_binding_id:binding}]);
});
test.after(async()=>{await database.close();});
test('concurrent different operations cannot reset aggregate reservation windows',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),fake=provider(plan());
 const original=fake.p.run;fake.p.run=async request=>{entered();await held;return original(request);};
 const s=service(fake),a=await offer(s,f),b=await offer(s,f),first=s.generate(a);
 try{await started;assert.equal((await s.generate(b)).status,'budget_denied');assert.equal(fake.runs(),0);}finally{release();}
 assert.equal((await first).status,'proposal_available');assert.equal(fake.runs(),1);
 const rows=(await db.admin.query('select reserved_amount::text,consumed_amount::text from workflow_model_budget_windows where workspace_id=$1 and project_id=$2 and window_kind=\'daily_tokens\'',[A.id,f.projectId])).rows;
 assert.deepEqual(rows,[{reserved_amount:'0',consumed_amount:'15'}]);
});
test('restart/replay and alternate original identity never mint invocation authority; DB provenance immutable',async()=>{
 const f=await fixture(),fake=provider(plan()),s=service(fake),input=await offer(s,f);assert.equal((await s.generate(input)).status,'proposal_available');
 const restarted=provider(plan());assert.equal((await service(restarted).generate(input)).status,'proposal_available');assert.equal(restarted.counts()+restarted.runs(),0);
 await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github','9102','active')",[owner]);
 const other=service(restarted,()=>policy,{pacIdentity:{provider:'github',providerSubject:'9102'}});assert.equal((await other.read(f.projectId,input.operationKey)).status,'recovery_required');assert.notEqual((await other.generate(input)).status,'proposal_available');assert.equal(restarted.counts()+restarted.runs(),0);
 const row=(await db.admin.query('select id from project_planning_generations where workspace_id=$1 and operation_key=$2',[A.id,input.operationKey])).rows[0];
 for(const sql of ["update project_planning_generations set offer_fingerprint=repeat('a',64) where id=$1","delete from project_planning_generations where id=$1","update project_planning_generation_sources set sha256=repeat('a',64) where generation_id=$1","delete from project_planning_generation_sources where generation_id=$1"])await assert.rejects(db.admin.query(sql,[row.id]));
});
test('cross-purpose budget scope is factual workspace/project/workflow binding, not global',async()=>{
 const f=await fixture(),fake=provider(plan()),s=service(fake),input=await offer(s,f);
 await db.admin.query("insert into workflow_model_budget_windows(workspace_id,project_id,workflow_binding_id,window_kind,window_start,consumed_amount)values($1,$2,'pac-feature-plan-planning-binding','daily_tokens',(transaction_timestamp() at time zone 'UTC')::date,999999)",[A.id,f.projectId]);
 assert.equal((await s.generate(input)).status,'proposal_available');
 const bindings=(await db.admin.query('select distinct workflow_binding_id from workflow_model_budget_windows where workspace_id=$1 and project_id=$2 order by workflow_binding_id',[A.id,f.projectId])).rows.map((r:any)=>r.workflow_binding_id);
 assert.deepEqual(bindings,['pac-feature-plan-planning-binding','pac-project-document-plan-planning-binding']);
});
test('audit rollback and lost request settlement ACK never dispatch twice',async()=>{
 for(const point of ['audit','settle-ack','result-write','snapshot'] as const){
  const f=await fixture(),fake=provider(plan()),s=service(fake),input=await offer(s,f),interceptor=live.installQueryInterceptor();
  const tag=point==='audit'?'project-generation:audit':point==='settle-ack'?'project-generation:settle':point==='result-write'?'workflow-runtime:insert-invocation-result':'workflow-runtime:update-run';
  interceptor.rules.push(live.rule(point,(sql:string)=>live.sqlTag(tag)(sql)&&(point!=='snapshot'||fake.runs()>0),async(_c:any,sql:string,v:unknown[],original:any)=>{
   if(point==='settle-ack'){await original(sql,v);throw Error('fake lost ACK');}
   if(point==='snapshot'&&fake.runs()===0)return original(sql,v);
   throw Error('fake deterministic failure');
  }));
  let result:any;try{result=await s.generate(input);}finally{interceptor.restore();}
  assert.notEqual(result.status,'proposal_available');const before=fake.runs();
  if(point==='audit'){assert.equal(before,0);continue;}
  const replay=await s.generate(input);assert.equal(fake.runs(),before);assert.equal(replay.status,'recovery_required');
 }
});
test('cross-project/source version and actor manifest substitutions fail; no secret/public content projection',async()=>{
 const f=await fixture(),fake=provider(plan()),s=service(fake),input=await offer(s,f);
 for(const change of [{sources:[{...f.sources[0],sha256:'a'.repeat(64)}]},{sources:[{...f.sources[0],version:50}]},{workspaceId:'forged'},{ownerUserId:'forged'}])assert.notEqual((await s.generate({...input,...change})).status,'proposal_available');
 assert.equal(fake.counts()+fake.runs(),0);assert.equal((await service(fake,()=>policy,null).prepare(f)).status,'unauthenticated');
 const prepared=await s.prepare(f);assert(!JSON.stringify(prepared).includes('Untrusted source'));
 const foreign=await fixture();assert.notEqual((await s.generate({...input,projectId:foreign.projectId})).status,'proposal_available');
});
test('historical exact Knowledge versions survive new upload; foreign source links and raw-result tampering deny',async()=>{
 const f=await fixture(),fake=provider(plan()),s=service(fake),input=await offer(s,f);assert.equal((await s.generate(input)).status,'proposal_available');
 assert.equal((await knowledge.upload({projectId:f.projectId,filename:f.sources[0].filename,expectedVersion:1,requestId:'generation-later-'+serial,bytes:Buffer.from('Later source version')})).status,'ok');
 assert.equal((await s.read(f.projectId,input.operationKey)).status,'proposal_available');
 const foreign=await fixture();
 await assert.rejects(db.admin.query('insert into project_planning_generation_sources(workspace_id,project_key,generation_id,source_index,document_id,filename,version,sha256) select workspace_id,$2,generation_id,3,document_id,filename,version,sha256 from project_planning_generation_sources where workspace_id=$1 and project_key=$3',[A.id,foreign.projectId,f.projectId]));
 await db.admin.query('alter table workflow_model_invocation_results disable trigger workflow_model_invocation_results_immutable');
 try{await db.admin.query("update workflow_model_invocation_results o set output_text=output_text||' ' from workflow_runs r where o.workflow_run_id=r.id and o.workspace_id=$1 and r.project_id=$2",[A.id,f.projectId]);}finally{await db.admin.query('alter table workflow_model_invocation_results enable trigger workflow_model_invocation_results_immutable');}
 assert.equal((await s.read(f.projectId,input.operationKey)).status,'recovery_required');assert.equal((await s.generate(input)).status,'recovery_required');assert.equal(fake.runs(),1);
});
test('lifecycle INSERT accepts started only, even with complete forged terminal audit and source evidence',async t=>{
 const f=await fixture(),fake=provider(plan()),s=service(fake),input=await offer(s,f);
 assert.equal((await s.generate(input)).status,'proposal_available');
 const original=(await db.admin.query('select * from project_planning_generations where workspace_id=$1 and operation_key=$2',[A.id,input.operationKey])).rows[0];
 for(const status of ['started','proposal_available','invalid_output','budget_denied','provider_unavailable','recovery_required','authorization_denied'])await t.test(status,async()=>{
  const id=(await db.admin.query('select gen_random_uuid()::text id')).rows[0].id;
  const suffix=(++serial).toString(16);
  const row={...original,id,operation_key:'pp-'+suffix.padStart(32,'0'),run_id:'ppg-'+suffix.padStart(20,'0'),status,
   settled_at:status==='started'?null:new Date().toISOString(),
   output_fingerprint:['proposal_available','invalid_output'].includes(status)?'sha256:'+'b'.repeat(64):null,
   plan_fingerprint:status==='proposal_available'?'c'.repeat(64):null};
  let code:string|null=null;
  await db.admin.query('begin');
  try{
   await db.admin.query('insert into project_planning_generations select (jsonb_populate_record(null::project_planning_generations,$1::jsonb)).*',[JSON.stringify(row)]);
   await db.admin.query('insert into project_planning_generation_sources select workspace_id,project_key,$2::uuid,source_index,document_id,filename,version,sha256 from project_planning_generation_sources where workspace_id=$1 and generation_id=$3',[A.id,id,original.id]);
   for(const event of ['project.planning_generation_authorized',...(status==='started'?[]:['project.planning_generation_settled'])])await db.admin.query("insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata)values($1,$2,$3,'project_planning_generation',$4,$5::jsonb)",[A.id,owner,event,id,JSON.stringify({requestFingerprint:row.request_fingerprint,...(event.endsWith('_settled')?{status}:{})})]);
   await db.admin.query('commit');
  }catch(error){code=(error as {code:string}).code;await db.admin.query('rollback');}
  assert.equal(code,status==='started'?null:'23514',`initial ${status} must ${status==='started'?'commit':'be rejected, despite complete source/audit evidence and absent Run/result'}`);
 });
});
