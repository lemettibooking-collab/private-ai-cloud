import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";

const consoleBlocks = [
  ["Queues", "Workflow runs, indexing jobs, approvals, and report generation."],
  ["Retries", "Failed indexing and workflow retries will be controlled here later."],
  ["Incidents", "Operational warnings and blocked external actions."],
  ["Infrastructure", "Mock app, worker, storage, integration, and queue health."],
];

export default function OperatorConsoleSettingsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Planned operator control surface for queues, retries, incidents, and infrastructure status."
        eyebrow="Settings"
        title="Operator Console"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {consoleBlocks.map(([title, detail]) => (
          <SectionCard key={title}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-50">{title}</h2>
              <StatusBadge tone="warning">planned</StatusBadge>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
