import Link from "next/link";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { TaskClassification, TaskStatusBadge, TaskTypeLabel } from "@/components/domain/owner-console/task-status";
import type { OwnerConsoleTask } from "@/lib/composition/owner-console-read.server";
import { projectScopedHref } from "@/lib/projects/project-context";

type TaskTableProps = {
  tasks: readonly OwnerConsoleTask[];
  projectNames?: ReadonlyMap<string, string>;
  // Validated selected project preserved on task links; null = All Projects.
  selectedProjectId: string | null;
  showProject: boolean;
  dateColumn?: "updated" | "completed";
};

// Tasks are objectives; the "Runs" column counts linked attempts (a task may have none).
export function TaskTable({ tasks, projectNames, selectedProjectId, showProject, dateColumn = "updated" }: TaskTableProps) {
  const scoped = projectScopedHref("/tasks", selectedProjectId);
  const taskHref = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}${scoped.slice("/tasks".length)}`;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {[...(showProject ? ["Project"] : []), "Task", "Type", "Status", "Priority · Risk", "Runs", dateColumn === "completed" ? "Completed" : "Updated"].map((header) => (
              <th className="pac-label px-3 py-2 font-medium" key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.map((task) => (
            <tr className="hover:bg-panel-2" key={task.taskId}>
              {showProject && (
                <td className="px-3 py-2">
                  <Link className="text-[13px] text-ink hover:text-accent" href={projectScopedHref("/tasks", task.projectId)}>
                    {projectNames?.get(task.projectId) ?? task.projectId}
                  </Link>
                  <p className="font-mono text-[10.5px] text-ink-3">{task.projectId}</p>
                </td>
              )}
              <td className="max-w-[28rem] px-3 py-2">
                <Link className="block truncate text-[13px] font-medium text-ink hover:text-accent" href={taskHref(task.taskId)}>{task.title}</Link>
                <p className="font-mono text-[10.5px] text-ink-3">{task.taskId}</p>
              </td>
              <td className="px-3 py-2"><TaskTypeLabel type={task.type} /></td>
              <td className="px-3 py-2"><TaskStatusBadge status={task.status} /></td>
              <td className="px-3 py-2"><TaskClassification task={task} /></td>
              <td className="px-3 py-2 font-mono text-xs text-ink-2">
                {task.linkedRunCount === 0 ? <span className="text-ink-3">no runs</span> : `${task.linkedRunCount} run${task.linkedRunCount === 1 ? "" : "s"}`}
                {task.latestRun && <p className="font-mono text-[10.5px] text-ink-3">latest {task.latestRun.status.replaceAll("_", " ")}</p>}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{formatTimestamp(dateColumn === "completed" ? task.completedAt : task.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
