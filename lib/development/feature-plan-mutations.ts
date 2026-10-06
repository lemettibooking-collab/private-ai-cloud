import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant";
import type { AuthenticatedIdentitySource } from "../composition/authenticated-owner-read-runtime";
import type { PublicPlanError } from "./feature-plan-revision";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver, isResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { Conflict, Unavailable, capturedMethod, exactOwnData, inTransaction, lockOwnerAuthority, resolveUserId } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isTaskKey } from "../tasks/project-task.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { planKeyPattern } from "./feature-plan-model.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { featurePlanFingerprint, newPlanKey, normalizeDraftPlan, provisionalPlanKey, saveIntentFingerprint } from "./feature-plan-revision.ts";

// AI-039 FeaturePlan revision MUTATION contract — the only writer of project_task_feature_plans.
//
// Saves ONE immutable draft FeaturePlan revision for a ProjectTask. Planning data only: nothing here
// starts a run, calls a model / provider / executor, touches GitHub or a repository, commits, pushes,
// deploys, attaches a run or changes the ProjectTask status.
//
//   trusted config { database, domainWorkspaceId } + request-scoped identity source
//     → plan content validated with the canonical FeaturePlan contract BEFORE any database access
//     → tenant resolved by the trusted resolver (never caller data); identity resolved exactly once
//     → ONE transaction:
//         Owner authority re-verified with FOR SHARE (lib/tasks/owner-task-mutations, shared)
//         ProjectTask row FOR UPDATE (serializes every save of this task: revision + idempotency)
//         project row FOR SHARE; the task must be `draft` and the project `active`
//         idempotency: same key + same intent → the existing revision (no new row, no new audit);
//                      same key + different intent → conflict
//         revision = previous max + 1 inside the lock (unique (workspace, task, revision) as last guard)
//         insert the immutable revision + exactly ONE audit event
//
// Negative outcomes are public statuses only; no SQL, constraint, UUID, fingerprint or raw error leaves.

export type SavedFeaturePlanRevision = Readonly<{ taskId: string; projectId: string; planId: string; revision: number }>;

export type SaveFeaturePlanResult =
  | Readonly<{ status: "created" | "replayed"; revision: SavedFeaturePlanRevision }>
  | Readonly<{ status: "invalid_plan"; errors: readonly PublicPlanError[] }>
  | Readonly<{ status: "invalid_input" | "not_plannable" | "conflict" | "unavailable" | "unauthenticated" }>;

export interface OwnerFeaturePlanMutations {
  saveDraftRevision(input: unknown): Promise<SaveFeaturePlanResult>;
}

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const saveFields = ["idempotencyKey", "taskId", "plan"] as const;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const outcome = <S extends string>(status: S) => freeze({ status });

// The task exists in this workspace and the Owner may see it, but it cannot receive a revision now.
class NotPlannable extends Unavailable {}

const positive = (input: unknown): number | null => {
  const value = typeof input === "string" ? Number(input) : input;
  return Number.isSafeInteger(value) && (value as number) >= 1 ? value as number : null;
};

async function lockTask(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, taskId: string): Promise<Readonly<{ projectId: string }>> {
  const task = await client.query<{ project_key: string; status: string }>(
    `/* feature-plan-mutation:task-lock */
     select project_key, status from project_tasks where workspace_id = $1 and task_key = $2 for update`,
    [tenant.workspaceDatabaseId, taskId],
  );
  if (task.rowCount !== 1 || !stableIdPattern.test(task.rows[0].project_key)) throw new Unavailable();
  const projectId = task.rows[0].project_key;
  // FOR SHARE: a concurrent pause / archive commits first (seen here) or waits for this transaction.
  const project = await client.query<{ status: string }>(
    `/* feature-plan-mutation:project-lock */
     select status from projects where workspace_id = $1 and project_key = $2 for share`,
    [tenant.workspaceDatabaseId, projectId],
  );
  if (project.rowCount !== 1) throw new Unavailable();
  // Archived projects are not discoverable at all: the same opaque outcome as a missing task.
  if (project.rows[0].status === "archived") throw new Unavailable();
  if (task.rows[0].status !== "draft" || project.rows[0].status !== "active") throw new NotPlannable();
  return freeze({ projectId });
}

