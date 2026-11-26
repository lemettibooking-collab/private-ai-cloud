/* eslint-disable @typescript-eslint/no-explicit-any -- live PostgreSQL helpers instrument the untyped pg driver boundary */
// Opt-in live PostgreSQL harness for tests/pg. Never used by `npm test`.
//
// Safety contract:
// - runs only with LIVE_PG_TESTS=1 and a dedicated TEST_DATABASE_URL (never DATABASE_URL);
// - the target must be a loopback host or a Unix socket unless LIVE_PG_ALLOW_NONLOCAL=1;
// - the suite never touches existing databases: each test file creates its own uniquely named
//   database (prefix `aipc_pgtest_`), applies db/migrations + db/seeds, and drops only databases it
//   created in this process;
// - connection strings and driver error text are never printed.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after } from "node:test";

const require = createRequire(import.meta.url);
// Same driver instance as lib/db/postgres.ts (pg's ESM entry re-exports its CommonJS classes).
export const pg: any = require("pg");

const repositoryRoot = new URL("../../../", import.meta.url);
const databasePrefix = "aipc_pgtest_";
const createdDatabases = new Set<string>();

function configurationError(message: string): Error {
  return new Error(`Live PostgreSQL suite: ${message}`);
}

function testDatabaseUrl(): URL {
  if (process.env.LIVE_PG_TESTS !== "1") {
    throw configurationError("opt-in required. Set LIVE_PG_TESTS=1 and TEST_DATABASE_URL (see tests/pg/README.md).");
  }
  const raw = process.env.TEST_DATABASE_URL;
  if (typeof raw !== "string" || raw.length === 0) {
    throw configurationError("TEST_DATABASE_URL is required (a throwaway PostgreSQL maintenance database).");
  }
  if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL === raw) {
    throw configurationError("TEST_DATABASE_URL must not equal DATABASE_URL.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw configurationError("TEST_DATABASE_URL is not a valid postgres:// URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw configurationError("TEST_DATABASE_URL must use postgres:// or postgresql://.");
  }
  const socketHost = url.searchParams.get("host");
  const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)
    || (url.hostname === "" && socketHost !== null)
    || (socketHost !== null && socketHost.startsWith("/"));
  if (!loopback && process.env.LIVE_PG_ALLOW_NONLOCAL !== "1") {
    throw configurationError("TEST_DATABASE_URL must point to a loopback host or Unix socket.");
  }
  return url;
}

export function databaseUrl(name: string): string {
  const url = testDatabaseUrl();
  url.pathname = `/${name}`;
  return url.toString();
}

export function adminClient(connectionString: string): any {
  const client = new pg.Client({ connectionString });
  client.__liveAdmin = true;
  client.on("error", () => {});
  return client;
}

async function maintenance<T>(operation: (client: any) => Promise<T>): Promise<T> {
  const client = adminClient(testDatabaseUrl().toString());
  try {
    await client.connect();
  } catch {
    throw configurationError("cannot connect to TEST_DATABASE_URL.");
  }
  try {
    return await operation(client);
  } finally {
    await client.end().catch(() => {});
  }
}

function orderedSqlFiles(directory: string): string[] {
  const files = readdirSync(new URL(directory, repositoryRoot)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file)).sort();
  files.forEach((file, index) => {
    if (!file.startsWith(String(index + 1).padStart(4, "0"))) {
      throw configurationError(`${directory} numbering is not contiguous at ${file}.`);
    }
  });
  return files;
}

export type LiveDatabase = Readonly<{
  name: string;
  url: string;
  serverVersion: string;
  migrations: readonly string[];
  admin: any;
}>;

