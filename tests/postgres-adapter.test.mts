import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { DatabaseError } from "pg";

const adapterContract = (await import(
  new URL("../lib/db/postgres.ts", import.meta.url).href
)) as typeof import("../lib/db/postgres");

const {
  createWorkflowRuntimePostgresDatabase,
  isWorkflowRuntimeSessionBreakingError,
  workflowRuntimePostgresConnectionString,
  wrapWorkflowRuntimePooledClient,
} = adapterContract;

const secret = "driver-secret-password";

// Real server ErrorResponses always carry a severity (field S); ordinary errors are "ERROR".
function serverError(code: string): DatabaseError {
  const error = new DatabaseError("server error", 0, "error");
  error.code = code;
  error.severity = "ERROR";
  return error;
}

class FakePooledClient extends EventEmitter {
  readonly releases: unknown[] = [];
  queries = 0;
  outcome: (() => Promise<{ rows: unknown[]; rowCount: number }>) | null = null;
  // The driver's ReadyForQuery transaction status ("I" idle, "T" in transaction, "E" failed tx).
  txStatus: unknown = "I";

  getTransactionStatus() {
    return this.txStatus;
  }

  async query() {
    this.queries += 1;
    return this.outcome ? this.outcome() : { rows: [], rowCount: 0 };
  }

  release(destroy?: unknown) {
    this.releases.push(destroy);
  }
}

function wrap(client: FakePooledClient) {
  return wrapWorkflowRuntimePooledClient(client as never);
}

test("only non-fatal server ErrorResponses keep a session reusable", () => {
  const socket = Object.assign(new Error(`read ECONNRESET ${secret}`), { code: "ECONNRESET" });
  assert.equal(isWorkflowRuntimeSessionBreakingError(serverError("23505")), false);
  assert.equal(isWorkflowRuntimeSessionBreakingError(serverError("57014")), false);
  assert.equal(isWorkflowRuntimeSessionBreakingError(serverError("40001")), false);
  assert.equal(isWorkflowRuntimeSessionBreakingError(serverError("57P01")), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError(serverError("08006")), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError(serverError("ECONNRESET")), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError(socket), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError(new Error("Query read timeout")), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError({ code: "23505" }), true);
});

test("a server SQL error keeps the checkout reusable; a socket error breaks and destroys it", async () => {
  const healthy = new FakePooledClient();
  healthy.outcome = async () => { throw serverError("23505"); };
  const reusable = wrap(healthy);
  await assert.rejects(reusable.query("select 1"));
  reusable.release();
  assert.deepEqual(healthy.releases, [undefined]);

  const socket = new FakePooledClient();
  socket.outcome = async () => { throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }); };
  const broken = wrap(socket);
  await assert.rejects(broken.query("select 1"));
  await assert.rejects(broken.query("select 2"), /^Error: PostgreSQL query failed\.$/u);
  assert.equal(socket.queries, 1);
  broken.release();
  assert.equal(socket.releases.length, 1);
  assert.ok(socket.releases[0] instanceof Error);

  for (const failure of [serverError("57P01"), new Error("Query read timeout")]) {
    const client = new FakePooledClient();
    client.outcome = async () => { throw failure; };
    const checkout = wrap(client);
    await assert.rejects(checkout.query("select 1"));
    checkout.release(false);
    assert.ok(client.releases[0] instanceof Error);
  }
});

test("an error event on a checked-out client never escapes and forces destroy", async () => {
  const client = new FakePooledClient();
  const checkout = wrap(client);
  assert.doesNotThrow(() => client.emit("error", new Error(`terminating connection ${secret}`)));
  await assert.rejects(checkout.query("select 1"), /^Error: PostgreSQL query failed\.$/u);
  assert.equal(client.queries, 0);
  checkout.release();
  assert.ok(client.releases[0] instanceof Error);
  assert.equal(String(client.releases[0]).includes(secret), false);
  assert.doesNotThrow(() => client.emit("error", new Error("teardown error after destroy")));
  assert.doesNotThrow(() => client.emit("end"));

  const ended = new FakePooledClient();
  const endedCheckout = wrap(ended);
  ended.emit("end");
  endedCheckout.release();
  assert.ok(ended.releases[0] instanceof Error);
});

