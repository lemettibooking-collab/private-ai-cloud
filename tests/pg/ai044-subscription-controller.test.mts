import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionApprovalPgFixture } from "../fixtures/ai044-subscription-approval-pg.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { candidate, requirement } from "../fixtures/executor-routing.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createSubscriptionFixture, subscriptionTestPath } from "../fixtures/ai044-subscription.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const db = await live.useLiveDatabase("subscription_controller");
const contexts = await import(new URL("../../lib/executors/ai044-subscription-context.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-subscription-context");
const common = await import(new URL("../../lib/executors/ai044-proof-binding.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-proof-binding");
const intents = await import(new URL("../../lib/executors/ai044-subscription-intent.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-subscription-intent");
const routers = await import(new URL("../../lib/executors/executor-router.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-router");
const contracts = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const authorities = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const approvals = await import(new URL("../../lib/db/ai044-subscription-approvals.ts", import.meta.url).href) as typeof import("../../lib/db/ai044-subscription-approvals");
const roadmap = await import(new URL("../../lib/roadmap/roadmap-contract.ts", import.meta.url).href) as typeof import("../../lib/roadmap/roadmap-contract");
const gates = await import(new URL("../../lib/roadmap/development-gates.ts", import.meta.url).href) as typeof import("../../lib/roadmap/development-gates");
const composition = await import(new URL("../../lib/composition/ai044-subscription-run.ts", import.meta.url).href) as typeof import("../../lib/composition/ai044-subscription-run");
const path = "src/server/terminal/account/analytics.ts";
async function setup(label: string) {
  const x = await subscriptionApprovalPgFixture(db, label, { registerAuthority: false });
  let n = 0;
  assert.equal((await x.controller.createRun({ ...await x.command(), developmentRunId: x.intent.attempt.developmentRunId, developmentTaskId: x.intent.taskId, admission: x.configuration.admission })).status, "applied");
  async function state() { const s = await x.controller.read("project-a", x.task.taskId); assert.ok(s?.approvedPlan); return s; }
  async function transition(event: unknown) { const s = await state(), run = s.runs[0]; return x.controller.transitionRun({ ...await x.command(), developmentRunId: run.run.id, expectedRunRevision: run.revision, event }); }
  assert.equal((await transition({ type: "start_attempt" })).status, "applied");
  async function prepare() {
    const s = await state(), run = s.runs[0], configuration = { ...x.configuration, developmentRun: run.run };
    const attempt = { developmentRunId: run.run.id, number: run.run.currentAttemptNumber, kind: run.run.currentAttemptNumber === 1 ? "initial" as const : "corrective" as const };
    const c = await contexts.createAI044SubscriptionContextSource({ readExactObject: async () => ({ kind: "absent" }) }).prepare({ repository: configuration.repository, projectTaskId: x.task.taskId,
      planId: s.approvedPlan!.planId, planRevision: s.approvedPlan!.revision, planFingerprint: s.approvedPlan!.draftFingerprint, taskId: run.run.taskId, attempt, allowedWritePaths: run.run.admittedAllowedPaths, readContextPaths: [path] }, [path]);
    assert.ok(c.context); const context = contexts.ai044SubscriptionContextManifest(c.context); assert.ok(context);
    const intent = intents.normalizeSubscriptionIntent({ ...x.intent, contextFingerprint: context.fingerprint, attempt, invocationId: `invocation-${attempt.number}`,
      preflight: { ...x.intent.preflight, receiptId: `receipt-${attempt.number}` } }); assert.ok(intent);
    const invocation = { ...x.invocation, invocationId: intent.invocationId, attempt };
    const routeCandidate = { ...candidate(), executor: intent.executor, capabilities: ["coding"], modes: ["patch_proposal"], artifacts: ["patch", "report"],
      environment: { id: "subscription-proposal", kind: "patch_proposal_only" }, accessModes: ["subscription_session"], estimatedCostUsdMicros: null };
    const router = routers.createExecutorRouter([routeCandidate]).router; assert.ok(router);
    const policy = { ...requirement().policy, accessModes: ["subscription_session"], requiredExecutorId: "chatgpt-plan-patch", environment: { kinds: ["patch_proposal_only"], capabilities: [], residency: null, privacy: [] } };
    const taskClass = attempt.number === 1 ? "implementation" : "repair", decision = router.select({ admission: configuration.admission, developmentRun: run.run, repository: configuration.repository, capability: "coding", mode: "patch_proposal", taskClass, policy }); assert.equal(decision.verdict, "allow");
    const data = { developmentRunId: run.run.id, expectedRunRevision: run.revision, configuration, invocation, context, route: { decision, taskClass }, executionPolicy: { profile: "ai044_subscription", intent } };
    return { data, intent, invocation, configuration };
  }
  async function save(p = undefined as Awaited<ReturnType<typeof prepare>> | undefined) { const proposal = p ?? await prepare(); const decision = await x.controller.saveAttemptIntent({ ...await x.command(), ...proposal.data }); return { ...proposal, decision }; }
  async function start(p: Awaited<ReturnType<typeof prepare>>) {
    const s = await state(), current = s.attempts.find(a => a.attemptNumber === p.intent.attempt.number)!;
    const config = { ...x.config, configuration: p.configuration, controllerBinding: { projectTaskId: x.task.taskId, intentFingerprint: current.intentFingerprint } };
    const authority = authorities.createPostgresExecutorCurrentAuthorityStore({ database: x.database, tenant: x.tenant, projectId: "project-a", configuration: p.configuration, controllerBinding: config.controllerBinding });
    assert.equal((p.intent.attempt.number === 1 ? await authority.registerCurrentAuthority() : await authority.advanceCurrentAuthority()).verdict, "allow");
    const store = approvals.createAI044SubscriptionApprovals(config), requested = await store.request({ commandId: `request-${++n}`, intent: p.intent }); assert.equal(requested.verdict, "allow"); assert.ok(requested.approvalRequestId);
    assert.equal((await store.decide({ commandId: `decision-${++n}`, approvalRequestId: requested.approvalRequestId, intentFingerprint: requested.intentFingerprint, decision: "approved" })).status, "approved");
    const consumed = await store.consume({ approvalRequestId: requested.approvalRequestId, intent: p.intent }); assert.equal(consumed.status, "consumed");
    assert.equal((await store.fence({ approvalCapability: consumed.approvalCapability })).status, "started");
    return { store, approvalRequestId: requested.approvalRequestId };
  }
  function result(p: Awaited<ReturnType<typeof prepare>>, status: "succeeded" | "failed") {
    const adapter = contracts.createExecutorAdapterContract(p.configuration).adapter!; assert.ok(adapter); const invocation = adapter.validateInvocation(p.invocation).normalizedInvocation; assert.ok(invocation);
    const content = "export const analytics = 1;\n", report = "Unverified analytics proposal.";
    const normalized = adapter.evaluateResult(invocation, { schemaVersion: 1, identity: p.intent.executor, invocationId: p.intent.invocationId, status,
      failureCode: status === "failed" ? "provider_failure" : null, changes: status === "failed" ? [] : [{ path, operation: "add", content, sha256: common.ai044Sha256(content) }],
      report: status === "failed" ? null : { content: report, sha256: common.ai044Sha256(report) } }).normalizedResult; assert.ok(normalized); return normalized;
  }
  return { ...x, state, transition, prepare, save, start, result };
}
test("subscription B3: stores exact manifest and subscription policy without a fictional paid budget", async () => {
  const x = await setup("b3-manifest"), p = await x.save(); assert.equal(p.decision.status, "applied");
  const s = await x.state(); assert.equal(s.attempts.length, 1); assert.equal((s.attempts[0].executionPolicy as { profile: string }).profile, "ai044_subscription");
  assert.equal(JSON.stringify(s.attempts[0].executionPolicy).includes("financialPolicy"), false); assert.equal(JSON.stringify(s.attempts[0].context).includes('"text"'), false);
  assert.deepEqual(s.attempts[0].context, p.data.context);
});
for (const field of ["contextFingerprint", "invocation", "profile", "accessMode", "manifest"] as const) test(`subscription B3: mismatched ${field} cannot save a coherent attempt`, async () => {
  const x = await setup(`b3-invalid-${field.toLowerCase()}`), p = await x.prepare(); p.data = structuredClone(p.data);
  if (field === "contextFingerprint") (p.data.executionPolicy.intent as { contextFingerprint: string }).contextFingerprint = "0".repeat(64);
  else if (field === "invocation") (p.data.executionPolicy.intent as { invocationId: string }).invocationId = "different-invocation";
  else if (field === "profile") p.data.executionPolicy.profile = "paid";
  else if (field === "accessMode") (p.data.route.decision.selectedRoute as { accessMode: string }).accessMode = "api_key";
  else (p.data.context as { aggregateBytes: number }).aggregateBytes++;
  assert.notEqual((await x.save(p)).decision.status, "applied"); assert.equal((await x.state()).attempts.length, 0);
});
test("subscription B3: independently reads durable result, then reuses QA and corrective attempt lifecycle", async () => {
  const x = await setup("b3-corrective"), p = await x.save(); assert.equal(p.decision.status, "applied"); const started = await x.start(p), normalized = x.result(p, "succeeded");
  assert.equal((await started.store.recordOutcome({ ...started, store: undefined })).verdict, "deny");
  assert.equal((await started.store.recordOutcome({ approvalRequestId: started.approvalRequestId, intent: p.intent, state: "completed", resultFingerprint: approvals.subscriptionResultFingerprint(normalized), normalizedResult: normalized })).status, "completed");
  assert.equal((await x.transition({ type: "submit_patch", changedPaths: [path] })).status, "applied");
  const s = await x.state(), run = s.runs[0], operation = await x.controller.requestOperation({ ...await x.command(), developmentRunId: run.run.id, expectedRunRevision: run.revision, kind: "quality" }); assert.equal(operation.status, "applied");
  const op = operation.state!.operations.find(o => o.kind === "quality")!, evidence = { runId: run.run.id, attemptNumber: 1, operationId: op.operationId, outcomeFingerprint: op.outcomeFingerprint,
    checks: [{ command: "npm test", status: "failed", exitCode: 1 }] };
  const saved = await x.controller.recordOperationEvidence({ ...await x.command(), operationId: op.operationId, evidence }); assert.equal(saved.status, "applied");
  const factual = saved.state!.operations.find(o => o.operationId === op.operationId)!.evidence as Parameters<typeof gates.developmentQualityEvent>[0];
  assert.equal((await x.transition(gates.developmentQualityEvent(factual))).status, "applied"); assert.equal((await x.transition({ type: "start_attempt" })).status, "applied");
  const next = await x.save(); assert.equal(next.decision.status, "applied"); assert.equal(next.intent.attempt.number, 2); assert.equal((next.data.route as { taskClass: string }).taskClass, "repair");
  assert.equal((await started.store.consume({ approvalRequestId: started.approvalRequestId, intent: p.intent })).verdict, "deny");
  assert.notEqual(intents.subscriptionIntentFingerprint(next.intent), intents.subscriptionIntentFingerprint(p.intent));
});
test("subscription B3: ambiguous ledger is not a definitive failure or a retry-ready step", async () => {
  const x = await setup("b3-ambiguous"), p = await x.save(); assert.equal(p.decision.status, "applied"); const started = await x.start(p);
  assert.equal((await started.store.recordOutcome({ approvalRequestId: started.approvalRequestId, intent: p.intent, state: "outcome_unknown", resultFingerprint: null, normalizedResult: null })).status, "outcome_unknown");
  assert.equal((await x.transition({ type: "implementation_failed", failure: { phase: "implementation", code: "executor_failed", fingerprint: roadmap.roadmapFingerprint(["pac.controller.executor-failure.v1", "provider_failure"]), summary: "Executor returned a definitive failure.", retryable: true, scopeExpansionRequired: false, protectedPathViolation: false, systemForbiddenPathViolation: false } })).status, "conflict");
  assert.equal((await x.transition({ type: "start_attempt" })).status, "conflict"); assert.equal((await x.state()).runs[0].run.currentAttemptNumber, 1);
});
test("subscription B3 mapped ROOT: actual controller intent, exact Owner queue, one fake Responses call, durable result and unchanged QA flow", async () => {
  const x = await setup("b3-root-pipeline"), candidate = await x.prepare();
  const foundation = await createSubscriptionFixture({ ownerUserId: x.ownerId, intent: candidate.intent, configuration: candidate.configuration });
  try {
    let transmissions = 0;
    const transport: typeof fetch = async (url, options) => {
      transmissions++; assert.equal(url, "https://api.openai.com/v1/responses"); assert.equal(options?.method, "POST");
      const request = JSON.parse(options!.body as string); assert.equal(request.model, foundation.intent.model); assert.equal(request.store, false); assert.equal(request.stream, true);
      assert.deepEqual(Object.keys(request).sort(), ["input", "model", "store", "stream"]);
      const event = { type: "response.completed", response: { id: "resp_mapped_root", model: foundation.intent.model, status: "completed", error: null, incomplete_details: null,
        output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(foundation.proposal) }] }] } };
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    };
    const config = { ...x.config, configuration: candidate.configuration, connection: foundation.connection, contextSource: foundation.contextSource, transport, clock: Date.now };
    const preparation = { invocationId: foundation.intent.invocationId, planRevision: foundation.intent.planRevision, planFingerprint: foundation.intent.planFingerprint,
      contextPaths: [subscriptionTestPath], preflight: foundation.intent.preflight, expiresAt: foundation.intent.expiresAt };
    const initial = composition.createAI044SubscriptionRun(config), first = await initial.prepare(preparation); assert.equal(first.verdict, "allow"); assert.ok("prepared" in first);
    assert.equal(foundation.counters.tokenReads, 0); assert.equal(transmissions, 0);
    const saved = await x.controller.saveAttemptIntent({ ...await x.command(), ...candidate.data, invocation: foundation.rawInvocation,
      context: first.contextManifest, route: { decision: first.route, taskClass: "implementation" }, executionPolicy: first.executionPolicy });
    assert.equal(saved.status, "applied"); assert.ok(saved.state);
    const stored = saved.state.attempts[0], controllerBinding = { projectTaskId: x.task.taskId, intentFingerprint: stored.intentFingerprint };
    const authority = authorities.createPostgresExecutorCurrentAuthorityStore({ database: x.database, tenant: x.tenant, projectId: "project-a", configuration: candidate.configuration, controllerBinding });
    assert.equal((await authority.registerCurrentAuthority()).verdict, "allow");
    // Even the internal unbound compatibility factory cannot consume an actual mapped Run.
    assert.equal((await initial.requestApproval({ prepared: first.prepared, commandId: "unmapped-root-request" })).verdict, "deny");
    const root = composition.createAI044SubscriptionRun({ ...config, controllerBinding }), prepared = await root.prepare(preparation);
    assert.equal(prepared.verdict, "allow"); assert.ok("prepared" in prepared);
    assert.deepEqual(prepared.intent, first.intent); assert.deepEqual(prepared.contextManifest, first.contextManifest); assert.deepEqual(prepared.route, first.route);
    const requested = await root.requestApproval({ prepared: prepared.prepared, commandId: "mapped-root-request" }); assert.ok("approvalRequestId" in requested && requested.approvalRequestId);
    assert.equal((await root.decideApproval({ commandId: "mapped-root-decision", approvalRequestId: requested.approvalRequestId, intentFingerprint: requested.intentFingerprint, decision: "approved" })).verdict, "allow");
    assert.equal(foundation.counters.tokenReads, 0); assert.equal(transmissions, 0);
    const outcome = await root.invoke({ prepared: prepared.prepared, approvalRequestId: requested.approvalRequestId }); assert.equal(outcome.verdict, "allow"); assert.ok(outcome.normalizedResult);
    assert.equal(outcome.normalizedResult.status, "succeeded"); assert.equal(outcome.normalizedResult.ownerDecisionRequired, true); assert.equal(outcome.normalizedResult.verificationStatus, "not_run"); assert.equal(outcome.normalizedResult.automaticRetryAllowed, false);
    assert.equal(transmissions, 1); assert.ok(foundation.counters.tokenReads > 0); assert.equal(foundation.counters.refreshCalls, 0);
    assert.equal(root.runtimeDispatchAllowed, false); assert.equal(root.productionLiveDispatch, "BLOCKED");
    assert.equal(JSON.stringify(outcome).includes("SYNTHETIC_SUBSCRIPTION_ACCESS"), false);
    const tokenReads = foundation.counters.tokenReads;
    assert.equal((await root.invoke({ prepared: prepared.prepared, approvalRequestId: requested.approvalRequestId })).verdict, "deny"); assert.equal(transmissions, 1); assert.equal(foundation.counters.tokenReads, tokenReads);
    const client = await x.database.connect();
    try {
      const historical = await approvals.readAI044SubscriptionOutcomeInTransaction(client, x.tenant, { projectId: "project-a", projectTaskId: x.task.taskId,
        configuration: candidate.configuration, invocation: foundation.rawInvocation, intentFingerprint: intents.subscriptionIntentFingerprint(prepared.intent) });
      assert.ok(historical); assert.deepEqual(historical.normalizedResult, outcome.normalizedResult);
    } finally { client.release(); }
    assert.equal((await x.transition({ type: "submit_patch", changedPaths: [subscriptionTestPath] })).status, "applied");
    const current = (await x.state()).runs[0], operation = await x.controller.requestOperation({ ...await x.command(), developmentRunId: current.run.id, expectedRunRevision: current.revision, kind: "quality" });
    assert.equal(operation.status, "applied"); assert.ok(operation.state);
    const op = operation.state.operations.find(item => item.kind === "quality")!, evidence = { runId: current.run.id, attemptNumber: 1, operationId: op.operationId, outcomeFingerprint: op.outcomeFingerprint,
      checks: [{ command: "npm test", status: "passed", exitCode: 0 }] };
    const recorded = await x.controller.recordOperationEvidence({ ...await x.command(), operationId: op.operationId, evidence }); assert.equal(recorded.status, "applied"); assert.ok(recorded.state);
    const factual = recorded.state.operations.find(item => item.operationId === op.operationId)!.evidence as Parameters<typeof gates.developmentQualityEvent>[0];
    assert.equal((await x.transition(gates.developmentQualityEvent(factual))).status, "applied"); assert.equal((await x.state()).runs[0].run.status, "reviewing");
    assert.equal(transmissions, 1);
    assert.equal((await db.admin.query("select count(*)::int n from executor_attempt_exposures where workspace_id=$1", [x.workspaceId])).rows[0].n, 0);
    const durable = (await db.admin.query("select state,consumed_at is not null consumed,started_at is not null started from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [x.workspaceId, requested.approvalRequestId])).rows[0];
    assert.deepEqual(durable, { state: "completed", consumed: true, started: true });
  } finally { await foundation.cleanup(); }
});
