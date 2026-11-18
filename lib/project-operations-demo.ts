import type {
  DepartmentManifest,
  DepartmentResourceGrant,
} from "./contracts/department-manifest";
import type {
  ProjectContextReason,
  ProjectExecutionContextResolutionDecision,
  ProjectSubjectBinding,
  WorkspaceProjectContextsDecision,
} from "./contracts/project-context";
import type {
  MultiProjectRunBlockedRequest,
  MultiProjectRunDispatchPlanDecision,
  MultiProjectRunSchedulerPolicy,
  MultiProjectRunSchedulerReason,
  ProjectRunPriority,
  ProjectRunRequest,
  RunningProjectRun,
} from "./contracts/multi-project-run-scheduler";
import type {
  ProjectBudgetCeiling,
  ProjectManifest,
  ProjectResourceCapability,
} from "./contracts/project-manifest";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeDepartmentManifest } from "./contracts/department-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateWorkspaceProjectContexts, resolveProjectExecutionContext } from "./contracts/project-context.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { buildMultiProjectRunDispatchPlan } from "./contracts/multi-project-run-scheduler.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeProjectManifest } from "./contracts/project-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { createProjectControlCenterDemo } from "./project-control-center-demo.ts";

export const projectOperationsScopeKinds = Object.freeze([
  "workspace",
  "project",
] as const);

export type ProjectOperationsScope =
  | Readonly<{ kind: "workspace" }>
  | Readonly<{ kind: "project"; projectId: string }>;

export type ProjectOperationsRegistryInput = Readonly<{
  workspaceId: string;
  projects: readonly Readonly<{
    projectManifest: ProjectManifest;
    departmentManifests: readonly DepartmentManifest[];
    bindings: readonly ProjectSubjectBinding[];
  }>[];
}>;

export type ProjectOperationsSchedulerInput = Readonly<{
  registry: ProjectOperationsRegistryInput;
  policy: MultiProjectRunSchedulerPolicy;
  queuedRequests: readonly ProjectRunRequest[];
  runningRuns: readonly RunningProjectRun[];
  lastDispatchedProjectId: string | null;
}>;

export type ProjectOperationsBindingResolution = Readonly<{
  projectId: string;
  bindingId: string;
  decision: ProjectExecutionContextResolutionDecision;
}>;

export type ProjectOperationsIntegritySeal = Readonly<{
  workspaceId: string;
  registryInput: string;
  schedulerRegistry: string;
  registryDecision: string;
  schedulerPolicy: string;
  queuedRequests: string;
  runningRuns: string;
  cursor: string;
  schedulerDecision: string;
}>;

export type ProjectOperationsSnapshotProject = Readonly<{
  projectId: string;
  name: string;
  status: ProjectManifest["status"];
}>;

export type ProjectOperationsDemo = Readonly<{
  workspaceId: string;
  registryInput: ProjectOperationsRegistryInput;
  registryDecision: WorkspaceProjectContextsDecision;
  bindingResolutions: readonly ProjectOperationsBindingResolution[];
  schedulerInput: ProjectOperationsSchedulerInput;
  schedulerDecision: MultiProjectRunDispatchPlanDecision;
  projectionSnapshot: ProjectOperationsProjectionSnapshot;
}>;

export type ProjectOperationsUnavailableReason = Readonly<{
  source: "registry" | "scheduler" | "scope" | "projection";
  code: string;
  path: string;
  message: string;
  projectId: string | null;
  departmentId: string | null;
  bindingId: string | null;
}>;

export type ProjectOperationsProjectRow = Readonly<{
  projectId: string;
  name: string;
  status: ProjectManifest["status"];
  departmentsCount: number;
  agentsCount: number;
  workflowsCount: number;
  queuedCount: number;
  runningCount: number;
  plannedCount: number;
  blockedCount: number;
}>;

export type ProjectOperationsDepartmentRow = Readonly<{
  projectId: string;
  projectName: string;
  departmentId: string;
  name: string;
  code: DepartmentManifest["code"];
  status: DepartmentManifest["status"];
  operatingMode: DepartmentManifest["operatingMode"];
  agentsCount: number;
  workflowsCount: number;
  effectiveMaxConcurrentRuns: number;
}>;

export type ProjectOperationsBindingRow = Readonly<{
  projectId: string;
  projectName: string;
  departmentId: string;
  departmentName: string;
  bindingId: string;
  subjectId: string;
  status: ProjectSubjectBinding["status"];
  modelProfileIds: readonly string[];
  effectiveMaxConcurrentRuns: number;
}>;

export type ProjectOperationsQueueStatus = "planned" | "blocked";

export type ProjectOperationsRunBase = Readonly<{
  projectId: string;
  projectName: string;
  departmentId: string;
  departmentName: string;
  bindingId: string;
  bindingKind: ProjectSubjectBinding["kind"];
  subjectId: string;
  modelProfileId: string;
  priority: ProjectRunPriority;
}>;

export type ProjectOperationsQueueRow = ProjectOperationsRunBase &
  Readonly<{
    requestId: string;
    factualStatus: ProjectOperationsQueueStatus;
  }>;

export type ProjectOperationsRunningRow = ProjectOperationsRunBase &
  Readonly<{
    runId: string;
    requestId: string;
    factualStatus: "running";
  }>;

export type ProjectOperationsDispatchRow = ProjectOperationsRunBase &
  Readonly<{
    requestId: string;
    factualStatus: "planned";
  }>;

export type ProjectOperationsBlockedReason = Readonly<{
  code: MultiProjectRunSchedulerReason["code"];
  path: string;
  message: string;
  ownerMessage: string;
  projectId: string | null;
  departmentId: string | null;
  bindingId: string | null;
}>;

export type ProjectOperationsBlockedRow = ProjectOperationsRunBase &
  Readonly<{
    requestId: string;
    factualStatus: "blocked";
    reasons: readonly ProjectOperationsBlockedReason[];
  }>;

