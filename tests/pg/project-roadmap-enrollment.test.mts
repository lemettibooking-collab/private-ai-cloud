/* eslint-disable @typescript-eslint/no-explicit-any -- fake provider captures canonical runtime requests */
import assert from 'node:assert/strict';
import test from 'node:test';
const live=await import(new URL('./helpers/live-pg.ts',import.meta.url).href);
const pg=await import(new URL('../../lib/db/postgres.ts',import.meta.url).href);
const accessModule=await import(new URL('../../lib/projects/project-owner-access.ts',import.meta.url).href);
const kb=await import(new URL('../../lib/projects/project-knowledge.ts',import.meta.url).href);
const composition=await import(new URL('../../lib/composition/owner-project-planning-generation.ts',import.meta.url).href);
const mock=await import(new URL('../../lib/providers/deterministic-mock-model-provider.ts',import.meta.url).href);
const db=await live.useLiveDatabase('backlogenrollment'),A=live.primaryWorkspace;
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
async function offer(s:any,f:any,key?:string){const r=await s.prepare(f);assert.equal(r.status,'ok',JSON.stringify(r));return{...f,offerFingerprint:r.value.offerFingerprint,operationKey:key??'pp-'+(++serial).toString(16).padStart(32,'0'),consent:true};}
const planningModule=await import(new URL('../../lib/planning/project-planning.ts',import.meta.url).href);
const contract=await import(new URL('../../lib/planning/project-planning-contract.ts',import.meta.url).href);
const planning=planningModule.createProjectPlanning(access,{domainWorkspaceId:A.domain,identityFingerprint:contract.planDigest(session.pacIdentity)});

