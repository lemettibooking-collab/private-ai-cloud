import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = (await import(
  new URL("../lib/contracts/model-invocation.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-invocation");
const runContract = (await import(
  new URL("../lib/contracts/workflow-run.ts", import.meta.url).href
)) as typeof import("../lib/contracts/workflow-run");

const {
  evaluateModelInvocationAdmission,
  evaluateModelInvocationResult,
  isModelInvocationErrorCategory,
  isModelInvocationFinishReason,
  isModelInvocationMessageRole,
  isModelInvocationResultStatus,
  isModelInvocationStatus,
  isModelInvocationVerdict,
  modelInvocationErrorCategories,
  modelInvocationFinishReasons,
  modelInvocationLimits,
  modelInvocationMessageRoles,
  modelInvocationResultStatuses,
  modelInvocationStatuses,
  modelInvocationVerdicts,
  parseModelInvocationErrorCategory,
  parseModelInvocationFinishReason,
  parseModelInvocationMessageRole,
  parseModelInvocationResultStatus,
  parseModelInvocationStatus,
  parseModelInvocationVerdict,
  validateAndNormalizeModelInvocationRequest,
  validateAndNormalizeModelInvocationResult,
} = contract;
const { createWorkflowRunSnapshot, evaluateWorkflowRunTransition } = runContract;

function clone<T>(value: T): T { return structuredClone(value); }

function budget(overrides: Record<string, unknown> = {}) {
  return { maxConcurrentRuns: 4, maxAttemptsPerRun: 3, maxRunMinutes: 120, dailyTokenBudget: 1_000_000, monthlyCostBudgetUsdCents: 250_000, ...overrides };
}

function project(suffix = "one") {
  return {
    id: `project-${suffix}`, workspaceId: "workspace-primary", version: 3, name: `Project ${suffix}`,
    slug: `project-${suffix}`, summary: "Owner-controlled project context.", kind: "internal_product", status: "active",
    defaultLocale: "en-US", timeZone: "UTC", dataRegion: "eu", dataClassification: "confidential",
    goals: ["Operate safely"], nonGoals: ["Autonomous actions"], tags: [suffix],
    resources: [{ id: `repository-${suffix}`, kind: "code_repository", label: `Repository ${suffix}`, status: "connected", connectionId: `connection-${suffix}`, resourceRef: `owner/repository-${suffix}`, capabilities: ["read_metadata", "read_content", "propose_change"] }],
    allowedModelProfileIds: ["model-shared", `model-${suffix}`], knowledgeCollectionIds: [`knowledge-${suffix}`],
    policy: { externalActionMode: "approval_required", dataEgressMode: "redacted_only", requiredApprovalActions: [`project-review-${suffix}`], forbiddenActions: [`Project ${suffix} action forbidden`] },
    budget: budget(),
  };
}

function department(suffix = "one") {
  return {
    id: `department-${suffix}`, projectId: `project-${suffix}`, version: 5, code: suffix === "one" ? "development" : "qa-code-review",
    name: `Department ${suffix}`, summary: "Reviewed work.", status: "active", operatingMode: "approval_gated",
    goals: ["Build reviewed artifacts"], nonGoals: ["Deploy automatically"],
    resourceGrants: [{ resourceId: `repository-${suffix}`, capabilities: ["read_metadata", "propose_change"] }],
    allowedModelProfileIds: ["model-shared", `model-${suffix}`], knowledgeCollectionIds: [`knowledge-${suffix}`], enabledWorkflowIds: [`workflow-${suffix}`], operatorRoleIds: ["role-owner"],
    modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: [`model-${suffix}`], reviewerModelProfileId: `model-${suffix}`, independentReviewRequired: true },
    policy: { externalActionMode: "approval_required", dataEgressMode: "forbidden", additionalRequiredApprovalActions: [`department-review-${suffix}`], additionalForbiddenActions: [`Department ${suffix} publish forbidden`] },
    budget: budget({ maxConcurrentRuns: 3, maxAttemptsPerRun: 2, maxRunMinutes: 60 }),
  };
}

function binding(suffix = "one", kind: "agent" | "workflow" = "agent") {
  const workflow = kind === "workflow";
  return {
    id: `${kind}-binding-${suffix}`, projectId: `project-${suffix}`, departmentId: `department-${suffix}`, version: workflow ? 8 : 7,
    status: "active", kind, subjectId: `${workflow ? "workflow" : "agent"}-${suffix}`,
    requestedResources: [{ resourceId: `repository-${suffix}`, capabilities: ["read_metadata", "propose_change"] }],
    requestedModelProfileIds: ["model-shared", `model-${suffix}`], requestedKnowledgeCollectionIds: [`knowledge-${suffix}`],
    requestedBudget: budget({ maxConcurrentRuns: 1, maxAttemptsPerRun: 2, maxRunMinutes: 30 }),
    externalActionMode: "approval_required", dataEgressMode: "forbidden",
    additionalRequiredApprovalActions: [workflow ? `workflow-external-${suffix}` : `agent-review-${suffix}`], additionalForbiddenActions: [`${kind} ${suffix} deploy forbidden`],
  };
}

function agent(suffix = "one") {
  return {
    id: `agent-${suffix}`, projectId: `project-${suffix}`, departmentId: `department-${suffix}`, version: 11,
    roleCode: "developer", name: `Developer ${suffix}`, summary: "Creates bounded artifacts.", status: "active", instructionProfileId: `instructions-${suffix}`,
    goals: ["Create reviewed artifacts"], nonGoals: ["Deploy automatically"], outputTypes: ["patch", "test_report"],
    allowedWorkflowIds: [`workflow-${suffix}`], allowedToolIds: ["tool-read", "tool-patch"], allowedModelProfileIds: ["model-shared", `model-${suffix}`], knowledgeCollectionIds: [`knowledge-${suffix}`],
    modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: [`model-${suffix}`], reviewerModelProfileId: `model-${suffix}`, independentReviewRequired: true },
    additionalRequiredApprovalActions: [`agent-review-${suffix}`, `workflow-external-${suffix}`], additionalForbiddenActions: [`Agent ${suffix} deploy forbidden`],
  };
}

