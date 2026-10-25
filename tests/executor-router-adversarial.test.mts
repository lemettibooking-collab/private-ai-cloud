import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { candidate, requirement, select, routerModule, deeplyFrozen } from "./fixtures/executor-routing.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { memoryClaude, contract } from "./fixtures/claude-managed.mts";

const malformed: Array<[string, (c: ReturnType<typeof candidate>) => unknown]> = [
  ["unknown provider", c => ({ ...c, providerId: "qwen" })],
  ["mismatched executor/provider", c => ({ ...c, providerId: "anthropic" })],
  ["unknown executor version", c => ({ ...c, executor: { ...c.executor, version: "v2" } })],
  ["unknown executor", c => ({ ...c, executor: { ...c.executor, id: "generic-agent" } })],
  ["oversized ID", c => ({ ...c, routeId: "a".repeat(65) })],
  ["control ID", c => ({ ...c, routeId: "route\nvalue" })],
  ["secret ID", c => ({ ...c, routeId: `sk-${"a".repeat(30)}` })],
  ["secret-like metadata", c => ({ ...c, credential: "private-canary" })],
  ["executable callback", c => ({ ...c, register: () => {} })],
  ["unknown access", c => ({ ...c, accessModes: ["browser_cookie"] })],
  ["unknown environment", c => ({ ...c, environment: { ...c.environment, kind: "cloud" } })],
  ["unknown capability", c => ({ ...c, capabilities: ["tool_loop"] })],
  ["empty capability", c => ({ ...c, capabilities: [] })],
  ["missing taskClasses", c => Object.fromEntries(Object.entries(c).filter(([key]) => key !== "taskClasses"))],
  ["empty taskClasses", c => ({ ...c, taskClasses: [] })],
  ["unknown taskClass", c => ({ ...c, taskClasses: ["generic-agent-work"] })],
  ["duplicate taskClasses", c => ({ ...c, taskClasses: ["repair", "repair"] })],
  ["duplicate capability", c => ({ ...c, capabilities: ["coding", "coding"] })],
  ["unknown mode", c => ({ ...c, modes: ["execute"] })],
  ["unknown artifact", c => ({ ...c, artifacts: ["binary"] })],
  ["unknown risk", c => ({ ...c, maxRisk: "safe" })],
  ["invalid quality score", c => ({ ...c, quality: { ...c.quality, scoreBasisPoints: 10001 } })],
  ["invalid quality samples", c => ({ ...c, quality: { ...c.quality, sampleCount: 0 } })],
  ["invalid provenance", c => ({ ...c, quality: { ...c.quality, fingerprint: null } })],
  ["unsupported state", c => ({ ...c, quota: { state: "unlimited", fingerprint: "a".repeat(64) } })],
  ["available without evidence", c => ({ ...c, availability: { state: "available", fingerprint: null } })],
  ["supported capability without evidence", c => { c.environment.capabilities.network_policy.fingerprint = null; return c; }],
  ["invalid residency string", c => { c.environment.residency.regions = ["EU ANYWHERE"]; return c; }],
  ["private path residency", c => { c.environment.residency.regions = ["/Users/owner/private"]; return c; }],
  ["contradictory environment brand", c => ({ ...c, providerId: "anthropic", executor: { id: "claude-managed-agents", version: "v1" }, environment: { ...c.environment, kind: "openai_hosted" } })],
];
for (const [name, mutate] of malformed) test(`B2 malformed registry ${name}: fail closed/no partial or raw error`, () => {
  const d = routerModule.createExecutorRouter([mutate(candidate())]); assert.equal(d.verdict, "deny"); assert.equal(d.router, null);
  deeplyFrozen(d); assert.deepEqual(d.reasons, ["invalid_registry"]); assert.doesNotMatch(JSON.stringify(d), /private-canary|sk-/u);
});
for (const key of ["estimatedCostUsdMicros", "estimatedLatencyMs"] as const) for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
  test(`B2 ${key} invalid number ${String(value)} rejected`, () => { const c = candidate(); c[key]!.value = value; assert.equal(routerModule.createExecutorRouter([c]).verdict, "deny"); });
}
test("B2 reject duplicate route IDs, indistinguishable routes, conflicting same-executor facts/environment", () => {
  const a = candidate(), b = candidate("anthropic", a.routeId); assert.equal(routerModule.createExecutorRouter([a, b]).verdict, "deny");
  const other = structuredClone(a); other.routeId = "different-id"; assert.equal(routerModule.createExecutorRouter([a, other]).verdict, "deny");
  other.environment.id = "different-environment"; other.maxRisk = "critical"; assert.equal(routerModule.createExecutorRouter([a, other]).verdict, "deny");
  const c = candidate("anthropic"); c.environment.id = a.environment.id; c.environment.capabilities.timeout.state = "unknown";
  assert.equal(routerModule.createExecutorRouter([a, c]).verdict, "deny");
});
test("B2 bounded lists, deep/wide hostile data, sparse arrays, symbols and cycles reject", () => {
  const deep: Record<string, unknown> = {}; let p = deep; for (let i = 0; i < 100; i++) { p.next = {}; p = p.next as Record<string, unknown>; }
  const cycle: Record<string, unknown> = {}; cycle.next = cycle;
  for (const input of [Array.from({ length: 33 }, (_, i) => candidate("openai", `route-${i}`)), [deep], [cycle], new Array(1),
    [{ ...candidate(), ...Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`key-${i}`, 1])) }],
    [{ ...candidate(), [Symbol("hidden")]: true }], [{ ...candidate(), routeId: "a".repeat(300000) }]]) {
    assert.equal(routerModule.createExecutorRouter(input).verdict, "deny");
  }
});
test("B2 hostile getters, proxies, revoked proxies, toJSON never execute", () => {
  let traps = 0; const c = candidate(); Object.defineProperty(c, "quota", { enumerable: true, get() { traps++; throw Error("raw-error-canary"); } });
  const proxy = new Proxy({}, { ownKeys() { traps++; throw Error("raw-error-canary"); } }); const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const input of [[c], [proxy], [revoked.proxy], new Proxy([], {}), [{ ...candidate(), toJSON() { traps++; return {}; } }]]) {
    const d = routerModule.createExecutorRouter(input); assert.equal(d.verdict, "deny"); assert.doesNotMatch(JSON.stringify(d), /raw-error-canary/u);
  }
  const router = routerModule.createExecutorRouter([candidate()]).router!;
  assert.equal(router.select(proxy).verdict, "deny"); const r = requirement(); Object.defineProperty(r, "policy", { get() { traps++; throw Error(); } });
  assert.equal(router.select(r).verdict, "deny"); assert.equal(traps, 0);
});
test("B2 malformed requirement constraints and unknown Owner preference deny deterministically", () => {
  const mutations: Array<(r: ReturnType<typeof requirement>) => void> = [r => { r.policy.preferredExecutorIds = ["unknown-route"]; },
    r => { r.taskClass = "unreviewed-work"; },
    r => { r.policy.preferredExecutorIds = ["openai-agents", "openai-agents"]; }, r => { r.policy.maxCostUsdMicros = -1; },
    r => { r.policy.maxLatencyMs = Infinity; }, r => { r.policy.minQualityBasisPoints = 10001; },
    r => { r.policy.environment.residency = "eu any"; }, r => { r.policy.accessModes = ["unknown"]; },
    r => { (r.policy.environment.capabilities as string[]) = ["unknown"]; }];
  for (const mutate of mutations) { const r = requirement(); mutate(r); const d = select([candidate()], r); assert.equal(d.verdict, "deny"); assert.deepEqual(d, select([candidate()], r)); assert.equal(d.selectedRoute, null); }
});
test("B2 hard pin cannot elevate blocked local/VPS/self-hosted route", () => {
  for (const kind of ["local", "vps_self_hosted"] as const) { const c = candidate(), r = requirement(); c.environment.kind = kind; r.policy.environment.kinds = [kind]; r.policy.requiredExecutorId = c.executor.id;
    const d = select([c], r); assert.equal(d.verdict, "deny"); assert.equal(d.selectedRoute, null); }
});
test("B2 maximum bounded registry is usable without truncation and input mutation", () => {
  const candidates = Array.from({ length: 32 }, (_, i) => { const c = candidate("openai", `route-${i.toString().padStart(2, "0")}`); c.environment.id = `environment-${i}`; return c; });
  const before = structuredClone(candidates), d = select(candidates); assert.equal(d.verdict, "allow"); assert.equal(d.ranking.length, 32);
  assert.deepEqual(d, select([...candidates].reverse())); assert.deepEqual(candidates, before);
});
test("B2 route decision cannot substitute for executor invocation receipt/start/rebind authority", async () => {
  const route = select([candidate("anthropic")]), m = memoryClaude();
  assert.equal((await m.executor.execute(m.f.raw, route)).verdict, "deny"); assert.equal(m.provider.stats().creates, 0);
  const adapter = contract.createExecutorAdapterContract(m.f.configuration).adapter!;
  assert.equal(adapter.evaluateResult(route, {}).verdict, "deny"); assert.equal(adapter.validateInvocation(route).verdict, "deny");
  assert.equal(route.dispatchAuthorized, false); assert.equal(route.runtimeDispatchAllowed, false);
});
test("B2 policy source has no ModelRouter, provider SDK, IO, authority or capability issuer", async () => {
  for (const name of ["lib/executors/executor-router.ts", "lib/execution-environment/execution-environment.ts", "lib/execution-environment/managed-execution-environment-policy.ts"]) {
    const text = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /from ["'](?:openai|@anthropic|node:(?:fs|http|https|net|child_process))|\bfetch\s*\(|\bWeak(?:Map|Set)\s*\(|process\.env|ModelRouter|model-capability-routing/u);
    assert.doesNotMatch(text, /commitProviderStart\s*\(|advanceCurrentAuthority\s*\(|\.reserve\s*\(/u);
  }
});
test("B2 exported closed-domain vocabularies cannot be mutated to register extra support", async () => {
  const data = await import(new URL("../lib/execution-environment/execution-environment.ts", import.meta.url).href) as typeof import("../lib/execution-environment/execution-environment");
  for (const values of [routerModule.executorAccessModes, routerModule.executorTaskClasses, data.environmentKinds, data.managedCapabilities, data.privacyRequirements]) {
    assert.ok(Object.isFrozen(values)); assert.throws(() => (values as unknown as string[]).push("unreviewed-support"));
  }
});