const enrollment=await import(new URL('../../lib/planning/project-roadmap-enrollment.ts',import.meta.url).href);
const featurePlans=await import(new URL('../../lib/development/feature-plan-mutations.ts',import.meta.url).href);
const roadmapStore=await import(new URL('../../lib/db/roadmap-store.ts',import.meta.url).href);
const tenants=await import(new URL('../../lib/db/workflow-runtime-tenant.ts',import.meta.url).href);
const taskMutations=await import(new URL('../../lib/tasks/owner-task-mutations.ts',import.meta.url).href);
const {roadmapPlan}=await import(new URL('../fixtures/roadmap.mts',import.meta.url).href);
const service=enrollment.createProjectRoadmapEnrollment(access,{domainWorkspaceId:A.domain,identityFingerprint:contract.planDigest(session.pacIdentity)});
const planWriter=featurePlans.createOwnerFeaturePlanMutations({database,domainWorkspaceId:A.domain,identitySource:{resolve:()=>({userId:owner})}});
test.after(async()=>{await database.close();});
async function backlog(origin='manual_import',status='approved',count=2,change:(raw:any)=>void=()=>{}){
 const raw=JSON.parse(plan(origin==='ai_generated'?4:1));for(let i=1;i<count;i++)raw.tasks.push({...raw.tasks[0],id:'task-'+(i+1),title:'Task '+(i+1),dependencyIds:['task-'+i]});
 change(raw);
 let f:any,fake:any=null,input:any=null,fp:string;
 if(origin==='ai_generated'){f=await fixture(4);fake=provider(JSON.stringify(raw));const s=serviceGeneration(fake);input=await offer(s,f);const r=await s.generate(input);assert.equal(r.status,'proposal_available');fp=contract.planDigest(r.proposal);assert.equal((await planning.saveGenerated({projectId:f.projectId,operationKey:input.operationKey,planFingerprint:fp,expectedRevision:0})).status,'ok');}
 else{f=await fixture();const up=await knowledge.upload({projectId:f.projectId,filename:'manual.md',expectedVersion:0,requestId:'manual-'+serial,bytes:Buffer.from('```pac-plan-v1\n'+JSON.stringify(raw)+'\n```')});assert.equal(up.status,'ok');const selector={projectId:f.projectId,filename:'manual.md',version:1,sourceSha256:up.value.document.sha256};const preview=await planning.preview(selector);assert.equal(preview.status,'ok');fp=contract.planDigest(preview.value.validation.plan);assert.equal((await planning.save({...selector,previewFingerprint:preview.value.previewFingerprint,expectedRevision:0})).status,'ok');}
 const decision={projectId:f.projectId,revision:1,planFingerprint:fp,decision:status};if(status!=='pending')assert.equal((await planning.decide(decision)).status,'ok');
 const selected=(await planning.read(f.projectId)).value.selected;
 const selector={projectId:f.projectId,revision:1,planFingerprint:fp,sourceFingerprint:selected.sourceFingerprint};
 return{f,fake,input,decision,selector,raw,taskIds:raw.tasks.map((t:any)=>contract.planningTaskKey(f.projectId,t.id))};
}
const serviceGeneration=serviceForGeneration;
function serviceForGeneration(fake:any){return composition.createProjectPlanningGeneration({database,domainWorkspaceId:A.domain,session,policy:()=>policy,provider:fake.p});}
async function previewOf(b:any){const p=await service.preview(b.selector);assert.equal(p.status,'ok',JSON.stringify(p));return p.value;}
async function enroll(b:any){const p=await previewOf(b),intent={...b.selector,previewFingerprint:p.previewFingerprint},result=await service.enroll(intent);assert.equal(result.status,'ok',JSON.stringify(result));return{p,intent,result};}
async function saveFeature(b:any,index=0){const taskId=b.taskIds[index],r=await planWriter.saveDraftRevision({idempotencyKey:'backlog-plan-'+(++serial),taskId,plan:roadmapPlan()});assert.equal(r.status,'created');return r;}
async function readyIntent(b:any,index=0){const p=await previewOf(b),t=p.tasks.find((t:any)=>t.taskId===b.taskIds[index]);return{...b.selector,previewFingerprint:p.previewFingerprint,taskId:t.taskId,expectedVersion:t.version,featurePlanId:t.featurePlan?.planId??'missing-plan',featurePlanRevision:t.featurePlan?.revision??1,featurePlanFingerprint:t.featurePlan?.fingerprint??'a'.repeat(64)};}
async function stateCounts(projectId:string){
 const o:any={};for(const table of ['project_tasks','roadmap_milestones','roadmap_task_dependencies','roadmap_task_events','project_planning_drafts'])o[table]=(await db.admin.query(`select count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) digest from ${table} t where workspace_id=$1 and project_key=$2`,[A.id,projectId])).rows[0];return o;
}
for(const origin of ['manual_import','ai_generated'])test(origin+': committed approval → enrollment → saved FeaturePlan → explicit ready preserves planning history',async()=>{
 const b=await backlog(origin),before=(await db.admin.query('select task_key,creation_idempotency_key,creation_intent_fingerprint from project_tasks where workspace_id=$1 and project_key=$2 order by task_key',[A.id,b.f.projectId])).rows;
 const x=await enroll(b);const p=await previewOf(b);assert(p.enrolled);assert.equal(p.taskCount,2);assert.equal(p.dependencyCount,1);assert(p.tasks.every((t:any)=>t.status==='draft'&&t.version===1));
 const edges=(await db.admin.query('select task_key,dependency_task_key from roadmap_task_dependencies where workspace_id=$1 and project_key=$2',[A.id,b.f.projectId])).rows;assert.deepEqual(edges,[{task_key:b.taskIds[1],dependency_task_key:b.taskIds[0]}]);
 assert.equal((await planning.read(b.f.projectId)).status,'ok');assert.equal((await planning.decide(b.decision)).status,'ok');
 assert.notEqual((await service.ready(await readyIntent(b))).status,'ok');await saveFeature(b);const ri=await readyIntent(b);assert.equal((await service.ready(ri)).status,'ok');assert.equal((await service.ready(ri)).status,'ok');
 assert.equal((await planning.read(b.f.projectId)).status,'ok');assert.equal((await planning.decide(b.decision)).status,'ok');assert.equal((await service.enroll(x.intent)).status,'ok');
 assert.deepEqual((await db.admin.query('select task_key,creation_idempotency_key,creation_intent_fingerprint from project_tasks where workspace_id=$1 and project_key=$2 order by task_key',[A.id,b.f.projectId])).rows,before);
 assert.equal((await db.admin.query('select status from project_tasks where workspace_id=$1 and task_key=$2',[A.id,b.taskIds[0]])).rows[0].status,'ready');if(b.fake)assert.equal(b.fake.runs(),1);
 assert.equal((await db.admin.query(`select count(*)::int n from approval_requests where workspace_id=$1 and original_payload->>'projectId'=$2`,[A.id,b.f.projectId])).rows[0].n,1);
});
test('pending/rejected, forged, cross-project, paused and original-identity substitutions deny before mutation',async()=>{
 for(const status of ['pending','rejected']){const b=await backlog('manual_import',status);assert.notEqual((await service.preview(b.selector)).status,'ok');}
 const b=await backlog('ai_generated'),p=await previewOf(b),intent={...b.selector,previewFingerprint:p.previewFingerprint},before=await stateCounts(b.f.projectId);
 for(const patch of [{projectId:'missing'},{planFingerprint:'a'.repeat(64)},{sourceFingerprint:'b'.repeat(64)},{revision:2},{previewFingerprint:'c'.repeat(64)}])assert.notEqual((await service.enroll({...intent,...patch})).status,'ok');
 const other=enrollment.createProjectRoadmapEnrollment(access,{domainWorkspaceId:A.domain,identityFingerprint:'a'.repeat(64)});assert.notEqual((await other.enroll(intent)).status,'ok');
 for(const [sql,args,reset] of [["update projects set status='paused' where workspace_id=$1 and project_key=$2",[A.id,b.f.projectId],"update projects set status='active' where workspace_id=$1 and project_key=$2"],["update workspace_members set status='disabled' where id=$1",[member],"update workspace_members set status='active' where id=$1"],["update auth_identities set status='disabled' where provider_subject='9101'",[],"update auth_identities set status='active' where provider_subject='9101'"]] as any){await db.admin.query(sql,args);try{assert.notEqual((await service.enroll(intent)).status,'ok');}finally{await db.admin.query(reset,args);}}
 assert.deepEqual(await stateCounts(b.f.projectId),before);assert.equal(b.fake.runs(),1);
});
test('concurrent enrollment deduplicates; changed-intent replay cannot overwrite; audit failure is atomic; lost COMMIT reconciles',async()=>{
 const b=await backlog(),p=await previewOf(b),intent={...b.selector,previewFingerprint:p.previewFingerprint};const results=await Promise.all(Array.from({length:4},()=>service.enroll(intent)));assert(results.every((r:any)=>r.status==='ok'));
 assert.equal((await db.admin.query('select count(*)::int n from roadmap_milestones where workspace_id=$1 and project_key=$2',[A.id,b.f.projectId])).rows[0].n,1);assert.notEqual((await service.enroll({...intent,previewFingerprint:'a'.repeat(64)})).status,'ok');
 for(const phase of ['audit','lost']){const x=await backlog(),preview=await previewOf(x),i=live.installQueryInterceptor(),before=await stateCounts(x.f.projectId);i.rules.push(live.rule(phase,live.sqlTag(phase==='audit'?'project-roadmap:audit':'task-mutation:commit'),async(_c:any,sql:any,v:any,send:any)=>{if(phase==='lost')await send(sql,v);throw Error('synthetic '+phase);}));
 let result:any;try{result=await service.enroll({...x.selector,previewFingerprint:preview.previewFingerprint});}finally{i.restore();}
 if(phase==='audit'){assert.notEqual(result.status,'ok');assert.deepEqual(await stateCounts(x.f.projectId),before);}else{assert.equal(result.status,'ok');assert.equal(result.value.status,'replayed');}}
});
test('initial materialization stays strict; corrupted creation evidence and conflicting enrollment deny',async()=>{
 const b=await backlog(),p=await previewOf(b),intent={...b.selector,previewFingerprint:p.previewFingerprint};
 for(const tag of ['project-planning:links','project-planning:task-audit-read']){const i=live.installQueryInterceptor();i.rules.push(live.rule('corrupt creation',live.sqlTag(tag),async(_c:any,sql:any,v:any,send:any)=>{const r=await send(sql,v);return{...r,rows:r.rows.map((x:any)=>tag.endsWith('links')?{...x,creation_intent_fingerprint:'a'.repeat(64)}:{...x,metadata:{}})};}));try{assert.notEqual((await service.enroll(intent)).status,'ok');}finally{i.restore();}}
 const i=live.installQueryInterceptor();i.rules.push(live.rule('missing links',live.sqlTag('project-planning:links'),async()=>({rowCount:0,rows:[]})));try{assert.notEqual((await service.enroll(intent)).status,'ok');}finally{i.restore();}
 const before=await stateCounts(b.f.projectId);await assert.rejects(db.admin.query("update project_tasks set milestone_key='missing',state_version=1 where workspace_id=$1 and task_key=$2",[A.id,b.taskIds[0]]));assert.deepEqual(await stateCounts(b.f.projectId),before);
});
test('incompatible requirements deny atomically; whole-project graph cap includes ordinary tasks',async()=>{
 const b=await backlog(),p=await previewOf(b);const tenant=await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(A.domain);assert(tenant);
 const tasks=taskMutations.createOwnerTaskMutations({database,domainWorkspaceId:A.domain,identitySource:{resolve:()=>({userId:owner})}});
 for(let n=0;n<255;n++)assert.equal((await tasks.createTask({idempotencyKey:'capacity-'+(++serial),projectId:b.f.projectId,title:'Ordinary task',goal:'Capacity fixture',type:'feature',priority:'P2',riskLevel:'low'})).status,'created');
 const before=await stateCounts(b.f.projectId);assert.notEqual((await service.enroll({...b.selector,previewFingerprint:p.previewFingerprint})).status,'ok');assert.deepEqual(await stateCounts(b.f.projectId),before);
});
test('ordinary createTask serializes with graph admission and cannot overflow a managed project',async()=>{
 const b=await backlog('manual_import','approved',1),p=await previewOf(b),tenant=await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(A.domain);assert(tenant);
 const tasks=taskMutations.createOwnerTaskMutations({database,domainWorkspaceId:A.domain,identitySource:{resolve:()=>({userId:owner})}});
 for(let n=0;n<255;n++)assert.equal((await tasks.createTask({idempotencyKey:'race-cap-'+(++serial),projectId:b.f.projectId,title:'Ordinary task',goal:'Capacity fixture',type:'feature',priority:'P2',riskLevel:'low'})).status,'created');
 let seen!:()=>void,release!:()=>void;const observed=new Promise<void>(r=>seen=r),released=new Promise<void>(r=>release=r);const i=live.installQueryInterceptor();i.rules.push(live.rule('graph barrier',(sql:string)=>sql.includes('from project_tasks t left join roadmap_task_dependencies'),async(_c:any,sql:any,v:any,send:any)=>{const r=await send(sql,v);seen();await released;return r;}));
 try{const mutation=service.enroll({...b.selector,previewFingerprint:p.previewFingerprint});await observed;const input={idempotencyKey:'race-overflow-'+(++serial),projectId:b.f.projectId,title:'Concurrent task',goal:'Must not overflow',type:'feature',priority:'P2',riskLevel:'low'},created=tasks.createTask(input);release();assert.equal((await mutation).status,'ok');assert.equal((await created).status,'conflict');}finally{release();i.restore();}
 assert.equal((await db.admin.query('select count(*)::int n from project_tasks where workspace_id=$1 and project_key=$2',[A.id,b.f.projectId])).rows[0].n,256);
 const existing=(await db.admin.query("select creation_idempotency_key,title,goal,task_type,priority,risk_level from project_tasks where workspace_id=$1 and project_key=$2 and creation_idempotency_key like 'race-cap-%' limit 1",[A.id,b.f.projectId])).rows[0];
 const replay={idempotencyKey:existing.creation_idempotency_key,projectId:b.f.projectId,title:existing.title,goal:existing.goal,type:existing.task_type,priority:existing.priority,riskLevel:existing.risk_level};assert.equal((await tasks.createTask(replay)).status,'replayed');assert.equal((await tasks.createTask({...replay,title:'Changed intent'})).status,'conflict');
 assert(await roadmapStore.createRoadmapStore({database,tenant}).projectGraph(b.f.projectId));
});
test('FeaturePlan saves and readiness races are coherent; dependencies remain the existing claim gate',async()=>{
 const b=await backlog();await enroll(b);await saveFeature(b);const stale=await readyIntent(b);await saveFeature(b);assert.equal((await service.ready(stale)).status,'conflict');
 const ready=await readyIntent(b),results=await Promise.all([service.ready(ready),planWriter.saveDraftRevision({idempotencyKey:'racing-plan-'+(++serial),taskId:b.taskIds[0],plan:roadmapPlan()})]);
 assert(['ok','conflict'].includes(results[0].status));if(results[0].status!=='ok')assert.equal((await service.ready(await readyIntent(b))).status,'ok');
 await saveFeature(b,1);assert.equal((await service.ready(await readyIntent(b,1))).status,'ok');
 const tenant=await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(A.domain);assert(tenant);const store=roadmapStore.createRoadmapStore({database,tenant});
 assert.equal((await store.claimReady({commandId:'blocked-claim',projectId:b.f.projectId,taskId:b.taskIds[1],expectedVersion:2})).status,'blocked');
 const ports=await import(new URL('../fixtures/development-controller.mts',import.meta.url).href),core=await import(new URL('../../lib/roadmap/development-controller.ts',import.meta.url).href),p=ports.controllerPorts(database,tenant,b.taskIds[0]);
 const controller=core.createDevelopmentController({database,tenant,repository:p.repository,routingSource:p.routingSource,contextSource:p.contextSource,executorPort:p.executorPort,qualityPort:p.qualityPort,securityPort:p.securityPort});
 const state=await controller.inspect(b.f.projectId,b.taskIds[0]);assert(state);const claimed=await controller.advanceController({commandId:'trusted-claim',projectId:b.f.projectId,taskId:b.taskIds[0],expectedVersion:2,expectedControllerRevision:state.revision});assert.equal(claimed.action,'claim_ready_task');assert.equal(claimed.status,'applied');
 const next=await controller.inspect(b.f.projectId,b.taskIds[0]);const gated=await controller.advanceController({commandId:'trusted-plan-gate',projectId:b.f.projectId,taskId:b.taskIds[0],expectedVersion:next.task.version,expectedControllerRevision:next.revision});assert.equal(gated.action,'require_plan_approval');
 for(let tick=0;tick<2;tick++){const current=await controller.inspect(b.f.projectId,b.taskIds[0]);const waiting=await controller.advanceController({commandId:'typed-approval-wait-'+tick,projectId:b.f.projectId,taskId:b.taskIds[0],expectedVersion:current.task.version,expectedControllerRevision:current.revision});assert.equal(waiting.action,'require_plan_approval');assert.equal(waiting.status,tick===0?'applied':'waiting_owner');}
 assert.equal((await db.admin.query("select count(*)::int n from approval_requests where workspace_id=$1 and action_type='development_feature_plan_approval' and original_payload->>'projectId'=$2 and status='pending'",[A.id,b.f.projectId])).rows[0].n,1);
 assert.equal((await db.admin.query('select count(*)::int n from controller_operations where workspace_id=$1 and project_key=$2',[A.id,b.f.projectId])).rows[0].n,0);
 assert.equal((await planning.read(b.f.projectId)).status,'ok');assert.equal((await planning.decide(b.decision)).status,'ok');
});

