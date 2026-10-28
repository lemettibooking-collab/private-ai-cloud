import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import type { ModelInvocationDraft, ModelInvocationRequest, ModelInvocationResult } from "../contracts/model-invocation";
import type { ModelInvocationDataHandlingEvidenceResolver } from "../contracts/model-invocation-execution";
import type { ModelProvider } from "../contracts/model-provider-adapter";
import type { WorkflowRunSnapshot, WorkflowRunStatus } from "../contracts/workflow-run";
import type {
  AgentStepCapabilityRequirementsResolver,
  AgentStepModelBudgetReservation,
  AgentStepModelInvocationLedger,
  AgentStepModelInvocationReservation,
  AgentStepRiskApprovalQuery,
  AgentStepRuntimeFactsQuery,
  AgentStepRuntimeContext,
  AgentStepRuntimeDecision,
} from "./agent-step-runtime";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData, freezeModelProviderAdapterData, modelProviderAdapterLimits, snapshotModelProviderAdapterInput } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkflowRunTransition, validateAndNormalizeWorkflowRunSnapshot } from "../contracts/workflow-run.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { executeAgentStep } from "./agent-step-runtime.ts";
import type { RuntimeOperationalSignalSink } from "../contracts/runtime-operational-signals";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { emitRuntimeOperationalSignal } from "../contracts/runtime-operational-signals.ts";

export const workflowRuntimeServiceStatuses = Object.freeze([
  "running",
  "completed",
  "failed",
  "cancelled",
  "waiting_approval",
  "approval_required",
  "retry_pending",
  "unsupported_runtime",
  "recovery_required",
  "no_progress",
  "conflict",
  "denied",
] as const);
export type WorkflowRuntimeServiceStatus = (typeof workflowRuntimeServiceStatuses)[number];

export const workflowRuntimeServiceVerdicts = Object.freeze(["allow", "deny", "idempotent"] as const);
export type WorkflowRuntimeServiceVerdict = (typeof workflowRuntimeServiceVerdicts)[number];

export const workflowRuntimeServiceLimits = Object.freeze({
  maxCommandIdLength: 40,
  maxActorIdLength: 128,
  maxRejectReasonLength: 1_024,
  maxAgentInputs: 128,
  maxExecutionIdLength: 48,
  maxReasons: 256,
  iterationMultiplier: 3,
  iterationConstant: 4,
});

export type WorkflowRuntimeReasonCode =
  | "invalid_command"
  | "run_not_found"
  | "authorization_denied"
  | "authorization_failed"
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

export type WorkflowRuntimeReason = Readonly<{
  code: WorkflowRuntimeReasonCode;
  path: string;
  message: string;
  runId: string | null;
  stepId: string | null;
}>;

export type WorkflowRuntimePause = Readonly<{
  kind: "risk_approval";
  stepId: string;
  reasonCode: "approval_required";
  approvalRequestId: string;
  approvalStatus: "pending" | "rejected";
}>;

export type WorkflowRuntimeState = Readonly<{
  snapshot: WorkflowRunSnapshot;
  projectRegistry: unknown;
  modelProviderRegistry: unknown;
  existingRequests: readonly ModelInvocationRequest[];
  pause: WorkflowRuntimePause | null;
}>;

export type WorkflowRuntimeWaitingApproval = Readonly<{
  kind: "workflow_gate" | "runtime_risk";
  stepId: string;
  approvalRequestId: string | null;
}>;

export type WorkflowRuntimeRetryPending = Readonly<{
  stepId: string;
  attemptCount: number;
  errorCode: string;
}>;

export type WorkflowRuntimeLastStepResult = Readonly<{
  stepId: string;
  outcome: ModelInvocationResult["outcome"];
  finishReason: ModelInvocationResult["finishReason"];
  providerId: string;
  providerModelId: string;
  /** Null only when replaying a pre-pinned durable command response. */
  providerRequestModelId: string | null;
  providerModelVersion: string;
  usage: ModelInvocationResult["usage"];
  latencyMs: number;
  costUsdMicros: number;
}>;

export type WorkflowRuntimeResponse = Readonly<{
  verdict: WorkflowRuntimeServiceVerdict;
  status: WorkflowRuntimeServiceStatus;
  reasons: readonly WorkflowRuntimeReason[];
  runId: string | null;
  revision: number | null;
  workflowStatus: WorkflowRunStatus | null;
  currentStepIds: readonly string[];
  readyStepIds: readonly string[];
  waitingApproval: WorkflowRuntimeWaitingApproval | null;
  retryPending: WorkflowRuntimeRetryPending | null;
  lastStepResult: WorkflowRuntimeLastStepResult | null;
}>;

export type WorkflowRuntimeAgentInput = Readonly<{
  stepId: string;
  executionId: string;
  invocationDraft: ModelInvocationDraft;
}>;

type CommandCommon = Readonly<{
  commandId: string;
  runId: string;
  expectedRevision: number;
  actorId: string;
}>;

export type WorkflowRuntimeStartCommand = CommandCommon & Readonly<{ kind: "start" }>;
export type WorkflowRuntimeAdvanceCommand = CommandCommon & Readonly<{
  kind: "advance";
  agentInputs: readonly WorkflowRuntimeAgentInput[];
}>;
export type WorkflowRuntimeApproveCommand = CommandCommon & Readonly<{
  kind: "approve";
  stepId: string;
  approvalRequestId: string;
}>;
export type WorkflowRuntimeRejectCommand = CommandCommon & Readonly<{
  kind: "reject";
  stepId: string;
  approvalRequestId: string;
  reason: string;
}>;
export type WorkflowRuntimeCancelCommand = CommandCommon & Readonly<{ kind: "cancel" }>;
export type WorkflowRuntimeGetCommand = Readonly<{
  kind: "get";
  runId: string;
  actorId: string;
}>;
export type WorkflowRuntimeMutatingCommand =
  | WorkflowRuntimeStartCommand
  | WorkflowRuntimeAdvanceCommand
  | WorkflowRuntimeApproveCommand
  | WorkflowRuntimeRejectCommand
  | WorkflowRuntimeCancelCommand;
export type WorkflowRuntimeCommand = WorkflowRuntimeMutatingCommand | WorkflowRuntimeGetCommand;

export type WorkflowRuntimeCommandAuthorizationInput = Readonly<{
  action: WorkflowRuntimeCommand["kind"];
  actorId: string;
  workspaceId: string;
  projectId: string;
  workflowId: string;
  runId: string;
  stepId: string | null;
}>;

export interface WorkflowRuntimeCommandAuthorizer {
  authorize(input: WorkflowRuntimeCommandAuthorizationInput): boolean | Promise<boolean>;
}

export type WorkflowRuntimeCommandBeginInput = Readonly<{
  runId: string;
  commandId: string;
  fingerprint: string;
  expectedRevision: number;
}>;

export type WorkflowRuntimeCommandBeginDecision =
  | Readonly<{ status: "acquired"; ownershipToken: string }>
  | Readonly<{ status: "replay"; response: WorkflowRuntimeResponse }>
  | Readonly<{ status: "in_progress" }>
  | Readonly<{ status: "recovery_required" }>
  | Readonly<{ status: "conflict" }>;

export type WorkflowRuntimeClaimInput = Readonly<{
  runId: string;
  stepId: string;
  attemptNumber: number;
  expectedRevision: number;
  executionId: string;
  requestFingerprint: string;
}>;

export type WorkflowRuntimeClaimDecision =
  | Readonly<{ status: "acquired"; claimId: string }>
  | Readonly<{ status: "conflict" | "idempotent" | "recovery_required"; claimId: null }>;

export type WorkflowRuntimeExecutionStartDecision = Readonly<{
  status: "started" | "conflict" | "recovery_required";
  // AI-037.4a: set by provider start when another execution of the same logical Step attempt has a
  // recorded provider outcome (the PRIOR side of provider_redispatch evidence).
  priorDispatch?: boolean;
}>;

export type WorkflowRuntimeCompareAndSwapInput = Readonly<{
  runId: string;
  expectedRevision: number;
  expectedPause: WorkflowRuntimePause | null;
  nextState: WorkflowRuntimeState;
  claimId: string | null;
  approvalMutation?: WorkflowRuntimeApprovalMutation | null;
}>;

