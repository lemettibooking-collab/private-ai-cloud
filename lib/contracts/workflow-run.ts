import type {
  AgentExecutionProfile,
} from "./agent-manifest";
import type {
  ProjectBudgetCeiling,
} from "./project-manifest";
import type {
  MultiProjectRunDispatch,
  MultiProjectRunDispatchPlanDecision,
  ProjectRunPriority,
  ProjectRunRequest,
} from "./multi-project-run-scheduler";
import type {
  ProjectExecutionContextSnapshot,
  WorkspaceProjectContextsDecision,
} from "./project-context";
import type {
  WorkflowAgentTaskStep,
  WorkflowExecutionProfile,
  WorkflowExecutionProfileResolutionDecision,
  WorkflowStep,
  WorkspaceWorkflowCatalogDecision,
} from "./workflow-manifest";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { agentManifestLimits, agentOutputTypes, agentRoleCodes } from "./agent-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { buildMultiProjectRunDispatchPlan, multiProjectRunSchedulerLimits, projectRunPriorities } from "./multi-project-run-scheduler.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkspaceProjectContexts } from "./project-context.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { projectDataEgressModes, projectExternalActionModes, projectManifestLimits, projectResourceCapabilities, validateAndNormalizeProjectManifest } from "./project-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkspaceWorkflowCatalog, resolveWorkflowExecutionProfile, workflowActionModes, workflowManifestLimits, workflowTriggerModes } from "./workflow-manifest.ts";

export const workflowRunStatuses = Object.freeze([
  "queued", "running", "waiting_approval", "review", "completed", "failed", "blocked", "cancelled",
] as const);
export type WorkflowRunStatus = (typeof workflowRunStatuses)[number];

export const terminalWorkflowRunStatuses = Object.freeze([
  "completed", "failed", "blocked", "cancelled",
] as const);
export type TerminalWorkflowRunStatus = (typeof terminalWorkflowRunStatuses)[number];

export const workflowRunStepStatuses = Object.freeze([
  "pending", "running", "waiting_approval", "success", "failed", "blocked", "cancelled",
] as const);
export type WorkflowRunStepStatus = (typeof workflowRunStepStatuses)[number];

export const workflowRunEventKinds = Object.freeze([
  "run_started", "step_started", "step_succeeded", "step_failed", "approval_requested",
  "approval_granted", "approval_rejected", "review_started", "run_completed", "run_blocked",
  "run_cancelled",
] as const);
export type WorkflowRunEventKind = (typeof workflowRunEventKinds)[number];

export const workflowRunActorKinds = Object.freeze([
  "owner", "system", "agent", "reviewer",
] as const);
export type WorkflowRunActorKind = (typeof workflowRunActorKinds)[number];

export const workflowRunVerdicts = Object.freeze(["allow", "deny"] as const);
export type WorkflowRunVerdict = (typeof workflowRunVerdicts)[number];

export const workflowRunLimits = Object.freeze({
  maxIdLength: multiProjectRunSchedulerLimits.maxIdLength,
  maxActorIdLength: 128,
  maxErrorCodeLength: 128,
  maxErrorMessageLength: 2048,
  maxReasonMessageLength: 2048,
  maxOutputArtifactIds: 64,
  maxLifecycleEvents: 2048,
  maxSnapshotDepth: 48,
  maxInspectedProperties: 524_288,
  maxArrayLength: Math.max(
    workflowManifestLimits.maxCatalogEntries,
    multiProjectRunSchedulerLimits.maxQueuedRuns,
  ),
  maxStringLength: 8_192,
  maxValidationErrors: 256,
});

export type WorkflowRunStepError = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export type WorkflowRunStepState = Readonly<{
  stepId: string;
  kind: WorkflowStep["kind"];
  status: WorkflowRunStepStatus;
  attemptCount: number;
  approvalRequestId: string | null;
  outputArtifactIds: readonly string[];
  lastError: WorkflowRunStepError | null;
}>;

type WorkflowRunEventCommon = Readonly<{
  eventId: string;
  runId: string;
  kind: WorkflowRunEventKind;
  sequence: number;
  occurredAt: string;
  actorKind: WorkflowRunActorKind;
  actorId: string;
}>;

export type WorkflowRunStartedEvent = WorkflowRunEventCommon & Readonly<{ kind: "run_started" }>;
export type WorkflowRunStepStartedEvent = WorkflowRunEventCommon & Readonly<{ kind: "step_started"; stepId: string }>;
export type WorkflowRunStepSucceededEvent = WorkflowRunEventCommon & Readonly<{
  kind: "step_succeeded";
  stepId: string;
  outputArtifactIds: readonly string[];
}>;
export type WorkflowRunStepFailedEvent = WorkflowRunEventCommon & Readonly<{
  kind: "step_failed";
  stepId: string;
  error: WorkflowRunStepError;
}>;
export type WorkflowRunApprovalRequestedEvent = WorkflowRunEventCommon & Readonly<{
  kind: "approval_requested";
  stepId: string;
  approvalRequestId: string;
}>;
export type WorkflowRunApprovalGrantedEvent = WorkflowRunEventCommon & Readonly<{
  kind: "approval_granted";
  stepId: string;
  approvalRequestId: string;
}>;
export type WorkflowRunApprovalRejectedEvent = WorkflowRunEventCommon & Readonly<{
  kind: "approval_rejected";
  stepId: string;
  approvalRequestId: string;
  reason: string;
}>;
export type WorkflowRunReviewStartedEvent = WorkflowRunEventCommon & Readonly<{ kind: "review_started" }>;
export type WorkflowRunCompletedEvent = WorkflowRunEventCommon & Readonly<{ kind: "run_completed" }>;
export type WorkflowRunBlockedEvent = WorkflowRunEventCommon & Readonly<{
  kind: "run_blocked";
  reasonCode: string;
  message: string;
}>;
export type WorkflowRunCancelledEvent = WorkflowRunEventCommon & Readonly<{
  kind: "run_cancelled";
  reasonCode: string;
  message: string;
}>;

export type WorkflowRunEvent =
  | WorkflowRunStartedEvent
  | WorkflowRunStepStartedEvent
  | WorkflowRunStepSucceededEvent
  | WorkflowRunStepFailedEvent
  | WorkflowRunApprovalRequestedEvent
  | WorkflowRunApprovalGrantedEvent
  | WorkflowRunApprovalRejectedEvent
  | WorkflowRunReviewStartedEvent
  | WorkflowRunCompletedEvent
  | WorkflowRunBlockedEvent
  | WorkflowRunCancelledEvent;

export type WorkflowRunSnapshot = Readonly<{
  runId: string;
  requestId: string;
  idempotencyKey: string;
  workspaceId: string;
  projectId: string;
  departmentId: string;
  workflowId: string;
  workflowManifestVersion: number;
  workflowBindingId: string;
  workflowBindingVersion: number;
  priority: ProjectRunPriority;
  modelProfileId: string;
  status: WorkflowRunStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  executionProfile: WorkflowExecutionProfile;
  stepStates: readonly WorkflowRunStepState[];
  readyStepIds: readonly string[];
  events: readonly WorkflowRunEvent[];
}>;

export type WorkflowRunCreationInput = Readonly<{
  runId: string;
  requestId: string;
  createdAt: string;
  schedulerInput: unknown;
  workflowCatalog: unknown;
}>;

export type WorkflowRunTransitionInput = Readonly<{
  snapshot: unknown;
  event: unknown;
}>;

export type WorkflowRunReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "invalid_scheduler_decision"
  | "request_not_dispatched"
  | "duplicate_run_id"
  | "invalid_workflow_catalog"
  | "workflow_binding_not_found"
  | "workflow_resolution_denied"
  | "registry_context_mismatch"
  | "execution_context_mismatch"
  | "model_not_allowed"
  | "invalid_snapshot"
  | "history_mismatch"
  | "invalid_event"
  | "run_id_mismatch"
  | "duplicate_event_id"
  | "invalid_sequence"
  | "timestamp_regression"
  | "terminal_run"
  | "invalid_transition"
  | "step_not_found"
  | "wrong_step_kind"
  | "step_not_ready"
  | "step_not_running"
  | "approval_mismatch"
  | "attempt_limit_exceeded";

export type WorkflowRunReason = Readonly<{
  code: WorkflowRunReasonCode;
  path: string;
  message: string;
  runId: string | null;
  requestId: string | null;
  projectId: string | null;
  departmentId: string | null;
  workflowId: string | null;
  bindingId: string | null;
  stepId: string | null;
  eventId: string | null;
}>;

export type WorkflowRunCreationDecision = Readonly<{
  verdict: WorkflowRunVerdict;
  reasons: readonly WorkflowRunReason[];
  schedulerDecision: MultiProjectRunDispatchPlanDecision | null;
  schedulerRegistryDecision: WorkspaceProjectContextsDecision | null;
  workflowCatalogDecision: WorkspaceWorkflowCatalogDecision | null;
  workflowResolutionDecision: WorkflowExecutionProfileResolutionDecision | null;
  snapshot: WorkflowRunSnapshot | null;
}>;

export type WorkflowRunSnapshotValidationDecision = Readonly<{
  verdict: WorkflowRunVerdict;
  reasons: readonly WorkflowRunReason[];
  normalizedSnapshot: WorkflowRunSnapshot | null;
}>;

export type WorkflowRunTransitionDecision = Readonly<{
  verdict: WorkflowRunVerdict;
  reasons: readonly WorkflowRunReason[];
  snapshotDecision: WorkflowRunSnapshotValidationDecision;
  normalizedEvent: WorkflowRunEvent | null;
  nextSnapshot: WorkflowRunSnapshot | null;
}>;

