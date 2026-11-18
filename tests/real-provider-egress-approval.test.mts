/* eslint-disable @typescript-eslint/no-explicit-any -- contract fixtures cross untyped snapshot and evidence boundaries */
// M2 smoke Owner egress approval: ephemeral, exact-invocation-bound, latched once, fixed 10-minute
// lifetime, never renewed. Factual inputs: the smoke Run definition, the real route resolution, the
// real request fingerprint and the real data-handling contract. No database, no network.
import assert from "node:assert/strict";
import test from "node:test";

const smoke = (await import(
  new URL("../lib/composition/real-provider-smoke.ts", import.meta.url).href
)) as typeof import("../lib/composition/real-provider-smoke");
const runContract = (await import(
  new URL("../lib/contracts/workflow-run.ts", import.meta.url).href
)) as typeof import("../lib/contracts/workflow-run");
const routeContract = (await import(
  new URL("../lib/contracts/model-provider-registry.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-provider-registry");
const dataHandling = (await import(
  new URL("../lib/contracts/model-invocation-data-handling.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-invocation-data-handling");

const ownerId = "owner-m2";
const runId = "m2-approval-run";
const minute = 60_000;
const t0 = Date.parse("2026-09-30T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const model = {
  identity: {
    providerId: "provider-openai", providerKind: "openai" as const, deploymentId: "deployment-openai-m2",
    providerModelId: "gpt-m2-alias", providerRequestModelId: "gpt-m2-pinned", providerModelVersion: "gpt-m2-pinned-2026-01-01",
  },
  maxInputTokens: 2_000,
  maxOutputTokens: 16,
  inputCostUsdMicrosPerMillionTokens: 150_000,
  outputCostUsdMicrosPerMillionTokens: 600_000,
};

function transition(snapshot: any, kind: string, at: number, extra: Record<string, unknown> = {}) {
  const decision = runContract.evaluateWorkflowRunTransition({
    snapshot,
    event: {
      eventId: `event-${kind}`, runId: snapshot.runId, kind, sequence: snapshot.revision + 1, occurredAt: iso(at),
      actorKind: "owner", actorId: ownerId, ...extra,
    },
  });
  assert.equal(decision.verdict, "allow", JSON.stringify(decision.reasons));
  return decision.nextSnapshot!;
}

// The factual route input and resolver input the runtime builds for one smoke invocation.
function facts(label?: string) {
  const state = smoke.createRealProviderSmokeState({ workspaceId: "workspace-primary", runId, createdAt: iso(t0 - 3_000), model });
  let snapshot = transition(state.snapshot, "run_started", t0 - 2_000);
  snapshot = transition(snapshot, "step_started", t0 - 1_000, { stepId: smoke.realProviderSmokeStepId });
  const command = smoke.realProviderSmokeAdvanceCommand(runId, ownerId, snapshot.revision, label);
  const routeInput = {
    projectRegistry: state.projectRegistry,
    modelProviderRegistry: state.modelProviderRegistry,
    invocationAdmission: { snapshot, draft: command.agentInputs[0].invocationDraft, existingRequests: [] },
  };
  const route = routeContract.resolveModelInvocationRoute(routeInput);
  assert.equal(route.verdict, "allow", JSON.stringify(route.reasons));
  const request = route.invocationAdmissionDecision!.normalizedRequest!;
  const candidate = route.routePlan!.primary;
  assert.equal(candidate.dataHandlingRequirement, "approval_required");
  const candidateIdentity = {
    providerId: candidate.providerId, providerKind: candidate.providerKind, deploymentId: candidate.deploymentId,
    providerModelId: candidate.providerModelId, providerRequestModelId: candidate.providerRequestModelId,
    providerModelVersion: candidate.providerModelVersion,
  };
  const resolverInput = (evaluatedAt: number, overrides: Record<string, unknown> = {}) => ({
    requirement: "approval_required" as const,
    workspaceId: request.workspaceId, projectId: request.projectId, runId: request.runId,
    invocationId: request.invocationId, runRevision: request.runRevision, stepId: request.stepId,
    attemptNumber: request.attemptNumber, modelProfileId: request.modelProfileId,
    candidateIdentity: { ...candidateIdentity }, evaluatedAt: iso(evaluatedAt),
    sourceRequestFingerprint: dataHandling.createModelInvocationRequestFingerprint(request)!,
    ...overrides,
  });
  const evaluate = (evidence: unknown, evaluatedAt: number) => dataHandling.evaluateModelInvocationDataHandling({
    routeInput, candidateIdentity, evidence, evaluatedAt: iso(evaluatedAt),
  });
  return { request, candidateIdentity, resolverInput, evaluate };
}

const approval = (labels?: readonly (string | undefined)[]) => smoke.realProviderSmokeEgressApproval({
  ownerId, runId, expectedIdentity: model.identity, ...(labels ? { attemptLabels: labels } : {}),
});

test("RED→GREEN: a second resolution after 11 minutes returns the ORIGINAL approval, never a renewed one; the contract denies it as expired", async () => {
  const f = facts();
  const resolver = approval();
  const first: any = await resolver.resolve(f.resolverInput(t0));
  assert.equal(first.decidedAt, iso(t0));
  assert.equal(first.expiresAt, iso(t0 + 10 * minute));
  const later: any = await resolver.resolve(f.resolverInput(t0 + 11 * minute));
  assert.equal(later.decidedAt, iso(t0), "decidedAt is fixed at the first factual use");
  assert.equal(later.expiresAt, iso(t0 + 10 * minute), "expiresAt is never extended");
  assert.equal(later, first, "the same immutable evidence object, not a replacement");
  assert.equal(Object.isFrozen(first) && Object.isFrozen(first.candidateIdentity), true);
  // The existing data-handling contract: valid inside the window, denied after it.
  assert.equal(f.evaluate(first, t0 + 5 * minute).verdict, "allow");
  const expired = f.evaluate(later, t0 + 11 * minute);
  assert.equal(expired.verdict, "deny");
  assert.ok(expired.reasons.some((reason) => reason.code === "approval_expired"), JSON.stringify(expired.reasons));
});

test("A. an exact replay inside the validity window returns the same evidence", async () => {
  const f = facts();
  const resolver = approval();
  const first = await resolver.resolve(f.resolverInput(t0));
  assert.equal(await resolver.resolve(f.resolverInput(t0 + minute)), first);
  assert.equal(await resolver.resolve(f.resolverInput(t0 + 9 * minute)), first);
});

test("B–E. after the latch, a changed fingerprint, revision, attempt or candidate identity gets no evidence (and never a new approval)", async () => {
  const f = facts();
  for (const [name, overrides] of [
    ["B sourceRequestFingerprint", { sourceRequestFingerprint: `sha256:${"0".repeat(64)}` }],
    ["C runRevision", { runRevision: f.request.runRevision + 1 }],
    ["D attemptNumber", { attemptNumber: f.request.attemptNumber + 1 }],
    ["E candidateIdentity", { candidateIdentity: { ...f.candidateIdentity, providerModelVersion: "gpt-m2-other" } }],
    ["workspace", { workspaceId: "tenant-b" }],
    ["project", { projectId: "other-project" }],
    ["model profile", { modelProfileId: "other-profile" }],
  ] as const) {
    const resolver = approval();
    const first = await resolver.resolve(f.resolverInput(t0));
    assert.ok(first, name);
    assert.equal(await resolver.resolve(f.resolverInput(t0 + minute, overrides)), null, name);
    // The original latch is untouched by the rejected request.
    assert.equal(await resolver.resolve(f.resolverInput(t0 + 2 * minute)), first, name);
  }
  // Before any latch, a request for another candidate identity is refused outright.
  assert.equal(await approval().resolve(f.resolverInput(t0, { candidateIdentity: { ...f.candidateIdentity, providerId: "other" } })), null);
});

test("F. a different invocation gets nothing unless it was explicitly approved as its own attempt", async () => {
  const f = facts();
  const retry = facts("retry");
  const onlyFirst = approval();
  assert.equal(await onlyFirst.resolve(retry.resolverInput(t0)), null, "no wildcard");
  assert.equal(await onlyFirst.resolve(f.resolverInput(t0, { invocationId: `${runId}-other-invocation` })), null);
  assert.equal(await onlyFirst.resolve(f.resolverInput(t0, { runId: "other-run" })), null);
  assert.equal(await onlyFirst.resolve({ ...f.resolverInput(t0), requirement: "redaction_required" } as never), null);
});

test("G. an explicitly approved retry invocation has its own separate, fixed lifetime", async () => {
  const f = facts();
  const retry = facts("retry");
  const resolver = approval([undefined, "retry"]);
  const first: any = await resolver.resolve(f.resolverInput(t0));
  const second: any = await resolver.resolve(retry.resolverInput(t0 + 30 * minute));
  assert.notEqual(second, first);
  assert.equal(second.invocationId, retry.request.invocationId);
  assert.equal(second.decidedAt, iso(t0 + 30 * minute));
  assert.equal(second.expiresAt, iso(t0 + 40 * minute));
  // Neither latch moves the other.
  assert.equal(await resolver.resolve(f.resolverInput(t0 + 31 * minute)), first);
  assert.equal(first.expiresAt, iso(t0 + 10 * minute));
  assert.equal(retry.evaluate(second, t0 + 35 * minute).verdict, "allow");
  assert.equal(f.evaluate(first, t0 + 31 * minute).verdict, "deny");
});
