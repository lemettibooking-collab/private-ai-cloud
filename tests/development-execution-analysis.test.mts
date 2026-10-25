import assert from "node:assert/strict";
import { test } from "node:test";
import type { DevelopmentExecutionRun } from "../lib/contracts/development-execution";
const execution = await import(new URL("../lib/contracts/development-execution.ts", import.meta.url).href) as typeof import("../lib/contracts/development-execution");
const fixture = await import(new URL("./fixtures/durable-executor.mts", import.meta.url).href) as typeof import("./fixtures/durable-executor.mts");
const reportFingerprint = "a".repeat(64);
function initial() { return fixture.executorConfiguration().developmentRun; }
function step(run: DevelopmentExecutionRun, event: unknown): DevelopmentExecutionRun { const d = execution.transitionDevelopmentExecutionRun(run, event); assert.ok(d.ok, JSON.stringify(d)); const v = execution.validateAndNormalizeDevelopmentExecutionRun(d.value); assert.ok(v.ok, JSON.stringify(v)); return v.value; }
const analysis = () => step(initial(), { type: "submit_analysis", reportFingerprint });
const quality = (run: DevelopmentExecutionRun) => step(run, { type: "verification_passed", checks: [{ command: "npm test", exitCode: 0 }] });
function failure(phase: "implementation" | "verification" | "review", fingerprint = `${phase}-failure`) { return { phase, code: "check_failed", fingerprint, summary: "Required check failed.", retryable: true, scopeExpansionRequired: false, protectedPathViolation: false, systemForbiddenPathViolation: false }; }
test("analysis-only report enters existing verification without fabricated changed paths", () => {
  const run = initial(), before = structuredClone(run), d = execution.transitionDevelopmentExecutionRun(run, { type: "submit_analysis", reportFingerprint }); assert.ok(d.ok, JSON.stringify(d));
  assert.equal(d.value.status, "verifying"); assert.deepEqual(d.value.attempts[0].changedPaths, []); assert.equal(d.value.attempts[0].analysisReportFingerprint, reportFingerprint); assert.deepEqual(run, before);
});
test("analysis requires full existing verification and review before completion", () => {
  const verifying = analysis(); assert.equal(execution.transitionDevelopmentExecutionRun(verifying, { type: "review_passed" }).ok, false);
  assert.equal(execution.transitionDevelopmentExecutionRun(verifying, { type: "verification_passed", checks: [] }).ok, false);
  const reviewing = quality(verifying), completed = step(reviewing, { type: "review_passed" }); assert.equal(completed.status, "completed"); assert.deepEqual(completed.attempts[0].changedPaths, []); assert.equal(completed.attempts[0].analysisReportFingerprint, reportFingerprint);
});
test("legacy patch snapshots retain exact canonical byte shape without optional analysis field", () => {
  const run = initial(), expected = { number: 1, kind: "initial", status: "in_progress", changedPaths: [], failureFingerprints: [], verificationChecks: [], reviewStatus: "not_started", closureKind: "none" };
  assert.equal(JSON.stringify(run.attempts[0]), JSON.stringify(expected));
  const patched = step(run, { type: "submit_patch", changedPaths: ["src/a.ts"] }); assert.equal(Object.hasOwn(patched.attempts[0], "analysisReportFingerprint"), false);
  const complete = step(quality(patched), { type: "review_passed" }); const normalized = execution.validateAndNormalizeDevelopmentExecutionRun(complete); assert.ok(normalized.ok); assert.equal(JSON.stringify(normalized.value), JSON.stringify(complete));
  assert.equal(execution.transitionDevelopmentExecutionRun(run, { type: "submit_patch", changedPaths: [] }).ok, false, "Empty patch is still invalid");
});
test("analysis digest must be exact bounded lowercase SHA-256", () => { for (const value of [null, undefined, "", "a".repeat(63), "a".repeat(65), "A".repeat(64), "z".repeat(64), "sk-abcdefghijk", "a".repeat(100000)]) { const d = execution.transitionDevelopmentExecutionRun(initial(), { type: "submit_analysis", reportFingerprint: value }); assert.equal(d.ok, false); } });
test("analysis event rejects mixed path payload and unknown authority fields", () => { for (const patch of [{ changedPaths: ["src/a.ts"] }, { ownerApproved: true }, { type: "submit_patch", changedPaths: [] }]) assert.equal(execution.transitionDevelopmentExecutionRun(initial(), { type: "submit_analysis", reportFingerprint, ...patch }).ok, false); });
test("analysis submission only allowed while implementing and only once", () => { const verifying = analysis(); for (const run of [verifying, quality(verifying), step(quality(verifying), { type: "review_passed" }), step(initial(), { type: "cancel" })]) assert.equal(execution.transitionDevelopmentExecutionRun(run, { type: "submit_analysis", reportFingerprint }).ok, false); });
test("analysis failure history survives corrective attempt with a fresh empty output", () => {
  const first = step(analysis(), { type: "verification_failed", failure: failure("verification") }); assert.equal(first.status, "awaiting_correction");
  const second = step(first, { type: "start_attempt" }); assert.equal(second.currentAttemptNumber, 2); assert.equal(second.attempts[0].analysisReportFingerprint, reportFingerprint); assert.equal(Object.hasOwn(second.attempts[1], "analysisReportFingerprint"), false);
  const submitted = step(second, { type: "submit_analysis", reportFingerprint: "b".repeat(64) }); assert.equal(step(quality(submitted), { type: "review_passed" }).status, "completed");
});
test("analysis review failures reuse existing retryable/repeated policy", () => {
  const failed = step(quality(analysis()), { type: "review_failed", failure: failure("review") }); assert.equal(failed.status, "awaiting_correction"); const next = step(failed, { type: "start_attempt" });
  const submitted = step(next, { type: "submit_analysis", reportFingerprint: "b".repeat(64) }); const repeated = step(quality(submitted), { type: "review_failed", failure: failure("review") }); assert.equal(repeated.status, "blocked"); assert.ok(repeated.blockingReasons.some(r => r.code === "repeated_failure"));
});
test("analysis cancellation preserves explicit report evidence without inventing paths", () => { for (const active of [analysis(), quality(analysis())]) { const cancelled = step(active, { type: "cancel" }); assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.attempts[0].analysisReportFingerprint, reportFingerprint); assert.deepEqual(cancelled.attempts[0].changedPaths, []); } });
test("tampered snapshot cannot mix patch paths and analysis report", () => { const run = analysis(); assert.equal(execution.validateAndNormalizeDevelopmentExecutionRun({ ...run, attempts: [{ ...run.attempts[0], changedPaths: ["src/a.ts"] }] }).ok, false); });
test("tampered snapshot cannot insert analysis evidence during implementation or implementation failure", () => { const run = initial(); assert.equal(execution.validateAndNormalizeDevelopmentExecutionRun({ ...run, attempts: [{ ...run.attempts[0], analysisReportFingerprint: reportFingerprint }] }).ok, false); const failed = step(run, { type: "implementation_failed", failure: failure("implementation") }); assert.equal(execution.validateAndNormalizeDevelopmentExecutionRun({ ...failed, attempts: [{ ...failed.attempts[0], analysisReportFingerprint: reportFingerprint }] }).ok, false); });
test("removing report digest invalidates verifying/reviewing/completed and verification/review failure history", () => {
  const verifying = analysis(), reviewing = quality(verifying), completed = step(reviewing, { type: "review_passed" });
  const failedQuality = step(verifying, { type: "verification_failed", failure: failure("verification") }), failedReview = step(reviewing, { type: "review_failed", failure: failure("review") });
  for (const run of [verifying, reviewing, completed, failedQuality, failedReview]) { const attempt = { ...run.attempts[0] }; delete attempt.analysisReportFingerprint; assert.equal(execution.validateAndNormalizeDevelopmentExecutionRun({ ...run, attempts: [attempt] }).ok, false, run.status); }
});
test("analysis optional field getter is not executed and no exception leaks", () => { let invoked = 0; const run = initial(); const attempt = { ...run.attempts[0], get analysisReportFingerprint() { invoked++; throw Error("private-marker"); } }; assert.doesNotThrow(() => execution.validateAndNormalizeDevelopmentExecutionRun({ ...run, attempts: [attempt] })); assert.equal(execution.validateAndNormalizeDevelopmentExecutionRun({ ...run, attempts: [attempt] }).ok, false); const event = { type: "submit_analysis", get reportFingerprint() { invoked++; throw Error("private-marker"); } }; assert.equal(execution.transitionDevelopmentExecutionRun(run, event).ok, false); assert.equal(invoked, 0); });
test("analysis normalizes deterministically with fresh nested output and immutable input", () => { const run = analysis(), before = structuredClone(run), a = execution.validateAndNormalizeDevelopmentExecutionRun(run), b = execution.validateAndNormalizeDevelopmentExecutionRun(run); assert.ok(a.ok && b.ok); assert.deepEqual(a, b); assert.notEqual(a.value, b.value); assert.notEqual(a.value.attempts[0], b.value.attempts[0]); assert.deepEqual(run, before); });