test('incompatible metadata, milestone collision and a forged whole-project graph roll back without rewrites',async()=>{
 const incompatible=await backlog('manual_import','approved',1,p=>{p.tasks[0].scope=['token: untrusted source requirement'];});const baseline=await stateCounts(incompatible.f.projectId);assert.notEqual((await service.preview(incompatible.selector)).status,'ok');assert.deepEqual(await stateCounts(incompatible.f.projectId),baseline);
 const b=await backlog(),p=await previewOf(b),tenant=await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(A.domain);assert(tenant);const ownerCommands=await import(new URL('../../lib/roadmap/roadmap-owner-commands.ts',import.meta.url).href);
 const writer=ownerCommands.createRoadmapOwnerCommands({database,tenant,identitySource:{resolve:()=>({userId:owner})}});assert.equal((await writer.createMilestone({commandId:'collision-'+(++serial),projectId:b.f.projectId,milestoneId:p.milestoneId,title:'Existing milestone',goal:'Must not overwrite',priority:0})).status,'applied');const before=await stateCounts(b.f.projectId);assert.notEqual((await service.enroll({...b.selector,previewFingerprint:p.previewFingerprint})).status,'ok');assert.deepEqual(await stateCounts(b.f.projectId),before);
 const x=await backlog(),preview=await previewOf(x),i=live.installQueryInterceptor(),original=await stateCounts(x.f.projectId);i.rules.push(live.rule('forged unrelated graph',(sql:string)=>sql.includes('from project_tasks t left join roadmap_task_dependencies'),async(_c:any,sql:any,v:any,send:any)=>{const r=await send(sql,v);return{...r,rowCount:r.rowCount+1,rows:[...r.rows,{task_key:'unrelated',status:'draft',priority:'P2',deps:['missing-task']}]};}));try{assert.notEqual((await service.enroll({...x.selector,previewFingerprint:preview.previewFingerprint})).status,'ok');}finally{i.restore();}assert.deepEqual(await stateCounts(x.f.projectId),original);
});
test('enrollment and FeaturePlan save coexist; readiness audit failure and lost commit reconcile without extra planning approvals',async()=>{
 const b=await backlog(),preview=await previewOf(b);const both=await Promise.all([service.enroll({...b.selector,previewFingerprint:preview.previewFingerprint}),saveFeature(b)]);assert.equal(both[0].status,'ok');
 const intent=await readyIntent(b),before=await stateCounts(b.f.projectId),i=live.installQueryInterceptor();i.rules.push(live.rule('readiness audit failure',(sql:string)=>sql.includes("'roadmap.task_transition'"),async()=>{throw Error('synthetic audit failure');}));try{assert.notEqual((await service.ready(intent)).status,'ok');}finally{i.restore();}assert.deepEqual(await stateCounts(b.f.projectId),before);
 const lost=live.installQueryInterceptor();lost.rules.push(live.rule('lost readiness commit',live.sqlTag('task-mutation:commit'),async(_c:any,sql:any,v:any,send:any)=>{await send(sql,v);throw Error('synthetic lost commit');}));try{const result=await service.ready(intent);assert.equal(result.status,'ok');assert.equal(result.value.status,'replayed');}finally{lost.restore();}
 assert.equal((await service.ready({...intent,featurePlanFingerprint:'b'.repeat(64)})).status,'conflict');assert.equal((await planning.decide(b.decision)).status,'ok');
});

