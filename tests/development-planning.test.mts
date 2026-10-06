/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-039 P-1 Owner Planning Interview → AI-assisted UNSAVED candidate → Owner review. Pure and
// structural guards with a deterministic fake planning model (no provider, no network, no spend).
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

test("planner: exactly one bounded completion; the candidate is canonical, waves come from the contract, no paths invented", async () => {
  const fake = fakeModel({ status: "completed", structuredOutput: valid() });
  const answers = interview.validateInterviewAnswers("feature", featureAnswers)!;
  const result = await planner.draftFeaturePlanCandidate({ task: facts, answers, model: fake.model });
  assert.equal(fake.calls.length, 1, "one planning operation, no follow-up turns");
  assert.equal(fake.calls[0].maxOutputTokens, planner.plannerLimits.maxOutputTokens);
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
    ["{\"title\":\"x\"}", "malformed_output"],
    [null, "malformed_output"],
  ];
  for (const [structuredOutput, reason] of cases) {
    const result = await planner.draftFeaturePlanCandidate({ task: facts, answers, model: fakeModel({ status: "completed", structuredOutput }).model });
    assert.deepEqual(result, { status: "rejected", reason }, JSON.stringify(structuredOutput)?.slice(0, 80));
  }
  let trapped = 0;
  const proxy = new Proxy(valid(), { get() { trapped += 1; return undefined; }, ownKeys() { trapped += 1; return []; } });
  assert.deepEqual(await planner.draftFeaturePlanCandidate({ task: facts, answers, model: fakeModel({ status: "completed", structuredOutput: proxy }).model }), { status: "rejected", reason: "malformed_output" });
  assert.equal(trapped, 0, "no proxy trap runs");
  assert.deepEqual(await planner.draftFeaturePlanCandidate({ task: facts, answers, model: null }), { status: "unavailable" });
  assert.deepEqual(await planner.draftFeaturePlanCandidate({ task: facts, answers, model: fakeModel({ status: "unavailable" }).model }), { status: "unavailable" });
  assert.deepEqual(await planner.draftFeaturePlanCandidate({ task: facts, answers, model: fakeModel({ status: "failed" }).model }), { status: "failed" });
  assert.deepEqual(await planner.draftFeaturePlanCandidate({ task: facts, answers, model: fakeModel(new Error("SENTINEL")).model }), { status: "failed" });
});

const development = (taskStatus = "draft", creationBlock: string | null = null) => ({
  state: "available", workspace: { slug: "w", displayName: "W" }, projects: [], projectsTruncated: false, scope: { mode: "all" },
  development: { state: "available", task: { taskId: "task-abc", projectId: "project-a", title: "Фильтр", goal: null, type: "feature", status: taskStatus, priority: "P1", riskLevel: "medium" },
    project: null, plans: { state: "available", data: {} }, creationBlock },
});
const interviewForm = (extra: [string, string][] = []) => {
  const form = new FormData();
  for (const [name, value] of [["taskId", "task-abc"], ["answer.outcome", "Видеть только выбранный риск"], ["answer.surface", "unknown"], ["answer.mustNotChange", ""],
    ["answer.doneWhen", "Список меняется"], ["answer.constraints", "none"], ...extra] as [string, string][]) form.append(name, value);
  return form;
};

