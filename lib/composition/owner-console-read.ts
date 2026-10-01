import type { AuthenticatedOwnerReadDecision } from "./authenticated-owner-read-runtime";
import type { OwnerReadBackend } from "./owner-read-runtime";

// AI-038.3 Owner Console read seam (pure; no runtime imports). Application code uses
// `./owner-console-read.server`, which binds the real request-scoped Auth.js identity and a
// per-request PostgreSQL pool.
//
//   React Server Component
//     → load*() (this module; read-only, UI-oriented)
//     → withRuntime(trusted domainWorkspaceId) → createRequestOwnerReadRuntime (AI-038.2a/.1/.0)
//     → OwnerReadBackend (the four existing read methods; nothing else)
//
// The workspace is ONLY the trusted server configuration value. Callers supply at most a runId.
// Every result is an explicit allowlist projection: no database, session, identity, actor id,
// fingerprint or raw error ever leaves. Nothing is cached: each call re-authorizes.

export type OwnerConsoleProject = Readonly<{ slug: string; displayName: string }>;

export type OwnerConsoleApproval = Readonly<{
  approvalRequestId: string;
  runId: string;
  stepId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  riskLevel: "low" | "medium" | "high" | "critical";
  requestedCapability: string;
  requestedAt: string;
  resolvedAt: string | null;
}>;

export type OwnerConsoleRunStatus =
  | "queued" | "running" | "waiting_approval" | "review" | "completed" | "failed" | "blocked" | "cancelled";

export type OwnerConsoleRunSummary = Readonly<{
  runId: string;
  projectId: string;
  workflowId: string;
  status: OwnerConsoleRunStatus;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStepIds: readonly string[];
  readyStepIds: readonly string[];
  approval: Readonly<{ status: OwnerConsoleApproval["status"]; riskLevel: OwnerConsoleApproval["riskLevel"]; stepId: string; requestedCapability: string }> | null;
}>;

export type OwnerConsoleUsage = Readonly<{
  invocationCount: number;
  succeededCount: number;
  failedCount: number;
  ambiguousCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsdMicros: number;
  lastProviderId: string | null;
  lastProviderModelId: string | null;
  lastProviderModelVersion: string | null;
}>;

export type OwnerConsoleInvocation = Readonly<{
  invocationId: string;
  stepId: string;
  attemptNumber: number;
  status: "running" | "succeeded" | "failed" | "outcome_unknown";
  providerId: string;
  providerModelId: string;
  providerModelVersion: string;
  createdAt: string;
  completedAt: string | null;
}>;

export type OwnerConsoleAuditItem = Readonly<{ eventType: string; actorKind: string; createdAt: string }>;

export type OwnerConsoleRunDetail = Readonly<{
  run: OwnerConsoleRunSummary;
  latestModelInvocation: OwnerConsoleInvocation | null;
  usage: OwnerConsoleUsage;
  audit: Readonly<{ state: "available"; items: readonly OwnerConsoleAuditItem[]; limit: number }> | Readonly<{ state: "unavailable" }>;
}>;

type Gate<T> =
  | Readonly<{ state: "available"; project: OwnerConsoleProject } & T>
  | Readonly<{ state: "unauthenticated"; project: OwnerConsoleProject | null }>
  | Readonly<{ state: "unavailable"; project: OwnerConsoleProject | null }>;

export type OwnerConsoleAttentionSummary = Gate<{ pendingApprovals: number; highRiskApprovals: number; queueTruncated: boolean }>;

export type OwnerConsoleOverview = Gate<{
  approvals: readonly OwnerConsoleApproval[];
  queueTruncated: boolean;
  pendingApprovals: number;
  highRiskApprovals: number;
  attentionRuns: readonly OwnerConsoleRunSummary[];
  attentionRunsUnavailable: number;
  attentionRunsOmitted: number;
}>;

export type OwnerConsoleRunView = Gate<{ run: Readonly<{ state: "available"; detail: OwnerConsoleRunDetail }> | Readonly<{ state: "unavailable" }> }>;

export type OwnerConsoleDependencies = Readonly<{
  // Trusted server configuration only (e.g. APP_DEMO_WORKSPACE_SLUG). Never request data.
  workspaceSlug: unknown;
  // Opens ONE request-scoped authenticated Owner runtime for the trusted workspace, runs `read`,
  // and releases its resources before returning.
  withRuntime<T>(domainWorkspaceId: string, read: (decision: AuthenticatedOwnerReadDecision) => Promise<T>): Promise<T>;
}>;

