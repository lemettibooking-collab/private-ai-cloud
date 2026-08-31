import { isProxy } from "node:util/types";
import type { ModelCapabilityRoutingDecision } from "../contracts/model-capability-routing-policy";
import type { ModelInvocationResult } from "../contracts/model-invocation";
import type { ModelInvocationExecutionDecision } from "../contracts/model-invocation-execution";
import type { ModelProviderIdentity } from "../contracts/model-provider-adapter";
import type { WorkflowAgentTaskStep } from "../contracts/workflow-manifest";
import type {
  WorkflowRunSnapshot,
  WorkflowRunTransitionDecision,
} from "../contracts/workflow-run";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateModelCapabilityRoutingPolicy } from "../contracts/model-capability-routing-policy.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { executeModelInvocation } from "../contracts/model-invocation-execution.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { resolveModelInvocationRoute } from "../contracts/model-provider-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData, freezeModelProviderAdapterData, modelProviderAdapterLimits, snapshotModelProviderAdapterInput } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkflowRunTransition, validateAndNormalizeWorkflowRunSnapshot, workflowRunLimits } from "../contracts/workflow-run.ts";

export const agentStepRuntimeVerdicts = Object.freeze(["allow", "deny"] as const);
export type AgentStepRuntimeVerdict = (typeof agentStepRuntimeVerdicts)[number];

export const agentStepRuntimeStatuses = Object.freeze([
  "completed",
  "denied",
  "failed",
  "approval_required",
  "unsupported_runtime",
] as const);
export type AgentStepRuntimeStatus = (typeof agentStepRuntimeStatuses)[number];

export const agentStepRuntimeLimits = Object.freeze({
  maxExecutionIdLength: 48,
  maxReasons: 256,
});

export type AgentStepRuntimeInput = Readonly<{
  runId: unknown;
  stepId: unknown;
  executionId: unknown;
  expectedRevision: unknown;
  expectedAttemptNumber: unknown;
  invocationDraft: unknown;
}>;

export type AgentStepRuntimeFactsQuery = Readonly<{
  runId: string;
  stepId: string;
}>;

export type AgentStepRuntimeFacts = Readonly<{
  snapshot: unknown;
  projectRegistry: unknown;
  modelProviderRegistry: unknown;
  existingRequests: unknown;
}>;

export interface AgentStepRuntimeFactsResolver {
  resolve(input: AgentStepRuntimeFactsQuery): unknown | Promise<unknown>;
}

export type AgentStepCapabilityRequirementsContext = Readonly<{
  workspaceId: string;
  projectId: string;
  departmentId: string;
  workflowId: string;
  runId: string;
  requestId: string;
  stepId: string;
  attemptNumber: number;
  agentId: string;
  agentBindingId: string;
  modelProfileId: string;
  outputType: string;
  actionMode: string;
  requiredApprovalAction: string | null;
  requestedResources: WorkflowAgentTaskStep["requestedResources"];
  knowledgeCollectionIds: readonly string[];
  toolIds: readonly string[];
  maxAttempts: number;
  timeoutMinutes: number;
  workflowBudget: WorkflowRunSnapshot["executionProfile"]["budget"];
}>;

export interface AgentStepCapabilityRequirementsResolver {
  resolve(input: AgentStepCapabilityRequirementsContext): unknown | Promise<unknown>;
}

export interface AgentStepRuntimeContext {
  now(): string;
}

export type AgentStepRuntimeReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "facts_resolver_invalid"
  | "facts_resolution_failed"
  | "invalid_runtime_facts"
  | "factual_linkage_mismatch"
  | "invalid_snapshot"
  | "step_not_found"
  | "step_not_executable"
  | "stale_runtime_input"
  | "requirements_resolver_invalid"
  | "requirements_resolution_failed"
  | "capability_denied"
  | "capability_budget_exceeded"
  | "approval_required"
  | "deterministic_runtime_unavailable"
  | "coding_runtime_unavailable"
  | "trusted_time_invalid"
  | "transition_denied"
  | "route_denied"
  | "invocation_replay_detected"
  | "invocation_linkage_mismatch"
  | "model_execution_denied"
  | "model_result_failed"
  | "tool_runtime_unavailable"
  | "budget_exceeded";

export type AgentStepRuntimeReason = Readonly<{
  code: AgentStepRuntimeReasonCode;
  path: string;
  message: string;
  runId: string | null;
  stepId: string | null;
  invocationId: string | null;
}>;