test("draft composition: Owner + task checks first, then answers, then ONE planning call; production has no planner", async () => {
  const run = async (view: unknown, model: unknown, form: FormData = interviewForm()) => {
    const fake = fakeModel(model);
    const instance = draft.createOwnerFeaturePlanDraft({ loadDevelopment: async () => view as any, planner: model === null ? null : fake.model });
    return { result: await instance.submit(form), calls: fake.calls.length };
  };
  const candidateModel = { status: "completed", structuredOutput: valid() };
  assert.deepEqual(await run({ state: "unauthenticated" }, candidateModel), { result: { status: "unauthenticated" }, calls: 0 });
  assert.deepEqual(await run({ state: "unavailable" }, candidateModel), { result: { status: "unavailable" }, calls: 0 });
  assert.deepEqual(await run(development("ready", "task_not_draft"), candidateModel), { result: { status: "not_plannable" }, calls: 0 });
  assert.deepEqual(await run(development(), candidateModel, interviewForm([["answer.allowedPaths", "app/"]])), { result: { status: "invalid_input" }, calls: 0 });
  assert.deepEqual(await run(development(), null), { result: { status: "planner_unavailable" }, calls: 0 });
  const ok = await run(development(), candidateModel);
  assert.equal(ok.result.status, "candidate");
  assert.equal(ok.calls, 1);
  assert.deepEqual(await run(development(), { status: "completed", structuredOutput: output([step("step-1", { allowedPaths: ["lib/"] })]) }), { result: { status: "candidate_rejected", reason: "untrusted_repository_paths" }, calls: 1 });
  // Bounded form parser.
  for (const entries of [[["taskId", "task-x"]], [["workspaceId", "w"]], [["answer.out-come", "x"]], [["answer.outcome", "x".repeat(2000)]]] as [string, string][][]) {
    assert.equal(draft.planningInputFromForm(interviewForm(entries)), null, JSON.stringify(entries));
  }
  // Production binding: no planning provider is bound; availability is factually false.
  const server = code("lib/composition/owner-feature-plan-draft.server.ts");
  assert.match(server, /planner: null,/u);
  assert.match(server, /export function isFeaturePlanPlannerAvailable\(\): boolean \{\s*return false;\s*\}/u);
  assert.ok(!/providers|openai|model-provider|LLM_|process\.env/u.test(server), "no provider, SDK or provider configuration is read");
});

test("boundaries: planning is a bounded model task — no executor, SDK, GitHub, repository, run or write; the candidate is never saved by AI", () => {
  const planningFiles = ["lib/development/feature-plan-planner.ts", "lib/development/planning-interview.ts", "lib/composition/owner-feature-plan-draft.ts",
    "lib/composition/owner-feature-plan-draft.server.ts", "app/tasks/[taskId]/development/draft-actions.ts", "components/domain/owner-console/feature-plan-planning.tsx"];
  for (const path of planningFiles) {
    const text = code(path);
    assert.ok(!/ExecutorAdapter|ExecutorRouter|executor-adapter|lib\/providers|openai|anthropic|octokit|api\.github\.com|child_process|node:fs|\bfetch\(|attachRun|workflow-runtime-service|agent-step-runtime/iu.test(text), `${path} reaches an executor / SDK / GitHub / repository`);
    assert.ok(!/feature-plan-mutations|owner-feature-plan-save|saveDraftRevision|lib\/db|postgres|insert into|update .* set/iu.test(text), `${path} writes or reaches the save path`);
  }
  // The planner speaks the ModelProvider message vocabulary only (type import), nothing executable.
  assert.match(code("lib/development/feature-plan-planner.ts"), /import type \{ ModelInvocationMessage \} from "\.\.\/contracts\/model-invocation";/u);
  // The planning UI never calls the save action itself: it hands it to the Plan Builder, which submits
  // only on the Owner's explicit "save draft revision".
  const planning = code("components/domain/owner-console/feature-plan-planning.tsx");
  assert.ok(!/saveAction\(/u.test(planning), "no programmatic save");
  assert.match(planning, /action=\{props\.saveAction\}/u);
  // The manual technical editor remains available (secondary path, and the fallback when the planner is unavailable).
  assert.match(planning, /onClick=\{\(\) => setMode\("manual"\)\}/u);
  assert.match(planning, /state\.status === "planner_unavailable"[\s\S]*?onClick=\{props\.onManual\}/u);
  // Executor recommendation stays a separate, unavailable entity (planning model ≠ executor recommendation).
  assert.ok(!/executorRecommendation/u.test(planning + code("lib/development/feature-plan-planner.ts")));
});
