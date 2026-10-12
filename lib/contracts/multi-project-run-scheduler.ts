import type {
  NormalizedProjectContext,
  NormalizedProjectContextDepartment,
  NormalizedProjectSubjectBinding,
  NormalizedWorkspaceProjectContexts,
  ProjectExecutionContextSnapshot,
} from "./project-context";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkspaceProjectContexts, projectContextLimits, resolveProjectExecutionContext } from "./project-context.ts";

export const projectRunPriorities = Object.freeze(["P0", "P1", "P2", "P3", "P4"] as const);
export type ProjectRunPriority = (typeof projectRunPriorities)[number];
export const runPriorities = projectRunPriorities;
export type RunPriority = ProjectRunPriority;

export const multiProjectRunSchedulerStatuses = Object.freeze([
  "active",
  "paused",
  "disabled",
] as const);
export type MultiProjectRunSchedulerStatus =
  (typeof multiProjectRunSchedulerStatuses)[number];
export const schedulerStatuses = multiProjectRunSchedulerStatuses;
export type SchedulerStatus = MultiProjectRunSchedulerStatus;

export const multiProjectRunAdmissionVerdicts = Object.freeze(["admit", "deny"] as const);
export type MultiProjectRunAdmissionVerdict =
  (typeof multiProjectRunAdmissionVerdicts)[number];
export const admissionVerdicts = multiProjectRunAdmissionVerdicts;
export type AdmissionVerdict = MultiProjectRunAdmissionVerdict;
export const runAdmissionVerdicts = multiProjectRunAdmissionVerdicts;
export type RunAdmissionVerdict = MultiProjectRunAdmissionVerdict;

export const multiProjectRunDispatchPlanVerdicts = Object.freeze(["allow", "deny"] as const);
export type MultiProjectRunDispatchPlanVerdict =
  (typeof multiProjectRunDispatchPlanVerdicts)[number];
export const schedulerPlanVerdicts = multiProjectRunDispatchPlanVerdicts;
export const multiProjectRunSchedulerPlanVerdicts = multiProjectRunDispatchPlanVerdicts;
export type SchedulerPlanVerdict = MultiProjectRunDispatchPlanVerdict;
export type MultiProjectRunSchedulerPlanVerdict = MultiProjectRunDispatchPlanVerdict;

export const multiProjectRunSchedulerLimits = Object.freeze({
  maxIdLength: projectContextLimits.maxIdLength,
  maxProjectPolicies: projectContextLimits.maxProjects,
  maxQueuedRuns: 512,
  maxQueuedRunsPerProject: 256,
  maxRunningRuns: 128,
  maxWorkspaceConcurrentRuns: 128,
  maxErrors: 512,
});

function includesValue<const Values extends readonly string[]>(
  values: Values,
  input: unknown,
): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input);
}

export function isProjectRunPriority(input: unknown): input is ProjectRunPriority {
  return includesValue(projectRunPriorities, input);
}

export function parseProjectRunPriority(input: unknown): ProjectRunPriority | null {
  return isProjectRunPriority(input) ? input : null;
}

export const isRunPriority = isProjectRunPriority;
export const parseRunPriority = parseProjectRunPriority;

export function isMultiProjectRunSchedulerStatus(
  input: unknown,
): input is MultiProjectRunSchedulerStatus {
  return includesValue(multiProjectRunSchedulerStatuses, input);
}

export function parseMultiProjectRunSchedulerStatus(
  input: unknown,
): MultiProjectRunSchedulerStatus | null {
  return isMultiProjectRunSchedulerStatus(input) ? input : null;
}

export const isSchedulerStatus = isMultiProjectRunSchedulerStatus;
export const parseSchedulerStatus = parseMultiProjectRunSchedulerStatus;
export const isMultiProjectSchedulerStatus = isMultiProjectRunSchedulerStatus;
export const parseMultiProjectSchedulerStatus = parseMultiProjectRunSchedulerStatus;

export function isMultiProjectRunAdmissionVerdict(
  input: unknown,
): input is MultiProjectRunAdmissionVerdict {
  return includesValue(multiProjectRunAdmissionVerdicts, input);
}

export function parseMultiProjectRunAdmissionVerdict(
  input: unknown,
): MultiProjectRunAdmissionVerdict | null {
  return isMultiProjectRunAdmissionVerdict(input) ? input : null;
}

export const isAdmissionVerdict = isMultiProjectRunAdmissionVerdict;
export const parseAdmissionVerdict = parseMultiProjectRunAdmissionVerdict;
export const isRunAdmissionVerdict = isMultiProjectRunAdmissionVerdict;
export const parseRunAdmissionVerdict = parseMultiProjectRunAdmissionVerdict;

export function isMultiProjectRunDispatchPlanVerdict(
  input: unknown,
): input is MultiProjectRunDispatchPlanVerdict {
  return includesValue(multiProjectRunDispatchPlanVerdicts, input);
}

export function parseMultiProjectRunDispatchPlanVerdict(
  input: unknown,
): MultiProjectRunDispatchPlanVerdict | null {
  return isMultiProjectRunDispatchPlanVerdict(input) ? input : null;
}

export const isSchedulerPlanVerdict = isMultiProjectRunDispatchPlanVerdict;
export const parseSchedulerPlanVerdict = parseMultiProjectRunDispatchPlanVerdict;

export type MultiProjectRunProjectPolicy = Readonly<{
  projectId: string;
  status: MultiProjectRunSchedulerStatus;
  maxQueuedRuns: number;
  allowedPriorities: readonly ProjectRunPriority[];
}>;
export type MultiProjectRunSchedulerProjectPolicy = MultiProjectRunProjectPolicy;

export type MultiProjectRunSchedulerPolicy = Readonly<{
  workspaceId: string;
  status: MultiProjectRunSchedulerStatus;
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
  projectPolicies: readonly MultiProjectRunProjectPolicy[];
}>;

export type ProjectRunRequest = Readonly<{
  id: string;
  workspaceId: string;
  projectId: string;
  bindingId: string;
  modelProfileId: string;
  idempotencyKey: string;
  priority: ProjectRunPriority;
  sequence: number;
}>;
export type NormalizedProjectRunRequest = ProjectRunRequest;

export type RunningProjectRun = Readonly<{
  runId: string;
  requestId: string;
  workspaceId: string;
  projectId: string;
  bindingId: string;
  modelProfileId: string;
  idempotencyKey: string;
  priority: ProjectRunPriority;
  startedSequence: number;
}>;

