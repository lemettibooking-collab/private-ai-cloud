import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any -- factual/adversarial fixtures cross unknown boundaries */

const serviceContract = (await import(
  new URL("../lib/workflows/workflow-runtime-service.ts", import.meta.url).href
)) as typeof import("../lib/workflows/workflow-runtime-service");
const runContract = (await import(
  new URL("../lib/contracts/workflow-run.ts", import.meta.url).href
)) as typeof import("../lib/contracts/workflow-run");
const invocationContract = (await import(
  new URL("../lib/contracts/model-invocation.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-invocation");
const adapterContract = (await import(
  new URL("../lib/contracts/model-provider-adapter.ts", import.meta.url).href
)) as typeof import("../lib/contracts/model-provider-adapter");
const apiContract = (await import(
  new URL("../lib/workflows/workflow-runtime-api.ts", import.meta.url).href
)) as typeof import("../lib/workflows/workflow-runtime-api");

const { createWorkflowRuntimeService } = serviceContract;
const { createWorkflowRunSnapshot, evaluateWorkflowRunTransition } = runContract;
const {
  validateAndNormalizeModelInvocationRequest,
  validateAndNormalizeModelInvocationResult,
} = invocationContract;
const { validateAndNormalizeModelProviderHealth } = adapterContract;
const { handleWorkflowRuntimeCommand } = apiContract;

type RuntimeState = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeState;
type RuntimeResponse = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeResponse;
type RuntimeStore = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeStateStore;
type CommandBeginInput = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeCommandBeginInput;
type ClaimInput = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeClaimInput;
type CompareAndSwapInput = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeCompareAndSwapInput;
type AuthorizationInput = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeCommandAuthorizationInput;
type RuntimeService = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeService;
type RuntimeDependencies = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeServiceDependencies;
type AdvanceCommand = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeAdvanceCommand;
type ModelProvider = import("../lib/contracts/model-provider-adapter").ModelProvider;
type InvocationDraft = import("../lib/contracts/model-invocation").ModelInvocationDraft;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function frozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(frozen);
}

function budget() {
  return {
    maxConcurrentRuns: 4,
    maxAttemptsPerRun: 3,
    maxRunMinutes: 120,
    dailyTokenBudget: 1_000_000,
    monthlyCostBudgetUsdCents: 250_000,
  };
}

function projectRegistry(agentIds: readonly string[]) {
  const subjectBinding = (kind: "agent" | "workflow", subjectId: string) => ({
    id: `${subjectId}-binding`,
    projectId: "project-one",
    departmentId: "department-one",
    version: 1,
    status: "active",
    kind,
    subjectId,
    requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata"] }],
    requestedModelProfileIds: ["model-shared"],
    requestedKnowledgeCollectionIds: [],
    requestedBudget: { ...budget(), maxConcurrentRuns: 1, maxAttemptsPerRun: 3, maxRunMinutes: 30 },
    externalActionMode: "approval_required",
    dataEgressMode: "forbidden",
    additionalRequiredApprovalActions: [],
    additionalForbiddenActions: [],
  });
  return {
    workspaceId: "workspace-primary",
    projects: [{
      projectManifest: {
        id: "project-one",
        workspaceId: "workspace-primary",
        version: 1,
        name: "Project one",
        slug: "project-one",
        summary: "Bounded runtime project.",
        kind: "internal_product",
        status: "active",
        defaultLocale: "en-US",
        timeZone: "UTC",
        dataRegion: "eu",
        dataClassification: "confidential",
        goals: ["Execute reviewed workflows"],
        nonGoals: ["Autonomous external actions"],
        tags: ["runtime"],
        resources: [{
          id: "repository-one",
          kind: "code_repository",
          label: "Repository one",
          status: "connected",
          connectionId: "connection-one",
          resourceRef: "owner/repository-one",
          capabilities: ["read_metadata"],
        }],
        allowedModelProfileIds: ["model-shared"],
        knowledgeCollectionIds: [],
        policy: {
          externalActionMode: "approval_required",
          dataEgressMode: "forbidden",
          requiredApprovalActions: ["workflow-approval"],
          forbiddenActions: [],
        },
        budget: budget(),
      },
      departmentManifests: [{
        id: "department-one",
        projectId: "project-one",
        version: 1,
        code: "development",
        name: "Development",
        summary: "Runtime department.",
        status: "active",
        operatingMode: "approval_gated",
        goals: ["Execute bounded work"],
        nonGoals: ["Deploy automatically"],
        resourceGrants: [{ resourceId: "repository-one", capabilities: ["read_metadata"] }],
        allowedModelProfileIds: ["model-shared"],
        knowledgeCollectionIds: [],
        enabledWorkflowIds: ["workflow-one"],
        operatorRoleIds: ["role-owner"],
        modelRouting: {
          primaryModelProfileId: "model-shared",
          fallbackModelProfileIds: [],
          reviewerModelProfileId: null,
          independentReviewRequired: false,
        },
        policy: {
          externalActionMode: "approval_required",
          dataEgressMode: "forbidden",
          additionalRequiredApprovalActions: [],
          additionalForbiddenActions: [],
        },
        budget: { ...budget(), maxConcurrentRuns: 3, maxAttemptsPerRun: 3, maxRunMinutes: 60 },
      }],
      bindings: [
        ...agentIds.map((agentId) => subjectBinding("agent", agentId)),
        subjectBinding("workflow", "workflow-one"),
      ],
    }],
  };
}

function agent(agentId: string) {
  return {
    id: agentId,
    projectId: "project-one",
    departmentId: "department-one",
    version: 1,
    roleCode: "developer",
    name: `Agent ${agentId}`,
    summary: "Executes one factual workflow step.",
    status: "active",
    instructionProfileId: `instructions-${agentId}`,
    goals: ["Produce a patch"],
    nonGoals: ["Deploy"],
    outputTypes: ["patch"],
    allowedWorkflowIds: ["workflow-one"],
    allowedToolIds: [],
    allowedModelProfileIds: ["model-shared"],
    knowledgeCollectionIds: [],
    modelRouting: {
      primaryModelProfileId: "model-shared",
      fallbackModelProfileIds: [],
      reviewerModelProfileId: null,
      independentReviewRequired: false,
    },
    additionalRequiredApprovalActions: [],
    additionalForbiddenActions: [],
  };
}

function agentStep(id: string, agentId: string, dependsOnStepIds: readonly string[], maxAttempts = 2) {
  return {
    id,
    kind: "agent_task",
    name: `Execute ${id}`,
    dependsOnStepIds,
    agentId,
    agentBindingId: `${agentId}-binding`,
    outputType: "patch",
    requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata"] }],
    modelProfileId: "model-shared",
    knowledgeCollectionIds: [],
    toolIds: [],
    maxAttempts,
    timeoutMinutes: 30,
    actionMode: "proposal_only",
    requiredApprovalAction: null,
  };
}

function workflow(kind: "linear" | "branched" | "single" = "linear") {
  const steps = kind === "linear"
    ? [
        agentStep("step-a", "agent-a", ["approval-one"]),
        agentStep("step-b", "agent-b", ["step-a"]),
        {
          id: "approval-one",
          kind: "approval_gate",
          name: "Owner approval",
          dependsOnStepIds: [],
          approvalAction: "workflow-approval",
        },
      ]
    : kind === "branched"
      ? [
          agentStep("step-d", "agent-d", ["step-b", "step-c"]),
          agentStep("step-c", "agent-c", ["step-a"]),
          agentStep("step-b", "agent-b", ["step-a"]),
          agentStep("step-a", "agent-a", []),
        ]
      : [agentStep("step-a", "agent-a", [])];
  return {
    id: "workflow-one",
    projectId: "project-one",
    departmentId: "department-one",
    version: 1,
    name: "Workflow one",
    summary: "Canonical runtime workflow.",
    status: "active",
    triggerMode: "manual",
    goals: ["Produce reviewed output"],
    nonGoals: ["Deploy"],
    steps,
    finalStepIds: kind === "linear" ? ["step-b"] : kind === "branched" ? ["step-d"] : ["step-a"],
    additionalRequiredApprovalActions: [],
    additionalForbiddenActions: [],
  };
}

function creation(kind: "linear" | "branched" | "single" = "linear") {
  const agentIds = kind === "linear"
    ? ["agent-a", "agent-b"]
    : kind === "branched"
      ? ["agent-a", "agent-b", "agent-c", "agent-d"]
      : ["agent-a"];
  const registry = projectRegistry(agentIds);
  return {
    runId: "run-one",
    requestId: "request-one",
    createdAt: "2026-08-30T10:00:00.000Z",
    schedulerInput: {
      registry: clone(registry),
      policy: {
        workspaceId: "workspace-primary",
        status: "active",
        maxConcurrentRuns: 8,
        maxQueuedRuns: 512,
        projectPolicies: [{
          projectId: "project-one",
          status: "active",
          maxQueuedRuns: 256,
          allowedPriorities: ["P0", "P1", "P2", "P3", "P4"],
        }],
      },
      queuedRequests: [{
        id: "request-one",
        workspaceId: "workspace-primary",
        projectId: "project-one",
        bindingId: "workflow-one-binding",
        modelProfileId: "model-shared",
        idempotencyKey: "idempotency-one",
        priority: "P2",
        sequence: 1,
      }],
      runningRuns: [],
      lastDispatchedProjectId: null,
    },
    workflowCatalog: {
      registry,
      agents: agentIds.map((agentId) => ({
        bindingId: `${agentId}-binding`,
        agentManifest: agent(agentId),
      })),
      workflows: [{ bindingId: "workflow-one-binding", workflowManifest: workflow(kind) }],
    },
  };
}

function modelProviderRegistry() {
  return {
    workspaceId: "workspace-primary",
    version: 1,
    providers: [{
      id: "provider-mock",
      kind: "mock",
      status: "active",
      deploymentMode: "local",
      supportedDataRegions: ["eu"],
      supportedDataEgressModes: ["forbidden"],
      capabilities: ["messages"],
    }],
    deployments: [{
      id: "deployment-mock",
      providerId: "provider-mock",
      status: "active",
      providerModelId: "mock/model:v1",
      providerModelVersion: "version-1",
      capabilities: ["messages"],
      supportedOutputTypes: ["patch"],
      maxInputTokens: 128_000,
      maxOutputTokens: 16_000,
      inputCostUsdMicrosPerMillionTokens: 1_000_000,
      outputCostUsdMicrosPerMillionTokens: 2_000_000,
      latencyClass: "standard",
      qualityTier: "reasoning",
    }],
    modelProfiles: [{
      modelProfileId: "model-shared",
      status: "active",
      requiredCapabilities: ["messages"],
      supportedOutputTypes: ["patch"],
      candidates: [{ deploymentId: "deployment-mock", priority: 1 }],
    }],
  };
}

function initialState(kind: "linear" | "branched" | "single" = "linear"): RuntimeState {
  const input = creation(kind);
  const created = createWorkflowRunSnapshot(input);
  assert.equal(created.verdict, "allow", JSON.stringify(created.reasons));
  assert.ok(created.snapshot);
  return {
    snapshot: created.snapshot,
    projectRegistry: input.workflowCatalog.registry,
    modelProviderRegistry: modelProviderRegistry(),
    existingRequests: [],
    pause: null,
  };
}

class FakeStore implements RuntimeStore {
  state: RuntimeState;
  claims = new Map<string, {
    claimId: string;
    executionId: string;
    expectedRevision: number;
    requestFingerprint: string;
    stepId: string;
  }>();
  commands = new Map<string, { fingerprint: string; response: RuntimeResponse | null }>();
  casConflicts = 0;
  casRecoveryRequired = 0;
  reconciledLostCommitAcknowledgements = 0;
  compareAndSwapThrows = 0;
  releaseClaimThrows = 0;
  completeCommandThrows = 0;
  abandonCommandThrows = 0;
  releaseAttempts = 0;
  completeAttempts = 0;
  abandonAttempts = 0;
  loadAttempts = 0;
  startExecutionAttempts = 0;
  markCommandEffectfulAttempts = 0;
  recordKnownExecutionOutcomeAttempts = 0;
  startExecutionStatus: "started" | "conflict" | "recovery_required" = "started";
  startExecutionThrowsAfterStart = false;
  beginCommandStatus: "normal" | "recovery_required" = "normal";
  recoverPreparedClaims = false;
  nextClaimNumber = 1;
  recoveredClaims: Array<{ oldClaimId: string; newClaimId: string }> = [];
  markCommandEffectfulHook: ((input: import(
    "../lib/workflows/workflow-runtime-service"
  ).WorkflowRuntimeCommandOwnershipInput) => Promise<void>) | null = null;
  startExecutionHook: ((claimId: string) => Promise<void>) | null = null;
  executionJournal = new Map<string, "prepared" | "running" | "completed" | "failed" | "outcome_unknown">();
  approvals = new Map<string, {
    scope: import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeRiskApprovalScope;
    status: "pending" | "approved" | "rejected" | "cancelled";
    decision: "approved" | "rejected" | null;
  }>();

  constructor(state: RuntimeState) {
    this.state = clone(state);
  }

  async load({ runId }: { runId: string }) {
    this.loadAttempts += 1;
    return runId === this.state.snapshot.runId ? clone(this.state) : null;
  }

  async beginCommand(input: CommandBeginInput) {
    if (this.beginCommandStatus === "recovery_required") {
      return { status: "recovery_required" as const };
    }
    const existing = this.commands.get(input.commandId);
    if (!existing) {
      this.commands.set(input.commandId, { fingerprint: input.fingerprint, response: null });
      return {
        status: "acquired" as const,
        ownershipToken: "00000000-0000-4000-8000-000000000961",
      };
    }
    if (existing.fingerprint !== input.fingerprint) return { status: "conflict" as const };
    return existing.response
      ? { status: "replay" as const, response: clone(existing.response) }
      : { status: "in_progress" as const };
  }

  async completeCommand(input: {
    commandId: string;
    fingerprint: string;
    response: RuntimeResponse;
  }) {
    this.completeAttempts += 1;
    if (this.completeCommandThrows > 0) {
      this.completeCommandThrows -= 1;
      throw new Error("sensitive completeCommand failure");
    }
    this.commands.set(input.commandId, {
      fingerprint: input.fingerprint,
      response: clone(input.response),
    });
  }

  async abandonCommand(input: CommandBeginInput) {
    this.abandonAttempts += 1;
    if (this.abandonCommandThrows > 0) {
      this.abandonCommandThrows -= 1;
      throw new Error("sensitive abandonCommand failure");
    }
    const current = this.commands.get(input.commandId);
    if (current?.fingerprint === input.fingerprint && current.response === null) {
      this.commands.delete(input.commandId);
    }
  }

  async markCommandEffectful(input: import(
    "../lib/workflows/workflow-runtime-service"
  ).WorkflowRuntimeCommandOwnershipInput) {
    this.markCommandEffectfulAttempts += 1;
    await this.markCommandEffectfulHook?.(input);
  }

  async claim(input: ClaimInput) {
    if (this.state.pause !== null) {
      return { status: "conflict" as const, claimId: null };
    }
    const key = `${input.runId}:${input.stepId}:${input.attemptNumber}:${input.expectedRevision}`;
    const existing = this.claims.get(key);
    if (existing) {
      if (existing.executionId !== input.executionId
        || existing.requestFingerprint !== input.requestFingerprint) {
        return { status: "conflict" as const, claimId: null };
      }
      if (this.recoverPreparedClaims && this.executionJournal.get(existing.claimId) === "prepared") {
        const oldClaimId = existing.claimId;
        const claimId = `claim-${this.nextClaimNumber}`;
        this.nextClaimNumber += 1;
        this.claims.set(key, { ...existing, claimId });
        this.executionJournal.delete(oldClaimId);
        this.executionJournal.set(claimId, "prepared");
        this.recoveredClaims.push({ oldClaimId, newClaimId: claimId });
        return { status: "acquired" as const, claimId };
      }
      return {
        status: "idempotent" as const,
        claimId: null,
      };
    }
    const claimId = `claim-${this.nextClaimNumber}`;
    this.nextClaimNumber += 1;
    this.claims.set(key, {
      claimId,
      executionId: input.executionId,
      expectedRevision: input.expectedRevision,
      requestFingerprint: input.requestFingerprint,
      stepId: input.stepId,
    });
    this.executionJournal.set(claimId, "prepared");
    return { status: "acquired" as const, claimId };
  }

  async startExecution({ claimId }: { runId: string; claimId: string }) {
    this.startExecutionAttempts += 1;
    await this.startExecutionHook?.(claimId);
    const claim = [...this.claims.values()].find((candidate) => candidate.claimId === claimId);
    if (!claim || this.state.snapshot.revision !== claim.expectedRevision
      || this.state.pause !== null || this.state.snapshot.status !== "running") {
      return { status: "conflict" as const };
    }
    if (this.startExecutionStatus === "started") this.executionJournal.set(claimId, "running");
    if (this.startExecutionStatus === "recovery_required") {
      this.executionJournal.set(claimId, "running");
    }
    if (this.startExecutionThrowsAfterStart) throw new Error("lost execution-start acknowledgement");
    return { status: this.startExecutionStatus };
  }

  async recordKnownExecutionOutcome({ claimId }: { runId: string; claimId: string }) {
    this.recordKnownExecutionOutcomeAttempts += 1;
    const status = this.executionJournal.get(claimId);
    if (status === "running") this.executionJournal.set(claimId, "failed");
    else if (status !== "completed" && status !== "failed") throw new Error("invalid execution outcome");
  }

  async checkRiskApproval(
    input: import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeRiskApprovalCheckInput,
  ) {
    const approval = this.approvals.get(input.approvalRequestId);
    return {
      approved: approval?.status === "approved"
        && approval.decision === "approved"
        && JSON.stringify(approval.scope) === JSON.stringify(input),
    };
  }

  async compareAndSwap(input: CompareAndSwapInput) {
    if (this.compareAndSwapThrows > 0) {
      this.compareAndSwapThrows -= 1;
      throw new Error("sensitive compareAndSwap failure");
    }
    if (this.casConflicts > 0) {
      this.casConflicts -= 1;
      return { status: "conflict" as const, state: clone(this.state) };
    }
    if (this.casRecoveryRequired > 0) {
      this.casRecoveryRequired -= 1;
      return { status: "recovery_required" as const, state: null };
    }
    if (this.state.snapshot.revision !== input.expectedRevision) {
      return { status: "conflict" as const, state: clone(this.state) };
    }
    if (JSON.stringify(this.state.pause) !== JSON.stringify(input.expectedPause)) {
      return { status: "conflict" as const, state: clone(this.state) };
    }
    if (input.claimId && ![...this.claims.values()].some((claim) => claim.claimId === input.claimId)) {
      return { status: "conflict" as const, state: clone(this.state) };
    }
    const approvalMutation = input.approvalMutation ?? null;
    if (approvalMutation?.kind === "create") {
      if (this.approvals.has(approvalMutation.scope.approvalRequestId)) {
        return { status: "conflict" as const, state: clone(this.state) };
      }
      this.approvals.set(approvalMutation.scope.approvalRequestId, {
        scope: clone(approvalMutation.scope),
        status: "pending",
        decision: null,
      });
    } else if (approvalMutation?.kind === "resolve") {
      const approval = this.approvals.get(approvalMutation.approvalRequestId);
      if (!approval || approval.status !== "pending") {
        return { status: "conflict" as const, state: clone(this.state) };
      }
      approval.status = approvalMutation.decision;
      approval.decision = approvalMutation.decision;
    } else if (approvalMutation?.kind === "cancel") {
      const approval = this.approvals.get(approvalMutation.approvalRequestId);
      if (!approval || approval.status !== "pending") {
        return { status: "conflict" as const, state: clone(this.state) };
      }
      approval.status = "cancelled";
    }
    this.state = clone(input.nextState);
    if (this.reconciledLostCommitAcknowledgements > 0) {
      this.reconciledLostCommitAcknowledgements -= 1;
    }
    if (input.claimId) {
      const claim = [...this.claims.values()].find((candidate) => candidate.claimId === input.claimId);
      const step = input.nextState.snapshot.stepStates.find((candidate) => candidate.stepId === claim?.stepId);
      this.executionJournal.set(input.claimId, step?.status === "success" ? "completed" : "failed");
    }
    return { status: "committed" as const, state: clone(this.state) };
  }

  async releaseClaim({ claimId }: { runId: string; claimId: string }) {
    this.releaseAttempts += 1;
    if (this.releaseClaimThrows > 0) {
      this.releaseClaimThrows -= 1;
      throw new Error("sensitive releaseClaim failure");
    }
    if (this.executionJournal.get(claimId) === "running") {
      this.executionJournal.set(claimId, "outcome_unknown");
    }
    for (const [key, claim] of this.claims) if (claim.claimId === claimId) this.claims.delete(key);
  }
}

function capability(taskClass = "analysis", requestedCapability = "reasoning") {
  return {
    taskClass,
    requestedCapability,
    riskLevel: "medium",
    requiresModel: requestedCapability !== "deterministic",
    requiresRepositoryRead: true,
    requiresRepositoryWrite: requestedCapability === "coding",
    requiresCommandExecution: requestedCapability === "coding",
    requiresNetwork: false,
    budget: { maxInputTokens: 16_000, maxOutputTokens: 4_000, maxCostUsdMicros: 500_000 },
  };
}

function provider(options: {
  healthStatuses?: string[];
  throwHealth?: boolean;
  pendingHealth?: Promise<unknown>;
  onHealth?: () => void;
  onRun?: (stepId: string, agentId: string) => void;
} = {}) {
  let healthCalls = 0;
  let runCalls = 0;
  const adapter = {
      identity: {
        providerId: "provider-mock",
        providerKind: "mock",
        deploymentId: "deployment-mock",
        providerModelId: "mock/model:v1",
        providerModelVersion: "version-1",
      },
      async health() {
        healthCalls += 1;
        options.onHealth?.();
        if (options.throwHealth) throw new Error("transient provider exception");
        if (options.pendingHealth) return options.pendingHealth;
        return validateAndNormalizeModelProviderHealth({
          providerId: "provider-mock",
          deploymentId: "deployment-mock",
          status: options.healthStatuses?.shift() ?? "healthy",
          observedAt: "2026-08-30T10:00:10.000Z",
          latencyMs: 1,
          detailCode: null,
        });
      },
      async run(input: unknown) {
        runCalls += 1;
        const requestDecision = validateAndNormalizeModelInvocationRequest(input);
        assert.ok(requestDecision.normalizedRequest);
        const request = requestDecision.normalizedRequest;
        options.onRun?.(request.stepId, request.agentId);
        const normalizedResult = {
          invocationId: request.invocationId,
          outcome: "succeeded",
          finishReason: "stop",
          providerId: "provider-mock",
          providerModelId: "mock/model:v1",
          providerModelVersion: "version-1",
          outputText: `Output for ${request.stepId}`,
          structuredOutput: null,
          toolCallProposals: [],
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          latencyMs: 5,
          costUsdMicros: 0,
          error: null,
        };
        const resultDecision = validateAndNormalizeModelInvocationResult(normalizedResult);
        return { verdict: "allow", reasons: [], requestDecision, resultDecision, normalizedResult };
      },
    } as ModelProvider;
  return {
    adapter,
    counts: () => ({ health: healthCalls, run: runCalls }),
  };
}

function dependencies(
  store: FakeStore,
  runtimeProvider: ReturnType<typeof provider>,
  options: {
    authorize?: boolean;
    requirements?: (stepId: string) => Record<string, unknown>;
    observedRequirements?: Array<{ stepId: string; agentId: string }>;
  } = {},
): RuntimeDependencies {
  return {
    store,
    authorizer: {
      async authorize(input: AuthorizationInput) {
        return options.authorize ?? input.actorId === "owner-one";
      },
    },
    providers: [runtimeProvider.adapter],
    requirementsResolver: {
      async resolve(input: any) {
        options.observedRequirements?.push({ stepId: input.stepId, agentId: input.agentId });
        return options.requirements?.(input.stepId) ?? capability();
      },
    },
    runtimeContext: { now: () => "2026-08-30T10:00:10.000Z" },
  };
}

function draft(stepId: string, suffix = "one"): InvocationDraft {
  return {
    invocationId: `invocation-${stepId}-${suffix}`,
    invocationSequence: suffix === "two" ? 2 : 1,
    stepId,
    messages: [
      { role: "system", content: "Follow bounded instructions.", toolCallId: null },
      { role: "user", content: `Execute ${stepId}.`, toolCallId: null },
    ],
    contextArtifactIds: [],
  };
}

function advanceCommand(
  revision: number,
  stepIds: readonly string[],
  commandId = "advance-one",
  suffix = "one",
): AdvanceCommand {
  return {
    kind: "advance" as const,
    commandId,
    runId: "run-one",
    expectedRevision: revision,
    actorId: "owner-one",
    agentInputs: stepIds.map((stepId) => ({
      stepId,
      executionId: `execution-${stepId}-${suffix}`,
      invocationDraft: draft(stepId, suffix),
    })),
  };
}

function exactRiskResumeCommand(commandId: string): AdvanceCommand {
  const command = advanceCommand(1, ["step-a"], commandId);
  return {
    ...command,
    agentInputs: [{ ...command.agentInputs[0], executionId: "execution-step-a-two" }],
  };
}

async function start(service: RuntimeService, commandId = "start-one") {
  return service.start({
    kind: "start",
    commandId,
    runId: "run-one",
    expectedRevision: 0,
    actorId: "owner-one",
  });
}

test("linear multi-agent workflow pauses, approves, resumes, and completes canonically", async () => {
  const store = new FakeStore(initialState("linear"));
  const runtimeProvider = provider();
  const observed: Array<{ stepId: string; agentId: string }> = [];
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    observedRequirements: observed,
  }));
  assert.equal((await start(service)).status, "running");
  const waiting = await service.advance(advanceCommand(1, ["step-a", "step-b"]));
  assert.equal(waiting.status, "waiting_approval");
  assert.equal(waiting.waitingApproval?.stepId, "approval-one");
  assert.equal(runtimeProvider.counts().run, 0);
  const approved = await service.approve({
    kind: "approve",
    commandId: "approve-one",
    runId: "run-one",
    expectedRevision: waiting.revision!,
    actorId: "owner-one",
    stepId: "approval-one",
    approvalRequestId: waiting.waitingApproval!.approvalRequestId!,
  });
  assert.equal(approved.status, "running");
  const completed = await service.advance(advanceCommand(approved.revision!, ["step-a", "step-b"], "advance-two"));
  assert.equal(completed.status, "completed", JSON.stringify(completed.reasons));
  assert.equal(completed.workflowStatus, "completed");
  assert.deepEqual(observed, [
    { stepId: "step-a", agentId: "agent-a" },
    { stepId: "step-b", agentId: "agent-b" },
  ]);
  assert.deepEqual(runtimeProvider.counts(), { health: 2, run: 2 });
  assert.equal(frozen(completed), true);
});

