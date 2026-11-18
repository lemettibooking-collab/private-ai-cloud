// M2.0 Real Provider composition root: static fail-closed boundaries. No database and no network:
// a local TCP listener stands in for PostgreSQL only to PROVE that a denied composition never opens
// a database connection, and the OpenAI SDK client is a fake that counts construction and calls.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

const composition = (await import(
  new URL("../lib/composition/real-provider-runtime.ts", import.meta.url).href
)) as typeof import("../lib/composition/real-provider-runtime");

const fakeSecret = "FAKE_OPENAI_SECRET_DO_NOT_LEAK_composition_unit";
const fakeDbPassword = "FAKE_DB_PASSWORD_DO_NOT_LEAK_composition_unit";

function model(overrides: Record<string, unknown> = {}) {
  return {
    identity: {
      providerId: "provider-openai", providerKind: "openai", deploymentId: "deployment-openai-m2",
      providerModelId: "gpt-m2-alias", providerRequestModelId: "gpt-m2-pinned", providerModelVersion: "gpt-m2-pinned-2026-01-01",
    },
    maxInputTokens: 2_000,
    maxOutputTokens: 16,
    inputCostUsdMicrosPerMillionTokens: 150_000,
    outputCostUsdMicrosPerMillionTokens: 600_000,
    ...overrides,
  };
}

