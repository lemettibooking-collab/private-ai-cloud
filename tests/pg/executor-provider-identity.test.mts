import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, financialPolicy, executorTarget, context, executorRequestPolicy } from "../fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { receipt } from "../fixtures/executor-outcome.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { identityTransport, frozen } from "../fixtures/executor-provider-identity.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { legacyAuthority, legacyCore } from "../fixtures/legacy-executor-authority.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const durable = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const seam = await import(new URL("../../lib/executors/executor-provider-request.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-provider-request");
const db = await live.useLiveDatabase("provideridentity");
for (const workspace of [live.primaryWorkspace, live.secondaryWorkspace]) {
  await live.insertWorkspace(db.admin, workspace);
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Identity test project')", [workspace.id]);
}
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
async function setup(runId: string, domain: string = live.primaryWorkspace.domain, url = db.url, historical = false) {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(domain); assert.ok(tenant);
  const config = { database, tenant, projectId: "project-a", configuration: executorConfiguration(1, runId), target: executorTarget(), requestPolicy: executorRequestPolicy(), financialPolicy: financialPolicy(), authorizeStart: () => true };
  const a = (historical ? legacyAuthority : authority).createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: config.projectId, configuration: config.configuration }); await a.registerCurrentAuthority();
  return { config, authority: a, store: (historical ? legacyCore : durable).createPostgresExecutorStartStore(config), raw: executorRequest(1, runId) };
}
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.close())); });
test("PG identity: durable correlation/session/turn restart and conflict primitives exist (baseline RED)", async () => {
  const f = await setup("identity-red");
  assert.equal(typeof f.store.prepareProviderCorrelation, "function");
  await f.store.reserve(f.raw, { maximumExposureUsdMicros: 10000 });
  const prepared = await f.store.bindRequest(f.raw, context()); assert.ok(prepared.snapshot?.requestFingerprint);
  const started = await f.store.commitProviderStart(f.raw, prepared.snapshot.requestFingerprint); assert.ok(started.startCapability);
  const correlation = await f.store.prepareProviderCorrelation(f.raw, context(), started.startCapability);
  assert.equal(correlation.verdict, "allow");
  const fresh = durable.createPostgresExecutorStartStore(f.config);
  assert.deepEqual((await fresh.inspectProviderIdentity(f.raw)).providerIdentity, correlation.providerIdentity);
});
function denied(d: import("../../lib/db/executor-provider-identity-store").ExecutorProviderIdentityDecision) {
  assert.equal(d.verdict, "deny"); assert.equal(d.snapshot, null); assert.equal(d.startCapability, null);
  assert.equal(d.providerIdentity, null); assert.equal(d.providerCapability, null); frozen(d);
}
async function started(id: string) {
  const f = await setup(id);
  await f.store.reserve(f.raw, { maximumExposureUsdMicros: 10000 });
  const prepared = await f.store.bindRequest(f.raw, context()); assert.ok(prepared.snapshot?.requestFingerprint);
  const start = await f.store.commitProviderStart(f.raw, prepared.snapshot.requestFingerprint); assert.ok(start.startCapability);
  return { ...f, fp: prepared.snapshot.requestFingerprint, start: start.startCapability };
}
async function correlated(id: string) {
  const f = await started(id), correlation = await f.store.prepareProviderCorrelation(f.raw, context(), f.start);
  assert.equal(correlation.status, "prepared"); assert.ok(correlation.providerIdentity); assert.ok(correlation.providerCapability);
  return { ...f, correlation, observation: { requestFingerprint: f.fp, correlationFingerprint: correlation.providerIdentity.correlationFingerprint,
    target: executorTarget(), sessionId: `session_${id}` }, turnId: `turn_${id}` };
}
async function facts(id: string) {
  const key = [live.primaryWorkspace.id, id];
  return {
    identities: (await db.admin.query("select * from executor_provider_executions where workspace_id=$1 and development_run_id=$2", key)).rows,
    events: (await db.admin.query("select * from executor_provider_identity_events where workspace_id=$1 and development_run_id=$2 order by event_version", key)).rows,
    exposure: (await db.admin.query("select state,maximum_exposure_usd_micros::text,request_fingerprint from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2", key)).rows,
    results: (await db.admin.query("select result_fingerprint from executor_attempt_results where workspace_id=$1 and development_run_id=$2", key)).rows,
  };
}
test("PG no correlation/start capability reconstruction from row, clone or shaped local ticket", async () => {
  const f = await started("no-reconstructed-start");
  denied(await f.store.inspectProviderIdentity(f.raw));
  for (const cap of [null, {}, { ...f.start }, { kind: "executor_test_start" }]) denied(await f.store.prepareProviderCorrelation(f.raw, context(), cap));
  assert.equal((await facts("no-reconstructed-start")).identities.length, 0);
  const d = await f.store.prepareProviderCorrelation(f.raw, context(), f.start); assert.ok(d.providerCapability);
  assert.equal(durable.consumeDurableExecutorStartCapability(f.start), null);
  const replay = await f.store.prepareProviderCorrelation(f.raw, context()); assert.equal(replay.status, "idempotent"); assert.equal(replay.providerCapability, null);
  assert.equal(await durable.createPostgresExecutorStartStore(f.config).createProviderIdentityObserver(f.raw, d.providerCapability).beforeTransmission(f.fp), false);
  for (const cap of [null, {}, d.providerIdentity, d.snapshot, { ...d.providerCapability }, { kind: "executor_test_start" }])
    assert.equal(await f.store.createProviderIdentityObserver(f.raw, cap).beforeTransmission(f.fp), false);
});
test("PG identity reads fresh/frozen/deterministic; exact correlation replay preserves row/journal and immutable input", async () => {
  const f = await correlated("correlation-replay"), before = structuredClone({ raw: f.raw, context: context(), configuration: f.config.configuration });
  const saved = await facts("correlation-replay"), fresh = durable.createPostgresExecutorStartStore(f.config);
  const a = await fresh.inspectProviderIdentity(f.raw), b = await fresh.inspectProviderIdentity(f.raw);
  assert.deepEqual(a, b); assert.notEqual(a.providerIdentity, b.providerIdentity); frozen(a); frozen(b);
  const replay = await fresh.prepareProviderCorrelation(f.raw, context()); assert.equal(replay.status, "idempotent"); assert.equal(replay.providerCapability, null);
  assert.deepEqual(replay.providerIdentity, a.providerIdentity); assert.deepEqual(await facts("correlation-replay"), saved);
  assert.deepEqual({ raw: f.raw, context: context(), configuration: f.config.configuration }, before);
});
test("PG session write-once, turn requires exact session; exact replay is idempotent", async () => {
  const f = await correlated("observation"), before = structuredClone(f.observation);
  denied(await f.store.recordProviderTurn(f.raw, { ...f.observation, turnId: f.turnId }));
  assert.equal((await f.store.recordProviderSession(f.raw, f.observation)).status, "recorded");
  assert.equal((await f.store.recordProviderSession(f.raw, f.observation)).status, "idempotent");
  assert.equal((await f.store.recordProviderTurn(f.raw, { ...f.observation, turnId: f.turnId })).status, "recorded");
  const saved = await facts("observation");
  assert.equal((await f.store.recordProviderTurn(f.raw, { ...f.observation, turnId: f.turnId })).status, "idempotent");
  assert.deepEqual(await facts("observation"), saved); assert.deepEqual(f.observation, before);
  const fresh = durable.createPostgresExecutorStartStore(f.config), d = await fresh.inspectProviderIdentity(f.raw);
  assert.equal(d.providerIdentity?.sessionId, f.observation.sessionId); assert.equal(d.providerIdentity?.turnId, f.turnId);
  assert.equal(d.providerIdentity?.identityState, "turn_observed"); assert.equal(d.startCapability, null); assert.equal(d.providerCapability, null);
});
for (const phase of ["session", "turn"]) test(`PG conflicting ${phase} is a durable incident, never rebinding or releasing exposure`, async () => {
  const id = `conflict-${phase}`, f = await correlated(id);
  await f.store.recordProviderSession(f.raw, f.observation);
  if (phase === "turn") await f.store.recordProviderTurn(f.raw, { ...f.observation, turnId: f.turnId });
  const d = phase === "session" ? await f.store.recordProviderSession(f.raw, { ...f.observation, sessionId: "another-session" })
    : await f.store.recordProviderTurn(f.raw, { ...f.observation, turnId: "another-turn" });
  denied(d); assert.equal(d.status, "recovery_required");
  const read = await f.store.inspectProviderIdentity(f.raw); assert.equal(read.providerIdentity?.sessionId, f.observation.sessionId);
  assert.equal(read.providerIdentity?.turnId, phase === "turn" ? f.turnId : null); assert.equal(read.providerIdentity?.recoveryRequired, true);
  assert.equal(read.snapshot?.state, "reconciliation_required"); assert.equal(read.snapshot?.heldExposureUsdMicros, 10000);
  assert.equal((await facts(id)).results.length, 0); assert.equal((await f.store.commitProviderStart(f.raw, f.fp)).startCapability, null);
});
for (const field of ["request", "correlation", "provider", "model", "account", "attempt", "run", "caller-id"]) test(`PG ${field} mismatch cannot attach identity`, async () => {
  const f = await correlated(`mismatch-${field}`), before = await facts(`mismatch-${field}`);
  const raw = structuredClone(f.raw), o = structuredClone(f.observation);
  if (field === "request") o.requestFingerprint = "f".repeat(64);
  if (field === "correlation") o.correlationFingerprint = "f".repeat(64);
  if (field === "provider") o.target.providerId = "foreign";
  if (field === "model") o.target.modelId = "foreign";
  if (field === "account") o.target.accountId = "foreign";
  if (field === "attempt") raw.attempt.number = 2;
  if (field === "run") raw.attempt.developmentRunId = "foreign";
  const candidate = field === "caller-id" ? { ...raw, providerSessionId: "caller-selected" } : raw;
  denied(await f.store.recordProviderSession(candidate, o)); denied(await f.store.recordProviderSession(candidate, o));
  assert.deepEqual(await facts(`mismatch-${field}`), before);
});
test("PG malformed/accessor/proxy IDs deny without executing traps or changing rows", async () => {
  const f = await correlated("hostile"), before = await facts("hostile"); let reads = 0;
  const getter = Object.defineProperty({}, "sessionId", { enumerable: true, get() { reads++; throw Error("private-canary"); } });
  for (const o of [getter, new Proxy(f.observation, { ownKeys() { reads++; throw Error("private-canary"); } }),
    { ...f.observation, sessionId: "x".repeat(129) }, { ...f.observation, sessionId: "session\nprivate" }, { ...f.observation, sessionId: "" }]) denied(await f.store.recordProviderSession(f.raw, o));
  assert.equal(reads, 0); assert.deepEqual(await facts("hostile"), before);
});
test("PG foreign workspace is opaque; foreign account store and foreign start capability cannot attach", async () => {
  const f = await correlated("tenant-isolation"), other = await setup("tenant-isolation", live.secondaryWorkspace.domain);
  await other.store.reserve(other.raw, { maximumExposureUsdMicros: 10000 });
  const prepared = await other.store.bindRequest(other.raw, context()); assert.ok(prepared.snapshot?.requestFingerprint);
  const start = await other.store.commitProviderStart(other.raw, prepared.snapshot.requestFingerprint); assert.ok(start.startCapability);
  assert.notEqual(prepared.snapshot.requestFingerprint, f.fp);
  denied(await other.store.inspectProviderIdentity(other.raw)); denied(await other.store.recordProviderSession(other.raw, f.observation));
  denied(await other.store.prepareProviderCorrelation(other.raw, context(), f.start));
  const foreign = durable.createPostgresExecutorStartStore({ ...f.config, target: { ...executorTarget(), accountId: "account-b" } });
  denied(await foreign.inspectProviderIdentity(f.raw)); denied(await foreign.recordProviderSession(f.raw, { ...f.observation, target: { ...executorTarget(), accountId: "account-b" } }));
  assert.equal((await facts("tenant-isolation")).identities.length, 1);
});
for (const phase of ["correlation", "session", "turn"]) test(`PG ${phase}: lost COMMIT acknowledgement latches closed, fresh store sees factual state, no network right`, async () => {
  const id = `ack-${phase}`, f = await started(id);
  const correlation = phase === "correlation" ? null : await f.store.prepareProviderCorrelation(f.raw, context(), f.start);
  const observation = { requestFingerprint: f.fp, correlationFingerprint: correlation?.providerIdentity?.correlationFingerprint ?? "f".repeat(64), target: executorTarget(), sessionId: `session_${id}` };
  if (phase === "turn") await f.store.recordProviderSession(f.raw, observation);
  const interceptor = live.installQueryInterceptor();
  interceptor.rules.push(live.rule("lost identity commit ack", live.sqlTag("executor-transaction:commit"), async (_c, sql, values, send) => { await send(sql, values); throw Error("private-driver-canary"); }));
  try {
    const d = phase === "correlation" ? await f.store.prepareProviderCorrelation(f.raw, context(), f.start)
      : phase === "session" ? await f.store.recordProviderSession(f.raw, observation) : await f.store.recordProviderTurn(f.raw, { ...observation, turnId: "turn_safe" });
    denied(d); assert.equal(d.status, "recovery_required"); assert.equal(interceptor.rules[0].fired, 1);
    denied(await f.store.inspectProviderIdentity(f.raw));
  } finally { interceptor.restore(); }
  const fresh = durable.createPostgresExecutorStartStore(f.config), d = await fresh.inspectProviderIdentity(f.raw);
  assert.equal(d.providerIdentity?.identityState, phase === "correlation" ? "correlation_prepared" : phase === "session" ? "session_observed" : "turn_observed");
  assert.equal(d.providerCapability, null); assert.equal((await fresh.commitProviderStart(f.raw, f.fp)).startCapability, null);
});
test("PG correlation rollback never mints a provider right; full exposure remains", async () => {
  const f = await started("rollback"), interceptor = live.installQueryInterceptor();
  interceptor.rules.push(live.rule("rollback correlation", live.sqlTag("executor:provider-identity-audit"), async () => { throw live.serverError("40001"); }));
  try { const d = await f.store.prepareProviderCorrelation(f.raw, context(), f.start); denied(d); assert.equal(d.status, "recovery_required"); }
  finally { interceptor.restore(); }
  assert.equal((await facts("rollback")).identities.length, 0);
  const fresh = durable.createPostgresExecutorStartStore(f.config); denied(await fresh.prepareProviderCorrelation(f.raw, context(), f.start));
  assert.equal((await fresh.inspect(f.raw)).snapshot?.heldExposureUsdMicros, 10000);
});
test("PG historical identity and definitive settlement survive revoke, authority advance and Project pause/archive", async () => {
  const id = "historical", f = await correlated(id);
  await f.store.recordProviderSession(f.raw, f.observation); const saved = (await f.store.inspectProviderIdentity(f.raw)).providerIdentity;
  await f.authority.revokeCurrentAuthority();
  const next = authority.createPostgresExecutorCurrentAuthorityStore({ database: f.config.database, tenant: f.config.tenant, projectId: "project-a", configuration: executorConfiguration(2, id) });
  assert.equal((await next.advanceCurrentAuthority()).status, "advanced");
  for (const status of ["paused", "archived"]) {
    await db.admin.query("update projects set status=$2 where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id, status]);
    try { assert.deepEqual((await f.store.inspectProviderIdentity(f.raw)).providerIdentity, saved); }
    finally { await db.admin.query("update projects set status='active' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]); }
  }
  await db.admin.query("update projects set status='archived' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]);
  try {
    assert.equal((await f.store.recordDefinitiveOutcomeAndSettle(f.raw, f.fp, await receipt(id, f.fp))).status, "settled");
    assert.deepEqual((await f.store.inspectProviderIdentity(f.raw)).providerIdentity, saved);
    assert.equal((await f.store.inspectOutcome(f.raw)).snapshot?.heldExposureUsdMicros, 0);
  } finally { await db.admin.query("update projects set status='active' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]); }
});
for (const mode of ["same-session", "conflicting-session", "same-turn"]) test(`PG ${mode} concurrent observations x10: independent stores, one row/right`, async () => {
  for (let n = 0; n < 10; n++) {
    const f = await correlated(`race-${mode}-${n}`), b = await setup(f.raw.attempt.developmentRunId);
    if (mode === "same-turn") await f.store.recordProviderSession(f.raw, f.observation);
    const d = await Promise.all(mode === "same-turn"
      ? [f.store.recordProviderTurn(f.raw, { ...f.observation, turnId: f.turnId }), b.store.recordProviderTurn(b.raw, { ...f.observation, turnId: f.turnId })]
      : [f.store.recordProviderSession(f.raw, f.observation), b.store.recordProviderSession(b.raw, { ...f.observation, sessionId: mode === "same-session" ? f.observation.sessionId : `conflicting_${n}` })]);
    assert.equal(d.filter(v => v.status === "recorded").length, 1);
    assert.equal(d.filter(v => v.status === (mode === "conflicting-session" ? "recovery_required" : "idempotent")).length, 1);
    const factsAfter = await facts(f.raw.attempt.developmentRunId); assert.equal(factsAfter.identities.length, 1); assert.equal(factsAfter.results.length, 0);
    assert.equal(factsAfter.events.length, mode === "same-session" ? 2 : 3);
  }
});
test("PG OS restart after correlation/session/turn: fresh child has identity but no credential/network/start authority", async () => {
  const id = "os-restart", f = await correlated(id), pids = new Set<number>();
  for (const phase of ["correlation", "session", "turn"]) {
    if (phase === "session") await f.store.recordProviderSession(f.raw, f.observation);
    if (phase === "turn") await f.store.recordProviderTurn(f.raw, { ...f.observation, turnId: f.turnId });
    const script = `import { pathToFileURL } from 'node:url'; const root=pathToFileURL(process.cwd()+'/');
      const p=await import(new URL('lib/db/postgres.ts',root)),t=await import(new URL('lib/db/workflow-runtime-tenant.ts',root)),s=await import(new URL('lib/db/executor-start-store.ts',root)),f=await import(new URL('tests/fixtures/durable-executor.mts',root));
      const database=p.createWorkflowRuntimePostgresDatabase({connectionString:process.env.IDENTITY_TEST_DB,maxConnections:1});
      try{const tenant=await t.createPostgresWorkflowRuntimeTenantResolver(database).resolve('workspace-primary');
      const store=s.createPostgresExecutorStartStore({database,tenant,projectId:'project-a',configuration:f.executorConfiguration(1,'os-restart'),target:f.executorTarget(),requestPolicy:f.executorRequestPolicy(),financialPolicy:f.financialPolicy(),authorizeStart:()=>false});
      const raw=f.executorRequest(1,'os-restart'),d=await store.inspectProviderIdentity(raw); process.stdout.write(JSON.stringify({pid:process.pid,d}));}catch{process.exitCode=1;}finally{await database.close();}`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-"], { input: script, encoding: "utf8", timeout: 15000, env: { ...process.env, IDENTITY_TEST_DB: db.url } });
    assert.equal(child.status, 0, "isolated restart read completes"); const parsed = JSON.parse(child.stdout); pids.add(parsed.pid);
    assert.notEqual(parsed.pid, process.pid); assert.deepEqual(parsed.d, await f.store.inspectProviderIdentity(f.raw)); assert.equal(parsed.d.providerCapability, null);
  }
  assert.equal(pids.size, 3);
});
test("PG direct SQL cannot rebind identity, erase history, insert turn-before-session or bypass journal", async () => {
  const id = "sql-guards", f = await correlated(id); await f.store.recordProviderSession(f.raw, f.observation); await f.store.recordProviderTurn(f.raw, { ...f.observation, turnId: f.turnId });
  const before = await facts(id), key = [live.primaryWorkspace.id, id];
  for (const update of ["session_id='other'", "turn_id='other'", "account_id='other'", "provider_model_id='other'", "request_fingerprint=repeat('f',64)",
    "correlation_fingerprint=repeat('f',64)", "workspace_id='00000000-0000-4000-8000-0000000000b2'", "identity_state='correlation_prepared',session_id=null,turn_id=null"])
    await assert.rejects(db.admin.query(`update executor_provider_executions set ${update},event_version=event_version+1 where workspace_id=$1 and development_run_id=$2`, key), (e: { code: string }) => ["55000", "23514", "23503"].includes(e.code));
  for (const table of ["executor_provider_executions", "executor_provider_identity_events"])
    await assert.rejects(db.admin.query(`delete from ${table} where workspace_id=$1 and development_run_id=$2`, key), (e: { code: string }) => e.code === "55000");
  await assert.rejects(db.admin.query("update executor_provider_executions set recovery_required=true,event_version=event_version+1 where workspace_id=$1 and development_run_id=$2", key), (e: { code: string }) => e.code === "23503");
  assert.deepEqual(await facts(id), before);
  const early = await correlated("sql-turn-before-session");
  await assert.rejects(db.admin.query("update executor_provider_executions set turn_id='turn_early',identity_state='turn_observed',event_version=event_version+1 where workspace_id=$1 and development_run_id=$2", [live.primaryWorkspace.id, early.raw.attempt.developmentRunId]), (e: { code: string }) => ["55000", "23514"].includes(e.code));
});
test("PG durable capability → observer → in-process parser: correlation before transmission, session/turn ACK before success", async () => {
  const id = "parser-bridge", f = await correlated(id), observer = f.store.createProviderIdentityObserver(f.raw, f.correlation.providerCapability);
  const t = identityTransport(id, observer, live.primaryWorkspace.id); assert.equal(t.fp, f.fp);
  const d = await t.invoke(); assert.equal(d.verdict, "allow"); assert.equal(t.calls(), 1); assert.equal(t.credentials(), 1);
  const p = (await f.store.inspectProviderIdentity(f.raw)).providerIdentity; assert.equal(p?.sessionId, "session_parser-bridge"); assert.equal(p?.turnId, "turn_parser-bridge");
  await t.invoke(); assert.equal(t.calls(), 1); assert.equal(await observer.beforeTransmission(f.fp), false);
});
for (const phase of ["session", "turn"]) test(`PG parser ${phase} COMMIT-ack loss: one provider call, no terminal result, full hold and no redispatch`, async () => {
  const id = `parser-ack-${phase}`, f = await correlated(id), interceptor = live.installQueryInterceptor(); let writing = false;
  interceptor.observe(sql => { if (sql.includes(`executor:provider-${phase} */`)) writing = true; });
  interceptor.rules.push(live.rule("identity ACK lost during stream", sql => writing && sql.includes("executor-transaction:commit"), async (_c, sql, values, send) => { await send(sql, values); throw Error("private-ack-canary"); }));
  const t = identityTransport(id, f.store.createProviderIdentityObserver(f.raw, f.correlation.providerCapability), live.primaryWorkspace.id);
  try {
    const d = await t.invoke(); deniedTransport(d); assert.equal(d.reconciliation?.reconciliation, "reconciliation_required");
    assert.equal(t.calls(), 1); assert.equal(t.credentials(), 1); assert.equal(interceptor.rules[0].fired, 1);
    await t.invoke(); assert.equal(t.calls(), 1);
  } finally { interceptor.restore(); }
  const fresh = durable.createPostgresExecutorStartStore(f.config), read = await fresh.inspectProviderIdentity(f.raw);
  assert.equal(read.providerIdentity?.identityState, phase === "session" ? "session_observed" : "turn_observed");
  assert.equal(read.snapshot?.heldExposureUsdMicros, 10000); assert.equal((await facts(id)).results.length, 0);
  assert.equal((await fresh.commitProviderStart(f.raw, f.fp)).startCapability, null);
});
test("PG production facade remains locked with no start/correlation issuer or network", async () => {
  const { createDurableDevelopmentExecutorComposition } = await import(new URL("../../lib/composition/durable-development-executor.ts", import.meta.url).href) as typeof import("../../lib/composition/durable-development-executor");
  const f = await setup("locked-facade"), facade = await createDurableDevelopmentExecutorComposition({ database: f.config.database,
    domainWorkspaceId: live.primaryWorkspace.domain, projectId: "project-a", configuration: f.config.configuration, target: executorTarget(), financialPolicy: financialPolicy() });
  assert.ok(facade); assert.equal(facade.invoke().verdict, "deny"); assert.equal(facade.realDispatch, "blocked");
  assert.ok(!("commitProviderStart" in facade)); assert.ok(!("prepareProviderCorrelation" in facade)); assert.ok(!("providerCapability" in facade));
});
test("PG missing correlation during final re-read blocks all provider/credential access", async () => {
  const id = "missing-correlation", f = await correlated(id), observer = f.store.createProviderIdentityObserver(f.raw, f.correlation.providerCapability);
  const interceptor = live.installQueryInterceptor();
  interceptor.rules.push(live.rule("missing correlation", live.sqlTag("executor:provider-identity-lock"), async () => ({ rows: [], rowCount: 0 })));
  try { const t = identityTransport(id, observer, live.primaryWorkspace.id); deniedTransport(await t.invoke()); assert.equal(t.calls(), 0); assert.equal(t.credentials(), 0); }
  finally { interceptor.restore(); }
  assert.equal(await observer.beforeTransmission(f.fp), false);
});
function deniedTransport(d: import("../../lib/executors/openai-agents-executor").ExecutorTransportDecision) { assert.equal(d.verdict, "deny"); assert.equal(d.normalizedResult, null); }
test("PG identity uncertainty after possible provider execution never authorizes another Create", async () => {
  const f = await correlated("ambiguous"); denied(await f.store.markProviderIdentityUnknown(f.raw));
  const d = await f.store.inspectProviderIdentity(f.raw); assert.equal(d.providerIdentity?.identityState, "correlation_prepared"); assert.equal(d.providerIdentity?.recoveryRequired, true);
  assert.equal(d.snapshot?.heldExposureUsdMicros, 10000); assert.equal((await facts("ambiguous")).results.length, 0);
  const t = identityTransport("ambiguous", f.store.createProviderIdentityObserver(f.raw, f.correlation.providerCapability), live.primaryWorkspace.id);
  deniedTransport(await t.invoke()); assert.equal(t.calls(), 0); assert.equal(t.credentials(), 0);
});
test("PG populated 0015 → 0016 preserves terminal results, journals, exposures and budgets without provider identity backfill", async () => {
  const name = `aipc_pgtest_identityupgrade_${randomUUID().replaceAll("-", "")}`;
  await db.admin.query(`create database "${name}"`);
  const admin = live.adminClient(live.databaseUrl(name)); await admin.connect();
  try {
    const migrations = readdirSync(new URL("../../db/migrations/", import.meta.url)).filter(p => /^\d{4}_.*\.sql$/u.test(p)).sort();
    assert.equal(migrations[15], "0016_executor_provider_execution_identity.sql");
    assert.equal(migrations[16], "0017_executor_provider_constraint.sql");
    assert.equal(migrations[17], "0018_executor_authority_rebinding.sql");
    assert.equal(migrations[18], "0019_roadmap_foundation.sql");
    assert.equal(migrations.at(-1), "0020_development_controller.sql");
    for (const path of migrations.slice(0, 15)) await admin.query(readFileSync(new URL(`../../db/migrations/${path}`, import.meta.url), "utf8"));
    await live.insertWorkspace(admin, live.primaryWorkspace);
    await admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Legacy terminal')", [live.primaryWorkspace.id]);
    const id = "legacy-terminal", f = await setup(id, live.primaryWorkspace.domain, live.databaseUrl(name), true);
    await f.store.reserve(f.raw, { maximumExposureUsdMicros: 10000 });
    const prepared = await f.store.bindRequest(f.raw, context()); assert.ok(prepared.snapshot?.requestFingerprint);
    await f.store.commitProviderStart(f.raw, prepared.snapshot.requestFingerprint);
    assert.equal((await f.store.recordDefinitiveOutcomeAndSettle(f.raw, prepared.snapshot.requestFingerprint, await receipt(id, prepared.snapshot.requestFingerprint))).status, "settled");
    const tables = ["executor_attempt_exposures", "executor_attempt_results", "executor_attempt_events", "executor_exposure_budgets"];
    const before = [];
    for (const table of tables) before.push((await admin.query(`select to_jsonb(t) as value from ${table} t order by to_jsonb(t)::text`)).rows);
    await admin.query(readFileSync(new URL("../../db/migrations/0016_executor_provider_execution_identity.sql", import.meta.url), "utf8"));
    const after = [];
    for (const table of tables) after.push((await admin.query(`select to_jsonb(t) as value from ${table} t order by to_jsonb(t)::text`)).rows);
    assert.deepEqual(after, before);
    for (const table of ["executor_provider_executions", "executor_provider_identity_events"]) assert.equal((await admin.query(`select count(*)::int as n from ${table}`)).rows[0].n, 0);
    assert.equal((await f.store.inspectOutcome(f.raw)).normalizedResult?.status, "succeeded"); denied(await f.store.inspectProviderIdentity(f.raw));
  } finally { await Promise.all(pools.splice(0).map(pool => pool.close())); await admin.end(); await db.admin.query(`drop database "${name}" with (force)`); }
});
test("PG no deadlocks and no duplicate identity/provider rights", async () => {
  await db.admin.query("select pg_stat_clear_snapshot()");
  assert.equal(Number((await db.admin.query("select deadlocks from pg_stat_database where datname=current_database()")).rows[0].deadlocks), 0);
  assert.equal((await db.admin.query("select count(*)::int as n from (select workspace_id,development_run_id,attempt_number from executor_provider_executions group by 1,2,3 having count(*)>1) duplicates")).rows[0].n, 0);
});
test("PG seam: malformed policy facts cannot prepare or change a reserved request", async () => {
  const f = await setup("policy-malformed"), rawBefore = structuredClone(f.raw);
  assert.equal((await f.store.reserve(f.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
  const originalPolicy = f.config.requestPolicy;
  const mutations: Array<(r: import("../../lib/executors/executor-provider-request").PreparedExecutorProviderRequest) => unknown> = [
    r => ({ ...r, requestFingerprint: "f".repeat(64) }), r => ({ ...r, correlationFingerprint: "f".repeat(64) }),
    r => ({ ...r, target: { ...r.target, modelId: "other" } }), r => ({ ...r, target: { ...r.target, accountId: "other" } }),
    r => ({ ...r, target: { ...r.target, providerId: "anthropic" } }), r => ({ ...r, startCapability: {} }),
  ];
  const before = await facts("policy-malformed");
  for (const change of mutations) {
    const requestPolicy = seam.defineTrustedExecutorProviderRequestPolicy("openai", (...args) => {
      const r = seam.prepareExecutorProviderRequest(originalPolicy, ...args); assert.ok(r); return change(r);
    });
    const s = durable.createPostgresExecutorStartStore({ ...f.config, requestPolicy });
    const result = await s.bindRequest(f.raw, context());
    assert.equal(result.verdict, "deny"); assert.equal(result.snapshot, null); assert.equal(result.startCapability, null);
    assert.deepEqual(await facts("policy-malformed"), before);
  }
  // Captured handle, not a mutable configuration receiver or an ambient default.
  f.config.requestPolicy = seam.defineTrustedExecutorProviderRequestPolicy("openai", () => null);
  const prepared = await f.store.bindRequest(f.raw, context()); assert.equal(prepared.status, "prepared");
  const started = await f.store.commitProviderStart(f.raw, prepared.snapshot!.requestFingerprint);
  const correlated = await f.store.prepareProviderCorrelation(f.raw, context(), started.startCapability);
  assert.equal(correlated.status, "prepared"); assert.ok(correlated.providerIdentity); assert.ok(correlated.providerCapability);
  assert.equal(correlated.providerIdentity.requestFingerprint, prepared.snapshot!.requestFingerprint);
  assert.deepEqual(f.raw, rawBefore);
});
test("PG seam: bad correlation preparation retains full exposure with no identity or provider right", async () => {
  const f = await started("policy-correlation-bad");
  const requestPolicy = seam.defineTrustedExecutorProviderRequestPolicy("openai", () => ({ authority: true }));
  const s = durable.createPostgresExecutorStartStore({ ...f.config, requestPolicy });
  denied(await s.prepareProviderCorrelation(f.raw, context(), f.start));
  const persisted = await facts("policy-correlation-bad");
  assert.equal(persisted.identities.length, 0); assert.equal(persisted.results.length, 0);
  const read = await f.store.inspect(f.raw); assert.equal(read.snapshot?.state, "start_committed");
  assert.equal(read.snapshot?.heldExposureUsdMicros, 10000);
  assert.equal(durable.consumeDurableExecutorStartCapability(f.start), null);
});
test("PG seam: future provider is representable but cannot reuse reserved OpenAI identity; schema stays unchanged", async () => {
  const checks = () => db.admin.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='executor_attempt_exposures'::regclass and contype='c' order by 1");
  const before = (await checks()).rows;
  const f = await setup("policy-provider-swap");
  await f.store.reserve(f.raw, { maximumExposureUsdMicros: 10000 });
  const target = { ...f.config.target, providerId: "anthropic" };
  assert.throws(() => durable.createPostgresExecutorStartStore({ ...f.config, target }));
  const requestPolicy = seam.defineTrustedExecutorProviderRequestPolicy("anthropic", () => null);
  const s = durable.createPostgresExecutorStartStore({ ...f.config, target, requestPolicy });
  const result = await s.bindRequest(f.raw, context()); assert.equal(result.status, "conflict");
  assert.equal(result.snapshot, null); assert.equal(result.startCapability, null);
  assert.equal((await f.store.inspect(f.raw)).snapshot?.state, "reserved");
  const constraints = (await checks()).rows;
  assert.deepEqual(constraints, before);
  assert.deepEqual(constraints.filter((r: { definition: string }) => r.definition.includes("provider_id")),
    [{ definition: "CHECK ((provider_id = ANY (ARRAY['openai'::text, 'anthropic'::text])))" }]);
});
