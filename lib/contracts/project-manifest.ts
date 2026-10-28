export const projectManifestStatuses = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;
export type ProjectManifestStatus = (typeof projectManifestStatuses)[number];

export const projectManifestKinds = [
  "internal_product",
  "client_project",
  "managed_service",
  "experiment",
] as const;
export type ProjectManifestKind = (typeof projectManifestKinds)[number];

export const projectDataClassifications = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type ProjectDataClassification =
  (typeof projectDataClassifications)[number];

export const projectResourceKinds = [
  "local_workspace",
  "code_repository",
  "telegram_channel",
  "instagram_account",
  "website",
  "support_inbox",
  "email_account",
  "crm",
  "analytics",
  "file_storage",
  "custom",
] as const;
export type ProjectResourceKind = (typeof projectResourceKinds)[number];

export const projectResourceStatuses = [
  "configured",
  "connected",
  "disabled",
  "error",
] as const;
export type ProjectResourceStatus = (typeof projectResourceStatuses)[number];

export const projectResourceCapabilities = [
  "read_metadata",
  "read_content",
  "create_draft",
  "propose_change",
  "request_external_action",
] as const;
export type ProjectResourceCapability =
  (typeof projectResourceCapabilities)[number];

export const projectExternalActionModes = [
  "locked",
  "approval_required",
] as const;
export type ProjectExternalActionMode =
  (typeof projectExternalActionModes)[number];

export const projectDataEgressModes = [
  "forbidden",
  "redacted_only",
  "approved_minimum",
] as const;
export type ProjectDataEgressMode = (typeof projectDataEgressModes)[number];

export const projectChildScopeKinds = [
  "department",
  "agent",
  "workflow",
] as const;
export type ProjectChildScopeKind = (typeof projectChildScopeKinds)[number];

export const projectScopeVerdicts = ["allow", "deny"] as const;
export type ProjectScopeVerdict = (typeof projectScopeVerdicts)[number];

export const projectApprovalActions = [
  "code_run",
  "code_publication",
  "content_publication",
  "message_send",
  "customer_contact",
  "data_export",
  "configuration_change",
  "credential_change",
  "production_change",
  "financial_action",
] as const;
export type ProjectApprovalAction = (typeof projectApprovalActions)[number];

export const systemRequiredProjectApprovalActions = Object.freeze([
  ...projectApprovalActions,
] as const);

export const systemForbiddenProjectActions = Object.freeze([
  "Автоматический merge запрещён",
  "Автоматический deploy запрещён",
  "Доступ AI к production secrets запрещён",
  "Прямая запись AI в production database запрещена",
  "Операции с реальными финансовыми или торговыми активами запрещены",
] as const);

export const projectManifestLimits = Object.freeze({
  maxIdLength: 64,
  maxNameLength: 160,
  maxSlugLength: 64,
  maxSummaryLength: 4096,
  maxLocaleLength: 16,
  maxTimeZoneLength: 64,
  maxDataRegionLength: 64,
  maxGoals: 32,
  maxNonGoals: 32,
  maxTags: 32,
  maxResources: 64,
  maxResourceLabelLength: 160,
  maxResourceRefLength: 512,
  maxResourceCapabilities: projectResourceCapabilities.length,
  maxModelProfileIds: 32,
  maxKnowledgeCollectionIds: 64,
  maxUserApprovalActions: 64,
  maxChildAdditionalApprovalActions: 64,
  maxUserForbiddenActions: 64,
  maxTextListItemLength: 1024,
  maxChildResourceGrants: 64,
  maxErrors: 256,
});

export type ProjectResource = Readonly<{
  id: string;
  kind: ProjectResourceKind;
  label: string;
  status: ProjectResourceStatus;
  connectionId: string | null;
  resourceRef: string;
  capabilities: readonly ProjectResourceCapability[];
}>;

export type ProjectPolicy = Readonly<{
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  requiredApprovalActions: readonly string[];
  forbiddenActions: readonly string[];
}>;

export type ProjectBudgetCeiling = Readonly<{
  maxConcurrentRuns: number;
  maxAttemptsPerRun: number;
  maxRunMinutes: number;
  dailyTokenBudget: number;
  monthlyCostBudgetUsdCents: number;
}>;

export type ProjectManifest = Readonly<{
  id: string;
  workspaceId: string;
  version: number;
  name: string;
  slug: string;
  summary: string;
  kind: ProjectManifestKind;
  status: ProjectManifestStatus;
  defaultLocale: string;
  timeZone: string;
  dataRegion: string;
  dataClassification: ProjectDataClassification;
  goals: readonly string[];
  nonGoals: readonly string[];
  tags: readonly string[];
  resources: readonly ProjectResource[];
  allowedModelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  policy: ProjectPolicy;
  budget: ProjectBudgetCeiling;
}>;

export type ProjectManifestValidationErrorCode =
  | "invalid_input"
  | "unknown_field"
  | "required_field"
  | "invalid_type"
  | "invalid_id"
  | "invalid_slug"
  | "invalid_enum"
  | "invalid_integer"
  | "limit_exceeded"
  | "duplicate_resource_id"
  | "empty_capabilities"
  | "secret_material_not_allowed";

export type ProjectManifestValidationError = Readonly<{
  code: ProjectManifestValidationErrorCode;
  path: string;
  message: string;
}>;

export type ProjectManifestValidationResult =
  | Readonly<{ ok: true; value: ProjectManifest }>
  | Readonly<{ ok: false; errors: readonly ProjectManifestValidationError[] }>;

export type ProjectChildResourceRequest = Readonly<{
  resourceId: string;
  capabilities: readonly ProjectResourceCapability[];
}>;

export type NormalizedProjectChildScope = Readonly<{
  scopeKind: ProjectChildScopeKind;
  scopeId: string;
  resources: readonly ProjectChildResourceRequest[];
  modelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  budget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  requiredApprovalActions: readonly string[];
  forbiddenActions: readonly string[];
}>;

export type ProjectChildScopeReasonCode =
  | "invalid_scope_input"
  | "invalid_project_manifest"
  | "project_not_active"
  | "resource_not_found"
  | "resource_unavailable"
  | "capability_not_allowed"
  | "model_profile_not_allowed"
  | "knowledge_collection_not_allowed"
  | "budget_ceiling_exceeded"
  | "external_action_policy_relaxed"
  | "data_egress_policy_relaxed"
  | "required_approval_missing";

export type ProjectChildScopeReason = Readonly<{
  code: ProjectChildScopeReasonCode;
  path: string;
  message: string;
}>;

