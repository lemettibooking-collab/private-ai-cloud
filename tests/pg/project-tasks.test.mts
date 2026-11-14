// Live PostgreSQL: AI-038.4a ProjectTasks (migration 0010) through the REAL authenticated chain (GitHub
// session adapter → AI-038.1 Owner check → AI-038.0 backend → tenant facade → access → read model →
// task SQL) and the Owner Console reader. Only the verified Auth.js session is faked; no network.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const fixtures = (await import(new URL("./helpers/runtime-fixtures.ts", import.meta.url).href)) as typeof import("./helpers/runtime-fixtures");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const persistenceContract = (await import(new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href)) as typeof import("../../lib/db/workflow-runtime-persistence");
const composed = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");
const consoleRead = (await import(new URL("../../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-console-read");
const context = (await import(new URL("../../lib/projects/project-context.ts", import.meta.url).href)) as typeof import("../../lib/projects/project-context");

const db = await live.useLiveDatabase("projecttasks");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);

const OWNER = "00000000-0000-4000-8000-000000005001";
const OWNER_B = "00000000-0000-4000-8000-000000005002";
await db.admin.query("insert into users (id, email, name, status) values ($1, 'owner-a@pac.test', 'Owner A', 'active'), ($2, 'owner-b@pac.test', 'Owner B', 'active')", [OWNER, OWNER_B]);
const ownerRole = async (workspace: string) => (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [workspace])).rows[0].id;
const member = async (workspace: string, user: string) => (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [workspace, user])).rows[0].id;
const memberA = await member(A.id, OWNER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [memberA, await ownerRole(A.id)]);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(B.id, OWNER_B), await ownerRole(B.id)]);
await db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', '5001', 'active'), ($2, 'github', '5002', 'active')", [OWNER, OWNER_B]);

const registerProject = (workspace: string, key: string, status = "active") =>
  db.admin.query("insert into projects (workspace_id, project_key, display_name, status) values ($1, $2, $3, $4)", [workspace, key, `Name ${key}`, status]);
await registerProject(A.id, "project-a");
await registerProject(A.id, "project-b");
await registerProject(A.id, "project-paused", "paused");
await registerProject(A.id, "project-arch", "archived");
await registerProject(B.id, "project-a");

// Real runtime runs through persistence.
const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
async function createRun(workspace: Readonly<{ id: string; domain: string }>, projectKey: string, runId: string, createdAt: string, cancelled = false) {
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: workspace.domain });
  assert.ok(persistence);
  const base = cancelled
    ? fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_cancelled")
    : fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started");
  await persistence.stateStore.create({ state: JSON.parse(JSON.stringify(base)
    .replaceAll("\"workspace-primary\"", JSON.stringify(workspace.domain))
    .replaceAll("\"run-one\"", JSON.stringify(runId))
    .replaceAll("\"project-one\"", JSON.stringify(projectKey))) });
  await db.admin.query("update workflow_runs set created_at = $3 where workspace_id = $1 and runtime_id = $2", [workspace.id, runId, createdAt]);
}
await createRun(A, "project-a", "run-a1", "2026-10-01T09:00:00Z");
await createRun(A, "project-a", "run-a2", "2026-10-01T10:00:00Z");
await createRun(A, "project-a", "run-a3", "2026-10-01T08:00:00Z", true);
await createRun(A, "project-a", "run-a-orphan", "2026-10-01T11:00:00Z");
await createRun(A, "project-b", "run-b1", "2026-10-01T09:30:00Z");
await createRun(A, "project-b", "run-b2-unlinked", "2026-10-01T09:40:00Z");
await createRun(A, "project-arch", "run-arch1", "2026-10-01T09:30:00Z");
await createRun(B, "project-a", "run-ba1", "2026-10-01T12:00:00Z");
await createRun(B, "project-a", "run-bb-unlinked", "2026-10-01T12:10:00Z");

const insertTask = (workspace: string, project: string, key: string, status: string, updatedAt: string, extra: { completedAt?: string; priority?: string; risk?: string } = {}) =>
  db.admin.query(`insert into project_tasks (workspace_id, project_key, task_key, title, goal, task_type, status, priority, risk_level, created_at, updated_at, completed_at)
    values ($1, $2, $3, $4, 'Goal text', 'feature', $5, $6, $7, $8, $8, $9)`,
  [workspace, project, key, `Title ${key}`, status, extra.priority ?? null, extra.risk ?? null, updatedAt, extra.completedAt ?? null]);
