import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration } from "./fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { transition } from "./fixtures/executor-attempt.mts";
const facts = await import(new URL("../lib/executors/executor-current-authority.ts", import.meta.url).href) as typeof import("../lib/executors/executor-current-authority");
const authority = await import(new URL("../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../lib/db/executor-current-authority-store");
const location = new URL("../lib/db/executor-current-authority-store.ts", import.meta.url);
for (const fact of ["cross-process revocation", "durable generation", "canonical corrective advancement"])
  test(`current authority prerequisite: ${fact}`, () => assert.ok(existsSync(location), `baseline has no ${fact} authority`));
test("start must lock current authority before financial lock", () => {
  const source = readFileSync(new URL("../lib/db/executor-start-store.ts", import.meta.url), "utf8");
  assert.ok(source.includes("lockExecutorAuthority"), "baseline snapshot alone can start: no durable current-authority lookup");
});
function frozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]));
  return v;
}
test("canonical fingerprints ignore object key insertion order; output fresh/deeply frozen; caller unchanged", () => {
  const c = executorConfiguration(), before = structuredClone(c), a = facts.deriveExecutorAuthorityFacts(c), b = facts.deriveExecutorAuthorityFacts(reverseKeys(c));
  assert.deepEqual(a, b); assert.notEqual(a, b); frozen(a); frozen(b); assert.deepEqual(c, before);
});
for (const n of [1, 2, 3]) test(`factual attempt ${n} and adjacent predecessor fingerprint`, () => {
  const f = facts.deriveExecutorAuthorityFacts(executorConfiguration(n));
  assert.equal(f.attemptNumber, n); assert.equal(f.attemptKind, n === 1 ? "initial" : "corrective");
  assert.equal(f.predecessorRunFingerprint, n === 1 ? null : facts.deriveExecutorAuthorityFacts(executorConfiguration(n - 1)).canonicalRunFingerprint);
});
test("run and grant fingerprints bind independently to real verification/admission facts", () => {
  const c = executorConfiguration(), original = facts.deriveExecutorAuthorityFacts(c);
  const changed = structuredClone(c); changed.developmentRun = { ...changed.developmentRun, requiredVerificationCommands: ["npm run lint"] };
  assert.notEqual(facts.deriveExecutorAuthorityFacts(changed).canonicalRunFingerprint, original.canonicalRunFingerprint);
  const grant = structuredClone(c); grant.admission.plan.tasks[0].requiresOwnerApproval = false;
  const a = facts.deriveExecutorAuthorityFacts(grant); grant.admission.taskOwnerApprovalGranted = false;
  assert.notEqual(facts.deriveExecutorAuthorityFacts(grant).admissionFingerprint, a.admissionFingerprint);
  assert.equal(facts.deriveExecutorAuthorityFacts(grant).canonicalRunFingerprint, a.canonicalRunFingerprint);
});
test("malformed/noncanonical/cancelled/scope-inconsistent Run or denied approval cannot establish authority", () => {
  const c = executorConfiguration();
  for (const configuration of [null, {}, { ...c, extra: true }, { ...c, developmentRun: { ...c.developmentRun, currentAttemptNumber: 2 } },
    { ...c, developmentRun: { ...c.developmentRun, ignored: true } }, { ...c, admission: { ...c.admission, taskOwnerApprovalGranted: false } },
    { ...c, developmentRun: { ...c.developmentRun, admittedAllowedPaths: ["other"] } },
    { ...c, developmentRun: transition(c.developmentRun, { type: "cancel" }) }])
    assert.throws(() => facts.deriveExecutorAuthorityFacts(configuration), { message: "invalid_executor_authority_configuration" });
});
test("hostile getters/proxies/cycles/oversized values fail closed without traps or raw messages", () => {
  let touched = 0;
  const getter = Object.defineProperty({}, "developmentRun", { enumerable: true, get() { touched++; throw Error("private-canary"); } });
  const proxy = new Proxy({}, { ownKeys() { touched++; throw Error("private-canary"); } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const c of [getter, proxy, cycle, { ...executorConfiguration(), extra: "x".repeat(300000) }])
    assert.throws(() => facts.deriveExecutorAuthorityFacts(c), { message: "invalid_executor_authority_configuration" });
  assert.equal(touched, 0);
});
test("trusted authority factory rejects cloned/unbranded tenant, unknown authority fields, getters and proxies before connecting", () => {
  let touched = 0;
  const c = { database: { connect() { touched++; throw Error("private-driver"); } }, tenant: { workspaceId: "workspace-primary", workspaceDatabaseId: "forged" }, projectId: "project-a", configuration: executorConfiguration() };
  for (const value of [c, { ...c, generation: 1 }, new Proxy(c, {}), Object.defineProperty({}, "tenant", { get() { touched++; return c.tenant; } })])
    assert.throws(() => authority.createPostgresExecutorCurrentAuthorityStore(value), { message: "invalid_executor_authority_configuration" });
  assert.equal(touched, 0);
});
test("generation CAS, immutable journal, current lock and no public issuer are pinned", () => {
  const source = readFileSync(location, "utf8"), sql = readFileSync(new URL("../db/migrations/0014_executor_current_authority.sql", import.meta.url), "utf8");
  assert.match(source, /executor:authority-lock[\s\S]*?where workspace_id = \$1 and development_run_id = \$2 limit 2 for update/u);
  assert.match(source, /f\.attemptNumber !== a\.attemptNumber \+ 1/u);
  assert.match(source, /f\.predecessorRunFingerprint !== a\.canonicalRunFingerprint/u);
  assert.match(sql, /new.authority_generation <> old.authority_generation \+ 1/u);
  assert.match(sql, /deferrable initially deferred/u);
  const root = readFileSync(new URL("../lib/composition/executor-current-authority.server.ts", import.meta.url), "utf8");
  assert.match(root, /import "server-only"/u); assert.ok(!/commitProviderStart|createOpenAIAgentsTransport|fetch\(/u.test(root));
});