export type WorkflowRuntimeRiskApprovalScope = Readonly<{
  workspaceId: string;
  runId: string;
  approvalRequestId: string;
  scopeFingerprint: string;
  stepId: string;
  attemptNumber: number;
  expectedRevision: number;
  requestFingerprint: string;
  policyFingerprint: string;
  requestedCapability: "deterministic" | "economy" | "reasoning" | "advanced_reasoning" | "coding";
  riskLevel: "low" | "medium" | "high" | "critical";
}>;

export type WorkflowRuntimeApprovalMutation =
  | Readonly<{
      kind: "create";
      scope: WorkflowRuntimeRiskApprovalScope;
      requestedByActorId: string;
    }>
  | Readonly<{
      kind: "resolve";
      approvalRequestId: string;
      decision: "approved" | "rejected";
      decidedByActorId: string;
      reason: string | null;
      commandId: string;
    }>
  | Readonly<{
      kind: "cancel";
      approvalRequestId: string;
      cancelledByActorId: string;
      commandId: string;
    }>;

export type WorkflowRuntimeRiskApprovalCheckInput = WorkflowRuntimeRiskApprovalScope;

export type WorkflowRuntimeCompareAndSwapDecision =
  | Readonly<{ status: "committed"; state: WorkflowRuntimeState }>
  | Readonly<{ status: "conflict"; state: WorkflowRuntimeState | null }>
  | Readonly<{ status: "recovery_required"; state: null }>;

export type WorkflowRuntimeCommandOwnershipInput = WorkflowRuntimeCommandBeginInput & Readonly<{
  ownershipToken: string;
}>;

export interface WorkflowRuntimeStateStore {
  load(input: Readonly<{ runId: string }>): Promise<unknown>;
  beginCommand(input: WorkflowRuntimeCommandBeginInput): Promise<WorkflowRuntimeCommandBeginDecision>;
  completeCommand(input: Readonly<{
    runId: string;
    commandId: string;
    fingerprint: string;
    ownershipToken: string;
    response: WorkflowRuntimeResponse;
  }>): Promise<void>;
  abandonCommand(input: WorkflowRuntimeCommandOwnershipInput): Promise<void>;
  markCommandEffectful(input: WorkflowRuntimeCommandOwnershipInput): Promise<void>;
  claim(input: WorkflowRuntimeClaimInput): Promise<WorkflowRuntimeClaimDecision>;
  startExecution(input: Readonly<{
    runId: string;
    claimId: string;
    providerStart?: AgentStepModelBudgetReservation;
  }>): Promise<WorkflowRuntimeExecutionStartDecision>;
  recordKnownExecutionOutcome(input: Readonly<{
    runId: string;
    claimId: string;
  }>): Promise<void>;
  compareAndSwap(input: WorkflowRuntimeCompareAndSwapInput): Promise<WorkflowRuntimeCompareAndSwapDecision>;
  checkRiskApproval(input: WorkflowRuntimeRiskApprovalCheckInput): Promise<Readonly<{ approved: boolean }>>;
  releaseClaim(input: Readonly<{ runId: string; claimId: string }>): Promise<void>;
  reserveModelInvocation?: AgentStepModelInvocationLedger["reserve"];
  authorizeModelInvocationPreflight?: (input: Readonly<{
    runId: string;
    claimId: string;
    reservation: AgentStepModelInvocationReservation;
  }>) => ReturnType<AgentStepModelInvocationLedger["authorizePreflight"]>;
  reserveModelInvocationBudget?: AgentStepModelInvocationLedger["reserveBudget"];
  releaseModelInvocationBudget?: AgentStepModelInvocationLedger["releaseBudget"];
  recordModelInvocationOutcome?: AgentStepModelInvocationLedger["recordOutcome"];
}

export type WorkflowRuntimeServiceDependencies = Readonly<{
  store: WorkflowRuntimeStateStore;
  authorizer: WorkflowRuntimeCommandAuthorizer;
  providers: readonly ModelProvider[];
  requirementsResolver: AgentStepCapabilityRequirementsResolver;
  evidenceResolver?: ModelInvocationDataHandlingEvidenceResolver;
  runtimeContext: AgentStepRuntimeContext;
  // AI-037.4a: optional operational signal sink (recovery_required, provider_redispatch).
  signals?: RuntimeOperationalSignalSink;
}>;

export interface WorkflowRuntimeService {
  execute(command: WorkflowRuntimeCommand): Promise<WorkflowRuntimeResponse>;
  start(command: WorkflowRuntimeStartCommand): Promise<WorkflowRuntimeResponse>;
  advance(command: WorkflowRuntimeAdvanceCommand): Promise<WorkflowRuntimeResponse>;
  approve(command: WorkflowRuntimeApproveCommand): Promise<WorkflowRuntimeResponse>;
  reject(command: WorkflowRuntimeRejectCommand): Promise<WorkflowRuntimeResponse>;
  cancel(command: WorkflowRuntimeCancelCommand): Promise<WorkflowRuntimeResponse>;
  get(command: WorkflowRuntimeGetCommand): Promise<WorkflowRuntimeResponse>;
}

type MutableReasons = WorkflowRuntimeReason[];
type PreparedMutation = Readonly<{
  state: WorkflowRuntimeState;
  ownership: WorkflowRuntimeCommandOwnershipInput;
}>;

const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const actorIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const unsafeTextPattern = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const baseCommandFields = Object.freeze([
  "kind", "commandId", "runId", "expectedRevision", "actorId",
] as const);
type ProxyScanState = { inspected: number; seen: WeakSet<object> };

function addReason(
  reasons: MutableReasons,
  code: WorkflowRuntimeReasonCode,
  path: string,
  message: string,
  runId: string | null = null,
  stepId: string | null = null,
): void {
  if (reasons.length >= workflowRuntimeServiceLimits.maxReasons) return;
  reasons.push({ code, path, message, runId, stepId });
}

function exactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(input);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field));
}

