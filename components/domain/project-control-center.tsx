"use client";

import { useMemo, useState } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  parseProjectDataClassification,
  parseProjectManifestKind,
  parseProjectManifestStatus,
  systemForbiddenProjectActions,
  systemRequiredProjectApprovalActions,
  validateAndNormalizeProjectManifest,
  type ProjectManifest,
  type ProjectManifestValidationResult,
  type ProjectResourceCapability,
  type ProjectResourceKind,
  type ProjectResourceStatus,
} from "@/lib/contracts/project-manifest";
import {
  createProjectControlCenterDemo,
  createProjectControlCenterDepartmentDemo,
  createProjectControlCenterDraftProject,
  describeProjectControlCenterScopeReason,
  type ProjectControlCenterDemoProject,
} from "@/lib/project-control-center-demo";

const sections = [
  { id: "overview", label: "Обзор" },
  { id: "basics", label: "Основные данные" },
  { id: "resources", label: "Ресурсы и каналы" },
  { id: "models", label: "Модели" },
  { id: "knowledge", label: "Knowledge Collections" },
  { id: "policy", label: "Политики и approvals" },
  { id: "budgets", label: "Бюджеты" },
  { id: "departments", label: "AI Departments preview" },
] as const;

type SectionId = (typeof sections)[number]["id"];

type ValidationFeedback = Readonly<{
  source: "check" | "save";
  result: ProjectManifestValidationResult;
}>;

const inputClassName =
  "mt-2 min-h-10 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus-visible:border-cyan-400/60 focus-visible:ring-2 focus-visible:ring-cyan-400/30";

const statusLabels = {
  draft: "Draft",
  active: "Активен",
  paused: "Приостановлен",
  archived: "Архив",
} as const;

const kindLabels: Readonly<Record<ProjectManifest["kind"], string>> = {
  internal_product: "Внутренний продукт",
  client_project: "Клиентский проект",
  managed_service: "Управляемый сервис",
  experiment: "Эксперимент",
};

const classificationLabels: Readonly<
  Record<ProjectManifest["dataClassification"], string>
> = {
  public: "Публичные данные",
  internal: "Внутренние данные",
  confidential: "Конфиденциальные данные",
  restricted: "Данные с ограниченным доступом",
};

const resourceKindLabels: Readonly<Record<ProjectResourceKind, string>> = {
  local_workspace: "Локальная папка",
  code_repository: "Code repository",
  telegram_channel: "Telegram channel",
  instagram_account: "Instagram account",
  website: "Website",
  support_inbox: "Support inbox",
  email_account: "Email account",
  crm: "CRM",
  analytics: "Analytics",
  file_storage: "File storage",
  custom: "Custom resource",
};

const resourceStatusLabels: Readonly<Record<ProjectResourceStatus, string>> = {
  configured: "Настроено как metadata",
  connected: "Connection ID указан",
  disabled: "Отключено",
  error: "Ошибка конфигурации",
};

const capabilityLabels: Readonly<Record<ProjectResourceCapability, string>> = {
  read_metadata: "Читать metadata",
  read_content: "Читать содержимое",
  create_draft: "Создавать draft",
  propose_change: "Предлагать изменения",
  request_external_action: "Запрашивать внешнее действие",
};

const approvalLabels: Readonly<Record<string, string>> = {
  code_run: "Запуск кода",
  code_publication: "Публикация кода",
  content_publication: "Публикация контента",
  message_send: "Отправка сообщения",
  customer_contact: "Контакт с клиентом",
  data_export: "Экспорт данных",
  configuration_change: "Изменение конфигурации",
  credential_change: "Изменение credentials",
  production_change: "Изменение production",
  financial_action: "Финансовое действие",
};

