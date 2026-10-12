import type { AgentOutputType } from "./agent-manifest";
import type { WorkflowActionMode } from "./workflow-manifest";
import type {
  WorkflowRunSnapshot,
  WorkflowRunSnapshotValidationDecision,
} from "./workflow-run";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { agentOutputTypes } from "./agent-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { workflowActionModes, workflowManifestLimits } from "./workflow-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeWorkflowRunSnapshot, workflowRunLimits } from "./workflow-run.ts";

export const modelInvocationMessageRoles = Object.freeze([
  "system", "user", "assistant", "tool",
] as const);
export type ModelInvocationMessageRole = (typeof modelInvocationMessageRoles)[number];

export const modelInvocationStatuses = Object.freeze(["admitted", "idempotent", "denied"] as const);
export type ModelInvocationStatus = (typeof modelInvocationStatuses)[number];

export const modelInvocationResultStatuses = Object.freeze(["succeeded", "failed"] as const);
export type ModelInvocationResultStatus = (typeof modelInvocationResultStatuses)[number];

export const modelInvocationFinishReasons = Object.freeze([
  "stop", "length", "tool_calls", "content_filter", "error",
] as const);
export type ModelInvocationFinishReason = (typeof modelInvocationFinishReasons)[number];

export const modelInvocationVerdicts = Object.freeze(["allow", "idempotent", "deny"] as const);
export type ModelInvocationVerdict = (typeof modelInvocationVerdicts)[number];

export const modelInvocationErrorCategories = Object.freeze([
  "provider_error", "rate_limited", "timeout", "invalid_response", "content_filtered", "unavailable", "unknown",
] as const);
export type ModelInvocationErrorCategory = (typeof modelInvocationErrorCategories)[number];

export const modelInvocationLimits = Object.freeze({
  maxIdLength: workflowRunLimits.maxIdLength,
  maxProviderAuditIdLength: 256,
  maxExistingRequests: 512,
  maxMessages: 128,
  maxMessageLength: 32_768,
  maxContextArtifactIds: 256,
  maxToolCallProposals: 64,
  maxOutputTextLength: 131_072,
  maxErrorCodeLength: 128,
  maxErrorMessageLength: 4_096,
  maxJsonDepth: 24,
  maxJsonArrayLength: 1_024,
  maxJsonProperties: 16_384,
  maxJsonStringLength: 32_768,
  maxInspectedProperties: 600_000,
  maxEnvelopeDepth: 64,
  maxEnvelopeArrayLength: 4_096,
  maxEnvelopeStringLength: 131_072,
  maxValidationReasons: 256,
  maxTokenCount: 9_000_000_000,
  maxLatencyMs: 86_400_000,
  maxCostUsdMicros: 9_000_000_000_000,
});

export type ModelInvocationMessage = Readonly<{
  role: ModelInvocationMessageRole;
  content: string;
  toolCallId: string | null;
}>;

export type ModelInvocationRequest = Readonly<{
  invocationId: string;
  invocationSequence: number;
  runId: string;
  runRevision: number;
  requestId: string;
  workspaceId: string;
  projectId: string;
  departmentId: string;
  workflowId: string;
  workflowBindingId: string;
  agentId: string;
  agentBindingId: string;
  stepId: string;
  attemptNumber: number;
  modelProfileId: string;
  instructionProfileId: string;
  outputType: AgentOutputType;
  messages: readonly ModelInvocationMessage[];
  contextArtifactIds: readonly string[];
  toolIds: readonly string[];
  actionMode: WorkflowActionMode;
  requiredApprovalAction: string | null;
}>;

export type ModelInvocationDraft = Readonly<{
  invocationId: string;
  invocationSequence: number;
  stepId: string;
  messages: readonly ModelInvocationMessage[];
  contextArtifactIds: readonly string[];
}>;

export type ModelInvocationAdmissionInput = Readonly<{
  snapshot: unknown;
  draft: unknown;
  existingRequests: unknown;
}>;

export type ModelInvocationReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "invalid_workflow_run_snapshot"
  | "invalid_existing_request"
  | "invalid_draft"
  | "duplicate_invocation_id"
  | "duplicate_invocation_tuple"
  | "conflicting_replay"
  | "run_not_running"
  | "step_not_found"
  | "wrong_step_kind"
  | "step_not_running"
  | "invalid_attempt"
  | "invalid_run_revision"
  | "agent_not_found"
  | "agent_linkage_mismatch"
  | "model_not_allowed"
  | "tool_not_allowed"
  | "output_not_allowed"
  | "request_identity_mismatch"
  | "invalid_result"
  | "invocation_id_mismatch"
  | "tool_call_not_allowed"
  | "duplicate_tool_call_id"
  | "invalid_message_sequence"
  | "unverified_tool_message"
  | "usage_mismatch"
  | "invalid_result_invariants";

export type ModelInvocationReason = Readonly<{
  code: ModelInvocationReasonCode;
  path: string;
  message: string;
  invocationId: string | null;
  runId: string | null;
  requestId: string | null;
  projectId: string | null;
  departmentId: string | null;
  workflowId: string | null;
  agentId: string | null;
  stepId: string | null;
  attemptNumber: number | null;
}>;

export type ModelInvocationRequestValidationDecision = Readonly<{
  verdict: "allow" | "deny";
  reasons: readonly ModelInvocationReason[];
  normalizedRequest: ModelInvocationRequest | null;
}>;

export type ModelInvocationAdmissionDecision = Readonly<{
  verdict: ModelInvocationVerdict;
  status: ModelInvocationStatus;
  reasons: readonly ModelInvocationReason[];
  snapshotDecision: WorkflowRunSnapshotValidationDecision | null;
  normalizedRequest: ModelInvocationRequest | null;
}>;

export type ModelInvocationUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}>;

export type ModelInvocationToolCallProposal = Readonly<{
  toolCallId: string;
  toolId: string;
  arguments: JsonValue;
}>;

export type ModelInvocationProviderError = Readonly<{
  category: ModelInvocationErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
}>;

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export type ModelInvocationResult = Readonly<{
  invocationId: string;
  outcome: ModelInvocationResultStatus;
  finishReason: ModelInvocationFinishReason;
  providerId: string;
  providerModelId: string;
  providerRequestModelId: string;
  providerModelVersion: string;
  outputText: string | null;
  structuredOutput: JsonValue;
  toolCallProposals: readonly ModelInvocationToolCallProposal[];
  usage: ModelInvocationUsage;
  latencyMs: number;
  costUsdMicros: number;
  error: ModelInvocationProviderError | null;
}>;

export type ModelInvocationResultEvaluationInput = Readonly<{
  snapshot: unknown;
  request: unknown;
  result: unknown;
}>;

export type ModelInvocationResultValidationDecision = Readonly<{
  verdict: "allow" | "deny";
  reasons: readonly ModelInvocationReason[];
  normalizedResult: ModelInvocationResult | null;
}>;

export type ModelInvocationResultDecision = Readonly<{
  verdict: "allow" | "deny";
  reasons: readonly ModelInvocationReason[];
  snapshotDecision: WorkflowRunSnapshotValidationDecision | null;
  normalizedRequest: ModelInvocationRequest | null;
  normalizedResult: ModelInvocationResult | null;
}>;