function containsProxy(
  input: unknown,
  state: ProxyScanState = { inspected: 0, seen: new WeakSet() },
  depth = 0,
): boolean {
  if (typeof input !== "object" || input === null) return false;
  if (isProxy(input)) return true;
  if (depth > modelProviderAdapterLimits.maxEnvelopeDepth || state.seen.has(input)) return false;
  try {
    state.seen.add(input);
    const keys = Reflect.ownKeys(input);
    state.inspected += keys.length;
    if (state.inspected > modelProviderAdapterLimits.maxInspectedProperties) return false;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor && Object.hasOwn(descriptor, "value")
        && containsProxy(descriptor.value, state, depth + 1)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function stableId(input: unknown): input is string {
  return typeof input === "string" && stableIdPattern.test(input);
}

function actorId(input: unknown): input is string {
  return typeof input === "string" && actorIdPattern.test(input);
}

function revision(input: unknown): input is number {
  return Number.isSafeInteger(input) && (input as number) >= 0;
}

function commandId(input: unknown): input is string {
  return stableId(input) && input.length <= workflowRuntimeServiceLimits.maxCommandIdLength;
}

function validCommandCommon(input: Record<string, unknown>): boolean {
  return commandId(input.commandId) && stableId(input.runId)
    && revision(input.expectedRevision) && actorId(input.actorId);
}

function normalizeAgentInputs(input: unknown): readonly WorkflowRuntimeAgentInput[] | null {
  if (!Array.isArray(input) || input.length > workflowRuntimeServiceLimits.maxAgentInputs) return null;
  const output: WorkflowRuntimeAgentInput[] = [];
  const stepIds = new Set<string>();
  const executionIds = new Set<string>();
  for (const value of input) {
    if (!plainRecord(value) || !exactFields(value, ["stepId", "executionId", "invocationDraft"])
      || !stableId(value.stepId) || !stableId(value.executionId)
      || value.executionId.length > workflowRuntimeServiceLimits.maxExecutionIdLength
      || stepIds.has(value.stepId) || executionIds.has(value.executionId)) return null;
    stepIds.add(value.stepId);
    executionIds.add(value.executionId);
    output.push({
      stepId: value.stepId,
      executionId: value.executionId,
      invocationDraft: cloneModelProviderAdapterData(value.invocationDraft) as ModelInvocationDraft,
    });
  }
  return output;
}

export function normalizeWorkflowRuntimeCommand(input: unknown): WorkflowRuntimeCommand | null {
  if (containsProxy(input)) return null;
  const boundary = snapshotModelProviderAdapterInput(input);
  if (!boundary.ok || !plainRecord(boundary.value) || typeof boundary.value.kind !== "string") return null;
  const captured = boundary.value;
  if (captured.kind === "get") {
    if (!exactFields(captured, ["kind", "runId", "actorId"])
      || !stableId(captured.runId) || !actorId(captured.actorId)) return null;
    return freezeModelProviderAdapterData({ kind: "get", runId: captured.runId, actorId: captured.actorId });
  }
  if (!validCommandCommon(captured)) return null;
  const common = {
    commandId: captured.commandId as string,
    runId: captured.runId as string,
    expectedRevision: captured.expectedRevision as number,
    actorId: captured.actorId as string,
  };
  if (captured.kind === "start" || captured.kind === "cancel") {
    if (!exactFields(captured, baseCommandFields)) return null;
    return freezeModelProviderAdapterData({ kind: captured.kind, ...common });
  }
  if (captured.kind === "advance") {
    if (!exactFields(captured, [...baseCommandFields, "agentInputs"])) return null;
    const agentInputs = normalizeAgentInputs(captured.agentInputs);
    return agentInputs
      ? freezeModelProviderAdapterData({ kind: "advance", ...common, agentInputs })
      : null;
  }
  if (captured.kind === "approve") {
    if (!exactFields(captured, [...baseCommandFields, "stepId", "approvalRequestId"])
      || !stableId(captured.stepId) || !stableId(captured.approvalRequestId)) return null;
    return freezeModelProviderAdapterData({
      kind: "approve",
      ...common,
      stepId: captured.stepId,
      approvalRequestId: captured.approvalRequestId,
    });
  }
  if (captured.kind === "reject") {
    if (!exactFields(captured, [...baseCommandFields, "stepId", "approvalRequestId", "reason"])
      || !stableId(captured.stepId) || !stableId(captured.approvalRequestId)
      || typeof captured.reason !== "string" || captured.reason.length < 1
      || captured.reason.length > workflowRuntimeServiceLimits.maxRejectReasonLength
      || unsafeTextPattern.test(captured.reason)) return null;
    return freezeModelProviderAdapterData({
      kind: "reject",
      ...common,
      stepId: captured.stepId,
      approvalRequestId: captured.approvalRequestId,
      reason: captured.reason,
    });
  }
  return null;
}

function plainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function canonicalData(input: unknown): string {
  if (input === null) return "null";
  if (typeof input === "string") return JSON.stringify(input);
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (Array.isArray(input)) return `[${input.map(canonicalData).join(",")}]`;
  if (plainRecord(input)) {
    return `{${Object.keys(input).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalData(input[key])}`,
    ).join(",")}}`;
  }
  return "invalid";
}

function commandFingerprint(command: WorkflowRuntimeMutatingCommand): string {
  return createHash("sha256").update(canonicalData(command)).digest("hex");
}

function executionRequestFingerprint(
  state: WorkflowRuntimeState,
  stepId: string,
  attemptNumber: number,
  input: WorkflowRuntimeAgentInput,
): string {
  return createHash("sha256").update(canonicalData({
    runId: state.snapshot.runId,
    revision: state.snapshot.revision,
    stepId,
    attemptNumber,
    invocationDraft: input.invocationDraft,
  })).digest("hex");
}

function riskApprovalScope(
  state: WorkflowRuntimeState,
  stepId: string,
  attemptNumber: number,
  requestFingerprint: string,
  policyFingerprint: string,
  requestedCapability: WorkflowRuntimeRiskApprovalScope["requestedCapability"],
  riskLevel: WorkflowRuntimeRiskApprovalScope["riskLevel"],
): WorkflowRuntimeRiskApprovalScope {
  const scopeInput = {
    workspaceId: state.snapshot.workspaceId,
    runId: state.snapshot.runId,
    stepId,
    attemptNumber,
    expectedRevision: state.snapshot.revision,
    requestFingerprint,
    policyFingerprint,
    requestedCapability,
    riskLevel,
  };
  const scopeFingerprint = createHash("sha256").update(canonicalData(scopeInput)).digest("hex");
  return freezeModelProviderAdapterData({
    workspaceId: state.snapshot.workspaceId,
    runId: state.snapshot.runId,
    approvalRequestId: `risk-approval-${scopeFingerprint.slice(0, 32)}`,
    scopeFingerprint,
    stepId,
    attemptNumber,
    expectedRevision: state.snapshot.revision,
    requestFingerprint,
    policyFingerprint,
    requestedCapability,
    riskLevel,
  });
}

export function normalizeWorkflowRuntimeState(input: unknown): WorkflowRuntimeState | null {
  const boundary = snapshotModelProviderAdapterInput(input);
  if (!boundary.ok || !plainRecord(boundary.value)
    || !exactFields(boundary.value, [
      "snapshot", "projectRegistry", "modelProviderRegistry", "existingRequests", "pause",
    ])) return null;
  const snapshotDecision = validateAndNormalizeWorkflowRunSnapshot(boundary.value.snapshot);
  if (snapshotDecision.verdict !== "allow" || !snapshotDecision.normalizedSnapshot) return null;
  const pauseInput = boundary.value.pause;
  let pause: WorkflowRuntimePause | null = null;
  if (pauseInput !== null) {
    if (!plainRecord(pauseInput) || !exactFields(pauseInput, [
      "kind", "stepId", "reasonCode", "approvalRequestId", "approvalStatus",
    ])
      || pauseInput.kind !== "risk_approval" || pauseInput.reasonCode !== "approval_required"
      || typeof pauseInput.stepId !== "string"
      || typeof pauseInput.approvalRequestId !== "string"
      || !stableIdPattern.test(pauseInput.approvalRequestId)
      || !["pending", "rejected"].includes(pauseInput.approvalStatus as string)) return null;
    pause = {
      kind: "risk_approval",
      stepId: pauseInput.stepId,
      reasonCode: "approval_required",
      approvalRequestId: pauseInput.approvalRequestId,
      approvalStatus: pauseInput.approvalStatus as "pending" | "rejected",
    };
  }
  if (!Array.isArray(boundary.value.existingRequests)) return null;
  return freezeModelProviderAdapterData({
    snapshot: snapshotDecision.normalizedSnapshot,
    projectRegistry: cloneModelProviderAdapterData(boundary.value.projectRegistry),
    modelProviderRegistry: cloneModelProviderAdapterData(boundary.value.modelProviderRegistry),
    existingRequests: cloneModelProviderAdapterData(
      boundary.value.existingRequests as unknown as readonly ModelInvocationRequest[],
    ),
    pause,
  });
}

function lastResult(stepId: string, result: ModelInvocationResult): WorkflowRuntimeLastStepResult {
  return {
    stepId,
    outcome: result.outcome,
    finishReason: result.finishReason,
    providerId: result.providerId,
    providerModelId: result.providerModelId,
    providerRequestModelId: result.providerRequestModelId,
    providerModelVersion: result.providerModelVersion,
    usage: cloneModelProviderAdapterData(result.usage),
    latencyMs: result.latencyMs,
    costUsdMicros: result.costUsdMicros,
  };
}

function waitingApproval(state: WorkflowRuntimeState): WorkflowRuntimeWaitingApproval | null {
  const gate = state.snapshot.stepStates.find((step) => step.status === "waiting_approval");
  if (gate) return { kind: "workflow_gate", stepId: gate.stepId, approvalRequestId: gate.approvalRequestId };
  if (state.pause) {
    return {
      kind: "runtime_risk",
      stepId: state.pause.stepId,
      approvalRequestId: state.pause.approvalRequestId,
    };
  }
  return null;
}

function retryPending(snapshot: WorkflowRunSnapshot): WorkflowRuntimeRetryPending | null {
  const step = snapshot.stepStates.find(
    (candidate) => candidate.status === "pending" && candidate.lastError?.retryable === true,
  );
  return step && step.lastError
    ? { stepId: step.stepId, attemptCount: step.attemptCount, errorCode: step.lastError.code }
    : null;
}

function response(
  verdict: WorkflowRuntimeServiceVerdict,
  status: WorkflowRuntimeServiceStatus,
  reasons: readonly WorkflowRuntimeReason[],
  state: WorkflowRuntimeState | null,
  result: WorkflowRuntimeLastStepResult | null = null,
): WorkflowRuntimeResponse {
  const snapshot = state?.snapshot ?? null;
  return freezeModelProviderAdapterData({
    verdict,
    status,
    reasons: cloneModelProviderAdapterData(reasons),
    runId: snapshot?.runId ?? null,
    revision: snapshot?.revision ?? null,
    workflowStatus: snapshot?.status ?? null,
    currentStepIds: snapshot?.stepStates.filter(
      (step) => step.status === "running" || step.status === "waiting_approval",
    ).map((step) => step.stepId) ?? [],
    readyStepIds: snapshot ? [...snapshot.readyStepIds] : [],
    waitingApproval: state ? waitingApproval(state) : null,
    retryPending: snapshot ? retryPending(snapshot) : null,
    lastStepResult: result ? cloneModelProviderAdapterData(result) : null,
  });
}

export function invalidWorkflowRuntimeCommandResponse(): WorkflowRuntimeResponse {
  const reasons: MutableReasons = [];
  addReason(
    reasons,
    "invalid_command",
    "$",
    "Workflow runtime command is invalid or exceeds bounded inspection limits.",
  );
  return response("deny", "denied", reasons, null);
}

export function workflowRuntimeInternalFailureResponse(
  path = "service.execute",
): WorkflowRuntimeResponse {
  const reasons: MutableReasons = [];
  addReason(reasons, "runtime_internal_error", path, "Workflow runtime execution failed closed.");
  return response("deny", "denied", reasons, null);
}

function failureFromResponse(
  value: WorkflowRuntimeResponse,
  code: WorkflowRuntimeReasonCode,
  path: string,
  message: string,
  stepId: string | null = null,
): WorkflowRuntimeResponse {
  const reasons = cloneModelProviderAdapterData(value.reasons) as WorkflowRuntimeReason[];
  addReason(reasons, code, path, message, value.runId, stepId);
  return freezeModelProviderAdapterData({
    ...cloneModelProviderAdapterData(value),
    verdict: "deny" as const,
    status: "denied" as const,
    reasons,
  });
}

function statusForSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRuntimeServiceStatus {
  switch (snapshot.status) {
    case "completed": return "completed";
    case "failed":
    case "blocked": return "failed";
    case "cancelled": return "cancelled";
    case "waiting_approval": return "waiting_approval";
    default: return "running";
  }
}

function transitionEvent(
  snapshot: WorkflowRunSnapshot,
  commandId: string,
  kind: string,
  occurredAt: string,
  actorId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId: `${commandId}-r${snapshot.revision + 1}`,
    runId: snapshot.runId,
    kind,
    sequence: snapshot.revision + 1,
    occurredAt,
    actorKind: kind === "approval_granted" || kind === "approval_rejected"
      || kind === "run_cancelled" ? "owner" : "system",
    actorId,
    ...extra,
  };
}

function now(runtimeContext: AgentStepRuntimeContext): string | null {
  try {
    const value = runtimeContext.now();
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function nextState(
  current: WorkflowRuntimeState,
  snapshot: WorkflowRunSnapshot,
  pause: WorkflowRuntimePause | null = current.pause,
): WorkflowRuntimeState {
  return freezeModelProviderAdapterData({
    snapshot,
    projectRegistry: cloneModelProviderAdapterData(current.projectRegistry),
    modelProviderRegistry: cloneModelProviderAdapterData(current.modelProviderRegistry),
    existingRequests: cloneModelProviderAdapterData(current.existingRequests),
    pause,
  });
}

function approvalStepId(command: WorkflowRuntimeCommand): string | null {
  return command.kind === "approve" || command.kind === "reject" ? command.stepId : null;
}

export function createWorkflowRuntimeService(
  dependencies: WorkflowRuntimeServiceDependencies,
): WorkflowRuntimeService {
  const { store, authorizer, providers, requirementsResolver, evidenceResolver, runtimeContext, signals } = dependencies;
  const durableInvocationLedgerAvailable = typeof store.reserveModelInvocation === "function"
    && typeof store.authorizeModelInvocationPreflight === "function"
    && typeof store.reserveModelInvocationBudget === "function"
    && typeof store.releaseModelInvocationBudget === "function"
    && typeof store.recordModelInvocationOutcome === "function";

  function invocationLedgerForClaim(
    runId: string,
    claimId: string,
    onRepeatedDispatch: (() => void) | null = null,
  ): AgentStepModelInvocationLedger | undefined {
    if (!durableInvocationLedgerAvailable) return undefined;
    // AI-037.4a provider_redispatch has two factual sides, both durable:
    // PRIOR: the provider-start fence found a recorded provider outcome for another execution of the
    //   same logical Step attempt (`priorDispatch`);
    // CURRENT: this attempt's own provider outcome was recorded. A non-null `outcome` exists only
    //   when provider.run returned a result that passed runtime result validation.
    // Entering run, a throw, a denial or an ambiguous (outcome_unknown) call never counts, so the
    // signal may under-count ambiguous dispatches and never over-counts.
    let priorDispatch = false;
    return {
      reserve: (input) => store.reserveModelInvocation!(input),
      authorizePreflight: (input) => input.runId === runId
        ? store.authorizeModelInvocationPreflight!({ runId, claimId, reservation: input })
        : Promise.resolve({ status: "conflict" }),
      reserveBudget: (input) => store.reserveModelInvocationBudget!(input),
      authorizeProviderStart: async (input) => {
        if (input.runId !== runId) return { status: "conflict" };
        const decision = await store.startExecution({ runId, claimId, providerStart: input });
        if (decision?.status === "started" && decision.priorDispatch === true) priorDispatch = true;
        return decision;
      },
      releaseBudget: (input) => store.releaseModelInvocationBudget!(input),
      recordOutcome: async (input) => {
        const recorded = await store.recordModelInvocationOutcome!(input);
        if (onRepeatedDispatch && priorDispatch && recorded?.status === "recorded"
          && (input.outcome === "succeeded" || input.outcome === "failed")) onRepeatedDispatch();
        return recorded;
      },
    };
  }

  async function load(runId: string, reasons: MutableReasons): Promise<WorkflowRuntimeState | null> {
    try {
      const raw = await store.load({ runId });
      if (raw === null) {
        addReason(reasons, "run_not_found", "runId", "Workflow Run was not found.", runId);
        return null;
      }
      const state = normalizeWorkflowRuntimeState(raw);
      if (!state || state.snapshot.runId !== runId) {
        addReason(reasons, "invalid_runtime_state", "store.load", "Trusted runtime state is invalid.", runId);
        return null;
      }
      return state;
    } catch {
      addReason(reasons, "state_store_failed", "store.load", "Runtime state load failed closed.", runId);
      return null;
    }
  }

  async function authorize(
    command: WorkflowRuntimeCommand,
    state: WorkflowRuntimeState,
    reasons: MutableReasons,
  ): Promise<boolean> {
    try {
      const allowed = await authorizer.authorize(freezeModelProviderAdapterData({
        action: command.kind,
        actorId: command.actorId,
        workspaceId: state.snapshot.workspaceId,
        projectId: state.snapshot.projectId,
        workflowId: state.snapshot.workflowId,
        runId: state.snapshot.runId,
        stepId: approvalStepId(command),
      }));
      if (allowed !== true) {
        addReason(reasons, "authorization_denied", "actorId", "Factual command authorization denied.", command.runId);
        return false;
      }
      return true;
    } catch {
      addReason(reasons, "authorization_failed", "authorizer", "Command authorization failed closed.", command.runId);
      return false;
    }
  }

  async function prepareMutation(
    command: WorkflowRuntimeMutatingCommand,
    reasons: MutableReasons,
  ): Promise<PreparedMutation | WorkflowRuntimeResponse> {
    const state = await load(command.runId, reasons);
    if (!state) return response("deny", "denied", reasons, null);
    if (!await authorize(command, state, reasons)) return response("deny", "denied", reasons, state);
    const fingerprint = commandFingerprint(command);
    let begin: WorkflowRuntimeCommandBeginDecision;
    try {
      begin = await store.beginCommand({
        runId: command.runId,
        commandId: command.commandId,
        fingerprint,
        expectedRevision: command.expectedRevision,
      });
    } catch {
      addReason(reasons, "state_store_failed", "store.beginCommand", "Command claim failed closed.", command.runId);
      return response("deny", "denied", reasons, state);
    }
    if (begin.status === "replay") {
      return freezeModelProviderAdapterData(cloneModelProviderAdapterData({
        ...begin.response,
        verdict: "idempotent" as const,
      }));
    }
    if (begin.status === "conflict") {
      addReason(reasons, "idempotency_conflict", "commandId", "commandId collides with another payload.", command.runId);
      return response("deny", "conflict", reasons, state);
    }
    if (begin.status === "in_progress") {
      addReason(reasons, "command_in_progress", "commandId", "An identical command is already in progress.", command.runId);
      return response("deny", "conflict", reasons, state);
    }
    if (begin.status === "recovery_required") {
      addReason(
        reasons,
        "command_recovery_required",
        "commandId",
        "A stale durable command may have crossed an effect boundary and requires recovery.",
        command.runId,
      );
      return response("deny", "recovery_required", reasons, state);
    }
    return {
      state,
      ownership: {
        runId: command.runId,
        commandId: command.commandId,
        fingerprint,
        expectedRevision: command.expectedRevision,
        ownershipToken: begin.ownershipToken,
      },
    };
  }

  async function finish(
    command: WorkflowRuntimeMutatingCommand,
    ownership: WorkflowRuntimeCommandOwnershipInput,
    value: WorkflowRuntimeResponse,
  ): Promise<WorkflowRuntimeResponse> {
    try {
      await store.completeCommand({
        runId: command.runId,
        commandId: command.commandId,
        fingerprint: ownership.fingerprint,
        ownershipToken: ownership.ownershipToken,
        response: value,
      });
      return value;
    } catch {
      let failed = failureFromResponse(
        value,
        "state_store_failed",
        "store.completeCommand",
        "Command completion failed closed.",
      );
      try {
        await store.abandonCommand(ownership);
      } catch {
        failed = failureFromResponse(
          failed,
          "state_store_failed",
          "store.abandonCommand",
          "Command recovery failed closed.",
        );
      }
      return failed;
    }
  }

  async function safeCompareAndSwap(
    state: WorkflowRuntimeState,
    snapshot: WorkflowRunSnapshot,
    claimId: string | null,
    reasons: MutableReasons,
    pause: WorkflowRuntimePause | null = state.pause,
    approvalMutation: WorkflowRuntimeApprovalMutation | null = null,
  ): Promise<WorkflowRuntimeCompareAndSwapDecision | null> {
    try {
      return await store.compareAndSwap({
        runId: state.snapshot.runId,
        expectedRevision: state.snapshot.revision,
        expectedPause: state.pause,
        nextState: nextState(state, snapshot, pause),
        claimId,
        approvalMutation,
      });
    } catch {
      addReason(
        reasons,
        "state_store_failed",
        "store.compareAndSwap",
        "Runtime state commit failed closed.",
        state.snapshot.runId,
      );
      return null;
    }
  }

  async function safeReleaseClaim(
    runId: string,
    claimId: string,
    stepId: string,
    reasons: MutableReasons,
  ): Promise<boolean> {
    try {
      await store.releaseClaim({ runId, claimId });
      return true;
    } catch {
      addReason(
        reasons,
        "state_store_failed",
        "store.releaseClaim",
        "Attempt claim release failed closed.",
        runId,
        stepId,
      );
      return false;
    }
  }

  async function safeStartExecution(
    runId: string,
    claimId: string,
    stepId: string,
    reasons: MutableReasons,
  ): Promise<WorkflowRuntimeExecutionStartDecision | null> {
    try {
      return await store.startExecution({ runId, claimId });
    } catch {
      addReason(
        reasons,
        "state_store_failed",
        "store.startExecution",
        "Durable execution intent start failed closed.",
        runId,
        stepId,
      );
      return { status: "recovery_required" };
    }
  }

  async function safeMarkCommandEffectful(
    command: WorkflowRuntimeMutatingCommand,
    ownership: WorkflowRuntimeCommandOwnershipInput,
    reasons: MutableReasons,
  ): Promise<boolean> {
    try {
      await store.markCommandEffectful(ownership);
      return true;
    } catch {
      addReason(
        reasons,
        "state_store_failed",
        "store.markCommandEffectful",
        "Command effect boundary failed closed.",
        command.runId,
      );
      return false;
    }
  }

  async function safeRecordKnownExecutionOutcome(
    runId: string,
    claimId: string,
    stepId: string,
    reasons: MutableReasons,
  ): Promise<boolean> {
    try {
      await store.recordKnownExecutionOutcome({ runId, claimId });
      return true;
    } catch {
      addReason(
        reasons,
        "state_store_failed",
        "store.recordKnownExecutionOutcome",
        "Known execution outcome could not be persisted.",
        runId,
        stepId,
      );
      return false;
    }
  }

  async function conflictResponse(
    runId: string,
    reasons: MutableReasons,
    state: WorkflowRuntimeState | null,
  ): Promise<WorkflowRuntimeResponse> {
    addReason(reasons, "state_conflict", "expectedRevision", "Factual runtime state changed before commit.", runId);
    return response("deny", "conflict", reasons, state);
  }

  function casRecoveryResponse(
    runId: string,
    reasons: MutableReasons,
    state: WorkflowRuntimeState,
    result: WorkflowRuntimeLastStepResult | null = null,
  ): WorkflowRuntimeResponse {
    addReason(
      reasons,
      "state_store_failed",
      "store.compareAndSwap",
      "The durable CAS commit outcome could not be reconciled.",
      runId,
    );
    return response("deny", "recovery_required", reasons, state, result);
  }

  async function executeStart(command: WorkflowRuntimeStartCommand): Promise<WorkflowRuntimeResponse> {
    const reasons: MutableReasons = [];
    const prepared = await prepareMutation(command, reasons);
    if ("verdict" in prepared) return prepared;
    const { state, ownership: fingerprint } = prepared;
    if (state.snapshot.revision !== command.expectedRevision) {
      addReason(reasons, "stale_revision", "expectedRevision", "Expected revision is stale.", command.runId);
      return finish(command, fingerprint, response("deny", "conflict", reasons, state));
    }
    if (state.snapshot.status !== "queued") {
      addReason(reasons, "invalid_transition", "kind", "start requires a queued Workflow Run.", command.runId);
      return finish(command, fingerprint, response("deny", statusForSnapshot(state.snapshot), reasons, state));
    }
    const occurredAt = now(runtimeContext);
    if (!occurredAt) {
      addReason(reasons, "invalid_transition", "runtimeContext.now", "Trusted runtime time is invalid.", command.runId);
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    const transition = evaluateWorkflowRunTransition({
      snapshot: state.snapshot,
      event: transitionEvent(state.snapshot, command.commandId, "run_started", occurredAt, "workflow-runtime"),
    });
    if (transition.verdict !== "allow" || !transition.nextSnapshot) {
      addReason(reasons, "invalid_transition", "run_started", "Canonical run start transition denied.", command.runId);
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    if (!await safeMarkCommandEffectful(command, fingerprint, reasons)) {
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    const committed = await safeCompareAndSwap(state, transition.nextSnapshot, null, reasons, null);
    if (!committed) {
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    if (committed.status === "recovery_required") {
      return finish(command, fingerprint, casRecoveryResponse(command.runId, reasons, state));
    }
    if (committed.status === "conflict") {
      return finish(command, fingerprint, await conflictResponse(command.runId, reasons, committed.state));
    }
    return finish(command, fingerprint, response("allow", "running", [], committed.state));
  }

  async function executeAdvance(command: WorkflowRuntimeAdvanceCommand): Promise<WorkflowRuntimeResponse> {
    const reasons: MutableReasons = [];
    const prepared = await prepareMutation(command, reasons);
    if ("verdict" in prepared) return prepared;
    let { state } = prepared;
    const { ownership: fingerprint } = prepared;
    if (state.snapshot.revision !== command.expectedRevision) {
      addReason(reasons, "stale_revision", "expectedRevision", "Expected revision is stale.", command.runId);
      return finish(command, fingerprint, response("deny", "conflict", reasons, state));
    }
    if (state.pause) {
      if (state.pause.approvalStatus === "rejected") {
        addReason(
          reasons,
          "approval_mismatch",
          "approvalRequestId",
          "Factual runtime risk approval was rejected.",
          command.runId,
          state.pause.stepId,
        );
        return finish(command, fingerprint, response("deny", "denied", reasons, state));
      }
      return finish(command, fingerprint, response("deny", "approval_required", [], state));
    }
    if (state.snapshot.status === "waiting_approval") {
      return finish(command, fingerprint, response("allow", "waiting_approval", [], state));
    }
    if (["completed", "failed", "blocked", "cancelled"].includes(state.snapshot.status)) {
      addReason(reasons, "terminal_run", "runId", "Terminal Workflow Run cannot advance.", command.runId);
      return finish(command, fingerprint, response("deny", statusForSnapshot(state.snapshot), reasons, state));
    }
    if (state.snapshot.status === "queued") {
      addReason(reasons, "no_progress", "runId", "Queued Workflow Run must be started first.", command.runId);
      return finish(command, fingerprint, response("deny", "no_progress", reasons, state));
    }
    if (!await safeMarkCommandEffectful(command, fingerprint, reasons)) {
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }

    const agentInputs = new Map(command.agentInputs.map((input) => [input.stepId, input]));
    const maximumIterations = state.snapshot.executionProfile.steps.length
      * workflowRuntimeServiceLimits.iterationMultiplier + workflowRuntimeServiceLimits.iterationConstant;
    let latestResult: WorkflowRuntimeLastStepResult | null = null;

    for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
      if (state.snapshot.status === "review") {
        const occurredAt = now(runtimeContext);
        if (!occurredAt) {
          addReason(reasons, "invalid_transition", "runtimeContext.now", "Trusted runtime time is invalid.", command.runId);
          return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
        }
        const completed = evaluateWorkflowRunTransition({
          snapshot: state.snapshot,
          event: transitionEvent(state.snapshot, command.commandId, "run_completed", occurredAt, "workflow-runtime"),
        });
        if (completed.verdict !== "allow" || !completed.nextSnapshot) {
          addReason(reasons, "invalid_transition", "run_completed", "Canonical completion transition denied.", command.runId);
          return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
        }
        const committed = await safeCompareAndSwap(state, completed.nextSnapshot, null, reasons, null);
        if (!committed) {
          return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
        }
        if (committed.status === "recovery_required") {
          return finish(
            command,
            fingerprint,
            casRecoveryResponse(command.runId, reasons, state, latestResult),
          );
        }
        if (committed.status === "conflict") {
          return finish(command, fingerprint, await conflictResponse(command.runId, reasons, committed.state));
        }
        return finish(command, fingerprint, response("allow", "completed", [], committed.state, latestResult));
      }

      const ready = state.snapshot.executionProfile.steps.filter(
        (step) => state.snapshot.readyStepIds.includes(step.id),
      );
      if (ready.length === 0) {
        const allSucceeded = state.snapshot.stepStates.every((step) => step.status === "success");
        if (allSucceeded && state.snapshot.status === "running") {
          const occurredAt = now(runtimeContext);
          if (!occurredAt) {
            addReason(reasons, "invalid_transition", "runtimeContext.now", "Trusted runtime time is invalid.", command.runId);
            return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
          }
          const review = evaluateWorkflowRunTransition({
            snapshot: state.snapshot,
            event: transitionEvent(state.snapshot, command.commandId, "review_started", occurredAt, "workflow-runtime"),
          });
          if (review.verdict !== "allow" || !review.nextSnapshot) {
            addReason(reasons, "invalid_transition", "review_started", "Canonical review transition denied.", command.runId);
            return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
          }
          const committed = await safeCompareAndSwap(state, review.nextSnapshot, null, reasons, null);
          if (!committed) {
            return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
          }
          if (committed.status === "recovery_required") {
            return finish(
              command,
              fingerprint,
              casRecoveryResponse(command.runId, reasons, state, latestResult),
            );
          }
          if (committed.status === "conflict") {
            return finish(command, fingerprint, await conflictResponse(command.runId, reasons, committed.state));
          }
          state = committed.state;
          continue;
        }
        addReason(reasons, "no_progress", "readyStepIds", "No factual step can progress.", command.runId);
        return finish(command, fingerprint, response("deny", "no_progress", reasons, state, latestResult));
      }

      const step = ready[0];
      if (step.kind === "approval_gate") {
        const approvalRequestId = `approval-${command.commandId}`;
        const occurredAt = now(runtimeContext);
        if (!occurredAt) {
          addReason(reasons, "invalid_transition", "runtimeContext.now", "Trusted runtime time is invalid.", command.runId, step.id);
          return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
        }
        const requested = evaluateWorkflowRunTransition({
          snapshot: state.snapshot,
          event: transitionEvent(state.snapshot, command.commandId, "approval_requested", occurredAt, "workflow-runtime", {
            stepId: step.id,
            approvalRequestId,
          }),
        });
        if (requested.verdict !== "allow" || !requested.nextSnapshot) {
          addReason(reasons, "invalid_transition", "approval_requested", "Canonical approval request denied.", command.runId, step.id);
          return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
        }
        const committed = await safeCompareAndSwap(state, requested.nextSnapshot, null, reasons, null);
        if (!committed) {
          return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
        }
        if (committed.status === "recovery_required") {
          return finish(
            command,
            fingerprint,
            casRecoveryResponse(command.runId, reasons, state, latestResult),
          );
        }
        if (committed.status === "conflict") {
          return finish(command, fingerprint, await conflictResponse(command.runId, reasons, committed.state));
        }
        return finish(command, fingerprint, response("allow", "waiting_approval", [], committed.state, latestResult));
      }

      const agentInput = agentInputs.get(step.id);
      if (!agentInput) {
        addReason(reasons, "agent_input_missing", "agentInputs", "No invocation draft exists for the factual ready Agent step.", command.runId, step.id);
        return finish(command, fingerprint, response("deny", "no_progress", reasons, state, latestResult));
      }
      const stepState = state.snapshot.stepStates.find((candidate) => candidate.stepId === step.id);
      if (!stepState) {
        addReason(reasons, "invalid_runtime_state", "stepStates", "Factual Agent step state is missing.", command.runId, step.id);
        return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
      }
      const attemptNumber = stepState.attemptCount + 1;
      const requestFingerprint = executionRequestFingerprint(state, step.id, attemptNumber, agentInput);
      let claim: WorkflowRuntimeClaimDecision;
      try {
        claim = await store.claim({
          runId: command.runId,
          stepId: step.id,
          attemptNumber,
          expectedRevision: state.snapshot.revision,
          executionId: agentInput.executionId,
          requestFingerprint,
        });
      } catch {
        addReason(reasons, "state_store_failed", "store.claim", "Attempt claim failed closed.", command.runId, step.id);
        return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
      }
      if (claim.status !== "acquired") {
        const recoveryRequired = claim.status === "recovery_required";
        addReason(
          reasons,
          recoveryRequired ? "execution_recovery_required" : "claim_conflict",
          "stepId",
          recoveryRequired
            ? "A previous durable execution has an ambiguous outcome and requires recovery."
            : "Factual Agent attempt is already claimed.",
          command.runId,
          step.id,
        );
        return finish(command, fingerprint, response(
          "deny",
          recoveryRequired ? "recovery_required" : "conflict",
          reasons,
          state,
          latestResult,
        ));
      }

      let claimedResponse: WorkflowRuntimeResponse | null = null;
      let claimedState = state;
      let committedAgentState: WorkflowRuntimeState | null = null;
      let committedAgentResult: WorkflowRuntimeLastStepResult | null = latestResult;
      let executionOutcomeKnown = false;
      try {
        const invocationLedger = invocationLedgerForClaim(command.runId, claim.claimId,
          signals ? () => emitRuntimeOperationalSignal(signals, "provider_redispatch") : null);
        const executionStart = invocationLedger
          ? { status: "started" as const }
          : await safeStartExecution(command.runId, claim.claimId, step.id, reasons);
        if (!executionStart) {
          claimedResponse = response("deny", "denied", reasons, state, latestResult);
        } else if (executionStart.status !== "started") {
          const recoveryRequired = executionStart.status === "recovery_required";
          addReason(
            reasons,
            recoveryRequired ? "execution_recovery_required" : "claim_conflict",
            "stepId",
            recoveryRequired
              ? "Durable execution may already have started and requires recovery."
              : "Durable execution intent could not be started.",
            command.runId,
            step.id,
          );
          claimedResponse = response(
            "deny",
            recoveryRequired ? "recovery_required" : "conflict",
            reasons,
            state,
            latestResult,
          );
        } else {
          const factualState = state;
          const agentDecision: AgentStepRuntimeDecision = await executeAgentStep(
            {
              runId: command.runId,
              stepId: step.id,
              executionId: agentInput.executionId,
              expectedRevision: state.snapshot.revision,
              expectedAttemptNumber: attemptNumber,
              invocationDraft: cloneModelProviderAdapterData(agentInput.invocationDraft),
            },
            {
              async resolve(query: AgentStepRuntimeFactsQuery) {
                if (query.runId !== factualState.snapshot.runId || query.stepId !== step.id) {
                  throw new Error("Factual Agent Step query mismatch.");
                }
                return {
                  snapshot: factualState.snapshot,
                  projectRegistry: factualState.projectRegistry,
                  modelProviderRegistry: factualState.modelProviderRegistry,
                  existingRequests: factualState.existingRequests,
                };
              },
            },
            providers,
            requirementsResolver,
            evidenceResolver,
            runtimeContext,
            {
              async resolve(query: AgentStepRiskApprovalQuery) {
                if (query.workspaceId !== factualState.snapshot.workspaceId
                  || query.runId !== factualState.snapshot.runId
                  || query.stepId !== step.id
                  || query.expectedRevision !== factualState.snapshot.revision
                  || query.expectedAttemptNumber !== attemptNumber) {
                  throw new Error("Factual risk approval query mismatch.");
                }
                const scope = riskApprovalScope(
                  factualState,
                  step.id,
                  attemptNumber,
                  requestFingerprint,
                  query.policyFingerprint,
                  query.requestedCapability,
                  query.riskLevel,
                );
                return store.checkRiskApproval(scope);
              },
            },
            invocationLedger,
          );
          executionOutcomeKnown = agentDecision.status !== "recovery_required";
          if (!agentDecision.previousSnapshot
            || agentDecision.previousSnapshot.runId !== state.snapshot.runId
            || agentDecision.previousSnapshot.revision !== state.snapshot.revision) {
            addReason(reasons, "agent_result_mismatch", "previousSnapshot", "Agent result does not match the claimed factual revision.", command.runId, step.id);
            claimedResponse = response("deny", "conflict", reasons, state, latestResult);
          } else if (!agentDecision.nextSnapshot) {
            if (agentDecision.status === "approval_required") {
              if (!agentDecision.riskApprovalScope) {
                addReason(
                  reasons,
                  "agent_result_mismatch",
                  "riskApprovalScope",
                  "Agent approval outcome is missing its bounded factual risk scope.",
                  command.runId,
                  step.id,
                );
                claimedResponse = response("deny", "denied", reasons, state, latestResult);
              } else {
                const approvalScope = riskApprovalScope(
                  state,
                  step.id,
                  attemptNumber,
                  requestFingerprint,
                  agentDecision.riskApprovalScope.policyFingerprint,
                  agentDecision.riskApprovalScope.requestedCapability,
                  agentDecision.riskApprovalScope.riskLevel,
                );
                const approvalPause: WorkflowRuntimePause = {
                  kind: "risk_approval",
                  stepId: step.id,
                  reasonCode: "approval_required",
                  approvalRequestId: approvalScope.approvalRequestId,
                  approvalStatus: "pending",
                };
                const committed = await safeCompareAndSwap(
                  state,
                  state.snapshot,
                  claim.claimId,
                  reasons,
                  approvalPause,
                  {
                    kind: "create",
                    scope: approvalScope,
                    requestedByActorId: "workflow-runtime",
                  },
                );
                if (!committed) {
                  claimedResponse = response("deny", "denied", reasons, state, latestResult);
                } else if (committed.status === "recovery_required") {
                  claimedResponse = casRecoveryResponse(command.runId, reasons, state, latestResult);
                } else if (committed.status === "conflict") {
                  claimedState = committed.state ?? state;
                  claimedResponse = await conflictResponse(command.runId, reasons, committed.state);
                } else {
                  claimedState = committed.state;
                  claimedResponse = response("deny", "approval_required", [], committed.state, latestResult);
                }
              }
            } else {
              addReason(reasons, "agent_runtime_denied", "executeAgentStep", "Agent Step Runtime did not produce a committable snapshot.", command.runId, step.id);
              const status = agentDecision.status === "unsupported_runtime"
                ? "unsupported_runtime"
                : agentDecision.status === "recovery_required"
                  ? "recovery_required"
                  : "denied";
              claimedResponse = response("deny", status, reasons, state, latestResult);
            }
          } else {
            const committed = await safeCompareAndSwap(
              state,
              agentDecision.nextSnapshot,
              claim.claimId,
              reasons,
              null,
            );
            if (!committed) {
              claimedResponse = response("deny", "denied", reasons, state, latestResult);
            } else if (committed.status === "recovery_required") {
              claimedResponse = casRecoveryResponse(command.runId, reasons, state, latestResult);
            } else if (committed.status === "conflict") {
              claimedState = committed.state ?? state;
              claimedResponse = await conflictResponse(command.runId, reasons, committed.state);
            } else {
              claimedState = committed.state;
              committedAgentState = committed.state;
              if (agentDecision.normalizedResult) {
                committedAgentResult = lastResult(step.id, agentDecision.normalizedResult);
              }
            }
          }
        }
      } catch {
        addReason(reasons, "agent_runtime_denied", "executeAgentStep", "Agent Step Runtime failed closed.", command.runId, step.id);
        claimedResponse = response("deny", "denied", reasons, state, latestResult);
      } finally {
        if (executionOutcomeKnown) {
          const recorded = await safeRecordKnownExecutionOutcome(
            command.runId,
            claim.claimId,
            step.id,
            reasons,
          );
          if (!recorded) {
            claimedResponse = response(
              "deny",
              "denied",
              reasons,
              committedAgentState ?? claimedState,
              committedAgentResult,
            );
          }
        }
        const released = await safeReleaseClaim(command.runId, claim.claimId, step.id, reasons);
        if (!released) {
          claimedResponse = response(
            "deny",
            "denied",
            reasons,
            committedAgentState ?? claimedState,
            committedAgentResult,
          );
        }
      }

      if (claimedResponse) return finish(command, fingerprint, claimedResponse);
      if (!committedAgentState) {
        addReason(reasons, "agent_runtime_denied", "executeAgentStep", "Agent Step Runtime produced no factual outcome.", command.runId, step.id);
        return finish(command, fingerprint, response("deny", "denied", reasons, state, latestResult));
      }
      state = committedAgentState;
      latestResult = committedAgentResult;
      const committedStep = state.snapshot.stepStates.find((candidate) => candidate.stepId === step.id);
      if (committedStep?.status === "pending" && committedStep.lastError?.retryable) {
        return finish(command, fingerprint, response("allow", "retry_pending", [], state, latestResult));
      }
      if (state.snapshot.status === "failed" || state.snapshot.status === "blocked") {
        return finish(command, fingerprint, response("deny", "failed", [], state, latestResult));
      }
    }

    addReason(reasons, "runtime_limit", "iterations", "Deterministic orchestration iteration limit reached.", command.runId);
    return finish(command, fingerprint, response("deny", "no_progress", reasons, state, latestResult));
  }

  async function executeApproval(
    command: WorkflowRuntimeApproveCommand | WorkflowRuntimeRejectCommand,
  ): Promise<WorkflowRuntimeResponse> {
    const reasons: MutableReasons = [];
    const prepared = await prepareMutation(command, reasons);
    if ("verdict" in prepared) return prepared;
    const { state, ownership: fingerprint } = prepared;
    if (state.snapshot.revision !== command.expectedRevision) {
      addReason(reasons, "stale_revision", "expectedRevision", "Expected revision is stale.", command.runId, command.stepId);
      return finish(command, fingerprint, response("deny", "conflict", reasons, state));
    }
    if (state.pause) {
      if (state.pause.approvalStatus !== "pending"
        || state.pause.stepId !== command.stepId
        || state.pause.approvalRequestId !== command.approvalRequestId) {
        addReason(
          reasons,
          "approval_mismatch",
          "approvalRequestId",
          "Factual runtime risk approval does not match the pending command scope.",
          command.runId,
          command.stepId,
        );
        return finish(command, fingerprint, response("deny", "denied", reasons, state));
      }
      if (!await safeMarkCommandEffectful(command, fingerprint, reasons)) {
        return finish(command, fingerprint, response("deny", "denied", reasons, state));
      }
      const nextPause: WorkflowRuntimePause | null = command.kind === "approve"
        ? null
        : { ...state.pause, approvalStatus: "rejected" };
      const committed = await safeCompareAndSwap(
        state,
        state.snapshot,
        null,
        reasons,
        nextPause,
        {
          kind: "resolve",
          approvalRequestId: command.approvalRequestId,
          decision: command.kind === "approve" ? "approved" : "rejected",
          decidedByActorId: command.actorId,
          reason: command.kind === "reject" ? command.reason : null,
          commandId: command.commandId,
        },
      );
      if (!committed) return finish(command, fingerprint, response("deny", "denied", reasons, state));
      if (committed.status === "recovery_required") {
        return finish(command, fingerprint, casRecoveryResponse(command.runId, reasons, state));
      }
      if (committed.status === "conflict") {
        return finish(command, fingerprint, await conflictResponse(command.runId, reasons, committed.state));
      }
      return finish(command, fingerprint, response(
        command.kind === "approve" ? "allow" : "deny",
        command.kind === "approve" ? "running" : "denied",
        [],
        committed.state,
      ));
    }
    const stepState = state.snapshot.stepStates.find((step) => step.stepId === command.stepId);
    if (state.snapshot.status !== "waiting_approval"
      || stepState?.status !== "waiting_approval"
      || stepState.approvalRequestId !== command.approvalRequestId) {
      addReason(reasons, "approval_mismatch", "approvalRequestId", "Factual pending approval does not match command.", command.runId, command.stepId);
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    const occurredAt = now(runtimeContext);
    if (!occurredAt) {
      addReason(reasons, "invalid_transition", "runtimeContext.now", "Trusted runtime time is invalid.", command.runId, command.stepId);
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    const kind = command.kind === "approve" ? "approval_granted" : "approval_rejected";
    const transition = evaluateWorkflowRunTransition({
      snapshot: state.snapshot,
      event: transitionEvent(state.snapshot, command.commandId, kind, occurredAt, command.actorId, {
        stepId: command.stepId,
        approvalRequestId: command.approvalRequestId,
        ...(command.kind === "reject" ? { reason: command.reason } : {}),
      }),
    });
    if (transition.verdict !== "allow" || !transition.nextSnapshot) {
      addReason(reasons, "invalid_transition", kind, "Canonical approval transition denied.", command.runId, command.stepId);
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    if (!await safeMarkCommandEffectful(command, fingerprint, reasons)) {
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    const committed = await safeCompareAndSwap(state, transition.nextSnapshot, null, reasons, null);
    if (!committed) {
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    if (committed.status === "recovery_required") {
      return finish(command, fingerprint, casRecoveryResponse(command.runId, reasons, state));
    }
    if (committed.status === "conflict") {
      return finish(command, fingerprint, await conflictResponse(command.runId, reasons, committed.state));
    }
    return finish(command, fingerprint, response(
      "allow",
      command.kind === "approve" ? "running" : "failed",
      [],
      committed.state,
    ));
  }

  async function executeCancel(command: WorkflowRuntimeCancelCommand): Promise<WorkflowRuntimeResponse> {
    const reasons: MutableReasons = [];
    const prepared = await prepareMutation(command, reasons);
    if ("verdict" in prepared) return prepared;
    const { state, ownership: fingerprint } = prepared;
    if (state.snapshot.status === "cancelled") {
      return finish(command, fingerprint, response("idempotent", "cancelled", [], state));
    }
    if (state.snapshot.revision !== command.expectedRevision) {
      addReason(reasons, "stale_revision", "expectedRevision", "Expected revision is stale.", command.runId);
      return finish(command, fingerprint, response("deny", "conflict", reasons, state));
    }
    if (state.snapshot.status === "completed" || state.snapshot.status === "failed"
      || state.snapshot.status === "blocked") {
      addReason(reasons, "terminal_run", "runId", "Terminal Workflow Run cannot be cancelled.", command.runId);
      return finish(command, fingerprint, response("deny", statusForSnapshot(state.snapshot), reasons, state));
    }
    const occurredAt = now(runtimeContext);
    if (!occurredAt) {
      addReason(reasons, "invalid_transition", "runtimeContext.now", "Trusted runtime time is invalid.", command.runId);
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    const transition = evaluateWorkflowRunTransition({
      snapshot: state.snapshot,
      event: transitionEvent(state.snapshot, command.commandId, "run_cancelled", occurredAt, command.actorId, {
        reasonCode: "cancelled_by_authorized_actor",
        message: "Workflow Run was cancelled by an authorized actor.",
      }),
    });
    if (transition.verdict !== "allow" || !transition.nextSnapshot) {
      addReason(reasons, "invalid_transition", "run_cancelled", "Canonical cancellation transition denied.", command.runId);
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    if (!await safeMarkCommandEffectful(command, fingerprint, reasons)) {
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    const committed = await safeCompareAndSwap(
      state,
      transition.nextSnapshot,
      null,
      reasons,
      null,
      state.pause?.approvalStatus === "pending"
        ? {
            kind: "cancel",
            approvalRequestId: state.pause.approvalRequestId,
            cancelledByActorId: command.actorId,
            commandId: command.commandId,
          }
        : null,
    );
    if (!committed) {
      return finish(command, fingerprint, response("deny", "denied", reasons, state));
    }
    if (committed.status === "recovery_required") {
      return finish(command, fingerprint, casRecoveryResponse(command.runId, reasons, state));
    }
    if (committed.status === "conflict") {
      return finish(command, fingerprint, await conflictResponse(command.runId, reasons, committed.state));
    }
    return finish(command, fingerprint, response("allow", "cancelled", [], committed.state));
  }

  async function executeGet(command: WorkflowRuntimeGetCommand): Promise<WorkflowRuntimeResponse> {
    const reasons: MutableReasons = [];
    const state = await load(command.runId, reasons);
    if (!state) return response("deny", "denied", reasons, null);
    if (!await authorize(command, state, reasons)) return response("deny", "denied", reasons, state);
    const status = state.pause
      ? state.pause.approvalStatus === "pending" ? "approval_required" : "denied"
      : statusForSnapshot(state.snapshot);
    return response("allow", status, [], state);
  }

  async function executeBoundary(
    input: unknown,
    expectedKind: WorkflowRuntimeCommand["kind"] | null = null,
  ): Promise<WorkflowRuntimeResponse> {
    const command = normalizeWorkflowRuntimeCommand(input);
    if (!command || (expectedKind !== null && command.kind !== expectedKind)) {
      return invalidWorkflowRuntimeCommandResponse();
    }
    let result: WorkflowRuntimeResponse;
    try {
      switch (command.kind) {
        case "start": result = await executeStart(command); break;
        case "advance": result = await executeAdvance(command); break;
        case "approve": result = await executeApproval(command); break;
        case "reject": result = await executeApproval(command); break;
        case "cancel": result = await executeCancel(command); break;
        case "get": result = await executeGet(command); break;
      }
    } catch {
      return workflowRuntimeInternalFailureResponse(`service.${expectedKind ?? "execute"}`);
    }
    // AI-037.4a recovery_required: one per fresh runtime decision that requires recovery. Exact
    // replays of a stored response (verdict "idempotent") are not new decisions and are not counted.
    if (result.status === "recovery_required" && result.verdict !== "idempotent") {
      emitRuntimeOperationalSignal(signals, "recovery_required");
    }
    return result;
  }

  return Object.freeze({
    execute: (command: WorkflowRuntimeCommand) => executeBoundary(command),
    start: (command: WorkflowRuntimeStartCommand) => executeBoundary(command, "start"),
    advance: (command: WorkflowRuntimeAdvanceCommand) => executeBoundary(command, "advance"),
    approve: (command: WorkflowRuntimeApproveCommand) => executeBoundary(command, "approve"),
    reject: (command: WorkflowRuntimeRejectCommand) => executeBoundary(command, "reject"),
    cancel: (command: WorkflowRuntimeCancelCommand) => executeBoundary(command, "cancel"),
    get: (command: WorkflowRuntimeGetCommand) => executeBoundary(command, "get"),
  });
}
