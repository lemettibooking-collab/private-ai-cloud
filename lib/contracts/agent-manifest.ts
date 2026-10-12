import type { DepartmentManifest } from "./department-manifest";
import type {
  NormalizedProjectSubjectBinding,
  NormalizedWorkspaceProjectContexts,
  ProjectExecutionContextResolutionDecision,
  ProjectExecutionContextResource,
  ProjectExecutionContextSnapshot,
  ProjectSubjectBinding,
  WorkspaceProjectContextsDecision,
} from "./project-context";
import type {
  ProjectBudgetCeiling,
  ProjectDataEgressMode,
  ProjectExternalActionMode,
  ProjectManifest,
} from "./project-manifest";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkspaceProjectContexts, projectContextLimits, resolveProjectExecutionContext } from "./project-context.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { systemForbiddenProjectActions, systemRequiredProjectApprovalActions } from "./project-manifest.ts";

export const agentManifestStatuses = Object.freeze([
  "draft",
  "active",
  "paused",
  "disabled",
] as const);
export type AgentManifestStatus = (typeof agentManifestStatuses)[number];

export const agentRoleCodes = Object.freeze([
  "manager",
  "owner_assistant",
  "knowledge",
  "support",
  "content",
  "product_analyst",
  "task_designer",
  "developer",
  "reviewer",
  "security_compliance",
  "reporter",
] as const);
export type AgentRoleCode = (typeof agentRoleCodes)[number];

export const agentOutputTypes = Object.freeze([
  "summary",
  "answer_with_sources",
  "draft_reply",
  "escalation",
  "draft_content",
  "insight",
  "task_proposal",
  "task_artifact",
  "patch",
  "test_report",
  "review_verdict",
  "incident",
  "block_proposal",
  "owner_report",
] as const);
export type AgentOutputType = (typeof agentOutputTypes)[number];

export const agentCatalogVerdicts = Object.freeze(["allow", "deny"] as const);
export type AgentCatalogVerdict = (typeof agentCatalogVerdicts)[number];

export const agentManifestLimits = Object.freeze({
  maxIdLength: 64,
  maxNameLength: 160,
  maxSummaryLength: 4096,
  maxGoals: 32,
  maxNonGoals: 32,
  maxOutputTypes: agentOutputTypes.length,
  maxWorkflowIds: 64,
  maxToolIds: 64,
  maxModelProfileIds: 32,
  maxFallbackModelProfileIds: 8,
  maxKnowledgeCollectionIds: 64,
  maxAdditionalApprovalActions: 64,
  maxAdditionalForbiddenActions: 64,
  maxTextListItemLength: 1024,
  maxErrors: 512,
  maxCatalogEntries:
    projectContextLimits.maxProjects * projectContextLimits.maxBindingsPerProject,
});

export type AgentModelRouting = Readonly<{
  primaryModelProfileId: string;
  fallbackModelProfileIds: readonly string[];
  reviewerModelProfileId: string | null;
  independentReviewRequired: boolean;
}>;

export type AgentManifest = Readonly<{
  id: string;
  projectId: string;
  departmentId: string;
  version: number;
  roleCode: AgentRoleCode;
  name: string;
  summary: string;
  status: AgentManifestStatus;
  instructionProfileId: string;
  goals: readonly string[];
  nonGoals: readonly string[];
  outputTypes: readonly AgentOutputType[];
  allowedWorkflowIds: readonly string[];
  allowedToolIds: readonly string[];
  allowedModelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  modelRouting: AgentModelRouting;
  additionalRequiredApprovalActions: readonly string[];
  additionalForbiddenActions: readonly string[];
}>;

export type AgentManifestValidationErrorCode =
  | "invalid_input"
  | "unknown_field"
  | "required_field"
  | "invalid_type"
  | "invalid_id"
  | "invalid_integer"
  | "invalid_enum"
  | "limit_exceeded"
  | "empty_collection"
  | "primary_model_not_allowed"
  | "fallback_model_not_allowed"
  | "primary_model_in_fallback"
  | "reviewer_model_not_allowed"
  | "reviewer_required"
  | "reviewer_matches_primary";

export type AgentManifestValidationError = Readonly<{
  code: AgentManifestValidationErrorCode;
  path: string;
  message: string;
}>;

export type AgentManifestValidationResult =
  | Readonly<{ ok: true; value: AgentManifest }>
  | Readonly<{ ok: false; errors: readonly AgentManifestValidationError[] }>;

export type AgentCatalogEntry = Readonly<{
  bindingId: string;
  agentManifest: unknown;
}>;

export type WorkspaceAgentCatalogInput = Readonly<{
  registry: unknown;
  agents: readonly AgentCatalogEntry[];
}>;

export type WorkspaceAgentCatalogReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "invalid_registry"
  | "invalid_agent_manifest"
  | "duplicate_agent_binding"
  | "duplicate_agent_id"
  | "binding_not_found"
  | "binding_not_agent"
  | "agent_project_mismatch"
  | "agent_department_mismatch"
  | "agent_subject_mismatch"
  | "missing_agent_manifest"
  | "workflow_not_enabled"
  | "model_not_granted"
  | "knowledge_not_granted"
  | "inherited_policy_capacity_exceeded"
  | "project_not_found"
  | "agent_not_found"
  | "agent_not_active"
  | "binding_not_active"
  | "context_resolution_denied";

export type WorkspaceAgentCatalogReason = Readonly<{
  code: WorkspaceAgentCatalogReasonCode;
  path: string;
  message: string;
  projectId: string | null;
  departmentId: string | null;
  agentId: string | null;
  bindingId: string | null;
}>;

export type NormalizedAgentCatalogEntry = Readonly<{
  bindingId: string;
  bindingVersion: number;
  bindingStatus: NormalizedProjectSubjectBinding["status"];
  agentManifest: AgentManifest;
  effectiveRequiredApprovalActions: readonly string[];
  effectiveForbiddenActions: readonly string[];
}>;

export type NormalizedWorkspaceAgentCatalog = Readonly<{
  workspaceId: string;
  agents: readonly NormalizedAgentCatalogEntry[];
}>;

export type WorkspaceAgentCatalogDecision = Readonly<{
  verdict: AgentCatalogVerdict;
  reasons: readonly WorkspaceAgentCatalogReason[];
  registryDecision: WorkspaceProjectContextsDecision | null;
  normalizedCatalog: NormalizedWorkspaceAgentCatalog | null;
}>;

