import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvocationRequestValidationDecision,
  ModelInvocationResultValidationDecision,
} from "../contracts/model-invocation";
import type {
  ModelProvider,
  ModelProviderAdapterReason,
  ModelProviderAdapterRunDecision,
  ModelProviderHealth,
  ModelProviderIdentity,
} from "../contracts/model-provider-adapter";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelInvocationRequest, validateAndNormalizeModelInvocationResult } from "../contracts/model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelProviderAdapterLimits } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { snapshotModelProviderAdapterInput } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelProviderHealth } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelProviderIdentity } from "../contracts/model-provider-adapter.ts";

export const mockModelProviderLimits = Object.freeze({
  maxScripts: modelProviderAdapterLimits.maxScripts,
  maxReasons: modelProviderAdapterLimits.maxReasons,
});

export type MockModelProviderScript = Readonly<{
  request: ModelInvocationRequest;
  result: ModelInvocationResult;
}>;

export type MockModelProviderConfig = Readonly<{
  identity: ModelProviderIdentity;
  health: ModelProviderHealth;
  scripts: readonly MockModelProviderScript[];
}>;

export type MockModelProviderReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "invalid_identity"
  | "invalid_health"
  | "invalid_scripts"
  | "identity_not_mock"
  | "health_identity_mismatch"
  | "invalid_script"
  | "invalid_script_request"
  | "invalid_script_result"
  | "invocation_id_mismatch"
  | "provider_id_mismatch"
  | "provider_model_id_mismatch"
  | "provider_request_model_id_mismatch"
  | "provider_model_version_mismatch"
  | "tool_not_allowed"
  | "duplicate_invocation_id";

export type MockModelProviderReason = Readonly<{
  code: MockModelProviderReasonCode;
  path: string;
  message: string;
  providerId: string | null;
  deploymentId: string | null;
  invocationId: string | null;
}>;

export type MockModelProviderFactoryDecision = Readonly<{
  verdict: "allow" | "deny";
  reasons: readonly MockModelProviderReason[];
  normalizedConfig: MockModelProviderConfig | null;
  provider: ModelProvider | null;
}>;

type MutableReasons = MockModelProviderReason[];
type ScriptWrapper = {
  path: string;
  value: MockModelProviderScript;
};

const configFields = Object.freeze(["identity", "health", "scripts"] as const);
const scriptFields = Object.freeze(["request", "result"] as const);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function addFactoryReason(
  reasons: MutableReasons,
  code: MockModelProviderReasonCode,
  path: string,
  message: string,
  context: Partial<MockModelProviderReason> = {},
): void {
  if (reasons.length >= mockModelProviderLimits.maxReasons) return;
  reasons.push({
    code,
    path,
    message,
    providerId: context.providerId ?? null,
    deploymentId: context.deploymentId ?? null,
    invocationId: context.invocationId ?? null,
  });
}

function adapterReason(
  code: ModelProviderAdapterReason["code"],
  path: string,
  message: string,
  identity: ModelProviderIdentity,
  invocationId: string | null,
): ModelProviderAdapterReason {
  return {
    code,
    path,
    message,
    providerId: identity.providerId,
    deploymentId: identity.deploymentId,
    invocationId,
  };
}

