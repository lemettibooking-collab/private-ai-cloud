import assert from "node:assert/strict";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, executorTarget } from "./durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizedResult, digest, frozen } from "./executor-outcome.mts";
const retrieval = await import(new URL("../../lib/executors/openai-agents-retrieval.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-retrieval");
const reconciliation = await import(new URL("../../lib/executors/openai-agents-reconciliation.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-reconciliation");
const outcome = await import(new URL("../../lib/executors/executor-outcome.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-outcome");
const adapter = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const transport = await import(new URL("../../lib/executors/openai-agents-executor.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-executor");
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { context } from "./durable-executor.mts";
export const correlation = "c".repeat(64), fingerprint = "f".repeat(64);
export const tokenUsage = () => ({ input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
export function savedSession(pac = correlation, id = "session_a") {
  return { id, object: "agent.session", agent: { id: "agent_a", model: executorTarget().modelId,
    multi_agent: { enabled: false, max_concurrent_subagents: null }, tools: [{ type: "programmatic_tool_calling", enabled: false }] },
    environment: { type: "none" }, error: null, status: "idle", required_actions: [], vault_ids: [], usage: tokenUsage(),
    created_at: 100, last_active_at: 102, metadata: { pac_execution: pac }, spend_control: { limit: 1, consumed: 0 } };
}
export function savedTurn(id = "turn_a", sessionId = "session_a", status = "completed") {
  return { id, agent_id: "agent_a", object: "agent.session.turn", session_id: sessionId, subagent_id: null, status, error: null,
    usage: tokenUsage(), created_at: 100, started_at: 101, completed_at: ["completed", "failed", "cancelled"].includes(status) ? 102 : null };
}
export function savedAnswer(id = "message_a", turnId = "turn_a", report = "Unverified proposal. Owner review required.") {
  return { id, type: "message", role: "assistant", status: "completed", phase: "final_answer", turn_id: turnId,
    content: [{ type: "output_text", text: JSON.stringify({ changes: [{ path: "src/a.ts", operation: "add", content: "export const answer = 42;\n" }], report }) }] };
}
export function initialUserInput(configuration = executorConfiguration(), raw = executorRequest()) {
  const a = adapter.createExecutorAdapterContract(configuration).adapter!;
  const i = a.validateInvocation(raw).normalizedInvocation!;
  const request = transport.createOpenAIAgentsCanonicalRequest(i, context(), executorTarget(), 10000);
  const item = { id: "initial_user", type: "message", role: "user", status: "completed", phase: null, turn_id: "turn_a",
    content: [{ type: "input_text", text: JSON.parse(request.body).input as string }] };
  return { request, item };
}
export const reasoningItem = (id = "reasoning_a", turnId = "turn_a") => ({ id, type: "reasoning", status: "completed", turn_id: turnId, summary: [{ type: "summary_text", text: "private-reasoning-canary" }] });
export function savedPage(data: unknown[], more = false) {
  return { object: "list", data, first_id: (data[0] as { id?: string })?.id ?? null, last_id: (data.at(-1) as { id?: string })?.id ?? null, has_more: more };
}
export function fakeProvider(pac = correlation, sessionId = "session_a") {
  const state = { session: savedSession(pac, sessionId), turn: savedTurn("turn_a", sessionId), sessions: [savedSession(pac, sessionId)], turns: [savedTurn("turn_a", sessionId)], items: [savedAnswer()] as unknown[],
    pageSize: 16, calls: [] as Array<{ path: string; method: string }>, override: null as null | ((url: URL) => Response | Promise<Response> | undefined) };
  const fakeGet: import("../../lib/executors/openai-agents-retrieval").ExecutorRetrievalGet = async (url, init) => {
    const u = new URL(url); state.calls.push({ path: u.pathname + u.search, method: init.method });
    assert.equal(u.origin, "https://api.openai.com"); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, undefined); assert.equal("body" in init, false);
    assert.match(u.pathname, /^\/v1\/agents\/sessions(?:\/[A-Za-z0-9._-]+(?:\/turns(?:\/[A-Za-z0-9._-]+(?:\/items)?)?)?)?$/u);
    const override = await state.override?.(u); if (override !== undefined) return override;
    const parts = u.pathname.split("/").slice(4); let data: unknown;
    if (parts.length === 1) { assert.equal(parts[0], state.session.id); data = state.session; }
    else if (parts.length === 3) { assert.equal(parts[2], state.turn.id); data = state.turn; }
    else {
      assert.equal(u.searchParams.get("order"), "asc"); assert.equal(u.searchParams.get("limit"), "16");
      const values = parts.length === 0 ? state.sessions : parts.length === 2 ? state.turns : state.items;
      const after = u.searchParams.get("after"), start = after === null ? 0 : values.findIndex(v => (v as { id: string }).id === after) + 1;
      assert.ok(start >= 0); const end = start + state.pageSize; data = savedPage(values.slice(start, end), end < values.length);
    }
    return Response.json(data);
  };
  return { state, fakeGet, client: (target: unknown = executorTarget(), timeout = 1000) => retrieval.createOpenAIAgentsTestRetrievalClient(target, fakeGet, timeout) };
}
/** Unit protocol harness ONLY. PG tests below use real settlement/identity stores. */
export function memoryReconciler(options: { session?: string | null; turn?: string | null; target?: unknown } = {}) {
  const config = executorConfiguration(), raw = executorRequest(), a = adapter.createExecutorAdapterContract(config).adapter!;
  const i = a.validateInvocation(raw).normalizedInvocation!;
  const provider = fakeProvider(); let result: ReturnType<typeof normalizedResult> | null = null, resultFp: string | null = null, marks = 0, releases = 0;
  const p = { attempt: i.attempt, target: executorTarget(), executorIdentity: i.identity, requestFingerprint: fingerprint,
    baseRequestFingerprint: "b".repeat(64), correlationFingerprint: correlation, sessionId: options.session === undefined ? "session_a" : options.session,
    turnId: options.turn === undefined ? "turn_a" : options.turn, identityState: "turn_observed", recoveryRequired: false, createdAt: 1, updatedAt: 2 };
  const e = { projectId: "project-a", attempt: i.attempt, identity: i.identity, invocationId: i.invocationId, planId: i.planId, taskId: i.taskId,
    repository: i.repository, capability: i.capability, mode: i.mode, target: executorTarget(), requestFingerprint: fingerprint,
    state: "reconciliation_required", startedAt: 1, providerSpendLimitCents: 1 };
  const observation = () => ({ verdict: "allow", status: "observed", providerIdentity: structuredClone(p), snapshot: structuredClone(e), startCapability: null, providerCapability: null });
  const store = {
    inspectProviderIdentity: async () => observation(),
    markProviderIdentityUnknown: async () => { marks++; p.recoveryRequired = true; return { verdict: "deny" }; },
    recordProviderSession: async (_raw: unknown, input: { sessionId: string }) => { p.sessionId = input.sessionId; return observation(); },
    recordProviderTurn: async (_raw: unknown, input: { turnId: string }) => { p.turnId = input.turnId; return observation(); },
    recordDefinitiveOutcomeAndSettle: async (_raw: unknown, fp: string, receipt: unknown) => {
      const captured = outcome.readExecutorOutcomeEvidence(receipt, i, fp); assert.ok(captured?.normalizedResult);
      if (resultFp && resultFp !== captured.resultFingerprint) return { verdict: "deny", normalizedResult: null, resultFingerprint: null };
      const status = result ? "idempotent" : "settled"; if (!result) releases++;
      result = captured.normalizedResult; resultFp = captured.resultFingerprint;
      return { verdict: "allow", status, normalizedResult: structuredClone(result), resultFingerprint: resultFp };
    },
  };
  const client = provider.client(options.target);
  const reconciler = reconciliation.createOpenAIAgentsRetrievalTestReconciler({ configuration: config, target: executorTarget(), store, retrievalClient: client });
  return { ...provider, raw, config, client, store, p, e, reconciler, facts: () => ({ marks, releases, result, resultFp }) };
}
export function assertHeld(d: import("../../lib/executors/openai-agents-reconciliation").ExecutorReconciliationDecision) {
  assert.equal(d.verdict, "deny"); assert.equal(d.normalizedResult, null); assert.equal(d.resultFingerprint, null);
  assert.equal(d.startCapability, null); assert.equal(d.providerCapability, null); assert.equal(d.automaticRetryAllowed, false); assert.equal(d.providerMutationAllowed, false); frozen(d);
  assert.doesNotMatch(JSON.stringify(d), /private-(?:reasoning|error|credential)-canary/u);
}
export { digest, frozen, retrieval, reconciliation };
