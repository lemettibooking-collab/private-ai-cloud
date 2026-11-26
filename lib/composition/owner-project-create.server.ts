import "server-only";
import { auth } from "../auth/next-auth.server";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { createGitHubOwnerProjectCreate, createOwnerProjectCreate } from "./owner-project-create";

const creation = createOwnerProjectCreate({
  workspaceSlug: process.env.APP_DEMO_WORKSPACE_SLUG,
  async withProjectCreate(domainWorkspaceId, work) {
    const session = await auth();
    const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
    try {
      return await work(createGitHubOwnerProjectCreate({ database, domainWorkspaceId, session }));
    } finally { await database.close().catch(() => undefined); }
  },
});

export async function submitOwnerProjectCreate(form: FormData) { return creation.submit(form); }
