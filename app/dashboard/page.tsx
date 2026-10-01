import Link from "next/link";
import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { OwnerDataUnavailable, ProjectContext, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { RunTable } from "@/components/domain/owner-console/run-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerConsoleOverview } from "@/lib/composition/owner-console-read.server";

type MetricProps = { label: string; value: React.ReactNode; detail: string; tone?: "warn" | "bad" | "ok" | "neutral" };

const metricTone = { warn: "text-warn", bad: "text-bad", ok: "text-ok", neutral: "text-ink" } as const;

function Metric({ label, value, detail, tone = "neutral" }: MetricProps) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <p className="pac-label">{label}</p>
      <p className={`mt-2 font-mono text-[28px] font-medium leading-none tracking-tight ${metricTone[tone]}`}>{value}</p>
      <p className="mt-2 truncate text-[11.5px] text-ink-3">{detail}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const overview = await loadOwnerConsoleOverview();

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pac-label !text-accent">Owner attention</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">Mission control</h1>
        </div>
        {overview.project && <ProjectContext project={overview.project} />}
      </div>

      {overview.state === "unauthenticated" && <SignInRequired />}
      {overview.state === "unavailable" && <OwnerDataUnavailable />}

      {overview.state === "available" && (
        <>
          <div className="grid grid-cols-2 divide-line rounded-pac border border-line bg-panel max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(n+3)]:border-line lg:grid-cols-4 lg:divide-x">
            <Metric
              detail={overview.queueTruncated ? "Queue shows the first 100 pending" : "Pending runtime approvals"}
              label="Pending approvals"
              tone={overview.pendingApprovals > 0 ? "warn" : "ok"}
              value={`${overview.pendingApprovals}${overview.queueTruncated ? "+" : ""}`}
            />
            <Metric
              detail="High or critical risk, pending"
              label="High / critical"
              tone={overview.highRiskApprovals > 0 ? "bad" : "neutral"}
              value={overview.highRiskApprovals}
            />
            <Metric
              detail="Distinct runs referenced by approvals"
              label="Runs requiring attention"
              tone={overview.attentionRuns.length > 0 ? "warn" : "neutral"}
              value={overview.attentionRuns.length + overview.attentionRunsUnavailable + overview.attentionRunsOmitted}
            />
            <Metric
              detail={overview.project.slug}
              label="Current project"
              value={<span className="font-sans text-lg font-semibold text-ink">{overview.project.displayName}</span>}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-12">
            <SectionCard
              action={<Link className="text-xs text-accent hover:underline" href="/approvals">All approvals →</Link>}
              className="xl:col-span-7"
              description="Pending runtime approvals, highest risk first. Read-only."
              title="Attention queue"
            >
              {overview.approvals.length === 0 ? (
                <EmptyState description="There are no pending runtime approvals for this project." title="Nothing needs your decision" />
              ) : (
                <div className="-mx-4 -my-4">
                  <ApprovalQueue approvals={overview.approvals.slice(0, 8)} compact />
                  {overview.approvals.length > 8 && (
                    <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                      +{overview.approvals.length - 8} more in <Link className="text-accent hover:underline" href="/approvals">Approvals</Link>
                    </p>
                  )}
                </div>
              )}
            </SectionCard>

            <SectionCard
              action={<Link className="text-xs text-accent hover:underline" href="/runs">Runs →</Link>}
              className="xl:col-span-5"
              description="Runs referenced by the current approval queue — not all runs."
              title="Approval-linked runs"
            >
              {overview.attentionRuns.length === 0 ? (
                <p className="text-[13px] text-ink-3">No approval-linked runs to show.</p>
              ) : (
                <div className="-mx-4 -my-4">
                  <RunTable runs={overview.attentionRuns} />
                </div>
              )}
              {overview.attentionRunsUnavailable + overview.attentionRunsOmitted > 0 && (
                <p className="mt-3 text-[11.5px] text-ink-3">
                  {overview.attentionRunsUnavailable > 0 && `${overview.attentionRunsUnavailable} referenced run(s) unavailable. `}
                  {overview.attentionRunsOmitted > 0 && `${overview.attentionRunsOmitted} more not loaded on this view.`}
                </p>
              )}
            </SectionCard>
          </div>

          <div className="mt-4 rounded-pac border border-line bg-panel px-4 py-3">
            <p className="pac-label">Data coverage</p>
            <p className="mt-1.5 text-xs leading-5 text-ink-3">
              Live: approval queue, approval-linked run overviews; per-run usage, cost and audit in Run Detail.
              Not connected yet: global run discovery, multi-project registry, task creation and approval decisions.
            </p>
          </div>
        </>
      )}
    </AppShell>
  );
}