function workflow(suffix = "one") {
  return {
    id: `workflow-${suffix}`, projectId: `project-${suffix}`, departmentId: `department-${suffix}`, version: 13,
    name: `Workflow ${suffix}`, summary: "Runs bounded approved work.", status: "active", triggerMode: "manual",
    goals: ["Produce reviewed output"], nonGoals: ["Deploy automatically"],
    steps: [{
      id: `execute-${suffix}`, kind: "agent_task", name: "Execute approved task", dependsOnStepIds: [`approve-${suffix}`],
      agentId: `agent-${suffix}`, agentBindingId: `agent-binding-${suffix}`, outputType: "patch",
      requestedResources: [{ resourceId: `repository-${suffix}`, capabilities: ["read_metadata", "propose_change"] }],
      modelProfileId: "model-shared", knowledgeCollectionIds: [`knowledge-${suffix}`], toolIds: ["tool-read"],
      maxAttempts: 2, timeoutMinutes: 30, actionMode: "external_action", requiredApprovalAction: `workflow-external-${suffix}`,
    }, { id: `approve-${suffix}`, kind: "approval_gate", name: "Owner approval", dependsOnStepIds: [], approvalAction: `workflow-external-${suffix}` }],
    finalStepIds: [`execute-${suffix}`], additionalRequiredApprovalActions: [`workflow-review-${suffix}`], additionalForbiddenActions: [`Workflow ${suffix} publish forbidden`],
  };
}

function registry(suffixes: readonly string[] = ["one"]) {
  return { workspaceId: "workspace-primary", projects: suffixes.map((suffix) => ({ projectManifest: project(suffix), departmentManifests: [department(suffix)], bindings: [binding(suffix), binding(suffix, "workflow")] })) };
}

function catalog(suffixes: readonly string[] = ["one"]) {
  return { registry: registry(suffixes), agents: suffixes.map((suffix) => ({ bindingId: `agent-binding-${suffix}`, agentManifest: agent(suffix) })), workflows: suffixes.map((suffix) => ({ bindingId: `workflow-binding-${suffix}`, workflowManifest: workflow(suffix) })) };
}

function creation(suffixes: readonly string[] = ["one"]) {
  const workflowCatalog = catalog(suffixes);
  return {
    runId: "run-one", requestId: "request-one-1", createdAt: "2026-08-23T10:15:30.000Z",
    schedulerInput: {
      registry: clone(workflowCatalog.registry),
      policy: { workspaceId: "workspace-primary", status: "active", maxConcurrentRuns: 8, maxQueuedRuns: 512, projectPolicies: suffixes.map((suffix) => ({ projectId: `project-${suffix}`, status: "active", maxQueuedRuns: 256, allowedPriorities: ["P0", "P1", "P2", "P3", "P4"] })) },
      queuedRequests: suffixes.map((suffix, index) => ({ id: `request-${suffix}-${index + 1}`, workspaceId: "workspace-primary", projectId: `project-${suffix}`, bindingId: `workflow-binding-${suffix}`, modelProfileId: "model-shared", idempotencyKey: `idempotency-${suffix}-${index + 1}`, priority: "P2", sequence: index + 1 })),
      runningRuns: [], lastDispatchedProjectId: null,
    },
    workflowCatalog,
  };
}

function initial() {
  const decision = createWorkflowRunSnapshot(creation());
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.ok(decision.snapshot);
  return decision.snapshot;
}

function event(snapshot: { runId: string; revision: number }, kind: string, index: number, extra: Record<string, unknown> = {}) {
  return { eventId: `event-${index}`, runId: snapshot.runId, kind, sequence: snapshot.revision + 1, occurredAt: `2026-08-23T10:15:${String(30 + index).padStart(2, "0")}.000Z`, actorKind: "owner", actorId: "owner-one", ...extra };
}

function apply(snapshot: unknown, lifecycleEvent: unknown) {
  const decision = evaluateWorkflowRunTransition({ snapshot, event: lifecycleEvent });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  assert.ok(decision.nextSnapshot);
  return decision.nextSnapshot;
}

function runStarted() { const snapshot = initial(); return apply(snapshot, event(snapshot, "run_started", 1)); }
function agentReady() {
  const running = runStarted();
  const requested = apply(running, event(running, "approval_requested", 2, { stepId: "approve-one", approvalRequestId: "approval-one" }));
  return apply(requested, event(requested, "approval_granted", 3, { stepId: "approve-one", approvalRequestId: "approval-one" }));
}
function runningAgent() { const snapshot = agentReady(); return apply(snapshot, event(snapshot, "step_started", 4, { stepId: "execute-one" })); }

function parallelAgentStep(stepId: string) {
  return {
    id: stepId, kind: "agent_task", name: `Parallel ${stepId}`, dependsOnStepIds: [],
    agentId: "agent-one", agentBindingId: "agent-binding-one", outputType: "patch",
    requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }],
    modelProfileId: "model-shared", knowledgeCollectionIds: ["knowledge-one"], toolIds: ["tool-read"],
    maxAttempts: 2, timeoutMinutes: 30, actionMode: "none", requiredApprovalAction: null,
  };
}

function parallelRunning() {
  const input = creation() as unknown as { workflowCatalog: { workflows: Array<{ workflowManifest: Record<string, unknown> }> } };
  const manifest = input.workflowCatalog.workflows[0]?.workflowManifest;
  assert.ok(manifest);
  manifest.steps = [parallelAgentStep("parallel-a"), parallelAgentStep("parallel-b")];
  manifest.finalStepIds = ["parallel-a", "parallel-b"];
  const created = createWorkflowRunSnapshot(input); assert.equal(created.verdict, "allow", JSON.stringify(created.reasons)); assert.ok(created.snapshot);
  const running = apply(created.snapshot, event(created.snapshot, "run_started", 1));
  const firstStarted = apply(running, event(running, "step_started", 2, { stepId: "parallel-a" }));
  return apply(firstStarted, event(firstStarted, "step_started", 3, { stepId: "parallel-b" }));
}

function parallelAdmission(snapshot: unknown, existingRequests: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return evaluateModelInvocationAdmission({ snapshot, draft: draft({ stepId: "parallel-a", ...overrides }), existingRequests });
}

function draft(overrides: Record<string, unknown> = {}) {
  return { invocationId: "invocation-one", invocationSequence: 1, stepId: "execute-one", messages: [{ role: "system", content: "Follow the bounded instruction.", toolCallId: null }, { role: "user", content: "Prepare the patch proposal.", toolCallId: null }], contextArtifactIds: ["artifact-b", "artifact-a"], ...overrides };
}

function admission(snapshot: unknown = runningAgent(), overrides: Record<string, unknown> = {}, existingRequests: unknown[] = []) {
  return evaluateModelInvocationAdmission({ snapshot, draft: draft(overrides), existingRequests });
}

