import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = new URL("../../", import.meta.url);
const modules = ["executor-start-store", "executor-predecessor-barrier"];
const check = "active && !await executorPredecessorsClear";
const mutations = [
  ["M1 remove barrier", "executor-start-store", check, "false && !await executorPredecessorsClear", "^B1 core"],
  ["M2 scope by account", "executor-predecessor-barrier", "and e.attempt_number < $3", "and e.attempt_number < $3 and e.account_id='account-b'", "^B1 account/model"],
  ["M3 reconciliation treated clear", "executor-predecessor-barrier", "requireFact(p.started); blocked = true;", 'requireFact(p.started); blocked = p.state === "start_committed" || blocked;', "^B1 reconciliation"],
  ["M4 expiry treated clear", "executor-predecessor-barrier", "and e.attempt_number < $3", "and e.attempt_number < $3 and e.expires_at > clock_timestamp()", "^B1 TTL"],
  ["M5 reserve-only barrier", "executor-start-store", check, "active && initialize && !await executorPredecessorsClear", "^B1 legacy"],
  ["M6 zero tokens treated clear", "executor-predecessor-barrier", "and e.attempt_number < $3", "and e.attempt_number < $3 and e.observed_total_tokens is distinct from 0", "^B1 reconciliation"],
  ["M7 historical settlement needs current authority", "executor-start-store", '!fingerprint(requestFingerprint) ? denied() : await run(raw, false, false,', '!fingerprint(requestFingerprint) ? denied() : await run(raw, false, true,', "^B1 core"],
  ["M8 query wrong Run", "executor-predecessor-barrier", "[workspace, runId, number]", '[workspace, runId + "-wrong", number]', "^B1 core"],
] as const;
for (const [name, module, search, replacement, pattern] of mutations) test(`${name}: real PG original GREEN; behavioral mutant killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-ai0412b1-mutant-"));
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const paths = new Map(modules.map(name => [new URL(`lib/db/${name}.ts`, root).href, pathToFileURL(join(temp, `${name}.mts`)).href]));
  function relocate(text: string, original: URL) {
    return text.replace(/(from\s+)["'](\.[^"']+\.ts)["']/gu, (_m, from, relative) => {
      const url = new URL(relative, original).href; return `${from}${JSON.stringify(paths.get(url) ?? url)}`;
    });
  }
  for (const name of modules) {
    const url = new URL(`lib/db/${name}.ts`, root);
    await writeFile(new URL(paths.get(url.href)!), relocate(await readFile(url, "utf8"), url));
  }
  const environment: NodeJS.ProcessEnv = { ...process.env, EXECUTOR_BARRIER_TEST_MODULE: join(temp, "executor-start-store.mts") }; delete environment.NODE_TEST_CONTEXT;
  const args = ["--test", "--test-reporter=tap", "--test-name-pattern", pattern, fileURLToPath(new URL("tests/pg/executor-predecessor.test.mts", root))];
  const green = await exec(process.execPath, args, { env: environment, timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  assert.match(green.stdout, /# fail 0/u); assert.match(green.stdout, /# pass [1-9]/u);
  const original = new URL(`lib/db/${module}.ts`, root), source = await readFile(original, "utf8");
  assert.equal(source.split(search).length, 2, "mutation anchor must match exactly once");
  await writeFile(new URL(paths.get(original.href)!), relocate(source.replace(search, replacement), original));
  let output = "";
  try { await exec(process.execPath, args, { env: environment, timeout: 45000, maxBuffer: 2 * 1024 * 1024 }); assert.fail(`${name} survived`); }
  catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    assert.equal(failure.code, 1, "mutant must exit via behavioral failure, not timeout/crash"); output = `${failure.stdout}\n${failure.stderr}`;
  }
  assert.match(output, /ERR_ASSERTION/u);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic(`${name}: original=exit0; mutant=exit1/ERR_ASSERTION; actual PG statements executed; temp copies cleaned`);
});