export type ProjectChildScopeDecision = Readonly<{
  verdict: ProjectScopeVerdict;
  scopeKind: ProjectChildScopeKind | null;
  scopeId: string | null;
  reasons: readonly ProjectChildScopeReason[];
  normalizedScope: NormalizedProjectChildScope | null;
}>;

type MutableManifestErrors = ProjectManifestValidationError[];
type MutableScopeReasons = ProjectChildScopeReason[];

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const safeSlugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const nonNewlineControlCharacterPattern = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const credentialParameterPattern =
  /(?:^|[?&#;\s])(?:token|password|secret|api_key|api-key|apikey|x-api-key|access[_-]token|refresh[_-]token|id[_-]token|bot[_-]token|auth[_-]token|client[_-]secret|webhook[_-]secret|private[_-]key)=/iu;
const urlUserInfoPattern = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/iu;
const bearerPattern = /bearer\s+/iu;
const privateKeyPattern = /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/iu;

function includesValue<const Values extends readonly string[]>(
  values: Values,
  input: unknown,
): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input);
}

export function isProjectManifestStatus(
  input: unknown,
): input is ProjectManifestStatus {
  return includesValue(projectManifestStatuses, input);
}
export function parseProjectManifestStatus(
  input: unknown,
): ProjectManifestStatus | null {
  return isProjectManifestStatus(input) ? input : null;
}
export function isProjectManifestKind(
  input: unknown,
): input is ProjectManifestKind {
  return includesValue(projectManifestKinds, input);
}
export function parseProjectManifestKind(
  input: unknown,
): ProjectManifestKind | null {
  return isProjectManifestKind(input) ? input : null;
}
export function isProjectDataClassification(
  input: unknown,
): input is ProjectDataClassification {
  return includesValue(projectDataClassifications, input);
}
export function parseProjectDataClassification(
  input: unknown,
): ProjectDataClassification | null {
  return isProjectDataClassification(input) ? input : null;
}
export function isProjectResourceKind(
  input: unknown,
): input is ProjectResourceKind {
  return includesValue(projectResourceKinds, input);
}
export function parseProjectResourceKind(
  input: unknown,
): ProjectResourceKind | null {
  return isProjectResourceKind(input) ? input : null;
}
export function isProjectResourceStatus(
  input: unknown,
): input is ProjectResourceStatus {
  return includesValue(projectResourceStatuses, input);
}
export function parseProjectResourceStatus(
  input: unknown,
): ProjectResourceStatus | null {
  return isProjectResourceStatus(input) ? input : null;
}
export function isProjectResourceCapability(
  input: unknown,
): input is ProjectResourceCapability {
  return includesValue(projectResourceCapabilities, input);
}
export function parseProjectResourceCapability(
  input: unknown,
): ProjectResourceCapability | null {
  return isProjectResourceCapability(input) ? input : null;
}
export function isProjectExternalActionMode(
  input: unknown,
): input is ProjectExternalActionMode {
  return includesValue(projectExternalActionModes, input);
}
export function parseProjectExternalActionMode(
  input: unknown,
): ProjectExternalActionMode | null {
  return isProjectExternalActionMode(input) ? input : null;
}
export function isProjectDataEgressMode(
  input: unknown,
): input is ProjectDataEgressMode {
  return includesValue(projectDataEgressModes, input);
}
export function parseProjectDataEgressMode(
  input: unknown,
): ProjectDataEgressMode | null {
  return isProjectDataEgressMode(input) ? input : null;
}
export function isProjectChildScopeKind(
  input: unknown,
): input is ProjectChildScopeKind {
  return includesValue(projectChildScopeKinds, input);
}
export function parseProjectChildScopeKind(
  input: unknown,
): ProjectChildScopeKind | null {
  return isProjectChildScopeKind(input) ? input : null;
}
export function isProjectScopeVerdict(
  input: unknown,
): input is ProjectScopeVerdict {
  return includesValue(projectScopeVerdicts, input);
}
export function parseProjectScopeVerdict(
  input: unknown,
): ProjectScopeVerdict | null {
  return isProjectScopeVerdict(input) ? input : null;
}
export function isProjectApprovalAction(
  input: unknown,
): input is ProjectApprovalAction {
  return includesValue(projectApprovalActions, input);
}
export function parseProjectApprovalAction(
  input: unknown,
): ProjectApprovalAction | null {
  return isProjectApprovalAction(input) ? input : null;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function addManifestError(
  errors: MutableManifestErrors,
  code: ProjectManifestValidationErrorCode,
  path: string,
  message: string,
): void {
  if (errors.length < projectManifestLimits.maxErrors) {
    errors.push({ code, path, message });
  }
}

function addScopeReason(
  reasons: MutableScopeReasons,
  code: ProjectChildScopeReasonCode,
  path: string,
  message: string,
): void {
  if (reasons.length < projectManifestLimits.maxErrors) {
    reasons.push({ code, path, message });
  }
}

function normalizeText(input: string, multiline = false): string {
  return (multiline ? input.replace(/\r\n?/gu, "\n") : input).trim();
}

function validateKnownFields(
  input: Record<string, unknown>,
  allowedFields: readonly string[],
  path: string,
  errors: MutableManifestErrors,
): void {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(input).sort(compareStrings)) {
    if (!allowed.has(key)) {
      addManifestError(
        errors,
        "unknown_field",
        path === "$" ? key : `${path}.${key}`,
        `Unknown field ${key} is not allowed.`,
      );
    }
  }
}

function validateRequiredFields(
  input: Record<string, unknown>,
  requiredFields: readonly string[],
  path: string,
  errors: MutableManifestErrors,
): void {
  for (const field of requiredFields) {
    if (!Object.hasOwn(input, field)) {
      addManifestError(
        errors,
        "required_field",
        path === "$" ? field : `${path}.${field}`,
        `${field} is required.`,
      );
    }
  }
}

function normalizeRequiredString(
  input: unknown,
  path: string,
  maxLength: number,
  errors: MutableManifestErrors,
  multiline = false,
): string | null {
  if (input === null || input === undefined) {
    addManifestError(errors, "required_field", path, `${path} is required.`);
    return null;
  }
  if (typeof input !== "string") {
    addManifestError(errors, "invalid_type", path, `${path} must be a string.`);
    return null;
  }
  const value = normalizeText(input, multiline);
  if (value.length === 0) {
    addManifestError(errors, "required_field", path, `${path} must not be empty.`);
    return null;
  }
  if (value.length > maxLength) {
    addManifestError(
      errors,
      "limit_exceeded",
      path,
      `${path} must be at most ${maxLength} characters.`,
    );
    return null;
  }
  const invalidControl = multiline
    ? nonNewlineControlCharacterPattern.test(value)
    : controlCharacterPattern.test(value);
  if (invalidControl) {
    addManifestError(errors, "invalid_type", path, `${path} contains a control character.`);
    return null;
  }
  return value;
}

