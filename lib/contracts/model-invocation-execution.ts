import type {
  ModelInvocationMessage,
  ModelInvocationReason,
  ModelInvocationRequest,
  ModelInvocationRequestValidationDecision,
  ModelInvocationResult,
  ModelInvocationResultDecision,
  ModelInvocationResultValidationDecision,
} from "./model-invocation";
import type {
  ModelDataHandlingRequirement,
  ModelInvocationRouteCandidate,
  ModelInvocationRouteResolutionDecision,
} from "./model-provider-registry";
import type {
  ModelProviderAdapterReason,
  ModelProviderAdapterRunDecision,
  ModelProviderHealthValidationDecision,
  ModelProviderIdentity,
} from "./model-provider-adapter";
import type {
  ModelInvocationDataHandlingDecision,
  ModelInvocationDataHandlingPermit,
} from "./model-invocation-data-handling";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateModelInvocationResult } from "./model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelInvocationLimits } from "./model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelInvocationRequest } from "./model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelInvocationResult } from "./model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelProviderRegistryLimits } from "./model-provider-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { resolveModelInvocationRoute } from "./model-provider-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData } from "./model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData } from "./model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isModelProviderAdapterVerdict } from "./model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelProviderAdapterLimits } from "./model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { snapshotModelProviderAdapterInput } from "./model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelProviderHealth } from "./model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelProviderIdentity } from "./model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createModelInvocationRequestFingerprint } from "./model-invocation-data-handling.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateModelInvocationDataHandling } from "./model-invocation-data-handling.ts";

export const modelInvocationExecutionVerdicts = Object.freeze(["allow", "deny"] as const);
export type ModelInvocationExecutionVerdict = (typeof modelInvocationExecutionVerdicts)[number];

export const modelInvocationExecutionStatuses = Object.freeze(["completed", "denied"] as const);
export type ModelInvocationExecutionStatus = (typeof modelInvocationExecutionStatuses)[number];

export const modelInvocationExecutionLimits = Object.freeze({
  maxProviders: modelProviderRegistryLimits.maxProviders,
  maxReasons: modelProviderAdapterLimits.maxReasons,
  maxResultDepth: modelInvocationLimits.maxEnvelopeDepth,
  maxResultProperties: modelInvocationLimits.maxInspectedProperties,
  maxResultArrayLength: modelInvocationLimits.maxEnvelopeArrayLength,
  maxResultStringLength: modelInvocationLimits.maxEnvelopeStringLength,
});

export type ModelInvocationExecutionReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "route_denied"
  | "invalid_provider_registry"
  | "duplicate_provider_identity"
  | "provider_not_registered"
  | "provider_identity_mismatch"
  | "data_handling_not_executable"
  | "data_handling_evidence_source_unavailable"
  | "data_handling_evidence_resolution_failed"
  | "data_handling_denied"
  | "data_handling_invariant_violation"
  | "invalid_health_decision"
  | "provider_unavailable"
  | "no_available_provider"
  | "provider_exception"
  | "invalid_provider_decision"
  | "provider_run_denied"
  | "result_evaluation_denied";

export type ModelInvocationExecutionReason = Readonly<{
  code: ModelInvocationExecutionReasonCode;
  path: string;
  message: string;
  invocationId: string | null;
  runId: string | null;
  projectId: string | null;
  modelProfileId: string | null;
  providerId: string | null;
  deploymentId: string | null;
}>;

export type ModelInvocationExecutionRouteDecision = Readonly<Pick<
  ModelInvocationRouteResolutionDecision,
  "verdict" | "reasons" | "routePlan"
>>;

export type ModelInvocationExecutionInput = Readonly<{
  routeInput: unknown;
  candidateIdentity: unknown;
}>;

export interface ModelInvocationExecutionRuntimeContext {
  now(): string;
}

type ModelInvocationDataHandlingEvidenceResolverInputCommon = Readonly<{
  requirement: "redaction_required" | "approval_required";
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
}>;

export type ModelInvocationRedactionEvidenceResolverInput =
  ModelInvocationDataHandlingEvidenceResolverInputCommon & Readonly<{
    requirement: "redaction_required";
    messages: readonly ModelInvocationMessage[];
  }>;

export type ModelInvocationApprovalEvidenceResolverInput =
  ModelInvocationDataHandlingEvidenceResolverInputCommon & Readonly<{
    requirement: "approval_required";
  }>;

export type ModelInvocationDataHandlingEvidenceResolverInput =
  | ModelInvocationRedactionEvidenceResolverInput
  | ModelInvocationApprovalEvidenceResolverInput;

export interface ModelInvocationDataHandlingEvidenceResolver {
  resolve(input: ModelInvocationDataHandlingEvidenceResolverInput): Promise<unknown | null>;
}

export type ModelInvocationExecutionDecision = Readonly<{
  verdict: ModelInvocationExecutionVerdict;
  status: ModelInvocationExecutionStatus;
  reasons: readonly ModelInvocationExecutionReason[];
  routeDecision: ModelInvocationExecutionRouteDecision;
  selectedCandidate: ModelInvocationRouteCandidate | null;
  healthDecision: ModelProviderHealthValidationDecision | null;
  providerDecision: ModelProviderAdapterRunDecision | null;
  resultDecision: ModelInvocationResultDecision | null;
  normalizedResult: ModelInvocationResult | null;
  dataHandlingPermit: ModelInvocationDataHandlingPermit | null;
}>;

type MutableReasons = ModelInvocationExecutionReason[];