export const ownerConsoleLimits = Object.freeze({
  approvalQueueLimit: 100,
  attentionRunLimit: 12,
  auditTimelineLimit: 50,
  maxRunIdLength: 64,
});

const slugPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
// Same stable-id rule the tenant-bound facade applies to runId (it remains the authoritative gate).
const runIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const highRisk = new Set(["high", "critical"]);

function trustedProject(slug: unknown): OwnerConsoleProject | null {
  if (typeof slug !== "string" || !slugPattern.test(slug)) return null;
  const displayName = slug.split(/[-._]+/u).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  return Object.freeze({ slug, displayName });
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const ids = (value: unknown): readonly string[] =>
  Object.freeze(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function approvalView(input: Record<string, unknown>): OwnerConsoleApproval {
  return Object.freeze({
    approvalRequestId: str(input.approvalRequestId),
    runId: str(input.runId),
    stepId: str(input.stepId),
    status: str(input.status) as OwnerConsoleApproval["status"],
    riskLevel: str(input.riskLevel) as OwnerConsoleApproval["riskLevel"],
    requestedCapability: str(input.requestedCapability),
    requestedAt: str(input.requestedAt),
    resolvedAt: strOrNull(input.resolvedAt),
  });
}

function runSummary(input: Record<string, unknown>): OwnerConsoleRunSummary {
  const approval = input.approval as Record<string, unknown> | null | undefined;
  return Object.freeze({
    runId: str(input.runId),
    projectId: str(input.projectId),
    workflowId: str(input.workflowId),
    status: str(input.status) as OwnerConsoleRunStatus,
    revision: num(input.revision),
    createdAt: str(input.createdAt),
    startedAt: strOrNull(input.startedAt),
    completedAt: strOrNull(input.completedAt),
    currentStepIds: ids(input.currentStepIds),
    readyStepIds: ids(input.readyStepIds),
    approval: approval && typeof approval === "object"
      ? Object.freeze({
        status: str(approval.status) as OwnerConsoleApproval["status"],
        riskLevel: str(approval.riskLevel) as OwnerConsoleApproval["riskLevel"],
        stepId: str(approval.stepId),
        requestedCapability: str(approval.requestedCapability),
      })
      : null,
  });
}

function usageView(input: Record<string, unknown> | null | undefined): OwnerConsoleUsage {
  const u = input ?? {};
  return Object.freeze({
    invocationCount: num(u.invocationCount),
    succeededCount: num(u.succeededCount),
    failedCount: num(u.failedCount),
    ambiguousCount: num(u.ambiguousCount),
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    totalTokens: num(u.totalTokens),
    totalCostUsdMicros: num(u.totalCostUsdMicros),
    lastProviderId: strOrNull(u.lastProviderId),
    lastProviderModelId: strOrNull(u.lastProviderModelId),
    lastProviderModelVersion: strOrNull(u.lastProviderModelVersion),
  });
}

function invocationView(input: Record<string, unknown> | null | undefined): OwnerConsoleInvocation | null {
  if (!input || typeof input !== "object") return null;
  return Object.freeze({
    invocationId: str(input.invocationId),
    stepId: str(input.stepId),
    attemptNumber: num(input.attemptNumber),
    status: str(input.status) as OwnerConsoleInvocation["status"],
    providerId: str(input.providerId),
    providerModelId: str(input.providerModelId),
    providerModelVersion: str(input.providerModelVersion),
    createdAt: str(input.createdAt),
    completedAt: strOrNull(input.completedAt),
  });
}

type Reads = Readonly<{ backend: OwnerReadBackend; project: OwnerConsoleProject }>;

export function createOwnerConsoleReader(dependencies: OwnerConsoleDependencies) {
  const project = trustedProject(dependencies.workspaceSlug);
  const withRuntime = dependencies.withRuntime;
  const unavailable = Object.freeze({ state: "unavailable" as const, project });

  // One authenticated, request-scoped composition per call; any failure is the same generic state.
  async function gate<T extends object>(read: (reads: Reads) => Promise<T>): Promise<Gate<T>> {
    if (!project) return unavailable;
    try {
      return await withRuntime(project.slug, async (decision) => {
        if (decision.verdict !== "allow") {
          return decision.reason === "unauthenticated"
            ? Object.freeze({ state: "unauthenticated" as const, project })
            : unavailable;
        }
        const data = await read({ backend: decision.backend, project });
        return Object.freeze({ state: "available" as const, project, ...data });
      });
    } catch {
      return unavailable;
    }
  }

  async function approvalQueue(backend: OwnerReadBackend) {
    const queue = await backend.listApprovalQueue(ownerConsoleLimits.approvalQueueLimit);
    if (queue.verdict !== "allow") throw new Error("unavailable");
    const approvals = Object.freeze(queue.data.map((item) => approvalView(item as unknown as Record<string, unknown>)));
    return {
      approvals,
      queueTruncated: approvals.length >= ownerConsoleLimits.approvalQueueLimit,
      pendingApprovals: approvals.filter((item) => item.status === "pending").length,
      highRiskApprovals: approvals.filter((item) => item.status === "pending" && highRisk.has(item.riskLevel)).length,
    };
  }

  return Object.freeze({
    async loadOwnerAttentionSummary(): Promise<OwnerConsoleAttentionSummary> {
      return gate(async ({ backend }) => {
        const { pendingApprovals, highRiskApprovals, queueTruncated } = await approvalQueue(backend);
        return { pendingApprovals, highRiskApprovals, queueTruncated };
      });
    },

    // The approval queue plus the Runs it references. There is no global run listing in the Owner
    // read surface, so only approval-linked Runs are shown.
    async loadOwnerConsoleOverview(): Promise<OwnerConsoleOverview> {
      return gate(async ({ backend }) => {
        const queue = await approvalQueue(backend);
        const runIds = [...new Set(queue.approvals.map((item) => item.runId).filter((id) => runIdPattern.test(id)))];
        const selected = runIds.slice(0, ownerConsoleLimits.attentionRunLimit);
        const overviews = await Promise.all(selected.map((runId) => backend.getRunOverview(runId)));
        const attentionRuns = Object.freeze(overviews
          .filter((item) => item.verdict === "allow")
          .map((item) => runSummary(item.data as unknown as Record<string, unknown>)));
        return {
          ...queue,
          attentionRuns,
          attentionRunsUnavailable: selected.length - attentionRuns.length,
          attentionRunsOmitted: runIds.length - selected.length,
        };
      });
    },

    // Run Detail. The ONLY runtime target is `runId`; every denial (malformed id, missing Run, other
    // tenant, authorization failure) is the same opaque `run: { state: "unavailable" }`.
    async loadOwnerRun(runId: unknown): Promise<OwnerConsoleRunView> {
      return gate(async ({ backend }) => {
        if (typeof runId !== "string" || runId.length > ownerConsoleLimits.maxRunIdLength || !runIdPattern.test(runId)) {
          return { run: Object.freeze({ state: "unavailable" as const }) };
        }
        let overview;
        try {
          overview = await backend.getRunOverview(runId);
        } catch {
          overview = null;
        }
        if (!overview || overview.verdict !== "allow") return { run: Object.freeze({ state: "unavailable" as const }) };
        const data = overview.data as unknown as Record<string, unknown>;
        let audit: OwnerConsoleRunDetail["audit"] = Object.freeze({ state: "unavailable" as const });
        try {
          const timeline = await backend.getRunAuditTimeline(runId, ownerConsoleLimits.auditTimelineLimit);
          if (timeline.verdict === "allow") {
            audit = Object.freeze({
              state: "available" as const,
              limit: ownerConsoleLimits.auditTimelineLimit,
              items: Object.freeze(timeline.data.map((item) => Object.freeze({
                eventType: str(item.eventType), actorKind: str(item.actorKind), createdAt: str(item.createdAt),
              }))),
            });
          }
        } catch {
          // audit stays unavailable
        }
        let usage = usageView(data.modelUsage as Record<string, unknown>);
        try {
          const fresh = await backend.getRunModelUsage(runId);
          if (fresh.verdict === "allow") usage = usageView(fresh.data as unknown as Record<string, unknown>);
        } catch {
          // keep the overview's usage
        }
        return {
          run: Object.freeze({
            state: "available" as const,
            detail: Object.freeze({
              run: runSummary(data),
              latestModelInvocation: invocationView(data.latestModelInvocation as Record<string, unknown>),
              usage,
              audit,
            }),
          }),
        };
      });
    },
  });
}

export type OwnerConsoleReader = ReturnType<typeof createOwnerConsoleReader>;