export type MultiProjectRunSchedulerReasonCode =
  | "invalid_input"
  | "invalid_registry"
  | "invalid_policy"
  | "invalid_request"
  | "invalid_running_run"
  | "workspace_id_mismatch"
  | "project_policy_not_found"
  | "project_policy_unknown"
  | "priority_not_allowed"
  | "scheduler_paused"
  | "scheduler_disabled"
  | "project_paused"
  | "project_disabled"
  | "duplicate_request_id"
  | "duplicate_run_id"
  | "duplicate_idempotency_key"
  | "request_already_running"
  | "queue_capacity_exceeded"
  | "project_queue_capacity_exceeded"
  | "execution_context_denied"
  | "model_not_allowed"
  | "workspace_concurrency_exceeded"
  | "project_concurrency_exceeded"
  | "department_concurrency_exceeded"
  | "binding_concurrency_exceeded"
  | "running_state_capacity_exceeded"
  | "limit_exceeded";

export type MultiProjectRunSchedulerReason = Readonly<{
  code: MultiProjectRunSchedulerReasonCode;
  path: string;
  message: string;
  requestId: string | null;
  runId: string | null;
  projectId: string | null;
  departmentId: string | null;
  bindingId: string | null;
}>;
export type MultiProjectRunAdmissionReason = MultiProjectRunSchedulerReason;
export type MultiProjectRunDispatchPlanReason = MultiProjectRunSchedulerReason;

export type MultiProjectRunAdmissionDecision = Readonly<{
  verdict: MultiProjectRunAdmissionVerdict;
  reasons: readonly MultiProjectRunSchedulerReason[];
  normalizedRequest: ProjectRunRequest | null;
  executionContext: ProjectExecutionContextSnapshot | null;
}>;

export type MultiProjectRunDispatch = Readonly<{
  request: ProjectRunRequest;
  executionContext: ProjectExecutionContextSnapshot;
}>;

export type MultiProjectRunBlockedRequest = Readonly<{
  requestId: string;
  projectId: string;
  bindingId: string;
  reasons: readonly MultiProjectRunSchedulerReason[];
}>;

export type MultiProjectRunDispatchPlan = Readonly<{
  dispatches: readonly MultiProjectRunDispatch[];
  retainedRequestIds: readonly string[];
  blockedRequests: readonly MultiProjectRunBlockedRequest[];
  nextLastDispatchedProjectId: string | null;
}>;

export type MultiProjectRunDispatchPlanDecision = Readonly<{
  verdict: MultiProjectRunDispatchPlanVerdict;
  reasons: readonly MultiProjectRunSchedulerReason[];
  plan: MultiProjectRunDispatchPlan | null;
}>;

type MutableReasons = MultiProjectRunSchedulerReason[];
type SchedulerIdentifiers = Readonly<{
  requestId?: string | null;
  runId?: string | null;
  projectId?: string | null;
  departmentId?: string | null;
  bindingId?: string | null;
}>;

type EvaluatedRequest = Readonly<{
  sourcePath: string;
  request: ProjectRunRequest;
  executionContext: ProjectExecutionContextSnapshot;
  project: NormalizedProjectContext;
  department: NormalizedProjectContextDepartment;
  binding: NormalizedProjectSubjectBinding;
}>;

type EvaluatedRunningRun = Readonly<{
  sourcePath: string;
  run: RunningProjectRun;
  executionContext: ProjectExecutionContextSnapshot;
  project: NormalizedProjectContext;
  department: NormalizedProjectContextDepartment;
  binding: NormalizedProjectSubjectBinding;
}>;

type ValidatedState = Readonly<{
  registry: NormalizedWorkspaceProjectContexts;
  policy: MultiProjectRunSchedulerPolicy;
  queued: readonly EvaluatedRequest[];
  running: readonly EvaluatedRunningRun[];
}>;

type StateValidationResult =
  | Readonly<{ ok: true; value: ValidatedState }>
  | Readonly<{ ok: false; reasons: readonly MultiProjectRunSchedulerReason[] }>;

type SourceValue<Value> = Readonly<{
  value: Value;
  path: string;
}>;

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const policyFields = Object.freeze([
  "workspaceId",
  "status",
  "maxConcurrentRuns",
  "maxQueuedRuns",
  "projectPolicies",
] as const);
const projectPolicyFields = Object.freeze([
  "projectId",
  "status",
  "maxQueuedRuns",
  "allowedPriorities",
] as const);
const requestFields = Object.freeze([
  "id",
  "workspaceId",
  "projectId",
  "bindingId",
  "modelProfileId",
  "idempotencyKey",
  "priority",
  "sequence",
] as const);
const runningRunFields = Object.freeze([
  "runId",
  "requestId",
  "workspaceId",
  "projectId",
  "bindingId",
  "modelProfileId",
  "idempotencyKey",
  "priority",
  "startedSequence",
] as const);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    !(input instanceof Set)
  );
}

function own(input: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(input, field) ? input[field] : undefined;
}

function unknownFields(
  input: Record<string, unknown>,
  fields: readonly string[],
): readonly string[] {
  const allowed = new Set(fields);
  return Object.keys(input).filter((field) => !allowed.has(field)).sort(compareStrings);
}

function hasExactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  return (
    unknownFields(input, fields).length === 0 &&
    fields.every((field) => Object.hasOwn(input, field))
  );
}

function stableId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value.length <= multiProjectRunSchedulerLimits.maxIdLength && safeIdPattern.test(value)
    ? value
    : null;
}

function positiveSafeInteger(input: unknown, maximum?: number): number | null {
  if (!Number.isSafeInteger(input) || (input as number) <= 0) return null;
  if (maximum !== undefined && (input as number) > maximum) return null;
  return input as number;
}

function addReason(
  reasons: MutableReasons,
  code: MultiProjectRunSchedulerReasonCode,
  path: string,
  message: string,
  identifiers: SchedulerIdentifiers = {},
): void {
  if (reasons.length >= multiProjectRunSchedulerLimits.maxErrors) return;
  reasons.push({
    code,
    path,
    message,
    requestId: identifiers.requestId ?? null,
    runId: identifiers.runId ?? null,
    projectId: identifiers.projectId ?? null,
    departmentId: identifiers.departmentId ?? null,
    bindingId: identifiers.bindingId ?? null,
  });
}

function cloneReason(reason: MultiProjectRunSchedulerReason): MultiProjectRunSchedulerReason {
  return { ...reason };
}

function cloneRequest(request: ProjectRunRequest): ProjectRunRequest {
  return { ...request };
}

