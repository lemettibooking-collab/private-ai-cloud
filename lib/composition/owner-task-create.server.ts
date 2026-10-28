// AI-038.4b: application-facing entry for Owner Quick Create (server-only).
//
//   "use server" action → submitOwnerQuickCreate(FormData) → per-request PostgreSQL pool
//     → createGitHubOwnerTaskCreate (real Auth.js auth() of THIS request) → AI-038.4a createTask
//
// The workspace is the trusted server configuration APP_DEMO_WORKSPACE_SLUG, never request data.
// Only task creation is exposed; attachRun stays unbound. Every call re-authenticates and re-authorizes.
import "server-only";
import { auth } from "../auth/next-auth.server";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { createGitHubOwnerTaskCreate, createOwnerQuickCreate, newQuickCreateFormKey } from "./owner-task-create";

export type { QuickCreateOutcome } from "./owner-task-create";

const quickCreate = createOwnerQuickCreate({
  workspaceSlug: process.env.APP_DEMO_WORKSPACE_SLUG,
  async withTaskCreate(domainWorkspaceId, create) {
    const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
    try {
      return await create(createGitHubOwnerTaskCreate({ database, domainWorkspaceId, sessionResolver: { resolve: () => auth() } }));
    } finally {
      await database.close().catch(() => undefined);
    }
  },
});

export async function submitOwnerQuickCreate(form: FormData) {
  return quickCreate.submit(form);
}

// One opaque idempotency key per rendered Quick Create form (see newQuickCreateFormKey).
export function issueQuickCreateFormKey(): string {
  return newQuickCreateFormKey();
}
