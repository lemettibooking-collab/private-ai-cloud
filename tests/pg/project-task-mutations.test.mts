// Live PostgreSQL: AI-038.4a Owner Task mutation contract (createTask / attachRun) over the real
// authenticated identity (GitHub session adapter; only the verified Auth.js session is faked), with
// concurrency races. Control-plane intent only: no run start, model, executor or GitHub action.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const fixtures = (await import(new URL("./helpers/runtime-fixtures.ts", import.meta.url).href)) as typeof import("./helpers/runtime-fixtures");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const persistenceContract = (await import(new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href)) as typeof import("../../lib/db/workflow-runtime-persistence");
const identity = (await import(new URL("../../lib/auth/github-session-identity-source.ts", import.meta.url).href)) as typeof import("../../lib/auth/github-session-identity-source");
const mutations = (await import(new URL("../../lib/tasks/owner-task-mutations.ts", import.meta.url).href)) as typeof import("../../lib/tasks/owner-task-mutations");

const db = await live.useLiveDatabase("taskmutations");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);

const OWNER = "00000000-0000-4000-8000-000000006001";
const MEMBER = "00000000-0000-4000-8000-000000006002";
const OWNER_B = "00000000-0000-4000-8000-000000006003";
for (const [id, name] of [[OWNER, "owner"], [MEMBER, "member"], [OWNER_B, "ownerb"]]) {
  await db.admin.query("insert into users (id, email, name, status) values ($1, $2, $2, 'active')", [id, `${name}@pac.test`]);
}
const role = async (workspace: string) => (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [workspace])).rows[0].id;
const member = async (workspace: string, user: string) => (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [workspace, user])).rows[0].id;
const memberOwner = await member(A.id, OWNER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [memberOwner, await role(A.id)]);
await member(A.id, MEMBER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(B.id, OWNER_B), await role(B.id)]);
await db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', '6001', 'active'), ($2, 'github', '6002', 'active'), ($3, 'github', '6003', 'active')", [OWNER, MEMBER, OWNER_B]);

for (const [workspace, key, status] of [[A.id, "project-a", "active"], [A.id, "project-b", "active"], [A.id, "project-race", "active"], [A.id, "project-race2", "active"],
  [A.id, "project-paused", "paused"], [A.id, "project-arch", "archived"], [B.id, "project-a", "active"]]) {
  await db.admin.query("insert into projects (workspace_id, project_key, display_name, status) values ($1, $2, $2, $3)", [workspace, key, status]);
}

const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 6 });
async function createRun(workspace: Readonly<{ id: string; domain: string }>, projectKey: string, runId: string) {
  const persistence = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: workspace.domain });
  assert.ok(persistence);
  await persistence.stateStore.create({ state: JSON.parse(JSON.stringify(fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started"))
    .replaceAll("\"workspace-primary\"", JSON.stringify(workspace.domain))
    .replaceAll("\"run-one\"", JSON.stringify(runId))
    .replaceAll("\"project-one\"", JSON.stringify(projectKey))) });
}
for (const runId of ["run-a1", "run-a2", "run-claim", "run-corrupt-col", "run-corrupt-proj", "run-corrupt-snap"]) await createRun(A, "project-a", runId);
await createRun(A, "project-b", "run-b1");
await createRun(B, "project-a", "run-ba1");

const session = (subject: string | null) => subject === null ? null : { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject: subject } };
const as = (subject: string | null, domain: string = A.domain) => mutations.createOwnerTaskMutations({
  database,
  domainWorkspaceId: domain,
  identitySource: identity.createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => session(subject) }, database }),
});
const owner = as("6001");
const intent = (key: string, extra: Record<string, unknown> = {}) => ({
  idempotencyKey: key, projectId: "project-a", title: "Add Risk Intelligence filter", goal: "Owner intent", type: "feature", priority: "P1", riskLevel: "medium", ...extra,
});
const count = async (sql: string, values: unknown[] = []) => Number((await db.admin.query(sql, values)).rows[0].n);
const tasksWithKey = (key: string) => count("select count(*)::int as n from project_tasks where workspace_id = $1 and creation_idempotency_key = $2", [A.id, key]);
const audits = (type: string) => count("select count(*)::int as n from audit_events where workspace_id = $1 and event_type = $2", [A.id, type]);

