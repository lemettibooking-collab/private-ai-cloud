import Link from "next/link";
import type { FeaturePlanStepDraft } from "@/components/domain/owner-console/feature-plan-builder";
import { DependencyWaves, ExecutionStatePanels, PlanStepPanel, PlanSummary, RevisionHistory, VerificationPlan } from "@/components/domain/owner-console/feature-plan-browser";
import { FeaturePlanPlanning } from "@/components/domain/owner-console/feature-plan-planning";
import { formatTimestamp } from "@/components/domain/owner-console/format";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { TaskStatusBadge, TaskTypeLabel } from "@/components/domain/owner-console/task-status";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { loadOwnerTaskDevelopment } from "@/lib/composition/owner-console-read.server";
import { featurePlanPlannerStatus, issuePlanningFormKey } from "@/lib/composition/owner-feature-plan-draft.server";
import { issueFeaturePlanFormKey } from "@/lib/composition/owner-feature-plan-save.server";
import { developmentPriorities } from "@/lib/contracts/development-plan";
import { riskLevels } from "@/lib/contracts/domain";
import { developmentHref, featurePlanBuilderLimits } from "@/lib/development/feature-plan-model";
import { planningInterviews } from "@/lib/development/planning-interview";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectScopedHref } from "@/lib/projects/project-context";
import { saveFeaturePlanAction } from "./actions";
import { draftFeaturePlanAction } from "./draft-actions";

type TaskDevelopmentPageProps = {
  // The route carries ONLY the stable Task ID; the optional `project` selector never authorizes
  // access: under a selected project, a task of another project is the same opaque "unavailable".
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}

