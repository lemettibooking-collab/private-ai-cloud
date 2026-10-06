// Live PostgreSQL: AI-039 FeaturePlan revisions (migration 0011) — the saveDraftRevision mutation
// contract over the real authenticated identity (GitHub session adapter; only the verified Auth.js
// session is faked), the read through the REAL authenticated chain (AI-038.1 Owner check → AI-038.0
// backend → tenant facade → access → read model → plan SQL) and the Owner Console loader, with
// concurrency races, tenancy, audit and corruption. Planning data only: no run, model, executor or
// repository action.
import assert from "node:assert/strict";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const identity = (await import(new URL("../../lib/auth/github-session-identity-source.ts", import.meta.url).href)) as typeof import("../../lib/auth/github-session-identity-source");
const taskMutations = (await import(new URL("../../lib/tasks/owner-task-mutations.ts", import.meta.url).href)) as typeof import("../../lib/tasks/owner-task-mutations");
const planMutations = (await import(new URL("../../lib/development/feature-plan-mutations.ts", import.meta.url).href)) as typeof import("../../lib/development/feature-plan-mutations");
const revision = (await import(new URL("../../lib/development/feature-plan-revision.ts", import.meta.url).href)) as typeof import("../../lib/development/feature-plan-revision");
const composed = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");
const consoleRead = (await import(new URL("../../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-console-read");
const context = (await import(new URL("../../lib/projects/project-context.ts", import.meta.url).href)) as typeof import("../../lib/projects/project-context");
const draftBinding = (await import(new URL("../../lib/composition/owner-feature-plan-draft.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-feature-plan-draft");

const db = await live.useLiveDatabase("featureplans");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);

const OWNER = "00000000-0000-4000-8000-000000006101";
const MEMBER = "00000000-0000-4000-8000-000000006102";
const OWNER_B = "00000000-0000-4000-8000-000000006103";
for (const [id, name] of [[OWNER, "owner"], [MEMBER, "member"], [OWNER_B, "ownerb"]]) {
  await db.admin.query("insert into users (id, email, name, status) values ($1, $2, $2, 'active')", [id, `${name}@pac.test`]);
}
const role = async (workspace: string) => (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [workspace])).rows[0].id;
const member = async (workspace: string, user: string) => (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [workspace, user])).rows[0].id;
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(A.id, OWNER), await role(A.id)]);
await member(A.id, MEMBER);
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [await member(B.id, OWNER_B), await role(B.id)]);
await db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', '6101', 'active'), ($2, 'github', '6102', 'active'), ($3, 'github', '6103', 'active')", [OWNER, MEMBER, OWNER_B]);
for (const [workspace, key, status] of [[A.id, "project-a", "active"], [A.id, "project-b", "active"], [A.id, "project-paused", "paused"], [A.id, "project-arch", "archived"], [B.id, "project-a", "active"]]) {
  await db.admin.query("insert into projects (workspace_id, project_key, display_name, status) values ($1, $2, $2, $3)", [workspace, key, status]);
}

const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 8 });
const session = (subject: string | null) => subject === null ? null : { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject: subject } };
const identitySource = (subject: string | null) => identity.createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => session(subject) }, database });
const planner = (subject: string | null, domain: string = A.domain) => planMutations.createOwnerFeaturePlanMutations({ database, domainWorkspaceId: domain, identitySource: identitySource(subject) });
const owner = planner("6101");

// Draft tasks through the REAL Quick Create mutation (AI-038.4a createTask).
const tasks = taskMutations.createOwnerTaskMutations({ database, domainWorkspaceId: A.domain, identitySource: identitySource("6101") });
async function draftTask(key: string, projectId = "project-a"): Promise<string> {
  const created = await tasks.createTask({ idempotencyKey: `qc-${key}-000000`, projectId, title: `Task ${key}`, goal: "Owner intent", type: "feature", priority: "P1", riskLevel: "medium" });
  assert.equal(created.status, "created", JSON.stringify(created));
  return created.status === "created" ? created.task.taskId : "";
}
const TASK = await draftTask("main");
const TASK_RACE = await draftTask("race");
const TASK_ALLOC = await draftTask("alloc");
const TASK_CORRUPT = await draftTask("corrupt");
const TASK_HISTORY = await draftTask("history");
const TASK_B = await draftTask("projb", "project-b");
const TASK_AI = await draftTask("ai");
// Factual non-plannable states, written as data by the admin (AI-039 never changes task status).
const adminTask = (workspace: string, project: string, key: string, status: string) => db.admin.query(
  "insert into project_tasks (workspace_id, project_key, task_key, title, task_type, status, completed_at) values ($1, $2, $3, $3, 'feature', $4, case when $4 = 'completed' then now() end)",
  [workspace, project, key, status]);
