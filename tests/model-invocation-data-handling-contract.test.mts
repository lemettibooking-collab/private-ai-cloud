import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- hostile contract fixtures intentionally cross unknown boundaries */

const contract = (await import(new URL("../lib/contracts/model-invocation-data-handling.ts", import.meta.url).href)) as typeof import("../lib/contracts/model-invocation-data-handling");
const runContract = (await import(new URL("../lib/contracts/workflow-run.ts", import.meta.url).href)) as typeof import("../lib/contracts/workflow-run");
const routeContract = (await import(new URL("../lib/contracts/model-provider-registry.ts", import.meta.url).href)) as typeof import("../lib/contracts/model-provider-registry");
const invocationContract = (await import(new URL("../lib/contracts/model-invocation.ts", import.meta.url).href)) as typeof import("../lib/contracts/model-invocation");

const { createModelInvocationRequestFingerprint, evaluateModelInvocationDataHandling, isModelInvocationApprovalStatus, isModelInvocationDataHandlingStatus, isModelInvocationDataHandlingVerdict, isModelInvocationEvidenceKind, isModelInvocationRedactionAssessment, isModelInvocationRedactionCategory, modelInvocationApprovalStatuses, modelInvocationDataHandlingLimits, modelInvocationDataHandlingStatuses, modelInvocationDataHandlingVerdicts, modelInvocationEvidenceKinds, modelInvocationRedactionAssessments, modelInvocationRedactionCategories, parseModelInvocationApprovalStatus, parseModelInvocationDataHandlingStatus, parseModelInvocationDataHandlingVerdict, parseModelInvocationEvidenceKind, parseModelInvocationRedactionAssessment, parseModelInvocationRedactionCategory, validateAndNormalizeModelInvocationApprovalEvidence, validateAndNormalizeModelInvocationRedactionEvidence } = contract;
const { createWorkflowRunSnapshot, evaluateWorkflowRunTransition } = runContract;
const { resolveModelInvocationRoute } = routeContract;
const { validateAndNormalizeModelInvocationRequest } = invocationContract;

