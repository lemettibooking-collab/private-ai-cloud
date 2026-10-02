import type {
  AgentExecutionProfile,
  AgentExecutionProfileResolutionDecision,
  AgentManifest,
  AgentOutputType,
  NormalizedAgentCatalogEntry,
  WorkspaceAgentCatalogDecision,
} from "./agent-manifest";
import type {
  NormalizedProjectSubjectBinding,
  ProjectExecutionContextResolutionDecision,
  ProjectExecutionContextSnapshot,
  WorkspaceProjectContextsDecision,
} from "./project-context";
import type {
  ProjectBudgetCeiling,
  ProjectDataEgressMode,
  ProjectExternalActionMode,
  ProjectResourceCapability,
} from "./project-manifest";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { agentOutputTypes, evaluateWorkspaceAgentCatalog, resolveAgentExecutionProfile } from "./agent-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkspaceProjectContexts, projectContextLimits, resolveProjectExecutionContext } from "./project-context.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { projectResourceCapabilities } from "./project-manifest.ts";

export const workflowManifestStatuses = Object.freeze([
  "draft",
  "active",
  "paused",
  "disabled",
] as const);
export type WorkflowManifestStatus = (typeof workflowManifestStatuses)[number];

export const workflowTriggerModes = Object.freeze([
  "manual",
  "event",
  "scheduled",
  "api",
] as const);
export type WorkflowTriggerMode = (typeof workflowTriggerModes)[number];

export const workflowStepKinds = Object.freeze([
  "agent_task",
  "approval_gate",
] as const);
export type WorkflowStepKind = (typeof workflowStepKinds)[number];

export const workflowActionModes = Object.freeze([
  "none",
  "proposal_only",
  "external_action",
] as const);
export type WorkflowActionMode = (typeof workflowActionModes)[number];

export const workflowCatalogVerdicts = Object.freeze(["allow", "deny"] as const);
export type WorkflowCatalogVerdict = (typeof workflowCatalogVerdicts)[number];

export const workflowManifestLimits = Object.freeze({
  maxIdLength: 64,
  maxNameLength: 160,
  maxSummaryLength: 4096,
  maxGoals: 32,
  maxNonGoals: 32,
  maxTextListItemLength: 1024,
  maxSteps: 128,
  maxDependenciesPerStep: 32,
  maxResourcesPerStep: 64,
  maxCapabilitiesPerResource: projectResourceCapabilities.length,
  maxKnowledgeCollectionIds: 64,
  maxToolIds: 64,
  maxAdditionalApprovalActions: 64,
  maxAdditionalForbiddenActions: 64,
  maxStepAttempts: 1_000,
  maxStepTimeoutMinutes: 10_080,
  maxErrors: 256,
  maxGraphInspections: 16_384,
  maxCatalogEntries:
    projectContextLimits.maxProjects * projectContextLimits.maxBindingsPerProject,
  maxSnapshotDepth: 32,
  maxSnapshotProperties: 262_144,
  maxSnapshotArrayLength:
    projectContextLimits.maxProjects * projectContextLimits.maxBindingsPerProject,
  maxSnapshotStringLength: 8_192,
});

export type WorkflowResourceRequest = Readonly<{
  resourceId: string;
  capabilities: readonly ProjectResourceCapability[];
}>;

export type WorkflowStepBase = Readonly<{
  id: string;
  kind: WorkflowStepKind;
  name: string;
  dependsOnStepIds: readonly string[];
}>;

export type WorkflowAgentTaskStep = WorkflowStepBase & Readonly<{
  kind: "agent_task";
  agentId: string;
  agentBindingId: string;
  outputType: AgentManifest["outputTypes"][number];
  requestedResources: readonly WorkflowResourceRequest[];
  modelProfileId: string;
  knowledgeCollectionIds: readonly string[];
  toolIds: readonly string[];
  maxAttempts: number;
  timeoutMinutes: number;
  actionMode: WorkflowActionMode;
  requiredApprovalAction: string | null;
}>;

export type WorkflowApprovalGateStep = WorkflowStepBase & Readonly<{
  kind: "approval_gate";
  approvalAction: string;
}>;

export type WorkflowStep = WorkflowAgentTaskStep | WorkflowApprovalGateStep;

export type WorkflowManifest = Readonly<{
  id: string;
  projectId: string;
  departmentId: string;
  version: number;
  name: string;
  summary: string;
  status: WorkflowManifestStatus;
  triggerMode: WorkflowTriggerMode;
  goals: readonly string[];
  nonGoals: readonly string[];
  steps: readonly WorkflowStep[];
  finalStepIds: readonly string[];
  additionalRequiredApprovalActions: readonly string[];
  additionalForbiddenActions: readonly string[];
}>;

export type WorkflowManifestValidationErrorCode =
  | "invalid_input"
  | "unknown_field"
  | "required_field"
  | "invalid_type"
  | "invalid_id"
  | "invalid_integer"
  | "invalid_enum"
  | "limit_exceeded"
  | "empty_collection"
  | "duplicate_resource_id"
  | "duplicate_step_id"
  | "unknown_step_dependency"
  | "self_dependency"
  | "workflow_cycle"
  | "invalid_final_step"
  | "invalid_workflow_graph";

export type WorkflowManifestValidationError = Readonly<{
  code: WorkflowManifestValidationErrorCode;
  path: string;
  message: string;
}>;

export type WorkflowManifestValidationResult =
  | Readonly<{ ok: true; value: WorkflowManifest }>
  | Readonly<{ ok: false; errors: readonly WorkflowManifestValidationError[] }>;

export type WorkspaceWorkflowCatalogEntryInput = Readonly<{
  bindingId: string;
  workflowManifest: unknown;
}>;

export type WorkspaceWorkflowCatalogInput = Readonly<{
  registry: unknown;
  agents: unknown;
  workflows: unknown;
}>;

export type WorkflowCatalogReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "invalid_registry"
  | "invalid_agent_catalog"
  | "invalid_workflow_manifest"
  | "duplicate_workflow_id"
  | "duplicate_workflow_binding"
  | "missing_workflow_manifest"
  | "workflow_binding_not_found"
  | "binding_not_workflow"
  | "workflow_project_mismatch"
  | "workflow_department_mismatch"
  | "workflow_subject_mismatch"
  | "workflow_not_enabled"
  | "invalid_workflow_graph"
  | "unknown_step_dependency"
  | "workflow_cycle"
  | "invalid_final_step"
  | "agent_not_found"
  | "agent_project_mismatch"
  | "agent_department_mismatch"
  | "agent_workflow_not_allowed"
  | "resource_not_granted"
  | "capability_not_granted"
  | "model_not_granted"
  | "knowledge_not_granted"
  | "tool_not_allowed"
  | "output_not_allowed"
  | "budget_ceiling_exceeded"
  | "approval_gate_missing"
  | "policy_relaxation"
  | "forbidden_action"
  | "inherited_policy_capacity_exceeded"
  | "workflow_not_active"
  | "binding_not_active"
  | "context_resolution_denied"
  | "agent_resolution_denied";

export type WorkflowCatalogReason = Readonly<{
  code: WorkflowCatalogReasonCode;
  path: string;
  message: string;
  projectId: string | null;
  departmentId: string | null;
  workflowId: string | null;
  workflowBindingId: string | null;
  stepId: string | null;
  agentId: string | null;
  agentBindingId: string | null;
}>;

export type WorkflowAgentAssignment = Readonly<{
  agentId: string;
  agentBindingId: string;
  projectId: string;
  departmentId: string;
  agentManifestVersion: number;
  agentBindingVersion: number;
  agentStatus: AgentManifest["status"];
  agentBindingStatus: NormalizedProjectSubjectBinding["status"];
  outputTypes: readonly AgentManifest["outputTypes"][number][];
  allowedWorkflowIds: readonly string[];
  allowedToolIds: readonly string[];
  allowedModelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  resources: readonly WorkflowResourceRequest[];
  budget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  requiredApprovalActions: readonly string[];
  forbiddenActions: readonly string[];
}>;

export type NormalizedWorkflowCatalogEntry = Readonly<{
  bindingId: string;
  bindingVersion: number;
  bindingStatus: NormalizedProjectSubjectBinding["status"];
  workflowManifest: WorkflowManifest;
  executionWaves: readonly (readonly string[])[];
  agentAssignments: readonly WorkflowAgentAssignment[];
  effectiveResources: readonly WorkflowResourceRequest[];
  effectiveModelProfileIds: readonly string[];
  effectiveKnowledgeCollectionIds: readonly string[];
  effectiveBudget: ProjectBudgetCeiling;
  effectiveExternalActionMode: ProjectExternalActionMode;
  effectiveDataEgressMode: ProjectDataEgressMode;
  effectiveRequiredApprovalActions: readonly string[];
  effectiveForbiddenActions: readonly string[];
}>;

export type NormalizedWorkspaceWorkflowCatalog = Readonly<{
  workspaceId: string;
  workflows: readonly NormalizedWorkflowCatalogEntry[];
}>;

export type WorkspaceWorkflowCatalogDecision = Readonly<{
  verdict: WorkflowCatalogVerdict;
  reasons: readonly WorkflowCatalogReason[];
  registryDecision: WorkspaceProjectContextsDecision | null;
  agentCatalogDecision: WorkspaceAgentCatalogDecision | null;
  normalizedCatalog: NormalizedWorkspaceWorkflowCatalog | null;
}>;

