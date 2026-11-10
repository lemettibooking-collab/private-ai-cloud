import assert from "node:assert/strict";
import {test} from "node:test";
// @ts-expect-error Direct Node execution requires the fixture extension.
import {representativeProjectPlan,markdownProjectPlan,yamlProjectPlan} from "../fixtures/project-planning.mts";
const live=(await import(new URL("./helpers/live-pg.ts",import.meta.url).href)) as typeof import("./helpers/live-pg");
const pg=(await import(new URL("../../lib/db/postgres.ts",import.meta.url).href)) as typeof import("../../lib/db/postgres");
const access=(await import(new URL("../../lib/projects/project-owner-access.ts",import.meta.url).href)) as typeof import("../../lib/projects/project-owner-access");
const kb=(await import(new URL("../../lib/projects/project-knowledge.ts",import.meta.url).href)) as typeof import("../../lib/projects/project-knowledge");
const domain=(await import(new URL("../../lib/planning/project-planning.ts",import.meta.url).href)) as typeof import("../../lib/planning/project-planning");
const contract=(await import(new URL("../../lib/planning/project-planning-contract.ts",import.meta.url).href)) as typeof import("../../lib/planning/project-planning-contract");
const db=await live.useLiveDatabase("projectplanning");const A=live.primaryWorkspace,B=live.secondaryWorkspace;await live.insertWorkspace(db.admin,A);await live.insertWorkspace(db.admin,B);
const owner="00000000-0000-4000-8000-000000008101",member="00000000-0000-4000-8000-000000008102",other="00000000-0000-4000-8000-000000008103";
let ownerMember="",ownerRole="";
for(const[id,subject,workspace,isOwner]of [[owner,"8101",A.id,true],[member,"8102",A.id,false],[other,"8103",B.id,true]] as const){
 await db.admin.query("insert into users(id,email,name,status)values($1,$2,'Test','active')",[id,`${subject}@pac.test`]);
 await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github',$2,'active')",[id,subject]);
 const m=(await db.admin.query("insert into workspace_members(workspace_id,user_id,status)values($1,$2,'active')returning id",[workspace,id])).rows[0].id;
 if(isOwner){const r=(await db.admin.query("insert into roles(workspace_id,code,name)values($1,'owner','Owner')returning id",[workspace])).rows[0].id;await db.admin.query("insert into member_role_assignments(member_id,role_id)values($1,$2)",[m,r]);if(id===owner){ownerMember=m;ownerRole=r;}}
}
await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github','8104','active')",[owner]);
const database=pg.createWorkflowRuntimePostgresDatabase({connectionString:db.url,maxConnections:12});
const services=(subject:string|null="8101",workspace:string=A.domain)=>{const a=access.createProjectOwnerAccess({database,domainWorkspaceId:workspace,session:subject?{pacIdentity:{provider:"github",providerSubject:subject}}:null});return{planning:domain.createProjectPlanning(a),knowledge:kb.createProjectKnowledge(a)};};const s=services();let serial=0;
async function project(key:string,workspace:string=A.id){await db.admin.query("insert into projects(workspace_id,project_key,display_name)values($1,$2,$2)",[workspace,key]);return key;}
async function upload(projectId:string,content=markdownProjectPlan(),filename="backlog.md",expectedVersion=0){const r=await s.knowledge.upload({projectId,filename,expectedVersion,requestId:`planning-doc-${++serial}`,bytes:Buffer.from(content)});assert.equal(r.status,"ok");assert(r.status==="ok");return{projectId,filename,version:r.value.document.version,sourceSha256:r.value.document.sha256};}
async function preview(input:Awaited<ReturnType<typeof upload>>){const r=await s.planning.preview(input);assert(r.status==="ok");return r.value;}
async function save(input:Awaited<ReturnType<typeof upload>>){const p=await preview(input);assert(p.validation.plan);const intent={...input,previewFingerprint:p.previewFingerprint,expectedRevision:p.expectedRevision};const r=await s.planning.save(intent);assert(r.status==="ok");return{intent,revision:r.value.revision,planFingerprint:contract.planDigest(p.validation.plan)};}
const decision=(projectId:string,p:Awaited<ReturnType<typeof save>>,choice="approved")=>({projectId,revision:p.revision,planFingerprint:p.planFingerprint,decision:choice});
const count=async(table:string,key:string)=>Number((await db.admin.query(`select count(*)::int n from ${table} where workspace_id=$1 and project_key=$2`,[A.id,key])).rows[0].n);
const originalFetch=globalThis.fetch;let fetches=0;globalThis.fetch=(async()=>{fetches++;throw Error("Network forbidden");}) as typeof fetch;
test("preview is read-only; explicit approval creates only ordinary draft ProjectTasks and factual links",async()=>{
 const key=await project("planning-owner"),input=await upload(key);const p=await preview(input);assert.equal(p.validation.accepted,3);assert.equal(await count("project_planning_drafts",key),0);assert.equal(await count("project_tasks",key),0);
 const saved=await save(input);assert.equal(await count("project_tasks",key),0);const r=await s.planning.decide(decision(key,saved));assert(r.status==="ok");assert.equal(r.value.outcome,"approved");
 const tasks=(await db.admin.query("select task_key,status,milestone_key from project_tasks where workspace_id=$1 and project_key=$2",[A.id,key])).rows;assert.equal(tasks.length,3);assert(tasks.every((t:{status:string;milestone_key:string|null})=>t.status==="draft"&&t.milestone_key===null));assert.equal(await count("project_planning_task_links",key),3);assert.equal(await count("roadmap_task_dependencies",key),0,"dependencies stay in the approved immutable plan; queue enrollment is future work");
 const read=await s.planning.read(key);assert(read.status==="ok");assert.equal(read.value.selected?.status,"approved");assert.equal((await db.admin.query("select count(*)::int n from workflow_runs where workspace_id=$1 and project_id=$2",[A.id,key])).rows[0].n,0);
});
test("68-record synthetic fixture survives source/revision persistence without FeaturePlan semantics changes",async()=>{
 const key=await project("planning-large"),input=await upload(key,yamlProjectPlan(representativeProjectPlan(68)),"backlog.yml");const saved=await save(input);const r=await s.planning.decide(decision(key,saved));assert(r.status==="ok");assert.equal(await count("project_tasks",key),68);assert.equal(await count("project_planning_task_links",key),68);
});
test("missing/non-Owner/foreign identities cannot read source or planning state or decide",async()=>{
 const key=await project("planning-denied"),input=await upload(key),saved=await save(input);const i=live.installQueryInterceptor();let privateReads=0;i.observe(sql=>{if(/project-planning:|project-knowledge:/u.test(sql))privateReads++;});
 try{for(const subject of [null,"8102","8103"]){const p=services(subject).planning;for(const r of [await p.preview(input),await p.read(key),await p.sources(key),await p.save(saved.intent),await p.decide(decision(key,saved)),await p.prepareAI(input)])assert.notEqual(r.status,"ok");}assert.equal(privateReads,0);}finally{i.restore();}
});
test("source SHA/version/project substitution is denied; historical exact versions remain factual",async()=>{
 const key=await project("planning-source"),input=await upload(key),p=await preview(input);await upload(key,markdownProjectPlan({...representativeProjectPlan(),title:"Later source"}),"backlog.md",1);
 const wrong=await s.planning.save({...input,version:2,previewFingerprint:p.previewFingerprint,expectedRevision:0});assert.notEqual(wrong.status,"ok");
 const otherKey=await project("planning-source-other");assert.notEqual((await s.planning.preview({...input,projectId:otherKey})).status,"ok");assert.equal((await s.planning.save({...input,previewFingerprint:p.previewFingerprint,expectedRevision:0})).status,"ok");
});
test("concurrent identical imports/replayed approvals create no duplicates; changed/stale input conflicts",async()=>{
 const key=await project("planning-replay"),input=await upload(key),p=await preview(input),intent={...input,previewFingerprint:p.previewFingerprint,expectedRevision:p.expectedRevision};const same=await Promise.all(Array.from({length:8},()=>s.planning.save(intent)));assert(same.every(r=>r.status==="ok"));assert.equal(await count("project_planning_drafts",key),1);
 const saved=await save(input);const votes=await Promise.all(Array.from({length:8},()=>s.planning.decide(decision(key,saved))));assert(votes.every(r=>r.status==="ok"));assert.equal(await count("project_tasks",key),3);
 assert.notEqual((await s.planning.save({...intent,previewFingerprint:"a".repeat(64)})).status,"ok");assert.notEqual((await s.planning.decide(decision(key,saved,"rejected"))).status,"ok");
});
test("competing imports and stale/contradictory decisions fail without replacing an approved plan",async()=>{
 const key=await project("planning-stale"),first=await upload(key),second=await upload(key,markdownProjectPlan({...representativeProjectPlan(),title:"Alternative"}),"other.md");const a=await preview(first),b=await preview(second);
 const race=await Promise.all([s.planning.save({...first,previewFingerprint:a.previewFingerprint,expectedRevision:0}),s.planning.save({...second,previewFingerprint:b.previewFingerprint,expectedRevision:0})]);assert.equal(race.filter(r=>r.status==="ok").length,1);assert.equal(race.filter(r=>r.status==="conflict").length,1);
 const oldInput=race[0].status==="ok"?first:second,newInput=race[0].status==="ok"?second:first;const old=await save(oldInput),fresh=await save(newInput);assert.equal((await s.planning.decide(decision(key,old))).status,"conflict");assert.equal((await s.planning.decide(decision(key,fresh))).status,"ok");
 const third=await upload(key,markdownProjectPlan({...representativeProjectPlan(),title:"No overwrite"}),"third.md");const later=await save(third);assert.equal((await s.planning.decide(decision(key,later))).status,"conflict");assert.equal(await count("project_tasks",key),3);
});
test("rejection never creates tasks; approve/reject race commits exactly one decision",async()=>{
 const key=await project("planning-vote"),saved=await save(await upload(key));const votes=await Promise.all([s.planning.decide(decision(key,saved,"rejected")),s.planning.decide(decision(key,saved))]);assert.equal(votes.filter(r=>r.status==="ok").length,1);const state=await s.planning.read(key);assert(state.status==="ok");assert.equal(await count("project_tasks",key),state.value.selected?.status==="approved"?3:0);
 const onlyReject=await project("planning-reject-only"),draft=await save(await upload(onlyReject));assert.equal((await s.planning.decide(decision(onlyReject,draft,"rejected"))).status,"ok");assert.equal(await count("project_tasks",onlyReject),0);
});
test("audit failure rolls back and ambiguous COMMIT safely reconciles for save AND approval",async()=>{
 for(const op of ["save","approve"] as const){const key=await project(`planning-atomic-${op}`),input=await upload(key),prepared=await preview(input),saveIntent={...input,previewFingerprint:prepared.previewFingerprint,expectedRevision:0};const saved=op==="approve"?await save(input):null;
 const invoke=()=>op==="save"?s.planning.save(saveIntent):s.planning.decide(decision(key,saved!));
 const fail=live.installQueryInterceptor();fail.rules.push(live.rule("audit fail",live.sqlTag("project-planning:audit"),async()=>{throw Error("private SQL secret");}));try{assert.deepEqual(await invoke(),{status:"unavailable"});}finally{fail.restore();}assert.equal(await count("project_tasks",key),0);
 const lost=live.installQueryInterceptor();lost.rules.push(live.rule("lost COMMIT",live.sqlTag("task-mutation:commit"),async(_c,sql,v,original)=>{await original(sql,v);throw Error("private connection secret");}));try{assert.deepEqual(await invoke(),{status:"unavailable"});}finally{lost.restore();}const replay=await invoke();assert(replay.status==="ok");assert.equal(replay.value.outcome,"replayed");assert.equal(await count("project_planning_drafts",key),1);assert.equal(await count("project_tasks",key),op==="approve"?3:0);
 }
});
function latch(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return{promise,release};}
async function bounded<T>(promise:Promise<T>){let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("checkpoint timeout")),5000);})]);}finally{clearTimeout(timer!);}}
test("original identity/member/role revoked after mapping and before transaction deny save AND approval",async()=>{
 for(const op of ["save","approve"] as const)for(const mode of ["identity","member","role"] as const){const key=await project(`planning-revoke-${op}-${mode}`),input=await upload(key),p=await preview(input),intent={...input,previewFingerprint:p.previewFingerprint,expectedRevision:0},saved=op==="approve"?await save(input):null;const pause=latch(),resume=latch(),i=live.installQueryInterceptor();
 i.rules.push(live.rule("after mapping",live.sqlTag("task-mutation:begin"),async(_c,sql,v,original)=>{pause.release();await bounded(resume.promise);return original(sql,v);}));const pending:Promise<{status:string}>=op==="save"?s.planning.save(intent):s.planning.decide(decision(key,saved!));
 try{await bounded(pause.promise);if(mode==="identity")await db.admin.query("update auth_identities set status='disabled' where provider_subject='8101'");else if(mode==="member")await db.admin.query("update workspace_members set status='disabled' where id=$1",[ownerMember]);else await db.admin.query("delete from member_role_assignments where member_id=$1 and role_id=$2",[ownerMember,ownerRole]);resume.release();assert.deepEqual(await bounded(pending),{status:"unavailable"});assert.equal(await count("project_tasks",key),0);}finally{resume.release();await pending.catch(()=>undefined);i.restore();if(mode==="identity")await db.admin.query("update auth_identities set status='active' where provider_subject='8101'");else if(mode==="member")await db.admin.query("update workspace_members set status='active' where id=$1",[ownerMember]);else await db.admin.query("insert into member_role_assignments(member_id,role_id)values($1,$2)",[ownerMember,ownerRole]);}
 }
});
test("DB rejects plan/approval provenance edits, forged decisions, and cross-project sources",async()=>{
 const key=await project("planning-immutable"),input=await upload(key),saved=await save(input),row=(await db.admin.query("select * from project_planning_drafts where workspace_id=$1 and project_key=$2",[A.id,key])).rows[0];
 for(const sql of ["update project_planning_drafts set plan_json='{}' where id=$1","delete from project_planning_drafts where id=$1","update project_planning_drafts set status='approved' where id=$1"])await assert.rejects(db.admin.query(sql,[row.id]));
 await assert.rejects(db.admin.query("update approval_requests set original_payload='{}' where id=$1",[row.approval_request_id]));
 assert.equal((await s.planning.decide(decision(key,saved,"rejected"))).status,"ok");await assert.rejects(db.admin.query("update approval_decisions set decision='approved' where approval_request_id=$1",[row.approval_request_id]));
});
test("malformed/cyclic documents have preview findings and cannot save; AI prepare performs zero inference",async()=>{
 const key=await project("planning-invalid"),invalid=representativeProjectPlan();invalid.tasks[0].dependencyIds=[invalid.tasks[2].id];const input=await upload(key,markdownProjectPlan(invalid));const p=await preview(input);assert.equal(p.validation.plan,null);assert.equal((await s.planning.save({...input,previewFingerprint:p.previewFingerprint,expectedRevision:0})).status,"conflict");
 const ai=await s.planning.prepareAI(input);assert(ai.status==="ok");assert.equal(ai.value.capability.status,"blocked");assert(!JSON.stringify(ai).includes("Backlog task"));assert.equal(await count("project_tasks",key),0);
});
test.after(async()=>{globalThis.fetch=originalFetch;assert.equal(fetches,0);await database.close();});
test("new approval guards leave unrelated existing approval CRUD unchanged",async()=>{
 const r=await db.admin.query("insert into approval_requests(workspace_id,action_type,status,risk_level)values($1,'existing_unrelated_action','pending','low')returning id",[A.id]);
 const deleted=await db.admin.query("delete from approval_requests where id=$1",[r.rows[0].id]);assert.equal(deleted.rowCount,1);
 assert.equal((await db.admin.query("select count(*)::int n from approval_requests where id=$1",[r.rows[0].id])).rows[0].n,0);
});

