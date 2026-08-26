import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "openai";

/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial fixtures intentionally cross unknown boundaries */

const openAIContract = (await import(new URL("../lib/providers/openai-model-provider.ts", import.meta.url).href)) as typeof import("../lib/providers/openai-model-provider");
const runContract = (await import(new URL("../lib/contracts/workflow-run.ts", import.meta.url).href)) as typeof import("../lib/contracts/workflow-run");
const invocationContract = (await import(new URL("../lib/contracts/model-invocation.ts", import.meta.url).href)) as typeof import("../lib/contracts/model-invocation");
const registryContract = (await import(new URL("../lib/contracts/model-provider-registry.ts", import.meta.url).href)) as typeof import("../lib/contracts/model-provider-registry");
const executionContract = (await import(new URL("../lib/contracts/model-invocation-execution.ts", import.meta.url).href)) as typeof import("../lib/contracts/model-invocation-execution");

const {
  createOpenAIModelProvider,
  isOpenAIModelProviderFactoryVerdict,
  openAIModelProviderFactoryVerdicts,
  openAIModelProviderLimits,
  parseOpenAIModelProviderFactoryVerdict,
} = openAIContract;
const { createWorkflowRunSnapshot, evaluateWorkflowRunTransition } = runContract;
const { evaluateModelInvocationAdmission, modelInvocationLimits } = invocationContract;
const { resolveModelInvocationRoute } = registryContract;
const { executeModelInvocation } = executionContract;

