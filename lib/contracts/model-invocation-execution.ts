import type {
  ModelInvocationReason,
  ModelInvocationRequest,
  ModelInvocationRequestValidationDecision,
  ModelInvocationResult,
  ModelInvocationResultDecision,
  ModelInvocationResultValidationDecision,
} from "./model-invocation";
import type {
  ModelInvocationRouteCandidate,
  ModelInvocationRouteResolutionDecision,
} from "./model-provider-registry";
import type {
  ModelProviderAdapterReason,
  ModelProviderAdapterRunDecision,
  ModelProviderHealthValidationDecision,
  ModelProviderIdentity,
} from "./model-provider-adapter";
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

export type ModelInvocationExecutionDecision = Readonly<{
  verdict: ModelInvocationExecutionVerdict;
  status: ModelInvocationExecutionStatus;
  reasons: readonly ModelInvocationExecutionReason[];
  routeDecision: ModelInvocationRouteResolutionDecision;
  selectedCandidate: ModelInvocationRouteCandidate | null;
  healthDecision: ModelProviderHealthValidationDecision | null;
  providerDecision: ModelProviderAdapterRunDecision | null;
  resultDecision: ModelInvocationResultDecision | null;
  normalizedResult: ModelInvocationResult | null;
}>;

type MutableReasons = ModelInvocationExecutionReason[];

type CapturedProvider = Readonly<{
  sourceIndex: number;
  path: string;
  identity: ModelProviderIdentity;
  health: () => unknown | Promise<unknown>;
  run: (input: unknown) => unknown | Promise<unknown>;
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
    routeDecision: cloneDecisionPart(routeDecision),
    selectedCandidate: null,
    healthDecision: healthDecision ? cloneDecisionPart(healthDecision) : null,
    providerDecision: providerDecision ? cloneDecisionPart(providerDecision) : null,
    resultDecision: resultDecision ? cloneDecisionPart(resultDecision) : null,
    normalizedResult: null,
  });
}

function executionAllow(
  routeDecision: ModelInvocationRouteResolutionDecision,
  candidate: ModelInvocationRouteCandidate,
  healthDecision: ModelProviderHealthValidationDecision,
  providerDecision: ModelProviderAdapterRunDecision,
  resultDecision: ModelInvocationResultDecision,
  result: ModelInvocationResult,
): ModelInvocationExecutionDecision {
  return freezeModelProviderAdapterData({
    verdict: "allow",
    status: "completed",
    reasons: [],
    routeDecision: cloneDecisionPart(routeDecision),
    selectedCandidate: cloneDecisionPart(candidate),
    healthDecision: cloneDecisionPart(healthDecision),
    providerDecision: cloneDecisionPart(providerDecision),
    resultDecision: cloneDecisionPart(resultDecision),
    normalizedResult: cloneDecisionPart(result),
  });
}

