import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { environment, environmentRequirements, environmentModule, deeplyFrozen, evidence } from "./fixtures/executor-routing.mts";
const evaluate = environmentModule.evaluateManagedExecutionEnvironment;
test("B2 managed environment is normalized evidence only, never created/authorized", () => {
  const e = environment(), r = environmentRequirements(), before = structuredClone([e, r]);
  const d = evaluate({ environment: e, requirements: r }); assert.equal(d.verdict, "allow"); assert.equal(d.eligibility, "eligible");
  assert.equal(d.runtimeDispatchAllowed, false); assert.equal(d.dispatchAuthorized, false); deeplyFrozen(d);
  assert.deepEqual([e, r], before); assert.deepEqual(d, evaluate({ environment: e, requirements: r }));
  assert.notEqual(d.normalizedEnvironment, evaluate({ environment: e, requirements: r }).normalizedEnvironment);
});
for (const kind of ["provider_hosted", "openai_hosted", "codex_cloud_if_supported"] as const) test(`B2 managed kind ${kind} with explicit synthetic evidence`, () => {
  const e = environment(), r = environmentRequirements(); e.kind = kind; r.kinds = [kind]; assert.equal(evaluate({ environment: e, requirements: r }).verdict, "allow");
});
for (const kind of ["local", "vps_self_hosted", "future_provider"] as const) test(`B2 ${kind} blocked even if all capability evidence supported`, () => {
  const e = environment(), r = environmentRequirements(); e.kind = kind; r.kinds = [kind]; const d = evaluate({ environment: e, requirements: r });
  assert.equal(d.verdict, "deny"); assert.equal(d.normalizedEnvironment, null); assert.equal(d.runtimeDispatchAllowed, false);
});
test("B2 Codex Cloud product name is not factual programmatic-interface support", () => {
  for (const state of ["unknown", "unsupported"] as const) { const e = environment(), r = environmentRequirements(); e.kind = "codex_cloud_if_supported"; r.kinds = [e.kind];
    e.programmaticInterface = { state, fingerprint: null }; const d = evaluate({ environment: e, requirements: r });
    assert.equal(d.verdict, "deny"); assert.ok(d.reasons.includes("programmatic_interface_unproven")); }
});
for (const capability of ["filesystem_isolation", "path_scope_enforcement", "network_policy", "secrets_isolation", "timeout", "resource_bound", "changed_file_limit", "artifact_collection", "verification_collection", "data_residency", "data_handling"] as const) {
  test(`B2 required managed ${capability}: supported passes, unsupported/unknown deny`, () => {
    const e = environment(), r = environmentRequirements(); r.capabilities = [capability]; assert.equal(evaluate({ environment: e, requirements: r }).verdict, "allow");
    for (const state of ["unknown", "unsupported"] as const) { e.capabilities[capability] = { state, fingerprint: null }; assert.equal(evaluate({ environment: e, requirements: r }).verdict, "deny"); }
  });
}
test("B2 supported without provenance, unknown capability and unknown kind fail closed", () => {
  const e = environment(), r = environmentRequirements(); e.capabilities.network_policy = { state: "supported", fingerprint: null };
  assert.equal(evaluate({ environment: e, requirements: r }).verdict, "deny"); e.capabilities.network_policy = evidence();
  assert.equal(evaluate({ environment: e, requirements: { ...r, capabilities: ["magic"] } }).verdict, "deny");
  assert.equal(evaluate({ environment: { ...e, kind: "cloud" }, requirements: r }).verdict, "deny");
});
test("B2 all privacy requirements need explicit matching evidence and general data-handling support", () => {
  for (const key of ["private_network", "zdr", "no_training", "restricted_data"] as const) {
    const e = environment(), r = environmentRequirements(); r.privacy = [key]; assert.equal(evaluate({ environment: e, requirements: r }).verdict, "allow");
    e.privacy[key] = { state: "unknown", fingerprint: null }; assert.equal(evaluate({ environment: e, requirements: r }).verdict, "deny");
    e.privacy[key] = evidence(); e.capabilities.data_handling.state = "unsupported"; assert.equal(evaluate({ environment: e, requirements: r }).verdict, "deny");
  }
});
test("B2 residency is explicit region plus evidence, never a provider-name guarantee", () => {
  const e = environment(), r = environmentRequirements(); r.residency = "eu-test"; assert.equal(evaluate({ environment: e, requirements: r }).verdict, "allow");
  e.residency.regions = []; assert.equal(evaluate({ environment: e, requirements: r }).verdict, "deny");
});
test("B2 hostile environment getters/proxies are rejected without traps or leakage", () => {
  let calls = 0; const value = { get environment() { calls++; throw Error("raw-secret-canary"); }, requirements: environmentRequirements() };
  for (const v of [value, new Proxy({}, { ownKeys() { calls++; throw Error("raw-secret-canary"); } })]) {
    const d = evaluate(v); assert.equal(d.verdict, "deny"); assert.equal(d.normalizedEnvironment, null); assert.doesNotMatch(JSON.stringify(d), /raw-secret-canary/u);
  }
  assert.equal(calls, 0);
});
