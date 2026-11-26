"use client";
import { useActionState, useState } from "react";
import type { ProjectResourcesCopy } from "@/lib/i18n/project-resources-copy";
type State = { status: string };
type Common = { projectId: string; requestId: string; copy: ProjectResourcesCopy; action: (state: State, form: FormData) => Promise<State> };
const input = "pac-control mt-1 block w-full px-3 py-2 text-sm";
function Outcome({ state, copy }: { state: State; copy: ProjectResourcesCopy }) {
  if (state.status === "idle") return null;
  const message = Object.hasOwn(copy, state.status) ? copy[state.status as keyof ProjectResourcesCopy] : copy.unavailable;
  return <p aria-live="polite" className="text-sm text-ink-2" role="status">{message}</p>;
}
export function RepositoryBindingForm(props: Common & { revision: number; url: string | null; branch: string | null }) {
  const [state, action, pending] = useActionState(props.action, { status: "idle" });
  const [url, setUrl] = useState(props.url ?? ""), [branch, setBranch] = useState(props.branch ?? "main");
  return <form action={action} className="space-y-4">
    <input name="projectId" type="hidden" value={props.projectId} /><input name="requestId" type="hidden" value={props.requestId} /><input name="expectedRevision" type="hidden" value={props.revision} />
    <label className="block text-sm">{props.copy.url}<input className={input} disabled={pending} maxLength={250} name="url" onChange={e => setUrl(e.target.value)} required type="url" value={url} /></label>
    <label className="block text-sm">{props.copy.branch}<input className={input} disabled={pending} maxLength={200} name="defaultBranch" onChange={e => setBranch(e.target.value)} required value={branch} /></label>
    <Outcome copy={props.copy} state={state} />
    <button className="pac-control-accent px-4 py-2 text-sm" disabled={pending} type="submit">{pending ? props.copy.saving : props.copy.bind}</button>
  </form>;
}
export function KnowledgeUploadForm(props: Common & { documents: readonly { filename: string; version: number }[] }) {
  const [state, action, pending] = useActionState(props.action, { status: "idle" });
  const [filename, setFilename] = useState("");
  const version = props.documents.find(d => d.filename === filename)?.version ?? 0;
  return <form action={action} className="space-y-4">
    <input name="projectId" type="hidden" value={props.projectId} /><input name="requestId" type="hidden" value={props.requestId} /><input name="expectedVersion" type="hidden" value={version} />
    <label className="block text-sm">{props.copy.file}<input accept=".md,.yaml,.yml" className={input} disabled={pending} name="file" onChange={e => setFilename(e.target.files?.[0]?.name ?? "")} required type="file" /></label>
    <p className="text-xs text-ink-3">{props.copy.limits}</p><p className="text-xs text-ink-3">{props.copy.newVersion}</p>
    <Outcome copy={props.copy} state={state} />
    <button className="pac-control-accent px-4 py-2 text-sm" disabled={pending} type="submit">{pending ? props.copy.pending : props.copy.upload}</button>
  </form>;
}
