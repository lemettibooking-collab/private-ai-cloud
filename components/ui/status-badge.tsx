import type { StatusTone } from "@/types/app";

// Semantic status language: run = cyan, ok = green, warn = amber, bad = red, idle = graphite.
const toneClassName: Record<StatusTone, string> = {
  neutral: "border-line-strong bg-panel-2 text-ink-2 [--dot:var(--pac-idle)]",
  info: "border-run/30 bg-run/10 text-run [--dot:var(--pac-run)]",
  success: "border-ok/30 bg-ok/10 text-ok [--dot:var(--pac-ok)]",
  warning: "border-warn/30 bg-warn/10 text-warn [--dot:var(--pac-warn)]",
  danger: "border-bad/35 bg-bad/10 text-bad [--dot:var(--pac-bad)]",
  locked: "border-line-strong bg-panel-2 text-ink-3 [--dot:var(--pac-idle)]",
};

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: StatusTone;
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] ${toneClassName[tone]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--dot)]" />
      {children}
    </span>
  );
}
