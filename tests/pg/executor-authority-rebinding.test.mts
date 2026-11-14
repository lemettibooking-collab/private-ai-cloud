import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, executorTarget, executorRequestPolicy, financialPolicy, context } from "../fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { claudeFixture } from "../fixtures/claude-managed.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { legacyAuthority } from "../fixtures/legacy-executor-authority.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const facts = await import(new URL("../../lib/executors/executor-current-authority.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-current-authority");
const core = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const db = await live.useLiveDatabase("authorityrebind");
// Isolated mutation copies may replace ONLY these trigger functions in this test-owned DB.
if (process.env.AUTHORITY_REBIND_MIGRATION_SQL) {
  const sql = readFileSync(process.env.AUTHORITY_REBIND_MIGRATION_SQL, "utf8");
  await db.admin.query(sql.slice(sql.indexOf("create or replace function"), sql.lastIndexOf("commit;")));
}
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Rebind')", [live.primaryWorkspace.id]);
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
async function setup(id: string, provider: "openai" | "anthropic", n = 1, url = db.url) {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain); assert.ok(tenant);
  const c = claudeFixture(id, n, tenant.workspaceDatabaseId);
  const configuration = provider === "anthropic" ? c.configuration : executorConfiguration(n, id);
  const raw = provider === "anthropic" ? c.raw : executorRequest(n, id), target = provider === "anthropic" ? c.target : executorTarget();
  const config = { database, tenant, projectId: "project-a", configuration, target, requestPolicy: provider === "anthropic" ? c.policy : executorRequestPolicy(), financialPolicy: financialPolicy(), authorizeStart: () => true };
  return { config, raw, c, store: core.createPostgresExecutorStartStore(config), a: authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: config.projectId, configuration }) };
}
for (const [from, to] of [["openai", "anthropic"], ["anthropic", "openai"]] as const) test(`R RED/GREEN adjacent factual rebind ${from}->${to}`, async () => {
  const id = `rebind-${from}`, old = await setup(id, from), next = await setup(id, to, 2);
  assert.equal((await old.a.registerCurrentAuthority()).status, "registered");
  const f = facts.deriveExecutorAuthorityFacts(old.config.configuration), g = facts.deriveExecutorAuthorityFacts(next.config.configuration);
  assert.equal(g.predecessorRunFingerprint, f.canonicalRunFingerprint); assert.notEqual(g.admissionFingerprint, f.admissionFingerprint);
  assert.equal(g.admissionScopeFingerprint, f.admissionScopeFingerprint);
  const advanced = await next.a.advanceCurrentAuthority(); assert.equal(advanced.status, "advanced"); assert.equal(advanced.snapshot?.admissionFingerprint, g.admissionFingerprint);
  assert.equal(advanced.snapshot?.admissionScopeFingerprint, f.admissionScopeFingerprint);
  const restarted = await setup(id, to, 2); assert.deepEqual(await restarted.a.inspectCurrentAuthority(), await next.a.inspectCurrentAuthority());
});
test("R same-attempt executor switch and revoke never rebind; legacy full hash pinning retained", async () => {
  const x = await setup("same-attempt", "openai"), other = await setup("same-attempt", "anthropic"); await x.a.registerCurrentAuthority();
  assert.equal((await other.a.registerCurrentAuthority()).status, "conflict"); assert.equal((await other.a.advanceCurrentAuthority()).status, "conflict");
  assert.equal((await other.a.revokeCurrentAuthority()).status, "conflict");
  const before = (await x.a.inspectCurrentAuthority()).snapshot!; assert.equal((await x.a.revokeCurrentAuthority()).status, "revoked");
  const after = (await x.a.inspectCurrentAuthority()).snapshot!; assert.equal(after.admissionFingerprint, before.admissionFingerprint); assert.equal(after.admissionScopeFingerprint, before.admissionScopeFingerprint);
});
test("R adjacent capability declaration may change only while concrete invocation remains eligible", async () => {
  const old = await setup("capability-rebind", "openai"), next = await setup("capability-rebind", "anthropic", 2); await old.a.registerCurrentAuthority();
  const configuration = structuredClone(next.config.configuration); configuration.capabilities.tasks = ["coding"]; configuration.capabilities.modes = ["patch_proposal"];
  const a = authority.createPostgresExecutorCurrentAuthorityStore({ database: next.config.database, tenant: next.config.tenant, projectId: next.config.projectId, configuration });
  const advanced = await a.advanceCurrentAuthority(); assert.equal(advanced.status, "advanced");
  const f = facts.deriveExecutorAuthorityFacts(configuration); assert.equal(advanced.snapshot?.admissionFingerprint, f.admissionFingerprint);
  const store = core.createPostgresExecutorStartStore({ ...next.config, configuration });
  assert.equal((await store.reserve(next.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
});
test("R changed stable admission facts conflict; independent capability validation never grants start", async () => {
  const x = await setup("stable", "openai"); await x.a.registerCurrentAuthority(); const next = await setup("stable", "anthropic", 2);
  const config = next.config.configuration;
  const mutations: Array<(c: typeof config) => void> = [c => { c.repository.id = "other-repo"; }, c => { c.repository.baseline = "b".repeat(40); },
    c => { c.admission.plan.goal = "Changed plan"; }, c => { c.admission.plan.id = "other-plan"; c.developmentRun = { ...c.developmentRun, planId: "other-plan" }; },
    c => { c.admission.taskId = "other-task"; c.admission.plan.tasks[0].id = "other-task"; c.developmentRun = { ...c.developmentRun, taskId: "other-task" }; },
    c => { c.admission.plan.tasks[0].requiresOwnerApproval = false; },
    c => { c.admission.taskOwnerApprovalGranted = false; }, c => { c.admission.repositoryAllowlist = ["src", "docs"]; },
    c => { c.admission.completedTaskIds = ["other"] as never[]; }, c => { c.admission.activeTaskIds = ["other"] as never[]; },
    c => { c.admission.plan.tasks[0].allowedPaths = ["src/other"]; }, c => { c.developmentRun = { ...c.developmentRun, id: "other-run" }; }];
  for (const change of mutations) {
    const c = structuredClone(config); change(c); let a: ReturnType<typeof authority.createPostgresExecutorCurrentAuthorityStore>;
    try { a = authority.createPostgresExecutorCurrentAuthorityStore({ database: next.config.database, tenant: next.config.tenant, projectId: next.config.projectId, configuration: c }); } catch (error) { assert.equal((error as Error).message, "invalid_executor_authority_configuration"); continue; }
    assert.equal((await a.advanceCurrentAuthority()).verdict, "deny");
  }
  // A valid but insufficient declaration does not satisfy the concrete coding invocation.
  const insufficient = structuredClone(next.config.configuration); insufficient.capabilities.tasks = ["repository_analysis"]; insufficient.capabilities.modes = ["analysis_only"]; insufficient.capabilities.artifacts = ["report"];
  const s = core.createPostgresExecutorStartStore({ ...next.config, configuration: insufficient });
  assert.equal((await s.reserve(next.raw, { maximumExposureUsdMicros: 10000 })).verdict, "deny");
});
async function legacyDatabase(t: import("node:test").TestContext) {
  const name = `aipc_pgtest_rebindlegacy_${randomUUID().replaceAll("-", "")}`; await db.admin.query(`create database "${name}"`);
  const url = live.databaseUrl(name), admin = live.adminClient(url); await admin.connect();
  t.after(async () => { await Promise.all(pools.splice(0).map(p => p.close())); await admin.end(); await db.admin.query(`drop database "${name}" with(force)`); });
  const directory = new URL("../../db/migrations/", import.meta.url);
  const files = readdirSync(directory).filter(f => /^\d{4}_.*\.sql$/u.test(f)).sort();
  for (const f of files.slice(0, 17)) await admin.query(readFileSync(new URL(f, directory), "utf8"));
  await live.insertWorkspace(admin, live.primaryWorkspace); await admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Legacy')", [live.primaryWorkspace.id]);
  return { admin, url };
}
const migrationSql = () => readFileSync(process.env.AUTHORITY_REBIND_MIGRATION_SQL ?? new URL("../../db/migrations/0018_executor_authority_rebinding.sql", import.meta.url), "utf8");
test("R migration 0018 populated legacy: no invented scope/backfill, same executor advances, rebind denied", async t => {
  const f = await legacyDatabase(t);
  for (const id of ["legacy-same", "legacy-switch"]) {
    const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: f.url, maxConnections: 1 }); pools.push(database);
    const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain); assert.ok(tenant);
    assert.equal((await legacyAuthority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: "project-a", configuration: executorConfiguration(1, id) }).registerCurrentAuthority()).status, "registered");
  }
  const tables = ["executor_run_authorities", "executor_authority_events"], before = [];
  for (const table of tables) before.push((await f.admin.query(`select to_jsonb(t) as value from ${table} t order by development_run_id,authority_generation`)).rows);
  await f.admin.query(migrationSql());
  for (const [index, table] of tables.entries()) {
    assert.deepEqual((await f.admin.query(`select to_jsonb(t)-'admission_scope_fingerprint' as value from ${table} t order by development_run_id,authority_generation`)).rows, before[index]);
    assert.equal((await f.admin.query(`select count(*)::int as n from ${table} where admission_scope_fingerprint is not null`)).rows[0].n, 0);
  }
  // The CURRENT factories also require the B3 binding tables. Prove 0018's
  // preservation above in isolation, then bring the test DB to the current schema
  // before exercising today's factories. These append-only migrations add no
  // executor authority or fabricated legacy controller enrollment.
  for (const path of ["0019_roadmap_foundation.sql", "0020_development_controller.sql"]) await f.admin.query(readFileSync(new URL(path, new URL("../../db/migrations/", import.meta.url)), "utf8"));
  assert.equal((await f.admin.query("select count(*)::int as n from controller_development_runs")).rows[0].n, 0);
  const same = await setup("legacy-same", "openai", 2, f.url); assert.equal((await same.a.advanceCurrentAuthority()).status, "advanced");
  assert.equal((await same.a.inspectCurrentAuthority()).snapshot?.admissionScopeFingerprint, null);
  const switched = await setup("legacy-switch", "anthropic", 2, f.url); assert.equal((await switched.a.advanceCurrentAuthority()).status, "conflict");
  await rejectedSql(f.admin, "update executor_run_authorities set admission_scope_fingerprint=repeat('a',64),authority_generation=authority_generation+1,updated_at=statement_timestamp() where development_run_id='legacy-switch'", "55000");
});
async function rejectedSql(admin: typeof db.admin, sql: string, expected: string) {
  let code: string | null = null; await admin.query("begin");
  try { await admin.query(sql); } catch (e) { code = (e as { code: string }).code; } finally { await admin.query("rollback"); }
  assert.equal(code, expected, "behavioral PostgreSQL guard rejection");
}
test("R direct SQL guards: revoke/advance scope, same-attempt rewrite, non-adjacency, malformed/new-null and journal mismatch", async () => {
  const x = await setup("sql-rebind", "openai"); await x.a.registerCurrentAuthority();
  const base = "update executor_run_authorities set authority_generation=authority_generation+1,updated_at=statement_timestamp(),";
  const suffix = " where development_run_id='sql-rebind'";
  for (const change of ["authority_status='revoked',revoked_at=statement_timestamp(),admission_fingerprint=repeat('e',64)",
    "authority_status='revoked',revoked_at=statement_timestamp(),admission_scope_fingerprint=repeat('e',64)",
    "current_attempt_number=2,current_attempt_kind='corrective',canonical_run_fingerprint=repeat('e',64),admission_scope_fingerprint=repeat('e',64)",
    "current_attempt_number=3,current_attempt_kind='corrective',canonical_run_fingerprint=repeat('e',64)", "admission_fingerprint=repeat('e',64)"])
    await rejectedSql(db.admin, base + change + suffix, "55000");
  const row = (await db.admin.query("select to_jsonb(a) as value from executor_run_authorities a where development_run_id='sql-rebind'")).rows[0].value;
  for (const scope of [null, "bad"]) {
    const changed = { ...row, development_run_id: `invalid-${scope ?? 'null'}`, admission_scope_fingerprint: scope };
    let code: unknown; try { await db.admin.query("insert into executor_run_authorities select(jsonb_populate_record(null::executor_run_authorities,$1::jsonb)).*", [JSON.stringify(changed)]); } catch (e) { code = (e as { code: string }).code; }
    assert.equal(code, "23514");
  }
  await rejectedSql(db.admin, "insert into executor_authority_events select (jsonb_populate_record(null::executor_authority_events,(to_jsonb(e)||jsonb_build_object('admission_scope_fingerprint',repeat('e',64))))).* from executor_authority_events e where development_run_id='sql-rebind'", "23514");
});
for (const [from, to] of [["openai", "anthropic"], ["anthropic", "openai"]] as const) test(`R switch predecessor ${from}->${to}, stale exposure and historical settlement`, async () => {
  const id = `barrier-${from}`, old = await setup(id, from); await old.a.registerCurrentAuthority(); await old.store.reserve(old.raw, { maximumExposureUsdMicros: 10000 });
  const prepared = await old.store.bindRequest(old.raw, context()); assert.ok(prepared.snapshot?.requestFingerprint); const fp = prepared.snapshot.requestFingerprint;
  const start = await old.store.commitProviderStart(old.raw, fp); assert.ok(start.startCapability);
  const next = await setup(id, to, 2); assert.equal((await next.a.advanceCurrentAuthority()).status, "advanced");
  await old.store.markReconciliationRequired(old.raw); assert.equal((await next.store.reserve(next.raw, { maximumExposureUsdMicros: 10000 })).status, "recovery_required");
  // Synthetic evidence is fixture-owned and uses the actual common result contract.
  const adapter = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
  const capture = await import(new URL("../../lib/executors/executor-outcome.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-outcome");
  const a = adapter.createExecutorAdapterContract(old.config.configuration).adapter!, i = a.validateInvocation(old.raw).normalizedInvocation!;
  const r = a.evaluateResult(i, { schemaVersion: 1, identity: i.identity, invocationId: i.invocationId, status: "failed", failureCode: "execution_failure", changes: [], report: null }).normalizedResult;
  const receipt = await capture.createExecutorOutcomeCapture(old.config.configuration, { capture: () => ({ terminality: "definitive_terminal", normalizedResult: r, usage: null, providerConsumedCents: 0 }) }).capture(old.raw, fp);
  assert.equal((await old.store.recordDefinitiveOutcomeAndSettle(old.raw, fp, receipt)).status, "settled");
  assert.equal((await next.store.reserve(next.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
});
for (const [from, to] of [["openai", "anthropic"], ["anthropic", "openai"]] as const) for (const order of ["old-start", "rebind"] as const)
  test(`R race ${from}->${to} ${order} wins: 10 independent-backend iterations, no duplicate right`, async () => {
    for (let n = 0; n < 10; n++) {
      const id = `race-${from}-${order}-${n}`, old = await setup(id, from), next = await setup(id, to, 2); await old.a.registerCurrentAuthority();
      await old.store.reserve(old.raw, { maximumExposureUsdMicros: 10000 }); const p = await old.store.bindRequest(old.raw, context()); assert.ok(p.snapshot?.requestFingerprint);
      let release!: () => void, reached!: () => void; const wait = new Promise<void>(r => { release = r; }), at = new Promise<void>(r => { reached = r; });
      const interceptor = live.installQueryInterceptor(), tag = order === "old-start" ? "executor:start" : "executor:authority-advance";
      interceptor.rules.push(live.rule("factual lock latch", live.sqlTag(tag), async (_c, cfg, vals, send) => { const r = await send(cfg, vals); reached(); await wait; return r; }));
      try {
        const first = order === "old-start" ? old.store.commitProviderStart(old.raw, p.snapshot.requestFingerprint) : next.a.advanceCurrentAuthority();
        await at; let secondDone = false;
        const second = (order === "old-start" ? next.a.advanceCurrentAuthority() : old.store.commitProviderStart(old.raw, p.snapshot.requestFingerprint)).finally(() => { secondDone = true; });
        await live.sleep(10); assert.equal(secondDone, false); release(); const [a, b] = await Promise.all([first, second]);
        if (order === "old-start") { assert.equal(a.status, "start_committed"); assert.equal(b.status, "advanced"); assert.equal((await next.store.reserve(next.raw, { maximumExposureUsdMicros: 10000 })).status, "recovery_required"); }
        else {
          assert.equal(a.status, "advanced"); assert.equal(b.verdict, "deny"); assert.equal((await old.store.commitProviderStart(old.raw, p.snapshot.requestFingerprint)).startCapability, null);
          assert.equal((await next.store.reserve(next.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
          const prepared = await next.store.bindRequest(next.raw, context()); assert.ok(prepared.snapshot?.requestFingerprint);
          assert.ok((await next.store.commitProviderStart(next.raw, prepared.snapshot.requestFingerprint)).startCapability);
        }
        assert.equal((await db.admin.query("select count(*)::int as n from executor_attempt_exposures where development_run_id=$1 and started_at is not null", [id])).rows[0].n, 1);
      } finally { release(); interceptor.restore(); }
    }
  });
