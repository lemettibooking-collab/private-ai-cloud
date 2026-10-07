// Live PostgreSQL: AI-038.3.1 Project Registry (migration 0009) and project-scoped run discovery
// through the REAL authenticated chain (GitHub session adapter → AI-038.1 Owner check → AI-038.0
// backend → tenant facade → access → read model → registry SQL). Only the verified Auth.js session is
// faked below the adapter; no network, no real OAuth, no repository operation.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const fixtures = (await import(new URL("./helpers/runtime-fixtures.ts", import.meta.url).href)) as typeof import("./helpers/runtime-fixtures");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const persistenceContract = (await import(new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href)) as typeof import("../../lib/db/workflow-runtime-persistence");
const composed = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");

const db = await live.useLiveDatabase("projectregistry");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = { ownerA: u(4001), ownerB: u(4002), memberA: u(4003) };
for (const [key, id] of Object.entries(USER)) {
  await db.admin.query("insert into users (id, email, name, status) values ($1, $2, $3, 'active')", [id, `${key}@pac.test`, key]);
}
const ownerRole = async (workspace: string) => (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [workspace])).rows[0].id;
const member = async (workspace: string, user: string) => (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [workspace, user])).rows[0].id;
const memberOwnerA = await member(A.id, USER.ownerA);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [memberOwnerA, await ownerRole(A.id)]);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(B.id, USER.ownerB), await ownerRole(B.id)]);
await member(A.id, USER.memberA);
const SUBJECT = { ownerA: "4001", ownerB: "4002", memberA: "4003", unmapped: "4999" };
for (const [key, subject] of [["ownerA", SUBJECT.ownerA], ["ownerB", SUBJECT.ownerB], ["memberA", SUBJECT.memberA]] as const) {
  await db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', $2, 'active')", [USER[key], subject]);
}

// Registry: the SAME project key in both workspaces, with distinguishable metadata.
const project = (workspace: string, key: string, name: string, status = "active", url: string | null = null, branch: string | null = null) =>
  db.admin.query("insert into projects (workspace_id, project_key, display_name, status, repository_url, default_branch) values ($1, $2, $3, $4, $5, $6)",
    [workspace, key, name, status, url, branch]);
await project(A.id, "project-a", "Alpha A", "active", "https://github.com/example-a/alpha", "main");
await project(A.id, "project-b", "Beta A", "paused");
await project(A.id, "project-arch", "Archived A", "archived");
await project(B.id, "project-a", "Alpha B", "active", "https://github.com/example-b/secret-alpha", "trunk");
await project(B.id, "project-c", "Only B");

// Runtime runs: project_id comes from the factual runtime snapshot (no FK to the registry).
const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
const runs: [Readonly<{ id: string; domain: string }>, string, string, string][] = [
  [A, "project-a", "run-a-1", "2026-10-01T09:00:00Z"], [A, "project-a", "run-a-2", "2026-10-01T10:00:00Z"], [A, "project-a", "run-a-3", "2026-10-01T11:00:00Z"],
  [A, "project-b", "run-ab-1", "2026-10-01T12:00:00Z"], [A, "project-arch", "run-arch-1", "2026-10-01T12:00:00Z"],
  [B, "project-a", "run-b-1", "2026-10-01T13:00:00Z"], [B, "project-c", "run-c-1", "2026-10-01T13:00:00Z"],
];
for (const [workspace, projectKey, runId, createdAt] of runs) {
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: workspace.domain });
  assert.ok(persistence);
  const state = JSON.parse(JSON.stringify(fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started"))
    .replaceAll("\"workspace-primary\"", JSON.stringify(workspace.domain))
    .replaceAll("\"run-one\"", JSON.stringify(runId))
    .replaceAll("\"project-one\"", JSON.stringify(projectKey)));
  await persistence.stateStore.create({ state });
  await db.admin.query("update workflow_runs set created_at = $3 where workspace_id = $1 and runtime_id = $2", [workspace.id, runId, createdAt]);
}

const session = (providerSubject: string | null) =>
  providerSubject === null ? null : { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject } };
const ownerRead = (domainWorkspaceId: string, subject: string | null) =>
  composed.createGitHubOwnerReadRuntime({ database, domainWorkspaceId, sessionResolver: { resolve: () => session(subject) } });
async function backendFor(domainWorkspaceId: string, subject: string) {
  const decision = await ownerRead(domainWorkspaceId, subject);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  return decision.backend!;
}
const unavailable = { verdict: "deny", status: "unavailable", data: null };

