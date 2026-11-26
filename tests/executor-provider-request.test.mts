import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, executorTarget, context } from "./fixtures/durable-executor.mts";
const contract = await import(new URL("../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../lib/contracts/executor-adapter");
const identity = await import(new URL("../lib/executors/executor-provider-identity.ts", import.meta.url).href) as typeof import("../lib/executors/executor-provider-identity");
const transport = await import(new URL("../lib/executors/openai-agents-executor.ts", import.meta.url).href) as typeof import("../lib/executors/openai-agents-executor");
const seam = await import(new URL("../lib/executors/executor-provider-request.ts", import.meta.url).href) as typeof import("../lib/executors/executor-provider-request");
const openai = await import(new URL("../lib/executors/openai-agents-request.ts", import.meta.url).href) as typeof import("../lib/executors/openai-agents-request");
const workspace = "00000000-0000-4000-8000-0000000000a1";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function invocation(n = 1) {
  const i = contract.createExecutorAdapterContract(executorConfiguration(n)).adapter!.validateInvocation(executorRequest(n)).normalizedInvocation;
  assert.ok(i); return i;
}
function tuple(providerId = "openai") {
  return { workspaceIdentity: workspace, developmentRunId: "development-a", attemptNumber: 1,
    requestFingerprint: "a".repeat(64), ...executorTarget(), providerId, executorIdentity: invocation().identity };
}
test("RED: factual Anthropic identity is representable without an OpenAI-only correlation gate", () => {
  const input = tuple("anthropic");
  const expected = hash(["pac.executor.provider-correlation.v1", workspace, "development-a", 1, "a".repeat(64),
    "anthropic", input.modelId, input.accountId, input.executorIdentity.id, input.executorIdentity.version].join("\n"));
  assert.equal(identity.deriveExecutorProviderCorrelation(input), expected);
  assert.notEqual(expected, identity.deriveExecutorProviderCorrelation(tuple()));
});
// Literal vectors captured from baseline 1acd52c BEFORE extraction, not recomputed expected values.
const vectors = [
  [1, 1, 1521, "4ed4bbf33cb3eff434262fb3504932391f747b694e61fb9f3794bc6fa54497d9", "93668bbad2125f7bd55399813ff5ccd4641dc7e0fc4607d00f520d9da67b2efe", "432701801a1dbd299a100384deca420c5ce0a69fdf76e3583009defb6a4838f5"],
  [1, 2, 1521, "548403702f35c97d8add828c2d863ec378ee331de997995011dbd95d91aefcd1", "53ac0f2564cdeea1db03b9d6ce82bef700c042405f04242d33227f2bc22fa135", "ac3eca53c4209ad7852a99b82e8e7898e29f0691ff6efb2664c6d857479abf64"],
  [2, 1, 1524, "6b6e21d43cda8ee05f2f3d1432aadecbaf39ec931a5cc8becf82a75897785b5f", "2b425ce4024b8ababe1e8b08da6f7da32fbaddb60065d62fa474e31ec66ff265", "5d55b0b685251071e2f2fd5180497b394339953b1529b3eece880e84892a556a"],
  [2, 2, 1524, "2529b7cc4b6ca8879825f6dfe593beeaade56750ba064c0eb7be794bcdc5f10d", "8d202526056ccc103ded4c0a06d640dee0b0a24201391ea12f51031f8db22ee0", "5b0acd46e740d21d21017d6bd461b5cc57a4ee96670093aab3451f050b1f5884"],
  [3, 1, 1524, "28807d13e74181a73593f6eb64cb386ea4e6dc9baff0322253e9f73abebdd5c6", "c5d6818414f7f9bb88d49e3a57d70755a689721994b3db635b10a59e87a6cc9e", "c31d56b0c50e4185281a46c31834090effc252daae3a47add22895f7db1a9465"],
  [3, 2, 1524, "6e289b921da043c22f97f84f62e3d092a3bce8469f9a52f1893873940e944071", "20d6eaeaf6afbb9973a72254e02d951c3dc5c2a535dcef44f64596163bbde257", "a1052efb5507190c9d976d16faecd95581c022167c0b3d8cca1863392c94d498"],
] as const;
for (const [n, cap, bytes, final, base, correlation] of vectors) test(`OpenAI literal bytes/digests: attempt ${n} cap ${cap}`, () => {
  for (const amount of cap === 1 ? [10000, 19999] : [20000]) {
    const a = transport.createOpenAIAgentsCanonicalRequest(invocation(n), context(), executorTarget(), amount, workspace);
    assert.equal(a.requestFingerprint, final); assert.equal(hash(a.body), final); assert.equal(Buffer.byteLength(a.body), bytes);
    assert.equal(a.baseRequestFingerprint, base); assert.equal(a.correlationFingerprint, correlation); assert.equal(a.spendLimitCents, cap);
    const { metadata, ...body } = JSON.parse(a.body);
    assert.deepEqual(metadata, { pac_execution: correlation }); assert.deepEqual(body.spend_control, { limit: cap });
    assert.equal(hash(JSON.stringify(body)), base);
  }
});
function frozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
function synthetic(i: ReturnType<typeof invocation>, c: unknown, target: ReturnType<typeof executorTarget>, amount: number, w: string) {
  // Synthetic identity-only policy: not a Claude protocol, transport or live issuer.
  const baseBody = JSON.stringify({ testOnly: true, invocation: i, context: c, target, amount });
  const baseRequestFingerprint = hash(baseBody);
  const correlationFingerprint = identity.deriveExecutorProviderCorrelation({ workspaceIdentity: w, developmentRunId: i.attempt.developmentRunId,
    attemptNumber: i.attempt.number, requestFingerprint: baseRequestFingerprint, ...target, executorIdentity: i.identity });
  const body = JSON.stringify({ baseBody, correlationFingerprint });
  return { providerId: target.providerId, target, body, baseBody, requestFingerprint: hash(body), baseRequestFingerprint, correlationFingerprint,
    providerBudgetDefenseEvidence: { limitCents: Math.floor(amount / 10000), enforcement: "provider_defense_only", inFlightOverrunPossible: true } };
}
function prepare(p: unknown = openai.createOpenAIAgentsRequestPolicy(), target = executorTarget()) {
  return seam.prepareExecutorProviderRequest(p, invocation(), context(), target, 10000, workspace);
}
test("OpenAI seam is byte-identical to compatibility export, fresh/frozen, deterministic and immutable", () => {
  const p = openai.createOpenAIAgentsRequestPolicy(), i = invocation(), c = context(), target = executorTarget(), before = structuredClone({ i, c, target });
  const a = prepare(p), b = prepare(p), old = transport.createOpenAIAgentsCanonicalRequest(i, c, target, 10000, workspace);
  assert.ok(a); assert.ok(b); assert.equal(a.body, old.body); assert.equal(a.requestFingerprint, old.requestFingerprint);
  assert.equal(a.baseRequestFingerprint, old.baseRequestFingerprint); assert.equal(a.correlationFingerprint, old.correlationFingerprint);
  assert.equal(a.providerBudgetDefenseEvidence.limitCents, old.spendLimitCents); assert.deepEqual(a, b); assert.notEqual(a, b); frozen(a); frozen(b);
  assert.deepEqual({ i, c, target }, before);
});
test("analysis-only and context ordering retain captured baseline bytes", () => {
  const i = contract.createExecutorAdapterContract(executorConfiguration()).adapter!.validateInvocation({ ...executorRequest(), capability: "repository_analysis", mode: "analysis_only" }).normalizedInvocation!;
  const files = [{ path: "src/b.ts", content: "// B" }, { path: "src/a.ts", content: "// A" }], before = structuredClone(files);
  for (const c of [{ files }, { files: [...files].reverse() }]) {
    const r = seam.prepareExecutorProviderRequest(openai.createOpenAIAgentsRequestPolicy(), i, c, executorTarget(), 19999, workspace); assert.ok(r);
    assert.equal(r.requestFingerprint, "31fb56d61670344c5b2d0472b72976e4ec5454e20e516e1153c44807e7cd3d9a");
    assert.equal(r.baseRequestFingerprint, "47ac3873e60b084c921a6691dfb4667b38e2fdd4d75b09cab676a8ad7809debf");
    assert.equal(r.correlationFingerprint, "71e7eec21d5cc3b10f3699ca3bc87a7ea8c5cbeadbb80d78113513fa329cad9d"); assert.equal(Buffer.byteLength(r.body), 1556);
  }
  assert.deepEqual(files, before);
});
test("trusted synthetic second provider works at neutral seam; no OpenAI fallback or policy swap", () => {
  const p = seam.defineTrustedExecutorProviderRequestPolicy("anthropic", synthetic), target = { ...executorTarget(), providerId: "anthropic" };
  const a = prepare(p, target), b = prepare(p, target); assert.ok(a); assert.deepEqual(a, b); assert.notEqual(a, b); frozen(a);
  assert.equal(a.providerId, "anthropic"); assert.equal(seam.executorRequestPolicyMatches(p, "openai"), false);
  assert.equal(prepare(p), null); assert.equal(prepare(openai.createOpenAIAgentsRequestPolicy(), target), null);
  for (const unknown of ["unknown", "OpenAI", "openai\n", "", "x".repeat(129)]) {
    assert.equal(prepare(p, { ...target, providerId: unknown }), null);
    assert.throws(() => seam.defineTrustedExecutorProviderRequestPolicy(unknown as "openai", synthetic), /invalid_executor_request_policy/u);
  }
});
test("correlation literal and every tuple field remain bound (M1/M3)", () => {
  const base = tuple(), before = structuredClone(base), original = identity.deriveExecutorProviderCorrelation(base);
  assert.equal(original, "11dfb02d9ed84b0caed243bbb27176cab28401289bd8e69e11c8b7de1f6ad789");
  for (const change of [{ providerId: "anthropic" }, { requestFingerprint: "b".repeat(64) }, { modelId: "other" }, { accountId: "other" },
    { executorIdentity: { ...base.executorIdentity, version: "v2" } }, { executorIdentity: { ...base.executorIdentity, id: "other" } },
    { workspaceIdentity: "other" }, { developmentRunId: "other" }, { attemptNumber: 2 }]) {
    const value = { ...base, ...change }, a = identity.deriveExecutorProviderCorrelation(value);
    assert.ok(a); assert.notEqual(a, original); assert.equal(identity.deriveExecutorProviderCorrelation(value), a);
  }
  assert.deepEqual(base, before);
});
for (const bad of [null, {}, "unknown", "OpenAI", "x".repeat(129), "openai\n", "openai\u0000", "api_key=private", "sk-" + "x".repeat(48)])
  test(`closed correlation provider rejects hostile identity (${typeof bad}:${String(bad).length})`, () => assert.equal(identity.deriveExecutorProviderCorrelation({ ...tuple(), providerId: bad }), null));
test("forged/cloned/proxied policy and accessor inputs fail without traps or callbacks", () => {
  let calls = 0, traps = 0;
  const p = seam.defineTrustedExecutorProviderRequestPolicy("openai", (...args) => { calls++; return synthetic(...args); });
  const getter = Object.defineProperty({}, "providerId", { enumerable: true, get() { traps++; throw Error("private-canary"); } });
  const proxy = new Proxy(p, { get() { traps++; throw Error("private-canary"); } });
  for (const bad of [undefined, null, {}, { ...p }, structuredClone(p), getter, proxy, { providerId: "openai", prepare: synthetic }]) {
    assert.equal(seam.prepareExecutorProviderRequest(bad, invocation(), context(), executorTarget(), 10000, workspace), null);
    assert.equal(seam.executorRequestPolicyMatches(bad, "openai"), false);
  }
  for (const bad of [getter, proxy]) assert.equal(seam.prepareExecutorProviderRequest(p, invocation(), bad, executorTarget(), 10000, workspace), null);
  assert.equal(calls, 0); assert.equal(traps, 0);
});
test("unknown provider never defaults to OpenAI (M6)", () => {
  const p = openai.createOpenAIAgentsRequestPolicy();
  for (const providerId of ["unknown", "unlisted", "OpenAI", "anthropic"])
    assert.equal(prepare(p, { ...executorTarget(), providerId }), null);
});
test("malformed/hostile implementation output cannot inject authority or leak provider data", () => {
  let traps = 0;
  const getter = Object.defineProperty({}, "body", { enumerable: true, get() { traps++; throw Error("private-canary"); } });
  const changes: Array<(r: ReturnType<typeof synthetic>) => unknown> = [
    r => ({ ...r, requestFingerprint: "f".repeat(64) }), r => ({ ...r, baseRequestFingerprint: "f".repeat(64) }),
    r => ({ ...r, correlationFingerprint: "f".repeat(64) }), r => ({ ...r, providerId: "anthropic" }),
    r => ({ ...r, target: { ...r.target, providerId: "anthropic" } }), r => ({ ...r, target: { ...r.target, modelId: "other" } }),
    r => ({ ...r, target: { ...r.target, accountId: "other" } }), r => ({ ...r, body: "x".repeat(65537) }),
    r => ({ ...r, baseBody: "x".repeat(65537) }), r => ({ ...r, body: "api_key=private-canary" }),
    r => ({ ...r, startCapability: { kind: "durable_executor_start" } }), r => ({ ...r, authorizeStart: true }),
    r => ({ ...r, providerBudgetDefenseEvidence: { ...r.providerBudgetDefenseEvidence, limitCents: 2 } }),
    r => ({ ...r, providerBudgetDefenseEvidence: { ...r.providerBudgetDefenseEvidence, enforcement: "hard_cap" } }),
    () => getter, () => new Proxy({}, { ownKeys() { traps++; throw Error("private-canary"); } }),
    () => { throw Error("private-canary"); }, () => Promise.resolve(null),
  ];
  for (const change of changes) {
    const p = seam.defineTrustedExecutorProviderRequestPolicy("openai", (...args) => change(synthetic(...args)));
    assert.equal(prepare(p), null); assert.equal(prepare(p), null);
  }
  assert.equal(traps, 0);
});
test("reused correlation and stale invocation do not match a changed factual tuple", () => {
  const saved = prepare(); assert.ok(saved);
  const p = seam.defineTrustedExecutorProviderRequestPolicy("openai", () => saved);
  assert.equal(seam.prepareExecutorProviderRequest(p, invocation(2), context(), executorTarget(), 10000, workspace), null);
  for (const change of [{ accountId: "other" }, { modelId: "other" }]) assert.equal(prepare(p, { ...executorTarget(), ...change }), null);
});
test("durable core dependency direction has no concrete provider import", () => {
  const dbRoot = new URL("../lib/db/", import.meta.url);
  for (const file of ["executor-start-store.ts", "executor-provider-identity-store.ts"]) {
    const source = readFileSync(new URL(file, dbRoot), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:openai|anthropic|claude)[^"']*["']/iu);
    assert.doesNotMatch(source, /createOpenAIAgentsCanonicalRequest|target\.providerId !== "openai"/u);
    assert.match(source, /prepareExecutorProviderRequest/u);
  }
});
