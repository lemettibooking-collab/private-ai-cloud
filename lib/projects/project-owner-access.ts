import { isProxy } from "node:util/types";
import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant";
import type { PacAuthIdentity } from "../auth/auth-config";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { pacIdentityFromProjection } from "../auth/auth-config.ts";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { createGitHubSessionIdentitySource } from "../auth/github-session-identity-source.ts";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { capturedMethod, Conflict, inTransaction, lockOwnerAuthority, resolveUserId, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { createPostgresWorkflowRuntimeTenantResolver, isResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { isProjectKey, projectSummaryFromRow } from "./project-registry.ts";

// Project-local reuse of PAC-ONB-01 C1. No change to shared Auth.js or executor authorization.
export function snapshotProjectSession(session: unknown) {
  if (typeof session !== "object" || session === null || isProxy(session) || Array.isArray(session)) return null;
  const prototype = Object.getPrototypeOf(session);
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(session).some(key => typeof key !== "string")) return null;
  const descriptor = Object.getOwnPropertyDescriptor(session, "pacIdentity");
  const identity = descriptor && Object.hasOwn(descriptor, "value") ? pacIdentityFromProjection(descriptor.value) : null;
  return identity ? Object.freeze({ pacIdentity: identity }) : null;
}

export async function lockProjectOwner(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, userId: string, identity: PacAuthIdentity) {
  await lockOwnerAuthority(client, tenant, userId);
  const row = await client.query(
    `/* project-mutation:identity-lock */
     select id::text from auth_identities
     where provider = $1 and provider_subject = $2 and user_id = $3::uuid and status = 'active'
     limit 2 for share`, [identity.provider, identity.providerSubject, userId],
  );
  if (row.rowCount !== 1 || row.rows.length !== 1) throw new Unavailable();
}

export type ProjectOwnerContext = Readonly<{ workspaceId: string; userId: string; project: Record<string, unknown> }>;
export type ProjectAccessResult<T> = Readonly<{ status: "ok"; value: T }> | Readonly<{ status: "invalid_input" | "unauthenticated" | "unavailable" | "conflict" }>;

export function createProjectOwnerAccess(config: { database: unknown; domainWorkspaceId: string; session: unknown }) {
  const connect = capturedMethod(config.database, "connect");
  const domainWorkspaceId = config.domainWorkspaceId;
  if (!connect || !isProjectKey(domainWorkspaceId)) throw new Error("Project access configuration is invalid.");
  const database: WorkflowRuntimeDatabase = Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]> });
  const session = snapshotProjectSession(config.session);
  const source = createGitHubSessionIdentitySource({ database, sessionResolver: { resolve: () => session } });
  return Object.freeze({
    async run<T>(projectId: unknown, write: boolean, work: (client: WorkflowRuntimeSqlClient, context: ProjectOwnerContext) => Promise<T>): Promise<ProjectAccessResult<T>> {
      if (!isProjectKey(projectId)) return Object.freeze({ status: "invalid_input" });
      if (typeof window !== "undefined") return Object.freeze({ status: "unavailable" });
      if (!session) return Object.freeze({ status: "unauthenticated" });
      try {
        const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(domainWorkspaceId);
        if (!tenant || !isResolvedWorkflowRuntimeTenant(tenant)) return Object.freeze({ status: "unavailable" });
        const userId = await resolveUserId(source.resolve);
        if (!userId || !session) return Object.freeze({ status: "unauthenticated" });
        const value = await inTransaction(database, async client => {
          await lockProjectOwner(client, tenant, userId, session.pacIdentity);
          const row = await client.query(
            `/* project-resources:project-lock */
             select id::text, project_key, display_name, status, repository_url, default_branch,
                    repository_revision::text as repository_revision
             from projects where workspace_id=$1 and project_key=$2 and status=any($3::text[])
             for ${write ? "update" : "share"}`,
            [tenant.workspaceDatabaseId, projectId, write ? ["active"] : ["active", "paused"]],
          );
          if (row.rowCount !== 1 || !projectSummaryFromRow(row.rows[0])) throw new Unavailable();
          return work(client, Object.freeze({ workspaceId: tenant.workspaceDatabaseId, userId, project: row.rows[0] }));
        });
        return Object.freeze({ status: "ok", value });
      } catch (error) { return Object.freeze({ status: error instanceof Conflict ? "conflict" : "unavailable" }); }
    },
  });
}
