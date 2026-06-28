import { AuditTimeline } from "@/components/domain/audit-timeline";
import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { auditEvents, workflowRuns } from "@/lib/mock-data";
import type { StatusTone } from "@/types/app";

type WorkflowRunDetailPageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function WorkflowRunDetailPage({
  params,
}: WorkflowRunDetailPageProps) {
  const { runId } = await params;
  const run = workflowRuns.find((item) => item.id === runId) ?? workflowRuns[0];

  return (
    <AppShell>
      <PageHeader
        description="Workflow run detail with input/output placeholders, step statuses, and audit timeline."
        eyebrow="Workflow run detail"
        title={run.title}
      />

      <WorkflowLifecycle compact />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <SectionCard title="Run summary">
            <div className="grid gap-4 md:grid-cols-4">
              <StatusBadge tone={run.statusTone}>{run.status}</StatusBadge>
              <div className="text-sm text-slate-400">{run.requestedBy}</div>
              <div className="text-sm text-slate-400">{run.duration}</div>
              <div className="text-sm text-slate-400">{run.updatedAt}</div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {run.outputPreview}
            </p>
          </SectionCard>

          <SectionCard title="Step timeline">
            <div className="grid gap-3">
              {(
                [
                ["Input captured", "success"],
                ["Knowledge retrieved", "success"],
                ["AI output generated", "success"],
                ["Approval requested", "warning"],
                ["External action", "locked"],
              ] satisfies Array<[string, StatusTone]>
              ).map(([label, tone]) => (
                <div
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-4"
                  key={label}
                >
                  <span className="text-sm text-slate-200">{label}</span>
                  <StatusBadge tone={tone}>{tone}</StatusBadge>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Audit timeline">
          <AuditTimeline events={auditEvents} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