await insertTask(A.id, "project-a", "task-a-running", "running", "2026-10-01T10:30:00Z", { priority: "P1", risk: "medium" });
await insertTask(A.id, "project-a", "task-a-waiting", "waiting_owner", "2026-10-01T10:20:00Z");
await insertTask(A.id, "project-a", "task-a-completed", "completed", "2026-10-01T10:10:00Z", { completedAt: "2026-10-01T10:05:00Z" });
await insertTask(A.id, "project-b", "task-b-blocked", "blocked", "2026-10-01T10:15:00Z");
await insertTask(A.id, "project-paused", "task-paused-draft", "draft", "2026-10-01T07:00:00Z");
await insertTask(A.id, "project-arch", "task-arch", "running", "2026-10-01T10:40:00Z");
await insertTask(B.id, "project-a", "task-foreign", "running", "2026-10-01T10:50:00Z");
const link = (workspace: string, project: string, task: string, run: string) =>
  db.admin.query("insert into project_task_runs (workspace_id, project_key, task_key, run_id) values ($1, $2, $3, $4)", [workspace, project, task, run]);
await link(A.id, "project-a", "task-a-running", "run-a1");
await link(A.id, "project-a", "task-a-running", "run-a2");
await link(A.id, "project-a", "task-a-completed", "run-a3");
await link(A.id, "project-b", "task-b-blocked", "run-b1");
await link(A.id, "project-arch", "task-arch", "run-arch1");
await link(B.id, "project-a", "task-foreign", "run-ba1");

const session = (providerSubject: string | null) => providerSubject === null ? null : { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject } };
const backendFor = async (domain: string, subject: string) => {
  const decision = await composed.createGitHubOwnerReadRuntime({ database, domainWorkspaceId: domain, sessionResolver: { resolve: () => session(subject) } });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  return decision.backend!;
};
const readerFor = (domain: string, subject: string | null) => consoleRead.createOwnerConsoleReader({
  workspaceSlug: domain,
  withRuntime: async (workspace, read) => read(await composed.createGitHubOwnerReadRuntime({ database, domainWorkspaceId: workspace, sessionResolver: { resolve: () => session(subject) } })),
});
const sel = (raw: unknown) => context.parseProjectSelector(raw);
const attempt = async (sql: string, values: unknown[]) => {
  try { await db.admin.query(sql, values); return "accepted"; } catch (error) { return (error as { code?: string }).code; }
};

test("A/C/L/K. listTasks sees only A tasks of discoverable projects (paused yes, archived no), newest updated first", async () => {
  const owner = await backendFor(A.domain, "5001");
  const all = await owner.listTasks("all");
  assert.equal(all.status, "available", JSON.stringify(all));
  assert.deepEqual(all.data?.map((task) => [task.taskId, task.projectId]), [
    ["task-a-running", "project-a"], ["task-a-waiting", "project-a"], ["task-b-blocked", "project-b"], ["task-a-completed", "project-a"], ["task-paused-draft", "project-paused"],
  ]);
  const json = JSON.stringify(all);
  for (const leak of ["task-foreign", "task-arch", "run-ba1", "run-arch1", A.id, B.id, OWNER]) assert.equal(json.includes(leak), false, `leaked ${leak}`);
  const running = all.data!.find((task) => task.taskId === "task-a-running")!;
  assert.deepEqual([running.linkedRunCount, running.latestRun?.runId, running.priority, running.riskLevel], [2, "run-a2", "P1", "medium"]);
  assert.deepEqual(all.data!.find((task) => task.taskId === "task-a-waiting")?.latestRun, null, "a task with zero runs is valid");
  assert.equal(all.data!.some((task) => task.latestRun?.runId === "run-a-orphan"), false, "an unlinked run creates no task");
});

