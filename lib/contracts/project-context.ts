import type {
  DepartmentChildScopeDecision,
  DepartmentChildScopeKind,
  DepartmentEvaluationDecision,
  DepartmentManifest,
  DepartmentResourceGrant,
  NormalizedDepartmentManifest,
} from "./department-manifest";
import type {
  NormalizedProjectChildScope,
  ProjectBudgetCeiling,
  ProjectDataEgressMode,
  ProjectExternalActionMode,
  ProjectManifest,
  ProjectResourceCapability,
} from "./project-manifest";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { departmentChildScopeKinds, departmentManifestLimits, evaluateDepartmentChildScope, evaluateDepartmentManifest, validateAndNormalizeDepartmentManifest } from "./department-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { projectDataEgressModes, projectExternalActionModes, projectManifestLimits, projectResourceCapabilities, validateAndNormalizeProjectManifest } from "./project-manifest.ts";

export const projectBindingStatuses = Object.freeze([
  "draft",
  "active",
  "paused",
  "disabled",
] as const);
export type ProjectBindingStatus = (typeof projectBindingStatuses)[number];

export const projectContextVerdicts = Object.freeze(["allow", "deny"] as const);
export type ProjectContextVerdict = (typeof projectContextVerdicts)[number];

export const projectContextLimits = Object.freeze({
  maxIdLength: 64,
  maxProjects: 32,
  maxDepartmentsPerProject: 10,
  maxBindingsPerProject: 256,
  maxErrors: 512,
});

export function isProjectBindingStatus(input: unknown): input is ProjectBindingStatus {
  return includesValue(projectBindingStatuses, input);
}

export function parseProjectBindingStatus(input: unknown): ProjectBindingStatus | null {
  return isProjectBindingStatus(input) ? input : null;
}

export function isProjectContextVerdict(input: unknown): input is ProjectContextVerdict {
  return includesValue(projectContextVerdicts, input);
}

export function parseProjectContextVerdict(input: unknown): ProjectContextVerdict | null {
  return isProjectContextVerdict(input) ? input : null;
}

export type ProjectSubjectBinding = Readonly<{
  id: string;
  projectId: string;
  departmentId: string;
  version: number;
  status: ProjectBindingStatus;
  kind: DepartmentChildScopeKind;
  subjectId: string;
  requestedResources: readonly DepartmentResourceGrant[];
  requestedModelProfileIds: readonly string[];
  requestedKnowledgeCollectionIds: readonly string[];
  requestedBudget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  additionalRequiredApprovalActions: readonly string[];
  additionalForbiddenActions: readonly string[];
}>;

export type ProjectContextReasonCode =
  | "invalid_input"
  | "invalid_project_manifest"
  | "invalid_department_manifest"
  | "invalid_binding"
  | "project_not_active"
  | "workspace_id_mismatch"
  | "binding_project_mismatch"
  | "department_not_found"
  | "duplicate_project_id"
  | "duplicate_department_id"
  | "duplicate_department_code"
  | "duplicate_binding_id"
  | "duplicate_subject_binding"
  | "department_scope_denied"
  | "binding_scope_denied"
  | "cross_project_resource_collision"
  | "cross_project_knowledge_collision"
  | "project_not_found"
  | "binding_not_found"
  | "binding_not_active"
  | "limit_exceeded";

export type ProjectContextReason = Readonly<{
  code: ProjectContextReasonCode;
  path: string;
  message: string;
  projectId: string | null;
  departmentId: string | null;
  bindingId: string | null;
}>;

export type NormalizedProjectContextDepartment = Readonly<{
  manifest: DepartmentManifest;
  decision: DepartmentEvaluationDecision;
  normalizedDepartment: NormalizedDepartmentManifest;
}>;

export type NormalizedProjectSubjectBinding = Readonly<{
  id: string;
  projectId: string;
  departmentId: string;
  version: number;
  status: ProjectBindingStatus;
  kind: DepartmentChildScopeKind;
  subjectId: string;
  requestedResources: readonly DepartmentResourceGrant[];
  requestedModelProfileIds: readonly string[];
  requestedKnowledgeCollectionIds: readonly string[];
  requestedBudget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  additionalRequiredApprovalActions: readonly string[];
  additionalForbiddenActions: readonly string[];
  decision: DepartmentChildScopeDecision;
  normalizedScope: NormalizedProjectChildScope;
  effectiveResources: readonly DepartmentResourceGrant[];
  effectiveModelProfileIds: readonly string[];
  effectiveKnowledgeCollectionIds: readonly string[];
  effectiveBudget: ProjectBudgetCeiling;
  effectiveExternalActionMode: ProjectExternalActionMode;
  effectiveDataEgressMode: ProjectDataEgressMode;
  effectiveRequiredApprovalActions: readonly string[];
  effectiveForbiddenActions: readonly string[];
}>;

export type NormalizedProjectContext = Readonly<{
  workspaceId: string;
  projectId: string;
  projectManifestVersion: number;
  projectManifest: ProjectManifest;
  departments: readonly NormalizedProjectContextDepartment[];
  bindings: readonly NormalizedProjectSubjectBinding[];
}>;

export type ProjectContextDecision = Readonly<{
  verdict: ProjectContextVerdict;
  reasons: readonly ProjectContextReason[];
  normalizedContext: NormalizedProjectContext | null;
}>;

export type WorkspaceProjectContextReasonCode = ProjectContextReasonCode;
export type WorkspaceProjectContextReason = ProjectContextReason;

export type NormalizedWorkspaceProjectContexts = Readonly<{
  workspaceId: string;
  projects: readonly NormalizedProjectContext[];
}>;