export type AgentStepModelExecutionDecision = Readonly<{
  verdict: ModelInvocationExecutionDecision["verdict"];
  status: ModelInvocationExecutionDecision["status"];
  reasons: ModelInvocationExecutionDecision["reasons"];
  routeDecision: ModelInvocationExecutionDecision["routeDecision"];
  selectedCandidate: ModelInvocationExecutionDecision["selectedCandidate"];
  healthDecision: ModelInvocationExecutionDecision["healthDecision"];
  providerVerdict: "allow" | "deny" | null;
  resultVerdict: "allow" | "deny" | null;
}>;

export type AgentStepRuntimeDecision = Readonly<{
  verdict: AgentStepRuntimeVerdict;
  status: AgentStepRuntimeStatus;
  reasons: readonly AgentStepRuntimeReason[];
  stepId: string | null;
  capabilityDecision: ModelCapabilityRoutingDecision | null;
  modelExecutionDecision: AgentStepModelExecutionDecision | null;
  previousSnapshot: WorkflowRunSnapshot | null;
  nextSnapshot: WorkflowRunSnapshot | null;
  normalizedResult: ModelInvocationResult | null;
}>;

type MutableReasons = AgentStepRuntimeReason[];
type CapturedRequirementsResolver = Readonly<{
  resolve: (input: AgentStepCapabilityRequirementsContext) => unknown | Promise<unknown>;
}>;
type CapturedFactsResolver = Readonly<{
  resolve: (input: AgentStepRuntimeFactsQuery) => unknown | Promise<unknown>;
}>;
type CapturedRuntimeContext = Readonly<{ now: () => unknown }>;

const inputFields = Object.freeze([
  "runId",
  "stepId",
  "executionId",
  "expectedRevision",
  "expectedAttemptNumber",
  "invocationDraft",
] as const);
const factsFields = Object.freeze([
  "snapshot",
  "projectRegistry",
  "modelProviderRegistry",
  "existingRequests",
] as const);
const factsResolverFields = Object.freeze(["resolve"] as const);
const requirementsResolverFields = Object.freeze(["resolve"] as const);
const runtimeContextFields = Object.freeze(["now"] as const);
const stableIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function includes<T>(values: readonly T[], input: unknown): input is T {
  return values.some((value) => value === input);
}

export function isAgentStepRuntimeVerdict(input: unknown): input is AgentStepRuntimeVerdict {
  return includes(agentStepRuntimeVerdicts, input);
}

export function parseAgentStepRuntimeVerdict(input: unknown): AgentStepRuntimeVerdict | null {
  return isAgentStepRuntimeVerdict(input) ? input : null;
}

export function isAgentStepRuntimeStatus(input: unknown): input is AgentStepRuntimeStatus {
  return includes(agentStepRuntimeStatuses, input);
}

export function parseAgentStepRuntimeStatus(input: unknown): AgentStepRuntimeStatus | null {
  return isAgentStepRuntimeStatus(input) ? input : null;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input) || isProxy(input)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function containsProxy(
  input: unknown,
  state: { inspected: number; seen: WeakSet<object> } = { inspected: 0, seen: new WeakSet() },
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

function hasExactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(input);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field));
}

function ownDataDescriptor(input: object, key: string): PropertyDescriptor | null {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor : null;
}

function stableId(
  input: unknown,
  maximum: number = workflowRunLimits.maxIdLength,
): string | null {
  return typeof input === "string" && input.length <= maximum && stableIdPattern.test(input)
    ? input
    : null;
}

function nonNegativeInteger(input: unknown): number | null {
  return Number.isSafeInteger(input) && (input as number) >= 0 ? input as number : null;
}

function positiveInteger(input: unknown): number | null {
  return Number.isSafeInteger(input) && (input as number) > 0 ? input as number : null;
}

function canonicalTimestamp(input: unknown): string | null {
  if (typeof input !== "string" || !canonicalTimestampPattern.test(input)) return null;
  try {
    return new Date(input).toISOString() === input ? input : null;
  } catch {
    return null;
  }
}

function addReason(
  reasons: MutableReasons,
  code: AgentStepRuntimeReasonCode,
  path: string,
  message: string,
  context: Partial<Pick<AgentStepRuntimeReason, "runId" | "stepId" | "invocationId">> = {},
): void {
  if (reasons.length >= agentStepRuntimeLimits.maxReasons) return;
  reasons.push({
    code,
    path,
    message,
    runId: context.runId ?? null,
    stepId: context.stepId ?? null,
    invocationId: context.invocationId ?? null,
  });
}

