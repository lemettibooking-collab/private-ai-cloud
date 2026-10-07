import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { ProjectRunTable } from "@/components/domain/owner-console/project-run-table";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerRuns } from "@/lib/composition/owner-console-read.server";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";

type RunsPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const view = await loadOwnerRuns((await searchParams).project);
  const { t } = await getI18n();
  const r = t.runs;
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description={selected ? r.descriptionProject : r.descriptionAll}
        eyebrow={r.eyebrow}
        title={selected ? format(r.titleProject, { project: selected.displayName }) : r.titleAll}
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
              description={format(r.panelAllDescription, { perProject: aggregate.runsPerProjectLimit, shown: aggregate.displayLimit })}
              title={t.common.allProjects}
            >
              {view.projects.length === 0 ? (
                <EmptyState description={r.noProjectsBody} title={r.noProjectsTitle} variant="inline" />
              ) : aggregate.runs.length === 0 ? (
                <EmptyState description={r.noRunsBody} title={r.noRunsTitle} variant="inline" />
              ) : (
                <ProjectRunTable projectNames={names} runs={aggregate.runs} selectedProjectId={null} showProject />
              )}
            </SectionCard>
            {(aggregate.runsTruncated || aggregate.projectsNotConsidered > 0 || aggregate.projectsUnavailable.length > 0) && (
              <div className={`pac-inset mt-4 px-4 py-3 ${aggregate.projectsUnavailable.length > 0 ? "!border-warn/35" : ""}`}>
                <p className="pac-label">{r.coverage}</p>
                <p className="mt-1.5 text-xs leading-5 text-ink-3">
                  {r.coverageBody}
                  {aggregate.projectsNotConsidered > 0 && ` ${format(r.coverageNotConsidered, { count: aggregate.projectsNotConsidered })}`}
                  {aggregate.projectsUnavailable.length > 0 && ` ${format(r.coverageUnavailable, { projects: aggregate.projectsUnavailable.join(", ") })}`}
                </p>
              </div>
            )}
          </>
        );
      })()}

      {view.state === "available" && view.mode === "project" && (
        <SectionCard count={`${view.runs.length}${view.runsTruncated ? "+" : ""}`} description={view.runsTruncated ? format(r.projectTruncated, { limit: view.runsLimit }) : r.projectNewest} flush title={format(r.titleProject, { project: view.scope.project.displayName })}>
          {view.runs.length === 0 ? (
            <EmptyState description={r.noProjectRunsBody} title={r.noProjectRunsTitle} variant="inline" />
          ) : (
            <ProjectRunTable runs={view.runs} selectedProjectId={view.scope.project.projectId} showProject={false} />
          )}
        </SectionCard>
      )}
    </AppShell>
  );
}
