import { isDeepStrictEqual } from "node:util";
import type { NormalizedExecutorResult } from "../contracts/executor-adapter";
import type { createPostgresExecutorStartStore } from "../db/executor-start-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorOutcomeCapture } from "./executor-outcome.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeExecutorTarget } from "./executor-start-boundary.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, freezeDeep, sha256 } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createOpenAIAgentsCanonicalRequest } from "./openai-agents-executor.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { capturedMethod, exactOwnData } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { openAIAgentsFinalText, openAIAgentsProposal } from "./openai-agents-result.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorRetrievalLimits as limits, openExecutorRetrievalPass, retrievalInvalid, retrievalId, sessionCorrelation, validateRetrievedSession, validateRetrievedTurn, savedInitialUserText } from "./openai-agents-retrieval.ts";
import type { RetrievalPage } from "./openai-agents-retrieval";

export type ExecutorReconciliationDecision = Readonly<{
  verdict: "allow" | "deny"; status: "settled" | "idempotent" | "pending_reconciliation" | "recovery_required" | "unavailable";
  reason: string | null; normalizedResult: NormalizedExecutorResult | null; resultFingerprint: string | null;
  startCapability: null; providerCapability: null; automaticRetryAllowed: false; providerMutationAllowed: false;
}>;
type Store = ReturnType<typeof createPostgresExecutorStartStore>;
const methods = ["inspectProviderIdentity", "recordProviderSession", "recordProviderTurn", "markProviderIdentityUnknown", "recordDefinitiveOutcomeAndSettle"] as const;
export function blockedExecutorReconciliation(): ExecutorReconciliationDecision {
  return decision("unavailable", "executor_live_retrieval_blocked");
}
function decision(status: ExecutorReconciliationDecision["status"], reason: string | null,
  normalizedResult: NormalizedExecutorResult | null = null, resultFingerprint: string | null = null): ExecutorReconciliationDecision {
  return freezeDeep({ verdict: normalizedResult ? "allow" : "deny", status, reason, normalizedResult, resultFingerprint,
    startCapability: null, providerCapability: null, automaticRetryAllowed: false, providerMutationAllowed: false });
}
/** Exhaust all pages BEFORE using discoveries or output. No partial-page success/absence proof. */
async function allPages(get: (after: string | null) => Promise<RetrievalPage>, maxPages: number, maxCount: number) {
  const ids = new Set<string>(), cursors = new Set<string>(), result: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (let n = 0; n < maxPages; n++) {
    const p = await get(after);
    for (const v of p.data) {
      const id = retrievalId(v.id); if (ids.has(id) || ids.size >= maxCount) retrievalInvalid();
      ids.add(id); result.push(v);
    }
    if (p.lastId !== null && (p.lastId === after || cursors.has(p.lastId))) retrievalInvalid();
    if (!p.hasMore) return result;
    if (p.lastId === null) retrievalInvalid();
    cursors.add(p.lastId); after = p.lastId;
  }
  return retrievalInvalid();
}
/** INTERNAL TEST composition only. Captures trusted methods once; never receives a start issuer.
 * Production root is a separate constant-deny facade, not a switch on this function. */