type MutableReasons = ModelInvocationReason[];
type SnapshotState = { inspected: number; active: WeakSet<object> };
type SnapshotResult = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; limited: boolean }>;

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const nonNewlineControlPattern = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const auditLineBreakOrControlPattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const admissionFields = Object.freeze(["snapshot", "draft", "existingRequests"] as const);
const draftFields = Object.freeze(["invocationId", "invocationSequence", "stepId", "messages", "contextArtifactIds"] as const);
const messageFields = Object.freeze(["role", "content", "toolCallId"] as const);
const requestFields = Object.freeze([
  "invocationId", "invocationSequence", "runId", "runRevision", "requestId", "workspaceId", "projectId",
  "departmentId", "workflowId", "workflowBindingId", "agentId", "agentBindingId", "stepId", "attemptNumber",
  "modelProfileId", "instructionProfileId", "outputType", "messages", "contextArtifactIds", "toolIds", "actionMode",
  "requiredApprovalAction",
] as const);
const resultEvaluationFields = Object.freeze(["snapshot", "request", "result"] as const);
const resultFields = Object.freeze([
  "invocationId", "outcome", "finishReason", "providerId", "providerModelId", "providerRequestModelId", "providerModelVersion", "outputText",
  "structuredOutput", "toolCallProposals", "usage", "latencyMs", "costUsdMicros", "error",
] as const);
const usageFields = Object.freeze(["inputTokens", "outputTokens", "totalTokens"] as const);
const proposalFields = Object.freeze(["toolCallId", "toolId", "arguments"] as const);
const providerErrorFields = Object.freeze(["category", "code", "message", "retryable"] as const);

function includesValue<T>(values: readonly T[], input: unknown): input is T {
  return values.some((value) => value === input);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function isOrdinaryArray(input: unknown): input is unknown[] {
  return Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype;
}

function exactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(input);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field));
}

function own(input: Record<string, unknown>, key: string): unknown {
  return input[key];
}

function stableId(input: unknown): string | null {
  return typeof input === "string" && safeIdPattern.test(input) ? input : null;
}

function boundedText(input: unknown, maximum: number, empty = false): string | null {
  if (typeof input !== "string" || input.length > maximum || (!empty && input.length === 0)
    || nonNewlineControlPattern.test(input)) return null;
  return input;
}

function boundedAuditIdentifier(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > modelInvocationLimits.maxProviderAuditIdLength
    || input.trim().length === 0 || auditLineBreakOrControlPattern.test(input)) return null;
  return input;
}

function safeInteger(input: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return Number.isSafeInteger(input) && (input as number) >= minimum && (input as number) <= maximum
    ? input as number : null;
}

function snapshotValue(input: unknown, state: SnapshotState, depth: number): SnapshotResult {
  if (typeof input === "string") return input.length <= modelInvocationLimits.maxEnvelopeStringLength
    ? { ok: true, value: input } : { ok: false, limited: true };
  if (input === null || typeof input === "boolean" || typeof input === "undefined") return { ok: true, value: input };
  if (typeof input === "number") return Number.isFinite(input) ? { ok: true, value: input } : { ok: false, limited: false };
  if (typeof input !== "object") return { ok: false, limited: false };
  if (depth > modelInvocationLimits.maxEnvelopeDepth || state.active.has(input)) return { ok: false, limited: depth > modelInvocationLimits.maxEnvelopeDepth };
  let array: boolean;
  try {
    array = Array.isArray(input);
    if (array ? !isOrdinaryArray(input) : !isPlainRecord(input)) return { ok: false, limited: false };
  } catch { return { ok: false, limited: false }; }
  state.active.add(input);
  try {
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")) return { ok: false, limited: false };
    const keys = (ownKeys as string[]).filter((key) => !(array && key === "length"));
    if (array && (input as unknown[]).length > modelInvocationLimits.maxEnvelopeArrayLength) return { ok: false, limited: true };
    if (array && keys.length !== (input as unknown[]).length) return { ok: false, limited: false };
    state.inspected += keys.length;
    if (state.inspected > modelInvocationLimits.maxInspectedProperties) return { ok: false, limited: true };
    const output: unknown[] | Record<string, unknown> = array ? [] : Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (array && String((output as unknown[]).length) !== key) return { ok: false, limited: false };
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return { ok: false, limited: false };
      const nested = snapshotValue(descriptor.value, state, depth + 1);
      if (!nested.ok) return nested;
      if (array) (output as unknown[]).push(nested.value);
      else (output as Record<string, unknown>)[key] = nested.value;
    }
    return { ok: true, value: output };
  } catch { return { ok: false, limited: false }; }
  finally { state.active.delete(input); }
}

function boundedSnapshot(input: unknown): SnapshotResult {
  return snapshotValue(input, { inspected: 0, active: new WeakSet<object>() }, 0);
}

function deepFreeze<T>(input: T): T {
  if (typeof input !== "object" || input === null || Object.isFrozen(input)) return input;
  for (const value of Object.values(input)) deepFreeze(value);
  return Object.freeze(input);
}

function cloneJson<T>(input: T): T {
  if (Array.isArray(input)) return input.map(cloneJson) as T;
  if (typeof input === "object" && input !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) output[key] = cloneJson(value);
    return output as T;
  }
  return input;
}

function reasonContext(request?: Partial<ModelInvocationRequest>) {
  return {
    invocationId: request?.invocationId ?? null,
    runId: request?.runId ?? null,
    requestId: request?.requestId ?? null,
    projectId: request?.projectId ?? null,
    departmentId: request?.departmentId ?? null,
    workflowId: request?.workflowId ?? null,
    agentId: request?.agentId ?? null,
    stepId: request?.stepId ?? null,
    attemptNumber: request?.attemptNumber ?? null,
  };
}

function addReason(reasons: MutableReasons, code: ModelInvocationReasonCode, path: string, message: string, request?: Partial<ModelInvocationRequest>) {
  if (reasons.length >= modelInvocationLimits.maxValidationReasons) return;
  reasons.push({ code, path, message, ...reasonContext(request) });
}

function frozenReasons(reasons: readonly ModelInvocationReason[]): readonly ModelInvocationReason[] {
  return Object.freeze(reasons.map((reason) => Object.freeze({ ...reason })));
}

function isMessageRole(input: unknown): input is ModelInvocationMessageRole {
  return includesValue(modelInvocationMessageRoles, input);
}

export function isModelInvocationMessageRole(input: unknown): input is ModelInvocationMessageRole { return isMessageRole(input); }
export function parseModelInvocationMessageRole(input: unknown): ModelInvocationMessageRole | null { return isMessageRole(input) ? input : null; }
export function isModelInvocationStatus(input: unknown): input is ModelInvocationStatus { return includesValue(modelInvocationStatuses, input); }
export function parseModelInvocationStatus(input: unknown): ModelInvocationStatus | null { return isModelInvocationStatus(input) ? input : null; }
export function isModelInvocationResultStatus(input: unknown): input is ModelInvocationResultStatus { return includesValue(modelInvocationResultStatuses, input); }
export function parseModelInvocationResultStatus(input: unknown): ModelInvocationResultStatus | null { return isModelInvocationResultStatus(input) ? input : null; }
export function isModelInvocationFinishReason(input: unknown): input is ModelInvocationFinishReason { return includesValue(modelInvocationFinishReasons, input); }
export function parseModelInvocationFinishReason(input: unknown): ModelInvocationFinishReason | null { return isModelInvocationFinishReason(input) ? input : null; }
export function isModelInvocationVerdict(input: unknown): input is ModelInvocationVerdict { return includesValue(modelInvocationVerdicts, input); }
export function parseModelInvocationVerdict(input: unknown): ModelInvocationVerdict | null { return isModelInvocationVerdict(input) ? input : null; }
export function isModelInvocationErrorCategory(input: unknown): input is ModelInvocationErrorCategory { return includesValue(modelInvocationErrorCategories, input); }
export function parseModelInvocationErrorCategory(input: unknown): ModelInvocationErrorCategory | null { return isModelInvocationErrorCategory(input) ? input : null; }

