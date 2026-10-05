import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { observedCount, totalReading } from "@/components/domain/owner-console/bounded-count";
import { attentionStatuses } from "@/components/domain/owner-console/status-tone";
import { TaskTable } from "@/components/domain/owner-console/task-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Instrument, InstrumentStrip } from "@/components/ui/instrument";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerTasks, type OwnerConsoleTaskStatus } from "@/lib/composition/owner-console-read.server";
import { quickCreateHref } from "@/lib/projects/project-context";

type TasksPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const activeStatuses: ReadonlySet<OwnerConsoleTaskStatus> = new Set(["ready", "planning", "approved", "running", "verifying"]);

// Tasks are Owner objectives (persisted ProjectTasks). Runs are attempts linked to them.
export default async function TasksPage({ searchParams }: TasksPageProps) {
  const view = await loadOwnerTasks((await searchParams).project);
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description={selected
          ? "Tasks of the selected project — what needs to be done. Runs are the execution attempts linked to a task."
          : "Tasks across all registered projects — what needs to be done. Runs are the execution attempts linked to a task."}
        eyebrow="Tasks"
        title={selected ? `${selected.displayName} tasks` : "All Projects tasks"}
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/tasks" />}

      {view.state === "available" && (() => {
        // Category counts are OBSERVED within the loaded tasks (never "+"); only the list total carries
        // "+" when the bounded view is full.
        const shown = view.tasks;
        const total = totalReading(shown.length, view.truncated);
        const within = view.truncated ? " · within shown tasks (bounded view)" : "";
        const count = (predicate: (status: OwnerConsoleTaskStatus) => boolean) => observedCount(shown.filter((task) => predicate(task.status)).length);
        return (
          <>
            <InstrumentStrip label="Task summary">
              <Instrument detail={`Ready, planning, approved, running or verifying${within}`} label="Active" tone="active" value={count((status) => activeStatuses.has(status))} />
              <Instrument detail={`Waiting on Owner, blocked, recovery or failed${within}`} label="Needs attention" tone="attention" value={count((status) => attentionStatuses.has(status))} />
              <Instrument detail={`Owner intent not yet started${within}`} label="Draft" tone="muted" value={count((status) => status === "draft")} />
              <Instrument detail={`Status completed${within}`} label="Completed" tone="success" value={count((status) => status === "completed")} />
              <Instrument detail={view.truncated ? "Most recently updated (bounded view)" : "Tasks in this scope"} label="Shown" value={total} />
            </InstrumentStrip>

            <SectionCard
              className="mt-4"
              count={total}
              description={view.truncated ? "Most recently updated tasks shown (bounded view)." : "Most recently updated first."}
              flush
              title={selected ? "Project tasks" : "All tasks"}
            >
              {shown.length === 0 ? (
                <EmptyState
                  actionHref={quickCreateHref(selected?.projectId ?? null)}
                  actionLabel="New task"
                  description={selected ? "This project has no tasks yet." : "No tasks exist in the registered projects yet."}
                  title="No tasks"
                  variant="inline"
                />
              ) : (
                <TaskTable
                  projectNames={new Map(view.projects.map((project) => [project.projectId, project.displayName]))}
                  selectedProjectId={selected?.projectId ?? null}
                  showProject={!selected}
                  tasks={shown}
                />
              )}
            </SectionCard>
          </>
        );
      })()}
      <p className="mt-3 text-[11px] text-ink-3">New tasks are created with + New Task as draft Owner intent; nothing runs automatically.</p>
    </AppShell>
  );
}
