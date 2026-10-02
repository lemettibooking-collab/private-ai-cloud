// AI-038.3 / AI-038.3.2: the Owner Console's only data entry point (server-only, read-only).
//
//   React Server Component → load*() → per-request PostgreSQL pool
//     → createRequestOwnerReadRuntime (real Auth.js auth() of THIS request → AI-038.1 → AI-038.0)
//
// The workspace is the trusted server configuration APP_DEMO_WORKSPACE_SLUG, never request data.
// The raw `?project=` value is passed through untouched and parsed HERE: it can only select a
// project returned by the authenticated registry read. `connection()` defers all work to request
// time, so nothing is read during prerendering, and every call re-authorizes (membership/role
// revocation applies on the next request).
import "server-only";
import { connection } from "next/server";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { parseProjectSelector } from "../projects/project-context";
import { createRequestOwnerReadRuntime } from "./github-owner-read-runtime.server";
import { createOwnerConsoleReader } from "./owner-console-read";

export type {
  OwnerConsoleApproval,
  OwnerConsoleApprovals,
  OwnerConsoleAuditItem,
  OwnerConsoleDashboard,
  OwnerConsoleProject,
  OwnerConsoleProjectActivity,
  OwnerConsoleProjectApprovals,
  OwnerConsoleProjectRun,
  OwnerConsoleProjects,
  OwnerConsoleRunAggregate,
  OwnerConsoleRunDetail,
  OwnerConsoleRuns,
  OwnerConsoleRunStatus,
  OwnerConsoleRunSummary,
  OwnerConsoleRunView,
  OwnerConsoleScope,
  OwnerConsoleShell,
  OwnerConsoleAttention,
  OwnerConsoleDashboardTasks,
  OwnerConsoleTask,
  OwnerConsoleTaskDetail,
  OwnerConsoleTaskResult,
  OwnerConsoleTasks,
  OwnerConsoleTaskStatus,
  OwnerConsoleTaskView,
  OwnerConsoleUsage,
  OwnerConsoleWorkspace,
} from "./owner-console-read";

// Raw `searchParams.project` exactly as Next.js delivers it.
type RawProjectSelector = string | string[] | undefined;

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
export async function loadOwnerShell() {
  await connection();
  return reader.loadOwnerShell();
}

export async function loadOwnerProjects() {
  await connection();
  return reader.loadOwnerProjects();
}

export async function loadOwnerDashboard(project: RawProjectSelector) {
  await connection();
  return reader.loadOwnerDashboard(parseProjectSelector(project));
}

export async function loadOwnerRuns(project: RawProjectSelector) {
  await connection();
  return reader.loadOwnerRuns(parseProjectSelector(project));
}

export async function loadOwnerApprovals(project: RawProjectSelector) {
  await connection();
  return reader.loadOwnerApprovals(parseProjectSelector(project));
}

export async function loadOwnerTasks(project: RawProjectSelector) {
  await connection();
  return reader.loadOwnerTasks(parseProjectSelector(project));
}

export async function loadOwnerTask(taskId: string, project: RawProjectSelector) {
  await connection();
  return reader.loadOwnerTask(taskId, parseProjectSelector(project));
}

export async function loadOwnerAttention(project: RawProjectSelector) {
  await connection();
  return reader.loadOwnerAttention(parseProjectSelector(project));
}

export async function loadOwnerRun(runId: string, project: RawProjectSelector) {
  await connection();
  return reader.loadOwnerRun(runId, parseProjectSelector(project));
}
