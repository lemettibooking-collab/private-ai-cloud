import { approvalTone, projectTone, riskTone, runTone } from "@/components/domain/owner-console/status-tone";
import { StatusBadge } from "@/components/ui/status-badge";
import type { OwnerConsoleApproval, OwnerConsoleProject, OwnerConsoleRunStatus } from "@/lib/composition/owner-console-read.server";
import { getI18n } from "@/lib/i18n/locale.server";

// Domain values stay canonical; only the displayed label is localized (exhaustive dictionary maps).
export async function RunStatusBadge({ status }: { status: OwnerConsoleRunStatus }) {
  const { t } = await getI18n();
  return <StatusBadge tone={runTone[status] ?? "neutral"}>{t.runStatus[status] ?? status}</StatusBadge>;
}

export async function RiskBadge({ risk }: { risk: OwnerConsoleApproval["riskLevel"] }) {
  const { t } = await getI18n();
  return <StatusBadge tone={riskTone[risk] ?? "neutral"}>{t.riskBadge[risk] ?? risk}</StatusBadge>;
}

export async function ApprovalStatusBadge({ status }: { status: OwnerConsoleApproval["status"] }) {
  const { t } = await getI18n();
  return <StatusBadge tone={approvalTone[status] ?? "neutral"}>{t.approvalStatus[status] ?? status}</StatusBadge>;
}

export async function ProjectStatusBadge({ status }: { status: OwnerConsoleProject["status"] }) {
  const { t } = await getI18n();
  return <StatusBadge tone={projectTone[status] ?? "neutral"}>{t.projectStatus[status] ?? status}</StatusBadge>;
}
