/** Public UI projection only. No database, provider, credentials or capability. */
export type OwnerAI044ProofView = Readonly<{
  status: "available"; phase: "NOT_PREPARED" | "PREPARED" | "AWAITING_OWNER_APPROVAL" | "APPROVED" | "REJECTED" | "INVOCATION_STARTED" | "COMPLETED" | "FAILED" | "RECOVERY_REQUIRED";
  selection: string; projectId: string; projectTaskId: string; developmentTaskId: string; attemptNumber: number;
  planRevision: number; baseline: string; model: string | null; registration: string | null;
  readContextPaths: readonly string[]; allowedWritePaths: readonly string[]; expiresAt: number | null;
  intentFingerprint: string | null; approvalRequestId: string | null;
  result: Readonly<{ status: string; changedPaths: readonly string[]; fingerprint: string; ownerDecisionRequired: true; verificationStatus: "not_run"; automaticRetryAllowed: false }> | null;
  runtimeDispatchAllowed: false; productionLiveDispatch: "BLOCKED";
}> | Readonly<{ status: "unavailable" }>;
