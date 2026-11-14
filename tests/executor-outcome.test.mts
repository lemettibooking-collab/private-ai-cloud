import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest } from "./fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizedResult, digest, receipt, frozen, controlledTransport } from "./fixtures/executor-outcome.mts";
const outcome = await import(new URL("../lib/executors/executor-outcome.ts", import.meta.url).href) as typeof import("../lib/executors/executor-outcome");
const core = await import(new URL("../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../lib/contracts/executor-adapter");

const migration = new URL("../db/migrations/0015_executor_outcome_settlement.sql", import.meta.url);
for (const fact of ["durable terminal storage", "restart result recovery", "atomic release", "duplicate settlement protection", "settlement after reconciliation"])
  test(`outcome prerequisite: ${fact}`, () => assert.ok(existsSync(migration), `baseline lacks ${fact}`));
test("outcome schema pins terminal uniqueness and same-transaction result relation", () => {
  assert.ok(existsSync(migration));
  const sql = readFileSync(migration, "utf8");
  assert.match(sql, /primary key \(workspace_id, development_run_id, attempt_number\)/u);
  assert.match(sql, /executor_settled_result_fk/u);
  assert.match(sql, /create trigger executor_result_immutable before update or delete/u);
  assert.match(sql, /references executor_attempt_results/u);
  assert.match(sql, /old\.state='reconciliation_required' and new\.state in \('reconciliation_required','settled'\)/u);
  assert.ok(!sql.includes("old.state='settled' and"), "settled is immutable, no backwards transition");
});
const fp = "b".repeat(64);
const validate = (payload: unknown) => outcome.revalidateExecutorOutcome(executorConfiguration(), executorRequest(), payload);
for (const status of ["succeeded", "rejected", "failed"])
  test(`durably revalidate ${status} with canonical full result and fresh/frozen projection`, () => {
    const r = normalizedResult("development-a", status), before = structuredClone(r), a = validate(r), b = validate(structuredClone(r));
    assert.ok(a); assert.ok(b); assert.deepEqual(a, b); assert.notEqual(a.normalizedResult, b.normalizedResult); frozen(a); frozen(b);
    assert.deepEqual(r, before); assert.equal(a.resultFingerprint, digest(a.canonicalJson));
    assert.equal(a.normalizedResult.verificationStatus, "not_run"); assert.equal(a.normalizedResult.ownerDecisionRequired, true);
    assert.equal(a.normalizedResult.automaticRetryAllowed, false);
  });
test("canonical ordering ignores object property and change insertion order; content/outcome changes digest", () => {
  const r = structuredClone(normalizedResult()); const other = { ...r.changes[0], path: "src/b.ts" };
  const adapter = core.createExecutorAdapterContract(executorConfiguration()).adapter!;
  const i = adapter.validateInvocation(executorRequest()).normalizedInvocation!;
  const normalized = (changes: unknown) => adapter.evaluateResult(i, { schemaVersion: r.schemaVersion, identity: r.identity, invocationId: r.invocationId,
    status: r.status, failureCode: r.failureCode, report: r.report, changes }).normalizedResult;
  const a = validate(normalized([other, ...r.changes]));
  const b = validate(Object.fromEntries(Object.entries(normalized([...r.changes, other])!).reverse()));
  assert.ok(a); assert.deepEqual(a, b);
  assert.notEqual(a.resultFingerprint, validate(normalizedResult())?.resultFingerprint);
  assert.notEqual(validate(normalizedResult("development-a", "succeeded", "Different unverified report."))?.resultFingerprint, validate(r)?.resultFingerprint);
  assert.notEqual(validate(normalizedResult("development-a", "rejected"))?.resultFingerprint, validate(r)?.resultFingerprint);
});
for (const [field, value] of [["attempt", { developmentRunId: "different", number: 1, kind: "initial" }], ["invocationId", "different"],
  ["repository", { id: "repo-a", baseline: "b".repeat(40) }], ["planId", "different"], ["taskId", "different"],
  ["identity", { id: "different", version: "v1" }], ["ownerDecisionRequired", false], ["verificationStatus", "passed"], ["automaticRetryAllowed", true],
  ["failureCode", "timeout"], ["unknown", true]] as const)
  test(`changed result binding/derived field ${field} rejected`, () => assert.equal(validate({ ...normalizedResult(), [field]: value }), null));
test("hostile getters/proxies/cycles and oversized results fail closed without executing traps", async () => {
  let traps = 0;
  const getter = Object.defineProperty({}, "status", { enumerable: true, get() { traps++; throw Error("private"); } });
  const proxy = new Proxy({}, { ownKeys() { traps++; throw Error("private"); } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const bad of [null, {}, getter, proxy, cycle, { ...normalizedResult(), changes: Array(65).fill({}) }]) assert.equal(validate(bad), null);
  const r = normalizedResult();
  for (const content of ["x".repeat(128 * 1024 + 1), "api_key=never-store-this-secret", "x\u0000y"]) {
    const change = { ...r.changes[0], content, sha256: digest(content) };
    assert.equal(validate({ ...r, changes: [change] }), null);
  }
  assert.equal(traps, 0);
});
test("existing maximum result bounds fit the explicit JSON envelope without truncation", () => {
  const r = normalizedResult(), content = '"'.repeat(128 * 1024);
  const large = { ...r, changes: [{ ...r.changes[0], content, sha256: digest(content) }] };
  const d = validate(large); assert.ok(d); assert.equal(d.normalizedResult.changes[0].content, content);
  assert.ok(Buffer.byteLength(d.canonicalJson) <= outcome.executorOutcomeJsonLimit);
  assert.equal(validate({ ...r, report: { content: "x".repeat(16385), sha256: digest("x".repeat(16385)) } }), null);
});
test("raw cumulative 256 KiB boundary remains valid when normalized bindings are added", async () => {
  const a = core.createExecutorAdapterContract(executorConfiguration()).adapter!, i = a.validateInvocation(executorRequest()).normalizedInvocation!;
  const r = normalizedResult();
  const raw = { schemaVersion: r.schemaVersion, identity: r.identity, invocationId: r.invocationId, status: r.status,
    failureCode: r.failureCode, report: r.report, changes: ["src/a.ts", "src/b.ts"].map(path => ({ path, operation: "add", content: "", sha256: digest("") })) };
  const bytes = (v: unknown): number => typeof v === "string" ? Buffer.byteLength(v) : v && typeof v === "object" ? Object.values(v).reduce<number>((sum, value) => sum + bytes(value), 0) : 0;
  const available = 256 * 1024 - bytes(raw);
  raw.changes[0].content = "x".repeat(128 * 1024); raw.changes[1].content = "x".repeat(available - 128 * 1024);
  raw.changes.forEach(c => { c.sha256 = digest(c.content); }); assert.equal(bytes(raw), 256 * 1024);
  const normalized = a.evaluateResult(i, raw).normalizedResult; assert.ok(normalized); assert.ok(bytes(normalized) > 256 * 1024);
  const d = validate(normalized); assert.ok(d); assert.deepEqual(d.normalizedResult, normalized);
  const c = outcome.createExecutorOutcomeCapture(executorConfiguration(), { capture: () => ({ terminality: "definitive_terminal", normalizedResult: normalized, usage: null, providerConsumedCents: null }) });
  assert.ok(await c.capture(executorRequest(), fp));
});
test("opaque trusted evidence is exact-request scoped; cloned/forged flags do not authorize settlement", async () => {
  const proof = await receipt("development-a", fp); assert.ok(proof); frozen(proof);
  const a = core.createExecutorAdapterContract(executorConfiguration()).adapter!;
  const i = a.validateInvocation(executorRequest()).normalizedInvocation!;
  assert.ok(outcome.readExecutorOutcomeEvidence(proof, i, fp));
  for (const fake of [null, {}, { ...proof }, new Proxy(proof, {}), { terminality: "definitive_terminal" }])
    assert.equal(outcome.readExecutorOutcomeEvidence(fake, i, fp), null);
  assert.equal(outcome.readExecutorOutcomeEvidence(proof, i, "c".repeat(64)), null);
  assert.equal(outcome.readExecutorOutcomeEvidence(proof, { ...i, invocationId: "other" }, fp), null);
});
test("outcome_unknown cannot receive definitive evidence; ambiguity may only be held", async () => {
  assert.equal(await receipt("development-a", fp, "outcome_unknown"), null);
  assert.ok(await receipt("development-a", fp, "outcome_unknown", undefined, { terminality: "ambiguous" }));
  assert.equal(await receipt("development-a", fp, "succeeded", undefined, { terminality: "not_transmitted" }), null);
  assert.equal(await receipt("development-a", fp, "failed", undefined, { terminality: "rejected_before_execution" }), null);
});
test("trusted producer failure/malformed or hostile evidence fails closed without trap leakage", async () => {
  let traps = 0;
  for (const source of [() => { throw Error("private-producer-canary"); }, () => null,
    () => Object.defineProperty({}, "terminality", { enumerable: true, get() { traps++; throw Error("private"); } }), () => new Proxy({}, {})]) {
    const c = outcome.createExecutorOutcomeCapture(executorConfiguration(), { capture: source });
    assert.equal(await c.capture(executorRequest(), fp), null);
  }
  assert.equal(traps, 0);
  assert.throws(() => outcome.createExecutorOutcomeCapture(executorConfiguration(), new Proxy({}, {})));
});
for (const evidence of [{ usage: { inputTokens: 1, outputTokens: 2, totalTokens: 4 } }, { providerConsumedCents: -1 }, { providerConsumedCents: 0.1 }, { providerConsumedCents: 1000000001 }])
  test(`malformed evidence ${JSON.stringify(evidence)} cannot mint a receipt`, async () => {
    const source = outcome.createExecutorOutcomeCapture(executorConfiguration(), { capture: () => ({ terminality: "definitive_terminal", normalizedResult: normalizedResult(), usage: null, providerConsumedCents: null, ...evidence }) });
    assert.equal(await source.capture(executorRequest(), fp), null);
  });
for (const kind of ["timeout", "5xx", "invalid", "budget"] as const)
  test(`real injected transport ${kind} remains ambiguous even when failure-shaped`, async () => {
    const d = await controlledTransport("development-a", kind); assert.ok(d.proof);
    const i = core.createExecutorAdapterContract(executorConfiguration()).adapter!.validateInvocation(executorRequest()).normalizedInvocation!;
    assert.equal(outcome.readExecutorOutcomeEvidence(d.proof, i, d.fp)?.terminality, "ambiguous");
    assert.equal(d.calls, 1); assert.equal(d.decision.reconciliation?.reconciliation, "reconciliation_required");
  });
test("real injected successful/rejected terminal transport evidence is definitive; production remains zero egress", async () => {
  const i = core.createExecutorAdapterContract(executorConfiguration()).adapter!.validateInvocation(executorRequest()).normalizedInvocation!;
  for (const kind of ["success", "rejected"] as const) {
    const d = await controlledTransport("development-a", kind); assert.ok(d.proof);
    assert.notEqual(outcome.readExecutorOutcomeEvidence(d.proof, i, d.fp)?.terminality, "ambiguous");
  }
  const d = await controlledTransport("development-a", "production"); assert.equal(d.calls, 0); assert.equal(d.credentials, 0); assert.equal(d.decision.normalizedResult, null);
});
test("internal composition server-only, unbound, no start issuer/credential/network; structural atomic order", () => {
  const root = readFileSync(new URL("../lib/composition/executor-outcome.server.ts", import.meta.url), "utf8"); assert.match(root, /import "server-only"/u);
  const source = readFileSync(new URL("../lib/db/executor-start-store.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("executor:outcome-insert") < source.indexOf("executor:settlement-release"));
  assert.match(source, /active \? await lockExecutorAuthority/u);
  assert.match(source, /state not in \('cancelled','settled'\)/u);
  assert.match(source, /!evidence \|\| !row \|\| row\.request_fingerprint !== requestFingerprint/u);
  assert.ok(!/redispatch|fetch\(/u.test(source.slice(source.indexOf("async function inspectOutcome"))), "restart reads never dispatch");
  const ingress = readFileSync(new URL("../lib/composition/executor-outcome.ts", import.meta.url), "utf8");
  assert.match(ingress, /authorizeStart: \(\) => false/u); assert.ok(!/\.commitProviderStart\(|fetch\(|credential\(/u.test(ingress));
});
