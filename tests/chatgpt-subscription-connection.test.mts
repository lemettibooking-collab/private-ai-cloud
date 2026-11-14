import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const stores = await import(new URL("../lib/integrations/chatgpt/chatgpt-credential-store.ts", import.meta.url).href) as typeof import("../lib/integrations/chatgpt/chatgpt-credential-store");
const connections = await import(new URL("../lib/integrations/chatgpt/chatgpt-connection.ts", import.meta.url).href) as typeof import("../lib/integrations/chatgpt/chatgpt-connection");
const { chatgptOAuth } = await import(new URL("../lib/integrations/chatgpt/chatgpt-oauth.ts", import.meta.url).href) as typeof import("../lib/integrations/chatgpt/chatgpt-oauth");
const OWNER = "00000000-0000-4000-8000-000000009001";
const WORKSPACE = "workspace-primary";
const modelId = "selected-test-model";
const registration = {
  label: connections.registrationLabel("oaiapp_subscription_test", "validated-test-subject"),
  clientId: "oaiapp_subscription_test", subject: "validated-test-subject", email: null,
  hostId: "urn:uuid:00000000-0000-4000-8000-000000009003", idToken: "FAKE_ID_TOKEN",
  accessToken: "FAKE_ACCESS_TOKEN", refreshToken: "FAKE_REFRESH_TOKEN", accessTokenExpiresAt: "2026-10-26T13:00:00.000Z",
  earliestRefreshAt: null, grantedScopes: ["chatgpt.tokens.use.direct"], status: "active" as const,
  savedAt: "2026-10-26T12:00:00.000Z", selectedModel: modelId,
  availableModels: [{ slug: modelId, displayName: "Test model" }], modelsCheckedAt: "2026-10-26T12:00:00.000Z",
};
const binding = {
  registration: { label: registration.label, clientId: registration.clientId, subjectHash: createHash("sha256").update(registration.subject).digest("hex") },
  ownerUserId: OWNER, domainWorkspaceId: WORKSPACE,
};

async function fixture(t: test.TestContext) {
  const directory = await fs.mkdtemp(join(tmpdir(), "pac-subscription-metadata-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = stores.createChatGPTCredentialStore({ directory });
  return { directory, store };
}

test("subscription facts: legacy credentials do not invent an Owner binding", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] });
  assert.equal(await store.readSubscriptionFacts(), null);
});

test("subscription facts: protected metadata is detached, frozen, branded and readable without token file", async (t) => {
  const { directory, store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  await fs.rename(join(directory, "registrations.json"), join(directory, "registrations-unavailable.json"));
  const first = await store.readSubscriptionFacts();
  const second = await store.readSubscriptionFacts();
  assert.ok(first);
  assert.deepEqual(first, { ...binding, status: "active", planUsageGranted: true, selectedModel: modelId });
  assert.notEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.registration));
  assert.equal(stores.isChatGPTSubscriptionFacts(first), true);
  assert.equal(stores.isChatGPTSubscriptionFacts(structuredClone(first)), false);
  const bytes = await fs.readFile(join(directory, "subscription-facts.json"), "utf8");
  for (const secret of [registration.accessToken, registration.refreshToken, registration.idToken, registration.subject]) assert.ok(!bytes.includes(secret));
  assert.equal((await fs.stat(join(directory, "subscription-facts.json"))).mode & 0o777, 0o600);
});

test("subscription access: exact registration/Owner/workspace/model only, without stale metadata fallback", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  let reads = 0;
  const connection = connections.createChatGPTConnection({
    store: { ...store, async readRegistrations() { reads++; return store.readRegistrations(); } },
    fetch: async () => { throw new Error("Unexpected network"); }, callbackPort: 3000,
    ownerAuthority: { async verify() { return true; } }, now: () => new Date("2026-10-26T12:00:00.000Z"),
  });
  assert.ok(await connection.readSubscriptionFacts());
  assert.equal(reads, 0);
  const expected = { ...binding, modelId };
  const lease = await connection.subscriptionAccessToken(expected);
  assert.deepEqual(lease, { ok: true, kind: "chatgpt_subscription_access" });
  assert.equal(connections.isChatGPTSubscriptionAccess(lease, expected), true);
  assert.equal(connections.isChatGPTSubscriptionAccess(structuredClone(lease), expected), false);
  assert.equal(connections.useChatGPTSubscriptionAccess({ ok: true, token: "API_KEY" }, expected), null);
  assert.equal(connections.useChatGPTSubscriptionAccess(lease, expected), registration.accessToken);
  assert.equal(connections.useChatGPTSubscriptionAccess(lease, expected), null);
  for (const changed of [
    { ...expected, ownerUserId: "00000000-0000-4000-8000-000000009009" },
    { ...expected, domainWorkspaceId: "workspace-other" },
    { ...expected, modelId: "another-model" },
    { ...expected, registration: { ...binding.registration, clientId: "oaiapp_other" } },
    { ...expected, registration: { ...binding.registration, subjectHash: "a".repeat(64) } },
  ]) assert.equal((await connection.subscriptionAccessToken(changed)).ok, false);
});

