type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
};

// Page identity line: mono eyebrow (section), title, one line of factual purpose; context on the right.
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className="pac-label mb-1.5 !text-accent">{eyebrow}</p>}
        <h1 className="truncate text-[20px] font-semibold leading-7 tracking-tight text-ink">{title}</h1>
        <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
