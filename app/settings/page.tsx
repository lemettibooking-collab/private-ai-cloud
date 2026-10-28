import { AppShell } from "@/components/shell/app-shell";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";
import type { StatusTone } from "@/types/app";

const statusTone: Record<string, StatusTone> = {
  "MVP active": "success",
  "v0.2 planned": "warning",
  "planned / partial": "warning",
  future: "neutral",
  locked: "locked",
  "manual only": "warning",
};

export default async function SettingsPage() {
  const { locale } = await getI18n();
  const c = prototypeContent[locale].settings;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <SectionCard
        description={c.workspaceDescription}
        title={c.workspaceTitle}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {c.fields.map(([label, value]) => (
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
        {c.modules.map((item) => (
          <SectionCard key={item.title}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-50">
                {item.title}
              </h2>
              <StatusBadge tone={statusTone[item.status]}>
                {c.status[item.status] ?? item.status}
              </StatusBadge>
            </div>
            <p className="mt-3 min-h-16 text-sm leading-6 text-slate-400">
              {item.description}
            </p>
            <div className="mt-4">
              <ActionButton href={item.href} variant="secondary">
                {c.open}
              </ActionButton>
            </div>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
