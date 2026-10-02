"use client";

import { useMemo, useState } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  createProjectOperationsDemo,
  createProjectOperationsView,
  type AvailableProjectOperationsView,
  type ProjectOperationsBindingRow,
  type ProjectOperationsBlockedRow,
  type ProjectOperationsDispatchRow,
  type ProjectOperationsQueueRow,
  type ProjectOperationsRunningRow,
  type ProjectOperationsScope,
} from "@/lib/project-operations-demo";
import type { StatusTone } from "@/types/app";

const sections = [
  { id: "overview", label: "Обзор" },
  { id: "departments", label: "Отделы" },
  { id: "agents", label: "Агенты" },
  { id: "workflows", label: "Workflows" },
  { id: "runs", label: "Очередь и запуски" },
] as const;

type SectionId = (typeof sections)[number]["id"];
type RunRow =
  | ProjectOperationsQueueRow
  | ProjectOperationsRunningRow
  | ProjectOperationsDispatchRow;

const statusLabels = {
  active: "Активен",
  draft: "Draft",
  paused: "Приостановлен",
  archived: "Архив",
} as const;

const bindingKindLabels = {
  agent: "Agent",
  workflow: "Workflow",
} as const;

const runStatusLabels = {
  running: "Running now",
  planned: "Запланирован",
  blocked: "Остаётся в очереди",
} as const;

function Metric({
  label,
  value,
  detail,
}: Readonly<{
  label: string;
  value: string | number;
  detail?: string;
}>) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/55 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-2 break-words text-xl font-semibold text-slate-100">
        {value}
      </dd>
      {detail ? <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p> : null}
    </div>
  );
}

function Identifier({ children }: Readonly<{ children: string }>) {
  return (
    <span className="break-all font-mono text-xs text-slate-400" title={children}>
      {children}
    </span>
  );
}

function EmptyState({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="rounded-lg border border-dashed border-slate-800 px-4 py-5 text-sm text-slate-500">
      {children}
    </p>
  );
}

