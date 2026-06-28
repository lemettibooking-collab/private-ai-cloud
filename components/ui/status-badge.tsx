import type { StatusTone } from "@/types/app";

const toneClassName: Record<StatusTone, string> = {
  neutral: "border-slate-600/70 bg-slate-800/70 text-slate-200",
  info: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  danger: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  locked: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200",
};

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: StatusTone;
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClassName[tone]}`}
    >
      {children}
    </span>
  );
}