test('authorized Owner in another tenant cannot enroll identical project selectors',async()=>{
 const b=await backlog(),p=await previewOf(b),B=live.secondaryWorkspace;await live.insertWorkspace(db.admin,B);
 const m=(await db.admin.query("insert into workspace_members(workspace_id,user_id,status)values($1,$2,'active')returning id",[B.id,owner])).rows[0].id,r=(await db.admin.query("insert into roles(workspace_id,code,name)values($1,'owner','Owner')returning id",[B.id])).rows[0].id;await db.admin.query('insert into member_role_assignments(member_id,role_id)values($1,$2)',[m,r]);await db.admin.query('insert into projects(workspace_id,project_key,display_name)values($1,$2,$2)',[B.id,b.f.projectId]);
 const foreignAccess=accessModule.createProjectOwnerAccess({database,domainWorkspaceId:B.domain,session}),foreign=enrollment.createProjectRoadmapEnrollment(foreignAccess,{domainWorkspaceId:B.domain,identityFingerprint:contract.planDigest(session.pacIdentity)}),before=await stateCounts(b.f.projectId);
 assert.notEqual((await foreign.enroll({...b.selector,previewFingerprint:p.previewFingerprint})).status,'ok');assert.deepEqual(await stateCounts(b.f.projectId),before);
});
test('task-first FeaturePlan save, project approval replay and enrollment do not form a lock wait cycle',{timeout:30000},async()=>{
 const b=await backlog(),p=await previewOf(b),index=b.taskIds.indexOf(p.tasks[0].taskId);
 let sawSave!:()=>void,releaseSave!:()=>void,sawEnroll!:()=>void,releaseEnroll!:()=>void,sawReplay!:()=>void;
 const saveSeen=new Promise<void>(r=>sawSave=r),saveReleased=new Promise<void>(r=>releaseSave=r),enrollSeen=new Promise<void>(r=>sawEnroll=r),enrollReleased=new Promise<void>(r=>releaseEnroll=r),replaySeen=new Promise<void>(r=>sawReplay=r);
 let lockCode='';const i=live.installQueryInterceptor();
 i.rules.push(live.rule('FeaturePlan task held',live.sqlTag('feature-plan-mutation:task-lock'),async(_c:any,sql:any,v:any,send:any)=>{const r=await send(sql,v);sawSave();await saveReleased;return r;}));
 i.rules.push(live.rule('enrollment project SHARE held',live.sqlTag('project-roadmap:task-lock'),async(_c:any,sql:any,v:any,send:any)=>{sawEnroll();await enrollReleased;try{return await send(sql,v);}catch(e:any){lockCode=e.code;throw e;}}));
 i.rules.push(live.rule('approval project UPDATE queued',(sql:string)=>sql.includes('project-resources:project-lock')&&sql.includes('for update'),async(_c:any,sql:any,v:any,send:any)=>{sawReplay();return send(sql,v);}));
 try{
 const saving=saveFeature(b,index);await saveSeen;const enrolling=service.enroll({...b.selector,previewFingerprint:p.previewFingerprint});await enrollSeen;const replaying=planning.decide(b.decision);await replaySeen;releaseSave();releaseEnroll();
 assert.equal((await enrolling).status,'unavailable');assert.equal(lockCode,'55P03','NOWAIT conflict, never a deadlock victim');assert.equal((await saving).status,'created');assert.equal((await replaying).status,'ok');
 }finally{releaseSave();releaseEnroll();i.restore();}
 assert.equal((await service.enroll({...b.selector,previewFingerprint:p.previewFingerprint})).status,'ok');
});

