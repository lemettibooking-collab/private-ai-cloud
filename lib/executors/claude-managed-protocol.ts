import type { NormalizedExecutorInvocation } from "../contracts/executor-adapter";
import type { PreparedExecutorProviderRequest } from "./executor-provider-request";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, freezeDeep, sha256 } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validExecutorProviderId } from "./executor-provider-identity.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { claudeInvalid, claudeSafe } from "./claude-managed-request.ts";

/** Fake-profile schema only, NOT a copied vendor schema or a live transport contract. */
export function validateClaudeSession(input: unknown, request: PreparedExecutorProviderRequest, expectedId: string | null) {
  const s = exactRecord(boundedData(input), ["id", "providerId", "accountId", "modelId", "requestFingerprint", "correlationFingerprint", "configurationDigest",
    "initialInput", "status", "stopReason", "quiescent", "error", "budgetOvershoot", "tools", "skills", "mcp_servers"]);
  const canonical = JSON.parse(request.body);
  if (!validExecutorProviderId(s.id) || (expectedId !== null && s.id !== expectedId) || s.providerId !== "anthropic"
    || s.accountId !== request.target.accountId || s.modelId !== request.target.modelId || s.requestFingerprint !== request.requestFingerprint
    || s.correlationFingerprint !== request.correlationFingerprint || s.configurationDigest !== canonical.metadata.pac_configuration
    || s.initialInput !== canonical.initial_events[0].content || !["running", "idle", "rescheduling", "terminated"].includes(s.status as string)
    || ![null, "end_turn", "requires_action", "budget_reached", "error", "interrupt"].includes(s.stopReason as null | string)
    || typeof s.quiescent !== "boolean" || typeof s.budgetOvershoot !== "boolean" || s.error !== null
    || [s.tools, s.skills, s.mcp_servers].some(v => !Array.isArray(v) || v.length)) claudeInvalid();
  return freezeDeep(s);
}
export async function claudeTerminalProposal(session: Record<string, unknown>, request: PreparedExecutorProviderRequest,
  i: NormalizedExecutorInvocation, list: (id: string, after: string | null) => Promise<unknown>) {
  if (session.status !== "idle" || session.stopReason !== "end_turn" || session.quiescent !== true || session.budgetOvershoot !== false) claudeInvalid();
  const seen = new Map<string, string>(), cursors = new Set<string>(); let after: string | null = null, answer: string | null = null, user = 0, ended = false,
    totalBytes = Buffer.byteLength(JSON.stringify(session)), finished = false;
  const canonical = JSON.parse(request.body);
  for (let n = 0; n < 4; n++) {
    const p = exactRecord(boundedData(await list(session.id as string, after)), ["sessionId", "after", "next", "hasMore", "events"]);
    if (p.sessionId !== session.id || p.after !== after || typeof p.hasMore !== "boolean" || !Array.isArray(p.events)
      || p.events.length > 64 || (p.next !== null && !validExecutorProviderId(p.next))) claudeInvalid();
    totalBytes += Buffer.byteLength(JSON.stringify(p)); if (totalBytes > 262144) claudeInvalid();
    for (const value of p.events) {
      const e = exactRecord(value, ["id", "sequence", "type", "content"]);
      if (!validExecutorProviderId(e.id) || !Number.isInteger(e.sequence) || (e.sequence as number) < 0 || (e.sequence as number) > 63
        || typeof e.type !== "string" || typeof e.content !== "string") claudeInvalid();
      claudeSafe(e.content); const bytes = JSON.stringify(e), prior = seen.get(e.id);
      if (prior !== undefined) { if (prior !== bytes) claudeInvalid(); continue; }
      if (ended || seen.size >= 64 || e.sequence !== seen.size) claudeInvalid(); seen.set(e.id, bytes);
      if (e.type === "user.message") { if (seen.size !== 1 || ++user !== 1 || e.content !== canonical.initial_events[0].content) claudeInvalid(); }
      else if (e.type === "agent.message") { if (user !== 1 || answer !== null) claudeInvalid(); answer = e.content; }
      else if (e.type === "session.end_turn") { if (answer === null || e.content !== "") claudeInvalid(); ended = true; }
      else claudeInvalid();
    }
    if (!p.hasMore) { if (p.next !== null) claudeInvalid(); finished = true; break; }
    if (!p.events.length || p.next === null || p.next === after || cursors.has(p.next as string)) claudeInvalid();
    cursors.add(p.next as string); after = p.next as string;
  }
  if (!finished || !ended || user !== 1 || answer === null) claudeInvalid();
  const proposal = exactRecord(boundedData(JSON.parse(answer)), ["changes", "report"]);
  if (!Array.isArray(proposal.changes) || proposal.changes.length > 64 || typeof proposal.report !== "string") claudeInvalid();
  const changes = proposal.changes.map(value => {
    const c = exactRecord(value, ["path", "operation", "content"]);
    if (typeof c.path !== "string" || !["add", "modify", "delete"].includes(c.operation as string) || !(c.content === null || typeof c.content === "string")) claudeInvalid();
    return { path: c.path, operation: c.operation as "add" | "modify" | "delete", content: c.content as string | null, sha256: typeof c.content === "string" ? sha256(c.content) : null };
  });
  return { schemaVersion: 1 as const, identity: i.identity, invocationId: i.invocationId, status: "succeeded" as const, failureCode: null,
    changes, report: { content: proposal.report, sha256: sha256(proposal.report) } };
}
