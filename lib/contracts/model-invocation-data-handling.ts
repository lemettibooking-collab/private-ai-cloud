import { createHash } from "node:crypto";
import type { ModelInvocationMessage, ModelInvocationRequest } from "./model-invocation";
import type {
  ModelDataHandlingRequirement,
  ModelInvocationRouteCandidate,
} from "./model-provider-registry";
import type { ModelProviderIdentity } from "./model-provider-adapter";
import type { WorkflowRunSnapshot } from "./workflow-run";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelInvocationLimits, validateAndNormalizeModelInvocationRequest } from "./model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelDataHandlingRequirements, modelProviderRegistryLimits, resolveModelInvocationRoute } from "./model-provider-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData, freezeModelProviderAdapterData, snapshotModelProviderAdapterInput, validateAndNormalizeModelProviderIdentity } from "./model-provider-adapter.ts";

export const modelInvocationDataHandlingVerdicts = Object.freeze(["allow", "deny"] as const);
export type ModelInvocationDataHandlingVerdict = (typeof modelInvocationDataHandlingVerdicts)[number];
export const modelInvocationDataHandlingStatuses = Object.freeze(["ready", "denied"] as const);
export type ModelInvocationDataHandlingStatus = (typeof modelInvocationDataHandlingStatuses)[number];
export const modelInvocationEvidenceKinds = Object.freeze(["redaction", "approval"] as const);
export type ModelInvocationEvidenceKind = (typeof modelInvocationEvidenceKinds)[number];
export const modelInvocationRedactionAssessments = Object.freeze(["no_sensitive_data", "redacted"] as const);
export type ModelInvocationRedactionAssessment = (typeof modelInvocationRedactionAssessments)[number];
export const modelInvocationRedactionCategories = Object.freeze([
  "credential", "personal_data", "financial_data", "authentication_data", "internal_identifier", "confidential_data",
] as const);
export type ModelInvocationRedactionCategory = (typeof modelInvocationRedactionCategories)[number];
export const modelInvocationApprovalStatuses = Object.freeze(["approved", "rejected", "revoked"] as const);
export type ModelInvocationApprovalStatus = (typeof modelInvocationApprovalStatuses)[number];

export const modelInvocationDataHandlingLimits = Object.freeze({
  maxIdLength: modelInvocationLimits.maxIdLength,
  maxMessages: modelInvocationLimits.maxMessages,
  maxMessageLength: modelInvocationLimits.maxMessageLength,
  maxRedactionSpansPerMessage: 256,
  maxTotalRedactionSpans: 4_096,
  maxDetectorIdLength: 128,
  maxDetectorVersionLength: 64,
  maxApprovalReasonLength: 2_048,
  maxApprovalValidityMs: 30 * 24 * 60 * 60 * 1_000,
  maxReasons: modelInvocationLimits.maxValidationReasons,
  maxEnvelopeDepth: modelInvocationLimits.maxEnvelopeDepth,
  maxInspectedProperties: modelInvocationLimits.maxInspectedProperties,
  maxEnvelopeArrayLength: modelInvocationLimits.maxEnvelopeArrayLength,
  maxEnvelopeStringLength: modelInvocationLimits.maxEnvelopeStringLength,
  maxAuditIdentifierLength: modelInvocationLimits.maxProviderAuditIdLength,
  maxCandidates: modelProviderRegistryLimits.maxCandidatesPerProfile + 1,
});

export type ModelInvocationRedactionSpan = Readonly<{
  start: number;
  end: number;
  category: ModelInvocationRedactionCategory;
}>;
export type RedactionMessageAssessment = Readonly<{
  messageIndex: number;
  assessment: ModelInvocationRedactionAssessment;
  spans: readonly ModelInvocationRedactionSpan[];
}>;
export type ModelInvocationRedactionEvidence = Readonly<{
  kind: "redaction";
  evidenceId: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  invocationId: string;
  runRevision: number;
  stepId: string;
  attemptNumber: number;
  modelProfileId: string;
  candidateIdentity: ModelProviderIdentity;
  sourceRequestFingerprint: string;
  assessedAt: string;
  detectorId: string;
  detectorVersion: string;
  messages: readonly RedactionMessageAssessment[];
}>;
export type ModelInvocationApprovalEvidence = Readonly<{
  kind: "approval";
  evidenceId: string;
  approvalRequestId: string;
  status: ModelInvocationApprovalStatus;
  workspaceId: string;
  projectId: string;
  runId: string;
  invocationId: string;
  runRevision: number;
  stepId: string;
  attemptNumber: number;
  modelProfileId: string;
  candidateIdentity: ModelProviderIdentity;
  sourceRequestFingerprint: string;
  purpose: "model_data_egress";
  approvedByActorKind: "owner";
  approvedByActorId: string;
  decidedAt: string;
  expiresAt: string | null;
  reason: string | null;
}>;

export type ModelInvocationDataHandlingReasonCode =
  | "invalid_input" | "limit_exceeded" | "route_denied" | "invalid_candidate_identity"
  | "candidate_not_in_route" | "candidate_requirement_mismatch" | "invalid_timestamp"
  | "evidence_required" | "evidence_not_allowed" | "evidence_kind_mismatch"
  | "invalid_redaction_evidence" | "redaction_binding_mismatch" | "incomplete_message_coverage"
  | "invalid_redaction_span" | "overlapping_redaction_span" | "invalid_unicode_boundary"
  | "invalid_approval_evidence" | "approval_binding_mismatch" | "approval_not_granted"
  | "approval_not_yet_valid" | "approval_expired" | "approval_validity_exceeded"
  | "evidence_before_attempt" | "prepared_request_invalid";
