// AI-038.3 / AI-038.3.2 Owner Console read seam: real read wiring + trusted project context. No
// database, no network, no Auth.js: the authenticated Owner composition is replaced by deterministic
// decisions below the seam, with a recording fake OwnerReadBackend.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const consoleRead = (await import(new URL("../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-console-read");
const context = (await import(new URL("../lib/projects/project-context.ts", import.meta.url).href)) as typeof import("../lib/projects/project-context");

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(join(root, path), "utf8");
const code = (path: string) => source(path).replace(/\/\/[^\n]*/gu, "").replace(/\{\/\*[\s\S]*?\*\/\}/gu, "");

function walk(directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    return statSync(path).isDirectory() ? walk(relative(root, path)) : [relative(root, path)];
  });
}

const SENTINEL = {
  actor: "SENTINEL-ACTOR-00000000-0000-4000-8000-000000000101",
  fingerprint: "SENTINEL-FINGERPRINT-abcdef",
  deployment: "SENTINEL-DEPLOYMENT",
  requestModel: "SENTINEL-REQUEST-MODEL",
  error: "SENTINEL-SQL select * from users where password",
};

const WORKSPACE = { slug: "smart-algorithms-demo", displayName: "Smart Algorithms Demo" };
const allSel = context.parseProjectSelector(undefined);
const sel = (value: unknown) => context.parseProjectSelector(value);

const project = (projectId: string, status = "active") => ({ projectId, displayName: `Name ${projectId}`, status, repository: null });
const approval = (runId: string, risk: string, n: number) => ({
  approvalRequestId: `risk-approval-${n}`, runId, stepId: "step-one", status: "pending", riskLevel: risk,
  requestedCapability: "reasoning", requestedAt: "2026-10-01T10:00:00.000Z", resolvedAt: null,
  requestedByActorId: SENTINEL.actor, resolvedByActorId: SENTINEL.actor,
});
const listedRun = (runId: string, projectId: string, minute: number, status = "running") => ({
  runId, projectId, workflowId: "workflow-one", status, revision: 1,
  createdAt: `2026-10-01T10:${String(minute).padStart(2, "0")}:00.000Z`, startedAt: null, completedAt: null,
});
const overview = (runId: string, projectId: string) => ({
  runId, projectId, workflowId: "workflow-one", status: "running", revision: 1,
  createdAt: "2026-10-01T09:00:00.000Z", startedAt: "2026-10-01T09:00:01.000Z", completedAt: null,
  currentStepIds: ["step-one"], readyStepIds: [], approval: approval(runId, "high", 0),
  latestModelInvocation: {
    invocationId: "invocation-a", stepId: "step-one", attemptNumber: 1, status: "succeeded", providerId: "mock",
    deploymentId: SENTINEL.deployment, providerModelId: "mock/model", providerRequestModelId: SENTINEL.requestModel,
    providerModelVersion: "v1", providerIdentityVersion: 2, requestFingerprint: SENTINEL.fingerprint,
    createdAt: "2026-10-01T09:00:02.000Z", completedAt: "2026-10-01T09:00:03.000Z",
  },
  modelUsage: {
    invocationCount: 1, succeededCount: 1, failedCount: 0, ambiguousCount: 0, inputTokens: 7, outputTokens: 4,
    totalTokens: 11, totalCostUsdMicros: 1234, lastProviderId: "mock", lastProviderModelId: "mock/model",
    lastProviderRequestModelId: SENTINEL.requestModel, lastProviderModelVersion: "v1",
  },
});

const allow = <T,>(data: T) => ({ verdict: "allow", status: "available", data });
const unavailable = { verdict: "deny", status: "unavailable", data: null };

const task = (taskId: string, projectId: string, status: string, extra: Record<string, unknown> = {}) => ({
  taskId, projectId, title: `Task ${taskId}`, goal: null, type: "feature", status, priority: null, riskLevel: null,
  linkedRunCount: 0, latestRun: null, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z",
  completedAt: status === "completed" ? "2026-10-01T09:30:00.000Z" : null, ...extra,
});
const viewStatuses: Record<string, string[] | null> = {
  all: null,
  current: ["ready", "planning", "approved", "running", "verifying", "waiting_owner", "blocked", "recovery_required", "failed"],
  attention: ["waiting_owner", "blocked", "recovery_required", "failed"],
  completed: ["completed"],
};

type World = {
  tasks?: Record<string, unknown>[];
  taskDetails?: Record<string, unknown>;
  projects?: unknown[];
  // runId → factual project (for getRunOverview) ; per-project run lists (for listRuns)
  runProjects?: Record<string, string>;
  projectRuns?: Record<string, unknown[] | "deny" | "throw">;
  approvals?: unknown[];
  failOverview?: Set<string>;
};

