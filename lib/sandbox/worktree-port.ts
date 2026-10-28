import type { createSandboxExecutionContract, SandboxAuthority, SandboxCleanupAuthority, SandboxExecutionSnapshot } from "../contracts/sandbox-execution";

/** Server/internal boundary. None of these records is caller-authenticated authority. */
export type WorktreeIdentity = Readonly<{
  workspaceId: string; projectId: string; executionId: string; resourceGeneration: number; specFingerprint: string;
}>;
export type WorktreeOperation = WorktreeIdentity & Readonly<{ expectedRevision: number; fence: number }>;
export type FileIdentity = Readonly<{ device: number; inode: number }>;
export type WorktreeRepository = Readonly<{
  workspaceId: string; projectId: string; repositoryId: string; root: string; commonDirectory: string;
  rootIdentity: FileIdentity; commonIdentity: FileIdentity; protectedBranches: readonly string[];
}>;
export type WorktreeRecord = Readonly<{
  schemaVersion: 1; version: number; identity: WorktreeIdentity; resourceId: string; worktreeId: string;
  repository: WorktreeRepository; baselineCommit: string; executionRef: string; requestedBranch: string;
  path: string; slotIdentity: FileIdentity | null; directoryIdentity: FileIdentity | null;
  actualHead: string | null; createdAt: number; revision: number; fence: number;
  state: "creating" | "ready" | "blocked" | "removing" | "removed";
  cleanup: "not_started" | "pending" | "completed"; reason: WorktreeReason | null;
}>;
export type WorktreeReason = "repository_invalid" | "baseline_missing" | "baseline_mismatch" | "identity_conflict"
  | "path_invalid" | "worktree_conflict" | "git_operation_failure" | "verification_failure" | "stale_authority"
  | "cleanup_identity_mismatch" | "cleanup_failure" | "resource_missing" | "resource_mismatch" | "storage_unavailable";
export type WorktreeEvidenceKind = "create_requested" | "repository_validated" | "baseline_validated" | "worktree_created"
  | "head_verified" | "resource_ready" | "cleanup_requested" | "cleanup_authority_verified" | "resource_removed"
  | "failed_blocked" | "orphan_mismatch";
export type WorktreeEvidence = Readonly<{ kind: WorktreeEvidenceKind; resourceId: string; reason: WorktreeReason | null }>;
export type WorktreeDecision = Readonly<{
  verdict: "allow" | "deny"; status: "ready" | "idempotent" | "removed" | "already_cleaned" | "blocked";
  reason: WorktreeReason | null; resource: WorktreeRecord | null; evidence: readonly WorktreeEvidence[]; runtimeDispatchAllowed: false;
}>;
export type WorktreeContext = Readonly<{
  contract: ReturnType<typeof createSandboxExecutionContract>;
  snapshot: SandboxExecutionSnapshot;
  authority: SandboxAuthority | SandboxCleanupAuthority;
  repository: WorktreeRepository | null;
}>;

/**
 * REQUIRED trusted persistence boundary, not an optional in-memory convenience.
 * withExclusive serializes ALL writers for this platform root (including repository
 * registration, resource records and execution/cleanup authority changes). No lease
 * takeover while callback/child Git process can still run. No open DB transaction
 * may span callback: future store must use durable operation ownership/fencing.
 *
 * context MUST reread current trusted lifecycle, clock, policy and registry facts.
 * save MUST durably CAS the version (null = absent), including intent before Git;
 * rejection/ambiguous commit MUST throw. list MUST return a complete bounded set
 * or throw, never truncate. Records/evidence must be protected against tampering.
 *
 * No production implementation/composition is supplied in AI-042.2. A missing or
 * failing port grants no physical operation. A Map is NOT a compliant VPS store.
 */
export interface WorktreeLease {
  context(identity: WorktreeIdentity, purpose: "create" | "cleanup" | "reconcile"): Promise<WorktreeContext>;
  read(resourceId: string): Promise<WorktreeRecord | null>;
  save(record: WorktreeRecord, expectedVersion: number | null): Promise<void>;
  list(): Promise<readonly WorktreeRecord[]>;
}
export interface WorktreeStoragePort {
  withExclusive<T>(canonicalPlatformRoot: string, action: (lease: WorktreeLease) => Promise<T>): Promise<T>;
}
export interface WorktreePort {
  create(operation: unknown): Promise<WorktreeDecision>;
  cleanup(operation: unknown): Promise<WorktreeDecision>;
  reconcile(operation: unknown): Promise<WorktreeDecision>;
  discover(operation: unknown): Promise<Readonly<{
    verdict: "allow" | "deny"; reason: WorktreeReason | null;
    resources: readonly WorktreeRecord[]; orphans: readonly Readonly<{ reference: string; reason: "resource_mismatch" }>[];
    runtimeDispatchAllowed: false;
  }>>;
}