const fieldLabels: Readonly<Record<string, string>> = {
  id: "ID проекта",
  workspaceId: "Workspace",
  version: "Версия",
  name: "Название",
  slug: "Slug",
  summary: "Описание",
  kind: "Тип проекта",
  status: "Статус",
  defaultLocale: "Локаль",
  timeZone: "Часовой пояс",
  dataRegion: "Регион данных",
  dataClassification: "Классификация данных",
  goals: "Цели",
  nonGoals: "Не-цели",
  tags: "Теги",
  resources: "Ресурсы",
  allowedModelProfileIds: "Модели",
  knowledgeCollectionIds: "Knowledge Collections",
  policy: "Политики",
  budget: "Бюджеты",
};

function ownerFieldLabel(path: string): string {
  const root = path.split(/[.[]/u)[0] ?? path;
  return fieldLabels[root] ?? "Конфигурация";
}

function Metric({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-2 min-w-0 break-words text-lg font-semibold text-slate-100">
        {value}
      </dd>
    </div>
  );
}

function IdList({ values, empty = "Не выбрано" }: Readonly<{ values: readonly string[]; empty?: string }>) {
  if (values.length === 0) {
    return <p className="text-sm text-slate-500">{empty}</p>;
  }
  return (
    <ul className="min-w-0 space-y-1.5">
      {values.map((value) => (
        <li className="min-w-0 break-all font-mono text-xs text-slate-300" key={value}>
          {value}
        </li>
      ))}
    </ul>
  );
}

function TextListEditor({
  id,
  label,
  description,
  values,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  description: string;
  values: readonly string[];
  onChange: (values: readonly string[]) => void;
}>) {
  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className="text-sm font-medium text-slate-200">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      <textarea
        className={`${inputClassName} min-h-28 resize-y`}
        id={id}
        onChange={(event) => onChange(event.target.value.split("\n"))}
        value={values.join("\n")}
      />
    </label>
  );
}

