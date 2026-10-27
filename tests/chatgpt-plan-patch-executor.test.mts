import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutorAdapterConfiguration } from "../lib/contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createSubscriptionFixture, createSubscriptionTestConnection } from "./fixtures/ai044-subscription.mts";
const api = await import(new URL("../lib/executors/chatgpt-plan-patch-executor.ts", import.meta.url).href) as typeof import("../lib/executors/chatgpt-plan-patch-executor");
const connections = await import(new URL("../lib/integrations/chatgpt/chatgpt-connection.ts", import.meta.url).href) as typeof import("../lib/integrations/chatgpt/chatgpt-connection");
const composition = await import(new URL("../lib/composition/ai044-subscription-run.ts", import.meta.url).href) as typeof import("../lib/composition/ai044-subscription-run");
const NOW = Date.parse("2026-10-26T12:00:00.000Z");

async function fixture(t: TestContext) {
  const f = await createSubscriptionFixture({ now: () => NOW }); t.after(f.cleanup);
  let posts = 0;
  const executor = api.createChatGPTPlanPatchExecutor(f.configuration, async () => { posts++; throw Error("No provider dispatch is authorized in unit tests"); }, () => NOW);
  return { ...f, executor, posts: () => posts };
}
function noPartial(result: Awaited<ReturnType<ReturnType<typeof api.createChatGPTPlanPatchExecutor>["execute"]>>) {
  assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null); assert.equal(result.proposal, null);
  assert.equal(result.ownerDecisionRequired, true); assert.equal(result.verificationStatus, "not_run"); assert.equal(result.automaticRetryAllowed, false);
}
function routeInput(configuration: ExecutorAdapterConfiguration) {
  return { admission: configuration.admission, developmentRun: configuration.developmentRun, repository: configuration.repository,
    capability: "coding", mode: "patch_proposal", taskClass: "implementation", policy: { environment: { kinds: ["patch_proposal_only"], capabilities: [], residency: null, privacy: [] },
      accessModes: ["subscription_session"], requireQuota: false, maxCostUsdMicros: null, maxLatencyMs: null, minQualityBasisPoints: null,
      requiredExecutorId: "chatgpt-plan-patch", preferredExecutorIds: [] } };
}

test("subscription executor prepares a fresh frozen request from factual admission and exact Git-object context, without credentials or dispatch", async (t) => {
  const f = await fixture(t), before = structuredClone({ invocation: f.rawInvocation, intent: f.intent, configuration: f.configuration });
  const a = f.executor.prepare(f.rawInvocation, f.context, f.intent, f.ownerUserId), b = f.executor.prepare(f.rawInvocation, f.context, f.intent, f.ownerUserId);
  assert.equal(a.verdict, "allow"); assert.equal(b.verdict, "allow"); assert.ok(a.request); assert.ok(b.request);
  assert.notEqual(a.request, b.request); assert.ok(Object.isFrozen(a) && Object.isFrozen(a.request));
  assert.equal(a.requestFingerprint, b.requestFingerprint); assert.equal(a.intentFingerprint, b.intentFingerprint);
  assert.deepEqual({ invocation: f.rawInvocation, intent: f.intent, configuration: f.configuration }, before);
  assert.equal(f.counters.tokenReads, 0); assert.equal(f.counters.refreshCalls, 0); assert.equal(f.posts(), 0);
  assert.equal(f.executor.runtimeDispatchAllowed, false);
});

test("subscription executor rejects copied context and each changed factual binding with null outputs", async (t) => {
  const f = await fixture(t);
  for (const context of [null, {}, { ...f.context }, structuredClone(f.context)]) {
    const d = f.executor.prepare(f.rawInvocation, context, f.intent, f.ownerUserId);
    assert.deepEqual(d, { verdict: "deny", request: null, requestFingerprint: null, intentFingerprint: null });
  }
  for (const changes of [{ contextFingerprint: "f".repeat(64) }, { planFingerprint: "e".repeat(64) }, { invocationId: "another-invocation" },
    { taskId: "another-task" }, { planRevision: 2 }, { projectTaskId: "another-owner-task" }, { expiresAt: NOW },
    { attempt: { ...f.intent.attempt, number: 2, kind: "corrective" } }, { model: "invalid model" }]) {
    const d = f.executor.prepare(f.rawInvocation, f.context, { ...f.intent, ...changes }, f.ownerUserId);
    assert.equal(d.verdict, "deny"); assert.equal(d.request, null); assert.equal(d.requestFingerprint, null);
  }
  assert.equal(f.posts(), 0); assert.equal(f.counters.tokenReads, 0);
});

