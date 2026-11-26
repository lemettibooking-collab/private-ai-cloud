import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const policy = await import(new URL("../lib/local-handoff/local-handoff-policy.ts", import.meta.url).href) as typeof import("../lib/local-handoff/local-handoff-policy");
const io = await import(new URL("../lib/local-handoff/local-developer-handoff.ts", import.meta.url).href) as typeof import("../lib/local-handoff/local-developer-handoff");
const runner = await import(new URL("../lib/local-handoff/local-verification-runner.ts", import.meta.url).href) as typeof import("../lib/local-handoff/local-verification-runner");

function spec(paths = ["src", "tests"], commands = ["node --test tests/pass.test.mts"]) {
  return {
    schemaVersion: 1, pathSelectionMode: "manual", selectedExecutor: { mode: "human_operated", label: "codex" },
    taskId: "task-a", context: "Local controlled handoff", expectedHandoff: "Patch and report; Owner decides",
    repositoryAllowlist: ["src", "tests"], completedTaskIds: [], activeTaskIds: [], taskOwnerApprovalGranted: true,
    plan: { id: "plan-a", title: "Plan A", goal: "Deliver A", status: "approved", tasks: [{
      id: "task-a", sequence: 1, title: "Task A", goal: "Deliver a bounded change", scope: ["Local code"], nonGoals: ["No external calls"],
      allowedPaths: paths, acceptanceCriteria: ["Verification passes"], verificationCommands: commands, dependencyIds: [],
      riskLevel: "low", priority: "P3", requiresOwnerApproval: true,
    }] },
  };
}

// Git mutations below are fixture setup ONLY, in disposable repositories, never production runtime.
async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), "pac-handoff-test-"));
  const root = join(temp, "repo");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"));
  await writeFile(join(root, "src/a.ts"), "export const a = 1;\n");
  await writeFile(join(root, "src/deleted.ts"), "export const deleted = 1;\n");
  await writeFile(join(root, "other.txt"), "baseline\n");
  await writeFile(join(root, "tests/pass.test.mts"), "import test from 'node:test'; test('local', () => {});\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  git("init", "--quiet"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Local test");
  git("add", "."); git("commit", "--quiet", "-m", "fixture");
  const output = join(temp, "prepared");
  const prepare = (input: unknown = spec(), out = output) => io.prepareLocalHandoff({ repository: root, spec: input, out });
  const report = join(temp, "executor-report.md");
  await writeFile(report, "Untrusted claim: all tests passed.\n");
  const review = (out = join(temp, "review"), options: import("../lib/local-handoff/local-developer-handoff").LocalHandoffOptions = {}) => io.reviewLocalHandoff({ repository: root, manifest: join(output, "handoff-manifest.json"), report, out }, options);
  return { temp, root, git, output, prepare, review, report, cleanup: () => rm(temp, { recursive: true, force: true }) };
}

