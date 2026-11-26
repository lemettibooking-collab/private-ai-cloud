import type { StatusTone } from "@/types/app";

// AI-038.5 semantic tone system. One vocabulary for every operational state in the console:
//   neutral   — informational, no state implied
//   active    — in progress / running (cyan)
//   success   — completed / healthy (green)
//   attention — needs Owner action / waiting (amber)
//   danger    — failed / blocked / critical (red)
//   muted     — draft, cancelled, not applicable
// Color is never the only carrier: every badge / indicator also renders its state as text.
export type Tone = "neutral" | "active" | "success" | "attention" | "danger" | "muted";

// Legacy prototype tones (types/app StatusTone) map onto the same system.
const legacy: Record<StatusTone, Tone> = {
  neutral: "neutral",
  info: "active",
  success: "success",
  warning: "attention",
  danger: "danger",
  locked: "muted",
};

export function toTone(tone: Tone | StatusTone): Tone {
  return (legacy as Record<string, Tone>)[tone] ?? (tone as Tone);
}

export const toneText: Record<Tone, string> = {
  neutral: "text-ink",
  active: "text-run",
  success: "text-ok",
  attention: "text-warn",
  danger: "text-bad",
  muted: "text-ink-3",
};

export const toneDot: Record<Tone, string> = {
  neutral: "bg-ink-3",
  active: "bg-run",
  success: "bg-ok",
  attention: "bg-warn",
  danger: "bg-bad",
  muted: "bg-idle/60",
};

export const toneBadge: Record<Tone, string> = {
  neutral: "border-line-strong bg-panel-2 text-ink-2",
  active: "border-run/25 bg-run/8 text-run",
  success: "border-ok/25 bg-ok/8 text-ok",
  attention: "border-warn/30 bg-warn/8 text-warn",
  danger: "border-bad/30 bg-bad/8 text-bad",
  muted: "border-line bg-transparent text-ink-3",
};