test("explicit destroy is honoured and release is idempotent", () => {
  const client = new FakePooledClient();
  const checkout = wrap(client);
  checkout.release(true);
  checkout.release();
  checkout.release(false);
  assert.equal(client.releases.length, 1);
  assert.ok(client.releases[0] instanceof Error);
  assert.doesNotThrow(() => client.emit("error", new Error("late teardown")));
});

test("reuse cycles do not accumulate error listeners", async () => {
  const client = new FakePooledClient();
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const checkout = wrap(client);
    await checkout.query("select 1");
    checkout.release();
  }
  assert.equal(client.listenerCount("error"), 0);
  assert.equal(client.listenerCount("end"), 0);
  assert.deepEqual(new Set(client.releases), new Set([undefined]));
});

test("client-side query_timeout and adapter-owned session parameters are rejected without echo", () => {
  const base = `postgres://owner:${secret}@db.internal:5432/runtime`;
  for (const url of [
    `${base}?query_timeout=400`,
    `${base}?QUERY_TIMEOUT=400`,
    `${base}?sslmode=disable&Query_Timeout=400&application_name=x`,
    `${base}?application_name=x&query_timeout=400`,
    `${base}?options=-c%20statement_timeout%3D1000`,
    `${base}?idle_in_transaction_session_timeout=0`,
    `${base}?Client_Connection_Check_Interval=0`,
    `mysql://owner:${secret}@db.internal/runtime`,
    `not a url ${secret}`,
  ]) {
    const error = (() => { try { workflowRuntimePostgresConnectionString(url); return null; } catch (caught) { return caught as Error; } })();
    assert.equal(error?.message, "PostgreSQL configuration is invalid.", url);
    assert.equal(String(error).includes(secret), false);
    assert.throws(() => createWorkflowRuntimePostgresDatabase({ connectionString: url }), /^Error: PostgreSQL configuration is invalid\.$/u);
  }
  assert.equal(workflowRuntimePostgresConnectionString(`${base}?statement_timeout=5000&sslmode=disable`),
    `${base}?statement_timeout=5000&sslmode=disable`);
  assert.equal(workflowRuntimePostgresConnectionString(`postgresql://owner@localhost/runtime`), "postgresql://owner@localhost/runtime");
});

test("adapter source attaches pool and checkout error listeners and never logs driver errors", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../lib/db/postgres.ts", import.meta.url), "utf8");
  assert.equal(source.includes(`pool.on("error"`), true);
  assert.equal(source.includes(`client.on("error"`), true);
  assert.equal(/console\.|process\.stderr|process\.stdout/u.test(source), false);
  assert.equal(source.includes("idle_in_transaction_session_timeout=30000"), true);
});

// ---------------------------------------------------------------------------------------------
// AI-037.4a: pool release guard + minimum operational signals.
// ---------------------------------------------------------------------------------------------

const signalsContract = (await import(
  new URL("../lib/contracts/runtime-operational-signals.ts", import.meta.url).href
)) as typeof import("../lib/contracts/runtime-operational-signals");

function severityError(code: string, severity: string): DatabaseError {
  const error = serverError(code);
  error.severity = severity;
  return error;
}

// Released for reuse ⇔ the pool got `release()` with no error argument.
const reused = (client: FakePooledClient) => client.releases.length === 1 && client.releases[0] === undefined;
const destroyed = (client: FakePooledClient) => client.releases.length === 1 && client.releases[0] instanceof Error;

