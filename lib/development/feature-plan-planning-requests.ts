import { randomBytes } from "node:crypto";
import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant";
import type { AuthenticatedIdentitySource } from "../composition/authenticated-owner-read-runtime";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver, isResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { Conflict, Unavailable, capturedMethod, exactOwnData, inTransaction, lockOwnerAuthority, resolveUserId } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isTaskKey } from "../tasks/project-task.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { NotPlannable, lockTask } from "./feature-plan-mutations.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { planningKeyPattern } from "./feature-plan-planning-run.ts";

// AI-039.1 planning REQUEST contract — the only writer of project_task_planning_requests.
//
// Records the Owner's explicit request for ONE AI FeaturePlan candidate BEFORE any runtime work, and
// its single settlement AFTER. It never calls a provider, never creates the Run itself (the runtime's
// own lifecycle does), never changes the ProjectTask and never creates a FeaturePlan revision.
//
//   begin (one transaction):
//     Owner authority FOR SHARE → ProjectTask FOR UPDATE + project FOR SHARE (the AI-039 plannability
//     rule: draft task, active project) → idempotency: same key + same request fingerprint → replay
//     (never a second dispatch); same key + anything else → conflict → insert `started` with a
//     server-generated planning key (= the planning Run id) → exactly ONE audit event.
//   settle (one transaction): `started` row FOR UPDATE → settled once with the runtime outcome →
//     exactly ONE audit event. A row left `started` (crash, ambiguous settle) replays as
//     recovery_required: it is never re-executed.
//
// The browser never supplies the workspace, user, project, planning key or run id. Outcomes are
// public statuses only; no SQL, UUID, fingerprint or raw error leaves.

export type PlanningRequestOutcome = "completed" | "budget_denied" | "provider_unavailable" | "planning_failed" | "recovery_required";

export const planningRequestOutcomes: readonly PlanningRequestOutcome[] = Object.freeze(["completed", "budget_denied", "provider_unavailable", "planning_failed", "recovery_required"]);

export type PlanningRequestSettlement = Readonly<{ outcome: PlanningRequestOutcome; outputFingerprint: string | null }>;

export type BegunPlanningRequest = Readonly<{
  status: "started" | "replayed";
  planningKey: string;
  projectId: string;
  ownerUserId: string;
  // null while `started` (in flight, crashed or ambiguously settled); set once settled.
  settlement: PlanningRequestSettlement | null;
  settle(settlement: PlanningRequestSettlement): Promise<"settled" | "unavailable">;
}>;

export type BeginPlanningRequestResult =
  | BegunPlanningRequest
  | Readonly<{ status: "invalid_input" | "conflict" | "not_plannable" | "unavailable" | "unauthenticated" }>;

export interface FeaturePlanPlanningRequests {
  begin(input: unknown): Promise<BeginPlanningRequestResult>;
}

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
export const planningIdempotencyKeyPattern = /^pl-[0-9a-f]{32}$/u;
const fingerprintPattern = /^sha256:[0-9a-f]{64}$/u;
const beginFields = ["idempotencyKey", "taskId", "requestFingerprint", "providerId", "providerModelId"] as const;
const boundedText = (input: unknown): input is string => typeof input === "string" && input.length >= 1 && input.length <= 256;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const outcome = <S extends string>(status: S) => freeze({ status });

// 80 bits of CSPRNG entropy; the planning key is also the planning Run's runtime id.
export function newPlanningKey(): string {
  return `fpp-${randomBytes(10).toString("hex")}`;
}

// A fresh opaque key for ONE rendered Planning Interview form (hidden field).
export function newPlanningFormKey(): string {
  return `pl-${randomBytes(16).toString("hex")}`;
}

function validSettlement(input: PlanningRequestSettlement): boolean {
  const fields = exactOwnData(input, ["outcome", "outputFingerprint"]);
  return Boolean(fields) && planningRequestOutcomes.includes(fields!.outcome as PlanningRequestOutcome)
    && (fields!.outcome === "completed"
      ? typeof fields!.outputFingerprint === "string" && fingerprintPattern.test(fields!.outputFingerprint)
      : fields!.outputFingerprint === null);
}

