import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile), root = new URL("../../", import.meta.url);
const mutations = [
  { name: "M8 unknown executor outcome redispatched", module: "lib/roadmap/development-controller.ts", environment: "B3_CONTROLLER_MODULE",
    source: 'if (observation.status !== "settled") return done(await store.changeTaskState({ ...command, nextStatus: "recovery_required" }));',
    replacement: 'if (observation.status !== "settled") { await call(start!, intent); return done(await store.changeTaskState({ ...command, nextStatus: "recovery_required" })); }',
    test: "tests/pg/development-controller.test.mts", pattern: "^B3 ambiguous transmission" },
  { name: "M9 Router selection treated as start authority", module: "lib/roadmap/development-controller.ts", environment: "B3_CONTROLLER_MODULE",
    source: "return done(await store.saveAttemptIntent({", replacement: "await call(start!, { ...candidate, context, executionPolicy }); return done(await store.saveAttemptIntent({",
    test: "tests/pg/development-controller.test.mts", pattern: "^B3 Router selection" },
  // B3's corrective port uses this very same accepted store and barrier. Exercise both
  // directions against factual authority advance + unresolved historical exposure; no
  // controller-only imitation or artificial provider/account-specific barrier is used.
  { name: "M15 common predecessor barrier bypassed on corrective executor switch", module: "lib/db/executor-start-store.ts", environment: "PORTABILITY_CORE_MODULE",
    source: "active && !await executorPredecessorsClear", replacement: "false && !await executorPredecessorsClear",
    test: "tests/pg/executor-portability.test.mts", pattern: "^D PG switch" },
] as const;
for (const mutant of mutations) test(`B3 ${mutant.name}: compiled behavioral PostgreSQL mutant killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-b3-controller-mutant-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const original = new URL(mutant.module, root), source = await readFile(original, "utf8"), candidatePath = join(temp, "mutant.mts");
  assert.equal(source.split(mutant.source).length, 2, "mutation anchor must match exactly once");
  const relocate = (text: string) => text.replace(/(from\s+)["'](\.[^"']+\.ts)["']/gu, (_match, from, relative) => `${from}${JSON.stringify(new URL(relative, original).href)}`);
  const environment: NodeJS.ProcessEnv = { ...process.env, [mutant.environment]: candidatePath }; delete environment.NODE_TEST_CONTEXT;
  const args = ["--test", "--test-reporter=tap", "--test-name-pattern", mutant.pattern, fileURLToPath(new URL(mutant.test, root))];
  await writeFile(candidatePath, relocate(source));
  const green = await exec(process.execPath, args, { env: environment, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  assert.match(green.stdout, /# fail 0/u); assert.match(green.stdout, /# pass [1-9]/u);
  await writeFile(candidatePath, relocate(source.replace(mutant.source, mutant.replacement)));
  // Import probe must succeed before behavioral execution. An import/compile failure
  // is NOT a security mutation kill and cannot satisfy this gate.
  await exec(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(candidatePath).href)})`], { env: environment, timeout: 15000 });
  let output = "";
  try { await exec(process.execPath, args, { env: environment, timeout: 60000, maxBuffer: 2 * 1024 * 1024 }); assert.fail(`${mutant.name} survived`); }
  catch (error) { const failed = error as Error & { code?: number; stdout?: string; stderr?: string };
    assert.equal(failed.code, 1, "only an executed behavioral failure counts"); output = `${failed.stdout}\n${failed.stderr}`; }
  assert.match(output, /ERR_ASSERTION/u);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic("original exit0; mutant import exit0; real PostgreSQL behavioral assertions exit1; disposable copies/databases removed");
});
