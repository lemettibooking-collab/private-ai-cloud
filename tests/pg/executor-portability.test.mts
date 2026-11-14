import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { pathToFileURL } from "node:url";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { workload, transmit, recover, settleCandidate } from "../fixtures/executor-portability.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { financialPolicy } from "../fixtures/durable-executor.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const core = await import(process.env.PORTABILITY_CORE_MODULE ? pathToFileURL(process.env.PORTABILITY_CORE_MODULE).href : new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const auth = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const db = await live.useLiveDatabase("portability");
for (const w of [live.primaryWorkspace, live.secondaryWorkspace]) { await live.insertWorkspace(db.admin, w); await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Portability')", [w.id]); }
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
async function setup(provider: "openai" | "anthropic", id: string, n = 1, w: Readonly<{ id: string; domain: string }> = live.primaryWorkspace, account = "account-a") {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(w.domain); assert.ok(tenant);
  const f = workload(provider, id, n, tenant.workspaceDatabaseId, account), config = { database, tenant, projectId: "project-a", configuration: f.configuration,
    target: f.target, requestPolicy: f.policy, financialPolicy: financialPolicy(), authorizeStart: () => true };
  return { f, config, store: core.createPostgresExecutorStartStore(config), authority: auth.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: config.projectId, configuration: f.configuration }) };
}
async function prepared(provider: "openai" | "anthropic", id: string, n = 1, account = "account-a", w = live.primaryWorkspace as Readonly<{ id: string; domain: string }>) {
  const x = await setup(provider, id, n, w, account);
  assert.equal((await (n === 1 ? x.authority.registerCurrentAuthority() : x.authority.advanceCurrentAuthority())).verdict, "allow");
  assert.equal((await x.store.reserve(x.f.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
  assert.equal((await x.store.bindRequest(x.f.raw, x.f.context)).snapshot?.requestFingerprint, x.f.prepared.requestFingerprint); return x;
}
async function started(provider: "openai" | "anthropic", id: string, n = 1) {
  const x = await prepared(provider, id, n), start = await x.store.commitProviderStart(x.f.raw, x.f.prepared.requestFingerprint); assert.ok(start.startCapability); return { ...x, start };
}
for (const provider of ["openai", "anthropic"] as const) {
  test(`D PG ${provider}: complete common pipeline, restart, historical read-only recovery, settle/replay once`, async () => {
    const x = await started(provider, `portable-${provider}`), sent = await transmit(x.f, x.store, x.start.startCapability); assert.equal(sent.decision.verdict, "allow", JSON.stringify(sent.decision));
    assert.equal(sent.count(), 1); await sent.replay(); assert.equal(sent.count(), 1);
    const p = (await x.store.inspectProviderIdentity(x.f.raw)).providerIdentity; assert.ok(p?.sessionId); assert.equal(p.turnId === null, provider === "anthropic");
    const fresh = await setup(provider, `portable-${provider}`); await fresh.authority.revokeCurrentAuthority();
    const recovered = await recover(fresh.f, fresh.store); assert.equal(recovered.decision.verdict, "allow"); assert.equal(recovered.creates, 0); assert.ok(recovered.reads > 0);
    const r = recovered.decision.normalizedResult!; assert.equal(r.ownerDecisionRequired, true); assert.equal(r.verificationStatus, "not_run"); assert.equal(r.automaticRetryAllowed, false);
    assert.equal((await fresh.store.inspect(fresh.f.raw)).snapshot?.heldExposureUsdMicros, 0);
    const again = await recover(fresh.f, fresh.store); assert.equal(again.decision.status, "idempotent");
    const facts = (await db.admin.query("select (select count(*) from executor_attempt_results where development_run_id=$1)::int as results,(select count(*) from executor_attempt_events where development_run_id=$1 and state='settled')::int as settlements", [fresh.f.raw.attempt.developmentRunId])).rows[0];
    assert.deepEqual(facts, { results: 1, settlements: 1 });
  });
  for (const mode of ["timeout", "malformed", "missing", "overshoot"] as const) test(`D PG ${provider}: ${mode}, one transmission/full hold/no automatic retry`, async () => {
    const x = await started(provider, `amb-${provider}-${mode}`), sent = await transmit(x.f, x.store, x.start.startCapability, mode);
    assert.notEqual(sent.decision.normalizedResult?.status, "succeeded"); assert.equal(sent.count(), 1);
    await sent.replay(); assert.equal(sent.count(), 1); assert.equal((await x.store.inspect(x.f.raw)).snapshot?.heldExposureUsdMicros, 10000);
    const fresh = await setup(provider, `amb-${provider}-${mode}`), retry = await fresh.store.commitProviderStart(fresh.f.raw, fresh.f.prepared.requestFingerprint); assert.equal(retry.startCapability, null);
    assert.equal((await transmit(fresh.f, fresh.store, retry.startCapability)).count(), 0);
    const next = await setup(provider === "openai" ? "anthropic" : "openai", `amb-${provider}-${mode}`, 2); await next.authority.advanceCurrentAuthority();
    assert.equal((await next.store.reserve(next.f.raw, { maximumExposureUsdMicros: 10000 })).status, "recovery_required");
    assert.equal((await db.admin.query("select count(*)::int as n from executor_attempt_results where development_run_id=$1", [x.f.raw.attempt.developmentRunId])).rows[0].n, 0);
  });
  test(`D PG ${provider}: exact duplicate identity idempotent, conflicting identity never replaces it`, async () => {
    const x = await started(provider, `identity-${provider}`); await transmit(x.f, x.store, x.start.startCapability);
    const p = (await x.store.inspectProviderIdentity(x.f.raw)).providerIdentity!;
    const observation = { target: x.f.target, requestFingerprint: p.requestFingerprint, correlationFingerprint: p.correlationFingerprint, sessionId: p.sessionId };
    assert.equal((await x.store.recordProviderSession(x.f.raw, observation)).status, "idempotent");
    assert.equal((await x.store.recordProviderSession(x.f.raw, { ...observation, sessionId: "session_conflict" })).status, "recovery_required");
    assert.equal((await x.store.inspectProviderIdentity(x.f.raw)).providerIdentity?.sessionId, p.sessionId);
    assert.equal((await x.store.inspect(x.f.raw)).snapshot?.heldExposureUsdMicros, 10000);
  });
  test(`D PG ${provider}: stale authority, changed context/repository/executor and provider swaps fail closed`, async () => {
    const x = await prepared(provider, `bindings-${provider}`), before = structuredClone(x.f.raw);
    const other = await setup(provider === "openai" ? "anthropic" : "openai", `bindings-${provider}`);
    assert.equal((await other.store.bindRequest(other.f.raw, other.f.context)).verdict, "deny");
    for (const raw of [{ ...x.f.raw, repository: { ...x.f.raw.repository, baseline: "b".repeat(40) } }, { ...x.f.raw, identity: { ...x.f.raw.identity, version: "v2" } }])
      assert.equal((await x.store.commitProviderStart(raw, x.f.prepared.requestFingerprint)).verdict, "deny");
    assert.equal((await x.store.bindRequest(x.f.raw, { files: [{ path: "src/a.ts", content: "changed" }] })).verdict, "deny");
    await x.authority.revokeCurrentAuthority(); assert.equal((await x.store.commitProviderStart(x.f.raw, x.f.prepared.requestFingerprint)).startCapability, null);
    assert.deepEqual(x.f.raw, before);
  });
  test(`D PG ${provider}: start race across ten independent stores has one acknowledged provider right`, async () => {
    const x = await prepared(provider, `race-${provider}`), contenders = await Promise.all(Array.from({ length: 10 }, () => setup(provider, `race-${provider}`)));
    const outcomes = await Promise.all(contenders.map(c => c.store.commitProviderStart(c.f.raw, c.f.prepared.requestFingerprint)));
    assert.equal(outcomes.filter(d => d.startCapability).length, 1);
    let calls = 0; for (let n = 0; n < outcomes.length; n++) { const t = await transmit(contenders[n].f, contenders[n].store, outcomes[n].startCapability); calls += t.count(); }
    assert.equal(calls, 1);
    assert.equal((await x.store.inspect(x.f.raw)).snapshot?.heldExposureUsdMicros, 10000);
  });
}
for (const [from, to] of [["openai", "anthropic"], ["anthropic", "openai"]] as const) test(`D PG switch ${from}->${to}: reconciliation/zero usage never clears predecessor; definitive settlement does`, async () => {
  const x = await started(from, `switch-${from}`), sent = await transmit(x.f, x.store, x.start.startCapability); assert.equal(sent.count(), 1);
  await x.store.markReconciliationRequired(x.f.raw); await x.store.recordEvidence(x.f.raw, { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, providerConsumedCents: 0 });
  const next = await setup(to, `switch-${from}`, 2); assert.equal((await next.authority.advanceCurrentAuthority()).status, "advanced");
  for (let n = 0; n < 3; n++) assert.equal((await next.store.reserve(next.f.raw, { maximumExposureUsdMicros: 10000 })).status, "recovery_required");
  assert.equal((await next.store.bindRequest(next.f.raw, next.f.context)).status, "recovery_required");
  assert.equal((await next.store.commitProviderStart(next.f.raw, next.f.prepared.requestFingerprint)).status, "recovery_required");
  const recovered = await recover(x.f, x.store); assert.equal(recovered.decision.verdict, "allow");
  assert.equal((await next.store.reserve(next.f.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
  await next.store.bindRequest(next.f.raw, next.f.context); const start = await next.store.commitProviderStart(next.f.raw, next.f.prepared.requestFingerprint); assert.ok(start.startCapability);
  const result = await transmit(next.f, next.store, start.startCapability); assert.equal(result.decision.normalizedResult?.status, "succeeded");
  assert.equal((await settleCandidate(next.f, next.store, result.decision.normalizedResult)).status, "settled");
});
test("D PG identical Session strings remain provider/account scoped; foreign workspace cannot rebind", async () => {
  const ids: Array<{ provider: string; account: string; result: string }> = [];
  for (const [provider, account, id, w] of [["openai", "account-a", "namespace-openai", live.primaryWorkspace], ["anthropic", "account-a", "namespace-claude", live.primaryWorkspace],
    ["anthropic", "account-b", "namespace-account", live.primaryWorkspace], ["anthropic", "account-a", "namespace-foreign", live.secondaryWorkspace]] as const) {
    const x = await prepared(provider, id, 1, account, w), start = await x.store.commitProviderStart(x.f.raw, x.f.prepared.requestFingerprint);
    const c = await x.store.prepareProviderCorrelation(x.f.raw, x.f.context, start.startCapability); assert.ok(c.providerIdentity);
    const d = await x.store.recordProviderSession(x.f.raw, { target: x.f.target, requestFingerprint: c.providerIdentity.requestFingerprint, correlationFingerprint: c.providerIdentity.correlationFingerprint, sessionId: "session_same_text" });
    ids.push({ provider, account, result: d.verdict });
  }
  assert.deepEqual(ids.map(x => x.result), ["allow", "allow", "allow", "deny"]);
});
test("D PG one aggregate budget admits both providers and releases only through shared definitive settlement", async () => {
  const w = { id: "00000000-0000-4000-8000-0000000000d4", domain: "portability-budget" };
  await live.insertWorkspace(db.admin, w); await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Shared budget')", [w.id]);
  const fixtures = await Promise.all([setup("openai", "budget-openai", 1, w), setup("anthropic", "budget-claude", 1, w), setup("openai", "budget-third", 1, w)]);
  const stores = fixtures.map(x => core.createPostgresExecutorStartStore({ ...x.config, financialPolicy: { ...financialPolicy(), totalExposureUsdMicros: 20000 } }));
  for (const x of fixtures) await x.authority.registerCurrentAuthority();
  const admitted = await Promise.all(stores.slice(0, 2).map((s, i) => s.reserve(fixtures[i].f.raw, { maximumExposureUsdMicros: 10000 })));
  assert.deepEqual(admitted.map(d => d.verdict), ["allow", "allow"]);
  assert.equal((await stores[2].reserve(fixtures[2].f.raw, { maximumExposureUsdMicros: 10000 })).verdict, "deny");
  assert.equal((await db.admin.query("select held_exposure_usd_micros::text as held from executor_exposure_budgets where workspace_id=$1", [w.id])).rows[0].held, "20000");
  const f = fixtures[1].f; await stores[1].bindRequest(f.raw, f.context); const start = await stores[1].commitProviderStart(f.raw, f.prepared.requestFingerprint);
  const result = await transmit(f, stores[1], start.startCapability); assert.equal(result.decision.normalizedResult?.status, "succeeded");
  assert.equal((await settleCandidate(f, stores[1], result.decision.normalizedResult)).status, "settled");
  assert.equal((await stores[2].reserve(fixtures[2].f.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
});