function clone<T>(value: T): T { return structuredClone(value); }
function frozen(value: unknown): boolean { if (typeof value !== "object" || value === null) return true; return Object.isFrozen(value) && Object.values(value).every(frozen); }
function codes(value: { reasons: readonly { code: string }[] }) { return value.reasons.map((item) => item.code); }
function budget() { return { maxConcurrentRuns: 4, maxAttemptsPerRun: 3, maxRunMinutes: 120, dailyTokenBudget: 1_000_000, monthlyCostBudgetUsdCents: 250_000 }; }
function project(egress = "forbidden") { return { id: "project-one", workspaceId: "workspace-primary", version: 3, name: "Project one", slug: "project-one", summary: "Owner-controlled project context.", kind: "internal_product", status: "active", defaultLocale: "en-US", timeZone: "UTC", dataRegion: "eu", dataClassification: "confidential", goals: ["Operate safely"], nonGoals: ["Autonomous actions"], tags: ["one"], resources: [{ id: "repository-one", kind: "code_repository", label: "Repository one", status: "connected", connectionId: "connection-one", resourceRef: "owner/repository-one", capabilities: ["read_metadata", "propose_change"] }], allowedModelProfileIds: ["model-shared", "model-one"], knowledgeCollectionIds: ["knowledge-one"], policy: { externalActionMode: "approval_required", dataEgressMode: egress, requiredApprovalActions: ["project-review-one"], forbiddenActions: ["Project action forbidden"] }, budget: budget() }; }
function department(egress = "forbidden") { return { id: "department-one", projectId: "project-one", version: 5, code: "development", name: "Department one", summary: "Reviewed work.", status: "active", operatingMode: "approval_gated", goals: ["Build reviewed artifacts"], nonGoals: ["Deploy automatically"], resourceGrants: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }], allowedModelProfileIds: ["model-shared", "model-one"], knowledgeCollectionIds: ["knowledge-one"], enabledWorkflowIds: ["workflow-one"], operatorRoleIds: ["role-owner"], modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: ["model-one"], reviewerModelProfileId: "model-one", independentReviewRequired: true }, policy: { externalActionMode: "approval_required", dataEgressMode: egress, additionalRequiredApprovalActions: ["department-review-one"], additionalForbiddenActions: ["Department publish forbidden"] }, budget: { ...budget(), maxConcurrentRuns: 3, maxAttemptsPerRun: 2, maxRunMinutes: 60 } }; }
function binding(kind: "agent" | "workflow", egress = "forbidden") { return { id: `${kind}-binding-one`, projectId: "project-one", departmentId: "department-one", version: kind === "agent" ? 7 : 8, status: "active", kind, subjectId: `${kind}-one`, requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }], requestedModelProfileIds: ["model-shared", "model-one"], requestedKnowledgeCollectionIds: ["knowledge-one"], requestedBudget: { ...budget(), maxConcurrentRuns: 1, maxAttemptsPerRun: 2, maxRunMinutes: 30 }, externalActionMode: "approval_required", dataEgressMode: egress, additionalRequiredApprovalActions: [kind === "workflow" ? "workflow-external-one" : "agent-review-one"], additionalForbiddenActions: [`${kind} deploy forbidden`] }; }
function projectRegistry(egress = "forbidden") { return { workspaceId: "workspace-primary", projects: [{ projectManifest: project(egress), departmentManifests: [department(egress)], bindings: [binding("agent", egress), binding("workflow", egress)] }] }; }
function agent() { return { id: "agent-one", projectId: "project-one", departmentId: "department-one", version: 11, roleCode: "developer", name: "Developer one", summary: "Creates bounded artifacts.", status: "active", instructionProfileId: "instructions-one", goals: ["Create reviewed artifacts"], nonGoals: ["Deploy automatically"], outputTypes: ["patch", "test_report"], allowedWorkflowIds: ["workflow-one"], allowedToolIds: ["tool-read"], allowedModelProfileIds: ["model-shared", "model-one"], knowledgeCollectionIds: ["knowledge-one"], modelRouting: { primaryModelProfileId: "model-shared", fallbackModelProfileIds: ["model-one"], reviewerModelProfileId: "model-one", independentReviewRequired: true }, additionalRequiredApprovalActions: ["agent-review-one", "workflow-external-one"], additionalForbiddenActions: ["Agent deploy forbidden"] }; }
function workflow() { return { id: "workflow-one", projectId: "project-one", departmentId: "department-one", version: 13, name: "Workflow one", summary: "Runs bounded approved work.", status: "active", triggerMode: "manual", goals: ["Produce reviewed output"], nonGoals: ["Deploy automatically"], steps: [{ id: "execute-one", kind: "agent_task", name: "Execute approved task", dependsOnStepIds: ["approve-one"], agentId: "agent-one", agentBindingId: "agent-binding-one", outputType: "patch", requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata", "propose_change"] }], modelProfileId: "model-shared", knowledgeCollectionIds: ["knowledge-one"], toolIds: ["tool-read"], maxAttempts: 2, timeoutMinutes: 30, actionMode: "external_action", requiredApprovalAction: "workflow-external-one" }, { id: "approve-one", kind: "approval_gate", name: "Owner approval", dependsOnStepIds: [], approvalAction: "workflow-external-one" }], finalStepIds: ["execute-one"], additionalRequiredApprovalActions: ["workflow-review-one"], additionalForbiddenActions: ["Workflow publish forbidden"] }; }
function creation(egress = "forbidden") { const registry = projectRegistry(egress); return { runId: "run-one", requestId: "request-one", createdAt: "2026-08-27T10:15:30.000Z", schedulerInput: { registry: clone(registry), policy: { workspaceId: "workspace-primary", status: "active", maxConcurrentRuns: 8, maxQueuedRuns: 512, projectPolicies: [{ projectId: "project-one", status: "active", maxQueuedRuns: 256, allowedPriorities: ["P0", "P1", "P2", "P3", "P4"] }] }, queuedRequests: [{ id: "request-one", workspaceId: "workspace-primary", projectId: "project-one", bindingId: "workflow-binding-one", modelProfileId: "model-shared", idempotencyKey: "idempotency-one", priority: "P2", sequence: 1 }], runningRuns: [], lastDispatchedProjectId: null }, workflowCatalog: { registry, agents: [{ bindingId: "agent-binding-one", agentManifest: agent() }], workflows: [{ bindingId: "workflow-binding-one", workflowManifest: workflow() }] } }; }
function apply(snapshot: any, kind: string, index: number, extra: Record<string, unknown> = {}) { const decision = evaluateWorkflowRunTransition({ snapshot, event: { eventId: `event-${index}`, runId: snapshot.runId, kind, sequence: snapshot.revision + 1, occurredAt: `2026-08-27T10:15:${30 + index}.000Z`, actorKind: "owner", actorId: "owner-one", ...extra } }); assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons)); assert.ok(decision.nextSnapshot); return decision.nextSnapshot; }
function snapshot(egress = "forbidden") { const created = createWorkflowRunSnapshot(creation(egress)); assert.equal(created.verdict, "allow", JSON.stringify(created.reasons)); assert.ok(created.snapshot); let value = apply(created.snapshot, "run_started", 1); value = apply(value, "approval_requested", 2, { stepId: "approve-one", approvalRequestId: "approval-one" }); value = apply(value, "approval_granted", 3, { stepId: "approve-one", approvalRequestId: "approval-one" }); return apply(value, "step_started", 4, { stepId: "execute-one" }); }
function draft() { return { invocationId: "invocation-one", invocationSequence: 1, stepId: "execute-one", messages: [{ role: "system", content: "System instruction.", toolCallId: null }, { role: "user", content: "Token SECRET", toolCallId: null }], contextArtifactIds: ["artifact-sensitive-sentinel"] }; }
function providerRegistry(egress = "forbidden", count = 1) { const local = egress === "forbidden"; const specs = Array.from({ length: count }, (_, index) => ({ providerId: `provider-${index + 1}`, deploymentId: `deployment-${index + 1}` })); return { workspaceId: "workspace-primary", version: 1, providers: specs.map(({ providerId }) => ({ id: providerId, kind: local ? "local" : "openai", status: "active", deploymentMode: local ? "local" : "remote", supportedDataRegions: ["eu"], supportedDataEgressModes: [egress], capabilities: ["messages", "tool_calls"] })), deployments: specs.map(({ providerId, deploymentId }) => ({ id: deploymentId, providerId, status: "active", providerModelId: `${providerId}/model`, providerModelVersion: `version-${providerId}`, capabilities: ["messages", "tool_calls"], supportedOutputTypes: ["patch", "test_report"], maxInputTokens: 128_000, maxOutputTokens: 16_000, inputCostUsdMicrosPerMillionTokens: 1_000_000, outputCostUsdMicrosPerMillionTokens: 2_000_000, latencyClass: "standard", qualityTier: "reasoning" })), modelProfiles: [{ modelProfileId: "model-shared", status: "active", requiredCapabilities: ["messages", "tool_calls"], supportedOutputTypes: ["patch", "test_report"], candidates: specs.map(({ deploymentId }, index) => ({ deploymentId, priority: index + 1 })) }, { modelProfileId: "model-one", status: "active", requiredCapabilities: ["messages"], supportedOutputTypes: ["patch", "test_report"], candidates: [{ deploymentId: specs[0]?.deploymentId, priority: 1 }] }] }; }
function routeInput(egress = "forbidden", count = 1) { return { projectRegistry: projectRegistry(egress), modelProviderRegistry: providerRegistry(egress, count), invocationAdmission: { snapshot: snapshot(egress), draft: draft(), existingRequests: [] } }; }
function factual(egress = "forbidden", count = 1, candidateIndex = 0) { const input = routeInput(egress, count); const route = resolveModelInvocationRoute(input); assert.equal(route.verdict, "allow", JSON.stringify(route.reasons)); assert.ok(route.routePlan && route.invocationAdmissionDecision?.normalizedRequest); const candidate = [route.routePlan.primary, ...route.routePlan.fallbacks][candidateIndex]; assert.ok(candidate); const identity = { providerId: candidate.providerId, providerKind: candidate.providerKind, deploymentId: candidate.deploymentId, providerModelId: candidate.providerModelId, providerModelVersion: candidate.providerModelVersion }; return { input, request: clone(route.invocationAdmissionDecision.normalizedRequest), candidate, identity }; }
function assessments(request: any, spans: unknown[] = [{ start: 6, end: 12, category: "credential" }]) { return request.messages.map((_: unknown, index: number) => ({ messageIndex: index, assessment: index === 1 && spans.length ? "redacted" : "no_sensitive_data", spans: index === 1 ? spans : [] })); }
function redaction(fact = factual("redacted_only"), overrides: Record<string, unknown> = {}) { return { kind: "redaction", evidenceId: "evidence-redaction", workspaceId: fact.request.workspaceId, projectId: fact.request.projectId, runId: fact.request.runId, invocationId: fact.request.invocationId, runRevision: fact.request.runRevision, stepId: fact.request.stepId, attemptNumber: fact.request.attemptNumber, modelProfileId: fact.request.modelProfileId, candidateIdentity: fact.identity, sourceRequestFingerprint: createModelInvocationRequestFingerprint(fact.request), assessedAt: "2026-08-27T10:15:35.000Z", detectorId: "detector-one", detectorVersion: "version-one", messages: assessments(fact.request), ...overrides }; }
function approval(fact = factual("approved_minimum"), overrides: Record<string, unknown> = {}) { return { kind: "approval", evidenceId: "evidence-approval", approvalRequestId: "egress-approval-one", status: "approved", workspaceId: fact.request.workspaceId, projectId: fact.request.projectId, runId: fact.request.runId, invocationId: fact.request.invocationId, runRevision: fact.request.runRevision, stepId: fact.request.stepId, attemptNumber: fact.request.attemptNumber, modelProfileId: fact.request.modelProfileId, candidateIdentity: fact.identity, sourceRequestFingerprint: createModelInvocationRequestFingerprint(fact.request), purpose: "model_data_egress", approvedByActorKind: "owner", approvedByActorId: "owner-one", decidedAt: "2026-08-27T10:15:35.000Z", expiresAt: "2026-08-27T10:16:00.000Z", reason: null, ...overrides }; }
function evaluation(fact: ReturnType<typeof factual>, evidence: unknown) { return { routeInput: fact.input, candidateIdentity: fact.identity, evidence, evaluatedAt: "2026-08-27T10:15:40.000Z" }; }
function assertDeny(decision: ReturnType<typeof evaluateModelInvocationDataHandling>) { assert.equal(decision.verdict, "deny"); assert.equal(decision.status, "denied"); assert.equal(decision.routeReceipt, null); assert.equal(decision.evidenceDecision, null); assert.equal(decision.permit, null); assert.equal(decision.preparedRequest, null); assert.equal(frozen(decision), true); }

test("exports exact frozen enums, guards, parsers, and limits", () => { const groups = [[modelInvocationDataHandlingVerdicts, isModelInvocationDataHandlingVerdict, parseModelInvocationDataHandlingVerdict], [modelInvocationDataHandlingStatuses, isModelInvocationDataHandlingStatus, parseModelInvocationDataHandlingStatus], [modelInvocationEvidenceKinds, isModelInvocationEvidenceKind, parseModelInvocationEvidenceKind], [modelInvocationRedactionAssessments, isModelInvocationRedactionAssessment, parseModelInvocationRedactionAssessment], [modelInvocationRedactionCategories, isModelInvocationRedactionCategory, parseModelInvocationRedactionCategory], [modelInvocationApprovalStatuses, isModelInvocationApprovalStatus, parseModelInvocationApprovalStatus]] as const; for (const [values, guard, parser] of groups) { assert.equal(Object.isFrozen(values), true); for (const value of values) { assert.equal(guard(value), true); assert.equal(parser(value as never), value); } assert.equal(guard("unknown"), false); assert.equal(parser("unknown" as never), null); } assert.equal(Object.isFrozen(modelInvocationDataHandlingLimits), true); });
test("fingerprint is exact deterministic SHA-256 and key-order independent", () => { const { request } = factual(); const reordered = Object.fromEntries(Object.entries(request).reverse()); const first = createModelInvocationRequestFingerprint(request); assert.match(first ?? "", /^sha256:[0-9a-f]{64}$/u); assert.equal(createModelInvocationRequestFingerprint(request), first); assert.equal(createModelInvocationRequestFingerprint(reordered), first); assert.equal(first?.includes("Token SECRET"), false); assert.equal(createModelInvocationRequestFingerprint({}), null); });
test("every factual request field affects the fingerprint", () => { const { request } = factual(); const original = createModelInvocationRequestFingerprint(request); const variants = Object.keys(request).map((field) => { const value: any = (request as any)[field]; if (field === "messages") return { ...request, messages: request.messages.map((item, index) => index ? { ...item, content: `${item.content}!` } : item) }; if (field === "contextArtifactIds") return { ...request, contextArtifactIds: ["artifact-other"] }; if (field === "toolIds") return { ...request, toolIds: [] }; if (field === "requiredApprovalAction") return { ...request, requiredApprovalAction: "other-action" }; if (field === "outputType") return { ...request, outputType: "test_report" }; if (field === "actionMode") return { ...request, actionMode: "internal_action", requiredApprovalAction: null }; if (typeof value === "number") return { ...request, [field]: value + 1 }; return { ...request, [field]: `${value}-other` }; }); for (const variant of variants) assert.notEqual(createModelInvocationRequestFingerprint(variant), original); const reversed = { ...request, messages: [...request.messages].reverse() }; assert.notEqual(createModelInvocationRequestFingerprint(reversed), original); });
test("standalone redaction validation normalizes reverse spans and retains caller paths", () => { const fact = factual("redacted_only"); const evidence = redaction(fact, { messages: assessments(fact.request, [{ start: 10, end: 12, category: "credential" }, { start: 6, end: 8, category: "personal_data" }]).reverse() }); const before = clone(evidence); const decision = validateAndNormalizeModelInvocationRedactionEvidence(evidence); assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons)); assert.deepEqual(decision.normalizedEvidence?.messages.map((item) => item.messageIndex), [0, 1]); assert.deepEqual(decision.normalizedEvidence?.messages[1]?.spans.map((item) => item.start), [6, 10]); assert.deepEqual(evidence, before); });
test("redaction and approval schemas are exact and fail closed", () => { const red = redaction(); const approved = approval(); assert.equal(validateAndNormalizeModelInvocationRedactionEvidence(red).verdict, "allow"); assert.equal(validateAndNormalizeModelInvocationApprovalEvidence(approved).verdict, "allow"); for (const value of [{ ...red, unknown: "HOSTILE_SENTINEL" }, { ...approved, unknown: "HOSTILE_SENTINEL" }, { ...approved, approvedByActorKind: "admin" }, { ...approved, purpose: "other" }, { ...approved, reason: "not-null" }, { ...approved, approvalRequestId: "" }]) { const decision = (value as any).kind === "redaction" ? validateAndNormalizeModelInvocationRedactionEvidence(value) : validateAndNormalizeModelInvocationApprovalEvidence(value); assert.equal(decision.verdict, "deny"); assert.equal(decision.normalizedEvidence, null); assert.equal(JSON.stringify(decision).includes("HOSTILE_SENTINEL"), false); } });
test("local_only allows exact local candidate with null evidence and preserves artifacts", () => { const fact = factual(); const input = evaluation(fact, null); const before = clone(input); const first = evaluateModelInvocationDataHandling(input); const second = evaluateModelInvocationDataHandling(input); assert.equal(first.verdict, "allow", JSON.stringify(first.reasons)); assert.equal(first.permit?.requirement, "local_only"); assert.deepEqual(first.preparedRequest?.contextArtifactIds, fact.request.contextArtifactIds); assert.deepEqual(first.preparedRequest, fact.request); assert.deepEqual(first, second); assert.notEqual(first, second); assert.notEqual(first.permit, second.permit); assert.equal(frozen(first), true); assert.deepEqual(input, before); });
test("local_only denies evidence and unknown candidates without partial output", () => { const fact = factual(); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, redaction(factual("redacted_only"))))); assertDeny(evaluateModelInvocationDataHandling({ ...evaluation(fact, null), candidateIdentity: { ...fact.identity, deploymentId: "deployment-missing" } })); assertDeny(evaluateModelInvocationDataHandling({ ...evaluation(fact, null), routeInput: {} })); });
test("exact fallback candidate is accepted and partial identity collisions deny", () => { const fact = factual("redacted_only", 2, 1); const allow = evaluateModelInvocationDataHandling(evaluation(fact, redaction(fact))); assert.equal(allow.verdict, "allow", JSON.stringify(allow.reasons)); for (const field of ["providerId", "deploymentId", "providerModelVersion"] as const) assertDeny(evaluateModelInvocationDataHandling({ ...evaluation(fact, redaction(fact)), candidateIdentity: { ...fact.identity, [field]: `${fact.identity[field]}-other` } })); });
test("redaction applies canonical replacements, preserves roles/order/grants, and strips remote artifacts", () => { const fact = factual("redacted_only"); const input = evaluation(fact, redaction(fact)); const before = clone(input); const decision = evaluateModelInvocationDataHandling(input); assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons)); assert.equal(decision.preparedRequest?.messages[1]?.content, "Token [REDACTED:CREDENTIAL]"); assert.deepEqual(decision.preparedRequest?.messages.map((item) => item.role), fact.request.messages.map((item: any) => item.role)); assert.deepEqual(decision.preparedRequest?.contextArtifactIds, []); assert.deepEqual(decision.preparedRequest?.toolIds, fact.request.toolIds); assert.equal(decision.preparedRequest?.actionMode, fact.request.actionMode); assert.equal(decision.preparedRequest?.requiredApprovalAction, fact.request.requiredApprovalAction); assert.equal(validateAndNormalizeModelInvocationRequest(decision.preparedRequest).verdict, "allow"); assert.equal(decision.permit?.preparedRequestFingerprint, createModelInvocationRequestFingerprint(decision.preparedRequest)); assert.equal(decision.permit?.redactedSpanCount, 1); const json = JSON.stringify(decision); assert.equal(json.includes("SECRET"), false); assert.equal(json.includes("artifact-sensitive-sentinel"), false); assert.deepEqual(input, before); });
test("complete no-sensitive-data coverage allows zero spans", () => { const fact = factual("redacted_only"); const evidence = redaction(fact, { messages: assessments(fact.request, []) }); const decision = evaluateModelInvocationDataHandling(evaluation(fact, evidence)); assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons)); assert.equal(decision.permit?.redactedSpanCount, 0); });
test("redaction coverage, assessment, category, range, overlap, and duplicate failures deny", () => { const fact = factual("redacted_only"); const base = redaction(fact); const invalid = [(value: any) => value.messages.pop(), (value: any) => value.messages.push(clone(value.messages[0])), (value: any) => { value.messages[1].messageIndex = 10; }, (value: any) => { value.messages[1].assessment = "no_sensitive_data"; }, (value: any) => { value.messages[1].spans[0].category = "unknown"; }, (value: any) => { value.messages[1].spans[0].end = value.messages[1].spans[0].start; }, (value: any) => { value.messages[1].spans[0].start = -1; }, (value: any) => { value.messages[1].spans[0].end = 100; }, (value: any) => value.messages[1].spans.push({ start: 7, end: 9, category: "credential" }), (value: any) => value.messages[1].spans.push(clone(value.messages[1].spans[0]))]; for (const mutate of invalid) { const value: any = clone(base); mutate(value); const decision = evaluateModelInvocationDataHandling(evaluation(fact, value)); assertDeny(decision); } });
test("UTF-16 boundaries deny split surrogate pairs and allow a complete emoji span", () => { const fact = factual("redacted_only"); fact.input.invocationAdmission.draft.messages[1].content = "A😀B"; const rerouted = resolveModelInvocationRoute(fact.input); assert.equal(rerouted.verdict, "allow"); assert.ok(rerouted.invocationAdmissionDecision?.normalizedRequest && rerouted.routePlan); const request = clone(rerouted.invocationAdmissionDecision.normalizedRequest); const candidate = rerouted.routePlan.primary; const exactFact: any = { input: fact.input, request, candidate, identity: { providerId: candidate.providerId, providerKind: candidate.providerKind, deploymentId: candidate.deploymentId, providerModelId: candidate.providerModelId, providerModelVersion: candidate.providerModelVersion } }; for (const span of [{ start: 2, end: 3, category: "credential" }, { start: 1, end: 2, category: "credential" }]) assertDeny(evaluateModelInvocationDataHandling(evaluation(exactFact, redaction(exactFact, { messages: assessments(request, [span]) })))); const allow = evaluateModelInvocationDataHandling(evaluation(exactFact, redaction(exactFact, { messages: assessments(request, [{ start: 1, end: 3, category: "credential" }]) }))); assert.equal(allow.verdict, "allow", JSON.stringify(allow.reasons)); });
test("redaction evidence binds every factual request and candidate identity", () => { const fact = factual("redacted_only"); const fields = ["workspaceId", "projectId", "runId", "invocationId", "runRevision", "stepId", "attemptNumber", "modelProfileId", "sourceRequestFingerprint"] as const; for (const field of fields) { const evidence: any = redaction(fact); evidence[field] = typeof evidence[field] === "number" ? evidence[field] + 1 : field === "sourceRequestFingerprint" ? `sha256:${"0".repeat(64)}` : `${evidence[field]}-other`; assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, evidence))); } for (const field of ["providerId", "deploymentId", "providerModelVersion"] as const) { const evidence: any = redaction(fact); evidence.candidateIdentity[field] = `${evidence.candidateIdentity[field]}-other`; assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, evidence))); } });
test("redaction timestamps enforce current attempt and evaluated time", () => { const fact = factual("redacted_only"); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, redaction(fact, { assessedAt: "2026-08-27T10:15:33.000Z" })))); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, redaction(fact, { assessedAt: "2026-08-27T10:15:41.000Z" })))); });
test("approval_required allows exact current Owner approval and strips only artifacts", () => { const fact = factual("approved_minimum"); const decision = evaluateModelInvocationDataHandling(evaluation(fact, approval(fact))); assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons)); assert.deepEqual(decision.preparedRequest?.messages, fact.request.messages); assert.deepEqual(decision.preparedRequest?.contextArtifactIds, []); assert.equal(decision.permit?.contextArtifactCountRemoved, 1); assert.equal(JSON.stringify(decision.permit).includes("Token SECRET"), false); assert.equal(JSON.stringify(decision.routeReceipt).includes("Token SECRET"), false); });
test("approval status, actor, purpose, reason, and evidence kind remain fail-closed", () => { const fact = factual("approved_minimum"); for (const status of ["rejected", "revoked"] as const) assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, { status, expiresAt: null, reason: "APPROVAL_REASON_SENTINEL" })))); for (const overrides of [{ approvedByActorKind: "system" }, { purpose: "other" }, { reason: "reason" }, { approvalRequestId: "" }]) assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, overrides)))); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, redaction(factual("redacted_only"))))); });
test("approval expiry boundaries, future decisions, and maximum validity are exact", () => { const fact = factual("approved_minimum"); const atBoundary = evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, { expiresAt: "2026-08-27T10:15:40.000Z" }))); assert.equal(atBoundary.verdict, "allow", JSON.stringify(atBoundary.reasons)); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, { expiresAt: "2026-08-27T10:15:39.999Z" })))); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, { decidedAt: "2026-08-27T10:15:41.000Z", expiresAt: "2026-08-27T10:16:00.000Z" })))); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, { decidedAt: "2026-08-27T10:15:33.000Z" })))); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, { decidedAt: "2026-08-27T10:16:00.000Z", expiresAt: "2026-08-27T10:15:59.000Z" })))); const tooLong = new Date(Date.parse("2026-08-27T10:15:35.000Z") + modelInvocationDataHandlingLimits.maxApprovalValidityMs + 1).toISOString(); assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, { expiresAt: tooLong })))); });
test("approval binds exact request and does not authorize another candidate", () => { const primary = factual("approved_minimum", 2, 0); const fallback = factual("approved_minimum", 2, 1); assertDeny(evaluateModelInvocationDataHandling(evaluation(fallback, approval(primary)))); const wrong = approval(primary, { sourceRequestFingerprint: `sha256:${"0".repeat(64)}` }); assertDeny(evaluateModelInvocationDataHandling(evaluation(primary, wrong))); });
test("hostile roots and collections deny without throwing or partial output", () => { const getter = Object.defineProperty({}, "routeInput", { enumerable: true, get() { throw new Error("HOSTILE_GETTER_SENTINEL"); } }); const proxy = new Proxy({}, { ownKeys() { throw new Error("HOSTILE_PROXY_SENTINEL"); } }); const cycle: any = {}; cycle.self = cycle; class Derived extends Array<unknown> {} for (const value of [getter, proxy, cycle, new Set(), new Map(), new Date(), /x/u, Array(2), new Derived(), { 0: "x", length: 1 }]) { assert.doesNotThrow(() => evaluateModelInvocationDataHandling(value)); const decision = evaluateModelInvocationDataHandling(value); assertDeny(decision); assert.equal(JSON.stringify(decision).includes("HOSTILE_"), false); } });
test("evidence limits enforce exact span boundary and boundary plus one", () => { const fact = factual("redacted_only"); const content = "x".repeat(modelInvocationDataHandlingLimits.maxRedactionSpansPerMessage * 2); fact.input.invocationAdmission.draft.messages[1].content = content; const route = resolveModelInvocationRoute(fact.input); assert.equal(route.verdict, "allow"); assert.ok(route.routePlan && route.invocationAdmissionDecision?.normalizedRequest); const request = clone(route.invocationAdmissionDecision.normalizedRequest); const candidate = route.routePlan.primary; const exactFact: any = { input: fact.input, request, candidate, identity: { providerId: candidate.providerId, providerKind: candidate.providerKind, deploymentId: candidate.deploymentId, providerModelId: candidate.providerModelId, providerModelVersion: candidate.providerModelVersion } }; const spans = Array.from({ length: modelInvocationDataHandlingLimits.maxRedactionSpansPerMessage }, (_, index) => ({ start: index * 2, end: index * 2 + 1, category: "credential" })); assert.equal(validateAndNormalizeModelInvocationRedactionEvidence(redaction(exactFact, { messages: assessments(request, spans) })).verdict, "allow"); assert.equal(validateAndNormalizeModelInvocationRedactionEvidence(redaction(exactFact, { messages: assessments(request, [...spans, { start: 511, end: 512, category: "credential" }]) })).verdict, "deny"); });
test("repeated deny is deterministic and reasons are capped", () => { const fact = factual("redacted_only"); const input = evaluation(fact, redaction(fact, { messages: [] })); const first = evaluateModelInvocationDataHandling(input); const second = evaluateModelInvocationDataHandling(input); assert.deepEqual(second, first); assert.ok(first.reasons.length <= modelInvocationDataHandlingLimits.maxReasons); assertDeny(first); });

