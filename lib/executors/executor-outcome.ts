import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { NormalizedExecutorInvocation, NormalizedExecutorResult } from "../contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, freezeDeep } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { capturedMethod, exactOwnData } from "../db/executor-start-transaction.ts";

export const executorOutcomeJsonLimit = 2 * 1024 * 1024;
export type ExecutorTerminality = "definitive_terminal" | "rejected_before_execution" | "not_transmitted" | "ambiguous";
export type ExecutorOutcomeEvidence = Readonly<{
  terminality: ExecutorTerminality; normalizedResult: NormalizedExecutorResult | null;
  usage: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }> | null;
  providerConsumedCents: number | null;
}>;
export type ExecutorOutcomeReceipt = Readonly<{ kind: "executor_outcome_evidence" }>;
type Captured = ExecutorOutcomeEvidence & { invocationFingerprint: string; requestFingerprint: string; resultFingerprint: string | null };
const receipts = new WeakMap<object, Captured>();
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const fingerprint = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1000000000;
const rawFields = (r: Record<string, unknown>) => ({ schemaVersion: r.schemaVersion, identity: r.identity, invocationId: r.invocationId,
  status: r.status, failureCode: r.failureCode, changes: r.changes, report: r.report });
const derivedFields = (r: Record<string, unknown>) => ({ repository: r.repository, planId: r.planId, taskId: r.taskId, attempt: r.attempt,
  ownerDecisionRequired: r.ownerDecisionRequired, verificationStatus: r.verificationStatus, automaticRetryAllowed: r.automaticRetryAllowed });
const invocationInput = (i: NormalizedExecutorInvocation) => ({ schemaVersion: i.schemaVersion, invocationId: i.invocationId, identity: i.identity,
  planId: i.planId, taskId: i.taskId, repository: i.repository, capability: i.capability, mode: i.mode, attempt: i.attempt });

/** Rebuild validation provenance, then compare EVERY stored field, including derived bindings.
 * Neither a persisted row nor an old process-local receipt is authority after restart. */
export function revalidateExecutorOutcome(configuration: unknown, rawInvocation: unknown, payload: unknown) {
  try {
    const adapter = createExecutorAdapterContract(configuration).adapter;
    const invocation = adapter?.validateInvocation(rawInvocation).normalizedInvocation;
    if (!adapter || !invocation) return null;
    const r = exactOwnData(payload, ["schemaVersion", "identity", "invocationId", "status", "failureCode", "changes", "report",
      "repository", "planId", "taskId", "attempt", "ownerDecisionRequired", "verificationStatus", "automaticRetryAllowed"]);
    if (!r) return null;
    // The original 256 KiB contract bounds RAW result strings. Derived, separately bounded
    // bindings must not steal that capacity when validating the normalized envelope.
    const raw = boundedData(rawFields(r)), derived = boundedData(derivedFields(r));
    const evaluated = adapter.evaluateResult(invocation, raw);
    const result = evaluated.normalizedResult;
    if (!result || !isDeepStrictEqual(raw, boundedData(rawFields(result))) || !isDeepStrictEqual(derived, boundedData(derivedFields(result)))) return null;
    // Adapter fixes field ordering and sorts changes with its deterministic comparator.
    const canonicalJson = JSON.stringify(result);
    if (Buffer.byteLength(canonicalJson, "utf8") > executorOutcomeJsonLimit) return null;
    return freezeDeep({ normalizedResult: result, canonicalJson, resultFingerprint: hash(canonicalJson) });
  } catch { return null; }
}

/** INTERNAL trusted producer port. Configuration, not a caller API: transport/reconciler owns
 * capture(). No route, action, UI or production composition exposes an issuer. Slow capture work
 * finishes BEFORE the store transaction. This is not protection against trusted-server compromise. */
