/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: AI-038.2a GitHub session adapter with migration 0008 (auth_identities), the real
// AI-038.1 membership/Owner SQL and the AI-038.0 Owner read backend. The verified Auth.js session is
// faked below the adapter; there is no network and no real OAuth.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const fixtures = (await import(new URL("./helpers/runtime-fixtures.ts", import.meta.url).href)) as typeof import("./helpers/runtime-fixtures");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const persistenceContract = (await import(new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href)) as typeof import("../../lib/db/workflow-runtime-persistence");
const adapter = (await import(new URL("../../lib/auth/github-session-identity-source.ts", import.meta.url).href)) as typeof import("../../lib/auth/github-session-identity-source");
const composed = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");

const db = await live.useLiveDatabase("githubauth");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = { ownerA: u(2001), ownerB: u(2002), memberA: u(2003), revoke: u(2004) };
for (const [key, id] of Object.entries(USER)) {
  await db.admin.query("insert into users (id, email, name, status) values ($1, $2, $3, 'active')", [id, `${key}@pac.test`, key]);
}
const role = async (workspace: string) => (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [workspace])).rows[0].id;
const ownerRoleA = await role(A.id);
const ownerRoleB = await role(B.id);
const member = async (workspace: string, user: string) => (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [workspace, user])).rows[0].id;
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(A.id, USER.ownerA), ownerRoleA]);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(B.id, USER.ownerB), ownerRoleB]);
await member(A.id, USER.memberA);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(A.id, USER.revoke), ownerRoleA]);

const SUBJECT = { ownerA: "1001", ownerB: "1002", memberA: "1003", disabled: "1004", revoke: "1005", unmapped: "1999" };
const mapping = (subject: string, user: string, status = "active") =>
  db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', $2, $3)", [user, subject, status]);
await mapping(SUBJECT.ownerA, USER.ownerA);
await mapping(SUBJECT.ownerB, USER.ownerB);
await mapping(SUBJECT.memberA, USER.memberA);
await mapping(SUBJECT.disabled, USER.ownerA, "disabled");
await mapping(SUBJECT.revoke, USER.revoke);

function stateFor(workspace: string, started: boolean) {
  const base = started ? fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started") : fixtures.createWorkflowRuntimeStateFixture();
  return JSON.parse(JSON.stringify(base).replaceAll("\"workspace-primary\"", JSON.stringify(workspace)));
}
const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
const persistenceA = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: A.domain });
const persistenceB = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: B.domain });
assert.ok(persistenceA && persistenceB);
await persistenceA.stateStore.create({ state: stateFor(A.domain, true) });
await persistenceB.stateStore.create({ state: stateFor(B.domain, false) });

const githubSession = (providerSubject: string, extra: Record<string, unknown> = {}) =>
  ({ expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject }, ...extra });
const resolveUser = (session: unknown) =>
  adapter.createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => session }, database }).resolve();
const ownerRead = (domainWorkspaceId: string, session: unknown) =>
  composed.createGitHubOwnerReadRuntime({ database, domainWorkspaceId, sessionResolver: { resolve: () => session } });
const unauthenticated = { verdict: "deny", reason: "unauthenticated", backend: null };
const unavailable = { verdict: "deny", reason: "unavailable", backend: null };

test("migration 0008: auth_identities exists with its constraints and index; no identity row is seeded", async () => {
  const constraints = (await db.admin.query(`select conname from pg_constraint where conrelid = 'auth_identities'::regclass order by conname`)).rows.map((row: any) => row.conname);
  assert.deepEqual(constraints, ["auth_identities_pkey", "auth_identities_provider_check", "auth_identities_provider_subject_check",
    "auth_identities_provider_subject_unique", "auth_identities_status_check", "auth_identities_user_id_fkey"]);
  const indexes = (await db.admin.query("select indexname from pg_indexes where tablename = 'auth_identities' order by indexname")).rows.map((row: any) => row.indexname);
  assert.ok(indexes.includes("auth_identities_user_id_idx"));
  const seededFresh = await live.useLiveDatabase("githubauthseed");
  assert.equal((await seededFresh.admin.query("select count(*)::int as n from auth_identities")).rows[0].n, 0, "migrations + seeds create no identity mapping");
});

test("A–C, I. active mapping resolves; missing / disabled mapping and email-only matches are denied", async () => {
  assert.deepEqual(await resolveUser(githubSession(SUBJECT.ownerA)), { userId: USER.ownerA });
  assert.equal(await resolveUser(githubSession(SUBJECT.unmapped)), null);
  assert.equal(await resolveUser(githubSession(SUBJECT.disabled)), null);
  // The user's email is irrelevant: an unmapped subject carrying the Owner's email maps to nobody.
  assert.equal(await resolveUser(githubSession(SUBJECT.unmapped, { email: "ownerA@pac.test", user: { email: "ownerA@pac.test" } })), null);
});

