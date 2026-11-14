/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */
// AI-039.1 ledger-backed AI FeaturePlan planning — pure and in-memory guards: the trusted
// `feature_plan_planning` policy parser, the planning Workflow definition, the one-shot Owner egress
// approval and the run-backed PlanningModelPort's outcome classification over a scripted runtime.
// No provider, no network, no database, no spend (the live path is tests/pg/feature-plan-planning).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const config = (await import(new URL("../lib/composition/feature-plan-planner-config.ts", import.meta.url).href)) as typeof import("../lib/composition/feature-plan-planner-config");
const run = (await import(new URL("../lib/development/feature-plan-planning-run.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-planning-run");
const port = (await import(new URL("../lib/composition/owner-feature-plan-planning.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-feature-plan-planning");
const approval = (await import(new URL("../lib/composition/owner-egress-approval.ts", import.meta.url).href)) as typeof import("../lib/composition/owner-egress-approval");
const planner = (await import(new URL("../lib/development/feature-plan-planner.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-planner");
const requests = (await import(new URL("../lib/development/feature-plan-planning-requests.ts", import.meta.url).href)) as typeof import("../lib/development/feature-plan-planning-requests");

const env = Object.freeze({
  PAC_PLANNER_PROVIDER: "openai",
  PAC_PLANNER_MODEL_ID: "gpt-planning-alias",
  PAC_PLANNER_REQUEST_MODEL_ID: "gpt-planning-pinned",
  PAC_PLANNER_MODEL_VERSION: "gpt-planning-pinned-2026-01-01",
  PAC_PLANNER_INPUT_PRICE_USD_MICROS_PER_MILLION: "1000000",
  PAC_PLANNER_OUTPUT_PRICE_USD_MICROS_PER_MILLION: "4000000",
  PAC_PLANNER_PRICES_VERIFIED_ON: "2026-10-01",
  PAC_PLANNER_MAX_INPUT_TOKENS: "6000",
  PAC_PLANNER_MAX_OUTPUT_TOKENS: "4000",
  PAC_PLANNER_MAX_COST_USD_MICROS: "30000",
  PAC_PLANNER_DAILY_TOKEN_BUDGET: "50000",
  PAC_PLANNER_MONTHLY_COST_BUDGET_USD_CENTS: "500",
});
const today = new Date("2026-10-06T12:00:00.000Z");
const policy = config.parseFeaturePlanPlannerPolicy(env, today)!;
const planningKey = "fpp-0123456789abcdef0123";
const ids = run.planningRunIds(planningKey);
const owner = "00000000-0000-4000-8000-000000000001";
const context = { taskId: "task-abc", projectId: "project-a", projectName: "Project A", idempotencyKey: `pl-${"a".repeat(32)}` };
const messages = planner.planningMessages(
  { taskId: "task-abc", projectId: "project-a", type: "feature", title: "Фильтр", goal: null, priority: "P1", riskLevel: "medium" },
  { outcome: "Видеть риск", surface: "unknown", mustNotChange: "", doneWhen: "Готово", constraints: ["none"] } as any,
);
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

test("policy: a complete, bounded configuration is the only way to bind the planner; anything else fails closed", () => {
  assert.ok(policy);
  assert.deepEqual({ ...policy.identity }, {
    providerId: "provider-openai", providerKind: "openai", deploymentId: "deployment-openai-feature-planning",
    providerModelId: "gpt-planning-alias", providerRequestModelId: "gpt-planning-pinned", providerModelVersion: "gpt-planning-pinned-2026-01-01",
  });
  assert.deepEqual([policy.maxInputTokens, policy.maxOutputTokens, policy.maxCostUsdMicros, policy.dailyTokenBudget, policy.monthlyCostBudgetUsdCents, policy.pricesVerifiedOn],
    [6000, 4000, 30000, 50000, 500, "2026-10-01"]);
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.identity));
  assert.ok(!JSON.stringify(policy).match(/key|secret|token"/iu), "the policy carries no credential");
  // Worst case of one call before the per-call ceiling: 6000 × $1/M + 4000 × $4/M = $0.022.
  assert.equal(config.worstCasePlanningCallCostUsdMicros(policy), 22_000);
  const broken: [string, Record<string, string | undefined>][] = [
    ["no provider", { PAC_PLANNER_PROVIDER: undefined }],
    ["other provider", { PAC_PLANNER_PROVIDER: "anthropic" }],
    ["missing model", { PAC_PLANNER_MODEL_ID: undefined }],
    ["unsafe model", { PAC_PLANNER_REQUEST_MODEL_ID: "gpt pinned" }],
    ["model with newline", { PAC_PLANNER_MODEL_VERSION: "a\nb" }],
    ["negative price", { PAC_PLANNER_INPUT_PRICE_USD_MICROS_PER_MILLION: "-1" }],
    ["fraction price", { PAC_PLANNER_OUTPUT_PRICE_USD_MICROS_PER_MILLION: "1.5" }],
    ["huge price", { PAC_PLANNER_OUTPUT_PRICE_USD_MICROS_PER_MILLION: "1000000001" }],
    ["unverified prices", { PAC_PLANNER_PRICES_VERIFIED_ON: undefined }],
    ["future verification", { PAC_PLANNER_PRICES_VERIFIED_ON: "2026-10-07" }],
    ["invalid date", { PAC_PLANNER_PRICES_VERIFIED_ON: "2026-02-30" }],
    ["output above planner bound", { PAC_PLANNER_MAX_OUTPUT_TOKENS: String(planner.plannerLimits.maxOutputTokens + 1) }],
    ["zero output", { PAC_PLANNER_MAX_OUTPUT_TOKENS: "0" }],
    ["input above bound", { PAC_PLANNER_MAX_INPUT_TOKENS: "16001" }],
    ["cost above USD 1", { PAC_PLANNER_MAX_COST_USD_MICROS: "1000001" }],
    ["zero cost", { PAC_PLANNER_MAX_COST_USD_MICROS: "0" }],
    ["no daily budget", { PAC_PLANNER_DAILY_TOKEN_BUDGET: undefined }],
    ["monthly above bound", { PAC_PLANNER_MONTHLY_COST_BUDGET_USD_CENTS: "100001" }],
    ["hex number", { PAC_PLANNER_DAILY_TOKEN_BUDGET: "0x10" }],
    ["daily window cannot hold one call", { PAC_PLANNER_DAILY_TOKEN_BUDGET: "9999" }],
    ["monthly window cannot hold one call", { PAC_PLANNER_MAX_COST_USD_MICROS: "50001", PAC_PLANNER_MONTHLY_COST_BUDGET_USD_CENTS: "5" }],
  ];
  for (const [label, patch] of broken) assert.equal(config.parseFeaturePlanPlannerPolicy({ ...env, ...patch }, today), null, label);
  assert.equal(config.parseFeaturePlanPlannerPolicy(new Proxy(env, { get() { throw new Error("trap"); } }), today), null, "a throwing environment fails closed");
  assert.equal(config.parseFeaturePlanPlannerPolicy({ ...env, PAC_PLANNER_PRICES_VERIFIED_ON: "2026-10-06" }, today)?.pricesVerifiedOn, "2026-10-06", "today is allowed");
  assert.ok(config.parseFeaturePlanPlannerPolicy({ ...env, PAC_PLANNER_DAILY_TOKEN_BUDGET: "10000", PAC_PLANNER_MONTHLY_COST_BUDGET_USD_CENTS: "3" }, today), "windows exactly holding one call are valid");
});

test("planning Run definition: a real single-step Workflow Run accepted by the canonical contract; ids derive from the planning key", () => {
  const state = run.createFeaturePlanPlanningRunState({ workspaceId: "demo", planningKey, project: { projectId: "project-a", displayName: "Project A" }, createdAt: "2026-10-06T12:00:00.000Z", policy })!;
  assert.ok(state, "the canonical Workflow Run contract accepts the planning definition");
  assert.equal(state.snapshot.runId, planningKey);
  assert.equal(state.snapshot.status, "queued");
  assert.equal(state.snapshot.projectId, "project-a");
  assert.deepEqual(state.snapshot.executionProfile.steps.map((step: any) => [step.id, step.kind, step.maxAttempts, step.toolIds.length, step.actionMode]),
    [["feature-plan", "agent_task", 1, 0, "proposal_only"]]);
  assert.deepEqual(state.existingRequests, []);
  assert.equal(state.pause, null);
  // The budget windows of the planning binding come from the trusted policy.
  assert.equal(state.snapshot.executionProfile.budget.dailyTokenBudget, policy.dailyTokenBudget);
  assert.equal(state.snapshot.executionProfile.budget.monthlyCostBudgetUsdCents, policy.monthlyCostBudgetUsdCents);
  // The model registry pins exactly the policy identity, limits and prices; egress needs approval.
  const deployment = (state.modelProviderRegistry as any).deployments[0];
  assert.deepEqual([deployment.providerRequestModelId, deployment.providerModelVersion, deployment.maxInputTokens, deployment.maxOutputTokens,
    deployment.inputCostUsdMicrosPerMillionTokens, deployment.outputCostUsdMicrosPerMillionTokens],
  ["gpt-planning-pinned", "gpt-planning-pinned-2026-01-01", 6000, 4000, 1_000_000, 4_000_000]);
  assert.deepEqual((state.modelProviderRegistry as any).providers[0].supportedDataEgressModes, ["approved_minimum"]);
  assert.equal((state.projectRegistry as any).projects[0].projectManifest.policy.dataEgressMode, "approved_minimum");
  assert.deepEqual({ ...ids }, {
    runId: planningKey, requestId: `${planningKey}-request`, schedulerIdempotencyKey: `${planningKey}-idempotency`, executionId: `${planningKey}-execution`,
    invocationId: `${planningKey}-invocation`, startCommandId: `${planningKey}-start`, advanceCommandId: `${planningKey}-advance`, stepId: "feature-plan",
  });
  for (const bad of ["fpp-0123", "FPP-0123456789abcdef0123", "fpp-0123456789abcdef012g", "plan-0123456789abcdef0123"]) assert.throws(() => run.planningRunIds(bad), bad);
  const command = run.planningAdvanceCommand(planningKey, owner, 1, messages);
  assert.equal(command.agentInputs.length, 1, "exactly one invocation draft");
  assert.deepEqual(command.agentInputs[0].invocationDraft.messages.map((message: any) => message.role), ["system", "user"]);
  assert.deepEqual(command.agentInputs[0].invocationDraft.contextArtifactIds, []);
  const requirements = run.planningRequirementsResolver(policy).resolve();
  assert.deepEqual([requirements.taskClass, requirements.requestedCapability, requirements.requiresRepositoryRead, requirements.requiresRepositoryWrite, requirements.requiresCommandExecution, requirements.requiresNetwork],
    ["planning", "reasoning", false, false, false, false]);
  assert.deepEqual(requirements.budget, { maxInputTokens: 6000, maxOutputTokens: 4000, maxCostUsdMicros: 30000 });
  assert.match(requests.newPlanningKey(), run.planningKeyPattern);
  assert.match(requests.newPlanningFormKey(), requests.planningIdempotencyKeyPattern);
  assert.notEqual(requests.newPlanningFormKey(), requests.newPlanningFormKey());
});

test("egress approval: one-shot, bound to exactly one invocation and identity, latched and never renewed", async () => {
  const resolver = approval.oneShotOwnerEgressApproval({ ownerUserId: owner, workspaceId: "demo", projectId: "project-a", runId: ids.runId, stepId: ids.stepId, invocationId: ids.invocationId, expectedIdentity: policy.identity });
  const request = {
    requirement: "approval_required", workspaceId: "demo", projectId: "project-a", runId: ids.runId, stepId: ids.stepId, invocationId: ids.invocationId,
    runRevision: 1, attemptNumber: 1, modelProfileId: "pac-feature-planning", candidateIdentity: { ...policy.identity }, sourceRequestFingerprint: `sha256:${"b".repeat(64)}`,
    evaluatedAt: "2026-10-06T12:00:00.000Z",
  } as any;
  for (const [label, patch] of [["redaction", { requirement: "redaction_required" }], ["workspace", { workspaceId: "other" }], ["project", { projectId: "project-b" }],
    ["run", { runId: "fpp-ffffffffffffffffffff" }], ["step", { stepId: "other" }], ["invocation", { invocationId: "other" }],
    ["identity", { candidateIdentity: { ...policy.identity, providerModelVersion: "other" } }], ["time", { evaluatedAt: "not-a-time" }]] as const) {
    assert.equal(await resolver.resolve({ ...request, ...patch }), null, label);
  }
  const first = await resolver.resolve(request) as any;
  assert.deepEqual([first.status, first.approvedByActorId, first.approvedByActorKind, first.purpose, first.decidedAt, first.expiresAt, first.reason],
    ["approved", owner, "owner", "model_data_egress", "2026-10-06T12:00:00.000Z", "2026-10-06T12:10:00.000Z", null]);
  assert.ok(Object.isFrozen(first));
  assert.equal(await resolver.resolve({ ...request, evaluatedAt: "2026-10-06T13:00:00.000Z" }), first, "the latch never renews (expiry is judged by the contract)");
  for (const patch of [{ runRevision: 2 }, { attemptNumber: 2 }, { sourceRequestFingerprint: `sha256:${"c".repeat(64)}` }, { modelProfileId: "other" }]) {
    assert.equal(await resolver.resolve({ ...request, ...patch }), null, JSON.stringify(patch));
  }
});

// ---- run-backed port over a scripted runtime and request boundary ----

type Script = Readonly<{
  begin?: any;
  composeFails?: boolean;
  createThrows?: boolean;
  start?: any;
  advance?: any;
  advanceThrows?: boolean;
  facts?: any;
  factsThrows?: boolean;
  lastError?: any;
  settle?: "settled" | "unavailable";
}>;

function scripted(script: Script) {
  const log: string[] = [];
  const settlements: any[] = [];
  const authorizers: any[] = [];
  const begin = script.begin ?? { status: "started", planningKey, projectId: "project-a", ownerUserId: owner, settlement: null };
  const model = port.createRunBackedPlanningModel({
    policy,
    domainWorkspaceId: "demo",
    async withRequests(work) {
      return work({
        async begin(input: any) {
          log.push(`begin:${input.idempotencyKey}:${input.requestFingerprint === port.planningRequestFingerprint(policy, context, messages)}`);
          if (!("planningKey" in begin)) return begin;
          return { ...begin, async settle(value: any) { settlements.push(value); log.push(`settle:${value.outcome}`); return script.settle ?? "settled"; } };
        },
      } as any);
    },
    async composeRuntime(parts) {
      log.push("compose");
      authorizers.push(parts.authorizer);
      if (script.composeFails) return null;
      return {
        service: {
          async start(command: any) { log.push(`start:${command.runId}:${command.actorId === owner}`); return script.start ?? { status: "running", revision: 1 }; },
          async advance(command: any) {
            log.push(`advance:${command.runId}:${command.agentInputs.length}`);
            if (script.advanceThrows) throw new Error("SENTINEL advance");
            return script.advance ?? { status: "completed" };
          },
        } as any,
        stateStore: {
          async create(input: any) { log.push(`create:${input.state.snapshot.runId}`); if (script.createThrows) throw new Error("SENTINEL create"); },
          async load() { log.push("load"); return { snapshot: { stepStates: [{ stepId: "feature-plan", lastError: script.lastError ?? null }] } }; },
          async readModelInvocationResult(input: any) {
            log.push(`read:${input.invocationId}`);
            if (script.factsThrows) throw new Error("SENTINEL read");
            return script.facts === undefined ? { status: "succeeded", errorCode: null, outputText: "{\"plan\":1}" } : script.facts;
          },
        },
        async close() { log.push("close"); },
      };
    },
    now: () => "2026-10-06T12:00:00.000Z",
  });
  return { model, log, settlements, authorizers, complete: () => model.complete({ context, messages, maxOutputTokens: planner.plannerLimits.maxOutputTokens }) };
}

test("run-backed port: begin → create → start → ONE advance → durable result → settle; the authorizer admits only the Owner on this Run", async () => {
  const flow = scripted({});
  assert.deepEqual(await flow.complete(), { status: "completed", outputText: "{\"plan\":1}" });
  assert.deepEqual(flow.log, [`begin:${context.idempotencyKey}:true`, "compose", `create:${planningKey}`, `start:${planningKey}:true`, `advance:${planningKey}:1`,
    `read:${ids.invocationId}`, "close", "settle:completed"]);
  assert.deepEqual(flow.settlements, [{ outcome: "completed", outputFingerprint: sha("{\"plan\":1}") }]);
  const authorize = flow.authorizers[0].authorize;
  assert.equal(authorize({ actorId: owner, runId: planningKey }), true);
  assert.equal(authorize({ actorId: "someone-else", runId: planningKey }), false);
  assert.equal(authorize({ actorId: owner, runId: "fpp-ffffffffffffffffffff" }), false);
  // The request fingerprint binds the exact messages, task, project, identity and ceiling.
  const base = port.planningRequestFingerprint(policy, context, messages);
  assert.match(base, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(port.planningRequestFingerprint(policy, { ...context, taskId: "task-other" }, messages), base);
  assert.notEqual(port.planningRequestFingerprint(policy, context, [messages[0], { ...messages[1], content: `${messages[1].content} ` }]), base);
  assert.notEqual(port.planningRequestFingerprint({ ...policy, identity: { ...policy.identity, providerModelVersion: "x" } }, context, messages), base);
  assert.equal(port.planningRequestFingerprint(policy, { ...context, idempotencyKey: `pl-${"b".repeat(32)}`, projectName: "Renamed" }, messages), base, "the key and display name are not request content");
});

test("run-backed port: every factual runtime outcome maps to exactly one honest settlement; ambiguity is recovery_required", async () => {
  const cases: [string, Script, unknown, string][] = [
    ["budget denied before dispatch", { advance: { status: "failed" }, facts: { status: "failed", errorCode: "generation_not_authorized", outputText: null } }, { status: "budget_denied" }, "budget_denied"],
    ["transient provider failure", { advance: { status: "failed" }, facts: { status: "failed", errorCode: "openai_rate_limited", outputText: null }, lastError: { retryable: true } }, { status: "provider_unavailable" }, "provider_unavailable"],
    ["definitive provider failure", { advance: { status: "failed" }, facts: { status: "failed", errorCode: "openai_request_rejected", outputText: null }, lastError: { retryable: false } }, { status: "failed" }, "planning_failed"],
    ["outcome unknown", { advance: { status: "recovery_required" }, facts: { status: "outcome_unknown", errorCode: "provider_exception", outputText: null } }, { status: "recovery_required" }, "recovery_required"],
    ["invocation still running", { advance: { status: "denied" }, facts: { status: "running", errorCode: null, outputText: null } }, { status: "recovery_required" }, "recovery_required"],
    ["runtime recovery without invocation", { advance: { status: "recovery_required" }, facts: null }, { status: "recovery_required" }, "recovery_required"],
    ["paid result but Run not completed", { advance: { status: "denied" }, facts: { status: "succeeded", errorCode: null, outputText: "{}" } }, { status: "recovery_required" }, "recovery_required"],
    ["completed without output text", { advance: { status: "completed" }, facts: { status: "succeeded", errorCode: null, outputText: null } }, { status: "failed" }, "planning_failed"],
    ["denied before the ledger", { advance: { status: "failed" }, facts: null }, { status: "failed" }, "planning_failed"],
    ["advance throws", { advanceThrows: true }, { status: "recovery_required" }, "recovery_required"],
    ["result read throws after advance", { factsThrows: true }, { status: "recovery_required" }, "recovery_required"],
    ["create throws (nothing dispatched)", { createThrows: true }, { status: "failed" }, "planning_failed"],
    ["start not running (nothing dispatched)", { start: { status: "denied", revision: null } }, { status: "failed" }, "planning_failed"],
    ["runtime not composable", { composeFails: true }, { status: "failed" }, "planning_failed"],
  ];
  for (const [label, script, expected, settled] of cases) {
    const flow = scripted(script);
    assert.deepEqual(await flow.complete(), expected, label);
    assert.deepEqual(flow.settlements.map((value) => value.outcome), [settled], `${label}: settled once`);
    assert.ok(flow.log.filter((entry) => entry.startsWith("advance")).length <= 1, `${label}: at most one advance`);
    if (!script.composeFails) assert.equal(flow.log.filter((entry) => entry === "close").length, 1, `${label}: runtime closed`);
  }
  // A completed run whose settlement cannot be recorded is not reported as success.
  assert.deepEqual(await scripted({ settle: "unavailable" }).complete(), { status: "recovery_required" });
  // The policy ceiling must fit the planner's bound.
  const tight = scripted({});
  assert.deepEqual(await tight.model.complete({ context, messages, maxOutputTokens: policy.maxOutputTokens - 1 }), { status: "unavailable" });
  assert.deepEqual(tight.log, [], "nothing begins");
});

test("run-backed port: replay never dispatches again; boundary refusals pass through; a project mismatch fails before any Run", async () => {
  const replay = (settlement: unknown, facts?: unknown) => scripted({ begin: { status: "replayed", planningKey, projectId: "project-a", ownerUserId: owner, settlement }, facts });
  for (const [settlement, expected] of [
    [null, { status: "recovery_required" }],
    [{ outcome: "recovery_required", outputFingerprint: null }, { status: "recovery_required" }],
    [{ outcome: "budget_denied", outputFingerprint: null }, { status: "budget_denied" }],
    [{ outcome: "provider_unavailable", outputFingerprint: null }, { status: "provider_unavailable" }],
    [{ outcome: "planning_failed", outputFingerprint: null }, { status: "failed" }],
  ] as const) {
    const flow = replay(settlement);
    assert.deepEqual(await flow.complete(), expected, JSON.stringify(settlement));
    assert.ok(!flow.log.some((entry) => /^(create|start|advance|compose)/u.test(entry)), "no runtime work on replay");
  }
  // A settled completion re-reads the durable result (read-only composition: the authorizer denies all).
  const completed = replay({ outcome: "completed", outputFingerprint: sha("{\"plan\":1}") });
  assert.deepEqual(await completed.complete(), { status: "completed", outputText: "{\"plan\":1}" });
  assert.deepEqual(completed.log.filter((entry) => !entry.startsWith("begin")), ["compose", `read:${ids.invocationId}`, "close"]);
  assert.equal(completed.authorizers[0].authorize({ actorId: owner, runId: planningKey }), false);
  assert.deepEqual(await replay({ outcome: "completed", outputFingerprint: sha("other") }).complete(), { status: "recovery_required" }, "a durable result that does not match the settlement fails closed");
  assert.deepEqual(await replay({ outcome: "completed", outputFingerprint: sha("{}") }, { status: "failed", errorCode: "x", outputText: null }).complete(), { status: "recovery_required" });
  for (const [status, expected] of [["conflict", "conflict"], ["not_plannable", "not_plannable"], ["unauthenticated", "unauthenticated"], ["unavailable", "failed"], ["invalid_input", "failed"]]) {
    const flow = scripted({ begin: { status } });
    assert.deepEqual(await flow.complete(), { status: expected }, status);
    assert.ok(!flow.log.some((entry) => /^(compose|create|advance)/u.test(entry)), `${status}: no runtime work`);
  }
  const mismatch = scripted({ begin: { status: "started", planningKey, projectId: "project-other", ownerUserId: owner, settlement: null } });
  assert.deepEqual(await mismatch.complete(), { status: "failed" });
  assert.deepEqual(mismatch.settlements.map((value) => value.outcome), ["planning_failed"]);
  assert.ok(!mismatch.log.some((entry) => /^(compose|create|advance)/u.test(entry)));
});
