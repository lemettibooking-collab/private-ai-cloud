import "server-only";
import { auth } from "../auth/next-auth.server";
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { resolveSessionOwner } from "../integrations/chatgpt/chatgpt-owner-authority";
import { createOpenAIApiAccess } from "../integrations/openai-api/openai-api-access";
import { createOpenAIApiCredentialStore, defaultOpenAIApiDirectory } from "../integrations/openai-api/openai-api-credential-store";
import type { OpenAIApiAccessView } from "../../types/openai-api-access";

async function withAccess<T>(work: (access: ReturnType<typeof createOpenAIApiAccess>) => Promise<T>): Promise<T> {
  const database = createWorkflowRuntimePostgresDatabase({ connectionString: process.env.DATABASE_URL, maxConnections: 2 });
  try {
    const access = createOpenAIApiAccess({ store: createOpenAIApiCredentialStore(defaultOpenAIApiDirectory()), owner: async () => {
      const workspace = process.env.APP_DEMO_WORKSPACE_SLUG;
      if (!workspace || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(workspace)) return null;
      const owner = await resolveSessionOwner(database, workspace,
        createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => auth() }, database }));
      return owner.status === "owner" ? { ownerUserId: owner.ownerUserId, domainWorkspaceId: workspace } : null;
    } });
    return await work(access);
  } finally { await database.close().catch(() => undefined); }
}
export async function loadOpenAIApiAccess(): Promise<OpenAIApiAccessView> {
  try { return await withAccess(access => access.status()); }
  catch { return { state: "temporarily_unavailable", limits: null, executionAvailable: false }; }
}
export async function saveOpenAIApiAccess(key: unknown, limits: unknown) {
  try { return await withAccess(access => access.connect(key, limits)); }
  catch { return "temporarily_unavailable" as const; }
}
export async function configureOpenAIApiAccess(limits: unknown) {
  try { return await withAccess(access => access.configure(limits)); }
  catch { return "temporarily_unavailable" as const; }
}
export async function disconnectOpenAIApiAccess() {
  try { return await withAccess(access => access.disconnect()); }
  catch { return "temporarily_unavailable" as const; }
}
