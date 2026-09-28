import type {
  ModelInvocationRequestValidationDecision,
  ModelInvocationResult,
  ModelInvocationResultValidationDecision,
} from "./model-invocation";
import type { ModelProviderKind } from "./model-provider-registry";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelInvocationLimits } from "./model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelProviderKinds, modelProviderRegistryLimits } from "./model-provider-registry.ts";

export const modelProviderHealthStatuses = Object.freeze([
  "healthy",
  "degraded",
  "unavailable",
] as const);
export type ModelProviderHealthStatus = (typeof modelProviderHealthStatuses)[number];

export const modelProviderAdapterVerdicts = Object.freeze(["allow", "deny"] as const);
export type ModelProviderAdapterVerdict = (typeof modelProviderAdapterVerdicts)[number];

export const modelProviderAdapterLimits = Object.freeze({
  maxIdLength: modelProviderRegistryLimits.maxIdLength,
  maxAuditIdentifierLength: modelInvocationLimits.maxProviderAuditIdLength,
  maxDetailCodeLength: modelInvocationLimits.maxErrorCodeLength,
  maxLatencyMs: modelInvocationLimits.maxLatencyMs,
  maxScripts: 256,
  maxReasons: modelInvocationLimits.maxValidationReasons,
  maxEnvelopeDepth: modelInvocationLimits.maxEnvelopeDepth,
  maxInspectedProperties: modelInvocationLimits.maxInspectedProperties,
  maxEnvelopeArrayLength: modelInvocationLimits.maxEnvelopeArrayLength,
  maxEnvelopeStringLength: modelInvocationLimits.maxEnvelopeStringLength,
  maxTotalStringCharacters: modelInvocationLimits.maxEnvelopeStringLength * 16,
});

export type ModelProviderIdentity = Readonly<{
  providerId: string;
  providerKind: ModelProviderKind;
  deploymentId: string;
  /** Routing or provider alias identity; never substitute it for the pinned request model. */
  providerModelId: string;
  /** Explicit requestable, version-stable identity used for provider requests. */
  providerRequestModelId: string;
  /** Factual returned-model and audit identity. */
  providerModelVersion: string;
}>;

export type ModelProviderHealth = Readonly<{
  providerId: string;
  deploymentId: string;
  status: ModelProviderHealthStatus;
  observedAt: string;
  latencyMs: number;
  detailCode: string | null;
}>;

export type ModelProviderAdapterReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "invalid_identity"
  | "invalid_health"
  | "invalid_request"
  | "invalid_result"
  | "identity_mismatch"
  | "script_not_found"
  | "conflicting_replay"
  | "tool_not_allowed"
  | "provider_exception";

export type ModelProviderAdapterReason = Readonly<{
  code: ModelProviderAdapterReasonCode | string;
  path: string;
  message: string;
  providerId: string | null;
  deploymentId: string | null;
  invocationId: string | null;
}>;

export type ModelProviderIdentityValidationDecision = Readonly<{
  verdict: ModelProviderAdapterVerdict;
  reasons: readonly ModelProviderAdapterReason[];
  normalizedIdentity: ModelProviderIdentity | null;
}>;

export type ModelProviderHealthValidationDecision = Readonly<{
  verdict: ModelProviderAdapterVerdict;
  reasons: readonly ModelProviderAdapterReason[];
  normalizedHealth: ModelProviderHealth | null;
}>;

export type ModelProviderAdapterRunDecision = Readonly<{
  verdict: ModelProviderAdapterVerdict;
  reasons: readonly ModelProviderAdapterReason[];
  requestDecision: ModelInvocationRequestValidationDecision | null;
  resultDecision: ModelInvocationResultValidationDecision | null;
  normalizedResult: ModelInvocationResult | null;
}>;

export interface ModelProvider {
  readonly identity: ModelProviderIdentity;
  run(input: unknown): Promise<ModelProviderAdapterRunDecision>;
  health(): Promise<ModelProviderHealthValidationDecision>;
}

export type ModelProviderAdapterSnapshotResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; limited: boolean }>;