type MutableReasons = WorkflowRunReason[];
type SnapshotState = { inspected: number; active: WeakSet<object> };
type SnapshotResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; limited: boolean }>;
type MutableStepState = {
  stepId: string;
  kind: WorkflowStep["kind"];
  status: WorkflowRunStepStatus;
  attemptCount: number;
  approvalRequestId: string | null;
  outputArtifactIds: string[];
  lastError: WorkflowRunStepError | null;
};
type ReplayState = {
  status: WorkflowRunStatus;
  revision: number;
  updatedAt: string;
  stepStates: MutableStepState[];
  readyStepIds: string[];
  events: WorkflowRunEvent[];
  eventIds: Set<string>;
};

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const actorIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const nonNewlineControlPattern = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const creationFields = Object.freeze(["runId", "requestId", "createdAt", "schedulerInput", "workflowCatalog"] as const);
const snapshotFields = Object.freeze([
  "runId", "requestId", "idempotencyKey", "workspaceId", "projectId", "departmentId",
  "workflowId", "workflowManifestVersion", "workflowBindingId", "workflowBindingVersion",
  "priority", "modelProfileId", "status", "revision", "createdAt", "updatedAt",
  "executionProfile", "stepStates", "readyStepIds", "events",
] as const);
const stepStateFields = Object.freeze([
  "stepId", "kind", "status", "attemptCount", "approvalRequestId", "outputArtifactIds", "lastError",
] as const);
const errorFields = Object.freeze(["code", "message", "retryable"] as const);
const eventCommonFields = Object.freeze([
  "eventId", "runId", "kind", "sequence", "occurredAt", "actorKind", "actorId",
] as const);
const profileFields = Object.freeze([
  "workspaceId", "projectId", "projectManifestVersion", "departmentId", "departmentManifestVersion",
  "workflowId", "workflowManifestVersion", "workflowStatus", "workflowBindingId",
  "workflowBindingVersion", "triggerMode", "executionWaves", "steps", "agents", "resources",
  "modelProfileIds", "knowledgeCollectionIds", "budget", "externalActionMode", "dataEgressMode",
  "requiredApprovalActions", "forbiddenActions",
] as const);
const agentTaskFields = Object.freeze([
  "id", "kind", "name", "dependsOnStepIds", "agentId", "agentBindingId", "outputType",
  "requestedResources", "modelProfileId", "knowledgeCollectionIds", "toolIds", "maxAttempts",
  "timeoutMinutes", "actionMode", "requiredApprovalAction",
] as const);
const approvalGateFields = Object.freeze([
  "id", "kind", "name", "dependsOnStepIds", "approvalAction",
] as const);
const agentProfileFields = Object.freeze([
  "workspaceId", "projectId", "projectManifestVersion", "departmentId",
  "departmentManifestVersion", "agentId", "agentManifestVersion", "roleCode", "bindingId",
  "bindingVersion", "instructionProfileId", "outputTypes", "allowedWorkflowIds", "allowedToolIds",
  "allowedModelProfileIds", "knowledgeCollectionIds", "modelRouting", "resources", "budget",
  "externalActionMode", "dataEgressMode", "requiredApprovalActions", "forbiddenActions",
] as const);
const modelRoutingFields = Object.freeze([
  "primaryModelProfileId", "fallbackModelProfileIds", "reviewerModelProfileId",
  "independentReviewRequired",
] as const);
const resourceFields = Object.freeze(["resourceId", "capabilities"] as const);
const budgetFields = Object.freeze([
  "maxConcurrentRuns", "maxAttemptsPerRun", "maxRunMinutes", "dailyTokenBudget",
  "monthlyCostBudgetUsdCents",
] as const);
const budgetValidationManifestEnvelope = Object.freeze({
  id: "workflow-run-budget-validation",
  workspaceId: "workflow-run-validation",
  version: 1,
  name: "Workflow Run budget validation",
  slug: "workflow-run-budget-validation",
  summary: "Static safe ProjectManifest envelope for embedded budget validation.",
  kind: "internal_product",
  status: "active",
  defaultLocale: "en-US",
  timeZone: "UTC",
  dataRegion: "internal",
  dataClassification: "internal",
  goals: Object.freeze(["Validate an embedded Project budget."]),
  nonGoals: Object.freeze(["Perform runtime actions."]),
  tags: Object.freeze(["validation"]),
  resources: Object.freeze([]),
  allowedModelProfileIds: Object.freeze(["model-validation"]),
  knowledgeCollectionIds: Object.freeze([]),
  policy: Object.freeze({
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    requiredApprovalActions: Object.freeze([]),
    forbiddenActions: Object.freeze([]),
  }),
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function includesValue<T>(values: readonly T[], input: unknown): input is T {
  return values.some((value) => value === input);
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function isOrdinaryArray(input: unknown): input is unknown[] {
  return Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype;
}

function snapshotValue(input: unknown, state: SnapshotState, depth = 0): SnapshotResult {
  if (typeof input === "string") return input.length <= workflowRunLimits.maxStringLength
    ? { ok: true, value: input }
    : { ok: false, limited: true };
  if (input === null || typeof input === "boolean" || typeof input === "number" || typeof input === "undefined") return { ok: true, value: input };
  if (typeof input !== "object" || depth > workflowRunLimits.maxSnapshotDepth) return { ok: false, limited: depth > workflowRunLimits.maxSnapshotDepth };
  if (state.active.has(input)) return { ok: false, limited: false };
  if (Array.isArray(input) && !isOrdinaryArray(input)) return { ok: false, limited: false };
  if (!Array.isArray(input) && !isPlainRecord(input)) return { ok: false, limited: false };
  state.active.add(input);
  try {
    if (Array.isArray(input)) {
      if (input.length > workflowRunLimits.maxArrayLength) return { ok: false, limited: true };
      const keys = Object.keys(input);
      if (keys.length !== input.length) return { ok: false, limited: false };
      const output: unknown[] = [];
      for (let index = 0; index < input.length; index += 1) {
        if (keys[index] !== String(index)) return { ok: false, limited: false };
        state.inspected += 1;
        if (state.inspected > workflowRunLimits.maxInspectedProperties) return { ok: false, limited: true };
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) return { ok: false, limited: false };
        const child = snapshotValue(descriptor.value, state, depth + 1);
        if (!child.ok) return child;
        output.push(child.value);
      }
      return { ok: true, value: output };
    }
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort(compareStrings)) {
      state.inspected += 1;
      if (state.inspected > workflowRunLimits.maxInspectedProperties) return { ok: false, limited: true };
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return { ok: false, limited: false };
      const child = snapshotValue(descriptor.value, state, depth + 1);
      if (!child.ok) return child;
      output[key] = child.value;
    }
    return { ok: true, value: output };
  } finally {
    state.active.delete(input);
  }
}

function boundedSnapshot(input: unknown): SnapshotResult {
  try {
    return snapshotValue(input, { inspected: 0, active: new WeakSet<object>() });
  } catch {
    return { ok: false, limited: false };
  }
}

function own(input: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function unknownFields(input: Record<string, unknown>, fields: readonly string[]): string[] {
  const allowed = new Set(fields);
  return Object.keys(input).filter((key) => !allowed.has(key)).sort(compareStrings);
}

function exactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  return unknownFields(input, fields).length === 0 && fields.every((field) => Object.hasOwn(input, field));
}

function stableId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return safeIdPattern.test(value) ? value : null;
}

function normalizedText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") return null;
  const value = input.replace(/\r\n?/gu, "\n").trim();
  return value.length > 0 && value.length <= maxLength && !nonNewlineControlPattern.test(value) ? value : null;
}

function canonicalTimestamp(input: unknown): string | null {
  if (typeof input !== "string" || !canonicalTimestampPattern.test(input)) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== input ? null : input;
}

function addReason(
  reasons: MutableReasons,
  code: WorkflowRunReasonCode,
  path: string,
  message: string,
  ids: Partial<Pick<WorkflowRunReason, "runId" | "requestId" | "projectId" | "departmentId" | "workflowId" | "bindingId" | "stepId" | "eventId">> = {},
): void {
  if (reasons.length >= workflowRunLimits.maxValidationErrors) return;
  reasons.push({
    code, path, message: message.slice(0, workflowRunLimits.maxReasonMessageLength),
    runId: ids.runId ?? null,
    requestId: ids.requestId ?? null,
    projectId: ids.projectId ?? null,
    departmentId: ids.departmentId ?? null,
    workflowId: ids.workflowId ?? null,
    bindingId: ids.bindingId ?? null,
    stepId: ids.stepId ?? null,
    eventId: ids.eventId ?? null,
  });
}

function sameData(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) return true;
  if (depth > workflowRunLimits.maxSnapshotDepth || typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => sameData(value, right[index], depth + 1));
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).sort(compareStrings);
  const rightKeys = Object.keys(right).sort(compareStrings);
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
    && sameData(own(left, key), own(right, key), depth + 1));
}

function deepFreezeData<T>(input: T, active = new WeakSet<object>()): T {
  if (typeof input !== "object" || input === null || active.has(input)) return input;
  active.add(input);
  for (const key of Object.keys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) deepFreezeData(descriptor.value, active);
  }
  return Object.freeze(input);
}

function cloneTrusted<T>(input: T): T {
  const result = boundedSnapshot(input);
  if (!result.ok) throw new Error("Trusted contract output exceeded Workflow Run bounds.");
  return result.value as T;
}

