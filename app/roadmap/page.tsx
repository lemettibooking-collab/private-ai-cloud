import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { roadmapItems } from "@/lib/mock-data";
import type { StatusTone } from "@/types/app";

const roadmapTone: Record<string, StatusTone> = {
  current: "success",
  next: "warning",
  future: "neutral",
};

export default function RoadmapPage() {
  return (
    <AppShell>
      <PageHeader
        description="Product roadmap from the current Smart Algorithms internal demo to the future owned AI infrastructure layer."
        eyebrow="Roadmap"
        title="Private AI Cloud roadmap"
      />

      <SectionCard title="MVP focus">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm leading-6 text-slate-300">
            The current prototype focuses on v0.1: Smart Algorithms Internal
            Demo. Later versions are visible to show product direction, not to
            imply implemented backend, integrations, or infrastructure.
          </p>
          <StatusBadge tone="success">current: v0.1</StatusBadge>
        </div>
      </SectionCard>

      <div className="mt-6 space-y-4">
        {roadmapItems.map((item) => (
          <SectionCard key={item.version}>
            <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
              <div>
                <StatusBadge tone={roadmapTone[item.status]}>
                  {item.status}
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