export type WorkflowExecutionProfile = Readonly<{
  workspaceId: string;
  projectId: string;
  projectManifestVersion: number;
  departmentId: string;
  departmentManifestVersion: number;
  workflowId: string;
  workflowManifestVersion: number;
  workflowStatus: WorkflowManifestStatus;
  workflowBindingId: string;
  workflowBindingVersion: number;
  triggerMode: WorkflowTriggerMode;
  executionWaves: readonly (readonly string[])[];
  steps: readonly WorkflowStep[];
  agents: readonly AgentExecutionProfile[];
  resources: readonly WorkflowResourceRequest[];
  modelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  budget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  requiredApprovalActions: readonly string[];
  forbiddenActions: readonly string[];
}>;

export type WorkflowExecutionProfileResolutionInput = Readonly<{
  catalog: unknown;
  projectId: string;
  workflowId: string;
  bindingId: string;
}>;

export type WorkflowExecutionProfileResolutionDecision = Readonly<{
  verdict: WorkflowCatalogVerdict;
  reasons: readonly WorkflowCatalogReason[];
  catalogDecision: WorkspaceWorkflowCatalogDecision;
  contextDecision: ProjectExecutionContextResolutionDecision | null;
  agentDecisions: readonly AgentExecutionProfileResolutionDecision[];
  profile: WorkflowExecutionProfile | null;
}>;

type MutableValidationErrors = WorkflowManifestValidationError[];
type MutableCatalogReasons = WorkflowCatalogReason[];
type SnapshotState = { properties: number; active: WeakSet<object> };
type SnapshotResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; limited: boolean }>;
type ManifestGraph = Readonly<{
  waves: readonly (readonly string[])[];
  ancestorsByStepId: ReadonlyMap<string, ReadonlySet<string>>;
}>;
type ManifestDetailResult =
  | Readonly<{ ok: true; value: WorkflowManifest; graph: ManifestGraph }>
  | Readonly<{ ok: false; errors: readonly WorkflowManifestValidationError[] }>;