export type AgentExecutionProfile = Readonly<{
  workspaceId: string;
  projectId: string;
  projectManifestVersion: number;
  departmentId: string;
  departmentManifestVersion: number;
  agentId: string;
  agentManifestVersion: number;
  roleCode: AgentRoleCode;
  bindingId: string;
  bindingVersion: number;
  instructionProfileId: string;
  outputTypes: readonly AgentOutputType[];
  allowedWorkflowIds: readonly string[];
  allowedToolIds: readonly string[];
  allowedModelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  modelRouting: AgentModelRouting;
  resources: readonly ProjectExecutionContextResource[];
  budget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  requiredApprovalActions: readonly string[];
  forbiddenActions: readonly string[];
}>;

export type AgentExecutionProfileResolutionInput = Readonly<{
  catalog: unknown;
  projectId: string;
  agentId: string;
  bindingId: string;
}>;

export type AgentExecutionProfileResolutionDecision = Readonly<{
  verdict: AgentCatalogVerdict;
  reasons: readonly WorkspaceAgentCatalogReason[];
  catalogDecision: WorkspaceAgentCatalogDecision;
  contextDecision: ProjectExecutionContextResolutionDecision | null;
  profile: AgentExecutionProfile | null;
}>;

type MutableValidationErrors = AgentManifestValidationError[];
type MutableCatalogReasons = WorkspaceAgentCatalogReason[];
type CatalogSourceEntry = Readonly<{
  path: string;
  bindingId: string;
  agentManifest: AgentManifest;
}>;
type ResolvedCatalogEntry = Readonly<{
  source: CatalogSourceEntry;
  binding: NormalizedProjectSubjectBinding;
  enabledWorkflowIds: readonly string[];
}>;
type CanonicalProjectContextInput = Readonly<{
  projectManifest: ProjectManifest;
  departmentManifests: readonly DepartmentManifest[];
  bindings: readonly ProjectSubjectBinding[];
}>;
type CanonicalWorkspaceRegistryInput = Readonly<{
  workspaceId: string;
  projects: readonly CanonicalProjectContextInput[];
}>;

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const agentManifestFields = Object.freeze([
  "id",
  "projectId",
  "departmentId",
  "version",
  "roleCode",
  "name",
  "summary",
  "status",
  "instructionProfileId",
  "goals",
  "nonGoals",
  "outputTypes",
  "allowedWorkflowIds",
  "allowedToolIds",
  "allowedModelProfileIds",
  "knowledgeCollectionIds",
  "modelRouting",
  "additionalRequiredApprovalActions",
  "additionalForbiddenActions",
] as const);
const modelRoutingFields = Object.freeze([
  "primaryModelProfileId",
  "fallbackModelProfileIds",
  "reviewerModelProfileId",
  "independentReviewRequired",
] as const);

function isRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function own(input: Record<string, unknown>, key: string): unknown {
  return input[key];
}

function ownDataValue(
  input: Record<string, unknown>,
  key: string,
): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && Object.hasOwn(descriptor, "value")
    ? { ok: true, value: descriptor.value }
    : { ok: false };
}

function hasOnlyBoundedDataProperties(
  input: unknown,
  state: { inspectedProperties: number },
  depth = 0,
): boolean {
  if (typeof input !== "object" || input === null) return true;
  if (depth > 16 || state.inspectedProperties > agentManifestLimits.maxCatalogEntries * 512) return false;
  if (!Array.isArray(input) && !isRecord(input)) return false;
  for (const key of Object.keys(input)) {
    state.inspectedProperties += 1;
    if (state.inspectedProperties > agentManifestLimits.maxCatalogEntries * 512) return false;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
    if (!hasOnlyBoundedDataProperties(descriptor.value, state, depth + 1)) return false;
  }
  return true;
}

function exactUnknownFields(input: Record<string, unknown>, fields: readonly string[]): string[] {
  const accepted = new Set(fields);
  return Object.keys(input).filter((field) => !accepted.has(field)).sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function includesValue<T>(values: readonly T[], input: unknown): input is T {
  return values.some((value) => value === input);
}

function normalizeText(input: string): string {
  return input.replace(/\r\n?/gu, "\n").trim();
}

function stableId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return safeIdPattern.test(value) ? value : null;
}

function addValidationError(
  errors: MutableValidationErrors,
  code: AgentManifestValidationErrorCode,
  path: string,
  message: string,
): void {
  if (errors.length < agentManifestLimits.maxErrors) errors.push({ code, path, message });
}

function normalizeRequiredId(
  input: unknown,
  path: string,
  errors: MutableValidationErrors,
): string | null {
  const value = stableId(input);
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
  return value;
}

function normalizeStringList(
  input: unknown,
  path: string,
  maxItems: number,
  errors: MutableValidationErrors,
  options: Readonly<{ ids: boolean; required?: boolean }> = { ids: false },
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
    return null;
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.entries()) {
    let value: string | null;
    if (options.ids) value = stableId(item);
    else if (typeof item === "string") {
      const normalized = normalizeText(item);
      value = normalized.length > 0 && normalized.length <= agentManifestLimits.maxTextListItemLength
        ? normalized
        : null;
    } else value = null;
    if (value === null) {
      addValidationError(
        errors,
        options.ids ? "invalid_id" : "invalid_type",
        `${path}[${index}]`,
        `${path}[${index}] is invalid.`,
      );
    } else if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  if (options.required && values.length === 0) {
    addValidationError(errors, "empty_collection", path, `${path} must not be empty.`);
  }
  return values;
}

function normalizeOutputTypes(input: unknown, errors: MutableValidationErrors): AgentOutputType[] | null {
  if (!Array.isArray(input)) {
    addValidationError(errors, "invalid_type", "outputTypes", "outputTypes must be an array.");
    return null;
  }
  if (input.length === 0) {
    addValidationError(errors, "empty_collection", "outputTypes", "outputTypes must not be empty.");
    return null;
  }
  if (input.length > agentManifestLimits.maxOutputTypes) {
    addValidationError(errors, "limit_exceeded", "outputTypes", "outputTypes exceeds its item limit.");
    return null;
  }
  const selected = new Set<AgentOutputType>();
  for (const [index, value] of input.entries()) {
    if (!includesValue(agentOutputTypes, value)) {
      addValidationError(errors, "invalid_enum", `outputTypes[${index}]`, "Unknown Agent output type.");
    } else selected.add(value);
  }
  return agentOutputTypes.filter((value) => selected.has(value));
}

