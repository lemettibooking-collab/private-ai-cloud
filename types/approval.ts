import type { StatusTone } from "./app";
import type { ApprovalStatus, RiskLevel } from "@/lib/contracts/domain";

export type { ApprovalStatus, RiskLevel } from "@/lib/contracts/domain";

export type ApprovalDisplayRiskLevel = RiskLevel | "blocked";

export type ApprovalRequest = {
  id: string;
  title: string;
  actionType: string;
  riskLevel: ApprovalDisplayRiskLevel;
  riskTone: StatusTone;
  requestedBy: string;
  allowedApprovers?: string[];
  status: ApprovalStatus;
  statusTone: StatusTone;
  preview: string;
  auditHint?: string;
  originalOutput?: string;
  editedOutput?: string;
  finalOutput?: string;
  sourceDocuments?: string[];
  riskNotes?: string[];
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  label: string;
  detail: string;
  timestamp: string;
  tone: StatusTone;
};