function clonePolicy(policy: MultiProjectRunSchedulerPolicy): MultiProjectRunSchedulerPolicy {
  return {
    ...policy,
    projectPolicies: policy.projectPolicies.map((projectPolicy) => ({
      ...projectPolicy,
      allowedPriorities: [...projectPolicy.allowedPriorities],
    })),
  };
}

function admissionDeny(
  reasons: readonly MultiProjectRunSchedulerReason[],
): MultiProjectRunAdmissionDecision {
  return {
    verdict: "deny",
    reasons: reasons.map(cloneReason),
    normalizedRequest: null,
    executionContext: null,
  };
}

function planDeny(
  reasons: readonly MultiProjectRunSchedulerReason[],
): MultiProjectRunDispatchPlanDecision {
  return { verdict: "deny", reasons: reasons.map(cloneReason), plan: null };
}

function validatePolicy(
  input: unknown,
  registry: NormalizedWorkspaceProjectContexts,
): Readonly<{
  value: MultiProjectRunSchedulerPolicy | null;
  reasons: readonly MultiProjectRunSchedulerReason[];
}> {
  const reasons: MutableReasons = [];
  if (!isRecord(input) || !hasExactFields(input, policyFields)) {
    addReason(reasons, "invalid_policy", "policy", "Scheduler policy must contain exactly the required own fields.");
    return { value: null, reasons };
  }
  const workspaceId = stableId(own(input, "workspaceId"));
  const status = parseMultiProjectRunSchedulerStatus(own(input, "status"));
  const maxConcurrentRuns = positiveSafeInteger(
    own(input, "maxConcurrentRuns"),
    multiProjectRunSchedulerLimits.maxWorkspaceConcurrentRuns,
  );
  const maxQueuedRuns = positiveSafeInteger(
    own(input, "maxQueuedRuns"),
    multiProjectRunSchedulerLimits.maxQueuedRuns,
  );
  const projectPoliciesInput = own(input, "projectPolicies");
  if (workspaceId === null) addReason(reasons, "invalid_policy", "policy.workspaceId", "Policy workspaceId must be a stable ID.");
  if (status === null) addReason(reasons, "invalid_policy", "policy.status", "Policy status is invalid.");
  if (maxConcurrentRuns === null) addReason(reasons, "invalid_policy", "policy.maxConcurrentRuns", "Workspace concurrency must be a positive bounded integer.");
  if (maxQueuedRuns === null) addReason(reasons, "invalid_policy", "policy.maxQueuedRuns", "Workspace queue limit must be a positive bounded integer.");
  if (!Array.isArray(projectPoliciesInput)) {
    addReason(reasons, "invalid_policy", "policy.projectPolicies", "projectPolicies must be an array.");
    return { value: null, reasons };
  }
  if (projectPoliciesInput.length > multiProjectRunSchedulerLimits.maxProjectPolicies) {
    addReason(reasons, "limit_exceeded", "policy.projectPolicies", "Project policy collection exceeds its absolute limit.");
    return { value: null, reasons };
  }
  const projectPolicies: Array<SourceValue<MultiProjectRunProjectPolicy>> = [];
  for (const [index, projectPolicyInput] of projectPoliciesInput.entries()) {
    const path = `policy.projectPolicies[${index}]`;
    if (!isRecord(projectPolicyInput) || !hasExactFields(projectPolicyInput, projectPolicyFields)) {
      addReason(reasons, "invalid_policy", path, "Project policy must contain exactly the required own fields.");
      continue;
    }
    const projectId = stableId(own(projectPolicyInput, "projectId"));
    const projectStatus = parseMultiProjectRunSchedulerStatus(own(projectPolicyInput, "status"));
    const projectMaxQueuedRuns = positiveSafeInteger(
      own(projectPolicyInput, "maxQueuedRuns"),
      multiProjectRunSchedulerLimits.maxQueuedRunsPerProject,
    );
    const prioritiesInput = own(projectPolicyInput, "allowedPriorities");
    if (projectId === null) addReason(reasons, "invalid_policy", `${path}.projectId`, "Project policy ID must be stable.");
    if (projectStatus === null) addReason(reasons, "invalid_policy", `${path}.status`, "Project policy status is invalid.", { projectId });
    if (projectMaxQueuedRuns === null || (maxQueuedRuns !== null && projectMaxQueuedRuns > maxQueuedRuns)) addReason(reasons, "invalid_policy", `${path}.maxQueuedRuns`, "Project queue limit must fit absolute and workspace limits.", { projectId });
    if (!Array.isArray(prioritiesInput) || prioritiesInput.length === 0 || prioritiesInput.length > projectRunPriorities.length) {
      addReason(reasons, "invalid_policy", `${path}.allowedPriorities`, "allowedPriorities must be a non-empty bounded array.", { projectId });
      continue;
    }
    const priorities: ProjectRunPriority[] = [];
    const seenPriorities = new Set<ProjectRunPriority>();
    for (const [priorityIndex, priorityInput] of prioritiesInput.entries()) {
      const priority = parseProjectRunPriority(priorityInput);
      if (priority === null) {
        addReason(reasons, "invalid_policy", `${path}.allowedPriorities[${priorityIndex}]`, "Priority is not canonical.", { projectId });
      } else if (seenPriorities.has(priority)) {
        addReason(reasons, "invalid_policy", `${path}.allowedPriorities[${priorityIndex}]`, `Priority ${priority} is duplicated.`, { projectId });
      } else {
        seenPriorities.add(priority);
        priorities.push(priority);
      }
    }
    if (projectId !== null && projectStatus !== null && projectMaxQueuedRuns !== null && (maxQueuedRuns === null || projectMaxQueuedRuns <= maxQueuedRuns) && priorities.length > 0) {
      priorities.sort((left, right) => projectRunPriorities.indexOf(left) - projectRunPriorities.indexOf(right));
      projectPolicies.push({
        value: {
          projectId,
          status: projectStatus,
          maxQueuedRuns: projectMaxQueuedRuns,
          allowedPriorities: priorities,
        },
        path,
      });
    }
  }
  if (reasons.length > 0 || workspaceId === null || status === null || maxConcurrentRuns === null || maxQueuedRuns === null) return { value: null, reasons };
  projectPolicies.sort((left, right) =>
    compareStrings(left.value.projectId, right.value.projectId),
  );
  const registryProjectIds = new Set(registry.projects.map((project) => project.projectId));
  const seenPolicies = new Set<string>();
  for (const projectPolicy of projectPolicies) {
    const { projectId } = projectPolicy.value;
    if (seenPolicies.has(projectId)) addReason(reasons, "invalid_policy", `${projectPolicy.path}.projectId`, `Project policy ${projectId} is duplicated.`, { projectId });
    seenPolicies.add(projectId);
    if (!registryProjectIds.has(projectId)) addReason(reasons, "project_policy_unknown", `${projectPolicy.path}.projectId`, `Project ${projectId} is not present in Registry.`, { projectId });
  }
  for (const project of registry.projects) {
    if (!seenPolicies.has(project.projectId)) addReason(reasons, "project_policy_not_found", "policy.projectPolicies", `Project ${project.projectId} has no scheduler policy.`, { projectId: project.projectId });
  }
  if (workspaceId !== registry.workspaceId) addReason(reasons, "workspace_id_mismatch", "policy.workspaceId", `Policy workspace ${workspaceId} does not match Registry workspace ${registry.workspaceId}.`);
  if (reasons.length > 0) return { value: null, reasons };
  return {
    value: {
      workspaceId,
      status,
      maxConcurrentRuns,
      maxQueuedRuns,
      projectPolicies: projectPolicies.map((projectPolicy) => projectPolicy.value),
    },
    reasons: [],
  };
}

