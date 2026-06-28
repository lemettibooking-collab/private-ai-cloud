import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsModules } from "@/lib/mock-data";
import type { StatusTone } from "@/types/app";

const statusTone: Record<string, StatusTone> = {
  "MVP active": "success",
  "v0.2 planned": "warning",
  "planned / partial": "warning",
  future: "neutral",
  locked: "locked",
  "manual only": "warning",
};

export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Workspace administration surfaces for users, roles, permissions, integrations, AI settings, security, and audit logs."
        eyebrow="Settings"
        title="Core Platform controls"
      />

      <SectionCard
        description="Smart Algorithms Demo remains the first workspace in this prototype. Managed service and infrastructure controls are visible as mocked/planned modules."
        title="Company Workspace"
      >
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["Workspace", "Smart Algorithms Demo"],
            ["Platform mode", "frontend-only prototype"],
            ["External actions", "locked"],
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

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {settingsModules.map((item) => (
          <SectionCard key={item.title}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-50">
                {item.title}
              </h2>
              <StatusBadge tone={statusTone[item.status]}>
                {item.status}
              </StatusBadge>
            </div>
            <p className="mt-3 min-h-16 text-sm leading-6 text-slate-400">
              {item.description}
            </p>
            <div className="mt-4">
              <ActionButton href={item.href} variant="secondary">
                Open
              </ActionButton>
            </div>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
