import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial boundary fixtures intentionally cross unknown */

const accessContract = (await import(
  new URL("../lib/workflows/workflow-runtime-access.ts", import.meta.url).href
)) as typeof import("../lib/workflows/workflow-runtime-access");
const {
  createAuthorizedWorkflowRuntimeAccess,
  workflowRuntimeAccessActions,
  isWorkflowRuntimeAccessAction,
  parseWorkflowRuntimeAccessAction,
} = accessContract;

const context = { actorId: "owner-one", workspaceId: "workspace-primary" };

function runtimeResponse(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "allow",
    status: "running",
    reasons: [],
    runId: "run-secret",
    revision: 7,
    workflowStatus: "running",
    currentStepIds: ["step-running"],
    readyStepIds: ["step-ready"],
    waitingApproval: null,
    retryPending: null,
    lastStepResult: null,
    ...overrides,
  } as any;
}

function command(runId = "run-secret", overrides: Record<string, unknown> = {}) {
  return {
    kind: "start",
    commandId: "command-one",
    runId,
    expectedRevision: 7,
    actorId: "self-asserted-owner",
    ...overrides,
  };
}

function overview(runId = "run-secret") {
  return {
    runId,
    projectId: "project-secret",
    workflowId: "workflow-secret",
    status: "running",
    revision: 7,
    createdAt: "2026-09-03T10:00:00.000Z",
    startedAt: "2026-09-03T10:00:01.000Z",
    completedAt: null,
    currentStepIds: ["step-running"],
    readyStepIds: [],
    approval: null,
    latestModelInvocation: null,
    modelUsage: {
      invocationCount: 0,
      succeededCount: 0,
      failedCount: 0,
      ambiguousCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostUsdMicros: 0,
      lastProviderId: null,
      lastProviderModelId: null,
      lastProviderRequestModelId: null,
      lastProviderModelVersion: null,
    },
  };
}

function fixture(options: {
  authorize?: (input: any) => unknown | Promise<unknown>;
  execute?: (input: any) => unknown | Promise<unknown>;
  overview?: (runId: string) => unknown | Promise<unknown>;
  audit?: (runId: string, limit?: number) => unknown | Promise<unknown>;
  usage?: (runId: string) => unknown | Promise<unknown>;
  approvals?: (limit?: number) => unknown | Promise<unknown>;
} = {}) {
  const calls = { authorize: [] as any[], execute: [] as any[], overview: [] as any[],
    audit: [] as any[], usage: [] as any[], approvals: [] as any[] };
  const access = createAuthorizedWorkflowRuntimeAccess({
    runtimeService: {
      async execute(input: any) {
        calls.execute.push(input);
        return options.execute?.(input) ?? runtimeResponse({ runId: input.runId });
      },
    } as any,
    readModel: {
      async getRunOverview(runId: string) {
        calls.overview.push(runId);
        return options.overview?.(runId) ?? { verdict: "allow", reason: null, data: overview(runId) };
      },
      async getRunAuditTimeline(runId: string, limit?: number) {
        calls.audit.push([runId, limit]);
        return options.audit?.(runId, limit) ?? { verdict: "allow", reason: null, data: [{
          eventType: "workflow.run_started", actorKind: "workflow_runtime",
          actorId: "workflow-runtime", runId, metadata: { runId, revision: 1 },
          createdAt: "2026-09-03T10:00:01.000Z",
        }] };
      },
      async getRunModelUsage(runId: string) {
        calls.usage.push(runId);
        return options.usage?.(runId) ?? { verdict: "allow", reason: null, data: overview(runId).modelUsage };
      },
      async listApprovalQueue(limit?: number) {
        calls.approvals.push(limit);
        return options.approvals?.(limit) ?? { verdict: "allow", reason: null, data: [{
          approvalRequestId: "approval-secret", runId: "run-secret", stepId: "step-secret",
          status: "pending", riskLevel: "high", requestedCapability: "reasoning",
          requestedAt: "2026-09-03T10:00:01.000Z", resolvedAt: null,
          requestedByActorId: "workflow-runtime", resolvedByActorId: null,
        }] };
      },
    } as any,
    authorizer: {
      async authorize(input: any) {
        calls.authorize.push(input);
        return options.authorize ? options.authorize(input) : { verdict: "allow" };
      },
    } as any,
  });
  return { access, calls };
}