function validateRequest(
  input: unknown,
  path: string,
): Readonly<{
  value: ProjectRunRequest | null;
  reasons: readonly MultiProjectRunSchedulerReason[];
}> {
  const reasons: MutableReasons = [];
  if (!isRecord(input) || !hasExactFields(input, requestFields)) {
    addReason(reasons, "invalid_request", path, "Run request must contain exactly the required own fields.");
    return { value: null, reasons };
  }
  const id = stableId(own(input, "id"));
  const workspaceId = stableId(own(input, "workspaceId"));
  const projectId = stableId(own(input, "projectId"));
  const bindingId = stableId(own(input, "bindingId"));
  const modelProfileId = stableId(own(input, "modelProfileId"));
  const idempotencyKey = stableId(own(input, "idempotencyKey"));
  const priority = parseProjectRunPriority(own(input, "priority"));
  const sequence = positiveSafeInteger(own(input, "sequence"));
  const identifiers = { requestId: id, projectId, bindingId };
  for (const [field, value] of [["id", id], ["workspaceId", workspaceId], ["projectId", projectId], ["bindingId", bindingId], ["modelProfileId", modelProfileId], ["idempotencyKey", idempotencyKey]] as const) {
    if (value === null) addReason(reasons, "invalid_request", `${path}.${field}`, `${field} must be a stable ID.`, identifiers);
  }
  if (priority === null) addReason(reasons, "invalid_request", `${path}.priority`, "priority is invalid.", identifiers);
  if (sequence === null) addReason(reasons, "invalid_request", `${path}.sequence`, "sequence must be a positive safe integer.", identifiers);
  if (reasons.length > 0 || id === null || workspaceId === null || projectId === null || bindingId === null || modelProfileId === null || idempotencyKey === null || priority === null || sequence === null) return { value: null, reasons };
  return { value: { id, workspaceId, projectId, bindingId, modelProfileId, idempotencyKey, priority, sequence }, reasons: [] };
}

function validateRunningRun(
  input: unknown,
  path: string,
): Readonly<{
  value: RunningProjectRun | null;
  reasons: readonly MultiProjectRunSchedulerReason[];
}> {
  const reasons: MutableReasons = [];
  if (!isRecord(input) || !hasExactFields(input, runningRunFields)) {
    addReason(reasons, "invalid_running_run", path, "Running run must contain exactly the required own fields.");
    return { value: null, reasons };
  }
  const runId = stableId(own(input, "runId"));
  const requestId = stableId(own(input, "requestId"));
  const workspaceId = stableId(own(input, "workspaceId"));
  const projectId = stableId(own(input, "projectId"));
  const bindingId = stableId(own(input, "bindingId"));
  const modelProfileId = stableId(own(input, "modelProfileId"));
  const idempotencyKey = stableId(own(input, "idempotencyKey"));
  const priority = parseProjectRunPriority(own(input, "priority"));
  const startedSequence = positiveSafeInteger(own(input, "startedSequence"));
  const identifiers = { requestId, runId, projectId, bindingId };
  for (const [field, value] of [["runId", runId], ["requestId", requestId], ["workspaceId", workspaceId], ["projectId", projectId], ["bindingId", bindingId], ["modelProfileId", modelProfileId], ["idempotencyKey", idempotencyKey]] as const) {
    if (value === null) addReason(reasons, "invalid_running_run", `${path}.${field}`, `${field} must be a stable ID.`, identifiers);
  }
  if (priority === null) addReason(reasons, "invalid_running_run", `${path}.priority`, "priority is invalid.", identifiers);
  if (startedSequence === null) addReason(reasons, "invalid_running_run", `${path}.startedSequence`, "startedSequence must be a positive safe integer.", identifiers);
  if (reasons.length > 0 || runId === null || requestId === null || workspaceId === null || projectId === null || bindingId === null || modelProfileId === null || idempotencyKey === null || priority === null || startedSequence === null) return { value: null, reasons };
  return { value: { runId, requestId, workspaceId, projectId, bindingId, modelProfileId, idempotencyKey, priority, startedSequence }, reasons: [] };
}

function findContextParts(
  registry: NormalizedWorkspaceProjectContexts,
  projectId: string,
  departmentId: string,
  bindingId: string,
): Readonly<{
  project: NormalizedProjectContext;
  department: NormalizedProjectContextDepartment;
  binding: NormalizedProjectSubjectBinding;
}> | null {
  const project = registry.projects.find((candidate) => candidate.projectId === projectId);
  const department = project?.departments.find((candidate) => candidate.manifest.id === departmentId);
  const binding = project?.bindings.find((candidate) => candidate.id === bindingId);
  return project && department && binding ? { project, department, binding } : null;
}

