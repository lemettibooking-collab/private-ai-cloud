import { StatusBadge } from "@/components/ui/status-badge";
import type { KnowledgeDocument } from "@/types/knowledge";

type DocumentCardProps = {
  document: KnowledgeDocument;
};

export function DocumentCard({ document }: DocumentCardProps) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-50">
            {document.title}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {document.collection} / {document.size} / {document.updatedAt}
          </p>
        </div>
        <StatusBadge tone={document.statusTone}>{document.status}</StatusBadge>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-400">
        {document.sourcePreview}
      </p>
      <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs leading-5 text-slate-400">
        {document.indexingNote}
      </p>
    </article>
  );
}