test("createTask: server-generated id, draft intent, one audit; replay is the same task with no new audit; changed intent is a conflict", async () => {
  const before = await audits("task.created");
  const first = await owner.createTask(intent("create-key-0001"));
  assert.equal(first.status, "created", JSON.stringify(first));
  assert.ok(first.status === "created" && /^task-[0-9a-f]{20}$/u.test(first.task.taskId) && first.task.status === "draft");
  const replay = await owner.createTask(intent("create-key-0001"));
  assert.deepEqual(replay, { status: "replayed", task: first.status === "created" ? first.task : null });
  for (const change of [{ projectId: "project-b" }, { title: "Other" }, { goal: null }, { type: "fix" }, { priority: "P0" }, { riskLevel: null }]) {
    assert.deepEqual(await owner.createTask(intent("create-key-0001", change)), { status: "conflict" }, JSON.stringify(change));
  }
  assert.equal(await tasksWithKey("create-key-0001"), 1);
  assert.equal(await audits("task.created"), before + 1, "exactly one task.created; replays and conflicts add none");
  const row = (await db.admin.query("select status, created_by::text as created_by, metadata from project_tasks join audit_events on audit_events.entity_id = project_tasks.id where project_tasks.creation_idempotency_key = 'create-key-0001'")).rows[0];
  assert.deepEqual([row.status, row.created_by, row.metadata.projectId], ["draft", OWNER, "project-a"]);
});

test("createTask input: the browser cannot choose a task id or workspace; hostile shapes write nothing", async () => {
  const before = await count("select count(*)::int as n from project_tasks");
  let trapped = 0;
  const proxy = new Proxy(intent("create-key-proxy"), { ownKeys() { trapped += 1; return []; }, get() { trapped += 1; return "x"; } });
  const getter = Object.defineProperty({ ...intent("create-key-getter") }, "title", { get() { trapped += 1; return "t"; }, enumerable: true });
  for (const hostile of [
    { ...intent("create-key-0002"), taskId: "task-chosen" }, { ...intent("create-key-0002"), workspaceId: B.id }, { ...intent("create-key-0002"), status: "completed" },
    intent("short"), intent("create-key-0002", { projectId: "Project-A" }), intent("create-key-0002", { type: "epic" }), intent("create-key-0002", { priority: "P2 " }),
    intent("create-key-0002", { title: "" }), proxy, getter, null, [], "x",
  ]) {
    assert.deepEqual(await owner.createTask(hostile), { status: "invalid_input" });
  }
  assert.equal(trapped, 0);
  assert.equal(await count("select count(*)::int as n from project_tasks"), before);
});

test("createTask authority: unauthenticated, non-Owner, foreign Owner, revoked membership; paused / archived / foreign project", async () => {
  assert.deepEqual(await as(null).createTask(intent("create-key-auth-1")), { status: "unauthenticated" });
  assert.deepEqual(await as("9999").createTask(intent("create-key-auth-2")), { status: "unauthenticated" });
  assert.deepEqual(await as("6002").createTask(intent("create-key-auth-3")), { status: "unavailable" }, "member without Owner role");
  assert.deepEqual(await as("6003").createTask(intent("create-key-auth-4")), { status: "unavailable" }, "Owner of B in A");
  for (const projectId of ["project-paused", "project-arch", "project-zzz"]) {
    assert.deepEqual(await owner.createTask(intent(`create-key-p-${projectId}`, { projectId })), { status: "unavailable" }, projectId);
  }
  // B's own project-a is a different project: B's Owner creates in B only.
  assert.equal((await as("6003", B.domain).createTask(intent("create-key-b-0001"))).status, "created");
  await db.admin.query("update workspace_members set status = 'disabled' where id = $1", [memberOwner]);
  try {
    assert.deepEqual(await owner.createTask(intent("create-key-auth-5")), { status: "unavailable" }, "revoked on the next request");
  } finally {
    await db.admin.query("update workspace_members set status = 'active' where id = $1", [memberOwner]);
  }
  assert.equal(await count("select count(*)::int as n from project_tasks where creation_idempotency_key like 'create-key-auth-%' or creation_idempotency_key like 'create-key-p-%'"), 0);
});

test("RACE: identical concurrent creates produce ONE task and ONE audit; both callers get the same task", async () => {
  const before = await audits("task.created");
  const results = await Promise.all(Array.from({ length: 6 }, () => owner.createTask(intent("race-key-identical"))));
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, ["created", "replayed", "replayed", "replayed", "replayed", "replayed"]);
  const ids = new Set(results.map((result) => (result.status === "created" || result.status === "replayed" ? result.task.taskId : null)));
  assert.equal(ids.size, 1);
  assert.equal(await tasksWithKey("race-key-identical"), 1);
  assert.equal(await audits("task.created"), before + 1);
});

