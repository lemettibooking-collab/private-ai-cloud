// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044Baseline, ai044Repository, ai044RequiredVerification, ai044Fingerprint } from "../../lib/executors/ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044FinancialCategories } from "../../lib/executors/ai044-readiness.ts";
export const hash = "a".repeat(64);
export function proofBinding() {
  return { schemaVersion: 1, workspaceId: "workspace-a", projectId: "project-a", projectTaskId: "task-a", planId: "plan-a", planRevision: 1,
    planFingerprint: hash, developmentTaskId: "dev-task-a", developmentRunId: "dev-run-a", invocationId: "invoke-a", attemptNumber: 1,
    executorIdentity: { id: "openai-agents", version: "v1" }, provider: { id: "openai", accountId: "account-a", modelId: "pinned-model-a", credentialSourceId: "source-a" },
    repository: { id: ai044Repository, baseline: ai044Baseline }, archiveSha256: hash, allowedPaths: ["src/server/terminal/account"],
    acceptanceCriteria: ["Read-only analytics with deterministic factual metrics"], verificationCommands: [...ai044RequiredVerification],
    modelSpendLimitCents: 1, maximumExposureUsdMicros: 100_000 };
}
export function readiness() {
  const binding = proofBinding(), now = 1_000_000, evidenceRevision = 1;
  const financial = { bindingFingerprint: ai044Fingerprint(binding), profileFingerprint: hash, evidenceRevision,
    observedAt: now - 1000, expiresAt: now + 1000, categories: ai044FinancialCategories.map(category => ({ category,
      kind: category === "hosted_container" ? "unknown" : "provider_assertion", maximumUsdMicros: category === "hosted_container" ? null : 1000 })) };
  return { binding, profileFingerprint: hash, financial, approval: { id: "approval-a", actorId: "owner-a", decision: "approve",
    purpose: "ai044_one_attempt_live_proof", bindingFingerprint: ai044Fingerprint(binding), profileFingerprint: hash,
    financialFingerprint: ai044Fingerprint(financial), evidenceRevision, issuedAt: now - 100, expiresAt: now + 100, oneShot: true },
    consumedApprovalIds: [] as string[], now, evidenceRevision };
}
export function refreshApproval(r: ReturnType<typeof readiness>) {
  r.approval.financialFingerprint = ai044Fingerprint(r.financial);
  return r;
}
export function qaEvidence() {
  const b = proofBinding();
  return { bindingFingerprint: ai044Fingerprint(b), profileFingerprint: hash, patchSha256: hash, baseline: ai044Baseline,
    source: "trusted_local_runner", isolatedWorktree: true, applyExitCode: 0, analyticsWriteCount: 0, exchangeNetworkCalls: 0,
    producerId: "executor-a", qaOperatorId: "local-qa-a", securityReviewerId: "reviewer-b", securityVerdict: "pass",
    commands: ai044RequiredVerification.map(command => ({ command, exitCode: 0, evidenceSha256: hash, durationMs: 1 })),
    smoke: { pageRenders: true, paperBinance: true, paperMexc: true, invalidExchangeDenied: true, nonPaperDenied: true, emptySafe: true, finiteDto: true,
      noPositions: true, onePriced: true, multiplePriced: true, unpriced: true, nonpositiveEquity: true, largestPosition: true, topThree: true, stableTies: true, noMutation: true } };
}
