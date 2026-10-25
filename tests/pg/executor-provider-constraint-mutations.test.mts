import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = new URL("../../", import.meta.url);
const migration = await readFile(new URL("db/migrations/0017_executor_provider_constraint.sql", root), "utf8");
const add = "  alter table public.executor_attempt_exposures add constraint executor_exposure_provider_check\n    check (provider_id in ('openai','anthropic'));";
const weakenFk = `
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='executor_provider_executions'::regclass
    and contype='f' and confrelid='executor_attempt_exposures'::regclass loop
    execute format('alter table executor_provider_executions drop constraint %I',c.conname);
  end loop;
  alter table executor_provider_executions add constraint mutant_parent_fk
    foreign key(workspace_id,development_run_id,attempt_number) references executor_attempt_exposures(workspace_id,development_run_id,attempt_number);
end $$;`;
const cases = [
  ["M1 arbitrary provider", "check (provider_id in ('openai','anthropic'))", "check (provider_id <> '')", "", "^B2 provider-domain"],
  ["M2 forget Anthropic", "check (provider_id in ('openai','anthropic'))", "check (provider_id = 'openai')", "", "^B2 Anthropic synthetic"],
  ["M3 remove CHECK", add, "  null;", "", "^B2 provider-domain"],
  ["M4 remove NOT NULL", "", "", "alter table public.executor_attempt_exposures alter column provider_id drop not null;", "^B2 provider-domain"],
  ["M5 broad/wrong constraint drop", "drop constraint %I', old_check", "drop constraint %I, drop constraint executor_exposure_lifecycle_check', old_check", "", "^B2 populated upgrade"],
  ["M6 provider switch bypasses barrier", "", "", "", "^B2 provider-switch barrier"],
  ["M7 weaken composite identity FK", "", "", weakenFk, "^B2 composite FK"],
  ["M8 rewrite OpenAI budget row", "", "", "update executor_exposure_budgets set updated_at=updated_at + interval '1 millisecond';", "^B2 populated upgrade"],
] as const;
for (const [name, search, replacement, suffix, pattern] of cases) test(`${name}: actual PG original GREEN; executing mutant killed`, async t => {
  const temp = await mkdtemp(join(tmpdir(), "pac-ai0412b2-mutant-"));
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const path = join(temp, "0017.sql"); await writeFile(path, migration);
  const environment: NodeJS.ProcessEnv = { ...process.env, EXECUTOR_PROVIDER_MIGRATION_SQL: path }; delete environment.NODE_TEST_CONTEXT;
  delete environment.EXECUTOR_PROVIDER_MIGRATION_STORE;
  const args = ["--test", "--test-reporter=tap", "--test-name-pattern", pattern, fileURLToPath(new URL("tests/pg/executor-provider-constraint.test.mts", root))];
  const green = await exec(process.execPath, args, { env: environment, timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  assert.match(green.stdout, /# fail 0/u); assert.match(green.stdout, /# pass [1-9]/u);
  if (name.startsWith("M6")) {
    const location = new URL("lib/db/executor-start-store.ts", root), source = await readFile(location, "utf8");
    const changed = source.replace("active && !await executorPredecessorsClear", "false && !await executorPredecessorsClear"); assert.notEqual(changed, source);
    const relocated = changed.replace(/(from\s+)["'](\.[^"']+\.ts)["']/gu, (_m, from, relative) => `${from}${JSON.stringify(new URL(relative, location).href)}`);
    environment.EXECUTOR_PROVIDER_MIGRATION_STORE = join(temp, "store.mts"); await writeFile(environment.EXECUTOR_PROVIDER_MIGRATION_STORE, relocated);
  } else {
    if (search) assert.equal(migration.split(search).length, 2, "mutation anchor must match once");
    const changed = (search ? migration.replace(search, replacement) : migration) + "\n" + suffix;
    assert.notEqual(changed.trim(), migration.trim()); await writeFile(path, changed);
  }
  let output = "";
  try { await exec(process.execPath, args, { env: environment, timeout: 45000, maxBuffer: 2 * 1024 * 1024 }); assert.fail(`${name} survived`); }
  catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    assert.equal(failure.code, 1, "requires behavioral assertion, not timeout/crash"); output = `${failure.stdout}\n${failure.stderr}`;
  }
  assert.match(output, /ERR_ASSERTION/u); assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/u);
  t.diagnostic(`${name}: original exit0; mutant exit1/ERR_ASSERTION after actual PG execution; repository files untouched`);
});