export function createOpenAIAgentsRetrievalTestReconciler(input: unknown) {
  if (typeof window !== "undefined") throw Error("executor_reconciliation_server_only");
  const c = exactOwnData(input, ["configuration", "target", "store", "retrievalClient"]);
  if (!c) throw Error("invalid_executor_reconciler_configuration");
  const configuration = freezeDeep(boundedData(c.configuration)), target = normalizeExecutorTarget(c.target);
  const adapter = createExecutorAdapterContract(configuration).adapter;
  const port = Object.fromEntries(methods.map(key => [key, capturedMethod(c.store, key)]));
  if (!adapter || target.providerId !== "openai" || methods.some(key => !port[key]) || !openExecutorRetrievalPass(c.retrievalClient, target)) throw Error("invalid_executor_reconciler_configuration");
  const store = Object.fromEntries(methods.map(key => [key, (...args: unknown[]) => Reflect.apply(port[key]!, undefined, args)])) as Pick<Store, typeof methods[number]>;
  return Object.freeze({ realDispatch: "blocked" as const, realRetrieval: "blocked" as const,
    async reconcile(rawInput: unknown): Promise<ExecutorReconciliationDecision> {
      let raw: unknown, inspected = false;
      const held = async (status: "pending_reconciliation" | "recovery_required" | "unavailable", reason: string) => {
        if (inspected) { try { await store.markProviderIdentityUnknown(raw); } catch { /* full hold, no restart */ } }
        return decision(status, reason);
      };
      try {
        raw = freezeDeep(boundedData(rawInput)); const i = adapter.validateInvocation(raw).normalizedInvocation;
        if (!i) return decision("recovery_required", "executor_invocation_denied");
        const observed = await store.inspectProviderIdentity(raw), p = observed.providerIdentity, e = observed.snapshot;
        if (observed.verdict !== "allow" || !p || !e || e.startedAt === null || !["start_committed", "reconciliation_required", "settled"].includes(e.state)
          || p.requestFingerprint !== e.requestFingerprint || !isDeepStrictEqual(p.target, target) || !isDeepStrictEqual(e.target, target)
          || !isDeepStrictEqual(p.attempt, i.attempt) || !isDeepStrictEqual(e.attempt, i.attempt)
          || !isDeepStrictEqual(p.executorIdentity, i.identity) || !isDeepStrictEqual(e.identity, i.identity)
          || !isDeepStrictEqual(e.repository, i.repository) || e.invocationId !== i.invocationId || e.planId !== i.planId || e.taskId !== i.taskId
          || e.capability !== i.capability || e.mode !== i.mode) return decision("recovery_required", "executor_identity_denied");
        inspected = true;
        const client = openExecutorRetrievalPass(c.retrievalClient, target); if (!client) retrievalInvalid();
        let sessionId = p.sessionId, turnId = p.turnId;
        const observation = { requestFingerprint: p.requestFingerprint, correlationFingerprint: p.correlationFingerprint, target };
        if (sessionId === null) {
          const sessions = await allPages(client.listSessions, limits.sessionPages, limits.sessions);
          const matches = sessions.filter(s => { if (s.object !== "agent.session") retrievalInvalid(); return sessionCorrelation(s) === p.correlationFingerprint; });
          if (!matches.length) return held("pending_reconciliation", "provider_session_unresolved");
          if (matches.length !== 1) return held("recovery_required", "provider_identity_ambiguous");
          sessionId = retrievalId(matches[0].id);
          // Validate discovery AND the exact fresh retrieval before persisting any ID.
          validateRetrievedSession(matches[0], sessionId, p.correlationFingerprint, target.modelId, e.providerSpendLimitCents);
        }
        const session = validateRetrievedSession(await client.retrieveSession(sessionId), sessionId, p.correlationFingerprint, target.modelId, e.providerSpendLimitCents);
        if (p.sessionId === null && (await store.recordProviderSession(raw, { ...observation, sessionId })).verdict !== "allow") return held("recovery_required", "provider_identity_conflict");
        if (session.status === "requires_action") return held("recovery_required", "provider_action_unexpected");
        if (session.status === "in_progress") return held("pending_reconciliation", "provider_session_running");
        if (turnId === null) {
          const turns = (await allPages(after => client.listTurns(sessionId!, after), limits.turnPages, limits.turns))
            .map(t => validateRetrievedTurn(t, sessionId!, session.agentId));
          if (!turns.length) return held("pending_reconciliation", "provider_turn_unresolved");
          if (turns.length !== 1) return held("recovery_required", "provider_identity_ambiguous");
          turnId = turns[0].id;
          if ((await store.recordProviderTurn(raw, { ...observation, sessionId, turnId })).verdict !== "allow") return held("recovery_required", "provider_identity_conflict");
        }
        const turn = validateRetrievedTurn(await client.retrieveTurn(sessionId, turnId), sessionId, session.agentId, turnId);
        if (["queued", "in_progress", "waiting"].includes(turn.status)) return held("pending_reconciliation", "provider_turn_running");
        let result;
        if (turn.status === "completed") {
          const items = await allPages(after => client.listTurnItems(sessionId!, turnId!, after), limits.itemPages, limits.items);
          let answer: string | null = null, bytes = 0;
          for (const item of items) {
            // All text, including ignored reasoning, was bounded in each response snapshot.
            bytes += Buffer.byteLength(JSON.stringify(item)); if (bytes > limits.outputBytes) retrievalInvalid();
            if (item.role === "user") {
              // PAC sends one initial string, never steering/follow-up messages. It must be
              // first in ascending saved history AND match the exact original request bytes.
              if (item !== items[0]) return held("recovery_required", "provider_user_history_unexpected");
              const text = savedInitialUserText(item, turnId);
              const payload = boundedData(JSON.parse(text)) as Record<string, unknown>;
              const canonical = createOpenAIAgentsCanonicalRequest(i, payload?.context, target, e.maximumExposureUsdMicros);
              const body = JSON.parse(canonical.body);
              body.metadata = { pac_execution: p.correlationFingerprint };
              if (body.input !== text || canonical.baseRequestFingerprint !== p.baseRequestFingerprint
                || sha256(JSON.stringify(body)) !== p.requestFingerprint) return held("recovery_required", "provider_initial_input_mismatch");
              // No raw user text reaches result evaluation, evidence capture, audit or output.
              continue;
            }
            const text = openAIAgentsFinalText(item, turnId);
            if (text !== null) { if (answer !== null) retrievalInvalid(); answer = text; }
          }
          if (answer === null) return held("recovery_required", "provider_final_output_missing");
          result = adapter.evaluateResult(i, openAIAgentsProposal(JSON.parse(answer), i)).normalizedResult;
        } else {
          result = adapter.evaluateResult(i, { schemaVersion: 1, identity: i.identity, invocationId: i.invocationId, status: "failed",
            failureCode: turn.status === "failed" ? "provider_failure" : "execution_failure", changes: [], report: null }).normalizedResult;
        }
        if (!result) return held("recovery_required", "executor_result_denied");
        // Per-call immutable evidence; no shared last-response slot or GET inside a DB transaction.
        const evidence = freezeDeep({ terminality: "definitive_terminal", normalizedResult: result, usage: turn.usage, providerConsumedCents: session.consumed });
        const receipt = await createExecutorOutcomeCapture(configuration, { capture: () => evidence }).capture(raw, p.requestFingerprint);
        if (!receipt) return held("recovery_required", "executor_evidence_denied");
        const settled = await store.recordDefinitiveOutcomeAndSettle(raw, p.requestFingerprint, receipt);
        if (settled.verdict !== "allow" || !settled.normalizedResult || !settled.resultFingerprint || !["settled", "idempotent"].includes(settled.status)) return held("recovery_required", "executor_settlement_unavailable");
        return decision(settled.status as "settled" | "idempotent", null, settled.normalizedResult, settled.resultFingerprint);
      } catch { return held("unavailable", "executor_retrieval_unavailable"); }
    },
  });
}
