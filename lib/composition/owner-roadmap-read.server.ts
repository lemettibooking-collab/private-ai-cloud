import "server-only";
import { connection } from "next/server";
import { auth } from "../auth/next-auth.server";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source";
import { createRoadmapOwnerReader } from "../db/roadmap-owner-read";
export type { OwnerRoadmapView, OwnerRoadmapTask, OwnerRoadmapMilestone, OwnerRoadmapGateStatus } from "../db/roadmap-owner-read";

/** Fresh authorization each request. Rendering can neither tick the controller nor mutate a guard. */
export async function loadOwnerRoadmap(project: string | string[] | undefined) {
  await connection(); // Never swallow Next's request-time rendering signal.
  let database: ReturnType<typeof createWorkflowRuntimePostgresDatabase> | null = null;
  try {
    database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
    const reader = createRoadmapOwnerReader({ database, domainWorkspaceId: process.env.APP_DEMO_WORKSPACE_SLUG,
      identitySource: createGitHubSessionIdentitySource({ database, sessionResolver: { resolve: () => auth() } }) });
    return await reader.read(project);
  } catch { return Object.freeze({ state: "unavailable" as const }); }
  finally { await database?.close().catch(() => undefined); }
}