function normalizeId(
  input: unknown,
  path: string,
  errors: MutableManifestErrors,
  nullable = false,
): string | null {
  if (input === null && nullable) {
    return null;
  }
  if (typeof input !== "string") {
    addManifestError(errors, "invalid_id", path, `${path} must be a stable ID.`);
    return null;
  }
  const value = input.trim();
  if (!safeIdPattern.test(value)) {
    addManifestError(
      errors,
      "invalid_id",
      path,
      `${path} must match ^[a-z0-9][a-z0-9._-]{0,63}$.`,
    );
    return null;
  }
  return value;
}

function normalizeEnum<Value extends string>(
  input: unknown,
  values: readonly Value[],
  path: string,
  errors: MutableManifestErrors,
): Value | null {
  if (typeof input !== "string") {
    addManifestError(errors, "invalid_enum", path, `${path} must be a known enum value.`);
    return null;
  }
  const normalized = input.trim();
  const value = values.find((candidate) => candidate === normalized) ?? null;
  if (value === null) {
    addManifestError(errors, "invalid_enum", path, `${path} contains an unknown enum value.`);
  }
  return value;
}

function normalizeTextList(
  input: unknown,
  path: string,
  maxItems: number,
  errors: MutableManifestErrors,
): readonly string[] | null {
  if (!Array.isArray(input)) {
    addManifestError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length > maxItems) {
    addManifestError(
      errors,
      "limit_exceeded",
      path,
      `${path} must contain at most ${maxItems} items.`,
    );
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.slice(0, maxItems).entries()) {
    if (typeof item !== "string") {
      addManifestError(errors, "invalid_type", `${path}[${index}]`, `${path}[${index}] must be a string.`);
      continue;
    }
    const value = normalizeText(item, true);
    if (value.length === 0) {
      continue;
    }
    if (value.length > projectManifestLimits.maxTextListItemLength) {
      addManifestError(
        errors,
        "limit_exceeded",
        `${path}[${index}]`,
        `${path}[${index}] is too long.`,
      );
      continue;
    }
    if (nonNewlineControlCharacterPattern.test(value)) {
      addManifestError(
        errors,
        "invalid_type",
        `${path}[${index}]`,
        `${path}[${index}] contains a control character.`,
      );
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

function normalizePolicyTextList(
  input: unknown,
  path: string,
  maxUserItems: number,
  systemValues: readonly string[],
  errors: MutableManifestErrors,
): readonly string[] | null {
  if (!Array.isArray(input)) {
    addManifestError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  const maxInputItems = maxUserItems + systemValues.length;
  if (input.length > maxInputItems) {
    addManifestError(
      errors,
      "limit_exceeded",
      path,
      `${path} must contain at most ${maxUserItems} user values and ${systemValues.length} canonical system values.`,
    );
  }
  const canonicalSystemValues = new Set(systemValues);
  const seenSystemInputs = new Set<string>();
  const seen = new Set<string>();
  const values: string[] = [];
  let userItemCount = 0;
  for (const [index, item] of input.slice(0, maxInputItems).entries()) {
    if (typeof item !== "string") {
      addManifestError(errors, "invalid_type", `${path}[${index}]`, `${path}[${index}] must be a string.`);
      continue;
    }
    const value = normalizeText(item, true);
    if (value.length === 0) continue;
    if (value.length > projectManifestLimits.maxTextListItemLength) {
      addManifestError(errors, "limit_exceeded", `${path}[${index}]`, `${path}[${index}] is too long.`);
      continue;
    }
    if (nonNewlineControlCharacterPattern.test(value)) {
      addManifestError(errors, "invalid_type", `${path}[${index}]`, `${path}[${index}] contains a control character.`);
      continue;
    }
    if (canonicalSystemValues.has(value) && !seenSystemInputs.has(value)) {
      seenSystemInputs.add(value);
    } else {
      userItemCount += 1;
    }
    if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  if (userItemCount > maxUserItems) {
    addManifestError(
      errors,
      "limit_exceeded",
      path,
      `${path} must contain at most ${maxUserItems} user values.`,
    );
  }
  return values;
}

function normalizeIdList(
  input: unknown,
  path: string,
  maxItems: number,
  errors: MutableManifestErrors,
): readonly string[] | null {
  if (!Array.isArray(input)) {
    addManifestError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length > maxItems) {
    addManifestError(errors, "limit_exceeded", path, `${path} must contain at most ${maxItems} items.`);
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.slice(0, maxItems).entries()) {
    if (typeof item === "string" && item.trim().length === 0) {
      continue;
    }
    const value = normalizeId(item, `${path}[${index}]`, errors);
    if (value !== null && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

function normalizeResourceRef(
  input: unknown,
  path: string,
  errors: MutableManifestErrors,
): string | null {
  if (typeof input === "string" && controlCharacterPattern.test(input)) {
    addManifestError(
      errors,
      "secret_material_not_allowed",
      path,
      `${path} contains a control character and is not allowed.`,
    );
    return null;
  }
  const value = normalizeRequiredString(
    input,
    path,
    projectManifestLimits.maxResourceRefLength,
    errors,
  );
  if (value === null) {
    return null;
  }
  if (
    controlCharacterPattern.test(value) ||
    urlUserInfoPattern.test(value) ||
    credentialParameterPattern.test(value) ||
    bearerPattern.test(value) ||
    privateKeyPattern.test(value) ||
    value.includes("$(") ||
    value.includes("`")
  ) {
    addManifestError(
      errors,
      "secret_material_not_allowed",
      path,
      `${path} contains credential-like or executable material and is not allowed.`,
    );
    return null;
  }
  return value;
}

function normalizeCapabilities(
  input: unknown,
  path: string,
  errors: MutableManifestErrors,
): readonly ProjectResourceCapability[] | null {
  if (!Array.isArray(input)) {
    addManifestError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length === 0) {
    addManifestError(errors, "empty_capabilities", path, `${path} must not be empty.`);
    return null;
  }
  if (input.length > projectManifestLimits.maxResourceCapabilities) {
    addManifestError(errors, "limit_exceeded", path, `${path} contains too many capabilities.`);
  }
  const values: ProjectResourceCapability[] = [];
  const seen = new Set<ProjectResourceCapability>();
  for (const [index, item] of input
    .slice(0, projectManifestLimits.maxResourceCapabilities)
    .entries()) {
    const value = normalizeEnum(
      item,
      projectResourceCapabilities,
      `${path}[${index}]`,
      errors,
    );
    if (value !== null && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  if (values.length === 0) {
    addManifestError(errors, "empty_capabilities", path, `${path} must contain a valid capability.`);
  }
  return values;
}

function normalizeResource(
  input: unknown,
  index: number,
  errors: MutableManifestErrors,
): ProjectResource | null {
  const path = `resources[${index}]`;
  if (!isRecord(input)) {
    addManifestError(errors, "invalid_type", path, `${path} must be an object.`);
    return null;
  }
  validateKnownFields(
    input,
    ["id", "kind", "label", "status", "connectionId", "resourceRef", "capabilities"],
    path,
    errors,
  );
  validateRequiredFields(
    input,
    ["id", "kind", "label", "status", "connectionId", "resourceRef", "capabilities"],
    path,
    errors,
  );
  const id = normalizeId(input.id, `${path}.id`, errors);
  const kind = normalizeEnum(input.kind, projectResourceKinds, `${path}.kind`, errors);
  const label = normalizeRequiredString(
    input.label,
    `${path}.label`,
    projectManifestLimits.maxResourceLabelLength,
    errors,
  );
  const status = normalizeEnum(
    input.status,
    projectResourceStatuses,
    `${path}.status`,
    errors,
  );
  const connectionId = normalizeId(input.connectionId, `${path}.connectionId`, errors, true);
  const resourceRef = normalizeResourceRef(input.resourceRef, `${path}.resourceRef`, errors);
  const capabilities = normalizeCapabilities(input.capabilities, `${path}.capabilities`, errors);
  return id === null ||
    kind === null ||
    label === null ||
    status === null ||
    resourceRef === null ||
    capabilities === null
    ? null
    : { id, kind, label, status, connectionId, resourceRef, capabilities };
}

function normalizeResources(
  input: unknown,
  errors: MutableManifestErrors,
): readonly ProjectResource[] | null {
  if (!Array.isArray(input)) {
    addManifestError(errors, "invalid_type", "resources", "resources must be an array.");
    return null;
  }
  if (input.length > projectManifestLimits.maxResources) {
    addManifestError(errors, "limit_exceeded", "resources", "resources exceeds the project limit.");
  }
  const resources: ProjectResource[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.slice(0, projectManifestLimits.maxResources).entries()) {
    const resource = normalizeResource(item, index, errors);
    if (resource === null) {
      continue;
    }
    if (seen.has(resource.id)) {
      addManifestError(
        errors,
        "duplicate_resource_id",
        `resources[${index}].id`,
        `Resource ID ${resource.id} is duplicated.`,
      );
    }
    seen.add(resource.id);
    resources.push(resource);
  }
  return resources;
}

const budgetRanges = {
  maxConcurrentRuns: [1, 16],
  maxAttemptsPerRun: [1, 3],
  maxRunMinutes: [1, 240],
  dailyTokenBudget: [0, 1_000_000_000],
  monthlyCostBudgetUsdCents: [0, 100_000_000],
} as const satisfies Readonly<Record<keyof ProjectBudgetCeiling, readonly [number, number]>>;

function normalizeBudget(
  input: unknown,
  path: string,
  errors: MutableManifestErrors,
): ProjectBudgetCeiling | null {
  if (!isRecord(input)) {
    addManifestError(errors, "invalid_type", path, `${path} must be an object.`);
    return null;
  }
  validateKnownFields(input, Object.keys(budgetRanges), path, errors);
  validateRequiredFields(input, Object.keys(budgetRanges), path, errors);
  const values: Partial<Record<keyof ProjectBudgetCeiling, number>> = {};
  for (const [field, [minimum, maximum]] of Object.entries(budgetRanges) as Array<
    [keyof ProjectBudgetCeiling, readonly [number, number]]
  >) {
    const value = input[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      addManifestError(
        errors,
        "invalid_integer",
        `${path}.${field}`,
        `${path}.${field} must be a safe integer from ${minimum} to ${maximum}.`,
      );
    } else {
      values[field] = value;
    }
  }
  return Object.keys(values).length === Object.keys(budgetRanges).length
    ? (values as ProjectBudgetCeiling)
    : null;
}

function prependSystemValues(
  systemValues: readonly string[],
  userValues: readonly string[],
): readonly string[] {
  const result = [...systemValues];
  const seen = new Set(systemValues);
  for (const value of userValues) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizePolicy(
  input: unknown,
  errors: MutableManifestErrors,
): ProjectPolicy | null {
  if (!isRecord(input)) {
    addManifestError(errors, "invalid_type", "policy", "policy must be an object.");
    return null;
  }
  validateKnownFields(
    input,
    ["externalActionMode", "dataEgressMode", "requiredApprovalActions", "forbiddenActions"],
    "policy",
    errors,
  );
  validateRequiredFields(
    input,
    ["externalActionMode", "dataEgressMode", "requiredApprovalActions", "forbiddenActions"],
    "policy",
    errors,
  );
  const externalActionMode = normalizeEnum(
    input.externalActionMode,
    projectExternalActionModes,
    "policy.externalActionMode",
    errors,
  );
  const dataEgressMode = normalizeEnum(
    input.dataEgressMode,
    projectDataEgressModes,
    "policy.dataEgressMode",
    errors,
  );
  const requiredApprovalActions = normalizePolicyTextList(
    input.requiredApprovalActions,
    "policy.requiredApprovalActions",
    projectManifestLimits.maxUserApprovalActions,
    systemRequiredProjectApprovalActions,
    errors,
  );
  const forbiddenActions = normalizePolicyTextList(
    input.forbiddenActions,
    "policy.forbiddenActions",
    projectManifestLimits.maxUserForbiddenActions,
    systemForbiddenProjectActions,
    errors,
  );
  return externalActionMode === null ||
    dataEgressMode === null ||
    requiredApprovalActions === null ||
    forbiddenActions === null
    ? null
    : {
        externalActionMode,
        dataEgressMode,
        requiredApprovalActions: prependSystemValues(
          systemRequiredProjectApprovalActions,
          requiredApprovalActions,
        ),
        forbiddenActions: prependSystemValues(systemForbiddenProjectActions, forbiddenActions),
      };
}

function validateAndNormalizeProjectManifestInternal(
  input: unknown,
): ProjectManifestValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ code: "invalid_input", path: "$", message: "ProjectManifest input must be an object." }],
    };
  }
  const errors: MutableManifestErrors = [];
  validateKnownFields(
    input,
    [
      "id",
      "workspaceId",
      "version",
      "name",
      "slug",
      "summary",
      "kind",
      "status",
      "defaultLocale",
      "timeZone",
      "dataRegion",
      "dataClassification",
      "goals",
      "nonGoals",
      "tags",
      "resources",
      "allowedModelProfileIds",
      "knowledgeCollectionIds",
      "policy",
      "budget",
    ],
    "$",
    errors,
  );
  validateRequiredFields(
    input,
    [
      "id",
      "workspaceId",
      "version",
      "name",
      "slug",
      "summary",
      "kind",
      "status",
      "defaultLocale",
      "timeZone",
      "dataRegion",
      "dataClassification",
      "goals",
      "nonGoals",
      "tags",
      "resources",
      "allowedModelProfileIds",
      "knowledgeCollectionIds",
      "policy",
      "budget",
    ],
    "$",
    errors,
  );
  const id = normalizeId(input.id, "id", errors);
  const workspaceId = normalizeId(input.workspaceId, "workspaceId", errors);
  let version: number | null = null;
  if (typeof input.version !== "number" || !Number.isSafeInteger(input.version) || input.version < 1) {
    addManifestError(errors, "invalid_integer", "version", "version must be a positive safe integer.");
  } else {
    version = input.version;
  }
  const name = normalizeRequiredString(input.name, "name", projectManifestLimits.maxNameLength, errors);
  let slug: string | null = null;
  if (typeof input.slug !== "string" || !safeSlugPattern.test(input.slug.trim())) {
    addManifestError(errors, "invalid_slug", "slug", "slug must match ^[a-z0-9][a-z0-9-]{0,63}$.");
  } else {
    slug = input.slug.trim();
  }
  const summary = normalizeRequiredString(
    input.summary,
    "summary",
    projectManifestLimits.maxSummaryLength,
    errors,
    true,
  );
  const kind = normalizeEnum(input.kind, projectManifestKinds, "kind", errors);
  const status = normalizeEnum(input.status, projectManifestStatuses, "status", errors);
  const defaultLocale = normalizeRequiredString(
    input.defaultLocale,
    "defaultLocale",
    projectManifestLimits.maxLocaleLength,
    errors,
  );
  const timeZone = normalizeRequiredString(
    input.timeZone,
    "timeZone",
    projectManifestLimits.maxTimeZoneLength,
    errors,
  );
  const dataRegion = normalizeRequiredString(
    input.dataRegion,
    "dataRegion",
    projectManifestLimits.maxDataRegionLength,
    errors,
  );
  const dataClassification = normalizeEnum(
    input.dataClassification,
    projectDataClassifications,
    "dataClassification",
    errors,
  );
  const goals = normalizeTextList(input.goals, "goals", projectManifestLimits.maxGoals, errors);
  const nonGoals = normalizeTextList(
    input.nonGoals,
    "nonGoals",
    projectManifestLimits.maxNonGoals,
    errors,
  );
  const tags = normalizeTextList(input.tags, "tags", projectManifestLimits.maxTags, errors);
  const resources = normalizeResources(input.resources, errors);
  const allowedModelProfileIds = normalizeIdList(
    input.allowedModelProfileIds,
    "allowedModelProfileIds",
    projectManifestLimits.maxModelProfileIds,
    errors,
  );
  const knowledgeCollectionIds = normalizeIdList(
    input.knowledgeCollectionIds,
    "knowledgeCollectionIds",
    projectManifestLimits.maxKnowledgeCollectionIds,
    errors,
  );
  const policy = normalizePolicy(input.policy, errors);
  const budget = normalizeBudget(input.budget, "budget", errors);

  if (
    errors.length > 0 ||
    id === null ||
    workspaceId === null ||
    version === null ||
    name === null ||
    slug === null ||
    summary === null ||
    kind === null ||
    status === null ||
    defaultLocale === null ||
    timeZone === null ||
    dataRegion === null ||
    dataClassification === null ||
    goals === null ||
    nonGoals === null ||
    tags === null ||
    resources === null ||
    allowedModelProfileIds === null ||
    knowledgeCollectionIds === null ||
    policy === null ||
    budget === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      id,
      workspaceId,
      version,
      name,
      slug,
      summary,
      kind,
      status,
      defaultLocale,
      timeZone,
      dataRegion,
      dataClassification,
      goals,
      nonGoals,
      tags,
      resources,
      allowedModelProfileIds,
      knowledgeCollectionIds,
      policy,
      budget,
    },
  };
}

export function validateAndNormalizeProjectManifest(
  input: unknown,
): ProjectManifestValidationResult {
  try {
    return validateAndNormalizeProjectManifestInternal(input);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_input",
          path: "$",
          message: "ProjectManifest input could not be safely inspected.",
        },
      ],
    };
  }
}

function scopeDeny(
  scopeKind: ProjectChildScopeKind | null,
  scopeId: string | null,
  reasons: readonly ProjectChildScopeReason[],
): ProjectChildScopeDecision {
  return { verdict: "deny", scopeKind, scopeId, reasons: [...reasons], normalizedScope: null };
}

function parseScopeId(input: unknown, path: string, reasons: MutableScopeReasons): string | null {
  if (typeof input !== "string" || !safeIdPattern.test(input.trim())) {
    addScopeReason(reasons, "invalid_scope_input", path, `${path} must be a stable ID.`);
    return null;
  }
  return input.trim();
}

const scopeCollectionSortLimits = Object.freeze({
  maxDepth: 16,
  maxInspectedEntries: 1024,
  maxKeyLength: 16_384,
  maxCombinedKeyLength: 262_144,
});

type ScopeCollectionSortKeyFailure = Readonly<{
  ok: false;
  limit: "depth" | "entries" | "key_length";
  message: string;
}>;

type ScopeCollectionSortKeyResult =
  | Readonly<{ ok: true; key: string }>
  | ScopeCollectionSortKeyFailure;

type ScopeCollectionSortState = {
  inspectedEntries: number;
  readonly seen: WeakSet<object>;
};

function scopeCollectionSortFailure(
  limit: ScopeCollectionSortKeyFailure["limit"],
  message: string,
): ScopeCollectionSortKeyFailure {
  return { ok: false, limit, message };
}

function buildScopeCollectionSortKey(
  prefix: string,
  values: readonly string[],
  suffix: string,
): ScopeCollectionSortKeyResult {
  let length = prefix.length + suffix.length;
  for (const value of values) {
    length += String(value.length).length + 1 + value.length;
    if (length > scopeCollectionSortLimits.maxKeyLength) {
      return scopeCollectionSortFailure(
        "key_length",
        "Canonical Set sort key exceeds its length limit.",
      );
    }
  }
  return {
    ok: true,
    key: `${prefix}${values.map((value) => `${value.length}:${value}`).join("")}${suffix}`,
  };
}

function scopeCollectionSortKey(
  input: unknown,
  state: ScopeCollectionSortState = {
    inspectedEntries: 0,
    seen: new WeakSet<object>(),
  },
  depth = 0,
): ScopeCollectionSortKeyResult {
  if (depth > scopeCollectionSortLimits.maxDepth) {
    return scopeCollectionSortFailure(
      "depth",
      "Canonical Set inspection exceeds its nesting-depth limit.",
    );
  }
  if (input === null) {
    return { ok: true, key: "null" };
  }
  if (typeof input !== "object") {
    const value = String(input);
    return buildScopeCollectionSortKey(`${typeof input}:`, [value], "");
  }
  if (state.seen.has(input)) {
    return { ok: true, key: "object:<cycle>" };
  }
  state.seen.add(input);
  if (Array.isArray(input)) {
    if (input.length > scopeCollectionSortLimits.maxInspectedEntries) {
      return scopeCollectionSortFailure(
        "entries",
        "Canonical Set inspection exceeds its field/element limit.",
      );
    }
    const values: string[] = [];
    for (const item of input) {
      state.inspectedEntries += 1;
      if (state.inspectedEntries > scopeCollectionSortLimits.maxInspectedEntries) {
        return scopeCollectionSortFailure(
          "entries",
          "Canonical Set inspection exceeds its field/element limit.",
        );
      }
      const result = scopeCollectionSortKey(item, state, depth + 1);
      if (!result.ok) {
        return result;
      }
      values.push(result.key);
    }
    return buildScopeCollectionSortKey("array:[", values, "]");
  }
  if (input instanceof Set) {
    if (input.size > scopeCollectionSortLimits.maxInspectedEntries) {
      return scopeCollectionSortFailure(
        "entries",
        "Canonical Set inspection exceeds its field/element limit.",
      );
    }
    const values: string[] = [];
    for (const item of input) {
      state.inspectedEntries += 1;
      if (state.inspectedEntries > scopeCollectionSortLimits.maxInspectedEntries) {
        return scopeCollectionSortFailure(
          "entries",
          "Canonical Set inspection exceeds its field/element limit.",
        );
      }
      const result = scopeCollectionSortKey(item, state, depth + 1);
      if (!result.ok) {
        return result;
      }
      values.push(result.key);
    }
    values.sort(compareStrings);
    return buildScopeCollectionSortKey("set:[", values, "]");
  }
  const record = input as Record<string, unknown>;
  const fields: string[] = [];
  let enumeratedFields = 0;
  for (const field in record) {
    enumeratedFields += 1;
    if (enumeratedFields > scopeCollectionSortLimits.maxInspectedEntries) {
      return scopeCollectionSortFailure(
        "entries",
        "Canonical Set inspection exceeds its field/element limit.",
      );
    }
    if (Object.hasOwn(record, field)) {
      fields.push(field);
    }
  }
  fields.sort(compareStrings);
  const values: string[] = [];
  for (const field of fields) {
    state.inspectedEntries += 1;
    if (state.inspectedEntries > scopeCollectionSortLimits.maxInspectedEntries) {
      return scopeCollectionSortFailure(
        "entries",
        "Canonical Set inspection exceeds its field/element limit.",
      );
    }
    const result = scopeCollectionSortKey(record[field], state, depth + 1);
    if (!result.ok) {
      return result;
    }
    const fieldResult = buildScopeCollectionSortKey("field:", [field, result.key], "");
    if (!fieldResult.ok) {
      return fieldResult;
    }
    values.push(fieldResult.key);
  }
  return buildScopeCollectionSortKey("object:{", values, "}");
}

function collectionValues(
  input: unknown,
  path: string,
  maxItems: number,
  reasons: MutableScopeReasons,
): readonly unknown[] | null {
  let values: readonly unknown[];
  if (Array.isArray(input)) {
    values = [...input];
  } else if (input instanceof Set) {
    if (input.size > maxItems) {
      addScopeReason(reasons, "invalid_scope_input", path, `${path} exceeds its collection limit.`);
      return null;
    }
    const keyedValues: Array<Readonly<{ key: string; value: unknown }>> = [];
    const failures: ScopeCollectionSortKeyFailure[] = [];
    let totalKeyLength = 0;
    let combinedKeyLimitExceeded = false;
    for (const value of input.values()) {
      const result = scopeCollectionSortKey(value);
      if (!result.ok) {
        failures.push(result);
        continue;
      }
      if (!combinedKeyLimitExceeded) {
        totalKeyLength += result.key.length;
        if (totalKeyLength > scopeCollectionSortLimits.maxCombinedKeyLength) {
          combinedKeyLimitExceeded = true;
          keyedValues.length = 0;
        } else {
          keyedValues.push({ key: result.key, value });
        }
      }
    }
    if (failures.length > 0) {
      const failure = failures.sort((left, right) =>
        compareStrings(`${left.limit}:${left.message}`, `${right.limit}:${right.message}`),
      )[0];
      addScopeReason(reasons, "invalid_scope_input", path, `${path}: ${failure.message}`);
      return null;
    }
    if (combinedKeyLimitExceeded) {
      addScopeReason(
        reasons,
        "invalid_scope_input",
        path,
        `${path}: Canonical Set sort keys exceed their combined length limit.`,
      );
      return null;
    }
    keyedValues.sort((left, right) => compareStrings(left.key, right.key));
    values = keyedValues.map(({ value }) => value);
  } else {
    addScopeReason(reasons, "invalid_scope_input", path, `${path} must be an array or Set.`);
    return null;
  }
  if (values.length > maxItems) {
    addScopeReason(reasons, "invalid_scope_input", path, `${path} exceeds its collection limit.`);
    return values.slice(0, maxItems);
  }
  return values;
}

type ParsedScopeString = Readonly<{ value: string; path: string }>;

function parseScopeStringCollection(
  input: unknown,
  path: string,
  maxItems: number,
  reasons: MutableScopeReasons,
): readonly ParsedScopeString[] | null {
  const items = collectionValues(input, path, maxItems, reasons);
  if (items === null) {
    return null;
  }
  const values = new Map<string, string>();
  for (const [index, item] of items.entries()) {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "string" || item.trim().length === 0) {
      addScopeReason(reasons, "invalid_scope_input", itemPath, `${itemPath} must be a string.`);
    } else if (!values.has(item.trim())) {
      values.set(item.trim(), itemPath);
    }
  }
  return [...values]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([value, itemPath]) => ({ value, path: itemPath }));
}

