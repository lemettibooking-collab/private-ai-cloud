import { isDeepStrictEqual } from "node:util";
import type { NormalizedExecutorResult, NormalizedExecutorInvocation } from "../contracts/executor-adapter";
import type { createPostgresExecutorStartStore } from "../db/executor-start-store";
import type { DurableExecutorSnapshot } from "../db/executor-start-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { prepareExecutorProviderRequest } from "./executor-provider-request.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createClaudeManagedRequestPolicy, normalizeClaudeProfile, claudeInvalid } from "./claude-managed-request.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { openClaudeFakeStart, openClaudeFakeRead } from "./claude-managed-fake-provider.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateClaudeSession, claudeTerminalProposal } from "./claude-managed-protocol.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, freezeDeep } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { capturedMethod, exactOwnData } from "../db/executor-start-transaction.ts";

type Store = ReturnType<typeof createPostgresExecutorStartStore>;
export type ClaudeFakeDecision = Readonly<{ verdict: "allow" | "deny"; status: "terminal_candidate" | "recovery_required";
  reason: string | null; normalizedResult: NormalizedExecutorResult | null; startCapability: null; providerCapability: null;
  automaticRetryAllowed: false; providerMutationAllowed: false }>;
function decision(result: NormalizedExecutorResult | null = null): ClaudeFakeDecision {
  return freezeDeep({ verdict: result ? "allow" : "deny", status: result ? "terminal_candidate" : "recovery_required",
    reason: result ? null : "claude_fake_evidence_unavailable", normalizedResult: result, startCapability: null, providerCapability: null,
    automaticRetryAllowed: false, providerMutationAllowed: false });
}
const keys = ["configuration", "profile", "context", "workspaceIdentity", "store", "readClient"] as const;
/** Trusted internal test composition only. No production root imports this module. */
function bind(input: unknown, starting: boolean) {
  if (typeof window !== "undefined") claudeInvalid();
  const c = exactOwnData(input, starting ? [...keys, "startClient"] : keys); if (!c) claudeInvalid();
  const configuration = freezeDeep(boundedData(c.configuration)), profile = normalizeClaudeProfile(c.profile), context = freezeDeep(boundedData(c.context));
  const adapter = createExecutorAdapterContract(configuration).adapter, requestPolicy = createClaudeManagedRequestPolicy(profile);
  if (!adapter) claudeInvalid();
  const client = openClaudeFakeRead(c.readClient), start = starting ? openClaudeFakeStart(c.startClient) : null;
  if (!client || (starting && !start)) claudeInvalid();
  const methods = starting ? ["inspect", "prepareProviderCorrelation", "createProviderIdentityObserver", "markProviderIdentityUnknown"]
    : ["inspectProviderIdentity", "markProviderIdentityUnknown"];
  const ports = Object.fromEntries(methods.map(k => [k, capturedMethod(c.store, k)]));
  if (methods.some(k => !ports[k])) claudeInvalid();
  const store = Object.fromEntries(methods.map(k => [k, (...args: unknown[]) => Reflect.apply(ports[k]!, undefined, args)])) as unknown as Pick<Store,
    "inspect" | "inspectProviderIdentity" | "prepareProviderCorrelation" | "createProviderIdentityObserver" | "markProviderIdentityUnknown">;
  const request = (i: NormalizedExecutorInvocation, e: DurableExecutorSnapshot) => {
    const target = { providerId: "anthropic", modelId: profile.modelId, accountId: profile.accountId };
    if (!isDeepStrictEqual(e.target, target) || !isDeepStrictEqual(e.attempt, i.attempt) || !isDeepStrictEqual(e.identity, i.identity)
      || !isDeepStrictEqual(e.repository, i.repository) || e.invocationId !== i.invocationId || e.planId !== i.planId || e.taskId !== i.taskId
      || e.mode !== i.mode || e.capability !== i.capability || e.startedAt === null || !["start_committed", "reconciliation_required", "settled"].includes(e.state)) claudeInvalid();
    const r = prepareExecutorProviderRequest(requestPolicy, i, context, target, e.maximumExposureUsdMicros, c.workspaceIdentity as string);
    if (!r || r.requestFingerprint !== e.requestFingerprint) claudeInvalid(); return r;
  };
  const proposal = async (session: Record<string, unknown>, r: NonNullable<ReturnType<typeof prepareExecutorProviderRequest>>, i: NormalizedExecutorInvocation) => {
    const candidate = await claudeTerminalProposal(session, r, i, client.listEvents);
    const result = adapter.evaluateResult(i, candidate).normalizedResult; if (!result) claudeInvalid(); return result;
  };
  return { adapter, store, client, start, request, proposal, context };
}
/** One acknowledged durable start authorizes exactly one simulated Create+initial-message.
 * No production transport, callback injection, credentials, Send, Resume or retry surface. */
