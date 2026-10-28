import { isProxy } from "node:util/types";
import type {
  AuthorizedWorkflowRuntimeAccess,
  WorkflowRuntimeAccessAuthorizer,
  WorkflowRuntimePublicApprovalSummary,
  WorkflowRuntimePublicAuditTimelineItem,
  WorkflowRuntimePublicModelUsage,
  WorkflowRuntimePublicProjectRunSummary,
  WorkflowRuntimePublicProjectSummary,
  WorkflowRuntimePublicRunOverview,
  WorkflowRuntimePublicTaskDetail,
  WorkflowRuntimePublicTaskFeaturePlans,
  WorkflowRuntimePublicTaskSummary,
} from "./workflow-runtime-access";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { PostgresWorkflowRuntimeReadModel, workflowRuntimeReadModelLimits } from "../db/workflow-runtime-read-model.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createAuthorizedWorkflowRuntimeAccess } from "./workflow-runtime-access.ts";

// AI-037.7: tenant-bound application facade for future Owner transport (no HTTP here).
//
//   untrusted request (unknown)
//     → cheap bounded structural gate (Proxy, prototype, exact own data fields, scalar values, limits)
//     → workspace binding (request workspace must equal the bound tenant; mismatch is opaque)
//     → existing authorized access (authorizer + sanitized projections)
//     → Owner read model built HERE from the bound tenant (never supplied by the caller)
//
// A facade is permanently bound to one factual ResolvedWorkflowRuntimeTenant (trusted resolver
// identity). Nothing is delegated, authorized or read until the gate and the workspace check pass.
// Runtime commands are not exposed yet: WorkflowRuntimeService carries no verifiable tenant binding.

export type TenantBoundWorkflowRuntimeDenialStatus = "invalid_input" | "limit_exceeded" | "unavailable";

export type TenantBoundWorkflowRuntimeDecision<T> =
  | Readonly<{ verdict: "allow"; status: "available"; data: T }>
  | Readonly<{ verdict: "deny"; status: TenantBoundWorkflowRuntimeDenialStatus; data: null }>;

