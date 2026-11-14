import assert from "node:assert/strict";
import { test } from "node:test";
const gates = await import(process.env.B3_GATE_MODULE ?? new URL("../lib/roadmap/development-gates.ts", import.meta.url).href) as typeof import("../lib/roadmap/development-gates");
const roadmap = await import(process.env.B3_TASK_CLASS_MODULE ?? new URL("../lib/roadmap/roadmap-contract.ts", import.meta.url).href) as typeof import("../lib/roadmap/roadmap-contract");
const binding = () => ({ runId: "run-one", attemptNumber: 1, outcomeFingerprint: "a".repeat(64), operationId: "quality-one" });
const requiredCommands = ["npm run lint", "npm test"];
const qualityBinding = () => ({ ...binding(), requiredCommands: [...requiredCommands] });
const quality = () => ({ ...binding(), checks: requiredCommands.map(command => ({ command, status: "passed", exitCode: 0 as number | null })) });
const securityBinding = () => ({ ...binding(), producerExecutorId: "openai-agents/v1" });
const security = () => ({ ...binding(), reviewerId: "pac-security/v1", outcome: "pass", code: "review_passed", summary: gates.developmentSecuritySummaries.review_passed });
const correction = () => ({ attemptNumber: 1, retryable: true, scopeExpansionRequired: false, protectedPathViolation: false, systemForbiddenPathViolation: false, repeatedFailure: false, withinApprovedRiskBudget: true });
function frozen(value: unknown): boolean { return value === null || typeof value !== "object" || Object.isFrozen(value) && Object.values(value).every(frozen); }

for (const action of ["calculate_readiness", "select_route", "run_quality_gate", "run_security_gate", "collect_evidence", "repeat_verification"]) test(`AUTO classifier ${action} never grants dispatch`, () => {
  const result = gates.classifyDevelopmentGate({ action }); assert.equal(result.category, "AUTO"); assert.equal(result.purpose, null); assert.equal(result.dispatchAuthorized, false); assert.equal(result.runtimeDispatchAllowed, false); assert.ok(frozen(result));
});
for (const [action, purpose] of [["feature_plan_approval", "feature_plan_approval"], ["scope_change", "scope_change"], ["roadmap_change", "architecture_change"], ["architecture_change", "architecture_change"], ["budget_increase", "budget_or_risk_increase"], ["risk_increase", "budget_or_risk_increase"], ["high_risk_migration", "architecture_change"], ["provider_configuration_change", "architecture_change"], ["result_acceptance", "result_acceptance"]]) test(`Owner classifier ${action} exact bounded purpose`, () => {
  const result = gates.classifyDevelopmentGate({ action }); assert.equal(result.category, "OWNER"); assert.equal(result.purpose, purpose); assert.equal(result.dispatchAuthorized, false);
});
for (const action of ["tenant_integrity_failure", "system_forbidden_path", "protected_path_violation", "security_invariant_failure", "budget_corruption", "impossible_state", "unknown_provider_outcome", "repository_identity_mismatch", "repeated_failure", "tampered_evidence"]) test(`HARD STOP ${action} is not Owner overridable`, () => {
  assert.equal(gates.classifyDevelopmentGate({ action }).category, "HARD_STOP"); assert.equal(gates.classifyDevelopmentGate({ action, ownerApproved: true }).category, "HARD_STOP");
});
for (const action of ["commit", "push", "deploy"]) test(`${action} remains a future Owner gate, unavailable in B3`, () => { const result = gates.classifyDevelopmentGate({ action }); assert.equal(result.category, "OWNER"); assert.equal(result.available, false); assert.equal(result.purpose, null); assert.equal(result.dispatchAuthorized, false); });
for (const action of ["live_dispatch", "arbitrary_shell"]) test(`${action} unavailable in B3`, () => { const result = gates.classifyDevelopmentGate({ action }); assert.equal(result.category, "HARD_STOP"); assert.equal(result.available, false); });
test("classifier rejects getter/proxy/unknown without raw disclosure", () => {
  let invoked = 0; const raw = { get action() { invoked++; throw Error("private-marker"); } };
  for (const input of [raw, new Proxy({}, { ownKeys() { invoked++; throw Error("private-marker"); } }), {}, null, { action: "OWNER" }]) assert.equal(gates.classifyDevelopmentGate(input).category, "HARD_STOP");
  assert.equal(invoked, 0);
});
test("bounded corrective classification derives AUTO only in exact approved limits", () => { assert.equal(gates.evaluateCorrectiveGate(correction()).category, "AUTO"); assert.equal(gates.evaluateCorrectiveGate({ ...correction(), attemptNumber: 2 }).category, "AUTO"); });
test("scope expansion and approved limit increase require Owner", () => {
  assert.equal(gates.evaluateCorrectiveGate({ ...correction(), scopeExpansionRequired: true }).category, "OWNER"); assert.equal(gates.evaluateCorrectiveGate({ ...correction(), scopeExpansionRequired: true }).purpose, "scope_change");
  assert.equal(gates.evaluateCorrectiveGate({ ...correction(), withinApprovedRiskBudget: false }).purpose, "budget_or_risk_increase");
});
for (const patch of [{ repeatedFailure: true }, { attemptNumber: 3 }, { retryable: false }, { protectedPathViolation: true }, { systemForbiddenPathViolation: true }]) test(`corrective hard stop precedence ${JSON.stringify(patch)}`, () => { assert.equal(gates.evaluateCorrectiveGate({ ...correction(), scopeExpansionRequired: true, ...patch }).category, "HARD_STOP"); });
test("correction rejects malformed counters, booleans, caller override", () => { for (const patch of [{ attemptNumber: 0 }, { attemptNumber: 4 }, { attemptNumber: 1.5 }, { retryable: "yes" }, { ownerApproved: true }]) assert.equal(gates.evaluateCorrectiveGate({ ...correction(), ...patch }).category, "HARD_STOP"); });
test("trusted class cannot be caller-selected even for corrections", () => { for (const input of ["openai", "refactor", "verification", { taskClass: "implementation" }, null]) assert.throws(() => roadmap.deriveRoadmapTaskClass(input as never, true)); });

