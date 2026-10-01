/* eslint-disable @typescript-eslint/no-explicit-any -- live driver fixtures cross untyped pg boundaries */
// Live PostgreSQL: AI-038.3 Owner Console reader over the REAL composition (GitHub session adapter →
// AI-038.1 Owner check → AI-038.0 backend → tenant facade → read model). Only the verified Auth.js
// session is faked below the adapter; there is no network and no real OAuth.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const fixtures = (await import(new URL("./helpers/runtime-fixtures.ts", import.meta.url).href)) as typeof import("./helpers/runtime-fixtures");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const persistenceContract = (await import(new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href)) as typeof import("../../lib/db/workflow-runtime-persistence");
const composed = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");
const consoleRead = (await import(new URL("../../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-console-read");

const db = await live.useLiveDatabase("ownerconsole");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);

const OWNER = "00000000-0000-4000-8000-000000003001";
const OWNER_B = "00000000-0000-4000-8000-000000003002";
await db.admin.query("insert into users (id, email, name, status) values ($1, 'owner-a@pac.test', 'Owner A', 'active'), ($2, 'owner-b@pac.test', 'Owner B', 'active')", [OWNER, OWNER_B]);
const ownerRole = async (workspace: string) => (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [workspace])).rows[0].id;
const member = async (workspace: string, user: string) => (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [workspace, user])).rows[0].id;
const memberA = await member(A.id, OWNER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [memberA, await ownerRole(A.id)]);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(B.id, OWNER_B), await ownerRole(B.id)]);
await db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', '3001', 'active'), ($2, 'github', '3002', 'active')", [OWNER, OWNER_B]);

const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
function stateFor(workspace: string, runId: string) {
  return JSON.parse(JSON.stringify(fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started"))
    .replaceAll("\"workspace-primary\"", JSON.stringify(workspace))
    .replaceAll("\"run-one\"", JSON.stringify(runId)));
}
for (const [workspace, runId] of [[A, "run-a"], [B, "run-b"]] as const) {
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: workspace.domain });
  assert.ok(persistence);
  await persistence.stateStore.create({ state: stateFor(workspace.domain, runId) });
  const run = (await db.admin.query("select id from workflow_runs where workspace_id = $1 and runtime_id = $2", [workspace.id, runId])).rows[0].id;
  await db.admin.query(`insert into approval_requests (workspace_id, workflow_run_id, action_type, status, risk_level,
      runtime_approval_id, step_id, attempt_number, expected_revision, request_fingerprint, policy_fingerprint,
      scope_fingerprint, requested_capability, requested_by_actor_id)
    values ($1, $2, 'runtime_risk_approval', 'pending', 'high', $3, 'step-one', 1, 1, $4, $5, $6, 'reasoning', $7)`,
  [workspace.id, run, `risk-approval-${(workspace === A ? "a" : "b").repeat(32)}`, "a".repeat(64), "b".repeat(64), "c".repeat(64), `actor-${randomUUID()}`]);
}

const session = (providerSubject: string | null) => providerSubject === null
  ? null
  : { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject } };

// The production binding with only the Auth.js session substituted.
const readerFor = (domainWorkspaceId: string, providerSubject: string | null) => consoleRead.createOwnerConsoleReader({
  workspaceSlug: domainWorkspaceId,
  withRuntime: async (workspace, read) => read(await composed.createGitHubOwnerReadRuntime({
    database, domainWorkspaceId: workspace, sessionResolver: { resolve: () => session(providerSubject) },
  })),
});

test("live: the Owner Console shows only the trusted workspace's approvals and approval-linked runs", async () => {
  const overview = await readerFor(A.domain, "3001").loadOwnerConsoleOverview();
  assert.equal(overview.state, "available", JSON.stringify(overview));
  if (overview.state !== "available") return;
  assert.deepEqual(overview.approvals.map((item) => [item.runId, item.riskLevel]), [["run-a", "high"]]);
  assert.deepEqual(overview.attentionRuns.map((run) => [run.runId, run.status]), [["run-a", "running"]]);
  const json = JSON.stringify(overview);
  for (const forbidden of [A.id, B.id, OWNER, "run-b", "requestedByActorId", "actor-"]) assert.ok(!json.includes(forbidden), forbidden);
});

test("live: Run Detail reads the bound run; a foreign-tenant run is the same opaque state as a missing one", async () => {
  const reader = readerFor(A.domain, "3001");
  const own = await reader.loadOwnerRun("run-a");
  assert.ok(own.state === "available" && own.run.state === "available", JSON.stringify(own));
  const foreign = await reader.loadOwnerRun("run-b");
  const missing = await reader.loadOwnerRun("run-missing");
  assert.deepEqual(foreign, missing);
  assert.deepEqual(foreign.state === "available" ? foreign.run : null, { state: "unavailable" });
});

test("live: identity and authority states map to sign-in / generic unavailable", async () => {
  assert.equal((await readerFor(A.domain, null).loadOwnerConsoleOverview()).state, "unauthenticated");
  assert.equal((await readerFor(A.domain, "9999").loadOwnerConsoleOverview()).state, "unauthenticated", "unmapped subject");
  assert.equal((await readerFor(A.domain, "3002").loadOwnerConsoleOverview()).state, "unavailable", "Owner of B in A");
});

test("live: membership revocation applies on the next read without any cache", async () => {
  const reader = readerFor(A.domain, "3001");
  assert.equal((await reader.loadOwnerAttentionSummary()).state, "available");
  await db.admin.query("update workspace_members set status = 'disabled' where id = $1", [memberA]);
  try {
    assert.equal((await reader.loadOwnerAttentionSummary()).state, "unavailable");
    assert.equal((await reader.loadOwnerRun("run-a")).state, "unavailable");
  } finally {
    await db.admin.query("update workspace_members set status = 'active' where id = $1", [memberA]);
  }
  assert.equal((await reader.loadOwnerAttentionSummary()).state, "available");
});

test.after(async () => {
  await database.close();
});