function normalizeMessages(input: unknown, path: string, reasons: MutableReasons): readonly ModelInvocationMessage[] | null {
  if (!isOrdinaryArray(input) || input.length === 0 || input.length > modelInvocationLimits.maxMessages) {
    addReason(reasons, isOrdinaryArray(input) && input.length > modelInvocationLimits.maxMessages ? "limit_exceeded" : "invalid_input", path, "messages must be a non-empty bounded ordinary array.");
    return null;
  }
  const output: ModelInvocationMessage[] = [];
  const toolCallIds = new Set<string>();
  let seenNonSystem = false;
  let seenUser = false;
  for (const [index, value] of input.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isPlainRecord(value) || !exactFields(value, messageFields)) {
      addReason(reasons, "invalid_input", itemPath, "Message must contain only role, content, and toolCallId.");
      continue;
    }
    const role = own(value, "role");
    const content = boundedText(own(value, "content"), modelInvocationLimits.maxMessageLength, true);
    const rawToolCallId = own(value, "toolCallId");
    const toolCallId = rawToolCallId === null ? null : stableId(rawToolCallId);
    if (!isMessageRole(role)) addReason(reasons, "invalid_input", `${itemPath}.role`, "Message role is invalid.");
    if (content === null) addReason(reasons, "invalid_input", `${itemPath}.content`, "Message content is invalid or oversized.");
    if ((role === "tool" && toolCallId === null) || (role !== "tool" && rawToolCallId !== null)) addReason(reasons, "invalid_input", `${itemPath}.toolCallId`, "toolCallId is required only for tool messages.");
    if (toolCallId && toolCallIds.has(toolCallId)) addReason(reasons, "invalid_input", `${itemPath}.toolCallId`, "toolCallId must be unique among tool messages.");
    if (toolCallId) toolCallIds.add(toolCallId);
    if (isMessageRole(role)) {
      if (role === "system") {
        if (seenNonSystem) addReason(reasons, "invalid_message_sequence", `${itemPath}.role`, "system messages are allowed only in the leading system prefix.");
      } else {
        if (!seenNonSystem) {
          seenNonSystem = true;
          if (role !== "user" && role !== "tool") addReason(reasons, "invalid_message_sequence", `${itemPath}.role`, "The first non-system message must be user.");
        }
        if (role === "user") seenUser = true;
        else if (role === "assistant" && !seenUser) addReason(reasons, "invalid_message_sequence", `${itemPath}.role`, "assistant cannot appear before the first user message.");
        else if (role === "tool") addReason(reasons, "unverified_tool_message", itemPath, "tool messages require a factual prior tool-call result that admission does not receive.");
      }
    }
    if (isMessageRole(role) && content !== null && ((role === "tool" && toolCallId !== null) || (role !== "tool" && rawToolCallId === null))) output.push({ role, content, toolCallId });
  }
  if (!seenUser) addReason(reasons, "invalid_message_sequence", path, "messages must contain a user message after the optional leading system prefix.");
  return reasons.length === 0 ? Object.freeze(output.map((message) => Object.freeze(message))) : null;
}

function normalizeIdList(input: unknown, path: string, maximum: number, reasons: MutableReasons, sort: boolean): readonly string[] | null {
  if (!isOrdinaryArray(input) || input.length > maximum) {
    addReason(reasons, isOrdinaryArray(input) && input.length > maximum ? "limit_exceeded" : "invalid_input", path, "Value must be a bounded ordinary ID array.");
    return null;
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of input.entries()) {
    const id = stableId(value);
    if (id === null || seen.has(id)) addReason(reasons, "invalid_input", `${path}[${index}]`, "Value must be a unique stable ID.");
    else { seen.add(id); output.push(id); }
  }
  if (reasons.length > 0) return null;
  if (sort) output.sort();
  return Object.freeze(output);
}

function requestDeny(reasons: readonly ModelInvocationReason[]): ModelInvocationRequestValidationDecision {
  return deepFreeze({ verdict: "deny", reasons: frozenReasons(reasons), normalizedRequest: null });
}

function normalizeRequestData(input: unknown, path = "$"): ModelInvocationRequestValidationDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !exactFields(input, requestFields)) {
    addReason(reasons, "invalid_input", path, "ModelInvocationRequest has missing or unknown fields.");
    return requestDeny(reasons);
  }
  const ids = Object.fromEntries([
    "invocationId", "runId", "requestId", "workspaceId", "projectId", "departmentId", "workflowId", "workflowBindingId",
    "agentId", "agentBindingId", "stepId", "modelProfileId", "instructionProfileId",
  ].map((key) => [key, stableId(own(input, key))])) as Record<string, string | null>;
  for (const [key, value] of Object.entries(ids)) if (value === null) addReason(reasons, "invalid_input", `${path === "$" ? "" : `${path}.`}${key}`, `${key} must be a stable ID.`);
  const invocationSequence = safeInteger(own(input, "invocationSequence"), 1);
  const runRevision = safeInteger(own(input, "runRevision"), 0);
  const attemptNumber = safeInteger(own(input, "attemptNumber"), 1);
  if (invocationSequence === null) addReason(reasons, "invalid_input", `${path}.invocationSequence`, "invocationSequence must be a positive safe integer.");
  if (runRevision === null) addReason(reasons, "invalid_input", `${path}.runRevision`, "runRevision must be a non-negative safe integer.");
  if (attemptNumber === null) addReason(reasons, "invalid_input", `${path}.attemptNumber`, "attemptNumber must be a positive safe integer.");
  const messages = normalizeMessages(own(input, "messages"), `${path}.messages`, reasons);
  const contextArtifactIds = normalizeIdList(own(input, "contextArtifactIds"), `${path}.contextArtifactIds`, modelInvocationLimits.maxContextArtifactIds, reasons, true);
  const toolIds = normalizeIdList(own(input, "toolIds"), `${path}.toolIds`, workflowManifestLimits.maxToolIds, reasons, true);
  const outputType = own(input, "outputType");
  const actionMode = own(input, "actionMode");
  const requiredRaw = own(input, "requiredApprovalAction");
  const requiredApprovalAction = requiredRaw === null ? null : boundedText(requiredRaw, workflowManifestLimits.maxTextListItemLength);
  if (!includesValue(agentOutputTypes, outputType)) addReason(reasons, "invalid_input", `${path}.outputType`, "outputType is invalid.");
  if (!includesValue(workflowActionModes, actionMode)) addReason(reasons, "invalid_input", `${path}.actionMode`, "actionMode is invalid.");
  if (requiredRaw !== null && requiredApprovalAction === null) addReason(reasons, "invalid_input", `${path}.requiredApprovalAction`, "requiredApprovalAction must be null or bounded canonical text.");
  if (reasons.length > 0 || Object.values(ids).some((value) => value === null) || invocationSequence === null || runRevision === null || attemptNumber === null || !messages || !contextArtifactIds || !toolIds || !includesValue(agentOutputTypes, outputType) || !includesValue(workflowActionModes, actionMode)) return requestDeny(reasons);
  const normalized: ModelInvocationRequest = {
    invocationId: ids.invocationId as string, invocationSequence, runId: ids.runId as string, runRevision,
    requestId: ids.requestId as string, workspaceId: ids.workspaceId as string, projectId: ids.projectId as string,
    departmentId: ids.departmentId as string, workflowId: ids.workflowId as string, workflowBindingId: ids.workflowBindingId as string,
    agentId: ids.agentId as string, agentBindingId: ids.agentBindingId as string, stepId: ids.stepId as string,
    attemptNumber, modelProfileId: ids.modelProfileId as string, instructionProfileId: ids.instructionProfileId as string,
    outputType, messages, contextArtifactIds, toolIds, actionMode, requiredApprovalAction,
  };
  return deepFreeze({ verdict: "allow", reasons: [], normalizedRequest: normalized });
}

