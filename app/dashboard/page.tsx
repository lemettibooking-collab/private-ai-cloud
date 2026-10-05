import Link from "next/link";
import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { activeRunStatuses, blockedRunStatuses, ProjectRunTable } from "@/components/domain/owner-console/project-run-table";
import { ProjectStatusBadge } from "@/components/domain/owner-console/run-status";
import { attentionReading, withStateLabel } from "@/components/domain/owner-console/bounded-count";
import { attentionStatuses } from "@/components/domain/owner-console/status-tone";
import { TaskTable } from "@/components/domain/owner-console/task-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Instrument, InstrumentStrip } from "@/components/ui/instrument";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerDashboard, type OwnerConsoleDashboardTasks, type OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";
import type { Messages } from "@/lib/i18n/messages";
import { projectScopedHref } from "@/lib/projects/project-context";

type DashboardPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// Hierarchy (AI-038.5): context → Owner attention instruments → current tasks + Owner decisions →
// run attempts + recently completed → secondary detail. Every number is a count over data the
// dashboard read already returned; nothing is synthesized.

const plus = (truncated: boolean) => (truncated ? "+" : "");

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="text-[11.5px] text-accent hover:underline" href={href}>{children}</Link>;
}

// "What is being worked on?" — factual ProjectTasks only (never inferred from runs).
function CurrentTasks({ tasks, names, selectedProjectId, t }: {
  tasks: OwnerConsoleDashboardTasks;
  names: ReadonlyMap<string, string>;
  selectedProjectId: string | null;
  t: Messages;
}) {
  return (
    <SectionCard
      action={<PanelLink href={projectScopedHref("/tasks", selectedProjectId)}>{t.dashboard.allTasks}</PanelLink>}
      className="xl:col-span-8"
      count={`${tasks.current.tasks.length}${plus(tasks.current.truncated)}`}
      description={tasks.current.truncated ? t.dashboard.currentTasksDescriptionBounded : t.dashboard.currentTasksDescription}
      flush
      title={t.dashboard.currentTasks}
      tone="active"
    >
      {tasks.current.tasks.length === 0 ? (
        <EmptyState description={t.dashboard.noCurrentTasksBody} title={t.dashboard.noCurrentTasksTitle} variant="inline" />
      ) : (
        <TaskTable projectNames={names} selectedProjectId={selectedProjectId} showProject={selectedProjectId === null} tasks={tasks.current.tasks} />
      )}
    </SectionCard>
  );
}

