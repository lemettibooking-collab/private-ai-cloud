import { createHash } from "node:crypto";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
import type { PublicProjectSummary } from "./project-registry";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { capturedMethod, Conflict, exactOwnData, inTransaction, resolveUserId, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { lockProjectOwner } from "./project-owner-access.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver, isResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isDisplayName, isProjectKey, projectSummaryFromRow } from "./project-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { pacIdentityFromProjection } from "../auth/auth-config.ts";

// PAC-ONB-01: one explicit Owner intent creates registry identity only. No execution or integration.
// Natural idempotency key = (trusted workspace, stable projectId). The creation audit proves the
// original intent and actor; matching a legacy row by name alone never grants a replay.
export type CreateProjectResult =
  | Readonly<{ status: "created" | "replayed"; project: PublicProjectSummary }>
  | Readonly<{ status: "invalid_input" | "unauthenticated" | "unavailable" | "conflict" }>;
export type OwnerProjectMutations = Readonly<{ createProject(input: unknown): Promise<CreateProjectResult> }>;
export type ProjectCreationIntent = Readonly<{ projectId: string; displayName: string }>;
const outcome = (status: "invalid_input" | "unauthenticated" | "unavailable" | "conflict"): CreateProjectResult => Object.freeze({ status });

export function projectCreationIntent(input: unknown): ProjectCreationIntent | null {
  const fields = exactOwnData(input, ["projectId", "displayName"]);
  return fields && isProjectKey(fields.projectId) && isDisplayName(fields.displayName)
    ? Object.freeze({ projectId: fields.projectId, displayName: fields.displayName }) : null;
}

export function projectCreationFingerprint(intent: ProjectCreationIntent): string {
  return createHash("sha256").update(JSON.stringify([intent.projectId, intent.displayName, "active"])).digest("hex");
}

export function createOwnerProjectMutations(input: unknown): OwnerProjectMutations {
  const config = exactOwnData(input, ["database", "domainWorkspaceId", "identitySource", "sessionIdentity"]);
  const connect = config && capturedMethod(config.database, "connect");
  const resolve = config && capturedMethod(config.identitySource, "resolve");
  const domain = config?.domainWorkspaceId;
  const sessionIdentity = pacIdentityFromProjection(config?.sessionIdentity);
  if (!connect || !resolve || !isProjectKey(domain) || (config?.sessionIdentity !== null && !sessionIdentity)) throw new Error("Owner project configuration is invalid.");
  const database: WorkflowRuntimeDatabase = Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]> });
  return Object.freeze({
    async createProject(raw: unknown): Promise<CreateProjectResult> {
      const intent = projectCreationIntent(raw);
      if (!intent) return outcome("invalid_input");
      if (typeof window !== "undefined") return outcome("unavailable");
      try {
        const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(domain);
        if (!tenant || !isResolvedWorkflowRuntimeTenant(tenant)) return outcome("unavailable");
        const userId = await resolveUserId(resolve);
        if (!userId) return outcome("unauthenticated");
        if (!sessionIdentity) return outcome("unavailable");
        const fingerprint = projectCreationFingerprint(intent);
        return await inTransaction(database, async client => {
          // C1: serialize this write with revocation of the ORIGINAL session mapping. Another
          // active identity for the same user is not authority for this request. SHARE (not KEY
          // SHARE) blocks status-only UPDATE/delete until commit. Keep the existing Owner prefix.
          await lockProjectOwner(client, tenant, userId, sessionIdentity);
          const inserted = await client.query(
            `/* project-mutation:create */
             insert into projects (workspace_id, project_key, display_name, status)
             values ($1, $2, $3, 'active')
             on conflict on constraint projects_workspace_project_key_unique do nothing
             returning id::text, project_key, display_name, status, repository_url, default_branch`,
            [tenant.workspaceDatabaseId, intent.projectId, intent.displayName],
          );
          if (inserted.rowCount === 1) {
            const row = inserted.rows[0];
            const project = projectSummaryFromRow(row);
            if (!project || project.projectId !== intent.projectId || project.displayName !== intent.displayName || project.status !== "active" || project.repository !== null
              || typeof row.id !== "string" || !/^[0-9a-f-]{36}$/u.test(row.id)) throw new Unavailable();
            const audit = await client.query(
              `/* project-mutation:audit-created */
               insert into audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
               values ($1, $2, 'project.created', 'project', $3::uuid, $4::jsonb) returning id`,
              [tenant.workspaceDatabaseId, userId, row.id, JSON.stringify({ projectId: intent.projectId, intentFingerprint: fingerprint })],
            );
            if (audit.rowCount !== 1) throw new Unavailable();
            return Object.freeze({ status: "created" as const, project });
          }
          if (inserted.rowCount !== 0) throw new Unavailable();
          // ON CONFLICT waits for a competing creation to commit. A new READ COMMITTED statement
          // then sees its project + audit together. Lock the row so a mutation cannot race the replay.
          const existing = await client.query(
            `/* project-mutation:replay */
             select id::text, project_key, display_name, status, repository_url, default_branch
             from projects where workspace_id = $1 and project_key = $2 for update`,
            [tenant.workspaceDatabaseId, intent.projectId],
          );
          if (existing.rowCount !== 1) throw new Unavailable();
          const row = existing.rows[0];
          const project = projectSummaryFromRow(row);
          // Creation replay is intentionally strict about CURRENT state. A later GitHub binding,
          // rename or pause/archive makes this create request conflict; it never undoes that change.
          if (!project || project.projectId !== intent.projectId || project.displayName !== intent.displayName || project.status !== "active" || project.repository !== null) throw new Conflict();
          const audit = await client.query(
            `/* project-mutation:audit-replay */
             select actor_user_id::text, metadata from audit_events
             where workspace_id = $1 and entity_type = 'project' and entity_id = $2::uuid and event_type = 'project.created'
             limit 2 for share`,
            [tenant.workspaceDatabaseId, row.id],
          );
          const evidence = audit.rows[0];
          const metadata = exactOwnData(evidence?.metadata, ["projectId", "intentFingerprint"]);
          if (audit.rowCount !== 1 || evidence?.actor_user_id !== userId || metadata?.projectId !== intent.projectId || metadata?.intentFingerprint !== fingerprint) throw new Conflict();
          return Object.freeze({ status: "replayed" as const, project });
        });
      } catch (error) {
        return outcome(error instanceof Conflict ? "conflict" : "unavailable");
      }
    },
  });
}