await adminTask(A.id, "project-a", "task-ready", "ready");
await adminTask(A.id, "project-a", "task-done", "completed");
await adminTask(A.id, "project-paused", "task-paused", "draft");
await adminTask(A.id, "project-arch", "task-arch", "draft");
await adminTask(B.id, "project-a", "task-foreign", "draft");

const step = (id: string, sequence: number, extra: Record<string, unknown> = {}) => ({
  id, sequence, title: `Step ${id}`, goal: `Goal ${id}`, scope: [`scope ${id}`], nonGoals: [], allowedPaths: [`lib/${id}/`], acceptanceCriteria: [`ok ${id}`],
  verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "low", priority: "P2", requiresOwnerApproval: false, ...extra,
});
const threeSteps = (title = "Plan") => ({
  title, goal: "Deliver the feature",
  tasks: [step("step-1", 1), step("step-2", 2, { dependencyIds: ["step-1"], riskLevel: "high", requiresOwnerApproval: true }),
    step("step-3", 3, { dependencyIds: ["step-1", "step-2"], verificationCommands: ["npm run lint", "npm test"] })],
});
const save = (key: string, taskId: string, plan: unknown = threeSteps()) => ({ idempotencyKey: key, taskId, plan });
const count = async (sql: string, values: unknown[] = []) => Number((await db.admin.query(sql, values)).rows[0].n);
const revisions = (taskId: string) => count("select count(*)::int as n from project_task_feature_plans where workspace_id = $1 and task_key = $2", [A.id, taskId]);
const audits = () => count("select count(*)::int as n from audit_events where workspace_id = $1 and event_type = 'task.feature_plan_revision_created'", [A.id]);
const totals = async () => [await count("select count(*)::int as n from project_task_feature_plans"), await count("select count(*)::int as n from audit_events where event_type = 'task.feature_plan_revision_created'")];
const taskState = async (taskId: string) => (await db.admin.query("select status, updated_at::text as updated_at from project_tasks where workspace_id = $1 and task_key = $2", [A.id, taskId])).rows[0];
const attempt = async (sql: string, values: unknown[]) => {
  try { await db.admin.query(sql, values); return "accepted"; } catch (error) { return (error as { code?: string }).code; }
};
const backendFor = async (subject: string | null, domain: string = A.domain) => {
  const decision = await composed.createGitHubOwnerReadRuntime({ database, domainWorkspaceId: domain, sessionResolver: { resolve: () => session(subject) } });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision));
  return decision.backend!;
};
const readerFor = (subject: string | null) => consoleRead.createOwnerConsoleReader({
  workspaceSlug: A.domain,
  withRuntime: async (workspace, read) => read(await composed.createGitHubOwnerReadRuntime({ database, domainWorkspaceId: workspace, sessionResolver: { resolve: () => session(subject) } })),
});

