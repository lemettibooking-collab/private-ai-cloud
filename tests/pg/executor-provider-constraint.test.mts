import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, executorTarget, executorRequestPolicy, financialPolicy, context } from "../fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { receipt } from "../fixtures/executor-outcome.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const seam = await import(new URL("../../lib/executors/executor-provider-request.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-provider-request");
const identity = await import(new URL("../../lib/executors/executor-provider-identity.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-provider-identity");
const adapter = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const moduleUrl = process.env.EXECUTOR_PROVIDER_MIGRATION_STORE ? pathToFileURL(process.env.EXECUTOR_PROVIDER_MIGRATION_STORE).href : new URL("../../lib/db/executor-start-store.ts", import.meta.url).href;
const durable = await import(moduleUrl) as typeof import("../../lib/db/executor-start-store");
const migration = new URL("../../db/migrations/0017_executor_provider_constraint.sql", import.meta.url);
const sql = () => process.env.EXECUTOR_PROVIDER_MIGRATION_SQL ? readFileSync(process.env.EXECUTOR_PROVIDER_MIGRATION_SQL, "utf8") : readFileSync(migration, "utf8");
const db = await live.useLiveDatabase("providerconstraint");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const exposure = { maximumExposureUsdMicros: 10000 };
const synthetic = () => seam.defineTrustedExecutorProviderRequestPolicy("anthropic", (i, context, target, amount, workspace) => {
  // Test-only identity bytes, NOT an Anthropic protocol/transport/financial guarantee.
  const baseBody = JSON.stringify({ testOnly: true, invocation: i, context, target, amount }), baseRequestFingerprint = hash(baseBody);
  const correlationFingerprint = identity.deriveExecutorProviderCorrelation({ workspaceIdentity: workspace, developmentRunId: i.attempt.developmentRunId,
    attemptNumber: i.attempt.number, requestFingerprint: baseRequestFingerprint, ...target, executorIdentity: i.identity });
  const body = JSON.stringify({ baseBody, correlationFingerprint });
  return { providerId: "anthropic", target, body, baseBody, baseRequestFingerprint, correlationFingerprint, requestFingerprint: hash(body),
    providerBudgetDefenseEvidence: { limitCents: Math.floor(amount / 10000), enforcement: "provider_defense_only", inFlightOverrunPossible: true } };
});
async function baseline(t: import("node:test").TestContext) {
  const name = `aipc_pgtest_providerupgrade_${randomUUID().replaceAll("-", "")}`;
  await db.admin.query(`create database "${name}"`);
  const admin = live.adminClient(live.databaseUrl(name));
  const pools: ReturnType<typeof postgres.createWorkflowRuntimePostgresDatabase>[] = [];
  t.after(async () => { await Promise.all(pools.map(p => p.close())); await admin.end(); await db.admin.query(`drop database "${name}" with (force)`); });
  await admin.connect();
  const files = readdirSync(new URL("../../db/migrations/", import.meta.url)).filter(f => /^\d{4}_.*\.sql$/u.test(f)).sort();
  for (const file of files.slice(0, 16)) await admin.query(readFileSync(new URL(`../../db/migrations/${file}`, import.meta.url), "utf8"));
  for (const w of [live.primaryWorkspace, live.secondaryWorkspace]) {
    await live.insertWorkspace(admin, w);
    await admin.query("insert into projects(workspace_id,project_key,display_name) values($1,'project-a','Provider migration fixture')", [w.id]);
  }
  async function setup(id: string, providerId = "openai", n = 1, workspace: Readonly<{ id: string; domain: string }> = live.primaryWorkspace, accountId = "account-a") {
    const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: live.databaseUrl(name), maxConnections: 1 }); pools.push(database);
    const tenant = await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(workspace.domain); assert.ok(tenant);
    const configuration = executorConfiguration(n, id), target = { ...executorTarget(), providerId, accountId }, raw = executorRequest(n, id);
    const requestPolicy = providerId === "anthropic" ? synthetic() : executorRequestPolicy();
    const config = { database, tenant, projectId: "project-a", configuration, target, requestPolicy, financialPolicy: financialPolicy(), authorizeStart: () => true };
    const s = durable.createPostgresExecutorStartStore(config), a = authority.createPostgresExecutorCurrentAuthorityStore({ database, tenant, projectId: "project-a", configuration });
    return { config, s, a, raw };
  }
  return { admin, setup, name };
}
test("B2 RED/GREEN: neutral Anthropic seam accepted; factual parent CHECK is the sole baseline blocker", async t => {
  const f = await baseline(t), x = await f.setup("anthropic-row", "anthropic");
  const i = adapter.createExecutorAdapterContract(x.config.configuration).adapter!.validateInvocation(x.raw).normalizedInvocation!;
  assert.ok(seam.prepareExecutorProviderRequest(x.config.requestPolicy, i, context(), x.config.target, 10000, live.primaryWorkspace.id));
  assert.equal((await x.a.registerCurrentAuthority()).status, "registered");
  // During initial RED there is no 0017; reach the actual parent CHECK, not a missing-file import failure.
  if (existsSync(migration)) await f.admin.query(sql());
  let failure: { code: string; constraint: string } | null = null;
  const interceptor = live.installQueryInterceptor();
  interceptor.rules.push(live.rule("observe parent rejection", live.sqlTag("executor:reserve"), async (_c, cfg, values, send) => {
    try { return await send(cfg, values); } catch (error) { const e = error as { code: string; constraint: string }; failure = { code: e.code, constraint: e.constraint }; throw error; }
  }));
  try {
    const d = await x.s.reserve(x.raw, exposure);
    if (!existsSync(migration)) {
      const checks = await f.admin.query("select conname,pg_get_expr(conbin,conrelid) as expression from pg_constraint where conrelid='executor_attempt_exposures'::regclass and contype='c'");
      const check = checks.rows.find((r: { expression: string }) => r.expression === "(provider_id = 'openai'::text)"); assert.ok(check);
      assert.deepEqual(failure, { code: "23514", constraint: check.conname });
      t.diagnostic("RED proved: accepted trusted Anthropic seam; PostgreSQL 23514 on exact OpenAI-only parent CHECK; zero transport.");
    }
    assert.equal(d.verdict, "allow"); assert.equal(d.snapshot?.target.providerId, "anthropic");
  } finally { interceptor.restore(); }
});
type Fixture = Awaited<ReturnType<typeof baseline>>;
async function started(f: Fixture, id: string, provider = "openai", n = 1, workspace: Readonly<{ id: string; domain: string }> = live.primaryWorkspace, account = "account-a") {
  const x = await f.setup(id, provider, n, workspace, account);
  assert.equal((await (n === 1 ? x.a.registerCurrentAuthority() : x.a.advanceCurrentAuthority())).verdict, "allow");
  assert.equal((await x.s.reserve(x.raw, exposure)).status, "reserved");
  const p = await x.s.bindRequest(x.raw, context()); assert.equal(p.status, "prepared"); assert.ok(p.snapshot?.requestFingerprint);
  const start = await x.s.commitProviderStart(x.raw, p.snapshot.requestFingerprint); assert.equal(start.status, "start_committed");
  return { ...x, fp: p.snapshot.requestFingerprint, start };
}
type Started = Awaited<ReturnType<typeof started>>;
async function correlated(x: Started) {
  const c = await x.s.prepareProviderCorrelation(x.raw, context(), x.start.startCapability); assert.equal(c.status, "prepared"); assert.ok(c.providerIdentity);
  return { c, observation: { requestFingerprint: x.fp, correlationFingerprint: c.providerIdentity.correlationFingerprint, target: x.config.target, sessionId: `session_${x.raw.attempt.developmentRunId}` } };
}
async function settle(x: Started) { return x.s.recordDefinitiveOutcomeAndSettle(x.raw, x.fp, await receipt(x.raw.attempt.developmentRunId, x.fp)); }
async function upgraded(t: import("node:test").TestContext) { const f = await baseline(t); await f.admin.query(sql()); return f; }
async function providerChecks(admin: typeof db.admin) {
  return (await admin.query(`select c.conname as name,pg_get_expr(c.conbin,c.conrelid) as expression,c.convalidated as valid
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attname='provider_id'
    where c.conrelid='public.executor_attempt_exposures'::regclass and c.contype='c' and a.attnum=any(c.conkey) order by 1`)).rows;
}
async function schema(admin: typeof db.admin) {
  const queries = {
    columns: `select c.relname,a.attnum,a.attname,a.atttypid::regtype::text,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,
      a.attcollation,pg_get_expr(d.adbin,d.adrelid) as default_value from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`,
    constraints: `select c.conrelid::regclass::text as relation,c.conname,c.contype,pg_get_constraintdef(c.oid) as definition,
      c.convalidated,c.condeferrable,c.condeferred,c.conkey,c.confkey,c.confrelid from pg_constraint c join pg_class t on t.oid=c.conrelid
      join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and not (c.conrelid='public.executor_attempt_exposures'::regclass and c.contype='c'
      and (select attnum from pg_attribute where attrelid=c.conrelid and attname='provider_id')=any(c.conkey)) order by relation,c.conname`,
    indexes: "select schemaname,tablename,indexname,tablespace,indexdef from pg_indexes where schemaname='public' order by tablename,indexname",
    triggers: `select t.tgrelid::regclass::text as relation,t.tgname,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by relation,t.tgname`,
    tables: "select relname,relfilenode,relkind,relchecks,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname",
  };
  const result: Record<string, unknown> = {};
  for (const [key, query] of Object.entries(queries)) result[key] = (await admin.query(query)).rows;
  return result;
}
const tables = ["executor_exposure_budgets", "executor_attempt_exposures", "executor_attempt_events", "executor_attempt_results",
  "executor_provider_executions", "executor_provider_identity_events", "executor_run_authorities", "executor_authority_events"];
