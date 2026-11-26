// Project-document proposal workflow. Reuses the canonical Run/runtime contracts; no task authority.
import type { ModelInvocationMessage } from "../contracts/model-invocation";
import type { ProjectGenerationPolicy } from "../composition/project-planning-generation-config";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createWorkflowRunSnapshot } from "../contracts/workflow-run.ts";

// Versioned, built-in definition of the planning Workflow. Changing any of it is a new version.
export const projectGenerationWorkflow = Object.freeze({
  version: 1,
  budgetPolicy: "project_document_planning",
  departmentId: "pac-development",
  agentId: "pac-project-document-planner",
  workflowId: "pac-project-document-plan-planning",
  stepId: "project-plan",
  modelProfileId: "pac-project-document-planning",
  instructionProfileId: "pac-project-document-planning-v1",
  outputType: "task_proposal",
  // The project region is not modelled by the Project Registry; egress is instead gated by an
  // explicit per-invocation Owner approval (dataEgressMode approved_minimum).
  dataRegion: "owner-approved-egress",
});

export const planningKeyPattern = /^ppg-[0-9a-f]{20}$/u;

// Trusted `project_document_planning` policy: pinned provider identity, prices and the per-call / aggregate
// ceilings. Built only by lib/composition/project-planning-generation-config.ts from server configuration.
// Every durable identifier of one planning Run, derived from its server-generated planning key.
export function planningRunIds(planningKey: string) {
  if (!planningKeyPattern.test(planningKey)) throw new Error("Invalid planning key.");
  return Object.freeze({
    runId: planningKey,
    requestId: `${planningKey}-request`,
    schedulerIdempotencyKey: `${planningKey}-idempotency`,
    executionId: `${planningKey}-execution`,
    invocationId: `${planningKey}-invocation`,
    startCommandId: `${planningKey}-start`,
    advanceCommandId: `${planningKey}-advance`,
    stepId: projectGenerationWorkflow.stepId,
  });
}

const w = projectGenerationWorkflow;
const bindingId = (subjectId: string) => `${subjectId}-binding`;

function budget(policy: ProjectGenerationPolicy) {
  return {
    maxConcurrentRuns: 1,
    maxAttemptsPerRun: 1,
    maxRunMinutes: 30,
    dailyTokenBudget: policy.dailyTokenBudget,
    monthlyCostBudgetUsdCents: policy.monthlyCostBudgetUsdCents,
  };
}

function projectRegistry(workspaceId: string, project: Readonly<{ projectId: string; displayName: string }>, policy: ProjectGenerationPolicy) {
  const binding = (kind: "agent" | "workflow", subjectId: string) => ({
    id: bindingId(subjectId), projectId: project.projectId, departmentId: w.departmentId, version: w.version, status: "active", kind, subjectId,
    requestedResources: [], requestedModelProfileIds: [w.modelProfileId], requestedKnowledgeCollectionIds: [],
    requestedBudget: budget(policy), externalActionMode: "approval_required", dataEgressMode: "approved_minimum",
    additionalRequiredApprovalActions: [], additionalForbiddenActions: [],
  });
  return {
    workspaceId,
    projects: [{
      projectManifest: {
        id: project.projectId, workspaceId, version: w.version, name: project.displayName, slug: project.projectId,
        summary: "Planning policy snapshot: one Owner-approved AI Project plan candidate.", kind: "internal_product", status: "active",
        defaultLocale: "en-US", timeZone: "UTC", dataRegion: w.dataRegion, dataClassification: "internal",
        goals: ["Draft one reviewable Project plan candidate"], nonGoals: ["Any repository, executor or external action"], tags: ["project-planning"],
        resources: [], allowedModelProfileIds: [w.modelProfileId], knowledgeCollectionIds: [],
        policy: { externalActionMode: "approval_required", dataEgressMode: "approved_minimum", requiredApprovalActions: [], forbiddenActions: [] },
        budget: budget(policy),
      },
      departmentManifests: [{
        id: w.departmentId, projectId: project.projectId, version: w.version, code: "development", name: "Development planning",
        summary: "Turns an Owner development request into a Project plan candidate.", status: "active", operatingMode: "approval_gated",
        goals: ["Reviewable Project plan candidates"], nonGoals: ["Code changes"], resourceGrants: [],
        allowedModelProfileIds: [w.modelProfileId], knowledgeCollectionIds: [], enabledWorkflowIds: [w.workflowId],
        operatorRoleIds: ["role-owner"],
        modelRouting: { primaryModelProfileId: w.modelProfileId, fallbackModelProfileIds: [], reviewerModelProfileId: null, independentReviewRequired: false },
        policy: { externalActionMode: "approval_required", dataEgressMode: "approved_minimum", additionalRequiredApprovalActions: [], additionalForbiddenActions: [] },
        budget: budget(policy),
      }],
      bindings: [binding("agent", w.agentId), binding("workflow", w.workflowId)],
    }],
  };
}

