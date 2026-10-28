// Live PostgreSQL: AI-038.4b Quick Create through the UI-bound composition (FormData → binding →
// GitHub session identity → AI-038.4a createTask), exactly as owner-task-create.server wires it except
// that the verified Auth.js session is faked. Proves draft intent only: no run, model, executor or network.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const binding = (await import(new URL("../../lib/composition/owner-task-create.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-task-create");
const readRuntime = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");

const db = await live.useLiveDatabase("quickcreate");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);

const OWNER = "00000000-0000-4000-8000-000000007001";
const MEMBER = "00000000-0000-4000-8000-000000007002";
const OWNER_B = "00000000-0000-4000-8000-000000007003";
for (const [id, name] of [[OWNER, "owner"], [MEMBER, "member"], [OWNER_B, "ownerb"]]) {
  await db.admin.query("insert into users (id, email, name, status) values ($1, $2, $2, 'active')", [id, `${name}@pac.test`]);
}
const role = async (workspace: string) => (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [workspace])).rows[0].id;
const member = async (workspace: string, user: string) => (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [workspace, user])).rows[0].id;
const ownerMembership = await member(A.id, OWNER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [ownerMembership, await role(A.id)]);
await member(A.id, MEMBER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(B.id, OWNER_B), await role(B.id)]);
await db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', '7001', 'active'), ($2, 'github', '7002', 'active'), ($3, 'github', '7003', 'active')", [OWNER, MEMBER, OWNER_B]);
for (const [workspace, key, status] of [[A.id, "project-a", "active"], [A.id, "project-b", "active"], [A.id, "project-paused", "paused"], [A.id, "project-arch", "archived"], [B.id, "project-b-only", "active"]]) {
  await db.admin.query("insert into projects (workspace_id, project_key, display_name, status) values ($1, $2, $2, $3)", [workspace, key, status]);
}

// Fixture-time runs and audit events (workspace / membership setup) are the baseline; Quick Create adds only task.created.
const fixtureRuns = Number((await db.admin.query("select count(*)::int as n from workflow_runs")).rows[0].n);
const fixtureAudits = Number((await db.admin.query("select count(*)::int as n from audit_events where event_type <> 'task.created'")).rows[0].n);

// Same wiring as lib/composition/owner-task-create.server.ts: one request-scoped pool per submit.
const session = (subject: string | null) => subject === null ? null : { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject: subject } };
const quickCreate = (subject: string | null, workspaceSlug: string = A.domain) => binding.createOwnerQuickCreate({
  workspaceSlug,
  async withTaskCreate(domainWorkspaceId, create) {
    const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 2 });
    try {
      return await create(binding.createGitHubOwnerTaskCreate({ database, domainWorkspaceId, sessionResolver: { resolve: () => session(subject) } }));
    } finally {
      await database.close().catch(() => undefined);
    }
  },
});
const owner = quickCreate("7001");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}
const fields = (overrides: Record<string, string> = {}) => ({
  idempotencyKey: binding.newQuickCreateFormKey(), projectId: "project-a", title: "Add Risk Intelligence filter", goal: "Owner intent",
  type: "feature", priority: "P1", riskLevel: "", ...overrides,
});
const count = async (sql: string, values: unknown[] = []) => Number((await db.admin.query(sql, values)).rows[0].n);
const tasks = () => count("select count(*)::int as n from project_tasks where workspace_id = $1", [A.id]);
const tasksWithKey = (key: string) => count("select count(*)::int as n from project_tasks where creation_idempotency_key = $1", [key]);
const audits = () => count("select count(*)::int as n from audit_events where workspace_id = $1 and event_type = 'task.created'", [A.id]);
const taskIdOf = (href: string) => decodeURIComponent(href.slice("/tasks/".length).split("?")[0]);

// No network may be touched by Quick Create (GitHub, providers, executors): fetch is a tripwire.
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network is forbidden in Quick Create"); }) as typeof fetch;

