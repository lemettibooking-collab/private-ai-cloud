import { toneBadge, toTone, type Tone } from "@/components/ui/tone";
import type { StatusTone } from "@/types/app";

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: Tone | StatusTone;
};

// The single status badge of the console: a tinted text label (state is never conveyed by color alone —
// the label always names it). Words use Geist, like the rest of the working area.
export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  const semantic = toTone(tone);
  return (
    <span
      className={`inline-flex h-5 w-fit items-center whitespace-nowrap rounded-[5px] border px-1.5 text-[11px] font-medium leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${toneBadge[semantic]}`}
    >
      {children}
    </span>
  );
}
