"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ProjectCreateCopy } from "@/lib/i18n/project-create-copy";

type State = { status: string; projectId: string | null };
const inputClass = "pac-control mt-1.5 h-10 w-full px-3 text-sm text-ink focus-visible:outline-accent";

export function ProjectCreateForm({ action, copy }: { action: (state: State, form: FormData) => Promise<State>; copy: ProjectCreateCopy }) {
  const [state, submit, pending] = useActionState(action, { status: "idle", projectId: null });
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const success = state.status === "created" || state.status === "replayed";
  const message = state.status in copy ? copy[state.status as keyof ProjectCreateCopy] : "";
  return (
    <form action={submit} className="space-y-4 p-4">
      <p className="text-sm text-ink-2">{copy.description}</p>
      <div>
        <label className="text-sm text-ink" htmlFor="new-project-id">{copy.projectId}</label>
        <input aria-describedby="new-project-id-hint" autoCapitalize="none" className={inputClass} disabled={pending} id="new-project-id" maxLength={64} name="projectId" onChange={e => setProjectId(e.target.value)} pattern="[a-z0-9][a-z0-9._\-]*" required value={projectId} />
        <p className="mt-1 text-xs text-ink-3" id="new-project-id-hint">{copy.idHint}</p>
      </div>
      <div>
        <label className="text-sm text-ink" htmlFor="new-project-name">{copy.displayName}</label>
        <input aria-describedby="new-project-name-hint" className={inputClass} disabled={pending} id="new-project-name" maxLength={120} name="displayName" onChange={e => setName(e.target.value)} required value={name} />
        <p className="mt-1 text-xs text-ink-3" id="new-project-name-hint">{copy.nameHint}</p>
      </div>
      {state.status !== "idle" && <div aria-live="polite" className="space-y-2 text-sm text-ink-2" role={success ? "status" : "alert"}>
        <p>{message || copy.unavailable}</p>
        {success && state.projectId && <p><span className="font-mono">{state.projectId}</span>{" · "}<Link className="text-accent underline" href={`/dashboard?project=${encodeURIComponent(state.projectId)}`}>{copy.dashboard}</Link></p>}
      </div>}
      <button className="pac-control-accent px-4 py-2 text-sm disabled:opacity-60" disabled={pending} type="submit">{pending ? copy.pending : copy.submit}</button>
    </form>
  );
}