test("create: revision 1 of a server-generated plan key, canonical stored plan, exactly one audit; the task is untouched", async () => {
  const before = await taskState(TASK);
  const auditsBefore = await audits();
  const created = await owner.saveDraftRevision(save("fp-main-0001", TASK));
  assert.equal(created.status, "created", JSON.stringify(created));
  if (created.status !== "created") return;
  assert.deepEqual({ ...created.revision, planId: "?" }, { taskId: TASK, projectId: "project-a", planId: "?", revision: 1 });
  assert.match(created.revision.planId, /^plan-[0-9a-f]{20}$/u);
  const row = (await db.admin.query("select plan_key, revision, plan_json, plan_fingerprint, created_by::text as created_by, project_key from project_task_feature_plans where workspace_id = $1 and task_key = $2", [A.id, TASK])).rows[0];
  assert.deepEqual([row.plan_key, row.revision, row.created_by, row.project_key, row.plan_json.status, row.plan_json.id], [created.revision.planId, 1, OWNER, "project-a", "draft", created.revision.planId]);
  const reparsed = revision.normalizeDraftPlan({ title: row.plan_json.title, goal: row.plan_json.goal, tasks: row.plan_json.tasks }, row.plan_key);
  assert.ok(reparsed.ok && revision.featurePlanFingerprint(reparsed.plan) === row.plan_fingerprint, "stored plan re-validates to its stored fingerprint");
  assert.equal(await audits(), auditsBefore + 1);
  const audit = (await db.admin.query("select actor_user_id::text as actor, entity_type, metadata from audit_events where workspace_id = $1 and event_type = 'task.feature_plan_revision_created'", [A.id])).rows[0];
  assert.deepEqual([audit.actor, audit.entity_type, audit.metadata.taskId, audit.metadata.revision, audit.metadata.taskCount, audit.metadata.planFingerprint],
    [OWNER, "project_task_feature_plan", TASK, 1, 3, row.plan_fingerprint]);
  assert.ok(!/fp-main-0001|idempotency|intent/u.test(JSON.stringify(audit.metadata)), "no idempotency key / intent fingerprint in audit");
  assert.deepEqual(await taskState(TASK), before, "ProjectTask status and updated_at are unchanged (no lifecycle transition)");
  assert.equal(await count("select count(*)::int as n from project_task_runs where workspace_id = $1 and task_key = $2", [A.id, TASK]), 0, "no run attached");
});

test("idempotency: exact replay is the same revision with no new row or audit; same key + changed intent or other task → conflict", async () => {
  const [rowsBefore, auditsBefore] = await totals();
  const replay = await owner.saveDraftRevision(save("fp-main-0001", TASK));
  assert.equal(replay.status, "replayed", JSON.stringify(replay));
  assert.ok(replay.status === "replayed" && replay.revision.revision === 1);
  // A semantically identical plan (whitespace / duplicate items / task order) is the same intent.
  const noisy = threeSteps(" Plan ");
  noisy.tasks.reverse();
  (noisy.tasks[2] as { scope: string[] }).scope = [" scope step-1 ", "scope step-1"];
  assert.equal((await owner.saveDraftRevision(save("fp-main-0001", TASK, noisy))).status, "replayed");
  for (const changed of [save("fp-main-0001", TASK, threeSteps("Other plan")), save("fp-main-0001", TASK_B)]) {
    assert.deepEqual(await owner.saveDraftRevision(changed), { status: "conflict" });
  }
  assert.deepEqual(await totals(), [rowsBefore, auditsBefore], "replays and conflicts write nothing");
});

test("revisions increment deterministically; the plan key is stable; old revisions stay byte-identical and cannot be updated", async () => {
  const first = (await db.admin.query("select plan_key, plan_json::text as plan_json, plan_fingerprint, created_at::text as created_at from project_task_feature_plans where workspace_id = $1 and task_key = $2 and revision = 1", [A.id, TASK])).rows[0];
  const second = await owner.saveDraftRevision(save("fp-main-0002", TASK, threeSteps("Plan v2")));
  const third = await owner.saveDraftRevision(save("fp-main-0003", TASK, threeSteps("Plan v3")));
  assert.ok(second.status === "created" && third.status === "created");
  if (second.status !== "created" || third.status !== "created") return;
  assert.deepEqual([second.revision.revision, third.revision.revision], [2, 3]);
  assert.deepEqual([second.revision.planId, third.revision.planId], [first.plan_key, first.plan_key], "one plan lineage per task");
  const after = (await db.admin.query("select plan_key, plan_json::text as plan_json, plan_fingerprint, created_at::text as created_at from project_task_feature_plans where workspace_id = $1 and task_key = $2 and revision = 1", [A.id, TASK])).rows[0];
  assert.deepEqual(after, first, "revision 1 is unchanged");
  assert.equal(await attempt("update project_task_feature_plans set plan_fingerprint = $3 where workspace_id = $1 and task_key = $2 and revision = 1", [A.id, TASK, "f".repeat(64)]), "55000", "immutable");
  assert.equal(await revisions(TASK), 3);
});

