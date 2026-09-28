import type {
  PostgresWorkflowRuntimeReadModel,
  WorkflowRuntimeApprovalSummary,
  WorkflowRuntimeAuditTimelineItem,
  WorkflowRuntimeInvocationSummary,
  WorkflowRuntimeModelUsage,
  WorkflowRuntimeReadDecision,
  WorkflowRuntimeRunOverview,
} from "../db/workflow-runtime-read-model";
import type {
  WorkflowRuntimeCommand,
  WorkflowRuntimeResponse,
  WorkflowRuntimeService,
} from "./workflow-runtime-service";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData, freezeModelProviderAdapterData, snapshotModelProviderAdapterInput } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { normalizeWorkflowRuntimeCommand } from "./workflow-runtime-service.ts";

export const workflowRuntimeAccessActions = Object.freeze([
  "execute_runtime_command",
  "read_run_overview",
  "read_run_audit_timeline",
  "read_run_model_usage",
  "list_approval_queue",
] as const);

export type WorkflowRuntimeAccessAction = typeof workflowRuntimeAccessActions[number];

export type WorkflowRuntimeAccessContext = Readonly<{
  actorId: string;
  workspaceId: string;
}>;

export type WorkflowRuntimeAccessAuthorizationInput = Readonly<{
  action: WorkflowRuntimeAccessAction;
  actorId: string;
  workspaceId: string;
  runId: string | null;
}>;

export type WorkflowRuntimeAccessAuthorizationDecision = Readonly<{
  verdict: "allow" | "deny";
}>;

export type WorkflowRuntimePublicReasonCode =
  | "invalid_command"
  | "state_store_failed"
  | "runtime_internal_error"
  | "invalid_runtime_state"
  | "stale_revision"
  | "idempotency_conflict"
  | "command_in_progress"
  | "command_recovery_required"
  | "claim_conflict"
  | "execution_recovery_required"
  | "state_conflict"
  | "invalid_transition"
  | "agent_input_missing"
  | "agent_runtime_denied"
  | "agent_result_mismatch"
  | "approval_mismatch"
  | "terminal_run"
  | "no_progress"
  | "runtime_limit";

export type WorkflowRuntimePublicReason = Readonly<{
  code: WorkflowRuntimePublicReasonCode;
}>;

export type WorkflowRuntimePublicWaitingApproval = Readonly<{
  kind: "workflow_gate" | "runtime_risk";
  stepId: string;
  approvalRequestId: string | null;
}>;

export type WorkflowRuntimePublicRetryPending = Readonly<{
  stepId: string;
  attemptCount: number;
  errorCode: string;
}>;

export type WorkflowRuntimePublicLastStepResult = Readonly<{
  stepId: string;
  outcome: "succeeded" | "failed";
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
  providerId: string;
  providerModelId: string;
  providerRequestModelId: string | null;
  providerModelVersion: string;
  usage: Readonly<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  latencyMs: number;
  costUsdMicros: number;
}>;

export type WorkflowRuntimePublicCommandResponse = Readonly<{
  verdict: "allow" | "deny" | "idempotent";
  status:
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "waiting_approval"
    | "approval_required"
    | "retry_pending"
    | "unsupported_runtime"
    | "recovery_required"
    | "no_progress"
    | "conflict"
    | "denied";
  reasons: readonly WorkflowRuntimePublicReason[];
  runId: string | null;
  revision: number | null;
  workflowStatus:
    | "queued"
    | "running"
    | "waiting_approval"
    | "review"
    | "completed"
    | "failed"
    | "blocked"
    | "cancelled"
    | null;
  currentStepIds: readonly string[];
  readyStepIds: readonly string[];
  waitingApproval: WorkflowRuntimePublicWaitingApproval | null;
  retryPending: WorkflowRuntimePublicRetryPending | null;
  lastStepResult: WorkflowRuntimePublicLastStepResult | null;
}>;

