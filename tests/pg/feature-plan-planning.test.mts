/* eslint-disable @typescript-eslint/no-explicit-any -- live driver and fake SDK objects cross untyped boundaries */
// Live PostgreSQL: AI-039.1 ledger-backed AI FeaturePlan planning, end to end through the REAL chain:
//   Owner Console read (real Auth.js-shaped GitHub session → AI-038.1 → AI-038.0) → draft composition
//   → run-backed planning port → planning request boundary (migration 0012) → REAL composed
//   real-provider runtime (service, PostgreSQL store, invocation ledger, budget windows, provider-start
//   fence, REAL OpenAI adapter) → durable step result (migration 0012) → strict candidate parser.
// Only the OpenAI SDK client below the adapter is a deterministic in-memory fake: no network, no key,
// no spend. Nothing here makes a real provider, OAuth or GitHub call.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

const live = (await import(new URL("./helpers/live-pg.ts", import.meta.url).href)) as typeof import("./helpers/live-pg");
const sdk = (await import(new URL("./helpers/fake-openai-sdk.ts", import.meta.url).href)) as typeof import("./helpers/fake-openai-sdk");
const postgres = (await import(new URL("../../lib/db/postgres.ts", import.meta.url).href)) as typeof import("../../lib/db/postgres");
const identity = (await import(new URL("../../lib/auth/github-session-identity-source.ts", import.meta.url).href)) as typeof import("../../lib/auth/github-session-identity-source");
const taskMutations = (await import(new URL("../../lib/tasks/owner-task-mutations.ts", import.meta.url).href)) as typeof import("../../lib/tasks/owner-task-mutations");
const composed = (await import(new URL("../../lib/composition/github-owner-read-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/github-owner-read-runtime");
const consoleRead = (await import(new URL("../../lib/composition/owner-console-read.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-console-read");
const projectContext = (await import(new URL("../../lib/projects/project-context.ts", import.meta.url).href)) as typeof import("../../lib/projects/project-context");
const draftBinding = (await import(new URL("../../lib/composition/owner-feature-plan-draft.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-feature-plan-draft");
const planningPort = (await import(new URL("../../lib/composition/owner-feature-plan-planning.ts", import.meta.url).href)) as typeof import("../../lib/composition/owner-feature-plan-planning");
const planningRequests = (await import(new URL("../../lib/development/feature-plan-planning-requests.ts", import.meta.url).href)) as typeof import("../../lib/development/feature-plan-planning-requests");
const planningConfig = (await import(new URL("../../lib/composition/feature-plan-planner-config.ts", import.meta.url).href)) as typeof import("../../lib/composition/feature-plan-planner-config");
const realProvider = (await import(new URL("../../lib/composition/real-provider-runtime.ts", import.meta.url).href)) as typeof import("../../lib/composition/real-provider-runtime");

const db = await live.useLiveDatabase("planning");
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
await live.insertWorkspace(db.admin, A);
await live.insertWorkspace(db.admin, B);

const OWNER = "00000000-0000-4000-8000-000000007101";
const MEMBER = "00000000-0000-4000-8000-000000007102";
for (const [id, name] of [[OWNER, "owner"], [MEMBER, "member"]]) {
  await db.admin.query("insert into users (id, email, name, status) values ($1, $2, $2, 'active')", [id, `${name}@pac.test`]);
}
const ownerRole = (await db.admin.query("insert into roles (workspace_id, code, name) values ($1, 'owner', 'Owner') returning id", [A.id])).rows[0].id;
const ownerMember = (await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active') returning id", [A.id, OWNER])).rows[0].id;
await db.admin.query("insert into member_role_assignments (member_id, role_id) values ($1, $2)", [ownerMember, ownerRole]);
await db.admin.query("insert into workspace_members (workspace_id, user_id, status) values ($1, $2, 'active')", [A.id, MEMBER]);
await db.admin.query("insert into auth_identities (user_id, provider, provider_subject, status) values ($1, 'github', '7101', 'active'), ($2, 'github', '7102', 'active')", [OWNER, MEMBER]);
for (const key of ["project-a", "project-budget", "project-c"]) {
  await db.admin.query("insert into projects (workspace_id, project_key, display_name, status) values ($1, $2, $3, 'active')", [A.id, key, `Display ${key}`]);
}

const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 8 });
const session = (subject: string | null) => subject === null ? null : { expires: "2099-01-01T00:00:00.000Z", pacIdentity: { provider: "github", providerSubject: subject } };
const identitySource = (subject: string | null) => identity.createGitHubSessionIdentitySource({ sessionResolver: { resolve: () => session(subject) }, database });

const tasks = taskMutations.createOwnerTaskMutations({ database, domainWorkspaceId: A.domain, identitySource: identitySource("7101") });
let taskSequence = 0;
async function draftTask(projectId = "project-a"): Promise<string> {
  taskSequence += 1;
  const created = await tasks.createTask({ idempotencyKey: `qc-plan-${taskSequence}-000000`, projectId, title: `Фильтр задач ${taskSequence}`, goal: "Owner intent", type: "feature", priority: "P1", riskLevel: "medium" });
  assert.equal(created.status, "created", JSON.stringify(created));
  return created.status === "created" ? created.task.taskId : "";
}

const fakeSecret = `FAKE_OPENAI_SECRET_DO_NOT_LEAK_${process.pid}_ai0391`;
const modelVersion = "gpt-planning-pinned-2026-01-01";
const env = {
  PAC_PLANNER_PROVIDER: "openai", PAC_PLANNER_MODEL_ID: "gpt-planning-alias", PAC_PLANNER_REQUEST_MODEL_ID: "gpt-planning-pinned",
  PAC_PLANNER_MODEL_VERSION: modelVersion, PAC_PLANNER_INPUT_PRICE_USD_MICROS_PER_MILLION: "1000000", PAC_PLANNER_OUTPUT_PRICE_USD_MICROS_PER_MILLION: "4000000",
  PAC_PLANNER_PRICES_VERIFIED_ON: "2026-01-01", PAC_PLANNER_MAX_INPUT_TOKENS: "6000", PAC_PLANNER_MAX_OUTPUT_TOKENS: "4000",
  PAC_PLANNER_MAX_COST_USD_MICROS: "30000", PAC_PLANNER_DAILY_TOKEN_BUDGET: "50000", PAC_PLANNER_MONTHLY_COST_BUDGET_USD_CENTS: "500",
};
const policy = planningConfig.parseFeaturePlanPlannerPolicy(env)!;
assert.ok(policy);
assert.equal(planningConfig.parseFeaturePlanPlannerPolicy({ ...env, PAC_PLANNER_DAILY_TOKEN_BUDGET: "1000" }), null, "a policy that can never plan is not bound");

const step = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Шаг ${id}`, goal: `Цель ${id}`, scope: [`объём ${id}`], nonGoals: [], allowedPaths: [], acceptanceCriteria: [`готово ${id}`],
  verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "medium", priority: "P2", requiresOwnerApproval: false, ...extra,
});
const planJson = (steps: unknown[] = [step("step-1"), step("step-2", { dependencyIds: ["step-1"], riskLevel: "high", requiresOwnerApproval: true }), step("step-3", { dependencyIds: ["step-1", "step-2"] })]) =>
  JSON.stringify({ title: "Фильтр по риску", goal: "Владелец фильтрует задачи по риску", steps });
const usage = { input: 900, output: 300 };
const textResponse = (text: string, overrides: Record<string, unknown> = {}) => sdk.completedResponse({
  model: modelVersion,
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.input + usage.output },
  ...overrides,
});
const expectedCost = Math.ceil((usage.input * 1_000_000 + usage.output * 4_000_000) / 1_000_000);

// Everything serialized during the suite, for the credential leak scan.
const observed: string[] = [];

// The production composition (lib/composition/owner-feature-plan-draft.server.ts) with the test seams:
// the live database, a faked GitHub session, and the fake SDK client below the real adapter.
function planner(fake: ReturnType<typeof sdk.fakeOpenAISdk>, subject: string | null = "7101", plannerPolicy = policy) {
  return planningPort.createRunBackedPlanningModel({
    policy: plannerPolicy,
    domainWorkspaceId: A.domain,
    withRequests: async (work) => work(planningRequests.createFeaturePlanPlanningRequests({ database, domainWorkspaceId: A.domain, identitySource: identitySource(subject) })),
    async composeRuntime(parts) {
      const decision = await realProvider.composeRealProviderRuntime({
        database: { connectionString: db.url, maxConnections: 2 },
        domainWorkspaceId: A.domain,
        timing: { providerTimeoutMs: 120_000, claimLeaseDurationMs: 300_000 },
        openAI: {
          identity: plannerPolicy.identity, maxInputTokens: plannerPolicy.maxInputTokens, maxOutputTokens: plannerPolicy.maxOutputTokens,
          inputCostUsdMicrosPerMillionTokens: plannerPolicy.inputCostUsdMicrosPerMillionTokens, outputCostUsdMicrosPerMillionTokens: plannerPolicy.outputCostUsdMicrosPerMillionTokens,
        },
        credentials: { apiKey: fakeSecret },
        ...parts,
        dependencies: { createOpenAIClient: fake.createClient },
      });
      observed.push(JSON.stringify(decision.reasons));
      return decision.verdict === "allow" ? decision.runtime : null;
    },
    now: () => new Date().toISOString(),
  });
}

const reader = (subject: string | null) => consoleRead.createOwnerConsoleReader({
  workspaceSlug: A.domain,
  withRuntime: async (workspace, read) => read(await composed.createGitHubOwnerReadRuntime({ database, domainWorkspaceId: workspace, sessionResolver: { resolve: () => session(subject) } })),
});
function draft(fake: ReturnType<typeof sdk.fakeOpenAISdk>, options: Readonly<{ subject?: string | null; plannerPolicy?: typeof policy; bound?: boolean }> = {}) {
  const subject = options.subject === undefined ? "7101" : options.subject;
  return draftBinding.createOwnerFeaturePlanDraft({
    loadDevelopment: (taskId) => reader(subject).loadOwnerTaskDevelopment(taskId, projectContext.parseProjectSelector(undefined)),
    planner: options.bound === false ? null : planner(fake, subject, options.plannerPolicy ?? policy),
  });
}
const form = (taskId: string, key: string, answers: Record<string, string> = {}, approval = true) => {
  const data = new FormData();
  data.append("taskId", taskId);
  data.append("idempotencyKey", key);
  for (const [name, value] of Object.entries({ outcome: "Видеть только задачи выбранного риска", surface: "unknown", mustNotChange: "", doneWhen: "Список меняется", constraints: "none", ...answers })) {
    data.append(`answer.${name}`, value);
  }
  if (approval) data.append("egressApproval", "yes");
  return data;
};
const key = () => planningRequests.newPlanningFormKey();
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const one = async (sql: string, values: unknown[] = []) => (await db.admin.query(sql, values)).rows[0] ?? null;
const count = async (sql: string, values: unknown[] = []) => Number((await db.admin.query(sql, values)).rows[0].n);
const requestRow = (idempotencyKey: string) => one(`select planning_key, run_id, task_key, project_key, status, outcome, output_fingerprint, requested_by::text as requested_by,
  provider_id, provider_model_id, request_fingerprint from project_task_planning_requests where workspace_id = $1 and idempotency_key = $2`, [A.id, idempotencyKey]);
const invocation = (runId: string) => one(`select invocation.status, invocation.outcome, invocation.finish_reason, invocation.input_tokens::int as input_tokens,
  invocation.output_tokens::int as output_tokens, invocation.total_tokens::int as total_tokens, invocation.cost_usd_micros::int as cost, invocation.error_code,
  invocation.provider_request_model_id, invocation.provider_model_version, invocation.request_fingerprint, invocation.latency_ms::int as latency_ms,
  invocation.id::text as id
  from workflow_model_invocations as invocation join workflow_runs as run on run.id = invocation.workflow_run_id
  where run.workspace_id = $1 and run.runtime_id = $2`, [A.id, runId]);
const budget = (runId: string) => one(`select budget.status, budget.reserved_total_tokens::int as reserved_tokens, budget.reserved_cost_usd_micros::int as reserved_cost,
  budget.actual_total_tokens::int as actual_tokens, budget.actual_cost_usd_micros::int as actual_cost
  from workflow_model_budget_reservations as budget join workflow_runs as run on run.id = budget.workflow_run_id
  where run.workspace_id = $1 and run.runtime_id = $2`, [A.id, runId]);
const result = (runId: string) => one(`select result.output_text, result.output_fingerprint from workflow_model_invocation_results as result
  join workflow_runs as run on run.id = result.workflow_run_id where run.workspace_id = $1 and run.runtime_id = $2`, [A.id, runId]);
const runRow = (runId: string) => one("select status, project_id, workflow_id, revision::int as revision from workflow_runs where workspace_id = $1 and runtime_id = $2", [A.id, runId]);
const audits = (entityType: string) => count("select count(*)::int as n from audit_events where workspace_id = $1 and entity_type = $2", [A.id, entityType]);
const totals = async () => ({
  runs: await count("select count(*)::int as n from workflow_runs where runtime_id like 'fpp-%'"),
  invocations: await count("select count(*)::int as n from workflow_model_invocations"),
  results: await count("select count(*)::int as n from workflow_model_invocation_results"),
  requests: await count("select count(*)::int as n from project_task_planning_requests"),
  requestAudits: await audits("project_task_planning_request"),
  plans: await count("select count(*)::int as n from project_task_feature_plans"),
});
const taskState = (taskId: string) => one("select status, updated_at::text as updated_at from project_tasks where workspace_id = $1 and task_key = $2", [A.id, taskId]);
const windows = (projectId: string) => db.admin.query(`select window_kind, reserved_amount::int as reserved, consumed_amount::int as consumed
  from workflow_model_budget_windows where workspace_id = $1 and project_id = $2 order by window_kind`, [A.id, projectId]).then((value: any) => value.rows);

const TASK = await draftTask();
const MAIN_KEY = key();

test("candidate: ONE real planning Run through the runtime — ledger, budget, fence, usage / cost, durable result — then the strict parser; nothing saved", async () => {
  const fake = sdk.fakeOpenAISdk({ inputTokenCount: usage.input, generations: [{ response: textResponse(planJson()) }] });
  const before = { task: await taskState(TASK), totals: await totals() };
  const outcome = await draft(fake).submit(form(TASK, MAIN_KEY));
  observed.push(JSON.stringify(outcome));
  assert.equal(outcome.status, "candidate", JSON.stringify(outcome));
  if (outcome.status !== "candidate") return;
  assert.deepEqual(outcome.candidate.steps.map((item) => [item.id, item.riskLevel, item.dependencyIds.length]), [["step-1", "medium", 0], ["step-2", "high", 1], ["step-3", "medium", 2]]);
  assert.deepEqual(outcome.candidate.waves.map((wave) => [...wave]), [["step-1"], ["step-2"], ["step-3"]]);
  assert.equal(outcome.candidate.pathsRequireTechnicalReview, true);
  // Exactly one token count and one generation; SDK retries 0; nothing stored provider-side.
  assert.deepEqual({ counts: fake.calls.counts, creates: fake.calls.creates, unexpected: fake.calls.unexpected }, { counts: 1, creates: 1, unexpected: 0 });
  assert.ok(fake.calls.clientOptions.every((options: any) => options.maxRetries === 0 && options.logLevel === "off" && options.timeout === 120_000));
  const sent = fake.calls.createInputs[0];
  assert.deepEqual([sent.model, sent.store, sent.stream, sent.background, sent.max_output_tokens], ["gpt-planning-pinned", false, false, false, 4000]);
  assert.match(JSON.stringify(sent.input), /Видеть только задачи выбранного риска/u, "the Owner's answers are the message data");
  assert.ok(!/workspace|7101|OWNER|00000000-/u.test(JSON.stringify(sent)), "no tenancy / identity in the prompt");
  // Planning request: started → settled completed, bound to the Run and the durable result.
  const request = await requestRow(MAIN_KEY);
  assert.deepEqual([request.status, request.outcome, request.task_key, request.project_key, request.requested_by, request.provider_id, request.provider_model_id],
    ["settled", "completed", TASK, "project-a", OWNER, "provider-openai", "gpt-planning-alias"]);
  assert.equal(request.run_id, request.planning_key);
  assert.match(request.planning_key, /^fpp-[0-9a-f]{20}$/u);
  // The real persisted Run (not a synthetic id): completed, in the task's project, the planning workflow.
  assert.deepEqual(await runRow(request.run_id), { status: "completed", project_id: "project-a", workflow_id: "pac-feature-plan-planning", revision: (await runRow(request.run_id)).revision });
  const invoked = await invocation(request.run_id);
  assert.deepEqual([invoked.status, invoked.outcome, invoked.finish_reason, invoked.input_tokens, invoked.output_tokens, invoked.total_tokens, invoked.cost, invoked.error_code,
    invoked.provider_request_model_id, invoked.provider_model_version],
  ["succeeded", "succeeded", "stop", usage.input, usage.output, usage.input + usage.output, expectedCost, null, "gpt-planning-pinned", modelVersion]);
  // Pre-spend reservation (input + effective max output, worst-case cost) settled to the actual usage.
  assert.deepEqual(await budget(request.run_id), { status: "settled", reserved_tokens: usage.input + 4000, reserved_cost: usage.input + 16_000, actual_tokens: usage.input + usage.output, actual_cost: expectedCost });
  assert.deepEqual(await windows("project-a"), [
    { window_kind: "daily_tokens", reserved: 0, consumed: usage.input + usage.output },
    { window_kind: "monthly_cost", reserved: 0, consumed: expectedCost },
  ]);
  // Durable step result: the exact output text, fingerprinted, and the settlement names that fingerprint.
  const stored = await result(request.run_id);
  assert.equal(stored.output_text, planJson());
  assert.equal(stored.output_fingerprint, sha(planJson()));
  assert.equal(request.output_fingerprint, stored.output_fingerprint);
  // Audit: one started + one settled planning event; the runtime's own invocation audit.
  const planningAudit = (await db.admin.query(`select event_type, actor_user_id::text as actor, metadata from audit_events
    where workspace_id = $1 and entity_type = 'project_task_planning_request' order by created_at, event_type`, [A.id])).rows;
  assert.deepEqual(planningAudit.map((row: any) => [row.event_type, row.actor, row.metadata.planningKey, row.metadata.runId]),
    [["task.feature_plan_planning_started", OWNER, request.planning_key, request.run_id], ["task.feature_plan_planning_settled", OWNER, request.planning_key, request.run_id]]);
  assert.equal(planningAudit[1].metadata.outcome, "completed");
  assert.equal(planningAudit[1].metadata.outputFingerprint, stored.output_fingerprint);
  assert.ok(!JSON.stringify(planningAudit).includes("Видеть только"), "no answers / prompt in audit");
  assert.equal(await count("select count(*)::int as n from audit_events where workspace_id = $1 and runtime_run_id = $2 and event_type = 'workflow.step_model_invocation_completed'", [A.id, request.run_id]), 1);
  // Nothing saved, the task untouched, no run attached to the task.
  const after = await totals();
  assert.deepEqual({ ...after, runs: after.runs - 1, invocations: after.invocations - 1, results: after.results - 1, requests: after.requests - 1, requestAudits: after.requestAudits - 2 }, before.totals);
  assert.equal(after.plans, before.totals.plans, "no FeaturePlan revision is created by planning");
  assert.deepEqual(await taskState(TASK), before.task, "ProjectTask status and updated_at are unchanged");
  assert.equal(await count("select count(*)::int as n from project_task_runs where workspace_id = $1 and task_key = $2", [A.id, TASK]), 0, "the planning run is not attached to the task");
});

test("idempotency: the exact replay re-derives the candidate from the durable result with ZERO provider calls; a changed request under the same key is a conflict", async () => {
  const before = await totals();
  const replayFake = sdk.fakeOpenAISdk({ inputTokenCount: usage.input, generations: [] });
  const replay = await draft(replayFake).submit(form(TASK, MAIN_KEY));
  assert.equal(replay.status, "candidate");
  assert.deepEqual({ counts: replayFake.calls.counts, creates: replayFake.calls.creates, unexpected: replayFake.calls.unexpected }, { counts: 0, creates: 0, unexpected: 0 });
  const conflictFake = sdk.fakeOpenAISdk({ generations: [] });
  assert.deepEqual(await draft(conflictFake).submit(form(TASK, MAIN_KEY, { outcome: "Другой результат" })), { status: "conflict" });
  const otherTask = await draftTask();
  assert.deepEqual(await draft(conflictFake).submit(form(otherTask, MAIN_KEY)), { status: "conflict" }, "the key is bound to its task");
  assert.equal(conflictFake.calls.counts + conflictFake.calls.creates, 0);
  assert.deepEqual(await totals(), before, "replays and conflicts create no run, invocation, request or audit");
});

test("budget denied: the aggregate planning window refuses the reservation BEFORE any generation; nothing is consumed", async () => {
  const task = await draftTask("project-budget");
  // Prior planning spend today: 46 000 of the 50 000-token daily window is consumed, so the next
  // reservation (900 input + 4000 output) does not fit.
  await db.admin.query(`insert into workflow_model_budget_windows (workspace_id, project_id, workflow_binding_id, window_kind, window_start, consumed_amount)
    values ($1, 'project-budget', 'pac-feature-plan-planning-binding', 'daily_tokens', (transaction_timestamp() at time zone 'UTC')::date, 46000)`, [A.id]);
  const fake = sdk.fakeOpenAISdk({ inputTokenCount: usage.input, generations: [{ response: textResponse(planJson()) }] });
  const planningKey = key();
  assert.deepEqual(await draft(fake).submit(form(task, planningKey)), { status: "budget_denied" });
  assert.equal(fake.calls.creates, 0, "no generation was dispatched");
  const request = await requestRow(planningKey);
  assert.deepEqual([request.status, request.outcome, request.output_fingerprint], ["settled", "budget_denied", null]);
  const invoked = await invocation(request.run_id);
  assert.deepEqual([invoked.status, invoked.error_code, invoked.total_tokens, invoked.cost], ["failed", "generation_not_authorized", null, null]);
  assert.equal(await budget(request.run_id), null, "no reservation was admitted");
  assert.equal(await result(request.run_id), null);
  assert.deepEqual((await windows("project-budget")).find((row: any) => row.window_kind === "daily_tokens"), { window_kind: "daily_tokens", reserved: 0, consumed: 46000 }, "nothing reserved or consumed");
  assert.equal((await runRow(request.run_id)).status, "failed");
});

test("provider failures are honest and never retried: 429 → provider_unavailable (budget released); timeout → recovery_required (budget held, replay never redispatches)", async () => {
  const task = await draftTask("project-c");
  const rateLimited = sdk.fakeOpenAISdk({ inputTokenCount: usage.input, generations: [{ error: sdk.sdkErrors.rateLimit429 }] });
  const limitedKey = key();
  assert.deepEqual(await draft(rateLimited).submit(form(task, limitedKey)), { status: "provider_unavailable" });
  assert.deepEqual([rateLimited.calls.creates, rateLimited.calls.unexpected], [1, 0]);
  const limited = await requestRow(limitedKey);
  assert.equal(limited.outcome, "provider_unavailable");
  assert.equal((await invocation(limited.run_id)).status, "failed");
  assert.equal((await budget(limited.run_id)).status, "released");

  const timeout = sdk.fakeOpenAISdk({ inputTokenCount: usage.input, generations: [{ error: sdk.sdkErrors.timeout }] });
  const timeoutKey = key();
  assert.deepEqual(await draft(timeout).submit(form(task, timeoutKey)), { status: "recovery_required" });
  assert.deepEqual([timeout.calls.creates, timeout.calls.unexpected], [1, 0]);
  const unknown = await requestRow(timeoutKey);
  assert.deepEqual([unknown.status, unknown.outcome], ["settled", "recovery_required"]);
  assert.equal((await invocation(unknown.run_id)).status, "outcome_unknown");
  const held = await budget(unknown.run_id);
  assert.deepEqual([held.status, held.actual_tokens, held.actual_cost], ["outcome_unknown", null, null], "the reservation stays held");
  assert.ok((await windows("project-c")).find((row: any) => row.window_kind === "daily_tokens").reserved >= usage.input + 1, "the window keeps the held reservation");
  const again = sdk.fakeOpenAISdk({ generations: [] });
  assert.deepEqual(await draft(again).submit(form(task, timeoutKey)), { status: "recovery_required" });
  assert.equal(again.calls.counts + again.calls.creates, 0, "a replay of an ambiguous request never dispatches again");
});

test("untrusted output: fenced / malformed JSON and invented repository paths are rejected (never repaired), while usage stays settled and the result durable", async () => {
  const task = await draftTask();
  for (const [text, reason] of [
    [`\`\`\`json\n${planJson()}\n\`\`\``, "malformed_output"],
    [planJson([step("step-1", { allowedPaths: ["app/tasks/page.tsx"] })]), "untrusted_repository_paths"],
    [planJson([step("step-1", { dependencyIds: ["step-2"] }), step("step-2", { dependencyIds: ["step-1"] })]), "invalid_dependency_graph"],
  ] as const) {
    const fake = sdk.fakeOpenAISdk({ inputTokenCount: usage.input, generations: [{ response: textResponse(text) }] });
    const planningKey = key();
    assert.deepEqual(await draft(fake).submit(form(task, planningKey)), { status: "candidate_rejected", reason }, reason);
    const request = await requestRow(planningKey);
    assert.deepEqual([request.outcome, request.output_fingerprint], ["completed", sha(text)], "the Run completed; the rejection is derived from the durable result");
    assert.equal((await result(request.run_id)).output_text, text);
    assert.equal((await budget(request.run_id)).status, "settled");
  }
});