export function createExecutorOutcomeCapture(configuration: unknown, trustedProducer: unknown) {
  configuration = freezeDeep(boundedData(configuration));
  const capture = capturedMethod(trustedProducer, "capture");
  const adapter = createExecutorAdapterContract(configuration).adapter;
  if (!capture || !adapter) throw Error("invalid_executor_outcome_source");
  return Object.freeze({ async capture(rawInvocation: unknown, requestFingerprint: unknown): Promise<ExecutorOutcomeReceipt | null> {
    try {
      const invocation = adapter.validateInvocation(rawInvocation).normalizedInvocation;
      if (!invocation || !fingerprint(requestFingerprint)) return null;
      const e = exactOwnData(await Reflect.apply(capture, undefined, [invocation, requestFingerprint]),
        ["terminality", "normalizedResult", "usage", "providerConsumedCents"]);
      if (!e || !["definitive_terminal", "rejected_before_execution", "not_transmitted", "ambiguous"].includes(e.terminality as string)) return null;
      const validated = e.normalizedResult === null ? null : revalidateExecutorOutcome(configuration, invocationInput(invocation), e.normalizedResult);
      if (e.normalizedResult !== null && !validated) return null;
      const result = validated?.normalizedResult ?? null;
      if (e.terminality !== "ambiguous" && (!result || result.status === "outcome_unknown"
        || (e.terminality === "rejected_before_execution" && result.status !== "rejected")
        || (e.terminality === "not_transmitted" && result.status !== "failed"))) return null;
      let usage: Captured["usage"] = null;
      if (e.usage !== null) {
        const u = exactRecord(boundedData(e.usage), ["inputTokens", "outputTokens", "totalTokens"]);
        if (!integer(u.inputTokens) || !integer(u.outputTokens) || !integer(u.totalTokens) || u.totalTokens !== u.inputTokens + u.outputTokens) return null;
        usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens };
      }
      if (e.providerConsumedCents !== null && !integer(e.providerConsumedCents)) return null;
      const receipt: ExecutorOutcomeReceipt = Object.freeze({ kind: "executor_outcome_evidence" });
      receipts.set(receipt, freezeDeep({ terminality: e.terminality as ExecutorTerminality, normalizedResult: result, usage,
        providerConsumedCents: e.providerConsumedCents as number | null, invocationFingerprint: hash(JSON.stringify(invocation)), requestFingerprint,
        resultFingerprint: validated?.resultFingerprint ?? null }));
      return receipt;
    } catch { return null; }
  } });
}

/** Only genuine producer-issued evidence for this exact invocation/request can enter the store. */
export function readExecutorOutcomeEvidence(receipt: unknown, invocation: NormalizedExecutorInvocation, requestFingerprint: string): Captured | null {
  const e = receipt && typeof receipt === "object" ? receipts.get(receipt) : null;
  return e && e.invocationFingerprint === hash(JSON.stringify(invocation)) && e.requestFingerprint === requestFingerprint ? e : null;
}

/** Adapter for an INTERNAL trusted observation port, never a caller-submitted decision.
 * Existing failed-shaped transport outputs remain conservative. A future reconciler can
 * separately establish definitive failure through createExecutorOutcomeCapture(). */
export function createExecutorTransportOutcomeCapture(configuration: unknown, trustedObserver: unknown) {
  const observe = capturedMethod(trustedObserver, "observe");
  if (!observe) throw Error("invalid_executor_outcome_source");
  return createExecutorOutcomeCapture(configuration, { async capture(i: NormalizedExecutorInvocation, requestFingerprint: string) {
    const d = exactOwnData(await Reflect.apply(observe, undefined, [i, requestFingerprint]), ["verdict", "reason", "normalizedResult", "reconciliation"]);
    if (!d || !["allow", "deny"].includes(d.verdict as string)) throw Error("invalid_executor_outcome_source");
    const r = boundedData(d.reconciliation) as Record<string, unknown> | null;
    if (r && (r.invocationId !== i.invocationId || r.requestFingerprint !== requestFingerprint
      || !isDeepStrictEqual(r.attempt, boundedData(i.attempt)) || !isDeepStrictEqual(r.repository, boundedData(i.repository))
      || !isDeepStrictEqual(r.identity, boundedData(i.identity)) || r.planId !== i.planId || r.taskId !== i.taskId)) throw Error("invalid_executor_outcome_binding");
    const validated = d.normalizedResult === null ? null : revalidateExecutorOutcome(configuration, invocationInput(i), d.normalizedResult);
    if (d.normalizedResult !== null && !validated) throw Error("invalid_executor_outcome_source");
    const result = validated?.normalizedResult ?? null;
    let terminality: ExecutorTerminality = "ambiguous";
    if (d.verdict === "allow" && d.reason === null && result && r?.state === "started"
      && ["usage_unknown", "partially_observed"].includes(r.reconciliation as string)) {
      if (result.status === "succeeded") terminality = "definitive_terminal";
      if (result.status === "rejected") terminality = "rejected_before_execution";
    }
    return { terminality, normalizedResult: result, usage: r?.observedUsage ?? null, providerConsumedCents: null };
  } });
}
