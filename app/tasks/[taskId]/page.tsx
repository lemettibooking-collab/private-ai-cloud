import Link from "next/link";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { ProjectRunTable } from "@/components/domain/owner-console/project-run-table";
import { TaskResultPanel } from "@/components/domain/owner-console/task-result";
import { TaskStatusBadge, TaskTypeLabel } from "@/components/domain/owner-console/task-status";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerTask } from "@/lib/composition/owner-console-read.server";
import { developmentHref } from "@/lib/development/feature-plan-model";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectScopedHref } from "@/lib/projects/project-context";

type TaskDetailPageProps = {
  // The route carries ONLY the stable Task ID; the optional `project` selector never authorizes
  // access: under a selected project, a task of another project is the same opaque "unavailable".
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// Inspection metadata row (label left, factual value right).
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}


// Inspection hierarchy: identity / status → objective → operational metadata → runs (attempts) →
// factual result. Nothing here is an agent report.
export default async function TaskDetailPage({ params, searchParams }: TaskDetailPageProps) {
  const { taskId } = await params;
  const view = await loadOwnerTask(taskId, (await searchParams).project);
  const { t } = await getI18n();
  const k = t.taskDetail;
  const unset = <span className="text-ink-3">{t.common.notSet}</span>;
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;
  const tasksHref = projectScopedHref("/tasks", selected?.projectId ?? null);
  const detail = view.state === "available" && view.task.state === "available" ? view.task.detail : null;
  const projectName = detail && view.state === "available"
    ? view.projects.find((project) => project.projectId === detail.task.projectId)?.displayName ?? detail.task.projectId
    : null;

  return (
    <AppShell selectedProject={selected}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="pac-label">
            <Link className="!text-accent hover:underline" href={tasksHref}>{k.breadcrumbTasks}</Link> / {k.breadcrumbDetail}
          </p>
          <h1 className="mt-1 truncate text-[20px] font-semibold leading-7 tracking-tight text-ink">{detail ? detail.task.title : k.task}</h1>
          {detail && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <TaskStatusBadge status={detail.task.status} />
              <span className="font-mono text-[11.5px] text-ink-2">{detail.task.taskId}</span>
              <span className="text-ink-3">·</span>
              <Link className="text-[12.5px] text-ink-2 hover:text-accent" href={projectScopedHref("/tasks", detail.task.projectId)}>{projectName}</Link>
              <span className="text-ink-3">·</span>
              <TaskTypeLabel type={detail.task.type} />
            </div>
          )}
        </div>
        {view.state === "available" && (
          <div className="flex items-center gap-2">
            {/* AI-039: the Development Workflow lives inside the task (no new top-level navigation). */}
            {detail && (
              <Link className="pac-control-accent flex h-8 items-center px-3 text-xs font-semibold" href={developmentHref(detail.task.taskId, selected?.projectId ?? null)}>
                {k.developmentPlan}
              </Link>
            )}
            <ScopeBadge project={selected} />
          </div>
        )}
      </div>

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/tasks" />}

      {view.state === "available" && view.task.state === "unavailable" && (
        <div className="pac-surface px-6 py-9 text-center">
          <p className="pac-label">{k.task}</p>
          <p className="mt-2 text-[15px] font-semibold text-ink">{k.unavailableTitle}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-5 text-ink-3">
            {selected ? k.unavailableInProject : k.unavailable}
          </p>
          <Link className="pac-control mt-5 inline-flex h-8 items-center px-3 text-[13px] text-ink-2" href={tasksHref}>
            {k.backToTasks}
          </Link>
        </div>
      )}

      {detail && (() => {
        const { task, runs, runsTruncated, result } = detail;
        return (
          <div className="grid gap-4 xl:grid-cols-12">
            <SectionCard className="xl:col-span-8" title={k.objective}>
              {task.goal ? (
                <p className="max-w-[72ch] whitespace-pre-wrap text-[13.5px] leading-6 text-ink">{task.goal}</p>
              ) : (
                <p className="text-[13px] text-ink-3">{k.noGoal}</p>
              )}
            </SectionCard>

            <SectionCard className="xl:col-span-4" title={k.metadata}>
              <dl className="-my-2 divide-y divide-line">
                <Meta label={k.project}>{projectName} <span className="ml-1 font-mono text-[10.5px] text-ink-3">{task.projectId}</span></Meta>
                <Meta label={k.type}><TaskTypeLabel type={task.type} /></Meta>
                <Meta label={k.priority}>{task.priority ?? unset}</Meta>
                <Meta label={k.riskLevel}>{task.riskLevel ? t.risk[task.riskLevel] : unset}</Meta>
                <Meta label={k.created}><span className="font-mono text-[11.5px]">{formatTimestamp(task.createdAt)}</span></Meta>
                <Meta label={k.updated}><span className="font-mono text-[11.5px]">{formatTimestamp(task.updatedAt)}</span></Meta>
                <Meta label={k.completed}><span className="font-mono text-[11.5px]">{formatTimestamp(task.completedAt)}</span></Meta>
              </dl>
            </SectionCard>

            <SectionCard
              className="xl:col-span-8"
              count={task.linkedRunCount}
              description={k.linkedRunsDescription}
              flush
              title={k.linkedRuns}
            >
              {runs.length === 0 ? (
                <EmptyState description={k.noLinkedRunsBody} title={k.noLinkedRunsTitle} variant="inline" />
              ) : (
                <ProjectRunTable runs={runs} selectedProjectId={selected?.projectId ?? null} showProject={false} />
              )}
              {runsTruncated && <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">{format(k.runsTruncated, { shown: runs.length, total: task.linkedRunCount })}</p>}
            </SectionCard>

            <SectionCard className="xl:col-span-4" title={k.taskResult}>
              <TaskResultPanel result={result} />
            </SectionCard>
          </div>
        );
      })()}
    </AppShell>
  );
}