test("boundaries: no egress without the Owner's approval, no planner without config, non-plannable and non-Owner requests do nothing", async () => {
  const before = await totals();
  const fake = sdk.fakeOpenAISdk({ generations: [] });
  const task = await draftTask();
  const afterTask = await totals();
  assert.deepEqual(await draft(fake).submit(form(task, key(), {}, false)), { status: "egress_approval_required" });
  assert.deepEqual(await draft(fake, { bound: false }).submit(form(task, key())), { status: "planner_unavailable" });
  await db.admin.query("insert into project_tasks (workspace_id, project_key, task_key, title, task_type, status) values ($1, 'project-a', 'task-planning-ready', 'Ready', 'feature', 'ready')", [A.id]);
  assert.deepEqual(await draft(fake).submit(form("task-planning-ready", key())), { status: "not_plannable" });
  const member = await draft(fake, { subject: "7102" }).submit(form(task, key()));
  assert.ok(["unavailable", "unauthenticated"].includes(member.status), JSON.stringify(member));
  assert.deepEqual(await draft(fake, { subject: null }).submit(form(task, key())), { status: "unauthenticated" });
  assert.equal(fake.calls.counts + fake.calls.creates, 0);
  assert.deepEqual(await totals(), afterTask, "no request, run, invocation or audit for any refused submission");
  assert.equal(afterTask.plans, before.plans);
});

