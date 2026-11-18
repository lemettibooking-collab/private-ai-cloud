import assert from "node:assert/strict";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, financialPolicy, executorTarget, context } from "./durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizedResult } from "./executor-outcome.mts";
const boundary = await import(new URL("../../lib/executors/executor-start-boundary.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-start-boundary");
const transport = await import(new URL("../../lib/executors/openai-agents-executor.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-executor");
export function frozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
export function fakeEvents(runId: string) {
  const r = normalizedResult(runId), target = executorTarget(), sessionId = `session_${runId}`, turnId = `turn_${runId}`;
  return [
    { type: "agent.session.created", event_id: "event_1", session: { id: sessionId, object: "agent.session", error: null,
      agent: { model: target.modelId, tools: [{ type: "programmatic_tool_calling", enabled: false }], multi_agent: { enabled: false } },
      environment: { type: "none" }, status: "in_progress", required_actions: [], vault_ids: [], spend_control: { limit: 1, consumed: null } } },
    { type: "agent.session.turn.item.done", event_id: "event_2", session_id: sessionId, turn_id: turnId, output_index: 0,
      item: { id: "item_test", type: "message", role: "assistant", status: "completed", phase: "final_answer", turn_id: turnId,
        content: [{ type: "output_text", text: JSON.stringify({ changes: r.changes.map(c => ({ path: c.path, operation: c.operation, content: c.content })), report: r.report!.content }) }] } },
    { type: "agent.session.turn.completed", event_id: "event_3", session_id: sessionId, turn_id: turnId,
      turn: { id: turnId, object: "agent.session.turn", session_id: sessionId, subagent_id: null, status: "completed", error: null } },
  ];
}
/** In-process responses only. Never pass real fetch/SDK to this harness. */
export function identityTransport(runId: string, observer: unknown, workspaceIdentity = "test-only", values: unknown[] = fakeEvents(runId)) {
  const b = boundary.createExecutorStartBoundary(executorConfiguration(1, runId), { ...financialPolicy(), permitTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const i = b.validateInvocation(executorRequest(1, runId)).normalizedInvocation; assert.ok(i);
  let calls = 0, credentials = 0;
  const p = transport.createOpenAIAgentsIdentityTestTransport(b, { ...executorTarget(), workspaceIdentity, timeoutMs: 1000,
    credential() { credentials++; return "synthetic-test-credential-never-live"; } }, async (_url, init) => {
    calls++; assert.ok(!Object.keys(init.headers).some(k => k.toLowerCase() === "idempotency-key"));
    const events = structuredClone(values) as Array<{ type?: string; session?: { metadata?: unknown } }>;
    for (const e of events) if (e.type === "agent.session.created" && e.session && !Object.hasOwn(e.session, "metadata")) e.session.metadata = JSON.parse(init.body).metadata;
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  }, observer);
  const r = b.budgetAuthority.reserve(i, executorTarget(), null, { reservationId: "identity-test", maximumExposureUsdMicros: 10000 }); assert.ok(r.reservation);
  const prepared = p.prepare(i, context(), r.reservation).prepared; assert.ok(prepared);
  const permit = b.dispatchAuthority.issue(i, executorTarget(), prepared.requestFingerprint).permit; assert.ok(permit);
  const ticket = b.providerStartFence.start(i, executorTarget(), prepared.requestFingerprint, permit, r.reservation).ticket; assert.ok(ticket);
  return { invoke: () => prepared.invoke(ticket), calls: () => calls, credentials: () => credentials, fp: prepared.requestFingerprint };
}
