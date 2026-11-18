import { formatTimestamp } from "@/components/domain/owner-console/format";
import { riskTone } from "@/components/domain/owner-console/status-tone";
import { Instrument, InstrumentStrip } from "@/components/ui/instrument";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DevelopmentTask } from "@/lib/contracts/development-plan";
import { aggregatePlanRisk, executorRecommendation, planDependencyWaves, repositoryMutation, verificationPlan, type TaskFeaturePlans } from "@/lib/development/feature-plan-model";
import { format } from "@/lib/i18n/locale";
import { getI18n } from "@/lib/i18n/locale.server";

// AI-039 Development Workflow Browser (server component, read-only presentation). Everything shown
// is the persisted, validated FeaturePlan revision or a projection of it through the canonical
// contract: waves from buildDevelopmentTaskWaves, aggregate risk = max step risk, verification = the
// commands written in the plan. Executor recommendation and repository changes are factual states,
// never computed results. Identifiers, paths and commands are data (mono), never translated.

type LatestPlan = NonNullable<TaskFeaturePlans["latest"]>;

function TokenList({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <p className="text-[12px] text-ink-3">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((item) => <li className="break-all font-mono text-[11.5px] leading-5 text-ink" key={item}>{item}</li>)}
    </ul>
  );
}

function TextList({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <p className="text-[12px] text-ink-3">{empty}</p>;
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {items.map((item) => <li className="text-[12.5px] leading-5 text-ink" key={item}>{item}</li>)}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="pac-label">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// Summary instruments of the latest revision (factual counts only).
export async function PlanSummary({ latest }: { latest: LatestPlan }) {
  const { t } = await getI18n();
  const k = t.taskDevelopment;
  const waves = planDependencyWaves(latest.plan);
  const risk = aggregatePlanRisk(latest.plan);
  const approvals = latest.plan.tasks.filter((step) => step.requiresOwnerApproval).length;
  return (
    <InstrumentStrip label={k.summaryLabel}>
      <Instrument detail={k.stepCountDetail} label={k.stepCount} value={latest.plan.tasks.length} />
      <Instrument detail={k.waveCountDetail} label={k.waveCount} value={waves ? waves.length : "—"} />
      <Instrument detail={`${k.aggregateRiskDetail} · ${(Object.entries(risk.counts) as [keyof typeof t.risk, number][]).filter(([, n]) => n > 0).map(([level, n]) => `${t.risk[level]} ${n}`).join(" · ")}`}
        label={k.aggregateRisk} state={t.risk[risk.max]} tone={riskTone[risk.max]} value={t.risk[risk.max]} />
      <Instrument detail={k.approvalCountDetail} label={k.approvalCount} tone={approvals > 0 ? "attention" : "neutral"} value={approvals} />
    </InstrumentStrip>
  );
}

export async function DependencyWaves({ latest }: { latest: LatestPlan }) {
  const { t } = await getI18n();
  const k = t.taskDevelopment;
  const waves = planDependencyWaves(latest.plan);
  return (
    <SectionCard description={k.wavesNote} title={k.wavesTitle}>
      {waves === null ? (
        <p className="text-[12.5px] text-ink-3">{k.plansUnavailableBody}</p>
      ) : (
        <ol className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {waves.map((wave, index) => (
            <li className="pac-inset p-3" key={wave.map((step) => step.id).join("|")}>
              <p className="pac-label">{format(k.wave, { n: index + 1 })}</p>
              <ul className="mt-2 space-y-1.5">
                {wave.map((step) => (
                  <li className="flex min-w-0 items-baseline gap-2" key={step.id}>
                    <span className="shrink-0 text-[12px] text-ink-2">{format(k.step, { n: step.sequence })}</span>
                    <span className="truncate text-[12.5px] text-ink">{step.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-3">{step.id}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

export async function PlanStepPanel({ step, plan }: { step: DevelopmentTask; plan: LatestPlan["plan"] }) {
  const { t } = await getI18n();
  const k = t.taskDevelopment;
  const sequenceOf = new Map(plan.tasks.map((item) => [item.id, item.sequence] as const));
  return (
    <article className="pac-surface p-4" id={`plan-step-${step.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <p className="flex items-baseline gap-2">
            <span className="pac-label">{format(k.step, { n: step.sequence })}</span>
            <span className="font-mono text-[11px] text-ink-3">{step.id}</span>
          </p>
          <h3 className="mt-1 text-[14px] font-semibold leading-5 text-ink">{step.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={riskTone[step.riskLevel]}>{k.risk}: {t.risk[step.riskLevel]}</StatusBadge>
          <span className="pac-control px-2 py-0.5 font-mono text-[11px] text-ink-2">{step.priority}</span>
          <StatusBadge tone={step.requiresOwnerApproval ? "attention" : "muted"}>
            {k.ownerApproval}: {step.requiresOwnerApproval ? k.approvalRequired : k.approvalNotRequired}
          </StatusBadge>
        </div>
      </header>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Field label={k.stepGoal}><p className="whitespace-pre-wrap text-[12.5px] leading-5 text-ink">{step.goal}</p></Field>
        <Field label={k.dependencies}>
          {step.dependencyIds.length === 0 ? (
            <p className="text-[12px] text-ink-3">{k.noDependencies}</p>
          ) : (
            <ul className="space-y-1">
              {step.dependencyIds.map((dependency) => (
                <li className="flex items-baseline gap-2" key={dependency}>
                  <a className="text-[12.5px] text-accent hover:underline" href={`#plan-step-${dependency}`}>{format(k.step, { n: sequenceOf.get(dependency) ?? 0 })}</a>
                  <span className="font-mono text-[11px] text-ink-3">{dependency}</span>
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label={k.scope}><TextList empty={k.none} items={step.scope} /></Field>
        <Field label={k.nonGoals}><TextList empty={k.none} items={step.nonGoals} /></Field>
        <Field label={k.allowedPaths}><TokenList empty={k.none} items={step.allowedPaths} /></Field>
        <Field label={k.acceptanceCriteria}><TextList empty={k.none} items={step.acceptanceCriteria} /></Field>
        <div className="lg:col-span-2">
          <Field label={k.verificationCommands}><TokenList empty={k.none} items={step.verificationCommands} /></Field>
        </div>
      </div>
    </article>
  );
}

export async function VerificationPlan({ latest }: { latest: LatestPlan }) {
  const { t } = await getI18n();
  const k = t.taskDevelopment;
  const verification = verificationPlan(latest.plan);
  return (
    <SectionCard description={k.verificationDescription} title={k.verificationTitle}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={k.consolidated}>
          <ol className="space-y-1">
            {verification.consolidated.map((command) => <li className="break-all font-mono text-[11.5px] leading-5 text-ink" key={command}>{command}</li>)}
          </ol>
        </Field>
        <Field label={k.perStep}>
          <ul className="space-y-2">
            {verification.perTask.map((item) => (
              <li key={item.taskId}>
                <p className="text-[12px] text-ink-2">{format(k.step, { n: item.sequence })} <span className="text-ink-3">· {item.title}</span></p>
                <TokenList empty={k.none} items={item.commands} />
              </li>
            ))}
          </ul>
        </Field>
      </div>
    </SectionCard>
  );
}

// Factual states: no ExecutorRouter exists yet, and this workflow never touches a repository.
export async function ExecutionStatePanels() {
  const { t } = await getI18n();
  const k = t.taskDevelopment;
  return (
    <div className="grid gap-4">
      <SectionCard action={<StatusBadge tone="muted">{k.executorStatus}</StatusBadge>} title={k.executorTitle}>
        <p className="text-[12.5px] leading-5 text-ink-2" data-executor-status={executorRecommendation.status}>
          {k.executorBody.split("{component}")[0]}<span className="font-mono text-[11.5px] text-ink">{executorRecommendation.component}</span>{k.executorBody.split("{component}")[1]}
        </p>
        <p className="mt-2 text-[11.5px] text-ink-3">
          {k.executorRoadmap.split("{item}")[0]}<span className="font-mono">{executorRecommendation.roadmapDependency}</span>{k.executorRoadmap.split("{item}")[1]}
        </p>
      </SectionCard>
      <SectionCard action={<StatusBadge tone="muted">{k.repositoryStatus}</StatusBadge>} title={k.repositoryTitle}>
        <p className="text-[12.5px] leading-5 text-ink-2" data-repository-mutation={repositoryMutation.status}>{k.repositoryBody}</p>
      </SectionCard>
    </div>
  );
}

export async function RevisionHistory({ data }: { data: TaskFeaturePlans }) {
  const { t } = await getI18n();
  const k = t.taskDevelopment;
  return (
    <SectionCard count={data.revisionCount} description={k.historyDescription} flush title={k.historyTitle}>
      <ol className="divide-y divide-line">
        {data.history.map((item, index) => (
          <li className="flex items-center justify-between gap-3 px-4 py-2.5" key={item.revision}>
            <div className="min-w-0">
              <p className="text-[12.5px] text-ink">
                {k.revision} <span className="font-mono">{item.revision}</span>
                {index === 0 && <span className="ml-2"><StatusBadge tone="active">{k.latest}</StatusBadge></span>}
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] text-ink-3" title={item.fingerprint}>{item.fingerprint.slice(0, 16)}</p>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-ink-2">{formatTimestamp(item.createdAt)}</span>
          </li>
        ))}
      </ol>
      {data.historyTruncated && <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">{format(k.historyTruncated, { shown: data.history.length, total: data.revisionCount })}</p>}
    </SectionCard>
  );
}