function parseScopeBudget(
  input: unknown,
  parent: ProjectBudgetCeiling,
  reasons: MutableScopeReasons,
): ProjectBudgetCeiling | null {
  if (!isRecord(input)) {
    addScopeReason(reasons, "invalid_scope_input", "requestedBudget", "requestedBudget must be an object.");
    return null;
  }
  for (const key of Object.keys(input).sort(compareStrings)) {
    if (!(key in budgetRanges)) {
      addScopeReason(reasons, "invalid_scope_input", `requestedBudget.${key}`, `Unknown budget field ${key}.`);
    }
  }
  const values: Partial<Record<keyof ProjectBudgetCeiling, number>> = {};
  for (const field of Object.keys(budgetRanges) as Array<keyof ProjectBudgetCeiling>) {
    const value = input[field];
    const [minimum, maximum] = budgetRanges[field];
    const isInvalidValue =
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum;
    if (isInvalidValue) {
      addScopeReason(
        reasons,
        "invalid_scope_input",
        `requestedBudget.${field}`,
        `${field} must be a safe integer from ${minimum} to ${maximum}.`,
      );
    } else {
      values[field] = value;
    }
    if (typeof value === "number" && Number.isSafeInteger(value) && value > parent[field]) {
      addScopeReason(
        reasons,
        "budget_ceiling_exceeded",
        `requestedBudget.${field}`,
        `${field} exceeds the ProjectManifest ceiling.`,
      );
    }
  }
  return Object.keys(values).length === Object.keys(budgetRanges).length
    ? (values as ProjectBudgetCeiling)
    : null;
}

