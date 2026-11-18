import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, mkdir, readdir, writeFile, rmdir } from "node:fs/promises";
import { resolve, relative, dirname, join, parse, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import type { Baseline, HandoffManifest, ReviewPackage, VerificationRecord } from "./local-handoff-policy";
import type { VerificationOptions } from "./local-verification-runner";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { block, HandoffBlocked, normalizeHandoffSpec, boundedData, exactRecord, localHandoffLimits, localHandoffPolicyVersion, safeRepositoryPath, sha256, artifactMetadata, ensureSafeEvidence, findProbableSecrets, compare, freezeDeep, notRun } from "./local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isSystemForbiddenRepositoryPath, repositoryPathContains } from "../contracts/development-task-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { localChildEnvironment, runLocalVerification } from "./local-verification-runner.ts";

// Standalone CLI application boundary; never imported by the AI-039 planning surfaces.
export type LocalHandoffOptions = VerificationOptions;
export type LocalHandoffResult = Readonly<{ status: "prepared" | "ready_for_owner" | "blocked"; reasons: readonly string[]; package?: ReviewPackage }>;
const safeReason = (error: unknown) => error instanceof HandoffBlocked ? error.code : "local_evidence_unavailable";
const inside = (root: string, path: string) => { const part = relative(root, path); return !part || (!part.startsWith("..") && !isAbsolute(part)); };
const decode = (data: Buffer) => { try { if (data.includes(0)) block("unsupported_artifact"); return new TextDecoder("utf-8", { fatal: true }).decode(data); } catch (error) { if (error instanceof HandoffBlocked) throw error; return block("unsupported_artifact"); } };

// Only these read-only Git operations exist in the runtime. Never stage to capture new files.
const readOnlyGitOperations = new Set(["rev-parse", "status", "diff", "ls-tree", "cat-file"]);
async function git(root: string, args: readonly string[], maxBytes = localHandoffLimits.maxPatchBytes): Promise<{ code: number; output: Buffer }> {
  if (!readOnlyGitOperations.has(args[0])) block("unsupported_git_operation");
  return await new Promise((resolveResult, reject) => {
    let bytes = 0, done = false; const chunks: Buffer[] = [];
    const child = spawn("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root, env: localChildEnvironment(), shell: false, stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish("git_evidence_timeout"); }, 10000);
    const finish = (reason?: string, code = 0) => {
      if (done) return; done = true; clearTimeout(timer);
      if (reason) reject(new HandoffBlocked(reason)); else resolveResult({ code, output: Buffer.concat(chunks) });
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length; if (bytes > maxBytes) { child.kill("SIGKILL"); finish("artifact_limit_exceeded"); } else chunks.push(chunk);
    });
    // Drain, never publish raw Git/OS errors (may contain local paths or secrets).
    child.stderr?.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) { child.kill("SIGKILL"); finish("artifact_limit_exceeded"); } });
    child.once("error", () => finish("git_evidence_unavailable"));
    child.once("close", code => code === 0 || code === 1 ? finish(undefined, code) : finish("git_evidence_unavailable"));
  });
}

