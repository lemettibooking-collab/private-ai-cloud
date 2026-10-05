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
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";
import { quickCreateHref } from "@/lib/projects/project-context";

type TasksPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const activeStatuses: ReadonlySet<OwnerConsoleTaskStatus> = new Set(["ready", "planning", "approved", "running", "verifying"]);

// Tasks are Owner objectives (persisted ProjectTasks). Runs are attempts linked to them.
export default async function TasksPage({ searchParams }: TasksPageProps) {
  const view = await loadOwnerTasks((await searchParams).project);
  const { t } = await getI18n();
  const k = t.tasks;
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description={selected ? k.descriptionProject : k.descriptionAll}
        eyebrow={k.eyebrow}
        title={selected ? format(k.titleProject, { project: selected.displayName }) : k.titleAll}
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/tasks" />}

      {view.state === "available" && (() => {
        // Category counts are OBSERVED within the loaded tasks (never "+"); only the list total carries
        // "+" when the bounded view is full.
        const shown = view.tasks;
        const total = totalReading(shown.length, view.truncated);
        const within = view.truncated ? k.withinShown : "";
        const count = (predicate: (status: OwnerConsoleTaskStatus) => boolean) => observedCount(shown.filter((task) => predicate(task.status)).length);
        return (
          <>
            <InstrumentStrip label={k.summary}>
              <Instrument detail={`${k.activeDetail}${within}`} label={k.active} tone="active" value={count((status) => activeStatuses.has(status))} />
              <Instrument detail={`${k.needsAttentionDetail}${within}`} label={k.needsAttention} tone="attention" value={count((status) => attentionStatuses.has(status))} />
              <Instrument detail={`${k.draftDetail}${within}`} label={k.draft} tone="muted" value={count((status) => status === "draft")} />
              <Instrument detail={`${k.completedDetail}${within}`} label={k.completed} tone="success" value={count((status) => status === "completed")} />
              <Instrument detail={view.truncated ? k.shownDetailBounded : k.shownDetail} label={k.shown} value={total} />
            </InstrumentStrip>

            <SectionCard
              className="mt-4"
              count={total}
              description={view.truncated ? k.listDescriptionBounded : k.listDescription}
              flush
              title={selected ? k.listProject : k.listAll}
            >
              {shown.length === 0 ? (
                <EmptyState
                  actionHref={quickCreateHref(selected?.projectId ?? null)}
                  actionLabel={k.newTask}
                  description={selected ? k.noTasksProject : k.noTasksAll}
                  title={k.noTasksTitle}
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
      <p className="mt-3 text-[11px] text-ink-3">{k.footnote}</p>
    </AppShell>
  );
}
