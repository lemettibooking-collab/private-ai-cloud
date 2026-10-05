import { taskTone } from "@/components/domain/owner-console/status-tone";
import { StatusBadge } from "@/components/ui/status-badge";
import type { OwnerConsoleTask, OwnerConsoleTaskStatus } from "@/lib/composition/owner-console-read.server";

// Task (objective) status: active = cyan, waiting on Owner = amber, blocked / failed = red,
// completed = green, draft / cancelled = muted (see status-tone.ts).
export function TaskStatusBadge({ status }: { status: OwnerConsoleTaskStatus }) {
  return <StatusBadge tone={taskTone[status] ?? "neutral"}>{status.replaceAll("_", " ")}</StatusBadge>;
}

export function TaskTypeLabel({ type }: { type: OwnerConsoleTask["type"] }) {
  return <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-2">{type}</span>;
}

// Unknown classification stays visibly unknown — never a fabricated default.
export function TaskClassification({ task }: { task: OwnerConsoleTask }) {
  const riskClass = task.riskLevel === "high" || task.riskLevel === "critical" ? "text-bad" : task.riskLevel === "medium" ? "text-warn" : "text-ink-2";
  return (
    <span className="whitespace-nowrap font-mono text-[11px] text-ink-2">
      {task.priority ?? <span className="text-ink-3">P—</span>}
      <span className="text-ink-3"> · </span>
      {task.riskLevel ? <span className={riskClass}>{task.riskLevel} risk</span> : <span className="text-ink-3">risk —</span>}
    </span>
  );
}
