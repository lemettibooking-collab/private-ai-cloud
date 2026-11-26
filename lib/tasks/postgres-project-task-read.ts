import type { WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { WorkflowRunStatus } from "../contracts/workflow-run";
import type { ProjectTaskRunSummary, ProjectTaskView, PublicProjectTaskDetail, PublicProjectTaskSummary } from "./project-task";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeWorkflowRunSnapshot, workflowRunStatuses } from "../contracts/workflow-run.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { discoverableProjectStatuses, isProjectKey } from "../projects/project-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { attentionTaskStatuses, currentTaskStatuses, isProjectTaskView, isTaskKey, optionalTimestamp, projectTaskLimits, projectTaskViewLimits, taskFieldsFromRow, timestamp } from "./project-task.ts";

// AI-038.4a ProjectTask SQL (tenant-scoped, read-only). Callers pass the workspace UUID of an ALREADY
// RESOLVED trusted tenant; every statement filters by it. The Project Registry is the discoverability
// gate: tasks of archived or unregistered projects never appear. One bounded statement per read — task
// rows, their linked-run count and their linked runs are joined in SQL (no per-task / per-run reads).
//
// Linked runs are validated exactly like project run discovery: the canonical runtime snapshot must
// agree with the denormalized run columns and with the task's project; any disagreement fails the
// WHOLE read closed. Snapshots are validated only, never projected.

export type ProjectTaskRead<T> =
  | Readonly<{ verdict: "allow"; data: T }>
  | Readonly<{ verdict: "deny"; reason: "invalid_input" | "not_found" | "inconsistent_state" }>;

type Row = Record<string, unknown>;

const runIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const runStatuses = new Set<string>(workflowRunStatuses);

const viewStatuses: Readonly<Record<ProjectTaskView, readonly string[] | null>> = Object.freeze({
  all: null,
  current: currentTaskStatuses,
  attention: attentionTaskStatuses,
  completed: ["completed"],
});

