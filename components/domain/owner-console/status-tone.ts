import type { Tone } from "@/components/ui/tone";
import type { OwnerConsoleApproval, OwnerConsoleProject, OwnerConsoleRunStatus, OwnerConsoleTaskStatus } from "@/lib/composition/owner-console-read.server";

// AI-038.5: the one place where Owner Console states map onto the semantic tone system. Task, run,
// project, approval and risk badges all read from here (no per-component color decisions).

export const taskTone: Record<OwnerConsoleTaskStatus, Tone> = {
  draft: "muted",
  ready: "active",
  planning: "active",
  approved: "active",
  running: "active",
  verifying: "active",
  waiting_owner: "attention",
  blocked: "danger",
  recovery_required: "danger",
  failed: "danger",
  completed: "success",
  cancelled: "muted",
};

export const runTone: Record<OwnerConsoleRunStatus, Tone> = {
  queued: "neutral",
  running: "active",
  waiting_approval: "attention",
  review: "attention",
  completed: "success",
  failed: "danger",
  blocked: "danger",
  cancelled: "muted",
};

export const projectTone: Record<OwnerConsoleProject["status"], Tone> = {
  active: "success",
  paused: "attention",
  archived: "muted",
};

export const approvalTone: Record<OwnerConsoleApproval["status"], Tone> = {
  pending: "attention",
  approved: "success",
  rejected: "danger",
  cancelled: "muted",
};

export const riskTone: Record<OwnerConsoleApproval["riskLevel"], Tone> = {
  low: "neutral",
  medium: "attention",
  high: "danger",
  critical: "danger",
};

// My Attention severity groups (tone + statuses; labels come from the locale dictionary).
export const attentionGroups = [
  { id: "waiting_owner", statuses: ["waiting_owner"], tone: "attention" },
  { id: "blocked", statuses: ["blocked", "recovery_required"], tone: "danger" },
  { id: "failed", statuses: ["failed"], tone: "danger" },
] as const satisfies readonly { id: string; statuses: readonly OwnerConsoleTaskStatus[]; tone: Tone }[];

export const attentionStatuses: ReadonlySet<OwnerConsoleTaskStatus> = new Set(attentionGroups.flatMap((group) => group.statuses));
