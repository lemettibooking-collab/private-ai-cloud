import type { ExecutorCapability, ExecutorExecutionMode, ExecutorIdentity, ExecutorRepositoryRef, ExecutorAttemptIdentity } from "../contracts/executor-adapter";
import type { ExecutionEnvironment, ManagedEnvironmentRequirements } from "../execution-environment/execution-environment";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { snapshot, record, safeAtom, enumeration, list, stringSet, integer, fingerprint, normalizeEnvironment, normalizeEnvironmentRequirements, invalid, routingDataLimits, freezeDeep, compare, routingDigest } from "../execution-environment/execution-environment.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateManagedExecutionEnvironment } from "../execution-environment/managed-execution-environment-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateDevelopmentTaskAdmission } from "../contracts/development-task-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateAndNormalizeFeaturePlan } from "../contracts/development-plan.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { resolveCurrentExecutorAttempt } from "../contracts/executor-adapter.ts";

export const executorRoutingPolicyVersion = "pac-executor-routing.v1";
export const executorAccessModes = Object.freeze(["subscription_session", "api_key", "provider_credits", "self_hosted"] as const);
export type ExecutorAccessMode = typeof executorAccessModes[number];
export const executorTaskClasses = Object.freeze(["implementation", "analysis", "repair", "refactor", "verification"] as const);
export type ExecutorTaskClass = typeof executorTaskClasses[number];
const risks = ["low", "medium", "high", "critical"] as const;
const repositoryFeatures = ["exact_baseline", "bounded_context", "allowed_paths", "patch_artifacts", "repository_analysis"] as const;
type Estimate = Readonly<{ value: number; fingerprint: string }>;
export type ExecutorRouteCandidate = Readonly<{
  routeId: string; executor: ExecutorIdentity; providerId: "openai" | "anthropic";
  capabilities: readonly ExecutorCapability[]; modes: readonly ExecutorExecutionMode[]; artifacts: readonly ("patch" | "report")[];
  taskClasses: readonly ExecutorTaskClass[];
  maxRisk: typeof risks[number]; repositoryFeatures: readonly typeof repositoryFeatures[number][];
  environment: ExecutionEnvironment; accessModes: readonly ExecutorAccessMode[];
  availability: Readonly<{ state: "available" | "unavailable" | "unknown"; fingerprint: string | null }>;
  quota: Readonly<{ state: "available" | "exhausted" | "unknown"; fingerprint: string | null }>;
  estimatedCostUsdMicros: Estimate | null; estimatedLatencyMs: Estimate | null;
  quality: Readonly<{ scoreBasisPoints: number; sampleCount: number; fingerprint: string }> | null;
}>;
export type NormalizedRoutingRequirements = Readonly<{
  planId: string; taskId: string; attempt: ExecutorAttemptIdentity; repository: ExecutorRepositoryRef; admittedPaths: readonly string[];
  capability: ExecutorCapability; mode: ExecutorExecutionMode; taskClass: ExecutorTaskClass;
  risk: typeof risks[number]; environment: ManagedEnvironmentRequirements; accessModes: readonly ExecutorAccessMode[];
  requireQuota: boolean; maxCostUsdMicros: number | null; maxLatencyMs: number | null; minQualityBasisPoints: number | null;
  requiredExecutorId: string | null; preferredExecutorIds: readonly string[];
}>;
export type RouteReason = "invalid_registry" | "invalid_requirements" | "task_admission_denied" | "invalid_attempt_state" | "no_eligible_candidate"
  | "capability_mismatch" | "task_class_mismatch" | "mode_mismatch" | "risk_unsupported" | "environment_ineligible" | "access_mode_unavailable"
  | "unavailable" | "quota_unavailable" | "repository_capability_mismatch" | "residency_mismatch" | "privacy_requirement_unmet"
  | "cost_unknown" | "cost_limit_exceeded" | "latency_unknown" | "latency_limit_exceeded" | "quality_unknown" | "quality_below_floor"
  | "owner_required_executor_ineligible";
