/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: M2.1 real-provider simulation. The REAL composition root, runtime service,
// store, budget ledger and OpenAI adapter run against this database; only the OpenAI SDK client
// below the adapter is a deterministic in-memory fake (no network, no key, no spend).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const live = (await import(
  new URL("./helpers/live-pg.ts", import.meta.url).href
)) as typeof import("./helpers/live-pg");
const sdk = (await import(
  new URL("./helpers/fake-openai-sdk.ts", import.meta.url).href
)) as typeof import("./helpers/fake-openai-sdk");
const composition = (await import(
  new URL("../../lib/composition/real-provider-runtime.ts", import.meta.url).href
)) as typeof import("../../lib/composition/real-provider-runtime");
const smoke = (await import(
  new URL("../../lib/composition/real-provider-smoke.ts", import.meta.url).href
)) as typeof import("../../lib/composition/real-provider-smoke");

const db = await live.useLiveDatabase("realprovider");
await live.insertWorkspace(db.admin, live.primaryWorkspace);

const fakeSecret = `FAKE_OPENAI_SECRET_DO_NOT_LEAK_${process.pid}_m21`;
const ownerId = "owner-m2";
const workspaceId = live.primaryWorkspace.domain;
const promptText = "Reply with the single word OK.";
// Everything a scenario serialized (decisions, evidence, audit rows, signals) for the leak scan.
const observed: string[] = [];
let runSequence = 0;

type Timing = Readonly<{ providerTimeoutMs: number; claimLeaseDurationMs: number }>;

async function compose(
  fake: ReturnType<typeof sdk.fakeOpenAISdk>,
  timing: Timing,
  options: Readonly<{ now?: () => string; observeEvidence?: (evidence: unknown) => void }> = {},
) {
  runSequence += 1;
  const runId = `m2-run-${runSequence}`;
  const approval = smoke.realProviderSmokeEgressApproval({
    ownerId, runId, expectedIdentity: sdk.fakeModel.identity, attemptLabels: [undefined, "retry"],
  });
  const decision = await composition.composeRealProviderRuntime({
    database: { connectionString: db.url, maxConnections: 4 },
    domainWorkspaceId: workspaceId,
    timing,
    openAI: sdk.fakeModel,
    credentials: { apiKey: fakeSecret },
    authorizer: smoke.realProviderSmokeAuthorizer(ownerId),
    requirementsResolver: smoke.realProviderSmokeRequirementsResolver,
    // The first attempt and one separately named retry attempt are egress-approved.
    evidenceResolver: {
      async resolve(input: any) {
        const evidence = await approval.resolve(input);
        options.observeEvidence?.(evidence);
        return evidence;
      },
    },
    runtimeContext: { now: options.now ?? (() => new Date().toISOString()) },
    dependencies: { createOpenAIClient: fake.createClient },
  });
  observed.push(JSON.stringify(decision));
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  return { runtime: decision.runtime!, runId };
}

async function invocationRow(invocationId: string) {
  return (await db.admin.query(`select status, outcome, finish_reason, input_tokens::int as input_tokens,
      output_tokens::int as output_tokens, total_tokens::int as total_tokens, cost_usd_micros::int as cost,
      latency_ms::int as latency_ms, error_code, provider_id, deployment_id, provider_model_id,
      provider_request_model_id, provider_model_version
    from workflow_model_invocations where invocation_id = $1`, [invocationId])).rows[0] ?? null;
}

async function budgetRow(invocationId: string) {
  return (await db.admin.query(`select budget.status, budget.reserved_total_tokens::int as reserved_tokens,
      budget.reserved_cost_usd_micros::int as reserved_cost, budget.actual_total_tokens::int as actual_tokens,
      budget.actual_cost_usd_micros::int as actual_cost
    from workflow_model_budget_reservations as budget
    join workflow_model_invocations as invocation on invocation.id = budget.model_invocation_id
    where invocation.invocation_id = $1`, [invocationId])).rows[0] ?? null;
}

// The authoritative Run revision for a follow-up command (the Owner overview intentionally denies
// an AI-037.1 state in which a succeeded invocation sits next to an outcome_unknown execution).
async function runRevision(runId: string): Promise<number> {
  return (await db.admin.query("select revision::int as revision from workflow_runs where runtime_id = $1", [runId])).rows[0].revision;
}

async function executionStatus(executionId: string) {
  return (await db.admin.query("select status from workflow_runtime_executions where execution_id = $1",
    [executionId])).rows[0]?.status ?? null;
}

// Consumed/reserved totals of the smoke Project's aggregate windows (shared across scenarios).
async function windows() {
  const rows = (await db.admin.query(`select window_kind, sum(reserved_amount)::bigint::int as reserved,
      sum(consumed_amount)::bigint::int as consumed
    from workflow_model_budget_windows where project_id = 'm2-smoke-project' group by window_kind`)).rows;
  const byKind = Object.fromEntries(rows.map((row: any) => [row.window_kind, row]));
  return {
    reservedTokens: byKind.daily_tokens?.reserved ?? 0, consumedTokens: byKind.daily_tokens?.consumed ?? 0,
    reservedCost: byKind.monthly_cost?.reserved ?? 0, consumedCost: byKind.monthly_cost?.consumed ?? 0,
  };
}

const casFailure = "do $$ begin raise exception 'm2 live-test serialization failure' using errcode = '40001'; end $$";

type ScenarioOptions = Readonly<{
  generations?: readonly import("./helpers/fake-openai-sdk").FakeGeneration[];
  inputTokenCount?: number;
  countDelayMs?: number;
  timing?: Timing;
  loseFinalCas?: boolean;
  failStatementTag?: string;
  loseCommitAfterTag?: string;
  dropCommitAfterTag?: string;
  holdInvocationLockMs?: number;
  retry?: boolean;
}>;

