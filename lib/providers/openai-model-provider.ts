import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "openai";
import type {
  ModelInvocationRequest,
  ModelInvocationRequestValidationDecision,
  ModelInvocationResult,
  ModelInvocationResultValidationDecision,
} from "../contracts/model-invocation";
import type {
  ModelProvider,
  ModelProviderAdapterReason,
  ModelProviderAdapterRunDecision,
  ModelProviderHealthValidationDecision,
  ModelProviderIdentity,
} from "../contracts/model-provider-adapter";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelInvocationLimits } from "../contracts/model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelInvocationRequest } from "../contracts/model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelInvocationResult } from "../contracts/model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelProviderRegistryLimits } from "../contracts/model-provider-registry.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { cloneModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelProviderAdapterLimits } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelProviderAdapterVerdicts } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { snapshotModelProviderAdapterInput } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelProviderHealth } from "../contracts/model-provider-adapter.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeModelProviderIdentity } from "../contracts/model-provider-adapter.ts";

export const openAIModelProviderFactoryVerdicts = modelProviderAdapterVerdicts;
export type OpenAIModelProviderFactoryVerdict = (typeof openAIModelProviderFactoryVerdicts)[number];

export const openAIModelProviderLimits = Object.freeze({
  maxApiKeyLength: 4_096,
  minTimeoutMs: 1,
  maxTimeoutMs: modelInvocationLimits.maxLatencyMs,
  maxInputTokens: modelProviderRegistryLimits.maxTokenCeiling,
  maxOutputTokens: modelProviderRegistryLimits.maxTokenCeiling,
  maxPriceUsdMicrosPerMillionTokens: modelProviderRegistryLimits.maxPriceUsdMicrosPerMillionTokens,
  maxCostUsdMicros: modelInvocationLimits.maxCostUsdMicros,
  maxReasons: modelProviderAdapterLimits.maxReasons,
  maxResponseDepth: modelProviderAdapterLimits.maxEnvelopeDepth,
  maxResponseProperties: modelProviderAdapterLimits.maxInspectedProperties,
  maxResponseArrayLength: modelProviderAdapterLimits.maxEnvelopeArrayLength,
  maxResponseStringLength: modelProviderAdapterLimits.maxEnvelopeStringLength,
});

export type OpenAIModelProviderConfig = Readonly<{
  identity: ModelProviderIdentity;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  inputCostUsdMicrosPerMillionTokens: number;
  outputCostUsdMicrosPerMillionTokens: number;
}>;

export type OpenAIModelProviderCredentials = Readonly<{
  apiKey: string;
}>;

export type OpenAIModelProviderClientOptions = Readonly<{
  apiKey: string;
  maxRetries: 0;
  timeout: number;
  logLevel: "off";
}>;

export type OpenAIResponseCreateInput = Readonly<{
  model: string;
  instructions?: string;
  input: readonly Readonly<{ role: "system" | "user" | "assistant"; content: string }>[];
  store: false;
  stream: false;
  background: false;
  max_output_tokens: number;
}>;

export interface OpenAIModelProviderClient {
  readonly responses: Readonly<{
    create(input: OpenAIResponseCreateInput): Promise<unknown>;
  }>;
  readonly models: Readonly<{
    retrieve(model: string): Promise<unknown>;
  }>;
}

export type OpenAIModelProviderDependencies = Readonly<{
  createClient?: (options: OpenAIModelProviderClientOptions) => OpenAIModelProviderClient;
  monotonicNow?: () => number;
  observedAt?: () => string;
}>;

export type OpenAIModelProviderReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "invalid_config"
  | "invalid_credentials"
  | "invalid_dependencies"
  | "identity_not_openai"
  | "unsupported_request"
  | "tool_not_allowed"
  | "provider_exception";

export type OpenAIModelProviderReason = Readonly<{
  code: OpenAIModelProviderReasonCode;
  path: string;
  message: string;
  providerId: string | null;
  deploymentId: string | null;
}>;

export type OpenAIModelProviderFactoryDecision = Readonly<{
  verdict: OpenAIModelProviderFactoryVerdict;
  reasons: readonly OpenAIModelProviderReason[];
  normalizedConfig: OpenAIModelProviderConfig | null;
  provider: ModelProvider | null;
}>;

type MutableFactoryReasons = OpenAIModelProviderReason[];

