import type { AgentOutputType } from "./agent-manifest";
import type { ModelInvocationAdmissionDecision, ModelInvocationAdmissionInput } from "./model-invocation";
import type { ProjectDataEgressMode } from "./project-manifest";
import type { WorkspaceProjectContextsDecision } from "./project-context";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { agentOutputTypes } from "./agent-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateModelInvocationAdmission } from "./model-invocation.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { projectDataEgressModes, projectManifestLimits } from "./project-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkspaceProjectContexts } from "./project-context.ts";

export const modelProviderKinds = Object.freeze(["openai", "anthropic", "deepseek", "qwen", "local", "mock"] as const);
export type ModelProviderKind = (typeof modelProviderKinds)[number];
export const modelProviderStatuses = Object.freeze(["active", "paused", "disabled"] as const);
export type ModelProviderStatus = (typeof modelProviderStatuses)[number];
export const modelDeploymentModes = Object.freeze(["remote", "local"] as const);
export type ModelDeploymentMode = (typeof modelDeploymentModes)[number];
export const modelProviderCapabilities = Object.freeze(["messages", "structured_output", "tool_calls", "vision", "long_context"] as const);
export type ModelProviderCapability = (typeof modelProviderCapabilities)[number];
export const modelRoutingVerdicts = Object.freeze(["allow", "deny"] as const);
export type ModelRoutingVerdict = (typeof modelRoutingVerdicts)[number];
export const modelDataHandlingRequirements = Object.freeze(["local_only", "redaction_required", "approval_required"] as const);
export type ModelDataHandlingRequirement = (typeof modelDataHandlingRequirements)[number];
export const modelLatencyClasses = Object.freeze(["realtime", "standard", "batch"] as const);
export type ModelLatencyClass = (typeof modelLatencyClasses)[number];
export const modelQualityTiers = Object.freeze(["economy", "balanced", "reasoning"] as const);
export type ModelQualityTier = (typeof modelQualityTiers)[number];

export const modelProviderRegistryLimits = Object.freeze({
  maxIdLength: 64,
  maxAuditStringLength: 256,
  maxProviders: 128,
  maxDeployments: 512,
  maxModelProfiles: 512,
  maxRoutes: 512,
  maxCandidatesPerProfile: 64,
  maxDataRegions: 64,
  maxCapabilities: modelProviderCapabilities.length,
  maxOutputTypes: agentOutputTypes.length,
  maxTokenCeiling: 9_000_000_000,
  maxPriceUsdMicrosPerMillionTokens: 9_000_000_000_000,
  maxInspectedProperties: 600_000,
  maxEnvelopeDepth: 64,
  maxEnvelopeArrayLength: 4_096,
  maxEnvelopeStringLength: 131_072,
  maxReasons: 512,
});

export type ModelProviderDescriptor = Readonly<{
  id: string; kind: ModelProviderKind; status: ModelProviderStatus; deploymentMode: ModelDeploymentMode;
  supportedDataRegions: readonly string[]; supportedDataEgressModes: readonly ProjectDataEgressMode[];
  capabilities: readonly ModelProviderCapability[];
}>;
export type ModelDeployment = Readonly<{
  id: string; providerId: string; status: ModelProviderStatus; providerModelId: string; providerModelVersion: string;
  capabilities: readonly ModelProviderCapability[]; supportedOutputTypes: readonly AgentOutputType[];
  maxInputTokens: number; maxOutputTokens: number; inputCostUsdMicrosPerMillionTokens: number;
  outputCostUsdMicrosPerMillionTokens: number; latencyClass: ModelLatencyClass; qualityTier: ModelQualityTier;
}>;
export type ModelProfileCandidate = Readonly<{ deploymentId: string; priority: number }>;
export type ModelProfileRoute = Readonly<{
  modelProfileId: string; status: ModelProviderStatus; requiredCapabilities: readonly ModelProviderCapability[];
  supportedOutputTypes: readonly AgentOutputType[]; candidates: readonly ModelProfileCandidate[];
}>;
export type ModelProviderRegistry = Readonly<{
  workspaceId: string; version: number; providers: readonly ModelProviderDescriptor[];
  deployments: readonly ModelDeployment[]; modelProfiles: readonly ModelProfileRoute[];
}>;

export type ModelProviderRegistryReasonCode =
  | "invalid_input" | "limit_exceeded" | "invalid_project_registry" | "invalid_invocation_admission"
  | "invalid_provider_registry" | "provider_deployment_mode_mismatch" | "workspace_mismatch" | "project_version_mismatch"
  | "duplicate_provider_id" | "duplicate_deployment_id" | "duplicate_model_profile_id"
  | "provider_not_found" | "deployment_not_found" | "model_profile_missing" | "model_profile_inactive"
  | "provider_inactive" | "deployment_inactive" | "region_not_supported" | "data_egress_not_supported"
  | "capability_not_supported" | "tools_not_supported" | "output_type_not_supported" | "no_eligible_route";
