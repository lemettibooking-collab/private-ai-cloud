import { createHash } from "node:crypto";
import type { createProjectOwnerAccess } from "./project-owner-access";
import type { PublicProjectSummary } from "./project-registry";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { Conflict, exactOwnData, Unavailable } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Direct Node TypeScript execution needs the extension.
import { isCanonicalRepositoryUrl, isDefaultBranch, isProjectKey, projectSummaryFromRow } from "./project-registry.ts";

export const requestKeyPattern = /^[a-z0-9][a-z0-9._-]{7,95}$/u;
export const fingerprint = (value: readonly unknown[]) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function canonicalGitHubRepository(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 250 || /[\s\u0000-\u001f\u007f]/u.test(input) || !/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(input)) return null;
  const url = input.replace(/\.git$/u, "").toLowerCase();
  return isCanonicalRepositoryUrl(url) && !url.endsWith(".") && !url.includes("..") ? url : null;
}
export type RepositoryBindingView = Readonly<{
  project: PublicProjectSummary;
  projectId: string; displayName: string; projectStatus: string; url: string | null; defaultBranch: string | null;
  revision: number; bindingStatus: "not_configured" | "configured_unverified"; verifiedBaselineSha: null;
}>;
function view(row: Record<string, unknown>): RepositoryBindingView {
  const project = projectSummaryFromRow(row), revision = Number(row.repository_revision);
  if (!project || !Number.isSafeInteger(revision) || revision < 0 || revision > 1000000000) throw new Unavailable();
  return Object.freeze({ project, projectId: project.projectId, displayName: project.displayName, projectStatus: project.status,
    url: project.repository?.url ?? null, defaultBranch: project.repository?.defaultBranch ?? null, revision,
    bindingStatus: project.repository ? "configured_unverified" : "not_configured", verifiedBaselineSha: null });
}

export function createRepositoryBinding(access: ReturnType<typeof createProjectOwnerAccess>) {
  return Object.freeze({
    read(projectId: unknown) { return access.run(projectId, false, async (_client, context) => view(context.project)); },
    async bind(input: unknown) {
      const fields = exactOwnData(input, ["projectId", "url", "defaultBranch", "expectedRevision", "requestId"]);
      const url = canonicalGitHubRepository(fields?.url);
      if (!fields || !isProjectKey(fields.projectId) || !url || !isDefaultBranch(fields.defaultBranch) || fields.defaultBranch !== fields.defaultBranch.trim() || typeof fields.requestId !== "string" || fields.requestId.length > 96 || fields.requestId !== fields.requestId.trim() || !requestKeyPattern.test(fields.requestId)
        || !Number.isSafeInteger(fields.expectedRevision) || (fields.expectedRevision as number) < 0 || (fields.expectedRevision as number) >= 1000000000) return Object.freeze({ status: "invalid_input" as const });
      const intent = { projectId: fields.projectId, requestId: fields.requestId, defaultBranch: fields.defaultBranch, expectedRevision: fields.expectedRevision as number, url };
      const digest = fingerprint([intent.projectId, url, intent.defaultBranch, intent.expectedRevision]);
      return access.run(fields.projectId, true, async (client, context) => {
        const current = view(context.project);
        const replay = await client.query(`/* repository-binding:replay */
          select entity_id::text, entity_type, actor_user_id::text, metadata from audit_events
          where workspace_id=$1 and event_type='project.repository_bound' and metadata->>'requestId'=$2 limit 2 for share`, [context.workspaceId, intent.requestId]);
        if (replay.rowCount) {
          const row = replay.rows[0], metadata = exactOwnData(row.metadata, ["projectId", "requestId", "intentFingerprint", "revision"]);
          if (replay.rowCount !== 1 || row.entity_type !== "project" || row.entity_id !== context.project.id || row.actor_user_id !== context.userId
            || metadata?.intentFingerprint !== digest || metadata.projectId !== intent.projectId || metadata.requestId !== intent.requestId
            || metadata.revision !== intent.expectedRevision + 1 || metadata.revision !== current.revision || current.url !== url || current.defaultBranch !== intent.defaultBranch) throw new Conflict();
          return Object.freeze({ outcome: "replayed" as const, binding: current });
        }
        if (current.revision !== intent.expectedRevision) throw new Conflict();
        const updated = await client.query(`/* repository-binding:update */
          update projects set repository_url=$3,default_branch=$4,repository_revision=repository_revision+1
          where workspace_id=$1 and project_key=$2 and repository_revision=$5
          returning project_key,display_name,status,repository_url,default_branch,repository_revision::text`,
        [context.workspaceId, intent.projectId, url, intent.defaultBranch, intent.expectedRevision]);
        if (updated.rowCount !== 1) throw new Conflict();
        const binding = view(updated.rows[0]);
        if (binding.revision !== intent.expectedRevision + 1) throw new Unavailable();
        const audited = await client.query(`/* repository-binding:audit */
          insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata)
          values($1,$2,'project.repository_bound','project',$3,$4::jsonb) on conflict do nothing returning id`,
        [context.workspaceId, context.userId, context.project.id, JSON.stringify({ projectId: intent.projectId, requestId: intent.requestId, intentFingerprint: digest, revision: binding.revision })]);
        if (audited.rowCount !== 1) throw new Conflict();
        return Object.freeze({ outcome: "saved" as const, binding });
      });
    },
  });
}