function normalizeModelRouting(
  input: unknown,
  allowedModels: readonly string[],
  errors: MutableValidationErrors,
): AgentModelRouting | null {
  if (!isRecord(input)) {
    addValidationError(errors, "invalid_type", "modelRouting", "modelRouting must be a plain object.");
    return null;
  }
  for (const field of exactUnknownFields(input, modelRoutingFields)) {
    addValidationError(errors, "unknown_field", `modelRouting.${field}`, `Unknown modelRouting field ${field}.`);
  }
  for (const field of modelRoutingFields) {
    if (!Object.hasOwn(input, field)) addValidationError(errors, "required_field", `modelRouting.${field}`, `${field} is required.`);
  }
  const primary = normalizeRequiredId(own(input, "primaryModelProfileId"), "modelRouting.primaryModelProfileId", errors);
  const fallback = normalizeStringList(
    own(input, "fallbackModelProfileIds"),
    "modelRouting.fallbackModelProfileIds",
    agentManifestLimits.maxFallbackModelProfileIds,
    errors,
    { ids: true },
  );
  const reviewerInput = own(input, "reviewerModelProfileId");
  const reviewer = reviewerInput === null
    ? null
    : normalizeRequiredId(reviewerInput, "modelRouting.reviewerModelProfileId", errors);
  const independent = own(input, "independentReviewRequired");
  if (typeof independent !== "boolean") {
    addValidationError(errors, "invalid_type", "modelRouting.independentReviewRequired", "independentReviewRequired must be a boolean.");
  }
  if (primary !== null && !allowedModels.includes(primary)) {
    addValidationError(errors, "primary_model_not_allowed", "modelRouting.primaryModelProfileId", "Primary model must be allowed by the Agent.");
  }
  for (const [index, modelId] of (fallback ?? []).entries()) {
    if (!allowedModels.includes(modelId)) addValidationError(errors, "fallback_model_not_allowed", `modelRouting.fallbackModelProfileIds[${index}]`, "Fallback model must be allowed by the Agent.");
    if (modelId === primary) addValidationError(errors, "primary_model_in_fallback", `modelRouting.fallbackModelProfileIds[${index}]`, "Primary model cannot also be a fallback model.");
  }
  if (reviewer !== null && !allowedModels.includes(reviewer)) {
    addValidationError(errors, "reviewer_model_not_allowed", "modelRouting.reviewerModelProfileId", "Reviewer model must be allowed by the Agent.");
  }
  if (independent === true && reviewer === null) {
    addValidationError(errors, "reviewer_required", "modelRouting.reviewerModelProfileId", "Independent review requires a reviewer model.");
  }
  if (independent === true && reviewer !== null && reviewer === primary) {
    addValidationError(errors, "reviewer_matches_primary", "modelRouting.reviewerModelProfileId", "Independent reviewer must differ from the primary model.");
  }
  if (primary === null || fallback === null || reviewer === undefined || typeof independent !== "boolean") return null;
  return {
    primaryModelProfileId: primary,
    fallbackModelProfileIds: fallback,
    reviewerModelProfileId: reviewer,
    independentReviewRequired: independent,
  };
}

function freezeAgentManifest(manifest: AgentManifest): AgentManifest {
  Object.freeze(manifest.goals);
  Object.freeze(manifest.nonGoals);
  Object.freeze(manifest.outputTypes);
  Object.freeze(manifest.allowedWorkflowIds);
  Object.freeze(manifest.allowedToolIds);
  Object.freeze(manifest.allowedModelProfileIds);
  Object.freeze(manifest.knowledgeCollectionIds);
  Object.freeze(manifest.modelRouting.fallbackModelProfileIds);
  Object.freeze(manifest.modelRouting);
  Object.freeze(manifest.additionalRequiredApprovalActions);
  Object.freeze(manifest.additionalForbiddenActions);
  return Object.freeze(manifest);
}

function validateAndNormalizeAgentManifestInternal(input: unknown): AgentManifestValidationResult {
  const errors: MutableValidationErrors = [];
  if (!isRecord(input)) {
    addValidationError(errors, "invalid_input", "$", "AgentManifest must be a plain object.");
    return { ok: false, errors };
  }
  for (const field of exactUnknownFields(input, agentManifestFields)) {
    addValidationError(errors, "unknown_field", field, `Unknown AgentManifest field ${field}.`);
  }
  for (const field of agentManifestFields) {
    if (!Object.hasOwn(input, field)) addValidationError(errors, "required_field", field, `${field} is required.`);
  }
  const id = normalizeRequiredId(own(input, "id"), "id", errors);
  const projectId = normalizeRequiredId(own(input, "projectId"), "projectId", errors);
  const departmentId = normalizeRequiredId(own(input, "departmentId"), "departmentId", errors);
  const instructionProfileId = normalizeRequiredId(own(input, "instructionProfileId"), "instructionProfileId", errors);
  const version = own(input, "version");
  if (!Number.isSafeInteger(version) || (version as number) < 1) addValidationError(errors, "invalid_integer", "version", "version must be a positive safe integer.");
  const roleCode = own(input, "roleCode");
  if (!includesValue(agentRoleCodes, roleCode)) addValidationError(errors, "invalid_enum", "roleCode", "Unknown Agent role code.");
  const status = own(input, "status");
  if (!includesValue(agentManifestStatuses, status)) addValidationError(errors, "invalid_enum", "status", "Unknown Agent manifest status.");
  const name = normalizeBoundedText(own(input, "name"), "name", agentManifestLimits.maxNameLength, errors);
  const summary = normalizeBoundedText(own(input, "summary"), "summary", agentManifestLimits.maxSummaryLength, errors);
  const goals = normalizeStringList(own(input, "goals"), "goals", agentManifestLimits.maxGoals, errors);
  const nonGoals = normalizeStringList(own(input, "nonGoals"), "nonGoals", agentManifestLimits.maxNonGoals, errors);
  const outputTypes = normalizeOutputTypes(own(input, "outputTypes"), errors);
  const workflows = normalizeStringList(own(input, "allowedWorkflowIds"), "allowedWorkflowIds", agentManifestLimits.maxWorkflowIds, errors, { ids: true });
  const tools = normalizeStringList(own(input, "allowedToolIds"), "allowedToolIds", agentManifestLimits.maxToolIds, errors, { ids: true });
  const models = normalizeStringList(own(input, "allowedModelProfileIds"), "allowedModelProfileIds", agentManifestLimits.maxModelProfileIds, errors, { ids: true, required: true });
  const knowledge = normalizeStringList(own(input, "knowledgeCollectionIds"), "knowledgeCollectionIds", agentManifestLimits.maxKnowledgeCollectionIds, errors, { ids: true });
  const requiredApprovals = normalizeStringList(own(input, "additionalRequiredApprovalActions"), "additionalRequiredApprovalActions", agentManifestLimits.maxAdditionalApprovalActions, errors);
  const forbidden = normalizeStringList(own(input, "additionalForbiddenActions"), "additionalForbiddenActions", agentManifestLimits.maxAdditionalForbiddenActions, errors);
  const modelRouting = normalizeModelRouting(own(input, "modelRouting"), models ?? [], errors);
  if (errors.length > 0 || id === null || projectId === null || departmentId === null || instructionProfileId === null || name === null || summary === null || goals === null || nonGoals === null || outputTypes === null || workflows === null || tools === null || models === null || knowledge === null || requiredApprovals === null || forbidden === null || modelRouting === null || !Number.isSafeInteger(version) || (version as number) < 1 || !includesValue(agentRoleCodes, roleCode) || !includesValue(agentManifestStatuses, status)) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: freezeAgentManifest({
      id,
      projectId,
      departmentId,
      version: version as number,
      roleCode,
      name,
      summary,
      status,
      instructionProfileId,
      goals,
      nonGoals,
      outputTypes,
      allowedWorkflowIds: workflows,
      allowedToolIds: tools,
      allowedModelProfileIds: models,
      knowledgeCollectionIds: knowledge,
      modelRouting,
      additionalRequiredApprovalActions: requiredApprovals,
      additionalForbiddenActions: forbidden,
    }),
  };
}

