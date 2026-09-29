/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: HD-12 — a logical Step is dispatched to the provider again after a definitive
// failure of the post-dispatch CAS. KNOWN DEBT (AI-037 census, P1 #1), retained as RED evidence.
//
// Representation (see tests/pg/README.md):
// - "HD-12 CURRENT BEHAVIOUR ..." is a characterization test. It passes on current code and asserts
//   every fact of the defect strictly (dispatch count === 2, first output unrecoverable, ...).
// - "HD-12 AI-037.1 TARGET ..." runs the same scenario with the corrected expectations and is
//   marked `todo`: it executes and fails today without failing the suite.
// AI-037.1 must make the TARGET test pass, remove its `todo`, and delete the CURRENT BEHAVIOUR test
// (which will then fail by design). Neither test may be weakened.
//
// Derived from /tmp/ai037/hd12.mts (T1) and /tmp/ai036-regate2/cas-lost.mts.
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
const persistenceContract = (await import(
  new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-persistence");

const db = await live.useLiveDatabase("hd12");
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

async function outputPersistedAnywhere(outputText: string): Promise<number> {
  const pattern = `%${outputText}%`;
  const count = async (sql: string) => (await db.admin.query(sql, [pattern])).rows[0].n as number;
  return await count("select count(*)::int as n from workflow_runs where runtime_snapshot::text like $1")
    + await count("select count(*)::int as n from workflow_step_runs where state_payload::text like $1")
    + await count("select count(*)::int as n from audit_events where metadata::text like $1")
    + await count("select count(*)::int as n from workflow_model_invocations as i where row_to_json(i)::text like $1")
    + await count("select count(*)::int as n from workflow_runtime_commands where response_payload::text like $1");
}

// provider dispatch #1 succeeds and is settled → the post-dispatch `update-run` CAS statement fails
// with a real server SQLSTATE 40001 (the ROLLBACK succeeds, so the failure is definitive) → the
// Owner retries with a new command / execution at the current revision.
async function runPostDispatchCasFailureScenario() {
  await resetRuntime();
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
  const interceptor = live.installQueryInterceptor();
  try {
    const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({
      database,
      domainWorkspaceId: live.primaryWorkspace.domain,
    });
    assert.ok(persistence);
    const store = persistence.stateStore;
    await store.create({ state: fixtures.executableRuntimeState() });
    let dispatched = false;
    const provider = fixtures.localMockProvider({ beforeRun: () => { dispatched = true; } });
    const service = fixtures.runtimeService(store, provider);
    assert.equal((await service.start(fixtures.startCommand())).status, "running");

    const casFailure = live.rule(
      "post-dispatch CAS fails definitively (SQLSTATE 40001)",
      (text) => dispatched && text.includes("/* workflow-runtime:update-run */"),
      (_client, _config, _values, send) => send(
        "do $$ begin raise exception 'live-test serialization failure' using errcode = '40001'; end $$",
      ),
    );
    interceptor.rules.push(casFailure);
    const first = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-one", "one")));
    const afterFirst = await fixtures.ledger(db.admin);
    interceptor.restore();

    const retry = fixtures.responseSummary(await service.advance(
      fixtures.advanceCommand(afterFirst.runs[0].revision, "advance-retry", "two"),
    ));
    const final = await fixtures.ledger(db.admin);
    const [firstDispatch, secondDispatch] = provider.dispatches;
    return {
      casFailureFired: casFailure.fired,
      first,
      afterFirst,
      retry,
      final,
      dispatches: provider.dispatches,
      firstOutputPersistedCount: firstDispatch ? await outputPersistedAnywhere(firstDispatch.outputText) : null,
      secondOutputPersistedCount: secondDispatch ? await outputPersistedAnywhere(secondDispatch.outputText) : null,
      invocationColumns: (await db.admin.query(`select column_name from information_schema.columns
        where table_name = 'workflow_model_invocations'`)).rows.map((row: any) => row.column_name as string),
    };
  } finally {
    interceptor.restore();
    await database.close();
  }
}

test("HD-12 CURRENT BEHAVIOUR (known debt, RED evidence for AI-037.1): a definitive post-dispatch CAS failure lets the same logical Step dispatch the provider twice", async (t) => {
  const r = await runPostDispatchCasFailureScenario();
  t.diagnostic(`dispatches=${r.dispatches.map((d) => d.invocationId).join(",")} first=${r.first.status} retry=${r.retry.status}`);

  // 1. dispatch #1 happened and succeeded; 2. invocation #1 settled `succeeded`.
  assert.equal(r.dispatches[0]?.invocationId, "invocation-step-one-one");
  assert.deepEqual(r.afterFirst.invocations.map((row: any) => [row.invocation_id, row.status, row.total_tokens]),
    [["invocation-step-one-one", "succeeded", fixtures.mockUsage.totalTokens]]);
  assert.deepEqual(r.afterFirst.budgets.map((row: any) => [row.invocation_id, row.status, row.actual_tokens]),
    [["invocation-step-one-one", "settled", fixtures.mockUsage.totalTokens]]);

  // 3. the final CAS failed definitively: nothing advanced the Run.
  assert.equal(r.casFailureFired, 1);
  assert.deepEqual(r.first, { verdict: "deny", status: "denied", revision: 1, reasons: ["state_store_failed"] });
  assert.deepEqual(r.afterFirst.runs, [{ runtime_id: fixtures.runId, status: "running", revision: 1 }]);
  assert.deepEqual(r.afterFirst.steps, [{ step_key: fixtures.stepId, status: "pending", attempt_count: 0 }]);

  // 4. the execution was classified `failed` although its provider call succeeded.
  assert.deepEqual(r.afterFirst.executions.map((row: any) => [row.execution_id, row.status]),
    [["execution-step-one-one", "failed"]]);

  // 5. a new execution was admitted at the same attempt and revision; 6. dispatch #2 occurred.
  assert.equal(r.retry.status, "completed");
  assert.deepEqual(r.final.executions.map((row: any) => [row.execution_id, row.attempt_number, row.expected_revision, row.status]), [
    ["execution-step-one-one", 1, 1, "failed"],
    ["execution-step-one-two", 1, 1, "completed"],
  ]);
  assert.deepEqual(r.dispatches.map((d) => [d.stepId, d.invocationId]), [
    [fixtures.stepId, "invocation-step-one-one"],
    [fixtures.stepId, "invocation-step-one-two"],
  ]);
  assert.equal(r.dispatches.length, 2, "HD-12: the same logical Step reached the provider twice");

  // 7. both usages were accounted.
  assert.deepEqual(r.final.budgets.map((row: any) => [row.invocation_id, row.status, row.actual_tokens, row.actual_cost]), [
    ["invocation-step-one-one", "settled", fixtures.mockUsage.totalTokens, fixtures.mockUsage.costUsdMicros],
    ["invocation-step-one-two", "settled", fixtures.mockUsage.totalTokens, fixtures.mockUsage.costUsdMicros],
  ]);
  const windows = Object.fromEntries(r.final.windows.map((row: any) => [row.window_kind, [row.reserved, row.consumed]]));
  assert.deepEqual(windows, {
    daily_tokens: ["0", String(2 * fixtures.mockUsage.totalTokens)],
    monthly_cost: ["0", String(2 * fixtures.mockUsage.costUsdMicros)],
  });

  // 8. the first output was not recoverable or applied: no output column exists on the invocation
  //    ledger and the text of dispatch #1 appears nowhere in durable runtime state.
  assert.equal(r.invocationColumns.some((column: string) => /output_text|result|output$/u.test(column)), false);
  assert.equal(r.firstOutputPersistedCount, 0);
  assert.deepEqual(r.final.runs, [{ runtime_id: fixtures.runId, status: "completed", revision: 5 }]);
});

test("HD-12 AI-037.1 TARGET: a definitive post-dispatch CAS failure never dispatches the same logical Step again", {
  todo: "HD-12 is open until AI-037.1; this target is expected to fail on current code",
}, async () => {
  const r = await runPostDispatchCasFailureScenario();
  assert.equal(r.casFailureFired, 1);
  assert.equal(r.dispatches.length, 1, "exactly one provider dispatch for the logical Step");
  assert.notEqual(r.retry.status, "completed", "the retry must not re-execute the Step");
  assert.equal(r.final.budgets.filter((row: any) => row.status === "settled").length, 1, "exactly one settlement");
});