test("race: concurrent double submit with one key creates exactly one revision and one audit", async () => {
  const auditsBefore = await audits();
  const results = await Promise.all(Array.from({ length: 10 }, () => owner.saveDraftRevision(save("fp-race-0001", TASK_RACE))));
  const statuses = results.map((result) => result.status).sort();
  assert.equal(statuses.filter((status) => status === "created").length, 1, JSON.stringify(statuses));
  assert.ok(statuses.every((status) => status === "created" || status === "replayed"), JSON.stringify(statuses));
  assert.equal(new Set(results.map((result) => ("revision" in result ? `${result.revision.planId}:${result.revision.revision}` : "-"))).size, 1, "every call names the same revision");
  assert.equal(await revisions(TASK_RACE), 1);
  assert.equal(await audits(), auditsBefore + 1);
});

test("race: concurrent saves with different keys allocate contiguous unique revisions (task row lock + unique key)", async () => {
  const auditsBefore = await audits();
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => owner.saveDraftRevision(save(`fp-alloc-${String(index).padStart(4, "0")}`, TASK_ALLOC, threeSteps(`Plan ${index}`)))));
  assert.ok(results.every((result) => result.status === "created"), JSON.stringify(results.map((result) => result.status)));
  const numbers = results.map((result) => (result.status === "created" ? result.revision.revision : 0)).sort((left, right) => left - right);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal((await db.admin.query("select count(distinct plan_key)::int as n from project_task_feature_plans where workspace_id = $1 and task_key = $2", [A.id, TASK_ALLOC])).rows[0].n, 1);
  assert.equal(await audits(), auditsBefore + 8, "exactly one audit per revision");
});

test("fail closed: non-draft task, paused / archived project, unknown / foreign task, non-Owner, no session — nothing is written", async () => {
  const before = await totals();
  const cases: [string, unknown, unknown][] = [
    ["ready task", owner, save("fp-deny-0001", "task-ready")],
    ["completed task", owner, save("fp-deny-0002", "task-done")],
    ["paused project", owner, save("fp-deny-0003", "task-paused")],
  ];
  for (const [label, who, input] of cases) assert.deepEqual(await (who as typeof owner).saveDraftRevision(input), { status: "not_plannable" }, label);
  for (const [label, who, input] of [
    ["archived project (not discoverable)", owner, save("fp-deny-0004", "task-arch")],
    ["unknown task", owner, save("fp-deny-0005", "task-nope")],
    ["another workspace's task id", owner, save("fp-deny-0006", "task-foreign")],
    ["Owner of B targeting A's task", planner("6103", B.domain), save("fp-deny-0007", TASK)],
    ["member without the Owner role", planner("6102"), save("fp-deny-0008", TASK)],
  ] as const) {
    assert.deepEqual(await (who as typeof owner).saveDraftRevision(input), { status: "unavailable" }, label);
  }
  assert.deepEqual(await planner(null).saveDraftRevision(save("fp-deny-0009", TASK)), { status: "unauthenticated" });
  assert.deepEqual(await totals(), before);
});

test("invalid FeaturePlan (cycle, self / missing dependency, empty lists, smuggled status) → no write", async () => {
  const before = await totals();
  const bad = [
    { title: "P", goal: "G", tasks: [step("step-1", 1, { dependencyIds: ["step-2"] }), step("step-2", 2, { dependencyIds: ["step-1"] })] },
    { title: "P", goal: "G", tasks: [step("step-1", 1, { dependencyIds: ["step-1"] })] },
    { title: "P", goal: "G", tasks: [step("step-1", 1, { dependencyIds: ["step-7"] })] },
    { title: "P", goal: "G", tasks: [step("step-1", 1, { allowedPaths: [] })] },
  ];
  for (const plan of bad) {
    const result = await owner.saveDraftRevision(save("fp-invalid-0001", TASK, plan));
    assert.equal(result.status, "invalid_plan", JSON.stringify(result));
  }
  assert.deepEqual(await owner.saveDraftRevision(save("fp-invalid-0002", TASK, { ...threeSteps(), status: "approved" })), { status: "invalid_plan", errors: [{ code: "invalid_input", field: "plan", step: null }] });
  assert.deepEqual(await owner.saveDraftRevision({ idempotencyKey: "short", taskId: TASK, plan: threeSteps() }), { status: "invalid_input" });
  assert.deepEqual(await owner.saveDraftRevision({ ...save("fp-invalid-0003", TASK), workspaceId: B.id }), { status: "invalid_input" });
  assert.deepEqual(await totals(), before);
});

