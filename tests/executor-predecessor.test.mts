import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
const barrier = await import(new URL("../lib/db/executor-predecessor-barrier.ts", import.meta.url).href) as typeof import("../lib/db/executor-predecessor-barrier");
type Row = Record<string, unknown>;
const row = (state = "start_committed"): Row => ({ attempt_number: 1, state, started: true, settled: false, terminal_result_fingerprint: null, terminal_matches: false, audit_matches: true });
function client(rows: unknown, count: unknown = Array.isArray(rows) ? rows.length : 0) {
  const calls: Array<{ sql: string; values: unknown }> = [];
  return { calls, port: { async query(sql: string, values: unknown) { calls.push({ sql, values }); return { rows, rowCount: count }; }, release() {} } as unknown as import("../lib/db/workflow-runtime-store").WorkflowRuntimeSqlClient };
}
test("attempt 1 skips predecessor query; malformed attempt cannot query", async () => {
  const f = client([]); assert.equal(await barrier.executorPredecessorsClear(f.port, "workspace", "run", 1), true); assert.equal(f.calls.length, 0);
  for (const n of [0, 4, NaN, 1.5]) await assert.rejects(barrier.executorPredecessorsClear(f.port, "workspace", "run", n));
  assert.equal(f.calls.length, 0);
});
test("bounded same-run query uses only factual workspace/Run/attempt, no provider/TTL/usage conditions", async () => {
  const f = client([row()]); assert.equal(await barrier.executorPredecessorsClear(f.port, "workspace", "run", 2), false);
  assert.deepEqual(f.calls[0].values, ["workspace", "run", 2]);
  assert.match(f.calls[0].sql, /e\.workspace_id=\$1 and e\.development_run_id=\$2 and e\.attempt_number < \$3/u);
  assert.match(f.calls[0].sql, /limit 3/u); assert.doesNotMatch(f.calls[0].sql, /provider_id|account_id|model_id|expires_at|usage|tokens/iu);
});
for (const state of ["start_committed", "reconciliation_required"]) test(`started ${state} blocks deterministically without mutation`, async () => {
  const rows = [row(state)], before = structuredClone(rows), f = client(rows);
  for (let n = 0; n < 2; n++) assert.equal(await barrier.executorPredecessorsClear(f.port, "workspace", "run", 2), false);
  assert.deepEqual(rows, before);
});
for (const state of ["reserved", "prepared", "cancelled", "settled"]) test(`safe state ${state} clears only with matching evidence`, async () => {
  const p = row(state); p.started = state === "settled"; p.settled = state === "settled"; p.terminal_matches = state === "settled";
  p.terminal_result_fingerprint = state === "settled" ? "a".repeat(64) : null;
  assert.equal(await barrier.executorPredecessorsClear(client([p]).port, "workspace", "run", 2), true);
});
test("unknown/malformed state/result/audit facts never mean clear", async () => {
  for (const change of [{ state: "unknown" }, { started: false }, { settled: true }, { terminal_matches: true }, { audit_matches: false },
    { attempt_number: 0 }, { attempt_number: 2 }, { terminal_result_fingerprint: "f".repeat(64) }, { started: "true" }])
    await assert.rejects(barrier.executorPredecessorsClear(client([{ ...row(), ...change }]).port, "workspace", "run", 2));
  for (const rows of [[row(), row()], [row(), row(), row()], null, new Proxy([], {})])
    await assert.rejects(barrier.executorPredecessorsClear(client(rows).port, "workspace", "run", 2));
  for (const count of [null, -1, 3, "1"]) await assert.rejects(barrier.executorPredecessorsClear(client([row()], count).port, "workspace", "run", 2));
  await assert.rejects(barrier.executorPredecessorsClear(client([{ ...row("settled"), settled: true }]).port, "workspace", "run", 2));
});
test("hostile predecessor fields do not run getters/proxy traps", async () => {
  let traps = 0;
  const getter = Object.defineProperty({}, "state", { enumerable: true, get() { traps++; throw Error("private"); } });
  const proxy = new Proxy({}, { ownKeys() { traps++; throw Error("private"); } });
  for (const p of [getter, proxy]) await assert.rejects(barrier.executorPredecessorsClear(client([p]).port, "workspace", "run", 2));
  assert.equal(traps, 0);
});
test("one active transaction hook protects all stages after budget lock and before any attempt mutation", () => {
  const source = readFileSync(new URL("../lib/db/executor-start-store.ts", import.meta.url), "utf8");
  assert.match(source, /const held = await locks\(client, initialize\)[\s\S]*?if \(active && !await executorPredecessorsClear[\s\S]*?const row = await read\(client, i\)/u);
  for (const stage of ["reserve", "bindRequest", "commitProviderStart"]) {
    const start = source.indexOf(`async function ${stage}(`), end = source.indexOf("\n  async function ", start + 1);
    assert.match(source.slice(start, end > 0 ? end : undefined), /run\(raw, (?:true|false), true,/u);
  }
  assert.match(source, /!fingerprint\(requestFingerprint\) \? denied\(\) : await run\(raw, false, false,/u);
});