type WorkflowSourceEntry = Readonly<{
  path: string;
  bindingId: string;
  manifest: WorkflowManifest;
  graph: ManifestGraph;
  sourceStepIndexById: ReadonlyMap<string, number>;
}>;

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const nonNewlineControlCharacterPattern = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const workflowManifestFields = Object.freeze([
  "id", "projectId", "departmentId", "version", "name", "summary", "status",
  "triggerMode", "goals", "nonGoals", "steps", "finalStepIds",
  "additionalRequiredApprovalActions", "additionalForbiddenActions",
] as const);
const commonStepFields = Object.freeze(["id", "kind", "name", "dependsOnStepIds"] as const);
const agentTaskFields = Object.freeze([
  ...commonStepFields, "agentId", "agentBindingId", "outputType", "requestedResources",
  "modelProfileId", "knowledgeCollectionIds", "toolIds", "maxAttempts", "timeoutMinutes",
  "actionMode", "requiredApprovalAction",
] as const);
const approvalGateFields = Object.freeze([...commonStepFields, "approvalAction"] as const);
const resourceFields = Object.freeze(["resourceId", "capabilities"] as const);

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
  if (typeof input === "string") {
    return input.length <= workflowManifestLimits.maxSnapshotStringLength
      ? { ok: true, value: input }
      : { ok: false, limited: true };
  }
  if (input === null || typeof input === "boolean" || typeof input === "number" || typeof input === "undefined") {
    return { ok: true, value: input };
  }
  if (typeof input !== "object" || depth > workflowManifestLimits.maxSnapshotDepth) {
    return { ok: false, limited: depth > workflowManifestLimits.maxSnapshotDepth };
  }
  if (state.active.has(input)) return { ok: false, limited: false };
  if (Array.isArray(input) && !isOrdinaryArray(input)) return { ok: false, limited: false };
  if (!Array.isArray(input) && !isPlainRecord(input)) return { ok: false, limited: false };
  state.active.add(input);
  try {
    if (Array.isArray(input)) {
      if (input.length > workflowManifestLimits.maxSnapshotArrayLength) return { ok: false, limited: true };
      const keys = Object.keys(input);
      if (keys.length !== input.length) return { ok: false, limited: false };
      const output: unknown[] = [];
      for (let index = 0; index < input.length; index += 1) {
        if (keys[index] !== String(index)) return { ok: false, limited: false };
        state.properties += 1;
        if (state.properties > workflowManifestLimits.maxSnapshotProperties) return { ok: false, limited: true };
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
      state.properties += 1;
      if (state.properties > workflowManifestLimits.maxSnapshotProperties) return { ok: false, limited: true };
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
    return snapshotValue(input, { properties: 0, active: new WeakSet<object>() });
  } catch {
    return { ok: false, limited: false };
  }
}

function ownData(input: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function unknownFields(input: Record<string, unknown>, allowed: readonly string[]): string[] {
  const accepted = new Set(allowed);
  return Object.keys(input).filter((field) => !accepted.has(field)).sort(compareStrings);
}

function normalizeText(input: string): string {
  return input.replace(/\r\n?/gu, "\n").trim();
}

function normalizeId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return safeIdPattern.test(value) ? value : null;
}

function addValidationError(
  errors: MutableValidationErrors,
  code: WorkflowManifestValidationErrorCode,
  path: string,
  message: string,
): void {
  if (errors.length < workflowManifestLimits.maxErrors) errors.push({ code, path, message });
}

function normalizeRequiredId(
  input: unknown,
  path: string,
  errors: MutableValidationErrors,
): string | null {
  const value = normalizeId(input);
  if (value === null) addValidationError(errors, "invalid_id", path, `${path} must be a stable ID.`);
  return value;
}

function normalizeBoundedText(
  input: unknown,
  path: string,
  maxLength: number,
  errors: MutableValidationErrors,
): string | null {
  if (typeof input !== "string") {
    addValidationError(errors, "invalid_type", path, `${path} must be a string.`);
    return null;
  }
  const value = normalizeText(input);
  if (value.length < 1 || value.length > maxLength) {
    addValidationError(errors, "limit_exceeded", path, `${path} must contain between 1 and ${maxLength} characters.`);
    return null;
  }
  if (nonNewlineControlCharacterPattern.test(value)) {
    addValidationError(errors, "invalid_type", path, `${path} contains a control character.`);
    return null;
  }
  return value;
}

function normalizeStringList(
  input: unknown,
  path: string,
  maxItems: number,
  errors: MutableValidationErrors,
  options: Readonly<{
    ids?: boolean;
    required?: boolean;
    rejectDuplicates?: boolean;
    duplicateCode?: WorkflowManifestValidationErrorCode;
  }> = {},
): string[] | null {
  if (!Array.isArray(input)) {
    addValidationError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length > maxItems) {
    addValidationError(errors, "limit_exceeded", path, `${path} exceeds its item limit.`);
    return null;
  }
  if (options.required && input.length === 0) {
    addValidationError(errors, "empty_collection", path, `${path} must not be empty.`);
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.entries()) {
    let value: string | null = null;
    if (options.ids) value = normalizeId(item);
    else if (typeof item === "string") {
      const candidate = normalizeText(item);
      if (candidate.length > 0
        && candidate.length <= workflowManifestLimits.maxTextListItemLength
        && !nonNewlineControlCharacterPattern.test(candidate)) value = candidate;
    }
    if (value === null) {
      addValidationError(errors, options.ids ? "invalid_id" : "invalid_type", `${path}[${index}]`, `${path}[${index}] is invalid.`);
    } else if (seen.has(value)) {
      if (options.rejectDuplicates) addValidationError(
        errors,
        options.duplicateCode ?? "invalid_workflow_graph",
        `${path}[${index}]`,
        `${path} values must be unique.`,
      );
    } else {
      seen.add(value);
      values.push(value);
    }
  }
  if (options.required && values.length === 0 && input.length > 0) {
    addValidationError(errors, "empty_collection", path, `${path} must contain a valid value.`);
  }
  return values;
}

function normalizeResources(
  input: unknown,
  path: string,
  errors: MutableValidationErrors,
): WorkflowResourceRequest[] | null {
  if (!Array.isArray(input)) {
    addValidationError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length > workflowManifestLimits.maxResourcesPerStep) {
    addValidationError(errors, "limit_exceeded", path, `${path} exceeds its resource limit.`);
    return null;
  }
  const resources: WorkflowResourceRequest[] = [];
  const seen = new Set<string>();
  for (const [index, resourceInput] of input.entries()) {
    const resourcePath = `${path}[${index}]`;
    if (!isPlainRecord(resourceInput)) {
      addValidationError(errors, "invalid_type", resourcePath, `${resourcePath} must be a plain object.`);
      continue;
    }
    for (const field of unknownFields(resourceInput, resourceFields)) {
      addValidationError(errors, "unknown_field", `${resourcePath}.${field}`, `Unknown resource field ${field}.`);
    }
    for (const field of resourceFields) {
      if (!Object.hasOwn(resourceInput, field)) addValidationError(errors, "required_field", `${resourcePath}.${field}`, `${field} is required.`);
    }
    const resourceId = normalizeRequiredId(ownData(resourceInput, "resourceId"), `${resourcePath}.resourceId`, errors);
    const capabilitiesInput = ownData(resourceInput, "capabilities");
    const capabilities: ProjectResourceCapability[] = [];
    if (!Array.isArray(capabilitiesInput)) {
      addValidationError(errors, "invalid_type", `${resourcePath}.capabilities`, "capabilities must be an array.");
    } else {
      if (capabilitiesInput.length < 1) addValidationError(errors, "empty_collection", `${resourcePath}.capabilities`, "capabilities must not be empty.");
      if (capabilitiesInput.length > workflowManifestLimits.maxCapabilitiesPerResource) addValidationError(errors, "limit_exceeded", `${resourcePath}.capabilities`, "capabilities exceeds its item limit.");
      const selected = new Set<ProjectResourceCapability>();
      for (const [capabilityIndex, capability] of capabilitiesInput.slice(0, workflowManifestLimits.maxCapabilitiesPerResource).entries()) {
        if (!includesValue(projectResourceCapabilities, capability)) addValidationError(errors, "invalid_enum", `${resourcePath}.capabilities[${capabilityIndex}]`, "Unknown resource capability.");
        else selected.add(capability);
      }
      for (const capability of projectResourceCapabilities) if (selected.has(capability)) capabilities.push(capability);
    }
    if (resourceId !== null) {
      if (seen.has(resourceId)) addValidationError(errors, "duplicate_resource_id", `${resourcePath}.resourceId`, `Resource ${resourceId} is duplicated.`);
      else {
        seen.add(resourceId);
        resources.push({ resourceId, capabilities });
      }
    }
  }
  return resources.sort((left, right) => compareStrings(left.resourceId, right.resourceId));
}

function normalizeAgentTaskStep(
  input: Record<string, unknown>,
  path: string,
  base: WorkflowStepBase,
  errors: MutableValidationErrors,
): WorkflowAgentTaskStep | null {
  for (const field of unknownFields(input, agentTaskFields)) addValidationError(errors, "unknown_field", `${path}.${field}`, `Unknown agent_task field ${field}.`);
  for (const field of agentTaskFields) if (!Object.hasOwn(input, field)) addValidationError(errors, "required_field", `${path}.${field}`, `${field} is required.`);
  const agentId = normalizeRequiredId(ownData(input, "agentId"), `${path}.agentId`, errors);
  const agentBindingId = normalizeRequiredId(ownData(input, "agentBindingId"), `${path}.agentBindingId`, errors);
  const outputType = ownData(input, "outputType");
  if (!includesValue(agentOutputTypes, outputType)) addValidationError(errors, "invalid_enum", `${path}.outputType`, "Unknown Agent output type.");
  const resources = normalizeResources(ownData(input, "requestedResources"), `${path}.requestedResources`, errors);
  const modelProfileId = normalizeRequiredId(ownData(input, "modelProfileId"), `${path}.modelProfileId`, errors);
  const knowledge = normalizeStringList(ownData(input, "knowledgeCollectionIds"), `${path}.knowledgeCollectionIds`, workflowManifestLimits.maxKnowledgeCollectionIds, errors, { ids: true });
  const tools = normalizeStringList(ownData(input, "toolIds"), `${path}.toolIds`, workflowManifestLimits.maxToolIds, errors, { ids: true });
  const maxAttempts = ownData(input, "maxAttempts");
  if (!Number.isSafeInteger(maxAttempts) || (maxAttempts as number) < 1 || (maxAttempts as number) > workflowManifestLimits.maxStepAttempts) addValidationError(errors, "invalid_integer", `${path}.maxAttempts`, "maxAttempts must be a bounded positive safe integer.");
  const timeoutMinutes = ownData(input, "timeoutMinutes");
  if (!Number.isSafeInteger(timeoutMinutes) || (timeoutMinutes as number) < 1 || (timeoutMinutes as number) > workflowManifestLimits.maxStepTimeoutMinutes) addValidationError(errors, "invalid_integer", `${path}.timeoutMinutes`, "timeoutMinutes must be a bounded positive safe integer.");
  const actionMode = ownData(input, "actionMode");
  if (!includesValue(workflowActionModes, actionMode)) addValidationError(errors, "invalid_enum", `${path}.actionMode`, "Unknown Workflow action mode.");
  const approvalInput = ownData(input, "requiredApprovalAction");
  const requiredApprovalAction = approvalInput === null
    ? null
    : normalizeBoundedText(approvalInput, `${path}.requiredApprovalAction`, workflowManifestLimits.maxTextListItemLength, errors);
  if ((actionMode === "none" || actionMode === "proposal_only") && approvalInput !== null) addValidationError(errors, "invalid_type", `${path}.requiredApprovalAction`, `${actionMode} requires requiredApprovalAction: null.`);
  if (actionMode === "external_action" && requiredApprovalAction === null) addValidationError(errors, "invalid_type", `${path}.requiredApprovalAction`, "external_action requires an approval action.");
  if (agentId === null || agentBindingId === null || !includesValue(agentOutputTypes, outputType) || resources === null || modelProfileId === null || knowledge === null || tools === null || !Number.isSafeInteger(maxAttempts) || (maxAttempts as number) < 1 || (maxAttempts as number) > workflowManifestLimits.maxStepAttempts || !Number.isSafeInteger(timeoutMinutes) || (timeoutMinutes as number) < 1 || (timeoutMinutes as number) > workflowManifestLimits.maxStepTimeoutMinutes || !includesValue(workflowActionModes, actionMode) || (approvalInput !== null && requiredApprovalAction === null)) return null;
  return {
    ...base,
    kind: "agent_task",
    agentId,
    agentBindingId,
    outputType: outputType as AgentOutputType,
    requestedResources: resources,
    modelProfileId,
    knowledgeCollectionIds: knowledge,
    toolIds: tools,
    maxAttempts: maxAttempts as number,
    timeoutMinutes: timeoutMinutes as number,
    actionMode,
    requiredApprovalAction,
  };
}

function normalizeApprovalGateStep(
  input: Record<string, unknown>,
  path: string,
  base: WorkflowStepBase,
  errors: MutableValidationErrors,
): WorkflowApprovalGateStep | null {
  for (const field of unknownFields(input, approvalGateFields)) addValidationError(errors, "unknown_field", `${path}.${field}`, `Unknown approval_gate field ${field}.`);
  for (const field of approvalGateFields) if (!Object.hasOwn(input, field)) addValidationError(errors, "required_field", `${path}.${field}`, `${field} is required.`);
  const approvalAction = normalizeBoundedText(ownData(input, "approvalAction"), `${path}.approvalAction`, workflowManifestLimits.maxTextListItemLength, errors);
  return approvalAction === null ? null : { ...base, kind: "approval_gate", approvalAction };
}

function normalizeSteps(input: unknown, errors: MutableValidationErrors): WorkflowStep[] | null {
  if (!Array.isArray(input)) {
    addValidationError(errors, "invalid_type", "steps", "steps must be an array.");
    return null;
  }
  if (input.length < 1) addValidationError(errors, "empty_collection", "steps", "steps must not be empty.");
  if (input.length > workflowManifestLimits.maxSteps) {
    addValidationError(errors, "limit_exceeded", "steps", "steps exceeds its item limit.");
    return null;
  }
  const steps: WorkflowStep[] = [];
  for (const [index, stepInput] of input.entries()) {
    const path = `steps[${index}]`;
    if (!isPlainRecord(stepInput)) {
      addValidationError(errors, "invalid_type", path, `${path} must be a plain object.`);
      continue;
    }
    const id = normalizeRequiredId(ownData(stepInput, "id"), `${path}.id`, errors);
    const kind = ownData(stepInput, "kind");
    if (!includesValue(workflowStepKinds, kind)) addValidationError(errors, "invalid_enum", `${path}.kind`, "Unknown Workflow step kind.");
    const name = normalizeBoundedText(ownData(stepInput, "name"), `${path}.name`, workflowManifestLimits.maxNameLength, errors);
    const dependencies = normalizeStringList(ownData(stepInput, "dependsOnStepIds"), `${path}.dependsOnStepIds`, workflowManifestLimits.maxDependenciesPerStep, errors, { ids: true, rejectDuplicates: true });
    if (id === null || name === null || dependencies === null || !includesValue(workflowStepKinds, kind)) continue;
    const base: WorkflowStepBase = { id, kind, name, dependsOnStepIds: dependencies };
    const step = kind === "agent_task"
      ? normalizeAgentTaskStep(stepInput, path, base, errors)
      : normalizeApprovalGateStep(stepInput, path, base, errors);
    if (step !== null) steps.push(step);
  }
  return steps;
}

function buildGraph(
  steps: readonly WorkflowStep[],
  finalStepIds: readonly string[],
  errors: MutableValidationErrors,
): ManifestGraph | null {
  const byId = new Map<string, WorkflowStep>();
  const sourceIndex = new Map<string, number>();
  for (const [index, step] of steps.entries()) {
    if (byId.has(step.id)) addValidationError(errors, "duplicate_step_id", `steps[${index}].id`, `Step ID ${step.id} is duplicated.`);
    else {
      byId.set(step.id, step);
      sourceIndex.set(step.id, index);
    }
  }
  if (byId.size !== steps.length) return null;
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const step of steps) {
    dependents.set(step.id, []);
    indegree.set(step.id, step.dependsOnStepIds.length);
  }
  let inspections = 0;
  for (const step of steps) {
    const index = sourceIndex.get(step.id) ?? 0;
    for (const [dependencyIndex, dependencyId] of step.dependsOnStepIds.entries()) {
      inspections += 1;
      if (inspections > workflowManifestLimits.maxGraphInspections) {
        addValidationError(errors, "limit_exceeded", "steps", "Workflow graph inspection limit was exceeded.");
        return null;
      }
      if (dependencyId === step.id) addValidationError(errors, "self_dependency", `steps[${index}].dependsOnStepIds[${dependencyIndex}]`, "A step cannot depend on itself.");
      else if (!byId.has(dependencyId)) addValidationError(errors, "unknown_step_dependency", `steps[${index}].dependsOnStepIds[${dependencyIndex}]`, `Dependency ${dependencyId} was not found.`);
      else dependents.get(dependencyId)?.push(step.id);
    }
  }
  if (errors.length > 0) return null;
  let ready = [...steps.filter((step) => (indegree.get(step.id) ?? 0) === 0).map((step) => step.id)].sort(compareStrings);
  if (ready.length === 0) {
    addValidationError(errors, "workflow_cycle", "steps", "Workflow graph has no root step.");
    return null;
  }
  const waves: string[][] = [];
  let visited = 0;
  while (ready.length > 0) {
    const wave = ready;
    waves.push(wave);
    visited += wave.length;
    const next: string[] = [];
    for (const stepId of wave) {
      for (const dependentId of dependents.get(stepId) ?? []) {
        inspections += 1;
        if (inspections > workflowManifestLimits.maxGraphInspections) {
          addValidationError(errors, "limit_exceeded", "steps", "Workflow graph inspection limit was exceeded.");
          return null;
        }
        const remaining = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, remaining);
        if (remaining === 0) next.push(dependentId);
      }
    }
    ready = next.sort(compareStrings);
  }
  if (visited !== steps.length) {
    addValidationError(errors, "workflow_cycle", "steps", "Workflow steps must form a DAG.");
    return null;
  }
  const sinkIds = [...steps.filter((step) => (dependents.get(step.id)?.length ?? 0) === 0).map((step) => step.id)].sort(compareStrings);
  const expectedFinals = [...finalStepIds].sort(compareStrings);
  if (sinkIds.length !== expectedFinals.length || sinkIds.some((value, index) => value !== expectedFinals[index])) {
    addValidationError(errors, "invalid_final_step", "finalStepIds", "finalStepIds must contain every and only sink step.");
    return null;
  }
  const ancestorsByStepId = new Map<string, ReadonlySet<string>>();
  for (const wave of waves) {
    for (const stepId of wave) {
      const step = byId.get(stepId);
      const ancestors = new Set<string>();
      for (const dependencyId of step?.dependsOnStepIds ?? []) {
        ancestors.add(dependencyId);
        for (const ancestorId of ancestorsByStepId.get(dependencyId) ?? []) ancestors.add(ancestorId);
      }
      ancestorsByStepId.set(stepId, ancestors);
    }
  }
  return {
    waves: waves.map((wave) => Object.freeze([...wave])),
    ancestorsByStepId,
  };
}

