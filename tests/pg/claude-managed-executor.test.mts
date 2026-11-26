import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { claudeFixture, ports, fake, syntheticClaudeReceipt } from "../fixtures/claude-managed.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { financialPolicy } from "../fixtures/durable-executor.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const core = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const db = await live.useLiveDatabase("claudefake");
for (const w of [live.primaryWorkspace, live.secondaryWorkspace]) { await live.insertWorkspace(db.admin, w); await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Claude fake')", [w.id]); }
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
async function setup(id: string, n = 1) {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain); assert.ok(tenant);
  const f = claudeFixture(id, n, tenant.workspaceDatabaseId), config = { database, tenant, projectId: "project-a", configuration: f.configuration,
    target: f.target, requestPolicy: f.policy, financialPolicy: financialPolicy(), authorizeStart: () => true };
  return { f, config, store: core.createPostgresExecutorStartStore(config), authority: authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: config.projectId, configuration: f.configuration }) };
}
async function started(id: string) {
  const f = await setup(id); assert.equal((await f.authority.registerCurrentAuthority()).status, "registered");
  assert.equal((await f.store.reserve(f.f.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
  assert.equal((await f.store.bindRequest(f.f.raw, f.f.context)).snapshot?.requestFingerprint, f.f.prepared.requestFingerprint);
  const start = await f.store.commitProviderStart(f.f.raw, f.f.prepared.requestFingerprint); assert.ok(start.startCapability);
  return { ...f, start };
}
test("C PG shared lifecycle, session-only identity, synthetic exact settlement and fresh-store recovery", async () => {
  const x = await started("claude-success"), p = ports(x.f, x.store);
  const result = await p.executor.execute(x.f.raw, x.start.startCapability); assert.equal(result.verdict, "allow");
  const saved = (await x.store.inspectProviderIdentity(x.f.raw)).providerIdentity; assert.equal(saved?.identityState, "session_observed"); assert.equal(saved.turnId, null);
  assert.equal((await p.executor.execute(x.f.raw, x.start.startCapability)).verdict, "deny"); assert.equal(p.provider.stats().creates, 1);
  const fresh = await setup("claude-success"), reconstructed = ports(fresh.f, fresh.store, fake.createClaudeManagedFakeProvider(fresh.f.script));
  const candidate = await reconstructed.inspector.inspect(fresh.f.raw); assert.equal(candidate.verdict, "allow"); assert.deepEqual(candidate.normalizedResult, result.normalizedResult);
  assert.equal(reconstructed.provider.stats().creates, 0);
  const receipt = await syntheticClaudeReceipt(fresh.f, candidate.normalizedResult);
  assert.equal((await fresh.store.recordDefinitiveOutcomeAndSettle(fresh.f.raw, fresh.f.prepared.requestFingerprint, receipt)).status, "settled");
  assert.equal((await fresh.store.recordDefinitiveOutcomeAndSettle(fresh.f.raw, fresh.f.prepared.requestFingerprint, receipt)).status, "idempotent");
  assert.equal((await fresh.store.inspect(fresh.f.raw)).snapshot?.heldExposureUsdMicros, 0);
  const row = (await db.admin.query("select provider_id,turn_id,identity_state from executor_provider_executions where development_run_id='claude-success'")).rows[0];
  assert.deepEqual(row, { provider_id: "anthropic", turn_id: null, identity_state: "session_observed" });
});
for (const mode of ["timeout", "missing", "invalid", "action", "overrun"]) test(`C PG ${mode} retains full hold, exact replay/new instance never redispatches`, async () => {
  const x = await started(`claude-${mode}`);
  if (mode === "timeout") x.f.script.createOutcome = "timeout";
  if (mode === "missing") x.f.script.session.id = "";
  if (mode === "invalid") x.f.script.pages[0].events[1].content = "not JSON";
  if (mode === "action") x.f.script.session.stopReason = "requires_action";
  if (mode === "overrun") x.f.script.session.budgetOvershoot = true;
  const p = ports(x.f, x.store), d = await p.executor.execute(x.f.raw, x.start.startCapability); assert.equal(d.normalizedResult, null);
  assert.equal((await x.store.inspect(x.f.raw)).snapshot?.heldExposureUsdMicros, 10000);
  await p.executor.execute(x.f.raw, x.start.startCapability); assert.equal(p.provider.stats().creates, 1);
  const fresh = await setup(`claude-${mode}`), next = ports(fresh.f, fresh.store);
  const replay = await fresh.store.commitProviderStart(fresh.f.raw, fresh.f.prepared.requestFingerprint); assert.equal(replay.startCapability, null);
  assert.equal((await next.executor.execute(fresh.f.raw, replay.startCapability)).normalizedResult, null); assert.equal(next.provider.stats().creates, 0);
  if (mode === "timeout" || mode === "missing") { assert.equal((await next.inspector.inspect(fresh.f.raw)).verdict, "deny"); assert.equal(next.provider.stats().reads, 0); }
  assert.equal((await db.admin.query("select count(*)::int as n from executor_attempt_results where development_run_id=$1", [fresh.f.raw.attempt.developmentRunId])).rows[0].n, 0);
});
test("C PG predecessor blocks corrective attempt; historical inspection/settlement after advance clears it", async () => {
  const old = await started("claude-barrier"), p = ports(old.f, old.store); assert.equal((await p.executor.execute(old.f.raw, old.start.startCapability)).verdict, "allow");
  await old.store.markReconciliationRequired(old.f.raw);
  const next = await setup("claude-barrier", 2); assert.equal((await next.authority.advanceCurrentAuthority()).status, "advanced");
  assert.equal((await next.store.reserve(next.f.raw, { maximumExposureUsdMicros: 10000 })).status, "recovery_required");
  const recovered = await p.inspector.inspect(old.f.raw); assert.equal(recovered.verdict, "allow");
  assert.equal((await old.store.recordDefinitiveOutcomeAndSettle(old.f.raw, old.f.prepared.requestFingerprint, await syntheticClaudeReceipt(old.f, recovered.normalizedResult))).status, "settled");
  assert.equal((await next.store.reserve(next.f.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
});
test("C PG lost correlation COMMIT acknowledgement emits no capability and no fake Create", async () => {
  const x = await started("claude-lostack"), interceptor = live.installQueryInterceptor(); let inserted = false, lost = false;
  interceptor.rules.push(live.rule("remember correlation", live.sqlTag("executor:provider-correlation-prepare"), async (_c, cfg, vals, send) => { inserted = true; return send(cfg, vals); }));
  interceptor.rules.push(live.rule("lose committed ACK", sql => inserted && sql.includes("executor-transaction:commit"), async (_c, cfg, vals, send) => { await send(cfg, vals); lost = true; throw Error("private-ack-canary"); }));
  const p = ports(x.f, x.store);
  try { assert.equal((await p.executor.execute(x.f.raw, x.start.startCapability)).normalizedResult, null); } finally { interceptor.restore(); }
  assert.equal(lost, true); assert.equal(p.provider.stats().creates, 0); assert.equal((await x.store.inspect(x.f.raw)).snapshot, null);
  const fresh = await setup("claude-lostack"); assert.equal((await fresh.store.inspect(fresh.f.raw)).snapshot?.heldExposureUsdMicros, 10000);
  const replay = await fresh.store.prepareProviderCorrelation(fresh.f.raw, fresh.f.context, null); assert.equal(replay.providerCapability, null);
  assert.equal((await p.executor.execute(x.f.raw, x.start.startCapability)).verdict, "deny"); assert.equal(p.provider.stats().creates, 0);
});
test("C PG stale/revoked authority cannot start a prepared Claude request", async () => {
  const x = await setup("claude-revoked"); await x.authority.registerCurrentAuthority(); await x.store.reserve(x.f.raw, { maximumExposureUsdMicros: 10000 }); await x.store.bindRequest(x.f.raw, x.f.context);
  await x.authority.revokeCurrentAuthority(); const start = await x.store.commitProviderStart(x.f.raw, x.f.prepared.requestFingerprint);
  assert.equal(start.verdict, "deny"); assert.equal(start.startCapability, null); const p = ports(x.f, x.store);
  assert.equal((await p.executor.execute(x.f.raw, start.startCapability)).verdict, "deny"); assert.equal(p.provider.stats().creates, 0);
});
