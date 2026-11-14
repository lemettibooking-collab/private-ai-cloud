import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import test from "node:test";
import type { WorkflowRuntimeDatabase } from "../lib/db/workflow-runtime-store";
const h = await import(new URL("../lib/deployment/health.ts", import.meta.url).href) as typeof import("../lib/deployment/health");

test("health: HEAD / only, discard body, 200 is alive but unavailable/redirect is not", async t => {
  let status = 200;
  const server = createServer((req, res) => { assert.equal(req.method, "HEAD"); assert.equal(req.url, "/"); res.writeHead(status); res.end("private data"); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); t.after(() => new Promise<void>(r => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;
  assert.equal(await h.appIsAlive(port), true);
  status = 500; assert.equal(await h.appIsAlive(port), false);
  status = 302; assert.equal(await h.appIsAlive(port), false);
});
test("health: hanging local app is bounded and denied", async t => {
  const server = createServer(() => {});
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const start = Date.now(); assert.equal(await h.appIsAlive((server.address() as AddressInfo).port), false); assert.ok(Date.now() - start < 5000);
});
test("readiness distinguishes PostgreSQL reachability and destroys failed sessions without raw error", async () => {
  for (const ok of [true, false]) {
    let destroy: boolean | undefined;
    const db = { async connect() { return { async query(sql: string) { assert.equal(sql, "select 1 as ready"); if (!ok) throw Error("secret database URL"); return { rows: [{ ready: 1 }], rowCount: 1 }; }, release(d: boolean) { destroy = d; } }; } } as unknown as WorkflowRuntimeDatabase;
    assert.equal(await h.databaseIsReady(db), ok); assert.equal(destroy, !ok);
  }
  assert.equal(await h.databaseIsReady({ connect: async () => { throw Error("secret"); } }), false);
});
test("health CLI rejects unknown mode with fixed public output, no env echo or exception text", () => {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/deployment/health.mts", "unknown"], { encoding: "utf8" });
  assert.equal(r.status, 1); assert.equal(r.stdout, "unavailable\n"); assert.equal(r.stderr, "");
});