test("migration 0012 constraints: results only for succeeded invocations, immutable, tenant-bound; planning requests settle exactly once", async () => {
  const request = await requestRow(MAIN_KEY);
  const invoked = await invocation(request.run_id);
  const run = await one("select id::text as id from workflow_runs where workspace_id = $1 and runtime_id = $2", [A.id, request.run_id]);
  const attempt = async (sql: string, values: unknown[]) => {
    try { await db.admin.query(sql, values); return "accepted"; } catch (error) { return (error as { code?: string }).code; }
  };
  assert.equal(await attempt("update workflow_model_invocation_results set output_text = 'x' where model_invocation_id = $1", [invoked.id]), "55000");
  assert.equal(await attempt("insert into workflow_model_invocation_results (workspace_id, workflow_run_id, model_invocation_id, output_text, output_fingerprint) values ($1, $2, $3, 'x', $4)",
    [A.id, run.id, invoked.id, sha("x")]), "23505", "one result per invocation");
  const failed = await invocation((await requestRow((await one("select idempotency_key from project_task_planning_requests where outcome = 'budget_denied'")).idempotency_key)).run_id);
  const failedRun = await one("select workflow_run_id::text as id from workflow_model_invocations where id = $1", [failed.id]);
  assert.equal(await attempt("insert into workflow_model_invocation_results (workspace_id, workflow_run_id, model_invocation_id, output_text, output_fingerprint) values ($1, $2, $3, 'x', $4)",
    [A.id, failedRun.id, failed.id, sha("x")]), "23514", "no result for a failed invocation");
  // Cross-workspace: refused by the succeeded-invocation guard, and independently by the composite
  // tenant FKs (guard disabled by the admin for this probe only; a result-less invocation is used so the
  // unique key cannot answer first).
  const crossTenant = (invocationId: string, runId: string) => attempt("insert into workflow_model_invocation_results (workspace_id, workflow_run_id, model_invocation_id, output_text, output_fingerprint) values ($1, $2, $3, 'x', $4)",
    [B.id, runId, invocationId, sha("x")]);
  assert.equal(await crossTenant(failed.id, failedRun.id), "23514");
  await db.admin.query("alter table workflow_model_invocation_results disable trigger workflow_model_invocation_results_succeeded");
  try {
    assert.equal(await crossTenant(failed.id, failedRun.id), "23503", "cross-workspace result: refused by the composite FKs");
  } finally {
    await db.admin.query("alter table workflow_model_invocation_results enable trigger workflow_model_invocation_results_succeeded");
  }
  assert.equal(await attempt("update project_task_planning_requests set outcome = 'budget_denied' where idempotency_key = $1", [MAIN_KEY]), "55000", "settled rows are immutable");
  assert.equal(await attempt("update project_task_planning_requests set status = 'started', outcome = null, output_fingerprint = null, settled_at = null where idempotency_key = $1", [MAIN_KEY]), "55000");
  assert.equal(await attempt(`insert into project_task_planning_requests (workspace_id, project_key, task_key, planning_key, run_id, idempotency_key, request_fingerprint, provider_id, provider_model_id, status)
    values ($1, 'project-a', $2, 'fpp-ffffffffffffffffffff', 'fpp-eeeeeeeeeeeeeeeeeeee', $3, $4, 'p', 'm', 'started')`, [A.id, TASK, key(), sha("r")]), "23514", "the run id is the planning key");
  assert.equal(await attempt(`insert into project_task_planning_requests (workspace_id, project_key, task_key, planning_key, run_id, idempotency_key, request_fingerprint, provider_id, provider_model_id, status)
    values ($1, 'project-c', $2, 'fpp-ffffffffffffffffffff', 'fpp-ffffffffffffffffffff', $3, $4, 'p', 'm', 'started')`, [A.id, TASK, key(), sha("r")]), "23503", "the task must be in the same project");
  assert.equal(await attempt(`insert into project_task_planning_requests (workspace_id, project_key, task_key, planning_key, run_id, idempotency_key, request_fingerprint, provider_id, provider_model_id, status, outcome, settled_at)
    values ($1, 'project-a', $2, 'fpp-ffffffffffffffffffff', 'fpp-ffffffffffffffffffff', $3, $4, 'p', 'm', 'settled', 'completed', now())`, [A.id, TASK, key(), sha("r")]), "23514", "completed needs an output fingerprint");
});

