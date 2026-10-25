import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, financialPolicy, executorTarget, context, executorRequestPolicy } from "../fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizedResult, receipt, frozen, denied, controlledTransport, digest } from "../fixtures/executor-outcome.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const durable = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const core = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const db = await live.useLiveDatabase("executoroutcome");
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await live.insertWorkspace(db.admin, live.secondaryWorkspace);
for (const w of [live.primaryWorkspace, live.secondaryWorkspace])
  await db.admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Outcome test')", [w.id]);
const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.close())); });
async function setup(id: string, n = 1, domain: string = live.primaryWorkspace.domain, url = db.url) {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: url, maxConnections: 1 }); pools.push(database);
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(domain); assert.ok(tenant);
  const config = { database, tenant, projectId: "project-a", configuration: executorConfiguration(n, id), target: executorTarget(), requestPolicy: executorRequestPolicy(), financialPolicy: financialPolicy() };
  const a = authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: config.projectId, configuration: config.configuration });
  return { config, a, raw: executorRequest(n, id), s: durable.createPostgresExecutorStartStore({ ...config, authorizeStart: () => true }) };
}
async function started(id: string, phase = "started") {
  const v = await setup(id); assert.equal((await v.a.registerCurrentAuthority()).status, "registered");
  assert.equal((await v.s.reserve(v.raw, { maximumExposureUsdMicros: 10000 })).status, "reserved");
  if (phase === "reserved") return { ...v, fp: "b".repeat(64) };
  const d = await v.s.bindRequest(v.raw, context()); assert.equal(d.status, "prepared"); assert.ok(d.snapshot?.requestFingerprint);
  if (phase === "started") assert.equal((await v.s.commitProviderStart(v.raw, d.snapshot.requestFingerprint)).status, "start_committed");
  return { ...v, fp: d.snapshot.requestFingerprint };
}
const settle = async (v: Awaited<ReturnType<typeof started>>, status = "succeeded", report?: string,
  evidence: Partial<import("../../lib/executors/executor-outcome").ExecutorOutcomeEvidence> = {}) =>
  v.s.recordDefinitiveOutcomeAndSettle(v.raw, v.fp, await receipt(v.raw.attempt.developmentRunId, v.fp, status, report, evidence));
