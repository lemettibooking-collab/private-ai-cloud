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
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-center">
      <p className="text-base font-semibold text-slate-100">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
        {description}
      </p>
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