// One composed runtime, one supervised attempt (the runner's exact path), optional DB faults, and an
// optional ordinary retry advance for a separately approved attempt.
async function scenario(options: ScenarioOptions = {}) {
  const fake = sdk.fakeOpenAISdk({
    generations: options.generations ?? [{ response: sdk.completedResponse() }, { response: sdk.completedResponse() }],
    ...(options.inputTokenCount === undefined ? {} : { inputTokenCount: options.inputTokenCount }),
    ...(options.countDelayMs === undefined ? {} : { countDelayMs: options.countDelayMs }),
  });
  const { runtime, runId } = await compose(fake, options.timing ?? { providerTimeoutMs: 20_000, claimLeaseDurationMs: 300_000 });
  const ids = smoke.realProviderSmokeIds(runId);
  const retryIds = smoke.realProviderSmokeIds(runId, "retry");
  const windowsBefore = await windows();
  const interceptor = live.installQueryInterceptor();
  const fired: string[] = [];
  const lockHolder = live.adminClient(db.url);
  await lockHolder.connect();
  let lockReleased: Promise<unknown> = Promise.resolve();
  try {
    if (options.loseFinalCas) {
      interceptor.rules.push(live.rule("final CAS fails (40001) after dispatch",
        (text) => fake.calls.creates > 0 && text.includes("/* workflow-runtime:update-run */"),
        (_client, _config, _values, send) => { fired.push("cas"); return send(casFailure); }));
    }
    if (options.failStatementTag) {
      const tag = options.failStatementTag;
      interceptor.rules.push(live.rule(`statement ${tag} fails (40001)`, live.sqlTag(tag),
        (_client, _config, _values, send) => { fired.push(tag); return send(casFailure); }));
    }
    if (options.loseCommitAfterTag) {
      const armed = { on: false };
      const tag = options.loseCommitAfterTag;
      // Armed by the first matching statement AFTER the provider call (update-run also runs at start).
      interceptor.observe((text) => { if (fake.calls.creates > 0 && text.includes(`/* ${tag} */`)) armed.on = true; });
      interceptor.rules.push(live.rule(`lose the COMMIT acknowledgement after ${tag}`,
        (text) => armed.on && /^\s*commit\s*$/iu.test(text),
        async (_client, config, values, send) => {
          armed.on = false;
          await send(config, values);
          fired.push("commit-ack");
          throw new Error("Connection terminated unexpectedly");
        }));
    }
    if (options.dropCommitAfterTag) {
      const armed = { on: false };
      const tag = options.dropCommitAfterTag;
      // Armed by the first matching statement AFTER the provider call (update-run also runs at start).
      interceptor.observe((text) => { if (fake.calls.creates > 0 && text.includes(`/* ${tag} */`)) armed.on = true; });
      interceptor.rules.push(live.rule(`connection lost before the COMMIT after ${tag} is sent`,
        (text) => armed.on && /^\s*commit\s*$/iu.test(text),
        async () => {
          armed.on = false;
          fired.push("commit-dropped");
          throw new Error("Connection terminated unexpectedly");
        }));
    }
    if (options.holdInvocationLockMs) {
      interceptor.rules.push(live.rule("hold the invocation row lock during the provider-start fence",
        live.sqlTag("workflow-runtime:read-execution"), async (_client, config, values, send) => {
          const result = await send(config, values);
          if (fired.includes("lock")) return result;
          fired.push("lock");
          await lockHolder.query("begin");
          await lockHolder.query("select 1 from workflow_model_invocations where invocation_id = $1 for update",
            [ids.invocationId]);
          lockReleased = live.sleep(options.holdInvocationLockMs!).then(() => lockHolder.query("commit"));
          return result;
        }));
    }
    const first = await smoke.runRealProviderSmokeAttempt(runtime, {
      workspaceId, runId, ownerId, model: sdk.fakeModel, now: new Date().toISOString(),
    });
    interceptor.restore();
    await lockReleased;
    const afterFirst = {
      invocation: await invocationRow(ids.invocationId),
      budget: await budgetRow(ids.invocationId),
      execution: await executionStatus(ids.executionId),
      windows: await windows(),
      creates: fake.calls.creates,
      counts: fake.calls.counts,
      signals: runtime.signals(),
    };
    let retry: { status: string; reasons: string[] } | null = null;
    if (options.retry) {
      const revision = await runRevision(runId);
      const response = await runtime.service.advance(smoke.realProviderSmokeAdvanceCommand(runId, ownerId, revision, "retry"));
      retry = { status: response.status, reasons: response.reasons.map((reason) => reason.code) };
      observed.push(JSON.stringify(response));
    }
    const result = {
      runId, ids, retryIds, first, afterFirst, retry, fired, windowsBefore,
      windowsAfter: await windows(),
      creates: fake.calls.creates,
      calls: fake.calls,
      unexpected: fake.calls.unexpected,
      clientOptions: fake.calls.clientOptions,
      createInputs: fake.calls.createInputs,
      signals: runtime.signals(),
      runtime,
    };
    observed.push(JSON.stringify({ first, afterFirst, retry, signals: result.signals }));
    return result;
  } finally {
    interceptor.restore();
    await lockReleased.catch(() => {});
    await lockHolder.end().catch(() => {});
  }
}

const noSignals = {
  db_failure: 0, db_session_destroyed: 0, recovery_required: 0, outcome_unknown: 0, ambiguous_commit: 0, provider_redispatch: 0,
};
const successCost = sdk.expectedCostUsdMicros(sdk.fakeUsage.inputTokens, sdk.fakeUsage.outputTokens);
const successTokens = sdk.fakeUsage.inputTokens + sdk.fakeUsage.outputTokens;