type CapturedProvider = Readonly<{
  sourceIndex: number;
  path: string;
  identity: ModelProviderIdentity;
  health: () => unknown | Promise<unknown>;
  run: (input: unknown) => unknown | Promise<unknown>;
}>;

type CapturedEvidenceResolver = Readonly<{
  resolve: (input: ModelInvocationDataHandlingEvidenceResolverInput) => Promise<unknown | null>;
}>;

type CapturedRuntimeContext = Readonly<{
  now: () => unknown;
}>;

type HealthNormalization =
  | Readonly<{ kind: "valid"; decision: ModelProviderHealthValidationDecision }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "identity_mismatch"; decision: ModelProviderHealthValidationDecision }>;

type ProviderDecisionNormalization =
  | Readonly<{ kind: "valid"; decision: ModelProviderAdapterRunDecision }>
  | Readonly<{ kind: "invalid" }>;

const providerFields = Object.freeze(["identity", "run", "health"] as const);
const healthDecisionFields = Object.freeze(["verdict", "reasons", "normalizedHealth"] as const);
const providerDecisionFields = Object.freeze([
  "verdict",
  "reasons",
  "requestDecision",
  "resultDecision",
  "normalizedResult",
] as const);
const requestDecisionFields = Object.freeze(["verdict", "reasons", "normalizedRequest"] as const);
const resultValidationDecisionFields = Object.freeze(["verdict", "reasons", "normalizedResult"] as const);
const adapterReasonFields = Object.freeze([
  "code",
  "path",
  "message",
  "providerId",
  "deploymentId",
  "invocationId",
] as const);
const invocationReasonFields = Object.freeze([
  "code",
  "path",
  "message",
  "invocationId",
  "runId",
  "requestId",
  "projectId",
  "departmentId",
  "workflowId",
  "agentId",
  "stepId",
  "attemptNumber",
] as const);
const executionInputFields = Object.freeze([
  "routeInput",
  "candidateIdentity",
] as const);
const legacyRouteInputFields = Object.freeze([
  "projectRegistry",
  "modelProviderRegistry",
  "invocationAdmission",
] as const);
const evidenceResolverFields = Object.freeze(["resolve"] as const);
const runtimeContextFields = Object.freeze(["now"] as const);
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function includes<T>(values: readonly T[], input: unknown): input is T {
  return values.some((value) => value === input);
}

export function isModelInvocationExecutionVerdict(
  input: unknown,
): input is ModelInvocationExecutionVerdict {
  return includes(modelInvocationExecutionVerdicts, input);
}

export function parseModelInvocationExecutionVerdict(
  input: unknown,
): ModelInvocationExecutionVerdict | null {
  return isModelInvocationExecutionVerdict(input) ? input : null;
}

export function isModelInvocationExecutionStatus(
  input: unknown,
): input is ModelInvocationExecutionStatus {
  return includes(modelInvocationExecutionStatuses, input);
}

export function parseModelInvocationExecutionStatus(
  input: unknown,
): ModelInvocationExecutionStatus | null {
  return isModelInvocationExecutionStatus(input) ? input : null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(input);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field));
}

function isSafeText(input: unknown): input is string {
  return typeof input === "string"
    && input.length <= modelInvocationExecutionLimits.maxResultStringLength;
}

function isNullableSafeText(input: unknown): input is string | null {
  return input === null || isSafeText(input);
}

function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => sameData(value, right[index]));
  }
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.hasOwn(right, key) && sameData(left[key], right[key]));
  }
  return false;
}

function routeContext(
  routeDecision: ModelInvocationRouteResolutionDecision,
  candidate?: ModelInvocationRouteCandidate | null,
): Omit<ModelInvocationExecutionReason, "code" | "path" | "message"> {
  const plan = routeDecision.routePlan;
  return {
    invocationId: plan?.invocationId
      ?? routeDecision.invocationAdmissionDecision?.normalizedRequest?.invocationId
      ?? null,
    runId: plan?.runId
      ?? routeDecision.invocationAdmissionDecision?.normalizedRequest?.runId
      ?? null,
    projectId: plan?.projectId
      ?? routeDecision.invocationAdmissionDecision?.normalizedRequest?.projectId
      ?? null,
    modelProfileId: plan?.modelProfileId
      ?? routeDecision.invocationAdmissionDecision?.normalizedRequest?.modelProfileId
      ?? null,
    providerId: candidate?.providerId ?? null,
    deploymentId: candidate?.deploymentId ?? null,
  };
}

function addReason(
  reasons: MutableReasons,
  code: ModelInvocationExecutionReasonCode,
  path: string,
  message: string,
  routeDecision: ModelInvocationRouteResolutionDecision,
  candidate?: ModelInvocationRouteCandidate | null,
): void {
  if (reasons.length >= modelInvocationExecutionLimits.maxReasons) return;
  reasons.push({ code, path, message, ...routeContext(routeDecision, candidate) });
}

function cloneDecisionPart<T>(input: T): T {
  return cloneModelProviderAdapterData(input);
}

function auditSafeRouteDecision(
  input: ModelInvocationRouteResolutionDecision,
): ModelInvocationExecutionRouteDecision {
  return {
    verdict: input.verdict,
    reasons: cloneDecisionPart(input.reasons),
    routePlan: input.routePlan ? cloneDecisionPart(input.routePlan) : null,
  };
}

