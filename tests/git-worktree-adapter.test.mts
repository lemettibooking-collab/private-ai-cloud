import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { fixture, FixtureStorage, fileIdentity, frozen, denied, git } from "./fixtures/git-worktree.mts";
const moduleUrl = new URL("../lib/sandbox/git-worktree-adapter.ts", import.meta.url);
const { createGitWorktreeAdapter } = await import(moduleUrl.href) as typeof import("../lib/sandbox/git-worktree-adapter");
const adapter = (f: Awaited<ReturnType<typeof fixture>>) => createGitWorktreeAdapter({ sandboxRoot: f.sandboxRoot, storage: f.storage });

test("real Git: exact baseline, detached execution identity, dirty primary/index/HEAD untouched", async t => {
  const f = await fixture(t), a = await adapter(f);
  await writeFile(join(f.repositoryRoot, "src/a.txt"), "staged change\n"); await git(f.repositoryRoot, "add", "src/a.txt");
  await writeFile(join(f.repositoryRoot, "untracked.txt"), "private developer change\n");
  const before = await git(f.repositoryRoot, "status", "--porcelain=v1"), index = await readFile(join(f.repositoryRoot, ".git/index"));
  const op = f.operation(), untouched = structuredClone(op), d = await a.create(op);
  assert.equal(d.verdict, "allow", JSON.stringify(d)); assert.equal(d.status, "ready"); assert.ok(d.resource);
  assert.equal(d.resource.actualHead, f.baseline); assert.equal(await git(d.resource.path, "rev-parse", "HEAD"), f.baseline);
  assert.equal(await readFile(join(d.resource.path, "src/a.txt"), "utf8"), "baseline\n");
  assert.match(d.resource.executionRef, /^detached:[a-f0-9]{64}$/u);
  assert.equal(await git(f.repositoryRoot, "symbolic-ref", "HEAD"), "refs/heads/main");
  assert.equal(await git(f.repositoryRoot, "rev-parse", "HEAD"), f.later);
  assert.equal(await git(f.repositoryRoot, "status", "--porcelain=v1"), before); assert.deepEqual(await readFile(join(f.repositoryRoot, ".git/index")), index);
  assert.deepEqual(op, untouched); assert.equal(d.runtimeDispatchAllowed, false); frozen(d);
  assert.deepEqual(d.evidence.map(e => e.kind), ["create_requested", "repository_validated", "baseline_validated", "worktree_created", "head_verified", "resource_ready"]);
});
test("M6 exact replay is fresh, frozen and has exactly one factual worktree", async t => {
  const f = await fixture(t), a = await adapter(f), first = await a.create(f.operation()), replay = await a.create(f.operation());
  assert.equal(replay.status, "idempotent"); assert.deepEqual(replay.resource, first.resource); assert.notEqual(replay.resource, first.resource); frozen(replay);
  assert.equal((await git(f.repositoryRoot, "worktree", "list", "--porcelain")).split("worktree ").length - 1, 2);
  assert.deepEqual(await a.create(f.operation()), replay);
});
test("separate worker adapters/ports cannot create two resources concurrently", async t => {
  const f = await fixture(t), a = await adapter(f), b = await createGitWorktreeAdapter({ sandboxRoot: f.sandboxRoot, storage: new FixtureStorage(f.storePath) });
  const decisions = await Promise.all([a.create(f.operation()), b.create(f.operation())]);
  assert.equal(decisions.filter(d => d.verdict === "allow").length, 1); assert.equal((await f.storage.records()).length, 1);
  assert.equal((await git(f.repositoryRoot, "worktree", "list", "--porcelain")).split("worktree ").length - 1, 2);
});
test("M1 dedicated root cannot overlap primary checkout", async t => {
  const f = await fixture(t), nested = join(f.repositoryRoot, "unsafe-sandbox"); await mkdir(nested, { mode: 0o700 });
  const a = await createGitWorktreeAdapter({ sandboxRoot: nested, storage: f.storage });
  denied(await a.create(f.operation()), "path_invalid"); assert.equal((await f.storage.records()).length, 0);
});
test("root cannot be broad, symlinked, world accessible or replaced", async t => {
  const f = await fixture(t), link = join(f.temp, "root-link"); await symlink(f.sandboxRoot, link);
  await assert.rejects(createGitWorktreeAdapter({ sandboxRoot: "/", storage: f.storage }));
  await assert.rejects(createGitWorktreeAdapter({ sandboxRoot: link, storage: f.storage }));
  await chmod(f.sandboxRoot, 0o755); await assert.rejects(adapter(f)); await chmod(f.sandboxRoot, 0o700);
  const a = await adapter(f); await rename(f.sandboxRoot, `${f.sandboxRoot}-old`); await mkdir(f.sandboxRoot, { mode: 0o700 });
  denied(await a.create(f.operation()), "path_invalid");
});
test("hostile caller path/ref/options fields and identifiers are rejected without reading authority", async t => {
  const f = await fixture(t), a = await adapter(f); let reads = 0; f.storage.contextHook = async () => { reads++; };
  for (const value of ["../escape", "-option", "x;touch-bad", "x\nmain", "x~2", "x@{0}"]) denied(await a.create({ ...f.operation(), executionId: value }), "identity_conflict");
  for (const field of ["path", "branch", "command"]) denied(await a.cleanup({ ...f.operation(), [field]: "/tmp/foreign" }));
  const accessor = { ...f.operation(), get surprise() { throw new Error("raw-canary"); } }; denied(await a.create(accessor));
  denied(await a.create(new Proxy(f.operation(), { ownKeys() { throw new Error("raw-canary"); } })));
  assert.equal(reads, 0);
});
test("unknown project/repository, registry root/common identity mismatch fail closed", async t => {
  const f = await fixture(t), a = await adapter(f), original = await f.storage.contextData();
  for (const change of [
    (d: typeof original) => { d.repository = null; },
    (d: typeof original) => { d.repository = { ...d.repository!, projectId: "foreign" }; },
    (d: typeof original) => { d.repository = { ...d.repository!, repositoryId: "foreign" }; },
    (d: typeof original) => { d.repository = { ...d.repository!, rootIdentity: { device: 0, inode: 1 } }; },
    (d: typeof original) => { d.repository = { ...d.repository!, commonIdentity: { device: 0, inode: 1 } }; },
  ]) { await writeFile(join(f.storePath, "context.json"), JSON.stringify(original)); await f.storage.changeContext(change); denied(await a.create(f.operation()), "repository_invalid"); }
});
test("missing local immutable baseline is blocked, with no implicit fetch or HEAD fallback", async t => {
  const f = await fixture(t), a = await adapter(f);
  // The admitted commit becomes unavailable (simulated local object loss).
  await rm(join(f.repositoryRoot, ".git/objects", f.baseline.slice(0, 2), f.baseline.slice(2)));
  denied(await a.create(f.operation()), "baseline_missing"); assert.equal((await f.storage.records()).length, 0);
});
test("M5 protected execution branch remains denied even if historical domain admission was valid", async t => {
  const f = await fixture(t), a = await adapter(f);
  await f.storage.changeContext(d => { d.repository = { ...d.repository!, protectedBranches: ["main", "sandbox/exec-a"] }; });
  denied(await a.create(f.operation()), "worktree_conflict"); assert.equal(await git(f.repositoryRoot, "rev-parse", "main"), f.later);
});
test("M8 stale/revoked/expired/wrong-owner authority cannot create", async t => {
  const f = await fixture(t), a = await adapter(f), original = await f.storage.contextData();
  for (const fields of [{ active: false }, { expiresAt: 999 }, { actorId: "other-worker" }, { generation: 2 }, { now: 500000 }]) {
    await writeFile(join(f.storePath, "context.json"), JSON.stringify(original));
    await f.storage.changeContext(d => { d.authority = { ...d.authority, ...fields }; });
    denied(await a.create(f.operation()), "stale_authority");
  }
  assert.equal((await f.storage.records()).length, 0);
});
test("current policy revocation rejects create replay; cleanup-only authority cannot create", async t => {
  const f = await fixture(t), a = await adapter(f); assert.equal((await a.create(f.operation())).verdict, "allow");
  await f.storage.changeContext(d => { d.config = { ...d.config, grants: [] }; }); denied(await a.create(f.operation()), "stale_authority");
  const op = await f.cleanupContext(true); denied(await a.create(op), "stale_authority");
  assert.equal((await a.cleanup(op)).verdict, "allow");
});
test("duplicate conflicting fingerprint, stale revision/fence and forged snapshot never produce partial output", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation());
  for (const fields of [{ specFingerprint: "c".repeat(64) }, { expectedRevision: 2 }, { fence: 0 }]) denied(await a.create({ ...f.operation(), ...fields }));
  await f.storage.changeContext(d => { d.snapshot = { ...d.snapshot, state: "ready" }; }); denied(await a.create(f.operation()), "stale_authority");
});
test("local external filters/includes/object alternates are refused; no hook executes", async t => {
  const f = await fixture(t), a = await adapter(f), config = join(f.repositoryRoot, ".git/config"), original = await readFile(config, "utf8");
  for (const tail of ["\n[filter \"evil\"]\n smudge = touch /tmp/not-executed\n", "\n[include]\n path = /tmp/not-read\n", "\n[extensions]\n worktreeConfig = true\n"]) {
    await writeFile(config, original + tail); denied(await a.create(f.operation()), "repository_invalid");
  }
  await writeFile(config, original); const marker = join(f.temp, "hook-executed");
  const hook = join(f.repositoryRoot, ".git/hooks/post-checkout"); await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  assert.equal((await a.create(f.operation())).verdict, "allow"); await assert.rejects(lstat(marker));
});
test("cleanup succeeds after policy rotation, preserves cancelled outcome and is idempotent", async t => {
  const f = await fixture(t), a = await adapter(f), created = await a.create(f.operation()); assert.ok(created.resource);
  await writeFile(join(created.resource.path, "src/a.txt"), "controlled dirty fixture\n");
  const op = await f.cleanupContext(true), before = (await f.storage.contextData()).snapshot;
  const d = await a.cleanup(op); assert.equal(d.status, "removed", JSON.stringify(d)); assert.equal(d.resource?.cleanup, "completed");
  assert.equal((await a.cleanup(op)).status, "already_cleaned"); assert.deepEqual(await a.cleanup(op), await a.cleanup(op));
  assert.deepEqual((await f.storage.contextData()).snapshot, before); assert.equal(before.state, "cancelled");
  assert.equal(await git(f.repositoryRoot, "rev-parse", "main"), f.later); assert.equal(await git(f.repositoryRoot, "worktree", "list", "--porcelain").then(x => x.split("worktree ").length - 1), 1);
  assert.equal(d.runtimeDispatchAllowed, false); frozen(d);
});
test("cleanup requires factual begin-cleanup, exact identity, fingerprint, revision, fence and live owner", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); denied(await a.cleanup(f.operation()), "cleanup_identity_mismatch");
  const op = await f.cleanupContext();
  for (const change of [{ executionId: "foreign" }, { resourceGeneration: 2 }, { specFingerprint: "d".repeat(64) }, { expectedRevision: 1 }, { fence: 0 }]) denied(await a.cleanup({ ...op, ...change }));
  await f.storage.changeContext(d => { d.authority = { ...d.authority, actorId: "other-worker" }; }); denied(await a.cleanup(op));
  assert.equal((await f.storage.record()).state, "ready");
});
test("M3 cleanup rejects corrupted resource-generation metadata", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const op = await f.cleanupContext(), record = await f.storage.record();
  await f.storage.corrupt({ ...record, identity: { ...record.identity, resourceGeneration: 2 } });
  denied(await a.cleanup(op), "cleanup_identity_mismatch"); assert.ok(await lstat(record.path));
});
test("M4 cleanup never deletes arbitrary caller/store-substituted path", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const op = await f.cleanupContext(), record = await f.storage.record();
  const foreign = join(f.temp, "foreign-checkout"); await git(f.repositoryRoot, "worktree", "add", "--detach", foreign, f.baseline);
  await f.storage.corrupt({ ...record, path: foreign, directoryIdentity: await fileIdentity(foreign) });
  denied(await a.cleanup(op), "path_invalid"); assert.ok(await lstat(foreign)); assert.ok(await lstat(record.path));
});
test("cleanup rejects slot/worktree symlink escape and replaced worktree inode", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const op = await f.cleanupContext(), record = await f.storage.record();
  await rename(record.path, `${record.path}-saved`); await symlink(f.repositoryRoot, record.path);
  denied(await a.cleanup(op), "path_invalid"); await rm(record.path); await mkdir(record.path);
  denied(await a.cleanup(op), "resource_mismatch"); assert.ok(await lstat(f.repositoryRoot));
});
test("cleanup rejects a replaced generation slot even when the checkout suffix matches", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const op = await f.cleanupContext(), record = await f.storage.record();
  const slot = join(f.sandboxRoot, record.resourceId);
  await rename(slot, `${slot}-saved`); await symlink(f.temp, slot);
  denied(await a.cleanup(op), "path_invalid"); assert.ok(await lstat(f.repositoryRoot));
});
test("historical cleanup still works when project/grants are removed, never reauthorizes execution", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const op = await f.cleanupContext(true);
  await f.storage.changeContext(d => { d.config = { ...d.config, projects: [], grants: [] }; d.repository = null; });
  denied(await a.create(op), "stale_authority"); assert.equal((await a.cleanup(op)).status, "removed");
});
test("cleanup Git failure keeps discoverable removing intent and execution outcome", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const op = await f.cleanupContext(), record = await f.storage.record();
  // Git refuses a checkout containing a submodule even with a single --force.
  await writeFile(join(record.path, ".gitmodules"), "[submodule \"x\"]\n path = sub\n url = /not-used\n");
  // Deterministic controlled failure: lock worktree after prevalidation, immediately before remove.
  let reads = 0; f.storage.contextHook = async purpose => { if (purpose === "cleanup" && ++reads === 2) await git(f.repositoryRoot, "worktree", "lock", record.path); };
  denied(await a.cleanup(op), "cleanup_failure"); assert.equal((await f.storage.record()).state, "removing");
  assert.equal((await f.storage.contextData()).snapshot.state, "cancelled"); assert.ok(await lstat(record.path));
});
test("restart reconstructs matching metadata from persisted intent plus factual Git, not a Map", async t => {
  const f = await fixture(t), a = await adapter(f); const d = await a.create(f.operation()); assert.ok(d.resource);
  const restarted = await createGitWorktreeAdapter({ sandboxRoot: f.sandboxRoot, storage: new FixtureStorage(f.storePath) });
  const restored = await restarted.reconcile(f.operation()); assert.equal(restored.status, "ready"); assert.equal(restored.resource?.actualHead, f.baseline);
  assert.equal((await restarted.create(f.operation())).status, "idempotent");
  assert.deepEqual(await restarted.reconcile(f.operation()), restored);
});
test("missing/replaced factual resource is blocked, not ready after restart", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const r = await f.storage.record();
  await git(f.repositoryRoot, "worktree", "remove", "--force", r.path);
  const discovery = await a.discover(f.operation()); assert.equal(discovery.verdict, "deny"); assert.equal(discovery.reason, "resource_missing"); assert.deepEqual(discovery.resources, []);
  const d = await a.reconcile(f.operation()); denied(d, "resource_missing"); assert.equal((await f.storage.record()).state, "blocked");
});
test("M2 restart refuses actual HEAD different from immutable baseline", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const r = await f.storage.record();
  await git(r.path, "checkout", "--detach", f.later);
  denied(await a.reconcile(f.operation()), "baseline_mismatch"); assert.equal((await f.storage.record()).state, "blocked");
});
test("M7 post-create HEAD verification detects tampering and rolls back unpublished worktree", async t => {
  const f = await fixture(t), a = await adapter(f); let reads = 0;
  f.storage.contextHook = async purpose => {
    if (purpose === "create" && ++reads === 3) { const r = await f.storage.record(); await git(r.path, "checkout", "--detach", f.later); }
  };
  denied(await a.create(f.operation()), "baseline_mismatch"); const r = await f.storage.record();
  assert.equal(r.state, "blocked"); await assert.rejects(lstat(r.path));
});
test("unexpected Git worktree is an orphan, never silently adopted or removed", async t => {
  const f = await fixture(t), a = await adapter(f), unknown = join(f.sandboxRoot, "unknown-resource");
  await git(f.repositoryRoot, "worktree", "add", "--detach", unknown, f.baseline);
  const d = await a.discover(f.operation()); assert.equal(d.verdict, "allow"); assert.equal(d.orphans.length, 1); assert.equal(d.resources.length, 0);
  assert.equal(JSON.stringify(d).includes(unknown), false); denied(await a.reconcile(f.operation()), "resource_missing"); assert.ok(await lstat(unknown));
});
test("metadata write fails before Git: no physical checkout or falsely ready output", async t => {
  const f = await fixture(t), a = await adapter(f); f.storage.failSave = () => true;
  denied(await a.create(f.operation()), "storage_unavailable"); assert.equal((await f.storage.records()).length, 0);
  assert.equal((await git(f.repositoryRoot, "worktree", "list", "--porcelain")).split("worktree ").length - 1, 1);
});
test("crash after Git/before ready metadata leaves durable intent; fresh adapter safely reconciles", async t => {
  const f = await fixture(t), a = await adapter(f); f.storage.failSave = r => r.state === "ready";
  denied(await a.create(f.operation()), "storage_unavailable"); assert.equal((await f.storage.record()).state, "creating");
  const restarted = await createGitWorktreeAdapter({ sandboxRoot: f.sandboxRoot, storage: new FixtureStorage(f.storePath) });
  const d = await restarted.reconcile(f.operation()); assert.equal(d.status, "ready"); assert.equal(d.resource?.actualHead, f.baseline);
});
test("partial slot creation/metadata failure stays blocked for explicit recovery, no auto-adoption", async t => {
  const f = await fixture(t), a = await adapter(f); f.storage.failSave = r => r.slotIdentity !== null;
  denied(await a.create(f.operation()), "storage_unavailable"); assert.equal((await f.storage.record()).slotIdentity, null);
  f.storage.failSave = null; denied(await a.reconcile(f.operation()), "path_invalid");
  denied(await a.create(f.operation()), "worktree_conflict");
});
test("already physically removed resource can finish cleanup; never delete another path", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const r = await f.storage.record(), op = await f.cleanupContext();
  await git(f.repositoryRoot, "worktree", "remove", "--force", r.path);
  assert.equal((await a.cleanup(op)).status, "removed"); assert.equal((await a.cleanup(op)).status, "already_cleaned");
});
test("storage unavailable denies before Git and does not leak raw errors", async t => {
  const f = await fixture(t), a = await createGitWorktreeAdapter({ sandboxRoot: f.sandboxRoot, storage: { async withExclusive() { throw new Error("raw-secret-canary"); } } });
  const d = await a.create(f.operation()); denied(d, "storage_unavailable"); assert.equal(JSON.stringify(d).includes("raw-secret-canary"), false);
});

