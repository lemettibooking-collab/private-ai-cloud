import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { identityTransport, fakeEvents, frozen } from "./fixtures/executor-provider-identity.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, executorTarget, context } from "./fixtures/durable-executor.mts";
const adapter = await import(new URL("../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../lib/contracts/executor-adapter");
const transport = await import(new URL("../lib/executors/openai-agents-executor.ts", import.meta.url).href) as typeof import("../lib/executors/openai-agents-executor");
const location = new URL("../lib/executors/executor-provider-identity.ts", import.meta.url);
const identity = existsSync(location) ? await import(location.href) : null;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function invocation() {
  const i = adapter.createExecutorAdapterContract(executorConfiguration()).adapter?.validateInvocation(executorRequest()).normalizedInvocation;
  assert.ok(i); return i;
}
test("provider correlation: bounded deterministic primitive exists (baseline RED)", () => {
  assert.equal(typeof identity?.deriveExecutorProviderCorrelation, "function");
});
test("canonical provider request includes opaque correlation metadata before its final fingerprint", () => {
  const request = transport.createOpenAIAgentsCanonicalRequest(invocation(), context(), executorTarget(), 10000);
  const parsed = JSON.parse(request.body);
  assert.match(parsed.metadata?.pac_execution ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(hash(request.body), request.requestFingerprint);
});
test("provider identity migration exists and protects session/turn identity (baseline RED)", () => {
  const path = new URL("../db/migrations/0016_executor_provider_execution_identity.sql", import.meta.url);
  assert.equal(existsSync(path), true);
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /executor_provider_executions/u);
  assert.match(sql, /session_id/u); assert.match(sql, /turn_id/u);
});
function correlationInput() {
  return { workspaceIdentity: "00000000-0000-4000-8000-0000000000a1", developmentRunId: "development-a", attemptNumber: 1,
    requestFingerprint: "a".repeat(64), ...executorTarget(), executorIdentity: { id: "openai-agents", version: "v1" } };
}
test("correlation is deterministic, domain separated and binds every factual component", () => {
  const input = correlationInput(), before = structuredClone(input), a = identity!.deriveExecutorProviderCorrelation(input);
  assert.match(a, /^[a-f0-9]{64}$/u); assert.equal(identity!.deriveExecutorProviderCorrelation(input), a);
  assert.equal(identity!.deriveExecutorProviderCorrelation(Object.fromEntries(Object.entries(input).reverse())), a);
  for (const change of [{ workspaceIdentity: "another-tenant" }, { developmentRunId: "other" }, { attemptNumber: 2 }, { requestFingerprint: "b".repeat(64) },
    { accountId: "account-b" }, { modelId: "model-b" }, { executorIdentity: { id: "other", version: "v1" } }, { executorIdentity: { id: "openai-agents", version: "v2" } }])
    assert.notEqual(identity!.deriveExecutorProviderCorrelation({ ...input, ...change }), a);
  assert.deepEqual(input, before);
});
test("canonical metadata is opaque; base digest removes the hash self-reference; final digest binds it", () => {
  const i = invocation(), c = context(), before = structuredClone({ i, c });
  const a = transport.createOpenAIAgentsCanonicalRequest(i, c, executorTarget(), 10000, correlationInput().workspaceIdentity);
  const b = transport.createOpenAIAgentsCanonicalRequest(i, c, executorTarget(), 10000, correlationInput().workspaceIdentity);
  assert.deepEqual(a, b); assert.notEqual(a, b); frozen(a); frozen(b);
  const { metadata, ...base } = JSON.parse(a.body); assert.equal(hash(JSON.stringify(base)), a.baseRequestFingerprint);
  assert.equal(metadata.pac_execution, a.correlationFingerprint); assert.deepEqual(Object.keys(metadata), ["pac_execution"]);
  assert.equal(identity!.deriveExecutorProviderCorrelation({ ...correlationInput(), requestFingerprint: a.baseRequestFingerprint }), a.correlationFingerprint);
  for (const absent of ["src/a.ts", "task-a", "account-a", correlationInput().workspaceIdentity, "authorized test context"]) assert.ok(!JSON.stringify(metadata).includes(absent));
  const altered = JSON.stringify({ ...base, metadata: { pac_execution: "f".repeat(64) } }); assert.notEqual(hash(altered), a.requestFingerprint);
  for (const other of [transport.createOpenAIAgentsCanonicalRequest(i, { files: [] }, executorTarget(), 10000, correlationInput().workspaceIdentity),
    transport.createOpenAIAgentsCanonicalRequest(i, c, executorTarget(), 20000, correlationInput().workspaceIdentity),
    transport.createOpenAIAgentsCanonicalRequest(i, c, executorTarget(), 10000, "other-workspace")]) assert.notEqual(other.correlationFingerprint, a.correlationFingerprint);
  assert.deepEqual({ i, c }, before);
});
test("hostile correlation and observer getters/proxies are rejected without traps or raw data", () => {
  let reads = 0;
  const getter = Object.defineProperty({}, "workspaceIdentity", { enumerable: true, get() { reads++; throw Error("private-canary"); } });
  const proxy = new Proxy({}, { ownKeys() { reads++; throw Error("private-canary"); } });
  for (const value of [getter, proxy, null, {}, { ...correlationInput(), attemptNumber: 4 }, { ...correlationInput(), extra: true }]) assert.equal(identity!.deriveExecutorProviderCorrelation(value), null);
  for (const port of [getter, proxy, {}]) assert.throws(() => identityTransport("invalid-port", port), /invalid_executor_identity_observer/u);
  assert.equal(reads, 0);
});
for (const id of [null, {}, "", "x".repeat(129), "session\nprivate", "../session", "api_key=private", "sk-" + "x".repeat(48)])
  test(`bounded provider identifier rejects ${typeof id}:${String(id).length}`, () => {
    assert.equal(identity!.validExecutorProviderId(id), false); assert.equal(identity!.providerObservation(id, null), null);
    if (id !== null) assert.equal(identity!.providerObservation("session_safe", id), null);
  });
test("parser awaits session then turn acknowledgements before terminal success; no raw output reaches observer", async () => {
  const observations: unknown[] = [], order: string[] = [];
  const s = identityTransport("ordered-observation", { beforeTransmission: async () => { order.push("prepared"); return true; },
    observe: async (o: unknown) => { frozen(o); observations.push(o); order.push("identity"); return true; }, uncertain: async () => { order.push("unknown"); } });
  const d = await s.invoke(); assert.equal(d.verdict, "allow"); assert.equal(s.calls(), 1); assert.equal(s.credentials(), 1);
  assert.deepEqual(order, ["prepared", "identity", "identity"]);
  assert.deepEqual(observations, [{ sessionId: "session_ordered-observation", turnId: null }, { sessionId: "session_ordered-observation", turnId: "turn_ordered-observation" }]);
});
test("no durable correlation acknowledgement means zero credential reads and zero provider calls", async () => {
  const s = identityTransport("no-correlation", { beforeTransmission: async () => false, observe: async () => true, uncertain: async () => {} });
  const d = await s.invoke(); assert.equal(d.verdict, "deny"); assert.equal(d.normalizedResult, null); assert.equal(s.calls(), 0); assert.equal(s.credentials(), 0);
});
for (const failAt of [1, 2]) test(`identity persistence failure at observation ${failAt} prevents success, retains hold and never retries`, async () => {
  let observed = 0, unknown = 0;
  const s = identityTransport(`persist-failure-${failAt}`, { beforeTransmission: async () => true, observe: async () => ++observed !== failAt, uncertain: async () => { unknown++; } });
  const d = await s.invoke(); assert.equal(d.verdict, "deny"); assert.equal(d.normalizedResult, null); frozen(d);
  assert.equal(d.reconciliation?.reconciliation, "reconciliation_required"); assert.equal(s.calls(), 1); assert.equal(unknown, 1);
  await s.invoke(); assert.equal(s.calls(), 1);
});
test("identity observer route requires exact correlation echo; mismatched provider metadata never attaches a session", async () => {
  let observed = 0, unknown = 0;
  const values = fakeEvents("bad-echo"); Object.assign(values[0].session!, { metadata: { pac_execution: "f".repeat(64) } });
  const before = structuredClone(values), t = identityTransport("bad-echo", { beforeTransmission: async () => true,
    observe: async () => { observed++; return true; }, uncertain: async () => { unknown++; } }, "test-only", values);
  const d = await t.invoke(); assert.equal(d.verdict, "deny"); assert.equal(d.normalizedResult, null);
  assert.equal(observed, 0); assert.equal(unknown, 1); assert.deepEqual(values, before);
});
// Unit-only SQL boundary model; real locking/constraints/transactions are tested in tests/pg.
async function identityUnitStore() {
  const identityStoreModule = await import(new URL("../lib/db/executor-provider-identity-store.ts", import.meta.url).href) as typeof import("../lib/db/executor-provider-identity-store");
  const contract = adapter.createExecutorAdapterContract(executorConfiguration()).adapter!;
  const i = contract.validateInvocation(executorRequest()).normalizedInvocation!, target = executorTarget(), workspace = correlationInput().workspaceIdentity;
  const request = transport.createOpenAIAgentsCanonicalRequest(i, context(), target, 10000, workspace);
  const exposure: import("../lib/db/executor-start-store").DurableExecutorSnapshot = { projectId: "project-a", attempt: i.attempt, identity: i.identity,
    invocationId: i.invocationId, planId: i.planId, taskId: i.taskId, repository: i.repository, capability: i.capability, mode: i.mode, target,
    authorityGeneration: 1, canonicalRunFingerprint: "a".repeat(64), admissionFingerprint: "b".repeat(64), maximumExposureUsdMicros: 10000,
    heldExposureUsdMicros: 10000, providerSpendLimitCents: 1, requestFingerprint: request.requestFingerprint, state: "start_committed", reconciliation: "usage_unknown",
    observedUsage: null, providerConsumedCents: null, observedCostUsdMicros: null, createdAt: 1000, updatedAt: 1000, expiresAt: 61000,
    preparedAt: 1000, startedAt: 1000, terminalResultFingerprint: null, settledAt: null };
  const row: Record<string, unknown> = { provider_id: target.providerId, account_id: target.accountId, provider_model_id: target.modelId,
    executor_id: i.identity.id, executor_version: i.identity.version, request_fingerprint: request.requestFingerprint,
    base_request_fingerprint: request.baseRequestFingerprint, correlation_fingerprint: request.correlationFingerprint,
    session_id: null, turn_id: null, identity_state: "correlation_prepared", recovery_required: false, event_version: 1, created_ms: "1000", updated_ms: "1000" };
  let queries = 0;
  const client = { async query(sql: string, values?: readonly unknown[]) {
    queries++;
    if (sql.includes("provider-identity-lock")) return { rows: [structuredClone(row)], rowCount: 1 };
    if (sql.includes("provider-identity-integrity")) return { rows: [{ count: 1 }], rowCount: 1 };
    if (sql.includes("provider-session")) { row.session_id = values![3]; row.identity_state = "session_observed"; }
    if (sql.includes("provider-turn")) { row.turn_id = values![4]; row.identity_state = "turn_observed"; }
    if (sql.includes("provider-identity-unknown")) row.recovery_required = true;
    if (!sql.includes("provider-identity-audit")) row.event_version = Number(row.event_version) + 1;
    return { rows: [], rowCount: 1 };
  }, release() {} } as import("../lib/db/workflow-runtime-store").WorkflowRuntimeSqlClient;
  const s = identityStoreModule.createExecutorProviderIdentityOperations({ workspace, target,
    async run(raw, operation) { const normalized = contract.validateInvocation(raw).normalizedInvocation;
      if (!normalized) return { verdict: "deny", status: "denied", snapshot: null, startCapability: null };
      return operation(client, normalized, exposure); }, takeStart: () => null, async markUnknown() {} });
  return { s, row, queries: () => queries, raw: executorRequest(), observation: { requestFingerprint: request.requestFingerprint,
    correlationFingerprint: request.correlationFingerprint, target, sessionId: "session_unit" } };
}
test("unit identity exact session/turn replay, conflict and turn-before-session fail closed", async () => {
  const f = await identityUnitStore(), o = { ...f.observation, turnId: "turn_unit" };
  assert.equal((await f.s.recordProviderTurn(f.raw, o)).verdict, "deny");
  assert.equal((await f.s.recordProviderSession(f.raw, f.observation)).status, "recorded");
  assert.equal((await f.s.recordProviderSession(f.raw, f.observation)).status, "idempotent");
  assert.equal((await f.s.recordProviderTurn(f.raw, o)).status, "recorded");
  assert.equal((await f.s.recordProviderTurn(f.raw, o)).status, "idempotent");
  for (const d of [await f.s.recordProviderSession(f.raw, { ...f.observation, sessionId: "other" }), await f.s.recordProviderTurn(f.raw, { ...o, turnId: "other" })]) {
    assert.equal(d.verdict, "deny"); assert.equal(d.status, "recovery_required"); assert.equal(d.providerIdentity, null); assert.equal(d.providerCapability, null); assert.equal(d.startCapability, null);
  }
  assert.equal(f.row.session_id, "session_unit"); assert.equal(f.row.turn_id, "turn_unit"); assert.equal(f.row.recovery_required, true);
});
test("unit identity rejects provider/account/model/request/attempt mismatch and shaped capabilities", async () => {
  const f = await identityUnitStore(), before = structuredClone(f.observation);
  for (const change of [{ requestFingerprint: "f".repeat(64) }, { target: { ...executorTarget(), accountId: "other" } },
    { target: { ...executorTarget(), modelId: "other" } }, { target: { ...executorTarget(), providerId: "other" } }]) {
    const d = await f.s.recordProviderSession(f.raw, { ...f.observation, ...change }); assert.equal(d.verdict, "deny"); assert.equal(d.providerIdentity, null);
  }
  assert.equal((await f.s.recordProviderSession({ ...f.raw, attempt: { ...f.raw.attempt, number: 2 } }, f.observation)).verdict, "deny");
  assert.equal((await f.s.recordProviderSession({ ...f.raw, providerSessionId: "caller-id" }, f.observation)).verdict, "deny");
  assert.deepEqual(f.observation, before);
  const a = await f.s.inspectProviderIdentity(f.raw), b = await f.s.inspectProviderIdentity(f.raw); assert.deepEqual(a, b); assert.notEqual(a.providerIdentity, b.providerIdentity); frozen(a); frozen(b);
  for (const cap of [{ kind: "executor_provider_start" }, a.providerIdentity, a.snapshot, { kind: "executor_test_start" }]) assert.equal(await f.s.createProviderIdentityObserver(f.raw, cap).beforeTransmission(f.observation.requestFingerprint), false);
});
