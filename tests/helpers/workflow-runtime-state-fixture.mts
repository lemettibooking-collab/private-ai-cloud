import assert from "node:assert/strict";

const runContract = (await import(
  new URL("../../lib/contracts/workflow-run.ts", import.meta.url).href
)) as typeof import("../../lib/contracts/workflow-run");

const { createWorkflowRunSnapshot, evaluateWorkflowRunTransition } = runContract;

function budget() {
  return {
    maxConcurrentRuns: 4,
    maxAttemptsPerRun: 3,
    maxRunMinutes: 120,
    dailyTokenBudget: 1_000_000,
    monthlyCostBudgetUsdCents: 250_000,
  };
}

function registry() {
  const binding = (kind: "agent" | "workflow", subjectId: string) => ({
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
    requestedBudget: { ...budget(), maxConcurrentRuns: 1, maxRunMinutes: 30 },
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
        summary: "Durable runtime project.",
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
          requiredApprovalActions: [],
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
        summary: "Durable runtime department.",
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
        budget: { ...budget(), maxConcurrentRuns: 3, maxRunMinutes: 60 },
      }],
      bindings: [binding("agent", "agent-one"), binding("workflow", "workflow-one")],
    }],
  };
}

function agent() {
  return {
    id: "agent-one",
    projectId: "project-one",
    departmentId: "department-one",
    version: 1,
    roleCode: "developer",
    name: "Agent one",
    summary: "Executes a factual Workflow step.",
    status: "active",
    instructionProfileId: "instructions-one",
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

function workflow() {
  return {
    id: "workflow-one",
    projectId: "project-one",
    departmentId: "department-one",
    version: 1,
    name: "Workflow one",
    summary: "Canonical durable runtime workflow.",
    status: "active",
    triggerMode: "manual",
    goals: ["Produce reviewed output"],
    nonGoals: ["Deploy"],
    steps: [{
      id: "step-one",
      kind: "agent_task",
      name: "Execute step one",
      dependsOnStepIds: [],
      agentId: "agent-one",
      agentBindingId: "agent-one-binding",
      outputType: "patch",
      requestedResources: [{ resourceId: "repository-one", capabilities: ["read_metadata"] }],
      modelProfileId: "model-shared",
      knowledgeCollectionIds: [],
      toolIds: [],
      maxAttempts: 2,
      timeoutMinutes: 30,
      actionMode: "proposal_only",
      requiredApprovalAction: null,
    }],
    finalStepIds: ["step-one"],
    additionalRequiredApprovalActions: [],
    additionalForbiddenActions: [],
  };
}

export function createWorkflowRuntimeStateFixture() {
  const projectRegistry = registry();
  const creation = createWorkflowRunSnapshot({
    runId: "run-one",
    requestId: "request-one",
    createdAt: "2026-09-01T10:00:00.000Z",
    schedulerInput: {
      registry: structuredClone(projectRegistry),
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
      registry: projectRegistry,
      agents: [{ bindingId: "agent-one-binding", agentManifest: agent() }],
      workflows: [{ bindingId: "workflow-one-binding", workflowManifest: workflow() }],
    },
  });
  assert.equal(creation.verdict, "allow", JSON.stringify(creation.reasons));
  assert.ok(creation.snapshot);
  return {
    snapshot: creation.snapshot,
    projectRegistry,
    modelProviderRegistry: {
      workspaceId: "workspace-primary",
      version: 1,
      providers: [],
      deployments: [],
      modelProfiles: [],
    },
    existingRequests: [],
    pause: null,
  };
}

export function transitionRuntimeState(
  state: ReturnType<typeof createWorkflowRuntimeStateFixture>,
  kind: "run_started" | "run_cancelled",
) {
  const transition = evaluateWorkflowRunTransition({
    snapshot: state.snapshot,
    event: {
      eventId: `event-${kind}`,
      runId: state.snapshot.runId,
      kind,
      sequence: state.snapshot.revision + 1,
      occurredAt: "2026-09-01T10:01:00.000Z",
      actorKind: "owner",
      actorId: "owner-one",
      ...(kind === "run_cancelled"
        ? { reasonCode: "owner_cancelled", message: "Owner cancelled the run." }
        : {}),
    },
  });
  assert.equal(transition.verdict, "allow", JSON.stringify(transition.reasons));
  assert.ok(transition.nextSnapshot);
  return { ...state, snapshot: transition.nextSnapshot };
}