function admitted() {
  const snapshot = runningAgent(); const decision = admission(snapshot);
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons)); assert.ok(decision.normalizedRequest);
  return { snapshot, request: decision.normalizedRequest };
}

function result(overrides: Record<string, unknown> = {}) {
  return { invocationId: "invocation-one", outcome: "succeeded", finishReason: "stop", providerId: "provider-local", providerModelId: "model-audit-1", providerModelVersion: "version-1", outputText: "Prepared proposal.", structuredOutput: null, toolCallProposals: [], usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, latencyMs: 25, costUsdMicros: 125, error: null, ...overrides };
}

function codes(decision: { reasons: readonly { code: string }[] }) { return decision.reasons.map((reason) => reason.code); }

test("exports exact frozen enums and bounded limits", () => {
  assert.deepEqual(modelInvocationMessageRoles, ["system", "user", "assistant", "tool"]);
  assert.deepEqual(modelInvocationStatuses, ["admitted", "idempotent", "denied"]);
  assert.deepEqual(modelInvocationResultStatuses, ["succeeded", "failed"]);
  assert.deepEqual(modelInvocationFinishReasons, ["stop", "length", "tool_calls", "content_filter", "error"]);
  assert.deepEqual(modelInvocationVerdicts, ["allow", "idempotent", "deny"]);
  assert.deepEqual(modelInvocationErrorCategories, ["provider_error", "rate_limited", "timeout", "invalid_response", "content_filtered", "unavailable", "unknown"]);
  for (const value of [modelInvocationMessageRoles, modelInvocationStatuses, modelInvocationResultStatuses, modelInvocationFinishReasons, modelInvocationVerdicts, modelInvocationErrorCategories, modelInvocationLimits]) assert.equal(Object.isFrozen(value), true);
  assert.ok(modelInvocationLimits.maxExistingRequests > 0 && modelInvocationLimits.maxInspectedProperties > 0);
});

for (const [values, guard, parser] of [
  [modelInvocationMessageRoles, isModelInvocationMessageRole, parseModelInvocationMessageRole],
  [modelInvocationStatuses, isModelInvocationStatus, parseModelInvocationStatus],
  [modelInvocationResultStatuses, isModelInvocationResultStatus, parseModelInvocationResultStatus],
  [modelInvocationFinishReasons, isModelInvocationFinishReason, parseModelInvocationFinishReason],
  [modelInvocationVerdicts, isModelInvocationVerdict, parseModelInvocationVerdict],
  [modelInvocationErrorCategories, isModelInvocationErrorCategory, parseModelInvocationErrorCategory],
] as const) test(`guards and parsers accept ${values.join(",")}`, () => {
  for (const value of values) { assert.equal(guard(value as never), true); assert.equal(parser(value as never), value); }
  assert.equal(guard("not-canonical" as never), false); assert.equal(parser("not-canonical" as never), null);
});

test("admits a factual invocation only for the real running AI-021 Agent step", () => {
  const decision = admission(); assert.equal(decision.verdict, "allow"); assert.equal(decision.status, "admitted");
  const request = decision.normalizedRequest; assert.ok(request);
  assert.deepEqual({ runId: request.runId, projectId: request.projectId, departmentId: request.departmentId, workflowId: request.workflowId, agentId: request.agentId, bindingId: request.agentBindingId, stepId: request.stepId, attempt: request.attemptNumber, model: request.modelProfileId, tools: request.toolIds }, { runId: "run-one", projectId: "project-one", departmentId: "department-one", workflowId: "workflow-one", agentId: "agent-one", bindingId: "agent-binding-one", stepId: "execute-one", attempt: 1, model: "model-shared", tools: ["tool-read"] });
  assert.deepEqual(request.contextArtifactIds, ["artifact-a", "artifact-b"]);
});

test("queued, pending, approval-gate, review, and terminal states deny", () => {
  assert.equal(admission(initial()).verdict, "deny");
  assert.ok(codes(admission(runStarted())).includes("step_not_running"));
  assert.ok(codes(admission(runStarted(), { stepId: "approve-one" })).includes("wrong_step_kind"));
  const started = runningAgent(); const succeeded = apply(started, event(started, "step_succeeded", 5, { stepId: "execute-one", outputArtifactIds: ["artifact-output"] }));
  const review = apply(succeeded, event(succeeded, "review_started", 6));
  const completed = apply(review, event(review, "run_completed", 7));
  assert.equal(admission(review).verdict, "deny"); assert.equal(admission(completed).verdict, "deny");
});

test("failed, blocked, and cancelled terminal Runs deny before Step diagnostics", () => {
  const started = runningAgent();
  const failed = apply(started, event(started, "step_failed", 5, { stepId: "execute-one", error: { code: "failed", message: "Failed safely.", retryable: false } }));
  const runningForBlock = runStarted();
  const blocked = apply(runningForBlock, event(runningForBlock, "run_blocked", 2, { reasonCode: "owner-block", message: "Blocked safely." }));
  const runningForCancel = runStarted();
  const cancelled = apply(runningForCancel, event(runningForCancel, "run_cancelled", 2, { reasonCode: "owner-cancel", message: "Cancelled safely." }));
  for (const snapshot of [failed, blocked, cancelled]) {
    const decision = admission(snapshot, { stepId: "unknown-step" });
    assert.equal(decision.verdict, "deny"); assert.deepEqual(codes(decision), ["run_not_running"]);
  }
});

test("unknown step and UI-like identity override deny without fallback", () => {
  assert.ok(codes(admission(runningAgent(), { stepId: "execute-other" })).includes("step_not_found"));
  assert.equal(evaluateModelInvocationAdmission({ snapshot: runningAgent(), draft: { ...draft(), projectId: "project-other" }, existingRequests: [] }).verdict, "deny");
});

test("multi-project snapshot cannot be redirected by a draft", () => {
  const input = creation(["one", "two"]); const created = createWorkflowRunSnapshot(input); assert.equal(created.verdict, "allow"); assert.ok(created.snapshot);
  assert.equal(evaluateModelInvocationAdmission({ snapshot: created.snapshot, draft: { ...draft(), stepId: "execute-two" }, existingRequests: [] }).verdict, "deny");
});

test("exact replay is idempotent and fresh", () => {
  const first = admission(); assert.ok(first.normalizedRequest);
  const replay = admission(runningAgent(), {}, [first.normalizedRequest]);
  assert.equal(replay.verdict, "idempotent"); assert.equal(replay.status, "idempotent"); assert.deepEqual(replay.normalizedRequest, first.normalizedRequest); assert.notEqual(replay.normalizedRequest, first.normalizedRequest);
});