test("Quality factual all-required PASS maps to existing verification_passed", () => {
  const result = gates.normalizeDevelopmentQualityEvidence(quality(), qualityBinding()); assert.ok(result); assert.equal(result.outcome, "pass"); assert.equal(result.failureFingerprint, null); assert.deepEqual(gates.developmentQualityEvent(result), { type: "verification_passed", checks: requiredCommands.map(command => ({ command, exitCode: 0 })) });
});
test("Quality missing/duplicate/extra commands never PASS", () => {
  const one = quality(); one.checks.pop(); assert.equal(gates.normalizeDevelopmentQualityEvidence(one, qualityBinding()), null);
  const duplicate = quality(); duplicate.checks[1] = { ...duplicate.checks[0] }; assert.equal(gates.normalizeDevelopmentQualityEvidence(duplicate, qualityBinding()), null);
  const extra = quality(); extra.checks.push({ command: "rm -rf /", status: "passed", exitCode: 0 }); assert.equal(gates.normalizeDevelopmentQualityEvidence(extra, qualityBinding()), null);
});
test("Quality malformed required command sets fail closed", () => { for (const requiredCommands of [[], ["npm test", "npm test"], ["secret token=abcdef"], ["x\ny"], Array(33).fill("npm test"), ["x".repeat(1025)]]) assert.equal(gates.normalizeDevelopmentQualityEvidence(quality(), { ...qualityBinding(), requiredCommands }), null); });
for (const [status, exitCode, expected] of [["failed", 1, "fail_retryable"], ["timeout", null, "fail_retryable"], ["truncated", null, "fail_retryable"], ["unsupported", null, "hard_stop"]] as const) test(`Quality ${status} is factual non-PASS`, () => {
  const raw = quality(); raw.checks[0] = { ...raw.checks[0], status, exitCode }; const result = gates.normalizeDevelopmentQualityEvidence(raw, qualityBinding()); assert.ok(result); assert.equal(result.outcome, expected); const event = gates.developmentQualityEvent(result); assert.equal(event.type, "verification_failed"); if (event.type === "verification_failed") assert.equal(event.failure.retryable, expected === "fail_retryable");
});
test("Quality status/exit-code pairing exact and no unsupported status", () => { for (const [status, exitCode] of [["passed", 1], ["failed", 0], ["failed", null], ["failed", 1.5], ["failed", 256], ["timeout", 0], ["truncated", 1], ["unsupported", 1], ["unknown", null]]) { const raw = quality(); raw.checks[0] = { ...raw.checks[0], status: status as string, exitCode: exitCode as number | null }; assert.equal(gates.normalizeDevelopmentQualityEvidence(raw, qualityBinding()), null); } });
for (const field of ["runId", "attemptNumber", "outcomeFingerprint", "operationId"] as const) test(`Quality rejects stale/mismatched ${field}`, () => { const raw = quality(); Object.assign(raw, { [field]: field === "attemptNumber" ? 2 : field === "outcomeFingerprint" ? "b".repeat(64) : "different" }); assert.equal(gates.normalizeDevelopmentQualityEvidence(raw, qualityBinding()), null); });
test("Quality canonical reverse order, deterministic fresh/frozen, immutable inputs", () => {
  const raw = quality(), expected = qualityBinding(), before = structuredClone({ raw, expected }); const a = gates.normalizeDevelopmentQualityEvidence(raw, expected), b = gates.normalizeDevelopmentQualityEvidence({ ...raw, checks: [...raw.checks].reverse() }, { ...expected, requiredCommands: [...requiredCommands].reverse() }); assert.ok(a && b); assert.deepEqual(a, b); assert.notEqual(a, b); assert.notEqual(a.checks, b.checks); assert.ok(frozen(a)); assert.deepEqual({ raw, expected }, before);
});
test("Quality failure fingerprint stable across attempts/operation/result to stop repeated loop", () => {
  const raw = quality(); raw.checks[0] = { ...raw.checks[0], status: "failed", exitCode: 1 }; const a = gates.normalizeDevelopmentQualityEvidence(raw, qualityBinding());
  const next = { attemptNumber: 2, operationId: "quality-two", outcomeFingerprint: "b".repeat(64) }; const b = gates.normalizeDevelopmentQualityEvidence({ ...raw, ...next }, { ...qualityBinding(), ...next }); assert.ok(a && b); assert.equal(a.failureFingerprint, b.failureFingerprint); assert.notEqual(a.fingerprint, b.fingerprint);
});
test("Quality hostile getter/proxy/deep/oversized/secret evidence deny without inspection or leakage", () => {
  let invoked = 0; const getter = { ...quality(), get checks() { invoked++; throw Error("raw-provider-secret"); } }; const proxy = new Proxy(quality(), { ownKeys() { invoked++; throw Error("raw-provider-secret"); } });
  for (const raw of [getter, proxy, { ...quality(), checks: Array(4097).fill(null) }, { ...quality(), checks: [{ command: "token=private", status: "passed", exitCode: 0 }] }, { ...quality(), rawError: "raw-provider-secret" }]) assert.equal(gates.normalizeDevelopmentQualityEvidence(raw, qualityBinding()), null);
  assert.equal(invoked, 0);
});

