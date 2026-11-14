// Narrow no-tools Responses protocol. No SDK, credentials, network or execution authority.
// Raw errors/refusals/deltas never leave this parser. Only a complete, correlated terminal
// assistant message can supply a proposal. Current official SIWC route requires store=false/stream=true.
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, freezeDeep } from "../local-handoff/local-handoff-policy.ts";
export const subscriptionResponseLimits = Object.freeze({ streamBytes: 2 * 1024 * 1024, eventBytes: 300 * 1024,
  events: 4096, timeoutMs: 120000 });
export type SubscriptionResponseEvidence = Readonly<{
  state: "completed" | "failed" | "outcome_unknown";
  code: "completed" | "provider_failure" | "incomplete" | "ambiguous_outcome" | "usage_limit_exceeded"
    | "usage_unavailable" | "not_eligible" | "unsupported_capability" | "reauthorization_required";
  proposal: unknown | null; responseId: string | null;
  automaticRetryAllowed: false; retryAfterMs: number | null;
}>;
const evidence = (state: SubscriptionResponseEvidence["state"], code: SubscriptionResponseEvidence["code"],
  responseId: string | null = null, proposal: unknown = null, retryAfterMs: number | null = null): SubscriptionResponseEvidence =>
  freezeDeep({ state, code, proposal, responseId, automaticRetryAllowed: false, retryAfterMs });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const responseId = (v: unknown): v is string => typeof v === "string" && /^resp_[A-Za-z0-9_-]{1,128}$/u.test(v);
function outputShape(output: unknown, terminal: boolean): void {
  if (!Array.isArray(output)) throw Error();
  for (const item of output) {
    if (!object(item)) throw Error();
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)
      || !(terminal ? ["completed", "incomplete"] : ["in_progress", "completed", "incomplete"]).includes(item.status as string)) throw Error();
    for (const part of item.content) {
      if (!object(part) || !(part.type === "output_text" && typeof part.text === "string"
        || part.type === "refusal" && typeof part.refusal === "string")) throw Error();
    }
  }
}
const events = new Set(["response.created", "response.queued", "response.in_progress", "response.output_item.added", "response.output_item.done",
  "response.content_part.added", "response.content_part.done", "response.output_text.delta", "response.output_text.done",
  "response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done",
  "response.reasoning_text.delta", "response.reasoning_text.done", "response.completed", "response.failed", "response.incomplete", "error"]);
/** HTTP failure bodies are bounded by the caller. Unknown/5xx failures remain ambiguous;
 * no fabricated provider result and no hidden retry. retryAfterMs is advisory to the Owner only. */
