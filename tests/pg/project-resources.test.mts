import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
const live=(await import(new URL("./helpers/live-pg.ts",import.meta.url).href)) as typeof import("./helpers/live-pg");
const pg=(await import(new URL("../../lib/db/postgres.ts",import.meta.url).href)) as typeof import("../../lib/db/postgres");
const access=(await import(new URL("../../lib/projects/project-owner-access.ts",import.meta.url).href)) as typeof import("../../lib/projects/project-owner-access");
const binding=(await import(new URL("../../lib/projects/repository-binding.ts",import.meta.url).href)) as typeof import("../../lib/projects/repository-binding");
const knowledge=(await import(new URL("../../lib/projects/project-knowledge.ts",import.meta.url).href)) as typeof import("../../lib/projects/project-knowledge");
const db=await live.useLiveDatabase("projectresources");
const A=live.primaryWorkspace,B=live.secondaryWorkspace;await live.insertWorkspace(db.admin,A);await live.insertWorkspace(db.admin,B);
const owner="00000000-0000-4000-8000-000000009201", member="00000000-0000-4000-8000-000000009202", other="00000000-0000-4000-8000-000000009203";
let ownerMember="",ownerRole="";
for(const[id,subject,workspace,isOwner]of [[owner,"9201",A.id,true],[member,"9202",A.id,false],[other,"9203",B.id,true]] as const){
 await db.admin.query("insert into users(id,email,name,status)values($1,$2,'Test','active')",[id,`${subject}@pac.test`]);
 await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github',$2,'active')",[id,subject]);
 const membership=(await db.admin.query("insert into workspace_members(workspace_id,user_id,status)values($1,$2,'active')returning id",[workspace,id])).rows[0].id;
 if(isOwner){const role=(await db.admin.query("insert into roles(workspace_id,code,name)values($1,'owner','Owner')returning id",[workspace])).rows[0].id;await db.admin.query("insert into member_role_assignments(member_id,role_id)values($1,$2)",[membership,role]);if(id===owner){ownerMember=membership;ownerRole=role;}}
}
await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status)values($1,'github','9204','active')",[owner]);
const database=pg.createWorkflowRuntimePostgresDatabase({connectionString:db.url,maxConnections:10});
const services=(subject:string|null="9201",domain:string=A.domain)=>{const a=access.createProjectOwnerAccess({database,domainWorkspaceId:domain,session:subject?{pacIdentity:{provider:"github",providerSubject:subject}}:null});return{repo:binding.createRepositoryBinding(a),kb:knowledge.createProjectKnowledge(a)};};
const s=services();
const project=async(key:string,workspace:string=A.id)=>{await db.admin.query("insert into projects(workspace_id,project_key,display_name)values($1,$2,$2)",[workspace,key]);return key;};
const bind=(projectId:string,requestId:string,expectedRevision=0,url="https://github.com/example/repo")=>({projectId,requestId,expectedRevision,url,defaultBranch:"main"});
const upload=(projectId:string,requestId:string,text="# Document\n",expectedVersion=0,filename="README.md")=>({projectId,requestId,expectedVersion,filename,bytes:Buffer.from(text)});
const count=async(sql:string,values:unknown[]=[])=>Number((await db.admin.query(sql,values)).rows[0].n);
const saved=(r:unknown)=>assert.equal((r as {status:string}).status,"ok",JSON.stringify(r));
const fetch=globalThis.fetch;let fetches=0;globalThis.fetch=(async()=>{fetches++;throw Error("Network forbidden");}) as typeof fetch;

