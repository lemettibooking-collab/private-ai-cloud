import Link from "next/link";
import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerApprovals } from "@/lib/composition/owner-console-read.server";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";

type ApprovalsPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// Read-only. All Projects = the full workspace queue. A selected project = only approvals whose run
// FACTUALLY belongs to it. Decisions (approve / reject) are intentionally absent: no write boundary.
export default async function ApprovalsPage({ searchParams }: ApprovalsPageProps) {
  const view = await loadOwnerApprovals((await searchParams).project);
  const { t } = await getI18n();
  const k = t.approvals;
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description={selected ? k.descriptionProject : k.descriptionAll}
        eyebrow={k.eyebrow}
        title={selected ? format(k.titleProject, { project: selected.displayName }) : k.titleAll}
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
              description={format(k.summaryAll, { pending: `${view.pendingApprovals}${view.queueTruncated ? "+" : ""}`, high: view.highRiskApprovals })}
              title={k.workspaceQueue}
            >
              {view.approvals.length === 0 ? (
                <EmptyState description={k.queueClearBody} title={k.queueClearTitle} variant="inline" />
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
              description={format(k.summaryProject, { pending: view.projectApprovals.pendingApprovals, high: view.projectApprovals.highRiskApprovals })}
              title={k.projectQueue}
            >
              {view.projectApprovals.approvals.length === 0 ? (
                <EmptyState description={k.projectClearBody} title={k.projectClearTitle} variant="inline" />
              ) : (
                <ApprovalQueue approvals={view.projectApprovals.approvals} selectedProjectId={view.scope.project.projectId} />
              )}
              {view.projectApprovals.unresolvedApprovals > 0 && (
                <p className="border-t border-line bg-warn/5 px-4 py-2 text-xs text-ink-3">
                  {format(k.unresolved, { count: view.projectApprovals.unresolvedApprovals })}{" "}
                  {k.see} <Link className="text-accent hover:underline" href="/approvals">{t.common.allProjects}</Link>.
                </p>
              )}
            </SectionCard>
          )}

          <SectionCard className="xl:col-span-3" title={k.decisionBoundary}>
            <p className="text-[13px] leading-5 text-ink-2">{t.common.readOnly}</p>
            <p className="mt-1.5 text-xs leading-5 text-ink-3">{k.decisionBody}</p>
          </SectionCard>
        </div>
      )}
    </AppShell>
  );
}
