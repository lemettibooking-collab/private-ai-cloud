import type { StatusTone } from "./app";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "edited"
  | "expired"
  | "cancelled";

export type RiskLevel = "low" | "medium" | "high" | "blocked";

export type ApprovalRequest = {
  id: string;
  title: string;
  actionType: string;
  riskLevel: RiskLevel;
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
