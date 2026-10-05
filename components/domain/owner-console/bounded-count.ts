import type { Tone } from "../../ui/tone";

// AI-038.5 V-1: honest readings over a BOUNDED list.
//
// A parent list may be truncated (the backend view is full). That only says the TOTAL may be larger;
// it says nothing about how a category subset of the hidden rows is distributed. So:
//   * a category count is the observed count within the shown rows — never suffixed with "+";
//   * "+" belongs only to the total of the very list that was truncated (totalReading);
//   * zero observed in a truncated list is NOT a factual "clear" (no success tone, no state).

export type CategoryReading = Readonly<{ value: string; state?: string; tone: Tone }>;

export function totalReading(count: number, truncated: boolean): string {
  return `${count}${truncated ? "+" : ""}`;
}

// Attention-style category (Owner action needed when > 0).
export function attentionReading(observed: number, parentTruncated: boolean): CategoryReading {
  if (observed > 0) return Object.freeze({ value: String(observed), state: "action", tone: "attention" as const });
  if (parentTruncated) return Object.freeze({ value: "0", tone: "neutral" as const });
  return Object.freeze({ value: "0", state: "clear", tone: "success" as const });
}

// Plain category count within a possibly bounded list (no "+", no inferred state).
export function observedCount(observed: number): string {
  return String(observed);
}
