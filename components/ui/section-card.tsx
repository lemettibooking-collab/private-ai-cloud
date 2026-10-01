type SectionCardProps = {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: SectionCardProps) {
  return (
    <section className={`rounded-pac border border-line bg-panel ${className}`}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="pac-label !text-ink-2">{title}</h2>}
            {description && <p className="mt-1 text-xs leading-5 text-ink-3">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
