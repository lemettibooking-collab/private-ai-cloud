/* eslint-disable @typescript-eslint/no-explicit-any -- fake provider captures canonical runtime requests */
import assert from 'node:assert/strict';
import test from 'node:test';
const live=await import(new URL('./helpers/live-pg.ts',import.meta.url).href);
const pg=await import(new URL('../../lib/db/postgres.ts',import.meta.url).href);
const accessModule=await import(new URL('../../lib/projects/project-owner-access.ts',import.meta.url).href);
const kb=await import(new URL('../../lib/projects/project-knowledge.ts',import.meta.url).href);
const composition=await import(new URL('../../lib/composition/owner-project-planning-generation.ts',import.meta.url).href);
const mock=await import(new URL('../../lib/providers/deterministic-mock-model-provider.ts',import.meta.url).href);
const db=await live.useLiveDatabase('generatedapproval'),A=live.primaryWorkspace;
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
const planningModule=await import(new URL('../../lib/planning/project-planning.ts',import.meta.url).href);
const contract=await import(new URL('../../lib/planning/project-planning-contract.ts',import.meta.url).href);
const planning=planningModule.createProjectPlanning(access,{domainWorkspaceId:A.domain,identityFingerprint:contract.planDigest(session.pacIdentity)});
async function generated(count=1,text=plan(count),mode='success'){
 const f=await fixture(count),fake=provider(text,mode),s=service(fake),input=await offer(s,f),result=await s.generate(input);
 return{f,fake,s,input,result,intent:{projectId:f.projectId,operationKey:input.operationKey,planFingerprint:contract.planDigest(result.proposal??null),expectedRevision:0}};
}
test('generated one/four source save, reload, approval and replay preserve exact plan and mapping',async()=>{
 for(const n of [1,4]){const g=await generated(n);assert.equal(g.result.status,'proposal_available');
 const saved=await planning.saveGenerated(g.intent);assert.equal(saved.status,'ok');
 const read=await planning.read(g.f.projectId);assert.equal(read.status,'ok');assert.equal(read.value.selected.origin,'ai_generated');assert.deepEqual(read.value.selected.sources,g.f.sources);assert.deepEqual(read.value.selected.plan,g.result.proposal);
 const decision={projectId:g.f.projectId,revision:1,planFingerprint:g.intent.planFingerprint,decision:'approved'};
 assert.equal((await planning.decide(decision)).status,'ok');assert.equal((await planning.decide(decision)).status,'ok');assert.equal((await planning.saveGenerated(g.intent)).status,'ok');
 assert.equal((await db.admin.query('select count(*)::int n from project_tasks where workspace_id=$1 and project_key=$2',[A.id,g.f.projectId])).rows[0].n,1);assert.equal(g.fake.runs(),1);
 }
});
test('save rejects forged fingerprint, project, unknown output and unauthorized identity',async()=>{
 const g=await generated();assert.notEqual((await planning.saveGenerated({...g.intent,planFingerprint:'a'.repeat(64)})).status,'ok');
 assert.notEqual((await planning.saveGenerated({...g.intent,projectId:'missing-project'})).status,'ok');
 for(const [text,mode] of [['{}','success'],[plan(),'unknown']]){const x=await generated(1,text,mode);assert.notEqual((await planning.saveGenerated({...x.intent,planFingerprint:'a'.repeat(64)})).status,'ok');}
 const other=planningModule.createProjectPlanning(access,{domainWorkspaceId:A.domain,identityFingerprint:'b'.repeat(64)});assert.notEqual((await other.saveGenerated(g.intent)).status,'ok');
});
test('concurrent generated saves create one pending draft and no tasks',async()=>{
 const g=await generated();const r=await Promise.all(Array.from({length:5},()=>planning.saveGenerated(g.intent)));assert(r.every(v=>v.status==='ok'));
 assert.equal((await db.admin.query('select count(*)::int n from project_planning_drafts where workspace_id=$1 and project_key=$2',[A.id,g.f.projectId])).rows[0].n,1);
 assert.equal((await db.admin.query('select count(*)::int n from project_tasks where workspace_id=$1 and project_key=$2',[A.id,g.f.projectId])).rows[0].n,0);
});
test.after(async()=>{await database.close();});
async function facts(projectId:string){
 const out:any={};for(const table of ['project_planning_drafts','project_planning_task_links','project_tasks'])out[table]=(await db.admin.query(`select count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) digest from ${table} t where workspace_id=$1 and project_key=$2`,[A.id,projectId])).rows[0];
 return out;
}
const decisionOf=(g:any,revision=1,decision='approved')=>({projectId:g.f.projectId,revision,planFingerprint:g.intent.planFingerprint,decision});
test('historical exact source versions, normalized multi-source references and dependencies survive approval',async()=>{
 const raw=JSON.parse(plan(4));raw.tasks[0].sourceReferences=[3,0];raw.tasks.push({...raw.tasks[0],id:'task-2',dependencyIds:['task-1'],sourceReferences:[2,1]});
 const g=await generated(4,JSON.stringify(raw));assert.equal(g.result.status,'proposal_available');
 assert.equal((await knowledge.upload({projectId:g.f.projectId,filename:'source-0.md',expectedVersion:1,requestId:'later-source',bytes:Buffer.from('later')})).status,'ok');
 assert.equal((await planning.saveGenerated(g.intent)).status,'ok');assert.equal((await planning.decide(decisionOf(g))).status,'ok');
 const r=await planning.read(g.f.projectId);assert.equal(r.status,'ok');assert.deepEqual(r.value.selected.plan,g.result.proposal);assert.deepEqual(r.value.selected.sources,g.f.sources);
 assert.equal(r.value.selected.tasks.length,2);assert.equal((await db.admin.query('select count(*)::int n from roadmap_task_dependencies where workspace_id=$1 and project_key=$2',[A.id,g.f.projectId])).rows[0].n,0);
 assert.equal(g.fake.runs(),1);
});
test('current Owner, original identity and active project required for generated save and decisions',async()=>{
 const g=await generated();await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github','9199','active')",[owner]);
 const otherAccess=accessModule.createProjectOwnerAccess({database,domainWorkspaceId:A.domain,session:{pacIdentity:{provider:'github',providerSubject:'9199'}}});
 const alternate=planningModule.createProjectPlanning(otherAccess,{domainWorkspaceId:A.domain,identityFingerprint:contract.planDigest({provider:'github',providerSubject:'9199'})});
 assert.notEqual((await alternate.saveGenerated(g.intent)).status,'ok');
 for(const phase of ['save','decide']){
 if(phase==='decide')assert.equal((await planning.saveGenerated(g.intent)).status,'ok');
 const invoke=()=>phase==='save'?planning.saveGenerated(g.intent):planning.decide(decisionOf(g));
 for(const mode of ['identity','member','project']){
 const sql=mode==='identity'?"update auth_identities set status=$1 where provider_subject='9101'":mode==='member'?'update workspace_members set status=$1 where id=$2':'update projects set status=$1 where workspace_id=$2 and project_key=$3';
 const args=mode==='identity'?[]:mode==='member'?[member]:[A.id,g.f.projectId];
 await db.admin.query(sql,[mode==='project'?'paused':'disabled',...args]);try{assert.notEqual((await invoke()).status,'ok');}finally{await db.admin.query(sql,['active',...args]);}
 }
 if(phase==='decide')assert.notEqual((await alternate.decide(decisionOf(g))).status,'ok');
 }
});
test('manual/generated revision allocation and approval races share one project sequence',async()=>{
 const g=await generated();const text=JSON.parse(plan());text.title='Manual alternative';
 const upload=await knowledge.upload({projectId:g.f.projectId,filename:'manual.md',expectedVersion:0,requestId:'manual-race',bytes:Buffer.from('```pac-plan-v1\n'+JSON.stringify(text)+'\n```')});assert.equal(upload.status,'ok');
 const selector={projectId:g.f.projectId,filename:'manual.md',version:1,sourceSha256:upload.value.document.sha256};
 const preview=await planning.preview(selector);assert.equal(preview.status,'ok');
 const intent={...selector,previewFingerprint:preview.value.previewFingerprint,expectedRevision:0};
 const race=await Promise.all([planning.saveGenerated(g.intent),planning.save(intent)]);assert.equal(race.filter(v=>v.status==='ok').length,1);
 const firstGenerated=race[0].status==='ok';assert.equal((await(firstGenerated?planning.save({...intent,expectedRevision:1}):planning.saveGenerated({...g.intent,expectedRevision:1}))).status,'ok');
 const old={projectId:g.f.projectId,revision:1,planFingerprint:firstGenerated?g.intent.planFingerprint:contract.planDigest(preview.value.validation.plan),decision:'approved'};
 assert.equal((await planning.decide(old)).status,'conflict');
 const latest={...old,revision:2,planFingerprint:firstGenerated?contract.planDigest(preview.value.validation.plan):g.intent.planFingerprint};
 const votes=await Promise.all([planning.decide(latest),planning.decide({...latest,decision:'rejected'})]);assert.equal(votes.filter(v=>v.status==='ok').length,1);
 assert.equal((await planning.decide({...old,decision:'rejected'})).status,'ok','historical pending rejection remains allowed');
});
test('audit failure and lost commit reconcile generated save/approval without partial tasks',async()=>{
 for(const phase of ['save','approve']){
 const g=await generated();if(phase==='approve')assert.equal((await planning.saveGenerated(g.intent)).status,'ok');
 const invoke=()=>phase==='save'?planning.saveGenerated(g.intent):planning.decide(decisionOf(g));const before=await facts(g.f.projectId);
 const fail=live.installQueryInterceptor();fail.rules.push(live.rule('audit failure',live.sqlTag('project-planning:audit'),async()=>{throw Error('synthetic failure');}));
 try{assert.notEqual((await invoke()).status,'ok');}finally{fail.restore();}assert.deepEqual(await facts(g.f.projectId),before);
 const lost=live.installQueryInterceptor();lost.rules.push(live.rule('lost commit',live.sqlTag('task-mutation:commit'),async(_c:any,sql:any,v:any,send:any)=>{await send(sql,v);throw Error('synthetic lost acknowledgment');}));
 try{assert.notEqual((await invoke()).status,'ok');}finally{lost.restore();}
 const replay=await invoke();assert.equal(replay.status,'ok');assert.equal(replay.value.outcome,'replayed');assert.equal(g.fake.runs(),1);
 }
});
test('task collision rolls entire generated approval back',async()=>{
 const g=await generated();assert.equal((await planning.saveGenerated(g.intent)).status,'ok');
 await db.admin.query("insert into project_tasks(workspace_id,project_key,task_key,title,task_type,status,created_by)values($1,$2,$3,'Collision','feature','draft',$4)",[A.id,g.f.projectId,contract.planningTaskKey(g.f.projectId,'task-1'),owner]);
 const before=await facts(g.f.projectId);assert.notEqual((await planning.decide(decisionOf(g))).status,'ok');assert.deepEqual(await facts(g.f.projectId),before);
 const r=await planning.read(g.f.projectId);assert.equal(r.value.selected.status,'draft');
});
test('SQL rejects invalid origins, mismatched provenance, immutable edits and direct terminal insertion',async()=>{
 const g=await generated();assert.equal((await planning.saveGenerated(g.intent)).status,'ok');
 const row=(await db.admin.query('select * from project_planning_drafts where workspace_id=$1 and project_key=$2',[A.id,g.f.projectId])).rows[0];
 for(const change of ["origin='unknown'","generation_id=null","generation_request_fingerprint=repeat('a',64)","generation_manifest='[]'::jsonb","status='approved'","plan_json='{}'::jsonb"]){await assert.rejects(db.admin.query(`update project_planning_drafts set ${change} where id=$1`,[row.id]));}
 const columns=['workspace_id','project_key','revision','source_fingerprint','plan_json','plan_fingerprint','approval_request_id','created_by','origin','generation_id','generation_request_fingerprint','generation_output_fingerprint','generation_manifest','validation_version','save_expected_revision','status'];
 for(const patch of [{origin:'unknown'},{generation_request_fingerprint:'a'.repeat(64)},{generation_output_fingerprint:null},{generation_manifest:[]},{plan_json:{...g.result.proposal,title:'Forged'}},{status:'approved'}]){
 const values={...row,...patch,id:undefined,revision:2,save_expected_revision:1};await assert.rejects(db.admin.query(`insert into project_planning_drafts(${columns.join(',')})values(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(k=>['plan_json','generation_manifest'].includes(k)?JSON.stringify(values[k]):values[k])),(e:any)=>e.code==='23514');
 }
});
test('historical save/read/approval require no current policy or new provider request',async()=>{
 const g=await generated();const calls=g.fake.runs();
 // The approval service has no provider, credential or current-policy dependency at all.
 assert.equal((await planning.saveGenerated(g.intent)).status,'ok');assert.equal((await planning.decide(decisionOf(g,1,'rejected'))).status,'ok');
 assert.equal((await planning.decide(decisionOf(g,1,'rejected'))).status,'ok');assert.equal((await planning.decide(decisionOf(g))).status,'conflict');assert.equal((await planning.read(g.f.projectId)).status,'ok');assert.equal(g.fake.runs(),calls);
});

test('forged durable output/source snapshots deny save and approval with unchanged state',async()=>{
 for(const phase of ['save','decide'])for(const tag of ['project-generation:result','project-generation:sources']){
 const g=await generated(4);if(phase==='decide')assert.equal((await planning.saveGenerated(g.intent)).status,'ok');
 const before=await facts(g.f.projectId),i=live.installQueryInterceptor();
 i.rules.push(live.rule('forged evidence',live.sqlTag(tag),async(_c:any,sql:any,v:any,send:any)=>{const r=await send(sql,v);return{...r,rows:r.rows.map((row:any)=>tag.endsWith('result')?{...row,output_text:'{}'}:{...row,sha256:'b'.repeat(64)})};}));
 try{assert.notEqual((await(phase==='save'?planning.saveGenerated(g.intent):planning.decide(decisionOf(g)))).status,'ok');}finally{i.restore();}
 assert.deepEqual(await facts(g.f.projectId),before);assert.equal(g.fake.runs(),1);
 }
});
test('durable operation reload retains exact save selector for historical idempotent replay',async()=>{
 const g=await generated();assert.equal((await planning.saveGenerated(g.intent)).status,'ok');
 const r=await g.s.read(g.f.projectId,g.input.operationKey);assert.equal(r.status,'proposal_available');assert.equal(r.expectedRevision,0);
 assert.equal((await planning.saveGenerated({...g.intent,expectedRevision:r.expectedRevision})).status,'ok');
 assert.equal((await planning.saveGenerated({...g.intent,expectedRevision:1})).status,'conflict');
});
test('0028 populated manual upgrade preserves approved/pending rows and original bytes',async t=>{
 const{readFileSync,readdirSync}=await import('node:fs');const{randomBytes}=await import('node:crypto');
 const maintenance=live.adminClient(live.databaseUrl('postgres'));await maintenance.connect();
 const name='aipc_pgtest_plan04_upgrade_'+randomBytes(5).toString('hex');await maintenance.query(`create database "${name}"`);
 const url=live.databaseUrl(name),admin=live.adminClient(url);await admin.connect();const database=pg.createWorkflowRuntimePostgresDatabase({connectionString:url,maxConnections:2});
 t.after(async()=>{await database.close();await admin.end();await maintenance.query(`drop database "${name}" with (force)`);await maintenance.end();});
 const root=new URL('../../',import.meta.url);for(const f of readdirSync(new URL('db/migrations/',root)).filter(f=>f.endsWith('.sql')&&f<'0028').sort())await admin.query(readFileSync(new URL('db/migrations/'+f,root),'utf8'));
 for(const f of readdirSync(new URL('db/seeds/',root)).filter(f=>f.endsWith('.sql')).sort())await admin.query(readFileSync(new URL('db/seeds/'+f,root),'utf8'));
 await live.insertWorkspace(admin,A);await admin.query("insert into users(id,email,name,status)values($1,'upgrade@pac.test','Owner','active')",[owner]);await admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github','9101','active')",[owner]);
 const m=(await admin.query("insert into workspace_members(workspace_id,user_id,status)values($1,$2,'active')returning id",[A.id,owner])).rows[0].id;
 const r=(await admin.query("insert into roles(workspace_id,code,name)values($1,'owner','Owner')returning id",[A.id])).rows[0].id;await admin.query('insert into member_role_assignments(member_id,role_id)values($1,$2)',[m,r]);
 const a=accessModule.createProjectOwnerAccess({database,domainWorkspaceId:A.domain,session}),p=planningModule.createProjectPlanning(a),k=kb.createProjectKnowledge(a);
 const decisions=[];
 for(const projectId of ['upgrade-approved','upgrade-pending']){
 await admin.query('insert into projects(workspace_id,project_key,display_name)values($1,$2,$2)',[A.id,projectId]);
 const up=await k.upload({projectId,filename:'manual.md',expectedVersion:0,requestId:projectId,bytes:Buffer.from('```pac-plan-v1\n'+plan()+'\n```')});assert.equal(up.status,'ok');
 const selector={projectId,filename:'manual.md',version:1,sourceSha256:up.value.document.sha256},preview=await p.preview(selector);assert.equal(preview.status,'ok');
 assert.equal((await p.save({...selector,previewFingerprint:preview.value.previewFingerprint,expectedRevision:0})).status,'ok');
 const d={projectId,revision:1,planFingerprint:contract.planDigest(preview.value.validation.plan),decision:'approved'};decisions.push(d);if(projectId==='upgrade-approved')assert.equal((await p.decide(d)).status,'ok');
 }
 const old=(await admin.query('select to_jsonb(p) row from project_planning_drafts p order by project_key')).rows;
 await admin.query(readFileSync(new URL('db/migrations/0028_project_planning_generated_drafts.sql',root),'utf8'));
 const added=['origin','generation_id','generation_request_fingerprint','generation_output_fingerprint','generation_manifest','validation_version','save_expected_revision'];
 assert.deepEqual((await admin.query('select to_jsonb(p)-$1::text[] row from project_planning_drafts p order by project_key',[added])).rows,old);
 assert((await admin.query('select origin from project_planning_drafts')).rows.every((r:any)=>r.origin==='manual_import'));
 assert.equal((await p.decide(decisions[0])).status,'ok');assert.equal((await p.decide({...decisions[1],decision:'rejected'})).status,'ok');
});

test('numeric lexemes preserve durable save approval replay and exact fingerprints',async()=>{
 const cases=['1.'+'0'.repeat(40000)+'1','1.0000000000000001','2.4703282292062327e-324','-2.4703282292062327e-324','1e-400','-0','-1e-400','1','1.0','10e-1','1e-999999999999999999999999','-1e-999999999999999999999999','1.00000000000000011102230246251565404236316680908203125','0.999999999999999944488848768742172978818416595458984375','2.0000000000000002220446049250313080847263336181640625','3.0000000000000002220446049250313080847263336181640625'];
 for(const token of cases){
  const text=plan(4).replace('"sourceReferences":[3]',`"sourceReferences":[${token}]`),g=await generated(4,text);
  assert.equal(g.result.status,'proposal_available',token);
  const durable=await g.s.read(g.f.projectId,g.input.operationKey);assert.equal(durable.status,'proposal_available',token);
  assert.equal((await planning.saveGenerated(g.intent)).status,'ok',token);
  assert.equal((await planning.decide(decisionOf(g))).status,'ok',token);
  assert.equal((await planning.decide(decisionOf(g))).status,'ok',token);
  assert.equal((await planning.saveGenerated(g.intent)).status,'ok',token);
  const output=await db.admin.query('select o.output_text,o.output_fingerprint,g.plan_fingerprint from project_planning_generations g join workflow_runs r on r.workspace_id=g.workspace_id and r.runtime_id=g.run_id join workflow_model_invocation_results o on o.workspace_id=r.workspace_id and o.workflow_run_id=r.id where g.workspace_id=$1 and g.project_key=$2',[A.id,g.f.projectId]);
  assert.equal(output.rows[0].output_text,text);assert.equal(output.rows[0].output_fingerprint,'sha256:'+ (await import('node:crypto')).createHash('sha256').update(text).digest('hex'));
  assert.equal(output.rows[0].plan_fingerprint,g.intent.planFingerprint);assert.equal(g.fake.runs(),1);
 }
});
test('numeric SQL normalization rejects different references and preserves sorted evidence',async()=>{
 for(const token of ['0.5','2.4703282292062328e-324','-2.4703282292062328e-324','1.0000000000000002','-1','4','1e9999999999999999999','"1"','null','true','{}','[]']){
  await assert.rejects(db.admin.query('select normalize_generated_planning_output($1,4)',[plan(4).replace('"sourceReferences":[3]',`"sourceReferences":[${token}]`)]),token);
  const g=await generated(4,plan(4).replace('"sourceReferences":[3]',`"sourceReferences":[${token}]`));assert.equal(g.result.status,'invalid_output',token);
 }
 await assert.rejects(db.admin.query('select normalize_generated_planning_output($1,4)',[plan(4).replace('[3]','[1,1.0000000000000001]')]));
 const raw=plan(4).replace('[3]','[3,1.0000000000000001,-0]'),g=await generated(4,raw);assert.equal((await planning.saveGenerated(g.intent)).status,'ok');assert.equal((await planning.decide(decisionOf(g))).status,'ok');
 assert.deepEqual(JSON.parse(JSON.stringify(g.result.proposal.tasks[0].sourceReferences)),[0,1,3]);
 const normalized=(await db.admin.query('select normalize_generated_planning_output($1,4) p',[raw])).rows[0].p;assert.deepEqual(normalized,JSON.parse(JSON.stringify(g.result.proposal)));
 assert.notDeepEqual(normalized,{...normalized,tasks:[{...normalized.tasks[0],sourceReferences:[0,2,3]}]});
});

test('0028 to 0029 populated upgrade preserves drafts and saves an older durable numeric generation',async()=>{
 const{readFileSync}=await import('node:fs');
 const old=readFileSync(new URL('../../db/migrations/0028_project_planning_generated_drafts.sql',import.meta.url),'utf8');
 const corrective=readFileSync(new URL('../../db/migrations/0029_project_planning_numeric_normalization.sql',import.meta.url),'utf8');
 await db.admin.query(old.slice(old.indexOf('create or replace function guard_project_planning_draft()'),old.indexOf('-- Generated evidence and audit')));
 await db.admin.query('drop function normalize_generated_planning_output(text,integer)');await db.admin.query('drop function planning_source_reference(text,integer)');
 try{
 const existing=await generated();assert.equal((await planning.saveGenerated(existing.intent)).status,'ok');assert.equal((await planning.decide(decisionOf(existing))).status,'ok');
 const pending=await generated();assert.equal((await planning.saveGenerated(pending.intent)).status,'ok');
 const f=await fixture(),up=await knowledge.upload({projectId:f.projectId,filename:'manual.md',expectedVersion:0,requestId:'corrective-manual',bytes:Buffer.from('```pac-plan-v1\n'+plan()+'\n```')});assert.equal(up.status,'ok');
 const selector={projectId:f.projectId,filename:'manual.md',version:1,sourceSha256:up.value.document.sha256},preview=await planning.preview(selector);assert.equal(preview.status,'ok');assert.equal((await planning.save({...selector,previewFingerprint:preview.value.previewFingerprint,expectedRevision:0})).status,'ok');
 const durable=await generated(4,plan(4).replace('[3]','[1.0000000000000001]'));assert.equal(durable.result.status,'proposal_available');assert.equal((await planning.saveGenerated(durable.intent)).status,'unavailable');
 const before=(await db.admin.query('select to_jsonb(p) row from project_planning_drafts p order by id')).rows;
 await db.admin.query(corrective);
 assert.deepEqual((await db.admin.query('select to_jsonb(p) row from project_planning_drafts p order by id')).rows,before);
 assert.equal((await planning.saveGenerated(durable.intent)).status,'ok');assert.equal((await planning.decide(decisionOf(durable))).status,'ok');assert.equal((await planning.decide(decisionOf(existing))).status,'ok');assert.equal((await planning.decide(decisionOf(pending,1,'rejected'))).status,'ok');assert.equal(durable.fake.runs(),1);
 }finally{
 // Restore helpers if an assertion failed before migration application.
 const exists=await db.admin.query("select to_regprocedure('planning_source_reference(text,integer)') f");if(!exists.rows[0].f)await db.admin.query(corrective);
 }
});

test('forged normalized reference cannot pass the generated SQL draft guard',async()=>{
 const g=await generated(4,plan(4).replace('[3]','[1.0000000000000001]')),before=await facts(g.f.projectId),i=live.installQueryInterceptor();
 i.rules.push(live.rule('forged normalized reference',live.sqlTag('project-planning:generated-save'),async(_c:any,sql:any,v:any,send:any)=>{const changed=[...v],p=JSON.parse(changed[4]);p.tasks[0].sourceReferences=[2];changed[4]=JSON.stringify(p);return send(sql,changed);}));
 try{assert.equal((await planning.saveGenerated(g.intent)).status,'unavailable');}finally{i.restore();}
 assert.deepEqual(await facts(g.f.projectId),before);assert.equal(g.fake.runs(),1);
});

// Run real pre-correction generation/validation modules in a temporary import tree.
// No SQL guard disabling, terminal inserts or immutable-evidence rewriting.
async function historicalService(fake:ReturnType<typeof provider>,overrides:Record<string,unknown>={}){
 const {execFileSync}=await import('node:child_process');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,resolve,dirname}=await import('node:path');
 const {fileURLToPath,pathToFileURL}=await import('node:url');
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'pac-unicode-history-'));
 const paths=['lib/planning/project-planning-contract.ts','lib/planning/project-planning-generation.ts','lib/composition/owner-project-planning-generation.ts'];
 const mapped=new Map(paths.map((p,i)=>[resolve(root,p),join(dir,`historical-${i}.ts`)]));
 try{
 for(const p of paths){
  const original=execFileSync('git',['show',`2e1812685ba8c5fb616225db81fcddf9cc53cc46:${p}`],{cwd:root,encoding:'utf8'});
  const rewritten=original.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/gu,(_all,a,relative,z)=>{
   const absolute=resolve(root,dirname(p),relative);return a+(mapped.get(absolute)??absolute)+z;
  });
  writeFileSync(mapped.get(resolve(root,p))!,rewritten);
 }
 const legacy=await import(pathToFileURL(mapped.get(resolve(root,paths[2]))!).href);
 return legacy.createProjectPlanningGeneration({database,domainWorkspaceId:A.domain,session,policy:()=>policy,provider:fake.p,...overrides});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
async function unicodeEvidence(projectId:string){
 return(await db.admin.query(`select to_jsonb(g) generation,to_jsonb(o) result,
 (select jsonb_agg(to_jsonb(a) order by a.id) from audit_events a where a.workspace_id=g.workspace_id and a.entity_id=g.id) audits
 from project_planning_generations g join workflow_runs r on r.workspace_id=g.workspace_id and r.runtime_id=g.run_id
 join workflow_model_invocation_results o on o.workspace_id=r.workspace_id and o.workflow_run_id=r.id
 where g.workspace_id=$1 and g.project_key=$2`,[A.id,projectId])).rows;
}
test('new Unicode-invalid output settles invalid_output with factual output and no draft',async()=>{
 for(const title of ['\ud800','\udc00','a\ud800z','\udc00\ud800','a\0b','a\u0001b']){
 const raw=JSON.parse(plan());raw.title=title;const text=JSON.stringify(raw),g=await generated(1,text);
 assert.equal(g.result.status,'invalid_output');assert.equal(g.result.proposal,null);assert(g.result.findings.length>0);
 const read=await g.s.read(g.f.projectId,g.input.operationKey);assert.equal(read.status,'invalid_output');assert.deepEqual(read.findings,g.result.findings);
 const e=await unicodeEvidence(g.f.projectId);assert.equal(e[0].result.output_text,text);assert.equal(e[0].generation.output_fingerprint,'sha256:'+(await import('node:crypto')).createHash('sha256').update(text).digest('hex'));
 assert.equal(e[0].generation.plan_fingerprint,null);assert.equal((await facts(g.f.projectId)).project_planning_drafts.n,0);assert.equal(g.fake.runs(),1);
 }
});
test('historical unsupported Unicode verifies original evidence before projecting and never saves',async()=>{
 for(const title of ['\ud800','\udc00','a\ud800z','\udc00\ud800']){
 const f=await fixture(),raw=JSON.parse(plan());raw.title=title;const text=JSON.stringify(raw),fake=provider(text),legacy=await historicalService(fake),input=await offer(legacy,f);
 const original=await legacy.generate(input);assert.equal(original.status,'proposal_available');
 const before=await unicodeEvidence(f.projectId),counts=await facts(f.projectId);
 const approvals=(await db.admin.query('select count(*)::int n from approval_requests where workspace_id=$1',[A.id])).rows[0].n;
 const current=service(fake),read=await current.read(f.projectId,input.operationKey);
 assert.equal(read.status,'proposal_encoding_unsupported');assert.equal(read.storedStatus,'proposal_available');assert.equal(read.proposal,null);
 const intent={projectId:f.projectId,operationKey:input.operationKey,planFingerprint:contract.planDigest(original.proposal),expectedRevision:0};
 for(let n=0;n<2;n++)assert.notEqual((await planning.saveGenerated(intent)).status,'ok');
 assert.deepEqual(await facts(f.projectId),counts);assert.deepEqual(await unicodeEvidence(f.projectId),before);
 assert.equal((await db.admin.query('select count(*)::int n from approval_requests where workspace_id=$1',[A.id])).rows[0].n,approvals);assert.equal(fake.runs(),1);
 for(const tag of ['project-generation:result','project-generation:evidence','project-generation:read']){
 const i=live.installQueryInterceptor();i.rules.push(live.rule('tampered historical Unicode',live.sqlTag(tag),async(_c:any,sql:any,v:any,send:any)=>{const r=await send(sql,v);return{...r,rows:r.rows.map((row:any)=>tag.endsWith('result')?{...row,output_text:'{}'}:tag.endsWith('read')?{...row,plan_fingerprint:'a'.repeat(64)}:{...row,metadata:{}})};}));
 try{assert.equal((await current.read(f.projectId,input.operationKey)).status,'recovery_required');assert.notEqual((await planning.saveGenerated(intent)).status,'ok');}finally{i.restore();}
 }
 }
});
test('historical multilingual and supplementary proposals remain saveable and approvable',async()=>{
 for(const title of ['𐐀 😀','Проверка проекта','日本語 العربية Français']){
 const f=await fixture(),raw=JSON.parse(plan());raw.title=title;const fake=provider(JSON.stringify(raw)),legacy=await historicalService(fake),input=await offer(legacy,f),original=await legacy.generate(input);assert.equal(original.status,'proposal_available');
 const before=await unicodeEvidence(f.projectId);const read=await service(fake).read(f.projectId,input.operationKey);assert.equal(read.status,'proposal_available');assert.equal(read.proposal.title,title);
 const intent={projectId:f.projectId,operationKey:input.operationKey,planFingerprint:contract.planDigest(original.proposal),expectedRevision:0};assert.equal((await planning.saveGenerated(intent)).status,'ok');assert.equal((await planning.decide({projectId:f.projectId,revision:1,planFingerprint:intent.planFingerprint,decision:'approved'})).status,'ok');
 assert.deepEqual(await unicodeEvidence(f.projectId),before);assert.equal(fake.runs(),1);
 }
});

test('Unicode-invalid fake OpenAI output retains incurred cost, raw evidence and one invocation',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const root=await mkdtemp('/private/tmp/pac-unicode-api-');
 const credentialModule=await import(new URL('../../lib/integrations/openai-api/openai-api-credential-store.ts',import.meta.url).href);
 const credentials=credentialModule.createOpenAIApiCredentialStore(root+'/credentials');
 try{
 const limits={model:'gpt-test-2026-01-01',maxContextBytes:100000,maxInputTokens:1000,maxOutputTokens:1000,maxInvocationCostUsdMicros:1000,dailyBudgetUsdMicros:10000};const actor={ownerUserId:owner,domainWorkspaceId:A.domain};
 await credentials.save(actor,'sk-synthetic-test-only-000000000',limits);const credential=await credentials.facts(actor);
 const apiIdentity={providerId:'openai',providerKind:'openai',deploymentId:'planning-openai',providerModelId:limits.model,providerRequestModelId:limits.model,providerModelVersion:limits.model};
 const apiPolicy={...policy,version:2,destination:'https://api.openai.com/v1/responses',identity:apiIdentity,api:{mode:'fake_sdk_only',credentialGeneration:credential.generation,limits,pricing:{model:limits.model,inputUsdMicrosPerMillionTokens:100,outputUsdMicrosPerMillionTokens:200,verifiedAt:Date.now()-1000,expiresAt:Date.now()+60000,source:'https://developers.openai.com/api/docs/pricing'},maxPreflightCostUsdMicros:10}};
 let counts=0,runs=0;const raw=JSON.parse(plan());raw.title='Invalid\ud800';const text=JSON.stringify(raw);
 const fake={mode:'fake_sdk_only',credentials,createClient(){return{models:{async retrieve(){throw Error('unexpected discovery');}},responses:{inputTokens:{async count(){counts++;return{object:'response.input_tokens',input_tokens:10};}},async create(){runs++;return{service_tier:'default',model:limits.model,status:'completed',error:null,incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}};}}};}};
 const s=composition.createProjectPlanningGeneration({database,domainWorkspaceId:A.domain,session,policy:()=>apiPolicy,provider:{identity},openAIFake:fake});const f=await fixture(),input=await offer(s,f),result=await s.generate(input);
 assert.equal(result.status,'invalid_output');const before=await unicodeEvidence(f.projectId);assert.equal(before[0].result.output_text,text);assert.equal(before[0].generation.status,'invalid_output');
 assert.deepEqual((await db.admin.query('select state,actual_cost_usd_micros::text cost from project_planning_api_reservations where workspace_id=$1 and project_key=$2',[A.id,f.projectId])).rows,[{state:'settled',cost:'12'}]);
 assert.equal((await s.read(f.projectId,input.operationKey)).status,'invalid_output');assert.equal((await s.generate(input)).status,'invalid_output');assert.equal(counts,1);assert.equal(runs,1);assert.deepEqual(await unicodeEvidence(f.projectId),before);assert.equal((await facts(f.projectId)).project_planning_drafts.n,0);
 const historical=await historicalService(provider(text),{policy:()=>apiPolicy,openAIFake:fake}),hf=await fixture(),hi=await offer(historical,hf),hr=await historical.generate(hi);assert.equal(hr.status,'proposal_available');
 const he=await unicodeEvidence(hf.projectId),reservation=await db.admin.query('select to_jsonb(r) row from project_planning_api_reservations r where workspace_id=$1 and project_key=$2',[A.id,hf.projectId]);
 assert.equal(reservation.rows[0].row.state,'settled');assert.equal(String(reservation.rows[0].row.actual_cost_usd_micros),'12');
 assert.equal((await s.read(hf.projectId,hi.operationKey)).status,'proposal_encoding_unsupported');
 assert.notEqual((await planning.saveGenerated({projectId:hf.projectId,operationKey:hi.operationKey,planFingerprint:contract.planDigest(hr.proposal),expectedRevision:0})).status,'ok');
 assert.deepEqual(await unicodeEvidence(hf.projectId),he);assert.deepEqual((await db.admin.query('select to_jsonb(r) row from project_planning_api_reservations r where workspace_id=$1 and project_key=$2',[A.id,hf.projectId])).rows,reservation.rows);assert.equal(counts,2);assert.equal(runs,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('manual Unicode imports retain valid title content and reject invalid title escapes',async()=>{
 for(const title of ['План 😀','日本語 العربية','\ud800','a\udc00z']){
 const f=await fixture(),raw=JSON.parse(plan());raw.title=title;const up=await knowledge.upload({projectId:f.projectId,filename:'manual.md',expectedVersion:0,requestId:'unicode-manual-'+serial,bytes:Buffer.from('```pac-plan-v1\n'+JSON.stringify(raw)+'\n```')});assert.equal(up.status,'ok');
 const selector={projectId:f.projectId,filename:'manual.md',version:1,sourceSha256:up.value.document.sha256},preview=await planning.preview(selector);assert.equal(preview.status,'ok');
 if(title.includes('\ud800')||title.includes('\udc00'))assert.equal(preview.value.validation.plan,null);
 else{assert.equal(preview.value.validation.plan.title,title);assert.equal((await planning.save({...selector,previewFingerprint:preview.value.previewFingerprint,expectedRevision:0})).status,'ok');assert.equal((await planning.read(f.projectId)).value.selected.plan.title,title);}
 }
});