async function facts(id: string) {
  const key = [live.primaryWorkspace.id, id];
  return {
    exposures: (await db.admin.query("select state,reconciliation,terminal_result_fingerprint,authority_generation,provider_consumed_cents::text,observed_total_tokens::text from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2 order by attempt_number", key)).rows,
    results: (await db.admin.query("select request_fingerprint,result_fingerprint,outcome,payload,provenance from executor_attempt_results where workspace_id=$1 and development_run_id=$2", key)).rows,
    settles: (await db.admin.query("select count(*)::int as n from executor_attempt_events where workspace_id=$1 and development_run_id=$2 and operation='settle'", key)).rows[0].n,
    held: Number((await db.admin.query("select held_exposure_usd_micros::text as n from executor_exposure_budgets where workspace_id=$1", [key[0]])).rows[0].n),
  };
}
test("PG outcome success: durable result + settled exposure + exactly one release + immutable journal", async () => {
  const v = await started("success"), before = await facts("success"), d = await settle(v);
  assert.equal(d.status, "settled"); assert.equal(d.snapshot?.heldExposureUsdMicros, 0); assert.ok(d.normalizedResult); frozen(d);
  const f = await facts("success"); assert.equal(f.held, before.held - 10000); assert.equal(f.results.length, 1); assert.equal(f.settles, 1);
  assert.equal(f.exposures[0].state, "settled"); assert.equal(d.startCapability, null);
});
test("PG outcome restart returns complete byte-identical patch/report, independently validated and fresh/frozen", async () => {
  const v = await started("restart-result"), d = await settle(v), again = await setup("restart-result");
  const a = await again.s.inspectOutcome(again.raw), b = await again.s.inspectOutcome(again.raw);
  assert.equal(a.status, "observed"); assert.deepEqual(a.normalizedResult, d.normalizedResult); assert.deepEqual(a, b);
  assert.notEqual(a.normalizedResult, b.normalizedResult); frozen(a); frozen(b);
  assert.equal(a.normalizedResult?.changes[0].content, normalizedResult("restart-result").changes[0].content);
  assert.equal(a.normalizedResult?.report?.content, normalizedResult("restart-result").report?.content);
  assert.equal(a.normalizedResult?.verificationStatus, "not_run"); assert.equal(a.normalizedResult?.ownerDecisionRequired, true);
  assert.equal(a.normalizedResult?.automaticRetryAllowed, false); assert.equal(a.startCapability, null);
  assert.equal((await again.s.commitProviderStart(again.raw, v.fp)).startCapability, null);
});
test("PG exact replay idempotent, no second release/result/event; inputs unchanged", async () => {
  const v = await started("exact-replay"), before = structuredClone({ raw: v.raw, configuration: v.config.configuration }); await settle(v);
  const f = await facts("exact-replay"), a = await settle(v), b = await settle(v); assert.equal(a.status, "idempotent"); assert.deepEqual(a, b);
  assert.deepEqual(await facts("exact-replay"), f); assert.deepEqual({ raw: v.raw, configuration: v.config.configuration }, before);
});
test("PG bounded large proposal survives JSON escaping and restart byte-for-byte without truncation", async () => {
  const v = await started("large-result"), initial = normalizedResult("large-result"), report = "a".repeat(16384);
  const rawResult = { schemaVersion: 1, identity: initial.identity, invocationId: initial.invocationId, status: "succeeded", failureCode: null,
    changes: [131072, 110000].map((size, n) => { const content = '"'.repeat(size); return { path: `src/large-${n}.ts`, operation: "add", content, sha256: digest(content) }; }), report: { content: report, sha256: digest(report) } };
  const a = core.createExecutorAdapterContract(v.config.configuration).adapter!, i = a.validateInvocation(v.raw).normalizedInvocation!;
  const result = a.evaluateResult(i, rawResult).normalizedResult; assert.ok(result);
  const d = await settle(v, "succeeded", undefined, { normalizedResult: result }); assert.equal(d.status, "settled");
  const again = await setup("large-result"), read = await again.s.inspectOutcome(again.raw); assert.deepEqual(read.normalizedResult, result);
  const f = await facts("large-result"); assert.ok(Buffer.byteLength(f.results[0].payload) > 400000);
});
test("PG independent OS-process restart recovers result, never reconstructs provider start", async () => {
  const v = await started("process-restart"), recorded = await settle(v);
  const script = `import { pathToFileURL } from 'node:url';
    const root=pathToFileURL(process.cwd()+'/');
    const p=await import(new URL('lib/db/postgres.ts',root)), t=await import(new URL('lib/db/workflow-runtime-tenant.ts',root));
    const d=await import(new URL('lib/db/executor-start-store.ts',root)), f=await import(new URL('tests/fixtures/durable-executor.mts',root));
    const database=p.createWorkflowRuntimePostgresDatabase({connectionString:process.env.OUTCOME_TEST_DB,maxConnections:1});
    try { const tenant=await t.createPostgresWorkflowRuntimeTenantResolver(database).resolve('workspace-primary');
      const s=d.createPostgresExecutorStartStore({database,tenant,projectId:'project-a',configuration:f.executorConfiguration(1,'process-restart'),target:f.executorTarget(),requestPolicy:f.executorRequestPolicy(),financialPolicy:f.financialPolicy(),authorizeStart:()=>false});
      const result=await s.inspectOutcome(f.executorRequest(1,'process-restart'));
      process.stdout.write(JSON.stringify({pid:process.pid,result}));
    } catch { process.exitCode=1; } finally { await database.close(); }`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-"], { input: script, encoding: "utf8", timeout: 15000, env: { ...process.env, OUTCOME_TEST_DB: db.url } });
  assert.equal(child.status, 0, "controlled child read succeeded"); const a = JSON.parse(child.stdout);
  assert.notEqual(a.pid, process.pid); assert.equal(a.result.status, "observed"); assert.equal(a.result.startCapability, null);
  assert.deepEqual(a.result.normalizedResult, recorded.normalizedResult); assert.equal(a.result.resultFingerprint, recorded.resultFingerprint);
});
test("PG conflicting terminal replay never overwrites first result", async () => {
  const v = await started("conflicting-replay"); await settle(v); const f = await facts("conflicting-replay");
  denied(await settle(v, "succeeded", "Different unverified report.")); denied(await settle(v, "rejected")); assert.deepEqual(await facts("conflicting-replay"), f);
});
for (const conflicting of [false, true]) test(`PG concurrent ${conflicting ? "conflicting" : "exact"} settlements x10: independent connections release once`, async () => {
  const pids = new Set<number>();
  for (let n = 0; n < 10; n++) {
    const id = `race-${conflicting}-${n}`, a = await started(id), b = await setup(id), before = await facts(id);
    const proofA = await receipt(id, a.fp), proofB = await receipt(id, a.fp, "succeeded", conflicting ? "Other unverified report." : undefined);
    const interceptor = live.installQueryInterceptor(); interceptor.observe((_sql, c) => { if (c.processID) pids.add(c.processID); });
    try {
      const results = await Promise.all([a.s.recordDefinitiveOutcomeAndSettle(a.raw, a.fp, proofA), b.s.recordDefinitiveOutcomeAndSettle(b.raw, a.fp, proofB)]);
      assert.equal(results.filter(d => d.status === "settled").length, 1);
      assert.equal(results.filter(d => d.status === (conflicting ? "conflict" : "idempotent")).length, 1);
      const f = await facts(id); assert.equal(f.results.length, 1); assert.equal(f.settles, 1); assert.equal(f.held, before.held - 10000);
    } finally { interceptor.restore(); }
  }
  assert.ok(pids.size >= 2);
});
for (const status of ["rejected", "failed"]) test(`PG definitive ${status} settles only with trusted terminal evidence`, async () => {
  const v = await started(`terminal-${status}`), d = await settle(v, status); assert.equal(d.status, "settled"); assert.equal(d.normalizedResult?.status, status);
  assert.equal(d.snapshot?.observedCostUsdMicros, null); assert.equal((await facts(`terminal-${status}`)).results.length, 1);
});
test("PG failed-shaped result without terminal evidence is not sufficient", async () => {
  const v = await started("no-evidence"), f = await facts("no-evidence");
  denied(await v.s.recordDefinitiveOutcomeAndSettle(v.raw, v.fp, { terminality: "definitive_terminal", normalizedResult: normalizedResult("no-evidence", "failed") }));
  assert.deepEqual(await facts("no-evidence"), f);
});
test("PG outcome_unknown keeps FULL exposure, no result, no start replay", async () => {
  const v = await started("unknown"), f = await facts("unknown");
  denied(await settle(v, "outcome_unknown", undefined, { terminality: "ambiguous" }));
  const a = await facts("unknown"); assert.equal(a.held, f.held); assert.equal(a.results.length, 0); assert.equal(a.exposures[0].state, "reconciliation_required");
  assert.equal((await v.s.commitProviderStart(v.raw, v.fp)).startCapability, null);
});
for (const kind of ["timeout", "5xx", "invalid", "budget"] as const) test(`PG real injected transport ${kind}: ambiguity remains held, never terminal storage`, async () => {
  const id = `transport-${kind}`, v = await started(id), f = await facts(id), t = await controlledTransport(id, kind); assert.equal(t.fp, v.fp);
  assert.equal(t.calls, 1); assert.ok(t.proof); denied(await v.s.recordDefinitiveOutcomeAndSettle(v.raw, v.fp, t.proof));
  const a = await facts(id); assert.equal(a.held, f.held); assert.equal(a.results.length, 0); assert.equal(a.exposures[0].state, "reconciliation_required");
});
test("PG later trusted reconciliation settles exact previously ambiguous start", async () => {
  const v = await started("later-terminal"); await v.s.markReconciliationRequired(v.raw);
  assert.equal((await settle(v)).status, "settled"); assert.equal((await v.s.inspectOutcome(v.raw)).normalizedResult?.status, "succeeded");
});
test("PG settled result cannot reopen through reconciliation, cancel or late evidence", async () => {
  const v = await started("no-reopen"); await settle(v); const f = await facts("no-reopen");
  for (const d of [await v.s.markReconciliationRequired(v.raw), await v.s.cancel(v.raw), await v.s.recordEvidence(v.raw, { usage: null, providerConsumedCents: null })]) assert.equal(d.verdict, "deny");
  denied(await settle(v, "succeeded", undefined, { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }));
  assert.deepEqual(await facts("no-reopen"), f);
});
for (const first of ["reconcile", "settle"] as const) test(`PG concurrent ${first}-first/reconciliation race x10 cannot reopen or lose result`, async () => {
  for (let n = 0; n < 10; n++) {
    const id = `recon-${first}-${n}`, a = await started(id), b = await setup(id), proof = await receipt(id, a.fp);
    let reach!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { reach = r; }), hold = new Promise<void>(r => { release = r; });
    const it = live.installQueryInterceptor();
    it.rules.push(live.rule("hold serialized winner", live.sqlTag("executor:attempt-lock"), async (_c, cfg, values, send) => { const d = await send(cfg, values); reach(); await hold; return d; }));
    let x: Promise<unknown> | undefined, y: Promise<unknown> | undefined;
    try {
      const terminal = () => a.s.recordDefinitiveOutcomeAndSettle(a.raw, a.fp, proof), reconcile = () => b.s.markReconciliationRequired(b.raw);
      x = first === "settle" ? terminal() : reconcile(); await entered;
      y = first === "settle" ? reconcile() : terminal();
      for (let t = 0; t < 100; t++) {
        if ((await db.admin.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")).rows[0].n > 0) break;
        if (t === 99) assert.fail("contender did not wait on PostgreSQL lock"); await live.sleep(5);
      }
      release(); await Promise.all([x, y]); const f = await facts(id); assert.equal(f.exposures[0].state, "settled"); assert.equal(f.results.length, 1); assert.equal(f.settles, 1);
    } finally { release(); await Promise.allSettled([x, y].filter(Boolean)); it.restore(); }
  }
});
for (const operation of ["revoked", "advanced"] as const) test(`PG authority ${operation} after start does not block historical result`, async () => {
  const id = `authority-${operation}`, v = await started(id);
  if (operation === "revoked") await v.a.revokeCurrentAuthority(); else await (await setup(id, 2)).a.advanceCurrentAuthority();
  const it = live.installQueryInterceptor(), queries: string[] = []; it.observe(sql => queries.push(sql));
  try { assert.equal((await settle(v)).status, "settled"); assert.ok(!queries.some(sql => sql.includes("executor:authority-lock"))); }
  finally { it.restore(); }
  assert.equal((await facts(id)).exposures[0].authority_generation, 1);
});
for (const status of ["paused", "archived"]) test(`PG Project ${status} after start preserves historical result`, async () => {
  const id = `project-${status}`, v = await started(id);
  await db.admin.query("update projects set status=$2 where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id, status]);
  try { assert.equal((await settle(v)).status, "settled"); assert.equal((await v.s.inspectOutcome(v.raw)).status, "observed"); }
  finally { await db.admin.query("update projects set status='active' where workspace_id=$1 and project_key='project-a'", [live.primaryWorkspace.id]); }
});
test("PG foreign workspace has neither result read nor settlement authority", async () => {
  const v = await started("foreign-outcome"); await settle(v); const f = await facts("foreign-outcome");
  const foreign = await setup("foreign-outcome", 1, live.secondaryWorkspace.domain);
  denied(await foreign.s.inspectOutcome(foreign.raw)); denied(await foreign.s.recordDefinitiveOutcomeAndSettle(foreign.raw, v.fp, await receipt("foreign-outcome", v.fp)));
  assert.deepEqual(await facts("foreign-outcome"), f);
});
test("PG changed request/invocation/attempt/repository cannot settle or read factual result", async () => {
  const v = await started("bad-binding"), proof = await receipt("bad-binding", v.fp), f = await facts("bad-binding");
  denied(await v.s.recordDefinitiveOutcomeAndSettle(v.raw, "b".repeat(64), proof));
  for (const raw of [{ ...v.raw, invocationId: "changed" }, { ...v.raw, attempt: { ...v.raw.attempt, number: 2 } }, { ...v.raw, repository: { ...v.raw.repository, baseline: "b".repeat(40) } }]) {
    denied(await v.s.recordDefinitiveOutcomeAndSettle(raw, v.fp, proof)); denied(await v.s.inspectOutcome(raw));
  }
  assert.deepEqual(await facts("bad-binding"), f);
});
for (const phase of ["reserved", "prepared", "cancelled"]) test(`PG ${phase} attempt cannot acquire terminal result`, async () => {
  const v = await started(`early-${phase}`, phase); if (phase === "cancelled") await v.s.cancel(v.raw);
  const f = await facts(`early-${phase}`); denied(await settle(v)); assert.deepEqual(await facts(`early-${phase}`), f);
});
test("PG settlement COMMIT ack loss: null success, latched closed, restart observes ONE result/release", async () => {
  const v = await started("commit-lost"), f = await facts("commit-lost"), proof = await receipt("commit-lost", v.fp), it = live.installQueryInterceptor();
  it.rules.push(live.rule("lost settlement acknowledgement", live.sqlTag("executor-transaction:commit"), async (_c, cfg, values, send) => { await send(cfg, values); throw Error("private-commit-canary"); }));
  try { const d = await v.s.recordDefinitiveOutcomeAndSettle(v.raw, v.fp, proof); denied(d); assert.equal(d.status, "recovery_required"); denied(await v.s.inspectOutcome(v.raw)); }
  finally { it.restore(); }
  const again = await setup("commit-lost"); assert.equal((await again.s.inspectOutcome(again.raw)).status, "observed");
  assert.equal((await again.s.recordDefinitiveOutcomeAndSettle(again.raw, v.fp, proof)).status, "idempotent");
  const a = await facts("commit-lost"); assert.equal(a.held, f.held - 10000); assert.equal(a.results.length, 1); assert.equal(a.settles, 1);
});
for (const tag of ["executor:outcome-insert", "executor:settlement-release", "executor:audit"]) test(`PG rollback at ${tag} preserves prior held exposure with no result`, async () => {
  const id = `rollback-${tag.split(":")[1]}`, v = await started(id), f = await facts(id), proof = await receipt(id, v.fp), it = live.installQueryInterceptor();
  it.rules.push(live.rule("definite statement failure", live.sqlTag(tag), (_c, _cfg, _values, send) => send("do $$ begin raise exception using errcode='40001',message='controlled rollback'; end $$")));
  try { denied(await v.s.recordDefinitiveOutcomeAndSettle(v.raw, v.fp, proof)); } finally { it.restore(); }
  assert.deepEqual(await facts(id), f);
});
test("PG usage missing/zero is allowed evidence, never fictional exact USD cost", async () => {
  const v = await started("usage-zero"), d = await settle(v, "succeeded", undefined, { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, providerConsumedCents: 0 });
  assert.equal(d.status, "settled"); assert.equal(d.snapshot?.observedCostUsdMicros, null); assert.equal(d.snapshot?.observedUsage?.totalTokens, 0);
});
test("PG latest monotonic usage survives missing terminal evidence fields, consumed cents never becomes billing", async () => {
  const v = await started("usage-preserved"); assert.equal((await v.s.recordEvidence(v.raw, { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, providerConsumedCents: 1 })).status, "recorded");
  const d = await settle(v); assert.equal(d.status, "settled"); assert.equal(d.snapshot?.providerConsumedCents, 1); assert.equal(d.snapshot?.observedUsage?.totalTokens, 3); assert.equal(d.snapshot?.observedCostUsdMicros, null);
});
for (const corrupt of ["cap", "usage", "consumed"]) test(`PG contradictory ${corrupt} evidence cannot settle and retains full held exposure`, async () => {
  const id = `corrupt-${corrupt}`, v = await started(id);
  await v.s.recordEvidence(v.raw, { usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 }, providerConsumedCents: 1 });
  const f = await facts(id); denied(await settle(v, "succeeded", undefined, corrupt === "cap" ? { providerConsumedCents: 2 } : corrupt === "consumed" ? { providerConsumedCents: 0 } : { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }));
  const a = await facts(id); assert.equal(a.held, f.held); assert.equal(a.results.length, 0); assert.equal(a.exposures[0].state, "reconciliation_required");
});
for (const corrupt of ["fingerprint", "payload", "journal", "exposure", "budget"]) test(`PG corrupted ${corrupt} read fails closed even after restart`, async () => {
  const id = `read-${corrupt}`, v = await started(id); await settle(v); const again = await setup(id), it = live.installQueryInterceptor();
  const tag = corrupt === "journal" ? "executor:audit-integrity" : corrupt === "exposure" ? "executor:attempt-lock" : corrupt === "budget" ? "executor:budget-lock" : "executor:outcome-read";
  it.rules.push(live.rule("corrupt factual read projection", live.sqlTag(tag), async (_c, cfg, values, send) => {
    const d = await send(cfg, values);
    if (corrupt === "fingerprint") d.rows[0].result_fingerprint = "b".repeat(64);
    if (corrupt === "payload") { const r = JSON.parse(d.rows[0].payload); r.ownerDecisionRequired = false; d.rows[0].payload = JSON.stringify(r); }
    if (corrupt === "journal") d.rows[0].count = 0;
    if (corrupt === "exposure") d.rows[0].terminal_result_fingerprint = "b".repeat(64);
    if (corrupt === "budget") d.rows[0].held_exposure_usd_micros = String(Number(d.rows[0].held_exposure_usd_micros) + 10000);
    return d;
  }));
  try { denied(await again.s.inspectOutcome(again.raw)); } finally { it.restore(); }
});
test("PG direct constraints reject result absence/overwrite/rebinding/delete/backwards state and journal changes", async () => {
  const v = await started("sql-attacks"); await settle(v); const f = await facts("sql-attacks");
  const reject = async (sql: string, values: unknown[] = [live.primaryWorkspace.id]) => { let code: unknown; try { await db.admin.query(sql, values); } catch (e) { code = (e as { code: string }).code; } assert.ok(["23514", "23503", "23505", "55000"].includes(code as string), "expected constraint/immutable SQLSTATE"); };
  for (const assignment of ["payload=payload", "result_fingerprint=repeat('b',64)", "development_run_id='other'"])
    await reject(`update executor_attempt_results set ${assignment} where workspace_id=$1 and development_run_id='sql-attacks'`);
  await reject("delete from executor_attempt_results where workspace_id=$1 and development_run_id='sql-attacks'");
  await reject("update executor_attempt_exposures set state='reconciliation_required',reconciliation='reconciliation_required',terminal_result_fingerprint=null,settled_at=null,event_version=event_version+1 where workspace_id=$1 and development_run_id='sql-attacks'");
  await reject("delete from executor_attempt_events where workspace_id=$1 and development_run_id='sql-attacks'");
  await reject("insert into executor_attempt_events(workspace_id,development_run_id,attempt_number,event_version,state,operation) values($1,'sql-attacks',1,999,'settled','settle')");
  const row = (await db.admin.query("select to_jsonb(r) as value from executor_attempt_results r where workspace_id=$1 and development_run_id='sql-attacks'", [live.primaryWorkspace.id])).rows[0].value;
  const settledRow = (await db.admin.query("select to_jsonb(e) as value from executor_attempt_exposures e where workspace_id=$1 and development_run_id='sql-attacks'", [live.primaryWorkspace.id])).rows[0].value;
  let insertedSettledCode: unknown;
  try { await db.admin.query("insert into executor_attempt_exposures select (jsonb_populate_record(null::executor_attempt_exposures,$1::jsonb)).*", [JSON.stringify({ ...settledRow, id: randomUUID() })]); }
  catch (e) { insertedSettledCode = (e as { code: string }).code; }
  assert.equal(insertedSettledCode, "23514", "cannot fabricate settled state with INSERT instead of a historical transition");
  await reject("insert into executor_attempt_results select (jsonb_populate_record(null::executor_attempt_results,$1::jsonb)).*", [JSON.stringify(row)]);
  for (const change of [{ development_run_id: "absent" }, { workspace_id: live.secondaryWorkspace.id }, { result_fingerprint: "b".repeat(64) }, { outcome: "outcome_unknown" }, { provenance: "ambiguous" }, { payload: "{}" }])
    await reject("insert into executor_attempt_results select (jsonb_populate_record(null::executor_attempt_results,$1::jsonb)).*", [JSON.stringify({ ...row, ...change })]);
  const other = await started("sql-missing");
  await reject("update executor_attempt_exposures set state='settled',terminal_result_fingerprint=repeat('b',64),settled_at=statement_timestamp(),updated_at=statement_timestamp(),event_version=event_version+1 where workspace_id=$1 and development_run_id='sql-missing'");
  await reject("update executor_exposure_budgets set held_exposure_usd_micros=held_exposure_usd_micros-10000 where workspace_id=$1");
  assert.equal((await other.s.inspect(other.raw)).snapshot?.state, "start_committed"); assert.deepEqual((await facts("sql-attacks")).results, f.results);
});
test("PG production composition remains blocked: zero credential reads/network, no result fabrication", async () => {
  const v = await started("production-outcome"), f = await facts("production-outcome"), t = await controlledTransport("production-outcome", "production");
  assert.equal(t.calls, 0); assert.equal(t.credentials, 0); assert.equal(t.decision.verdict, "deny"); assert.equal(t.decision.normalizedResult, null);
  assert.equal((await v.s.inspectOutcome(v.raw)).normalizedResult, null); assert.deepEqual(await facts("production-outcome"), f);
});
test("PG populated 0013 → 0014 → 0015 → 0016 preserves all legacy evidence without fabricated authority/results/provider IDs", async () => {
  const name = `aipc_pgtest_legacy_${randomUUID().replaceAll("-", "")}`, maintenance = live.adminClient(live.databaseUrl("postgres"));
  await maintenance.connect(); await maintenance.query(`create database "${name}"`); const admin = live.adminClient(live.databaseUrl(name));
  try {
    await admin.connect(); const migrations = readdirSync(new URL("../../db/migrations/", import.meta.url)).filter(f => /^\d{4}_.+\.sql$/u.test(f)).sort();
    for (const path of migrations.slice(0, 13)) await admin.query(readFileSync(new URL(`../../db/migrations/${path}`, import.meta.url), "utf8"));
    await live.insertWorkspace(admin, live.primaryWorkspace); await admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Legacy')", [live.primaryWorkspace.id]);
    await admin.query("begin");
    await admin.query("insert into executor_exposure_budgets(workspace_id,maximum_exposure_usd_micros,total_exposure_usd_micros,reservation_ttl_ms,held_exposure_usd_micros) values($1,20000,1000000000,60000,40000)", [live.primaryWorkspace.id]);
    for (const phase of ["reserved", "prepared", "start_committed", "reconciliation_required", "cancelled"]) {
      const id = `legacy-${phase}`, a = core.createExecutorAdapterContract(executorConfiguration(1, id)).adapter!, i = a.validateInvocation(executorRequest(1, id)).normalizedInvocation!;
      const values = [live.primaryWorkspace.id, id];
      await admin.query(`insert into executor_attempt_exposures(workspace_id,project_key,development_run_id,attempt_number,attempt_kind,plan_id,task_id,executor_id,executor_version,invocation_id,repository_id,repository_baseline,capability,mode,provider_id,provider_model_id,account_id,invocation_fingerprint,maximum_exposure_usd_micros,provider_spend_limit_cents,state,reconciliation,event_version,created_at,updated_at,expires_at)
        values($1,'project-a',$2,1,'initial','plan-a','task-a','openai-agents','v1','invocation-a','repo-a',$3,'coding','patch_proposal','openai','explicit-test-model','account-a',$4,10000,1,'reserved','not_started',1,statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '60 seconds')`, [...values, i.repository.baseline, digest(JSON.stringify(i))]);
      await admin.query("insert into executor_attempt_events(workspace_id,development_run_id,attempt_number,event_version,state,operation) values($1,$2,1,1,'reserved','reserve')", values);
      const advance = async (set: string, operation: string) => {
        await admin.query(`update executor_attempt_exposures set ${set},updated_at=statement_timestamp(),event_version=event_version+1 where workspace_id=$1 and development_run_id=$2`, values);
        await admin.query(`insert into executor_attempt_events(workspace_id,development_run_id,attempt_number,event_version,state,operation) select workspace_id,development_run_id,attempt_number,event_version,state,'${operation}' from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2`, values);
      };
      if (phase !== "reserved") await advance("state='prepared',request_fingerprint=repeat('b',64),prepared_at=statement_timestamp()", "prepare");
      if (["start_committed", "reconciliation_required"].includes(phase)) await advance("state='start_committed',started_at=statement_timestamp(),reconciliation='usage_unknown'", "start");
      if (phase === "reconciliation_required") await advance("state='reconciliation_required',reconciliation='reconciliation_required',observed_input_tokens=1,observed_output_tokens=2,observed_total_tokens=3,provider_consumed_cents=1", "reconcile");
      if (phase === "cancelled") await advance("state='cancelled'", "cancel");
    }
    await admin.query("commit");
    const evidence = async () => (await admin.query("select to_jsonb(e) - array['authority_generation','canonical_run_fingerprint','admission_fingerprint','terminal_result_fingerprint','settled_at'] as value from executor_attempt_exposures e order by development_run_id")).rows;
    const before = await evidence(), journalBefore = (await admin.query("select * from executor_attempt_events order by development_run_id,event_version")).rows,
      budgetBefore = (await admin.query("select * from executor_exposure_budgets")).rows;
    for (const path of migrations.slice(13)) await admin.query(readFileSync(new URL(`../../db/migrations/${path}`, import.meta.url), "utf8"));
    assert.deepEqual(await evidence(), before);
    assert.deepEqual((await admin.query("select * from executor_attempt_events order by development_run_id,event_version")).rows, journalBefore);
    assert.deepEqual((await admin.query("select * from executor_exposure_budgets")).rows, budgetBefore);
    for (const table of ["executor_run_authorities", "executor_authority_events", "executor_attempt_results", "executor_provider_executions", "executor_provider_identity_events"]) assert.equal((await admin.query(`select count(*)::int as n from ${table}`)).rows[0].n, 0);
    assert.equal((await admin.query("select held_exposure_usd_micros::text as n from executor_exposure_budgets")).rows[0].n, "40000");
    for (const phase of ["reserved", "prepared"]) {
      const v = await setup(`legacy-${phase}`, 1, live.primaryWorkspace.domain, live.databaseUrl(name));
      assert.equal((await v.s.bindRequest(v.raw, context())).verdict, "deny"); assert.equal((await v.s.commitProviderStart(v.raw, "b".repeat(64))).startCapability, null);
    }
    assert.equal((await admin.query("select count(*)::int as n from executor_attempt_exposures where authority_generation is null and terminal_result_fingerprint is null")).rows[0].n, 5);
  } finally {
    await Promise.all(pools.splice(0).map(p => p.close())); await admin.end(); await maintenance.query(`drop database "${name}" with (force)`); await maintenance.end();
  }
});
test("PG complete outcome suite has no deadlocks and aggregate equals active held exposures", async () => {
  await db.admin.query("select pg_stat_clear_snapshot()"); assert.equal(Number((await db.admin.query("select deadlocks from pg_stat_database where datname=current_database()")).rows[0].deadlocks), 0);
  const r = await db.admin.query("select b.held_exposure_usd_micros::text as held,(select coalesce(sum(e.maximum_exposure_usd_micros),0)::text from executor_attempt_exposures e where e.workspace_id=b.workspace_id and e.state not in ('cancelled','settled')) as actual from executor_exposure_budgets b");
  for (const row of r.rows) assert.equal(row.held, row.actual);
});
