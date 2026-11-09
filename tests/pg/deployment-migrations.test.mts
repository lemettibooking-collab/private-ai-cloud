import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test, { type TestContext } from "node:test";
import type { WorkflowRuntimeDatabase } from "../../lib/db/workflow-runtime-store";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const m = await import(new URL("../../lib/deployment/migrations.ts", import.meta.url).href) as typeof import("../../lib/deployment/migrations");
const pg = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const health = await import(new URL("../../lib/deployment/health.ts", import.meta.url).href) as typeof import("../../lib/deployment/health");
const inventory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

async function fixture(t: TestContext) {
  // Uses the existing opt-in/loopback guard, but deliberately creates an EMPTY database.
  const maintenance = live.adminClient(live.databaseUrl("postgres")); await maintenance.connect();
  const name = `aipc_pgtest_migration_${process.pid}_${randomBytes(5).toString("hex")}`;
  await maintenance.query(`create database "${name}"`);
  const url = live.databaseUrl(name), admin = live.adminClient(url); await admin.connect();
  const db = pg.createWorkflowRuntimePostgresDatabase({ connectionString: url, maxConnections: 1 });
  t.after(async () => { await db.close(); await admin.end(); await maintenance.query(`drop database "${name}" with (force)`); await maintenance.end(); });
  return { db, admin, url };
}
async function directory(t: TestContext, files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "pac-migrations-pg-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  return dir;
}
const tableCount = async (admin: ReturnType<typeof live.adminClient>, name: string) =>
  (await admin.query("select count(*)::int as n from pg_tables where schemaname='public' and tablename=$1", [name])).rows[0].n;

