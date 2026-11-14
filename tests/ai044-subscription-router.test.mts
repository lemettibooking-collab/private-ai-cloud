import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { candidate, requirement, routerModule, deeplyFrozen } from "./fixtures/executor-routing.mts";

function profile() {
  return { ...candidate(), executor: { id: "chatgpt-plan-patch", version: "v1" },
    capabilities: ["coding"], modes: ["patch_proposal"], artifacts: ["patch", "report"],
    environment: { id: "ai044-no-environment", kind: "patch_proposal_only" },
    accessModes: ["subscription_session"], estimatedCostUsdMicros: null };
}
function needs() {
  const r = requirement();
  return { ...r, policy: { ...r.policy, accessModes: ["subscription_session"], requiredExecutorId: "chatgpt-plan-patch",
    environment: { kinds: ["patch_proposal_only"], capabilities: [], residency: null, privacy: [] } } };
}
test("AI044 S explicit no-environment subscription route selects only and never authorizes dispatch", () => {
  const c = profile(), r = needs(), before = structuredClone([c, r]);
  const router = routerModule.createExecutorRouter([c]).router;
  assert.ok(router);
  const a = router.select(r), b = router.select(r);
  assert.equal(a.verdict, "allow");
  assert.equal(a.selectedRoute?.executor.id, "chatgpt-plan-patch");
  assert.equal(a.selectedRoute?.environment.kind, "patch_proposal_only");
  assert.equal(a.dispatchAuthorized, false); assert.equal(a.runtimeDispatchAllowed, false);
  assert.deepEqual(a, b); assert.notEqual(a, b); deeplyFrozen(a); assert.deepEqual([c, r], before);
});
for (const [name, mutate] of [
  ["API key", (c: ReturnType<typeof profile>) => { c.accessModes = ["api_key"]; }],
  ["credits", (c: ReturnType<typeof profile>) => { c.accessModes = ["provider_credits"]; }],
  ["Anthropic", (c: ReturnType<typeof profile>) => { c.providerId = "anthropic"; }],
  ["managed identity", (c: ReturnType<typeof profile>) => { c.executor.id = "openai-agents"; }],
] as const) test(`AI044 S no-environment profile cannot be claimed by ${name}`, () => {
  const c = profile(); mutate(c); assert.equal(routerModule.createExecutorRouter([c]).verdict, "deny");
});
test("AI044 S unsupported physical/privacy requirements are not erased by no-environment profile", () => {
  const router = routerModule.createExecutorRouter([profile()]).router!;
  for (const extra of [{ capabilities: ["filesystem_isolation"] }, { privacy: ["zdr"] }, { residency: "eu" }]) {
    const r = needs(); Object.assign(r.policy.environment, extra); assert.equal(router.select(r).verdict, "deny");
  }
});
test("AI044 S unavailable/unknown connection and quota cannot select", () => {
  for (const key of ["availability", "quota"] as const) {
    const c = profile(); c[key] = { state: "unknown", fingerprint: null };
    assert.equal(routerModule.createExecutorRouter([c]).router!.select(needs()).verdict, "deny");
  }
});