export type ModelProviderRegistryReason = Readonly<{
  code: ModelProviderRegistryReasonCode; path: string; message: string; workspaceId: string | null;
  projectId: string | null; modelProfileId: string | null; providerId: string | null;
  deploymentId: string | null; invocationId: string | null;
}>;
export type ModelProviderRegistryValidationDecision = Readonly<{
  verdict: ModelRoutingVerdict; reasons: readonly ModelProviderRegistryReason[]; normalizedRegistry: ModelProviderRegistry | null;
}>;
export type WorkspaceModelProviderRegistryInput = Readonly<{ projectRegistry: unknown; modelProviderRegistry: unknown }>;
export type WorkspaceModelProviderRegistryDecision = Readonly<{
  verdict: ModelRoutingVerdict; reasons: readonly ModelProviderRegistryReason[];
  projectRegistryDecision: WorkspaceProjectContextsDecision | null; normalizedRegistry: ModelProviderRegistry | null;
}>;
export type ModelInvocationRouteCandidate = Readonly<{
  priority: number; providerId: string; providerKind: ModelProviderKind; deploymentId: string;
  providerModelId: string; providerModelVersion: string; deploymentMode: ModelDeploymentMode;
  dataHandlingRequirement: ModelDataHandlingRequirement; capabilities: readonly ModelProviderCapability[];
  supportedOutputTypes: readonly AgentOutputType[]; maxInputTokens: number; maxOutputTokens: number;
  inputCostUsdMicrosPerMillionTokens: number; outputCostUsdMicrosPerMillionTokens: number;
  latencyClass: ModelLatencyClass; qualityTier: ModelQualityTier;
}>;
export type ModelInvocationRoutePlan = Readonly<{
  workspaceId: string; projectId: string; runId: string; invocationId: string; modelProfileId: string;
  projectDataRegion: string; dataEgressMode: ProjectDataEgressMode; primary: ModelInvocationRouteCandidate;
  fallbacks: readonly ModelInvocationRouteCandidate[];
}>;
export type ModelInvocationRouteResolutionInput = Readonly<{
  projectRegistry: unknown; modelProviderRegistry: unknown; invocationAdmission: ModelInvocationAdmissionInput;
}>;
export type ModelInvocationRouteResolutionDecision = Readonly<{
  verdict: ModelRoutingVerdict; reasons: readonly ModelProviderRegistryReason[];
  projectRegistryDecision: WorkspaceProjectContextsDecision | null;
  invocationAdmissionDecision: ModelInvocationAdmissionDecision | null;
  normalizedRegistry: ModelProviderRegistry | null; routePlan: ModelInvocationRoutePlan | null;
}>;

type MutableReasons = ModelProviderRegistryReason[];
type SnapshotResult = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; limited: boolean }>;
type Wrapper<T> = { value: T; path: string };
const safeIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const auditUnsafePattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const auditIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9/:@._-]*$/u;
const registryFields = ["workspaceId", "version", "providers", "deployments", "modelProfiles"] as const;
const providerFields = ["id", "kind", "status", "deploymentMode", "supportedDataRegions", "supportedDataEgressModes", "capabilities"] as const;
const remoteProviderKinds = ["openai", "anthropic", "deepseek", "qwen"] as const;
const deploymentFields = ["id", "providerId", "status", "providerModelId", "providerModelVersion", "capabilities", "supportedOutputTypes", "maxInputTokens", "maxOutputTokens", "inputCostUsdMicrosPerMillionTokens", "outputCostUsdMicrosPerMillionTokens", "latencyClass", "qualityTier"] as const;
const profileFields = ["modelProfileId", "status", "requiredCapabilities", "supportedOutputTypes", "candidates"] as const;
const candidateFields = ["deploymentId", "priority"] as const;

function includes<T>(values: readonly T[], input: unknown): input is T { return values.some((value) => value === input); }
export function isModelProviderKind(input: unknown): input is ModelProviderKind { return includes(modelProviderKinds, input); }
export function parseModelProviderKind(input: unknown): ModelProviderKind | null { return isModelProviderKind(input) ? input : null; }
export function isModelProviderStatus(input: unknown): input is ModelProviderStatus { return includes(modelProviderStatuses, input); }
export function parseModelProviderStatus(input: unknown): ModelProviderStatus | null { return isModelProviderStatus(input) ? input : null; }
export function isModelDeploymentMode(input: unknown): input is ModelDeploymentMode { return includes(modelDeploymentModes, input); }
export function parseModelDeploymentMode(input: unknown): ModelDeploymentMode | null { return isModelDeploymentMode(input) ? input : null; }
export function isModelProviderCapability(input: unknown): input is ModelProviderCapability { return includes(modelProviderCapabilities, input); }
export function parseModelProviderCapability(input: unknown): ModelProviderCapability | null { return isModelProviderCapability(input) ? input : null; }
export function isModelRoutingVerdict(input: unknown): input is ModelRoutingVerdict { return includes(modelRoutingVerdicts, input); }
export function parseModelRoutingVerdict(input: unknown): ModelRoutingVerdict | null { return isModelRoutingVerdict(input) ? input : null; }
export function isModelDataHandlingRequirement(input: unknown): input is ModelDataHandlingRequirement { return includes(modelDataHandlingRequirements, input); }
export function parseModelDataHandlingRequirement(input: unknown): ModelDataHandlingRequirement | null { return isModelDataHandlingRequirement(input) ? input : null; }
export function isModelLatencyClass(input: unknown): input is ModelLatencyClass { return includes(modelLatencyClasses, input); }
export function parseModelLatencyClass(input: unknown): ModelLatencyClass | null { return isModelLatencyClass(input) ? input : null; }
export function isModelQualityTier(input: unknown): input is ModelQualityTier { return includes(modelQualityTiers, input); }
export function parseModelQualityTier(input: unknown): ModelQualityTier | null { return isModelQualityTier(input) ? input : null; }