export function validateAndNormalizeModelInvocationRequest(input: unknown): ModelInvocationRequestValidationDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) {
    const reasons: MutableReasons = [];
    addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Request exceeds bounded inspection limits." : "Request could not be safely inspected.");
    return requestDeny(reasons);
  }
  try { return normalizeRequestData(snapshot.value); }
  catch { const reasons: MutableReasons = []; addReason(reasons, "invalid_input", "$", "Request could not be safely validated."); return requestDeny(reasons); }
}

function admissionDeny(reasons: readonly ModelInvocationReason[], snapshotDecision: WorkflowRunSnapshotValidationDecision | null): ModelInvocationAdmissionDecision {
  return deepFreeze({ verdict: "deny", status: "denied", reasons: frozenReasons(reasons), snapshotDecision, normalizedRequest: null });
}

function stepFacts(snapshot: WorkflowRunSnapshot, stepId: string, reasons: MutableReasons, context?: Partial<ModelInvocationRequest>) {
  const step = snapshot.executionProfile.steps.find((candidate) => candidate.id === stepId);
  if (!step) { addReason(reasons, "step_not_found", "draft.stepId", "Step does not exist in the Workflow execution profile.", context); return null; }
  if (step.kind !== "agent_task") { addReason(reasons, "wrong_step_kind", "draft.stepId", "Only an Agent task can admit a model invocation.", context); return null; }
  const state = snapshot.stepStates.find((candidate) => candidate.stepId === stepId);
  if (!state) { addReason(reasons, "step_not_found", "snapshot.stepStates", "Step state does not exist.", context); return null; }
  return { step, state };
}

function factualRequest(
  snapshot: WorkflowRunSnapshot,
  draft: ModelInvocationDraft,
  facts: NonNullable<ReturnType<typeof stepFacts>> & Readonly<{ agent: WorkflowRunSnapshot["executionProfile"]["agents"][number] }>,
): ModelInvocationRequest {
  return {
    invocationId: draft.invocationId, invocationSequence: draft.invocationSequence, runId: snapshot.runId,
    runRevision: snapshot.revision, requestId: snapshot.requestId, workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId, departmentId: snapshot.departmentId, workflowId: snapshot.workflowId,
    workflowBindingId: snapshot.workflowBindingId, agentId: facts.step.agentId, agentBindingId: facts.step.agentBindingId,
    stepId: facts.step.id, attemptNumber: facts.state.attemptCount, modelProfileId: facts.step.modelProfileId,
    instructionProfileId: facts.agent.instructionProfileId, outputType: facts.step.outputType,
    messages: draft.messages, contextArtifactIds: draft.contextArtifactIds,
    toolIds: Object.freeze([...facts.step.toolIds].sort()), actionMode: facts.step.actionMode,
    requiredApprovalAction: facts.step.requiredApprovalAction,
  };
}

function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameData(value, right[index]));
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const leftKeys = Object.keys(left); const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && sameData(left[key], right[key]));
  }
  return false;
}

function sameRequestExceptRunRevision(left: ModelInvocationRequest, right: ModelInvocationRequest): boolean {
  return requestFields.every((field) => field === "runRevision" || sameData(left[field], right[field]));
}

function currentAttemptStartRevision(
  snapshot: WorkflowRunSnapshot,
  stepId: string,
  attemptNumber: number,
): number | null {
  let observedAttempts = 0;
  for (const event of snapshot.events) {
    if (event.kind !== "step_started" || event.stepId !== stepId) continue;
    observedAttempts += 1;
    if (observedAttempts === attemptNumber) return event.sequence;
  }
  return null;
}

function isRunRevisionInCurrentAttemptWindow(
  snapshot: WorkflowRunSnapshot,
  stepId: string,
  attemptNumber: number,
  runRevision: number,
): boolean {
  const attemptStartRevision = currentAttemptStartRevision(snapshot, stepId, attemptNumber);
  return attemptStartRevision !== null
    && runRevision >= attemptStartRevision
    && runRevision <= snapshot.revision;
}

function normalizeDraft(input: unknown, reasons: MutableReasons): ModelInvocationDraft | null {
  if (!isPlainRecord(input) || !exactFields(input, draftFields)) { addReason(reasons, "invalid_draft", "draft", "Draft has missing or unknown fields."); return null; }
  const invocationId = stableId(own(input, "invocationId"));
  const invocationSequence = safeInteger(own(input, "invocationSequence"), 1);
  const stepId = stableId(own(input, "stepId"));
  if (!invocationId) addReason(reasons, "invalid_draft", "draft.invocationId", "invocationId must be a stable ID.");
  if (invocationSequence === null) addReason(reasons, "invalid_draft", "draft.invocationSequence", "invocationSequence must be a positive safe integer.");
  if (!stepId) addReason(reasons, "invalid_draft", "draft.stepId", "stepId must be a stable ID.");
  const messages = normalizeMessages(own(input, "messages"), "draft.messages", reasons);
  const contextArtifactIds = normalizeIdList(own(input, "contextArtifactIds"), "draft.contextArtifactIds", modelInvocationLimits.maxContextArtifactIds, reasons, true);
  return reasons.length === 0 && invocationId && invocationSequence !== null && stepId && messages && contextArtifactIds
    ? { invocationId, invocationSequence, stepId, messages, contextArtifactIds } : null;
}

function requestAbsoluteLimits(input: unknown, path: string, reasons: MutableReasons): void {
  if (!isPlainRecord(input)) return;
  const messages = own(input, "messages"); const artifacts = own(input, "contextArtifactIds"); const tools = own(input, "toolIds");
  if (isOrdinaryArray(messages)) {
    if (messages.length > modelInvocationLimits.maxMessages) addReason(reasons, "limit_exceeded", `${path}.messages`, "messages exceeds the absolute collection limit.");
    for (const [index, message] of messages.entries()) if (isPlainRecord(message)) {
      const content = own(message, "content");
      if (typeof content === "string" && content.length > modelInvocationLimits.maxMessageLength) addReason(reasons, "limit_exceeded", `${path}.messages[${index}].content`, "Message content exceeds the absolute string limit.");
    }
  }
  if (isOrdinaryArray(artifacts) && artifacts.length > modelInvocationLimits.maxContextArtifactIds) addReason(reasons, "limit_exceeded", `${path}.contextArtifactIds`, "contextArtifactIds exceeds the absolute collection limit.");
  if (isOrdinaryArray(tools) && tools.length > workflowManifestLimits.maxToolIds) addReason(reasons, "limit_exceeded", `${path}.toolIds`, "toolIds exceeds the canonical Workflow limit.");
}