function fakeBackend(world: World = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const projects = world.projects ?? [project("project-a"), project("project-b"), project("project-paused", "paused")];
  const runProjects = world.runProjects ?? { "run-a1": "project-a", "run-a2": "project-a", "run-b1": "project-b" };
  const projectRuns = world.projectRuns ?? {
    "project-a": [listedRun("run-a2", "project-a", 2), listedRun("run-a1", "project-a", 1)],
    "project-b": [listedRun("run-b1", "project-b", 3, "blocked")],
    "project-paused": [],
  };
  const approvals = world.approvals ?? [approval("run-a1", "high", 1), approval("run-b1", "critical", 2), approval("run-x", "low", 3)];
  const tasks = world.tasks ?? [
    task("task-a-running", "project-a", "running", { linkedRunCount: 2, latestRun: { runId: "run-a2", status: "running", createdAt: "2026-10-01T10:02:00.000Z", completedAt: null } }),
    task("task-a-waiting", "project-a", "waiting_owner"),
    task("task-a-done", "project-a", "completed"),
    task("task-b-blocked", "project-b", "blocked"),
    task("task-a-draft", "project-a", "draft"),
  ];
  const tasksFor = (view: unknown, projectId: string | null) => {
    const statuses = viewStatuses[view as string];
    if (statuses === undefined) return unavailable;
    return allow(tasks.filter((item) => (projectId === null || item.projectId === projectId) && (statuses === null || statuses.includes(item.status as string))));
  };
  const record = (method: string, args: unknown[]) => calls.push({ method, args });
  const backend = {
    async listProjects(limit?: unknown) { record("listProjects", [limit]); return allow(projects); },
    async listRuns(projectId: unknown, limit?: unknown) {
      record("listRuns", [projectId, limit]);
      const runs = projectRuns[projectId as string];
      if (runs === "throw") throw new Error(SENTINEL.error);
      return runs === undefined || runs === "deny" ? unavailable : allow(runs);
    },
    async listApprovalQueue(limit?: unknown) { record("listApprovalQueue", [limit]); return allow(approvals); },
    async listTasks(view: unknown) { record("listTasks", [view]); return tasksFor(view, null); },
    async listProjectTasks(projectId: unknown, view: unknown) { record("listProjectTasks", [projectId, view]); return tasksFor(view, projectId as string); },
    async getTask(taskId: unknown) {
      record("getTask", [taskId]);
      const detail = world.taskDetails?.[taskId as string];
      if (detail) return allow(detail);
      const found = tasks.find((item) => item.taskId === taskId);
      return found ? allow({ task: found, runs: [], runsTruncated: false }) : unavailable;
    },
    async getRunOverview(runId: unknown) {
      record("getRunOverview", [runId]);
      if (world.failOverview?.has(runId as string)) throw new Error(SENTINEL.error);
      const owner = runProjects[runId as string];
      return owner ? allow(overview(runId as string, owner)) : unavailable;
    },
    async getRunAuditTimeline(runId: unknown, limit?: unknown) {
      record("getRunAuditTimeline", [runId, limit]);
      return runProjects[runId as string]
        ? allow([{ eventType: "run_started", actorKind: "owner", actorId: SENTINEL.actor, runId, createdAt: "2026-10-01T09:00:01.000Z" }])
        : unavailable;
    },
    async getRunModelUsage(runId: unknown) {
      record("getRunModelUsage", [runId]);
      const owner = runProjects[runId as string];
      return owner ? allow(overview(runId as string, owner).modelUsage) : unavailable;
    },
  };
  return { backend, calls };
}

function reader(decision: unknown, ...slugArgument: [unknown?]) {
  const slug = slugArgument.length > 0 ? slugArgument[0] : WORKSPACE.slug;
  const seen: string[] = [];
  const instance = consoleRead.createOwnerConsoleReader({
    workspaceSlug: slug,
    async withRuntime(domainWorkspaceId, read) {
      seen.push(domainWorkspaceId);
      return read(decision as never);
    },
  });
  return { instance, seen };
}

function owner(world: World = {}) {
  const fake = fakeBackend(world);
  const { instance, seen } = reader({ verdict: "allow", reason: null, backend: fake.backend });
  return { instance, seen, calls: fake.calls };
}

const forbiddenKeys = ["database", "session", "cookie", "jwt", "token", "providerSubject", "userId", "actorId",
  "requestedByActorId", "resolvedByActorId", "requestFingerprint", "deploymentId", "providerRequestModelId",
  "lastProviderRequestModelId", "workspaceId", "workspaceDatabaseId", "tenant", "backend", "error", "stack", "runtimeSnapshot"];

function assertSanitized(value: unknown) {
  const json = JSON.stringify(value);
  for (const sentinel of Object.values(SENTINEL)) assert.ok(!json.includes(sentinel), `leaked ${sentinel}`);
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        assert.ok(!forbiddenKeys.includes(key), `forbidden key ${key}`);
        visit(child);
      }
    }
  };
  visit(value);
}

const ownerPages = ["app/dashboard/page.tsx", "app/projects/page.tsx", "app/runs/page.tsx", "app/runs/[runId]/page.tsx", "app/approvals/page.tsx",
  "app/tasks/page.tsx", "app/tasks/[taskId]/page.tsx", "app/attention/page.tsx"];

// ---------------------------------------------------------------------------------------------
// AI-038.3 invariants (kept)
// ---------------------------------------------------------------------------------------------

