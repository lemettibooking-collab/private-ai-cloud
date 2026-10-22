import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, financialPolicy, executorTarget, context } from "./durable-executor.mts";
const adapter = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const outcome = await import(new URL("../../lib/executors/executor-outcome.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-outcome");
const boundary = await import(new URL("../../lib/executors/executor-start-boundary.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-start-boundary");
const transport = await import(new URL("../../lib/executors/openai-agents-executor.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-executor");
export const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export function normalizedResult(id = "development-a", status = "succeeded", report = "Unverified proposal. Owner review required.") {
  const a = adapter.createExecutorAdapterContract(executorConfiguration(1, id)).adapter; assert.ok(a);
  const i = a.validateInvocation(executorRequest(1, id)).normalizedInvocation; assert.ok(i);
  const content = "export const answer = 42;\n";
  const d = a.evaluateResult(i, { schemaVersion: 1, identity: i.identity, invocationId: i.invocationId, status,
    failureCode: status === "succeeded" ? null : status === "rejected" ? "policy_rejected" : status === "failed" ? "provider_failure" : "ambiguous_outcome",
    changes: status === "succeeded" ? [{ path: "src/a.ts", operation: "add", content, sha256: digest(content) }] : [],
    report: status === "succeeded" ? { content: report, sha256: digest(report) } : null });
  assert.ok(d.normalizedResult); return d.normalizedResult;
}
export async function receipt(id: string, fp: string, status = "succeeded", report?: string,
  evidence: Partial<import("../../lib/executors/executor-outcome").ExecutorOutcomeEvidence> = {}) {
  return outcome.createExecutorOutcomeCapture(executorConfiguration(1, id), { capture: () => ({
    terminality: "definitive_terminal", normalizedResult: normalizedResult(id, status, report), usage: null, providerConsumedCents: null, ...evidence,
  }) }).capture(executorRequest(1, id), fp);
}
export function frozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
export function denied(d: { verdict: string; snapshot: unknown; startCapability: unknown; normalizedResult: unknown; resultFingerprint: unknown }) {
  assert.equal(d.verdict, "deny"); assert.equal(d.snapshot, null); assert.equal(d.startCapability, null); assert.equal(d.normalizedResult, null); assert.equal(d.resultFingerprint, null); frozen(d);
}
export async function controlledTransport(id: string, kind: "success" | "timeout" | "5xx" | "invalid" | "budget" | "rejected" | "production") {
  const b = boundary.createExecutorStartBoundary(executorConfiguration(1, id), { ...financialPolicy(), permitTtlMs: 60000, maxEntries: 16 }, () => 1000);
  const i = b.validateInvocation(executorRequest(1, id)).normalizedInvocation; assert.ok(i);
  const t = executorTarget(); let calls = 0, credentials = 0;
  const fake = async () => {
    calls++;
    if (kind === "timeout") return new Promise<Response>(() => {});
    if (kind === "5xx" || kind === "rejected") return new Response(null, { status: kind === "5xx" ? 503 : 403 });
    if (kind === "invalid") return new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } });
    const result = normalizedResult(id);
    const values = [
      { type: "agent.session.created", event_id: "event_1", session: { id: "session_a", object: "agent.session", error: null,
        agent: { model: t.modelId, tools: [{ type: "programmatic_tool_calling", enabled: false }], multi_agent: { enabled: false, max_concurrent_subagents: null } },
        environment: { type: "none" }, status: "in_progress", required_actions: [], vault_ids: [], usage: null, spend_control: { limit: 1, consumed: null } } },
      { type: "agent.session.turn.item.done", event_id: "event_2", session_id: "session_a", turn_id: "turn_a", output_index: 0,
        item: { id: "message_a", type: "message", role: "assistant", status: "completed", phase: "final_answer", turn_id: "turn_a",
          content: [{ type: "output_text", text: JSON.stringify({ changes: result.changes.map(c => ({ path: c.path, operation: c.operation, content: c.content })), report: result.report!.content }) }] } },
      { type: "agent.session.turn.completed", event_id: "event_3", session_id: "session_a", turn_id: "turn_a",
        turn: { id: "turn_a", object: "agent.session.turn", session_id: "session_a", subagent_id: null, status: "completed", error: null,
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
    ];
    if (kind === "budget") {
      const last = values[2] as unknown as { type: string; turn: { status: string; error: unknown } };
      last.type = "agent.session.turn.failed"; last.turn.status = "failed";
      last.turn.error = { code: "session_budget_exceeded", message: "private-provider-error-never-project" };
    }
    return new Response(values.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  };
  const settings = { modelId: t.modelId, accountId: t.accountId, workspaceIdentity: "00000000-0000-4000-8000-0000000000a1", timeoutMs: 10, credential() { credentials++; return "synthetic-test-credential-never-live"; } };
  const p = kind === "production" ? transport.createOpenAIAgentsTransport(b, settings) : transport.createOpenAIAgentsTestTransport(b, settings, fake);
  const r = b.budgetAuthority.reserve(i, t, null, { reservationId: "result-test", maximumExposureUsdMicros: 10000 }); assert.ok(r.reservation);
  const prepared = p.prepare(i, context(), r.reservation).prepared; assert.ok(prepared);
  const permit = b.dispatchAuthority.issue(i, t, prepared.requestFingerprint).permit; assert.ok(permit);
  const ticket = b.providerStartFence.start(i, t, prepared.requestFingerprint, permit, r.reservation).ticket; assert.ok(ticket);
  const decision = await prepared.invoke(ticket);
  const proof = await outcome.createExecutorTransportOutcomeCapture(executorConfiguration(1, id), { observe: () => decision }).capture(executorRequest(1, id), prepared.requestFingerprint);
  return { proof, decision, calls, credentials, fp: prepared.requestFingerprint };
}