test("Security independent PASS maps to existing review_passed", () => { const result = gates.normalizeDevelopmentSecurityEvidence(security(), securityBinding()); assert.ok(result); assert.equal(result.outcome, "pass"); assert.deepEqual(gates.developmentSecurityEvent(result), { type: "review_passed" }); });
for (const [code, outcome] of [["security_check_failed", "fail_retryable"], ["scope_expansion_required", "fail_owner_required"], ["security_invariant_violation", "hard_stop"], ["tampered_evidence", "hard_stop"]] as const) test(`Security ${code} factual existing review_failed`, () => {
  const raw = { ...security(), code, outcome, summary: gates.developmentSecuritySummaries[code] }; const result = gates.normalizeDevelopmentSecurityEvidence(raw, securityBinding()); assert.ok(result); assert.equal(result.outcome, outcome); const event = gates.developmentSecurityEvent(result); assert.equal(event.type, "review_failed"); if (event.type === "review_failed") { assert.equal(event.failure.scopeExpansionRequired, outcome === "fail_owner_required"); assert.equal(event.failure.retryable, outcome !== "hard_stop"); assert.equal(event.failure.protectedPathViolation, false, "Do not fabricate a factual protected path violation from generic hard stop."); }
});
test("Security cannot be skipped, self-certified, incomplete or contradictory", () => {
  for (const raw of [null, {}, { ...security(), reviewerId: "openai-agents/v1" }, { ...security(), code: "security_check_failed" }, { ...security(), outcome: "hard_stop" }, { ...security(), code: "unknown" }, { ...security(), summary: "raw-provider-secret" }, { ...security(), rawProviderError: "private" }]) assert.equal(gates.normalizeDevelopmentSecurityEvidence(raw, securityBinding()), null);
});
for (const field of ["runId", "attemptNumber", "outcomeFingerprint", "operationId"] as const) test(`Security rejects mismatched ${field}`, () => { const patch = { [field]: field === "attemptNumber" ? 2 : field === "outcomeFingerprint" ? "b".repeat(64) : "changed" }; assert.equal(gates.normalizeDevelopmentSecurityEvidence({ ...security(), ...patch }, securityBinding()), null); });
test("Security secret-like/oversized/multiline summaries never escape", () => { for (const summary of ["sk-abcdefghijk", "token=private", "private raw provider refusal", "x".repeat(10000), "first\nsecond"]) assert.equal(gates.normalizeDevelopmentSecurityEvidence({ ...security(), summary }, securityBinding()), null); });
test("Security failure fingerprint stable while evidence binds current attempt", () => {
  const raw = { ...security(), code: "security_check_failed", outcome: "fail_retryable", summary: gates.developmentSecuritySummaries.security_check_failed }; const a = gates.normalizeDevelopmentSecurityEvidence(raw, securityBinding()); const next = { attemptNumber: 2, operationId: "review-two", outcomeFingerprint: "b".repeat(64) }; const b = gates.normalizeDevelopmentSecurityEvidence({ ...raw, ...next }, { ...securityBinding(), ...next }); assert.ok(a && b); assert.equal(a.failureFingerprint, b.failureFingerprint); assert.notEqual(a.fingerprint, b.fingerprint);
});
test("Security deterministic fresh deeply frozen and input immutable", () => { const raw = security(), expected = securityBinding(), before = structuredClone({ raw, expected }), a = gates.normalizeDevelopmentSecurityEvidence(raw, expected), b = gates.normalizeDevelopmentSecurityEvidence(raw, expected); assert.ok(a && b); assert.deepEqual(a, b); assert.notEqual(a, b); assert.ok(frozen(a)); assert.deepEqual({ raw, expected }, before); });
test("Security hostile getter/proxy avoid invocation, all malformed outputs null", () => { let invoked = 0; const raw = { ...security(), get summary() { invoked++; throw Error("raw-error"); } }; assert.equal(gates.normalizeDevelopmentSecurityEvidence(raw, securityBinding()), null); assert.equal(gates.normalizeDevelopmentSecurityEvidence(new Proxy(security(), {}), securityBinding()), null); assert.equal(invoked, 0); });
test("Quality failure fingerprints feed existing AI-011 repeated-failure stop, not a second counter", async () => {
  const fixture = await import(new URL("./fixtures/durable-executor.mts", import.meta.url).href) as typeof import("./fixtures/durable-executor.mts");
  const ai011 = await import(new URL("../lib/contracts/development-execution.ts", import.meta.url).href) as typeof import("../lib/contracts/development-execution");
  let run = fixture.executorConfiguration().developmentRun;
  function transition(event: unknown) { const next = ai011.transitionDevelopmentExecutionRun(run, event); assert.ok(next.ok); run = next.value; }
  for (let attempt = 1; attempt <= 2; attempt++) {
    transition({ type: "submit_patch", changedPaths: ["src/a.ts"] });
    const facts = { runId: run.id, attemptNumber: attempt, operationId: `quality-${attempt}`, outcomeFingerprint: String(attempt).repeat(64) };
    const evidence = gates.normalizeDevelopmentQualityEvidence({ ...facts, checks: [{ command: "npm test", status: "failed", exitCode: 1 }] }, { ...facts, requiredCommands: run.requiredVerificationCommands });
    assert.ok(evidence); transition(gates.developmentQualityEvent(evidence));
    if (attempt === 1) { assert.equal(run.status, "awaiting_correction"); transition({ type: "start_attempt" }); }
  }
  assert.equal(run.status, "blocked"); assert.equal(run.currentAttemptNumber, 2); assert.ok(run.blockingReasons.some(reason => reason.code === "repeated_failure"));
});
