import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";
import type { StatusTone } from "@/types/app";

const roadmapTone: Record<string, StatusTone> = {
  current: "success",
  next: "warning",
  future: "neutral",
};

export default async function RoadmapPage() {
  const { locale } = await getI18n();
  const c = prototypeContent[locale].roadmap;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <SectionCard title={c.focusTitle}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm leading-6 text-slate-300">
            {c.focusBody}
          </p>
          <StatusBadge tone="success">{c.currentBadge}</StatusBadge>
        </div>
      </SectionCard>

      <div className="mt-6 space-y-4">
        {c.items.map((item) => (
          <SectionCard key={item.version}>
            <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
              <div>
                <StatusBadge tone={roadmapTone[item.status]}>
                  {c.status[item.status]}
                </StatusBadge>
                <p className="mt-4 text-3xl font-semibold text-slate-50">
                  {item.version}
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-100">
                  {item.title}
                </h2>
              </div>

              <div>
                <p className="text-sm leading-6 text-slate-400">
                  {item.description}
                </p>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {item.items.map((roadmapEntry) => (
                    <div
                      className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-sm text-slate-300"
                      key={roadmapEntry}
                    >
                      {roadmapEntry}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>
    </AppShell>
  );
}
