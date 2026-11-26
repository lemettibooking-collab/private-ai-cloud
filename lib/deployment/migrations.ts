// Node-only operator gate. Never imported by application startup or an HTTP/action surface.
import { createHash } from "node:crypto";
import { constants, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { inTransaction } from "../db/executor-start-transaction.ts";

export type DeploymentMigration = Readonly<{ name: string; checksum: string; sql: string }>;
const fail = () => new Error("migration_gate_denied");
const filePattern = /^[0-9]{4}_[a-z0-9_]+\.sql$/u;
const maxFileBytes = 4 * 1024 * 1024;

/** Split only at SQL statement boundaries, preserving quoted bodies and nested comments.
 * This is a transaction-control guard for trusted repository SQL, not a general SQL sandbox.
 * Escape-string syntax is denied rather than guessed; standard strings require the
 * server's standard_conforming_strings=on (checked inside the gate transaction). */
export function migrationStatements(sql: string): readonly string[] {
  if (!sql.trim() || Buffer.byteLength(sql) > maxFileBytes || sql.includes("\0")) throw fail();
  const statements: string[] = [];
  let current = "", quote = "", dollar = "", comment = 0, line = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (line) { if (c === "\n") { line = false; current += "\n"; } continue; }
    if (comment) {
      if (c === "/" && next === "*") { comment++; i++; }
      else if (c === "*" && next === "/") { comment--; i++; }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) { current += dollar; i += dollar.length - 1; dollar = ""; }
      else current += c;
      continue;
    }
    if (quote) {
      current += c;
      if (c === quote) {
        if (next === quote) { current += next; i++; } else quote = "";
      }
      continue;
    }
    if (c === "-" && next === "-") { line = true; current += " "; i++; continue; }
    if (c === "/" && next === "*") { comment = 1; current += " "; i++; continue; }
    if (c === "'" || c === '"') {
      if (/(?:\b[eE]|[uU]&)$/u.test(current)) throw fail();
      quote = c; current += c; continue;
    }
    if (c === "$") {
      const tag = /^(?:\$\$|\$[a-zA-Z_][a-zA-Z_0-9]*\$)/u.exec(sql.slice(i));
      if (tag) { dollar = tag[0]; current += dollar; i += dollar.length - 1; continue; }
    }
    if (c === ";") { if (current.trim()) statements.push(current.trim()); current = ""; }
    else current += c;
  }
  if (quote || dollar || comment) throw fail();
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export function migrationBody(sql: string): string {
  const statements = [...migrationStatements(sql)];
  if (/^begin$/iu.test(statements[0] ?? "")) {
    if (!/^commit$/iu.test(statements.at(-1) ?? "")) throw fail();
    statements.shift(); statements.pop();
  }
  // No statement may end the gate transaction or alter connection/session settings.
  if (!statements.length || statements.some(s => /^(begin|commit|end|abort|rollback|savepoint|release|start|prepare|set|reset|discard|vacuum)\b/iu.test(s))) throw fail();
  return statements.join(";\n") + ";";
}

export async function readDeploymentMigrations(directory: string): Promise<readonly DeploymentMigration[]> {
  const names = (await readdir(directory)).filter(name => name !== ".gitkeep").sort();
  if (!names.length || names.length > 128 || names.some(n => !filePattern.test(n))) throw fail();
  const migrations: DeploymentMigration[] = [];
  let total = 0;
  for (const [index, name] of names.entries()) {
    if (!name.startsWith(String(index + 1).padStart(4, "0") + "_")) throw fail();
    const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > maxFileBytes || (total += stat.size) > 16 * 1024 * 1024) throw fail();
      const bytes = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== stat.size) throw fail();
      const data = bytes.subarray(0, bytesRead);
      const sql = data.toString("utf8");
      if (!Buffer.from(sql).equals(data)) throw fail();
      migrationBody(sql); // Capture/check all SQL before acquiring a connection or a lock.
      migrations.push(Object.freeze({ name, checksum: createHash("sha256").update(data).digest("hex"), sql }));
    } finally { await file.close(); }
  }
  return Object.freeze(migrations);
}

export async function applyDeploymentMigrations(database: WorkflowRuntimeDatabase, directory: string): Promise<Readonly<{ applied: number; total: number }>> {
  try {
    const migrations = await readDeploymentMigrations(directory);
    return await inTransaction(database, async client => {
      const settings = await client.query("select current_setting('server_version_num')::int as version, current_setting('standard_conforming_strings') as strings");
      if (Number(settings.rows[0]?.version) < 160000 || Number(settings.rows[0]?.version) >= 170000 || settings.rows[0]?.strings !== "on") throw fail();
      // CREATE is transactional; simultaneous first bootstrap may fail with a catalog conflict.
      // Such a loser stops safely. Established metadata uses NOWAIT: no waiting takeover/retry.
      await client.query(`create table if not exists public.pac_schema_migrations (
        name text primary key check (name ~ '^[0-9]{4}_[a-z0-9_]+[.]sql$'),
        checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz not null default clock_timestamp()
      )`);
      await client.query("lock table public.pac_schema_migrations in access exclusive mode nowait");
      const history = await client.query<{ name: string; checksum: string }>("select name, checksum from public.pac_schema_migrations order by name");
      if (history.rows.length > migrations.length || history.rows.some((row, index) => row.name !== migrations[index].name || row.checksum !== migrations[index].checksum)) throw fail();
      // Never auto-adopt a database initialized outside this gate (including an old deployment).
      if (!history.rows.length) {
        const existing = await client.query("select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S','f') and c.relname<>'pac_schema_migrations' limit 1");
        if (existing.rowCount) throw fail();
      }
      for (const migration of migrations.slice(history.rows.length)) {
        await client.query(migrationBody(migration.sql));
        await client.query("insert into public.pac_schema_migrations(name,checksum) values($1,$2)", [migration.name, migration.checksum]);
      }
      return Object.freeze({ applied: migrations.length - history.rows.length, total: migrations.length });
    });
  } catch { throw fail(); } // No SQL, driver error, URL or caller data crosses the operator boundary.
}