test("unmatched structurally valid candidate identity never leaks caller identifiers", () => {
  const fact = factual("redacted_only");
  const input = evaluation(fact, redaction(fact));
  input.candidateIdentity = {
    ...fact.identity,
    providerId: "hostile-provider-sentinel",
    deploymentId: "hostile-deployment-sentinel",
  };

  const decision = evaluateModelInvocationDataHandling(input);

  assertDeny(decision);
  assert.equal(JSON.stringify(decision).includes("hostile-provider-sentinel"), false);
  assert.equal(JSON.stringify(decision).includes("hostile-deployment-sentinel"), false);
  assert.ok(decision.reasons.every((item) => item.providerId === null));
  assert.ok(decision.reasons.every((item) => item.deploymentId === null));
});

test("caller evidenceId never leaks from redaction denial paths", () => {
  const fact = factual("redacted_only");
  const cases = [
    redaction(fact, { evidenceId: "evidence-sensitive-sentinel", runId: "run-other" }),
    redaction(fact, { evidenceId: "evidence-sensitive-sentinel", assessedAt: "2026-08-27T10:15:41.000Z" }),
  ];

  for (const evidence of cases) {
    const decision = evaluateModelInvocationDataHandling(evaluation(fact, evidence));
    assertDeny(decision);
    assert.equal(JSON.stringify(decision).includes("evidence-sensitive-sentinel"), false);
    assert.ok(decision.reasons.every((item) => item.evidenceId === null));
  }
});

