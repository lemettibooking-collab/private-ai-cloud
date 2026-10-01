import { OwnerDataUnavailable, ProjectContext, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { RunTable } from "@/components/domain/owner-console/run-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerConsoleOverview } from "@/lib/composition/owner-console-read.server";

// The Owner read surface has no global run listing yet, so this page shows only the Runs that the
// current approval queue references — and says so.
export default async function RunsPage() {
  const overview = await loadOwnerConsoleOverview();

  return (
    <AppShell>
      <PageHeader
        action={overview.project ? <ProjectContext project={overview.project} /> : undefined}
        description="Runs that currently require attention through the approval queue. Global run discovery is not connected yet."
        eyebrow="Runs"
        title="Runs requiring attention"
      />

      {overview.state === "unauthenticated" && <SignInRequired />}
      {overview.state === "unavailable" && <OwnerDataUnavailable />}

      {overview.state === "available" && (
        <>
          <SectionCard description="Distinct runs referenced by pending approvals." title="Approval-linked runs">
            {overview.attentionRuns.length === 0 ? (
              <EmptyState
                description="No run is referenced by a pending approval. Other runs exist only once global run discovery is connected."
                title="No runs require attention"
              />
            ) : (
              <div className="-mx-4 -my-4">
                <RunTable runs={overview.attentionRuns} />
              </div>
            )}
            {overview.attentionRunsUnavailable + overview.attentionRunsOmitted > 0 && (
              <p className="mt-3 text-[11.5px] text-ink-3">
                {overview.attentionRunsUnavailable > 0 && `${overview.attentionRunsUnavailable} referenced run(s) unavailable. `}
                {overview.attentionRunsOmitted > 0 && `${overview.attentionRunsOmitted} more referenced run(s) not loaded on this view.`}
              </p>
            )}
          </SectionCard>

          <div className="mt-4 rounded-pac border border-dashed border-line-strong px-4 py-3">
            <p className="pac-label">Global run discovery</p>
            <p className="mt-1.5 text-xs leading-5 text-ink-3">
              Not connected. Listing all runs needs a new, separately reviewed Owner read capability.
            </p>
          </div>
        </>
      )}
    </AppShell>
  );
}
