import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { OwnerDataUnavailable, ProjectContext, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerConsoleOverview } from "@/lib/composition/owner-console-read.server";

// Read-only approval queue from OwnerReadBackend.listApprovalQueue. Decisions (approve / reject)
// are intentionally absent: the write boundary does not exist yet.
export default async function ApprovalsPage() {
  const overview = await loadOwnerConsoleOverview();

  return (
    <AppShell>
      <PageHeader
        action={overview.project ? <ProjectContext project={overview.project} /> : undefined}
        description="Pending runtime approvals for the current project, highest risk first. Each item opens its Run."
        eyebrow="Approvals"
        title="Approval queue"
      />

      {overview.state === "unauthenticated" && <SignInRequired />}
      {overview.state === "unavailable" && <OwnerDataUnavailable />}

      {overview.state === "available" && (
        <div className="grid gap-4 xl:grid-cols-12">
          <SectionCard
            className="xl:col-span-9"
            description={`${overview.pendingApprovals}${overview.queueTruncated ? "+" : ""} pending · ${overview.highRiskApprovals} high/critical`}
            title="Current approval queue"
          >
            {overview.approvals.length === 0 ? (
              <EmptyState description="There are no pending runtime approvals for this project." title="Queue is clear" />
            ) : (
              <div className="-mx-4 -my-4">
                <ApprovalQueue approvals={overview.approvals} />
              </div>
            )}
          </SectionCard>

          <SectionCard className="xl:col-span-3" title="Decision boundary">
            <p className="text-[13px] leading-5 text-ink-2">Read-only.</p>
            <p className="mt-1.5 text-xs leading-5 text-ink-3">
              Approve and reject are not available in the Owner Console yet. They require a separate,
              audited write boundary. Result acceptance, commit, push and deploy remain separate approvals.
            </p>
          </SectionCard>
        </div>
      )}
    </AppShell>
  );
}