test("branched DAG executes simultaneous ready steps sequentially in canonical order", async () => {
  const store = new FakeStore(initialState("branched"));
  const order: string[] = [];
  const identities: string[] = [];
  const runtimeProvider = provider({ onRun: (stepId, agentId) => { order.push(stepId); identities.push(agentId); } });
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  const result = await service.advance(advanceCommand(1, ["step-d", "step-c", "step-b", "step-a"]));
  assert.equal(result.status, "completed", JSON.stringify(result.reasons));
  assert.deepEqual(order, ["step-a", "step-b", "step-c", "step-d"]);
  assert.deepEqual(identities, ["agent-a", "agent-b", "agent-c", "agent-d"]);
});

test("missing Agent input produces bounded no-progress without synthetic success", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  const result = await service.advance(advanceCommand(1, []));
  assert.equal(result.status, "no_progress");
  assert.equal(result.workflowStatus, "running");
  assert.equal(result.reasons[0]?.code, "agent_input_missing");
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("transient provider failure commits retry-ready state and later advance owns attempt two", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider({ healthStatuses: ["unavailable", "healthy"] });
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  const retry = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(retry.status, "retry_pending");
  assert.equal(retry.retryPending?.attemptCount, 1);
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 0 });
  const completed = await service.advance(
    advanceCommand(retry.revision!, ["step-a"], "advance-two", "two"),
  );
  assert.equal(completed.status, "completed", JSON.stringify(completed.reasons));
  assert.deepEqual(runtimeProvider.counts(), { health: 2, run: 1 });
  assert.equal(store.state.snapshot.stepStates[0]?.attemptCount, 2);
});