function freezeManifest(manifest: WorkflowManifest): WorkflowManifest {
  Object.freeze(manifest.goals);
  Object.freeze(manifest.nonGoals);
  for (const step of manifest.steps) {
    Object.freeze(step.dependsOnStepIds);
    if (step.kind === "agent_task") {
      for (const resource of step.requestedResources) {
        Object.freeze(resource.capabilities);
        Object.freeze(resource);
      }
      Object.freeze(step.requestedResources);
      Object.freeze(step.knowledgeCollectionIds);
      Object.freeze(step.toolIds);
    }
    Object.freeze(step);
  }
  Object.freeze(manifest.steps);
  Object.freeze(manifest.finalStepIds);
  Object.freeze(manifest.additionalRequiredApprovalActions);
  Object.freeze(manifest.additionalForbiddenActions);
  return Object.freeze(manifest);
}

function validateManifestSnapshot(input: unknown): ManifestDetailResult {
  const errors: MutableValidationErrors = [];
  if (!isPlainRecord(input)) {
    addValidationError(errors, "invalid_input", "$", "WorkflowManifest must be a plain object.");
    return { ok: false, errors };
  }
  for (const field of unknownFields(input, workflowManifestFields)) addValidationError(errors, "unknown_field", field, `Unknown WorkflowManifest field ${field}.`);
  for (const field of workflowManifestFields) if (!Object.hasOwn(input, field)) addValidationError(errors, "required_field", field, `${field} is required.`);
  const id = normalizeRequiredId(ownData(input, "id"), "id", errors);
  const projectId = normalizeRequiredId(ownData(input, "projectId"), "projectId", errors);
  const departmentId = normalizeRequiredId(ownData(input, "departmentId"), "departmentId", errors);
  const version = ownData(input, "version");
  if (!Number.isSafeInteger(version) || (version as number) < 1) addValidationError(errors, "invalid_integer", "version", "version must be a positive safe integer.");
  const name = normalizeBoundedText(ownData(input, "name"), "name", workflowManifestLimits.maxNameLength, errors);
  const summary = normalizeBoundedText(ownData(input, "summary"), "summary", workflowManifestLimits.maxSummaryLength, errors);
  const status = ownData(input, "status");
  if (!includesValue(workflowManifestStatuses, status)) addValidationError(errors, "invalid_enum", "status", "Unknown Workflow status.");
  const triggerMode = ownData(input, "triggerMode");
  if (!includesValue(workflowTriggerModes, triggerMode)) addValidationError(errors, "invalid_enum", "triggerMode", "Unknown Workflow trigger mode.");
  const goals = normalizeStringList(ownData(input, "goals"), "goals", workflowManifestLimits.maxGoals, errors);
  const nonGoals = normalizeStringList(ownData(input, "nonGoals"), "nonGoals", workflowManifestLimits.maxNonGoals, errors);
  const steps = normalizeSteps(ownData(input, "steps"), errors);
  const finalStepIds = normalizeStringList(
    ownData(input, "finalStepIds"),
    "finalStepIds",
    workflowManifestLimits.maxSteps,
    errors,
    { ids: true, required: true, rejectDuplicates: true, duplicateCode: "invalid_final_step" },
  );
  const approvals = normalizeStringList(ownData(input, "additionalRequiredApprovalActions"), "additionalRequiredApprovalActions", workflowManifestLimits.maxAdditionalApprovalActions, errors);
  const forbidden = normalizeStringList(ownData(input, "additionalForbiddenActions"), "additionalForbiddenActions", workflowManifestLimits.maxAdditionalForbiddenActions, errors);
  if (errors.length > 0 || id === null || projectId === null || departmentId === null || !Number.isSafeInteger(version) || (version as number) < 1 || name === null || summary === null || !includesValue(workflowManifestStatuses, status) || !includesValue(workflowTriggerModes, triggerMode) || goals === null || nonGoals === null || steps === null || finalStepIds === null || approvals === null || forbidden === null) return { ok: false, errors };
  const graph = buildGraph(steps, finalStepIds, errors);
  if (errors.length > 0 || graph === null) return { ok: false, errors };
  const waveOrder = new Map(graph.waves.flatMap((wave, waveIndex) => wave.map((stepId, index) => [stepId, waveIndex * workflowManifestLimits.maxSteps + index] as const)));
  const orderedSteps = [...steps].sort((left, right) => (waveOrder.get(left.id) ?? 0) - (waveOrder.get(right.id) ?? 0));
  const manifest = freezeManifest({
    id,
    projectId,
    departmentId,
    version: version as number,
    name,
    summary,
    status,
    triggerMode,
    goals,
    nonGoals,
    steps: orderedSteps,
    finalStepIds: [...finalStepIds].sort(compareStrings),
    additionalRequiredApprovalActions: approvals,
    additionalForbiddenActions: forbidden,
  });
  return { ok: true, value: manifest, graph };
}

export function validateAndNormalizeWorkflowManifest(input: unknown): WorkflowManifestValidationResult {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) {
    return {
      ok: false,
      errors: [{
        code: snapshot.limited ? "limit_exceeded" : "invalid_input",
        path: "$",
        message: snapshot.limited
          ? "WorkflowManifest exceeds safe inspection limits."
          : "WorkflowManifest could not be safely inspected.",
      }],
    };
  }
  const result = validateManifestSnapshot(snapshot.value);
  return result.ok ? { ok: true, value: result.value } : result;
}

export function isWorkflowManifestStatus(input: unknown): input is WorkflowManifestStatus {
  return includesValue(workflowManifestStatuses, input);
}

export function parseWorkflowManifestStatus(input: unknown): WorkflowManifestStatus | null {
  return isWorkflowManifestStatus(input) ? input : null;
}

export function isWorkflowTriggerMode(input: unknown): input is WorkflowTriggerMode {
  return includesValue(workflowTriggerModes, input);
}

export function parseWorkflowTriggerMode(input: unknown): WorkflowTriggerMode | null {
  return isWorkflowTriggerMode(input) ? input : null;
}

export function isWorkflowStepKind(input: unknown): input is WorkflowStepKind {
  return includesValue(workflowStepKinds, input);
}

export function parseWorkflowStepKind(input: unknown): WorkflowStepKind | null {
  return isWorkflowStepKind(input) ? input : null;
}

export function isWorkflowActionMode(input: unknown): input is WorkflowActionMode {
  return includesValue(workflowActionModes, input);
}

export function parseWorkflowActionMode(input: unknown): WorkflowActionMode | null {
  return isWorkflowActionMode(input) ? input : null;
}

export function isWorkflowCatalogVerdict(input: unknown): input is WorkflowCatalogVerdict {
  return includesValue(workflowCatalogVerdicts, input);
}

export function parseWorkflowCatalogVerdict(input: unknown): WorkflowCatalogVerdict | null {
  return isWorkflowCatalogVerdict(input) ? input : null;
}

function addReason(
  reasons: MutableCatalogReasons,
  code: WorkflowCatalogReasonCode,
  path: string,
  message: string,
  ids: Partial<Pick<WorkflowCatalogReason, "projectId" | "departmentId" | "workflowId" | "workflowBindingId" | "stepId" | "agentId" | "agentBindingId">> = {},
): void {
  if (reasons.length >= workflowManifestLimits.maxErrors) return;
  reasons.push({
    code,
    path,
    message,
    projectId: ids.projectId ?? null,
    departmentId: ids.departmentId ?? null,
    workflowId: ids.workflowId ?? null,
    workflowBindingId: ids.workflowBindingId ?? null,
    stepId: ids.stepId ?? null,
    agentId: ids.agentId ?? null,
    agentBindingId: ids.agentBindingId ?? null,
  });
}