test("A / L. Owner creates a draft task through the UI binding; factual Task Detail has 0 runs; nothing else starts", async () => {
  const before = {
    tasks: await tasks(),
    runs: await count("select count(*)::int as n from workflow_runs"),
    executions: await count("select count(*)::int as n from workflow_runtime_executions"),
    invocations: await count("select count(*)::int as n from workflow_model_invocations"),
    audits: await count("select count(*)::int as n from audit_events"),
  };
  const submitted = fields();
  const result = await owner.submit(form(submitted));
  assert.equal(result.status, "redirect", JSON.stringify(result));
  assert.ok(result.status === "redirect");
  assert.match(result.href, /^\/tasks\/task-[0-9a-f]{20}\?project=project-a$/u);
  const taskId = taskIdOf(result.href);
  const row = (await db.admin.query("select status, project_key, title, goal, task_type, priority, risk_level, created_by::text as created_by, completed_at from project_tasks where task_key = $1", [taskId])).rows[0];
  assert.deepEqual(row, { status: "draft", project_key: "project-a", title: "Add Risk Intelligence filter", goal: "Owner intent", task_type: "feature", priority: "P1", risk_level: null, created_by: OWNER, completed_at: null });
  assert.equal(await tasks(), before.tasks + 1);
  assert.equal(await count("select count(*)::int as n from workflow_runs"), before.runs, "no workflow run");
  assert.equal(await count("select count(*)::int as n from workflow_runtime_executions"), before.executions, "no execution");
  assert.equal(await count("select count(*)::int as n from workflow_model_invocations"), before.invocations, "no model invocation");
  assert.equal(await count("select count(*)::int as n from project_task_runs where task_key = $1", [taskId]), 0, "no run linked");
  assert.deepEqual((await db.admin.query("select event_type from audit_events order by created_at desc limit $1", [await count("select count(*)::int as n from audit_events") - before.audits])).rows.map((r: { event_type: string }) => r.event_type), ["task.created"], "the only new audit event");
  assert.equal(fetchCalls, 0, "no network call");
  // The redirect target is read again through the existing authenticated read path: 0 linked runs.
  const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 2 });
  try {
    const decision = await readRuntime.createGitHubOwnerReadRuntime({ database, domainWorkspaceId: A.domain, sessionResolver: { resolve: () => session("7001") } });
    assert.equal(decision.verdict, "allow");
    const read = await decision.backend!.getTask(taskId);
    assert.equal(read.verdict, "allow");
    const detail = read.data as unknown as { task: { taskId: string; status: string; linkedRunCount: number; latestRun: unknown }; runs: unknown[] };
    assert.deepEqual([detail.task.taskId, detail.task.status, detail.task.linkedRunCount, detail.task.latestRun, detail.runs.length], [taskId, "draft", 0, null, 0]);
  } finally {
    await database.close();
  }
});

test("B / N. the same form submitted twice → same task (replay), one row, one audit; nothing internal leaks", async () => {
  const submitted = fields({ title: "Replay me" });
  const before = await audits();
  const first = await owner.submit(form(submitted));
  const second = await owner.submit(form(submitted));
  assert.ok(first.status === "redirect" && second.status === "redirect");
  assert.equal(second.href, first.href);
  assert.equal(await tasksWithKey(submitted.idempotencyKey), 1);
  assert.equal(await audits(), before + 1);
  const internal = (await db.admin.query("select id::text as id, workspace_id::text as ws, creation_intent_fingerprint as fp from project_tasks where creation_idempotency_key = $1", [submitted.idempotencyKey])).rows[0];
  const json = JSON.stringify([first, second]);
  for (const leaked of [internal.id, internal.ws, internal.fp, OWNER, submitted.idempotencyKey]) assert.ok(!json.includes(leaked));
  const metadata = (await db.admin.query("select metadata from audit_events where entity_id = $1::uuid", [internal.id])).rows[0].metadata;
  assert.deepEqual(Object.keys(metadata).sort(), ["projectId", "taskId"], "the form key never reaches audit metadata");
});