function invocationTuple(request: ModelInvocationRequest): string {
  return `${request.runId}\u0000${request.stepId}\u0000${request.attemptNumber}\u0000${request.invocationSequence}`;
}

function evaluateAdmissionData(input: unknown): ModelInvocationAdmissionDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !exactFields(input, admissionFields)) { addReason(reasons, "invalid_input", "$", "Admission input has missing or unknown fields."); return admissionDeny(reasons, null); }
  const preflightExisting = own(input, "existingRequests");
  const preflightDraft = own(input, "draft");
  if (isOrdinaryArray(preflightExisting) && preflightExisting.length > modelInvocationLimits.maxExistingRequests) addReason(reasons, "limit_exceeded", "existingRequests", "existingRequests exceeds the absolute collection limit.");
  requestAbsoluteLimits(preflightDraft, "draft", reasons);
  if (isOrdinaryArray(preflightExisting) && preflightExisting.length <= modelInvocationLimits.maxExistingRequests) for (const [index, request] of preflightExisting.entries()) requestAbsoluteLimits(request, `existingRequests[${index}]`, reasons);
  if (reasons.length > 0) return admissionDeny(reasons, null);
  const snapshotDecision = validateAndNormalizeWorkflowRunSnapshot(own(input, "snapshot"));
  if (snapshotDecision.verdict !== "allow" || !snapshotDecision.normalizedSnapshot) {
    addReason(reasons, "invalid_workflow_run_snapshot", "snapshot", "Workflow Run snapshot validation denied.");
    return admissionDeny(reasons, snapshotDecision);
  }
  const existingInput = preflightExisting;
  if (!isOrdinaryArray(existingInput) || existingInput.length > modelInvocationLimits.maxExistingRequests) {
    addReason(reasons, isOrdinaryArray(existingInput) ? "limit_exceeded" : "invalid_existing_request", "existingRequests", "existingRequests must be a bounded ordinary array.");
    return admissionDeny(reasons, snapshotDecision);
  }
  const wrappers: Array<{ path: string; value: ModelInvocationRequest }> = [];
  for (const [index, value] of existingInput.entries()) {
    const decision = normalizeRequestData(value, `existingRequests[${index}]`);
    if (!decision.normalizedRequest) {
      for (const reason of decision.reasons) reasons.push({ ...reason, code: reason.code === "limit_exceeded" ? "limit_exceeded" : "invalid_existing_request" });
    } else wrappers.push({ path: `existingRequests[${index}]`, value: decision.normalizedRequest });
  }
  if (reasons.length > 0) return admissionDeny(reasons, snapshotDecision);
  wrappers.sort((left, right) => compareStrings(left.value.invocationId, right.value.invocationId) || compareStrings(invocationTuple(left.value), invocationTuple(right.value)));
  for (let index = 1; index < wrappers.length; index += 1) {
    const previous = wrappers[index - 1]; const current = wrappers[index];
    if (previous && current && previous.value.invocationId === current.value.invocationId) addReason(reasons, "invalid_existing_request", current.path, "Existing invocationId values must be globally unique.", current.value);
  }
  const tupleWrappers = [...wrappers].sort((left, right) => compareStrings(invocationTuple(left.value), invocationTuple(right.value)) || compareStrings(left.value.invocationId, right.value.invocationId));
  for (let index = 1; index < tupleWrappers.length; index += 1) {
    const previous = tupleWrappers[index - 1]; const current = tupleWrappers[index];
    if (previous && current && invocationTuple(previous.value) === invocationTuple(current.value)) addReason(reasons, "invalid_existing_request", current.path, "Existing invocation tuples must be globally unique.", current.value);
  }
  if (reasons.length > 0) return admissionDeny(reasons, snapshotDecision);
  const draft = normalizeDraft(own(input, "draft"), reasons);
  if (!draft) return admissionDeny(reasons, snapshotDecision);
  const snapshot = snapshotDecision.normalizedSnapshot;
  const baseContext = { invocationId: draft.invocationId, runId: snapshot.runId, requestId: snapshot.requestId, projectId: snapshot.projectId, departmentId: snapshot.departmentId, workflowId: snapshot.workflowId, stepId: draft.stepId };
  const rawStep = snapshot.executionProfile.steps.find((step) => step.id === draft.stepId);
  const rawState = snapshot.stepStates.find((state) => state.stepId === draft.stepId);
  const rawAgent = rawStep?.kind === "agent_task"
    ? snapshot.executionProfile.agents.find((agent) => agent.agentId === rawStep.agentId && agent.bindingId === rawStep.agentBindingId)
    : undefined;
  const candidate = rawStep?.kind === "agent_task" && rawState && rawAgent
    ? factualRequest(snapshot, draft, { step: rawStep, state: rawState, agent: rawAgent })
    : null;
  if (candidate) {
    const sameId = wrappers.filter((entry) => entry.value.invocationId === candidate.invocationId);
    const sameTuple = wrappers.filter((entry) => invocationTuple(entry.value) === invocationTuple(candidate));
    const replay = wrappers.find((entry) => sameRequestExceptRunRevision(entry.value, candidate));
    const replayRevisionValid = replay
      ? isRunRevisionInCurrentAttemptWindow(snapshot, candidate.stepId, candidate.attemptNumber, replay.value.runRevision)
      : false;
    if (replay && !replayRevisionValid) {
      addReason(reasons, "invalid_run_revision", `${replay.path}.runRevision`, "Existing request runRevision is outside the current Agent attempt revision window.", replay.value);
      return admissionDeny(reasons, snapshotDecision);
    }
    if (replay && sameId.length === 1 && sameTuple.length === 1
      && snapshot.status === "running" && rawState?.status === "running"
      && rawState.attemptCount === replay.value.attemptNumber) {
      return deepFreeze({ verdict: "idempotent", status: "idempotent", reasons: [], snapshotDecision, normalizedRequest: cloneJson(replay.value) });
    }
    if ((sameId.length > 0 || sameTuple.length > 0) && !(replay && replayRevisionValid)) {
      const code = sameId.length > 0 && sameTuple.length > 0
        ? "conflicting_replay"
        : sameId.length > 0 ? "duplicate_invocation_id" : "duplicate_invocation_tuple";
      addReason(reasons, code, `${(sameId[0] ?? sameTuple[0])?.path ?? "existingRequests"}`, "Invocation identity collides with a non-identical request.", candidate);
      return admissionDeny(reasons, snapshotDecision);
    }
  }
  if (snapshot.status !== "running") {
    addReason(reasons, "run_not_running", "snapshot.status", "Workflow Run must be running.", candidate ?? baseContext);
    return admissionDeny(reasons, snapshotDecision);
  }
  const step = stepFacts(snapshot, draft.stepId, reasons, baseContext);
  if (!step) return admissionDeny(reasons, snapshotDecision);
  if (step.state.status !== "running") addReason(reasons, "step_not_running", "snapshot.stepStates", "Agent step must be running.", candidate ?? baseContext);
  if (step.state.attemptCount < 1) addReason(reasons, "invalid_attempt", "snapshot.stepStates.attemptCount", "Running Agent step must have a positive attempt count.", candidate ?? baseContext);
  if (reasons.length > 0) return admissionDeny(reasons, snapshotDecision);
  const agent = snapshot.executionProfile.agents.find((entry) => entry.agentId === step.step.agentId && entry.bindingId === step.step.agentBindingId);
  if (!agent) {
    addReason(reasons, "agent_not_found", "snapshot.executionProfile.agents", "Exact Agent binding was not found.", { ...baseContext, agentId: step.step.agentId });
    return admissionDeny(reasons, snapshotDecision);
  }
  const facts = { ...step, agent };
  const admittedCandidate = candidate ?? factualRequest(snapshot, draft, facts);
  if (facts.agent.projectId !== snapshot.projectId || facts.agent.departmentId !== snapshot.departmentId || !facts.agent.allowedWorkflowIds.includes(snapshot.workflowId) || facts.agent.agentId !== facts.step.agentId || facts.agent.bindingId !== facts.step.agentBindingId) addReason(reasons, "agent_linkage_mismatch", "snapshot.executionProfile.agents", "Agent identity does not match the Workflow Run and Step.", admittedCandidate);
  if (!snapshot.executionProfile.modelProfileIds.includes(facts.step.modelProfileId) || !facts.agent.allowedModelProfileIds.includes(facts.step.modelProfileId)) addReason(reasons, "model_not_allowed", "snapshot.executionProfile.steps.modelProfileId", "Step model is not allowed by Workflow and Agent grants.", admittedCandidate);
  if (!facts.step.toolIds.every((toolId) => facts.agent.allowedToolIds.includes(toolId))) addReason(reasons, "tool_not_allowed", "snapshot.executionProfile.steps.toolIds", "Step tools exceed Agent grants.", admittedCandidate);
  if (!facts.agent.outputTypes.includes(facts.step.outputType)) addReason(reasons, "output_not_allowed", "snapshot.executionProfile.steps.outputType", "Step output type exceeds Agent grants.", admittedCandidate);
  if (reasons.length > 0) return admissionDeny(reasons, snapshotDecision);
  return deepFreeze({ verdict: "allow", status: "admitted", reasons: [], snapshotDecision, normalizedRequest: admittedCandidate });
}

