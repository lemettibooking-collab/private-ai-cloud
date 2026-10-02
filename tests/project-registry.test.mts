/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-038.3.1 Project Registry + project-scoped run discovery: pure validation and the full read chain
// (OwnerReadBackend → tenant facade → authorized access → read model → registry SQL) over a recording
// fake database. No real database, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const registry = (await import(new URL("../lib/projects/project-registry.ts", import.meta.url).href)) as typeof import("../lib/projects/project-registry");
const bundle = (await import(new URL("../lib/composition/owner-read-runtime.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-read-runtime");

const stateFixture = (await import(new URL("./helpers/workflow-runtime-state-fixture.mts", import.meta.url).href)) as typeof import("./helpers/workflow-runtime-state-fixture.mts");

const root = fileURLToPath(new URL("..", import.meta.url));

// A factual, canonically valid runtime snapshot for (runId, projectId): status running, revision 1.
function factualSnapshot(runId: string, projectId: string) {
  const state = stateFixture.transitionRuntimeState(stateFixture.createWorkflowRuntimeStateFixture(), "run_started");
  return JSON.parse(JSON.stringify(state.snapshot).replaceAll("\"run-one\"", JSON.stringify(runId)).replaceAll("\"project-one\"", JSON.stringify(projectId)));
}
const workspaceId = "workspace-primary";
const workspaceDatabaseId = "00000000-0000-4000-8000-0000000000a1";
const ownerActorId = "owner-one";
const SECRET = "postgres://owner:secret@db/x select * from projects where workspace_id";

const projectRow = (key: string, extra: Record<string, unknown> = {}) => ({
  project_key: key, display_name: `Project ${key}`, status: "active", repository_url: null, default_branch: null, ...extra,
});
// Columns agree with a factual snapshot (AI-038.3.1 corrective): running, revision 1.
const runRow = (runId: string, project = "project-a", extra: Record<string, unknown> = {}) => ({
  project_key: project, runtime_id: runId, project_id: project, workflow_id: "workflow-one", status: "running", revision: "1",
  created_at: new Date("2026-10-01T10:00:00.000Z"), started_at: new Date("2026-10-01T10:00:01.000Z"), completed_at: null,
  runtime_snapshot: /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(runId) ? factualSnapshot(runId, project) : null, ...extra,
});

type Behaviour = { projects?: unknown[]; runs?: unknown[]; fail?: boolean };

function fakeDatabase(behaviour: Behaviour = {}) {
  const calls: { tag: string; values: unknown[] }[] = [];
  const database = {
    async connect() {
      return {
        async query(text: string, values: unknown[] = []) {
          const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1] ?? text.trim();
          if (tag === "workflow-runtime-tenant:resolve") {
            return values[0] === workspaceId
              ? { rows: [{ workspace_database_id: workspaceDatabaseId, domain_workspace_id: workspaceId, status: "active" }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          calls.push({ tag, values });
          if (behaviour.fail) throw new Error(SECRET);
          const rows = tag === "project-registry:list" ? behaviour.projects ?? [] : tag === "project-registry:list-runs" ? behaviour.runs ?? [] : [];
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
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  return { calls: db.calls, backend: decision.backend! };
}

const unavailable = { verdict: "deny", status: "unavailable", data: null };

test("project key, display name, status and limit validation is strict", () => {
  for (const key of ["smart-algorithms", "a", "pac.v2", "x".repeat(64)]) assert.equal(registry.isProjectKey(key), true, key);
  for (const key of ["", "Smart", "-x", "a b", "a/b", "../a", "x".repeat(65), "проект", 7, null, {}, ["a"]]) {
    assert.equal(registry.isProjectKey(key), false, String(key));
  }
  for (const name of ["Smart Algorithms", "x".repeat(120)]) assert.equal(registry.isDisplayName(name), true);
  for (const name of ["", " x", "x ", "x\ny", "a\u0000", "x".repeat(121), 5]) assert.equal(registry.isDisplayName(name), false, JSON.stringify(name));
  assert.deepEqual(registry.projectStatuses, ["active", "paused", "archived"]);
  assert.deepEqual(registry.discoverableProjectStatuses, ["active", "paused"], "archived projects are never discovered");
  assert.equal(registry.boundedProjectLimit(undefined), 25);
  for (const limit of [1, 100]) assert.equal(registry.boundedProjectLimit(limit), limit);
  for (const limit of [0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10", {}, null]) {
    assert.equal(registry.boundedProjectLimit(limit), null, String(limit));
  }
});

test("repository metadata: canonical HTTPS locators only — no credentials, query, fragment, ssh or local paths", () => {
  for (const url of ["https://github.com/org/repo", "https://github.com/org/repo.git", "https://gitlab.example.com/group/sub/repo"]) {
    assert.equal(registry.isCanonicalRepositoryUrl(url), true, url);
  }
  for (const url of [
    "https://user:pw@github.com/o/r", "https://token@github.com/o/r", "https://github.com/o/r?access_token=abc",
    "https://github.com/o/r#x", "https://github.com/o/r%40x", "https://github.com/ghp_abcdef/r", "https://github.com/o/github_pat_1",
    "http://github.com/o/r", "git@github.com:o/r.git", "ssh://git@github.com/o/r", "file:///Users/me/repo",
    "/Users/me/Smart Algorithms", "/var/lib/pac/workspaces/run-123", "/home/pac/repos/x", "C:\\repos\\x",
    "https://localhost/o/r", "https://GitHub.com/o/r", "https://github.com", "https://github.com/", "https://github.com/o/r/",
    `https://github.com/${"a".repeat(300)}`, "", 42, null,
  ]) {
    assert.equal(registry.isCanonicalRepositoryUrl(url), false, String(url));
  }
  for (const branch of ["main", "release/1.2", "feature/x_y-z"]) assert.equal(registry.isDefaultBranch(branch), true, branch);
  for (const branch of ["", "../x", "a..b", "a//b", "a/", "a.", "x.lock", "a/.b", "-x", "a b", "a~1", "x".repeat(201)]) {
    assert.equal(registry.isDefaultBranch(branch), false, branch);
  }
});

test("a malformed registry row is rejected as a whole (fail closed), never partially projected", () => {
  assert.deepEqual(registry.projectSummaryFromRow(projectRow("p", { repository_url: "https://github.com/o/r", default_branch: "main" })), {
    projectId: "p", displayName: "Project p", status: "active", repository: { url: "https://github.com/o/r", defaultBranch: "main" },
  });
  for (const extra of [{ project_key: "Bad" }, { status: "deleted" }, { display_name: "" }, { repository_url: "https://u:p@github.com/o/r" },
    { repository_url: null, default_branch: "main" }, { default_branch: "../x", repository_url: "https://github.com/o/r" }]) {
    assert.equal(registry.projectSummaryFromRow(projectRow("p", extra)), null, JSON.stringify(extra));
  }
});

test("listProjects: one bounded tenant-scoped statement, public projection only, archived excluded by SQL", async () => {
  const { backend, calls } = await owner({ projects: [
    projectRow("project-a", { repository_url: "https://github.com/org/a", default_branch: "main", id: "uuid-x", workspace_id: workspaceDatabaseId }),
    projectRow("project-b", { status: "paused" }),
  ] });
  const result = await backend.listProjects();
  assert.deepEqual(result, { verdict: "allow", status: "available", data: [
    { projectId: "project-a", displayName: "Project project-a", status: "active", repository: { url: "https://github.com/org/a", defaultBranch: "main" } },
    { projectId: "project-b", displayName: "Project project-b", status: "paused", repository: null },
  ] });
  assert.equal(JSON.stringify(result).includes(workspaceDatabaseId), false, "no workspace UUID");
  assert.deepEqual(calls.map((call) => call.tag), ["project-registry:list"], "exactly one statement");
  assert.deepEqual(calls[0].values, [workspaceDatabaseId, ["active", "paused"], 25]);
  await backend.listProjects(100);
  assert.equal(calls[1].values[2], 100);
});

test("listProjects: invalid limits are rejected by the facade before any statement", async () => {
  const { backend, calls } = await owner();
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10", {}, null]) {
    assert.equal((await backend.listProjects(limit)).status, "invalid_input", String(limit));
  }
  assert.equal((await backend.listProjects(101)).status, "limit_exceeded");
  assert.deepEqual(calls, []);
});

test("listProjects: malformed rows, oversized results and read failures are opaque and sanitized", async () => {
  for (const behaviour of [
    { projects: [projectRow("Bad Key")] },
    { projects: [projectRow("p", { repository_url: "https://u:p@github.com/o/r" })] },
    { projects: Array.from({ length: 26 }, (_, index) => projectRow(`p${index}`)) },
    { fail: true },
  ]) {
    const { backend } = await owner(behaviour);
    const result = await backend.listProjects();
    assert.deepEqual(result, unavailable, JSON.stringify(behaviour).slice(0, 80));
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

test("listRuns(projectId): one bounded statement scoped by BOTH workspace and project; minimal public summary", async () => {
  const { backend, calls } = await owner({ runs: [runRow("run-2"), runRow("run-1")] });
  const result = await backend.listRuns("project-a", 10);
  assert.deepEqual(result, { verdict: "allow", status: "available", data: [
    { runId: "run-2", projectId: "project-a", workflowId: "workflow-one", status: "running", revision: 1, createdAt: "2026-10-01T10:00:00.000Z", startedAt: "2026-10-01T10:00:01.000Z", completedAt: null },
    { runId: "run-1", projectId: "project-a", workflowId: "workflow-one", status: "running", revision: 1, createdAt: "2026-10-01T10:00:00.000Z", startedAt: "2026-10-01T10:00:01.000Z", completedAt: null },
  ] });
  assert.equal(JSON.stringify(result).includes("snapshot"), false, "the runtime snapshot is never projected");
  assert.deepEqual(calls.map((call) => call.tag), ["project-registry:list-runs"], "no N+1: one statement");
  assert.deepEqual(calls[0].values, [workspaceDatabaseId, "project-a", ["active", "paused"], 10]);
  const sql = readFileSync(`${root}lib/projects/postgres-project-registry.ts`, "utf8");
  assert.match(sql, /where candidate\.workspace_id = project\.workspace_id\s+and candidate\.project_id = project\.project_key/u);
  assert.match(sql, /where project\.workspace_id = \$1 and project\.project_key = \$2/u);
  assert.match(sql, /order by candidate\.created_at desc, candidate\.runtime_id desc/u, "deterministic order");
});

test("listRuns: an unknown/foreign/archived project equals a malformed one; a registered empty project is []", async () => {
  const unknown = await owner({ runs: [] });
  assert.deepEqual(await unknown.backend.listRuns("foreign-project"), unavailable);
  const empty = await owner({ runs: [{ project_key: "project-a", runtime_id: null, project_id: null, workflow_id: null, status: null, revision: null, created_at: null, started_at: null, completed_at: null }] });
  assert.deepEqual(await empty.backend.listRuns("project-a"), { verdict: "allow", status: "available", data: [] });
  // Malformed rows / a row of another project / too many rows: the whole read fails closed.
  for (const runs of [[runRow("run-1", "project-b")], [runRow("RUN!")], [runRow("run-1", "project-a", { status: "exploded" })],
    [runRow("run-1", "project-a", { created_at: "not a date" })], Array.from({ length: 26 }, (_, index) => runRow(`run-${index}`))]) {
    const { backend } = await owner({ runs });
    assert.deepEqual(await backend.listRuns("project-a"), unavailable, JSON.stringify(runs[0]).slice(0, 60));
  }
  const failing = await owner({ fail: true });
  const failed = await failing.backend.listRuns("project-a");
  assert.deepEqual(failed, unavailable);
  assert.equal(JSON.stringify(failed).includes("secret"), false);
});

test("listRuns: hostile projectId / limit never reach SQL and never select a workspace", async () => {
  const { backend, calls } = await owner({ runs: [runRow("run-1")] });
  let trapped = 0;
  const proxy = new Proxy({}, { get() { trapped += 1; return "project-a"; }, ownKeys() { trapped += 1; return []; } });
  const getter = Object.defineProperty({}, "projectId", { get() { trapped += 1; return "project-a"; }, enumerable: true });
  const hostile = ["", "Project-A", "../project-a", "x".repeat(65), "project a", 7, null, undefined, {}, ["project-a"], proxy, getter,
    { projectId: "project-a", workspaceId: "tenant-b" }];
  for (const [index, projectId] of hostile.entries()) {
    const status = (await backend.listRuns(projectId)).status;
    assert.ok(status === "invalid_input" || status === "limit_exceeded", `case ${index} → ${status}`);
  }
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5", {}]) {
    assert.equal((await backend.listRuns("project-a", limit)).status, "invalid_input", String(limit));
  }
  assert.equal((await backend.listRuns("project-a", 101)).status, "limit_exceeded");
  assert.equal(trapped, 0, "no Proxy trap or getter ran");
  assert.equal(calls.length, 0, "no statement for hostile input");
  // Extra positional arguments carrying identity are ignored; SQL still binds only the trusted tenant.
  const extra: any = backend.listRuns;
  await extra("project-a", 5, { workspaceId: "tenant-b", actorId: "intruder" }, "tenant-b");
  assert.deepEqual(calls.map((call) => call.values[0]), [workspaceDatabaseId]);
});

test("public Owner methods accept no workspace / actor / role / user parameter and no write method exists", async () => {
  const { backend } = await owner();
  assert.deepEqual(Object.keys(backend).sort(), ["getRunAuditTimeline", "getRunModelUsage", "getRunOverview", "getTask", "listApprovalQueue", "listProjectTasks", "listProjects", "listRuns", "listTasks"]);
  assert.equal(backend.listProjects.length, 1);
  assert.equal(backend.listRuns.length, 2);
  const authorizer = bundle.createOwnerReadAuthorizer(ownerActorId, workspaceId);
  for (const action of ["list_projects", "list_project_runs"]) {
    assert.deepEqual(authorizer.authorize({ action, actorId: ownerActorId, workspaceId, runId: null } as any), { verdict: "allow" });
    assert.deepEqual(authorizer.authorize({ action, actorId: "intruder", workspaceId, runId: null } as any), { verdict: "deny" });
    assert.deepEqual(authorizer.authorize({ action, actorId: ownerActorId, workspaceId: "tenant-b", runId: null } as any), { verdict: "deny" });
  }
  for (const action of ["create_project", "update_project", "delete_project", "execute_runtime_command"]) {
    assert.deepEqual(authorizer.authorize({ action, actorId: ownerActorId, workspaceId, runId: null } as any), { verdict: "deny" });
  }
  for (const path of ["lib/projects/project-registry.ts", "lib/projects/postgres-project-registry.ts"]) {
    const code = readFileSync(`${root}${path}`, "utf8").replace(/\/\/[^\n]*/gu, "");
    assert.ok(!/\b(insert|update|delete|truncate|alter|drop)\s/iu.test(code.replace(/updated_at|set_updated_at/gu, "")), `${path} contains a write statement`);
    assert.ok(!/child_process|execSync|spawn|fetch\(|https\.request|git clone/u.test(code), `${path} performs an external operation`);
  }
});

test("migration 0009 is append-only, constrained and stores no paths, policies or secrets", () => {
  const sql = readFileSync(`${root}db/migrations/0009_project_registry.sql`, "utf8");
  for (const constraint of ["projects_project_key_check", "projects_display_name_check", "projects_status_check", "projects_repository_url_check",
    "projects_default_branch_check", "projects_default_branch_requires_repository_check", "projects_workspace_project_key_unique"]) {
    assert.ok(sql.includes(`constraint ${constraint}`), constraint);
  }
  const code = sql.replace(/--[^\n]*/gu, "");
  assert.ok(!/jsonb|path|policy|secret|token|password|credential/iu.test(code), "no JSON policy, path or secret column");
  assert.ok(!/references projects|alter table workflow_runs/iu.test(code), "no FK from workflow_runs to the registry");
  assert.ok(!/insert into/iu.test(code), "nothing is seeded");
});

test("AI-038.3.1 corrective: a run whose denormalized columns disagree with its factual snapshot fails the whole list closed", async () => {
  // Every column below is structurally valid; only the agreement with the canonical snapshot differs.
  const consistent = { project_key: "project-a", runtime_id: "run-x", project_id: "project-a", workflow_id: "workflow-one", status: "running",
    revision: "1", created_at: new Date("2026-10-01T10:00:00.000Z"), started_at: null, completed_at: null, runtime_snapshot: factualSnapshot("run-x", "project-a") };
  const mismatches: Record<string, Record<string, unknown>> = {
    projectId: { runtime_snapshot: factualSnapshot("run-x", "project-b") },
    workflowId: { workflow_id: "workflow-two" },
    status: { status: "completed" },
    revision: { revision: "2" },
    runId: { runtime_id: "run-y" },
    snapshotMissing: { runtime_snapshot: null },
    snapshotInvalid: { runtime_snapshot: { runId: "run-x", projectId: "project-a" } },
  };
  // Positive control: the same two rows WITHOUT a mismatch are returned.
  const control = await owner({ runs: [{ ...consistent }, { ...consistent, runtime_id: "run-z", runtime_snapshot: factualSnapshot("run-z", "project-a") }] });
  const allowed = await control.backend.listRuns("project-a");
  assert.equal(allowed.status, "available", JSON.stringify(allowed));
  assert.deepEqual(allowed.data?.map((run) => run.runId), ["run-x", "run-z"]);
  for (const [name, change] of Object.entries(mismatches)) {
    const { backend } = await owner({ runs: [{ ...consistent }, { ...consistent, runtime_id: "run-z", runtime_snapshot: factualSnapshot("run-z", "project-a"), ...change }] });
    const result = await backend.listRuns("project-a");
    assert.deepEqual(result, unavailable, `${name} mismatch must fail the whole list closed`);
  }
});