test("subscription access: active credentials without direct grant are denied even before expiry", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [{ ...registration, grantedScopes: ["openid"] }] }, binding);
  const connection = connections.createChatGPTConnection({
    store, fetch: async () => { throw new Error("Unexpected network"); }, callbackPort: 3000,
    ownerAuthority: { async verify() { return true; } }, now: () => new Date("2026-10-26T12:00:00.000Z"),
  });
  assert.deepEqual(await connection.accessToken(), { ok: false, reason: "plan_usage_missing" });
  assert.equal((await connection.subscriptionAccessToken({ ...binding, modelId })).ok, false);
});

test("subscription facts: validated OAuth callback binds the exact PAC Owner and issued registration; selection and sign-out update metadata", async (t) => {
  const { store } = await fixture(t);
  const keys = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await exportJWK(keys.publicKey), kid: "subscription-test", alg: "RS256", use: "sig" };
  let nonce = "";
  const calls: string[] = [];
  const connection = connections.createChatGPTConnection({
    store, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"),
    ownerAuthority: { async verify(input) { return input.ownerUserId === OWNER && input.domainWorkspaceId === WORKSPACE; } },
    fetch: async (url) => {
      calls.push(url);
      if (url === chatgptOAuth.jwksUri) return Response.json({ keys: [jwk] });
      if (url === chatgptOAuth.revocationEndpoint) return new Response(null, { status: 200 });
      if (url === chatgptOAuth.modelsEndpoint) return Response.json({ models: [{ slug: modelId, display_name: "Selected model", visibility: "list" }] });
      assert.equal(url, chatgptOAuth.tokenEndpoint);
      const idToken = await new SignJWT({ nonce }).setProtectedHeader({ alg: "RS256", kid: "subscription-test" })
        .setIssuer("https://auth.openai.com").setAudience(registration.clientId).setSubject(registration.subject)
        .setIssuedAt(Date.parse("2026-10-26T12:00:00.000Z") / 1000).setExpirationTime(Date.parse("2026-10-26T13:00:00.000Z") / 1000).sign(keys.privateKey);
      return Response.json({ access_token: registration.accessToken, refresh_token: registration.refreshToken, id_token: idToken,
        token_type: "Bearer", expires_in: 3600, scope: "openid offline_access chatgpt.tokens.use.direct" });
    },
  });
  const start = await connection.start({ ownerUserId: OWNER, domainWorkspaceId: WORKSPACE, returnOrigin: "http://localhost:3000" });
  assert.equal(start.status, "redirect");
  if (start.status !== "redirect") return;
  const url = new URL(start.url);
  nonce = url.searchParams.get("nonce")!;
  const callback = new URL("http://127.0.0.1:3000/integrations/chatgpt/callback");
  callback.search = new URLSearchParams({ code: "fake-code", state: url.searchParams.get("state")!, client_id: registration.clientId }).toString();
  assert.equal((await connection.complete(callback)).outcome, "connected");
  assert.deepEqual(await connection.readSubscriptionFacts(), { ...binding, status: "active", planUsageGranted: true, selectedModel: null });
  assert.equal(await connection.refreshModels(), "updated");
  assert.equal(await connection.selectModel(modelId), "selected");
  assert.equal((await connection.readSubscriptionFacts())?.selectedModel, modelId);
  assert.equal((await connection.disconnect()).status, "disconnected");
  assert.deepEqual(await connection.readSubscriptionFacts(), { ...binding, status: "signed_out", planUsageGranted: false, selectedModel: modelId });
  assert.equal((await connection.subscriptionAccessToken({ ...binding, modelId })).ok, false);
  assert.ok(!calls.some((url) => url.includes("/responses")), "no inference");
});

