import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { withDevelopmentRun, initialAttempt, transition } from "./fixtures/executor-attempt.mts";
const core = await import(new URL("../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../lib/contracts/executor-adapter");
const bridge = await import(new URL("../lib/executors/executor-start-boundary.ts", import.meta.url).href) as typeof import("../lib/executors/executor-start-boundary");
function config(number = 1) {
  return withDevelopmentRun({ identity: { id: "test-executor", version: "v1" },
    capabilities: { tasks: ["coding", "repository_analysis"], modes: ["patch_proposal", "analysis_only"], artifacts: ["patch", "report"] },
    repository: { id: "repo-a", baseline: "a".repeat(40) },
    admission: { taskId: "task-a", completedTaskIds: [], activeTaskIds: [], repositoryAllowlist: ["src"], taskOwnerApprovalGranted: true,
      plan: { id: "plan-a", title: "Plan", goal: "Bounded proposal", status: "approved", tasks: [{ id: "task-a", sequence: 1,
        title: "Task", goal: "Proposal", scope: ["Source"], nonGoals: ["No external actions"], allowedPaths: ["src"],
        acceptanceCriteria: ["Owner review"], verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "low", priority: "P3", requiresOwnerApproval: true }] } } }, number);
}
function request(number = 1, invocationId = "invocation-a") {
  const c = config(number);
  return { schemaVersion: 1, invocationId, identity: c.identity, planId: "plan-a", taskId: "task-a", repository: c.repository,
    capability: "coding", mode: "patch_proposal", attempt: { ...initialAttempt(), number, kind: number === 1 ? "initial" : "corrective" } };
}
function adapter(number = 1) { const d = core.createExecutorAdapterContract(config(number)); assert.ok(d.adapter); return d.adapter; }
function receipt(a: Pick<ReturnType<typeof adapter>, "validateInvocation"> = adapter(), r = request()) { const d = a.validateInvocation(r); assert.ok(d.normalizedInvocation); return d.normalizedInvocation; }
function resolve(run: unknown) {
  const fn = Reflect.get(core, "resolveCurrentExecutorAttempt");
  assert.equal(typeof fn, "function", "baseline must expose factual attempt resolution");
  return fn(run) as { verdict: string; attempt: unknown; reasons: readonly unknown[] };
}
function frozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
function deny(d: { verdict: string; attempt?: unknown; normalizedInvocation?: unknown; normalizedResult?: unknown; adapter?: unknown }) {
  assert.equal(d.verdict, "deny");
  for (const k of ["attempt", "normalizedInvocation", "normalizedResult", "adapter"] as const) if (k in d) assert.equal(d[k], null);
  frozen(d);
}
function result(invocationId = "invocation-a") {
  const content = "Unverified proposal", hash = (s: string) => createHash("sha256").update(s).digest("hex");
  return { schemaVersion: 1, identity: config().identity, invocationId, status: "succeeded", failureCode: null,
    changes: [{ path: "src/a.ts", operation: "add", content, sha256: hash(content) }], report: { content, sha256: hash(content) } };
}
for (const number of [1, 2, 3]) test(`factual AI-011 attempt ${number} resolves and binds fresh serializable identity`, () => {
  const c = config(number), before = structuredClone(c), expected = request(number).attempt;
  assert.equal(c.developmentRun.status, "implementing"); assert.equal(c.developmentRun.nextAction, "submit_patch_or_failure");
  const a = resolve(c.developmentRun), b = resolve(c.developmentRun);
  assert.equal(a.verdict, "allow"); assert.deepEqual(a.attempt, expected); assert.deepEqual(a, b); assert.notEqual(a.attempt, b.attempt); frozen(a);
  assert.deepEqual(JSON.parse(JSON.stringify(a.attempt)), expected);
  assert.deepEqual(receipt(adapter(number), request(number)).attempt, expected); assert.deepEqual(c, before);
});
test("factual resolver rejects inconsistent number, kind, lifecycle and extra fields without repair", () => {
  const valid = config().developmentRun;
  const bad: unknown[] = [null, {}, { ...valid, currentAttemptNumber: 2 }, { ...valid, attempts: [] },
    { ...valid, attempts: [valid.attempts[0], valid.attempts[0]] }, { ...valid, maxAttempts: 4 },
    { ...valid, attempts: [{ ...valid.attempts[0], kind: "corrective" }] },
    { ...config(2).developmentRun, attempts: [valid.attempts[0], { ...config(2).developmentRun.attempts[1], kind: "initial" }] },
    { ...valid, attempts: [{ ...valid.attempts[0], status: "passed" }] }, { ...valid, nextAction: "start_attempt" },
    { ...valid, status: "reviewing" }, { ...valid, extra: true }, { ...valid, id: " development-a " },
    { ...valid, attempts: [{ ...valid.attempts[0], extra: true }] }];
  for (const input of bad) { const before = structuredClone(input); deny(resolve(input)); assert.deepEqual(resolve(input), resolve(input)); assert.deepEqual(input, before); }
});
test("max attempt, verifying, reviewing, completed, cancelled and awaiting correction are not executable", () => {
  const initial = config().developmentRun, patch = transition(initial, { type: "submit_patch", changedPaths: ["src/a.ts"] });
  const review = transition(patch, { type: "verification_passed", checks: [{ command: "npm test", exitCode: 0 }] });
  for (const run of [patch, review, transition(review, { type: "review_passed" }), transition(initial, { type: "cancel" }),
    { ...initial, status: "ready", nextAction: "start_attempt" }, { ...config(3).developmentRun, currentAttemptNumber: 4 }]) deny(resolve(run));
  const failed = transition(config(3).developmentRun, { type: "implementation_failed", failure: { phase: "implementation", code: "implementation_failed",
    fingerprint: "implementation:3", summary: "Needs correction", retryable: true, scopeExpansionRequired: false, protectedPathViolation: false, systemForbiddenPathViolation: false } });
  assert.equal(failed.status, "blocked"); deny(resolve(failed));
  const awaiting = { ...failed, status: "awaiting_correction" }; deny(resolve(awaiting));
  const factualAwaiting = transition(initial, { type: "implementation_failed", failure: { phase: "implementation", code: "implementation_failed",
    fingerprint: "implementation:1", summary: "Needs correction", retryable: true, scopeExpansionRequired: false, protectedPathViolation: false, systemForbiddenPathViolation: false } });
  assert.equal(factualAwaiting.status, "awaiting_correction"); deny(resolve(factualAwaiting));
  deny(resolve({ ...initial, status: "ready", nextAction: "start_attempt", attempts: [], currentAttemptNumber: 0 }));
});
for (const field of ["planId", "taskId"] as const) test(`trusted configuration rejects factual ${field} mismatch`, () => {
  const c = config(); c.developmentRun = { ...c.developmentRun, [field]: "different" }; deny(core.createExecutorAdapterContract(c));
});
for (const attempt of [
  { ...initialAttempt(), developmentRunId: "other-run" }, { ...initialAttempt(), number: 2 }, { ...initialAttempt(), kind: "corrective" },
  { developmentRunId: "forged-run", number: 3, kind: "corrective" }, ...[0, -1, 1.5, 4, Number.MAX_SAFE_INTEGER].map(number => ({ ...initialAttempt(), number })),
  { ...initialAttempt(), kind: "unknown" }, { ...initialAttempt(), extra: true }, { ...initialAttempt(), developmentRunId: "x".repeat(65) },
  { ...initialAttempt(), developmentRunId: "bad\nidentifier" }, { ...initialAttempt(), developmentRunId: "../run" }, null,
]) test(`untrusted attempt denied ${JSON.stringify(attempt)}`, () => {
  const a = adapter(), input = { ...request(), attempt }, before = structuredClone(input);
  deny(a.validateInvocation(input)); assert.deepEqual(a.validateInvocation(input), a.validateInvocation(input)); assert.deepEqual(input, before);
});
test("hostile run/configuration/attempt getters and proxies are rejected without traps or leaked values", () => {
  let calls = 0; const hostile = Object.defineProperty({}, "id", { enumerable: true, get() { calls++; throw Error("private-canary"); } });
  const proxy = new Proxy({}, { ownKeys() { calls++; throw Error("private-canary"); }, getPrototypeOf() { calls++; throw Error("private-canary"); } });
  const a = adapter();
  for (const bad of [hostile, proxy, { ...config().developmentRun, attempts: [hostile] }, { ...config().developmentRun, id: "x".repeat(262145) }]) {
    const d = resolve(bad); deny(d); assert.ok(!JSON.stringify(d).includes("private-canary"));
  }
  for (const bad of [hostile, proxy]) { deny(core.createExecutorAdapterContract({ ...config(), developmentRun: bad })); deny(a.validateInvocation({ ...request(), attempt: bad })); }
  assert.equal(calls, 0);
});
test("configured factual snapshot cannot be replaced by later caller mutation", () => {
  const c = config(), d = core.createExecutorAdapterContract(c); assert.ok(d.adapter);
  c.developmentRun = { ...c.developmentRun, id: "replacement", currentAttemptNumber: 2 };
  assert.deepEqual(receipt(d.adapter).attempt, initialAttempt()); deny(d.adapter.validateInvocation(request(2)));
});
test("result attempt is receipt-derived, fresh/frozen, cannot be selected or reused across attempts", () => {
  const a = adapter(), i = receipt(a), raw = result(), before = structuredClone(raw);
  const d = a.evaluateResult(i, raw), e = a.evaluateResult(i, raw); assert.equal(d.verdict, "allow");
  assert.deepEqual(d.normalizedResult?.attempt, initialAttempt()); assert.deepEqual(d, e); assert.notEqual(d.normalizedResult, e.normalizedResult);
  assert.notEqual(d.normalizedResult?.attempt, i.attempt); frozen(d); assert.deepEqual(raw, before);
  deny(a.evaluateResult(i, { ...raw, attempt: request(2).attempt })); deny(a.evaluateResult({ ...i }, raw));
  const second = adapter(2), i2 = receipt(second, request(2, "invocation-b"));
  deny(second.evaluateResult(i, raw)); deny(second.evaluateResult(i2, raw)); deny(second.evaluateResult(i2, d.normalizedResult));
  const d2 = second.evaluateResult(i2, result("invocation-b")); assert.equal(d2.verdict, "allow"); assert.deepEqual(d2.normalizedResult?.attempt, request(2).attempt);
  const third = adapter(3), i3 = receipt(third, request(3, "invocation-c"));
  assert.deepEqual(third.evaluateResult(i3, result("invocation-c")).normalizedResult?.attempt, request(3).attempt);
});
test("changing invocationId preserves factual attempt and cannot authorize corrective identity", () => {
  const a = adapter(), first = receipt(a), second = receipt(a, request(1, "another-id"));
  assert.deepEqual(first.attempt, second.attempt); assert.notEqual(first.invocationId, second.invocationId);
  deny(a.validateInvocation(request(2, "another-id")));
});
test("one managed start per factual attempt, even changing invocationId/capability/mode", () => {
  const target = { providerId: "test", modelId: "test", accountId: "test" }, fingerprint = "b".repeat(64);
  const b = bridge.createExecutorStartBoundary(config(), { maximumExposureUsdMicros: 10000, totalExposureUsdMicros: 50000,
    permitTtlMs: 100, reservationTtlMs: 100, maxEntries: 16 }, () => 1000);
  const i = receipt(b), p = b.dispatchAuthority.issue(i, target, fingerprint), r = b.budgetAuthority.reserve(i, target, fingerprint, { reservationId: "r1", maximumExposureUsdMicros: 10000 });
  const snapshot = b.budgetAuthority.inspect(r.reservation); assert.deepEqual(snapshot?.attempt, initialAttempt()); assert.notEqual(snapshot?.attempt, i.attempt); frozen(snapshot);
  assert.equal(b.providerStartFence.start(i, target, fingerprint, p.permit, r.reservation).verdict, "allow");
  for (const raw of [request(1, "new-id"), { ...request(1, "analysis-id"), capability: "repository_analysis", mode: "analysis_only" }]) {
    const next = receipt(b, raw); assert.equal(b.dispatchAuthority.issue(next, target, fingerprint).verdict, "deny");
    assert.equal(b.budgetAuthority.reserve(next, target, fingerprint, { reservationId: "r2", maximumExposureUsdMicros: 10000 }).verdict, "deny");
  }
});
