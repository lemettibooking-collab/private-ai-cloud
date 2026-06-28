import { AuditTimeline } from "@/components/domain/audit-timeline";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { auditEvents, documents } from "@/lib/mock-data";

type KnowledgeDocumentPageProps = {
  params: Promise<{
    documentId: string;
  }>;
};

export default async function KnowledgeDocumentPage({
  params,
}: KnowledgeDocumentPageProps) {
  const { documentId } = await params;
  const document =
    documents.find((item) => item.id === documentId) ?? documents[0];

  return (
    <AppShell>
      <PageHeader
        description="Document detail page with source preview, indexing status, and related usage placeholders."
        eyebrow="Knowledge document"
        title={document.title}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <SectionCard title="Document metadata">
            <div className="grid gap-4 md:grid-cols-4">
              <StatusBadge tone={document.statusTone}>
                {document.status}
              </StatusBadge>
              <p className="text-sm text-slate-400">{document.collection}</p>
              <p className="text-sm text-slate-400">{document.size}</p>
              <p className="text-sm text-slate-400">{document.updatedAt}</p>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {document.indexingNote}
            </p>
          </SectionCard>

          <SectionCard title="Source preview">
            <p className="text-sm leading-6 text-slate-300">
              {document.sourcePreview}
            </p>
          </SectionCard>
        </div>

        <SectionCard title="Related activity">
          <AuditTimeline events={auditEvents} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
