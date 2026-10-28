import { AuditTimeline } from "@/components/domain/audit-timeline";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getI18n } from "@/lib/i18n/locale.server";
import { prototypeMock } from "@/lib/i18n/prototype-mock";
import { prototypePages } from "@/lib/i18n/prototype-pages";

type KnowledgeDocumentPageProps = {
  params: Promise<{
    documentId: string;
  }>;
};

export default async function KnowledgeDocumentPage({
  params,
}: KnowledgeDocumentPageProps) {
  const { documentId } = await params;
  const { locale } = await getI18n();
  const c = prototypePages[locale].document;
  const { documents, auditEvents, labels } = prototypeMock[locale];
  const document =
    documents.find((item) => item.id === documentId) ?? documents[0];

  return (
    <AppShell>
      <PageHeader
        description={c.description}
        eyebrow={c.eyebrow}
        title={document.title}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <SectionCard title={c.metadata}>
            <div className="grid gap-4 md:grid-cols-4">
              <StatusBadge tone={document.statusTone}>
                {labels.documentStatus[document.status]}
              </StatusBadge>
              <p className="text-sm text-slate-400">{document.collection}</p>
              <p className="text-sm text-slate-400">{document.size}</p>
              <p className="text-sm text-slate-400">{document.updatedAt}</p>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {document.indexingNote}
            </p>
          </SectionCard>

          <SectionCard title={c.sourcePreview}>
            <p className="text-sm leading-6 text-slate-300">
              {document.sourcePreview}
            </p>
          </SectionCard>
        </div>

        <SectionCard title={c.relatedActivity}>
          <AuditTimeline events={[...auditEvents]} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
