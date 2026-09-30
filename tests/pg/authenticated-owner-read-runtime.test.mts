/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: AI-038.1 authenticated Owner boundary against the real P0 identity/RBAC schema
// (users, workspace_members, roles, member_role_assignments) and the 0007 tenant triggers.
// Every principal case, cross-tenant Owners, revocation on the next composition, and inactive
// workspaces are proven with the real SQL policy.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(
  new URL("./helpers/live-pg.ts", import.meta.url).href
)) as typeof import("./helpers/live-pg");
const fixtures = (await import(
  new URL("./helpers/runtime-fixtures.ts", import.meta.url).href
)) as typeof import("./helpers/runtime-fixtures");
const postgres = (await import(
  new URL("../../lib/db/postgres.ts", import.meta.url).href
)) as typeof import("../../lib/db/postgres");
const persistenceContract = (await import(
  new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-persistence");
const authenticated = (await import(
  new URL("../../lib/composition/authenticated-owner-read-runtime.ts", import.meta.url).href
)) as typeof import("../../lib/composition/authenticated-owner-read-runtime");

const db = await live.useLiveDatabase("authowner");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);
const inactive = [
  { id: "00000000-0000-4000-8000-0000000000c3", domain: "workspace-archived", status: "archived" },
  { id: "00000000-0000-4000-8000-0000000000c4", domain: "workspace-suspended", status: "suspended" },
];
for (const workspace of inactive) {
  await db.admin.query(`insert into workspaces (id, name, slug, type, region, status, domain_workspace_id)
    values ($1, $2, $2, 'company', 'eu', $3, $2)`, [workspace.id, workspace.domain, workspace.status]);
}

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USERS = {
  ownerA: u(1001), ownerB: u(1002), memberA: u(1003), disabledUser: u(1004), invitedUser: u(1005),
  disabledMember: u(1006), invitedMember: u(1007), adminA: u(1008), memberAOwnerB: u(1009),
  globalOwnerA: u(1010), revoked: u(1011), unassigned: u(1012), inactiveWorkspaceOwner: u(1013), noMembership: u(1014),
};

async function insertUser(id: string, status: string) {
  await db.admin.query("insert into users (id, email, name, status) values ($1, $2, $3, $4)", [id, `${id}@pac.test`, `User ${id.slice(-4)}`, status]);
}
async function insertMember(workspaceId: string, userId: string, status: string): Promise<string> {
  return (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, $3) returning id",
    [workspaceId, userId, status])).rows[0].id;
}
async function insertRole(workspaceId: string | null, code: string, isSystem = false): Promise<string> {
  return (await db.admin.query("insert into roles (workspace_id, code, name, is_system) values ($1, $2, $3, $4) returning id",
    [workspaceId, code, code, isSystem])).rows[0].id;
}
async function assign(memberId: string, roleId: string) {
  await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [memberId, roleId]);
}

const role = {
  ownerA: await insertRole(A.id, "owner"), adminA: await insertRole(A.id, "admin"), viewerA: await insertRole(A.id, "viewer"),
  ownerB: await insertRole(B.id, "owner"), globalOwner: await insertRole(null, "owner", true),
  ownerArchived: await insertRole(inactive[0].id, "owner"), ownerSuspended: await insertRole(inactive[1].id, "owner"),
};
for (const [key, status] of Object.entries({ disabledUser: "disabled", invitedUser: "invited" })) {
  await insertUser((USERS as any)[key], status);
}
for (const key of Object.keys(USERS).filter((key) => !["disabledUser", "invitedUser"].includes(key))) {
  await insertUser((USERS as any)[key], "active");
}
const members: Record<string, string> = {};
members.ownerA = await insertMember(A.id, USERS.ownerA, "active"); await assign(members.ownerA, role.ownerA);
members.ownerB = await insertMember(B.id, USERS.ownerB, "active"); await assign(members.ownerB, role.ownerB);
members.memberA = await insertMember(A.id, USERS.memberA, "active"); await assign(members.memberA, role.viewerA);
members.disabledUser = await insertMember(A.id, USERS.disabledUser, "active"); await assign(members.disabledUser, role.ownerA);
members.invitedUser = await insertMember(A.id, USERS.invitedUser, "active"); await assign(members.invitedUser, role.ownerA);
members.disabledMember = await insertMember(A.id, USERS.disabledMember, "disabled"); await assign(members.disabledMember, role.ownerA);
members.invitedMember = await insertMember(A.id, USERS.invitedMember, "invited"); await assign(members.invitedMember, role.ownerA);
members.adminA = await insertMember(A.id, USERS.adminA, "active"); await assign(members.adminA, role.adminA);
members.memberAOwnerBInA = await insertMember(A.id, USERS.memberAOwnerB, "active");
members.memberAOwnerBInB = await insertMember(B.id, USERS.memberAOwnerB, "active"); await assign(members.memberAOwnerBInB, role.ownerB);
members.globalOwnerA = await insertMember(A.id, USERS.globalOwnerA, "active"); await assign(members.globalOwnerA, role.globalOwner);
members.revoked = await insertMember(A.id, USERS.revoked, "active"); await assign(members.revoked, role.ownerA);
members.unassigned = await insertMember(A.id, USERS.unassigned, "active");
for (const [index, workspace] of inactive.entries()) {
  const member = await insertMember(workspace.id, USERS.inactiveWorkspaceOwner, "active");
  await assign(member, index === 0 ? role.ownerArchived : role.ownerSuspended);
}

