import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, financialPolicy, executorTarget, executorRequestPolicy, context } from "../fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { receipt } from "../fixtures/executor-outcome.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { fakeProvider } from "../fixtures/executor-provider-reconciliation.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const adapter = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const authorityFacts = await import(new URL("../../lib/executors/executor-current-authority.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-current-authority");
const seam = await import(new URL("../../lib/executors/executor-provider-request.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-provider-request");
const reconciliation = await import(new URL("../../lib/executors/openai-agents-reconciliation.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-reconciliation");
// Internal test-only override lets mutation tests execute isolated copied modules, never production enablement.
const moduleUrl = process.env.EXECUTOR_BARRIER_TEST_MODULE ? pathToFileURL(process.env.EXECUTOR_BARRIER_TEST_MODULE).href : new URL("../../lib/db/executor-start-store.ts", import.meta.url).href;
const durable = await import(moduleUrl) as typeof import("../../lib/db/executor-start-store");
const db = await live.useLiveDatabase("predecessor");
const expiryWorkspace = { id: "00000000-0000-4000-8000-0000000000c3", domain: "expiry-fixture" };
for (const w of [live.primaryWorkspace, live.secondaryWorkspace, expiryWorkspace]) {
  await live.insertWorkspace(db.admin, w);
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Barrier fixture')", [w.id]);
}
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
const exposure = { maximumExposureUsdMicros: 10000 };
async function setup(id: string, n = 1, target = executorTarget(), w: Readonly<{ id: string; domain: string }> = live.primaryWorkspace, policy = financialPolicy()) {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(w.domain); assert.ok(tenant);
  const config = { database, tenant, projectId: "project-a", configuration: executorConfiguration(n, id), target,
    requestPolicy: executorRequestPolicy(), financialPolicy: policy, authorizeStart: () => true };
  return { config, raw: executorRequest(n, id), s: durable.createPostgresExecutorStartStore(config),
    a: authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: config.projectId, configuration: config.configuration }) };
}
function blocked(d: import("../../lib/db/executor-start-store").DurableExecutorDecision) {
  assert.equal(d.verdict, "deny"); assert.equal(d.status, "recovery_required"); assert.equal(d.snapshot, null); assert.equal(d.startCapability, null);
}
async function prepared(id: string) {
  const f = await setup(id); assert.equal((await f.a.registerCurrentAuthority()).status, "registered");
  assert.equal((await f.s.reserve(f.raw, exposure)).status, "reserved");
  const d = await f.s.bindRequest(f.raw, context()); assert.ok(d.snapshot?.requestFingerprint);
  return { ...f, fp: d.snapshot.requestFingerprint };
}
async function started(id: string) {
  const f = await prepared(id), start = await f.s.commitProviderStart(f.raw, f.fp); assert.equal(start.status, "start_committed"); return { ...f, start };
}
async function successor(id: string, target = executorTarget()) {
  const f = await setup(id, 2, target); assert.equal((await f.a.advanceCurrentAuthority()).status, "advanced"); return f;
}
async function settle(f: Awaited<ReturnType<typeof started>>) {
  return f.s.recordDefinitiveOutcomeAndSettle(f.raw, f.fp, await receipt(f.raw.attempt.developmentRunId, f.fp));
}
async function facts(id: string) {
  return (await db.admin.query("select attempt_number,state,maximum_exposure_usd_micros::text as amount from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2 order by attempt_number", [live.primaryWorkspace.id, id])).rows;
}
test("B1 core RED/GREEN: advance allowed, successor blocked until definitive historical settlement", async () => {
  const id = "core", old = await started(id), next = await successor(id), before = await facts(id);
  blocked(await next.s.reserve(next.raw, exposure));
  assert.deepEqual(await facts(id), before);
  assert.equal((await settle(old)).status, "settled");
  assert.equal((await next.s.reserve(next.raw, exposure)).status, "reserved");
  assert.deepEqual((await facts(id)).map((r: { state: string }) => r.state), ["settled", "reserved"]);
});
test("B1 reconciliation: all active stages blocked; historical evidence/identity/retrieval still settles", async () => {
  const id = "historical", old = await started(id);
  const correlation = await old.s.prepareProviderCorrelation(old.raw, context(), old.start.startCapability); assert.ok(correlation.providerIdentity);
  const observation = { requestFingerprint: old.fp, correlationFingerprint: correlation.providerIdentity.correlationFingerprint, target: executorTarget(), sessionId: "session_historical" };
  assert.equal((await old.s.recordProviderSession(old.raw, observation)).status, "recorded");
  assert.equal((await old.s.recordProviderTurn(old.raw, { ...observation, turnId: "turn_a" })).status, "recorded");
  const next = await successor(id);
  assert.equal((await old.s.markReconciliationRequired(old.raw)).status, "recorded");
  assert.equal((await old.s.recordEvidence(old.raw, { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, providerConsumedCents: 0 })).status, "recorded");
  const before = await facts(id), d = await next.s.reserve(next.raw, exposure); blocked(d);
  assert.deepEqual(await next.s.reserve(next.raw, exposure), d);
  blocked(await next.s.bindRequest(next.raw, context())); blocked(await next.s.commitProviderStart(next.raw, old.fp));
  assert.deepEqual(await facts(id), before);
  assert.equal((await old.s.inspect(old.raw)).snapshot?.heldExposureUsdMicros, 10000);
  assert.equal((await old.s.inspectProviderIdentity(old.raw)).status, "observed");
  const provider = fakeProvider(observation.correlationFingerprint, observation.sessionId);
  const recovery = reconciliation.createOpenAIAgentsRetrievalTestReconciler({ configuration: old.config.configuration, target: old.config.target, store: old.s, retrievalClient: provider.client() });
  assert.equal((await recovery.reconcile(old.raw)).status, "settled");
  assert.equal((await recovery.reconcile(old.raw)).status, "idempotent");
  assert.equal((await next.s.reserve(next.raw, exposure)).status, "reserved");
});
for (const change of [{ accountId: "account-b" }, { modelId: "model-b" }, { accountId: "account-b", modelId: "model-b" }])
  test(`B1 account/model independence ${JSON.stringify(change)}`, async () => {
    const id = `target-${Object.keys(change).join("-").toLowerCase()}`, old = await started(id), next = await successor(id, { ...executorTarget(), ...change });
    blocked(await next.s.reserve(next.raw, exposure)); assert.equal((await old.s.inspect(old.raw)).snapshot?.heldExposureUsdMicros, 10000);
  });