function frozen(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return true;
  return Object.isFrozen(input) && Object.values(input).every(frozen);
}

test("exports only stable frozen access actions and rejects unknown actions", () => {
  assert.deepEqual(workflowRuntimeAccessActions, [
    "execute_runtime_command",
    "read_run_overview",
    "read_run_audit_timeline",
    "read_run_model_usage",
    "list_approval_queue",
    "list_projects",
    "list_project_runs",
    "list_tasks",
    "list_project_tasks",
    "read_task",
    "read_task_feature_plans",
  ]);
  assert.equal(Object.isFrozen(workflowRuntimeAccessActions), true);
  for (const action of workflowRuntimeAccessActions) {
    assert.equal(isWorkflowRuntimeAccessAction(action), true);
    assert.equal(parseWorkflowRuntimeAccessAction(action), action);
  }
  assert.equal(isWorkflowRuntimeAccessAction("admin"), false);
  assert.equal(parseWorkflowRuntimeAccessAction("admin"), null);
});

test("existing unauthorized Run and nonexistent Run return the exact same public command decision", async () => {
  const factualDenial = runtimeResponse({
    verdict: "deny",
    status: "denied",
    reasons: [{ code: "authorization_denied", path: "actorId", message: "internal",
      runId: "run-secret", stepId: null }],
    waitingApproval: { kind: "runtime_risk", stepId: "step-secret", approvalRequestId: "approval-secret" },
    lastStepResult: { providerId: "provider-secret", providerModelId: "model-secret",
      providerRequestModelId: "request-model-secret", providerModelVersion: "v-secret",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, costUsdMicros: 99,
      latencyMs: 7, stepId: "step-secret", outcome: "succeeded", finishReason: "stop" },
  });
  const missing = runtimeResponse({
    verdict: "deny", status: "denied", runId: null, revision: null, workflowStatus: null,
    currentStepIds: [], readyStepIds: [], waitingApproval: null, lastStepResult: null,
    reasons: [{ code: "run_not_found", path: "runId", message: "internal", runId: null, stepId: null }],
  });
  assert.notDeepEqual(factualDenial, missing);
  const { access } = fixture({
    execute(input) { return input.runId === "run-secret" ? factualDenial : missing; },
  });
  const denied = await access.executeCommand(context, command("run-secret"));
  const unknown = await access.executeCommand(context, command("run-does-not-exist"));
  assert.deepEqual(denied, unknown);
  assert.equal(JSON.stringify(denied), JSON.stringify(unknown));
  assert.deepEqual(denied, { verdict: "deny", status: "unavailable", data: null });
  for (const secret of [
    "running", "revision", "step-secret", "approval-secret", "provider-secret",
    "model-secret", "inputTokens", "costUsdMicros", "2026-",
    "authorization_denied", "run_not_found",
  ]) assert.equal(JSON.stringify(denied).includes(secret), false, secret);
  assert.equal(frozen(denied), true);
});

test("authorizer deny, throw, and malformed result fail closed before command execution", async () => {
  const decisions = [];
  for (const authorize of [
    () => ({ verdict: "deny" }),
    () => { throw new Error("authorization-secret"); },
    () => true,
    () => ({ verdict: "allow", internalReason: "secret" }),
    () => null,
    () => new Proxy({ verdict: "deny" }, { get() { return "allow"; } }),
  ]) {
    const { access, calls } = fixture({ authorize });
    decisions.push(await access.executeCommand(context, command()));
    assert.equal(calls.execute.length, 0);
  }
  assert.equal(decisions.every((decision) => JSON.stringify(decision)
    === JSON.stringify({ verdict: "deny", status: "unavailable", data: null })), true);
  assert.equal(JSON.stringify(decisions).includes("authorization-secret"), false);
});

