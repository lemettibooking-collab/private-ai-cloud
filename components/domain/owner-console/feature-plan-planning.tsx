"use client";

import { useActionState, useState } from "react";
import { FeaturePlanBuilder, type FeaturePlanFormState, type FeaturePlanStepDraft } from "@/components/domain/owner-console/feature-plan-builder";
import type { FeaturePlanCandidate } from "@/lib/development/feature-plan-planner";
import { interviewLimits, type InterviewQuestion } from "@/lib/development/planning-interview";
import { format } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";

// AI-039 P-1 Owner planning flow. Primary path: Owner Planning Interview (product questions only) →
// AI-assisted UNSAVED candidate → Owner review / edit → explicit "save draft revision". Secondary path:
// the manual technical editor (advanced / fallback). Nothing here saves on its own: the candidate is
// only client state until the Owner submits the Plan Builder, whose save action re-validates it.

export type FeaturePlanDraftState = Readonly<{
  status: "idle" | "candidate" | "candidate_rejected" | "planner_unavailable" | "planner_failed" | "invalid_input" | "not_plannable" | "unavailable" | "unauthenticated";
  candidate: FeaturePlanCandidate | null;
  reason: string | null;
}>;

type Labels = Messages["taskDevelopment"];
type BuilderProps = Omit<React.ComponentProps<typeof FeaturePlanBuilder>, "initialSteps" | "initialTitle" | "initialGoal" | "notice" | "emptyPathsHint">;

type PlanningProps = {
  draftAction: (state: FeaturePlanDraftState, form: FormData) => Promise<FeaturePlanDraftState>;
  saveAction: (state: FeaturePlanFormState, form: FormData) => Promise<FeaturePlanFormState>;
  taskId: string;
  questions: readonly InterviewQuestion[];
  plannerAvailable: boolean;
  hasPlan: boolean;
  builderDescription: string;
  initialTitle: string;
  initialGoal: string;
  initialSteps: readonly FeaturePlanStepDraft[];
  builder: BuilderProps;
  riskLabels: Readonly<Record<string, string>>;
  labels: Labels;
};

const initialDraft: FeaturePlanDraftState = { status: "idle", candidate: null, reason: null };
const inputClass = "mt-1.5 w-full rounded-pac border border-line-strong bg-[rgba(5,8,13,0.62)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] px-2.5 text-[13px] text-ink transition-colors placeholder:text-ink-3/70 hover:border-ink-3/50 focus:border-accent/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const primaryButton = "pac-control-accent flex h-9 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:cursor-wait disabled:opacity-70";
const secondaryButton = "pac-control flex h-9 items-center px-3 text-xs text-ink-2 hover:text-ink";

const candidateSteps = (candidate: FeaturePlanCandidate): FeaturePlanStepDraft[] => candidate.steps.map((step) => ({
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
}));

