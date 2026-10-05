import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";
import type { StatusTone } from "@/types/app";

const integrationTone: Record<string, StatusTone> = {
  "not connected": "neutral",
  planned: "info",
  locked: "locked",
  "manual only": "warning",
};

export default async function IntegrationsPage() {
  const { locale } = await getI18n();
  const c = prototypeContent[locale].integrations;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {c.items.map((integration) => (
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
                {c.status[integration.status] ?? integration.status}
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