test("A–C. listProjects: each Owner sees only its own workspace's discoverable projects; archived excluded", async () => {
  const a = await (await backendFor(A.domain, SUBJECT.ownerA)).listProjects();
  assert.deepEqual(a, { verdict: "allow", status: "available", data: [
    { projectId: "project-a", displayName: "Alpha A", status: "active", repository: { url: "https://github.com/example-a/alpha", defaultBranch: "main" } },
    { projectId: "project-b", displayName: "Beta A", status: "paused", repository: null },
  ] });
  const json = JSON.stringify(a);
  for (const leak of ["Alpha B", "secret-alpha", "trunk", "project-c", "Only B", "Archived A", A.id, B.id, USER.ownerA]) {
    assert.equal(json.includes(leak), false, `leaked ${leak}`);
  }
  const b = await (await backendFor(B.domain, SUBJECT.ownerB)).listProjects();
  assert.deepEqual(b.data?.map((item) => [item.projectId, item.displayName]), [["project-a", "Alpha B"], ["project-c", "Only B"]]);
});

test("D–F. listRuns(project-a) returns only A/project-a runs, newest first; same key in B is isolated", async () => {
  const owner = await backendFor(A.domain, SUBJECT.ownerA);
  const result = await owner.listRuns("project-a");
  assert.equal(result.status, "available", JSON.stringify(result));
  assert.deepEqual(result.data?.map((run) => [run.runId, run.projectId, run.status]), [
    ["run-a-3", "project-a", "running"], ["run-a-2", "project-a", "running"], ["run-a-1", "project-a", "running"],
  ]);
  assert.deepEqual(Object.keys(result.data![0]).sort(), ["completedAt", "createdAt", "projectId", "revision", "runId", "startedAt", "status", "workflowId"]);
  const json = JSON.stringify(result);
  for (const leak of ["run-ab-1", "run-b-1", "run-c-1", "run-arch-1", A.id, B.id]) assert.equal(json.includes(leak), false, `leaked ${leak}`);
  assert.deepEqual((await owner.listRuns("project-a", 2)).data?.map((run) => run.runId), ["run-a-3", "run-a-2"], "bounded");
  assert.deepEqual((await owner.listRuns("project-b")).data?.map((run) => run.runId), ["run-ab-1"]);
  const ownerB = await backendFor(B.domain, SUBJECT.ownerB);
  assert.deepEqual((await ownerB.listRuns("project-a")).data?.map((run) => run.runId), ["run-b-1"]);
});

test("G. a foreign, unknown or archived projectId is the same opaque unavailable; it never crosses the tenant", async () => {
  const owner = await backendFor(A.domain, SUBJECT.ownerA);
  for (const projectId of ["project-c", "project-unknown", "project-arch"]) {
    assert.deepEqual(await owner.listRuns(projectId), unavailable, projectId);
  }
  // A project that exists in A but has no runs is a factual empty list, not a denial.
  await project(A.id, "project-empty", "Empty A");
  try {
    assert.deepEqual(await owner.listRuns("project-empty"), { verdict: "allow", status: "available", data: [] });
  } finally {
    await db.admin.query("delete from projects where workspace_id = $1 and project_key = 'project-empty'", [A.id]);
  }
});

test("H. no project or run discovery without an authenticated active Owner of THIS workspace", async () => {
  assert.deepEqual(await ownerRead(A.domain, null), { verdict: "deny", reason: "unauthenticated", backend: null });
  assert.deepEqual(await ownerRead(A.domain, SUBJECT.unmapped), { verdict: "deny", reason: "unauthenticated", backend: null });
  assert.deepEqual(await ownerRead(A.domain, SUBJECT.memberA), { verdict: "deny", reason: "unavailable", backend: null }, "non-Owner member");
  assert.deepEqual(await ownerRead(A.domain, SUBJECT.ownerB), { verdict: "deny", reason: "unavailable", backend: null }, "Owner of B in A");
  await db.admin.query("update users set status = 'disabled' where id = $1", [USER.ownerA]);
  try {
    assert.deepEqual(await ownerRead(A.domain, SUBJECT.ownerA), { verdict: "deny", reason: "unavailable", backend: null }, "inactive user");
  } finally {
    await db.admin.query("update users set status = 'active' where id = $1", [USER.ownerA]);
  }
});

test("I. membership revocation applies to the next project/run discovery", async () => {
  assert.equal((await (await backendFor(A.domain, SUBJECT.ownerA)).listProjects()).status, "available");
  await db.admin.query("update workspace_members set status = 'disabled' where id = $1", [memberOwnerA]);
  try {
    assert.deepEqual(await ownerRead(A.domain, SUBJECT.ownerA), { verdict: "deny", reason: "unavailable", backend: null });
  } finally {
    await db.admin.query("update workspace_members set status = 'active' where id = $1", [memberOwnerA]);
  }
  assert.equal((await (await backendFor(A.domain, SUBJECT.ownerA)).listRuns("project-a")).status, "available");
});