export type ExecutorRouteDecision = Readonly<{
  verdict: "allow" | "deny"; reasons: readonly RouteReason[];
  selectedRoute: Readonly<{ routeId: string; executor: ExecutorIdentity; providerId: "openai" | "anthropic";
    environment: Readonly<{ id: string; kind: ExecutionEnvironment["kind"] }>; accessMode: ExecutorAccessMode }> | null;
  ranking: readonly Readonly<{ routeId: string; preference: number | null; quality: ExecutorRouteCandidate["quality"];
    estimatedCostUsdMicros: Estimate | null; estimatedLatencyMs: Estimate | null }>[];
  rejected: readonly Readonly<{ routeId: string; reasons: readonly RouteReason[] }>[];
  routeFingerprint: string | null; requirementsFingerprint: string | null; candidateSetFingerprint: string | null;
  dispatchAuthorized: false; runtimeDispatchAllowed: false;
}>;
export type ExecutorRouter = Readonly<{ select(input: unknown): ExecutorRouteDecision }>;
function deny(code: RouteReason, rejected: ExecutorRouteDecision["rejected"] = []): ExecutorRouteDecision {
  return freezeDeep({ verdict: "deny", reasons: [code], selectedRoute: null, ranking: [], rejected,
    routeFingerprint: null, requirementsFingerprint: null, candidateSetFingerprint: null, dispatchAuthorized: false, runtimeDispatchAllowed: false });
}
function estimate(v: unknown, max: number): Estimate | null {
  if (v === null) return null; const r = record(v, ["value", "fingerprint"]); return { value: integer(r.value, max), fingerprint: fingerprint(r.fingerprint) };
}
function factualState<const T extends string>(v: unknown, states: readonly T[]): Readonly<{ state: T; fingerprint: string | null }> {
  const r = record(v, ["state", "fingerprint"]), state = enumeration(r.state, states), f = r.fingerprint === null ? null : fingerprint(r.fingerprint);
  if (state === "available" && f === null) invalid(); return { state, fingerprint: f };
}
function candidate(v: unknown): ExecutorRouteCandidate {
  const r = record(v, ["routeId", "executor", "providerId", "capabilities", "modes", "artifacts", "taskClasses", "maxRisk", "repositoryFeatures", "environment", "accessModes", "availability", "quota", "estimatedCostUsdMicros", "estimatedLatencyMs", "quality"]);
  const e = record(r.executor, ["id", "version"]), providerId = enumeration(r.providerId, ["openai", "anthropic"]);
  const executor = { id: safeAtom(e.id), version: safeAtom(e.version, 32) };
  if (executor.version !== "v1" || executor.id !== (providerId === "openai" ? "openai-agents" : "claude-managed-agents")) invalid();
  const environment = normalizeEnvironment(r.environment);
  if (providerId !== "openai" && ["openai_hosted", "codex_cloud_if_supported"].includes(environment.kind)) invalid();
  let quality: ExecutorRouteCandidate["quality"] = null;
  if (r.quality !== null) { const q = record(r.quality, ["scoreBasisPoints", "sampleCount", "fingerprint"]);
    quality = { scoreBasisPoints: integer(q.scoreBasisPoints, 10000), sampleCount: integer(q.sampleCount, 1000000, 1), fingerprint: fingerprint(q.fingerprint) }; }
  const result: ExecutorRouteCandidate = { routeId: safeAtom(r.routeId), executor, providerId,
    taskClasses: stringSet(r.taskClasses, executorTaskClasses),
    capabilities: stringSet(r.capabilities, ["coding", "repository_analysis"]), modes: stringSet(r.modes, ["patch_proposal", "analysis_only"]),
    artifacts: stringSet(r.artifacts, ["patch", "report"]), maxRisk: enumeration(r.maxRisk, risks), repositoryFeatures: stringSet(r.repositoryFeatures, repositoryFeatures), environment,
    accessModes: stringSet(r.accessModes, executorAccessModes), availability: factualState(r.availability, ["available", "unavailable", "unknown"]),
    quota: factualState(r.quota, ["available", "exhausted", "unknown"]), estimatedCostUsdMicros: estimate(r.estimatedCostUsdMicros, routingDataLimits.maxCostUsdMicros),
    estimatedLatencyMs: estimate(r.estimatedLatencyMs, routingDataLimits.maxLatencyMs), quality };
  if (!result.capabilities.length || !result.taskClasses.length || !result.modes.length || !result.artifacts.length || !result.accessModes.length) invalid(); return result;
}
function requirements(v: unknown): NormalizedRoutingRequirements | RouteReason {
  const r = record(v, ["admission", "developmentRun", "repository", "capability", "mode", "taskClass", "policy"]);
  const a = record(r.admission, ["plan", "taskId", "completedTaskIds", "activeTaskIds", "repositoryAllowlist", "taskOwnerApprovalGranted"]);
  const admission = evaluateDevelopmentTaskAdmission(a);
  if (admission.verdict !== "allow") return "task_admission_denied";
  const plan = validateAndNormalizeFeaturePlan(a.plan); if (!plan.ok) return "task_admission_denied";
  const task = plan.value.tasks.find(t => t.id === admission.taskId); if (!task) return "task_admission_denied";
  const current = resolveCurrentExecutorAttempt(r.developmentRun); if (current.verdict !== "allow" || !current.attempt) return "invalid_attempt_state";
  const run = r.developmentRun as { planId: string; taskId: string; admittedAllowedPaths: string[] };
  if (run.planId !== plan.value.id || run.taskId !== task.id || routingDigest("paths", [...run.admittedAllowedPaths].sort(compare)) !== routingDigest("paths", [...admission.normalizedAllowedPaths].sort(compare))) return "invalid_attempt_state";
  const repo = record(r.repository, ["id", "baseline"]);
  if (typeof repo.baseline !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(repo.baseline)) invalid();
  const capability = enumeration(r.capability, ["coding", "repository_analysis"]), mode = enumeration(r.mode, ["patch_proposal", "analysis_only"]);
  if ((capability === "coding") !== (mode === "patch_proposal")) invalid();
  const p = record(r.policy, ["environment", "accessModes", "requireQuota", "maxCostUsdMicros", "maxLatencyMs", "minQualityBasisPoints", "requiredExecutorId", "preferredExecutorIds"]);
  const environment = normalizeEnvironmentRequirements(p.environment);
  // Core managed safety requirements cannot be removed by caller policy. Additional
  // privacy/residency requirements are additive, never inferred from provider branding.
  const core = ["filesystem_isolation", "path_scope_enforcement", "network_policy", "secrets_isolation", "timeout", "resource_bound", "changed_file_limit", "artifact_collection", "verification_collection"] as const;
  const effectiveEnvironment = { ...environment, capabilities: [...new Set([...environment.capabilities, ...core])].sort(compare) };
  const preferences = list(p.preferredExecutorIds, x => safeAtom(x)); if (new Set(preferences).size !== preferences.length || typeof p.requireQuota !== "boolean") invalid();
  const accessModes = stringSet(p.accessModes, executorAccessModes); if (!accessModes.length) invalid();
  return { planId: safeAtom(plan.value.id), taskId: safeAtom(task.id), attempt: current.attempt, repository: { id: safeAtom(repo.id), baseline: repo.baseline },
    admittedPaths: [...admission.normalizedAllowedPaths].sort(compare), capability, mode, risk: task.riskLevel,
    taskClass: enumeration(r.taskClass, executorTaskClasses), environment: effectiveEnvironment, accessModes,
    requireQuota: p.requireQuota, maxCostUsdMicros: p.maxCostUsdMicros === null ? null : integer(p.maxCostUsdMicros, routingDataLimits.maxCostUsdMicros),
    maxLatencyMs: p.maxLatencyMs === null ? null : integer(p.maxLatencyMs, routingDataLimits.maxLatencyMs),
    minQualityBasisPoints: p.minQualityBasisPoints === null ? null : integer(p.minQualityBasisPoints, 10000),
    requiredExecutorId: p.requiredExecutorId === null ? null : safeAtom(p.requiredExecutorId), preferredExecutorIds: preferences };
}
function access(c: ExecutorRouteCandidate, r: NormalizedRoutingRequirements): ExecutorAccessMode | null {
  return r.accessModes.find(m => m !== "self_hosted" && c.accessModes.includes(m)) ?? null;
}
function rejection(c: ExecutorRouteCandidate, r: NormalizedRoutingRequirements): RouteReason[] {
  const reasons: RouteReason[] = [];
  if (!c.capabilities.includes(r.capability)) reasons.push("capability_mismatch");
  if (!c.taskClasses.includes(r.taskClass)) reasons.push("task_class_mismatch");
  if (!c.modes.includes(r.mode) || !c.artifacts.includes("report") || (r.mode === "patch_proposal" && !c.artifacts.includes("patch"))) reasons.push("mode_mismatch");
  if (risks.indexOf(c.maxRisk) < risks.indexOf(r.risk)) reasons.push("risk_unsupported");
  const env = evaluateManagedExecutionEnvironment({ environment: c.environment, requirements: r.environment });
  if (env.verdict !== "allow") reasons.push("environment_ineligible");
  if (env.reasons.includes("residency_mismatch")) reasons.push("residency_mismatch");
  if (env.reasons.includes("privacy_requirement_unmet")) reasons.push("privacy_requirement_unmet");
  if (access(c, r) === null) reasons.push("access_mode_unavailable");
  if (c.availability.state !== "available") reasons.push("unavailable");
  if (r.requireQuota && c.quota.state !== "available") reasons.push("quota_unavailable");
  const needed = ["exact_baseline", "bounded_context", "allowed_paths", r.mode === "patch_proposal" ? "patch_artifacts" : "repository_analysis"] as const;
  if (needed.some(k => !c.repositoryFeatures.includes(k))) reasons.push("repository_capability_mismatch");
  if (r.maxCostUsdMicros !== null) {
    if (c.estimatedCostUsdMicros === null) reasons.push("cost_unknown");
    else if (c.estimatedCostUsdMicros.value > r.maxCostUsdMicros) reasons.push("cost_limit_exceeded");
  }
  if (r.maxLatencyMs !== null) {
    if (c.estimatedLatencyMs === null) reasons.push("latency_unknown");
    else if (c.estimatedLatencyMs.value > r.maxLatencyMs) reasons.push("latency_limit_exceeded");
  }
  if (r.minQualityBasisPoints !== null) {
    if (c.quality === null) reasons.push("quality_unknown");
    else if (c.quality.scoreBasisPoints < r.minQualityBasisPoints) reasons.push("quality_below_floor");
  }
  if (r.requiredExecutorId !== null && c.executor.id !== r.requiredExecutorId) reasons.push("owner_required_executor_ineligible");
  return reasons;
}
function preference(c: ExecutorRouteCandidate, r: NormalizedRoutingRequirements): number {
  const n = r.preferredExecutorIds.indexOf(c.executor.id); return n < 0 ? Number.MAX_SAFE_INTEGER : n;
}
function ascendingUnknownLast(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1; if (b === null) return -1; return a - b;
}
function rank(a: ExecutorRouteCandidate, b: ExecutorRouteCandidate, r: NormalizedRoutingRequirements): number {
  return preference(a, r) - preference(b, r)
    || ascendingUnknownLast(a.quality === null ? null : -a.quality.scoreBasisPoints, b.quality === null ? null : -b.quality.scoreBasisPoints)
    || ascendingUnknownLast(a.estimatedCostUsdMicros?.value ?? null, b.estimatedCostUsdMicros?.value ?? null)
    || ascendingUnknownLast(a.estimatedLatencyMs?.value ?? null, b.estimatedLatencyMs?.value ?? null)
    || compare(a.routeId, b.routeId);
}
/** TRUSTED SERVER CONFIGURATION ONLY, not a registration endpoint/plugin. Factory
 * snapshots and validates the complete bounded registry before exposing selection.
 * It issues no receipt, start ticket, authority handle, reservation or capability. */