function executionDeny(
  routeDecision: ModelInvocationRouteResolutionDecision,
  reasons: readonly ModelInvocationExecutionReason[],
  healthDecision: ModelProviderHealthValidationDecision | null = null,
  providerDecision: ModelProviderAdapterRunDecision | null = null,
  resultDecision: ModelInvocationResultDecision | null = null,
): ModelInvocationExecutionDecision {
  return freezeModelProviderAdapterData({
    verdict: "deny",
    status: "denied",
    reasons: cloneDecisionPart(reasons),
    routeDecision: auditSafeRouteDecision(routeDecision),
    selectedCandidate: null,
    healthDecision: healthDecision ? cloneDecisionPart(healthDecision) : null,
    providerDecision: providerDecision ? cloneDecisionPart(providerDecision) : null,
    resultDecision: resultDecision ? cloneDecisionPart(resultDecision) : null,
    normalizedResult: null,
    dataHandlingPermit: null,
  });
}

function executionAllow(
  routeDecision: ModelInvocationRouteResolutionDecision,
  candidate: ModelInvocationRouteCandidate,
  healthDecision: ModelProviderHealthValidationDecision,
  providerDecision: ModelProviderAdapterRunDecision,
  resultDecision: ModelInvocationResultDecision,
  result: ModelInvocationResult,
  permit: ModelInvocationDataHandlingPermit,
): ModelInvocationExecutionDecision {
  return freezeModelProviderAdapterData({
    verdict: "allow",
    status: "completed",
    reasons: [],
    routeDecision: auditSafeRouteDecision(routeDecision),
    selectedCandidate: cloneDecisionPart(candidate),
    healthDecision: cloneDecisionPart(healthDecision),
    providerDecision: cloneDecisionPart(providerDecision),
    resultDecision: cloneDecisionPart(resultDecision),
    normalizedResult: cloneDecisionPart(result),
    dataHandlingPermit: cloneDecisionPart(permit),
  });
}

function ownDataDescriptor(
  input: object,
  key: string,
): PropertyDescriptor | null {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor : null;
}

function deniedRouteDecision(): ModelInvocationRouteResolutionDecision {
  return resolveModelInvocationRoute({});
}

function canonicalTimestamp(input: unknown): string | null {
  if (typeof input !== "string" || !canonicalTimestampPattern.test(input)) return null;
  try {
    return new Date(input).toISOString() === input ? input : null;
  } catch {
    return null;
  }
}

function captureEvidenceResolver(
  input: unknown,
  routeDecision: ModelInvocationRouteResolutionDecision,
  reasons: MutableReasons,
): CapturedEvidenceResolver | null {
  if (input === undefined) return null;
  try {
    if (!isPlainRecord(input)) {
      addReason(
        reasons,
        "invalid_input",
        "evidenceResolver",
        "Trusted evidence resolver must be an ordinary object.",
        routeDecision,
      );
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")
      || ownKeys.length !== evidenceResolverFields.length
      || !evidenceResolverFields.every((field) => ownKeys.includes(field))) {
      addReason(
        reasons,
        "invalid_input",
        "evidenceResolver",
        "Trusted evidence resolver must contain exactly one resolve data property.",
        routeDecision,
      );
      return null;
    }
    const resolveDescriptor = ownDataDescriptor(input, "resolve");
    if (!resolveDescriptor || typeof resolveDescriptor.value !== "function") {
      addReason(
        reasons,
        "invalid_input",
        "evidenceResolver.resolve",
        "Trusted evidence resolver resolve must be an own callable data property.",
        routeDecision,
      );
      return null;
    }
    return {
      resolve: resolveDescriptor.value as CapturedEvidenceResolver["resolve"],
    };
  } catch {
    addReason(
      reasons,
      "invalid_input",
      "evidenceResolver",
      "Trusted evidence resolver could not be safely captured.",
      routeDecision,
    );
    return null;
  }
}

function captureRuntimeContext(
  input: unknown,
  routeDecision: ModelInvocationRouteResolutionDecision,
  reasons: MutableReasons,
): CapturedRuntimeContext | null {
  try {
    if (!isPlainRecord(input)) {
      addReason(
        reasons,
        "invalid_input",
        "runtimeContext",
        "Trusted runtime context must be an ordinary object.",
        routeDecision,
      );
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")
      || ownKeys.length !== runtimeContextFields.length
      || !runtimeContextFields.every((field) => ownKeys.includes(field))) {
      addReason(
        reasons,
        "invalid_input",
        "runtimeContext",
        "Trusted runtime context must contain exactly one now data property.",
        routeDecision,
      );
      return null;
    }
    const nowDescriptor = ownDataDescriptor(input, "now");
    if (!nowDescriptor || typeof nowDescriptor.value !== "function") {
      addReason(
        reasons,
        "invalid_input",
        "runtimeContext.now",
        "Trusted runtime context now must be an own callable data property.",
        routeDecision,
      );
      return null;
    }
    return { now: nowDescriptor.value as CapturedRuntimeContext["now"] };
  } catch {
    addReason(
      reasons,
      "invalid_input",
      "runtimeContext",
      "Trusted runtime context could not be safely captured.",
      routeDecision,
    );
    return null;
  }
}

function identityForCandidate(candidate: ModelInvocationRouteCandidate): ModelProviderIdentity {
  return {
    providerId: candidate.providerId,
    providerKind: candidate.providerKind,
    deploymentId: candidate.deploymentId,
    providerModelId: candidate.providerModelId,
    providerModelVersion: candidate.providerModelVersion,
  };
}

function requirementMatchesDeployment(candidate: ModelInvocationRouteCandidate): boolean {
  return (candidate.dataHandlingRequirement === "local_only" && candidate.deploymentMode === "local")
    || (candidate.dataHandlingRequirement !== "local_only" && candidate.deploymentMode === "remote");
}

