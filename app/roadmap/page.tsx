import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { OwnerDataUnavailable, ProjectUnavailable, ScopeBadge, SignInRequired } from "@/components/domain/owner-console/owner-state";
import { RoadmapOwnerView } from "@/components/domain/roadmap-owner-view";
import { loadOwnerRoadmap } from "@/lib/composition/owner-roadmap-read.server";
import { getI18n } from "@/lib/i18n/locale.server";
import { roadmapContent } from "@/lib/i18n/roadmap-content";
export default async function RoadmapPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const view = await loadOwnerRoadmap((await searchParams).project), { locale } = await getI18n();
  const c = roadmapContent[locale];
  const selected = view.state === "available" && view.scope.mode === "project" ? view.scope.project : null;
  return <AppShell selectedProject={selected}>
    <PageHeader title={c.pageTitle} eyebrow={c.eyebrow}
      description={c.description}
      action={view.state === "available" ? <ScopeBadge project={selected} /> : undefined} />
    {view.state === "unauthenticated" && <SignInRequired />}
    {view.state === "unavailable" && <OwnerDataUnavailable />}
    {view.state === "project_unavailable" && <ProjectUnavailable allHref="/roadmap" />}
    {view.state === "available" && <RoadmapOwnerView view={view} locale={locale} />}
  </AppShell>;
}
