import type {
  ProjectBudgetCeiling,
  ProjectChildScopeDecision,
  ProjectChildScopeReason,
  ProjectManifest,
  ProjectResource,
  ProjectResourceCapability,
  ProjectResourceKind,
} from "./contracts/project-manifest";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { evaluateProjectChildScope } from "./contracts/project-manifest.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { validateAndNormalizeProjectManifest } from "./contracts/project-manifest.ts";

export const projectControlCenterModelProfiles = [
  {
    id: "model-codex-openai",
    name: "Codex",
    provider: "OpenAI",
    role: "Основной разработчик",
  },
  {
    id: "model-claude-code-anthropic",
    name: "Claude Code",
    provider: "Anthropic",
    role: "Альтернативный разработчик или reviewer",
  },
  {
    id: "model-qwen-reviewer",
    name: "Qwen",
    provider: "UI mapping",
    role: "Researcher / reviewer",
  },
  {
    id: "model-deepseek-research",
    name: "DeepSeek",
    provider: "UI mapping",
    role: "Альтернативная coding / research модель",
  },
] as const;

export const projectControlCenterKnowledgeCollections = [
  {
    id: "kb-product-blueprint",
    name: "Product Blueprint",
    description: "Цели продукта, roadmap и границы текущего прототипа.",
  },
  {
    id: "kb-security-policy",
    name: "Security & Approval Policy",
    description: "Правила безопасности, approvals и запрещённые действия.",
  },
  {
    id: "kb-support-playbook",
    name: "Support Playbook",
    description: "Сценарии поддержки и правила подготовки ответов.",
  },
  {
    id: "kb-marketing-guide",
    name: "Marketing Guide",
    description: "Тон коммуникации и контентные ограничения.",
  },
  {
    id: "kb-customer-context",
    name: "Customer Context",
    description: "Несекретный контекст клиентов и продуктовых ожиданий.",
  },
] as const;

export const projectControlCenterDepartmentCatalog = [
  { id: "support", name: "Support" },
  { id: "marketing", name: "Marketing & Growth" },
  { id: "community", name: "Community Engagement" },
  { id: "sales", name: "Sales" },
  { id: "customer-success", name: "Customer Success" },
  { id: "product", name: "Product" },
  { id: "development", name: "Development" },
  { id: "qa-code-review", name: "QA / Code Review" },
  { id: "executive-analytics", name: "Executive Analytics" },
  { id: "legal-documents", name: "Legal / Documents" },
] as const;

export type ProjectControlCenterDemoProject = Readonly<{
  manifest: ProjectManifest;
  accent: "cyan" | "violet" | "slate";
  ownerSummary: string;
}>;

export type ProjectControlCenterEvaluatedScope = Readonly<{
  id: "development" | "marketing" | "support";
  name: string;
  description: string;
  requestedResourceIds: readonly string[];
  requestedModelProfileIds: readonly string[];
  requestedKnowledgeCollectionIds: readonly string[];
  requestedBudget: ProjectBudgetCeiling;
  decision: ProjectChildScopeDecision;
}>;

export type ProjectControlCenterDeniedScenario = Readonly<{
  id: "resource-expansion" | "model-expansion" | "capability-expansion" | "budget-expansion";
  title: string;
  ownerExplanation: string;
  decision: ProjectChildScopeDecision;
}>;

export type ProjectControlCenterDepartmentPreview = Readonly<{
  id: string;
  name: string;
  configurationStatus: "Проверено контрактом" | "Предпросмотр";
  resourceIds: readonly string[];
  modelProfileIds: readonly string[];
  knowledgeCollectionIds: readonly string[];
  budgetSummary: string;
  policySummary: string;
  decision: ProjectChildScopeDecision | null;
}>;

export type ProjectControlCenterDepartmentDemo = Readonly<{
  evaluatedScopes: readonly ProjectControlCenterEvaluatedScope[];
  deniedScenarios: readonly ProjectControlCenterDeniedScenario[];
  departmentPreviews: readonly ProjectControlCenterDepartmentPreview[];
}>;

