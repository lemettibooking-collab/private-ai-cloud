import { DepartmentFilterPanel } from "@/components/domain/department-filter-panel";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeContent } from "@/lib/i18n/prototype-content";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";
import type { DepartmentStatus, StatusTone } from "@/types/app";

const statusTone: Record<DepartmentStatus, StatusTone> = {
  "MVP active": "success",
  "v0.2 planned": "warning",
  future: "locked",
};

export default async function DepartmentsPage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].departments;
  const { departments, labels } = prototypeMock[locale];
  const assistantProfiles = prototypeContent[locale].assistants.profiles;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {c.summary.map(([status, detail]) => (
          <SectionCard key={status}>
            <StatusBadge tone={statusTone[status as DepartmentStatus]}>
              {labels.departmentStatus[status as DepartmentStatus]}
            </StatusBadge>
            <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
          </SectionCard>
        ))}
      </div>

      <DepartmentFilterPanel
        departments={[...departments]}
        labels={{
          filters: c.filters,
          status: labels.departmentStatus,
          primaryAssistant: c.primaryAssistant,
          approvalRequirement: c.approvalRequirement,
          keyWorkflows: c.keyWorkflows,
          integrationsLater: c.integrationsLater,
        }}
      />

      <div className="mt-6">
        <SectionCard
          description={c.registryDescription}
          title={c.registry}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {assistantProfiles.map((assistant) => (
              <div
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-4"
                key={assistant.name}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-slate-100">
                    {assistant.name}
                  </p>
                  <StatusBadge tone={statusTone[assistant.status]}>
                    {labels.departmentStatus[assistant.status]}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {assistant.department}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
