import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowRuntimeDatabase } from "../lib/db/workflow-runtime-store";
const m = await import(new URL("../lib/deployment/migrations.ts", import.meta.url).href) as typeof import("../lib/deployment/migrations");

test("migration gate sorts contiguous files, captures immutable full-file checksums", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pac-migrations-unit-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "0002_second.sql"), "begin; select 2; commit;");
  await writeFile(join(dir, "0001_first.sql"), "select 1;");
  const a = await m.readDeploymentMigrations(dir), b = await m.readDeploymentMigrations(dir);
  assert.deepEqual(a, b); assert.ok(Object.isFrozen(a) && a.every(Object.isFrozen));
  assert.deepEqual(a.map(s => s.name), ["0001_first.sql", "0002_second.sql"]);
  assert.notEqual(a[0].checksum, a[1].checksum);
});
test("migration lexer preserves SQL dollar bodies, escaped quotes, regex and nested comments", () => {
  assert.equal(m.migrationBody("-- before\nbegin; do $body$ begin perform ';commit;'; end $body$; /* x /*nested*/ y */ select 'it''s;ok', '\\.'; commit;--after"), "do $body$ begin perform ';commit;'; end $body$;\nselect 'it''s;ok', '\\.';");
});
test("migration lexer rejects unmatched or internal transaction/session control", () => {
  for (const sql of ["", "begin; select 1;", "select 1;commit;select 2;", "begin;begin;select 1;commit;", "do $$unterminated", "select 'unterminated", "/*unclosed", "set search_path=evil;select 1;", "select E'escape\\'; commit;", "select U&'foo';", "begin;rollback;commit;"]) assert.throws(() => m.migrationBody(sql), /migration_gate_denied/u, sql);
});
test("migration loader rejects gaps, unknown files, symlinks, oversized SQL before DB connection", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pac-migrations-invalid-")); t.after(() => rm(dir, { recursive: true, force: true }));
  let connects = 0;
  const db = { connect: async () => { connects++; throw new Error("secret URL"); } };
  for (const [name, sql] of [["0002_gap.sql", "select 1;"], ["unexpected.txt", "select 1;"], ["0001_big.sql", " ".repeat(4 * 1024 * 1024 + 1)]]) {
    await writeFile(join(dir, name), sql); await assert.rejects(m.applyDeploymentMigrations(db, dir), /^Error: migration_gate_denied$/u); await rm(join(dir, name));
  }
  const target = join(dir, "target"); await writeFile(target, "select 1;"); await symlink(target, join(dir, "0001_link.sql"));
  await assert.rejects(m.applyDeploymentMigrations(db, dir), /migration_gate_denied/u); assert.equal(connects, 0);
});
test("real migration inventory parses, is contiguous and never loads seeds", async () => {
  const files = await m.readDeploymentMigrations(fileURLToPath(new URL("../db/migrations/", import.meta.url)));
  assert.equal(files.length, 22); assert.equal(files.at(-1)?.name, "0022_openai_api_cost_reservations.sql");
});
test("migration failure/unknown ACK is sanitized and destroys the connection, no automatic retry", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pac-migrations-ack-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "0001_first.sql"), "select 7;");
  for (const at of ["begin", "commit", "select 7"]) {
    let destroyed: boolean | undefined, connects = 0; const queries: string[] = [];
    const db = { async connect() { connects++; return { async query(sql: string) {
      queries.push(sql);
      if (sql.includes(at)) throw Error("credential-and-raw-SQL");
      if (sql.includes("server_version_num")) return { rows: [{ version: 160015, strings: "on" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }, release(d: boolean) { destroyed = d; } }; } } as unknown as WorkflowRuntimeDatabase;
    await assert.rejects(m.applyDeploymentMigrations(db, dir), /^Error: migration_gate_denied$/u);
    assert.equal(connects, 1); assert.equal(destroyed, true);
    if (at === "select 7") assert.ok(queries.some(q => q.includes("rollback")));
  }
});
