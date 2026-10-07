import { isProxy } from "node:util/types";
import type {
  WorkflowRuntimeAccessAction,
  WorkflowRuntimeAccessAuthorizationDecision,
  WorkflowRuntimeAccessAuthorizationInput,
  WorkflowRuntimePublicApprovalSummary,
  WorkflowRuntimePublicAuditTimelineItem,
  WorkflowRuntimePublicModelUsage,
  WorkflowRuntimePublicProjectRunSummary,
  WorkflowRuntimePublicProjectSummary,
  WorkflowRuntimePublicRunOverview,
  WorkflowRuntimePublicTaskDetail,
  WorkflowRuntimePublicTaskFeaturePlans,
  WorkflowRuntimePublicTaskSummary,
} from "../workflows/workflow-runtime-access";
import type {
  TenantBoundWorkflowRuntimeDecision,
  TenantBoundWorkflowRuntimeFacade,
} from "../workflows/workflow-runtime-tenant-facade";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver, isResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createTenantBoundWorkflowRuntimeFacade } from "../workflows/workflow-runtime-tenant-facade.ts";

// AI-038.0 Owner Read Backend Bundle (M3). Server-only composition of the Owner's read path:
//
//   trusted server configuration { database, domainWorkspaceId, ownerActorId }
//     → tenant resolved ONCE by the existing trusted resolver
//     → internal read-only Owner authorizer (configured principal, bound workspace, fixed read actions)
//     → AI-037.7 tenant-bound facade (the canonical untrusted-input gate)
//     → authorized access → read model → PostgreSQL
//
// The public surface takes only runId / projectId / taskId / view / limit. Workspace and Owner identity are fixed at
// composition and can never be supplied, overridden or retargeted by a caller. `ownerActorId` is a
// trusted server-configured principal, NOT an authenticated session: this module implements no
// authentication. Application code must import `./owner-read-runtime.server` (guarded by
// `server-only`), never this file.

export const ownerReadActions = Object.freeze([
  "read_run_overview",
  "read_run_audit_timeline",
  "read_run_model_usage",
  "list_approval_queue",
  // AI-038.3.1: tenant-scoped project discovery (read-only).
  "list_projects",
  "list_project_runs",
  // AI-038.4a: ProjectTask reads (read-only).
  "list_tasks",
  "list_project_tasks",
  "read_task",
  // AI-039: FeaturePlan revisions of a ProjectTask (read-only).
  "read_task_feature_plans",
] as const satisfies readonly WorkflowRuntimeAccessAction[]);

