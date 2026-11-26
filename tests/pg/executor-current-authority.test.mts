import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, financialPolicy, executorTarget, context, executorRequestPolicy } from "../fixtures/durable-executor.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const durable = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const db = await live.useLiveDatabase("currentauthority");
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Authority test')", [live.primaryWorkspace.id]);
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.close())); });
async function setup(id: string, number = 1, configuration: unknown = executorConfiguration(number, id)) {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain); assert.ok(tenant);
  const config = { database, tenant, projectId: "project-a", configuration };
  return { config, a: authority.createPostgresExecutorCurrentAuthorityStore(config), raw: executorRequest(number, id), s: durable.createPostgresExecutorStartStore({ ...config,
    target: executorTarget(), requestPolicy: executorRequestPolicy(), financialPolicy: financialPolicy(), authorizeStart: () => true }) };
}
test("PG stale canonical snapshot alone cannot reserve or obtain start commitment", async () => {
  const { s, raw } = await setup("without-authority");
  const reservation = await s.reserve(raw, { maximumExposureUsdMicros: 10000 });
  const preparation = await s.bindRequest(raw, context());
  const start = await s.commitProviderStart(raw, preparation.snapshot?.requestFingerprint ?? "b".repeat(64));
  assert.equal(start.startCapability, null, "baseline issues capability without current authority");
  assert.equal(reservation.verdict, "deny"); assert.equal(start.verdict, "deny");
});
const exposure = { maximumExposureUsdMicros: 10000 };
function frozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
function denied(d: { verdict: string; snapshot: unknown; startCapability?: unknown }) {
  assert.equal(d.verdict, "deny"); assert.equal(d.snapshot, null); if ("startCapability" in d) assert.equal(d.startCapability, null); frozen(d);
}
async function prepared(id: string) {
  const v = await setup(id); assert.equal((await v.a.registerCurrentAuthority()).status, "registered");
  assert.equal((await v.s.reserve(v.raw, exposure)).status, "reserved");
  const p = await v.s.bindRequest(v.raw, context()); assert.ok(p.snapshot?.requestFingerprint);
  return { ...v, fingerprint: p.snapshot.requestFingerprint, snapshot: p.snapshot };
}
const facts = async (id: string) => {
  const values = [live.primaryWorkspace.id, id];
  return {
    authority: (await db.admin.query("select authority_generation,authority_status,current_attempt_number,canonical_run_fingerprint,admission_fingerprint from executor_run_authorities where workspace_id=$1 and development_run_id=$2", values)).rows,
    exposure: (await db.admin.query("select authority_generation,canonical_run_fingerprint,admission_fingerprint,state from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2 order by attempt_number", values)).rows,
    journal: (await db.admin.query("select authority_generation,authority_status,operation from executor_authority_events where workspace_id=$1 and development_run_id=$2 order by authority_generation", values)).rows,
  };
};
test("PG register active generation 1 and journal atomically", async () => {
  const { a } = await setup("register"), d = await a.registerCurrentAuthority();
  assert.equal(d.status, "registered"); assert.equal(d.snapshot?.generation, 1); assert.equal(d.snapshot?.status, "active"); frozen(d);
  assert.deepEqual((await facts("register")).journal, [{ authority_generation: 1, authority_status: "active", operation: "register" }]);
});
test("PG exact register replay deterministic fresh/frozen, configuration immutable", async () => {
  const c = executorConfiguration(1, "replay"), before = structuredClone(c), { a } = await setup("replay", 1, c);
  await a.registerCurrentAuthority(); const x = await a.registerCurrentAuthority(), y = await a.registerCurrentAuthority();
  assert.equal(x.status, "idempotent"); assert.deepEqual(x, y); assert.notEqual(x.snapshot, y.snapshot); frozen(x); frozen(y); assert.deepEqual(c, before);
  assert.equal((await facts("replay")).journal.length, 1);
});
test("PG conflicting register cannot silently overwrite Run facts", async () => {
  const { a } = await setup("conflict"); await a.registerCurrentAuthority();
  const c = executorConfiguration(1, "conflict"); c.developmentRun = { ...c.developmentRun, requiredVerificationCommands: ["npm run lint"] };
  const changed = await setup("conflict", 1, c); denied(await changed.a.registerCurrentAuthority());
  assert.equal((await facts("conflict")).authority[0].authority_generation, 1);
});
test("PG store recreation preserves active authority and inspection never issues capability", async () => {
  const { a } = await setup("restart"); const first = await a.registerCurrentAuthority();
  const second = await setup("restart"), inspected = await second.a.inspectCurrentAuthority();
  assert.deepEqual(inspected.snapshot, first.snapshot); assert.ok(!("startCapability" in inspected));
});
test("PG reservation binds immutable generation and both authority fingerprints", async () => {
  const { snapshot } = await prepared("binding"), stored = await facts("binding");
  assert.equal(snapshot.authorityGeneration, 1);
  assert.equal(snapshot.canonicalRunFingerprint, stored.authority[0].canonical_run_fingerprint);
  assert.equal(snapshot.admissionFingerprint, stored.authority[0].admission_fingerprint);
  assert.equal(stored.exposure[0].authority_generation, 1);
});
test("PG revoked authority blocks reserve, bind and stale start; pre-start exposure remains cancellable", async () => {
  const { a, s, raw, fingerprint } = await prepared("revoked"); assert.equal((await a.revokeCurrentAuthority()).status, "revoked");
  for (const d of [await s.reserve(raw, exposure), await s.bindRequest(raw, context()), await s.commitProviderStart(raw, fingerprint)]) denied(d);
  assert.equal((await s.cancel(raw)).status, "cancelled");
});
test("PG revoke idempotent, generation irreversible; same attempt cannot reactivate", async () => {
  const { a } = await setup("irreversible"); await a.registerCurrentAuthority(); const d = await a.revokeCurrentAuthority();
  assert.equal(d.snapshot?.generation, 2); assert.equal((await a.revokeCurrentAuthority()).status, "idempotent");
  denied(await a.registerCurrentAuthority()); denied(await a.advanceCurrentAuthority());
  const recreated = await setup("irreversible"); assert.deepEqual((await recreated.a.inspectCurrentAuthority()).snapshot, d.snapshot);
  assert.equal((await facts("irreversible")).journal.length, 2);
});
test("PG independent OS process revocation fences already-created stale factory after restart", async () => {
  const { s, raw, fingerprint } = await prepared("os-revoke");
  const script = `import { pathToFileURL } from 'node:url';
    const root=pathToFileURL(process.cwd()+'/');
    const p=await import(new URL('lib/db/postgres.ts',root)); const t=await import(new URL('lib/db/workflow-runtime-tenant.ts',root));
    const a=await import(new URL('lib/db/executor-current-authority-store.ts',root)); const f=await import(new URL('tests/fixtures/durable-executor.mts',root));
    const database=p.createWorkflowRuntimePostgresDatabase({connectionString:process.env.AUTHORITY_TEST_DB,maxConnections:1});
    try { const tenant=await t.createPostgresWorkflowRuntimeTenantResolver(database).resolve('workspace-primary');
      const d=await a.createPostgresExecutorCurrentAuthorityStore({database,tenant,projectId:'project-a',configuration:f.executorConfiguration(1,'os-revoke')}).revokeCurrentAuthority();
      process.stdout.write(JSON.stringify({pid:process.pid,status:d.status,generation:d.snapshot?.generation}));
    } catch { process.exitCode=1; } finally { await database.close(); }`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-"], { input: script, encoding: "utf8", timeout: 15000, env: { ...process.env, AUTHORITY_TEST_DB: db.url } });
  assert.equal(child.status, 0, "controlled child completed without raw errors"); const d = JSON.parse(child.stdout);
  assert.notEqual(d.pid, process.pid); assert.equal(d.status, "revoked"); assert.equal(d.generation, 2);
  denied(await s.commitProviderStart(raw, fingerprint)); const restarted = await setup("os-revoke"); denied(await restarted.s.commitProviderStart(raw, fingerprint));
});
test("PG canonical corrective 2 then 3 advancement preserves journal and generation", async () => {
  const first = await setup("advance"); await first.a.registerCurrentAuthority();
  for (const n of [2, 3]) {
    const v = await setup("advance", n), d = await v.a.advanceCurrentAuthority();
    assert.equal(d.status, "advanced"); assert.equal(d.snapshot?.attemptNumber, n); assert.equal(d.snapshot?.generation, n);
    assert.equal((await v.a.advanceCurrentAuthority()).status, "idempotent");
    assert.equal((await v.s.reserve(v.raw, exposure)).status, "reserved");
  }
  assert.equal((await facts("advance")).journal.length, 3);
});
test("PG revoked attempt may advance only to new canonical corrective attempt/generation", async () => {
  const first = await setup("revoke-advance"); await first.a.registerCurrentAuthority(); await first.a.revokeCurrentAuthority();
  const second = await setup("revoke-advance", 2); const d = await second.a.advanceCurrentAuthority();
  assert.equal(d.status, "advanced"); assert.equal(d.snapshot?.generation, 3); assert.equal(d.snapshot?.attemptNumber, 2);
  denied(await first.a.revokeCurrentAuthority());
});
test("PG skipped attempt and valid-looking repaired prior history denied", async () => {
  const one = await setup("history"); await one.a.registerCurrentAuthority(); const skipped = await setup("history", 3); denied(await skipped.a.advanceCurrentAuthority());
  const two = await setup("history", 2); await two.a.advanceCurrentAuthority();
  const c = executorConfiguration(3, "history"); c.developmentRun = { ...c.developmentRun,
    failures: c.developmentRun.failures.map((f, index) => index ? f : { ...f, summary: "Altered prior historical fact" }) };
  const repaired = await setup("history", 3, c); denied(await repaired.a.advanceCurrentAuthority());
  assert.equal((await facts("history")).authority[0].current_attempt_number, 2);
});
test("PG authority advance invalidates stale reservation/bind/start, cannot rebind historical exposure", async () => {
  const old = await prepared("superseded"), newer = await setup("superseded", 2); await newer.a.advanceCurrentAuthority();
  denied(await old.s.bindRequest(old.raw, context())); denied(await old.s.commitProviderStart(old.raw, old.fingerprint));
  const f = await facts("superseded"); assert.equal(f.exposure[0].state, "prepared"); assert.equal(f.exposure[0].authority_generation, 1);
  assert.equal(f.authority[0].authority_generation, 2); assert.equal((await old.s.cancel(old.raw)).status, "cancelled");
});
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function waitForLock() {
  for (let n = 0; n < 100; n++) {
    const r = await db.admin.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'");
    if (r.rows[0].n > 0) return;
    await live.sleep(10);
  }
  assert.fail("independent contender did not wait for factual PostgreSQL lock");
}
for (const operation of ["revoke", "advance"] as const) for (const winner of ["start", "mutation"] as const)
  test(`PG ${operation}/start race x10: ${winner} wins current-authority lock; legal serialized outcome only`, async () => {
    const pids = new Set<number>();
    for (let n = 0; n < 10; n++) {
      const id = `race-${operation}-${winner}-${n}`, old = await prepared(id), other = await setup(id, operation === "advance" ? 2 : 1);
      const entered = latch(), release = latch(), interceptor = live.installQueryInterceptor();
      interceptor.observe((_sql, client) => { if (client.processID) pids.add(client.processID); });
      const tag = winner === "start" ? "executor:budget-lock" : "executor:authority-journal";
      interceptor.rules.push(live.rule("hold lock winner", live.sqlTag(tag), async (_client, cfg, values, send) => { entered.release(); await release.promise; return send(cfg, values); }));
      const mutate = () => operation === "advance" ? other.a.advanceCurrentAuthority() : other.a.revokeCurrentAuthority();
      let start: Promise<import("../../lib/db/executor-start-store").DurableExecutorDecision> | undefined;
      let mutation: Promise<import("../../lib/db/executor-current-authority-store").ExecutorCurrentAuthorityDecision> | undefined;
      try {
        if (winner === "start") start = old.s.commitProviderStart(old.raw, old.fingerprint); else mutation = mutate();
        await entered.promise;
        if (winner === "start") mutation = mutate(); else start = old.s.commitProviderStart(old.raw, old.fingerprint);
        await waitForLock(); release.release(); const [s, a] = await Promise.all([start!, mutation!]);
        assert.equal(a.status, operation === "advance" ? "advanced" : "revoked");
        if (winner === "start") { assert.equal(s.status, "start_committed"); assert.ok(s.startCapability); }
        else denied(s);
        const f = await facts(id); assert.equal(f.exposure.length, 1); assert.equal(f.exposure[0].state, winner === "start" ? "start_committed" : "prepared");
        assert.equal(f.authority[0].authority_generation, 2); assert.equal(f.journal.length, 2);
        denied(await old.s.commitProviderStart(old.raw, old.fingerprint));
      } finally { release.release(); await Promise.allSettled([start, mutation].filter(Boolean)); interceptor.restore(); }
    }
    assert.ok(pids.size >= 2, "independent PostgreSQL backends participate");
  });
