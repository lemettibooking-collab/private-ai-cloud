import { ActionButton } from "@/components/ui/action-button";

type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
};

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps) {
  return (
    <div className="rounded-pac border border-dashed border-line-strong bg-panel/60 px-6 py-8 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xl text-[13px] leading-5 text-ink-3">{description}</p>
      {actionLabel && actionHref && (
        <div className="mt-4">
          <ActionButton href={actionHref} variant="secondary">
            {actionLabel}
          </ActionButton>
        </div>
      )}
    </div>
  );
}
