import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const binding = (await import(new URL("../../lib/composition/owner-project-create.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-project-create");
const reads = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");
const consoleRead = (await import(new URL("../../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-console-read");
const db = await live.useLiveDatabase("projectcreate");
const A = live.primaryWorkspace, B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A); await live.insertWorkspace(db.admin, B);
const ownerA = "00000000-0000-4000-8000-000000009101";
const memberA = "00000000-0000-4000-8000-000000009102";
const ownerB = "00000000-0000-4000-8000-000000009103";
let ownerMembership = "";
for (const [id, subject, workspace, owner] of [[ownerA, "9101", A.id, true], [memberA, "9102", A.id, false], [ownerB, "9103", B.id, true]] as const) {
  await db.admin.query("insert into users(id,email,name,status) values($1,$2,'Test','active')",[id,`${subject}@pac.test`]);
  await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status) values($1,'github',$2,'active')",[id,subject]);
  const membership = (await db.admin.query("insert into workspace_members(workspace_id,user_id,status) values($1,$2,'active') returning id",[workspace,id])).rows[0].id;
  if (id === ownerA) ownerMembership = membership;
  if (owner) {
    const role = (await db.admin.query("insert into roles(workspace_id,code,name) values($1,'owner','Owner') returning id",[workspace])).rows[0].id;
    await db.admin.query("insert into member_role_assignments(member_id,role_id) values($1,$2)",[membership,role]);
  }
}
const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 8 });
const session = (subject: string | null) => subject === null ? null : { pacIdentity: { provider: "github", providerSubject: subject } };
const create = (subject: string | null = "9101", workspaceSlug: string = A.domain) => binding.createOwnerProjectCreate({ workspaceSlug, async withProjectCreate(domainWorkspaceId, work) {
  return work(binding.createGitHubOwnerProjectCreate({ database, domainWorkspaceId, session: session(subject) }));
} });
function form(projectId: string, displayName = "Project Name") { const f = new FormData(); f.set("projectId",projectId); f.set("displayName",displayName); return f; }
const count = async (sql: string, values: unknown[] = []) => Number((await db.admin.query(sql,values)).rows[0].n);
const projectCount = (key: string) => count("select count(*)::int n from projects where workspace_id=$1 and project_key=$2",[A.id,key]);
const auditCount = (key: string) => count("select count(*)::int n from audit_events where workspace_id=$1 and event_type='project.created' and metadata->>'projectId'=$2",[A.id,key]);
const fetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async () => { networkCalls++; throw Error("Network forbidden"); }) as typeof globalThis.fetch;

test("Owner creates a persisted active project with exactly one bounded actor audit; read path discovers it", async () => {
  const result = await create().submit(form("created-project"));
  assert.deepEqual(result,{ status:"created",project:{projectId:"created-project",displayName:"Project Name",status:"active",repository:null} });
  assert.equal(await projectCount("created-project"),1); assert.equal(await auditCount("created-project"),1);
  const row=(await db.admin.query("select actor_user_id::text,metadata,entity_type from audit_events where event_type='project.created' and workspace_id=$1",[A.id])).rows[0];
  assert.equal(row.actor_user_id,ownerA); assert.equal(row.entity_type,"project");
  assert.deepEqual(Object.keys(row.metadata).sort(),["intentFingerprint","projectId"]);
  const owner = await reads.createGitHubOwnerReadRuntime({ database, domainWorkspaceId:A.domain, sessionResolver:{resolve:()=>session("9101")} });
  assert.equal(owner.verdict,"allow"); assert(owner.verdict==="allow");
  assert((await owner.backend.listProjects()).data?.some(p=>p.projectId==="created-project"));
  const interceptor = live.installQueryInterceptor(); const tags: string[] = [];
  interceptor.observe(text => { if (text.includes("project-registry:")) tags.push(text); });
  try {
    const denied = await owner.backend.listProjects(1, { workspaceId: B.id, actorId: ownerB });
    assert.equal(denied.status, "invalid_input");
    assert.equal(tags.length, 0);
  } finally { interceptor.restore(); }
});