export type ProjectOperationsSummary = Readonly<{
  projects: number;
  queued: number;
  running: number;
  planned: number;
  blocked: number;
  schedulerStatus: MultiProjectRunSchedulerPolicy["status"];
  schedulerVerdict: MultiProjectRunDispatchPlanDecision["verdict"];
  lastRoundRobinProjectId: string | null;
  nextRoundRobinProjectId: string | null;
}>;

export type AvailableProjectOperationsView = Readonly<{
  available: true;
  scope: ProjectOperationsScope;
  workspaceId: string;
  totalsLabel: "Workspace totals" | "Project totals";
  summary: ProjectOperationsSummary;
  projects: readonly ProjectOperationsProjectRow[];
  departments: readonly ProjectOperationsDepartmentRow[];
  agents: readonly ProjectOperationsBindingRow[];
  workflows: readonly ProjectOperationsBindingRow[];
  queued: readonly ProjectOperationsQueueRow[];
  running: readonly ProjectOperationsRunningRow[];
  dispatches: readonly ProjectOperationsDispatchRow[];
  blocked: readonly ProjectOperationsBlockedRow[];
}>;

export type UnavailableProjectOperationsView = Readonly<{
  available: false;
  scope: ProjectOperationsScope;
  workspaceId: string;
  title: string;
  reasons: readonly ProjectOperationsUnavailableReason[];
}>;

export type ProjectOperationsView =
  | AvailableProjectOperationsView
  | UnavailableProjectOperationsView;

export type AvailableProjectOperationsProjectionSnapshot = Readonly<{
  state: "available";
  workspaceId: string;
  integrity: ProjectOperationsIntegritySeal;
  payloadDigest: string;
  schedulerStatus: MultiProjectRunSchedulerPolicy["status"];
  schedulerVerdict: MultiProjectRunDispatchPlanDecision["verdict"];
  lastRoundRobinProjectId: string | null;
  nextRoundRobinProjectId: string | null;
  projects: readonly ProjectOperationsSnapshotProject[];
  departments: readonly ProjectOperationsDepartmentRow[];
  agents: readonly ProjectOperationsBindingRow[];
  workflows: readonly ProjectOperationsBindingRow[];
  queued: readonly ProjectOperationsQueueRow[];
  running: readonly ProjectOperationsRunningRow[];
  dispatches: readonly ProjectOperationsDispatchRow[];
  blocked: readonly ProjectOperationsBlockedRow[];
}>;

export type UnavailableProjectOperationsProjectionSnapshot = Readonly<{
  state: "unavailable";
  workspaceId: string;
  integrity: ProjectOperationsIntegritySeal | null;
  payloadDigest: string;
  title: string;
  reasons: readonly ProjectOperationsUnavailableReason[];
}>;

export type ProjectOperationsProjectionSnapshot =
  | AvailableProjectOperationsProjectionSnapshot
  | UnavailableProjectOperationsProjectionSnapshot;

type ProjectOperationsProjectionSources = Readonly<{
  workspaceId: string;
  registryInput: ProjectOperationsRegistryInput;
  registryDecision: WorkspaceProjectContextsDecision;
  schedulerInput: ProjectOperationsSchedulerInput;
  schedulerDecision: MultiProjectRunDispatchPlanDecision;
}>;

type ProjectConfiguration = Readonly<{
  projectId: "private-ai-cloud" | "smart-algorithms";
  knowledgeCollectionId: "kb-security-policy" | "kb-marketing-guide";
}>;

const projectConfigurations: readonly ProjectConfiguration[] = Object.freeze([
  {
    projectId: "private-ai-cloud",
    knowledgeCollectionId: "kb-security-policy",
  },
  {
    projectId: "smart-algorithms",
    knowledgeCollectionId: "kb-marketing-guide",
  },
]);

function budget(
  maxConcurrentRuns: number,
  maxAttemptsPerRun = 2,
  maxRunMinutes = 60,
  dailyTokenBudget = 250_000,
  monthlyCostBudgetUsdCents = 50_000,
): ProjectBudgetCeiling {
  return {
    maxConcurrentRuns,
    maxAttemptsPerRun,
    maxRunMinutes,
    dailyTokenBudget,
    monthlyCostBudgetUsdCents,
  };
}

function grant(
  resourceId: string,
  capabilities: readonly ProjectResourceCapability[],
): DepartmentResourceGrant {
  return { resourceId, capabilities: [...capabilities] };
}

function requireProjectManifest(
  manifest: ProjectManifest,
  knowledgeCollectionId: ProjectConfiguration["knowledgeCollectionId"],
): ProjectManifest {
  const validation = validateAndNormalizeProjectManifest({
    ...manifest,
    knowledgeCollectionIds: [knowledgeCollectionId],
  });
  if (!validation.ok) {
    throw new Error(
      `AI-018 ProjectManifest configuration is invalid: ${JSON.stringify(validation.errors)}`,
    );
  }
  return validation.value;
}

function requireDepartmentManifest(input: DepartmentManifest): DepartmentManifest {
  const validation = validateAndNormalizeDepartmentManifest(input);
  if (!validation.ok) {
    throw new Error(
      `AI-018 DepartmentManifest configuration is invalid: ${JSON.stringify(validation.errors)}`,
    );
  }
  return validation.value;
}

function department(
  input: Omit<DepartmentManifest, "version" | "status" | "operatingMode" | "goals" | "nonGoals" | "operatorRoleIds">,
): DepartmentManifest {
  return requireDepartmentManifest({
    ...input,
    version: 1,
    status: "active",
    operatingMode: "approval_gated",
    goals: ["Готовить проверяемый результат в пределах проекта"],
    nonGoals: ["Запускать внешние действия без решения Owner"],
    operatorRoleIds: ["role-owner"],
  });
}

