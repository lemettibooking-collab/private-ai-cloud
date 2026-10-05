import { toneBadge, toneDot, toTone, type Tone } from "@/components/ui/tone";
import type { StatusTone } from "@/types/app";

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: Tone | StatusTone;
};

// The single status badge of the console: dot + text label (state is never conveyed by color alone).
export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  const semantic = toTone(tone);
  return (
    <span
      className={`inline-flex h-5 w-fit items-center gap-1.5 whitespace-nowrap rounded-[5px] border px-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] font-mono text-[10px] font-medium uppercase leading-none tracking-[0.08em] ${toneBadge[semantic]}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[semantic]}`} />
      {children}
    </span>
  );
}