for (const state of ["reserved", "prepared", "cancelled"])
  test(`B1 pre-start ${state} does not block; stale factory cannot start`, async () => {
    const id = `pre-${state}`, old = await setup(id); await old.a.registerCurrentAuthority(); await old.s.reserve(old.raw, exposure);
    let fp = "f".repeat(64);
    if (state !== "reserved") fp = (await old.s.bindRequest(old.raw, context())).snapshot!.requestFingerprint!;
    if (state === "cancelled") assert.equal((await old.s.cancel(old.raw)).status, "cancelled");
    const next = await successor(id); assert.equal((await next.s.reserve(next.raw, exposure)).status, "reserved");
    assert.equal((await old.s.commitProviderStart(old.raw, fp)).startCapability, null);
    assert.equal((await old.s.bindRequest(old.raw, context())).verdict, "deny");
    const p = await next.s.bindRequest(next.raw, context()); assert.equal(p.status, "prepared");
    assert.equal((await next.s.commitProviderStart(next.raw, p.snapshot!.requestFingerprint)).status, "start_committed");
  });
test("B1 any earlier attempt blocks, not only immediate predecessor", async () => {
  const id = "older-than-adjacent", old = await started(id); await successor(id);
  const third = await setup(id, 3); assert.equal((await third.a.advanceCurrentAuthority()).status, "advanced");
  blocked(await third.s.reserve(third.raw, exposure)); assert.equal((await settle(old)).status, "settled");
  assert.equal((await third.s.reserve(third.raw, exposure)).status, "reserved");
});
test("B1 Run/workspace isolation: unrelated started work does not block corrective admission", async () => {
  await started("unrelated-running");
  const other = await setup("unrelated-new", 2); await other.a.registerCurrentAuthority();
  assert.equal((await other.s.reserve(other.raw, exposure)).status, "reserved");
  const foreign = await setup("unrelated-running", 2, executorTarget(), live.secondaryWorkspace); await foreign.a.registerCurrentAuthority();
  assert.equal((await foreign.s.reserve(foreign.raw, exposure)).status, "reserved");
});
test("B1 restart: DB-only barrier survives store recreation; historical fresh store clears it", async () => {
  const id = "restart", old = await started(id); await successor(id);
  const next = await setup(id, 2); blocked(await next.s.reserve(next.raw, exposure));
  const historical = await setup(id);
  assert.equal((await historical.s.recordDefinitiveOutcomeAndSettle(old.raw, old.fp, await receipt(id, old.fp))).status, "settled");
  const fresh = await setup(id, 2); assert.equal((await fresh.s.reserve(fresh.raw, exposure)).status, "reserved");
  assert.equal((await historical.s.commitProviderStart(old.raw, old.fp)).startCapability, null);
});
test("B1 TTL/zero usage: factual expiry never clears reconciliation hold", async () => {
  const id = "expiry", policy = { ...financialPolicy(), reservationTtlMs: 2000 }, old = await setup(id, 1, executorTarget(), expiryWorkspace, policy);
  await old.a.registerCurrentAuthority(); await old.s.reserve(old.raw, exposure);
  const p = await old.s.bindRequest(old.raw, context()); assert.ok(p.snapshot?.requestFingerprint);
  assert.equal((await old.s.commitProviderStart(old.raw, p.snapshot.requestFingerprint)).status, "start_committed");
  const next = await setup(id, 2, executorTarget(), expiryWorkspace, policy); await next.a.advanceCurrentAuthority();
  await old.s.markReconciliationRequired(old.raw);
  await old.s.recordEvidence(old.raw, { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, providerConsumedCents: 0 });
  await live.sleep(Math.max(0, p.snapshot.expiresAt - Date.now()) + 50);
  assert.ok(Date.now() > p.snapshot.expiresAt);
  blocked(await next.s.reserve(next.raw, exposure)); blocked(await next.s.bindRequest(next.raw, context()));
  blocked(await next.s.commitProviderStart(next.raw, p.snapshot.requestFingerprint));
  assert.equal((await old.s.inspect(old.raw)).snapshot?.heldExposureUsdMicros, 10000);
});

