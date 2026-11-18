import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile), root = new URL("../", import.meta.url);
type Mutation = readonly [string, string, string, string, readonly (readonly [string, string])[]];
const mutations: readonly Mutation[] = [
  ["M1 unknown container maximum treated as zero", "ai044-readiness", "ai044-readiness", "valid Owner approval", [
    ["hostedContainerMaximumUsdMicros: null,", "hostedContainerMaximumUsdMicros: 0,"],
  ]],
  ["M2 account hard limit accepted as run cap", "ai044-readiness", "ai044-readiness", "delayed account hard limit", [
    ['if (c.kind === "account_hard_limit") reasons.push', 'if (false) reasons.push'],
  ]],
  ["M3 Owner approval bypasses financial gate", "ai044-readiness", "ai044-readiness", "valid Owner approval", [
    ['if (!approval) reasons.push', 'if (approval) return freezeAI044({ verdict: "allow", startCapability: {} }); if (!approval) reasons.push'],
  ]],
  ["M4 denied composition reaches provider transport", "ai044-readiness", "ai044-readiness", "blocked composition", [
    ['startProof: (input: unknown): AI044BlockedReadiness => evaluateAI044LiveReadiness(input)',
      'startProof: (input: unknown): AI044BlockedReadiness => { void globalThis.fetch("https://api.openai.com/v1/agents/sessions"); return evaluateAI044LiveReadiness(input); }'],
  ]],
  ["M5 credentials resolved before readiness", "ai044-readiness", "ai044-readiness", "without invoking getters", [
    ['export function evaluateAI044LiveReadiness(raw: unknown): AI044BlockedReadiness {',
      'export function evaluateAI044LiveReadiness(raw: unknown): AI044BlockedReadiness { void (raw as Record<string, unknown>)?.credentials;'],
  ]],
  ["M6 unknown billable category ignored", "ai044-readiness", "ai044-readiness", "unknown extra category", [
    ['f.categories.length !== ai044FinancialCategories.length', 'f.categories.length < ai044FinancialCategories.length'],
    ['const c = exactAI044Record(f.categories[index], ["category", "kind", "maximumUsdMicros"]);',
      'const c = exactAI044Record(f.categories[index], ["category", "kind", "maximumUsdMicros"]); if (!ai044FinancialCategories.includes(c.category as AI044FinancialCategory)) continue;'],
  ]],
  ["M7 stale Owner approval reused", "ai044-readiness", "ai044-readiness", "stale/reused/general", [
    ['a.expiresAt <= now', 'false'],
  ]],
  ["M8 remote tests-passed accepted as local QA", "ai044-qa-handoff", "ai044-qa-handoff", "invalid review source", [
    ['e.source !== "trusted_local_runner"', 'false'],
  ]],
  ["M9 producer self-certifies independent Security", "ai044-qa-handoff", "ai044-qa-handoff", "invalid review securityReviewerId", [
    ['e.producerId === e.securityReviewerId', 'false'],
  ]],
  ["M10 unlimited provider spend accepted", "ai044-proof-binding", "ai044-readiness", "binding denies drift", [
    ['b.modelSpendLimitCents < 1', 'false'],
  ]],
  ["M11 archive SHA ignored", "ai044-hosted-profile", "ai044-hosted-profile", "changed archive SHA", [
    ['if (archiveSha256 !== binding.archiveSha256) invalid();', 'if (false) invalid();'],
  ]],
  ["M12 unrestricted network accepted", "ai044-hosted-profile", "ai044-hosted-profile", "broadened/unknown shape", [
    ['if (n.access !== "restricted" || !Array.isArray(n.allowed_domains) || n.allowed_domains.length !== 1 || n.allowed_domains[0] !== registry) return null;', 'if (false) return null;'],
  ]],
  ["M13 sandbox receives credential bytes", "ai044-hosted-profile", "ai044-hosted-profile", "empty sandbox secrets", [
    ['env: {}, network,', 'env: { OPENAI_API_KEY: "test-only-secret" }, network,'],
  ]],
  ["M14 redispatch after unknown Create", "ai044-artifact-recovery", "ai044-artifact-recovery", "lost Create/unknown", [
    ['reason: "create_outcome_unknown" as const, requests: [], redispatchAllowed: false as const',
      'reason: "create_outcome_unknown" as const, requests: [{method:"POST",path:"/v1/agents/sessions"}], redispatchAllowed: true as const'],
  ]],
  ["M15 idle becomes terminal success", "ai044-artifact-recovery", "ai044-artifact-recovery", "idle plus", [
    ['if (!["completed", "failed", "cancelled"].includes(turn.status)) return deny("nonterminal");', 'if (false) return deny("nonterminal");'],
  ]],
  ["M16 forbidden patch path accepted", "ai044-artifact-recovery", "ai044-artifact-recovery", "forbidden/path/dependency", [
    ['const path = permittedPath(diff![1], binding);', 'const path = diff![1];'],
  ]],
  ["M17 composition generally enabled", "ai044-readiness", "ai044-readiness", "blocked composition", [
    ['runtimeDispatchAllowed: false as const, dispatchAuthorized: false as const,', 'runtimeDispatchAllowed: true as const, dispatchAuthorized: true as const,'],
  ]],
];

