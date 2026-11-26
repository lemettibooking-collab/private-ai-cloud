// Live PostgreSQL: AI-038.3 / AI-038.3.2 Owner Console reader over the REAL composition (GitHub
// session adapter → AI-038.1 Owner check → AI-038.0 backend → tenant facade → read model → registry).
// Only the verified Auth.js session is faked below the adapter; no network and no real OAuth.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const fixtures = (await import(new URL("./helpers/runtime-fixtures.ts", import.meta.url).href)) as typeof import("./helpers/runtime-fixtures");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const persistenceContract = (await import(new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href)) as typeof import("../../lib/db/workflow-runtime-persistence");
const composed = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");
const consoleRead = (await import(new URL("../../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-console-read");
const context = (await import(new URL("../../lib/projects/project-context.ts", import.meta.url).href)) as typeof import("../../lib/projects/project-context");

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

// Registry: A has project-a, project-b, project-paused; B has its OWN project-a.
const registerProject = (workspace: string, key: string, name: string, status = "active") =>
  db.admin.query("insert into projects (workspace_id, project_key, display_name, status) values ($1, $2, $3, $4)", [workspace, key, name, status]);
await registerProject(A.id, "project-a", "Alpha A");
await registerProject(A.id, "project-b", "Beta A");
await registerProject(A.id, "project-paused", "Paused A", "paused");
await registerProject(B.id, "project-a", "Alpha B");

const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
const runs: [Readonly<{ id: string; domain: string }>, string, string, string, string | null][] = [
  // workspace, project, runId, createdAt, pending approval risk
  [A, "project-a", "run-a1", "2026-10-01T09:00:00Z", "high"],
  [A, "project-a", "run-a2", "2026-10-01T10:00:00Z", null],
  [A, "project-b", "run-b1", "2026-10-01T11:00:00Z", "critical"],
  [B, "project-a", "run-ba1", "2026-10-01T12:00:00Z", "medium"],
];
let tag = 0;
for (const [workspace, projectKey, runId, createdAt, risk] of runs) {
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: workspace.domain });
  assert.ok(persistence);
  await persistence.stateStore.create({ state: JSON.parse(JSON.stringify(fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started"))
    .replaceAll("\"workspace-primary\"", JSON.stringify(workspace.domain))
    .replaceAll("\"run-one\"", JSON.stringify(runId))
    .replaceAll("\"project-one\"", JSON.stringify(projectKey))) });
  await db.admin.query("update workflow_runs set created_at = $3 where workspace_id = $1 and runtime_id = $2", [workspace.id, runId, createdAt]);
  if (risk) {
    const run = (await db.admin.query("select id from workflow_runs where workspace_id = $1 and runtime_id = $2", [workspace.id, runId])).rows[0].id;
    await db.admin.query(`insert into approval_requests (workspace_id, workflow_run_id, action_type, status, risk_level, runtime_approval_id, step_id,
        attempt_number, expected_revision, request_fingerprint, policy_fingerprint, scope_fingerprint, requested_capability, requested_by_actor_id)
      values ($1, $2, 'runtime_risk_approval', 'pending', $3, $4, 'step-one', 1, 1, $5, $5, $5, 'reasoning', 'workflow-runtime')`,
    [workspace.id, run, risk, `risk-approval-${String(tag++).repeat(32)}`, "a".repeat(64)]);
  }
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
const sel = (raw: unknown) => context.parseProjectSelector(raw);
const all = sel(undefined);
const ownerA = readerFor(A.domain, "3001");

test("A. All Projects lists only workspace A's registry projects", async () => {
  const view = await ownerA.loadOwnerProjects();
  assert.ok(view.state === "available", JSON.stringify(view));
  assert.deepEqual(view.projects.map((item) => [item.projectId, item.displayName, item.status]),
    [["project-a", "Alpha A", "active"], ["project-b", "Beta A", "active"], ["project-paused", "Paused A", "paused"]]);
  const json = JSON.stringify(view);
  for (const leak of ["Alpha B", A.id, B.id, OWNER]) assert.equal(json.includes(leak), false, leak);
});

test("B–D. project-a and project-b scopes return only their own A runs; B/project-a never leaks", async () => {
  const a = await ownerA.loadOwnerRuns(sel("project-a"));
  assert.ok(a.state === "available" && a.mode === "project", JSON.stringify(a));
  assert.deepEqual(a.runs.map((run) => [run.runId, run.projectId]), [["run-a2", "project-a"], ["run-a1", "project-a"]]);
  const b = await ownerA.loadOwnerRuns(sel("project-b"));
  assert.ok(b.state === "available" && b.mode === "project");
  assert.deepEqual(b.runs.map((run) => run.runId), ["run-b1"]);
  for (const view of [a, b]) assert.equal(JSON.stringify(view).includes("run-ba1"), false);
  const paused = await ownerA.loadOwnerRuns(sel("project-paused"));
  assert.ok(paused.state === "available" && paused.mode === "project");
  assert.deepEqual(paused.runs, [], "registered project without runs is an empty list");
});

test("E. All Projects run aggregation contains A/project-a and A/project-b with factual labels, never B", async () => {
  const view = await ownerA.loadOwnerRuns(all);
  assert.ok(view.state === "available" && view.mode === "all", JSON.stringify(view));
  assert.deepEqual(view.aggregate.runs.map((run) => [run.runId, run.projectId]),
    [["run-b1", "project-b"], ["run-a2", "project-a"], ["run-a1", "project-a"]]);
  assert.deepEqual(view.aggregate.projectsUnavailable, []);
  const dashboard = await ownerA.loadOwnerDashboard(all);
  assert.ok(dashboard.state === "available" && dashboard.mode === "all");
  assert.equal(JSON.stringify(dashboard).includes("run-ba1"), false);
});

test("F–H. All Projects approvals hold both A groups; project views hold only factually-owned approvals", async () => {
  const everything = await ownerA.loadOwnerApprovals(all);
  assert.ok(everything.state === "available" && everything.mode === "all", JSON.stringify(everything));
  assert.deepEqual(everything.approvals.map((item) => item.runId).sort(), ["run-a1", "run-b1"]);
  const a = await ownerA.loadOwnerApprovals(sel("project-a"));
  assert.ok(a.state === "available" && a.mode === "project");
  assert.deepEqual(a.projectApprovals.approvals.map((item) => item.runId), ["run-a1"]);
  assert.equal(a.projectApprovals.unresolvedApprovals, 0);
  const b = await ownerA.loadOwnerApprovals(sel("project-b"));
  assert.ok(b.state === "available" && b.mode === "project");
  assert.deepEqual(b.projectApprovals.approvals.map((item) => item.runId), ["run-b1"]);
  assert.equal(b.projectApprovals.highRiskApprovals, 1);
  const dashboardB = await ownerA.loadOwnerDashboard(sel("project-b"));
  assert.ok(dashboardB.state === "available" && dashboardB.mode === "project");
  assert.deepEqual([dashboardB.runs.map((run) => run.runId), dashboardB.projectApprovals.approvals.map((item) => item.runId)], [["run-b1"], ["run-b1"]]);
});

test("I. a foreign, unknown, malformed or duplicate project selector is the same opaque project_unavailable", async () => {
  const opaque = { state: "project_unavailable", workspace: { slug: A.domain, displayName: "Workspace Primary" } };
  // project-c exists nowhere; project-a of B is foreign but its key is also A's — so use a B-only key.
  await registerProject(B.id, "project-only-b", "Only B");
  for (const raw of ["project-only-b", "project-zzz", "Project-A", ["project-a", "project-b"], ""]) {
    for (const load of [ownerA.loadOwnerDashboard, ownerA.loadOwnerRuns, ownerA.loadOwnerApprovals]) {
      assert.deepEqual(await load(sel(raw)), opaque, JSON.stringify(raw));
    }
  }
});

test("J. membership revocation applies on the next request, whatever project is selected", async () => {
  assert.equal((await ownerA.loadOwnerRuns(sel("project-a"))).state, "available");
  await db.admin.query("update workspace_members set status = 'disabled' where id = $1", [memberA]);
  try {
    for (const result of [await ownerA.loadOwnerRuns(sel("project-a")), await ownerA.loadOwnerDashboard(all), await ownerA.loadOwnerShell()]) {
      assert.equal(result.state, "unavailable");
    }
  } finally {
    await db.admin.query("update workspace_members set status = 'active' where id = $1", [memberA]);
  }
  assert.equal((await ownerA.loadOwnerDashboard(sel("project-a"))).state, "available");
});

test("K. Run Detail opened under the wrong selected project is not presented under that project", async () => {
  const wrong = await ownerA.loadOwnerRun("run-b1", sel("project-a"));
  const missing = await ownerA.loadOwnerRun("run-missing", sel("project-a"));
  assert.ok(wrong.state === "available" && missing.state === "available");
  assert.deepEqual(wrong.run, { state: "unavailable" });
  assert.deepEqual(wrong, missing, "indistinguishable from a missing run");
  const right = await ownerA.loadOwnerRun("run-b1", sel("project-b"));
  assert.ok(right.state === "available" && right.run.state === "available");
  assert.equal(right.run.detail.run.projectId, "project-b");
  const foreign = await ownerA.loadOwnerRun("run-ba1", all);
  assert.ok(foreign.state === "available");
  assert.deepEqual(foreign.run, { state: "unavailable" }, "B's run is never readable from A");
});

test("shell: the bell counts the whole workspace queue; identity states still map correctly", async () => {
  const shell = await ownerA.loadOwnerShell();
  assert.ok(shell.state === "available");
  assert.equal(shell.pendingApprovals, 2, "workspace-global (both A projects)");
  assert.equal(shell.projects.length, 3);
  assert.equal((await readerFor(A.domain, null).loadOwnerShell()).state, "unauthenticated");
  assert.equal((await readerFor(A.domain, "9999").loadOwnerDashboard(all)).state, "unauthenticated", "unmapped subject");
  assert.equal((await readerFor(A.domain, "3002").loadOwnerDashboard(all)).state, "unavailable", "Owner of B in A");
});

test.after(async () => {
  await database.close();
});
