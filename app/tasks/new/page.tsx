import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { QuickCreateForm } from "@/components/domain/owner-console/quick-create-form";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { loadOwnerQuickCreate } from "@/lib/composition/owner-console-read.server";
import { issueQuickCreateFormKey } from "@/lib/composition/owner-task-create.server";
import { developmentPriorities } from "@/lib/contracts/development-plan";
import { riskLevels } from "@/lib/contracts/domain";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectScopedHref, quickCreateHref } from "@/lib/projects/project-context";
import { projectTaskLimits, projectTaskTypes } from "@/lib/tasks/project-task";
import { quickCreateTaskAction } from "./actions";

type NewTaskPageProps = {
  // `project` is an untrusted selector, validated by the loader against the authenticated registry.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// AI-038.4b Quick Create: the Owner records a task INTENT (draft). Each render issues a new opaque
// form idempotency key; the server re-checks Owner authority and the project on submit.
export default async function NewTaskPage({ searchParams }: NewTaskPageProps) {
  const view = await loadOwnerQuickCreate((await searchParams).project);
  const { t } = await getI18n();
  const q = t.quickCreate;
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;
  const tasksHref = projectScopedHref("/tasks", selected?.projectId ?? null);

  return (
    <AppShell selectedProject={selected}>
      <PageHeader
        action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined}
        description={q.description}
        eyebrow={q.eyebrow}
        title={selected ? format(q.titleProject, { project: selected.displayName }) : q.title}
      />

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/tasks/new" />}

      {view.state === "available" && view.target === "project_paused" && (
        <div className="max-w-4xl">
          <EmptyState
            actionHref={quickCreateHref(null)}
            actionLabel={q.chooseActive}
            description={q.pausedBody}
            title={q.pausedTitle}
          />
        </div>
      )}

      {view.state === "available" && view.target !== "project_paused" && view.creatableProjects.length === 0 && (
        <EmptyState description={q.noActiveBody} title={q.noActiveTitle} />
      )}

      {view.state === "available" && view.target !== "project_paused" && view.creatableProjects.length > 0 && (
        <SectionCard className="max-w-4xl" description={q.panelDescription} title={q.panelTitle}>
          <div>
            <QuickCreateForm
              action={quickCreateTaskAction}
              cancelHref={tasksHref}
              fixed={view.target === "project"}
              formKey={issueQuickCreateFormKey()}
              labels={q.form}
              maxGoalLength={projectTaskLimits.maxGoalLength}
              maxTitleLength={projectTaskLimits.maxTitleLength}
              newFormHref={quickCreateHref(selected?.projectId ?? null)}
              priorities={developmentPriorities}
              projects={view.creatableProjects.map((project) => ({ projectId: project.projectId, displayName: project.displayName }))}
              riskLabels={t.risk}
              risks={riskLevels}
              typeLabels={t.taskType}
              types={projectTaskTypes}
            />
          </div>
        </SectionCard>
      )}
    </AppShell>
  );
}
