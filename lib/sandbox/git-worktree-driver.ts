import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FileIdentity, WorktreeReason, WorktreeRepository } from "./worktree-port";

const exec = promisify(execFile);
export class WorktreeBlocked extends Error {
  readonly reason: WorktreeReason;
  constructor(reason: WorktreeReason) { super(reason); this.reason = reason; }
}
export function requireWorktree(value: unknown, reason: WorktreeReason): asserts value { if (!value) throw new WorktreeBlocked(reason); }
export function safeAbsolute(path: unknown): asserts path is string {
  requireWorktree(typeof path === "string" && path.length <= 1024 && isAbsolute(path) && normalize(path) === path
    && !/[\x00-\x1f\x7f~`$;|&<>!*?{}\[\]\\]/u.test(path), "path_invalid");
}
export function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child); return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
export const sameFile = (a: FileIdentity, b: FileIdentity) => a.device === b.device && a.inode === b.inode;
export async function directory(path: string): Promise<FileIdentity> {
  safeAbsolute(path);
  const stat = await lstat(path);
  requireWorktree(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path, "path_invalid");
  return { device: stat.dev, inode: stat.ino };
}
export async function absent(path: string): Promise<boolean> {
  try { await lstat(path); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
}

/** Private fixed operations only. No caller command, shell, inherited env, network or hooks. */
async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const result = await exec("/usr/bin/git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
      "-c", "core.attributesFile=/dev/null", "-c", "core.sparseCheckout=false", "-c", "submodule.recurse=false",
      "-c", "protocol.allow=never", ...args], {
      cwd, shell: false, timeout: 15000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, encoding: "utf8",
      env: { NODE_ENV: "production", PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_ATTR_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0", GIT_LFS_SKIP_SMUDGE: "1" },
    });
    return result.stdout;
  } catch { throw new WorktreeBlocked("git_operation_failure"); }
}
export type FactualWorktree = Readonly<{ path: string; head: string; detached: boolean; locked: boolean; prunable: boolean }>;
export async function inspectWorktrees(repository: WorktreeRepository): Promise<readonly FactualWorktree[]> {
  const output = await git(repository.root, ["worktree", "list", "--porcelain", "-z"]);
  requireWorktree(output.length <= 256 * 4096, "verification_failure");
  const records = output.split("\0\0").filter(Boolean);
  requireWorktree(records.length <= 256, "verification_failure");
  return records.map(record => {
    const fields = record.split("\0").filter(Boolean), paths = fields.filter(x => x.startsWith("worktree "));
    const heads = fields.filter(x => x.startsWith("HEAD "));
    requireWorktree(paths.length === 1 && heads.length === 1, "verification_failure");
    const path = paths[0].slice(9), head = heads[0].slice(5);
    safeAbsolute(path); requireWorktree(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head), "verification_failure");
    return { path, head, detached: fields.includes("detached"), locked: fields.some(x => x === "locked" || x.startsWith("locked ")),
      prunable: fields.some(x => x === "prunable" || x.startsWith("prunable ")) };
  });
}
export async function validateRepository(repository: WorktreeRepository): Promise<void> {
  try {
    safeAbsolute(repository.root); safeAbsolute(repository.commonDirectory);
    requireWorktree(sameFile(await directory(repository.root), repository.rootIdentity)
      && sameFile(await directory(repository.commonDirectory), repository.commonIdentity), "repository_invalid");
    // No local includes/filters/external object stores. worktreeConfig could hide a second config.
    const config = resolve(repository.commonDirectory, "config"), stat = await lstat(config);
    requireWorktree(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, "repository_invalid");
    const keys = (await git(repository.root, ["config", "--file", config, "--no-includes", "--name-only", "--list"])).split("\n").filter(Boolean);
    requireWorktree(keys.length <= 256 && keys.every(k => !/^(?:include\.|includeif\.|filter\.|extensions\.worktreeconfig$|core\.worktree$)/iu.test(k)), "repository_invalid");
    for (const path of ["objects/info/alternates", "info/grafts"]) requireWorktree(await absent(resolve(repository.commonDirectory, path)), "repository_invalid");
    requireWorktree((await git(repository.root, ["rev-parse", "--show-toplevel"])).trim() === repository.root, "repository_invalid");
    const common = (await git(repository.root, ["rev-parse", "--git-common-dir"])).trim();
    requireWorktree(await realpath(resolve(repository.root, common)) === repository.commonDirectory, "repository_invalid");
    requireWorktree((await git(repository.root, ["rev-parse", "--is-bare-repository"])).trim() === "false", "repository_invalid");
  } catch { throw new WorktreeBlocked("repository_invalid"); }
}
export async function verifyBaseline(repository: WorktreeRepository, baseline: string): Promise<void> {
  requireWorktree(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(baseline), "baseline_missing");
  let actual: string;
  try { actual = (await git(repository.root, ["rev-parse", "--verify", `${baseline}^{commit}`])).trim(); }
  catch { throw new WorktreeBlocked("baseline_missing"); }
  requireWorktree(actual === baseline, "baseline_mismatch");
}
export const addWorktree = (repository: WorktreeRepository, path: string, baseline: string) => git(repository.root, ["worktree", "add", "--detach", "--", path, baseline]);
export const removeWorktree = (repository: WorktreeRepository, path: string) => git(repository.root, ["worktree", "remove", "--force", "--", path]);
export async function verifyWorktree(repository: WorktreeRepository, path: string): Promise<string> {
  const rows = await inspectWorktrees(repository), found = rows.filter(row => row.path === path);
  requireWorktree(found.length === 1 && found[0].detached && !found[0].locked && !found[0].prunable, "resource_mismatch");
  requireWorktree((await git(path, ["rev-parse", "--show-toplevel"])).trim() === path, "resource_mismatch");
  const common = (await git(path, ["rev-parse", "--git-common-dir"])).trim();
  requireWorktree(await realpath(resolve(path, common)) === repository.commonDirectory, "resource_mismatch");
  const head = (await git(path, ["rev-parse", "--verify", "HEAD"])).trim();
  requireWorktree(head === found[0].head, "verification_failure"); return head;
}