function evidenceResolverInput(
  requirement: Exclude<ModelDataHandlingRequirement, "local_only">,
  request: ModelInvocationRequest,
  identity: ModelProviderIdentity,
  evaluatedAt: string,
  sourceRequestFingerprint: string,
): ModelInvocationDataHandlingEvidenceResolverInput {
  const common = {
    requirement,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    runId: request.runId,
    invocationId: request.invocationId,
    runRevision: request.runRevision,
    stepId: request.stepId,
    attemptNumber: request.attemptNumber,
    modelProfileId: request.modelProfileId,
    candidateIdentity: cloneDecisionPart(identity),
    evaluatedAt,
    sourceRequestFingerprint,
  };
  return freezeModelProviderAdapterData(requirement === "redaction_required"
    ? { ...common, requirement, messages: cloneDecisionPart(request.messages) }
    : { ...common, requirement });
}

function captureProvider(
  input: unknown,
  sourceIndex: number,
  routeDecision: ModelInvocationRouteResolutionDecision,
  reasons: MutableReasons,
): CapturedProvider | null {
  const path = `providers[${sourceIndex}]`;
  try {
    if (!isPlainRecord(input)) {
      addReason(
        reasons,
        "invalid_provider_registry",
        path,
        "Runtime provider must be an ordinary object.",
        routeDecision,
      );
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")
      || ownKeys.length !== providerFields.length
      || !providerFields.every((field) => ownKeys.includes(field))) {
      addReason(
        reasons,
        "invalid_provider_registry",
        path,
        "Runtime provider must contain exactly identity, run, and health data properties.",
        routeDecision,
      );
      return null;
    }

    const identityDescriptor = ownDataDescriptor(input, "identity");
    const runDescriptor = ownDataDescriptor(input, "run");
    const healthDescriptor = ownDataDescriptor(input, "health");
    if (!identityDescriptor || !runDescriptor || !healthDescriptor
      || typeof runDescriptor.value !== "function"
      || typeof healthDescriptor.value !== "function") {
      addReason(
        reasons,
        "invalid_provider_registry",
        path,
        "Provider fields must be own non-accessor data properties with callable run and health.",
        routeDecision,
      );
      return null;
    }

    const identityDecision = validateAndNormalizeModelProviderIdentity(identityDescriptor.value);
    if (identityDecision.verdict !== "allow" || !identityDecision.normalizedIdentity) {
      addReason(
        reasons,
        "invalid_provider_registry",
        `${path}.identity`,
        "Provider identity failed factual AI-024 validation.",
        routeDecision,
      );
      return null;
    }

    return {
      sourceIndex,
      path,
      identity: identityDecision.normalizedIdentity,
      run: runDescriptor.value as CapturedProvider["run"],
      health: healthDescriptor.value as CapturedProvider["health"],
    };
  } catch {
    addReason(
      reasons,
      "invalid_provider_registry",
      path,
      "Runtime provider could not be safely inspected.",
      routeDecision,
    );
    return null;
  }
}

function captureProviders(
  input: unknown,
  routeDecision: ModelInvocationRouteResolutionDecision,
  reasons: MutableReasons,
): CapturedProvider[] | null {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
      addReason(
        reasons,
        "invalid_provider_registry",
        "providers",
        "Runtime providers must be an ordinary array.",
        routeDecision,
      );
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")) {
      addReason(
        reasons,
        "invalid_provider_registry",
        "providers",
        "Runtime providers cannot contain symbol properties.",
        routeDecision,
      );
      return null;
    }
    const lengthDescriptor = ownDataDescriptor(input, "length");
    const length = lengthDescriptor?.value;
    if (!Number.isSafeInteger(length) || (length as number) < 0) {
      addReason(
        reasons,
        "invalid_provider_registry",
        "providers",
        "Runtime providers array length is invalid.",
        routeDecision,
      );
      return null;
    }
    if ((length as number) > modelInvocationExecutionLimits.maxProviders) {
      addReason(
        reasons,
        "limit_exceeded",
        "providers",
        "Runtime providers exceed the canonical provider limit.",
        routeDecision,
      );
      return null;
    }
    const elementKeys = ownKeys.filter((key) => key !== "length") as string[];
    if (elementKeys.length !== length
      || elementKeys.some((key, index) => key !== String(index))) {
      addReason(
        reasons,
        "invalid_provider_registry",
        "providers",
        "Runtime providers must be a dense ordinary array without extra properties.",
        routeDecision,
      );
      return null;
    }

    const captures: CapturedProvider[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const descriptor = ownDataDescriptor(input, String(index));
      if (!descriptor) {
        addReason(
          reasons,
          "invalid_provider_registry",
          `providers[${index}]`,
          "Runtime provider entry must be an own data property.",
          routeDecision,
        );
        continue;
      }
      const captured = captureProvider(descriptor.value, index, routeDecision, reasons);
      if (captured) captures.push(captured);
    }
    if (reasons.length > 0) return null;

    const canonical = [...captures].sort((left, right) => (
      compareStrings(left.identity.providerId, right.identity.providerId)
      || compareStrings(left.identity.deploymentId, right.identity.deploymentId)
      || left.sourceIndex - right.sourceIndex
    ));
    for (let index = 1; index < canonical.length; index += 1) {
      const previous = canonical[index - 1];
      const current = canonical[index];
      if (previous && current
        && previous.identity.providerId === current.identity.providerId
        && previous.identity.deploymentId === current.identity.deploymentId) {
        addReason(
          reasons,
          "duplicate_provider_identity",
          `${current.path}.identity`,
          "Runtime providerId and deploymentId pairs must be globally unique.",
          routeDecision,
          {
            ...routeDecision.routePlan?.primary,
            providerId: current.identity.providerId,
            deploymentId: current.identity.deploymentId,
          } as ModelInvocationRouteCandidate,
        );
      }
    }
    return reasons.length > 0 ? null : canonical;
  } catch {
    addReason(
      reasons,
      "invalid_provider_registry",
      "providers",
      "Runtime providers could not be safely inspected.",
      routeDecision,
    );
    return null;
  }
}