type CapturedDependencies = Readonly<{
  createClient: (options: OpenAIModelProviderClientOptions) => OpenAIModelProviderClient;
  monotonicNow: () => number;
  observedAt: () => string;
}>;

type CapturedClient = Readonly<{
  createResponse: (input: OpenAIResponseCreateInput) => Promise<unknown>;
  retrieveModel: (model: string) => Promise<unknown>;
}>;

type ErrorClassification = Readonly<{
  category: "timeout" | "rate_limited" | "unavailable" | "provider_error" | "unknown";
  code: string;
  message: string;
  retryable: boolean;
  transient: boolean;
}>;

type MappedResponse =
  | Readonly<{ ok: true; result: ModelInvocationResult }>
  | Readonly<{ ok: false; code: string; message: string }>;

const configFields = Object.freeze([
  "identity",
  "timeoutMs",
  "maxInputTokens",
  "maxOutputTokens",
  "inputCostUsdMicrosPerMillionTokens",
  "outputCostUsdMicrosPerMillionTokens",
] as const);
const credentialFields = Object.freeze(["apiKey"] as const);
const dependencyFields = Object.freeze(["createClient", "monotonicNow", "observedAt"] as const);
const unsafeSecretCharacterPattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

function includes<T>(values: readonly T[], input: unknown): input is T {
  return values.some((value) => value === input);
}

export function isOpenAIModelProviderFactoryVerdict(
  input: unknown,
): input is OpenAIModelProviderFactoryVerdict {
  return includes(openAIModelProviderFactoryVerdicts, input);
}

