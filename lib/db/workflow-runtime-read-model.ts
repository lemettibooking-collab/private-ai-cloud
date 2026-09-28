import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { WorkflowRunStatus } from "../contracts/workflow-run";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData, freezeModelProviderAdapterData, snapshotModelProviderAdapterInput } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeWorkflowRunSnapshot } from "../contracts/workflow-run.ts";

export const workflowRuntimeReadModelLimits = Object.freeze({
  defaultLimit: 25,
  maxLimit: 100,
});

export type WorkflowRuntimeReadDecision<T> = Readonly<{
  verdict: "allow" | "deny";
  reason: "invalid_input" | "not_found" | "inconsistent_state" | "read_failed" | null;
  data: T | null;
}>;

export type WorkflowRuntimeModelUsage = Readonly<{
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
  lastProviderRequestModelId: string | null;
  lastProviderModelVersion: string | null;
}>;

export type WorkflowRuntimeInvocationSummary = Readonly<{
  invocationId: string;
  stepId: string;
  attemptNumber: number;
  status: "running" | "succeeded" | "failed" | "outcome_unknown";
  providerId: string;
  deploymentId: string;
  providerModelId: string;
  providerRequestModelId: string | null;
  providerModelVersion: string;
  providerIdentityVersion: 1 | 2;
  requestFingerprint: string;
  createdAt: string;
  completedAt: string | null;
}>;

export type WorkflowRuntimeApprovalSummary = Readonly<{
  approvalRequestId: string;
  runId: string;
  stepId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  riskLevel: "low" | "medium" | "high" | "critical";
  requestedCapability: string;
  requestedAt: string;
  resolvedAt: string | null;
  requestedByActorId: string;
  resolvedByActorId: string | null;
}>;

export type WorkflowRuntimeRunOverview = Readonly<{
  runId: string;
  projectId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStepIds: readonly string[];
  readyStepIds: readonly string[];
  approval: WorkflowRuntimeApprovalSummary | null;
  latestModelInvocation: WorkflowRuntimeInvocationSummary | null;
  modelUsage: WorkflowRuntimeModelUsage;
}>;

