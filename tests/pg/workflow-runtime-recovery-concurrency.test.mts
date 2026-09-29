/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: AI-037.1.1 Owner recovery never waits on live writer row locks.
//
// Recovery first runs a read-only preflight (plain MVCC reads, never waits on row locks) and
// denies clearly ineligible state without any locking transaction. Only potentially eligible
// state enters the locking transaction, where every row lock is taken NOWAIT: a lock held by a
// live writer yields `denied` (`recovery_lock_unavailable`) immediately. A transaction that never
// waits for a lock cannot be part of a deadlock cycle, so recovery always loses and live writers
// always commit.
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
const persistenceContract = (await import(
  new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-persistence");

const db = await live.useLiveDatabase("recoveryrace");
await live.insertWorkspace(db.admin, live.primaryWorkspace);

const monitor = live.installReuseMonitor();
const uncaught = live.collectUncaught();
after(() => { monitor.restore(); uncaught.stop(); });

const target = Object.freeze({ runId: fixtures.runId, stepId: fixtures.stepId, executionId: "execution-step-one-one" });
const authorization = { ...target, operatorId: "owner-one", acknowledgeLostProviderResultAndDuplicateCostRisk: true as const };
const recoveryDeadlineMs = 1_500;

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

async function deadlockCount(): Promise<number> {
  await db.admin.query("select pg_stat_clear_snapshot()");
  return Number((await db.admin.query("select deadlocks from pg_stat_database where datname = current_database()"))
    .rows[0].deadlocks);
}

// Deadlocks are counted by the aborted backend; poll so a late stats flush is not missed.
async function assertNoNewDeadlocks(before: number): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const now = await deadlockCount();
    assert.equal(now, before, "no 40P01 deadlock may occur");
    await live.sleep(100);
  }
}

async function recoveryAuditCount(): Promise<number> {
  return (await db.admin.query(`select count(*)::int as n from audit_events
    where event_type = 'workflow.execution_recovery_authorized'`)).rows[0].n;
}

async function executionStatus(): Promise<string | null> {
  return (await db.admin.query("select status from workflow_runtime_executions where execution_id = $1",
    [target.executionId])).rows[0]?.status ?? null;
}