test('initial materialization and later Roadmap journaling keep distinct unmodified DB fences',async()=>{
 const b=await backlog('manual_import','pending'),before=await stateCounts(b.f.projectId),i=live.installQueryInterceptor();
 i.rules.push(live.rule('invalid initial status',live.sqlTag('project-planning:create-task'),async(_c:any,sql:any,v:any,send:any)=>send(sql.replace("'draft'","'ready'"),v)));
 try{assert.notEqual((await planning.decide({...b.decision,decision:'approved'})).status,'ok');}finally{i.restore();}assert.deepEqual(await stateCounts(b.f.projectId),before);
 assert.equal((await planning.decide({...b.decision,decision:'approved'})).status,'ok');await enroll(b);const enrolled=await stateCounts(b.f.projectId);
 await assert.rejects(db.admin.query("update project_tasks set status='ready',state_version=state_version+1 where workspace_id=$1 and task_key=$2",[A.id,b.taskIds[0]]),(error:any)=>error.code==='23514'&&error.message==='Roadmap transition requires journal.');assert.deepEqual(await stateCounts(b.f.projectId),enrolled);
});
test('partial per-task journal failure rolls back the complete batch and its milestone',async()=>{
 const b=await backlog(),p=await previewOf(b),before=await stateCounts(b.f.projectId),i=live.installQueryInterceptor();let journals=0;
 i.rules.push(live.rule('second task journal fails',(sql:string)=>sql.includes('/* roadmap:journal */')&&++journals===2,async()=>{throw Error('synthetic second journal failure');}));
 try{assert.notEqual((await service.enroll({...b.selector,previewFingerprint:p.previewFingerprint})).status,'ok');assert.equal(journals,2);}finally{i.restore();}assert.deepEqual(await stateCounts(b.f.projectId),before);
});

