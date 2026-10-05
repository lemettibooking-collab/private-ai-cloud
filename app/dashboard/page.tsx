import Link from "next/link";
import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { activeRunStatuses, blockedRunStatuses, ProjectRunTable } from "@/components/domain/owner-console/project-run-table";
import { ProjectStatusBadge } from "@/components/domain/owner-console/run-status";
import { attentionReading } from "@/components/domain/owner-console/bounded-count";
import { attentionStatuses } from "@/components/domain/owner-console/status-tone";
import { TaskTable } from "@/components/domain/owner-console/task-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Instrument, InstrumentStrip } from "@/components/ui/instrument";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerDashboard, type OwnerConsoleDashboardTasks, type OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";
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
function CurrentTasks({ tasks, names, selectedProjectId }: {
  tasks: OwnerConsoleDashboardTasks;
  names: ReadonlyMap<string, string>;
  selectedProjectId: string | null;
}) {
  return (
    <SectionCard
      action={<PanelLink href={projectScopedHref("/tasks", selectedProjectId)}>All tasks →</PanelLink>}
      className="xl:col-span-8"
      count={`${tasks.current.tasks.length}${plus(tasks.current.truncated)}`}
      description={`Active and attention tasks, most recently updated first${tasks.current.truncated ? " (bounded view)" : ""}.`}
      flush
      title="Current tasks"
      tone="active"
    >
      {tasks.current.tasks.length === 0 ? (
        <EmptyState description="No task is in progress or waiting on attention in this scope." title="No current tasks" variant="inline" />
      ) : (
        <TaskTable projectNames={names} selectedProjectId={selectedProjectId} showProject={selectedProjectId === null} tasks={tasks.current.tasks} />
      )}
    </SectionCard>
  );
}