function catalogDeny(
  reasons: readonly WorkflowCatalogReason[],
  registryDecision: WorkspaceProjectContextsDecision | null,
  agentCatalogDecision: WorkspaceAgentCatalogDecision | null,
): WorkspaceWorkflowCatalogDecision {
  return { verdict: "deny", reasons, registryDecision, agentCatalogDecision, normalizedCatalog: null };
}

function stableMerge(left: readonly string[], right: readonly string[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of [...left, ...right]) if (!seen.has(value)) {
    seen.add(value);
    values.push(value);
  }
  return values;
}

function sameData(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) return true;
  if (depth > workflowManifestLimits.maxSnapshotDepth || typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameData(value, right[index], depth + 1));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).sort(compareStrings);
  const rightKeys = Object.keys(right).sort(compareStrings);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameData(ownData(left, key), ownData(right, key), depth + 1));
}

function cloneBudget(budget: ProjectBudgetCeiling): ProjectBudgetCeiling {
  return {
    maxConcurrentRuns: budget.maxConcurrentRuns,
    maxAttemptsPerRun: budget.maxAttemptsPerRun,
    maxRunMinutes: budget.maxRunMinutes,
    dailyTokenBudget: budget.dailyTokenBudget,
    monthlyCostBudgetUsdCents: budget.monthlyCostBudgetUsdCents,
  };
}

function cloneResources(resources: readonly WorkflowResourceRequest[]): WorkflowResourceRequest[] {
  return resources.map((resource) => ({ resourceId: resource.resourceId, capabilities: [...resource.capabilities] }));
}

function freezeAssignment(assignment: WorkflowAgentAssignment): WorkflowAgentAssignment {
  Object.freeze(assignment.outputTypes);
  Object.freeze(assignment.allowedWorkflowIds);
  Object.freeze(assignment.allowedToolIds);
  Object.freeze(assignment.allowedModelProfileIds);
  Object.freeze(assignment.knowledgeCollectionIds);
  for (const resource of assignment.resources) {
    Object.freeze(resource.capabilities);
    Object.freeze(resource);
  }
  Object.freeze(assignment.resources);
  Object.freeze(assignment.budget);
  Object.freeze(assignment.requiredApprovalActions);
  Object.freeze(assignment.forbiddenActions);
  return Object.freeze(assignment);
}

function createAssignment(
  agent: NormalizedAgentCatalogEntry,
  binding: NormalizedProjectSubjectBinding,
): WorkflowAgentAssignment {
  return freezeAssignment({
    agentId: agent.agentManifest.id,
    agentBindingId: agent.bindingId,
    projectId: agent.agentManifest.projectId,
    departmentId: agent.agentManifest.departmentId,
    agentManifestVersion: agent.agentManifest.version,
    agentBindingVersion: agent.bindingVersion,
    agentStatus: agent.agentManifest.status,
    agentBindingStatus: agent.bindingStatus,
    outputTypes: [...agent.agentManifest.outputTypes],
    allowedWorkflowIds: [...agent.agentManifest.allowedWorkflowIds],
    allowedToolIds: [...agent.agentManifest.allowedToolIds],
    allowedModelProfileIds: [...agent.agentManifest.allowedModelProfileIds],
    knowledgeCollectionIds: [...agent.agentManifest.knowledgeCollectionIds],
    resources: cloneResources(binding.effectiveResources),
    budget: cloneBudget(binding.effectiveBudget),
    externalActionMode: binding.effectiveExternalActionMode,
    dataEgressMode: binding.effectiveDataEgressMode,
    requiredApprovalActions: [...agent.effectiveRequiredApprovalActions],
    forbiddenActions: [...agent.effectiveForbiddenActions],
  });
}

function resourceById(
  resources: readonly WorkflowResourceRequest[],
  resourceId: string,
): WorkflowResourceRequest | undefined {
  return resources.find((resource) => resource.resourceId === resourceId);
}

function validateAgentTaskScope(
  reasons: MutableCatalogReasons,
  source: WorkflowSourceEntry,
  binding: NormalizedProjectSubjectBinding,
  step: WorkflowAgentTaskStep,
  sourceStepIndex: number,
  agentEntry: NormalizedAgentCatalogEntry,
  agentBinding: NormalizedProjectSubjectBinding,
): void {
  const path = `${source.path}.workflowManifest.steps[${sourceStepIndex}]`;
  const ids = {
    projectId: source.manifest.projectId,
    departmentId: source.manifest.departmentId,
    workflowId: source.manifest.id,
    workflowBindingId: binding.id,
    stepId: step.id,
    agentId: step.agentId,
    agentBindingId: step.agentBindingId,
  };
  for (const [resourceIndex, resource] of step.requestedResources.entries()) {
    const workflowGrant = resourceById(binding.effectiveResources, resource.resourceId);
    const agentGrant = resourceById(agentBinding.effectiveResources, resource.resourceId);
    if (!workflowGrant || !agentGrant) {
      addReason(reasons, "resource_not_granted", `${path}.requestedResources[${resourceIndex}].resourceId`, `Resource ${resource.resourceId} must be granted by both Workflow and Agent bindings.`, ids);
      continue;
    }
    for (const [capabilityIndex, capability] of resource.capabilities.entries()) {
      if (!workflowGrant.capabilities.includes(capability) || !agentGrant.capabilities.includes(capability)) addReason(reasons, "capability_not_granted", `${path}.requestedResources[${resourceIndex}].capabilities[${capabilityIndex}]`, `Capability ${capability} must be granted by both bindings.`, ids);
    }
  }
  if (!binding.effectiveModelProfileIds.includes(step.modelProfileId) || !agentEntry.agentManifest.allowedModelProfileIds.includes(step.modelProfileId)) addReason(reasons, "model_not_granted", `${path}.modelProfileId`, `Model ${step.modelProfileId} must be granted by Workflow and Agent scopes.`, ids);
  for (const [index, collectionId] of step.knowledgeCollectionIds.entries()) if (!binding.effectiveKnowledgeCollectionIds.includes(collectionId) || !agentEntry.agentManifest.knowledgeCollectionIds.includes(collectionId)) addReason(reasons, "knowledge_not_granted", `${path}.knowledgeCollectionIds[${index}]`, `Knowledge Collection ${collectionId} must be granted by Workflow and Agent scopes.`, ids);
  for (const [index, toolId] of step.toolIds.entries()) if (!agentEntry.agentManifest.allowedToolIds.includes(toolId)) addReason(reasons, "tool_not_allowed", `${path}.toolIds[${index}]`, `Tool ${toolId} is not allowed by Agent ${step.agentId}.`, ids);
  if (!agentEntry.agentManifest.outputTypes.includes(step.outputType)) addReason(reasons, "output_not_allowed", `${path}.outputType`, `Output ${step.outputType} is not allowed by Agent ${step.agentId}.`, ids);
  const maxAttempts = Math.min(binding.effectiveBudget.maxAttemptsPerRun, agentBinding.effectiveBudget.maxAttemptsPerRun);
  const maxMinutes = Math.min(binding.effectiveBudget.maxRunMinutes, agentBinding.effectiveBudget.maxRunMinutes);
  if (step.maxAttempts > maxAttempts) addReason(reasons, "budget_ceiling_exceeded", `${path}.maxAttempts`, `maxAttempts exceeds the Workflow/Agent ceiling ${maxAttempts}.`, ids);
  if (step.timeoutMinutes > maxMinutes) addReason(reasons, "budget_ceiling_exceeded", `${path}.timeoutMinutes`, `timeoutMinutes exceeds the Workflow/Agent ceiling ${maxMinutes}.`, ids);
}

function freezeCatalogEntry(entry: NormalizedWorkflowCatalogEntry): NormalizedWorkflowCatalogEntry {
  Object.freeze(entry.executionWaves);
  Object.freeze(entry.agentAssignments);
  for (const resource of entry.effectiveResources) {
    Object.freeze(resource.capabilities);
    Object.freeze(resource);
  }
  Object.freeze(entry.effectiveResources);
  Object.freeze(entry.effectiveModelProfileIds);
  Object.freeze(entry.effectiveKnowledgeCollectionIds);
  Object.freeze(entry.effectiveBudget);
  Object.freeze(entry.effectiveRequiredApprovalActions);
  Object.freeze(entry.effectiveForbiddenActions);
  return Object.freeze(entry);
}