function clone<T>(value: T): T { return structuredClone(value); }
function deeplyFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}
function codes(decision: { reasons: readonly { code: string }[] }) { return decision.reasons.map((reason) => reason.code); }
function budget() { return { maxConcurrentRuns: 4, maxAttemptsPerRun: 3, maxRunMinutes: 120, dailyTokenBudget: 1_000_000, monthlyCostBudgetUsdCents: 250_000 }; }
function project(dataEgressMode = "forbidden") { return { id: "project-one", workspaceId: "workspace-primary", version: 3, name: "Project one", slug: "project-one", summary: "Owner-controlled project context.", kind: "internal_product", status: "active", defaultLocale: "en-US", timeZone: "UTC", dataRegion: "eu", dataClassification: "confidential", goals: ["Operate safely"], nonGoals: ["Autonomous actions"], tags: ["one"], resources: [{ id: "repository-one", kind: "code_repository", label: "Repository one", status: "connected", connectionId: "connection-one", resourceRef: "owner/repository-one", capabilities: ["read_metadata", "propose_change"] }], allowedModelProfileIds: ["model-shared", "model-one"], knowledgeCollectionIds: ["knowledge-one"], policy: { externalActionMode: "approval_required", dataEgressMode, requiredApprovalActions: ["project-review-one"], forbiddenActions: ["Project action forbidden"] }, budget: budget() }; }
function department(dataEgressMode = "forbidden") { return { id: "department-one", projectId: "project-one", version: 5, code: "development", name: "Department one", summary: "Reviewed work.", status: "active", operatingMode: "approval_gated", goals: ["Build reviewed artifacts"], nonGoals: ["Deploy automatically"], resourceGrants: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }], allowedModelProfileIds: ["model-shared", "model-one"], knowledgeCollectionIds: ["knowledge-one"], enabledWorkflowIds: ["workflow-one"], operatorRoleIds: ["role-owner"], modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: ["model-one"], reviewerModelProfileId: "model-one", independentReviewRequired: true }, policy: { externalActionMode: "approval_required", dataEgressMode, additionalRequiredApprovalActions: ["department-review-one"], additionalForbiddenActions: ["Department publish forbidden"] }, budget: { ...budget(), maxConcurrentRuns: 3, maxAttemptsPerRun: 2, maxRunMinutes: 60 } }; }
function binding(kind: "agent" | "workflow", dataEgressMode = "forbidden") { return { id: `${kind}-binding-one`, projectId: "project-one", departmentId: "department-one", version: kind === "agent" ? 7 : 8, status: "active", kind, subjectId: `${kind}-one`, requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }], requestedModelProfileIds: ["model-shared", "model-one"], requestedKnowledgeCollectionIds: ["knowledge-one"], requestedBudget: { ...budget(), maxConcurrentRuns: 1, maxAttemptsPerRun: 2, maxRunMinutes: 30 }, externalActionMode: "approval_required", dataEgressMode, additionalRequiredApprovalActions: [kind === "workflow" ? "workflow-external-one" : "agent-review-one"], additionalForbiddenActions: [`${kind} deploy forbidden`] }; }
function projectRegistry(dataEgressMode = "forbidden") { return { workspaceId: "workspace-primary", projects: [{ projectManifest: project(dataEgressMode), departmentManifests: [department(dataEgressMode)], bindings: [binding("agent", dataEgressMode), binding("workflow", dataEgressMode)] }] }; }
function agent() { return { id: "agent-one", projectId: "project-one", departmentId: "department-one", version: 11, roleCode: "developer", name: "Developer one", summary: "Creates bounded artifacts.", status: "active", instructionProfileId: "instructions-one", goals: ["Create reviewed artifacts"], nonGoals: ["Deploy automatically"], outputTypes: ["patch", "test_report"], allowedWorkflowIds: ["workflow-one"], allowedToolIds: [], allowedModelProfileIds: ["model-shared", "model-one"], knowledgeCollectionIds: ["knowledge-one"], modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: ["model-one"], reviewerModelProfileId: "model-one", independentReviewRequired: true }, additionalRequiredApprovalActions: ["agent-review-one", "workflow-external-one"], additionalForbiddenActions: ["Agent deploy forbidden"] }; }
function workflow() { return { id: "workflow-one", projectId: "project-one", departmentId: "department-one", version: 13, name: "Workflow one", summary: "Runs bounded approved work.", status: "active", triggerMode: "manual", goals: ["Produce reviewed output"], nonGoals: ["Deploy automatically"], steps: [{ id: "execute-one", kind: "agent_task", name: "Execute approved task", dependsOnStepIds: ["approve-one"], agentId: "agent-one", agentBindingId: "agent-binding-one", outputType: "patch", requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }], modelProfileId: "model-shared", knowledgeCollectionIds: ["knowledge-one"], toolIds: [], maxAttempts: 2, timeoutMinutes: 30, actionMode: "external_action", requiredApprovalAction: "workflow-external-one" }, { id: "approve-one", kind: "approval_gate", name: "Owner approval", dependsOnStepIds: [], approvalAction: "workflow-external-one" }], finalStepIds: ["execute-one"], additionalRequiredApprovalActions: ["workflow-review-one"], additionalForbiddenActions: ["Workflow publish forbidden"] }; }
function creation(dataEgressMode = "forbidden") { const registry = projectRegistry(dataEgressMode); return { runId: "run-one", requestId: "request-one", createdAt: "2026-08-26T10:15:30.000Z", schedulerInput: { registry: clone(registry), policy: { workspaceId: "workspace-primary", status: "active", maxConcurrentRuns: 8, maxQueuedRuns: 512, projectPolicies: [{ projectId: "project-one", status: "active", maxQueuedRuns: 256, allowedPriorities: ["P0", "P1", "P2", "P3", "P4"] }] }, queuedRequests: [{ id: "request-one", workspaceId: "workspace-primary", projectId: "project-one", bindingId: "workflow-binding-one", modelProfileId: "model-shared", idempotencyKey: "idempotency-one", priority: "P2", sequence: 1 }], runningRuns: [], lastDispatchedProjectId: null }, workflowCatalog: { registry, agents: [{ bindingId: "agent-binding-one", agentManifest: agent() }], workflows: [{ bindingId: "workflow-binding-one", workflowManifest: workflow() }] } }; }
function apply(snapshot: any, kind: string, index: number, extra: Record<string, unknown> = {}) { const decision = evaluateWorkflowRunTransition({ snapshot, event: { eventId: `event-${index}`, runId: snapshot.runId, kind, sequence: snapshot.revision + 1, occurredAt: `2026-08-26T10:15:${30 + index}.000Z`, actorKind: "owner", actorId: "owner-one", ...extra } }); assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons)); assert.ok(decision.nextSnapshot); return decision.nextSnapshot; }
function runningSnapshot(dataEgressMode = "forbidden") { const created = createWorkflowRunSnapshot(creation(dataEgressMode)); assert.equal(created.verdict, "allow", JSON.stringify(created.reasons)); assert.ok(created.snapshot); let snapshot = apply(created.snapshot, "run_started", 1); snapshot = apply(snapshot, "approval_requested", 2, { stepId: "approve-one", approvalRequestId: "approval-one" }); snapshot = apply(snapshot, "approval_granted", 3, { stepId: "approve-one", approvalRequestId: "approval-one" }); return apply(snapshot, "step_started", 4, { stepId: "execute-one" }); }
function draft(overrides: Record<string, unknown> = {}) { return { invocationId: "invocation-one", invocationSequence: 1, stepId: "execute-one", messages: [{ role: "system", content: "Follow bounded instructions.", toolCallId: null }, { role: "user", content: "Prepare the proposal.", toolCallId: null }, { role: "assistant", content: "I will prepare it.", toolCallId: null }, { role: "user", content: "Keep it concise.", toolCallId: null }], contextArtifactIds: ["artifact-secret-reference"], ...overrides }; }
function factualRequest() { const snapshot = runningSnapshot(); const admission = evaluateModelInvocationAdmission({ snapshot, draft: draft(), existingRequests: [] }); assert.equal(admission.verdict, "allow", JSON.stringify(admission.reasons)); assert.ok(admission.normalizedRequest); return clone(admission.normalizedRequest); }