async function assertNoSymlinks(path: string): Promise<void> {
  const absolute = resolve(path), parts = absolute.slice(parse(absolute).root.length).split(/[\\/]/u);
  let current = parse(absolute).root;
  for (const part of parts) {
    current = join(current, part);
    try { const stat = await lstat(current); if (stat.isSymbolicLink()) block("unsafe_path"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
}
// macOS /tmp and OS tempdir aliases are canonicalized once; user-created aliases are rejected.
function canonicalTempAlias(path: string): string {
  const absolute = resolve(path);
  if (absolute === "/tmp" || absolute.startsWith("/tmp/")) return absolute.replace(/^\/tmp(?=\/|$)/u, "/private/tmp");
  if (absolute === "/var" || absolute.startsWith("/var/")) return absolute.replace(/^\/var(?=\/|$)/u, "/private/var");
  return absolute;
}
async function canonicalPath(path: string): Promise<string> {
  let absolute = resolve(path);
  if (process.platform === "darwin") absolute = canonicalTempAlias(absolute);
  await assertNoSymlinks(absolute); return absolute;
}
async function repositoryContext(input: string): Promise<{ root: string; baseline: Baseline }> {
  const root = await realpath(await canonicalPath(input));
  const top = decode((await git(root, ["rev-parse", "--show-toplevel"], 4096)).output).trim();
  if (await realpath(top) !== root) block("invalid_repository_root");
  const gitDir = await realpath(decode((await git(root, ["rev-parse", "--absolute-git-dir"], 4096)).output).trim());
  const head = decode((await git(root, ["rev-parse", "HEAD"], 1024)).output).trim();
  const branch = decode((await git(root, ["rev-parse", "--abbrev-ref", "HEAD"], 1024)).output).trim();
  if (!/^[a-f0-9]{40,64}$/u.test(head) || branch === "HEAD" || !/^[A-Za-z0-9._/-]{1,200}$/u.test(branch)) block("invalid_repository_identity");
  ensureSafeEvidence(branch);
  return { root, baseline: { head, branch, repositoryFingerprint: sha256(`${root}\n${gitDir}`) } };
}
async function readRegular(path: string, maxBytes: number): Promise<Buffer> {
  await assertNoSymlinks(path);
  const entry = await lstat(path);
  if (!entry.isFile() || entry.nlink !== 1) block("unsafe_worktree_object");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.ino !== entry.ino || before.dev !== entry.dev) block("unsafe_worktree_object");
    if (before.size > maxBytes) block("artifact_limit_exceeded");
    // A growing file cannot make readFile allocate beyond the limit.
    const data = Buffer.alloc(Math.min(maxBytes + 1, before.size + 1));
    let total = 0;
    while (total < data.length) { const read = await file.read(data, total, data.length - total, total); if (!read.bytesRead) break; total += read.bytesRead; }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || total !== before.size) block("artifact_changed_during_capture");
    if (total > maxBytes) block("artifact_limit_exceeded");
    return data.subarray(0, total);
  } finally { await file.close(); }
}
async function outputPath(root: string, supplied: string | undefined, name: string): Promise<string> {
  const out = await canonicalPath(supplied ?? join(await realpath(tmpdir()), name));
  if (inside(root, out) || inside(out, root) || out === parse(out).root) block("unsafe_output_location");
  // Existing output is never overwritten. Parent must already exist and not be a symlink.
  try { await lstat(out); block("output_already_exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const parent = await lstat(dirname(out)); if (!parent.isDirectory()) block("unsafe_output_location");
  return out;
}
async function writeArtifacts(out: string, files: Readonly<Record<string, string | Buffer>>): Promise<void> {
  await mkdir(out, { mode: 0o700 });
  // Names are fixed PAC-owned identifiers. No caller filenames, interpolation or overwrite.
  for (const [name, value] of Object.entries(files)) await writeFile(join(out, name), value, { mode: 0o600, flag: "wx" });
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export async function prepareLocalHandoff(input: Readonly<{ repository: string; spec: unknown; out?: string }>): Promise<LocalHandoffResult> {
  try {
    const context = await repositoryContext(input.repository);
    if ((await git(context.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).output.length) block("dirty_baseline");
    const spec = normalizeHandoffSpec(input.spec); if (!spec.ok) block(spec.reasons[0]);
    const value = spec.value, task = value.spec.plan.tasks.find(t => t.id === value.spec.taskId)!;
    const manifest: HandoffManifest = freezeDeep({ schemaVersion: 1, policyVersion: localHandoffPolicyVersion, ownerDecisionRequired: true,
      task: { id: task.id, label: task.title }, selectedExecutor: value.spec.selectedExecutor, baseline: context.baseline,
      normalizedAllowedPaths: value.normalizedAllowedPaths, verificationCommands: value.verificationCommands,
      taskArtifact: artifactMetadata("task-artifact.md", value.artifact), spec: value.spec });
    ensureSafeEvidence(json(manifest));
    if (Buffer.byteLength(json(manifest)) > localHandoffLimits.maxSpecBytes) block("manifest_limit_exceeded");
    const out = await outputPath(context.root, input.out, `pac-handoff-${context.baseline.head.slice(0, 12)}-${value.spec.taskId}`);
    // Detect factual drift while preparing; no output is published for a dirty/changed baseline.
    const current = await repositoryContext(context.root);
    if (json(current.baseline) !== json(context.baseline) || (await git(context.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).output.length) block("baseline_changed");
    await writeArtifacts(out, { "task-artifact.md": value.artifact, "handoff-manifest.json": json(manifest) });
    return freezeDeep({ status: "prepared", reasons: [] });
  } catch (error) { return freezeDeep({ status: "blocked", reasons: [safeReason(error)] }); }
}
async function loadManifest(path: string): Promise<HandoffManifest> {
  const location = await canonicalPath(path);
  const raw = boundedData(JSON.parse(decode(await readRegular(location, localHandoffLimits.maxSpecBytes))));
  const m = exactRecord(raw, ["schemaVersion", "policyVersion", "ownerDecisionRequired", "task", "selectedExecutor", "baseline", "normalizedAllowedPaths", "verificationCommands", "taskArtifact", "spec"]);
  if (m.schemaVersion !== 1 || m.policyVersion !== localHandoffPolicyVersion || m.ownerDecisionRequired !== true) block("invalid_manifest");
  const baseline = exactRecord(m.baseline, ["branch", "head", "repositoryFingerprint"]);
  if (typeof baseline.branch !== "string" || !/^[A-Za-z0-9._/-]{1,200}$/u.test(baseline.branch) || typeof baseline.head !== "string" || !/^[a-f0-9]{40,64}$/u.test(baseline.head) || typeof baseline.repositoryFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(baseline.repositoryFingerprint)) block("invalid_manifest");
  const normalized = normalizeHandoffSpec(m.spec); if (!normalized.ok) block("invalid_manifest");
  const value = normalized.value, task = value.spec.plan.tasks.find(t => t.id === value.spec.taskId)!;
  const expected: HandoffManifest = { schemaVersion: 1, policyVersion: localHandoffPolicyVersion, ownerDecisionRequired: true,
    task: { id: task.id, label: task.title }, selectedExecutor: value.spec.selectedExecutor, baseline: baseline as Baseline,
    normalizedAllowedPaths: value.normalizedAllowedPaths, verificationCommands: value.verificationCommands,
    taskArtifact: artifactMetadata("task-artifact.md", value.artifact), spec: value.spec };
  // Compare canonical bounded data, not caller object iteration order.
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort(compare).map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
    return JSON.stringify(v);
  };
  if (canonical(m) !== canonical(expected)) block("manifest_integrity_failed");
  const artifact = await readRegular(join(dirname(location), "task-artifact.md"), localHandoffLimits.maxSpecBytes);
  if (sha256(artifact) !== expected.taskArtifact.sha256 || decode(artifact) !== value.artifact) block("manifest_integrity_failed");
  ensureSafeEvidence(json(expected)); return freezeDeep(expected);
}

type Capture = { paths: string[]; patch: Buffer; fingerprint: string };
async function changedPaths(root: string): Promise<string[]> {
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], 128 * 1024);
  const entries = status.output.toString("utf8").split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!/^[ MARCUD?!]{2} /u.test(entry)) block("ambiguous_git_state");
    if (/U/u.test(entry.slice(0, 2))) block("ambiguous_git_state");
    paths.push(entry.slice(3));
    if (/[RC]/u.test(entry.slice(0, 2))) { if (!entries[i + 1]) block("ambiguous_git_state"); paths.push(entries[++i]); }
    if (paths.length > localHandoffLimits.maxChangedFiles) block("changed_file_limit_exceeded");
  }
  return [...new Set(paths.map(safeRepositoryPath))].sort(compare);
}
async function capture(root: string, paths: readonly string[], baseline: Baseline): Promise<Capture> {
  for (const path of paths) {
    const target = join(root, path); await assertNoSymlinks(target).catch(() => block("unsafe_worktree_object"));
    try { const data = await readRegular(target, localHandoffLimits.maxFileBytes); decode(data); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const tree = decode((await git(root, ["ls-tree", baseline.head, "--", path], 4096)).output);
    if (tree && !/^100(?:644|755) blob /u.test(tree)) block("unsafe_worktree_object");
    if (tree) {
      const size = Number(decode((await git(root, ["cat-file", "-s", `${baseline.head}:${path}`], 1024)).output).trim());
      if (!Number.isSafeInteger(size) || size < 0 || size > localHandoffLimits.maxFileBytes) block("artifact_limit_exceeded");
    }
  }
  const tracked = await git(root, ["diff", "--no-ext-diff", "--no-textconv", "--full-index", "--no-renames", baseline.head, "--"]);
  if (tracked.output.includes(Buffer.from("Binary files ")) || tracked.output.includes(Buffer.from("GIT binary patch"))) block("unsupported_artifact");
  const parts = [tracked.output]; let bytes = tracked.output.length;
  for (const path of paths) {
    const tree = await git(root, ["ls-tree", baseline.head, "--", path], 4096);
    if (tree.output.length) continue;
    const diff = await git(root, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--full-index", "--", "/dev/null", path]);
    bytes += diff.output.length; if (bytes > localHandoffLimits.maxPatchBytes) block("artifact_limit_exceeded"); parts.push(diff.output);
    const whitespace = await git(root, ["diff", "--no-index", "--check", "--", "/dev/null", path]);
    if (whitespace.output.length || whitespace.code > 1) block("whitespace_failed");
  }
  const patch = Buffer.concat(parts); decode(patch);
  return { paths: [...paths], patch, fingerprint: sha256(Buffer.concat([Buffer.from(json(paths)), patch])) };
}
function markdown(pkg: ReviewPackage): string {
  // Projection only: never render executor Markdown/HTML or logs in this document.
  return `# Local developer review package\n\nOutcome: ${pkg.outcome}\n\nOwner decision required: true. This package grants no Git or deployment authority.\n\n` +
    `Baseline HEAD: ${pkg.identity.baseline.head}\n\nTask: ${pkg.identity.task.id}\n\nHuman-operated target: ${pkg.identity.selectedExecutor.label}\n\n` +
    `Changed paths: ${pkg.scope.actualChangedPaths.length}. Path policy: ${pkg.scope.pathPolicy}.\n\n` +
    `Verification:\n\n${pkg.verification.map(v => `- ${v.status}; exit ${v.exitCode ?? "none"}; duration ${v.durationMs} ms`).join("\n")}\n\n` +
    `Reasons: ${pkg.reasons.join(", ") || "none"}.\n\nCanonical evidence: review-package.json. Executor report is untrusted evidence, not a verification result.\n`;
}
export async function reviewLocalHandoff(input: Readonly<{ repository: string; manifest: string; report: string; out?: string }>, options: LocalHandoffOptions = {}): Promise<LocalHandoffResult> {
  let manifest: HandoffManifest, context: Awaited<ReturnType<typeof repositoryContext>>, out: string;
  try {
    context = await repositoryContext(input.repository); manifest = await loadManifest(input.manifest);
    if (inside(context.root, await canonicalPath(input.manifest))) block("unsafe_manifest_location");
    out = await outputPath(context.root, input.out, `pac-review-${manifest.baseline.head.slice(0, 12)}-${manifest.task.id}`);
  } catch (error) { return freezeDeep({ status: "blocked", reasons: [safeReason(error)] }); }
  const reasons: string[] = [], paths: string[] = [], unauthorized: string[] = [];
  let baseline = "not_run", pathPolicy: "passed" | "failed" | "not_run" = "not_run", forbiddenPaths = "not_run", secretScan = "not_run";
  const findings: { path: string; category: string; count: number }[] = [];
  let patch: Buffer | null = null, report: Buffer | null = null;
  const verification: VerificationRecord[] = manifest.verificationCommands.map(notRun);
  try {
    if (context.baseline.repositoryFingerprint !== manifest.baseline.repositoryFingerprint || context.baseline.branch !== manifest.baseline.branch || context.baseline.head !== manifest.baseline.head) block("baseline_changed");
    baseline = "passed";
    if ((await git(context.root, ["diff", "--cached", "--quiet"])).code !== 0) block("index_changed");
    const candidates = await changedPaths(context.root);
    // Validate ALL path metadata before publishing any: a filename can itself contain a secret.
    for (const path of candidates) {
      for (const finding of findProbableSecrets(path)) findings.push({ path: "[withheld-path]", ...finding });
      ensureSafeEvidence(path);
    }
    paths.push(...candidates);
    for (const path of paths) {
      if (isSystemForbiddenRepositoryPath(path) || !manifest.normalizedAllowedPaths.some(parent => repositoryPathContains(parent, path))) unauthorized.push(path);
    }
    forbiddenPaths = paths.some(isSystemForbiddenRepositoryPath) ? "failed" : "passed";
    pathPolicy = unauthorized.length ? "failed" : "passed";
    if (unauthorized.length) block("changed_path_denied");
    const captured = await capture(context.root, paths, manifest.baseline);
    const reportPath = await canonicalPath(input.report);
    if (inside(context.root, reportPath)) block("unsafe_report_location");
    const reportData = await readRegular(reportPath, localHandoffLimits.maxReportBytes), reportText = decode(reportData);
    if (!reportText.trim()) block("missing_executor_report");
    for (const [path, content] of [["change.patch", decode(captured.patch)], ["executor-report.md", reportText]]) {
      for (const finding of findProbableSecrets(content)) findings.push({ path, ...finding });
      ensureSafeEvidence(content);
    }
    secretScan = "passed"; patch = captured.patch; report = reportData;
    for (let index = 0; index < verification.length; index++) {
      // Recheck HEAD/branch before each check; final patch comparison detects verification writes.
      const current = await repositoryContext(context.root);
      if (json(current.baseline) !== json(manifest.baseline)) block("baseline_changed");
      verification[index] = await runLocalVerification(context.root, manifest.verificationCommands[index], options);
    }
    const after = await repositoryContext(context.root);
    if (json(after.baseline) !== json(manifest.baseline)) block("baseline_changed");
    if ((await git(context.root, ["diff", "--cached", "--quiet"])).code !== 0) block("index_changed");
    const finalPaths = await changedPaths(context.root);
    if (json(finalPaths) !== json(paths)) block("worktree_changed_during_verification");
    const final = await capture(context.root, finalPaths, manifest.baseline);
    if (final.fingerprint !== captured.fingerprint) block("worktree_changed_during_verification");
    if (verification.some(v => v.status !== "passed")) block(verification.some(v => v.status === "unsupported") ? "unsupported_command" : "verification_failed");
  } catch (error) {
    const code = safeReason(error); reasons.push(code);
    if (code === "baseline_changed") baseline = "failed";
    if (code === "probable_secret") { secretScan = "failed"; patch = null; report = null; }
  }
  const pkg: ReviewPackage = freezeDeep({ schemaVersion: 1, policyVersion: localHandoffPolicyVersion,
    outcome: reasons.length ? "blocked" : "ready_for_owner", ownerDecisionRequired: true,
    identity: { task: manifest.task, selectedExecutor: manifest.selectedExecutor, baseline: manifest.baseline },
    scope: { approvedPaths: manifest.normalizedAllowedPaths, actualChangedPaths: paths, unauthorizedPaths: unauthorized, pathPolicy },
    artifacts: { taskArtifact: manifest.taskArtifact, patch: patch ? artifactMetadata("change.patch", patch) : null, executorReport: report ? artifactMetadata("executor-report.md", report) : null },
    verification, security: { baseline, forbiddenPaths, secretScan, whitespace: verification.find(v => v.command === "git diff --check")?.status ?? "not_run", findings },
    reasons: [...new Set(reasons)].sort(compare) });
  try {
    const files: Record<string, Buffer | string> = {};
    if (patch) files["change.patch"] = patch; if (report) files["executor-report.md"] = report;
    // Publish canonical ready metadata LAST: a failed earlier write cannot leave a ready package.
    files["review-package.md"] = markdown(pkg); files["review-package.json"] = json(pkg);
    await writeArtifacts(out, files);
    return freezeDeep({ status: pkg.outcome, reasons: pkg.reasons, package: pkg });
  } catch (error) {
    // Never claim ready if evidence publication failed. Do not delete caller files.
    try { if (!(await readdir(out)).length) await rmdir(out); } catch { /* Keep incomplete evidence for human recovery. */ }
    return freezeDeep({ status: "blocked", reasons: [safeReason(error)] });
  }
}
