import { ActionButton } from "@/components/ui/action-button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ApprovalRequest } from "@/types/approval";

type ApprovalCardProps = {
  approval: ApprovalRequest;
};

export function ApprovalCard({ approval }: ApprovalCardProps) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-50">
            {approval.title}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {approval.actionType} requested by {approval.requestedBy}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={approval.riskTone}>
            risk: {approval.riskLevel}
          </StatusBadge>
          <StatusBadge tone={approval.statusTone}>{approval.status}</StatusBadge>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">{approval.preview}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionButton disabled>Approve</ActionButton>
        <ActionButton disabled variant="danger">
          Reject
        </ActionButton>
        <ActionButton disabled variant="secondary">
          Edit
        </ActionButton>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Mocked action controls. No external action is executed in this prototype.
      </p>
    </article>
  );
}
