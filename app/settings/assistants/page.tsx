import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";

export default async function AssistantSettingsPage() {
  const { locale } = await getI18n();
  const c = prototypeContent[locale].assistants;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {c.profiles.map((assistant) => (
          <SectionCard key={assistant.name}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-50">
                {assistant.name}
              </h2>
              <StatusBadge tone="info">{c.status[assistant.status] ?? assistant.status}</StatusBadge>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {assistant.department}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {assistant.purpose}
            </p>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
