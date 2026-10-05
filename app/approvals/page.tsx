import Link from "next/link";
import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerApprovals } from "@/lib/composition/owner-console-read.server";

type ApprovalsPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// Read-only. All Projects = the full workspace queue. A selected project = only approvals whose run
// FACTUALLY belongs to it. Decisions (approve / reject) are intentionally absent: no write boundary.
export default async function ApprovalsPage({ searchParams }: ApprovalsPageProps) {
  const view = await loadOwnerApprovals((await searchParams).project);
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description={selected
          ? "Pending runtime approvals whose run belongs to this project, highest risk first. Each item opens its run."
          : "The workspace approval queue across all projects, highest risk first. Each item opens its run."}
        eyebrow="Approvals"
        title={selected ? `${selected.displayName} approvals` : "All Projects approval queue"}
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/approvals" />}

      {view.state === "available" && (
        <div className="grid gap-4 xl:grid-cols-12">
          {view.mode === "all" ? (
            <SectionCard
              className="xl:col-span-9"
              count={`${view.pendingApprovals}${view.queueTruncated ? "+" : ""}`}
              flush
              tone="attention"
              description={`${view.pendingApprovals}${view.queueTruncated ? "+" : ""} pending · ${view.highRiskApprovals} high/critical · workspace-wide`}
              title="Workspace approval queue"
            >
              {view.approvals.length === 0 ? (
                <EmptyState description="There are no pending runtime approvals in this workspace." title="Queue is clear" variant="inline" />
              ) : (
                <ApprovalQueue approvals={view.approvals} />
              )}
            </SectionCard>
          ) : (
            <SectionCard
              className="xl:col-span-9"
              count={view.projectApprovals.pendingApprovals}
              flush
              tone="attention"
              description={`${view.projectApprovals.pendingApprovals} pending · ${view.projectApprovals.highRiskApprovals} high/critical · this project`}
              title="Project approval queue"
            >
              {view.projectApprovals.approvals.length === 0 ? (
                <EmptyState description="No pending runtime approval belongs to this project." title="Project queue is clear" variant="inline" />
              ) : (
                <ApprovalQueue approvals={view.projectApprovals.approvals} selectedProjectId={view.scope.project.projectId} />
              )}
              {view.projectApprovals.unresolvedApprovals > 0 && (
                <p className="border-t border-line bg-warn/5 px-4 py-2 text-xs text-ink-3">
                  {view.projectApprovals.unresolvedApprovals} workspace approval(s) could not be attributed to a project and are not shown here.
                  See <Link className="text-accent hover:underline" href="/approvals">All Projects</Link>.
                </p>
              )}
            </SectionCard>
          )}

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