export function createClaudeManagedAgentsFakeExecutor(input: unknown) {
  const b = bind(input, true);
  return Object.freeze({ realDispatch: "blocked" as const,
    async execute(rawInput: unknown, startCapability: unknown): Promise<ClaudeFakeDecision> {
      let raw: unknown, transmitted = false;
      try {
        raw = freezeDeep(boundedData(rawInput)); const i = b.adapter.validateInvocation(raw).normalizedInvocation; if (!i) claudeInvalid();
        const e = await b.store.inspect(raw); if (e.verdict !== "allow" || e.snapshot?.state !== "start_committed") claudeInvalid(); const r = b.request(i, e.snapshot);
        const c = await b.store.prepareProviderCorrelation(raw, b.context, startCapability), p = c.providerIdentity;
        if (!c.providerCapability || !p || p.requestFingerprint !== r.requestFingerprint || p.correlationFingerprint !== r.correlationFingerprint) claudeInvalid();
        const observer = b.store.createProviderIdentityObserver(raw, c.providerCapability);
        if (!await observer.beforeTransmission(r.requestFingerprint)) claudeInvalid();
        transmitted = true;
        const session = validateClaudeSession(await b.start!.createSession(r.body), r, null);
        if (!await observer.observe({ sessionId: session.id as string, turnId: null })) claudeInvalid();
        return decision(await b.proposal(session, r, i));
      } catch {
        if (transmitted) { try { await b.store.markProviderIdentityUnknown(raw); } catch { /* full hold */ } }
        return decision();
      }
    },
  });
}
/** Known-ID reads only. No start port/issuer, mutation client, discovery or finance receipt. */
export function createClaudeManagedAgentsFakeInspector(input: unknown) {
  const b = bind(input, false);
  return Object.freeze({ realDispatch: "blocked" as const, realRetrieval: "blocked" as const,
    async inspect(rawInput: unknown): Promise<ClaudeFakeDecision> {
      let raw: unknown, observed = false;
      try {
        raw = freezeDeep(boundedData(rawInput)); const i = b.adapter.validateInvocation(raw).normalizedInvocation; if (!i) claudeInvalid();
        const d = await b.store.inspectProviderIdentity(raw), p = d.providerIdentity;
        if (d.verdict !== "allow" || !d.snapshot || !p || p.sessionId === null || p.turnId !== null || p.identityState !== "session_observed") claudeInvalid();
        observed = true; const r = b.request(i, d.snapshot);
        if (p.requestFingerprint !== r.requestFingerprint || p.baseRequestFingerprint !== r.baseRequestFingerprint || p.correlationFingerprint !== r.correlationFingerprint
          || !isDeepStrictEqual(p.target, r.target) || !isDeepStrictEqual(p.executorIdentity, i.identity) || !isDeepStrictEqual(p.attempt, i.attempt)) claudeInvalid();
        const session = validateClaudeSession(await b.client.retrieveSession(p.sessionId), r, p.sessionId);
        return decision(await b.proposal(session, r, i));
      } catch {
        if (observed) { try { await b.store.markProviderIdentityUnknown(raw); } catch { /* retain full hold */ } }
        return decision();
      }
    },
  });
}