test("subscription metadata: missing, malformed, overly permissive or symlink files fail closed without credential fallback", async (t) => {
  const { directory, store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  const path = join(directory, "subscription-facts.json");
  await fs.writeFile(path, "{malformed", { mode: 0o600 });
  assert.equal(await store.readSubscriptionFacts(), null);
  await fs.writeFile(path, JSON.stringify({ version: 1, active: registration.label, registrations: [{ ...binding, status: "active", planUsageGranted: true, selectedModel: modelId, token: "forbidden" }] }));
  assert.equal(await store.readSubscriptionFacts(), null);
  await fs.unlink(path);
  assert.equal(await store.readSubscriptionFacts(), null);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  await fs.chmod(path, 0o644);
  assert.equal(await store.readSubscriptionFacts(), null);
  await fs.unlink(path);
  await fs.symlink(join(directory, "registrations.json"), path);
  assert.equal(await store.readSubscriptionFacts(), null);
});

test("subscription access: revoked PAC Owner is checked before token-file read", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  let reads = 0;
  const connection = connections.createChatGPTConnection({
    store: { ...store, async readRegistrations() { reads++; return store.readRegistrations(); } },
    callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"),
    fetch: async () => { throw new Error("Unexpected network"); }, ownerAuthority: { async verify() { return false; } },
  });
  assert.equal((await connection.subscriptionAccessToken({ ...binding, modelId })).ok, false);
  assert.equal(reads, 0);
});

test("subscription access: stale metadata cannot override a different factual registration or selected model", async (t) => {
  const { directory, store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  const connection = connections.createChatGPTConnection({
    store, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"),
    fetch: async () => { throw new Error("Unexpected network"); }, ownerAuthority: { async verify() { return true; } },
  });
  const original = await fs.readFile(join(directory, "registrations.json"), "utf8");
  for (const changed of [{ ...registration, selectedModel: "another-model" }, { ...registration, subject: "another-subject" }, { ...registration, clientId: "oaiapp_another" }, { ...registration, grantedScopes: ["openid"] }]) {
    await fs.writeFile(join(directory, "registrations.json"), JSON.stringify({ version: 1, active: registration.label, registrations: [changed] }));
    assert.equal((await connection.subscriptionAccessToken({ ...binding, modelId })).ok, false);
  }
  await fs.writeFile(join(directory, "registrations.json"), original);
});

test("subscription access: rotation is shared and serialized; lease is one-use and expires on trusted time", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [{ ...registration, accessTokenExpiresAt: "2026-10-26T12:00:30.000Z" }] }, binding);
  let clock = Date.parse("2026-10-26T12:00:00.000Z"), refreshes = 0;
  const connection = connections.createChatGPTConnection({
    store, callbackPort: 3000, now: () => new Date(clock), ownerAuthority: { async verify() { return true; } },
    fetch: async (url) => {
      assert.equal(url, chatgptOAuth.tokenEndpoint);
      refreshes++;
      return Response.json({ access_token: "FAKE_ROTATED_ACCESS", refresh_token: "FAKE_ROTATED_REFRESH", token_type: "Bearer", expires_in: 3600, scope: "openid offline_access chatgpt.tokens.use.direct" });
    },
  });
  const expected = { ...binding, modelId };
  const [first, second] = await Promise.all([connection.subscriptionAccessToken(expected), connection.subscriptionAccessToken(expected)]);
  assert.equal(refreshes, 1);
  assert.equal(connections.useChatGPTSubscriptionAccess(first, expected), "FAKE_ROTATED_ACCESS");
  clock += 60_001;
  assert.equal(connections.isChatGPTSubscriptionAccess(second, expected), false);
  assert.equal(connections.useChatGPTSubscriptionAccess(second, expected), null);
  assert.equal((await store.readRegistrations()).registrations[0].refreshToken, "FAKE_ROTATED_REFRESH");
  assert.equal((await store.readSubscriptionFacts())?.planUsageGranted, true);
});

test("subscription access: terminal refresh loss invalidates metadata and cannot return a token lease", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [{ ...registration, accessTokenExpiresAt: "2026-10-26T11:00:00.000Z" }] }, binding);
  const connection = connections.createChatGPTConnection({
    store, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"), ownerAuthority: { async verify() { return true; } },
    fetch: async () => Response.json({ error: "refresh_token_reused" }, { status: 400 }),
  });
  assert.deepEqual(await connection.subscriptionAccessToken({ ...binding, modelId }), { ok: false, reason: "reauthorization_required" });
  assert.equal((await store.readSubscriptionFacts())?.status, "reauthorization_required");
  assert.equal((await store.readSubscriptionFacts())?.planUsageGranted, false);
  assert.equal((await store.readRegistrations()).registrations[0].accessToken, null);
});