test("anonymous, non-Owner, foreign Owner, disabled membership and forged workspace cannot write", async () => {
  for (const subject of [null,"9102","9103","unmapped"]) {
    const result=await create(subject).submit(form("denied-project"));
    assert.deepEqual(result,{status:subject===null || subject==="unmapped" ? "unauthenticated":"unavailable"});
  }
  await db.admin.query("update workspace_members set status='disabled' where id=$1",[ownerMembership]);
  try { assert.deepEqual(await create().submit(form("denied-project")),{status:"unavailable"}); }
  finally { await db.admin.query("update workspace_members set status='active' where id=$1",[ownerMembership]); }
  const forged=form("denied-project"); forged.set("workspaceId",B.id);
  assert.deepEqual(await create().submit(forged),{status:"invalid_input"});
  assert.equal(await projectCount("denied-project"),0); assert.equal(await auditCount("denied-project"),0);
});

test("same Project ID is independent across workspaces; changed intent conflicts without mutation", async () => {
  assert.equal((await create().submit(form("same-key","A Name"))).status,"created");
  assert.equal((await create("9103",B.domain).submit(form("same-key","B Name"))).status,"created");
  assert.deepEqual(await create().submit(form("same-key","Different")),{status:"conflict"});
  assert.equal((await db.admin.query("select display_name from projects where workspace_id=$1 and project_key='same-key'",[A.id])).rows[0].display_name,"A Name");
  assert.equal(await auditCount("same-key"),1);
});

test("ten concurrent identical creates and exact retries produce one project and one audit", async () => {
  const results=await Promise.all(Array.from({length:10},()=>create().submit(form("race-same"))));
  assert.equal(results.filter(r=>r.status==="created").length,1);
  assert.equal(results.filter(r=>r.status==="replayed").length,9);
  assert.equal((await create().submit(form("race-same"))).status,"replayed");
  assert.equal(await projectCount("race-same"),1); assert.equal(await auditCount("race-same"),1);
});

test("ten competing payloads serialize on the existing uniqueness constraint", async () => {
  const results=await Promise.all(Array.from({length:10},(_,i)=>create().submit(form("race-conflict",`Name ${i}`))));
  assert.equal(results.filter(r=>r.status==="created").length,1);
  assert.equal(results.filter(r=>r.status==="conflict").length,9);
  assert.equal(await projectCount("race-conflict"),1); assert.equal(await auditCount("race-conflict"),1);
});

test("audit failure rolls back the project; successful commit with lost acknowledgement safely replays", async () => {
  const interceptor=live.installQueryInterceptor();
  interceptor.rules.push(live.rule("audit fail",live.sqlTag("project-mutation:audit-created"),async()=>{throw Error("private SQL password");}));
  try { assert.deepEqual(await create().submit(form("rollback-project")),{status:"unavailable"}); }
  finally { interceptor.restore(); }
  assert.equal(await projectCount("rollback-project"),0); assert.equal(await auditCount("rollback-project"),0);
  const lost=live.installQueryInterceptor();
  lost.rules.push(live.rule("commit acknowledgement",live.sqlTag("task-mutation:commit"),async(_client,config,values,original)=>{
    await original(config,values); throw Error("private connection reset");
  }));
  try { assert.deepEqual(await create().submit(form("ambiguous-project")),{status:"unavailable"}); }
  finally { lost.restore(); }
  assert.equal((await create().submit(form("ambiguous-project"))).status,"replayed");
  assert.equal(await projectCount("ambiguous-project"),1); assert.equal(await auditCount("ambiguous-project"),1);
});

test("legacy/missing/contradictory creation evidence is never accepted as an identical retry", async () => {
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'legacy-project','Project Name')",[A.id]);
  assert.deepEqual(await create().submit(form("legacy-project")),{status:"conflict"});
  await create().submit(form("corrupt-audit"));
  await db.admin.query("update audit_events set metadata='{}'::jsonb where workspace_id=$1 and event_type='project.created' and metadata->>'projectId'='corrupt-audit'",[A.id]);
  assert.deepEqual(await create().submit(form("corrupt-audit")),{status:"conflict"});
});