type SnapshotState = {
  inspectedProperties: number;
  totalStringCharacters: number;
  active: WeakSet<object>;
};

type MutableReasons = ModelProviderAdapterReason[];

const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const unsafeAuditCharacterPattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const identityFields = Object.freeze([
  "providerId",
  "providerKind",
  "deploymentId",
  "providerModelId",
  "providerRequestModelId",
  "providerModelVersion",
] as const);
const healthFields = Object.freeze([
  "providerId",
  "deploymentId",
  "status",
  "observedAt",
  "latencyMs",
  "detailCode",
] as const);

function includes<T>(values: readonly T[], input: unknown): input is T {
  return values.some((value) => value === input);
}

export function isModelProviderHealthStatus(input: unknown): input is ModelProviderHealthStatus {
  return includes(modelProviderHealthStatuses, input);
}

export function parseModelProviderHealthStatus(input: unknown): ModelProviderHealthStatus | null {
  return isModelProviderHealthStatus(input) ? input : null;
}

export function isModelProviderAdapterVerdict(input: unknown): input is ModelProviderAdapterVerdict {
  return includes(modelProviderAdapterVerdicts, input);
}

export function parseModelProviderAdapterVerdict(input: unknown): ModelProviderAdapterVerdict | null {
  return isModelProviderAdapterVerdict(input) ? input : null;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function isOrdinaryArray(input: unknown): input is unknown[] {
  return Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype;
}

function hasExactFields(input: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(input);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field));
}

function snapshotValue(
  input: unknown,
  state: SnapshotState,
  depth: number,
): ModelProviderAdapterSnapshotResult {
  if (typeof input === "string") {
    state.totalStringCharacters += input.length;
    if (input.length > modelProviderAdapterLimits.maxEnvelopeStringLength
      || state.totalStringCharacters > modelProviderAdapterLimits.maxTotalStringCharacters) {
      return { ok: false, limited: true };
    }
    return { ok: true, value: input };
  }
  if (input === null || typeof input === "boolean" || typeof input === "undefined") {
    return { ok: true, value: input };
  }
  if (typeof input === "number") {
    return Number.isFinite(input) ? { ok: true, value: input } : { ok: false, limited: false };
  }
  if (typeof input !== "object") return { ok: false, limited: false };
  if (depth > modelProviderAdapterLimits.maxEnvelopeDepth || state.active.has(input)) {
    return { ok: false, limited: depth > modelProviderAdapterLimits.maxEnvelopeDepth };
  }

  try {
    const array = Array.isArray(input);
    if (array ? !isOrdinaryArray(input) : !isPlainRecord(input)) {
      return { ok: false, limited: false };
    }

    state.active.add(input);
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string")) return { ok: false, limited: false };
    const keys = (ownKeys as string[]).filter((key) => !(array && key === "length"));
    if (array && ((input as unknown[]).length > modelProviderAdapterLimits.maxEnvelopeArrayLength
      || keys.length !== (input as unknown[]).length)) {
      return {
        ok: false,
        limited: (input as unknown[]).length > modelProviderAdapterLimits.maxEnvelopeArrayLength,
      };
    }

    state.inspectedProperties += keys.length;
    if (state.inspectedProperties > modelProviderAdapterLimits.maxInspectedProperties) {
      return { ok: false, limited: true };
    }

    const output: unknown[] | Record<string, unknown> = array
      ? []
      : Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (array && String((output as unknown[]).length) !== key) {
        return { ok: false, limited: false };
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        return { ok: false, limited: false };
      }
      const nested = snapshotValue(descriptor.value, state, depth + 1);
      if (!nested.ok) return nested;
      if (array) (output as unknown[]).push(nested.value);
      else (output as Record<string, unknown>)[key] = nested.value;
    }
    return { ok: true, value: output };
  } catch {
    return { ok: false, limited: false };
  } finally {
    state.active.delete(input);
  }
}