export function parseOpenAIModelProviderFactoryVerdict(
  input: unknown,
): OpenAIModelProviderFactoryVerdict | null {
  return isOpenAIModelProviderFactoryVerdict(input) ? input : null;
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

function safeInteger(input: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(input) && (input as number) >= minimum && (input as number) <= maximum
    ? input as number
    : null;
}

function addFactoryReason(
  reasons: MutableFactoryReasons,
  code: OpenAIModelProviderReasonCode,
  path: string,
  message: string,
  identity?: Partial<ModelProviderIdentity>,
): void {
  if (reasons.length >= openAIModelProviderLimits.maxReasons) return;
  reasons.push({
    code,
    path,
    message,
    providerId: identity?.providerId ?? null,
    deploymentId: identity?.deploymentId ?? null,
  });
}

function adapterReason(
  code: string,
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

function factoryDeny(reasons: MutableFactoryReasons): OpenAIModelProviderFactoryDecision {
  return freezeModelProviderAdapterData({
    verdict: "deny",
    reasons: cloneModelProviderAdapterData(reasons),
    normalizedConfig: null,
    provider: null,
  });
}

function runDeny(
  identity: ModelProviderIdentity,
  code: string,
  path: string,
  message: string,
  requestDecision: ModelInvocationRequestValidationDecision | null,
  resultDecision: ModelInvocationResultValidationDecision | null = null,
): ModelProviderAdapterRunDecision {
  return freezeModelProviderAdapterData({
    verdict: "deny",
    reasons: [adapterReason(
      code,
      path,
      message,
      identity,
      requestDecision?.normalizedRequest?.invocationId ?? null,
    )],
    requestDecision,
    resultDecision,
    normalizedResult: null,
  });
}

function normalizeConfig(input: unknown, reasons: MutableFactoryReasons): OpenAIModelProviderConfig | null {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok) {
    addFactoryReason(
      reasons,
      snapshot.limited ? "limit_exceeded" : "invalid_input",
      "config",
      snapshot.limited
        ? "OpenAI config exceeds bounded inspection limits."
        : "OpenAI config could not be safely inspected.",
    );
    return null;
  }
  if (!isPlainRecord(snapshot.value) || !hasExactFields(snapshot.value, configFields)) {
    addFactoryReason(reasons, "invalid_config", "config", "OpenAI config has missing or unknown fields.");
    return null;
  }

  const identityDecision = validateAndNormalizeModelProviderIdentity(snapshot.value.identity);
  if (identityDecision.verdict !== "allow" || !identityDecision.normalizedIdentity) {
    addFactoryReason(reasons, "invalid_config", "config.identity", "OpenAI identity is invalid.");
    return null;
  }
  const identity = identityDecision.normalizedIdentity;
  if (identity.providerKind !== "openai") {
    addFactoryReason(
      reasons,
      "identity_not_openai",
      "config.identity.providerKind",
      "OpenAI provider requires providerKind openai.",
      identity,
    );
  }
  const timeoutMs = safeInteger(
    snapshot.value.timeoutMs,
    openAIModelProviderLimits.minTimeoutMs,
    openAIModelProviderLimits.maxTimeoutMs,
  );
  const maxInputTokens = safeInteger(
    snapshot.value.maxInputTokens,
    1,
    openAIModelProviderLimits.maxInputTokens,
  );
  const maxOutputTokens = safeInteger(
    snapshot.value.maxOutputTokens,
    1,
    openAIModelProviderLimits.maxOutputTokens,
  );
  const inputCost = safeInteger(
    snapshot.value.inputCostUsdMicrosPerMillionTokens,
    0,
    openAIModelProviderLimits.maxPriceUsdMicrosPerMillionTokens,
  );
  const outputCost = safeInteger(
    snapshot.value.outputCostUsdMicrosPerMillionTokens,
    0,
    openAIModelProviderLimits.maxPriceUsdMicrosPerMillionTokens,
  );
  for (const [field, value] of [
    ["timeoutMs", timeoutMs],
    ["maxInputTokens", maxInputTokens],
    ["maxOutputTokens", maxOutputTokens],
    ["inputCostUsdMicrosPerMillionTokens", inputCost],
    ["outputCostUsdMicrosPerMillionTokens", outputCost],
  ] as const) {
    if (value === null) {
      addFactoryReason(
        reasons,
        "invalid_config",
        `config.${field}`,
        `${field} must be a canonical bounded safe integer.`,
        identity,
      );
    }
  }
  if (reasons.length > 0 || identity.providerKind !== "openai"
    || timeoutMs === null || maxInputTokens === null || maxOutputTokens === null
    || inputCost === null || outputCost === null) return null;
  return freezeModelProviderAdapterData({
    identity,
    timeoutMs,
    maxInputTokens,
    maxOutputTokens,
    inputCostUsdMicrosPerMillionTokens: inputCost,
    outputCostUsdMicrosPerMillionTokens: outputCost,
  });
}

function captureApiKey(input: unknown, reasons: MutableFactoryReasons): string | null {
  try {
    if (!isPlainRecord(input)) {
      addFactoryReason(reasons, "invalid_credentials", "credentials", "Credentials must be an ordinary object.");
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== credentialFields.length
      || ownKeys.some((key) => typeof key !== "string")
      || !credentialFields.every((field) => ownKeys.includes(field))) {
      addFactoryReason(reasons, "invalid_credentials", "credentials", "Credentials must contain only apiKey.");
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, "apiKey");
    if (!descriptor || !Object.hasOwn(descriptor, "value")
      || typeof descriptor.value !== "string"
      || descriptor.value.length === 0
      || descriptor.value.length > openAIModelProviderLimits.maxApiKeyLength
      || descriptor.value.trim().length === 0
      || unsafeSecretCharacterPattern.test(descriptor.value)) {
      addFactoryReason(reasons, "invalid_credentials", "credentials.apiKey", "apiKey is invalid.");
      return null;
    }
    return descriptor.value;
  } catch {
    addFactoryReason(reasons, "invalid_credentials", "credentials", "Credentials could not be safely inspected.");
    return null;
  }
}

function defaultCreateClient(options: OpenAIModelProviderClientOptions): OpenAIModelProviderClient {
  return new OpenAI({
    apiKey: options.apiKey,
    maxRetries: 0,
    timeout: options.timeout,
    logLevel: "off",
  }) as unknown as OpenAIModelProviderClient;
}

function defaultMonotonicNow(): number {
  return performance.now();
}

function defaultObservedAt(): string {
  return new Date().toISOString();
}

function captureDependencies(
  input: OpenAIModelProviderDependencies | undefined,
  reasons: MutableFactoryReasons,
): CapturedDependencies | null {
  if (input === undefined) {
    return {
      createClient: defaultCreateClient,
      monotonicNow: defaultMonotonicNow,
      observedAt: defaultObservedAt,
    };
  }
  try {
    if (!isPlainRecord(input)) {
      addFactoryReason(reasons, "invalid_dependencies", "dependencies", "Dependencies must be an ordinary object.");
      return null;
    }
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key !== "string" || !dependencyFields.includes(key as never))) {
      addFactoryReason(reasons, "invalid_dependencies", "dependencies", "Dependencies contain unknown fields.");
      return null;
    }
    const captureFunction = <T extends (...args: never[]) => unknown>(
      key: (typeof dependencyFields)[number],
      fallback: T,
    ): T | null => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) return fallback;
      if (!Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function") return null;
      return descriptor.value as T;
    };
    const createClient = captureFunction("createClient", defaultCreateClient);
    const monotonicNow = captureFunction("monotonicNow", defaultMonotonicNow);
    const observedAt = captureFunction("observedAt", defaultObservedAt);
    if (!createClient || !monotonicNow || !observedAt) {
      addFactoryReason(reasons, "invalid_dependencies", "dependencies", "Dependency hooks must be own functions.");
      return null;
    }
    return { createClient, monotonicNow, observedAt } as CapturedDependencies;
  } catch {
    addFactoryReason(reasons, "invalid_dependencies", "dependencies", "Dependencies could not be safely captured.");
    return null;
  }
}