test("migration PG: full real 0001–0023 applied once, no seed, checksummed replay and readiness", async t => {
  const { db, admin } = await fixture(t);
  assert.deepEqual(await m.applyDeploymentMigrations(db, inventory), { applied: 23, total: 23 });
  const rows = (await admin.query("select name,checksum from pac_schema_migrations order by name")).rows;
  assert.deepEqual(rows, (await m.readDeploymentMigrations(inventory)).map(({ name, checksum }) => ({ name, checksum })));
  assert.equal((await admin.query("select count(*)::int as n from workspaces")).rows[0].n, 0);
  assert.deepEqual(await m.applyDeploymentMigrations(db, inventory), { applied: 0, total: 23 });
  assert.equal(await health.databaseIsReady(db), true);
});
test("migration PG: checksum drift blocks before later SQL, original history retained", async t => {
  const { db, admin } = await fixture(t), dir = await directory(t, { "0001_a.sql": "create table first_table(n int);" });
  await m.applyDeploymentMigrations(db, dir);
  const before = (await admin.query("select * from pac_schema_migrations")).rows;
  await writeFile(join(dir, "0001_a.sql"), "create table first_table(n int); -- drift");
  await writeFile(join(dir, "0002_b.sql"), "create table forbidden_later(n int);");
  await assert.rejects(m.applyDeploymentMigrations(db, dir), /^Error: migration_gate_denied$/u);
  assert.deepEqual((await admin.query("select * from pac_schema_migrations")).rows, before);
  assert.equal(await tableCount(admin, "forbidden_later"), 0);
});
test("migration PG: failure is atomic, later SQL not applied, retry requires corrected trusted file", async t => {
  const { db, admin } = await fixture(t), dir = await directory(t, {
    "0001_a.sql": "begin; create table first_table(n int); commit;",
    "0002_b.sql": "select * from absent_table;",
    "0003_c.sql": "create table forbidden_later(n int);"
  });
  await assert.rejects(m.applyDeploymentMigrations(db, dir), /^Error: migration_gate_denied$/u);
  for (const table of ["first_table", "forbidden_later", "pac_schema_migrations"]) assert.equal(await tableCount(admin, table), 0);
  await writeFile(join(dir, "0002_b.sql"), "insert into first_table values(7);");
  assert.deepEqual(await m.applyDeploymentMigrations(db, dir), { applied: 3, total: 3 });
  assert.equal((await admin.query("select n from first_table")).rows[0].n, 7);
});
test("migration PG: failed append preserves prior committed migration, no history for failure", async t => {
  const { db, admin } = await fixture(t), dir = await directory(t, { "0001_a.sql": "create table first_table(n int);" });
  await m.applyDeploymentMigrations(db, dir);
  await writeFile(join(dir, "0002_b.sql"), "insert into first_table values(9); select * from missing_table;");
  await writeFile(join(dir, "0003_c.sql"), "create table forbidden_later(n int);");
  await assert.rejects(m.applyDeploymentMigrations(db, dir), /migration_gate_denied/u);
  assert.equal((await admin.query("select count(*)::int as n from first_table")).rows[0].n, 0);
  assert.equal((await admin.query("select count(*)::int as n from pac_schema_migrations")).rows[0].n, 1);
  assert.equal(await tableCount(admin, "forbidden_later"), 0);
});
test("migration PG: simultaneous migrators serialize; loser fails closed without applying", async t => {
  const { db, admin, url } = await fixture(t), dir = await directory(t, { "0001_a.sql": "create table first_table(n int);" });
  await m.applyDeploymentMigrations(db, dir);
  await writeFile(join(dir, "0002_b.sql"), "insert into first_table values(1);");
  let locked!: () => void, resume!: () => void;
  const lockReached = new Promise<void>(r => { locked = r; }), released = new Promise<void>(r => { resume = r; });
  // Pause the real PG transaction immediately after its metadata lock is acknowledged.
  const pausing: WorkflowRuntimeDatabase = { async connect() {
    const c = await db.connect(); return { release: d => c.release(d), async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      const result = await c.query<Row>(text, values);
      if (text.startsWith("lock table")) { locked(); await released; }
      return result;
    } };
  } };
  const other = pg.createWorkflowRuntimePostgresDatabase({ connectionString: url, maxConnections: 1 });
  const a = m.applyDeploymentMigrations(pausing, dir);
  try {
    await lockReached;
    await assert.rejects(m.applyDeploymentMigrations(other, dir), /migration_gate_denied/u);
    assert.equal((await admin.query("select count(*)::int as n from first_table")).rows[0].n, 0);
  } finally { resume(); await a; await other.close(); }
  assert.equal((await admin.query("select count(*)::int as n from first_table")).rows[0].n, 1);
  assert.deepEqual(await m.applyDeploymentMigrations(db, dir), { applied: 0, total: 2 });
});
test("migration PG: concurrent fresh bootstrap cannot apply any migration twice", async t => {
  const { db, admin, url } = await fixture(t), dir = await directory(t, { "0001_a.sql": "create table first_table(n int); insert into first_table values(1);" });
  const other = pg.createWorkflowRuntimePostgresDatabase({ connectionString: url, maxConnections: 1 });
  try {
    const results = await Promise.allSettled([m.applyDeploymentMigrations(db, dir), m.applyDeploymentMigrations(other, dir)]);
    assert.ok(results.some(r => r.status === "fulfilled" && r.value.applied === 1));
    assert.equal(results.filter(r => r.status === "fulfilled" && r.value.applied === 1).length, 1);
    assert.equal((await admin.query("select count(*)::int as n from first_table")).rows[0].n, 1);
  } finally { await other.close(); }
});
test("migration PG: unknown/gapped metadata or existing unmanaged schema is never auto-adopted", async t => {
  const { db, admin } = await fixture(t), dir = await directory(t, { "0001_a.sql": "select 1;", "0002_b.sql": "select 2;" });
  await admin.query("create table foreign_data(n int)");
  await assert.rejects(m.applyDeploymentMigrations(db, dir), /migration_gate_denied/u);
  assert.equal(await tableCount(admin, "pac_schema_migrations"), 0);
  await admin.query("drop table foreign_data"); await m.applyDeploymentMigrations(db, dir);
  await admin.query("delete from pac_schema_migrations where name='0001_a.sql'");
  await assert.rejects(m.applyDeploymentMigrations(db, dir), /migration_gate_denied/u);
});
test("migration PG: CLI runs only explicit apply, returns fixed safe output and replay counts", async t => {
  const { url } = await fixture(t);
  async function run(args: string[]) {
    const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/deployment/migrate.mts", ...args], { env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", error = ""; child.stdout.on("data", b => { out += b; }); child.stderr.on("data", b => { error += b; });
    const code = await new Promise(resolve => child.on("close", resolve)); return { code, out, error };
  }
  assert.deepEqual(await run(["apply"]), { code: 0, out: "migration_gate_ok applied=23 total=23\n", error: "" });
  assert.deepEqual(await run(["apply"]), { code: 0, out: "migration_gate_ok applied=0 total=23\n", error: "" });
  const denied = await run([]); assert.equal(denied.code, 1); assert.equal(denied.out, ""); assert.ok(!denied.error.includes(url));
});