export type ProjectControlCenterDemoState = Readonly<{
  projects: readonly ProjectControlCenterDemoProject[];
  modelProfiles: readonly (typeof projectControlCenterModelProfiles)[number][];
  knowledgeCollections: readonly (typeof projectControlCenterKnowledgeCollections)[number][];
  departments: readonly (typeof projectControlCenterDepartmentCatalog)[number][];
}>;

function createResource(
  id: string,
  kind: ProjectResourceKind,
  label: string,
  resourceRef: string,
  capabilities: readonly ProjectResourceCapability[],
  options: Readonly<{
    status?: "configured" | "connected";
    connectionId?: string | null;
  }> = {},
) {
  return {
    id,
    kind,
    label,
    status: options.status ?? "configured",
    connectionId: options.connectionId ?? null,
    resourceRef,
    capabilities: [...capabilities],
  };
}

function createPrivateAiCloudManifestInput() {
  return {
    id: "private-ai-cloud",
    workspaceId: "smart-algorithms-demo",
    version: 1,
    name: "Private AI Cloud",
    slug: "private-ai-cloud",
    summary:
      "Owner-controlled центр для безопасной настройки AI-отделов, workflows и project-level ограничений.",
    kind: "internal_product",
    status: "active",
    defaultLocale: "ru-RU",
    timeZone: "Europe/Moscow",
    dataRegion: "eu",
    dataClassification: "confidential",
    goals: [
      "Дать владельцу единый центр управления AI-проектом",
      "Сохранять approval-first принцип на всех дочерних уровнях",
      "Сделать границы ресурсов и бюджетов понятными до запуска процессов",
    ],
    nonGoals: [
      "Автоматический deploy или публикация",
      "Хранение credentials внутри ProjectManifest",
    ],
    tags: ["owner-control", "private-ai", "frontend-prototype"],
    resources: [
      createResource(
        "workspace",
        "local_workspace",
        "Локальная папка проекта",
        "/Users/demo/Private AI Cloud",
        ["read_metadata", "read_content", "propose_change"],
      ),
      createResource(
        "repository",
        "code_repository",
        "GitHub repository",
        "smart-algorithms/private-ai-cloud",
        ["read_metadata", "read_content", "propose_change"],
        { status: "connected", connectionId: "github-demo-connection" },
      ),
      createResource(
        "telegram",
        "telegram_channel",
        "Telegram channel",
        "@private_ai_cloud_demo",
        ["read_metadata", "read_content", "create_draft", "request_external_action"],
        { connectionId: "telegram-demo-connection" },
      ),
      createResource(
        "instagram",
        "instagram_account",
        "Instagram account",
        "@private_ai_cloud",
        ["read_metadata", "create_draft", "request_external_action"],
      ),
      createResource(
        "website",
        "website",
        "Product website",
        "private-ai-cloud.example",
        ["read_metadata", "read_content", "create_draft", "propose_change"],
      ),
      createResource(
        "support-inbox",
        "support_inbox",
        "Support inbox",
        "support-private-ai-cloud",
        ["read_metadata", "read_content", "create_draft", "request_external_action"],
      ),
      createResource(
        "crm",
        "crm",
        "CRM workspace",
        "crm-private-ai-cloud",
        ["read_metadata", "read_content", "create_draft"],
      ),
      createResource(
        "analytics",
        "analytics",
        "Product analytics",
        "analytics-private-ai-cloud",
        ["read_metadata", "read_content"],
      ),
      createResource(
        "file-storage",
        "file_storage",
        "Project file storage",
        "storage-private-ai-cloud",
        ["read_metadata", "read_content", "create_draft"],
      ),
    ],
    allowedModelProfileIds: [
      "model-codex-openai",
      "model-claude-code-anthropic",
      "model-qwen-reviewer",
      "model-deepseek-research",
    ],
    knowledgeCollectionIds: [
      "kb-product-blueprint",
      "kb-security-policy",
      "kb-support-playbook",
      "kb-marketing-guide",
      "kb-customer-context",
    ],
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode: "redacted_only",
      requiredApprovalActions: ["owner_project_configuration_review"],
      forbiddenActions: ["Публикация без явного решения владельца запрещена"],
    },
    budget: {
      maxConcurrentRuns: 4,
      maxAttemptsPerRun: 3,
      maxRunMinutes: 120,
      dailyTokenBudget: 2_000_000,
      monthlyCostBudgetUsdCents: 500_000,
    },
  };
}

