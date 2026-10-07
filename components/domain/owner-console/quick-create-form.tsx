"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Messages } from "@/lib/i18n/messages";

// AI-038.4b Quick Create form: Owner task INTENT only (project, title, goal, type, priority, risk).
// The opaque idempotency key is rendered by the server once per form and sent unchanged with every
// submit of this form; retries and double submits therefore resolve to the same task. Disabling the
// button while pending only reduces duplicates — the key + DB constraint + transaction are the guard.

export type QuickCreateFormState = Readonly<{ status: "idle" | "invalid_input" | "conflict" | "unavailable" | "unauthenticated" }>;
type QuickCreateProject = Readonly<{ projectId: string; displayName: string }>;

type QuickCreateFormProps = {
  action: (state: QuickCreateFormState, form: FormData) => Promise<QuickCreateFormState>;
  formKey: string;
  // Exactly one entry and `fixed` → the project context preselects it; otherwise the Owner chooses.
  projects: readonly QuickCreateProject[];
  fixed: boolean;
  types: readonly string[];
  priorities: readonly string[];
  risks: readonly string[];
  maxTitleLength: number;
  maxGoalLength: number;
  newFormHref: string;
  cancelHref: string;
  // Localized presentation only (server dictionary). Option VALUES stay the canonical domain tokens.
  labels: Messages["quickCreate"]["form"];
  typeLabels: Readonly<Record<string, string>>;
  riskLabels: Readonly<Record<string, string>>;
};

const initialState: QuickCreateFormState = { status: "idle" };


const inputClass = "mt-1.5 h-9 w-full rounded-pac border border-line-strong bg-[rgba(5,8,13,0.62)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] px-2.5 text-[13px] text-ink transition-colors placeholder:text-ink-3/70 hover:border-ink-3/50 focus:border-accent/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60";

function Label({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor: string; hint?: string }) {
  return (
    <label className="flex items-baseline justify-between text-[12px] font-medium text-ink-2" htmlFor={htmlFor}>
      <span>{children}</span>
      {hint && <span className="text-[11px] font-normal text-ink-3">{hint}</span>}
    </label>
  );
}

// One titled group of fields (fieldset / legend for assistive technology).
function Group({ legend, note, children }: { legend: string; note: string; children: React.ReactNode }) {
  return (
    <fieldset className="pac-inset mb-3 grid gap-x-6 gap-y-3 p-4 lg:grid-cols-[11rem_1fr]">
      <div>
        <legend className="pac-label !text-ink-2">{legend}</legend>
        <p className="mt-1 text-[11.5px] leading-4 text-ink-3">{note}</p>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </fieldset>
  );
}