test("DB constraints block direct cross-tenant / cross-project / lineage / audit corruption", async () => {
  const row = (await db.admin.query("select plan_key from project_task_feature_plans where workspace_id = $1 and task_key = $2 limit 1", [A.id, TASK])).rows[0];
  const json = (key: string) => JSON.stringify({ id: key, title: "x", goal: "y", status: "draft", tasks: [] });
  const insert = (workspace: string, project: string, taskKey: string, planKey: string, rev: number, key: string) => attempt(
    `insert into project_task_feature_plans (workspace_id, project_key, task_key, plan_key, revision, plan_json, plan_fingerprint, creation_idempotency_key, creation_intent_fingerprint)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $7)`, [workspace, project, taskKey, planKey, rev, json(planKey), "a".repeat(64), key]);
  assert.equal(await insert(B.id, "project-a", TASK, row.plan_key, 9, "direct-0001"), "23503", "A's task under workspace B");
  assert.equal(await insert(A.id, "project-b", TASK, row.plan_key, 9, "direct-0002"), "23503", "task under another project");
  assert.equal(await insert(A.id, "project-a", TASK, "plan-ffffffffffffffffffff", 9, "direct-0003"), "23503", "second plan lineage for one task");
  assert.equal(await insert(A.id, "project-a", TASK, row.plan_key, 1, "direct-0004"), "23505", "duplicate revision");
  assert.equal(await insert(A.id, "project-a", TASK, row.plan_key, 9, "fp-main-0001"), "23505", "duplicate idempotency key");
  assert.equal(await attempt(`insert into project_task_feature_plans (workspace_id, project_key, task_key, plan_key, revision, plan_json, plan_fingerprint, creation_idempotency_key, creation_intent_fingerprint)
     values ($1, 'project-a', $2, $3, 9, $4::jsonb, $5, 'direct-0005', $5)`, [A.id, TASK, row.plan_key, json("plan-other"), "a".repeat(64)]), "23514", "plan_json id must be the plan key");
  const entity = (await db.admin.query("select entity_id from audit_events where workspace_id = $1 and event_type = 'task.feature_plan_revision_created' limit 1", [A.id])).rows[0].entity_id;
  assert.equal(await attempt("insert into audit_events (workspace_id, event_type, entity_type, entity_id) values ($1, 'task.feature_plan_revision_created', 'project_task_feature_plan', $2)", [A.id, entity]), "23505", "audit exactly once per revision");
});

test("read: the real authenticated chain returns validated revisions with no internal fields; Owner Console loader states", async () => {
  const backend = await backendFor("6101");
  const result = await backend.getTaskFeaturePlans(TASK);
  assert.equal(result.status, "available", JSON.stringify(result));
  const data = result.data!;
  assert.deepEqual([data.taskId, data.projectId, data.revisionCount, data.latest?.revision, data.history.map((item) => item.revision), data.historyTruncated],
    [TASK, "project-a", 3, 3, [3, 2, 1], false]);
  assert.equal(data.latest?.plan.title, "Plan v3");
  assert.equal(data.latest?.plan.status, "draft");
  const json = JSON.stringify(result);
  for (const leak of ["fp-main", "creation", "intent", OWNER, A.id, "created_by", "workspace"]) assert.equal(json.includes(leak), false, `leaked ${leak}`);
  // Without plans: an honest empty state; foreign / unknown / non-Owner: opaque unavailable.
  assert.deepEqual((await backend.getTaskFeaturePlans(TASK_B)).data, { taskId: TASK_B, projectId: "project-b", revisionCount: 0, latest: null, history: [], historyTruncated: false });
  for (const target of ["task-foreign", "task-nope", "task-arch"]) assert.equal((await backend.getTaskFeaturePlans(target)).status, "unavailable", target);
  const memberDecision = await composed.createGitHubOwnerReadRuntime({ database, domainWorkspaceId: A.domain, sessionResolver: { resolve: () => session("6102") } });
  assert.notEqual(memberDecision.verdict, "allow", "a non-Owner gets no backend at all");
  // Owner Console loader.
  const reader = readerFor("6101");
  const view = await reader.loadOwnerTaskDevelopment(TASK, context.parseProjectSelector("project-a"));
  assert.ok(view.state === "available" && view.development.state === "available" && view.development.creationBlock === null && view.development.plans.state === "available");
  const ready = await reader.loadOwnerTaskDevelopment("task-ready", context.parseProjectSelector(undefined));
  assert.ok(ready.state === "available" && ready.development.state === "available" && ready.development.creationBlock === "task_not_draft");
  const paused = await reader.loadOwnerTaskDevelopment("task-paused", context.parseProjectSelector(undefined));
  assert.ok(paused.state === "available" && paused.development.state === "available" && paused.development.creationBlock === "project_not_active");
  const wrongProject = await reader.loadOwnerTaskDevelopment(TASK, context.parseProjectSelector("project-b"));
  assert.ok(wrongProject.state === "available" && wrongProject.development.state === "unavailable", "a selected project never authorizes another project's task");
});

