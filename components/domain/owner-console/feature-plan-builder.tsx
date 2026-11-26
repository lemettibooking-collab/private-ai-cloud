"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { format } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";

// AI-039 Plan Builder: the Owner writes ONE draft FeaturePlan revision for a ProjectTask. Steps keep
// stable local ids (step-1, step-2, …) that become the saved DevelopmentTask ids; reordering never
// changes an existing step's id. Dependencies are chosen from the other steps only. The server
// re-validates everything with the canonical FeaturePlan contract (missing / self / cyclic
// dependencies, required lists, limits) — this form only helps. The opaque idempotency key is
// rendered once per form by the server; retries and double submits resolve to the same revision.

type PlanError = Readonly<{ code: string; field: string; step: number | null }>;
export type FeaturePlanFormState = Readonly<{
  status: "idle" | "invalid_plan" | "invalid_input" | "not_plannable" | "conflict" | "unavailable" | "unauthenticated";
  errors: readonly PlanError[];
}>;

export type FeaturePlanStepDraft = Readonly<{
  id: string;
  title: string;
  goal: string;
  scope: string;
  nonGoals: string;
  allowedPaths: string;
  acceptanceCriteria: string;
  verificationCommands: string;
  dependsOn: readonly string[];
  riskLevel: string;
  priority: string;
  requiresOwnerApproval: boolean;
}>;

type Labels = Messages["taskDevelopment"]["form"];
type ListField = "scope" | "nonGoals" | "allowedPaths" | "acceptanceCriteria" | "verificationCommands";

type FeaturePlanBuilderProps = {
  action: (state: FeaturePlanFormState, form: FormData) => Promise<FeaturePlanFormState>;
  formKey: string;
  taskId: string;
  initialTitle: string;
  initialGoal: string;
  initialSteps: readonly FeaturePlanStepDraft[];
  defaultRisk: string;
  defaultPriority: string;
  risks: readonly string[];
  priorities: readonly string[];
  riskLabels: Readonly<Record<string, string>>;
  limits: Readonly<{ maxSteps: number; maxListItems: number; maxListItemLength: number; maxPlanTitleLength: number; maxPlanGoalLength: number; maxStepTitleLength: number; maxStepGoalLength: number }>;
  cancelHref: string;
  newFormHref: string;
  labels: Labels;
  // AI-039 P-1: shown above the form when editing an AI candidate (e.g. allowed paths still pending).
  notice?: string;
  // Placeholder for an empty "allowed paths" field (an AI candidate never invents repository paths).
  emptyPathsHint?: string;
};

const initialState: FeaturePlanFormState = { status: "idle", errors: [] };
const maxStepNumber = 99;

const inputClass = "mt-1.5 w-full rounded-pac border border-line-strong bg-[rgba(5,8,13,0.62)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] px-2.5 text-[13px] text-ink transition-colors placeholder:text-ink-3/70 hover:border-ink-3/50 focus:border-accent/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const listClass = `${inputClass} min-h-20 py-2 font-mono text-[12px] leading-5`;
const iconButton = "pac-control flex h-7 min-w-7 items-center justify-center px-2 text-[12px] text-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

function Label({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor: string; hint?: string }) {
  return (
    <label className="flex items-baseline justify-between gap-2 text-[12px] font-medium text-ink-2" htmlFor={htmlFor}>
      <span>{children}</span>
      {hint && <span className="text-[11px] font-normal text-ink-3">{hint}</span>}
    </label>
  );
}

// The lowest unused step number keeps ids short and within the step-id pattern however often steps
// are added and removed; an existing step never changes its id.
function nextStepId(steps: readonly FeaturePlanStepDraft[]): string | null {
  const used = new Set(steps.map((step) => step.id));
  for (let number = 1; number <= maxStepNumber; number += 1) if (!used.has(`step-${number}`)) return `step-${number}`;
  return null;
}