function captureClient(client: OpenAIModelProviderClient): CapturedClient | null {
  try {
    const responses = client.responses;
    const models = client.models;
    const createResponse = responses.create;
    const retrieveModel = models.retrieve;
    if (typeof createResponse !== "function" || typeof retrieveModel !== "function") return null;
    return {
      createResponse: createResponse.bind(responses),
      retrieveModel: retrieveModel.bind(models),
    };
  } catch {
    return null;
  }
}

function elapsedMilliseconds(start: number, end: number): number | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const elapsed = Math.ceil(end - start);
  return safeInteger(elapsed, 0, modelInvocationLimits.maxLatencyMs);
}

function calculateCost(
  inputTokens: number,
  outputTokens: number,
  config: OpenAIModelProviderConfig,
): number | null {
  const numerator = BigInt(inputTokens) * BigInt(config.inputCostUsdMicrosPerMillionTokens)
    + BigInt(outputTokens) * BigInt(config.outputCostUsdMicrosPerMillionTokens);
  const rounded = (numerator + BigInt(999_999)) / BigInt(1_000_000);
  if (rounded > BigInt(modelInvocationLimits.maxCostUsdMicros)) return null;
  return Number(rounded);
}

function responseInput(request: ModelInvocationRequest, config: OpenAIModelProviderConfig) {
  const firstSystemIndex = request.messages.findIndex((message) => message.role === "system");
  const input = request.messages
    .filter((_, index) => index !== firstSystemIndex)
    .map((message) => ({
      role: message.role as "system" | "user" | "assistant",
      content: message.content,
    }));
  const output: OpenAIResponseCreateInput = {
    model: config.identity.providerModelId,
    input,
    store: false,
    stream: false,
    background: false,
    max_output_tokens: config.maxOutputTokens,
    ...(firstSystemIndex >= 0
      ? { instructions: request.messages[firstSystemIndex]?.content }
      : {}),
  };
  return freezeModelProviderAdapterData(output);
}

function classifyError(error: unknown): ErrorClassification {
  if (error instanceof APIConnectionTimeoutError) {
    return { category: "timeout", code: "openai_timeout", message: "OpenAI request timed out.", retryable: true, transient: true };
  }
  if (error instanceof RateLimitError) {
    return { category: "rate_limited", code: "openai_rate_limited", message: "OpenAI rate limit was reached.", retryable: true, transient: true };
  }
  if (error instanceof APIConnectionError) {
    return { category: "unavailable", code: "openai_connection_unavailable", message: "OpenAI connection is unavailable.", retryable: true, transient: true };
  }
  if (error instanceof InternalServerError
    || (error instanceof APIError && typeof error.status === "number" && error.status >= 500)) {
    return { category: "unavailable", code: "openai_service_unavailable", message: "OpenAI service is unavailable.", retryable: true, transient: true };
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError
    || error instanceof BadRequestError || error instanceof NotFoundError
    || error instanceof UnprocessableEntityError) {
    return { category: "provider_error", code: "openai_request_rejected", message: "OpenAI rejected the request.", retryable: false, transient: false };
  }
  return { category: "unknown", code: "openai_unknown_error", message: "OpenAI request failed safely.", retryable: false, transient: false };
}

