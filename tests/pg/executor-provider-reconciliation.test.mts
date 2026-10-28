import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { spawnSync } from "node:child_process";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, executorTarget, financialPolicy, context, executorRequestPolicy } from "../fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { fakeProvider, savedSession, savedTurn, savedAnswer, reasoningItem, savedPage, initialUserInput, assertHeld } from "../fixtures/executor-provider-reconciliation.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const durable = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const reconciliation = await import(new URL("../../lib/executors/openai-agents-reconciliation.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-reconciliation");
const composition = await import(new URL("../../lib/composition/executor-provider-reconciliation.ts", import.meta.url).href) as typeof import("../../lib/composition/executor-provider-reconciliation");
const db = await live.useLiveDatabase("reconciliation");
for (const w of [live.primaryWorkspace, live.secondaryWorkspace]) {
  await live.insertWorkspace(db.admin, w);
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Recovery fixture')", [w.id]);
}
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
async function setup(id: string, domain: string = live.primaryWorkspace.domain) {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(domain); assert.ok(tenant);
  const config = { database, tenant, projectId: "project-a", configuration: executorConfiguration(1, id), target: executorTarget(), requestPolicy: executorRequestPolicy(), financialPolicy: financialPolicy(), authorizeStart: () => true };
  return { config, store: durable.createPostgresExecutorStartStore(config), raw: executorRequest(1, id), authority: authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: "project-a", configuration: config.configuration }) };
}
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
async function started(id: string, known: "none" | "session" | "turn" = "turn") {
  const f = await setup(id); assert.equal((await f.authority.registerCurrentAuthority()).verdict, "allow");
  assert.equal((await f.store.reserve(f.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
  const prep = await f.store.bindRequest(f.raw, context()); assert.ok(prep.snapshot?.requestFingerprint);
  const start = await f.store.commitProviderStart(f.raw, prep.snapshot.requestFingerprint); assert.ok(start.startCapability);
  const corr = await f.store.prepareProviderCorrelation(f.raw, context(), start.startCapability); assert.ok(corr.providerIdentity);
  const observation = { requestFingerprint: prep.snapshot.requestFingerprint, correlationFingerprint: corr.providerIdentity.correlationFingerprint, target: executorTarget(), sessionId: `session_${id}` };
  if (known !== "none") assert.equal((await f.store.recordProviderSession(f.raw, observation)).verdict, "allow");
  if (known === "turn") assert.equal((await f.store.recordProviderTurn(f.raw, { ...observation, turnId: "turn_a" })).verdict, "allow");
  await f.store.markProviderIdentityUnknown(f.raw);
  const provider = fakeProvider(observation.correlationFingerprint, observation.sessionId);
  const create = (store = f.store, client = provider.client()) => reconciliation.createOpenAIAgentsRetrievalTestReconciler({ configuration: f.config.configuration, target: f.config.target, store, retrievalClient: client });
  return { ...f, ...provider, observation, create };
}
async function held(f: Awaited<ReturnType<typeof started>>) {
  const e = (await f.store.inspect(f.raw)).snapshot; assert.ok(e); assert.equal(e.heldExposureUsdMicros, 10000); assert.equal(e.state, "reconciliation_required");
  assert.equal((await f.store.inspectOutcome(f.raw)).normalizedResult, null);
}
async function settled(f: Awaited<ReturnType<typeof started>>) {
  const result = await f.store.inspectOutcome(f.raw); assert.equal(result.snapshot?.state, "settled"); assert.equal(result.snapshot?.heldExposureUsdMicros, 0);
  assert.equal(result.snapshot.observedCostUsdMicros, null);
  const rows = await db.admin.query("select count(*)::int as n from executor_attempt_results where workspace_id=$1 and development_run_id=$2", [live.primaryWorkspace.id, f.raw.attempt.developmentRunId]);
  assert.equal(rows.rows[0].n, 1); return result;
}
test("PG W5 exact saved IDs -> completed proposal -> atomic settlement; replay no double release", async () => {
  const f = await started("reconcile-w5"), r = f.create(); const d = await r.reconcile(f.raw); assert.equal(d.status, "settled");
  const first = await settled(f); assert.equal(first.normalizedResult?.status, "succeeded");
  for (let n = 0; n < 3; n++) { assert.equal((await r.reconcile(f.raw)).status, "idempotent"); assert.deepEqual(await settled(f), first); }
  assert.equal((await f.store.inspectProviderIdentity(f.raw)).providerIdentity?.recoveryRequired, true, "settlement does not clear sticky incident");
});
for (const known of ["none", "session", "turn"] as const) test(`PG OS-process restart ${known} -> retrieval -> durable result, no capability resurrection`, async () => {
  const f = await started(`restart-${known}`, known);
  const code = `import {pathToFileURL} from 'node:url';const root=pathToFileURL(process.cwd()+'/');
    const [p,t,s,f,x,r]=await Promise.all(['lib/db/postgres.ts','lib/db/workflow-runtime-tenant.ts','lib/db/executor-start-store.ts','tests/fixtures/durable-executor.mts','tests/fixtures/executor-provider-reconciliation.mts','lib/executors/openai-agents-reconciliation.ts'].map(v=>import(new URL(v,root))));
    const database=p.createWorkflowRuntimePostgresDatabase({connectionString:process.env.RECOVERY_TEST_DB,maxConnections:1});
    try{const tenant=await t.createPostgresWorkflowRuntimeTenantResolver(database).resolve('workspace-primary'),id='restart-${known}',raw=f.executorRequest(1,id);
    const store=s.createPostgresExecutorStartStore({database,tenant,projectId:'project-a',configuration:f.executorConfiguration(1,id),target:f.executorTarget(),requestPolicy:f.executorRequestPolicy(),financialPolicy:f.financialPolicy(),authorizeStart:()=>false});
    const before=await store.inspectProviderIdentity(raw),provider=x.fakeProvider(before.providerIdentity.correlationFingerprint,'session_'+id);
    provider.state.items.unshift(x.initialUserInput(f.executorConfiguration(1,id),raw).item);
    const reconciler=r.createOpenAIAgentsRetrievalTestReconciler({configuration:f.executorConfiguration(1,id),target:f.executorTarget(),store,retrievalClient:provider.client()});
    const d=await reconciler.reconcile(raw),after=await store.inspectProviderIdentity(raw),replay=await store.prepareProviderCorrelation(raw,f.context());
    process.stdout.write(JSON.stringify({pid:process.pid,d,after,cap:replay.providerCapability,calls:provider.state.calls}));}finally{await database.close();}`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-"], { input: code, encoding: "utf8", timeout: 20000, env: { ...process.env, RECOVERY_TEST_DB: db.url } });
  assert.equal(child.status, 0, "restart child succeeds"); const result = JSON.parse(child.stdout);
  assert.notEqual(result.pid, process.pid); assert.equal(result.d.status, "settled"); assert.equal(result.d.startCapability, null); assert.equal(result.d.providerCapability, null); assert.equal(result.cap, null);
  assert.equal(result.after.providerIdentity.sessionId, f.observation.sessionId); assert.equal(result.after.providerIdentity.turnId, "turn_a"); assert.ok(result.calls.every((c: { method: string }) => c.method === "GET"));
  await settled(f);
});
test("PG session-only discovers exactly one root; persists through fresh store", async () => {
  const f = await started("discover-turn", "session"); assert.equal((await f.create().reconcile(f.raw)).status, "settled");
  assert.equal((await durable.createPostgresExecutorStartStore(f.config).inspectProviderIdentity(f.raw)).providerIdentity?.turnId, "turn_a"); await settled(f);
});
test("PG correlation-only exactly one exhaustive session match persists session and turn", async () => {
  const f = await started("discover-session", "none"); assert.equal((await f.create().reconcile(f.raw)).status, "settled");
  const p = (await f.store.inspectProviderIdentity(f.raw)).providerIdentity; assert.equal(p?.sessionId, f.observation.sessionId); assert.equal(p.turnId, "turn_a"); await settled(f);
});
for (const kind of ["zero", "multiple", "incomplete"]) test(`PG correlation ${kind}: full hold, no absence proof`, async () => {
  const f = await started(`session-${kind}`, "none");
  if (kind === "zero") f.state.sessions = [];
  if (kind === "multiple") f.state.sessions.push(savedSession(f.observation.correlationFingerprint, "session_b"));
  if (kind === "incomplete") { let page = 0; f.state.override = () => Response.json(savedPage([savedSession(f.observation.correlationFingerprint, `session_${++page}`)], true)); }
  assertHeld(await f.create().reconcile(f.raw)); await held(f); assert.equal((await f.store.inspectProviderIdentity(f.raw)).providerIdentity?.sessionId, null);
});
for (const status of ["queued", "in_progress", "waiting"]) test(`PG nonterminal ${status} stays held`, async () => {
  const f = await started(`turn-${status}`); f.state.turn = savedTurn("turn_a", f.observation.sessionId, status);
  assertHeld(await f.create().reconcile(f.raw)); await held(f);
});
test("PG completed final answer across pages, reasoning discarded", async () => {
  const f = await started("paginated-final"); f.state.items = [reasoningItem(), savedAnswer()]; f.state.pageSize = 1;
  assert.equal((await f.create().reconcile(f.raw)).status, "settled"); const d = await settled(f); assert.doesNotMatch(JSON.stringify(d), /private-reasoning-canary/u);
});
test("PG completed missing final answer stays recovery_required", async () => {
  const f = await started("missing-final"); f.state.items = []; assertHeld(await f.create().reconcile(f.raw)); await held(f);
});
for (const status of ["failed", "cancelled"]) test(`PG terminal ${status} settles static failed result`, async () => {
  const f = await started(`terminal-${status}`); f.state.turn = savedTurn("turn_a", f.observation.sessionId, status);
  Object.assign(f.state.turn, { error: status === "failed" ? { code: "private-error-canary", message: "private-error-canary" } : null });
  const r = f.create(); assert.equal((await r.reconcile(f.raw)).status, "settled");
  const first = await settled(f); assert.equal(first.normalizedResult?.failureCode, status === "failed" ? "provider_failure" : "execution_failure");
  assert.equal((await r.reconcile(f.raw)).status, "idempotent"); assert.deepEqual(await settled(f), first);
});
test("PG final corrective: failed with null error settles factual provider failure", async () => {
  const f = await started("failed-null-error"); f.state.turn = savedTurn("turn_a", f.observation.sessionId, "failed");
  assert.equal((await f.create().reconcile(f.raw)).status, "settled"); assert.equal((await settled(f)).normalizedResult?.failureCode, "provider_failure");
});
test("PG final corrective: cancelled structured error keeps full hold and no terminal result", async () => {
  const f = await started("cancelled-structured-error"); f.state.turn = savedTurn("turn_a", f.observation.sessionId, "cancelled");
  Object.assign(f.state.turn, { error: { code: "private-error-canary", message: "private-error-canary" } });
  const d = await f.create().reconcile(f.raw); assertHeld(d); assert.equal(d.status, "unavailable"); await held(f);
  assert.equal((await db.admin.query("select count(*)::int as n from executor_attempt_results where workspace_id=$1 and development_run_id=$2", [live.primaryWorkspace.id, f.raw.attempt.developmentRunId])).rows[0].n, 0);
  assert.ok(f.state.calls.every(c => c.method === "GET")); assert.equal(f.state.calls.length, 2);
});
test("PG missing usage permits factual terminality, never invents cost", async () => {
  const f = await started("missing-usage"); Object.assign(f.state.turn, { usage: null }); Object.assign(f.state.session, { usage: null, spend_control: { limit: 1, consumed: null } });
  assert.equal((await f.create().reconcile(f.raw)).status, "settled"); const d = await settled(f); assert.equal(d.snapshot?.observedUsage, null); assert.equal(d.snapshot?.providerConsumedCents, null);
});
for (const kind of ["usage-arithmetic", "usage-regression", "consumed-overcap", "consumed-regression"]) test(`PG ${kind} contradiction holds exposure`, async () => {
  const f = await started(`contradiction-${kind}`);
  if (kind === "usage-arithmetic") f.state.turn.usage.total_tokens++;
  if (kind === "usage-regression") assert.equal((await f.store.recordEvidence(f.raw, { usage: { inputTokens: 11, outputTokens: 20, totalTokens: 31 }, providerConsumedCents: null })).verdict, "allow");
  if (kind === "consumed-overcap") f.state.session.spend_control.consumed = 2;
  if (kind === "consumed-regression") assert.equal((await f.store.recordEvidence(f.raw, { usage: null, providerConsumedCents: 1 })).verdict, "allow");
  assertHeld(await f.create().reconcile(f.raw)); await held(f);
});
for (const state of ["revoked", "advanced", "paused", "archived"]) test(`PG historical recovery after ${state}`, async () => {
  const f = await started(`historical-${state}`);
  if (state === "revoked" || state === "advanced") await f.authority.revokeCurrentAuthority();
  if (state === "advanced") { const a = authority.createPostgresExecutorCurrentAuthorityStore({ database: f.config.database, tenant: f.config.tenant, projectId: "project-a", configuration: executorConfiguration(2, f.raw.attempt.developmentRunId) }); assert.equal((await a.advanceCurrentAuthority()).status, "advanced"); }
  if (state === "paused" || state === "archived") await db.admin.query("update projects set status=$2 where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id, state]);
  try { assert.equal((await f.create().reconcile(f.raw)).status, "settled"); await settled(f); }
  finally { await db.admin.query("update projects set status='active' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]); }
});
for (const known of ["turn", "none"] as const) test(`PG independent-store concurrent ${known} reconciliation x10: single result/release and idempotent discovery`, async () => {
  for (let n = 0; n < 10; n++) {
    const f = await started(`race-${known}-${n}`, known), other = await setup(f.raw.attempt.developmentRunId);
    const results = await Promise.all([f.create().reconcile(f.raw), f.create(other.store).reconcile(other.raw)]);
    assert.deepEqual(results.map(d => d.status).sort(), ["idempotent", "settled"]); await settled(f);
    assert.equal((await f.store.inspectProviderIdentity(f.raw)).providerIdentity?.turnId, "turn_a");
  }
});
test("PG conflicting terminal result cannot overwrite result or release twice", async () => {
  const f = await started("conflict-result"), r = f.create(); assert.equal((await r.reconcile(f.raw)).status, "settled"); const before = await settled(f);
  f.state.items = [savedAnswer("message_a", "turn_a", "Different bounded proposal report.")]; assertHeld(await r.reconcile(f.raw)); assert.deepEqual(await settled(f), before);
});
test("PG foreign tenant opaque: zero retrieval, no partial output", async () => {
  const f = await started("foreign-tenant"), other = await setup(f.raw.attempt.developmentRunId, live.secondaryWorkspace.domain);
  assertHeld(await f.create(other.store).reconcile(other.raw)); assert.equal(f.state.calls.length, 0); await held(f);
});
for (const key of ["accountId", "modelId"]) test(`PG foreign ${key}: zero provider GET`, async () => {
  const f = await started(`foreign-${key.toLowerCase()}`), store = durable.createPostgresExecutorStartStore({ ...f.config, target: { ...f.config.target, [key]: "foreign" } });
  assertHeld(await f.create(store).reconcile(f.raw)); assert.equal(f.state.calls.length, 0); await held(f);
});
test("PG production composition cannot read credentials, retrieve or create provider execution", async () => {
  const f = await started("production-lock"); const d = await composition.createExecutorProviderReconciliationComposition().reconcile(); assertHeld(d); assert.equal(f.state.calls.length, 0); await held(f);
});
test("PG GET unavailable never retries, redispatches or settles", async () => {
  const f = await started("retrieval-unavailable"); f.state.override = () => new Response("private-error-canary", { status: 503 });
  assertHeld(await f.create().reconcile(f.raw)); assert.equal(f.state.calls.length, 1); await held(f);
});
for (const conflict of ["identity", "result"]) test(`PG independent conflicting ${conflict} recovery x10: first fact never overwritten`, async () => {
  for (let n = 0; n < 10; n++) {
    const f = await started(`conflicting-${conflict}-${n}`, conflict === "identity" ? "none" : "turn"), other = await setup(f.raw.attempt.developmentRunId);
    const provider = fakeProvider(f.observation.correlationFingerprint, conflict === "identity" ? `foreign_session_${n}` : f.observation.sessionId);
    if (conflict === "result") provider.state.items = [savedAnswer("message_a", "turn_a", "Different bounded proposal report.")];
    const decisions = await Promise.all([f.create().reconcile(f.raw), f.create(other.store, provider.client()).reconcile(other.raw)]);
    assert.equal(decisions.filter(d => d.verdict === "allow").length, 1); assert.equal(decisions.filter(d => d.verdict === "deny").length, 1);
    const result = await settled(f); assert.equal(result.resultFingerprint, decisions.find(d => d.verdict === "allow")?.resultFingerprint);
    const p = (await f.store.inspectProviderIdentity(f.raw)).providerIdentity; assert.equal(p?.recoveryRequired, true);
    assert.ok([f.observation.sessionId, `foreign_session_${n}`].includes(p!.sessionId!));
  }
});
test("PG lost settlement COMMIT ACK: no partial output; fresh recovery replay reads committed result", async () => {
  const f = await started("recovery-ack"), interceptor = live.installQueryInterceptor(); let settling = false;
  interceptor.observe(sql => { if (sql.includes("executor:outcome-insert")) settling = true; });
  interceptor.rules.push(live.rule("settlement acknowledgement lost", sql => settling && sql.includes("executor-transaction:commit"), async (_client, sql, values, send) => { await send(sql, values); throw Error("private-error-canary"); }));
  try { assertHeld(await f.create().reconcile(f.raw)); assert.equal(interceptor.rules[0].fired, 1); }
  finally { interceptor.restore(); }
  const fresh = durable.createPostgresExecutorStartStore(f.config); assert.equal((await f.create(fresh).reconcile(f.raw)).status, "idempotent");
  const d = await fresh.inspectOutcome(f.raw); assert.equal(d.snapshot?.heldExposureUsdMicros, 0); assert.equal(d.normalizedResult?.status, "succeeded");
});
test("PG final uniqueness/deadlock audit", async () => {
  assert.equal((await db.admin.query("select count(*)::int as n from (select workspace_id,development_run_id,attempt_number from executor_attempt_results group by 1,2,3 having count(*)>1) duplicates")).rows[0].n, 0);
  await db.admin.query("select pg_stat_clear_snapshot()"); assert.equal(Number((await db.admin.query("select deadlocks from pg_stat_database where datname=current_database()")).rows[0].deadlocks), 0);
});
test("PG corrective: official opaque item cursor + failed-session string + bound initial user -> durable terminal recovery", async () => {
  const f = await started("official-saved-shape"), user = initialUserInput(f.config.configuration, f.raw).item;
  Object.assign(f.state.session, { status: "failed", error: "private-error-canary" });
  f.state.override = url => {
    if (!url.pathname.endsWith("/items")) return;
    if (url.searchParams.get("after") === null) return Response.json({ ...savedPage([user], true), last_id: "cursor_xyz" });
    assert.equal(url.searchParams.get("after"), "cursor_xyz"); assert.equal(url.searchParams.get("order"), "asc");
    return Response.json({ ...savedPage([reasoningItem(), savedAnswer("item_b")]), last_id: "cursor_terminal" });
  };
  const before = structuredClone(f.state.session), r = f.create(); assert.equal((await r.reconcile(f.raw)).status, "settled");
  const d = await settled(f); assert.doesNotMatch(JSON.stringify(d), /private-error-canary|private-reasoning-canary|authorized test context/u);
  assert.deepEqual(f.state.session, before); assert.equal((await r.reconcile(f.raw)).status, "idempotent");
  assert.equal(f.state.calls.filter(c => /after=cursor_xyz$/u.test(c.path)).length, 2); assert.ok(f.state.calls.every(c => c.method === "GET"));
  const payload = await db.admin.query("select payload from executor_attempt_results where workspace_id=$1 and development_run_id=$2", [live.primaryWorkspace.id, f.raw.attempt.developmentRunId]);
  assert.doesNotMatch(JSON.stringify(payload.rows), /private-error-canary|private-reasoning-canary|authorized test context/u);
});
for (const kind of ["cursor-loop", "missing-cursor", "oversized-cursor", "duplicate-item", "extra-user", "changed-user", "user-only", "nonfailed-error"]) test(`PG corrective ${kind}: no terminal result, full hold`, async () => {
  const f = await started(`corrective-${kind}`), user = initialUserInput(f.config.configuration, f.raw).item;
  if (kind === "extra-user") f.state.items = [user, { ...user, id: "steering" }, savedAnswer()];
  if (kind === "changed-user") { user.content[0].text = user.content[0].text.replace("authorized test context", "private-input-canary"); f.state.items = [user, savedAnswer()]; }
  if (kind === "user-only") f.state.items = [user];
  if (kind === "nonfailed-error") Object.assign(f.state.session, { error: "private-error-canary" });
  if (["cursor-loop", "missing-cursor", "oversized-cursor", "duplicate-item"].includes(kind)) {
    let n = 0; f.state.override = url => {
      if (!url.pathname.endsWith("/items")) return;
      n++;
      const data = n === 1 ? [reasoningItem("item_a")] : [savedAnswer(kind === "duplicate-item" ? "item_a" : "item_b")];
      const cursor = kind === "missing-cursor" ? null : kind === "oversized-cursor" ? "c".repeat(1025) : kind === "cursor-loop" ? "cursor_loop" : `cursor_${n}`;
      return Response.json({ ...savedPage(data, n === 1 || kind === "cursor-loop"), last_id: cursor });
    };
  }
  const d = await f.create().reconcile(f.raw); assertHeld(d); await held(f);
  assert.doesNotMatch(JSON.stringify(d), /private-input-canary/u); assert.ok(f.state.calls.every(c => c.method === "GET"));
});