export type WorkspaceProjectContextsDecision = Readonly<{
  verdict: ProjectContextVerdict;
  reasons: readonly WorkspaceProjectContextReason[];
  normalizedRegistry: NormalizedWorkspaceProjectContexts | null;
}>;

export type NormalizedWorkspaceProjectContextRegistry = NormalizedWorkspaceProjectContexts;
export type WorkspaceProjectContextRegistryReason = WorkspaceProjectContextReason;
export type WorkspaceProjectContextRegistryDecision = WorkspaceProjectContextsDecision;

export type ProjectExecutionContextResource = Readonly<{
  resourceId: string;
  capabilities: readonly ProjectResourceCapability[];
}>;

export type ProjectExecutionContextSnapshot = Readonly<{
  workspaceId: string;
  projectId: string;
  projectManifestVersion: number;
  departmentId: string;
  departmentManifestVersion: number;
  departmentCode: NormalizedDepartmentManifest["code"];
  bindingId: string;
  bindingVersion: number;
  bindingKind: DepartmentChildScopeKind;
  subjectId: string;
  resources: readonly ProjectExecutionContextResource[];
  modelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  budget: ProjectBudgetCeiling;
  externalActionMode: ProjectExternalActionMode;
  dataEgressMode: ProjectDataEgressMode;
  requiredApprovalActions: readonly string[];
  forbiddenActions: readonly string[];
}>;

export type ProjectExecutionContextResolutionReasonCode = ProjectContextReasonCode;
export type ProjectExecutionContextResolutionReason = ProjectContextReason;

export type ProjectExecutionContextResolutionDecision = Readonly<{
  verdict: ProjectContextVerdict;
  reasons: readonly ProjectExecutionContextResolutionReason[];
  snapshot: ProjectExecutionContextSnapshot | null;
}>;

export type ProjectExecutionContextDecision = ProjectExecutionContextResolutionDecision;

type MutableReasons = ProjectContextReason[];
type BindingValidation = Readonly<{
  value: ProjectSubjectBinding | null;
  reasons: readonly ProjectContextReason[];
}>;

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const nonNewlineControlCharacterPattern = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const bindingFields = Object.freeze([
  "id",
  "projectId",
  "departmentId",
  "version",
  "status",
  "kind",
  "subjectId",
  "requestedResources",
  "requestedModelProfileIds",
  "requestedKnowledgeCollectionIds",
  "requestedBudget",
  "externalActionMode",
  "dataEgressMode",
  "additionalRequiredApprovalActions",
  "additionalForbiddenActions",
] as const);

const bindingBudgetValidationEnvelope = Object.freeze({
  id: "binding-budget-validation",
  workspaceId: "project-context-contract",
  version: 1,
  name: "Binding budget validation",
  slug: "binding-budget-validation",
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

function includesValue<const Values extends readonly string[]>(
  values: Values,
  input: unknown,
): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) && !(input instanceof Set);
}

function own(input: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(input, key) ? input[key] : undefined;
}

function addReason(
  reasons: MutableReasons,
  code: ProjectContextReasonCode,
  path: string,
  message: string,
  identifiers: Readonly<{
    projectId?: string | null;
    departmentId?: string | null;
    bindingId?: string | null;
  }> = {},
): void {
  if (reasons.length >= projectContextLimits.maxErrors) return;
  reasons.push({
    code,
    path,
    message,
    projectId: identifiers.projectId ?? null,
    departmentId: identifiers.departmentId ?? null,
    bindingId: identifiers.bindingId ?? null,
  });
}

function deny(reasons: readonly ProjectContextReason[]): ProjectContextDecision {
  return { verdict: "deny", reasons: reasons.map(cloneReason), normalizedContext: null };
}

function registryDeny(
  reasons: readonly ProjectContextReason[],
): WorkspaceProjectContextsDecision {
  return { verdict: "deny", reasons: reasons.map(cloneReason), normalizedRegistry: null };
}

function resolutionDeny(
  reasons: readonly ProjectContextReason[],
): ProjectExecutionContextResolutionDecision {
  return { verdict: "deny", reasons: reasons.map(cloneReason), snapshot: null };
}

function cloneReason(reason: ProjectContextReason): ProjectContextReason {
  return { ...reason };
}

function stableId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return safeIdPattern.test(value) && value.length <= projectContextLimits.maxIdLength
    ? value
    : null;
}

function positiveVersion(input: unknown): number | null {
  return Number.isSafeInteger(input) && (input as number) > 0 ? (input as number) : null;
}

function exactFields(
  input: Record<string, unknown>,
  fields: readonly string[],
): readonly string[] {
  const allowed = new Set(fields);
  return Object.keys(input).filter((field) => !allowed.has(field)).sort(compareStrings);
}

function cloneBudget(budget: ProjectBudgetCeiling): ProjectBudgetCeiling {
  return { ...budget };
}

function cloneGrants(resources: readonly DepartmentResourceGrant[]): DepartmentResourceGrant[] {
  return resources.map((resource) => ({
    resourceId: resource.resourceId,
    capabilities: [...resource.capabilities],
  }));
}

function cloneScope(scope: NormalizedProjectChildScope): NormalizedProjectChildScope {
  return {
    scopeKind: scope.scopeKind,
    scopeId: scope.scopeId,
    resources: cloneGrants(scope.resources),
    modelProfileIds: [...scope.modelProfileIds],
    knowledgeCollectionIds: [...scope.knowledgeCollectionIds],
    budget: cloneBudget(scope.budget),
    externalActionMode: scope.externalActionMode,
    dataEgressMode: scope.dataEgressMode,
    requiredApprovalActions: [...scope.requiredApprovalActions],
    forbiddenActions: [...scope.forbiddenActions],
  };
}