export function evaluateModelInvocationAdmission(input: unknown): ModelInvocationAdmissionDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) { const reasons: MutableReasons = []; addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Admission exceeds bounded inspection limits." : "Admission could not be safely inspected."); return admissionDeny(reasons, null); }
  try { return evaluateAdmissionData(snapshot.value); }
  catch { const reasons: MutableReasons = []; addReason(reasons, "invalid_input", "$", "Admission could not be safely evaluated."); return admissionDeny(reasons, null); }
}

function normalizeJson(input: unknown, path: string, reasons: MutableReasons, state: { properties: number }, depth = 0): JsonValue | undefined {
  if (depth > modelInvocationLimits.maxJsonDepth) { addReason(reasons, "limit_exceeded", path, "JSON value exceeds maximum depth."); return undefined; }
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") { if (Number.isFinite(input)) return input; addReason(reasons, "invalid_result", path, "JSON number must be finite."); return undefined; }
  if (typeof input === "string") { if (input.length <= modelInvocationLimits.maxJsonStringLength && !nonNewlineControlPattern.test(input)) return input; addReason(reasons, "limit_exceeded", path, "JSON string is oversized or unsafe."); return undefined; }
  if (isOrdinaryArray(input)) {
    if (input.length > modelInvocationLimits.maxJsonArrayLength) { addReason(reasons, "limit_exceeded", path, "JSON array is oversized."); return undefined; }
    const output: JsonValue[] = [];
    for (const [index, value] of input.entries()) { const normalized = normalizeJson(value, `${path}[${index}]`, reasons, state, depth + 1); if (normalized === undefined) return undefined; output.push(normalized); }
    return Object.freeze(output);
  }
  if (isPlainRecord(input)) {
    const keys = Object.keys(input).sort(); state.properties += keys.length;
    if (state.properties > modelInvocationLimits.maxJsonProperties) { addReason(reasons, "limit_exceeded", path, "JSON object exceeds property limits."); return undefined; }
    const output: Record<string, JsonValue> = {};
    for (const key of keys) { if (boundedText(key, modelInvocationLimits.maxIdLength) === null) { addReason(reasons, "invalid_result", path, "JSON property name is invalid."); return undefined; } const normalized = normalizeJson(input[key], `${path}.${key}`, reasons, state, depth + 1); if (normalized === undefined) return undefined; output[key] = normalized; }
    return Object.freeze(output);
  }
  addReason(reasons, "invalid_result", path, "Value must be JSON-compatible."); return undefined;
}

function resultDeny(reasons: readonly ModelInvocationReason[]): ModelInvocationResultValidationDecision {
  return deepFreeze({ verdict: "deny", reasons: frozenReasons(reasons), normalizedResult: null });
}

