// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeAI044ProofBinding, ai044Fingerprint, ai044Hash, ai044Id, ai044Integer, captureAI044Data, exactAI044Record, freezeAI044 } from "./ai044-proof-binding.ts";

export const ai044FinancialCategories = Object.freeze(["model_usage", "hosted_container", "tools", "file_storage", "other_billable"] as const);
export type AI044FinancialCategory = typeof ai044FinancialCategories[number];
export type AI044FinancialClaim = Readonly<{
  category: AI044FinancialCategory;
  kind: "unknown" | "unbounded" | "estimate" | "rate_only" | "account_hard_limit" | "provider_assertion";
  maximumUsdMicros: number | null;
}>;
export type AI044ReadinessReason = Readonly<{ code: string; path: string }>;
export type AI044BlockedReadiness = Readonly<{
  verdict: "deny"; reasons: readonly AI044ReadinessReason[]; startCapability: null; normalizedResult: null;
  totalMaximumExposureUsdMicros: null; hostedContainerMaximumUsdMicros: null;
  runtimeDispatchAllowed: false; dispatchAuthorized: false;
}>;
const deny = (reasons: readonly AI044ReadinessReason[]): AI044BlockedReadiness => freezeAI044({ verdict: "deny", reasons: [...reasons],
  startCapability: null, normalizedResult: null, totalMaximumExposureUsdMicros: null, hostedContainerMaximumUsdMicros: null,
  runtimeDispatchAllowed: false, dispatchAuthorized: false });
const reason = (code: string, path: string): AI044ReadinessReason => ({ code, path });

/** Configuration/evidence model ONLY. No approval queue write, consumption, credential lookup or start right. */
export function normalizeAI044OwnerApproval(raw: unknown, bindingFingerprint: string, profileFingerprint: string,
  financialFingerprint: string, now: number, evidenceRevision: number, consumedIds: readonly string[] = []) {
  try {
    if (!ai044Hash(bindingFingerprint) || !ai044Hash(profileFingerprint) || !ai044Hash(financialFingerprint)
      || !ai044Integer(now, Number.MAX_SAFE_INTEGER) || !ai044Integer(evidenceRevision)) return null;
    const consumed = captureAI044Data(consumedIds);
    if (!Array.isArray(consumed) || consumed.length > 64 || !consumed.every(ai044Id)) return null;
    const a = exactAI044Record(captureAI044Data(raw), ["id", "actorId", "decision", "purpose", "bindingFingerprint", "profileFingerprint",
      "financialFingerprint", "evidenceRevision", "issuedAt", "expiresAt", "oneShot"]);
    if (!ai044Id(a.id) || !ai044Id(a.actorId) || a.decision !== "approve" || a.purpose !== "ai044_one_attempt_live_proof" || a.oneShot !== true
      || a.bindingFingerprint !== bindingFingerprint || a.profileFingerprint !== profileFingerprint || a.financialFingerprint !== financialFingerprint
      || a.evidenceRevision !== evidenceRevision || consumed.includes(a.id) || !ai044Integer(a.issuedAt, Number.MAX_SAFE_INTEGER)
      || !ai044Integer(a.expiresAt, Number.MAX_SAFE_INTEGER) || a.issuedAt > now || a.expiresAt <= now
      || a.expiresAt - a.issuedAt > 300_000 || a.expiresAt <= a.issuedAt) return null;
    return freezeAI044({ ...a });
  } catch { return null; }
}

/**
 * Deny-only issuer. Caller-shaped numeric assertions are NOT vetted financial evidence.
 * Current policy has no approved finite enforceable hosted-container bound (nor an
 * all-category coverage guarantee). No input can enroll a new evidence source or
 * turn account hard limits, price rates, timeouts or Owner approval into that proof.
 */
export function evaluateAI044LiveReadiness(raw: unknown): AI044BlockedReadiness {
  try {
    const r = exactAI044Record(captureAI044Data(raw), ["binding", "profileFingerprint", "financial", "approval", "consumedApprovalIds", "now", "evidenceRevision"]);
    const binding = normalizeAI044ProofBinding(r.binding);
    if (!binding || !ai044Hash(r.profileFingerprint) || !ai044Integer(r.now, Number.MAX_SAFE_INTEGER) || !ai044Integer(r.evidenceRevision))
      return deny([reason("invalid_readiness_input", "readiness")]);
    const bindingFingerprint = ai044Fingerprint(binding);
    const f = exactAI044Record(r.financial, ["bindingFingerprint", "profileFingerprint", "evidenceRevision", "observedAt", "expiresAt", "categories"]);
    const reasons: AI044ReadinessReason[] = [];
    if (f.bindingFingerprint !== bindingFingerprint || f.profileFingerprint !== r.profileFingerprint || f.evidenceRevision !== r.evidenceRevision)
      reasons.push(reason("financial_identity_mismatch", "financial"));
    if (!ai044Integer(f.observedAt, Number.MAX_SAFE_INTEGER) || !ai044Integer(f.expiresAt, Number.MAX_SAFE_INTEGER)
      || f.observedAt > r.now || f.expiresAt <= r.now || f.expiresAt <= f.observedAt || f.expiresAt - f.observedAt > 300_000)
      reasons.push(reason("stale_financial_evidence", "financial"));
    if (!Array.isArray(f.categories) || f.categories.length !== ai044FinancialCategories.length)
      return deny([...reasons, reason("invalid_financial_categories", "financial.categories")]);
    const claims = new Map<AI044FinancialCategory, AI044FinancialClaim>();
    for (let index = 0; index < f.categories.length; index++) {
      const c = exactAI044Record(f.categories[index], ["category", "kind", "maximumUsdMicros"]);
      if (!ai044FinancialCategories.includes(c.category as AI044FinancialCategory) || claims.has(c.category as AI044FinancialCategory)
        || !["unknown", "unbounded", "estimate", "rate_only", "account_hard_limit", "provider_assertion"].includes(c.kind as string)
        || (c.maximumUsdMicros !== null && !ai044Integer(c.maximumUsdMicros))
        || (["unknown", "unbounded"].includes(c.kind as string) && c.maximumUsdMicros !== null))
        return deny([...reasons, reason("invalid_financial_categories", `financial.categories[${index}]`)]);
      claims.set(c.category as AI044FinancialCategory, c as unknown as AI044FinancialClaim);
    }
    // Iterate the closed policy order, never caller insertion order. No unknown category is ignored.
    for (const category of ai044FinancialCategories) {
      const c = claims.get(category);
      if (!c) return deny([...reasons, reason("invalid_financial_categories", "financial.categories")]);
      if (c.kind === "account_hard_limit") reasons.push(reason("account_limit_not_run_bound", `financial.${category}`));
      // Null means unknown, NEVER zero. Numeric provider assertions are unvetted too.
      reasons.push(reason("financial_bound_unproven", `financial.${category}`));
    }
    const approval = normalizeAI044OwnerApproval(r.approval, bindingFingerprint, r.profileFingerprint, ai044Fingerprint(f), r.now,
      r.evidenceRevision, r.consumedApprovalIds as readonly string[]);
    if (!approval) reasons.push(reason("owner_approval_invalid", "approval"));
    return deny(reasons);
  } catch { return deny([reason("invalid_readiness_input", "readiness")]); }
}

/** No credential/transport ports, env switches, SDK imports or mutable dispatch capability. */
export function createAI044BlockedProofComposition() {
  return freezeAI044({ runtimeDispatchAllowed: false as const, dispatchAuthorized: false as const,
    startProof: (input: unknown): AI044BlockedReadiness => evaluateAI044LiveReadiness(input) });
}