function binding(
  input: Omit<
    ProjectSubjectBinding,
    | "version"
    | "status"
    | "externalActionMode"
    | "dataEgressMode"
    | "additionalRequiredApprovalActions"
    | "additionalForbiddenActions"
  >,
): ProjectSubjectBinding {
  return {
    ...input,
    version: 1,
    status: "active",
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    additionalRequiredApprovalActions: ["owner_run_review"],
    additionalForbiddenActions: ["Автоматическое внешнее действие запрещено"],
  };
}

function createPrivateAiCloudContext(projectManifest: ProjectManifest) {
  const development = department({
    id: "pac-development",
    projectId: projectManifest.id,
    code: "development",
    name: "Development Department",
    summary: "Разработка контролируемых изменений без автоматического merge.",
    resourceGrants: [
      grant("repository", ["read_metadata", "read_content", "propose_change"]),
    ],
    allowedModelProfileIds: ["model-codex-openai", "model-qwen-reviewer"],
    knowledgeCollectionIds: ["kb-security-policy"],
    enabledWorkflowIds: ["workflow-development-plan"],
    modelRouting: {
      primaryModelProfileId: "model-codex-openai",
      fallbackModelProfileIds: [],
      reviewerModelProfileId: "model-qwen-reviewer",
      independentReviewRequired: true,
    },
    policy: {
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
      additionalRequiredApprovalActions: ["owner_code_acceptance"],
      additionalForbiddenActions: ["Автоматический merge запрещён"],
    },
    budget: budget(2),
  });
  const quality = department({
    id: "pac-qa-review",
    projectId: projectManifest.id,
    code: "qa-code-review",
    name: "QA / Review Department",
    summary: "Независимая проверка качества и границ изменений.",
    resourceGrants: [grant("repository", ["read_metadata", "read_content"])],
    allowedModelProfileIds: ["model-qwen-reviewer", "model-codex-openai"],
    knowledgeCollectionIds: ["kb-security-policy"],
    enabledWorkflowIds: ["workflow-qa-review"],
    modelRouting: {
      primaryModelProfileId: "model-qwen-reviewer",
      fallbackModelProfileIds: [],
      reviewerModelProfileId: "model-codex-openai",
      independentReviewRequired: true,
    },
    policy: {
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
      additionalRequiredApprovalActions: ["owner_review_acceptance"],
      additionalForbiddenActions: ["Самостоятельное принятие кода запрещено"],
    },
    budget: budget(1),
  });
  const bindings: readonly ProjectSubjectBinding[] = [
    binding({
      id: "pac-dev-workflow",
      projectId: projectManifest.id,
      departmentId: development.id,
      kind: "workflow",
      subjectId: "workflow-development-plan",
      requestedResources: [grant("repository", ["read_metadata", "propose_change"])],
      requestedModelProfileIds: ["model-codex-openai"],
      requestedKnowledgeCollectionIds: ["kb-security-policy"],
      requestedBudget: budget(1, 1, 45, 150_000, 25_000),
    }),
    binding({
      id: "pac-qa-agent",
      projectId: projectManifest.id,
      departmentId: quality.id,
      kind: "agent",
      subjectId: "agent-qa-reviewer",
      requestedResources: [grant("repository", ["read_metadata", "read_content"])],
      requestedModelProfileIds: ["model-qwen-reviewer", "model-codex-openai"],
      requestedKnowledgeCollectionIds: ["kb-security-policy"],
      requestedBudget: budget(1, 1, 45, 150_000, 25_000),
    }),
  ];
  return {
    projectManifest,
    departmentManifests: [development, quality],
    bindings,
  };
}

function createSmartAlgorithmsContext(projectManifest: ProjectManifest) {
  const product = department({
    id: "sa-product",
    projectId: projectManifest.id,
    code: "product",
    name: "Product Department",
    summary: "Подготовка продуктовых решений и проверяемых требований.",
    resourceGrants: [
      grant("sa-repository", ["read_metadata", "read_content", "propose_change"]),
    ],
    allowedModelProfileIds: ["model-codex-openai", "model-qwen-reviewer"],
    knowledgeCollectionIds: ["kb-marketing-guide"],
    enabledWorkflowIds: ["workflow-product-brief"],
    modelRouting: {
      primaryModelProfileId: "model-codex-openai",
      fallbackModelProfileIds: [],
      reviewerModelProfileId: "model-qwen-reviewer",
      independentReviewRequired: true,
    },
    policy: {
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
      additionalRequiredApprovalActions: ["owner_product_review"],
      additionalForbiddenActions: ["Автоматическое изменение продукта запрещено"],
    },
    budget: budget(2),
  });
  const marketing = department({
    id: "sa-marketing",
    projectId: projectManifest.id,
    code: "marketing",
    name: "Marketing / Growth Department",
    summary: "Подготовка drafts без автоматической публикации.",
    resourceGrants: [
      grant("sa-telegram", ["read_metadata", "create_draft"]),
      grant("sa-website", ["read_metadata", "read_content", "create_draft"]),
    ],
    allowedModelProfileIds: ["model-qwen-reviewer", "model-codex-openai"],
    knowledgeCollectionIds: ["kb-marketing-guide"],
    enabledWorkflowIds: ["workflow-marketing-draft"],
    modelRouting: {
      primaryModelProfileId: "model-qwen-reviewer",
      fallbackModelProfileIds: [],
      reviewerModelProfileId: "model-codex-openai",
      independentReviewRequired: true,
    },
    policy: {
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
      additionalRequiredApprovalActions: ["owner_content_review"],
      additionalForbiddenActions: ["Автоматическая публикация запрещена"],
    },
    budget: budget(1),
  });
  const bindings: readonly ProjectSubjectBinding[] = [
    binding({
      id: "sa-product-agent",
      projectId: projectManifest.id,
      departmentId: product.id,
      kind: "agent",
      subjectId: "agent-product-owner",
      requestedResources: [grant("sa-repository", ["read_metadata", "read_content"])],
      requestedModelProfileIds: ["model-codex-openai", "model-qwen-reviewer"],
      requestedKnowledgeCollectionIds: ["kb-marketing-guide"],
      requestedBudget: budget(1, 1, 45, 150_000, 25_000),
    }),
    binding({
      id: "sa-marketing-workflow",
      projectId: projectManifest.id,
      departmentId: marketing.id,
      kind: "workflow",
      subjectId: "workflow-marketing-draft",
      requestedResources: [grant("sa-telegram", ["read_metadata", "create_draft"])],
      requestedModelProfileIds: ["model-qwen-reviewer"],
      requestedKnowledgeCollectionIds: ["kb-marketing-guide"],
      requestedBudget: budget(1, 1, 45, 150_000, 25_000),
    }),
  ];
  return {
    projectManifest,
    departmentManifests: [product, marketing],
    bindings,
  };
}