test("subscription executor refuses fake/copied start capabilities and fake/API-key credential receipts; no public issuer exists", async (t) => {
  const f = await fixture(t), prepared = f.executor.prepare(f.rawInvocation, f.context, f.intent, f.ownerUserId); assert.ok(prepared.request);
  for (const start of [null, {}, { kind: "ai044_subscription_start" }]) for (const credential of [null, {}, { ok: true, token: "FAKE_API_KEY" }, { ok: true, kind: "chatgpt_subscription_access" }]) {
    noPartial(await f.executor.execute(prepared.request, start, credential));
  }
  const realLease = await f.connection.subscriptionAccessToken(f.expected);
  assert.equal(realLease.ok, true);
  noPartial(await f.executor.execute(prepared.request, { kind: "ai044_subscription_start" }, realLease));
  noPartial(await f.executor.execute({ ...prepared.request }, null, realLease));
  assert.equal(connections.isChatGPTSubscriptionAccess(realLease, f.expected), true, "invalid start never consumes a real credential lease");
  assert.equal(f.posts(), 0);
});

test("subscription executor cannot use a factual selected-model lease for a different model or registration", async (t) => {
  const f = await fixture(t), lease = await f.connection.subscriptionAccessToken(f.expected);
  const otherModel = f.executor.prepare(f.rawInvocation, f.context, { ...f.intent, model: "another-plan-model" }, f.ownerUserId);
  assert.ok(otherModel.request, "preparation is data only, not a credential/model grant");
  noPartial(await f.executor.execute(otherModel.request, null, lease));
  assert.equal(connections.isChatGPTSubscriptionAccess(lease, { ...f.expected, modelId: "another-plan-model" }), false);
  assert.equal(connections.isChatGPTSubscriptionAccess(lease, { ...f.expected, registration: { ...f.registration, clientId: "oaiapp_other" } }), false);
  assert.equal(f.posts(), 0);
});

test("subscription executor rejects expired preparation and another executor configuration", async (t) => {
  const f = await fixture(t);
  const expired = api.createChatGPTPlanPatchExecutor(f.configuration, async () => { throw Error("Unexpected provider"); }, () => NOW + 60_001);
  assert.equal(expired.prepare(f.rawInvocation, f.context, f.intent, f.ownerUserId).verdict, "deny");
  assert.throws(() => api.createChatGPTPlanPatchExecutor({ ...f.configuration, identity: { id: "openai-agents", version: "v1" } }));
  assert.equal(f.posts(), 0); assert.equal(f.counters.tokenReads, 0);
});

test("subscription router accepts only private factual connection provenance, never copied/caller-made facts", async (t) => {
  const f = await fixture(t);
  for (const value of [null, undefined, {}, structuredClone(f.facts), { ...f.facts }, { ...f.facts, planUsageGranted: true, selectedModel: "arbitrary" }]) {
    assert.equal(composition.createAI044SubscriptionRouter(value), null);
  }
  const router = composition.createAI044SubscriptionRouter(f.facts); assert.ok(router);
  const a = router.select(routeInput(f.configuration)), b = router.select(routeInput(f.configuration));
  assert.deepEqual(a, b); assert.equal(a.verdict, "allow");
  assert.equal(a.selectedRoute?.executor.id, "chatgpt-plan-patch"); assert.equal(a.selectedRoute?.accessMode, "subscription_session");
  assert.equal(a.selectedRoute?.environment.kind, "patch_proposal_only"); assert.equal(a.dispatchAuthorized, false); assert.equal(a.runtimeDispatchAllowed, false);
  assert.equal(f.counters.tokenReads, 0); assert.equal(f.posts(), 0);
});

test("subscription router rejects missing grants, no selected model, signed-out and corrupt protected metadata", async (t) => {
  const f = await createSubscriptionTestConnection({ now: () => NOW }); t.after(f.cleanup);
  const current = await f.store.readRegistrations(), r = current.registrations[0];
  for (const change of [{ grantedScopes: ["openid"] }, { selectedModel: null },
    { status: "signed_out" as const, idToken: null, accessToken: null, refreshToken: null, accessTokenExpiresAt: null, earliestRefreshAt: null, grantedScopes: [] }]) {
    await f.store.writeRegistrations({ ...current, registrations: [{ ...r, ...change }] });
    assert.equal(composition.createAI044SubscriptionRouter(await f.connection.readSubscriptionFacts()), null);
  }
  await writeFile(join(f.directory, "subscription-facts.json"), "{malformed");
  assert.equal(composition.createAI044SubscriptionRouter(await f.connection.readSubscriptionFacts()), null);
  assert.equal(f.counters.tokenReads, 0); assert.equal(f.counters.refreshCalls, 0);
});
