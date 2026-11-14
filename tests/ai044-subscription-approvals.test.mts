import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionIntent, subscriptionConfiguration } from "./fixtures/ai044-subscription-approval.mts";
const intent = await import(new URL("../lib/executors/ai044-subscription-intent.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-subscription-intent");
const approvals = await import(new URL("../lib/db/ai044-subscription-approvals.ts", import.meta.url).href) as typeof import("../lib/db/ai044-subscription-approvals");
const tenants = await import(new URL("../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../lib/db/workflow-runtime-tenant");
function frozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
function denied(d: import("../lib/db/ai044-subscription-approvals").AI044SubscriptionApprovalDecision) { assert.equal(d.verdict, "deny"); assert.equal(d.approvalRequestId, null); assert.equal(d.intentFingerprint, null); assert.equal(d.approvalCapability, null); assert.equal(d.startCapability, null); frozen(d); }
test("subscription intent is deterministic fresh/frozen immutable and preserves exact binding", () => {
  const input = subscriptionIntent(), before = structuredClone(input), a = intent.normalizeSubscriptionIntent(input), b = intent.normalizeSubscriptionIntent(input); assert.ok(a); assert.ok(b);
  assert.deepEqual(a, b); assert.notEqual(a, b); frozen(a); assert.deepEqual(input, before); assert.equal(intent.subscriptionIntentFingerprint(a), intent.subscriptionIntentFingerprint(b));
  assert.equal(intent.subscriptionIntentCurrent(a, 1000), true); assert.equal(intent.subscriptionIntentCurrent(a, 999), false); assert.equal(intent.subscriptionIntentCurrent(a, 61000), false);
  const shorterApproval = intent.normalizeSubscriptionIntent({ ...input, expiresAt: 2000 }); assert.ok(shorterApproval);
  assert.equal(intent.subscriptionIntentCurrent(shorterApproval, 2000), false, "an expired approval stays denied while external preflight is still current");
});
for (const field of ["api", "credits", "automatic", "limit-100", "limit-zero", "stale-shape", "future-expiry", "registration", "model", "baseline", "path", "bounds", "attempt", "extra", "provider-id"])
  test(`subscription intent fails closed: ${field}`, () => {
    const i = subscriptionIntent();
    if (field === "api") i.accessMode = "api_key";
    if (field === "credits") i.preflight.creditsEnabled = true;
    if (field === "automatic") i.preflight.automaticPurchaseReliedUpon = true;
    if (field === "limit-100") i.preflight.appLimitPercent = 100;
    if (field === "limit-zero") i.preflight.appLimitPercent = 0;
    if (field === "stale-shape") i.preflight.expiresAt = i.preflight.observedAt;
    if (field === "future-expiry") i.preflight.expiresAt = i.preflight.observedAt + 900001;
    if (field === "registration") i.registration.clientId = "other-client";
    if (field === "model") i.model = "test-model\nAuthorization: bearer private";
    if (field === "baseline") i.repository.baseline = "not-a-commit";
    if (field === "path") i.allowedWritePaths = ["src/scanner/a.ts"];
    if (field === "bounds") i.patchBounds.files = 13;
    if (field === "attempt") i.attempt.number = 4;
    if (field === "extra") Object.assign(i, { apiKey: "forbidden" });
    if (field === "provider-id") (i.executor as { id: string }).id = "openai-agents";
    assert.equal(intent.normalizeSubscriptionIntent(i), null);
  });
test("intent hostile inputs never invoke getters or proxy traps", () => {
  let calls = 0; const getter = Object.defineProperty(subscriptionIntent(), "preflight", { enumerable: true, get() { calls++; throw Error("private"); } });
  const proxy = new Proxy({}, { ownKeys() { calls++; throw Error("private"); } });
  assert.equal(intent.normalizeSubscriptionIntent(getter), null); assert.equal(intent.normalizeSubscriptionIntent(proxy), null); assert.equal(calls, 0);
});
for (const [name, clientId] of [["dynamic bootstrap client", "dynamic_agent_client"], ["colon client", "issued:client"], ["129 character client", "a".repeat(129)]])
  test(`subscription immutable intent rejects ${name} even with a self-consistent registration fingerprint`, () => {
    const input = subscriptionIntent(); input.registration.clientId = clientId;
    input.preflight.registrationFingerprint = intent.subscriptionRegistrationFingerprint(input.registration);
    assert.equal(intent.normalizeSubscriptionRegistration(input.registration), null);
    assert.equal(intent.normalizeSubscriptionIntent(input), null);
  });
test("start capability cannot be reconstructed from JSON, typed shape, getter, or proxy", () => {
  for (const value of [null, {}, { kind: "ai044_subscription_start" }, Object.freeze({ kind: "ai044_subscription_start" }), new Proxy({}, {})]) assert.equal(approvals.consumeAI044SubscriptionStartCapability(value), null);
});
async function setup() {
  const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver({ connect: async () => ({ async query() { return { rows: [{ workspace_database_id: "00000000-0000-4000-8000-0000000000a1", domain_workspace_id: "workspace-primary", status: "active" }], rowCount: 1 }; }, release() {} }) }).resolve("workspace-primary"); assert.ok(tenant);
  let connects = 0, identityReads = 0;
  const c = { database: { async connect(): Promise<never> { connects++; throw Error("private-driver-canary"); } }, tenant, projectId: "project-a", projectTaskId: "owner-task-a", configuration: subscriptionConfiguration(),
    identitySource: { resolve() { identityReads++; return { userId: "00000000-0000-4000-8000-0000000000a2" }; } } };
  return { c, store: approvals.createAI044SubscriptionApprovals(c), counts: () => ({ connects, identityReads }) };
}
test("approval factory rejects cloned tenant and unknown credential port", async () => {
  const { c } = await setup(); assert.throws(() => approvals.createAI044SubscriptionApprovals({ ...c, tenant: { ...c.tenant } }));
  assert.throws(() => approvals.createAI044SubscriptionApprovals({ ...c, credentials: { accessToken() { assert.fail("early token read"); } } }));
});
test("invalid approval inputs and wrong workspace/project/attempt cannot access DB or identity", async () => {
  const x = await setup();
  for (const change of [(i: ReturnType<typeof subscriptionIntent>) => { i.workspaceId = "wrong"; }, (i: ReturnType<typeof subscriptionIntent>) => { i.projectId = "wrong"; },
    (i: ReturnType<typeof subscriptionIntent>) => { i.attempt.developmentRunId = "wrong"; }, (i: ReturnType<typeof subscriptionIntent>) => { i.contextFingerprint = "invalid"; }]) {
    const i = subscriptionIntent(); change(i); denied(await x.store.request({ commandId: "request", intent: i }));
    denied(await x.store.check({ approvalRequestId: "00000000-0000-4000-8000-0000000000a3", intent: i }));
  }
  denied(await x.store.fence({ approvalCapability: { kind: "ai044_subscription_approval" } })); assert.deepEqual(x.counts(), { connects: 0, identityReads: 0 });
});
test("driver failure is opaque/frozen and permanently closes instance without retry", async () => {
  const x = await setup(), input = { commandId: "request", intent: subscriptionIntent() }, before = structuredClone(input);
  const d = await x.store.request(input); denied(d); assert.equal(d.status, "recovery_required"); denied(await x.store.request(input)); assert.equal(x.counts().connects, 1); assert.deepEqual(input, before);
  assert.ok(!JSON.stringify(d).includes("private-driver-canary"));
});
