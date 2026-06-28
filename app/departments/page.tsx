import { DepartmentFilterPanel } from "@/components/domain/department-filter-panel";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { assistantProfiles, departments } from "@/lib/mock-data";
import type { DepartmentStatus, StatusTone } from "@/types/app";

const statusTone: Record<DepartmentStatus, StatusTone> = {
  "MVP active": "success",
  "v0.2 planned": "warning",
  future: "locked",
};

export default function DepartmentsPage() {
  return (
    <AppShell>
      <PageHeader
        description="All ten AI Departments from Product Blueprint v0.2, with assistants, workflows, approval requirements, and later integrations."
        eyebrow="AI Departments"
        title="Assistant departments"
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {[
          ["MVP active", "6 departments visible in the current demo"],
          ["v0.2 planned", "3 departments planned for the next product layer"],
          ["future", "1 legal/document department reserved for later"],
        ].map(([status, detail]) => (
          <SectionCard key={status}>
            <StatusBadge tone={statusTone[status as DepartmentStatus]}>
              {status}
            </StatusBadge>
            <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
          </SectionCard>
        ))}
      </div>

      <DepartmentFilterPanel departments={departments} />

      <div className="mt-6">
        <SectionCard
          description="Assistant profiles are mocked and mapped to departments. Model routing, tools, and permissions remain prototype-only."
          title="Assistant registry"
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
                    {assistant.status}
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
