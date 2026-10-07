import assert from "node:assert/strict";
import test from "node:test";

const bridge = await import(new URL("../lib/executors/executor-start-boundary.ts", import.meta.url).href) as typeof import("../lib/executors/executor-start-boundary");

function configuration() {
  return {
    identity: { id: "openai-agents", version: "v1" },
    capabilities: { tasks: ["coding", "repository_analysis"], modes: ["patch_proposal", "analysis_only"], artifacts: ["patch", "report"] },
    repository: { id: "repo-a", baseline: "a".repeat(40) },
    admission: { taskId: "task-a", completedTaskIds: [], activeTaskIds: [], repositoryAllowlist: ["src"], taskOwnerApprovalGranted: true,
      plan: { id: "plan-a", title: "Plan", goal: "Bounded proposal", status: "approved", tasks: [{ id: "task-a", sequence: 1,
        title: "Task", goal: "Bounded proposal", scope: ["Source"], nonGoals: ["No external actions"], allowedPaths: ["src"],
        acceptanceCriteria: ["Owner reviews evidence"], verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "low", priority: "P3", requiresOwnerApproval: true }] } },
  };
}
const target = { providerId: "openai", modelId: "explicit-test-model", accountId: "account-a" };
const fingerprint = "b".repeat(64);
const policy = { maximumExposureUsdMicros: 1000, totalExposureUsdMicros: 2000, permitTtlMs: 100, reservationTtlMs: 200, maxEntries: 16 };
function setup() {
  let now = 1000;
  const b = bridge.createExecutorStartBoundary(configuration(), policy, () => now);
  const raw = { schemaVersion: 1, invocationId: "invocation-a", identity: configuration().identity, planId: "plan-a", taskId: "task-a",
    repository: configuration().repository, capability: "coding", mode: "patch_proposal" };
  const d = b.validateInvocation(raw); assert.ok(d.normalizedInvocation);
  const i = d.normalizedInvocation;
  const issue = () => { const d = b.dispatchAuthority.issue(i, target, fingerprint); assert.equal(d.verdict, "allow"); assert.ok(d.permit); return d.permit; };
  const reserve = (id = "reservation-a", amount = 1000) => {
    const d = b.budgetAuthority.reserve(i, target, fingerprint, { reservationId: id, maximumExposureUsdMicros: amount });
    assert.equal(d.verdict, "allow"); assert.ok(d.reservation); return d.reservation;
  };
  return { b, i, raw, issue, reserve, advance: (t: number) => { now = t; } };
}
function blocked(d: { verdict: string; ticket: unknown; reason: string | null }) {
  assert.equal(d.verdict, "blocked"); assert.equal(d.ticket, null); assert.ok(d.reason); assert.ok(Object.isFrozen(d));
}
test("validation is not dispatch authority, reservation alone is not authority", () => {
  const { b, i, reserve } = setup(); assert.equal(i.invocationAuthorized, false);
  blocked(b.providerStartFence.start(i, target, fingerprint, null, null));
  blocked(b.providerStartFence.start(i, target, fingerprint, null, reserve()));
});
test("dispatch without budget reservation is blocked", () => {
  const { b, i, issue } = setup(); blocked(b.providerStartFence.start(i, target, fingerprint, issue(), null));
});
test("expired reservation fails closed independently of timeout and dispatch permit", () => {
  const { b, i, issue, reserve, advance } = setup(), r = reserve(); advance(1200);
  blocked(b.providerStartFence.start(i, target, fingerprint, issue(), r));
  assert.equal(b.budgetAuthority.inspect(r)?.state, "reserved");
});
test("expired/revoked dispatch authority blocks a valid financial reservation", () => {
  const { b, i, issue, reserve, advance } = setup(), p = issue(), r = reserve(); advance(1100);
  blocked(b.providerStartFence.start(i, target, fingerprint, p, r));
  const p2 = issue(); assert.equal(b.dispatchAuthority.revoke(p2), true);
  blocked(b.providerStartFence.start(i, target, fingerprint, p2, r));
});
test("consumed/cancelled reservation is blocked", () => {
  const { b, i, issue, reserve } = setup(), r = reserve(), p = issue();
  const first = b.providerStartFence.start(i, target, fingerprint, p, r); assert.equal(first.verdict, "allow");
  blocked(b.providerStartFence.start(i, target, fingerprint, p, r));
  assert.equal(b.budgetAuthority.cancel(r), false);
  const s = setup(), cancelled = s.reserve(); assert.equal(s.b.budgetAuthority.cancel(cancelled), true);
  blocked(s.b.providerStartFence.start(s.i, target, fingerprint, s.issue(), cancelled));
});
test("same reservation concurrently has exactly one consumer", async () => {
  const { b, i, issue, reserve } = setup(), p = issue(), r = reserve();
  const results = await Promise.all(Array.from({ length: 10 }, async () => b.providerStartFence.start(i, target, fingerprint, p, r)));
  assert.equal(results.filter(d => d.verdict === "allow").length, 1);
  assert.equal(results.filter(d => d.verdict === "blocked").length, 9);
});
test("invocation/task/repository/baseline and exact receipt binding cannot be changed", () => {
  const { b, i, issue, reserve } = setup(), p = issue(), r = reserve();
  for (const replacement of [{}, { invocationId: "different" }, { taskId: "different" }, { planId: "different" },
    { repository: { ...i.repository, baseline: "c".repeat(40) } }, { repository: { ...i.repository, id: "repo-b" } }, { mode: "analysis_only" }]) {
    blocked(b.providerStartFence.start({ ...i, ...replacement }, target, fingerprint, p, r));
  }
});
test("executor A, provider, model, account and canonical request cannot be swapped", () => {
  const { b, i, issue, reserve } = setup(), p = issue(), r = reserve();
  for (const t of [{ ...target, providerId: "other" }, { ...target, modelId: "other" }, { ...target, accountId: "other" }])
    blocked(b.providerStartFence.start(i, t, fingerprint, p, r));
  blocked(b.providerStartFence.start(i, target, "c".repeat(64), p, r));
  const other = setup(); blocked(other.b.providerStartFence.start(other.i, target, fingerprint, p, r));
});
test("caller budget object, ModelInvocation authority and human metadata confer no authority", () => {
  const { b, i, issue, reserve } = setup();
  for (const fake of [{}, { ...reserve() }, { workspaceId: "tenant", invocationId: i.invocationId, reservedCostUsdMicros: 1000 },
    { mode: "human_operated", label: "openai-agents" }, { selectedExecutor: "openai-agents" }]) {
    blocked(b.providerStartFence.start(i, target, fingerprint, issue(), fake));
    blocked(b.providerStartFence.start(i, target, fingerprint, fake, null));
  }
});
test("financial authority is bounded and separate from execution; IDs cannot be reused", () => {
  const { b, i, reserve } = setup(); const r = reserve();
  assert.equal(b.budgetAuthority.reserve(i, target, fingerprint, { reservationId: "too-much", maximumExposureUsdMicros: 1001 }).verdict, "deny");
  reserve("reservation-b");
  assert.equal(b.budgetAuthority.reserve(i, target, fingerprint, { reservationId: "third", maximumExposureUsdMicros: 1 }).verdict, "deny");
  assert.equal(b.budgetAuthority.cancel(r), true);
  assert.equal(b.budgetAuthority.reserve(i, target, fingerprint, { reservationId: "reservation-a", maximumExposureUsdMicros: 1 }).verdict, "deny");
});
test("authority and reservation creation require factual receipt; hostile inputs never invoke getters", () => {
  const { b, i } = setup(); let touched = 0;
  const hostile = Object.defineProperty({}, "modelId", { enumerable: true, get() { touched++; throw Error("sensitive"); } });
  for (const receipt of [null, { ...i }, new Proxy(i, {})]) assert.equal(b.dispatchAuthority.issue(receipt, target, fingerprint).verdict, "deny");
  assert.equal(b.dispatchAuthority.issue(i, hostile, fingerprint).verdict, "deny"); assert.equal(touched, 0);
});
test("clock rollback/failure is fail closed and entry exhaustion never evicts replay protection", () => {
  const { b, i, issue, reserve, advance } = setup(), p = issue(), r = reserve(); advance(999);
  blocked(b.providerStartFence.start(i, target, fingerprint, p, r));
  const limited = bridge.createExecutorStartBoundary(configuration(), { ...policy, maxEntries: 1 }, () => 1000);
  const d = limited.validateInvocation(setup().raw); assert.ok(d.normalizedInvocation);
  assert.equal(limited.dispatchAuthority.issue(d.normalizedInvocation, target, fingerprint).verdict, "allow");
  assert.equal(limited.dispatchAuthority.issue(d.normalizedInvocation, target, fingerprint).verdict, "deny");
});
test("test-only start proof never authorizes production transport, and is single-use", () => {
  const { b, i, issue, reserve } = setup(), r = reserve();
  const d = b.providerStartFence.start(i, target, fingerprint, issue(), r); assert.ok(d.ticket);
  assert.equal(bridge.consumeExecutorStartTicket(d.ticket, i, target, fingerprint, "production"), false);
  assert.equal(bridge.consumeExecutorStartTicket({ ...d.ticket }, i, target, fingerprint, "test"), false);
  assert.equal(bridge.consumeExecutorStartTicket(d.ticket, i, target, fingerprint, "test"), true);
  assert.equal(bridge.consumeExecutorStartTicket(d.ticket, i, target, fingerprint, "test"), false);
});
test("unknown/missing usage never releases exposure or fabricates cost; tokens are observation only", () => {
  const { b, i, issue, reserve } = setup(), r = reserve();
  const d = b.providerStartFence.start(i, target, fingerprint, issue(), r); assert.ok(d.ticket);
  assert.equal(bridge.consumeExecutorStartTicket(d.ticket, i, target, fingerprint, "test"), true);
  const unknown = bridge.observeExecutorUsage(d.ticket, null, false); assert.equal(unknown?.reconciliation, "usage_unknown");
  assert.equal(unknown?.observedCostUsdMicros, null); assert.equal(unknown?.exposureHeldUsdMicros, 1000);
  const partial = bridge.observeExecutorUsage(d.ticket, { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, false);
  assert.equal(partial?.reconciliation, "partially_observed"); assert.equal(partial?.observedCostUsdMicros, null);
  const ambiguous = bridge.observeExecutorUsage(d.ticket, null, true);
  assert.equal(ambiguous?.state, "reconciliation_required"); assert.equal(ambiguous?.exposureHeldUsdMicros, 1000);
  assert.equal(b.budgetAuthority.cancel(r), false);
});
test("malformed usage and forged ticket are fail closed, bounded and deterministic", () => {
  const { b, i, issue, reserve } = setup(), r = reserve();
  const d = b.providerStartFence.start(i, target, fingerprint, issue(), r); assert.ok(d.ticket);
  bridge.consumeExecutorStartTicket(d.ticket, i, target, fingerprint, "test");
  for (const u of [{ inputTokens: 2, outputTokens: 3, totalTokens: 6 }, { inputTokens: -1, outputTokens: 1, totalTokens: 0 },
    { inputTokens: 2, outputTokens: 3, totalTokens: 5, costUsdMicros: 0 }, Array(65).fill(0)]) {
    const a = bridge.observeExecutorUsage(d.ticket, u, false); assert.equal(a?.reconciliation, "reconciliation_required");
    assert.deepEqual(a, bridge.observeExecutorUsage(d.ticket, u, false)); assert.equal(a?.observedCostUsdMicros, null);
  }
  assert.equal(bridge.observeExecutorUsage({}, null, false), null);
});
test("inputs are immutable; public financial snapshots fresh/frozen and contain exact binding", () => {
  const { b, i, reserve } = setup(), r = reserve(); const before = structuredClone(i);
  const first = b.budgetAuthority.inspect(r), second = b.budgetAuthority.inspect(r);
  assert.deepEqual(first, second); assert.notEqual(first, second); assert.ok(Object.isFrozen(first));
  assert.equal(first?.invocationId, i.invocationId); assert.deepEqual(first?.repository, i.repository);
  assert.deepEqual(first?.target, target); assert.deepEqual(i, before);
});
test("a new invocation ID cannot bypass unresolved task/attempt replay protection", () => {
  const { b, i, raw, issue, reserve } = setup();
  const r = reserve(), d = b.providerStartFence.start(i, target, fingerprint, issue(), r); assert.ok(d.ticket);
  bridge.consumeExecutorStartTicket(d.ticket, i, target, fingerprint, "test"); bridge.observeExecutorUsage(d.ticket, null, true);
  const replacement = b.validateInvocation({ ...raw, invocationId: "new-invocation" }); assert.ok(replacement.normalizedInvocation);
  assert.equal(b.dispatchAuthority.issue(replacement.normalizedInvocation, target, fingerprint).verdict, "deny");
  assert.equal(b.budgetAuthority.reserve(replacement.normalizedInvocation, target, fingerprint, { reservationId: "new-reservation", maximumExposureUsdMicros: 1 }).verdict, "deny");
});
test("final ticket consumption rechecks expiry/revocation after the process-local fence", () => {
  for (const cancel of [false, true]) {
    const { b, i, issue, reserve, advance } = setup(), p = issue();
    const d = b.providerStartFence.start(i, target, fingerprint, p, reserve()); assert.ok(d.ticket);
    if (cancel) b.dispatchAuthority.revoke(p); else advance(1100);
    assert.equal(bridge.consumeExecutorStartTicket(d.ticket, i, target, fingerprint, "test"), false);
  }
});