test("B. listProjectTasks is project-isolated; views filter by status", async () => {
  const owner = await backendFor(A.domain, "5001");
  assert.deepEqual((await owner.listProjectTasks("project-a", "all")).data?.map((task) => task.taskId), ["task-a-running", "task-a-waiting", "task-a-completed"]);
  assert.deepEqual((await owner.listProjectTasks("project-b", "all")).data?.map((task) => task.taskId), ["task-b-blocked"]);
  assert.deepEqual((await owner.listTasks("current")).data?.map((task) => task.taskId), ["task-a-running", "task-a-waiting", "task-b-blocked"]);
  assert.deepEqual((await owner.listTasks("attention")).data?.map((task) => task.taskId), ["task-a-waiting", "task-b-blocked"]);
  assert.deepEqual((await owner.listTasks("completed")).data?.map((task) => [task.taskId, task.completedAt]), [["task-a-completed", "2026-10-01T10:05:00.000Z"]]);
  assert.deepEqual(await owner.listProjectTasks("project-arch", "all"), { verdict: "allow", status: "available", data: [] }, "archived project gate");
  const ownerB = await backendFor(B.domain, "5002");
  assert.deepEqual((await ownerB.listTasks("all")).data?.map((task) => task.taskId), ["task-foreign"]);
});

test("D. Task Detail returns only factual same-project linked runs", async () => {
  const owner = await backendFor(A.domain, "5001");
  const detail = await owner.getTask("task-a-running");
  assert.equal(detail.status, "available", JSON.stringify(detail));
  assert.deepEqual(detail.data?.runs.map((run) => [run.runId, run.projectId, run.status]), [["run-a2", "project-a", "running"], ["run-a1", "project-a", "running"]]);
  const completed = await owner.getTask("task-a-completed");
  assert.deepEqual([completed.data?.task.status, completed.data?.runs.map((run) => run.status)], ["completed", ["cancelled"]],
    "task completion is task-owned; the linked run here is a terminal (cancelled) attempt");
  const zero = await owner.getTask("task-a-waiting");
  assert.deepEqual([zero.data?.runs, zero.data?.task.linkedRunCount], [[], 0]);
});

test("E/F/G. the database rejects cross-project and cross-workspace links and a run linked to two tasks", async () => {
  const sql = "insert into project_task_runs (workspace_id, project_key, task_key, run_id) values ($1, $2, $3, $4)";
  assert.equal(await attempt(sql, [A.id, "project-a", "task-a-waiting", "run-b2-unlinked"]), "23503", "A/project-b run on an A/project-a task");
  assert.equal(await attempt(sql, [A.id, "project-b", "task-a-waiting", "run-b2-unlinked"]), "23503", "task of another project");
  assert.equal(await attempt(sql, [A.id, "project-a", "task-a-waiting", "run-ba1"]), "23503", "B's run in A");
  assert.equal(await attempt(sql, [B.id, "project-a", "task-a-waiting", "run-bb-unlinked"]), "23503", "A's task referenced from B");
  assert.equal(await attempt(sql, [A.id, "project-a", "task-a-waiting", "run-a1"]), "23505", "a run already linked to another task");
  assert.equal(await attempt(sql, [A.id, "project-a", "task-a-running", "run-a1"]), "23505", "duplicate link");
  const task = "insert into project_tasks (workspace_id, project_key, task_key, title, task_type, status) values ($1, $2, $3, 'T', 'fix', $4)";
  assert.equal(await attempt(task, [A.id, "project-a", "task-a-running", "draft"]), "23505", "duplicate task key in a workspace");
  assert.equal(await attempt(task, [A.id, "project-zzz", "task-new", "draft"]), "23503", "unregistered project");
  assert.equal(await attempt(task, [B.id, "project-b", "task-new", "draft"]), "23503", "project of another workspace");
  assert.equal(await attempt(task, [A.id, "project-a", "Task-Bad", "draft"]), "23514", "task key format");
  assert.equal(await attempt(task, [A.id, "project-a", "task-new", "completed"]), "23514", "completed requires completed_at");
  assert.equal(await attempt(task, [A.id, "project-a", "task-new", "shipped"]), "23514", "status enum");
  assert.equal(await attempt(task.replace("'fix'", "'epic'"), [A.id, "project-a", "task-new", "draft"]), "23514", "type enum");
  assert.equal(await attempt("update workflow_runs set project_id = 'project-b' where workspace_id = $1 and runtime_id = 'run-a1'", [A.id]), "23503",
    "a linked run cannot be silently moved to another project");
});