function Notice({ title, body, tone, children }: { title: string; body: string; tone: "warn" | "accent"; children?: React.ReactNode }) {
  return (
    <div aria-live="polite" className={`rounded-pac border px-4 py-3 ${tone === "warn" ? "border-warn/35 bg-warn/7" : "border-accent/35 bg-accent/6"}`} role="status">
      <p className={`text-[13px] font-semibold ${tone === "warn" ? "text-warn" : "text-accent"}`}>{title}</p>
      <p className="mt-1 text-[12.5px] leading-5 text-ink-2">{body}</p>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

// The AI candidate, read-only, as ordinary step cards. Allowed paths are never invented: they are shown
// as needing technical clarification.
function CandidateReview({ candidate, labels, riskLabels }: { candidate: FeaturePlanCandidate; labels: Labels; riskLabels: Readonly<Record<string, string>> }) {
  const p = labels.planning;
  const sequenceOf = new Map(candidate.steps.map((step) => [step.id, step.sequence] as const));
  const list = (items: readonly string[], mono = false) => items.length === 0
    ? <p className="text-[12px] text-ink-3">{labels.none}</p>
    : <ul className={mono ? "space-y-1" : "list-disc space-y-0.5 pl-4"}>{items.map((item) => <li className={mono ? "break-all font-mono text-[11.5px] text-ink" : "text-[12.5px] text-ink"} key={item}>{item}</li>)}</ul>;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[14px] font-semibold text-ink">{candidate.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-ink-2">{candidate.goal}</p>
        <p className="mt-1.5 text-[11.5px] text-ink-3">{format(p.waves, { n: candidate.waves.length })}</p>
      </div>
      <ol className="space-y-3">
        {candidate.steps.map((step) => (
          <li className="pac-inset p-4" key={step.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] font-semibold text-ink">
                {format(labels.step, { n: step.sequence })} <span className="ml-1 font-mono text-[11px] font-normal text-ink-3">{step.id}</span>
              </p>
              <p className="text-[12px] text-ink-2">
                {labels.risk}: {riskLabels[step.riskLevel] ?? step.riskLevel} · <span className="font-mono">{step.priority}</span> · {labels.ownerApproval}: {step.requiresOwnerApproval ? labels.approvalRequired : labels.approvalNotRequired}
              </p>
            </div>
            <p className="mt-1 text-[13px] text-ink">{step.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-5 text-ink-2">{step.goal}</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div><p className="pac-label">{labels.dependencies}</p>{step.dependencyIds.length === 0
                ? <p className="mt-1 text-[12px] text-ink-3">{labels.noDependencies}</p>
                : <p className="mt-1 text-[12.5px] text-ink">{step.dependencyIds.map((id) => format(labels.step, { n: sequenceOf.get(id) ?? 0 })).join(", ")}</p>}</div>
              <div><p className="pac-label">{labels.allowedPaths}</p><p className="mt-1 text-[12px] text-warn">{p.pathsPendingShort}</p></div>
              <div><p className="pac-label">{labels.scope}</p><div className="mt-1">{list(step.scope)}</div></div>
              <div><p className="pac-label">{labels.acceptanceCriteria}</p><div className="mt-1">{list(step.acceptanceCriteria)}</div></div>
              <div className="lg:col-span-2"><p className="pac-label">{labels.verificationCommands}</p><div className="mt-1">{list(step.verificationCommands, true)}</div></div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// One interview attempt (remounted for "answer again", which also resets the action state).
function InterviewStage(props: PlanningProps & { onReview: (candidate: FeaturePlanCandidate) => void; onManual: () => void; onBack: () => void; onRetry: () => void }) {
  const [state, formAction, pending] = useActionState(props.draftAction, initialDraft);
  // Controlled answers survive a non-success result (React resets uncontrolled fields after an action).
  const [answers, setAnswers] = useState<Record<string, string | readonly string[]>>({});
  const p = props.labels.planning;
  const questionLabel = (id: string) => (p.questions as Readonly<Record<string, string>>)[id] ?? id;
  const optionLabel = (id: string, option: string) => ((p.options as Readonly<Record<string, Readonly<Record<string, string>>>>)[id] ?? {})[option] ?? option;
  const toggle = (id: string, option: string, checked: boolean) => setAnswers((current) => {
    const values = Array.isArray(current[id]) ? [...current[id] as string[]] : [];
    // "none" is exclusive: choosing it clears the others, choosing another clears "none".
    const next = checked ? (option === "none" ? ["none"] : [...values.filter((value) => value !== "none"), option]) : values.filter((value) => value !== option);
    return { ...current, [id]: next };
  });

  if (state.status === "candidate" && state.candidate) {
    const candidate = state.candidate;
    return (
      <div className="space-y-4">
        <Notice body={p.candidateBody} title={p.candidateTitle} tone="accent" />
        {candidate.pathsRequireTechnicalReview && <p className="rounded-pac border border-warn/35 bg-warn/7 px-3 py-2.5 text-[12.5px] leading-5 text-ink-2">{p.pathsPending}</p>}
        <CandidateReview candidate={candidate} labels={props.labels} riskLabels={props.riskLabels} />
        <div className="flex flex-wrap gap-2">
          <button className={primaryButton} onClick={() => props.onReview(candidate)} type="button">{p.reviewAndEdit}</button>
          <button className={secondaryButton} onClick={props.onRetry} type="button">{p.regenerate}</button>
        </div>
      </div>
    );
  }

  const outcome = state.status === "planner_unavailable"
    ? <Notice body={p.unavailableBody} title={p.unavailableTitle} tone="warn"><button className={secondaryButton} onClick={props.onManual} type="button">{p.manualStart}</button></Notice>
    : state.status === "candidate_rejected"
      ? <Notice body={`${p.rejectedBody} ${(p.rejected as Readonly<Record<string, string>>)[state.reason ?? ""] ?? ""}`} title={p.rejectedTitle} tone="warn">
          <button className={secondaryButton} onClick={props.onRetry} type="button">{p.regenerate}</button>
          <button className={secondaryButton} onClick={props.onManual} type="button">{p.manualStart}</button>
        </Notice>
      : state.status === "planner_failed"
        ? <Notice body={p.failedBody} title={p.failedTitle} tone="warn"><button className={secondaryButton} onClick={props.onManual} type="button">{p.manualStart}</button></Notice>
        : state.status === "idle" ? null
          : <Notice body={({ invalid_input: p.invalidInput, not_plannable: p.notPlannable, unavailable: p.unavailable, unauthenticated: p.unauthenticated } as Record<string, string>)[state.status] ?? p.unavailable}
              title={p.interviewTitle} tone="warn" />;

  return (
    <form action={formAction} aria-busy={pending} className="space-y-4">
      <input name="taskId" type="hidden" value={props.taskId} />
      <div>
        <h3 className="text-[14px] font-semibold text-ink">{p.interviewTitle}</h3>
        <p className="mt-1 text-[12.5px] leading-5 text-ink-3">{p.interviewNote}</p>
        {!props.plannerAvailable && <p className="mt-2 text-[12px] text-warn">{p.unavailableNotice}</p>}
      </div>
      {props.questions.map((question, index) => {
        const id = `interview-${question.id}`;
        const label = `${index + 1}. ${questionLabel(question.id)}`;
        if (question.kind === "text") {
          return (
            <div className="pac-inset p-4" key={question.id}>
              <label className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-ink" htmlFor={id}>
                <span>{label}</span>{!question.required && <span className="text-[11px] font-normal text-ink-3">{p.optional}</span>}
              </label>
              <textarea className={`${inputClass} min-h-20 py-2 leading-5`} id={id} maxLength={interviewLimits.maxTextLength} name={`answer.${question.id}`}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} readOnly={pending}
                required={question.required} value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""} />
            </div>
          );
        }
        const multi = question.kind === "multi";
        const selected = answers[question.id];
        return (
          <fieldset className="pac-inset p-4" key={question.id}>
            <legend className="text-[13px] font-medium text-ink">{label}{multi && <span className="ml-2 text-[11px] font-normal text-ink-3">{p.optional}</span>}</legend>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {question.options.map((option) => (
                <label className="flex items-center gap-2 text-[12.5px] text-ink-2" htmlFor={`${id}-${option}`} key={option}>
                  <input checked={multi ? Array.isArray(selected) && selected.includes(option) : selected === option} className="h-4 w-4 accent-[var(--pac-accent)]"
                    id={`${id}-${option}`} name={`answer.${question.id}`}
                    onChange={(event) => (multi ? toggle(question.id, option, event.target.checked) : setAnswers((current) => ({ ...current, [question.id]: option })))}
                    required={!multi} type={multi ? "checkbox" : "radio"} value={option} />
                  {optionLabel(question.id, option)}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      {outcome}
      <div className="flex flex-wrap items-center gap-2">
        <button aria-disabled={pending} className={primaryButton} disabled={pending} type="submit">
          {pending && <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent" />}
          {pending ? p.pending : p.submit}
        </button>
        <button className={secondaryButton} disabled={pending} onClick={props.onBack} type="button">{p.back}</button>
      </div>
    </form>
  );
}

export function FeaturePlanPlanning(props: PlanningProps) {
  const [mode, setMode] = useState<"start" | "interview" | "manual" | "candidate">("start");
  const [attempt, setAttempt] = useState(0);
  const [candidate, setCandidate] = useState<FeaturePlanCandidate | null>(null);
  const p = props.labels.planning;

  if (mode === "interview") {
    return (
      <InterviewStage key={attempt} {...props} onBack={() => setMode("start")} onManual={() => setMode("manual")}
        onRetry={() => setAttempt((value) => value + 1)} onReview={(next) => { setCandidate(next); setMode("candidate"); }} />
    );
  }
  if (mode === "manual" || (mode === "candidate" && candidate)) {
    const fromCandidate = mode === "candidate" && candidate;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12.5px] leading-5 text-ink-3">{fromCandidate ? p.candidateBody : props.builderDescription}</p>
          <button className={secondaryButton} onClick={() => setMode(fromCandidate ? "interview" : "start")} type="button">{p.back}</button>
        </div>
        <FeaturePlanBuilder
          key={fromCandidate ? `candidate-${attempt}` : "manual"}
          {...props.builder}
          action={props.saveAction}
          emptyPathsHint={fromCandidate ? p.pathsPendingShort : undefined}
          initialGoal={fromCandidate ? candidate.goal : props.initialGoal}
          initialSteps={fromCandidate ? candidateSteps(candidate) : props.initialSteps}
          initialTitle={fromCandidate ? candidate.title : props.initialTitle}
          notice={fromCandidate ? p.editingCandidate : undefined}
        />
      </div>
    );
  }
  // Start: AI-assisted planning is the primary path; the technical editor is the secondary one.
  return (
    <div className="space-y-4">
      <div className="pac-inset p-5">
        <p className="text-[15px] font-semibold text-ink">{props.hasPlan ? p.aiTitleNext : p.aiTitle}</p>
        <p className="mt-1.5 max-w-[72ch] text-[12.5px] leading-5 text-ink-2">{p.aiBody}</p>
        {!props.plannerAvailable && <p className="mt-2 text-[12px] text-warn">{p.unavailableNotice}</p>}
        <button className={`${primaryButton} mt-4`} onClick={() => setMode("interview")} type="button">{p.aiStart}</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-[12px] text-ink-3">{p.manualNote}</p>
        <button className={secondaryButton} onClick={() => setMode("manual")} type="button">{props.hasPlan ? p.manualEdit : p.manualStart}</button>
      </div>
    </div>
  );
}
