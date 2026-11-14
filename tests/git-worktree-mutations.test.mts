import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
const exec = promisify(execFile);
const adapterUrl = new URL("../lib/sandbox/git-worktree-adapter.ts", import.meta.url);
const source = await readFile(adapterUrl, "utf8");
const tests = await readFile(new URL("./git-worktree-adapter.test.mts", import.meta.url), "utf8");
const mutations: readonly [string, string | RegExp, string][] = [
  ["M1", /    requireWorktree\(!contains\(record\.repository\.root, root\)[\s\S]*?\/\/ M1/u, "    // M1 removed root isolation check"],
  ["M2", '    requireWorktree(head === record.baselineCommit, "baseline_mismatch"); // M2', "    // M2 no exact baseline check"],
  ["M3", " && record.identity.resourceGeneration === o.resourceGeneration // M3", " // M3 no generation binding"],
  ["M4", /  requireWorktree\(record\.path === join\(root, record\.resourceId, "checkout"\)[^\n]+\/\/ M4/u, "  // M4 arbitrary stored path accepted"],
  ["M5", /  requireWorktree\(\/\^\[a-z0-9\][\s\S]*?\/\/ M5/u, "  // M5 protected branch restriction removed"],
  ["M6", "          if (record) { // M6", "          if (false) { // M6 no exact replay guard"],
  ["M7", "            actualHead = await fact(record); // M7", "            actualHead = record.baselineCommit; // M7 trusts requested HEAD"],
  ["M8", /function authorizeCreation\([\s\S]*?(?=function authorizeCleanup)/u,
    "function authorizeCreation(context: WorktreeContext, o: WorktreeOperation): SandboxExecutionSnapshot { return bind(context, o); }\n"],
];
for (const [name, search, replacement] of mutations) test(`${name}: real Git probe GREEN on original, RED on security mutation`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-ai0422-mutant-"));
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const modulePath = join(temp, "adapter.mts"), testPath = join(temp, "probe.test.mts");
  const relocate = (text: string) => text.replace('"../local-handoff/local-handoff-policy.ts"', JSON.stringify(new URL("../lib/local-handoff/local-handoff-policy.ts", import.meta.url).href))
    .replace('"./git-worktree-driver.ts"', JSON.stringify(new URL("../lib/sandbox/git-worktree-driver.ts", import.meta.url).href));
  const relocatedTests = tests.replace('"./fixtures/git-worktree.mts"', JSON.stringify(new URL("./fixtures/git-worktree.mts", import.meta.url).href))
    .replace('"../lib/sandbox/git-worktree-adapter.ts"', JSON.stringify(pathToFileURL(modulePath).href));
  await writeFile(testPath, relocatedTests);
  await writeFile(modulePath, relocate(source));
  const args = ["--test", "--test-reporter=tap", "--test-name-pattern", `^${name} `, testPath];
  const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT;
  const green = await exec(process.execPath, args, { env: environment, timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.match(green.stdout, /# pass 1/u); assert.match(green.stdout, /# fail 0/u);
  const mutated = source.replace(search, replacement); assert.notEqual(mutated, source, `${name} anchor must exist`);
  await writeFile(modulePath, relocate(mutated));
  let output = "";
  try { await exec(process.execPath, args, { env: environment, timeout: 30000, maxBuffer: 1024 * 1024 }); assert.fail(`${name} survived`); }
  catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    assert.equal(failure.code, 1, `${name} must fail with a test assertion`);
    output = `${failure.stdout}\n${failure.stderr}`;
  }
  assert.match(output, /ERR_ASSERTION/u);
  assert.doesNotMatch(output, /SyntaxError|ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic(`${name}: original=exit0/pass1; mutant=exit1/ERR_ASSERTION; production files untouched`);
});