test("history is bounded: 21 revisions → newest 20 shown, factual total, truncated", async () => {
  for (let index = 1; index <= 21; index += 1) {
    const result = await owner.saveDraftRevision(save(`fp-hist-${String(index).padStart(4, "0")}`, TASK_HISTORY, threeSteps(`History ${index}`)));
    assert.equal(result.status, "created");
  }
  const data = (await (await backendFor("6101")).getTaskFeaturePlans(TASK_HISTORY)).data!;
  assert.deepEqual([data.revisionCount, data.history.length, data.history[0].revision, data.history.at(-1)!.revision, data.historyTruncated, data.latest?.plan.title],
    [21, 20, 21, 2, true, "History 21"]);
});

test("corrupted persisted plans fail the read closed — never repaired, never partial; no new revision is offered", async () => {
  assert.equal((await owner.saveDraftRevision(save("fp-corrupt-0001", TASK_CORRUPT))).status, "created");
  assert.equal((await owner.saveDraftRevision(save("fp-corrupt-0002", TASK_CORRUPT, threeSteps("Corrupt v2")))).status, "created");
  const pristine = (await db.admin.query("select plan_json, plan_fingerprint from project_task_feature_plans where workspace_id = $1 and task_key = $2 and revision = 2", [A.id, TASK_CORRUPT])).rows[0];
  const tamper = async (sql: string, values: unknown[]) => {
    // Superuser maintenance bypass of the immutability trigger (simulates storage corruption).
    await db.admin.query("set session_replication_role = replica");
    try { await db.admin.query(sql, values); } finally { await db.admin.query("set session_replication_role = origin"); }
  };
  const corruptions: [string, unknown[]][] = [
    ["update project_task_feature_plans set plan_json = jsonb_set(plan_json, '{title}', '\"Tampered\"') where workspace_id = $1 and task_key = $2 and revision = 2", [A.id, TASK_CORRUPT]],
    ["update project_task_feature_plans set plan_json = jsonb_set(plan_json, '{tasks,0,dependencyIds}', '[\"step-3\"]') where workspace_id = $1 and task_key = $2 and revision = 2", [A.id, TASK_CORRUPT]],
    ["update project_task_feature_plans set plan_fingerprint = $3 where workspace_id = $1 and task_key = $2 and revision = 2", [A.id, TASK_CORRUPT, "0".repeat(64)]],
    ["update project_task_feature_plans set revision = 5 where workspace_id = $1 and task_key = $2 and revision = 2", [A.id, TASK_CORRUPT]],
  ];
  // Self-consistent but invalid: a dependency cycle whose fingerprint was recomputed to match, so only
  // re-validation with the canonical FeaturePlan contract can catch it.
  const cyclic = structuredClone(pristine.plan_json);
  cyclic.tasks[0].dependencyIds = ["step-3"];
  corruptions.push(["update project_task_feature_plans set plan_json = $3::jsonb, plan_fingerprint = $4 where workspace_id = $1 and task_key = $2 and revision = 2",
    [A.id, TASK_CORRUPT, JSON.stringify(cyclic), revision.featurePlanFingerprint(cyclic)]]);
  const backend = await backendFor("6101");
  const reader = readerFor("6101");
  for (const [sql, values] of corruptions) {
    await tamper(sql, values);
    const result = await backend.getTaskFeaturePlans(TASK_CORRUPT);
    assert.deepEqual(result, { verdict: "deny", status: "unavailable", data: null }, sql.slice(0, 80));
    const view = await reader.loadOwnerTaskDevelopment(TASK_CORRUPT, context.parseProjectSelector(undefined));
    assert.ok(view.state === "available" && view.development.state === "available" && view.development.plans.state === "unavailable"
      && view.development.creationBlock === "plans_unavailable", "task still readable; plans unavailable; no new revision offered");
    // Restore the pristine revision 2 for the next corruption.
    await tamper("update project_task_feature_plans set revision = 2, plan_json = $3::jsonb, plan_fingerprint = $4 where workspace_id = $1 and task_key = $2 and revision in (2, 5)",
      [A.id, TASK_CORRUPT, JSON.stringify(pristine.plan_json), pristine.plan_fingerprint]);
    assert.equal((await backend.getTaskFeaturePlans(TASK_CORRUPT)).status, "available", "restored");
  }
});

