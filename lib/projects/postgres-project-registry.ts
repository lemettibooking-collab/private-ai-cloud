import type { WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { WorkflowRunStatus } from "../contracts/workflow-run";
import type { PublicProjectSummary } from "./project-registry";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeWorkflowRunSnapshot, workflowRunStatuses } from "../contracts/workflow-run.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { boundedProjectLimit, discoverableProjectStatuses, isProjectKey, projectSummaryFromRow } from "./project-registry.ts";

// AI-038.3.1 Project Registry SQL (tenant-scoped). Callers pass the workspace UUID of an ALREADY
// RESOLVED trusted tenant; every statement filters by it. No statement reads another workspace's
// rows, and nothing is filtered in memory across tenants. One bounded statement per read.

export type ProjectRunSummary = Readonly<{
  runId: string;
  projectId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}>;

export type ProjectRegistryRead<T> =
  | Readonly<{ verdict: "allow"; data: T }>
  | Readonly<{ verdict: "deny"; reason: "invalid_input" | "not_found" | "inconsistent_state" }>;

type Row = Record<string, unknown>;

const runIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const runStatuses = new Set<string>(workflowRunStatuses);

function revision(input: unknown): number | null {
  const value = typeof input === "string" ? Number(input) : input;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function timestamp(input: unknown): string | null {
  if (!(input instanceof Date) && typeof input !== "string") return null;
  const value = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function optionalTimestamp(input: unknown): string | null | undefined {
  return input === null ? null : timestamp(input) ?? undefined;
}

// Discoverable (active / paused) projects of one workspace, ordered by project key.
export async function queryProjects(
  client: WorkflowRuntimeSqlClient,
  workspaceDatabaseId: string,
  limitInput: unknown,
): Promise<ProjectRegistryRead<readonly PublicProjectSummary[]>> {
  const limit = boundedProjectLimit(limitInput);
  if (limit === null) return { verdict: "deny", reason: "invalid_input" };
  const result = await client.query<Row>(
    `/* project-registry:list */
     select project_key, display_name, status, repository_url, default_branch
     from projects
     where workspace_id = $1 and status = any($2::text[])
     order by project_key
     limit $3`,
    [workspaceDatabaseId, [...discoverableProjectStatuses], limit],
  );
  if (result.rowCount > limit) return { verdict: "deny", reason: "inconsistent_state" };
  const projects = result.rows.map(projectSummaryFromRow);
  return projects.every((project): project is PublicProjectSummary => project !== null)
    ? { verdict: "allow", data: Object.freeze(projects) }
    : { verdict: "deny", reason: "inconsistent_state" };
}

// Runtime runs of ONE discoverable project in ONE workspace, newest first. A single statement: the
// registry row is the driving relation, so an unknown, foreign or archived project yields zero rows
// (not_found), and a registered project without runs yields exactly one row with null run columns.
//
// workflow_runs.project_id / workflow_id / status / revision are DENORMALIZED facts of the factual
// runtime_snapshot. Routing by the column alone could attribute a run to the wrong project, so every
// returned run must carry a canonically valid snapshot (the same validator getRunOverview uses) that
// agrees exactly with its columns and with the requested project; any disagreement fails the WHOLE
// list closed. The snapshot is only validated here, never projected.
export async function queryProjectRuns(
  client: WorkflowRuntimeSqlClient,
  workspaceDatabaseId: string,
  projectKey: unknown,
  limitInput: unknown,
): Promise<ProjectRegistryRead<readonly ProjectRunSummary[]>> {
  const limit = boundedProjectLimit(limitInput);
  if (!isProjectKey(projectKey) || limit === null) return { verdict: "deny", reason: "invalid_input" };
  const result = await client.query<Row>(
    `/* project-registry:list-runs */
     select project.project_key, run.runtime_id, run.project_id, run.workflow_id, run.status,
            run.revision::text as revision, run.created_at, run.started_at,
            coalesce(run.completed_at, run.failed_at) as completed_at, run.runtime_snapshot
     from projects as project
     left join lateral (
       select candidate.runtime_id, candidate.project_id, candidate.workflow_id, candidate.status,
              candidate.revision, candidate.created_at, candidate.started_at, candidate.completed_at,
              candidate.failed_at, candidate.runtime_snapshot
       from workflow_runs as candidate
       where candidate.workspace_id = project.workspace_id
         and candidate.project_id = project.project_key
         and candidate.runtime_id is not null
       order by candidate.created_at desc, candidate.runtime_id desc
       limit $4
     ) as run on true
     where project.workspace_id = $1 and project.project_key = $2 and project.status = any($3::text[])
     order by run.created_at desc nulls last, run.runtime_id desc nulls last`,
    [workspaceDatabaseId, projectKey, [...discoverableProjectStatuses], limit],
  );
  if (result.rowCount === 0) return { verdict: "deny", reason: "not_found" };
  if (result.rowCount > limit) return { verdict: "deny", reason: "inconsistent_state" };
  if (result.rowCount === 1 && result.rows[0].runtime_id === null) return { verdict: "allow", data: Object.freeze([]) };
  const runs: ProjectRunSummary[] = [];
  for (const row of result.rows) {
    const runRevision = revision(row.revision);
    const createdAt = timestamp(row.created_at);
    const startedAt = optionalTimestamp(row.started_at);
    const completedAt = optionalTimestamp(row.completed_at);
    if (row.project_key !== projectKey || row.project_id !== projectKey
      || typeof row.runtime_id !== "string" || !runIdPattern.test(row.runtime_id)
      || typeof row.workflow_id !== "string" || !runIdPattern.test(row.workflow_id)
      || typeof row.status !== "string" || !runStatuses.has(row.status)
      || runRevision === null || !createdAt || startedAt === undefined || completedAt === undefined) {
      return { verdict: "deny", reason: "inconsistent_state" };
    }
    const snapshotDecision = validateAndNormalizeWorkflowRunSnapshot(row.runtime_snapshot);
    const snapshot = snapshotDecision.normalizedSnapshot;
    if (snapshotDecision.verdict !== "allow" || !snapshot
      || snapshot.runId !== row.runtime_id
      || snapshot.projectId !== row.project_id || snapshot.projectId !== projectKey
      || snapshot.workflowId !== row.workflow_id
      || snapshot.status !== row.status
      || snapshot.revision !== runRevision) {
      return { verdict: "deny", reason: "inconsistent_state" };
    }
    runs.push(Object.freeze({
      runId: row.runtime_id,
      projectId: projectKey,
      workflowId: row.workflow_id,
      status: row.status as WorkflowRunStatus,
      revision: runRevision,
      createdAt,
      startedAt,
      completedAt,
    }));
  }
  return { verdict: "allow", data: Object.freeze(runs) };
}
