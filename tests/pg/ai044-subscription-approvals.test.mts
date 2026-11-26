import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionApprovalPgFixture } from "../fixtures/ai044-subscription-approval-pg.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const approvals = await import(new URL("../../lib/db/ai044-subscription-approvals.ts", import.meta.url).href) as typeof import("../../lib/db/ai044-subscription-approvals");
const contracts = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const intents = await import(new URL("../../lib/executors/ai044-subscription-intent.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-subscription-intent");
const transaction = await import(new URL("../../lib/db/executor-start-transaction.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-transaction");
const barriers = await import(new URL("../../lib/db/executor-predecessor-barrier.ts", import.meta.url).href) as typeof import("../../lib/db/executor-predecessor-barrier");
const paidStores = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const paidPolicy = await import(new URL("../../lib/executors/openai-agents-request.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-request");
const db = await live.useLiveDatabase("subscription_approvals");
function denied(d: import("../../lib/db/ai044-subscription-approvals").AI044SubscriptionApprovalDecision) { assert.equal(d.verdict, "deny", JSON.stringify(d)); assert.equal(d.approvalCapability, null); assert.equal(d.startCapability, null); assert.equal(d.approvalRequestId, null); assert.equal(d.intentFingerprint, null); }
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function result(x: Awaited<ReturnType<typeof subscriptionApprovalPgFixture>>, failed = false) {
  const adapter = contracts.createExecutorAdapterContract(x.configuration).adapter; assert.ok(adapter);
  const invocation = adapter.validateInvocation(x.invocation).normalizedInvocation; assert.ok(invocation);
  const content = "export const analytics = 1;\n", report = "Unverified proposal for independent local QA and Owner review.";
  const d = adapter.evaluateResult(invocation, { schemaVersion: 1, invocationId: invocation.invocationId, identity: invocation.identity, status: failed ? "failed" : "succeeded", failureCode: failed ? "provider_failure" : null,
    changes: failed ? [] : [{ path: "src/server/terminal/account/analytics.ts", operation: "add", content, sha256: hash(content) }], report: failed ? null : { content: report, sha256: hash(report) } }); assert.ok(d.normalizedResult); return d.normalizedResult;
}
async function started(label: string) {
  const x = await subscriptionApprovalPgFixture(db, label), id = await x.approve(), consumed = await x.store.consume({ approvalRequestId: id, intent: x.intent });
  assert.equal(consumed.status, "consumed", JSON.stringify(consumed)); assert.ok(consumed.approvalCapability);
  const fenced = await x.store.fence({ approvalCapability: consumed.approvalCapability }); assert.equal(fenced.status, "started", JSON.stringify(fenced)); assert.ok(fenced.startCapability);
  return { ...x, id, consumed, fenced };
}
test("PG subscription queue request is not approval and grants no capability", async () => {
  const x = await subscriptionApprovalPgFixture(db, "pending"), r = await x.store.request({ commandId: "request", intent: x.intent }); assert.equal(r.status, "requested");
  assert.equal(r.approvalCapability, null); assert.equal(r.startCapability, null);
  denied(await x.store.check({ approvalRequestId: r.approvalRequestId, intent: x.intent })); denied(await x.store.consume({ approvalRequestId: r.approvalRequestId, intent: x.intent }));
  assert.equal((await db.admin.query("select count(*)::int n from approval_decisions where workspace_id=$1 and approval_request_id=$2", [x.workspaceId, r.approvalRequestId])).rows[0].n, 0);
});
test("PG approval binds exact read set independently of admitted write scope", async () => {
  const x = await subscriptionApprovalPgFixture(db, "read-set"), id = await x.approve(), before = structuredClone(x.intent);
  for (const change of [
    { readContextPaths: [...x.intent.readContextPaths, "docs/architecture.md"] },
    { readContextPaths: [...x.intent.readContextPaths, "docs/architecture.md"], contextFingerprint: "f".repeat(64) },
    { allowedWritePaths: [...x.intent.allowedWritePaths, "docs"] },
  ]) {
    const different = intents.normalizeSubscriptionIntent({ ...x.intent, ...change }); assert.ok(different);
    assert.notEqual(intents.subscriptionIntentFingerprint(different), intents.subscriptionIntentFingerprint(x.intent));
    denied(await x.store.consume({ approvalRequestId: id, intent: different }));
  }
  const payload = JSON.parse((await db.admin.query("select intent_payload from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [x.workspaceId, id])).rows[0].intent_payload);
  assert.deepEqual(payload.readContextPaths, x.intent.readContextPaths); assert.deepEqual(payload.allowedWritePaths, x.intent.allowedWritePaths);
  assert.equal((await x.store.check({ approvalRequestId: id, intent: x.intent })).status, "ready"); assert.deepEqual(x.intent, before);
});
test("PG subscription generic FeaturePlan repository and new baseline need no cancelled target SHA", async () => {
  const repository = { id: "future-feature-repository", baseline: "a".repeat(40) };
  const x = await subscriptionApprovalPgFixture(db, "new-baseline", { repository }), id = await x.approve();
  assert.deepEqual(x.intent.repository, repository);
  const consumed = await x.store.consume({ approvalRequestId: id, intent: x.intent }); assert.ok(consumed.approvalCapability);
  const fenced = await x.store.fence({ approvalCapability: consumed.approvalCapability }); assert.ok(fenced.startCapability);
  assert.deepEqual(approvals.consumeAI044SubscriptionStartCapability(fenced.startCapability)?.intent.repository, repository);
});
test("PG subscription exact Owner approval commits one use, fresh private fence and canonical result", async () => {
  const x = await started("normal"), evidence = approvals.consumeAI044SubscriptionStartCapability(x.fenced.startCapability); assert.ok(evidence); assert.deepEqual(evidence.intent, x.intent);
  assert.equal(approvals.consumeAI044SubscriptionStartCapability(x.fenced.startCapability), null);
  const normalizedResult = result(x), resultFingerprint = approvals.subscriptionResultFingerprint(normalizedResult), command = { approvalRequestId: x.id, intent: x.intent, state: "completed", normalizedResult, resultFingerprint };
  assert.equal((await x.store.recordOutcome(command)).status, "completed"); assert.equal((await x.store.recordOutcome(command)).status, "idempotent");
  const historical = await transaction.inTransaction(x.database, client => approvals.readAI044SubscriptionOutcomeInTransaction(client, x.tenant, { projectId: "project-a", projectTaskId: x.task.taskId,
    configuration: x.configuration, invocation: x.invocation, intentFingerprint: intents.subscriptionIntentFingerprint(x.intent) }));
  assert.ok(historical); assert.deepEqual(historical.normalizedResult, normalizedResult); assert.equal(historical.resultFingerprint, resultFingerprint);
  assert.equal(Object.isFrozen(historical.normalizedResult), true);
  const b = (await db.admin.query("select state,owner_actor_id::text,decision_id::text,authority_generation,result_fingerprint from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [x.workspaceId, x.id])).rows[0];
  assert.equal(b.state, "completed"); assert.equal(b.owner_actor_id, x.ownerId); assert.equal(b.authority_generation, 1); assert.equal(b.result_fingerprint, resultFingerprint);
  assert.equal((await db.admin.query("select count(*)::int n from executor_attempt_exposures where workspace_id=$1", [x.workspaceId])).rows[0].n, 0, "subscription route never fabricates paid exposure");
});
test("PG consumed approval replay and recreated factory never issue another right", async () => {
  const x = await started("replay"), replay = approvals.createAI044SubscriptionApprovals(x.config);
  for (let n = 0; n < 3; n++) { denied(await x.store.consume({ approvalRequestId: x.id, intent: x.intent })); denied(await replay.consume({ approvalRequestId: x.id, intent: x.intent })); }
  denied(await replay.fence({ approvalCapability: x.consumed.approvalCapability })); denied(await x.store.fence({ approvalCapability: x.consumed.approvalCapability }));
  assert.equal((await db.admin.query("select count(*)::int n from audit_events where workspace_id=$1 and entity_id=$2 and event_type='ai044.subscription_started'", [x.workspaceId, x.id])).rows[0].n, 1);
});
test("PG concurrent exact approval consumers yield exactly one committed capability", async () => {
  const x = await subscriptionApprovalPgFixture(db, "race"), id = await x.approve();
  const decisions = await Promise.all(Array.from({ length: 8 }, () => approvals.createAI044SubscriptionApprovals(x.config).consume({ approvalRequestId: id, intent: x.intent })));
  assert.equal(decisions.filter(d => d.approvalCapability !== null).length, 1); for (const d of decisions.filter(d => !d.approvalCapability)) denied(d);
});
test("PG current authority revoked after consumption blocks pre-provider fence", async () => {
  const x = await subscriptionApprovalPgFixture(db, "revoked"), id = await x.approve(), d = await x.store.consume({ approvalRequestId: id, intent: x.intent }); assert.ok(d.approvalCapability);
  assert.equal((await x.authority.revokeCurrentAuthority()).status, "revoked"); denied(await x.store.fence({ approvalCapability: d.approvalCapability }));
  assert.equal((await db.admin.query("select state,started_at from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [x.workspaceId, id])).rows[0].started_at, null);
});
test("PG wrong client/model/context/plan binding deny without consuming approval", async () => {
  const x = await subscriptionApprovalPgFixture(db, "drift"), id = await x.approve(), before = structuredClone(x.intent);
  for (const field of ["client", "model", "context", "plan", "workspace", "baseline"]) {
    const i = structuredClone(x.intent) as unknown as ReturnType<typeof import("../fixtures/ai044-subscription-approval.mts").subscriptionIntent>;
    if (field === "client") { i.registration.clientId = "other-client"; i.preflight.registrationFingerprint = intents.subscriptionRegistrationFingerprint(i.registration); }
    if (field === "model") i.model = "other-model"; if (field === "context") i.contextFingerprint = "f".repeat(64); if (field === "plan") i.planFingerprint = "d".repeat(64);
    if (field === "workspace") i.workspaceId = "foreign"; if (field === "baseline") i.repository.baseline = "e".repeat(40);
    denied(await x.store.consume({ approvalRequestId: id, intent: i }));
  }
  assert.deepEqual(x.intent, before); assert.equal((await x.store.check({ approvalRequestId: id, intent: x.intent })).status, "ready");
});
test("PG stale one-shot approval fails closed using factual DB clock", async () => {
  const x = await subscriptionApprovalPgFixture(db, "expiry"), expiry = Date.now() + 1500, i = { ...x.intent, expiresAt: expiry };
  const asked = await x.store.request({ commandId: "expiring-request", intent: i }); assert.equal(asked.status, "requested");
  assert.equal((await x.store.decide({ commandId: "expiring-decision", approvalRequestId: asked.approvalRequestId, intentFingerprint: asked.intentFingerprint, decision: "approved" })).status, "approved");
  await live.sleep(1600); denied(await x.store.check({ approvalRequestId: asked.approvalRequestId, intent: i })); denied(await x.store.consume({ approvalRequestId: asked.approvalRequestId, intent: i }));
});
test("PG ambiguous subscription evidence blocks redispatch and successor predecessor barrier", async () => {
  const x = await started("ambiguous"); const command = { approvalRequestId: x.id, intent: x.intent, state: "outcome_unknown", normalizedResult: null, resultFingerprint: null };
  assert.equal((await x.store.recordOutcome(command)).status, "outcome_unknown"); assert.equal((await x.store.recordOutcome(command)).status, "idempotent");
  denied(await x.store.consume({ approvalRequestId: x.id, intent: x.intent }));
  assert.equal(await transaction.inTransaction(x.database, c => barriers.executorPredecessorsClear(c, x.workspaceId, x.intent.attempt.developmentRunId, 2)), false);
  const normalizedResult = result(x); denied(await x.store.recordOutcome({ ...command, state: "completed", normalizedResult, resultFingerprint: approvals.subscriptionResultFingerprint(normalizedResult) }));
  const stored = (await db.admin.query("select state,result_fingerprint,normalized_result_payload from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [x.workspaceId, x.id])).rows[0];
  assert.deepEqual(stored, { state: "outcome_unknown", result_fingerprint: null, normalized_result_payload: null });
});
test("PG definitive failure stores exact canonical result and clears predecessor only after terminal capture", async () => {
  const x = await started("failed"); assert.equal(await transaction.inTransaction(x.database, c => barriers.executorPredecessorsClear(c, x.workspaceId, x.intent.attempt.developmentRunId, 2)), false);
  const normalizedResult = result(x, true); assert.equal((await x.store.recordOutcome({ approvalRequestId: x.id, intent: x.intent, state: "failed", normalizedResult, resultFingerprint: approvals.subscriptionResultFingerprint(normalizedResult) })).status, "failed");
  assert.equal(await transaction.inTransaction(x.database, c => barriers.executorPredecessorsClear(c, x.workspaceId, x.intent.attempt.developmentRunId, 2)), true);
});
test("PG raw queue approval without typed binding or immutable decision is rejected", async () => {
  const x = await subscriptionApprovalPgFixture(db, "db-queue");
  await assert.rejects(db.admin.query("insert into approval_requests(workspace_id,action_type,status,risk_level) values($1,'ai044_subscription_executor','pending','high')", [x.workspaceId]), (e: unknown) => (e as { code?: string }).code === "23514");
  const asked = await x.store.request({ commandId: "request", intent: x.intent });
  await assert.rejects(db.admin.query("update approval_requests set status='approved',approved_by=$3,resolved_at=clock_timestamp() where workspace_id=$1 and id=$2", [x.workspaceId, asked.approvalRequestId, x.ownerId]), (e: unknown) => (e as { code?: string }).code === "23514");
});
test("PG approval bindings/Owner decisions/captured results cannot be rewritten or deleted", async () => {
  const x = await started("immutable");
  for (const sql of ["update ai044_subscription_approval_bindings set intent_fingerprint=repeat('a',64) where workspace_id=$1 and approval_request_id=$2", "delete from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2",
    "update approval_decisions set decision='rejected' where workspace_id=$1 and approval_request_id=$2", "delete from approval_decisions where workspace_id=$1 and approval_request_id=$2"])
    await assert.rejects(db.admin.query(sql, [x.workspaceId, x.id]), (e: unknown) => (e as { code?: string }).code === "55000");
});
test("PG malformed result, wrong invocation or self-QA cannot become durable terminal evidence", async () => {
  const x = await started("bad-result"), valid = result(x);
  for (const change of [{ invocationId: "wrong" }, { verificationStatus: "passed" }, { ownerDecisionRequired: false }, { automaticRetryAllowed: true }, { changes: [] }]) {
    const normalizedResult = { ...valid, ...change };
    denied(await x.store.recordOutcome({ approvalRequestId: x.id, intent: x.intent, state: "completed", normalizedResult, resultFingerprint: approvals.subscriptionResultFingerprint(normalizedResult) }));
  }
});
function adversarialPaidStore(x: Awaited<ReturnType<typeof subscriptionApprovalPgFixture>>) {
  // Deliberately misuse the paid internal factory with this same factual profile/attempt.
  // No provider is available: this proves the shared DB fence, not a supported paid route.
  return paidStores.createPostgresExecutorStartStore({ database: x.database, tenant: x.tenant, projectId: "project-a", configuration: x.configuration,
    target: { providerId: "openai", modelId: "test-plan-model", accountId: "test-paid-account" }, requestPolicy: paidPolicy.createOpenAIAgentsRequestPolicy(),
    financialPolicy: { maximumExposureUsdMicros: 10000, totalExposureUsdMicros: 1000000, reservationTtlMs: 60000 }, authorizeStart: () => true });
}
test("PG subscription consumption forbids a second paid right for the exact attempt", async () => {
  const x = await started("no-paid-dupe"), paid = adversarialPaidStore(x), d = await paid.reserve(x.invocation, { maximumExposureUsdMicros: 10000 });
  assert.equal(d.verdict, "deny"); assert.equal(d.startCapability, null);
  assert.equal((await db.admin.query("select count(*)::int n from executor_attempt_exposures where workspace_id=$1", [x.workspaceId])).rows[0].n, 0);
});
test("PG an existing paid right forbids subscription consumption for the exact attempt", async () => {
  const x = await subscriptionApprovalPgFixture(db, "no-sub-dupe"), id = await x.approve(), paid = adversarialPaidStore(x);
  assert.equal((await paid.reserve(x.invocation, { maximumExposureUsdMicros: 10000 })).status, "reserved");
  denied(await x.store.consume({ approvalRequestId: id, intent: x.intent }));
  assert.equal((await db.admin.query("select state from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [x.workspaceId, id])).rows[0].state, "ready");
});
for (const stage of ["consume", "fence"] as const) test(`PG ${stage} lost COMMIT acknowledgement never issues a capability after restart`, async () => {
  const x = await subscriptionApprovalPgFixture(db, `ack-${stage}`), id = await x.approve();
  const consumed = stage === "fence" ? await x.store.consume({ approvalRequestId: id, intent: x.intent }) : null;
  const interceptor = live.installQueryInterceptor();
  interceptor.rules.push(live.rule("lost subscription commit acknowledgement", live.sqlTag("executor-transaction:commit"), async (_client, cfg, values, send) => { await send(cfg, values); throw Error("private-commit-canary"); }));
  try {
    const d = stage === "consume" ? await x.store.consume({ approvalRequestId: id, intent: x.intent }) : await x.store.fence({ approvalCapability: consumed?.approvalCapability });
    denied(d); assert.equal(d.status, "recovery_required"); assert.ok(!JSON.stringify(d).includes("private-commit-canary"));
  } finally { interceptor.restore(); }
  const fresh = approvals.createAI044SubscriptionApprovals(x.config); denied(await fresh.consume({ approvalRequestId: id, intent: x.intent }));
  const b = (await db.admin.query("select state from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [x.workspaceId, id])).rows[0];
  assert.equal(b.state, stage === "consume" ? "consumed" : "started");
});