async function checkoutAfter(outcome: (() => Promise<{ rows: unknown[]; rowCount: number }>) | null, txStatus: unknown) {
  const client = new FakePooledClient();
  client.outcome = outcome;
  const checkout = wrap(client);
  await checkout.query("select 1").catch(() => {});
  client.txStatus = txStatus;
  checkout.release();
  return client;
}

test("AI-037.4a A–E: severity and SQLSTATE classification", () => {
  // A. ordinary ERROR stays non-breaking (reuse still requires a factual idle status)
  assert.equal(isWorkflowRuntimeSessionBreakingError(severityError("23505", "ERROR")), false);
  // B/C. FATAL and PANIC break the session whatever the SQLSTATE says
  assert.equal(isWorkflowRuntimeSessionBreakingError(severityError("23505", "FATAL")), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError(severityError("40001", "FATAL")), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError(severityError("XX000", "PANIC")), true);
  // D/E. connection-exception and operator-intervention classes
  assert.equal(isWorkflowRuntimeSessionBreakingError(severityError("08006", "ERROR")), true);
  assert.equal(isWorkflowRuntimeSessionBreakingError(severityError("57P01", "ERROR")), true);
});

test("AI-037.4a A–E: release decisions follow the classification and the final status", async () => {
  assert.equal(reused(await checkoutAfter(async () => { throw severityError("23505", "ERROR"); }, "I")), true, "A");
  assert.equal(destroyed(await checkoutAfter(async () => { throw severityError("23505", "FATAL"); }, "I")), true, "B");
  assert.equal(destroyed(await checkoutAfter(async () => { throw severityError("XX000", "PANIC"); }, "I")), true, "C");
  assert.equal(destroyed(await checkoutAfter(async () => { throw severityError("08006", "ERROR"); }, "I")), true, "D");
  assert.equal(destroyed(await checkoutAfter(async () => { throw severityError("57P01", "FATAL"); }, "I")), true, "E");
});

test("AI-037.4a F–I: only a factual idle transaction status is reusable", async () => {
  assert.equal(destroyed(await checkoutAfter(null, "T")), true, "F: in transaction");
  assert.equal(destroyed(await checkoutAfter(null, "E")), true, "G: failed transaction");
  assert.equal(reused(await checkoutAfter(null, "I")), true, "H: idle");
  for (const status of [null, undefined, "", "i", "X", 1, {}]) {
    assert.equal(destroyed(await checkoutAfter(null, status)), true, `I: status ${String(status)}`);
  }
  const missing = new FakePooledClient();
  (missing as unknown as { getTransactionStatus: unknown }).getTransactionStatus = undefined;
  wrap(missing).release();
  assert.equal(destroyed(missing), true, "I: capability missing");
  const throwing = new FakePooledClient();
  throwing.getTransactionStatus = () => { throw new Error(secret); };
  wrap(throwing).release();
  assert.equal(destroyed(throwing), true, "I: capability throws");
});

test("AI-037.4a J: release while a wrapper query is still in flight never reuses the client", async () => {
  const client = new FakePooledClient();
  let finish!: () => void;
  client.outcome = () => new Promise((resolve) => { finish = () => resolve({ rows: [], rowCount: 0 }); });
  const checkout = wrap(client);
  const pending = checkout.query("select pg_sleep(1)");
  checkout.release();
  assert.equal(destroyed(client), true);
  finish();
  await pending;
  assert.equal(client.releases.length, 1);
});

test("AI-037.4a K–M: explicit destroy, idempotent release, error/end events", async () => {
  const explicit = new FakePooledClient();
  const checkout = wrap(explicit);
  checkout.release(true);
  checkout.release();
  checkout.release(true);
  assert.equal(destroyed(explicit), true, "K + L");
  for (const event of ["error", "end"] as const) {
    const client = new FakePooledClient();
    const eventCheckout = wrap(client);
    client.emit(event, new Error(secret));
    eventCheckout.release();
    assert.equal(destroyed(client), true, `M: ${event}`);
  }
});

