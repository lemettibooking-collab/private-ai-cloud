/* eslint-disable @typescript-eslint/no-explicit-any -- hostile timing fixtures intentionally cross unknown boundaries */
// AI-037.6a: provider generation timeout + safety margin <= workflow claim lease.
import assert from "node:assert/strict";
import test from "node:test";

const policy = (await import(
  new URL("../lib/contracts/provider-claim-lease-policy.ts", import.meta.url).href
)) as typeof import("../lib/contracts/provider-claim-lease-policy");
const openAIContract = (await import(
  new URL("../lib/providers/openai-model-provider.ts", import.meta.url).href
)) as typeof import("../lib/providers/openai-model-provider");
const storeContract = (await import(
  new URL("../lib/db/workflow-runtime-store.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-store");

const {
  composeProviderWithinClaimLease,
  providerExecutionLeaseSafetyMarginMs,
  validateProviderClaimLeaseTiming,
} = policy;
const { postgresWorkflowRuntimeStoreLimits } = storeContract;

const defaultLease = postgresWorkflowRuntimeStoreLimits.defaultLeaseDurationMs;
const minimumLease = postgresWorkflowRuntimeStoreLimits.minimumLeaseDurationMs;

function timing(providerTimeoutMs: unknown, claimLeaseDurationMs: unknown) {
  return { providerTimeoutMs, claimLeaseDurationMs };
}

function allowed(input: unknown): boolean {
  return validateProviderClaimLeaseTiming(input).verdict === "allow";
}

// OpenAI adapter with a deterministic fake SDK: counts client construction and every remote call.
function openAIFactory() {
  const calls = { clients: [] as Array<{ timeout: number; maxRetries: number }>, creates: 0, counts: 0, retrieves: 0 };
  const createProvider = (validated: { providerTimeoutMs: number }) => openAIContract.createOpenAIModelProvider({
    identity: {
      providerId: "provider-openai", providerKind: "openai", deploymentId: "deployment-openai",
      providerModelId: "gpt-test-alias", providerRequestModelId: "gpt-test-pinned", providerModelVersion: "gpt-test-version",
    },
    timeoutMs: validated.providerTimeoutMs,
    maxInputTokens: 1_000,
    maxOutputTokens: 100,
    inputCostUsdMicrosPerMillionTokens: 1,
    outputCostUsdMicrosPerMillionTokens: 1,
  }, { apiKey: "sk-private-test-secret" }, {
    createClient(options) {
      calls.clients.push({ timeout: options.timeout, maxRetries: options.maxRetries });
      return {
        responses: {
          async create() { calls.creates += 1; throw new Error("no network in tests"); },
          inputTokens: { async count() { calls.counts += 1; throw new Error("no network in tests"); } },
        },
        models: { async retrieve() { calls.retrieves += 1; throw new Error("no network in tests"); } },
      };
    },
  });
  return { calls, createProvider };
}

test("the named safety margin is exactly 10 seconds", () => {
  assert.equal(providerExecutionLeaseSafetyMarginMs, 10_000);
});

test("A/B: timeout + margin == lease is allowed; one millisecond more is denied", () => {
  for (const lease of [300_000, 30_000, 120_000, 900_000]) {
    assert.equal(allowed(timing(lease - 10_000, lease)), true, `lease ${lease} boundary`);
    assert.equal(allowed(timing(lease - 10_000 + 1, lease)), false, `lease ${lease} + 1 ms`);
  }
  const decision = validateProviderClaimLeaseTiming(timing(290_000, 300_000));
  assert.deepEqual(decision, {
    verdict: "allow",
    reasons: [],
    timing: { providerTimeoutMs: 290_000, claimLeaseDurationMs: 300_000, safetyMarginMs: 10_000 },
  });
  const denied = validateProviderClaimLeaseTiming(timing(290_001, 300_000));
  assert.equal(denied.verdict, "deny");
  assert.equal(denied.timing, null);
  assert.deepEqual(denied.reasons.map((reason) => reason.code), ["provider_timeout_exceeds_claim_lease"]);
});

test("C: the store's default claim lease allows 290 s and denies 290.001 s", () => {
  assert.equal(defaultLease, 300_000);
  assert.equal(allowed(timing(290_000, defaultLease)), true);
  assert.equal(allowed(timing(290_001, defaultLease)), false);
  assert.equal(allowed(timing(1, defaultLease)), true);
});

test("D: the store's minimum claim lease allows 20 s and denies 20.001 s", () => {
  assert.equal(minimumLease, 30_000);
  assert.equal(allowed(timing(20_000, minimumLease)), true);
  assert.equal(allowed(timing(20_001, minimumLease)), false);
  // A lease not larger than the margin can never admit a provider timeout.
  assert.equal(allowed(timing(1, 10_000)), false);
  assert.equal(allowed(timing(1, 10_001)), true);
});

test("E: malformed timing values fail closed", () => {
  const invalidNumbers: unknown[] = [
    -1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER, "290000", BigInt(290_000), null, undefined, true, {}, [290_000],
    new Number(290_000),
  ];
  for (const value of invalidNumbers) {
    assert.equal(allowed(timing(value, defaultLease)), false, `provider timeout ${String(value)}`);
    assert.equal(allowed(timing(20_000, value)), false, `claim lease ${String(value)}`);
  }
  const getter = { claimLeaseDurationMs: defaultLease } as Record<string, unknown>;
  Object.defineProperty(getter, "providerTimeoutMs", { enumerable: true, get: () => 20_000 });
  const inherited = Object.assign(Object.create({ providerTimeoutMs: 20_000 }), { claimLeaseDurationMs: defaultLease });
  const extra = { ...timing(20_000, defaultLease), safetyMarginMs: 0 };
  const proxy = new Proxy(timing(20_000, defaultLease), {});
  const symbolKey = Object.assign(timing(20_000, defaultLease), { [Symbol("x")]: 1 });
  class Timing { providerTimeoutMs = 20_000; claimLeaseDurationMs = defaultLease; }
  for (const input of [
    undefined, null, "timing", 1, [], getter, inherited, extra, proxy, symbolKey, new Timing(),
    { providerTimeoutMs: 20_000 }, { claimLeaseDurationMs: defaultLease },
  ]) {
    assert.doesNotThrow(() => validateProviderClaimLeaseTiming(input));
    assert.equal(allowed(input), false, `input ${String(input)}`);
  }
  // Every provider timeout above the provider contract's own maximum is rejected.
  assert.equal(allowed(timing(openAIContract.openAIModelProviderLimits.maxTimeoutMs + 1, Number.MAX_SAFE_INTEGER)), false);
});

test("F: unsafe timing is rejected, never silently clamped", () => {
  const decision = validateProviderClaimLeaseTiming(timing(300_000, defaultLease));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.timing, null);
  assert.equal(JSON.stringify(decision).includes("290000"), false, "no substituted timeout is offered");
  const { calls, createProvider } = openAIFactory();
  const composed = composeProviderWithinClaimLease(timing(300_000, defaultLease), createProvider);
  assert.equal(composed.verdict, "deny");
  assert.equal(composed.provider, null);
  assert.deepEqual(calls.clients, [], "no clamped client was created");
});

test("G: unsafe composition never creates the provider client or reaches the provider", () => {
  for (const unsafe of [timing(290_001, defaultLease), timing(20_001, minimumLease), timing(0, defaultLease), null]) {
    const { calls, createProvider } = openAIFactory();
    let factoryCalls = 0;
    const composed = composeProviderWithinClaimLease(unsafe, (validated) => {
      factoryCalls += 1;
      return createProvider(validated);
    });
    assert.equal(composed.verdict, "deny");
    assert.equal(composed.provider, null);
    assert.equal(factoryCalls, 0);
    assert.deepEqual(calls, { clients: [], creates: 0, counts: 0, retrieves: 0 });
  }
  const { calls, createProvider } = openAIFactory();
  const composed = composeProviderWithinClaimLease(timing(290_000, defaultLease), createProvider);
  assert.equal(composed.verdict, "allow");
  assert.equal(composed.provider?.verdict, "allow");
  assert.equal(composed.provider?.normalizedConfig?.timeoutMs, 290_000);
  assert.deepEqual(calls.clients, [{ timeout: 290_000, maxRetries: 0 }]);
  assert.equal(calls.creates + calls.counts + calls.retrieves, 0, "composition itself makes no remote call");
});

test("H: caller mutation after validation cannot change the composed timing", () => {
  const input = timing(290_000, defaultLease) as Record<string, unknown>;
  const decision = validateProviderClaimLeaseTiming(input);
  assert.equal(decision.verdict, "allow");
  input.providerTimeoutMs = 900_000;
  assert.equal(decision.timing?.providerTimeoutMs, 290_000);
  assert.equal(Object.isFrozen(decision.timing), true);
  assert.throws(() => { (decision.timing as any).providerTimeoutMs = 900_000; });

  // The factory only ever sees the frozen snapshot, even if the caller mutates its input meanwhile.
  const composedInput = timing(290_000, defaultLease) as Record<string, unknown>;
  const { calls, createProvider } = openAIFactory();
  const composed = composeProviderWithinClaimLease(composedInput, (validated) => {
    composedInput.providerTimeoutMs = 900_000;
    assert.equal(Object.isFrozen(validated), true);
    return createProvider(validated);
  });
  assert.equal(composed.verdict, "allow");
  assert.deepEqual(calls.clients, [{ timeout: 290_000, maxRetries: 0 }]);
  assert.equal(composed.timing?.providerTimeoutMs, 290_000);
});

test("a throwing provider factory fails closed without leaking its error", () => {
  const composed = composeProviderWithinClaimLease(timing(20_000, minimumLease), () => {
    throw new Error("sk-private-test-secret leaked?");
  });
  assert.equal(composed.verdict, "deny");
  assert.equal(composed.provider, null);
  assert.deepEqual(composed.reasons.map((reason) => reason.code), ["provider_factory_failed"]);
  assert.equal(JSON.stringify(composed).includes("sk-private"), false);
});

test("the trusted timing is one object shared by the provider factory and the store; look-alikes are not trusted", () => {
  const decision = validateProviderClaimLeaseTiming(timing(20_000, minimumLease));
  assert.equal(decision.verdict, "allow");
  assert.equal(policy.isTrustedProviderClaimLeaseTiming(decision.timing), true);
  let received: unknown = null;
  const composed = composeProviderWithinClaimLease(decision.timing, (validated) => { received = validated; return "provider"; });
  assert.equal(composed.verdict, "allow");
  assert.equal(received, decision.timing, "the factory receives the exact trusted object");
  assert.equal(composed.timing, decision.timing);
  for (const lookAlike of [
    { ...decision.timing },
    Object.freeze({ providerTimeoutMs: 20_000, claimLeaseDurationMs: minimumLease, safetyMarginMs: 10_000 }),
    new Proxy(decision.timing as object, {}),
  ]) {
    assert.equal(policy.isTrustedProviderClaimLeaseTiming(lookAlike), false);
    assert.equal(composeProviderWithinClaimLease(lookAlike, () => "provider").verdict, "deny");
  }
});