function identity(overrides: Record<string, unknown> = {}) { return { providerId: "provider-openai", providerKind: "openai", deploymentId: "deployment-openai", providerModelId: "gpt-test-alias", providerModelVersion: "gpt-test-version", ...overrides }; }
function config(overrides: Record<string, unknown> = {}) { return { identity: identity(), timeoutMs: 5_000, maxInputTokens: 1_000, maxOutputTokens: 100, inputCostUsdMicrosPerMillionTokens: 1_000_001, outputCostUsdMicrosPerMillionTokens: 2_000_001, ...overrides }; }
function assistantMessage(status: "completed" | "incomplete" = "completed", content: unknown[] = [{ type: "output_text", text: "Bounded OpenAI output." }]) { return { type: "message", role: "assistant", status, content }; }
function reasoning(status: "completed" | "incomplete" = "completed") { return { id: "reasoning-one", type: "reasoning", status, summary: [{ type: "summary_text", text: "Private reasoning summary." }] }; }
function response(overrides: Record<string, unknown> = {}) { return { model: "gpt-test-version", status: "completed", error: null, incomplete_details: null, output: [assistantMessage()], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, ...overrides }; }

type FakeState = { options: unknown[]; requests: unknown[]; models: string[]; responseValue: unknown; responseError: unknown; modelValue: unknown; modelError: unknown };
function fakeState(): FakeState { return { options: [], requests: [], models: [], responseValue: response(), responseError: null, modelValue: { id: "gpt-test-alias" }, modelError: null }; }
function factory(state = fakeState(), overrides: { config?: Record<string, unknown>; credentials?: unknown; times?: number[]; observedAt?: string } = {}) {
  const times = [...(overrides.times ?? [10, 15, 20, 25, 30, 35, 40, 45])];
  const decision = createOpenAIModelProvider(config(overrides.config), overrides.credentials ?? { apiKey: "sk-private-test-secret" }, {
    createClient(options) {
      state.options.push(clone(options));
      return {
        responses: { async create(input) { state.requests.push(clone(input)); if (state.responseError) throw state.responseError; return state.responseValue; } },
        models: { async retrieve(model) { state.models.push(model); if (state.modelError) throw state.modelError; return state.modelValue; } },
      };
    },
    monotonicNow: () => times.shift() ?? 50,
    observedAt: () => overrides.observedAt ?? "2026-08-26T10:15:30.000Z",
  });
  return { decision, state };
}

test("exports frozen limits and exact factory verdict guards", () => {
  assert.deepEqual(openAIModelProviderFactoryVerdicts, ["allow", "deny"]);
  assert.equal(Object.isFrozen(openAIModelProviderFactoryVerdicts), true);
  assert.equal(Object.isFrozen(openAIModelProviderLimits), true);
  assert.equal(openAIModelProviderLimits.maxInputTokens > 0, true);
  assert.equal(openAIModelProviderLimits.maxOutputTokens > 0, true);
  for (const verdict of openAIModelProviderFactoryVerdicts) { assert.equal(isOpenAIModelProviderFactoryVerdict(verdict), true); assert.equal(parseOpenAIModelProviderFactoryVerdict(verdict), verdict); }
  assert.equal(isOpenAIModelProviderFactoryVerdict("Allow"), false);
  assert.equal(parseOpenAIModelProviderFactoryVerdict({}), null);
});