function normalizeResultData(input: unknown, path = "result"): ModelInvocationResultValidationDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !exactFields(input, resultFields)) { addReason(reasons, "invalid_result", path, "ModelInvocationResult has missing or unknown fields."); return resultDeny(reasons); }
  const invocationId = stableId(own(input, "invocationId"));
  const outcome = own(input, "outcome"); const finishReason = own(input, "finishReason");
  const providerId = boundedAuditIdentifier(own(input, "providerId"));
  const providerModelId = boundedAuditIdentifier(own(input, "providerModelId"));
  const providerRequestModelId = boundedAuditIdentifier(own(input, "providerRequestModelId"));
  const providerModelVersion = boundedAuditIdentifier(own(input, "providerModelVersion"));
  if (!invocationId) addReason(reasons, "invalid_result", `${path}.invocationId`, "invocationId must be a stable ID.");
  if (!includesValue(modelInvocationResultStatuses, outcome)) addReason(reasons, "invalid_result", `${path}.outcome`, "Result outcome is invalid.");
  if (!includesValue(modelInvocationFinishReasons, finishReason)) addReason(reasons, "invalid_result", `${path}.finishReason`, "finishReason is invalid.");
  for (const [key, value] of [["providerId", providerId], ["providerModelId", providerModelId], ["providerRequestModelId", providerRequestModelId], ["providerModelVersion", providerModelVersion]] as const) if (value === null) addReason(reasons, "invalid_result", `${path}.${key}`, `${key} is invalid.`);
  const outputRaw = own(input, "outputText"); const outputText = outputRaw === null ? null : boundedText(outputRaw, modelInvocationLimits.maxOutputTextLength, true);
  if (outputRaw !== null && outputText === null) addReason(reasons, "limit_exceeded", `${path}.outputText`, "outputText is invalid or oversized.");
  const structuredRaw = own(input, "structuredOutput");
  const structuredOutput = structuredRaw === null ? null : normalizeJson(structuredRaw, `${path}.structuredOutput`, reasons, { properties: 0 });
  const proposalsRaw = own(input, "toolCallProposals"); const proposals: ModelInvocationToolCallProposal[] = []; const callIds = new Set<string>();
  if (!isOrdinaryArray(proposalsRaw) || proposalsRaw.length > modelInvocationLimits.maxToolCallProposals) addReason(reasons, isOrdinaryArray(proposalsRaw) ? "limit_exceeded" : "invalid_result", `${path}.toolCallProposals`, "toolCallProposals must be a bounded ordinary array.");
  else for (const [index, value] of proposalsRaw.entries()) {
    const itemPath = `${path}.toolCallProposals[${index}]`;
    if (!isPlainRecord(value) || !exactFields(value, proposalFields)) { addReason(reasons, "invalid_result", itemPath, "Tool-call proposal shape is invalid."); continue; }
    const toolCallId = stableId(own(value, "toolCallId")); const toolId = stableId(own(value, "toolId"));
    if (!toolCallId || !toolId) addReason(reasons, "invalid_result", itemPath, "Tool-call IDs must be stable IDs.");
    if (toolCallId && callIds.has(toolCallId)) addReason(reasons, "duplicate_tool_call_id", `${itemPath}.toolCallId`, "toolCallId must be unique.");
    const args = normalizeJson(own(value, "arguments"), `${itemPath}.arguments`, reasons, { properties: 0 });
    if (toolCallId && toolId && args !== undefined && !callIds.has(toolCallId)) { callIds.add(toolCallId); proposals.push({ toolCallId, toolId, arguments: args }); }
  }
  const usageRaw = own(input, "usage"); let usage: ModelInvocationUsage | null = null;
  if (!isPlainRecord(usageRaw) || !exactFields(usageRaw, usageFields)) addReason(reasons, "invalid_result", `${path}.usage`, "usage shape is invalid.");
  else {
    const inputTokens = safeInteger(own(usageRaw, "inputTokens"), 0, modelInvocationLimits.maxTokenCount);
    const outputTokens = safeInteger(own(usageRaw, "outputTokens"), 0, modelInvocationLimits.maxTokenCount);
    const totalTokens = safeInteger(own(usageRaw, "totalTokens"), 0, modelInvocationLimits.maxTokenCount);
    if (inputTokens === null || outputTokens === null || totalTokens === null) addReason(reasons, "invalid_result", `${path}.usage`, "Token counts must be bounded non-negative safe integers.");
    else if (inputTokens + outputTokens !== totalTokens) addReason(reasons, "usage_mismatch", `${path}.usage.totalTokens`, "totalTokens must equal inputTokens plus outputTokens.");
    else usage = { inputTokens, outputTokens, totalTokens };
  }
  const latencyMs = safeInteger(own(input, "latencyMs"), 0, modelInvocationLimits.maxLatencyMs);
  const costUsdMicros = safeInteger(own(input, "costUsdMicros"), 0, modelInvocationLimits.maxCostUsdMicros);
  if (latencyMs === null) addReason(reasons, "invalid_result", `${path}.latencyMs`, "latencyMs must be a bounded non-negative safe integer.");
  if (costUsdMicros === null) addReason(reasons, "invalid_result", `${path}.costUsdMicros`, "costUsdMicros must be a bounded non-negative safe integer.");
  const errorRaw = own(input, "error"); let error: ModelInvocationProviderError | null = null;
  if (errorRaw !== null) {
    if (!isPlainRecord(errorRaw) || !exactFields(errorRaw, providerErrorFields)) addReason(reasons, "invalid_result", `${path}.error`, "Provider error shape is invalid.");
    else {
      const category = own(errorRaw, "category"); const code = boundedText(own(errorRaw, "code"), modelInvocationLimits.maxErrorCodeLength); const message = boundedText(own(errorRaw, "message"), modelInvocationLimits.maxErrorMessageLength); const retryable = own(errorRaw, "retryable");
      if (!includesValue(modelInvocationErrorCategories, category) || code === null || message === null || typeof retryable !== "boolean") addReason(reasons, "invalid_result", `${path}.error`, "Provider error fields are invalid.");
      else error = { category, code, message, retryable };
    }
  }
  if (includesValue(modelInvocationResultStatuses, outcome) && includesValue(modelInvocationFinishReasons, finishReason)) {
    const hasMeaningfulText = outputText !== null && outputText.trim().length > 0;
    const hasOutput = hasMeaningfulText || structuredRaw !== null || proposals.length > 0;
    if (outcome === "succeeded" && (errorRaw !== null || finishReason === "error" || finishReason === "content_filter" || !hasOutput || (finishReason === "tool_calls") !== (proposals.length > 0))) addReason(reasons, "invalid_result_invariants", path, "Successful result output, finish reason, proposals, and error are inconsistent.");
    if (outcome === "failed") {
      const contentFiltered = finishReason === "content_filter" && error?.category === "content_filtered";
      const ordinaryFailure = finishReason === "error" && error !== null && error.category !== "content_filtered";
      if ((!contentFiltered && !ordinaryFailure) || outputRaw !== null || structuredRaw !== null || proposals.length > 0) addReason(reasons, "invalid_result_invariants", path, "Failed result must contain a matching structured error and no successful output.");
    }
  }
  proposals.sort((left, right) => compareStrings(left.toolCallId, right.toolCallId));
  if (reasons.length > 0 || !invocationId || !includesValue(modelInvocationResultStatuses, outcome) || !includesValue(modelInvocationFinishReasons, finishReason) || !providerId || !providerModelId || !providerRequestModelId || !providerModelVersion || structuredOutput === undefined || !usage || latencyMs === null || costUsdMicros === null) return resultDeny(reasons);
  return deepFreeze({ verdict: "allow", reasons: [], normalizedResult: { invocationId, outcome, finishReason, providerId, providerModelId, providerRequestModelId, providerModelVersion, outputText, structuredOutput, toolCallProposals: proposals, usage, latencyMs, costUsdMicros, error } });
}

export function validateAndNormalizeModelInvocationResult(input: unknown): ModelInvocationResultValidationDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) { const reasons: MutableReasons = []; addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Result exceeds bounded inspection limits." : "Result could not be safely inspected."); return resultDeny(reasons); }
  try { return normalizeResultData(snapshot.value, "$"); }
  catch { const reasons: MutableReasons = []; addReason(reasons, "invalid_input", "$", "Result could not be safely validated."); return resultDeny(reasons); }
}

function resultEvaluationDeny(reasons: readonly ModelInvocationReason[], snapshotDecision: WorkflowRunSnapshotValidationDecision | null): ModelInvocationResultDecision {
  return deepFreeze({ verdict: "deny", reasons: frozenReasons(reasons), snapshotDecision, normalizedRequest: null, normalizedResult: null });
}

function jsonAbsoluteLimitExceeded(input: unknown, state: { properties: number }, depth = 0): boolean {
  if (depth > modelInvocationLimits.maxJsonDepth) return true;
  if (typeof input === "string") return input.length > modelInvocationLimits.maxJsonStringLength;
  if (isOrdinaryArray(input)) {
    if (input.length > modelInvocationLimits.maxJsonArrayLength) return true;
    return input.some((value) => jsonAbsoluteLimitExceeded(value, state, depth + 1));
  }
  if (isPlainRecord(input)) {
    const keys = Object.keys(input); state.properties += keys.length;
    if (state.properties > modelInvocationLimits.maxJsonProperties) return true;
    return keys.some((key) => key.length > modelInvocationLimits.maxIdLength || jsonAbsoluteLimitExceeded(input[key], state, depth + 1));
  }
  return false;
}

function resultAbsoluteLimits(input: unknown, reasons: MutableReasons): void {
  if (!isPlainRecord(input)) return;
  const outputText = own(input, "outputText"); const structured = own(input, "structuredOutput"); const proposals = own(input, "toolCallProposals");
  if (typeof outputText === "string" && outputText.length > modelInvocationLimits.maxOutputTextLength) addReason(reasons, "limit_exceeded", "result.outputText", "outputText exceeds the absolute string limit.");
  if (structured !== null && jsonAbsoluteLimitExceeded(structured, { properties: 0 })) addReason(reasons, "limit_exceeded", "result.structuredOutput", "structuredOutput exceeds absolute JSON limits.");
  if (isOrdinaryArray(proposals)) {
    if (proposals.length > modelInvocationLimits.maxToolCallProposals) addReason(reasons, "limit_exceeded", "result.toolCallProposals", "toolCallProposals exceeds the absolute collection limit.");
    for (const [index, proposal] of proposals.entries()) if (isPlainRecord(proposal) && jsonAbsoluteLimitExceeded(own(proposal, "arguments"), { properties: 0 })) addReason(reasons, "limit_exceeded", `result.toolCallProposals[${index}].arguments`, "Tool-call arguments exceed absolute JSON limits.");
  }
}

