import type { RiskLevel } from "./domain";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isRiskLevel } from "./domain.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelInvocationLimits } from "./model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { freezeModelProviderAdapterData, snapshotModelProviderAdapterInput } from "./model-provider-adapter.ts";

export const modelCapabilityTiers = Object.freeze([
  "deterministic",
  "economy",
  "reasoning",
  "advanced_reasoning",
  "coding",
] as const);
export type ModelCapabilityTier = (typeof modelCapabilityTiers)[number];

export const modelCapabilityTaskClasses = Object.freeze([
  "deterministic_operation",
  "classification",
  "summarization",
  "structured_transformation",
  "analysis",
  "planning",
  "review",
  "quality_assurance",
  "security_analysis",
  "architecture",
  "implementation",
] as const);
export type ModelCapabilityTaskClass = (typeof modelCapabilityTaskClasses)[number];

export const modelCapabilityRoutingVerdicts = Object.freeze(["allow", "deny"] as const);
export type ModelCapabilityRoutingVerdict = (typeof modelCapabilityRoutingVerdicts)[number];

export const modelCapabilityRoutingPolicyLimits = Object.freeze({
  maxInputTokens: modelInvocationLimits.maxTokenCount,
  maxOutputTokens: modelInvocationLimits.maxTokenCount,
  maxCostUsdMicros: modelInvocationLimits.maxCostUsdMicros,
  maxReasons: modelInvocationLimits.maxValidationReasons,
});

export type ModelCapabilityBudget = Readonly<{
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostUsdMicros: number;
}>;

export type ModelCapabilityRoutingPolicyInput = Readonly<{
  taskClass: ModelCapabilityTaskClass;
  requestedCapability: ModelCapabilityTier;
  riskLevel: RiskLevel;
  requiresModel: boolean;
  requiresRepositoryRead: boolean;
  requiresRepositoryWrite: boolean;
  requiresCommandExecution: boolean;
  requiresNetwork: boolean;
  budget: ModelCapabilityBudget;
}>;

export type ModelCapabilityRoutingReasonCode =
  | "invalid_input"
  | "limit_exceeded"
  | "invalid_task_class"
  | "invalid_capability"
  | "invalid_risk_level"
  | "invalid_requirement"
  | "invalid_budget"
  | "model_not_required"
  | "deterministic_requires_no_model"
  | "capability_not_authorized"
  | "repository_write_requires_read"
  | "repository_write_requires_coding"
  | "coding_requires_repository_write"
  | "coding_requires_command_execution"
  | "risk_approval_required";

export type ModelCapabilityRoutingReason = Readonly<{
  code: ModelCapabilityRoutingReasonCode;
  path: string;
  message: string;
}>;

export type ModelCapabilityRoutingDecision = Readonly<{
  verdict: ModelCapabilityRoutingVerdict;
  reasons: readonly ModelCapabilityRoutingReason[];
  authorizedCapability: ModelCapabilityTier | null;
  modelExecutionAllowed: boolean;
  repositoryReadRequired: boolean | null;
  repositoryWriteRequired: boolean | null;
  commandExecutionRequired: boolean | null;
  networkRequired: boolean | null;
  budget: ModelCapabilityBudget | null;
}>;

type MutableReasons = ModelCapabilityRoutingReason[];

const inputFields = Object.freeze([
  "taskClass",
  "requestedCapability",
  "riskLevel",
  "requiresModel",
  "requiresRepositoryRead",
  "requiresRepositoryWrite",
  "requiresCommandExecution",
  "requiresNetwork",
  "budget",
] as const);
const budgetFields = Object.freeze([
  "maxInputTokens",
  "maxOutputTokens",
  "maxCostUsdMicros",
] as const);
const booleanRequirementFields = Object.freeze([
  "requiresModel",
  "requiresRepositoryRead",
  "requiresRepositoryWrite",
  "requiresCommandExecution",
  "requiresNetwork",
] as const);

const taskClassCapabilities = Object.freeze({
  deterministic_operation: [],
  classification: ["economy"],
  summarization: ["economy"],
  structured_transformation: ["economy"],
  analysis: ["reasoning"],
  planning: ["reasoning"],
  review: ["reasoning"],
  quality_assurance: ["economy", "reasoning"],
  security_analysis: ["reasoning", "advanced_reasoning"],
  architecture: ["reasoning", "advanced_reasoning"],
  implementation: ["reasoning", "coding"],
} as const satisfies Readonly<Record<
  ModelCapabilityTaskClass,
  readonly Exclude<ModelCapabilityTier, "deterministic">[]
>>);