export type WorkflowRuntimeAuditTimelineItem = Readonly<{
  eventType: string;
  actorKind: string;
  actorId: string;
  runId: string;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export type PostgresWorkflowRuntimeReadModelOptions = Readonly<{
  database: WorkflowRuntimeDatabase;
  workspaceDatabaseId: string;
}>;

type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const fingerprintPattern = /^sha256:[0-9a-f]{64}$/u;
const safeTextPattern = /^[^\u0000-\u001f\u007f\r\n]+$/u;
const forbiddenKeys = new Set(["messages", "prompt", "outputText", "structuredOutput", "providerRequest", "preparedRequest", "secret", "credentials", "apiKey"]);
const allowedMetadataKeys = new Set([
  "runId", "projectId", "workflowId", "revision", "invocationId", "stepId",
  "attemptNumber", "runRevision", "requestFingerprint", "providerId", "deploymentId",
  "status", "outcome", "finishReason", "inputTokens", "outputTokens", "totalTokens",
  "latencyMs", "costUsdMicros", "errorCode", "approvalRequestId", "policyFingerprint",
  "requestedCapability", "riskLevel", "decision",
]);

function containsForbiddenKey(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  if (Array.isArray(input)) return input.some(containsForbiddenKey);
  return Object.entries(input as Record<string, unknown>).some(
    ([key, value]) => forbiddenKeys.has(key) || containsForbiddenKey(value),
  );
}

function allow<T>(data: T): WorkflowRuntimeReadDecision<T> {
  return freezeModelProviderAdapterData({ verdict: "allow", reason: null, data: cloneModelProviderAdapterData(data) });
}

function deny<T>(reason: Exclude<WorkflowRuntimeReadDecision<T>["reason"], null>): WorkflowRuntimeReadDecision<T> {
  return freezeModelProviderAdapterData({ verdict: "deny", reason, data: null });
}

function integer(input: unknown): number | null {
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

function boundedLimit(input: number | undefined): number | null {
  const value = input ?? workflowRuntimeReadModelLimits.defaultLimit;
  return Number.isSafeInteger(value) && value >= 1 && value <= workflowRuntimeReadModelLimits.maxLimit
    ? value : null;
}

function safeMetadata(input: unknown): Readonly<Record<string, unknown>> | null {
  const boundary = snapshotModelProviderAdapterInput(input);
  if (!boundary.ok || typeof boundary.value !== "object" || boundary.value === null
    || Array.isArray(boundary.value)) return null;
  const value = boundary.value as Record<string, unknown>;
  if (containsForbiddenKey(value) || Object.keys(value).some((key) => !allowedMetadataKeys.has(key))
    || Object.values(value).some((item) => item !== null
      && !["string", "number", "boolean"].includes(typeof item))) return null;
  return freezeModelProviderAdapterData(cloneModelProviderAdapterData(value));
}

function approval(row: Row, runId: string): WorkflowRuntimeApprovalSummary | null {
  const status = row.status;
  const riskLevel = row.risk_level;
  const requestedAt = timestamp(row.requested_at);
  const resolvedAt = optionalTimestamp(row.resolved_at);
  if (typeof row.runtime_approval_id !== "string" || !stableIdPattern.test(row.runtime_approval_id)
    || typeof row.step_id !== "string" || !stableIdPattern.test(row.step_id)
    || !["pending", "approved", "rejected", "cancelled"].includes(status as string)
    || !["low", "medium", "high", "critical"].includes(riskLevel as string)
    || typeof row.requested_capability !== "string" || !safeTextPattern.test(row.requested_capability)
    || typeof row.requested_by_actor_id !== "string" || !safeTextPattern.test(row.requested_by_actor_id)
    || (row.resolved_by_actor_id !== null && (typeof row.resolved_by_actor_id !== "string"
      || !safeTextPattern.test(row.resolved_by_actor_id)))
    || !requestedAt || resolvedAt === undefined) return null;
  return {
    approvalRequestId: row.runtime_approval_id,
    runId,
    stepId: row.step_id,
    status: status as WorkflowRuntimeApprovalSummary["status"],
    riskLevel: riskLevel as WorkflowRuntimeApprovalSummary["riskLevel"],
    requestedCapability: row.requested_capability,
    requestedAt,
    resolvedAt,
    requestedByActorId: row.requested_by_actor_id,
    resolvedByActorId: row.resolved_by_actor_id as string | null,
  };
}

function invocation(row: Row): WorkflowRuntimeInvocationSummary | null {
  const attemptNumber = integer(row.attempt_number);
  const providerIdentityVersion = integer(row.provider_identity_version);
  const createdAt = timestamp(row.created_at);
  const completedAt = optionalTimestamp(row.completed_at);
  if (typeof row.invocation_id !== "string" || !stableIdPattern.test(row.invocation_id)
    || typeof row.step_id !== "string" || !stableIdPattern.test(row.step_id)
    || attemptNumber === null || attemptNumber < 1
    || !["running", "succeeded", "failed", "outcome_unknown"].includes(row.status as string)
    || ![row.provider_id, row.deployment_id, row.provider_model_id, row.provider_model_version]
      .every((value) => typeof value === "string" && value.length <= 256 && safeTextPattern.test(value))
    || (providerIdentityVersion !== 1 && providerIdentityVersion !== 2)
    || (providerIdentityVersion === 1 && row.provider_request_model_id !== null)
    || (providerIdentityVersion === 2 && (typeof row.provider_request_model_id !== "string"
      || row.provider_request_model_id.length > 256
      || !safeTextPattern.test(row.provider_request_model_id)))
    || typeof row.request_fingerprint !== "string" || !fingerprintPattern.test(row.request_fingerprint)
    || !createdAt || completedAt === undefined) return null;
  return {
    invocationId: row.invocation_id,
    stepId: row.step_id,
    attemptNumber,
    status: row.status as WorkflowRuntimeInvocationSummary["status"],
    providerId: row.provider_id as string,
    deploymentId: row.deployment_id as string,
    providerModelId: row.provider_model_id as string,
    providerRequestModelId: row.provider_request_model_id as string | null,
    providerModelVersion: row.provider_model_version as string,
    providerIdentityVersion,
    requestFingerprint: row.request_fingerprint,
    createdAt,
    completedAt,
  };
}

function usage(row: Row): WorkflowRuntimeModelUsage | null {
  const numbers = ["invocation_count", "succeeded_count", "failed_count", "ambiguous_count",
    "input_tokens", "output_tokens", "total_tokens", "total_cost_usd_micros"] as const;
  const parsed = Object.fromEntries(numbers.map((key) => [key, integer(row[key])])) as Record<typeof numbers[number], number | null>;
  if (Object.values(parsed).some((value) => value === null)) return null;
  for (const value of [row.last_provider_id, row.last_provider_model_id, row.last_provider_request_model_id, row.last_provider_model_version]) {
    if (value !== null && (typeof value !== "string" || value.length > 256 || !safeTextPattern.test(value))) return null;
  }
  return {
    invocationCount: parsed.invocation_count as number,
    succeededCount: parsed.succeeded_count as number,
    failedCount: parsed.failed_count as number,
    ambiguousCount: parsed.ambiguous_count as number,
    inputTokens: parsed.input_tokens as number,
    outputTokens: parsed.output_tokens as number,
    totalTokens: parsed.total_tokens as number,
    totalCostUsdMicros: parsed.total_cost_usd_micros as number,
    lastProviderId: row.last_provider_id as string | null,
    lastProviderModelId: row.last_provider_model_id as string | null,
    lastProviderRequestModelId: row.last_provider_request_model_id as string | null,
    lastProviderModelVersion: row.last_provider_model_version as string | null,
  };
}

export class PostgresWorkflowRuntimeReadModel {
  readonly #database: WorkflowRuntimeDatabase;
  readonly #workspaceDatabaseId: string;

  constructor(options: PostgresWorkflowRuntimeReadModelOptions) {
    if (!options || typeof options.database?.connect !== "function"
      || !uuidPattern.test(options.workspaceDatabaseId)) {
      throw new Error("Workflow runtime read model configuration is invalid.");
    }
    this.#database = options.database;
    this.#workspaceDatabaseId = options.workspaceDatabaseId;
  }

  async #withClient<T>(operation: (client: WorkflowRuntimeSqlClient) => Promise<T>): Promise<T> {
    const client = await this.#database.connect();
    try { return await operation(client); } finally { client.release(); }
  }

  async #usage(client: WorkflowRuntimeSqlClient, runId: string): Promise<WorkflowRuntimeModelUsage | null> {
    const result = await client.query<Row>(
      `/* workflow-runtime-read:model-usage */
       select count(invocation.id)::text as invocation_count,
              count(*) filter (where invocation.status = 'succeeded')::text as succeeded_count,
              count(*) filter (where invocation.status = 'failed')::text as failed_count,
              count(*) filter (where invocation.status = 'outcome_unknown')::text as ambiguous_count,
              count(*) filter (
                where invocation.status = 'succeeded'
                  and execution.status = 'outcome_unknown'
              )::text as inconsistent_execution_count,
              coalesce(sum(invocation.input_tokens), 0)::text as input_tokens,
              coalesce(sum(invocation.output_tokens), 0)::text as output_tokens,
              coalesce(sum(invocation.total_tokens), 0)::text as total_tokens,
              coalesce(sum(invocation.cost_usd_micros), 0)::text as total_cost_usd_micros,
              (array_agg(invocation.provider_id order by invocation.created_at desc))[1] as last_provider_id,
              (array_agg(invocation.provider_model_id order by invocation.created_at desc))[1] as last_provider_model_id,
              (array_agg(invocation.provider_request_model_id order by invocation.created_at desc))[1] as last_provider_request_model_id,
              (array_agg(invocation.provider_model_version order by invocation.created_at desc))[1] as last_provider_model_version
       from workflow_runs as run
       left join workflow_model_invocations as invocation
         on invocation.workflow_run_id = run.id and invocation.workspace_id = run.workspace_id
       left join workflow_runtime_executions as execution
         on execution.id = invocation.workflow_execution_id
        and execution.workspace_id = run.workspace_id and execution.run_id = run.id
       where run.workspace_id = $1 and run.runtime_id = $2`,
      [this.#workspaceDatabaseId, runId],
    );
    const inconsistentExecutionCount = result.rowCount === 1
      ? integer(result.rows[0].inconsistent_execution_count) : null;
    return inconsistentExecutionCount === 0 ? usage(result.rows[0]) : null;
  }

  async getRunOverview(runId: string): Promise<WorkflowRuntimeReadDecision<WorkflowRuntimeRunOverview>> {
    if (!stableIdPattern.test(runId)) return deny("invalid_input");
    try {
      return await this.#withClient(async (client) => {
        const runResult = await client.query<Row>(
          `/* workflow-runtime-read:run-overview */
           select run.project_id, run.workflow_id, run.status, run.revision::text as revision,
                  run.runtime_snapshot, run.created_at, run.started_at,
                  coalesce(run.completed_at, run.failed_at) as completed_at
           from workflow_runs as run
           where run.workspace_id = $1 and run.runtime_id = $2`,
          [this.#workspaceDatabaseId, runId],
        );
        if (runResult.rowCount === 0) return deny<WorkflowRuntimeRunOverview>("not_found");
        if (runResult.rowCount !== 1) return deny<WorkflowRuntimeRunOverview>("inconsistent_state");
        const run = runResult.rows[0];
        const snapshotDecision = validateAndNormalizeWorkflowRunSnapshot(run.runtime_snapshot);
        const snapshot = snapshotDecision.normalizedSnapshot;
        const revision = integer(run.revision);
        const createdAt = timestamp(run.created_at);
        const startedAt = optionalTimestamp(run.started_at);
        const completedAt = optionalTimestamp(run.completed_at);
        if (snapshotDecision.verdict !== "allow" || !snapshot || snapshot.runId !== runId
          || run.project_id !== snapshot.projectId || run.workflow_id !== snapshot.workflowId
          || run.status !== snapshot.status || revision !== snapshot.revision || !createdAt
          || startedAt === undefined || completedAt === undefined) {
          return deny<WorkflowRuntimeRunOverview>("inconsistent_state");
        }
        const approvalResult = await client.query<Row>(
          `/* workflow-runtime-read:run-approval */
           select approval.runtime_approval_id, approval.step_id, approval.status,
                  approval.risk_level, approval.requested_capability,
                  approval.requested_by_actor_id, approval.resolved_by_actor_id,
                  approval.created_at as requested_at, approval.resolved_at
           from approval_requests as approval
           join workflow_runs as run on run.id = approval.workflow_run_id
           where approval.workspace_id = $1 and run.workspace_id = $1
             and run.runtime_id = $2 and approval.action_type = 'runtime_risk_approval'
           order by approval.created_at desc, approval.id desc limit 1`,
          [this.#workspaceDatabaseId, runId],
        );
        const approvalValue = approvalResult.rowCount === 0 ? null : approval(approvalResult.rows[0], runId);
        if (approvalResult.rowCount > 1 || (approvalResult.rowCount === 1 && !approvalValue)) {
          return deny<WorkflowRuntimeRunOverview>("inconsistent_state");
        }
        const invocationResult = await client.query<Row>(
          `/* workflow-runtime-read:latest-model-invocation */
           select invocation.invocation_id, invocation.step_id, invocation.attempt_number,
                  invocation.status, invocation.provider_id, invocation.deployment_id,
                  invocation.provider_model_id, invocation.provider_request_model_id,
                  invocation.provider_model_version, invocation.provider_identity_version,
                  invocation.request_fingerprint, invocation.created_at,
                  invocation.completed_at, execution.status as execution_status
           from workflow_model_invocations as invocation
           join workflow_runs as run on run.id = invocation.workflow_run_id
           join workflow_runtime_executions as execution
             on execution.id = invocation.workflow_execution_id
           where invocation.workspace_id = $1 and run.workspace_id = $1
             and execution.workspace_id = $1 and run.runtime_id = $2
           order by invocation.created_at desc, invocation.id desc limit 1`,
          [this.#workspaceDatabaseId, runId],
        );
        const latest = invocationResult.rowCount === 0 ? null : invocation(invocationResult.rows[0]);
        if (invocationResult.rowCount > 1 || (invocationResult.rowCount === 1 && !latest)
          || (latest?.status === "succeeded" && invocationResult.rows[0].execution_status === "outcome_unknown")) {
          return deny<WorkflowRuntimeRunOverview>("inconsistent_state");
        }
        const modelUsage = await this.#usage(client, runId);
        if (!modelUsage) return deny<WorkflowRuntimeRunOverview>("inconsistent_state");
        return allow({
          runId,
          projectId: snapshot.projectId,
          workflowId: snapshot.workflowId,
          status: snapshot.status,
          revision: snapshot.revision,
          createdAt,
          startedAt,
          completedAt,
          currentStepIds: snapshot.stepStates.filter(
            (step) => step.status === "running" || step.status === "waiting_approval",
          ).map((step) => step.stepId),
          readyStepIds: snapshot.readyStepIds,
          approval: approvalValue,
          latestModelInvocation: latest,
          modelUsage,
        });
      });
    } catch { return deny("read_failed"); }
  }

  async listApprovalQueue(limit?: number): Promise<WorkflowRuntimeReadDecision<readonly WorkflowRuntimeApprovalSummary[]>> {
    const bounded = boundedLimit(limit);
    if (bounded === null) return deny("invalid_input");
    try {
      return await this.#withClient(async (client) => {
        const result = await client.query<Row>(
          `/* workflow-runtime-read:approval-queue */
           select approval.runtime_approval_id, run.runtime_id, approval.step_id,
                  approval.status, approval.risk_level, approval.requested_capability,
                  approval.requested_by_actor_id, approval.resolved_by_actor_id,
                  approval.created_at as requested_at, approval.resolved_at
           from approval_requests as approval
           join workflow_runs as run on run.id = approval.workflow_run_id
           where approval.workspace_id = $1 and run.workspace_id = $1
             and approval.action_type = 'runtime_risk_approval'
             and approval.status = 'pending'
           order by case approval.risk_level when 'critical' then 0 when 'high' then 1
                    when 'medium' then 2 else 3 end,
                    approval.created_at, approval.id
           limit $2`,
          [this.#workspaceDatabaseId, bounded],
        );
        if (result.rowCount > bounded) return deny<readonly WorkflowRuntimeApprovalSummary[]>("inconsistent_state");
        const values = result.rows.map((row) => typeof row.runtime_id === "string"
          ? approval(row, row.runtime_id) : null);
        return values.every((value): value is WorkflowRuntimeApprovalSummary => value !== null)
          ? allow(values) : deny("inconsistent_state");
      });
    } catch { return deny("read_failed"); }
  }

  async getRunAuditTimeline(runId: string, limit?: number): Promise<WorkflowRuntimeReadDecision<readonly WorkflowRuntimeAuditTimelineItem[]>> {
    const bounded = boundedLimit(limit);
    if (!stableIdPattern.test(runId) || bounded === null) return deny("invalid_input");
    try {
      return await this.#withClient(async (client) => {
        const result = await client.query<Row>(
          `/* workflow-runtime-read:audit-timeline */
           select audit.event_type, audit.actor_kind, audit.actor_id,
                  audit.runtime_run_id, audit.metadata, audit.created_at
           from audit_events as audit
           where audit.workspace_id = $1 and audit.runtime_run_id = $2
             and audit.runtime_event_key is not null
           order by audit.created_at desc, audit.id desc limit $3`,
          [this.#workspaceDatabaseId, runId, bounded],
        );
        if (result.rowCount > bounded) return deny<readonly WorkflowRuntimeAuditTimelineItem[]>("inconsistent_state");
        const values: WorkflowRuntimeAuditTimelineItem[] = [];
        for (const row of result.rows) {
          const metadata = safeMetadata(row.metadata);
          const createdAt = timestamp(row.created_at);
          if (typeof row.event_type !== "string" || !safeTextPattern.test(row.event_type)
            || typeof row.actor_kind !== "string" || !safeTextPattern.test(row.actor_kind)
            || typeof row.actor_id !== "string" || !safeTextPattern.test(row.actor_id)
            || row.runtime_run_id !== runId || !metadata || !createdAt) {
            return deny<readonly WorkflowRuntimeAuditTimelineItem[]>("inconsistent_state");
          }
          values.push({ eventType: row.event_type, actorKind: row.actor_kind, actorId: row.actor_id,
            runId, metadata, createdAt });
        }
        return allow(values);
      });
    } catch { return deny("read_failed"); }
  }

  async getRunModelUsage(runId: string): Promise<WorkflowRuntimeReadDecision<WorkflowRuntimeModelUsage>> {
    if (!stableIdPattern.test(runId)) return deny("invalid_input");
    try {
      return await this.#withClient(async (client) => {
        const run = await client.query<Row>(
          `/* workflow-runtime-read:usage-run */
           select id from workflow_runs where workspace_id = $1 and runtime_id = $2`,
          [this.#workspaceDatabaseId, runId],
        );
        if (run.rowCount === 0) return deny<WorkflowRuntimeModelUsage>("not_found");
        if (run.rowCount !== 1) return deny<WorkflowRuntimeModelUsage>("inconsistent_state");
        const value = await this.#usage(client, runId);
        return value ? allow(value) : deny("inconsistent_state");
      });
    } catch { return deny("read_failed"); }
  }
}
