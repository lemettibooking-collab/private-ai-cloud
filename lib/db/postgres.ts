import { Pool } from "pg";
import type {
  WorkflowRuntimeDatabase,
  WorkflowRuntimeSqlClient,
  WorkflowRuntimeSqlResult,
} from "./workflow-runtime-store";

const defaultPoolMaximum = 5;
const maximumPoolMaximum = 20;

export type PostgresConnectionOptions = Readonly<{
  connectionString?: string;
  maxConnections?: number;
}>;

function connectionString(input: string | undefined): string {
  const value = input ?? process.env.DATABASE_URL;
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    throw new Error("PostgreSQL configuration is unavailable.");
  }
  return value;
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
    connectionString: connectionString(options.connectionString),
    max: poolMaximum(options.maxConnections),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });
  return Object.freeze({
    async connect(): Promise<WorkflowRuntimeSqlClient> {
      try {
        const client = await pool.connect();
        return {
          async query<Row extends Record<string, unknown> = Record<string, unknown>>(
            text: string,
            values: readonly unknown[] = [],
          ): Promise<WorkflowRuntimeSqlResult<Row>> {
            const result = await client.query(text, [...values]);
            return {
              rows: result.rows as Row[],
              rowCount: result.rowCount ?? 0,
            };
          },
          release(): void {
            client.release();
          },
        };
      } catch {
        throw new Error("PostgreSQL connection failed.");
      }
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
