import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile), root = new URL("../", import.meta.url);
const modules = ["lib/executors/executor-router.ts", "lib/execution-environment/execution-environment.ts", "lib/execution-environment/managed-execution-environment-policy.ts"];
const router = modules[0], environment = modules[2];
const mutations = [
  ["M1 risk filter removed", router, 'if (risks.indexOf(c.maxRisk) < risks.indexOf(r.risk))', 'if (false)'],
  ["M2 soft preference bypasses safety", router, 'const reasons = rejection(c, r);', 'const reasons = r.preferredExecutorIds.includes(c.executor.id) ? [] : rejection(c, r);'],
  ["M3 unknown cost treated as zero", router, 'if (c.estimatedCostUsdMicros === null) reasons.push("cost_unknown");', 'if (c.estimatedCostUsdMicros === null) { /* fabricated zero */ }'],
  ["M4 unknown quality treated as perfect", router, 'if (c.quality === null) reasons.push("quality_unknown");', 'if (c.quality === null) { /* fabricated perfect */ }'],
  ["M5 unavailable accepted", router, 'if (c.availability.state !== "available")', 'if (false)'],
  ["M6 local and VPS allowed", environment, 'if (e.kind === "local" || e.kind === "vps_self_hosted")', 'if (false)'],
  ["M7 self-hosted access allowed", router, 'm !== "self_hosted" && c.accessModes.includes(m)', 'c.accessModes.includes(m)'],
  ["M8a residency filter removed", environment, 'if (r.residency !== null &&', 'if (false && r.residency !== null &&'],
  ["M8b privacy filter removed", environment, 'if (r.privacy.length &&', 'if (false && r.privacy.length &&'],
  ["M9 candidate order becomes evidence order", router, '.sort((a, b) => compare(a.routeId, b.routeId));', ';'],
  ["M10 route grants dispatch authority", router, 'rejected, routeFingerprint, requirementsFingerprint, candidateSetFingerprint, dispatchAuthorized: false', 'rejected, routeFingerprint, requirementsFingerprint, candidateSetFingerprint, dispatchAuthorized: true'],
  ["M11 unknown capability accepted", environment, 'if (r.capabilities.some(k => !supported(e.capabilities[k])))', 'if (false)'],
  ["M12 hard pin silently falls back", router, 'if (r.requiredExecutorId !== null && c.executor.id !== r.requiredExecutorId)', 'if (false)'],
  ["M13 latency unknown treated as zero", router, 'if (c.estimatedLatencyMs === null) reasons.push("latency_unknown");', 'if (c.estimatedLatencyMs === null) { /* fabricated zero */ }'],
  ["M14 quota exhausted accepted", router, 'if (r.requireQuota && c.quota.state !== "available")', 'if (false)'],
  ["M15 task-class hard filter removed", router, 'if (!c.taskClasses.includes(r.taskClass))', 'if (false)'],
] as const;
for (const [name, module, anchor, replacement] of mutations) test(`B2 ${name}: executed behavioral mutation killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-b2-mutant-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const paths = new Map(modules.map(p => [new URL(p, root).href, pathToFileURL(join(temp, p.split("/").at(-1)!.replace(/\.ts$/u, ".mts"))).href]));
  function relocate(source: string, original: URL) {
    return source.replace(/(from\s+)["'](\.[^"']+\.ts)["']/gu, (_m, from, relative) => {
      const target = new URL(relative, original).href; return `${from}${JSON.stringify(paths.get(target) ?? target)}`;
    });
  }
  for (const p of modules) { const original = new URL(p, root); await writeFile(new URL(paths.get(original.href)!), relocate(await readFile(original, "utf8"), original)); }
  const env: NodeJS.ProcessEnv = { ...process.env, B2_ROUTER_MODULE: new URL(paths.get(new URL(router, root).href)!).pathname,
    B2_ENV_MODULE: new URL(paths.get(new URL(environment, root).href)!).pathname };
  delete env.NODE_TEST_CONTEXT;
  const args = ["--test", "--test-reporter=tap", "tests/executor-router.test.mts", "tests/managed-execution-environment.test.mts"];
  const green = await exec(process.execPath, args, { cwd: root, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.match(green.stdout, /# fail 0/u); assert.match(green.stdout, /# tests 78/u);
  const original = new URL(module, root), source = await readFile(original, "utf8"); assert.equal(source.split(anchor).length, 2, "unique live mutation anchor");
  await writeFile(new URL(paths.get(original.href)!), relocate(source.replace(anchor, replacement), original));
  let output = "";
  try { await exec(process.execPath, args, { cwd: root, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }); assert.fail(`${name} survived`); }
  catch (error) { const failure = error as Error & { code: number; stdout: string; stderr: string }; assert.equal(failure.code, 1); output = `${failure.stdout}\n${failure.stderr}`; }
  assert.match(output, /ERR_ASSERTION/u); assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic(`${name}: original 78/78 exit0; mutant exit1 with behavioral assertion; no compile/import-only kill`);
});