// Counts TCP connections so "no database contact" is observed, not assumed.
async function listener() {
  let connections = 0;
  const server = createServer((socket) => { connections += 1; socket.destroy(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `postgres://postgres:${fakeDbPassword}@127.0.0.1:${port}/m2_unit`,
    connections: () => connections,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function fakeSdk() {
  const calls = { clients: 0, generations: 0, counts: 0, options: [] as unknown[] };
  const createOpenAIClient = (options: unknown) => {
    calls.clients += 1;
    calls.options.push({ ...(options as object) });
    return {
      responses: {
        async create() { calls.generations += 1; throw new Error("no generation expected"); },
        inputTokens: { async count() { calls.counts += 1; throw new Error("no count expected"); } },
      },
      models: { async retrieve() { throw new Error("no model lookup expected"); } },
    };
  };
  return { calls, createOpenAIClient };
}

function input(url: string, sdk: ReturnType<typeof fakeSdk>, overrides: Record<string, unknown> = {}) {
  return {
    database: { connectionString: url },
    domainWorkspaceId: "workspace-primary",
    timing: { providerTimeoutMs: 20_000, claimLeaseDurationMs: 300_000 },
    openAI: model(),
    credentials: { apiKey: fakeSecret },
    authorizer: { authorize: () => false },
    requirementsResolver: { resolve: () => null },
    evidenceResolver: { resolve: async () => null },
    runtimeContext: { now: () => new Date().toISOString() },
    dependencies: { createOpenAIClient: sdk.createOpenAIClient },
    ...overrides,
  };
}

async function expectDenied(overrides: Record<string, unknown>, code: string, options: { clientBuilt?: boolean } = {}) {
  const db = await listener();
  const sdk = fakeSdk();
  try {
    const decision = await composition.composeRealProviderRuntime(input(db.url, sdk, overrides));
    assert.equal(decision.verdict, "deny");
    assert.equal(decision.runtime, null);
    assert.deepEqual(decision.reasons.map((reason) => reason.code), [code]);
    assert.equal(db.connections(), 0, "no database connection was attempted");
    assert.equal(sdk.calls.generations + sdk.calls.counts, 0, "no model call");
    if (options.clientBuilt === false) assert.equal(sdk.calls.clients, 0, "no OpenAI client was constructed");
    const serialized = JSON.stringify(decision);
    assert.equal(serialized.includes(fakeSecret), false);
    assert.equal(serialized.includes(fakeDbPassword), false);
    return decision;
  } finally {
    await db.close();
  }
}

test("M2.0 unsafe timing: timeout + 10 s margin above the claim lease → denied, no provider, no client, no DB", async () => {
  await expectDenied({ timing: { providerTimeoutMs: 25_000, claimLeaseDurationMs: 30_000 } }, "unsafe_provider_timing", { clientBuilt: false });
  await expectDenied({ timing: { providerTimeoutMs: 290_001, claimLeaseDurationMs: 300_000 } }, "unsafe_provider_timing", { clientBuilt: false });
});

test("M2.0 a claim lease the store cannot use (below 30 s or above 15 min) is denied before any client exists", async () => {
  await expectDenied({ timing: { providerTimeoutMs: 1, claimLeaseDurationMs: 29_999 } }, "unsafe_provider_timing", { clientBuilt: false });
  await expectDenied({ timing: { providerTimeoutMs: 20_000, claimLeaseDurationMs: 15 * 60 * 1_000 + 1 } }, "unsafe_provider_timing", { clientBuilt: false });
});

test("M2.0 timing inputs that are not an exact ordinary object fail closed", async () => {
  const getter = Object.defineProperty({ claimLeaseDurationMs: 300_000 }, "providerTimeoutMs", { enumerable: true, get: () => 20_000 });
  for (const timing of [undefined, null, {}, { providerTimeoutMs: 20_000 }, { ...{ providerTimeoutMs: 20_000, claimLeaseDurationMs: 300_000 }, extra: 1 },
    getter, new Proxy({ providerTimeoutMs: 20_000, claimLeaseDurationMs: 300_000 }, {}), { providerTimeoutMs: "20000", claimLeaseDurationMs: 300_000 }]) {
    await expectDenied({ timing }, "unsafe_provider_timing", { clientBuilt: false });
  }
});

test("M2.0 provider timeout is never configured separately: an openAI config carrying timeoutMs is rejected", async () => {
  await expectDenied({ openAI: { ...model(), timeoutMs: 1 } }, "provider_config_rejected", { clientBuilt: false });
});

test("M2.0 missing or invalid credentials → credentials_rejected, sanitized, no client", async () => {
  for (const credentials of [undefined, {}, { apiKey: "" }, { apiKey: "   " }, { apiKey: "bad\nkey" }, { apiKey: fakeSecret, extra: true },
    Object.defineProperty({}, "apiKey", { enumerable: true, get: () => fakeSecret })]) {
    await expectDenied({ credentials }, "credentials_rejected", { clientBuilt: false });
  }
});

test("M2.0 provider identity/config mismatch → provider_config_rejected before any client or DB", async () => {
  for (const openAI of [
    model({ identity: { ...model().identity, providerKind: "mock" } }),
    model({ identity: { ...model().identity, providerModelVersion: "" } }),
    model({ maxOutputTokens: 0 }),
    model({ inputCostUsdMicrosPerMillionTokens: -1 }),
    { identity: model().identity },
  ]) {
    await expectDenied({ openAI }, "provider_config_rejected", { clientBuilt: false });
  }
});

test("M2.0 non-loopback PostgreSQL is refused until AI-037.5 (TLS/config allowlist) exists", async () => {
  const sdk = fakeSdk();
  for (const connectionString of [
    `postgres://postgres:${fakeDbPassword}@db.example.com:5432/m2`,
    `postgres://postgres:${fakeDbPassword}@10.0.0.5:5432/m2`,
    `postgres://postgres:${fakeDbPassword}@127.0.0.1:5432/m2?host=db.example.com`,
    `mysql://127.0.0.1/m2`,
    "not a url",
  ]) {
    const decision = await composition.composeRealProviderRuntime(input(connectionString, sdk));
    assert.deepEqual(decision.reasons.map((reason) => reason.code), ["database_not_loopback"]);
    assert.equal(JSON.stringify(decision).includes(fakeDbPassword), false);
  }
  assert.equal(sdk.calls.clients, 0);
});

test("M2.0 malformed composition input (extra keys, getters, missing resolvers) fails closed", async () => {
  const db = await listener();
  const sdk = fakeSdk();
  try {
    for (const bad of [
      { ...input(db.url, sdk), unexpected: true },
      { ...input(db.url, sdk), evidenceResolver: null },
      { ...input(db.url, sdk), dependencies: { createOpenAIClient: sdk.createOpenAIClient, fetch: () => null } },
      Object.defineProperty(input(db.url, sdk), "credentials", { enumerable: true, get: () => ({ apiKey: fakeSecret }) }),
      null,
      "string",
    ]) {
      const decision = await composition.composeRealProviderRuntime(bad);
      assert.equal(decision.verdict, "deny");
      assert.equal(JSON.stringify(decision).includes(fakeSecret), false);
    }
    assert.equal(db.connections(), 0);
    assert.equal(sdk.calls.clients, 0);
  } finally {
    await db.close();
  }
});

test("M2.0 a statically valid composition builds the client with the trusted timing, then contacts the DB; an unreachable workspace is denied and closed", async () => {
  const db = await listener();
  const sdk = fakeSdk();
  try {
    const decision = await composition.composeRealProviderRuntime(input(db.url, sdk));
    assert.deepEqual(decision.reasons.map((reason) => reason.code), ["persistence_unavailable"]);
    assert.ok(db.connections() >= 1, "the DB is contacted only after timing, config and credentials are valid");
    assert.deepEqual(sdk.calls.options, [{ apiKey: fakeSecret, maxRetries: 0, timeout: 20_000, logLevel: "off" }]);
    assert.equal(sdk.calls.generations + sdk.calls.counts, 0, "construction performs no model call");
    assert.equal(JSON.stringify(decision).includes(fakeSecret), false);
  } finally {
    await db.close();
  }
});

test("M2.0 the composition source reads no environment variable and imports no transport", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["../lib/composition/real-provider-runtime.ts", "../lib/composition/real-provider-smoke.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(/process\.env/u.test(source), false, `${file} must not read the environment`);
    assert.equal(/from "next|from "react|fetch\(/u.test(source), false, `${file} must not import transport`);
  }
});
