import assert from "node:assert/strict";
import { test } from "node:test";
import { isProxy } from "node:util/types";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateAI044LiveReadiness, createAI044BlockedProofComposition, normalizeAI044OwnerApproval, ai044FinancialCategories } from "../lib/executors/ai044-readiness.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044Fingerprint, normalizeAI044ProofBinding } from "../lib/executors/ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { proofBinding, readiness, refreshApproval } from "./fixtures/ai044-readiness.mts";
function denied(r: ReturnType<typeof evaluateAI044LiveReadiness>) {
  assert.equal(r.verdict, "deny"); assert.equal(r.startCapability, null); assert.equal(r.normalizedResult, null);
  assert.equal(r.totalMaximumExposureUsdMicros, null); assert.equal(r.hostedContainerMaximumUsdMicros, null);
  assert.equal(r.dispatchAuthorized, false); assert.equal(r.runtimeDispatchAllowed, false);
}
function deeplyFrozen(v: unknown): boolean { return v === null || typeof v !== "object" || Object.isFrozen(v) && Object.values(v).every(deeplyFrozen); }

test("AI044 valid Owner approval/exact binding still denies unknown container; unknown is not zero", () => {
  const r = readiness();
  assert.ok(normalizeAI044OwnerApproval(r.approval, r.approval.bindingFingerprint, r.profileFingerprint, ai044Fingerprint(r.financial), r.now, r.evidenceRevision));
  const d = evaluateAI044LiveReadiness(r); denied(d);
  assert.deepEqual(d.reasons, ai044FinancialCategories.map(category => ({ code: "financial_bound_unproven", path: `financial.${category}` })));
});
test("AI044 caller-shaped numeric maxima cannot become vetted finite total proof", () => {
  const r = readiness(); for (const c of r.financial.categories) { c.kind = "provider_assertion"; c.maximumUsdMicros = 0; }
  const d = evaluateAI044LiveReadiness(refreshApproval(r)); denied(d);
  assert.equal(d.reasons.filter(reason => reason.code === "financial_bound_unproven").length, 5);
});
test("AI044 delayed account hard limit is not an exact per-run cap", () => {
  const r = readiness(), c = r.financial.categories[1]; c.kind = "account_hard_limit"; c.maximumUsdMicros = 10;
  const d = evaluateAI044LiveReadiness(refreshApproval(r)); denied(d);
  assert.ok(d.reasons.some(r => r.code === "account_limit_not_run_bound" && r.path === "financial.hosted_container"));
});
for (const kind of ["estimate", "rate_only", "unbounded"]) test(`AI044 ${kind} cannot bound container spend`, () => {
  const r = readiness(); r.financial.categories[1].kind = kind; r.financial.categories[1].maximumUsdMicros = kind === "unbounded" ? null : 10;
  const d = evaluateAI044LiveReadiness(refreshApproval(r)); denied(d);
  assert.ok(d.reasons.some(r => r.code === "financial_bound_unproven" && r.path === "financial.hosted_container"));
});
test("AI044 unknown extra category is rejected, not silently ignored", () => {
  const r = readiness(); r.financial.categories.push({ category: "unknown_billable" as never, kind: "provider_assertion", maximumUsdMicros: 0 });
  const d = evaluateAI044LiveReadiness(refreshApproval(r)); denied(d); assert.equal(d.reasons[0].code, "invalid_financial_categories");
});
test("AI044 missing/duplicate category fails closed", () => {
  for (const mode of ["missing", "duplicate"]) { const r = readiness(); if (mode === "missing") r.financial.categories.pop(); else r.financial.categories[1] = r.financial.categories[0];
    const d = evaluateAI044LiveReadiness(refreshApproval(r)); denied(d); assert.ok(d.reasons.some(r => r.code === "invalid_financial_categories")); }
});
for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER, 1.5]) test(`AI044 malformed financial value ${value} denies`, () => {
  const r = readiness(); r.financial.categories[1].kind = "provider_assertion"; r.financial.categories[1].maximumUsdMicros = value;
  denied(evaluateAI044LiveReadiness(r));
});
test("AI044 stale or future evidence and mismatched provider/config revision deny", () => {
  for (const change of ["stale", "future", "revision", "binding", "profile"]) {
    const r = readiness(); if (change === "stale") r.financial.expiresAt = r.now;
    if (change === "future") r.financial.observedAt = r.now + 1;
    if (change === "revision") r.financial.evidenceRevision++;
    if (change === "binding") r.financial.bindingFingerprint = "b".repeat(64);
    if (change === "profile") r.financial.profileFingerprint = "c".repeat(64);
    const d = evaluateAI044LiveReadiness(refreshApproval(r)); denied(d);
    assert.ok(d.reasons.some(r => ["stale_financial_evidence", "financial_identity_mismatch"].includes(r.code)));
  }
});
test("AI044 stale/reused/general/changed-config Owner approvals are invalid evidence", () => {
  for (const field of ["expiresAt", "oneShot", "profileFingerprint", "bindingFingerprint", "financialFingerprint", "purpose", "consumed", "evidenceRevision"]) {
    const r = readiness(); if (field === "consumed") r.consumedApprovalIds.push(r.approval.id);
    else (r.approval as Record<string, unknown>)[field] = field === "expiresAt" ? r.now : field === "oneShot" ? false : field === "evidenceRevision" ? 2 : "changed";
    const d = evaluateAI044LiveReadiness(r); denied(d); assert.ok(d.reasons.some(r => r.code === "owner_approval_invalid"));
  }
});
test("AI044 binding denies drift, unsafe paths, unlimited budget and hostile inputs", () => {
  const changes = [(b: ReturnType<typeof proofBinding>) => { b.repository.baseline = "b".repeat(40); },
    (b: ReturnType<typeof proofBinding>) => { b.allowedPaths = ["src/server/scanner/file.ts"]; },
    (b: ReturnType<typeof proofBinding>) => { b.allowedPaths = ["package.json"]; },
    (b: ReturnType<typeof proofBinding>) => { b.provider.id = "anthropic"; },
    (b: ReturnType<typeof proofBinding>) => { b.modelSpendLimitCents = 0; }];
  for (const change of changes) { const b = proofBinding(); change(b); assert.equal(normalizeAI044ProofBinding(b), null); }
  const getter = Object.defineProperty({}, "schemaVersion", { get() { throw Error("private"); }, enumerable: true });
  assert.equal(normalizeAI044ProofBinding(getter), null); assert.equal(normalizeAI044ProofBinding(new Proxy({}, {})), null);
});
test("AI044 readiness snapshots input without invoking getters or proxy traps", () => {
  let calls = 0; const r = readiness();
  const getter = Object.defineProperty(r, "credentials", { enumerable: true, get() { calls++; return "test-only-valid-credential-fixture"; } });
  denied(evaluateAI044LiveReadiness(getter)); assert.equal(calls, 0);
  const proxy = new Proxy({}, { ownKeys() { calls++; throw Error("private"); } }); assert.ok(isProxy(proxy));
  denied(evaluateAI044LiveReadiness(proxy)); assert.equal(calls, 0);
});
test("AI044 blocked composition has no credential/transport port and makes zero provider calls", () => {
  let run = 0, credentials = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { run++; assert.fail("provider transport reached while financial gate denied"); }) as typeof fetch;
  try {
    const composition = createAI044BlockedProofComposition();
    assert.deepEqual(Object.keys(composition).sort(), ["dispatchAuthorized", "runtimeDispatchAllowed", "startProof"]);
    assert.equal(composition.runtimeDispatchAllowed, false); assert.equal(composition.dispatchAuthorized, false);
    const input = readiness(); denied(composition.startProof(input));
    const fixture = Object.defineProperty(input, "credentials", { enumerable: true, get() { credentials++; return "test-only-valid-credential-fixture"; } });
    denied(composition.startProof(fixture)); assert.deepEqual({ health: 0, run, credentials }, { health: 0, run: 0, credentials: 0 });
  } finally { globalThis.fetch = originalFetch; }
});
test("AI044 decisions are deterministic, fresh/deeply frozen, immutable and contain no raw denied data", () => {
  const r = readiness(), before = structuredClone(r), a = evaluateAI044LiveReadiness(r), b = evaluateAI044LiveReadiness(r);
  assert.deepEqual(a, b); assert.notEqual(a, b); assert.notEqual(a.reasons, b.reasons); assert.ok(deeplyFrozen(a)); assert.deepEqual(r, before);
  const secret = "sk-private-fixture-do-not-return-123456789";
  assert.ok(!JSON.stringify(evaluateAI044LiveReadiness({ secret })).includes(secret));
});