test("subscription metadata: a failed credential replacement leaves facts unavailable, never stale Owner authority", async (t) => {
  const { directory, store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  await fs.rename(join(directory, "registrations.json"), join(directory, "saved-registrations.json"));
  await fs.mkdir(join(directory, "registrations.json")); // The token rename must fail after fact invalidation.
  await assert.rejects(store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, { ...binding, domainWorkspaceId: "workspace-other" }));
  assert.equal(await store.readSubscriptionFacts(), null);
});

test("subscription metadata: ordinary writes never carry an Owner mapping across a different registration identity", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [{ ...registration, clientId: "oaiapp_other_registration" }] });
  assert.equal(await store.readSubscriptionFacts(), null);
});

test("subscription lease: caller mutation during Owner await cannot redirect a validated token binding", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  const expected = structuredClone({ ...binding, modelId });
  const connection = connections.createChatGPTConnection({
    store, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"), fetch: async () => { throw new Error("Unexpected network"); },
    ownerAuthority: { async verify() { expected.modelId = "changed-after-validation"; return true; } },
  });
  const lease = await connection.subscriptionAccessToken(expected);
  assert.equal(connections.isChatGPTSubscriptionAccess(lease, expected), false);
  assert.equal(connections.useChatGPTSubscriptionAccess(lease, { ...binding, modelId }), registration.accessToken);
  const throwing = Object.defineProperty({}, "registration", { get() { throw new Error("unsafe input"); } });
  assert.equal((await connection.subscriptionAccessToken(throwing as typeof expected)).ok, false);
});

test("subscription metadata corruption never prevents disconnect from clearing all token material", async (t) => {
  const { directory, store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  await fs.writeFile(join(directory, "subscription-facts.json"), "{malformed");
  const connection = connections.createChatGPTConnection({
    store, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"), ownerAuthority: { async verify() { return true; } },
    fetch: async () => new Response(null, { status: 200 }),
  });
  assert.equal((await connection.disconnect()).status, "disconnected");
  const cleared = (await store.readRegistrations()).registrations[0];
  assert.deepEqual([cleared.status, cleared.accessToken, cleared.refreshToken, cleared.idToken], ["signed_out", null, null, null]);
  assert.equal(await store.readSubscriptionFacts(), null);
});

test("subscription dispatch: an unlocked lease cannot authorize execution after committed disconnect", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  const connection = connections.createChatGPTConnection({ store, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"),
    ownerAuthority: { async verify() { return true; } }, fetch: async () => new Response(null, { status: 200 }) });
  const expected = { ...binding, modelId }, lease = await connection.subscriptionAccessToken(expected);
  await connection.disconnect();
  assert.equal(connections.isChatGPTSubscriptionDispatchAccess(lease, expected), false, "a credential receipt alone is not a locked dispatch lease");
  assert.equal(connections.consumeChatGPTSubscriptionDispatchAccess(lease, expected), null);
  let calls = 0;
  const result = await connection.withSubscriptionAccess(expected, async () => { calls++; return { pending: Promise.resolve("provider") }; });
  assert.equal(result.ok, false); assert.equal(calls, 0);
});