test("caller evidenceId never leaks from approval denial paths", () => {
  const fact = factual("approved_minimum");
  const cases = [
    approval(fact, { evidenceId: "evidence-sensitive-sentinel", runId: "run-other" }),
    approval(fact, { evidenceId: "evidence-sensitive-sentinel", status: "rejected", expiresAt: null, reason: "approval-reason-sentinel" }),
    approval(fact, { evidenceId: "evidence-sensitive-sentinel", expiresAt: "2026-08-27T10:15:39.999Z" }),
    approval(fact, { evidenceId: "evidence-sensitive-sentinel", decidedAt: "2026-08-27T10:15:41.000Z" }),
  ];

  for (const evidence of cases) {
    const decision = evaluateModelInvocationDataHandling(evaluation(fact, evidence));
    assertDeny(decision);
    const json = JSON.stringify(decision);
    assert.equal(json.includes("evidence-sensitive-sentinel"), false);
    assert.equal(json.includes("approval-reason-sentinel"), false);
    assert.ok(decision.reasons.every((item) => item.evidenceId === null));
  }
});

test("post-membership deny reasons use only factual candidate context", () => {
  const fact = factual("redacted_only");
  const callerIdentity = clone(fact.identity);
  const evidence = redaction(fact, {
    evidenceId: "evidence-sensitive-sentinel",
    assessedAt: "2026-08-27T10:15:41.000Z",
  });

  const decision = evaluateModelInvocationDataHandling({
    ...evaluation(fact, evidence),
    candidateIdentity: callerIdentity,
  });

  assertDeny(decision);
  assert.ok(decision.reasons.length > 0);
  assert.ok(decision.reasons.every((item) => item.providerId === fact.candidate.providerId));
  assert.ok(decision.reasons.every((item) => item.deploymentId === fact.candidate.deploymentId));
  assert.ok(decision.reasons.every((item) => item.evidenceId === null));
  assert.equal(JSON.stringify(decision).includes("evidence-sensitive-sentinel"), false);
  assert.equal(JSON.stringify(decision).includes("candidateIdentity"), false);
});

