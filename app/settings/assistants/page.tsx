import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { assistantProfiles } from "@/lib/mock-data";

export default function AssistantSettingsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Mock assistant registry for department ownership, model policy, allowed tools, and safety defaults."
        eyebrow="Settings"
        title="AI Assistants"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {assistantProfiles.map((assistant) => (
          <SectionCard key={assistant.name}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-50">
                {assistant.name}
              </h2>
              <StatusBadge tone="info">{assistant.status}</StatusBadge>
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
