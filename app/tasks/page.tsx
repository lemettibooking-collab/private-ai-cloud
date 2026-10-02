import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { TaskTable } from "@/components/domain/owner-console/task-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerTasks } from "@/lib/composition/owner-console-read.server";

type TasksPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

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

      {view.state === "available" && (
        <SectionCard
          description={view.truncated ? "Most recently updated tasks shown (bounded view)." : `${view.tasks.length} task(s), most recently updated first.`}
          title={selected ? "Project tasks" : "All tasks"}
        >
          {view.tasks.length === 0 ? (
            <EmptyState
              description={selected ? "This project has no tasks yet." : "No tasks exist in the registered projects yet."}
              title="No tasks"
            />
          ) : (
            <div className="-mx-4 -my-4">
              <TaskTable
                projectNames={new Map(view.projects.map((project) => [project.projectId, project.displayName]))}
                selectedProjectId={selected?.projectId ?? null}
                showProject={!selected}
                tasks={view.tasks}
              />
            </div>
          )}
        </SectionCard>
      )}
      <p className="mt-3 text-[11.5px] text-ink-3">New tasks are created with + New Task as draft Owner intent; nothing runs automatically.</p>
    </AppShell>
  );
}
