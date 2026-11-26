import type { NormalizedExecutorInvocation, ExecutorResultInput } from "../contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, sha256, HandoffBlocked } from "../local-handoff/local-handoff-policy.ts";

/** One interpretation of the proposal-only saved/streamed subset. Never persist reasoning. */
export function openAIAgentsFinalText(input: unknown, turnId: string): string | null {
  const item = boundedData(input) as Record<string, unknown>;
  if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(item.id)
    || item.turn_id !== turnId || item.status !== "completed") throw new HandoffBlocked("invalid_executor_response");
  if (item.type === "reasoning") {
    exactRecord(item, ["id", "type", "status", "summary", "turn_id"]);
    if (!Array.isArray(item.summary)) throw new HandoffBlocked("invalid_executor_response");
    for (const value of item.summary) {
      const s = exactRecord(value, ["type", "text"]);
      if (s.type !== "summary_text" || typeof s.text !== "string") throw new HandoffBlocked("invalid_executor_response");
    }
    return null;
  }
  exactRecord(item, ["id", "type", "role", "status", "phase", "turn_id", "content"]);
  if (item.type !== "message" || item.role !== "assistant" || !["commentary", "final_answer"].includes(item.phase as string)
    || !Array.isArray(item.content) || item.content.length !== 1) throw new HandoffBlocked("invalid_executor_response");
  const c = exactRecord(item.content[0], ["type", "text"]);
  if (c.type !== "output_text" || typeof c.text !== "string") throw new HandoffBlocked("invalid_executor_response");
  return item.phase === "final_answer" ? c.text : null;
}

/** Builds raw adapter input, not an approved proposal. Adapter checks paths/secrets/evidence. */
export function openAIAgentsProposal(input: unknown, i: NormalizedExecutorInvocation): ExecutorResultInput {
  const p = exactRecord(boundedData(input), ["changes", "report"]);
  if (!Array.isArray(p.changes) || typeof p.report !== "string") throw new HandoffBlocked("invalid_executor_response");
  const changes = p.changes.map(value => {
    const c = exactRecord(value, ["path", "operation", "content"]);
    if (typeof c.path !== "string" || !["add", "modify", "delete"].includes(c.operation as string)
      || !(c.content === null || typeof c.content === "string")) throw new HandoffBlocked("invalid_executor_response");
    return { path: c.path, operation: c.operation as "add" | "modify" | "delete", content: c.content as string | null,
      sha256: typeof c.content === "string" ? sha256(c.content) : null };
  });
  return { schemaVersion: 1, identity: i.identity, invocationId: i.invocationId, status: "succeeded", failureCode: null,
    changes, report: { content: p.report, sha256: sha256(p.report) } };
}