function decision(
  verdict: AgentStepRuntimeVerdict,
  status: AgentStepRuntimeStatus,
  reasons: readonly AgentStepRuntimeReason[],
  context: Readonly<{
    stepId?: string | null;
    capabilityDecision?: ModelCapabilityRoutingDecision | null;
    modelExecutionDecision?: ModelInvocationExecutionDecision | null;
    previousSnapshot?: WorkflowRunSnapshot | null;
    nextSnapshot?: WorkflowRunSnapshot | null;
    normalizedResult?: ModelInvocationResult | null;
  }> = {},
): AgentStepRuntimeDecision {
  return freezeModelProviderAdapterData({
    verdict,
    status,
    reasons: cloneModelProviderAdapterData(reasons),
    stepId: context.stepId ?? null,
    capabilityDecision: context.capabilityDecision
      ? cloneModelProviderAdapterData(context.capabilityDecision)
      : null,
    modelExecutionDecision: context.modelExecutionDecision
      ? cloneModelProviderAdapterData({
          verdict: context.modelExecutionDecision.verdict,
          status: context.modelExecutionDecision.status,
          reasons: context.modelExecutionDecision.reasons,
          routeDecision: context.modelExecutionDecision.routeDecision,
          selectedCandidate: context.modelExecutionDecision.selectedCandidate,
          healthDecision: context.modelExecutionDecision.healthDecision,
          providerVerdict: context.modelExecutionDecision.providerDecision?.verdict ?? null,
          resultVerdict: context.modelExecutionDecision.resultDecision?.verdict ?? null,
        })
      : null,
    previousSnapshot: context.previousSnapshot
      ? cloneModelProviderAdapterData(context.previousSnapshot)
      : null,
    nextSnapshot: context.nextSnapshot
      ? cloneModelProviderAdapterData(context.nextSnapshot)
      : null,
    normalizedResult: context.normalizedResult
      ? cloneModelProviderAdapterData(context.normalizedResult)
      : null,
  });
}

function captureFactsResolver(
  input: unknown,
  reasons: MutableReasons,
): CapturedFactsResolver | null {
  try {
    if (!isPlainRecord(input)) {
      addReason(
        reasons,
        "facts_resolver_invalid",
        "factsResolver",
        "Trusted runtime facts resolver must be an ordinary object.",
      );
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")
      || ownKeys.length !== factsResolverFields.length
      || !factsResolverFields.every((field) => ownKeys.includes(field))) {
      addReason(
        reasons,
        "facts_resolver_invalid",
        "factsResolver",
        "Trusted runtime facts resolver must contain exactly resolve.",
      );
      return null;
    }
    const resolveDescriptor = ownDataDescriptor(input, "resolve");
    if (!resolveDescriptor || typeof resolveDescriptor.value !== "function") {
      addReason(
        reasons,
        "facts_resolver_invalid",
        "factsResolver.resolve",
        "Trusted runtime facts resolver must expose an own callable data property.",
      );
      return null;
    }
    return { resolve: resolveDescriptor.value as CapturedFactsResolver["resolve"] };
  } catch {
    addReason(
      reasons,
      "facts_resolver_invalid",
      "factsResolver",
      "Trusted runtime facts resolver could not be safely captured.",
    );
    return null;
  }
}

function captureRequirementsResolver(
  input: unknown,
  reasons: MutableReasons,
): CapturedRequirementsResolver | null {
  try {
    if (!isPlainRecord(input)) {
      addReason(
        reasons,
        "requirements_resolver_invalid",
        "requirementsResolver",
        "Trusted capability requirements resolver must be an ordinary object.",
      );
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")
      || ownKeys.length !== requirementsResolverFields.length
      || !requirementsResolverFields.every((field) => ownKeys.includes(field))) {
      addReason(
        reasons,
        "requirements_resolver_invalid",
        "requirementsResolver",
        "Trusted capability requirements resolver must contain exactly resolve.",
      );
      return null;
    }
    const resolveDescriptor = ownDataDescriptor(input, "resolve");
    if (!resolveDescriptor || typeof resolveDescriptor.value !== "function") {
      addReason(
        reasons,
        "requirements_resolver_invalid",
        "requirementsResolver.resolve",
        "Trusted capability requirements resolver must expose an own callable data property.",
      );
      return null;
    }
    return { resolve: resolveDescriptor.value as CapturedRequirementsResolver["resolve"] };
  } catch {
    addReason(
      reasons,
      "requirements_resolver_invalid",
      "requirementsResolver",
      "Trusted capability requirements resolver could not be safely captured.",
    );
    return null;
  }
}

