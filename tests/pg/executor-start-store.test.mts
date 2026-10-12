import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, financialPolicy, executorTarget, context } from "../fixtures/durable-executor.mts";
const location = new URL("../../lib/db/executor-start-store.ts", import.meta.url);
const durable = existsSync(location) ? await import(location.href) as typeof import("../../lib/db/executor-start-store") : null;
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const db = await live.useLiveDatabase("executorfence");
for (const workspace of [live.primaryWorkspace, live.secondaryWorkspace]) {
  await live.insertWorkspace(db.admin, workspace);
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Executor test project')", [workspace.id]);
}
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
async function store(runId: string, number = 1, options: Record<string, unknown> = {}) {
  assert.equal(typeof durable?.createPostgresExecutorStartStore, "function", "baseline has no durable executor authority");
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain); assert.ok(tenant);
  // Trusted test setup only, never implicit production registration/advancement.
  const c = { database, tenant, projectId: "project-a", configuration: executorConfiguration(number, runId), ...options };
  const a = authority.createPostgresExecutorCurrentAuthorityStore({ database: c.database, tenant: c.tenant, projectId: c.projectId, configuration: c.configuration });
  await a.registerCurrentAuthority();
  return durable!.createPostgresExecutorStartStore({ database, tenant, projectId: "project-a", configuration: executorConfiguration(number, runId),
    target: executorTarget(), financialPolicy: financialPolicy(), authorizeStart: () => true, ...options });
}
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.close())); });
const exposure = { maximumExposureUsdMicros: 10000 };
test("PG OS process restart: reserve/prepare/start survive separate Node processes; no capability resurrection", () => {
  const script = `
    import { pathToFileURL } from 'node:url';
    const root = pathToFileURL(process.cwd() + '/');
    const { createWorkflowRuntimePostgresDatabase } = await import(new URL('lib/db/postgres.ts', root));
    const { createPostgresWorkflowRuntimeTenantResolver } = await import(new URL('lib/db/workflow-runtime-tenant.ts', root));
    const { createPostgresExecutorStartStore } = await import(new URL('lib/db/executor-start-store.ts', root));
    const { createPostgresExecutorCurrentAuthorityStore } = await import(new URL('lib/db/executor-current-authority-store.ts', root));
    const f = await import(new URL('tests/fixtures/durable-executor.mts', root));
    const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.EXECUTOR_TEST_DB, maxConnections: 1 });
    try {
      const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(process.env.EXECUTOR_TEST_DOMAIN);
      const s = createPostgresExecutorStartStore({ database, tenant, projectId: 'project-a', configuration: f.executorConfiguration(1, 'process-restart'),
        target: f.executorTarget(), financialPolicy: f.financialPolicy(), authorizeStart: () => true });
      const raw = f.executorRequest(1, 'process-restart'), stage = process.env.EXECUTOR_TEST_STAGE;
      if (stage === 'reserve') await createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: 'project-a', configuration: f.executorConfiguration(1, 'process-restart') }).registerCurrentAuthority();
      const read = stage === 'reserve' ? null : await s.inspect(raw);
      const d = stage === 'reserve' ? await s.reserve(raw, { maximumExposureUsdMicros: 10000 })
        : stage === 'prepare' ? await s.bindRequest(raw, f.context())
        : stage === 'replace' ? await s.reserve({ ...raw, invocationId: 'replacement' }, { maximumExposureUsdMicros: 10000 })
        : await s.commitProviderStart(raw, read.snapshot.requestFingerprint);
      process.stdout.write(JSON.stringify({ pid: process.pid, status: d.status, snapshot: d.snapshot, capability: d.startCapability !== null, before: read?.snapshot ?? null }));
    } catch { process.stderr.write('Controlled restart harness failed'); process.exitCode = 1; }
    finally { await database.close(); }
  `;
  const evaluate = (stage: string) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-"], { input: script, encoding: "utf8", timeout: 15000,
      env: { ...process.env, EXECUTOR_TEST_DB: db.url, EXECUTOR_TEST_DOMAIN: live.primaryWorkspace.domain, EXECUTOR_TEST_STAGE: stage } });
    assert.equal(result.status, 0, "isolated Node process completed without driver errors/timeouts");
    return JSON.parse(result.stdout);
  };
  const reserved = evaluate("reserve"), prepared = evaluate("prepare"), started = evaluate("start"), replay = evaluate("start"), changed = evaluate("replace");
  assert.equal(new Set([reserved, prepared, started, replay, changed].map(r => r.pid)).size, 5);
  assert.equal(reserved.status, "reserved"); assert.deepEqual(prepared.before, reserved.snapshot);
  assert.equal(prepared.status, "prepared"); assert.deepEqual(started.before, prepared.snapshot);
  assert.equal(started.status, "start_committed"); assert.equal(started.capability, true);
  assert.deepEqual(replay.before, started.snapshot); assert.equal(replay.before.heldExposureUsdMicros, 10000);
  assert.equal(replay.status, "recovery_required"); assert.equal(replay.capability, false); assert.equal(replay.snapshot, null);
  assert.equal(changed.status, "conflict"); assert.equal(changed.snapshot, null); assert.equal(changed.capability, false);
});
test("PG restart: durable reservation, preparation and aggregate exposure survive recreation", async () => {
  const raw = executorRequest(1, "restart"), first = await store("restart");
  assert.equal((await first.reserve(raw, exposure)).status, "reserved");
  const bound = await first.bindRequest(raw, context()); assert.equal(bound.status, "prepared");
  const second = await store("restart"), read = await second.inspect(raw);
  assert.deepEqual(read.snapshot, bound.snapshot); assert.equal(read.snapshot?.heldExposureUsdMicros, 10000);
  assert.equal((await second.reserve(raw, exposure)).status, "idempotent");
});
test("PG independent connections: same attempt has exactly one committed start; restart cannot reissue", async () => {
  const raw = executorRequest(1, "single-start"), a = await store("single-start"), b = await store("single-start");
  await a.reserve(raw, exposure); const p = await a.bindRequest(raw, context()); assert.ok(p.snapshot?.requestFingerprint);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).commitProviderStart(raw, p.snapshot!.requestFingerprint)));
  assert.equal(results.filter(d => d.status === "start_committed").length, 1);
  assert.equal(results.filter(d => d.startCapability !== null).length, 1);
  const c = await store("single-start"); assert.equal((await c.commitProviderStart(raw, p.snapshot.requestFingerprint)).status, "recovery_required");
  assert.equal((await c.cancel(raw)).status, "recovery_required");
});
test("PG factual attempts: changed invocation ID cannot reserve again; legitimate corrective 2/3 can", async () => {
  for (const number of [1, 2, 3]) {
    const s = await store("corrective", number), raw = executorRequest(number, "corrective", `invocation-${number}`);
    if (number > 1) {
      const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
      const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain); assert.ok(tenant);
      assert.equal((await authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: "project-a", configuration: executorConfiguration(number, "corrective") }).advanceCurrentAuthority()).status, "advanced");
    }
    assert.equal((await s.reserve(raw, exposure)).status, "reserved");
    assert.equal((await s.reserve({ ...raw, invocationId: "replacement" }, exposure)).status, "conflict");
    assert.equal((await s.cancel(raw)).status, "cancelled");
  }
});
const held = async (workspace: string = live.primaryWorkspace.id) => Number((await db.admin.query("select held_exposure_usd_micros::text as held from executor_exposure_budgets where workspace_id=$1", [workspace])).rows[0]?.held ?? 0);
const rows = async (runId: string) => (await db.admin.query("select state, count(*)::int as count from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2 group by state", [live.primaryWorkspace.id, runId])).rows;
function failClosed(d: import("../../lib/db/executor-start-store").DurableExecutorDecision) {
  assert.equal(d.verdict, "deny"); assert.equal(d.snapshot, null); assert.equal(d.startCapability, null);
}
async function prepared(runId: string, options: Record<string, unknown> = {}) {
  const s = await store(runId, 1, options), raw = executorRequest(1, runId);
  assert.equal((await s.reserve(raw, exposure)).status, "reserved");
  const p = await s.bindRequest(raw, context()); assert.equal(p.status, "prepared"); assert.ok(p.snapshot?.requestFingerprint);
  return { s, raw, fingerprint: p.snapshot.requestFingerprint, snapshot: p.snapshot };
}
test("PG aggregate: ten independent connections cannot race above durable total; policy cannot be replaced", async () => {
  const workspace = { id: randomUUID(), domain: "aggregate-workspace" }; await live.insertWorkspace(db.admin, workspace);
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Aggregate')", [workspace.id]);
  await db.admin.query("insert into executor_exposure_budgets(workspace_id,maximum_exposure_usd_micros,total_exposure_usd_micros,reservation_ttl_ms) values($1,20000,50000,60000)", [workspace.id]);
  const results = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
    const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(workspace.domain); assert.ok(tenant);
    const runId = `aggregate-${index}`;
    const s = await store(runId, 1, { database, tenant, financialPolicy: { ...financialPolicy(), totalExposureUsdMicros: 50000 } });
    return { s, raw: executorRequest(1, runId), d: await s.reserve(executorRequest(1, runId), { maximumExposureUsdMicros: 19999 }) };
  }));
  assert.equal(results.filter(r => r.d.status === "reserved").length, 2);
  assert.equal(await held(workspace.id), 39998); assert.ok(await held(workspace.id) <= 50000);
  for (const r of results) if (r.d.verdict === "deny") failClosed(r.d);
  for (const r of results) if (r.d.verdict === "allow") {
    assert.equal(r.d.snapshot?.providerSpendLimitCents, 1); assert.equal(r.d.snapshot?.maximumExposureUsdMicros, 19999);
    await r.s.cancel(r.raw);
  }
  assert.equal(await held(workspace.id), 0);
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(workspace.domain); assert.ok(tenant);
  const replaced = await store("aggregate-repolicy", 1, { database, tenant, financialPolicy: { ...financialPolicy(), totalExposureUsdMicros: 60000 } });
  failClosed(await replaced.reserve(executorRequest(1, "aggregate-repolicy"), exposure));
  assert.equal((await db.admin.query("select total_exposure_usd_micros::text as total from executor_exposure_budgets where workspace_id=$1", [workspace.id])).rows[0].total, "50000");
});
test("PG concurrency x10: independent sessions commit exactly one start, never a restart/replay capability", async () => {
  const interceptor = live.installQueryInterceptor(), pids = new Set<number>();
  interceptor.observe((_sql, client) => { if (client.processID) pids.add(client.processID); });
  try { for (let n = 0; n < 10; n++) {
    const id = `start-race-${n}`, { s: a, raw, fingerprint } = await prepared(id), b = await store(id);
    const decisions = await Promise.all([a.commitProviderStart(raw, fingerprint), b.commitProviderStart(raw, fingerprint)]);
    const winners = decisions.filter(d => d.status === "start_committed"); assert.equal(winners.length, 1);
    const capability = winners[0].startCapability; assert.ok(capability);
    assert.equal(durable!.consumeDurableExecutorStartCapability({ ...capability }), null);
    assert.equal(durable!.consumeDurableExecutorStartCapability(capability)?.state, "start_committed");
    assert.equal(durable!.consumeDurableExecutorStartCapability(capability), null);
    const fresh = await store(id); failClosed(await fresh.commitProviderStart(raw, fingerprint));
    failClosed(await fresh.reserve({ ...raw, invocationId: "restart-replacement" }, exposure));
    assert.deepEqual(await rows(id), [{ state: "start_committed", count: 1 }]);
    assert.equal((await db.admin.query("select count(*)::int as count from executor_attempt_events where workspace_id=$1 and development_run_id=$2 and operation='start'", [live.primaryWorkspace.id, id])).rows[0].count, 1);
    await Promise.all(pools.splice(0).map(pool => pool.close()));
  } } finally { interceptor.restore(); }
  assert.ok(pids.size >= 20, "independent real PostgreSQL backends, not LedgerFakeStore");
});
test("PG double cancel x10: release exactly once, never reopen cancelled attempt", async () => {
  for (let n = 0; n < 10; n++) {
    const id = `cancel-race-${n}`, { s: a, raw } = await prepared(id), b = await store(id), before = await held();
    const decisions = await Promise.all([a.cancel(raw), b.cancel(raw)]);
    assert.equal(decisions.filter(d => d.status === "cancelled").length, 1);
    assert.equal(decisions.filter(d => d.status === "idempotent").length, 1);
    assert.equal(await held(), before - 10000); failClosed(await b.reserve(raw, exposure));
    assert.deepEqual(await rows(id), [{ state: "cancelled", count: 1 }]);
    await Promise.all(pools.splice(0).map(pool => pool.close()));
  }
});
test("PG start-vs-cancel x10: one legal outcome, no post-start release", async () => {
  for (let n = 0; n < 10; n++) {
    const id = `start-cancel-${n}`, { s: a, raw, fingerprint } = await prepared(id), b = await store(id), before = await held();
    const operations = [() => a.commitProviderStart(raw, fingerprint), () => b.cancel(raw)]; if (n % 2) operations.reverse();
    const decisions = await Promise.all(operations.map(op => op()));
    const state = (await rows(id))[0]; assert.equal(state.count, 1);
    if (state.state === "start_committed") {
      assert.equal(decisions.filter(d => d.startCapability !== null).length, 1); assert.equal(await held(), before);
      failClosed(await b.cancel(raw)); assert.equal(await held(), before);
    } else { assert.equal(state.state, "cancelled"); assert.equal(decisions.filter(d => d.startCapability !== null).length, 0); assert.equal(await held(), before - 10000); }
    await Promise.all(pools.splice(0).map(pool => pool.close()));
  }
});
test("PG one-way binding: changed context/fingerprint cannot rebind or start", async () => {
  const { s, raw, fingerprint, snapshot } = await prepared("fingerprint");
  assert.equal((await s.bindRequest(raw, context())).status, "idempotent");
  assert.equal((await s.bindRequest(raw, { files: [] })).status, "conflict");
  failClosed(await s.commitProviderStart(raw, "f".repeat(64)));
  assert.deepEqual((await s.inspect(raw)).snapshot, snapshot);
  assert.equal((await s.commitProviderStart(raw, fingerprint)).status, "start_committed");
});
for (const changed of ["executor", "version", "repository", "baseline", "account", "model", "mode", "invocation"])
  test(`PG binding conflict: changing ${changed} does not create a new factual attempt`, async () => {
    const id = `binding-${changed}`, { raw, fingerprint } = await prepared(id), configuration = executorConfiguration(1, id);
    const target = executorTarget(), candidate = executorRequest(1, id);
    if (changed === "executor") { configuration.identity.id = "other"; candidate.identity.id = "other"; }
    if (changed === "version") { configuration.identity.version = "v2"; candidate.identity.version = "v2"; }
    if (changed === "repository") { configuration.repository.id = "other"; candidate.repository.id = "other"; }
    if (changed === "baseline") { configuration.repository.baseline = "b".repeat(40); candidate.repository.baseline = "b".repeat(40); }
    if (changed === "account") target.accountId = "account-b";
    if (changed === "model") target.modelId = "other-model";
    if (changed === "mode") { candidate.mode = "analysis_only"; candidate.capability = "repository_analysis"; }
    if (changed === "invocation") candidate.invocationId = "replacement";
    const s = await store(id, 1, { configuration, target });
    for (const d of [await s.reserve(candidate, exposure), await s.bindRequest(candidate, context()), await s.commitProviderStart(candidate, fingerprint)]) {
      assert.equal(d.status, "conflict"); failClosed(d);
    }
    assert.equal((await rows(raw.attempt.developmentRunId))[0].count, 1);
  });