// AI-039 Development Workflow: ProjectTask (the development request) → persisted draft FeaturePlan
// revisions. Rendering never runs, calls a model or executor, or changes a repository; AI-039.1
// planning happens only through the Planning Interview Server Action after the Owner's explicit
// approval. Each render issues new opaque idempotency keys for the Plan Builder and the interview.
export default async function TaskDevelopmentPage({ params, searchParams }: TaskDevelopmentPageProps) {
  const { taskId } = await params;
  const view = await loadOwnerTaskDevelopment(taskId, (await searchParams).project);
  const { t } = await getI18n();
  const k = t.taskDevelopment;
  const unset = <span className="text-ink-3">{t.common.notSet}</span>;
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;
  const tasksHref = projectScopedHref("/tasks", selected?.projectId ?? null);
  const dev = view.state === "available" && view.development.state === "available" ? view.development : null;
  const task = dev?.task ?? null;
  const taskHref = task ? `/tasks/${encodeURIComponent(task.taskId)}${selected ? `?project=${encodeURIComponent(selected.projectId)}` : ""}` : tasksHref;
  const projectName = dev ? dev.project?.displayName ?? dev.task.projectId : null;
  const plans = dev?.plans.state === "available" ? dev.plans.data : null;
  const latest = plans?.latest ?? null;
  const initialSteps: FeaturePlanStepDraft[] = latest
    ? latest.plan.tasks.map((step) => ({
      id: step.id,
      title: step.title,
      goal: step.goal,
      scope: step.scope.join("\n"),
      nonGoals: step.nonGoals.join("\n"),
      allowedPaths: step.allowedPaths.join("\n"),
      acceptanceCriteria: step.acceptanceCriteria.join("\n"),
      verificationCommands: step.verificationCommands.join("\n"),
      dependsOn: [...step.dependencyIds],
      riskLevel: step.riskLevel,
      priority: step.priority,
      requiresOwnerApproval: step.requiresOwnerApproval,
    }))
    : [{
      id: "step-1", title: "", goal: "", scope: "", nonGoals: "", allowedPaths: "", acceptanceCriteria: "", verificationCommands: "",
      dependsOn: [], riskLevel: task?.riskLevel ?? "medium", priority: task?.priority ?? "P2", requiresOwnerApproval: false,
    }];

  return (
    <AppShell selectedProject={selected}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="pac-label">
            <Link className="!text-accent hover:underline" href={tasksHref}>{k.breadcrumbTasks}</Link>
            {task && <> / <Link className="!text-accent hover:underline" href={taskHref}><span className="font-mono normal-case tracking-normal">{task.taskId}</span></Link></>}
            {" "}/ {k.breadcrumbDevelopment}
          </p>
          <h1 className="mt-1 truncate text-[20px] font-semibold leading-7 tracking-tight text-ink">{task ? task.title : k.title}</h1>
          <p className="mt-1 max-w-[80ch] text-[12.5px] leading-5 text-ink-3">{k.description}</p>
        </div>
        {view.state === "available" && <ScopeBadge project={selected} />}
      </div>

      {view.state === "unauthenticated" && <SignInRequired />}
      {view.state === "unavailable" && <OwnerDataUnavailable />}
      {view.state === "project_unavailable" && <ProjectUnavailable allHref="/tasks" />}

      {view.state === "available" && view.development.state === "unavailable" && (
        <div className="pac-surface px-6 py-9 text-center">
          <p className="pac-label">{k.title}</p>
          <p className="mt-2 text-[15px] font-semibold text-ink">{k.unavailableTitle}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-5 text-ink-3">{selected ? k.unavailableInProject : k.unavailable}</p>
          <Link className="pac-control mt-5 inline-flex h-8 items-center px-3 text-[13px] text-ink-2" href={tasksHref}>{k.backToTasks}</Link>
        </div>
      )}

      {dev && task && (
        <div className="grid gap-4 xl:grid-cols-12">
          <SectionCard className="xl:col-span-7" description={k.requestDescription} title={k.request}>
            <dl className="-my-2 divide-y divide-line">
              <Meta label={k.taskId}><span className="font-mono text-[11.5px]">{task.taskId}</span></Meta>
              <Meta label={k.project}>{projectName} <span className="ml-1 font-mono text-[10.5px] text-ink-3">{task.projectId}</span></Meta>
              <Meta label={k.taskTitle}>{task.title}</Meta>
              <Meta label={k.type}><TaskTypeLabel type={task.type} /></Meta>
              <Meta label={k.priority}>{task.priority ?? unset}</Meta>
              <Meta label={k.risk}>{task.riskLevel ? t.risk[task.riskLevel] : unset}</Meta>
              <Meta label={k.status}><TaskStatusBadge status={task.status} /></Meta>
            </dl>
            <div className="mt-3 border-t border-line pt-3">
              <p className="pac-label">{k.goal}</p>
              {task.goal ? <p className="mt-1.5 max-w-[72ch] whitespace-pre-wrap text-[13px] leading-5 text-ink">{task.goal}</p> : <p className="mt-1.5 text-[12.5px] text-ink-3">{k.noGoal}</p>}
            </div>
          </SectionCard>

          <SectionCard className="xl:col-span-5" description={k.planDescription} title={k.plan}>
            {dev.plans.state === "unavailable" ? (
              <EmptyState description={k.plansUnavailableBody} title={k.plansUnavailableTitle} variant="inline" />
            ) : latest === null ? (
              <EmptyState description={k.noPlanBody} title={k.noPlanTitle} variant="inline" />
            ) : (
              <>
                <dl className="-my-2 divide-y divide-line">
                  <Meta label={k.planId}><span className="font-mono text-[11.5px]">{latest.planId}</span></Meta>
                  <Meta label={k.revision}><span className="font-mono text-[11.5px]">{latest.revision}</span></Meta>
                  <Meta label={k.planStatus}><StatusBadge tone="muted">{k.draft}</StatusBadge></Meta>
                  <Meta label={k.created}><span className="font-mono text-[11.5px]">{formatTimestamp(latest.createdAt)}</span></Meta>
                  <Meta label={k.fingerprint}><span className="font-mono text-[10.5px] text-ink-2" title={latest.fingerprint}>{latest.fingerprint.slice(0, 16)}</span></Meta>
                </dl>
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-[13.5px] font-semibold leading-5 text-ink">{latest.plan.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-ink-2">{latest.plan.goal}</p>
                </div>
              </>
            )}
          </SectionCard>

          {latest && (
            <>
              <div className="xl:col-span-12"><PlanSummary latest={latest} /></div>
              <div className="xl:col-span-12"><DependencyWaves latest={latest} /></div>
              <section aria-label={k.stepsTitle} className="grid gap-3 xl:col-span-12">
                <h2 className="pac-label !text-ink-2">{k.stepsTitle}</h2>
                {latest.plan.tasks.map((step) => <PlanStepPanel key={step.id} plan={latest.plan} step={step} />)}
              </section>
              <div className="xl:col-span-8"><VerificationPlan latest={latest} /></div>
            </>
          )}
          <div className={latest ? "xl:col-span-4" : "xl:col-span-12"}><ExecutionStatePanels /></div>
          {plans && plans.revisionCount > 0 && <div className="xl:col-span-4"><RevisionHistory data={plans} /></div>}

          <SectionCard className={plans && plans.revisionCount > 0 ? "xl:col-span-8" : "xl:col-span-12"}
            title={dev.creationBlock ? k.blockedTitle : latest ? k.planning.aiTitleNext : k.planning.aiTitle}>
            {dev.creationBlock ? (
              <p className="text-[12.5px] leading-5 text-ink-2">
                {format(k.blocked[dev.creationBlock], { status: t.taskStatus[task.status] ?? task.status })}
              </p>
            ) : (
              // AI-039 P-1: Owner Planning Interview → AI candidate → review is the primary path; the
              // technical Plan Builder is the secondary (advanced / fallback) editor.
              <FeaturePlanPlanning
                builder={{
                  action: saveFeaturePlanAction,
                  cancelHref: taskHref,
                  defaultPriority: task.priority ?? "P2",
                  defaultRisk: task.riskLevel ?? "medium",
                  formKey: issueFeaturePlanFormKey(),
                  labels: k.form,
                  limits: featurePlanBuilderLimits,
                  newFormHref: developmentHref(task.taskId, selected?.projectId ?? null),
                  priorities: developmentPriorities,
                  riskLabels: t.risk,
                  risks: riskLevels,
                  taskId: task.taskId,
                }}
                builderDescription={latest ? format(k.builderEdit, { next: latest.revision + 1 }) : k.builderNew}
                draftAction={draftFeaturePlanAction}
                hasPlan={latest !== null}
                initialGoal={latest ? latest.plan.goal : task.goal ?? ""}
                initialSteps={initialSteps}
                initialTitle={latest ? latest.plan.title : task.title}
                labels={k}
                planner={featurePlanPlannerStatus()}
                planningFormKey={issuePlanningFormKey()}
                questions={planningInterviews[task.type]}
                riskLabels={t.risk}
                saveAction={saveFeaturePlanAction}
                taskId={task.taskId}
              />
            )}
          </SectionCard>
        </div>
      )}
    </AppShell>
  );
}