test("factory accepts exact config and captures exact SDK options without exposing credentials", () => {
  const state = fakeState();
  const input = config();
  const before = clone(input);
  const { decision } = factory(state);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.ok(decision.provider && decision.normalizedConfig);
  assert.deepEqual(Object.keys(decision.provider).sort(), ["health", "identity", "run"]);
  for (const key of ["identity", "run", "health"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(decision.provider, key);
    assert.ok(descriptor && Object.hasOwn(descriptor, "value") && descriptor.get === undefined && descriptor.set === undefined);
  }
  assert.equal(deeplyFrozen(decision), true);
  assert.deepEqual(input, before);
  assert.deepEqual(state.options, [{ apiKey: "sk-private-test-secret", maxRetries: 0, timeout: 5_000, logLevel: "off" }]);
  assert.equal(JSON.stringify(decision).includes("sk-private-test-secret"), false);
});

test("exact config and apiKey boundaries allow maxima while missing, inherited, and accessor fields deny", () => {
  const maximum = factory(fakeState(), { credentials: { apiKey: "k".repeat(openAIModelProviderLimits.maxApiKeyLength) }, config: { timeoutMs: openAIModelProviderLimits.maxTimeoutMs, maxInputTokens: openAIModelProviderLimits.maxInputTokens, maxOutputTokens: openAIModelProviderLimits.maxOutputTokens, inputCostUsdMicrosPerMillionTokens: openAIModelProviderLimits.maxPriceUsdMicrosPerMillionTokens, outputCostUsdMicrosPerMillionTokens: openAIModelProviderLimits.maxPriceUsdMicrosPerMillionTokens } });
  assert.equal(maximum.decision.verdict, "allow", JSON.stringify(maximum.decision.reasons));
  const missing: any = config(); delete missing.timeoutMs;
  const inherited = Object.create(config());
  const accessor = Object.defineProperty(config(), "timeoutMs", { enumerable: true, get() { return 5_000; } });
  for (const value of [missing, inherited, accessor]) {
    const decision = createOpenAIModelProvider(value, { apiKey: "secret" });
    assert.equal(decision.verdict, "deny"); assert.equal(decision.provider, null); assert.equal(decision.normalizedConfig, null);
  }
});

test("factory rejects non-OpenAI identity and exact config violations without creating a client", () => {
  for (const invalid of [
    { ...config(), unknown: true },
    { ...config(), timeoutMs: 0 },
    { ...config(), maxInputTokens: 0 },
    { ...config(), maxOutputTokens: openAIModelProviderLimits.maxOutputTokens + 1 },
    { ...config(), identity: identity({ providerKind: "mock" }) },
  ]) {
    const state = fakeState();
    const decision = createOpenAIModelProvider(invalid, { apiKey: "secret" }, { createClient(options) { state.options.push(options); throw new Error("must not run"); } });
    assert.equal(decision.verdict, "deny"); assert.equal(decision.provider, null); assert.equal(decision.normalizedConfig, null); assert.equal(state.options.length, 0);
  }
});

test("credentials require one own data apiKey and never leak hostile secret values", () => {
  const getter = Object.defineProperty({}, "apiKey", { enumerable: true, get() { throw new Error("secret-from-getter"); } });
  const inherited = Object.create({ apiKey: "inherited-secret" });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("proxy-secret"); } });
  const values = [undefined, {}, { apiKey: "" }, { apiKey: "   " }, { apiKey: "bad\nkey" }, { apiKey: "x".repeat(openAIModelProviderLimits.maxApiKeyLength + 1) }, { apiKey: "secret", other: true }, getter, inherited, proxy];
  for (const credentials of values) {
    const decision = createOpenAIModelProvider(config(), credentials);
    assert.equal(decision.verdict, "deny"); assert.equal(decision.provider, null); assert.equal(decision.normalizedConfig, null);
    const serialized = JSON.stringify(decision);
    for (const secret of ["secret-from-getter", "inherited-secret", "proxy-secret", "bad\\nkey"]) assert.equal(serialized.includes(secret), false);
  }
});

test("factory fails closed on getters, proxies, cycles, Set, Map, sparse and derived values", () => {
  const getter = Object.defineProperty(config(), "timeoutMs", { enumerable: true, get() { throw new Error("no read"); } });
  const proxy = new Proxy(config(), { ownKeys() { throw new Error("trap"); } });
  const cycle: any = config(); cycle.self = cycle;
  const sparse: any[] = Array(2); sparse[0] = config();
  class DerivedArray extends Array<unknown> {}
  for (const value of [getter, proxy, cycle, new Set(), new Map(), sparse, new DerivedArray(config())]) {
    assert.doesNotThrow(() => createOpenAIModelProvider(value, { apiKey: "secret" }));
    const decision = createOpenAIModelProvider(value, { apiKey: "secret" });
    assert.equal(decision.verdict, "deny"); assert.equal(decision.provider, null); assert.equal(decision.normalizedConfig, null);
  }
});