test("authorized command preserves normal and stale conflict behavior with the trusted actor", async () => {
  const normalResponse = runtimeResponse();
  const normal = fixture({ execute: () => normalResponse });
  const allowed = await normal.access.executeCommand(context, command());
  assert.deepEqual(allowed, { verdict: "allow", status: "available", data: normalResponse });
  assert.equal(normal.calls.execute[0].actorId, context.actorId);
  assert.notEqual(normal.calls.execute[0].actorId, command().actorId);

  const conflictResponse = runtimeResponse({
    verdict: "deny", status: "conflict",
    reasons: [{ code: "stale_revision", path: "expectedRevision", message: "Stale.",
      runId: "run-secret", stepId: null }],
  });
  const stale = fixture({ execute: () => conflictResponse });
  assert.deepEqual(await stale.access.executeCommand(context, command()), {
    verdict: "allow", status: "available", data: {
      ...conflictResponse,
      reasons: [{ code: "stale_revision" }],
    },
  });
});

test("command projection drops future top-level, nested, and reason-internal fields", async () => {
  const internalResponse: any = runtimeResponse({
    verdict: "deny",
    status: "conflict",
    internalSecret: "must-not-leak",
    reasons: [{
      code: "stale_revision",
      path: "expectedRevision",
      message: "database shard and internal policy detail",
      runId: "run-secret",
      stepId: null,
      internalTrace: "must-not-leak",
    }],
    waitingApproval: {
      kind: "runtime_risk",
      stepId: "step-running",
      approvalRequestId: "approval-one",
      policyFingerprint: "must-not-leak",
    },
    retryPending: {
      stepId: "step-running",
      attemptCount: 2,
      errorCode: "provider_exception",
      providerTrace: "must-not-leak",
    },
    lastStepResult: {
      stepId: "step-running",
      outcome: "failed",
      finishReason: "error",
      providerId: "provider-one",
      providerModelId: "model-one",
      providerRequestModelId: "request-model-one",
      providerModelVersion: "2026-09-01",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        rawUsage: "must-not-leak",
      },
      latencyMs: 17,
      costUsdMicros: 42,
      providerTrace: "must-not-leak",
    },
  });
  const original = structuredClone(internalResponse);
  const { access } = fixture({ execute: () => internalResponse });
  const result = await access.executeCommand(context, command());
  assert.equal(result.verdict, "allow");
  assert.deepEqual(result.data?.reasons, [{ code: "stale_revision" }]);
  const serialized = JSON.stringify(result);
  for (const secret of [
    "internalSecret", "database shard", "expectedRevision", "internalTrace",
    "policyFingerprint", "providerTrace", "rawUsage", "must-not-leak",
  ]) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(result.data?.waitingApproval?.approvalRequestId, "approval-one");
  assert.equal(result.data?.retryPending?.attemptCount, 2);
  assert.equal(result.data?.lastStepResult?.usage.totalTokens, 15);
  assert.deepEqual(internalResponse, original);
  assert.equal(frozen(result), true);

  const futureReason = fixture({
    execute: () => runtimeResponse({
      verdict: "deny",
      status: "conflict",
      reasons: [{ code: "future_internal_reason", message: "must-not-leak" }],
    }),
  });
  assert.deepEqual(await futureReason.access.executeCommand(context, command()), {
    verdict: "deny", status: "unavailable", data: null,
  });
});

test("trusted context and command are captured before asynchronous authorization", async () => {
  let release: () => void = () => { throw new Error("not ready"); };
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let observed: any = null;
  const { access, calls } = fixture({
    async authorize(input) { observed = input; await pending; return { verdict: "allow" }; },
  });
  const mutableContext: any = { ...context };
  const mutableCommand: any = command();
  const result = access.executeCommand(mutableContext, mutableCommand);
  mutableContext.actorId = "attacker";
  mutableContext.workspaceId = "workspace-attacker";
  mutableContext.roles = ["owner"];
  mutableCommand.runId = "run-attacker";
  mutableCommand.actorId = "attacker";
  release();
  assert.equal((await result).verdict, "allow");
  assert.deepEqual(observed, {
    action: "execute_runtime_command", actorId: "owner-one",
    workspaceId: "workspace-primary", runId: "run-secret",
  });
  assert.equal(frozen(observed), true);
  assert.equal(calls.execute[0].runId, "run-secret");
  assert.equal(calls.execute[0].actorId, "owner-one");
});

