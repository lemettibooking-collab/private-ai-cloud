/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: pooled-session safety (AI-036.7 invariants O / O6 / O-CRASH).
// Derived from the AI-036 re-gate #2 harnesses (o-case.mts, d-errors.mts); maxConnections 1 makes
// session reuse deterministic.
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

const db = await live.useLiveDatabase("session");
await live.insertWorkspace(db.admin, live.primaryWorkspace);
const monitor = live.installReuseMonitor();
const uncaught = live.collectUncaught();

after(() => {
  monitor.restore();
  uncaught.stop();
});

async function singleSessionPersistence() {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 });
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({
    database,
    domainWorkspaceId: live.primaryWorkspace.domain,
  });
  assert.ok(persistence);
  return { database, store: persistence.stateStore };
}

async function resetRuns() {
  await db.admin.query("delete from audit_events where runtime_run_id is not null");
  await db.admin.query("delete from workflow_runs where runtime_id is not null");
}

test("sessions carry the adapter-owned server backstops and reject client query_timeout", async () => {
  const { database } = await singleSessionPersistence();
  try {
    const session = await live.probeSession(database);
    assert.equal(session.idleInTransactionTimeout, "30s");
    assert.equal(session.connectionCheckInterval, "5s");
    assert.equal(session.inheritedTransaction, false);
  } finally {
    await database.close();
  }
  assert.throws(
    () => postgres.createWorkflowRuntimePostgresDatabase({ connectionString: `${db.url}?query_timeout=400` }),
    { message: "PostgreSQL configuration is invalid." },
  );
});

test("A1: server error inside a transaction plus successful ROLLBACK reuses the same clean session", async () => {
  await resetRuns();
  const { database, store } = await singleSessionPersistence();
  try {
    await store.create({ state: fixtures.executableRuntimeState() });
    const before = await live.probeSession(database);
    // Real SQLSTATE 23505 on the Run INSERT aborts the transaction; the ROLLBACK is acknowledged.
    await assert.rejects(store.create({ state: fixtures.executableRuntimeState() }), {
      message: "Workflow runtime database operation failed.",
    });
    const next = await live.probeSession(database);
    assert.equal(next.pid, before.pid, "session reused after acknowledged ROLLBACK");
    assert.equal(next.inheritedTransaction, false);
    assert.equal(next.isolation, "read committed");
    assert.equal(next.readOnly, "off");
    assert.deepEqual(await live.runCounts(db.admin, fixtures.runId), { runs: 1, steps: 1, audit: 1 });
  } finally {
    await database.close();
  }
});

test("A2: failed statement plus failed ROLLBACK destroys the session; no partial write becomes durable", async () => {
  await resetRuns();
  const interceptor = live.installQueryInterceptor();
  const { database, store } = await singleSessionPersistence();
  try {
    const before = await live.probeSession(database);
    // Server-shaped errors, never sent: the Run INSERT stays open server-side and only the
    // caller's destroy rule can discard it.
    interceptor.rules.push(live.rule("audit insert fails", live.sqlTag("workflow-runtime:audit-event"),
      async () => { throw live.serverError("XX000"); }));
    interceptor.rules.push(live.rule("rollback fails", live.exactSql("rollback"),
      async () => { throw live.serverError("XX000"); }));
    await assert.rejects(store.create({ state: fixtures.executableRuntimeState() }), (error: any) => {
      assert.equal(error.message, "Workflow runtime database operation failed.");
      assert.equal(String(error.message).includes("injected"), false);
      return true;
    });
    assert.deepEqual(interceptor.rules.map((candidate) => candidate.fired), [1, 1]);
    assert.equal(await live.waitForBackendExit(db.admin, before.pid, 5_000), true, "old backend terminated");
    const next = await live.probeSession(database);
    assert.notEqual(next.pid, before.pid);
    assert.equal(next.inheritedTransaction, false);
    // The next borrower commits on a fresh session: a poisoned session would re-insert run-one
    // inside the inherited transaction and fail with 23505.
    interceptor.restore();
    await store.create({ state: fixtures.executableRuntimeState() });
    assert.deepEqual(await live.runCounts(db.admin, fixtures.runId), { runs: 1, steps: 1, audit: 1 });
  } finally {
    interceptor.restore();
    await database.close();
  }
});