function resolveRequest(
  rawRegistry: unknown,
  registry: NormalizedWorkspaceProjectContexts,
  request: ProjectRunRequest,
  path: string,
): Readonly<{ value: EvaluatedRequest | null; reasons: readonly MultiProjectRunSchedulerReason[] }> {
  const reasons: MutableReasons = [];
  const identifiers = { requestId: request.id, projectId: request.projectId, bindingId: request.bindingId };
  if (request.workspaceId !== registry.workspaceId) {
    addReason(reasons, "workspace_id_mismatch", `${path}.workspaceId`, `Request workspace ${request.workspaceId} does not match Registry workspace ${registry.workspaceId}.`, identifiers);
    return { value: null, reasons };
  }
  const resolution = resolveProjectExecutionContext({ registry: rawRegistry, projectId: request.projectId, bindingId: request.bindingId });
  if (resolution.verdict === "deny" || resolution.snapshot === null) {
    addReason(reasons, "execution_context_denied", `${path}.bindingId`, `AI-016 execution context denied (${resolution.reasons.map((reason) => reason.code).join(", ")}).`, identifiers);
    return { value: null, reasons };
  }
  const snapshot = resolution.snapshot;
  if (!snapshot.modelProfileIds.includes(request.modelProfileId)) {
    addReason(reasons, "model_not_allowed", `${path}.modelProfileId`, `Model ${request.modelProfileId} is not allowed by binding ${request.bindingId}.`, { ...identifiers, departmentId: snapshot.departmentId });
    return { value: null, reasons };
  }
  const parts = findContextParts(registry, request.projectId, snapshot.departmentId, request.bindingId);
  if (parts === null) {
    addReason(reasons, "execution_context_denied", `${path}.bindingId`, "Resolved AI-016 context is absent from normalized Registry.", { ...identifiers, departmentId: snapshot.departmentId });
    return { value: null, reasons };
  }
  return { value: { sourcePath: path, request: cloneRequest(request), executionContext: snapshot, ...parts }, reasons: [] };
}

function resolveRunningRun(
  rawRegistry: unknown,
  registry: NormalizedWorkspaceProjectContexts,
  run: RunningProjectRun,
  path: string,
): Readonly<{ value: EvaluatedRunningRun | null; reasons: readonly MultiProjectRunSchedulerReason[] }> {
  const reasons: MutableReasons = [];
  const identifiers = { requestId: run.requestId, runId: run.runId, projectId: run.projectId, bindingId: run.bindingId };
  if (run.workspaceId !== registry.workspaceId) {
    addReason(reasons, "workspace_id_mismatch", `${path}.workspaceId`, `Running run workspace ${run.workspaceId} does not match Registry workspace ${registry.workspaceId}.`, identifiers);
    return { value: null, reasons };
  }
  const resolution = resolveProjectExecutionContext({ registry: rawRegistry, projectId: run.projectId, bindingId: run.bindingId });
  if (resolution.verdict === "deny" || resolution.snapshot === null) {
    addReason(reasons, "execution_context_denied", `${path}.bindingId`, `Running run AI-016 context denied (${resolution.reasons.map((reason) => reason.code).join(", ")}).`, identifiers);
    return { value: null, reasons };
  }
  const snapshot = resolution.snapshot;
  if (!snapshot.modelProfileIds.includes(run.modelProfileId)) {
    addReason(reasons, "model_not_allowed", `${path}.modelProfileId`, `Model ${run.modelProfileId} is not allowed by binding ${run.bindingId}.`, { ...identifiers, departmentId: snapshot.departmentId });
    return { value: null, reasons };
  }
  const parts = findContextParts(registry, run.projectId, snapshot.departmentId, run.bindingId);
  if (parts === null) {
    addReason(reasons, "execution_context_denied", `${path}.bindingId`, "Running run context is absent from normalized Registry.", { ...identifiers, departmentId: snapshot.departmentId });
    return { value: null, reasons };
  }
  return { value: { sourcePath: path, run: { ...run }, executionContext: snapshot, ...parts }, reasons: [] };
}

function validateState(
  rawRegistry: unknown,
  rawPolicy: unknown,
  queuedInput: unknown,
  runningInput: unknown,
): StateValidationResult {
  const reasons: MutableReasons = [];
  if (!Array.isArray(queuedInput)) {
    addReason(reasons, "invalid_input", "queuedRequests", "queuedRequests must be an array.");
    return { ok: false, reasons };
  }
  if (!Array.isArray(runningInput)) {
    addReason(reasons, "invalid_input", "runningRuns", "runningRuns must be an array.");
    return { ok: false, reasons };
  }
  if (queuedInput.length > multiProjectRunSchedulerLimits.maxQueuedRuns) {
    addReason(reasons, "limit_exceeded", "queuedRequests", "Queued state exceeds its absolute limit.");
    return { ok: false, reasons };
  }
  if (runningInput.length > multiProjectRunSchedulerLimits.maxRunningRuns) {
    addReason(reasons, "limit_exceeded", "runningRuns", "Running state exceeds its absolute limit.");
    return { ok: false, reasons };
  }
  const registryDecision = evaluateWorkspaceProjectContexts(rawRegistry);
  if (registryDecision.verdict === "deny" || registryDecision.normalizedRegistry === null) {
    addReason(reasons, "invalid_registry", "registry", `AI-016 Registry denied (${registryDecision.reasons.map((reason) => reason.code).join(", ")}).`);
    return { ok: false, reasons };
  }
  const registry = registryDecision.normalizedRegistry;
  const policyValidation = validatePolicy(rawPolicy, registry);
  if (policyValidation.value === null) return { ok: false, reasons: policyValidation.reasons };
  const policy = clonePolicy(policyValidation.value);
  const queuedRequests: Array<SourceValue<ProjectRunRequest>> = [];
  for (const [index, input] of queuedInput.entries()) {
    const validation = validateRequest(input, `queuedRequests[${index}]`);
    reasons.push(...validation.reasons.slice(0, multiProjectRunSchedulerLimits.maxErrors - reasons.length));
    if (validation.value) queuedRequests.push({ value: validation.value, path: `queuedRequests[${index}]` });
  }
  const runningRuns: Array<SourceValue<RunningProjectRun>> = [];
  for (const [index, input] of runningInput.entries()) {
    const validation = validateRunningRun(input, `runningRuns[${index}]`);
    reasons.push(...validation.reasons.slice(0, multiProjectRunSchedulerLimits.maxErrors - reasons.length));
    if (validation.value) runningRuns.push({ value: validation.value, path: `runningRuns[${index}]` });
  }
  if (reasons.length > 0) return { ok: false, reasons };
  queuedRequests.sort(
    (left, right) =>
      compareStrings(left.value.id, right.value.id) ||
      compareStrings(left.value.projectId, right.value.projectId) ||
      compareStrings(left.value.bindingId, right.value.bindingId) ||
      compareStrings(left.value.idempotencyKey, right.value.idempotencyKey),
  );
  runningRuns.sort(
    (left, right) =>
      compareStrings(left.value.runId, right.value.runId) ||
      compareStrings(left.value.requestId, right.value.requestId) ||
      compareStrings(left.value.projectId, right.value.projectId) ||
      compareStrings(left.value.bindingId, right.value.bindingId) ||
      compareStrings(left.value.idempotencyKey, right.value.idempotencyKey),
  );
  const requestIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const entry of queuedRequests) {
    const request = entry.value;
    if (requestIds.has(request.id)) addReason(reasons, "duplicate_request_id", `${entry.path}.id`, `Request ID ${request.id} is duplicated.`, { requestId: request.id, projectId: request.projectId, bindingId: request.bindingId });
    requestIds.add(request.id);
    if (idempotencyKeys.has(request.idempotencyKey)) addReason(reasons, "duplicate_idempotency_key", `${entry.path}.idempotencyKey`, `Idempotency key ${request.idempotencyKey} is duplicated.`, { requestId: request.id, projectId: request.projectId, bindingId: request.bindingId });
    idempotencyKeys.add(request.idempotencyKey);
  }
  const runIds = new Set<string>();
  const runningRequestIds = new Set<string>();
  const queuedRequestIds = new Set(requestIds);
  for (const entry of runningRuns) {
    const run = entry.value;
    if (runIds.has(run.runId)) addReason(reasons, "duplicate_run_id", `${entry.path}.runId`, `Run ID ${run.runId} is duplicated.`, { requestId: run.requestId, runId: run.runId, projectId: run.projectId, bindingId: run.bindingId });
    runIds.add(run.runId);
    if (runningRequestIds.has(run.requestId)) addReason(reasons, "duplicate_request_id", `${entry.path}.requestId`, `Running request ID ${run.requestId} is duplicated.`, { requestId: run.requestId, runId: run.runId, projectId: run.projectId, bindingId: run.bindingId });
    runningRequestIds.add(run.requestId);
    if (queuedRequestIds.has(run.requestId)) addReason(reasons, "request_already_running", `${entry.path}.requestId`, `Request ${run.requestId} is both queued and running.`, { requestId: run.requestId, runId: run.runId, projectId: run.projectId, bindingId: run.bindingId });
    if (idempotencyKeys.has(run.idempotencyKey)) addReason(reasons, "duplicate_idempotency_key", `${entry.path}.idempotencyKey`, `Idempotency key ${run.idempotencyKey} is duplicated.`, { requestId: run.requestId, runId: run.runId, projectId: run.projectId, bindingId: run.bindingId });
    requestIds.add(run.requestId);
    idempotencyKeys.add(run.idempotencyKey);
  }
  if (reasons.length > 0) return { ok: false, reasons };
  const queued: EvaluatedRequest[] = [];
  for (const entry of queuedRequests) {
    const resolution = resolveRequest(rawRegistry, registry, entry.value, entry.path);
    reasons.push(...resolution.reasons.slice(0, multiProjectRunSchedulerLimits.maxErrors - reasons.length));
    if (resolution.value) queued.push(resolution.value);
  }
  const running: EvaluatedRunningRun[] = [];
  for (const entry of runningRuns) {
    const resolution = resolveRunningRun(rawRegistry, registry, entry.value, entry.path);
    reasons.push(...resolution.reasons.slice(0, multiProjectRunSchedulerLimits.maxErrors - reasons.length));
    if (resolution.value) running.push(resolution.value);
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, value: { registry, policy, queued, running } };
}

