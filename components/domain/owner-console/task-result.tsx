import { formatTimestamp } from "@/components/domain/owner-console/format";
import { RunStatusBadge } from "@/components/domain/owner-console/run-status";
import { TaskStatusBadge } from "@/components/domain/owner-console/task-status";
import type { OwnerConsoleTaskResult } from "@/lib/composition/owner-console-read.server";
import { getI18n } from "@/lib/i18n/locale.server";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-[12.5px] tabular-nums text-ink">{children}</dd>
    </div>
  );
}

// FACTUAL Task Result: the persisted task state plus counts over its linked runs. It is not an agent
// report: no "implemented", "security passed", "PR ready" or changed-file claims exist here.
export async function TaskResultPanel({ result }: { result: OwnerConsoleTaskResult }) {
  const { t } = await getI18n();
  return (
    <div>
      <dl className="-my-2 divide-y divide-line">
        <Row label={t.taskResult.taskStatus}><TaskStatusBadge status={result.status} /></Row>
        <Row label={t.taskResult.completed}>{formatTimestamp(result.completedAt)}</Row>
        <Row label={t.taskResult.linkedRuns}>{result.linkedRunCount}</Row>
        <Row label={t.taskResult.latestRun}>{result.latestRun ? <RunStatusBadge status={result.latestRun.status} /> : <span className="text-ink-3">{t.common.none}</span>}</Row>
        <Row label={t.taskResult.completedRuns}>{result.completedRuns}</Row>
        <Row label={t.taskResult.failedBlockedRuns}>{result.failedOrBlockedRuns}</Row>
        <Row label={t.taskResult.activeRuns}>{result.activeRuns}</Row>
      </dl>
      {result.runsTruncated && <p className="mt-2 text-[11px] text-ink-3">{t.taskResult.truncated}</p>}
      <p className="mt-4 border-t border-line pt-2.5 text-[11px] leading-4 text-ink-3">
        {t.taskResult.factualNote}
      </p>
    </div>
  );
}