export function isWorkflowRunStatus(input: unknown): input is WorkflowRunStatus {
  return includesValue(workflowRunStatuses, input);
}
export function parseWorkflowRunStatus(input: unknown): WorkflowRunStatus | null {
  return isWorkflowRunStatus(input) ? input : null;
}
export function isTerminalWorkflowRunStatus(input: unknown): input is TerminalWorkflowRunStatus {
  return includesValue(terminalWorkflowRunStatuses, input);
}
export function parseTerminalWorkflowRunStatus(input: unknown): TerminalWorkflowRunStatus | null {
  return isTerminalWorkflowRunStatus(input) ? input : null;
}
export function isWorkflowRunStepStatus(input: unknown): input is WorkflowRunStepStatus {
  return includesValue(workflowRunStepStatuses, input);
}
export function parseWorkflowRunStepStatus(input: unknown): WorkflowRunStepStatus | null {
  return isWorkflowRunStepStatus(input) ? input : null;
}
export function isWorkflowRunEventKind(input: unknown): input is WorkflowRunEventKind {
  return includesValue(workflowRunEventKinds, input);
}
export function parseWorkflowRunEventKind(input: unknown): WorkflowRunEventKind | null {
  return isWorkflowRunEventKind(input) ? input : null;
}
export function isWorkflowRunActorKind(input: unknown): input is WorkflowRunActorKind {
  return includesValue(workflowRunActorKinds, input);
}
export function parseWorkflowRunActorKind(input: unknown): WorkflowRunActorKind | null {
  return isWorkflowRunActorKind(input) ? input : null;
}
export function isWorkflowRunVerdict(input: unknown): input is WorkflowRunVerdict {
  return includesValue(workflowRunVerdicts, input);
}
export function parseWorkflowRunVerdict(input: unknown): WorkflowRunVerdict | null {
  return isWorkflowRunVerdict(input) ? input : null;
}

function safeStringList(input: unknown, maxItems: number, idsOnly: boolean): input is string[] {
  return Array.isArray(input) && input.length <= maxItems
    && input.every((value) => idsOnly
      ? stableId(value) !== null
      : normalizedText(value, workflowManifestLimits.maxTextListItemLength) !== null)
    && new Set(input).size === input.length;
}

function resourceListSafe(input: unknown): boolean {
  if (!Array.isArray(input) || input.length > workflowManifestLimits.maxResourcesPerStep) return false;
  const resourceIds = new Set<string>();
  return input.every((resource) => {
    if (!isPlainRecord(resource) || !exactFields(resource, resourceFields)) return false;
    const resourceId = stableId(own(resource, "resourceId"));
    const capabilities = own(resource, "capabilities");
    if (resourceId === null || resourceIds.has(resourceId) || !Array.isArray(capabilities)
      || capabilities.length > workflowManifestLimits.maxCapabilitiesPerResource
      || new Set(capabilities).size !== capabilities.length
      || !capabilities.every((capability) => includesValue(projectResourceCapabilities, capability))) return false;
    resourceIds.add(resourceId);
    return true;
  });
}

function budgetSafe(input: unknown): boolean {
  if (!isPlainRecord(input) || !exactFields(input, budgetFields)) return false;
  const result = validateAndNormalizeProjectManifest({
    ...budgetValidationManifestEnvelope,
    budget: cloneTrusted(input),
  });
  return result.ok && sameData(result.value.budget, input as unknown as ProjectBudgetCeiling);
}

function agentProfileSafe(input: unknown, profile: Record<string, unknown>): input is AgentExecutionProfile {
  if (!isPlainRecord(input) || !exactFields(input, agentProfileFields)) return false;
  const ids = ["workspaceId", "projectId", "departmentId", "agentId", "bindingId", "instructionProfileId"];
  const versions = ["projectManifestVersion", "departmentManifestVersion", "agentManifestVersion", "bindingVersion"];
  if (ids.some((key) => stableId(own(input, key)) === null)
    || versions.some((key) => !Number.isSafeInteger(own(input, key)) || (own(input, key) as number) < 1)
    || own(input, "workspaceId") !== own(profile, "workspaceId")
    || own(input, "projectId") !== own(profile, "projectId")
    || own(input, "departmentId") !== own(profile, "departmentId")
    || own(input, "projectManifestVersion") !== own(profile, "projectManifestVersion")
    || own(input, "departmentManifestVersion") !== own(profile, "departmentManifestVersion")) return false;
  const outputTypes = own(input, "outputTypes");
  if (!Array.isArray(outputTypes) || outputTypes.length > agentOutputTypes.length
    || new Set(outputTypes).size !== outputTypes.length
    || !outputTypes.every((outputType) => includesValue(agentOutputTypes, outputType))) return false;
  if (!safeStringList(own(input, "allowedWorkflowIds"), agentManifestLimits.maxWorkflowIds, true)
    || !safeStringList(own(input, "allowedToolIds"), agentManifestLimits.maxToolIds, true)
    || !safeStringList(own(input, "allowedModelProfileIds"), agentManifestLimits.maxModelProfileIds, true)
    || !safeStringList(own(input, "knowledgeCollectionIds"), agentManifestLimits.maxKnowledgeCollectionIds, true)) return false;
  for (const key of ["requiredApprovalActions", "forbiddenActions"] as const) {
    if (!safeStringList(own(input, key), workflowRunLimits.maxArrayLength, false)) return false;
  }
  const routing = own(input, "modelRouting");
  const allowedModels = own(input, "allowedModelProfileIds") as string[];
  if (!isPlainRecord(routing) || !exactFields(routing, modelRoutingFields)
    || stableId(own(routing, "primaryModelProfileId")) === null
    || !safeStringList(own(routing, "fallbackModelProfileIds"), agentManifestLimits.maxFallbackModelProfileIds, true)
    || (own(routing, "reviewerModelProfileId") !== null && stableId(own(routing, "reviewerModelProfileId")) === null)
    || typeof own(routing, "independentReviewRequired") !== "boolean") return false;
  const primary = own(routing, "primaryModelProfileId") as string;
  const fallback = own(routing, "fallbackModelProfileIds") as string[];
  const reviewer = own(routing, "reviewerModelProfileId") as string | null;
  const independentReview = own(routing, "independentReviewRequired") as boolean;
  const approvals = own(input, "requiredApprovalActions") as string[];
  const forbidden = own(input, "forbiddenActions") as string[];
  return includesValue(agentRoleCodes, own(input, "roleCode"))
    && allowedModels.includes(primary)
    && fallback.every((modelId) => allowedModels.includes(modelId) && modelId !== primary)
    && (reviewer === null || allowedModels.includes(reviewer))
    && (!independentReview || (reviewer !== null && reviewer !== primary))
    && resourceListSafe(own(input, "resources"))
    && budgetSafe(own(input, "budget"))
    && !approvals.some((approval) => forbidden.includes(approval))
    && includesValue(projectExternalActionModes, own(input, "externalActionMode"))
    && includesValue(projectDataEgressModes, own(input, "dataEgressMode"));
}

function profileStepSafe(input: unknown): input is WorkflowStep {
  if (!isPlainRecord(input) || !includesValue(["agent_task", "approval_gate"] as const, own(input, "kind"))) return false;
  const kind = own(input, "kind");
  if (!exactFields(input, kind === "agent_task" ? agentTaskFields : approvalGateFields)
    || stableId(own(input, "id")) === null
    || normalizedText(own(input, "name"), workflowManifestLimits.maxNameLength) === null
    || !safeStringList(own(input, "dependsOnStepIds"), workflowManifestLimits.maxDependenciesPerStep, true)) return false;
  if (kind === "approval_gate") return normalizedText(own(input, "approvalAction"), workflowManifestLimits.maxTextListItemLength) !== null;
  return stableId(own(input, "agentId")) !== null
    && stableId(own(input, "agentBindingId")) !== null
    && includesValue(agentOutputTypes, own(input, "outputType"))
    && resourceListSafe(own(input, "requestedResources"))
    && stableId(own(input, "modelProfileId")) !== null
    && safeStringList(own(input, "knowledgeCollectionIds"), workflowManifestLimits.maxKnowledgeCollectionIds, true)
    && safeStringList(own(input, "toolIds"), workflowManifestLimits.maxToolIds, true)
    && Number.isSafeInteger(own(input, "maxAttempts")) && (own(input, "maxAttempts") as number) >= 1 && (own(input, "maxAttempts") as number) <= workflowManifestLimits.maxStepAttempts
    && Number.isSafeInteger(own(input, "timeoutMinutes")) && (own(input, "timeoutMinutes") as number) >= 1 && (own(input, "timeoutMinutes") as number) <= workflowManifestLimits.maxStepTimeoutMinutes
    && includesValue(workflowActionModes, own(input, "actionMode"))
    && (own(input, "requiredApprovalAction") === null || normalizedText(own(input, "requiredApprovalAction"), workflowManifestLimits.maxTextListItemLength) !== null);
}

