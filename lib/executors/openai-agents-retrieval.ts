import type { ExecutorTarget } from "./executor-start-boundary";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeExecutorTarget } from "./executor-start-boundary.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validExecutorProviderId } from "./executor-provider-identity.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, freezeDeep } from "../local-handoff/local-handoff-policy.ts";

export const executorRetrievalLimits = Object.freeze({ sessions: 64, turns: 32, items: 128,
  sessionPages: 4, turnPages: 4, itemPages: 8, pageSize: 16, jsonBytes: 2 * 1024 * 1024,
  outputBytes: 256 * 1024, cursorBytes: 1024, chunks: 4096, getTimeoutMs: 1000, requests: 18 });
export type ExecutorRetrievalGet = (url: string, init: Readonly<{ method: "GET"; redirect: "error";
  headers: Readonly<Record<string, string>>; signal: AbortSignal }>) => Promise<Response>;
export type RetrievalPage = Readonly<{ data: readonly Record<string, unknown>[]; lastId: string | null; hasMore: boolean }>;
export type RetrievalPort = Readonly<{
  listSessions(after: string | null): Promise<RetrievalPage>;
  retrieveSession(sessionId: string): Promise<Record<string, unknown>>;
  listTurns(sessionId: string, after: string | null): Promise<RetrievalPage>;
  retrieveTurn(sessionId: string, turnId: string): Promise<Record<string, unknown>>;
  listTurnItems(sessionId: string, turnId: string, after: string | null): Promise<RetrievalPage>;
}>;
export type ExecutorRetrievalTestClient = Readonly<{ kind: "executor_test_retrieval" }>;
const clients = new WeakMap<object, { target: ExecutorTarget; open(): RetrievalPort }>();
export function retrievalInvalid(): never { throw Error("executor_retrieval_unavailable"); }
export function retrievalRecord(value: unknown, allowed: readonly string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) retrievalInvalid();
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(r, k))) retrievalInvalid();
  return r;
}
export function retrievalId(value: unknown): string { if (!validExecutorProviderId(value)) retrievalInvalid(); return value; }
/** Conversation cursors are opaque query values, NOT provider resource identifiers. */
function conversationCursor(value: unknown): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > executorRetrievalLimits.cursorBytes
    || !/^[\x21-\x7e]+$/u.test(value)) retrievalInvalid();
  return value;
}
const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1000000000;
function stamp(v: unknown): number { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 1000000000000000) retrievalInvalid(); return v; }
export function retrievalUsage(value: unknown) {
  if (value === null) return null;
  const u = retrievalRecord(value, ["input_tokens", "output_tokens", "total_tokens", "input_tokens_details", "output_tokens_details"], ["input_tokens", "output_tokens", "total_tokens"]);
  if (!natural(u.input_tokens) || !natural(u.output_tokens) || !natural(u.total_tokens) || u.input_tokens + u.output_tokens !== u.total_tokens) retrievalInvalid();
  for (const [field, key, cap] of [["input_tokens_details", "cached_tokens", u.input_tokens], ["output_tokens_details", "reasoning_tokens", u.output_tokens]] as const) {
    if (u[field] !== undefined) { const d = exactRecord(u[field], [key]); if (!natural(d[key]) || (d[key] as number) > cap) retrievalInvalid(); }
  }
  return freezeDeep({ inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens });
}
function sessionError(value: unknown, status: unknown) {
  if (value === null) return;
  if (status !== "failed" || typeof value !== "string" || Buffer.byteLength(value) > 4096) retrievalInvalid();
  // Beta session.error is a string. Validate/discard, never classify or project it.
}
function turnError(value: unknown) {
  if (value === null) return;
  const e = exactRecord(value, ["code", "message"]);
  if (typeof e.code !== "string" || e.code.length > 128 || typeof e.message !== "string" || e.message.length > 4096) retrievalInvalid();
  // Deliberately discard both strings. No raw error classification, logging or persistence.
}
export function sessionCorrelation(s: Record<string, unknown>): unknown {
  const metadata = s.metadata;
  if (metadata === null) return null;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || Object.keys(metadata).length > 16) retrievalInvalid();
  for (const [key, value] of Object.entries(metadata)) {
    if (key.length > 64 || typeof value !== "string" || value.length > 512) retrievalInvalid();
  }
  return (metadata as Record<string, unknown>).pac_execution;
}
export function validateRetrievedSession(input: Record<string, unknown>, expectedId: string, correlation: string, modelId: string, cap: number) {
  const s = retrievalRecord(input, ["id", "object", "agent", "environment", "error", "status", "required_actions", "vault_ids", "usage", "created_at", "last_active_at", "metadata", "spend_control"]);
  if (retrievalId(s.id) !== expectedId || s.object !== "agent.session" || sessionCorrelation(s) !== correlation
    || !["idle", "in_progress", "requires_action", "failed"].includes(s.status as string)) retrievalInvalid();
  const a = retrievalRecord(s.agent, ["id", "model", "instructions", "multi_agent", "tools", "name", "reasoning", "service_tier", "text"], ["id", "model", "multi_agent", "tools"]);
  const agentId = retrievalId(a.id), m = retrievalRecord(a.multi_agent, ["enabled", "max_concurrent_subagents"], ["enabled"]);
  if (a.model !== modelId || m.enabled !== false || (m.max_concurrent_subagents !== undefined && m.max_concurrent_subagents !== null && m.max_concurrent_subagents !== 0)
    || exactRecord(s.environment, ["type"]).type !== "none" || !Array.isArray(a.tools) || a.tools.length !== 1) retrievalInvalid();
  const tool = exactRecord(a.tools[0], ["type", "enabled"]);
  if (tool.type !== "programmatic_tool_calling" || tool.enabled !== false || !Array.isArray(s.required_actions) || s.required_actions.length
    || !Array.isArray(s.vault_ids) || s.vault_ids.length) retrievalInvalid();
  const spend = exactRecord(s.spend_control, ["limit", "consumed"]);
  if (spend.limit !== cap || !natural(spend.limit) || !(spend.consumed === null || natural(spend.consumed))
    || (typeof spend.consumed === "number" && spend.consumed > cap)) retrievalInvalid();
  const created = stamp(s.created_at), active = stamp(s.last_active_at); if (active < created) retrievalInvalid();
  sessionError(s.error, s.status);
  retrievalUsage(s.usage);
  return freezeDeep({ id: expectedId, agentId, status: s.status as string, consumed: spend.consumed as number | null });
}
export function validateRetrievedTurn(input: Record<string, unknown>, sessionId: string, agentId: string, expectedId?: string) {
  const t = exactRecord(input, ["id", "agent_id", "object", "session_id", "subagent_id", "status", "error", "usage", "created_at", "started_at", "completed_at"]);
  const id = retrievalId(t.id);
  if ((expectedId !== undefined && id !== expectedId) || t.session_id !== sessionId || t.agent_id !== agentId
    || t.object !== "agent.session.turn" || t.subagent_id !== null
    || !["queued", "in_progress", "waiting", "completed", "failed", "cancelled"].includes(t.status as string)) retrievalInvalid();
  const terminal = ["completed", "failed", "cancelled"].includes(t.status as string), created = stamp(t.created_at);
  if (t.started_at !== null && stamp(t.started_at) < created) retrievalInvalid();
  if (terminal ? t.completed_at === null || stamp(t.completed_at) < (t.started_at as number | null ?? created) : t.completed_at !== null) retrievalInvalid();
  if (t.status === "completed" && t.started_at === null) retrievalInvalid();
  turnError(t.error); if (t.status !== "failed" && t.error !== null) retrievalInvalid();
  return freezeDeep({ id, status: t.status as string, usage: retrievalUsage(t.usage) });
}
/** Retrieval-only initial input branch. Shared SSE parser deliberately does NOT call this. */
export function savedInitialUserText(input: unknown, turnId: string): string {
  const item = exactRecord(boundedData(input), ["id", "type", "role", "status", "phase", "turn_id", "content"]);
  retrievalId(item.id);
  if (item.type !== "message" || item.role !== "user" || item.status !== "completed" || item.phase !== null || item.turn_id !== turnId
    || !Array.isArray(item.content) || item.content.length !== 1) retrievalInvalid();
  const content = exactRecord(item.content[0], ["type", "text"]);
  if (content.type !== "input_text" || typeof content.text !== "string" || !content.text.length || Buffer.byteLength(content.text) > 65536) retrievalInvalid();
  return content.text;
}
function page(value: unknown, mode: "resource" | "conversation" = "resource"): RetrievalPage {
  const p = exactRecord(value, ["object", "data", "first_id", "last_id", "has_more"]);
  if (p.object !== "list" || !Array.isArray(p.data) || p.data.length > executorRetrievalLimits.pageSize || typeof p.has_more !== "boolean") retrievalInvalid();
  const data = p.data.map(v => { if (!v || typeof v !== "object" || Array.isArray(v)) retrievalInvalid(); retrievalId(v.id); return v as Record<string, unknown>; });
  if (p.first_id !== (data[0]?.id ?? null) || (p.has_more && !data.length)) retrievalInvalid();
  if (mode === "resource") {
    if (p.last_id !== (data.at(-1)?.id ?? null)) retrievalInvalid();
  } else {
    if (p.last_id !== null) conversationCursor(p.last_id);
    if (p.has_more && p.last_id === null) retrievalInvalid();
  }
  return freezeDeep({ data, lastId: p.last_id as string | null, hasMore: p.has_more });
}
/** TEST HARNESS ONLY. No credential resolver, SDK, fetch fallback or production unlock.
 * The injected function must be in-process; a trusted-server compromise is outside this boundary. */