test("prepare produces immutable bounded artifact/manifest without Git mutations", async () => {
  const f = await fixture(); try {
    const before = f.git("status", "--porcelain=v1"), head = f.git("rev-parse", "HEAD"), index = await readFile(join(f.root, ".git/index"));
    const result = await f.prepare(); assert.equal(result.status, "prepared");
    const manifest = JSON.parse(await readFile(join(f.output, "handoff-manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.ownerDecisionRequired, true);
    assert.deepEqual(manifest.selectedExecutor, { mode: "human_operated", label: "codex" });
    assert.equal(manifest.baseline.head, head.trim());
    const artifact = await readFile(join(f.output, "task-artifact.md"));
    assert.equal(manifest.taskArtifact.sha256, createHash("sha256").update(artifact).digest("hex"));
    assert.equal(f.git("status", "--porcelain=v1"), before); assert.equal(f.git("rev-parse", "HEAD"), head);
    assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
    assert.ok(!JSON.stringify(manifest).includes(f.root));
  } finally { await f.cleanup(); }
});

test("prepare requires a clean Git baseline and rejects non-Git roots", async () => {
  const f = await fixture(); try {
    await writeFile(join(f.root, "src/a.ts"), "changed\n");
    assert.equal((await f.prepare()).status, "blocked");
    assert.equal((await io.prepareLocalHandoff({ repository: f.temp, spec: spec(), out: f.output })).status, "blocked");
  } finally { await f.cleanup(); }
});

for (const path of ["../escape", "/tmp/escape", "src/*", "src/$(id)", "~/.env", "https://host/x", "node_modules/a", "src/.env", "other.txt"]) {
  test(`prepare denies forbidden/outside/invalid path ${path}`, () => {
    assert.equal(policy.normalizeHandoffSpec(spec([path])).ok, false);
  });
}
test("discovery, unknown keys, accessors, cycles, oversized and hostile specs fail closed", () => {
  assert.equal(policy.normalizeHandoffSpec({ ...spec(), pathSelectionMode: "discover" }).ok, false);
  assert.equal(policy.normalizeHandoffSpec({ ...spec(), execute: true }).ok, false);
  assert.equal(policy.normalizeHandoffSpec({ ...spec(), context: "x".repeat(300_000) }).ok, false);
  let accessed = false;
  const accessor = Object.defineProperty(spec(), "context", { get() { accessed = true; throw Error("SECRET"); } });
  assert.equal(policy.normalizeHandoffSpec(accessor).ok, false); assert.equal(accessed, false);
  assert.doesNotThrow(() => assert.equal(policy.normalizeHandoffSpec(new Proxy({}, { ownKeys() { throw Error("SECRET"); } })).ok, false));
  const cyclic = spec() as unknown as Record<string, unknown>; cyclic.context = cyclic;
  assert.equal(policy.normalizeHandoffSpec(cyclic).ok, false);
});

test("prepare rejects repository output and symlinked destination", async () => {
  const f = await fixture(); try {
    assert.equal((await f.prepare(spec(), join(f.root, "evidence"))).status, "blocked");
    const alias = join(f.temp, "alias"); await symlink(f.root, alias);
    assert.equal((await f.prepare(spec(), join(alias, "evidence"))).status, "blocked");
  } finally { await f.cleanup(); }
});

test("review captures modifications, untracked files and deletions with complete SHA evidence", async () => {
  const f = await fixture(); try {
    assert.equal((await f.prepare()).status, "prepared");
    await writeFile(join(f.root, "src/a.ts"), "export const a = 2;\n");
    await writeFile(join(f.root, "src/new.ts"), "export const fresh = true;\n");
    await unlink(join(f.root, "src/deleted.ts"));
    const index = await readFile(join(f.root, ".git/index"));
    const result = await f.review(); assert.equal(result.status, "ready_for_owner");
    const pkg = result.package!;
    assert.equal(pkg.schemaVersion, 1); assert.equal(pkg.ownerDecisionRequired, true);
    assert.deepEqual(pkg.scope.actualChangedPaths, ["src/a.ts", "src/deleted.ts", "src/new.ts"]);
    assert.ok(pkg.verification.every(v => v.status === "passed"));
    const patch = await readFile(join(f.temp, "review/change.patch"), "utf8");
    assert.match(patch, /new file mode/); assert.match(patch, /deleted file mode/); assert.match(patch, /\+export const a = 2/);
    assert.equal(pkg.artifacts.patch!.sha256, createHash("sha256").update(patch).digest("hex"));
    assert.ok(await readFile(join(f.temp, "review/review-package.md"), "utf8"));
    assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
    f.git("apply", "--reverse", "--check", join(f.temp, "review/change.patch"));
  } finally { await f.cleanup(); }
});

for (const path of ["other.txt", "src/.env"]) {
  test(`review scope/forbidden violation blocks even when tests would pass: ${path}`, async () => {
    const f = await fixture(); try {
      await f.prepare(); await writeFile(join(f.root, path), "unauthorized\n");
      const result = await f.review(); assert.equal(result.status, "blocked");
      assert.ok(result.package!.reasons.includes("changed_path_denied"));
      assert.ok(result.package!.verification.every(v => v.status === "not_run"));
      assert.equal(result.package!.artifacts.patch, null);
    } finally { await f.cleanup(); }
  });
}
test("review rejects symlink/path escape without reading outside files", async () => {
  const f = await fixture(); try {
    await f.prepare(); await symlink(f.report, join(f.root, "src/link"));
    const result = await f.review(); assert.equal(result.status, "blocked");
    assert.ok(result.package!.reasons.includes("unsafe_worktree_object"));
  } finally { await f.cleanup(); }
});
for (const drift of ["branch", "head", "repository", "manifest", "artifact"] as const) {
  test(`review blocks ${drift} drift`, async () => {
    const f = await fixture(); try {
      await f.prepare();
      if (drift === "branch") f.git("branch", "-m", "different");
      if (drift === "head") f.git("commit", "--quiet", "--allow-empty", "-m", "drift");
      if (drift === "repository" || drift === "manifest") {
        const file = join(f.output, "handoff-manifest.json"), m = JSON.parse(await readFile(file, "utf8"));
        if (drift === "repository") m.baseline.repositoryFingerprint = "0".repeat(64); else m.normalizedAllowedPaths = ["other.txt"];
        await writeFile(file, JSON.stringify(m));
      }
      if (drift === "artifact") await writeFile(join(f.output, "task-artifact.md"), "tampered\n");
      const result = await f.review(); assert.equal(result.status, "blocked");
      assert.ok(result.package?.verification.every(v => v.status === "not_run") ?? true);
    } finally { await f.cleanup(); }
  });
}

test("review blocks binary, oversized file, report and excessive changed files", async () => {
  for (const kind of ["binary", "large", "count", "report"]) {
    const f = await fixture(); try {
      await f.prepare();
      if (kind === "binary") await writeFile(join(f.root, "src/new.bin"), Buffer.from([0, 255, 0]));
      if (kind === "large") await writeFile(join(f.root, "src/a.ts"), "x".repeat(policy.localHandoffLimits.maxFileBytes + 1));
      if (kind === "report") await writeFile(f.report, "x".repeat(policy.localHandoffLimits.maxReportBytes + 1));
      if (kind === "count") for (let i = 0; i <= policy.localHandoffLimits.maxChangedFiles; i++) await writeFile(join(f.root, `src/n${i}.ts`), "x\n");
      assert.equal((await f.review()).status, "blocked");
    } finally { await f.cleanup(); }
  }
});

test("total patch bound is enforced independently of each file bound", async () => {
  const f = await fixture(); try {
    await f.prepare();
    for (let i = 0; i < 10; i++) await writeFile(join(f.root, `src/large${i}.ts`), "x".repeat(240 * 1024) + "\n");
    const result = await f.review(); assert.equal(result.status, "blocked");
    assert.ok(result.package!.reasons.includes("artifact_limit_exceeded")); assert.equal(result.package!.artifacts.patch, null);
  } finally { await f.cleanup(); }
});

test("verification writes cannot produce a stale ready package", async () => {
  const f = await fixture(); try {
    await f.prepare(spec(["src", "tests"], ["node --test tests/write.test.mts"]));
    await writeFile(join(f.root, "tests/write.test.mts"), "import {writeFileSync} from 'node:fs'; writeFileSync('other.txt', 'verifier mutation\\n');\n");
    const result = await f.review(); assert.equal(result.status, "blocked");
    assert.ok(result.package!.reasons.includes("worktree_changed_during_verification"));
    assert.ok(!result.package!.verification.some(v => v.status === "failed"));
  } finally { await f.cleanup(); }
});

test("rename evidence includes old and new paths; a staged index is never accepted or changed", async () => {
  const f = await fixture(); try {
    await f.prepare();
    await writeFile(join(f.root, "src/renamed.ts"), await readFile(join(f.root, "src/a.ts")));
    await unlink(join(f.root, "src/a.ts"));
    const result = await f.review(); assert.equal(result.status, "ready_for_owner");
    assert.deepEqual(result.package!.scope.actualChangedPaths, ["src/a.ts", "src/renamed.ts"]);
    f.git("add", "src"); // Deliberate fixture misuse, never a runtime command.
    const index = await readFile(join(f.root, ".git/index"));
    const staged = await f.review(join(f.temp, "staged-review")); assert.equal(staged.status, "blocked");
    assert.ok(staged.package!.reasons.includes("index_changed")); assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
  } finally { await f.cleanup(); }
});

test("real CLI throwaway harness: prepare, human edit, report, ready package then scope block", async () => {
  const f = await fixture(); try {
    const script = fileURLToPath(new URL("../scripts/local-developer-handoff.mts", import.meta.url));
    const specFile = join(f.temp, "spec.json"); await writeFile(specFile, JSON.stringify(spec()));
    const cli = (...args: string[]) => execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], { cwd: f.root, encoding: "utf8" });
    assert.equal(JSON.parse(cli("prepare", "--spec", specFile, "--out", f.output)).status, "prepared");
    await writeFile(join(f.root, "src/a.ts"), "export const a = 3;\n");
    assert.equal(JSON.parse(cli("review", "--manifest", join(f.output, "handoff-manifest.json"), "--report", f.report, "--out", join(f.temp, "cli-review"))).status, "ready_for_owner");
    const pkg = JSON.parse(await readFile(join(f.temp, "cli-review/review-package.json"), "utf8"));
    assert.equal(pkg.outcome, "ready_for_owner"); assert.ok(await readFile(join(f.temp, "cli-review/review-package.md"), "utf8"));
    await writeFile(join(f.root, "other.txt"), "scope violation\n");
    assert.throws(() => cli("review", "--manifest", join(f.output, "handoff-manifest.json"), "--report", f.report, "--out", join(f.temp, "cli-blocked")), (error: unknown) => {
      const e = error as { status: number; stdout: string }; assert.equal(e.status, 2); assert.equal(JSON.parse(e.stdout).status, "blocked"); return true;
    });
    assert.equal(JSON.parse(await readFile(join(f.temp, "cli-blocked/review-package.json"), "utf8")).outcome, "blocked");
  } finally { await f.cleanup(); }
});

test("CLI rejects a FIFO spec without waiting for a writer", { skip: process.platform === "win32" }, async () => {
  const f = await fixture(); try {
    const fifo = join(f.temp, "fifo"); execFileSync("mkfifo", [fifo]);
    const script = fileURLToPath(new URL("../scripts/local-developer-handoff.mts", import.meta.url));
    assert.throws(() => execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, "prepare", "--spec", fifo, "--out", f.output], { cwd: f.root, encoding: "utf8", timeout: 5000 }), (error: unknown) => {
      assert.equal((error as { status: number }).status, 2); return true;
    });
  } finally { await f.cleanup(); }
});