export function createExecutorRouter(input: unknown): Readonly<{ verdict: "allow" | "deny"; reasons: readonly RouteReason[]; router: ExecutorRouter | null }> {
  try {
    const candidates = list(snapshot(input), candidate, routingDataLimits.maxCandidates).sort((a, b) => compare(a.routeId, b.routeId));
    const ids = new Set<string>(), identical = new Set<string>(), executorFacts = new Map<string, string>(), environments = new Map<string, string>();
    for (const c of candidates) {
      const { routeId, ...facts } = c, key = `${c.executor.id}/${c.executor.version}`;
      const duplicate = routingDigest("candidate", facts), staticFacts = routingDigest("executor", { providerId: c.providerId, capabilities: c.capabilities, taskClasses: c.taskClasses, modes: c.modes, artifacts: c.artifacts, maxRisk: c.maxRisk, repositoryFeatures: c.repositoryFeatures });
      const env = routingDigest("environment", c.environment);
      if (ids.has(routeId) || identical.has(duplicate) || (executorFacts.has(key) && executorFacts.get(key) !== staticFacts)
        || (environments.has(c.environment.id) && environments.get(c.environment.id) !== env)) invalid();
      ids.add(routeId); identical.add(duplicate); executorFacts.set(key, staticFacts); environments.set(c.environment.id, env);
    }
    freezeDeep(candidates);
    const candidateSetFingerprint = routingDigest("pac-executor-candidates.v1", candidates);
    const select = (value: unknown): ExecutorRouteDecision => {
      try {
        const r = freezeDeep(requirements(snapshot(value))); if (typeof r === "string") return deny(r);
        if (r.preferredExecutorIds.some(id => !candidates.some(c => c.executor.id === id))) return deny("invalid_requirements");
        const eligible: ExecutorRouteCandidate[] = [], rejected: Array<{ routeId: string; reasons: RouteReason[] }> = [];
        for (const c of candidates) { const reasons = rejection(c, r); if (reasons.length) rejected.push({ routeId: c.routeId, reasons }); else eligible.push(c); }
        if (!eligible.length) return deny(r.requiredExecutorId === null ? "no_eligible_candidate" : "owner_required_executor_ineligible", rejected);
        eligible.sort((a, b) => rank(a, b, r)); const selected = eligible[0];
        const selectedRoute = { routeId: selected.routeId, executor: { ...selected.executor }, providerId: selected.providerId,
          environment: { id: selected.environment.id, kind: selected.environment.kind }, accessMode: access(selected, r)! };
        const requirementsFingerprint = routingDigest("pac-executor-requirements.v1", r);
        const routeFingerprint = routingDigest("pac-executor-route.v1", { policyVersion: executorRoutingPolicyVersion, requirements: r, candidates, selectedRoute });
        // Return only bounded normalized evidence. Fresh deep copies even across calls.
        return freezeDeep(snapshot({ verdict: "allow", reasons: [], selectedRoute,
          ranking: eligible.map(c => ({ routeId: c.routeId, preference: preference(c, r) === Number.MAX_SAFE_INTEGER ? null : preference(c, r), quality: c.quality,
            estimatedCostUsdMicros: c.estimatedCostUsdMicros, estimatedLatencyMs: c.estimatedLatencyMs })),
          rejected, routeFingerprint, requirementsFingerprint, candidateSetFingerprint, dispatchAuthorized: false, runtimeDispatchAllowed: false }) as ExecutorRouteDecision);
      } catch { return deny("invalid_requirements"); }
    };
    return Object.freeze({ verdict: "allow", reasons: Object.freeze([]), router: Object.freeze({ select }) });
  } catch { return freezeDeep({ verdict: "deny", reasons: ["invalid_registry"], router: null }); }
}
