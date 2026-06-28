import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { roles } from "@/lib/roles";

export default function RolesPage() {
  return (
    <AppShell>
      <PageHeader
        description="Role-based UI model with first screens and permission summaries for the MVP prototype."
        eyebrow="Settings"
        title="Roles and permissions"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((role) => (
          <SectionCard key={role.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-50">
                  {role.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  First screen: {role.landing}
                </p>
              </div>
              <StatusBadge tone={role.id === "owner" ? "info" : "neutral"}>
                role
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
