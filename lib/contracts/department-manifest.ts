import type {
  NormalizedProjectChildScope,
  ProjectBudgetCeiling,
  ProjectChildScopeDecision,
  ProjectChildScopeReasonCode,
  ProjectDataEgressMode,
  ProjectExternalActionMode,
  ProjectManifest,
  ProjectResourceCapability,
} from "./project-manifest";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateProjectChildScope, projectDataEgressModes, projectExternalActionModes, projectManifestLimits, projectResourceCapabilities, validateAndNormalizeProjectManifest } from "./project-manifest.ts";

export const aiDepartmentCodes = Object.freeze([
  "support",
  "marketing",
  "community",
  "sales",
  "customer-success",
  "product",
  "development",
  "qa-code-review",
  "executive-analytics",
  "legal-documents",
] as const);
export type AiDepartmentCode = (typeof aiDepartmentCodes)[number];

export const departmentManifestStatuses = Object.freeze([
  "draft",
  "active",
  "paused",
  "disabled",
] as const);
export type DepartmentManifestStatus = (typeof departmentManifestStatuses)[number];

export const departmentOperatingModes = Object.freeze([
  "draft_only",
  "assisted",
  "approval_gated",
] as const);
export type DepartmentOperatingMode = (typeof departmentOperatingModes)[number];

export const departmentChildScopeKinds = Object.freeze(["agent", "workflow"] as const);
export type DepartmentChildScopeKind = (typeof departmentChildScopeKinds)[number];

export const departmentScopeVerdicts = Object.freeze(["allow", "deny"] as const);
export type DepartmentScopeVerdict = (typeof departmentScopeVerdicts)[number];

export const departmentManifestLimits = Object.freeze({
  maxIdLength: 64,
  maxNameLength: 160,
  maxSummaryLength: 4096,
  maxGoals: 32,
  maxNonGoals: 32,
  maxResourceGrants: 64,
  maxModelProfileIds: 32,
  maxFallbackModelProfileIds: 8,
  maxKnowledgeCollectionIds: 64,
  maxWorkflowIds: 64,
  maxOperatorRoleIds: 32,
  maxAdditionalApprovalActions: 64,
  maxAdditionalForbiddenActions: 64,
  maxTextListItemLength: 1024,
  maxErrors: 256,
});

export type DepartmentResourceGrant = Readonly<{
  resourceId: string;
  capabilities: readonly ProjectResourceCapability[];
}>;

export type DepartmentModelRouting = Readonly<{
  primaryModelProfileId: string;
  fallbackModelProfileIds: readonly string[];
  reviewerModelProfileId: string | null;
  independentReviewRequired: boolean;
}>;

export type DepartmentPolicy = Readonly<{
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  additionalRequiredApprovalActions: readonly string[];
  additionalForbiddenActions: readonly string[];
}>;

export type DepartmentManifest = Readonly<{
  id: string;
  projectId: string;
  version: number;
  code: AiDepartmentCode;
  name: string;
  summary: string;
  status: DepartmentManifestStatus;
  operatingMode: DepartmentOperatingMode;
  goals: readonly string[];
  nonGoals: readonly string[];
  resourceGrants: readonly DepartmentResourceGrant[];
  allowedModelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  enabledWorkflowIds: readonly string[];
  operatorRoleIds: readonly string[];
  modelRouting: DepartmentModelRouting;
  policy: DepartmentPolicy;
  budget: ProjectBudgetCeiling;
}>;

export type DepartmentManifestValidationErrorCode =
  | "invalid_input"
  | "unknown_field"
  | "required_field"
  | "invalid_type"
  | "invalid_id"
  | "invalid_enum"
  | "invalid_integer"
  | "limit_exceeded"
  | "duplicate_resource_id"
  | "empty_capabilities"
  | "primary_model_not_allowed"
  | "fallback_model_not_allowed"
  | "primary_model_in_fallback"
  | "reviewer_model_not_allowed"
  | "reviewer_required"
  | "reviewer_matches_primary";

export type DepartmentManifestValidationError = Readonly<{
  code: DepartmentManifestValidationErrorCode;
  path: string;
  message: string;
}>;

export type DepartmentManifestValidationResult =
  | Readonly<{ ok: true; value: DepartmentManifest }>
  | Readonly<{ ok: false; errors: readonly DepartmentManifestValidationError[] }>;

export type NormalizedDepartmentManifest = Readonly<{
  id: string;
  projectId: string;
  version: number;
  code: AiDepartmentCode;
  name: string;
  summary: string;
  status: DepartmentManifestStatus;
  operatingMode: DepartmentOperatingMode;
  goals: readonly string[];
  nonGoals: readonly string[];
  resourceGrants: readonly DepartmentResourceGrant[];
  allowedModelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  enabledWorkflowIds: readonly string[];
  operatorRoleIds: readonly string[];
  modelRouting: DepartmentModelRouting;
  policy: DepartmentPolicy;
  budget: ProjectBudgetCeiling;
  projectScope: NormalizedProjectChildScope;
  effectiveResources: readonly DepartmentResourceGrant[];
  effectiveModelProfileIds: readonly string[];
  effectiveKnowledgeCollectionIds: readonly string[];
  effectiveBudget: ProjectBudgetCeiling;
  effectiveExternalActionMode: ProjectExternalActionMode;
  effectiveDataEgressMode: ProjectDataEgressMode;
  effectiveRequiredApprovalActions: readonly string[];
  effectiveForbiddenActions: readonly string[];
}>;

export type DepartmentEvaluationReasonCode =
  | ProjectChildScopeReasonCode
  | "invalid_input"
  | "invalid_department_manifest"
  | "project_id_mismatch"
  | "department_not_active"
  | "invalid_child_input"
  | "workflow_not_enabled"
  | "inherited_policy_capacity_exceeded";

export type DepartmentEvaluationReason = Readonly<{
  code: DepartmentEvaluationReasonCode;
  path: string;
  message: string;
}>;