test("durable result ledger semantics: same settlement replays idempotently, a different step result is a conflict, and the read fails closed on tampering", async () => {
  const request = await requestRow(MAIN_KEY);
  const invoked = await invocation(request.run_id);
  const decision = await realProvider.composeRealProviderRuntime({
    database: { connectionString: db.url, maxConnections: 2 }, domainWorkspaceId: A.domain, timing: { providerTimeoutMs: 120_000, claimLeaseDurationMs: 300_000 },
    openAI: { identity: policy.identity, maxInputTokens: policy.maxInputTokens, maxOutputTokens: policy.maxOutputTokens, inputCostUsdMicrosPerMillionTokens: policy.inputCostUsdMicrosPerMillionTokens, outputCostUsdMicrosPerMillionTokens: policy.outputCostUsdMicrosPerMillionTokens },
    credentials: { apiKey: fakeSecret }, authorizer: { authorize: () => false }, requirementsResolver: { resolve: () => null } as any,
    evidenceResolver: { resolve: async () => null }, runtimeContext: { now: () => new Date().toISOString() },
    dependencies: { createOpenAIClient: sdk.fakeOpenAISdk({ generations: [] }).createClient },
  });
  assert.equal(decision.verdict, "allow");
  const runtime = decision.runtime!;
  try {
    const outcome = {
      workspaceId: A.domain, runId: request.run_id, invocationId: `${request.run_id}-invocation`, requestFingerprint: invoked.request_fingerprint,
      status: "succeeded", outcome: "succeeded", finishReason: "stop", inputTokens: invoked.input_tokens, outputTokens: invoked.output_tokens,
      totalTokens: invoked.total_tokens, latencyMs: invoked.latency_ms, costUsdMicros: invoked.cost, errorCode: null,
    } as const;
    const text = planJson();
    assert.deepEqual(await runtime.stateStore.recordModelInvocationOutcome({ ...outcome, stepResult: { outputText: text, outputFingerprint: sha(text) } }), { status: "idempotent" });
    assert.deepEqual(await runtime.stateStore.recordModelInvocationOutcome({ ...outcome, stepResult: { outputText: "{}", outputFingerprint: sha("{}") } }), { status: "conflict" });
    assert.deepEqual(await runtime.stateStore.recordModelInvocationOutcome(outcome), { status: "conflict" }, "a settlement without the stored result is not the same outcome");
    assert.deepEqual(await runtime.stateStore.recordModelInvocationOutcome({ ...outcome, stepResult: { outputText: text, outputFingerprint: sha("forged") } }), { status: "conflict" }, "a forged fingerprint is rejected before SQL");
    assert.deepEqual(await runtime.stateStore.readModelInvocationResult({ runId: request.run_id, invocationId: `${request.run_id}-invocation` }), { status: "succeeded", errorCode: null, outputText: text });
    // Tampering (admin bypasses the immutability trigger) is detected by re-fingerprinting.
    await db.admin.query("alter table workflow_model_invocation_results disable trigger workflow_model_invocation_results_immutable");
    await db.admin.query("update workflow_model_invocation_results set output_text = output_text || ' ' where model_invocation_id = $1", [invoked.id]);
    await db.admin.query("alter table workflow_model_invocation_results enable trigger workflow_model_invocation_results_immutable");
    await assert.rejects(runtime.stateStore.readModelInvocationResult({ runId: request.run_id, invocationId: `${request.run_id}-invocation` }));
    // …and the planning replay of that request fails closed instead of showing a changed candidate.
    assert.deepEqual(await draft(sdk.fakeOpenAISdk({ generations: [] })).submit(form(TASK, MAIN_KEY)), { status: "recovery_required" });
    // Another tenant cannot read this Run's result at all.
    const other = await realProvider.composeRealProviderRuntime({
      database: { connectionString: db.url, maxConnections: 2 }, domainWorkspaceId: B.domain, timing: { providerTimeoutMs: 120_000, claimLeaseDurationMs: 300_000 },
      openAI: { identity: policy.identity, maxInputTokens: policy.maxInputTokens, maxOutputTokens: policy.maxOutputTokens, inputCostUsdMicrosPerMillionTokens: policy.inputCostUsdMicrosPerMillionTokens, outputCostUsdMicrosPerMillionTokens: policy.outputCostUsdMicrosPerMillionTokens },
      credentials: { apiKey: fakeSecret }, authorizer: { authorize: () => false }, requirementsResolver: { resolve: () => null } as any,
      evidenceResolver: { resolve: async () => null }, runtimeContext: { now: () => new Date().toISOString() },
      dependencies: { createOpenAIClient: sdk.fakeOpenAISdk({ generations: [] }).createClient },
    });
    assert.equal(other.verdict, "allow");
    try {
      assert.equal(await other.runtime!.stateStore.readModelInvocationResult({ runId: request.run_id, invocationId: `${request.run_id}-invocation` }), null);
    } finally {
      await other.runtime!.close();
    }
  } finally {
    await runtime.close();
  }
});

test("no credential leaks: the fake API key appears in no table, audit record, decision or outcome", async () => {
  const tables = ["workflow_runs", "workflow_step_runs", "workflow_runtime_commands", "workflow_runtime_executions", "workflow_model_invocations",
    "workflow_model_budget_reservations", "workflow_model_invocation_results", "project_task_planning_requests", "audit_events"];
  for (const table of tables) {
    const dump = (await db.admin.query(`select coalesce(string_agg(row_to_json(t)::text, ''), '') as dump from ${table} as t`)).rows[0].dump as string;
    assert.ok(!dump.includes(fakeSecret), `${table} contains the credential`);
    assert.ok(!/FAKE_OPENAI_SECRET/u.test(dump), `${table} contains a credential fragment`);
  }
  assert.ok(!observed.join("\n").includes(fakeSecret));
  await database.close();
});
