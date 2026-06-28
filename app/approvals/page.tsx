import { ApprovalCard } from "@/components/domain/approval-card";
import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { approvals } from "@/lib/mock-data";

export default function ApprovalsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Human review queue for generated outputs and locked external actions. All action buttons are mocked or disabled."
        eyebrow="Approvals"
        title="Approval queue"
      />

      <SectionCard title="Approval-first policy">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["External actions", "locked by default"],
            ["Audit trail", "required for every request"],
            ["Merge", "always manual outside the system"],
          ].map(([label, value]) => (
            <div
              className="rounded-lg border border-slate-800 bg-slate-900/50 p-4"
              key={label}
            >
              <p className="text-xs font-medium uppercase text-slate-500">
                {label}
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-100">
                {value}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="my-6 flex flex-wrap gap-2">
        {["All", "Pending", "High risk", "Blocked", "Edited"].map(
          (filter, index) => (
            <StatusBadge key={filter} tone={index === 0 ? "info" : "neutral"}>
              {filter}
            </StatusBadge>
          ),
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {approvals.map((approval) => (
          <div className="space-y-3" key={approval.id}>
            <ApprovalCard approval={approval} />
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
              <div className="grid gap-3 lg:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">
                    Allowed approvers
                  </p>
                  <p className="mt-2 text-sm text-slate-300">
                    {approval.allowedApprovers?.join(", ") ?? "Owner"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">
                    Risk level
                  </p>
                  <div className="mt-2">
                    <StatusBadge tone={approval.riskTone}>
                      {approval.riskLevel}
                    </StatusBadge>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">
                    Audit trail hint
                  </p>
                  <p className="mt-2 text-sm text-slate-300">
                    {approval.auditHint}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <ActionButton href={`/approvals/${approval.id}`} variant="secondary">
                  Open detail
                </ActionButton>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <SectionCard title="Approval detail placeholder">
          <div className="grid gap-4 lg:grid-cols-3">
            {["Original payload", "Edited payload", "Final payload"].map(
              (label) => (
                <div
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
                  key={label}
                >
                  <p className="text-sm font-medium text-slate-100">{label}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Before/after preview will be shown here when a queue item is
                    selected.
                  </p>
                </div>
              ),
            )}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
