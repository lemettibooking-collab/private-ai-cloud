import { AuditTimeline } from "@/components/domain/audit-timeline";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

type ApprovalDetailPageProps = {
  params: Promise<{
    approvalId: string;
  }>;
};

export default async function ApprovalDetailPage({
  params,
}: ApprovalDetailPageProps) {
  const { approvalId } = await params;
  const { locale } = await getI18n();
  const c = prototypePages[locale].approvalDetail;
  const { approvals, auditEvents, labels } = prototypeMock[locale];
  const approval =
    approvals.find((item) => item.id === approvalId) ?? approvals[0];

  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={approval.title}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <SectionCard title={c.decisionSummary}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                [c.actionType, approval.actionType],
                [c.requestedBy, approval.requestedBy],
                [c.allowedApprovers, approval.allowedApprovers?.join(", ") ?? c.ownerFallback],
                [c.status, labels.approvalStatus[approval.status]],
              ].map(([label, value]) => (
                <div
                  className="rounded-lg border border-slate-800 bg-slate-900/50 p-3"
                  key={label}
                >
                  <p className="text-xs font-medium uppercase text-slate-500">
                    {label}
                  </p>
                  <p className="mt-2 text-sm text-slate-200">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusBadge tone={approval.riskTone}>
                {format(c.riskPrefix, { risk: labels.risk[approval.riskLevel] })}
              </StatusBadge>
              <StatusBadge tone={approval.statusTone}>{labels.approvalStatus[approval.status]}</StatusBadge>
              <StatusBadge tone="locked">{c.finalLocked}</StatusBadge>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {approval.preview}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ActionButton disabled>{c.approve}</ActionButton>
              <ActionButton disabled variant="danger">
                {c.reject}
              </ActionButton>
              <ActionButton disabled variant="secondary">
                {c.editPayload}
              </ActionButton>
            </div>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title={c.originalOutput}>
              <p className="text-sm leading-6 text-slate-400">
                {approval.originalOutput ?? approval.preview}
              </p>
            </SectionCard>
            <SectionCard title={c.editedOutput}>
              <p className="text-sm leading-6 text-slate-400">
                {approval.editedOutput ?? approval.preview}
              </p>
            </SectionCard>
            <SectionCard title={c.finalOutput}>
              <p className="text-sm leading-6 text-slate-400">
                {approval.finalOutput ?? approval.preview}
              </p>
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title={c.sourceDocuments}>
              <div className="flex flex-wrap gap-2">
                {(approval.sourceDocuments ?? [c.sourceFallback]).map(
                  (source) => (
                    <StatusBadge key={source} tone="info">
                      {source}
                    </StatusBadge>
                  ),
                )}
              </div>
            </SectionCard>

            <SectionCard title={c.riskNotes}>
              <div className="space-y-2">
                {(approval.riskNotes ?? [c.riskFallback]).map((note) => (
                  <div
                    className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm leading-6 text-slate-300"
                    key={note}
                  >
                    {note}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {c.noExternal}
              </p>
            </SectionCard>
          </div>
        </div>

        <SectionCard title={c.auditTrail}>
          <AuditTimeline events={[...auditEvents]} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
