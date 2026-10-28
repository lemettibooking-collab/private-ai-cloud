import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createOwnerAI044Proof, normalizeOwnerAI044ProofPolicy, ownerAI044ProofInput } from "../lib/composition/owner-ai044-proof.ts";
import type { OwnerAI044ProofDependencies } from "../lib/composition/owner-ai044-proof";

const policy = { projectId: "project-a", projectTaskId: "task-a", developmentRunId: "run-a", planRevision: 1, planFingerprint: "a".repeat(64),
  repository: { id: "future-feature", baseline: "b".repeat(40) }, repositoryRoot: "/tmp/owner-trusted-repo",
  repositoryAllowlist: ["src/feature"], readContextPaths: ["src/feature/new.ts", "src/reference.ts"] };
function form(action = "prepare") {
  const f = new FormData(); f.set("action", action); f.set("selection", "a".repeat(64));
  if (action === "prepare") { f.set("registration", "b".repeat(64)); f.set("model", "selected-test-model"); f.set("appLimitPercent", "50"); f.set("confirmed", "on"); }
  return f;
}
test("Owner proof: form permits only exact action/selection and manual bounded attestation", () => {
  assert.ok(ownerAI044ProofInput(form()));
  for (const action of ["request", "approve", "reject", "invoke"]) assert.deepEqual(ownerAI044ProofInput(form(action)), { action, selection: "a".repeat(64), attestation: null });
});
for (const key of ["ownerUserId", "workspaceId", "projectId", "configuration", "intent", "approvalRequestId", "repositoryRoot", "preflight", "accessToken"]) {
  test(`Owner proof: browser ${key} cannot become authority`, () => { const f = form(); f.set(key, "forged"); assert.equal(ownerAI044ProofInput(f), null); });
}
test("Owner proof: duplicate, missing, oversized, file, unknown action and unconfirmed/full-limit forms deny", () => {
  for (const change of [(f: FormData) => f.append("selection", "b".repeat(64)), (f: FormData) => f.delete("confirmed"),
    (f: FormData) => f.set("model", "x".repeat(257)), (f: FormData) => f.set("model", new Blob(["private"])),
    (f: FormData) => f.set("action", "run-any"), (f: FormData) => f.set("appLimitPercent", "100"),
    (f: FormData) => { for (let n = 0; n < 33; n++) f.append(`$ACTION_${n}`, ""); }]) {
    const f = form(); change(f); assert.equal(ownerAI044ProofInput(f), null);
  }
});
test("Owner proof: trusted policy is bounded, fresh, frozen and target neutral; references do not widen writes", () => {
  const before = structuredClone(policy), p = normalizeOwnerAI044ProofPolicy(policy);
  assert.deepEqual(policy, before); assert.notEqual(p, policy); assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.readContextPaths));
  assert.deepEqual(p.repositoryAllowlist, ["src/feature"]); assert.ok(!p.repositoryAllowlist.includes("src/reference.ts"));
});
for (const [name, change] of [
  ["extra enable flag", (p: Record<string, unknown>) => { p.enabled = true; }],
  ["mutable baseline", (p: Record<string, unknown>) => { p.repository = { id: "feature", baseline: "HEAD" }; }],
  ["too many paths", (p: Record<string, unknown>) => { p.readContextPaths = Array.from({ length: 21 }, (_, i) => `src/${i}.ts`); }],
  ["duplicate paths", (p: Record<string, unknown>) => { p.readContextPaths = ["src/a.ts", "src/a.ts"]; }],
  ["credential path", (p: Record<string, unknown>) => { p.readContextPaths = [".env.local"]; }],
  ["package path", (p: Record<string, unknown>) => { p.readContextPaths = ["package.json"]; }],
] as const) test(`Owner proof: rejects ${name}`, () => { const p = structuredClone(policy); change(p); assert.throws(() => normalizeOwnerAI044ProofPolicy(p)); });
test("Owner proof: hostile getter/proxy cannot create a configured bridge", () => {
  let touched = 0; const p = { ...policy }; Object.defineProperty(p, "projectId", { get() { touched++; throw Error("private"); } });
  assert.throws(() => normalizeOwnerAI044ProofPolicy(p)); assert.equal(touched, 0);
  assert.throws(() => normalizeOwnerAI044ProofPolicy(new Proxy(policy, { get() { touched++; throw Error("private"); } }))); assert.equal(touched, 0);
});
test("Owner proof: unauthenticated action/read performs zero business/context/facts/provider reads", async () => {
  let touched = 0;
  const proof = createOwnerAI044Proof({ policy, domainWorkspaceId: "workspace-primary", identitySource: { resolve: () => null },
    database: { connect: async () => { touched++; throw Error("must not read"); } }, clock: Date.now,
    readSubscriptionFacts: async () => { touched++; return null; },
    preparation: () => { touched++; throw Error("must not prepare"); }, execution: () => { touched++; throw Error("must not compose"); } } satisfies OwnerAI044ProofDependencies);
  assert.deepEqual(await proof.load(), { status: "unavailable" });
  for (const action of ["prepare", "request", "approve", "reject", "invoke"]) assert.deepEqual(await proof.act({ action, selection: "a".repeat(64), attestation: null }), { status: "unavailable" });
  assert.equal(touched, 0);
});
test("Owner proof: page/action uses narrow authenticated root only, separate explicit actions, no serialized capability or secret", async () => {
  const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [action, server, component, root] = await Promise.all([read("app/workflows/development-execution/proof/actions.ts"), read("lib/composition/owner-ai044-proof.server.ts"),
    read("components/domain/owner-console/ai044-production-proof.tsx"), read("lib/composition/ai044-subscription-run.server.ts")]);
  assert.ok(action.startsWith('"use server";')); assert.ok(server.startsWith('import "server-only";'));
  assert.ok(server.includes("resolveSessionOwner")); assert.ok(server.includes("createOwnerAI044SubscriptionRun"));
  for (const phase of ["prepare", "request", "approve", "reject", "invoke"]) assert.ok(component.includes(`button("${phase}"`));
  assert.equal(/useEffect|setInterval|autoFocus|requestSubmit/u.test(component), false);
  assert.equal(/accessToken|refreshToken|DATABASE_URL|repositoryRoot|startCapability/u.test(component), false);
  assert.ok(root.includes("normalizeExecutorControllerBinding(input.controllerBinding)"));
  assert.ok(component.includes("{c.footer}"));
});
test("Owner proof: RU/EN presentation has exact key/phase parity; locale never enters authority", async () => {
  const { ai044ProofCopy } = await import(new URL("../lib/i18n/ai044-proof-copy.ts", import.meta.url).href) as typeof import("../lib/i18n/ai044-proof-copy");
  assert.deepEqual(Object.keys(ai044ProofCopy.ru), Object.keys(ai044ProofCopy.en)); assert.deepEqual(Object.keys(ai044ProofCopy.ru.phases), Object.keys(ai044ProofCopy.en.phases));
  for (const [key, value] of Object.entries(ai044ProofCopy.ru)) if (typeof value === "string") { assert.ok(value.trim()); assert.notEqual(value, ai044ProofCopy.en[key as keyof typeof ai044ProofCopy.en]); }
  const core = await readFile(new URL("../lib/composition/owner-ai044-proof.ts", import.meta.url), "utf8");
  assert.equal(/i18n|pac_locale|parseLocale|ai044ProofCopy/u.test(core), false);
});