export function QuickCreateForm(props: QuickCreateFormProps) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  // Controlled fields keep the Owner's input after a non-success result (React resets forms after an action).
  const [projectId, setProjectId] = useState(props.fixed && props.projects.length === 1 ? props.projects[0].projectId : "");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [type, setType] = useState("feature");
  const [priority, setPriority] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const fixedProject = props.fixed && props.projects.length === 1 ? props.projects[0] : null;
  const l = props.labels;
  const messages: Record<Exclude<QuickCreateFormState["status"], "idle">, string> = {
    invalid_input: l.errorInvalid,
    conflict: l.errorConflict,
    unavailable: l.errorUnavailable,
    unauthenticated: l.errorUnauthenticated,
  };

  return (
    <form action={formAction} aria-busy={pending}>
      <input name="idempotencyKey" type="hidden" value={props.formKey} />

      <Group legend={l.target} note={fixedProject ? l.targetFixed : l.targetChoose}>
        <div>
          <Label htmlFor="quick-create-project">{l.project}</Label>
          {fixedProject ? (
            <>
              <input name="projectId" type="hidden" value={fixedProject.projectId} />
              <p className="pac-control mt-1.5 flex h-9 items-center gap-2 px-2.5 text-[13px] text-ink" id="quick-create-project">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
                {fixedProject.displayName} <span className="font-mono text-[11px] text-ink-3">{fixedProject.projectId}</span>
              </p>
            </>
          ) : (
            <select className={inputClass} id="quick-create-project" name="projectId" onChange={(event) => setProjectId(event.target.value)} required value={projectId}>
              <option disabled value="">{l.selectProject}</option>
              {props.projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>{project.displayName} · {project.projectId}</option>
              ))}
            </select>
          )}
        </div>
      </Group>

      <Group legend={l.intent} note={l.intentNote}>
        <div>
          <Label hint={`${title.length}/${props.maxTitleLength}`} htmlFor="quick-create-title">{l.title}</Label>
          <input autoComplete="off" className={inputClass} id="quick-create-title" maxLength={props.maxTitleLength} name="title"
            onChange={(event) => setTitle(event.target.value)} placeholder={l.titlePlaceholder} readOnly={pending} required value={title} />
        </div>
        <div>
          <Label hint={l.optional} htmlFor="quick-create-goal">{l.goal}</Label>
          <textarea className={`${inputClass} h-auto min-h-28 py-2 leading-5`} id="quick-create-goal" maxLength={props.maxGoalLength} name="goal"
            onChange={(event) => setGoal(event.target.value)} placeholder={l.goalPlaceholder} readOnly={pending} value={goal} />
        </div>
      </Group>

      <Group legend={l.classification} note={l.classificationNote}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="quick-create-type">{l.type}</Label>
            <select className={inputClass} id="quick-create-type" name="type" onChange={(event) => setType(event.target.value)} required value={type}>
              {props.types.map((value) => <option key={value} value={value}>{props.typeLabels[value] ?? value}</option>)}
            </select>
          </div>
          <div>
            <Label hint={l.optional} htmlFor="quick-create-priority">{l.priority}</Label>
            <select className={inputClass} id="quick-create-priority" name="priority" onChange={(event) => setPriority(event.target.value)} value={priority}>
              <option value="">{l.notSet}</option>
              {props.priorities.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <Label hint={l.optional} htmlFor="quick-create-risk">{l.riskLevel}</Label>
            <select className={inputClass} id="quick-create-risk" name="riskLevel" onChange={(event) => setRiskLevel(event.target.value)} value={riskLevel}>
              <option value="">{l.notSet}</option>
              {props.risks.map((value) => <option key={value} value={value}>{props.riskLabels[value] ?? value}</option>)}
            </select>
          </div>
        </div>
      </Group>

      {state.status !== "idle" && (
        <div aria-live="polite" className={`mb-4 flex gap-2.5 rounded-pac border px-3 py-2.5 text-[12.5px] leading-5 ${
          state.status === "unauthenticated" ? "border-accent/35 bg-accent/6 text-ink-2" : "border-warn/35 bg-warn/7 text-ink-2"}`} role="alert">
          <span className={`mt-[2px] text-[10.5px] font-medium uppercase tracking-[0.06em] ${state.status === "unauthenticated" ? "text-accent" : "text-warn"}`}>
            {state.status === "invalid_input" ? l.tagCheck : state.status === "unauthenticated" ? l.tagSignIn : l.tagNotCreated}
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

      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-[11.5px] text-ink-3">{l.footnote}</p>
        <div className="flex items-center gap-2">
          <Link className="pac-control flex h-9 items-center px-3 text-xs text-ink-2 hover:text-ink" href={props.cancelHref}>
            {l.cancel}
          </Link>
          <button
            aria-disabled={pending}
            className="pac-control-accent flex h-9 min-w-[8.5rem] items-center justify-center gap-2 px-4 text-xs font-semibold disabled:cursor-wait disabled:opacity-70"
            disabled={pending}
            type="submit"
          >
            {pending && <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent" />}
            {pending ? l.pending : l.submit}
          </button>
        </div>
      </div>
    </form>
  );
}
