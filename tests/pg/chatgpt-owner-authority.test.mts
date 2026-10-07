// Live PostgreSQL: AI-039.2 ChatGPT plan integration — PAC Owner authority (start + callback re-check)
// through the REAL GitHub session identity source and the shared Owner predicate. The ChatGPT account is
// never PAC authorization: only the PAC Owner of the trusted workspace may connect. No network, no OAuth.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const identity = (await import(new URL("../../lib/auth/github-session-identity-source.ts", import.meta.url).href)) as typeof import("../../lib/auth/github-session-identity-source");
const authority = (await import(new URL("../../lib/integrations/chatgpt/chatgpt-owner-authority.ts", import.meta.url).href)) as typeof import("../../lib/integrations/chatgpt/chatgpt-owner-authority");

const db = await live.useLiveDatabase("chatgptowner");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);
const OWNER = "00000000-0000-4000-8000-000000008101";
const MEMBER = "00000000-0000-4000-8000-000000008102";
const OWNER_B = "00000000-0000-4000-8000-000000008103";
for (const [id, name] of [[OWNER, "owner"], [MEMBER, "member"], [OWNER_B, "ownerb"]]) {
  await db.admin.query("insert into users (id, email, name, status) values ($1, $2, $2, 'active')", [id, `${name}@pac.test`]);
}
const role = async (workspace: string) => (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [workspace])).rows[0].id;
const member = async (workspace: string, user: string) => (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [workspace, user])).rows[0].id;
const ownerMembership = await member(A.id, OWNER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [ownerMembership, await role(A.id)]);
await member(A.id, MEMBER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(B.id, OWNER_B), await role(B.id)]);
await db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', '8101', 'active'), ($2, 'github', '8102', 'active'), ($3, 'github', '8103', 'active')", [OWNER, MEMBER, OWNER_B]);

const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
const session = (subject: string | null) => subject === null ? null : { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject: subject } };
const source = (subject: string | null) => identity.createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => session(subject) }, database });

test("session Owner: only the PAC Owner of the trusted workspace; member, other-workspace Owner and no session are refused", async () => {
  assert.deepEqual(await authority.resolveSessionOwner(database, A.domain, source("8101")), { status: "owner", ownerUserId: OWNER, domainWorkspaceId: A.domain });
  assert.deepEqual(await authority.resolveSessionOwner(database, A.domain, source("8102")), { status: "denied" }, "member without the Owner role");
  assert.deepEqual(await authority.resolveSessionOwner(database, A.domain, source("8103")), { status: "denied" }, "Owner of another workspace");
  assert.deepEqual(await authority.resolveSessionOwner(database, A.domain, source(null)), { status: "unauthenticated" });
  assert.deepEqual(await authority.resolveSessionOwner(database, A.domain, source("9999")), { status: "unauthenticated" }, "unknown GitHub subject");
  assert.deepEqual(await authority.resolveSessionOwner(database, "unknown-workspace", source("8101")), { status: "denied" });
});

test("callback re-check: a bound Owner loses authority when membership is disabled; malformed bindings are refused without queries", async () => {
  assert.equal(await authority.verifyOwner(database, { ownerUserId: OWNER, domainWorkspaceId: A.domain }), true);
  assert.equal(await authority.verifyOwner(database, { ownerUserId: OWNER, domainWorkspaceId: B.domain }), false, "the binding is workspace-specific");
  assert.equal(await authority.verifyOwner(database, { ownerUserId: "not-a-uuid", domainWorkspaceId: A.domain }), false);
  assert.equal(await authority.verifyOwner(database, { ownerUserId: OWNER, domainWorkspaceId: "Bad Workspace" }), false);
  await db.admin.query("update workspace_members set status = 'disabled' where id = $1", [ownerMembership]);
  try {
    assert.equal(await authority.verifyOwner(database, { ownerUserId: OWNER, domainWorkspaceId: A.domain }), false, "revoked between start and callback");
  } finally {
    await db.admin.query("update workspace_members set status = 'active' where id = $1", [ownerMembership]);
  }
  // Nothing about the ChatGPT integration is stored in PostgreSQL.
  const tables = (await db.admin.query("select table_name from information_schema.tables where table_schema = 'public' and table_name ilike '%chatgpt%'")).rows;
  assert.deepEqual(tables, []);
  await database.close();
});