function policyForProject(
  policy: MultiProjectRunSchedulerPolicy,
  projectId: string,
): MultiProjectRunProjectPolicy | null {
  return policy.projectPolicies.find((candidate) => candidate.projectId === projectId) ?? null;
}

function admissionEnvelope(input: unknown): input is Record<string, unknown> {
  return isRecord(input) && hasExactFields(input, ["registry", "policy", "queuedRequests", "runningRuns", "request"]);
}

function evaluateMultiProjectRunAdmissionInternal(input: unknown): MultiProjectRunAdmissionDecision {
  const reasons: MutableReasons = [];
  if (!admissionEnvelope(input)) {
    addReason(reasons, "invalid_input", "$", "Admission input must contain exactly registry, policy, queuedRequests, runningRuns, and request.");
    return admissionDeny(reasons);
  }
  const state = validateState(own(input, "registry"), own(input, "policy"), own(input, "queuedRequests"), own(input, "runningRuns"));
  if (!state.ok) return admissionDeny(state.reasons);
  const runningCapacity = evaluateExistingRunningCapacity(state.value);
  if (runningCapacity.reasons.length > 0) return admissionDeny(runningCapacity.reasons);
  const requestValidation = validateRequest(own(input, "request"), "request");
  if (requestValidation.value === null) return admissionDeny(requestValidation.reasons);
  const request = requestValidation.value;
  const identifiers = { requestId: request.id, projectId: request.projectId, bindingId: request.bindingId };
  if (request.workspaceId !== state.value.registry.workspaceId) {
    addReason(reasons, "workspace_id_mismatch", "request.workspaceId", `Request workspace ${request.workspaceId} does not match Registry workspace ${state.value.registry.workspaceId}.`, identifiers);
    return admissionDeny(reasons);
  }
  if (state.value.queued.some((candidate) => candidate.request.id === request.id)) addReason(reasons, "duplicate_request_id", "request.id", `Request ${request.id} is already queued.`, identifiers);
  const runningRequest = state.value.running.find((candidate) => candidate.run.requestId === request.id);
  if (runningRequest) addReason(reasons, "request_already_running", "request.id", `Request ${request.id} is already running as ${runningRequest.run.runId}.`, { ...identifiers, runId: runningRequest.run.runId });
  if ([...state.value.queued.map((candidate) => candidate.request.idempotencyKey), ...state.value.running.map((candidate) => candidate.run.idempotencyKey)].includes(request.idempotencyKey)) addReason(reasons, "duplicate_idempotency_key", "request.idempotencyKey", `Idempotency key ${request.idempotencyKey} is already known.`, identifiers);
  if (reasons.length > 0) return admissionDeny(reasons);
  const resolution = resolveRequest(own(input, "registry"), state.value.registry, request, "request");
  if (resolution.value === null) return admissionDeny(resolution.reasons);
  const projectPolicy = policyForProject(state.value.policy, request.projectId);
  if (projectPolicy === null) {
    addReason(reasons, "project_policy_not_found", "policy.projectPolicies", `Project ${request.projectId} has no scheduler policy.`, identifiers);
    return admissionDeny(reasons);
  }
  if (!projectPolicy.allowedPriorities.includes(request.priority)) addReason(reasons, "priority_not_allowed", "request.priority", `Priority ${request.priority} is not allowed for project ${request.projectId}.`, identifiers);
  if (state.value.policy.status === "disabled") addReason(reasons, "scheduler_disabled", "policy.status", "Workspace scheduler is disabled.", identifiers);
  if (projectPolicy.status === "disabled") addReason(reasons, "project_disabled", "policy.projectPolicies.status", `Project ${request.projectId} scheduler is disabled.`, identifiers);
  if (state.value.queued.length >= state.value.policy.maxQueuedRuns) addReason(reasons, "queue_capacity_exceeded", "queuedRequests", "Workspace queue capacity is exhausted.", identifiers);
  const projectQueueCount = state.value.queued.filter((candidate) => candidate.request.projectId === request.projectId).length;
  if (projectQueueCount >= projectPolicy.maxQueuedRuns) addReason(reasons, "project_queue_capacity_exceeded", "queuedRequests", `Project ${request.projectId} queue capacity is exhausted.`, identifiers);
  if (reasons.length > 0) return admissionDeny(reasons);
  return { verdict: "admit", reasons: [], normalizedRequest: cloneRequest(request), executionContext: resolution.value.executionContext };
}

