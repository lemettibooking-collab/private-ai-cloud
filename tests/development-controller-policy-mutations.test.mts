import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile), root = new URL("../", import.meta.url), original = new URL("lib/roadmap/development-controller-policy.ts", root);
const mutations = [
  ["M19 dependent starts before previous wave completion", "  const waves = buildDevelopmentTaskWaves(plan);", '  const earlyDependent = plan.tasks.find(t => t.dependencyIds.some(id => !state.runs.some(r => r.run.taskId === id && r.run.status === "completed")));\n  if (earlyDependent) return next("create_development_run", null, earlyDependent.id);\n  const waves = buildDevelopmentTaskWaves(plan);'],
  ["M20 completed DevelopmentTask reruns after restart", "  const status = state.task.status;", '  state = { ...state, runs: state.runs.filter(r => r.run.status !== "completed") };\n  const status = state.task.status;'],
  ["M21 first started run serializes disjoint executor progress", "  const frontier: ControllerNext[] = [];", '  const firstStarted = wave.map(t => state.runs.find(r => r.run.taskId === t.id)).find(r => r?.run.status === "implementing" && state.operations.some(o => o.developmentRunId === r.run.id && o.attemptNumber === r.run.currentAttemptNumber && o.kind === "executor"));\n  if (firstStarted) return next("await_executor_outcome", firstStarted.run.id, firstStarted.run.taskId);\n  const frontier: ControllerNext[] = [];'],
] as const;
for (const [name, anchor, replacement] of mutations) test(`B3 ${name}: executable behavioral mutation killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-b3-policy-mutant-")); t.after(() => rm(temp, { recursive: true, force: true }));
  const target = pathToFileURL(join(temp, "development-controller-policy.mts")), source = await readFile(original, "utf8");
  const relocate = (value: string) => value.replace(/(from\s+)["'](\.[^"']+\.ts)["']/gu, (_all, from, relative) => `${from}${JSON.stringify(new URL(relative, original).href)}`);
  await writeFile(target, relocate(source));
  const env: NodeJS.ProcessEnv = { ...process.env, B3_CONTROLLER_POLICY_MODULE: target.href }; delete env.NODE_TEST_CONTEXT;
  const args = ["--test", "--test-reporter=tap", "tests/development-controller-policy.test.mts"];
  const green = await exec(process.execPath, args, { cwd: root, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }); assert.match(green.stdout, /# fail 0/u);
  assert.equal(source.split(anchor).length, 2, "unique live mutation anchor"); await writeFile(target, relocate(source.replace(anchor, replacement)));
  let output = "";
  try { await exec(process.execPath, args, { cwd: root, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }); assert.fail(`${name} survived`); }
  catch (error) { const failure = error as Error & { code: number; stdout: string; stderr: string }; assert.equal(failure.code, 1); output = `${failure.stdout}\n${failure.stderr}`; }
  assert.match(output, /ERR_ASSERTION/u); assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic(`${name}: unchanged source GREEN then mutant behavioral RED; no import/compile-only kill`);
});