function BindingCard({
  row,
  kind,
}: Readonly<{
  row: ProjectOperationsBindingRow;
  kind: "Agent" | "Workflow";
}>) {
  return (
    <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            {row.projectName} · {row.departmentName}
          </p>
          <h3 className="mt-1 break-all text-sm font-semibold text-slate-100">
            {row.subjectId}
          </h3>
        </div>
        <StatusBadge tone={row.status === "active" ? "success" : "warning"}>
          {kind} · {row.status}
        </StatusBadge>
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">Binding</dt>
          <dd className="mt-1"><Identifier>{row.bindingId}</Identifier></dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Concurrency ceiling</dt>
          <dd className="mt-1 text-slate-200">{row.effectiveMaxConcurrentRuns}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-slate-500">Model Profiles</dt>
          <dd className="mt-1 flex min-w-0 flex-wrap gap-2">
            {row.modelProfileIds.map((modelId) => (
              <Identifier key={modelId}>{modelId}</Identifier>
            ))}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function RunCard({
  row,
  tone,
}: Readonly<{
  row: RunRow;
  tone: StatusTone;
}>) {
  const identifier = "runId" in row ? row.runId : row.requestId;
  return (
    <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            {row.projectName} · {row.departmentName}
          </p>
          <div className="mt-1"><Identifier>{identifier}</Identifier></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="info">{row.priority}</StatusBadge>
          <StatusBadge tone={tone}>{runStatusLabels[row.factualStatus]}</StatusBadge>
        </div>
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">{bindingKindLabels[row.bindingKind]}</dt>
          <dd className="mt-1 break-all text-slate-200">{row.subjectId}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">Binding</dt>
          <dd className="mt-1"><Identifier>{row.bindingId}</Identifier></dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">Model Profile</dt>
          <dd className="mt-1"><Identifier>{row.modelProfileId}</Identifier></dd>
        </div>
      </dl>
    </article>
  );
}

function Overview({ view }: Readonly<{ view: AvailableProjectOperationsView }>) {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <SectionCard
        title="Фактическое решение Scheduler"
        description="Decision вычислен один раз по полному Workspace state до применения UI-фильтра."
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <Metric label="Verdict" value={view.summary.schedulerVerdict} />
          <Metric label="Status" value={view.summary.schedulerStatus} />
          <Metric
            label="Last cursor"
            value={view.summary.lastRoundRobinProjectId ?? "не задан"}
          />
          <Metric
            label="Next cursor"
            value={view.summary.nextRoundRobinProjectId ?? "не задан"}
          />
        </dl>
      </SectionCard>
      <SectionCard
        title="Границы Operations Center"
        description="Workspace → Project → Department → Agent / Workflow → Run"
      >
        <ul className="space-y-3 text-sm leading-6 text-slate-300">
          <li>Project scope группирует данные, но не управляет runtime.</li>
          <li>Running и queued rows остаются разными фактическими состояниями.</li>
          <li>Blocked reasons получены из полного AI‑017 dispatch plan.</li>
          <li>Publish, send, deploy и реальные model calls отсутствуют.</li>
        </ul>
      </SectionCard>
    </div>
  );
}

function Departments({ view }: Readonly<{ view: AvailableProjectOperationsView }>) {
  if (view.departments.length === 0) return <EmptyState>В выбранном scope нет отделов.</EmptyState>;
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {view.departments.map((row) => (
        <article
          className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/45 p-4"
          key={`${row.projectId}:${row.departmentId}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">{row.projectName}</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-100">{row.name}</h3>
              <div className="mt-1"><Identifier>{row.departmentId}</Identifier></div>
            </div>
            <StatusBadge tone={row.status === "active" ? "success" : "warning"}>
              {row.status}
            </StatusBadge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">Code</dt><dd className="mt-1 text-slate-200">{row.code}</dd></div>
            <div><dt className="text-xs text-slate-500">Mode</dt><dd className="mt-1 break-words text-slate-200">{row.operatingMode}</dd></div>
            <div><dt className="text-xs text-slate-500">Agents</dt><dd className="mt-1 text-slate-200">{row.agentsCount}</dd></div>
            <div><dt className="text-xs text-slate-500">Workflows</dt><dd className="mt-1 text-slate-200">{row.workflowsCount}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-slate-500">Effective maxConcurrentRuns</dt><dd className="mt-1 text-slate-200">{row.effectiveMaxConcurrentRuns}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function Bindings({
  rows,
  kind,
}: Readonly<{
  rows: readonly ProjectOperationsBindingRow[];
  kind: "Agent" | "Workflow";
}>) {
  if (rows.length === 0) return <EmptyState>В выбранном scope нет {kind} bindings.</EmptyState>;
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <BindingCard kind={kind} key={`${row.projectId}:${row.bindingId}`} row={row} />
      ))}
    </div>
  );
}

function Runs({ view }: Readonly<{ view: AvailableProjectOperationsView }>) {
  const retained = view.queued.filter((row) => row.factualStatus === "blocked");
  return (
    <div className="min-w-0 space-y-6">
      <SectionCard title="Running now" description="Только фактические runningRuns общего Workspace state.">
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {view.running.length > 0
            ? view.running.map((row) => <RunCard key={row.runId} row={row} tone="success" />)
            : <EmptyState>Сейчас нет running runs в выбранном scope.</EmptyState>}
        </div>
      </SectionCard>
      <SectionCard title="Planned dispatches" description="Заявки, выбранные фактическим AI‑017 plan.">
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {view.dispatches.length > 0
            ? view.dispatches.map((row) => <RunCard key={row.requestId} row={row} tone="info" />)
            : <EmptyState>Нет planned dispatches в выбранном scope.</EmptyState>}
        </div>
      </SectionCard>
      <SectionCard title="Queued / retained" description="Заявки, которые Scheduler сохранил в очереди.">
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {retained.length > 0
            ? retained.map((row) => <RunCard key={row.requestId} row={row} tone="warning" />)
            : <EmptyState>Нет retained requests в выбранном scope.</EmptyState>}
        </div>
      </SectionCard>
      <SectionCard title="Blocked reasons" description="Owner-facing объяснение и фактические технические diagnostics.">
        <div className="min-w-0 space-y-3">
          {view.blocked.length > 0
            ? view.blocked.map((row: ProjectOperationsBlockedRow) => (
                <article className="min-w-0 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4" key={row.requestId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">{row.projectName} · {row.departmentName}</p>
                      <div className="mt-1"><Identifier>{row.requestId}</Identifier></div>
                    </div>
                    <StatusBadge tone="warning">Остаётся в очереди</StatusBadge>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-100/90">
                    {row.reasons.map((reason) => <li key={`${reason.code}:${reason.path}`}>{reason.ownerMessage}</li>)}
                  </ul>
                  <details className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40">
                      Технические данные
                    </summary>
                    <div className="mt-3 space-y-3">
                      {row.reasons.map((reason) => (
                        <dl className="grid min-w-0 gap-2 border-t border-slate-800 pt-3 text-xs sm:grid-cols-2" key={`${reason.code}:${reason.path}:details`}>
                          <div><dt className="text-slate-500">reason.code</dt><dd className="mt-1 break-all font-mono text-slate-300">{reason.code}</dd></div>
                          <div><dt className="text-slate-500">reason.path</dt><dd className="mt-1 break-all font-mono text-slate-300">{reason.path}</dd></div>
                          <div><dt className="text-slate-500">projectId</dt><dd className="mt-1 break-all font-mono text-slate-300">{reason.projectId ?? "null"}</dd></div>
                          <div><dt className="text-slate-500">departmentId</dt><dd className="mt-1 break-all font-mono text-slate-300">{reason.departmentId ?? "null"}</dd></div>
                          <div><dt className="text-slate-500">bindingId</dt><dd className="mt-1 break-all font-mono text-slate-300">{reason.bindingId ?? "null"}</dd></div>
                        </dl>
                      ))}
                    </div>
                  </details>
                </article>
              ))
            : <EmptyState>Нет blocked reasons в выбранном scope.</EmptyState>}
        </div>
      </SectionCard>
    </div>
  );
}

export function ProjectOperationsCenter() {
  const [demo] = useState(createProjectOperationsDemo);
  const [scope, setScope] = useState<ProjectOperationsScope>({ kind: "workspace" });
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const view = useMemo(() => createProjectOperationsView(demo, scope), [demo, scope]);
  const scopeProjects =
    view.available && demo.projectionSnapshot.state === "available"
      ? demo.projectionSnapshot.projects
      : [];
  const scopeLabel =
    scope.kind === "workspace"
      ? "Все проекты"
      : scopeProjects.find((project) => project.projectId === scope.projectId)?.name ?? "Недоступный проект";

  function selectScope(nextScope: ProjectOperationsScope) {
    setScope(nextScope);
    setActiveSection("overview");
  }

  return (
    <div className="min-w-0 space-y-6" data-testid="project-operations-center">
      <SectionCard
        title="Project scope"
        description="Выберите Workspace или точный Project Context для отображения."
      >
        <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Project scope">
          <button
            aria-pressed={scope.kind === "workspace"}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${scope.kind === "workspace" ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100" : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600"}`}
            data-scope="workspace"
            onClick={() => selectScope({ kind: "workspace" })}
            type="button"
          >
            Все проекты
          </button>
          {scopeProjects.map((project) => (
            <button
              aria-pressed={scope.kind === "project" && scope.projectId === project.projectId}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${scope.kind === "project" && scope.projectId === project.projectId ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100" : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600"}`}
              data-scope={project.projectId}
              key={project.projectId}
              onClick={() => selectScope({ kind: "project", projectId: project.projectId })}
              type="button"
            >
              {project.name}
            </button>
          ))}
        </div>
        <p className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm leading-6 text-cyan-100/90">
          Переключатель меняет только отображение. Scheduler продолжает учитывать все активные проекты, общую очередь и общие лимиты.
        </p>
        <p className="mt-3 text-sm text-slate-400" aria-live="polite" data-testid="scope-context">
          Workspace → <span className="font-medium text-slate-200">{scopeLabel}</span>
        </p>
      </SectionCard>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-amber-100/90" role="note">
        Данные демонстрационные и хранятся только в памяти страницы. Внешние действия, persistence и реальные model/workflow execution отсутствуют.
      </div>

      {!view.available ? (
        <SectionCard title={view.title} description="Fail-closed: частичные данные и fallback project не показываются.">
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
            <StatusBadge tone="danger">Недоступно</StatusBadge>
            <div className="mt-4 space-y-3">
              {view.reasons.map((reason) => (
                <dl className="grid min-w-0 gap-2 text-xs sm:grid-cols-2" key={`${reason.source}:${reason.code}:${reason.path}`}>
                  <div><dt className="text-rose-200/70">reason.code</dt><dd className="mt-1 break-all font-mono text-rose-100">{reason.code}</dd></div>
                  <div><dt className="text-rose-200/70">reason.path</dt><dd className="mt-1 break-all font-mono text-rose-100">{reason.path}</dd></div>
                </dl>
              ))}
            </div>
          </div>
        </SectionCard>
      ) : (
        <>
          <section aria-labelledby="operations-totals" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-100" id="operations-totals">{view.totalsLabel}</h2>
              <StatusBadge tone={view.summary.schedulerVerdict === "allow" ? "success" : "danger"}>
                Scheduler {view.summary.schedulerVerdict}
              </StatusBadge>
            </div>
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Проекты" value={view.summary.projects} />
              <Metric label="Queued" value={view.summary.queued} />
              <Metric label="Running" value={view.summary.running} />
              <Metric label="Planned" value={view.summary.planned} />
              <Metric label="Blocked / retained" value={view.summary.blocked} />
            </dl>
          </section>

          <section aria-labelledby="visible-projects" className="min-w-0">
            <h2 className="mb-3 text-base font-semibold text-slate-100" id="visible-projects">Проекты</h2>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              {view.projects.map((project) => (
                <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 p-5" data-project-card={project.projectId} key={project.projectId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-100">{project.name}</h3>
                      <div className="mt-1"><Identifier>{project.projectId}</Identifier></div>
                    </div>
                    <StatusBadge tone={project.status === "active" ? "success" : "warning"}>{statusLabels[project.status]}</StatusBadge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-slate-500">Departments</dt><dd className="mt-1 text-slate-200">{project.departmentsCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">Agents</dt><dd className="mt-1 text-slate-200">{project.agentsCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">Workflows</dt><dd className="mt-1 text-slate-200">{project.workflowsCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">Queued</dt><dd className="mt-1 text-slate-200">{project.queuedCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">Running</dt><dd className="mt-1 text-slate-200">{project.runningCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">Planned</dt><dd className="mt-1 text-slate-200">{project.plannedCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">Blocked</dt><dd className="mt-1 text-slate-200">{project.blockedCount}</dd></div>
                  </dl>
                  <button
                    className="mt-5 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                    onClick={() => selectScope({ kind: "project", projectId: project.projectId })}
                    type="button"
                  >
                    Открыть контекст проекта
                  </button>
                </article>
              ))}
            </div>
          </section>

          <nav aria-label="Operations sections" className="flex min-w-0 flex-wrap gap-2 border-b border-slate-800 pb-3">
            {sections.map((section) => (
              <button
                aria-pressed={activeSection === section.id}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${activeSection === section.id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`}
                data-section={section.id}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0" data-active-section={activeSection}>
            {activeSection === "overview" ? <Overview view={view} /> : null}
            {activeSection === "departments" ? <Departments view={view} /> : null}
            {activeSection === "agents" ? <Bindings kind="Agent" rows={view.agents} /> : null}
            {activeSection === "workflows" ? <Bindings kind="Workflow" rows={view.workflows} /> : null}
            {activeSection === "runs" ? <Runs view={view} /> : null}
          </div>
        </>
      )}
    </div>
  );
}