export function snapshotModelProviderAdapterInput(input: unknown): ModelProviderAdapterSnapshotResult {
  return snapshotValue(input, {
    inspectedProperties: 0,
    totalStringCharacters: 0,
    active: new WeakSet<object>(),
  }, 0);
}

export function cloneModelProviderAdapterData<T>(input: T): T {
  if (Array.isArray(input)) return input.map(cloneModelProviderAdapterData) as T;
  if (typeof input === "object" && input !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = cloneModelProviderAdapterData(value);
    }
    return output as T;
  }
  return input;
}

export function freezeModelProviderAdapterData<T>(input: T): T {
  if (typeof input !== "object" || input === null || Object.isFrozen(input)) return input;
  for (const value of Object.values(input)) freezeModelProviderAdapterData(value);
  return Object.freeze(input);
}

function addReason(
  reasons: MutableReasons,
  code: ModelProviderAdapterReasonCode,
  path: string,
  message: string,
  context: Partial<ModelProviderAdapterReason> = {},
): void {
  if (reasons.length >= modelProviderAdapterLimits.maxReasons) return;
  reasons.push({
    code,
    path,
    message,
    providerId: context.providerId ?? null,
    deploymentId: context.deploymentId ?? null,
    invocationId: context.invocationId ?? null,
  });
}

function stableId(input: unknown): string | null {
  return typeof input === "string" && input.length <= modelProviderAdapterLimits.maxIdLength
    && safeIdPattern.test(input) ? input : null;
}

function auditIdentifier(input: unknown, maximum: number): string | null {
  return typeof input === "string" && input.length > 0 && input.length <= maximum
    && input.trim().length > 0 && !unsafeAuditCharacterPattern.test(input) ? input : null;
}

function canonicalTimestamp(input: unknown): string | null {
  if (typeof input !== "string" || !canonicalTimestampPattern.test(input)) return null;
  try {
    return new Date(input).toISOString() === input ? input : null;
  } catch {
    return null;
  }
}

function safeInteger(input: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(input) && (input as number) >= minimum && (input as number) <= maximum
    ? input as number
    : null;
}

function identityDeny(reasons: MutableReasons): ModelProviderIdentityValidationDecision {
  return freezeModelProviderAdapterData({
    verdict: "deny",
    reasons: cloneModelProviderAdapterData(reasons),
    normalizedIdentity: null,
  });
}

function normalizeIdentityData(input: unknown): ModelProviderIdentityValidationDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !hasExactFields(input, identityFields)) {
    addReason(reasons, "invalid_identity", "$", "ModelProviderIdentity has missing or unknown fields.");
    return identityDeny(reasons);
  }

  const providerId = stableId(input.providerId);
  const deploymentId = stableId(input.deploymentId);
  const providerKind = input.providerKind;
  const providerModelId = auditIdentifier(
    input.providerModelId,
    modelProviderAdapterLimits.maxAuditIdentifierLength,
  );
  const providerRequestModelId = auditIdentifier(
    input.providerRequestModelId,
    modelProviderAdapterLimits.maxAuditIdentifierLength,
  );
  const providerModelVersion = auditIdentifier(
    input.providerModelVersion,
    modelProviderAdapterLimits.maxAuditIdentifierLength,
  );

  if (!providerId) addReason(reasons, "invalid_identity", "$.providerId", "providerId must be a stable ID.");
  if (!includes(modelProviderKinds, providerKind)) {
    addReason(reasons, "invalid_identity", "$.providerKind", "providerKind is not canonical.");
  }
  if (!deploymentId) {
    addReason(reasons, "invalid_identity", "$.deploymentId", "deploymentId must be a stable ID.");
  }
  if (!providerModelId) {
    addReason(reasons, "invalid_identity", "$.providerModelId", "providerModelId is not a safe audit identifier.");
  }
  if (!providerRequestModelId) {
    addReason(reasons, "invalid_identity", "$.providerRequestModelId", "providerRequestModelId is not a safe pinned request identifier.");
  }
  if (!providerModelVersion) {
    addReason(reasons, "invalid_identity", "$.providerModelVersion", "providerModelVersion is not a safe audit identifier.");
  }

  if (reasons.length > 0 || !providerId || !deploymentId
    || !includes(modelProviderKinds, providerKind) || !providerModelId
    || !providerRequestModelId || !providerModelVersion) {
    return identityDeny(reasons);
  }

  return freezeModelProviderAdapterData({
    verdict: "allow",
    reasons: [],
    normalizedIdentity: {
      providerId,
      providerKind,
      deploymentId,
      providerModelId,
      providerRequestModelId,
      providerModelVersion,
    },
  });
}

