import { AuditTimeline } from "@/components/domain/audit-timeline";
import { WorkflowLifecycle } from "@/components/domain/workflow-lifecycle";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";
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
  const { locale } = await getI18n();
  const c = prototypePages[locale].workflowRun;
  const { workflowRuns, auditEvents, labels } = prototypeMock[locale];
  const run = workflowRuns.find((item) => item.id === runId) ?? workflowRuns[0];

  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={run.title}
      />

      <WorkflowLifecycle compact />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <SectionCard title={c.summary}>
            <div className="grid gap-4 md:grid-cols-4">
              <StatusBadge tone={run.statusTone}>{labels.runStatus[run.status]}</StatusBadge>
              <div className="text-sm text-slate-400">{run.requestedBy}</div>
              <div className="text-sm text-slate-400">{run.duration}</div>
              <div className="text-sm text-slate-400">{run.updatedAt}</div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {run.outputPreview}
            </p>
          </SectionCard>

          <SectionCard title={c.stepTimeline}>
            <div className="grid gap-3">
              {(
                ["success", "success", "success", "warning", "locked"] satisfies StatusTone[]
              ).map((tone, index) => [c.steps[index], tone] as const).map(([label, tone]) => (
                <div
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-4"
                  key={label}
                >
                  <span className="text-sm text-slate-200">{label}</span>
                  <StatusBadge tone={tone}>{labels.tone[tone]}</StatusBadge>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title={c.auditTimeline}>
          <AuditTimeline events={[...auditEvents]} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