test("Owner configures only unverified GitHub metadata; no access/SHA is fabricated",async()=>{
 const key=await project("binding-owner");const r=await s.repo.bind(bind(key,"bind-owner-1"));saved(r);assert(r.status==="ok");
 assert.equal(r.value.binding.bindingStatus,"configured_unverified");assert.equal(r.value.binding.verifiedBaselineSha,null);assert.equal(r.value.binding.revision,1);
 assert.equal((await db.admin.query("select repository_url,default_branch from projects where workspace_id=$1 and project_key=$2",[A.id,key])).rows[0].repository_url,"https://github.com/example/repo");
 assert.equal(await count("select count(*)::int n from audit_events where workspace_id=$1 and event_type='project.repository_bound'",[A.id]),1);
});
test("unauthenticated/non-Owner/foreign Owner reads and writes deny before project/document access",async()=>{
 const key=await project("denied-resources");const interceptor=live.installQueryInterceptor();let privateQueries=0;
 interceptor.observe(sql=>{if(/project-resources:project-lock|repository-binding:|project-knowledge:/u.test(sql))privateQueries++;});
 try{for(const subject of [null,"9202","9203"]){const denied=services(subject);for(const r of [await denied.repo.read(key),await denied.repo.bind(bind(key,"deny-bind-1")),await denied.kb.list(key),await denied.kb.read(key,"README.md",1),await denied.kb.upload(upload(key,"deny-upload-1"))]){assert.notEqual(r.status,"ok");assert(!JSON.stringify(r).includes("Document"));}}assert.equal(privateQueries,0);}finally{interceptor.restore();}
});
test("binding exact retries/concurrent duplicates are idempotent; stale competing writes cannot overwrite",async()=>{
 const key=await project("binding-race");const input=bind(key,"binding-race-1");const results=await Promise.all(Array.from({length:10},()=>s.repo.bind(input)));
 assert(results.every(r=>r.status==="ok"));assert.equal(results.filter(r=>r.status==="ok"&&r.value.outcome==="saved").length,1);
 assert.equal((await s.repo.bind({...input,url:"https://github.com/changed/repo"})).status,"conflict");
 const race=await Promise.all(Array.from({length:8},(_,i)=>s.repo.bind(bind(key,`binding-new-${i}`,1,`https://github.com/example/repo${i}`))));
 assert.equal(race.filter(r=>r.status==="ok").length,1);assert.equal(race.filter(r=>r.status==="conflict").length,7);
 assert.equal((await s.repo.bind(input)).status,"conflict","historical binding replay never undoes newer state");
});
test("direct SQL metadata changes advance revision too; stale and ABA writes cannot overwrite",async()=>{
 const key=await project("external-binding");const original=bind(key,"external-bind-1");
 await db.admin.query("update projects set repository_url='https://github.com/another/repo',default_branch='main' where workspace_id=$1 and project_key=$2",[A.id,key]);
 assert.equal((await s.repo.bind(original)).status,"conflict");
 const current=await s.repo.read(key);assert(current.status==="ok");assert.equal(current.value.revision,1);assert.equal(current.value.url,"https://github.com/another/repo");
 await db.admin.query("update projects set repository_url=null,default_branch=null where workspace_id=$1 and project_key=$2",[A.id,key]);
 assert.equal((await s.repo.bind(original)).status,"conflict");
 await assert.rejects(db.admin.query("update projects set repository_revision=0 where workspace_id=$1 and project_key=$2",[A.id,key]),(e:unknown)=>(e as {code:string}).code==="23514");
});
test("UTF-8 Markdown/YAML exact bytes/hash, BOM and immutable history survive readback",async()=>{
 const key=await project("documents-owner");const text="\ufeff# Привет\r\n<script>never executed</script>\n";
 const first=await s.kb.upload(upload(key,"document-owner-1",text));saved(first);
 saved(await s.kb.upload(upload(key,"document-owner-2","!!js/function >\n  never executed\n",1)));
 const old=await s.kb.read(key,"README.md",1);saved(old);assert(old.status==="ok");assert.equal(old.value.content,text);
 assert.equal(old.value.document.sha256,createHash("sha256").update(Buffer.from(text)).digest("hex"));assert.equal(old.value.document.verificationStatus,"uploaded_unverified");assert.deepEqual(old.value.versions.map(v=>v.version),[2,1]);
 const replay=await s.kb.upload(upload(key,"document-owner-1",text));saved(replay);assert(replay.status==="ok");assert.equal(replay.value.document.version,1);
 assert.equal(await count("select count(*)::int n from knowledge_document_versions v join knowledge_documents d on d.id=v.document_id where d.workspace_id=$1 and d.project_key=$2",[A.id,key]),2);
});
test("workspace/project isolation and IDOR: same filename/key never crosses the selected project",async()=>{
 const key=await project("isolated-docs");await project(key,B.id);const another=await project("isolated-other");
 saved(await s.kb.upload(upload(key,"isolate-upload-1","A private")));saved(await services("9203",B.domain).kb.upload(upload(key,"isolate-upload-1","B private")));
 const a=await s.kb.read(key,"README.md",1),b=await services("9203",B.domain).kb.read(key,"README.md",1);assert(a.status==="ok"&&b.status==="ok");assert.equal(a.value.content,"A private");assert.equal(b.value.content,"B private");
 assert.equal((await s.kb.read(another,"README.md",1)).status,"unavailable");assert.equal((await s.kb.read("foreign-project","README.md",1)).status,"unavailable");
 assert.equal((await s.kb.upload(upload(another,"isolate-upload-1","Different"))).status,"conflict");
 assert.equal(await count("select count(*)::int n from knowledge_documents where workspace_id=$1 and project_key=$2",[A.id,another]),0,"conflicting request rollback leaves no parent");
});
test("concurrent duplicate uploads and stale appends never corrupt versions or duplicate audits",async()=>{
 const key=await project("upload-race");const input=upload(key,"upload-race-1");const same=await Promise.all(Array.from({length:10},()=>s.kb.upload(input)));
 assert(same.every(r=>r.status==="ok"));assert.equal(same.filter(r=>r.status==="ok"&&r.value.outcome==="saved").length,1);
 const races=await Promise.all(Array.from({length:8},(_,i)=>s.kb.upload(upload(key,`upload-race-new-${i}`,`Change ${i}`,1))));assert.equal(races.filter(r=>r.status==="ok").length,1);
 assert.equal(await count("select count(*)::int n from audit_events where workspace_id=$1 and event_type='knowledge.document_uploaded' and metadata->>'projectId'=$2",[A.id,key]),2);
});
test("append-only DB versions reject UPDATE/DELETE and composite FK rejects cross-workspace reference",async()=>{
 const key=await project("immutable-docs");saved(await s.kb.upload(upload(key,"immutable-doc-1")));
 const row=(await db.admin.query("select v.id,v.document_id from knowledge_document_versions v join knowledge_documents d on d.id=v.document_id where d.workspace_id=$1 and d.project_key=$2",[A.id,key])).rows[0];
 for(const sql of ["update knowledge_document_versions set content='changed' where id=$1","delete from knowledge_document_versions where id=$1"]){await assert.rejects(db.admin.query(sql,[row.id]),(e:unknown)=>(e as {code:string}).code==="23514");}
 await assert.rejects(db.admin.query("insert into knowledge_document_versions(workspace_id,document_id,version,content,sha256,upload_request_key,intent_fingerprint,created_by)values($1,$2,2,'x',$3,'cross-tenant-version',$3,$4)",[B.id,row.document_id,"a".repeat(64),other]),(e:unknown)=>(e as {code:string}).code==="23503");
});
test("audit failure rolls back and lost COMMIT acknowledgement safely replays for BOTH operations",async()=>{
 for(const kind of ["binding","upload"] as const){
  const key=await project(`atomic-${kind}`), input=kind==="binding"?bind(key,`atomic-${kind}-key`):upload(key,`atomic-${kind}-key`);
  const invoke=()=>kind==="binding"?s.repo.bind(input):s.kb.upload(input);
  const fail=live.installQueryInterceptor();fail.rules.push(live.rule("audit failure",live.sqlTag(kind==="binding"?"repository-binding:audit":"project-knowledge:audit"),async()=>{throw Error("private SQL secret");}));
  try{assert.deepEqual(await invoke(),{status:"unavailable"});}finally{fail.restore();}
  assert.equal((await db.admin.query("select repository_revision from projects where workspace_id=$1 and project_key=$2",[A.id,key])).rows[0].repository_revision,0);
  assert.equal(await count("select count(*)::int n from knowledge_documents where workspace_id=$1 and project_key=$2",[A.id,key]),0);
  const lost=live.installQueryInterceptor();lost.rules.push(live.rule("lost commit",live.sqlTag("task-mutation:commit"),async(_c,sql,values,original)=>{await original(sql,values);throw Error("private connection reset");}));
  try{assert.deepEqual(await invoke(),{status:"unavailable"});}finally{lost.restore();}
  const replay=await invoke();saved(replay);assert(replay.status==="ok");assert.equal(replay.value.outcome,"replayed");
 }
});
function latch(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return{promise,release};}
async function bounded<T>(p:Promise<T>){let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([p,new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(Error("checkpoint timeout")),5000);})]);}finally{clearTimeout(timer!);}}
test("original identity, membership and role revocation before mutation deny BOTH operations",async()=>{
 for(const kind of ["binding","upload"] as const)for(const mode of ["identity","membership","role"] as const){
  const key=await project(`revoke-${kind}-${mode}`),paused=latch(),resume=latch();const intercept=live.installQueryInterceptor();
  intercept.rules.push(live.rule("after identity before BEGIN",live.sqlTag("task-mutation:begin"),async(_c,sql,values,original)=>{paused.release();await bounded(resume.promise);return original(sql,values);}));
  const pending: Promise<{status:string}>=kind==="binding"?s.repo.bind(bind(key,`revoke-${kind}-${mode}`)):s.kb.upload(upload(key,`revoke-${kind}-${mode}`));
  try{await bounded(paused.promise);if(mode==="identity")await db.admin.query("update auth_identities set status='disabled' where provider_subject='9201'");else if(mode==="membership")await db.admin.query("update workspace_members set status='disabled' where id=$1",[ownerMember]);else await db.admin.query("delete from member_role_assignments where member_id=$1 and role_id=$2",[ownerMember,ownerRole]);resume.release();assert.deepEqual(await bounded(pending),{status:"unavailable"});
   assert.equal(await count("select count(*)::int n from audit_events where workspace_id=$1 and metadata->>'projectId'=$2",[A.id,key]),0);
  }finally{resume.release();await pending.catch(()=>undefined);intercept.restore();if(mode==="identity")await db.admin.query("update auth_identities set status='active' where provider_subject='9201'");else if(mode==="membership")await db.admin.query("update workspace_members set status='active' where id=$1",[ownerMember]);else await db.admin.query("insert into member_role_assignments(member_id,role_id)values($1,$2)",[ownerMember,ownerRole]);}
 }
});
test("oversized/malformed input and storage quotas deny with no partial new document",async()=>{
 const key=await project("quota-docs");
 for(const bytes of [new Uint8Array(262145),new Uint8Array([0xc3,0x28]),new Uint8Array([0])])assert.equal((await s.kb.upload({...upload(key,"quota-invalid"),bytes})).status,"invalid_input");
 await db.admin.query("insert into knowledge_documents(workspace_id,project_key,filename,title,source_type,status,indexing_status,uploaded_by)select $1,$2,'doc-'||i||'.md','Fixture','manual_upload','active','uploaded',$3 from generate_series(1,100)i",[A.id,key,owner]);
 assert.equal((await s.kb.upload(upload(key,"quota-new-1"))).status,"conflict");
 assert.equal(await count("select count(*)::int n from knowledge_document_versions v join knowledge_documents d on d.id=v.document_id where d.workspace_id=$1 and d.project_key=$2",[A.id,key]),0);
});
test("corrupt returned content hash fails closed and never yields partial content",async()=>{
 const key=await project("hash-docs");saved(await s.kb.upload(upload(key,"hash-doc-1")));
 const i=live.installQueryInterceptor();i.rules.push(live.rule("corrupt bytes",live.sqlTag("project-knowledge:content"),async()=>({rows:[{content:Buffer.from("private corrupted content")}],rowCount:1})));
 try{assert.deepEqual(await s.kb.read(key,"README.md",1),{status:"unavailable"});}finally{i.restore();}
});
test("missing/contradictory upload audit never authorizes an identical replay",async()=>{
 const key=await project("replay-audit");const input=upload(key,"replay-audit-1");saved(await s.kb.upload(input));
 await db.admin.query("update audit_events set metadata='{}'::jsonb where workspace_id=$1 and event_type='knowledge.document_uploaded' and metadata->>'projectId'=$2",[A.id,key]);
 assert.equal((await s.kb.upload(input)).status,"conflict");
 assert.equal(await count("select count(*)::int n from knowledge_document_versions v join knowledge_documents d on d.id=v.document_id where d.workspace_id=$1 and d.project_key=$2",[A.id,key]),1);
});
test("repository replay rejects contradictory audit entity type or forged resulting revision",async()=>{
 const key=await project("audit-binding");const first=bind(key,"audit-binding-1");saved(await s.repo.bind(first));
 await db.admin.query("update audit_events set entity_type='knowledge_document_version' where workspace_id=$1 and event_type='project.repository_bound' and metadata->>'requestId'=$2",[A.id,first.requestId]);
 assert.equal((await s.repo.bind(first)).status,"conflict");
 await db.admin.query("update audit_events set entity_type='project' where workspace_id=$1 and event_type='project.repository_bound' and metadata->>'requestId'=$2",[A.id,first.requestId]);
 saved(await s.repo.bind(bind(key,"audit-binding-2",1)));
 await db.admin.query("update audit_events set metadata=jsonb_set(metadata,'{revision}','2'::jsonb) where workspace_id=$1 and event_type='project.repository_bound' and metadata->>'requestId'=$2",[A.id,first.requestId]);
 assert.equal((await s.repo.bind(first)).status,"conflict");
});
test.after(async()=>{globalThis.fetch=fetch;assert.equal(fetches,0);await database.close();});
