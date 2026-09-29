/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: AI-037.4a minimum operational signals, with one collector shared by the DB
// adapter, the store (through persistence) and the runtime service, as a future composition root
// would wire them. Local mock provider only; no network.
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

const db = await live.useLiveDatabase("signals");
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

async function runtime(options: Readonly<{
  outcome?: () => "succeeded" | "failed" | "lost";
  sink?: unknown;
  failFirstRunBeforeDispatch?: boolean;
  failRunBeforeDispatch?: (run: number) => boolean;
}> = {}) {
  await resetRuntime();
  const collector = signalsContract.createRuntimeOperationalSignalCollector();
  const sink = options.sink ?? collector.sink;
  const database = postgres.createWorkflowRuntimePostgresDatabase({
    connectionString: db.url, maxConnections: 4, signals: sink as any,
  });
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({
    database, domainWorkspaceId: live.primaryWorkspace.domain,
    providerExecutionTiming: fixtures.providerExecutionTiming(), signals: sink,
  });
  assert.ok(persistence);
  const store = persistence.stateStore;
  await store.create({ state: fixtures.executableRuntimeState() });
  let dispatched = false;
  let runs = 0;
  const provider = fixtures.localMockProvider({
    beforeRun: () => {
      runs += 1;
      // Fails inside run() before the mock records a dispatch: the provider-start fence committed,
      // but no generation request ever left the process.
      if ((options.failFirstRunBeforeDispatch && runs === 1) || options.failRunBeforeDispatch?.(runs)) {
        throw new Error("no dispatch");
      }
      dispatched = true;
    },
    ...(options.outcome ? { outcome: options.outcome } : {}),
  });
  const service = fixtures.runtimeService(store, provider, sink);
  assert.equal((await service.start(fixtures.startCommand())).status, "running");
  return { database, store, service, provider, collector, dispatched: () => dispatched };
}

const zero = { db_failure: 0, db_session_destroyed: 0, recovery_required: 0, outcome_unknown: 0, ambiguous_commit: 0, provider_redispatch: 0 };