function cmp(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function plain(input: unknown): input is Record<string, unknown> { if (typeof input !== "object" || input === null || Array.isArray(input)) return false; const proto = Object.getPrototypeOf(input); return proto === Object.prototype || proto === null; }
function ordinary(input: unknown): input is unknown[] { return Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype; }
function exact(input: Record<string, unknown>, fields: readonly string[]): boolean { const keys = Object.keys(input); return keys.length === fields.length && fields.every((field) => Object.hasOwn(input, field)); }
function id(input: unknown): string | null { return typeof input === "string" && safeIdPattern.test(input) ? input : null; }
function audit(input: unknown): string | null { return typeof input === "string" && input.length > 0 && input.length <= modelProviderRegistryLimits.maxAuditStringLength && auditIdentifierPattern.test(input) && !auditUnsafePattern.test(input) ? input : null; }
function integer(input: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number | null { return Number.isSafeInteger(input) && (input as number) >= min && (input as number) <= max ? input as number : null; }
function freeze<T>(input: T): T { if (typeof input !== "object" || input === null || Object.isFrozen(input)) return input; for (const value of Object.values(input)) freeze(value); return Object.freeze(input); }
function clone<T>(input: T): T { if (Array.isArray(input)) return input.map(clone) as T; if (typeof input === "object" && input !== null) { const out: Record<string, unknown> = {}; for (const [key, value] of Object.entries(input)) out[key] = clone(value); return out as T; } return input; }
function reason(reasons: MutableReasons, code: ModelProviderRegistryReasonCode, path: string, message: string, context: Partial<ModelProviderRegistryReason> = {}): void { if (reasons.length >= modelProviderRegistryLimits.maxReasons) return; reasons.push({ code, path, message, workspaceId: context.workspaceId ?? null, projectId: context.projectId ?? null, modelProfileId: context.modelProfileId ?? null, providerId: context.providerId ?? null, deploymentId: context.deploymentId ?? null, invocationId: context.invocationId ?? null }); }
function snapshotValue(input: unknown, state: { inspected: number; active: WeakSet<object> }, depth: number): SnapshotResult {
  if (typeof input === "string") return input.length <= modelProviderRegistryLimits.maxEnvelopeStringLength ? { ok: true, value: input } : { ok: false, limited: true };
  if (input === null || typeof input === "boolean" || typeof input === "undefined") return { ok: true, value: input };
  if (typeof input === "number") return Number.isFinite(input) ? { ok: true, value: input } : { ok: false, limited: false };
  if (typeof input !== "object" || depth > modelProviderRegistryLimits.maxEnvelopeDepth || state.active.has(input)) return { ok: false, limited: depth > modelProviderRegistryLimits.maxEnvelopeDepth };
  try {
    const array = Array.isArray(input); if (array ? !ordinary(input) : !plain(input)) return { ok: false, limited: false };
    state.active.add(input); const ownKeys = Reflect.ownKeys(input); if (ownKeys.some((key) => typeof key !== "string")) return { ok: false, limited: false };
    const keys = (ownKeys as string[]).filter((key) => !(array && key === "length"));
    if (array && ((input as unknown[]).length > modelProviderRegistryLimits.maxEnvelopeArrayLength || keys.length !== (input as unknown[]).length)) return { ok: false, limited: (input as unknown[]).length > modelProviderRegistryLimits.maxEnvelopeArrayLength };
    state.inspected += keys.length; if (state.inspected > modelProviderRegistryLimits.maxInspectedProperties) return { ok: false, limited: true };
    const output: unknown[] | Record<string, unknown> = array ? [] : Object.create(null) as Record<string, unknown>;
    for (const key of keys) { if (array && String((output as unknown[]).length) !== key) return { ok: false, limited: false }; const descriptor = Object.getOwnPropertyDescriptor(input, key); if (!descriptor || !Object.hasOwn(descriptor, "value")) return { ok: false, limited: false }; const nested = snapshotValue(descriptor.value, state, depth + 1); if (!nested.ok) return nested; if (array) (output as unknown[]).push(nested.value); else (output as Record<string, unknown>)[key] = nested.value; }
    return { ok: true, value: output };
  } catch { return { ok: false, limited: false }; } finally { state.active.delete(input); }
}
function boundedSnapshot(input: unknown): SnapshotResult { return snapshotValue(input, { inspected: 0, active: new WeakSet<object>() }, 0); }
function enumArray<T>(input: unknown, values: readonly T[], limit: number, path: string, reasons: MutableReasons, allowEmpty = false): T[] | null {
  if (!ordinary(input) || (!allowEmpty && input.length === 0) || input.length > limit) { reason(reasons, ordinary(input) && input.length > limit ? "limit_exceeded" : "invalid_provider_registry", path, `Value must be a bounded ${allowEmpty ? "" : "non-empty "}ordinary array.`); return null; }
  const result: T[] = []; for (const [index, value] of input.entries()) { if (!includes(values, value)) reason(reasons, "invalid_provider_registry", `${path}[${index}]`, "Value is not canonical."); else if (result.includes(value)) reason(reasons, "invalid_provider_registry", `${path}[${index}]`, "Values must be unique."); else result.push(value); }
  return result.sort((a, b) => cmp(String(a), String(b)));
}
function dataRegionArray(input: unknown, path: string, reasons: MutableReasons): string[] | null {
  if (!ordinary(input) || input.length === 0 || input.length > modelProviderRegistryLimits.maxDataRegions) {
    reason(reasons, ordinary(input) && input.length > modelProviderRegistryLimits.maxDataRegions ? "limit_exceeded" : "invalid_provider_registry", path, "Data regions must be a bounded non-empty ordinary array.");
    return null;
  }
  const result: string[] = [];
  for (const [index, raw] of input.entries()) {
    const itemPath = `${path}[${index}]`;
    if (typeof raw !== "string") { reason(reasons, "invalid_provider_registry", itemPath, "Data region must be a string."); continue; }
    const normalized = raw.trim();
    if (normalized.length === 0 || auditUnsafePattern.test(raw)) { reason(reasons, "invalid_provider_registry", itemPath, "Data region must be a non-empty safe single-line value."); continue; }
    if (normalized.length > projectManifestLimits.maxDataRegionLength) { reason(reasons, "limit_exceeded", itemPath, `Data region must be at most ${projectManifestLimits.maxDataRegionLength} characters.`); continue; }
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result.sort(cmp);
}
function duplicate<T>(wrappers: Wrapper<T>[], key: (value: T) => string, code: ModelProviderRegistryReasonCode, reasons: MutableReasons, field: string): void { const sorted = [...wrappers].sort((a, b) => cmp(key(a.value), key(b.value))); for (let index = 1; index < sorted.length; index += 1) { const previous = sorted[index - 1]; const current = sorted[index]; if (previous && current && key(previous.value) === key(current.value)) reason(reasons, code, `${current.path}.${field}`, `${field} must be globally unique.`); } }

function normalizeRegistryData(input: unknown): ModelProviderRegistryValidationDecision {
  const reasons: MutableReasons = [];
  if (!plain(input) || !exact(input, registryFields)) { reason(reasons, "invalid_provider_registry", "$", "ModelProviderRegistry has missing or unknown fields."); return freeze({ verdict: "deny", reasons, normalizedRegistry: null }); }
  const workspaceId = id(input.workspaceId); const version = integer(input.version, 1);
  if (!workspaceId) reason(reasons, "invalid_provider_registry", "workspaceId", "workspaceId must be a stable ID.");
  if (version === null) reason(reasons, "invalid_provider_registry", "version", "version must be a positive safe integer.");
  const providersRaw = input.providers; const providerWrappers: Wrapper<ModelProviderDescriptor>[] = [];
  if (!ordinary(providersRaw) || providersRaw.length === 0 || providersRaw.length > modelProviderRegistryLimits.maxProviders) reason(reasons, ordinary(providersRaw) && providersRaw.length > modelProviderRegistryLimits.maxProviders ? "limit_exceeded" : "invalid_provider_registry", "providers", "providers must be a bounded non-empty ordinary array.");
  else for (const [index, raw] of providersRaw.entries()) {
    const path = `providers[${index}]`; if (!plain(raw) || !exact(raw, providerFields)) { reason(reasons, "invalid_provider_registry", path, "Provider has missing or unknown fields."); continue; }
    const providerId = id(raw.id); const kind = raw.kind; const status = raw.status; const mode = raw.deploymentMode;
    const regions = dataRegionArray(raw.supportedDataRegions, `${path}.supportedDataRegions`, reasons);
    const egress = enumArray(raw.supportedDataEgressModes, projectDataEgressModes, projectDataEgressModes.length, `${path}.supportedDataEgressModes`, reasons);
    const capabilities = enumArray(raw.capabilities, modelProviderCapabilities, modelProviderRegistryLimits.maxCapabilities, `${path}.capabilities`, reasons, true);
    if (!providerId) reason(reasons, "invalid_provider_registry", `${path}.id`, "Provider ID is invalid."); if (!includes(modelProviderKinds, kind)) reason(reasons, "invalid_provider_registry", `${path}.kind`, "Provider kind is invalid."); if (!includes(modelProviderStatuses, status)) reason(reasons, "invalid_provider_registry", `${path}.status`, "Provider status is invalid."); if (!includes(modelDeploymentModes, mode)) reason(reasons, "invalid_provider_registry", `${path}.deploymentMode`, "Deployment mode is invalid.");
    const modeMatchesKind = kind === "mock"
      || (kind === "local" && mode === "local")
      || (includes(remoteProviderKinds, kind) && mode === "remote");
    if (includes(modelProviderKinds, kind) && includes(modelDeploymentModes, mode)
      && !modeMatchesKind) {
      reason(reasons, "provider_deployment_mode_mismatch", `${path}.deploymentMode`, "Provider kind and deploymentMode are incompatible.", { providerId: providerId ?? null });
    }
    if (mode === "remote" && egress?.includes("forbidden")) reason(reasons, "invalid_provider_registry", `${path}.supportedDataEgressModes`, "Remote providers cannot support forbidden egress.", { providerId: providerId ?? null });
    if (providerId && includes(modelProviderKinds, kind) && includes(modelProviderStatuses, status) && includes(modelDeploymentModes, mode) && regions && egress && capabilities) providerWrappers.push({ path, value: { id: providerId, kind, status, deploymentMode: mode, supportedDataRegions: regions, supportedDataEgressModes: egress, capabilities } });
  }
  duplicate(providerWrappers, (value) => value.id, "duplicate_provider_id", reasons, "id");
  const providerById = new Map(providerWrappers.map((entry) => [entry.value.id, entry.value]));
  const deploymentsRaw = input.deployments; const deploymentWrappers: Wrapper<ModelDeployment>[] = [];
  if (!ordinary(deploymentsRaw) || deploymentsRaw.length === 0 || deploymentsRaw.length > modelProviderRegistryLimits.maxDeployments) reason(reasons, ordinary(deploymentsRaw) && deploymentsRaw.length > modelProviderRegistryLimits.maxDeployments ? "limit_exceeded" : "invalid_provider_registry", "deployments", "deployments must be a bounded non-empty ordinary array.");
  else for (const [index, raw] of deploymentsRaw.entries()) {
    const path = `deployments[${index}]`; if (!plain(raw) || !exact(raw, deploymentFields)) { reason(reasons, "invalid_provider_registry", path, "Deployment has missing or unknown fields."); continue; }
    const deploymentId = id(raw.id); const providerId = id(raw.providerId); const status = raw.status; const providerModelId = audit(raw.providerModelId); const providerModelVersion = audit(raw.providerModelVersion);
    const capabilities = enumArray(raw.capabilities, modelProviderCapabilities, modelProviderRegistryLimits.maxCapabilities, `${path}.capabilities`, reasons, true); const outputs = enumArray(raw.supportedOutputTypes, agentOutputTypes, modelProviderRegistryLimits.maxOutputTypes, `${path}.supportedOutputTypes`, reasons);
    const maxInputTokens = integer(raw.maxInputTokens, 1, modelProviderRegistryLimits.maxTokenCeiling); const maxOutputTokens = integer(raw.maxOutputTokens, 1, modelProviderRegistryLimits.maxTokenCeiling); const inputCost = integer(raw.inputCostUsdMicrosPerMillionTokens, 0, modelProviderRegistryLimits.maxPriceUsdMicrosPerMillionTokens); const outputCost = integer(raw.outputCostUsdMicrosPerMillionTokens, 0, modelProviderRegistryLimits.maxPriceUsdMicrosPerMillionTokens);
    if (!deploymentId) reason(reasons, "invalid_provider_registry", `${path}.id`, "Deployment ID is invalid."); if (!providerId) reason(reasons, "invalid_provider_registry", `${path}.providerId`, "providerId is invalid."); else if (!providerById.has(providerId)) reason(reasons, "provider_not_found", `${path}.providerId`, "Provider does not exist.", { providerId, deploymentId: deploymentId ?? null }); if (!includes(modelProviderStatuses, status)) reason(reasons, "invalid_provider_registry", `${path}.status`, "Deployment status is invalid."); if (!providerModelId || !providerModelVersion) reason(reasons, "invalid_provider_registry", path, "Provider model audit identifiers are invalid.");
    if (maxInputTokens === null || maxOutputTokens === null || inputCost === null || outputCost === null) reason(reasons, "invalid_provider_registry", path, "Token and cost values must be bounded safe integers."); if (!includes(modelLatencyClasses, raw.latencyClass)) reason(reasons, "invalid_provider_registry", `${path}.latencyClass`, "latencyClass is invalid."); if (!includes(modelQualityTiers, raw.qualityTier)) reason(reasons, "invalid_provider_registry", `${path}.qualityTier`, "qualityTier is invalid.");
    const provider = providerId ? providerById.get(providerId) : undefined; if (provider && capabilities && !capabilities.every((capability) => provider.capabilities.includes(capability))) reason(reasons, "capability_not_supported", `${path}.capabilities`, "Deployment capabilities exceed provider capabilities.", { providerId, deploymentId: deploymentId ?? null });
    if (deploymentId && providerId && includes(modelProviderStatuses, status) && providerModelId && providerModelVersion && capabilities && outputs && maxInputTokens !== null && maxOutputTokens !== null && inputCost !== null && outputCost !== null && includes(modelLatencyClasses, raw.latencyClass) && includes(modelQualityTiers, raw.qualityTier)) deploymentWrappers.push({ path, value: { id: deploymentId, providerId, status, providerModelId, providerModelVersion, capabilities, supportedOutputTypes: outputs, maxInputTokens, maxOutputTokens, inputCostUsdMicrosPerMillionTokens: inputCost, outputCostUsdMicrosPerMillionTokens: outputCost, latencyClass: raw.latencyClass, qualityTier: raw.qualityTier } });
  }
  duplicate(deploymentWrappers, (value) => value.id, "duplicate_deployment_id", reasons, "id"); const deploymentById = new Map(deploymentWrappers.map((entry) => [entry.value.id, entry.value]));
  const profilesRaw = input.modelProfiles; const profileWrappers: Wrapper<ModelProfileRoute>[] = [];
  if (!ordinary(profilesRaw) || profilesRaw.length === 0 || profilesRaw.length > modelProviderRegistryLimits.maxModelProfiles) reason(reasons, ordinary(profilesRaw) && profilesRaw.length > modelProviderRegistryLimits.maxModelProfiles ? "limit_exceeded" : "invalid_provider_registry", "modelProfiles", "modelProfiles must be a bounded non-empty ordinary array.");
  else for (const [index, raw] of profilesRaw.entries()) {
    const path = `modelProfiles[${index}]`; if (!plain(raw) || !exact(raw, profileFields)) { reason(reasons, "invalid_provider_registry", path, "Model profile has missing or unknown fields."); continue; }
    const modelProfileId = id(raw.modelProfileId); const status = raw.status; const capabilities = enumArray(raw.requiredCapabilities, modelProviderCapabilities, modelProviderRegistryLimits.maxCapabilities, `${path}.requiredCapabilities`, reasons, true); const outputs = enumArray(raw.supportedOutputTypes, agentOutputTypes, modelProviderRegistryLimits.maxOutputTypes, `${path}.supportedOutputTypes`, reasons); const candidates: ModelProfileCandidate[] = [];
    if (!modelProfileId) reason(reasons, "invalid_provider_registry", `${path}.modelProfileId`, "modelProfileId is invalid."); if (!includes(modelProviderStatuses, status)) reason(reasons, "invalid_provider_registry", `${path}.status`, "Profile status is invalid.");
    if (!ordinary(raw.candidates) || raw.candidates.length === 0 || raw.candidates.length > modelProviderRegistryLimits.maxCandidatesPerProfile) reason(reasons, ordinary(raw.candidates) && raw.candidates.length > modelProviderRegistryLimits.maxCandidatesPerProfile ? "limit_exceeded" : "invalid_provider_registry", `${path}.candidates`, "Candidates must be a bounded non-empty ordinary array.");
    else for (const [candidateIndex, candidateRaw] of raw.candidates.entries()) { const candidatePath = `${path}.candidates[${candidateIndex}]`; if (!plain(candidateRaw) || !exact(candidateRaw, candidateFields)) { reason(reasons, "invalid_provider_registry", candidatePath, "Candidate has missing or unknown fields."); continue; } const deploymentId = id(candidateRaw.deploymentId); const priority = integer(candidateRaw.priority, 1); if (!deploymentId) reason(reasons, "invalid_provider_registry", `${candidatePath}.deploymentId`, "deploymentId is invalid."); else if (!deploymentById.has(deploymentId)) reason(reasons, "deployment_not_found", `${candidatePath}.deploymentId`, "Deployment does not exist.", { modelProfileId: modelProfileId ?? null, deploymentId }); if (priority === null) reason(reasons, "invalid_provider_registry", `${candidatePath}.priority`, "priority must be a positive safe integer."); if (deploymentId && priority !== null) candidates.push({ deploymentId, priority }); }
    candidates.sort((a, b) => a.priority - b.priority || cmp(a.deploymentId, b.deploymentId)); const seenDeployments = new Set<string>(); const seenPriorities = new Set<number>(); for (const candidate of candidates) { if (seenDeployments.has(candidate.deploymentId)) reason(reasons, "invalid_provider_registry", `${path}.candidates`, "Candidate deployments must be unique."); if (seenPriorities.has(candidate.priority)) reason(reasons, "invalid_provider_registry", `${path}.candidates`, "Candidate priorities must be unique."); seenDeployments.add(candidate.deploymentId); seenPriorities.add(candidate.priority); const deployment = deploymentById.get(candidate.deploymentId); if (deployment && capabilities && !capabilities.every((capability) => deployment.capabilities.includes(capability))) reason(reasons, "capability_not_supported", `${path}.requiredCapabilities`, "Candidate does not satisfy profile capabilities.", { modelProfileId: modelProfileId ?? null, deploymentId: candidate.deploymentId }); if (deployment && outputs && !outputs.every((output) => deployment.supportedOutputTypes.includes(output))) reason(reasons, "output_type_not_supported", `${path}.supportedOutputTypes`, "Candidate does not satisfy profile output types.", { modelProfileId: modelProfileId ?? null, deploymentId: candidate.deploymentId }); }
    if (candidates[0]?.priority !== 1) reason(reasons, "invalid_provider_registry", `${path}.candidates`, "First canonical candidate priority must be 1.");
    if (modelProfileId && includes(modelProviderStatuses, status) && capabilities && outputs && candidates.length > 0) profileWrappers.push({ path, value: { modelProfileId, status, requiredCapabilities: capabilities, supportedOutputTypes: outputs, candidates } });
  }
  duplicate(profileWrappers, (value) => value.modelProfileId, "duplicate_model_profile_id", reasons, "modelProfileId");
  if (reasons.length || !workspaceId || version === null) return freeze({ verdict: "deny", reasons: clone(reasons), normalizedRegistry: null });
  const normalizedRegistry: ModelProviderRegistry = { workspaceId, version, providers: providerWrappers.map((entry) => entry.value).sort((a, b) => cmp(a.id, b.id)), deployments: deploymentWrappers.map((entry) => entry.value).sort((a, b) => cmp(a.id, b.id)), modelProfiles: profileWrappers.map((entry) => entry.value).sort((a, b) => cmp(a.modelProfileId, b.modelProfileId)) };
  return freeze({ verdict: "allow", reasons: [], normalizedRegistry });
}

export function validateAndNormalizeModelProviderRegistry(input: unknown): ModelProviderRegistryValidationDecision { const snapshot = boundedSnapshot(input); if (!snapshot.ok) { const reasons: MutableReasons = []; reason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Registry exceeds bounded inspection limits." : "Registry could not be safely inspected."); return freeze({ verdict: "deny", reasons, normalizedRegistry: null }); } try { return normalizeRegistryData(snapshot.value); } catch { const reasons: MutableReasons = []; reason(reasons, "invalid_input", "$", "Registry could not be safely evaluated."); return freeze({ verdict: "deny", reasons, normalizedRegistry: null }); } }

function requiredProfiles(decision: WorkspaceProjectContextsDecision): string[] { const values = new Set<string>(); for (const project of decision.normalizedRegistry?.projects ?? []) { for (const value of project.projectManifest.allowedModelProfileIds) values.add(value); for (const department of project.departments) for (const value of department.normalizedDepartment.effectiveModelProfileIds) values.add(value); for (const binding of project.bindings) for (const value of binding.effectiveModelProfileIds) values.add(value); } return [...values].sort(cmp); }
function completeness(projectDecision: WorkspaceProjectContextsDecision, registry: ModelProviderRegistry, reasons: MutableReasons): void { for (const modelProfileId of requiredProfiles(projectDecision)) if (!registry.modelProfiles.some((candidate) => candidate.modelProfileId === modelProfileId)) reason(reasons, "model_profile_missing", "modelProviderRegistry.modelProfiles", "A model profile used by the Workspace is missing.", { workspaceId: registry.workspaceId, modelProfileId }); }
function workspaceDeny(reasons: MutableReasons, projectRegistryDecision: WorkspaceProjectContextsDecision | null): WorkspaceModelProviderRegistryDecision { return freeze({ verdict: "deny", reasons: clone(reasons), projectRegistryDecision, normalizedRegistry: null }); }
function evaluateWorkspaceData(input: unknown): WorkspaceModelProviderRegistryDecision {
  const reasons: MutableReasons = []; if (!plain(input) || !exact(input, ["projectRegistry", "modelProviderRegistry"])) { reason(reasons, "invalid_input", "$", "Workspace registry input has missing or unknown fields."); return workspaceDeny(reasons, null); }
  const projectDecision = evaluateWorkspaceProjectContexts(input.projectRegistry); if (projectDecision.verdict !== "allow" || !projectDecision.normalizedRegistry) { reason(reasons, "invalid_project_registry", "projectRegistry", "Project Context Registry evaluation denied."); return workspaceDeny(reasons, projectDecision); }
  const providerDecision = normalizeRegistryData(input.modelProviderRegistry); if (providerDecision.verdict !== "allow" || !providerDecision.normalizedRegistry) { for (const item of providerDecision.reasons) reasons.push({ ...item, path: `modelProviderRegistry.${item.path}` }); return workspaceDeny(reasons, projectDecision); }
  const registry = providerDecision.normalizedRegistry; if (projectDecision.normalizedRegistry.workspaceId !== registry.workspaceId) reason(reasons, "workspace_mismatch", "modelProviderRegistry.workspaceId", "Provider and Project registries must share a workspaceId.", { workspaceId: registry.workspaceId }); completeness(projectDecision, registry, reasons); if (reasons.length) return workspaceDeny(reasons, projectDecision); return freeze({ verdict: "allow", reasons: [], projectRegistryDecision: projectDecision, normalizedRegistry: clone(registry) });
}
export function evaluateWorkspaceModelProviderRegistry(input: unknown): WorkspaceModelProviderRegistryDecision { const snapshot = boundedSnapshot(input); if (!snapshot.ok) { const reasons: MutableReasons = []; reason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Workspace input exceeds bounded inspection limits." : "Workspace input could not be safely inspected."); return workspaceDeny(reasons, null); } try { return evaluateWorkspaceData(snapshot.value); } catch { const reasons: MutableReasons = []; reason(reasons, "invalid_input", "$", "Workspace input could not be safely evaluated."); return workspaceDeny(reasons, null); } }

function routeDeny(reasons: MutableReasons, projectRegistryDecision: WorkspaceProjectContextsDecision | null, invocationAdmissionDecision: ModelInvocationAdmissionDecision | null, normalizedRegistry: ModelProviderRegistry | null = null): ModelInvocationRouteResolutionDecision { return freeze({ verdict: "deny", reasons: clone(reasons), projectRegistryDecision, invocationAdmissionDecision, normalizedRegistry: normalizedRegistry ? clone(normalizedRegistry) : null, routePlan: null }); }
function resolveData(input: unknown): ModelInvocationRouteResolutionDecision {
  const reasons: MutableReasons = []; if (!plain(input) || !exact(input, ["projectRegistry", "modelProviderRegistry", "invocationAdmission"])) { reason(reasons, "invalid_input", "$", "Route input has missing or unknown fields."); return routeDeny(reasons, null, null); }
  const projectDecision = evaluateWorkspaceProjectContexts(input.projectRegistry); if (projectDecision.verdict !== "allow" || !projectDecision.normalizedRegistry) { reason(reasons, "invalid_project_registry", "projectRegistry", "Project Context Registry evaluation denied."); return routeDeny(reasons, projectDecision, null); }
  const admissionDecision = evaluateModelInvocationAdmission(input.invocationAdmission); if ((admissionDecision.verdict !== "allow" && admissionDecision.verdict !== "idempotent") || !admissionDecision.normalizedRequest || !admissionDecision.snapshotDecision?.normalizedSnapshot) { reason(reasons, "invalid_invocation_admission", "invocationAdmission", "Model invocation admission denied."); return routeDeny(reasons, projectDecision, admissionDecision); }
  const providerDecision = normalizeRegistryData(input.modelProviderRegistry); if (providerDecision.verdict !== "allow" || !providerDecision.normalizedRegistry) { for (const item of providerDecision.reasons) reasons.push({ ...item, path: `modelProviderRegistry.${item.path}` }); return routeDeny(reasons, projectDecision, admissionDecision); }
  const registry = providerDecision.normalizedRegistry; const request = admissionDecision.normalizedRequest; const snapshot = admissionDecision.snapshotDecision.normalizedSnapshot;
  const context = { workspaceId: request.workspaceId, projectId: request.projectId, modelProfileId: request.modelProfileId, invocationId: request.invocationId };
  if (registry.workspaceId !== request.workspaceId || projectDecision.normalizedRegistry.workspaceId !== request.workspaceId) { reason(reasons, "workspace_mismatch", "modelProviderRegistry.workspaceId", "All factual workspace IDs must match.", context); return routeDeny(reasons, projectDecision, admissionDecision, registry); }
  const project = projectDecision.normalizedRegistry.projects.find((candidate) => candidate.projectId === request.projectId); if (!project) { reason(reasons, "invalid_project_registry", "projectRegistry.projects", "Exact factual Project is missing.", context); return routeDeny(reasons, projectDecision, admissionDecision, registry); }
  if (project.projectManifestVersion !== snapshot.executionProfile.projectManifestVersion) { reason(reasons, "project_version_mismatch", "invocationAdmission.snapshot.executionProfile.projectManifestVersion", "Project manifest version does not match the factual registry.", context); return routeDeny(reasons, projectDecision, admissionDecision, registry); }
  completeness(projectDecision, registry, reasons); if (reasons.length) return routeDeny(reasons, projectDecision, admissionDecision, registry);
  const profile = registry.modelProfiles.find((candidate) => candidate.modelProfileId === request.modelProfileId); if (!profile) { reason(reasons, "model_profile_missing", "modelProviderRegistry.modelProfiles", "Exact invocation model profile is missing.", context); return routeDeny(reasons, projectDecision, admissionDecision, registry); } if (profile.status !== "active") { reason(reasons, "model_profile_inactive", "modelProviderRegistry.modelProfiles.status", "Exact invocation model profile is inactive.", context); return routeDeny(reasons, projectDecision, admissionDecision, registry); }
  const dataRegion = project.projectManifest.dataRegion; const dataEgressMode = snapshot.executionProfile.dataEgressMode; const eligible: ModelInvocationRouteCandidate[] = []; const unavailable: MutableReasons = [];
  const effectiveInvocationCapabilities: readonly ModelProviderCapability[] = ["messages", ...profile.requiredCapabilities.filter((capability) => capability !== "messages")];
  for (const candidate of profile.candidates) { const deployment = registry.deployments.find((value) => value.id === candidate.deploymentId); if (!deployment) { reason(unavailable, "deployment_not_found", "modelProviderRegistry.modelProfiles.candidates.deploymentId", "Candidate deployment is missing.", { ...context, deploymentId: candidate.deploymentId }); continue; } const provider = registry.providers.find((value) => value.id === deployment.providerId); const candidateContext = { ...context, providerId: provider?.id ?? deployment.providerId, deploymentId: deployment.id };
    if (!provider) { reason(unavailable, "provider_not_found", "modelProviderRegistry.deployments.providerId", "Candidate provider is missing.", candidateContext); continue; } if (provider.status !== "active") { reason(unavailable, "provider_inactive", "modelProviderRegistry.providers.status", "Candidate provider is inactive.", candidateContext); continue; } if (deployment.status !== "active") { reason(unavailable, "deployment_inactive", "modelProviderRegistry.deployments.status", "Candidate deployment is inactive.", candidateContext); continue; } if (!provider.supportedDataRegions.includes(dataRegion)) { reason(unavailable, "region_not_supported", "modelProviderRegistry.providers.supportedDataRegions", "Candidate does not support the factual Project data region.", candidateContext); continue; } if (!provider.supportedDataEgressModes.includes(dataEgressMode) || (dataEgressMode === "forbidden" && provider.deploymentMode !== "local")) { reason(unavailable, "data_egress_not_supported", "modelProviderRegistry.providers.supportedDataEgressModes", "Candidate does not support the factual data-egress policy.", candidateContext); continue; } if (!effectiveInvocationCapabilities.every((capability) => provider.capabilities.includes(capability) && deployment.capabilities.includes(capability))) { reason(unavailable, "capability_not_supported", "modelProviderRegistry.modelProfiles.requiredCapabilities", "Candidate lacks an effective invocation capability.", candidateContext); continue; } if (request.toolIds.length > 0 && (!provider.capabilities.includes("tool_calls") || !deployment.capabilities.includes("tool_calls"))) { reason(unavailable, "tools_not_supported", "invocationAdmission.draft", "Candidate cannot support requested tools.", candidateContext); continue; } if (!profile.supportedOutputTypes.includes(request.outputType) || !deployment.supportedOutputTypes.includes(request.outputType)) { reason(unavailable, "output_type_not_supported", "invocationAdmission.draft", "Candidate cannot support the requested output type.", candidateContext); continue; }
    const requirement: ModelDataHandlingRequirement = provider.deploymentMode === "local" ? "local_only" : dataEgressMode === "redacted_only" ? "redaction_required" : "approval_required";
    eligible.push({ priority: candidate.priority, providerId: provider.id, providerKind: provider.kind, deploymentId: deployment.id, providerModelId: deployment.providerModelId, providerModelVersion: deployment.providerModelVersion, deploymentMode: provider.deploymentMode, dataHandlingRequirement: requirement, capabilities: [...deployment.capabilities], supportedOutputTypes: [...deployment.supportedOutputTypes], maxInputTokens: deployment.maxInputTokens, maxOutputTokens: deployment.maxOutputTokens, inputCostUsdMicrosPerMillionTokens: deployment.inputCostUsdMicrosPerMillionTokens, outputCostUsdMicrosPerMillionTokens: deployment.outputCostUsdMicrosPerMillionTokens, latencyClass: deployment.latencyClass, qualityTier: deployment.qualityTier }); }
  eligible.sort((a, b) => a.priority - b.priority || cmp(a.deploymentId, b.deploymentId)); if (!eligible.length) { reasons.push(...unavailable.slice(0, modelProviderRegistryLimits.maxReasons - 1)); reason(reasons, "no_eligible_route", "modelProviderRegistry.modelProfiles.candidates", "No eligible route exists for the factual invocation.", context); return routeDeny(reasons, projectDecision, admissionDecision, registry); }
  const primary = eligible[0]; if (!primary) return routeDeny(reasons, projectDecision, admissionDecision, registry); const routePlan: ModelInvocationRoutePlan = { workspaceId: request.workspaceId, projectId: request.projectId, runId: request.runId, invocationId: request.invocationId, modelProfileId: request.modelProfileId, projectDataRegion: dataRegion, dataEgressMode, primary, fallbacks: eligible.slice(1) };
  return freeze({ verdict: "allow", reasons: [], projectRegistryDecision: projectDecision, invocationAdmissionDecision: admissionDecision, normalizedRegistry: clone(registry), routePlan });
}
export function resolveModelInvocationRoute(input: unknown): ModelInvocationRouteResolutionDecision { const snapshot = boundedSnapshot(input); if (!snapshot.ok) { const reasons: MutableReasons = []; reason(reasons, snapshot.limited ? "limit_exceeded" : "invalid_input", "$", snapshot.limited ? "Route input exceeds bounded inspection limits." : "Route input could not be safely inspected."); return routeDeny(reasons, null, null); } try { return resolveData(snapshot.value); } catch { const reasons: MutableReasons = []; reason(reasons, "invalid_input", "$", "Route input could not be safely evaluated."); return routeDeny(reasons, null, null); } }