test("038.3-1. the Owner Console loader is server-only and never imported by client code", () => {
  const server = source("lib/composition/owner-console-read.server.ts");
  assert.match(server, /^(\/\/[^\n]*\n)*import "server-only";/u, "server-only must be the first import");
  assert.ok(!/["']use server["']/u.test(server), "no Server Action module");
  const clientFiles = [...walk("app"), ...walk("components")].filter((path) => /\.(tsx?|mts)$/u.test(path))
    .filter((path) => /^\s*["']use client["']/mu.test(source(path)));
  assert.ok(clientFiles.length >= 2, "sidebar + project switcher are client components");
  for (const path of clientFiles) {
    assert.ok(!/owner-console-read|github-owner-read-runtime|next-auth|lib\/db\/|lib\/auth\//u.test(source(path)), `${path} imports server data access`);
  }
});

test("038.3-2 / 3.2-8. only the trusted workspace configuration reaches the composition; the browser cannot select it", async () => {
  const { instance, seen } = owner();
  await instance.loadOwnerShell();
  await instance.loadOwnerDashboard(allSel);
  await instance.loadOwnerDashboard(sel("project-a"));
  await instance.loadOwnerRun("run-a1", sel("project-a"));
  await instance.loadOwnerRun({ runId: "run-a1", workspaceId: "other-tenant" } as unknown as string, allSel);
  assert.deepEqual([...new Set(seen)], [WORKSPACE.slug]);
  for (const slug of [undefined, "", "Bad Slug", "../x", { slug: WORKSPACE.slug }]) {
    const { instance: broken, seen: none } = reader({ verdict: "allow", reason: null, backend: {} }, slug);
    assert.deepEqual(await broken.loadOwnerDashboard(allSel), { state: "unavailable", workspace: null });
    assert.deepEqual(none, []);
  }
  const server = source("lib/composition/owner-console-read.server.ts");
  assert.match(server, /workspaceSlug: process\.env\.APP_DEMO_WORKSPACE_SLUG/u);
  for (const page of ownerPages) {
    const text = code(page);
    assert.ok(!/workspaceId|domainWorkspaceId|tenant|actorId|userId|cookies\(|headers\(|localStorage|sessionStorage|document\.cookie/u.test(text), `${page} reads caller authority`);
  }
});

test("038.3-3. projections never contain database, session, identity, actor, snapshot or raw error data", async () => {
  const { instance } = owner();
  for (const result of [
    await instance.loadOwnerShell(), await instance.loadOwnerProjects(),
    await instance.loadOwnerDashboard(allSel), await instance.loadOwnerDashboard(sel("project-a")),
    await instance.loadOwnerRuns(allSel), await instance.loadOwnerRuns(sel("project-b")),
    await instance.loadOwnerApprovals(allSel), await instance.loadOwnerApprovals(sel("project-a")),
    await instance.loadOwnerRun("run-a1", allSel),
  ]) assertSanitized(result);
  const failing = consoleRead.createOwnerConsoleReader({ workspaceSlug: WORKSPACE.slug, withRuntime: async () => { throw new Error(SENTINEL.error); } });
  const failed = await failing.loadOwnerDashboard(allSel);
  assert.deepEqual(failed, { state: "unavailable", workspace: WORKSPACE });
  assertSanitized(failed);
});

test("038.3-4. an unauthenticated session maps to the sign-in state for every load", async () => {
  const { instance } = reader({ verdict: "deny", reason: "unauthenticated", backend: null });
  for (const result of [await instance.loadOwnerShell(), await instance.loadOwnerProjects(), await instance.loadOwnerDashboard(sel("project-a")),
    await instance.loadOwnerRuns(allSel), await instance.loadOwnerApprovals(sel("bogus!")), await instance.loadOwnerRun("run-a1", allSel)]) {
    assert.deepEqual(result, { state: "unauthenticated", workspace: WORKSPACE });
  }
  const { instance: denied } = reader({ verdict: "deny", reason: "unavailable", backend: null });
  assert.deepEqual(await denied.loadOwnerRuns(sel("project-a")), { state: "unavailable", workspace: WORKSPACE });
});

test("038.3-5. every run denial in All Projects mode is the same opaque unavailable state", async () => {
  const { instance } = owner({ runProjects: { "run-a1": "project-a" }, failOverview: new Set(["broken"]) });
  const missing = await instance.loadOwnerRun("missing", allSel);
  assert.ok(missing.state === "available");
  assert.deepEqual(missing.run, { state: "unavailable" });
  for (const runId of ["broken", "UPPER", "../run", "x".repeat(65), ""]) {
    assert.deepEqual(await instance.loadOwnerRun(runId, allSel), missing, runId);
  }
});

test("038.3-6. Run Detail's only runtime target is the runId route parameter", async () => {
  const { instance, calls } = owner();
  await instance.loadOwnerRun("run-a1", allSel);
  assert.deepEqual(calls.map((call) => call.method), ["listProjects", "getRunOverview", "getRunAuditTimeline", "getRunModelUsage"]);
  for (const call of calls.slice(1)) assert.equal(call.args[0], "run-a1");
  const page = source("app/runs/[runId]/page.tsx");
  assert.match(page, /params: Promise<\{ runId: string \}>/u);
  assert.match(page, /loadOwnerRun\(runId, \(await searchParams\)\.project\)/u);
});

test("038.3-7 / 3.2-20. the loader exposes read functions only; no write path", () => {
  const { instance } = owner();
  const loaders = ["loadOwnerApprovals", "loadOwnerAttention", "loadOwnerDashboard", "loadOwnerProjects", "loadOwnerQuickCreate", "loadOwnerRun",
    "loadOwnerRuns", "loadOwnerShell", "loadOwnerTask", "loadOwnerTaskDevelopment", "loadOwnerTasks"];
  assert.deepEqual(Object.keys(instance).sort(), loaders);
  assert.ok(Object.isFrozen(instance));
  const server = source("lib/composition/owner-console-read.server.ts");
  assert.deepEqual([...server.matchAll(/export async function (\w+)/gu)].map((match) => match[1]).sort(), loaders);
  const writes = /\b(?:approve|reject|create(?!OwnerConsoleReader|WorkflowRuntimePostgresDatabase|RequestOwnerReadRuntime)|update|delete|execute|retry|publish|merge|mutate|insert)\w*\s*\(/iu;
  for (const path of ["lib/composition/owner-console-read.ts", "lib/composition/owner-console-read.server.ts", "lib/projects/project-context.ts"]) {
    assert.ok(!writes.test(code(path)), `${path} contains a write-shaped call`);
  }
});

test("038.3-8. approval and run views are read-only end to end", () => {
  for (const path of [...ownerPages, "components/domain/owner-console/approval-queue.tsx", "components/domain/owner-console/project-run-table.tsx",
    "components/domain/owner-console/task-table.tsx", "components/domain/owner-console/task-result.tsx"]) {
    assert.ok(!/<form|onClick|formAction|["']use server["']|<button/u.test(code(path)), `${path} must not offer decision controls`);
  }
});

test("038.3-9 / 3.2-17. rewritten Owner pages import no mock runtime data and fabricate no tasks", () => {
  for (const path of [...ownerPages, ...walk("components/domain/owner-console"), ...walk("components/shell"), "lib/composition/owner-console-read.ts"]) {
    const text = code(path);
    assert.ok(!/mock-data|-demo"|project-control-center|project-operations/u.test(text), `${path} imports demo data`);
    assert.ok(!/taskCount|fakeTask|mockTask|TaskCard/u.test(text), `${path} fabricates tasks`);
  }
});

test("038.3-10 / 3.2-18. the only HTTP API route is the Auth.js route", () => {
  assert.deepEqual(walk("app/api").sort(), ["app/api/auth/[...nextauth]/route.ts"]);
  assert.deepEqual(walk("app").filter((path) => /(^|\/)route\.(ts|tsx|js)$/u.test(path)), ["app/api/auth/[...nextauth]/route.ts"]);
});

// ---------------------------------------------------------------------------------------------
// AI-038.3.2 project context
// ---------------------------------------------------------------------------------------------

test("3.2-1. no project selector → All Projects", async () => {
  assert.deepEqual(sel(undefined), { kind: "all" });
  const { instance } = owner();
  const dashboard = await instance.loadOwnerDashboard(allSel);
  assert.ok(dashboard.state === "available" && dashboard.mode === "all");
  assert.deepEqual(dashboard.scope, { mode: "all" });
});

test("3.2-2. a registry-listed project establishes project scope", async () => {
  const { instance } = owner();
  const dashboard = await instance.loadOwnerDashboard(sel("project-a"));
  assert.ok(dashboard.state === "available" && dashboard.mode === "project");
  assert.deepEqual(dashboard.scope.project, { projectId: "project-a", displayName: "Name project-a", status: "active", repository: null });
});

test("3.2-3/4/5/6/7. unknown, foreign, malformed, archived and duplicate selectors are one opaque state and NEVER fall back to All Projects", async () => {
  const { instance, calls } = owner();
  const opaque = { state: "project_unavailable", workspace: WORKSPACE };
  // project-of-tenant-b: a valid id that the authenticated registry of THIS workspace does not return.
  for (const raw of ["project-unknown", "project-of-tenant-b", "Project-A", "../x", "", "x".repeat(65), ["project-a", "project-b"], ["project-a"], 7, null]) {
    for (const load of [instance.loadOwnerDashboard, instance.loadOwnerRuns, instance.loadOwnerApprovals]) {
      assert.deepEqual(await load(sel(raw)), opaque, JSON.stringify(raw));
    }
    assert.deepEqual(await instance.loadOwnerRun("run-a1", sel(raw)), opaque, JSON.stringify(raw));
  }
  // Archived: the backend never returns archived projects, so the selector is simply not listed.
  const archived = owner({ projects: [project("project-a")] });
  assert.deepEqual(await archived.instance.loadOwnerDashboard(sel("project-arch")), opaque);
  // An unaccepted selector never reaches a run/approval read.
  assert.ok(!calls.some((call) => call.method === "listRuns" || call.method === "listApprovalQueue" || call.method === "getRunOverview"));
  for (const raw of [["a", "b"], "", "BAD", {}]) assert.deepEqual(sel(raw), { kind: "invalid" });
});

test("3.2-9. generated project navigation carries only validated project ids and no identity", () => {
  assert.equal(context.projectScopedHref("/runs", "project-a"), "/runs?project=project-a");
  assert.equal(context.projectScopedHref("/dashboard", null), "/dashboard");
  for (const hostile of ["Project-A", "../x", "a b", "x&workspaceId=other", "a?b", ""]) {
    assert.equal(context.projectScopedHref("/approvals", hostile), "/approvals", hostile);
  }
  assert.equal(context.projectScopedHref("/settings" as never, "project-a"), "/dashboard");
  assert.equal(context.switchTargetPath("/runs/run-a1"), "/runs");
  assert.equal(context.switchTargetPath("/approvals"), "/approvals");
  assert.equal(context.switchTargetPath("/projects"), "/dashboard");
  for (const path of ["components/shell/project-switcher.tsx", "components/shell/sidebar.tsx", "lib/projects/project-context.ts", "lib/navigation.ts"]) {
    assert.ok(!/workspaceId|actorId|userId|role=|tenant/u.test(code(path)), `${path} builds identity into navigation`);
  }
});

test("3.2-10/11. the switcher receives only registry projects; All Projects is not a registry project; the bell stays workspace-global", async () => {
  const { instance } = owner();
  const shell = await instance.loadOwnerShell();
  assert.ok(shell.state === "available");
  assert.deepEqual(shell.projects.map((item) => item.projectId), ["project-a", "project-b", "project-paused"]);
  assert.equal(shell.projects.some((item) => /^all$/iu.test(item.projectId)), false);
  assert.equal(shell.pendingApprovals, 3, "bell stays workspace-global");
  const switcher = source("components/shell/project-switcher.tsx");
  assert.match(switcher, /^"use client";/u);
  assert.ok(!/import[^\n]*(owner-console-read|next-auth|lib\/db|lib\/auth)/u.test(switcher));
  assert.match(source("components/shell/topbar.tsx"), /projects=\{summary\.state === "available" \? summary\.projects\.map\(switcherProject\)/u);
  assert.equal(context.parseProjectSelector("all").kind, "candidate", "'all' is just an ordinary id that the registry would have to list");
});

test("3.2-12. selected-project runs contain no other project", async () => {
  const { instance, calls } = owner({ projectRuns: {
    "project-a": [listedRun("run-a2", "project-a", 2), listedRun("run-sneak", "project-b", 9)],
    "project-b": [], "project-paused": [],
  } });
  const runs = await instance.loadOwnerRuns(sel("project-a"));
  assert.ok(runs.state === "available" && runs.mode === "project");
  assert.deepEqual(runs.runs.map((run) => [run.runId, run.projectId]), [["run-a2", "project-a"]]);
  assert.deepEqual(calls.filter((call) => call.method === "listRuns").map((call) => call.args[0]), ["project-a"]);
});

test("3.2-13. All Projects runs keep factual project ids, are deterministic, bounded and report partial coverage", async () => {
  const projects = Array.from({ length: 14 }, (_, index) => project(`p${String(index).padStart(2, "0")}`));
  const projectRuns: NonNullable<World["projectRuns"]> = Object.fromEntries(projects.map((item, index) =>
    [item.projectId, Array.from({ length: 15 }, (_, run) => listedRun(`r${index}-${run}`, item.projectId, (index + run) % 60))]));
  projectRuns.p03 = "deny";
  projectRuns.p04 = "throw";
  const { instance, calls } = owner({ projects, projectRuns });
  const view = await instance.loadOwnerRuns(allSel);
  assert.ok(view.state === "available" && view.mode === "all");
  const aggregate = view.aggregate;
  assert.equal(aggregate.projectsConsidered, 12);
  assert.equal(aggregate.projectsNotConsidered, 2);
  assert.deepEqual(aggregate.projectsUnavailable, ["p03", "p04"], "partial coverage surfaced, never zero");
  assert.equal(aggregate.runs.length, 50);
  assert.ok(aggregate.runs.every((run) => run.runId.startsWith(`r${Number(run.projectId.slice(1))}-`)), "labelled with factual project");
  const sorted = [...aggregate.runs].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1));
  assert.deepEqual(aggregate.runs.map((run) => run.createdAt), sorted.map((run) => run.createdAt));
  const listCalls = calls.filter((call) => call.method === "listRuns");
  assert.equal(listCalls.length, 12, "bounded fan-out");
  assert.ok(listCalls.every((call) => call.args[1] === 15));
  assert.deepEqual(await instance.loadOwnerRuns(allSel), view, "deterministic");
});

test("3.2-14/15. project approvals are classified by the FACTUAL run project; unresolved approvals are never assigned", async () => {
  const world: World = {
    approvals: [approval("run-a1", "high", 1), approval("run-b1", "critical", 2), approval("run-x", "low", 3), approval("run-old-a", "medium", 4), approval("run-fail", "high", 5)],
    // run-a1 is in project-a's recent list; run-old-a is not, but its overview says project-a.
    runProjects: { "run-a1": "project-a", "run-b1": "project-b", "run-old-a": "project-a", "run-fail": "project-a" },
    projectRuns: { "project-a": [listedRun("run-a1", "project-a", 1)], "project-b": [listedRun("run-b1", "project-b", 2)], "project-paused": [] },
    failOverview: new Set(["run-fail"]),
  };
  const { instance, calls } = owner(world);
  const a = await instance.loadOwnerApprovals(sel("project-a"));
  assert.ok(a.state === "available" && a.mode === "project");
  assert.deepEqual(a.projectApprovals.approvals.map((item) => item.runId), ["run-a1", "run-old-a"]);
  assert.equal(a.projectApprovals.unresolvedApprovals, 2, "run-x (unknown) and run-fail (read failed) are unresolved");
  assert.equal(a.projectApprovals.highRiskApprovals, 1);
  const classifiedA = calls.filter((call) => call.method === "getRunOverview").map((call) => call.args[0] as string);
  assert.deepEqual(classifiedA.sort(), ["run-b1", "run-fail", "run-old-a", "run-x"], "the listed member is not re-read; each other run read once");
  const b = await instance.loadOwnerApprovals(sel("project-b"));
  assert.ok(b.state === "available" && b.mode === "project");
  assert.deepEqual(b.projectApprovals.approvals.map((item) => item.runId), ["run-b1"]);
  const all = await instance.loadOwnerApprovals(allSel);
  assert.ok(all.state === "available" && all.mode === "all");
  assert.equal(all.approvals.length, 5, "All Projects shows the whole workspace queue");
  // Classification never trusts the URL or the run id name.
  const decoy = owner({ approvals: [approval("project-a-looking-run", "high", 9)], runProjects: { "project-a-looking-run": "project-b" } });
  const decoyView = await decoy.instance.loadOwnerApprovals(sel("project-a"));
  assert.ok(decoyView.state === "available" && decoyView.mode === "project");
  assert.deepEqual(decoyView.projectApprovals.approvals, []);
});

test("3.2-14b. approval classification is bounded", async () => {
  const approvals = Array.from({ length: 100 }, (_, index) => approval(`run-${index}`, "low", index));
  const { instance, calls } = owner({ approvals, runProjects: {}, projectRuns: { "project-a": [], "project-b": [], "project-paused": [] } });
  const view = await instance.loadOwnerApprovals(sel("project-a"));
  assert.ok(view.state === "available" && view.mode === "project");
  assert.equal(calls.filter((call) => call.method === "getRunOverview").length, 40);
  assert.equal(view.projectApprovals.unresolvedApprovals, 100);
  assert.equal(view.projectApprovals.queueTruncated, true);
});

test("3.2-16. Run Detail under a mismatched selected project is opaque, never shown under that project", async () => {
  const { instance } = owner();
  const mismatch = await instance.loadOwnerRun("run-b1", sel("project-a"));
  const missing = await instance.loadOwnerRun("run-missing", sel("project-a"));
  assert.ok(mismatch.state === "available" && missing.state === "available");
  assert.deepEqual(mismatch.run, { state: "unavailable" });
  assert.deepEqual(mismatch, missing, "mismatch is indistinguishable from a missing run");
  const correct = await instance.loadOwnerRun("run-b1", sel("project-b"));
  assert.ok(correct.state === "available" && correct.run.state === "available");
  assert.equal(correct.run.detail.run.projectId, "project-b", "factual projectId, never rewritten from the URL");
  const unscoped = await instance.loadOwnerRun("run-b1", allSel);
  assert.ok(unscoped.state === "available" && unscoped.run.state === "available");
});

test("3.2-19. no cookie / storage authority for project selection", () => {
  for (const path of ["components/shell/project-switcher.tsx", "components/shell/sidebar.tsx", "components/shell/topbar.tsx", "components/shell/app-shell.tsx", "lib/projects/project-context.ts", ...ownerPages]) {
    assert.ok(!/localStorage|sessionStorage|document\.cookie|cookies\(|setCookie|useSearchParams/u.test(code(path)), `${path} uses browser state as authority`);
  }
});

test("3.2-26. empty registry and unavailable project runs are honest states", async () => {
  const empty = owner({ projects: [] });
  const dashboard = await empty.instance.loadOwnerDashboard(allSel);
  assert.ok(dashboard.state === "available" && dashboard.mode === "all");
  assert.deepEqual([dashboard.projects.length, dashboard.aggregate.runs.length, dashboard.aggregate.projectsConsidered], [0, 0, 0]);
  const failing = owner({ projectRuns: { "project-a": "deny", "project-b": [], "project-paused": [] } });
  assert.deepEqual(await failing.instance.loadOwnerRuns(sel("project-a")), { state: "unavailable", workspace: WORKSPACE }, "selected project runs unavailable is not an empty list");
});

// ---------------------------------------------------------------------------------------------
// AI-038.4a Tasks, Task Detail, Task Result, My Attention, Recently Completed (read-only)
// ---------------------------------------------------------------------------------------------

test("4a. /tasks: All Projects, project-scoped and invalid selector semantics", async () => {
  const { instance, calls } = owner();
  const all = await instance.loadOwnerTasks(allSel);
  assert.ok(all.state === "available" && all.mode === "all");
  assert.deepEqual(all.tasks.map((item) => item.taskId), ["task-a-running", "task-a-waiting", "task-a-done", "task-b-blocked", "task-a-draft"]);
  const a = await instance.loadOwnerTasks(sel("project-a"));
  assert.ok(a.state === "available" && a.mode === "project");
  assert.ok(a.tasks.every((item) => item.projectId === "project-a"));
  assert.deepEqual(calls.filter((call) => call.method.endsWith("Tasks")).map((call) => [call.method, ...call.args]),
    [["listTasks", "all"], ["listProjectTasks", "project-a", "all"]]);
  for (const raw of ["project-unknown", ["project-a", "project-b"], "BAD", ""]) {
    assert.deepEqual(await instance.loadOwnerTasks(sel(raw)), { state: "project_unavailable", workspace: WORKSPACE }, JSON.stringify(raw));
  }
  // A list returning a task of another project for a project scope fails closed (never mislabelled).
  const fake = fakeBackend({ tasks: [task("t1", "project-b", "running")] });
  fake.backend.listProjectTasks = async () => allow([task("t1", "project-b", "running")]) as never;
  const { instance: mislabelled } = reader({ verdict: "allow", reason: null, backend: fake.backend });
  assert.deepEqual(await mislabelled.loadOwnerTasks(sel("project-a")), { state: "unavailable", workspace: WORKSPACE });
});

test("4a. Task Detail: opaque unknown / project mismatch; factual result; zero and multiple runs", async () => {
  const multi = {
    task: task("task-multi", "project-a", "running", { linkedRunCount: 3, latestRun: { runId: "run-3", status: "review", createdAt: "2026-10-01T10:03:00.000Z", completedAt: null } }),
    runs: [listedRun("run-3", "project-a", 3, "review"), listedRun("run-2", "project-a", 2, "completed"), listedRun("run-1", "project-a", 1, "failed")],
    runsTruncated: false,
  };
  const { instance } = owner({ taskDetails: { "task-multi": multi } });
  const detail = await instance.loadOwnerTask("task-multi", allSel);
  assert.ok(detail.state === "available" && detail.task.state === "available");
  assert.deepEqual(detail.task.detail.runs.map((run) => [run.runId, run.status]), [["run-3", "review"], ["run-2", "completed"], ["run-1", "failed"]]);
  assert.deepEqual(detail.task.detail.result, {
    status: "running", completedAt: null, linkedRunCount: 3, latestRun: { runId: "run-3", status: "review", createdAt: "2026-10-01T10:03:00.000Z", completedAt: null },
    completedRuns: 1, failedOrBlockedRuns: 1, activeRuns: 1, runsTruncated: false,
  }, "a completed run does NOT make the task completed");
  const zero = await instance.loadOwnerTask("task-a-waiting", allSel);
  assert.ok(zero.state === "available" && zero.task.state === "available");
  assert.deepEqual([zero.task.detail.runs.length, zero.task.detail.result.linkedRunCount, zero.task.detail.result.latestRun], [0, 0, null]);
  const missing = await instance.loadOwnerTask("task-missing", sel("project-a"));
  const mismatch = await instance.loadOwnerTask("task-b-blocked", sel("project-a"));
  assert.ok(missing.state === "available");
  assert.deepEqual(missing.task, { state: "unavailable" });
  assert.deepEqual(mismatch, missing, "a project-b task is never rendered under project-a");
  for (const id of ["TASK", "../x", "", "x".repeat(65)]) assert.deepEqual(await instance.loadOwnerTask(id, allSel), { ...missing, scope: { mode: "all" } });
  // A detail whose runs belong to another project fails closed.
  const bad = owner({ taskDetails: { "task-x": { task: task("task-x", "project-a", "running"), runs: [listedRun("run-z", "project-b", 1)], runsTruncated: false } } });
  const badView = await bad.instance.loadOwnerTask("task-x", allSel);
  assert.ok(badView.state === "available");
  assert.deepEqual(badView.task, { state: "unavailable" });
  const page = code("app/tasks/[taskId]/page.tsx");
  assert.match(page, /params: Promise<\{ taskId: string \}>/u);
  // AI-038.6: the factual-only note is a translation key now; the invariant holds in BOTH locales.
  const result = code("components/domain/owner-console/task-result.tsx");
  assert.match(result, /\{t\.taskResult\.factualNote\}/u);
  const i18n = (await import(new URL("../lib/i18n/messages.ts", import.meta.url).href)) as typeof import("../lib/i18n/messages");
  assert.match(i18n.messages.en.taskResult.factualNote, /not available yet \(AI-039\)/u);
  assert.match(i18n.messages.ru.taskResult.factualNote, /пока недоступны \(AI-039\)/u);
  const claims = /implemented successfully|security passed|PR ready|changed \d+ files|успешно реализован|безопасность пройдена|PR готов/iu;
  assert.ok(!claims.test(result + page + JSON.stringify(i18n.messages.en.taskResult) + JSON.stringify(i18n.messages.ru.taskResult)));
});

test("4a. Dashboard current tasks and recently completed (global and project)", async () => {
  const { instance, calls } = owner();
  const all = await instance.loadOwnerDashboard(allSel);
  assert.ok(all.state === "available" && all.mode === "all");
  assert.deepEqual(all.tasks.current.tasks.map((item) => item.taskId), ["task-a-running", "task-a-waiting", "task-b-blocked"], "no draft, completed or cancelled");
  assert.deepEqual(all.tasks.recentlyCompleted.tasks.map((item) => item.taskId), ["task-a-done"]);
  assert.ok(all.tasks.recentlyCompleted.tasks.every((item) => item.status === "completed" && item.completedAt !== null));
  const a = await instance.loadOwnerDashboard(sel("project-b"));
  assert.ok(a.state === "available" && a.mode === "project");
  assert.deepEqual(a.tasks.current.tasks.map((item) => item.taskId), ["task-b-blocked"]);
  assert.deepEqual(a.tasks.recentlyCompleted.tasks, []);
  const taskCalls = calls.filter((call) => /Tasks$/u.test(call.method)).map((call) => call.args.at(-1));
  assert.deepEqual(taskCalls, ["current", "completed", "current", "completed"], "one bounded backend read per task section");
  // AI-038.6: section titles are translation keys; tasks and runs stay distinct in both locales.
  const dashboard = code("app/dashboard/page.tsx");
  assert.match(dashboard, /title=\{t\.dashboard\.currentTasks\}/u);
  assert.match(dashboard, /title=\{t\.dashboard\.recentlyCompleted\}/u);
  assert.match(dashboard, /title=\{d\.recentRuns\}/u);
  assert.match(dashboard, /title=\{d\.projectRuns\}/u, "runs stay labelled as runs");
  const i18n = (await import(new URL("../lib/i18n/messages.ts", import.meta.url).href)) as typeof import("../lib/i18n/messages");
  assert.deepEqual([i18n.messages.en.dashboard.currentTasks, i18n.messages.en.dashboard.recentlyCompleted, i18n.messages.en.dashboard.recentRuns],
    ["Current tasks", "Recently completed", "Recent runs"]);
  assert.deepEqual([i18n.messages.ru.dashboard.currentTasks, i18n.messages.ru.dashboard.recentlyCompleted, i18n.messages.ru.dashboard.recentRuns],
    ["Текущие задачи", "Недавно завершённые", "Недавние запуски"]);
});

test("4a. My Attention: attention statuses + pending approvals; project scope narrows both factually", async () => {
  const { instance, calls } = owner();
  const all = await instance.loadOwnerAttention(allSel);
  assert.ok(all.state === "available" && all.mode === "all");
  assert.deepEqual(all.attentionTasks.tasks.map((item) => [item.taskId, item.status]), [["task-a-waiting", "waiting_owner"], ["task-b-blocked", "blocked"]]);
  assert.equal(all.approvals.length, 3, "workspace queue");
  const a = await instance.loadOwnerAttention(sel("project-a"));
  assert.ok(a.state === "available" && a.mode === "project");
  assert.deepEqual(a.attentionTasks.tasks.map((item) => item.taskId), ["task-a-waiting"]);
  assert.deepEqual(a.projectApprovals.approvals.map((item) => item.runId), ["run-a1"], "AI-038.3.2 classification reused");
  assert.equal(a.projectApprovals.unresolvedApprovals, 1);
  assert.ok(calls.some((call) => call.method === "listRuns" && call.args[1] === 100), "classification path (listRuns membership) reused");
  assert.deepEqual(await instance.loadOwnerAttention(sel("project-zzz")), { state: "project_unavailable", workspace: WORKSPACE });
  const loader = code("lib/composition/owner-console-read.ts");
  assert.equal((loader.match(/async function classifyProjectApprovals/gu) ?? []).length, 1, "one approval classification algorithm");
});

test("4a/4b. navigation preserves Task / Attention scope; + New Task opens Quick Create; task writes only via the 4b binding", () => {
  for (const path of ["/tasks", "/attention"] as const) {
    assert.equal(context.projectScopedHref(path, "project-a"), `${path}?project=project-a`);
    assert.equal(context.projectScopedHref(path, "../x"), path);
  }
  assert.equal(context.switchTargetPath("/tasks/task-a-running"), "/tasks");
  assert.equal(context.switchTargetPath("/attention"), "/attention");
  const nav = source("lib/navigation.ts");
  assert.match(nav, /label: "My Attention", href: "\/attention", available: true, projectScoped: true/u);
  assert.match(nav, /label: "Tasks", href: "\/tasks", available: true, projectScoped: true/u);
  const topbar = source("components/shell/topbar.tsx");
  // AI-038.4b: + New Task is a plain link to the Quick Create page (no form or action in the shell).
  assert.match(topbar, /href=\{quickCreateHref\(selectedProject\?\.projectId \?\? null\)\}/u);
  assert.equal(context.quickCreateHref("project-a"), "/tasks/new?project=project-a");
  assert.equal(context.quickCreateHref("../x"), "/tasks/new");
  assert.equal(context.quickCreateHref(null), "/tasks/new");
  assert.ok(!/onClick|<form|formAction/u.test(code("components/shell/topbar.tsx")));
  const writes = /\b(?:createTask|updateTask|deleteTask|setTaskStatus|insertTask|linkRun)\w*\s*\(/u;
  // The ONLY task write is the AI-038.4a server-side mutation contract. AI-038.4b binds it in exactly
  // one server composition module (lib/composition/owner-task-create.ts); every page, component, read
  // backend and console loader stays unbound (see tests/owner-task-create.test.mts for the full graph).
  const mutationModule = "lib/tasks/owner-task-mutations.ts";
  const bindingModule = "lib/composition/owner-task-create.ts";
  for (const path of [...walk("lib/tasks").filter((file) => file !== mutationModule), "lib/composition/owner-console-read.ts", "lib/composition/owner-read-runtime.ts", ...ownerPages]) {
    assert.ok(!writes.test(code(path)), `${path} contains a task write`);
  }
  for (const path of [...walk("app"), ...walk("components"), ...walk("lib/composition").filter((file) => file !== bindingModule), ...walk("lib/tasks").filter((file) => file !== mutationModule)]) {
    assert.ok(!source(path).includes("owner-task-mutations"), `${path} binds the task mutation contract`);
  }
});

// ---------------------------------------------------------------------------------------------
// AI-038.4b Quick Create form data (a read; the write is tests/owner-task-create.test.mts)
// ---------------------------------------------------------------------------------------------

test("4b-J/K/H. Quick Create offers only ACTIVE projects; project context preselects; paused blocks; others opaque", async () => {
  const projects = [project("project-a"), project("project-b"), project("project-paused", "paused"), project("project-arch", "archived")];
  const { instance, calls } = owner({ projects });
  // K. All Projects: a selector of active projects only (paused / archived are never creatable targets).
  const all = await instance.loadOwnerQuickCreate(allSel);
  assert.equal(all.state, "available");
  assert.ok(all.state === "available");
  assert.equal(all.target, "choose");
  assert.deepEqual(all.scope, { mode: "all" });
  assert.deepEqual(all.creatableProjects.map((item) => item.projectId), ["project-a", "project-b"]);
  // J. Project context: the validated active project is preselected as the only target.
  const scoped = await instance.loadOwnerQuickCreate(sel("project-a"));
  assert.ok(scoped.state === "available");
  assert.equal(scoped.target, "project");
  assert.deepEqual(scoped.creatableProjects.map((item) => item.projectId), ["project-a"]);
  // H. Paused project: Quick Create is blocked (no creatable target).
  const paused = await instance.loadOwnerQuickCreate(sel("project-paused"));
  assert.ok(paused.state === "available");
  assert.equal(paused.target, "project_paused");
  assert.deepEqual(paused.creatableProjects, []);
  // I. Archived, unknown, malformed or duplicated selectors: the existing opaque state.
  const opaque = { state: "project_unavailable", workspace: WORKSPACE };
  for (const raw of ["project-arch", "project-zzz", "Project-A", ["project-a", "project-b"], ""]) {
    assert.deepEqual(await instance.loadOwnerQuickCreate(sel(raw)), opaque, JSON.stringify(raw));
  }
  // The form data is a registry read only: no run, approval or task read, nothing written.
  assert.deepEqual([...new Set(calls.map((call) => call.method))], ["listProjects"]);
  for (const view of [all, scoped, paused]) assertSanitized(view);
  // Unauthenticated / denied compositions keep the existing gate states.
  assert.deepEqual(await reader({ verdict: "deny", reason: "unauthenticated", backend: null }).instance.loadOwnerQuickCreate(allSel),
    { state: "unauthenticated", workspace: WORKSPACE });
  assert.deepEqual(await reader({ verdict: "deny", reason: "unavailable", backend: null }).instance.loadOwnerQuickCreate(allSel),
    { state: "unavailable", workspace: WORKSPACE });
});
