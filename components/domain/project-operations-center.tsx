"use client";

import { createContext, useContext, useMemo, useState } from "react";

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
import { format } from "@/lib/i18n/locale";
import type { PrototypePages } from "@/lib/i18n/prototype-pages";
import type { StatusTone } from "@/types/app";

// AI-038.6 L10N-1: the English UI remnants of this Russian-native page are localized; the labels come
// from the server dictionary (lib/i18n/prototype-pages) through the page. Technical identifiers
// (reason.code, projectId, bindingId, maxConcurrentRuns…) stay as they are.
type OperationsLabels = PrototypePages["operations"];
const LabelsContext = createContext<OperationsLabels | null>(null);
// Owner-facing blocked message by canonical reason code (the code itself is shown under technical data).
function ownerMessage(l: OperationsLabels, code: string): string {
  return (l.ownerMessages as Readonly<Record<string, string>>)[code] ?? l.ownerMessages.fallback;
}

function useLabels(): OperationsLabels {
  const labels = useContext(LabelsContext);
  if (!labels) throw new Error("Operations labels are missing.");
  return labels;
}

const sections = [
  { id: "overview" },
  { id: "departments" },
  { id: "agents" },
  { id: "workflows" },
  { id: "runs" },
] as const;

type SectionId = (typeof sections)[number]["id"];
type RunRow =
  | ProjectOperationsQueueRow
  | ProjectOperationsRunningRow
  | ProjectOperationsDispatchRow;

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
  const l = useLabels();
  const kindLabel = kind === "Agent" ? l.agent : l.workflow;
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
          {kindLabel} · {l.statuses[row.status as keyof OperationsLabels["statuses"]] ?? row.status}
        </StatusBadge>
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">{l.binding}</dt>
          <dd className="mt-1"><Identifier>{row.bindingId}</Identifier></dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{l.concurrencyCeiling}</dt>
          <dd className="mt-1 text-slate-200">{row.effectiveMaxConcurrentRuns}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-slate-500">{l.modelProfiles}</dt>
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
  const l = useLabels();
  const runLabel = l.runStatus[row.factualStatus];
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
          <StatusBadge tone={tone}>{runLabel}</StatusBadge>
        </div>
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">{row.bindingKind === "agent" ? l.agent : l.workflow}</dt>
          <dd className="mt-1 break-all text-slate-200">{row.subjectId}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">{l.binding}</dt>
          <dd className="mt-1"><Identifier>{row.bindingId}</Identifier></dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-slate-500">{l.modelProfile}</dt>
          <dd className="mt-1"><Identifier>{row.modelProfileId}</Identifier></dd>
        </div>
      </dl>
    </article>
  );
}

function Overview({ view }: Readonly<{ view: AvailableProjectOperationsView }>) {
  const l = useLabels();
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <SectionCard
        title={l.schedulerDecision}
        description={l.schedulerDecisionDescription}
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <Metric label={l.verdict} value={view.summary.schedulerVerdict} />
          <Metric label={l.status} value={view.summary.schedulerStatus} />
          <Metric
            label={l.lastCursor}
            value={view.summary.lastRoundRobinProjectId ?? l.notSet}
          />
          <Metric
            label={l.nextCursor}
            value={view.summary.nextRoundRobinProjectId ?? l.notSet}
          />
        </dl>
      </SectionCard>
      <SectionCard
        title={l.boundariesTitle}
        description={l.hierarchy}
      >
        <ul className="space-y-3 text-sm leading-6 text-slate-300">
          <li>{l.scopeNote}</li>
          <li>{l.rowsNote}</li>
          <li>{l.blockedNote}</li>
          <li>{l.noActionsNote}</li>
        </ul>
      </SectionCard>
    </div>
  );
}