export type ModelInvocationDataHandlingReason = Readonly<{
  code: ModelInvocationDataHandlingReasonCode;
  path: string;
  message: string;
  evidenceId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  runId: string | null;
  invocationId: string | null;
  stepId: string | null;
  providerId: string | null;
  deploymentId: string | null;
}>;
export type ModelInvocationRedactionEvidenceValidationDecision = Readonly<{
  verdict: ModelInvocationDataHandlingVerdict;
  reasons: readonly ModelInvocationDataHandlingReason[];
  normalizedEvidence: ModelInvocationRedactionEvidence | null;
}>;
export type ModelInvocationApprovalEvidenceValidationDecision = Readonly<{
  verdict: ModelInvocationDataHandlingVerdict;
  reasons: readonly ModelInvocationDataHandlingReason[];
  normalizedEvidence: ModelInvocationApprovalEvidence | null;
}>;
export type ModelInvocationDataHandlingRouteReceipt = Readonly<{
  workspaceId: string;
  projectId: string;
  runId: string;
  invocationId: string;
  modelProfileId: string;
  candidateIdentity: ModelProviderIdentity;
  deploymentMode: "local" | "remote";
  requirement: ModelDataHandlingRequirement;
  priority: number;
}>;
export type ModelInvocationDataHandlingPermit = Readonly<{
  evidenceId: string | null;
  requirement: ModelDataHandlingRequirement;
  workspaceId: string;
  projectId: string;
  runId: string;
  invocationId: string;
  runRevision: number;
  stepId: string;
  attemptNumber: number;
  modelProfileId: string;
  candidateIdentity: ModelProviderIdentity;
  evaluatedAt: string;
  sourceRequestFingerprint: string;
  preparedRequestFingerprint: string;
  messageCount: number;
  originalCharacterCount: number;
  preparedCharacterCount: number;
  redactedSpanCount: number;
  contextArtifactCountRemoved: number;
}>;
export type ModelInvocationDataHandlingEvaluationInput = Readonly<{
  routeInput: unknown;
  candidateIdentity: unknown;
  evidence: unknown | null;
  evaluatedAt: unknown;
}>;
export type ModelInvocationDataHandlingDecision = Readonly<{
  verdict: ModelInvocationDataHandlingVerdict;
  status: ModelInvocationDataHandlingStatus;
  reasons: readonly ModelInvocationDataHandlingReason[];
  routeReceipt: ModelInvocationDataHandlingRouteReceipt | null;
  evidenceDecision: ModelInvocationRedactionEvidenceValidationDecision | ModelInvocationApprovalEvidenceValidationDecision | null;
  permit: ModelInvocationDataHandlingPermit | null;
  preparedRequest: ModelInvocationRequest | null;
}>;

type MutableReasons = ModelInvocationDataHandlingReason[];
type ReasonContext = Partial<Pick<ModelInvocationDataHandlingReason,
  "evidenceId" | "workspaceId" | "projectId" | "runId" | "invocationId" | "stepId" | "providerId" | "deploymentId">>;
type SpanWrapper = { value: ModelInvocationRedactionSpan; path: string };
type AssessmentWrapper = { value: RedactionMessageAssessment; path: string; spans: SpanWrapper[] };

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const fingerprintPattern = /^sha256:[0-9a-f]{64}$/u;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const unsafeSingleLinePattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const evaluationFields = Object.freeze(["routeInput", "candidateIdentity", "evidence", "evaluatedAt"] as const);
const redactionFields = Object.freeze(["kind", "evidenceId", "workspaceId", "projectId", "runId", "invocationId", "runRevision", "stepId", "attemptNumber", "modelProfileId", "candidateIdentity", "sourceRequestFingerprint", "assessedAt", "detectorId", "detectorVersion", "messages"] as const);
const assessmentFields = Object.freeze(["messageIndex", "assessment", "spans"] as const);
const spanFields = Object.freeze(["start", "end", "category"] as const);
const approvalFields = Object.freeze(["kind", "evidenceId", "approvalRequestId", "status", "workspaceId", "projectId", "runId", "invocationId", "runRevision", "stepId", "attemptNumber", "modelProfileId", "candidateIdentity", "sourceRequestFingerprint", "purpose", "approvedByActorKind", "approvedByActorId", "decidedAt", "expiresAt", "reason"] as const);
const replacements: Readonly<Record<ModelInvocationRedactionCategory, string>> = Object.freeze({
  credential: "[REDACTED:CREDENTIAL]",
  personal_data: "[REDACTED:PERSONAL_DATA]",
  financial_data: "[REDACTED:FINANCIAL_DATA]",
  authentication_data: "[REDACTED:AUTHENTICATION_DATA]",
  internal_identifier: "[REDACTED:INTERNAL_IDENTIFIER]",
  confidential_data: "[REDACTED:CONFIDENTIAL_DATA]",
});

