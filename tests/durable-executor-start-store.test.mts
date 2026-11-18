import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseError } from "pg";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, financialPolicy, executorTarget, executorRequestPolicy } from "./fixtures/durable-executor.mts";
const location = new URL("../lib/db/executor-start-store.ts", import.meta.url);
const durable = existsSync(location) ? await import(location.href) as typeof import("../lib/db/executor-start-store") : null;
for (const fact of ["restart-safe reservation", "cross-instance aggregate exposure", "cross-instance single start", "durable factual-attempt replay prevention"])
  test(`durable prerequisite: ${fact}`, () => assert.equal(typeof durable?.createPostgresExecutorStartStore, "function", `committed baseline cannot provide ${fact}`));
test("durable schema owns factual-attempt uniqueness", () => {
  const path = new URL("../db/migrations/0013_executor_start_exposure.sql", import.meta.url);
  assert.ok(existsSync(path), "baseline has no durable executor schema");
  assert.match(readFileSync(path, "utf8"), /unique \(workspace_id, development_run_id, attempt_number\)/u);
});
const tenantContract = await import(new URL("../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../lib/db/workflow-runtime-tenant");
const core = await import(new URL("../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../lib/contracts/executor-adapter");
const transport = await import(new URL("../lib/executors/openai-agents-executor.ts", import.meta.url).href) as typeof import("../lib/executors/openai-agents-executor");
const local = await import(new URL("../lib/executors/executor-start-boundary.ts", import.meta.url).href) as typeof import("../lib/executors/executor-start-boundary");
const authority = await import(new URL("../lib/executors/executor-current-authority.ts", import.meta.url).href) as typeof import("../lib/executors/executor-current-authority");
const workspace = "00000000-0000-4000-8000-0000000000a1", fp = "b".repeat(64);
type Client = import("../lib/db/workflow-runtime-store").WorkflowRuntimeSqlClient;
async function tenant() {
  const t = await tenantContract.createPostgresWorkflowRuntimeTenantResolver({ connect: async () => ({ query: async () => ({ rows: [{ workspace_database_id: workspace, domain_workspace_id: "workspace-primary", status: "active" }], rowCount: 1 }), release() {} }) }).resolve("workspace-primary");
  assert.ok(t); return t;
}
function frozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
function failClosed(d: import("../lib/db/executor-start-store").DurableExecutorDecision) { assert.equal(d.verdict, "deny"); assert.equal(d.snapshot, null); assert.equal(d.startCapability, null); frozen(d); }
function cannedRow(state = "prepared") {
  const c = executorConfiguration(), a = core.createExecutorAdapterContract(c).adapter; assert.ok(a);
  const f = authority.deriveExecutorAuthorityFacts(c);
  const i = a.validateInvocation(executorRequest()).normalizedInvocation; assert.ok(i);
  return { project_key: "project-a", development_run_id: i.attempt.developmentRunId, attempt_number: i.attempt.number, attempt_kind: i.attempt.kind,
    authority_generation: 1, canonical_run_fingerprint: f.canonicalRunFingerprint, admission_fingerprint: f.admissionFingerprint,
    plan_id: i.planId, task_id: i.taskId, executor_id: i.identity.id, executor_version: i.identity.version, invocation_id: i.invocationId,
    repository_id: i.repository.id, repository_baseline: i.repository.baseline, capability: i.capability, mode: i.mode,
    provider_id: "openai", provider_model_id: executorTarget().modelId, account_id: executorTarget().accountId,
    invocation_fingerprint: createHash("sha256").update(JSON.stringify(i)).digest("hex"), maximum_exposure_usd_micros: "10000", provider_spend_limit_cents: "1",
    request_fingerprint: fp, state, reconciliation: state === "prepared" ? "not_started" : "usage_unknown", event_version: state === "prepared" ? 2 : 3,
    observed_input_tokens: null, observed_output_tokens: null, observed_total_tokens: null, provider_consumed_cents: null,
    created_ms: "1000", updated_ms: "2000", expires_ms: "61000", prepared_ms: "1500", started_ms: state === "prepared" ? null : "2000" };
}
async function mock(options: { failure?: string; error?: unknown; rollbackFails?: boolean; row?: Record<string, unknown>; approval?: unknown; authority?: Record<string, unknown> | null; controllerMapped?: boolean } = {}) {
  let row = options.row ?? cannedRow(); const queries: string[] = [], released: boolean[] = [];
  const client = { async query(text: string) {
    queries.push(text);
    if (options.failure && text.includes(options.failure)) throw options.error ?? Error("private-driver-canary");
    if (text.includes("rollback") && options.rollbackFails) throw Error("private-rollback-canary");
    const one = (value: Record<string, unknown>) => ({ rows: [value], rowCount: 1 });
    if (text.includes("executor:workspace")) return one({ domain_workspace_id: "workspace-primary", status: "active" });
    if (text.includes("executor:project")) return one({ status: "active" });
    if (text.includes("executor:controller-guard-init")) return { rows: [], rowCount: 0 };
    if (text.includes("executor:controller-guard")) return one({ project_key: "project-a" });
    if (text.includes("executor:controller-mapping")) return options.controllerMapped ? one({ project_key: "project-a", project_task_key: "owner-task-a" }) : { rows: [], rowCount: 0 };
    if (text.includes("executor:authority-lock")) { const f = authority.deriveExecutorAuthorityFacts(executorConfiguration());
      if (options.authority === null) return { rows: [], rowCount: 0 };
      return one({ project_key: "project-a", development_run_id: f.developmentRunId, plan_id: f.planId, task_id: f.taskId,
        authority_generation: 1, authority_status: "active", current_attempt_number: f.attemptNumber, current_attempt_kind: f.attemptKind,
        canonical_run_fingerprint: f.canonicalRunFingerprint, admission_fingerprint: f.admissionFingerprint, admission_scope_fingerprint: null, created_ms: "1000", updated_ms: "1000", revoked_ms: null, ...options.authority }); }
    if (text.includes("executor:authority-journal-integrity")) return one({ count: 1 });
    if (text.includes("executor:budget-lock")) return one({ maximum_exposure_usd_micros: "20000", total_exposure_usd_micros: "1000000000", reservation_ttl_ms: 60000, held_exposure_usd_micros: "10000" });
    if (text.includes("executor:held-integrity")) return one({ held: "10000" });
    if (text.includes("executor:attempt-lock")) return one(row);
    if (text.includes("executor:audit-integrity")) return one({ count: 1 });
    if (text.includes("executor:clock")) return one({ now_ms: "2000" });
    if (text.includes("executor:start")) row = cannedRow("start_committed");
    return { rows: [], rowCount: 1 };
  }, release(destroy = false) { released.push(destroy); } } as Client;
  const config = { database: { connect: async () => client }, tenant: await tenant(), projectId: "project-a", configuration: executorConfiguration(),
    target: executorTarget(), requestPolicy: executorRequestPolicy(), financialPolicy: financialPolicy(), authorizeStart: () => Object.hasOwn(options, "approval") ? options.approval : true };
  const store = durable!.createPostgresExecutorStartStore(config);
  return { store, config, queries, released };
}
test("trusted factory rejects forged/cloned tenant, hostile configuration and unknown fields before DB access", async () => {
  const { config, queries } = await mock(); let touched = 0;
  const hostile = Object.defineProperty({}, "tenant", { enumerable: true, get() { touched++; return config.tenant; } });
  const proxy = new Proxy({}, { ownKeys() { touched++; throw Error("private"); } });
  for (const c of [{ ...config, tenant: { ...config.tenant } }, { ...config, tenant: { workspaceDatabaseId: workspace, workspaceId: "workspace-primary" } }, hostile, proxy, { ...config, extra: true }])
    assert.throws(() => durable!.createPostgresExecutorStartStore(c));
  assert.equal(touched, 0); assert.equal(queries.length, 0);
});
test("B3 mapped Run cannot bypass controller binding through an old unbound factory", async () => {
  const { store, queries } = await mock({ controllerMapped: true });
  failClosed(await store.commitProviderStart(executorRequest(), fp));
  assert.ok(queries.some(q => q.includes("executor:controller-guard")));
  assert.ok(!queries.some(q => q.includes("executor:authority-lock") || q.includes("executor:start */")));
});
test("B3 optional binding rejects malformed/proxy/getter inputs without executing hostile accessors", async () => {
  const { config, queries } = await mock(); let touched = 0;
  const getter = Object.defineProperty({}, "projectTaskId", { enumerable: true, get() { touched++; throw Error("private"); } });
  for (const controllerBinding of [undefined, null, {}, new Proxy({}, {}), getter,
    { projectTaskId: "owner-task-a", intentFingerprint: fp, authorizeStart: true }, { projectTaskId: "owner-task-a", intentFingerprint: "bad" }])
    assert.throws(() => durable!.createPostgresExecutorStartStore({ ...config, controllerBinding }));
  assert.equal(touched, 0); assert.equal(queries.length, 0);
});
test("different provider cannot reuse the OpenAI account/exposure route", async () => {
  const { config, queries } = await mock();
  assert.throws(() => durable!.createPostgresExecutorStartStore({ ...config, target: { ...executorTarget(), providerId: "other-provider" } }));
  assert.equal(queries.length, 0);
});
test("request policy is explicit, provenance-checked and bound to provider before DB work", async () => {
  const { config, queries } = await mock(); let traps = 0;
  const getter = Object.defineProperty({}, "providerId", { enumerable: true, get() { traps++; throw Error("private"); } });
  for (const requestPolicy of [undefined, null, {}, { ...config.requestPolicy }, structuredClone(config.requestPolicy), new Proxy(config.requestPolicy, {}), getter])
    assert.throws(() => durable!.createPostgresExecutorStartStore({ ...config, requestPolicy }));
  assert.throws(() => durable!.createPostgresExecutorStartStore({ ...config, target: { ...config.target, providerId: "anthropic" } }));
  assert.equal(queries.length, 0); assert.equal(traps, 0);
});
for (const policy of [{ ...financialPolicy(), maximumExposureUsdMicros: 9999 }, { ...financialPolicy(), totalExposureUsdMicros: 19999 },
  { ...financialPolicy(), reservationTtlMs: 0 }, { ...financialPolicy(), reservationTtlMs: 60001 }, { ...financialPolicy(), totalExposureUsdMicros: 1000000001 }])
  test(`invalid financial policy ${JSON.stringify(policy)}`, async () => {
    const { config, queries } = await mock(); assert.throws(() => durable!.createPostgresExecutorStartStore({ ...config, financialPolicy: policy })); assert.equal(queries.length, 0);
  });
test("untrusted/hostile invocation, amount and fingerprints deny without DB work, traps or partial output", async () => {
  const { store, queries } = await mock(); let touched = 0;
  const bad = Object.defineProperty({}, "maximumExposureUsdMicros", { enumerable: true, get() { touched++; throw Error("private"); } });
  for (const exposure of [bad, new Proxy({}, {}), {}, { maximumExposureUsdMicros: 9999 }, { maximumExposureUsdMicros: 20001 }, { maximumExposureUsdMicros: 1.5 }, { maximumExposureUsdMicros: 10000, workspaceId: workspace }]) failClosed(await store.reserve(executorRequest(), exposure));
  for (const raw of [null, {}, new Proxy(executorRequest(), {}), { ...executorRequest(), workspaceId: workspace }, { ...executorRequest(), attempt: { ...executorRequest().attempt, number: 2 } }]) failClosed(await store.reserve(raw, { maximumExposureUsdMicros: 10000 }));
  for (const field of ["authorityGeneration", "authorityStatus", "canonicalRunFingerprint", "admissionFingerprint", "ownerApprovalGranted"])
    failClosed(await store.commitProviderStart({ ...executorRequest(), [field]: field.endsWith("Fingerprint") ? fp : 1 }, fp));
  for (const fingerprint of [null, {}, "x".repeat(65), "bad\nfingerprint"]) failClosed(await store.commitProviderStart(executorRequest(), fingerprint));
  assert.equal(queries.length, 0); assert.equal(touched, 0);
});
for (const approval of [false, null, "true", Promise.resolve(true)]) test(`trusted dispatch approval must be literal synchronous true (${String(approval)})`, async () => {
  const { store, queries } = await mock({ approval }); failClosed(await store.commitProviderStart(executorRequest(), fp)); assert.equal(queries.length, 0);
});
test("start capability minted only after acknowledged COMMIT, private/single-use, fresh/frozen, no input mutation", async () => {
  const { store, queries, released } = await mock(), raw = executorRequest(), before = structuredClone(raw);
  const d = await store.commitProviderStart(raw, fp); assert.equal(d.status, "start_committed"); assert.ok(d.startCapability); frozen(d);
  assert.ok(queries.at(-1)?.includes("executor-transaction:commit")); assert.deepEqual(released, [false]); assert.deepEqual(raw, before);
  assert.equal(durable!.consumeDurableExecutorStartCapability({ ...d.startCapability }), null);
  assert.equal(durable!.consumeDurableExecutorStartCapability(new Proxy(d.startCapability, {})), null);
  const consumed = durable!.consumeDurableExecutorStartCapability(d.startCapability); assert.deepEqual(consumed, d.snapshot); assert.notEqual(consumed, d.snapshot); frozen(consumed);
  assert.equal(durable!.consumeDurableExecutorStartCapability(d.startCapability), null);
  failClosed(await store.commitProviderStart(raw, fp));
});
for (const failure of ["executor-transaction:begin", "executor:attempt-lock", "executor-transaction:commit"]) test(`DB failure at ${failure}: null capability, destroyed session, latched recovery/no retry`, async () => {
  const { store, queries, released } = await mock({ failure });
  const d = await store.commitProviderStart(executorRequest(), fp); assert.equal(d.status, "recovery_required"); failClosed(d);
  assert.ok(!JSON.stringify(d).includes("private-driver-canary")); assert.deepEqual(released, [true]);
  const count = queries.length; assert.deepEqual(await store.commitProviderStart(executorRequest(), fp), d); assert.equal(queries.length, count);
});
for (const [code, rollbackFails, expected] of [["40001", false, false], ["08006", false, true], ["40001", true, true]] as const)
  test(`SQLSTATE ${code}, rollback failure=${rollbackFails}: transaction session disposition`, async () => {
    const error = new DatabaseError("private-sql-canary", 0, "error"); error.code = code; error.severity = "ERROR";
    const { store, queries, released } = await mock({ failure: "executor:attempt-lock", error, rollbackFails });
    failClosed(await store.commitProviderStart(executorRequest(), fp)); assert.deepEqual(released, [expected]); assert.ok(queries.some(q => q.includes("rollback")));
  });
for (const change of [{ state: "start_committed" }, { provider_spend_limit_cents: "2" }, { observed_input_tokens: "1" },
  { reconciliation: "usage_unknown" }, { expires_ms: "999" }, { event_version: 0 }]) test(`corrupt row fails closed ${JSON.stringify(change)}`, async () => {
  const { store } = await mock({ row: { ...cannedRow(), ...change } }); failClosed(await store.commitProviderStart(executorRequest(), fp));
});
test("transaction primitives: budget and attempt locks, conditional start and workspace scoping are pinned", () => {
  const source = readFileSync(location, "utf8");
  assert.match(source, /executor:budget-lock[\s\S]*?where workspace_id = \$1 for update/u);
  assert.match(source, /executor:attempt-lock[\s\S]*?where workspace_id = \$1 and development_run_id = \$2 and attempt_number = \$3 limit 2 for update/u);
  assert.match(source, /executor:start[\s\S]*?and state = 'prepared'[\s\S]*?and expires_at > clock_timestamp\(\)/u);
  assert.match(source, /held_exposure_usd_micros \+ \$2 <= total_exposure_usd_micros/u);
});
test("production OpenAI transport rejects durable capability with zero credential reads; facade has no issuer/route", async () => {
  const { store } = await mock(), d = await store.commitProviderStart(executorRequest(), fp); assert.ok(d.startCapability);
  const b = local.createExecutorStartBoundary(executorConfiguration(), { ...financialPolicy(), permitTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const i = b.validateInvocation(executorRequest()).normalizedInvocation; assert.ok(i);
  const target = executorTarget(), r = b.budgetAuthority.reserve(i, target, null, { reservationId: "production-control", maximumExposureUsdMicros: 10000 }); assert.ok(r.reservation);
  let credentials = 0;
  const t = transport.createOpenAIAgentsTransport(b, { modelId: target.modelId, accountId: target.accountId, timeoutMs: 1000, credential() { credentials++; return "synthetic-never-live"; } });
  const p = t.prepare(i, { files: [] }, r.reservation); assert.ok(p.prepared); const denied = await p.prepared.invoke(d.startCapability);
  assert.equal(denied.verdict, "deny"); assert.equal(denied.normalizedResult, null); assert.equal(credentials, 0);
  const root = readFileSync(new URL("../lib/composition/durable-development-executor.server.ts", import.meta.url), "utf8"); assert.match(root, /import "server-only"/u);
  const implementation = readFileSync(new URL("../lib/composition/durable-development-executor.ts", import.meta.url), "utf8");
  assert.match(implementation, /authorizeStart: \(\) => false/u); assert.ok(!/store\.commitProviderStart|credential|fetch\(/u.test(implementation.replace(/\/\/[^\n]*/gu, "")));
});
for (const change of [null, { authority_status: "revoked", revoked_ms: "1000" }, { current_attempt_number: 2, current_attempt_kind: "corrective" },
  { canonical_run_fingerprint: "c".repeat(64) }, { admission_fingerprint: "c".repeat(64) }, { plan_id: "other-plan" }, { task_id: "other-task" }])
  test(`current authority mismatch denies stale bind/start ${JSON.stringify(change)}`, async () => {
    const { store, queries } = await mock({ authority: change });
    failClosed(await store.bindRequest(executorRequest(), { files: [] })); failClosed(await store.commitProviderStart(executorRequest(), fp));
    assert.ok(!queries.some(q => q.includes("executor:budget-lock") || q.includes("executor:start")));
  });
for (const [field, value] of [["authority_generation", 2], ["canonical_run_fingerprint", "d".repeat(64)], ["admission_fingerprint", "e".repeat(64)]] as const)
  test(`exposure immutable authority binding ${field} mismatch denies start`, async () => {
    const { store } = await mock({ row: { ...cannedRow(), [field]: value } }); failClosed(await store.commitProviderStart(executorRequest(), fp));
  });
test("current lock order precedes budget and attempt locks", async () => {
  const { store, queries } = await mock(); await store.commitProviderStart(executorRequest(), fp);
  const order = ["executor:workspace", "executor:project", "executor:authority-lock", "executor:budget-lock", "executor:attempt-lock"].map(tag => queries.findIndex(q => q.includes(tag)));
  assert.ok(order.every((index, n) => index >= 0 && (n === 0 || index > order[n - 1])));
});