// Same runtime id in A and B with distinguishable state.
function stateFor(workspace: string, started: boolean) {
  const base = started
    ? fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started")
    : fixtures.createWorkflowRuntimeStateFixture();
  return JSON.parse(JSON.stringify(base).replaceAll("\"workspace-primary\"", JSON.stringify(workspace)));
}
const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
const persistenceA = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: A.domain });
const persistenceB = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: B.domain });
assert.ok(persistenceA && persistenceB);
await persistenceA.stateStore.create({ state: stateFor(A.domain, true) });
await persistenceB.stateStore.create({ state: stateFor(B.domain, false) });

// A fresh, request-scoped identity source per composition (as a future session adapter would build).
function requestIdentity(userId: string | null) {
  const calls = { resolve: 0 };
  return { calls, source: { resolve: () => { calls.resolve += 1; return userId === null ? null : { userId }; } } };
}
async function composeFor(domain: string, userId: string | null) {
  const identity = requestIdentity(userId);
  const decision = await authenticated.createAuthenticatedOwnerReadRuntime({ database, domainWorkspaceId: domain, identitySource: identity.source });
  return { decision, identity };
}
const unavailable = { verdict: "deny", reason: "unavailable", backend: null };

// The 0007 trigger forbids assigning a foreign workspace's role at all (so "Owner of B assigned in A"
// cannot even be stored).
test("schema precondition: a foreign workspace role cannot be assigned to a membership in A", async () => {
  await assert.rejects(assign(members.memberA, role.ownerB), (error: any) => error.code === "23514");
});

test("L. active user + active membership + Owner role in A → backend reads only A", async () => {
  const { decision, identity } = await composeFor(A.domain, USERS.ownerA);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  assert.equal(identity.calls.resolve, 1);
  const overview = await decision.backend!.getRunOverview("run-one");
  assert.deepEqual([overview.status, overview.data?.status, overview.data?.revision], ["available", "running", 1], "A's Run, never B's queued one");
  assert.equal(JSON.stringify(overview).includes(A.id) || JSON.stringify(overview).includes(B.id), false);
  assert.deepEqual(Reflect.ownKeys(decision.backend!).sort(), ["getRunAuditTimeline", "getRunModelUsage", "getRunOverview", "listApprovalQueue"]);
});

test("global system Owner role assigned to a membership in A → Owner in A only (the one global case 0007 permits)", async () => {
  assert.equal((await composeFor(A.domain, USERS.globalOwnerA)).decision.verdict, "allow");
  assert.deepEqual((await composeFor(B.domain, USERS.globalOwnerA)).decision, unavailable, "no membership in B");
});

test("M–V. every non-Owner principal is the same opaque denial for A", async () => {
  const cases: Record<string, string> = {
    "M missing user": u(9999),
    "N disabled user": USERS.disabledUser,
    "O invited user": USERS.invitedUser,
    "P missing membership": USERS.noMembership,
    "Q disabled membership": USERS.disabledMember,
    "R invited membership": USERS.invitedMember,
    "S active member without Owner (viewer)": USERS.memberA,
    "S′ active member without any role": USERS.unassigned,
    "T admin only": USERS.adminA,
    "U Owner in B only": USERS.ownerB,
    "V member of A + Owner in B": USERS.memberAOwnerB,
  };
  for (const [name, userId] of Object.entries(cases)) {
    const { decision, identity } = await composeFor(A.domain, userId);
    assert.deepEqual(decision, unavailable, name);
    assert.equal(identity.calls.resolve, 1, name);
  }
});