test("permanent AI-029 provider failure commits canonical Workflow failure", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const deps = dependencies(store, runtimeProvider);
  const service = createWorkflowRuntimeService({ ...deps, providers: [] });
  await start(service);
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.status, "failed");
  assert.equal(result.workflowStatus, "failed");
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("AI-029 risk approval creates a runtime pause without fabricating a Workflow status", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(service);
  const paused = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(paused.status, "approval_required");
  assert.equal(paused.workflowStatus, "running");
  assert.equal(paused.waitingApproval?.kind, "runtime_risk");
  assert.equal(paused.waitingApproval?.stepId, "step-a");
  assert.match(paused.waitingApproval?.approvalRequestId ?? "", /^risk-approval-[0-9a-f]{32}$/u);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
  assert.equal(store.state.pause?.kind, "risk_approval");
  assert.equal(store.state.snapshot.revision, 1);
  assert.equal(store.recordKnownExecutionOutcomeAttempts, 1);
  assert.deepEqual([...store.executionJournal.values()], ["failed"]);
  assert.equal(store.approvals.size, 1);
  assert.equal(store.approvals.get(paused.waitingApproval!.approvalRequestId!)?.status, "pending");
  const repeatedAdvance = await service.advance(
    advanceCommand(1, ["step-a"], "advance-after-risk-pause"),
  );
  assert.equal(repeatedAdvance.status, "approval_required");
  assert.equal(store.approvals.size, 1);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("durable runtime risk approval resumes only on a later exact advance", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(service);
  const paused = await service.advance(advanceCommand(1, ["step-a"], "risk-create"));
  const approvalRequestId = paused.waitingApproval?.approvalRequestId;
  assert.ok(approvalRequestId);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });

  const restartedService = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  const afterRestart = await restartedService.get({
    kind: "get", runId: "run-one", actorId: "owner-one",
  });
  assert.equal(afterRestart.waitingApproval?.approvalRequestId, approvalRequestId);
  const approved = await restartedService.approve({
    kind: "approve",
    commandId: "risk-approve",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
    stepId: "step-a",
    approvalRequestId,
  });
  assert.equal(approved.status, "running");
  assert.equal(approved.waitingApproval, null);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
  assert.equal(store.approvals.get(approvalRequestId)?.status, "approved");
  assert.equal(store.approvals.get(approvalRequestId)?.decision, "approved");

  const resumedService = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  const resumed = await resumedService.advance(exactRiskResumeCommand("risk-resume"));
  assert.equal(resumed.status, "completed");
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 1 });
});