test("P-1: an AI candidate (fake planner, real authenticated chain) writes nothing; only the Owner's explicit save creates a revision", async () => {
  const before = await totals();
  const plannerOutput = {
    title: "Risk filter", goal: "Filter tasks by risk",
    steps: [step("step-1", 1, { allowedPaths: [] }), step("step-2", 2, { allowedPaths: [], dependencyIds: ["step-1"] })].map(({ sequence: _sequence, ...rest }) => rest),
  };
  let calls = 0;
  const drafting = draftBinding.createOwnerFeaturePlanDraft({
    loadDevelopment: (taskId) => readerFor("6101").loadOwnerTaskDevelopment(taskId, context.parseProjectSelector(undefined)),
    planner: { async complete() { calls += 1; return { status: "completed" as const, structuredOutput: plannerOutput }; } },
  });
  const form = new FormData();
  for (const [name, value] of [["taskId", TASK_AI], ["answer.outcome", "See only the chosen risk"], ["answer.surface", "unknown"], ["answer.mustNotChange", ""],
    ["answer.doneWhen", "The list changes"], ["answer.constraints", "none"]]) form.append(name, value);
  const outcome = await drafting.submit(form);
  assert.equal(outcome.status, "candidate", JSON.stringify(outcome));
  assert.equal(calls, 1);
  assert.deepEqual(await totals(), before, "generating a candidate writes no revision and no audit");
  if (outcome.status !== "candidate") return;
  // A non-Owner cannot draft at all (the same authenticated read gate).
  const memberDraft = draftBinding.createOwnerFeaturePlanDraft({
    loadDevelopment: (taskId) => readerFor("6102").loadOwnerTaskDevelopment(taskId, context.parseProjectSelector(undefined)),
    planner: { async complete() { calls += 1; return { status: "completed" as const, structuredOutput: plannerOutput }; } },
  });
  assert.notEqual((await memberDraft.submit(form)).status, "candidate");
  assert.equal(calls, 1, "no planning call without the Owner");
  // The candidate as-is (allowed paths pending technical clarification) cannot become a revision.
  const content = { title: outcome.candidate.title, goal: outcome.candidate.goal, tasks: outcome.candidate.steps };
  const refused = await owner.saveDraftRevision(save("fp-ai-0001", TASK_AI, content));
  assert.equal(refused.status, "invalid_plan");
  assert.ok(refused.status === "invalid_plan" && refused.errors.every((error) => error.field === "allowedPaths"), JSON.stringify(refused));
  assert.deepEqual(await totals(), before);
  // After review (paths clarified, one card changed) the Owner's explicit save creates revision 1.
  const reviewed = { ...content, tasks: content.tasks.map((item, index) => ({ ...item, allowedPaths: [`lib/feature-${index + 1}/`], title: index === 0 ? "Reviewed step" : item.title })) };
  const saved = await owner.saveDraftRevision(save("fp-ai-0002", TASK_AI, reviewed));
  assert.equal(saved.status, "created", JSON.stringify(saved));
  assert.deepEqual(await totals(), [before[0] + 1, before[1] + 1]);
});