function request(
  id: string,
  projectId: string,
  bindingId: string,
  modelProfileId: string,
  priority: ProjectRunPriority,
  sequence: number,
): ProjectRunRequest {
  return {
    id,
    workspaceId: "smart-algorithms-demo",
    projectId,
    bindingId,
    modelProfileId,
    idempotencyKey: `idempotency-${id}`,
    priority,
    sequence,
  };
}

function runningRun(
  runId: string,
  requestId: string,
  projectId: string,
  bindingId: string,
  modelProfileId: string,
  priority: ProjectRunPriority,
): RunningProjectRun {
  return {
    runId,
    requestId,
    workspaceId: "smart-algorithms-demo",
    projectId,
    bindingId,
    modelProfileId,
    idempotencyKey: `idempotency-${requestId}`,
    priority,
    startedSequence: 1,
  };
}

function createRegistryInput(): ProjectOperationsRegistryInput {
  const controlCenter = createProjectControlCenterDemo();
  const manifests = new Map(
    controlCenter.projects.map((project) => [project.manifest.id, project.manifest]),
  );
  const contexts = projectConfigurations.map((configuration) => {
    const source = manifests.get(configuration.projectId);
    if (!source) {
      throw new Error(`AI-014 project ${configuration.projectId} is unavailable.`);
    }
    const manifest = requireProjectManifest(
      source,
      configuration.knowledgeCollectionId,
    );
    return configuration.projectId === "private-ai-cloud"
      ? createPrivateAiCloudContext(manifest)
      : createSmartAlgorithmsContext(manifest);
  });
  return {
    workspaceId: "smart-algorithms-demo",
    projects: contexts,
  };
}

function createSchedulerPolicy(): MultiProjectRunSchedulerPolicy {
  return {
    workspaceId: "smart-algorithms-demo",
    status: "active",
    maxConcurrentRuns: 3,
    maxQueuedRuns: 8,
    projectPolicies: [
      {
        projectId: "private-ai-cloud",
        status: "active",
        maxQueuedRuns: 4,
        allowedPriorities: ["P0", "P1", "P2", "P3", "P4"],
      },
      {
        projectId: "smart-algorithms",
        status: "active",
        maxQueuedRuns: 4,
        allowedPriorities: ["P0", "P1", "P2", "P3", "P4"],
      },
    ],
  };
}

function resolveAllBindings(
  registryInput: ProjectOperationsRegistryInput,
): readonly ProjectOperationsBindingResolution[] {
  return registryInput.projects.flatMap((project) =>
    project.bindings.map((candidate) => ({
      projectId: project.projectManifest.id,
      bindingId: candidate.id,
      decision: resolveProjectExecutionContext({
        registry: registryInput,
        projectId: project.projectManifest.id,
        bindingId: candidate.id,
      }),
    })),
  );
}

export function createProjectOperationsDemo(): ProjectOperationsDemo {
  const registryInput = createRegistryInput();
  const registryDecision = evaluateWorkspaceProjectContexts(registryInput);
  const schedulerInput: ProjectOperationsSchedulerInput = {
    registry: registryInput,
    policy: createSchedulerPolicy(),
    queuedRequests: [
      request(
        "request-pac-workflow",
        "private-ai-cloud",
        "pac-dev-workflow",
        "model-codex-openai",
        "P0",
        1,
      ),
      request(
        "request-pac-agent",
        "private-ai-cloud",
        "pac-qa-agent",
        "model-qwen-reviewer",
        "P1",
        2,
      ),
      request(
        "request-sa-workflow",
        "smart-algorithms",
        "sa-marketing-workflow",
        "model-qwen-reviewer",
        "P2",
        3,
      ),
    ],
    runningRuns: [
      runningRun(
        "run-pac-qa",
        "request-pac-running",
        "private-ai-cloud",
        "pac-qa-agent",
        "model-qwen-reviewer",
        "P1",
      ),
    ],
    lastDispatchedProjectId: "smart-algorithms",
  };
  const schedulerDecision = buildMultiProjectRunDispatchPlan(schedulerInput);
  const sources: ProjectOperationsProjectionSources = {
    workspaceId: registryInput.workspaceId,
    registryInput,
    registryDecision,
    schedulerInput,
    schedulerDecision,
  };
  return {
    ...sources,
    bindingResolutions: resolveAllBindings(registryInput),
    projectionSnapshot: createProjectionSnapshot(sources),
  };
}

function unavailableReason(
  source: ProjectOperationsUnavailableReason["source"],
  reason: ProjectContextReason | MultiProjectRunSchedulerReason,
): ProjectOperationsUnavailableReason {
  return {
    source,
    code: reason.code,
    path: reason.path,
    message: reason.message,
    projectId: reason.projectId,
    departmentId: reason.departmentId,
    bindingId: reason.bindingId,
  };
}

function unavailable(
  workspaceId: string,
  scope: ProjectOperationsScope,
  title: string,
  reasons: readonly ProjectOperationsUnavailableReason[],
): UnavailableProjectOperationsView {
  return {
    available: false,
    scope: { ...scope },
    workspaceId,
    title,
    reasons: reasons.map((reason) => ({ ...reason })),
  };
}