export function ProjectControlCenter() {
  const [initialDemo] = useState(createProjectControlCenterDemo);
  const [projects, setProjects] = useState<ProjectControlCenterDemoProject[]>(() =>
    initialDemo.projects.map((project) => ({ ...project })),
  );
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialDemo.projects[0]?.manifest.id ?? "",
  );
  const [workingManifest, setWorkingManifest] = useState<ProjectManifest>(
    initialDemo.projects[0]?.manifest ?? createProjectControlCenterDraftProject().manifest,
  );
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [nextDraftSequence, setNextDraftSequence] = useState(1);
  const [validationFeedback, setValidationFeedback] =
    useState<ValidationFeedback | null>(null);
  const [saveMessage, setSaveMessage] = useState("");

  const selectedProject =
    projects.find((project) => project.manifest.id === selectedProjectId) ?? projects[0];
  const departmentDemo = useMemo(
    () => createProjectControlCenterDepartmentDemo(workingManifest),
    [workingManifest],
  );
  const modelById = useMemo(
    () => new Map(initialDemo.modelProfiles.map((profile) => [profile.id, profile])),
    [initialDemo.modelProfiles],
  );
  const knowledgeById = useMemo(
    () =>
      new Map(
        initialDemo.knowledgeCollections.map((collection) => [collection.id, collection]),
      ),
    [initialDemo.knowledgeCollections],
  );

  function updateManifest<Field extends keyof ProjectManifest>(
    field: Field,
    value: ProjectManifest[Field],
  ) {
    setWorkingManifest((manifest) => ({ ...manifest, [field]: value }));
    setValidationFeedback(null);
    setSaveMessage("");
  }

  function selectProject(projectId: string) {
    const project = projects.find((candidate) => candidate.manifest.id === projectId);
    if (!project) {
      return;
    }
    setSelectedProjectId(projectId);
    setWorkingManifest(project.manifest);
    setValidationFeedback(null);
    setSaveMessage("");
    setActiveSection("overview");
  }

  function createDraft() {
    const draft = createProjectControlCenterDraftProject(nextDraftSequence);
    setProjects((current) => [...current, draft]);
    setSelectedProjectId(draft.manifest.id);
    setWorkingManifest(draft.manifest);
    setNextDraftSequence((sequence) => sequence + 1);
    setValidationFeedback(null);
    setSaveMessage("Создан локальный draft. Он существует только до обновления страницы.");
    setActiveSection("basics");
  }

  function checkConfiguration(source: ValidationFeedback["source"]) {
    const result = validateAndNormalizeProjectManifest(workingManifest);
    setValidationFeedback({ source, result });
    if (source === "save") {
      if (!result.ok) {
        setSaveMessage("Изменения не сохранены: сначала исправьте конфигурацию.");
        return;
      }
      setProjects((current) =>
        current.map((project) =>
          project.manifest.id === selectedProjectId
            ? { ...project, manifest: result.value }
            : project,
        ),
      );
      setWorkingManifest(result.value);
      setSaveMessage("Конфигурация обновлена только в памяти этой страницы.");
    }
  }

  const customApprovals = workingManifest.policy.requiredApprovalActions.filter(
    (approval) => !systemRequiredProjectApprovalActions.includes(
      approval as (typeof systemRequiredProjectApprovalActions)[number],
    ),
  );
  const customForbiddenActions = workingManifest.policy.forbiddenActions.filter(
    (action) => !systemForbiddenProjectActions.includes(
      action as (typeof systemForbiddenProjectActions)[number],
    ),
  );

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-hidden">
      <section className="min-w-0 rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-400/10 via-slate-950 to-violet-400/10 p-5">
        <div className="flex min-w-0 flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <label className="block max-w-xl" htmlFor="project-control-project">
              <span className="text-sm font-medium text-slate-200">Выбранный проект</span>
              <select
                className={inputClassName}
                id="project-control-project"
                onChange={(event) => selectProject(event.target.value)}
                value={selectedProjectId}
              >
                {projects.map((project) => (
                  <option key={project.manifest.id} value={project.manifest.id}>
                    {project.manifest.name} · {statusLabels[project.manifest.status]}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              {selectedProject?.ownerSummary}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-600 bg-slate-900/80 px-4 text-sm font-medium text-slate-100 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onClick={createDraft}
              type="button"
            >
              Создать проект
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-4 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onClick={() => checkConfiguration("check")}
              type="button"
            >
              Проверить конфигурацию
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-violet-400/40 bg-violet-400/15 px-4 text-sm font-medium text-violet-100 transition hover:bg-violet-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              onClick={() => checkConfiguration("save")}
              type="button"
            >
              Сохранить в памяти
            </button>
          </div>
        </div>
        <p className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
          Данные не сохраняются в базе и исчезнут после обновления страницы. Здесь нет
          localStorage, API-вызовов или реальных внешних действий.
        </p>
      </section>

      <div aria-live="polite" className="min-h-6 min-w-0">
        {validationFeedback && (
          <section
            className={`rounded-xl border p-4 ${
              validationFeedback.result.ok
                ? "border-emerald-400/30 bg-emerald-400/10"
                : "border-rose-400/30 bg-rose-400/10"
            }`}
          >
            <h2
              className={`font-semibold ${
                validationFeedback.result.ok ? "text-emerald-100" : "text-rose-100"
              }`}
            >
              {validationFeedback.result.ok
                ? "Конфигурация проекта корректна"
                : "Конфигурацию нужно исправить"}
            </h2>
            {!validationFeedback.result.ok && (
              <ul className="mt-3 space-y-2 text-sm text-rose-100/90">
                {validationFeedback.result.errors.map((error, index) => (
                  <li key={`${error.path}-${error.code}-${index}`}>
                    {ownerFieldLabel(error.path)}: проверьте значение поля.
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-3 text-xs text-slate-300">
              <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                Технические подробности
              </summary>
              <div className="mt-3 min-w-0 space-y-2">
                {validationFeedback.result.ok ? (
                  <p>AI-013 validation result: ok</p>
                ) : (
                  validationFeedback.result.errors.map((error, index) => (
                    <p className="min-w-0 break-all font-mono" key={`${error.code}-${index}`}>
                      {error.code} · {error.path} · {error.message}
                    </p>
                  ))
                )}
              </div>
            </details>
          </section>
        )}
        {saveMessage && <p className="mt-2 text-sm text-cyan-100">{saveMessage}</p>}
      </div>

      <nav aria-label="Разделы Project Control Center" className="min-w-0">
        <div className="flex min-w-0 flex-wrap gap-2">
          {sections.map((section) => (
            <button
              aria-pressed={activeSection === section.id}
              className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                activeSection === section.id
                  ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
                  : "border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800"
              }`}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      {activeSection === "overview" && (
        <div className="min-w-0 space-y-6">
          <SectionCard
            title="Проект задаёт верхнюю границу"
            description="Departments, Agents и Workflows смогут использовать только разрешённые здесь ресурсы, модели, знания, бюджеты и policies. Они могут сузить настройки, но не расширить их."
          >
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Статус" value={statusLabels[workingManifest.status]} />
              <Metric label="Тип" value={kindLabels[workingManifest.kind]} />
              <Metric
                label="Классификация"
                value={classificationLabels[workingManifest.dataClassification]}
              />
              <Metric label="Регион данных" value={workingManifest.dataRegion} />
              <Metric label="Ресурсы" value={workingManifest.resources.length} />
              <Metric label="Разрешённые модели" value={workingManifest.allowedModelProfileIds.length} />
              <Metric
                label="Knowledge Collections"
                value={workingManifest.knowledgeCollectionIds.length}
              />
              <Metric label="Версия manifest" value={workingManifest.version} />
            </div>
          </SectionCard>
          <SectionCard title="Идентификаторы проекта">
            <dl className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">Project ID</dt>
                <dd className="mt-1 break-all font-mono text-sm text-slate-200">
                  {workingManifest.id}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">Workspace boundary</dt>
                <dd className="mt-1 break-all font-mono text-sm text-slate-200">
                  {workingManifest.workspaceId}
                </dd>
              </div>
            </dl>
          </SectionCard>
        </div>
      )}

      {activeSection === "basics" && (
        <SectionCard
          title="Основные данные проекта"
          description="Изменения остаются локальным working draft, пока вы не нажмёте «Сохранить в памяти»."
        >
          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <label className="block min-w-0" htmlFor="project-name">
              <span className="text-sm font-medium text-slate-200">Название</span>
              <input
                className={inputClassName}
                id="project-name"
                onChange={(event) => updateManifest("name", event.target.value)}
                value={workingManifest.name}
              />
            </label>
            <label className="block min-w-0" htmlFor="project-slug">
              <span className="text-sm font-medium text-slate-200">Slug</span>
              <input
                className={`${inputClassName} font-mono`}
                id="project-slug"
                onChange={(event) => updateManifest("slug", event.target.value)}
                value={workingManifest.slug}
              />
            </label>
            <label className="block min-w-0 lg:col-span-2" htmlFor="project-summary">
              <span className="text-sm font-medium text-slate-200">Краткое описание</span>
              <textarea
                className={`${inputClassName} min-h-28 resize-y`}
                id="project-summary"
                onChange={(event) => updateManifest("summary", event.target.value)}
                value={workingManifest.summary}
              />
            </label>
            <label className="block min-w-0" htmlFor="project-kind">
              <span className="text-sm font-medium text-slate-200">Тип проекта</span>
              <select
                className={inputClassName}
                id="project-kind"
                onChange={(event) => {
                  const value = parseProjectManifestKind(event.target.value);
                  if (value) updateManifest("kind", value);
                }}
                value={workingManifest.kind}
              >
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-0" htmlFor="project-status">
              <span className="text-sm font-medium text-slate-200">Статус</span>
              <select
                className={inputClassName}
                id="project-status"
                onChange={(event) => {
                  const value = parseProjectManifestStatus(event.target.value);
                  if (value) updateManifest("status", value);
                }}
                value={workingManifest.status}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-0" htmlFor="project-locale">
              <span className="text-sm font-medium text-slate-200">Default locale</span>
              <input
                className={inputClassName}
                id="project-locale"
                onChange={(event) => updateManifest("defaultLocale", event.target.value)}
                value={workingManifest.defaultLocale}
              />
            </label>
            <label className="block min-w-0" htmlFor="project-time-zone">
              <span className="text-sm font-medium text-slate-200">Time zone</span>
              <input
                className={inputClassName}
                id="project-time-zone"
                onChange={(event) => updateManifest("timeZone", event.target.value)}
                value={workingManifest.timeZone}
              />
            </label>
            <label className="block min-w-0" htmlFor="project-data-region">
              <span className="text-sm font-medium text-slate-200">Data region</span>
              <input
                className={inputClassName}
                id="project-data-region"
                onChange={(event) => updateManifest("dataRegion", event.target.value)}
                value={workingManifest.dataRegion}
              />
            </label>
            <label className="block min-w-0" htmlFor="project-classification">
              <span className="text-sm font-medium text-slate-200">Data classification</span>
              <select
                className={inputClassName}
                id="project-classification"
                onChange={(event) => {
                  const value = parseProjectDataClassification(event.target.value);
                  if (value) updateManifest("dataClassification", value);
                }}
                value={workingManifest.dataClassification}
              >
                {Object.entries(classificationLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <TextListEditor
              description="Одна цель на строку."
              id="project-goals"
              label="Цели"
              onChange={(values) => updateManifest("goals", values)}
              values={workingManifest.goals}
            />
            <TextListEditor
              description="Что сознательно не входит в проект."
              id="project-non-goals"
              label="Не-цели"
              onChange={(values) => updateManifest("nonGoals", values)}
              values={workingManifest.nonGoals}
            />
            <div className="lg:col-span-2">
              <TextListEditor
                description="Один тег на строку."
                id="project-tags"
                label="Теги"
                onChange={(values) => updateManifest("tags", values)}
                values={workingManifest.tags}
              />
            </div>
          </div>
        </SectionCard>
      )}

      {activeSection === "resources" && (
        <div className="min-w-0 space-y-6">
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
            Сейчас это только конфигурационные метаданные. Проверка соединения и реальные
            adapters ещё не подключены.
          </p>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {workingManifest.resources.map((resource) => (
              <SectionCard className="min-w-0" key={resource.id}>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-semibold text-slate-100">
                      {resource.label}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {resourceKindLabels[resource.kind]}
                    </p>
                  </div>
                  <StatusBadge tone={resource.status === "error" ? "danger" : "neutral"}>
                    {resourceStatusLabels[resource.status]}
                  </StatusBadge>
                </div>
                <dl className="mt-4 min-w-0 space-y-4">
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">resourceRef</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-slate-200">
                      {resource.resourceRef}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Разрешённые capabilities</dt>
                    <dd className="mt-2 flex flex-wrap gap-2">
                      {resource.capabilities.map((capability) => (
                        <span
                          className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300"
                          key={capability}
                        >
                          {capabilityLabels[capability]}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
                <details className="mt-4 text-xs text-slate-400">
                  <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                    Технические IDs
                  </summary>
                  <p className="mt-2 break-all font-mono">resource: {resource.id}</p>
                  <p className="mt-1 break-all font-mono">
                    connection: {resource.connectionId ?? "не задан"}
                  </p>
                </details>
              </SectionCard>
            ))}
          </div>
          {workingManifest.resources.length === 0 && (
            <SectionCard title="Ресурсы ещё не добавлены">
              <p className="text-sm text-slate-400">
                Это безопасный draft без доступных ресурсов и каналов.
              </p>
            </SectionCard>
          )}
        </div>
      )}

      {activeSection === "models" && (
        <SectionCard
          title="Allowlist model profile IDs"
          description="Canonical ProjectManifest хранит только opaque IDs. Названия и роли ниже — presentation mapping интерфейса. SDK, API calls и API keys отсутствуют; подключение provider не подтверждается."
        >
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {workingManifest.allowedModelProfileIds.map((modelId) => {
              const model = modelById.get(
                modelId as (typeof initialDemo.modelProfiles)[number]["id"],
              );
              return (
                <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4" key={modelId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-100">{model?.name ?? "Unknown profile"}</h2>
                      <p className="mt-1 text-xs text-slate-500">{model?.provider ?? "Только opaque ID"}</p>
                    </div>
                    <StatusBadge tone="info">Allowlist</StatusBadge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{model?.role ?? "Нет UI mapping"}</p>
                  <p className="mt-3 break-all font-mono text-xs text-slate-500">{modelId}</p>
                </div>
              );
            })}
          </div>
          {workingManifest.allowedModelProfileIds.length === 0 && (
            <p className="text-sm text-slate-500">Для этого draft модели ещё не разрешены.</p>
          )}
        </SectionCard>
      )}

      {activeSection === "knowledge" && (
        <SectionCard
          title="Project Knowledge allowlist"
          description="Отдел или workflow сможет выбрать только Knowledge Collection из project allowlist. Это пока metadata без индексации и чтения документов."
        >
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {workingManifest.knowledgeCollectionIds.map((collectionId) => {
              const collection = knowledgeById.get(
                collectionId as (typeof initialDemo.knowledgeCollections)[number]["id"],
              );
              return (
                <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4" key={collectionId}>
                  <h2 className="font-semibold text-slate-100">{collection?.name ?? "Unknown collection"}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{collection?.description ?? "Нет UI mapping"}</p>
                  <p className="mt-3 break-all font-mono text-xs text-slate-500">{collectionId}</p>
                </div>
              );
            })}
          </div>
          {workingManifest.knowledgeCollectionIds.length === 0 && (
            <p className="text-sm text-slate-500">Для этого draft коллекции ещё не выбраны.</p>
          )}
        </SectionCard>
      )}

      {activeSection === "policy" && (
        <div className="grid min-w-0 gap-6 xl:grid-cols-2">
          <SectionCard title="Project policy ceilings">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="External actions"
                value={workingManifest.policy.externalActionMode === "locked" ? "Полностью заблокированы" : "Только после approval"}
              />
              <Metric
                label="Data egress"
                value={{ forbidden: "Запрещён", redacted_only: "Только обезличенные данные", approved_minimum: "Минимум после approval" }[workingManifest.policy.dataEgressMode]}
              />
            </dl>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              Дочерняя конфигурация может выбрать более строгий режим, но не более слабый.
            </p>
          </SectionCard>
          <SectionCard
            title="System-required Owner approvals"
            description="Эти approvals добавлены AI-013 автоматически, не редактируются и не могут быть удалены дочерним scope."
          >
            <ul className="space-y-2">
              {systemRequiredProjectApprovalActions.map((approval) => (
                <li className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2" key={approval}>
                  <span className="min-w-0 text-sm text-cyan-100">{approvalLabels[approval] ?? approval}</span>
                  <StatusBadge tone="locked">Системное</StatusBadge>
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard title="Дополнительные Owner approvals">
            <IdList empty="Дополнительных approvals нет" values={customApprovals} />
          </SectionCard>
          <SectionCard
            title="System-forbidden actions"
            description="Неизменяемые запреты защищают production, credentials, Git и реальные активы."
          >
            <ul className="space-y-2">
              {systemForbiddenProjectActions.map((action) => (
                <li className="flex min-w-0 gap-3 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-sm leading-6 text-rose-100" key={action}>
                  <span aria-hidden="true">×</span>
                  <span className="min-w-0 break-words">{action}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard title="Дополнительные ограничения проекта">
            <ul className="space-y-2 text-sm leading-6 text-slate-300">
              {customForbiddenActions.map((action) => <li key={action}>• {action}</li>)}
            </ul>
            {customForbiddenActions.length === 0 && <p className="text-sm text-slate-500">Дополнительных ограничений нет.</p>}
          </SectionCard>
        </div>
      )}

      {activeSection === "budgets" && (
        <SectionCard
          title="Project budget ceilings"
          description="Это максимальные значения проекта. Отделы и процессы могут получить меньший бюджет, но не больший. Ноль в token или cost budget означает запрет расходования, а не unlimited."
        >
          <dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Concurrent runs" value={workingManifest.budget.maxConcurrentRuns} />
            <Metric label="Attempts per run" value={workingManifest.budget.maxAttemptsPerRun} />
            <Metric label="Run duration" value={`${workingManifest.budget.maxRunMinutes} мин.`} />
            <Metric label="Daily token budget" value={workingManifest.budget.dailyTokenBudget.toLocaleString("ru-RU")} />
            <Metric label="Monthly cost ceiling" value={`$${(workingManifest.budget.monthlyCostBudgetUsdCents / 100).toLocaleString("ru-RU")}`} />
          </dl>
        </SectionCard>
      )}

      {activeSection === "departments" && (
        <div className="min-w-0 space-y-6">
          <SectionCard
            title="Десять AI Departments"
            description="Это preview будущей настройки отделов. Development, Marketing и Support уже проверяются реальным evaluateProjectChildScope; остальные карточки показывают предполагаемое наследование."
          >
            <div className="grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {departmentDemo.departmentPreviews.map((department) => (
                <article className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4" key={department.id}>
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <h2 className="min-w-0 break-words font-semibold text-slate-100">{department.name}</h2>
                    <StatusBadge tone={department.decision?.verdict === "allow" ? "success" : department.decision?.verdict === "deny" ? "danger" : "neutral"}>
                      {department.decision?.verdict === "allow" ? "Разрешено" : department.decision?.verdict === "deny" ? "Не разрешено" : department.configurationStatus}
                    </StatusBadge>
                  </div>
                  <dl className="mt-4 min-w-0 space-y-4">
                    <div><dt className="text-xs text-slate-500">Ресурсы</dt><dd className="mt-1"><IdList values={department.resourceIds} /></dd></div>
                    <div><dt className="text-xs text-slate-500">Модели</dt><dd className="mt-1"><IdList values={department.modelProfileIds} /></dd></div>
                    <div><dt className="text-xs text-slate-500">Knowledge</dt><dd className="mt-1"><IdList values={department.knowledgeCollectionIds} /></dd></div>
                    <div><dt className="text-xs text-slate-500">Бюджет</dt><dd className="mt-1 text-sm text-slate-300">{department.budgetSummary}</dd></div>
                    <div><dt className="text-xs text-slate-500">Policy</dt><dd className="mt-1 text-sm leading-6 text-slate-400">{department.policySummary}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Fail-closed примеры расширения"
            description="Approval не может обойти неизвестный ресурс, модель, capability или project budget ceiling."
          >
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              {departmentDemo.deniedScenarios.map((scenario) => (
                <article
                  className={`min-w-0 rounded-lg border p-4 ${
                    scenario.decision.verdict === "deny"
                      ? "border-rose-400/25 bg-rose-400/5"
                      : "border-emerald-400/25 bg-emerald-400/5"
                  }`}
                  key={scenario.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2
                      className={`font-semibold ${
                        scenario.decision.verdict === "deny"
                          ? "text-rose-100"
                          : "text-emerald-100"
                      }`}
                    >
                      {scenario.title}
                    </h2>
                    <StatusBadge
                      tone={scenario.decision.verdict === "deny" ? "danger" : "success"}
                    >
                      {scenario.decision.verdict}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {scenario.decision.verdict === "deny"
                      ? scenario.ownerExplanation
                      : "Evaluator разрешил запрошенный scope."}
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {scenario.decision.reasons.map((reason, index) => (
                      <li key={`${reason.code}-${reason.path}-${index}`}>{describeProjectControlCenterScopeReason(reason)}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs font-medium text-slate-400">
                    {scenario.decision.normalizedScope === null
                      ? "normalizedScope: null — частичного доступа нет."
                      : "normalizedScope сформирован evaluator и содержит разрешённый scope."}
                  </p>
                  <details className="mt-3 text-xs text-slate-400">
                    <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Технические причины</summary>
                    {scenario.decision.reasons.map((reason, index) => (
                      <p className="mt-2 break-all font-mono" key={`${scenario.id}-technical-${index}`}>{reason.code} · {reason.path}</p>
                    ))}
                  </details>
                </article>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