test("parallel Step progress preserves admission provenance and exact idempotent replay", () => {
  const bothRunning = parallelRunning();
  assert.deepEqual(bothRunning.stepStates.map((step) => [step.stepId, step.status, step.attemptCount]), [["parallel-a", "running", 1], ["parallel-b", "running", 1]]);
  const admittedDecision = parallelAdmission(bothRunning); assert.equal(admittedDecision.verdict, "allow"); assert.ok(admittedDecision.normalizedRequest);
  const originalRequest = admittedDecision.normalizedRequest; const admittedRevision = originalRequest.runRevision;
  const afterOtherStep = apply(bothRunning, event(bothRunning, "step_succeeded", 4, { stepId: "parallel-b", outputArtifactIds: ["artifact-parallel-b"] }));
  assert.equal(afterOtherStep.revision, admittedRevision + 1); assert.equal(afterOtherStep.stepStates.find((step) => step.stepId === "parallel-a")?.status, "running"); assert.equal(afterOtherStep.stepStates.find((step) => step.stepId === "parallel-a")?.attemptCount, 1);
  const replayInput = { snapshot: afterOtherStep, draft: draft({ stepId: "parallel-a" }), existingRequests: [originalRequest] }; const replayBefore = clone(replayInput);
  const replay = evaluateModelInvocationAdmission(replayInput); const repeatedReplay = evaluateModelInvocationAdmission(replayInput);
  assert.equal(replay.verdict, "idempotent"); assert.equal(replay.status, "idempotent"); assert.equal(replay.normalizedRequest?.runRevision, admittedRevision); assert.deepEqual(replay.normalizedRequest, originalRequest); assert.deepEqual(replay, repeatedReplay); assert.notEqual(replay, repeatedReplay); assert.notEqual(replay.normalizedRequest, originalRequest); assert.equal(Object.isFrozen(replay.normalizedRequest), true); assert.deepEqual(replayInput, replayBefore);
  const resultInput = { snapshot: afterOtherStep, request: originalRequest, result: result() }; const resultBefore = clone(resultInput);
  const accepted = evaluateModelInvocationResult(resultInput); const repeatedResult = evaluateModelInvocationResult(resultInput);
  assert.equal(accepted.verdict, "allow"); assert.equal(accepted.normalizedRequest?.runRevision, admittedRevision); assert.deepEqual(accepted, repeatedResult); assert.notEqual(accepted, repeatedResult); assert.equal(Object.isFrozen(accepted.normalizedRequest), true); assert.equal(Object.isFrozen(accepted.normalizedResult), true); assert.deepEqual(resultInput, resultBefore);
});

test("parallel invocation revision window rejects future and pre-attempt provenance", () => {
  const bothRunning = parallelRunning(); const admittedDecision = parallelAdmission(bothRunning); assert.ok(admittedDecision.normalizedRequest); const request = admittedDecision.normalizedRequest;
  const afterOtherStep = apply(bothRunning, event(bothRunning, "step_succeeded", 4, { stepId: "parallel-b", outputArtifactIds: ["artifact-parallel-b"] }));
  const futureRequest = { ...clone(request), runRevision: afterOtherStep.revision + 1 };
  const futureResult = evaluateModelInvocationResult({ snapshot: afterOtherStep, request: futureRequest, result: result() });
  assert.equal(futureResult.verdict, "deny"); assert.deepEqual(codes(futureResult), ["invalid_run_revision"]); assert.equal(futureResult.reasons[0]?.path, "request.runRevision"); assert.equal(futureResult.normalizedRequest, null); assert.equal(futureResult.normalizedResult, null);
  const futureReplay = parallelAdmission(afterOtherStep, [futureRequest]);
  assert.equal(futureReplay.verdict, "deny"); assert.deepEqual(codes(futureReplay), ["invalid_run_revision"]); assert.equal(futureReplay.reasons[0]?.path, "existingRequests[0].runRevision"); assert.equal(futureReplay.normalizedRequest, null);
  const preAttemptRequest = { ...clone(request), runRevision: 1 };
  const preAttempt = evaluateModelInvocationResult({ snapshot: afterOtherStep, request: preAttemptRequest, result: result() });
  assert.equal(preAttempt.verdict, "deny"); assert.deepEqual(codes(preAttempt), ["invalid_run_revision"]); assert.equal(preAttempt.normalizedRequest, null); assert.equal(preAttempt.normalizedResult, null);
});

test("parallel replay still fails closed for non-revision changes", () => {
  const bothRunning = parallelRunning(); const admittedDecision = parallelAdmission(bothRunning); assert.ok(admittedDecision.normalizedRequest); const request = admittedDecision.normalizedRequest;
  const afterOtherStep = apply(bothRunning, event(bothRunning, "step_succeeded", 4, { stepId: "parallel-b", outputArtifactIds: ["artifact-parallel-b"] }));
  const conflicting = { ...clone(request), messages: [{ role: "user", content: "changed content", toolCallId: null }] };
  const replay = parallelAdmission(afterOtherStep, [conflicting]); assert.equal(replay.verdict, "deny"); assert.deepEqual(codes(replay), ["conflicting_replay"]); assert.equal(replay.normalizedRequest, null);
  const wrongIdentity = evaluateModelInvocationResult({ snapshot: afterOtherStep, request: { ...request, modelProfileId: "model-other" }, result: result() });
  assert.equal(wrongIdentity.verdict, "deny"); assert.deepEqual(codes(wrongIdentity), ["request_identity_mismatch"]); assert.equal(wrongIdentity.normalizedRequest, null); assert.equal(wrongIdentity.normalizedResult, null);
});

