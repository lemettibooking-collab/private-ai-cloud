import { types } from "node:util";
import type { NormalizedExecutorInvocation } from "../contracts/executor-adapter";
import type { ExecutorTarget } from "./executor-start-boundary";
import type { ExecutorProviderId } from "./executor-provider-identity";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { deriveExecutorProviderCorrelation, isExecutorProviderId } from "./executor-provider-identity.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeExecutorTarget } from "./executor-start-boundary.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, ensureSafeEvidence, freezeDeep, sha256 } from "../local-handoff/local-handoff-policy.ts";

/** Internal configuration handle, NOT execution/start authority or a public plugin. */
export type ExecutorProviderRequestPolicy = Readonly<{ providerId: ExecutorProviderId }>;
export type PreparedExecutorProviderRequest = Readonly<{
  providerId: ExecutorProviderId; target: ExecutorTarget; baseBody: string; body: string;
  baseRequestFingerprint: string; correlationFingerprint: string; requestFingerprint: string;
  providerBudgetDefenseEvidence: Readonly<{ limitCents: number; enforcement: "provider_defense_only"; inFlightOverrunPossible: boolean }>;
}>;
type Preparation = (invocation: NormalizedExecutorInvocation, context: unknown, target: ExecutorTarget,
  maximumExposureUsdMicros: number, workspaceIdentity: string) => unknown;
const policies = new WeakMap<object, { providerId: ExecutorProviderId; prepare: Preparation }>();

/** TRUSTED IMPLEMENTATION/COMPOSITION ONLY. No caller registration surface or global registry.
 * Only the audited OpenAI implementation is wired in production. Code able to call this
 * definition helper is trusted server code, not an untrusted provider/plugin. Purity and
 * wire semantics require source review; a JS callback's honesty cannot be proven by types.
 * Handles merely configure bounded preparation: they cannot grant DB/start authority. */
export function defineTrustedExecutorProviderRequestPolicy(providerId: ExecutorProviderId, prepare: Preparation): ExecutorProviderRequestPolicy {
  if (!isExecutorProviderId(providerId) || typeof prepare !== "function" || types.isProxy(prepare)) throw Error("invalid_executor_request_policy");
  const policy = Object.freeze({ providerId });
  policies.set(policy, { providerId, prepare }); return policy;
}
export function executorRequestPolicyMatches(policy: unknown, providerId: unknown): policy is ExecutorProviderRequestPolicy {
  const p = policy && typeof policy === "object" ? policies.get(policy) : null;
  return !!p && isExecutorProviderId(providerId) && p.providerId === providerId;
}

/** Snapshot before invoking trusted pure code; independently recheck every generic binding.
 * No provider JSON interpretation, URLs, SDK, credentials, IO, retries or authority here. */
export function prepareExecutorProviderRequest(policy: unknown, invocationInput: NormalizedExecutorInvocation, contextInput: unknown,
  targetInput: ExecutorTarget, maximumExposureUsdMicros: number, workspaceIdentity: string): PreparedExecutorProviderRequest | null {
  try {
    const target = normalizeExecutorTarget(targetInput);
    if (!executorRequestPolicyMatches(policy, target.providerId)) return null;
    if (!Number.isSafeInteger(maximumExposureUsdMicros) || maximumExposureUsdMicros < 10000 || maximumExposureUsdMicros > 1000000000) return null;
    const invocation = freezeDeep(boundedData(invocationInput)) as NormalizedExecutorInvocation, context = freezeDeep(boundedData(contextInput));
    const p = policies.get(policy)!;
    const result = exactRecord(boundedData(Reflect.apply(p.prepare, undefined, [invocation, context, target, maximumExposureUsdMicros, workspaceIdentity])),
      ["providerId", "target", "baseBody", "body", "baseRequestFingerprint", "correlationFingerprint", "requestFingerprint", "providerBudgetDefenseEvidence"]);
    const t = normalizeExecutorTarget(result.target);
    if (result.providerId !== target.providerId || t.providerId !== target.providerId || t.modelId !== target.modelId || t.accountId !== target.accountId) return null;
    if (typeof result.body !== "string" || typeof result.baseBody !== "string" || !result.body.length || !result.baseBody.length
      || Buffer.byteLength(result.body) > 65536 || Buffer.byteLength(result.baseBody) > 65536) return null;
    ensureSafeEvidence(result.body); ensureSafeEvidence(result.baseBody);
    if (result.baseRequestFingerprint !== sha256(result.baseBody) || result.requestFingerprint !== sha256(result.body)) return null;
    const correlation = deriveExecutorProviderCorrelation({ workspaceIdentity, developmentRunId: invocation.attempt.developmentRunId,
      attemptNumber: invocation.attempt.number, requestFingerprint: result.baseRequestFingerprint, ...target, executorIdentity: invocation.identity });
    if (!correlation || result.correlationFingerprint !== correlation) return null;
    const evidence = exactRecord(result.providerBudgetDefenseEvidence, ["limitCents", "enforcement", "inFlightOverrunPossible"]);
    // Compatibility allocation for the existing durable schema, not a universal provider hard cap.
    // A new provider's financial/rounding guarantees need a separately reviewed prerequisite.
    if (evidence.limitCents !== Math.floor(maximumExposureUsdMicros / 10000) || evidence.enforcement !== "provider_defense_only"
      || typeof evidence.inFlightOverrunPossible !== "boolean") return null;
    return freezeDeep({ providerId: p.providerId, target, baseBody: result.baseBody, body: result.body,
      baseRequestFingerprint: result.baseRequestFingerprint as string, correlationFingerprint: correlation, requestFingerprint: result.requestFingerprint as string,
      providerBudgetDefenseEvidence: { limitCents: evidence.limitCents as number, enforcement: "provider_defense_only", inFlightOverrunPossible: evidence.inFlightOverrunPossible } });
  } catch { return null; }
}
