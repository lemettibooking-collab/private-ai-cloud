import Link from "next/link";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { RunStatusBadge } from "@/components/domain/owner-console/run-status";
import { taskTone } from "@/components/domain/owner-console/status-tone";
import { TaskClassification, TaskStatusBadge, TaskTypeLabel } from "@/components/domain/owner-console/task-status";
import { toneDot } from "@/components/ui/tone";
import type { OwnerConsoleTask } from "@/lib/composition/owner-console-read.server";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectScopedHref } from "@/lib/projects/project-context";

type TaskTableProps = {
  tasks: readonly OwnerConsoleTask[];
  projectNames?: ReadonlyMap<string, string>;
  // Validated selected project preserved on task links; null = All Projects.
  selectedProjectId: string | null;
  showProject: boolean;
  dateColumn?: "updated" | "completed";
};

// Tasks are Owner objectives: the title is the primary field. Runs are secondary telemetry (linked
// attempts and the latest one's factual status); a task may have none.
export async function TaskTable({ tasks, projectNames, selectedProjectId, showProject, dateColumn = "updated" }: TaskTableProps) {
  const { t } = await getI18n();
  const scoped = projectScopedHref("/tasks", selectedProjectId);
  const taskHref = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}${scoped.slice("/tasks".length)}`;
  return (
    <div className="overflow-x-auto">
      <table className="pac-table">
        <thead>
          <tr>
            {[t.table.task, ...(showProject ? [t.table.project] : []), t.table.status, t.table.type, t.table.priorityRisk, t.table.runs, dateColumn === "completed" ? t.table.completed : t.table.updated].map((header) => (
              <th key={header} scope="col">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.taskId}>
              <td className="max-w-[30rem]">
                <div className="flex items-start gap-2.5">
                  <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-[2px] ${toneDot[taskTone[task.status] ?? "neutral"]}`} />
                  <div className="min-w-0">
                    <Link className="block truncate text-[13.5px] font-medium text-ink hover:text-accent" href={taskHref(task.taskId)}>{task.title}</Link>
                    <p className="pac-id">{task.taskId}</p>
                  </div>
                </div>
              </td>
              {showProject && (
                <td>
                  <Link className="whitespace-nowrap text-[12.5px] text-ink-2 hover:text-accent" href={projectScopedHref("/tasks", task.projectId)}>
                    {projectNames?.get(task.projectId) ?? task.projectId}
                  </Link>
                  <p className="pac-id whitespace-nowrap">{task.projectId}</p>
                </td>
              )}
              <td><TaskStatusBadge status={task.status} /></td>
              <td><TaskTypeLabel type={task.type} /></td>
              <td><TaskClassification task={task} /></td>
              <td className="whitespace-nowrap">
                {task.linkedRunCount === 0 ? (
                  <span className="text-[12.5px] text-ink-3">{t.table.noRuns}</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-ink-2">{task.linkedRunCount}</span>
                    {task.latestRun && <RunStatusBadge status={task.latestRun.status} />}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap font-mono text-[11px] text-ink-3">{formatTimestamp(dateColumn === "completed" ? task.completedAt : task.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