function canonicalGraph(
  steps: readonly WorkflowStep[],
): Readonly<{ waves: readonly (readonly string[])[]; ancestors: ReadonlyMap<string, ReadonlySet<string>> }> | null {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const indegree = new Map(steps.map((step) => [step.id, step.dependsOnStepIds.length]));
  const dependents = new Map(steps.map((step) => [step.id, [] as string[]]));
  for (const step of steps) {
    if (new Set(step.dependsOnStepIds).size !== step.dependsOnStepIds.length) return null;
    for (const dependencyId of step.dependsOnStepIds) {
      if (dependencyId === step.id || !byId.has(dependencyId)) return null;
      dependents.get(dependencyId)?.push(step.id);
    }
  }
  let ready = steps.filter((step) => step.dependsOnStepIds.length === 0).map((step) => step.id).sort(compareStrings);
  const waves: string[][] = [];
  const ancestors = new Map<string, ReadonlySet<string>>();
  let visited = 0;
  while (ready.length > 0) {
    const wave = ready;
    waves.push(wave);
    visited += wave.length;
    const next: string[] = [];
    for (const stepId of wave) {
      const step = byId.get(stepId);
      const stepAncestors = new Set<string>();
      for (const dependencyId of step?.dependsOnStepIds ?? []) {
        stepAncestors.add(dependencyId);
        for (const ancestorId of ancestors.get(dependencyId) ?? []) stepAncestors.add(ancestorId);
      }
      ancestors.set(stepId, stepAncestors);
      for (const dependentId of dependents.get(stepId) ?? []) {
        const remaining = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, remaining);
        if (remaining === 0) next.push(dependentId);
      }
    }
    ready = next.sort(compareStrings);
  }
  return visited === steps.length ? { waves, ancestors } : null;
}

function resourceGrantsContain(
  resources: WorkflowExecutionProfile["resources"] | AgentExecutionProfile["resources"],
  requestedResources: WorkflowAgentTaskStep["requestedResources"],
): boolean {
  return requestedResources.every((request) => {
    const grant = resources.find((resource) => resource.resourceId === request.resourceId);
    return grant !== undefined && request.capabilities.every((capability) => grant.capabilities.includes(capability));
  });
}

function agentTaskConsistent(
  step: WorkflowAgentTaskStep,
  profile: WorkflowExecutionProfile,
  agent: AgentExecutionProfile,
  ancestors: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (!agent.allowedWorkflowIds.includes(profile.workflowId)
    || !agent.outputTypes.includes(step.outputType)
    || !profile.modelProfileIds.includes(step.modelProfileId)
    || !agent.allowedModelProfileIds.includes(step.modelProfileId)
    || !step.knowledgeCollectionIds.every((collectionId) => profile.knowledgeCollectionIds.includes(collectionId) && agent.knowledgeCollectionIds.includes(collectionId))
    || !step.toolIds.every((toolId) => agent.allowedToolIds.includes(toolId))
    || !resourceGrantsContain(profile.resources, step.requestedResources)
    || !resourceGrantsContain(agent.resources, step.requestedResources)
    || step.maxAttempts > Math.min(profile.budget.maxAttemptsPerRun, agent.budget.maxAttemptsPerRun)
    || step.timeoutMinutes > Math.min(profile.budget.maxRunMinutes, agent.budget.maxRunMinutes)) return false;
  if (step.actionMode === "none" || step.actionMode === "proposal_only") return step.requiredApprovalAction === null;
  const approval = step.requiredApprovalAction;
  if (approval === null || profile.externalActionMode !== "approval_required" || agent.externalActionMode !== "approval_required"
    || !profile.requiredApprovalActions.includes(approval) || !agent.requiredApprovalActions.includes(approval)
    || profile.forbiddenActions.includes(approval) || agent.forbiddenActions.includes(approval)) return false;
  return profile.steps.some((candidate) => candidate.kind === "approval_gate"
    && candidate.approvalAction === approval && ancestors.get(step.id)?.has(candidate.id));
}

function profileSafe(input: unknown): input is WorkflowExecutionProfile {
  if (!isPlainRecord(input) || !exactFields(input, profileFields) || containsSensitiveKey(input)) return false;
  const ids = ["workspaceId", "projectId", "departmentId", "workflowId", "workflowBindingId"];
  const versions = ["projectManifestVersion", "departmentManifestVersion", "workflowManifestVersion", "workflowBindingVersion"];
  if (ids.some((key) => stableId(own(input, key)) === null)
    || versions.some((key) => !Number.isSafeInteger(own(input, key)) || (own(input, key) as number) < 1)
    || own(input, "workflowStatus") !== "active"
    || !includesValue(workflowTriggerModes, own(input, "triggerMode"))
    || !includesValue(projectExternalActionModes, own(input, "externalActionMode"))
    || !includesValue(projectDataEgressModes, own(input, "dataEgressMode"))
    || !budgetSafe(own(input, "budget"))
    || !resourceListSafe(own(input, "resources"))) return false;
  if (!safeStringList(own(input, "modelProfileIds"), projectManifestLimits.maxModelProfileIds, true)
    || !safeStringList(own(input, "knowledgeCollectionIds"), projectManifestLimits.maxKnowledgeCollectionIds, true)) return false;
  for (const key of ["requiredApprovalActions", "forbiddenActions"] as const) if (!safeStringList(own(input, key), workflowRunLimits.maxArrayLength, false)) return false;
  const steps = own(input, "steps");
  const waves = own(input, "executionWaves");
  const agents = own(input, "agents");
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > workflowManifestLimits.maxSteps
    || !steps.every(profileStepSafe) || !Array.isArray(waves) || !Array.isArray(agents)
    || !agents.every((agent) => agentProfileSafe(agent, input))) return false;
  const stepIds = steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) return false;
  const graph = canonicalGraph(steps);
  if (graph === null || !sameData(graph.waves, waves) || !sameData(graph.waves.flat(), stepIds)) return false;
  const agentProfiles = agents as AgentExecutionProfile[];
  const agentIdentities = agentProfiles.map((agent) => `${agent.agentId}\u0000${agent.bindingId}`);
  const taskIdentities = steps.filter((step): step is WorkflowAgentTaskStep => step.kind === "agent_task")
    .map((step) => `${step.agentId}\u0000${step.agentBindingId}`);
  if (new Set(agentIdentities).size !== agentIdentities.length
    || !sameData(agentIdentities, [...agentIdentities].sort(compareStrings))
    || !sameData([...new Set(taskIdentities)].sort(compareStrings), [...agentIdentities].sort(compareStrings))) return false;
  const profile = input as unknown as WorkflowExecutionProfile;
  if (profile.requiredApprovalActions.some((approval) => profile.forbiddenActions.includes(approval))) return false;
  for (const step of steps) {
    if (step.kind === "approval_gate") {
      if (!profile.requiredApprovalActions.includes(step.approvalAction) || profile.forbiddenActions.includes(step.approvalAction)) return false;
      continue;
    }
    const matches = agentProfiles.filter((agent) => agent.agentId === step.agentId && agent.bindingId === step.agentBindingId);
    if (matches.length !== 1 || !agentTaskConsistent(step, profile, matches[0], graph.ancestors)) return false;
  }
  return true;
}

function containsSensitiveKey(input: unknown, depth = 0): boolean {
  if (depth > workflowRunLimits.maxSnapshotDepth || typeof input !== "object" || input === null) return false;
  const forbidden = new Set(["registry", "schedulerInput", "workflowCatalog", "resourceRef", "connectionId", "credentials", "secret", "providerConfig", "selectedProjectId", "activeProjectId", "currentProjectId"]);
  if (Array.isArray(input)) return input.some((value) => containsSensitiveKey(value, depth + 1));
  if (!isPlainRecord(input)) return true;
  return Object.keys(input).some((key) => forbidden.has(key) || containsSensitiveKey(own(input, key), depth + 1));
}

function dispatchContextMatchesProfile(
  context: ProjectExecutionContextSnapshot,
  profile: WorkflowExecutionProfile,
): boolean {
  return context.workspaceId === profile.workspaceId
    && context.projectId === profile.projectId
    && context.projectManifestVersion === profile.projectManifestVersion
    && context.departmentId === profile.departmentId
    && context.departmentManifestVersion === profile.departmentManifestVersion
    && context.bindingId === profile.workflowBindingId
    && context.bindingVersion === profile.workflowBindingVersion
    && context.bindingKind === "workflow"
    && context.subjectId === profile.workflowId
    && sameData(context.resources, profile.resources)
    && sameData(context.modelProfileIds, profile.modelProfileIds)
    && sameData(context.knowledgeCollectionIds, profile.knowledgeCollectionIds)
    && sameData(context.budget, profile.budget)
    && context.externalActionMode === profile.externalActionMode
    && context.dataEgressMode === profile.dataEgressMode
    && sameData(context.requiredApprovalActions, profile.requiredApprovalActions.slice(0, context.requiredApprovalActions.length))
    && sameData(context.forbiddenActions, profile.forbiddenActions.slice(0, context.forbiddenActions.length));
}

function initialStepStates(profile: WorkflowExecutionProfile): MutableStepState[] {
  return profile.steps.map((step) => ({
    stepId: step.id,
    kind: step.kind,
    status: "pending",
    attemptCount: 0,
    approvalRequestId: null,
    outputArtifactIds: [],
    lastError: null,
  }));
}

function computeReadyStepIds(
  status: WorkflowRunStatus,
  profile: WorkflowExecutionProfile,
  states: readonly MutableStepState[],
): string[] {
  if (status !== "queued" && status !== "running") return [];
  if (states.some((state) => state.status === "waiting_approval")) return [];
  const stateById = new Map(states.map((state) => [state.stepId, state]));
  return profile.steps.filter((step) => {
    const state = stateById.get(step.id);
    if (!state || state.status !== "pending") return false;
    if (step.kind === "agent_task" && state.attemptCount >= step.maxAttempts) return false;
    return step.dependsOnStepIds.every((dependencyId) => stateById.get(dependencyId)?.status === "success");
  }).map((step) => step.id);
}

function freezeSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  return deepFreezeData(snapshot);
}

