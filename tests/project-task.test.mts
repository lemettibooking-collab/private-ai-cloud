/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-038.4a ProjectTask read layer: pure validation and the full chain (OwnerReadBackend → tenant facade
// → authorized access → read model → task SQL) over a recording fake database. No real DB, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const tasks = (await import(new URL("../lib/tasks/project-task.ts", import.meta.url).href)) as typeof import("../lib/tasks/project-task");
const bundle = (await import(new URL("../lib/composition/owner-read-runtime.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-read-runtime");
const stateFixture = (await import(new URL("./helpers/workflow-runtime-state-fixture.mts", import.meta.url).href)) as typeof import("./helpers/workflow-runtime-state-fixture.mts");

const root = fileURLToPath(new URL("..", import.meta.url));
const workspaceId = "workspace-primary";
const workspaceDatabaseId = "00000000-0000-4000-8000-0000000000a1";
const ownerActorId = "owner-one";
const SECRET = "postgres://owner:secret@db/x select * from project_tasks";
const INTERNAL_UUID = "11111111-2222-4333-8444-555555555555";

function snapshot(runId: string, projectId: string) {
  const state = stateFixture.transitionRuntimeState(stateFixture.createWorkflowRuntimeStateFixture(), "run_started");
  return JSON.parse(JSON.stringify(state.snapshot).replaceAll("\"run-one\"", JSON.stringify(runId)).replaceAll("\"project-one\"", JSON.stringify(projectId)));
}

const noRun = { run_id: null, run_project_id: null, run_workflow_id: null, run_status: null, run_revision: null, run_created_at: null, run_started_at: null, run_completed_at: null, run_snapshot: null };
const run = (runId: string, projectId: string, minute = 0, extra: Record<string, unknown> = {}) => ({
  run_id: runId, run_project_id: projectId, run_workflow_id: "workflow-one", run_status: "running", run_revision: "1",
  run_created_at: new Date(`2026-10-01T10:0${minute}:00.000Z`), run_started_at: null, run_completed_at: null, run_snapshot: snapshot(runId, projectId), ...extra,
});
const taskRow = (key: string, project: string, status = "running", extra: Record<string, unknown> = {}) => ({
  id: INTERNAL_UUID, workspace_id: workspaceDatabaseId, created_by: INTERNAL_UUID,
  task_key: key, project_key: project, title: `Task ${key}`, goal: "Do the thing", task_type: "feature", status, priority: null, risk_level: null,
  created_at: new Date("2026-10-01T08:00:00.000Z"), updated_at: new Date("2026-10-01T09:00:00.000Z"),
  completed_at: status === "completed" ? new Date("2026-10-01T09:30:00.000Z") : null, linked_run_count: "0", ...noRun, ...extra,
});

type Behaviour = { list?: unknown[]; detail?: unknown[]; fail?: boolean };

function fakeDatabase(behaviour: Behaviour = {}) {
  const calls: { tag: string; values: unknown[]; text: string }[] = [];
  const database = {
    async connect() {
      return {
        async query(text: string, values: unknown[] = []) {
          const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1] ?? text.trim();
          if (tag === "workflow-runtime-tenant:resolve") {
            return { rows: [{ workspace_database_id: workspaceDatabaseId, domain_workspace_id: workspaceId, status: "active" }], rowCount: 1 };
          }
          calls.push({ tag, values, text });
          if (behaviour.fail) throw new Error(SECRET);
          const rows = tag === "project-task:list" ? behaviour.list ?? [] : tag === "project-task:detail" ? behaviour.detail ?? [] : [];
          return { rows, rowCount: rows.length };
        },
        release() {},
      };
    },
  };
  return { database, calls };
}

async function owner(behaviour: Behaviour = {}) {
  const db = fakeDatabase(behaviour);
  const decision = await bundle.createOwnerReadRuntime({ database: db.database, domainWorkspaceId: workspaceId, ownerActorId });
  assert.equal(decision.verdict, "allow");
  return { calls: db.calls, backend: decision.backend! };
}
const unavailable = { verdict: "deny", status: "unavailable", data: null };

test("1–6. ProjectTask validation: key, status, type, nullable priority/risk, completed_at invariant", () => {
  for (const key of ["task-a", "sa.risk-filter_2", "x".repeat(64)]) assert.equal(tasks.isTaskKey(key), true, key);
  for (const key of ["", "Task", "../x", "a/b", "a b", "x".repeat(65), "-x", 7, null, {}]) assert.equal(tasks.isTaskKey(key), false, String(key));
  assert.deepEqual(tasks.projectTaskTypes, ["feature", "fix", "investigation", "roadmap"]);
  assert.equal(tasks.projectTaskStatuses.length, 12);
  assert.deepEqual([...tasks.currentTaskStatuses], ["ready", "planning", "approved", "running", "verifying", "waiting_owner", "blocked", "recovery_required", "failed"]);
  assert.deepEqual([...tasks.attentionTaskStatuses], ["waiting_owner", "blocked", "recovery_required", "failed"]);
  const ok = tasks.taskFieldsFromRow(taskRow("task-a", "project-a"));
  assert.ok(ok && ok.priority === null && ok.riskLevel === null, "unknown classification stays null (no fake defaults)");
  for (const extra of [{ status: "done" }, { task_type: "epic" }, { priority: "P9" }, { risk_level: "extreme" }, { title: "" }, { title: " x" },
    { title: "a\nb" }, { goal: "" }, { goal: "x\u0000" }, { task_key: "Bad" },
    { status: "completed", completed_at: null }, { status: "running", completed_at: new Date() }, { created_at: "nope" }]) {
    assert.equal(tasks.taskFieldsFromRow(taskRow("task-a", "project-a", "running", extra)), null, JSON.stringify(extra));
  }
  assert.ok(tasks.taskFieldsFromRow(taskRow("task-a", "project-a", "running", { goal: "line one\nline two\tok" })));
});

test("15/16. listTasks / listProjectTasks: one bounded statement, registry-gated, project-scoped, view-filtered", async () => {
  const { backend, calls } = await owner({ list: [taskRow("task-a", "project-a")] });
  assert.equal((await backend.listTasks("all")).status, "available");
  await backend.listProjectTasks("project-a", "current");
  await backend.listTasks("attention");
  await backend.listTasks("completed");
  assert.deepEqual(calls.map((call) => call.tag), ["project-task:list", "project-task:list", "project-task:list", "project-task:list"], "no N+1");
  assert.deepEqual(calls.map((call) => [call.values[0], call.values[1], call.values[2], call.values[4]]), [
    [workspaceDatabaseId, ["active", "paused"], null, 100],
    [workspaceDatabaseId, ["active", "paused"], "project-a", 50],
    [workspaceDatabaseId, ["active", "paused"], null, 50],
    [workspaceDatabaseId, ["active", "paused"], null, 25],
  ]);
  assert.deepEqual(calls[2].values[3], ["waiting_owner", "blocked", "recovery_required", "failed"]);
  assert.deepEqual(calls[3].values[3], ["completed"]);
  assert.match(calls[3].text, /order by task\.completed_at desc, task\.task_key desc/u, "Recently Completed uses task completed_at");
  assert.match(calls[0].text, /join projects as project[\s\S]*project\.status = any\(\$2::text\[\]\)/u, "registry discoverability gate");
  // A row of another project in a project-scoped read, or a status outside the view, fails closed.
  for (const [view, rows] of [["current", [taskRow("t", "project-b")]], ["attention", [taskRow("t", "project-a", "running")]]] as const) {
    const { backend: scoped } = await owner({ list: rows as unknown as unknown[] });
    assert.deepEqual(await scoped.listProjectTasks("project-a", view), unavailable);
  }
  const { backend: big } = await owner({ list: Array.from({ length: 101 }, (_, index) => taskRow(`t${index}`, "project-a")) });
  assert.deepEqual(await big.listTasks("all"), unavailable, "more rows than the bound fails closed");
});

test("12/13/14. malformed task row, malformed linked run or snapshot mismatch → whole read unavailable", async () => {
  const cases = [
    [taskRow("Bad", "project-a")],
    [taskRow("t1", "project-a", "running", { linked_run_count: "1", ...run("RUN!", "project-a") })],
    [taskRow("t1", "project-a", "running", { linked_run_count: "1", ...run("run-1", "project-a", 0, { run_snapshot: snapshot("run-1", "project-b") }) })],
    [taskRow("t1", "project-a", "running", { linked_run_count: "1", ...run("run-1", "project-a", 0, { run_status: "completed" }) })],
    [taskRow("t1", "project-a", "running", { linked_run_count: "1", ...run("run-1", "project-b") })],
    [taskRow("t1", "project-a", "running", { linked_run_count: "2" })],
    [taskRow("t1", "project-a", "running", { linked_run_count: "0", ...run("run-1", "project-a") })],
  ];
  for (const rows of cases) {
    const { backend } = await owner({ list: rows });
    const result = await backend.listTasks("all");
    assert.deepEqual(result, unavailable, JSON.stringify(rows[0]).slice(0, 90));
  }
  const { backend } = await owner({ fail: true });
  const failed = await backend.listTasks("all");
  assert.deepEqual(failed, unavailable);
  assert.equal(JSON.stringify(failed).includes("secret"), false);
});

test("17/20/21/25/26. getTask: opaque unknown; zero or multiple factual runs; no internal ids or snapshots", async () => {
  const { backend: none } = await owner({ detail: [] });
  assert.deepEqual(await none.getTask("task-unknown"), unavailable);
  const { backend: zero } = await owner({ detail: [taskRow("task-z", "project-a", "draft")] });
  const empty = await zero.getTask("task-z");
  assert.equal(empty.status, "available");
  assert.deepEqual([empty.data?.runs, empty.data?.task.linkedRunCount, empty.data?.task.latestRun], [[], 0, null]);
  const rows = [3, 2, 1].map((minute) => taskRow("task-m", "project-a", "running", { linked_run_count: "3", ...run(`run-${minute}`, "project-a", minute) }));
  const { backend: multi, calls } = await owner({ detail: rows });
  const detail = await multi.getTask("task-m");
  assert.equal(detail.status, "available");
  assert.deepEqual(detail.data?.runs.map((item) => item.runId), ["run-3", "run-2", "run-1"]);
  assert.equal(detail.data?.task.latestRun?.runId, "run-3");
  assert.equal(detail.data?.task.status, "running", "task status is persisted state, never derived from runs");
  assert.deepEqual(calls.map((call) => call.tag), ["project-task:detail"], "one statement for task + runs");
  const json = JSON.stringify(detail);
  for (const leak of [INTERNAL_UUID, workspaceDatabaseId, "runtimeSnapshot", "runSnapshot", "snapshot", "created_by", "workspace"]) {
    assert.equal(json.includes(leak), false, `leaked ${leak}`);
  }
  // A detail row of another task or project, or a mismatched snapshot, fails the whole detail closed.
  for (const bad of [[...rows.slice(0, 2), taskRow("task-other", "project-a", "running", { linked_run_count: "3", ...run("run-1", "project-a", 1) })],
    [taskRow("task-m", "project-a", "running", { linked_run_count: "1", ...run("run-1", "project-a", 1, { run_snapshot: snapshot("run-1", "project-b") }) })]]) {
    const { backend: broken } = await owner({ detail: bad });
    assert.deepEqual(await broken.getTask("task-m"), unavailable);
  }
});

test("19. hostile task ids / views / project ids never reach SQL; no workspace / actor / role / user input", async () => {
  const { backend, calls } = await owner();
  let trapped = 0;
  const proxy = new Proxy({}, { get() { trapped += 1; return "x"; }, ownKeys() { trapped += 1; return []; } });
  for (const hostile of ["", "TASK", "../x", "x".repeat(65), 7, null, {}, ["t"], proxy]) {
    assert.notEqual((await backend.getTask(hostile)).status, "available");
    assert.notEqual((await backend.listProjectTasks(hostile, "all")).status, "available");
  }
  for (const view of ["", "everything", "ALL", null, 1, {}, proxy]) {
    assert.notEqual((await backend.listTasks(view)).status, "available", String(typeof view));
  }
  assert.equal(trapped, 0);
  assert.equal(calls.length, 0, "no statement for hostile input");
  assert.deepEqual([backend.listTasks.length, backend.listProjectTasks.length, backend.getTask.length], [1, 2, 1]);
  const extra: any = backend.listTasks;
  await extra("all", { workspaceId: "tenant-b", actorId: "intruder", role: "owner" });
  assert.deepEqual(calls.map((call) => call.values[0]), [workspaceDatabaseId]);
  const authorizer = bundle.createOwnerReadAuthorizer(ownerActorId, workspaceId);
  for (const action of ["list_tasks", "list_project_tasks", "read_task"]) {
    assert.deepEqual(authorizer.authorize({ action, actorId: ownerActorId, workspaceId, runId: null } as any), { verdict: "allow" });
    assert.deepEqual(authorizer.authorize({ action, actorId: "intruder", workspaceId, runId: null } as any), { verdict: "deny" });
  }
  for (const action of ["create_task", "update_task", "delete_task", "link_task_run", "set_task_status"]) {
    assert.deepEqual(authorizer.authorize({ action, actorId: ownerActorId, workspaceId, runId: null } as any), { verdict: "deny" });
  }
});

test("22/23. no task write path and no task inferred from runs", () => {
  for (const path of ["lib/tasks/project-task.ts", "lib/tasks/postgres-project-task-read.ts"]) {
    const code = readFileSync(`${root}${path}`, "utf8").replace(/\/\/[^\n]*/gu, "");
    assert.ok(!/\b(insert|update|delete|truncate|alter|drop)\s+(into|from|table)?/iu.test(code.replace(/updated_at|completed_at/gu, "")), `${path} writes`);
  }
  const sql = readFileSync(`${root}lib/tasks/postgres-project-task-read.ts`, "utf8");
  assert.match(sql, /from project_tasks as task/u, "tasks come only from project_tasks");
  assert.ok(!/from workflow_runs as task|select[^;]*from workflow_runs[^;]*group by/iu.test(sql), "no task synthesized from runs");
});

test("migration 0010: DB-level project, task↔run and completion integrity; nothing seeded", () => {
  const sql = readFileSync(`${root}db/migrations/0010_project_tasks.sql`, "utf8");
  for (const fragment of [
    "foreign key (workspace_id, project_key)\n    references projects (workspace_id, project_key)",
    "foreign key (workspace_id, project_key, task_key)\n    references project_tasks (workspace_id, project_key, task_key) on delete cascade",
    "foreign key (workspace_id, project_key, run_id)\n    references workflow_runs (workspace_id, project_id, runtime_id) on delete cascade",
    "unique (workspace_id, run_id)",
    "unique (workspace_id, task_key)",
    "check ((status = 'completed') = (completed_at is not null))",
  ]) {
    assert.ok(sql.includes(fragment), fragment.slice(0, 50));
  }
  const code = sql.replace(/--[^\n]*/gu, "");
  assert.ok(!/insert into|feature_plan|plan_snapshot|jsonb/iu.test(code), "no seed, no FeaturePlan persistence, no JSON blobs");
});

test("AI-038.4a corrective: Task mutations are a separate narrow contract, not part of the read backend", async () => {
  const code = readFileSync(`${root}lib/tasks/owner-task-mutations.ts`, "utf8");
  const imports = [...code.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]).sort();
  assert.deepEqual(imports, [
    "../composition/authenticated-owner-read-runtime", "../contracts/workflow-run.ts", "../db/workflow-runtime-store",
    "../db/workflow-runtime-tenant", "../db/workflow-runtime-tenant.ts", "../projects/project-registry.ts", "./project-task.ts",
    "node:crypto", "node:util/types",
  ].sort(), "no provider, executor, GitHub, fetch or runtime-service import");
  assert.ok(!/\bfetch\(|providers\/|executor|octokit|api\.github|startRun|dispatch/iu.test(code.replace(/\/\/[^\n]*/gu, "")), "no run start or external action");
  for (const statement of code.match(/`\/\* task-mutation:[\s\S]*?`/gu) ?? []) {
    assert.ok(!/workflow_runs[\s\S]*\b(insert|update|delete)\b|\b(insert into|update|delete from)\s+workflow_runs/iu.test(statement), "runs are never written");
  }
  // The read backend stays read-only: it neither imports nor exposes the mutations.
  for (const path of ["lib/composition/owner-read-runtime.ts", "lib/composition/owner-console-read.ts", "lib/composition/owner-console-read.server.ts"]) {
    assert.ok(!readFileSync(`${root}${path}`, "utf8").includes("owner-task-mutations"), path);
  }
  const backend = bundle.ownerReadActions as readonly string[];
  assert.ok(!backend.some((action) => /create|attach|write|update/iu.test(action)));
  // Server-generated Task IDs and an exported, deterministic intent fingerprint.
  assert.match(code, /`task-\$\{randomUUID\(\)/u);
  const mutations = (await import(new URL("../lib/tasks/owner-task-mutations.ts", import.meta.url).href)) as typeof import("../lib/tasks/owner-task-mutations");
  const base = { projectId: "project-a", title: "Title", goal: null, type: "feature", priority: "P1", riskLevel: null } as any;
  const fingerprint = mutations.creationIntentFingerprint(base);
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(mutations.creationIntentFingerprint({ ...base }), fingerprint);
  for (const change of [{ projectId: "project-b" }, { title: "Other" }, { goal: "g" }, { type: "fix" }, { priority: "P2" }, { riskLevel: "low" }]) {
    assert.notEqual(mutations.creationIntentFingerprint({ ...base, ...change }), fingerprint, JSON.stringify(change));
  }
  const migration = readFileSync(`${root}db/migrations/0010_project_tasks.sql`, "utf8");
  for (const fragment of [
    "on project_tasks (workspace_id, creation_idempotency_key)\n  where creation_idempotency_key is not null",
    "check ((creation_idempotency_key is null) = (creation_intent_fingerprint is null))",
    "on audit_events (workspace_id, event_type, entity_id)\n  where event_type in ('task.created', 'task.run_attached')",
  ]) {
    assert.ok(migration.includes(fragment), fragment.slice(0, 50));
  }
});
