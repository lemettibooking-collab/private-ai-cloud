/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-039 P-1 / AI-039.1 Owner Planning Interview → AI-assisted UNSAVED candidate → Owner review. Pure
// and structural guards with a deterministic fake planning port (no provider, no network, no spend).
// The run-backed production port is proven against live PostgreSQL in tests/pg/feature-plan-planning.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const interview = (await import(new URL("../lib/development/planning-interview.ts", import.meta.url).href)) as typeof import("../lib/development/planning-interview");
const planner = (await import(new URL("../lib/development/feature-plan-planner.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-planner");
const draft = (await import(new URL("../lib/composition/owner-feature-plan-draft.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-feature-plan-draft");
const contract = (await import(new URL("../lib/contracts/development-plan.ts", import.meta.url).href)) as typeof import("../lib/contracts/development-plan");
const i18n = (await import(new URL("../lib/i18n/messages.ts", import.meta.url).href)) as typeof import("../lib/i18n/messages");
const projectTask = (await import(new URL("../lib/tasks/project-task.ts", import.meta.url).href)) as typeof import("../lib/tasks/project-task");

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(join(root, path), "utf8");
const code = (path: string) => source(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'])\/\/[^\n]*/gu, "$1");

const featureAnswers = { outcome: ["Владелец видит только задачи выбранного риска"], surface: ["unknown"], mustNotChange: [""], doneWhen: ["Список меняется при выборе"], constraints: ["none"] };
const step = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Step ${id}`, goal: `Goal ${id}`, scope: [`scope ${id}`], nonGoals: [], allowedPaths: [], acceptanceCriteria: [`ok ${id}`],
  verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "medium", priority: "P2", requiresOwnerApproval: false, ...extra,
});
const output = (steps: unknown[], extra: Record<string, unknown> = {}) => ({ title: "Risk filter", goal: "Filter tasks by risk", steps, ...extra });
const valid = () => output([step("step-1"), step("step-2", { dependencyIds: ["step-1"], riskLevel: "high", requiresOwnerApproval: true }), step("step-3", { dependencyIds: ["step-1", "step-2"] })]);
function fakeModel(result: unknown) {
  const calls: any[] = [];
  return { calls, model: { async complete(input: any) { calls.push(input); if (result instanceof Error) throw result; return result as any; } } };
}
const facts = { taskId: "task-abc", projectId: "project-a", type: "feature" as const, title: "Фильтр задач по уровню риска", goal: null, priority: "P1", riskLevel: "medium" };
const planningKey = `pl-${"a".repeat(32)}`;
const context = { taskId: "task-abc", projectId: "project-a", projectName: "Project A", idempotencyKey: planningKey };
const completed = (value: unknown) => ({ status: "completed", outputText: typeof value === "string" ? value : JSON.stringify(value) });

test("interview: product questions only, task-type aware, 3–7 each; 'not sure' is offered on every choice", () => {
  assert.deepEqual(Object.keys(interview.planningInterviews).sort(), [...projectTask.projectTaskTypes].sort());
  for (const [type, questions] of Object.entries(interview.planningInterviews)) {
    assert.ok(questions.length >= interview.interviewLimits.minQuestions && questions.length <= interview.interviewLimits.maxQuestions, type);
    for (const question of questions.filter((item) => item.kind === "choice")) assert.ok(question.options.includes("unknown"), `${type}.${question.id} offers "not sure"`);
  }
  assert.deepEqual(interview.planningInterviews.fix.map((item) => item.id).slice(0, 3), ["currentBehavior", "expectedBehavior", "occurrence"], "fix asks what happens now / should / when");
  assert.deepEqual(interview.planningInterviews.investigation.map((item) => item.id).slice(0, 2), ["question", "deliverable"]);
  assert.deepEqual(interview.planningInterviews.roadmap.map((item) => item.id).slice(0, 2), ["endGoal", "sequencing"]);
  // No question asks the Owner for technical planning inputs — ids, option tokens or texts, in both locales.
  const technical = /path|file|folder|director|command|npm|\bdepend|\bstep|allowed|verification|repositor|commit|branch|файл|папк|директор|команд|зависимост|\bпут[ьи]\b|репозитор|шаг/iu;
  const ids = Object.values(interview.planningInterviews).flatMap((questions) => questions.flatMap((item) => [item.id, ...item.options]));
  for (const id of ids) assert.ok(!technical.test(id), `technical question id ${id}`);
  for (const locale of ["ru", "en"] as const) {
    const planning = i18n.messages[locale].taskDevelopment.planning;
    for (const text of [...Object.values(planning.questions), ...Object.values(planning.options).flatMap((options) => Object.values(options))]) {
      assert.ok(!technical.test(text), `${locale}: technical wording in "${text}"`);
    }
    for (const question of new Set(ids.filter((id) => /^[a-z][A-Za-z]+$/u.test(id) && Object.hasOwn(planning.questions, id)))) assert.ok(planning.questions[question as keyof typeof planning.questions]);
  }
  assert.equal(i18n.messages.ru.taskDevelopment.planning.options.surface.unknown, "Не знаю");
});

test("interview answers: 'not sure' and empty optional answers are valid; anything else off-script fails closed", () => {
  const answers = interview.validateInterviewAnswers("feature", featureAnswers);
  assert.ok(answers);
  assert.deepEqual({ ...answers }, { outcome: "Владелец видит только задачи выбранного риска", surface: "unknown", mustNotChange: "", doneWhen: "Список меняется при выборе", constraints: ["none"] });
  for (const [label, raw] of [
    ["unknown question", { ...featureAnswers, allowedPaths: ["app/"] }],
    ["unknown option", { ...featureAnswers, surface: ["app/tasks"] }],
    ["missing required", { ...featureAnswers, outcome: [""] }],
    ["choice missing", { ...featureAnswers, surface: [] }],
    ["two choices", { ...featureAnswers, surface: ["unknown", "backend"] }],
    ["none + constraint", { ...featureAnswers, constraints: ["none", "security"] }],
    ["oversize", { ...featureAnswers, outcome: ["x".repeat(interview.interviewLimits.maxTextLength + 1)] }],
    ["control characters", { ...featureAnswers, outcome: ["a\u0000b"] }],
    ["another type's question", { ...featureAnswers, currentBehavior: ["x"] }],
  ] as const) {
    assert.equal(interview.validateInterviewAnswers("feature", raw as any), null, label);
  }
  assert.ok(interview.validateInterviewAnswers("fix", { currentBehavior: ["Crashes"], expectedBehavior: ["Works"], occurrence: ["unknown"], constraints: [] }));
});

test("planner: exactly one bounded invocation; the candidate is canonical, waves come from the contract, no paths invented", async () => {
  const fake = fakeModel(completed(valid()));
  const answers = interview.validateInterviewAnswers("feature", featureAnswers)!;
  const result = await planner.draftFeaturePlanCandidate({ task: facts, answers, context, model: fake.model });
  assert.equal(fake.calls.length, 1, "one planning operation, no follow-up turns");
  assert.equal(fake.calls[0].maxOutputTokens, planner.plannerLimits.maxOutputTokens);
  assert.deepEqual(fake.calls[0].context, context, "the port receives the request context (task, project, idempotency key)");
  assert.deepEqual(fake.calls[0].messages.map((message: any) => [message.role, message.toolCallId]), [["system", null], ["user", null]]);
  assert.match(fake.calls[0].messages[0].content, /NO access to the repository\. allowedPaths MUST be an empty array/u);
  const user = JSON.parse(fake.calls[0].messages[1].content);
  assert.deepEqual(Object.keys(user).sort(), ["interview", "task"]);
  assert.ok(!/pac_locale|"locale"|workspace|user/u.test(fake.calls[0].messages[1].content), "no locale / tenancy / identity in the prompt");
  assert.equal(result.status, "candidate");
  if (result.status !== "candidate") return;
  const candidate = result.candidate;
  assert.equal(candidate.pathsRequireTechnicalReview, true);
  assert.ok(candidate.steps.every((item) => item.allowedPaths.length === 0), "allowed paths stay empty (never the validation marker, never a guess)");
  assert.deepEqual(candidate.steps.map((item) => [item.id, item.sequence]), [["step-1", 1], ["step-2", 2], ["step-3", 3]]);
  assert.deepEqual(candidate.waves.map((wave) => [...wave]), [["step-1"], ["step-2"], ["step-3"]]);
  assert.ok(!JSON.stringify(candidate).includes("pending technical clarification"), "the in-memory validation marker never leaves");
  // Saving the candidate as-is is impossible: the canonical contract still requires real allowed paths.
  const asIs = contract.validateAndNormalizeFeaturePlan({ id: "plan-0123456789abcdef0123", title: candidate.title, goal: candidate.goal, status: "draft", tasks: candidate.steps });
  assert.equal(asIs.ok, false);
  assert.ok(!asIs.ok && asIs.errors.every((error) => error.code === "required" && /allowedPaths$/u.test(error.path)), "only the allowed paths are missing");
});

test("planner: untrusted output is rejected — never repaired — and model failures are honest", async () => {
  const answers = interview.validateInterviewAnswers("feature", featureAnswers)!;
  const draftWith = (model: unknown) => planner.draftFeaturePlanCandidate({ task: facts, answers, context, model: model as any });
  const cases: [unknown, string][] = [
    [output([step("step-1", { allowedPaths: ["app/tasks/page.tsx"] })]), "untrusted_repository_paths"],
    [output([step("step-1", { dependencyIds: ["step-2"] }), step("step-2", { dependencyIds: ["step-1"] })]), "invalid_dependency_graph"],
    [output([step("step-1", { dependencyIds: ["step-1"] })]), "invalid_dependency_graph"],
    [output([step("step-1", { dependencyIds: ["step-9"] })]), "invalid_dependency_graph"],
    [output([step("step-1", { riskLevel: "extreme" })]), "invalid_plan"],
    [output([step("step-1", { scope: [] })]), "invalid_plan"],
    [output([step("step-1", { verificationCommands: [] })]), "invalid_plan"],
    [output([step("step-1", { extra: true })]), "malformed_output"],
    [output([step("step-0")]), "malformed_output"],
    [output(Array.from({ length: planner.plannerLimits.maxSteps + 1 }, (_, index) => step(`step-${index + 1}`))), "malformed_output"],
    [output([]), "malformed_output"],
    [{ ...valid(), status: "approved" }, "malformed_output"],
    [JSON.stringify("{\"title\":\"x\"}"), "malformed_output"],
    ["null", "malformed_output"],
    // AI-039.1 strict text parse: exactly one JSON value, nothing around it, nothing repaired.
    [`\`\`\`json\n${JSON.stringify(valid())}\n\`\`\``, "malformed_output"],
    [`Here is the plan: ${JSON.stringify(valid())}`, "malformed_output"],
    [`${JSON.stringify(valid())} trailing`, "malformed_output"],
    [JSON.stringify(valid()).slice(0, -1), "malformed_output"],
    ["", "malformed_output"],
    [`${JSON.stringify(valid())}${" ".repeat(planner.plannerLimits.maxOutputTextLength)}`, "malformed_output"],
  ];
  for (const [value, reason] of cases) {
    const result = await draftWith(fakeModel(completed(value)).model);
    assert.deepEqual(result, { status: "rejected", reason }, String(typeof value === "string" ? value : JSON.stringify(value)).slice(0, 80));
  }
  // The parser itself never runs a Proxy trap.
  let trapped = 0;
  const proxy = new Proxy(valid(), { get() { trapped += 1; return undefined; }, ownKeys() { trapped += 1; return []; } });
  assert.deepEqual(planner.candidateFromModelOutput(proxy), { ok: false, reason: "malformed_output" });
  // A non-plain port result fails closed as recovery_required (it cannot prove nothing was spent).
  // (Promise resolution itself looks up `then` on any returned object; only our own reads are counted.)
  const proxyResult = new Proxy(completed(valid()), { get(_target, key) { if (key !== "then") trapped += 1; return undefined; } });
  assert.deepEqual(await draftWith({ async complete() { return proxyResult; } }), { status: "recovery_required" });
  assert.equal(trapped, 0, "no proxy trap runs");
  assert.deepEqual(await draftWith(null), { status: "unavailable" });
  for (const status of ["unavailable", "budget_denied", "provider_unavailable", "failed", "recovery_required", "conflict", "not_plannable", "unauthenticated"]) {
    assert.deepEqual(await draftWith(fakeModel({ status }).model), { status }, `${status} is reported as is`);
  }
  assert.deepEqual(await draftWith(fakeModel({ status: "approved" }).model), { status: "recovery_required" }, "an unknown port status is never success");
  // AI-039.1: an exception escaping the bound port cannot prove nothing was spent → recovery_required.
  assert.deepEqual(await draftWith(fakeModel(new Error("SENTINEL")).model), { status: "recovery_required" });
});

const development = (taskStatus = "draft", creationBlock: string | null = null) => ({
  state: "available", workspace: { slug: "w", displayName: "W" }, projects: [], projectsTruncated: false, scope: { mode: "all" },
  development: { state: "available", task: { taskId: "task-abc", projectId: "project-a", title: "Фильтр", goal: null, type: "feature", status: taskStatus, priority: "P1", riskLevel: "medium" },
    project: null, plans: { state: "available", data: {} }, creationBlock },
});
const interviewForm = (extra: [string, string][] = [], approval = true) => {
  const form = new FormData();
  for (const [name, value] of [["taskId", "task-abc"], ["idempotencyKey", planningKey], ["answer.outcome", "Видеть только выбранный риск"], ["answer.surface", "unknown"], ["answer.mustNotChange", ""],
    ["answer.doneWhen", "Список меняется"], ["answer.constraints", "none"], ...(approval ? [["egressApproval", "yes"]] : []), ...extra] as [string, string][]) form.append(name, value);
  return form;
};

test("draft composition: Owner + task checks first, then answers, then the Owner's egress approval, then ONE planning call", async () => {
  const run = async (view: unknown, model: unknown, form: FormData = interviewForm()) => {
    const fake = fakeModel(model);
    const instance = draft.createOwnerFeaturePlanDraft({ loadDevelopment: async () => view as any, planner: model === null ? null : fake.model });
    return { result: await instance.submit(form), calls: fake.calls.length };
  };
  const candidateModel = completed(valid());
  assert.deepEqual(await run({ state: "unauthenticated" }, candidateModel), { result: { status: "unauthenticated" }, calls: 0 });
  assert.deepEqual(await run({ state: "unavailable" }, candidateModel), { result: { status: "unavailable" }, calls: 0 });
  assert.deepEqual(await run(development("ready", "task_not_draft"), candidateModel), { result: { status: "not_plannable" }, calls: 0 });
  assert.deepEqual(await run(development(), candidateModel, interviewForm([["answer.allowedPaths", "app/"]])), { result: { status: "invalid_input" }, calls: 0 });
  assert.deepEqual(await run(development(), null), { result: { status: "planner_unavailable" }, calls: 0 });
  // AI-039.1: nothing is sent without the Owner's explicit approval of THIS request.
  assert.deepEqual(await run(development(), candidateModel, interviewForm([], false)), { result: { status: "egress_approval_required" }, calls: 0 });
  const ok = await run(development(), candidateModel);
  assert.equal(ok.result.status, "candidate");
  assert.equal(ok.calls, 1);
  assert.deepEqual(await run(development(), completed(output([step("step-1", { allowedPaths: ["lib/"] })]))), { result: { status: "candidate_rejected", reason: "untrusted_repository_paths" }, calls: 1 });
  // Port outcomes map to the public statuses (failed → planning_failed, unavailable → planner_unavailable).
  for (const [status, expected] of [["failed", "planning_failed"], ["unavailable", "planner_unavailable"], ["budget_denied", "budget_denied"], ["provider_unavailable", "provider_unavailable"],
    ["recovery_required", "recovery_required"], ["conflict", "conflict"], ["not_plannable", "not_plannable"], ["unauthenticated", "unauthenticated"]]) {
    assert.deepEqual(await run(development(), { status }), { result: { status: expected }, calls: 1 }, status);
  }
  // The port receives the server-side task / project and the form's idempotency key; nothing else.
  const captured = fakeModel(candidateModel);
  await draft.createOwnerFeaturePlanDraft({ loadDevelopment: async () => ({ ...development(), development: { ...development().development, project: { displayName: "Проект A" } } }) as any, planner: captured.model }).submit(interviewForm());
  assert.deepEqual(captured.calls[0].context, { taskId: "task-abc", projectId: "project-a", projectName: "Проект A", idempotencyKey: planningKey });
  // Bounded form parser.
  for (const entries of [[["taskId", "task-x"]], [["workspaceId", "w"]], [["answer.out-come", "x"]], [["answer.outcome", "x".repeat(2000)]],
    [["idempotencyKey", planningKey]], [["egressApproval", "yes"]], [["egressApproval", "true"]], [["planningKey", "fpp-0123456789abcdef0123"]]] as [string, string][][]) {
    assert.equal(draft.planningInputFromForm(interviewForm(entries)), null, JSON.stringify(entries));
  }
  const noKey = interviewForm();
  noKey.delete("idempotencyKey");
  assert.equal(draft.planningInputFromForm(noKey), null, "the planning idempotency key is required");
  for (const key of ["fp-" + "a".repeat(32), "pl-" + "A".repeat(32), "pl-" + "a".repeat(31)]) {
    const form = interviewForm();
    form.set("idempotencyKey", key);
    assert.equal(draft.planningInputFromForm(form), null, key);
  }
  assert.deepEqual(draft.planningInputFromForm(interviewForm([], false))?.egressApproved, false);
  assert.deepEqual(draft.planningInputFromForm(interviewForm())?.egressApproved, true);
});

test("AI-039.1 production binding: bound ONLY with a valid planning policy, credential and workspace; provider reached only through the composed runtime", () => {
  const server = code("lib/composition/owner-feature-plan-draft.server.ts");
  assert.match(server, /^import "server-only";/mu);
  assert.match(server, /const policy = parseFeaturePlanPlannerPolicy\(process\.env\);/u);
  assert.match(server, /if \(!policy \|\| typeof apiKey !== "string" \|\| apiKey\.length === 0/u);
  assert.match(server, /planner: planningModel\(\),/u);
  assert.match(server, /function planningModel\(\) \{\s*const binding = plannerBinding\(\);\s*if \(!binding\) return null;/u, "no binding → planner null → planner_unavailable");
  assert.match(server, /await composeRealProviderRuntime\(\{/u, "the provider is composed only by the existing real-provider runtime");
  assert.ok(!/from "openai"|lib\/providers|providers\/openai|createOpenAIModelProvider|new OpenAI/u.test(server), "no SDK / adapter import in the binding");
  // The credential is read here only, and only handed to the composition (never returned / exposed).
  assert.equal((server.match(/process\.env\.OPENAI_API_KEY/gu) ?? []).length, 1);
  assert.match(server, /credentials: \{ apiKey \},/u);
  assert.ok(!/apiKey[^,;]*\)\s*;?\s*\n\s*return \{[^}]*apiKey/u.test(server.split("export function featurePlanPlannerStatus")[1] ?? ""), "status exposes no credential");
  const status = server.split("export function featurePlanPlannerStatus")[1] ?? "";
  assert.ok(!/apiKey|OPENAI_API_KEY/u.test(status), "the presentation status never touches the credential");
  for (const path of ["lib/development/feature-plan-planner.ts", "lib/composition/owner-feature-plan-draft.ts", "lib/composition/owner-feature-plan-planning.ts",
    "app/tasks/[taskId]/development/draft-actions.ts", "components/domain/owner-console/feature-plan-planning.tsx", "app/tasks/[taskId]/development/page.tsx"]) {
    assert.ok(!/OPENAI_API_KEY|apiKey/u.test(code(path)), `${path} never sees the credential`);
  }
});

test("boundaries: planning is a bounded model task — no executor, SDK, GitHub, repository or FeaturePlan write; the candidate is never saved by AI", () => {
  // Pure planning, presentation and action files: no SDK, provider, runtime, database or save path.
  const planningFiles = ["lib/development/feature-plan-planner.ts", "lib/development/planning-interview.ts", "lib/composition/owner-feature-plan-draft.ts",
    "app/tasks/[taskId]/development/draft-actions.ts", "components/domain/owner-console/feature-plan-planning.tsx"];
  for (const path of planningFiles) {
    const text = code(path);
    assert.ok(!/ExecutorAdapter|ExecutorRouter|executor-adapter|lib\/providers|openai|anthropic|octokit|api\.github\.com|child_process|node:fs|\bfetch\(|attachRun|workflow-runtime-service|agent-step-runtime|real-provider/iu.test(text), `${path} reaches an executor / SDK / runtime / GitHub / repository`);
    assert.ok(!/feature-plan-mutations|owner-feature-plan-save|saveDraftRevision|lib\/db|postgres|insert into|update .* set/iu.test(text), `${path} writes or reaches the save path`);
  }
  // AI-039.1 run-backed port and its planning-run definition: no SDK, no provider adapter, no executor,
  // no FeaturePlan save; the model is reachable ONLY through the runtime service's advance.
  for (const path of ["lib/composition/owner-feature-plan-planning.ts", "lib/development/feature-plan-planning-run.ts", "lib/development/feature-plan-planning-requests.ts",
    "lib/composition/feature-plan-planner-config.ts", "lib/composition/owner-egress-approval.ts"]) {
    const text = code(path);
    assert.ok(!/from "openai"|lib\/providers|providers\/|createOpenAIModelProvider|ExecutorAdapter|octokit|api\.github\.com|child_process|node:fs|\bfetch\(|attachRun|\.run\(|\.preflight\(/u.test(text), `${path} bypasses the runtime`);
    assert.ok(!/owner-feature-plan-save|saveDraftRevision|project_task_feature_plans|update project_tasks|insert into project_tasks/u.test(text), `${path} writes a FeaturePlan or the task`);
  }
  const port = code("lib/composition/owner-feature-plan-planning.ts");
  assert.equal((port.match(/runtime\.service\.advance\(/gu) ?? []).length, 1, "exactly one advance per planning request");
  assert.ok(!/\bretry\b|while \(|for \(/u.test(port), "no retry loop in the planning port");
  // The planner speaks the ModelProvider message vocabulary only (type import), nothing executable.
  assert.match(code("lib/development/feature-plan-planner.ts"), /import type \{ ModelInvocationMessage \} from "\.\.\/contracts\/model-invocation";/u);
  // The planning UI never calls the save action itself: it hands it to the Plan Builder, which submits
  // only on the Owner's explicit "save draft revision".
  const planning = code("components/domain/owner-console/feature-plan-planning.tsx");
  assert.ok(!/saveAction\(/u.test(planning), "no programmatic save");
  assert.match(planning, /action=\{props\.saveAction\}/u);
  // The manual technical editor remains available (secondary path, and the fallback when the planner is unavailable).
  assert.match(planning, /onClick=\{\(\) => setMode\("manual"\)\}/u);
  assert.match(planning, /planner_unavailable: \[p\.unavailableTitle, p\.unavailableBody\]/u);
  assert.match(planning, /const titledNotice = titled\[state\.status\];/u);
  assert.match(planning, /<Notice body=\{titledNotice\[1\]\} title=\{titledNotice\[0\]\} tone="warn">\{manual\}<\/Notice>/u);
  // The egress approval is an explicit, unchecked, required checkbox (never pre-checked or remembered).
  assert.match(planning, /name="egressApproval" required type="checkbox" value="yes"/u);
  assert.ok(!/defaultChecked|checked=\{true\}/u.test(planning.split("interview-egress-approval")[1]?.split("</label>")[0] ?? "x"), "consent is never pre-checked");
  // Executor recommendation stays a separate, unavailable entity (planning model ≠ executor recommendation).
  assert.ok(!/executorRecommendation/u.test(planning + code("lib/development/feature-plan-planner.ts")));
});
