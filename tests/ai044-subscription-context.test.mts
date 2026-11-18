import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { test, type TestContext } from "node:test";
const common = await import(new URL("../lib/executors/ai044-proof-binding.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-proof-binding");
const api = await import(new URL("../lib/executors/ai044-subscription-context.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-subscription-context");
const gitContext = await import(new URL("../lib/executors/ai044-subscription-git-context.ts", import.meta.url).href) as typeof import("../lib/executors/ai044-subscription-git-context");
const path = "src/server/terminal/account/analytics.ts";
function binding(readContextPaths = [path]) { return { repository: { id: common.ai044Repository, baseline: common.ai044Baseline }, projectTaskId: "project-task", planId: "plan", planRevision: 1, planFingerprint: "a".repeat(64), taskId: "task", attempt: { developmentRunId: "run", number: 1, kind: "initial" }, allowedWritePaths: ["src/server/terminal/account"], readContextPaths }; }
function object(text = "export const analytics = 1;\n", mode = "100644") { const bytes = Buffer.from(text); return { kind: "blob", mode, blobId: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), bytes }; }
function source(text?: string, mode?: string) { return api.createAI044SubscriptionContextSource({ readExactObject: async () => object(text, mode) }); }
function frozen(value: unknown) { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
test("subscription context: explicit read-only references are independent from admitted writes", async () => {
  const { allowedWritePaths: allowedPaths, ...base } = binding();
  const readContextPaths = [path, "AGENTS.md", "app/api/terminal/account/snapshot/route.ts", "src/shared/api/index.ts", "src/shared/api/rate-limit.ts"];
  const b = { ...base, allowedWritePaths: allowedPaths, readContextPaths }, before = structuredClone(b);
  const a = await source().prepare(b, readContextPaths); assert.ok(a.context);
  assert.deepEqual(a.context.binding.allowedWritePaths, allowedPaths); assert.deepEqual(a.context.orderedPaths, readContextPaths);
  assert.deepEqual(b, before); frozen(a);
  const changed = await source("different reference\n").prepare(b, readContextPaths); assert.ok(changed.context);
  assert.notEqual(a.context.fingerprint, changed.context.fingerprint);
});
test("subscription context: arbitrary path outside exact read set is blocked before object access", async () => {
  const { allowedWritePaths: allowedPaths, ...base } = binding(); let reads = 0;
  const s = api.createAI044SubscriptionContextSource({ readExactObject: async () => { reads++; return object(); } });
  const b = { ...base, allowedWritePaths: allowedPaths, readContextPaths: [path] };
  assert.ok((await s.prepare(b, [path])).context); reads = 0;
  assert.equal((await s.prepare(b, ["docs/unapproved-reference.md"])).context, null); assert.equal(reads, 0);
});
test("subscription context: changing read set changes fingerprint without expanding immutable write scope", async () => {
  const b = binding(), paths = [path, "docs/architecture.md"], expanded = { ...b, readContextPaths: paths };
  const a = await source().prepare(b, [path]), c = await source().prepare(expanded, paths); assert.ok(a.context); assert.ok(c.context);
  assert.notEqual(a.context.fingerprint, c.context.fingerprint); assert.deepEqual(a.context.binding.allowedWritePaths, c.context.binding.allowedWritePaths);
  assert.deepEqual(b.readContextPaths, [path]); assert.deepEqual(c.context.binding.readContextPaths, paths);
  const manifest = api.ai044SubscriptionContextManifest(c.context); assert.ok(manifest); assert.deepEqual(api.normalizeAI044SubscriptionContextManifest(manifest), manifest);
  const bad = structuredClone(manifest); (bad.binding.readContextPaths as string[]).reverse();
  const facts = { binding: bad.binding, orderedPaths: bad.orderedPaths, aggregateBytes: bad.aggregateBytes, files: bad.files };
  (bad as { fingerprint: string }).fingerprint = common.ai044Fingerprint(facts);
  assert.equal(api.normalizeAI044SubscriptionContextManifest(bad), null, "a matching digest never repairs contradictory read metadata");
});
test("subscription context: exact object snapshot binds plan/task/attempt, is fresh, immutable and deterministic", async () => {
  const b = binding(), before = structuredClone(b), s = source(), a = await s.prepare(b, [path]), c = await s.prepare(b, [path]);
  assert.equal(a.verdict, "allow"); assert.ok(a.context); assert.deepEqual(a, c); assert.notEqual(a.context, c.context); assert.equal(a.context.binding.repository.baseline, common.ai044Baseline); assert.equal(api.isAI044SubscriptionContext(a.context), true); assert.equal(api.isAI044SubscriptionContext(structuredClone(a.context)), false); frozen(a); assert.deepEqual(b, before);
});
test("subscription context: captures exact caller path order and does not mutate provider bytes", async () => {
  const raw = object(), before = Buffer.from(raw.bytes), s = api.createAI044SubscriptionContextSource({ readExactObject: async () => raw });
  const paths = [path, "src/server/terminal/account/second.ts"], a = await s.prepare(binding(paths), paths), b = await s.prepare(binding([...paths].reverse()), [...paths].reverse());
  assert.ok(a.context); assert.ok(b.context); assert.deepEqual(a.context.orderedPaths, paths); assert.notEqual(a.context.fingerprint, b.context.fingerprint); assert.deepEqual(raw.bytes, before); assert.deepEqual(paths, [path, "src/server/terminal/account/second.ts"]);
});
test("subscription context: explicit absence is not an invented empty blob", async () => {
  const a = await api.createAI044SubscriptionContextSource({ readExactObject: async () => ({ kind: "absent" }) }).prepare(binding(), [path]);
  assert.equal(a.context?.files[0].kind, "absent"); assert.equal(a.context?.files[0].text, null); assert.equal(a.context?.aggregateBytes, 0);
});
for (const [label, change] of [
  ["baseline", (b: ReturnType<typeof binding>) => { b.repository.baseline = "invalid-baseline" as typeof b.repository.baseline; }],
  ["repository", (b: ReturnType<typeof binding>) => { b.repository.id = "../invalid repository" as typeof b.repository.id; }],
  ["attempt", (b: ReturnType<typeof binding>) => { b.attempt.number = 4; }],
  ["paths", (b: ReturnType<typeof binding>) => { b.allowedWritePaths = ["src/scanner"]; }],
] as const) test(`subscription context: wrong ${label} denies before object read`, async () => {
  let calls = 0; const b = binding(); change(b); const a = await api.createAI044SubscriptionContextSource({ readExactObject: async () => { calls++; return object(); } }).prepare(b, [path]); assert.equal(a.context, null); assert.equal(calls, 0);
});
for (const denied of ["src/scanner/a.ts", "src/server/terminal/account/.env", "src/server/terminal/account/secrets.json", "src/server/terminal/account/../a.ts", "src/server/terminal/account/scanner/a.ts", "package.json"]) test(`subscription context: denied path ${denied}`, async () => { assert.equal((await source().prepare(binding(), [denied])).context, null); });
for (const [label, text, mode] of [["symlink", "target", "120000"], ["submodule", "commit", "160000"], ["binary", "a\0b", "100644"], ["secret", "const password = 'private';", "100644"], ["file bound", "x".repeat(256 * 1024 + 1), "100644"]] as const) test(`subscription context: ${label} denied without partial data`, async () => { const a = await source(text, mode).prepare(binding(), [path]); assert.equal(a.context, null); assert.equal(JSON.stringify(a).includes("private"), false); });
test("subscription context:20 item /1MiB aggregate boundaries are explicit", async () => {
  const paths = (n: number) => Array.from({ length: n }, (_, i) => `src/server/terminal/account/a${i}.ts`);
  assert.ok((await source().prepare(binding(paths(20)), paths(20))).context);
  assert.equal((await source().prepare(binding(paths(21)), paths(21))).context, null);
  assert.ok((await source("x".repeat(256 * 1024)).prepare(binding(paths(4)), paths(4))).context);
  assert.equal((await source("x".repeat(256 * 1024)).prepare(binding(paths(5)), paths(5))).context, null);
});
test("subscription context: wrong blob hash, throwing port, hostile accessor/proxy fail closed", async () => {
  const wrong = object(); wrong.blobId = "0".repeat(40); assert.equal((await api.createAI044SubscriptionContextSource({ readExactObject: async () => wrong }).prepare(binding(), [path])).context, null);
  assert.equal((await api.createAI044SubscriptionContextSource({ readExactObject: async () => { throw Error("private provider detail"); } }).prepare(binding(), [path])).context, null);
  let reads = 0; const hostile = { get repository() { reads++; throw Error("private"); } }; assert.equal((await source().prepare(hostile, [path])).context, null); assert.equal((await source().prepare(new Proxy({}, { ownKeys() { reads++; throw Error("private"); } }), [path])).context, null); assert.equal(reads, 0);
});
test("subscription context: durable manifest contains no source text, rehashes metadata and grants no source provenance", async () => {
  const allowed = await source().prepare(binding(), [path]); assert.ok(allowed.context);
  const manifest = api.ai044SubscriptionContextManifest(allowed.context); assert.ok(manifest); assert.equal(JSON.stringify(manifest).includes("export const analytics"), false);
  const normalized = api.normalizeAI044SubscriptionContextManifest(manifest); assert.deepEqual(normalized, manifest); assert.equal(api.isAI044SubscriptionContext(normalized), false);
  for (const field of ["aggregateBytes", "fingerprint", "byteCount", "orderedPath", "binding"] as const) {
    const altered: NonNullable<typeof manifest> = structuredClone(manifest);
    if (field === "aggregateBytes") (altered as { aggregateBytes: number }).aggregateBytes++;
    else if (field === "fingerprint") (altered as { fingerprint: string }).fingerprint = "0".repeat(64);
    else if (field === "byteCount") (altered.files[0] as { byteCount: number }).byteCount++;
    else if (field === "orderedPath") (altered.orderedPaths as string[])[0] = "src/server/terminal/account/other.ts";
    else (altered.binding as { taskId: string }).taskId = "other";
    assert.equal(api.normalizeAI044SubscriptionContextManifest(altered), null);
  }
});

/** Test-only loose Git objects: no add/commit/worktree/provider command is executed. */
async function gitObjects(t: TestContext, ancestorMode = "40000", fileMode = "100644") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pac-subscription-context-")));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, ".git", "objects"), { recursive: true }); await mkdir(join(root, ".git", "refs", "heads"), { recursive: true });
  await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n"); await writeFile(join(root, ".git", "config"), "[core]\nrepositoryformatversion = 0\nbare = false\n");
  const writeObject = async (kind: string, bytes: Buffer) => {
    const contents = Buffer.concat([Buffer.from(`${kind} ${bytes.length}\0`), bytes]), id = createHash("sha1").update(contents).digest("hex");
    await mkdir(join(root, ".git", "objects", id.slice(0, 2)), { recursive: true }); await writeFile(join(root, ".git", "objects", id.slice(0, 2), id.slice(2)), deflateSync(contents)); return id;
  };
  const treeEntry = (mode: string, name: string, id: string) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(id, "hex")]);
  const blob = await writeObject("blob", Buffer.from("frozen object\n"));
  let tree = await writeObject("tree", treeEntry(fileMode, "analytics.ts", blob));
  for (const name of ["account", "terminal", "server", "src"]) tree = await writeObject("tree", treeEntry(name === "account" ? ancestorMode : "40000", name, name === "account" && ancestorMode !== "40000" ? blob : tree));
  const baseline = await writeObject("commit", Buffer.from(`tree ${tree}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n`));
  await writeFile(join(root, ".git", "refs", "heads", "main"), `${baseline}\n`);
  await mkdir(join(root, "src/server/terminal/account"), { recursive: true }); await writeFile(join(root, path), "mutable checkout is not context\n");
  return { root, baseline, blob, reader: gitContext.createAI044SubscriptionGitObjectReader({ repositoryRoot: root, repositoryId: common.ai044Repository }) };
}
test("subscription context Git reader: frozen object bytes are independent from mutable checkout; exact absence", async t => {
  const f = await gitObjects(t), request = { repositoryId: common.ai044Repository, baseline: f.baseline, path };
  const a = await f.reader.readExactObject(request) as { kind: string; bytes: Buffer; blobId: string };
  assert.equal(a.kind, "blob"); assert.equal(a.bytes.toString(), "frozen object\n"); assert.equal(a.blobId, f.blob); assert.equal(await readFile(join(f.root, path), "utf8"), "mutable checkout is not context\n");
  const b = await f.reader.readExactObject(request); assert.deepEqual(a, b);
  assert.deepEqual(await f.reader.readExactObject({ ...request, path: "src/server/terminal/account/new.ts" }), { kind: "absent" });
  await assert.rejects(f.reader.readExactObject({ ...request, baseline: "f".repeat(40) }));
});
for (const mode of ["120000", "160000"]) test(`subscription context Git reader: ${mode} ancestor cannot masquerade as absent child`, async t => {
  const f = await gitObjects(t, mode); await assert.rejects(f.reader.readExactObject({ repositoryId: common.ai044Repository, baseline: f.baseline, path: "src/server/terminal/account/new.ts" }));
});
test("subscription context Git reader: symlink leaf and external alternate object stores denied", async t => {
  const f = await gitObjects(t, "40000", "120000"); await assert.rejects(f.reader.readExactObject({ repositoryId: common.ai044Repository, baseline: f.baseline, path }));
  const g = await gitObjects(t); await mkdir(join(g.root, ".git", "objects", "info")); await writeFile(join(g.root, ".git", "objects", "info", "alternates"), "/not-authorized\n");
  await assert.rejects(g.reader.readExactObject({ repositoryId: common.ai044Repository, baseline: g.baseline, path }));
});
test("subscription context Git reader: partial-clone lazy fetch cannot invoke even a locally permitted remote helper", async t => {
  const f = await gitObjects(t), marker = join(f.root, "remote-helper-was-called");
  await rm(join(f.root, ".git", "objects", f.blob.slice(0, 2), f.blob.slice(2)));
  await writeFile(join(f.root, ".git", "config"), `[core]\nrepositoryformatversion = 0\nbare = false\n[extensions]\npartialClone = origin\n[remote "origin"]\nurl = ext::/usr/bin/touch ${marker}\npromisor = true\npartialclonefilter = blob:none\n[protocol "ext"]\nallow = always\n`);
  await assert.rejects(f.reader.readExactObject({ repositoryId: common.ai044Repository, baseline: f.baseline, path }));
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});
test("subscription context: pure manifest graph never imports physical filesystem or process reader", async () => {
  const source = await readFile(new URL("../lib/executors/ai044-subscription-context.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:fs|child_process|path)|from\s+["'][^"']*ai044-subscription-git-context/u);
  assert.equal("createAI044SubscriptionGitObjectReader" in api, false);
});
