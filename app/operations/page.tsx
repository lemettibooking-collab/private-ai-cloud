import { ProjectOperationsCenter } from "@/components/domain/project-operations-center";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypePages } from "@/lib/i18n/prototype-pages";

// Bilingual prototype page (AI-038.6 L10N-2): all copy comes from lib/i18n/prototype-pages.
export default async function OperationsPage() {
  const { locale } = await getI18n();
  const c = prototypePages[locale].operations;
  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={c.title}
      />
      <ProjectOperationsCenter labels={c} />
    </AppShell>
  );
}