// Creates a fresh database, applies every migration in order plus the canonical seed, and
// registers teardown (end admin client, DROP only this database) with node:test `after`.
export async function useLiveDatabase(label: string): Promise<LiveDatabase> {
  if (!/^[a-z0-9_]{1,24}$/u.test(label)) throw configurationError("invalid database label.");
  const name = `${databasePrefix}${label}_${process.pid}_${randomBytes(4).toString("hex")}`;
  const serverVersion = await maintenance(async (client) => {
    const version = await client.query(
      "select current_setting('server_version_num')::int as num, current_setting('server_version') as text",
    );
    if (version.rows[0].num < 140000) throw configurationError("PostgreSQL 14 or newer is required.");
    await client.query(`create database "${name}"`);
    createdDatabases.add(name);
    return String(version.rows[0].text);
  });
  const url = databaseUrl(name);
  const admin = adminClient(url);
  after(async () => {
    await admin.end().catch(() => {});
    if (process.env.LIVE_PG_KEEP_DATABASES === "1") return;
    await dropLiveDatabase(name);
  });
  await admin.connect();
  const migrations = orderedSqlFiles("db/migrations/");
  for (const file of migrations) await applySqlFile(admin, `db/migrations/${file}`);
  for (const file of orderedSqlFiles("db/seeds/")) await applySqlFile(admin, `db/seeds/${file}`);
  return Object.freeze({ name, url, serverVersion, migrations: Object.freeze(migrations), admin });
}

async function applySqlFile(client: any, path: string): Promise<void> {
  const sql = readFileSync(new URL(path, repositoryRoot), "utf8");
  try {
    await client.query(sql);
  } catch (error: any) {
    // SQLSTATE only: server messages may echo SQL text.
    throw configurationError(`applying ${path} failed (SQLSTATE ${String(error?.code ?? "unknown")}).`);
  }
}

async function dropLiveDatabase(name: string): Promise<void> {
  if (!createdDatabases.has(name) || !name.startsWith(databasePrefix)) return;
  await maintenance(async (client) => {
    await client.query(`drop database if exists "${name}" with (force)`);
  });
  createdDatabases.delete(name);
}

export const primaryWorkspace = Object.freeze({
  id: "00000000-0000-4000-8000-0000000000a1",
  domain: "workspace-primary",
});
export const secondaryWorkspace = Object.freeze({
  id: "00000000-0000-4000-8000-0000000000b2",
  domain: "tenant-b",
});
export const canonicalWorkspace = Object.freeze({
  id: "00000000-0000-4000-8000-000000000001",
  domain: "smart-algorithms-demo",
});

export async function insertWorkspace(admin: any, workspace: Readonly<{ id: string; domain: string }>): Promise<void> {
  await admin.query(
    `insert into workspaces (id, name, slug, type, region, status, domain_workspace_id)
     values ($1, $2, $2, 'company', 'eu', 'active', $2)`,
    [workspace.id, workspace.domain],
  );
}

// ---------------------------------------------------------------------------------------------
// Driver-boundary instrumentation (test process only; always restored).
// ---------------------------------------------------------------------------------------------

export type QueryRule = {
  name: string;
  match: (text: string, client: any) => boolean;
  act: (client: any, config: any, values: any, send: (config: any, values?: any) => Promise<any>) => Promise<any>;
  fired: number;
};

export type QueryInterceptor = Readonly<{
  rules: QueryRule[];
  observe: (listener: (text: string, client: any) => void) => void;
  restore: () => void;
}>;

// Rules fire once each, in order, on application (non-admin) clients only.
export function installQueryInterceptor(): QueryInterceptor {
  const original = pg.Client.prototype.query;
  const rules: QueryRule[] = [];
  const listeners: Array<(text: string, client: any) => void> = [];
  pg.Client.prototype.query = function intercepted(this: any, config: any, values?: any, callback?: any) {
    if (this.__liveAdmin) return original.call(this, config, values, callback);
    const text: string = typeof config === "string" ? config : config?.text ?? "";
    for (const listener of listeners) listener(text, this);
    const rule = rules.find((candidate) => candidate.fired === 0 && candidate.match(text, this));
    if (rule) {
      rule.fired += 1;
      return rule.act(this, config, values, (nextConfig: any, nextValues?: any) => original.call(this, nextConfig, nextValues));
    }
    return original.call(this, config, values, callback);
  };
  return Object.freeze({
    rules,
    observe: (listener: (text: string, client: any) => void) => { listeners.push(listener); },
    restore: () => { pg.Client.prototype.query = original; },
  });
}