export type WorkflowRuntimePublicModelUsage = Readonly<{
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

export type WorkflowRuntimePublicInvocationSummary = Readonly<{
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

export type WorkflowRuntimePublicApprovalSummary = Readonly<{
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

export type WorkflowRuntimePublicRunOverview = Readonly<{
  runId: string;
  projectId: string;
  workflowId: string;
  status:
    | "queued"
    | "running"
    | "waiting_approval"
    | "review"
    | "completed"
    | "failed"
    | "blocked"
    | "cancelled";
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStepIds: readonly string[];
  readyStepIds: readonly string[];
  approval: WorkflowRuntimePublicApprovalSummary | null;
  latestModelInvocation: WorkflowRuntimePublicInvocationSummary | null;
  modelUsage: WorkflowRuntimePublicModelUsage;
}>;

export type WorkflowRuntimePublicAuditTimelineItem = Readonly<{
  eventType: string;
  actorKind: string;
  actorId: string;
  runId: string;
  createdAt: string;
}>;

export interface WorkflowRuntimeAccessAuthorizer {
  authorize(
    input: WorkflowRuntimeAccessAuthorizationInput,
  ): WorkflowRuntimeAccessAuthorizationDecision | Promise<WorkflowRuntimeAccessAuthorizationDecision>;
}

export type WorkflowRuntimeAccessDecision<T> =
  | Readonly<{ verdict: "allow"; status: "available"; data: T }>
  | Readonly<{ verdict: "deny"; status: "unavailable"; data: null }>;

type RuntimeReadModel = Pick<PostgresWorkflowRuntimeReadModel,
  "getRunOverview" | "getRunAuditTimeline" | "getRunModelUsage" | "listApprovalQueue">;

export type AuthorizedWorkflowRuntimeAccessDependencies = Readonly<{
  runtimeService: Pick<WorkflowRuntimeService, "execute">;
  readModel: RuntimeReadModel;
  authorizer: WorkflowRuntimeAccessAuthorizer;
}>;

export interface AuthorizedWorkflowRuntimeAccess {
  executeCommand(
    context: unknown,
    command: unknown,
  ): Promise<WorkflowRuntimeAccessDecision<WorkflowRuntimePublicCommandResponse>>;
  getRunOverview(
    context: unknown,
    runId: unknown,
  ): Promise<WorkflowRuntimeAccessDecision<WorkflowRuntimePublicRunOverview>>;
  getRunAuditTimeline(
    context: unknown,
    runId: unknown,
    limit?: number,
  ): Promise<WorkflowRuntimeAccessDecision<readonly WorkflowRuntimePublicAuditTimelineItem[]>>;
  getRunModelUsage(
    context: unknown,
    runId: unknown,
  ): Promise<WorkflowRuntimeAccessDecision<WorkflowRuntimePublicModelUsage>>;
  listApprovalQueue(
    context: unknown,
    limit?: number,
  ): Promise<WorkflowRuntimeAccessDecision<readonly WorkflowRuntimePublicApprovalSummary[]>>;
}

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const actorIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const hiddenRuntimeReasonCodes = new Set([
  "authorization_denied",
  "authorization_failed",
  "run_not_found",
]);
const publicRuntimeReasonCodes = new Set<WorkflowRuntimePublicReasonCode>([
  "invalid_command",
  "state_store_failed",
  "runtime_internal_error",
  "invalid_runtime_state",
  "stale_revision",
  "idempotency_conflict",
  "command_in_progress",
  "command_recovery_required",
  "claim_conflict",
  "execution_recovery_required",
  "state_conflict",
  "invalid_transition",
  "agent_input_missing",
  "agent_runtime_denied",
  "agent_result_mismatch",
  "approval_mismatch",
  "terminal_run",
  "no_progress",
  "runtime_limit",
]);

export function isWorkflowRuntimeAccessAction(input: unknown): input is WorkflowRuntimeAccessAction {
  return typeof input === "string"
    && (workflowRuntimeAccessActions as readonly string[]).includes(input);
}

export function parseWorkflowRuntimeAccessAction(input: unknown): WorkflowRuntimeAccessAction | null {
  return isWorkflowRuntimeAccessAction(input) ? input : null;
}

function unavailable<T>(): WorkflowRuntimeAccessDecision<T> {
  return freezeModelProviderAdapterData({
    verdict: "deny" as const,
    status: "unavailable" as const,
    data: null,
  });
}

function availableProjected<T>(data: T): WorkflowRuntimeAccessDecision<T> {
  return freezeModelProviderAdapterData({
    verdict: "allow" as const,
    status: "available" as const,
    data,
  });
}

function publicReasonCode(input: string): WorkflowRuntimePublicReasonCode | null {
  return publicRuntimeReasonCodes.has(input as WorkflowRuntimePublicReasonCode)
    ? input as WorkflowRuntimePublicReasonCode
    : null;
}

function projectRuntimeResponse(
  input: WorkflowRuntimeResponse,
): WorkflowRuntimePublicCommandResponse | null {
  const reasons: WorkflowRuntimePublicReason[] = [];
  for (const reason of input.reasons) {
    const code = publicReasonCode(reason.code);
    if (!code) return null;
    reasons.push({ code });
  }
  const waitingApproval = input.waitingApproval === null ? null : {
    kind: input.waitingApproval.kind,
    stepId: input.waitingApproval.stepId,
    approvalRequestId: input.waitingApproval.approvalRequestId,
  };
  const retryPending = input.retryPending === null ? null : {
    stepId: input.retryPending.stepId,
    attemptCount: input.retryPending.attemptCount,
    errorCode: input.retryPending.errorCode,
  };
  const lastStepResult = input.lastStepResult === null ? null : {
    stepId: input.lastStepResult.stepId,
    outcome: input.lastStepResult.outcome,
    finishReason: input.lastStepResult.finishReason,
    providerId: input.lastStepResult.providerId,
    providerModelId: input.lastStepResult.providerModelId,
    providerRequestModelId: input.lastStepResult.providerRequestModelId,
    providerModelVersion: input.lastStepResult.providerModelVersion,
    usage: {
      inputTokens: input.lastStepResult.usage.inputTokens,
      outputTokens: input.lastStepResult.usage.outputTokens,
      totalTokens: input.lastStepResult.usage.totalTokens,
    },
    latencyMs: input.lastStepResult.latencyMs,
    costUsdMicros: input.lastStepResult.costUsdMicros,
  };
  return {
    verdict: input.verdict,
    status: input.status,
    reasons,
    runId: input.runId,
    revision: input.revision,
    workflowStatus: input.workflowStatus,
    currentStepIds: input.currentStepIds.map((stepId) => stepId),
    readyStepIds: input.readyStepIds.map((stepId) => stepId),
    waitingApproval,
    retryPending,
    lastStepResult,
  };
}

function projectModelUsage(input: WorkflowRuntimeModelUsage): WorkflowRuntimePublicModelUsage {
  return {
    invocationCount: input.invocationCount,
    succeededCount: input.succeededCount,
    failedCount: input.failedCount,
    ambiguousCount: input.ambiguousCount,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    totalCostUsdMicros: input.totalCostUsdMicros,
    lastProviderId: input.lastProviderId,
    lastProviderModelId: input.lastProviderModelId,
    lastProviderRequestModelId: input.lastProviderRequestModelId,
    lastProviderModelVersion: input.lastProviderModelVersion,
  };
}

function projectInvocationSummary(
  input: WorkflowRuntimeInvocationSummary,
): WorkflowRuntimePublicInvocationSummary {
  return {
    invocationId: input.invocationId,
    stepId: input.stepId,
    attemptNumber: input.attemptNumber,
    status: input.status,
    providerId: input.providerId,
    deploymentId: input.deploymentId,
    providerModelId: input.providerModelId,
    providerRequestModelId: input.providerRequestModelId,
    providerModelVersion: input.providerModelVersion,
    providerIdentityVersion: input.providerIdentityVersion,
    requestFingerprint: input.requestFingerprint,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
  };
}

function projectApprovalSummary(
  input: WorkflowRuntimeApprovalSummary,
): WorkflowRuntimePublicApprovalSummary {
  return {
    approvalRequestId: input.approvalRequestId,
    runId: input.runId,
    stepId: input.stepId,
    status: input.status,
    riskLevel: input.riskLevel,
    requestedCapability: input.requestedCapability,
    requestedAt: input.requestedAt,
    resolvedAt: input.resolvedAt,
    requestedByActorId: input.requestedByActorId,
    resolvedByActorId: input.resolvedByActorId,
  };
}

function projectRunOverview(input: WorkflowRuntimeRunOverview): WorkflowRuntimePublicRunOverview {
  return {
    runId: input.runId,
    projectId: input.projectId,
    workflowId: input.workflowId,
    status: input.status,
    revision: input.revision,
    createdAt: input.createdAt,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    currentStepIds: input.currentStepIds.map((stepId) => stepId),
    readyStepIds: input.readyStepIds.map((stepId) => stepId),
    approval: input.approval === null ? null : projectApprovalSummary(input.approval),
    latestModelInvocation: input.latestModelInvocation === null
      ? null
      : projectInvocationSummary(input.latestModelInvocation),
    modelUsage: projectModelUsage(input.modelUsage),
  };
}

function projectAuditTimelineItem(
  input: WorkflowRuntimeAuditTimelineItem,
): WorkflowRuntimePublicAuditTimelineItem {
  return {
    eventType: input.eventType,
    actorKind: input.actorKind,
    actorId: input.actorId,
    runId: input.runId,
    createdAt: input.createdAt,
  };
}

function exactFields(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(input).sort();
  return keys.length === expected.length
    && [...expected].sort().every((key, index) => keys[index] === key);
}

function captureContext(input: unknown): WorkflowRuntimeAccessContext | null {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok || typeof snapshot.value !== "object" || snapshot.value === null
    || Array.isArray(snapshot.value)) return null;
  const value = snapshot.value as Record<string, unknown>;
  if (!exactFields(value, ["actorId", "workspaceId"])
    || typeof value.actorId !== "string" || !actorIdPattern.test(value.actorId)
    || typeof value.workspaceId !== "string" || !stableIdPattern.test(value.workspaceId)) {
    return null;
  }
  return freezeModelProviderAdapterData({
    actorId: value.actorId,
    workspaceId: value.workspaceId,
  });
}

function captureAuthorizer(input: unknown): WorkflowRuntimeAccessAuthorizer | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 1 || keys[0] !== "authorize") return null;
    const descriptor = Object.getOwnPropertyDescriptor(input, "authorize");
    if (!descriptor || !Object.hasOwn(descriptor, "value")
      || typeof descriptor.value !== "function") return null;
    return Object.freeze({
      authorize: descriptor.value as WorkflowRuntimeAccessAuthorizer["authorize"],
    });
  } catch {
    return null;
  }
}

