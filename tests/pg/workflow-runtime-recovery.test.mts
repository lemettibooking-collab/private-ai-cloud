/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: AI-037.1.1 / AI-037.1.2 minimal Owner recovery for a lost paid provider result.
//
// AI-037.1 / AI-037.1.2 block automatic retry after a lost post-dispatch result that may have cost
// money (a succeeded result, or a definitive failed result with usage or cost): the execution stays
// outcome_unknown. Owner recovery lets the Owner explicitly abandon that unrecoverable result and
// permit a later, ordinary, paid retry. The recovery itself never calls the provider. AI-037.2
// (durable result storage) is meant to remove the need to pay again in the succeeded case.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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

const db = await live.useLiveDatabase("recovery");
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await live.insertWorkspace(db.admin, live.secondaryWorkspace);

const target = Object.freeze({ runId: fixtures.runId, stepId: fixtures.stepId, executionId: "execution-step-one-one" });
const acknowledged = { acknowledgeLostProviderResultAndDuplicateCostRisk: true as const };
const recoveryScript = fileURLToPath(new URL("../../scripts/workflow-runtime-recovery.mts", import.meta.url));

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

async function persistenceFor(database: any, domain: string, signals?: unknown) {
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({
    database, domainWorkspaceId: domain, providerExecutionTiming: fixtures.providerExecutionTiming(),
    ...(signals === undefined ? {} : { signals }),
  });
  assert.ok(persistence);
  return persistence;
}

// Builds the state left by AI-037.1 after a lost post-dispatch result (or a variant of it) and
// returns a live runtime (store, service, provider) to keep working with. Close `database` after.
async function lostResultState(options: Readonly<{
  outcome?: import("./helpers/runtime-fixtures").MockProviderOutcome;
  failCas?: boolean;
}> = {}) {
  await resetRuntime();
  const collector = signalsContract.createRuntimeOperationalSignalCollector();
  const database = postgres.createWorkflowRuntimePostgresDatabase({
    connectionString: db.url, maxConnections: 4, signals: collector.sink,
  });
  const persistence = await persistenceFor(database, live.primaryWorkspace.domain, collector.sink);
  const store = persistence.stateStore;
  await store.create({ state: fixtures.executableRuntimeState() });
  let dispatched = false;
  const provider = fixtures.localMockProvider({
    beforeRun: () => { dispatched = true; },
    outcome: () => (provider.dispatches.length === 1 ? options.outcome ?? "succeeded" : "succeeded"),
  });
  const service = fixtures.runtimeService(store, provider, collector.sink);
  assert.equal((await service.start(fixtures.startCommand())).status, "running");
  const interceptor = live.installQueryInterceptor();
  try {
    if (options.failCas !== false) {
      interceptor.rules.push(live.rule("post-dispatch CAS fails definitively (SQLSTATE 40001)",
        (text) => dispatched && text.includes("/* workflow-runtime:update-run */"),
        (_client, _config, _values, send) => send(
          "do $$ begin raise exception 'live-test serialization failure' using errcode = '40001'; end $$",
        )));
    }
    await service.advance(fixtures.advanceCommand(1, "advance-one", "one"));
  } finally {
    interceptor.restore();
  }
  return { database, store, service, provider, collector };
}

async function recoveryAuditCount(): Promise<number> {
  return (await db.admin.query(`select count(*)::int as n from audit_events
    where event_type = 'workflow.execution_recovery_authorized'`)).rows[0].n;
}

async function executionStatus(executionId = target.executionId): Promise<string | null> {
  return (await db.admin.query("select status from workflow_runtime_executions where execution_id = $1",
    [executionId])).rows[0]?.status ?? null;
}

function runRecoveryCli(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Minimal environment: only the per-file test database, never the caller's DATABASE_URL.
    const env = { NODE_ENV: "test" as const, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: db.url };
    execFile(process.execPath, [recoveryScript, ...args], { env, timeout: 60_000, encoding: "utf8" },
      (error: Error | null, stdout: string, stderr: string) => {
        resolve({ code: error ? Number((error as any).code ?? 1) : 0, stdout, stderr });
      });
  });
}

const cliTarget = ["--workspace", live.primaryWorkspace.domain, "--run", target.runId, "--step", target.stepId,
  "--execution", target.executionId];