test("run maps messages in order, extracts first system instruction, and omits internal audit IDs", async () => {
  const request = factualRequest();
  const before = clone(request);
  const { decision, state } = factory();
  assert.ok(decision.provider);
  const run = await decision.provider.run(request);
  assert.equal(run.verdict, "allow", JSON.stringify(run.reasons));
  assert.equal(state.requests.length, 1);
  assert.deepEqual(state.requests[0], { model: "gpt-test-alias", instructions: "Follow bounded instructions.", input: [{ role: "user", content: "Prepare the proposal." }, { role: "assistant", content: "I will prepare it." }, { role: "user", content: "Keep it concise." }], store: false, stream: false, background: false, max_output_tokens: 100 });
  const serialized = JSON.stringify(state.requests[0]);
  for (const value of [request.projectId, request.workflowId, request.agentId, request.agentBindingId, request.workflowBindingId, request.contextArtifactIds[0], "sk-private-test-secret"]) assert.equal(serialized.includes(value), false, value);
  assert.deepEqual(request, before);
});

test("invalid and tool-bearing requests are denied before the SDK call", async () => {
  const invalidFactory = factory(); assert.ok(invalidFactory.decision.provider);
  const invalid = await invalidFactory.decision.provider.run({});
  assert.equal(invalid.verdict, "deny"); assert.equal(invalid.requestDecision?.verdict, "deny"); assert.equal(invalid.normalizedResult, null); assert.equal(invalidFactory.state.requests.length, 0);
  const request = factualRequest();
  const toolFactory = factory(); assert.ok(toolFactory.decision.provider);
  const tool = await toolFactory.decision.provider.run({ ...request, toolIds: ["tool-read"] });
  assert.equal(tool.verdict, "deny"); assert.deepEqual(codes(tool), ["tool_not_allowed"]); assert.equal(tool.normalizedResult, null); assert.equal(toolFactory.state.requests.length, 0);
});

test("successful response produces factual exact usage, latency, version and rounded-up bigint cost", async () => {
  const state = fakeState(); state.responseValue = response({ usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
  const { decision } = factory(state, { times: [100.2, 105.3] }); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "allow", JSON.stringify(result.reasons));
  assert.equal(result.normalizedResult?.outcome, "succeeded"); assert.equal(result.normalizedResult?.finishReason, "stop");
  assert.equal(result.normalizedResult?.latencyMs, 6); assert.equal(result.normalizedResult?.costUsdMicros, 21);
  assert.equal(result.normalizedResult?.providerModelVersion, "gpt-test-version");
  assert.equal(state.requests.length, 1); assert.equal(deeplyFrozen(result), true);
});

test("completed response with a non-null provider error denies without leaking it", async () => {
  const state = fakeState(); state.responseValue = response({ error: { code: "server_error", message: "raw-completed-error-secret" } });
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null); assert.equal(JSON.stringify(result).includes("raw-completed-error-secret"), false); assert.equal(state.requests.length, 1);
});

test("completed response with incomplete details denies as an inconsistent terminal state", async () => {
  const state = fakeState(); state.responseValue = response({ incomplete_details: { reason: "max_output_tokens" } });
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null);
});

test("failed, cancelled, unknown, and non-terminal response statuses deny even when output is a refusal", async () => {
  for (const status of ["failed", "cancelled", "in_progress", "queued", "unknown"] as const) {
    const state = fakeState(); state.responseValue = response({ status, output: [assistantMessage("completed", [{ type: "refusal", refusal: "raw-status-refusal-secret" }])] });
    const { decision } = factory(state); assert.ok(decision.provider);
    const result = await decision.provider.run(factualRequest());
    assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null); assert.equal(JSON.stringify(result).includes("raw-status-refusal-secret"), false);
  }
});

test("incomplete response without one canonical incomplete reason denies", async () => {
  for (const incomplete_details of [null, {}, { reason: "unknown" }, { reason: "max_output_tokens", extra: true }]) {
    const state = fakeState(); state.responseValue = response({ status: "incomplete", incomplete_details, output: [assistantMessage("incomplete")] });
    const { decision } = factory(state); assert.ok(decision.provider);
    const result = await decision.provider.run(factualRequest());
    assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null);
  }
});

test("output message with a non-assistant role denies", async () => {
  const state = fakeState(); state.responseValue = response({ output: [{ ...assistantMessage(), role: "user" }] });
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null);
});

test("output message status must match the terminal response status", async () => {
  for (const value of [
    response({ output: [assistantMessage("incomplete")] }),
    response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [assistantMessage("completed")] }),
  ]) {
    const state = fakeState(); state.responseValue = value;
    const { decision } = factory(state); assert.ok(decision.provider);
    const result = await decision.provider.run(factualRequest());
    assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null);
  }
});

test("completed reasoning item before a canonical assistant message is safely ignored", async () => {
  const raw = response({ output: [reasoning(), assistantMessage()] }); const before = clone(raw);
  const state = fakeState(); state.responseValue = raw;
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "allow", JSON.stringify(result.reasons)); assert.equal(result.normalizedResult?.outputText, "Bounded OpenAI output."); assert.equal(JSON.stringify(result).includes("Private reasoning summary."), false); assert.deepEqual(raw, before); assert.equal(state.requests.length, 1);
});