for (const [name, module, suite, pattern, edits] of mutations) test(`AI044 ${name}: behavioral mutant killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-ai044-mutation-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const modules = ["ai044-proof-binding", "ai044-readiness", "ai044-qa-handoff", "ai044-hosted-profile", "ai044-artifact-recovery"];
  const paths = new Map(modules.map(m => [new URL(`lib/executors/${m}.ts`, root).href, pathToFileURL(join(temp, `${m}.mts`)).href]));
  function relocate(source: string, original: URL) {
    return source.replace(/(from\s+)["'](\.[^"']+\.m?ts)["']/gu, (_m, from, relative) => {
      const url = new URL(relative, original).href; return `${from}${JSON.stringify(paths.get(url) ?? url)}`;
    }).replace(/new URL\("(\.[^"]+)", import\.meta\.url\)/gu, (_m, relative) => {
      const url = new URL(relative, original).href; return `new URL(${JSON.stringify(paths.get(url) ?? url)})`;
    });
  }
  for (const m of modules) { const url = new URL(`lib/executors/${m}.ts`, root); await writeFile(new URL(paths.get(url.href)!), relocate(await readFile(url, "utf8"), url)); }
  const suiteUrl = new URL(`tests/${suite}.test.mts`, root), probe = join(temp, "probe.test.mts");
  await writeFile(probe, relocate(await readFile(suiteUrl, "utf8"), suiteUrl));
  const args = ["--test", "--test-reporter=tap", `--test-name-pattern=${pattern}`, probe];
  const env = { PATH: process.env.PATH, LANG: "C", NODE_NO_WARNINGS: "1", NODE_ENV: "test" as const };
  const options = { env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 };
  const green = await exec(process.execPath, args, options); assert.match(green.stdout, /# fail 0/u); assert.match(green.stdout, /# pass [1-9]/u);
  const url = new URL(`lib/executors/${module}.ts`, root); let source = await readFile(url, "utf8");
  for (const [search, replacement] of edits) { assert.equal(source.split(search).length, 2, `exact mutation anchor: ${name}`); source = source.replace(search, replacement); }
  await writeFile(new URL(paths.get(url.href)!), relocate(source, url));
  let output = "";
  try { await exec(process.execPath, args, options); assert.fail(`${name} survived`); }
  catch (error) { const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    assert.equal(failure.code, 1, "must fail an assertion, not hang/crash"); output = `${failure.stdout}\n${failure.stderr}`; }
  assert.match(output, /ERR_ASSERTION/u); assert.doesNotMatch(output, /SyntaxError|ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic("Original GREEN exit0 → actual relocated mutant RED exit1/ERR_ASSERTION; no repository source modified.");
});