export function evaluateMultiProjectRunAdmission(input: unknown): MultiProjectRunAdmissionDecision {
  try {
    return evaluateMultiProjectRunAdmissionInternal(input);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Admission input could not be safely inspected.");
    return admissionDeny(reasons);
  }
}

type CapacityCounts = {
  workspace: number;
  readonly projects: Map<string, number>;
  readonly departments: Map<string, number>;
  readonly bindings: Map<string, number>;
};

function capacityKey(projectId: string, id: string): string {
  return `${projectId}\u0000${id}`;
}

function createCapacityCounts(running: readonly EvaluatedRunningRun[]): CapacityCounts {
  const counts: CapacityCounts = { workspace: running.length, projects: new Map(), departments: new Map(), bindings: new Map() };
  for (const item of running) {
    counts.projects.set(item.run.projectId, (counts.projects.get(item.run.projectId) ?? 0) + 1);
    const departmentKey = capacityKey(item.run.projectId, item.executionContext.departmentId);
    counts.departments.set(departmentKey, (counts.departments.get(departmentKey) ?? 0) + 1);
    const bindingKey = capacityKey(item.run.projectId, item.run.bindingId);
    counts.bindings.set(bindingKey, (counts.bindings.get(bindingKey) ?? 0) + 1);
  }
  return counts;
}

function runningCapacityReasons(
  state: ValidatedState,
  counts: CapacityCounts,
): readonly MultiProjectRunSchedulerReason[] {
  const reasons: MutableReasons = [];
  if (counts.workspace > state.policy.maxConcurrentRuns) addReason(reasons, "running_state_capacity_exceeded", "runningRuns", `Running workspace count ${counts.workspace} exceeds scheduler ceiling ${state.policy.maxConcurrentRuns}.`);
  for (const project of state.registry.projects) {
    const count = counts.projects.get(project.projectId) ?? 0;
    if (count > project.projectManifest.budget.maxConcurrentRuns) addReason(reasons, "running_state_capacity_exceeded", "runningRuns", `Running count ${count} exceeds Project ${project.projectId} ceiling ${project.projectManifest.budget.maxConcurrentRuns}.`, { projectId: project.projectId });
    for (const department of project.departments) {
      const departmentCount = counts.departments.get(capacityKey(project.projectId, department.manifest.id)) ?? 0;
      if (departmentCount > department.normalizedDepartment.effectiveBudget.maxConcurrentRuns) addReason(reasons, "running_state_capacity_exceeded", "runningRuns", `Running count ${departmentCount} exceeds Department ${department.manifest.id} ceiling ${department.normalizedDepartment.effectiveBudget.maxConcurrentRuns}.`, { projectId: project.projectId, departmentId: department.manifest.id });
    }
    for (const binding of project.bindings) {
      const bindingCount = counts.bindings.get(capacityKey(project.projectId, binding.id)) ?? 0;
      if (bindingCount > binding.effectiveBudget.maxConcurrentRuns) addReason(reasons, "running_state_capacity_exceeded", "runningRuns", `Running count ${bindingCount} exceeds binding ${binding.id} ceiling ${binding.effectiveBudget.maxConcurrentRuns}.`, { projectId: project.projectId, departmentId: binding.departmentId, bindingId: binding.id });
    }
  }
  return reasons;
}

function evaluateExistingRunningCapacity(
  state: ValidatedState,
): Readonly<{
  counts: CapacityCounts;
  reasons: readonly MultiProjectRunSchedulerReason[];
}> {
  const counts = createCapacityCounts(state.running);
  return { counts, reasons: runningCapacityReasons(state, counts) };
}

function capacityBlockReasons(
  state: ValidatedState,
  item: EvaluatedRequest,
  counts: CapacityCounts,
): readonly MultiProjectRunSchedulerReason[] {
  const reasons: MutableReasons = [];
  const identifiers = { requestId: item.request.id, projectId: item.request.projectId, departmentId: item.executionContext.departmentId, bindingId: item.request.bindingId };
  if (counts.workspace >= state.policy.maxConcurrentRuns) addReason(reasons, "workspace_concurrency_exceeded", "policy.maxConcurrentRuns", "Workspace concurrency ceiling is full.", identifiers);
  const projectCount = counts.projects.get(item.request.projectId) ?? 0;
  if (projectCount >= item.project.projectManifest.budget.maxConcurrentRuns) addReason(reasons, "project_concurrency_exceeded", "projectManifest.budget.maxConcurrentRuns", `Project ${item.request.projectId} concurrency ceiling is full.`, identifiers);
  const departmentKey = capacityKey(item.request.projectId, item.executionContext.departmentId);
  const departmentCount = counts.departments.get(departmentKey) ?? 0;
  if (departmentCount >= item.department.normalizedDepartment.effectiveBudget.maxConcurrentRuns) addReason(reasons, "department_concurrency_exceeded", "departmentManifest.budget.maxConcurrentRuns", `Department ${item.executionContext.departmentId} concurrency ceiling is full.`, identifiers);
  const bindingKey = capacityKey(item.request.projectId, item.request.bindingId);
  const bindingCount = counts.bindings.get(bindingKey) ?? 0;
  if (bindingCount >= item.binding.effectiveBudget.maxConcurrentRuns) addReason(reasons, "binding_concurrency_exceeded", "binding.requestedBudget.maxConcurrentRuns", `Binding ${item.request.bindingId} concurrency ceiling is full.`, identifiers);
  return reasons;
}

function consumeCapacity(item: EvaluatedRequest, counts: CapacityCounts): void {
  counts.workspace += 1;
  counts.projects.set(item.request.projectId, (counts.projects.get(item.request.projectId) ?? 0) + 1);
  const departmentKey = capacityKey(item.request.projectId, item.executionContext.departmentId);
  counts.departments.set(departmentKey, (counts.departments.get(departmentKey) ?? 0) + 1);
  const bindingKey = capacityKey(item.request.projectId, item.request.bindingId);
  counts.bindings.set(bindingKey, (counts.bindings.get(bindingKey) ?? 0) + 1);
}