test("reasoning-only response denies without exposing reasoning content", async () => {
  const state = fakeState(); state.responseValue = response({ output: [reasoning()] });
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null); assert.equal(JSON.stringify(result).includes("Private reasoning summary."), false);
});

test("function, tool, web, file, computer, and unknown output items remain unsupported", async () => {
  for (const type of ["function_call", "custom_tool_call", "web_search_call", "file_search_call", "computer_call", "unknown_output"] as const) {
    const state = fakeState(); state.responseValue = response({ output: [{ type, status: "completed" }] });
    const { decision } = factory(state); assert.ok(decision.provider);
    const result = await decision.provider.run(factualRequest());
    assert.equal(result.verdict, "deny", type); assert.equal(result.normalizedResult, null); assert.equal(state.requests.length, 1);
  }
});

test("unknown assistant content types deny without partial output", async () => {
  const state = fakeState(); state.responseValue = response({ output: [assistantMessage("completed", [{ type: "input_text", text: "not output" }])] });
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null);
});

test("incomplete max-output response maps meaningful partial text to length", async () => {
  const state = fakeState(); state.responseValue = response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [assistantMessage("incomplete")] });
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.normalizedResult?.outcome, "succeeded"); assert.equal(result.normalizedResult?.finishReason, "length");
});

test("max-output incomplete state with refusal content denies as contradictory", async () => {
  const state = fakeState(); state.responseValue = response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [assistantMessage("incomplete", [{ type: "refusal", refusal: "raw-max-output-refusal" }])] });
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null); assert.equal(JSON.stringify(result).includes("raw-max-output-refusal"), false);
});

test("refusal and content-filter incomplete responses map to safe content-filter failures", async () => {
  for (const value of [
    response({ output: [assistantMessage("completed", [{ type: "refusal", refusal: "raw-provider-refusal" }])] }),
    response({ status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [assistantMessage("incomplete")] }),
  ]) {
    const state = fakeState(); state.responseValue = value;
    const { decision } = factory(state); assert.ok(decision.provider);
    const result = await decision.provider.run(factualRequest());
    assert.equal(result.verdict, "allow"); assert.equal(result.normalizedResult?.outcome, "failed"); assert.equal(result.normalizedResult?.finishReason, "content_filter"); assert.equal(result.normalizedResult?.outputText, null); assert.equal(result.normalizedResult?.error?.category, "content_filtered"); assert.equal(JSON.stringify(result).includes("raw-provider-refusal"), false);
  }
});

test("simultaneous text and refusal content denies without exposing the refusal", async () => {
  const state = fakeState(); state.responseValue = response({ output: [assistantMessage("completed", [{ type: "output_text", text: "contradictory text" }, { type: "refusal", refusal: "raw-contradictory-refusal" }])] });
  const { decision } = factory(state); assert.ok(decision.provider);
  const result = await decision.provider.run(factualRequest());
  assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null); assert.equal(JSON.stringify(result).includes("raw-contradictory-refusal"), false);
});

test("SDK transport/API errors become factual safe failures with no raw leakage", async () => {
  const headers = new Headers();
  const cases = [
    [new APIConnectionTimeoutError({ message: "raw-timeout-secret" }), "timeout", true],
    [APIError.generate(429, {}, "raw-rate-secret", headers), "rate_limited", true],
    [new APIConnectionError({ message: "raw-connection-secret" }), "unavailable", true],
    [APIError.generate(500, {}, "raw-server-secret", headers), "unavailable", true],
    [APIError.generate(401, {}, "raw-auth-secret", headers), "provider_error", false],
    [new Error("raw-unknown-secret"), "unknown", false],
  ] as const;
  for (const [error, category, retryable] of cases) {
    const state = fakeState(); state.responseError = error;
    const { decision } = factory(state); assert.ok(decision.provider);
    const result = await decision.provider.run(factualRequest());
    assert.equal(result.verdict, "allow", JSON.stringify(result.reasons)); assert.equal(result.normalizedResult?.outcome, "failed"); assert.equal(result.normalizedResult?.finishReason, "error"); assert.equal(result.normalizedResult?.error?.category, category); assert.equal(result.normalizedResult?.error?.retryable, retryable); assert.deepEqual(result.normalizedResult?.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }); assert.equal(result.normalizedResult?.costUsdMicros, 0); assert.equal(JSON.stringify(result).includes(error.message), false); assert.equal(state.requests.length, 1);
  }
});

