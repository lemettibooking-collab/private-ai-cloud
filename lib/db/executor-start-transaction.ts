import { types } from "node:util";
import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isWorkflowRuntimeSessionBreakingError } from "./postgres.ts";

// Executor-internal trusted configuration capture. No task-write contract dependency.
export function exactOwnData(input: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of fields) {
      const d = Object.getOwnPropertyDescriptor(input, key);
      if (!d || !("value" in d) || !d.enumerable) return null;
      result[key] = d.value;
    }
    return result;
  } catch { return null; }
}
export function capturedMethod(input: unknown, name: string): ((...args: unknown[]) => unknown) | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  try {
    const d = Object.getOwnPropertyDescriptor(input, name);
    return d && "value" in d && typeof d.value === "function" && !types.isProxy(d.value) ? d.value : null;
  } catch { return null; }
}

/** One connection, no retry. Never reuse a session after uncertain BEGIN/COMMIT/ROLLBACK. */
export async function inTransaction<T>(database: WorkflowRuntimeDatabase, work: (client: WorkflowRuntimeSqlClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  let safe = false;
  try {
    await client.query("/* executor-transaction:begin */ begin");
    let result: T;
    try { result = await work(client); }
    catch (error) {
      try { await client.query("/* executor-transaction:rollback */ rollback"); safe = !isWorkflowRuntimeSessionBreakingError(error); }
      catch { safe = false; }
      throw error;
    }
    await client.query("/* executor-transaction:commit */ commit");
    safe = true;
    return result;
  } finally { client.release(!safe); }
}