function usageFromResponse(
  input: Record<string, unknown>,
  config: OpenAIModelProviderConfig,
): Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number; cost: number }> | null {
  const usage = input.usage;
  if (!isPlainRecord(usage)) return null;
  const inputTokens = safeInteger(usage.input_tokens, 0, modelInvocationLimits.maxTokenCount);
  const outputTokens = safeInteger(usage.output_tokens, 0, modelInvocationLimits.maxTokenCount);
  const totalTokens = safeInteger(usage.total_tokens, 0, modelInvocationLimits.maxTokenCount);
  if (inputTokens === null || outputTokens === null || totalTokens === null
    || totalTokens !== inputTokens + outputTokens
    || inputTokens > config.maxInputTokens || outputTokens > config.maxOutputTokens) return null;
  const cost = calculateCost(inputTokens, outputTokens, config);
  return cost === null ? null : { inputTokens, outputTokens, totalTokens, cost };
}

type SupportedResponseStatus = "completed" | "incomplete";

function extractOutput(
  input: Record<string, unknown>,
  responseStatus: SupportedResponseStatus,
): Readonly<{
  text: string;
  refusal: boolean;
}> | null {
  if (!isOrdinaryArray(input.output)) return null;
  let text = "";
  let hasText = false;
  let hasMessage = false;
  let refusal = false;
  for (const item of input.output) {
    if (!isPlainRecord(item)) return null;
    if (item.type === "reasoning") {
      const statusIsCompatible = item.status === undefined
        || item.status === "completed"
        || (responseStatus === "incomplete" && item.status === "incomplete");
      if (!statusIsCompatible) return null;
      continue;
    }
    if (item.type !== "message"
      || item.role !== "assistant"
      || item.status !== responseStatus
      || !isOrdinaryArray(item.content)) return null;
    hasMessage = true;
    for (const content of item.content) {
      if (!isPlainRecord(content)) return null;
      if (content.type === "output_text" && typeof content.text === "string") {
        hasText = true;
        text += content.text;
      } else if (content.type === "refusal" && typeof content.refusal === "string") {
        if (content.refusal.trim().length === 0) return null;
        refusal = true;
      } else return null;
    }
  }
  if (!hasMessage || (refusal && hasText)) return null;
  return { text, refusal };
}

function mapResponse(
  input: unknown,
  request: ModelInvocationRequest,
  config: OpenAIModelProviderConfig,
  latencyMs: number,
): MappedResponse {
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok || !isPlainRecord(snapshot.value)) {
    return { ok: false, code: snapshot.ok ? "invalid_response" : snapshot.limited ? "limit_exceeded" : "invalid_response", message: "OpenAI response could not be safely inspected." };
  }
  const response = snapshot.value;
  if (response.model !== config.identity.providerModelVersion) {
    return { ok: false, code: "model_identity_mismatch", message: "OpenAI response model does not match configured version." };
  }
  if (response.status !== "completed" && response.status !== "incomplete") {
    return { ok: false, code: "invalid_response", message: "OpenAI response status is not a supported terminal state." };
  }
  if (response.error !== null) {
    return { ok: false, code: "invalid_response", message: "OpenAI terminal response contains an incompatible error state." };
  }
  const incomplete = response.incomplete_details;
  const incompleteReason = response.status === "completed"
    ? incomplete === null
      ? null
      : undefined
    : isPlainRecord(incomplete)
        && hasExactFields(incomplete, ["reason"])
        && (incomplete.reason === "max_output_tokens" || incomplete.reason === "content_filter")
      ? incomplete.reason
      : undefined;
  if (incompleteReason === undefined) {
    return { ok: false, code: "invalid_response", message: "OpenAI response status and incomplete details are inconsistent." };
  }
  const usage = usageFromResponse(response, config);
  if (!usage) return { ok: false, code: "usage_mismatch", message: "OpenAI response usage is invalid or exceeds configured limits." };
  const output = extractOutput(response, response.status);
  if (!output) return { ok: false, code: "invalid_response", message: "OpenAI response output shape is unsupported." };
  if (response.status === "incomplete"
    && incompleteReason === "max_output_tokens"
    && output.refusal) {
    return { ok: false, code: "invalid_response", message: "OpenAI incomplete reason conflicts with refusal output." };
  }
  const contentFiltered = response.status === "completed"
    ? output.refusal
    : incompleteReason === "content_filter";
  const meaningfulText = output.text.trim().length > 0;
  let result: ModelInvocationResult;
  if (contentFiltered) {
    result = {
      invocationId: request.invocationId,
      outcome: "failed",
      finishReason: "content_filter",
      providerId: config.identity.providerId,
      providerModelId: config.identity.providerModelId,
      providerModelVersion: config.identity.providerModelVersion,
      outputText: null,
      structuredOutput: null,
      toolCallProposals: [],
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      },
      latencyMs,
      costUsdMicros: usage.cost,
      error: {
        category: "content_filtered",
        code: "openai_content_filtered",
        message: "OpenAI response was filtered.",
        retryable: false,
      },
    };
  } else if (response.status === "completed" && meaningfulText) {
    result = {
      invocationId: request.invocationId,
      outcome: "succeeded",
      finishReason: "stop",
      providerId: config.identity.providerId,
      providerModelId: config.identity.providerModelId,
      providerModelVersion: config.identity.providerModelVersion,
      outputText: output.text,
      structuredOutput: null,
      toolCallProposals: [],
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens },
      latencyMs,
      costUsdMicros: usage.cost,
      error: null,
    };
  } else if (incompleteReason === "max_output_tokens" && meaningfulText) {
    result = {
      invocationId: request.invocationId,
      outcome: "succeeded",
      finishReason: "length",
      providerId: config.identity.providerId,
      providerModelId: config.identity.providerModelId,
      providerModelVersion: config.identity.providerModelVersion,
      outputText: output.text,
      structuredOutput: null,
      toolCallProposals: [],
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens },
      latencyMs,
      costUsdMicros: usage.cost,
      error: null,
    };
  } else {
    return { ok: false, code: "invalid_response", message: "OpenAI response has no supported meaningful output." };
  }
  return { ok: true, result };
}