function projectionReason(
  message: string,
  projectId: string | null = null,
  path = "projectionSnapshot.integrity",
): ProjectOperationsUnavailableReason {
  return {
    source: "projection",
    code: "projection_inconsistent",
    path,
    message,
    projectId,
    departmentId: null,
    bindingId: null,
  };
}

function ownerBlockedMessage(code: MultiProjectRunSchedulerReason["code"]): string {
  const messages: Partial<Record<MultiProjectRunSchedulerReason["code"], string>> = {
    workspace_concurrency_exceeded: "Общий лимит одновременных запусков занят.",
    project_concurrency_exceeded: "Лимит одновременной работы проекта занят.",
    department_concurrency_exceeded: "Лимит одновременной работы отдела занят.",
    binding_concurrency_exceeded: "Этот Agent или Workflow уже использует доступный лимит.",
    scheduler_paused: "Scheduler Workspace приостановлен.",
    scheduler_disabled: "Scheduler Workspace отключён.",
    project_paused: "Scheduler проекта приостановлен.",
    project_disabled: "Scheduler проекта отключён.",
    priority_not_allowed: "Приоритет заявки не разрешён политикой проекта.",
  };
  return messages[code] ?? "Заявка сохранена в очереди согласно фактическому решению Scheduler.";
}

function blockedReasons(
  blocked: MultiProjectRunBlockedRequest,
): readonly ProjectOperationsBlockedReason[] {
  return blocked.reasons.map((reason) => ({
    code: reason.code,
    path: reason.path,
    message: reason.message,
    ownerMessage: ownerBlockedMessage(reason.code),
    projectId: reason.projectId,
    departmentId: reason.departmentId,
    bindingId: reason.bindingId,
  }));
}

const integrityLimits = Object.freeze({
  maxDepth: 32,
  maxEntries: 100_000,
  maxCharacters: 2_000_000,
  maxStringLength: 8_192,
});

function boundedCanonicalDigest(input: unknown): string | null {
  let entries = 0;
  let characters = 0;
  let hashOne = 0x811c9dc5;
  let hashTwo = 0x9e3779b9;

  function feed(value: string): void {
    if (value.length > integrityLimits.maxStringLength) {
      throw new Error("Integrity string limit exceeded.");
    }
    characters += value.length;
    if (characters > integrityLimits.maxCharacters) {
      throw new Error("Integrity character limit exceeded.");
    }
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      hashOne = Math.imul(hashOne ^ code, 0x01000193) >>> 0;
      hashTwo = Math.imul(hashTwo ^ code, 0x85ebca6b) >>> 0;
    }
  }

  function visit(value: unknown, depth: number): void {
    entries += 1;
    if (entries > integrityLimits.maxEntries || depth > integrityLimits.maxDepth) {
      throw new Error("Integrity structure limit exceeded.");
    }
    if (value === null) {
      feed("null;");
      return;
    }
    if (typeof value === "string") {
      feed(`string:${value.length}:`);
      feed(value);
      feed(";");
      return;
    }
    if (typeof value === "number") {
      feed(`number:${Object.is(value, -0) ? "-0" : String(value)};`);
      return;
    }
    if (typeof value === "boolean") {
      feed(value ? "boolean:1;" : "boolean:0;");
      return;
    }
    if (Array.isArray(value)) {
      feed(`array:${value.length}[`);
      for (const item of value) visit(item, depth + 1);
      feed("];");
      return;
    }
    if (typeof value !== "object") {
      throw new Error("Unsupported integrity value.");
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    feed(`object:${keys.length}{`);
    for (const key of keys) {
      feed(`key:${key.length}:`);
      feed(key);
      feed("=");
      visit(record[key], depth + 1);
    }
    feed("};");
  }

  try {
    visit(input, 0);
    return `${hashOne.toString(16).padStart(8, "0")}${hashTwo
      .toString(16)
      .padStart(8, "0")}`;
  } catch {
    return null;
  }
}

function createIntegritySeal(
  sources: ProjectOperationsProjectionSources,
): ProjectOperationsIntegritySeal | null {
  const values = {
    workspaceId: boundedCanonicalDigest(sources.workspaceId),
    registryInput: boundedCanonicalDigest(sources.registryInput),
    schedulerRegistry: boundedCanonicalDigest(sources.schedulerInput.registry),
    registryDecision: boundedCanonicalDigest(sources.registryDecision),
    schedulerPolicy: boundedCanonicalDigest(sources.schedulerInput.policy),
    queuedRequests: boundedCanonicalDigest(sources.schedulerInput.queuedRequests),
    runningRuns: boundedCanonicalDigest(sources.schedulerInput.runningRuns),
    cursor: boundedCanonicalDigest(sources.schedulerInput.lastDispatchedProjectId),
    schedulerDecision: boundedCanonicalDigest(sources.schedulerDecision),
  };
  if (Object.values(values).some((value) => value === null)) return null;
  return values as ProjectOperationsIntegritySeal;
}

function integrityMatches(
  left: ProjectOperationsIntegritySeal,
  right: ProjectOperationsIntegritySeal,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.registryInput === right.registryInput &&
    left.schedulerRegistry === right.schedulerRegistry &&
    left.registryDecision === right.registryDecision &&
    left.schedulerPolicy === right.schedulerPolicy &&
    left.queuedRequests === right.queuedRequests &&
    left.runningRuns === right.runningRuns &&
    left.cursor === right.cursor &&
    left.schedulerDecision === right.schedulerDecision
  );
}

function freezeSnapshot<Value>(value: Value, depth = 0): Value {
  if (depth > 16 || value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeSnapshot(child, depth + 1);
  }
  return Object.freeze(value);
}

function requestsMatch(left: ProjectRunRequest, right: ProjectRunRequest): boolean {
  return (
    left.id === right.id &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.bindingId === right.bindingId &&
    left.modelProfileId === right.modelProfileId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.priority === right.priority &&
    left.sequence === right.sequence
  );
}