function captureRuntimeContext(
  input: unknown,
  reasons: MutableReasons,
): CapturedRuntimeContext | null {
  try {
    if (!isPlainRecord(input)) {
      addReason(
        reasons,
        "trusted_time_invalid",
        "runtimeContext",
        "Trusted runtime context must be an ordinary object.",
      );
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")
      || ownKeys.length !== runtimeContextFields.length
      || !runtimeContextFields.every((field) => ownKeys.includes(field))) {
      addReason(
        reasons,
        "trusted_time_invalid",
        "runtimeContext",
        "Trusted runtime context must contain exactly now.",
      );
      return null;
    }
    const nowDescriptor = ownDataDescriptor(input, "now");
    if (!nowDescriptor || typeof nowDescriptor.value !== "function") {
      addReason(
        reasons,
        "trusted_time_invalid",
        "runtimeContext.now",
        "Trusted runtime context must expose an own callable data property.",
      );
      return null;
    }
    return { now: nowDescriptor.value as CapturedRuntimeContext["now"] };
  } catch {
    addReason(
      reasons,
      "trusted_time_invalid",
      "runtimeContext",
      "Trusted runtime context could not be safely captured.",
    );
    return null;
  }
}

function requirementsContext(
  snapshot: WorkflowRunSnapshot,
  step: WorkflowAgentTaskStep,
  attemptNumber: number,
): AgentStepCapabilityRequirementsContext {
  return freezeModelProviderAdapterData({
    workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId,
    departmentId: snapshot.departmentId,
    workflowId: snapshot.workflowId,
    runId: snapshot.runId,
    requestId: snapshot.requestId,
    stepId: step.id,
    attemptNumber,
    agentId: step.agentId,
    agentBindingId: step.agentBindingId,
    modelProfileId: step.modelProfileId,
    outputType: step.outputType,
    actionMode: step.actionMode,
    requiredApprovalAction: step.requiredApprovalAction,
    requestedResources: cloneModelProviderAdapterData(step.requestedResources),
    knowledgeCollectionIds: [...step.knowledgeCollectionIds],
    toolIds: [...step.toolIds],
    maxAttempts: step.maxAttempts,
    timeoutMinutes: step.timeoutMinutes,
    workflowBudget: cloneModelProviderAdapterData(snapshot.executionProfile.budget),
  });
}

function capabilityBudgetFitsWorkflow(
  capabilityDecision: ModelCapabilityRoutingDecision,
  snapshot: WorkflowRunSnapshot,
): boolean {
  const budget = capabilityDecision.budget;
  if (!budget) return false;
  const dailyTokens = snapshot.executionProfile.budget.dailyTokenBudget;
  const monthlyCostMicros = snapshot.executionProfile.budget.monthlyCostBudgetUsdCents * 10_000;
  return budget.maxInputTokens <= dailyTokens
    && budget.maxOutputTokens <= dailyTokens - budget.maxInputTokens
    && budget.maxCostUsdMicros <= monthlyCostMicros;
}

function actualUsageFitsCapability(
  result: ModelInvocationResult,
  capabilityDecision: ModelCapabilityRoutingDecision,
): boolean {
  const budget = capabilityDecision.budget;
  return Boolean(budget)
    && result.usage.inputTokens <= (budget?.maxInputTokens ?? -1)
    && result.usage.outputTokens <= (budget?.maxOutputTokens ?? -1)
    && result.costUsdMicros <= (budget?.maxCostUsdMicros ?? -1);
}

function modelExecutionFailureIsRetryable(
  executionDecision: ModelInvocationExecutionDecision,
): boolean {
  return executionDecision.reasons.some(
    (reason) => reason.code === "provider_unavailable" || reason.code === "provider_exception",
  );
}