function candidateMatchesIdentity(
  candidate: ModelInvocationRouteCandidate,
  identity: ModelProviderIdentity,
): boolean {
  return candidate.providerId === identity.providerId
    && candidate.providerKind === identity.providerKind
    && candidate.deploymentId === identity.deploymentId
    && candidate.providerModelId === identity.providerModelId
    && candidate.providerModelVersion === identity.providerModelVersion;
}

function dataHandlingInvariantHolds(
  decision: ModelInvocationDataHandlingDecision,
  request: ModelInvocationRequest,
  candidate: ModelInvocationRouteCandidate,
  identity: ModelProviderIdentity,
  evaluatedAt: string,
  sourceRequestFingerprint: string,
): boolean {
  if (decision.verdict !== "allow" || decision.status !== "ready"
    || decision.reasons.length !== 0 || !decision.routeReceipt
    || !decision.permit || !decision.preparedRequest) return false;
  const receipt = decision.routeReceipt;
  const permit = decision.permit;
  const preparedDecision = validateAndNormalizeModelInvocationRequest(decision.preparedRequest);
  if (preparedDecision.verdict !== "allow" || !preparedDecision.normalizedRequest
    || !sameData(preparedDecision.normalizedRequest, decision.preparedRequest)) return false;
  const preparedRequestFingerprint = createModelInvocationRequestFingerprint(
    preparedDecision.normalizedRequest,
  );
  if (!preparedRequestFingerprint) return false;
  return sameData(receipt.candidateIdentity, identity)
    && receipt.workspaceId === request.workspaceId
    && receipt.projectId === request.projectId
    && receipt.runId === request.runId
    && receipt.invocationId === request.invocationId
    && receipt.modelProfileId === request.modelProfileId
    && receipt.deploymentMode === candidate.deploymentMode
    && receipt.requirement === candidate.dataHandlingRequirement
    && receipt.priority === candidate.priority
    && sameData(permit.candidateIdentity, identity)
    && permit.requirement === candidate.dataHandlingRequirement
    && permit.workspaceId === request.workspaceId
    && permit.projectId === request.projectId
    && permit.runId === request.runId
    && permit.invocationId === request.invocationId
    && permit.runRevision === request.runRevision
    && permit.stepId === request.stepId
    && permit.attemptNumber === request.attemptNumber
    && permit.modelProfileId === request.modelProfileId
    && permit.evaluatedAt === evaluatedAt
    && permit.sourceRequestFingerprint === sourceRequestFingerprint
    && permit.preparedRequestFingerprint === preparedRequestFingerprint;
}

function providerForCandidate(
  providers: readonly CapturedProvider[],
  candidate: ModelInvocationRouteCandidate,
): CapturedProvider | null {
  return providers.find((provider) => (
    provider.identity.providerId === candidate.providerId
    && provider.identity.deploymentId === candidate.deploymentId
  )) ?? null;
}

function normalizeAdapterReasons(input: unknown): readonly ModelProviderAdapterReason[] | null {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype
    || input.length > modelInvocationExecutionLimits.maxReasons) return null;
  const output: ModelProviderAdapterReason[] = [];
  for (const value of input) {
    if (!isPlainRecord(value) || !hasExactFields(value, adapterReasonFields)
      || !isSafeText(value.code) || !isSafeText(value.path) || !isSafeText(value.message)
      || !isNullableSafeText(value.providerId)
      || !isNullableSafeText(value.deploymentId)
      || !isNullableSafeText(value.invocationId)) return null;
    output.push({
      code: value.code,
      path: value.path,
      message: value.message,
      providerId: value.providerId,
      deploymentId: value.deploymentId,
      invocationId: value.invocationId,
    });
  }
  return output;
}

function normalizeInvocationReasons(input: unknown): readonly ModelInvocationReason[] | null {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype
    || input.length > modelInvocationExecutionLimits.maxReasons) return null;
  const output: ModelInvocationReason[] = [];
  for (const value of input) {
    if (!isPlainRecord(value) || !hasExactFields(value, invocationReasonFields)
      || !isSafeText(value.code) || !isSafeText(value.path) || !isSafeText(value.message)
      || !isNullableSafeText(value.invocationId) || !isNullableSafeText(value.runId)
      || !isNullableSafeText(value.requestId) || !isNullableSafeText(value.projectId)
      || !isNullableSafeText(value.departmentId) || !isNullableSafeText(value.workflowId)
      || !isNullableSafeText(value.agentId) || !isNullableSafeText(value.stepId)
      || !(value.attemptNumber === null || Number.isSafeInteger(value.attemptNumber))) return null;
    output.push(value as unknown as ModelInvocationReason);
  }
  return output;
}