async function data(admin: typeof db.admin) {
  const result: Record<string, string[]> = {};
  for (const table of tables) result[table] = (await admin.query(`select row_to_json(t)::text as bytes from ${table} t order by row_to_json(t)::text`)).rows.map((r: { bytes: string }) => r.bytes);
  return result;
}
async function expectState(operation: () => Promise<unknown>, expected: string, constraint?: string) {
  let actual: { code?: string; constraint?: string } | null = null;
  try { await operation(); } catch (e) { const value = e as { code?: string; constraint?: string }; actual = { code: value.code, constraint: value.constraint }; }
  assert.equal(actual?.code, expected, "expected structured PostgreSQL rejection"); if (constraint) assert.equal(actual?.constraint, constraint);
}
test("B2 fresh full chain ends at0017 with exact provider domain and unchanged NOT NULL", async () => {
  assert.equal(db.migrations.at(-1), "0017_executor_provider_constraint.sql");
  assert.deepEqual(await providerChecks(db.admin), [{ name: "executor_exposure_provider_check", expression: "(provider_id = ANY (ARRAY['openai'::text, 'anthropic'::text]))", valid: true }]);
  const column = (await db.admin.query("select attnotnull from pg_attribute where attrelid='executor_attempt_exposures'::regclass and attname='provider_id'")).rows[0]; assert.equal(column.attnotnull, true);
  const version = (await db.admin.query("select current_setting('server_version_num')::int as version,current_setting('server_encoding') as encoding")).rows[0];
  assert.ok(version.version >= 160000); assert.equal(version.encoding, "UTF8");
});
test("B2 populated upgrade: all OpenAI rows byte-identical and only provider CHECK changes", async t => {
  const f = await baseline(t);
  const x = await started(f, "upgrade-settled"), c = await correlated(x);
  await x.s.recordProviderSession(x.raw, c.observation); await x.s.recordProviderTurn(x.raw, { ...c.observation, turnId: "turn_upgrade" });
  assert.equal((await settle(x)).status, "settled");
  await started(f, "upgrade-started");
  const reserved = await f.setup("upgrade-reserved"); await reserved.a.registerCurrentAuthority(); await reserved.s.reserve(reserved.raw, exposure);
  const prepared = await f.setup("upgrade-prepared"); await prepared.a.registerCurrentAuthority(); await prepared.s.reserve(prepared.raw, exposure); await prepared.s.bindRequest(prepared.raw, context());
  const before = await data(f.admin), catalog = await schema(f.admin);
  for (const table of tables) assert.ok(before[table].length > 0, `populated ${table}`);
  assert.deepEqual(await providerChecks(f.admin), [{ name: (await providerChecks(f.admin))[0].name, expression: "(provider_id = 'openai'::text)", valid: true }]);
  await f.admin.query(sql());
  assert.deepEqual(await data(f.admin), before); assert.deepEqual(await schema(f.admin), catalog);
  assert.deepEqual(await providerChecks(f.admin), [{ name: "executor_exposure_provider_check", expression: "(provider_id = ANY (ARRAY['openai'::text, 'anthropic'::text]))", valid: true }]);
  assert.equal((await x.s.inspectOutcome(x.raw)).normalizedResult?.status, "succeeded");
  const post = await started(f, "openai-after"), observed = await correlated(post);
  assert.equal((await post.s.recordProviderSession(post.raw, observed.observation)).status, "recorded");
  assert.equal((await post.s.recordProviderTurn(post.raw, { ...observed.observation, turnId: "turn_after" })).status, "recorded");
  assert.equal((await settle(post)).status, "settled");
});
test("B2 Anthropic synthetic full durable flow keeps session-only identity without Claude transport", async t => {
  const f = await upgraded(t), x = await started(f, "anthropic-session", "anthropic"), before = structuredClone(x.raw), c = await correlated(x);
  const d = await x.s.recordProviderSession(x.raw, c.observation); assert.equal(d.status, "recorded");
  assert.equal(d.providerIdentity?.target.providerId, "anthropic"); assert.equal(d.providerIdentity?.identityState, "session_observed"); assert.equal(d.providerIdentity?.turnId, null);
  const row = (await f.admin.query("select provider_id,workspace_id,development_run_id,attempt_number from executor_attempt_exposures where development_run_id='anthropic-session'")).rows[0];
  assert.deepEqual(row, { provider_id: "anthropic", workspace_id: live.primaryWorkspace.id, development_run_id: x.raw.attempt.developmentRunId, attempt_number: 1 });
  assert.equal((await x.s.commitProviderStart(x.raw, x.fp)).status, "recovery_required");
  assert.deepEqual(x.raw, before);
});
test("B2 provider-domain/NULL: direct PG rejects unknown, case variants and null on exact constraints", async t => {
  const f = await upgraded(t), x = await started(f, "domain-probe");
  const parent = (await f.admin.query("select to_jsonb(e) as row from executor_attempt_exposures e where development_run_id='domain-probe'")).rows[0].row;
  // Statement-level checks happen before duplicate indexes; no row/journal is committed.
  for (const provider of ["google", "claude", "anthropic-beta", "other-provider", "", "OpenAI", "Anthropic"])
    await expectState(() => f.admin.query("insert into executor_attempt_exposures select (jsonb_populate_record(null::executor_attempt_exposures,$1::jsonb)).*", [JSON.stringify({ ...parent, id: randomUUID(), provider_id: provider })]), "23514", "executor_exposure_provider_check");
  await expectState(() => f.admin.query("insert into executor_attempt_exposures select (jsonb_populate_record(null::executor_attempt_exposures,$1::jsonb)).*", [JSON.stringify({ ...parent, id: randomUUID(), provider_id: null })]), "23502");
  assert.equal((await x.s.inspect(x.raw)).snapshot?.target.providerId, "openai");
});
async function childInsert(f: Fixture, x: Started, change: Record<string, unknown>) {
  const i = adapter.createExecutorAdapterContract(x.config.configuration).adapter!.validateInvocation(x.raw).normalizedInvocation!;
  const r = seam.prepareExecutorProviderRequest(x.config.requestPolicy, i, context(), x.config.target, 10000, x.config.tenant.workspaceDatabaseId); assert.ok(r);
  const p = { workspace_id: x.config.tenant.workspaceDatabaseId, development_run_id: i.attempt.developmentRunId, attempt_number: i.attempt.number,
    provider_id: x.config.target.providerId, account_id: x.config.target.accountId, provider_model_id: x.config.target.modelId,
    executor_id: i.identity.id, executor_version: i.identity.version, request_fingerprint: x.fp, base_request_fingerprint: r.baseRequestFingerprint, ...change };
  const fp = identity.deriveExecutorProviderCorrelation({ workspaceIdentity: p.workspace_id, developmentRunId: p.development_run_id, attemptNumber: p.attempt_number,
    requestFingerprint: p.base_request_fingerprint, providerId: p.provider_id, modelId: p.provider_model_id, accountId: p.account_id, executorIdentity: { id: p.executor_id, version: p.executor_version } }); assert.ok(fp);
  const now = new Date(), row = { ...p, correlation_fingerprint: fp, identity_state: "correlation_prepared", recovery_required: false, event_version: 1, created_at: now, updated_at: now };
  // Roll back even a mutant's successful insert: never satisfy the deferred journal FK with invented evidence.
  await f.admin.query("begin");
  try { return await f.admin.query("insert into executor_provider_executions select (jsonb_populate_record(null::executor_provider_executions,$1::jsonb)).*", [JSON.stringify(row)]); }
  finally { await f.admin.query("rollback"); }
}
test("B2 composite FK: mismatched provider/account/model/request cannot attach to Anthropic start", async t => {
  const f = await upgraded(t), x = await started(f, "fk-parent", "anthropic");
  for (const change of [{ provider_id: "openai" }, { account_id: "account-b" }, { provider_model_id: "model-b" }, { request_fingerprint: "f".repeat(64) }])
    await expectState(() => childInsert(f, x, change), "23503");
  for (const change of [{ attempt_number: 2 }, { workspace_id: live.secondaryWorkspace.id }]) await expectState(() => childInsert(f, x, change), "23514");
  const c = await correlated(x); assert.equal(c.c.providerIdentity?.target.providerId, "anthropic");
});
test("B2 session uniqueness and workspace isolation remain unchanged", async t => {
  const f = await upgraded(t), x = await started(f, "session-one", "anthropic"), a = await correlated(x);
  const shared = { ...a.observation, sessionId: "session_shared" }; assert.equal((await x.s.recordProviderSession(x.raw, shared)).verdict, "allow");
  const other = await started(f, "session-two", "anthropic"), b = await correlated(other);
  assert.equal((await other.s.recordProviderSession(other.raw, { ...b.observation, sessionId: shared.sessionId })).status, "recovery_required");
  const foreign = await started(f, "session-foreign", "anthropic", 1, live.secondaryWorkspace), c = await correlated(foreign);
  assert.equal((await foreign.s.recordProviderSession(foreign.raw, { ...c.observation, sessionId: shared.sessionId })).verdict, "deny");
  const openai = await started(f, "session-openai"), d = await correlated(openai);
  assert.equal((await openai.s.recordProviderSession(openai.raw, { ...d.observation, sessionId: shared.sessionId })).verdict, "allow");
  const missing = await f.setup("session-one", "anthropic", 1, live.secondaryWorkspace);
  assert.equal((await missing.s.inspect(missing.raw)).snapshot, null);
});
for (const [from, to] of [["openai", "anthropic"], ["anthropic", "openai"]]) test(`B2 provider-switch barrier ${from} -> ${to}: settlement required`, async t => {
  const f = await upgraded(t), old = await started(f, "switch", from), next = await f.setup("switch", to, 2);
  assert.equal((await next.a.advanceCurrentAuthority()).status, "advanced");
  const d = await next.s.reserve(next.raw, exposure); assert.equal(d.status, "recovery_required"); assert.equal(d.snapshot, null); assert.equal(d.startCapability, null);
  assert.equal((await old.s.inspect(old.raw)).snapshot?.heldExposureUsdMicros, 10000);
  assert.equal((await settle(old)).status, "settled"); assert.equal((await next.s.reserve(next.raw, exposure)).status, "reserved");
  const p = await next.s.bindRequest(next.raw, context()); assert.equal(p.status, "prepared");
  assert.equal((await next.s.commitProviderStart(next.raw, p.snapshot!.requestFingerprint)).status, "start_committed");
});
for (const drift of ["absent", "broadened", "duplicate", "combined", "not-valid", "no-inherit", "nullable"]) test(`B2 altered-schema ${drift}: fail closed, no repair`, async t => {
  const f = await baseline(t), original = (await providerChecks(f.admin))[0].name;
  if (drift !== "duplicate" && drift !== "nullable") await f.admin.query(`alter table executor_attempt_exposures drop constraint "${original}"`);
  if (drift === "broadened") await f.admin.query("alter table executor_attempt_exposures add constraint altered_provider check(provider_id in ('openai','other'))");
  if (drift === "duplicate") await f.admin.query("alter table executor_attempt_exposures add constraint duplicate_provider check(provider_id='openai')");
  if (drift === "combined") await f.admin.query("alter table executor_attempt_exposures add constraint combined_provider check(provider_id='openai' and provider_id<>'')");
  if (drift === "not-valid") await f.admin.query("alter table executor_attempt_exposures add constraint unchecked_provider check(provider_id='openai') not valid");
  if (drift === "no-inherit") await f.admin.query("alter table executor_attempt_exposures add constraint inherited_provider check(provider_id='openai') no inherit");
  if (drift === "nullable") await f.admin.query("alter table executor_attempt_exposures alter column provider_id drop not null");
  const before = await schema(f.admin), checks = await providerChecks(f.admin);
  await expectState(() => f.admin.query(sql()), "55000");
  assert.deepEqual(await schema(f.admin), before); assert.deepEqual(await providerChecks(f.admin), checks);
});
test("B2 generated name not trusted: equivalent renamed old CHECK upgrades; second execution fails closed", async t => {
  const f = await baseline(t), original = (await providerChecks(f.admin))[0].name;
  await f.admin.query(`alter table executor_attempt_exposures rename constraint "${original}" to verified_old_provider_name`);
  await f.admin.query(sql()); assert.equal((await providerChecks(f.admin))[0].name, "executor_exposure_provider_check");
  const before = await schema(f.admin), checks = await providerChecks(f.admin);
  await expectState(() => f.admin.query(sql()), "55000"); assert.deepEqual(await schema(f.admin), before); assert.deepEqual(await providerChecks(f.admin), checks);
});
test("B2 atomic replacement rollback: failing ADD restores old restriction, no committed gap", async t => {
  const f = await baseline(t);
  await f.admin.query("alter table executor_attempt_exposures add constraint executor_exposure_provider_check check(attempt_number>0)");
  const before = await schema(f.admin), checks = await providerChecks(f.admin);
  await expectState(() => f.admin.query(sql()), "42710");
  assert.deepEqual(await schema(f.admin), before); assert.deepEqual(await providerChecks(f.admin), checks);
});
test("B2 atomic concurrent observer sees old CHECK until DO commits; writer waits then sees new CHECK", async t => {
  const f = await baseline(t), observer = live.adminClient(live.databaseUrl(f.name)); await observer.connect();
  const x = await f.setup("atomic-writer", "anthropic"); await x.a.registerCurrentAuthority();
  const parent = (await observer.query("select 'public.executor_attempt_exposures'::regclass::oid as relation,(select attnum from pg_attribute where attrelid='public.executor_attempt_exposures'::regclass and attname='provider_id') as attribute")).rows[0];
  // Read raw MVCC catalog tuples; pg_get_expr can itself open/lock the DDL target.
  const visible = () => observer.query("select conname,conbin::text from pg_constraint where conrelid=$1 and contype='c' and $2::smallint=any(conkey) order by 1", [parent.relation, parent.attribute]);
  const before = (await visible()).rows;
  const paused = sql().replace("  alter table public.executor_attempt_exposures add constraint", "  perform pg_sleep(2);\n  alter table public.executor_attempt_exposures add constraint"); assert.notEqual(paused, sql());
  const applying = f.admin.query(paused); let writer: ReturnType<typeof x.s.reserve> | undefined;
  try {
    let sleeping = false;
    for (let n = 0; n < 150; n++) {
      if ((await db.admin.query("select count(*)::int as n from pg_stat_activity where datname=$1 and wait_event='PgSleep'", [f.name])).rows[0].n) { sleeping = true; break; }
      await live.sleep(10);
    }
    assert.ok(sleeping); assert.deepEqual((await visible()).rows, before);
    writer = x.s.reserve(x.raw, exposure);
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      if ((await db.admin.query("select count(*)::int as n from pg_stat_activity where datname=$1 and wait_event_type='Lock'", [f.name])).rows[0].n) { waiting = true; break; }
      await live.sleep(10);
    }
    assert.ok(waiting); await applying; assert.equal((await writer).status, "reserved");
    assert.equal((await providerChecks(observer))[0].name, "executor_exposure_provider_check");
  } finally { await Promise.allSettled([applying, writer].filter(Boolean)); await observer.end(); }
});