function evaluateCatalogSnapshot(input: unknown): WorkspaceWorkflowCatalogDecision {
  const reasons: MutableCatalogReasons = [];
  if (!isPlainRecord(input) || unknownFields(input, ["registry", "agents", "workflows"]).length > 0 || !Object.hasOwn(input, "registry") || !Object.hasOwn(input, "agents") || !Object.hasOwn(input, "workflows")) {
    addReason(reasons, "invalid_input", "$", "Workspace Workflow Catalog must contain only registry, agents, and workflows.");
    return catalogDeny(reasons, null, null);
  }
  const registry = ownData(input, "registry");
  const agents = ownData(input, "agents");
  const workflowInputs = ownData(input, "workflows");
  if (!Array.isArray(agents) || !Array.isArray(workflowInputs)) {
    addReason(reasons, "invalid_input", !Array.isArray(agents) ? "agents" : "workflows", "agents and workflows must be arrays.");
    return catalogDeny(reasons, null, null);
  }
  if (workflowInputs.length > workflowManifestLimits.maxCatalogEntries) {
    addReason(reasons, "limit_exceeded", "workflows", "Workflow Catalog exceeds its entry limit.");
    return catalogDeny(reasons, null, null);
  }
  const agentCatalogDecision = evaluateWorkspaceAgentCatalog({ registry, agents });
  if (agentCatalogDecision.verdict === "deny" || agentCatalogDecision.normalizedCatalog === null || agentCatalogDecision.registryDecision?.normalizedRegistry === null || agentCatalogDecision.registryDecision === null) {
    addReason(reasons, "invalid_agent_catalog", "agents", "AI-019 Agent Catalog evaluation was denied.");
    if (agentCatalogDecision.registryDecision?.reasons.some((reason) =>
      reason.code === "binding_scope_denied" && reason.message.includes("workflow_not_enabled"),
    )) {
      addReason(
        reasons,
        "workflow_not_enabled",
        "registry",
        "A factual AI-016 Workflow binding references a Workflow that is not enabled by its Department.",
      );
    }
    return catalogDeny(reasons, agentCatalogDecision.registryDecision, agentCatalogDecision);
  }
  const registryDecision = evaluateWorkspaceProjectContexts(registry);
  if (registryDecision.verdict === "deny" || registryDecision.normalizedRegistry === null || !sameData(registryDecision, agentCatalogDecision.registryDecision)) {
    addReason(reasons, "invalid_registry", "registry", "AI-016 Registry evaluation was denied or did not match AI-019.");
    return catalogDeny(reasons, registryDecision, agentCatalogDecision);
  }
  const factualRegistry = agentCatalogDecision.registryDecision.normalizedRegistry;
  const sourceEntries: WorkflowSourceEntry[] = [];
  for (const [index, entryInput] of workflowInputs.entries()) {
    const path = `workflows[${index}]`;
    if (!isPlainRecord(entryInput) || unknownFields(entryInput, ["bindingId", "workflowManifest"]).length > 0 || !Object.hasOwn(entryInput, "bindingId") || !Object.hasOwn(entryInput, "workflowManifest")) {
      addReason(reasons, "invalid_input", path, "Workflow entry must contain only bindingId and workflowManifest.");
      continue;
    }
    const bindingId = normalizeId(ownData(entryInput, "bindingId"));
    if (bindingId === null) {
      addReason(reasons, "invalid_input", `${path}.bindingId`, "bindingId must be a stable ID.");
      continue;
    }
    const manifestInput = ownData(entryInput, "workflowManifest");
    const result = validateManifestSnapshot(manifestInput);
    if (!result.ok) {
      for (const error of result.errors) {
        const code: WorkflowCatalogReasonCode = error.code === "workflow_cycle"
          ? "workflow_cycle"
          : error.code === "unknown_step_dependency"
            ? "unknown_step_dependency"
            : error.code === "invalid_final_step"
              ? "invalid_final_step"
              : error.code === "invalid_workflow_graph" || error.code === "self_dependency" || error.code === "duplicate_step_id"
                ? "invalid_workflow_graph"
                : "invalid_workflow_manifest";
        addReason(reasons, code, `${path}.workflowManifest.${error.path}`, `${error.code}: ${error.message}`, { workflowBindingId: bindingId });
      }
      continue;
    }
    const sourceStepIndexById = new Map<string, number>();
    if (isPlainRecord(manifestInput)) {
      const rawSteps = ownData(manifestInput, "steps");
      if (Array.isArray(rawSteps)) for (const [stepIndex, rawStep] of rawSteps.entries()) {
        if (!isPlainRecord(rawStep)) continue;
        const stepId = normalizeId(ownData(rawStep, "id"));
        if (stepId !== null && !sourceStepIndexById.has(stepId)) {
          sourceStepIndexById.set(stepId, stepIndex);
        }
      }
    }
    sourceEntries.push({
      path,
      bindingId,
      manifest: result.value,
      graph: result.graph,
      sourceStepIndexById,
    });
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision, agentCatalogDecision);
  const entries = [...sourceEntries].sort((left, right) => compareStrings(left.manifest.projectId, right.manifest.projectId) || compareStrings(left.manifest.departmentId, right.manifest.departmentId) || compareStrings(left.manifest.id, right.manifest.id) || compareStrings(left.bindingId, right.bindingId));
  const bindings = new Map<string, WorkflowSourceEntry>();
  const workflowIds = new Map<string, WorkflowSourceEntry>();
  for (const entry of entries) {
    if (bindings.has(entry.bindingId)) addReason(reasons, "duplicate_workflow_binding", `${entry.path}.bindingId`, `Binding ${entry.bindingId} has more than one Workflow manifest.`, { projectId: entry.manifest.projectId, departmentId: entry.manifest.departmentId, workflowId: entry.manifest.id, workflowBindingId: entry.bindingId });
    else bindings.set(entry.bindingId, entry);
    if (workflowIds.has(entry.manifest.id)) addReason(reasons, "duplicate_workflow_id", `${entry.path}.workflowManifest.id`, `Workflow ID ${entry.manifest.id} is duplicated.`, { projectId: entry.manifest.projectId, departmentId: entry.manifest.departmentId, workflowId: entry.manifest.id, workflowBindingId: entry.bindingId });
    else workflowIds.set(entry.manifest.id, entry);
  }
  for (const project of factualRegistry.projects) for (const binding of project.bindings) if (binding.kind === "workflow" && !bindings.has(binding.id)) addReason(reasons, "missing_workflow_manifest", "workflows", `Workflow binding ${binding.id} has no manifest.`, { projectId: binding.projectId, departmentId: binding.departmentId, workflowId: binding.subjectId, workflowBindingId: binding.id });
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision, agentCatalogDecision);
  const normalizedEntries: NormalizedWorkflowCatalogEntry[] = [];
  for (const source of entries) {
    const manifest = source.manifest;
    const project = factualRegistry.projects.find((candidate) => candidate.bindings.some((binding) => binding.id === source.bindingId));
    const binding = project?.bindings.find((candidate) => candidate.id === source.bindingId);
    const ids = { projectId: manifest.projectId, departmentId: manifest.departmentId, workflowId: manifest.id, workflowBindingId: source.bindingId };
    if (!project || !binding) {
      addReason(reasons, "workflow_binding_not_found", `${source.path}.bindingId`, `Workflow binding ${source.bindingId} was not found.`, ids);
      continue;
    }
    if (binding.kind !== "workflow") addReason(reasons, "binding_not_workflow", `${source.path}.bindingId`, `Binding ${binding.id} is not a Workflow binding.`, ids);
    if (binding.projectId !== manifest.projectId) addReason(reasons, "workflow_project_mismatch", `${source.path}.workflowManifest.projectId`, "Workflow and binding project IDs do not match.", ids);
    if (binding.departmentId !== manifest.departmentId) addReason(reasons, "workflow_department_mismatch", `${source.path}.workflowManifest.departmentId`, "Workflow and binding Department IDs do not match.", ids);
    if (binding.subjectId !== manifest.id) addReason(reasons, "workflow_subject_mismatch", `${source.path}.workflowManifest.id`, "Workflow ID does not match binding subjectId.", ids);
    const department = project.departments.find((candidate) => candidate.manifest.id === binding.departmentId);
    if (!department || !department.normalizedDepartment.enabledWorkflowIds.includes(manifest.id)) addReason(reasons, "workflow_not_enabled", `${source.path}.workflowManifest.id`, `Workflow ${manifest.id} is not enabled by its Department.`, ids);
    if (reasons.length > 0) continue;
    const approvals = stableMerge(binding.effectiveRequiredApprovalActions, manifest.additionalRequiredApprovalActions);
    const forbidden = stableMerge(binding.effectiveForbiddenActions, manifest.additionalForbiddenActions);
    if (approvals.length > binding.effectiveRequiredApprovalActions.length + workflowManifestLimits.maxAdditionalApprovalActions || forbidden.length > binding.effectiveForbiddenActions.length + workflowManifestLimits.maxAdditionalForbiddenActions) addReason(reasons, "inherited_policy_capacity_exceeded", `${source.path}.workflowManifest`, "Inherited Workflow policy exceeds dynamic capacity.", ids);
    for (const approval of approvals) if (forbidden.includes(approval)) addReason(reasons, "forbidden_action", `${source.path}.workflowManifest.additionalRequiredApprovalActions`, `Action ${approval} is both required and forbidden.`, ids);
    const assignmentMap = new Map<string, WorkflowAgentAssignment>();
    for (const [stepIndex, step] of manifest.steps.entries()) {
      const sourceStepIndex = source.sourceStepIndexById.get(step.id) ?? stepIndex;
      if (step.kind === "approval_gate") {
        if (!approvals.includes(step.approvalAction)) addReason(reasons, "policy_relaxation", `${source.path}.workflowManifest.steps[${sourceStepIndex}].approvalAction`, `Approval ${step.approvalAction} is not required by effective policy.`, { ...ids, stepId: step.id });
        if (forbidden.includes(step.approvalAction)) addReason(reasons, "forbidden_action", `${source.path}.workflowManifest.steps[${sourceStepIndex}].approvalAction`, `Approval ${step.approvalAction} is forbidden.`, { ...ids, stepId: step.id });
        continue;
      }
      const otherProjectAgent = agentCatalogDecision.normalizedCatalog.agents.find((candidate) => candidate.agentManifest.id === step.agentId && candidate.agentManifest.projectId !== manifest.projectId);
      const agentEntry = agentCatalogDecision.normalizedCatalog.agents.find((candidate) => candidate.agentManifest.projectId === manifest.projectId && candidate.agentManifest.departmentId === manifest.departmentId && candidate.agentManifest.id === step.agentId && candidate.bindingId === step.agentBindingId);
      if (!agentEntry) {
        if (otherProjectAgent) addReason(reasons, "agent_project_mismatch", `${source.path}.workflowManifest.steps[${sourceStepIndex}].agentId`, `Agent ${step.agentId} belongs to another Project.`, { ...ids, stepId: step.id, agentId: step.agentId, agentBindingId: step.agentBindingId });
        else {
          const departmentAgent = agentCatalogDecision.normalizedCatalog.agents.find((candidate) => candidate.agentManifest.projectId === manifest.projectId && candidate.agentManifest.id === step.agentId);
          addReason(reasons, departmentAgent ? "agent_department_mismatch" : "agent_not_found", `${source.path}.workflowManifest.steps[${sourceStepIndex}].agentId`, `Exact Agent assignment ${step.agentId}/${step.agentBindingId} was not found.`, { ...ids, stepId: step.id, agentId: step.agentId, agentBindingId: step.agentBindingId });
        }
        continue;
      }
      if (!agentEntry.agentManifest.allowedWorkflowIds.includes(manifest.id)) addReason(reasons, "agent_workflow_not_allowed", `${source.path}.workflowManifest.steps[${sourceStepIndex}].agentId`, `Agent ${step.agentId} does not allow Workflow ${manifest.id}.`, { ...ids, stepId: step.id, agentId: step.agentId, agentBindingId: step.agentBindingId });
      const agentBinding = project.bindings.find((candidate) => candidate.id === step.agentBindingId && candidate.subjectId === step.agentId);
      if (!agentBinding || agentBinding.kind !== "agent") {
        addReason(reasons, "agent_not_found", `${source.path}.workflowManifest.steps[${sourceStepIndex}].agentBindingId`, `Agent binding ${step.agentBindingId} was not found in the Workflow project.`, { ...ids, stepId: step.id, agentId: step.agentId, agentBindingId: step.agentBindingId });
        continue;
      }
      validateAgentTaskScope(reasons, source, binding, step, sourceStepIndex, agentEntry, agentBinding);
      if (step.actionMode === "external_action") {
        if (binding.effectiveExternalActionMode === "locked" || agentBinding.effectiveExternalActionMode === "locked") addReason(reasons, "policy_relaxation", `${source.path}.workflowManifest.steps[${sourceStepIndex}].actionMode`, "External actions are locked by the Workflow or Agent binding.", { ...ids, stepId: step.id, agentId: step.agentId, agentBindingId: step.agentBindingId });
        if (step.requiredApprovalAction !== null && !approvals.includes(step.requiredApprovalAction)) addReason(reasons, "policy_relaxation", `${source.path}.workflowManifest.steps[${sourceStepIndex}].requiredApprovalAction`, `Approval ${step.requiredApprovalAction} is not required by effective policy.`, { ...ids, stepId: step.id, agentId: step.agentId, agentBindingId: step.agentBindingId });
        if (step.requiredApprovalAction !== null && (
          forbidden.includes(step.requiredApprovalAction)
          || agentEntry.effectiveForbiddenActions.includes(step.requiredApprovalAction)
        )) addReason(reasons, "forbidden_action", `${source.path}.workflowManifest.steps[${sourceStepIndex}].requiredApprovalAction`, `Approval ${step.requiredApprovalAction} is forbidden by the Workflow or assigned Agent effective policy.`, { ...ids, stepId: step.id, agentId: step.agentId, agentBindingId: step.agentBindingId });
        const hasGate = manifest.steps.some((candidate) => candidate.kind === "approval_gate" && candidate.approvalAction === step.requiredApprovalAction && source.graph.ancestorsByStepId.get(step.id)?.has(candidate.id));
        if (!hasGate) addReason(reasons, "approval_gate_missing", `${source.path}.workflowManifest.steps[${sourceStepIndex}].requiredApprovalAction`, "External action requires a transitively preceding matching approval gate.", { ...ids, stepId: step.id, agentId: step.agentId, agentBindingId: step.agentBindingId });
      }
      if (!assignmentMap.has(step.agentBindingId)) assignmentMap.set(step.agentBindingId, createAssignment(agentEntry, agentBinding));
    }
    if (reasons.length > 0) continue;
    normalizedEntries.push(freezeCatalogEntry({
      bindingId: binding.id,
      bindingVersion: binding.version,
      bindingStatus: binding.status,
      workflowManifest: manifest,
      executionWaves: source.graph.waves,
      agentAssignments: [...assignmentMap.values()].sort((left, right) => compareStrings(left.agentId, right.agentId) || compareStrings(left.agentBindingId, right.agentBindingId)),
      effectiveResources: cloneResources(binding.effectiveResources),
      effectiveModelProfileIds: [...binding.effectiveModelProfileIds],
      effectiveKnowledgeCollectionIds: [...binding.effectiveKnowledgeCollectionIds],
      effectiveBudget: cloneBudget(binding.effectiveBudget),
      effectiveExternalActionMode: binding.effectiveExternalActionMode,
      effectiveDataEgressMode: binding.effectiveDataEgressMode,
      effectiveRequiredApprovalActions: approvals,
      effectiveForbiddenActions: forbidden,
    }));
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision, agentCatalogDecision);
  return {
    verdict: "allow",
    reasons: [],
    registryDecision,
    agentCatalogDecision,
    normalizedCatalog: Object.freeze({
      workspaceId: factualRegistry.workspaceId,
      workflows: Object.freeze(normalizedEntries),
    }),
  };
}