function factoryDeny(reasons: MutableReasons): MockModelProviderFactoryDecision {
  return freezeModelProviderAdapterData({
    verdict: "deny",
    reasons: cloneModelProviderAdapterData(reasons),
    normalizedConfig: null,
    provider: null,
  });
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

function validateScriptIdentities(
  script: MockModelProviderScript,
  identity: ModelProviderIdentity,
  path: string,
  reasons: MutableReasons,
): void {
  const context = {
    providerId: identity.providerId,
    deploymentId: identity.deploymentId,
    invocationId: script.request.invocationId,
  };
  if (script.result.invocationId !== script.request.invocationId) {
    addFactoryReason(
      reasons,
      "invocation_id_mismatch",
      `${path}.result.invocationId`,
      "Scripted result invocationId must match its request.",
      context,
    );
  }
  if (script.result.providerId !== identity.providerId) {
    addFactoryReason(
      reasons,
      "provider_id_mismatch",
      `${path}.result.providerId`,
      "Scripted result providerId must match Mock identity.",
      context,
    );
  }
  if (script.result.providerModelId !== identity.providerModelId) {
    addFactoryReason(
      reasons,
      "provider_model_id_mismatch",
      `${path}.result.providerModelId`,
      "Scripted result providerModelId must match Mock identity.",
      context,
    );
  }
  if (script.result.providerRequestModelId !== identity.providerRequestModelId) {
    addFactoryReason(
      reasons,
      "provider_request_model_id_mismatch",
      `${path}.result.providerRequestModelId`,
      "Scripted result providerRequestModelId must match Mock identity.",
      context,
    );
  }
  if (script.result.providerModelVersion !== identity.providerModelVersion) {
    addFactoryReason(
      reasons,
      "provider_model_version_mismatch",
      `${path}.result.providerModelVersion`,
      "Scripted result providerModelVersion must match Mock identity.",
      context,
    );
  }
  for (const [index, proposal] of script.result.toolCallProposals.entries()) {
    if (!script.request.toolIds.includes(proposal.toolId)) {
      addFactoryReason(
        reasons,
        "tool_not_allowed",
        `${path}.result.toolCallProposals[${index}].toolId`,
        "Scripted tool proposal must be present in request.toolIds.",
        context,
      );
    }
  }
}

function normalizeScripts(
  input: unknown,
  identity: ModelProviderIdentity,
  reasons: MutableReasons,
): ScriptWrapper[] {
  if (!isOrdinaryArray(input) || input.length === 0
    || input.length > mockModelProviderLimits.maxScripts) {
    addFactoryReason(
      reasons,
      isOrdinaryArray(input) && input.length > mockModelProviderLimits.maxScripts
        ? "limit_exceeded"
        : "invalid_scripts",
      "scripts",
      "scripts must be a bounded non-empty ordinary array.",
      identity,
    );
    return [];
  }

  const wrappers: ScriptWrapper[] = [];
  for (const [index, raw] of input.entries()) {
    const path = `scripts[${index}]`;
    if (!isPlainRecord(raw) || !hasExactFields(raw, scriptFields)) {
      addFactoryReason(reasons, "invalid_script", path, "Script has missing or unknown fields.", identity);
      continue;
    }

    const requestDecision = validateAndNormalizeModelInvocationRequest(raw.request);
    if (requestDecision.verdict !== "allow" || !requestDecision.normalizedRequest) {
      addFactoryReason(
        reasons,
        "invalid_script_request",
        `${path}.request`,
        "Script request failed factual AI-022 validation.",
        identity,
      );
      continue;
    }
    const resultDecision = validateAndNormalizeModelInvocationResult(raw.result);
    if (resultDecision.verdict !== "allow" || !resultDecision.normalizedResult) {
      addFactoryReason(
        reasons,
        "invalid_script_result",
        `${path}.result`,
        "Script result failed factual AI-022 validation.",
        {
          ...identity,
          invocationId: requestDecision.normalizedRequest.invocationId,
        },
      );
      continue;
    }

    const script = {
      request: requestDecision.normalizedRequest,
      result: resultDecision.normalizedResult,
    };
    validateScriptIdentities(script, identity, path, reasons);
    wrappers.push({ path, value: script });
  }

  const canonical = [...wrappers].sort((left, right) => compareStrings(
    left.value.request.invocationId,
    right.value.request.invocationId,
  ));
  for (let index = 1; index < canonical.length; index += 1) {
    const previous = canonical[index - 1];
    const current = canonical[index];
    if (previous && current
      && previous.value.request.invocationId === current.value.request.invocationId) {
      addFactoryReason(
        reasons,
        "duplicate_invocation_id",
        `${current.path}.request.invocationId`,
        "Scripted invocationId values must be globally unique.",
        {
          ...identity,
          invocationId: current.value.request.invocationId,
        },
      );
    }
  }
  return canonical;
}

function runDeny(
  reasons: readonly ModelProviderAdapterReason[],
  requestDecision: ModelInvocationRequestValidationDecision | null,
  resultDecision: ModelInvocationResultValidationDecision | null,
): ModelProviderAdapterRunDecision {
  return freezeModelProviderAdapterData({
    verdict: "deny",
    reasons: cloneModelProviderAdapterData(reasons),
    requestDecision,
    resultDecision,
    normalizedResult: null,
  });
}

function recheckResult(
  request: ModelInvocationRequest,
  result: ModelInvocationResult,
  identity: ModelProviderIdentity,
): ModelProviderAdapterReason[] {
  const reasons: ModelProviderAdapterReason[] = [];
  if (result.invocationId !== request.invocationId) {
    reasons.push(adapterReason(
      "identity_mismatch",
      "result.invocationId",
      "Result invocationId no longer matches request.",
      identity,
      request.invocationId,
    ));
  }
  if (result.providerId !== identity.providerId
    || result.providerModelId !== identity.providerModelId
    || result.providerModelVersion !== identity.providerModelVersion) {
    reasons.push(adapterReason(
      "identity_mismatch",
      "result",
      "Result provider/model identity no longer matches adapter identity.",
      identity,
      request.invocationId,
    ));
  }
  for (const [index, proposal] of result.toolCallProposals.entries()) {
    if (!request.toolIds.includes(proposal.toolId)) {
      reasons.push(adapterReason(
        "tool_not_allowed",
        `result.toolCallProposals[${index}].toolId`,
        "Result tool proposal exceeds request toolIds.",
        identity,
        request.invocationId,
      ));
    }
  }
  return reasons;
}

function createProvider(config: MockModelProviderConfig): ModelProvider {
  const internalConfig = freezeModelProviderAdapterData(
    cloneModelProviderAdapterData(config),
  );
  const publicIdentity = freezeModelProviderAdapterData(
    cloneModelProviderAdapterData(internalConfig.identity),
  );

  const provider: ModelProvider = {
    identity: publicIdentity,
    async run(input: unknown): Promise<ModelProviderAdapterRunDecision> {
      let requestDecision: ModelInvocationRequestValidationDecision | null = null;
      let resultDecision: ModelInvocationResultValidationDecision | null = null;
      try {
        requestDecision = validateAndNormalizeModelInvocationRequest(input);
        if (requestDecision.verdict !== "allow" || !requestDecision.normalizedRequest) {
          return runDeny([
            adapterReason(
              "invalid_request",
              "$",
              "Request failed factual AI-022 validation.",
              publicIdentity,
              null,
            ),
          ], requestDecision, null);
        }

        const request = requestDecision.normalizedRequest;
        const script = internalConfig.scripts.find(
          (candidate) => candidate.request.invocationId === request.invocationId,
        );
        if (!script) {
          return runDeny([
            adapterReason(
              "script_not_found",
              "$.invocationId",
              "No exact scripted invocationId exists.",
              publicIdentity,
              request.invocationId,
            ),
          ], requestDecision, null);
        }
        if (!sameData(request, script.request)) {
          return runDeny([
            adapterReason(
              "conflicting_replay",
              "$",
              "Invocation ID exists but request differs from its canonical script.",
              publicIdentity,
              request.invocationId,
            ),
          ], requestDecision, null);
        }

        resultDecision = validateAndNormalizeModelInvocationResult(script.result);
        if (resultDecision.verdict !== "allow" || !resultDecision.normalizedResult) {
          return runDeny([
            adapterReason(
              "invalid_result",
              "result",
              "Scripted result failed factual AI-022 validation.",
              publicIdentity,
              request.invocationId,
            ),
          ], requestDecision, resultDecision);
        }

        const result = resultDecision.normalizedResult;
        const recheckReasons = recheckResult(request, result, publicIdentity);
        if (recheckReasons.length > 0) {
          return runDeny(recheckReasons, requestDecision, resultDecision);
        }

        return freezeModelProviderAdapterData({
          verdict: "allow",
          reasons: [],
          requestDecision,
          resultDecision,
          normalizedResult: cloneModelProviderAdapterData(result),
        });
      } catch {
        return runDeny([
          adapterReason(
            "provider_exception",
            "$",
            "Mock provider failed closed while evaluating the request.",
            publicIdentity,
            requestDecision?.normalizedRequest?.invocationId ?? null,
          ),
        ], requestDecision, resultDecision);
      }
    },
    async health() {
      try {
        return validateAndNormalizeModelProviderHealth(
          cloneModelProviderAdapterData(internalConfig.health),
        );
      } catch {
        return freezeModelProviderAdapterData({
          verdict: "deny",
          reasons: [adapterReason(
            "provider_exception",
            "$",
            "Mock provider failed closed while reading configured health.",
            publicIdentity,
            null,
          )],
          normalizedHealth: null,
        });
      }
    },
  };
  return Object.freeze(provider);
}

function createFromSnapshot(input: unknown): MockModelProviderFactoryDecision {
  const reasons: MutableReasons = [];
  if (!isPlainRecord(input) || !hasExactFields(input, configFields)) {
    addFactoryReason(reasons, "invalid_input", "$", "Mock config has missing or unknown fields.");
    return factoryDeny(reasons);
  }

  const identityDecision = validateAndNormalizeModelProviderIdentity(input.identity);
  if (identityDecision.verdict !== "allow" || !identityDecision.normalizedIdentity) {
    addFactoryReason(reasons, "invalid_identity", "identity", "Mock identity is invalid.");
    return factoryDeny(reasons);
  }
  const identity = identityDecision.normalizedIdentity;
  if (identity.providerKind !== "mock") {
    addFactoryReason(
      reasons,
      "identity_not_mock",
      "identity.providerKind",
      "Deterministic Mock Provider requires providerKind mock.",
      identity,
    );
    return factoryDeny(reasons);
  }

  const healthDecision = validateAndNormalizeModelProviderHealth(input.health);
  if (healthDecision.verdict !== "allow" || !healthDecision.normalizedHealth) {
    addFactoryReason(reasons, "invalid_health", "health", "Mock health is invalid.", identity);
    return factoryDeny(reasons);
  }
  const health = healthDecision.normalizedHealth;
  if (health.providerId !== identity.providerId) {
    addFactoryReason(
      reasons,
      "health_identity_mismatch",
      "health.providerId",
      "Health providerId must match identity.",
      identity,
    );
  }
  if (health.deploymentId !== identity.deploymentId) {
    addFactoryReason(
      reasons,
      "health_identity_mismatch",
      "health.deploymentId",
      "Health deploymentId must match identity.",
      identity,
    );
  }

  const wrappers = normalizeScripts(input.scripts, identity, reasons);
  if (reasons.length > 0) return factoryDeny(reasons);

  const normalizedConfig = freezeModelProviderAdapterData({
    identity: cloneModelProviderAdapterData(identity),
    health: cloneModelProviderAdapterData(health),
    scripts: wrappers.map((wrapper) => cloneModelProviderAdapterData(wrapper.value)),
  });
  return freezeModelProviderAdapterData({
    verdict: "allow",
    reasons: [],
    normalizedConfig,
    provider: createProvider(normalizedConfig),
  });
}

export function createDeterministicMockModelProvider(
  input: unknown,
): MockModelProviderFactoryDecision {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok) {
    const reasons: MutableReasons = [];
    addFactoryReason(
      reasons,
      snapshot.limited ? "limit_exceeded" : "invalid_input",
      "$",
      snapshot.limited
        ? "Mock config exceeds bounded inspection limits."
        : "Mock config could not be safely inspected.",
    );
    return factoryDeny(reasons);
  }
  try {
    return createFromSnapshot(snapshot.value);
  } catch {
    const reasons: MutableReasons = [];
    addFactoryReason(reasons, "invalid_input", "$", "Mock config failed closed during evaluation.");
    return factoryDeny(reasons);
  }
}