test("cross-project document provenance cannot be inserted through direct SQL",async()=>{
 const key=await project("planning-source-fk"),saved=await save(await upload(key)),foreign=await project("planning-source-fk-other");
 await assert.rejects(db.admin.query(`insert into project_planning_drafts(workspace_id,project_key,revision,source_document_id,source_filename,source_version,source_sha256,source_fingerprint,plan_json,plan_fingerprint,approval_request_id,created_by) select workspace_id,$2,1,source_document_id,source_filename,source_version,source_sha256,source_fingerprint,plan_json,plan_fingerprint,approval_request_id,created_by from project_planning_drafts where workspace_id=$1 and project_key=$3 and revision=$4`,[A.id,foreign,key,saved.revision]),(e:unknown)=>(e as {code:string}).code==="23514");
 assert.equal(await count("project_planning_drafts",foreign),0);
});
test("authority locks fence original identity revocation until save/approval commits",async()=>{
 for(const op of ["save","approve"] as const){const key=await project(`planning-lock-${op}`),input=await upload(key),p=await preview(input),intent={...input,previewFingerprint:p.previewFingerprint,expectedRevision:0},saved=op==="approve"?await save(input):null;
  const pause=latch(),resume=latch(),intercept=live.installQueryInterceptor(),revoker=live.adminClient(db.url);await revoker.connect();const pid=(await revoker.query("select pg_backend_pid() pid")).rows[0].pid;
  intercept.rules.push(live.rule("after authority",live.sqlTag(op==="save"?"project-planning:save":"project-planning:decision-lock"),async(_c,sql,v,original)=>{pause.release();await bounded(resume.promise);return original(sql,v);}));
  const pending:Promise<{status:string}>=op==="save"?s.planning.save(intent):s.planning.decide(decision(key,saved!));let revocation:Promise<unknown>|null=null;
  try{await bounded(pause.promise);revocation=revoker.query("update auth_identities set status='disabled' where provider_subject='8101'");
   const started=Date.now();let locked=false;while(Date.now()-started<4000){const r=await db.admin.query("select wait_event_type from pg_stat_activity where pid=$1",[pid]);if(r.rows[0]?.wait_event_type==="Lock"){locked=true;break;}await new Promise(r=>setTimeout(r,10));}assert(locked,"revocation must wait on factual authority row lock");
   resume.release();assert.equal((await bounded(pending)).status,"ok");await bounded(revocation!);assert.notEqual((await s.planning.read(key)).status,"ok");
  }finally{resume.release();await pending.catch(()=>undefined);if(revocation)await revocation.catch(()=>undefined);intercept.restore();await revoker.end();await db.admin.query("update auth_identities set status='active' where provider_subject='8101'");}
 }
});
test("history cap permits exact import replay and historical rejection, never revision21",async()=>{
 const key=await project("planning-history-cap");let first:Awaited<ReturnType<typeof upload>>|null=null,firstSaved:Awaited<ReturnType<typeof save>>|null=null;
 for(let i=0;i<20;i++){const input=await upload(key,markdownProjectPlan(),`plan-${i}.md`),stored=await save(input);if(i===0){first=input;firstSaved=stored;}}
 const checked=await preview(first!);assert.equal(checked.expectedRevision,20);const replay=await s.planning.save({...first!,previewFingerprint:checked.previewFingerprint,expectedRevision:20});assert(replay.status==="ok");assert.equal(replay.value.outcome,"replayed");
 const extra=await upload(key,markdownProjectPlan(),"extra.md"),p=await preview(extra);assert.equal((await s.planning.save({...extra,previewFingerprint:p.previewFingerprint,expectedRevision:20})).status,"conflict");assert.equal(await count("project_planning_drafts",key),20);
 assert.equal((await s.planning.decide(decision(key,firstSaved!,"rejected"))).status,"ok");assert.equal(await count("project_tasks",key),0);
});
test("same project/source IDs in separate workspaces stay isolated through preview and activation",async()=>{
 const key=await project("planning-tenant");await project(key,B.id);const a=await upload(key);const bs=services("8103",B.domain);
 const b=await bs.knowledge.upload({projectId:key,filename:"backlog.md",expectedVersion:0,requestId:"tenant-source-b",bytes:Buffer.from(markdownProjectPlan({...representativeProjectPlan(),title:"B private requirements"}))});assert(b.status==="ok");
 const bi={projectId:key,filename:"backlog.md",version:1,sourceSha256:b.value.document.sha256};assert.equal((await s.planning.preview(bi)).status,"conflict");
 const bp=await bs.planning.preview(bi);assert(bp.status==="ok");assert.equal(bp.value.validation.plan?.title,"B private requirements");
 const bsaved=await bs.planning.save({...bi,previewFingerprint:bp.value.previewFingerprint,expectedRevision:0});assert(bsaved.status==="ok");
 const astored=await save(a);assert.equal((await s.planning.decide(decision(key,astored))).status,"ok");assert.equal((await bs.planning.decide({projectId:key,revision:1,planFingerprint:contract.planDigest(bp.value.validation.plan),decision:"approved"})).status,"ok");
 const read=await s.planning.read(key);assert(read.status==="ok");assert.equal(read.value.selected?.plan.title,"Reviewed backlog fixture");assert(!JSON.stringify(read).includes("B private requirements"));
});

