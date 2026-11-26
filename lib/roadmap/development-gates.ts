import type { DevelopmentExecutionEvent } from "../contracts/development-execution";
import type { RoadmapApprovalPurpose } from "./roadmap-contract";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureRoadmapData, compareRoadmapIds, isRoadmapFingerprint, roadmapFingerprint } from "./roadmap-contract.ts";

const autoActions = ["calculate_readiness", "select_route", "run_quality_gate", "run_security_gate", "collect_evidence", "repeat_verification"] as const;
const ownerPurposes = Object.freeze({ feature_plan_approval: "feature_plan_approval", scope_change: "scope_change", roadmap_change: "architecture_change", architecture_change: "architecture_change", budget_increase: "budget_or_risk_increase", risk_increase: "budget_or_risk_increase", high_risk_migration: "architecture_change", provider_configuration_change: "architecture_change", result_acceptance: "result_acceptance" } as const);
const hardActions = ["tenant_integrity_failure", "system_forbidden_path", "protected_path_violation", "security_invariant_failure", "budget_corruption", "impossible_state", "unknown_provider_outcome", "repository_identity_mismatch", "repeated_failure", "tampered_evidence"] as const;
const futureOwnerActions = ["commit", "push", "deploy"] as const;
export type DevelopmentGateDecision = Readonly<{ category: "AUTO" | "OWNER" | "HARD_STOP"; purpose: RoadmapApprovalPurpose | null; available: boolean; reasonCode: string; dispatchAuthorized: false; runtimeDispatchAllowed: false }>;
function decision(category: DevelopmentGateDecision["category"], reasonCode: string, purpose: RoadmapApprovalPurpose | null = null, available = true): DevelopmentGateDecision {
  return Object.freeze({ category, purpose, available, reasonCode, dispatchAuthorized: false, runtimeDispatchAllowed: false });
}
/** Closed classification only; even an AUTO result grants no execution authority. */
export function classifyDevelopmentGate(raw: unknown): DevelopmentGateDecision {
  const f = exactOwnData(raw, ["action"]);
  if (!f || typeof f.action !== "string") return decision("HARD_STOP", "invalid_gate_input", null, false);
  const action = f.action;
  if (hardActions.some(a => a === action)) return decision("HARD_STOP", action);
  if (futureOwnerActions.some(a => a === action)) return decision("OWNER", "operation_unavailable", null, false);
  if (action === "live_dispatch") return decision("HARD_STOP", "operation_unavailable", null, false);
  if (Object.hasOwn(ownerPurposes, action)) return decision("OWNER", action, ownerPurposes[action as keyof typeof ownerPurposes]);
  if (autoActions.some(a => a === action)) return decision("AUTO", action);
  return decision("HARD_STOP", "invalid_gate_input", null, false);
}
/** All fields must come from the current factual attempt/policy, never executor preferences. */
export function evaluateCorrectiveGate(raw: unknown): DevelopmentGateDecision {
  const f = exactOwnData(raw, ["attemptNumber", "retryable", "scopeExpansionRequired", "protectedPathViolation", "systemForbiddenPathViolation", "repeatedFailure", "withinApprovedRiskBudget"]);
  const booleans = ["retryable", "scopeExpansionRequired", "protectedPathViolation", "systemForbiddenPathViolation", "repeatedFailure", "withinApprovedRiskBudget"] as const;
  if (!f || !Number.isSafeInteger(f.attemptNumber) || (f.attemptNumber as number) < 1 || (f.attemptNumber as number) > 3 || booleans.some(k => typeof f[k] !== "boolean")) return decision("HARD_STOP", "invalid_gate_input", null, false);
  if (f.systemForbiddenPathViolation || f.protectedPathViolation) return decision("HARD_STOP", "protected_invariant");
  if (f.repeatedFailure) return decision("HARD_STOP", "repeated_failure");
  if ((f.attemptNumber as number) >= 3) return decision("HARD_STOP", "attempt_budget_exhausted");
  if (!f.retryable) return decision("HARD_STOP", "non_retryable_failure");
  if (f.scopeExpansionRequired) return decision("OWNER", "scope_expansion_required", "scope_change");
  if (!f.withinApprovedRiskBudget) return decision("OWNER", "approved_limits_exceeded", "budget_or_risk_increase");
  return decision("AUTO", "bounded_correction");
}

