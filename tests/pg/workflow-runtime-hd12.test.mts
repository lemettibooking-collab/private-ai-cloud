/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: HD-12 — no second provider dispatch for a logical Step once the provider may
// already have been dispatched and the Step result was not committed (fixed in AI-037.1).
//
// The post-dispatch `update-run` CAS statement is made to fail definitively with a real server
// SQLSTATE 40001 (the ROLLBACK succeeds). An execution whose provider may have run must stay
// unresolved (`outcome_unknown`) so every later claim of the same Step attempt answers
// recovery_required. Executions that never reached the provider, or whose provider call failed
// definitively at no cost (0 tokens, 0 cost), keep their existing retryable `failed` semantics.
// AI-037.1.2: a definitive failed result that consumed usage or cost is a paid provider outcome and
// is protected exactly like a succeeded one.
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
const signalsContract = (await import(
  new URL("../../lib/contracts/runtime-operational-signals.ts", import.meta.url).href
)) as typeof import("../../lib/contracts/runtime-operational-signals");

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

type ScenarioOptions = Readonly<{
  firstOutcome?: import("./helpers/runtime-fixtures").MockProviderOutcome;
  failFirstPreflight?: boolean;
  failPostDispatchCas?: boolean;
  failPreDispatchCas?: boolean;
}>;

// Owner starts the Run and advances step-one (execution/invocation "one"); optionally the first
// dispatch's post-dispatch CAS fails definitively. Afterwards the Owner replays the same command,
// reuses the same execution id under a new command, and retries with a new execution ("two").
async function runScenario(options: ScenarioOptions) {
  await resetRuntime();
  const collector = signalsContract.createRuntimeOperationalSignalCollector();
  const database = postgres.createWorkflowRuntimePostgresDatabase({
    connectionString: db.url, maxConnections: 4, signals: collector.sink,
  });
  const interceptor = live.installQueryInterceptor();
  try {
    const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({
      database,
      domainWorkspaceId: live.primaryWorkspace.domain,
      providerExecutionTiming: fixtures.providerExecutionTiming(),
      signals: collector.sink,
    });
    assert.ok(persistence);
    const store = persistence.stateStore;
    await store.create({ state: fixtures.executableRuntimeState() });
    let dispatched = false;
    let preflights = 0;
    const provider = fixtures.localMockProvider({
      beforeRun: () => { dispatched = true; },
      outcome: () => (provider.dispatches.length === 1 ? options.firstOutcome ?? "succeeded" : "succeeded"),
      failPreflight: () => { preflights += 1; return options.failFirstPreflight === true && preflights === 1; },
    });
    const service = fixtures.runtimeService(store, provider, collector.sink);
    assert.equal((await service.start(fixtures.startCommand())).status, "running");

    const casFailure = live.rule(
      "CAS fails definitively (SQLSTATE 40001)",
      (text) => text.includes("/* workflow-runtime:update-run */")
        && ((options.failPostDispatchCas === true && dispatched)
          || (options.failPreDispatchCas === true && preflights > 0 && !dispatched)),
      (_client, _config, _values, send) => send(
        "do $$ begin raise exception 'live-test serialization failure' using errcode = '40001'; end $$",
      ),
    );
    interceptor.rules.push(casFailure);
    const first = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-one", "one")));
    const dispatchesAfterFirst = provider.dispatches.length;
    const afterFirst = await fixtures.ledger(db.admin);
    const signalsAfterFirst = collector.snapshot();
    interceptor.restore();

    const revision = afterFirst.runs[0].revision;
    const replay = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-one", "one")));
    const sameExecutionNewCommand = fixtures.responseSummary(
      await service.advance(fixtures.advanceCommand(revision, "advance-same-execution", "one")),
    );
    const dispatchesBeforeRetry = provider.dispatches.length;
    const retry = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(revision, "advance-retry", "two")));
    return {
      signalsAfterFirst,
      signals: collector.snapshot(),
      casFailureFired: casFailure.fired,
      first,
      dispatchesAfterFirst,
      afterFirst,
      replay,
      sameExecutionNewCommand,
      dispatchesBeforeRetry,
      retry,
      final: await fixtures.ledger(db.admin),
      dispatches: provider.dispatches,
    };
  } finally {
    interceptor.restore();
    await database.close();
  }
}

