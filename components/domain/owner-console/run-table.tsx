import Link from "next/link";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { RiskBadge, RunStatusBadge } from "@/components/domain/owner-console/run-status";
import type { OwnerConsoleRunSummary } from "@/lib/composition/owner-console-read.server";

export function RunTable({ runs }: { runs: readonly OwnerConsoleRunSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {["Run", "Status", "Workflow", "Current steps", "Approval", "Started"].map((header) => (
              <th className="pac-label px-3 py-2 font-medium" key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {runs.map((run) => (
            <tr className="hover:bg-panel-2" key={run.runId}>
              <td className="px-3 py-2">
                <Link className="font-mono text-xs text-accent hover:underline" href={`/runs/${encodeURIComponent(run.runId)}`}>
                  {run.runId}
                </Link>
                <p className="font-mono text-[10.5px] text-ink-3">rev {run.revision}</p>
              </td>
              <td className="px-3 py-2"><RunStatusBadge status={run.status} /></td>
              <td className="px-3 py-2 font-mono text-xs text-ink-2">{run.workflowId}</td>
              <td className="px-3 py-2 font-mono text-xs text-ink-2">{run.currentStepIds.length ? run.currentStepIds.join(", ") : "—"}</td>
              <td className="px-3 py-2">{run.approval ? <RiskBadge risk={run.approval.riskLevel} /> : <span className="text-ink-3">—</span>}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{formatTimestamp(run.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