function createSmartAlgorithmsManifestInput() {
  return {
    id: "smart-algorithms",
    workspaceId: "smart-algorithms-demo",
    version: 1,
    name: "Smart Algorithms",
    slug: "smart-algorithms",
    summary:
      "Клиентский AI-проект с ограниченными каналами, знаниями и обязательным Owner approval.",
    kind: "client_project",
    status: "active",
    defaultLocale: "ru-RU",
    timeZone: "Europe/Moscow",
    dataRegion: "eu",
    dataClassification: "internal",
    goals: [
      "Подготовка безопасных drafts для поддержки и маркетинга",
      "Контролируемая аналитика без автоматических внешних действий",
    ],
    nonGoals: ["Автономная отправка сообщений", "Прямой доступ к production credentials"],
    tags: ["client-project", "approval-first"],
    resources: [
      createResource(
        "sa-workspace",
        "local_workspace",
        "Локальная папка Smart Algorithms",
        "/Users/demo/Smart Algorithms",
        ["read_metadata", "read_content", "propose_change"],
      ),
      createResource(
        "sa-repository",
        "code_repository",
        "Smart Algorithms repository",
        "smart-algorithms/platform",
        ["read_metadata", "read_content", "propose_change"],
      ),
      createResource(
        "sa-telegram",
        "telegram_channel",
        "Smart Algorithms Telegram",
        "@smart_algorithms_demo",
        ["read_metadata", "read_content", "create_draft", "request_external_action"],
      ),
      createResource(
        "sa-instagram",
        "instagram_account",
        "Smart Algorithms Instagram",
        "@smart_algorithms",
        ["read_metadata", "create_draft", "request_external_action"],
      ),
      createResource(
        "sa-website",
        "website",
        "Smart Algorithms website",
        "smart-algorithms.example",
        ["read_metadata", "read_content", "create_draft", "propose_change"],
      ),
      createResource(
        "sa-support",
        "support_inbox",
        "Smart Algorithms support",
        "support-smart-algorithms",
        ["read_metadata", "read_content", "create_draft", "request_external_action"],
      ),
      createResource(
        "sa-crm",
        "crm",
        "Smart Algorithms CRM",
        "crm-smart-algorithms",
        ["read_metadata", "read_content", "create_draft"],
      ),
      createResource(
        "sa-analytics",
        "analytics",
        "Smart Algorithms analytics",
        "analytics-smart-algorithms",
        ["read_metadata", "read_content"],
      ),
      createResource(
        "sa-files",
        "file_storage",
        "Smart Algorithms files",
        "storage-smart-algorithms",
        ["read_metadata", "read_content", "create_draft"],
      ),
    ],
    allowedModelProfileIds: [
      "model-codex-openai",
      "model-qwen-reviewer",
      "model-deepseek-research",
    ],
    knowledgeCollectionIds: [
      "kb-product-blueprint",
      "kb-support-playbook",
      "kb-marketing-guide",
      "kb-customer-context",
    ],
    policy: {
      externalActionMode: "approval_required",
      dataEgressMode: "approved_minimum",
      requiredApprovalActions: ["client_owner_review"],
      forbiddenActions: ["Контакт с клиентом без Owner approval запрещён"],
    },
    budget: {
      maxConcurrentRuns: 3,
      maxAttemptsPerRun: 2,
      maxRunMinutes: 90,
      dailyTokenBudget: 1_000_000,
      monthlyCostBudgetUsdCents: 250_000,
    },
  };
}