// Runtime with a store proxy that captures the outcome input, so a real writer can replay it.
async function runtime(outcome: import("./helpers/runtime-fixtures").MockProviderOutcome = "succeeded") {
  await resetRuntime();
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 6 });
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({
    database, domainWorkspaceId: live.primaryWorkspace.domain, providerExecutionTiming: fixtures.providerExecutionTiming(),
  });
  assert.ok(persistence);
  const store = persistence.stateStore;
  await store.create({ state: fixtures.executableRuntimeState() });
  const captured: { outcome: any } = { outcome: null };
  const capturing = new Proxy(store as any, {
    get(real, key) {
      const value = real[key];
      if (key === "recordModelInvocationOutcome") {
        return async (input: any) => { captured.outcome = input; return value.call(real, input); };
      }
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
  let dispatched = false;
  const provider = fixtures.localMockProvider({ beforeRun: () => { dispatched = true; }, outcome: () => outcome });
  const service = fixtures.runtimeService(capturing, provider);
  assert.equal((await service.start(fixtures.startCommand())).status, "running");
  return { database, store, service, provider, captured, dispatched: () => dispatched };
}

// The HD-12 state (settled success, lost post-dispatch CAS → execution outcome_unknown), or with
// `failed_paid` the AI-037.1.2 state (settled billable definitive failure, lost CAS).
async function lostResultState(outcome: import("./helpers/runtime-fixtures").MockProviderOutcome = "succeeded") {
  const context = await runtime(outcome);
  const interceptor = live.installQueryInterceptor();
  try {
    interceptor.rules.push(live.rule("post-dispatch CAS fails definitively (SQLSTATE 40001)",
      (text) => context.dispatched() && text.includes("/* workflow-runtime:update-run */"),
      (_client, _config, _values, send) => send(
        "do $$ begin raise exception 'live-test serialization failure' using errcode = '40001'; end $$",
      )));
    await context.service.advance(fixtures.advanceCommand(1, "advance-one", "one"));
  } finally {
    interceptor.restore();
  }
  assert.equal(await executionStatus(), "outcome_unknown");
  return context;
}

// Pauses a live writer right after `tag` executed (its row locks are held) until released.
function pauseWriterAfter(interceptor: ReturnType<typeof live.installQueryInterceptor>, tag: string) {
  let reach!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  interceptor.rules.push(live.rule(`pause live writer after ${tag}`, live.sqlTag(tag), async (_client, config, values, send) => {
    const result = await send(config, values);
    reach();
    await released;
    return result;
  }));
  return { reached, release };
}

// Records every recovery statement so the locks it requested can be counted.
function recoveryStatements(interceptor: ReturnType<typeof live.installQueryInterceptor>) {
  const statements: string[] = [];
  interceptor.observe((text) => {
    if (/\/\* workflow-runtime:recovery-/u.test(text)) statements.push(text.replace(/\s+/gu, " "));
  });
  return {
    statements,
    locking: () => statements.filter((text) => / for (update|share)/u.test(text)),
  };
}

// Recovery must answer while the writer is still paused; waiting on a writer's lock would hang.
async function recoverWithinDeadline(store: any) {
  const started = Date.now();
  const outcome = await Promise.race([
    store.authorizeRetryAfterLostProviderResult(authorization).then((decision: any) => ({ decision })),
    live.sleep(recoveryDeadlineMs).then(() => ({ decision: null })),
  ]);
  return { ...outcome, ms: Date.now() - started };
}

test("ineligible: recovery beside an in-flight releaseClaim is denied by the read-only preflight and takes no locks", async (t) => {
  const { database, store } = await runtime();
  const interceptor = live.installQueryInterceptor();
  const deadlocksBefore = await deadlockCount();
  try {
    const claim = await store.claim({
      runId: fixtures.runId, stepId: fixtures.stepId, attemptNumber: 1, expectedRevision: 1,
      executionId: target.executionId, requestFingerprint: "a".repeat(64),
    });
    assert.equal(claim.status, "acquired");
    const recorded = recoveryStatements(interceptor);
    const writerPause = pauseWriterAfter(interceptor, "workflow-runtime:release-execution");
    const writer = store.releaseClaim({ runId: fixtures.runId, claimId: claim.claimId as string })
      .then(() => "committed", (error: Error) => `failed:${error.message}`);
    await writerPause.reached; // releaseClaim holds claim → execution row locks

    const recovery = await recoverWithinDeadline(store);
    writerPause.release();
    t.diagnostic(`recovery=${JSON.stringify(recovery.decision)} in ${recovery.ms} ms while the writer held its lock`);
    assert.ok(recovery.decision, `recovery must not wait on the writer (${recovery.ms} ms)`);
    assert.equal(recovery.decision.status, "denied");
    assert.ok(recovery.decision.reasons.includes("claim_active"), JSON.stringify(recovery.decision));
    assert.deepEqual(recorded.locking(), [], "recovery requested no row locks");
    assert.equal(await writer, "committed");
    assert.equal(await executionStatus(), "failed", "releaseClaim retired the prepared execution");
    assert.equal(await recoveryAuditCount(), 0);
    await assertNoNewDeadlocks(deadlocksBefore);
    t.diagnostic(`deadlocks before=${deadlocksBefore} after=${await deadlockCount()}`);
  } finally {
    interceptor.restore();
    await database.close();
  }
});

test("ineligible: recovery beside in-flight outcome recording is denied without a locking transaction; the outcome commits once (RED on the pre-corrective code: 40P01)", async (t) => {
  const { database, store, service, provider } = await runtime();
  const interceptor = live.installQueryInterceptor();
  const deadlocksBefore = await deadlockCount();
  try {
    const recorded = recoveryStatements(interceptor);
    // The outcome transaction locks the invocation, then the budget, then inserts its audit
    // event (FK KEY SHARE on the Run): the reverse of recovery's Run-first order.
    const writerPause = pauseWriterAfter(interceptor, "workflow-runtime:lock-model-invocation");
    const advance = service.advance(fixtures.advanceCommand(1, "advance-one", "one"))
      .then(fixtures.responseSummary, (error: Error) => ({ status: `threw:${error.message}` }));
    await writerPause.reached;
    assert.equal(provider.dispatches.length, 1);

    const recovery = await recoverWithinDeadline(store);
    writerPause.release();
    t.diagnostic(`recovery=${JSON.stringify(recovery.decision)} in ${recovery.ms} ms while the writer held its lock`);
    const settled = await advance;
    assert.ok(recovery.decision, `recovery must not wait on the writer (${recovery.ms} ms)`);
    assert.equal(recovery.decision.status, "denied");
    assert.ok(recovery.decision.reasons.includes("invocation_result_not_recorded"), JSON.stringify(recovery.decision));
    assert.deepEqual(recorded.locking(), [], "recovery requested no row locks");
    assert.equal(settled.status, "completed", "the live writer committed");
    const ledger = await fixtures.ledger(db.admin);
    assert.deepEqual(ledger.invocations.map((row: any) => [row.invocation_id, row.status]),
      [["invocation-step-one-one", "succeeded"]]);
    assert.deepEqual(ledger.budgets.map((row: any) => [row.status, row.actual_tokens]),
      [["settled", fixtures.mockUsage.totalTokens]], "settled exactly once");
    assert.equal(await recoveryAuditCount(), 0);
    await assertNoNewDeadlocks(deadlocksBefore);
    t.diagnostic(`deadlocks before=${deadlocksBefore} after=${await deadlockCount()}`);
  } finally {
    interceptor.restore();
    await database.close();
  }
});

for (const [name, tag, writer, outcome] of [
  ["claim", "workflow-runtime:release-read",
    (context: any) => context.store.releaseClaim({ runId: fixtures.runId, claimId: context.claimId }), "succeeded"],
  ["invocation", "workflow-runtime:lock-model-invocation",
    (context: any) => context.store.recordModelInvocationOutcome(context.captured.outcome), "succeeded"],
  // AI-037.1.2: the new eligible state (billable definitive failure) uses the same NOWAIT locking.
  ["invocation (paid failed result)", "workflow-runtime:lock-model-invocation",
    (context: any) => context.store.recordModelInvocationOutcome(context.captured.outcome), "failed_paid"],
] as const) {
  test(`potentially eligible: a live writer holding the ${name} row lock makes recovery fail fast with 55P03 (denied, retryable); the writer commits`, async (t) => {
    const context: any = await lostResultState(outcome);
    context.claimId = (await db.admin.query(`select claim.id::text as id from workflow_runtime_claims as claim
      where claim.execution_id = $1`, [target.executionId])).rows[0].id;
    assert.ok(context.captured.outcome, "outcome input captured for the replay writer");
    const interceptor = live.installQueryInterceptor();
    const deadlocksBefore = await deadlockCount();
    try {
      const preflight = await context.store.inspectExecutionRecovery(target);
      assert.equal(preflight.eligible, true, "preflight sees an eligible lost-paid-result state");
      const recorded = recoveryStatements(interceptor);
      const writerPause = pauseWriterAfter(interceptor, tag);
      const writerResult = Promise.resolve(writer(context))
        .then((value: any) => `committed:${value?.status ?? "void"}`, (error: Error) => `failed:${error.message}`);
      await writerPause.reached;

      const recovery = await recoverWithinDeadline(context.store);
      writerPause.release();
      t.diagnostic(`recovery=${JSON.stringify(recovery.decision)} in ${recovery.ms} ms while the writer held its lock`);
      assert.ok(recovery.decision, `recovery must not wait on the writer (${recovery.ms} ms)`);
      assert.deepEqual(recovery.decision, { status: "denied", reasons: ["recovery_lock_unavailable"] });
      assert.ok(recorded.locking().every((text) => / nowait/u.test(text)), "every recovery lock is NOWAIT");
      assert.ok((await writerResult).startsWith("committed"), "the live writer committed");
      assert.equal(await executionStatus(), "outcome_unknown", "recovery changed nothing");
      assert.equal(await recoveryAuditCount(), 0, "no recovery audit");
      assert.equal(context.provider.dispatches.length, 1);
      await assertNoNewDeadlocks(deadlocksBefore);
      t.diagnostic(`deadlocks before=${deadlocksBefore} after=${await deadlockCount()} writer=${await writerResult}`);

      // Retryable: once the writer is gone the same request succeeds exactly as before.
      assert.deepEqual(await context.store.authorizeRetryAfterLostProviderResult(authorization), { status: "authorized", reasons: [] });
      assert.deepEqual(await context.store.authorizeRetryAfterLostProviderResult(authorization),
        { status: "idempotent", reasons: ["already_authorized"] });
      assert.equal(await recoveryAuditCount(), 1);
      assert.equal(await executionStatus(), "failed");
    } finally {
      interceptor.restore();
      await context.database.close();
    }
  });
}

test("recovery beside live writers left no non-idle pooled session and no uncaught exception", () => {
  assert.deepEqual(monitor.stats.violations, []);
  assert.ok(monitor.stats.reused > 0);
  assert.deepEqual(uncaught.errors, []);
});
