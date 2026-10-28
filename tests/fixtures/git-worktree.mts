import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import type { WorktreeContext, WorktreeIdentity, WorktreeLease, WorktreeOperation, WorktreeRecord, WorktreeRepository, WorktreeStoragePort } from "../../lib/sandbox/worktree-port";
import type { SandboxAuthority, SandboxCleanupAuthority, SandboxExecutionConfiguration, SandboxExecutionSnapshot, SandboxExecutionSpec } from "../../lib/contracts/sandbox-execution";
const domain = await import(new URL("../../lib/contracts/sandbox-execution.ts", import.meta.url).href) as typeof import("../../lib/contracts/sandbox-execution");
const exec = promisify(execFile);
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], {
    cwd, timeout: 10000, maxBuffer: 1024 * 1024,
    encoding: "utf8", env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  }); return result.stdout.trim();
}
export async function fileIdentity(path: string) { const s = await lstat(path); return { device: s.dev, inode: s.ino }; }
export function frozen(value: unknown): void { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
export function denied(d: { verdict: string; resource: unknown; runtimeDispatchAllowed: boolean }, reason?: string) {
  assert.equal(d.verdict, "deny"); assert.equal(d.resource, null); assert.equal(d.runtimeDispatchAllowed, false);
  if (reason) assert.equal((d as { reason?: string }).reason, reason); frozen(d);
}

/** Disposable test-only durable fixture, NOT an application/VPS storage adapter. */
export class FixtureStorage implements WorktreeStoragePort {
  contextHook: ((purpose: string) => Promise<void>) | null = null;
  failSave: ((record: WorktreeRecord) => boolean) | null = null;
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  async contextData() { return JSON.parse(await readFile(join(this.directory, "context.json"), "utf8")) as {
    config: SandboxExecutionConfiguration; snapshot: SandboxExecutionSnapshot; authority: SandboxAuthority | SandboxCleanupAuthority; repository: WorktreeRepository | null;
  }; }
  async changeContext(change: (data: Awaited<ReturnType<FixtureStorage["contextData"]>>) => void) {
    const data = await this.contextData(); change(data); await writeFile(join(this.directory, "context.json"), JSON.stringify(data));
  }
  async records() { return (await readdir(this.directory)).filter(name => /^record-[a-f0-9]{64}\.json$/u.test(name)).sort(); }
  async record() { const names = await this.records(); assert.equal(names.length, 1); return JSON.parse(await readFile(join(this.directory, names[0]), "utf8")) as WorktreeRecord; }
  async corrupt(record: WorktreeRecord) { await writeFile(join(this.directory, `record-${record.resourceId}.json`), JSON.stringify(record)); }
  async withExclusive<T>(_root: string, action: (lease: WorktreeLease) => Promise<T>): Promise<T> {
    // Separate FixtureStorage instances use the SAME exclusive on-disk lock.
    const lock = join(this.directory, "operation.lock"), handle = await open(lock, "wx", 0o600);
    try {
      const read = async (id: string) => {
        try { return JSON.parse(await readFile(join(this.directory, `record-${id}.json`), "utf8")) as WorktreeRecord; }
        catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
      };
      return await action({
        context: async (_identity: WorktreeIdentity, purpose: string): Promise<WorktreeContext> => {
          await this.contextHook?.(purpose); const data = await this.contextData();
          return { ...data, contract: domain.createSandboxExecutionContract(data.config) };
        }, read,
        save: async (record, expected) => {
          assert.equal((await read(record.resourceId))?.version ?? null, expected, "CAS");
          if (this.failSave?.(record)) throw new Error("fixture_storage_failure");
          const path = join(this.directory, `record-${record.resourceId}.json`), staged = `${path}.tmp`;
          const fd = await open(staged, "w", 0o600);
          try { await fd.writeFile(JSON.stringify(record)); await fd.sync(); } finally { await fd.close(); }
          await rename(staged, path);
        },
        list: async () => Promise.all((await this.records()).map(name => read(name.slice(7, -5)).then(r => { assert.ok(r); return r; }))),
      });
    } finally { await handle.close(); await rm(lock); }
  }
}

export async function fixture(t: TestContext) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "pac-ai0422-")));
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const repositoryRoot = join(temp, "repository"), sandboxRoot = join(temp, "sandboxes"), storePath = join(temp, "records");
  for (const p of [repositoryRoot, sandboxRoot, storePath]) await mkdir(p, { mode: 0o700 });
  await git(repositoryRoot, "init", "--initial-branch=main");
  await mkdir(join(repositoryRoot, "src")); await writeFile(join(repositoryRoot, "src/a.txt"), "baseline\n");
  await git(repositoryRoot, "add", "src/a.txt"); await git(repositoryRoot, "commit", "-m", "fixture baseline");
  const baseline = await git(repositoryRoot, "rev-parse", "HEAD");
  await writeFile(join(repositoryRoot, "src/a.txt"), "later commit\n"); await git(repositoryRoot, "add", "src/a.txt"); await git(repositoryRoot, "commit", "-m", "fixture later");
  const later = await git(repositoryRoot, "rev-parse", "HEAD"), commonDirectory = join(repositoryRoot, ".git");
  const repository: WorktreeRepository = { workspaceId: "workspace-a", projectId: "project-a", repositoryId: "repo-a", root: repositoryRoot, commonDirectory,
    rootIdentity: await fileIdentity(repositoryRoot), commonIdentity: await fileIdentity(commonDirectory), protectedBranches: ["main", "master"] };
  const resources = { wallClockMs: 300000, cpuMillis: 1000, memoryMiB: 512, diskMiB: 1024, commandMs: 120000, outputBytes: 65536 };
  const command = { id: "check", executable: "git" as const, args: ["diff", "--check"], cwd: "src", environment: {}, timeoutMs: 120000, maxOutputBytes: 65536 };
  const config: SandboxExecutionConfiguration = { workspaceId: "workspace-a", projects: [{ projectId: "project-a", repositoryId: "repo-a", baselines: [baseline, later], protectedBranches: ["main", "master"] }],
    grants: [{ executionId: "exec-a", projectId: "project-a", policyRef: "policy-a", approvalRef: "approval-a", policyRevision: 1, resourceGeneration: 1 }],
    policy: { id: "policy-a", revision: 1, branchPrefix: "sandbox", readablePaths: ["src"], writablePaths: ["src"], forbiddenPaths: [], commands: [command],
      network: { mode: "deny_all", destinations: [] }, resources, ephemeralSecrets: [] } };
  const spec: SandboxExecutionSpec = { schemaVersion: 1, executionId: "exec-a", workspaceId: "workspace-a", projectId: "project-a", repository: { id: "repo-a", baseline },
    checkout: { branch: "sandbox/exec-a", worktreeId: "exec-a", resourceGeneration: 1 }, mode: "patch_proposal",
    filesystem: { readablePaths: ["src"], writablePaths: ["src"], forbiddenPaths: [], hostAccess: "denied" }, commands: [command], forbiddenActions: [...domain.sandboxForbiddenActions],
    network: { mode: "deny_all", destinations: [] }, secrets: { mode: "none", refs: [], inheritEnvironment: false }, resources,
    artifacts: { maxFiles: 16, maxBytes: 1048576, maxLogBytes: 65536, requiredCommandIds: ["check"] }, cleanup: { mode: "always", retainArtifacts: true },
    policyRef: "policy-a", policyRevision: 1, approvalRef: "approval-a" };
  const authority: SandboxAuthority = { workspaceId: "workspace-a", projectId: "project-a", executionId: "exec-a", generation: 1, actorId: "worker-a", active: true, now: 1000, expiresAt: 1000000 };
  const contract = domain.createSandboxExecutionContract(config);
  const initial = contract.create({ commandId: "create-a", spec }, authority);
  let snapshot = initial.snapshot!; assert.ok(snapshot, JSON.stringify(initial));
  for (const type of ["admit", "claim", "prepare"] as const) {
    const d = contract.apply(snapshot, { commandId: type, expectedRevision: snapshot.revision, fence: snapshot.fence, action: { type } }, authority);
    assert.equal(d.verdict, "allow"); snapshot = d.snapshot!;
  }
  const storage = new FixtureStorage(storePath);
  await writeFile(join(storePath, "context.json"), JSON.stringify({ config, snapshot, authority, repository }));
  const operation = (): WorktreeOperation => ({ workspaceId: snapshot.spec.workspaceId, projectId: snapshot.spec.projectId, executionId: snapshot.spec.executionId,
    resourceGeneration: snapshot.spec.checkout.resourceGeneration, specFingerprint: snapshot.specFingerprint, expectedRevision: snapshot.revision, fence: snapshot.fence });
  async function refreshOperation() {
    snapshot = (await storage.contextData()).snapshot; return operation();
  }
  async function cleanupContext(rotate = false) {
    await storage.changeContext(data => {
      const c = domain.createSandboxExecutionContract(data.config), a = data.authority as SandboxAuthority;
      let s = c.apply(data.snapshot, { commandId: "cancel", expectedRevision: data.snapshot.revision, fence: data.snapshot.fence, action: { type: "cancel" } }, a).snapshot!;
      assert.ok(s);
      const { active: _active, ...rest } = a; void _active;
      const cleanup = { ...rest, generation: rotate ? a.generation + 1 : a.generation,
        worktreeId: s.spec.checkout.worktreeId, resourceGeneration: s.spec.checkout.resourceGeneration, specFingerprint: s.specFingerprint };
      if (rotate) data.config = { ...data.config, grants: [], policy: { ...data.config.policy, revision: 2 } };
      const current = domain.createSandboxExecutionContract(data.config);
      s = current.applyCleanup(s, { commandId: "begin-cleanup", expectedRevision: s.revision, fence: s.fence, action: { type: "begin_cleanup" } }, cleanup).snapshot!;
      assert.ok(s); data.snapshot = s; data.authority = cleanup;
    }); return refreshOperation();
  }
  return { temp, repositoryRoot, sandboxRoot, storePath, baseline, later, repository, storage, operation, cleanupContext, refreshOperation, config, spec, authority, snapshot };
}