test('manual historical enrollment actor remains pinned while a different current Owner can read and admit readiness',async()=>{
 const b=await backlog();await enroll(b);await saveFeature(b);const nextOwner='00000000-0000-4000-8000-000000009202';
 await db.admin.query("insert into users(id,email,name,status)values($1,'owner2@pac.test','Owner Two','active')",[nextOwner]);await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github','9202','active')",[nextOwner]);const m=(await db.admin.query("insert into workspace_members(workspace_id,user_id,status)values($1,$2,'active')returning id",[A.id,nextOwner])).rows[0].id;await db.admin.query('insert into member_role_assignments(member_id,role_id)values($1,$2)',[m,role]);
 const nextSession={pacIdentity:{provider:'github',providerSubject:'9202'}},nextAccess=accessModule.createProjectOwnerAccess({database,domainWorkspaceId:A.domain,session:nextSession}),current=enrollment.createProjectRoadmapEnrollment(nextAccess,{domainWorkspaceId:A.domain,identityFingerprint:contract.planDigest(nextSession.pacIdentity)});
 const read=await current.preview(b.selector);assert.equal(read.status,'ok');assert(read.value.enrolled);const t=read.value.tasks.find((t:any)=>t.taskId===b.taskIds[0]);assert.equal((await current.ready({...b.selector,previewFingerprint:read.value.previewFingerprint,taskId:t.taskId,expectedVersion:t.version,featurePlanId:t.featurePlan.planId,featurePlanRevision:t.featurePlan.revision,featurePlanFingerprint:t.featurePlan.fingerprint})).status,'ok');
 const generated=await backlog('ai_generated');assert.notEqual((await current.preview(generated.selector)).status,'ok');assert.equal(generated.fake.runs(),1);
});