test("old generation cleanup cannot remove the newer generation worktree or metadata", async t => {
  const f = await fixture(t), a = await adapter(f), domain = await import(new URL("../lib/contracts/sandbox-execution.ts", import.meta.url).href);
  const original = await a.create(f.operation()); assert.ok(original.resource);
  const oldCleanupOp = await f.cleanupContext(true), oldContext = await f.storage.contextData();
  // Explicit fresh admission for generation 2, not an in-place identity rewrite.
  const config = { ...structuredClone(f.config), grants: f.config.grants.map(g => ({ ...g, resourceGeneration: 2 })) };
  const authority = { ...f.authority, generation: 2 }, spec = { ...f.spec, checkout: { ...f.spec.checkout, resourceGeneration: 2 } };
  const c = domain.createSandboxExecutionContract(config); let snapshot = c.create({ commandId: "create-b", spec }, authority).snapshot;
  assert.ok(snapshot);
  for (const type of ["admit", "claim", "prepare"]) {
    snapshot = c.apply(snapshot, { commandId: `b-${type}`, expectedRevision: snapshot.revision, fence: snapshot.fence, action: { type } }, authority).snapshot;
    assert.ok(snapshot);
  }
  await writeFile(join(f.storePath, "context.json"), JSON.stringify({ config, snapshot, authority, repository: f.repository }));
  const op = await f.refreshOperation(), newer = await a.create(op); assert.equal(newer.status, "ready"); assert.ok(newer.resource);
  assert.notEqual(newer.resource.path, original.resource.path);
  const newRecordBefore = await readFile(join(f.storePath, `record-${newer.resource.resourceId}.json`), "utf8");
  // The test port now resolves the historical resource's separate cleanup context.
  await writeFile(join(f.storePath, "context.json"), JSON.stringify(oldContext));
  assert.equal((await a.cleanup(oldCleanupOp)).status, "removed");
  assert.ok(await lstat(newer.resource.path)); assert.equal(await readFile(join(f.storePath, `record-${newer.resource.resourceId}.json`), "utf8"), newRecordBefore);
  assert.equal(await git(newer.resource.path, "rev-parse", "HEAD"), f.baseline);
});
test("Git creation failure keeps intent and never reports ready; no recursive fallback deletion", async t => {
  const f = await fixture(t), a = await adapter(f); let reads = 0;
  // Create a conflicting partial target only after the second authority read.
  f.storage.contextHook = async purpose => {
    if (purpose === "create" && ++reads === 2) { const r = await f.storage.record(); await mkdir(r.path); await writeFile(join(r.path, "foreign.txt"), "do not delete\n"); }
  };
  denied(await a.create(f.operation()), "git_operation_failure"); const record = await f.storage.record();
  assert.equal(record.state, "creating"); assert.equal(await readFile(join(record.path, "foreign.txt"), "utf8"), "do not delete\n");
  f.storage.contextHook = null; denied(await a.reconcile(f.operation()), "resource_missing");
});
test("cleanup metadata commit failure retains removing intent for restart-safe idempotent recovery", async t => {
  const f = await fixture(t), a = await adapter(f); await a.create(f.operation()); const op = await f.cleanupContext();
  f.storage.failSave = r => r.state === "removed";
  denied(await a.cleanup(op), "storage_unavailable"); const r = await f.storage.record(); assert.equal(r.state, "removing"); await assert.rejects(lstat(r.path));
  const restarted = await createGitWorktreeAdapter({ sandboxRoot: f.sandboxRoot, storage: new FixtureStorage(f.storePath) });
  assert.equal((await restarted.cleanup(op)).status, "removed"); assert.equal((await restarted.cleanup(op)).status, "already_cleaned");
});
test("expired authority during Git creation leaves a recoverable intent, not ready", async t => {
  const f = await fixture(t), a = await adapter(f); let reads = 0;
  f.storage.contextHook = async purpose => { if (purpose === "create" && ++reads === 3) await f.storage.changeContext(d => { d.authority = { ...d.authority, now: 500000 }; }); };
  denied(await a.create(f.operation()), "stale_authority"); assert.equal((await f.storage.record()).state, "creating");
  f.storage.contextHook = null; const op = await f.cleanupContext();
  assert.equal((await a.cleanup(op)).status, "removed");
});
test("worktree is never nested inside another factual worktree", async t => {
  const f = await fixture(t);
  await git(f.repositoryRoot, "worktree", "add", "--detach", f.sandboxRoot, f.baseline);
  const a = await adapter(f); denied(await a.create(f.operation()), "worktree_conflict");
  assert.equal((await f.storage.records()).length, 0);
});
test("creation/reconciliation leave trusted caller context/configuration/snapshot immutable", async t => {
  const f = await fixture(t), a = await adapter(f), before = await readFile(join(f.storePath, "context.json"), "utf8");
  await a.create(f.operation()); await a.reconcile(f.operation()); await a.discover(f.operation());
  assert.equal(await readFile(join(f.storePath, "context.json"), "utf8"), before);
});