function buildInitialSnapshot(
  runId: string,
  request: ProjectRunRequest,
  createdAt: string,
  profile: WorkflowExecutionProfile,
): WorkflowRunSnapshot {
  const executionProfile = cloneTrusted(profile);
  const states = initialStepStates(executionProfile);
  return freezeSnapshot({
    runId,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    workspaceId: profile.workspaceId,
    projectId: profile.projectId,
    departmentId: profile.departmentId,
    workflowId: profile.workflowId,
    workflowManifestVersion: profile.workflowManifestVersion,
    workflowBindingId: profile.workflowBindingId,
    workflowBindingVersion: profile.workflowBindingVersion,
    priority: request.priority,
    modelProfileId: request.modelProfileId,
    status: "queued",
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    executionProfile,
    stepStates: states,
    readyStepIds: computeReadyStepIds("queued", executionProfile, states),
    events: [],
  });
}

function creationDeny(
  reasons: readonly WorkflowRunReason[],
  schedulerDecision: MultiProjectRunDispatchPlanDecision | null = null,
  schedulerRegistryDecision: WorkspaceProjectContextsDecision | null = null,
  workflowCatalogDecision: WorkspaceWorkflowCatalogDecision | null = null,
  workflowResolutionDecision: WorkflowExecutionProfileResolutionDecision | null = null,
): WorkflowRunCreationDecision {
  return { verdict: "deny", reasons, schedulerDecision, schedulerRegistryDecision, workflowCatalogDecision, workflowResolutionDecision, snapshot: null };
}

function createFromSnapshot(input: unknown): WorkflowRunCreationDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !exactFields(input, creationFields)) {
    addReason(reasons, "invalid_input", "$", "Creation input must contain only runId, requestId, createdAt, schedulerInput, and workflowCatalog.");
    return creationDeny(reasons);
  }
  const runId = stableId(own(input, "runId"));
  const requestId = stableId(own(input, "requestId"));
  const createdAt = canonicalTimestamp(own(input, "createdAt"));
  if (runId === null) addReason(reasons, "invalid_input", "runId", "runId must be a stable ID.");
  if (requestId === null) addReason(reasons, "invalid_input", "requestId", "requestId must be a stable ID.");
  if (createdAt === null) addReason(reasons, "invalid_input", "createdAt", "createdAt must be canonical UTC RFC3339 with milliseconds.");
  if (reasons.length > 0 || runId === null || requestId === null || createdAt === null) return creationDeny(reasons);
  const schedulerInput = own(input, "schedulerInput");
  const workflowCatalog = own(input, "workflowCatalog");
  const schedulerDecision = buildMultiProjectRunDispatchPlan(schedulerInput);
  if (schedulerDecision.verdict === "deny" || schedulerDecision.plan === null) {
    addReason(reasons, "invalid_scheduler_decision", "schedulerInput", "Factual AI-017 dispatch plan was denied.", { runId, requestId });
    return creationDeny(reasons, schedulerDecision);
  }
  const dispatches = schedulerDecision.plan.dispatches.filter((candidate) => candidate.request.id === requestId);
  if (dispatches.length !== 1) {
    addReason(reasons, "request_not_dispatched", "requestId", schedulerDecision.plan.retainedRequestIds.includes(requestId)
      ? `Request ${requestId} was retained or blocked, not dispatched.`
      : `Request ${requestId} has no unique factual dispatch.`, { runId, requestId });
    return creationDeny(reasons, schedulerDecision);
  }
  const dispatch = dispatches[0] as MultiProjectRunDispatch;
  const runningRuns = isPlainRecord(schedulerInput) ? own(schedulerInput, "runningRuns") : null;
  if (!Array.isArray(runningRuns)) {
    addReason(reasons, "invalid_scheduler_decision", "schedulerInput.runningRuns", "Factual AI-017 input did not preserve a valid runningRuns collection.", { runId, requestId });
    return creationDeny(reasons, schedulerDecision);
  }
  if (runningRuns.some((runningRun) => isPlainRecord(runningRun) && stableId(own(runningRun, "runId")) === runId)) {
    addReason(reasons, "duplicate_run_id", "runId", `Run ID ${runId} already exists in scheduler running state.`, { runId, requestId, projectId: dispatch.request.projectId, bindingId: dispatch.request.bindingId });
    return creationDeny(reasons, schedulerDecision);
  }
  const workflowCatalogDecision = evaluateWorkspaceWorkflowCatalog(workflowCatalog);
  if (workflowCatalogDecision.verdict === "deny" || workflowCatalogDecision.normalizedCatalog === null) {
    addReason(reasons, "invalid_workflow_catalog", "workflowCatalog", "Factual AI-020 Workflow Catalog was denied.", { runId, requestId, projectId: dispatch.request.projectId, bindingId: dispatch.request.bindingId });
    return creationDeny(reasons, schedulerDecision, null, workflowCatalogDecision);
  }
  const entries = workflowCatalogDecision.normalizedCatalog.workflows.filter((entry) =>
    entry.workflowManifest.projectId === dispatch.request.projectId && entry.bindingId === dispatch.request.bindingId,
  );
  if (entries.length !== 1) {
    addReason(reasons, "workflow_binding_not_found", "requestId", "Dispatch binding does not resolve to exactly one Workflow entry.", { runId, requestId, projectId: dispatch.request.projectId, bindingId: dispatch.request.bindingId });
    return creationDeny(reasons, schedulerDecision, null, workflowCatalogDecision);
  }
  const entry = entries[0];
  const workflowResolutionDecision = resolveWorkflowExecutionProfile({
    catalog: workflowCatalog,
    projectId: dispatch.request.projectId,
    workflowId: entry.workflowManifest.id,
    bindingId: dispatch.request.bindingId,
  });
  if (workflowResolutionDecision.verdict === "deny" || workflowResolutionDecision.profile === null || workflowResolutionDecision.contextDecision === null || workflowResolutionDecision.contextDecision.snapshot === null) {
    addReason(reasons, "workflow_resolution_denied", "workflowCatalog", "Factual AI-020 Workflow resolution was denied.", { runId, requestId, projectId: dispatch.request.projectId, workflowId: entry.workflowManifest.id, bindingId: dispatch.request.bindingId });
    return creationDeny(reasons, schedulerDecision, null, workflowCatalogDecision, workflowResolutionDecision);
  }
  let schedulerRegistryDecision: WorkspaceProjectContextsDecision | null = null;
  if (isPlainRecord(schedulerInput) && Object.hasOwn(schedulerInput, "registry")) {
    schedulerRegistryDecision = evaluateWorkspaceProjectContexts(own(schedulerInput, "registry"));
  }
  if (!schedulerRegistryDecision || schedulerRegistryDecision.verdict === "deny" || schedulerRegistryDecision.normalizedRegistry === null || !workflowCatalogDecision.registryDecision || !sameData(schedulerRegistryDecision, workflowCatalogDecision.registryDecision)) {
    addReason(reasons, "registry_context_mismatch", "schedulerInput.registry", "Scheduler and Workflow Catalog factual Registries do not match.", { runId, requestId, projectId: dispatch.request.projectId, workflowId: entry.workflowManifest.id, bindingId: dispatch.request.bindingId });
    return creationDeny(reasons, schedulerDecision, schedulerRegistryDecision, workflowCatalogDecision, workflowResolutionDecision);
  }
  const profile = workflowResolutionDecision.profile;
  const workflowContext = workflowResolutionDecision.contextDecision.snapshot;
  if (!sameData(dispatch.executionContext, workflowContext)
    || !dispatchContextMatchesProfile(dispatch.executionContext, profile)
    || !sameData(entry.effectiveResources, profile.resources)
    || !sameData(entry.effectiveModelProfileIds, profile.modelProfileIds)
    || !sameData(entry.effectiveKnowledgeCollectionIds, profile.knowledgeCollectionIds)
    || !sameData(entry.effectiveBudget, profile.budget)
    || !sameData(entry.effectiveRequiredApprovalActions, profile.requiredApprovalActions)
    || !sameData(entry.effectiveForbiddenActions, profile.forbiddenActions)) {
    addReason(reasons, "execution_context_mismatch", "schedulerInput", "AI-017 dispatch context and AI-020 Workflow profile do not match.", { runId, requestId, projectId: dispatch.request.projectId, departmentId: profile.departmentId, workflowId: profile.workflowId, bindingId: dispatch.request.bindingId });
    return creationDeny(reasons, schedulerDecision, schedulerRegistryDecision, workflowCatalogDecision, workflowResolutionDecision);
  }
  if (!profile.modelProfileIds.includes(dispatch.request.modelProfileId)) {
    addReason(reasons, "model_not_allowed", "schedulerInput.queuedRequests.modelProfileId", `Model ${dispatch.request.modelProfileId} is not allowed by the Workflow profile.`, { runId, requestId, projectId: dispatch.request.projectId, departmentId: profile.departmentId, workflowId: profile.workflowId, bindingId: dispatch.request.bindingId });
    return creationDeny(reasons, schedulerDecision, schedulerRegistryDecision, workflowCatalogDecision, workflowResolutionDecision);
  }
  const snapshot = buildInitialSnapshot(runId, dispatch.request, createdAt, profile);
  const snapshotValidation = validateSnapshotData(cloneTrusted(snapshot));
  if (snapshotValidation.verdict === "deny" || snapshotValidation.normalizedSnapshot === null) {
    return creationDeny(snapshotValidation.reasons, schedulerDecision, schedulerRegistryDecision, workflowCatalogDecision, workflowResolutionDecision);
  }
  return { verdict: "allow", reasons: [], schedulerDecision, schedulerRegistryDecision, workflowCatalogDecision, workflowResolutionDecision, snapshot: snapshotValidation.normalizedSnapshot };
}