function authorizationVerdict(input: unknown): WorkflowRuntimeAccessAuthorizationDecision["verdict"] | null {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok || typeof snapshot.value !== "object" || snapshot.value === null
    || Array.isArray(snapshot.value)) return null;
  const value = snapshot.value as Record<string, unknown>;
  return exactFields(value, ["verdict"])
    && (value.verdict === "allow" || value.verdict === "deny") ? value.verdict : null;
}

function runId(input: unknown): string | null {
  return typeof input === "string" && stableIdPattern.test(input) ? input : null;
}

function rawAllowed<T>(input: WorkflowRuntimeReadDecision<T>): input is Readonly<{
  verdict: "allow";
  reason: null;
  data: T;
}> {
  return input.verdict === "allow" && input.reason === null && input.data !== null;
}

function hidesRuntimeFacts(input: WorkflowRuntimeResponse): boolean {
  return input.reasons.some((reason) => hiddenRuntimeReasonCodes.has(reason.code));
}

export function createAuthorizedWorkflowRuntimeAccess(
  dependencies: AuthorizedWorkflowRuntimeAccessDependencies,
): AuthorizedWorkflowRuntimeAccess {
  const authorizer = captureAuthorizer(dependencies?.authorizer);
  if (!dependencies || typeof dependencies.runtimeService?.execute !== "function"
    || typeof dependencies.readModel?.getRunOverview !== "function"
    || typeof dependencies.readModel?.getRunAuditTimeline !== "function"
    || typeof dependencies.readModel?.getRunModelUsage !== "function"
    || typeof dependencies.readModel?.listApprovalQueue !== "function"
    || !authorizer) {
    throw new Error("Authorized Workflow runtime access configuration is invalid.");
  }
  const trustedAuthorizer = authorizer;

  async function authorize(
    contextInput: unknown,
    action: WorkflowRuntimeAccessAction,
    targetRunId: string | null,
  ): Promise<WorkflowRuntimeAccessContext | null> {
    const context = captureContext(contextInput);
    if (!context) return null;
    const authorizationInput = freezeModelProviderAdapterData({
      action,
      actorId: context.actorId,
      workspaceId: context.workspaceId,
      runId: targetRunId,
    });
    try {
      const result = await trustedAuthorizer.authorize(authorizationInput);
      return authorizationVerdict(result) === "allow" ? context : null;
    } catch {
      return null;
    }
  }

  async function executeCommand(
    contextInput: unknown,
    commandInput: unknown,
  ): Promise<WorkflowRuntimeAccessDecision<WorkflowRuntimePublicCommandResponse>> {
    const command = normalizeWorkflowRuntimeCommand(commandInput);
    if (!command) return unavailable();
    const context = await authorize(contextInput, "execute_runtime_command", command.runId);
    if (!context) return unavailable();
    const trustedCommand = freezeModelProviderAdapterData({
      ...cloneModelProviderAdapterData(command),
      actorId: context.actorId,
    }) as WorkflowRuntimeCommand;
    try {
      const result = await dependencies.runtimeService.execute(trustedCommand);
      if (hidesRuntimeFacts(result)) return unavailable();
      const projected = projectRuntimeResponse(result);
      return projected ? availableProjected(projected) : unavailable();
    } catch {
      return unavailable();
    }
  }

  async function getRunOverview(
    contextInput: unknown,
    runIdInput: unknown,
  ): Promise<WorkflowRuntimeAccessDecision<WorkflowRuntimePublicRunOverview>> {
    const targetRunId = runId(runIdInput);
    if (!targetRunId || !await authorize(contextInput, "read_run_overview", targetRunId)) {
      return unavailable();
    }
    try {
      const result = await dependencies.readModel.getRunOverview(targetRunId);
      return rawAllowed(result)
        ? availableProjected(projectRunOverview(result.data))
        : unavailable();
    } catch {
      return unavailable();
    }
  }

  async function getRunAuditTimeline(
    contextInput: unknown,
    runIdInput: unknown,
    limit?: number,
  ): Promise<WorkflowRuntimeAccessDecision<readonly WorkflowRuntimePublicAuditTimelineItem[]>> {
    const targetRunId = runId(runIdInput);
    if (!targetRunId || !await authorize(contextInput, "read_run_audit_timeline", targetRunId)) {
      return unavailable();
    }
    try {
      const existence = await dependencies.readModel.getRunOverview(targetRunId);
      if (!rawAllowed(existence)) return unavailable();
      const result = await dependencies.readModel.getRunAuditTimeline(targetRunId, limit);
      return rawAllowed(result)
        ? availableProjected(result.data.map(projectAuditTimelineItem))
        : unavailable();
    } catch {
      return unavailable();
    }
  }

  async function getRunModelUsage(
    contextInput: unknown,
    runIdInput: unknown,
  ): Promise<WorkflowRuntimeAccessDecision<WorkflowRuntimePublicModelUsage>> {
    const targetRunId = runId(runIdInput);
    if (!targetRunId || !await authorize(contextInput, "read_run_model_usage", targetRunId)) {
      return unavailable();
    }
    try {
      const result = await dependencies.readModel.getRunModelUsage(targetRunId);
      return rawAllowed(result)
        ? availableProjected(projectModelUsage(result.data))
        : unavailable();
    } catch {
      return unavailable();
    }
  }

  async function listApprovalQueue(
    contextInput: unknown,
    limit?: number,
  ): Promise<WorkflowRuntimeAccessDecision<readonly WorkflowRuntimePublicApprovalSummary[]>> {
    if (!await authorize(contextInput, "list_approval_queue", null)) return unavailable();
    try {
      const result = await dependencies.readModel.listApprovalQueue(limit);
      return rawAllowed(result)
        ? availableProjected(result.data.map(projectApprovalSummary))
        : unavailable();
    } catch {
      return unavailable();
    }
  }

  return Object.freeze({
    executeCommand,
    getRunOverview,
    getRunAuditTimeline,
    getRunModelUsage,
    listApprovalQueue,
  });
}
