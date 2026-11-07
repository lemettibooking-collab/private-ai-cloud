import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const policy = await import(new URL("../lib/integrations/openai-api/openai-api-policy.ts", import.meta.url).href) as typeof import("../lib/integrations/openai-api/openai-api-policy");
const stores = await import(new URL("../lib/integrations/openai-api/openai-api-credential-store.ts", import.meta.url).href) as typeof import("../lib/integrations/openai-api/openai-api-credential-store");
const access = await import(new URL("../lib/integrations/openai-api/openai-api-access.ts", import.meta.url).href) as typeof import("../lib/integrations/openai-api/openai-api-access");
const OWNER = { ownerUserId: "00000000-0000-4000-8000-000000009001", domainWorkspaceId: "workspace-primary" };
const KEY = "sk-FAKE_ONLY_NOT_A_CREDENTIAL_00000001";
const limits = { model: "gpt-test-2026-10-01", maxContextBytes: 10000, maxInputTokens: 8000, maxOutputTokens: 2000, maxInvocationCostUsdMicros: 100000, dailyBudgetUsdMicros: 1000000 };
const NOW = Date.parse("2026-10-28T12:00:00Z");
const price = { model: limits.model, inputUsdMicrosPerMillionTokens: 1000000, outputUsdMicrosPerMillionTokens: 5000000,
  verifiedAt: NOW - 60000, expiresAt: NOW + 60000, source: "https://developers.openai.com/api/docs/pricing" };
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Owner saves once: only safe metadata is returned, no provider or database dependency", async t => {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "pac-api-access-")));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = stores.createOpenAIApiCredentialStore(join(directory, "api"));
  const app = access.createOpenAIApiAccess({ store, owner: async () => OWNER });
  assert.equal((await app.status()).state, "not_connected");
  assert.equal(await app.connect(KEY, limits), "saved");
  assert.deepEqual(await app.status(), { state: "connected", limits, executionAvailable: false });
  assert.ok(!JSON.stringify(await app.status()).includes(KEY));
  assert.equal((await fs.stat(join(directory, "api"))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(directory, "api", "credential.json"))).mode & 0o777, 0o600);
  const facts = (await store.facts(OWNER))!;
  assert.deepEqual(Object.keys(facts).sort(), ["generation", "limits"]);
  assert.equal(await store.withKey(OWNER, facts.generation, async key => key === KEY), true);
  assert.equal(await app.configure({ ...limits, maxOutputTokens: 1000 }), "saved");
  await assert.rejects(store.withKey(OWNER, facts.generation, async () => assert.fail("stale receipt")), /openai_api_store_unavailable/u);
  assert.equal(await app.disconnect(), "saved");
  assert.equal((await app.status()).state, "not_connected");
  for (const name of ["openai-api-access", "openai-api-credential-store"]) {
    const text = source(`lib/integrations/openai-api/${name}.ts`);
    assert.doesNotMatch(text, /console\.|fetch\(|\.query\(|process\.env|OPENAI_API_KEY/u);
  }
});

for (const operation of ["status", "connect", "configure", "disconnect"] as const) {
  test(`non-Owner ${operation}: zero credential reads/writes`, async () => {
    let calls = 0;
    const forbidden = async () => { calls++; throw new Error(KEY); };
    const store = { facts: forbidden, save: forbidden, configure: forbidden, disconnect: forbidden, withKey: forbidden } as unknown as import("../lib/integrations/openai-api/openai-api-credential-store").OpenAIApiCredentialStore;
    const app = access.createOpenAIApiAccess({ store, owner: async () => null });
    const result = operation === "connect" ? await app.connect(KEY, limits) : operation === "configure" ? await app.configure(limits) : await app[operation]();
    assert.equal(calls, 0); assert.ok(!JSON.stringify(result).includes(KEY));
    if (operation !== "status") assert.equal(result, "denied");
  });
}