test("completed Step and next attempt reject old parallel request and result", () => {
  const bothRunning = parallelRunning(); const admittedDecision = parallelAdmission(bothRunning); assert.ok(admittedDecision.normalizedRequest); const request = admittedDecision.normalizedRequest;
  const afterOtherStep = apply(bothRunning, event(bothRunning, "step_succeeded", 4, { stepId: "parallel-b", outputArtifactIds: ["artifact-parallel-b"] }));
  const afterFirstStep = apply(afterOtherStep, event(afterOtherStep, "step_succeeded", 5, { stepId: "parallel-a", outputArtifactIds: ["artifact-parallel-a"] }));
  const completedResult = evaluateModelInvocationResult({ snapshot: afterFirstStep, request, result: result() });
  assert.equal(completedResult.verdict, "deny"); assert.equal(completedResult.normalizedRequest, null); assert.equal(completedResult.normalizedResult, null);
  const retryTimeline = parallelRunning(); const retryAdmission = parallelAdmission(retryTimeline); assert.ok(retryAdmission.normalizedRequest); const oldRequest = retryAdmission.normalizedRequest;
  const failed = apply(retryTimeline, event(retryTimeline, "step_failed", 4, { stepId: "parallel-a", error: { code: "retry", message: "Retry safely.", retryable: true } }));
  const secondAttempt = apply(failed, event(failed, "step_started", 5, { stepId: "parallel-a" }));
  assert.equal(secondAttempt.stepStates.find((step) => step.stepId === "parallel-a")?.attemptCount, 2);
  const oldResult = evaluateModelInvocationResult({ snapshot: secondAttempt, request: oldRequest, result: result() });
  assert.equal(oldResult.verdict, "deny"); assert.equal(oldResult.normalizedRequest, null); assert.equal(oldResult.normalizedResult, null);
  const oldReplay = parallelAdmission(secondAttempt, [oldRequest]); assert.equal(oldReplay.verdict, "deny"); assert.equal(oldReplay.normalizedRequest, null);
});

test("duplicate invocation ID and duplicate tuple fail closed", () => {
  const first = admission(); assert.ok(first.normalizedRequest);
  assert.ok(codes(admission(runningAgent(), { invocationSequence: 2 }, [first.normalizedRequest])).includes("duplicate_invocation_id"));
  assert.ok(codes(admission(runningAgent(), { invocationId: "invocation-other" }, [first.normalizedRequest])).includes("duplicate_invocation_tuple"));
});

test("same invocation ID and tuple with different normalized content is a conflicting replay", () => {
  const first = admission(); assert.ok(first.normalizedRequest);
  const decision = admission(runningAgent(), { messages: [{ role: "user", content: "different", toolCallId: null }] }, [first.normalizedRequest]);
  assert.equal(decision.verdict, "deny"); assert.deepEqual(codes(decision), ["conflicting_replay"]); assert.equal(decision.normalizedRequest, null);
});

test("admission fail-closed stages preserve absolute, snapshot, existing, draft, and Run precedence", () => {
  const oversized = evaluateModelInvocationAdmission({ snapshot: {}, draft: draft({ messages: Array.from({ length: modelInvocationLimits.maxMessages + 1 }, () => ({ role: "user", content: "x", toolCallId: null })) }), existingRequests: [] });
  assert.deepEqual(codes(oversized), ["limit_exceeded"]); assert.equal(oversized.snapshotDecision, null);
  const invalidSnapshot = evaluateModelInvocationAdmission({ snapshot: {}, draft: { bad: true }, existingRequests: [null] });
  assert.deepEqual(codes(invalidSnapshot), ["invalid_workflow_run_snapshot"]);
  const invalidExisting = evaluateModelInvocationAdmission({ snapshot: runningAgent(), draft: { bad: true }, existingRequests: [null] });
  assert.deepEqual(codes(invalidExisting), ["invalid_existing_request"]);
  const queuedUnknownStep = admission(initial(), { stepId: "unknown-step" });
  assert.deepEqual(codes(queuedUnknownStep), ["run_not_running"]);
});

test("admission delegates tampered lifecycle history to factual AI-021 validation", () => {
  const tampered = clone(runningAgent()) as unknown as Record<string, unknown>; tampered.status = "completed";
  const decision = admission(tampered);
  assert.equal(decision.verdict, "deny"); assert.deepEqual(codes(decision), ["invalid_workflow_run_snapshot"]); assert.equal(decision.snapshotDecision?.verdict, "deny");
});

test("collisions already present inside existing request state deny", () => {
  const first = admission().normalizedRequest; assert.ok(first);
  const duplicateId = { ...clone(first), invocationSequence: 2 };
  assert.equal(admission(runningAgent(), { invocationId: "invocation-new", invocationSequence: 3 }, [first, duplicateId]).verdict, "deny");
  const duplicateTuple = { ...clone(first), invocationId: "invocation-other" };
  assert.equal(admission(runningAgent(), { invocationId: "invocation-new", invocationSequence: 3 }, [first, duplicateTuple]).verdict, "deny");
});

test("existing request source path survives canonical sorting", () => {
  const valid = admission(); assert.ok(valid.normalizedRequest);
  const invalid = { ...clone(valid.normalizedRequest), invocationId: "invocation-a", agentBindingId: "INVALID" };
  const decision = admission(runningAgent(), { invocationId: "invocation-z", invocationSequence: 2 }, [valid.normalizedRequest, invalid]);
  assert.equal(decision.verdict, "deny"); assert.ok(decision.reasons.some((reason) => reason.path === "existingRequests[1].agentBindingId"));
});

test("valid request parser is deterministic, fresh, frozen, and strips no hidden facts", () => {
  const source = admission().normalizedRequest; assert.ok(source); const mutable = clone(source);
  const first = validateAndNormalizeModelInvocationRequest(mutable); const second = validateAndNormalizeModelInvocationRequest(mutable);
  assert.equal(first.verdict, "allow"); assert.deepEqual(first, second); assert.notEqual(first.normalizedRequest, mutable); assert.equal(Object.isFrozen(first.normalizedRequest), true); assert.equal(Object.isFrozen(first.normalizedRequest?.messages), true);
  assert.deepEqual(mutable, clone(source)); assert.equal(Object.hasOwn(first.normalizedRequest!, "resourceRef"), false); assert.equal(Object.hasOwn(first.normalizedRequest!, "connectionId"), false);
});

test("approval actions remain bounded canonical text rather than IDs", () => {
  const source = admission().normalizedRequest; assert.ok(source);
  const decision = validateAndNormalizeModelInvocationRequest({ ...clone(source), requiredApprovalAction: "Owner review required" });
  assert.equal(decision.verdict, "allow"); assert.equal(decision.normalizedRequest?.requiredApprovalAction, "Owner review required");
});

test("valid system-user-assistant-user order is preserved deterministically and immutably", () => {
  const messages = [{ role: "system", content: "bounded system", toolCallId: null }, { role: "user", content: "first request", toolCallId: null }, { role: "assistant", content: "bounded response", toolCallId: null }, { role: "user", content: "follow-up", toolCallId: null }];
  const input = { snapshot: runningAgent(), draft: draft({ messages }), existingRequests: [] }; const before = clone(input);
  const first = evaluateModelInvocationAdmission(input); const repeated = evaluateModelInvocationAdmission(input);
  assert.equal(first.verdict, "allow"); assert.deepEqual(first, repeated); assert.deepEqual(first.normalizedRequest?.messages.map((message) => message.role), ["system", "user", "assistant", "user"]); assert.deepEqual(input, before);
});