/** Restore a VALID pre-b1 prepared-successor fixture. Baseline RED proved this state
 * could be reached through serialized accepted APIs. Insert only the missing legacy
 * successor and its exact events/counter, preserving every schema constraint. Never
 * rewrite authority, start a stale attempt or tamper with a production/persistent DB. */
async function restoreLegacyPrepared(next: Awaited<ReturnType<typeof setup>>) {
  const i = adapter.createExecutorAdapterContract(next.config.configuration).adapter!.validateInvocation(next.raw).normalizedInvocation!;
  const a = authorityFacts.deriveExecutorAuthorityFacts(next.config.configuration);
  const r = seam.prepareExecutorProviderRequest(next.config.requestPolicy, i, context(), next.config.target, 10000, next.config.tenant.workspaceDatabaseId); assert.ok(r);
  const client = live.adminClient(db.url); await client.connect();
  try {
    await client.query("begin");
    await client.query("select id from workspaces where id=$1 for share", [next.config.tenant.workspaceDatabaseId]);
    await client.query("select project_key from projects where workspace_id=$1 and project_key='project-a' for share", [next.config.tenant.workspaceDatabaseId]);
    await client.query("select authority_generation from executor_run_authorities where workspace_id=$1 and development_run_id=$2 for update", [next.config.tenant.workspaceDatabaseId, i.attempt.developmentRunId]);
    await client.query("select * from executor_exposure_budgets where workspace_id=$1 for update", [next.config.tenant.workspaceDatabaseId]);
    const now = new Date(), row = { workspace_id: next.config.tenant.workspaceDatabaseId, project_key: "project-a", development_run_id: i.attempt.developmentRunId,
      attempt_number: i.attempt.number, attempt_kind: i.attempt.kind, plan_id: i.planId, task_id: i.taskId, executor_id: i.identity.id, executor_version: i.identity.version,
      invocation_id: i.invocationId, repository_id: i.repository.id, repository_baseline: i.repository.baseline, capability: i.capability, mode: i.mode,
      provider_id: next.config.target.providerId, provider_model_id: next.config.target.modelId, account_id: next.config.target.accountId,
      invocation_fingerprint: createHash("sha256").update(JSON.stringify(i)).digest("hex"), maximum_exposure_usd_micros: 10000, provider_spend_limit_cents: 1,
      request_fingerprint: null, state: "reserved", reconciliation: "not_started", event_version: 1,
      authority_generation: 2, canonical_run_fingerprint: a.canonicalRunFingerprint, admission_fingerprint: a.admissionFingerprint,
      created_at: now, updated_at: now, prepared_at: null, expires_at: new Date(now.getTime() + 60000) };
    const keys = Object.keys(row);
    await client.query(`insert into executor_attempt_exposures(${keys.join(",")}) values(${keys.map((_, n) => `$${n + 1}`).join(",")})`, Object.values(row));
    await client.query("update executor_exposure_budgets set held_exposure_usd_micros=held_exposure_usd_micros+10000 where workspace_id=$1", [row.workspace_id]);
    for (const [version, state, operation] of [[1, "reserved", "reserve"], [2, "prepared", "prepare"]]) {
      if (version === 2) await client.query("update executor_attempt_exposures set state='prepared',request_fingerprint=$4,prepared_at=$5,updated_at=$5,event_version=2 where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 and state='reserved'", [row.workspace_id, row.development_run_id, row.attempt_number, r.requestFingerprint, now]);
      await client.query("insert into executor_attempt_events(workspace_id,development_run_id,attempt_number,event_version,state,operation) values($1,$2,$3,$4,$5,$6)", [row.workspace_id, row.development_run_id, row.attempt_number, version, state, operation]);
    }
    await client.query("commit"); return r.requestFingerprint;
  } catch (error) { await client.query("rollback"); throw error; } finally { await client.end(); }
}
test("B1 legacy prepared successor: replay/prepare/start all recheck barrier before idempotency", async () => {
  const id = "legacy-successor", old = await started(id), next = await successor(id), fp = await restoreLegacyPrepared(next);
  const before = await facts(id); blocked(await next.s.reserve(next.raw, exposure));
  blocked(await next.s.bindRequest(next.raw, context())); blocked(await next.s.commitProviderStart(next.raw, fp));
  assert.deepEqual(await facts(id), before);
  assert.equal((await settle(old)).status, "settled");
  assert.equal((await next.s.bindRequest(next.raw, context())).status, "idempotent");
  assert.equal((await next.s.commitProviderStart(next.raw, fp)).status, "start_committed");
});
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function waitForLock() {
  for (let n = 0; n < 100; n++) {
    if ((await db.admin.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")).rows[0].n > 0) return;
    await live.sleep(10);
  }
  assert.fail("independent backend must wait for factual lock");
}
for (const winner of ["start", "advance"] as const) test(`B1 race start/advance x10: ${winner} wins; never two committed starts`, async () => {
  const pids = new Set<number>();
  for (let n = 0; n < 10; n++) {
    const id = `start-race-${winner}-${n}`, old = await prepared(id), next = await setup(id, 2);
    const entered = latch(), release = latch(), interceptor = live.installQueryInterceptor();
    interceptor.observe((_sql, client) => { if (client.processID) pids.add(client.processID); });
    interceptor.rules.push(live.rule("hold winner", live.sqlTag(winner === "start" ? "executor:budget-lock" : "executor:authority-journal"), async (_c, cfg, values, send) => {
      entered.release(); await release.promise; return send(cfg, values);
    }));
    let a: ReturnType<typeof next.a.advanceCurrentAuthority> | undefined, s: ReturnType<typeof old.s.commitProviderStart> | undefined;
    try {
      if (winner === "start") s = old.s.commitProviderStart(old.raw, old.fp); else a = next.a.advanceCurrentAuthority();
      await entered.promise;
      if (winner === "start") a = next.a.advanceCurrentAuthority(); else s = old.s.commitProviderStart(old.raw, old.fp);
      await waitForLock(); release.release();
      const [start, advance] = await Promise.all([s!, a!]); assert.equal(advance.status, "advanced");
      if (winner === "start") { assert.equal(start.status, "start_committed"); blocked(await next.s.reserve(next.raw, exposure)); }
      else {
        assert.equal(start.verdict, "deny"); assert.equal(start.startCapability, null);
        assert.equal((await next.s.reserve(next.raw, exposure)).status, "reserved");
        const p = await next.s.bindRequest(next.raw, context()); assert.ok(p.snapshot?.requestFingerprint);
        assert.equal((await next.s.commitProviderStart(next.raw, p.snapshot.requestFingerprint)).status, "start_committed");
      }
      assert.equal((await facts(id)).filter((r: { state: string }) => r.state === "start_committed").length, 1);
    } finally { release.release(); await Promise.allSettled([s, a].filter(Boolean)); interceptor.restore(); }
  }
  assert.ok(pids.size >= 2);
});
for (const winner of ["settlement", "successor"] as const) test(`B1 race settlement/reserve x10: ${winner} wins budget lock`, async () => {
  const pids = new Set<number>();
  for (let n = 0; n < 10; n++) {
    const id = `settle-race-${winner}-${n}`, old = await started(id), next = await successor(id);
    const terminal = await receipt(id, old.fp), entered = latch(), release = latch(), interceptor = live.installQueryInterceptor();
    interceptor.observe((_sql, client) => { if (client.processID) pids.add(client.processID); });
    interceptor.rules.push(live.rule("hold serialized winner", live.sqlTag(winner === "settlement" ? "executor:settlement-release" : "executor:predecessors"), async (_c, cfg, values, send) => {
      entered.release(); await release.promise; return send(cfg, values);
    }));
    const settleNow = () => old.s.recordDefinitiveOutcomeAndSettle(old.raw, old.fp, terminal);
    let a: ReturnType<typeof next.s.reserve> | undefined, s: ReturnType<typeof settleNow> | undefined;
    try {
      if (winner === "settlement") s = settleNow(); else a = next.s.reserve(next.raw, exposure);
      await entered.promise;
      if (winner === "settlement") a = next.s.reserve(next.raw, exposure); else s = settleNow();
      await waitForLock(); release.release();
      const [admitted, settled] = await Promise.all([a!, s!]); assert.equal(settled.status, "settled");
      if (winner === "settlement") assert.equal(admitted.status, "reserved"); else blocked(admitted);
      assert.equal((await settleNow()).status, "idempotent");
      assert.ok(["reserved", "idempotent"].includes((await next.s.reserve(next.raw, exposure)).status));
      const releaseCount = (await db.admin.query("select count(*)::int as n from executor_attempt_events where workspace_id=$1 and development_run_id=$2 and operation='settle'", [live.primaryWorkspace.id, id])).rows[0].n;
      assert.equal(releaseCount, 1);
    } finally { release.release(); await Promise.allSettled([a, s].filter(Boolean)); interceptor.restore(); }
  }
  assert.ok(pids.size >= 2);
});
test("B1 predecessor query DB failure latches closed, emits no raw data or successor hold", async () => {
  const id = "query-failure", old = await started(id), next = await successor(id), before = await facts(id), interceptor = live.installQueryInterceptor();
  try {
    const rule = live.rule("lost predecessor read", live.sqlTag("executor:predecessors"), async () => { throw Error("private-driver-canary"); });
    interceptor.rules.push(rule);
    const d = await next.s.reserve(next.raw, exposure); blocked(d); assert.ok(!JSON.stringify(d).includes("private-driver-canary"));
    assert.deepEqual(await facts(id), before); assert.equal(rule.fired, 1);
    assert.equal((await settle(old)).status, "settled");
    blocked(await next.s.reserve(next.raw, exposure)); assert.equal(rule.fired, 1);
    const fresh = await setup(id, 2); assert.equal((await fresh.s.reserve(fresh.raw, exposure)).status, "reserved");
  } finally { interceptor.restore(); }
});
test("B1 malformed predecessor response is not absence and latches the store closed", async () => {
  const id = "malformed-read", old = await started(id), next = await successor(id), before = await facts(id), interceptor = live.installQueryInterceptor();
  try {
    interceptor.rules.push(live.rule("malformed read evidence", live.sqlTag("executor:predecessors"), async (_c, cfg, values, send) => {
      const result = await send(cfg, values);
      return { ...result, rows: [{ ...result.rows[0], state: "settled", settled: true, terminal_result_fingerprint: "f".repeat(64), terminal_matches: false }] };
    }));
    blocked(await next.s.reserve(next.raw, exposure)); assert.deepEqual(await facts(id), before);
    assert.equal((await settle(old)).status, "settled"); blocked(await next.s.reserve(next.raw, exposure));
  } finally { interceptor.restore(); }
});
test("B1 lost settlement COMMIT ACK: no result escapes; fresh factual settlement alone clears barrier", async () => {
  const id = "settle-ack", old = await started(id), next = await successor(id), interceptor = live.installQueryInterceptor();
  blocked(await next.s.reserve(next.raw, exposure));
  try {
    interceptor.rules.push(live.rule("lose ACK", live.sqlTag("executor-transaction:commit"), async (_c, cfg, values, send) => {
      await send(cfg, values); throw Error("private-lost-commit");
    }));
    const d = await settle(old); blocked(d); assert.equal(d.normalizedResult, null);
  } finally { interceptor.restore(); }
  const historical = await setup(id); assert.equal((await historical.s.inspectOutcome(old.raw)).snapshot?.state, "settled");
  assert.equal((await next.s.reserve(next.raw, exposure)).status, "reserved");
  assert.equal((await historical.s.inspectOutcome(old.raw)).startCapability, null);
});
test("B1 no deadlocks or duplicate provider rights in barrier race suite", async () => {
  await db.admin.query("select pg_stat_clear_snapshot()");
  assert.equal(Number((await db.admin.query("select deadlocks from pg_stat_database where datname=current_database()")).rows[0].deadlocks), 0);
  assert.equal((await db.admin.query("select count(*)::int as n from (select workspace_id,development_run_id,attempt_number from executor_attempt_exposures group by 1,2,3 having count(*)>1) d")).rows[0].n, 0);
});