export function createOpenAIAgentsTestRetrievalClient(targetInput: unknown, fakeGet: ExecutorRetrievalGet, timeoutMs: number = executorRetrievalLimits.getTimeoutMs): ExecutorRetrievalTestClient {
  const target = normalizeExecutorTarget(targetInput);
  if (target.providerId !== "openai" || typeof fakeGet !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > executorRetrievalLimits.getTimeoutMs) retrievalInvalid();
  const client = Object.freeze({ kind: "executor_test_retrieval" as const });
  clients.set(client, { target, open() {
    let requests = 0;
    const get = async (path: string) => {
      if (++requests > executorRetrievalLimits.requests) retrievalInvalid();
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const work = async () => {
        const response = await fakeGet(`https://api.openai.com/v1/agents/sessions${path}`, Object.freeze({ method: "GET", redirect: "error", signal: controller.signal,
          headers: Object.freeze({ Accept: "application/json", "OpenAI-Beta": "agents=v1" }) }));
        if (controller.signal.aborted || response.status !== 200 || response.redirected || !response.headers.get("content-type")?.startsWith("application/json") || !response.body) {
          void response.body?.cancel().catch(() => {}); retrievalInvalid();
        }
        reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, chunks = 0, text = "";
        while (true) {
          const next = await reader.read(); if (controller.signal.aborted) retrievalInvalid();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > executorRetrievalLimits.jsonBytes || ++chunks > executorRetrievalLimits.chunks) retrievalInvalid();
          text += decoder.decode(next.value, { stream: true });
        }
        text += decoder.decode(); return boundedData(JSON.parse(text));
      };
      try {
        return await Promise.race([work(), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(Error("executor_retrieval_unavailable")); }, timeoutMs);
        })]);
      } catch { return retrievalInvalid(); }
      finally { if (timer) clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}); }
    };
    const segment = (id: string) => encodeURIComponent(retrievalId(id));
    const query = (after: string | null, items = false) => `?order=asc&limit=${executorRetrievalLimits.pageSize}${after === null ? "" : `&after=${items ? encodeURIComponent(conversationCursor(after)) : segment(after)}`}`;
    return Object.freeze({
      listSessions: async (after: string | null) => page(await get(query(after))),
      retrieveSession: async (id: string) => retrievalRecord(await get(`/${segment(id)}`), ["id", "object", "agent", "environment", "error", "status", "required_actions", "vault_ids", "usage", "created_at", "last_active_at", "metadata", "spend_control"]),
      listTurns: async (id: string, after: string | null) => page(await get(`/${segment(id)}/turns${query(after)}`)),
      retrieveTurn: async (id: string, turn: string) => retrievalRecord(await get(`/${segment(id)}/turns/${segment(turn)}`), ["id", "agent_id", "object", "session_id", "subagent_id", "status", "error", "usage", "created_at", "started_at", "completed_at"]),
      listTurnItems: async (id: string, turn: string, after: string | null) => page(await get(`/${segment(id)}/turns/${segment(turn)}/items${query(after, true)}`), "conversation"),
    });
  } });
  return client;
}
/** A clone/proxy/caller-declared account is not a branded test client. Fresh bounded pass. */
export function openExecutorRetrievalPass(input: unknown, target: ExecutorTarget): RetrievalPort | null {
  const c = input && typeof input === "object" ? clients.get(input) : null;
  return c && c.target.providerId === target.providerId && c.target.modelId === target.modelId && c.target.accountId === target.accountId ? c.open() : null;
}
