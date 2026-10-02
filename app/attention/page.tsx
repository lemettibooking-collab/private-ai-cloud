import Link from "next/link";
import { ApprovalQueue } from "@/components/domain/owner-console/approval-queue";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { TaskTable } from "@/components/domain/owner-console/task-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerAttention } from "@/lib/composition/owner-console-read.server";

type AttentionPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// My Attention: tasks waiting on the Owner, blocked, needing recovery or failed — plus pending
// approvals. A selected project narrows both factually. Read-only.
export default async function AttentionPage({ searchParams }: AttentionPageProps) {
  const view = await loadOwnerAttention((await searchParams).project);
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description="Tasks that are waiting on you, blocked, need recovery or failed — and pending approvals. Read-only."
        eyebrow="My Attention"
        title={selected ? `${selected.displayName} — my attention` : "My attention"}
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/attention" />}

      {view.state === "available" && (() => {
        const names = new Map(view.projects.map((project) => [project.projectId, project.displayName]));
        const approvals = view.mode === "all" ? view.approvals : view.projectApprovals.approvals;
        return (
          <div className="grid gap-4 xl:grid-cols-12">
            <SectionCard
              className="xl:col-span-7"
              description={view.attentionTasks.truncated ? "Bounded view: most recently updated first." : "Waiting on Owner, blocked, recovery required or failed."}
              title={`Tasks needing attention · ${view.attentionTasks.tasks.length}${view.attentionTasks.truncated ? "+" : ""}`}
            >
              {view.attentionTasks.tasks.length === 0 ? (
                <EmptyState description="No task is waiting on you, blocked, in recovery or failed." title="No task needs attention" />
              ) : (
                <div className="-mx-4 -my-4">
                  <TaskTable projectNames={names} selectedProjectId={selected?.projectId ?? null} showProject={!selected} tasks={view.attentionTasks.tasks} />
                </div>
              )}
            </SectionCard>

            <SectionCard
              className="xl:col-span-5"
              description={selected ? "Pending approvals whose run belongs to this project." : "Pending approvals across all projects."}
              title={`Pending approvals · ${approvals.length}`}
            >
              {approvals.length === 0 ? (
                <EmptyState description="No pending runtime approval." title="Approval queue is clear" />
              ) : (
                <div className="-mx-4 -my-4">
                  <ApprovalQueue approvals={approvals} compact selectedProjectId={selected?.projectId ?? null} />
                </div>
              )}
              {view.mode === "project" && view.projectApprovals.unresolvedApprovals > 0 && (
                <p className="mt-3 rounded-pac border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-ink-3">
                  {view.projectApprovals.unresolvedApprovals} workspace approval(s) could not be attributed to a project. See{" "}
                  <Link className="text-accent hover:underline" href="/attention">All Projects</Link>.
                </p>
              )}
            </SectionCard>
          </div>
        );
      })()}
    </AppShell>
  );
}