function transportFailureResult(
  request: ModelInvocationRequest,
  config: OpenAIModelProviderConfig,
  latencyMs: number,
  error: unknown,
): ModelInvocationResult {
  const classification = classifyError(error);
  return {
    invocationId: request.invocationId,
    outcome: "failed",
    finishReason: "error",
    providerId: config.identity.providerId,
    providerModelId: config.identity.providerModelId,
    providerModelVersion: config.identity.providerModelVersion,
    outputText: null,
    structuredOutput: null,
    toolCallProposals: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    latencyMs,
    costUsdMicros: 0,
    error: {
      category: classification.category,
      code: classification.code,
      message: classification.message,
      retryable: classification.retryable,
    },
  };
}

function validateProviderResult(
  identity: ModelProviderIdentity,
  requestDecision: ModelInvocationRequestValidationDecision,
  result: ModelInvocationResult,
): ModelProviderAdapterRunDecision {
  const resultDecision = validateAndNormalizeModelInvocationResult(result);
  if (resultDecision.verdict !== "allow" || !resultDecision.normalizedResult) {
    return runDeny(
      identity,
      "invalid_response",
      "response",
      "Mapped OpenAI result failed factual AI-022 validation.",
      requestDecision,
      resultDecision,
    );
  }
  return freezeModelProviderAdapterData({
    verdict: "allow",
    reasons: [],
    requestDecision,
    resultDecision,
    normalizedResult: cloneModelProviderAdapterData(resultDecision.normalizedResult),
  });
}