test("PG Project pause committed while start waits is re-evaluated and denied", async () => {
  const old = await prepared("paused-wait"), blocker = live.adminClient(db.url); await blocker.connect();
  try {
    await blocker.query("begin"); await blocker.query("update projects set status='paused' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]);
    const start = old.s.commitProviderStart(old.raw, old.fingerprint); await waitForLock(); await blocker.query("commit"); denied(await start);
  } finally { await blocker.query("rollback"); await blocker.end(); await db.admin.query("update projects set status='active' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]); }
});
test("PG archived Project cannot start even with active authority", async () => {
  const old = await prepared("archived"); await db.admin.query("update projects set status='archived' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]);
  try { denied(await old.s.commitProviderStart(old.raw, old.fingerprint)); }
  finally { await db.admin.query("update projects set status='active' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]); }
});
test("PG cross-workspace authority indistinguishable from absent; zero foreign snapshots", async () => {
  const one = await setup("tenant-secret"); await one.a.registerCurrentAuthority();
  await live.insertWorkspace(db.admin, live.secondaryWorkspace); await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Foreign')", [live.secondaryWorkspace.id]);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(one.config.database).resolve(live.secondaryWorkspace.domain); assert.ok(tenant);
  const foreign = authority.createPostgresExecutorCurrentAuthorityStore({ ...one.config, tenant });
  const absent = authority.createPostgresExecutorCurrentAuthorityStore({ ...one.config, tenant, configuration: executorConfiguration(1, "absent") });
  denied(await foreign.inspectCurrentAuthority()); assert.deepEqual(await foreign.inspectCurrentAuthority(), await absent.inspectCurrentAuthority());
  denied(await foreign.revokeCurrentAuthority());
});
for (const change of ["plan", "task", "admission", "run"] as const) test(`PG changed ${change} cannot register/advance/bind/start over existing authority`, async () => {
  const old = await prepared(`changed-${change}`), c = executorConfiguration(1, `changed-${change}`);
  if (change === "plan") { c.admission.plan.id = "other-plan"; c.developmentRun = { ...c.developmentRun, planId: "other-plan" }; }
  if (change === "task") { c.admission.taskId = "other-task"; c.admission.plan.tasks[0].id = "other-task"; c.developmentRun = { ...c.developmentRun, taskId: "other-task" }; }
  if (change === "admission") c.admission.plan.tasks[0].goal = "Changed admitted goal";
  if (change === "run") c.developmentRun = { ...c.developmentRun, requiredVerificationCommands: ["npm run lint"] };
  const altered = await setup(`changed-${change}`, 1, c), raw = { ...altered.raw, planId: c.admission.plan.id, taskId: c.admission.taskId };
  denied(await altered.a.registerCurrentAuthority()); denied(await altered.a.advanceCurrentAuthority());
  denied(await altered.s.bindRequest(raw, context())); denied(await altered.s.commitProviderStart(raw, old.fingerprint));
  assert.equal((await facts(`changed-${change}`)).authority[0].authority_generation, 1);
});
for (const operation of ["revoke", "advance"] as const) test(`PG ${operation} lost COMMIT acknowledgement latches closed; reconnect observes factual generation`, async () => {
  const old = await prepared(`ambiguous-${operation}`), v = operation === "advance" ? await setup(`ambiguous-${operation}`, 2) : old;
  const interceptor = live.installQueryInterceptor(); interceptor.rules.push(live.rule("lost authority commit ack", live.sqlTag("executor-transaction:commit"), async (_client, cfg, values, send) => {
    await send(cfg, values); throw Error("private-driver-authority-canary");
  }));
  try {
    const d = await (operation === "advance" ? v.a.advanceCurrentAuthority() : v.a.revokeCurrentAuthority());
    denied(d); assert.equal(d.status, "recovery_required"); assert.ok(!JSON.stringify(d).includes("private-driver"));
    denied(await v.a.registerCurrentAuthority()); assert.equal((await v.a.inspectCurrentAuthority()).status, "recovery_required");
  } finally { interceptor.restore(); }
  const again = await setup(`ambiguous-${operation}`, operation === "advance" ? 2 : 1);
  assert.equal((await again.a.inspectCurrentAuthority()).snapshot?.generation, 2); denied(await old.s.commitProviderStart(old.raw, old.fingerprint));
});
test("PG direct DB constraints deny generation rollback/reuse, identity rewrite, bad shape and missing journal", async () => {
  await prepared("constraints"); const row = (await db.admin.query("select to_jsonb(a) as value from executor_run_authorities a where workspace_id=$1 and development_run_id='constraints'", [live.primaryWorkspace.id])).rows[0].value;
  const reject = async (sql: string, values: unknown[]) => { let code: unknown; try { await db.admin.query(sql, values); } catch (e) { code = (e as { code: string }).code; } assert.ok(["23514", "23503", "55000"].includes(code as string), "direct malformed write rejected with expected SQLSTATE"); };
  for (const change of [{ authority_generation: 0 }, { authority_generation: 2 }, { authority_status: "unknown" }, { current_attempt_number: 0 },
    { current_attempt_number: 2, current_attempt_kind: "initial" }, { canonical_run_fingerprint: "bad" }, { admission_fingerprint: "bad" },
    { project_key: "other-project" }, { revoked_at: new Date().toISOString() }, {}])
    await reject("insert into executor_run_authorities select (jsonb_populate_record(null::executor_run_authorities,$1::jsonb)).*", [JSON.stringify({ ...row, development_run_id: `bad-${randomUUID()}`, ...change })]);
  for (const set of ["authority_generation=authority_generation", "authority_generation=authority_generation-1", "plan_id='other-plan'", "admission_fingerprint=repeat('c',64)", "canonical_run_fingerprint=repeat('c',64)"])
    await reject(`update executor_run_authorities set ${set} where workspace_id=$1 and development_run_id='constraints'`, [live.primaryWorkspace.id]);
  await reject("delete from executor_authority_events where workspace_id=$1 and development_run_id='constraints'", [live.primaryWorkspace.id]);
  await reject("update executor_attempt_exposures set authority_generation=2 where workspace_id=$1 and development_run_id='constraints'", [live.primaryWorkspace.id]);
  assert.equal((await facts("constraints")).authority[0].authority_generation, 1);
});
test("PG normal control: authority + fence commits once, no provider dispatch or capability reconstruction", async () => {
  const v = await prepared("normal-control"), result = await v.s.commitProviderStart(v.raw, v.fingerprint);
  assert.equal(result.status, "start_committed"); assert.ok(result.startCapability); frozen(result);
  const copy = await setup("normal-control"); const observed = await copy.s.inspect(v.raw); assert.equal(observed.snapshot?.state, "start_committed"); assert.equal(observed.startCapability, null);
  denied(await copy.s.commitProviderStart(v.raw, v.fingerprint)); assert.equal((await facts("normal-control")).exposure.length, 1);
});
test("PG concurrent registration x10 creates only one generation/event without silent overwrite", async () => {
  const a = await setup("register-race"), b = await setup("register-race");
  const results = await Promise.all(Array.from({ length: 10 }, (_, n) => (n % 2 ? a : b).a.registerCurrentAuthority()));
  assert.equal(results.filter(d => d.status === "registered").length, 1);
  assert.equal(results.filter(d => d.status === "idempotent").length, 9); assert.equal((await facts("register-race")).journal.length, 1);
});
test("PG valid-shaped authority transition without matching journal rolls back at COMMIT", async () => {
  const { a } = await setup("journal-missing"); await a.registerCurrentAuthority();
  let code: string | undefined;
  try { await db.admin.query("update executor_run_authorities set authority_generation=authority_generation+1,authority_status='revoked',updated_at=statement_timestamp(),revoked_at=statement_timestamp() where workspace_id=$1 and development_run_id='journal-missing'", [live.primaryWorkspace.id]); }
  catch (e) { code = (e as { code: string }).code; }
  assert.equal(code, "23503"); assert.equal((await a.inspectCurrentAuthority()).snapshot?.generation, 1);
});
