// AI-038.3: the Owner Console's only data entry point (server-only, read-only).
//
//   React Server Component → load*() → per-request PostgreSQL pool
//     → createRequestOwnerReadRuntime (real Auth.js auth() of THIS request → AI-038.1 → AI-038.0)
//
// The workspace is the trusted server configuration APP_DEMO_WORKSPACE_SLUG, never request data.
// `connection()` defers all work to request time, so nothing is read during prerendering, and
// every call re-authorizes (membership/role revocation applies on the next request).
import "server-only";
import { connection } from "next/server";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { createRequestOwnerReadRuntime } from "./github-owner-read-runtime.server";
import { createOwnerConsoleReader } from "./owner-console-read";

export type {
  OwnerConsoleApproval,
  OwnerConsoleAttentionSummary,
  OwnerConsoleAuditItem,
  OwnerConsoleOverview,
  OwnerConsoleProject,
  OwnerConsoleRunDetail,
  OwnerConsoleRunStatus,
  OwnerConsoleRunSummary,
  OwnerConsoleRunView,
  OwnerConsoleUsage,
} from "./owner-console-read";

const reader = createOwnerConsoleReader({
  workspaceSlug: process.env.APP_DEMO_WORKSPACE_SLUG,
  async withRuntime(domainWorkspaceId, read) {
    const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
    try {
      return await read(await createRequestOwnerReadRuntime({ database, domainWorkspaceId }));
    } finally {
      await database.close().catch(() => undefined);
    }
  },
});

// `connection()` is awaited OUTSIDE the reader's error handling: during prerendering it signals
// Next.js to render at request time, and that signal must never be swallowed as "unavailable".
export async function loadOwnerAttentionSummary() {
  await connection();
  return reader.loadOwnerAttentionSummary();
}

export async function loadOwnerConsoleOverview() {
  await connection();
  return reader.loadOwnerConsoleOverview();
}

export async function loadOwnerRun(runId: string) {
  await connection();
  return reader.loadOwnerRun(runId);
}
