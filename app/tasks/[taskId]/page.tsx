import Link from "next/link";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { ProjectRunTable } from "@/components/domain/owner-console/project-run-table";
import { TaskResultPanel } from "@/components/domain/owner-console/task-result";
import { TaskClassification, TaskStatusBadge, TaskTypeLabel } from "@/components/domain/owner-console/task-status";
import { AppShell } from "@/components/shell/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerTask } from "@/lib/composition/owner-console-read.server";
import { projectScopedHref } from "@/lib/projects/project-context";

type TaskDetailPageProps = {
  // The route carries ONLY the stable Task ID; the optional `project` selector never authorizes
  // access: under a selected project, a task of another project is the same opaque "unavailable".
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="pac-label">{label}</p>
      <div className="mt-1.5 truncate text-[13px] text-ink">{children}</div>
    </div>
  );
}

export default async function TaskDetailPage({ params, searchParams }: TaskDetailPageProps) {
  const { taskId } = await params;
  const view = await loadOwnerTask(taskId, (await searchParams).project);
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;
  const tasksHref = projectScopedHref("/tasks", selected?.projectId ?? null);

  return (
    <AppShell selectedProject={selected}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="pac-label">
            <Link className="!text-accent hover:underline" href={tasksHref}>Tasks</Link> / Task detail
          </p>
          <h1 className="mt-1 truncate text-lg font-semibold text-ink">
            {view.state === "available" && view.task.state === "available" ? view.task.detail.task.title : "Task"}
          </h1>
          {view.state === "available" && view.task.state === "available" && (
            <p className="font-mono text-xs text-ink-3">{view.task.detail.task.taskId}</p>
          )}
        </div>
        {view.state === "available" && <ScopeBadge project={selected} />}
      </div>

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/tasks" />}

      {view.state === "available" && view.task.state === "unavailable" && (
        <div className="rounded-pac border border-line bg-panel px-6 py-10 text-center">
          <p className="pac-label">Task</p>
          <p className="mt-2 text-base font-semibold text-ink">Task unavailable</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-5 text-ink-3">
            {selected ? "This task cannot be shown in this project context." : "This task cannot be shown."}
          </p>
          <Link className="mt-5 inline-flex h-8 items-center rounded-pac border border-line-strong bg-panel-2 px-3 text-[13px] text-ink-2 hover:bg-raised" href={tasksHref}>
            Back to tasks
          </Link>
        </div>
      )}

      {view.state === "available" && view.task.state === "available" && (() => {
        const { task, runs, runsTruncated, result } = view.task.detail;
        const projectName = view.projects.find((project) => project.projectId === task.projectId)?.displayName ?? task.projectId;
        return (
          <>
            <div className="grid grid-cols-2 divide-line rounded-pac border border-line bg-panel md:grid-cols-3 xl:grid-cols-6 xl:divide-x">
              <Field label="Project">
                <Link className="hover:text-accent" href={projectScopedHref("/tasks", task.projectId)}>{projectName}</Link>
                <span className="ml-1.5 font-mono text-[11px] text-ink-3">{task.projectId}</span>
              </Field>
              <Field label="Status"><TaskStatusBadge status={task.status} /></Field>
              <Field label="Type"><TaskTypeLabel type={task.type} /></Field>
              <Field label="Priority · Risk"><TaskClassification task={task} /></Field>
              <Field label="Created"><span className="font-mono">{formatTimestamp(task.createdAt)}</span></Field>
              <Field label="Updated"><span className="font-mono">{formatTimestamp(task.updatedAt)}</span></Field>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <div className="flex flex-col gap-4 xl:col-span-8">
                <SectionCard title="Goal">
                  {task.goal ? <p className="whitespace-pre-wrap text-[13px] leading-6 text-ink-2">{task.goal}</p> : <p className="text-[13px] text-ink-3">No goal recorded.</p>}
                </SectionCard>

                <SectionCard
                  description="Runs are execution attempts linked to this task, newest first."
                  title={`Linked runs · ${task.linkedRunCount}`}
                >
                  {runs.length === 0 ? (
                    <p className="text-[13px] text-ink-3">No runs are linked to this task yet — no execution has been recorded for it.</p>
                  ) : (
                    <div className="-mx-4 -my-4">
                      <ProjectRunTable runs={runs} selectedProjectId={selected?.projectId ?? null} showProject={false} />
                    </div>
                  )}
                  {runsTruncated && <p className="mt-3 text-[11.5px] text-ink-3">Showing the newest {runs.length} of {task.linkedRunCount} linked runs.</p>}
                </SectionCard>
              </div>

              <SectionCard className="xl:col-span-4" title="Task result">
                <TaskResultPanel result={result} />
              </SectionCard>
            </div>
          </>
        );
      })()}
    </AppShell>
  );
}