export type DevelopmentEvidenceBinding = Readonly<{ runId: string; attemptNumber: number; outcomeFingerprint: string; operationId: string }>;
export type DevelopmentQualityBinding = DevelopmentEvidenceBinding & Readonly<{ requiredCommands: readonly string[] }>;
export type DevelopmentSecurityBinding = DevelopmentEvidenceBinding & Readonly<{ producerExecutorId: string }>;
export type DevelopmentQualityCheck = Readonly<{ command: string; status: "passed" | "failed" | "timeout" | "truncated" | "unsupported"; exitCode: number | null }>;
export type DevelopmentQualityEvidence = DevelopmentEvidenceBinding & Readonly<{ phase: "quality"; checks: readonly DevelopmentQualityCheck[]; outcome: "pass" | "fail_retryable" | "hard_stop"; fingerprint: string; failureFingerprint: string | null }>;
export const developmentSecuritySummaries = Object.freeze({ review_passed: "Independent security review passed.", security_check_failed: "Independent security review found a retryable issue.", scope_expansion_required: "Independent review requires an Owner scope decision.", security_invariant_violation: "Independent review found a protected security invariant violation.", tampered_evidence: "Independent review evidence integrity failed." });
export type DevelopmentSecurityCode = keyof typeof developmentSecuritySummaries;
export type DevelopmentSecurityEvidence = DevelopmentEvidenceBinding & Readonly<{ phase: "security"; reviewerId: string; outcome: "pass" | "fail_retryable" | "fail_owner_required" | "hard_stop"; code: DevelopmentSecurityCode; summary: string; fingerprint: string; failureFingerprint: string | null }>;
const bindingFields = ["runId", "attemptNumber", "outcomeFingerprint", "operationId"] as const;
const id = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(x) && !/(?:sk-|github_pat_|gh[pousr]_)/u.test(x);
const secret = /(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{8,}|github_pat_|bearer\s|private key|DATABASE_URL|(?:token|password|api[_-]?key)\s*[:=])/iu;
function binding(raw: Record<string, unknown>): DevelopmentEvidenceBinding | null {
  return id(raw.runId) && id(raw.operationId) && isRoadmapFingerprint(raw.outcomeFingerprint) && Number.isSafeInteger(raw.attemptNumber) && (raw.attemptNumber as number) >= 1 && (raw.attemptNumber as number) <= 3
    ? Object.freeze({ runId: raw.runId, attemptNumber: raw.attemptNumber as number, outcomeFingerprint: raw.outcomeFingerprint, operationId: raw.operationId }) : null;
}
function sameBinding(actual: DevelopmentEvidenceBinding, expected: DevelopmentEvidenceBinding): boolean { return bindingFields.every(k => actual[k] === expected[k]); }
function commands(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 32) return null;
  const out: string[] = [];
  for (const value of raw) { if (typeof value !== "string" || !value.length || value.length > 1024 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value) || secret.test(value) || out.includes(value)) return null; out.push(value); }
  return Object.freeze(out.sort(compareRoadmapIds));
}
/** Snapshot first. No getters, proxies, logs, shell execution or unbounded provider text. */
export function normalizeDevelopmentQualityEvidence(raw: unknown, expectedInput: unknown): DevelopmentQualityEvidence | null {
  try {
    const input = exactOwnData(captureRoadmapData(raw), [...bindingFields, "checks"]), expected = exactOwnData(captureRoadmapData(expectedInput), [...bindingFields, "requiredCommands"]);
    const actualBinding = input && binding(input), expectedBinding = expected && binding(expected), required = expected && commands(expected.requiredCommands);
    if (!input || !actualBinding || !expectedBinding || !sameBinding(actualBinding, expectedBinding) || !required || !Array.isArray(input.checks) || input.checks.length !== required.length) return null;
    const checks: DevelopmentQualityCheck[] = [];
    for (const item of input.checks) {
      const check = exactOwnData(item, ["command", "status", "exitCode"]);
      if (!check || typeof check.command !== "string" || !required.includes(check.command) || checks.some(c => c.command === check.command) || !["passed", "failed", "timeout", "truncated", "unsupported"].includes(check.status as string)) return null;
      if (check.status === "passed" ? check.exitCode !== 0 : check.status === "failed" ? !Number.isSafeInteger(check.exitCode) || (check.exitCode as number) < 1 || (check.exitCode as number) > 255 : check.exitCode !== null) return null;
      checks.push(Object.freeze({ command: check.command, status: check.status as DevelopmentQualityCheck["status"], exitCode: check.exitCode as number | null }));
    }
    checks.sort((a, b) => compareRoadmapIds(a.command, b.command));
    if (!required.every(command => checks.some(c => c.command === command))) return null;
    const outcome = checks.every(c => c.status === "passed") ? "pass" : checks.some(c => c.status === "unsupported") ? "hard_stop" : "fail_retryable";
    const failed = checks.filter(c => c.status !== "passed");
    const failureFingerprint = outcome === "pass" ? null : roadmapFingerprint(["development.quality.failure.v1", failed]);
    const data = Object.freeze({ ...actualBinding, phase: "quality" as const, checks: Object.freeze(checks), outcome, failureFingerprint });
    return Object.freeze({ ...data, fingerprint: roadmapFingerprint(["development.quality.evidence.v1", data]) });
  } catch { return null; }
}
export function normalizeDevelopmentSecurityEvidence(raw: unknown, expectedInput: unknown): DevelopmentSecurityEvidence | null {
  try {
    const input = exactOwnData(captureRoadmapData(raw), [...bindingFields, "reviewerId", "outcome", "code", "summary"]), expected = exactOwnData(captureRoadmapData(expectedInput), [...bindingFields, "producerExecutorId"]);
    const actualBinding = input && binding(input), expectedBinding = expected && binding(expected);
    if (!input || !expected || !actualBinding || !expectedBinding || !sameBinding(actualBinding, expectedBinding) || !id(input.reviewerId) || !id(expected.producerExecutorId) || input.reviewerId === expected.producerExecutorId || typeof input.code !== "string" || !Object.hasOwn(developmentSecuritySummaries, input.code)) return null;
    const code = input.code as DevelopmentSecurityCode;
    if (input.summary !== developmentSecuritySummaries[code]) return null;
    const outcome = code === "review_passed" ? "pass" : code === "security_check_failed" ? "fail_retryable" : code === "scope_expansion_required" ? "fail_owner_required" : "hard_stop";
    if (input.outcome !== outcome) return null;
    const failureFingerprint = outcome === "pass" ? null : roadmapFingerprint(["development.security.failure.v1", code, outcome]);
    const data = Object.freeze({ ...actualBinding, phase: "security" as const, reviewerId: input.reviewerId, outcome, code, summary: developmentSecuritySummaries[code], failureFingerprint });
    return Object.freeze({ ...data, fingerprint: roadmapFingerprint(["development.security.evidence.v1", data]) });
  } catch { return null; }
}
/** Existing AI-011 events only. No second corrective-state machine or runtime action. */
export function developmentQualityEvent(evidence: DevelopmentQualityEvidence): DevelopmentExecutionEvent {
  if (evidence.outcome === "pass") return Object.freeze({ type: "verification_passed", checks: Object.freeze(evidence.checks.map(c => Object.freeze({ command: c.command, exitCode: 0 }))) });
  return Object.freeze({ type: "verification_failed", failure: Object.freeze({ phase: "verification", code: "quality_gate_failed", fingerprint: evidence.failureFingerprint!, summary: "Required verification did not pass.", retryable: evidence.outcome === "fail_retryable", scopeExpansionRequired: false, protectedPathViolation: false, systemForbiddenPathViolation: false }) });
}
export function developmentSecurityEvent(evidence: DevelopmentSecurityEvidence): DevelopmentExecutionEvent {
  if (evidence.outcome === "pass") return Object.freeze({ type: "review_passed" });
  return Object.freeze({ type: "review_failed", failure: Object.freeze({ phase: "review", code: evidence.code, fingerprint: evidence.failureFingerprint!, summary: evidence.summary, retryable: evidence.outcome === "fail_retryable" || evidence.outcome === "fail_owner_required", scopeExpansionRequired: evidence.outcome === "fail_owner_required", protectedPathViolation: false, systemForbiddenPathViolation: false }) });
}