export function createFeaturePlanPlanningRequests(input: unknown): FeaturePlanPlanningRequests {
  const config = exactOwnData(input, ["database", "domainWorkspaceId", "identitySource"]);
  const connect = config ? capturedMethod(config.database, "connect") : null;
  const resolve = config ? capturedMethod(config.identitySource as AuthenticatedIdentitySource, "resolve") : null;
  const domainWorkspaceId = config?.domainWorkspaceId;
  if (!config || !connect || !resolve || typeof domainWorkspaceId !== "string" || !stableIdPattern.test(domainWorkspaceId)) {
    throw new Error("Planning request configuration is invalid.");
  }
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

  function settler(tenant: ResolvedWorkflowRuntimeTenant, userId: string, taskId: string, projectId: string, planningKey: string) {
    let settled = false;
    return async (settlement: PlanningRequestSettlement): Promise<"settled" | "unavailable"> => {
      if (settled || !validSettlement(settlement)) return "unavailable";
      settled = true;
      const workspace = tenant.workspaceDatabaseId;
      try {
        return await inTransaction(database, async (client: WorkflowRuntimeSqlClient) => {
          const row = await client.query<{ id: string; status: string; task_key: string }>(
            `/* planning-request:settle-lock */
             select id::text as id, status, task_key from project_task_planning_requests
             where workspace_id = $1 and planning_key = $2 for update`,
            [workspace, planningKey],
          );
          if (row.rowCount !== 1 || row.rows[0].status !== "started" || row.rows[0].task_key !== taskId) throw new Unavailable();
          const updated = await client.query(
            `/* planning-request:settle */
             update project_task_planning_requests
             set status = 'settled', outcome = $3, output_fingerprint = $4, settled_at = now()
             where workspace_id = $1 and planning_key = $2 and status = 'started'`,
            [workspace, planningKey, settlement.outcome, settlement.outputFingerprint],
          );
          if (updated.rowCount !== 1) throw new Unavailable();
          await client.query(
            `/* planning-request:settle-audit */
             insert into audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
             values ($1, $2, 'task.feature_plan_planning_settled', 'project_task_planning_request', $3::uuid, $4::jsonb)`,
            [workspace, userId, row.rows[0].id, JSON.stringify({
              taskId, projectId, planningKey, runId: planningKey, outcome: settlement.outcome, outputFingerprint: settlement.outputFingerprint,
            })],
          );
          return "settled" as const;
        });
      } catch {
        return "unavailable";
      }
    };
  }

  async function begin(raw: unknown): Promise<BeginPlanningRequestResult> {
    const fields = exactOwnData(raw, beginFields);
    if (!fields) return outcome("invalid_input");
    const { idempotencyKey, taskId, requestFingerprint, providerId, providerModelId } = fields;
    if (typeof idempotencyKey !== "string" || !planningIdempotencyKeyPattern.test(idempotencyKey) || !isTaskKey(taskId)
      || typeof requestFingerprint !== "string" || !fingerprintPattern.test(requestFingerprint)
      || !boundedText(providerId) || !boundedText(providerModelId)) return outcome("invalid_input");
    const auth = await authenticate();
    if (auth === "unauthenticated" || auth === "unavailable") return outcome(auth);
    const workspace = auth.tenant.workspaceDatabaseId;
    try {
      const begun = await inTransaction(database, async (client: WorkflowRuntimeSqlClient) => {
        await lockOwnerAuthority(client, auth.tenant, auth.userId);
        const { projectId } = await lockTask(client, auth.tenant, taskId as string);

        const replay = async () => {
          const existing = await client.query<{ task_key: string; planning_key: string; request_fingerprint: string; status: string; outcome: string | null; output_fingerprint: string | null }>(
            `/* planning-request:replay */
             select task_key, planning_key, request_fingerprint, status, outcome, output_fingerprint
             from project_task_planning_requests where workspace_id = $1 and idempotency_key = $2`,
            [workspace, idempotencyKey],
          );
          if (existing.rowCount === 0) return null;
          const row = existing.rows[0];
          if (existing.rowCount !== 1 || row.task_key !== taskId || row.request_fingerprint !== requestFingerprint) throw new Conflict();
          if (!planningKeyPattern.test(row.planning_key)) throw new Unavailable();
          const settlement = row.status === "settled" ? freeze({ outcome: row.outcome as PlanningRequestOutcome, outputFingerprint: row.output_fingerprint }) : null;
          if (settlement && !validSettlement(settlement)) throw new Unavailable();
          return freeze({ status: "replayed" as const, planningKey: row.planning_key, projectId, settlement });
        };
        const replayed = await replay();
        if (replayed) return replayed;

        const planningKey = newPlanningKey();
        const inserted = await client.query<{ id: string }>(
          `/* planning-request:insert */
           insert into project_task_planning_requests (workspace_id, project_key, task_key, planning_key, run_id, idempotency_key,
                                                      request_fingerprint, provider_id, provider_model_id, requested_by, status)
           values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, 'started')
           on conflict (workspace_id, idempotency_key) do nothing
           returning id::text`,
          [workspace, projectId, taskId, planningKey, idempotencyKey, requestFingerprint, providerId, providerModelId, auth.userId],
        );
        if (inserted.rowCount !== 1) {
          // The key was taken by a request for another task between the lookup and the insert.
          const late = await replay();
          if (late) return late;
          throw new Unavailable();
        }
        await client.query(
          `/* planning-request:audit */
           insert into audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata)
           values ($1, $2, 'task.feature_plan_planning_started', 'project_task_planning_request', $3::uuid, $4::jsonb)`,
          [workspace, auth.userId, inserted.rows[0].id, JSON.stringify({
            taskId, projectId, planningKey, runId: planningKey, providerId, providerModelId, requestFingerprint, egressApprovedByOwner: true,
          })],
        );
        return freeze({ status: "started" as const, planningKey, projectId, settlement: null });
      });
      return freeze({
        ...begun,
        ownerUserId: auth.userId,
        settle: begun.status === "started"
          ? settler(auth.tenant, auth.userId, taskId as string, begun.projectId, begun.planningKey)
          : async () => "unavailable" as const,
      });
    } catch (error) {
      if (error instanceof Conflict) return outcome("conflict");
      if (error instanceof NotPlannable) return outcome("not_plannable");
      return outcome("unavailable");
    }
  }

  return Object.freeze({ begin });
}