export type DepartmentEvaluationDecision = Readonly<{
  verdict: DepartmentScopeVerdict;
  reasons: readonly DepartmentEvaluationReason[];
  projectDecision: ProjectChildScopeDecision | null;
  normalizedDepartment: NormalizedDepartmentManifest | null;
}>;

export type DepartmentEvaluationInput = Readonly<{
  projectManifest: unknown;
  departmentManifest: unknown;
}>;

export type DepartmentChildScopeInput = Readonly<{
  projectManifest: unknown;
  departmentManifest: unknown;
  scopeKind: DepartmentChildScopeKind;
  scopeId: string;
  requestedResources: readonly DepartmentResourceGrant[];
  requestedModelProfileIds: readonly string[];
  requestedKnowledgeCollectionIds: readonly string[];
  requestedBudget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  additionalRequiredApprovalActions: readonly string[];
  additionalForbiddenActions: readonly string[];
}>;

export type DepartmentChildScopeReasonCode = DepartmentEvaluationReasonCode;
export type DepartmentChildScopeReason = DepartmentEvaluationReason;

export type DepartmentChildScopeDecision = Readonly<{
  verdict: DepartmentScopeVerdict;
  scopeKind: DepartmentChildScopeKind | null;
  scopeId: string | null;
  reasons: readonly DepartmentChildScopeReason[];
  departmentDecision: DepartmentEvaluationDecision | null;
  projectDecision: ProjectChildScopeDecision | null;
  normalizedScope: NormalizedProjectChildScope | null;
}>;

type MutableValidationErrors = DepartmentManifestValidationError[];
type MutableEvaluationReasons = DepartmentEvaluationReason[];

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const nonNewlineControlCharacterPattern = /[\u0000-\u0009\u000b-\u001f\u007f]/u;

function includesValue<const Values extends readonly string[]>(
  values: Values,
  input: unknown,
): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input);
}

export function isAiDepartmentCode(input: unknown): input is AiDepartmentCode {
  return includesValue(aiDepartmentCodes, input);
}

export function parseAiDepartmentCode(input: unknown): AiDepartmentCode | null {
  return isAiDepartmentCode(input) ? input : null;
}

export function isDepartmentManifestStatus(
  input: unknown,
): input is DepartmentManifestStatus {
  return includesValue(departmentManifestStatuses, input);
}

export function parseDepartmentManifestStatus(
  input: unknown,
): DepartmentManifestStatus | null {
  return isDepartmentManifestStatus(input) ? input : null;
}

export function isDepartmentOperatingMode(
  input: unknown,
): input is DepartmentOperatingMode {
  return includesValue(departmentOperatingModes, input);
}

export function parseDepartmentOperatingMode(
  input: unknown,
): DepartmentOperatingMode | null {
  return isDepartmentOperatingMode(input) ? input : null;
}

export function isDepartmentChildScopeKind(
  input: unknown,
): input is DepartmentChildScopeKind {
  return includesValue(departmentChildScopeKinds, input);
}

export function parseDepartmentChildScopeKind(
  input: unknown,
): DepartmentChildScopeKind | null {
  return isDepartmentChildScopeKind(input) ? input : null;
}

export function isDepartmentScopeVerdict(
  input: unknown,
): input is DepartmentScopeVerdict {
  return includesValue(departmentScopeVerdicts, input);
}