function cloneProjectManifest(manifest: ProjectManifest): ProjectManifest {
  return {
    ...manifest,
    goals: [...manifest.goals],
    nonGoals: [...manifest.nonGoals],
    tags: [...manifest.tags],
    resources: manifest.resources.map((resource) => ({
      ...resource,
      capabilities: [...resource.capabilities],
    })),
    allowedModelProfileIds: [...manifest.allowedModelProfileIds],
    knowledgeCollectionIds: [...manifest.knowledgeCollectionIds],
    policy: {
      ...manifest.policy,
      requiredApprovalActions: [...manifest.policy.requiredApprovalActions],
      forbiddenActions: [...manifest.policy.forbiddenActions],
    },
    budget: cloneBudget(manifest.budget),
  };
}

function cloneDepartmentManifest(manifest: DepartmentManifest): DepartmentManifest {
  return {
    ...manifest,
    goals: [...manifest.goals],
    nonGoals: [...manifest.nonGoals],
    resourceGrants: cloneGrants(manifest.resourceGrants),
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
    budget: cloneBudget(manifest.budget),
  };
}

function cloneNormalizedDepartment(
  department: NormalizedDepartmentManifest,
): NormalizedDepartmentManifest {
  return {
    ...cloneDepartmentManifest(department),
    projectScope: cloneScope(department.projectScope),
    effectiveResources: cloneGrants(department.effectiveResources),
    effectiveModelProfileIds: [...department.effectiveModelProfileIds],
    effectiveKnowledgeCollectionIds: [...department.effectiveKnowledgeCollectionIds],
    effectiveBudget: cloneBudget(department.effectiveBudget),
    effectiveExternalActionMode: department.effectiveExternalActionMode,
    effectiveDataEgressMode: department.effectiveDataEgressMode,
    effectiveRequiredApprovalActions: [...department.effectiveRequiredApprovalActions],
    effectiveForbiddenActions: [...department.effectiveForbiddenActions],
  };
}

function cloneDepartmentDecision(
  decision: DepartmentEvaluationDecision,
): DepartmentEvaluationDecision {
  return {
    verdict: decision.verdict,
    reasons: decision.reasons.map((reason) => ({ ...reason })),
    projectDecision: decision.projectDecision
      ? {
          ...decision.projectDecision,
          reasons: decision.projectDecision.reasons.map((reason) => ({ ...reason })),
          normalizedScope: decision.projectDecision.normalizedScope
            ? cloneScope(decision.projectDecision.normalizedScope)
            : null,
        }
      : null,
    normalizedDepartment: decision.normalizedDepartment
      ? cloneNormalizedDepartment(decision.normalizedDepartment)
      : null,
  };
}

function cloneChildDecision(
  decision: DepartmentChildScopeDecision,
): DepartmentChildScopeDecision {
  return {
    verdict: decision.verdict,
    scopeKind: decision.scopeKind,
    scopeId: decision.scopeId,
    reasons: decision.reasons.map((reason) => ({ ...reason })),
    departmentDecision: decision.departmentDecision
      ? cloneDepartmentDecision(decision.departmentDecision)
      : null,
    projectDecision: decision.projectDecision
      ? {
          ...decision.projectDecision,
          reasons: decision.projectDecision.reasons.map((reason) => ({ ...reason })),
          normalizedScope: decision.projectDecision.normalizedScope
            ? cloneScope(decision.projectDecision.normalizedScope)
            : null,
        }
      : null,
    normalizedScope: decision.normalizedScope ? cloneScope(decision.normalizedScope) : null,
  };
}