test("runtime risk rejection is final for the exact scope and remains cancellable", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(service);
  const paused = await service.advance(advanceCommand(1, ["step-a"], "risk-reject-create"));
  const approvalRequestId = paused.waitingApproval!.approvalRequestId!;
  const restarted = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  const rejected = await restarted.reject({
    kind: "reject",
    commandId: "risk-reject",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
    stepId: "step-a",
    approvalRequestId,
    reason: "Owner rejected the exact high-risk scope.",
  });
  assert.equal(rejected.status, "denied");
  assert.equal(rejected.waitingApproval?.approvalRequestId, approvalRequestId);
  assert.equal(store.state.pause?.approvalStatus, "rejected");
  assert.equal(store.approvals.get(approvalRequestId)?.decision, "rejected");
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });

  const afterRejectRestart = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  const retry = await afterRejectRestart.advance(
    advanceCommand(1, ["step-a"], "risk-after-reject", "two"),
  );
  assert.equal(retry.status, "denied");
  assert.equal(store.approvals.size, 1);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
  const cancelled = await service.cancel({
    kind: "cancel",
    commandId: "risk-rejected-cancel",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
  });
  assert.equal(cancelled.status, "cancelled");
});

test("cancelling pending runtime risk approval atomically retires its durable request", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(service);
  const paused = await service.advance(advanceCommand(1, ["step-a"], "risk-cancel-create"));
  const approvalRequestId = paused.waitingApproval!.approvalRequestId!;
  const cancelled = await service.cancel({
    kind: "cancel",
    commandId: "risk-cancel",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.approvals.get(approvalRequestId)?.status, "cancelled");
  assert.equal(cancelled.waitingApproval, null);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("concurrent runtime risk approve and reject produce exactly one immutable winner", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(service);
  const paused = await service.advance(advanceCommand(1, ["step-a"], "risk-race-create"));
  const approvalRequestId = paused.waitingApproval!.approvalRequestId!;
  const [approveResult, rejectResult] = await Promise.all([
    service.approve({
      kind: "approve",
      commandId: "risk-race-approve",
      runId: "run-one",
      expectedRevision: 1,
      actorId: "owner-one",
      stepId: "step-a",
      approvalRequestId,
    }),
    service.reject({
      kind: "reject",
      commandId: "risk-race-reject",
      runId: "run-one",
      expectedRevision: 1,
      actorId: "owner-one",
      stepId: "step-a",
      approvalRequestId,
      reason: "Concurrent bounded rejection.",
    }),
  ]);
  assert.equal([approveResult, rejectResult].filter((result) => result.status === "conflict").length, 1);
  assert.equal(["approved", "rejected"].includes(store.approvals.get(approvalRequestId)!.status), true);
  assert.notEqual(store.approvals.get(approvalRequestId)?.decision, null);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("approval transaction ambiguity never retries or enters the provider boundary", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(service);
  store.casRecoveryRequired = 1;
  const creation = await service.advance(advanceCommand(1, ["step-a"], "risk-ambiguous-create"));
  assert.equal(creation.status, "recovery_required");
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });

  const restartStore = new FakeStore(initialState("single"));
  const restartProvider = provider();
  const restartService = createWorkflowRuntimeService(dependencies(restartStore, restartProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(restartService, "risk-ambiguous-start");
  const paused = await restartService.advance(
    advanceCommand(1, ["step-a"], "risk-ambiguous-pause"),
  );
  restartStore.casRecoveryRequired = 1;
  const resolution = await restartService.approve({
    kind: "approve",
    commandId: "risk-ambiguous-approve",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
    stepId: "step-a",
    approvalRequestId: paused.waitingApproval!.approvalRequestId!,
  });
  assert.equal(resolution.status, "recovery_required");
  assert.deepEqual(restartProvider.counts(), { health: 0, run: 0 });
});

test("an approved risk scope cannot authorize a changed request or policy", async () => {
  for (const change of ["request", "policy"] as const) {
    const store = new FakeStore(initialState("single"));
    const runtimeProvider = provider();
    let riskLevel: "high" | "critical" = "high";
    const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
      requirements: () => ({
        ...capability("security_analysis", "advanced_reasoning"),
        riskLevel,
      }),
    }));
    await start(service);
    const paused = await service.advance(advanceCommand(1, ["step-a"], `risk-${change}-create`));
    const approvalRequestId = paused.waitingApproval!.approvalRequestId!;
    await service.approve({
      kind: "approve",
      commandId: `risk-${change}-approve`,
      runId: "run-one",
      expectedRevision: 1,
      actorId: "owner-one",
      stepId: "step-a",
      approvalRequestId,
    });
    if (change === "policy") riskLevel = "critical";
    const changed = await service.advance(change === "request"
      ? advanceCommand(1, ["step-a"], `risk-${change}-changed`, "two")
      : exactRiskResumeCommand(`risk-${change}-changed`));
    assert.equal(changed.status, "approval_required");
    assert.notEqual(changed.waitingApproval?.approvalRequestId, approvalRequestId);
    assert.equal(store.approvals.size, 2);
    assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
  }
});