test("subscription dispatch: existing refresh.lock covers fence and synchronous initiation, not provider stream await", async (t) => {
  const { directory, store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  const make = (s: typeof store) => connections.createChatGPTConnection({ store: s, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"),
    ownerAuthority: { async verify() { return true; } }, fetch: async () => new Response(null, { status: 200 }) });
  const connection = make(store), other = make(stores.createChatGPTCredentialStore({ directory, lockTiming: { waitMs: 1000, pollMs: 10 } }));
  let entered!: () => void, release!: () => void, complete!: () => void;
  const inside = new Promise<void>(resolve => { entered = resolve; }), fence = new Promise<void>(resolve => { release = resolve; });
  const stream = new Promise<void>(resolve => { complete = resolve; });
  const expected = { ...binding, modelId }; let posts = 0, saved: unknown, disconnected = false;
  const started = connection.withSubscriptionAccess(expected, async access => {
    saved = access; assert.equal(connections.isChatGPTSubscriptionDispatchAccess(access, expected), true); entered();
    await fence;
    assert.equal(connections.consumeChatGPTSubscriptionDispatchAccess(access, expected), registration.accessToken);
    posts++; // Synchronous controlled provider initiation, before the first provider await.
    return { pending: stream.then(() => "completed") };
  });
  await inside;
  const disconnect = other.disconnect().then(result => { disconnected = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(disconnected, false); assert.equal(posts, 0); assert.equal((await store.readRegistrations()).registrations[0].status, "active");
  release();
  const result = await started; assert.equal(result.ok, true); assert.equal(posts, 1);
  assert.equal((await disconnect).status, "disconnected", "lock is released even though provider stream is still pending");
  assert.equal(connections.isChatGPTSubscriptionDispatchAccess(saved, expected), false);
  complete(); if (result.ok) assert.equal(await result.pending, "completed");
});

test("subscription dispatch: model change before the lock is denied; escaped callback receipts lose dispatch validity", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [{ ...registration, availableModels: [...registration.availableModels, { slug: "other-model", displayName: "Other" }] }] }, binding);
  const connection = connections.createChatGPTConnection({ store, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"),
    ownerAuthority: { async verify() { return true; } }, fetch: async () => { throw Error("no network"); } });
  assert.equal(await connection.selectModel("other-model"), "selected");
  let calls = 0;
  assert.equal((await connection.withSubscriptionAccess({ ...binding, modelId }, async () => { calls++; return { pending: Promise.resolve(1) }; })).ok, false);
  assert.equal(calls, 0);
  assert.equal(await connection.selectModel(modelId), "selected");
  let escaped: unknown;
  const result = await connection.withSubscriptionAccess({ ...binding, modelId }, async lease => { escaped = lease; return { pending: Promise.resolve(1) }; });
  assert.equal(result.ok, true);
  assert.equal(connections.isChatGPTSubscriptionDispatchAccess(escaped, { ...binding, modelId }), false);
});

test("subscription dispatch: another store instance cannot commit model selection until synchronous initiation releases refresh.lock", async (t) => {
  const { directory, store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [{ ...registration, availableModels: [...registration.availableModels, { slug: "other-model", displayName: "Other" }] }] }, binding);
  const make = (s: typeof store) => connections.createChatGPTConnection({ store: s, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"),
    ownerAuthority: { async verify() { return true; } }, fetch: async () => { throw Error("No network"); } });
  const a = make(store), b = make(stores.createChatGPTCredentialStore({ directory, lockTiming: { waitMs: 1000, pollMs: 10 } }));
  let enter!: () => void, release!: () => void, complete!: () => void, selected = false, posts = 0;
  const entered = new Promise<void>(r => { enter = r; }), fence = new Promise<void>(r => { release = r; }), stream = new Promise<void>(r => { complete = r; });
  const started = a.withSubscriptionAccess({ ...binding, modelId }, async access => {
    enter(); await fence;
    assert.equal(connections.consumeChatGPTSubscriptionDispatchAccess(access, { ...binding, modelId }), registration.accessToken);
    posts++; return { pending: stream };
  });
  await entered;
  const selection = b.selectModel("other-model").then(d => { selected = true; return d; });
  await new Promise(r => setTimeout(r, 30)); assert.equal(selected, false); assert.equal(posts, 0);
  release(); const result = await started; assert.equal(result.ok, true); assert.equal(posts, 1);
  assert.equal(await selection, "selected"); assert.equal((await store.readSubscriptionFacts())?.selectedModel, "other-model");
  complete(); if (result.ok) await result.pending;
});

test("subscription dispatch: callback failure is opaque, invalidates the scoped lease and releases the existing lock", async (t) => {
  const { store } = await fixture(t);
  await store.writeRegistrations({ version: 1, active: registration.label, registrations: [registration] }, binding);
  const connection = connections.createChatGPTConnection({ store, callbackPort: 3000, now: () => new Date("2026-10-26T12:00:00.000Z"),
    ownerAuthority: { async verify() { return true; } }, fetch: async () => { throw Error("No network"); } });
  let escaped: unknown;
  const d = await connection.withSubscriptionAccess({ ...binding, modelId }, async access => { escaped = access; throw Error("RAW_PRIVATE_CALLBACK_FAILURE"); });
  assert.deepEqual(d, { ok: false, reason: "temporarily_unavailable" });
  assert.equal(connections.isChatGPTSubscriptionDispatchAccess(escaped, { ...binding, modelId }), false);
  assert.equal(await connection.selectModel(modelId), "selected");
});