test("RACE: same key with conflicting intents produces ONE task; every other caller gets a generic conflict", async () => {
  const before = await audits("task.created");
  const results = await Promise.all(["Title one", "Title two", "Title three", "Title four"].map((title) => owner.createTask(intent("race-key-conflict", { title }))));
  assert.deepEqual(results.map((result) => result.status).sort(), ["conflict", "conflict", "conflict", "created"]);
  assert.equal(await tasksWithKey("race-key-conflict"), 1);
  assert.equal(await audits("task.created"), before + 1);
});

test("RACE: a concurrent project pause cannot slip between the project check and the commit", async () => {
  // Ordering 1: the pause is uncommitted when createTask checks the project → createTask waits for it,
  // then re-evaluates and sees "paused" → unavailable, no task.
  const pauser = live.adminClient(db.url);
  await pauser.connect();
  try {
    await pauser.query("begin");
    await pauser.query("update projects set status = 'paused' where workspace_id = $1 and project_key = 'project-race'", [A.id]);
    const pending = owner.createTask(intent("race-key-pause-1", { projectId: "project-race" }));
    const early = await Promise.race([pending.then(() => "finished"), new Promise((resolve) => setTimeout(() => resolve("blocked"), 300))]);
    assert.equal(early, "blocked", "createTask waits on the uncommitted pause");
    await pauser.query("commit");
    assert.deepEqual(await pending, { status: "unavailable" });
    assert.equal(await tasksWithKey("race-key-pause-1"), 0);
  } finally {
    await pauser.end();
  }
  // Ordering 2: createTask holds the project row (FOR SHARE) → the pause waits for its commit.
  const interceptor = live.installQueryInterceptor();
  let reached!: () => void;
  const atLock = new Promise<void>((resolve) => { reached = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  interceptor.rules.push(live.rule("hold after the project lock", live.sqlTag("task-mutation:project-lock"), async (_client, config, values, send) => {
    const result = await send(config, values);
    reached();
    await gate;
    return result;
  }));
  const second = live.adminClient(db.url);
  await second.connect();
  try {
    const creating = owner.createTask(intent("race-key-pause-2", { projectId: "project-race2" }));
    await atLock;
    const pausing = second.query("update projects set status = 'paused' where workspace_id = $1 and project_key = 'project-race2'", [A.id]).then(() => "paused");
    const early = await Promise.race([pausing, new Promise((resolve) => setTimeout(() => resolve("blocked"), 300))]);
    assert.equal(early, "blocked", "the pause waits for the task transaction");
    release();
    assert.equal((await creating).status, "created");
    assert.equal(await pausing, "paused");
  } finally {
    release();
    interceptor.restore();
    await second.end();
  }
  assert.equal(await tasksWithKey("race-key-pause-2"), 1, "the task committed before the pause took effect");
});

test("attachRun: same-project factual run → attached + one audit; repeat → already_attached, no new audit; cross-project / foreign run → unavailable", async () => {
  const created = await owner.createTask(intent("attach-key-0001"));
  assert.ok(created.status === "created");
  const taskId = created.task.taskId;
  const before = await audits("task.run_attached");
  assert.deepEqual(await owner.attachRun({ taskId, runId: "run-a1" }), { status: "attached", taskId, runId: "run-a1" });
  assert.deepEqual(await owner.attachRun({ taskId, runId: "run-a1" }), { status: "already_attached", taskId, runId: "run-a1" });
  assert.equal(await audits("task.run_attached"), before + 1);
  assert.deepEqual(await owner.attachRun({ taskId, runId: "run-b1" }), { status: "unavailable" }, "run of another project");
  assert.deepEqual(await owner.attachRun({ taskId, runId: "run-ba1" }), { status: "unavailable" }, "run of another workspace");
  assert.deepEqual(await owner.attachRun({ taskId: "task-unknown", runId: "run-a2" }), { status: "unavailable" });
  assert.deepEqual(await as("6002").attachRun({ taskId, runId: "run-a2" }), { status: "unavailable" }, "non-Owner");
  for (const hostile of [{ taskId, runId: "run-a2", workspaceId: B.id }, { taskId: "Task", runId: "run-a2" }, { taskId, runId: "../x" }, { taskId }]) {
    assert.deepEqual(await owner.attachRun(hostile), { status: "invalid_input" });
  }
  // A second task claiming an already-linked run is a conflict.
  const other = await owner.createTask(intent("attach-key-0002", { title: "Another task" }));
  assert.ok(other.status === "created");
  assert.deepEqual(await owner.attachRun({ taskId: other.task.taskId, runId: "run-a1" }), { status: "conflict" });
  assert.equal(await audits("task.run_attached"), before + 1);
});

test("RACE: two tasks claiming one run → one attached, one conflict; one link and one audit", async () => {
  const t1 = await owner.createTask(intent("claim-key-0001", { title: "Claim one" }));
  const t2 = await owner.createTask(intent("claim-key-0002", { title: "Claim two" }));
  assert.ok(t1.status === "created" && t2.status === "created");
  const before = await audits("task.run_attached");
  const results = await Promise.all([
    owner.attachRun({ taskId: t1.task.taskId, runId: "run-claim" }),
    owner.attachRun({ taskId: t2.task.taskId, runId: "run-claim" }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["attached", "conflict"]);
  assert.equal(await count("select count(*)::int as n from project_task_runs where workspace_id = $1 and run_id = 'run-claim'", [A.id]), 1);
  assert.equal(await audits("task.run_attached"), before + 1);
  // The same task racing itself is idempotent.
  const winner = results.find((result) => result.status === "attached")!;
  const again = await Promise.all([owner.attachRun({ taskId: (winner as { taskId: string }).taskId, runId: "run-claim" }), owner.attachRun({ taskId: (winner as { taskId: string }).taskId, runId: "run-claim" })]);
  assert.deepEqual(again.map((result) => result.status), ["already_attached", "already_attached"]);
  assert.equal(await audits("task.run_attached"), before + 1);
});

test("attachRun validates the canonical runtime snapshot before linking: corrupted column or snapshot fail closed", async () => {
  const created = await owner.createTask(intent("corrupt-key-0001", { title: "Corrupt target" }));
  assert.ok(created.status === "created");
  const taskId = created.task.taskId;
  const before = await audits("task.run_attached");
  // Denormalized column corrupted (snapshot still says project-a): fail closed.
  await db.admin.query("update workflow_runs set workflow_id = 'workflow-forged' where workspace_id = $1 and runtime_id = 'run-corrupt-col'", [A.id]);
  assert.deepEqual(await owner.attachRun({ taskId, runId: "run-corrupt-col" }), { status: "unavailable" });
  // Denormalized project column corrupted to another project of the same workspace: fail closed.
  await db.admin.query("update workflow_runs set project_id = 'project-b' where workspace_id = $1 and runtime_id = 'run-corrupt-proj'", [A.id]);
  assert.deepEqual(await owner.attachRun({ taskId, runId: "run-corrupt-proj" }), { status: "unavailable" });
  const projectBTask = await owner.createTask(intent("corrupt-key-0002", { projectId: "project-b", title: "Corrupt target B" }));
  assert.ok(projectBTask.status === "created");
  assert.deepEqual(await owner.attachRun({ taskId: projectBTask.task.taskId, runId: "run-corrupt-proj" }), { status: "unavailable" }, "the snapshot still says project-a");
  // Snapshot corrupted to another project while the column still says project-a: fail closed.
  await db.admin.query("update workflow_runs set runtime_snapshot = jsonb_set(runtime_snapshot, '{projectId}', '\"project-b\"') where workspace_id = $1 and runtime_id = 'run-corrupt-snap'", [A.id]);
  assert.deepEqual(await owner.attachRun({ taskId, runId: "run-corrupt-snap" }), { status: "unavailable" });
  assert.equal(await count("select count(*)::int as n from project_task_runs where workspace_id = $1 and run_id in ('run-corrupt-col', 'run-corrupt-proj', 'run-corrupt-snap')", [A.id]), 0);
  assert.equal(await audits("task.run_attached"), before);
  assert.deepEqual(await owner.attachRun({ taskId, runId: "run-a2" }), { status: "attached", taskId, runId: "run-a2" }, "a factual run still attaches");
});

test("audit and data hygiene: task audits carry only public ids; nothing triggered a run, model or executor", async () => {
  const rows = (await db.admin.query("select event_type, metadata, actor_user_id::text as actor from audit_events where workspace_id = $1 and event_type like 'task.%'", [A.id])).rows;
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row.metadata).sort(), row.event_type === "task.created" ? ["projectId", "taskId"] : ["projectId", "runId", "taskId"]);
    assert.equal(row.actor, OWNER);
  }
  assert.equal(await count("select count(*)::int as n from workflow_runtime_executions where workspace_id = $1", [A.id]), 0, "no execution started");
  assert.equal(await count("select count(*)::int as n from workflow_model_invocations where workspace_id = $1", [A.id]), 0, "no model call");
  // The unique audit index is the last guard against a duplicate task audit.
  const task = (await db.admin.query("select id from project_tasks where creation_idempotency_key = 'create-key-0001'")).rows[0].id;
  let code: string | undefined;
  try {
    await db.admin.query("insert into audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, metadata) values ($1, $2, 'task.created', 'project_task', $3, '{}')", [A.id, OWNER, task]);
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  assert.equal(code, "23505");
});

test.after(async () => {
  await database.close();
});