function unavailableSnapshot(
  workspaceId: string,
  integrity: ProjectOperationsIntegritySeal | null,
  title: string,
  reasons: readonly ProjectOperationsUnavailableReason[],
): UnavailableProjectOperationsProjectionSnapshot {
  const payload = {
    state: "unavailable" as const,
    workspaceId,
    title,
    reasons: reasons.map((reason) => ({ ...reason })),
  };
  return freezeSnapshot({
    ...payload,
    integrity,
    payloadDigest: boundedCanonicalDigest(payload) ?? "invalid-payload",
  });
}

function snapshotPayloadDigest(
  snapshot: ProjectOperationsProjectionSnapshot,
): string | null {
  if (snapshot.state === "unavailable") {
    return boundedCanonicalDigest({
      state: snapshot.state,
      workspaceId: snapshot.workspaceId,
      title: snapshot.title,
      reasons: snapshot.reasons,
    });
  }
  return boundedCanonicalDigest({
    state: snapshot.state,
    workspaceId: snapshot.workspaceId,
    schedulerStatus: snapshot.schedulerStatus,
    schedulerVerdict: snapshot.schedulerVerdict,
    lastRoundRobinProjectId: snapshot.lastRoundRobinProjectId,
    nextRoundRobinProjectId: snapshot.nextRoundRobinProjectId,
    projects: snapshot.projects,
    departments: snapshot.departments,
    agents: snapshot.agents,
    workflows: snapshot.workflows,
    queued: snapshot.queued,
    running: snapshot.running,
    dispatches: snapshot.dispatches,
    blocked: snapshot.blocked,
  });
}

function createProjectOperationsRunBase(
  projectNames: ReadonlyMap<string, string>,
  departmentNames: ReadonlyMap<string, string>,
  bindingDetails: ReadonlyMap<string, ProjectSubjectBinding>,
  projectId: string,
  bindingId: string,
  modelProfileId: string,
  priority: ProjectRunPriority,
): ProjectOperationsRunBase | null {
  const candidate = bindingDetails.get(`${projectId}\u0000${bindingId}`);
  if (!candidate) return null;
  return {
    projectId,
    projectName: projectNames.get(projectId) ?? projectId,
    departmentId: candidate.departmentId,
    departmentName:
      departmentNames.get(`${projectId}\u0000${candidate.departmentId}`) ??
      candidate.departmentId,
    bindingId,
    bindingKind: candidate.kind,
    subjectId: candidate.subjectId,
    modelProfileId,
    priority,
  };
}