async function originalDependencyEvidence(b:any){
 const projectId=b.f.projectId;
 return{plan:(await db.admin.query('select to_jsonb(p) row from project_planning_drafts p where workspace_id=$1 and project_key=$2',[A.id,projectId])).rows,
 receipt:(await db.admin.query("select to_jsonb(r) row from roadmap_owner_commands r where workspace_id=$1 and result->>'projectId'=$2 and result->>'kind'='project_backlog_enrollment'",[A.id,projectId])).rows,
 events:(await db.admin.query("select to_jsonb(e) row from roadmap_task_events e where workspace_id=$1 and project_key=$2 and event_kind='enrolled' order by task_key",[A.id,projectId])).rows};
}
for(const origin of ['manual_import','ai_generated'])test(origin+': current dependency projection follows authorized versioned removal/addition and preserves original evidence',async()=>{
 const b=await backlog(origin),x=await enroll(b),tenant=await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(A.domain);assert(tenant);
 const ownerModule=await import(new URL('../../lib/roadmap/roadmap-owner-commands.ts',import.meta.url).href),commands=ownerModule.createRoadmapOwnerCommands({database,tenant,identitySource:{resolve:()=>({userId:owner})}}),store=roadmapStore.createRoadmapStore({database,tenant});
 const initial=await originalDependencyEvidence(b),initialPreview=await previewOf(b);assert.equal(initialPreview.dependencyCount,1);assert.deepEqual(initialPreview.tasks.find((t:any)=>t.taskId===b.taskIds[1]).dependencyIds,[b.taskIds[0]]);
 const current=await store.readTask(b.f.projectId,b.taskIds[1]);assert(current);
 const remove={commandId:'dependency-remove-'+(++serial),projectId:b.f.projectId,taskId:b.taskIds[1],expectedVersion:current.version,milestoneId:current.milestoneId,metadata:current.metadata,dependencyIds:[]};
 assert.equal((await commands.enroll(remove)).status,'applied');
 const removed=await previewOf(b),task=removed.tasks.find((t:any)=>t.taskId===b.taskIds[1]);assert.deepEqual(task.dependencyIds,[]);assert.deepEqual(task.dependencies,[]);assert.equal(removed.dependencyCount,0);
 assert.deepEqual(task.originalDependencyIds,[b.taskIds[0]]);assert.equal(removed.originalDependencyCount,1);assert.equal(task.version,current.version+1);
 assert.equal((await commands.enroll({...remove,commandId:'stale-'+(++serial)})).status,'conflict');assert.equal((await commands.enroll({...remove,dependencyIds:[b.taskIds[0]]})).status,'conflict');
 for(const dependencies of [[b.taskIds[0]],[],[b.taskIds[0]]]){const latest=await store.readTask(b.f.projectId,b.taskIds[1]);assert(latest);assert.equal((await commands.enroll({...remove,commandId:'dependency-edit-'+(++serial),expectedVersion:latest.version,dependencyIds:dependencies})).status,'applied');const p=await previewOf(b),t=p.tasks.find((t:any)=>t.taskId===b.taskIds[1]),factual=await store.readTask(b.f.projectId,b.taskIds[1]);assert.deepEqual(t.dependencyIds,factual?.dependencyIds);assert.equal(t.version,factual?.version);assert.equal(p.dependencyCount,dependencies.length);assert.deepEqual(t.dependencies,dependencies.map(taskId=>({taskId,status:'draft'})));}
 assert.equal((await service.enroll(x.intent)).status,'ok');assert.deepEqual(await originalDependencyEvidence(b),initial);assert.equal((await planning.read(b.f.projectId)).status,'ok');if(b.fake)assert.equal(b.fake.runs(),1);
});
test('originally independent task projects newly added current dependencies and factual predecessor state',async()=>{
 const b=await backlog('manual_import','approved',2,p=>{p.tasks[1].dependencyIds=[];}),x=await enroll(b),original=await originalDependencyEvidence(b),tenant=await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(A.domain);assert(tenant);
 const store=roadmapStore.createRoadmapStore({database,tenant}),ownerModule=await import(new URL('../../lib/roadmap/roadmap-owner-commands.ts',import.meta.url).href),commands=ownerModule.createRoadmapOwnerCommands({database,tenant,identitySource:{resolve:()=>({userId:owner})}});
 await saveFeature(b);assert.equal((await service.ready(await readyIntent(b))).status,'ok');const target=await store.readTask(b.f.projectId,b.taskIds[1]);assert(target);
 assert.equal((await commands.enroll({commandId:'dependency-add-'+(++serial),projectId:b.f.projectId,taskId:b.taskIds[1],expectedVersion:target.version,milestoneId:target.milestoneId,metadata:target.metadata,dependencyIds:[b.taskIds[0]]})).status,'applied');
 const reloaded=await previewOf(b),task=reloaded.tasks.find((t:any)=>t.taskId===b.taskIds[1]);assert.deepEqual(task.dependencyIds,[b.taskIds[0]]);assert.deepEqual(task.dependencies,[{taskId:b.taskIds[0],status:'ready'}]);assert.deepEqual(task.originalDependencyIds,[]);assert.equal(reloaded.dependencyCount,1);assert.equal(reloaded.originalDependencyCount,0);
 assert.equal((await service.enroll(x.intent)).status,'ok');assert.deepEqual(await originalDependencyEvidence(b),original);
});

test('current dependency projection fails closed on missing predecessors or inconsistent current journal',async()=>{
 const b=await backlog();await enroll(b);
 for(const tag of ['project-roadmap:dependency-status','roadmap:task-read']){const i=live.installQueryInterceptor();i.rules.push(live.rule('corrupt current projection',live.sqlTag(tag),async(_c:any,sql:any,v:any,send:any)=>{const r=await send(sql,v);return tag==='project-roadmap:dependency-status'?{rowCount:0,rows:[]}:{...r,rows:r.rows.map((row:any)=>({...row,state_version:999}))};}));
 if(tag==='project-roadmap:dependency-status')i.rules.push(live.rule('missing next predecessor',live.sqlTag(tag),async()=>({rowCount:0,rows:[]})));
 try{assert.equal((await service.preview(b.selector)).status,'unavailable');}finally{i.restore();}
 }
});