export function rule(name: string, match: QueryRule["match"], act: QueryRule["act"]): QueryRule {
  return { name, match, act, fired: 0 };
}

export const sqlTag = (tag: string) => (text: string) => text.includes(`/* ${tag} */`);
export const exactSql = (statement: string) => (text: string) => text.trim().toLowerCase() === statement;

export function serverError(code: string, severity = "ERROR"): Error {
  const error = new pg.DatabaseError("injected live-test server error", 0, "error");
  error.code = code;
  error.severity = severity;
  return error;
}

export type ReuseMonitor = Readonly<{
  stats: { reused: number; destroyed: number; violations: Array<{ txStatus: unknown; pending: number }> };
  restore: () => void;
}>;

// A client returned to the pool for reuse must be idle per the server's last ReadyForQuery
// ("I") with no active or queued query. Anything else is a pooled-session poisoning violation.
export function installReuseMonitor(): ReuseMonitor {
  const poolPrototype = Object.getPrototypeOf(pg.Pool.prototype);
  const original = poolPrototype._release;
  const stats: ReuseMonitor["stats"] = { reused: 0, destroyed: 0, violations: [] };
  poolPrototype._release = function monitored(this: any, client: any, idleListener: any, error: any) {
    if (error || this.ending || !client._queryable || client._ending) stats.destroyed += 1;
    else {
      stats.reused += 1;
      const pending = (client._queryQueue?.length ?? 0) + (client._activeQuery ? 1 : 0);
      if (client.getTransactionStatus() !== "I" || pending > 0) {
        stats.violations.push({ txStatus: client.getTransactionStatus(), pending });
      }
    }
    return original.call(this, client, idleListener, error);
  };
  return Object.freeze({ stats, restore: () => { poolPrototype._release = original; } });
}

export type SessionProbe = Readonly<{
  pid: number;
  inheritedTransaction: boolean;
  isolation: string;
  readOnly: string;
  idleInTransactionTimeout: string;
  connectionCheckInterval: string;
}>;

// One autocommit statement on a pooled session. `now() <> statement_timestamp()` is true only
// when the session is still inside a transaction started by an earlier borrower.
export async function probeSession(database: any): Promise<SessionProbe> {
  const client = await database.connect();
  try {
    const row = (await client.query(`select pg_backend_pid() as pid,
        (now() <> statement_timestamp()) as inherited,
        current_setting('transaction_isolation') as isolation,
        current_setting('transaction_read_only') as read_only,
        current_setting('idle_in_transaction_session_timeout') as iitst,
        current_setting('client_connection_check_interval') as ccci`)).rows[0];
    return Object.freeze({
      pid: row.pid,
      inheritedTransaction: row.inherited,
      isolation: row.isolation,
      readOnly: row.read_only,
      idleInTransactionTimeout: row.iitst,
      connectionCheckInterval: row.ccci,
    });
  } finally {
    client.release();
  }
}

export async function backendAlive(admin: any, pid: number): Promise<boolean> {
  return (await admin.query("select count(*)::int as n from pg_stat_activity where pid = $1", [pid])).rows[0].n === 1;
}

export async function waitForBackendExit(admin: any, pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await backendAlive(admin, pid)) return true;
    await sleep(50);
  }
  return false;
}

export async function runCounts(admin: any, runtimeId: string): Promise<{ runs: number; steps: number; audit: number }> {
  const count = async (sql: string) => (await admin.query(sql, [runtimeId])).rows[0].n as number;
  return {
    runs: await count("select count(*)::int as n from workflow_runs where runtime_id = $1"),
    steps: await count(`select count(*)::int as n from workflow_step_runs as step
      join workflow_runs as run on run.id = step.run_id where run.runtime_id = $1`),
    audit: await count("select count(*)::int as n from audit_events where runtime_run_id = $1"),
  };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export function collectUncaught(): Readonly<{ errors: string[]; stop: () => void }> {
  const errors: string[] = [];
  const listener = (error: unknown) => { errors.push(error instanceof Error ? error.name : typeof error); };
  process.on("uncaughtExceptionMonitor", listener);
  return Object.freeze({ errors, stop: () => { process.off("uncaughtExceptionMonitor", listener); } });
}