test("101st project has an authenticated exact lookup and scoped Dashboard, with no tenant fallback", async () => {
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) select $1,'p-'||lpad(i::text,3,'0'),'Fixture' from generate_series(1,101) i",[A.id]);
  assert.equal((await create().submit(form("zz-new-project"))).status,"created");
  const reader=consoleRead.createOwnerConsoleReader({workspaceSlug:A.domain,async withRuntime(domainWorkspaceId,work){
    return work(await reads.createGitHubOwnerReadRuntime({database,domainWorkspaceId,sessionResolver:{resolve:()=>session("9101")}}));
  }});
  const list=await reader.loadOwnerProjects(); assert.equal(list.state,"available");
  assert(list.state==="available"); assert.equal(list.projects.length,100);
  assert(!list.projects.some(p=>p.projectId==="zz-new-project"));
  const dashboard=await reader.loadOwnerDashboard({kind:"candidate",projectId:"zz-new-project"});
  assert.equal(dashboard.state,"available");
  assert(dashboard.state==="available" && dashboard.scope.mode==="project");
  assert.equal(dashboard.scope.project.projectId,"zz-new-project");
  await create("9103",B.domain).submit(form("foreign-only"));
  assert.equal((await reader.loadOwnerDashboard({kind:"candidate",projectId:"foreign-only"})).state,"project_unavailable");
  assert.equal((await reader.loadOwnerDashboard({kind:"candidate",projectId:"missing-project"})).state,"project_unavailable");
});

function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Concurrency checkpoint timed out")), 5000); })]); }
  finally { clearTimeout(timer!); }
}
async function waitForBlock(waiter: number, holder: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (await db.admin.query("select $2::int = any(pg_blocking_pids($1::int)) as blocked", [waiter, holder])).rows[0];
    if (row.blocked) return;
    await live.sleep(5);
  }
  assert.fail("Expected factual PostgreSQL row-lock blocking was not observed");
}

test("C1: revocation committed after mapping resolution but before BEGIN denies the exact session, despite another active identity", async () => {
  await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status) values($1,'github','9104','active')", [ownerA]);
  for (const mode of ["disabled", "deleted", "reassigned"] as const) {
    const paused = latch(), resume = latch();
    const interceptor = live.installQueryInterceptor();
    interceptor.rules.push(live.rule("pause before mutation BEGIN", live.sqlTag("task-mutation:begin"), async (_client, config, values, original) => {
      paused.release(); await bounded(resume.promise); return original(config, values);
    }));
    const key = `c1-revoked-${mode}`;
    const pending = create().submit(form(key));
    try {
      await bounded(paused.promise);
      if (mode === "deleted") await db.admin.query("delete from auth_identities where provider='github' and provider_subject='9101'");
      else if (mode === "reassigned") await db.admin.query("update auth_identities set user_id=$1 where provider='github' and provider_subject='9101'", [ownerB]);
      else await db.admin.query("update auth_identities set status='disabled' where provider='github' and provider_subject='9101'");
      assert.equal(await count("select count(*)::int n from auth_identities where user_id=$1 and provider_subject='9104' and status='active'", [ownerA]), 1);
      resume.release();
      assert.deepEqual(await bounded(pending), { status: "unavailable" });
      assert.equal(await projectCount(key), 0); assert.equal(await auditCount(key), 0);
    } finally {
      resume.release(); await pending.catch(() => undefined); interceptor.restore();
      if (mode === "deleted") await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status) values($1,'github','9101','active')", [ownerA]);
      else await db.admin.query("update auth_identities set status='active',user_id=$1 where provider='github' and provider_subject='9101'", [ownerA]);
    }
  }
});

test("C1: revoker holding the row wins; waiting identity SHARE rechecks the active predicate", async () => {
  const paused = latch(), resume = latch(), querying = latch();
  const revoker = live.adminClient(db.url); await revoker.connect();
  const holder = (await revoker.query("select pg_backend_pid() as pid")).rows[0].pid;
  let waiter = 0;
  const interceptor = live.installQueryInterceptor();
  interceptor.rules.push(live.rule("pause before BEGIN", live.sqlTag("task-mutation:begin"), async (_client, config, values, original) => {
    paused.release(); await bounded(resume.promise); return original(config, values);
  }));
  interceptor.rules.push(live.rule("observe identity query", live.sqlTag("project-mutation:identity-lock"), (client, config, values, original) => {
    waiter = client.processID; querying.release(); return original(config, values);
  }));
  const pending = create().submit(form("c1-revoker-first"));
  try {
    await bounded(paused.promise);
    await revoker.query("begin");
    await revoker.query("update auth_identities set status='disabled' where provider='github' and provider_subject='9101'");
    resume.release(); await bounded(querying.promise);
    await waitForBlock(waiter, holder);
    await revoker.query("commit");
    assert.deepEqual(await bounded(pending), { status: "unavailable" });
    assert.equal(await projectCount("c1-revoker-first"), 0); assert.equal(await auditCount("c1-revoker-first"), 0);
  } finally {
    resume.release(); await revoker.query("rollback").catch(() => undefined);
    await pending.catch(() => undefined); interceptor.restore(); await revoker.end();
    await db.admin.query("update auth_identities set status='active' where provider='github' and provider_subject='9101'");
  }
});