export function validateAndNormalizeAgentManifest(input: unknown): AgentManifestValidationResult {
  try {
    return validateAndNormalizeAgentManifestInternal(input);
  } catch {
    return {
      ok: false,
      errors: [{ code: "invalid_input", path: "$", message: "AgentManifest could not be safely inspected." }],
    };
  }
}

export function isAgentManifestStatus(input: unknown): input is AgentManifestStatus {
  return includesValue(agentManifestStatuses, input);
}

export function parseAgentManifestStatus(input: unknown): AgentManifestStatus | null {
  return isAgentManifestStatus(input) ? input : null;
}

export function isAgentRoleCode(input: unknown): input is AgentRoleCode {
  return includesValue(agentRoleCodes, input);
}

export function parseAgentRoleCode(input: unknown): AgentRoleCode | null {
  return isAgentRoleCode(input) ? input : null;
}

export function isAgentOutputType(input: unknown): input is AgentOutputType {
  return includesValue(agentOutputTypes, input);
}

export function parseAgentOutputType(input: unknown): AgentOutputType | null {
  return isAgentOutputType(input) ? input : null;
}

export function isAgentCatalogVerdict(input: unknown): input is AgentCatalogVerdict {
  return includesValue(agentCatalogVerdicts, input);
}

export function parseAgentCatalogVerdict(input: unknown): AgentCatalogVerdict | null {
  return isAgentCatalogVerdict(input) ? input : null;
}

function addCatalogReason(
  reasons: MutableCatalogReasons,
  code: WorkspaceAgentCatalogReasonCode,
  path: string,
  message: string,
  ids: Partial<Pick<WorkspaceAgentCatalogReason, "projectId" | "departmentId" | "agentId" | "bindingId">> = {},
): void {
  if (reasons.length >= agentManifestLimits.maxErrors) return;
  reasons.push({
    code,
    path,
    message,
    projectId: ids.projectId ?? null,
    departmentId: ids.departmentId ?? null,
    agentId: ids.agentId ?? null,
    bindingId: ids.bindingId ?? null,
  });
}

function catalogDeny(
  reasons: readonly WorkspaceAgentCatalogReason[],
  registryDecision: WorkspaceProjectContextsDecision | null,
): WorkspaceAgentCatalogDecision {
  return { verdict: "deny", reasons, registryDecision, normalizedCatalog: null };
}

