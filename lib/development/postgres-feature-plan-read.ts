import type { WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { FeaturePlanRevisionSummary, TaskFeaturePlans } from "./feature-plan-model";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeFeaturePlan } from "../contracts/development-plan.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { discoverableProjectStatuses } from "../projects/project-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isTaskKey, timestamp } from "../tasks/project-task.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { canonicalFeaturePlan, featurePlanBuilderLimits, fingerprintPattern, planKeyPattern } from "./feature-plan-model.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { featurePlanFingerprint } from "./feature-plan-revision.ts";

// AI-039 FeaturePlan revisions of ONE ProjectTask (tenant-scoped, read-only). Callers pass the
// workspace UUID of an ALREADY RESOLVED trusted tenant; the statement filters by it. The Project
// Registry is the discoverability gate (archived / unregistered projects: not_found), exactly like the
// ProjectTask detail read. One bounded statement: the task, the factual revision count and the newest
// `maxHistory` revisions (plan JSON for the latest only).
//
// Nothing is repaired: the latest stored plan must re-validate with the canonical FeaturePlan contract,
// be a draft whose id is the row's plan key, and re-fingerprint to the stored fingerprint; the history
// must be one plan lineage with contiguous revisions. Any disagreement fails the WHOLE read closed.

export type FeaturePlanRead =
  | Readonly<{ verdict: "allow"; data: TaskFeaturePlans }>
  | Readonly<{ verdict: "deny"; reason: "invalid_input" | "not_found" | "inconsistent_state" }>;

type Row = Record<string, unknown>;

const count = (input: unknown): number | null => {
  const value = typeof input === "string" ? Number(input) : input;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
};

export async function queryTaskFeaturePlans(
  client: WorkflowRuntimeSqlClient,
  workspaceDatabaseId: string,
  taskKey: unknown,
): Promise<FeaturePlanRead> {
  if (!isTaskKey(taskKey)) return { verdict: "deny", reason: "invalid_input" };
  const limit = featurePlanBuilderLimits.maxHistory;
  const result = await client.query<Row>(
    `/* feature-plan:task-plans */
     with target as (
       select task.workspace_id, task.project_key, task.task_key
       from project_tasks as task
       join projects as project
         on project.workspace_id = task.workspace_id and project.project_key = task.project_key
        and project.status = any($2::text[])
       where task.workspace_id = $1 and task.task_key = $3
     ), history as (
       select revision_row.plan_key, revision_row.revision, revision_row.plan_fingerprint, revision_row.created_at,
              case when row_number() over (order by revision_row.revision desc) = 1 then revision_row.plan_json end as plan_json
       from project_task_feature_plans as revision_row
       join target
         on revision_row.workspace_id = target.workspace_id and revision_row.project_key = target.project_key
        and revision_row.task_key = target.task_key
       order by revision_row.revision desc
       limit $4
     )
     select target.task_key, target.project_key,
            (select count(*) from project_task_feature_plans as counted
              where counted.workspace_id = target.workspace_id and counted.task_key = target.task_key)::text as revision_count,
            history.plan_key, history.revision::text as revision, history.plan_fingerprint, history.created_at, history.plan_json
     from target
     left join history on true
     order by history.revision desc nulls last`,
    [workspaceDatabaseId, [...discoverableProjectStatuses], taskKey, limit],
  );
  if (result.rowCount === 0) return { verdict: "deny", reason: "not_found" };
  const inconsistent = { verdict: "deny", reason: "inconsistent_state" } as const;
  if (result.rowCount > limit) return inconsistent;
  const first = result.rows[0];
  const revisionCount = count(first.revision_count);
  if (first.task_key !== taskKey || !isTaskKey(first.project_key) || revisionCount === null) return inconsistent;
  const projectId = first.project_key as string;

  if (first.revision === null) {
    // No revision yet: exactly one row, and the factual count must agree.
    if (result.rowCount !== 1 || revisionCount !== 0) return inconsistent;
    return { verdict: "allow", data: Object.freeze({ taskId: taskKey, projectId, revisionCount: 0, latest: null, history: Object.freeze([]), historyTruncated: false }) };
  }

  const history: FeaturePlanRevisionSummary[] = [];
  let planKey: string | null = null;
  for (const [index, row] of result.rows.entries()) {
    const revision = count(row.revision);
    const createdAt = timestamp(row.created_at);
    if (row.task_key !== taskKey || row.project_key !== projectId || count(row.revision_count) !== revisionCount
      || typeof row.plan_key !== "string" || !planKeyPattern.test(row.plan_key) || (planKey !== null && row.plan_key !== planKey)
      || revision === null || revision !== revisionCount - index || !createdAt
      || typeof row.plan_fingerprint !== "string" || !fingerprintPattern.test(row.plan_fingerprint)
      || (index === 0) !== (row.plan_json !== null)) {
      return inconsistent;
    }
    planKey = row.plan_key;
    history.push(Object.freeze({ planId: row.plan_key, revision, createdAt, fingerprint: row.plan_fingerprint }));
  }

  // The latest stored plan: canonical contract, draft, its own key, and the stored fingerprint.
  const validation = validateAndNormalizeFeaturePlan(first.plan_json);
  if (!validation.ok) return inconsistent;
  const plan = canonicalFeaturePlan(validation.value);
  const latest = history[0];
  if (plan.status !== "draft" || plan.id !== latest.planId || featurePlanFingerprint(plan) !== latest.fingerprint) return inconsistent;

  return {
    verdict: "allow",
    data: Object.freeze({
      taskId: taskKey,
      projectId,
      revisionCount,
      latest: Object.freeze({ ...latest, plan }),
      history: Object.freeze(history),
      historyTruncated: revisionCount > history.length,
    }),
  };
}