test("Owner recovery: inspect, refuse without acknowledgement, authorize once, idempotent replay, then a normal paid retry", async () => {
  const { database, service, provider } = await lostResultState();
  try {
    // T0: the AI-037.1 fail-safe state.
    assert.equal(await executionStatus(), "outcome_unknown");
    const blocked = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-blocked", "two")));
    assert.equal(blocked.status, "recovery_required");
    assert.equal(provider.dispatches.length, 1);
    const before = await fixtures.ledger(db.admin);
    assert.deepEqual(before.steps, [{ step_key: fixtures.stepId, status: "pending", attempt_count: 0 }]);
    assert.deepEqual(before.runs, [{ runtime_id: fixtures.runId, status: "running", revision: 1 }]);

    // T1: inspect (operator CLI) reports eligibility from sanitized facts and mutates nothing.
    const inspected = await runRecoveryCli(["inspect", ...cliTarget]);
    assert.equal(inspected.code, 0, inspected.stdout);
    const inspection = JSON.parse(inspected.stdout);
    assert.equal(inspection.eligible, true);
    assert.deepEqual(inspection.reasons, []);
    assert.deepEqual(inspection.run, { runId: fixtures.runId, status: "running", revision: 1, paused: false });
    assert.deepEqual(inspection.step, { stepId: fixtures.stepId, status: "pending", attemptCount: 0 });
    assert.deepEqual(inspection.execution, {
      executionId: target.executionId, status: "outcome_unknown", attemptNumber: 1, expectedRevision: 1, claimStatus: "released",
    });
    assert.deepEqual(inspection.invocation, {
      invocationId: "invocation-step-one-one", status: "succeeded", outcome: "succeeded",
      totalTokens: fixtures.mockUsage.totalTokens, costUsdMicros: fixtures.mockUsage.costUsdMicros,
    });
    assert.deepEqual(inspection.budget, {
      status: "settled", actualTotalTokens: fixtures.mockUsage.totalTokens, actualCostUsdMicros: fixtures.mockUsage.costUsdMicros,
    });
    for (const output of [inspected.stdout, inspected.stderr]) {
      assert.equal(output.includes(db.url), false);
      assert.equal(/postgres:\/\/|reservation_token|Output of /u.test(output), false);
    }
    assert.equal(await executionStatus(), "outcome_unknown");

    // T2: without the explicit acknowledgement nothing changes.
    const unacknowledged = await runRecoveryCli(["authorize-retry", ...cliTarget, "--operator", "owner-one"]);
    assert.equal(unacknowledged.code, 2);
    assert.deepEqual(JSON.parse(unacknowledged.stdout), { status: "denied", reasons: ["acknowledgement_required"] });
    assert.equal(await executionStatus(), "outcome_unknown");
    assert.equal(await recoveryAuditCount(), 0);
    assert.equal(provider.dispatches.length, 1);

    // T3: explicit Owner recovery commits the transition and exactly one audit event, and calls nothing.
    const authorized = await runRecoveryCli(["authorize-retry", ...cliTarget, "--operator", "owner-one",
      "--acknowledge-lost-provider-result-and-duplicate-cost-risk"]);
    assert.equal(authorized.code, 0, authorized.stdout);
    assert.deepEqual(JSON.parse(authorized.stdout), { status: "authorized", reasons: [] });
    assert.equal(await executionStatus(), "failed");
    assert.equal(await recoveryAuditCount(), 1);
    assert.equal(provider.dispatches.length, 1, "recovery never calls the provider");
    const afterRecovery = await fixtures.ledger(db.admin);
    assert.deepEqual(afterRecovery.invocations, before.invocations, "the original invocation is not rewritten");
    assert.deepEqual(afterRecovery.budgets, before.budgets, "the settled budget is not reversed");
    assert.deepEqual(afterRecovery.windows, before.windows);
    assert.deepEqual(afterRecovery.steps, before.steps);
    assert.deepEqual(afterRecovery.runs, before.runs);
    assert.equal(afterRecovery.executions.length, before.executions.length, "no execution was created");
    const audit = (await db.admin.query(`select actor_kind, actor_id, runtime_run_id, metadata from audit_events
      where event_type = 'workflow.execution_recovery_authorized'`)).rows[0];
    assert.equal(audit.actor_kind, "owner");
    assert.equal(audit.actor_id, "owner-one");
    assert.equal(audit.runtime_run_id, fixtures.runId);
    assert.deepEqual(audit.metadata, {
      recoveryAction: "authorize_retry_after_lost_provider_result",
      duplicateCostRiskAcknowledged: "yes",
      runId: fixtures.runId,
      stepId: fixtures.stepId,
      executionId: target.executionId,
      attemptNumber: 1,
      expectedRevision: 1,
      previousExecutionStatus: "outcome_unknown",
      newExecutionStatus: "failed",
      invocationId: "invocation-step-one-one",
      invocationStatus: "succeeded",
      invocationOutcome: "succeeded",
      invocationTotalTokens: fixtures.mockUsage.totalTokens,
      invocationCostUsdMicros: fixtures.mockUsage.costUsdMicros,
      budgetStatus: "settled",
    });

    // T4: exact replay is idempotent; a different operator conflicts; neither mutates.
    const replay = await runRecoveryCli(["authorize-retry", ...cliTarget, "--operator", "owner-one",
      "--acknowledge-lost-provider-result-and-duplicate-cost-risk"]);
    assert.equal(replay.code, 0);
    assert.deepEqual(JSON.parse(replay.stdout), { status: "idempotent", reasons: ["already_authorized"] });
    const persistence = await persistenceFor(database, live.primaryWorkspace.domain);
    assert.deepEqual(
      await persistence.stateStore.authorizeRetryAfterLostProviderResult({ ...target, operatorId: "owner-two", ...acknowledged }),
      { status: "conflict", reasons: ["already_authorized_by_another_operator"] },
    );
    assert.equal(await recoveryAuditCount(), 1);
    assert.equal(await executionStatus(), "failed");

    // T5: only the next ordinary advance calls the provider again — explicitly Owner-authorized.
    const retried = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-after-recovery", "three")));
    assert.equal(retried.status, "completed");
    assert.deepEqual(provider.dispatches.map((dispatch) => dispatch.invocationId),
      ["invocation-step-one-one", "invocation-step-one-three"]);
    const final = await fixtures.ledger(db.admin);
    assert.deepEqual(final.budgets.map((row: any) => [row.invocation_id, row.status, row.actual_tokens]), [
      ["invocation-step-one-one", "settled", fixtures.mockUsage.totalTokens],
      ["invocation-step-one-three", "settled", fixtures.mockUsage.totalTokens],
    ]);
    assert.deepEqual(final.invocations.map((row: any) => [row.invocation_id, row.status]), [
      ["invocation-step-one-one", "succeeded"],
      ["invocation-step-one-three", "succeeded"],
    ]);
    assert.deepEqual(final.runs, [{ runtime_id: fixtures.runId, status: "completed", revision: 5 }]);
    assert.equal(await recoveryAuditCount(), 1);
  } finally {
    await database.close();
  }
});