test("orphan tool message is denied even with a syntactically valid toolCallId", () => {
  const decision = admission(runningAgent(), { messages: [{ role: "user", content: "request", toolCallId: null }, { role: "tool", content: "unverified result", toolCallId: "call-one" }] });
  assert.equal(decision.verdict, "deny"); assert.equal(decision.normalizedRequest, null); assert.ok(decision.reasons.some((reason) => reason.code === "unverified_tool_message" && reason.path === "draft.messages[1]"));
});

test("leading assistant and system after user violate canonical message ordering", () => {
  const leading = admission(runningAgent(), { messages: [{ role: "assistant", content: "no prior user", toolCallId: null }] });
  assert.equal(leading.verdict, "deny"); assert.ok(leading.reasons.some((reason) => reason.path === "draft.messages[0].role"));
  const lateSystem = admission(runningAgent(), { messages: [{ role: "user", content: "request", toolCallId: null }, { role: "system", content: "late system", toolCallId: null }] });
  assert.equal(lateSystem.verdict, "deny"); assert.ok(lateSystem.reasons.some((reason) => reason.code === "invalid_message_sequence" && reason.path === "draft.messages[1].role"));
});

test("message, context, and existing-request absolute limits deny", () => {
  assert.equal(admission(runningAgent(), { messages: Array.from({ length: modelInvocationLimits.maxMessages + 1 }, () => ({ role: "user", content: "x", toolCallId: null })) }).verdict, "deny");
  assert.equal(admission(runningAgent(), { contextArtifactIds: Array.from({ length: modelInvocationLimits.maxContextArtifactIds + 1 }, (_, index) => `artifact-${index}`) }).verdict, "deny");
  assert.equal(evaluateModelInvocationAdmission({ snapshot: runningAgent(), draft: draft(), existingRequests: Array(modelInvocationLimits.maxExistingRequests + 1).fill(null) }).verdict, "deny");
});

test("hostile getters, proxies, cycles, sets, maps, and sparse arrays deny without throw", () => {
  const getter = {}; Object.defineProperty(getter, "snapshot", { get() { throw new Error("no read"); }, enumerable: true });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const sparse = [draft()]; sparse.length = 2;
  for (const input of [getter, proxy, cycle, new Set([draft()]), new Map([["draft", draft()]]), { snapshot: runningAgent(), draft: draft(), existingRequests: sparse }]) {
    assert.doesNotThrow(() => evaluateModelInvocationAdmission(input)); assert.equal(evaluateModelInvocationAdmission(input).verdict, "deny");
  }
});

test("non-enumerable accessors and symbol fields fail closed without reads", () => {
  let reads = 0; const hidden = { snapshot: runningAgent(), draft: draft(), existingRequests: [] };
  Object.defineProperty(hidden, "hidden", { get() { reads += 1; return "secret"; } });
  const symbolInput = { snapshot: runningAgent(), draft: draft(), existingRequests: [], [Symbol("hidden")]: "secret" };
  assert.equal(evaluateModelInvocationAdmission(hidden).verdict, "deny"); assert.equal(reads, 0);
  assert.equal(evaluateModelInvocationAdmission(symbolInput).verdict, "deny");
});

test("successful text result validates and evaluates with provider audit and integer accounting", () => {
  const { snapshot, request } = admitted(); const validation = validateAndNormalizeModelInvocationResult(result());
  assert.equal(validation.verdict, "allow"); assert.equal(validation.normalizedResult?.costUsdMicros, 125); assert.equal(validation.normalizedResult?.providerModelVersion, "version-1");
  const decision = evaluateModelInvocationResult({ snapshot, request, result: result() }); assert.equal(decision.verdict, "allow"); assert.ok(decision.normalizedRequest); assert.ok(decision.normalizedResult);
});

test("failed result requires structured error and excludes success output", () => {
  const failed = result({ outcome: "failed", finishReason: "error", outputText: null, error: { category: "timeout", code: "deadline", message: "Provider deadline reached.", retryable: true } });
  assert.equal(validateAndNormalizeModelInvocationResult(failed).verdict, "allow");
  assert.equal(validateAndNormalizeModelInvocationResult({ ...failed, outputText: "partial" }).verdict, "deny");
  assert.equal(validateAndNormalizeModelInvocationResult({ ...failed, error: null }).verdict, "deny");
});

test("content filtering uses the canonical failed/content-filtered pairing", () => {
  const succeeded = result({ finishReason: "content_filter" });
  assert.equal(validateAndNormalizeModelInvocationResult(succeeded).verdict, "deny");
  const filtered = result({ outcome: "failed", finishReason: "content_filter", outputText: null, error: { category: "content_filtered", code: "blocked-content", message: "Content was filtered.", retryable: false } });
  const first = validateAndNormalizeModelInvocationResult(filtered); const repeated = validateAndNormalizeModelInvocationResult(filtered);
  assert.equal(first.verdict, "allow"); assert.deepEqual(first, repeated); assert.notEqual(first, repeated); assert.equal(first.normalizedResult?.outcome, "failed"); assert.equal(Object.isFrozen(first.normalizedResult), true); assert.equal(Object.isFrozen(first.normalizedResult?.error), true);
  assert.equal(validateAndNormalizeModelInvocationResult({ ...filtered, error: { category: "provider_error", code: "blocked-content", message: "Content was filtered.", retryable: false } }).verdict, "deny");
  assert.equal(validateAndNormalizeModelInvocationResult({ ...filtered, finishReason: "error" }).verdict, "deny");
});

test("factual result evaluation accepts canonical content filtering and denies mismatches without partial outputs", () => {
  const { snapshot, request } = admitted();
  const filtered = result({ outcome: "failed", finishReason: "content_filter", outputText: null, error: { category: "content_filtered", code: "blocked-content", message: "Content was filtered.", retryable: false } });
  const input = { snapshot, request, result: filtered }; const before = clone(input);
  const allowed = evaluateModelInvocationResult(input); const repeated = evaluateModelInvocationResult(input);
  assert.equal(allowed.verdict, "allow"); assert.equal(allowed.normalizedResult?.outcome, "failed"); assert.deepEqual(allowed, repeated); assert.notEqual(allowed, repeated); assert.notEqual(allowed.normalizedResult, repeated.normalizedResult); assert.equal(Object.isFrozen(allowed.normalizedResult), true); assert.equal(Object.isFrozen(allowed.normalizedResult?.error), true); assert.deepEqual(input, before);
  const denied = evaluateModelInvocationResult({ snapshot, request, result: { ...filtered, finishReason: "error" } });
  assert.equal(denied.verdict, "deny"); assert.equal(denied.normalizedRequest, null); assert.equal(denied.normalizedResult, null);
});