test("M2.0 composed runtime: construction makes zero SDK calls, one collector receives adapter, store and service signals, close() is idempotent", async () => {
  const fake = sdk.fakeOpenAISdk();
  const { runtime } = await compose(fake, { providerTimeoutMs: 20_000, claimLeaseDurationMs: 300_000 });
  assert.equal(fake.calls.clientOptions.length, 1, "one client, built at composition");
  assert.equal(fake.calls.counts + fake.calls.creates + fake.calls.unexpected, 0, "construction performs no model call");
  assert.deepEqual(runtime.signals(), noSignals);
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(JSON.stringify(Object.keys(runtime)).includes("apiKey"), false);
  await runtime.close();
  await runtime.close();
  // One snapshot, three owners: a lost final CAS after success yields db_failure (adapter),
  // outcome_unknown (store) and recovery_required (service) in the same collector.
  const r = await scenario({ loseFinalCas: true, retry: true });
  try {
    assert.equal(r.signals.db_failure, 1);
    assert.equal(r.signals.outcome_unknown, 1);
    assert.equal(r.signals.recovery_required, 1);
  } finally {
    await r.runtime.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Success path, token-count match, usage/cost/budget/identity, audit, signals.
// ---------------------------------------------------------------------------------------------

test("M2.1 success: composed runtime, real adapter, live PG — one generation with exact usage, cost, budget, identity, audit", async () => {
  const r = await scenario();
  try {
    assert.equal(r.first.status, "completed", JSON.stringify(r.first));
    // SDK boundary: exact client options from the trusted timing; one count, one create.
    assert.deepEqual(r.clientOptions, [{ apiKey: fakeSecret, maxRetries: 0, timeout: 20_000, logLevel: "off" }]);
    assert.equal(r.runtime.timing.providerTimeoutMs, 20_000);
    assert.equal(r.runtime.stateStore.claimLeaseDurationMs, r.runtime.timing.claimLeaseDurationMs);
    assert.equal(r.afterFirst.counts, 1);
    assert.equal(r.creates, 1);
    assert.equal(r.unexpected, 0, "no unexpected SDK path (models.retrieve / extra generation)");
    // The generation request pins the provider request model and the tiny output ceiling.
    assert.equal(r.createInputs[0].model, sdk.fakeModel.identity.providerRequestModelId);
    assert.equal(r.createInputs[0].max_output_tokens, smoke.realProviderSmokeLimits.maxOutputTokens);
    assert.equal(r.createInputs[0].store, false);
    // Token count MATCH: reported input tokens equal the preflight count.
    const invocation = r.afterFirst.invocation;
    assert.equal(invocation.status, "succeeded");
    assert.equal(invocation.outcome, "succeeded");
    assert.equal(invocation.finish_reason, "stop");
    assert.equal(invocation.input_tokens, sdk.fakeUsage.inputTokens);
    assert.equal(invocation.output_tokens, sdk.fakeUsage.outputTokens);
    assert.equal(invocation.total_tokens, successTokens);
    assert.equal(invocation.cost, successCost, "cost = ceil((21 * 150000 + 3 * 600000) / 1e6)");
    assert.ok(invocation.latency_ms >= 0, "latency recorded");
    assert.deepEqual(
      [invocation.provider_id, invocation.deployment_id, invocation.provider_model_id,
        invocation.provider_request_model_id, invocation.provider_model_version],
      [sdk.fakeModel.identity.providerId, sdk.fakeModel.identity.deploymentId, sdk.fakeModel.identity.providerModelId,
        sdk.fakeModel.identity.providerRequestModelId, sdk.fakeModel.identity.providerModelVersion],
    );
    // Budget: reserved from the preflight worst case, settled once to the actual usage.
    assert.equal(r.afterFirst.budget.status, "settled");
    assert.equal(r.afterFirst.budget.reserved_tokens, sdk.fakeUsage.inputTokens + smoke.realProviderSmokeLimits.maxOutputTokens);
    assert.equal(r.afterFirst.budget.actual_tokens, successTokens);
    assert.equal(r.afterFirst.budget.actual_cost, successCost);
    assert.equal(r.windowsAfter.consumedTokens - r.windowsBefore.consumedTokens, successTokens);
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, successCost);
    assert.equal(r.windowsAfter.reservedTokens - r.windowsBefore.reservedTokens, 0, "no reservation left open");
    // Run/Step terminal success; sanitized evidence.
    const evidence = r.first.evidence;
    assert.equal(evidence.runStatus, "completed");
    assert.equal(evidence.executionStatus, "completed");
    assert.equal(evidence.budgetStatus, "settled");
    assert.deepEqual(evidence.usage, {
      inputTokens: sdk.fakeUsage.inputTokens, outputTokens: sdk.fakeUsage.outputTokens, totalTokens: successTokens,
      costUsdMicros: successCost, invocationCount: 1,
    });
    assert.equal(evidence.invocation?.providerRequestModelId, sdk.fakeModel.identity.providerRequestModelId);
    assert.deepEqual([...evidence.auditEvents].sort(), [
      "workflow.run_created", "workflow.run_started",
      "workflow.step_model_invocation_completed", "workflow.step_model_invocation_started",
    ]);
    assert.deepEqual(r.signals, noSignals, "no failure, recovery or redispatch");
    const audit = (await db.admin.query("select metadata from audit_events where runtime_run_id = $1", [r.runId])).rows;
    observed.push(JSON.stringify(audit));
    const auditText = JSON.stringify(audit);
    assert.equal(auditText.includes(promptText), false, "no prompt in audit");
    assert.equal(auditText.includes(fakeSecret), false, "no key in audit");
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 token count MISMATCH: reported input tokens differ from preflight → outcome_unknown, no usage fabricated, no automatic redispatch", async () => {
  const mismatched = sdk.completedResponse({
    usage: { input_tokens: sdk.fakeUsage.inputTokens + 1, output_tokens: 3, total_tokens: sdk.fakeUsage.inputTokens + 4 },
  });
  const r = await scenario({ generations: [{ response: mismatched }, { response: sdk.completedResponse() }], retry: true });
  try {
    assert.equal(r.first.status, "stopped");
    assert.equal(r.first.responseStatus, "recovery_required");
    assert.equal(r.creates, 1, "the retry never reached the SDK");
    assert.equal(r.afterFirst.invocation.status, "outcome_unknown");
    assert.equal(r.afterFirst.invocation.outcome, null);
    assert.equal(r.afterFirst.invocation.total_tokens, null, "no invented usage");
    assert.equal(r.afterFirst.invocation.cost, null, "no invented cost");
    assert.equal(r.afterFirst.budget.status, "outcome_unknown", "the reservation is held, not released or settled");
    assert.equal(r.afterFirst.execution, "outcome_unknown");
    assert.equal(r.retry?.status, "recovery_required");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, 0);
    assert.equal(r.signals.outcome_unknown, 1);
    assert.equal(r.signals.recovery_required, 2);
    assert.equal(r.signals.provider_redispatch, 0);
  } finally {
    await r.runtime.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Paid content_filter (refusal) — normal persistence and lost persistence (AI-037.1.2).
// ---------------------------------------------------------------------------------------------

test("M2.1 paid content_filter + normal persistence: failed, settled once, terminal failed Run, one dispatch, no recovery incident", async () => {
  const r = await scenario({ generations: [{ response: sdk.refusalResponse() }], retry: true });
  try {
    assert.equal(r.first.responseStatus, "failed");
    assert.equal(r.afterFirst.invocation.status, "failed");
    assert.equal(r.afterFirst.invocation.outcome, "failed");
    assert.equal(r.afterFirst.invocation.finish_reason, "content_filter");
    assert.equal(r.afterFirst.invocation.total_tokens, successTokens);
    assert.equal(r.afterFirst.invocation.cost, successCost, "the refusal was billed");
    assert.equal(r.afterFirst.budget.status, "settled");
    assert.equal(r.afterFirst.execution, "failed");
    assert.equal(r.first.evidence.runStatus, "failed");
    assert.equal(r.retry?.status, "failed");
    assert.ok(r.retry?.reasons.includes("terminal_run"));
    assert.equal(r.creates, 1);
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, successCost);
    assert.equal(r.signals.recovery_required, 0);
    assert.equal(r.signals.outcome_unknown, 0);
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 paid content_filter + lost final persistence: AI-037.1.2 holds — outcome_unknown, recovery_required, spend once, no redispatch", async () => {
  const r = await scenario({ generations: [{ response: sdk.refusalResponse() }, { response: sdk.completedResponse() }], loseFinalCas: true, retry: true });
  try {
    assert.ok(r.fired.includes("cas"));
    assert.equal(r.first.responseStatus, "denied");
    assert.ok(r.first.responseReasons.includes("state_store_failed"));
    assert.equal(r.afterFirst.invocation.status, "failed");
    assert.equal(r.afterFirst.invocation.cost, successCost);
    assert.equal(r.afterFirst.budget.status, "settled");
    assert.equal(r.afterFirst.execution, "outcome_unknown");
    assert.equal(r.retry?.status, "recovery_required");
    assert.equal(r.creates, 1, "no automatic second paid call");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, successCost, "spend accounted once");
    assert.equal(r.signals.outcome_unknown, 1);
    assert.equal(r.signals.db_failure, 1);
    assert.equal(r.signals.provider_redispatch, 0);
  } finally {
    await r.runtime.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Definitive provider error matrix (real adapter classification).
// ---------------------------------------------------------------------------------------------

const definitiveErrors = [
  ["400 bad request", sdk.sdkErrors.badRequest400, "openai_request_rejected"],
  ["401 authentication", sdk.sdkErrors.auth401, "openai_request_rejected"],
  ["403 permission", sdk.sdkErrors.permission403, "openai_request_rejected"],
  ["404 not found", sdk.sdkErrors.notFound404, "openai_request_rejected"],
  ["422 unprocessable", sdk.sdkErrors.unprocessable422, "openai_request_rejected"],
  ["429 rate limit", sdk.sdkErrors.rateLimit429, "openai_rate_limited"],
] as const;
const definitiveMatrix: Record<string, unknown>[] = [];

for (const [name, error, code] of definitiveErrors) {
  test(`M2.1 definitive FREE failure ${name}: 0 tokens / 0 cost, reservation released; after lost persistence an ordinary retry is allowed`, async () => {
    const r = await scenario({ generations: [{ error }, { response: sdk.completedResponse() }], loseFinalCas: true, retry: true });
    try {
      const row = r.afterFirst.invocation;
      definitiveMatrix.push({
        case: name, adapterOutcome: row.outcome, errorCode: row.error_code, tokens: row.total_tokens, cost: row.cost,
        budget: r.afterFirst.budget.status, execution: r.afterFirst.execution, retry: r.retry?.status, dispatches: r.creates,
        recoveryRequiredSignals: r.signals.recovery_required,
      });
      assert.equal(row.status, "failed");
      assert.equal(row.outcome, "failed");
      assert.equal(row.error_code, code);
      assert.equal(row.total_tokens, 0);
      assert.equal(row.cost, 0);
      assert.equal(r.afterFirst.budget.status, "released", "no actual spend; reservation released");
      assert.equal(r.afterFirst.windows.consumedCost - r.windowsBefore.consumedCost, 0);
      assert.equal(r.afterFirst.execution, "failed", "not a false paid-failure recovery incident");
      assert.equal(r.afterFirst.signals.outcome_unknown, 0);
      assert.equal(r.retry?.status, "completed", "ordinary retry semantics remain");
      assert.equal(r.creates, 2);
    } finally {
      await r.runtime.close();
    }
  });
}

test("M2.1 definitive 429 with normal persistence: single-attempt smoke Step ends in terminal failed Run, one dispatch", async () => {
  const r = await scenario({ generations: [{ error: sdk.sdkErrors.rateLimit429 }], retry: true });
  try {
    assert.equal(r.first.responseStatus, "failed");
    assert.equal(r.first.evidence.runStatus, "failed");
    assert.equal(r.afterFirst.budget.status, "released");
    assert.equal(r.retry?.status, "failed");
    assert.equal(r.creates, 1);
    assert.equal(r.signals.recovery_required, 0);
  } finally {
    await r.runtime.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Ambiguous provider failures and malformed / hostile responses: fail closed, no redispatch.
// ---------------------------------------------------------------------------------------------

function withoutUsage() {
  const response: any = sdk.completedResponse();
  delete response.usage;
  return response;
}

const ambiguous: ReadonlyArray<readonly [string, import("./helpers/fake-openai-sdk").FakeGeneration]> = [
  ["timeout", { error: sdk.sdkErrors.timeout }],
  ["connection failure", { error: sdk.sdkErrors.connection }],
  ["500 internal error", { error: sdk.sdkErrors.server500 }],
  ["503 service unavailable", { error: sdk.sdkErrors.server503 }],
  ["unknown / unmapped error", { error: sdk.sdkErrors.unknown }],
  ["unsupported response status", { response: sdk.completedResponse({ status: "in_progress" }) }],
  ["response error state", { response: sdk.completedResponse({ error: { code: "server_error" } }) }],
  ["missing usage", { response: withoutUsage() }],
  ["token arithmetic mismatch", { response: sdk.completedResponse({ usage: { input_tokens: 21, output_tokens: 3, total_tokens: 25 } }) }],
  ["output tokens above the authorized ceiling", { response: sdk.completedResponse({ usage: { input_tokens: 21, output_tokens: 17, total_tokens: 38 } }) }],
  ["response model identity mismatch", { response: sdk.completedResponse({ model: "gpt-substituted-model" }) }],
  ["malformed output", { response: sdk.completedResponse({ output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "image", url: "x" }] }] }) }],
  ["incompatible incomplete_details", { response: sdk.completedResponse({ incomplete_details: { reason: "max_output_tokens" } }) }],
  ["non-object response", { response: "not a response" }],
];
const ambiguousMatrix: Record<string, unknown>[] = [];

for (const [name, generation] of ambiguous) {
  test(`M2.1 fail-closed ${name}: outcome_unknown, reservation held, no invented usage, ordinary retry blocked, one dispatch`, async () => {
    const r = await scenario({ generations: [generation, { response: sdk.completedResponse() }], retry: true });
    try {
      ambiguousMatrix.push({
        case: name, invocation: r.afterFirst.invocation.status, budget: r.afterFirst.budget.status,
        execution: r.afterFirst.execution, retry: r.retry?.status, dispatches: r.creates,
      });
      assert.equal(r.first.responseStatus, "recovery_required", JSON.stringify(r.first));
      assert.equal(r.afterFirst.invocation.status, "outcome_unknown");
      assert.equal(r.afterFirst.invocation.outcome, null);
      assert.equal(r.afterFirst.invocation.total_tokens, null);
      assert.equal(r.afterFirst.invocation.cost, null);
      assert.equal(r.afterFirst.budget.status, "outcome_unknown");
      assert.equal(r.afterFirst.execution, "outcome_unknown");
      assert.equal(r.retry?.status, "recovery_required");
      assert.equal(r.creates, 1, "no second provider call");
      assert.equal(r.signals.outcome_unknown, 1);
      assert.equal(r.signals.provider_redispatch, 0);
    } finally {
      await r.runtime.close();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Persistence failures around the provider call.
// ---------------------------------------------------------------------------------------------

test("M2.1 persistence A: provider success + lost final CAS → outcome_unknown, blocked, spend once (AI-037.1)", async () => {
  const r = await scenario({ loseFinalCas: true, retry: true });
  try {
    assert.ok(r.fired.includes("cas"));
    assert.equal(r.afterFirst.invocation.status, "succeeded");
    assert.equal(r.afterFirst.budget.status, "settled");
    assert.equal(r.afterFirst.execution, "outcome_unknown");
    assert.equal(r.retry?.status, "recovery_required", JSON.stringify(r.retry));
    // Existing read-model rule (240c920): the Owner overview refuses to present a succeeded ledger
    // next to an unresolved execution; the runner's evidence therefore comes from recovery inspection.
    assert.deepEqual(await r.runtime.readModel.getRunOverview(r.runId), { verdict: "deny", reason: "inconsistent_state", data: null });
    assert.equal(r.first.evidence.runStatus, null);
    assert.equal(r.first.evidence.executionStatus, "outcome_unknown");
    assert.equal(r.first.evidence.budgetStatus, "settled");
    assert.equal(r.first.evidence.recoveryEligible, true);
    assert.equal(r.creates, 1);
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, successCost);
    assert.equal(r.signals.outcome_unknown, 1);
    assert.equal(r.signals.db_failure, 1);
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 persistence C1: lost COMMIT acknowledgement of the recorded provider outcome is reconciled from durable state, never re-sent", async () => {
  const r = await scenario({ loseCommitAfterTag: "workflow-runtime:complete-model-invocation", retry: true });
  try {
    assert.ok(r.fired.includes("commit-ack"));
    assert.equal(r.signals.ambiguous_commit, 1);
    assert.ok(r.signals.db_session_destroyed >= 1, "the ambiguous session is discarded");
    // The COMMIT had landed; the store reconciles the exact recorded outcome and the Step completes.
    assert.equal(r.first.responseStatus, "completed", JSON.stringify(r.first));
    assert.equal(r.afterFirst.invocation.status, "succeeded");
    assert.equal(r.afterFirst.budget.status, "settled");
    assert.equal(r.creates, 1, "the provider was not called again");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, successCost, "charged once");
    assert.ok(r.retry?.reasons.includes("terminal_run"), JSON.stringify(r.retry));
    assert.equal(r.signals.provider_redispatch, 0);
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 persistence C2: lost COMMIT acknowledgement of the final Run CAS (COMMIT landed) is reconciled, never re-sent", async () => {
  const r = await scenario({ loseCommitAfterTag: "workflow-runtime:update-run", retry: true });
  try {
    assert.ok(r.fired.includes("commit-ack"));
    assert.equal(r.signals.ambiguous_commit, 1);
    assert.equal(r.first.responseStatus, "completed", JSON.stringify(r.first));
    assert.equal(r.afterFirst.invocation.status, "succeeded");
    assert.equal(r.afterFirst.budget.status, "settled");
    assert.ok(r.retry?.reasons.includes("terminal_run"), JSON.stringify(r.retry));
    assert.equal(r.calls.creates, 1, "no second provider call");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, successCost, "charged once");
    assert.equal(r.signals.provider_redispatch, 0);
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 persistence C3: connection lost before the final Run CAS COMMIT (COMMIT never landed) → outcome_unknown, blocked, no redispatch", async () => {
  const r = await scenario({ dropCommitAfterTag: "workflow-runtime:update-run", retry: true });
  try {
    assert.ok(r.fired.includes("commit-dropped"));
    assert.equal(r.signals.ambiguous_commit, 1);
    assert.notEqual(r.first.responseStatus, "completed", JSON.stringify(r.first));
    assert.equal(r.afterFirst.invocation.status, "succeeded");
    assert.equal(r.afterFirst.budget.status, "settled");
    assert.equal(r.afterFirst.execution, "outcome_unknown");
    assert.equal(r.retry?.status, "recovery_required", JSON.stringify(r.retry));
    assert.equal(r.calls.creates, 1, "no second provider call");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, successCost, "charged once");
    assert.equal(r.signals.provider_redispatch, 0);
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 persistence D: DB failure before provider-start authority (invocation reservation) → no preflight spend, no dispatch", async () => {
  const r = await scenario({ failStatementTag: "workflow-runtime:reserve-model-invocation" });
  try {
    assert.ok(r.fired.includes("workflow-runtime:reserve-model-invocation"));
    assert.equal(r.afterFirst.counts, 0, "no token count");
    assert.equal(r.creates, 0, "no generation");
    assert.equal(r.afterFirst.invocation, null, "no invocation row");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, 0);
    assert.equal(r.windowsAfter.reservedCost - r.windowsBefore.reservedCost, 0);
    assert.ok(r.signals.db_failure >= 1);
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 persistence E: DB failure after preflight, inside the provider-start fence → no dispatch, reservation released", async () => {
  const r = await scenario({ failStatementTag: "workflow-runtime:start-execution" });
  try {
    assert.ok(r.fired.includes("workflow-runtime:start-execution"));
    assert.equal(r.afterFirst.counts, 1, "preflight token count happened");
    assert.equal(r.creates, 0, "no generation");
    assert.notEqual(r.afterFirst.budget?.status, "settled");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, 0, "no spend");
    assert.equal(r.windowsAfter.reservedCost - r.windowsBefore.reservedCost, 0, "no reservation left open");
    assert.ok(r.signals.db_failure >= 1);
    assert.equal(r.signals.provider_redispatch, 0);
  } finally {
    await r.runtime.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Provider-start / claim-lease fence in the composed path (AI-037.6a). Required remaining lease =
// providerTimeoutMs + 10 000 ms margin; timing is real wall-clock time.
// ---------------------------------------------------------------------------------------------

test("M2.1 lease: a slow preflight that leaves less than timeout + margin never starts generation", async () => {
  // Lease 30 000 ms, timeout 19 900 ms → start requires >= 29 900 ms remaining; the count takes 400 ms.
  const r = await scenario({ timing: { providerTimeoutMs: 19_900, claimLeaseDurationMs: 30_000 }, countDelayMs: 400 });
  try {
    assert.equal(r.afterFirst.counts, 1);
    assert.equal(r.creates, 0, "no generation");
    assert.notEqual(r.first.responseStatus, "completed");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, 0);
    assert.equal(r.windowsAfter.reservedCost - r.windowsBefore.reservedCost, 0, "reservation returned");
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 lease: lock wait inside the fence is counted by the fresh-clock check → no generation", async () => {
  // Lease 30 000 ms, timeout 19 000 ms → start requires >= 29 000 ms remaining. The early check passes
  // (fast preflight); the invocation row is then locked for 1 500 ms, so the final check fails.
  const r = await scenario({ timing: { providerTimeoutMs: 19_000, claimLeaseDurationMs: 30_000 }, holdInvocationLockMs: 1_500 });
  try {
    assert.ok(r.fired.includes("lock"));
    assert.equal(r.creates, 0, "no generation");
    assert.equal(r.windowsAfter.consumedCost - r.windowsBefore.consumedCost, 0);
    assert.equal(r.windowsAfter.reservedCost - r.windowsBefore.reservedCost, 0);
  } finally {
    await r.runtime.close();
  }
});

test("M2.1 lease control: the same lock wait with enough lease proceeds to exactly one generation", async () => {
  const r = await scenario({ timing: { providerTimeoutMs: 16_000, claimLeaseDurationMs: 30_000 }, holdInvocationLockMs: 1_500 });
  try {
    assert.ok(r.fired.includes("lock"));
    assert.equal(r.first.status, "completed", JSON.stringify(r.first));
    assert.equal(r.creates, 1);
  } finally {
    await r.runtime.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Ephemeral one-shot egress approval in the composed path: latched on first use, never renewed.
// ---------------------------------------------------------------------------------------------

test("M2.1 egress approval: a latched approval is not renewed after 10 minutes — the same invocation is denied, zero provider calls", async (t) => {
  // Runtime clock (the data-handling evaluation time) under test control.
  let clock = Date.now();
  const evidences: any[] = [];
  const fake = sdk.fakeOpenAISdk();
  const { runtime, runId } = await compose(fake, { providerTimeoutMs: 20_000, claimLeaseDurationMs: 300_000 }, {
    now: () => new Date(clock).toISOString(),
    observeEvidence: (evidence) => evidences.push(evidence),
  });
  const ids = smoke.realProviderSmokeIds(runId);
  const interceptor = live.installQueryInterceptor();
  try {
    // Attempt 1 at T0: data handling latches the approval, then the durable preflight authority
    // fails (after data handling, before any token count or generation).
    interceptor.rules.push(live.rule("preflight authority fails (40001)", live.sqlTag("workflow-runtime:provider-preflight-fence"),
      (_client, _config, _values, send) => send(casFailure)));
    const first = await smoke.runRealProviderSmokeAttempt(runtime, {
      workspaceId, runId, ownerId, model: sdk.fakeModel, now: new Date(clock).toISOString(),
    });
    interceptor.restore();
    observed.push(JSON.stringify(first));
    assert.equal(evidences.length, 1);
    const latched = evidences[0];
    assert.equal(latched.expiresAt, new Date(Date.parse(latched.decidedAt) + 10 * 60_000).toISOString());
    assert.equal(fake.calls.counts + fake.calls.creates, 0);

    // Attempt 2 of the SAME invocation, 11 minutes later (new execution and command only).
    clock += 11 * 60_000;
    const command = smoke.realProviderSmokeAdvanceCommand(runId, ownerId, await runRevision(runId));
    const later = await runtime.service.advance({
      ...command,
      commandId: `${runId}-after-expiry`,
      agentInputs: [{ ...command.agentInputs[0], executionId: `${runId}-after-expiry-execution` }],
    });
    observed.push(JSON.stringify(later));
    // Whatever path the runtime takes for the reused invocation (the durable ledger may refuse it
    // before data handling), no evidence other than the original latched object is ever produced.
    assert.ok(evidences.every((evidence) => evidence === latched), "never a renewed or replacement approval");
    assert.equal(latched.decidedAt, evidences[0].decidedAt);
    assert.notEqual(later.status, "completed");
    assert.equal(fake.calls.counts, 0, "no preflight");
    assert.equal(fake.calls.creates, 0, "no provider generation");
    t.diagnostic(`resolver calls=${evidences.length} later=${later.status}/${later.reasons.map((reason: any) => reason.code).join(",")} invocation=${JSON.stringify(await invocationRow(ids.invocationId))}`);
  } finally {
    interceptor.restore();
    await runtime.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Owner recovery in the composed path, then an explicitly authorized paid retry.
// ---------------------------------------------------------------------------------------------

for (const [name, generation] of [
  ["succeeded", { response: sdk.completedResponse() }],
  ["paid content_filter", { response: sdk.refusalResponse() }],
] as const) {
  test(`M2.1 recovery (${name} + lost persistence): Owner authorization, then exactly one authorized paid retry`, async () => {
    const r = await scenario({ generations: [generation, { response: sdk.completedResponse() }], loseFinalCas: true });
    try {
      assert.equal(r.afterFirst.execution, "outcome_unknown");
      const target = { runId: r.runId, stepId: r.ids.stepId, executionId: r.ids.executionId };
      const inspection = await r.runtime.stateStore.inspectExecutionRecovery(target);
      assert.equal(inspection.eligible, true, JSON.stringify(inspection.reasons));
      assert.deepEqual(await r.runtime.stateStore.authorizeRetryAfterLostProviderResult({ ...target, operatorId: ownerId } as never),
        { status: "denied", reasons: ["acknowledgement_required"] });
      assert.equal(r.calls.creates, 1);
      assert.deepEqual(await r.runtime.stateStore.authorizeRetryAfterLostProviderResult({
        ...target, operatorId: ownerId, acknowledgeLostProviderResultAndDuplicateCostRisk: true,
      }), { status: "authorized", reasons: [] });
      assert.equal(r.calls.creates, 1, "recovery itself never calls the provider");
      const revision = await runRevision(r.runId);
      const retried = await r.runtime.service.advance(smoke.realProviderSmokeAdvanceCommand(r.runId, ownerId, revision, "retry"));
      assert.equal(retried.status, "completed", JSON.stringify(retried.reasons));
      assert.equal(r.calls.creates, 2, "one explicitly authorized paid retry");
      assert.equal(r.runtime.signals().provider_redispatch, 1);
      const audit = await r.runtime.readModel.getRunAuditTimeline(r.runId);
      assert.ok((audit.data ?? []).some((item) => item.eventType === "workflow.execution_recovery_authorized"));
      observed.push(JSON.stringify(audit));
    } finally {
      await r.runtime.close();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Composition-level runtime identity mismatch, signal sink isolation, and the leak scan.
// ---------------------------------------------------------------------------------------------

test("M2.1 identity: a Run whose registry pins another model version is denied before any SDK call", async () => {
  const fake = sdk.fakeOpenAISdk();
  const { runtime, runId } = await compose(fake, { providerTimeoutMs: 20_000, claimLeaseDurationMs: 300_000 });
  try {
    const pinnedElsewhere = { ...sdk.fakeModel, identity: { ...sdk.fakeModel.identity, providerModelVersion: "gpt-m2-other-version" } };
    const outcome = await smoke.runRealProviderSmokeAttempt(runtime, {
      workspaceId, runId, ownerId, model: pinnedElsewhere, now: new Date().toISOString(),
    });
    observed.push(JSON.stringify(outcome));
    assert.notEqual(outcome.responseStatus, "completed");
    assert.equal(fake.calls.counts, 0);
    assert.equal(fake.calls.creates, 0);
  } finally {
    await runtime.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Local runner (scripts/workflow-provider-smoke.mts): rehearsal output and refusal boundaries.
// ---------------------------------------------------------------------------------------------

const runnerScript = fileURLToPath(new URL("../../scripts/workflow-provider-smoke.mts", import.meta.url));
const fakeDbPassword = `FAKE_DB_PASSWORD_DO_NOT_LEAK_${process.pid}`;
const runnerOutputs: string[] = [];

function runRunner(args: readonly string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Explicit minimal environment: nothing inherited, so no real OPENAI_API_KEY can be present.
    const base = { NODE_ENV: "test" as const, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
    execFile(process.execPath, [runnerScript, ...args], { env: { ...base, ...env }, timeout: 60_000, encoding: "utf8" },
      (error: Error | null, stdout: string, stderr: string) => {
        runnerOutputs.push(stdout, stderr);
        resolve({ code: error ? Number((error as any).code ?? 1) : 0, stdout, stderr });
      });
  });
}

const runnerModelArgs = [
  "--workspace", workspaceId, "--owner", ownerId, "--approve-data-egress",
  "--provider-model-id", "gpt-m2-alias", "--provider-request-model-id", "gpt-m2-pinned",
  "--provider-model-version", "gpt-m2-pinned-2026-01-01",
  "--input-price-usd-micros-per-million", "150000", "--output-price-usd-micros-per-million", "600000",
  "--prices-verified-on", "2026-01-01",
];

function withPassword(url: string): string {
  const parsed = new URL(url);
  parsed.password = fakeDbPassword; // the throwaway cluster uses trust auth; the password is a sentinel
  return parsed.toString();
}

test("M2 runner --simulate: one composed generation through the real adapter, sanitized JSON evidence, exit 0", async () => {
  const result = await runRunner(["--simulate", ...runnerModelArgs], {
    DATABASE_URL: withPassword(db.url), OPENAI_API_KEY: fakeSecret,
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "simulate");
  assert.equal(output.status, "completed");
  assert.equal(output.evidence.runStatus, "completed");
  assert.equal(output.evidence.invocation.status, "succeeded");
  assert.equal(output.evidence.invocation.providerRequestModelId, "gpt-m2-pinned");
  assert.deepEqual(output.evidence.usage, {
    inputTokens: 21, outputTokens: 1, totalTokens: 22, costUsdMicros: Math.ceil((21 * 150_000 + 600_000) / 1_000_000), invocationCount: 1,
  });
  assert.equal(output.evidence.budgetStatus, "settled");
  assert.equal(output.evidence.signals.provider_redispatch, 0);
  assert.equal(output.limits.maxOutputTokens, smoke.realProviderSmokeLimits.maxOutputTokens);
});

test("M2 runner refuses before any provider call without the Owner acknowledgements or with a non-loopback database", async () => {
  const env = { DATABASE_URL: withPassword(db.url), OPENAI_API_KEY: fakeSecret };
  const withoutPaidAck = await runRunner(["--execute-one-real-provider-call", ...runnerModelArgs], env);
  assert.equal(withoutPaidAck.code, 2);
  assert.equal(JSON.parse(withoutPaidAck.stdout).status, "refused");
  const withoutEgress = await runRunner(["--simulate", ...runnerModelArgs.filter((arg) => arg !== "--approve-data-egress")], env);
  assert.equal(withoutEgress.code, 2);
  const bothModes = await runRunner(["--simulate", "--execute-one-real-provider-call", ...runnerModelArgs], env);
  assert.equal(bothModes.code, 2);
  const futurePrices = await runRunner(["--simulate", ...runnerModelArgs.slice(0, -1), "2999-01-01"], env);
  assert.equal(futurePrices.code, 2);
  const noKey = await runRunner(["--execute-one-real-provider-call", "--acknowledge-paid-provider-call", ...runnerModelArgs],
    { DATABASE_URL: withPassword(db.url) });
  assert.equal(noKey.code, 2);
  // All flags, but a non-loopback database: composition refuses before any OpenAI client exists,
  // so even the real SDK path cannot reach the network.
  const remote = await runRunner(["--execute-one-real-provider-call", "--acknowledge-paid-provider-call", ...runnerModelArgs],
    { DATABASE_URL: `postgres://postgres:${fakeDbPassword}@db.example.com:5432/m2`, OPENAI_API_KEY: fakeSecret });
  assert.equal(remote.code, 2);
  assert.deepEqual(JSON.parse(remote.stdout).reasons, ["database_not_loopback"]);
});

test("M2 runner stdout/stderr never contain the API key, the database password or the prompt", () => {
  const text = runnerOutputs.join("\n");
  assert.ok(runnerOutputs.length >= 14);
  assert.equal(text.includes(fakeSecret), false, "no API key");
  assert.equal(text.includes(fakeDbPassword), false, "no database password");
  assert.equal(/postgres(ql)?:\/\//u.test(text), false, "no connection string");
  assert.equal(text.includes(promptText), false, "no prompt");
  observed.push(text);
});

test("M2.1 evidence and every captured artifact are free of the fake API key, the prompt and connection strings", () => {
  const text = observed.join("\n");
  assert.ok(observed.length > 20);
  assert.equal(text.includes(fakeSecret), false, "no API key");
  assert.equal(text.includes(db.url), false, "no connection string");
  assert.equal(/postgres(ql)?:\/\//u.test(text), false);
  assert.equal(text.includes("fake-429") || text.includes("fake-timeout") || text.includes("fake-unknown-error"), false,
    "no raw provider error text");
});

test("M2.1 matrices (diagnostic record)", (t) => {
  t.diagnostic(`definitive=${JSON.stringify(definitiveMatrix)}`);
  t.diagnostic(`ambiguous=${JSON.stringify(ambiguousMatrix)}`);
  assert.equal(definitiveMatrix.length, definitiveErrors.length);
  assert.equal(ambiguousMatrix.length, ambiguous.length);
});