// "What was completed?" — by the TASK's own completed_at.
function RecentlyCompleted({ tasks, names, selectedProjectId, t }: {
  tasks: OwnerConsoleDashboardTasks;
  names: ReadonlyMap<string, string>;
  selectedProjectId: string | null;
  t: Messages;
}) {
  const tasksHref = projectScopedHref("/tasks", selectedProjectId);
  return (
    <SectionCard
      className="xl:col-span-4"
      count={tasks.recentlyCompleted.tasks.length}
      description={t.dashboard.recentlyCompletedDescription}
      flush
      title={t.dashboard.recentlyCompleted}
      tone="success"
    >
      {tasks.recentlyCompleted.tasks.length === 0 ? (
        <EmptyState description={t.dashboard.noCompletedBody} title={t.dashboard.noCompletedTitle} variant="inline" />
      ) : (
        <ul className="divide-y divide-line">
          {tasks.recentlyCompleted.tasks.map((task) => (
            <li key={task.taskId}>
              <Link
                className="flex items-baseline justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-panel-2"
                href={`/tasks/${encodeURIComponent(task.taskId)}${tasksHref.slice("/tasks".length)}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-ink">{task.title}</span>
                  <span className="pac-id block truncate">
                    {selectedProjectId === null && <>{names.get(task.projectId) ?? task.projectId} · </>}{task.taskId}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{formatTimestamp(task.completedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function RepositoryLine({ project, t }: { project: OwnerConsoleProject; t: Messages }) {
  return project.repository ? (
    <p className="truncate font-mono text-[11px] text-ink-2">
      {project.repository.url}
      {project.repository.defaultBranch && <span className="text-ink-3"> · {project.repository.defaultBranch}</span>}
    </p>
  ) : (
    <p className="text-[11.5px] text-ink-3">{t.dashboard.repositoryNotConfigured}</p>
  );
}

function ContextHeader({ eyebrow, title, children, aside }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0">
        <p className="pac-label !text-accent">{eyebrow}</p>
        <h1 className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[20px] font-semibold leading-7 tracking-tight text-ink">{title}</h1>
        {children}
      </div>
      {aside}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const view = await loadOwnerDashboard((await searchParams).project);
  const { t } = await getI18n();
  const d = t.dashboard;
  const states = t.instrumentState;
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      {view.state !== "available" && <ContextHeader eyebrow={d.missionControl} title={d.ownerAttention} />}
      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/dashboard" />}

      {view.state === "available" && view.mode === "all" && (() => {
        const names = new Map(view.projects.map((project) => [project.projectId, project.displayName]));
        const activity = new Map(view.aggregate.byProject.map((item) => [item.projectId, item]));
        const activeRuns = view.aggregate.byProject.reduce((sum, item) => sum + item.activeRuns, 0);
        const blockedRuns = view.aggregate.byProject.reduce((sum, item) => sum + item.blockedRuns, 0);
        const needsOwner = view.tasks.current.tasks.filter((task) => attentionStatuses.has(task.status)).length;
        const coverageGap = view.aggregate.projectsUnavailable.length > 0 || view.aggregate.projectsNotConsidered > 0;
        return (
          <>
            <ContextHeader aside={<ScopeBadge project={null} />} eyebrow={d.missionControlAll} title={d.ownerAttention}>
              <p className="mt-0.5 text-[13px] text-ink-3">
                {format(d.workspaceSummary, { workspace: view.workspace.displayName, count: `${view.projects.length}${plus(view.projectsTruncated)}` })}
              </p>
            </ContextHeader>

            <InstrumentStrip label={d.instrumentsAll}>
              <Instrument
                detail={view.tasks.current.truncated ? d.needsAttentionDetailBounded : d.needsAttentionDetail}
                label={d.needsAttention}
                {...withStateLabel(attentionReading(needsOwner, view.tasks.current.truncated), states)}
              />
              <Instrument
                detail={d.pendingApprovalsWorkspace}
                label={d.pendingApprovals}
                state={view.pendingApprovals > 0 ? states.decide : states.clear}
                tone={view.pendingApprovals > 0 ? "attention" : "success"}
                value={`${view.pendingApprovals}${plus(view.queueTruncated)}`}
              />
              <Instrument
                detail={d.highCriticalDetail}
                label={d.highCritical}
                state={view.highRiskApprovals > 0 ? states.risk : undefined}
                tone={view.highRiskApprovals > 0 ? "danger" : "neutral"}
                value={view.highRiskApprovals}
              />
              <Instrument
                detail={d.currentTasksDetailAll}
                label={d.currentTasks}
                tone={view.tasks.current.tasks.length > 0 ? "active" : "neutral"}
                value={`${view.tasks.current.tasks.length}${plus(view.tasks.current.truncated)}`}
              />
              <Instrument
                detail={format(d.activeRunsDetailAll, { blocked: blockedRuns })}
                label={d.activeRuns}
                tone={activeRuns > 0 ? "active" : "neutral"}
                value={activeRuns}
              />
              <Instrument
                detail={view.projectsTruncated ? d.projectsDetailFirst100 : d.projectsDetail}
                label={d.projects}
                value={`${view.projects.length}${plus(view.projectsTruncated)}`}
              />
            </InstrumentStrip>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <CurrentTasks names={names} selectedProjectId={null} t={t} tasks={view.tasks} />
              <SectionCard
                action={<PanelLink href={projectScopedHref("/approvals", null)}>{d.allApprovals}</PanelLink>}
                className="xl:col-span-4"
                count={`${view.pendingApprovals}${plus(view.queueTruncated)}`}
                description={d.ownerDecisionsDescriptionAll}
                flush
                title={d.ownerDecisions}
                tone="attention"
              >
                {view.approvals.length === 0 ? (
                  <EmptyState description={d.noDecisionBodyAll} title={d.noDecisionTitle} variant="inline" />
                ) : (
                  <>
                    <ApprovalQueue approvals={view.approvals.slice(0, 8)} compact />
                    {view.approvals.length > 8 && (
                      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                        {format(d.moreApprovals, { count: view.approvals.length - 8 })} <Link className="text-accent hover:underline" href="/approvals">{d.approvalsLink}</Link>
                      </p>
                    )}
                  </>
                )}
              </SectionCard>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <SectionCard
                action={<PanelLink href={projectScopedHref("/runs", null)}>{d.allRuns}</PanelLink>}
                className="xl:col-span-8"
                count={view.aggregate.runs.length}
                description={format(d.recentRunsDescription, { limit: view.aggregate.runsPerProjectLimit })}
                flush
                title={d.recentRuns}
              >
                {view.aggregate.runs.length === 0 ? (
                  <EmptyState
                    description={view.projects.length === 0 ? d.noProjectsRunsBody : d.noRunsBodyAll}
                    title={view.projects.length === 0 ? d.noProjectsTitle : d.noRunsTitle}
                    variant="inline"
                  />
                ) : (
                  <ProjectRunTable projectNames={names} runs={view.aggregate.runs} selectedProjectId={null} showProject />
                )}
              </SectionCard>
              <RecentlyCompleted names={names} selectedProjectId={null} t={t} tasks={view.tasks} />
            </div>

            <SectionCard className="mt-4" count={view.projects.length} description={d.projectsPanelDescription} flush title={d.projects}>
              {view.projects.length === 0 ? (
                <EmptyState description={d.noProjectsBody} title={d.noProjectsTitle} variant="inline" />
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 [&>*]:border-b [&>*]:border-r [&>*]:border-line">
                  {view.projects.map((project) => {
                    const item = activity.get(project.projectId);
                    return (
                      <Link className="group px-4 py-3 transition-colors hover:bg-panel-2" href={projectScopedHref("/dashboard", project.projectId)} key={project.projectId}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-ink group-hover:text-accent">{project.displayName}</span>
                          <ProjectStatusBadge status={project.status} />
                        </div>
                        <p className="pac-id">{project.projectId}</p>
                        <p className="mt-2 text-[11.5px] text-ink-3">
                          {!item ? d.notInView : !item.available ? d.runsUnavailable : (
                            <>
                              <span className={item.activeRuns > 0 ? "text-run" : ""}>{format(d.activityActive, { count: item.activeRuns })}</span>
                              {" · "}
                              <span className={item.blockedRuns > 0 ? "text-bad" : ""}>{format(d.activityBlocked, { count: item.blockedRuns })}</span>
                              {" · "}{format(d.activityRecent, { count: `${item.recentRuns}${plus(item.truncated)}` })}
                            </>
                          )}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <div className={`pac-inset mt-4 px-4 py-2.5 ${coverageGap ? "!border-warn/35" : ""}`}>
              <p className="text-[11.5px] leading-5 text-ink-3">
                <span className="pac-label mr-2">{d.dataCoverage}</span>
                {format(d.coverageBody, { considered: view.aggregate.projectsConsidered, limit: view.aggregate.runsPerProjectLimit })}
                {view.aggregate.projectsNotConsidered > 0 && ` ${format(d.coverageNotConsidered, { count: view.aggregate.projectsNotConsidered })}`}
                {view.aggregate.projectsUnavailable.length > 0 && ` ${format(d.coverageUnavailable, { projects: view.aggregate.projectsUnavailable.join(", ") })}`}
                {" "}{d.coverageTasksNote}
              </p>
            </div>
          </>
        );
      })()}

      {view.state === "available" && view.mode === "project" && (() => {
        const project = view.scope.project;
        const approvals = view.projectApprovals;
        const active = view.runs.filter((run) => activeRunStatuses.has(run.status)).length;
        const blocked = view.runs.filter((run) => blockedRunStatuses.has(run.status)).length;
        const needsOwner = view.tasks.current.tasks.filter((task) => attentionStatuses.has(task.status)).length;
        const names = new Map([[project.projectId, project.displayName]]);
        return (
          <>
            <ContextHeader
              aside={<ScopeBadge project={project} />}
              eyebrow={d.missionControlProject}
              title={<>
                <span className="truncate">{project.displayName}</span>
                <span className="font-mono text-xs font-normal text-ink-3">{project.projectId}</span>
                <ProjectStatusBadge status={project.status} />
              </>}
            >
              <div className="mt-1"><RepositoryLine project={project} t={t} /></div>
            </ContextHeader>

            <InstrumentStrip label={d.instrumentsProject}>
              <Instrument
                detail={view.tasks.current.truncated ? d.needsAttentionDetailBounded : d.needsAttentionDetailProject}
                label={d.needsAttention}
                {...withStateLabel(attentionReading(needsOwner, view.tasks.current.truncated), states)}
              />
              <Instrument
                detail={d.pendingApprovalsProject}
                label={d.pendingApprovals}
                state={approvals.pendingApprovals > 0 ? states.decide : states.clear}
                tone={approvals.pendingApprovals > 0 ? "attention" : "success"}
                value={approvals.pendingApprovals}
              />
              <Instrument
                detail={d.highCriticalProject}
                label={d.highCritical}
                state={approvals.highRiskApprovals > 0 ? states.risk : undefined}
                tone={approvals.highRiskApprovals > 0 ? "danger" : "neutral"}
                value={approvals.highRiskApprovals}
              />
              <Instrument
                detail={d.currentTasksDetailProject}
                label={d.currentTasks}
                tone={view.tasks.current.tasks.length > 0 ? "active" : "neutral"}
                value={`${view.tasks.current.tasks.length}${plus(view.tasks.current.truncated)}`}
              />
              <Instrument detail={d.activeRunsDetailProject} label={d.activeRuns} tone={active > 0 ? "active" : "neutral"} value={active} />
              <Instrument
                detail={view.runsTruncated ? format(d.blockedRunsDetailBounded, { limit: view.runsLimit }) : d.blockedRunsDetail}
                label={d.blockedRuns}
                state={blocked > 0 ? states.failed : undefined}
                tone={blocked > 0 ? "danger" : "neutral"}
                value={blocked}
              />
            </InstrumentStrip>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <CurrentTasks names={names} selectedProjectId={project.projectId} t={t} tasks={view.tasks} />
              <SectionCard
                action={<PanelLink href={projectScopedHref("/approvals", project.projectId)}>{d.projectApprovalsLink}</PanelLink>}
                className="xl:col-span-4"
                count={approvals.pendingApprovals}
                description={d.ownerDecisionsDescriptionProject}
                flush
                title={d.ownerDecisions}
                tone="attention"
              >
                {approvals.approvals.length === 0 ? (
                  <EmptyState description={d.noDecisionBodyProject} title={d.noDecisionTitle} variant="inline" />
                ) : (
                  <ApprovalQueue approvals={approvals.approvals.slice(0, 8)} compact selectedProjectId={project.projectId} />
                )}
              </SectionCard>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <SectionCard
                action={<PanelLink href={projectScopedHref("/runs", project.projectId)}>{d.projectRunsLink}</PanelLink>}
                className="xl:col-span-8"
                count={`${view.runs.length}${plus(view.runsTruncated)}`}
                description={d.projectRunsDescription}
                flush
                title={d.projectRuns}
              >
                {view.runs.length === 0 ? (
                  <EmptyState description={d.noProjectRunsBody} title={d.noRunsTitle} variant="inline" />
                ) : (
                  <ProjectRunTable runs={view.runs.slice(0, 15)} selectedProjectId={project.projectId} showProject={false} />
                )}
              </SectionCard>
              <RecentlyCompleted names={names} selectedProjectId={project.projectId} t={t} tasks={view.tasks} />
            </div>

            {approvals.unresolvedApprovals > 0 && (
              <div className="pac-inset mt-4 !border-warn/35 px-4 py-2.5">
                <p className="text-[11.5px] leading-5 text-ink-3">
                  <span className="pac-label mr-2 !text-warn">{d.unresolvedApprovals}</span>
                  {format(d.unresolvedBody, { count: approvals.unresolvedApprovals })}{" "}
                  {d.unresolvedSee} <Link className="text-accent hover:underline" href="/approvals">{d.allProjectsApprovals}</Link>.
                </p>
              </div>
            )}
            <p className="mt-3 text-[11px] text-ink-3">{d.bellNote}</p>
          </>
        );
      })()}
    </AppShell>
  );
}