test("empty and whitespace-only outputText do not satisfy successful output invariants", () => {
  assert.equal(validateAndNormalizeModelInvocationResult(result({ outputText: "" })).verdict, "deny");
  assert.equal(validateAndNormalizeModelInvocationResult(result({ outputText: " \n\t " })).verdict, "deny");
  assert.equal(validateAndNormalizeModelInvocationResult(result({ outputText: null, structuredOutput: { status: "ready" } })).verdict, "allow");
  assert.equal(validateAndNormalizeModelInvocationResult(result({ outputText: "meaningful" })).verdict, "allow");
  assert.equal(validateAndNormalizeModelInvocationResult(result({ finishReason: "tool_calls", outputText: null, toolCallProposals: [{ toolCallId: "call-one", toolId: "tool-read", arguments: {} }] })).verdict, "allow");
});

test("provider audit identifiers are bounded single-line printable values with exact paths", () => {
  const safe = result({ providerId: "provider/example:@edge", providerModelId: "family/model:v2@stable", providerModelVersion: "release/2026:08@one" });
  assert.equal(validateAndNormalizeModelInvocationResult(safe).verdict, "allow");
  for (const field of ["providerId", "providerModelId", "providerModelVersion"] as const) {
    for (const value of ["", "   ", "line\nfeed", "carriage\rreturn", "unicode\u2028line", "unicode\u2029paragraph", "control\u0001value", "x".repeat(modelInvocationLimits.maxProviderAuditIdLength + 1)]) {
      const decision = validateAndNormalizeModelInvocationResult(result({ [field]: value }));
      assert.equal(decision.verdict, "deny"); assert.ok(decision.reasons.some((reason) => reason.path === `$.${field}`));
    }
  }
});

test("usage arithmetic and integer money/latency are enforced", () => {
  assert.ok(codes(validateAndNormalizeModelInvocationResult(result({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 14 } }))).includes("usage_mismatch"));
  assert.equal(validateAndNormalizeModelInvocationResult(result({ costUsdMicros: 1.5 })).verdict, "deny");
  assert.equal(validateAndNormalizeModelInvocationResult(result({ latencyMs: -1 })).verdict, "deny");
});

test("allowed tool-call proposal is normalized but never executed", () => {
  const { snapshot, request } = admitted();
  const proposal = result({ finishReason: "tool_calls", outputText: null, toolCallProposals: [{ toolCallId: "call-one", toolId: "tool-read", arguments: { path: "src", flags: [true, 1] } }] });
  const decision = evaluateModelInvocationResult({ snapshot, request, result: proposal });
  assert.equal(decision.verdict, "allow"); assert.deepEqual(decision.normalizedResult?.toolCallProposals[0]?.arguments, { flags: [true, 1], path: "src" });
});

test("forbidden tool and duplicate tool-call IDs deny without partial output", () => {
  const { snapshot, request } = admitted();
  const forbidden = result({ finishReason: "tool_calls", outputText: null, toolCallProposals: [{ toolCallId: "call-one", toolId: "tool-write", arguments: {} }] });
  const denied = evaluateModelInvocationResult({ snapshot, request, result: forbidden }); assert.equal(denied.verdict, "deny"); assert.equal(denied.normalizedRequest, null); assert.equal(denied.normalizedResult, null); assert.ok(codes(denied).includes("tool_call_not_allowed"));
  const duplicate = result({ finishReason: "tool_calls", outputText: null, toolCallProposals: [{ toolCallId: "call-one", toolId: "tool-read", arguments: {} }, { toolCallId: "call-one", toolId: "tool-read", arguments: {} }] });
  assert.ok(codes(validateAndNormalizeModelInvocationResult(duplicate)).includes("duplicate_tool_call_id"));
});

test("tool proposals normalize canonically while forbidden-tool paths retain provider indexes", () => {
  const { snapshot, request } = admitted();
  const proposals = [
    { toolCallId: "call-z", toolId: "tool-read", arguments: { order: 2 } },
    { toolCallId: "call-a", toolId: "tool-read", arguments: { order: 1 } },
  ];
  const forward = evaluateModelInvocationResult({ snapshot, request, result: result({ finishReason: "tool_calls", outputText: null, toolCallProposals: proposals }) });
  const reverse = evaluateModelInvocationResult({ snapshot, request, result: result({ finishReason: "tool_calls", outputText: null, toolCallProposals: [...proposals].reverse() }) });
  assert.equal(forward.verdict, "allow"); assert.deepEqual(forward, reverse); assert.deepEqual(forward.normalizedResult?.toolCallProposals.map((proposal) => proposal.toolCallId), ["call-a", "call-z"]);
  const forbidden = evaluateModelInvocationResult({ snapshot, request, result: result({ finishReason: "tool_calls", outputText: null, toolCallProposals: [proposals[0], { ...proposals[1], toolId: "tool-write" }] }) });
  assert.equal(forbidden.verdict, "deny"); assert.ok(forbidden.reasons.some((reason) => reason.path === "result.toolCallProposals[1].toolId"));
});

test("structured output and arguments are bounded JSON only", () => {
  const deep: Record<string, unknown> = {}; let cursor = deep; for (let index = 0; index <= modelInvocationLimits.maxJsonDepth; index += 1) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; }
  assert.equal(validateAndNormalizeModelInvocationResult(result({ structuredOutput: deep })).verdict, "deny");
  assert.equal(validateAndNormalizeModelInvocationResult(result({ structuredOutput: new Set(["x"]) })).verdict, "deny");
  assert.equal(validateAndNormalizeModelInvocationResult(result({ finishReason: "tool_calls", outputText: null, toolCallProposals: [{ toolCallId: "call-one", toolId: "tool-read", arguments: { bad: undefined } }] })).verdict, "deny");
});

