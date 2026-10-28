import { isProxy } from "node:util/types";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { modelInvocationLimits } from "./model-invocation.ts";

// AI-037.6a: composition-time rule that a provider generation can never outlive the workflow
// claim that authorized it.
//
//   providerTimeoutMs + providerExecutionLeaseSafetyMarginMs <= claimLeaseDurationMs
//
// The static rule is necessary but not sufficient: the claim lease is written once when the
// claim is acquired and is not renewed, while a remote preflight can consume part of it. The
// provider-start fence (PostgresWorkflowRuntimeStateStore.startExecution with providerStart)
// therefore also requires, atomically before generation, that the REMAINING lease is at least
// providerTimeoutMs + safetyMarginMs. Both checks use the one trusted timing object produced here:
// it builds the provider client and is bound to the store (`providerExecutionTiming`). The rule is
// enforced before the provider factory runs; unsafe timing is rejected and never clamped.

export const providerExecutionLeaseSafetyMarginMs = 10_000;

export const providerClaimLeasePolicyLimits = Object.freeze({
  minDurationMs: 1,
  maxDurationMs: modelInvocationLimits.maxLatencyMs as number,
});

export type ProviderClaimLeaseTiming = Readonly<{
  providerTimeoutMs: number;
  claimLeaseDurationMs: number;
  safetyMarginMs: number;
}>;

export type ProviderClaimLeaseReasonCode =
  | "invalid_timing_input"
  | "invalid_provider_timeout"
  | "invalid_claim_lease"
  | "provider_timeout_exceeds_claim_lease"
  | "provider_factory_failed";

export type ProviderClaimLeaseReason = Readonly<{
  code: ProviderClaimLeaseReasonCode;
  path: string;
  message: string;
}>;

export type ProviderClaimLeaseDecision =
  | Readonly<{ verdict: "allow"; reasons: readonly []; timing: ProviderClaimLeaseTiming }>
  | Readonly<{ verdict: "deny"; reasons: readonly ProviderClaimLeaseReason[]; timing: null }>;

export type ProviderClaimLeaseComposition<Provider> =
  | Readonly<{ verdict: "allow"; reasons: readonly []; timing: ProviderClaimLeaseTiming; provider: Provider }>
  | Readonly<{ verdict: "deny"; reasons: readonly ProviderClaimLeaseReason[]; timing: null; provider: null }>;

const timingFields = Object.freeze(["providerTimeoutMs", "claimLeaseDurationMs"] as const);

// Timing objects produced by validateProviderClaimLeaseTiming. Only these are accepted where the
// timeout becomes authority (provider-start fence), so a caller cannot forge a smaller timeout or
// pair a provider with a timing it was not built from.
const trustedTimings = new WeakSet<object>();

export function isTrustedProviderClaimLeaseTiming(input: unknown): input is ProviderClaimLeaseTiming {
  return typeof input === "object" && input !== null && !isProxy(input) && trustedTimings.has(input);
}

function deny(code: ProviderClaimLeaseReasonCode, path: string, message: string): Readonly<{
  verdict: "deny"; reasons: readonly ProviderClaimLeaseReason[]; timing: null;
}> {
  return Object.freeze({
    verdict: "deny" as const,
    reasons: Object.freeze([Object.freeze({ code, path, message })]),
    timing: null,
  });
}

function boundedDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= providerClaimLeasePolicyLimits.minDurationMs
    && value <= providerClaimLeasePolicyLimits.maxDurationMs
    ? value
    : null;
}

// Reads exactly two own data properties from an ordinary object; anything else fails closed.
function captureTiming(input: unknown): Record<(typeof timingFields)[number], unknown> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || isProxy(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== timingFields.length || !timingFields.every((field) => keys.includes(field))) return null;
    const captured: Partial<Record<(typeof timingFields)[number], unknown>> = {};
    for (const field of timingFields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      captured[field] = descriptor.value;
    }
    return captured as Record<(typeof timingFields)[number], unknown>;
  } catch {
    return null;
  }
}

export function validateProviderClaimLeaseTiming(input: unknown): ProviderClaimLeaseDecision {
  const captured = captureTiming(input);
  if (!captured) {
    return deny("invalid_timing_input", "$", "Timing must be an ordinary object with exactly providerTimeoutMs and claimLeaseDurationMs.");
  }
  const providerTimeoutMs = boundedDuration(captured.providerTimeoutMs);
  if (providerTimeoutMs === null) {
    return deny("invalid_provider_timeout", "providerTimeoutMs", "Provider timeout must be a canonical bounded positive safe integer.");
  }
  const claimLeaseDurationMs = boundedDuration(captured.claimLeaseDurationMs);
  if (claimLeaseDurationMs === null) {
    return deny("invalid_claim_lease", "claimLeaseDurationMs", "Claim lease must be a canonical bounded positive safe integer.");
  }
  if (providerTimeoutMs + providerExecutionLeaseSafetyMarginMs > claimLeaseDurationMs) {
    return deny(
      "provider_timeout_exceeds_claim_lease",
      "providerTimeoutMs",
      "Provider timeout plus the safety margin exceeds the claim lease.",
    );
  }
  const timing: ProviderClaimLeaseTiming = Object.freeze({
    providerTimeoutMs,
    claimLeaseDurationMs,
    safetyMarginMs: providerExecutionLeaseSafetyMarginMs,
  });
  trustedTimings.add(timing);
  return Object.freeze({ verdict: "allow" as const, reasons: Object.freeze([]) as readonly [], timing });
}

// Trusted composition gate: the provider factory runs only for a safe timing, receives only the
// frozen validated snapshot (so later caller mutation cannot change it) and must build the
// provider with `timing.providerTimeoutMs`. Unsafe timing never constructs a provider or client.
// Pass the same trusted timing to the store (`providerExecutionTiming`) so the provider-start
// fence enforces the exact timeout the provider client was built with.
export function composeProviderWithinClaimLease<Provider>(
  timingInput: unknown,
  createProvider: (timing: ProviderClaimLeaseTiming) => Provider,
): ProviderClaimLeaseComposition<Provider> {
  const decision: ProviderClaimLeaseDecision = isTrustedProviderClaimLeaseTiming(timingInput)
    ? Object.freeze({ verdict: "allow" as const, reasons: Object.freeze([]) as readonly [], timing: timingInput })
    : validateProviderClaimLeaseTiming(timingInput);
  if (decision.verdict !== "allow") return Object.freeze({ ...decision, provider: null });
  if (typeof createProvider !== "function") {
    return Object.freeze({
      ...deny("provider_factory_failed", "createProvider", "Provider factory is invalid."),
      provider: null,
    });
  }
  try {
    const provider = createProvider(decision.timing);
    return Object.freeze({ verdict: "allow" as const, reasons: decision.reasons, timing: decision.timing, provider });
  } catch {
    return Object.freeze({
      ...deny("provider_factory_failed", "createProvider", "Provider factory failed closed."),
      provider: null,
    });
  }
}
