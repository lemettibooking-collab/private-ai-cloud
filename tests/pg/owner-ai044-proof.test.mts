import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionApprovalPgFixture } from "../fixtures/ai044-subscription-approval-pg.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createSubscriptionFixture, subscriptionTestPath } from "../fixtures/ai044-subscription.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createOwnerAI044Proof } from "../../lib/composition/owner-ai044-proof.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createAI044SubscriptionRun } from "../../lib/composition/ai044-subscription-run.ts";
import type { OwnerAI044ProofView, OwnerAI044ProofDependencies } from "../../lib/composition/owner-ai044-proof";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const db = await live.useLiveDatabase("owner_ai044_proof");
function available(v: OwnerAI044ProofView): asserts v is Extract<OwnerAI044ProofView, { status: "available" }> { assert.equal(v.status, "available"); }
async function setup(label: string, ambiguous = false) {
  const x = await subscriptionApprovalPgFixture(db, `owner-${label}`, { registerAuthority: false });
  assert.equal((await x.controller.createRun({ ...await x.command(), developmentRunId: x.intent.attempt.developmentRunId,
    developmentTaskId: x.intent.taskId, admission: x.configuration.admission })).status, "applied");
  let state = await x.controller.read("project-a", x.task.taskId); assert.ok(state);
  assert.equal((await x.controller.transitionRun({ ...await x.command(), developmentRunId: x.intent.attempt.developmentRunId, expectedRunRevision: state.runs[0].revision, event: { type: "start_attempt" } })).status, "applied");
  state = await x.controller.read("project-a", x.task.taskId); assert.ok(state?.approvedPlan);
  const configuration = { ...x.configuration, developmentRun: state.runs[0].run };
  const foundation = await createSubscriptionFixture({ ownerUserId: x.ownerId, configuration, intent: x.intent });
  let posts = 0, now = Date.now();
  let resolve: OwnerAI044ProofDependencies["identitySource"]["resolve"] = x.identitySource.resolve;
  const transport: typeof fetch = async () => {
    posts++; if (ambiguous) throw Error("SYNTHETIC_PRIVATE_PROVIDER_ERROR");
    const event = { type: "response.completed", response: { id: "resp_owner_proof", model: foundation.intent.model, status: "completed", error: null, incomplete_details: null,
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(foundation.proposal) }] }] } };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  const dependencies: OwnerAI044ProofDependencies = { database: x.database, domainWorkspaceId: x.tenant.workspaceId, identitySource: { resolve: () => resolve() },
    policy: { projectId: "project-a", projectTaskId: x.task.taskId, developmentRunId: state.runs[0].run.id,
      planRevision: state.approvedPlan.revision, planFingerprint: state.approvedPlan.draftFingerprint, repository: configuration.repository,
      repositoryRoot: "/tmp/not-read-by-injected-exact-object-port", repositoryAllowlist: configuration.admission.repositoryAllowlist as string[], readContextPaths: [subscriptionTestPath] },
    clock: () => now, readSubscriptionFacts: () => foundation.connection.readSubscriptionFacts(),
    preparation(input) { const root = compose(input); return Object.freeze({ prepare: root.prepare }); }, execution: compose };
  function compose(input: Parameters<OwnerAI044ProofDependencies["execution"]>[0] | Parameters<OwnerAI044ProofDependencies["preparation"]>[0]) {
    return createAI044SubscriptionRun({ database: input.database, tenant: input.tenant, projectId: input.projectId, projectTaskId: input.projectTaskId,
      configuration: input.configuration, identitySource: input.identitySource, connection: foundation.connection, contextSource: foundation.contextSource,
      transport, clock: () => now, readContextPolicy: input.readContextPolicy, ...("controllerBinding" in input ? { controllerBinding: input.controllerBinding } : {}) });
  }
  // NEW instance for every HTTP-equivalent call: no retained receipt/cache/closure authority.
  const load = () => createOwnerAI044Proof(dependencies).load();
  async function action(name: string, v?: OwnerAI044ProofView) {
    const view = v ?? await load(); available(view);
    return createOwnerAI044Proof(dependencies).act({ action: name, selection: view.selection,
      attestation: name === "prepare" ? { registration: view.registration, model: view.model, appLimitPercent: 50, confirmed: true } : null });
  }
  return { ...x, foundation, dependencies, load, action, posts: () => posts, expire: () => { now += 16 * 60 * 1000; },
    revokeSession: () => { resolve = () => null; }, setIdentity: (userId: string) => { resolve = () => ({ userId }); } };
}
test("Owner proof PG: fresh requests prepare/request/approve with ZERO POST, explicit invoke ONE, canonical durable result and replay blocked", async () => {
  const x = await setup("pipeline");
  try {
    const initial = await x.load(); available(initial); assert.equal(initial.phase, "NOT_PREPARED");
    let v = await x.action("prepare", initial); available(v); assert.equal(v.phase, "PREPARED"); assert.equal(x.posts(), 0);
    assert.equal(x.foundation.counters.tokenReads, 0);
    assert.deepEqual(await x.action("invoke", v), { status: "unavailable" }); assert.equal(x.posts(), 0);
    v = await x.action("request", v); available(v); assert.equal(v.phase, "AWAITING_OWNER_APPROVAL"); assert.equal(x.posts(), 0);
    assert.deepEqual(await x.action("invoke", v), { status: "unavailable" }); assert.equal(x.posts(), 0);
    v = await x.action("approve", v); available(v); assert.equal(v.phase, "APPROVED"); assert.equal(x.posts(), 0); assert.equal(x.foundation.counters.tokenReads, 0);
    v = await x.action("invoke", v); available(v); assert.equal(v.phase, "COMPLETED"); assert.equal(x.posts(), 1);
    assert.equal(v.result?.ownerDecisionRequired, true); assert.equal(v.result?.verificationStatus, "not_run"); assert.equal(v.result?.automaticRetryAllowed, false);
    const fresh = await x.load(); assert.deepEqual(fresh, v); assert.notEqual(fresh, v); assert.ok(Object.isFrozen(v)); assert.ok(Object.isFrozen(v.result)); assert.ok(Object.isFrozen(v.readContextPaths));
    assert.deepEqual(await x.action("invoke", v), { status: "unavailable" }); assert.equal(x.posts(), 1);
    assert.equal(/SYNTHETIC|accessToken|refreshToken|clientId|subjectHash|repositoryRoot|startCapability/u.test(JSON.stringify(v)), false);
    assert.equal(v.runtimeDispatchAllowed, false); assert.equal(v.productionLiveDispatch, "BLOCKED");
  } finally { await x.foundation.cleanup(); }
});
test("Owner proof PG: concurrent explicit invokes across separate roots still dispatch at most once", async () => {
  const x = await setup("concurrent"); try {
    await x.action("prepare"); await x.action("request"); const approved = await x.action("approve");
    await Promise.all([x.action("invoke", approved), x.action("invoke", approved)]);
    assert.equal(x.posts(), 1); const v = await x.load(); available(v); assert.equal(v.phase, "COMPLETED");
  } finally { await x.foundation.cleanup(); }
});
test("Owner proof PG: actual Owner role revocation after approval blocks invoke and zero token reads", async () => {
  const x = await setup("revocation"); try {
    await x.action("prepare"); await x.action("request"); const approved = await x.action("approve");
    const c = await x.database.connect(); try {
      const q = await c.query("update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2", [x.tenant.workspaceDatabaseId, x.ownerId]); assert.equal(q.rowCount, 1);
    } finally { c.release(); }
    assert.deepEqual(await x.action("invoke", approved), { status: "unavailable" }); assert.equal(x.posts(), 0); assert.equal(x.foundation.counters.tokenReads, 0);
  } finally { await x.foundation.cleanup(); }
});
test("Owner proof PG: revocation between exact-context prepare and intent commit blocks durable enrollment", async () => {
  const x = await setup("prepare-revoke"); try {
    const v = await x.load(); available(v);
    const dependencies: OwnerAI044ProofDependencies = { ...x.dependencies, preparation(input) {
      const root = x.dependencies.preparation(input);
      return { async prepare(raw: unknown) {
        const prepared = await root.prepare(raw);
        const c = await x.database.connect(); try {
          await c.query("update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2", [x.tenant.workspaceDatabaseId, x.ownerId]);
        } finally { c.release(); }
        return prepared;
      } };
    } };
    assert.deepEqual(await createOwnerAI044Proof(dependencies).act({ action: "prepare", selection: v.selection,
      attestation: { registration: v.registration, model: v.model, appLimitPercent: 50, confirmed: true } }), { status: "unavailable" });
    const c = await x.database.connect(); try {
      const q = await c.query("select 1 from controller_attempt_intents where workspace_id=$1 and development_run_id=$2", [x.tenant.workspaceDatabaseId, x.intent.attempt.developmentRunId]); assert.equal(q.rowCount, 0);
    } finally { c.release(); }
    assert.equal(x.posts(), 0); assert.equal(x.foundation.counters.tokenReads, 0);
  } finally { await x.foundation.cleanup(); }
});
test("Owner proof PG: REJECT is durable, zero POST and cannot be converted into invocation", async () => {
  const x = await setup("reject"); try {
    await x.action("prepare"); await x.action("request"); const v = await x.action("reject"); available(v); assert.equal(v.phase, "REJECTED");
    assert.deepEqual(await x.action("invoke", v), { status: "unavailable" }); assert.equal(x.posts(), 0); assert.equal(x.foundation.counters.tokenReads, 0);
  } finally { await x.foundation.cleanup(); }
});
test("Owner proof PG: ambiguous POST holds one-shot state across process-equivalent replay/new command", async () => {
  const x = await setup("ambiguous", true); try {
    await x.action("prepare"); await x.action("request"); const approved = await x.action("approve");
    const v = await x.action("invoke", approved); available(v); assert.equal(v.phase, "RECOVERY_REQUIRED"); assert.equal(v.result, null); assert.equal(x.posts(), 1);
    assert.deepEqual(await x.action("invoke", approved), { status: "unavailable" }); assert.deepEqual(await x.action("invoke", v), { status: "unavailable" });
    assert.deepEqual(await x.action("prepare", v), { status: "unavailable" }); assert.equal(x.posts(), 1);
    const c = await x.database.connect(); try {
      const q = await c.query("select state,normalized_result_payload from ai044_subscription_approval_bindings where workspace_id=$1 and development_run_id=$2", [x.tenant.workspaceDatabaseId, x.intent.attempt.developmentRunId]);
      assert.equal(q.rowCount, 1); assert.equal(q.rows[0].state, "outcome_unknown"); assert.equal(q.rows[0].normalized_result_payload, null);
    } finally { c.release(); }
  } finally { await x.foundation.cleanup(); }
});
for (const mode of ["unauthenticated", "non-owner", "expired", "changed-model", "changed-context", "changed-selection"] as const) test(`Owner proof PG: ${mode} denies without provider POST`, async () => {
  const x = await setup(mode); try {
    const original = await x.load(); available(original);
    if (mode === "unauthenticated" || mode === "non-owner") {
      if (mode === "unauthenticated") x.revokeSession(); else x.setIdentity("00000000-0000-4000-8000-000000009999");
      assert.deepEqual(await x.action("prepare", original), { status: "unavailable" });
    } else {
      await x.action("prepare"); await x.action("request"); const approved = await x.action("approve"); available(approved);
      if (mode === "expired") x.expire();
      if (mode === "changed-model") {
        const all = await x.foundation.store.readRegistrations(); assert.ok(all); const registration = { ...all.registrations[0], selectedModel: "different-model" };
        await x.foundation.store.writeRegistrations({ ...all, registrations: [registration] });
      }
      if (mode === "changed-context") {
        const input = { ...x.dependencies, policy: { ...x.dependencies.policy, readContextPaths: ["src/unapproved.ts"] } };
        assert.deepEqual(await createOwnerAI044Proof(input).act({ action: "invoke", selection: approved.selection, attestation: null }), { status: "unavailable" });
      } else assert.deepEqual(await x.action("invoke", mode === "changed-selection" ? { ...approved, selection: "0".repeat(64) } : approved), { status: "unavailable" });
    }
    assert.equal(x.posts(), 0); assert.equal(x.foundation.counters.tokenReads, 0);
  } finally { await x.foundation.cleanup(); }
});