test("A3: backend terminated while checked out idle in transaction does not crash the process", async () => {
  await resetRuns();
  const interceptor = live.installQueryInterceptor();
  const { database, store } = await singleSessionPersistence();
  try {
    const before = await live.probeSession(database);
    let stateAtTermination: string | null = null;
    interceptor.rules.push(live.rule("terminate idle-in-transaction backend", live.sqlTag("workflow-runtime:create-step"),
      async (client, config, values, send) => {
        stateAtTermination = (await db.admin.query("select state from pg_stat_activity where pid = $1",
          [client.processID])).rows[0]?.state ?? null;
        await db.admin.query("select pg_terminate_backend($1)", [client.processID]);
        await live.waitForBackendExit(db.admin, client.processID, 5_000);
        await live.sleep(50);
        return send(config, values);
      }));
    await assert.rejects(store.create({ state: fixtures.executableRuntimeState() }), {
      message: "Workflow runtime database operation failed.",
    });
    assert.equal(stateAtTermination, "idle in transaction");
    const next = await live.probeSession(database);
    assert.notEqual(next.pid, before.pid);
    assert.equal(next.inheritedTransaction, false);
    assert.deepEqual(await live.runCounts(db.admin, fixtures.runId), { runs: 0, steps: 0, audit: 0 });
    assert.deepEqual(uncaught.errors, []);
  } finally {
    interceptor.restore();
    await database.close();
  }
});

// AI-037.4a: the release guard discards a session whose final ReadyForQuery status is not idle,
// even when the caller (wrongly) asks for normal release.
async function rawCheckoutScenario(statements: readonly string[], expectDiscard: boolean) {
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 1 });
  try {
    const before = await live.probeSession(database);
    const client = await database.connect();
    for (const statement of statements) await client.query(statement).catch(() => {});
    client.release(); // no destroy flag: only the guard can refuse reuse
    const next = await live.probeSession(database);
    const oldGone = expectDiscard
      ? await live.waitForBackendExit(db.admin, before.pid, 5_000)
      : !await live.backendAlive(db.admin, before.pid);
    return { before, next, oldGone };
  } finally {
    await database.close();
  }
}

test("A5 (AI-037.4a): BEGIN + release without COMMIT/ROLLBACK (status T) discards the session", async () => {
  const r = await rawCheckoutScenario(["begin", "select 1"], true);
  assert.notEqual(r.next.pid, r.before.pid, "next borrower received a new backend");
  assert.equal(r.oldGone, true, "old backend was discarded");
  assert.equal(r.next.inheritedTransaction, false);
});

test("A6 (AI-037.4a): failed statement inside a transaction without ROLLBACK (status E) discards the session", async () => {
  const r = await rawCheckoutScenario(["begin", "select 1/0"], true);
  assert.notEqual(r.next.pid, r.before.pid);
  assert.equal(r.oldGone, true);
  assert.equal(r.next.inheritedTransaction, false);
});

test("A7 (AI-037.4a): failed statement + successful ROLLBACK (status I) reuses the same clean session", async () => {
  const r = await rawCheckoutScenario(["begin", "select 1/0", "rollback"], false);
  assert.equal(r.next.pid, r.before.pid, "same backend reused");
  assert.equal(r.oldGone, false);
  assert.equal(r.next.inheritedTransaction, false);
  assert.equal(r.next.isolation, "read committed");
});

test("A8 (AI-037.4a): non-fatal ERROR outside a transaction (status I) keeps the session reusable", async () => {
  const r = await rawCheckoutScenario(["select 1/0"], false);
  assert.equal(r.next.pid, r.before.pid);
  assert.equal(r.oldGone, false);
  assert.equal(r.next.inheritedTransaction, false);
});

test("A4: every pooled session returned for reuse was idle (transaction status I)", () => {
  assert.deepEqual(monitor.stats.violations, []);
  assert.ok(monitor.stats.reused > 0, "reuse path exercised");
  assert.ok(monitor.stats.destroyed >= 2, "destroy path exercised");
  assert.deepEqual(uncaught.errors, []);
});