function Departments({ view }: Readonly<{ view: AvailableProjectOperationsView }>) {
  const l = useLabels();
  if (view.departments.length === 0) return <EmptyState>{l.noDepartments}</EmptyState>;
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
              {l.statuses[row.status as keyof OperationsLabels["statuses"]] ?? row.status}
            </StatusBadge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">{l.code}</dt><dd className="mt-1 text-slate-200">{row.code}</dd></div>
            <div><dt className="text-xs text-slate-500">{l.mode}</dt><dd className="mt-1 break-words text-slate-200">{row.operatingMode}</dd></div>
            <div><dt className="text-xs text-slate-500">{l.agents}</dt><dd className="mt-1 text-slate-200">{row.agentsCount}</dd></div>
            <div><dt className="text-xs text-slate-500">{l.workflows}</dt><dd className="mt-1 text-slate-200">{row.workflowsCount}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-slate-500">{l.effectiveMax}</dt><dd className="mt-1 text-slate-200">{row.effectiveMaxConcurrentRuns}</dd></div>
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
  const l = useLabels();
  if (rows.length === 0) return <EmptyState>{format(l.noBindings, { kind: kind === "Agent" ? l.agent : l.workflow })}</EmptyState>;
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
  const l = useLabels();
  return (
    <div className="min-w-0 space-y-6">
      <SectionCard title={l.runningNow} description={l.runningDescription}>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {view.running.length > 0
            ? view.running.map((row) => <RunCard key={row.runId} row={row} tone="success" />)
            : <EmptyState>{l.noRunning}</EmptyState>}
        </div>
      </SectionCard>
      <SectionCard title={l.plannedDispatches} description={l.plannedDescription}>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {view.dispatches.length > 0
            ? view.dispatches.map((row) => <RunCard key={row.requestId} row={row} tone="info" />)
            : <EmptyState>{l.noPlanned}</EmptyState>}
        </div>
      </SectionCard>
      <SectionCard title={l.queuedRetained} description={l.queuedDescription}>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {retained.length > 0
            ? retained.map((row) => <RunCard key={row.requestId} row={row} tone="warning" />)
            : <EmptyState>{l.noRetained}</EmptyState>}
        </div>
      </SectionCard>
      <SectionCard title={l.blockedReasons} description={l.blockedDescription}>
        <div className="min-w-0 space-y-3">
          {view.blocked.length > 0
            ? view.blocked.map((row: ProjectOperationsBlockedRow) => (
                <article className="min-w-0 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4" key={row.requestId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">{row.projectName} · {row.departmentName}</p>
                      <div className="mt-1"><Identifier>{row.requestId}</Identifier></div>
                    </div>
                    <StatusBadge tone="warning">{l.remainsQueued}</StatusBadge>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-100/90">
                    {row.reasons.map((reason) => <li key={`${reason.code}:${reason.path}`}>{ownerMessage(l, reason.code)}</li>)}
                  </ul>
                  <details className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40">
                      {l.technicalData}
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
            : <EmptyState>{l.noBlocked}</EmptyState>}
        </div>
      </SectionCard>
    </div>
  );
}

export function ProjectOperationsCenter({ labels }: Readonly<{ labels: OperationsLabels }>) {
  return (
    <LabelsContext.Provider value={labels}>
      <OperationsCenterBody />
    </LabelsContext.Provider>
  );
}

function OperationsCenterBody() {
  const l = useLabels();
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
      ? l.allProjects
      : scopeProjects.find((project) => project.projectId === scope.projectId)?.name ?? l.unavailableProject;

  function selectScope(nextScope: ProjectOperationsScope) {
    setScope(nextScope);
    setActiveSection("overview");
  }

  return (
    <div className="min-w-0 space-y-6" data-testid="project-operations-center">
      <SectionCard
        title={l.projectScope}
        description={l.scopeDescription}
      >
        <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label={l.projectScope}>
          <button
            aria-pressed={scope.kind === "workspace"}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${scope.kind === "workspace" ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100" : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600"}`}
            data-scope="workspace"
            onClick={() => selectScope({ kind: "workspace" })}
            type="button"
          >
            {l.allProjects}
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
          {l.scopeSwitchNote}
        </p>
        <p className="mt-3 text-sm text-slate-400" aria-live="polite" data-testid="scope-context">
          {l.scopeRoot} → <span className="font-medium text-slate-200">{scopeLabel}</span>
        </p>
      </SectionCard>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-amber-100/90" role="note">
        {l.demoNote}
      </div>

      {!view.available ? (
        <SectionCard title={l.unavailableTitles[view.title as keyof OperationsLabels["unavailableTitles"]] ?? view.title} description={l.failClosed}>
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
            <StatusBadge tone="danger">{l.unavailable}</StatusBadge>
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
              <h2 className="text-base font-semibold text-slate-100" id="operations-totals">{view.totalsLabel === "Workspace totals" ? l.workspaceTotals : l.projectTotals}</h2>
              <StatusBadge tone={view.summary.schedulerVerdict === "allow" ? "success" : "danger"}>
                {format(l.schedulerBadge, { verdict: view.summary.schedulerVerdict })}
              </StatusBadge>
            </div>
            <dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label={l.projects} value={view.summary.projects} />
              <Metric label={l.queued} value={view.summary.queued} />
              <Metric label={l.running} value={view.summary.running} />
              <Metric label={l.planned} value={view.summary.planned} />
              <Metric label={l.blockedRetained} value={view.summary.blocked} />
            </dl>
          </section>

          <section aria-labelledby="visible-projects" className="min-w-0">
            <h2 className="mb-3 text-base font-semibold text-slate-100" id="visible-projects">{l.projects}</h2>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              {view.projects.map((project) => (
                <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/70 p-5" data-project-card={project.projectId} key={project.projectId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-100">{project.name}</h3>
                      <div className="mt-1"><Identifier>{project.projectId}</Identifier></div>
                    </div>
                    <StatusBadge tone={project.status === "active" ? "success" : "warning"}>{l.statuses[project.status as keyof OperationsLabels["statuses"]] ?? project.status}</StatusBadge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-slate-500">{l.departments}</dt><dd className="mt-1 text-slate-200">{project.departmentsCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">{l.agents}</dt><dd className="mt-1 text-slate-200">{project.agentsCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">{l.workflows}</dt><dd className="mt-1 text-slate-200">{project.workflowsCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">{l.queued}</dt><dd className="mt-1 text-slate-200">{project.queuedCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">{l.running}</dt><dd className="mt-1 text-slate-200">{project.runningCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">{l.planned}</dt><dd className="mt-1 text-slate-200">{project.plannedCount}</dd></div>
                    <div><dt className="text-xs text-slate-500">{l.blocked}</dt><dd className="mt-1 text-slate-200">{project.blockedCount}</dd></div>
                  </dl>
                  <button
                    className="mt-5 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                    onClick={() => selectScope({ kind: "project", projectId: project.projectId })}
                    type="button"
                  >
                    {l.openProjectContext}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <nav aria-label={l.sectionsLabel} className="flex min-w-0 flex-wrap gap-2 border-b border-slate-800 pb-3">
            {sections.map((section) => (
              <button
                aria-pressed={activeSection === section.id}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${activeSection === section.id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`}
                data-section={section.id}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                {l.sections[section.id]}
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
