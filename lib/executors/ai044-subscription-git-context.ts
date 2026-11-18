// Physical Node-only Git reader. Kept outside pure context/manifest dependencies so
// read-only Owner projections never import dynamic filesystem/process operations.
import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { AI044ExactObjectPort, AI044ExactObjectRequest } from "./ai044-subscription-context";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044SubscriptionOwnData as own, ai044SubscriptionContextPath as contextPath, ai044SubscriptionContextLimits } from "./ai044-subscription-context.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044Id } from "./ai044-proof-binding.ts";
const invalid = (): never => { throw Error("subscription_context_unavailable"); };

/** Fixed read-only Git operations. No shell, checkout, hooks, external filters, inherited credentials or network. */
export function createAI044SubscriptionGitObjectReader(input: Readonly<{ repositoryRoot: string; repositoryId: string }>): AI044ExactObjectPort {
  const config = own(input, ["repositoryRoot", "repositoryId"]);
  if (!ai044Id(config.repositoryId)) invalid();
  if (typeof config.repositoryRoot !== "string" || !isAbsolute(config.repositoryRoot) || config.repositoryRoot.length > 1024 || /[\0\r\n]/u.test(config.repositoryRoot)) invalid();
  const root = config.repositoryRoot as string;
  const git = (args: readonly string[], maximum: number): Promise<Buffer> => new Promise((resolve, reject) => {
    execFile("/usr/bin/git", ["--no-replace-objects", "--literal-pathspecs", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never", ...args], {
      cwd: root, encoding: "buffer", maxBuffer: maximum, timeout: 15000, killSignal: "SIGKILL", shell: false,
      env: { NODE_ENV: "production", PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_ATTR_NOSYSTEM: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
    }, (error, stdout) => error ? reject(Error("subscription_context_unavailable")) : resolve(stdout));
  });
  return Object.freeze({ async readExactObject(request: AI044ExactObjectRequest) {
    try {
      const r = own(request, ["repositoryId", "baseline", "path"]);
      if (r.repositoryId !== config.repositoryId || typeof r.baseline !== "string" || !/^[a-f0-9]{40}$/u.test(r.baseline)) invalid();
      const baselineInput = r.baseline as string, path = contextPath(r.path), stat = await lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) invalid();
      const common = (await git(["rev-parse", "--git-common-dir"], 4096)).toString("utf8").trim();
      for (const forbidden of ["objects/info/alternates", "info/grafts"]) {
        try { await lstat(resolve(root, common, forbidden)); invalid(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") invalid(); }
      }
      const baseline = (await git(["rev-parse", "--verify", `${baselineInput}^{commit}`], 1024)).toString("utf8").trim(); if (baseline !== baselineInput) invalid();
      const segments = path.split("/");
      for (let index = 1; index < segments.length; index++) {
        const prefix = segments.slice(0, index).join("/"), ancestor = (await git(["ls-tree", "-z", baselineInput, "--", prefix], 4096)).toString("utf8");
        if (!ancestor.length) break;
        const tree = /^040000 tree [a-f0-9]{40}\t([^\0]+)\0$/u.exec(ancestor); if (!tree || tree[1] !== prefix) invalid();
      }
      const listing = await git(["ls-tree", "-z", baselineInput, "--", path], 4096);
      if (!listing.length) return Object.freeze({ kind: "absent" });
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(listing.toString("utf8")); if (!match || match[3] !== path) invalid();
      const length = (await git(["cat-file", "-s", match![2]], 1024)).toString("utf8").trim();
      if (!/^(?:0|[1-9][0-9]{0,6})$/u.test(length) || Number(length) > ai044SubscriptionContextLimits.fileBytes) invalid();
      const bytes = await git(["cat-file", "blob", match![2]], ai044SubscriptionContextLimits.fileBytes + 1); if (bytes.length !== Number(length)) invalid();
      return Object.freeze({ kind: "blob", mode: match![1], blobId: match![2], bytes });
    } catch { throw Error("subscription_context_unavailable"); }
  } });
}
