/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: ambiguous-COMMIT reconciliation baseline (HD-13 is OPEN; this documents the
// CURRENT fail-closed behaviour for AI-037.3, it does not fix it).
//
// Injection: a test-database-only deferred constraint trigger sleeps inside COMMIT; the driver hook
// sends the real COMMIT and then reports a lost acknowledgement after 100 ms, so the adapter
// destroys the session while the old backend is still committing. Reconciliation therefore reads on
// a fresh session before the COMMIT is visible. The COMMIT lands about 1 s later (well inside
// client_connection_check_interval = 5 s).
// Derived from /tmp/ai036-regate2/f2-ambiguous.mts (2 s variant, shortened).
import assert from "node:assert/strict";
import { after, test } from "node:test";

const live = (await import(
  new URL("./helpers/live-pg.ts", import.meta.url).href
)) as typeof import("./helpers/live-pg");
const fixtures = (await import(
  new URL("./helpers/runtime-fixtures.ts", import.meta.url).href
)) as typeof import("./helpers/runtime-fixtures");

const postgres = (await import(
  new URL("../../lib/db/postgres.ts", import.meta.url).href
)) as typeof import("../../lib/db/postgres");
const tenantContract = (await import(
  new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-tenant");
const storeContract = (await import(
  new URL("../../lib/db/workflow-runtime-store.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-store");

const commitDelaySeconds = 1;
const db = await live.useLiveDatabase("reconcile");
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await db.admin.query("create table live_test_commit_delay (table_name text primary key, seconds float8 not null)");
await db.admin.query(`create function live_test_commit_delay() returns trigger language plpgsql as $$
  declare delay float8;
  begin
    select seconds into delay from live_test_commit_delay where table_name = TG_TABLE_NAME;
    if delay is not null then perform pg_sleep(delay); end if;
    return null;
  end $$`);
for (const table of ["workflow_model_invocations", "workflow_runs"]) {
  await db.admin.query(`create constraint trigger live_test_commit_delay after insert or update on ${table}
    deferrable initially deferred for each row execute function live_test_commit_delay()`);
}

const interceptor = live.installQueryInterceptor();
after(() => interceptor.restore());
interceptor.observe((text, client) => {
  if (/^\s*begin\b/iu.test(text)) client.__liveTags = new Set<string>();
  const tag = text.match(/\/\* (workflow-runtime[^*]*?) \*\//u)?.[1];
  if (tag && client.__liveTags) client.__liveTags.add(tag);
});

type InFlight = { oldPid: number; atReconciliation: any };

// Arms a one-shot lost-ACK on the COMMIT of the first transaction that executed `tag`.
function armInFlightCommit(tag: string, table: string, enabled: () => boolean = () => true) {
  const evidence: InFlight = { oldPid: 0, atReconciliation: null };
  const commitRule = live.rule(`in-flight COMMIT of ${tag}`,
    (text, client) => enabled() && /^\s*commit\s*$/iu.test(text) && Boolean(client.__liveTags?.has(tag)),
    async (client, config, values, send) => {
      evidence.oldPid = client.processID;
      await db.admin.query("insert into live_test_commit_delay values ($1, $2)", [table, commitDelaySeconds]);
      send(config, values).catch(() => {});
      await live.sleep(100);
      await db.admin.query("delete from live_test_commit_delay");
      evidence.atReconciliation = (await db.admin.query(`select state, wait_event, query from pg_stat_activity
        where pid = $1`, [client.processID])).rows[0] ?? null;
      throw new Error("Connection terminated unexpectedly");
    });
  interceptor.rules.push(commitRule);
  return { commitRule, evidence };
}

async function resetRuntime() {
  for (const sql of [
    "delete from live_test_commit_delay",
    "delete from workflow_model_budget_reservations",
    "delete from workflow_model_budget_windows",
    "delete from workflow_model_invocations",
    "delete from workflow_runtime_executions",
    "delete from workflow_runtime_claims",
    "delete from workflow_runtime_commands",
    "delete from workflow_step_runs where runtime_revision is not null",
    "delete from audit_events where runtime_run_id is not null",
    "delete from workflow_runs where runtime_id is not null",
  ]) await db.admin.query(sql);
}

async function runtime() {
  await resetRuntime();
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
  const tenant = await tenantContract.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain);
  assert.ok(tenant);
  const real = new storeContract.PostgresWorkflowRuntimeStateStore({
    database, tenant, providerExecutionTiming: fixtures.providerExecutionTiming(),
  });
  await real.create({ state: fixtures.executableRuntimeState() });
  const recording = fixtures.recordingStore(real);
  let dispatched = false;
  const provider = fixtures.localMockProvider({ beforeRun: () => { dispatched = true; } });
  const service = fixtures.runtimeService(recording.store, provider);
  assert.equal((await service.start(fixtures.startCommand())).status, "running");
  return { database, recording, provider, service, dispatched: () => dispatched };
}

test("in-flight COMMIT of the invocation reservation reconciles fail-closed: recovery_required, no dispatch, no settlement", async () => {
  const { database, recording, provider, service } = await runtime();
  try {
    const { commitRule, evidence } = armInFlightCommit("workflow-runtime:reserve-model-invocation", "workflow_model_invocations");
    const first = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-one", "one")));

    assert.equal(commitRule.fired, 1);
    assert.deepEqual(
      { state: evidence.atReconciliation?.state, waitEvent: evidence.atReconciliation?.wait_event, query: evidence.atReconciliation?.query },
      { state: "active", waitEvent: "PgSleep", query: "commit" },
      "the old backend was still inside COMMIT while reconciliation ran",
    );
    const reconciliation = recording.calls.filter((call) => call.method === "reserveModelInvocation");
    assert.deepEqual(reconciliation.map((call) => call.status), ["recovery_required"]);
    assert.equal(first.status, "recovery_required");
    assert.equal(provider.dispatches.length, 0);

    // The destroyed session's COMMIT lands afterwards (HD-13: orphan `running` reservation).
    assert.equal(await live.waitForBackendExit(db.admin, evidence.oldPid, 10_000), true);
    const landed = await fixtures.ledger(db.admin);
    assert.deepEqual(landed.invocations.map((row: any) => [row.invocation_id, row.status]),
      [["invocation-step-one-one", "running"]]);
    assert.deepEqual(landed.budgets, [], "no budget reservation or settlement");
    assert.equal(provider.dispatches.length, 0);
  } finally {
    await database.close();
  }
});

test("in-flight COMMIT of the post-dispatch CAS fails closed (state_store_failed) with no duplicate dispatch or settlement", async () => {
  const context = await runtime();
  const { database, recording, provider, service } = context;
  try {
    const { commitRule, evidence } = armInFlightCommit("workflow-runtime:update-run", "workflow_runs", context.dispatched);
    const first = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-one", "one")));

    assert.equal(commitRule.fired, 1);
    assert.equal(evidence.atReconciliation?.query, "commit");
    assert.equal(evidence.atReconciliation?.wait_event, "PgSleep");
    // Current behaviour (HD-13 / HD-5): reconciliation reads the pre-commit Run and reports
    // "not observed" → the service answers state_store_failed. Never conflict, never success.
    assert.ok(recording.calls.some((call) => call.method === "compareAndSwap"
      && call.status === "threw:Workflow CAS commit was not observed."));
    assert.deepEqual({ verdict: first.verdict, status: first.status, reasons: first.reasons },
      { verdict: "deny", status: "denied", reasons: ["state_store_failed"] });
    assert.equal(provider.dispatches.length, 1);

    assert.equal(await live.waitForBackendExit(db.admin, evidence.oldPid, 10_000), true);
    const landed = await fixtures.ledger(db.admin);
    assert.ok(landed.runs[0].revision > 1, "the in-flight CAS COMMIT landed after reconciliation");

    const retry = fixtures.responseSummary(await service.advance(
      fixtures.advanceCommand(landed.runs[0].revision, "advance-retry", "two"),
    ));
    const final = await fixtures.ledger(db.admin);
    assert.equal(retry.status, "completed");
    assert.equal(provider.dispatches.length, 1, "no duplicate provider dispatch");
    assert.deepEqual(final.budgets.map((row: any) => [row.invocation_id, row.status, row.actual_tokens]),
      [["invocation-step-one-one", "settled", fixtures.mockUsage.totalTokens]], "exactly one settlement");
  } finally {
    await database.close();
  }
});