export function evaluateWorkspaceWorkflowCatalog(input: unknown): WorkspaceWorkflowCatalogDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) {
    const reasons: MutableCatalogReasons = [];
    addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Workflow Catalog exceeds safe snapshot limits." : "Workflow Catalog could not be safely snapshotted.");
    return catalogDeny(reasons, null, null);
  }
  try {
    return evaluateCatalogSnapshot(snapshot.value);
  } catch {
    const reasons: MutableCatalogReasons = [];
    addReason(reasons, "invalid_input", "$", "Workflow Catalog could not be safely evaluated.");
    return catalogDeny(reasons, null, null);
  }
}

function assignmentMatchesProfile(
  assignment: WorkflowAgentAssignment,
  profile: AgentExecutionProfile,
): boolean {
  return assignment.agentId === profile.agentId
    && assignment.agentBindingId === profile.bindingId
    && assignment.projectId === profile.projectId
    && assignment.departmentId === profile.departmentId
    && assignment.agentManifestVersion === profile.agentManifestVersion
    && assignment.agentBindingVersion === profile.bindingVersion
    && sameData(assignment.outputTypes, profile.outputTypes)
    && sameData(assignment.allowedWorkflowIds, profile.allowedWorkflowIds)
    && sameData(assignment.allowedToolIds, profile.allowedToolIds)
    && sameData(assignment.allowedModelProfileIds, profile.allowedModelProfileIds)
    && sameData(assignment.knowledgeCollectionIds, profile.knowledgeCollectionIds)
    && sameData(assignment.resources, profile.resources)
    && sameData(assignment.budget, profile.budget)
    && assignment.externalActionMode === profile.externalActionMode
    && assignment.dataEgressMode === profile.dataEgressMode
    && sameData(assignment.requiredApprovalActions, profile.requiredApprovalActions)
    && sameData(assignment.forbiddenActions, profile.forbiddenActions);
}

function contextMatchesEntry(
  snapshot: ProjectExecutionContextSnapshot,
  entry: NormalizedWorkflowCatalogEntry,
): boolean {
  return snapshot.projectId === entry.workflowManifest.projectId
    && snapshot.departmentId === entry.workflowManifest.departmentId
    && snapshot.bindingId === entry.bindingId
    && snapshot.bindingVersion === entry.bindingVersion
    && snapshot.bindingKind === "workflow"
    && snapshot.subjectId === entry.workflowManifest.id
    && sameData(snapshot.resources, entry.effectiveResources)
    && sameData(snapshot.modelProfileIds, entry.effectiveModelProfileIds)
    && sameData(snapshot.knowledgeCollectionIds, entry.effectiveKnowledgeCollectionIds)
    && sameData(snapshot.budget, entry.effectiveBudget)
    && snapshot.externalActionMode === entry.effectiveExternalActionMode
    && snapshot.dataEgressMode === entry.effectiveDataEgressMode
    && sameData(snapshot.requiredApprovalActions, entry.effectiveRequiredApprovalActions.slice(0, snapshot.requiredApprovalActions.length))
    && sameData(snapshot.forbiddenActions, entry.effectiveForbiddenActions.slice(0, snapshot.forbiddenActions.length));
}

function cloneStep(step: WorkflowStep): WorkflowStep {
  if (step.kind === "approval_gate") return { ...step, dependsOnStepIds: [...step.dependsOnStepIds] };
  return {
    ...step,
    dependsOnStepIds: [...step.dependsOnStepIds],
    requestedResources: cloneResources(step.requestedResources),
    knowledgeCollectionIds: [...step.knowledgeCollectionIds],
    toolIds: [...step.toolIds],
  };
}

