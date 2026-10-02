import Link from "next/link";
import { OwnerDataUnavailable, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { loadOwnerProjects } from "@/lib/composition/owner-console-read.server";
import { projectScopedHref } from "@/lib/projects/project-context";

// Registered projects of the trusted workspace (authenticated registry read). The workspace comes
// only from server configuration; selecting a project here only opens its project-scoped view.
export default async function ProjectsPage() {
  const view = await loadOwnerProjects();

  return (
    <AppShell>
      <PageHeader
        description="Projects registered in this workspace. Open one to scope Dashboard, Runs and Approvals to it."
        eyebrow="Projects"
        title="Projects"
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {(view.state === "unavailable" || view.state === "project_unavailable") && <OwnerDataUnavailable />}

      {view.state === "available" && (
        <>
          <Link
            className="mb-4 flex items-center justify-between gap-3 rounded-pac border border-accent/30 bg-accent/5 px-4 py-3 hover:bg-accent/10"
            href={projectScopedHref("/dashboard", null)}
          >
            <div>
              <p className="text-[14px] font-semibold text-ink">All Projects</p>
              <p className="text-xs text-ink-3">Workspace-wide Mission Control across every registered project</p>
            </div>
            <span className="text-xs text-accent">Open →</span>
          </Link>

          <SectionCard
            description={view.projectsTruncated ? "Showing the first 100 registered projects." : `${view.projects.length} registered project(s). Archived projects are not listed.`}
            title="Registered projects"
          >
            {view.projects.length === 0 ? (
              <EmptyState description="Projects appear here once they are registered in this workspace's Project Registry." title="No projects registered" />
            ) : (
              <div className="-mx-4 -my-4 overflow-x-auto">
                <table className="min-w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line">
                      {["Project", "Status", "Repository", "Default branch", ""].map((header) => (
                        <th className="pac-label px-3 py-2 font-medium" key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {view.projects.map((project) => (
                      <tr className="hover:bg-panel-2" key={project.projectId}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-ink">{project.displayName}</p>
                          <p className="font-mono text-[11px] text-ink-3">{project.projectId}</p>
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge tone={project.status === "active" ? "success" : "warning"}>{project.status}</StatusBadge></td>
                        <td className="px-3 py-2.5 font-mono text-xs text-ink-2">{project.repository ? project.repository.url : <span className="text-ink-3">not configured</span>}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-ink-2">{project.repository?.defaultBranch ?? <span className="text-ink-3">—</span>}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Link className="text-xs text-accent hover:underline" href={projectScopedHref("/dashboard", project.projectId)}>Open dashboard →</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          <p className="mt-3 text-[11.5px] text-ink-3">Project creation and onboarding are not available yet.</p>
        </>
      )}
    </AppShell>
  );
}