// Every denial must leave the execution status unchanged and write no recovery audit.
async function assertDenied(store: any, input: any, expectedReasons: readonly string[], executionBefore: string | null) {
  const decision = await store.authorizeRetryAfterLostProviderResult(input);
  assert.equal(decision.status, "denied", JSON.stringify(decision));
  for (const reason of expectedReasons) assert.ok(decision.reasons.includes(reason), `${reason} in ${JSON.stringify(decision)}`);
  assert.equal(await executionStatus(), executionBefore);
  assert.equal(await recoveryAuditCount(), 0);
}

test("Owner recovery is denied outside the narrow lost-paid-result states and never mutates", async () => {
  // Acknowledgement missing (API): false / absent are both refused before any database access.
  {
    const { database, store } = await lostResultState();
    try {
      await assertDenied(store, { ...target, operatorId: "owner-one", acknowledgeLostProviderResultAndDuplicateCostRisk: false },
        ["acknowledgement_required"], "outcome_unknown");
      await assertDenied(store, { ...target, operatorId: "owner-one" }, ["acknowledgement_required"], "outcome_unknown");
      await assertDenied(store, { ...target, operatorId: "owner-one", force: true }, ["acknowledgement_required"], "outcome_unknown");
      // Wrong identities, and a store bound to another workspace.
      await assertDenied(store, { ...target, runId: "run-missing", operatorId: "owner-one", ...acknowledged },
        ["run_not_found"], "outcome_unknown");
      await assertDenied(store, { ...target, stepId: "step-missing", operatorId: "owner-one", ...acknowledged },
        ["step_not_found", "execution_not_found"], "outcome_unknown");
      await assertDenied(store, { ...target, executionId: "execution-missing", operatorId: "owner-one", ...acknowledged },
        ["execution_not_found"], "outcome_unknown");
      const otherTenant = await persistenceFor(database, live.secondaryWorkspace.domain);
      await assertDenied(otherTenant.stateStore, { ...target, operatorId: "owner-one", ...acknowledged },
        ["run_not_found"], "outcome_unknown");
      // Invocation running (dispatched, outcome not recorded).
      await db.admin.query(`update workflow_model_invocations set status = 'running', completed_at = null, outcome = null,
        finish_reason = null, input_tokens = null, output_tokens = null, total_tokens = null, latency_ms = null,
        cost_usd_micros = null, error_code = null where invocation_id = 'invocation-step-one-one'`);
      await assertDenied(store, { ...target, operatorId: "owner-one", ...acknowledged }, ["invocation_result_not_recorded"], "outcome_unknown");
      // Invocation missing.
      await db.admin.query("delete from workflow_model_budget_reservations");
      await db.admin.query("delete from workflow_model_invocations");
      await assertDenied(store, { ...target, operatorId: "owner-one", ...acknowledged }, ["invocation_missing"], "outcome_unknown");
    } finally {
      await database.close();
    }
  }
  // Revision changed, Step no longer pending, Run terminal.
  for (const [mutation, reason] of [
    ["update workflow_runs set revision = revision + 1 where runtime_id = 'run-one'", "revision_changed"],
    ["update workflow_step_runs set status = 'success' where step_key = 'step-one'", "step_not_pending"],
    ["update workflow_runs set status = 'cancelled' where runtime_id = 'run-one'", "run_not_running"],
  ] as const) {
    const { database, store } = await lostResultState();
    try {
      await db.admin.query(mutation);
      await assertDenied(store, { ...target, operatorId: "owner-one", ...acknowledged }, [reason], "outcome_unknown");
    } finally {
      await database.close();
    }
  }
  // Invocation outcome_unknown (ambiguous provider outcome).
  {
    const { database, store } = await lostResultState({ outcome: "lost", failCas: false });
    try {
      await assertDenied(store, { ...target, operatorId: "owner-one", ...acknowledged },
        ["invocation_result_not_recorded", "budget_not_settled"], "outcome_unknown");
    } finally {
      await database.close();
    }
  }
  // Definitive FREE provider failure (0 tokens, 0 cost): execution already an ordinary retryable
  // `failed`, and the free invocation itself is never a recoverable paid result.
  {
    const { database, store } = await lostResultState({ outcome: "failed" });
    try {
      await assertDenied(store, { ...target, operatorId: "owner-one", ...acknowledged },
        ["execution_not_outcome_unknown", "invocation_failure_not_billable"], "failed");
    } finally {
      await database.close();
    }
  }
  // Normal completion: execution `completed`, Step no longer pending.
  {
    const { database, store } = await lostResultState({ failCas: false });
    try {
      await assertDenied(store, { ...target, operatorId: "owner-one", ...acknowledged },
        ["execution_not_outcome_unknown", "step_not_pending"], "completed");
    } finally {
      await database.close();
    }
  }
});