test("stale advance loaded before a durable risk pause is fenced at claim time", async () => {
  const store = new FakeStore(initialState("single"));
  let releaseStaleAdvance: () => void = () => { throw new Error("not ready"); };
  const staleAdvanceBlocked = new Promise<void>((resolve) => { releaseStaleAdvance = resolve; });
  let notifyStaleAdvance: () => void = () => { throw new Error("not ready"); };
  const staleAdvanceReady = new Promise<void>((resolve) => { notifyStaleAdvance = resolve; });
  store.markCommandEffectfulHook = async (input) => {
    if (input.commandId === "advance-stale-before-pause") {
      notifyStaleAdvance();
      await staleAdvanceBlocked;
    }
  };
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(service);

  const staleAdvance = service.advance(
    advanceCommand(1, ["step-a"], "advance-stale-before-pause"),
  );
  await staleAdvanceReady;
  const paused = await service.advance(advanceCommand(1, ["step-a"], "advance-create-pause"));
  assert.equal(paused.status, "approval_required");
  assert.equal(store.state.snapshot.revision, 1);
  assert.equal(store.state.pause?.kind, "risk_approval");

  releaseStaleAdvance();
  const rejected = await staleAdvance;
  assert.equal(rejected.status, "conflict");
  assert.equal(rejected.reasons[0]?.code, "claim_conflict");
  assert.equal(store.state.pause?.kind, "risk_approval");
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });

  const restartedService = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => capability(),
  }));
  const afterRestart = await restartedService.advance(
    advanceCommand(1, ["step-a"], "advance-after-restart"),
  );
  assert.equal(afterRestart.status, "approval_required");
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });

  const cancelled = await restartedService.cancel({
    kind: "cancel",
    commandId: "cancel-paused-run",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.state.snapshot.status, "cancelled");
  assert.equal(store.state.pause, null);
});

test("stale cancellation cannot erase a newer same-revision risk pause", async () => {
  const store = new FakeStore(initialState("single"));
  let releaseStaleCancel: () => void = () => { throw new Error("not ready"); };
  const staleCancelBlocked = new Promise<void>((resolve) => { releaseStaleCancel = resolve; });
  let notifyStaleCancel: () => void = () => { throw new Error("not ready"); };
  const staleCancelReady = new Promise<void>((resolve) => { notifyStaleCancel = resolve; });
  store.markCommandEffectfulHook = async (input) => {
    if (input.commandId === "cancel-stale-before-pause") {
      notifyStaleCancel();
      await staleCancelBlocked;
    }
  };
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability("security_analysis", "advanced_reasoning"),
      riskLevel: "high",
    }),
  }));
  await start(service);

  const staleCancel = service.cancel({
    kind: "cancel",
    commandId: "cancel-stale-before-pause",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
  });
  await staleCancelReady;
  assert.equal((await service.advance(
    advanceCommand(1, ["step-a"], "advance-create-pause-for-cancel"),
  )).status, "approval_required");
  releaseStaleCancel();

  const staleResult = await staleCancel;
  assert.equal(staleResult.status, "conflict");
  assert.equal(store.state.snapshot.status, "running");
  assert.equal(store.state.snapshot.revision, 1);
  assert.equal(store.state.pause?.kind, "risk_approval");
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