test("PG workspace/account isolation: foreign tenant cannot inspect, prepare, cancel or commit another tenant's attempt", async () => {
  const { raw, fingerprint } = await prepared("tenant-isolation");
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.secondaryWorkspace.domain); assert.ok(tenant);
  await db.admin.query("insert into executor_exposure_budgets(workspace_id,maximum_exposure_usd_micros,total_exposure_usd_micros,reservation_ttl_ms) values($1,20000,1000000000,60000)", [live.secondaryWorkspace.id]);
  const foreign = await store("tenant-isolation", 1, { database, tenant });
  for (const d of [await foreign.inspect(raw), await foreign.bindRequest(raw, context()), await foreign.cancel(raw), await foreign.commitProviderStart(raw, fingerprint)]) failClosed(d);
  const absent = executorRequest(1, "tenant-absent"), missing = await store("tenant-absent", 1, { database, tenant });
  assert.deepEqual(await foreign.inspect(raw), await missing.inspect(absent), "opaque missing vs other-tenant read");
});
test("PG policy/project/tenant revocation is checked inside the start transaction", async () => {
  const { s, raw, fingerprint } = await prepared("revocation");
  await db.admin.query("update projects set status='paused' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]);
  try { failClosed(await s.commitProviderStart(raw, fingerprint)); assert.equal((await rows("revocation"))[0].state, "prepared"); }
  finally { await db.admin.query("update projects set status='active' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]); }
  assert.equal((await s.commitProviderStart(raw, fingerprint)).status, "start_committed");
});
test("PG expiry: lock wait does not authorize a reservation expired while waiting; expiry never releases by itself", async () => {
  const workspace = { id: randomUUID(), domain: "expiry-workspace" }; await live.insertWorkspace(db.admin, workspace);
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Expiry')", [workspace.id]);
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(workspace.domain); assert.ok(tenant);
  const { s, raw, fingerprint } = await prepared("expiry", { database, tenant, financialPolicy: { ...financialPolicy(), reservationTtlMs: 1000 } });
  const blocker = live.adminClient(db.url); await blocker.connect();
  try {
    await blocker.query("begin"); await blocker.query("select workspace_id from executor_exposure_budgets where workspace_id=$1 for update", [workspace.id]);
    const pending = s.commitProviderStart(raw, fingerprint); await live.sleep(1100); await blocker.query("commit");
    failClosed(await pending); assert.equal(await held(workspace.id), 10000);
    assert.equal((await s.cancel(raw)).status, "cancelled"); assert.equal(await held(workspace.id), 0);
  } finally { await blocker.query("rollback"); await blocker.end(); }
});
test("PG reconciliation/evidence: sticky unknown state holds full micros; zero/best-effort usage never settles", async () => {
  const { s, raw, fingerprint } = await prepared("reconcile"), before = await held();
  await s.commitProviderStart(raw, fingerprint);
  assert.equal((await s.recordEvidence(raw, { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, providerConsumedCents: 0 })).status, "recorded");
  const r = await s.markReconciliationRequired(raw); assert.equal(r.snapshot?.state, "reconciliation_required");
  assert.equal(r.snapshot?.heldExposureUsdMicros, 10000); assert.equal(r.snapshot?.observedCostUsdMicros, null);
  const recreated = await store("reconcile"), e = await recreated.recordEvidence(raw, { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, providerConsumedCents: 2 });
  assert.equal(e.snapshot?.reconciliation, "reconciliation_required"); assert.equal(e.snapshot?.heldExposureUsdMicros, 10000);
  const repeated = await recreated.recordEvidence(raw, { usage: { totalTokens: 3, outputTokens: 2, inputTokens: 1 }, providerConsumedCents: 2 });
  assert.equal(repeated.status, "idempotent"); assert.deepEqual(repeated.snapshot, e.snapshot);
  assert.equal(await held(), before); failClosed(await recreated.cancel(raw)); failClosed(await recreated.commitProviderStart(raw, fingerprint));
  for (const evidence of [{ usage: { inputTokens: 1, outputTokens: 2, totalTokens: 4 }, providerConsumedCents: 0 },
    { usage: null, providerConsumedCents: 0 }, { usage: null, providerConsumedCents: -1 }, { usage: null, providerConsumedCents: 0, settlement: true }]) failClosed(await recreated.recordEvidence(raw, evidence));
});
test("PG COMMIT ambiguity: acknowledged server commit with lost client acknowledgement returns NO capability; recreate remains fenced", async () => {
  const { s, raw, fingerprint } = await prepared("commit-unknown"), interception = live.installQueryInterceptor();
  interception.rules.push(live.rule("lost commit acknowledgement", live.sqlTag("executor-transaction:commit"), async (_client, cfg, values, send) => {
    await send(cfg, values); throw Error("private-driver-error-never-project");
  }));
  try {
    const d = await s.commitProviderStart(raw, fingerprint); assert.equal(d.status, "recovery_required"); failClosed(d);
    assert.ok(!JSON.stringify(d).includes("private-driver")); assert.equal(interception.rules[0].fired, 1);
  } finally { interception.restore(); }
  failClosed(await s.commitProviderStart(raw, fingerprint));
  const second = await store("commit-unknown"); failClosed(await second.commitProviderStart(raw, fingerprint));
  assert.deepEqual(await rows("commit-unknown"), [{ state: "start_committed", count: 1 }]);
});
test("PG corruption: counter drift/impossible state fails closed before start", async () => {
  const { s, raw, fingerprint } = await prepared("corrupt-counter"), before = await held();
  await db.admin.query("update executor_exposure_budgets set held_exposure_usd_micros=held_exposure_usd_micros+1 where workspace_id=$1", [live.primaryWorkspace.id]);
  try { failClosed(await s.commitProviderStart(raw, fingerprint)); assert.equal((await rows("corrupt-counter"))[0].state, "prepared"); }
  finally { await db.admin.query("update executor_exposure_budgets set held_exposure_usd_micros=$2 where workspace_id=$1", [live.primaryWorkspace.id, before]); }
});
test("PG direct writes: constraints/FKs reject invalid shapes, cross-tenant project, duplicate attempt and missing audit", async () => {
  const { raw } = await prepared("constraints");
  const row = (await db.admin.query("select to_jsonb(a) as value from executor_attempt_exposures a where workspace_id=$1 and development_run_id=$2", [live.primaryWorkspace.id, raw.attempt.developmentRunId])).rows[0].value;
  const attempt = async (value: unknown) => { try {
    await db.admin.query("insert into executor_attempt_exposures select (jsonb_populate_record(null::executor_attempt_exposures,$1::jsonb)).*", [JSON.stringify(value)]); return "accepted";
  } catch (error) { return (error as { code: string }).code; } };
  assert.equal(await attempt({ ...row, id: randomUUID() }), "23505");
  for (const change of [{ attempt_number: 0 }, { attempt_number: 2, attempt_kind: "initial" }, { provider_spend_limit_cents: 2 },
    { state: "start_committed", started_at: null }, { observed_input_tokens: 1 }, { observed_total_tokens: 0 }, { provider_consumed_cents: -1 }])
    assert.equal(await attempt({ ...row, id: randomUUID(), development_run_id: "invalid-direct", ...change }), "23514");
  assert.equal(await attempt({ ...row, id: randomUUID(), development_run_id: "audit-missing" }), "23503");
  assert.equal(await attempt({ ...row, id: randomUUID(), development_run_id: "project-missing", project_key: "not-in-tenant" }), "23503");
  await assert.rejects(db.admin.query("update executor_attempt_exposures set request_fingerprint=$3 where workspace_id=$1 and development_run_id=$2", [live.primaryWorkspace.id, raw.attempt.developmentRunId, "d".repeat(64)]));
  await assert.rejects(db.admin.query("delete from executor_attempt_events where workspace_id=$1 and development_run_id=$2", [live.primaryWorkspace.id, raw.attempt.developmentRunId]));
});
