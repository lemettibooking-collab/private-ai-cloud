import { StatusBadge } from "@/components/ui/status-badge";
import type { Stat } from "@/types/app";

type StatCardProps = {
  stat: Stat;
};

export function StatCard({ stat }: StatCardProps) {
  return (
    <div className="rounded-pac border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="pac-label">{stat.label}</p>
        <StatusBadge tone={stat.tone}>{stat.tone}</StatusBadge>
      </div>
      <p className="mt-3 font-mono text-3xl font-medium tracking-tight text-ink">{stat.value}</p>
      <p className="mt-1.5 text-xs text-ink-3">{stat.detail}</p>
    </div>
  );
}
