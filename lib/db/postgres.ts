import { DatabaseError, Pool } from "pg";
import type {
  WorkflowRuntimeDatabase,
  WorkflowRuntimeSqlClient,
  WorkflowRuntimeSqlResult,
} from "./workflow-runtime-store";

const defaultPoolMaximum = 5;
const maximumPoolMaximum = 20;

// Server-side session backstops, sent as startup options for every pooled session.
// - idle_in_transaction_session_timeout: runtime transactions are short statement sequences
//   with no provider or network call inside them, so any session idle inside a transaction for
//   30s is leaked. The server then ends it, releasing its row locks. 30s also equals the minimum
//   claim lease, so leaked locks clear before lease-based recovery needs them.
// - client_connection_check_interval (PostgreSQL 14+): a backend blocked on a lock notices a
//   destroyed client within 5s instead of only after the lock is granted.
const sessionOptions = "-c idle_in_transaction_session_timeout=30000 -c client_connection_check_interval=5000";

// Connection-string parameters owned by this adapter. A client-side query_timeout abandons
// statements that keep running server-side and silently drops queued ROLLBACKs, so it is
// rejected; server-side statement_timeout stays allowed.
const forbiddenConnectionParameters = new Set([
  "query_timeout",
  "options",
  "idle_in_transaction_session_timeout",
  "client_connection_check_interval",
]);

export type PostgresConnectionOptions = Readonly<{
  connectionString?: string;
  maxConnections?: number;
}>;

type PooledClient = {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(destroy?: Error | boolean): void;
  on(event: "error" | "end", listener: (...args: unknown[]) => void): unknown;
  removeListener(event: "error" | "end", listener: (...args: unknown[]) => void): unknown;
};

export function workflowRuntimePostgresConnectionString(input: string | undefined): string {
  const value = input ?? process.env.DATABASE_URL;
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    throw new Error("PostgreSQL configuration is unavailable.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PostgreSQL configuration is invalid.");
  }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || [...url.searchParams.keys()].some((key) => forbiddenConnectionParameters.has(key.toLowerCase()))) {
    throw new Error("PostgreSQL configuration is invalid.");
  }
  return value;
}

// Only a server ErrorResponse proves the session is still usable. Client-side failures
// (timeouts, socket errors carrying string codes such as ECONNRESET, terminated connections)
// and server shutdown or connection-exception classes leave the session state unknown.
export function isWorkflowRuntimeSessionBreakingError(error: unknown): boolean {
  if (!(error instanceof DatabaseError)) return true;
  const code = error.code;
  if (typeof code !== "string" || !/^[0-9A-Z]{5}$/u.test(code)) return true;
  return code.startsWith("57P") || code.startsWith("08");
}

export function wrapWorkflowRuntimePooledClient(client: PooledClient): WorkflowRuntimeSqlClient {
  let broken = false;
  let released = false;
  // Attached before the client is handed out: a checked-out client has no pool listener,
  // and an unhandled 'error' event would terminate the process.
  const markBroken = () => { broken = true; };
  client.on("error", markBroken);
  client.on("end", markBroken);
  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<WorkflowRuntimeSqlResult<Row>> {
      if (broken || released) throw new Error("PostgreSQL query failed.");
      try {
        const result = await client.query(text, [...values]);
        return {
          rows: result.rows as Row[],
          rowCount: result.rowCount ?? 0,
        };
      } catch (error) {
        if (isWorkflowRuntimeSessionBreakingError(error)) broken = true;
        throw error;
      }
    },
    release(destroy?: boolean): void {
      if (released) return;
      released = true;
      if (destroy === true || broken) {
        // The listeners stay attached: teardown can still emit 'error' or 'end'.
        client.release(new Error("PostgreSQL session discarded."));
        return;
      }
      client.removeListener("error", markBroken);
      client.removeListener("end", markBroken);
      client.release();
    },
  };
}

function poolMaximum(input: number | undefined): number {
  if (input === undefined) return defaultPoolMaximum;
  if (!Number.isSafeInteger(input) || input < 1 || input > maximumPoolMaximum) {
    throw new Error("PostgreSQL pool configuration is invalid.");
  }
  return input;
}

export function createWorkflowRuntimePostgresDatabase(
  options: PostgresConnectionOptions = {},
): WorkflowRuntimeDatabase & Readonly<{ close(): Promise<void> }> {
  if (typeof window !== "undefined") {
    throw new Error("PostgreSQL is server-only.");
  }
  const pool = new Pool({
    connectionString: workflowRuntimePostgresConnectionString(options.connectionString),
    max: poolMaximum(options.maxConnections),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
    options: sessionOptions,
  });
  // Idle-client errors are re-emitted on the pool after the client is removed; without a
  // listener they would terminate the process. Nothing is logged: driver messages may carry
  // connection details or SQL text.
  pool.on("error", () => {});
  return Object.freeze({
    async connect(): Promise<WorkflowRuntimeSqlClient> {
      let client: PooledClient;
      try {
        client = await pool.connect() as unknown as PooledClient;
      } catch {
        throw new Error("PostgreSQL connection failed.");
      }
      return wrapWorkflowRuntimePooledClient(client);
    },
    async close(): Promise<void> {
      try {
        await pool.end();
      } catch {
        throw new Error("PostgreSQL pool shutdown failed.");
      }
    },
  });
}