export function createWorkflowRunSnapshot(input: unknown): WorkflowRunCreationDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) {
    const reasons: MutableReasons = [];
    addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Creation input exceeds bounded inspection limits." : "Creation input could not be safely snapshotted.");
    return creationDeny(reasons);
  }
  try {
    return createFromSnapshot(snapshot.value);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Creation input could not be safely evaluated.");
    return creationDeny(reasons);
  }
}

function normalizeIdList(
  input: unknown,
  path: string,
  maxItems: number,
  reasons: MutableReasons,
  eventIds: Partial<Pick<WorkflowRunReason, "runId" | "stepId" | "eventId">> = {},
): string[] | null {
  if (!Array.isArray(input)) {
    addReason(reasons, "invalid_event", path, `${path} must be an array.`, eventIds);
    return null;
  }
  if (input.length > maxItems) {
    addReason(reasons, "limit_exceeded", path, `${path} exceeds its item limit.`, eventIds);
    return null;
  }
  const values: string[] = [];
  const seen = new Set<string>();
  let invalid = false;
  for (const [index, item] of input.entries()) {
    const value = stableId(item);
    if (value === null) {
      invalid = true;
      addReason(reasons, "invalid_event", `${path}[${index}]`, "Expected an opaque stable ID.", eventIds);
    }
    else if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return invalid ? null : values;
}

function normalizeStepError(
  input: unknown,
  path: string,
  reasons: MutableReasons,
  ids: Partial<Pick<WorkflowRunReason, "runId" | "stepId" | "eventId">>,
): WorkflowRunStepError | null {
  if (!isPlainRecord(input) || !exactFields(input, errorFields)) {
    addReason(reasons, "invalid_event", path, "Step error must contain only code, message, and retryable.", ids);
    return null;
  }
  const code = normalizedText(own(input, "code"), workflowRunLimits.maxErrorCodeLength);
  const message = normalizedText(own(input, "message"), workflowRunLimits.maxErrorMessageLength);
  const retryable = own(input, "retryable");
  if (code === null) addReason(reasons, "invalid_event", `${path}.code`, "Error code is invalid.", ids);
  if (message === null) addReason(reasons, "invalid_event", `${path}.message`, "Error message is invalid.", ids);
  if (typeof retryable !== "boolean") addReason(reasons, "invalid_event", `${path}.retryable`, "retryable must be boolean.", ids);
  return code !== null && message !== null && typeof retryable === "boolean" ? { code, message, retryable } : null;
}

function eventFields(kind: WorkflowRunEventKind): readonly string[] {
  switch (kind) {
    case "step_started": return [...eventCommonFields, "stepId"];
    case "step_succeeded": return [...eventCommonFields, "stepId", "outputArtifactIds"];
    case "step_failed": return [...eventCommonFields, "stepId", "error"];
    case "approval_requested":
    case "approval_granted": return [...eventCommonFields, "stepId", "approvalRequestId"];
    case "approval_rejected": return [...eventCommonFields, "stepId", "approvalRequestId", "reason"];
    case "run_blocked":
    case "run_cancelled": return [...eventCommonFields, "reasonCode", "message"];
    default: return eventCommonFields;
  }
}

function normalizeEvent(
  input: unknown,
  path: string,
  reasons: MutableReasons,
): WorkflowRunEvent | null {
  if (!isPlainRecord(input)) {
    addReason(reasons, "invalid_event", path, "Lifecycle event must be a plain object.");
    return null;
  }
  const kindInput = own(input, "kind");
  if (!includesValue(workflowRunEventKinds, kindInput)) {
    addReason(reasons, "invalid_event", `${path}.kind`, "Unknown Workflow Run event kind.");
    return null;
  }
  const fields = eventFields(kindInput);
  if (!exactFields(input, fields)) {
    addReason(reasons, "invalid_event", path, `${kindInput} event has missing or unknown fields.`);
    return null;
  }
  const eventId = stableId(own(input, "eventId"));
  const runId = stableId(own(input, "runId"));
  const sequence = own(input, "sequence");
  const occurredAt = canonicalTimestamp(own(input, "occurredAt"));
  const actorKind = own(input, "actorKind");
  const actorIdInput = own(input, "actorId");
  const actorId = typeof actorIdInput === "string" && actorIdPattern.test(actorIdInput.trim()) ? actorIdInput.trim() : null;
  const ids = { runId, eventId };
  if (eventId === null) addReason(reasons, "invalid_event", `${path}.eventId`, "eventId must be a stable ID.", ids);
  if (runId === null) addReason(reasons, "invalid_event", `${path}.runId`, "runId must be a stable ID.", ids);
  if (!Number.isSafeInteger(sequence) || (sequence as number) < 1) addReason(reasons, "invalid_event", `${path}.sequence`, "sequence must be a positive safe integer.", ids);
  if (occurredAt === null) addReason(reasons, "invalid_event", `${path}.occurredAt`, "occurredAt must be canonical UTC RFC3339 with milliseconds.", ids);
  if (!includesValue(workflowRunActorKinds, actorKind)) addReason(reasons, "invalid_event", `${path}.actorKind`, "Unknown actor kind.", ids);
  if (actorId === null) addReason(reasons, "invalid_event", `${path}.actorId`, "actorId is invalid.", ids);
  if (eventId === null || runId === null || !Number.isSafeInteger(sequence) || (sequence as number) < 1 || occurredAt === null || !includesValue(workflowRunActorKinds, actorKind) || actorId === null) return null;
  const common = { eventId, runId, kind: kindInput, sequence: sequence as number, occurredAt, actorKind, actorId };
  if (kindInput === "run_started" || kindInput === "review_started" || kindInput === "run_completed") return common as WorkflowRunEvent;
  if (kindInput === "run_blocked" || kindInput === "run_cancelled") {
    const reasonCode = normalizedText(own(input, "reasonCode"), workflowRunLimits.maxErrorCodeLength);
    const message = normalizedText(own(input, "message"), workflowRunLimits.maxErrorMessageLength);
    if (reasonCode === null) addReason(reasons, "invalid_event", `${path}.reasonCode`, "reasonCode is invalid.", ids);
    if (message === null) addReason(reasons, "invalid_event", `${path}.message`, "message is invalid.", ids);
    return reasonCode !== null && message !== null ? { ...common, kind: kindInput, reasonCode, message } : null;
  }
  const stepId = stableId(own(input, "stepId"));
  if (stepId === null) {
    addReason(reasons, "invalid_event", `${path}.stepId`, "stepId must be a stable ID.", ids);
    return null;
  }
  const stepIds = { ...ids, stepId };
  if (kindInput === "step_started") return { ...common, kind: kindInput, stepId };
  if (kindInput === "step_succeeded") {
    const artifacts = normalizeIdList(own(input, "outputArtifactIds"), `${path}.outputArtifactIds`, workflowRunLimits.maxOutputArtifactIds, reasons, stepIds);
    return artifacts === null ? null : { ...common, kind: kindInput, stepId, outputArtifactIds: artifacts };
  }
  if (kindInput === "step_failed") {
    const error = normalizeStepError(own(input, "error"), `${path}.error`, reasons, stepIds);
    return error === null ? null : { ...common, kind: kindInput, stepId, error };
  }
  const approvalRequestId = stableId(own(input, "approvalRequestId"));
  if (approvalRequestId === null) {
    addReason(reasons, "invalid_event", `${path}.approvalRequestId`, "approvalRequestId must be an opaque stable ID.", stepIds);
    return null;
  }
  if (kindInput === "approval_requested" || kindInput === "approval_granted") return { ...common, kind: kindInput, stepId, approvalRequestId };
  const reason = normalizedText(own(input, "reason"), workflowRunLimits.maxErrorMessageLength);
  if (reason === null) {
    addReason(reasons, "invalid_event", `${path}.reason`, "Approval rejection reason is invalid.", stepIds);
    return null;
  }
  return { ...common, kind: "approval_rejected", stepId, approvalRequestId, reason };
}

function stateForStep(state: ReplayState, stepId: string): MutableStepState | undefined {
  return state.stepStates.find((candidate) => candidate.stepId === stepId);
}

function profileStep(profile: WorkflowExecutionProfile, stepId: string): WorkflowStep | undefined {
  return profile.steps.find((candidate) => candidate.id === stepId);
}

function dependenciesSuccessful(
  profile: WorkflowExecutionProfile,
  state: ReplayState,
  step: WorkflowStep,
): boolean {
  return step.dependsOnStepIds.every((dependencyId) => stateForStep(state, dependencyId)?.status === "success");
}

function blockRemainingSteps(state: ReplayState, status: "blocked" | "cancelled"): void {
  for (const step of state.stepStates) if (step.status === "pending" || step.status === "running" || step.status === "waiting_approval") step.status = status;
}

function eventIds(event: WorkflowRunEvent, snapshot: Pick<WorkflowRunSnapshot, "requestId" | "projectId" | "departmentId" | "workflowId" | "workflowBindingId">) {
  return {
    runId: event.runId,
    requestId: snapshot.requestId,
    projectId: snapshot.projectId,
    departmentId: snapshot.departmentId,
    workflowId: snapshot.workflowId,
    bindingId: snapshot.workflowBindingId,
    stepId: "stepId" in event ? event.stepId : null,
    eventId: event.eventId,
  };
}

function applyEvent(
  state: ReplayState,
  event: WorkflowRunEvent,
  snapshot: Pick<WorkflowRunSnapshot, "runId" | "requestId" | "projectId" | "departmentId" | "workflowId" | "workflowBindingId" | "executionProfile">,
  path: string,
  reasons: MutableReasons,
): boolean {
  const ids = eventIds(event, snapshot);
  if (event.runId !== snapshot.runId) {
    addReason(reasons, "run_id_mismatch", `${path}.runId`, "Event runId does not match snapshot.", ids);
    return false;
  }
  if (state.eventIds.has(event.eventId)) {
    addReason(reasons, "duplicate_event_id", `${path}.eventId`, `Event ${event.eventId} is duplicated.`, ids);
    return false;
  }
  if (event.sequence !== state.revision + 1) {
    addReason(reasons, "invalid_sequence", `${path}.sequence`, `Expected sequence ${state.revision + 1}.`, ids);
    return false;
  }
  if (event.occurredAt < state.updatedAt) {
    addReason(reasons, "timestamp_regression", `${path}.occurredAt`, "Event timestamp cannot move backwards.", ids);
    return false;
  }
  if (isTerminalWorkflowRunStatus(state.status)) {
    addReason(reasons, "terminal_run", path, `Terminal run ${state.status} accepts no events.`, ids);
    return false;
  }
  if (event.kind === "run_blocked" || event.kind === "run_cancelled") {
    state.status = event.kind === "run_blocked" ? "blocked" : "cancelled";
    blockRemainingSteps(state, event.kind === "run_blocked" ? "blocked" : "cancelled");
  } else if (event.kind === "run_started") {
    if (state.status !== "queued") {
      addReason(reasons, "invalid_transition", path, "run_started requires a queued run.", ids);
      return false;
    }
    state.status = "running";
  } else if (event.kind === "review_started") {
    if (state.status !== "running" || state.stepStates.some((step) => step.status !== "success")) {
      addReason(reasons, "invalid_transition", path, "review_started requires every step to be successful in a running run.", ids);
      return false;
    }
    state.status = "review";
  } else if (event.kind === "run_completed") {
    if (state.status !== "review") {
      addReason(reasons, "invalid_transition", path, "run_completed requires review status.", ids);
      return false;
    }
    state.status = "completed";
  } else {
    const step = profileStep(snapshot.executionProfile, event.stepId);
    const stepState = stateForStep(state, event.stepId);
    if (!step || !stepState) {
      addReason(reasons, "step_not_found", `${path}.stepId`, `Step ${event.stepId} was not found.`, ids);
      return false;
    }
    if (event.kind === "step_started") {
      if (step.kind !== "agent_task") {
        addReason(reasons, "wrong_step_kind", `${path}.stepId`, "step_started applies only to agent_task.", ids);
        return false;
      }
      if (state.status !== "running" || stepState.status !== "pending" || !dependenciesSuccessful(snapshot.executionProfile, state, step) || state.stepStates.some((candidate) => candidate.status === "waiting_approval")) {
        addReason(reasons, "step_not_ready", `${path}.stepId`, "Agent task is not ready to start.", ids);
        return false;
      }
      if (stepState.attemptCount >= step.maxAttempts) {
        addReason(reasons, "attempt_limit_exceeded", `${path}.stepId`, "Agent task attempt limit is exhausted.", ids);
        return false;
      }
      stepState.status = "running";
      stepState.attemptCount += 1;
    } else if (event.kind === "step_succeeded" || event.kind === "step_failed") {
      if (step.kind !== "agent_task") {
        addReason(reasons, "wrong_step_kind", `${path}.stepId`, `${event.kind} applies only to agent_task.`, ids);
        return false;
      }
      if (state.status !== "running" || stepState.status !== "running") {
        addReason(reasons, "step_not_running", `${path}.stepId`, "Agent task must be running.", ids);
        return false;
      }
      if (event.kind === "step_succeeded") {
        stepState.status = "success";
        stepState.outputArtifactIds = [...event.outputArtifactIds];
        stepState.lastError = null;
      } else {
        stepState.lastError = { ...event.error };
        const task = step as WorkflowAgentTaskStep;
        if (event.error.retryable && stepState.attemptCount < task.maxAttempts) stepState.status = "pending";
        else {
          stepState.status = "failed";
          state.status = "failed";
          blockRemainingSteps(state, "blocked");
        }
      }
    } else if (event.kind === "approval_requested") {
      if (step.kind !== "approval_gate") {
        addReason(reasons, "wrong_step_kind", `${path}.stepId`, "approval_requested applies only to approval_gate.", ids);
        return false;
      }
      if (state.status !== "running" || stepState.status !== "pending" || !dependenciesSuccessful(snapshot.executionProfile, state, step) || state.stepStates.some((candidate) => candidate.status === "waiting_approval")) {
        addReason(reasons, "step_not_ready", `${path}.stepId`, "Approval gate is not ready.", ids);
        return false;
      }
      stepState.status = "waiting_approval";
      stepState.approvalRequestId = event.approvalRequestId;
      state.status = "waiting_approval";
    } else {
      if (step.kind !== "approval_gate") {
        addReason(reasons, "wrong_step_kind", `${path}.stepId`, `${event.kind} applies only to approval_gate.`, ids);
        return false;
      }
      if (state.status !== "waiting_approval" || stepState.status !== "waiting_approval" || stepState.approvalRequestId !== event.approvalRequestId) {
        addReason(reasons, "approval_mismatch", `${path}.approvalRequestId`, "Approval reference or waiting state does not match.", ids);
        return false;
      }
      if (event.kind === "approval_granted") {
        stepState.status = "success";
        state.status = "running";
      } else {
        stepState.status = "blocked";
        state.status = "blocked";
        blockRemainingSteps(state, "blocked");
      }
    }
  }
  state.eventIds.add(event.eventId);
  state.events.push(event);
  state.revision += 1;
  state.updatedAt = event.occurredAt;
  state.readyStepIds = computeReadyStepIds(state.status, snapshot.executionProfile, state.stepStates);
  return true;
}

function normalizeStepStatesShape(input: unknown, reasons: MutableReasons): boolean {
  if (!Array.isArray(input) || input.length > workflowManifestLimits.maxSteps) {
    addReason(reasons, "invalid_snapshot", "stepStates", "stepStates must be a bounded array.");
    return false;
  }
  for (const [index, value] of input.entries()) {
    const path = `stepStates[${index}]`;
    if (!isPlainRecord(value) || !exactFields(value, stepStateFields)) {
      addReason(reasons, "invalid_snapshot", path, "Step state has missing or unknown fields.");
      continue;
    }
    if (stableId(own(value, "stepId")) === null || !includesValue(["agent_task", "approval_gate"] as const, own(value, "kind")) || !includesValue(workflowRunStepStatuses, own(value, "status")) || !Number.isSafeInteger(own(value, "attemptCount")) || (own(value, "attemptCount") as number) < 0) addReason(reasons, "invalid_snapshot", path, "Step state identity/status/counter is invalid.");
    const approval = own(value, "approvalRequestId");
    if (approval !== null && stableId(approval) === null) addReason(reasons, "invalid_snapshot", `${path}.approvalRequestId`, "approvalRequestId is invalid.");
    if (!Array.isArray(own(value, "outputArtifactIds"))) addReason(reasons, "invalid_snapshot", `${path}.outputArtifactIds`, "outputArtifactIds must be an array.");
    const error = own(value, "lastError");
    if (error !== null && (!isPlainRecord(error) || !exactFields(error, errorFields))) addReason(reasons, "invalid_snapshot", `${path}.lastError`, "lastError is invalid.");
  }
  return reasons.length === 0;
}

function canonicalInitial(
  metadata: Pick<WorkflowRunSnapshot, "runId" | "requestId" | "idempotencyKey" | "workspaceId" | "projectId" | "departmentId" | "workflowId" | "workflowManifestVersion" | "workflowBindingId" | "workflowBindingVersion" | "priority" | "modelProfileId" | "createdAt" | "executionProfile">,
): WorkflowRunSnapshot {
  const profile = cloneTrusted(metadata.executionProfile);
  const states = initialStepStates(profile);
  return freezeSnapshot({
    ...metadata,
    status: "queued",
    revision: 0,
    updatedAt: metadata.createdAt,
    executionProfile: profile,
    stepStates: states,
    readyStepIds: computeReadyStepIds("queued", profile, states),
    events: [],
  });
}

function replayState(initial: WorkflowRunSnapshot): ReplayState {
  return {
    status: initial.status,
    revision: initial.revision,
    updatedAt: initial.updatedAt,
    stepStates: initial.stepStates.map((step) => ({
      ...step,
      outputArtifactIds: [...step.outputArtifactIds],
      lastError: step.lastError ? { ...step.lastError } : null,
    })),
    readyStepIds: [...initial.readyStepIds],
    events: [],
    eventIds: new Set<string>(),
  };
}

function snapshotFromReplay(initial: WorkflowRunSnapshot, state: ReplayState): WorkflowRunSnapshot {
  return freezeSnapshot({
    ...initial,
    status: state.status,
    revision: state.revision,
    updatedAt: state.updatedAt,
    executionProfile: cloneTrusted(initial.executionProfile),
    stepStates: state.stepStates.map((step) => ({ ...step, outputArtifactIds: [...step.outputArtifactIds], lastError: step.lastError ? { ...step.lastError } : null })),
    readyStepIds: [...state.readyStepIds],
    events: state.events.map((event) => cloneTrusted(event)),
  });
}

function validationDeny(reasons: readonly WorkflowRunReason[]): WorkflowRunSnapshotValidationDecision {
  return { verdict: "deny", reasons, normalizedSnapshot: null };
}

function validateSnapshotData(input: unknown): WorkflowRunSnapshotValidationDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !exactFields(input, snapshotFields)) {
    addReason(reasons, "invalid_snapshot", "$", "WorkflowRunSnapshot has missing or unknown fields.");
    return validationDeny(reasons);
  }
  const runId = stableId(own(input, "runId"));
  const requestId = stableId(own(input, "requestId"));
  const idempotencyKey = stableId(own(input, "idempotencyKey"));
  const workspaceId = stableId(own(input, "workspaceId"));
  const projectId = stableId(own(input, "projectId"));
  const departmentId = stableId(own(input, "departmentId"));
  const workflowId = stableId(own(input, "workflowId"));
  const workflowBindingId = stableId(own(input, "workflowBindingId"));
  const modelProfileId = stableId(own(input, "modelProfileId"));
  const createdAt = canonicalTimestamp(own(input, "createdAt"));
  const updatedAt = canonicalTimestamp(own(input, "updatedAt"));
  const workflowManifestVersion = own(input, "workflowManifestVersion");
  const workflowBindingVersion = own(input, "workflowBindingVersion");
  const priority = own(input, "priority");
  const status = own(input, "status");
  const revision = own(input, "revision");
  const profileInput = own(input, "executionProfile");
  const requiredIds = { runId, requestId, idempotencyKey, workspaceId, projectId, departmentId, workflowId, workflowBindingId, modelProfileId };
  for (const [key, value] of Object.entries(requiredIds)) if (value === null) addReason(reasons, "invalid_snapshot", key, `${key} must be a stable ID.`, { runId, requestId, projectId, departmentId, workflowId, bindingId: workflowBindingId });
  if (createdAt === null || updatedAt === null) addReason(reasons, "invalid_snapshot", createdAt === null ? "createdAt" : "updatedAt", "Snapshot timestamps must be canonical.", { runId, requestId });
  if (!Number.isSafeInteger(workflowManifestVersion) || (workflowManifestVersion as number) < 1 || !Number.isSafeInteger(workflowBindingVersion) || (workflowBindingVersion as number) < 1) addReason(reasons, "invalid_snapshot", "workflowManifestVersion", "Workflow versions must be positive safe integers.", { runId, requestId });
  if (!includesValue(projectRunPriorities, priority) || !includesValue(workflowRunStatuses, status) || !Number.isSafeInteger(revision) || (revision as number) < 0) addReason(reasons, "invalid_snapshot", "status", "Snapshot priority, status, or revision is invalid.", { runId, requestId });
  if (!profileSafe(profileInput)) addReason(reasons, "invalid_snapshot", "executionProfile", "Execution profile shape is invalid or internally inconsistent.", { runId, requestId, projectId, departmentId, workflowId, bindingId: workflowBindingId });
  normalizeStepStatesShape(own(input, "stepStates"), reasons);
  const readyInput = own(input, "readyStepIds");
  if (!Array.isArray(readyInput) || readyInput.some((value) => stableId(value) === null)) addReason(reasons, "invalid_snapshot", "readyStepIds", "readyStepIds must contain stable IDs.", { runId, requestId });
  const eventsInput = own(input, "events");
  if (!Array.isArray(eventsInput) || eventsInput.length > workflowRunLimits.maxLifecycleEvents) addReason(reasons, eventsInput && Array.isArray(eventsInput) ? "limit_exceeded" : "invalid_snapshot", "events", "events must be a bounded array.", { runId, requestId });
  if (reasons.length > 0 || Object.values(requiredIds).some((value) => value === null) || createdAt === null || updatedAt === null || !Number.isSafeInteger(workflowManifestVersion) || !Number.isSafeInteger(workflowBindingVersion) || !includesValue(projectRunPriorities, priority) || !includesValue(workflowRunStatuses, status) || !Number.isSafeInteger(revision) || !profileSafe(profileInput) || !Array.isArray(eventsInput)) return validationDeny(reasons);
  const profile = cloneTrusted(profileInput);
  if (profile.workspaceId !== workspaceId || profile.projectId !== projectId || profile.departmentId !== departmentId || profile.workflowId !== workflowId || profile.workflowManifestVersion !== workflowManifestVersion || profile.workflowBindingId !== workflowBindingId || profile.workflowBindingVersion !== workflowBindingVersion || !profile.modelProfileIds.includes(modelProfileId as string)) {
    addReason(reasons, "invalid_snapshot", "executionProfile", "Execution profile identity does not match snapshot.", { runId, requestId, projectId, departmentId, workflowId, bindingId: workflowBindingId });
    return validationDeny(reasons);
  }
  const initial = canonicalInitial({
    runId: runId as string,
    requestId: requestId as string,
    idempotencyKey: idempotencyKey as string,
    workspaceId: workspaceId as string,
    projectId: projectId as string,
    departmentId: departmentId as string,
    workflowId: workflowId as string,
    workflowManifestVersion: workflowManifestVersion as number,
    workflowBindingId: workflowBindingId as string,
    workflowBindingVersion: workflowBindingVersion as number,
    priority,
    modelProfileId: modelProfileId as string,
    createdAt,
    executionProfile: profile,
  });
  const state = replayState(initial);
  for (const [index, eventInput] of eventsInput.entries()) {
    const event = normalizeEvent(eventInput, `events[${index}]`, reasons);
    if (!event || !applyEvent(state, event, initial, `events[${index}]`, reasons)) return validationDeny(reasons);
  }
  const replayed = snapshotFromReplay(initial, state);
  if (!sameData(replayed.status, status)
    || replayed.revision !== revision
    || replayed.updatedAt !== updatedAt
    || !sameData(replayed.stepStates, own(input, "stepStates"))
    || !sameData(replayed.readyStepIds, readyInput)
    || !sameData(replayed.events, eventsInput)) {
    addReason(reasons, "history_mismatch", "$", "Snapshot state does not match deterministic event replay.", { runId, requestId, projectId, departmentId, workflowId, bindingId: workflowBindingId });
    return validationDeny(reasons);
  }
  return { verdict: "allow", reasons: [], normalizedSnapshot: replayed };
}