test("C. concurrent double submit of one form → one task, one task.created, one task id; the rest replay", async () => {
  const submitted = fields({ title: "Double submit" });
  const before = await audits();
  const results = await Promise.all(Array.from({ length: 6 }, () => owner.submit(form(submitted))));
  assert.ok(results.every((result) => result.status === "redirect"), JSON.stringify(results));
  assert.equal(new Set(results.map((result) => (result.status === "redirect" ? result.href : ""))).size, 1);
  assert.equal(await tasksWithKey(submitted.idempotencyKey), 1);
  assert.equal(await audits(), before + 1);
});

test("D. same form key with a changed intent → generic conflict; no second task", async () => {
  const submitted = fields({ title: "Original intent" });
  assert.equal((await owner.submit(form(submitted))).status, "redirect");
  for (const change of [{ title: "Changed" }, { projectId: "project-b" }, { goal: "" }, { type: "fix" }, { priority: "" }, { riskLevel: "low" }]) {
    assert.deepEqual(await owner.submit(form({ ...submitted, ...change })), { status: "conflict" }, JSON.stringify(change));
  }
  assert.equal(await tasksWithKey(submitted.idempotencyKey), 1);
});

test("E / F / G. unauthenticated, non-Owner, revoked membership and cross-workspace attempts create nothing", async () => {
  const before = await count("select count(*)::int as n from project_tasks");
  assert.deepEqual(await quickCreate(null).submit(form(fields())), { status: "unauthenticated" });
  assert.deepEqual(await quickCreate("9999").submit(form(fields())), { status: "unauthenticated" }, "unmapped GitHub subject");
  assert.deepEqual(await quickCreate("7002").submit(form(fields())), { status: "unavailable" }, "member without the Owner role");
  assert.deepEqual(await quickCreate("7003").submit(form(fields())), { status: "unavailable" }, "Owner of B acting in A");
  assert.deepEqual(await quickCreate("7001", B.domain).submit(form(fields({ projectId: "project-b-only" }))), { status: "unavailable" }, "A's Owner targeting B");
  assert.deepEqual(await owner.submit(form(fields({ projectId: "project-b-only" }))), { status: "unavailable" }, "B's project from A");
  assert.deepEqual(await owner.submit(form({ ...fields(), workspaceId: B.id })), { status: "invalid_input" }, "browser-chosen workspace");
  assert.deepEqual(await owner.submit(form({ ...fields(), taskId: "task-chosen" })), { status: "invalid_input" }, "browser-chosen task id");
  await db.admin.query("update workspace_members set status = 'disabled' where id = $1", [ownerMembership]);
  try {
    assert.deepEqual(await owner.submit(form(fields())), { status: "unavailable" }, "revoked membership");
  } finally {
    await db.admin.query("update workspace_members set status = 'active' where id = $1", [ownerMembership]);
  }
  assert.equal(await count("select count(*)::int as n from project_tasks"), before);
  assert.equal(await count("select count(*)::int as n from project_tasks where workspace_id = $1", [B.id]), 0);
});

test("H / I. paused, archived and unknown projects fail closed in the backend (even if the UI were bypassed)", async () => {
  const before = await tasks();
  for (const projectId of ["project-paused", "project-arch", "project-zzz"]) {
    assert.deepEqual(await owner.submit(form(fields({ projectId }))), { status: "unavailable" }, projectId);
  }
  assert.deepEqual(await owner.submit(form(fields({ projectId: "../project-a" }))), { status: "invalid_input" });
  assert.equal(await tasks(), before);
});

test("after all: still no run, model or network activity", async () => {
  assert.equal(await count("select count(*)::int as n from workflow_runs"), fixtureRuns, "no workflow run was created");
  assert.equal(await count("select count(*)::int as n from project_task_runs"), 0);
  assert.equal(await count("select count(*)::int as n from audit_events where event_type <> 'task.created'"), fixtureAudits, "only task.created was added");
  assert.equal(fetchCalls, 0);
});

test.after(() => {
  globalThis.fetch = realFetch;
});