function evaluateResultData(input: unknown): ModelInvocationResultDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !exactFields(input, resultEvaluationFields)) { addReason(reasons, "invalid_input", "$", "Result evaluation input has missing or unknown fields."); return resultEvaluationDeny(reasons, null); }
  requestAbsoluteLimits(own(input, "request"), "request", reasons);
  resultAbsoluteLimits(own(input, "result"), reasons);
  if (reasons.length > 0) return resultEvaluationDeny(reasons, null);
  const snapshotDecision = validateAndNormalizeWorkflowRunSnapshot(own(input, "snapshot"));
  if (snapshotDecision.verdict !== "allow" || !snapshotDecision.normalizedSnapshot) { addReason(reasons, "invalid_workflow_run_snapshot", "snapshot", "Workflow Run snapshot validation denied."); return resultEvaluationDeny(reasons, snapshotDecision); }
  const requestDecision = normalizeRequestData(own(input, "request"), "request");
  if (!requestDecision.normalizedRequest) { reasons.push(...requestDecision.reasons); return resultEvaluationDeny(reasons, snapshotDecision); }
  const resultDecision = normalizeResultData(own(input, "result"), "result");
  if (!resultDecision.normalizedResult) { reasons.push(...resultDecision.reasons); return resultEvaluationDeny(reasons, snapshotDecision); }
  const snapshot = snapshotDecision.normalizedSnapshot; const request = requestDecision.normalizedRequest; const result = resultDecision.normalizedResult;
  if (result.invocationId !== request.invocationId) addReason(reasons, "invocation_id_mismatch", "result.invocationId", "Result invocationId does not match request.", request);
  const rawStep = snapshot.executionProfile.steps.find((step) => step.id === request.stepId);
  const rawState = snapshot.stepStates.find((state) => state.stepId === request.stepId);
  const rawAgent = rawStep?.kind === "agent_task"
    ? snapshot.executionProfile.agents.find((agent) => agent.agentId === rawStep.agentId && agent.bindingId === rawStep.agentBindingId)
    : undefined;
  if (!rawStep || rawStep.kind !== "agent_task" || !rawState || !rawAgent) {
    addReason(reasons, "request_identity_mismatch", "request.stepId", "Request Step does not identify a factual Agent task in the Workflow Run.", request);
    return resultEvaluationDeny(reasons, snapshotDecision);
  }
  const expected = factualRequest(
    snapshot,
    { invocationId: request.invocationId, invocationSequence: request.invocationSequence, stepId: request.stepId, messages: request.messages, contextArtifactIds: request.contextArtifactIds },
    { step: rawStep, state: rawState, agent: rawAgent },
  );
  if (!sameRequestExceptRunRevision(expected, request)) addReason(reasons, "request_identity_mismatch", "request", "Request does not match current factual Workflow Run identities and grants.", request);
  if (reasons.length > 0) return resultEvaluationDeny(reasons, snapshotDecision);
  if (!isRunRevisionInCurrentAttemptWindow(snapshot, request.stepId, request.attemptNumber, request.runRevision)) {
    addReason(reasons, "invalid_run_revision", "request.runRevision", "request.runRevision is outside the current Agent attempt revision window.", request);
    return resultEvaluationDeny(reasons, snapshotDecision);
  }
  if (snapshot.status !== "running") {
    addReason(reasons, "run_not_running", "snapshot.status", "Workflow Run no longer accepts a model result.", request);
    return resultEvaluationDeny(reasons, snapshotDecision);
  }
  if (rawState.status !== "running") {
    addReason(reasons, "step_not_running", "snapshot.stepStates", "Agent step no longer accepts a model result.", request);
    return resultEvaluationDeny(reasons, snapshotDecision);
  }
  if (rawState.attemptCount !== request.attemptNumber) {
    addReason(reasons, "invalid_attempt", "request.attemptNumber", "Request attempt does not match the current running attempt.", request);
    return resultEvaluationDeny(reasons, snapshotDecision);
  }
  if (rawAgent.projectId !== snapshot.projectId || rawAgent.departmentId !== snapshot.departmentId || !rawAgent.allowedWorkflowIds.includes(snapshot.workflowId) || rawAgent.agentId !== rawStep.agentId || rawAgent.bindingId !== rawStep.agentBindingId) {
    addReason(reasons, "agent_linkage_mismatch", "snapshot.executionProfile.agents", "Agent identity no longer matches the factual Workflow Run and Step.", request);
  }
  if (!snapshot.executionProfile.modelProfileIds.includes(rawStep.modelProfileId) || !rawAgent.allowedModelProfileIds.includes(rawStep.modelProfileId)) addReason(reasons, "model_not_allowed", "snapshot.executionProfile.steps.modelProfileId", "Step model is no longer allowed by Workflow and Agent grants.", request);
  if (!rawStep.toolIds.every((toolId) => rawAgent.allowedToolIds.includes(toolId))) addReason(reasons, "tool_not_allowed", "snapshot.executionProfile.steps.toolIds", "Step tools exceed current Agent grants.", request);
  if (!rawAgent.outputTypes.includes(rawStep.outputType)) addReason(reasons, "output_not_allowed", "snapshot.executionProfile.steps.outputType", "Step output type exceeds current Agent grants.", request);
  if (reasons.length > 0) return resultEvaluationDeny(reasons, snapshotDecision);
  const resultInput = own(input, "result") as Record<string, unknown>;
  const sourceProposals = own(resultInput, "toolCallProposals") as unknown[];
  const sourceIndexByCallId = new Map(sourceProposals.map((proposal, index) => [isPlainRecord(proposal) ? stableId(own(proposal, "toolCallId")) : null, index]));
  for (const [index, proposal] of result.toolCallProposals.entries()) if (!request.toolIds.includes(proposal.toolId)) {
    const sourceIndex = sourceIndexByCallId.get(proposal.toolCallId) ?? index;
    addReason(reasons, "tool_call_not_allowed", `result.toolCallProposals[${sourceIndex}].toolId`, "Tool-call proposal exceeds the factual request allowlist.", request);
  }
  if (reasons.length > 0) return resultEvaluationDeny(reasons, snapshotDecision);
  return deepFreeze({ verdict: "allow", reasons: [], snapshotDecision, normalizedRequest: cloneJson(request), normalizedResult: cloneJson(result) });
}

export function evaluateModelInvocationResult(input: unknown): ModelInvocationResultDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) { const reasons: MutableReasons = []; addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Result evaluation exceeds bounded inspection limits." : "Result evaluation could not be safely inspected."); return resultEvaluationDeny(reasons, null); }
  try { return evaluateResultData(snapshot.value); }
  catch { const reasons: MutableReasons = []; addReason(reasons, "invalid_input", "$", "Result evaluation could not be safely evaluated."); return resultEvaluationDeny(reasons, null); }
}