export function validateAndNormalizeModelProviderIdentity(
  input: unknown,
): ModelProviderIdentityValidationDecision {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok) {
    const reasons: MutableReasons = [];
    addReason(
      reasons,
      snapshot.limited ? "limit_exceeded" : "invalid_input",
      "$",
      snapshot.limited ? "Identity exceeds bounded inspection limits." : "Identity could not be safely inspected.",
    );
    return identityDeny(reasons);
  }
  try {
    return normalizeIdentityData(snapshot.value);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Identity could not be safely validated.");
    return identityDeny(reasons);
  }
}

function healthDeny(reasons: MutableReasons): ModelProviderHealthValidationDecision {
  return freezeModelProviderAdapterData({
    verdict: "deny",
    reasons: cloneModelProviderAdapterData(reasons),
    normalizedHealth: null,
  });
}

function normalizeHealthData(input: unknown): ModelProviderHealthValidationDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !hasExactFields(input, healthFields)) {
    addReason(reasons, "invalid_health", "$", "ModelProviderHealth has missing or unknown fields.");
    return healthDeny(reasons);
  }

  const providerId = stableId(input.providerId);
  const deploymentId = stableId(input.deploymentId);
  const status = input.status;
  const observedAt = canonicalTimestamp(input.observedAt);
  const latencyMs = safeInteger(input.latencyMs, 0, modelProviderAdapterLimits.maxLatencyMs);
  const detailCode = input.detailCode === null
    ? null
    : auditIdentifier(input.detailCode, modelProviderAdapterLimits.maxDetailCodeLength);

  if (!providerId) addReason(reasons, "invalid_health", "$.providerId", "providerId must be a stable ID.");
  if (!deploymentId) {
    addReason(reasons, "invalid_health", "$.deploymentId", "deploymentId must be a stable ID.");
  }
  if (!isModelProviderHealthStatus(status)) {
    addReason(reasons, "invalid_health", "$.status", "Health status is not canonical.");
  }
  if (!observedAt) {
    addReason(reasons, "invalid_health", "$.observedAt", "observedAt must be a canonical ISO timestamp.");
  }
  if (latencyMs === null) {
    addReason(reasons, "invalid_health", "$.latencyMs", "latencyMs must be a bounded non-negative safe integer.");
  }
  if (input.detailCode !== null && detailCode === null) {
    addReason(reasons, "invalid_health", "$.detailCode", "detailCode must be null or a safe bounded audit code.");
  }

  if (reasons.length > 0 || !providerId || !deploymentId
    || !isModelProviderHealthStatus(status) || !observedAt || latencyMs === null) {
    return healthDeny(reasons);
  }

  return freezeModelProviderAdapterData({
    verdict: "allow",
    reasons: [],
    normalizedHealth: {
      providerId,
      deploymentId,
      status,
      observedAt,
      latencyMs,
      detailCode,
    },
  });
}

export function validateAndNormalizeModelProviderHealth(
  input: unknown,
): ModelProviderHealthValidationDecision {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok) {
    const reasons: MutableReasons = [];
    addReason(
      reasons,
      snapshot.limited ? "limit_exceeded" : "invalid_input",
      "$",
      snapshot.limited ? "Health exceeds bounded inspection limits." : "Health could not be safely inspected.",
    );
    return healthDeny(reasons);
  }
  try {
    return normalizeHealthData(snapshot.value);
  } catch {
    const reasons: MutableReasons = [];
    addReason(reasons, "invalid_input", "$", "Health could not be safely validated.");
    return healthDeny(reasons);
  }
}