test("AI-037.1.2 Owner recovery: a lost PAID definitive failure is recoverable only with the explicit acknowledgement", async () => {
  const { database, store, service, provider, collector } = await lostResultState({ outcome: "failed_paid" });
  try {
    // The AI-037.1.2 fail-safe state: paid failed outcome recorded and settled, execution unresolved.
    assert.equal(await executionStatus(), "outcome_unknown");
    const blocked = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-blocked", "two")));
    assert.equal(blocked.status, "recovery_required");
    assert.equal(provider.dispatches.length, 1);
    const before = await fixtures.ledger(db.admin);
    assert.deepEqual(before.invocations.map((row: any) => [row.status, row.total_tokens, row.cost]),
      [["failed", fixtures.mockUsage.totalTokens, fixtures.mockUsage.costUsdMicros]]);
    assert.deepEqual(before.budgets.map((row: any) => [row.status, row.actual_tokens, row.actual_cost]),
      [["settled", fixtures.mockUsage.totalTokens, fixtures.mockUsage.costUsdMicros]]);

    // Inspect (operator CLI): eligible, and the failed paid outcome is visible.
    const inspected = await runRecoveryCli(["inspect", ...cliTarget]);
    assert.equal(inspected.code, 0, inspected.stdout);
    const inspection = JSON.parse(inspected.stdout);
    assert.equal(inspection.eligible, true, inspected.stdout);
    assert.deepEqual(inspection.invocation, {
      invocationId: "invocation-step-one-one", status: "failed", outcome: "failed",
      totalTokens: fixtures.mockUsage.totalTokens, costUsdMicros: fixtures.mockUsage.costUsdMicros,
    });
    assert.equal(await executionStatus(), "outcome_unknown");

    // Without the acknowledgement: denied, nothing changes, nothing is called.
    await assertDenied(store, { ...target, operatorId: "owner-one" }, ["acknowledgement_required"], "outcome_unknown");
    const unacknowledged = await runRecoveryCli(["authorize-retry", ...cliTarget, "--operator", "owner-one"]);
    assert.equal(unacknowledged.code, 2);
    assert.deepEqual(JSON.parse(unacknowledged.stdout), { status: "denied", reasons: ["acknowledgement_required"] });
    assert.equal(await executionStatus(), "outcome_unknown");
    assert.equal(provider.dispatches.length, 1);

    // With the acknowledgement: the transition and exactly one audit event; no provider call.
    const authorized = await runRecoveryCli(["authorize-retry", ...cliTarget, "--operator", "owner-one",
      "--acknowledge-lost-provider-result-and-duplicate-cost-risk"]);
    assert.equal(authorized.code, 0, authorized.stdout);
    assert.deepEqual(JSON.parse(authorized.stdout), { status: "authorized", reasons: [] });
    assert.equal(await executionStatus(), "failed");
    assert.equal(await recoveryAuditCount(), 1);
    assert.equal(provider.dispatches.length, 1, "recovery never calls the provider");
    const afterRecovery = await fixtures.ledger(db.admin);
    assert.deepEqual(afterRecovery.invocations, before.invocations, "the paid failed invocation is not rewritten");
    assert.deepEqual(afterRecovery.budgets, before.budgets, "the settled budget is not reversed");
    assert.deepEqual(afterRecovery.windows, before.windows);
    assert.deepEqual(afterRecovery.steps, before.steps);
    assert.deepEqual(afterRecovery.runs, before.runs);
    const audit = (await db.admin.query(`select actor_kind, actor_id, metadata from audit_events
      where event_type = 'workflow.execution_recovery_authorized'`)).rows[0];
    assert.equal(audit.actor_kind, "owner");
    assert.equal(audit.actor_id, "owner-one");
    assert.equal(audit.metadata.duplicateCostRiskAcknowledged, "yes");
    assert.equal(audit.metadata.invocationStatus, "failed");
    assert.equal(audit.metadata.invocationOutcome, "failed");
    assert.equal(audit.metadata.invocationTotalTokens, fixtures.mockUsage.totalTokens);
    assert.equal(audit.metadata.invocationCostUsdMicros, fixtures.mockUsage.costUsdMicros);
    assert.equal(audit.metadata.budgetStatus, "settled");
    assert.equal(/Output of |filtered|content_filter|postgres:\/\//u.test(JSON.stringify(audit.metadata)), false,
      "no provider output, error text or connection string");

    // Exact replay is idempotent; a different Owner conflicts; neither mutates.
    assert.deepEqual(await store.authorizeRetryAfterLostProviderResult({ ...target, operatorId: "owner-one", ...acknowledged }),
      { status: "idempotent", reasons: ["already_authorized"] });
    assert.deepEqual(await store.authorizeRetryAfterLostProviderResult({ ...target, operatorId: "owner-two", ...acknowledged }),
      { status: "conflict", reasons: ["already_authorized_by_another_operator"] });
    assert.equal(await recoveryAuditCount(), 1);
    assert.equal(collector.snapshot().provider_redispatch, 0, "authorization alone is not a dispatch");

    // Only the next ordinary advance may call the provider again, once, now Owner-authorized.
    const retried = fixtures.responseSummary(await service.advance(fixtures.advanceCommand(1, "advance-after-recovery", "three")));
    assert.equal(retried.status, "completed");
    assert.deepEqual(provider.dispatches.map((dispatch) => dispatch.invocationId),
      ["invocation-step-one-one", "invocation-step-one-three"]);
    assert.equal(collector.snapshot().provider_redispatch, 1, "PRIOR recorded paid outcome and CURRENT recorded outcome");
    const final = await fixtures.ledger(db.admin);
    assert.deepEqual(final.invocations.map((row: any) => [row.invocation_id, row.status]), [
      ["invocation-step-one-one", "failed"],
      ["invocation-step-one-three", "succeeded"],
    ]);
    assert.deepEqual(final.runs, [{ runtime_id: fixtures.runId, status: "completed", revision: 5 }]);
    assert.equal(await recoveryAuditCount(), 1);
  } finally {
    await database.close();
  }
});