function includes<T>(values: readonly T[], input: unknown): input is T { return values.some((value) => value === input); }
function compareStrings(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function plain(input: unknown): input is Record<string, unknown> { if (typeof input !== "object" || input === null || Array.isArray(input)) return false; const prototype = Object.getPrototypeOf(input); return prototype === Object.prototype || prototype === null; }
function ordinary(input: unknown): input is unknown[] { return Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype; }
function exact(input: Record<string, unknown>, fields: readonly string[]): boolean { const keys = Object.keys(input); return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field)); }
function id(input: unknown): string | null { return typeof input === "string" && input.length <= modelInvocationDataHandlingLimits.maxIdLength && safeIdPattern.test(input) ? input : null; }
function integer(input: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | null { return Number.isSafeInteger(input) && (input as number) >= minimum && (input as number) <= maximum ? input as number : null; }
function timestamp(input: unknown): string | null { if (typeof input !== "string" || !canonicalTimestampPattern.test(input)) return null; try { return new Date(input).toISOString() === input ? input : null; } catch { return null; } }
function auditText(input: unknown, maximum: number): string | null { return typeof input === "string" && input.length > 0 && input.length <= maximum && input.trim().length > 0 && !unsafeSingleLinePattern.test(input) ? input : null; }
function reason(reasons: MutableReasons, code: ModelInvocationDataHandlingReasonCode, path: string, message: string, context: ReasonContext = {}): void {
  if (reasons.length >= modelInvocationDataHandlingLimits.maxReasons) return;
  reasons.push({ code, path, message, evidenceId: context.evidenceId ?? null, workspaceId: context.workspaceId ?? null, projectId: context.projectId ?? null, runId: context.runId ?? null, invocationId: context.invocationId ?? null, stepId: context.stepId ?? null, providerId: context.providerId ?? null, deploymentId: context.deploymentId ?? null });
}
function context(request?: ModelInvocationRequest, identity?: ModelProviderIdentity): ReasonContext { return { evidenceId: null, workspaceId: request?.workspaceId ?? null, projectId: request?.projectId ?? null, runId: request?.runId ?? null, invocationId: request?.invocationId ?? null, stepId: request?.stepId ?? null, providerId: identity?.providerId ?? null, deploymentId: identity?.deploymentId ?? null }; }
function deny(reasons: MutableReasons): ModelInvocationDataHandlingDecision { return freezeModelProviderAdapterData({ verdict: "deny", status: "denied", reasons: cloneModelProviderAdapterData(reasons), routeReceipt: null, evidenceDecision: null, permit: null, preparedRequest: null }); }
function validationDeny<T>(reasons: MutableReasons): Readonly<{ verdict: "deny"; reasons: readonly ModelInvocationDataHandlingReason[]; normalizedEvidence: T | null }> { return freezeModelProviderAdapterData({ verdict: "deny", reasons: cloneModelProviderAdapterData(reasons), normalizedEvidence: null }); }

export function isModelInvocationDataHandlingVerdict(input: unknown): input is ModelInvocationDataHandlingVerdict { return includes(modelInvocationDataHandlingVerdicts, input); }
export function parseModelInvocationDataHandlingVerdict(input: unknown): ModelInvocationDataHandlingVerdict | null { return isModelInvocationDataHandlingVerdict(input) ? input : null; }
export function isModelInvocationDataHandlingStatus(input: unknown): input is ModelInvocationDataHandlingStatus { return includes(modelInvocationDataHandlingStatuses, input); }
export function parseModelInvocationDataHandlingStatus(input: unknown): ModelInvocationDataHandlingStatus | null { return isModelInvocationDataHandlingStatus(input) ? input : null; }
export function isModelInvocationEvidenceKind(input: unknown): input is ModelInvocationEvidenceKind { return includes(modelInvocationEvidenceKinds, input); }
export function parseModelInvocationEvidenceKind(input: unknown): ModelInvocationEvidenceKind | null { return isModelInvocationEvidenceKind(input) ? input : null; }
export function isModelInvocationRedactionAssessment(input: unknown): input is ModelInvocationRedactionAssessment { return includes(modelInvocationRedactionAssessments, input); }
export function parseModelInvocationRedactionAssessment(input: unknown): ModelInvocationRedactionAssessment | null { return isModelInvocationRedactionAssessment(input) ? input : null; }
export function isModelInvocationRedactionCategory(input: unknown): input is ModelInvocationRedactionCategory { return includes(modelInvocationRedactionCategories, input); }
export function parseModelInvocationRedactionCategory(input: unknown): ModelInvocationRedactionCategory | null { return isModelInvocationRedactionCategory(input) ? input : null; }
export function isModelInvocationApprovalStatus(input: unknown): input is ModelInvocationApprovalStatus { return includes(modelInvocationApprovalStatuses, input); }
export function parseModelInvocationApprovalStatus(input: unknown): ModelInvocationApprovalStatus | null { return isModelInvocationApprovalStatus(input) ? input : null; }

export function createModelInvocationRequestFingerprint(input: unknown): string | null {
  try {
    const decision = validateAndNormalizeModelInvocationRequest(input);
    if (decision.verdict !== "allow" || !decision.normalizedRequest) return null;
    const request = decision.normalizedRequest;
    const canonical = [
      "model-invocation-request:v1", request.invocationId, request.invocationSequence, request.runId,
      request.runRevision, request.requestId, request.workspaceId, request.projectId, request.departmentId,
      request.workflowId, request.workflowBindingId, request.agentId, request.agentBindingId, request.stepId,
      request.attemptNumber, request.modelProfileId, request.instructionProfileId, request.outputType,
      request.messages.map((message) => [message.role, message.content, message.toolCallId]),
      [...request.contextArtifactIds], [...request.toolIds], request.actionMode, request.requiredApprovalAction,
    ];
    return `sha256:${createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex")}`;
  } catch { return null; }
}

function normalizedIdentity(input: unknown, reasons: MutableReasons, path: string, code: "invalid_redaction_evidence" | "invalid_approval_evidence"): ModelProviderIdentity | null {
  const decision = validateAndNormalizeModelProviderIdentity(input);
  if (decision.verdict !== "allow" || !decision.normalizedIdentity) { reason(reasons, code, path, "candidateIdentity is invalid."); return null; }
  return cloneModelProviderAdapterData(decision.normalizedIdentity);
}
function normalizeCommonEvidence(input: Record<string, unknown>, reasons: MutableReasons, code: "invalid_redaction_evidence" | "invalid_approval_evidence") {
  const fields = ["evidenceId", "workspaceId", "projectId", "runId", "invocationId", "stepId", "modelProfileId"] as const;
  const values: Record<(typeof fields)[number], string | null> = { evidenceId: null, workspaceId: null, projectId: null, runId: null, invocationId: null, stepId: null, modelProfileId: null };
  for (const field of fields) { values[field] = id(input[field]); if (!values[field]) reason(reasons, code, `$.${field}`, `${field} must be a stable ID.`); }
  const runRevision = integer(input.runRevision, 0); const attemptNumber = integer(input.attemptNumber, 1);
  if (runRevision === null) reason(reasons, code, "$.runRevision", "runRevision must be a non-negative safe integer.");
  if (attemptNumber === null) reason(reasons, code, "$.attemptNumber", "attemptNumber must be a positive safe integer.");
  const sourceRequestFingerprint = typeof input.sourceRequestFingerprint === "string" && fingerprintPattern.test(input.sourceRequestFingerprint) ? input.sourceRequestFingerprint : null;
  if (!sourceRequestFingerprint) reason(reasons, code, "$.sourceRequestFingerprint", "sourceRequestFingerprint is invalid.");
  const candidateIdentity = normalizedIdentity(input.candidateIdentity, reasons, "$.candidateIdentity", code);
  return { values, runRevision, attemptNumber, sourceRequestFingerprint, candidateIdentity };
}

function normalizeRedactionEvidenceData(input: unknown): ModelInvocationRedactionEvidenceValidationDecision {
  const reasons: MutableReasons = [];
  if (!plain(input) || !exact(input, redactionFields)) { reason(reasons, "invalid_redaction_evidence", "$", "Redaction evidence has missing or unknown fields."); return validationDeny(reasons); }
  if (input.kind !== "redaction") reason(reasons, "invalid_redaction_evidence", "$.kind", "Evidence kind must be redaction.");
  const common = normalizeCommonEvidence(input, reasons, "invalid_redaction_evidence");
  const assessedAt = timestamp(input.assessedAt); if (!assessedAt) reason(reasons, "invalid_timestamp", "$.assessedAt", "assessedAt must be a canonical UTC timestamp.");
  const detectorId = auditText(input.detectorId, modelInvocationDataHandlingLimits.maxDetectorIdLength); if (!detectorId) reason(reasons, "invalid_redaction_evidence", "$.detectorId", "detectorId is invalid.");
  const detectorVersion = auditText(input.detectorVersion, modelInvocationDataHandlingLimits.maxDetectorVersionLength); if (!detectorVersion) reason(reasons, "invalid_redaction_evidence", "$.detectorVersion", "detectorVersion is invalid.");
  const messagesRaw = input.messages; const wrappers: AssessmentWrapper[] = []; const seenIndexes = new Set<number>(); let totalSpans = 0;
  if (!ordinary(messagesRaw) || messagesRaw.length > modelInvocationDataHandlingLimits.maxMessages) reason(reasons, ordinary(messagesRaw) ? "limit_exceeded" : "invalid_redaction_evidence", "$.messages", "messages must be a bounded ordinary array.");
  else for (const [sourceIndex, raw] of messagesRaw.entries()) {
    const path = `$.messages[${sourceIndex}]`;
    if (!plain(raw) || !exact(raw, assessmentFields)) { reason(reasons, "invalid_redaction_evidence", path, "Message assessment has missing or unknown fields."); continue; }
    const messageIndex = integer(raw.messageIndex, 0, modelInvocationDataHandlingLimits.maxMessages - 1);
    const assessment = raw.assessment;
    if (messageIndex === null) reason(reasons, "incomplete_message_coverage", `${path}.messageIndex`, "messageIndex is invalid.");
    else if (seenIndexes.has(messageIndex)) reason(reasons, "incomplete_message_coverage", `${path}.messageIndex`, "messageIndex must be unique.");
    if (!includes(modelInvocationRedactionAssessments, assessment)) reason(reasons, "invalid_redaction_evidence", `${path}.assessment`, "assessment is not canonical.");
    const spansRaw = raw.spans; const spanWrappers: SpanWrapper[] = [];
    if (!ordinary(spansRaw) || spansRaw.length > modelInvocationDataHandlingLimits.maxRedactionSpansPerMessage) reason(reasons, ordinary(spansRaw) ? "limit_exceeded" : "invalid_redaction_evidence", `${path}.spans`, "spans must be a bounded ordinary array.");
    else {
      totalSpans += spansRaw.length;
      if (totalSpans > modelInvocationDataHandlingLimits.maxTotalRedactionSpans) reason(reasons, "limit_exceeded", `${path}.spans`, "Total redaction span limit is exceeded.");
      for (const [spanIndex, spanRaw] of spansRaw.entries()) {
        const spanPath = `${path}.spans[${spanIndex}]`;
        if (!plain(spanRaw) || !exact(spanRaw, spanFields)) { reason(reasons, "invalid_redaction_span", spanPath, "Redaction span has missing or unknown fields."); continue; }
        const start = integer(spanRaw.start, 0, modelInvocationDataHandlingLimits.maxMessageLength);
        const end = integer(spanRaw.end, 0, modelInvocationDataHandlingLimits.maxMessageLength);
        const category = spanRaw.category;
        if (start === null || end === null || start >= end || !includes(modelInvocationRedactionCategories, category)) { reason(reasons, "invalid_redaction_span", spanPath, "Redaction span is invalid."); continue; }
        spanWrappers.push({ value: { start, end, category }, path: spanPath });
      }
    }
    if (assessment === "no_sensitive_data" && ordinary(spansRaw) && spansRaw.length !== 0) reason(reasons, "invalid_redaction_evidence", `${path}.spans`, "no_sensitive_data requires no spans.");
    if (assessment === "redacted" && ordinary(spansRaw) && spansRaw.length === 0) reason(reasons, "invalid_redaction_evidence", `${path}.spans`, "redacted requires at least one span.");
    spanWrappers.sort((left, right) => left.value.start - right.value.start || left.value.end - right.value.end || compareStrings(left.value.category, right.value.category));
    for (let index = 1; index < spanWrappers.length; index += 1) { const previous = spanWrappers[index - 1]; const current = spanWrappers[index]; if (previous && current && current.value.start < previous.value.end) reason(reasons, "overlapping_redaction_span", current.path, "Redaction spans cannot overlap."); }
    if (messageIndex !== null && !seenIndexes.has(messageIndex) && includes(modelInvocationRedactionAssessments, assessment)) { seenIndexes.add(messageIndex); wrappers.push({ value: { messageIndex, assessment, spans: spanWrappers.map((item) => item.value) }, path, spans: spanWrappers }); }
  }
  wrappers.sort((left, right) => left.value.messageIndex - right.value.messageIndex);
  if (reasons.length > 0 || input.kind !== "redaction" || !assessedAt || !detectorId || !detectorVersion || !common.candidateIdentity || !common.sourceRequestFingerprint || common.runRevision === null || common.attemptNumber === null || Object.values(common.values).some((value) => value === null)) return validationDeny(reasons);
  const normalizedEvidence: ModelInvocationRedactionEvidence = { kind: "redaction", evidenceId: common.values.evidenceId as string, workspaceId: common.values.workspaceId as string, projectId: common.values.projectId as string, runId: common.values.runId as string, invocationId: common.values.invocationId as string, runRevision: common.runRevision, stepId: common.values.stepId as string, attemptNumber: common.attemptNumber, modelProfileId: common.values.modelProfileId as string, candidateIdentity: common.candidateIdentity, sourceRequestFingerprint: common.sourceRequestFingerprint, assessedAt, detectorId, detectorVersion, messages: wrappers.map((item) => item.value) };
  return freezeModelProviderAdapterData({ verdict: "allow", reasons: [], normalizedEvidence: cloneModelProviderAdapterData(normalizedEvidence) });
}

export function validateAndNormalizeModelInvocationRedactionEvidence(input: unknown): ModelInvocationRedactionEvidenceValidationDecision {
  const snapshot = snapshotModelProviderAdapterInput(input); if (!snapshot.ok) { const reasons: MutableReasons = []; reason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Redaction evidence exceeds bounded inspection limits." : "Redaction evidence could not be safely inspected."); return validationDeny(reasons); }
  try { return normalizeRedactionEvidenceData(snapshot.value); } catch { const reasons: MutableReasons = []; reason(reasons, "invalid_input", "$", "Redaction evidence could not be safely validated."); return validationDeny(reasons); }
}

function normalizeApprovalEvidenceData(input: unknown): ModelInvocationApprovalEvidenceValidationDecision {
  const reasons: MutableReasons = [];
  if (!plain(input) || !exact(input, approvalFields)) { reason(reasons, "invalid_approval_evidence", "$", "Approval evidence has missing or unknown fields."); return validationDeny(reasons); }
  if (input.kind !== "approval") reason(reasons, "invalid_approval_evidence", "$.kind", "Evidence kind must be approval.");
  const common = normalizeCommonEvidence(input, reasons, "invalid_approval_evidence");
  const approvalRequestId = id(input.approvalRequestId); if (!approvalRequestId) reason(reasons, "invalid_approval_evidence", "$.approvalRequestId", "approvalRequestId must be a stable ID.");
  const status = input.status; if (!includes(modelInvocationApprovalStatuses, status)) reason(reasons, "invalid_approval_evidence", "$.status", "Approval status is not canonical.");
  if (input.purpose !== "model_data_egress") reason(reasons, "invalid_approval_evidence", "$.purpose", "purpose must be model_data_egress.");
  if (input.approvedByActorKind !== "owner") reason(reasons, "invalid_approval_evidence", "$.approvedByActorKind", "Only owner approval evidence is accepted.");
  const approvedByActorId = auditText(input.approvedByActorId, modelInvocationDataHandlingLimits.maxAuditIdentifierLength); if (!approvedByActorId) reason(reasons, "invalid_approval_evidence", "$.approvedByActorId", "approvedByActorId is invalid.");
  const decidedAt = timestamp(input.decidedAt); if (!decidedAt) reason(reasons, "invalid_timestamp", "$.decidedAt", "decidedAt must be a canonical UTC timestamp.");
  const expiresAt = input.expiresAt === null ? null : timestamp(input.expiresAt); if (input.expiresAt !== null && !expiresAt) reason(reasons, "invalid_timestamp", "$.expiresAt", "expiresAt must be null or a canonical UTC timestamp.");
  const approvalReason = input.reason === null ? null : auditText(input.reason, modelInvocationDataHandlingLimits.maxApprovalReasonLength); if (input.reason !== null && !approvalReason) reason(reasons, "invalid_approval_evidence", "$.reason", "reason is invalid.");
  if (status === "approved" && (expiresAt === null || input.reason !== null)) reason(reasons, "invalid_approval_evidence", "$", "Approved evidence requires expiresAt and a null reason.");
  if ((status === "rejected" || status === "revoked") && (input.expiresAt !== null || approvalReason === null)) reason(reasons, "invalid_approval_evidence", "$", "Rejected or revoked evidence requires a bounded reason and null expiresAt.");
  if (reasons.length > 0 || input.kind !== "approval" || !approvalRequestId || !includes(modelInvocationApprovalStatuses, status) || input.purpose !== "model_data_egress" || input.approvedByActorKind !== "owner" || !approvedByActorId || !decidedAt || !common.candidateIdentity || !common.sourceRequestFingerprint || common.runRevision === null || common.attemptNumber === null || Object.values(common.values).some((value) => value === null)) return validationDeny(reasons);
  const normalizedEvidence: ModelInvocationApprovalEvidence = { kind: "approval", evidenceId: common.values.evidenceId as string, approvalRequestId, status, workspaceId: common.values.workspaceId as string, projectId: common.values.projectId as string, runId: common.values.runId as string, invocationId: common.values.invocationId as string, runRevision: common.runRevision, stepId: common.values.stepId as string, attemptNumber: common.attemptNumber, modelProfileId: common.values.modelProfileId as string, candidateIdentity: common.candidateIdentity, sourceRequestFingerprint: common.sourceRequestFingerprint, purpose: "model_data_egress", approvedByActorKind: "owner", approvedByActorId, decidedAt, expiresAt, reason: approvalReason };
  return freezeModelProviderAdapterData({ verdict: "allow", reasons: [], normalizedEvidence: cloneModelProviderAdapterData(normalizedEvidence) });
}

export function validateAndNormalizeModelInvocationApprovalEvidence(input: unknown): ModelInvocationApprovalEvidenceValidationDecision {
  const snapshot = snapshotModelProviderAdapterInput(input); if (!snapshot.ok) { const reasons: MutableReasons = []; reason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Approval evidence exceeds bounded inspection limits." : "Approval evidence could not be safely inspected."); return validationDeny(reasons); }
  try { return normalizeApprovalEvidenceData(snapshot.value); } catch { const reasons: MutableReasons = []; reason(reasons, "invalid_input", "$", "Approval evidence could not be safely validated."); return validationDeny(reasons); }
}

function sameIdentity(left: ModelProviderIdentity, right: ModelProviderIdentity): boolean { return left.providerId === right.providerId && left.providerKind === right.providerKind && left.deploymentId === right.deploymentId && left.providerModelId === right.providerModelId && left.providerRequestModelId === right.providerRequestModelId && left.providerModelVersion === right.providerModelVersion; }
function candidateIdentity(candidate: ModelInvocationRouteCandidate): ModelProviderIdentity { return { providerId: candidate.providerId, providerKind: candidate.providerKind, deploymentId: candidate.deploymentId, providerModelId: candidate.providerModelId, providerRequestModelId: candidate.providerRequestModelId, providerModelVersion: candidate.providerModelVersion }; }
function attemptStartedAt(snapshot: WorkflowRunSnapshot, stepId: string, attemptNumber: number): string | null { let attempt = 0; for (const event of snapshot.events) { if (event.kind === "step_started" && event.stepId === stepId) { attempt += 1; if (attempt === attemptNumber) return event.occurredAt; } } return null; }
function splitSurrogate(content: string, offset: number): boolean { if (offset <= 0 || offset >= content.length) return false; const before = content.charCodeAt(offset - 1); const after = content.charCodeAt(offset); return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff; }
function messageCharacters(messages: readonly ModelInvocationMessage[]): number { return messages.reduce((total, message) => total + message.content.length, 0); }
function sourceSpanPath(input: unknown, messageIndex: number, span: ModelInvocationRedactionSpan): string { if (!plain(input) || !ordinary(input.messages)) return "evidence.messages"; const assessmentIndex = input.messages.findIndex((item) => plain(item) && item.messageIndex === messageIndex); const assessment = input.messages[assessmentIndex]; if (!plain(assessment) || !ordinary(assessment.spans)) return `evidence.messages[${assessmentIndex}]`; const spanIndex = assessment.spans.findIndex((item) => plain(item) && item.start === span.start && item.end === span.end && item.category === span.category); return `evidence.messages[${assessmentIndex}].spans[${spanIndex < 0 ? 0 : spanIndex}]`; }
function applyRedaction(message: ModelInvocationMessage, spans: readonly ModelInvocationRedactionSpan[]): ModelInvocationMessage { let content = message.content; for (const span of [...spans].reverse()) content = `${content.slice(0, span.start)}${replacements[span.category]}${content.slice(span.end)}`; return { role: message.role, content, toolCallId: message.toolCallId }; }
function bindCommon(evidence: ModelInvocationRedactionEvidence | ModelInvocationApprovalEvidence, request: ModelInvocationRequest, identity: ModelProviderIdentity, fingerprint: string, code: "redaction_binding_mismatch" | "approval_binding_mismatch", reasons: MutableReasons): boolean {
  const comparisons: readonly [string, unknown, unknown][] = [["workspaceId", evidence.workspaceId, request.workspaceId], ["projectId", evidence.projectId, request.projectId], ["runId", evidence.runId, request.runId], ["invocationId", evidence.invocationId, request.invocationId], ["runRevision", evidence.runRevision, request.runRevision], ["stepId", evidence.stepId, request.stepId], ["attemptNumber", evidence.attemptNumber, request.attemptNumber], ["modelProfileId", evidence.modelProfileId, request.modelProfileId], ["sourceRequestFingerprint", evidence.sourceRequestFingerprint, fingerprint]];
  for (const [field, actual, expected] of comparisons) if (actual !== expected) { reason(reasons, code, `evidence.${field}`, "Evidence does not match the factual invocation request.", context(request, identity)); return false; }
  if (!sameIdentity(evidence.candidateIdentity, identity)) { reason(reasons, code, "evidence.candidateIdentity", "Evidence does not match the factual route candidate.", context(request, identity)); return false; }
  return true;
}

function evaluateData(input: unknown): ModelInvocationDataHandlingDecision {
  const reasons: MutableReasons = [];
  if (!plain(input) || !exact(input, evaluationFields)) { reason(reasons, "invalid_input", "$", "Data-handling input has missing or unknown fields."); return deny(reasons); }
  const routeDecision = resolveModelInvocationRoute(input.routeInput);
  if (routeDecision.verdict !== "allow" || !routeDecision.routePlan || !routeDecision.invocationAdmissionDecision?.normalizedRequest || !routeDecision.invocationAdmissionDecision.snapshotDecision?.normalizedSnapshot) { reason(reasons, "route_denied", "routeInput", "Factual route resolution denied data handling."); return deny(reasons); }
  const request = routeDecision.invocationAdmissionDecision.normalizedRequest;
  const snapshot = routeDecision.invocationAdmissionDecision.snapshotDecision.normalizedSnapshot;
  const identityDecision = validateAndNormalizeModelProviderIdentity(input.candidateIdentity);
  if (identityDecision.verdict !== "allow" || !identityDecision.normalizedIdentity) { reason(reasons, "invalid_candidate_identity", "candidateIdentity", "Candidate identity is invalid.", context(request)); return deny(reasons); }
  const comparisonIdentity = identityDecision.normalizedIdentity;
  const candidates = [routeDecision.routePlan.primary, ...routeDecision.routePlan.fallbacks];
  const matches = candidates.filter((candidate) => sameIdentity(candidateIdentity(candidate), comparisonIdentity));
  if (matches.length !== 1) { reason(reasons, "candidate_not_in_route", "candidateIdentity", "Candidate identity does not identify exactly one factual route candidate.", context(request)); return deny(reasons); }
  const candidate = matches[0]; if (!candidate) return deny(reasons);
  const identity = candidateIdentity(candidate);
  const evaluatedAt = timestamp(input.evaluatedAt); if (!evaluatedAt) { reason(reasons, "invalid_timestamp", "evaluatedAt", "evaluatedAt must be a canonical UTC timestamp.", context(request, identity)); return deny(reasons); }
  const requirement = candidate.dataHandlingRequirement;
  const modeMatches = (requirement === "local_only" && candidate.deploymentMode === "local") || (requirement !== "local_only" && candidate.deploymentMode === "remote");
  if (!includes(modelDataHandlingRequirements, requirement) || !modeMatches) { reason(reasons, "candidate_requirement_mismatch", "candidateIdentity", "Candidate deployment mode and data-handling requirement are inconsistent.", context(request, identity)); return deny(reasons); }
  const sourceFingerprint = createModelInvocationRequestFingerprint(request); if (!sourceFingerprint) { reason(reasons, "prepared_request_invalid", "routeInput", "Factual request fingerprint could not be created.", context(request, identity)); return deny(reasons); }
  let evidenceDecision: ModelInvocationRedactionEvidenceValidationDecision | ModelInvocationApprovalEvidenceValidationDecision | null = null;
  let evidenceId: string | null = null; let redactedSpanCount = 0; let preparedMessages: readonly ModelInvocationMessage[] = request.messages;
  const attemptStart = attemptStartedAt(snapshot, request.stepId, request.attemptNumber);
  if (!attemptStart) { reason(reasons, "evidence_before_attempt", "routeInput", "Current factual attempt start could not be established.", context(request, identity)); return deny(reasons); }
  if (requirement === "local_only") {
    if (input.evidence !== null) { reason(reasons, "evidence_not_allowed", "evidence", "local_only handling requires null evidence.", context(request, identity)); return deny(reasons); }
  } else {
    if (input.evidence === null) { reason(reasons, "evidence_required", "evidence", "Remote data handling requires candidate-specific evidence.", context(request, identity)); return deny(reasons); }
    if (!plain(input.evidence) || !includes(modelInvocationEvidenceKinds, input.evidence.kind)) { reason(reasons, "evidence_kind_mismatch", "evidence.kind", "Evidence kind does not match the factual requirement.", context(request, identity)); return deny(reasons); }
    const expectedKind = requirement === "redaction_required" ? "redaction" : "approval";
    if (input.evidence.kind !== expectedKind) { reason(reasons, "evidence_kind_mismatch", "evidence.kind", "Evidence kind does not match the factual requirement.", context(request, identity)); return deny(reasons); }
    if (expectedKind === "redaction") {
      const decision = validateAndNormalizeModelInvocationRedactionEvidence(input.evidence); evidenceDecision = decision;
      if (decision.verdict !== "allow" || !decision.normalizedEvidence) { reasons.push(...decision.reasons.map((item) => ({ ...item, path: item.path === "$" ? "evidence" : `evidence${item.path.slice(1)}` })).slice(0, modelInvocationDataHandlingLimits.maxReasons)); return deny(reasons.slice(0, modelInvocationDataHandlingLimits.maxReasons)); }
      const evidence = decision.normalizedEvidence; evidenceId = evidence.evidenceId;
      if (!bindCommon(evidence, request, identity, sourceFingerprint, "redaction_binding_mismatch", reasons)) return deny(reasons);
      if (evidence.assessedAt < attemptStart) { reason(reasons, "evidence_before_attempt", "evidence.assessedAt", "Redaction evidence predates the current factual attempt.", context(request, identity)); return deny(reasons); }
      if (evidence.assessedAt > evaluatedAt) { reason(reasons, "invalid_timestamp", "evidence.assessedAt", "Redaction evidence cannot be from the future.", context(request, identity)); return deny(reasons); }
      if (evidence.messages.length !== request.messages.length || evidence.messages.some((assessment, index) => assessment.messageIndex !== index)) { reason(reasons, "incomplete_message_coverage", "evidence.messages", "Every factual request message requires exactly one assessment.", context(request, identity)); return deny(reasons); }
      const nextMessages: ModelInvocationMessage[] = [];
      for (const assessment of evidence.messages) {
        const message = request.messages[assessment.messageIndex]; if (!message) { reason(reasons, "incomplete_message_coverage", "evidence.messages", "Message assessment is outside the factual request.", context(request, identity)); return deny(reasons); }
        for (const span of assessment.spans) {
          const spanPath = sourceSpanPath(input.evidence, assessment.messageIndex, span);
          if (span.end > message.content.length) { reason(reasons, "invalid_redaction_span", spanPath, "Redaction span exceeds the factual message.", context(request, identity)); return deny(reasons); }
          if (splitSurrogate(message.content, span.start)) { reason(reasons, "invalid_unicode_boundary", `${spanPath}.start`, "Redaction span cannot split a UTF-16 surrogate pair.", context(request, identity)); return deny(reasons); }
          if (splitSurrogate(message.content, span.end)) { reason(reasons, "invalid_unicode_boundary", `${spanPath}.end`, "Redaction span cannot split a UTF-16 surrogate pair.", context(request, identity)); return deny(reasons); }
        }
        redactedSpanCount += assessment.spans.length; nextMessages.push(applyRedaction(message, assessment.spans));
      }
      preparedMessages = nextMessages;
    } else {
      const decision = validateAndNormalizeModelInvocationApprovalEvidence(input.evidence); evidenceDecision = decision;
      if (decision.verdict !== "allow" || !decision.normalizedEvidence) { reasons.push(...decision.reasons.map((item) => ({ ...item, path: item.path === "$" ? "evidence" : `evidence${item.path.slice(1)}` })).slice(0, modelInvocationDataHandlingLimits.maxReasons)); return deny(reasons.slice(0, modelInvocationDataHandlingLimits.maxReasons)); }
      const evidence = decision.normalizedEvidence; evidenceId = evidence.evidenceId;
      if (!bindCommon(evidence, request, identity, sourceFingerprint, "approval_binding_mismatch", reasons)) return deny(reasons);
      if (evidence.status !== "approved") { reason(reasons, "approval_not_granted", "evidence.status", "Approval evidence is not currently approved.", context(request, identity)); return deny(reasons); }
      if (evidence.decidedAt < attemptStart) { reason(reasons, "evidence_before_attempt", "evidence.decidedAt", "Approval evidence predates the current factual attempt.", context(request, identity)); return deny(reasons); }
      if (evidence.decidedAt > evaluatedAt) { reason(reasons, "approval_not_yet_valid", "evidence.decidedAt", "Approval evidence is not yet valid.", context(request, identity)); return deny(reasons); }
      const expiresAt = evidence.expiresAt; if (!expiresAt) { reason(reasons, "invalid_approval_evidence", "evidence.expiresAt", "Approved evidence requires expiry.", context(request, identity)); return deny(reasons); }
      const decidedMs = Date.parse(evidence.decidedAt); const expiresMs = Date.parse(expiresAt);
      if (expiresMs <= decidedMs) { reason(reasons, "invalid_approval_evidence", "evidence.expiresAt", "Approval expiry must be later than its decision.", context(request, identity)); return deny(reasons); }
      if (expiresMs - decidedMs > modelInvocationDataHandlingLimits.maxApprovalValidityMs) { reason(reasons, "approval_validity_exceeded", "evidence.expiresAt", "Approval validity exceeds the bounded maximum.", context(request, identity)); return deny(reasons); }
      if (evaluatedAt > expiresAt) { reason(reasons, "approval_expired", "evidence.expiresAt", "Approval evidence has expired.", context(request, identity)); return deny(reasons); }
    }
  }
  const preparedCandidate: ModelInvocationRequest = { ...cloneModelProviderAdapterData(request), messages: cloneModelProviderAdapterData(preparedMessages), contextArtifactIds: requirement === "local_only" ? cloneModelProviderAdapterData(request.contextArtifactIds) : [] };
  const preparedDecision = validateAndNormalizeModelInvocationRequest(preparedCandidate);
  if (preparedDecision.verdict !== "allow" || !preparedDecision.normalizedRequest) { reason(reasons, "prepared_request_invalid", "preparedRequest", "Prepared request failed factual AI-022 validation.", context(request, identity)); return deny(reasons); }
  const preparedRequest = preparedDecision.normalizedRequest; const preparedFingerprint = createModelInvocationRequestFingerprint(preparedRequest);
  if (!preparedFingerprint) { reason(reasons, "prepared_request_invalid", "preparedRequest", "Prepared request fingerprint could not be created.", context(request, identity)); return deny(reasons); }
  const receipt: ModelInvocationDataHandlingRouteReceipt = { workspaceId: request.workspaceId, projectId: request.projectId, runId: request.runId, invocationId: request.invocationId, modelProfileId: request.modelProfileId, candidateIdentity: cloneModelProviderAdapterData(identity), deploymentMode: candidate.deploymentMode, requirement, priority: candidate.priority };
  const permit: ModelInvocationDataHandlingPermit = { evidenceId, requirement, workspaceId: request.workspaceId, projectId: request.projectId, runId: request.runId, invocationId: request.invocationId, runRevision: request.runRevision, stepId: request.stepId, attemptNumber: request.attemptNumber, modelProfileId: request.modelProfileId, candidateIdentity: cloneModelProviderAdapterData(identity), evaluatedAt, sourceRequestFingerprint: sourceFingerprint, preparedRequestFingerprint: preparedFingerprint, messageCount: request.messages.length, originalCharacterCount: messageCharacters(request.messages), preparedCharacterCount: messageCharacters(preparedRequest.messages), redactedSpanCount, contextArtifactCountRemoved: requirement === "local_only" ? 0 : request.contextArtifactIds.length };
  return freezeModelProviderAdapterData({ verdict: "allow", status: "ready", reasons: [], routeReceipt: cloneModelProviderAdapterData(receipt), evidenceDecision: evidenceDecision ? cloneModelProviderAdapterData(evidenceDecision) : null, permit: cloneModelProviderAdapterData(permit), preparedRequest: cloneModelProviderAdapterData(preparedRequest) });
}

export function evaluateModelInvocationDataHandling(input: unknown): ModelInvocationDataHandlingDecision {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok) { const reasons: MutableReasons = []; reason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Data-handling input exceeds bounded inspection limits." : "Data-handling input could not be safely inspected."); return deny(reasons); }
  try { return evaluateData(snapshot.value); } catch { const reasons: MutableReasons = []; reason(reasons, "invalid_input", "$", "Data-handling input could not be safely evaluated."); return deny(reasons); }
}