export interface OwnerReadBackend {
  getRunOverview(runId: unknown): Promise<TenantBoundWorkflowRuntimeDecision<WorkflowRuntimePublicRunOverview>>;
  getRunAuditTimeline(runId: unknown, limit?: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicAuditTimelineItem[]>>;
  getRunModelUsage(runId: unknown): Promise<TenantBoundWorkflowRuntimeDecision<WorkflowRuntimePublicModelUsage>>;
  listApprovalQueue(limit?: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicApprovalSummary[]>>;
  // AI-038.3.1: projects registered in the bound workspace (archived excluded).
  listProjects(limit?: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicProjectSummary[]>>;
  // AI-038.3.1: runtime runs of one registered project of the bound workspace. `projectId` is an
  // untrusted resource selector; it never selects the workspace, actor or role.
  listRuns(projectId: unknown, limit?: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicProjectRunSummary[]>>;
  // AI-038.4a: ProjectTasks of the bound workspace for a fixed view ("all" | "current" |
  // "attention" | "completed"), each with a server-fixed bound (≤ 100).
  listTasks(view: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicTaskSummary[]>>;
  // AI-038.4a: ProjectTasks of ONE registered project; `projectId` is an untrusted selector.
  listProjectTasks(projectId: unknown, view: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicTaskSummary[]>>;
  // AI-038.4a: one ProjectTask by its stable Task ID with its linked runs.
  getTask(taskId: unknown): Promise<TenantBoundWorkflowRuntimeDecision<WorkflowRuntimePublicTaskDetail>>;
  // AI-039: the persisted FeaturePlan revisions of one ProjectTask by its stable Task ID.
  getTaskFeaturePlans(taskId: unknown): Promise<TenantBoundWorkflowRuntimeDecision<WorkflowRuntimePublicTaskFeaturePlans>>;
}

export type OwnerReadRuntimeDecision =
  | Readonly<{ verdict: "allow"; reason: null; backend: OwnerReadBackend }>
  | Readonly<{ verdict: "deny"; reason: "invalid_configuration" | "workspace_unavailable"; backend: null }>;

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
// The existing actor identifier rule of the authorized access layer.
const actorIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const configurationFields = Object.freeze(["database", "domainWorkspaceId", "ownerActorId"] as const);

function deny(reason: "invalid_configuration" | "workspace_unavailable"): OwnerReadRuntimeDecision {
  return freezeModelProviderAdapterData({ verdict: "deny" as const, reason, backend: null });
}

function unavailable<T>(): TenantBoundWorkflowRuntimeDecision<T> {
  return freezeModelProviderAdapterData({ verdict: "deny" as const, status: "unavailable" as const, data: null });
}

// Own data members of an ordinary non-Proxy object with exactly `fields`; getters never run.
function exactOwnData(input: unknown, fields: readonly string[]): Record<string, unknown> | null {
  try {
    if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) return null;
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      values[field] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function capturedConnect(input: unknown): WorkflowRuntimeDatabase["connect"] | null {
  try {
    if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(input, "connect");
    return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function"
      ? descriptor.value as WorkflowRuntimeDatabase["connect"]
      : null;
  } catch {
    return null;
  }
}

// Read-only Owner policy: allow only the configured principal, only in the bound workspace, only
// for the fixed read actions (AI-038.0 runs/approvals, AI-038.3.1 projects, AI-038.4a tasks, AI-039 plans). execute_runtime_command,
// unknown actions and anything malformed deny.
export function createOwnerReadAuthorizer(ownerActorId: string, workspaceId: string) {
  const owner = ownerActorId;
  const workspace = workspaceId;
  const allowed = new Set<string>(ownerReadActions);
  return Object.freeze({
    authorize(input: WorkflowRuntimeAccessAuthorizationInput): WorkflowRuntimeAccessAuthorizationDecision {
      try {
        const verdict = typeof input === "object" && input !== null && !isProxy(input)
          && allowed.has(input.action) && input.actorId === owner && input.workspaceId === workspace
          ? "allow" as const
          : "deny" as const;
        return Object.freeze({ verdict });
      } catch {
        return Object.freeze({ verdict: "deny" as const });
      }
    },
  });
}

// Receiver-free, frozen: the caller's database object is not retained (AI-037.7 corrective #1).
function receiverFreeDatabase(input: unknown): WorkflowRuntimeDatabase | null {
  const connect = capturedConnect(input);
  if (!connect) return null;
  return Object.freeze({
    connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]>,
  });
}

// The one backend builder shared by both compositions: a factual resolved tenant and a fixed
// principal in, the read-only OwnerReadBackend out.
function buildOwnerReadBackend(
  database: WorkflowRuntimeDatabase,
  tenant: ResolvedWorkflowRuntimeTenant,
  ownerActorId: string,
): OwnerReadRuntimeDecision {
  let facade: TenantBoundWorkflowRuntimeFacade;
  const workspaceId = tenant.workspaceId;
  try {
    facade = createTenantBoundWorkflowRuntimeFacade({
      tenant,
      database,
      authorizer: createOwnerReadAuthorizer(ownerActorId, workspaceId),
    });
  } catch {
    return deny("workspace_unavailable");
  }

  // Only the fixed identities and the caller's scalar are placed in the facade request; the facade
  // stays the canonical structural gate for runId / limit (Proxy, type, pattern, bounds).
  const request = (fields: Readonly<{ runId?: unknown; projectId?: unknown; taskId?: unknown; view?: unknown; limit?: unknown }>, withLimit: boolean) => {
    const envelope: Record<string, unknown> = { workspaceId, actorId: ownerActorId };
    if (Object.hasOwn(fields, "runId")) envelope.runId = fields.runId;
    if (Object.hasOwn(fields, "projectId")) envelope.projectId = fields.projectId;
    if (Object.hasOwn(fields, "taskId")) envelope.taskId = fields.taskId;
    if (Object.hasOwn(fields, "view")) envelope.view = fields.view;
    if (withLimit && fields.limit !== undefined) envelope.limit = fields.limit;
    return envelope;
  };
  async function guarded<T>(read: () => Promise<TenantBoundWorkflowRuntimeDecision<T>>): Promise<TenantBoundWorkflowRuntimeDecision<T>> {
    try {
      return await read();
    } catch {
      return unavailable<T>();
    }
  }

  const backend: OwnerReadBackend = Object.freeze({
    getRunOverview: (runId: unknown) => guarded(() => facade.getRunOverview(request({ runId }, false))),
    getRunAuditTimeline: (runId: unknown, limit?: unknown) =>
      guarded(() => facade.getRunAuditTimeline(request({ runId, limit }, true))),
    getRunModelUsage: (runId: unknown) => guarded(() => facade.getRunModelUsage(request({ runId }, false))),
    listApprovalQueue: (limit?: unknown) => guarded(() => facade.listApprovalQueue(request({ limit }, true))),
    listProjects: (limit?: unknown) => guarded(() => facade.listProjects(request({ limit }, true))),
    listRuns: (projectId: unknown, limit?: unknown) => guarded(() => facade.listProjectRuns(request({ projectId, limit }, true))),
    listTasks: (view: unknown) => guarded(() => facade.listTasks(request({ view }, false))),
    listProjectTasks: (projectId: unknown, view: unknown) => guarded(() => facade.listProjectTasks(request({ projectId, view }, false))),
    getTask: (taskId: unknown) => guarded(() => facade.getTask(request({ taskId }, false))),
    getTaskFeaturePlans: (taskId: unknown) => guarded(() => facade.getTaskFeaturePlans(request({ taskId }, false))),
  });
  return Object.freeze({ verdict: "allow" as const, reason: null, backend });
}

export async function createOwnerReadRuntime(input: unknown): Promise<OwnerReadRuntimeDecision> {
  if (typeof window !== "undefined") return deny("invalid_configuration");
  const config = exactOwnData(input, configurationFields);
  if (!config) return deny("invalid_configuration");
  const domainWorkspaceId = config.domainWorkspaceId;
  const ownerActorId = config.ownerActorId;
  if (typeof domainWorkspaceId !== "string" || !stableIdPattern.test(domainWorkspaceId)
    || typeof ownerActorId !== "string" || !actorIdPattern.test(ownerActorId)) {
    return deny("invalid_configuration");
  }
  const database = receiverFreeDatabase(config.database);
  if (!database) return deny("invalid_configuration");
  try {
    // Resolved once; missing or inactive workspaces and resolver failures all yield null.
    const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(domainWorkspaceId);
    if (!tenant) return deny("workspace_unavailable");
    return buildOwnerReadBackend(database, tenant, ownerActorId);
  } catch {
    return deny("workspace_unavailable");
  }
}

// AI-038.1: narrow internal extension for a composition that has ALREADY resolved the tenant and
// verified the principal (the authenticated Owner composition), so the tenant is resolved once and
// the membership check and the backend bind the same factual tenant object. Accepts only a genuine
// resolved tenant (trusted resolver identity). Not exported from the application entry.
export function createOwnerReadRuntimeForTenant(input: unknown): OwnerReadRuntimeDecision {
  if (typeof window !== "undefined") return deny("invalid_configuration");
  const config = exactOwnData(input, ["database", "tenant", "ownerActorId"]);
  if (!config) return deny("invalid_configuration");
  const tenant = config.tenant;
  const ownerActorId = config.ownerActorId;
  if (typeof tenant !== "object" || tenant === null || isProxy(tenant) || !isResolvedWorkflowRuntimeTenant(tenant)
    || typeof ownerActorId !== "string" || !actorIdPattern.test(ownerActorId)) {
    return deny("invalid_configuration");
  }
  const database = receiverFreeDatabase(config.database);
  if (!database) return deny("invalid_configuration");
  return buildOwnerReadBackend(database, tenant, ownerActorId);
}
