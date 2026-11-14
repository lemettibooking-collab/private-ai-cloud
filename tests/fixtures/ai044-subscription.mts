// Isolated, synthetic Phase S infrastructure. Never reads the default credential directory, real Git
// checkout, credentials, network or provider. Private production receipts are issued through their
// actual implementations; this fixture contains no start/approval capability issuer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubscriptionIntent, SubscriptionRegistration } from "../../lib/executors/ai044-subscription-intent";
import type { StoredRegistration } from "../../lib/integrations/chatgpt/chatgpt-credential-store";
import type { ExecutorAdapterConfiguration } from "../../lib/contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionConfiguration, subscriptionIntent } from "./ai044-subscription-approval.mts";
export { subscriptionConfiguration };
const intentApi = await import(new URL("../../lib/executors/ai044-subscription-intent.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-subscription-intent");
const contextApi = await import(new URL("../../lib/executors/ai044-subscription-context.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-subscription-context");
const contracts = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const common = await import(new URL("../../lib/executors/ai044-proof-binding.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-proof-binding");
const credentials = await import(new URL("../../lib/integrations/chatgpt/chatgpt-credential-store.ts", import.meta.url).href) as typeof import("../../lib/integrations/chatgpt/chatgpt-credential-store");
const connections = await import(new URL("../../lib/integrations/chatgpt/chatgpt-connection.ts", import.meta.url).href) as typeof import("../../lib/integrations/chatgpt/chatgpt-connection");
const { chatgptOAuth } = await import(new URL("../../lib/integrations/chatgpt/chatgpt-oauth.ts", import.meta.url).href) as typeof import("../../lib/integrations/chatgpt/chatgpt-oauth");

export const subscriptionTestOwner = "00000000-0000-4000-8000-000000009001";
export const subscriptionTestModel = "test-plan-model";
export const subscriptionTestPath = "src/server/terminal/account/analytics.ts";
export const subscriptionTestText = "export const analytics = 1;\n";

export function subscriptionInvocation(number = 1, runId = "subscription-run", invocationId = "subscription-invocation") {
  const c = subscriptionConfiguration(number, runId);
  return { schemaVersion: 1, invocationId, identity: c.identity, planId: c.developmentRun.planId, taskId: c.developmentRun.taskId,
    repository: c.repository, capability: "coding", mode: "patch_proposal", attempt: { developmentRunId: runId, number, kind: number === 1 ? "initial" : "corrective" } };
}

export function subscriptionPreflight(registration: SubscriptionRegistration, now: number, receiptId = "manual-receipt") {
  return { receiptId, observedAt: now, expiresAt: now + 60_000, appLimitPercent: 50, creditsEnabled: false as const,
    automaticPurchaseReliedUpon: false as const, registrationFingerprint: intentApi.subscriptionRegistrationFingerprint(registration) };
}

export function subscriptionContextSource(text = subscriptionTestText, repository = { id: "smart-algorithms", baseline: common.ai044Baseline }) {
  const requests: unknown[] = [];
  const port: import("../../lib/executors/ai044-subscription-context").AI044ExactObjectPort = { async readExactObject(input) {
    assert.equal(input.repositoryId, repository.id);
    assert.equal(input.baseline, repository.baseline);
    assert.equal(input.path, subscriptionTestPath);
    requests.push(structuredClone(input));
    const bytes = Buffer.from(text, "utf8");
    return { kind: "blob", mode: "100644", blobId: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), bytes };
  } };
  const source = contextApi.createAI044SubscriptionContextSource(port);
  return { port, source, requests };
}

export function subscriptionContextBinding(intent: SubscriptionIntent) {
  return { repository: intent.repository, projectTaskId: intent.projectTaskId, planId: intent.planId,
    planRevision: intent.planRevision, planFingerprint: intent.planFingerprint, taskId: intent.taskId, attempt: intent.attempt, allowedWritePaths: intent.allowedWritePaths, readContextPaths: intent.readContextPaths };
}

export function subscriptionProposal() {
  return { patch: `diff --git a/${subscriptionTestPath} b/${subscriptionTestPath}\n--- a/${subscriptionTestPath}\n+++ b/${subscriptionTestPath}\n@@ -1 +1 @@\n-export const analytics = 1;\n+export const analytics = 2;\n`,
    changedPaths: [subscriptionTestPath], summary: "Bounded analytics patch proposal; independent local verification remains required." };
}

export async function createSubscriptionTestConnection(options: Readonly<{
  ownerUserId?: string; workspaceId?: string; modelId?: string; now?: () => number; ownerAllowed?: () => boolean;
}> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pac-ai044-subscription-fixture-"));
  const store = credentials.createChatGPTCredentialStore({ directory });
  const now = options.now ?? Date.now;
  const clientId = "oaiapp_subscription_fixture", subject = "validated-fake-subscription-subject";
  const registration: SubscriptionRegistration = Object.freeze({ label: connections.registrationLabel(clientId, subject), clientId,
    subjectHash: createHash("sha256").update(subject).digest("hex") });
  const ownerUserId = options.ownerUserId ?? subscriptionTestOwner, domainWorkspaceId = options.workspaceId ?? "workspace-primary";
  const modelId = options.modelId ?? subscriptionTestModel;
  const value: StoredRegistration = {
    label: registration.label, clientId, subject, email: null, hostId: "urn:uuid:00000000-0000-4000-8000-000000009003",
    idToken: "SYNTHETIC_ID_TOKEN", accessToken: "SYNTHETIC_SUBSCRIPTION_ACCESS", refreshToken: "SYNTHETIC_SUBSCRIPTION_REFRESH",
    accessTokenExpiresAt: new Date(now() + 3_600_000).toISOString(), earliestRefreshAt: null,
    grantedScopes: ["openid", "offline_access", "chatgpt.tokens.use.direct"], status: "active", savedAt: new Date(now()).toISOString(),
    selectedModel: modelId, availableModels: [{ slug: modelId, displayName: "Synthetic selected plan model" }], modelsCheckedAt: new Date(now()).toISOString(),
  };
  // Test setup models an already validated OAuth callback. Production only supplies this Owner binding
  // from persistConnection after existing signature/subject/client/Owner validation.
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [value] }, { registration, ownerUserId, domainWorkspaceId });
  const counters = { tokenReads: 0, refreshCalls: 0, ownerChecks: 0 };
  const connection = connections.createChatGPTConnection({
    store: { ...store, async readRegistrations() { counters.tokenReads++; return store.readRegistrations(); } }, callbackPort: 3000,
    now: () => new Date(now()), ownerAuthority: { async verify(input) {
      counters.ownerChecks++;
      return input.ownerUserId === ownerUserId && input.domainWorkspaceId === domainWorkspaceId && (options.ownerAllowed?.() ?? true);
    } }, fetch: async (url) => {
      assert.equal(url, chatgptOAuth.tokenEndpoint, "only a controlled in-process fake refresh is available");
      counters.refreshCalls++;
      return Response.json({ access_token: `SYNTHETIC_SUBSCRIPTION_ACCESS_${counters.refreshCalls}`, refresh_token: `SYNTHETIC_SUBSCRIPTION_REFRESH_${counters.refreshCalls}`,
        token_type: "Bearer", expires_in: 3600, scope: "openid offline_access chatgpt.tokens.use.direct" });
    },
  });
  const facts = await connection.readSubscriptionFacts(); assert.ok(facts);
  assert.equal(counters.tokenReads, 0);
  return { directory, store, connection, facts, registration, modelId, ownerUserId, domainWorkspaceId, counters,
    expected: { registration, ownerUserId, domainWorkspaceId, modelId }, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

export async function createSubscriptionFixture(options: Readonly<{
  now?: () => number; ownerUserId?: string; intent?: SubscriptionIntent; configuration?: ReturnType<typeof subscriptionConfiguration> | ExecutorAdapterConfiguration;
}> = {}) {
  const now = options.now ?? Date.now;
  const configuration = (options.configuration ?? subscriptionConfiguration()) as ExecutorAdapterConfiguration;
  const original = options.intent ?? intentApi.normalizeSubscriptionIntent(subscriptionIntent(now()));
  assert.ok(original);
  const local = await createSubscriptionTestConnection({ ownerUserId: options.ownerUserId, workspaceId: original.workspaceId, modelId: original.model, now });
  try {
    const observedAt = now();
    const preliminary = intentApi.normalizeSubscriptionIntent({ ...original, registration: local.registration,
      preflight: subscriptionPreflight(local.registration, observedAt), expiresAt: observedAt + 60_000 });
    assert.ok(preliminary);
    const reader = subscriptionContextSource(subscriptionTestText, preliminary.repository);
    const prepared = await reader.source.prepare(subscriptionContextBinding(preliminary), [subscriptionTestPath]);
    assert.equal(prepared.verdict, "allow"); assert.ok(prepared.context);
    const intent = intentApi.normalizeSubscriptionIntent({ ...preliminary, contextFingerprint: prepared.context.fingerprint }); assert.ok(intent);
    const rawInvocation = { ...subscriptionInvocation(configuration.developmentRun.currentAttemptNumber, configuration.developmentRun.id, intent.invocationId),
      planId: intent.planId, taskId: intent.taskId, repository: intent.repository };
    const contract = contracts.createExecutorAdapterContract(configuration); assert.ok(contract.adapter);
    const decision = contract.adapter.validateInvocation(rawInvocation); assert.equal(decision.verdict, "allow"); assert.ok(decision.normalizedInvocation);
    return { ...local, configuration, intent, invocation: decision.normalizedInvocation, rawInvocation, context: prepared.context,
      contextSource: reader.port, preparedContextSource: reader.source, objectReads: reader.requests, proposal: subscriptionProposal(), preflight: intent.preflight };
  } catch (error) { await local.cleanup(); throw error; }
}
