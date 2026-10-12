import { taskTone } from "@/components/domain/owner-console/status-tone";
import { StatusBadge } from "@/components/ui/status-badge";
import type { OwnerConsoleTask, OwnerConsoleTaskStatus } from "@/lib/composition/owner-console-read.server";
import { getI18n } from "@/lib/i18n/locale.server";

// Task (objective) status: active = cyan, waiting on Owner = amber, blocked / failed = red,
// completed = green, draft / cancelled = muted (see status-tone.ts). Labels are localized; the
// domain status value itself never changes.
export async function TaskStatusBadge({ status }: { status: OwnerConsoleTaskStatus }) {
  const { t } = await getI18n();
  return <StatusBadge tone={taskTone[status] ?? "neutral"}>{t.taskStatus[status] ?? status}</StatusBadge>;
}

export async function TaskTypeLabel({ type }: { type: OwnerConsoleTask["type"] }) {
  const { t } = await getI18n();
  return <span className="whitespace-nowrap text-[12.5px] text-ink-2">{t.taskType[type] ?? type}</span>;
}

// Unknown classification stays visibly unknown — never a fabricated default. Priority tokens
// (P0–P4) are not translated.
export async function TaskClassification({ task }: { task: OwnerConsoleTask }) {
  const { t } = await getI18n();
  const riskClass = task.riskLevel === "high" || task.riskLevel === "critical" ? "text-bad" : task.riskLevel === "medium" ? "text-warn" : "text-ink-2";
  return (
    <span className="whitespace-nowrap text-[12.5px] text-ink-2">
      {task.priority ?? <span className="text-ink-3">{t.table.priorityUnset}</span>}
      <span className="text-ink-3"> · </span>
      {task.riskLevel ? <span className={riskClass}>{t.riskBadge[task.riskLevel] ?? task.riskLevel}</span> : <span className="text-ink-3">{t.table.riskUnset}</span>}
    </span>
  );
}
