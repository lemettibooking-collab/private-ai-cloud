import Link from "next/link";
import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { activeRunStatuses, blockedRunStatuses, ProjectRunTable } from "@/components/domain/owner-console/project-run-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { loadOwnerDashboard, type OwnerConsoleProject } from "@/lib/composition/owner-console-read.server";
import { projectScopedHref } from "@/lib/projects/project-context";

type DashboardPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

type MetricProps = { label: string; value: React.ReactNode; detail: string; tone?: "warn" | "bad" | "ok" | "run" | "neutral" };
const metricTone = { warn: "text-warn", bad: "text-bad", ok: "text-ok", run: "text-run", neutral: "text-ink" } as const;

function Metric({ label, value, detail, tone = "neutral" }: MetricProps) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <p className="pac-label">{label}</p>
      <p className={`mt-2 font-mono text-[28px] font-medium leading-none tracking-tight ${metricTone[tone]}`}>{value}</p>
      <p className="mt-2 truncate text-[11.5px] text-ink-3">{detail}</p>
    </div>
  );
}

function MetricStrip({ children, columns }: { children: React.ReactNode; columns: 4 | 5 }) {
  return (
    <div className={`grid grid-cols-2 divide-line rounded-pac border border-line bg-panel max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(n+3)]:border-line lg:divide-x ${
      columns === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
      {children}
    </div>
  );
}

function RepositoryLine({ project }: { project: OwnerConsoleProject }) {
  return project.repository ? (
    <p className="font-mono text-xs text-ink-2">
      {project.repository.url}
      {project.repository.defaultBranch && <span className="text-ink-3"> · {project.repository.defaultBranch}</span>}
    </p>
  ) : (
    <p className="text-xs text-ink-3">Repository not configured</p>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const view = await loadOwnerDashboard((await searchParams).project);
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pac-label !text-accent">Owner attention</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {selected ? selected.displayName : "Mission control"}
          </h1>
        </div>
        {view.state === "available" && <ScopeBadge project={selected} />}
      </div>

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/dashboard" />}

      {view.state === "available" && view.mode === "all" && (() => {
        const names = new Map(view.projects.map((project) => [project.projectId, project.displayName]));
        const activity = new Map(view.aggregate.byProject.map((item) => [item.projectId, item]));
        const activeRuns = view.aggregate.byProject.reduce((sum, item) => sum + item.activeRuns, 0);
        const blockedRuns = view.aggregate.byProject.reduce((sum, item) => sum + item.blockedRuns, 0);
        const coverageGap = view.aggregate.projectsUnavailable.length > 0 || view.aggregate.projectsNotConsidered > 0;
        return (
          <>
            <MetricStrip columns={4}>
              <Metric detail={view.projectsTruncated ? "First 100 registered projects" : "Registered in this workspace"} label="Projects" value={`${view.projects.length}${view.projectsTruncated ? "+" : ""}`} />
              <Metric
                detail={view.queueTruncated ? "Workspace queue shows the first 100" : "Workspace-wide, all projects"}
                label="Pending approvals"
                tone={view.pendingApprovals > 0 ? "warn" : "ok"}
                value={`${view.pendingApprovals}${view.queueTruncated ? "+" : ""}`}
              />
              <Metric detail="High or critical risk, workspace-wide" label="High / critical" tone={view.highRiskApprovals > 0 ? "bad" : "neutral"} value={view.highRiskApprovals} />
              <Metric
                detail={`${blockedRuns} blocked or failed · in recent project runs`}
                label="Active runs"
                tone={activeRuns > 0 ? "run" : "neutral"}
                value={activeRuns}
              />
            </MetricStrip>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <SectionCard
                action={<Link className="text-xs text-accent hover:underline" href={projectScopedHref("/runs", null)}>All runs →</Link>}
                className="xl:col-span-7"
                description={`Newest registered-project runs across all projects (up to ${view.aggregate.runsPerProjectLimit} per project).`}
                title="Active work"
              >
                {view.aggregate.runs.length === 0 ? (
                  <p className="text-[13px] text-ink-3">{view.projects.length === 0 ? "No projects registered." : "No runs in registered projects yet."}</p>
                ) : (
                  <div className="-mx-4 -my-4">
                    <ProjectRunTable projectNames={names} runs={view.aggregate.runs} selectedProjectId={null} showProject />
                  </div>
                )}
              </SectionCard>

              <SectionCard
                action={<Link className="text-xs text-accent hover:underline" href={projectScopedHref("/approvals", null)}>All approvals →</Link>}
                className="xl:col-span-5"
                description="Pending runtime approvals across all projects, highest risk first. Read-only."
                title="Attention queue"
              >
                {view.approvals.length === 0 ? (
                  <EmptyState description="There are no pending runtime approvals in this workspace." title="Nothing needs your decision" />
                ) : (
                  <div className="-mx-4 -my-4">
                    <ApprovalQueue approvals={view.approvals.slice(0, 8)} compact />
                    {view.approvals.length > 8 && (
                      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                        +{view.approvals.length - 8} more in <Link className="text-accent hover:underline" href="/approvals">Approvals</Link>
                      </p>
                    )}
                  </div>
                )}
              </SectionCard>
            </div>

            <SectionCard className="mt-4" description="Registered projects and their activity in recent runs. Select a project to scope the console." title="Projects">
              {view.projects.length === 0 ? (
                <EmptyState description="No projects are registered in this workspace yet." title="No projects registered" />
              ) : (
                <div className="-mx-4 -my-4 grid divide-line sm:grid-cols-2 xl:grid-cols-3 [&>*]:border-b [&>*]:border-line sm:[&>*]:border-r">
                  {view.projects.map((project) => {
                    const item = activity.get(project.projectId);
                    return (
                      <Link className="group px-4 py-3 hover:bg-panel-2" href={projectScopedHref("/dashboard", project.projectId)} key={project.projectId}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-ink group-hover:text-accent">{project.displayName}</span>
                          <StatusBadge tone={project.status === "active" ? "success" : "warning"}>{project.status}</StatusBadge>
                        </div>
                        <p className="font-mono text-[11px] text-ink-3">{project.projectId}</p>
                        <p className="mt-2 font-mono text-[11.5px] text-ink-2">
                          {!item ? "not in this view" : !item.available ? "runs unavailable" : (
                            <>
                              <span className={item.activeRuns > 0 ? "text-run" : ""}>{item.activeRuns} active</span>
                              {" · "}
                              <span className={item.blockedRuns > 0 ? "text-bad" : ""}>{item.blockedRuns} blocked</span>
                              {" · "}{item.recentRuns}{item.truncated ? "+" : ""} recent
                            </>
                          )}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <div className={`mt-4 rounded-pac border px-4 py-3 ${coverageGap ? "border-warn/40 bg-warn/5" : "border-line bg-panel"}`}>
              <p className="pac-label">Data coverage</p>
              <p className="mt-1.5 text-xs leading-5 text-ink-3">
                Runs come from the registered projects ({view.aggregate.projectsConsidered} read, up to {view.aggregate.runsPerProjectLimit} newest runs each), not complete run history.
                {view.aggregate.projectsNotConsidered > 0 && ` ${view.aggregate.projectsNotConsidered} more project(s) are not included in this view.`}
                {view.aggregate.projectsUnavailable.length > 0 && ` Runs unavailable for: ${view.aggregate.projectsUnavailable.join(", ")}.`}
                {" "}Tasks are not available yet; current work is shown as runs.
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
        return (
          <>
            <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-pac border border-line bg-panel px-4 py-3">
              <div className="min-w-0">
                <p className="pac-label">Project</p>
                <p className="mt-1 text-[15px] font-semibold text-ink">{project.displayName} <span className="font-mono text-xs font-normal text-ink-3">{project.projectId}</span></p>
                <RepositoryLine project={project} />
              </div>
              <StatusBadge tone={project.status === "active" ? "success" : "warning"}>{project.status}</StatusBadge>
            </section>

            <MetricStrip columns={5}>
              <Metric detail={view.runsTruncated ? `Newest ${view.runsLimit} shown` : "Runs of this project"} label="Project runs" value={`${view.runs.length}${view.runsTruncated ? "+" : ""}`} />
              <Metric detail="Queued, running, waiting or in review" label="Active" tone={active > 0 ? "run" : "neutral"} value={active} />
              <Metric detail="Blocked or failed" label="Blocked" tone={blocked > 0 ? "bad" : "neutral"} value={blocked} />
              <Metric detail="This project only" label="Pending approvals" tone={approvals.pendingApprovals > 0 ? "warn" : "ok"} value={approvals.pendingApprovals} />
              <Metric detail="High or critical, this project" label="High / critical" tone={approvals.highRiskApprovals > 0 ? "bad" : "neutral"} value={approvals.highRiskApprovals} />
            </MetricStrip>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <SectionCard
                action={<Link className="text-xs text-accent hover:underline" href={projectScopedHref("/runs", project.projectId)}>Project runs →</Link>}
                className="xl:col-span-7"
                description="Newest runs of this project."
                title="Project runs"
              >
                {view.runs.length === 0 ? (
                  <p className="text-[13px] text-ink-3">This project has no runs yet.</p>
                ) : (
                  <div className="-mx-4 -my-4">
                    <ProjectRunTable runs={view.runs.slice(0, 15)} selectedProjectId={project.projectId} showProject={false} />
                  </div>
                )}
              </SectionCard>

              <SectionCard
                action={<Link className="text-xs text-accent hover:underline" href={projectScopedHref("/approvals", project.projectId)}>Project approvals →</Link>}
                className="xl:col-span-5"
                description="Approvals whose run factually belongs to this project. Read-only."
                title="Project approvals"
              >
                {approvals.approvals.length === 0 ? (
                  <EmptyState description="No pending runtime approval belongs to this project." title="Project queue is clear" />
                ) : (
                  <div className="-mx-4 -my-4">
                    <ApprovalQueue approvals={approvals.approvals.slice(0, 8)} compact selectedProjectId={project.projectId} />
                  </div>
                )}
              </SectionCard>
            </div>

            {approvals.unresolvedApprovals > 0 && (
              <div className="mt-4 rounded-pac border border-warn/40 bg-warn/5 px-4 py-3">
                <p className="pac-label !text-warn">Unresolved approvals</p>
                <p className="mt-1.5 text-xs leading-5 text-ink-3">
                  {approvals.unresolvedApprovals} workspace approval(s) could not be attributed to a project in this view and are not counted here.
                  See <Link className="text-accent hover:underline" href="/approvals">All Projects approvals</Link>.
                </p>
              </div>
            )}
            <p className="mt-3 text-[11.5px] text-ink-3">The top-bar approval count stays workspace-wide (all projects).</p>
          </>
        );
      })()}
    </AppShell>
  );
}
