import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionApprovalPgFixture } from "../fixtures/ai044-subscription-approval-pg.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createSubscriptionFixture, createSubscriptionTestConnection, subscriptionTestPath } from "../fixtures/ai044-subscription.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const composition = await import(new URL("../../lib/composition/ai044-subscription-run.ts", import.meta.url).href) as typeof import("../../lib/composition/ai044-subscription-run");
const executorApi = await import(new URL("../../lib/executors/chatgpt-plan-patch-executor.ts", import.meta.url).href) as typeof import("../../lib/executors/chatgpt-plan-patch-executor");
const intents = await import(new URL("../../lib/executors/ai044-subscription-intent.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-subscription-intent");
const db = await live.useLiveDatabase("subscription_run");
type Fixture = Awaited<ReturnType<typeof setup>>;
function response(model: string, proposal: unknown) { return { type: "response.completed", response: { id: "resp_controlled", model, status: "completed", error: null, incomplete_details: null,
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(proposal) }] }] } }; }
async function setup(label: string, mode = "completed") {
  const x = await subscriptionApprovalPgFixture(db, label), f = await createSubscriptionFixture({ ownerUserId: x.ownerId, intent: x.intent, configuration: x.configuration });
  const counts = { calls: 0 }; const requests: unknown[] = [];
  const transport: typeof fetch = async (url, options) => {
    counts.calls++; assert.equal(url, executorApi.chatGPTPlanResponsesEndpoint); assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "omit");
    const body = JSON.parse(options!.body as string); requests.push(body);
    assert.deepEqual(Object.keys(body).sort(), ["input", "model", "store", "stream"]);
    assert.equal(body.model, f.intent.model); assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.equal(new Headers(options!.headers).get("authorization"), "Bearer SYNTHETIC_SUBSCRIPTION_ACCESS");
    if (mode === "exception") throw Error("RAW_PRIVATE_PROVIDER_ERROR");
    if (mode === "limit") return Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "RAW_PRIVATE_PROVIDER_ERROR" } }, { status: 429 });
    const event = response(f.intent.model, f.proposal);
    if (mode === "incomplete") Object.assign(event, { type: "response.incomplete", response: { ...event.response, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } });
    if (mode === "failed") Object.assign(event, { type: "response.failed", response: { ...event.response, status: "failed", error: { code: "server_error", message: "RAW_PRIVATE_PROVIDER_ERROR" } } });
    if (mode === "secret") event.response.output[0].content[0].text = JSON.stringify({ ...f.proposal, summary: "SYNTHETIC_SUBSCRIPTION_ACCESS" });
    return new Response(mode === "ambiguous" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  const useCase = composition.createAI044SubscriptionRun({ ...x.config, connection: f.connection, contextSource: f.contextSource, transport, clock: Date.now });
  const p = await useCase.prepare({ invocationId: f.intent.invocationId, planRevision: f.intent.planRevision, planFingerprint: f.intent.planFingerprint,
    contextPaths: [subscriptionTestPath], preflight: f.intent.preflight, expiresAt: f.intent.expiresAt });
  assert.equal(p.verdict, "allow", JSON.stringify(p)); if (p.verdict !== "allow") assert.fail("subscription preparation denied"); assert.ok(p.prepared);
  return { x, f, useCase, p, counts, requests };
}
async function approve(s: Fixture) {
  assert.ok("prepared" in s.p);
  const r = await s.useCase.requestApproval({ prepared: s.p.prepared, commandId: "one-shot-request" });
  assert.ok("approvalRequestId" in r && r.approvalRequestId, JSON.stringify(r));
  const d = await s.useCase.decideApproval({ commandId: "one-shot-decision", approvalRequestId: r.approvalRequestId, intentFingerprint: r.intentFingerprint, decision: "approved" });
  assert.equal(d.verdict, "allow", JSON.stringify(d)); return r.approvalRequestId;
}
test("PG PhaseS SIWC preview request uses exactly four supported keys without an output-token cap", async () => {
  const s = await setup("siwc-body");
  try {
    const id = await approve(s), d = await s.useCase.invoke({ prepared: s.p.prepared, approvalRequestId: id });
    assert.equal(s.counts.calls, 1); assert.equal(d.verdict, "allow", JSON.stringify(d));
    const body = s.requests[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["input", "model", "store", "stream"]);
    for (const field of ["max_output_tokens", "background", "conversation", "max_tool_calls", "metadata", "moderation", "multi_agent",
      "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user",
      "previous_response_id", "tools", "tool_choice", "additional_tools"]) {
      assert.equal(Object.hasOwn(body, field), false, `SIWC profile must not send ${field}`);
    }
    assert.equal(body.model, s.f.intent.model); assert.equal(body.store, false); assert.equal(body.stream, true);
    const input = body.input as { role: string; content: { type: string; text: string }[] }[];
    assert.deepEqual(input.map(message => message.role), ["developer", "user"]);
    assert.ok(input.every(message => message.content.every(part => part.type === "input_text")));
    assert.equal(d.normalizedResult?.status, "succeeded");
  } finally { await s.f.cleanup(); }
});
test("PG PhaseS exact per-plan reference policy cannot escalate writes or reuse approval for another read set", async () => {
  const s = await setup("read-write-split"); let reads = 0, posts = 0;
  try {
    const reference = "docs/architecture.md", contextSource = { async readExactObject(input: { path: string }) {
      reads++; assert.ok([subscriptionTestPath, reference].includes(input.path));
      const bytes = Buffer.from(input.path === reference ? "Read-only reference.\n" : "export const analytics = 1;\n");
      return { kind: "blob", mode: "100644", blobId: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), bytes };
    } };
    const transport: typeof fetch = async (_url, options) => {
      posts++; const body = JSON.parse(options!.body as string); assert.deepEqual(Object.keys(body).sort(), ["input", "model", "store", "stream"]);
      const data = JSON.parse(body.input[1].content[0].text); assert.deepEqual(data.admittedPaths, s.f.intent.allowedWritePaths);
      assert.deepEqual(data.readContextPaths, [subscriptionTestPath, reference]);
      return new Response(`data: ${JSON.stringify(response(s.f.intent.model, s.f.proposal))}\n\n`, { headers: { "content-type": "text/event-stream" } });
    };
    const config = { ...s.x.config, connection: s.f.connection, contextSource, transport, clock: Date.now };
    const request = { invocationId: s.f.intent.invocationId, planRevision: s.f.intent.planRevision, planFingerprint: s.f.intent.planFingerprint,
      contextPaths: [subscriptionTestPath, reference], preflight: s.f.intent.preflight, expiresAt: s.f.intent.expiresAt };
    assert.equal((await composition.createAI044SubscriptionRun(config).prepare(request)).verdict, "deny"); assert.equal(reads, 0);
    const readContextPolicy = { planRevision: request.planRevision, planFingerprint: request.planFingerprint, referencePaths: [reference] }, original = structuredClone(readContextPolicy);
    const useCase = composition.createAI044SubscriptionRun({ ...config, readContextPolicy });
    readContextPolicy.referencePaths.push("docs/not-approved.md");
    for (const path of ["docs/not-approved.md", "src/scanner/a.ts"]) assert.equal((await useCase.prepare({ ...request, contextPaths: [path] })).verdict, "deny");
    assert.equal(reads, 0);
    const wrongPlan = composition.createAI044SubscriptionRun({ ...config, readContextPolicy: { ...original, planRevision: original.planRevision + 1 } });
    assert.equal((await wrongPlan.prepare(request)).verdict, "deny"); assert.equal(reads, 0);
    const first = await useCase.prepare(request), other = await useCase.prepare({ ...request, contextPaths: [subscriptionTestPath] });
    assert.ok("prepared" in first && "prepared" in other); assert.equal(s.f.counters.tokenReads, 0);
    assert.deepEqual(first.intent.allowedWritePaths, other.intent.allowedWritePaths); assert.notEqual(first.intent.contextFingerprint, other.intent.contextFingerprint);
    const asked = await useCase.requestApproval({ prepared: first.prepared, commandId: "read-policy-request" }); assert.ok("approvalRequestId" in asked && asked.approvalRequestId);
    assert.equal((await useCase.decideApproval({ commandId: "read-policy-decision", approvalRequestId: asked.approvalRequestId, intentFingerprint: asked.intentFingerprint, decision: "approved" })).verdict, "allow");
    assert.equal((await useCase.invoke({ prepared: other.prepared, approvalRequestId: asked.approvalRequestId })).verdict, "deny");
    assert.equal(s.f.counters.tokenReads, 0); assert.equal(posts, 0);
    const result = await useCase.invoke({ prepared: first.prepared, approvalRequestId: asked.approvalRequestId }); assert.equal(result.normalizedResult?.status, "succeeded", JSON.stringify(result));
    assert.equal(posts, 1); assert.deepEqual(first.intent.allowedWritePaths, s.f.intent.allowedWritePaths);
  } finally { await s.f.cleanup(); }
});
test("PG FeaturePlan-driven subscription pipeline accepts non-Portfolio write scope, baseline and verification contract", async () => {
  const writable = "src/features/liquidity/drawer.ts", reference = "docs/architecture.md", repository = { id: "future-feature-repository", baseline: "b".repeat(40) };
  const x = await subscriptionApprovalPgFixture(db, "generic-feature", { repository, writePaths: [writable] });
  const f = await createSubscriptionTestConnection({ ownerUserId: x.ownerId, workspaceId: x.intent.workspaceId, modelId: x.intent.model });
  try {
    let posts = 0;
    const proposal = { patch: `diff --git a/${writable} b/${writable}\n--- a/${writable}\n+++ b/${writable}\n@@ -1 +1 @@\n-old\n+new\n`, changedPaths: [writable], summary: "Unverified feature proposal." };
    const contextSource = { async readExactObject(input: { repositoryId: string; baseline: string; path: string }) {
      assert.equal(input.repositoryId, repository.id); assert.equal(input.baseline, repository.baseline); assert.ok([writable, reference].includes(input.path));
      const bytes = Buffer.from("old\n"); return { kind: "blob", mode: "100644", blobId: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), bytes };
    } };
    const useCase = composition.createAI044SubscriptionRun({ ...x.config, connection: f.connection, contextSource, clock: Date.now,
      readContextPolicy: { planRevision: x.intent.planRevision, planFingerprint: x.intent.planFingerprint, referencePaths: [reference] },
      transport: async (_url: unknown, options: RequestInit) => { posts++; const body = JSON.parse(options.body as string); assert.deepEqual(Object.keys(body).sort(), ["input", "model", "store", "stream"]);
        return new Response(`data: ${JSON.stringify(response(f.modelId, proposal))}\n\n`, { headers: { "content-type": "text/event-stream" } }); } });
    const p = await useCase.prepare({ invocationId: x.intent.invocationId, planRevision: x.intent.planRevision, planFingerprint: x.intent.planFingerprint,
      contextPaths: [writable, reference], preflight: { ...x.intent.preflight, registrationFingerprint: intents.subscriptionRegistrationFingerprint(f.registration) }, expiresAt: x.intent.expiresAt });
    assert.ok("prepared" in p, JSON.stringify(p)); assert.deepEqual(p.intent.allowedWritePaths, [writable]); assert.deepEqual(p.intent.readContextPaths, [writable, reference]);
    const asked = await useCase.requestApproval({ prepared: p.prepared, commandId: "generic-request" }); assert.ok("approvalRequestId" in asked && asked.approvalRequestId);
    assert.equal((await useCase.decideApproval({ commandId: "generic-decision", approvalRequestId: asked.approvalRequestId, intentFingerprint: asked.intentFingerprint, decision: "approved" })).verdict, "allow");
    const result = await useCase.invoke({ prepared: p.prepared, approvalRequestId: asked.approvalRequestId }); assert.equal(result.normalizedResult?.status, "succeeded", JSON.stringify(result));
    assert.equal(posts, 1); assert.deepEqual(result.normalizedResult?.repository, repository); assert.equal(result.normalizedResult?.changes[0].path, writable);
    assert.ok(!JSON.stringify(p).includes("portfolio-analytics")); assert.equal(result.normalizedResult?.verificationStatus, "not_run");
  } finally { await f.cleanup(); }
});
test("PG PhaseS all final gates precede exactly one subscription POST; replay is zero token reads/dispatch", async () => {
  const s = await setup("normal");
  try {
    assert.equal(s.f.counters.tokenReads, 0); assert.equal(s.counts.calls, 0);
    assert.equal(s.p.runtimeDispatchAllowed, false); assert.equal(s.p.dispatchAuthorized, false);
    const pending = await s.useCase.requestApproval({ prepared: s.p.prepared, commandId: "pending" }); assert.ok("approvalRequestId" in pending);
    const denied = await s.useCase.invoke({ prepared: s.p.prepared, approvalRequestId: pending.approvalRequestId }); assert.equal(denied.verdict, "deny");
    assert.equal(s.f.counters.tokenReads, 0); assert.equal(s.counts.calls, 0);
    const id = await approve(s), result = await s.useCase.invoke({ prepared: s.p.prepared, approvalRequestId: id });
    assert.equal(result.verdict, "allow", JSON.stringify(result)); assert.equal(result.normalizedResult?.status, "succeeded");
    assert.equal(result.normalizedResult?.ownerDecisionRequired, true); assert.equal(result.normalizedResult?.verificationStatus, "not_run"); assert.equal(result.normalizedResult?.automaticRetryAllowed, false);
    assert.equal(s.counts.calls, 1); assert.ok(Object.isFrozen(result.normalizedResult));
    const reads = s.f.counters.tokenReads;
    for (let n = 0; n < 3; n++) assert.equal((await s.useCase.invoke({ prepared: s.p.prepared, approvalRequestId: id })).verdict, "deny");
    assert.equal(s.f.counters.tokenReads, reads); assert.equal(s.counts.calls, 1);
    assert.ok(!JSON.stringify(result).includes("SYNTHETIC_SUBSCRIPTION_ACCESS"));
    const state = (await db.admin.query("select state,consumed_at is not null consumed,started_at is not null started from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [s.x.workspaceId, id])).rows[0];
    assert.deepEqual(state, { state: "completed", consumed: true, started: true });
    assert.equal((await db.admin.query("select count(*)::int n from executor_attempt_exposures where workspace_id=$1", [s.x.workspaceId])).rows[0].n, 0);
  } finally { await s.f.cleanup(); }
});
for (const mode of ["exception", "ambiguous", "incomplete", "failed", "limit", "secret"]) test(`PG PhaseS ${mode} persists safe outcome, never retries or falls back`, async () => {
  const s = await setup(mode, mode);
  try {
    const id = await approve(s), d = await s.useCase.invoke({ prepared: s.p.prepared, approvalRequestId: id });
    const expected = ["exception", "ambiguous", "secret"].includes(mode) ? "outcome_unknown" : "failed";
    assert.equal("state" in d && d.state, expected, JSON.stringify(d)); assert.equal(s.counts.calls, 1);
    assert.equal(d.normalizedResult?.status ?? "outcome_unknown", expected === "failed" ? "failed" : "outcome_unknown");
    assert.ok(!JSON.stringify(d).includes("RAW_PRIVATE_PROVIDER_ERROR")); assert.ok(!JSON.stringify(d).includes("SYNTHETIC_SUBSCRIPTION_ACCESS"));
    for (let n = 0; n < 3; n++) assert.equal((await s.useCase.invoke({ prepared: s.p.prepared, approvalRequestId: id })).verdict, "deny");
    assert.equal(s.counts.calls, 1);
    const row = (await db.admin.query("select state,normalized_result_payload from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [s.x.workspaceId, id])).rows[0];
    assert.equal(row.state, expected); if (expected === "outcome_unknown") assert.equal(row.normalized_result_payload, null);
  } finally { await s.f.cleanup(); }
});
test("PG PhaseS revoked current authority before consume cannot read token", async () => {
  const s = await setup("revoke"); try {
    const id = await approve(s); await s.x.authority.revokeCurrentAuthority();
    assert.equal((await s.useCase.invoke({ prepared: s.p.prepared, approvalRequestId: id })).verdict, "deny");
    assert.equal(s.f.counters.tokenReads, 0); assert.equal(s.counts.calls, 0);
  } finally { await s.f.cleanup(); }
});
test("PG PhaseS authority loss during credential resolution blocks pre-provider fence", async () => {
  const s = await setup("pre-fence"); try {
    assert.ok("intent" in s.p);
    const c = { ...s.f.connection, async withSubscriptionAccess<T>(binding: Parameters<typeof s.f.connection.subscriptionAccessToken>[0], start: (access: import("../../lib/integrations/chatgpt/chatgpt-connection").ChatGPTSubscriptionAccess) => Promise<{ pending: Promise<T> }>) {
      return s.f.connection.withSubscriptionAccess(binding, async access => { await s.x.authority.revokeCurrentAuthority(); return start(access); });
    } };
    const useCase = composition.createAI044SubscriptionRun({ ...s.x.config, connection: c, contextSource: s.f.contextSource,
      transport: async () => { assert.fail("no pre-fence dispatch"); }, clock: Date.now });
    const p = await useCase.prepare({ invocationId: s.f.intent.invocationId, planRevision: s.f.intent.planRevision, planFingerprint: s.f.intent.planFingerprint,
      contextPaths: [subscriptionTestPath], preflight: s.f.intent.preflight, expiresAt: s.f.intent.expiresAt }); assert.ok("prepared" in p);
    const id = await s.x.approve(p.intent);
    assert.equal((await useCase.invoke({ prepared: p.prepared, approvalRequestId: id })).verdict, "deny"); assert.equal(s.counts.calls, 0);
    assert.equal((await db.admin.query("select state from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2", [s.x.workspaceId, id])).rows[0].state, "consumed");
  } finally { await s.f.cleanup(); }
});
test("PG PhaseS mutable database dependency cannot replace captured Owner/approval readers", async () => {
  const s = await setup("db-capture"); try {
    let replacements = 0;
    const database = { connect: () => s.x.database.connect() };
    const useCase = composition.createAI044SubscriptionRun({ ...s.x.config, database, connection: s.f.connection, contextSource: s.f.contextSource,
      transport: async () => new Response(`data: ${JSON.stringify(response(s.f.intent.model, s.f.proposal))}\n\n`, { headers: { "content-type": "text/event-stream" } }), clock: Date.now });
    database.connect = async () => { replacements++; throw Error("untrusted replacement"); };
    const p = await useCase.prepare({ invocationId: s.f.intent.invocationId, planRevision: s.f.intent.planRevision, planFingerprint: s.f.intent.planFingerprint,
      contextPaths: [subscriptionTestPath], preflight: s.f.intent.preflight, expiresAt: s.f.intent.expiresAt }); assert.ok("prepared" in p);
    const id = await s.x.approve(p.intent), d = await useCase.invoke({ prepared: p.prepared, approvalRequestId: id });
    assert.equal(d.verdict, "allow", JSON.stringify(d)); assert.equal(replacements, 0);
  } finally { await s.f.cleanup(); }
});
test("PG PhaseS genuine unlocked or escaped OAuth lease cannot bypass the credential/fence boundary", async () => {
  const s = await setup("locked-lease"); try {
    const id = await s.x.approve(s.f.intent), consumed = await s.x.store.consume({ approvalRequestId: id, intent: s.f.intent });
    assert.ok(consumed.approvalCapability); const started = await s.x.store.fence({ approvalCapability: consumed.approvalCapability }); assert.ok(started.startCapability);
    let calls = 0;
    const executor = executorApi.createChatGPTPlanPatchExecutor(s.f.configuration, async () => {
      calls++; return new Response(`data: ${JSON.stringify(response(s.f.intent.model, s.f.proposal))}\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    const p = executor.prepare(s.f.rawInvocation, s.f.context, s.f.intent, s.f.ownerUserId); assert.ok(p.request);
    const unlocked = await s.f.connection.subscriptionAccessToken(s.f.expected);
    assert.equal((await executor.execute(p.request, started.startCapability, unlocked)).verdict, "deny"); assert.equal(calls, 0);
    let escaped: unknown;
    const scope = await s.f.connection.withSubscriptionAccess(s.f.expected, async access => { escaped = access; return { pending: Promise.resolve(null) }; }); assert.equal(scope.ok, true);
    assert.equal((await executor.execute(p.request, started.startCapability, escaped)).verdict, "deny"); assert.equal(calls, 0);
    const locked = await s.f.connection.withSubscriptionAccess(s.f.expected, async access => ({ pending: executor.execute(p.request, started.startCapability, access) }));
    assert.ok(locked.ok); const result = await locked.pending;
    assert.equal(result.verdict, "allow"); assert.equal(result.normalizedResult?.status, "succeeded"); assert.equal(calls, 1);
  } finally { await s.f.cleanup(); }
});
test("PG PhaseS cancellation after authorized POST cannot be overwritten by late provider completion", async () => {
  const s = await setup("post-cancel"); try {
    let calls = 0;
    const useCase = composition.createAI044SubscriptionRun({ ...s.x.config, connection: s.f.connection, contextSource: s.f.contextSource, clock: Date.now,
      transport: async () => {
        calls++; const cancelled = await s.x.controller.changeTaskState({ ...await s.x.command(), nextStatus: "cancelled" });
        assert.equal(cancelled.status, "applied");
        return new Response(`data: ${JSON.stringify(response(s.f.intent.model, s.f.proposal))}\n\n`, { headers: { "content-type": "text/event-stream" } });
      } });
    const p = await useCase.prepare({ invocationId: s.f.intent.invocationId, planRevision: s.f.intent.planRevision, planFingerprint: s.f.intent.planFingerprint,
      contextPaths: [subscriptionTestPath], preflight: s.f.intent.preflight, expiresAt: s.f.intent.expiresAt }); assert.ok("prepared" in p);
    const id = await s.x.approve(p.intent), result = await useCase.invoke({ prepared: p.prepared, approvalRequestId: id });
    assert.equal(result.verdict, "allow", "historical factual terminal capture is allowed"); assert.equal(calls, 1);
    assert.equal((await s.x.controller.read("project-a", s.x.task.taskId))?.task.status, "cancelled");
    assert.equal((await useCase.invoke({ prepared: p.prepared, approvalRequestId: id })).verdict, "deny"); assert.equal(calls, 1);
  } finally { await s.f.cleanup(); }
});