function createProjectOperationsProjectionSnapshot(
  sources: ProjectOperationsProjectionSources,
  integrity: ProjectOperationsIntegritySeal,
): ProjectOperationsProjectionSnapshot {
  if (
    sources.registryDecision.verdict === "deny" ||
    sources.registryDecision.normalizedRegistry === null
  ) {
    return unavailableSnapshot(
      sources.workspaceId,
      integrity,
      "Workspace Registry недоступен",
      sources.registryDecision.reasons.map((reason) =>
        unavailableReason("registry", reason),
      ),
    );
  }
  if (
    sources.schedulerDecision.verdict === "deny" ||
    sources.schedulerDecision.plan === null
  ) {
    return unavailableSnapshot(
      sources.workspaceId,
      integrity,
      "Scheduler недоступен",
      sources.schedulerDecision.reasons.length > 0
        ? sources.schedulerDecision.reasons.map((reason) =>
            unavailableReason("scheduler", reason),
          )
        : [projectionReason("Scheduler did not provide a complete dispatch plan.")],
    );
  }

  const registry = sources.registryDecision.normalizedRegistry;
  const plan = sources.schedulerDecision.plan;
  const queuedById = new Map(
    sources.schedulerInput.queuedRequests.map((candidate) => [candidate.id, candidate]),
  );
  const dispatchByRequestId = new Map(
    plan.dispatches.map((dispatch) => [dispatch.request.id, dispatch]),
  );
  const blockedByRequestId = new Map(
    plan.blockedRequests.map((blocked) => [blocked.requestId, blocked]),
  );
  if (
    queuedById.size !== sources.schedulerInput.queuedRequests.length ||
    dispatchByRequestId.size !== plan.dispatches.length ||
    blockedByRequestId.size !== plan.blockedRequests.length ||
    plan.retainedRequestIds.length !== plan.blockedRequests.length ||
    plan.retainedRequestIds.some(
      (requestId, index) => requestId !== plan.blockedRequests[index]?.requestId,
    )
  ) {
    return unavailableSnapshot(sources.workspaceId, integrity, "Проекция Scheduler недоступна", [
      projectionReason("Scheduler plan identifiers are not canonical.", null, "schedulerDecision.plan"),
    ]);
  }
  for (const candidate of sources.schedulerInput.queuedRequests) {
    const dispatch = dispatchByRequestId.get(candidate.id);
    const blocked = blockedByRequestId.get(candidate.id);
    if (
      (dispatch === undefined) === (blocked === undefined) ||
      (dispatch !== undefined && !requestsMatch(candidate, dispatch.request)) ||
      (blocked !== undefined &&
        (blocked.projectId !== candidate.projectId ||
          blocked.bindingId !== candidate.bindingId))
    ) {
      return unavailableSnapshot(sources.workspaceId, integrity, "Проекция Scheduler недоступна", [
        projectionReason(
          `Queued request ${candidate.id} does not match its factual scheduler result.`,
          candidate.projectId,
          "schedulerDecision.plan",
        ),
      ]);
    }
  }
  if (
    plan.dispatches.some((dispatch) => !queuedById.has(dispatch.request.id)) ||
    plan.blockedRequests.some((blocked) => !queuedById.has(blocked.requestId))
  ) {
    return unavailableSnapshot(sources.workspaceId, integrity, "Проекция Scheduler недоступна", [
      projectionReason("Scheduler plan contains a request outside the canonical queue.", null, "schedulerDecision.plan"),
    ]);
  }

  const projectNames = new Map(
    registry.projects.map((project) => [project.projectId, project.projectManifest.name]),
  );
  const departmentNames = new Map(
    registry.projects.flatMap((project) =>
      project.departments.map((candidate) => [
        `${project.projectId}\u0000${candidate.manifest.id}`,
        candidate.manifest.name,
      ] as const),
    ),
  );
  const bindingDetails = new Map(
    registry.projects.flatMap((project) =>
      project.bindings.map((candidate) => [
        `${project.projectId}\u0000${candidate.id}`,
        candidate,
      ] as const),
    ),
  );

  const queued: ProjectOperationsQueueRow[] = [];
  for (const candidate of sources.schedulerInput.queuedRequests) {
    const base = createProjectOperationsRunBase(
      projectNames,
      departmentNames,
      bindingDetails,
      candidate.projectId,
      candidate.bindingId,
      candidate.modelProfileId,
      candidate.priority,
    );
    if (!base) {
      return unavailableSnapshot(sources.workspaceId, integrity, "Проекция Scheduler недоступна", [
        projectionReason(`Binding for queued request ${candidate.id} is unavailable.`, candidate.projectId),
      ]);
    }
    queued.push({
      ...base,
      requestId: candidate.id,
      factualStatus: dispatchByRequestId.has(candidate.id) ? "planned" : "blocked",
    });
  }

  const running: ProjectOperationsRunningRow[] = [];
  for (const candidate of sources.schedulerInput.runningRuns) {
    const base = createProjectOperationsRunBase(
      projectNames,
      departmentNames,
      bindingDetails,
      candidate.projectId,
      candidate.bindingId,
      candidate.modelProfileId,
      candidate.priority,
    );
    if (!base) {
      return unavailableSnapshot(sources.workspaceId, integrity, "Проекция Scheduler недоступна", [
        projectionReason(`Binding for running run ${candidate.runId} is unavailable.`, candidate.projectId),
      ]);
    }
    running.push({
      ...base,
      runId: candidate.runId,
      requestId: candidate.requestId,
      factualStatus: "running",
    });
  }

  const dispatches: ProjectOperationsDispatchRow[] = plan.dispatches.map((candidate) => {
    const base = createProjectOperationsRunBase(
      projectNames,
      departmentNames,
      bindingDetails,
      candidate.request.projectId,
      candidate.request.bindingId,
      candidate.request.modelProfileId,
      candidate.request.priority,
    );
    if (!base) throw new Error("Validated dispatch binding is unavailable.");
    return { ...base, requestId: candidate.request.id, factualStatus: "planned" };
  });
  const blocked: ProjectOperationsBlockedRow[] = plan.blockedRequests.map((candidate) => {
    const requestInput = queuedById.get(candidate.requestId);
    if (!requestInput) throw new Error("Validated blocked request is unavailable.");
    const base = createProjectOperationsRunBase(
      projectNames,
      departmentNames,
      bindingDetails,
      requestInput.projectId,
      requestInput.bindingId,
      requestInput.modelProfileId,
      requestInput.priority,
    );
    if (!base) throw new Error("Validated blocked binding is unavailable.");
    return {
      ...base,
      requestId: candidate.requestId,
      factualStatus: "blocked",
      reasons: blockedReasons(candidate),
    };
  });

  const agents: ProjectOperationsBindingRow[] = [];
  const workflows: ProjectOperationsBindingRow[] = [];
  for (const project of registry.projects) {
    for (const candidate of project.bindings) {
      const row: ProjectOperationsBindingRow = {
        projectId: project.projectId,
        projectName: project.projectManifest.name,
        departmentId: candidate.departmentId,
        departmentName:
          departmentNames.get(`${project.projectId}\u0000${candidate.departmentId}`) ??
          candidate.departmentId,
        bindingId: candidate.id,
        subjectId: candidate.subjectId,
        status: candidate.status,
        modelProfileIds: [...candidate.effectiveModelProfileIds],
        effectiveMaxConcurrentRuns: candidate.effectiveBudget.maxConcurrentRuns,
      };
      (candidate.kind === "agent" ? agents : workflows).push(row);
    }
  }
  const departments: ProjectOperationsDepartmentRow[] = registry.projects.flatMap(
    (project) =>
      project.departments.map((candidate) => ({
        projectId: project.projectId,
        projectName: project.projectManifest.name,
        departmentId: candidate.manifest.id,
        name: candidate.manifest.name,
        code: candidate.manifest.code,
        status: candidate.manifest.status,
        operatingMode: candidate.manifest.operatingMode,
        agentsCount: agents.filter(
          (agent) =>
            agent.projectId === project.projectId &&
            agent.departmentId === candidate.manifest.id,
        ).length,
        workflowsCount: workflows.filter(
          (workflow) =>
            workflow.projectId === project.projectId &&
            workflow.departmentId === candidate.manifest.id,
        ).length,
        effectiveMaxConcurrentRuns:
          candidate.normalizedDepartment.effectiveBudget.maxConcurrentRuns,
      })),
  );
  const payload = {
    state: "available" as const,
    workspaceId: sources.workspaceId,
    schedulerStatus: sources.schedulerInput.policy.status,
    schedulerVerdict: sources.schedulerDecision.verdict,
    lastRoundRobinProjectId: sources.schedulerInput.lastDispatchedProjectId,
    nextRoundRobinProjectId: plan.nextLastDispatchedProjectId,
    projects: registry.projects.map((project) => ({
      projectId: project.projectId,
      name: project.projectManifest.name,
      status: project.projectManifest.status,
    })),
    departments,
    agents,
    workflows,
    queued,
    running,
    dispatches,
    blocked,
  };
  return freezeSnapshot({
    ...payload,
    integrity,
    payloadDigest: boundedCanonicalDigest(payload) ?? "invalid-payload",
  });
}

