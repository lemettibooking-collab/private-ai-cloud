// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeAI044ProofBinding, ai044Fingerprint, ai044Hash, ai044Id, ai044Integer, ai044RequiredVerification, captureAI044Data, exactAI044Record, freezeAI044 } from "./ai044-proof-binding.ts";

/** A bounded handoff data contract, NOT a command runner or signed trusted receipt issuer. */
export function prepareAI044LocalReview(bindingInput: unknown, patchSha256: unknown, profileFingerprint: unknown) {
  const binding = normalizeAI044ProofBinding(bindingInput);
  if (!binding || !ai044Hash(patchSha256) || !ai044Hash(profileFingerprint)) return null;
  return freezeAI044({ version: "pac.ai044.local-review.v1", bindingFingerprint: ai044Fingerprint(binding), profileFingerprint,
    repository: { ...binding.repository }, patchSha256, commands: [...ai044RequiredVerification],
    requireIsolatedWorktree: true, requireCleanExactBaseline: true, requireSuccessfulApply: true,
    requireZeroAnalyticsWrites: true, requireExchangeFixtures: true, requireIndependentSecurity: true,
    ownerDecisionRequired: true, automaticRetryAllowed: false, dispatchAuthorized: false, runtimeDispatchAllowed: false });
}

/** Structural evidence validation. The future caller must supply trusted local runner facts,
 * never facts authored by the patch-producing executor. This does NOT grant publication or execution. */
export function validateAI044ReviewEvidence(bindingInput: unknown, profileFingerprint: unknown, patchSha256: unknown, raw: unknown) {
  const deny = () => freezeAI044({ verdict: "deny" as const, reason: "invalid_local_review_evidence", normalizedEvidence: null });
  try {
    const plan = prepareAI044LocalReview(bindingInput, patchSha256, profileFingerprint);
    if (!plan) return deny();
    const e = exactAI044Record(captureAI044Data(raw), ["bindingFingerprint", "profileFingerprint", "patchSha256", "baseline", "source", "isolatedWorktree",
      "applyExitCode", "analyticsWriteCount", "exchangeNetworkCalls", "producerId", "qaOperatorId", "securityReviewerId", "securityVerdict", "commands", "smoke"]);
    if (e.bindingFingerprint !== plan.bindingFingerprint || e.profileFingerprint !== profileFingerprint || e.patchSha256 !== patchSha256
      || e.baseline !== plan.repository.baseline || e.source !== "trusted_local_runner" || e.isolatedWorktree !== true || e.applyExitCode !== 0
      || e.analyticsWriteCount !== 0 || e.exchangeNetworkCalls !== 0 || ![e.producerId, e.qaOperatorId, e.securityReviewerId].every(ai044Id)
      || e.producerId === e.securityReviewerId || e.producerId === e.qaOperatorId || e.securityReviewerId === e.qaOperatorId || e.securityVerdict !== "pass") return deny();
    if (!Array.isArray(e.commands) || e.commands.length !== plan.commands.length) return deny();
    const records = e.commands.map(c => exactAI044Record(c, ["command", "exitCode", "evidenceSha256", "durationMs"]));
    if (new Set(records.map(c => c.command)).size !== plan.commands.length || records.some(c => !plan.commands.includes(c.command as string)
      || c.exitCode !== 0 || !ai044Hash(c.evidenceSha256) || !ai044Integer(c.durationMs, 600_000))) return deny();
    const smoke = exactAI044Record(e.smoke, ["pageRenders", "paperBinance", "paperMexc", "invalidExchangeDenied", "nonPaperDenied", "emptySafe", "finiteDto",
      "noPositions", "onePriced", "multiplePriced", "unpriced", "nonpositiveEquity", "largestPosition", "topThree", "stableTies", "noMutation"]);
    if (Object.values(smoke).some(value => value !== true)) return deny();
    // No command stdout, provider claims, remote QA summaries or raw errors are returned.
    return freezeAI044({ verdict: "allow" as const, reason: null, normalizedEvidence: {
      bindingFingerprint: plan.bindingFingerprint, profileFingerprint, patchSha256,
      verificationEvidenceFingerprint: ai044Fingerprint([...records].sort((a, b) => a.command === b.command ? 0 : String(a.command) < String(b.command) ? -1 : 1)),
      securityReviewerId: e.securityReviewerId, ownerDecisionRequired: true, automaticRetryAllowed: false,
      verificationStatus: "not_run", evidenceStructure: "validated", dispatchAuthorized: false, runtimeDispatchAllowed: false } });
  } catch { return deny(); }
}