const executionStates = (ledger: any) => ledger.executions.map((row: any) =>
  [row.execution_id, row.attempt_number, row.expected_revision, row.status]);

test("HD-12: settled provider success + definitive post-dispatch CAS failure never dispatches the Step again", async (t) => {
  const r = await runScenario({ failPostDispatchCas: true });
  t.diagnostic(`dispatches=${r.dispatches.map((d) => d.invocationId).join(",")} first=${r.first.status} retry=${r.retry.status}`);

  // Dispatch #1 happened, succeeded and is durably settled; the final CAS failed definitively.
  assert.equal(r.casFailureFired, 1);
  assert.equal(r.dispatchesAfterFirst, 1);
  assert.deepEqual(r.first, { verdict: "deny", status: "denied", revision: 1, reasons: ["state_store_failed"] });
  assert.deepEqual(r.afterFirst.invocations.map((row: any) => [row.invocation_id, row.status, row.total_tokens]),
    [["invocation-step-one-one", "succeeded", fixtures.mockUsage.totalTokens]]);
  assert.deepEqual(r.afterFirst.budgets.map((row: any) => [row.invocation_id, row.status, row.actual_tokens]),
    [["invocation-step-one-one", "settled", fixtures.mockUsage.totalTokens]]);

  // The execution stays unresolved instead of becoming a retryable `failed`; the Step is not completed.
  assert.deepEqual(executionStates(r.afterFirst), [["execution-step-one-one", 1, 1, "outcome_unknown"]]);
  assert.deepEqual(r.afterFirst.runs, [{ runtime_id: fixtures.runId, status: "running", revision: 1 }]);
  assert.deepEqual(r.afterFirst.steps, [{ step_key: fixtures.stepId, status: "pending", attempt_count: 0 }]);

  // Exact replay returns the stored response; neither the same execution id nor a new execution
  // can bypass the unresolved Step attempt.
  assert.deepEqual(r.replay, { ...r.first, verdict: "idempotent" });
  assert.equal(r.sameExecutionNewCommand.status, "recovery_required");
  assert.equal(r.retry.status, "recovery_required");
  assert.ok(r.retry.reasons.includes("execution_recovery_required"));

  // Exactly one dispatch, one invocation, one settlement; nothing completed the Step.
  assert.equal(r.dispatches.length, 1, "exactly one provider dispatch for the logical Step");
  assert.deepEqual(r.final.invocations.map((row: any) => [row.invocation_id, row.status]),
    [["invocation-step-one-one", "succeeded"]], "no second invocation was created");
  assert.deepEqual(r.final.budgets.map((row: any) => [row.invocation_id, row.status, row.actual_tokens, row.actual_cost]),
    [["invocation-step-one-one", "settled", fixtures.mockUsage.totalTokens, fixtures.mockUsage.costUsdMicros]]);
  const windows = Object.fromEntries(r.final.windows.map((row: any) => [row.window_kind, [row.reserved, row.consumed]]));
  assert.deepEqual(windows, {
    daily_tokens: ["0", String(fixtures.mockUsage.totalTokens)],
    monthly_cost: ["0", String(fixtures.mockUsage.costUsdMicros)],
  });
  assert.deepEqual(executionStates(r.final), [["execution-step-one-one", 1, 1, "outcome_unknown"]]);
  assert.deepEqual(r.final.runs, [{ runtime_id: fixtures.runId, status: "running", revision: 1 }]);
  assert.deepEqual(r.final.steps, [{ step_key: fixtures.stepId, status: "pending", attempt_count: 0 }]);
});

test("HD-12 boundary: an ambiguous provider outcome stays unresolved and blocks redispatch", async () => {
  const r = await runScenario({ firstOutcome: "lost" });
  assert.equal(r.first.status, "recovery_required");
  assert.deepEqual(r.afterFirst.invocations.map((row: any) => [row.invocation_id, row.status]),
    [["invocation-step-one-one", "outcome_unknown"]]);
  assert.deepEqual(r.afterFirst.budgets.map((row: any) => row.status), ["outcome_unknown"]);
  assert.deepEqual(executionStates(r.afterFirst), [["execution-step-one-one", 1, 1, "outcome_unknown"]]);
  assert.equal(r.retry.status, "recovery_required");
  assert.equal(r.dispatches.length, 1);
  assert.equal(r.final.invocations.length, 1);
});

