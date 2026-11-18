import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile), root = new URL("../", import.meta.url);
const gatePath = "lib/roadmap/development-gates.ts", classPath = "lib/roadmap/roadmap-contract.ts";
const mutations: ReadonlyArray<readonly [string, string, ReadonlyArray<readonly [string, string]>]> = [
  ["M3 caller-selected taskClass", classPath, [['if (!["feature","fix","investigation","roadmap"].includes(type) || typeof corrective !== "boolean")', 'if (typeof corrective !== "boolean")']]],
  ["M10 missing Quality evidence treated PASS", gatePath, [['input.checks.length !== required.length', 'false'], ['if (!required.every(command => checks.some(c => c.command === command))) return null;', '/* missing required checks accepted */']]],
  ["M11 missing Security gate synthesized PASS", gatePath, [['export function normalizeDevelopmentSecurityEvidence(raw: unknown, expectedInput: unknown): DevelopmentSecurityEvidence | null {', 'export function normalizeDevelopmentSecurityEvidence(raw: unknown, expectedInput: unknown): DevelopmentSecurityEvidence | null {\n  if (raw === null) { const e = expectedInput as DevelopmentSecurityBinding; return normalizeDevelopmentSecurityEvidence({ runId:e.runId,attemptNumber:e.attemptNumber,outcomeFingerprint:e.outcomeFingerprint,operationId:e.operationId,reviewerId:"pac-security/v1",outcome:"pass",code:"review_passed",summary:developmentSecuritySummaries.review_passed }, expectedInput); }']]],
  ["M13 scope expansion automatically corrected", gatePath, [['if (f.scopeExpansionRequired) return decision("OWNER", "scope_expansion_required", "scope_change");', 'if (false) return decision("OWNER", "scope_expansion_required", "scope_change");']]],
  ["M14 max attempt limit bypassed", gatePath, [['if ((f.attemptNumber as number) >= 3)', 'if (false)']]],
  ["M16 repeated failure loops", gatePath, [['if (f.repeatedFailure)', 'if (false)']]],
  ["M18 hard stop becomes Owner override", gatePath, [['if (hardActions.some(a => a === action)) return decision("HARD_STOP", action);', 'if (hardActions.some(a => a === action)) return decision("OWNER", action, "architecture_change");']]],
];
for (const [name, path, replacements] of mutations) test(`B3 ${name}: compiled/imported behavioral mutation killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-b3-gate-mutant-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const original = new URL(path, root), target = pathToFileURL(join(temp, path.split("/").at(-1)!.replace(/\.ts$/u, ".mts")));
  const originalSource = await readFile(original, "utf8");
  const relocate = (source: string) => source.replace(/(from\s+)["'](\.[^"']+\.ts)["']/gu, (_all, from, relative) => `${from}${JSON.stringify(new URL(relative, original).href)}`);
  await writeFile(target, relocate(originalSource));
  const env = { ...process.env, [path === gatePath ? "B3_GATE_MODULE" : "B3_TASK_CLASS_MODULE"]: target.href };
  delete env.NODE_TEST_CONTEXT;
  const args = ["--test", "--test-reporter=tap", "tests/development-gates.test.mts"];
  const green = await exec(process.execPath, args, { cwd: root, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }); assert.match(green.stdout, /# fail 0/u);
  let source = originalSource;
  for (const [anchor, replacement] of replacements) { assert.equal(source.split(anchor).length, 2, "unique live behavioral mutation anchor"); source = source.replace(anchor, replacement); }
  await writeFile(target, relocate(source));
  let output = "";
  try { await exec(process.execPath, args, { cwd: root, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }); assert.fail(`${name} survived`); }
  catch (error) { const failure = error as Error & { code: number; stdout: string; stderr: string }; assert.equal(failure.code, 1); output = `${failure.stdout}\n${failure.stderr}`; }
  assert.match(output, /ERR_ASSERTION/u); assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic(`${name}: baseline exit0; mutant exit1 on behavioral assertion, no compile/import-only kill`);
});
