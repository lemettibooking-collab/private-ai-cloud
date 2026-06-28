import { AuditTimeline } from "@/components/domain/audit-timeline";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { approvals, auditEvents } from "@/lib/mock-data";

type ApprovalDetailPageProps = {
  params: Promise<{
    approvalId: string;
  }>;
};

export default async function ApprovalDetailPage({
  params,
}: ApprovalDetailPageProps) {
  const { approvalId } = await params;
  const approval =
    approvals.find((item) => item.id === approvalId) ?? approvals[0];

  return (
    <AppShell>
      <PageHeader
        description="Approval detail with risk, before/after payload preview, comments placeholder, and disabled controls."
        eyebrow="Approval detail"
        title={approval.title}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <SectionCard title="Decision summary">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Action type", approval.actionType],
                ["Requested by", approval.requestedBy],
                ["Allowed approvers", approval.allowedApprovers?.join(", ") ?? "Owner"],
                ["Status", approval.status],
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
                risk: {approval.riskLevel}
              </StatusBadge>
              <StatusBadge tone={approval.statusTone}>{approval.status}</StatusBadge>
              <StatusBadge tone="locked">final action locked</StatusBadge>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {approval.preview}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ActionButton disabled>Approve</ActionButton>
              <ActionButton disabled variant="danger">
                Reject
              </ActionButton>
              <ActionButton disabled variant="secondary">
                Edit payload
              </ActionButton>
            </div>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title="Original AI output">
              <p className="text-sm leading-6 text-slate-400">
                {approval.originalOutput ?? approval.preview}
              </p>
            </SectionCard>
            <SectionCard title="Edited output">
              <p className="text-sm leading-6 text-slate-400">
                {approval.editedOutput ?? approval.preview}
              </p>
            </SectionCard>
            <SectionCard title="Final output">
              <p className="text-sm leading-6 text-slate-400">
                {approval.finalOutput ?? approval.preview}
              </p>
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Source documents">
              <div className="flex flex-wrap gap-2">
                {(approval.sourceDocuments ?? ["Smart Algorithms Roadmap"]).map(
                  (source) => (
                    <StatusBadge key={source} tone="info">
                      {source}
                    </StatusBadge>
                  ),
                )}
              </div>
            </SectionCard>

            <SectionCard title="Risk notes">
              <div className="space-y-2">
                {(approval.riskNotes ?? ["Human review required."]).map((note) => (
                  <div
                    className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm leading-6 text-slate-300"
                    key={note}
                  >
                    {note}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                No external action is executed in prototype.
              </p>
            </SectionCard>
          </div>
        </div>

        <SectionCard title="Audit trail">
          <AuditTimeline events={auditEvents} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