function identityForPrimary(candidate: Readonly<{
  providerId: string;
  providerKind: ModelProviderIdentity["providerKind"];
  deploymentId: string;
  providerModelId: string;
  providerModelVersion: string;
}>): ModelProviderIdentity {
  return {
    providerId: candidate.providerId,
    providerKind: candidate.providerKind,
    deploymentId: candidate.deploymentId,
    providerModelId: candidate.providerModelId,
    providerModelVersion: candidate.providerModelVersion,
  };
}

function transition(
  snapshot: WorkflowRunSnapshot,
  event: Record<string, unknown>,
): WorkflowRunTransitionDecision {
  return evaluateWorkflowRunTransition({ snapshot, event });
}

function eventCommon(
  snapshot: WorkflowRunSnapshot,
  executionId: string,
  suffix: "start" | "success" | "failure",
  occurredAt: string,
): Record<string, unknown> {
  return {
    eventId: `${executionId}.${suffix}`,
    runId: snapshot.runId,
    sequence: snapshot.revision + 1,
    occurredAt,
    actorKind: "system",
    actorId: "agent-step-runtime",
  };
}

function terminalFailure(
  startedSnapshot: WorkflowRunSnapshot,
  previousSnapshot: WorkflowRunSnapshot,
  executionId: string,
  occurredAt: string,
  stepId: string,
  capabilityDecision: ModelCapabilityRoutingDecision,
  modelExecutionDecision: ModelInvocationExecutionDecision | null,
  reasons: MutableReasons,
  error: Readonly<{ code: string; message: string; retryable: boolean }>,
): AgentStepRuntimeDecision {
  const failureTransition = transition(startedSnapshot, {
    ...eventCommon(startedSnapshot, executionId, "failure", occurredAt),
    kind: "step_failed",
    stepId,
    error,
  });
  if (failureTransition.verdict !== "allow" || !failureTransition.nextSnapshot) {
    addReason(
      reasons,
      "transition_denied",
      "step_failed",
      "Canonical Workflow Run failure transition denied.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "failed", reasons, {
      stepId,
      capabilityDecision,
      modelExecutionDecision,
      previousSnapshot,
    });
  }
  return decision("deny", "failed", reasons, {
    stepId,
    capabilityDecision,
    modelExecutionDecision,
    previousSnapshot,
    nextSnapshot: failureTransition.nextSnapshot,
  });
}