function canonicalRequestOrder(left: EvaluatedRequest, right: EvaluatedRequest): number {
  const priorityDifference = projectRunPriorities.indexOf(left.request.priority) - projectRunPriorities.indexOf(right.request.priority);
  if (priorityDifference !== 0) return priorityDifference;
  const projectDifference = compareStrings(left.request.projectId, right.request.projectId);
  if (projectDifference !== 0) return projectDifference;
  if (left.request.sequence !== right.request.sequence) return left.request.sequence - right.request.sequence;
  return compareStrings(left.request.id, right.request.id);
}

function rotatedProjectOrder(projectIds: readonly string[], cursor: string | null): readonly string[] {
  if (cursor === null) return [...projectIds];
  const index = projectIds.indexOf(cursor);
  return index < 0 ? [...projectIds] : [...projectIds.slice(index + 1), ...projectIds.slice(0, index + 1)];
}

function blockedRequest(
  item: EvaluatedRequest,
  reasons: readonly MultiProjectRunSchedulerReason[],
): MultiProjectRunBlockedRequest {
  return { requestId: item.request.id, projectId: item.request.projectId, bindingId: item.request.bindingId, reasons: reasons.map(cloneReason) };
}

function planEnvelope(input: unknown): input is Record<string, unknown> {
  return isRecord(input) && hasExactFields(input, ["registry", "policy", "queuedRequests", "runningRuns", "lastDispatchedProjectId"]);
}

function buildMultiProjectRunDispatchPlanInternal(input: unknown): MultiProjectRunDispatchPlanDecision {
  const reasons: MutableReasons = [];
  if (!planEnvelope(input)) {
    addReason(reasons, "invalid_input", "$", "Dispatch input must contain exactly registry, policy, queuedRequests, runningRuns, and lastDispatchedProjectId.");
    return planDeny(reasons);
  }
  const state = validateState(own(input, "registry"), own(input, "policy"), own(input, "queuedRequests"), own(input, "runningRuns"));
  if (!state.ok) return planDeny(state.reasons);
  const cursorInput = own(input, "lastDispatchedProjectId");
  const cursor = cursorInput === null ? null : stableId(cursorInput);
  if (cursorInput !== null && cursor === null) {
    addReason(reasons, "invalid_input", "lastDispatchedProjectId", "Round-robin cursor must be a stable project ID or null.");
    return planDeny(reasons);
  }
  if (cursor !== null && !state.value.registry.projects.some((project) => project.projectId === cursor)) {
    addReason(reasons, "invalid_input", "lastDispatchedProjectId", `Cursor project ${cursor} is not present in Registry.`, { projectId: cursor });
    return planDeny(reasons);
  }
  const runningCapacity = evaluateExistingRunningCapacity(state.value);
  if (runningCapacity.reasons.length > 0) return planDeny(runningCapacity.reasons);
  const counts = runningCapacity.counts;
  const dispatches: MultiProjectRunDispatch[] = [];
  const blocked: Array<Readonly<{ item: EvaluatedRequest; value: MultiProjectRunBlockedRequest }>> = [];
  let lastDispatchProjectId = cursor;
  const canonicalProjects = state.value.registry.projects.map((project) => project.projectId);
  for (const priority of projectRunPriorities) {
    const priorityItems = state.value.queued.filter((item) => item.request.priority === priority);
    const projectOrder = rotatedProjectOrder(canonicalProjects, lastDispatchProjectId).filter(
      (projectId) => priorityItems.some((item) => item.request.projectId === projectId),
    );
    const pending = new Map<string, EvaluatedRequest[]>();
    for (const projectId of projectOrder) {
      pending.set(
        projectId,
        priorityItems
          .filter((item) => item.request.projectId === projectId)
          .sort((left, right) => left.request.sequence - right.request.sequence || compareStrings(left.request.id, right.request.id)),
      );
    }
    while ([...pending.values()].some((items) => items.length > 0)) {
      for (const projectId of projectOrder) {
        const items = pending.get(projectId);
        const item = items?.shift();
        if (!item) continue;
        const projectPolicy = policyForProject(state.value.policy, projectId);
        const blockReasons: MutableReasons = [];
        const identifiers = { requestId: item.request.id, projectId, departmentId: item.executionContext.departmentId, bindingId: item.request.bindingId };
        if (state.value.policy.status === "paused") addReason(blockReasons, "scheduler_paused", "policy.status", "Workspace scheduler is paused.", identifiers);
        else if (state.value.policy.status === "disabled") addReason(blockReasons, "scheduler_disabled", "policy.status", "Workspace scheduler is disabled.", identifiers);
        else if (projectPolicy?.status === "paused") addReason(blockReasons, "project_paused", "policy.projectPolicies.status", `Project ${projectId} scheduler is paused.`, identifiers);
        else if (projectPolicy?.status === "disabled") addReason(blockReasons, "project_disabled", "policy.projectPolicies.status", `Project ${projectId} scheduler is disabled.`, identifiers);
        else if (projectPolicy && !projectPolicy.allowedPriorities.includes(item.request.priority)) addReason(blockReasons, "priority_not_allowed", `${item.sourcePath}.priority`, `Priority ${item.request.priority} is not allowed for project ${projectId}.`, identifiers);
        if (blockReasons.length === 0) blockReasons.push(...capacityBlockReasons(state.value, item, counts));
        if (blockReasons.length > 0) {
          blocked.push({ item, value: blockedRequest(item, blockReasons) });
        } else {
          dispatches.push({ request: cloneRequest(item.request), executionContext: item.executionContext });
          consumeCapacity(item, counts);
          lastDispatchProjectId = projectId;
        }
      }
    }
  }
  blocked.sort((left, right) => canonicalRequestOrder(left.item, right.item));
  return {
    verdict: "allow",
    reasons: [],
    plan: {
      dispatches,
      retainedRequestIds: blocked.map((entry) => entry.item.request.id),
      blockedRequests: blocked.map((entry) => entry.value),
      nextLastDispatchedProjectId: dispatches.length > 0 ? lastDispatchProjectId : cursor,
    },
  };
}

export function buildMultiProjectRunDispatchPlan(input: unknown): MultiProjectRunDispatchPlanDecision {
  try {
    return buildMultiProjectRunDispatchPlanInternal(input);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Dispatch plan input could not be safely inspected.");
    return planDeny(reasons);
  }
}
