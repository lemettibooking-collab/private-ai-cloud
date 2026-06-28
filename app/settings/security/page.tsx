import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";

const policies = [
  ["Approval-first", "Critical actions require human approval records."],
  ["External actions", "Publish, send, run, and integration calls are locked."],
  ["Audit trail", "Generated, edited, approved, rejected, and executed states are recorded."],
  ["Secrets", "Secret references are planned; decrypted values are never shown."],
  ["Merge", "Code merge is always manual outside the system."],
];

export default function SecuritySettingsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Security, audit, and compliance controls represented as frontend-only policy cards."
        eyebrow="Settings"
        title="Security, Audit & Compliance"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {policies.map(([title, detail]) => (
          <SectionCard key={title}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-50">{title}</h2>
              <StatusBadge tone="locked">policy</StatusBadge>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
