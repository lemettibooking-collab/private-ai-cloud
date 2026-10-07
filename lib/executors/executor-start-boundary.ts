import type { ExecutorIdentity, ExecutorRepositoryRef, NormalizedExecutorInvocation } from "../contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, ensureSafeEvidence, freezeDeep } from "../local-handoff/local-handoff-policy.ts";

export type ExecutorTarget = Readonly<{ providerId: string; modelId: string; accountId: string }>;
export type ExecutorDispatchPermit = Readonly<{ kind: "executor_dispatch_authority" }>;
export type ExecutorBudgetReservation = Readonly<{ kind: "executor_exposure_reservation" }>;
export type ExecutorStartTicket = Readonly<{ kind: "process_local_test_start" }>;
export type ExecutorExposureSnapshot = Readonly<{
  reservationId: string; identity: ExecutorIdentity; invocationId: string; taskId: string; planId: string;
  repository: ExecutorRepositoryRef; target: ExecutorTarget; requestFingerprint: string; expiresAt: number;
  state: "reserved" | "cancelled" | "started" | "reconciliation_required";
  maximumExposureUsdMicros: number; exposureHeldUsdMicros: number;
  reconciliation: "not_started" | "usage_unknown" | "partially_observed" | "reconciliation_required";
  observedUsage: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }> | null;
  observedCostUsdMicros: null;
}>;
type Binding = { invocation: NormalizedExecutorInvocation; target: ExecutorTarget; fingerprint: string };
type Permit = Binding & { expiresAt: number; used: boolean; revoked: boolean };
type Reservation = Binding & { id: string; expiresAt: number; amount: number; state: ExecutorExposureSnapshot["state"];
  reconciliation: ExecutorExposureSnapshot["reconciliation"]; usage: ExecutorExposureSnapshot["observedUsage"] };
type Ticket = Binding & { permit: Permit; reservation: Reservation; dispatched: boolean; now: () => number };
const tickets = new WeakMap<object, Ticket>();
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(v);
const integer = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
export function normalizeExecutorTarget(input: unknown): ExecutorTarget {
  const t = exactRecord(boundedData(input), ["providerId", "modelId", "accountId"]);
  if (!id(t.providerId) || !id(t.modelId) || !id(t.accountId)) throw Error("invalid_executor_target");
  ensureSafeEvidence(JSON.stringify(t));
  return freezeDeep({ providerId: t.providerId, modelId: t.modelId, accountId: t.accountId });
}
function sameTarget(a: ExecutorTarget, b: ExecutorTarget): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId && a.accountId === b.accountId;
}
function matches(binding: Binding, invocation: unknown, target: ExecutorTarget, fingerprint: string): boolean {
  return binding.invocation === invocation && sameTarget(binding.target, target) && binding.fingerprint === fingerprint;
}
function snapshot(r: Reservation): ExecutorExposureSnapshot {
  const i = r.invocation;
  return freezeDeep({ reservationId: r.id, identity: { ...i.identity }, invocationId: i.invocationId, taskId: i.taskId, planId: i.planId,
    repository: { ...i.repository }, target: { ...r.target }, requestFingerprint: r.fingerprint, expiresAt: r.expiresAt,
    state: r.state, maximumExposureUsdMicros: r.amount, exposureHeldUsdMicros: r.state === "cancelled" ? 0 : r.amount,
    reconciliation: r.reconciliation, observedUsage: r.usage ? { ...r.usage } : null, observedCostUsdMicros: null });
}
function ticketValid(ticket: unknown, invocation: unknown, targetInput: unknown, fingerprint: string): Ticket | null {
  try {
    const t = ticket && typeof ticket === "object" ? tickets.get(ticket) : null;
    if (!t || t.dispatched || !matches(t, invocation, normalizeExecutorTarget(targetInput), fingerprint)) return null;
    const now = t.now();
    if (t.permit.revoked || now >= t.permit.expiresAt || now >= t.reservation.expiresAt || t.reservation.state !== "started") return null;
    return t;
  } catch { return null; }
}
/** Production cannot upgrade this process-local test proof with any caller flag. */
export function isExecutorTestStart(ticket: unknown, invocation: unknown, target: unknown, fingerprint: string): boolean {
  return ticketValid(ticket, invocation, target, fingerprint) !== null;
}
export function consumeExecutorStartTicket(ticket: unknown, invocation: unknown, target: unknown, fingerprint: string, mode: "production" | "test"): boolean {
  if (mode !== "test") return false;
  const t = ticketValid(ticket, invocation, target, fingerprint); if (!t) return false;
  t.dispatched = true; return true;
}
/** Accounting observation ONLY. Never releases post-start exposure, including explicit zero tokens. */
export function observeExecutorUsage(ticket: unknown, input: unknown, ambiguous: boolean): ExecutorExposureSnapshot | null {
  const t = ticket && typeof ticket === "object" ? tickets.get(ticket) : null;
  if (!t || !t.dispatched) return null;
  const r = t.reservation;
  try {
    if (input !== null) {
      const u = exactRecord(boundedData(input), ["inputTokens", "outputTokens", "totalTokens"]);
      if (!integer(u.inputTokens, 1000000000) || !integer(u.outputTokens, 1000000000) || !integer(u.totalTokens, 1000000000)
        || u.totalTokens !== u.inputTokens + u.outputTokens) throw Error("invalid_usage");
      const usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens };
      if (r.usage && (usage.inputTokens < r.usage.inputTokens || usage.outputTokens < r.usage.outputTokens)) throw Error("contradictory_usage");
      r.usage = usage;
      if (r.reconciliation !== "reconciliation_required") r.reconciliation = "partially_observed";
    } else if (!r.usage && r.reconciliation !== "reconciliation_required") r.reconciliation = "usage_unknown";
    if (ambiguous) { r.state = "reconciliation_required"; r.reconciliation = "reconciliation_required"; }
  } catch { r.state = "reconciliation_required"; r.reconciliation = "reconciliation_required"; }
  return snapshot(r);
}

