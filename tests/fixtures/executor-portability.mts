import assert from "node:assert/strict";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { claudeFixture, ports, fake, execution, memoryClaude, syntheticClaudeReceipt, contract, seam, workspace } from "./claude-managed.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, executorTarget, executorRequestPolicy, financialPolicy, context } from "./durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { fakeEvents, identityTransport } from "./executor-provider-identity.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { fakeProvider, savedAnswer, initialUserInput } from "./executor-provider-reconciliation.mts";
const local = await import(new URL("../../lib/executors/executor-start-boundary.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-start-boundary");
const openai = await import(new URL("../../lib/executors/openai-agents-executor.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-executor");
const reconciliation = await import(new URL("../../lib/executors/openai-agents-reconciliation.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-reconciliation");
const capture = await import(new URL("../../lib/executors/executor-outcome.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-outcome");
export type Provider = "openai" | "anthropic";
export type Mode = "success" | "timeout" | "malformed" | "missing" | "overshoot";
export function workload(provider: Provider, id: string, n = 1, w = workspace, account = "account-a") {
  const c = claudeFixture(id, n, w, account);
  if (provider === "anthropic") return c;
  const configuration = executorConfiguration(n, id), raw = executorRequest(n, id), target = { ...executorTarget(), accountId: account }, policy = executorRequestPolicy();
  const adapter = contract.createExecutorAdapterContract(configuration).adapter!, invocation = adapter.validateInvocation(raw).normalizedInvocation!;
  const prepared = seam.prepareExecutorProviderRequest(policy, invocation, context(), target, 10000, w); assert.ok(prepared);
  return { ...c, configuration, raw, target, policy, adapter, invocation, prepared };
}
export type Workload = ReturnType<typeof workload>;
export type SharedStore = ReturnType<typeof import("../../lib/db/executor-start-store").createPostgresExecutorStartStore>;
/** Same shared capture/settlement algorithm; Claude exact numbers are explicitly test-owned. */
export async function settleCandidate(f: Workload, store: SharedStore, result: import("../../lib/contracts/executor-adapter").NormalizedExecutorResult | null) {
  const receipt = f.target.providerId === "anthropic" ? await syntheticClaudeReceipt(f, result)
    : await capture.createExecutorOutcomeCapture(f.configuration, { capture: () => ({ terminality: "definitive_terminal", normalizedResult: result, usage: null, providerConsumedCents: 0 }) }).capture(f.raw, f.prepared.requestFingerprint);
  return store.recordDefinitiveOutcomeAndSettle(f.raw, f.prepared.requestFingerprint, receipt);
}
/** Explicit fixture selection, not a Router. All OpenAI HTTP is injected in-process fake. */
export async function transmit(f: Workload, store: SharedStore, start: unknown, mode: Mode = "success", simulation: { identitySuffix?: string; proposal?: unknown } = {}) {
  if (f.target.providerId === "anthropic") {
    const script = structuredClone(f.script);
    if (mode === "timeout") script.createOutcome = "timeout";
    if (mode === "malformed") script.pages[0].events[1].content = "not JSON";
    if (mode === "missing") script.session.id = "";
    if (mode === "overshoot") script.session.budgetOvershoot = true;
    const p = ports({ ...f, script }, store);
    return { decision: await p.executor.execute(f.raw, start), count: () => p.provider.stats().creates,
      replay: () => p.executor.execute(f.raw, start) };
  }
  const c = await store.prepareProviderCorrelation(f.raw, f.context, start), observer = store.createProviderIdentityObserver(f.raw, c.providerCapability);
  const b = local.createExecutorStartBoundary(f.configuration, { ...financialPolicy(), permitTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const i = b.validateInvocation(f.raw).normalizedInvocation; assert.ok(i); let calls = 0;
  // This pass includes real PG identity ACK roundtrips; 30ms was a flaky fixture deadline,
  // not a production SLA. Ambiguity cases inject a failure instead of waiting on a timer.
  const transport = openai.createOpenAIAgentsIdentityTestTransport(b, { ...f.target, workspaceIdentity: f.workspaceIdentity, timeoutMs: 5000,
    credential: () => "synthetic-test-placeholder-not-live" }, async (_url, init) => {
    calls++; assert.equal(init.method, "POST"); assert.equal(init.body, f.prepared.body);
    if (mode === "timeout") throw Error("simulated-timeout");
    const events = fakeEvents(`${f.raw.attempt.developmentRunId}${simulation.identitySuffix ?? ""}`) as Array<Record<string, unknown>>;
    if (simulation.proposal) ((events[1].item as { content: Array<{ text: string }> }).content[0]).text = JSON.stringify(simulation.proposal);
    (events[0].session as Record<string, unknown>).metadata = JSON.parse(init.body).metadata;
    if (mode === "missing") (events[0].session as Record<string, unknown>).id = "";
    if (mode === "malformed") events[1] = { type: "unrecognized" };
    if (mode === "overshoot") { events[2].type = "agent.session.turn.failed"; const t = events[2].turn as Record<string, unknown>; t.status = "failed"; t.error = { code: "session_budget_exceeded", message: "private-error-canary" }; }
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  }, observer);
  const reserved = b.budgetAuthority.reserve(i, f.target, null, { reservationId: "portable-local", maximumExposureUsdMicros: 10000 }); assert.ok(reserved.reservation);
  const prepared = transport.prepare(i, f.context, reserved.reservation).prepared; assert.ok(prepared);
  const permit = b.dispatchAuthority.issue(i, f.target, prepared.requestFingerprint).permit; assert.ok(permit);
  const ticket = b.providerStartFence.start(i, f.target, prepared.requestFingerprint, permit, reserved.reservation).ticket; assert.ok(ticket);
  const decision = await prepared.invoke(ticket);
  return { decision, count: () => calls, replay: () => prepared.invoke(ticket) };
}
/** Restart with fresh fake/read/store objects; no transport/start handle enters recovery. */
export async function recover(f: Workload, store: SharedStore) {
  if (f.target.providerId === "anthropic") {
    const provider = fake.createClaudeManagedFakeProvider(f.script), inspector = execution.createClaudeManagedAgentsFakeInspector({ configuration: f.configuration,
      profile: f.profile, context: f.context, workspaceIdentity: f.workspaceIdentity, store, readClient: provider.retrieval });
    const d = await inspector.inspect(f.raw); if (!d.normalizedResult) return { decision: d, creates: 0, reads: provider.stats().reads };
    return { decision: await settleCandidate(f, store, d.normalizedResult), creates: provider.stats().creates, reads: provider.stats().reads };
  }
  const p = (await store.inspectProviderIdentity(f.raw)).providerIdentity; assert.ok(p?.sessionId);
  const provider = fakeProvider(p.correlationFingerprint, p.sessionId);
  provider.state.turn.id = p.turnId!; provider.state.items = [initialUserInput(f.configuration, f.raw).item, savedAnswer("message_a", p.turnId!)];
  for (const item of provider.state.items as Array<Record<string, unknown>>) item.turn_id = p.turnId;
  const inspector = reconciliation.createOpenAIAgentsRetrievalTestReconciler({ configuration: f.configuration, target: f.target, store, retrievalClient: provider.client(f.target) });
  return { decision: await inspector.reconcile(f.raw), creates: 0, reads: provider.state.calls.length };
}
export async function unitExecution(provider: Provider, mode: Mode) {
  if (provider === "anthropic") { const f = claudeFixture(); if (mode === "timeout") f.script.createOutcome = "timeout"; if (mode === "malformed") f.script.pages[0].events[1].content = "bad";
    const m = memoryClaude(f); return { decision: await m.executor.execute(f.raw, m.startCapability), calls: m.provider.stats().creates, f }; }
  let used = false;
  const observer = { beforeTransmission: async () => { if (used) return false; used = true; return true; }, observe: async () => true, uncertain: async () => {} };
  const events = mode === "malformed" ? [{}] : fakeEvents("claude-work");
  const p = identityTransport("claude-work", observer, workspace, events);
  // Timeout/ambiguity is exercised against the real durable harness below; this unit uses malformed stream for the same no-terminal assertion.
  const d = await p.invoke(); return { decision: d, calls: p.calls(), f: workload("openai", "claude-work") };
}
