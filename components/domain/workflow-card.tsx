import { ActionButton } from "@/components/ui/action-button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkflowTemplate } from "@/types/workflow";

type WorkflowCardProps = {
  workflow: WorkflowTemplate;
};

export function WorkflowCard({ workflow }: WorkflowCardProps) {
  return (
    <article className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-950/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            {workflow.department}
          </p>
          <h3 className="mt-2 text-lg font-semibold text-slate-50">
            {workflow.title}
          </h3>
        </div>
        <StatusBadge tone={workflow.approvalRequired ? "warning" : "success"}>
          {workflow.approvalRequired ? "approval required" : "review optional"}
        </StatusBadge>
      </div>
      <p className="mt-4 flex-1 text-sm leading-6 text-slate-400">
        {workflow.description}
      </p>
      <div className="mt-5">
        <ActionButton href={workflow.href}>Run workflow</ActionButton>
      </div>
    </article>
  );
}