function agentManifest(projectId: string) {
  return {
    id: w.agentId, projectId, departmentId: w.departmentId, version: w.version, roleCode: "task_designer", name: "Project planner",
    summary: "Drafts one Project plan candidate from the Owner's development request.", status: "active", instructionProfileId: w.instructionProfileId,
    goals: ["Reviewable Project plan candidate"], nonGoals: ["Repository access", "Code changes"], outputTypes: [w.outputType],
    allowedWorkflowIds: [w.workflowId], allowedToolIds: [], allowedModelProfileIds: [w.modelProfileId], knowledgeCollectionIds: [],
    modelRouting: { primaryModelProfileId: w.modelProfileId, fallbackModelProfileIds: [], reviewerModelProfileId: null, independentReviewRequired: false },
    additionalRequiredApprovalActions: [], additionalForbiddenActions: [],
  };
}

function workflowManifest(projectId: string) {
  return {
    id: w.workflowId, projectId, departmentId: w.departmentId, version: w.version, name: "AI Project plan planning",
    summary: "One Step, one bounded planning invocation, no tools.", status: "active", triggerMode: "manual",
    goals: ["One Project plan candidate"], nonGoals: ["Execution"],
    steps: [{
      id: w.stepId, kind: "agent_task", name: "Draft Project plan candidate", dependsOnStepIds: [],
      agentId: w.agentId, agentBindingId: bindingId(w.agentId), outputType: w.outputType, requestedResources: [],
      modelProfileId: w.modelProfileId, knowledgeCollectionIds: [], toolIds: [], maxAttempts: 1, timeoutMinutes: 30,
      actionMode: "proposal_only", requiredApprovalAction: null,
    }],
    finalStepIds: [w.stepId], additionalRequiredApprovalActions: [], additionalForbiddenActions: [],
  };
}

// The model registry pins exactly the composed provider's identity, limits and prices, so routing,
// preflight budget and cost arithmetic use one trusted configuration.
function modelProviderRegistry(workspaceId: string, policy: ProjectGenerationPolicy) {
  const identity = policy.identity;
  return {
    workspaceId, version: w.version,
    providers: [{
      id: identity.providerId, kind: identity.providerKind, status: "active", deploymentMode: "remote",
      supportedDataRegions: [w.dataRegion], supportedDataEgressModes: ["approved_minimum"], capabilities: ["messages"],
    }],
    deployments: [{
      id: identity.deploymentId, providerId: identity.providerId, status: "active",
      providerModelId: identity.providerModelId, providerRequestModelId: identity.providerRequestModelId,
      providerModelVersion: identity.providerModelVersion, capabilities: ["messages"], supportedOutputTypes: [w.outputType],
      maxInputTokens: policy.maxInputTokens, maxOutputTokens: policy.maxOutputTokens,
      inputCostUsdMicrosPerMillionTokens: policy.inputCostUsdMicrosPerMillionTokens,
      outputCostUsdMicrosPerMillionTokens: policy.outputCostUsdMicrosPerMillionTokens,
      latencyClass: "standard", qualityTier: "reasoning",
    }],
    modelProfiles: [{
      modelProfileId: w.modelProfileId, status: "active", requiredCapabilities: ["messages"], supportedOutputTypes: [w.outputType],
      candidates: [{ deploymentId: identity.deploymentId, priority: 1 }],
    }],
  };
}