test("all five candidate identity fields participate in exact membership", () => {
  const fact = factual("redacted_only", 2, 0);
  const fields = [
    "providerId",
    "providerKind",
    "deploymentId",
    "providerModelId",
    "providerModelVersion",
  ] as const;

  for (const field of fields) {
    const candidateIdentity = { ...fact.identity } as Record<string, unknown>;
    candidateIdentity[field] = field === "providerKind" ? "mock" : `${candidateIdentity[field]}-other`;
    const decision = evaluateModelInvocationDataHandling({
      ...evaluation(fact, redaction(fact)),
      candidateIdentity,
    });
    assertDeny(decision);
  }
});

test("fingerprint distinguishes individual message fields and array fields", () => {
  const { request } = factual();
  const original = createModelInvocationRequestFingerprint(request);
  const roleChanged = clone(request) as any;
  roleChanged.messages[1].role = "assistant";
  const contentChanged = clone(request) as any;
  contentChanged.messages[1].content = "Different content";
  const toolCallChanged = clone(request) as any;
  toolCallChanged.messages[1].toolCallId = "tool-call-one";
  const contextChanged = { ...clone(request), contextArtifactIds: ["artifact-other"] };
  const toolsChanged = { ...clone(request), toolIds: [] };

  assert.notEqual(createModelInvocationRequestFingerprint(contentChanged), original);
  assert.notEqual(createModelInvocationRequestFingerprint(contextChanged), original);
  assert.notEqual(createModelInvocationRequestFingerprint(toolsChanged), original);
  assert.equal(createModelInvocationRequestFingerprint(roleChanged), null);
  assert.equal(createModelInvocationRequestFingerprint(toolCallChanged), null);
  assert.notEqual(createModelInvocationRequestFingerprint({ ...request, messages: [...request.messages].reverse() }), original);
});