export function parseDepartmentScopeVerdict(
  input: unknown,
): DepartmentScopeVerdict | null {
  return isDepartmentScopeVerdict(input) ? input : null;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function own(input: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(input, field) ? input[field] : undefined;
}

function addValidationError(
  errors: MutableValidationErrors,
  code: DepartmentManifestValidationErrorCode,
  path: string,
  message: string,
): void {
  if (errors.length < departmentManifestLimits.maxErrors) {
    errors.push({ code, path, message });
  }
}

function addEvaluationReason(
  reasons: MutableEvaluationReasons,
  code: DepartmentEvaluationReasonCode,
  path: string,
  message: string,
): void {
  if (reasons.length < departmentManifestLimits.maxErrors) {
    reasons.push({ code, path, message });
  }
}

function validateKnownFields(
  input: Record<string, unknown>,
  fields: readonly string[],
  path: string,
  errors: MutableValidationErrors,
): void {
  const allowed = new Set(fields);
  for (const key of Object.keys(input).sort(compareStrings)) {
    if (!allowed.has(key)) {
      addValidationError(
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
  fields: readonly string[],
  path: string,
  errors: MutableValidationErrors,
): void {
  for (const field of fields) {
    if (!Object.hasOwn(input, field)) {
      addValidationError(
        errors,
        "required_field",
        path === "$" ? field : `${path}.${field}`,
        `${field} is required.`,
      );
    }
  }
}

function normalizeText(input: string, multiline: boolean): string {
  return (multiline ? input.replace(/\r\n?/gu, "\n") : input).trim();
}

function normalizeRequiredString(
  input: unknown,
  path: string,
  maximum: number,
  errors: MutableValidationErrors,
  multiline = false,
): string | null {
  if (typeof input !== "string") {
    addValidationError(errors, "invalid_type", path, `${path} must be a string.`);
    return null;
  }
  const value = normalizeText(input, multiline);
  if (value.length === 0) {
    addValidationError(errors, "required_field", path, `${path} must not be empty.`);
    return null;
  }
  if (value.length > maximum) {
    addValidationError(
      errors,
      "limit_exceeded",
      path,
      `${path} must be at most ${maximum} characters.`,
    );
    return null;
  }
  const hasInvalidControl = multiline
    ? nonNewlineControlCharacterPattern.test(value)
    : controlCharacterPattern.test(value);
  if (hasInvalidControl) {
    addValidationError(errors, "invalid_type", path, `${path} contains a control character.`);
    return null;
  }
  return value;
}

function normalizeId(
  input: unknown,
  path: string,
  errors: MutableValidationErrors,
  nullable = false,
): string | null {
  if (input === null && nullable) {
    return null;
  }
  if (typeof input !== "string") {
    addValidationError(errors, "invalid_id", path, `${path} must be a stable ID.`);
    return null;
  }
  const value = input.trim();
  if (!safeIdPattern.test(value)) {
    addValidationError(
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
  errors: MutableValidationErrors,
): Value | null {
  if (typeof input !== "string") {
    addValidationError(errors, "invalid_enum", path, `${path} must be a known enum value.`);
    return null;
  }
  const value = values.find((candidate) => candidate === input.trim()) ?? null;
  if (value === null) {
    addValidationError(errors, "invalid_enum", path, `${path} contains an unknown enum value.`);
  }
  return value;
}

function normalizeTextList(
  input: unknown,
  path: string,
  maximum: number,
  errors: MutableValidationErrors,
): readonly string[] | null {
  if (!Array.isArray(input)) {
    addValidationError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length > maximum) {
    addValidationError(
      errors,
      "limit_exceeded",
      path,
      `${path} must contain at most ${maximum} items.`,
    );
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.slice(0, maximum).entries()) {
    if (typeof item !== "string") {
      addValidationError(errors, "invalid_type", `${path}[${index}]`, "Item must be a string.");
      continue;
    }
    const value = normalizeText(item, true);
    if (value.length === 0) {
      continue;
    }
    if (value.length > departmentManifestLimits.maxTextListItemLength) {
      addValidationError(
        errors,
        "limit_exceeded",
        `${path}[${index}]`,
        "Text list item exceeds its length limit.",
      );
      continue;
    }
    if (nonNewlineControlCharacterPattern.test(value)) {
      addValidationError(
        errors,
        "invalid_type",
        `${path}[${index}]`,
        "Text list item contains a control character.",
      );
      continue;
    }
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizeIdList(
  input: unknown,
  path: string,
  maximum: number,
  errors: MutableValidationErrors,
): readonly string[] | null {
  if (!Array.isArray(input)) {
    addValidationError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length > maximum) {
    addValidationError(
      errors,
      "limit_exceeded",
      path,
      `${path} must contain at most ${maximum} items.`,
    );
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.slice(0, maximum).entries()) {
    if (typeof item === "string" && item.trim().length === 0) {
      continue;
    }
    const value = normalizeId(item, `${path}[${index}]`, errors);
    if (value !== null && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizeCapabilities(
  input: unknown,
  path: string,
  errors: MutableValidationErrors,
): readonly ProjectResourceCapability[] | null {
  if (!Array.isArray(input)) {
    addValidationError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length === 0) {
    addValidationError(errors, "empty_capabilities", path, `${path} must not be empty.`);
    return null;
  }
  if (input.length > projectResourceCapabilities.length) {
    addValidationError(errors, "limit_exceeded", path, `${path} has too many items.`);
  }
  const result: ProjectResourceCapability[] = [];
  const seen = new Set<ProjectResourceCapability>();
  for (const [index, item] of input.slice(0, projectResourceCapabilities.length).entries()) {
    const value = normalizeEnum(
      item,
      projectResourceCapabilities,
      `${path}[${index}]`,
      errors,
    );
    if (value !== null && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  if (result.length === 0) {
    addValidationError(
      errors,
      "empty_capabilities",
      path,
      `${path} must contain a valid capability.`,
    );
  }
  return result;
}

function normalizeResourceGrants(
  input: unknown,
  path: string,
  errors: MutableValidationErrors,
): readonly DepartmentResourceGrant[] | null {
  if (!Array.isArray(input)) {
    addValidationError(errors, "invalid_type", path, `${path} must be an array.`);
    return null;
  }
  if (input.length > departmentManifestLimits.maxResourceGrants) {
    addValidationError(errors, "limit_exceeded", path, `${path} exceeds its collection limit.`);
  }
  const result: DepartmentResourceGrant[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input
    .slice(0, departmentManifestLimits.maxResourceGrants)
    .entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      addValidationError(errors, "invalid_type", itemPath, `${itemPath} must be an object.`);
      continue;
    }
    validateKnownFields(item, ["resourceId", "capabilities"], itemPath, errors);
    validateRequiredFields(item, ["resourceId", "capabilities"], itemPath, errors);
    const resourceId = normalizeId(own(item, "resourceId"), `${itemPath}.resourceId`, errors);
    const capabilities = normalizeCapabilities(
      own(item, "capabilities"),
      `${itemPath}.capabilities`,
      errors,
    );
    if (resourceId === null || capabilities === null) {
      continue;
    }
    if (seen.has(resourceId)) {
      addValidationError(
        errors,
        "duplicate_resource_id",
        `${itemPath}.resourceId`,
        `Resource ${resourceId} is granted more than once.`,
      );
    }
    seen.add(resourceId);
    result.push({ resourceId, capabilities });
  }
  return result;
}

const budgetValidationEnvelope = Object.freeze({
  id: "department-budget-validation",
  workspaceId: "department-contract",
  version: 1,
  name: "Department budget validation",
  slug: "department-budget-validation",
  summary: "Structural budget validation through the ProjectManifest contract.",
  kind: "internal_product",
  status: "active",
  defaultLocale: "en",
  timeZone: "UTC",
  dataRegion: "local",
  dataClassification: "internal",
  goals: [] as readonly string[],
  nonGoals: [] as readonly string[],
  tags: [] as readonly string[],
  resources: [] as readonly unknown[],
  allowedModelProfileIds: [] as readonly string[],
  knowledgeCollectionIds: [] as readonly string[],
  policy: {
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    requiredApprovalActions: [] as readonly string[],
    forbiddenActions: [] as readonly string[],
  },
});

function normalizeBudget(
  input: unknown,
  path: string,
  errors: MutableValidationErrors,
): ProjectBudgetCeiling | null {
  const result = validateAndNormalizeProjectManifest({
    ...budgetValidationEnvelope,
    budget: input,
  });
  if (result.ok) {
    return { ...result.value.budget };
  }
  let mapped = false;
  for (const error of result.errors) {
    if (error.path !== "budget" && !error.path.startsWith("budget.")) {
      continue;
    }
    mapped = true;
    const mappedPath = error.path === "budget" ? path : `${path}${error.path.slice(6)}`;
    const code: DepartmentManifestValidationErrorCode =
      error.code === "unknown_field" ||
      error.code === "required_field" ||
      error.code === "invalid_type" ||
      error.code === "invalid_integer"
        ? error.code
        : "invalid_type";
    addValidationError(errors, code, mappedPath, error.message.replace(/^budget/u, path));
  }
  if (!mapped) {
    addValidationError(errors, "invalid_type", path, `${path} is not a valid budget.`);
  }
  return null;
}

function normalizeModelRouting(
  input: unknown,
  allowedModelProfileIds: readonly string[] | null,
  errors: MutableValidationErrors,
): DepartmentModelRouting | null {
  const path = "modelRouting";
  if (!isRecord(input)) {
    addValidationError(errors, "invalid_type", path, `${path} must be an object.`);
    return null;
  }
  const fields = [
    "primaryModelProfileId",
    "fallbackModelProfileIds",
    "reviewerModelProfileId",
    "independentReviewRequired",
  ] as const;
  validateKnownFields(input, fields, path, errors);
  validateRequiredFields(input, fields, path, errors);
  const primaryModelProfileId = normalizeId(
    own(input, "primaryModelProfileId"),
    `${path}.primaryModelProfileId`,
    errors,
  );
  const fallbackModelProfileIds = normalizeIdList(
    own(input, "fallbackModelProfileIds"),
    `${path}.fallbackModelProfileIds`,
    departmentManifestLimits.maxFallbackModelProfileIds,
    errors,
  );
  const reviewerModelProfileId = normalizeId(
    own(input, "reviewerModelProfileId"),
    `${path}.reviewerModelProfileId`,
    errors,
    true,
  );
  const independentReviewInput = own(input, "independentReviewRequired");
  const independentReviewRequired =
    typeof independentReviewInput === "boolean" ? independentReviewInput : null;
  if (independentReviewRequired === null) {
    addValidationError(
      errors,
      "invalid_type",
      `${path}.independentReviewRequired`,
      "independentReviewRequired must be a boolean.",
    );
  }

  const allowed = new Set(allowedModelProfileIds ?? []);
  if (primaryModelProfileId !== null && !allowed.has(primaryModelProfileId)) {
    addValidationError(
      errors,
      "primary_model_not_allowed",
      `${path}.primaryModelProfileId`,
      "Primary model must be present in allowedModelProfileIds.",
    );
  }
  for (const [index, fallback] of (fallbackModelProfileIds ?? []).entries()) {
    if (!allowed.has(fallback)) {
      addValidationError(
        errors,
        "fallback_model_not_allowed",
        `${path}.fallbackModelProfileIds[${index}]`,
        "Fallback model must be present in allowedModelProfileIds.",
      );
    }
    if (fallback === primaryModelProfileId) {
      addValidationError(
        errors,
        "primary_model_in_fallback",
        `${path}.fallbackModelProfileIds[${index}]`,
        "Primary model must not be repeated as a fallback.",
      );
    }
  }
  if (reviewerModelProfileId !== null && !allowed.has(reviewerModelProfileId)) {
    addValidationError(
      errors,
      "reviewer_model_not_allowed",
      `${path}.reviewerModelProfileId`,
      "Reviewer model must be present in allowedModelProfileIds.",
    );
  }
  if (independentReviewRequired === true && reviewerModelProfileId === null) {
    addValidationError(
      errors,
      "reviewer_required",
      `${path}.reviewerModelProfileId`,
      "Independent review requires a reviewer model.",
    );
  }
  if (
    independentReviewRequired === true &&
    reviewerModelProfileId !== null &&
    reviewerModelProfileId === primaryModelProfileId
  ) {
    addValidationError(
      errors,
      "reviewer_matches_primary",
      `${path}.reviewerModelProfileId`,
      "Independent reviewer must differ from the primary model.",
    );
  }
  return primaryModelProfileId === null ||
    fallbackModelProfileIds === null ||
    independentReviewRequired === null
    ? null
    : {
        primaryModelProfileId,
        fallbackModelProfileIds,
        reviewerModelProfileId,
        independentReviewRequired,
      };
}

function normalizePolicy(
  input: unknown,
  errors: MutableValidationErrors,
): DepartmentPolicy | null {
  const path = "policy";
  if (!isRecord(input)) {
    addValidationError(errors, "invalid_type", path, `${path} must be an object.`);
    return null;
  }
  const fields = [
    "externalActionMode",
    "dataEgressMode",
    "additionalRequiredApprovalActions",
    "additionalForbiddenActions",
  ] as const;
  validateKnownFields(input, fields, path, errors);
  validateRequiredFields(input, fields, path, errors);
  const externalActionMode = normalizeEnum(
    own(input, "externalActionMode"),
    projectExternalActionModes,
    `${path}.externalActionMode`,
    errors,
  );
  const dataEgressMode = normalizeEnum(
    own(input, "dataEgressMode"),
    projectDataEgressModes,
    `${path}.dataEgressMode`,
    errors,
  );
  const additionalRequiredApprovalActions = normalizeTextList(
    own(input, "additionalRequiredApprovalActions"),
    `${path}.additionalRequiredApprovalActions`,
    departmentManifestLimits.maxAdditionalApprovalActions,
    errors,
  );
  const additionalForbiddenActions = normalizeTextList(
    own(input, "additionalForbiddenActions"),
    `${path}.additionalForbiddenActions`,
    departmentManifestLimits.maxAdditionalForbiddenActions,
    errors,
  );
  return externalActionMode === null ||
    dataEgressMode === null ||
    additionalRequiredApprovalActions === null ||
    additionalForbiddenActions === null
    ? null
    : {
        externalActionMode,
        dataEgressMode,
        additionalRequiredApprovalActions,
        additionalForbiddenActions,
      };
}

const departmentManifestFields = [
  "id",
  "projectId",
  "version",
  "code",
  "name",
  "summary",
  "status",
  "operatingMode",
  "goals",
  "nonGoals",
  "resourceGrants",
  "allowedModelProfileIds",
  "knowledgeCollectionIds",
  "enabledWorkflowIds",
  "operatorRoleIds",
  "modelRouting",
  "policy",
  "budget",
] as const;

function validateAndNormalizeDepartmentManifestInternal(
  input: unknown,
): DepartmentManifestValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ code: "invalid_input", path: "$", message: "DepartmentManifest must be an object." }],
    };
  }
  const errors: MutableValidationErrors = [];
  validateKnownFields(input, departmentManifestFields, "$", errors);
  validateRequiredFields(input, departmentManifestFields, "$", errors);
  const id = normalizeId(own(input, "id"), "id", errors);
  const projectId = normalizeId(own(input, "projectId"), "projectId", errors);
  const versionInput = own(input, "version");
  const version =
    typeof versionInput === "number" &&
    Number.isSafeInteger(versionInput) &&
    versionInput > 0
      ? versionInput
      : null;
  if (version === null) {
    addValidationError(
      errors,
      "invalid_integer",
      "version",
      "version must be a positive safe integer.",
    );
  }
  const code = normalizeEnum(own(input, "code"), aiDepartmentCodes, "code", errors);
  const name = normalizeRequiredString(
    own(input, "name"),
    "name",
    departmentManifestLimits.maxNameLength,
    errors,
  );
  const summary = normalizeRequiredString(
    own(input, "summary"),
    "summary",
    departmentManifestLimits.maxSummaryLength,
    errors,
    true,
  );
  const status = normalizeEnum(
    own(input, "status"),
    departmentManifestStatuses,
    "status",
    errors,
  );
  const operatingMode = normalizeEnum(
    own(input, "operatingMode"),
    departmentOperatingModes,
    "operatingMode",
    errors,
  );
  const goals = normalizeTextList(
    own(input, "goals"),
    "goals",
    departmentManifestLimits.maxGoals,
    errors,
  );
  const nonGoals = normalizeTextList(
    own(input, "nonGoals"),
    "nonGoals",
    departmentManifestLimits.maxNonGoals,
    errors,
  );
  const resourceGrants = normalizeResourceGrants(
    own(input, "resourceGrants"),
    "resourceGrants",
    errors,
  );
  const allowedModelProfileIds = normalizeIdList(
    own(input, "allowedModelProfileIds"),
    "allowedModelProfileIds",
    departmentManifestLimits.maxModelProfileIds,
    errors,
  );
  const knowledgeCollectionIds = normalizeIdList(
    own(input, "knowledgeCollectionIds"),
    "knowledgeCollectionIds",
    departmentManifestLimits.maxKnowledgeCollectionIds,
    errors,
  );
  const enabledWorkflowIds = normalizeIdList(
    own(input, "enabledWorkflowIds"),
    "enabledWorkflowIds",
    departmentManifestLimits.maxWorkflowIds,
    errors,
  );
  const operatorRoleIds = normalizeIdList(
    own(input, "operatorRoleIds"),
    "operatorRoleIds",
    departmentManifestLimits.maxOperatorRoleIds,
    errors,
  );
  const modelRouting = normalizeModelRouting(
    own(input, "modelRouting"),
    allowedModelProfileIds,
    errors,
  );
  const policy = normalizePolicy(own(input, "policy"), errors);
  const budget = normalizeBudget(own(input, "budget"), "budget", errors);
  if (
    errors.length > 0 ||
    id === null ||
    projectId === null ||
    version === null ||
    code === null ||
    name === null ||
    summary === null ||
    status === null ||
    operatingMode === null ||
    goals === null ||
    nonGoals === null ||
    resourceGrants === null ||
    allowedModelProfileIds === null ||
    knowledgeCollectionIds === null ||
    enabledWorkflowIds === null ||
    operatorRoleIds === null ||
    modelRouting === null ||
    policy === null ||
    budget === null
  ) {
    return { ok: false, errors: errors.map((error) => ({ ...error })) };
  }
  return {
    ok: true,
    value: {
      id,
      projectId,
      version,
      code,
      name,
      summary,
      status,
      operatingMode,
      goals,
      nonGoals,
      resourceGrants,
      allowedModelProfileIds,
      knowledgeCollectionIds,
      enabledWorkflowIds,
      operatorRoleIds,
      modelRouting,
      policy,
      budget,
    },
  };
}

export function validateAndNormalizeDepartmentManifest(
  input: unknown,
): DepartmentManifestValidationResult {
  try {
    return validateAndNormalizeDepartmentManifestInternal(input);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_input",
          path: "$",
          message: "DepartmentManifest input could not be safely inspected.",
        },
      ],
    };
  }
}

function mergeStable(...collections: readonly (readonly string[])[]): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const collection of collections) {
    for (const item of collection) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

function cloneProjectScope(scope: NormalizedProjectChildScope): NormalizedProjectChildScope {
  return {
    ...scope,
    resources: scope.resources.map((resource) => ({
      ...resource,
      capabilities: [...resource.capabilities],
    })),
    modelProfileIds: [...scope.modelProfileIds],
    knowledgeCollectionIds: [...scope.knowledgeCollectionIds],
    budget: { ...scope.budget },
    requiredApprovalActions: [...scope.requiredApprovalActions],
    forbiddenActions: [...scope.forbiddenActions],
  };
}

function cloneProjectDecision(decision: ProjectChildScopeDecision): ProjectChildScopeDecision {
  return {
    ...decision,
    reasons: decision.reasons.map((reason) => ({ ...reason })),
    normalizedScope: decision.normalizedScope
      ? cloneProjectScope(decision.normalizedScope)
      : null,
  };
}

function cloneDepartmentManifest(manifest: DepartmentManifest): DepartmentManifest {
  return {
    ...manifest,
    goals: [...manifest.goals],
    nonGoals: [...manifest.nonGoals],
    resourceGrants: manifest.resourceGrants.map((grant) => ({
      ...grant,
      capabilities: [...grant.capabilities],
    })),
    allowedModelProfileIds: [...manifest.allowedModelProfileIds],
    knowledgeCollectionIds: [...manifest.knowledgeCollectionIds],
    enabledWorkflowIds: [...manifest.enabledWorkflowIds],
    operatorRoleIds: [...manifest.operatorRoleIds],
    modelRouting: {
      ...manifest.modelRouting,
      fallbackModelProfileIds: [...manifest.modelRouting.fallbackModelProfileIds],
    },
    policy: {
      ...manifest.policy,
      additionalRequiredApprovalActions: [
        ...manifest.policy.additionalRequiredApprovalActions,
      ],
      additionalForbiddenActions: [...manifest.policy.additionalForbiddenActions],
    },
    budget: { ...manifest.budget },
  };
}

function departmentDeny(
  reasons: readonly DepartmentEvaluationReason[],
  projectDecision: ProjectChildScopeDecision | null = null,
): DepartmentEvaluationDecision {
  return {
    verdict: "deny",
    reasons: reasons.map((reason) => ({ ...reason })),
    projectDecision: projectDecision ? cloneProjectDecision(projectDecision) : null,
    normalizedDepartment: null,
  };
}

function validationReasons(
  errors: readonly DepartmentManifestValidationError[],
): readonly DepartmentEvaluationReason[] {
  return errors.map((error) => ({
    code: "invalid_department_manifest" as const,
    path: error.path === "$" ? "departmentManifest" : `departmentManifest.${error.path}`,
    message: `DepartmentManifest validation failed (${error.code}).`,
  }));
}

function projectValidationReasons(
  input: unknown,
): Readonly<{
  project: ProjectManifest | null;
  reasons: readonly DepartmentEvaluationReason[];
}> {
  const result = validateAndNormalizeProjectManifest(input);
  if (result.ok) {
    return { project: result.value, reasons: [] };
  }
  return {
    project: null,
    reasons: result.errors.map((error) => ({
      code: "invalid_project_manifest" as const,
      path: error.path === "$" ? "projectManifest" : `projectManifest.${error.path}`,
      message: `ProjectManifest validation failed (${error.code}).`,
    })),
  };
}

function normalizeDepartmentResult(
  department: DepartmentManifest,
  projectScope: NormalizedProjectChildScope,
): NormalizedDepartmentManifest {
  const manifest = cloneDepartmentManifest(department);
  const scope = cloneProjectScope(projectScope);
  return {
    ...manifest,
    projectScope: scope,
    effectiveResources: scope.resources.map((resource) => ({
      resourceId: resource.resourceId,
      capabilities: [...resource.capabilities],
    })),
    effectiveModelProfileIds: [...scope.modelProfileIds],
    effectiveKnowledgeCollectionIds: [...scope.knowledgeCollectionIds],
    effectiveBudget: { ...scope.budget },
    effectiveExternalActionMode: scope.externalActionMode,
    effectiveDataEgressMode: scope.dataEgressMode,
    effectiveRequiredApprovalActions: [...scope.requiredApprovalActions],
    effectiveForbiddenActions: [...scope.forbiddenActions],
  };
}

const departmentEvaluationFields = ["projectManifest", "departmentManifest"] as const;

function evaluateDepartmentManifestInternal(input: unknown): DepartmentEvaluationDecision {
  if (!isRecord(input)) {
    return departmentDeny([
      { code: "invalid_input", path: "$", message: "Department evaluation input must be an object." },
    ]);
  }
  const envelopeErrors: MutableValidationErrors = [];
  validateKnownFields(input, departmentEvaluationFields, "$", envelopeErrors);
  validateRequiredFields(input, departmentEvaluationFields, "$", envelopeErrors);
  if (envelopeErrors.length > 0) {
    return departmentDeny(
      envelopeErrors.map((error) => ({
        code: "invalid_input",
        path: error.path,
        message: error.message,
      })),
    );
  }

  const projectValidation = projectValidationReasons(own(input, "projectManifest"));
  if (projectValidation.project === null) {
    return departmentDeny(projectValidation.reasons);
  }
  const departmentValidation = validateAndNormalizeDepartmentManifest(
    own(input, "departmentManifest"),
  );
  if (!departmentValidation.ok) {
    return departmentDeny(validationReasons(departmentValidation.errors));
  }
  const project = projectValidation.project;
  const department = departmentValidation.value;
  if (department.projectId !== project.id) {
    return departmentDeny([
      {
        code: "project_id_mismatch",
        path: "departmentManifest.projectId",
        message: "DepartmentManifest projectId does not match ProjectManifest id.",
      },
    ]);
  }

  const projectDecision = evaluateProjectChildScope({
    manifest: project,
    scopeKind: "department",
    scopeId: department.id,
    requestedResources: department.resourceGrants,
    requestedModelProfileIds: department.allowedModelProfileIds,
    requestedKnowledgeCollectionIds: department.knowledgeCollectionIds,
    requestedBudget: department.budget,
    externalActionMode: department.policy.externalActionMode,
    dataEgressMode: department.policy.dataEgressMode,
    requiredApprovalActions: mergeStable(
      project.policy.requiredApprovalActions,
      department.policy.additionalRequiredApprovalActions,
    ),
    additionalForbiddenActions: department.policy.additionalForbiddenActions,
  });
  if (projectDecision.verdict === "deny" || projectDecision.normalizedScope === null) {
    return departmentDeny(projectDecision.reasons, projectDecision);
  }
  return {
    verdict: projectDecision.verdict,
    reasons: projectDecision.reasons.map((reason) => ({ ...reason })),
    projectDecision: cloneProjectDecision(projectDecision),
    normalizedDepartment: normalizeDepartmentResult(
      department,
      projectDecision.normalizedScope,
    ),
  };
}

export function evaluateDepartmentManifest(input: unknown): DepartmentEvaluationDecision {
  try {
    return evaluateDepartmentManifestInternal(input);
  } catch {
    return departmentDeny([
      {
        code: "invalid_input",
        path: "$",
        message: "Department evaluation input could not be safely inspected.",
      },
    ]);
  }
}

type ParsedDepartmentChildScope = Readonly<{
  scopeKind: DepartmentChildScopeKind;
  scopeId: string;
  requestedResources: readonly DepartmentResourceGrant[];
  requestedModelProfileIds: readonly string[];
  requestedKnowledgeCollectionIds: readonly string[];
  requestedBudget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  additionalRequiredApprovalActions: readonly string[];
  additionalForbiddenActions: readonly string[];
}>;

const departmentChildFields = [
  "projectManifest",
  "departmentManifest",
  "scopeKind",
  "scopeId",
  "requestedResources",
  "requestedModelProfileIds",
  "requestedKnowledgeCollectionIds",
  "requestedBudget",
  "externalActionMode",
  "dataEgressMode",
  "additionalRequiredApprovalActions",
  "additionalForbiddenActions",
] as const;

function parseDepartmentChildScope(
  input: Record<string, unknown>,
): Readonly<{
  value: ParsedDepartmentChildScope | null;
  reasons: readonly DepartmentChildScopeReason[];
}> {
  const errors: MutableValidationErrors = [];
  validateKnownFields(input, departmentChildFields, "$", errors);
  validateRequiredFields(input, departmentChildFields, "$", errors);
  const scopeKind = normalizeEnum(
    own(input, "scopeKind"),
    departmentChildScopeKinds,
    "scopeKind",
    errors,
  );
  const scopeId = normalizeId(own(input, "scopeId"), "scopeId", errors);
  const requestedResources = normalizeResourceGrants(
    own(input, "requestedResources"),
    "requestedResources",
    errors,
  );
  const requestedModelProfileIds = normalizeIdList(
    own(input, "requestedModelProfileIds"),
    "requestedModelProfileIds",
    departmentManifestLimits.maxModelProfileIds,
    errors,
  );
  const requestedKnowledgeCollectionIds = normalizeIdList(
    own(input, "requestedKnowledgeCollectionIds"),
    "requestedKnowledgeCollectionIds",
    departmentManifestLimits.maxKnowledgeCollectionIds,
    errors,
  );
  const requestedBudget = normalizeBudget(
    own(input, "requestedBudget"),
    "requestedBudget",
    errors,
  );
  const externalActionMode = normalizeEnum(
    own(input, "externalActionMode"),
    projectExternalActionModes,
    "externalActionMode",
    errors,
  );
  const dataEgressMode = normalizeEnum(
    own(input, "dataEgressMode"),
    projectDataEgressModes,
    "dataEgressMode",
    errors,
  );
  const additionalRequiredApprovalActions = normalizeTextList(
    own(input, "additionalRequiredApprovalActions"),
    "additionalRequiredApprovalActions",
    departmentManifestLimits.maxAdditionalApprovalActions,
    errors,
  );
  const additionalForbiddenActions = normalizeTextList(
    own(input, "additionalForbiddenActions"),
    "additionalForbiddenActions",
    departmentManifestLimits.maxAdditionalForbiddenActions,
    errors,
  );
  const reasons = errors.map((error) => ({
    code: "invalid_child_input" as const,
    path: error.path,
    message: `Child scope validation failed (${error.code}).`,
  }));
  if (
    reasons.length > 0 ||
    scopeKind === null ||
    scopeId === null ||
    requestedResources === null ||
    requestedModelProfileIds === null ||
    requestedKnowledgeCollectionIds === null ||
    requestedBudget === null ||
    externalActionMode === null ||
    dataEgressMode === null ||
    additionalRequiredApprovalActions === null ||
    additionalForbiddenActions === null
  ) {
    return { value: null, reasons };
  }
  return {
    value: {
      scopeKind,
      scopeId,
      requestedResources,
      requestedModelProfileIds,
      requestedKnowledgeCollectionIds,
      requestedBudget,
      externalActionMode,
      dataEgressMode,
      additionalRequiredApprovalActions,
      additionalForbiddenActions,
    },
    reasons: [],
  };
}

function childDeny(
  scopeKind: DepartmentChildScopeKind | null,
  scopeId: string | null,
  reasons: readonly DepartmentChildScopeReason[],
  departmentDecision: DepartmentEvaluationDecision | null = null,
  projectDecision: ProjectChildScopeDecision | null = null,
): DepartmentChildScopeDecision {
  return {
    verdict: "deny",
    scopeKind,
    scopeId,
    reasons: reasons.map((reason) => ({ ...reason })),
    departmentDecision,
    projectDecision: projectDecision ? cloneProjectDecision(projectDecision) : null,
    normalizedScope: null,
  };
}

function modeIsRelaxed<Value extends string>(
  child: Value,
  parent: Value,
  order: readonly Value[],
): boolean {
  return order.indexOf(child) > order.indexOf(parent);
}

function evaluateDepartmentChildScopeInternal(input: unknown): DepartmentChildScopeDecision {
  if (!isRecord(input)) {
    return childDeny(null, null, [
      { code: "invalid_input", path: "$", message: "Department child input must be an object." },
    ]);
  }
  const departmentDecision = evaluateDepartmentManifest({
    projectManifest: own(input, "projectManifest"),
    departmentManifest: own(input, "departmentManifest"),
  });
  if (
    departmentDecision.verdict === "deny" ||
    departmentDecision.normalizedDepartment === null
  ) {
    return childDeny(null, null, departmentDecision.reasons, departmentDecision);
  }
  const department = departmentDecision.normalizedDepartment;
  if (department.status !== "active") {
    return childDeny(
      null,
      null,
      [
        {
          code: "department_not_active",
          path: "departmentManifest.status",
          message: `Department status ${department.status} does not allow child scopes.`,
        },
      ],
      departmentDecision,
    );
  }
  const parsed = parseDepartmentChildScope(input);
  if (parsed.value === null) {
    return childDeny(null, null, parsed.reasons, departmentDecision);
  }
  const child = parsed.value;
  if (
    child.scopeKind === "workflow" &&
    !department.enabledWorkflowIds.includes(child.scopeId)
  ) {
    return childDeny(
      child.scopeKind,
      child.scopeId,
      [
        {
          code: "workflow_not_enabled",
          path: "scopeId",
          message: `Workflow ${child.scopeId} is not enabled by DepartmentManifest.`,
        },
      ],
      departmentDecision,
    );
  }
  const effectiveAdditionalApprovals = mergeStable(
    department.policy.additionalRequiredApprovalActions,
    child.additionalRequiredApprovalActions,
  );
  const effectiveAdditionalForbiddenActions = mergeStable(
    department.policy.additionalForbiddenActions,
    child.additionalForbiddenActions,
  );
  const capacityReasons: MutableEvaluationReasons = [];
  if (
    effectiveAdditionalApprovals.length >
    projectManifestLimits.maxChildAdditionalApprovalActions
  ) {
    addEvaluationReason(
      capacityReasons,
      "inherited_policy_capacity_exceeded",
      "additionalRequiredApprovalActions",
      "Combined Department and child approval additions exceed the AI-013 child capacity.",
    );
  }
  if (
    effectiveAdditionalForbiddenActions.length >
    projectManifestLimits.maxUserForbiddenActions
  ) {
    addEvaluationReason(
      capacityReasons,
      "inherited_policy_capacity_exceeded",
      "additionalForbiddenActions",
      "Combined Department and child forbidden additions exceed the AI-013 child capacity.",
    );
  }
  if (capacityReasons.length > 0) {
    return childDeny(
      child.scopeKind,
      child.scopeId,
      capacityReasons,
      departmentDecision,
    );
  }
  const projectValidation = projectValidationReasons(own(input, "projectManifest"));
  if (projectValidation.project === null) {
    return childDeny(
      child.scopeKind,
      child.scopeId,
      projectValidation.reasons,
      departmentDecision,
    );
  }
  const project = projectValidation.project;
  const projectDecision = evaluateProjectChildScope({
    manifest: project,
    scopeKind: child.scopeKind,
    scopeId: child.scopeId,
    requestedResources: child.requestedResources,
    requestedModelProfileIds: child.requestedModelProfileIds,
    requestedKnowledgeCollectionIds: child.requestedKnowledgeCollectionIds,
    requestedBudget: child.requestedBudget,
    externalActionMode: child.externalActionMode,
    dataEgressMode: child.dataEgressMode,
    requiredApprovalActions: mergeStable(
      project.policy.requiredApprovalActions,
      effectiveAdditionalApprovals,
    ),
    additionalForbiddenActions: effectiveAdditionalForbiddenActions,
  });
  if (projectDecision.verdict === "deny" || projectDecision.normalizedScope === null) {
    return childDeny(
      child.scopeKind,
      child.scopeId,
      projectDecision.reasons,
      departmentDecision,
      projectDecision,
    );
  }

  const reasons: MutableEvaluationReasons = [];
  const departmentResources = new Map(
    department.resourceGrants.map((grant) => [grant.resourceId, grant]),
  );
  for (const [index, resource] of child.requestedResources.entries()) {
    const allowed = departmentResources.get(resource.resourceId);
    if (allowed === undefined) {
      addEvaluationReason(
        reasons,
        "resource_not_found",
        `requestedResources[${index}].resourceId`,
        `Resource ${resource.resourceId} is not granted to DepartmentManifest.`,
      );
      continue;
    }
    const allowedCapabilities = new Set(allowed.capabilities);
    for (const [capabilityIndex, capability] of resource.capabilities.entries()) {
      if (!allowedCapabilities.has(capability)) {
        addEvaluationReason(
          reasons,
          "capability_not_allowed",
          `requestedResources[${index}].capabilities[${capabilityIndex}]`,
          `Capability ${capability} is not granted to DepartmentManifest.`,
        );
      }
    }
  }

  const allowedModels = new Set(department.allowedModelProfileIds);
  for (const [index, model] of child.requestedModelProfileIds.entries()) {
    if (!allowedModels.has(model)) {
      addEvaluationReason(
        reasons,
        "model_profile_not_allowed",
        `requestedModelProfileIds[${index}]`,
        `Model profile ${model} is not allowed by DepartmentManifest.`,
      );
    }
  }
  const allowedKnowledge = new Set(department.knowledgeCollectionIds);
  for (const [index, collection] of child.requestedKnowledgeCollectionIds.entries()) {
    if (!allowedKnowledge.has(collection)) {
      addEvaluationReason(
        reasons,
        "knowledge_collection_not_allowed",
        `requestedKnowledgeCollectionIds[${index}]`,
        `Knowledge Collection ${collection} is not allowed by DepartmentManifest.`,
      );
    }
  }

  for (const field of Object.keys(department.budget) as Array<keyof ProjectBudgetCeiling>) {
    if (child.requestedBudget[field] > department.budget[field]) {
      addEvaluationReason(
        reasons,
        "budget_ceiling_exceeded",
        `requestedBudget.${field}`,
        `${field} exceeds the DepartmentManifest ceiling.`,
      );
    }
  }
  if (
    modeIsRelaxed(
      child.externalActionMode,
      department.policy.externalActionMode,
      projectExternalActionModes,
    )
  ) {
    addEvaluationReason(
      reasons,
      "external_action_policy_relaxed",
      "externalActionMode",
      "Child external-action mode cannot be weaker than DepartmentManifest policy.",
    );
  }
  if (
    modeIsRelaxed(
      child.dataEgressMode,
      department.policy.dataEgressMode,
      projectDataEgressModes,
    )
  ) {
    addEvaluationReason(
      reasons,
      "data_egress_policy_relaxed",
      "dataEgressMode",
      "Child data-egress mode cannot be weaker than DepartmentManifest policy.",
    );
  }
  if (reasons.length > 0) {
    return childDeny(
      child.scopeKind,
      child.scopeId,
      reasons,
      departmentDecision,
      projectDecision,
    );
  }
  return {
    verdict: projectDecision.verdict,
    scopeKind: child.scopeKind,
    scopeId: child.scopeId,
    reasons: projectDecision.reasons.map((reason) => ({ ...reason })),
    departmentDecision,
    projectDecision: cloneProjectDecision(projectDecision),
    normalizedScope: cloneProjectScope(projectDecision.normalizedScope),
  };
}

export function evaluateDepartmentChildScope(input: unknown): DepartmentChildScopeDecision {
  try {
    return evaluateDepartmentChildScopeInternal(input);
  } catch {
    return childDeny(null, null, [
      {
        code: "invalid_input",
        path: "$",
        message: "Department child input could not be safely inspected.",
      },
    ]);
  }
}
