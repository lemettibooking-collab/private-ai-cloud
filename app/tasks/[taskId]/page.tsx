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

const unset = <span className="font-mono text-ink-3">not set</span>;

// Inspection hierarchy: identity / status → objective → operational metadata → runs (attempts) →
// factual result. Nothing here is an agent report.
export default async function TaskDetailPage({ params, searchParams }: TaskDetailPageProps) {
  const { taskId } = await params;
  const view = await loadOwnerTask(taskId, (await searchParams).project);
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
            <Link className="!text-accent hover:underline" href={tasksHref}>Tasks</Link> / Task detail
          </p>
          <h1 className="mt-1 truncate text-[20px] font-semibold leading-7 tracking-tight text-ink">{detail ? detail.task.title : "Task"}</h1>
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
        {view.state === "available" && <ScopeBadge project={selected} />}
      </div>

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/tasks" />}

      {view.state === "available" && view.task.state === "unavailable" && (
        <div className="pac-surface px-6 py-9 text-center">
          <p className="pac-label">Task</p>
          <p className="mt-2 text-[15px] font-semibold text-ink">Task unavailable</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-5 text-ink-3">
            {selected ? "This task cannot be shown in this project context." : "This task cannot be shown."}
          </p>
          <Link className="pac-control mt-5 inline-flex h-8 items-center px-3 text-[13px] text-ink-2" href={tasksHref}>
            Back to tasks
          </Link>
        </div>
      )}

      {detail && (() => {
        const { task, runs, runsTruncated, result } = detail;
        return (
          <div className="grid gap-4 xl:grid-cols-12">
            <SectionCard className="xl:col-span-8" title="Objective">
              {task.goal ? (
                <p className="max-w-[72ch] whitespace-pre-wrap text-[13.5px] leading-6 text-ink">{task.goal}</p>
              ) : (
                <p className="text-[13px] text-ink-3">No goal recorded for this task.</p>
              )}
            </SectionCard>

            <SectionCard className="xl:col-span-4" title="Task metadata">
              <dl className="-my-2 divide-y divide-line">
                <Meta label="Project">{projectName} <span className="ml-1 font-mono text-[10.5px] text-ink-3">{task.projectId}</span></Meta>
                <Meta label="Type"><TaskTypeLabel type={task.type} /></Meta>
                <Meta label="Priority"><span className="font-mono">{task.priority ?? unset}</span></Meta>
                <Meta label="Risk level"><span className="font-mono">{task.riskLevel ?? unset}</span></Meta>
                <Meta label="Created"><span className="font-mono text-[11.5px]">{formatTimestamp(task.createdAt)}</span></Meta>
                <Meta label="Updated"><span className="font-mono text-[11.5px]">{formatTimestamp(task.updatedAt)}</span></Meta>
                <Meta label="Completed"><span className="font-mono text-[11.5px]">{formatTimestamp(task.completedAt)}</span></Meta>
              </dl>
            </SectionCard>

            <SectionCard
              className="xl:col-span-8"
              count={task.linkedRunCount}
              description="Runs are execution attempts linked to this task, newest first."
              flush
              title="Linked runs"
            >
              {runs.length === 0 ? (
                <EmptyState description="No runs are linked to this task yet — no execution has been recorded for it." title="No linked runs" variant="inline" />
              ) : (
                <ProjectRunTable runs={runs} selectedProjectId={selected?.projectId ?? null} showProject={false} />
              )}
              {runsTruncated && <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Showing the newest {runs.length} of {task.linkedRunCount} linked runs.</p>}
            </SectionCard>

            <SectionCard className="xl:col-span-4" title="Task result">
              <TaskResultPanel result={result} />
            </SectionCard>
          </div>
        );
      })()}
    </AppShell>
  );
}
