import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { integrations } from "@/lib/mock-data";
import type { StatusTone } from "@/types/app";

const integrationTone: Record<string, StatusTone> = {
  "not connected": "neutral",
  planned: "info",
  locked: "locked",
  "manual only": "warning",
};

export default function IntegrationsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Mock integration registry. Real connectors, credentials, and external actions are out of scope for this prototype."
        eyebrow="Settings"
        title="Integrations"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration) => (
          <SectionCard key={integration.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  {integration.owner}
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-50">
                  {integration.name}
                </h2>
              </div>
              <StatusBadge tone={integrationTone[integration.status]}>
                {integration.status}
              </StatusBadge>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              {integration.description}
            </p>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
