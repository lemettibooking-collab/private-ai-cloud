import { StatusBadge } from "@/components/ui/status-badge";
import type { SourceCitation } from "@/types/knowledge";

type SourceCitationCardProps = {
  citation: SourceCitation;
};

export function SourceCitationCard({ citation }: SourceCitationCardProps) {
  return (
    <article className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-cyan-100">
            {citation.title}
          </h3>
          <p className="mt-1 text-xs text-cyan-200/60">
            {citation.collection}
          </p>
        </div>
        <StatusBadge tone="info">{citation.confidence}</StatusBadge>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        {citation.excerpt}
      </p>
    </article>
  );
}