test("redaction supports every category, multiple messages, and adjacent spans", () => {
  const fact = factual("redacted_only");
  fact.input.invocationAdmission.draft.messages = [
    { role: "system", content: "ab", toolCallId: null },
    { role: "user", content: "abcdefghijkl", toolCallId: null },
  ];
  const routed = resolveModelInvocationRoute(fact.input);
  assert.equal(routed.verdict, "allow", JSON.stringify(routed.reasons));
  assert.ok(routed.routePlan && routed.invocationAdmissionDecision?.normalizedRequest);
  const candidate = routed.routePlan.primary;
  const exactFact: any = {
    input: fact.input,
    request: clone(routed.invocationAdmissionDecision.normalizedRequest),
    candidate,
    identity: {
      providerId: candidate.providerId,
      providerKind: candidate.providerKind,
      deploymentId: candidate.deploymentId,
      providerModelId: candidate.providerModelId,
      providerModelVersion: candidate.providerModelVersion,
    },
  };
  const categories = [...modelInvocationRedactionCategories];
  const evidence = redaction(exactFact, {
    messages: [
      { messageIndex: 0, assessment: "redacted", spans: [{ start: 0, end: 1, category: "credential" }] },
      {
        messageIndex: 1,
        assessment: "redacted",
        spans: categories.map((category, index) => ({ start: index * 2, end: index * 2 + 2, category })),
      },
    ],
  });

  const decision = evaluateModelInvocationDataHandling(evaluation(exactFact, evidence));

  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  for (const category of categories) {
    assert.match(decision.preparedRequest?.messages[1]?.content ?? "", new RegExp(`REDACTED:${category.toUpperCase()}`));
  }
  assert.equal(decision.permit?.redactedSpanCount, categories.length + 1);
});