function normalizeHealthDecision(
  input: unknown,
  candidate: ModelInvocationRouteCandidate,
): HealthNormalization {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok || !isPlainRecord(snapshot.value)
    || !hasExactFields(snapshot.value, healthDecisionFields)
    || !isModelProviderAdapterVerdict(snapshot.value.verdict)) return { kind: "invalid" };
  const reasons = normalizeAdapterReasons(snapshot.value.reasons);
  if (!reasons) return { kind: "invalid" };

  if (snapshot.value.verdict === "deny") {
    if (snapshot.value.normalizedHealth !== null || reasons.length === 0) return { kind: "invalid" };
    return {
      kind: "valid",
      decision: freezeModelProviderAdapterData({
        verdict: "deny",
        reasons: cloneDecisionPart(reasons),
        normalizedHealth: null,
      }),
    };
  }

  if (reasons.length > 0) return { kind: "invalid" };
  const validation = validateAndNormalizeModelProviderHealth(snapshot.value.normalizedHealth);
  if (validation.verdict !== "allow" || !validation.normalizedHealth) return { kind: "invalid" };
  if (validation.normalizedHealth.providerId !== candidate.providerId
    || validation.normalizedHealth.deploymentId !== candidate.deploymentId) {
    return { kind: "identity_mismatch", decision: validation };
  }
  return { kind: "valid", decision: validation };
}

function normalizeRequestDecision(
  input: unknown,
  expectedRequest: ModelInvocationRequest,
): ModelInvocationRequestValidationDecision | null {
  if (!isPlainRecord(input) || !hasExactFields(input, requestDecisionFields)
    || input.verdict !== "allow" || !Array.isArray(input.reasons)
    || input.reasons.length !== 0) return null;
  const validation = validateAndNormalizeModelInvocationRequest(input.normalizedRequest);
  if (validation.verdict !== "allow" || !validation.normalizedRequest
    || !sameData(validation.normalizedRequest, expectedRequest)) return null;
  return validation;
}

function normalizeResultValidationDecision(
  input: unknown,
): ModelInvocationResultValidationDecision | null {
  if (!isPlainRecord(input) || !hasExactFields(input, resultValidationDecisionFields)
    || (input.verdict !== "allow" && input.verdict !== "deny")) return null;
  const reasons = normalizeInvocationReasons(input.reasons);
  if (!reasons) return null;
  if (input.verdict === "deny") {
    if (input.normalizedResult !== null || reasons.length === 0) return null;
    return freezeModelProviderAdapterData({
      verdict: "deny",
      reasons: cloneDecisionPart(reasons),
      normalizedResult: null,
    });
  }
  if (reasons.length > 0) return null;
  return validateAndNormalizeModelInvocationResult(input.normalizedResult);
}

function normalizeProviderDecision(
  input: unknown,
  request: ModelInvocationRequest,
  candidate: ModelInvocationRouteCandidate,
): ProviderDecisionNormalization {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok || !isPlainRecord(snapshot.value)
    || !hasExactFields(snapshot.value, providerDecisionFields)
    || !isModelProviderAdapterVerdict(snapshot.value.verdict)) return { kind: "invalid" };
  const reasons = normalizeAdapterReasons(snapshot.value.reasons);
  if (!reasons) return { kind: "invalid" };
  const requestDecision = normalizeRequestDecision(snapshot.value.requestDecision, request);
  if (!requestDecision) return { kind: "invalid" };

  if (snapshot.value.verdict === "deny") {
    if (snapshot.value.normalizedResult !== null || reasons.length === 0) return { kind: "invalid" };
    const resultDecision = snapshot.value.resultDecision === null
      ? null
      : normalizeResultValidationDecision(snapshot.value.resultDecision);
    if (snapshot.value.resultDecision !== null && !resultDecision) return { kind: "invalid" };
    return {
      kind: "valid",
      decision: freezeModelProviderAdapterData({
        verdict: "deny",
        reasons: cloneDecisionPart(reasons),
        requestDecision,
        resultDecision,
        normalizedResult: null,
      }),
    };
  }

  if (reasons.length > 0 || snapshot.value.resultDecision === null
    || snapshot.value.normalizedResult === null) return { kind: "invalid" };
  const resultDecision = normalizeResultValidationDecision(snapshot.value.resultDecision);
  const normalizedResultDecision = validateAndNormalizeModelInvocationResult(
    snapshot.value.normalizedResult,
  );
  if (!resultDecision || resultDecision.verdict !== "allow" || !resultDecision.normalizedResult
    || normalizedResultDecision.verdict !== "allow" || !normalizedResultDecision.normalizedResult
    || !sameData(resultDecision.normalizedResult, normalizedResultDecision.normalizedResult)) {
    return { kind: "invalid" };
  }
  const result = normalizedResultDecision.normalizedResult;
  if (result.invocationId !== request.invocationId
    || result.providerId !== candidate.providerId
    || result.providerModelId !== candidate.providerModelId
    || result.providerModelVersion !== candidate.providerModelVersion) {
    return { kind: "invalid" };
  }

  return {
    kind: "valid",
    decision: freezeModelProviderAdapterData({
      verdict: "allow",
      reasons: [],
      requestDecision,
      resultDecision,
      normalizedResult: cloneDecisionPart(result),
    }),
  };
}

