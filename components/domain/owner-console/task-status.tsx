import { StatusBadge } from "@/components/ui/status-badge";
import type { OwnerConsoleTask, OwnerConsoleTaskStatus } from "@/lib/composition/owner-console-read.server";
import type { StatusTone } from "@/types/app";

// Task (objective) status language: active = cyan, attention = amber/red, completed = green.
const taskTone: Record<OwnerConsoleTaskStatus, StatusTone> = {
  draft: "neutral",
  ready: "info",
  planning: "info",
  approved: "info",
  running: "info",
  verifying: "info",
  waiting_owner: "warning",
  blocked: "danger",
  recovery_required: "danger",
  failed: "danger",
  completed: "success",
  cancelled: "neutral",
};

export function TaskStatusBadge({ status }: { status: OwnerConsoleTaskStatus }) {
  return <StatusBadge tone={taskTone[status] ?? "neutral"}>{status.replaceAll("_", " ")}</StatusBadge>;
}

export function TaskTypeLabel({ type }: { type: OwnerConsoleTask["type"] }) {
  return <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">{type}</span>;
}

// Unknown classification stays visibly unknown — never a fabricated default.
export function TaskClassification({ task }: { task: OwnerConsoleTask }) {
  return (
    <span className="font-mono text-[11px] text-ink-2">
      {task.priority ?? <span className="text-ink-3">—</span>}
      <span className="text-ink-3"> · </span>
      {task.riskLevel ? `${task.riskLevel} risk` : <span className="text-ink-3">risk —</span>}
    </span>
  );
}