test("cross-tenant: Owner of A is not Owner of B, and Owner of B reads only B", async () => {
  assert.deepEqual((await composeFor(B.domain, USERS.ownerA)).decision, unavailable);
  const b = await composeFor(B.domain, USERS.ownerB);
  assert.equal(b.decision.verdict, "allow");
  const overview = await b.decision.backend!.getRunOverview("run-one");
  assert.deepEqual([overview.data?.status, overview.data?.revision], ["queued", 0]);
});

test("W. suspended / archived workspaces are denied before identity resolution, even for their Owner", async () => {
  for (const workspace of inactive) {
    const { decision, identity } = await composeFor(workspace.domain, USERS.inactiveWorkspaceOwner);
    assert.deepEqual(decision, unavailable, workspace.status);
    assert.equal(identity.calls.resolve, 0, "identity not consulted");
  }
});

test("no identity → unauthenticated; the public API offers no workspace, role or actor parameter", async () => {
  assert.deepEqual((await composeFor(A.domain, null)).decision, { verdict: "deny", reason: "unauthenticated", backend: null });
  const hostile = await authenticated.createAuthenticatedOwnerReadRuntime({
    database, domainWorkspaceId: A.domain, identitySource: { resolve: () => ({ userId: USERS.ownerB }) }, workspaceId: B.domain, role: "owner", actorId: USERS.ownerA,
  } as any);
  assert.deepEqual(hostile, unavailable, "extra identity fields are refused, not honored");
  const identityWithRole = await authenticated.createAuthenticatedOwnerReadRuntime({
    database, domainWorkspaceId: A.domain, identitySource: { resolve: () => ({ userId: USERS.memberA, role: "owner" }) },
  });
  assert.deepEqual(identityWithRole, { verdict: "deny", reason: "unauthenticated", backend: null }, "an identity cannot carry a role claim");
});

test("revocation applies to the NEXT request composition — membership disable and Owner-assignment removal", async () => {
  const first = await composeFor(A.domain, USERS.revoked);
  assert.equal(first.decision.verdict, "allow");
  await db.admin.query("update workspace_members set status = 'disabled' where id = $1", [members.revoked]);
  assert.deepEqual((await composeFor(A.domain, USERS.revoked)).decision, unavailable, "disabled membership denied without restart");
  await db.admin.query("update workspace_members set status = 'active' where id = $1", [members.revoked]);
  assert.equal((await composeFor(A.domain, USERS.revoked)).decision.verdict, "allow", "re-enabled");
  await db.admin.query("delete from member_role_assignments where member_id = $1 and role_id = $2", [members.revoked, role.ownerA]);
  assert.deepEqual((await composeFor(A.domain, USERS.revoked)).decision, unavailable, "Owner assignment removed → denied");
  await db.admin.query("update users set status = 'disabled' where id = $1", [USERS.ownerA]);
  assert.deepEqual((await composeFor(A.domain, USERS.ownerA)).decision, unavailable, "user disabled → denied");
  await db.admin.query("update users set status = 'active' where id = $1", [USERS.ownerA]);
});

test("the Owner check is one tenant-scoped statement; no membership/role row of another workspace is read", async () => {
  const interceptor = live.installQueryInterceptor();
  const statements: { text: string; values: unknown[] }[] = [];
  let seen = 0;
  interceptor.observe((text: string) => { if (text.includes("owner-principal:verify")) seen += 1; });
  interceptor.rules.push(live.rule("record the Owner-check parameters", live.sqlTag("owner-principal:verify"),
    (_client, config, values, send) => {
      statements.push({ text: typeof config === "string" ? config : config.text, values: [...(values ?? config.values ?? [])] });
      return send(config, values);
    }));
  try {
    await composeFor(A.domain, USERS.memberAOwnerB);
  } finally {
    interceptor.restore();
  }
  assert.equal(seen, 1, "exactly one Owner-check statement");
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0].values, [A.id, USERS.memberAOwnerB], "bound to A's workspace UUID and the identity's user id only");
  assert.match(statements[0].text, /member\.workspace_id = \$1::uuid/u);
  assert.match(statements[0].text, /role\.workspace_id = \$1::uuid or \(role\.workspace_id is null and role\.is_system\)/u);
});

test("AI-038.1 live teardown", async () => {
  await database.close();
});