function stableMerge(left: readonly string[], right: readonly string[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of [...left, ...right]) {
    if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

function parentOrderedSubset(parent: readonly string[], selected: readonly string[]): string[] {
  const selectedValues = new Set(selected);
  return parent.filter((value) => selectedValues.has(value));
}

function cloneManifestWithParentOrdering(
  manifest: AgentManifest,
  enabledWorkflowIds: readonly string[],
  effectiveModelProfileIds: readonly string[],
  effectiveKnowledgeCollectionIds: readonly string[],
): AgentManifest {
  return freezeAgentManifest({
    ...manifest,
    goals: [...manifest.goals],
    nonGoals: [...manifest.nonGoals],
    outputTypes: [...manifest.outputTypes],
    allowedWorkflowIds: parentOrderedSubset(enabledWorkflowIds, manifest.allowedWorkflowIds),
    allowedToolIds: [...manifest.allowedToolIds],
    allowedModelProfileIds: parentOrderedSubset(effectiveModelProfileIds, manifest.allowedModelProfileIds),
    knowledgeCollectionIds: parentOrderedSubset(effectiveKnowledgeCollectionIds, manifest.knowledgeCollectionIds),
    modelRouting: {
      ...manifest.modelRouting,
      fallbackModelProfileIds: parentOrderedSubset(
        effectiveModelProfileIds,
        manifest.modelRouting.fallbackModelProfileIds,
      ),
    },
    additionalRequiredApprovalActions: [...manifest.additionalRequiredApprovalActions],
    additionalForbiddenActions: [...manifest.additionalForbiddenActions],
  });
}

function freezeCatalogEntry(entry: NormalizedAgentCatalogEntry): NormalizedAgentCatalogEntry {
  Object.freeze(entry.effectiveRequiredApprovalActions);
  Object.freeze(entry.effectiveForbiddenActions);
  return Object.freeze(entry);
}

function evaluateWorkspaceAgentCatalogInternal(input: unknown): WorkspaceAgentCatalogDecision {
  const reasons: MutableCatalogReasons = [];
  if (!isRecord(input) || exactUnknownFields(input, ["registry", "agents"]).length > 0 || !Object.hasOwn(input, "registry") || !Object.hasOwn(input, "agents")) {
    addCatalogReason(reasons, "invalid_input", "$", "Workspace Agent Catalog input must contain only registry and agents.");
    return catalogDeny(reasons, null);
  }
  const registryProperty = ownDataValue(input, "registry");
  const agentsProperty = ownDataValue(input, "agents");
  if (!registryProperty.ok || !agentsProperty.ok) {
    addCatalogReason(reasons, "invalid_input", "$", "Workspace Agent Catalog fields must be ordinary data properties.");
    return catalogDeny(reasons, null);
  }
  const agentInputs = agentsProperty.value;
  if (!Array.isArray(agentInputs)) {
    addCatalogReason(reasons, "invalid_input", "agents", "agents must be an array.");
    return catalogDeny(reasons, null);
  }
  if (agentInputs.length > agentManifestLimits.maxCatalogEntries) {
    addCatalogReason(reasons, "limit_exceeded", "agents", "Agent Catalog exceeds its entry limit.");
    return catalogDeny(reasons, null);
  }
  const rawRegistry = registryProperty.value;
  if (!hasOnlyBoundedDataProperties(rawRegistry, { inspectedProperties: 0 })) {
    addCatalogReason(reasons, "invalid_input", "registry", "Workspace Project Context Registry must contain only bounded data properties.");
    return catalogDeny(reasons, null);
  }
  let registry: unknown;
  try {
    registry = structuredClone(rawRegistry);
  } catch {
    addCatalogReason(reasons, "invalid_input", "registry", "Workspace Project Context Registry could not be safely snapshotted.");
    return catalogDeny(reasons, null);
  }
  const registryDecision = evaluateWorkspaceProjectContexts(registry);
  if (registryDecision.verdict === "deny" || registryDecision.normalizedRegistry === null) {
    addCatalogReason(reasons, "invalid_registry", "registry", "Workspace Project Context Registry was denied.");
    return catalogDeny(reasons, registryDecision);
  }
  const sourceEntries: CatalogSourceEntry[] = [];
  for (const [index, entryInput] of agentInputs.entries()) {
    const path = `agents[${index}]`;
    if (!isRecord(entryInput) || exactUnknownFields(entryInput, ["bindingId", "agentManifest"]).length > 0 || !Object.hasOwn(entryInput, "bindingId") || !Object.hasOwn(entryInput, "agentManifest")) {
      addCatalogReason(reasons, "invalid_input", path, "Agent Catalog entry must contain only bindingId and agentManifest.");
      continue;
    }
    const bindingId = stableId(own(entryInput, "bindingId"));
    if (bindingId === null) {
      addCatalogReason(reasons, "invalid_input", `${path}.bindingId`, "bindingId must be a stable ID.");
      continue;
    }
    const validation = validateAndNormalizeAgentManifest(own(entryInput, "agentManifest"));
    if (!validation.ok) {
      for (const error of validation.errors) {
        addCatalogReason(reasons, "invalid_agent_manifest", `${path}.agentManifest.${error.path}`, `${error.code}: ${error.message}`, { bindingId });
      }
      continue;
    }
    sourceEntries.push({ path, bindingId, agentManifest: validation.value });
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision);
  const entries = [...sourceEntries].sort((left, right) =>
    compareStrings(left.agentManifest.projectId, right.agentManifest.projectId)
    || compareStrings(left.agentManifest.departmentId, right.agentManifest.departmentId)
    || compareStrings(left.agentManifest.id, right.agentManifest.id)
    || compareStrings(left.bindingId, right.bindingId),
  );
  const bindingEntries = new Map<string, CatalogSourceEntry>();
  const agentIds = new Map<string, CatalogSourceEntry>();
  for (const entry of entries) {
    const previousBinding = bindingEntries.get(entry.bindingId);
    if (previousBinding) addCatalogReason(reasons, "duplicate_agent_binding", `${entry.path}.bindingId`, `Binding ${entry.bindingId} has more than one Agent manifest.`, { projectId: entry.agentManifest.projectId, departmentId: entry.agentManifest.departmentId, agentId: entry.agentManifest.id, bindingId: entry.bindingId });
    else bindingEntries.set(entry.bindingId, entry);
    const previousAgent = agentIds.get(entry.agentManifest.id);
    if (previousAgent) addCatalogReason(reasons, "duplicate_agent_id", `${entry.path}.agentManifest.id`, `Agent ID ${entry.agentManifest.id} is duplicated.`, { projectId: entry.agentManifest.projectId, departmentId: entry.agentManifest.departmentId, agentId: entry.agentManifest.id, bindingId: entry.bindingId });
    else agentIds.set(entry.agentManifest.id, entry);
  }
  const representedBindings = new Set(entries.map((entry) => entry.bindingId));
  for (const project of registryDecision.normalizedRegistry.projects) {
    for (const binding of project.bindings) {
      if (binding.kind === "agent" && !representedBindings.has(binding.id)) addCatalogReason(reasons, "missing_agent_manifest", "agents", `Agent binding ${binding.id} has no manifest.`, { projectId: binding.projectId, departmentId: binding.departmentId, agentId: binding.subjectId, bindingId: binding.id });
    }
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision);
  const resolvedEntries: ResolvedCatalogEntry[] = [];
  for (const entry of entries) {
    const manifest = entry.agentManifest;
    const bindingProject = registryDecision.normalizedRegistry.projects.find((candidate) =>
      candidate.bindings.some((binding) => binding.id === entry.bindingId),
    );
    const binding = bindingProject?.bindings.find((candidate) => candidate.id === entry.bindingId);
    if (!bindingProject || !binding) {
      addCatalogReason(reasons, "binding_not_found", `${entry.path}.bindingId`, `Binding ${entry.bindingId} was not found.`, { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: entry.bindingId });
      continue;
    }
    if (binding.kind !== "agent") addCatalogReason(reasons, "binding_not_agent", `${entry.path}.bindingId`, `Binding ${binding.id} is not an Agent binding.`, { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
    if (binding.projectId !== manifest.projectId) addCatalogReason(reasons, "agent_project_mismatch", `${entry.path}.agentManifest.projectId`, "Agent and binding project IDs do not match.", { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
    if (binding.departmentId !== manifest.departmentId) addCatalogReason(reasons, "agent_department_mismatch", `${entry.path}.agentManifest.departmentId`, "Agent and binding Department IDs do not match.", { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
    if (binding.subjectId !== manifest.id) addCatalogReason(reasons, "agent_subject_mismatch", `${entry.path}.agentManifest.id`, "Agent ID does not match the binding subject ID.", { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
    const department = bindingProject.departments.find((candidate) => candidate.manifest.id === binding.departmentId);
    if (!department) {
      addCatalogReason(reasons, "agent_department_mismatch", `${entry.path}.agentManifest.departmentId`, `Department ${binding.departmentId} was not found.`, { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
      continue;
    }
    resolvedEntries.push({
      source: entry,
      binding,
      enabledWorkflowIds: department.normalizedDepartment.enabledWorkflowIds,
    });
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision);
  for (const { source, binding, enabledWorkflowIds } of resolvedEntries) {
    const manifest = source.agentManifest;
    for (const [index, workflowId] of manifest.allowedWorkflowIds.entries()) {
      if (!enabledWorkflowIds.includes(workflowId)) addCatalogReason(reasons, "workflow_not_enabled", `${source.path}.agentManifest.allowedWorkflowIds[${index}]`, `Workflow ${workflowId} is not enabled by the Department.`, { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
    }
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision);
  for (const { source, binding } of resolvedEntries) {
    const manifest = source.agentManifest;
    for (const [index, modelId] of manifest.allowedModelProfileIds.entries()) {
      if (!binding.effectiveModelProfileIds.includes(modelId)) addCatalogReason(reasons, "model_not_granted", `${source.path}.agentManifest.allowedModelProfileIds[${index}]`, `Model ${modelId} is not granted by the binding.`, { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
    }
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision);
  for (const { source, binding } of resolvedEntries) {
    const manifest = source.agentManifest;
    for (const [index, collectionId] of manifest.knowledgeCollectionIds.entries()) {
      if (!binding.effectiveKnowledgeCollectionIds.includes(collectionId)) addCatalogReason(reasons, "knowledge_not_granted", `${source.path}.agentManifest.knowledgeCollectionIds[${index}]`, `Knowledge Collection ${collectionId} is not granted by the binding.`, { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
    }
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision);
  const normalizedEntries: NormalizedAgentCatalogEntry[] = [];
  for (const { source, binding, enabledWorkflowIds } of resolvedEntries) {
    const manifest = source.agentManifest;
    const approvals = stableMerge(binding.effectiveRequiredApprovalActions, manifest.additionalRequiredApprovalActions);
    const forbidden = stableMerge(binding.effectiveForbiddenActions, manifest.additionalForbiddenActions);
    const approvalCapacity = binding.effectiveRequiredApprovalActions.length
      + agentManifestLimits.maxAdditionalApprovalActions;
    const forbiddenCapacity = binding.effectiveForbiddenActions.length
      + agentManifestLimits.maxAdditionalForbiddenActions;
    if (approvals.length > approvalCapacity || forbidden.length > forbiddenCapacity) {
      addCatalogReason(reasons, "inherited_policy_capacity_exceeded", source.path, "Inherited Agent policy exceeds its capacity.", { projectId: manifest.projectId, departmentId: manifest.departmentId, agentId: manifest.id, bindingId: binding.id });
    }
    normalizedEntries.push(freezeCatalogEntry({
      bindingId: binding.id,
      bindingVersion: binding.version,
      bindingStatus: binding.status,
      agentManifest: cloneManifestWithParentOrdering(
        manifest,
        enabledWorkflowIds,
        binding.effectiveModelProfileIds,
        binding.effectiveKnowledgeCollectionIds,
      ),
      effectiveRequiredApprovalActions: approvals,
      effectiveForbiddenActions: forbidden,
    }));
  }
  if (reasons.length > 0) return catalogDeny(reasons, registryDecision);
  const normalizedCatalog = Object.freeze({
    workspaceId: registryDecision.normalizedRegistry.workspaceId,
    agents: Object.freeze(normalizedEntries),
  });
  return { verdict: "allow", reasons: [], registryDecision, normalizedCatalog };
}

export function evaluateWorkspaceAgentCatalog(input: unknown): WorkspaceAgentCatalogDecision {
  try {
    return evaluateWorkspaceAgentCatalogInternal(input);
  } catch {
    const reasons: MutableCatalogReasons = [];
    addCatalogReason(reasons, "invalid_input", "$", "Workspace Agent Catalog could not be safely inspected.");
    return catalogDeny(reasons, null);
  }
}

function resolutionDeny(
  reasons: readonly WorkspaceAgentCatalogReason[],
  catalogDecision: WorkspaceAgentCatalogDecision,
  contextDecision: ProjectExecutionContextResolutionDecision | null = null,
): AgentExecutionProfileResolutionDecision {
  return { verdict: "deny", reasons, catalogDecision, contextDecision, profile: null };
}

function cloneBudgetValue(budget: ProjectBudgetCeiling): ProjectBudgetCeiling {
  return {
    maxConcurrentRuns: budget.maxConcurrentRuns,
    maxAttemptsPerRun: budget.maxAttemptsPerRun,
    maxRunMinutes: budget.maxRunMinutes,
    dailyTokenBudget: budget.dailyTokenBudget,
    monthlyCostBudgetUsdCents: budget.monthlyCostBudgetUsdCents,
  };
}

function withoutAutomaticRestrictions(
  values: readonly string[],
  automaticValues: readonly string[],
): string[] {
  const automatic = new Set(automaticValues);
  return values.filter((value) => !automatic.has(value));
}

function cloneRawProjectManifest(manifest: ProjectManifest): ProjectManifest {
  return {
    id: manifest.id,
    workspaceId: manifest.workspaceId,
    version: manifest.version,
    name: manifest.name,
    slug: manifest.slug,
    summary: manifest.summary,
    kind: manifest.kind,
    status: manifest.status,
    defaultLocale: manifest.defaultLocale,
    timeZone: manifest.timeZone,
    dataRegion: manifest.dataRegion,
    dataClassification: manifest.dataClassification,
    goals: [...manifest.goals],
    nonGoals: [...manifest.nonGoals],
    tags: [...manifest.tags],
    resources: manifest.resources.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      label: resource.label,
      status: resource.status,
      connectionId: resource.connectionId,
      resourceRef: resource.resourceRef,
      capabilities: [...resource.capabilities],
    })),
    allowedModelProfileIds: [...manifest.allowedModelProfileIds],
    knowledgeCollectionIds: [...manifest.knowledgeCollectionIds],
    policy: {
      externalActionMode: manifest.policy.externalActionMode,
      dataEgressMode: manifest.policy.dataEgressMode,
      requiredApprovalActions: withoutAutomaticRestrictions(
        manifest.policy.requiredApprovalActions,
        systemRequiredProjectApprovalActions,
      ),
      forbiddenActions: withoutAutomaticRestrictions(
        manifest.policy.forbiddenActions,
        systemForbiddenProjectActions,
      ),
    },
    budget: cloneBudgetValue(manifest.budget),
  };
}

function cloneRawDepartmentManifest(manifest: DepartmentManifest): DepartmentManifest {
  return {
    id: manifest.id,
    projectId: manifest.projectId,
    version: manifest.version,
    code: manifest.code,
    name: manifest.name,
    summary: manifest.summary,
    status: manifest.status,
    operatingMode: manifest.operatingMode,
    goals: [...manifest.goals],
    nonGoals: [...manifest.nonGoals],
    resourceGrants: manifest.resourceGrants.map((grant) => ({
      resourceId: grant.resourceId,
      capabilities: [...grant.capabilities],
    })),
    allowedModelProfileIds: [...manifest.allowedModelProfileIds],
    knowledgeCollectionIds: [...manifest.knowledgeCollectionIds],
    enabledWorkflowIds: [...manifest.enabledWorkflowIds],
    operatorRoleIds: [...manifest.operatorRoleIds],
    modelRouting: {
      primaryModelProfileId: manifest.modelRouting.primaryModelProfileId,
      fallbackModelProfileIds: [...manifest.modelRouting.fallbackModelProfileIds],
      reviewerModelProfileId: manifest.modelRouting.reviewerModelProfileId,
      independentReviewRequired: manifest.modelRouting.independentReviewRequired,
    },
    policy: {
      externalActionMode: manifest.policy.externalActionMode,
      dataEgressMode: manifest.policy.dataEgressMode,
      additionalRequiredApprovalActions: [...manifest.policy.additionalRequiredApprovalActions],
      additionalForbiddenActions: [...manifest.policy.additionalForbiddenActions],
    },
    budget: cloneBudgetValue(manifest.budget),
  };
}

function cloneRawBinding(binding: NormalizedProjectSubjectBinding): ProjectSubjectBinding {
  return {
    id: binding.id,
    projectId: binding.projectId,
    departmentId: binding.departmentId,
    version: binding.version,
    status: binding.status,
    kind: binding.kind,
    subjectId: binding.subjectId,
    requestedResources: binding.requestedResources.map((grant) => ({
      resourceId: grant.resourceId,
      capabilities: [...grant.capabilities],
    })),
    requestedModelProfileIds: [...binding.requestedModelProfileIds],
    requestedKnowledgeCollectionIds: [...binding.requestedKnowledgeCollectionIds],
    requestedBudget: cloneBudgetValue(binding.requestedBudget),
    externalActionMode: binding.externalActionMode,
    dataEgressMode: binding.dataEgressMode,
    additionalRequiredApprovalActions: [...binding.additionalRequiredApprovalActions],
    additionalForbiddenActions: [...binding.additionalForbiddenActions],
  };
}

function projectCanonicalRegistry(
  registry: NormalizedWorkspaceProjectContexts,
): CanonicalWorkspaceRegistryInput {
  return {
    workspaceId: registry.workspaceId,
    projects: registry.projects.map((project) => ({
      projectManifest: cloneRawProjectManifest(project.projectManifest),
      departmentManifests: project.departments.map((department) =>
        cloneRawDepartmentManifest(department.manifest),
      ),
      bindings: project.bindings.map(cloneRawBinding),
    })),
  };
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameBudget(left: ProjectBudgetCeiling, right: ProjectBudgetCeiling): boolean {
  return left.maxConcurrentRuns === right.maxConcurrentRuns
    && left.maxAttemptsPerRun === right.maxAttemptsPerRun
    && left.maxRunMinutes === right.maxRunMinutes
    && left.dailyTokenBudget === right.dailyTokenBudget
    && left.monthlyCostBudgetUsdCents === right.monthlyCostBudgetUsdCents;
}

function sameResources(
  left: readonly ProjectExecutionContextResource[],
  right: readonly ProjectExecutionContextResource[],
): boolean {
  return left.length === right.length && left.every((resource, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && resource.resourceId === candidate.resourceId
      && sameStringArray(resource.capabilities, candidate.capabilities);
  });
}

function snapshotMatchesBinding(
  snapshot: ProjectExecutionContextSnapshot,
  binding: NormalizedProjectSubjectBinding,
): boolean {
  return snapshot.projectId === binding.projectId
    && snapshot.departmentId === binding.departmentId
    && snapshot.subjectId === binding.subjectId
    && snapshot.bindingId === binding.id
    && snapshot.bindingVersion === binding.version
    && snapshot.bindingKind === binding.kind
    && sameResources(snapshot.resources, binding.effectiveResources)
    && sameStringArray(snapshot.modelProfileIds, binding.effectiveModelProfileIds)
    && sameStringArray(snapshot.knowledgeCollectionIds, binding.effectiveKnowledgeCollectionIds)
    && sameBudget(snapshot.budget, binding.effectiveBudget)
    && snapshot.externalActionMode === binding.effectiveExternalActionMode
    && snapshot.dataEgressMode === binding.effectiveDataEgressMode
    && sameStringArray(snapshot.requiredApprovalActions, binding.effectiveRequiredApprovalActions)
    && sameStringArray(snapshot.forbiddenActions, binding.effectiveForbiddenActions);
}

function cloneResources(resources: readonly ProjectExecutionContextResource[]): ProjectExecutionContextResource[] {
  return resources.map((resource) => Object.freeze({ resourceId: resource.resourceId, capabilities: Object.freeze([...resource.capabilities]) }));
}

function deepFreezeProfile(profile: AgentExecutionProfile): AgentExecutionProfile {
  Object.freeze(profile.outputTypes);
  Object.freeze(profile.allowedWorkflowIds);
  Object.freeze(profile.allowedToolIds);
  Object.freeze(profile.allowedModelProfileIds);
  Object.freeze(profile.knowledgeCollectionIds);
  Object.freeze(profile.modelRouting.fallbackModelProfileIds);
  Object.freeze(profile.modelRouting);
  Object.freeze(profile.resources);
  Object.freeze(profile.budget);
  Object.freeze(profile.requiredApprovalActions);
  Object.freeze(profile.forbiddenActions);
  return Object.freeze(profile);
}

function resolveAgentExecutionProfileInternal(input: unknown): AgentExecutionProfileResolutionDecision {
  const envelopeReasons: MutableCatalogReasons = [];
  if (!isRecord(input) || exactUnknownFields(input, ["catalog", "projectId", "agentId", "bindingId"]).length > 0 || !Object.hasOwn(input, "catalog") || !Object.hasOwn(input, "projectId") || !Object.hasOwn(input, "agentId") || !Object.hasOwn(input, "bindingId")) {
    addCatalogReason(envelopeReasons, "invalid_input", "$", "Resolution input must contain only catalog, projectId, agentId, and bindingId.");
    return resolutionDeny(envelopeReasons, catalogDeny(envelopeReasons, null));
  }
  const catalogInput = own(input, "catalog");
  const catalogDecision = evaluateWorkspaceAgentCatalog(catalogInput);
  if (catalogDecision.verdict === "deny" || catalogDecision.normalizedCatalog === null) return resolutionDeny(catalogDecision.reasons, catalogDecision);
  const projectId = stableId(own(input, "projectId"));
  const agentId = stableId(own(input, "agentId"));
  const bindingId = stableId(own(input, "bindingId"));
  if (projectId === null || agentId === null || bindingId === null) {
    addCatalogReason(envelopeReasons, "invalid_input", projectId === null ? "projectId" : agentId === null ? "agentId" : "bindingId", "Resolution IDs must be stable IDs.", { projectId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision);
  }
  const registry = catalogDecision.registryDecision?.normalizedRegistry;
  if (!registry) {
    addCatalogReason(envelopeReasons, "project_not_found", "projectId", `Project ${projectId} was not found.`, { projectId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision);
  }
  const project = registry.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) {
    addCatalogReason(envelopeReasons, "project_not_found", "projectId", `Project ${projectId} was not found.`, { projectId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision);
  }
  const entry = catalogDecision.normalizedCatalog.agents.find((candidate) => candidate.agentManifest.projectId === projectId && candidate.agentManifest.id === agentId);
  if (!entry) {
    addCatalogReason(envelopeReasons, "agent_not_found", "agentId", `Agent ${agentId} was not found in project ${projectId}.`, { projectId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision);
  }
  if (entry.bindingId !== bindingId) {
    addCatalogReason(envelopeReasons, "binding_not_found", "bindingId", `Binding ${bindingId} does not bind Agent ${agentId}.`, { projectId, departmentId: entry.agentManifest.departmentId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision);
  }
  const binding = project.bindings.find((candidate) => candidate.id === bindingId);
  if (!binding || binding.subjectId !== agentId || binding.departmentId !== entry.agentManifest.departmentId || binding.version !== entry.bindingVersion) {
    addCatalogReason(envelopeReasons, "binding_not_found", "bindingId", `Binding ${bindingId} does not match Agent ${agentId}.`, { projectId, departmentId: entry.agentManifest.departmentId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision);
  }
  if (entry.agentManifest.status !== "active") {
    addCatalogReason(envelopeReasons, "agent_not_active", "agentManifest.status", `Agent ${agentId} has status ${entry.agentManifest.status}.`, { projectId, departmentId: entry.agentManifest.departmentId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision);
  }
  if (binding.status !== "active") {
    addCatalogReason(envelopeReasons, "binding_not_active", "binding.status", `Binding ${bindingId} has status ${binding.status}.`, { projectId, departmentId: entry.agentManifest.departmentId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision);
  }
  const canonicalRegistry = projectCanonicalRegistry(registry);
  const contextDecision = resolveProjectExecutionContext({ registry: canonicalRegistry, projectId, bindingId });
  if (contextDecision.verdict === "deny" || contextDecision.snapshot === null) {
    addCatalogReason(envelopeReasons, "context_resolution_denied", "catalog.registry", "Project Execution Context resolution was denied.", { projectId, departmentId: entry.agentManifest.departmentId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision, contextDecision);
  }
  const snapshot = contextDecision.snapshot;
  if (!snapshotMatchesBinding(snapshot, binding)) {
    addCatalogReason(envelopeReasons, "context_resolution_denied", "catalog.registry", "Execution Context does not match the Agent binding.", { projectId, departmentId: entry.agentManifest.departmentId, agentId, bindingId });
    return resolutionDeny(envelopeReasons, catalogDecision, contextDecision);
  }
  const manifest = entry.agentManifest;
  const profile = deepFreezeProfile({
    workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId,
    projectManifestVersion: snapshot.projectManifestVersion,
    departmentId: snapshot.departmentId,
    departmentManifestVersion: snapshot.departmentManifestVersion,
    agentId: manifest.id,
    agentManifestVersion: manifest.version,
    roleCode: manifest.roleCode,
    bindingId: snapshot.bindingId,
    bindingVersion: snapshot.bindingVersion,
    instructionProfileId: manifest.instructionProfileId,
    outputTypes: [...manifest.outputTypes],
    allowedWorkflowIds: [...manifest.allowedWorkflowIds],
    allowedToolIds: [...manifest.allowedToolIds],
    allowedModelProfileIds: [...manifest.allowedModelProfileIds],
    knowledgeCollectionIds: [...manifest.knowledgeCollectionIds],
    modelRouting: {
      primaryModelProfileId: manifest.modelRouting.primaryModelProfileId,
      fallbackModelProfileIds: [...manifest.modelRouting.fallbackModelProfileIds],
      reviewerModelProfileId: manifest.modelRouting.reviewerModelProfileId,
      independentReviewRequired: manifest.modelRouting.independentReviewRequired,
    },
    resources: cloneResources(snapshot.resources),
    budget: { ...snapshot.budget },
    externalActionMode: snapshot.externalActionMode,
    dataEgressMode: snapshot.dataEgressMode,
    requiredApprovalActions: [...entry.effectiveRequiredApprovalActions],
    forbiddenActions: [...entry.effectiveForbiddenActions],
  });
  return { verdict: "allow", reasons: [], catalogDecision, contextDecision, profile };
}

export function resolveAgentExecutionProfile(input: unknown): AgentExecutionProfileResolutionDecision {
  try {
    return resolveAgentExecutionProfileInternal(input);
  } catch {
    const reasons: MutableCatalogReasons = [];
    addCatalogReason(reasons, "invalid_input", "$", "Agent Execution Profile input could not be safely inspected.");
    return resolutionDeny(reasons, catalogDeny(reasons, null));
  }
}