test("an ordinary first provider dispatch emits no failure, recovery or redispatch signal", async () => {
  const r = await runtime();
  try {
    assert.equal(fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one"))).status, "completed");
    assert.equal(r.provider.dispatches.length, 1);
    assert.deepEqual(r.collector.snapshot(), zero);
  } finally {
    await r.database.close();
  }
});

test("HD-12 → Owner recovery → later paid retry: each signal counts its own factual event exactly once", async () => {
  const r = await runtime();
  const interceptor = live.installQueryInterceptor();
  try {
    interceptor.rules.push(live.rule("post-dispatch CAS fails definitively (SQLSTATE 40001)",
      (text) => r.dispatched() && text.includes("/* workflow-runtime:update-run */"),
      (_client, _config, _values, send) => send(
        "do $$ begin raise exception 'live-test serialization failure' using errcode = '40001'; end $$",
      )));
    await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one"));
    interceptor.restore();
    // One rejected statement (40001, ROLLBACK acknowledged → session reusable); one durable
    // execution transition to outcome_unknown (AI-037.1 fail-safe); no redispatch.
    assert.deepEqual(r.collector.snapshot(), { ...zero, db_failure: 1, outcome_unknown: 1 });

    // A fresh blocked decision counts once; its exact replay does not.
    const blocked = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-blocked", "two")));
    assert.equal(blocked.status, "recovery_required");
    const replay = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-blocked", "two")));
    assert.equal(replay.verdict, "idempotent");
    assert.equal(r.collector.snapshot().recovery_required, 1);

    // Owner authorization alone is not a redispatch.
    assert.deepEqual(await r.store.authorizeRetryAfterLostProviderResult({
      runId: fixtures.runId, stepId: fixtures.stepId, executionId: "execution-step-one-one",
      operatorId: "owner-one", acknowledgeLostProviderResultAndDuplicateCostRisk: true,
    }), { status: "authorized", reasons: [] });
    assert.equal(r.collector.snapshot().provider_redispatch, 0);
    assert.equal(r.provider.dispatches.length, 1);

    // The later ordinary advance really reaches provider.run again → exactly one redispatch.
    const retried = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-after-recovery", "three")));
    assert.equal(retried.status, "completed");
    assert.equal(r.provider.dispatches.length, 2);
    assert.deepEqual(r.collector.snapshot(), {
      ...zero, db_failure: 1, outcome_unknown: 1, recovery_required: 1, provider_redispatch: 1,
    });
  } finally {
    interceptor.restore();
    await r.database.close();
  }
});

test("an ambiguous provider outcome counts one outcome_unknown (execution), not one per ledger row", async () => {
  const r = await runtime({ outcome: () => "lost" });
  try {
    const first = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one")));
    assert.equal(first.status, "recovery_required");
    const ledger = await fixtures.ledger(db.admin);
    assert.deepEqual(ledger.invocations.map((row: any) => row.status), ["outcome_unknown"]);
    assert.deepEqual(ledger.budgets.map((row: any) => row.status), ["outcome_unknown"]);
    assert.deepEqual(ledger.executions.map((row: any) => row.status), ["outcome_unknown"]);
    assert.deepEqual(r.collector.snapshot(), { ...zero, outcome_unknown: 1, recovery_required: 1 });
  } finally {
    await r.database.close();
  }
});

test("a lost COMMIT acknowledgement counts one ambiguous_commit, one db_failure and one destroyed session", async () => {
  const r = await runtime();
  const interceptor = live.installQueryInterceptor();
  try {
    const armed = { begun: false };
    interceptor.observe((text) => { if (text.includes("/* workflow-runtime:begin-command */")) armed.begun = true; });
    interceptor.rules.push(live.rule("lose the begin-command COMMIT acknowledgement",
      (text) => armed.begun && /^\s*commit\s*$/iu.test(text),
      async (_client, config, values, send) => {
        await send(config, values);
        throw new Error("Connection terminated unexpectedly");
      }));
    await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one"));
    const snapshot = r.collector.snapshot();
    assert.equal(snapshot.ambiguous_commit, 1);
    assert.equal(snapshot.db_failure, 1);
    assert.equal(snapshot.db_session_destroyed, 1);
    assert.equal(snapshot.provider_redispatch, 0);
  } finally {
    interceptor.restore();
    await r.database.close();
  }
});

test("a throwing sink never changes runtime results, and the snapshot carries only the six names", async () => {
  const hostile = { emit() { throw new Error("postgres://secret@host/db select * from secrets"); } };
  const r = await runtime({ sink: hostile, outcome: () => "lost" });
  try {
    const first = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one")));
    assert.equal(first.status, "recovery_required", "same decision as with a working sink");
    assert.equal(r.provider.dispatches.length, 1);
  } finally {
    await r.database.close();
  }
  const collector = signalsContract.createRuntimeOperationalSignalCollector();
  collector.sink.emit("select * from secrets" as any);
  signalsContract.emitRuntimeOperationalSignal(collector.sink, "postgres://u:p@h/db" as any);
  const snapshot = collector.snapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), [...signalsContract.runtimeOperationalSignalNames].sort());
  assert.ok(Object.values(snapshot).every((value) => Number.isSafeInteger(value) && value === 0));
});

test("a prior execution that passed the provider-start fence but never dispatched is NOT evidence of redispatch", async () => {
  const r = await runtime({ failFirstRunBeforeDispatch: true });
  try {
    const first = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one")));
    assert.equal(first.status, "recovery_required");
    assert.equal(r.provider.dispatches.length, 0, "no remote dispatch happened");
    const afterFirst = await fixtures.ledger(db.admin);
    assert.deepEqual(afterFirst.executions.map((row: any) => row.status), ["outcome_unknown"]);
    assert.deepEqual(afterFirst.invocations.map((row: any) => row.status), ["outcome_unknown"]);
    const fenced = (await db.admin.query(`select started_at is not null as fenced from workflow_runtime_executions
      where execution_id = 'execution-step-one-one'`)).rows[0].fenced;
    assert.equal(fenced, true, "the first execution did pass the provider-start fence");
    // Simulate a later unblock of this attempt (a future HD-6 recovery or a manual repair; no
    // automated path exists today) so the same logical Step attempt can run again.
    await db.admin.query(`update workflow_runtime_executions set status = 'failed'
      where execution_id = 'execution-step-one-one' and status = 'outcome_unknown'`);
    const second = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-two", "two")));
    assert.equal(second.status, "completed");
    assert.equal(r.provider.dispatches.length, 1, "this is the FIRST real provider dispatch");
    assert.equal(r.collector.snapshot().provider_redispatch, 0, "fence passage alone must not count as a prior dispatch");
  } finally {
    await r.database.close();
  }
});

