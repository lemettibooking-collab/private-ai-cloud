import { toneDot, type Tone } from "@/components/ui/tone";

type SectionCardProps = {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  // AI-038.5 (optional): a factual count shown next to the title, a semantic marker for panels whose
  // content carries a state (e.g. attention), and `flush` for edge-to-edge tables / lists.
  count?: React.ReactNode;
  tone?: Tone;
  flush?: boolean;
};

// Operational panel: quiet surface, thin border, one header line (title · count · description · action).
export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
  count,
  tone,
  flush = false,
}: SectionCardProps) {
  return (
    <section className={`pac-surface min-w-0 overflow-hidden ${className}`}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-[12.5px] font-semibold tracking-tight text-ink">
                {tone && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-[2px] ${toneDot[tone]}`} />}
                <span className="truncate">{title}</span>
                {count !== undefined && <span className="font-mono text-[11px] font-normal text-ink-3">{count}</span>}
              </h2>
            )}
            {description && <p className="mt-0.5 text-[11.5px] leading-5 text-ink-3">{description}</p>}
          </div>
          {action && <div className="shrink-0 pt-0.5 text-xs">{action}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}
