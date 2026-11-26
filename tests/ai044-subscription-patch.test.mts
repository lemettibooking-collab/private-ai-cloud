import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
const api = await import(new URL("../lib/executors/ai044-subscription-patch.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-subscription-patch");
const contexts = await import(new URL("../lib/executors/ai044-subscription-context.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-subscription-context");
const common = await import(new URL("../lib/executors/ai044-proof-binding.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-proof-binding");
const path = "src/server/terminal/account/analytics.ts";
async function context(text: string | null = "old\n") {
  const source = contexts.createAI044SubscriptionContextSource({ readExactObject: async () => { if (text === null) return { kind: "absent" }; const bytes = Buffer.from(text); return { kind: "blob", mode: "100644", blobId: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), bytes }; } });
  const result = await source.prepare({ repository: { id: common.ai044Repository, baseline: common.ai044Baseline }, projectTaskId: "project-task", planId: "plan", planRevision: 1, planFingerprint: "a".repeat(64), taskId: "task", attempt: { developmentRunId: "run", number: 1, kind: "initial" }, allowedWritePaths: ["src/server/terminal/account"], readContextPaths: [path] }, [path]); assert.ok(result.context); return result.context;
}
function proposal(kind: "modify" | "add" | "delete" = "modify") { return { patch: `diff --git a/${path} b/${path}\n${kind === "modify" ? "" : kind === "add" ? "new file mode 100644\n" : "deleted file mode 100644\n"}--- ${kind === "add" ? "/dev/null" : `a/${path}`}\n+++ ${kind === "delete" ? "/dev/null" : `b/${path}`}\n${kind === "modify" ? "@@ -1,1 +1,1 @@\n-old\n+new\n" : kind === "add" ? "@@ -0,0 +1,1 @@\n+new\n" : "@@ -1,1 +0,0 @@\n-old\n"}`, changedPaths: [path], summary: "Prepared read-only analytics proposal; independent local review is required." }; }
for (const kind of ["modify", "add", "delete"] as const) test(`subscription patch: exact ${kind} produces unverified ExecutorAdapter changes`, async () => {
  const c = await context(kind === "add" ? null : "old\n"), p = proposal(kind), before = structuredClone(p), a = api.validateAI044SubscriptionPatch(c, p), b = api.validateAI044SubscriptionPatch(c, p);
  assert.equal(a.verdict, "allow"); assert.ok(a.proposal); assert.equal(a.proposal.changes[0].operation, kind); assert.equal(a.proposal.changes[0].content, kind === "delete" ? null : "new\n"); assert.equal(a.proposal.verificationStatus, "not_run"); assert.equal(a.proposal.ownerDecisionRequired, true); assert.equal(a.proposal.automaticRetryAllowed, false); assert.deepEqual(a, b); assert.notEqual(a.proposal, b.proposal); assert.ok(Object.isFrozen(a.proposal.changes[0])); assert.deepEqual(p, before);
});
test("subscription patch: fake/cloned context cannot manufacture exact-object provenance", async () => { const c = await context(); assert.equal(api.validateAI044SubscriptionPatch(structuredClone(c), proposal()).proposal, null); });
test("subscription patch: changed context byte, wrong line offset or missing file never fuzz applies", async () => {
  assert.equal(api.validateAI044SubscriptionPatch(await context("different\n"), proposal()).proposal, null);
  const p = proposal(); p.patch = p.patch.replace("@@ -1,1 +1,1 @@", "@@ -2,1 +2,1 @@"); assert.equal(api.validateAI044SubscriptionPatch(await context(), p).proposal, null);
  assert.equal(api.validateAI044SubscriptionPatch(await context(null), proposal()).proposal, null); assert.equal(api.validateAI044SubscriptionPatch(await context(), proposal("add")).proposal, null);
});
for (const [label, mutate] of [
  ["manifest", (p: ReturnType<typeof proposal>) => { p.changedPaths = ["src/server/terminal/account/other.ts"]; }],
  ["secret", (p: ReturnType<typeof proposal>) => { p.summary = "password = private-output"; }],
  ["no meaningful summary", (p: ReturnType<typeof proposal>) => { p.summary = " "; }],
  ["selfQA", (p: ReturnType<typeof proposal>) => { p.summary = "All tests passed; verification passed."; }],
  ["binary", (p: ReturnType<typeof proposal>) => { p.patch = p.patch.replace("@@ -1,1 +1,1 @@", "GIT binary patch"); }],
  ["no newline marker", (p: ReturnType<typeof proposal>) => { p.patch += "\\ No newline at end of file\n"; }],
  ["bad output offset", (p: ReturnType<typeof proposal>) => { p.patch = p.patch.replace("+1,1 @@", "+2,1 @@"); }],
  ["forbidden package", (p: ReturnType<typeof proposal>) => { p.patch = p.patch.replaceAll("analytics.ts", "package.json"); }],
  ["Scanner", (p: ReturnType<typeof proposal>) => { p.patch = p.patch.replaceAll(path, "src/scanner/worker.ts"); p.changedPaths = ["src/scanner/worker.ts"]; }],
] as const) test(`subscription patch: ${label} fails closed without leaked output`, async () => { const p = proposal(); mutate(p); const a = api.validateAI044SubscriptionPatch(await context(), p); assert.equal(a.proposal, null); assert.equal(JSON.stringify(a).includes("private-output"), false); });
test("subscription patch: hostile objects do not execute accessors or proxy traps", async () => { let reads = 0; const c = await context(); assert.equal(api.validateAI044SubscriptionPatch(c, { get patch() { reads++; throw Error("private"); } }).proposal, null); assert.equal(api.validateAI044SubscriptionPatch(c, new Proxy({}, { ownKeys() { reads++; throw Error("private"); } })).proposal, null); assert.equal(reads, 0); });
test("subscription patch: exact multi-hunk offsets retain unchanged baseline bytes", async () => {
  const c = await context("first\nold\nthird\nold\nlast\n"), p = proposal();
  p.patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -2,1 +2,1 @@\n-old\n+second\n@@ -4,1 +4,1 @@\n-old\n+fourth\n`;
  assert.equal(api.validateAI044SubscriptionPatch(c, p).proposal?.changes[0].content, "first\nsecond\nthird\nfourth\nlast\n");
});
test("subscription patch:1200 changed lines accepted,1201 denied;12 files accepted,13 denied", async () => {
  const c = await context(null), p = proposal("add");
  const added = (count: number) => `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${count} @@\n${Array.from({ length: count }, () => "+line").join("\n")}\n`;
  p.patch = added(1200); assert.equal(api.validateAI044SubscriptionPatch(c, p).verdict, "allow"); p.patch = added(1201); assert.equal(api.validateAI044SubscriptionPatch(c, p).proposal, null);
  const files = Array.from({ length: 13 }, (_, i) => `src/server/terminal/account/file${i}.ts`), source = contexts.createAI044SubscriptionContextSource({ readExactObject: async () => ({ kind: "absent" }) });
  const result = await source.prepare({ ...c.binding, readContextPaths: files }, files); assert.ok(result.context);
  const patchFor = (file: string) => proposal("add").patch.replaceAll(path, file);
  const many = { patch: files.slice(0, 12).map(patchFor).join(""), changedPaths: files.slice(0, 12), summary: p.summary };
  assert.equal(api.validateAI044SubscriptionPatch(result.context, many).verdict, "allow"); many.patch += patchFor(files[12]); many.changedPaths.push(files[12]); assert.equal(api.validateAI044SubscriptionPatch(result.context, many).proposal, null);
});
test("subscription patch: changed existing file must have supplied exact-object context", async () => {
  const p = proposal(); p.patch = p.patch.replaceAll(path, "src/server/terminal/account/not-supplied.ts"); p.changedPaths = ["src/server/terminal/account/not-supplied.ts"];
  assert.equal(api.validateAI044SubscriptionPatch(await context(), p).proposal, null);
});
test("subscription patch: read-only reference cannot be patched even when present in exact context", async () => {
  const writable = "src/features/liquidity/drawer.ts";
  for (const reference of ["AGENTS.md", "app/api/terminal/account/snapshot/route.ts", "src/shared/api/index.ts", "src/shared/api/rate-limit.ts"]) {
    const c = await context(), before = ["src/features/liquidity"];
    const source = contexts.createAI044SubscriptionContextSource({ readExactObject: async () => {
      const bytes = Buffer.from("old\n"); return { kind: "blob", mode: "100644", blobId: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), bytes };
    } });
    const b = { ...c.binding, repository: { id: "feature-repository", baseline: "b".repeat(40) }, allowedWritePaths: before, readContextPaths: [writable, reference] };
    const prepared = await source.prepare(b, b.readContextPaths); assert.ok(prepared.context);
    const p = proposal(); p.patch = p.patch.replaceAll(path, writable); p.changedPaths = [writable];
    assert.equal(api.validateAI044SubscriptionPatch(prepared.context, p).verdict, "allow", "admitted FeaturePlan write outside cancelled feature envelope remains valid");
    p.patch = p.patch.replaceAll(writable, reference); p.changedPaths = [reference];
    assert.equal(api.validateAI044SubscriptionPatch(prepared.context, p).proposal, null, "read provenance is never write authority");
    p.patch = p.patch.replaceAll(reference, "docs/not-admitted.md"); p.changedPaths = ["docs/not-admitted.md"];
    assert.equal(api.validateAI044SubscriptionPatch(prepared.context, p).proposal, null);
    assert.deepEqual(prepared.context.binding.allowedWritePaths, before); assert.deepEqual(before, ["src/features/liquidity"]);
  }
});