export function FeaturePlanBuilder(props: FeaturePlanBuilderProps) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  const [title, setTitle] = useState(props.initialTitle);
  const [goal, setGoal] = useState(props.initialGoal);
  const [steps, setSteps] = useState<readonly FeaturePlanStepDraft[]>(props.initialSteps);
  const l = props.labels;
  const lists: readonly [ListField, string, boolean][] = [
    ["scope", l.scope, true],
    ["nonGoals", l.nonGoals, false],
    ["allowedPaths", l.allowedPaths, true],
    ["acceptanceCriteria", l.acceptanceCriteria, true],
    ["verificationCommands", l.verificationCommands, true],
  ];

  const update = (id: string, change: Partial<FeaturePlanStepDraft>) =>
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...change } : step)));
  const addStep = () => setSteps((current) => {
    const id = nextStepId(current);
    if (id === null || current.length >= props.limits.maxSteps) return current;
    return [...current, {
      id, title: "", goal: "", scope: "", nonGoals: "", allowedPaths: "", acceptanceCriteria: "", verificationCommands: "",
      dependsOn: [], riskLevel: props.defaultRisk, priority: props.defaultPriority, requiresOwnerApproval: false,
    }];
  });
  // Removing a step also removes it from every other step's dependencies.
  const removeStep = (id: string) => setSteps((current) => current.filter((step) => step.id !== id)
    .map((step) => (step.dependsOn.includes(id) ? { ...step, dependsOn: step.dependsOn.filter((dependency) => dependency !== id) } : step)));
  const move = (index: number, delta: -1 | 1) => setSteps((current) => {
    const target = index + delta;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const toggleDependency = (id: string, dependency: string, checked: boolean) => setSteps((current) => current.map((step) => (step.id !== id ? step : {
    ...step,
    dependsOn: checked ? [...step.dependsOn.filter((value) => value !== dependency), dependency] : step.dependsOn.filter((value) => value !== dependency),
  })));

  const messages: Record<Exclude<FeaturePlanFormState["status"], "idle" | "invalid_plan">, string> = {
    invalid_input: l.invalidInput,
    not_plannable: l.notPlannable,
    conflict: l.conflict,
    unavailable: l.unavailable,
    unauthenticated: l.unauthenticated,
  };
  const errorText = (error: PlanError) => {
    const field = (l.fields as Readonly<Record<string, string>>)[error.field] ?? l.fields.plan;
    const problem = (l.errors as Readonly<Record<string, string>>)[error.code] ?? l.errors.invalid_input;
    const place = error.step === null ? `${l.planLevel} · ${field}` : `${format(l.step, { n: error.step + 1 })} · ${field}`;
    return format(l.errorAt, { place, problem });
  };

  return (
    <form action={formAction} aria-busy={pending}>
      <input name="idempotencyKey" type="hidden" value={props.formKey} />
      <input name="taskId" type="hidden" value={props.taskId} />
      {steps.map((step) => <input key={`order-${step.id}`} name="steps" type="hidden" value={step.id} />)}
      {props.notice && (
        <p className="mb-3 rounded-pac border border-warn/35 bg-warn/7 px-3 py-2.5 text-[12.5px] leading-5 text-ink-2" role="note">{props.notice}</p>
      )}

      <fieldset className="pac-inset mb-3 grid gap-x-6 gap-y-3 p-4 lg:grid-cols-[11rem_1fr]">
        <div>
          <legend className="pac-label !text-ink-2">{l.planSection}</legend>
          <p className="mt-1 text-[11.5px] leading-4 text-ink-3">{l.planNote}</p>
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <Label hint={`${title.length}/${props.limits.maxPlanTitleLength}`} htmlFor="plan-title">{l.planTitle}</Label>
            <input autoComplete="off" className={`${inputClass} h-9`} id="plan-title" maxLength={props.limits.maxPlanTitleLength} name="planTitle"
              onChange={(event) => setTitle(event.target.value)} readOnly={pending} required value={title} />
          </div>
          <div>
            <Label hint={`${goal.length}/${props.limits.maxPlanGoalLength}`} htmlFor="plan-goal">{l.planGoal}</Label>
            <textarea className={`${inputClass} min-h-20 py-2 leading-5`} id="plan-goal" maxLength={props.limits.maxPlanGoalLength} name="planGoal"
              onChange={(event) => setGoal(event.target.value)} readOnly={pending} required value={goal} />
          </div>
        </div>
      </fieldset>

      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h3 className="pac-label !text-ink-2">{l.stepsSection}</h3>
          <p className="mt-1 text-[11.5px] leading-4 text-ink-3">{l.stepsNote}</p>
        </div>
        <button className="pac-control flex h-8 shrink-0 items-center px-3 text-xs text-ink-2 hover:text-ink disabled:opacity-40" disabled={pending || steps.length >= props.limits.maxSteps}
          onClick={addStep} type="button">
          + {l.addStep}
        </button>
      </div>

      <ol className="space-y-3">
        {steps.map((step, index) => {
          const number = index + 1;
          const stepLabel = format(l.step, { n: number });
          const others = steps.filter((other) => other.id !== step.id);
          const prefix = `plan-${step.id}`;
          return (
            <li key={step.id}>
              <fieldset className="pac-inset p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <legend className="flex items-baseline gap-2 text-[13px] font-semibold text-ink">
                    {stepLabel} <span className="font-mono text-[11px] font-normal text-ink-3">{step.id}</span>
                  </legend>
                  <div className="flex items-center gap-1.5">
                    <button aria-label={format(l.moveUp, { n: number })} className={iconButton} disabled={pending || index === 0} onClick={() => move(index, -1)} type="button">↑</button>
                    <button aria-label={format(l.moveDown, { n: number })} className={iconButton} disabled={pending || index === steps.length - 1} onClick={() => move(index, 1)} type="button">↓</button>
                    <button aria-label={format(l.removeStep, { n: number })} className={`${iconButton} hover:!text-bad`} disabled={pending || steps.length === 1} onClick={() => removeStep(step.id)} type="button">✕</button>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="lg:col-span-2">
                    <Label hint={`${step.title.length}/${props.limits.maxStepTitleLength}`} htmlFor={`${prefix}-title`}>{l.title}</Label>
                    <input autoComplete="off" className={`${inputClass} h-9`} id={`${prefix}-title`} maxLength={props.limits.maxStepTitleLength} name={`step.${step.id}.title`}
                      onChange={(event) => update(step.id, { title: event.target.value })} readOnly={pending} required value={step.title} />
                  </div>
                  <div className="lg:col-span-2">
                    <Label hint={`${step.goal.length}/${props.limits.maxStepGoalLength}`} htmlFor={`${prefix}-goal`}>{l.goal}</Label>
                    <textarea className={`${inputClass} min-h-16 py-2 leading-5`} id={`${prefix}-goal`} maxLength={props.limits.maxStepGoalLength} name={`step.${step.id}.goal`}
                      onChange={(event) => update(step.id, { goal: event.target.value })} readOnly={pending} required value={step.goal} />
                  </div>
                  {lists.map(([field, label, required]) => (
                    <div key={field}>
                      <Label hint={required ? l.onePerLine : `${l.onePerLine} · ${l.optional}`} htmlFor={`${prefix}-${field}`}>{label}</Label>
                      <textarea className={listClass} id={`${prefix}-${field}`} maxLength={props.limits.maxListItems * (props.limits.maxListItemLength + 1)} name={`step.${step.id}.${field}`}
                        onChange={(event) => update(step.id, { [field]: event.target.value })} placeholder={field === "allowedPaths" ? props.emptyPathsHint : undefined}
                        readOnly={pending} required={required} spellCheck={false} value={step[field]} />
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={`${prefix}-risk`}>{l.risk}</Label>
                      <select className={`${inputClass} h-9`} id={`${prefix}-risk`} name={`step.${step.id}.riskLevel`} onChange={(event) => update(step.id, { riskLevel: event.target.value })} value={step.riskLevel}>
                        {props.risks.map((value) => <option key={value} value={value}>{props.riskLabels[value] ?? value}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`${prefix}-priority`}>{l.priority}</Label>
                      <select className={`${inputClass} h-9`} id={`${prefix}-priority`} name={`step.${step.id}.priority`} onChange={(event) => update(step.id, { priority: event.target.value })} value={step.priority}>
                        {props.priorities.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </div>
                    <label className="col-span-2 mt-1 flex items-center gap-2 text-[12.5px] text-ink-2" htmlFor={`${prefix}-approval`}>
                      <input checked={step.requiresOwnerApproval} className="h-4 w-4 accent-[var(--pac-accent)]" id={`${prefix}-approval`} name={`step.${step.id}.requiresOwnerApproval`}
                        onChange={(event) => update(step.id, { requiresOwnerApproval: event.target.checked })} type="checkbox" value="yes" />
                      {l.requiresOwnerApproval}
                    </label>
                  </div>
                  <fieldset className="min-w-0">
                    <legend className="text-[12px] font-medium text-ink-2">{l.dependencies}</legend>
                    {others.length === 0 ? (
                      <p className="mt-1.5 text-[12px] text-ink-3">{l.noOtherSteps}</p>
                    ) : (
                      <ul className="mt-1.5 space-y-1">
                        {others.map((other) => {
                          const otherNumber = steps.indexOf(other) + 1;
                          return (
                            <li key={other.id}>
                              <label className="flex items-center gap-2 text-[12.5px] text-ink-2" htmlFor={`${prefix}-dep-${other.id}`}>
                                <input checked={step.dependsOn.includes(other.id)} className="h-4 w-4 accent-[var(--pac-accent)]" id={`${prefix}-dep-${other.id}`}
                                  name={`step.${step.id}.dependsOn`} onChange={(event) => toggleDependency(step.id, other.id, event.target.checked)} type="checkbox" value={other.id} />
                                <span>{format(l.step, { n: otherNumber })}</span>
                                <span className="truncate text-ink-3">{other.title}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </fieldset>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>

      {state.status === "invalid_plan" && (
        <div aria-live="polite" className="mt-4 rounded-pac border border-warn/35 bg-warn/7 px-3 py-2.5 text-[12.5px] leading-5 text-ink-2" role="alert">
          <p className="font-medium text-warn">{l.errorSummary}</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {state.errors.map((error) => <li key={`${error.code}-${error.field}-${error.step}`}>{errorText(error)}</li>)}
          </ul>
        </div>
      )}
      {state.status !== "idle" && state.status !== "invalid_plan" && (
        <div aria-live="polite" className={`mt-4 flex gap-2.5 rounded-pac border px-3 py-2.5 text-[12.5px] leading-5 ${
          state.status === "unauthenticated" ? "border-accent/35 bg-accent/6 text-ink-2" : "border-warn/35 bg-warn/7 text-ink-2"}`} role="alert">
          <span className={`mt-[2px] text-[10.5px] font-medium uppercase tracking-[0.06em] ${state.status === "unauthenticated" ? "text-accent" : "text-warn"}`}>
            {state.status === "invalid_input" ? l.tagCheck : state.status === "unauthenticated" ? l.tagSignIn : l.tagNotSaved}
          </span>
          <span>
            {messages[state.status]}
            {state.status === "conflict" && (
              <> <a className="text-accent underline-offset-2 hover:underline" href={props.newFormHref}>{l.startNewForm}</a>.</>
            )}
            {state.status === "unauthenticated" && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages -- Auth.js API route: needs a full document navigation, not client-side routing.
              <> <a className="text-accent underline-offset-2 hover:underline" href="/api/auth/signin">{l.signIn}</a>.</>
            )}
          </span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-ink-3">{l.footnote}</p>
        <div className="flex items-center gap-2">
          <Link className="pac-control flex h-9 items-center px-3 text-xs text-ink-2 hover:text-ink" href={props.cancelHref}>{l.cancel}</Link>
          <button aria-disabled={pending} className="pac-control-accent flex h-9 min-w-[10rem] items-center justify-center gap-2 px-4 text-xs font-semibold disabled:cursor-wait disabled:opacity-70"
            disabled={pending} type="submit">
            {pending && <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent" />}
            {pending ? l.pending : l.submit}
          </button>
        </div>
      </div>
    </form>
  );
}
