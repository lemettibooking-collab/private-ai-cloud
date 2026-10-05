import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { ProjectRunTable } from "@/components/domain/owner-console/project-run-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerRuns } from "@/lib/composition/owner-console-read.server";

type RunsPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const view = await loadOwnerRuns((await searchParams).project);
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description={selected
          ? "Runs of the selected project, newest first."
          : "Recent runs of registered projects, newest first. Each run keeps its factual project."}
        eyebrow="Runs"
        title={selected ? `${selected.displayName} runs` : "Recent project runs"}
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/runs" />}

      {view.state === "available" && view.mode === "all" && (() => {
        const names = new Map(view.projects.map((project) => [project.projectId, project.displayName]));
        const aggregate = view.aggregate;
        return (
          <>
            <SectionCard
              count={aggregate.runs.length}
              flush
              description={`Registered-project runs (up to ${aggregate.runsPerProjectLimit} newest per project, ${aggregate.displayLimit} shown).`}
              title="All Projects"
            >
              {view.projects.length === 0 ? (
                <EmptyState description="Runs appear here once projects are registered in this workspace." title="No projects registered" variant="inline" />
              ) : aggregate.runs.length === 0 ? (
                <EmptyState description="The registered projects have no runs yet." title="No runs" variant="inline" />
              ) : (
                <ProjectRunTable projectNames={names} runs={aggregate.runs} selectedProjectId={null} showProject />
              )}
            </SectionCard>
            {(aggregate.runsTruncated || aggregate.projectsNotConsidered > 0 || aggregate.projectsUnavailable.length > 0) && (
              <div className={`pac-inset mt-4 px-4 py-3 ${aggregate.projectsUnavailable.length > 0 ? "!border-warn/35" : ""}`}>
                <p className="pac-label">Coverage</p>
                <p className="mt-1.5 text-xs leading-5 text-ink-3">
                  This is a bounded view, not complete run history.
                  {aggregate.projectsNotConsidered > 0 && ` ${aggregate.projectsNotConsidered} more project(s) are not included; select a project to see its runs.`}
                  {aggregate.projectsUnavailable.length > 0 && ` Runs unavailable for: ${aggregate.projectsUnavailable.join(", ")}.`}
                </p>
              </div>
            )}
          </>
        );
      })()}

      {view.state === "available" && view.mode === "project" && (
        <SectionCard count={`${view.runs.length}${view.runsTruncated ? "+" : ""}`} description={view.runsTruncated ? `Newest ${view.runsLimit} runs shown.` : "Newest first."} flush title={`${view.scope.project.displayName} runs`}>
          {view.runs.length === 0 ? (
            <EmptyState description="No run has been recorded for this project." title="No project runs" variant="inline" />
          ) : (
            <ProjectRunTable runs={view.runs} selectedProjectId={view.scope.project.projectId} showProject={false} />
          )}
        </SectionCard>
      )}
    </AppShell>
  );
}
