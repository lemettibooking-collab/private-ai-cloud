import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { OwnerDataUnavailable, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { RepositoryBindingForm } from "@/components/domain/owner-console/project-resource-forms";
import { loadProjectRepository, projectResourceRequestKey } from "@/lib/composition/owner-project-resources.server";
import { getI18n } from "@/lib/i18n/locale.server";
import { projectResourcesCopy } from "@/lib/i18n/project-resources-copy";
import { bindRepositoryAction } from "./actions";

export default async function ProjectRepositoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params, { locale } = await getI18n(), c = projectResourcesCopy(locale);
  const view = await loadProjectRepository(projectId);
  return <AppShell selectedProject={view.status === "ok" ? view.value.project : null}><PageHeader description={c.repositoryDescription} eyebrow={c.owner} title={c.repository} />
    {view.status === "unauthenticated" ? <SignInRequired /> : view.status !== "ok" ? (<OwnerDataUnavailable />) : (<SectionCard title={view.value.displayName}>
      <nav className="mb-4 flex gap-4 text-sm text-accent"><Link href="/projects">{c.projects}</Link><Link href={`/dashboard?project=${encodeURIComponent(projectId)}`}>{c.dashboard}</Link><Link href={`/knowledge?project=${encodeURIComponent(projectId)}`}>{c.knowledge}</Link></nav>
      <p className="mb-2 text-sm text-ink-2">{c[view.value.bindingStatus]}</p><p className="mb-4 text-xs text-ink-3">{c.baseline}</p>
      {view.value.projectStatus === "active" && <RepositoryBindingForm action={bindRepositoryAction} branch={view.value.defaultBranch} copy={c} key={projectId} projectId={projectId} requestId={projectResourceRequestKey()} revision={view.value.revision} url={view.value.url} />}
      {view.value.projectStatus !== "active" && <p className="text-sm text-ink-2">{view.value.url ?? c.not_configured} · {view.value.defaultBranch}</p>}
    </SectionCard>)}
  </AppShell>;
}
