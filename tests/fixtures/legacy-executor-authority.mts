import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after } from "node:test";

/** Run HISTORICAL populated-upgrade probes with their actual pre-0018 application.
 * Never downgrade current schema/store. Copies are pinned to the accepted baseline,
 * outside the repo, and use the same existing policy/transaction/identity algorithms. */
const baseline = "45c55e56ed98df2e40822cee1e3c89ca90a54d1a";
const root = new URL("../../", import.meta.url);
const temp = await mkdtemp(join(tmpdir(), "pac-legacy-authority-"));
after(async () => { await rm(temp, { recursive: true, force: true }); });
const files = ["lib/executors/executor-current-authority.ts", "lib/db/executor-current-authority-store.ts", "lib/db/executor-start-store.ts"];
const mapped = new Map(files.map((p, i) => [new URL(p, root).href, pathToFileURL(join(temp, `${i}.mts`)).href]));
export function relocateLegacyExecutor(source: string, original: URL) {
  return source.replace(/(from\s+)["'](\.[^"']+\.ts)["']/gu, (_m, from, relative) => {
    const url = new URL(relative, original).href; return `${from}${JSON.stringify(mapped.get(url) ?? url)}`;
  });
}
for (const p of files) {
  const content = execFileSync("git", ["show", `${baseline}:${p}`], { cwd: root, encoding: "utf8" });
  await writeFile(new URL(mapped.get(new URL(p, root).href)!), relocateLegacyExecutor(content, new URL(p, root)));
}
export const legacyAuthority = await import(mapped.get(new URL(files[1], root).href)!) as typeof import("../../lib/db/executor-current-authority-store");
export const legacyCore = await import(mapped.get(new URL(files[2], root).href)!) as typeof import("../../lib/db/executor-start-store");