test("AI-037.4a signals: db_failure once per rejected query, db_session_destroyed once per discarded checkout", async () => {
  const collector = signalsContract.createRuntimeOperationalSignalCollector();
  const client = new FakePooledClient();
  client.outcome = async () => { throw severityError("23505", "ERROR"); };
  const checkout = wrapWorkflowRuntimePooledClient(client as never, collector.sink);
  await assert.rejects(checkout.query("insert"));
  await assert.rejects(checkout.query("insert"));
  client.txStatus = "E";
  checkout.release();
  checkout.release();
  checkout.release(true);
  assert.deepEqual(collector.snapshot(), {
    db_failure: 2, db_session_destroyed: 1, recovery_required: 0, outcome_unknown: 0, ambiguous_commit: 0, provider_redispatch: 0,
  });
  // A broken wrapper fails fast without touching the driver: not a second database failure.
  const broken = new FakePooledClient();
  broken.outcome = async () => { throw Object.assign(new Error(secret), { code: "ECONNRESET" }); };
  const brokenCheckout = wrapWorkflowRuntimePooledClient(broken as never, collector.sink);
  await assert.rejects(brokenCheckout.query("select 1"));
  await assert.rejects(brokenCheckout.query("rollback"), { message: "PostgreSQL query failed." });
  brokenCheckout.release();
  assert.equal(collector.snapshot().db_failure, 3);
  assert.equal(collector.snapshot().db_session_destroyed, 2);
  // A reused checkout is not a destroyed session.
  const healthy = new FakePooledClient();
  const healthyCheckout = wrapWorkflowRuntimePooledClient(healthy as never, collector.sink);
  await healthyCheckout.query("select 1");
  healthyCheckout.release();
  assert.equal(reused(healthy), true);
  assert.equal(collector.snapshot().db_session_destroyed, 2);
});

test("AI-037.4a signals: a throwing sink never changes the release decision or the query outcome", async () => {
  const hostileSink = { emit() { throw new Error(secret); } };
  const client = new FakePooledClient();
  client.outcome = async () => { throw severityError("23505", "ERROR"); };
  const checkout = wrapWorkflowRuntimePooledClient(client as never, hostileSink);
  await assert.rejects(checkout.query("insert"), (error: unknown) => error instanceof DatabaseError);
  client.txStatus = "T";
  assert.doesNotThrow(() => checkout.release());
  assert.equal(destroyed(client), true);
});

test("AI-037.4a corrective: only the exact severity ERROR is non-breaking; localized, unknown or missing severity fails closed", async () => {
  // Localized FATAL / PANIC / even ordinary ERROR (lc_messages = ru), unknown, empty, missing, malformed.
  const unsafe: unknown[] = ["ВАЖНО", "ПАНИКА", "ОШИБКА", "fatal", "error", "LOG", "WARNING", "", undefined, null, 1, {}];
  for (const severity of unsafe) {
    const error = serverError("23505");
    (error as { severity?: unknown }).severity = severity;
    assert.equal(isWorkflowRuntimeSessionBreakingError(error), true, `severity ${String(severity)}`);
    assert.equal(destroyed(await checkoutAfter(async () => { throw error; }, "I")), true, `release after severity ${String(severity)}`);
  }
  // Exact ERROR keeps the SQLSTATE + final-status rules.
  assert.equal(isWorkflowRuntimeSessionBreakingError(severityError("23505", "ERROR")), false);
  assert.equal(reused(await checkoutAfter(async () => { throw severityError("23505", "ERROR"); }, "I")), true);
  assert.equal(destroyed(await checkoutAfter(async () => { throw severityError("23505", "ERROR"); }, "E")), true);
  // The classification never reads the message.
  const secretMessage = severityError("23505", "ERROR");
  secretMessage.message = "FATAL: terminating connection postgres://user:secret@host/db";
  assert.equal(isWorkflowRuntimeSessionBreakingError(secretMessage), false);
});
