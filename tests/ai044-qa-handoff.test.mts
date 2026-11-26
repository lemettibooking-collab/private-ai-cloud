import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { prepareAI044LocalReview, validateAI044ReviewEvidence } from "../lib/executors/ai044-qa-handoff.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { proofBinding, qaEvidence, hash } from "./fixtures/ai044-readiness.mts";

test("AI044 local handoff binds exact baseline, patch, commands and zero-write/exchange-fixture requirements", () => {
  const b = proofBinding(), h = prepareAI044LocalReview(b, hash, hash); assert.ok(h);
  assert.equal(h.requireZeroAnalyticsWrites, true); assert.equal(h.requireExchangeFixtures, true);
  assert.equal(h.dispatchAuthorized, false); assert.equal(h.runtimeDispatchAllowed, false); assert.ok(Object.isFrozen(h.commands));
  assert.equal(prepareAI044LocalReview(b, "invalid", hash), null);
});
test("AI044 complete trusted local QA and separated Security evidence validates but gives no authority", () => {
  const b = proofBinding(), e = qaEvidence(), before = structuredClone(e), a = validateAI044ReviewEvidence(b, hash, hash, e), c = validateAI044ReviewEvidence(b, hash, hash, e);
  assert.equal(a.verdict, "allow"); assert.ok(a.normalizedEvidence); assert.equal(a.normalizedEvidence.dispatchAuthorized, false);
  assert.deepEqual(a, c); assert.notEqual(a.normalizedEvidence, c.normalizedEvidence); assert.ok(Object.isFrozen(a.normalizedEvidence)); assert.deepEqual(e, before);
});
for (const field of ["source", "applyExitCode", "analyticsWriteCount", "exchangeNetworkCalls", "baseline", "patchSha256", "securityReviewerId", "qaOperatorId", "securityVerdict"])
  test(`AI044 invalid review ${field} fails closed`, () => {
    const e = qaEvidence(); (e as Record<string, unknown>)[field] = field === "source" ? "remote_executor" : field.endsWith("Id") ? e.producerId : field.endsWith("Count") || field.endsWith("Calls") || field === "applyExitCode" ? 1 : "wrong";
    const r = validateAI044ReviewEvidence(proofBinding(), hash, hash, e); assert.equal(r.verdict, "deny"); assert.equal(r.normalizedEvidence, null);
  });
test("AI044 missing/failing/duplicate command or incomplete calculation/API/render smoke cannot pass QA", () => {
  for (const mutation of ["missing", "failed", "duplicate", "smoke", "digest"]) {
    const e = qaEvidence(); if (mutation === "missing") e.commands.pop(); if (mutation === "failed") e.commands[0].exitCode = 1;
    if (mutation === "duplicate") e.commands[1] = e.commands[0]; if (mutation === "smoke") e.smoke.noMutation = false;
    if (mutation === "digest") e.commands[0].evidenceSha256 = "invalid";
    assert.equal(validateAI044ReviewEvidence(proofBinding(), hash, hash, e).verdict, "deny");
  }
});
test("AI044 remote QA claims cannot produce evidence, and getters do not run", () => {
  let reads = 0; const raw = Object.defineProperty({}, "source", { enumerable: true, get() { reads++; return "trusted_local_runner"; } });
  const r = validateAI044ReviewEvidence(proofBinding(), hash, hash, raw); assert.equal(r.verdict, "deny"); assert.equal(reads, 0);
  assert.equal(r.normalizedEvidence, null);
});
