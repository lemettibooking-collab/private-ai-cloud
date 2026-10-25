import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { candidate, requirement, select, assertDenied, routerModule, deeplyFrozen } from "./fixtures/executor-routing.mts";

for (const provider of ["openai", "anthropic"] as const) test(`B2 Router one eligible ${provider} selects factual identity without authority`, () => {
  const d = select([candidate(provider)]); assert.equal(d.verdict, "allow"); assert.equal(d.selectedRoute?.providerId, provider);
  assert.equal(d.selectedRoute?.executor.id, provider === "openai" ? "openai-agents" : "claude-managed-agents");
  assert.equal(d.dispatchAuthorized, false); assert.equal(d.runtimeDispatchAllowed, false); deeplyFrozen(d);
  assert.deepEqual(Object.keys(routerModule.createExecutorRouter([candidate()]).router!), ["select"]);
});
test("B2 equivalent OpenAI/Claude candidates use lexical route ID, independent of caller order", () => {
  const a = candidate(), b = candidate("anthropic"), r = requirement(), before = structuredClone([a, b, r]);
  const d = select([b, a], r); assert.equal(d.selectedRoute?.routeId, "route-a"); assert.deepEqual(d, select([a, b], r));
  assert.deepEqual([a, b, r], before);
});
test("B2 Owner soft preference ranks only hard-eligible candidates", () => {
  const a = candidate(), b = candidate("anthropic"), r = requirement(); r.policy.preferredExecutorIds = [b.executor.id];
  assert.equal(select([a, b], r).selectedRoute?.providerId, "anthropic"); b.availability.state = "unavailable";
  assert.equal(select([a, b], r).selectedRoute?.providerId, "openai");
});
test("B2 Owner hard pin selects eligible executor; absent/ineligible never falls back", () => {
  const a = candidate(), b = candidate("anthropic"), r = requirement(); r.policy.requiredExecutorId = b.executor.id;
  assert.equal(select([a, b], r).selectedRoute?.providerId, "anthropic"); b.availability.state = "unavailable";
  assertDenied([a, b], r, "owner_required_executor_ineligible"); assertDenied([a], r, "owner_required_executor_ineligible");
});
const filters: Array<[string, (c: ReturnType<typeof candidate>, r: ReturnType<typeof requirement>) => void, string]> = [
  ["capability", c => { c.capabilities = ["repository_analysis"]; }, "capability_mismatch"],
  ["task class", c => { Object.assign(c, { taskClasses: ["analysis"] }); }, "task_class_mismatch"],
  ["mode", c => { c.modes = ["analysis_only"]; }, "mode_mismatch"],
  ["artifact", c => { c.artifacts = ["report"]; }, "mode_mismatch"],
  ["risk", (c, r) => { c.maxRisk = "low"; r.admission.plan.tasks[0].riskLevel = "critical"; }, "risk_unsupported"],
  ["unavailable", c => { c.availability.state = "unavailable"; }, "unavailable"],
  ["unknown availability", c => { c.availability = { state: "unknown", fingerprint: null }; }, "unavailable"],
  ["exhausted quota", c => { c.quota.state = "exhausted"; }, "quota_unavailable"],
  ["unknown quota", c => { c.quota = { state: "unknown", fingerprint: null }; }, "quota_unavailable"],
  ["repository baseline", c => { c.repositoryFeatures = c.repositoryFeatures.filter(x => x !== "exact_baseline"); }, "repository_capability_mismatch"],
  ["repository scope", c => { c.repositoryFeatures = c.repositoryFeatures.filter(x => x !== "allowed_paths"); }, "repository_capability_mismatch"],
  ["bounded context", c => { c.repositoryFeatures = c.repositoryFeatures.filter(x => x !== "bounded_context"); }, "repository_capability_mismatch"],
  ["cost unknown", (c, r) => { c.estimatedCostUsdMicros = null; r.policy.maxCostUsdMicros = 1000; }, "cost_unknown"],
  ["cost exceeded", (_c, r) => { r.policy.maxCostUsdMicros = 999; }, "cost_limit_exceeded"],
  ["latency unknown", (c, r) => { c.estimatedLatencyMs = null; r.policy.maxLatencyMs = 100; }, "latency_unknown"],
  ["latency exceeded", (_c, r) => { r.policy.maxLatencyMs = 99; }, "latency_limit_exceeded"],
  ["quality unknown", (c, r) => { c.quality = null; r.policy.minQualityBasisPoints = 1; }, "quality_unknown"],
  ["quality below floor", (_c, r) => { r.policy.minQualityBasisPoints = 8001; }, "quality_below_floor"],
  ["residency wrong", (_c, r) => { r.policy.environment.residency = "us-test"; }, "residency_mismatch"],
  ["residency unknown", (c, r) => { c.environment.residency.evidence = { state: "unknown", fingerprint: null }; r.policy.environment.residency = "eu-test"; }, "residency_mismatch"],
  ["privacy unknown", (c, r) => { c.environment.privacy.zdr = { state: "unknown", fingerprint: null }; r.policy.environment.privacy = ["zdr"]; }, "privacy_requirement_unmet"],
  ["privacy unsupported", (c, r) => { c.environment.privacy.no_training.state = "unsupported"; r.policy.environment.privacy = ["no_training"]; }, "privacy_requirement_unmet"],
  ["access mode", (_c, r) => { r.policy.accessModes = ["subscription_session"]; }, "access_mode_unavailable"],
  ["self hosted", (c, r) => { c.accessModes = ["self_hosted"]; r.policy.accessModes = ["self_hosted"]; }, "access_mode_unavailable"],
  ["local", (c, r) => { c.environment.kind = "local"; r.policy.environment.kinds = ["local"]; }, "environment_ineligible"],
  ["vps", (c, r) => { c.environment.kind = "vps_self_hosted"; r.policy.environment.kinds = ["vps_self_hosted"]; }, "environment_ineligible"],
  ["future", (c, r) => { c.environment.kind = "future_provider"; r.policy.environment.kinds = ["future_provider"]; }, "environment_ineligible"],
  ["required capability unknown", c => { c.environment.capabilities.path_scope_enforcement = { state: "unknown", fingerprint: null }; }, "environment_ineligible"],
];
for (const [name, change, reason] of filters) test(`B2 hard filter ${name}; provider swap/soft preference cannot bypass it`, () => {
  for (const provider of ["openai", "anthropic"] as const) {
    const c = candidate(provider), r = requirement(); change(c, r); r.policy.preferredExecutorIds = [c.executor.id]; assertDenied([c], r, reason);
  }
});
test("B2 exact cost/latency/quality ceilings pass; synthetic privacy/residency evidence passes", () => {
  const r = requirement(); Object.assign(r.policy, { maxCostUsdMicros: 1000, maxLatencyMs: 100, minQualityBasisPoints: 8000 });
  r.policy.environment.residency = "eu-test"; r.policy.environment.privacy = ["private_network", "zdr", "no_training", "restricted_data"];
  assert.equal(select([candidate()], r).verdict, "allow");
});
test("B2 optional unknown estimates rank last, never as zero cost/perfect quality", () => {
  const a = candidate(), b = candidate("anthropic"); a.quality = null; a.estimatedCostUsdMicros = null; a.estimatedLatencyMs = null;
  const d = select([a, b]); assert.equal(d.selectedRoute?.providerId, "anthropic"); assert.equal(d.ranking[1].quality, null);
  b.quality = null; assert.equal(select([a, b]).selectedRoute?.providerId, "anthropic"); b.estimatedCostUsdMicros = null;
  assert.equal(select([a, b]).selectedRoute?.providerId, "anthropic");
});
test("B2 ranking is quality, then cost, then latency, then lexical ID", () => {
  const a = candidate(), b = candidate("anthropic"); b.quality!.scoreBasisPoints++; assert.equal(select([a, b]).selectedRoute?.providerId, "anthropic");
  b.quality!.scoreBasisPoints--; b.estimatedCostUsdMicros!.value--; assert.equal(select([a, b]).selectedRoute?.providerId, "anthropic");
  b.estimatedCostUsdMicros!.value++; b.estimatedLatencyMs!.value--; assert.equal(select([a, b]).selectedRoute?.providerId, "anthropic");
});
test("B2 subscription/credits require explicit synthetic support; no fabricated zero cost", () => {
  for (const mode of ["subscription_session", "provider_credits"] as const) {
    const c = candidate(), r = requirement(); c.accessModes = [mode]; r.policy.accessModes = [mode]; c.estimatedCostUsdMicros = null;
    assert.equal(select([c], r).selectedRoute?.accessMode, mode); r.policy.maxCostUsdMicros = 0; assertDenied([c], r, "cost_unknown");
  }
});
test("B2 repository analysis and report use same Router with canonical capability/mode", () => {
  const r = requirement(); r.capability = "repository_analysis"; r.mode = "analysis_only"; r.taskClass = "analysis";
  assert.equal(select([candidate("anthropic")], r).verdict, "allow"); r.mode = "patch_proposal"; assertDenied([candidate()], r, "invalid_requirements");
});
test("B2 admission denied/require-approval cannot be overridden by Owner routing pin", () => {
  const r = requirement(); r.policy.requiredExecutorId = "openai-agents"; r.admission.taskOwnerApprovalGranted = false;
  assertDenied([candidate()], r, "task_admission_denied"); r.admission.taskOwnerApprovalGranted = true; r.admission.plan.status = "draft";
  assertDenied([candidate()], r, "task_admission_denied");
});
test("B2 current Run/attempt/plan/task/admitted-path binding is not a route grant", () => {
  for (const mutate of [(r: ReturnType<typeof requirement>) => { r.developmentRun.planId = "other-plan"; },
    (r: ReturnType<typeof requirement>) => { r.developmentRun.taskId = "other-task"; },
    (r: ReturnType<typeof requirement>) => { r.developmentRun.admittedAllowedPaths = ["tests"]; }]) {
    const r = requirement(); mutate(r); assertDenied([candidate()], r, "invalid_attempt_state");
  }
});
test("B2 fingerprints bind requirements, admitted scope, candidate evidence and selected access", () => {
  const a = candidate(), r = requirement(), d = select([a], r); assert.match(d.routeFingerprint!, /^[a-f0-9]{64}$/u);
  const changed = structuredClone(a); changed.quality!.fingerprint = "0".repeat(64); assert.notEqual(select([changed], r).routeFingerprint, d.routeFingerprint);
  r.taskClass = "repair"; assert.notEqual(select([a], r).routeFingerprint, d.routeFingerprint);
  r.repository.baseline = "b".repeat(40); assert.notEqual(select([a], r).routeFingerprint, d.routeFingerprint);
});
test("B2 captured candidates and caller requirements never mutate; outputs fresh deeply frozen", () => {
  const a = candidate(), r = requirement(), before = structuredClone(r), router = routerModule.createExecutorRouter([a]).router!;
  const x = router.select(r); a.availability.state = "unavailable"; a.environment.capabilities.network_policy.state = "unsupported";
  const y = router.select(r); assert.deepEqual(x, y); assert.notEqual(x, y); assert.notEqual(x.selectedRoute, y.selectedRoute); deeplyFrozen(y);
  assert.deepEqual(r, before); r.policy.requiredExecutorId = "absent"; assert.equal(router.select(r).verdict, "deny"); assert.equal(x.verdict, "allow");
});
test("B2 candidate normalized list permutations and object key order preserve exact decisions", () => {
  const a = candidate(), b = candidate("anthropic"), d = select([a, b]);
  a.capabilities.reverse(); a.modes.reverse(); a.artifacts.reverse(); a.repositoryFeatures.reverse();
  assert.deepEqual(select([b, a]), d);
});
test("B2 empty registry denies without partial result", () => { assertDenied([], requirement(), "no_eligible_candidate"); });

