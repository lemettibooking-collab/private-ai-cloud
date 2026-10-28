import Link from "next/link";
import { OwnerDataUnavailable, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { ProjectStatusBadge } from "@/components/domain/owner-console/run-status";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerProjects } from "@/lib/composition/owner-console-read.server";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectScopedHref } from "@/lib/projects/project-context";

// Registered projects of the trusted workspace (authenticated registry read). The workspace comes
// only from server configuration; selecting a project here only opens its project-scoped view.
export default async function ProjectsPage() {
  const view = await loadOwnerProjects();
  const { t } = await getI18n();
  const k = t.projects;

  return (
    <AppShell>
      <PageHeader
        description={k.description}
        eyebrow={k.eyebrow}
        title={k.title}
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {(view.state === "unavailable" || view.state === "project_unavailable") && <OwnerDataUnavailable />}

      {view.state === "available" && (
        <>
          <Link
            className="pac-surface mb-4 flex items-center justify-between gap-3 !border-accent/30 px-4 py-3 transition-colors hover:!border-accent/50"
            href={projectScopedHref("/dashboard", null)}
          >
            <div>
              <p className="text-[14px] font-semibold text-ink">{t.common.allProjects}</p>
              <p className="text-xs text-ink-3">{k.allProjectsBody}</p>
            </div>
            <span className="text-xs text-accent">{k.open}</span>
          </Link>

          <SectionCard
            count={view.projects.length}
            flush
            description={view.projectsTruncated ? k.first100 : format(k.registeredCount, { count: view.projects.length })}
            title={k.registered}
          >
            {view.projects.length === 0 ? (
              <EmptyState description={k.noProjectsBody} title={k.noProjectsTitle} variant="inline" />
            ) : (
              <div className="overflow-x-auto">
                <table className="pac-table">
                  <thead>
                    <tr>
                      {[k.headProject, k.headStatus, k.headRepository, k.headBranch, ""].map((header) => (
                        <th key={header || "open"} scope="col">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.projects.map((project) => (
                      <tr key={project.projectId}>
                        <td>
                          <Link className="text-[13.5px] font-medium text-ink hover:text-accent" href={projectScopedHref("/dashboard", project.projectId)}>{project.displayName}</Link>
                          <p className="pac-id">{project.projectId}</p>
                        </td>
                        <td><ProjectStatusBadge status={project.status} /></td>
                        <td className="font-mono text-[11.5px] text-ink-2">{project.repository ? project.repository.url : <span className="text-ink-3">{k.notConfigured}</span>}</td>
                        <td className="font-mono text-[11.5px] text-ink-2">{project.repository?.defaultBranch ?? <span className="text-ink-3">—</span>}</td>
                        <td className="text-right">
                          <Link className="text-xs text-accent hover:underline" href={projectScopedHref("/dashboard", project.projectId)}>{k.openDashboard}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          <p className="mt-3 text-[11.5px] text-ink-3">{k.footnote}</p>
        </>
      )}
    </AppShell>
  );
}