test("malformed, hostile, oversized, empty, tool, identity and invalid-usage responses deny without partial output", async () => {
  const getter = Object.defineProperty({}, "model", { enumerable: true, get() { throw new Error("no read"); } });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
  const cycle: any = response(); cycle.self = cycle;
  const values = [
    {}, getter, proxy, cycle, new Set(), new Map(),
    response({ output: [assistantMessage("completed", [{ type: "output_text", text: "x".repeat(openAIModelProviderLimits.maxResponseStringLength + 1) }])] }),
    response({ output: [assistantMessage("completed", [{ type: "output_text", text: "   " }])] }),
    response({ output: [{ type: "function_call", name: "danger", arguments: "{}" }] }),
    response({ model: "gpt-other-version" }),
    response({ usage: { input_tokens: 10, output_tokens: 5, total_tokens: 16 } }),
    response({ usage: { input_tokens: 1_001, output_tokens: 5, total_tokens: 1_006 } }),
  ];
  for (const value of values) {
    const state = fakeState(); state.responseValue = value;
    const { decision } = factory(state); assert.ok(decision.provider);
    const result = await decision.provider.run(factualRequest());
    assert.equal(result.verdict, "deny"); assert.equal(result.normalizedResult, null); assert.equal(result.resultDecision, null); assert.equal(deeplyFrozen(result), true);
  }
});

test("one run performs at most one Responses create call for both allow and mapping deny", async () => {
  for (const value of [response(), response({ status: "failed", error: { code: "server_error", message: "raw-failed-secret" } })]) {
    const state = fakeState(); state.responseValue = value;
    const { decision } = factory(state); assert.ok(decision.provider);
    const result = await decision.provider.run(factualRequest());
    assert.equal(state.requests.length, 1); assert.equal(JSON.stringify(result).includes("raw-failed-secret"), false);
  }
});

test("cost boundary is exact and overflow beyond canonical result cost denies", async () => {
  const state = fakeState(); state.responseValue = response({ usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } });
  const one = factory(state, { config: { inputCostUsdMicrosPerMillionTokens: 1, outputCostUsdMicrosPerMillionTokens: 0 } }); assert.ok(one.decision.provider);
  assert.equal((await one.decision.provider.run(factualRequest())).normalizedResult?.costUsdMicros, 1);
  const hugeState = fakeState(); hugeState.responseValue = response({ usage: { input_tokens: modelInvocationLimits.maxTokenCount, output_tokens: 0, total_tokens: modelInvocationLimits.maxTokenCount } });
  const huge = factory(hugeState, { config: { maxInputTokens: modelInvocationLimits.maxTokenCount, inputCostUsdMicrosPerMillionTokens: openAIModelProviderLimits.maxPriceUsdMicrosPerMillionTokens, outputCostUsdMicrosPerMillionTokens: 0 } }); assert.ok(huge.decision.provider);
  const denied = await huge.decision.provider.run(factualRequest()); assert.equal(denied.verdict, "deny"); assert.equal(denied.normalizedResult, null);
});

test("health uses exactly one model retrieval and maps success, transient errors, auth and identity mismatch", async () => {
  const healthy = factory(fakeState(), { times: [10, 15] }); assert.ok(healthy.decision.provider);
  const health = await healthy.decision.provider.health(); assert.equal(health.verdict, "allow"); assert.equal(health.normalizedHealth?.status, "healthy"); assert.deepEqual(healthy.state.models, ["gpt-test-alias"]); assert.equal(healthy.state.requests.length, 0);
  const transientState = fakeState(); transientState.modelError = new APIConnectionTimeoutError({ message: "raw-health-secret" }); const transient = factory(transientState); assert.ok(transient.decision.provider); const unavailable = await transient.decision.provider.health(); assert.equal(unavailable.verdict, "allow"); assert.equal(unavailable.normalizedHealth?.status, "unavailable"); assert.equal(JSON.stringify(unavailable).includes("raw-health-secret"), false); assert.equal(transientState.models.length, 1);
  const authState = fakeState(); authState.modelError = APIError.generate(401, {}, "raw-auth-secret", new Headers()); const auth = factory(authState); assert.ok(auth.decision.provider); const authHealth = await auth.decision.provider.health(); assert.equal(authHealth.verdict, "deny"); assert.equal(authHealth.normalizedHealth, null);
  const mismatchState = fakeState(); mismatchState.modelValue = { id: "wrong-model" }; const mismatch = factory(mismatchState); assert.ok(mismatch.decision.provider); const mismatchHealth = await mismatch.decision.provider.health(); assert.equal(mismatchHealth.verdict, "deny"); assert.equal(mismatchHealth.normalizedHealth, null);
});