test("a definitive provider failure is a real prior dispatch: the retry that reaches the provider again counts once", async () => {
  let generations = 0;
  const r = await runtime({ outcome: () => (++generations === 1 ? "failed" : "succeeded") });
  const interceptor = live.installQueryInterceptor();
  try {
    interceptor.rules.push(live.rule("post-dispatch CAS fails definitively (SQLSTATE 40001)",
      (text) => r.dispatched() && text.includes("/* workflow-runtime:update-run */"),
      (_client, _config, _values, send) => send(
        "do $$ begin raise exception 'live-test serialization failure' using errcode = '40001'; end $$",
      )));
    await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one"));
    interceptor.restore();
    const afterFirst = await fixtures.ledger(db.admin);
    assert.deepEqual(afterFirst.invocations.map((row: any) => row.status), ["failed"]);
    const retried = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-retry", "two")));
    assert.equal(retried.status, "completed");
    assert.equal(r.provider.dispatches.length, 2);
    assert.equal(r.collector.snapshot().provider_redispatch, 1);
  } finally {
    interceptor.restore();
    await r.database.close();
  }
});

test("known limitation: a dispatch whose outcome was never recorded leaves no proof, so its retry under-counts (never over-counts)", async () => {
  let generations = 0;
  const r = await runtime({ outcome: () => (++generations === 1 ? "lost" : "succeeded") });
  try {
    const first = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one")));
    assert.equal(first.status, "recovery_required");
    assert.deepEqual(await r.store.authorizeRetryAfterLostProviderResult({
      runId: fixtures.runId, stepId: fixtures.stepId, executionId: "execution-step-one-one",
      operatorId: "owner-one", acknowledgeLostProviderResultAndDuplicateCostRisk: true,
    }), { status: "denied", reasons: ["invocation_not_succeeded", "budget_not_settled"] }, "M1 has no retry path here");
    // Simulate a future unblock (HD-6 or a manual repair) of this attempt.
    await db.admin.query(`update workflow_runtime_executions set status = 'failed'
      where execution_id = 'execution-step-one-one' and status = 'outcome_unknown'`);
    const retried = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-after-unblock", "two")));
    assert.equal(retried.status, "completed");
    assert.equal(r.provider.dispatches.length, 2, "the mock did reach the provider twice");
    assert.equal(r.collector.snapshot().provider_redispatch, 0, "no durable proof of the first dispatch exists");
  } finally {
    await r.database.close();
  }
});

test("current side must be factual: a retry whose provider.run throws before dispatch is not a redispatch; the later real one is", async () => {
  const r = await runtime({ failRunBeforeDispatch: (run) => run === 2 });
  const unblock = (executionId: string) => db.admin.query(`update workflow_runtime_executions set status = 'failed'
    where execution_id = $1 and status = 'outcome_unknown'`, [executionId]);
  try {
    // 1. A real dispatch with a recorded outcome: factual PRIOR evidence for this logical attempt.
    const interceptor = live.installQueryInterceptor();
    try {
      interceptor.rules.push(live.rule("post-dispatch CAS fails definitively (SQLSTATE 40001)",
        (text) => r.dispatched() && text.includes("/* workflow-runtime:update-run */"),
        (_client, _config, _values, send) => send(
          "do $$ begin raise exception 'live-test serialization failure' using errcode = '40001'; end $$",
        )));
      await r.service.advance(fixtures.advanceCommand(1, "advance-one", "one"));
    } finally {
      interceptor.restore();
    }
    assert.equal(r.provider.dispatches.length, 1);
    assert.deepEqual((await fixtures.ledger(db.admin)).invocations.map((row: any) => row.status), ["succeeded"]);
    assert.deepEqual(await r.store.authorizeRetryAfterLostProviderResult({
      runId: fixtures.runId, stepId: fixtures.stepId, executionId: "execution-step-one-one",
      operatorId: "owner-one", acknowledgeLostProviderResultAndDuplicateCostRisk: true,
    }), { status: "authorized", reasons: [] });

    // 2. The authorized retry enters provider.run, which throws BEFORE the mock records a dispatch.
    const failed = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-two", "two")));
    assert.equal(failed.status, "recovery_required");
    assert.equal(r.provider.dispatches.length, 1, "no second dispatch happened");
    assert.equal(r.collector.snapshot().provider_redispatch, 0, "entering run is not a dispatch");

    // 3. Unblock again (simulated future repair); the third call really dispatches.
    await unblock("execution-step-one-two");
    const third = fixtures.responseSummary(await r.service.advance(fixtures.advanceCommand(1, "advance-three", "three")));
    assert.equal(third.status, "completed");
    assert.equal(r.provider.dispatches.length, 2);
    assert.equal(r.collector.snapshot().provider_redispatch, 1, "exactly the one factual repeated dispatch");
  } finally {
    await r.database.close();
  }
});