// The initial durable state of one planning Run (queued; started by the runtime's own `start`).
// Returns null when the canonical Workflow Run contract denies the definition (fail closed).
export function createProjectGenerationRunState(input: Readonly<{
  workspaceId: string;
  planningKey: string;
  project: Readonly<{ projectId: string; displayName: string }>;
  createdAt: string;
  policy: ProjectGenerationPolicy;
}>) {
  const ids = planningRunIds(input.planningKey);
  const registry = projectRegistry(input.workspaceId, input.project, input.policy);
  const created = createWorkflowRunSnapshot({
    runId: ids.runId,
    requestId: ids.requestId,
    createdAt: input.createdAt,
    schedulerInput: {
      registry: structuredClone(registry),
      policy: {
        workspaceId: input.workspaceId, status: "active", maxConcurrentRuns: 1, maxQueuedRuns: 1,
        projectPolicies: [{ projectId: input.project.projectId, status: "active", maxQueuedRuns: 1, allowedPriorities: ["P2"] }],
      },
      queuedRequests: [{
        id: ids.requestId, workspaceId: input.workspaceId, projectId: input.project.projectId,
        bindingId: bindingId(w.workflowId), modelProfileId: w.modelProfileId, idempotencyKey: ids.schedulerIdempotencyKey,
        priority: "P2", sequence: 1,
      }],
      runningRuns: [],
      lastDispatchedProjectId: null,
    },
    workflowCatalog: {
      registry,
      agents: [{ bindingId: bindingId(w.agentId), agentManifest: agentManifest(input.project.projectId) }],
      workflows: [{ bindingId: bindingId(w.workflowId), workflowManifest: workflowManifest(input.project.projectId) }],
    },
  });
  if (created.verdict !== "allow" || !created.snapshot) return null;
  return {
    snapshot: created.snapshot,
    projectRegistry: registry,
    modelProviderRegistry: modelProviderRegistry(input.workspaceId, input.policy),
    existingRequests: [],
    pause: null,
  };
}

// The one `advance` of the planning Run: exactly one invocation draft carrying the planning messages.
export function planningAdvanceCommand(planningKey: string, ownerUserId: string, expectedRevision: number, messages: readonly ModelInvocationMessage[]) {
  const ids = planningRunIds(planningKey);
  return {
    kind: "advance" as const,
    commandId: ids.advanceCommandId,
    runId: ids.runId,
    expectedRevision,
    actorId: ownerUserId,
    agentInputs: [{
      stepId: ids.stepId,
      executionId: ids.executionId,
      invocationDraft: {
        invocationId: ids.invocationId,
        invocationSequence: 1,
        stepId: ids.stepId,
        messages: messages.map((message) => ({ role: message.role, content: message.content, toolCallId: message.toolCallId ?? null })),
        contextArtifactIds: [],
      },
    }],
  };
}

// The capability requirements of the planning Step: the exact per-invocation ceilings of the policy.
export function planningRequirementsResolver(policy: ProjectGenerationPolicy) {
  return Object.freeze({
    resolve: () => ({
      taskClass: "planning",
      requestedCapability: "reasoning",
      riskLevel: "medium",
      requiresModel: true,
      requiresRepositoryRead: false,
      requiresRepositoryWrite: false,
      requiresCommandExecution: false,
      requiresNetwork: false,
      budget: { maxInputTokens: policy.maxInputTokens, maxOutputTokens: policy.maxOutputTokens, maxCostUsdMicros: policy.maxCostUsdMicros },
    }),
  });
}

// Derive the one factual request using canonical contracts before persisting authorization.
// Timestamps do not participate in the invocation fingerprint; only trusted run/source/policy facts do.
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { evaluateWorkflowRunTransition } from '../contracts/workflow-run.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { evaluateModelInvocationAdmission } from '../contracts/model-invocation.ts';
// @ts-expect-error Direct Node TypeScript execution requires extension.
import { createModelInvocationRequestFingerprint } from '../contracts/model-invocation-data-handling.ts';
export function projectGenerationInvocationFingerprint(input:Parameters<typeof createProjectGenerationRunState>[0],messages:readonly ModelInvocationMessage[]){
 const state=createProjectGenerationRunState(input);if(!state)return null;
 const ids=planningRunIds(input.planningKey);
 const start=evaluateWorkflowRunTransition({snapshot:state.snapshot,event:{eventId:ids.startCommandId,runId:ids.runId,kind:'run_started',sequence:1,occurredAt:input.createdAt,actorKind:'owner',actorId:'project-owner'}});
 if(!start.nextSnapshot)return null;
 const step=evaluateWorkflowRunTransition({snapshot:start.nextSnapshot,event:{eventId:ids.executionId,runId:ids.runId,kind:'step_started',sequence:2,occurredAt:input.createdAt,actorKind:'system',actorId:'workflow-runtime',stepId:ids.stepId}});
 if(!step.nextSnapshot)return null;
 const command=planningAdvanceCommand(ids.runId,'project-owner',1,messages);
 const request=evaluateModelInvocationAdmission({snapshot:step.nextSnapshot,draft:command.agentInputs[0].invocationDraft,existingRequests:[]}).normalizedRequest;
 return request?createModelInvocationRequestFingerprint(request):null;
}