function normalizeIdList(
  input: unknown,
  path: string,
  maxItems: number,
  reasons: MutableReasons,
  ids: Readonly<{ projectId: string | null; departmentId: string | null; bindingId: string | null }>,
): string[] | null {
  if (!Array.isArray(input)) {
    addReason(reasons, "invalid_binding", path, `${path} must be an array.`, ids);
    return null;
  }
  if (input.length > maxItems) {
    addReason(reasons, "invalid_binding", path, `${path} exceeds its collection limit.`, ids);
    return null;
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.entries()) {
    const value = stableId(item);
    if (value === null) {
      addReason(reasons, "invalid_binding", `${path}[${index}]`, "Expected a stable ID.", ids);
      continue;
    }
    if (seen.has(value)) {
      addReason(reasons, "invalid_binding", `${path}[${index}]`, `Duplicate ID ${value}.`, ids);
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function normalizeTextList(
  input: unknown,
  path: string,
  maxItems: number,
  reasons: MutableReasons,
  ids: Readonly<{ projectId: string | null; departmentId: string | null; bindingId: string | null }>,
): string[] | null {
  if (!Array.isArray(input)) {
    addReason(reasons, "invalid_binding", path, `${path} must be an array.`, ids);
    return null;
  }
  if (input.length > maxItems) {
    addReason(reasons, "invalid_binding", path, `${path} exceeds its collection limit.`, ids);
    return null;
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.entries()) {
    const value = typeof item === "string" ? item.trim() : "";
    if (
      value.length === 0 ||
      value.length > departmentManifestLimits.maxTextListItemLength ||
      nonNewlineControlCharacterPattern.test(value)
    ) {
      addReason(reasons, "invalid_binding", `${path}[${index}]`, "Expected safe non-empty text.", ids);
      continue;
    }
    if (seen.has(value)) {
      addReason(reasons, "invalid_binding", `${path}[${index}]`, `Duplicate value ${value}.`, ids);
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function normalizeResources(
  input: unknown,
  path: string,
  reasons: MutableReasons,
  ids: Readonly<{ projectId: string | null; departmentId: string | null; bindingId: string | null }>,
): DepartmentResourceGrant[] | null {
  if (!Array.isArray(input)) {
    addReason(reasons, "invalid_binding", path, "requestedResources must be an array.", ids);
    return null;
  }
  if (input.length > projectManifestLimits.maxChildResourceGrants) {
    addReason(reasons, "invalid_binding", path, "requestedResources exceeds its collection limit.", ids);
    return null;
  }
  const output: DepartmentResourceGrant[] = [];
  const seen = new Set<string>();
  for (const [index, item] of input.entries()) {
    if (!isRecord(item) || exactFields(item, ["resourceId", "capabilities"]).length > 0) {
      addReason(reasons, "invalid_binding", `${path}[${index}]`, "Resource request must contain only resourceId and capabilities.", ids);
      continue;
    }
    const resourceId = stableId(own(item, "resourceId"));
    const capabilitiesInput = own(item, "capabilities");
    if (resourceId === null || !Array.isArray(capabilitiesInput) || capabilitiesInput.length === 0 || capabilitiesInput.length > projectResourceCapabilities.length) {
      addReason(reasons, "invalid_binding", `${path}[${index}]`, "Resource request is invalid.", ids);
      continue;
    }
    const capabilities: ProjectResourceCapability[] = [];
    const seenCapabilities = new Set<string>();
    for (const capability of capabilitiesInput) {
      if (!includesValue(projectResourceCapabilities, capability) || seenCapabilities.has(capability)) {
        addReason(reasons, "invalid_binding", `${path}[${index}].capabilities`, "Capabilities must be unique supported values.", ids);
        continue;
      }
      seenCapabilities.add(capability);
      capabilities.push(capability);
    }
    if (seen.has(resourceId)) {
      addReason(reasons, "invalid_binding", `${path}[${index}].resourceId`, `Duplicate resource ${resourceId}.`, ids);
      continue;
    }
    seen.add(resourceId);
    output.push({ resourceId, capabilities });
  }
  return output;
}

function normalizeBudget(
  input: unknown,
  path: string,
  reasons: MutableReasons,
  ids: Readonly<{ projectId: string | null; departmentId: string | null; bindingId: string | null }>,
): ProjectBudgetCeiling | null {
  const validation = validateAndNormalizeProjectManifest({
    ...bindingBudgetValidationEnvelope,
    budget: input,
  });
  if (validation.ok) return cloneBudget(validation.value.budget);
  const budgetErrors = validation.errors.filter(
    (error) => error.path === "budget" || error.path.startsWith("budget."),
  );
  if (budgetErrors.length === 0) {
    addReason(reasons, "invalid_binding", path, "requestedBudget is invalid.", ids);
  } else {
    for (const error of budgetErrors) {
      const reasonPath = error.path === "budget" ? path : `${path}${error.path.slice(6)}`;
      addReason(reasons, "invalid_binding", reasonPath, `requestedBudget validation failed (${error.code}).`, ids);
    }
  }
  return null;
}

function validateBinding(input: unknown, path: string): BindingValidation {
  const reasons: MutableReasons = [];
  if (!isRecord(input)) {
    addReason(reasons, "invalid_binding", path, "Binding must be an object.");
    return { value: null, reasons };
  }
  const rawId = typeof own(input, "id") === "string" ? String(own(input, "id")).trim() : null;
  const rawProjectId = typeof own(input, "projectId") === "string" ? String(own(input, "projectId")).trim() : null;
  const rawDepartmentId = typeof own(input, "departmentId") === "string" ? String(own(input, "departmentId")).trim() : null;
  const ids = { projectId: rawProjectId, departmentId: rawDepartmentId, bindingId: rawId };
  for (const field of exactFields(input, bindingFields)) {
    addReason(reasons, "invalid_binding", `${path}.${field}`, `Unknown binding field ${field}.`, ids);
  }
  for (const field of bindingFields) {
    if (!Object.hasOwn(input, field)) addReason(reasons, "invalid_binding", `${path}.${field}`, `Missing binding field ${field}.`, ids);
  }
  const id = stableId(own(input, "id"));
  const projectId = stableId(own(input, "projectId"));
  const departmentId = stableId(own(input, "departmentId"));
  const subjectId = stableId(own(input, "subjectId"));
  const version = positiveVersion(own(input, "version"));
  const status = parseProjectBindingStatus(own(input, "status"));
  const kind = includesValue(departmentChildScopeKinds, own(input, "kind"))
    ? own(input, "kind") as DepartmentChildScopeKind
    : null;
  for (const [field, value] of [["id", id], ["projectId", projectId], ["departmentId", departmentId], ["subjectId", subjectId]] as const) {
    if (value === null) addReason(reasons, "invalid_binding", `${path}.${field}`, `${field} must be a stable ID.`, ids);
  }
  if (version === null) addReason(reasons, "invalid_binding", `${path}.version`, "version must be a positive safe integer.", ids);
  if (status === null) addReason(reasons, "invalid_binding", `${path}.status`, "status is invalid.", ids);
  if (kind === null) addReason(reasons, "invalid_binding", `${path}.kind`, "kind must be agent or workflow.", ids);
  const requestedResources = normalizeResources(own(input, "requestedResources"), `${path}.requestedResources`, reasons, ids);
  const requestedModelProfileIds = normalizeIdList(own(input, "requestedModelProfileIds"), `${path}.requestedModelProfileIds`, departmentManifestLimits.maxModelProfileIds, reasons, ids);
  const requestedKnowledgeCollectionIds = normalizeIdList(own(input, "requestedKnowledgeCollectionIds"), `${path}.requestedKnowledgeCollectionIds`, departmentManifestLimits.maxKnowledgeCollectionIds, reasons, ids);
  const requestedBudget = normalizeBudget(own(input, "requestedBudget"), `${path}.requestedBudget`, reasons, ids);
  const externalActionMode = includesValue(projectExternalActionModes, own(input, "externalActionMode")) ? own(input, "externalActionMode") as ProjectExternalActionMode : null;
  const dataEgressMode = includesValue(projectDataEgressModes, own(input, "dataEgressMode")) ? own(input, "dataEgressMode") as ProjectDataEgressMode : null;
  if (externalActionMode === null) addReason(reasons, "invalid_binding", `${path}.externalActionMode`, "externalActionMode is invalid.", ids);
  if (dataEgressMode === null) addReason(reasons, "invalid_binding", `${path}.dataEgressMode`, "dataEgressMode is invalid.", ids);
  const additionalRequiredApprovalActions = normalizeTextList(own(input, "additionalRequiredApprovalActions"), `${path}.additionalRequiredApprovalActions`, departmentManifestLimits.maxAdditionalApprovalActions, reasons, ids);
  const additionalForbiddenActions = normalizeTextList(own(input, "additionalForbiddenActions"), `${path}.additionalForbiddenActions`, departmentManifestLimits.maxAdditionalForbiddenActions, reasons, ids);
  if (reasons.length > 0 || id === null || projectId === null || departmentId === null || subjectId === null || version === null || status === null || kind === null || requestedResources === null || requestedModelProfileIds === null || requestedKnowledgeCollectionIds === null || requestedBudget === null || externalActionMode === null || dataEgressMode === null || additionalRequiredApprovalActions === null || additionalForbiddenActions === null) {
    return { value: null, reasons };
  }
  return { value: { id, projectId, departmentId, version, status, kind, subjectId, requestedResources, requestedModelProfileIds, requestedKnowledgeCollectionIds, requestedBudget, externalActionMode, dataEgressMode, additionalRequiredApprovalActions, additionalForbiddenActions }, reasons: [] };
}

function cloneBinding(binding: ProjectSubjectBinding): ProjectSubjectBinding {
  return {
    ...binding,
    requestedResources: cloneGrants(binding.requestedResources),
    requestedModelProfileIds: [...binding.requestedModelProfileIds],
    requestedKnowledgeCollectionIds: [...binding.requestedKnowledgeCollectionIds],
    requestedBudget: cloneBudget(binding.requestedBudget),
    additionalRequiredApprovalActions: [...binding.additionalRequiredApprovalActions],
    additionalForbiddenActions: [...binding.additionalForbiddenActions],
  };
}

function evaluateProjectContextInternal(input: unknown): ProjectContextDecision {
  const reasons: MutableReasons = [];
  if (!isRecord(input)) {
    addReason(reasons, "invalid_input", "$", "Project Context input must be an object.");
    return deny(reasons);
  }
  const unknownFields = exactFields(input, ["projectManifest", "departmentManifests", "bindings"]);
  if (unknownFields.length > 0 || !Object.hasOwn(input, "projectManifest") || !Object.hasOwn(input, "departmentManifests") || !Object.hasOwn(input, "bindings")) {
    for (const field of unknownFields) addReason(reasons, "invalid_input", field, `Unknown Project Context field ${field}.`);
    if (!Object.hasOwn(input, "projectManifest")) addReason(reasons, "invalid_input", "projectManifest", "projectManifest is required.");
    if (!Object.hasOwn(input, "departmentManifests")) addReason(reasons, "invalid_input", "departmentManifests", "departmentManifests is required.");
    if (!Object.hasOwn(input, "bindings")) addReason(reasons, "invalid_input", "bindings", "bindings is required.");
    return deny(reasons);
  }
  const projectInput = own(input, "projectManifest");
  const rawProjectId = isRecord(projectInput) ? stableId(own(projectInput, "id")) : null;
  const projectValidation = validateAndNormalizeProjectManifest(projectInput);
  if (!projectValidation.ok) {
    for (const error of projectValidation.errors) addReason(reasons, "invalid_project_manifest", `projectManifest.${error.path}`, `ProjectManifest validation failed (${error.code}).`, { projectId: rawProjectId });
    return deny(reasons);
  }
  const project = projectValidation.value;
  if (project.status !== "active") {
    addReason(reasons, "project_not_active", "projectManifest.status", `Project ${project.id} is not active.`, { projectId: project.id });
    return deny(reasons);
  }
  const departmentInputs = own(input, "departmentManifests");
  if (!Array.isArray(departmentInputs)) {
    addReason(reasons, "invalid_department_manifest", "departmentManifests", "departmentManifests must be an array.", { projectId: project.id });
    return deny(reasons);
  }
  if (departmentInputs.length > projectContextLimits.maxDepartmentsPerProject) {
    addReason(reasons, "limit_exceeded", "departmentManifests", "Department collection exceeds the Project Context limit.", { projectId: project.id });
    return deny(reasons);
  }
  const departments: DepartmentManifest[] = [];
  for (const [index, departmentInput] of departmentInputs.entries()) {
    const validation = validateAndNormalizeDepartmentManifest(departmentInput);
    if (!validation.ok) {
      const departmentId = isRecord(departmentInput)
        ? stableId(own(departmentInput, "id"))
        : null;
      for (const error of validation.errors) addReason(reasons, "invalid_department_manifest", `departmentManifests[${index}].${error.path}`, `DepartmentManifest validation failed (${error.code}).`, { projectId: project.id, departmentId });
    } else {
      departments.push(validation.value);
    }
  }
  if (reasons.length > 0) return deny(reasons);
  const departmentIds = new Map<string, number>();
  const departmentCodes = new Map<string, number>();
  for (const [index, department] of departments.entries()) {
    if (departmentIds.has(department.id)) addReason(reasons, "duplicate_department_id", `departmentManifests[${index}].id`, `Department ID ${department.id} is duplicated.`, { projectId: project.id, departmentId: department.id });
    else departmentIds.set(department.id, index);
    if (departmentCodes.has(department.code)) addReason(reasons, "duplicate_department_code", `departmentManifests[${index}].code`, `Department code ${department.code} is duplicated.`, { projectId: project.id, departmentId: department.id });
    else departmentCodes.set(department.code, index);
  }
  if (reasons.length > 0) return deny(reasons);
  const bindingInputs = own(input, "bindings");
  if (!Array.isArray(bindingInputs)) {
    addReason(reasons, "invalid_binding", "bindings", "bindings must be an array.", { projectId: project.id });
    return deny(reasons);
  }
  if (bindingInputs.length > projectContextLimits.maxBindingsPerProject) {
    addReason(reasons, "limit_exceeded", "bindings", "Binding collection exceeds the Project Context limit.", { projectId: project.id });
    return deny(reasons);
  }
  const bindings: ProjectSubjectBinding[] = [];
  for (const [index, bindingInput] of bindingInputs.entries()) {
    const validation = validateBinding(bindingInput, `bindings[${index}]`);
    reasons.push(...validation.reasons.slice(0, projectContextLimits.maxErrors - reasons.length));
    if (validation.value) bindings.push(validation.value);
  }
  if (reasons.length > 0) return deny(reasons);
  for (const [index, binding] of bindings.entries()) {
    if (binding.projectId !== project.id) addReason(reasons, "binding_project_mismatch", `bindings[${index}].projectId`, `Binding ${binding.id} belongs to project ${binding.projectId}, not ${project.id}.`, { projectId: project.id, departmentId: binding.departmentId, bindingId: binding.id });
  }
  if (reasons.length > 0) return deny(reasons);
  const departmentsById = new Map(departments.map((department) => [department.id, department]));
  for (const [index, binding] of bindings.entries()) {
    if (!departmentsById.has(binding.departmentId)) addReason(reasons, "department_not_found", `bindings[${index}].departmentId`, `Department ${binding.departmentId} was not found in project ${project.id}.`, { projectId: project.id, departmentId: binding.departmentId, bindingId: binding.id });
  }
  if (reasons.length > 0) return deny(reasons);
  const bindingIds = new Set<string>();
  const subjects = new Set<string>();
  for (const [index, binding] of bindings.entries()) {
    if (bindingIds.has(binding.id)) addReason(reasons, "duplicate_binding_id", `bindings[${index}].id`, `Binding ID ${binding.id} is duplicated.`, { projectId: project.id, departmentId: binding.departmentId, bindingId: binding.id });
    bindingIds.add(binding.id);
    const subjectKey = `${binding.kind}:${binding.subjectId}`;
    if (subjects.has(subjectKey)) addReason(reasons, "duplicate_subject_binding", `bindings[${index}].subjectId`, `${binding.kind} ${binding.subjectId} has more than one binding in project ${project.id}.`, { projectId: project.id, departmentId: binding.departmentId, bindingId: binding.id });
    subjects.add(subjectKey);
  }
  if (reasons.length > 0) return deny(reasons);
  const normalizedDepartments: NormalizedProjectContextDepartment[] = [];
  for (const [index, department] of departments.entries()) {
    const decision = evaluateDepartmentManifest({ projectManifest: project, departmentManifest: department });
    if (decision.verdict === "deny" || decision.normalizedDepartment === null) {
      for (const cause of decision.reasons) addReason(reasons, "department_scope_denied", `departmentManifests[${index}].${cause.path}`, `Department scope denied (${cause.code}): ${cause.message}`, { projectId: project.id, departmentId: department.id });
    } else {
      const normalized = { manifest: cloneDepartmentManifest(department), decision: cloneDepartmentDecision(decision), normalizedDepartment: cloneNormalizedDepartment(decision.normalizedDepartment) };
      normalizedDepartments.push(normalized);
    }
  }
  if (reasons.length > 0) return deny(reasons);
  const normalizedBindings: NormalizedProjectSubjectBinding[] = [];
  for (const [index, binding] of bindings.entries()) {
    const department = departmentsById.get(binding.departmentId);
    if (!department) continue;
    const decision = evaluateDepartmentChildScope({
      projectManifest: project,
      departmentManifest: department,
      scopeKind: binding.kind,
      scopeId: binding.subjectId,
      requestedResources: binding.requestedResources,
      requestedModelProfileIds: binding.requestedModelProfileIds,
      requestedKnowledgeCollectionIds: binding.requestedKnowledgeCollectionIds,
      requestedBudget: binding.requestedBudget,
      externalActionMode: binding.externalActionMode,
      dataEgressMode: binding.dataEgressMode,
      additionalRequiredApprovalActions: binding.additionalRequiredApprovalActions,
      additionalForbiddenActions: binding.additionalForbiddenActions,
    });
    if (decision.verdict === "deny" || decision.normalizedScope === null) {
      for (const cause of decision.reasons) addReason(reasons, "binding_scope_denied", `bindings[${index}].${cause.path}`, `Binding scope denied (${cause.code}): ${cause.message}`, { projectId: project.id, departmentId: binding.departmentId, bindingId: binding.id });
    } else {
      const scope = cloneScope(decision.normalizedScope);
      normalizedBindings.push({
        ...cloneBinding(binding),
        decision: cloneChildDecision(decision),
        normalizedScope: cloneScope(scope),
        effectiveResources: cloneGrants(scope.resources),
        effectiveModelProfileIds: [...scope.modelProfileIds],
        effectiveKnowledgeCollectionIds: [...scope.knowledgeCollectionIds],
        effectiveBudget: cloneBudget(scope.budget),
        effectiveExternalActionMode: scope.externalActionMode,
        effectiveDataEgressMode: scope.dataEgressMode,
        effectiveRequiredApprovalActions: [...scope.requiredApprovalActions],
        effectiveForbiddenActions: [...scope.forbiddenActions],
      });
    }
  }
  if (reasons.length > 0) return deny(reasons);
  normalizedDepartments.sort((left, right) => compareStrings(left.manifest.id, right.manifest.id));
  normalizedBindings.sort((left, right) => compareStrings(left.id, right.id));
  return {
    verdict: "allow",
    reasons: [],
    normalizedContext: {
      workspaceId: project.workspaceId,
      projectId: project.id,
      projectManifestVersion: project.version,
      projectManifest: cloneProjectManifest(project),
      departments: normalizedDepartments,
      bindings: normalizedBindings,
    },
  };
}

export function evaluateProjectContext(input: unknown): ProjectContextDecision {
  try {
    return evaluateProjectContextInternal(input);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Project Context input could not be safely inspected.");
    return deny(reasons);
  }
}

function evaluateWorkspaceProjectContextsInternal(input: unknown): WorkspaceProjectContextsDecision {
  const reasons: MutableReasons = [];
  if (!isRecord(input)) {
    addReason(reasons, "invalid_input", "$", "Workspace Project Context Registry must be an object.");
    return registryDeny(reasons);
  }
  const unknownFields = exactFields(input, ["workspaceId", "projects"]);
  if (unknownFields.length > 0 || !Object.hasOwn(input, "workspaceId") || !Object.hasOwn(input, "projects")) {
    for (const field of unknownFields) addReason(reasons, "invalid_input", field, `Unknown Registry field ${field}.`);
    if (!Object.hasOwn(input, "workspaceId")) addReason(reasons, "invalid_input", "workspaceId", "workspaceId is required.");
    if (!Object.hasOwn(input, "projects")) addReason(reasons, "invalid_input", "projects", "projects is required.");
    return registryDeny(reasons);
  }
  const workspaceId = stableId(own(input, "workspaceId"));
  if (workspaceId === null) {
    addReason(reasons, "invalid_input", "workspaceId", "workspaceId must be a stable ID.");
    return registryDeny(reasons);
  }
  const projectInputs = own(input, "projects");
  if (!Array.isArray(projectInputs)) {
    addReason(reasons, "invalid_input", "projects", "projects must be an array.");
    return registryDeny(reasons);
  }
  if (projectInputs.length < 1 || projectInputs.length > projectContextLimits.maxProjects) {
    addReason(reasons, "limit_exceeded", "projects", "Registry must contain between one and maxProjects Project Contexts.");
    return registryDeny(reasons);
  }
  const evaluatedProjects: NormalizedProjectContext[] = [];
  for (const [index, projectInput] of projectInputs.entries()) {
    const decision = evaluateProjectContext(projectInput);
    if (decision.verdict === "deny" || decision.normalizedContext === null) {
      for (const reason of decision.reasons) addReason(reasons, reason.code, `projects[${index}].${reason.path}`, reason.message, reason);
    } else evaluatedProjects.push(decision.normalizedContext);
  }
  if (reasons.length > 0) return registryDeny(reasons);
  const projects = [...evaluatedProjects].sort((left, right) =>
    compareStrings(left.projectId, right.projectId),
  );
  const projectIds = new Set<string>();
  for (const [index, project] of projects.entries()) {
    if (projectIds.has(project.projectId)) addReason(reasons, "duplicate_project_id", `projects[${index}].projectManifest.id`, `Project ID ${project.projectId} is duplicated.`, { projectId: project.projectId });
    projectIds.add(project.projectId);
  }
  if (reasons.length > 0) return registryDeny(reasons);
  for (const [index, project] of projects.entries()) {
    if (project.workspaceId !== workspaceId) addReason(reasons, "workspace_id_mismatch", `projects[${index}].projectManifest.workspaceId`, `Project ${project.projectId} belongs to workspace ${project.workspaceId}, not ${workspaceId}.`, { projectId: project.projectId });
  }
  if (reasons.length > 0) return registryDeny(reasons);
  const globalBindings = new Map<string, string>();
  const globalDepartments = new Map<string, string>();
  for (const project of projects) {
    for (const department of project.departments) {
      const previous = globalDepartments.get(department.manifest.id);
      if (previous && previous !== project.projectId) addReason(reasons, "duplicate_department_id", "projects.departmentManifests.id", `Department ID ${department.manifest.id} is shared by projects ${previous} and ${project.projectId}.`, { projectId: project.projectId, departmentId: department.manifest.id });
      else globalDepartments.set(department.manifest.id, project.projectId);
    }
    for (const binding of project.bindings) {
      const previous = globalBindings.get(binding.id);
      if (previous && previous !== project.projectId) addReason(reasons, "duplicate_binding_id", "projects.bindings.id", `Binding ID ${binding.id} is shared by projects ${previous} and ${project.projectId}.`, { projectId: project.projectId, departmentId: binding.departmentId, bindingId: binding.id });
      else globalBindings.set(binding.id, project.projectId);
    }
  }
  if (reasons.length > 0) return registryDeny(reasons);
  const resources = new Map<string, Readonly<{ projectId: string; resourceId: string }>>();
  for (const project of projects) {
    for (const resource of project.projectManifest.resources) {
      const identity = `${resource.kind}\u0000${resource.resourceRef.trim()}`;
      const previous = resources.get(identity);
      if (previous && previous.projectId !== project.projectId) addReason(reasons, "cross_project_resource_collision", "projects.projectManifest.resources", `${resource.kind} resource ${previous.resourceId} in project ${previous.projectId} collides with resource ${resource.id} in project ${project.projectId}.`, { projectId: project.projectId });
      else resources.set(identity, { projectId: project.projectId, resourceId: resource.id });
    }
  }
  if (reasons.length > 0) return registryDeny(reasons);
  const knowledge = new Map<string, string>();
  for (const project of projects) {
    for (const collectionId of project.projectManifest.knowledgeCollectionIds) {
      const previous = knowledge.get(collectionId);
      if (previous && previous !== project.projectId) addReason(reasons, "cross_project_knowledge_collision", "projects.projectManifest.knowledgeCollectionIds", `Knowledge Collection ${collectionId} is shared by projects ${previous} and ${project.projectId}.`, { projectId: project.projectId });
      else knowledge.set(collectionId, project.projectId);
    }
  }
  if (reasons.length > 0) return registryDeny(reasons);
  return { verdict: "allow", reasons: [], normalizedRegistry: { workspaceId, projects } };
}

export function evaluateWorkspaceProjectContexts(input: unknown): WorkspaceProjectContextsDecision {
  try {
    return evaluateWorkspaceProjectContextsInternal(input);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Workspace Project Context Registry could not be safely inspected.");
    return registryDeny(reasons);
  }
}

function deepFreezeSnapshot(snapshot: ProjectExecutionContextSnapshot): ProjectExecutionContextSnapshot {
  for (const resource of snapshot.resources) {
    Object.freeze(resource.capabilities);
    Object.freeze(resource);
  }
  Object.freeze(snapshot.resources);
  Object.freeze(snapshot.modelProfileIds);
  Object.freeze(snapshot.knowledgeCollectionIds);
  Object.freeze(snapshot.budget);
  Object.freeze(snapshot.requiredApprovalActions);
  Object.freeze(snapshot.forbiddenActions);
  return Object.freeze(snapshot);
}

function resolveProjectExecutionContextInternal(input: unknown): ProjectExecutionContextResolutionDecision {
  const reasons: MutableReasons = [];
  if (!isRecord(input) || exactFields(input, ["registry", "projectId", "bindingId"]).length > 0 || !Object.hasOwn(input, "registry") || !Object.hasOwn(input, "projectId") || !Object.hasOwn(input, "bindingId")) {
    addReason(reasons, "invalid_input", "$", "Resolution input must contain only registry, projectId, and bindingId.");
    return resolutionDeny(reasons);
  }
  const projectId = stableId(own(input, "projectId"));
  const bindingId = stableId(own(input, "bindingId"));
  if (projectId === null || bindingId === null) {
    addReason(reasons, "invalid_input", projectId === null ? "projectId" : "bindingId", "Resolution IDs must be stable IDs.", { projectId, bindingId });
    return resolutionDeny(reasons);
  }
  const registryDecision = evaluateWorkspaceProjectContexts(own(input, "registry"));
  if (registryDecision.verdict === "deny" || registryDecision.normalizedRegistry === null) return resolutionDeny(registryDecision.reasons);
  const project = registryDecision.normalizedRegistry.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) {
    addReason(reasons, "project_not_found", "projectId", `Project ${projectId} was not found.`, { projectId, bindingId });
    return resolutionDeny(reasons);
  }
  const binding = project.bindings.find((candidate) => candidate.id === bindingId);
  if (!binding) {
    const otherProject = registryDecision.normalizedRegistry.projects.find((candidate) => candidate.projectId !== projectId && candidate.bindings.some((candidateBinding) => candidateBinding.id === bindingId));
    if (otherProject) addReason(reasons, "binding_project_mismatch", "bindingId", `Binding ${bindingId} belongs to project ${otherProject.projectId}, not ${projectId}.`, { projectId, bindingId });
    else addReason(reasons, "binding_not_found", "bindingId", `Binding ${bindingId} was not found in project ${projectId}.`, { projectId, bindingId });
    return resolutionDeny(reasons);
  }
  if (binding.status !== "active") {
    addReason(reasons, "binding_not_active", "binding.status", `Binding ${binding.id} has status ${binding.status}.`, { projectId, departmentId: binding.departmentId, bindingId });
    return resolutionDeny(reasons);
  }
  const department = project.departments.find((candidate) => candidate.manifest.id === binding.departmentId);
  if (!department) {
    addReason(reasons, "department_not_found", "binding.departmentId", `Department ${binding.departmentId} was not found.`, { projectId, departmentId: binding.departmentId, bindingId });
    return resolutionDeny(reasons);
  }
  const scope = binding.normalizedScope;
  const snapshot: ProjectExecutionContextSnapshot = {
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    projectManifestVersion: project.projectManifestVersion,
    departmentId: department.manifest.id,
    departmentManifestVersion: department.manifest.version,
    departmentCode: department.manifest.code,
    bindingId: binding.id,
    bindingVersion: binding.version,
    bindingKind: binding.kind,
    subjectId: binding.subjectId,
    resources: cloneGrants(scope.resources),
    modelProfileIds: [...scope.modelProfileIds],
    knowledgeCollectionIds: [...scope.knowledgeCollectionIds],
    budget: cloneBudget(scope.budget),
    externalActionMode: scope.externalActionMode,
    dataEgressMode: scope.dataEgressMode,
    requiredApprovalActions: [...scope.requiredApprovalActions],
    forbiddenActions: [...scope.forbiddenActions],
  };
  return { verdict: "allow", reasons: [], snapshot: deepFreezeSnapshot(snapshot) };
}

export function resolveProjectExecutionContext(input: unknown): ProjectExecutionContextResolutionDecision {
  try {
    return resolveProjectExecutionContextInternal(input);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Execution Context resolution input could not be safely inspected.");
    return resolutionDeny(reasons);
  }
}