function includes<T>(values: readonly T[], input: unknown): input is T {
  return values.some((value) => value === input);
}

export function isModelCapabilityTier(input: unknown): input is ModelCapabilityTier {
  return includes(modelCapabilityTiers, input);
}

export function parseModelCapabilityTier(input: unknown): ModelCapabilityTier | null {
  return isModelCapabilityTier(input) ? input : null;
}

export function isModelCapabilityTaskClass(input: unknown): input is ModelCapabilityTaskClass {
  return includes(modelCapabilityTaskClasses, input);
}

export function parseModelCapabilityTaskClass(input: unknown): ModelCapabilityTaskClass | null {
  return isModelCapabilityTaskClass(input) ? input : null;
}

export function isModelCapabilityRoutingVerdict(
  input: unknown,
): input is ModelCapabilityRoutingVerdict {
  return includes(modelCapabilityRoutingVerdicts, input);
}

export function parseModelCapabilityRoutingVerdict(
  input: unknown,
): ModelCapabilityRoutingVerdict | null {
  return isModelCapabilityRoutingVerdict(input) ? input : null;
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

function addReason(
  reasons: MutableReasons,
  code: ModelCapabilityRoutingReasonCode,
  path: string,
  message: string,
): void {
  if (reasons.length >= modelCapabilityRoutingPolicyLimits.maxReasons) return;
  reasons.push({ code, path, message });
}

function deny(reasons: readonly ModelCapabilityRoutingReason[]): ModelCapabilityRoutingDecision {
  return freezeModelProviderAdapterData({
    verdict: "deny",
    reasons: reasons.map((reason) => ({ ...reason })),
    authorizedCapability: null,
    modelExecutionAllowed: false,
    repositoryReadRequired: null,
    repositoryWriteRequired: null,
    commandExecutionRequired: null,
    networkRequired: null,
    budget: null,
  });
}

function allow(
  input: ModelCapabilityRoutingPolicyInput,
  budget: ModelCapabilityBudget,
): ModelCapabilityRoutingDecision {
  return freezeModelProviderAdapterData({
    verdict: "allow",
    reasons: [],
    authorizedCapability: input.requestedCapability,
    modelExecutionAllowed: input.requestedCapability !== "deterministic",
    repositoryReadRequired: input.requiresRepositoryRead,
    repositoryWriteRequired: input.requiresRepositoryWrite,
    commandExecutionRequired: input.requiresCommandExecution,
    networkRequired: input.requiresNetwork,
    budget: { ...budget },
  });
}

function boundedPositiveInteger(input: unknown, maximum: number): number | null {
  return Number.isSafeInteger(input) && (input as number) > 0 && (input as number) <= maximum
    ? input as number
    : null;
}

function normalizeBudget(
  input: unknown,
  reasons: MutableReasons,
): ModelCapabilityBudget | null {
  if (!isPlainRecord(input) || !hasExactFields(input, budgetFields)) {
    addReason(
      reasons,
      "invalid_budget",
      "budget",
      "budget must contain exactly the canonical bounded budget fields.",
    );
    return null;
  }
  const maxInputTokens = boundedPositiveInteger(
    input.maxInputTokens,
    modelCapabilityRoutingPolicyLimits.maxInputTokens,
  );
  const maxOutputTokens = boundedPositiveInteger(
    input.maxOutputTokens,
    modelCapabilityRoutingPolicyLimits.maxOutputTokens,
  );
  const maxCostUsdMicros = boundedPositiveInteger(
    input.maxCostUsdMicros,
    modelCapabilityRoutingPolicyLimits.maxCostUsdMicros,
  );
  if (maxInputTokens === null) {
    addReason(
      reasons,
      "invalid_budget",
      "budget.maxInputTokens",
      "maxInputTokens must be a positive bounded safe integer.",
    );
  }
  if (maxOutputTokens === null) {
    addReason(
      reasons,
      "invalid_budget",
      "budget.maxOutputTokens",
      "maxOutputTokens must be a positive bounded safe integer.",
    );
  }
  if (maxCostUsdMicros === null) {
    addReason(
      reasons,
      "invalid_budget",
      "budget.maxCostUsdMicros",
      "maxCostUsdMicros must be a positive bounded safe integer.",
    );
  }
  return maxInputTokens === null || maxOutputTokens === null || maxCostUsdMicros === null
    ? null
    : { maxInputTokens, maxOutputTokens, maxCostUsdMicros };
}

function capabilityAllowedForTaskClass(
  taskClass: ModelCapabilityTaskClass,
  capability: ModelCapabilityTier,
): boolean {
  const allowed = taskClassCapabilities[taskClass] as readonly Exclude<
    ModelCapabilityTier,
    "deterministic"
  >[];
  return capability === "deterministic"
    || allowed.includes(capability);
}

export function evaluateModelCapabilityRoutingPolicy(
  input: unknown,
): ModelCapabilityRoutingDecision {
  const reasons: MutableReasons = [];
  const snapshot = snapshotModelProviderAdapterInput(input);
  if (!snapshot.ok) {
    addReason(
      reasons,
      snapshot.limited ? "limit_exceeded" : "invalid_input",
      "$",
      snapshot.limited
        ? "Capability policy input exceeds bounded inspection limits."
        : "Capability policy input could not be safely inspected.",
    );
    return deny(reasons);
  }
  if (!isPlainRecord(snapshot.value) || !hasExactFields(snapshot.value, inputFields)) {
    addReason(
      reasons,
      "invalid_input",
      "$",
      "Capability policy input must contain exactly the canonical fields.",
    );
    return deny(reasons);
  }

  const value = snapshot.value;
  const taskClass = parseModelCapabilityTaskClass(value.taskClass);
  const requestedCapability = parseModelCapabilityTier(value.requestedCapability);
  const riskLevel = isRiskLevel(value.riskLevel) ? value.riskLevel : null;
  if (!taskClass) {
    addReason(reasons, "invalid_task_class", "taskClass", "taskClass is not canonical.");
  }
  if (!requestedCapability) {
    addReason(
      reasons,
      "invalid_capability",
      "requestedCapability",
      "requestedCapability is not canonical.",
    );
  }
  if (!riskLevel) {
    addReason(reasons, "invalid_risk_level", "riskLevel", "riskLevel is not canonical.");
  }
  for (const field of booleanRequirementFields) {
    if (typeof value[field] !== "boolean") {
      addReason(
        reasons,
        "invalid_requirement",
        field,
        "Capability requirements must be explicit booleans.",
      );
    }
  }
  const budget = normalizeBudget(value.budget, reasons);
  if (reasons.length > 0 || !taskClass || !requestedCapability || !riskLevel || !budget) {
    return deny(reasons);
  }

  const normalizedInput = value as unknown as ModelCapabilityRoutingPolicyInput;
  if (requestedCapability === "deterministic" && normalizedInput.requiresModel) {
    addReason(
      reasons,
      "deterministic_requires_no_model",
      "requiresModel",
      "Deterministic capability cannot authorize model execution.",
    );
  }
  if (requestedCapability !== "deterministic" && !normalizedInput.requiresModel) {
    addReason(
      reasons,
      "model_not_required",
      "requestedCapability",
      "A model capability cannot be authorized when the task does not require a model.",
    );
  }
  if (!capabilityAllowedForTaskClass(taskClass, requestedCapability)) {
    addReason(
      reasons,
      "capability_not_authorized",
      "requestedCapability",
      "The requested capability is not authorized for the factual task class.",
    );
  }
  if (normalizedInput.requiresRepositoryWrite && !normalizedInput.requiresRepositoryRead) {
    addReason(
      reasons,
      "repository_write_requires_read",
      "requiresRepositoryRead",
      "Repository write authority requires explicit repository read authority.",
    );
  }
  if (requestedCapability === "coding") {
    if (!normalizedInput.requiresRepositoryWrite) {
      addReason(
        reasons,
        "coding_requires_repository_write",
        "requiresRepositoryWrite",
        "Coding capability requires explicit repository write authority.",
      );
    }
    if (!normalizedInput.requiresCommandExecution) {
      addReason(
        reasons,
        "coding_requires_command_execution",
        "requiresCommandExecution",
        "Coding capability requires explicit command execution authority.",
      );
    }
  } else if (normalizedInput.requiresRepositoryWrite) {
    addReason(
      reasons,
      "repository_write_requires_coding",
      "requiresRepositoryWrite",
      "Repository write authority is available only to coding capability in v1.",
    );
  }
  if ((riskLevel === "high" || riskLevel === "critical")
    && (requestedCapability === "advanced_reasoning" || requestedCapability === "coding")) {
    addReason(
      reasons,
      "risk_approval_required",
      "riskLevel",
      "High-risk advanced capability requires approval orchestration outside this policy.",
    );
  }

  return reasons.length > 0 ? deny(reasons) : allow(normalizedInput, budget);
}
