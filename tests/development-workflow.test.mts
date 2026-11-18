/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-039 Development Workflow Browser (pure / structural): ProjectTask → persisted draft FeaturePlan
// revisions. Fingerprints, canonical form, aggregate risk, verification plan, dependency waves (canonical
// contract only), the bounded Plan Builder form parser, hostile inputs, factual executor / repository
// states, and the real-vs-demo / no-external-action boundaries. Live PostgreSQL behavior (revisions,
// idempotency, races, tenancy, audit, corruption) is in tests/pg/feature-plan-revisions.test.mts.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const model = (await import(new URL("../lib/development/feature-plan-model.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-model");
const revision = (await import(new URL("../lib/development/feature-plan-revision.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-revision");
const form = (await import(new URL("../lib/development/feature-plan-form.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-form");
const contract = (await import(new URL("../lib/contracts/development-plan.ts", import.meta.url).href)) as typeof import("../lib/contracts/development-plan");
const save = (await import(new URL("../lib/composition/owner-feature-plan-save.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-feature-plan-save");
const consoleRead = (await import(new URL("../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-console-read");
const context = (await import(new URL("../lib/projects/project-context.ts", import.meta.url).href)) as typeof import("../lib/projects/project-context");

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(join(root, path), "utf8");
const code = (path: string) => source(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'])\/\/[^\n]*/gu, "$1");
function walk(directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    return statSync(path).isDirectory() ? walk(relative(root, path)) : [relative(root, path)];
  });
}

const PLAN_KEY = "plan-0123456789abcdef0123";
const step = (id: string, sequence: number, extra: Record<string, unknown> = {}) => ({
  id, sequence, title: `Step ${id}`, goal: `Goal of ${id}`, scope: [`scope ${id}`], nonGoals: [], allowedPaths: [`lib/${id}/`],
  acceptanceCriteria: [`works ${id}`], verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "low", priority: "P2",
  requiresOwnerApproval: false, ...extra,
});
const content = (tasks: unknown[], extra: Record<string, unknown> = {}) => ({ title: "Plan", goal: "Deliver", tasks, ...extra });
const threeSteps = () => content([
  step("step-1", 1, { verificationCommands: ["npm run lint", "npm test"] }),
  step("step-2", 2, { dependencyIds: ["step-1"], riskLevel: "high", requiresOwnerApproval: true, verificationCommands: ["npm test", "npm run typecheck"] }),
  step("step-3", 3, { dependencyIds: ["step-2", "step-1"], riskLevel: "medium", verificationCommands: ["git diff --check"] }),
]);
const normalized = (input: unknown, key = PLAN_KEY) => {
  const result = revision.normalizeDraftPlan(input, key);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.plan;
};

test("fingerprint: deterministic, over the canonical normalized plan; semantically equal plans fingerprint equally", () => {
  const plan = normalized(threeSteps());
  assert.match(revision.featurePlanFingerprint(plan), /^[0-9a-f]{64}$/u);
  assert.equal(revision.featurePlanFingerprint(plan), revision.featurePlanFingerprint(normalized(threeSteps())));
  // Whitespace, CRLF, blank and duplicate list items, task array order and dependency order normalize away.
  const noisy = threeSteps();
  noisy.title = "  Plan \r\n";
  (noisy.tasks as any[])[0].scope = ["  scope step-1 ", "", "scope step-1"];
  (noisy.tasks as any[])[2].dependencyIds = ["step-1", "step-2"];
  noisy.tasks = [...noisy.tasks].reverse();
  assert.equal(revision.featurePlanFingerprint(normalized(noisy)), revision.featurePlanFingerprint(plan));
  assert.deepEqual(model.canonicalFeaturePlan(normalized(noisy)), plan, "canonical form is idempotent");
  // Any semantic change changes the fingerprint; the plan id is part of the plan fingerprint …
  const changed = threeSteps();
  (changed.tasks as any[])[1].riskLevel = "critical";
  assert.notEqual(revision.featurePlanFingerprint(normalized(changed)), revision.featurePlanFingerprint(plan));
  assert.notEqual(revision.featurePlanFingerprint(normalized(threeSteps(), "plan-ffffffffffffffffffff")), revision.featurePlanFingerprint(plan));
  // … but not of the save intent (an exact replay matches before and after the server assigns the id).
  assert.equal(revision.saveIntentFingerprint("task-a", normalized(threeSteps(), "plan-ffffffffffffffffffff")), revision.saveIntentFingerprint("task-a", plan));
  assert.notEqual(revision.saveIntentFingerprint("task-b", plan), revision.saveIntentFingerprint("task-a", plan), "the intent is task-bound");
  // Keys are fixed-order: canonical JSON starts with the plan identity and status.
  assert.match(JSON.stringify(plan), /^\{"id":"plan-0123456789abcdef0123","title":"Plan","goal":"Deliver","status":"draft","tasks":\[\{"id":"step-1","sequence":1,/u);
  assert.match(revision.newPlanKey(), /^plan-[0-9a-f]{20}$/u);
  assert.notEqual(revision.newPlanKey(), revision.newPlanKey());
});

test("normalizeDraftPlan: the server forces id + draft; the canonical contract decides validity; errors are public codes only", () => {
  for (const status of ["approved", "in_progress", "completed"]) {
    const plan = normalized({ ...threeSteps() });
    assert.equal(plan.status, "draft");
    assert.equal(revision.normalizeDraftPlan({ ...threeSteps(), status }, PLAN_KEY).ok, false, "a status field from the caller is refused");
  }
  assert.equal(revision.normalizeDraftPlan(threeSteps(), "not-a-plan-key").ok, false);
  const cases: [unknown, string, string][] = [
    [content([step("step-1", 1, { dependencyIds: ["step-1"] })]), "self_dependency", "dependencyIds"],
    [content([step("step-1", 1, { dependencyIds: ["step-9"] })]), "missing_dependency", "dependencyIds"],
    [content([step("step-1", 1, { dependencyIds: ["step-2"] }), step("step-2", 2, { dependencyIds: ["step-1"] })]), "dependency_cycle", "dependencyIds"],
    [content([step("step-1", 1, { scope: [] })]), "required", "scope"],
    [content([step("step-1", 1, { verificationCommands: [] })]), "required", "verificationCommands"],
    [content([step("step-1", 1, { riskLevel: "extreme" })]), "invalid_risk_level", "riskLevel"],
    [content([step("step-1", 1), step("step-1", 2)]), "duplicate_task_id", "id"],
    [content([]), "required", "tasks"],
    [content([step("step-1", 1)], { title: "" }), "required", "planTitle"],
  ];
  for (const [input, code, field] of cases) {
    const result = revision.normalizeDraftPlan(input, PLAN_KEY);
    assert.equal(result.ok, false, `${code} must be refused`);
    if (result.ok) continue;
    assert.ok(result.errors.some((error) => error.code === code && error.field === field), `${code}/${field}: ${JSON.stringify(result.errors)}`);
    for (const error of result.errors) {
      assert.deepEqual(Object.keys(error).sort(), ["code", "field", "step"], "no message text, value or path leaves");
    }
  }
});

test("hostile plan content fails closed without running getters or proxies", () => {
  let trapped = 0;
  const getter = content([step("step-1", 1)]);
  Object.defineProperty(getter, "goal", { enumerable: true, get() { trapped += 1; return "x"; } });
  const proxy = new Proxy(content([step("step-1", 1)]), { get() { trapped += 1; return undefined; }, ownKeys() { trapped += 1; return []; } });
  const symbol = content([step("step-1", 1)]) as any;
  symbol[Symbol("x")] = 1;
  const deep: any = content([step("step-1", 1, { scope: [[[["nested"]]]] })]);
  const huge = content(Array.from({ length: 70 }, (_, index) => step(`step-${index + 1}`, index + 1)));
  const proto = content([step("step-1", 1)]);
  Object.setPrototypeOf(proto, { polluted: true });
  const sparse: any = content([step("step-1", 1)]);
  sparse.tasks = new Array(3);
  const inputs = [getter, proxy, symbol, deep, huge, proto, sparse, null, "plan", 42, [],
    content([step("step-1", 1, { sequence: Number.NaN })]), { ...threeSteps(), extra: true }, JSON.parse('{"title":"P","goal":"G","tasks":[],"__proto__":{"x":1}}')];
  // (The assertion message is the index only: serializing the input would itself run the getter / traps.)
  for (const [index, input] of inputs.entries()) assert.equal(revision.normalizeDraftPlan(input, PLAN_KEY).ok, false, `hostile input #${index}`);
  assert.equal(trapped, 0, "no getter or proxy trap ran");
});

test("aggregate risk = max canonical RiskLevel; counts per level (presentation projection only)", () => {
  const plan = normalized(threeSteps());
  assert.deepEqual({ ...model.aggregatePlanRisk(plan), counts: { ...model.aggregatePlanRisk(plan).counts } }, { max: "high", counts: { low: 1, medium: 1, high: 1, critical: 0 } });
  assert.equal(model.aggregatePlanRisk(normalized(content([step("step-1", 1)]))).max, "low");
  assert.equal(model.aggregatePlanRisk(normalized(content([step("step-1", 1), step("step-2", 2, { riskLevel: "critical" })]))).max, "critical");
});

test("verification plan: only the commands written in the plan, per step and unique in first-seen order", () => {
  const plan = normalized(threeSteps());
  const verification = model.verificationPlan(plan);
  assert.deepEqual([...verification.consolidated], ["npm run lint", "npm test", "npm run typecheck", "git diff --check"]);
  assert.deepEqual(verification.perTask.map((item) => [item.taskId, [...item.commands]]), [
    ["step-1", ["npm run lint", "npm test"]], ["step-2", ["npm test", "npm run typecheck"]], ["step-3", ["git diff --check"]],
  ]);
  assert.ok(!verification.consolidated.includes("npm run build"), "a command the Owner did not write is never added");
});

test("dependency waves come only from buildDevelopmentTaskWaves (no second graph algorithm)", () => {
  const plan = normalized(threeSteps());
  const waves = model.planDependencyWaves(plan);
  const canonical = contract.buildDevelopmentTaskWaves(plan);
  assert.ok(canonical.ok && waves);
  assert.deepEqual(waves!.map((wave) => wave.map((item) => item.id)), canonical.ok ? canonical.value.map((wave) => wave.map((item) => item.id)) : null);
  assert.deepEqual(waves!.map((wave) => wave.map((item) => item.id)), [["step-1"], ["step-2"], ["step-3"]]);
  const modelSource = code("lib/development/feature-plan-model.ts");
  assert.match(modelSource, /buildDevelopmentTaskWaves\(plan\)/u);
  assert.ok(!/while\s*\(|remaining|indegree|topolog/iu.test(modelSource), "no own graph traversal");
  for (const path of ["components/domain/owner-console/feature-plan-browser.tsx", "app/tasks/[taskId]/development/page.tsx"]) {
    assert.ok(!/buildDevelopmentTaskWaves|validateAndNormalizeFeaturePlan/u.test(code(path)), `${path} re-implements plan logic in the UI`);
  }
});

test("executor recommendation and repository changes are factual states — never a fabricated executor or diff", () => {
  assert.deepEqual({ ...model.executorRecommendation }, { status: "unavailable", executor: null, component: "ExecutorRouter", roadmapDependency: "AI-041.3" });
  assert.ok(Object.isFrozen(model.executorRecommendation));
  assert.deepEqual({ ...model.repositoryMutation }, { status: "not_started" });
  const workflowFiles = [...walk("lib/development"), "app/tasks/[taskId]/development/page.tsx", "app/tasks/[taskId]/development/actions.ts",
    "components/domain/owner-console/feature-plan-builder.tsx", "components/domain/owner-console/feature-plan-browser.tsx",
    "lib/composition/owner-feature-plan-save.ts", "lib/composition/owner-feature-plan-save.server.ts"];
  for (const path of workflowFiles) {
    const text = code(path);
    assert.ok(!/\b(codex|openai|claude|qwen|deepseek|ollama|anthropic)\b/iu.test(text), `${path} names an executor`);
    assert.ok(!/recommendedExecutor|selectedExecutor|executor\s*[:=]\s*["'][a-z]/iu.test(text), `${path} fabricates a recommendation`);
    assert.ok(!/git diff (?!--check)|diffStat|patch\b/iu.test(text.replace(/developmentHref|dispatch/gu, "")), `${path} shows a repository diff`);
  }
});

test("real vs demo: the Development Workflow imports no demo plan, mock data or prototype content", () => {
  const files = [...walk("lib/development"), ...walk("app/tasks/[taskId]/development"), "components/domain/owner-console/feature-plan-builder.tsx",
    "components/domain/owner-console/feature-plan-browser.tsx", "lib/composition/owner-feature-plan-save.ts", "lib/composition/owner-feature-plan-save.server.ts"];
  for (const path of files) {
    assert.ok(!/development-plan-demo|development-execution-demo|development-plan-simulator|mock-data|prototype-(pages|mock|content)|project-operations-demo/u.test(code(path)), `${path} imports demo data`);
  }
});

test("no external action: no provider, model, executor, runtime command, GitHub write, filesystem, process or attachRun", () => {
  const files = [...walk("lib/development"), ...walk("app/tasks/[taskId]/development"), "components/domain/owner-console/feature-plan-builder.tsx",
    "components/domain/owner-console/feature-plan-browser.tsx", "lib/composition/owner-feature-plan-save.ts", "lib/composition/owner-feature-plan-save.server.ts"];
  for (const path of files) {
    const text = code(path);
    assert.ok(!/lib\/providers|\.\.\/providers|workflow-runtime-service|agent-step-runtime|executeCommand|codex-task-artifact|child_process|node:fs|\bfetch\(|attachRun|createTask\(|octokit|api\.github\.com/u.test(text), `${path} reaches an external action`);
  }
  // The mutation contract writes exactly two tables and never updates or deletes anything (the
  // ProjectTask status is never changed by AI-039).
  const mutations = code("lib/development/feature-plan-mutations.ts");
  assert.deepEqual([...mutations.matchAll(/insert into (\w+)/gu)].map((match) => match[1]).sort(), ["audit_events", "project_task_feature_plans"]);
  assert.ok(!/\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|\btruncate\b/iu.test(mutations), "no update / delete");
  assert.match(mutations, /task\.feature_plan_revision_created/u);
  // The read SQL is read-only.
  assert.ok(!/\b(insert|update|delete|truncate)\b/iu.test(code("lib/development/postgres-feature-plan-read.ts")));
});

test("mutation transaction structure: Owner lock → task FOR UPDATE → project FOR SHARE → replay → allocate → insert → audit", () => {
  // Source (SQL statement tags live in comments inside the SQL strings).
  const text = source("lib/development/feature-plan-mutations.ts");
  const ordered = (body: string, markers: string[]) => {
    const order = markers.map((marker) => body.indexOf(marker));
    assert.ok(order.every((index) => index >= 0), `${markers.join(" → ")}: ${JSON.stringify(order)}`);
    assert.deepEqual([...order].sort((left, right) => left - right), order, `out of order: ${markers.join(" → ")}`);
  };
  const lockTask = text.slice(text.indexOf("async function lockTask("), text.indexOf("export function createOwnerFeaturePlanMutations("));
  ordered(lockTask, ["feature-plan-mutation:task-lock", "for update", "feature-plan-mutation:project-lock", "for share", "NotPlannable"]);
  const save = text.slice(text.indexOf("async function saveDraftRevision("));
  ordered(save, ["normalizeDraftPlan(plan, provisionalPlanKey)", "await authenticate()", "inTransaction(database", "lockOwnerAuthority(client",
    "lockTask(client", "await replay()", "feature-plan-mutation:lineage", "normalizeDraftPlan(plan, planKey)", "feature-plan-mutation:insert", "feature-plan-mutation:audit"]);
  assert.match(text, /if \(task\.rows\[0\]\.status !== "draft" \|\| project\.rows\[0\]\.status !== "active"\) throw new NotPlannable\(\);/u);
});

const formData = (entries: [string, string | Blob][]) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const stepEntries = (id: string, extra: Record<string, string> = {}): [string, string][] => Object.entries({
  title: `Title ${id}`, goal: `Goal ${id}`, scope: "a\r\n\n b ", nonGoals: "", allowedPaths: `lib/${id}/`, acceptanceCriteria: "ok",
  verificationCommands: "npm test", riskLevel: "low", priority: "P2", ...extra,
}).map(([field, value]) => [`step.${id}.${field}`, value]);
const validForm = (): [string, string | Blob][] => [
  ["$ACTION_ID_abc", ""], ["idempotencyKey", "fp-0123456789abcdef0123456789abcdef"], ["taskId", "task-abc"], ["planTitle", " Plan "], ["planGoal", "Goal"],
  ["steps", "step-2"], ["steps", "step-1"], ...stepEntries("step-1"), ...stepEntries("step-2"), ["step.step-2.dependsOn", "step-1"], ["step.step-2.requiresOwnerApproval", "yes"],
];

test("bounded form parser: exact field set, submitted step order, one-per-line lists, everything else fails closed", () => {
  const parsed = form.featurePlanInputFromForm(formData(validForm()));
  assert.ok(parsed);
  assert.equal(parsed!.plan.title, "Plan");
  assert.deepEqual(parsed!.plan.tasks.map((item) => [item.id, item.sequence, [...item.dependencyIds], item.requiresOwnerApproval]),
    [["step-2", 1, ["step-1"], true], ["step-1", 2, [], false]], "order of `steps` is the sequence; ids are kept");
  assert.deepEqual([...parsed!.plan.tasks[1].scope], ["a", "b"]);
  assert.deepEqual(Object.keys(parsed!).sort(), ["idempotencyKey", "plan", "taskId"], "no workspace / project / user / status / revision from the form");
  const refused: [string, [string, string | Blob][]][] = [
    ["unknown field", [...validForm(), ["workspaceId", "x"]]],
    ["status smuggling", [...validForm(), ["status", "approved"]]],
    ["plan id smuggling", [...validForm(), ["planId", "plan-0123456789abcdef0123"]]],
    ["repeated single", [...validForm(), ["taskId", "task-other"]]],
    ["missing single", validForm().filter(([name]) => name !== "planGoal")],
    ["file value", [...validForm().filter(([name]) => name !== "planTitle"), ["planTitle", new Blob(["x"])]]],
    ["bad step id", [...validForm(), ["steps", "step-0"]]],
    ["field for an unlisted step", [...validForm(), ...stepEntries("step-3")]],
    ["duplicate step", [...validForm(), ["steps", "step-1"]]],
    ["missing step field", validForm().filter(([name]) => name !== "step.step-1.goal")],
    ["unknown step field", [...validForm(), ["step.step-1.owner", "x"]]],
    ["approval value", [...validForm().filter(([name]) => name !== "step.step-2.requiresOwnerApproval"), ["step.step-2.requiresOwnerApproval", "true"]]],
    ["duplicate dependency", [...validForm(), ["step.step-2.dependsOn", "step-1"]]],
    ["oversize line", [...validForm().filter(([name]) => name !== "step.step-1.scope"), ["step.step-1.scope", "x".repeat(model.featurePlanBuilderLimits.maxListItemLength + 1)]]],
    ["too many lines", [...validForm().filter(([name]) => name !== "step.step-1.scope"), ["step.step-1.scope", Array.from({ length: model.featurePlanBuilderLimits.maxListItems + 1 }, (_, i) => `l${i}`).join("\n")]]],
    ["oversize goal", [...validForm().filter(([name]) => name !== "planGoal"), ["planGoal", "g".repeat(model.featurePlanBuilderLimits.maxPlanGoalLength + 1)]]],
    ["too many steps", [...validForm(), ...Array.from({ length: model.featurePlanBuilderLimits.maxSteps }, (_, i): [string, string] => ["steps", `step-${i + 3}`])]],
    ["entry flood", [...validForm(), ...Array.from({ length: 2000 }, (): [string, string] => ["step.step-1.dependsOn", "step-2"])]],
  ];
  for (const [label, entries] of refused) assert.equal(form.featurePlanInputFromForm(formData(entries)), null, label);
  for (const input of [null, {}, new Map(), "a=b", new Proxy(formData(validForm()), {})]) assert.equal(form.featurePlanInputFromForm(input), null);
});

test("save composition: only known public errors pass; redirects are built from validated ids; anything else is unavailable", () => {
  assert.deepEqual(save.featurePlanSaveOutcome({ status: "created", revision: { taskId: "task-abc", projectId: "project-a", planId: PLAN_KEY, revision: 2 } }),
    { status: "redirect", href: "/tasks/task-abc/development?project=project-a" });
  assert.deepEqual(save.featurePlanSaveOutcome({ status: "replayed", revision: { taskId: "task-abc", projectId: "project-a", planId: PLAN_KEY, revision: 1 } }).status, "redirect");
  assert.deepEqual(save.featurePlanSaveOutcome({ status: "created", revision: { taskId: "../evil", projectId: "project-a" } }), { status: "unavailable" });
  const errors = save.featurePlanSaveOutcome({ status: "invalid_plan", errors: [
    { code: "dependency_cycle", field: "dependencyIds", step: 1 },
    { code: "SENTINEL select * from", field: "dependencyIds", step: 1 },
    { code: "required", field: "workspaceId", step: null },
    { code: "required", field: "scope", step: -1 },
    { code: "required", field: "scope", step: 0, message: "SENTINEL" },
  ] });
  assert.deepEqual(errors, { status: "invalid_plan", errors: [{ code: "dependency_cycle", field: "dependencyIds", step: 1 }, { code: "required", field: "scope", step: 0 }] });
  for (const status of ["conflict", "not_plannable", "unauthenticated", "invalid_input"]) assert.deepEqual(save.featurePlanSaveOutcome({ status }), { status });
  for (const result of [{ status: "boom" }, null, "created", { status: "created" }]) assert.deepEqual(save.featurePlanSaveOutcome(result), { status: "unavailable" });
  assert.match(save.newFeaturePlanFormKey(), /^fp-[0-9a-f]{32}$/u);
  assert.equal(model.developmentHref("task-abc", null), "/tasks/task-abc/development");
  assert.equal(model.developmentHref("task-abc", "Bad Project"), "/tasks/task-abc/development", "an invalid project context is dropped, never interpolated");
});

test("plan creation rule: only a draft task of an active project with readable plans (narrow, fail closed)", () => {
  assert.equal(model.planCreationBlock("draft", "active", true), null);
  for (const status of ["ready", "planning", "approved", "running", "verifying", "waiting_owner", "blocked", "recovery_required", "completed", "failed", "cancelled"]) {
    assert.equal(model.planCreationBlock(status, "active", true), "task_not_draft", status);
  }
  for (const project of ["paused", "archived", null]) assert.equal(model.planCreationBlock("draft", project, true), "project_not_active");
  assert.equal(model.planCreationBlock("draft", "active", false), "plans_unavailable");
});

// Owner Console loader with a fake read backend (no database): targeting, opacity and plan states.
const taskRow = (taskId: string, projectId: string, status = "draft") => ({
  taskId, projectId, title: `Task ${taskId}`, goal: "Goal", type: "feature", status, priority: "P1", riskLevel: "medium",
  linkedRunCount: 0, latestRun: null, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", completedAt: null,
});
function reader(plans: Record<string, unknown>, tasks = [taskRow("task-a", "project-a"), taskRow("task-b", "project-b", "ready"), taskRow("task-p", "project-p")]) {
  const allow = (data: unknown) => ({ verdict: "allow", status: "available", data });
  const backend = {
    async listProjects() {
      return allow([{ projectId: "project-a", displayName: "A", status: "active", repository: null }, { projectId: "project-b", displayName: "B", status: "active", repository: null },
        { projectId: "project-p", displayName: "P", status: "paused", repository: null }]);
    },
    async getTask(taskId: unknown) {
      const found = tasks.find((item) => item.taskId === taskId);
      return found ? allow({ task: found, runs: [], runsTruncated: false }) : { verdict: "deny", status: "unavailable", data: null };
    },
    async getTaskFeaturePlans(taskId: unknown) {
      const value = plans[taskId as string];
      if (value === "throw") throw new Error("SENTINEL select");
      return value === undefined ? { verdict: "deny", status: "unavailable", data: null } : allow(value);
    },
  };
  return consoleRead.createOwnerConsoleReader({ workspaceSlug: "smart-algorithms-demo", withRuntime: async (_id, read) => read({ verdict: "allow", reason: null, backend } as never) });
}
const plansOf = (taskId: string, projectId: string) => {
  const plan = normalized(threeSteps());
  const summary = { planId: PLAN_KEY, revision: 2, createdAt: "2026-10-02T10:00:00.000Z", fingerprint: revision.featurePlanFingerprint(plan) };
  return { taskId, projectId, revisionCount: 2, latest: { ...summary, plan }, history: [summary, { ...summary, revision: 1 }], historyTruncated: false };
};

test("loader: task id is the only target; project selector never authorizes; plan states are factual and opaque on failure", async () => {
  const instance = reader({ "task-a": plansOf("task-a", "project-a"), "task-b": { taskId: "task-b", projectId: "project-b", revisionCount: 0, latest: null, history: [], historyTruncated: false },
    "task-p": "throw" });
  const a = await instance.loadOwnerTaskDevelopment("task-a", context.parseProjectSelector(undefined));
  assert.ok(a.state === "available" && a.development.state === "available");
  if (a.state !== "available" || a.development.state !== "available") return;
  assert.equal(a.development.creationBlock, null);
  assert.ok(a.development.plans.state === "available" && a.development.plans.data.latest?.revision === 2);
  // Another project's task under a selected project: the same opaque state as an unknown task.
  const foreign = await instance.loadOwnerTaskDevelopment("task-a", context.parseProjectSelector("project-b"));
  const unknown = await instance.loadOwnerTaskDevelopment("task-zzz", context.parseProjectSelector("project-b"));
  assert.ok(foreign.state === "available" && unknown.state === "available");
  if (foreign.state === "available" && unknown.state === "available") assert.deepEqual(foreign.development, unknown.development);
  // Non-draft task: readable, but no new revision.
  const b = await instance.loadOwnerTaskDevelopment("task-b", context.parseProjectSelector(undefined));
  assert.ok(b.state === "available" && b.development.state === "available" && b.development.creationBlock === "task_not_draft");
  // Unreadable plans: the task stays readable, plans are `unavailable` (never partial / demo), no new revision.
  const p = await instance.loadOwnerTaskDevelopment("task-p", context.parseProjectSelector(undefined));
  assert.ok(p.state === "available" && p.development.state === "available" && p.development.plans.state === "unavailable"
    && p.development.creationBlock === "plans_unavailable");
  assert.ok(!/SENTINEL/u.test(JSON.stringify(p)));
  // A projection for another task / project, or a latest plan that is not this revision, is refused.
  for (const bad of [plansOf("task-x", "project-a"), plansOf("task-a", "project-b"), { ...plansOf("task-a", "project-a"), revisionCount: 3 },
    { ...plansOf("task-a", "project-a"), latest: { ...plansOf("task-a", "project-a").latest, planId: "plan-ffffffffffffffffffff" } }]) {
    const view = await reader({ "task-a": bad }).loadOwnerTaskDevelopment("task-a", context.parseProjectSelector(undefined));
    assert.ok(view.state === "available" && view.development.state === "available" && view.development.plans.state === "unavailable", JSON.stringify(bad).slice(0, 60));
  }
});
