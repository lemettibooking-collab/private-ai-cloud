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

function serverError(code: string): DatabaseError {
  const error = new DatabaseError("server error", 0, "error");
  error.code = code;
  return error;
}

class FakePooledClient extends EventEmitter {
  readonly releases: unknown[] = [];
  queries = 0;
  outcome: (() => Promise<{ rows: unknown[]; rowCount: number }>) | null = null;

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
