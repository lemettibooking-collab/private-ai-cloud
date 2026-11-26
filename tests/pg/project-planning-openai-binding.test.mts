/* eslint-disable @typescript-eslint/no-explicit-any -- fake provider captures canonical runtime requests */
import assert from 'node:assert/strict';
import test from 'node:test';
const live=await import(new URL('./helpers/live-pg.ts',import.meta.url).href);
const pg=await import(new URL('../../lib/db/postgres.ts',import.meta.url).href);
const accessModule=await import(new URL('../../lib/projects/project-owner-access.ts',import.meta.url).href);
const kb=await import(new URL('../../lib/projects/project-knowledge.ts',import.meta.url).href);
const composition=await import(new URL('../../lib/composition/owner-project-planning-generation.ts',import.meta.url).href);
const db=await live.useLiveDatabase('projectopenai'),A=live.primaryWorkspace;
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

const {mkdtemp,rm}=await import('node:fs/promises');
const credentialModule=await import(new URL('../../lib/integrations/openai-api/openai-api-credential-store.ts',import.meta.url).href);
const root=await mkdtemp('/private/tmp/pac-planning-api-');
const credentials=credentialModule.createOpenAIApiCredentialStore(root+'/credentials');
const limits={model:'gpt-test-2026-01-01',maxContextBytes:100000,maxInputTokens:1000,maxOutputTokens:1000,maxInvocationCostUsdMicros:1000,dailyBudgetUsdMicros:10000};
const actor={ownerUserId:owner,domainWorkspaceId:A.domain};
await credentials.save(actor,'sk-synthetic-test-only-000000000',limits);
const facts=await credentials.facts(actor);
const realIdentity={providerId:'openai',providerKind:'openai',deploymentId:'planning-openai',providerModelId:limits.model,providerRequestModelId:limits.model,providerModelVersion:limits.model};
function realPolicy(){return{...policy,version:2,destination:'https://api.openai.com/v1/responses',identity:realIdentity,api:{mode:'fake_sdk_only',credentialGeneration:facts.generation,limits,pricing:{model:limits.model,inputUsdMicrosPerMillionTokens:100,outputUsdMicrosPerMillionTokens:200,verifiedAt:Date.now()-1000,expiresAt:Date.now()+60000,source:'https://developers.openai.com/api/docs/pricing'},maxPreflightCostUsdMicros:10}};}
function setup(beforeCount=async()=>{},text=plan(),tier='default'){
 let counts=0,runs=0;let current=realPolicy();
 const fake={mode:'fake_sdk_only',credentials,createClient(options:any){assert.equal(options.maxRetries,0);assert.equal(options.logLevel,'off');return{models:{async retrieve(){throw Error('unexpected discovery');}},responses:{inputTokens:{async count(){counts++;await beforeCount();return{object:'response.input_tokens',input_tokens:10};}},async create(input:any){runs++;assert.equal(input.service_tier,'default');return{service_tier:tier,model:limits.model,status:'completed',error:null,incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}};}}};}};
 const s=composition.createProjectPlanningGeneration({database,domainWorkspaceId:A.domain,session,policy:()=>current,provider:{identity},openAIFake:fake});
 return{s,counts:()=>counts,runs:()=>runs,setPolicy:(p:any)=>{current=p;},policy:()=>current};
}
async function offerReal(s:any,f:any){const r=await s.prepare(f);assert.equal(r.status,'ok',JSON.stringify(r));return{...f,offerFingerprint:r.value.offerFingerprint,operationKey:'pp-'+(++serial).toString(16).padStart(32,'0'),consent:true};}
test('OpenAI fake SDK: real adapter/runtime native count -> one proposal -> durable read/replay',async()=>{
 const f=await fixture(),x=setup(),input=await offerReal(x.s,f);const r=await x.s.generate(input);assert.equal(r.status,'proposal_available',JSON.stringify(r));assert.equal(x.counts(),1);assert.equal(x.runs(),1);
 assert.deepEqual(await x.s.read(f.projectId,input.operationKey),r);assert.deepEqual(await x.s.generate(input),r);assert.equal(x.runs(),1);
 x.setPolicy({...x.policy(),api:{...x.policy().api,pricing:{...x.policy().api.pricing,expiresAt:Date.now()-1}}});assert.deepEqual(await x.s.read(f.projectId,input.operationKey),r);assert.equal(x.runs(),1);
 const cost=await db.admin.query('select state,actual_cost_usd_micros::text as cost from project_planning_api_reservations where workspace_id=$1 and project_key=$2',[A.id,f.projectId]);assert.deepEqual(cost.rows,[{state:'settled',cost:'12'}]);
 assert.equal((await db.admin.query('select count(*)::int n from project_tasks where workspace_id=$1 and project_key=$2',[A.id,f.projectId])).rows[0].n,0);
});
test('final provider-start denies project/identity/consent/policy revocation after native count',async()=>{
 for(const mode of ['project','identity','membership','expiry','policy']){
  const f=await fixture();const x:any=setup(async()=>{if(mode==='project')await db.admin.query("update projects set status='paused' where workspace_id=$1 and project_key=$2",[A.id,f.projectId]);
   if(mode==='identity')await db.admin.query("update auth_identities set status='disabled' where provider='github' and provider_subject='9101'");
   if(mode==='membership')await db.admin.query("update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2",[A.id,owner]);
   if(mode==='policy')x.setPolicy({...x.policy(),maxCostUsdMicros:999});
   if(mode==='expiry'){const interceptor=live.installQueryInterceptor();interceptor.rules.push(live.rule('expiry',(sql:string)=>sql==='select clock_timestamp() as now',async()=>({rowCount:1,rows:[{now:new Date(Date.now()+900000)}]})));x.restore=()=>interceptor.restore();}
  });
  const input=await offerReal(x.s,f);try{assert.notEqual((await x.s.generate(input)).status,'proposal_available');assert.equal(x.runs(),0);}finally{x.restore?.();await db.admin.query("update workspace_members set status='active' where workspace_id=$1 and user_id=$2",[A.id,owner]);await db.admin.query("update auth_identities set status='active' where provider='github' and provider_subject='9101'");}
 }
});
test('pre-count aggregate denial and unknown tier retain exposure; invalid proposal still settles cost',async()=>{
 const f=await fixture(),x=setup(),input=await offerReal(x.s,f);
 await db.admin.query("insert into openai_api_daily_budgets(workspace_id,budget_day,limit_usd_micros) values($1,current_date,10000) on conflict do nothing",[A.id]);
 // Existing planner exposure must participate in the same shared sum; deny before SDK count.
 x.setPolicy({...x.policy(),api:{...x.policy().api,limits:{...limits,dailyBudgetUsdMicros:1}}});assert.notEqual((await x.s.generate(input)).status,'proposal_available');assert.equal(x.counts(),0);
 for(const [text,tier,expected] of [[plan(),'priority','recovery_required'],['{}','default','invalid_output']]){
 const f=await fixture(),y=setup(async()=>{},text,tier),i=await offerReal(y.s,f);assert.equal((await y.s.generate(i)).status,expected);assert.equal(y.runs(),1);await y.s.generate(i);assert.equal(y.runs(),1);
 const row=(await db.admin.query('select state from project_planning_api_reservations where workspace_id=$1 and project_key=$2',[A.id,f.projectId])).rows[0];assert.equal(row.state,tier==='default'?'settled':'started');
 }
});
test('native count failure retains full preflight exposure and replay never recounts',async()=>{
 const f=await fixture(),x=setup(async()=>{throw Error('synthetic count ambiguity');}),input=await offerReal(x.s,f);
 assert.notEqual((await x.s.generate(input)).status,'proposal_available');assert.equal(x.counts(),1);assert.equal(x.runs(),0);
 await x.s.generate(input);assert.equal(x.counts(),1);
 const r=(await db.admin.query('select state,actual_cost_usd_micros from project_planning_api_reservations where workspace_id=$1 and project_key=$2',[A.id,f.projectId])).rows;assert.deepEqual(r,[{state:'reserved',actual_cost_usd_micros:null}]);
});
test('changed credential generation fails before native count',async()=>{
 const f=await fixture(),x=setup(),i=await offerReal(x.s,f);await credentials.configure(actor,limits);assert.notEqual((await x.s.generate(i)).status,'proposal_available');assert.equal(x.counts(),0);
});