type ParsedScopeCapability = Readonly<{
  value: ProjectResourceCapability;
  path: string;
}>;

type ParsedScopeResource = Readonly<{
  resourceIdPath: string;
  capabilities: readonly ParsedScopeCapability[];
}>;

function parseScopeResources(
  input: unknown,
  reasons: MutableScopeReasons,
): ReadonlyMap<string, ParsedScopeResource> | null {
  const items = collectionValues(
    input,
    "requestedResources",
    projectManifestLimits.maxChildResourceGrants,
    reasons,
  );
  if (items === null) {
    return null;
  }
  const result = new Map<string, ParsedScopeResource>();
  for (const [index, item] of items.entries()) {
    const path = `requestedResources[${index}]`;
    if (!isRecord(item)) {
      addScopeReason(reasons, "invalid_scope_input", path, `${path} must be an object.`);
      continue;
    }
    for (const key of Object.keys(item).sort(compareStrings)) {
      if (key !== "resourceId" && key !== "capabilities") {
        addScopeReason(reasons, "invalid_scope_input", `${path}.${key}`, `Unknown requested resource field ${key}.`);
      }
    }
    const resourceId = parseScopeId(item.resourceId, `${path}.resourceId`, reasons);
    const capabilityItems = collectionValues(
      item.capabilities,
      `${path}.capabilities`,
      projectManifestLimits.maxResourceCapabilities,
      reasons,
    );
    const capabilities = new Map<ProjectResourceCapability, string>();
    if (capabilityItems !== null) {
      if (capabilityItems.length === 0) {
        addScopeReason(reasons, "invalid_scope_input", `${path}.capabilities`, "Requested capabilities must not be empty.");
      }
      for (const [capabilityIndex, capabilityInput] of capabilityItems.entries()) {
        const capability = parseProjectResourceCapability(capabilityInput);
        if (capability === null) {
          addScopeReason(
            reasons,
            "invalid_scope_input",
            `${path}.capabilities[${capabilityIndex}]`,
            "Unknown resource capability.",
          );
        } else if (!capabilities.has(capability)) {
          capabilities.set(capability, `${path}.capabilities[${capabilityIndex}]`);
        }
      }
    }
    if (resourceId !== null) {
      if (result.has(resourceId)) {
        addScopeReason(reasons, "invalid_scope_input", `${path}.resourceId`, `Resource ${resourceId} is requested more than once.`);
      } else {
        result.set(resourceId, {
          resourceIdPath: `${path}.resourceId`,
          capabilities: projectResourceCapabilities.flatMap((capability) => {
            const capabilityPath = capabilities.get(capability);
            return capabilityPath === undefined
              ? []
              : [{ value: capability, path: capabilityPath }];
          }),
        });
      }
    }
  }
  return result;
}