function count(input: unknown): number | null {
  const value = typeof input === "string" ? Number(input) : input;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

// A linked run (columns prefixed `run_`) → validated summary, `null` when the row has no run, or
// `false` when anything is inconsistent.
function linkedRun(row: Row, taskProject: string): ProjectTaskRunSummary | null | false {
  if (row.run_id === null) return null;
  const revision = count(row.run_revision);
  const createdAt = timestamp(row.run_created_at);
  const startedAt = optionalTimestamp(row.run_started_at);
  const completedAt = optionalTimestamp(row.run_completed_at);
  if (typeof row.run_id !== "string" || !runIdPattern.test(row.run_id) || row.run_project_id !== taskProject
    || typeof row.run_workflow_id !== "string" || !runIdPattern.test(row.run_workflow_id)
    || typeof row.run_status !== "string" || !runStatuses.has(row.run_status)
    || revision === null || !createdAt || startedAt === undefined || completedAt === undefined) {
    return false;
  }
  const decision = validateAndNormalizeWorkflowRunSnapshot(row.run_snapshot);
  const snapshot = decision.normalizedSnapshot;
  if (decision.verdict !== "allow" || !snapshot || snapshot.runId !== row.run_id || snapshot.projectId !== row.run_project_id
    || snapshot.projectId !== taskProject || snapshot.workflowId !== row.run_workflow_id
    || snapshot.status !== row.run_status || snapshot.revision !== revision) {
    return false;
  }
  return Object.freeze({
    runId: row.run_id,
    projectId: taskProject,
    workflowId: row.run_workflow_id,
    status: row.run_status as WorkflowRunStatus,
    revision,
    createdAt,
    startedAt,
    completedAt,
  });
}

const runColumns = `run.runtime_id as run_id, run.project_id as run_project_id, run.workflow_id as run_workflow_id,
       run.status as run_status, run.revision::text as run_revision, run.created_at as run_created_at,
       run.started_at as run_started_at, coalesce(run.completed_at, run.failed_at) as run_completed_at,
       run.runtime_snapshot as run_snapshot`;

const taskColumns = `task.task_key, task.project_key, task.title, task.goal, task.task_type, task.status, task.priority,
       task.risk_level, task.created_at, task.updated_at, task.completed_at,
       (select count(*) from project_task_runs as counted
         where counted.workspace_id = task.workspace_id and counted.task_key = task.task_key)::text as linked_run_count`;

// Linked runs of a task: same workspace, same project, newest first (link FKs guarantee both).
const linkedRunsLateral = (limitParameter: string) => `left join lateral (
       select candidate.runtime_id, candidate.project_id, candidate.workflow_id, candidate.status, candidate.revision,
              candidate.created_at, candidate.started_at, candidate.completed_at, candidate.failed_at, candidate.runtime_snapshot
       from project_task_runs as link
       join workflow_runs as candidate
         on candidate.workspace_id = link.workspace_id and candidate.project_id = link.project_key and candidate.runtime_id = link.run_id
       where link.workspace_id = task.workspace_id and link.project_key = task.project_key and link.task_key = task.task_key
       order by candidate.created_at desc, candidate.runtime_id desc
       limit ${limitParameter}
     ) as run on true`;

// Tasks of the workspace (optionally one project) for a server-fixed view, one bounded statement.
export async function queryProjectTasks(
  client: WorkflowRuntimeSqlClient,
  workspaceDatabaseId: string,
  view: unknown,
  projectKey: unknown,
): Promise<ProjectTaskRead<readonly PublicProjectTaskSummary[]>> {
  if (!isProjectTaskView(view) || (projectKey !== null && !isProjectKey(projectKey))) return { verdict: "deny", reason: "invalid_input" };
  const limit = projectTaskViewLimits[view];
  const order = view === "completed"
    ? "task.completed_at desc, task.task_key desc"
    : "task.updated_at desc, task.task_key desc";
  const result = await client.query<Row>(
    `/* project-task:list */
     select ${taskColumns}, ${runColumns}
     from project_tasks as task
     join projects as project
       on project.workspace_id = task.workspace_id and project.project_key = task.project_key
      and project.status = any($2::text[])
     ${linkedRunsLateral("1")}
     where task.workspace_id = $1
       and ($3::text is null or task.project_key = $3)
       and ($4::text[] is null or task.status = any($4::text[]))
     order by ${order}
     limit $5`,
    [workspaceDatabaseId, [...discoverableProjectStatuses], projectKey, viewStatuses[view], limit],
  );
  if (result.rowCount > limit) return { verdict: "deny", reason: "inconsistent_state" };
  const statuses = viewStatuses[view];
  const tasks: PublicProjectTaskSummary[] = [];
  for (const row of result.rows) {
    const fields = taskFieldsFromRow(row);
    const linkedRunCount = count(row.linked_run_count);
    if (!fields || linkedRunCount === null || (projectKey !== null && fields.projectId !== projectKey)
      || (statuses !== null && !statuses.includes(fields.status))) {
      return { verdict: "deny", reason: "inconsistent_state" };
    }
    const latest = linkedRun(row, fields.projectId);
    if (latest === false || (latest === null) !== (linkedRunCount === 0)) return { verdict: "deny", reason: "inconsistent_state" };
    tasks.push(Object.freeze({
      ...fields,
      linkedRunCount,
      latestRun: latest === null ? null : Object.freeze({ runId: latest.runId, status: latest.status, createdAt: latest.createdAt, completedAt: latest.completedAt }),
    }));
  }
  return { verdict: "allow", data: Object.freeze(tasks) };
}

// One task by its stable key inside the workspace, with its linked runs, one bounded statement.
// Unknown, foreign and archived-project tasks are all `not_found`.
export async function queryProjectTask(
  client: WorkflowRuntimeSqlClient,
  workspaceDatabaseId: string,
  taskKey: unknown,
): Promise<ProjectTaskRead<PublicProjectTaskDetail>> {
  if (!isTaskKey(taskKey)) return { verdict: "deny", reason: "invalid_input" };
  const limit = projectTaskLimits.maxLinkedRuns;
  const result = await client.query<Row>(
    `/* project-task:detail */
     select ${taskColumns}, ${runColumns}
     from project_tasks as task
     join projects as project
       on project.workspace_id = task.workspace_id and project.project_key = task.project_key
      and project.status = any($2::text[])
     ${linkedRunsLateral("$4")}
     where task.workspace_id = $1 and task.task_key = $3
     order by run.created_at desc nulls last, run.runtime_id desc nulls last`,
    [workspaceDatabaseId, [...discoverableProjectStatuses], taskKey, limit],
  );
  if (result.rowCount === 0) return { verdict: "deny", reason: "not_found" };
  if (result.rowCount > limit) return { verdict: "deny", reason: "inconsistent_state" };
  const first = taskFieldsFromRow(result.rows[0]);
  const linkedRunCount = count(result.rows[0].linked_run_count);
  if (!first || first.taskId !== taskKey || linkedRunCount === null) return { verdict: "deny", reason: "inconsistent_state" };
  const runs: ProjectTaskRunSummary[] = [];
  for (const row of result.rows) {
    if (row.task_key !== taskKey || row.project_key !== first.projectId || count(row.linked_run_count) !== linkedRunCount) {
      return { verdict: "deny", reason: "inconsistent_state" };
    }
    const run = linkedRun(row, first.projectId);
    if (run === false) return { verdict: "deny", reason: "inconsistent_state" };
    if (run !== null) runs.push(run);
  }
  if ((runs.length === 0) !== (linkedRunCount === 0) || runs.length > linkedRunCount) return { verdict: "deny", reason: "inconsistent_state" };
  const latest = runs[0] ?? null;
  return {
    verdict: "allow",
    data: Object.freeze({
      task: Object.freeze({
        ...first,
        linkedRunCount,
        latestRun: latest === null ? null : Object.freeze({ runId: latest.runId, status: latest.status, createdAt: latest.createdAt, completedAt: latest.completedAt }),
      }),
      runs: Object.freeze(runs),
      runsTruncated: linkedRunCount > runs.length,
    }),
  };
}