function createProvider(
  config: OpenAIModelProviderConfig,
  client: CapturedClient,
  dependencies: CapturedDependencies,
): ModelProvider {
  const internalConfig = freezeModelProviderAdapterData(cloneModelProviderAdapterData(config));
  const publicIdentity = freezeModelProviderAdapterData(
    cloneModelProviderAdapterData(internalConfig.identity),
  );
  const provider: ModelProvider = {
    identity: publicIdentity,
    async run(input: unknown): Promise<ModelProviderAdapterRunDecision> {
      const requestDecision = validateAndNormalizeModelInvocationRequest(input);
      if (requestDecision.verdict !== "allow" || !requestDecision.normalizedRequest) {
        return runDeny(
          publicIdentity,
          "invalid_request",
          "$",
          "Request failed factual AI-022 validation.",
          requestDecision,
        );
      }
      const request = requestDecision.normalizedRequest;
      if (request.toolIds.length > 0) {
        return runDeny(
          publicIdentity,
          "tool_not_allowed",
          "$.toolIds",
          "AI-026 does not support tool requests.",
          requestDecision,
        );
      }
      if (request.messages.some((message) => message.role === "tool"
        || message.content.trim().length === 0)) {
        return runDeny(
          publicIdentity,
          "unsupported_request",
          "$.messages",
          "AI-026 supports meaningful system, user, and assistant text messages only.",
          requestDecision,
        );
      }

      const start = dependencies.monotonicNow();
      try {
        const rawResponse = await client.createResponse(responseInput(request, internalConfig));
        const latencyMs = elapsedMilliseconds(start, dependencies.monotonicNow());
        if (latencyMs === null) {
          return runDeny(publicIdentity, "invalid_response", "response", "OpenAI latency is invalid.", requestDecision);
        }
        const mapped = mapResponse(rawResponse, request, internalConfig, latencyMs);
        if (!mapped.ok) {
          return runDeny(publicIdentity, mapped.code, "response", mapped.message, requestDecision);
        }
        return validateProviderResult(publicIdentity, requestDecision, mapped.result);
      } catch (error) {
        const latencyMs = elapsedMilliseconds(start, dependencies.monotonicNow());
        if (latencyMs === null) {
          return runDeny(publicIdentity, "provider_exception", "response", "OpenAI request failed with invalid latency.", requestDecision);
        }
        return validateProviderResult(
          publicIdentity,
          requestDecision,
          transportFailureResult(request, internalConfig, latencyMs, error),
        );
      }
    },
    async health(): Promise<ModelProviderHealthValidationDecision> {
      const start = dependencies.monotonicNow();
      try {
        const rawModel = await client.retrieveModel(internalConfig.identity.providerModelId);
        const latencyMs = elapsedMilliseconds(start, dependencies.monotonicNow());
        const observedAt = dependencies.observedAt();
        const snapshot = snapshotModelProviderAdapterInput(rawModel);
        if (latencyMs === null || !snapshot.ok || !isPlainRecord(snapshot.value)
          || snapshot.value.id !== internalConfig.identity.providerModelId) {
          return freezeModelProviderAdapterData({
            verdict: "deny",
            reasons: [adapterReason(
              "identity_mismatch",
              "health.model.id",
              "OpenAI health model identity is invalid.",
              publicIdentity,
              null,
            )],
            normalizedHealth: null,
          });
        }
        return validateAndNormalizeModelProviderHealth({
          providerId: internalConfig.identity.providerId,
          deploymentId: internalConfig.identity.deploymentId,
          status: "healthy",
          observedAt,
          latencyMs,
          detailCode: null,
        });
      } catch (error) {
        const classification = classifyError(error);
        const latencyMs = elapsedMilliseconds(start, dependencies.monotonicNow());
        const observedAt = dependencies.observedAt();
        if (classification.transient && latencyMs !== null) {
          return validateAndNormalizeModelProviderHealth({
            providerId: internalConfig.identity.providerId,
            deploymentId: internalConfig.identity.deploymentId,
            status: "unavailable",
            observedAt,
            latencyMs,
            detailCode: classification.code,
          });
        }
        return freezeModelProviderAdapterData({
          verdict: "deny",
          reasons: [adapterReason(
            "provider_exception",
            "health",
            "OpenAI health check failed safely.",
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

export function createOpenAIModelProvider(
  configInput: unknown,
  credentialsInput: unknown,
  dependenciesInput?: OpenAIModelProviderDependencies,
): OpenAIModelProviderFactoryDecision {
  const reasons: MutableFactoryReasons = [];
  const config = normalizeConfig(configInput, reasons);
  if (!config) return factoryDeny(reasons);
  const apiKey = captureApiKey(credentialsInput, reasons);
  if (!apiKey) return factoryDeny(reasons);
  const dependencies = captureDependencies(dependenciesInput, reasons);
  if (!dependencies) return factoryDeny(reasons);

  let client: OpenAIModelProviderClient;
  try {
    client = dependencies.createClient({
      apiKey,
      maxRetries: 0,
      timeout: config.timeoutMs,
      logLevel: "off",
    });
  } catch {
    addFactoryReason(
      reasons,
      "provider_exception",
      "dependencies.createClient",
      "OpenAI client could not be created.",
      config.identity,
    );
    return factoryDeny(reasons);
  }
  const capturedClient = captureClient(client);
  if (!capturedClient) {
    addFactoryReason(
      reasons,
      "invalid_dependencies",
      "dependencies.createClient",
      "OpenAI client does not implement the required Responses and Models methods.",
      config.identity,
    );
    return factoryDeny(reasons);
  }

  const normalizedConfig = freezeModelProviderAdapterData(cloneModelProviderAdapterData(config));
  return freezeModelProviderAdapterData({
    verdict: "allow",
    reasons: [],
    normalizedConfig,
    provider: createProvider(normalizedConfig, capturedClient, dependencies),
  });
}