test("hostile caller authority fields cannot affect command authorization", async () => {
  for (const field of ["workspaceDatabaseId", "roles", "permissions", "isOwner", "isAdmin"]) {
    const { access, calls } = fixture();
    const result = await access.executeCommand(context, command("run-secret", { [field]: true }));
    assert.deepEqual(result, { verdict: "deny", status: "unavailable", data: null });
    assert.equal(calls.authorize.length, 0);
    assert.equal(calls.execute.length, 0);
  }
});

test("overview deny performs no raw read and denied existing equals authorized missing", async () => {
  const deniedFixture = fixture({ authorize: () => ({ verdict: "deny" }) });
  const denied = await deniedFixture.access.getRunOverview(context, "run-secret");
  assert.equal(deniedFixture.calls.overview.length, 0);
  const missingFixture = fixture({
    overview: () => ({ verdict: "deny", reason: "not_found", data: null }),
  });
  const missing = await missingFixture.access.getRunOverview(context, "run-does-not-exist");
  assert.deepEqual(denied, missing);
  assert.deepEqual(denied, { verdict: "deny", status: "unavailable", data: null });
});

test("audit, usage, and approval queue deny before raw reads and expose no factual data", async () => {
  const { access, calls } = fixture({ authorize: () => ({ verdict: "deny" }) });
  const decisions = await Promise.all([
    access.getRunAuditTimeline(context, "run-secret", 10),
    access.getRunModelUsage(context, "run-secret"),
    access.listApprovalQueue(context, 10),
  ]);
  assert.deepEqual(calls.overview, []);
  assert.deepEqual(calls.audit, []);
  assert.deepEqual(calls.usage, []);
  assert.deepEqual(calls.approvals, []);
  for (const decision of decisions) {
    assert.deepEqual(decision, { verdict: "deny", status: "unavailable", data: null });
  }
  const serialized = JSON.stringify(decisions);
  for (const secret of ["approval-secret", "riskLevel", "provider", "tokens", "createdAt"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("authorizer throw or malformed result prevents every raw read", async () => {
  for (const authorize of [
    () => { throw new Error("read-authorization-secret"); },
    () => ({ verdict: "allow", extra: true }),
    () => "allow",
  ]) {
    const { access, calls } = fixture({ authorize });
    assert.deepEqual(await access.getRunOverview(context, "run-secret"), {
      verdict: "deny", status: "unavailable", data: null,
    });
    assert.deepEqual(await access.listApprovalQueue(context), {
      verdict: "deny", status: "unavailable", data: null,
    });
    assert.equal(calls.overview.length + calls.approvals.length, 0);
  }
});

test("overview projection drops future top-level and nested internal fields", async () => {
  const internalOverview: any = {
    ...overview(),
    internalDbKey: "must-not-leak",
    latestModelInvocation: {
      invocationId: "invocation-one",
      stepId: "step-running",
      attemptNumber: 1,
      status: "running",
      providerId: "provider-one",
      deploymentId: "deployment-one",
      providerModelId: "model-one",
      providerRequestModelId: "request-model-one",
      providerModelVersion: "2026-09-01",
      providerIdentityVersion: 2,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
      createdAt: "2026-09-03T10:00:02.000Z",
      completedAt: null,
      internalReservationId: "must-not-leak",
    },
    modelUsage: {
      ...overview().modelUsage,
      internalLedgerKey: "must-not-leak",
    },
  };
  const original = structuredClone(internalOverview);
  const { access } = fixture({
    overview: () => ({ verdict: "allow", reason: null, data: internalOverview }),
  });
  const result = await access.getRunOverview(context, "run-secret");
  assert.equal(result.verdict, "allow");
  assert.equal(result.data?.latestModelInvocation?.invocationId, "invocation-one");
  assert.equal(result.data?.modelUsage.invocationCount, 0);
  const serialized = JSON.stringify(result);
  for (const secret of ["internalDbKey", "internalReservationId", "internalLedgerKey", "must-not-leak"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.deepEqual(internalOverview, original);
});

test("audit projection omits arbitrary metadata and future internal fields", async () => {
  const internalAudit: any[] = [{
    eventType: "workflow.run_started",
    actorKind: "workflow_runtime",
    actorId: "workflow-runtime",
    runId: "run-secret",
    metadata: { runId: "run-secret", revision: 1, internalToken: "must-not-leak" },
    createdAt: "2026-09-03T10:00:01.000Z",
    internalTrace: "must-not-leak",
  }];
  const original = structuredClone(internalAudit);
  const { access } = fixture({
    audit: () => ({ verdict: "allow", reason: null, data: internalAudit }),
  });
  const result = await access.getRunAuditTimeline(context, "run-secret");
  assert.deepEqual(result, {
    verdict: "allow",
    status: "available",
    data: [{
      eventType: "workflow.run_started",
      actorKind: "workflow_runtime",
      actorId: "workflow-runtime",
      runId: "run-secret",
      createdAt: "2026-09-03T10:00:01.000Z",
    }],
  });
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(result).includes("metadata"), false);
  assert.deepEqual(internalAudit, original);
});

test("model usage projection drops future internal fields", async () => {
  const internalUsage: any = {
    ...overview().modelUsage,
    internalPricingRule: "must-not-leak",
  };
  const original = structuredClone(internalUsage);
  const { access } = fixture({
    usage: () => ({ verdict: "allow", reason: null, data: internalUsage }),
  });
  const result = await access.getRunModelUsage(context, "run-secret");
  assert.equal(result.verdict, "allow");
  assert.equal(result.data?.totalTokens, 0);
  assert.equal(JSON.stringify(result).includes("internalPricingRule"), false);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.deepEqual(internalUsage, original);
});

test("approval queue projection drops future internal fields", async () => {
  const internalApprovals: any[] = [{
    approvalRequestId: "approval-secret",
    runId: "run-secret",
    stepId: "step-secret",
    status: "pending",
    riskLevel: "high",
    requestedCapability: "reasoning",
    requestedAt: "2026-09-03T10:00:01.000Z",
    resolvedAt: null,
    requestedByActorId: "workflow-runtime",
    resolvedByActorId: null,
    internalPolicyContext: "must-not-leak",
  }];
  const original = structuredClone(internalApprovals);
  const { access } = fixture({
    approvals: () => ({ verdict: "allow", reason: null, data: internalApprovals }),
  });
  const result = await access.listApprovalQueue(context);
  assert.equal(result.verdict, "allow");
  assert.equal(result.data?.[0]?.approvalRequestId, "approval-secret");
  assert.equal(JSON.stringify(result).includes("internalPolicyContext"), false);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.deepEqual(internalApprovals, original);
});

test("authorized reads preserve public factual fields and audit reads one read-model snapshot", async () => {
  const expectedOverview = overview();
  const internalAudit = [{ eventType: "workflow.run_started", actorKind: "workflow_runtime",
    actorId: "workflow-runtime", runId: "run-secret", metadata: { runId: "run-secret", revision: 1 },
    createdAt: "2026-09-03T10:00:01.000Z" }];
  const expectedAudit = [{ eventType: "workflow.run_started", actorKind: "workflow_runtime",
    actorId: "workflow-runtime", runId: "run-secret",
    createdAt: "2026-09-03T10:00:01.000Z" }];
  const expectedUsage = expectedOverview.modelUsage;
  const expectedApprovals = [{
    approvalRequestId: "approval-secret", runId: "run-secret", stepId: "step-secret",
    status: "pending", riskLevel: "high", requestedCapability: "reasoning",
    requestedAt: "2026-09-03T10:00:01.000Z", resolvedAt: null,
    requestedByActorId: "workflow-runtime", resolvedByActorId: null,
  }];
  const { access, calls } = fixture({
    overview: () => ({ verdict: "allow", reason: null, data: expectedOverview }),
    audit: () => ({ verdict: "allow", reason: null, data: internalAudit }),
    usage: () => ({ verdict: "allow", reason: null, data: expectedUsage }),
    approvals: () => ({ verdict: "allow", reason: null, data: expectedApprovals }),
  });
  assert.deepEqual(await access.getRunOverview(context, "run-secret"), {
    verdict: "allow", status: "available", data: expectedOverview,
  });
  assert.deepEqual(await access.getRunAuditTimeline(context, "run-secret", 10), {
    verdict: "allow", status: "available", data: expectedAudit,
  });
  assert.deepEqual(await access.getRunModelUsage(context, "run-secret"), {
    verdict: "allow", status: "available", data: expectedUsage,
  });
  assert.deepEqual(await access.listApprovalQueue(context, 10), {
    verdict: "allow", status: "available", data: expectedApprovals,
  });
  assert.deepEqual(calls.audit, [["run-secret", 10]]);
  assert.equal(calls.overview.length, 1);
});

test("audit timeline authorizes first then makes exactly one read-model call and never reads overview", async () => {
  const order: string[] = [];
  const cases = [
    { audit: { verdict: "allow", reason: null, data: [] }, expected: { verdict: "allow", status: "available", data: [] } },
    { audit: { verdict: "deny", reason: "not_found", data: null }, expected: { verdict: "deny", status: "unavailable", data: null } },
    { audit: { verdict: "deny", reason: "read_failed", data: null }, expected: { verdict: "deny", status: "unavailable", data: null } },
  ];
  for (const item of cases) {
    order.length = 0;
    const { access, calls } = fixture({
      authorize: () => { order.push("authorize"); return { verdict: "allow" }; },
      overview: () => { throw new Error("audit must not read overview"); },
      audit: () => { order.push("audit"); return item.audit; },
    });
    assert.deepEqual(await access.getRunAuditTimeline(context, "run-secret", 10), item.expected);
    assert.deepEqual(order, ["authorize", "audit"]);
    assert.deepEqual(calls.audit, [["run-secret", 10]]);
    assert.deepEqual(calls.overview, []);
  }
  const denied = fixture({ authorize: () => ({ verdict: "deny" }) });
  const missing = fixture({ audit: () => ({ verdict: "deny", reason: "not_found", data: null }) });
  const deniedResult = await denied.access.getRunAuditTimeline(context, "run-secret", 10);
  assert.deepEqual(deniedResult, await missing.access.getRunAuditTimeline(context, "run-missing", 10));
  assert.equal(denied.calls.audit.length + denied.calls.overview.length, 0);
});

test("missing or malformed authorizer cannot construct the protected boundary", () => {
  const dependencies = {
    runtimeService: { execute: async () => runtimeResponse() },
    readModel: {
      getRunOverview: async () => ({ verdict: "deny", reason: "not_found", data: null }),
      getRunAuditTimeline: async () => ({ verdict: "allow", reason: null, data: [] }),
      getRunModelUsage: async () => ({ verdict: "deny", reason: "not_found", data: null }),
      listApprovalQueue: async () => ({ verdict: "allow", reason: null, data: [] }),
    },
  };
  assert.throws(() => createAuthorizedWorkflowRuntimeAccess(dependencies as any));
  assert.throws(() => createAuthorizedWorkflowRuntimeAccess({ ...dependencies, authorizer: {} } as any));
  let getterReads = 0;
  const authorizer = Object.defineProperty({}, "authorize", {
    enumerable: true,
    get() { getterReads += 1; return async () => ({ verdict: "allow" }); },
  });
  assert.throws(() => createAuthorizedWorkflowRuntimeAccess({ ...dependencies, authorizer } as any));
  assert.equal(getterReads, 0);
});

test("access decisions are deterministic, fresh, deeply frozen, and input-immutable", async () => {
  const originalContext = structuredClone(context);
  const originalCommand = command();
  const { access } = fixture();
  const first = await access.executeCommand(context, originalCommand);
  const second = await access.executeCommand(context, originalCommand);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
  assert.equal(frozen(first), true);
  assert.equal(frozen(second), true);
  assert.deepEqual(context, originalContext);
  assert.deepEqual(originalCommand, command());
});

test("application API depends on authorized access and cannot call the raw runtime service", () => {
  const source = readFileSync(
    new URL("../lib/workflows/workflow-runtime-api.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("AuthorizedWorkflowRuntimeAccess"), true);
  assert.equal(source.includes("service.execute"), false);
  assert.equal(source.includes("WorkflowRuntimeService,"), false);
  assert.equal(source.includes("WorkflowRuntimeResponse"), false);
  assert.equal(source.includes("PostgresWorkflowRuntimeReadModel"), false);
});
