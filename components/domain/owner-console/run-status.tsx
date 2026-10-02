import { StatusBadge } from "@/components/ui/status-badge";
import type { OwnerConsoleApproval, OwnerConsoleRunStatus } from "@/lib/composition/owner-console-read.server";
import type { StatusTone } from "@/types/app";

const runTone: Record<OwnerConsoleRunStatus, StatusTone> = {
  queued: "neutral",
  running: "info",
  waiting_approval: "warning",
  review: "warning",
  completed: "success",
  failed: "danger",
  blocked: "danger",
  cancelled: "neutral",
};

const riskTone: Record<OwnerConsoleApproval["riskLevel"], StatusTone> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

const approvalTone: Record<OwnerConsoleApproval["status"], StatusTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function RunStatusBadge({ status }: { status: OwnerConsoleRunStatus }) {
  return <StatusBadge tone={runTone[status] ?? "neutral"}>{status.replaceAll("_", " ")}</StatusBadge>;
}

export function RiskBadge({ risk }: { risk: OwnerConsoleApproval["riskLevel"] }) {
  return <StatusBadge tone={riskTone[risk] ?? "neutral"}>{risk} risk</StatusBadge>;
}

export function ApprovalStatusBadge({ status }: { status: OwnerConsoleApproval["status"] }) {
  return <StatusBadge tone={approvalTone[status] ?? "neutral"}>{status}</StatusBadge>;
}