test("H/I/M. unknown, foreign, archived and malformed tasks are opaque; selected project mismatch is opaque; no internal UUIDs", async () => {
  const owner = await backendFor(A.domain, "5001");
  for (const taskId of ["task-unknown", "task-foreign", "task-arch", "TASK", "../x"]) {
    const result = await owner.getTask(taskId);
    assert.ok(result.status !== "available", taskId);
    assert.equal(JSON.stringify(result).includes("Title"), false);
  }
  const reader = readerFor(A.domain, "5001");
  const mismatch = await reader.loadOwnerTask("task-b-blocked", sel("project-a"));
  const missing = await reader.loadOwnerTask("task-unknown", sel("project-a"));
  assert.ok(mismatch.state === "available");
  assert.deepEqual(mismatch.task, { state: "unavailable" });
  assert.deepEqual(mismatch, missing);
  const right = await reader.loadOwnerTask("task-b-blocked", sel("project-b"));
  assert.ok(right.state === "available" && right.task.state === "available");
  const uuids = (await db.admin.query("select id::text from project_tasks union all select id::text from project_task_runs")).rows.map((row: { id: string }) => row.id);
  const outputs = JSON.stringify([await owner.listTasks("all"), await owner.getTask("task-a-running"), right, await reader.loadOwnerDashboard(sel(undefined))]);
  for (const uuid of [...uuids, A.id, OWNER]) assert.equal(outputs.includes(uuid), false, "internal uuid leaked");
});

test("console: dashboard current / recently completed and My Attention, global and project", async () => {
  const reader = readerFor(A.domain, "5001");
  const all = await reader.loadOwnerDashboard(sel(undefined));
  assert.ok(all.state === "available" && all.mode === "all");
  assert.deepEqual(all.tasks.current.tasks.map((task) => task.taskId), ["task-a-running", "task-a-waiting", "task-b-blocked"]);
  assert.deepEqual(all.tasks.recentlyCompleted.tasks.map((task) => task.taskId), ["task-a-completed"]);
  const a = await reader.loadOwnerDashboard(sel("project-a"));
  assert.ok(a.state === "available" && a.mode === "project");
  assert.deepEqual(a.tasks.current.tasks.map((task) => task.taskId), ["task-a-running", "task-a-waiting"]);
  const attention = await reader.loadOwnerAttention(sel("project-b"));
  assert.ok(attention.state === "available" && attention.mode === "project");
  assert.deepEqual(attention.attentionTasks.tasks.map((task) => task.taskId), ["task-b-blocked"]);
  assert.deepEqual(await reader.loadOwnerTasks(sel("project-arch")), { state: "project_unavailable", workspace: { slug: A.domain, displayName: "Workspace Primary" } });
});

test("J. membership revocation affects the next task read", async () => {
  const reader = readerFor(A.domain, "5001");
  assert.equal((await reader.loadOwnerTasks(sel("project-a"))).state, "available");
  await db.admin.query("update workspace_members set status = 'disabled' where id = $1", [memberA]);
  try {
    for (const result of [await reader.loadOwnerTasks(sel(undefined)), await reader.loadOwnerTask("task-a-running", sel(undefined)), await reader.loadOwnerAttention(sel(undefined))]) {
      assert.equal(result.state, "unavailable");
    }
  } finally {
    await db.admin.query("update workspace_members set status = 'active' where id = $1", [memberA]);
  }
  assert.equal((await reader.loadOwnerTasks(sel(undefined))).state, "available");
});

test("query shape: one statement per task read", async () => {
  const owner = await backendFor(A.domain, "5001");
  const interceptor = live.installQueryInterceptor();
  const tags: string[] = [];
  interceptor.observe((text: string) => { const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1]; if (tag) tags.push(tag); });
  try {
    await owner.listTasks("all");
    await owner.listProjectTasks("project-a", "current");
    await owner.getTask("task-a-running");
    await owner.getTask("BAD");
  } finally {
    interceptor.restore();
  }
  assert.deepEqual(tags, ["project-task:list", "project-task:list", "project-task:detail"]);
});

test.after(async () => {
  await database.close();
});
