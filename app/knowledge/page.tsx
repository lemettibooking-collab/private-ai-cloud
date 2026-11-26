import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { OwnerDataUnavailable, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { KnowledgeUploadForm } from "@/components/domain/owner-console/project-resource-forms";
import { loadOwnerProjects } from "@/lib/composition/owner-console-read.server";
import { loadProjectKnowledge, projectResourceRequestKey } from "@/lib/composition/owner-project-resources.server";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectResourcesCopy } from "@/lib/i18n/project-resources-copy";
import { uploadKnowledgeAction } from "./actions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export default async function KnowledgePage({ searchParams }: Props) {
  const params = await searchParams, { locale } = await getI18n(), c = projectResourcesCopy(locale);
  const href = (project: string, filename?: string, version?: number) => `/knowledge?project=${encodeURIComponent(project)}${filename ? `&document=${encodeURIComponent(filename)}` : ""}${version ? `&version=${version}` : ""}`;
  if (params.project === undefined) {
    const projects = await loadOwnerProjects();
    return <AppShell><PageHeader description={c.knowledgeDescription} eyebrow={c.owner} title={c.knowledge} />
      {projects.state === "unauthenticated" ? <SignInRequired /> : projects.state !== "available" ? (<OwnerDataUnavailable />) : (<SectionCard title={c.choose}>
        <ul className="space-y-2">{projects.projects.map(p => <li key={p.projectId}><Link className="text-sm text-accent" href={href(p.projectId)}>{p.displayName}</Link></li>)}</ul>
      </SectionCard>)}
    </AppShell>;
  }
  const view = await loadProjectKnowledge(params.project, params.document, params.version);
  const selected = view.status === "available" ? view.binding.project : null;
  return <AppShell selectedProject={selected}><PageHeader description={c.knowledgeDescription} eyebrow={c.owner} title={selected ? `${c.knowledge} · ${selected.displayName}` : c.knowledge} />
    {view.status === "unauthenticated" ? <SignInRequired /> : view.status !== "available" ? (<OwnerDataUnavailable />) : (<div className="space-y-4">
      <nav className="flex gap-4 text-sm text-accent"><Link href="/projects">{c.projects}</Link><Link href={`/projects/${encodeURIComponent(view.binding.projectId)}`}>{c.repository}</Link><Link href={`/dashboard?project=${encodeURIComponent(view.binding.projectId)}`}>{c.dashboard}</Link></nav>
      {view.binding.projectStatus === "active" && <SectionCard title={c.upload}><KnowledgeUploadForm action={uploadKnowledgeAction} copy={c} documents={view.documents} key={view.binding.projectId} projectId={view.binding.projectId} requestId={projectResourceRequestKey()} /></SectionCard>}
      <SectionCard title={c.knowledge}>
        {!view.documents.length ? <p className="text-sm text-ink-2">{c.empty}</p> : <div className="overflow-x-auto"><table className="pac-table"><thead><tr>{[c.filename,c.version,c.uploaded,c.status,c.hash].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
          {view.documents.map(d => <tr key={d.filename}><td><Link className="text-accent" href={href(view.binding.projectId,d.filename,d.version)}>{d.filename}</Link></td><td>{d.version}</td><td>{d.uploadedAt}</td><td>{c.uploaded_unverified}</td><td className="font-mono text-xs">{d.sha256}</td></tr>)}
        </tbody></table></div>}
      </SectionCard>
      {view.selected && <SectionCard title={`${view.selected.document.filename} · ${c.version} ${view.selected.document.version}`}>
        <p className="mb-3 break-all font-mono text-xs text-ink-3">{c.hash}: {view.selected.document.sha256}</p>
        <nav aria-label={c.history} className="mb-4 flex flex-wrap gap-3 text-sm text-accent">{view.selected.versions.map(v => <Link href={href(view.binding.projectId,v.filename,v.version)} key={v.version}>{c.version} {v.version}</Link>)}</nav>
        <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded border border-line p-4 text-sm text-ink-2">{view.selected.content}</pre>
      </SectionCard>}
    </div>)}
  </AppShell>;
}
