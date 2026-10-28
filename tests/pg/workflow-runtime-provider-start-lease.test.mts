/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: AI-037.6a provider-start fence requires enough REMAINING claim lease.
//
// Claim lease 30 s, provider timeout 10 s, safety margin 10 s: generation may start only while at
// least 20 s of lease remain. The store clock is injected; the mock provider's preflight advances
// it to simulate a slow remote input-token count after the claim was acquired.
import assert from "node:assert/strict";
import { test } from "node:test";

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

const db = await live.useLiveDatabase("leasefence");
await live.insertWorkspace(db.admin, live.primaryWorkspace);

async function resetRuntime() {
  for (const sql of [
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

// One advance whose remote preflight "takes" `preflightMs` on the store clock. With
// `holdInvocationLockMs`, a separate live session holds the invocation row FOR UPDATE while the
// provider-start fence runs, so the fence really waits on that lock.
async function advanceWithPreflightDuration(preflightMs: number, holdInvocationLockMs = 0) {
  await resetRuntime();
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
  const interceptor = live.installQueryInterceptor();
  const startExecutions: string[] = [];
  interceptor.observe((text) => { if (text.includes("/* workflow-runtime:start-execution */")) startExecutions.push(text); });
  const lockHolder = live.adminClient(db.url);
  await lockHolder.connect();
  let lockReleased: Promise<void> = Promise.resolve();
  if (holdInvocationLockMs > 0) {
    interceptor.rules.push(live.rule("hold invocation lock during the provider-start fence",
      live.sqlTag("workflow-runtime:read-execution"), async (_client, config, values, send) => {
        const result = await send(config, values);
        await lockHolder.query("begin");
        await lockHolder.query(`select 1 from workflow_model_invocations
          where invocation_id = 'invocation-step-one-one' for update`);
        lockReleased = live.sleep(holdInvocationLockMs).then(() => lockHolder.query("commit")).then(() => undefined);
        return result;
      }));
  }
  try {
    const tenant = await tenantContract.createPostgresWorkflowRuntimeTenantResolver(database).resolve(live.primaryWorkspace.domain);
    assert.ok(tenant);
    const clock = { offsetMs: 0 };
    const store = new storeContract.PostgresWorkflowRuntimeStateStore({
      database,
      tenant,
      providerExecutionTiming: fixtures.providerExecutionTiming(10_000, 30_000),
      now: () => new Date(Date.now() + clock.offsetMs),
    });
    assert.equal(store.claimLeaseDurationMs, 30_000);
    await store.create({ state: fixtures.executableRuntimeState() });
    const provider = fixtures.localMockProvider({
      failPreflight: () => { clock.offsetMs += preflightMs; return false; },
    });
    const service = fixtures.runtimeService(store, provider);
    assert.equal((await service.start(fixtures.startCommand())).status, "running");
    const response = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-one", "one")));
    return { response, dispatches: provider.dispatches.length, startExecutions: startExecutions.length, ledger: await fixtures.ledger(db.admin) };
  } finally {
    interceptor.restore();
    await lockReleased;
    await lockHolder.end();
    await database.close();
  }
}

test("AI-037.6a: a long preflight that leaves less than timeout + margin of lease never reaches generation", async (t) => {
  const r = await advanceWithPreflightDuration(10_500); // about 19.5 s of lease left < 20 s required
  t.diagnostic(`response=${JSON.stringify(r.response)} dispatches=${r.dispatches}`);
  assert.equal(r.dispatches, 0, "no provider generation");
  assert.equal(r.startExecutions, 0, "the execution was never started");
  assert.notEqual(r.response.status, "completed");
  assert.equal(r.ledger.executions.some((row: any) => row.status === "running" || row.status === "completed"), false);
  assert.deepEqual(r.ledger.budgets.map((row: any) => row.status), ["released"], "reserved budget returned");
  const windows = Object.fromEntries(r.ledger.windows.map((row: any) => [row.window_kind, [row.reserved, row.consumed]]));
  assert.deepEqual(windows, { daily_tokens: ["0", "0"], monthly_cost: ["0", "0"] }, "no spend");
  assert.deepEqual(r.ledger.runs, [{ runtime_id: fixtures.runId, status: "running", revision: 1 }]);
});

test("AI-037.6a control: a preflight that leaves enough lease proceeds to exactly one generation", async () => {
  const r = await advanceWithPreflightDuration(5_000); // about 25 s of lease left >= 20 s required
  assert.equal(r.response.status, "completed");
  assert.equal(r.dispatches, 1);
  assert.equal(r.startExecutions, 1);
});

test("AI-037.6a: time spent waiting for the invocation/budget lock is counted by the final provider-start check", async (t) => {
  // Early check: about 21 s left (>= 20 s). The fence then waits about 1.5 s for the invocation row
  // lock held by a live session, so the final check sees about 19.5 s (< 20 s) and refuses.
  const r = await advanceWithPreflightDuration(8_900, 1_500);
  t.diagnostic(`response=${JSON.stringify(r.response)} dispatches=${r.dispatches}`);
  assert.equal(r.dispatches, 0, "no provider generation");
  assert.equal(r.startExecutions, 0, "the execution was never started");
  assert.equal(r.ledger.executions.some((row: any) => row.status === "running" || row.status === "completed"), false);
  assert.deepEqual(r.ledger.budgets.map((row: any) => row.status), ["released"], "reserved budget returned");
  const windows = Object.fromEntries(r.ledger.windows.map((row: any) => [row.window_kind, [row.reserved, row.consumed]]));
  assert.deepEqual(windows, { daily_tokens: ["0", "0"], monthly_cost: ["0", "0"] }, "no spend");
});
