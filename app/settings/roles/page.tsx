import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";

export default async function RolesPage() {
  const { locale } = await getI18n();
  const c = prototypeContent[locale].roles;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {c.items.map((role) => (
          <SectionCard key={role.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-50">
                  {role.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {c.firstScreen} <span className="font-mono">{role.landing}</span>
                </p>
              </div>
              <StatusBadge tone={role.id === "owner" ? "info" : "neutral"}>
                {c.badge}
              </StatusBadge>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {role.summary}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {role.permissions.map((permission) => (
                <StatusBadge key={permission} tone="neutral">
                  {permission}
                </StatusBadge>
              ))}
            </div>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
