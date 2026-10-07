"use client";

import { useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  developmentPlanDemoScenarios,
  evaluateDevelopmentPlanDemoScenario,
  type DevelopmentPlanDemoScenarioId,
} from "@/lib/development-plan-demo";
import { format } from "@/lib/i18n/locale";
import type { PrototypePages } from "@/lib/i18n/prototype-pages";
import type { DevelopmentTask } from "@/lib/contracts/development-plan";
import type { DevelopmentTaskAdmissionVerdict } from "@/lib/contracts/development-task-policy";

const verdictPanelClass: Readonly<
  Record<DevelopmentTaskAdmissionVerdict, string>
> = {
  allow: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  require_approval: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  deny: "border-rose-400/30 bg-rose-400/10 text-rose-100",
};

// AI-038.6 L10N-2: all copy comes from lib/i18n/prototype-pages (devPlan); the simulator, its demo
// data and the domain decisions are unchanged. Ids, paths, reason codes and raw contract messages are
// shown as they are.
type PlanCopy = PrototypePages["devPlan"];

function BooleanValue({ value, c }: { value: boolean; c: PlanCopy }) {
  return (
    <span className={value ? "text-emerald-300" : "text-slate-400"}>
      {value ? c.yes : c.no}
    </span>
  );
}

function TokenList({
  values,
  emptyLabel,
}: {
  values: readonly string[];
  emptyLabel: string;
}) {
  if (values.length === 0) {
    return <span className="text-sm text-slate-500">{emptyLabel}</span>;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {values.map((value) => (
        <code
          className="max-w-full break-all rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs leading-5 text-slate-300"
          key={value}
        >
          {value}
        </code>
      ))}
    </div>
  );
}