export function createOwnerFeaturePlanMutations(input: unknown): OwnerFeaturePlanMutations {
  const config = exactOwnData(input, ["database", "domainWorkspaceId", "identitySource"]);
  const connect = config ? capturedMethod(config.database, "connect") : null;
  const resolve = config ? capturedMethod(config.identitySource as AuthenticatedIdentitySource, "resolve") : null;
  const domainWorkspaceId = config?.domainWorkspaceId;
  if (!config || !connect || !resolve || typeof domainWorkspaceId !== "string" || !stableIdPattern.test(domainWorkspaceId)) {
    throw new Error("Owner FeaturePlan mutation configuration is invalid.");
  }
  // Receiver-free, frozen captures: the caller's objects are not retained as authority.
  const database: WorkflowRuntimeDatabase = Object.freeze({
    connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]>,
  });

  async function authenticate(): Promise<Readonly<{ tenant: ResolvedWorkflowRuntimeTenant; userId: string }> | "unauthenticated" | "unavailable"> {
    if (typeof window !== "undefined") return "unavailable";
    let tenant: ResolvedWorkflowRuntimeTenant | null;
    try {
      tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(domainWorkspaceId);
    } catch {
      tenant = null;
    }
    if (!tenant || !isResolvedWorkflowRuntimeTenant(tenant)) return "unavailable";
    const userId = await resolveUserId(resolve!);
    return userId ? freeze({ tenant, userId }) : "unauthenticated";
  }

  async function saveDraftRevision(raw: unknown): Promise<SaveFeaturePlanResult> {
    const fields = exactOwnData(raw, saveFields);
    if (!fields) return outcome("invalid_input");
    const { idempotencyKey, taskId, plan } = fields;
    if (typeof idempotencyKey !== "string" || !idempotencyKeyPattern.test(idempotencyKey) || !isTaskKey(taskId)) return outcome("invalid_input");
    // Content first, with the canonical contract and a provisional id (no database access yet).
    const provisional = normalizeDraftPlan(plan, provisionalPlanKey);
    if (!provisional.ok) return freeze({ status: "invalid_plan" as const, errors: provisional.errors });
    const intentFingerprint = saveIntentFingerprint(taskId, provisional.plan);
    const auth = await authenticate();
    if (auth === "unauthenticated" || auth === "unavailable") return outcome(auth);
    const workspace = auth.tenant.workspaceDatabaseId;
    try {
      return await inTransaction(database, async (client) => {
        await lockOwnerAuthority(client, auth.tenant, auth.userId);
        const { projectId } = await lockTask(client, auth.tenant, taskId);

        // Exact replay / conflict, decided inside the task lock (a concurrent identical save has
        // either committed — and is seen here — or is still waiting for this lock).
        const replay = async (): Promise<SaveFeaturePlanResult | null> => {
          const existing = await client.query<{ task_key: string; plan_key: string; revision: string; creation_intent_fingerprint: string }>(
            `/* feature-plan-mutation:replay */
             select task_key, plan_key, revision::text as revision, creation_intent_fingerprint
             from project_task_feature_plans where workspace_id = $1 and creation_idempotency_key = $2`,
            [workspace, idempotencyKey],
          );
          if (existing.rowCount === 0) return null;
          const row = existing.rows[0];
          const revision = positive(row.revision);
          if (existing.rowCount !== 1 || row.task_key !== taskId || row.creation_intent_fingerprint !== intentFingerprint) throw new Conflict();
          if (!planKeyPattern.test(row.plan_key) || revision === null) throw new Unavailable();
          return freeze({ status: "replayed" as const, revision: freeze({ taskId, projectId, planId: row.plan_key, revision }) });
        };
        const replayed = await replay();
        if (replayed) return replayed;

        // Revision allocation: one plan lineage per task, revisions 1..N contiguous (never deleted
        // individually). Read under the task row lock; the unique key is the last guard.
        const lineage = await client.query<{ plan_key: string; top: string; total: string }>(
          `/* feature-plan-mutation:lineage */
           select plan_key, max(revision)::text as top, count(*)::text as total
           from project_task_feature_plans where workspace_id = $1 and task_key = $2
           group by plan_key`,
          [workspace, taskId],
        );
        let planKey: string;
        let revision: number;
        if (lineage.rowCount === 0) {
          planKey = newPlanKey();
          revision = 1;
        } else {
          const row = lineage.rows[0];
          const top = positive(row.top);
          if (lineage.rowCount !== 1 || !planKeyPattern.test(row.plan_key) || top === null || positive(row.total) !== top) throw new Unavailable();
          planKey = row.plan_key;
          revision = top + 1;
        }

        const final = normalizeDraftPlan(plan, planKey);
        if (!final.ok) throw new Unavailable();
        const inserted = await client.query<{ id: string }>(
          `/* feature-plan-mutation:insert */
           insert into project_task_feature_plans (workspace_id, project_key, task_key, plan_key, revision, plan_json,
                                                   plan_fingerprint, created_by, creation_idempotency_key, creation_intent_fingerprint)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
           on conflict (workspace_id, creation_idempotency_key) do nothing
           returning id::text`,
          [workspace, projectId, taskId, planKey, revision, JSON.stringify(final.plan), featurePlanFingerprint(final.plan),
            auth.userId, idempotencyKey, intentFingerprint],
        );
        if (inserted.rowCount !== 1) {
          // The key was taken by another task's save between the lookup and the insert (different task
          // lock): the same replay / conflict rule applies.
          const late = await replay();
          if (late) return late;
          throw new Unavailable();
        }
        await client.query(
          `/* feature-plan-mutation:audit */
           insert into audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
           values ($1, $2, 'task.feature_plan_revision_created', 'project_task_feature_plan', $3::uuid, $4::jsonb)`,
          [workspace, auth.userId, inserted.rows[0].id, JSON.stringify({
            taskId, projectId, planId: planKey, revision, planFingerprint: featurePlanFingerprint(final.plan), taskCount: final.plan.tasks.length,
          })],
        );
        return freeze({ status: "created" as const, revision: freeze({ taskId, projectId, planId: planKey, revision }) });
      });
    } catch (error) {
      if (error instanceof Conflict) return outcome("conflict");
      if (error instanceof NotPlannable) return outcome("not_plannable");
      return outcome("unavailable");
    }
  }

  return Object.freeze({ saveDraftRevision });
}