test('workspace/day ceiling includes concurrent executor exposure before planner count',async t=>{
 const fixtureModule=await import(new URL('../fixtures/openai-api-proof-pg.mts',import.meta.url).href);
 const executor=await fixtureModule.apiProofPgFixture(db,'psb',{daily:30000});t.after(executor.cleanup);
 const subject=String(990000+(++serial));await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github',$2,'active')",[executor.ownerId,subject]);
 const projectAccess=accessModule.createProjectOwnerAccess({database:executor.database,domainWorkspaceId:executor.tenant.workspaceId,session:{pacIdentity:{provider:'github',providerSubject:subject}}});
 const uploaded=await kb.createProjectKnowledge(projectAccess).upload({projectId:'project-a',filename:'plan.md',expectedVersion:0,requestId:'planning-budget-source',bytes:Buffer.from('Bounded planning input')});assert.equal(uploaded.status,'ok');
 const facts=await executor.credentials.facts({ownerUserId:executor.ownerId,domainWorkspaceId:executor.tenant.workspaceId});
 const model=executor.limits.model;
 const p={...policy,version:2,destination:'https://api.openai.com/v1/responses',identity:{...realIdentity,providerModelId:model,providerRequestModelId:model,providerModelVersion:model},maxInputTokens:8192,maxOutputTokens:2048,maxCostUsdMicros:20000,dailyTokenBudget:12000,inputCostUsdMicrosPerMillionTokens:1000000,outputCostUsdMicrosPerMillionTokens:5000000,api:{mode:'fake_sdk_only',credentialGeneration:facts.generation,limits:executor.limits,pricing:executor.dependencies.pricing(model,Date.now()),maxPreflightCostUsdMicros:10}};
 p.api.pricing=await p.api.pricing;
 let plannerCalls=0;
 const s=composition.createProjectPlanningGeneration({database:executor.database,domainWorkspaceId:executor.tenant.workspaceId,session:{pacIdentity:{provider:'github',providerSubject:subject}},policy:()=>p,provider:{identity},openAIFake:{mode:'fake_sdk_only',credentials:executor.credentials,createClient(){plannerCalls++;throw Error('must not construct client before budget');}}});
 const doc=uploaded.value.document,input=await offerReal(s,{projectId:'project-a',sources:[{filename:doc.filename,version:doc.version,sha256:doc.sha256}]});
 // The credential lock also serializes the actual paths. Hold the executor at its native count,
 // then inspect the cross-purpose ledger directly without acquiring another credential lock.
 let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r),transport=executor.dependencies.transport;
 executor.dependencies.transport=async(...args:any[])=>{if(String(args[0]).endsWith('/input_tokens')){entered();await held;}return transport(...args);};
 const v=await executor.ready();
 let planningRequests:any;
 const invocation=executor.action('invoke',v);
 try{await Promise.race([waiting,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('count barrier not reached')),5000);timer.unref();})]);
  const requestsModule=await import(new URL('../../lib/planning/project-planning-generation.ts',import.meta.url).href);
  const digest=await import(new URL('../../lib/planning/project-planning-contract.ts',import.meta.url).href);
  const requests=planningRequests=requestsModule.createProjectGenerationRequests({access:projectAccess,domainWorkspaceId:executor.tenant.workspaceId,identityFingerprint:digest.planDigest({provider:'github',providerSubject:subject}),policy:()=>p});
  assert.notEqual((await requests.begin(input)).status,'ok');assert.equal(plannerCalls,0);
 }finally{release();}
 const result=await invocation;assert.equal(result.phase,'COMPLETED');
 assert.equal((await planningRequests.begin(input)).status,'ok');
 const next=await fixtureModule.apiProofPgFixture(db,'prb',{shared:executor.foundation,daily:30000,path:'src/server/terminal/account/other.ts'});t.after(next.cleanup);
 const approved=await next.ready();await next.action('invoke',approved);assert.equal(next.counts(),0,'planner hold must block executor before native count');assert.equal(next.posts(),0);

});