function createProjectionSnapshot(
  sources: ProjectOperationsProjectionSources,
): ProjectOperationsProjectionSnapshot {
  const integrity = createIntegritySeal(sources);
  if (integrity === null) {
    return unavailableSnapshot(sources.workspaceId, null, "Проекция Scheduler недоступна", [
      projectionReason("Canonical projection integrity could not be computed."),
    ]);
  }
  try {
    return createProjectOperationsProjectionSnapshot(sources, integrity);
  } catch {
    return unavailableSnapshot(sources.workspaceId, integrity, "Проекция Scheduler недоступна", [
      projectionReason("Canonical projection snapshot could not be created."),
    ]);
  }
}

export function createProjectOperationsView(
  demo: ProjectOperationsDemo,
  scope: ProjectOperationsScope,
): ProjectOperationsView {
  const snapshot = demo.projectionSnapshot;
  const currentIntegrity = createIntegritySeal({
    workspaceId: demo.workspaceId,
    registryInput: demo.registryInput,
    registryDecision: demo.registryDecision,
    schedulerInput: demo.schedulerInput,
    schedulerDecision: demo.schedulerDecision,
  });
  const currentPayloadDigest = snapshotPayloadDigest(snapshot);
  if (
    snapshot.integrity === null ||
    currentIntegrity === null ||
    !integrityMatches(snapshot.integrity, currentIntegrity) ||
    currentPayloadDigest === null ||
    currentPayloadDigest !== snapshot.payloadDigest
  ) {
    return unavailable(snapshot.workspaceId, scope, "Проекция Scheduler недоступна", [
      projectionReason("Demo sources no longer match the canonical projection snapshot."),
    ]);
  }
  if (snapshot.state === "unavailable") {
    return unavailable(
      snapshot.workspaceId,
      scope,
      snapshot.title,
      snapshot.reasons,
    );
  }
  let visibleProjectIds: ReadonlySet<string>;
  if (scope.kind === "workspace") {
    visibleProjectIds = new Set(snapshot.projects.map((project) => project.projectId));
  } else if (
    scope.kind === "project" &&
    snapshot.projects.some((project) => project.projectId === scope.projectId)
  ) {
    visibleProjectIds = new Set([scope.projectId]);
  } else {
    const projectId = scope.kind === "project" ? scope.projectId : null;
    return unavailable(snapshot.workspaceId, scope, "Контекст проекта недоступен", [
      {
        source: "scope",
        code: "project_context_unavailable",
        path: "scope.projectId",
        message: projectId
          ? `Project ${projectId} is not present in the evaluated Workspace Registry.`
          : "Project scope is invalid.",
        projectId,
        departmentId: null,
        bindingId: null,
      },
    ]);
  }

  const agents = snapshot.agents;
  const workflows = snapshot.workflows;
  const queued = snapshot.queued;
  const running = snapshot.running;
  const dispatches = snapshot.dispatches;
  const blocked = snapshot.blocked;
  const departments = snapshot.departments;
  const visible = <Row extends { projectId: string }>(rows: readonly Row[]) =>
    rows
      .filter((row) => visibleProjectIds.has(row.projectId))
      .map((row) => ({ ...row }));
  const visibleAgents = visible(agents).map((row) => ({
    ...row,
    modelProfileIds: [...row.modelProfileIds],
  }));
  const visibleWorkflows = visible(workflows).map((row) => ({
    ...row,
    modelProfileIds: [...row.modelProfileIds],
  }));
  const visibleQueued = visible(queued);
  const visibleRunning = visible(running);
  const visibleDispatches = visible(dispatches);
  const visibleBlocked = visible(blocked).map((row) => ({
    ...row,
    reasons: row.reasons.map((reason) => ({ ...reason })),
  }));
  const visibleDepartments = visible(departments);
  const visibleSnapshotProjects = snapshot.projects.filter((project) =>
    visibleProjectIds.has(project.projectId),
  );
  const projects: ProjectOperationsProjectRow[] = visibleSnapshotProjects.map(
    (project) => ({
      projectId: project.projectId,
      name: project.name,
      status: project.status,
      departmentsCount: visibleDepartments.filter(
        (departmentRow) => departmentRow.projectId === project.projectId,
      ).length,
      agentsCount: visibleAgents.filter(
        (agent) => agent.projectId === project.projectId,
      ).length,
      workflowsCount: visibleWorkflows.filter(
        (workflow) => workflow.projectId === project.projectId,
      ).length,
      queuedCount: visibleQueued.filter(
        (queueRow) => queueRow.projectId === project.projectId,
      ).length,
      runningCount: visibleRunning.filter(
        (runningRow) => runningRow.projectId === project.projectId,
      ).length,
      plannedCount: visibleDispatches.filter(
        (dispatchRow) => dispatchRow.projectId === project.projectId,
      ).length,
      blockedCount: visibleBlocked.filter(
        (blockedRow) => blockedRow.projectId === project.projectId,
      ).length,
    }),
  );
  return {
    available: true,
    scope: { ...scope },
    workspaceId: snapshot.workspaceId,
    totalsLabel: scope.kind === "workspace" ? "Workspace totals" : "Project totals",
    summary: {
      projects: projects.length,
      queued: visibleQueued.length,
      running: visibleRunning.length,
      planned: visibleDispatches.length,
      blocked: visibleBlocked.length,
      schedulerStatus: snapshot.schedulerStatus,
      schedulerVerdict: snapshot.schedulerVerdict,
      lastRoundRobinProjectId: snapshot.lastRoundRobinProjectId,
      nextRoundRobinProjectId: snapshot.nextRoundRobinProjectId,
    },
    projects,
    departments: visibleDepartments,
    agents: visibleAgents,
    workflows: visibleWorkflows,
    queued: visibleQueued,
    running: visibleRunning,
    dispatches: visibleDispatches,
    blocked: visibleBlocked,
  };
}
