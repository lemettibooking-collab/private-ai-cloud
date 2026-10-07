import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";

export default async function SecuritySettingsPage() {
  const { locale } = await getI18n();
  const c = prototypeContent[locale].security;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {c.policies.map(([title, detail]) => (
          <SectionCard key={title}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-50">{title}</h2>
              <StatusBadge tone="locked">{c.badge}</StatusBadge>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