test("HD-12 boundary: a failure before provider dispatch keeps the existing retry semantics", async () => {
  // The preflight fails before any dispatch and the CAS recording that failure also fails, so the
  // execution never left `prepared`: it must remain an ordinary retryable `failed`.
  const r = await runScenario({ failFirstPreflight: true, failPreDispatchCas: true });
  assert.equal(r.casFailureFired, 1);
  assert.equal(r.dispatchesAfterFirst, 0, "the provider was never started");
  // Existing behaviour: the CAS failure and the fail-closed known-outcome record of a still
  // `prepared` execution each report state_store_failed; the claim release then retires it.
  assert.deepEqual(r.first, {
    verdict: "deny", status: "denied", revision: 1, reasons: ["state_store_failed", "state_store_failed"],
  });
  assert.deepEqual(executionStates(r.afterFirst), [["execution-step-one-one", 1, 1, "failed"]]);
  assert.equal(r.afterFirst.budgets.some((row: any) => row.status === "settled"), false);
  // A new execution is admitted and completes with the only provider dispatch.
  assert.equal(r.retry.status, "completed");
  assert.deepEqual(r.dispatches.map((d) => d.invocationId), ["invocation-step-one-two"]);
  assert.deepEqual(r.final.runs, [{ runtime_id: fixtures.runId, status: "completed", revision: 5 }]);
});

test("HD-12 boundary: a definitive FREE provider failure (0 tokens, 0 cost) + post-dispatch CAS failure keeps the existing retry semantics", async () => {
  const r = await runScenario({ firstOutcome: "failed", failPostDispatchCas: true });
  assert.equal(r.casFailureFired, 1);
  assert.deepEqual(r.afterFirst.invocations.map((row: any) => [row.invocation_id, row.status, row.total_tokens, row.cost]),
    [["invocation-step-one-one", "failed", 0, 0]]);
  // The free failure consumed nothing: its reservation is released and both windows are untouched.
  assert.deepEqual(r.afterFirst.budgets.map((row: any) => [row.status, row.actual_tokens, row.actual_cost]), [["released", null, null]]);
  const windowsAfterFirst = Object.fromEntries(r.afterFirst.windows.map((row: any) => [row.window_kind, [row.reserved, row.consumed]]));
  assert.deepEqual(windowsAfterFirst, { daily_tokens: ["0", "0"], monthly_cost: ["0", "0"] });
  // It is not turned into outcome_unknown merely because the invocation is `failed`.
  assert.deepEqual(executionStates(r.afterFirst), [["execution-step-one-one", 1, 1, "failed"]]);
  assert.equal(r.signalsAfterFirst.outcome_unknown, 0);
  assert.equal(r.retry.status, "completed");
  assert.deepEqual(r.dispatches.map((d) => d.invocationId), ["invocation-step-one-one", "invocation-step-one-two"]);
  assert.equal(r.final.budgets.filter((row: any) => row.status === "settled" && row.actual_tokens > 0).length, 1,
    "only the successful dispatch consumed usage");
});