test("repeated runs are deterministic fresh deeply frozen and caller inputs remain immutable", async () => {
  const request = factualRequest(); const before = clone(request);
  const repeated = factory(fakeState(), { times: [10, 15, 10, 15] }); assert.ok(repeated.decision.provider);
  const first = await repeated.decision.provider.run(request); const second = await repeated.decision.provider.run(request);
  assert.deepEqual(first, second); assert.notEqual(first, second); assert.notEqual(first.normalizedResult, second.normalizedResult); assert.equal(deeplyFrozen(first), true); assert.equal(deeplyFrozen(second), true); assert.deepEqual(request, before);
  assert.equal(repeated.state.requests.length, 2);
});

function providerRegistry(dataEgressMode = "redacted_only") { return { workspaceId: "workspace-primary", version: 1, providers: [{ id: "provider-openai", kind: "openai", status: "active", deploymentMode: "remote", supportedDataRegions: ["eu"], supportedDataEgressModes: [dataEgressMode], capabilities: ["messages"] }], deployments: [{ id: "deployment-openai", providerId: "provider-openai", status: "active", providerModelId: "gpt-test-alias", providerModelVersion: "gpt-test-version", capabilities: ["messages"], supportedOutputTypes: ["patch", "test_report"], maxInputTokens: 128_000, maxOutputTokens: 16_000, inputCostUsdMicrosPerMillionTokens: 1_000_001, outputCostUsdMicrosPerMillionTokens: 2_000_001, latencyClass: "standard", qualityTier: "reasoning" }], modelProfiles: [{ modelProfileId: "model-shared", status: "active", requiredCapabilities: ["messages"], supportedOutputTypes: ["patch", "test_report"], candidates: [{ deploymentId: "deployment-openai", priority: 1 }] }, { modelProfileId: "model-one", status: "active", requiredCapabilities: ["messages"], supportedOutputTypes: ["patch", "test_report"], candidates: [{ deploymentId: "deployment-openai", priority: 1 }] }] }; }
function remoteRouteInput() { const dataEgressMode = "redacted_only"; return { projectRegistry: projectRegistry(dataEgressMode), modelProviderRegistry: providerRegistry(dataEgressMode), invocationAdmission: { snapshot: runningSnapshot(dataEgressMode), draft: draft(), existingRequests: [] } }; }

test("AI-025 rejects factual remote OpenAI route before provider health or run", async () => {
  const input = remoteRouteInput(); const route = resolveModelInvocationRoute(input); assert.equal(route.verdict, "allow", JSON.stringify(route.reasons)); assert.equal(route.routePlan?.primary.deploymentMode, "remote"); assert.equal(route.routePlan?.primary.dataHandlingRequirement, "redaction_required");
  const created = factory(); assert.ok(created.decision.provider);
  let healthCalls = 0; let runCalls = 0; const provider = { identity: created.decision.provider.identity, async health() { healthCalls += 1; return created.decision.provider?.health(); }, async run(value: unknown) { runCalls += 1; return created.decision.provider?.run(value); } };
  const execution = await executeModelInvocation(input, [provider]);
  assert.equal(execution.verdict, "deny"); assert.deepEqual(codes(execution), ["data_handling_not_executable"]); assert.equal(execution.selectedCandidate, null); assert.equal(execution.healthDecision, null); assert.equal(execution.providerDecision, null); assert.equal(execution.resultDecision, null); assert.equal(execution.normalizedResult, null); assert.equal(healthCalls, 0); assert.equal(runCalls, 0);
});

test("production source audits official SDK isolation and forbidden browser, environment, logging, retry and transport mechanisms", () => {
  const providerSource = readFileSync(new URL("../lib/providers/openai-model-provider.ts", import.meta.url), "utf8");
  assert.match(providerSource, /from "openai"/u); assert.match(providerSource, /maxRetries: 0/u); assert.match(providerSource, /timeout:/u); assert.match(providerSource, /logLevel: "off"/u);
  for (const token of ["dangerously" + "AllowBrowser", "NEXT_PUBLIC_" + "OPENAI", "OPENAI_" + "API_KEY", "console" + ".", "process" + ".env", "base" + "URL", "previous_" + "response_id", "web_" + "search", "file_" + "search", "code_" + "interpreter", "computer_" + "use"]) assert.equal(providerSource.includes(token), false, token);
  const registrySource = readFileSync(new URL("../lib/contracts/model-provider-registry.ts", import.meta.url), "utf8");
  assert.equal(registrySource.includes('from "openai"'), false);
});