test("result identity and stale current state deny without partial outputs", () => {
  const { snapshot, request } = admitted();
  const wrong = evaluateModelInvocationResult({ snapshot, request, result: result({ invocationId: "invocation-other" }) }); assert.equal(wrong.verdict, "deny"); assert.ok(codes(wrong).includes("invocation_id_mismatch"));
  const succeeded = apply(snapshot, event(snapshot, "step_succeeded", 5, { stepId: "execute-one", outputArtifactIds: ["artifact-output"] }));
  const stale = evaluateModelInvocationResult({ snapshot: succeeded, request, result: result() }); assert.equal(stale.verdict, "deny"); assert.equal(stale.normalizedRequest, null); assert.equal(stale.normalizedResult, null);
});

test("result evaluation preserves snapshot, request, result, identity, and current-state precedence", () => {
  const { snapshot, request } = admitted();
  const invalidSnapshot = evaluateModelInvocationResult({ snapshot: {}, request: null, result: null });
  assert.deepEqual(codes(invalidSnapshot), ["invalid_workflow_run_snapshot"]);
  const invalidRequest = evaluateModelInvocationResult({ snapshot, request: null, result: null });
  assert.deepEqual(codes(invalidRequest), ["invalid_input"]);
  const invalidResult = evaluateModelInvocationResult({ snapshot, request, result: null });
  assert.deepEqual(codes(invalidResult), ["invalid_result"]);
  const wrongStep = evaluateModelInvocationResult({ snapshot, request: { ...request, stepId: "unknown-step" }, result: result() });
  assert.deepEqual(codes(wrongStep), ["request_identity_mismatch"]);
  const succeeded = apply(snapshot, event(snapshot, "step_succeeded", 5, { stepId: "execute-one", outputArtifactIds: ["artifact-output"] }));
  const review = apply(succeeded, event(succeeded, "review_started", 6));
  const currentRevisionRequest = { ...request, runRevision: review.revision };
  const notRunning = evaluateModelInvocationResult({ snapshot: review, request: currentRevisionRequest, result: result() });
  assert.deepEqual(codes(notRunning), ["run_not_running"]); assert.equal(notRunning.normalizedRequest, null); assert.equal(notRunning.normalizedResult, null);
});

test("result evaluation is repeated-deterministic, immutable, fresh, and deeply frozen", () => {
  const { snapshot, request } = admitted(); const input = { snapshot: clone(snapshot), request: clone(request), result: result({ structuredOutput: { summary: ["safe"] }, outputText: null }) }; const before = clone(input);
  const first = evaluateModelInvocationResult(input); const second = evaluateModelInvocationResult(input);
  assert.equal(first.verdict, "allow"); assert.deepEqual(first, second); assert.notEqual(first, second); assert.notEqual(first.normalizedResult, second.normalizedResult); assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.normalizedResult), true); assert.equal(Object.isFrozen(first.normalizedResult?.structuredOutput), true);
});

test("hostile provider results deny without throw or partial outputs", () => {
  const { snapshot, request } = admitted();
  const hostile = Object.defineProperty({}, "invocationId", { enumerable: true, get() { throw new Error("provider getter"); } });
  const cyclic = result({ structuredOutput: {} }) as unknown as Record<string, unknown>;
  (cyclic.structuredOutput as Record<string, unknown>).self = cyclic.structuredOutput;
  for (const candidate of [hostile, new Proxy({}, { ownKeys() { throw new Error("provider proxy"); } }), cyclic]) {
    assert.doesNotThrow(() => evaluateModelInvocationResult({ snapshot, request, result: candidate }));
    const decision = evaluateModelInvocationResult({ snapshot, request, result: candidate }); assert.equal(decision.verdict, "deny"); assert.equal(decision.normalizedRequest, null); assert.equal(decision.normalizedResult, null);
  }
});

test("request factual identities cannot be substituted", () => {
  const { snapshot, request } = admitted();
  for (const [field, value] of [["projectId", "project-other"], ["agentId", "agent-other"], ["agentBindingId", "agent-binding-other"], ["modelProfileId", "model-other"], ["attemptNumber", 2]] as const) {
    const decision = evaluateModelInvocationResult({ snapshot, request: { ...request, [field]: value }, result: result() }); assert.equal(decision.verdict, "deny"); assert.equal(decision.normalizedRequest, null); assert.equal(decision.normalizedResult, null);
  }
});

test("repeated and reversed valid existing collections are deterministic", () => {
  const one = admission().normalizedRequest; assert.ok(one); const two = { ...clone(one), invocationId: "invocation-two", invocationSequence: 2 };
  const input = { snapshot: runningAgent(), draft: draft({ invocationId: "invocation-three", invocationSequence: 3 }), existingRequests: [one, two] };
  const first = evaluateModelInvocationAdmission(input); const repeated = evaluateModelInvocationAdmission(input); const reversed = evaluateModelInvocationAdmission({ ...input, existingRequests: [two, one] });
  assert.deepEqual(first, repeated); assert.deepEqual(first, reversed);
});

test("caller inputs remain unchanged and successful outputs are fresh deeply frozen", () => {
  const input = { snapshot: clone(runningAgent()), draft: draft(), existingRequests: [] }; const before = clone(input);
  const first = evaluateModelInvocationAdmission(input); const second = evaluateModelInvocationAdmission(input);
  assert.deepEqual(input, before); assert.deepEqual(first, second); assert.notEqual(first, second); assert.notEqual(first.normalizedRequest, second.normalizedRequest); assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.normalizedRequest), true); assert.equal(Object.isFrozen(first.normalizedRequest?.messages[0]), true);
});

test("all denies are fail closed and expose no raw or sensitive envelope fields", () => {
  const admissionDeny = admission(initial()); assert.equal(admissionDeny.normalizedRequest, null);
  const { snapshot, request } = admitted(); const resultDeny = evaluateModelInvocationResult({ snapshot, request, result: result({ costUsdMicros: 0.5 }) });
  assert.equal(resultDeny.normalizedRequest, null); assert.equal(resultDeny.normalizedResult, null);
  const serialized = JSON.stringify(admission()); for (const key of ["resourceRef", "connectionId", "credentials", "apiKey", "schedulerInput", "registry"]) assert.equal(serialized.includes(`\"${key}\"`), false);
});

test("production source contains no runtime-provider or side-effect mechanisms", () => {
  const source = readFileSync(new URL("../lib/contracts/model-invocation.ts", import.meta.url), "utf8");
  const forbidden = ["fet" + "ch(", "process" + ".env", "Open" + "AI", "Anth" + "ropic", "Deep" + "Seek", "Q" + "wen", "provider " + "SDK", "tool " + "execution", "filesystem " + "writes", "sh" + "ell", "persis" + "tence", "Date" + ".now", "Math" + ".random"];
  for (const token of forbidden) assert.equal(source.includes(token), false, token);
});
