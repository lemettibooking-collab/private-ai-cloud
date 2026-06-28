import { StatusBadge } from "@/components/ui/status-badge";
import type { Stat } from "@/types/app";

type StatCardProps = {
  stat: Stat;
};

export function StatCard({ stat }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-400">{stat.label}</p>
        <StatusBadge tone={stat.tone}>{stat.tone}</StatusBadge>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-50">
        {stat.value}
      </p>
      <p className="mt-2 text-sm text-slate-500">{stat.detail}</p>
    </div>
  );
}
