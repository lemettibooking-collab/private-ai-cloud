export const taskStatuses = [
  "draft",
  "classified",
  "policy_checked",
  "queued",
  "running",
  "awaiting_approval",
  "approved",
  "executing",
  "review",
  "completed",
  "failed",
  "blocked",
  "cancelled",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export const workflowRunStatuses = [
  "draft",
  "queued",
  "running",
  "generated",
  "waiting_approval",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
] as const;

export type WorkflowRunStatus = (typeof workflowRunStatuses)[number];

export const approvalStatuses = [
  "pending",
  "approved",
  "rejected",
  "edited",
  "expired",
  "cancelled",
] as const;

export type ApprovalStatus = (typeof approvalStatuses)[number];

export const riskLevels = ["low", "medium", "high", "critical"] as const;

export type RiskLevel = (typeof riskLevels)[number];

export const roleCodes = [
  "owner",
  "admin",
  "support_operator",
  "marketing_operator",
  "product_manager",
  "developer_reviewer",
  "viewer",
  "demo_viewer",
] as const;

export type RoleCode = (typeof roleCodes)[number];

export const legacyRoleCodeAliases = [
  { alias: "support", roleCode: "support_operator" },
  { alias: "marketing", roleCode: "marketing_operator" },
  { alias: "product", roleCode: "product_manager" },
  { alias: "reviewer", roleCode: "developer_reviewer" },
  { alias: "demo-viewer", roleCode: "demo_viewer" },
] as const satisfies ReadonlyArray<{
  alias: string;
  roleCode: RoleCode;
}>;

function includesValue<const Values extends readonly string[]>(
  values: Values,
  input: unknown,
): input is Values[number] {
  return typeof input === "string" && values.some((value) => value === input);
}

export function isTaskStatus(input: unknown): input is TaskStatus {
  return includesValue(taskStatuses, input);
}

export function parseTaskStatus(input: unknown): TaskStatus | null {
  return isTaskStatus(input) ? input : null;
}

export function isWorkflowRunStatus(
  input: unknown,
): input is WorkflowRunStatus {
  return includesValue(workflowRunStatuses, input);
}

export function parseWorkflowRunStatus(
  input: unknown,
): WorkflowRunStatus | null {
  return isWorkflowRunStatus(input) ? input : null;
}

export function isApprovalStatus(input: unknown): input is ApprovalStatus {
  return includesValue(approvalStatuses, input);
}

export function parseApprovalStatus(input: unknown): ApprovalStatus | null {
  return isApprovalStatus(input) ? input : null;
}

export function isRiskLevel(input: unknown): input is RiskLevel {
  return includesValue(riskLevels, input);
}

export function parseRiskLevel(input: unknown): RiskLevel | null {
  return isRiskLevel(input) ? input : null;
}

export function isRoleCode(input: unknown): input is RoleCode {
  return includesValue(roleCodes, input);
}

export function parseRoleCode(input: unknown): RoleCode | null {
  return isRoleCode(input) ? input : null;
}

export function mapLegacyRoleCode(input: unknown): RoleCode | null {
  const canonicalRoleCode = parseRoleCode(input);

  if (canonicalRoleCode) {
    return canonicalRoleCode;
  }

  if (typeof input !== "string") {
    return null;
  }

  return (
    legacyRoleCodeAliases.find(({ alias }) => alias === input)?.roleCode ?? null
  );
}