// C1/C2 regressions: statements may be temporarily incomplete inside a transaction,
// but a contradictory final state must be rejected by PostgreSQL at COMMIT.
async function planningFacts(key:string) {
 return (await db.admin.query(`select p.status,a.status request_status,
   a.approved_by is not null has_approved_by,a.rejected_by is not null has_rejected_by,
   a.resolved_at is not null has_resolved_at,
   (select count(*)::int from project_planning_task_links l where l.workspace_id=p.workspace_id and l.draft_id=p.id) links,
   (select count(*)::int from approval_decisions d where d.workspace_id=p.workspace_id and d.approval_request_id=a.id) decisions,
   (select count(*)::int from project_tasks t where t.workspace_id=p.workspace_id and t.project_key=p.project_key) tasks,
   (select count(*)::int from audit_events e where e.workspace_id=p.workspace_id and e.metadata->>'projectId'=p.project_key) audits
   from project_planning_drafts p join approval_requests a on a.workspace_id=p.workspace_id and a.id=p.approval_request_id
   where p.workspace_id=$1 and p.project_key=$2 order by p.revision desc limit 1`,[A.id,key])).rows[0];
}
async function pendingFixture(key:string) {
 await project(key);const saved=await save(await upload(key));
 const row=(await db.admin.query("select id,approval_request_id from project_planning_drafts where workspace_id=$1 and project_key=$2 and revision=$3",[A.id,key,saved.revision])).rows[0];
 return {key,saved,row};
}
async function mustRejectAtCommit(key:string,mutate:()=>Promise<unknown>) {
 const before=await planningFacts(key);let code:string|null=null;
 await db.admin.query("begin");
 try {
  await mutate(); // Must succeed provisionally: the deferred check sees the final transaction.
  try {await db.admin.query("commit");} catch(error) {code=(error as {code?:string}).code??"unknown";}
 } finally {await db.admin.query("rollback");}
 const after=await planningFacts(key);
 assert.equal(code,"23514",JSON.stringify({key,before,after}));
 assert.deepEqual(after,before,"rejected COMMIT leaves all lifecycle/task/audit facts unchanged");
}
test("C1: pending links and provisional task roll back at deferred COMMIT",async()=>{
 const f=await pendingFixture("c1-pending-link");
 await mustRejectAtCommit(f.key,async()=>{
  await db.admin.query("insert into project_tasks(workspace_id,project_key,task_key,title,task_type,status,created_by)values($1,$2,'c1-provisional','Fixture task','feature','draft',$3)",[A.id,f.key,owner]);
  const inserted=await db.admin.query("insert into project_planning_task_links(workspace_id,project_key,draft_id,source_task_id,task_key)values($1,$2,$3,'CE-001','c1-provisional')",[A.id,f.key,f.row.id]);assert.equal(inserted.rowCount,1);
 });
 assert.equal((await s.planning.read(f.key)).status,"ok");
});
for(const field of ["approved_by","rejected_by","resolved_at","combined"] as const)test(`C2: pending ${field} is rejected at COMMIT with unchanged facts`,async()=>{
 const f=await pendingFixture(`c2-${field.replaceAll("_","-")}`);
 await mustRejectAtCommit(f.key,async()=>{
  const sql=field==="resolved_at"?"update approval_requests set resolved_at=now() where id=$1":field==="combined"?"update approval_requests set approved_by=$2,rejected_by=$2,resolved_at=now() where id=$1":`update approval_requests set ${field}=$2 where id=$1`;
  const changed=await db.admin.query(sql,field==="resolved_at"?[f.row.approval_request_id]:[f.row.approval_request_id,owner]);assert.equal(changed.rowCount,1);
 });
 assert.equal((await s.planning.read(f.key)).status,"ok");
});
test("C1/C2: service read/save/decide reject inconsistent pending resolver snapshots",async()=>{
 for(const operation of ["read","save","decide"] as const)for(const fields of [{approved_by:owner},{rejected_by:owner},{resolved_at:new Date("2026-11-10T00:00:00Z")},{approved_by:owner,rejected_by:owner,resolved_at:new Date("2026-11-10T00:00:00Z")}]){
  const f=await pendingFixture(`c2-service-${++serial}`),before=await planningFacts(f.key),i=live.installQueryInterceptor();
  i.rules.push(live.rule("contradictory request snapshot",live.sqlTag("project-planning:request"),async(_c,sql,v,original)=>{const r=await original(sql,v);return{...r,rows:r.rows.map((row:Record<string,unknown>)=>({...row,...fields}))};}));
  try{const result=operation==="read"?await s.planning.read(f.key):operation==="save"?await s.planning.save(f.saved.intent):await s.planning.decide(decision(f.key,f.saved));assert.deepEqual(result,{status:"unavailable"});}finally{i.restore();}
  assert.deepEqual(await planningFacts(f.key),before);
 }
});
test("C1: save replay validates pending link and decision evidence",async()=>{
 for(const kind of ["links","decision"] as const){const f=await pendingFixture(`c1-replay-${kind}`),before=await planningFacts(f.key),i=live.installQueryInterceptor();
  i.rules.push(live.rule("inconsistent lifecycle snapshot",live.sqlTag(kind==="links"?"project-planning:links":"project-planning:decision-evidence"),async()=>kind==="links"?{rowCount:1,rows:[{source_task_id:"CE-001",task_key:"unexpected"}]}:{rowCount:1,rows:[{decision:"approved",decided_by_actor_id:owner}]}));
  try{assert.deepEqual(await s.planning.save(f.saved.intent),{status:"unavailable"});}finally{i.restore();}
  assert.deepEqual(await planningFacts(f.key),before);
 }
});
test("C1: wrong source/key/task payload link cannot commit an otherwise valid approval",async()=>{
 for(const mode of ["source","key","payload"] as const){const f=await pendingFixture(`c1-approved-link-${mode}`);
  if(mode==="key")await db.admin.query("insert into project_tasks(workspace_id,project_key,task_key,title,goal,task_type,status,priority,created_by)values($1,$2,'c1-other-task',$3,$4,'feature','draft','P2',$5)",[A.id,f.key,"Backlog task 1","Deliver and verify outcome 1",owner]);
  const before=await planningFacts(f.key),i=live.installQueryInterceptor();
  const tag=mode==="payload"?"project-planning:create-task":"project-planning:task-link";
  i.rules.push(live.rule("incorrect materialized evidence",live.sqlTag(tag),async(_c,sql,v,original)=>{
   const changed=[...v];if(mode==="source")changed[3]="CE-999";else if(mode==="key")changed[4]="c1-other-task";else changed[3]="Unexpected task title";
   return original(sql,changed);
  }));
  try{assert.deepEqual(await s.planning.decide(decision(f.key,f.saved)),{status:"unavailable"});}finally{i.restore();}
  assert.deepEqual(await planningFacts(f.key),before);
 }
});
test("C1/C2: historical approved/rejected save and decision replay keep current tasks intact",async()=>{
 for(const choice of ["approved","rejected"] as const){const f=await pendingFixture(`c1-history-${choice}`);assert.equal((await s.planning.decide(decision(f.key,f.saved,choice))).status,"ok");
  if(choice==="approved")await db.admin.query("update project_tasks set title='Later task intent',status='ready' where workspace_id=$1 and project_key=$2",[A.id,f.key]);
  const before=await planningFacts(f.key),saveReplay=await s.planning.save(f.saved.intent),decisionReplay=await s.planning.decide(decision(f.key,f.saved,choice));
  assert(saveReplay.status==="ok"&&decisionReplay.status==="ok");assert.equal(saveReplay.value.outcome,"replayed");assert.equal(decisionReplay.value.outcome,"replayed");assert.deepEqual(await planningFacts(f.key),before);
  if(choice==="approved")assert((await db.admin.query("select status from project_tasks where workspace_id=$1 and project_key=$2",[A.id,f.key])).rows.every((r:{status:string})=>r.status==="ready"));
 }
});
test("C1/C2: terminal opposite resolver/missing decision/audit snapshots deny all replay/read",async()=>{
 for(const choice of ["approved","rejected"] as const)for(const kind of ["opposite","decision","audit","missing-time"] as const){const f=await pendingFixture(`c2-final-${++serial}`);assert.equal((await s.planning.decide(decision(f.key,f.saved,choice))).status,"ok");
  const before=await planningFacts(f.key);
  for(const operation of ["read","save","decide"] as const){const i=live.installQueryInterceptor();
   const tag=kind==="opposite"||kind==="missing-time"?"project-planning:request":kind==="decision"?"project-planning:decision-evidence":"project-planning:audit-read";
   const inconsistent=live.rule("inconsistent final snapshot",live.sqlTag(tag),async(_c,sql,v,original)=>{
    const r=await original(sql,v);if(kind==="opposite")return{...r,rows:r.rows.map((row:Record<string,unknown>)=>({...row,[choice==="approved"?"rejected_by":"approved_by"]:owner}))};
    if(kind==="missing-time")return{...r,rows:r.rows.map((row:Record<string,unknown>)=>({...row,resolved_at:undefined}))};
    if(kind==="decision"||v[1]===`project.plan_${choice}`)return{rowCount:0,rows:[]};
    inconsistent.fired=0;return r; // Preserve saved-draft evidence; corrupt only the terminal audit.
   });i.rules.push(inconsistent);
   try{const result=operation==="read"?await s.planning.read(f.key):operation==="save"?await s.planning.save(f.saved.intent):await s.planning.decide(decision(f.key,f.saved,choice));assert.deepEqual(result,{status:"unavailable"});}finally{i.restore();}
  }
  assert.deepEqual(await planningFacts(f.key),before);
 }
});
test("C1: historical replay/read require matching task creation audit evidence",async()=>{
 const f=await pendingFixture("c1-task-audit");assert.equal((await s.planning.decide(decision(f.key,f.saved))).status,"ok");const before=await planningFacts(f.key);
 for(const operation of ["read","save","decide"] as const){const i=live.installQueryInterceptor();i.rules.push(live.rule("missing task audit",live.sqlTag("project-planning:task-audit-read"),async()=>({rowCount:0,rows:[]})));
  try{const result=operation==="read"?await s.planning.read(f.key):operation==="save"?await s.planning.save(f.saved.intent):await s.planning.decide(decision(f.key,f.saved));assert.deepEqual(result,{status:"unavailable"});}finally{i.restore();}
 }
 assert.deepEqual(await planningFacts(f.key),before);
});