test("key replacement changes generation; cross-Owner/workspace use fails closed", async t => {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "pac-api-access-"))); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = stores.createOpenAIApiCredentialStore(join(directory, "api"));
  await store.save(OWNER, KEY, limits); const before = (await store.facts(OWNER))!;
  await store.save(OWNER, `${KEY}2`, limits); const after = (await store.facts(OWNER))!;
  assert.notEqual(before.generation, after.generation);
  for (const other of [{ ...OWNER, domainWorkspaceId: "workspace-other" }, { ...OWNER, ownerUserId: "00000000-0000-4000-8000-000000009002" }]) {
    await assert.rejects(store.facts(other)); await assert.rejects(store.save(other, KEY, limits));
    assert.equal(await store.disconnect(other), false);
    await assert.rejects(store.withKey(other, after.generation, async () => assert.fail("cross binding")));
  }
  assert.equal(await store.withKey(OWNER, after.generation, async key => key === `${KEY}2`), true);
});

test("lock never automatically stolen; configuration serialized against key use", async t => {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "pac-api-access-"))); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = join(directory, "api"), store = stores.createOpenAIApiCredentialStore(root);
  await store.save(OWNER, KEY, limits); const facts = (await store.facts(OWNER))!;
  await store.withKey(OWNER, facts.generation, async () => {
    await assert.rejects(store.disconnect(OWNER));
    await assert.rejects(store.configure(OWNER, limits));
    await assert.rejects(stores.createOpenAIApiCredentialStore(root).save(OWNER, `${KEY}2`, limits));
  });
  await fs.writeFile(join(root, "access.lock"), "unknown-crashed-owner", { mode: 0o600 });
  await fs.utimes(join(root, "access.lock"), new Date(0), new Date(0));
  await assert.rejects(store.facts(OWNER));
  assert.equal(await fs.readFile(join(root, "access.lock"), "utf8"), "unknown-crashed-owner");
});

test("replaced lock is not removed by an earlier owner", async t => {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "pac-api-access-"))); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = join(directory, "api"), store = stores.createOpenAIApiCredentialStore(root);
  await store.save(OWNER, KEY, limits); const facts = (await store.facts(OWNER))!;
  await store.withKey(OWNER, facts.generation, async () => {
    await fs.unlink(join(root, "access.lock")); await fs.writeFile(join(root, "access.lock"), "replacement", { mode: 0o600 });
  });
  assert.equal(await fs.readFile(join(root, "access.lock"), "utf8"), "replacement");
});

for (const attack of ["mode", "symlink-file", "symlink-directory", "oversize", "hardlink", "malformed"] as const) {
  test(`protected credential store denies ${attack}`, async t => {
    const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "pac-api-access-"))); t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const root = join(directory, "api"), store = stores.createOpenAIApiCredentialStore(root), path = join(root, "credential.json");
    await store.save(OWNER, KEY, limits);
    if (attack === "mode") await fs.chmod(path, 0o644);
    if (attack === "oversize") await fs.writeFile(path, "x".repeat(8193));
    if (attack === "malformed") await fs.writeFile(path, "{bad}");
    if (attack === "hardlink") await fs.link(path, join(directory, "linked"));
    if (attack === "symlink-file") { await fs.rename(path, join(root, "target")); await fs.symlink(join(root, "target"), path); }
    if (attack === "symlink-directory") { await fs.rename(root, join(directory, "target")); await fs.symlink(join(directory, "target"), root); }
    const app = access.createOpenAIApiAccess({ store, owner: async () => OWNER });
    assert.deepEqual(await app.status(), { state: "temporarily_unavailable", limits: null, executionAvailable: false });
  });
}