test("D. mapping revocation applies to the next request: disable → deny, re-enable → resolve, delete → deny", async () => {
  assert.deepEqual(await resolveUser(githubSession(SUBJECT.revoke)), { userId: USER.revoke });
  assert.equal((await ownerRead(A.domain, githubSession(SUBJECT.revoke))).verdict, "allow");
  await db.admin.query("update auth_identities set status = 'disabled' where provider = 'github' and provider_subject = $1", [SUBJECT.revoke]);
  assert.equal(await resolveUser(githubSession(SUBJECT.revoke)), null);
  assert.deepEqual(await ownerRead(A.domain, githubSession(SUBJECT.revoke)), unauthenticated);
  await db.admin.query("update auth_identities set status = 'active' where provider = 'github' and provider_subject = $1", [SUBJECT.revoke]);
  assert.deepEqual(await resolveUser(githubSession(SUBJECT.revoke)), { userId: USER.revoke });
  await db.admin.query("delete from auth_identities where provider = 'github' and provider_subject = $1", [SUBJECT.revoke]);
  assert.equal(await resolveUser(githubSession(SUBJECT.revoke)), null);
  assert.deepEqual(await ownerRead(A.domain, githubSession(SUBJECT.revoke)), unauthenticated);
});

test("E–F and schema guards: duplicate subject, unknown user, bad provider/subject/status are rejected by the database", async () => {
  const attempt = async (sql: string, values: unknown[]) => {
    try { await db.admin.query(sql, values); return "accepted"; } catch (error: any) { return error.code; }
  };
  const insert = "insert into auth_identities (user_id, provider, provider_subject, status) values ($1, $2, $3, $4)";
  assert.equal(await attempt(insert, [USER.ownerB, "github", SUBJECT.ownerA, "active"]), "23505", "one subject maps to one user");
  assert.equal(await attempt(insert, [u(9999), "github", "4242", "active"]), "23503", "only factual PAC users");
  for (const [provider, subject, status] of [["GitHub", "4243", "active"], ["github", "owner@example.com", "active"], ["github", " 4244", "active"],
    ["github", "", "active"], ["github", "4245", "pending"], ["", "4246", "active"]]) {
    assert.equal(await attempt(insert, [USER.ownerA, provider, subject, status]), "23514", `${provider}/${subject}/${status}`);
  }
});

test("G, J. malformed subjects never reach the lookup; the mapping layer issues one statement and no workspace query", async () => {
  const interceptor = live.installQueryInterceptor();
  const tags: string[] = [];
  interceptor.observe((text: string) => { const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1]; if (tag) tags.push(tag); });
  try {
    for (const subject of ["%", "' or '1'='1", "1001 or 1=1", "1001%", "octocat"]) {
      assert.equal(await resolveUser(githubSession(subject)), null);
    }
    assert.deepEqual(tags, [], "no query for malformed identities");
    await resolveUser(githubSession(SUBJECT.ownerA));
    assert.deepEqual(tags, ["auth-identity:resolve"], "one mapping statement; no tenant/membership lookup in this layer");
  } finally {
    interceptor.restore();
  }
});

test("end-to-end: GitHub subject → auth_identities → PAC user → AI-038.1 Owner check → backend reads only A's Run", async () => {
  const decision = await ownerRead(A.domain, githubSession(SUBJECT.ownerA));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  const overview = await decision.backend!.getRunOverview("run-one");
  assert.deepEqual([overview.status, overview.data?.status, overview.data?.revision], ["available", "running", 1]);
  assert.equal(JSON.stringify(overview).includes(A.id) || JSON.stringify(overview).includes(B.id), false, "no tenant UUID leak");
});

test("cross-account / cross-tenant: the session changes only the PAC user, never the configured workspace", async () => {
  assert.deepEqual(await ownerRead(B.domain, githubSession(SUBJECT.ownerA)), unavailable, "GitHub A + workspace B");
  assert.deepEqual(await ownerRead(A.domain, githubSession(SUBJECT.ownerB)), unavailable, "GitHub B + workspace A");
  assert.deepEqual(await ownerRead(A.domain, githubSession(SUBJECT.memberA)), unavailable, "mapped non-Owner");
  assert.deepEqual(await ownerRead(A.domain, githubSession(SUBJECT.unmapped)), unauthenticated, "foreign subject");
  assert.deepEqual(await ownerRead(A.domain, githubSession(SUBJECT.disabled)), unauthenticated, "disabled mapping");
  const b = await ownerRead(B.domain, githubSession(SUBJECT.ownerB));
  assert.deepEqual([(await b.backend!.getRunOverview("run-one")).data?.status], ["queued"], "Owner B reads only B");
});

test("hostile session claims (role, workspace, userId, email) grant nothing beyond the PAC mapping", async () => {
  const hostile = githubSession(SUBJECT.ownerA, { role: "owner", workspace: B.domain, workspaceId: B.id, userId: USER.ownerB, email: "ownerB@pac.test",
    user: { id: USER.ownerB, email: "ownerB@pac.test" } });
  assert.deepEqual(await resolveUser(hostile), { userId: USER.ownerA }, "mapped user A, not the claimed user B");
  assert.deepEqual(await ownerRead(B.domain, hostile), unavailable, "claims cannot make A Owner of B");
  const forB = githubSession(SUBJECT.memberA, { role: "owner" });
  assert.deepEqual(await ownerRead(A.domain, forB), unavailable, "a role claim cannot promote a non-Owner");
});

test("AI-038.2a live teardown", async () => {
  await database.close();
});