export interface TenantBoundWorkflowRuntimeFacade {
  // { workspaceId, actorId, runId }
  getRunOverview(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<WorkflowRuntimePublicRunOverview>>;
  // { workspaceId, actorId, runId, limit? }
  getRunAuditTimeline(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicAuditTimelineItem[]>>;
  // { workspaceId, actorId, runId }
  getRunModelUsage(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<WorkflowRuntimePublicModelUsage>>;
  // { workspaceId, actorId, limit? }
  listApprovalQueue(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicApprovalSummary[]>>;
  // AI-038.3.1 { workspaceId, actorId, limit? }
  listProjects(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicProjectSummary[]>>;
  // AI-038.3.1 { workspaceId, actorId, projectId, limit? } — projectId is an untrusted selector
  // resolved only inside the bound workspace; it never chooses the workspace.
  listProjectRuns(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicProjectRunSummary[]>>;
  // AI-038.4a { workspaceId, actorId, view } — view is a fixed enum with a server-fixed bound.
  listTasks(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicTaskSummary[]>>;
  // AI-038.4a { workspaceId, actorId, projectId, view }
  listProjectTasks(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<readonly WorkflowRuntimePublicTaskSummary[]>>;
  // AI-038.4a { workspaceId, actorId, taskId }
  getTask(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<WorkflowRuntimePublicTaskDetail>>;
  // AI-039 { workspaceId, actorId, taskId }: the FeaturePlan revisions of one ProjectTask.
  getTaskFeaturePlans(request: unknown): Promise<TenantBoundWorkflowRuntimeDecision<WorkflowRuntimePublicTaskFeaturePlans>>;
}

export const tenantBoundWorkflowRuntimeFacadeLimits = Object.freeze({
  maxRequestFields: 4,
  maxIdLength: 64,
  maxActorIdLength: 128,
  minLimit: 1,
  maxLimit: workflowRuntimeReadModelLimits.maxLimit,
});

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const actorIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const constructionFields = Object.freeze(["tenant", "database", "authorizer"] as const);

type Field = "workspaceId" | "actorId" | "runId" | "projectId" | "taskId" | "view" | "limit";
type Request = Readonly<{ workspaceId: string; actorId: string; runId: string | null; projectId: string | null; taskId: string | null; view: string | null; limit: number | undefined }>;

const taskViewPattern = /^(all|current|attention|completed)$/u;
type Gate = Readonly<{ ok: true; request: Request }> | Readonly<{ ok: false; status: "invalid_input" | "limit_exceeded" }>;

function denial<T>(status: TenantBoundWorkflowRuntimeDenialStatus): TenantBoundWorkflowRuntimeDecision<T> {
  return freezeModelProviderAdapterData({ verdict: "deny" as const, status, data: null });
}

function boundedString(value: unknown, maxLength: number, pattern: RegExp): string | "invalid" | "limited" {
  if (typeof value !== "string") return "invalid";
  if (value.length > maxLength) return "limited";
  return pattern.test(value) ? value : "invalid";
}

// Cheap, bounded and trap-free: a Proxy is detected before any trap could run; only own data
// properties are read (getters are never invoked); every value must be a scalar, so nested objects,
// arrays, cycles, Proxies and class instances are rejected without being inspected.
function gate(input: unknown, required: readonly Field[], optional: readonly Field[]): Gate {
  const invalid = { ok: false as const, status: "invalid_input" as const };
  const limited = { ok: false as const, status: "limit_exceeded" as const };
  if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return invalid;
  let keys: (string | symbol)[];
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return invalid;
    keys = Reflect.ownKeys(input);
  } catch {
    return invalid;
  }
  if (keys.length > tenantBoundWorkflowRuntimeFacadeLimits.maxRequestFields) return limited;
  const allowed = new Set<string>([...required, ...optional]);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) return invalid;
  if (!required.every((field) => keys.includes(field))) return invalid;
  const values: Partial<Record<Field, unknown>> = {};
  for (const key of keys as Field[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return invalid;
    values[key] = descriptor.value;
  }
  const workspaceId = boundedString(values.workspaceId, tenantBoundWorkflowRuntimeFacadeLimits.maxIdLength, stableIdPattern);
  const actorId = boundedString(values.actorId, tenantBoundWorkflowRuntimeFacadeLimits.maxActorIdLength, actorIdPattern);
  const runId = required.includes("runId")
    ? boundedString(values.runId, tenantBoundWorkflowRuntimeFacadeLimits.maxIdLength, stableIdPattern)
    : null;
  const projectId = required.includes("projectId")
    ? boundedString(values.projectId, tenantBoundWorkflowRuntimeFacadeLimits.maxIdLength, stableIdPattern)
    : null;
  const taskId = required.includes("taskId")
    ? boundedString(values.taskId, tenantBoundWorkflowRuntimeFacadeLimits.maxIdLength, stableIdPattern)
    : null;
  const view = required.includes("view") ? boundedString(values.view, 16, taskViewPattern) : null;
  if (workspaceId === "limited" || actorId === "limited" || runId === "limited" || projectId === "limited"
    || taskId === "limited" || view === "limited") return limited;
  if (workspaceId === "invalid" || actorId === "invalid" || runId === "invalid" || projectId === "invalid"
    || taskId === "invalid" || view === "invalid") return invalid;
  let limit: number | undefined;
  if (Object.hasOwn(values, "limit")) {
    const value = values.limit;
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)
      || value < tenantBoundWorkflowRuntimeFacadeLimits.minLimit) return invalid;
    if (value > tenantBoundWorkflowRuntimeFacadeLimits.maxLimit) return limited;
    limit = value;
  }
  return { ok: true, request: Object.freeze({ workspaceId, actorId, runId, projectId, taskId, view, limit }) };
}

// Own data members of an ordinary, non-Proxy object only; nothing else is ever read.
function ownDataMembers(input: unknown, required: readonly string[]): Record<string, unknown> | null {
  try {
    if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.some((key) => typeof key !== "string")) return null;
    const members: Record<string, unknown> = {};
    for (const key of required) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      members[key] = descriptor.value;
    }
    return members;
  } catch {
    return null;
  }
}

function configurationError(): Error {
  return new Error("Tenant-bound Workflow runtime facade configuration is invalid.");
}

export function createTenantBoundWorkflowRuntimeFacade(input: unknown): TenantBoundWorkflowRuntimeFacade {
  const config = ownDataMembers(input, constructionFields);
  if (!config || Reflect.ownKeys(input as object).length !== constructionFields.length) throw configurationError();
  const tenant = config.tenant;
  // Trusted resolver identity only: a forged look-alike or a Proxy is never in the resolver's set.
  if (typeof tenant !== "object" || tenant === null || isProxy(tenant) || !isResolvedWorkflowRuntimeTenant(tenant)) {
    throw configurationError();
  }
  // Only the callable values are captured. The caller's dependency objects are NOT retained: the
  // callables are invoked through frozen internal wrappers with no receiver (`this` is undefined),
  // so neither replacing a method nor mutating receiver-owned state after construction can
  // retarget the facade. A dependency that needs its own mutable `this` fails closed.
  const connect = ownDataMembers(config.database, ["connect"])?.connect;
  const authorize = ownDataMembers(config.authorizer, ["authorize"])?.authorize;
  if (typeof connect !== "function" || typeof authorize !== "function") throw configurationError();
  const database: WorkflowRuntimeDatabase = Object.freeze({
    connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]>,
  });
  const authorizer: WorkflowRuntimeAccessAuthorizer = Object.freeze({
    authorize: (request: Parameters<WorkflowRuntimeAccessAuthorizer["authorize"]>[0]) =>
      Reflect.apply(authorize, undefined, [request]) as ReturnType<WorkflowRuntimeAccessAuthorizer["authorize"]>,
  });
  const boundWorkspaceId: string = tenant.workspaceId;
  let access: AuthorizedWorkflowRuntimeAccess;
  try {
    access = createAuthorizedWorkflowRuntimeAccess({
      readModel: new PostgresWorkflowRuntimeReadModel({ database, tenant }),
      authorizer,
      // The existing access factory requires a runtime service; this facade exposes no command
      // path, so the service is a closed stub that is unreachable from the facade's surface.
      runtimeService: Object.freeze({
        execute: async () => { throw new Error("Runtime commands are not exposed by the tenant-bound facade."); },
      }),
    });
  } catch {
    throw configurationError();
  }

  async function guarded<T>(
    requestInput: unknown,
    required: readonly Field[],
    optional: readonly Field[],
    delegate: (context: Readonly<{ actorId: string; workspaceId: string }>, request: Request) => Promise<TenantBoundWorkflowRuntimeDecision<T>>,
  ): Promise<TenantBoundWorkflowRuntimeDecision<T>> {
    const gated = gate(requestInput, required, optional);
    if (!gated.ok) return denial(gated.status);
    // Opaque: a foreign workspace gets exactly what a missing or unauthorized Run gets.
    if (gated.request.workspaceId !== boundWorkspaceId) return denial("unavailable");
    try {
      const context = Object.freeze({ actorId: gated.request.actorId, workspaceId: boundWorkspaceId });
      return await delegate(context, gated.request);
    } catch {
      return denial("unavailable");
    }
  }

  return Object.freeze({
    getRunOverview: (request: unknown) => guarded<WorkflowRuntimePublicRunOverview>(request, ["workspaceId", "actorId", "runId"], [],
      (context, gated) => access.getRunOverview(context, gated.runId)),
    getRunAuditTimeline: (request: unknown) => guarded<readonly WorkflowRuntimePublicAuditTimelineItem[]>(request, ["workspaceId", "actorId", "runId"], ["limit"],
      (context, gated) => access.getRunAuditTimeline(context, gated.runId, gated.limit)),
    getRunModelUsage: (request: unknown) => guarded<WorkflowRuntimePublicModelUsage>(request, ["workspaceId", "actorId", "runId"], [],
      (context, gated) => access.getRunModelUsage(context, gated.runId)),
    listApprovalQueue: (request: unknown) => guarded<readonly WorkflowRuntimePublicApprovalSummary[]>(request, ["workspaceId", "actorId"], ["limit"],
      (context, gated) => access.listApprovalQueue(context, gated.limit)),
    listProjects: (request: unknown) => guarded<readonly WorkflowRuntimePublicProjectSummary[]>(request, ["workspaceId", "actorId"], ["limit"],
      (context, gated) => access.listProjects(context, gated.limit)),
    listProjectRuns: (request: unknown) => guarded<readonly WorkflowRuntimePublicProjectRunSummary[]>(request, ["workspaceId", "actorId", "projectId"], ["limit"],
      (context, gated) => access.listProjectRuns(context, gated.projectId, gated.limit)),
    listTasks: (request: unknown) => guarded<readonly WorkflowRuntimePublicTaskSummary[]>(request, ["workspaceId", "actorId", "view"], [],
      (context, gated) => access.listTasks(context, gated.view)),
    listProjectTasks: (request: unknown) => guarded<readonly WorkflowRuntimePublicTaskSummary[]>(request, ["workspaceId", "actorId", "projectId", "view"], [],
      (context, gated) => access.listProjectTasks(context, gated.projectId, gated.view)),
    getTask: (request: unknown) => guarded<WorkflowRuntimePublicTaskDetail>(request, ["workspaceId", "actorId", "taskId"], [],
      (context, gated) => access.getTask(context, gated.taskId)),
    getTaskFeaturePlans: (request: unknown) => guarded<WorkflowRuntimePublicTaskFeaturePlans>(request, ["workspaceId", "actorId", "taskId"], [],
      (context, gated) => access.getTaskFeaturePlans(context, gated.taskId)),
  });
}