for (const command of ["npm run lint", "npm run typecheck", "npm test", "npm run build", "npm run test:pg", "git diff --check", "node --test tests/a.test.mts tests/b.test.mts"]) {
  test(`fixed verification grammar accepts ${command}`, () => assert.ok(policy.parseVerificationCommand(command)));
}
for (const command of ["npm test; id", "npm test && id", "npm test | id", "npm test > out", "npm test $(id)", "X=1 npm test", "node --test /tmp/a.test.mts", "node --test tests/../a.test.mts", "node --test --import x tests/a.test.mts", "sh -c id", "npm run other"]) {
  test(`fixed verification grammar rejects ${command}`, () => assert.equal(policy.parseVerificationCommand(command), null));
}
test("runner uses shell:false and records factual failures, timeout and bounded output", async () => {
  const f = await fixture(); try {
    let calls = 0;
    const spawnProcess: typeof spawn = ((...args: Parameters<typeof spawn>) => {
      const options = args[2] as { shell?: boolean }; assert.equal(options.shell, false); calls++;
      return spawn(...args);
    }) as typeof spawn;
    const pass = await runner.runLocalVerification(f.root, "node --test tests/pass.test.mts", { spawnProcess });
    assert.equal(pass.status, "passed"); assert.equal(calls, 1);
    await writeFile(join(f.root, "tests/fail.test.mts"), "throw Error('factual failure');\n");
    assert.equal((await runner.runLocalVerification(f.root, "node --test tests/fail.test.mts")).status, "failed");
    await writeFile(join(f.root, "tests/hang.test.mts"), "setInterval(() => {}, 1000);\n");
    assert.equal((await runner.runLocalVerification(f.root, "node --test tests/hang.test.mts", { timeoutMs: 100 })).status, "timed_out");
    await writeFile(join(f.root, "tests/noisy.test.mts"), "console.log('x'.repeat(100000));\n");
    const noisy = await runner.runLocalVerification(f.root, "node --test tests/noisy.test.mts", { maxLogBytes: 200 });
    assert.equal(noisy.status, "failed"); assert.ok(noisy.stdoutTruncated); assert.ok(Buffer.byteLength(noisy.stdout) <= 200);
    assert.equal((await runner.runLocalVerification(f.root, "sh -c id")).status, "unsupported");
  } finally { await f.cleanup(); }
});