test("AI-037.1.2 (F-1): a PAID definitive provider failure + post-dispatch CAS failure never dispatches the Step again", async (t) => {
  const r = await runScenario({ firstOutcome: "failed_paid", failPostDispatchCas: true });
  t.diagnostic(`dispatches=${r.dispatches.map((d) => d.invocationId).join(",")} first=${r.first.status} `
    + `retry=${r.retry.status} executions=${JSON.stringify(executionStates(r.final))} signals=${JSON.stringify(r.signals)}`);

  // Dispatch #1 returned a valid normalized FAILED result that consumed usage and cost; the
  // outcome and the settled budget are durable; the final CAS failed definitively.
  assert.equal(r.casFailureFired, 1);
  assert.equal(r.dispatchesAfterFirst, 1);
  assert.deepEqual(r.first, { verdict: "deny", status: "denied", revision: 1, reasons: ["state_store_failed"] });
  assert.deepEqual(r.afterFirst.invocations.map((row: any) => [row.invocation_id, row.status, row.total_tokens, row.cost]),
    [["invocation-step-one-one", "failed", fixtures.mockUsage.totalTokens, fixtures.mockUsage.costUsdMicros]]);
  const outcome = await db.admin.query("select outcome from workflow_model_invocations where invocation_id = 'invocation-step-one-one'");
  assert.equal(outcome.rows[0].outcome, "failed");
  assert.deepEqual(r.afterFirst.budgets.map((row: any) => [row.status, row.actual_tokens, row.actual_cost]),
    [["settled", fixtures.mockUsage.totalTokens, fixtures.mockUsage.costUsdMicros]]);

  // The paid outcome keeps the execution unresolved; the Step is not failed or completed.
  assert.deepEqual(executionStates(r.afterFirst), [["execution-step-one-one", 1, 1, "outcome_unknown"]]);
  assert.deepEqual(r.afterFirst.runs, [{ runtime_id: fixtures.runId, status: "running", revision: 1 }]);
  assert.deepEqual(r.afterFirst.steps, [{ step_key: fixtures.stepId, status: "pending", attempt_count: 0 }]);
  assert.equal(r.signalsAfterFirst.outcome_unknown, 1, "emitted after the COMMIT of the unresolved transition");

  // No ordinary advance can reach the provider again.
  assert.deepEqual(r.replay, { ...r.first, verdict: "idempotent" });
  assert.equal(r.sameExecutionNewCommand.status, "recovery_required");
  assert.equal(r.retry.status, "recovery_required");
  assert.ok(r.retry.reasons.includes("execution_recovery_required"));
  assert.equal(r.dispatches.length, 1, "exactly one provider dispatch for the logical Step attempt");
  assert.deepEqual(r.final.invocations.map((row: any) => [row.invocation_id, row.status]),
    [["invocation-step-one-one", "failed"]], "no second invocation was created");
  const windows = Object.fromEntries(r.final.windows.map((row: any) => [row.window_kind, [row.reserved, row.consumed]]));
  assert.deepEqual(windows, {
    daily_tokens: ["0", String(fixtures.mockUsage.totalTokens)],
    monthly_cost: ["0", String(fixtures.mockUsage.costUsdMicros)],
  }, "cost was consumed exactly once");
  assert.deepEqual(executionStates(r.final), [["execution-step-one-one", 1, 1, "outcome_unknown"]]);
  assert.equal(r.signals.outcome_unknown, 1);
  assert.equal(r.signals.recovery_required, 2, "the two fresh blocked advances; the exact replay is not counted");
  assert.equal(r.signals.provider_redispatch, 0);
});

test("AI-037.1.2 control: a PAID definitive failure whose Step failure commits normally is terminal, not a recovery incident", async () => {
  const r = await runScenario({ firstOutcome: "failed_paid" });
  assert.equal(r.first.status, "failed");
  assert.deepEqual(executionStates(r.afterFirst), [["execution-step-one-one", 1, 1, "failed"]]);
  assert.deepEqual(r.afterFirst.invocations.map((row: any) => [row.status, row.cost]), [["failed", fixtures.mockUsage.costUsdMicros]]);
  assert.deepEqual(r.afterFirst.budgets.map((row: any) => row.status), ["settled"]);
  assert.deepEqual(r.afterFirst.runs, [{ runtime_id: fixtures.runId, status: "failed", revision: 3 }]);
  assert.equal(r.sameExecutionNewCommand.status, "failed");
  assert.ok(r.sameExecutionNewCommand.reasons.includes("terminal_run"));
  assert.equal(r.retry.status, "failed");
  assert.ok(r.retry.reasons.includes("terminal_run"));
  assert.equal(r.dispatches.length, 1, "no second dispatch");
  assert.equal(r.signals.outcome_unknown, 0);
  assert.equal(r.signals.recovery_required, 0);
});

test("HD-12 control: without a CAS failure the Step completes with exactly one dispatch", async () => {
  const r = await runScenario({});
  assert.equal(r.first.status, "completed");
  assert.deepEqual(executionStates(r.afterFirst), [["execution-step-one-one", 1, 1, "completed"]]);
  assert.equal(r.dispatches.length, 1);
});
