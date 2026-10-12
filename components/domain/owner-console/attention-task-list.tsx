import Link from "next/link";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { RunStatusBadge } from "@/components/domain/owner-console/run-status";
import { taskTone } from "@/components/domain/owner-console/status-tone";
import { TaskClassification, TaskStatusBadge } from "@/components/domain/owner-console/task-status";
import { toneDot } from "@/components/ui/tone";
import type { OwnerConsoleTask } from "@/lib/composition/owner-console-read.server";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectScopedHref } from "@/lib/projects/project-context";

// My Attention rows: an intervention list, not a spreadsheet. The rail repeats the status tone; the
// status itself is always written. Only factual task fields are shown.
export async function AttentionTaskList({ tasks, projectNames, selectedProjectId, showProject }: {
  tasks: readonly OwnerConsoleTask[];
  projectNames: ReadonlyMap<string, string>;
  selectedProjectId: string | null;
  showProject: boolean;
}) {
  const { t } = await getI18n();
  const scoped = projectScopedHref("/tasks", selectedProjectId);
  const taskHref = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}${scoped.slice("/tasks".length)}`;
  return (
    <ul className="divide-y divide-line">
      {tasks.map((task) => (
        <li key={task.taskId}>
          <Link className="group relative flex items-center gap-4 py-2.5 pl-4 pr-4 transition-colors hover:bg-panel-2" href={taskHref(task.taskId)}>
            <span aria-hidden className={`absolute inset-y-2 left-0 w-[2px] rounded-r-full ${toneDot[taskTone[task.status] ?? "neutral"]}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-ink group-hover:text-accent">{task.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-3">
                {showProject && <span className="text-ink-2">{projectNames.get(task.projectId) ?? task.projectId}</span>}
                <span className="font-mono text-[10.5px]">{task.taskId}</span>
                <span>·</span>
                <TaskClassification task={task} />
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {task.latestRun && (
                <span className="hidden items-center gap-1.5 lg:flex">
                  <span className="pac-label !text-[9px]">{t.table.latestRun}</span>
                  <RunStatusBadge status={task.latestRun.status} />
                </span>
              )}
              <TaskStatusBadge status={task.status} />
              <span className="hidden w-[8.5rem] text-right font-mono text-[10.5px] text-ink-3 xl:block">{formatTimestamp(task.updatedAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