export function validateAndNormalizeWorkflowRunSnapshot(input: unknown): WorkflowRunSnapshotValidationDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) {
    const reasons: MutableReasons = [];
    addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Snapshot exceeds bounded inspection limits." : "Snapshot could not be safely inspected.");
    return validationDeny(reasons);
  }
  try {
    return validateSnapshotData(snapshot.value);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Snapshot could not be safely validated.");
    return validationDeny(reasons);
  }
}

function transitionDeny(
  reasons: readonly WorkflowRunReason[],
  snapshotDecision: WorkflowRunSnapshotValidationDecision,
): WorkflowRunTransitionDecision {
  return { verdict: "deny", reasons, snapshotDecision, normalizedEvent: null, nextSnapshot: null };
}

function transitionFromSnapshot(input: unknown): WorkflowRunTransitionDecision {
  const envelopeReasons: MutableReasons = [];
  if (!isPlainRecord(input) || !exactFields(input, ["snapshot", "event"])) {
    addReason(envelopeReasons, "invalid_input", "$", "Transition input must contain only snapshot and event.");
    return transitionDeny(envelopeReasons, validationDeny(envelopeReasons));
  }
  const snapshotDecision = validateSnapshotData(own(input, "snapshot"));
  if (snapshotDecision.verdict === "deny" || snapshotDecision.normalizedSnapshot === null) return transitionDeny(snapshotDecision.reasons, snapshotDecision);
  const eventReasons: MutableReasons = [];
  const event = normalizeEvent(own(input, "event"), "event", eventReasons);
  if (!event) return transitionDeny(eventReasons, snapshotDecision);
  const current = snapshotDecision.normalizedSnapshot;
  const state: ReplayState = {
    status: current.status,
    revision: current.revision,
    updatedAt: current.updatedAt,
    stepStates: current.stepStates.map((step) => ({ ...step, outputArtifactIds: [...step.outputArtifactIds], lastError: step.lastError ? { ...step.lastError } : null })),
    readyStepIds: [...current.readyStepIds],
    events: current.events.map((candidate) => cloneTrusted(candidate)),
    eventIds: new Set(current.events.map((candidate) => candidate.eventId)),
  };
  if (!applyEvent(state, event, current, "event", eventReasons)) return transitionDeny(eventReasons, snapshotDecision);
  const next = freezeSnapshot({
    ...current,
    status: state.status,
    revision: state.revision,
    updatedAt: state.updatedAt,
    executionProfile: cloneTrusted(current.executionProfile),
    stepStates: state.stepStates.map((step) => ({ ...step, outputArtifactIds: [...step.outputArtifactIds], lastError: step.lastError ? { ...step.lastError } : null })),
    readyStepIds: [...state.readyStepIds],
    events: state.events.map((candidate) => cloneTrusted(candidate)),
  });
  const check = validateSnapshotData(cloneTrusted(next));
  if (check.verdict === "deny" || check.normalizedSnapshot === null) {
    addReason(eventReasons, "history_mismatch", "event", "Next snapshot failed internal replay validation.", eventIds(event, current));
    return transitionDeny(eventReasons, snapshotDecision);
  }
  return { verdict: "allow", reasons: [], snapshotDecision, normalizedEvent: deepFreezeData(cloneTrusted(event)), nextSnapshot: check.normalizedSnapshot };
}

export function evaluateWorkflowRunTransition(input: unknown): WorkflowRunTransitionDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) {
    const reasons: MutableReasons = [];
    addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Transition input exceeds bounded inspection limits." : "Transition input could not be safely snapshotted.");
    return transitionDeny(reasons, validationDeny(reasons));
  }
  try {
    return transitionFromSnapshot(snapshot.value);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Transition input could not be safely evaluated.");
    return transitionDeny(reasons, validationDeny(reasons));
  }
}
