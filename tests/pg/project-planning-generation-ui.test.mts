/* eslint-disable @typescript-eslint/no-explicit-any -- fake provider captures canonical runtime requests */
import assert from 'node:assert/strict';
import test from 'node:test';
const live=await import(new URL('./helpers/live-pg.ts',import.meta.url).href);
const pg=await import(new URL('../../lib/db/postgres.ts',import.meta.url).href);
const accessModule=await import(new URL('../../lib/projects/project-owner-access.ts',import.meta.url).href);
const kb=await import(new URL('../../lib/projects/project-knowledge.ts',import.meta.url).href);
const composition=await import(new URL('../../lib/composition/owner-project-planning-generation.ts',import.meta.url).href);
const mock=await import(new URL('../../lib/providers/deterministic-mock-model-provider.ts',import.meta.url).href);
const db=await live.useLiveDatabase('projectgenerationui'),A=live.primaryWorkspace;
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

const seam=await import(new URL('../../lib/composition/owner-project-planning-generation-action.ts',import.meta.url).href);
const form=(v:Record<string,string>)=>{const f=new FormData();for(const[k,x]of Object.entries(v))f.set(k,x);return f;};
function ui(fake:ReturnType<typeof provider>,getPolicy=()=>policy,s:unknown=session,unbound=false){
 const backend=service(fake,getPolicy,s),ownerAccess=accessModule.createProjectOwnerAccess({database,domainWorkspaceId:A.domain,session:s});
 return seam.createProjectGenerationActions({authorize:async(projectId:string)=>(await ownerAccess.run(projectId,false,async()=>true)).status,read:backend.read,...(unbound?{}:{backend})});
}
async function prepared(action:ReturnType<typeof ui>,f:Awaited<ReturnType<typeof fixture>>){
 const r=await action('prepare',form({projectId:f.projectId,sources:JSON.stringify(f.sources)}));assert.equal(r.status,'awaiting_authorization');assert(r.offer&&r.operationKey);assert.match(r.operationKey,/^pp-[a-f0-9]{32}$/u);
 return{projectId:f.projectId,sources:JSON.stringify(r.offer.sources),offerFingerprint:r.offer.offerFingerprint,operationKey:r.operationKey,consent:'true'};
}
test('transport to persisted runtime: prepare is read-only, consent invokes once, durable reload invokes zero',async()=>{
 for(const count of [1,4]){
 const f=await fixture(count),fake=provider(plan(count)),action=ui(fake);
 const boundaries=['approval_requests','project_task_feature_plans'];
 const before=await Promise.all(boundaries.map(async table=>(await db.admin.query(`select count(*)::int n from ${table} where workspace_id=$1`,[A.id])).rows[0].n));
 const input=await prepared(action,f);
 assert.equal(fake.runs()+fake.counts(),0);
 assert.equal((await db.admin.query('select count(*)::int n from project_planning_generations where workspace_id=$1 and project_key=$2',[A.id,f.projectId])).rows[0].n,0);
 const generated=await Promise.all([action('generate',form(input)),action('generate',form(input))]);assert(generated.some(r=>r.status==='proposal_available'));assert.equal(fake.runs(),1);
 const readForm=form({projectId:f.projectId,operationKey:input.operationKey});const reload=await ui(fake)('read',readForm);assert.equal(reload.status,'proposal_available');assert.equal(reload.sources?.length,count);assert(reload.proposal);assert.equal(fake.runs(),1);
 assert.equal((await action('generate',form(input))).status,'proposal_available');assert.equal(fake.runs(),1);
 for(const table of ['project_tasks','project_planning_drafts'])assert.equal((await db.admin.query(`select count(*)::int n from ${table} where workspace_id=$1 and project_key=$2`,[A.id,f.projectId])).rows[0].n,0);
 assert(!JSON.stringify(reload).includes('Untrusted source'));
 const after=await Promise.all(boundaries.map(async table=>(await db.admin.query(`select count(*)::int n from ${table} where workspace_id=$1`,[A.id])).rows[0].n));assert.deepEqual(after,before);
 assert.equal((await db.admin.query("select count(*)::int n from workflow_runs where workspace_id=$1 and project_id=$2 and status='queued'",[A.id,f.projectId])).rows[0].n,0);
 }
});
test('production unbound and denied identities create no runs or invocations',async()=>{
 const f=await fixture(),fake=provider(plan()),action=ui(fake,()=>policy,session,true);
 assert.equal((await action('prepare',form({projectId:f.projectId,sources:JSON.stringify(f.sources)}))).status,'production_binding_unavailable');
 const input={projectId:f.projectId,sources:JSON.stringify(f.sources),operationKey:'pp-'+'a'.repeat(32),offerFingerprint:'a'.repeat(64),consent:'true'};
 assert.equal((await action('generate',form(input))).status,'production_binding_unavailable');assert.equal(fake.runs()+fake.counts(),0);
 assert.equal((await db.admin.query('select count(*)::int n from workflow_runs where workspace_id=$1 and project_id=$2',[A.id,f.projectId])).rows[0].n,0);
 const denied=ui(fake,()=>policy,null);assert.equal((await denied('read',form({projectId:f.projectId,operationKey:input.operationKey}))).status,'unauthenticated');
});
test('changed offer, selection, policy, missing consent and foreign project reads fail closed',async()=>{
 const f=await fixture(),other=await fixture(),fake=provider(plan());let current={...policy};const action=ui(fake,()=>current),input=await prepared(action,f);
 for(const changed of [{consent:'false'},{offerFingerprint:'b'.repeat(64)},{sources:JSON.stringify([{...f.sources[0],sha256:'b'.repeat(64)}])},{projectId:other.projectId}])assert.notEqual((await action('generate',form({...input,...changed}))).status,'proposal_available');
 current={...policy,destination:'deterministic:changed'};assert.equal((await action('generate',form(input))).status,'conflict');current=policy;
 assert.equal(fake.runs(),0);assert.equal((await action('generate',form(input))).status,'proposal_available');
 assert.equal((await action('read',form({projectId:other.projectId,operationKey:input.operationKey}))).status,'recovery_required');
 assert.equal((await action('generate',form({...input,projectId:other.projectId}))).status,'conflict');assert.equal(fake.runs(),1);
});
test('invalid output and unknown outcome remain truthful on reload and never redispatch',async()=>{
 for(const mode of ['invalid','unknown']){
 const f=await fixture(),fake=provider(mode==='invalid'?'{}':plan(),mode),action=ui(fake),input=await prepared(action,f),expected=mode==='invalid'?'invalid_output':'recovery_required';
 assert.equal((await action('generate',form(input))).status,expected);
 assert.equal((await action('read',form({projectId:f.projectId,operationKey:input.operationKey}))).status,expected);
 assert.equal((await action('generate',form(input))).status,expected);assert.equal(fake.runs(),1);
 }
});
test.after(async()=>{await database.close();});