for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
  test(`mandatory ${key} cannot be omitted/zero/unknown`, () => {
    const omitted = { ...limits } as Record<string, unknown>; delete omitted[key];
    assert.equal(policy.normalizeOpenAIApiLimits(omitted), null);
    assert.equal(policy.normalizeOpenAIApiLimits({ ...limits, [key]: 0 }), null);
    assert.equal(policy.normalizeOpenAIApiLimits({ ...limits, [key]: "unknown" }), null);
  });
}
test("policy rejects getters/proxies, oversized budgets and extra properties", () => {
  assert.equal(policy.normalizeOpenAIApiLimits({ ...limits, key: KEY }), null);
  assert.equal(policy.normalizeOpenAIApiLimits({ ...limits, dailyBudgetUsdMicros: 1 }), null);
  assert.equal(policy.normalizeOpenAIApiLimits({ ...limits, maxOutputTokens: Number.MAX_SAFE_INTEGER }), null);
  assert.equal(policy.normalizeOpenAIApiLimits(new Proxy(limits, { ownKeys() { throw new Error(KEY); } })), null);
  assert.equal(policy.normalizeOpenAIApiLimits({ ...limits, get model() { throw new Error(KEY); } }), null);
});
test("finite conservative cost ceiling uses integer arithmetic and exact model pricing", () => {
  assert.deepEqual(policy.openAIApiMaximumCost(limits, price, 1234, NOW), { inputTokenCount: 1234, effectiveMaxOutputTokens: 2000, maximumCostUsdMicros: 11234 });
  assert.equal(policy.openAIApiMaximumCost(limits, { ...price, model: "other-2026-10-01" }, 1234, NOW), null);
  assert.equal(policy.openAIApiMaximumCost({ ...limits, maxInvocationCostUsdMicros: 11233 }, price, 1234, NOW), null);
  assert.deepEqual(policy.openAIApiMaximumCost(limits, { ...price, inputUsdMicrosPerMillionTokens: 1, outputUsdMicrosPerMillionTokens: 1 }, 1, NOW)?.maximumCostUsdMicros, 2);
});
for (const p of [null, { ...price, expiresAt: NOW }, { ...price, verifiedAt: NOW + 1 }, { ...price, expiresAt: NOW + 86400001 },
  { ...price, source: "https://untrusted.test" }, { ...price, model: "gpt-latest" }, { ...price, inputUsdMicrosPerMillionTokens: null }]) {
  test(`missing/stale/unknown pricing denies (${JSON.stringify(p)})`, () => assert.equal(policy.openAIApiMaximumCost(limits, p, 1234, NOW), null));
}
for (const count of [null, 0, -1, 8001, 1.5, "1234", Number.NaN]) {
  test(`invalid or over-budget native input count ${String(count)} denies`, () => assert.equal(policy.openAIApiMaximumCost(limits, price, count, NOW), null));
}
test("request configuration and pricing remain immutable and repeated decisions deterministic", () => {
  const original = structuredClone({ limits, price });
  const a = policy.openAIApiMaximumCost(limits, price, 1234, NOW), b = policy.openAIApiMaximumCost(limits, price, 1234, NOW);
  assert.deepEqual(a, b); assert.notEqual(a, b); assert.ok(Object.isFrozen(a)); assert.deepEqual({ limits, price }, original);
});
test("separate Settings card has no client state, inference action, fallback or key echo", () => {
  const card = source("components/domain/settings/openai-api-card.tsx"), actions = source("app/settings/integrations/openai-api-actions.ts");
  assert.doesNotMatch(card, /use client|useState|useActionState|defaultValue=\{[^}]*key|fetch\(/iu);
  assert.match(card, /type="password"/u); assert.match(card, /autoComplete="new-password"/u);
  assert.match(actions, /form\.delete\("apiKey"\)/u);
  assert.doesNotMatch(actions, /console\.|JSON\.stringify|invoke|execute|token_exchange|responses/u);
  assert.deepEqual([...actions.matchAll(/export async function (\w+)/gu)].map(m => m[1]), ["connectOpenAIApiAction", "configureOpenAIApiAction", "disconnectOpenAIApiAction"]);
  const composition = source("lib/composition/openai-api-access.server.ts");
  assert.match(composition, /^import "server-only"/u);
  assert.doesNotMatch(composition, /OPENAI_API_KEY|subscription_session|ChatGPTConnection|responses|fetch\(/u);
});