function TaskCard({ task, c }: { task: DevelopmentTask; c: PlanCopy }) {
  const tasks = c.tasks as Readonly<Record<string, string>>;
  return (
    <article className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {format(c.orderInPlan, { n: task.sequence })}
          </p>
          <h4 className="mt-1 break-words text-sm font-semibold text-slate-100">
            {tasks[task.id] ?? task.title}
          </h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="info">{format(c.priority, { value: task.priority })}</StatusBadge>
          <StatusBadge
            tone={
              task.riskLevel === "high" || task.riskLevel === "critical"
                ? "warning"
                : "neutral"
            }
          >
            {format(c.risk, { value: c.riskLevels[task.riskLevel] })}
          </StatusBadge>
        </div>
      </div>

      <dl className="mt-4 min-w-0 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-slate-500">
            {c.dependsOn}
          </dt>
          <dd className="mt-1">
            <TokenList emptyLabel={c.none} values={task.dependencyIds} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">
            {c.agentFiles}
          </dt>
          <dd className="mt-1">
            <TokenList emptyLabel={c.none} values={task.allowedPaths} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-xs font-medium text-slate-500">
            {c.ownerDecisionNeeded}
          </dt>
          <dd className="text-sm">
            <BooleanValue c={c} value={task.requiresOwnerApproval} />
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function DevelopmentPlanSimulator({ copy: c }: { copy: PlanCopy }) {
  const tasks = c.tasks as Readonly<Record<string, string>>;
  const scenarioText = c.scenarios as Readonly<Record<string, readonly string[]>>;
  const initialScenario = developmentPlanDemoScenarios[0];
  const [scenarioId, setScenarioId] =
    useState<DevelopmentPlanDemoScenarioId>(initialScenario.id);
  const [ownerApprovalGranted, setOwnerApprovalGranted] = useState<boolean>(
    initialScenario.defaultOwnerApprovalGranted,
  );
  const result = evaluateDevelopmentPlanDemoScenario(
    scenarioId,
    ownerApprovalGranted,
  );
  const selectedTask = result.plan.tasks.find(
    (task) => task.id === result.input.taskId,
  );

  function selectScenario(nextScenarioId: DevelopmentPlanDemoScenarioId) {
    const nextScenario = developmentPlanDemoScenarios.find(
      (scenario) => scenario.id === nextScenarioId,
    );

    setScenarioId(nextScenarioId);
    setOwnerApprovalGranted(
      nextScenario?.defaultOwnerApprovalGranted ?? false,
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <SectionCard
        title={c.howTitle}
        description={c.howDescription}
      >
        <ol className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {c.steps.map(([title, description], index) => (
            <li
              className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-4"
              key={title}
            >
              <span className="inline-flex size-8 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-sm font-semibold text-cyan-200">
                {index + 1}
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-100">
                {title}
              </h3>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                {description}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-100">
          {c.demoPlanNote}
        </p>
      </SectionCard>

      <section
        aria-labelledby="development-plan-instruction-title"
        className="min-w-0 rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 p-4"
      >
        <h2
          className="text-sm font-semibold text-fuchsia-100"
          id="development-plan-instruction-title"
        >
          {c.nowTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-fuchsia-100/80">
          {c.nowBody}
        </p>
      </section>

      <SectionCard
        title={c.examplesTitle}
        description={c.examplesDescription}
      >
        <fieldset className="min-w-0">
          <legend className="sr-only">
            {c.examplesLegend}
          </legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {developmentPlanDemoScenarios.map((scenario) => {
              const selected = scenario.id === scenarioId;

              return (
                <label
                  className="flex min-w-0 cursor-pointer flex-col rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-400/60 has-checked:border-cyan-400/50 has-checked:bg-cyan-400/10"
                  key={scenario.id}
                >
                  <span className="flex items-start gap-3">
                    <input
                      checked={selected}
                      className="mt-1 size-4 shrink-0 accent-cyan-400"
                      name="development-plan-scenario"
                      onChange={() => selectScenario(scenario.id)}
                      type="radio"
                      value={scenario.id}
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-slate-100">
                        {scenarioText[scenario.id]?.[0] ?? scenario.title}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {scenarioText[scenario.id]?.[1] ?? scenario.description}
                      </span>
                    </span>
                  </span>
                  <span className="mt-3 text-xs font-medium text-cyan-200">
                    {selected ? c.exampleSelected : c.viewExample}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {(scenarioId === "approval-required" ||
          scenarioId === "forbidden-active-path") && (
          <label className="mt-5 flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 focus-within:ring-2 focus-within:ring-amber-300/60">
            <input
              checked={ownerApprovalGranted}
              className="mt-1 size-4 shrink-0 accent-amber-300"
              onChange={(event) =>
                setOwnerApprovalGranted(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-amber-100">
                {c.ownerApproved}
              </span>
              <span className="mt-1 block text-xs leading-5 text-amber-100/70">
                {scenarioId === "forbidden-active-path"
                  ? c.denyByDefaultNote
                  : c.toggleNote}
              </span>
            </span>
          </label>
        )}
      </SectionCard>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard
          className="min-w-0"
          title={c.planTitle}
          description={c.planDescription}
          action={<StatusBadge tone="success">{c.planVerified}</StatusBadge>}
        >
          <dl className="min-w-0 space-y-4 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-500">{c.feature}</dt>
              <dd className="mt-1 font-semibold text-slate-100">
                {result.plan.id === "development-plan-simulator" ? c.planText[0] : result.plan.title}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">{c.goal}</dt>
              <dd className="mt-1 leading-6 text-slate-300">
                {result.plan.id === "development-plan-simulator" ? c.planText[1] : result.plan.goal}
              </dd>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <dt className="text-xs text-slate-500">{c.status}</dt>
                <dd className="mt-1 text-slate-200">
                  {c.planStatus[result.plan.status]}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <dt className="text-xs text-slate-500">{c.stagesInPlan}</dt>
                <dd className="mt-1 text-slate-200">
                  {result.plan.tasks.length}
                </dd>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <dt className="text-xs text-slate-500">{c.checkedStage}</dt>
                <dd className="mt-1 break-words text-slate-200">
                  {selectedTask ? (tasks[selectedTask.id] ?? selectedTask.title) : result.input.taskId}
                </dd>
              </div>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">
                {c.alreadyCompleted}
              </dt>
              <dd className="mt-2">
                <TokenList emptyLabel={c.none} values={result.input.completedTaskIds} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">
                {c.runningNow}
              </dt>
              <dd className="mt-2">
                <TokenList emptyLabel={c.none} values={result.input.activeTaskIds} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">
                {c.allowedFiles}
              </dt>
              <dd className="mt-2">
                <TokenList emptyLabel={c.none} values={result.input.repositoryAllowlist} />
              </dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard
          className="min-w-0"
          title={c.decisionTitle}
          description={c.decisionDescription}
        >
          <div className="min-w-0 space-y-4">
            <div
              aria-live="polite"
              className={`rounded-lg border p-5 ${verdictPanelClass[result.decision.verdict]}`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
                {c.systemDecision}
              </p>
              <p className="mt-2 text-xl font-semibold leading-7">
                {c.verdicts[result.decision.verdict]}
              </p>
              <p className="mt-3 text-sm leading-6 opacity-80">
                {c.verdictExplanations[result.decision.verdict]}
              </p>
            </div>

            {result.decision.reasons.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {c.reasonsTitle}
                </h3>
                <ul className="mt-3 min-w-0 space-y-3">
                  {result.decision.reasons.map((reason, index) => (
                    <li
                      className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/40 p-4"
                      key={`${reason.code}-${reason.path}-${reason.relatedTaskId ?? "none"}-${index}`}
                    >
                      <p className="text-sm leading-6 text-slate-200">
                        {c.reasons[reason.code]}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
                {c.noBlocking}
              </p>
            )}

            <details className="group min-w-0 rounded-lg border border-slate-800 bg-slate-900/40">
              <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium text-slate-300 marker:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">
                {c.technicalTitle}
              </summary>
              <div className="min-w-0 space-y-4 border-t border-slate-800 p-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    {c.canonicalVerdict}
                  </p>
                  <code className="mt-1 block break-all text-sm font-semibold text-slate-200">
                    {result.decision.verdict}
                  </code>
                </div>

                {result.decision.reasons.length > 0 && (
                  <div className="min-w-0 space-y-3">
                    {result.decision.reasons.map((reason, index) => (
                      <dl
                        className="min-w-0 space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs"
                        key={`${reason.code}-${reason.path}-${reason.relatedTaskId ?? "none"}-technical-${index}`}
                      >
                        <div>
                          <dt className="text-slate-500">{c.reasonCode}</dt>
                          <dd>
                            <code className="break-all text-rose-200">
                              {reason.code}
                            </code>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">{c.rawMessage}</dt>
                          <dd className="break-words leading-5 text-slate-300">
                            {reason.message}
                          </dd>
                        </div>
                        {reason.path && (
                          <div>
                            <dt className="text-slate-500">{c.checkPath}</dt>
                            <dd>
                              <code className="break-all text-slate-300">
                                {reason.path}
                              </code>
                            </dd>
                          </div>
                        )}
                        {reason.relatedTaskId && (
                          <div>
                            <dt className="text-slate-500">
                              {c.relatedTask}
                            </dt>
                            <dd>
                              <code className="break-all text-slate-300">
                                {reason.relatedTaskId}
                              </code>
                            </dd>
                          </div>
                        )}
                      </dl>
                    ))}
                  </div>
                )}

                <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-500">
                      {c.normalizedPaths}
                    </dt>
                    <dd className="mt-2">
                      <TokenList
                        emptyLabel={c.none}
                        values={result.decision.normalizedAllowedPaths}
                      />
                    </dd>
                  </div>
                  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-500">
                      {c.conflictingTasks}
                    </dt>
                    <dd className="mt-2">
                      <TokenList
                        emptyLabel={c.none}
                        values={result.decision.conflictingTaskIds}
                      />
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-500">
                      {c.approvalRequired}
                    </dt>
                    <dd className="mt-1 text-sm">
                      <BooleanValue
                        c={c}
                        value={result.decision.ownerApprovalRequired}
                      />
                    </dd>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <dt className="text-xs text-slate-500">
                      {c.approvalSatisfied}
                    </dt>
                    <dd className="mt-1 text-sm">
                      <BooleanValue
                        c={c}
                        value={result.decision.ownerApprovalSatisfied}
                      />
                    </dd>
                  </div>
                </dl>
              </div>
            </details>

            <div className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 p-4 text-sm leading-6 text-fuchsia-100">
              {c.demoOnly}
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title={c.orderTitle}
        description={c.orderDescription}
      >
        <div className="min-w-0 space-y-5">
          {result.waves.map((wave, index) => (
            <section className="min-w-0" key={`wave-${index + 1}`}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  {format(c.stageTitle, { n: index + 1 })}
                </h3>
                <StatusBadge tone="neutral">
                  {format(c.stagesAtLevel, { n: wave.length })}
                </StatusBadge>
              </div>
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                {wave.map((task) => (
                  <TaskCard c={c} key={task.id} task={task} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