test("C1: creation holding identity SHARE wins before status revocation or delete; subsequent request denies", async () => {
  for (const mode of ["disabled", "deleted"] as const) {
    const paused = latch(), resume = latch();
    const revoker = live.adminClient(db.url); await revoker.connect();
    const waiter = (await revoker.query("select pg_backend_pid() as pid")).rows[0].pid;
    let holder = 0;
    const interceptor = live.installQueryInterceptor();
    interceptor.rules.push(live.rule("pause holding exact identity SHARE", live.sqlTag("project-mutation:identity-lock"), async (client, config, values, original) => {
      const row = await original(config, values); holder = client.processID; paused.release(); await bounded(resume.promise); return row;
    }));
    const key = `c1-creator-first-${mode}`;
    const pending = create().submit(form(key));
    let revoke: Promise<unknown> | null = null;
    try {
      await bounded(paused.promise); await revoker.query("begin");
      revoke = revoker.query(mode === "deleted"
        ? "delete from auth_identities where provider='github' and provider_subject='9101'"
        : "update auth_identities set status='disabled' where provider='github' and provider_subject='9101'");
      await waitForBlock(waiter, holder);
      resume.release(); assert.equal((await bounded(pending)).status, "created");
      assert(revoke); await bounded(revoke); await revoker.query("commit");
      assert.equal(await projectCount(key), 1); assert.equal(await auditCount(key), 1);
      assert.deepEqual(await create().submit(form(key)), { status: "unauthenticated" });
    } finally {
      resume.release(); await pending.catch(() => undefined); if (revoke) await revoke.catch(() => undefined);
      await revoker.query("rollback").catch(() => undefined); interceptor.restore(); await revoker.end();
      if (mode === "deleted") await db.admin.query("insert into auth_identities(user_id,provider,provider_subject,status) values($1,'github','9101','active')", [ownerA]);
      else await db.admin.query("update auth_identities set status='active' where provider='github' and provider_subject='9101'");
    }
  }
});

test("C1: mutating the original session after capture never switches to a still-active alternative subject", async () => {
  const raw = session("9101")!;
  let sessionCalls = 0;
  const resolveSession = () => { sessionCalls++; return sessionCalls === 1 ? raw : session("9104"); };
  const creator = binding.createGitHubOwnerProjectCreate({ database, domainWorkspaceId: A.domain, session: resolveSession() });
  const paused = latch(), resume = latch();
  const interceptor = live.installQueryInterceptor();
  interceptor.rules.push(live.rule("pause after mapping", live.sqlTag("task-mutation:begin"), async (_client, config, values, original) => {
    paused.release(); await bounded(resume.promise); return original(config, values);
  }));
  const pending = creator.createProject({ projectId: "c1-captured-session", displayName: "Project Name" });
  try {
    await bounded(paused.promise); raw.pacIdentity.providerSubject = "9104";
    await db.admin.query("update auth_identities set status='disabled' where provider='github' and provider_subject='9101'");
    resume.release(); assert.deepEqual(await bounded(pending), { status: "unavailable" });
    assert.equal(sessionCalls, 1); assert.equal(await projectCount("c1-captured-session"), 0); assert.equal(await auditCount("c1-captured-session"), 0);
  } finally {
    resume.release(); await pending.catch(() => undefined); interceptor.restore();
    await db.admin.query("update auth_identities set status='active' where provider='github' and provider_subject='9101'");
  }
});

test("identical create retry after future GitHub Binding conflicts and never overwrites the binding", async () => {
  const key = "future-bound-project";
  assert.equal((await create().submit(form(key))).status, "created");
  await db.admin.query("update projects set repository_url='https://github.com/example/repo',default_branch='main' where workspace_id=$1 and project_key=$2", [A.id, key]);
  assert.deepEqual(await create().submit(form(key)), { status: "conflict" });
  assert.equal(await projectCount(key), 1); assert.equal(await auditCount(key), 1);
  assert.deepEqual((await db.admin.query("select repository_url,default_branch from projects where workspace_id=$1 and project_key=$2", [A.id, key])).rows[0], { repository_url: "https://github.com/example/repo", default_branch: "main" });
});

test.after(async()=>{ globalThis.fetch=fetch; assert.equal(networkCalls,0); await database.close(); });