export function subscriptionFailureEvidence(status: number, input: unknown): SubscriptionResponseEvidence {
  try {
    if (![400, 401, 403, 429].includes(status)) return evidence("outcome_unknown", "ambiguous_outcome");
    const r = boundedData(input); if (!object(r)) throw Error();
    const error = object(r.error) ? r.error : object(r.detail) ? r.detail : r;
    const code = error.code;
    const known = {
      subscription_sharing_usage_limit_exceeded: "usage_limit_exceeded",
      subscription_sharing_usage_unavailable: "usage_unavailable",
      subscription_sharing_user_not_eligible: "not_eligible",
      subscription_sharing_unsupported_capability: "unsupported_capability",
      invalid_token: "reauthorization_required", token_expired: "reauthorization_required",
    } as const;
    if (typeof code === "string" && Object.hasOwn(known, code)) {
      const safe = known[code as keyof typeof known];
      return evidence("failed", safe, null, null, safe === "usage_unavailable" ? 30000 : null);
    }
    if (status === 401) return evidence("failed", "reauthorization_required");
  } catch { /* Never serialize an unknown error/body. */ }
  return evidence("outcome_unknown", "ambiguous_outcome");
}
export function createSubscriptionResponseParser(model: string) {
  let id: string | null = null, terminal: SubscriptionResponseEvidence | null = null, invalid = false, count = 0;
  return Object.freeze({
    push(raw: unknown): void {
      if (invalid) return;
      try {
        if (++count > subscriptionResponseLimits.events || terminal) throw Error();
        const event = boundedData(raw); if (!object(event) || typeof event.type !== "string" || !events.has(event.type)) throw Error();
        // An SSE error is NOT a response.failed terminal fact. Even a familiar code
        // may arrive after model work; never release the predecessor hold on it.
        if (event.type === "error") { invalid = true; terminal = null; return; }
        if (event.item !== undefined) outputShape([event.item], false);
        if (event.part !== undefined && (!object(event.part) || !["output_text", "summary_text", "reasoning_text"].includes(event.part.type as string))) throw Error();
        if (event.response !== undefined) {
          const r = event.response;
          if (!object(r) || !responseId(r.id) || (id !== null && id !== r.id) || r.model !== model) throw Error();
          id = r.id;
          if (r.output !== undefined) outputShape(r.output, ["completed", "failed", "incomplete"].includes(r.status as string));
          if (["completed", "failed", "incomplete"].includes(r.status as string) && !Array.isArray(r.output)) throw Error();
          if (event.type === "response.completed") {
            if (r.status !== "completed" || r.error !== null || r.incomplete_details !== null || !Array.isArray(r.output) || !r.output.length) throw Error();
            const text: string[] = [];
            for (const item of r.output) {
              if (!object(item)) throw Error();
              if (item.type === "reasoning") continue;
              if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content) || !item.content.length) throw Error();
              for (const part of item.content) {
                if (!object(part) || part.type !== "output_text" || typeof part.text !== "string") throw Error();
                text.push(part.text);
              }
            }
            const joined = text.join(""); if (!joined.trim() || Buffer.byteLength(joined) > 256 * 1024) throw Error();
            // JSON.parse only sees a bounded string from a bounded detached snapshot.
            const proposal = boundedData(JSON.parse(joined));
            terminal = evidence("completed", "completed", id, proposal);
          } else if (event.type === "response.failed") {
            if (r.status !== "failed" || r.incomplete_details !== null || (r.error !== null && (!object(r.error)
              || typeof r.error.code !== "string" || r.error.code.length > 128 || /[\r\n]/u.test(r.error.code)
              || typeof r.error.message !== "string" || r.error.message.length > 4096))) throw Error();
            const failure = subscriptionFailureEvidence(400, r);
            terminal = evidence("failed", failure.code === "ambiguous_outcome" ? "provider_failure" : failure.code, id, null, failure.retryAfterMs);
          } else if (event.type === "response.incomplete") {
            if (r.status !== "incomplete" || r.error !== null || !object(r.incomplete_details)
              || !["max_output_tokens", "content_filter"].includes(r.incomplete_details.reason as string)) throw Error();
            terminal = evidence("failed", "incomplete", id);
          } else if (!["queued", "in_progress"].includes(r.status as string) || r.error !== null || r.incomplete_details !== null) throw Error();
        } else if (["response.completed", "response.failed", "response.incomplete", "response.created", "response.queued", "response.in_progress"].includes(event.type)) throw Error();
      } catch { invalid = true; terminal = null; }
    },
    finish(): SubscriptionResponseEvidence { return invalid || terminal === null ? evidence("outcome_unknown", "ambiguous_outcome") : terminal; },
  });
}
/** One bounded stream, no retry. The caller owns the already-authorized single POST. */
export async function readSubscriptionResponse(response: Response, model: string, signal: AbortSignal): Promise<SubscriptionResponseEvidence> {
  const parser = createSubscriptionResponseParser(model);
  const reader = response.body?.getReader(); if (!reader) return evidence("outcome_unknown", "ambiguous_outcome");
  let bytes = 0, pending = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const cancelled = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancelled, { once: true });
  try {
    if (!response.ok) {
      let body = "";
      for (;;) { if (signal.aborted) throw Error(); const next = await reader.read(); if (next.done) break;
        bytes += next.value.length; if (bytes > 16384) throw Error(); body += decoder.decode(next.value, { stream: true }); }
      if (signal.aborted) throw Error(); body += decoder.decode(); return subscriptionFailureEvidence(response.status, JSON.parse(body));
    }
    if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/event-stream")) throw Error();
    const consume = (frame: string) => {
      if (Buffer.byteLength(frame) > subscriptionResponseLimits.eventBytes) throw Error();
      const fields = frame.split("\n"); const data = fields.filter(x => x.startsWith("data:")).map(x => x.slice(5).trimStart()).join("\n");
      if (!data) return;
      if (data === "[DONE]") return; // Not completion evidence.
      const raw = JSON.parse(data); const named = fields.find(x => x.startsWith("event:"))?.slice(6).trim();
      if (named && (!object(raw) || named !== raw.type)) throw Error(); parser.push(raw);
    };
    for (;;) {
      if (signal.aborted) throw Error(); const next = await reader.read(); if (next.done) break;
      bytes += next.value.length; if (bytes > subscriptionResponseLimits.streamBytes) throw Error();
      pending = (pending + decoder.decode(next.value, { stream: true })).replace(/\r\n/gu, "\n");
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) { consume(pending.slice(0, end)); pending = pending.slice(end + 2); }
      if (Buffer.byteLength(pending) > subscriptionResponseLimits.eventBytes) throw Error();
    }
    pending += decoder.decode(); if (signal.aborted || pending.trim()) throw Error();
    return parser.finish();
  } catch { return evidence("outcome_unknown", "ambiguous_outcome"); }
  finally { signal.removeEventListener("abort", cancelled); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