/**
 * Trusted composition factory. Keep issuer methods out of caller-facing surfaces.
 * Distinct execution and financial provenance; no ModelInvocation/Workflow Run authority.
 * Atomicity is ONLY synchronous in one process/isolate. No durable/provider-side cap.
 */
export function createExecutorStartBoundary(configuration: unknown, policyInput: unknown, clock: () => number = Date.now) {
  const configured = createExecutorAdapterContract(configuration);
  if (!configured.adapter) throw Error("invalid_executor_configuration");
  const contract = configured.adapter;
  const policy = exactRecord(boundedData(policyInput), ["maximumExposureUsdMicros", "totalExposureUsdMicros", "permitTtlMs", "reservationTtlMs", "maxEntries"]);
  for (const field of ["maximumExposureUsdMicros", "totalExposureUsdMicros"])
    if (!integer(policy[field], 1000000000) || policy[field] === 0) throw Error("invalid_executor_financial_policy");
  if (!integer(policy.permitTtlMs, 60000) || policy.permitTtlMs === 0 || !integer(policy.reservationTtlMs, 60000) || policy.reservationTtlMs === 0
    || !integer(policy.maxEntries, 1024) || policy.maxEntries === 0) throw Error("invalid_executor_financial_policy");
  const maximum = policy.maximumExposureUsdMicros as number, total = policy.totalExposureUsdMicros as number;
  const permitTtl = policy.permitTtlMs as number, reservationTtl = policy.reservationTtlMs as number, maxEntries = policy.maxEntries as number;
  let held = 0, permitCount = 0, lastNow = -1, clockFailed = false;
  const now = (): number => {
    try {
      const value = clock();
      if (clockFailed || !integer(value, Number.MAX_SAFE_INTEGER - 60000) || value < lastNow) throw Error("invalid_clock");
      lastNow = value; return value;
    } catch { clockFailed = true; throw Error("invalid_executor_clock"); }
  };
  const receipts = new WeakSet<object>(), permits = new WeakMap<object, Permit>(), reservations = new WeakMap<object, Reservation>();
  const reservationIds = new Set<string>(), startedInvocations = new Set<string>(), startedTuples = new Set<string>();
  const tuple = (i: NormalizedExecutorInvocation) => JSON.stringify([i.identity.id, i.identity.version, i.repository.id, i.repository.baseline, i.planId, i.taskId, i.capability, i.mode]);
  const binding = (invocation: unknown, targetInput: unknown, fingerprint: unknown): Binding => {
    if (!invocation || typeof invocation !== "object" || !receipts.has(invocation)
      || typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(fingerprint)) throw Error("invalid_executor_binding");
    return { invocation: invocation as NormalizedExecutorInvocation, target: normalizeExecutorTarget(targetInput), fingerprint };
  };
  const validateInvocation = (input: unknown) => {
    const d = contract.validateInvocation(input); if (d.normalizedInvocation) receipts.add(d.normalizedInvocation); return d;
  };
  const dispatchAuthority = {
    issue(invocation: unknown, target: unknown, fingerprint: unknown): Readonly<{ verdict: "allow" | "deny"; permit: ExecutorDispatchPermit | null }> {
      try {
        const b = binding(invocation, target, fingerprint), time = now();
        if (permitCount >= maxEntries || startedInvocations.has(b.invocation.invocationId) || startedTuples.has(tuple(b.invocation))) throw Error("authority_limit");
        const permit: ExecutorDispatchPermit = Object.freeze({ kind: "executor_dispatch_authority" });
        permits.set(permit, { ...b, expiresAt: time + permitTtl, used: false, revoked: false }); permitCount++;
        return freezeDeep({ verdict: "allow", permit });
      } catch { return freezeDeep({ verdict: "deny", permit: null }); }
    },
    revoke(input: unknown): boolean {
      const p = input && typeof input === "object" ? permits.get(input) : null;
      if (!p) return false; p.revoked = true; return true;
    },
  };
  const budgetAuthority = {
    reserve(invocation: unknown, target: unknown, fingerprint: unknown, input: unknown): Readonly<{ verdict: "allow" | "deny"; reservation: ExecutorBudgetReservation | null }> {
      try {
        const b = binding(invocation, target, fingerprint), time = now();
        const r = exactRecord(boundedData(input), ["reservationId", "maximumExposureUsdMicros"]);
        if (!id(r.reservationId) || !integer(r.maximumExposureUsdMicros, maximum) || r.maximumExposureUsdMicros === 0
          || held + r.maximumExposureUsdMicros > total || reservationIds.size >= maxEntries || reservationIds.has(r.reservationId)
          || startedInvocations.has(b.invocation.invocationId) || startedTuples.has(tuple(b.invocation))) throw Error("budget_denied");
        ensureSafeEvidence(r.reservationId);
        const reservation: ExecutorBudgetReservation = Object.freeze({ kind: "executor_exposure_reservation" });
        reservations.set(reservation, { ...b, id: r.reservationId, expiresAt: time + reservationTtl, amount: r.maximumExposureUsdMicros,
          state: "reserved", reconciliation: "not_started", usage: null });
        reservationIds.add(r.reservationId); held += r.maximumExposureUsdMicros;
        return freezeDeep({ verdict: "allow", reservation });
      } catch { return freezeDeep({ verdict: "deny", reservation: null }); }
    },
    cancel(input: unknown): boolean {
      const r = input && typeof input === "object" ? reservations.get(input) : null;
      if (!r || r.state !== "reserved") return false;
      r.state = "cancelled"; held -= r.amount; return true;
    },
    inspect(input: unknown): ExecutorExposureSnapshot | null {
      const r = input && typeof input === "object" ? reservations.get(input) : null; return r ? snapshot(r) : null;
    },
  };
  const providerStartFence = {
    start(invocation: unknown, targetInput: unknown, fingerprint: string, permitInput: unknown, reservationInput: unknown): Readonly<{
      verdict: "allow" | "blocked"; reason: string | null; ticket: ExecutorStartTicket | null;
    }> {
      try {
        const b = binding(invocation, targetInput, fingerprint), time = now();
        const p = permitInput && typeof permitInput === "object" ? permits.get(permitInput) : null;
        const r = reservationInput && typeof reservationInput === "object" ? reservations.get(reservationInput) : null;
        if (!p || !matches(p, invocation, b.target, fingerprint) || p.used || p.revoked || time >= p.expiresAt) throw Error("authority_denied");
        if (!r || !matches(r, invocation, b.target, fingerprint) || r.state !== "reserved" || time >= r.expiresAt
          || r.amount > maximum || held > total || startedInvocations.has(b.invocation.invocationId) || startedTuples.has(tuple(b.invocation))) throw Error("reservation_denied");
        // No await/callback between the final checks and BOTH consumptions.
        p.used = true; r.state = "started"; r.reconciliation = "usage_unknown"; startedInvocations.add(b.invocation.invocationId); startedTuples.add(tuple(b.invocation));
        const ticket: ExecutorStartTicket = Object.freeze({ kind: "process_local_test_start" });
        tickets.set(ticket, { ...b, permit: p, reservation: r, dispatched: false, now });
        return freezeDeep({ verdict: "allow", reason: null, ticket });
      } catch { return freezeDeep({ verdict: "blocked", reason: "executor_start_blocked", ticket: null }); }
    },
  };
  const isValidatedInvocation = (input: unknown): input is NormalizedExecutorInvocation => Boolean(input && typeof input === "object" && receipts.has(input));
  return Object.freeze({ contract, validateInvocation, isValidatedInvocation, dispatchAuthority: Object.freeze(dispatchAuthority), budgetAuthority: Object.freeze(budgetAuthority),
    providerStartFence: Object.freeze(providerStartFence), realDispatch: "blocked" as const });
}