test("overlap diagnostics retain the original caller span index after sorting", () => {
  const fact = factual("redacted_only");
  const evidence = redaction(fact, {
    messages: assessments(fact.request, [
      { start: 8, end: 12, category: "credential" },
      { start: 6, end: 10, category: "personal_data" },
    ]),
  });

  const decision = validateAndNormalizeModelInvocationRedactionEvidence(evidence);

  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reasons.some((item) => item.code === "overlapping_redaction_span"
    && item.path === "$.messages[1].spans[0]"));
  assert.equal(decision.normalizedEvidence, null);
});

test("approval reason and validity boundaries are exact", () => {
  const fact = factual("approved_minimum");
  const rejectedAtLimit = approval(fact, {
    status: "rejected",
    expiresAt: null,
    reason: "r".repeat(modelInvocationDataHandlingLimits.maxApprovalReasonLength),
  });
  const rejectedOverLimit = {
    ...rejectedAtLimit,
    reason: "r".repeat(modelInvocationDataHandlingLimits.maxApprovalReasonLength + 1),
  };
  assert.equal(validateAndNormalizeModelInvocationApprovalEvidence(rejectedAtLimit).verdict, "allow");
  assert.equal(validateAndNormalizeModelInvocationApprovalEvidence(rejectedOverLimit).verdict, "deny");

  const decidedAt = "2026-08-27T10:15:35.000Z";
  const exactExpiry = new Date(Date.parse(decidedAt)
    + modelInvocationDataHandlingLimits.maxApprovalValidityMs).toISOString();
  const overExpiry = new Date(Date.parse(exactExpiry) + 1).toISOString();
  const exactInput = evaluation(fact, approval(fact, { decidedAt, expiresAt: exactExpiry }));
  exactInput.evaluatedAt = "2026-08-27T10:15:40.000Z";
  assert.equal(evaluateModelInvocationDataHandling(exactInput).verdict, "allow");
  assertDeny(evaluateModelInvocationDataHandling(evaluation(fact, approval(fact, { decidedAt, expiresAt: overExpiry }))));
});

test("total redaction span limit is reached exactly and then denied", () => {
  const fact = factual("redacted_only");
  const perMessage = modelInvocationDataHandlingLimits.maxRedactionSpansPerMessage;
  const messageCount = modelInvocationDataHandlingLimits.maxTotalRedactionSpans / perMessage;
  const messages = Array.from({ length: messageCount }, (_, messageIndex) => ({
    messageIndex,
    assessment: "redacted",
    spans: Array.from({ length: perMessage }, (_, spanIndex) => ({
      start: spanIndex * 2,
      end: spanIndex * 2 + 1,
      category: "credential",
    })),
  }));
  const exactEvidence = redaction(fact, { messages });
  const overEvidence = redaction(fact, {
    messages: [...messages, {
      messageIndex: messageCount,
      assessment: "redacted",
      spans: [{ start: 0, end: 1, category: "credential" }],
    }],
  });

  assert.equal(validateAndNormalizeModelInvocationRedactionEvidence(exactEvidence).verdict, "allow");
  assert.equal(validateAndNormalizeModelInvocationRedactionEvidence(overEvidence).verdict, "deny");
});

