import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile), root = new URL("../../", import.meta.url);
const paths = ["lib/executors/executor-current-authority.ts", "lib/db/executor-current-authority-store.ts", "lib/db/executor-start-store.ts",
  "tests/executor-authority-rebinding.test.mts", "tests/pg/executor-authority-rebinding.test.mts"];
const sqlPath = "db/migrations/0018_executor_authority_rebinding.sql";
type Mutation = { name: string; unit?: boolean; pattern: string; edits: Array<[number | "sql", string, string]> };
const mutations: Mutation[] = [
  { name: "R1 scope omits repository", unit: true, pattern: "^R stable scope", edits: [[0, "repositoryAllowlist: [...c.admission.repositoryAllowlist as string[]].sort(compare), repository: c.repository", "repositoryAllowlist: [...c.admission.repositoryAllowlist as string[]].sort(compare)"]] },
  { name: "R2 scope omits admitted paths", unit: true, pattern: "^R stable scope", edits: [[0, 'policy: "development_task_admission_scope_v1", plan: plan.value,\n        taskId: admission.taskId, admittedPaths: paths,', 'policy: "development_task_admission_scope_v1", plan: plan.value,\n        taskId: admission.taskId,']] },
  { name: "R3 advance ignores changed stable scope", pattern: "^R changed stable", edits: [[1, "|| !stableMatches", ""]] },
  { name: "R4 same-attempt full rewrite allowed", pattern: "^R direct SQL", edits: [["sql", "new.current_attempt_number=old.current_attempt_number+1", "new.current_attempt_number in (old.current_attempt_number,old.current_attempt_number+1)"], ["sql", "new.current_attempt_kind='corrective'", "new.current_attempt_kind in ('initial','corrective')"], ["sql", " and new.canonical_run_fingerprint<>old.canonical_run_fingerprint", ""]] },
  { name: "R5 legacy NULL executor switch allowed", pattern: "^R migration 0018", edits: [[1, "a.admissionScopeFingerprint === null ? a.admissionFingerprint === f.admissionFingerprint", "a.admissionScopeFingerprint === null ? true"], ["sql", "old.admission_scope_fingerprint is not null or new.admission_fingerprint=old.admission_fingerprint", "true"]] },
  { name: "R6 revoke rewrites full fingerprint", pattern: "^R direct SQL", edits: [["sql", "and new.admission_fingerprint=old.admission_fingerprint)", ")"]] },
  { name: "R7 stale exposure starts after rebind", pattern: "^R race .* rebind wins", edits: [[2, "if (active && (!authority ||", "if (false && (!authority ||"], [2, "if (active && (row.authority_generation", "if (false && (row.authority_generation"]] },
  { name: "R8 provider switch bypasses predecessor", pattern: "^R switch predecessor", edits: [[2, "active && !await executorPredecessorsClear", "false && !await executorPredecessorsClear"]] },
];
for (const mutation of mutations) test(`${mutation.name}: original GREEN, executing behavioral mutant killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-authority-rebind-mutant-")); t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const map = new Map(paths.map((p, i) => [new URL(p, root).href, pathToFileURL(join(temp, `${i}.mts`)).href]));
  const relocate = (source: string, location: URL) => source.replace(/(from\s+)["'](\.[^"']+\.m?ts)["']/gu, (_m, from, p) => { const u = new URL(p, location).href; return `${from}${JSON.stringify(map.get(u) ?? u)}`; })
    .replace(/new URL\("(\.[^"]+)", import\.meta\.url\)/gu, (_m, p) => { const u = new URL(p, location).href; return `new URL(${JSON.stringify(map.get(u) ?? u)})`; });
  const original = await Promise.all(paths.map(p => readFile(new URL(p, root), "utf8"))), sql = await readFile(new URL(sqlPath, root), "utf8");
  const env: NodeJS.ProcessEnv = { ...process.env, AUTHORITY_REBIND_MIGRATION_SQL: join(temp, "0018.sql") }; delete env.NODE_TEST_CONTEXT;
  async function materialize(sources: string[], migration: string) { for (const [i, p] of paths.entries()) await writeFile(new URL(map.get(new URL(p, root).href)!), relocate(sources[i], new URL(p, root))); await writeFile(env.AUTHORITY_REBIND_MIGRATION_SQL!, migration); }
  await materialize(original, sql);
  const args = ["--test", "--test-reporter=tap", "--test-name-pattern", mutation.pattern, join(temp, mutation.unit ? "3.mts" : "4.mts")];
  const green = await exec(process.execPath, args, { env, timeout: 90000, maxBuffer: 4e6 }); assert.match(green.stdout, /# fail 0/u); assert.match(green.stdout, /# pass [1-9]/u);
  const sources = [...original]; let mutatedSql = sql;
  for (const [which, needle, replacement] of mutation.edits) {
    const source = which === "sql" ? mutatedSql : sources[which]; assert.equal(source.split(needle).length, 2, "exact mutation anchor");
    if (which === "sql") mutatedSql = source.replace(needle, replacement); else sources[which] = source.replace(needle, replacement);
  }
  await materialize(sources, mutatedSql);
  let output = "";
  try { await exec(process.execPath, args, { env, timeout: 90000, maxBuffer: 4e6 }); assert.fail("mutant survived"); }
  catch (error) { const e = error as Error & { code?: number; stdout?: string; stderr?: string }; assert.equal(e.code, 1); output = `${e.stdout}\n${e.stderr}`; }
  assert.match(output, /ERR_ASSERTION/u); assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic("Original exit0; mutant exit1/ERR_ASSERTION after executing unit/real PG behavior; repository untouched.");
});