function requireValidDemoManifest(input: unknown): ProjectManifest {
  const result = validateAndNormalizeProjectManifest(input);
  if (!result.ok) {
    throw new Error(`Invalid Project Control Center demo manifest: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function cloneDemoProject(project: ProjectControlCenterDemoProject): ProjectControlCenterDemoProject {
  return {
    manifest: requireValidDemoManifest(project.manifest),
    accent: project.accent,
    ownerSummary: project.ownerSummary,
  };
}

export function createProjectControlCenterDemo(): ProjectControlCenterDemoState {
  const projects: ProjectControlCenterDemoProject[] = [
    {
      manifest: requireValidDemoManifest(createPrivateAiCloudManifestInput()),
      accent: "cyan",
      ownerSummary: "Основной продуктовый проект и источник project-level ограничений.",
    },
    {
      manifest: requireValidDemoManifest(createSmartAlgorithmsManifestInput()),
      accent: "violet",
      ownerSummary: "Клиентский проект с отдельными ресурсами, знаниями и бюджетом.",
    },
  ];
  return {
    projects: projects.map(cloneDemoProject),
    modelProfiles: projectControlCenterModelProfiles.map((profile) => ({ ...profile })),
    knowledgeCollections: projectControlCenterKnowledgeCollections.map((collection) => ({
      ...collection,
    })),
    departments: projectControlCenterDepartmentCatalog.map((department) => ({ ...department })),
  };
}

export function createProjectControlCenterDraftProject(
  requestedSequence = 1,
): ProjectControlCenterDemoProject {
  const sequence =
    Number.isSafeInteger(requestedSequence) && requestedSequence > 0 && requestedSequence <= 9_999
      ? requestedSequence
      : 1;
  const manifest = requireValidDemoManifest({
    id: `demo-project-${sequence}`,
    workspaceId: "smart-algorithms-demo",
    version: 1,
    name: `Новый проект ${sequence}`,
    slug: `new-project-${sequence}`,
    summary: "Локальный draft. Заполните настройки и проверьте конфигурацию.",
    kind: "experiment",
    status: "draft",
    defaultLocale: "ru-RU",
    timeZone: "Europe/Moscow",
    dataRegion: "eu",
    dataClassification: "internal",
    goals: [],
    nonGoals: [],
    tags: ["local-draft"],
    resources: [],
    allowedModelProfileIds: [],
    knowledgeCollectionIds: [],
    policy: {
      externalActionMode: "locked",
      dataEgressMode: "forbidden",
      requiredApprovalActions: [],
      forbiddenActions: [],
    },
    budget: {
      maxConcurrentRuns: 1,
      maxAttemptsPerRun: 1,
      maxRunMinutes: 30,
      dailyTokenBudget: 0,
      monthlyCostBudgetUsdCents: 0,
    },
  });
  return {
    manifest,
    accent: "slate",
    ownerSummary: "Новый локальный draft без persistence и внешних действий.",
  };
}

function resourcesByKind(
  manifest: ProjectManifest | null,
  kinds: readonly ProjectResourceKind[],
): readonly ProjectResource[] {
  if (manifest === null) {
    return [];
  }
  const kindSet = new Set(kinds);
  return manifest.resources.filter((resource) => kindSet.has(resource.kind));
}

function requestedResources(
  resources: readonly ProjectResource[],
  preferredCapabilities: readonly ProjectResourceCapability[],
) {
  return resources.map((resource) => {
    const capabilities = preferredCapabilities.filter((capability) =>
      resource.capabilities.includes(capability),
    );
    return {
      resourceId: resource.id,
      capabilities: capabilities.length > 0 ? capabilities : [resource.capabilities[0]],
    };
  });
}

function selectAllowedIds(
  allowedIds: readonly string[],
  preferredIds: readonly string[],
  fallbackCount = 1,
): readonly string[] {
  const preferred = preferredIds.filter((id) => allowedIds.includes(id));
  return preferred.length > 0 ? preferred : allowedIds.slice(0, fallbackCount);
}

function narrowBudget(budget: ProjectBudgetCeiling): ProjectBudgetCeiling {
  return {
    maxConcurrentRuns: Math.max(1, Math.min(2, budget.maxConcurrentRuns)),
    maxAttemptsPerRun: Math.max(1, Math.min(2, budget.maxAttemptsPerRun)),
    maxRunMinutes: Math.max(1, Math.min(60, budget.maxRunMinutes)),
    dailyTokenBudget: Math.min(500_000, budget.dailyTokenBudget),
    monthlyCostBudgetUsdCents: Math.min(100_000, budget.monthlyCostBudgetUsdCents),
  };
}

function evaluateScope(
  manifestInput: unknown,
  manifest: ProjectManifest | null,
  scopeId: string,
  resourceRequests: readonly Readonly<{
    resourceId: string;
    capabilities: readonly ProjectResourceCapability[];
  }>[],
  modelProfileIds: readonly string[],
  knowledgeCollectionIds: readonly string[],
  budget: ProjectBudgetCeiling,
): ProjectChildScopeDecision {
  return evaluateProjectChildScope({
    manifest: manifestInput,
    scopeKind: "department",
    scopeId,
    requestedResources: resourceRequests,
    requestedModelProfileIds: modelProfileIds,
    requestedKnowledgeCollectionIds: knowledgeCollectionIds,
    requestedBudget: budget,
    externalActionMode: "locked",
    dataEgressMode: "forbidden",
    requiredApprovalActions: manifest?.policy.requiredApprovalActions ?? [],
    additionalForbiddenActions: [`Ограничения отдела ${scopeId}`],
  });
}

function createEvaluatedScope(
  manifestInput: unknown,
  manifest: ProjectManifest | null,
  input: Readonly<{
    id: ProjectControlCenterEvaluatedScope["id"];
    name: string;
    description: string;
    resourceKinds: readonly ProjectResourceKind[];
    capabilities: readonly ProjectResourceCapability[];
    preferredModels: readonly string[];
    preferredKnowledge: readonly string[];
  }>,
): ProjectControlCenterEvaluatedScope {
  const resources = resourcesByKind(manifest, input.resourceKinds);
  const resourceRequests = requestedResources(resources, input.capabilities);
  const modelProfileIds = selectAllowedIds(
    manifest?.allowedModelProfileIds ?? [],
    input.preferredModels,
  );
  const knowledgeCollectionIds = selectAllowedIds(
    manifest?.knowledgeCollectionIds ?? [],
    input.preferredKnowledge,
  );
  const budget = narrowBudget(
    manifest?.budget ?? {
      maxConcurrentRuns: 1,
      maxAttemptsPerRun: 1,
      maxRunMinutes: 1,
      dailyTokenBudget: 0,
      monthlyCostBudgetUsdCents: 0,
    },
  );
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    requestedResourceIds: resourceRequests.map((request) => request.resourceId),
    requestedModelProfileIds: [...modelProfileIds],
    requestedKnowledgeCollectionIds: [...knowledgeCollectionIds],
    requestedBudget: { ...budget },
    decision: evaluateScope(
      manifestInput,
      manifest,
      `department-${input.id}`,
      resourceRequests,
      modelProfileIds,
      knowledgeCollectionIds,
      budget,
    ),
  };
}

function budgetSummary(budget: ProjectBudgetCeiling): string {
  return `${budget.maxConcurrentRuns} одновременных run · ${budget.maxAttemptsPerRun} попытки · ${budget.maxRunMinutes} мин.`;
}

function cloneChildScopeDecision(
  decision: ProjectChildScopeDecision,
): ProjectChildScopeDecision {
  return {
    ...decision,
    reasons: decision.reasons.map((reason) => ({ ...reason })),
    normalizedScope: decision.normalizedScope
      ? {
          ...decision.normalizedScope,
          resources: decision.normalizedScope.resources.map((resource) => ({
            ...resource,
            capabilities: [...resource.capabilities],
          })),
          modelProfileIds: [...decision.normalizedScope.modelProfileIds],
          knowledgeCollectionIds: [...decision.normalizedScope.knowledgeCollectionIds],
          budget: { ...decision.normalizedScope.budget },
          requiredApprovalActions: [...decision.normalizedScope.requiredApprovalActions],
          forbiddenActions: [...decision.normalizedScope.forbiddenActions],
        }
      : null,
  };
}

export function createProjectControlCenterDepartmentDemo(
  manifestInput: unknown,
): ProjectControlCenterDepartmentDemo {
  const validation = validateAndNormalizeProjectManifest(manifestInput);
  const manifest = validation.ok ? validation.value : null;
  const evaluatedScopes = [
    createEvaluatedScope(manifestInput, manifest, {
      id: "development",
      name: "Development",
      description: "Работа только с локальной папкой и repository в пределах project policy.",
      resourceKinds: ["local_workspace", "code_repository"],
      capabilities: ["read_metadata", "read_content", "propose_change"],
      preferredModels: ["model-codex-openai", "model-claude-code-anthropic"],
      preferredKnowledge: ["kb-product-blueprint", "kb-security-policy"],
    }),
    createEvaluatedScope(manifestInput, manifest, {
      id: "marketing",
      name: "Marketing & Growth",
      description: "Draft-only работа с разрешёнными публичными каналами.",
      resourceKinds: ["telegram_channel", "instagram_account", "website"],
      capabilities: ["read_metadata", "read_content", "create_draft"],
      preferredModels: ["model-qwen-reviewer", "model-deepseek-research"],
      preferredKnowledge: ["kb-marketing-guide", "kb-product-blueprint"],
    }),
    createEvaluatedScope(manifestInput, manifest, {
      id: "support",
      name: "Support",
      description: "Подготовка ответов без автоматической отправки клиенту.",
      resourceKinds: ["support_inbox", "website"],
      capabilities: ["read_metadata", "read_content", "create_draft"],
      preferredModels: ["model-qwen-reviewer", "model-deepseek-research"],
      preferredKnowledge: ["kb-support-playbook", "kb-customer-context"],
    }),
  ] as const;

  const baselineBudget = narrowBudget(
    manifest?.budget ?? {
      maxConcurrentRuns: 1,
      maxAttemptsPerRun: 1,
      maxRunMinutes: 1,
      dailyTokenBudget: 0,
      monthlyCostBudgetUsdCents: 0,
    },
  );
  const capabilityResource = manifest?.resources.find(
    (resource) => !resource.capabilities.includes("request_external_action"),
  );
  const capabilityRequests = capabilityResource
    ? [{ resourceId: capabilityResource.id, capabilities: ["request_external_action"] as const }]
    : [{ resourceId: "undeclared-resource", capabilities: ["read_metadata"] as const }];
  const deniedScenarios: ProjectControlCenterDeniedScenario[] = [
    {
      id: "resource-expansion",
      title: "Marketing запросил неизвестный ресурс",
      ownerExplanation: "ProjectManifest не содержит этот ресурс, поэтому доступ не выдан.",
      decision: evaluateScope(
        manifestInput,
        manifest,
        "department-marketing-resource-expansion",
        [{ resourceId: "undeclared-resource", capabilities: ["read_metadata"] }],
        [],
        [],
        baselineBudget,
      ),
    },
    {
      id: "model-expansion",
      title: "Marketing запросил модель вне allowlist",
      ownerExplanation: "Дочерний отдел не может добавить model profile, которого нет в проекте.",
      decision: evaluateScope(
        manifestInput,
        manifest,
        "department-marketing-model-expansion",
        [],
        ["model-not-approved"],
        [],
        baselineBudget,
      ),
    },
    {
      id: "capability-expansion",
      title: "Отдел расширил capability ресурса",
      ownerExplanation: "Capability отсутствует в project resource и поэтому заблокирован.",
      decision: evaluateScope(
        manifestInput,
        manifest,
        "department-capability-expansion",
        capabilityRequests,
        [],
        [],
        baselineBudget,
      ),
    },
    {
      id: "budget-expansion",
      title: "Отдел превысил project budget",
      ownerExplanation: "Дочерний бюджет может быть только равен или меньше project ceiling.",
      decision: evaluateScope(
        manifestInput,
        manifest,
        "department-budget-expansion",
        [],
        [],
        [],
        {
          ...baselineBudget,
          maxConcurrentRuns: (manifest?.budget.maxConcurrentRuns ?? 1) + 1,
        },
      ),
    },
  ];

  const evaluatedById = new Map(evaluatedScopes.map((scope) => [scope.id, scope]));
  const fallbackResources = manifest?.resources.slice(0, 2).map((resource) => resource.id) ?? [];
  const fallbackModels = manifest?.allowedModelProfileIds.slice(0, 2) ?? [];
  const fallbackKnowledge = manifest?.knowledgeCollectionIds.slice(0, 2) ?? [];
  const departmentPreviews = projectControlCenterDepartmentCatalog.map((department) => {
    const evaluated = evaluatedById.get(
      department.id as ProjectControlCenterEvaluatedScope["id"],
    );
    return {
      id: department.id,
      name: department.name,
      configurationStatus: evaluated ? "Проверено контрактом" : "Предпросмотр",
      resourceIds: evaluated ? [...evaluated.requestedResourceIds] : [...fallbackResources],
      modelProfileIds: evaluated
        ? [...evaluated.requestedModelProfileIds]
        : [...fallbackModels],
      knowledgeCollectionIds: evaluated
        ? [...evaluated.requestedKnowledgeCollectionIds]
        : [...fallbackKnowledge],
      budgetSummary: budgetSummary(evaluated?.requestedBudget ?? baselineBudget),
      policySummary:
        "Наследует project approvals, запреты и может только ужесточить policy.",
      decision: evaluated?.decision ?? null,
    } satisfies ProjectControlCenterDepartmentPreview;
  });

  return {
    evaluatedScopes: evaluatedScopes.map((scope) => ({
      ...scope,
      requestedResourceIds: [...scope.requestedResourceIds],
      requestedModelProfileIds: [...scope.requestedModelProfileIds],
      requestedKnowledgeCollectionIds: [...scope.requestedKnowledgeCollectionIds],
      requestedBudget: { ...scope.requestedBudget },
      decision: cloneChildScopeDecision(scope.decision),
    })),
    deniedScenarios: deniedScenarios.map((scenario) => ({
      ...scenario,
      decision: cloneChildScopeDecision(scenario.decision),
    })),
    departmentPreviews: departmentPreviews.map((department) => ({
      ...department,
      resourceIds: [...department.resourceIds],
      modelProfileIds: [...department.modelProfileIds],
      knowledgeCollectionIds: [...department.knowledgeCollectionIds],
      decision: department.decision
        ? cloneChildScopeDecision(department.decision)
        : null,
    })),
  };
}

const scopeReasonOwnerMessages: Readonly<Record<ProjectChildScopeReason["code"], string>> = {
  invalid_scope_input: "Запрошенная конфигурация отдела заполнена некорректно.",
  invalid_project_manifest: "Сначала нужно исправить конфигурацию проекта.",
  project_not_active: "Только активный проект может передавать настройки отделам.",
  resource_not_found: "Запрошенный ресурс отсутствует в разрешениях проекта.",
  resource_unavailable: "Ресурс отключён или находится в состоянии ошибки.",
  capability_not_allowed: "Отдел запросил capability, которой нет у project resource.",
  model_profile_not_allowed: "Модель отсутствует в project allowlist.",
  knowledge_collection_not_allowed: "Коллекция знаний отсутствует в project allowlist.",
  budget_ceiling_exceeded: "Запрошенный бюджет превышает project ceiling.",
  external_action_policy_relaxed: "Отдел попытался ослабить режим внешних действий.",
  data_egress_policy_relaxed: "Отдел попытался ослабить data-egress policy.",
  required_approval_missing: "Отдел удалил обязательное project approval.",
};

export function describeProjectControlCenterScopeReason(
  reason: ProjectChildScopeReason,
): string {
  return scopeReasonOwnerMessages[reason.code];
}