// Trusted driver-boundary clock control only: no production clock option or host clock changes.
for (const phase of ['reserve','count','start']) test(`UTC rollover at ${phase} denies dispatch and preserves immutable exposure`,async()=>{
 const f=await fixture(),x=setup();
 x.setPolicy({...x.policy(),api:{...x.policy().api,credentialGeneration:(await credentials.facts(actor)).generation}});
 const input=await offerReal(x.s,f);
 await db.admin.query("insert into openai_api_daily_budgets(workspace_id,budget_day,limit_usd_micros)values($1,(clock_timestamp() at time zone 'UTC')::date,10000)on conflict do nothing",[A.id]);
 if(phase==='count'){
  // Fill tomorrow through actual request/reservation admission, without any SDK calls.
  const original=x.policy(),seedPolicy={...original,api:{...original.api,maxPreflightCostUsdMicros:998}};
  x.setPolicy(seedPolicy);const seed=await fixture(),seedInput=await offerReal(x.s,seed);x.setPolicy(original);
  const requestsModule=await import(new URL('../../lib/planning/project-planning-generation.ts',import.meta.url).href);
  const digest=await import(new URL('../../lib/planning/project-planning-contract.ts',import.meta.url).href);
  const requests=requestsModule.createProjectGenerationRequests({access,domainWorkspaceId:A.domain,identityFingerprint:digest.planDigest(session.pacIdentity),policy:()=>seedPolicy});
  const clock=live.installQueryInterceptor(),tomorrow=new Date(Date.now()+86400000).toISOString();
  function next(){clock.rules.push(live.rule('tomorrow reserve',()=>true,async(_c:any,config:any,values:any,send:any)=>{
   next();const sql=(typeof config==='string'?config:config.text).replaceAll("clock_timestamp() at time zone 'UTC'",`timestamptz '${tomorrow}' at time zone 'UTC'`);
   return send(typeof config==='string'?sql:{...config,text:sql},values);
  }));}next();
  try{for(let i=0;i<10;i++)assert.equal((await requests.begin({...seedInput,operationKey:'pp-'+i.toString(16).padStart(32,'e')})).status,'ok');}
  finally{clock.restore();}
  const used=await db.admin.query('select sum(reserved_cost_usd_micros)::int as used from project_planning_api_reservations where workspace_id=$1 and project_key=$2',[A.id,seed.projectId]);
  assert.equal(used.rows[0].used,10000); // Tomorrow is fully exhausted.
 }
 const interceptor=live.installQueryInterceptor();
 let rolled=false,locks=0;
 const tomorrow=new Date(Date.now()+86400000).toISOString();
 function install(){interceptor.rules.push(live.rule('financial clock',()=>true,async(_client:any,config:any,values:any,send:any)=>{
  install();let sql=typeof config==='string'?config:config.text;
  if(sql.includes('select workspace_id from openai_api_daily_budgets')&&sql.includes('for update')){
   locks++;
   if((phase==='reserve'&&locks===1)||(phase==='start'&&locks===2)){
    const blocker=live.adminClient(db.url);await blocker.connect();
    try{
     await blocker.query('begin');
     await blocker.query('select workspace_id from openai_api_daily_budgets where workspace_id=$1 and budget_day=$2::date for update',values);
     const pending=send(config,values);
     let blocked=false;
     for(let i=0;i<100;i++){
      const r=await blocker.query('select cardinality(pg_blocking_pids($1))>0 as blocked',[_client.processID]);
      if(r.rows[0].blocked){blocked=true;break;}await live.sleep(5);
     }
     assert(blocked,'application must actually wait on the shared daily row');rolled=true;
     await blocker.query('commit');return await pending;
    }finally{await blocker.end();}
   }
   return send(config,values);
  }
  if(phase==='count'&&sql.includes('project_planning_api_reservations')&&sql.includes('for update')&&locks===1)rolled=true;
  if(rolled&&sql.includes('clock_timestamp()')){
   sql=sql.replaceAll("clock_timestamp() at time zone 'UTC'",`timestamptz '${tomorrow}' at time zone 'UTC'`);
   return send(typeof config==='string'?sql:{...config,text:sql},values);
  }
  return send(config,values);
 }));}install();
 try{
  const result=await x.s.generate(input);assert.notEqual(result.status,'proposal_available');
  assert.equal(x.counts(),phase==='start'?1:0);assert.equal(x.runs(),0);
  const before=await db.admin.query('select * from project_planning_api_reservations where workspace_id=$1 and project_key=$2',[A.id,f.projectId]);
  assert.equal(before.rowCount,phase==='reserve'?0:1);
  if(before.rowCount)assert.equal(before.rows[0].state,'reserved');
  const audits=await db.admin.query("select event_type,metadata from audit_events where workspace_id=$1 and entity_id=$2 and event_type like 'project.planning_api_%' order by event_type",[A.id,before.rows[0]?.generation_id??'00000000-0000-4000-8000-000000000000']);
  assert.equal(audits.rowCount,phase==='reserve'?0:1);
  if(audits.rowCount)assert.equal(audits.rows[0].event_type,'project.planning_api_reserved');
  if(phase!=='reserve'){
   await x.s.generate(input);assert.equal(x.counts(),phase==='start'?1:0);assert.equal(x.runs(),0);
   assert.deepEqual((await db.admin.query('select * from project_planning_api_reservations where workspace_id=$1 and project_key=$2',[A.id,f.projectId])).rows,before.rows);
  }
 }finally{interceptor.restore();}
});

test.after(async()=>{await database.close();await rm(root,{recursive:true,force:true});});