test("J. the database rejects credential-bearing, non-HTTPS or path repository metadata and duplicate identities", async () => {
  const attempt = async (key: string, url: string | null, branch: string | null = null, workspace: string = A.id) => {
    try {
      await db.admin.query("insert into projects (workspace_id, project_key, display_name, repository_url, default_branch) values ($1, $2, 'X', $3, $4)", [workspace, key, url, branch]);
      await db.admin.query("delete from projects where workspace_id = $1 and project_key = $2", [workspace, key]);
      return "accepted";
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };
  for (const url of ["https://user:token@github.com/o/r", "https://github.com/o/r?access_token=x", "https://github.com/o/r#t", "https://github.com/ghp_abc/r",
    "http://github.com/o/r", "git@github.com:o/r.git", "file:///Users/me/repo", "/Users/me/Smart Algorithms", "/var/lib/pac/workspaces/run-123"]) {
    assert.equal(await attempt("project-x", url), "23514", url);
  }
  assert.equal(await attempt("project-x", null, "main"), "23514", "branch requires a repository");
  assert.equal(await attempt("Project-X", null), "23514", "key format");
  assert.equal(await attempt("project-a", null), "23505", "unique within a workspace");
  assert.equal(await attempt("project-x", "https://github.com/example/ok", "main"), "accepted");
  // The same key in another workspace is a different project.
  assert.equal(await attempt("project-b", null, null, B.id), "accepted");
});

test("query shape: one tagged registry statement per discovery call, every one bound to the trusted tenant", async () => {
  const owner = await backendFor(A.domain, SUBJECT.ownerA);
  const interceptor = live.installQueryInterceptor();
  const tags: string[] = [];
  interceptor.observe((text: string) => { const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1]; if (tag) tags.push(tag); });
  try {
    await owner.listProjects();
    await owner.listRuns("project-a");
    await owner.listRuns("../escape");
  } finally {
    interceptor.restore();
  }
  assert.deepEqual(tags, ["project-registry:list", "project-registry:list-runs"], "no N+1; hostile id issues no statement");
});

test("AI-038.3.1 corrective: a run whose denormalized project_id disagrees with its factual snapshot is never routed to that project", async () => {
  // 1. A factual run of A/project-b, created through real persistence.
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: A.domain });
  assert.ok(persistence);
  const state = JSON.parse(JSON.stringify(fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started"))
    .replaceAll("\"workspace-primary\"", JSON.stringify(A.domain))
    .replaceAll("\"run-one\"", JSON.stringify("run-corrupt"))
    .replaceAll("\"project-one\"", JSON.stringify("project-b")));
  await persistence.stateStore.create({ state });
  const owner = await backendFor(A.domain, SUBJECT.ownerA);
  assert.deepEqual((await owner.listRuns("project-b")).data?.map((run) => run.runId).sort(), ["run-ab-1", "run-corrupt"], "factual routing");
  // 2. Corrupt ONLY the denormalized column; the snapshot stays factual (project-b).
  await db.admin.query("update workflow_runs set project_id = 'project-a' where workspace_id = $1 and runtime_id = 'run-corrupt'", [A.id]);
  assert.equal((await db.admin.query("select runtime_snapshot->>'projectId' as p from workflow_runs where workspace_id = $1 and runtime_id = 'run-corrupt'", [A.id])).rows[0].p, "project-b");
  const interceptor = live.installQueryInterceptor();
  const tags: string[] = [];
  interceptor.observe((text: string) => { const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1]; if (tag) tags.push(tag); });
  try {
    // 3. project-a would now include the corrupted run by column: the whole list fails closed.
    const result = await owner.listRuns("project-a");
    assert.deepEqual(result, unavailable, "never exposed as project-a");
    const json = JSON.stringify(result);
    for (const leak of ["run-corrupt", "snapshot", "project-b", A.id, B.id]) assert.equal(json.includes(leak), false, `leaked ${leak}`);
  } finally {
    interceptor.restore();
  }
  assert.deepEqual(tags, ["project-registry:list-runs"], "one bounded statement, no N+1");
  // Workspace B is unaffected by A's corrupted row.
  assert.deepEqual((await (await backendFor(B.domain, SUBJECT.ownerB)).listRuns("project-a")).data?.map((run) => run.runId), ["run-b-1"]);
  // 4. Restore the factual column; project-a lists again and the run is back under project-b.
  await db.admin.query("update workflow_runs set project_id = 'project-b' where workspace_id = $1 and runtime_id = 'run-corrupt'", [A.id]);
  assert.deepEqual((await owner.listRuns("project-a")).data?.map((run) => run.runId), ["run-a-3", "run-a-2", "run-a-1"]);
  assert.ok((await owner.listRuns("project-b")).data?.some((run) => run.runId === "run-corrupt"));
});

test.after(async () => {
  await database.close();
});