function ownDataDescriptor(
  input: object,
  key: string,
): PropertyDescriptor | null {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor : null;
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

function candidateIsExecutable(candidate: ModelInvocationRouteCandidate): boolean {
  return candidate.dataHandlingRequirement === "local_only"
    && candidate.deploymentMode === "local";
}

function preflightIdentityLinkage(
  candidates: readonly ModelInvocationRouteCandidate[],
  providers: readonly CapturedProvider[],
  routeDecision: ModelInvocationRouteResolutionDecision,
  reasons: MutableReasons,
): boolean {
  for (const candidate of candidates) {
    const provider = providerForCandidate(providers, candidate);
    if (provider && !candidateMatchesIdentity(candidate, provider.identity)) {
      addReason(
        reasons,
        "provider_identity_mismatch",
        `${provider.path}.identity`,
        "Runtime provider identity does not exactly match its factual route candidate.",
        routeDecision,
        candidate,
      );
      return false;
    }
  }
  return true;
}

export async function executeModelInvocation(
  routeInput: unknown,
  providers: unknown,
): Promise<ModelInvocationExecutionDecision> {
  const routeDecision = resolveModelInvocationRoute(routeInput);
  const reasons: MutableReasons = [];
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

  const captures = captureProviders(providers, routeDecision, reasons);
  if (!captures) return executionDeny(routeDecision, reasons);

  const plan = routeDecision.routePlan;
  const candidates = [plan.primary, ...plan.fallbacks];
  if (!candidateIsExecutable(plan.primary)) {
    addReason(
      reasons,
      "data_handling_not_executable",
      "routeDecision.routePlan.primary.dataHandlingRequirement",
      "AI-025 can execute only local_only candidates on local deployments.",
      routeDecision,
      plan.primary,
    );
    return executionDeny(routeDecision, reasons);
  }

  if (!preflightIdentityLinkage(candidates, captures, routeDecision, reasons)) {
    return executionDeny(routeDecision, reasons);
  }

  let selected: Readonly<{
    candidate: ModelInvocationRouteCandidate;
    capture: CapturedProvider;
    healthDecision: ModelProviderHealthValidationDecision;
  }> | null = null;
  let lastHealthDecision: ModelProviderHealthValidationDecision | null = null;
  const availabilityReasons: MutableReasons = [];

  for (const candidate of candidates) {
    if (!candidateIsExecutable(candidate)) {
      addReason(
        reasons,
        "data_handling_not_executable",
        "routeDecision.routePlan.fallbacks.dataHandlingRequirement",
        "AI-025 cannot execute a remote data-handling candidate.",
        routeDecision,
        candidate,
      );
      return executionDeny(routeDecision, reasons, lastHealthDecision);
    }
    const captured = providerForCandidate(captures, candidate);
    if (!captured) {
      addReason(
        availabilityReasons,
        "provider_not_registered",
        "providers",
        "No exact runtime provider is registered for the route candidate.",
        routeDecision,
        candidate,
      );
      continue;
    }

    let rawHealthDecision: unknown;
    try {
      rawHealthDecision = await captured.health();
    } catch {
      addReason(
        availabilityReasons,
        "provider_exception",
        `${captured.path}.health`,
        "Provider health call failed closed.",
        routeDecision,
        candidate,
      );
      continue;
    }
    const healthNormalization = normalizeHealthDecision(rawHealthDecision, candidate);
    if (healthNormalization.kind === "identity_mismatch") {
      addReason(
        reasons,
        "invalid_health_decision",
        `${captured.path}.health.normalizedHealth`,
        "Provider health identity does not match the route candidate.",
        routeDecision,
        candidate,
      );
      return executionDeny(routeDecision, reasons, healthNormalization.decision);
    }
    if (healthNormalization.kind === "invalid") {
      addReason(
        availabilityReasons,
        "invalid_health_decision",
        `${captured.path}.health`,
        "Provider health returned an invalid decision.",
        routeDecision,
        candidate,
      );
      continue;
    }
    lastHealthDecision = healthNormalization.decision;
    if (healthNormalization.decision.verdict !== "allow"
      || !healthNormalization.decision.normalizedHealth) {
      addReason(
        availabilityReasons,
        "invalid_health_decision",
        `${captured.path}.health`,
        "Provider health decision denied candidate use.",
        routeDecision,
        candidate,
      );
      continue;
    }
    if (healthNormalization.decision.normalizedHealth.status === "unavailable") {
      addReason(
        availabilityReasons,
        "provider_unavailable",
        `${captured.path}.health.normalizedHealth.status`,
        "Provider reported unavailable health.",
        routeDecision,
        candidate,
      );
      continue;
    }
    selected = {
      candidate,
      capture: captured,
      healthDecision: healthNormalization.decision,
    };
    break;
  }

  if (!selected) {
    reasons.push(...availabilityReasons.slice(0, modelInvocationExecutionLimits.maxReasons - 1));
    addReason(
      reasons,
      "no_available_provider",
      "providers",
      "No factual route candidate has an available runtime provider.",
      routeDecision,
    );
    return executionDeny(routeDecision, reasons, lastHealthDecision);
  }

  const request = routeDecision.invocationAdmissionDecision.normalizedRequest;
  const captured = selected.capture;
  let rawProviderDecision: unknown;
  try {
    const providerRequest = freezeModelProviderAdapterData(cloneDecisionPart(request));
    rawProviderDecision = await captured.run(providerRequest);
  } catch {
    addReason(
      reasons,
      "provider_exception",
      `${captured.path}.run`,
      "Provider run failed closed.",
      routeDecision,
      selected.candidate,
    );
    return executionDeny(routeDecision, reasons, selected.healthDecision);
  }

  const providerNormalization = normalizeProviderDecision(
    rawProviderDecision,
    request,
    selected.candidate,
  );
  if (providerNormalization.kind === "invalid") {
    addReason(
      reasons,
      "invalid_provider_decision",
      `${captured.path}.run`,
      "Provider returned an invalid or inconsistent run decision.",
      routeDecision,
      selected.candidate,
    );
    return executionDeny(routeDecision, reasons, selected.healthDecision);
  }

  const providerDecision = providerNormalization.decision;
  if (providerDecision.verdict !== "allow" || !providerDecision.normalizedResult) {
    addReason(
      reasons,
      "provider_run_denied",
      `${captured.path}.run`,
      "Provider run decision denied execution.",
      routeDecision,
      selected.candidate,
    );
    return executionDeny(
      routeDecision,
      reasons,
      selected.healthDecision,
      providerDecision,
    );
  }

  const resultDecision = evaluateModelInvocationResult({
    snapshot: routeDecision.invocationAdmissionDecision.snapshotDecision.normalizedSnapshot,
    request,
    result: providerDecision.normalizedResult,
  });
  if (resultDecision.verdict !== "allow" || !resultDecision.normalizedResult) {
    addReason(
      reasons,
      "result_evaluation_denied",
      "providerDecision.normalizedResult",
      "Factual AI-022 result evaluation denied provider output.",
      routeDecision,
      selected.candidate,
    );
    return executionDeny(
      routeDecision,
      reasons,
      selected.healthDecision,
      providerDecision,
      resultDecision,
    );
  }

  return executionAllow(
    routeDecision,
    selected.candidate,
    selected.healthDecision,
    providerDecision,
    resultDecision,
    resultDecision.normalizedResult,
  );
}