for (const [taskClass, requestedCapability] of [
  ["deterministic_operation", "deterministic"],
  ["implementation", "coding"],
] as const) {
  test(`${requestedCapability} stops as unsupported without model execution`, async () => {
    const store = new FakeStore(initialState("single"));
    const runtimeProvider = provider();
    const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
      requirements: () => capability(taskClass, requestedCapability),
    }));
    await start(service);
    const result = await service.advance(advanceCommand(1, ["step-a"]));
    assert.equal(result.status, "unsupported_runtime");
    assert.equal(result.workflowStatus, "running");
    assert.equal(store.recordKnownExecutionOutcomeAttempts, 1);
    assert.deepEqual([...store.executionJournal.values()], ["failed"]);
    assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
  });
}

test("known capability denial is terminal and never becomes outcome_unknown", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider, {
    requirements: () => ({
      ...capability(),
      budget: { maxInputTokens: 1_000_000, maxOutputTokens: 4_000, maxCostUsdMicros: 500_000 },
    }),
  }));
  await start(service);
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.verdict, "deny");
  assert.equal(store.recordKnownExecutionOutcomeAttempts, 1);
  assert.deepEqual([...store.executionJournal.values()], ["failed"]);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("approval reject and mismatched/stale approval commands fail closed", async () => {
  const store = new FakeStore(initialState("linear"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  const waiting = await service.advance(advanceCommand(1, ["step-a", "step-b"]));
  const wrong = await service.approve({
    kind: "approve",
    commandId: "approve-wrong",
    runId: "run-one",
    expectedRevision: waiting.revision!,
    actorId: "owner-one",
    stepId: "approval-one",
    approvalRequestId: "approval-wrong",
  });
  assert.equal(wrong.reasons[0]?.code, "approval_mismatch");
  const stale = await service.approve({
    kind: "approve",
    commandId: "approve-stale",
    runId: "run-one",
    expectedRevision: 0,
    actorId: "owner-one",
    stepId: "approval-one",
    approvalRequestId: waiting.waitingApproval!.approvalRequestId!,
  });
  assert.equal(stale.reasons[0]?.code, "stale_revision");
  const rejected = await service.reject({
    kind: "reject",
    commandId: "reject-one",
    runId: "run-one",
    expectedRevision: waiting.revision!,
    actorId: "owner-one",
    stepId: "approval-one",
    approvalRequestId: waiting.waitingApproval!.approvalRequestId!,
    reason: "Owner rejected the external action.",
  });
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.workflowStatus, "blocked");
});

test("caller identity is only a needle and cannot self-authorize privileged commands", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  const result = await service.start({
    kind: "start",
    commandId: "start-denied",
    runId: "run-one",
    expectedRevision: 0,
    actorId: "self-asserted-owner",
  });
  assert.equal(result.reasons[0]?.code, "authorization_denied");
  assert.equal(store.state.snapshot.status, "queued");
});

test("every direct service entrypoint uses the same exact hostile-safe command boundary", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  let getterReads = 0;
  const getterAdvance = Object.defineProperty({
    kind: "advance",
    commandId: "advance-getter",
    runId: "run-one",
    expectedRevision: 0,
    actorId: "owner-one",
  }, "agentInputs", {
    enumerable: true,
    get() { getterReads += 1; return []; },
  });
  const proxiedAdvance = new Proxy(advanceCommand(0, [], "advance-proxy"), {});
  const invalidCalls = [
    () => (service.start as any)({
      kind: "start", commandId: "start-extra", runId: "run-one",
      expectedRevision: 0, actorId: "owner-one", extra: true,
    }),
    () => (service.advance as any)(getterAdvance),
    () => (service.advance as any)(proxiedAdvance),
    () => (service.approve as any)({
      kind: "approve", commandId: "approve-extra", runId: "run-one",
      expectedRevision: 0, actorId: "owner-one", stepId: "approval-one",
      approvalRequestId: "approval-one", extra: true,
    }),
    () => (service.reject as any)({
      kind: "reject", commandId: "reject-extra", runId: "run-one",
      expectedRevision: 0, actorId: "owner-one", stepId: "approval-one",
      approvalRequestId: "approval-one", reason: "No.", extra: true,
    }),
    () => (service.cancel as any)({
      kind: "cancel", commandId: "cancel-extra", runId: "run-one",
      expectedRevision: 0, actorId: "owner-one", extra: true,
    }),
    () => (service.get as any)({ kind: "get", runId: "run-one", actorId: "owner-one", extra: true }),
    () => (service.execute as any)({ kind: "unknown", runId: "run-one", actorId: "owner-one" }),
  ];
  for (const call of invalidCalls) {
    const result = await call();
    assert.equal(result.verdict, "deny");
    assert.equal(result.reasons[0]?.code, "invalid_command");
  }
  assert.equal(getterReads, 0);
  assert.equal(store.loadAttempts, 0);
  assert.equal(store.commands.size, 0);
});

test("canonical handler and direct service execution return equivalent valid decisions", async () => {
  const directStore = new FakeStore(initialState("single"));
  const handlerStore = new FakeStore(initialState("single"));
  const directService = createWorkflowRuntimeService(dependencies(directStore, provider()));
  const handlerService = createWorkflowRuntimeService(dependencies(handlerStore, provider()));
  const command = {
    kind: "start" as const,
    commandId: "start-equivalent",
    runId: "run-one",
    expectedRevision: 0,
    actorId: "owner-one",
  };
  const direct = await directService.start(command);
  const handled = await handleWorkflowRuntimeCommand(clone(command), handlerService);
  assert.deepEqual(handled, direct);
  assert.equal(frozen(direct), true);
  assert.equal(frozen(handled), true);
});

test("command replay is idempotent while same commandId with changed payload conflicts", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  const command = {
    kind: "start" as const,
    commandId: "start-one",
    runId: "run-one",
    expectedRevision: 0,
    actorId: "owner-one",
  };
  const first = await service.start(command);
  const replay = await service.start(clone(command));
  assert.equal(first.status, "running");
  assert.equal(replay.verdict, "idempotent");
  assert.equal(replay.revision, first.revision);
  const conflict = await service.start({ ...command, expectedRevision: 1 });
  assert.equal(conflict.reasons[0]?.code, "idempotency_conflict");
});

test("stale effectful command requires recovery and never reaches AI-029", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  store.beginCommandStatus = "recovery_required";
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.status, "recovery_required");
  assert.equal(result.reasons[0]?.code, "command_recovery_required");
  assert.equal(store.markCommandEffectfulAttempts, 1);
  assert.equal(store.startExecutionAttempts, 0);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("one factual attempt claim prevents a concurrent second AI-029/provider call", async () => {
  const store = new FakeStore(initialState("single"));
  let releaseHealth: (value: unknown) => void = () => { throw new Error("not ready"); };
  const pendingHealth = new Promise<unknown>((resolve) => { releaseHealth = resolve; });
  let notifyHealth: () => void = () => { throw new Error("not ready"); };
  const healthStarted = new Promise<void>((resolve) => { notifyHealth = resolve; });
  const runtimeProvider = provider({ pendingHealth, onHealth: notifyHealth });
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  const first = service.advance(advanceCommand(1, ["step-a"], "advance-first"));
  await healthStarted;
  const second = await service.advance(advanceCommand(1, ["step-a"], "advance-second"));
  assert.equal(second.status, "conflict");
  assert.equal(second.reasons[0]?.code, "claim_conflict");
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 0 });
  releaseHealth(validateAndNormalizeModelProviderHealth({
    providerId: "provider-mock",
    deploymentId: "deployment-mock",
    status: "healthy",
    observedAt: "2026-08-30T10:00:10.000Z",
    latencyMs: 1,
    detailCode: null,
  }));
  assert.equal((await first).status, "completed");
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 1 });
});