function parseScopeMode<Value extends string>(
  input: unknown,
  values: readonly Value[],
  path: string,
  reasons: MutableScopeReasons,
): Value | null {
  const value = typeof input === "string" ? values.find((item) => item === input.trim()) ?? null : null;
  if (value === null) {
    addScopeReason(reasons, "invalid_scope_input", path, `${path} contains an unknown mode.`);
  }
  return value;
}

function evaluateProjectChildScopeInternal(input: unknown): ProjectChildScopeDecision {
  if (!isRecord(input)) {
    return scopeDeny(null, null, [
      { code: "invalid_scope_input", path: "$", message: "Child scope input must be an object." },
    ]);
  }
  const reasons: MutableScopeReasons = [];
  const allowedFields = new Set([
    "manifest",
    "scopeKind",
    "scopeId",
    "requestedResources",
    "requestedModelProfileIds",
    "requestedKnowledgeCollectionIds",
    "requestedBudget",
    "externalActionMode",
    "dataEgressMode",
    "requiredApprovalActions",
    "additionalForbiddenActions",
  ]);
  for (const key of Object.keys(input).sort(compareStrings)) {
    if (!allowedFields.has(key)) {
      addScopeReason(reasons, "invalid_scope_input", key, `Unknown child scope field ${key}.`);
    }
  }
  const scopeKind = parseScopeMode(input.scopeKind, projectChildScopeKinds, "scopeKind", reasons);
  const scopeId = parseScopeId(input.scopeId, "scopeId", reasons);
  const manifestResult = validateAndNormalizeProjectManifest(input.manifest);
  if (!manifestResult.ok) {
    for (const error of manifestResult.errors) {
      addScopeReason(
        reasons,
        "invalid_project_manifest",
        error.path === "$" ? "manifest" : `manifest.${error.path}`,
        `ProjectManifest validation failed (${error.code}).`,
      );
    }
    return scopeDeny(scopeKind, scopeId, reasons);
  }
  const manifest = manifestResult.value;
  if (manifest.status !== "active") {
    addScopeReason(reasons, "project_not_active", "manifest.status", `Project status ${manifest.status} does not allow child scopes.`);
  }

  const resourceRequests = parseScopeResources(input.requestedResources, reasons);
  const requestedModelProfileIds = parseScopeStringCollection(
    input.requestedModelProfileIds,
    "requestedModelProfileIds",
    projectManifestLimits.maxModelProfileIds,
    reasons,
  );
  const requestedKnowledgeCollectionIds = parseScopeStringCollection(
    input.requestedKnowledgeCollectionIds,
    "requestedKnowledgeCollectionIds",
    projectManifestLimits.maxKnowledgeCollectionIds,
    reasons,
  );
  const requestedBudget = parseScopeBudget(input.requestedBudget, manifest.budget, reasons);
  const externalActionMode = parseScopeMode(
    input.externalActionMode,
    projectExternalActionModes,
    "externalActionMode",
    reasons,
  );
  const dataEgressMode = parseScopeMode(
    input.dataEgressMode,
    projectDataEgressModes,
    "dataEgressMode",
    reasons,
  );
  const requiredApprovalActions = parseScopeStringCollection(
    input.requiredApprovalActions,
    "requiredApprovalActions",
    manifest.policy.requiredApprovalActions.length +
      projectManifestLimits.maxChildAdditionalApprovalActions,
    reasons,
  );
  const additionalForbiddenActions = parseScopeStringCollection(
    input.additionalForbiddenActions,
    "additionalForbiddenActions",
    projectManifestLimits.maxUserForbiddenActions,
    reasons,
  );

  const normalizedResources: ProjectChildResourceRequest[] = [];
  if (resourceRequests !== null) {
    const manifestById = new Map(manifest.resources.map((resource) => [resource.id, resource]));
    for (const resourceId of [...resourceRequests.keys()].sort(compareStrings)) {
      if (!manifestById.has(resourceId)) {
        addScopeReason(
          reasons,
          "resource_not_found",
          resourceRequests.get(resourceId)?.resourceIdPath ?? "requestedResources",
          `Resource ${resourceId} is not declared by ProjectManifest.`,
        );
      }
    }
    for (const resource of manifest.resources) {
      const requested = resourceRequests.get(resource.id);
      if (requested === undefined) {
        continue;
      }
      if (resource.status === "disabled" || resource.status === "error") {
        addScopeReason(
          reasons,
          "resource_unavailable",
          requested.resourceIdPath,
          `Resource ${resource.id} is unavailable.`,
        );
      }
      const allowed = new Set(resource.capabilities);
      for (const capability of requested.capabilities) {
        if (!allowed.has(capability.value)) {
          addScopeReason(
            reasons,
            "capability_not_allowed",
            capability.path,
            `Capability ${capability.value} is not allowed for resource ${resource.id}.`,
          );
        }
      }
      normalizedResources.push({
        resourceId: resource.id,
        capabilities: requested.capabilities.map((capability) => capability.value),
      });
    }
  }

  const requestedModels = new Set(
    (requestedModelProfileIds ?? []).map((model) => model.value),
  );
  const manifestModels = new Set(manifest.allowedModelProfileIds);
  for (const model of requestedModelProfileIds ?? []) {
    if (!manifestModels.has(model.value)) {
      addScopeReason(
        reasons,
        "model_profile_not_allowed",
        model.path,
        `Model profile ${model.value} is not allowed.`,
      );
    }
  }
  const normalizedModels = manifest.allowedModelProfileIds.filter((id) => requestedModels.has(id));

  const requestedKnowledge = new Set(
    (requestedKnowledgeCollectionIds ?? []).map((collection) => collection.value),
  );
  const manifestKnowledge = new Set(manifest.knowledgeCollectionIds);
  for (const collection of requestedKnowledgeCollectionIds ?? []) {
    if (!manifestKnowledge.has(collection.value)) {
      addScopeReason(
        reasons,
        "knowledge_collection_not_allowed",
        collection.path,
        `Knowledge Collection ${collection.value} is not allowed.`,
      );
    }
  }
  const normalizedKnowledge = manifest.knowledgeCollectionIds.filter((id) => requestedKnowledge.has(id));

  if (
    externalActionMode !== null &&
    projectExternalActionModes.indexOf(externalActionMode) >
      projectExternalActionModes.indexOf(manifest.policy.externalActionMode)
  ) {
    addScopeReason(
      reasons,
      "external_action_policy_relaxed",
      "externalActionMode",
      "Child external-action mode cannot be weaker than ProjectManifest policy.",
    );
  }
  if (
    dataEgressMode !== null &&
    projectDataEgressModes.indexOf(dataEgressMode) >
      projectDataEgressModes.indexOf(manifest.policy.dataEgressMode)
  ) {
    addScopeReason(
      reasons,
      "data_egress_policy_relaxed",
      "dataEgressMode",
      "Child data-egress mode cannot be weaker than ProjectManifest policy.",
    );
  }

  const requestedApprovals = new Set(
    (requiredApprovalActions ?? []).map((approval) => approval.value),
  );
  for (const approval of manifest.policy.requiredApprovalActions) {
    if (!requestedApprovals.has(approval)) {
      addScopeReason(
        reasons,
        "required_approval_missing",
        "requiredApprovalActions",
        `Required project approval ${approval} is missing.`,
      );
    }
  }
  const normalizedApprovals = prependSystemValues(
    manifest.policy.requiredApprovalActions,
    [...requestedApprovals].sort(compareStrings),
  );
  const normalizedForbidden = prependSystemValues(
    manifest.policy.forbiddenActions,
    (additionalForbiddenActions ?? []).map((action) => action.value),
  );

  if (
    reasons.length > 0 ||
    scopeKind === null ||
    scopeId === null ||
    resourceRequests === null ||
    requestedModelProfileIds === null ||
    requestedKnowledgeCollectionIds === null ||
    requestedBudget === null ||
    externalActionMode === null ||
    dataEgressMode === null ||
    requiredApprovalActions === null ||
    additionalForbiddenActions === null
  ) {
    return scopeDeny(scopeKind, scopeId, reasons);
  }
  return {
    verdict: "allow",
    scopeKind,
    scopeId,
    reasons: [],
    normalizedScope: {
      scopeKind,
      scopeId,
      resources: normalizedResources,
      modelProfileIds: normalizedModels,
      knowledgeCollectionIds: normalizedKnowledge,
      budget: { ...requestedBudget },
      externalActionMode,
      dataEgressMode,
      requiredApprovalActions: normalizedApprovals,
      forbiddenActions: normalizedForbidden,
    },
  };
}

export function evaluateProjectChildScope(input: unknown): ProjectChildScopeDecision {
  try {
    return evaluateProjectChildScopeInternal(input);
  } catch {
    return scopeDeny(null, null, [
      {
        code: "invalid_scope_input",
        path: "$",
        message: "Child scope input could not be safely inspected.",
      },
    ]);
  }
}