function freezeAgentProfile(profile: AgentExecutionProfile): AgentExecutionProfile {
  Object.freeze(profile.outputTypes);
  Object.freeze(profile.allowedWorkflowIds);
  Object.freeze(profile.allowedToolIds);
  Object.freeze(profile.allowedModelProfileIds);
  Object.freeze(profile.knowledgeCollectionIds);
  Object.freeze(profile.modelRouting.fallbackModelProfileIds);
  Object.freeze(profile.modelRouting);
  for (const resource of profile.resources) {
    Object.freeze(resource.capabilities);
    Object.freeze(resource);
  }
  Object.freeze(profile.resources);
  Object.freeze(profile.budget);
  Object.freeze(profile.requiredApprovalActions);
  Object.freeze(profile.forbiddenActions);
  return Object.freeze(profile);
}

function cloneAgentProfile(profile: AgentExecutionProfile): AgentExecutionProfile {
  return freezeAgentProfile({
    ...profile,
    outputTypes: [...profile.outputTypes],
    allowedWorkflowIds: [...profile.allowedWorkflowIds],
    allowedToolIds: [...profile.allowedToolIds],
    allowedModelProfileIds: [...profile.allowedModelProfileIds],
    knowledgeCollectionIds: [...profile.knowledgeCollectionIds],
    modelRouting: { ...profile.modelRouting, fallbackModelProfileIds: [...profile.modelRouting.fallbackModelProfileIds] },
    resources: cloneResources(profile.resources),
    budget: cloneBudget(profile.budget),
    requiredApprovalActions: [...profile.requiredApprovalActions],
    forbiddenActions: [...profile.forbiddenActions],
  });
}

function freezeExecutionProfile(profile: WorkflowExecutionProfile): WorkflowExecutionProfile {
  for (const wave of profile.executionWaves) Object.freeze(wave);
  Object.freeze(profile.executionWaves);
  for (const step of profile.steps) {
    Object.freeze(step.dependsOnStepIds);
    if (step.kind === "agent_task") {
      for (const resource of step.requestedResources) {
        Object.freeze(resource.capabilities);
        Object.freeze(resource);
      }
      Object.freeze(step.requestedResources);
      Object.freeze(step.knowledgeCollectionIds);
      Object.freeze(step.toolIds);
    }
    Object.freeze(step);
  }
  Object.freeze(profile.steps);
  Object.freeze(profile.agents);
  for (const resource of profile.resources) {
    Object.freeze(resource.capabilities);
    Object.freeze(resource);
  }
  Object.freeze(profile.resources);
  Object.freeze(profile.modelProfileIds);
  Object.freeze(profile.knowledgeCollectionIds);
  Object.freeze(profile.budget);
  Object.freeze(profile.requiredApprovalActions);
  Object.freeze(profile.forbiddenActions);
  return Object.freeze(profile);
}

function resolutionDeny(
  reasons: readonly WorkflowCatalogReason[],
  catalogDecision: WorkspaceWorkflowCatalogDecision,
  contextDecision: ProjectExecutionContextResolutionDecision | null = null,
  agentDecisions: readonly AgentExecutionProfileResolutionDecision[] = [],
): WorkflowExecutionProfileResolutionDecision {
  return { verdict: "deny", reasons, catalogDecision, contextDecision, agentDecisions, profile: null };
}

function resolveSnapshot(input: unknown): WorkflowExecutionProfileResolutionDecision {
  const reasons: MutableCatalogReasons = [];
  if (!isPlainRecord(input) || unknownFields(input, ["catalog", "projectId", "workflowId", "bindingId"]).length > 0 || !Object.hasOwn(input, "catalog") || !Object.hasOwn(input, "projectId") || !Object.hasOwn(input, "workflowId") || !Object.hasOwn(input, "bindingId")) {
    addReason(reasons, "invalid_input", "$", "Workflow resolution input must contain only catalog, projectId, workflowId, and bindingId.");
    return resolutionDeny(reasons, catalogDeny(reasons, null, null));
  }
  const catalogInput = ownData(input, "catalog");
  const catalogDecision = evaluateWorkspaceWorkflowCatalog(catalogInput);
  if (catalogDecision.verdict === "deny" || catalogDecision.normalizedCatalog === null) return resolutionDeny(catalogDecision.reasons, catalogDecision);
  const projectId = normalizeId(ownData(input, "projectId"));
  const workflowId = normalizeId(ownData(input, "workflowId"));
  const bindingId = normalizeId(ownData(input, "bindingId"));
  if (projectId === null || workflowId === null || bindingId === null) {
    addReason(reasons, "invalid_input", projectId === null ? "projectId" : workflowId === null ? "workflowId" : "bindingId", "Resolution IDs must be stable IDs.", { projectId, workflowId, workflowBindingId: bindingId });
    return resolutionDeny(reasons, catalogDecision);
  }
  const entry = catalogDecision.normalizedCatalog.workflows.find((candidate) => candidate.workflowManifest.projectId === projectId && candidate.workflowManifest.id === workflowId && candidate.bindingId === bindingId);
  if (!entry) {
    addReason(reasons, "workflow_binding_not_found", "bindingId", `Exact Workflow ${workflowId}/${bindingId} was not found in Project ${projectId}.`, { projectId, workflowId, workflowBindingId: bindingId });
    return resolutionDeny(reasons, catalogDecision);
  }
  const ids = { projectId, departmentId: entry.workflowManifest.departmentId, workflowId, workflowBindingId: bindingId };
  if (entry.workflowManifest.status !== "active") {
    addReason(reasons, "workflow_not_active", "workflowManifest.status", `Workflow ${workflowId} has status ${entry.workflowManifest.status}.`, ids);
    return resolutionDeny(reasons, catalogDecision);
  }
  if (entry.bindingStatus !== "active") {
    addReason(reasons, "binding_not_active", "binding.status", `Workflow binding ${bindingId} has status ${entry.bindingStatus}.`, ids);
    return resolutionDeny(reasons, catalogDecision);
  }
  if (!isPlainRecord(catalogInput)) {
    addReason(reasons, "invalid_input", "catalog", "Catalog snapshot is invalid.", ids);
    return resolutionDeny(reasons, catalogDecision);
  }
  const registry = ownData(catalogInput, "registry");
  const agents = ownData(catalogInput, "agents");
  const contextDecision = resolveProjectExecutionContext({ registry, projectId, bindingId });
  if (contextDecision.verdict === "deny" || contextDecision.snapshot === null || !contextMatchesEntry(contextDecision.snapshot, entry)) {
    addReason(reasons, "context_resolution_denied", "catalog.registry", "Factual Workflow binding context resolution was denied or mismatched.", ids);
    return resolutionDeny(reasons, catalogDecision, contextDecision);
  }
  const agentDecisions: AgentExecutionProfileResolutionDecision[] = [];
  const agentProfiles: AgentExecutionProfile[] = [];
  for (const assignment of entry.agentAssignments) {
    const decision = resolveAgentExecutionProfile({
      catalog: { registry, agents },
      projectId,
      agentId: assignment.agentId,
      bindingId: assignment.agentBindingId,
    });
    agentDecisions.push(decision);
    if (decision.verdict === "deny" || decision.profile === null || assignment.agentStatus !== "active" || assignment.agentBindingStatus !== "active" || !assignmentMatchesProfile(assignment, decision.profile)) {
      addReason(reasons, "agent_resolution_denied", "catalog.agents", `Factual Agent resolution denied or mismatched for ${assignment.agentId}.`, { ...ids, agentId: assignment.agentId, agentBindingId: assignment.agentBindingId });
      return resolutionDeny(reasons, catalogDecision, contextDecision, agentDecisions);
    }
    agentProfiles.push(cloneAgentProfile(decision.profile));
  }
  const snapshot = contextDecision.snapshot;
  const profile = freezeExecutionProfile({
    workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId,
    projectManifestVersion: snapshot.projectManifestVersion,
    departmentId: snapshot.departmentId,
    departmentManifestVersion: snapshot.departmentManifestVersion,
    workflowId: entry.workflowManifest.id,
    workflowManifestVersion: entry.workflowManifest.version,
    workflowStatus: entry.workflowManifest.status,
    workflowBindingId: entry.bindingId,
    workflowBindingVersion: entry.bindingVersion,
    triggerMode: entry.workflowManifest.triggerMode,
    executionWaves: entry.executionWaves.map((wave) => [...wave]),
    steps: entry.workflowManifest.steps.map(cloneStep),
    agents: agentProfiles,
    resources: cloneResources(entry.effectiveResources),
    modelProfileIds: [...entry.effectiveModelProfileIds],
    knowledgeCollectionIds: [...entry.effectiveKnowledgeCollectionIds],
    budget: cloneBudget(entry.effectiveBudget),
    externalActionMode: entry.effectiveExternalActionMode,
    dataEgressMode: entry.effectiveDataEgressMode,
    requiredApprovalActions: [...entry.effectiveRequiredApprovalActions],
    forbiddenActions: [...entry.effectiveForbiddenActions],
  });
  return { verdict: "allow", reasons: [], catalogDecision, contextDecision, agentDecisions: Object.freeze(agentDecisions), profile };
}

export function resolveWorkflowExecutionProfile(input: unknown): WorkflowExecutionProfileResolutionDecision {
  const snapshot = boundedSnapshot(input);
  if (!snapshot.ok) {
    const reasons: MutableCatalogReasons = [];
    addReason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Workflow resolution input exceeds safe snapshot limits." : "Workflow resolution input could not be safely snapshotted.");
    return resolutionDeny(reasons, catalogDeny(reasons, null, null));
  }
  try {
    return resolveSnapshot(snapshot.value);
  } catch {
    const reasons: MutableCatalogReasons = [];
    addReason(reasons, "invalid_input", "$", "Workflow resolution input could not be safely evaluated.");
    return resolutionDeny(reasons, catalogDeny(reasons, null, null));
  }
}