export async function executeModelInvocation(
  input: unknown,
  providers: unknown,
  evidenceResolver?: unknown,
  runtimeContext?: unknown,
): Promise<ModelInvocationExecutionDecision> {
  const reasons: MutableReasons = [];
  const preflightRouteDecision = deniedRouteDecision();
  const executionSnapshot = snapshotModelProviderAdapterInput(input);
  if (!executionSnapshot.ok) {
    addReason(
      reasons,
      executionSnapshot.limited ? "limit_exceeded" : "invalid_input",
      "$",
      executionSnapshot.limited
        ? "Execution input exceeds bounded inspection limits."
        : "Execution input could not be safely inspected.",
      preflightRouteDecision,
    );
    return executionDeny(preflightRouteDecision, reasons);
  }
  if (!isPlainRecord(executionSnapshot.value)
    || !hasExactFields(executionSnapshot.value, executionInputFields)) {
    if (isPlainRecord(executionSnapshot.value)
      && hasExactFields(executionSnapshot.value, legacyRouteInputFields)) {
      const legacyRouteDecision = resolveModelInvocationRoute(executionSnapshot.value);
      const legacyCandidate = legacyRouteDecision.routePlan?.primary ?? null;
      if (legacyRouteDecision.verdict === "allow" && legacyCandidate
        && legacyCandidate.dataHandlingRequirement !== "local_only") {
        addReason(
          reasons,
          "data_handling_not_executable",
          "routeDecision.routePlan.primary.dataHandlingRequirement",
          "Legacy AI-025 input cannot authorize remote data handling.",
          legacyRouteDecision,
          legacyCandidate,
        );
        return executionDeny(legacyRouteDecision, reasons);
      }
    }
    addReason(
      reasons,
      "invalid_input",
      "$",
      "Execution input must contain exactly routeInput and candidateIdentity.",
      preflightRouteDecision,
    );
    return executionDeny(preflightRouteDecision, reasons);
  }

  const captures = captureProviders(providers, preflightRouteDecision, reasons);
  if (!captures) return executionDeny(preflightRouteDecision, reasons);
  const capturedResolver = captureEvidenceResolver(
    evidenceResolver,
    preflightRouteDecision,
    reasons,
  );
  if (evidenceResolver !== undefined && !capturedResolver) {
    return executionDeny(preflightRouteDecision, reasons);
  }
  const capturedRuntimeContext = captureRuntimeContext(
    runtimeContext,
    preflightRouteDecision,
    reasons,
  );
  if (!capturedRuntimeContext) return executionDeny(preflightRouteDecision, reasons);

  let rawEvaluatedAt: unknown;
  try {
    rawEvaluatedAt = capturedRuntimeContext.now();
  } catch {
    addReason(
      reasons,
      "invalid_input",
      "runtimeContext.now",
      "Trusted runtime evaluation time could not be captured.",
      preflightRouteDecision,
    );
    return executionDeny(preflightRouteDecision, reasons);
  }
  const evaluatedAt = canonicalTimestamp(rawEvaluatedAt);
  if (!evaluatedAt) {
    addReason(
      reasons,
      "invalid_input",
      "runtimeContext.now",
      "Trusted runtime evaluation time must be a canonical UTC timestamp.",
      preflightRouteDecision,
    );
    return executionDeny(preflightRouteDecision, reasons);
  }

  const routeInput = executionSnapshot.value.routeInput;
  const routeDecision = resolveModelInvocationRoute(routeInput);
  if (routeDecision.verdict !== "allow" || !routeDecision.routePlan
    || !routeDecision.invocationAdmissionDecision?.normalizedRequest
    || !routeDecision.invocationAdmissionDecision.snapshotDecision?.normalizedSnapshot) {
    addReason(
      reasons,
      "route_denied",
      "routeInput",
      "Factual AI-023 route resolution denied execution.",
      routeDecision,
    );
    return executionDeny(routeDecision, reasons);
  }

  const plan = routeDecision.routePlan;
  const request = routeDecision.invocationAdmissionDecision.normalizedRequest;
  const candidateIdentityDecision = validateAndNormalizeModelProviderIdentity(
    executionSnapshot.value.candidateIdentity,
  );
  if (candidateIdentityDecision.verdict !== "allow"
    || !candidateIdentityDecision.normalizedIdentity) {
    addReason(
      reasons,
      "invalid_input",
      "candidateIdentity",
      "Execution candidate identity failed factual AI-024 validation.",
      routeDecision,
    );
    return executionDeny(routeDecision, reasons);
  }
  const candidate = plan.primary;
  if (!candidateMatchesIdentity(
    candidate,
    candidateIdentityDecision.normalizedIdentity as ModelProviderIdentity,
  )) {
    addReason(
      reasons,
      "provider_not_registered",
      "candidateIdentity",
      "Execution candidate does not exactly identify the factual primary route candidate.",
      routeDecision,
    );
    return executionDeny(routeDecision, reasons);
  }
  const factualIdentity = identityForCandidate(candidate);
  const captured = providerForCandidate(captures, candidate);
  if (!captured) {
    addReason(
      reasons,
      "provider_not_registered",
      "providers",
      "No exact runtime provider is registered for the factual execution candidate.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons);
  }
  if (!candidateMatchesIdentity(candidate, captured.identity)) {
    addReason(
      reasons,
      "provider_identity_mismatch",
      `${captured.path}.identity`,
      "Runtime provider identity does not exactly match the factual execution candidate.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons);
  }

  if (!requirementMatchesDeployment(candidate)) {
    addReason(
      reasons,
      "data_handling_not_executable",
      "candidateIdentity",
      "Factual deployment mode and data-handling requirement are incompatible.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons);
  }
  const sourceRequestFingerprint = createModelInvocationRequestFingerprint(request);
  if (!sourceRequestFingerprint) {
    addReason(
      reasons,
      "data_handling_invariant_violation",
      "routeDecision.invocationAdmissionDecision.normalizedRequest",
      "Factual invocation request fingerprint could not be created.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons);
  }

  let evidence: unknown | null = null;
  if (candidate.dataHandlingRequirement !== "local_only") {
    if (!capturedResolver) {
      addReason(
        reasons,
        "data_handling_evidence_source_unavailable",
        "evidenceResolver",
        "Remote data handling requires a trusted evidence resolver.",
        routeDecision,
        candidate,
      );
      return executionDeny(routeDecision, reasons);
    }
    const resolverInput = evidenceResolverInput(
      candidate.dataHandlingRequirement,
      request,
      factualIdentity,
      evaluatedAt,
      sourceRequestFingerprint,
    );
    try {
      evidence = await capturedResolver.resolve(resolverInput);
    } catch {
      addReason(
        reasons,
        "data_handling_evidence_resolution_failed",
        "evidenceResolver.resolve",
        "Trusted evidence resolution failed closed.",
        routeDecision,
        candidate,
      );
      return executionDeny(routeDecision, reasons);
    }
    if (evidence === null) {
      addReason(
        reasons,
        "data_handling_evidence_source_unavailable",
        "evidenceResolver.resolve",
        "Trusted evidence resolver returned no evidence.",
        routeDecision,
        candidate,
      );
      return executionDeny(routeDecision, reasons);
    }
  }

  const dataHandlingDecision = evaluateModelInvocationDataHandling({
    routeInput,
    candidateIdentity: factualIdentity,
    evidence,
    evaluatedAt,
  });
  if (dataHandlingDecision.verdict !== "allow") {
    addReason(
      reasons,
      "data_handling_denied",
      "dataHandling",
      "Factual AI-027 data-handling evaluation denied execution.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons);
  }
  if (!dataHandlingInvariantHolds(
    dataHandlingDecision,
    request,
    candidate,
    factualIdentity,
    evaluatedAt,
    sourceRequestFingerprint,
  )) {
    addReason(
      reasons,
      "data_handling_invariant_violation",
      "dataHandling",
      "AI-027 data-handling output failed execution invariants.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons);
  }
  const preparedRequest = dataHandlingDecision.preparedRequest as ModelInvocationRequest;
  const permit = dataHandlingDecision.permit as ModelInvocationDataHandlingPermit;

  let rawHealthDecision: unknown;
  try {
    rawHealthDecision = await captured.health();
  } catch {
    addReason(
      reasons,
      "provider_exception",
      `${captured.path}.health`,
      "Provider health call failed closed.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons);
  }
  const healthNormalization = normalizeHealthDecision(rawHealthDecision, candidate);
  if (healthNormalization.kind === "identity_mismatch") {
    addReason(
      reasons,
      "invalid_health_decision",
      `${captured.path}.health.normalizedHealth`,
      "Provider health identity does not match the factual execution candidate.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons, healthNormalization.decision);
  }
  if (healthNormalization.kind === "invalid") {
    addReason(
      reasons,
      "invalid_health_decision",
      `${captured.path}.health`,
      "Provider health returned an invalid decision.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons);
  }
  const healthDecision = healthNormalization.decision;
  if (healthDecision.verdict !== "allow" || !healthDecision.normalizedHealth) {
    addReason(
      reasons,
      "invalid_health_decision",
      `${captured.path}.health`,
      "Provider health decision denied candidate use.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons, healthDecision);
  }
  if (healthDecision.normalizedHealth.status === "unavailable") {
    addReason(
      reasons,
      "provider_unavailable",
      `${captured.path}.health.normalizedHealth.status`,
      "Provider reported unavailable health.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons, healthDecision);
  }

  let rawProviderDecision: unknown;
  try {
    const providerRequest = freezeModelProviderAdapterData(cloneDecisionPart(preparedRequest));
    rawProviderDecision = await captured.run(providerRequest);
  } catch {
    addReason(
      reasons,
      "provider_exception",
      `${captured.path}.run`,
      "Provider run failed closed.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons, healthDecision);
  }

  const providerNormalization = normalizeProviderDecision(
    rawProviderDecision,
    preparedRequest,
    candidate,
  );
  if (providerNormalization.kind === "invalid") {
    addReason(
      reasons,
      "invalid_provider_decision",
      `${captured.path}.run`,
      "Provider returned an invalid or inconsistent run decision.",
      routeDecision,
      candidate,
    );
    return executionDeny(routeDecision, reasons, healthDecision);
  }

  const providerDecision = providerNormalization.decision;
  if (providerDecision.verdict !== "allow" || !providerDecision.normalizedResult) {
    addReason(
      reasons,
      "provider_run_denied",
      `${captured.path}.run`,
      "Provider run decision denied execution.",
      routeDecision,
      candidate,
    );
    return executionDeny(
      routeDecision,
      reasons,
      healthDecision,
      providerDecision,
    );
  }

  const resultDecision = evaluateModelInvocationResult({
    snapshot: routeDecision.invocationAdmissionDecision.snapshotDecision.normalizedSnapshot,
    request: preparedRequest,
    result: providerDecision.normalizedResult,
  });
  if (resultDecision.verdict !== "allow" || !resultDecision.normalizedResult) {
    addReason(
      reasons,
      "result_evaluation_denied",
      "providerDecision.normalizedResult",
      "Factual AI-022 result evaluation denied provider output.",
      routeDecision,
      candidate,
    );
    return executionDeny(
      routeDecision,
      reasons,
      healthDecision,
      providerDecision,
      resultDecision,
    );
  }

  return executionAllow(
    routeDecision,
    candidate,
    healthDecision,
    providerDecision,
    resultDecision,
    resultDecision.normalizedResult,
    permit,
  );
}