test("prepared recovery fences the stalled owner and permits at most one provider call", async () => {
  const store = new FakeStore(initialState("single"));
  let releaseOldStart: () => void = () => { throw new Error("not ready"); };
  const oldStartBlocked = new Promise<void>((resolve) => { releaseOldStart = resolve; });
  let notifyOldStart: () => void = () => { throw new Error("not ready"); };
  const oldStartReached = new Promise<void>((resolve) => { notifyOldStart = resolve; });
  store.startExecutionHook = async (currentClaimId) => {
    if (currentClaimId === "claim-1") {
      notifyOldStart();
      await oldStartBlocked;
    }
  };

  let releaseHealth: (value: unknown) => void = () => { throw new Error("not ready"); };
  const pendingHealth = new Promise<unknown>((resolve) => { releaseHealth = resolve; });
  let notifyHealth: () => void = () => { throw new Error("not ready"); };
  const healthStarted = new Promise<void>((resolve) => { notifyHealth = resolve; });
  const runtimeProvider = provider({ pendingHealth, onHealth: notifyHealth });
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);

  const oldAdvance = service.advance(advanceCommand(1, ["step-a"], "advance-old-owner"));
  await oldStartReached;
  store.recoverPreparedClaims = true;
  const recoveredAdvance = service.advance(advanceCommand(1, ["step-a"], "advance-new-owner"));
  await healthStarted;
  assert.deepEqual(store.recoveredClaims, [{ oldClaimId: "claim-1", newClaimId: "claim-2" }]);
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 0 });

  releaseOldStart();
  const oldResult = await oldAdvance;
  assert.equal(oldResult.status, "conflict");
  assert.equal(oldResult.reasons[0]?.code, "claim_conflict");
  assert.equal([...store.claims.values()].some((claim) => claim.claimId === "claim-2"), true);

  releaseHealth(validateAndNormalizeModelProviderHealth({
    providerId: "provider-mock",
    deploymentId: "deployment-mock",
    status: "healthy",
    observedAt: "2026-08-30T10:00:10.000Z",
    latencyMs: 1,
    detailCode: null,
  }));
  assert.equal((await recoveredAdvance).status, "completed");
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 1 });
});

test("pause persisted after claim fences startExecution before AI-029 and provider", async () => {
  const store = new FakeStore(initialState("single"));
  let releaseStart: () => void = () => { throw new Error("not ready"); };
  const startBlocked = new Promise<void>((resolve) => { releaseStart = resolve; });
  let notifyStart: () => void = () => { throw new Error("not ready"); };
  const startReached = new Promise<void>((resolve) => { notifyStart = resolve; });
  store.startExecutionHook = async () => {
    notifyStart();
    await startBlocked;
  };
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);

  const advance = service.advance(advanceCommand(1, ["step-a"], "advance-claimed-before-pause"));
  await startReached;
  const pause = {
    kind: "risk_approval" as const,
    stepId: "step-a",
    reasonCode: "approval_required" as const,
    approvalRequestId: "risk-approval-00000000000000000000000000000000",
    approvalStatus: "pending" as const,
  };
  assert.equal((await store.compareAndSwap({
    runId: "run-one",
    expectedRevision: 1,
    expectedPause: null,
    nextState: { ...clone(store.state), pause },
    claimId: null,
  })).status, "committed");
  releaseStart();

  const result = await advance;
  assert.equal(result.status, "conflict");
  assert.equal(result.reasons[0]?.code, "claim_conflict");
  assert.deepEqual(store.state.pause, pause);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("cancellation persisted after claim fences startExecution and remains factual", async () => {
  const store = new FakeStore(initialState("single"));
  let releaseStart: () => void = () => { throw new Error("not ready"); };
  const startBlocked = new Promise<void>((resolve) => { releaseStart = resolve; });
  let notifyStart: () => void = () => { throw new Error("not ready"); };
  const startReached = new Promise<void>((resolve) => { notifyStart = resolve; });
  store.startExecutionHook = async () => {
    notifyStart();
    await startBlocked;
  };
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);

  const advance = service.advance(advanceCommand(1, ["step-a"], "advance-claimed-before-cancel"));
  await startReached;
  const cancelled = await service.cancel({
    kind: "cancel",
    commandId: "cancel-after-claim",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
  });
  assert.equal(cancelled.status, "cancelled");
  releaseStart();

  const result = await advance;
  assert.equal(result.status, "conflict");
  assert.equal(store.state.snapshot.status, "cancelled");
  assert.equal(store.state.snapshot.revision, 2);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("factual revision advancement after claim fences startExecution before provider", async () => {
  const store = new FakeStore(initialState("single"));
  let releaseStart: () => void = () => { throw new Error("not ready"); };
  const startBlocked = new Promise<void>((resolve) => { releaseStart = resolve; });
  let notifyStart: () => void = () => { throw new Error("not ready"); };
  const startReached = new Promise<void>((resolve) => { notifyStart = resolve; });
  store.startExecutionHook = async () => {
    notifyStart();
    await startBlocked;
  };
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);

  const advance = service.advance(advanceCommand(1, ["step-a"], "advance-claimed-before-revision"));
  await startReached;
  const transition = evaluateWorkflowRunTransition({
    snapshot: clone(store.state.snapshot),
    event: {
      eventId: "concurrent-step-start-r2",
      runId: "run-one",
      kind: "step_started",
      sequence: 2,
      occurredAt: "2026-08-30T10:00:11.000Z",
      actorKind: "system",
      actorId: "workflow-runtime",
      stepId: "step-a",
    },
  });
  assert.equal(transition.verdict, "allow", JSON.stringify(transition.reasons));
  assert.ok(transition.nextSnapshot);
  assert.equal((await store.compareAndSwap({
    runId: "run-one",
    expectedRevision: 1,
    expectedPause: null,
    nextState: { ...clone(store.state), snapshot: transition.nextSnapshot },
    claimId: null,
  })).status, "committed");
  releaseStart();

  const result = await advance;
  assert.equal(result.status, "conflict");
  assert.equal(store.state.snapshot.revision, 2);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("ambiguous durable execution requires recovery before AI-029 and performs zero provider calls", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  store.startExecutionStatus = "recovery_required";
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.verdict, "deny");
  assert.equal(result.status, "recovery_required");
  assert.equal(result.reasons[0]?.code, "execution_recovery_required");
  assert.equal(store.startExecutionAttempts, 1);
  assert.equal(store.releaseAttempts, 1);
  assert.deepEqual([...store.executionJournal.values()], ["outcome_unknown"]);
  assert.equal(store.recordKnownExecutionOutcomeAttempts, 0);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("exception after durable execution start remains outcome_unknown", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  store.startExecutionThrowsAfterStart = true;
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.verdict, "deny");
  assert.equal(result.status, "recovery_required");
  assert.equal(result.reasons.some((reason) => reason.path === "store.startExecution"), true);
  assert.deepEqual([...store.executionJournal.values()], ["outcome_unknown"]);
  assert.equal(store.recordKnownExecutionOutcomeAttempts, 0);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("CAS conflict discards a completed model result without overwriting newer state", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  store.casConflicts = 1;
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.status, "conflict");
  assert.equal(result.reasons[0]?.code, "state_conflict");
  assert.equal(store.state.snapshot.revision, 1);
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 1 });
});

test("compareAndSwap exception fails closed, releases the claim, and never retries the provider", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  store.compareAndSwapThrows = 1;
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.verdict, "deny");
  assert.equal(result.status, "denied");
  assert.equal(result.reasons.some((reason) => (
    reason.code === "state_store_failed" && reason.path === "store.compareAndSwap"
  )), true);
  assert.equal(JSON.stringify(result).includes("sensitive compareAndSwap failure"), false);
  assert.equal(store.releaseAttempts, 1);
  assert.equal(store.claims.size, 0);
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 1 });
});

