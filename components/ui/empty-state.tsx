import { ActionButton } from "@/components/ui/action-button";

type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  // AI-038.5: `inline` renders a compact, left-aligned state inside a panel (no dashed box).
  variant?: "box" | "inline";
};

// Factual, compact empty state: what is absent and what that means — never an invented conclusion.
export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  variant = "box",
}: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <div className="px-4 py-5">
        <p className="text-[13px] font-medium text-ink-2">{title}</p>
        <p className="mt-0.5 max-w-xl text-xs leading-5 text-ink-3">{description}</p>
        {actionLabel && actionHref && (
          <div className="mt-3">
            <ActionButton href={actionHref} variant="secondary">{actionLabel}</ActionButton>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="pac-inset px-6 py-7 text-center">
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-[12.5px] leading-5 text-ink-3">{description}</p>
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