// "What was completed?" — by the TASK's own completed_at.
function RecentlyCompleted({ tasks, names, selectedProjectId }: {
  tasks: OwnerConsoleDashboardTasks;
  names: ReadonlyMap<string, string>;
  selectedProjectId: string | null;
}) {
  const tasksHref = projectScopedHref("/tasks", selectedProjectId);
  return (
    <SectionCard
      className="xl:col-span-4"
      count={tasks.recentlyCompleted.tasks.length}
      description="Tasks with status completed, by task completion time."
      flush
      title="Recently completed"
      tone="success"
    >
      {tasks.recentlyCompleted.tasks.length === 0 ? (
        <EmptyState description="No task has reached status completed in this scope." title="No completed tasks yet" variant="inline" />
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

function RepositoryLine({ project }: { project: OwnerConsoleProject }) {
  return project.repository ? (
    <p className="truncate font-mono text-[11px] text-ink-2">
      {project.repository.url}
      {project.repository.defaultBranch && <span className="text-ink-3"> · {project.repository.defaultBranch}</span>}
    </p>
  ) : (
    <p className="text-[11.5px] text-ink-3">Repository not configured</p>
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
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      {view.state !== "available" && <ContextHeader eyebrow="Mission control" title="Owner attention" />}
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
            <ContextHeader aside={<ScopeBadge project={null} />} eyebrow="Mission control · All Projects" title="Owner attention">
              <p className="mt-0.5 text-[13px] text-ink-3">
                {view.workspace.displayName} · {view.projects.length}{plus(view.projectsTruncated)} registered project{view.projects.length === 1 ? "" : "s"}
              </p>
            </ContextHeader>

            <InstrumentStrip label="Owner attention instruments">
              <Instrument
                detail={view.tasks.current.truncated
                  ? "Waiting on Owner, blocked, recovery or failed · within shown current tasks (bounded view)"
                  : "Waiting on Owner, blocked, recovery or failed · current tasks"}
                label="Needs attention"
                {...attentionReading(needsOwner, view.tasks.current.truncated)}
              />
              <Instrument
                detail="Runtime approvals · workspace-wide"
                label="Pending approvals"
                state={view.pendingApprovals > 0 ? "decide" : "clear"}
                tone={view.pendingApprovals > 0 ? "attention" : "success"}
                value={`${view.pendingApprovals}${plus(view.queueTruncated)}`}
              />
              <Instrument
                detail="High or critical pending approvals"
                label="High / critical"
                state={view.highRiskApprovals > 0 ? "risk" : undefined}
                tone={view.highRiskApprovals > 0 ? "danger" : "neutral"}
                value={view.highRiskApprovals}
              />
              <Instrument
                detail="Active or needing attention, all projects"
                label="Current tasks"
                tone={view.tasks.current.tasks.length > 0 ? "active" : "neutral"}
                value={`${view.tasks.current.tasks.length}${plus(view.tasks.current.truncated)}`}
              />
              <Instrument
                detail={`${blockedRuns} blocked or failed · recent project runs`}
                label="Active runs"
                tone={activeRuns > 0 ? "active" : "neutral"}
                value={activeRuns}
              />
              <Instrument
                detail={view.projectsTruncated ? "First 100 registered projects" : "Registered in this workspace"}
                label="Projects"
                value={`${view.projects.length}${plus(view.projectsTruncated)}`}
              />
            </InstrumentStrip>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <CurrentTasks names={names} selectedProjectId={null} tasks={view.tasks} />
              <SectionCard
                action={<PanelLink href={projectScopedHref("/approvals", null)}>All approvals →</PanelLink>}
                className="xl:col-span-4"
                count={`${view.pendingApprovals}${plus(view.queueTruncated)}`}
                description="Pending runtime approvals across all projects, highest risk first. Read-only."
                flush
                title="Owner decisions"
                tone="attention"
              >
                {view.approvals.length === 0 ? (
                  <EmptyState description="There are no pending runtime approvals in this workspace." title="No decision is pending" variant="inline" />
                ) : (
                  <>
                    <ApprovalQueue approvals={view.approvals.slice(0, 8)} compact />
                    {view.approvals.length > 8 && (
                      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                        +{view.approvals.length - 8} more in <Link className="text-accent hover:underline" href="/approvals">Approvals</Link>
                      </p>
                    )}
                  </>
                )}
              </SectionCard>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <SectionCard
                action={<PanelLink href={projectScopedHref("/runs", null)}>All runs →</PanelLink>}
                className="xl:col-span-8"
                count={view.aggregate.runs.length}
                description={`Run attempts across all projects, newest first (up to ${view.aggregate.runsPerProjectLimit} per project).`}
                flush
                title="Recent runs"
              >
                {view.aggregate.runs.length === 0 ? (
                  <EmptyState
                    description={view.projects.length === 0 ? "Runs appear once projects are registered." : "The registered projects have no runs yet."}
                    title={view.projects.length === 0 ? "No projects registered" : "No runs yet"}
                    variant="inline"
                  />
                ) : (
                  <ProjectRunTable projectNames={names} runs={view.aggregate.runs} selectedProjectId={null} showProject />
                )}
              </SectionCard>
              <RecentlyCompleted names={names} selectedProjectId={null} tasks={view.tasks} />
            </div>

            <SectionCard className="mt-4" count={view.projects.length} description="Registered projects and their activity in recent runs. Select one to scope the console." flush title="Projects">
              {view.projects.length === 0 ? (
                <EmptyState description="No projects are registered in this workspace yet." title="No projects registered" variant="inline" />
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
                        <p className="mt-2 font-mono text-[11px] text-ink-3">
                          {!item ? "not in this view" : !item.available ? "runs unavailable" : (
                            <>
                              <span className={item.activeRuns > 0 ? "text-run" : ""}>{item.activeRuns} active</span>
                              {" · "}
                              <span className={item.blockedRuns > 0 ? "text-bad" : ""}>{item.blockedRuns} blocked</span>
                              {" · "}{item.recentRuns}{plus(item.truncated)} recent
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
                <span className="pac-label mr-2">Data coverage</span>
                Runs come from the registered projects ({view.aggregate.projectsConsidered} read, up to {view.aggregate.runsPerProjectLimit} newest runs each), not complete run history.
                {view.aggregate.projectsNotConsidered > 0 && ` ${view.aggregate.projectsNotConsidered} more project(s) are not included in this view.`}
                {view.aggregate.projectsUnavailable.length > 0 && ` Runs unavailable for: ${view.aggregate.projectsUnavailable.join(", ")}.`}
                {" "}Tasks are factual Owner objectives; runs are their execution attempts.
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
              eyebrow="Mission control · Project"
              title={<>
                <span className="truncate">{project.displayName}</span>
                <span className="font-mono text-xs font-normal text-ink-3">{project.projectId}</span>
                <ProjectStatusBadge status={project.status} />
              </>}
            >
              <div className="mt-1"><RepositoryLine project={project} /></div>
            </ContextHeader>

            <InstrumentStrip label="Project attention instruments">
              <Instrument
                detail={view.tasks.current.truncated
                  ? "Waiting on Owner, blocked, recovery or failed · within shown current tasks (bounded view)"
                  : "Waiting on Owner, blocked, recovery or failed"}
                label="Needs attention"
                {...attentionReading(needsOwner, view.tasks.current.truncated)}
              />
              <Instrument
                detail="This project only"
                label="Pending approvals"
                state={approvals.pendingApprovals > 0 ? "decide" : "clear"}
                tone={approvals.pendingApprovals > 0 ? "attention" : "success"}
                value={approvals.pendingApprovals}
              />
              <Instrument
                detail="High or critical, this project"
                label="High / critical"
                state={approvals.highRiskApprovals > 0 ? "risk" : undefined}
                tone={approvals.highRiskApprovals > 0 ? "danger" : "neutral"}
                value={approvals.highRiskApprovals}
              />
              <Instrument
                detail="Active or needing attention"
                label="Current tasks"
                tone={view.tasks.current.tasks.length > 0 ? "active" : "neutral"}
                value={`${view.tasks.current.tasks.length}${plus(view.tasks.current.truncated)}`}
              />
              <Instrument detail="Queued, running, waiting or in review" label="Active runs" tone={active > 0 ? "active" : "neutral"} value={active} />
              <Instrument
                detail={view.runsTruncated ? `Blocked or failed · newest ${view.runsLimit} runs` : "Blocked or failed runs"}
                label="Blocked runs"
                state={blocked > 0 ? "failed" : undefined}
                tone={blocked > 0 ? "danger" : "neutral"}
                value={blocked}
              />
            </InstrumentStrip>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <CurrentTasks names={names} selectedProjectId={project.projectId} tasks={view.tasks} />
              <SectionCard
                action={<PanelLink href={projectScopedHref("/approvals", project.projectId)}>Project approvals →</PanelLink>}
                className="xl:col-span-4"
                count={approvals.pendingApprovals}
                description="Approvals whose run factually belongs to this project. Read-only."
                flush
                title="Owner decisions"
                tone="attention"
              >
                {approvals.approvals.length === 0 ? (
                  <EmptyState description="No pending runtime approval belongs to this project." title="No decision is pending" variant="inline" />
                ) : (
                  <ApprovalQueue approvals={approvals.approvals.slice(0, 8)} compact selectedProjectId={project.projectId} />
                )}
              </SectionCard>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <SectionCard
                action={<PanelLink href={projectScopedHref("/runs", project.projectId)}>Project runs →</PanelLink>}
                className="xl:col-span-8"
                count={`${view.runs.length}${plus(view.runsTruncated)}`}
                description="Run attempts of this project, newest first."
                flush
                title="Project runs"
              >
                {view.runs.length === 0 ? (
                  <EmptyState description="No run has been recorded for this project." title="No runs yet" variant="inline" />
                ) : (
                  <ProjectRunTable runs={view.runs.slice(0, 15)} selectedProjectId={project.projectId} showProject={false} />
                )}
              </SectionCard>
              <RecentlyCompleted names={names} selectedProjectId={project.projectId} tasks={view.tasks} />
            </div>

            {approvals.unresolvedApprovals > 0 && (
              <div className="pac-inset mt-4 !border-warn/35 px-4 py-2.5">
                <p className="text-[11.5px] leading-5 text-ink-3">
                  <span className="pac-label mr-2 !text-warn">Unresolved approvals</span>
                  {approvals.unresolvedApprovals} workspace approval(s) could not be attributed to a project in this view and are not counted here.
                  See <Link className="text-accent hover:underline" href="/approvals">All Projects approvals</Link>.
                </p>
              </div>
            )}
            <p className="mt-3 text-[11px] text-ink-3">The top-bar approval count stays workspace-wide (all projects).</p>
          </>
        );
      })()}
    </AppShell>
  );
}