test("failed verification cannot be overridden by executor claims; unsupported stays blocked", async () => {
  for (const command of ["node --test tests/fail.test.mts", "npm run unsupported"]) {
    const f = await fixture(); try {
      await f.prepare(spec(["src", "tests"], [command]));
      await writeFile(join(f.root, "tests/fail.test.mts"), "throw Error('failed');\n");
      const result = await f.review(); assert.equal(result.status, "blocked");
      assert.ok(result.package!.verification.some(v => v.status === "failed" || v.status === "unsupported"));
      assert.equal(result.package!.ownerDecisionRequired, true);
    } finally { await f.cleanup(); }
  }
});

test("probable secrets block, never leak, while ordinary token field names are safe", async () => {
  assert.deepEqual(policy.findProbableSecrets("access_token refresh_token client_secret DATABASE_URL"), []);
  const fake = "sk-proj-" + "FAKE0123456789".repeat(4);
  for (const location of ["patch", "report", "filename"]) {
    const f = await fixture(); try {
      await f.prepare();
      const target = location === "patch" ? join(f.root, "src/a.ts") : location === "filename" ? join(f.root, "src", fake + ".ts") : f.report;
      await writeFile(target, location === "filename" ? "safe content\n" : fake + "\n");
      const result = await f.review(); assert.equal(result.status, "blocked");
      assert.ok(result.package!.reasons.includes("probable_secret"));
      assert.equal(result.package!.artifacts.patch, null); assert.equal(result.package!.artifacts.executorReport, null);
      assert.ok(!JSON.stringify(result).includes(fake));
      assert.ok(!(await readFile(join(f.temp, "review/review-package.json"), "utf8")).includes(fake));
    } finally { await f.cleanup(); }
  }
});
test("verification evidence redacts environment values and raw private-key/provider material", async () => {
  const f = await fixture(); const previous = process.env.PAC_TEST_SECRET; process.env.PAC_TEST_SECRET = "ENV-PRIVATE-HANDOFF-0123456789";
  try {
    await writeFile(join(f.root, "tests/env.test.mts"), "console.log(process.env.PAC_TEST_SECRET); console.log('sk-proj-' + 'A'.repeat(48));\n");
    const result = await runner.runLocalVerification(f.root, "node --test tests/env.test.mts");
    assert.ok(!JSON.stringify(result).includes(process.env.PAC_TEST_SECRET)); assert.ok(!JSON.stringify(result).includes("sk-proj-"));
  } finally { if (previous === undefined) delete process.env.PAC_TEST_SECRET; else process.env.PAC_TEST_SECRET = previous; await f.cleanup(); }
});

test("repeat review is deterministic apart from explicit duration; input stays unchanged", async () => {
  const f = await fixture(); try {
    const input = spec(), original = structuredClone(input); await f.prepare(input);
    await writeFile(join(f.root, "src/a.ts"), "export const a = 2;\n");
    const a = await f.review(join(f.temp, "review-a"), { now: () => 0 });
    const b = await f.review(join(f.temp, "review-b"), { now: () => 0 });
    assert.deepEqual(a.package, b.package); assert.deepEqual(input, original);
    assert.ok(Object.isFrozen(a.package)); assert.notEqual(a.package, b.package);
  } finally { await f.cleanup(); }
});