test("unreconciled CAS acknowledgement remains recovery_required and command replay is at-most-once", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  store.casRecoveryRequired = 1;
  const command = advanceCommand(1, ["step-a"], "advance-cas-unknown");
  const first = await service.advance(command);
  const replay = await service.advance(command);
  assert.equal(first.status, "recovery_required");
  assert.equal(replay.verdict, "idempotent");
  assert.equal(replay.status, "recovery_required");
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 1 });
});

test("reconciled lost CAS acknowledgement completes command replay with one provider call", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  store.reconciledLostCommitAcknowledgements = 1;
  const command = advanceCommand(1, ["step-a"], "advance-cas-reconciled");
  const first = await service.advance(command);
  const replay = await service.advance(command);
  assert.equal(first.status, "completed");
  assert.equal(replay.verdict, "idempotent");
  assert.equal(replay.status, "completed");
  assert.equal(store.reconciledLostCommitAcknowledgements, 0);
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 1 });
});

test("claim release is attempted after CAS conflict and after successful AI-029 commit", async () => {
  const conflictStore = new FakeStore(initialState("single"));
  const conflictProvider = provider();
  const conflictService = createWorkflowRuntimeService(dependencies(conflictStore, conflictProvider));
  await start(conflictService);
  conflictStore.casConflicts = 1;
  assert.equal((await conflictService.advance(advanceCommand(1, ["step-a"]))).status, "conflict");
  assert.equal(conflictStore.releaseAttempts, 1);
  assert.equal(conflictStore.claims.size, 0);

  const successStore = new FakeStore(initialState("single"));
  const successProvider = provider();
  const successService = createWorkflowRuntimeService(dependencies(successStore, successProvider));
  await start(successService);
  assert.equal((await successService.advance(advanceCommand(1, ["step-a"]))).status, "completed");
  assert.equal(successStore.releaseAttempts, 1);
  assert.equal(successStore.claims.size, 0);
  assert.deepEqual(successProvider.counts(), { health: 1, run: 1 });
});

test("AI-029 dependency exception still reaches the single claim-release path", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const base = dependencies(store, runtimeProvider);
  const service = createWorkflowRuntimeService({
    ...base,
    requirementsResolver: {
      async resolve() {
        throw new Error("sensitive requirements failure");
      },
    },
  });
  await start(service);
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.verdict, "deny");
  assert.equal(store.releaseAttempts, 1);
  assert.equal(store.claims.size, 0);
  assert.equal(JSON.stringify(result).includes("sensitive requirements failure"), false);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("releaseClaim exception is audit-safe after a committed at-most-once Agent result", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  store.releaseClaimThrows = 1;
  const result = await service.advance(advanceCommand(1, ["step-a"]));
  assert.equal(result.verdict, "deny");
  assert.equal(result.status, "denied");
  assert.equal(result.revision, 3);
  assert.equal(result.reasons.some((reason) => (
    reason.code === "state_store_failed" && reason.path === "store.releaseClaim"
  )), true);
  assert.equal(JSON.stringify(result).includes("sensitive releaseClaim failure"), false);
  assert.equal(store.releaseAttempts, 1);
  assert.deepEqual(runtimeProvider.counts(), { health: 1, run: 1 });
});

test("completeCommand exception returns store failure and abandons recoverable in-progress command", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  store.completeCommandThrows = 1;
  const first = await start(service);
  assert.equal(first.verdict, "deny");
  assert.equal(first.revision, 1);
  assert.equal(first.reasons.some((reason) => (
    reason.code === "state_store_failed" && reason.path === "store.completeCommand"
  )), true);
  assert.equal(JSON.stringify(first).includes("sensitive completeCommand failure"), false);
  assert.equal(store.abandonAttempts, 1);
  assert.equal(store.commands.has("start-one"), false);
  const repeated = await start(service);
  assert.notEqual(repeated.reasons[0]?.code, "command_in_progress");
  assert.equal(store.completeAttempts, 2);
  assert.deepEqual(runtimeProvider.counts(), { health: 0, run: 0 });
});

test("abandonCommand exception is reported separately without exposing store text", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  store.completeCommandThrows = 1;
  store.abandonCommandThrows = 1;
  const result = await start(service);
  assert.equal(result.verdict, "deny");
  assert.deepEqual(
    result.reasons.filter((reason) => reason.code === "state_store_failed").map((reason) => reason.path),
    ["store.completeCommand", "store.abandonCommand"],
  );
  assert.equal(JSON.stringify(result).includes("sensitive abandonCommand failure"), false);
  assert.equal(store.abandonAttempts, 1);
});

test("cancellation wins a race and late AI-029 completion cannot overwrite it", async () => {
  const store = new FakeStore(initialState("single"));
  let releaseHealth: (value: unknown) => void = () => { throw new Error("not ready"); };
  const pendingHealth = new Promise<unknown>((resolve) => { releaseHealth = resolve; });
  let notifyHealth: () => void = () => { throw new Error("not ready"); };
  const healthStarted = new Promise<void>((resolve) => { notifyHealth = resolve; });
  const runtimeProvider = provider({ pendingHealth, onHealth: notifyHealth });
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  const advance = service.advance(advanceCommand(1, ["step-a"]));
  await healthStarted;
  const cancelled = await service.cancel({
    kind: "cancel",
    commandId: "cancel-one",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
  });
  assert.equal(cancelled.status, "cancelled");
  releaseHealth(validateAndNormalizeModelProviderHealth({
    providerId: "provider-mock",
    deploymentId: "deployment-mock",
    status: "healthy",
    observedAt: "2026-08-30T10:00:10.000Z",
    latencyMs: 1,
    detailCode: null,
  }));
  const late = await advance;
  assert.equal(late.status, "conflict");
  assert.equal(store.state.snapshot.status, "cancelled");
  const blockedAdvance = await service.advance(
    advanceCommand(store.state.snapshot.revision, ["step-a"], "advance-after-cancel"),
  );
  assert.equal(blockedAdvance.status, "cancelled");
});

test("duplicate cancellation is idempotent and never creates another event", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  await start(service);
  const first = await service.cancel({
    kind: "cancel",
    commandId: "cancel-one",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
  });
  const eventCount = store.state.snapshot.events.length;
  const second = await service.cancel({
    kind: "cancel",
    commandId: "cancel-two",
    runId: "run-one",
    expectedRevision: 1,
    actorId: "owner-one",
  });
  assert.equal(first.status, "cancelled");
  assert.equal(second.verdict, "idempotent");
  assert.equal(store.state.snapshot.events.length, eventCount);
});

test("get returns an audit-safe view without trusted registries, history, or raw output", async () => {
  const store = new FakeStore(initialState("single"));
  const runtimeProvider = provider();
  const service = createWorkflowRuntimeService(dependencies(store, runtimeProvider));
  const result = await service.get({ kind: "get", runId: "run-one", actorId: "owner-one" });
  assert.equal(result.status, "running");
  assert.equal(JSON.stringify(result).includes("projectRegistry"), false);
  assert.equal(JSON.stringify(result).includes("modelProviderRegistry"), false);
  assert.equal(JSON.stringify(result).includes("existingRequests"), false);
  assert.equal(frozen(result), true);
});

test("source uses AI-029 once and contains no persistence, network, fallback, parallel, or retry loop", () => {
  const source = readFileSync(
    new URL("../lib/workflows/workflow-runtime-service.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/executeAgentStep\(/gu) ?? []).length, 1);
  for (const token of [
    "Open" + "AI", "Anth" + "ropic", "Q" + "wen", "Cod" + "ex", "fetch(",
    "http://", "https://", "node:fs", "child_process", "process.env", "writeFile",
    "prisma", "postgres", "Redis", "BullMQ", "Promise.all", "plan." + "fallbacks",
    "while (true)", "for (;;)", "setTimeout", "setInterval",
  ]) assert.equal(source.includes(token), false, token);
});