// Synthetic policy facts ONLY: these are not actual vendor task-class claims.
function taskClassCandidates() {
  const a = candidate(), b = candidate("anthropic");
  Object.assign(a, { taskClasses: ["implementation", "repair", "refactor"] });
  Object.assign(b, { taskClasses: ["analysis", "verification"] });
  return [a, b];
}
for (const [taskClass, provider] of [["implementation", "openai"], ["repair", "openai"], ["refactor", "openai"], ["analysis", "anthropic"], ["verification", "anthropic"]] as const) {
  test(`B2 task-class ${taskClass} selects eligible ${provider}, independent of candidate order`, () => {
    const candidates = taskClassCandidates(), r = requirement(); r.taskClass = taskClass;
    const before = structuredClone([candidates, r]), d = select(candidates, r);
    assert.equal(d.verdict, "allow"); assert.equal(d.selectedRoute?.providerId, provider);
    assert.deepEqual(d.rejected[0].reasons, ["task_class_mismatch"]);
    assert.deepEqual(d, select([...candidates].reverse(), r)); assert.deepEqual(d, select(candidates, r));
    assert.deepEqual([candidates, r], before);
  });
}
test("B2 task-class unsupported by all candidates denies with no partial selection", () => {
  const c = candidate(); Object.assign(c, { taskClasses: ["analysis"] });
  assertDenied([c], requirement(), "task_class_mismatch");
});
test("B2 task-class incompatible hard-pinned executor cannot bypass filter", () => {
  const r = requirement(); r.policy.requiredExecutorId = "claude-managed-agents";
  const d = assertDenied(taskClassCandidates(), r, "owner_required_executor_ineligible");
  assert.ok(d.rejected.some(c => c.reasons.some(reason => reason === "task_class_mismatch")));
});
test("B2 task-class incompatible soft preference falls through to next eligible executor", () => {
  const r = requirement(); r.policy.preferredExecutorIds = ["claude-managed-agents", "openai-agents"];
  assert.equal(select(taskClassCandidates(), r).selectedRoute?.providerId, "openai");
});
test("B2 task-class shared eligibility preserves Owner/quality/cost/latency ranking", () => {
  const a = candidate(), b = candidate("anthropic"), r = requirement();
  Object.assign(a, { taskClasses: ["repair"] }); Object.assign(b, { taskClasses: ["repair"] }); r.taskClass = "repair";
  r.policy.preferredExecutorIds = [b.executor.id]; assert.equal(select([a, b], r).selectedRoute?.providerId, "anthropic");
  r.policy.preferredExecutorIds = []; b.quality!.scoreBasisPoints++; assert.equal(select([a, b], r).selectedRoute?.providerId, "anthropic");
  b.quality!.scoreBasisPoints--; b.estimatedCostUsdMicros!.value--; assert.equal(select([a, b], r).selectedRoute?.providerId, "anthropic");
  b.estimatedCostUsdMicros!.value++; b.estimatedLatencyMs!.value--; assert.equal(select([a, b], r).selectedRoute?.providerId, "anthropic");
  b.estimatedLatencyMs!.value++; assert.equal(select([b, a], r).selectedRoute?.providerId, "openai");
});
test("B2 task-class support is fingerprint-bound, normalized and captured immutably", () => {
  const c = candidate(), r = requirement(); Object.assign(c, { taskClasses: ["repair", "implementation"] });
  const router = routerModule.createExecutorRouter([c]).router!, d = router.select(r);
  Object.assign(c, { taskClasses: ["implementation", "repair"] }); assert.deepEqual(select([c], r), d);
  Object.assign(c, { taskClasses: ["analysis"] }); assert.deepEqual(router.select(r), d);
  Object.assign(c, { taskClasses: ["implementation"] }); const changed = select([c], r);
  assert.notEqual(changed.candidateSetFingerprint, d.candidateSetFingerprint); assert.notEqual(changed.routeFingerprint, d.routeFingerprint);
});
test("B2 task-class conflicting static facts for one executor identity deny registry", () => {
  const a = candidate(), b = candidate("openai", "route-second");
  Object.assign(a, { taskClasses: ["implementation"] }); Object.assign(b, { taskClasses: ["analysis"] });
  assert.equal(routerModule.createExecutorRouter([a, b]).verdict, "deny");
});
