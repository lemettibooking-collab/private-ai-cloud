import { formatTimestamp } from "@/components/domain/owner-console/format";
import { RunStatusBadge } from "@/components/domain/owner-console/run-status";
import { TaskStatusBadge } from "@/components/domain/owner-console/task-status";
import type { OwnerConsoleTaskResult } from "@/lib/composition/owner-console-read.server";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-mono text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}

// FACTUAL Task Result: the persisted task state plus counts over its linked runs. It is not an agent
// report: no "implemented", "security passed", "PR ready" or changed-file claims exist here.
export function TaskResultPanel({ result }: { result: OwnerConsoleTaskResult }) {
  return (
    <div>
      <dl className="-my-2 divide-y divide-line">
        <Row label="Task status"><TaskStatusBadge status={result.status} /></Row>
        <Row label="Completed">{formatTimestamp(result.completedAt)}</Row>
        <Row label="Linked runs">{result.linkedRunCount}</Row>
        <Row label="Latest run">{result.latestRun ? <RunStatusBadge status={result.latestRun.status} /> : <span className="text-ink-3">none</span>}</Row>
        <Row label="Completed runs">{result.completedRuns}</Row>
        <Row label="Failed / blocked runs">{result.failedOrBlockedRuns}</Row>
        <Row label="Active runs">{result.activeRuns}</Row>
      </dl>
      {result.runsTruncated && <p className="mt-2 text-[11px] text-ink-3">Run counts cover the newest linked runs shown.</p>}
      <p className="mt-4 border-t border-line pt-2.5 text-[11px] leading-4 text-ink-3">
        Factual aggregation of the task and its linked runs. Agent reports, evidence, security results and PR status are not
        available yet (AI-039).
      </p>
    </div>
  );
}