export async function executeAgentStep(
  input: unknown,
  factsResolver: unknown,
  providers: unknown,
  requirementsResolver: unknown,
  evidenceResolver?: unknown,
  runtimeContext?: unknown,
): Promise<AgentStepRuntimeDecision> {
  const reasons: MutableReasons = [];
  const boundary = containsProxy(input)
    ? { ok: false as const, limited: false as const }
    : snapshotModelProviderAdapterInput(input);
  if (!boundary.ok) {
    addReason(
      reasons,
      boundary.limited ? "limit_exceeded" : "invalid_input",
      "$",
      boundary.limited
        ? "Agent Step runtime input exceeds bounded inspection limits."
        : "Agent Step runtime input could not be safely inspected.",
    );
    return decision("deny", "denied", reasons);
  }
  if (!isPlainRecord(boundary.value) || !hasExactFields(boundary.value, inputFields)) {
    addReason(
      reasons,
      "invalid_input",
      "$",
      "Agent Step runtime input must contain exactly the canonical fields.",
    );
    return decision("deny", "denied", reasons);
  }

  const value = boundary.value;
  const runId = stableId(value.runId);
  const stepId = stableId(value.stepId);
  const executionId = stableId(value.executionId, agentStepRuntimeLimits.maxExecutionIdLength);
  const expectedRevision = nonNegativeInteger(value.expectedRevision);
  const expectedAttemptNumber = positiveInteger(value.expectedAttemptNumber);
  if (!runId || !stepId || !executionId
    || expectedRevision === null || expectedAttemptNumber === null) {
    addReason(
      reasons,
      "invalid_input",
      "$",
      "Runtime run/step identifiers, expected revision, and expected attempt must be canonical.",
    );
    return decision("deny", "denied", reasons, { stepId });
  }

  const capturedFactsResolver = captureFactsResolver(factsResolver, reasons);
  if (!capturedFactsResolver) {
    return decision("deny", "denied", reasons, { stepId });
  }
  let rawFacts: unknown;
  try {
    rawFacts = await capturedFactsResolver.resolve(freezeModelProviderAdapterData({ runId, stepId }));
  } catch {
    addReason(
      reasons,
      "facts_resolution_failed",
      "factsResolver.resolve",
      "Trusted runtime facts resolution failed closed.",
      { runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId });
  }
  const factsBoundary = containsProxy(rawFacts)
    ? { ok: false as const, limited: false as const }
    : snapshotModelProviderAdapterInput(rawFacts);
  if (!factsBoundary.ok) {
    addReason(
      reasons,
      factsBoundary.limited ? "limit_exceeded" : "invalid_runtime_facts",
      "factsResolver.resolve",
      factsBoundary.limited
        ? "Trusted runtime facts exceed bounded inspection limits."
        : "Trusted runtime facts could not be safely inspected.",
      { runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId });
  }
  if (!isPlainRecord(factsBoundary.value) || !hasExactFields(factsBoundary.value, factsFields)) {
    addReason(
      reasons,
      "invalid_runtime_facts",
      "factsResolver.resolve",
      "Trusted runtime facts must contain exactly snapshot, registries, and invocation history.",
      { runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId });
  }
  const facts = factsBoundary.value;
  const snapshotDecision = validateAndNormalizeWorkflowRunSnapshot(facts.snapshot);
  if (snapshotDecision.verdict !== "allow" || !snapshotDecision.normalizedSnapshot) {
    addReason(
      reasons,
      "invalid_snapshot",
      "factsResolver.resolve.snapshot",
      "Factual Workflow Run snapshot validation denied.",
      { runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId });
  }
  const previousSnapshot = snapshotDecision.normalizedSnapshot;
  if (previousSnapshot.runId !== runId) {
    addReason(
      reasons,
      "factual_linkage_mismatch",
      "runId",
      "Requested runId does not match the trusted factual Workflow Run.",
      { runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId, previousSnapshot });
  }
  const step = previousSnapshot.executionProfile.steps.find((candidate) => candidate.id === stepId);
  const stepState = previousSnapshot.stepStates.find((candidate) => candidate.stepId === stepId);
  if (!step || !stepState) {
    addReason(
      reasons,
      "step_not_found",
      "stepId",
      "Requested step was not found in the factual Workflow Run.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId, previousSnapshot });
  }
  if (step.kind !== "agent_task" || previousSnapshot.status !== "running"
    || stepState.status !== "pending" || !previousSnapshot.readyStepIds.includes(stepId)) {
    addReason(
      reasons,
      "step_not_executable",
      "stepId",
      "Factual step is not a currently ready pending Agent task.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId, previousSnapshot });
  }
  if (previousSnapshot.revision !== expectedRevision
    || stepState.attemptCount + 1 !== expectedAttemptNumber) {
    addReason(
      reasons,
      "stale_runtime_input",
      "expectedRevision",
      "Expected revision or attempt does not match the factual Workflow Run.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId, previousSnapshot });
  }

  const capturedRequirementsResolver = captureRequirementsResolver(requirementsResolver, reasons);
  if (!capturedRequirementsResolver) {
    return decision("deny", "denied", reasons, { stepId, previousSnapshot });
  }
  let rawRequirements: unknown;
  try {
    rawRequirements = await capturedRequirementsResolver.resolve(
      requirementsContext(previousSnapshot, step, expectedAttemptNumber),
    );
  } catch {
    addReason(
      reasons,
      "requirements_resolution_failed",
      "requirementsResolver.resolve",
      "Trusted capability requirements resolution failed closed.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, { stepId, previousSnapshot });
  }

  const capabilityDecision = evaluateModelCapabilityRoutingPolicy(rawRequirements);
  if (capabilityDecision.verdict !== "allow" || !capabilityDecision.authorizedCapability
    || !capabilityDecision.budget) {
    const approvalRequired = capabilityDecision.reasons.some(
      (reason) => reason.code === "risk_approval_required",
    );
    addReason(
      reasons,
      approvalRequired ? "approval_required" : "capability_denied",
      "capabilityDecision",
      approvalRequired
        ? "Capability execution requires approval orchestration outside AI-029."
        : "Factual AI-028.1 capability policy denied execution.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", approvalRequired ? "approval_required" : "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }
  if (!capabilityBudgetFitsWorkflow(capabilityDecision, previousSnapshot)) {
    addReason(
      reasons,
      "capability_budget_exceeded",
      "capabilityDecision.budget",
      "Capability budget exceeds the factual Workflow execution budget.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }
  if (capabilityDecision.authorizedCapability === "deterministic") {
    addReason(
      reasons,
      "deterministic_runtime_unavailable",
      "capabilityDecision.authorizedCapability",
      "Deterministic work belongs to a non-model runtime path.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "unsupported_runtime", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }
  if (capabilityDecision.authorizedCapability === "coding") {
    addReason(
      reasons,
      "coding_runtime_unavailable",
      "capabilityDecision.authorizedCapability",
      "Coding capability is eligible but no Coding Worker exists in AI-029 v1.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "unsupported_runtime", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }
  if (!capabilityDecision.modelExecutionAllowed) {
    addReason(
      reasons,
      "capability_denied",
      "capabilityDecision.modelExecutionAllowed",
      "Capability decision does not authorize model execution.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }

  const capturedRuntimeContext = captureRuntimeContext(runtimeContext, reasons);
  if (!capturedRuntimeContext) {
    return decision("deny", "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }
  let rawTime: unknown;
  try {
    rawTime = capturedRuntimeContext.now();
  } catch {
    addReason(
      reasons,
      "trusted_time_invalid",
      "runtimeContext.now",
      "Trusted runtime time capture failed closed.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }
  const occurredAt = canonicalTimestamp(rawTime);
  if (!occurredAt) {
    addReason(
      reasons,
      "trusted_time_invalid",
      "runtimeContext.now",
      "Trusted runtime time must be canonical UTC.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }

  const startTransition = transition(previousSnapshot, {
    ...eventCommon(previousSnapshot, executionId, "start", occurredAt),
    kind: "step_started",
    stepId,
  });
  if (startTransition.verdict !== "allow" || !startTransition.nextSnapshot) {
    addReason(
      reasons,
      "transition_denied",
      "step_started",
      "Canonical Workflow Run start transition denied.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }
  const startedSnapshot = startTransition.nextSnapshot;
  const startedState = startedSnapshot.stepStates.find((candidate) => candidate.stepId === stepId);
  if (!startedState || startedState.status !== "running"
    || startedState.attemptCount !== expectedAttemptNumber) {
    addReason(
      reasons,
      "transition_denied",
      "step_started",
      "Canonical start transition did not produce the expected factual attempt.",
      { runId: previousSnapshot.runId, stepId },
    );
    return decision("deny", "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }

  const routeInput = freezeModelProviderAdapterData({
    projectRegistry: cloneModelProviderAdapterData(facts.projectRegistry),
    modelProviderRegistry: cloneModelProviderAdapterData(facts.modelProviderRegistry),
    invocationAdmission: {
      snapshot: cloneModelProviderAdapterData(startedSnapshot),
      draft: cloneModelProviderAdapterData(value.invocationDraft),
      existingRequests: cloneModelProviderAdapterData(facts.existingRequests),
    },
  });
  const routeDecision = resolveModelInvocationRoute(routeInput);
  const request = routeDecision.invocationAdmissionDecision?.normalizedRequest ?? null;
  const primary = routeDecision.routePlan?.primary ?? null;
  if (routeDecision.verdict !== "allow" || !request || !primary) {
    addReason(
      reasons,
      "route_denied",
      "routeInput",
      "Factual AI-023 route resolution denied Agent Step execution.",
      { runId: previousSnapshot.runId, stepId },
    );
    return terminalFailure(
      startedSnapshot,
      previousSnapshot,
      executionId,
      occurredAt,
      stepId,
      capabilityDecision,
      null,
      reasons,
      { code: "model_route_denied", message: "Model route resolution denied.", retryable: false },
    );
  }
  if (request.runId !== startedSnapshot.runId || request.runRevision !== startedSnapshot.revision
    || request.stepId !== stepId || request.attemptNumber !== expectedAttemptNumber
    || request.agentId !== step.agentId || request.agentBindingId !== step.agentBindingId
    || request.modelProfileId !== step.modelProfileId || request.projectId !== startedSnapshot.projectId
    || request.workflowId !== startedSnapshot.workflowId) {
    addReason(
      reasons,
      "invocation_linkage_mismatch",
      "routeInput.invocationAdmission",
      "Factual invocation does not exactly match the started Agent Step attempt.",
      { runId: previousSnapshot.runId, stepId, invocationId: request.invocationId },
    );
    return terminalFailure(
      startedSnapshot,
      previousSnapshot,
      executionId,
      occurredAt,
      stepId,
      capabilityDecision,
      null,
      reasons,
      { code: "invocation_linkage_mismatch", message: "Invocation linkage denied.", retryable: false },
    );
  }
  if (routeDecision.invocationAdmissionDecision?.status === "idempotent") {
    addReason(
      reasons,
      "invocation_replay_detected",
      "factsResolver.resolve.existingRequests",
      "Trusted invocation history already contains this factual invocation.",
      { runId: previousSnapshot.runId, stepId, invocationId: request.invocationId },
    );
    return decision("deny", "denied", reasons, {
      stepId,
      capabilityDecision,
      previousSnapshot,
    });
  }

  const modelExecutionDecision = await executeModelInvocation(
    { routeInput, candidateIdentity: identityForPrimary(primary) },
    providers,
    evidenceResolver,
    { now: () => occurredAt },
  );
  if (modelExecutionDecision.verdict !== "allow" || !modelExecutionDecision.normalizedResult) {
    addReason(
      reasons,
      "model_execution_denied",
      "modelExecutionDecision",
      "Factual AI-028 model execution denied Agent Step completion.",
      { runId: previousSnapshot.runId, stepId, invocationId: request.invocationId },
    );
    return terminalFailure(
      startedSnapshot,
      previousSnapshot,
      executionId,
      occurredAt,
      stepId,
      capabilityDecision,
      modelExecutionDecision,
      reasons,
      {
        code: "model_execution_denied",
        message: "Model execution denied.",
        retryable: modelExecutionFailureIsRetryable(modelExecutionDecision),
      },
    );
  }
  const result = modelExecutionDecision.normalizedResult;
  if (!actualUsageFitsCapability(result, capabilityDecision)) {
    addReason(
      reasons,
      "budget_exceeded",
      "modelExecutionDecision.normalizedResult.usage",
      "Validated model usage exceeds the authorized capability budget.",
      { runId: previousSnapshot.runId, stepId, invocationId: request.invocationId },
    );
    return terminalFailure(
      startedSnapshot,
      previousSnapshot,
      executionId,
      occurredAt,
      stepId,
      capabilityDecision,
      modelExecutionDecision,
      reasons,
      { code: "capability_budget_exceeded", message: "Capability budget exceeded.", retryable: false },
    );
  }
  if (result.toolCallProposals.length > 0) {
    addReason(
      reasons,
      "tool_runtime_unavailable",
      "modelExecutionDecision.normalizedResult.toolCallProposals",
      "AI-029 v1 does not execute or complete tool-call proposals.",
      { runId: previousSnapshot.runId, stepId, invocationId: request.invocationId },
    );
    return terminalFailure(
      startedSnapshot,
      previousSnapshot,
      executionId,
      occurredAt,
      stepId,
      capabilityDecision,
      modelExecutionDecision,
      reasons,
      { code: "tool_runtime_unavailable", message: "Tool runtime unavailable.", retryable: false },
    );
  }
  if (result.outcome !== "succeeded") {
    addReason(
      reasons,
      "model_result_failed",
      "modelExecutionDecision.normalizedResult.outcome",
      "Validated provider result did not succeed.",
      { runId: previousSnapshot.runId, stepId, invocationId: request.invocationId },
    );
    return terminalFailure(
      startedSnapshot,
      previousSnapshot,
      executionId,
      occurredAt,
      stepId,
      capabilityDecision,
      modelExecutionDecision,
      reasons,
      {
        code: "model_result_failed",
        message: "Model result failed.",
        retryable: result.error?.retryable ?? false,
      },
    );
  }

  const successTransition = transition(startedSnapshot, {
    ...eventCommon(startedSnapshot, executionId, "success", occurredAt),
    kind: "step_succeeded",
    stepId,
    outputArtifactIds: [],
  });
  if (successTransition.verdict !== "allow" || !successTransition.nextSnapshot) {
    addReason(
      reasons,
      "transition_denied",
      "step_succeeded",
      "Canonical Workflow Run success transition denied.",
      { runId: previousSnapshot.runId, stepId, invocationId: request.invocationId },
    );
    return decision("deny", "failed", reasons, {
      stepId,
      capabilityDecision,
      modelExecutionDecision,
      previousSnapshot,
    });
  }
  return decision("allow", "completed", [], {
    stepId,
    capabilityDecision,
    modelExecutionDecision,
    previousSnapshot,
    nextSnapshot: successTransition.nextSnapshot,
    normalizedResult: result,
  });
}
