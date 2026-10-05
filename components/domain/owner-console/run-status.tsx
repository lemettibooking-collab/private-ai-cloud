import { approvalTone, projectTone, riskTone, runTone } from "@/components/domain/owner-console/status-tone";
import { StatusBadge } from "@/components/ui/status-badge";
import type { OwnerConsoleApproval, OwnerConsoleProject, OwnerConsoleRunStatus } from "@/lib/composition/owner-console-read.server";

export function RunStatusBadge({ status }: { status: OwnerConsoleRunStatus }) {
  return <StatusBadge tone={runTone[status] ?? "neutral"}>{status.replaceAll("_", " ")}</StatusBadge>;
}

export function RiskBadge({ risk }: { risk: OwnerConsoleApproval["riskLevel"] }) {
  return <StatusBadge tone={riskTone[risk] ?? "neutral"}>{risk} risk</StatusBadge>;
}

export function ApprovalStatusBadge({ status }: { status: OwnerConsoleApproval["status"] }) {
  return <StatusBadge tone={approvalTone[status] ?? "neutral"}>{status}</StatusBadge>;
}

export function ProjectStatusBadge({ status }: { status: OwnerConsoleProject["status"] }) {
  return <StatusBadge tone={projectTone[status] ?? "neutral"}>{status}</StatusBadge>;
}