test("bounded snapshot string, array, and depth limits distinguish exact from plus one", () => {
  const exactString = { unknown: "x".repeat(modelInvocationDataHandlingLimits.maxEnvelopeStringLength) };
  const oversizedString = { unknown: "x".repeat(modelInvocationDataHandlingLimits.maxEnvelopeStringLength + 1) };
  assert.ok(!codes(validateAndNormalizeModelInvocationRedactionEvidence(exactString)).includes("limit_exceeded"));
  assert.ok(codes(validateAndNormalizeModelInvocationRedactionEvidence(oversizedString)).includes("limit_exceeded"));

  const exactArray = Array.from({ length: modelInvocationDataHandlingLimits.maxEnvelopeArrayLength }, () => null);
  const oversizedArray = [...exactArray, null];
  assert.ok(!codes(validateAndNormalizeModelInvocationRedactionEvidence(exactArray)).includes("limit_exceeded"));
  assert.ok(codes(validateAndNormalizeModelInvocationRedactionEvidence(oversizedArray)).includes("limit_exceeded"));

  const nested = (depth: number) => {
    const root: Record<string, unknown> = {};
    let current = root;
    for (let index = 0; index < depth; index += 1) {
      current.next = {};
      current = current.next as Record<string, unknown>;
    }
    return root;
  };
  assert.ok(!codes(validateAndNormalizeModelInvocationRedactionEvidence(nested(modelInvocationDataHandlingLimits.maxEnvelopeDepth))).includes("limit_exceeded"));
  assert.ok(codes(validateAndNormalizeModelInvocationRedactionEvidence(nested(modelInvocationDataHandlingLimits.maxEnvelopeDepth + 1))).includes("limit_exceeded"));
});

test("bounded snapshot property budget accepts exact inspection and denies plus one", () => {
  const input: Record<string, null> = Object.create(null) as Record<string, null>;
  for (let index = 0; index < modelInvocationDataHandlingLimits.maxInspectedProperties; index += 1) {
    input[`property-${index}`] = null;
  }

  const exactDecision = validateAndNormalizeModelInvocationRedactionEvidence(input);
  assert.equal(exactDecision.verdict, "deny");
  assert.equal(codes(exactDecision).includes("limit_exceeded"), false);

  input["property-over-limit"] = null;
  const overDecision = validateAndNormalizeModelInvocationRedactionEvidence(input);
  assert.equal(overDecision.verdict, "deny");
  assert.equal(codes(overDecision).includes("limit_exceeded"), true);
});

test("reason cap is reached by independent structural evidence errors", () => {
  const fact = factual("redacted_only");
  const messages = Array.from({ length: modelInvocationDataHandlingLimits.maxMessages }, (_, index) => ({
    messageIndex: -index - 1,
    assessment: "invalid-assessment",
    spans: "invalid-spans",
  }));
  const decision = validateAndNormalizeModelInvocationRedactionEvidence(redaction(fact, { messages }));

  assert.equal(decision.verdict, "deny");
  assert.equal(decision.reasons.length, modelInvocationDataHandlingLimits.maxReasons);
});

test("nested hostile evidence and candidate values deny without sentinel leakage", () => {
  const redactionFact = factual("redacted_only");
  const getterEvidence = redaction(redactionFact);
  Object.defineProperty(getterEvidence.messages[1], "spans", {
    enumerable: true,
    get() { throw new Error("nested-getter-sentinel"); },
  });
  const proxyIdentity = new Proxy(redactionFact.identity, {
    ownKeys() { throw new Error("nested-proxy-sentinel"); },
  });
  const sparseEvidence = redaction(redactionFact);
  sparseEvidence.messages[1].spans = Array(2);
  class DerivedSpans extends Array<unknown> {}
  const derivedEvidence = redaction(redactionFact);
  derivedEvidence.messages[1].spans = new DerivedSpans();
  const nestedValues = [new Set(), new Map(), new Date(), /nested-regexp-sentinel/u];

  const inputs = [
    evaluation(redactionFact, getterEvidence),
    { ...evaluation(redactionFact, redaction(redactionFact)), candidateIdentity: proxyIdentity },
    evaluation(redactionFact, sparseEvidence),
    evaluation(redactionFact, derivedEvidence),
    ...nestedValues.map((value) => evaluation(redactionFact, redaction(redactionFact, { detectorId: value }))),
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => evaluateModelInvocationDataHandling(input));
    const decision = evaluateModelInvocationDataHandling(input);
    assertDeny(decision);
    const json = JSON.stringify(decision);
    for (const sentinel of ["nested-getter-sentinel", "nested-proxy-sentinel", "nested-regexp-sentinel"]) {
      assert.equal(json.includes(sentinel), false);
    }
  }
});

test("production source has only pure deterministic hashing and no execution side effects", () => { const source = readFileSync(new URL("../lib/contracts/model-invocation-data-handling.ts", import.meta.url), "utf8"); assert.match(source, /createHash/u); for (const token of ["locale" + "Compare", "Date" + ".now", "random" + "UUID", "process" + ".env", "fet" + "ch(", "provider" + ".run", "provider" + ".health", "execute" + "ModelInvocation", 'from "open' + 'ai"', 'from "node:' + 'fs"', "console" + ".", "set" + "Timeout"]) assert.equal(source.includes(token), false, token); assert.equal(source.includes("JSON" + ".stringify(input)"), false); });
