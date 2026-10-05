import Link from "next/link";
import { formatTimestamp, humanize } from "@/components/domain/owner-console/format";
import { ApprovalStatusBadge, RiskBadge } from "@/components/domain/owner-console/run-status";
import { riskTone } from "@/components/domain/owner-console/status-tone";
import { toneDot } from "@/components/ui/tone";
import type { OwnerConsoleApproval } from "@/lib/composition/owner-console-read.server";
import { projectScopedHref } from "@/lib/projects/project-context";

// Read-only: each row links to the related Run. There are no decision controls (no write boundary).
// The left rail repeats the risk tone; the risk is always also written as text.
export function ApprovalQueue({ approvals, compact = false, selectedProjectId = null }: {
  approvals: readonly OwnerConsoleApproval[];
  compact?: boolean;
  // Preserved on run links only when the approvals were classified to this validated project.
  selectedProjectId?: string | null;
}) {
  const scoped = projectScopedHref("/runs", selectedProjectId);
  const runHref = (runId: string) => `/runs/${encodeURIComponent(runId)}${scoped.slice("/runs".length)}`;
  return (
    <ul className="divide-y divide-line">
      {approvals.map((approval) => (
        <li key={approval.approvalRequestId || `${approval.runId}:${approval.stepId}`}>
          <Link
            className="group relative flex items-center gap-4 py-2.5 pl-4 pr-4 transition-colors hover:bg-panel-2"
            href={runHref(approval.runId)}
          >
            <span aria-hidden className={`absolute inset-y-2 left-0 w-[2px] rounded-r-full ${toneDot[riskTone[approval.riskLevel] ?? "neutral"]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-ink">{humanize(approval.requestedCapability) || "capability"}</span>
                <RiskBadge risk={approval.riskLevel} />
                {!compact && <ApprovalStatusBadge status={approval.status} />}
              </div>
              <p className="mt-1 font-mono text-[10.5px] text-ink-3">
                run <span className="text-ink-2">{approval.runId}</span> · step <span className="text-ink-2">{approval.stepId}</span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[10.5px] text-ink-3">{formatTimestamp(approval.requestedAt)}</p>
              <p className="mt-0.5 text-[11px] text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Open run →</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
