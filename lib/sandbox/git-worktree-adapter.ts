import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { boundedData, exactRecord, freezeDeep, sha256 } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript needs the runtime extension.
import { absent, addWorktree, contains, directory, inspectWorktrees, removeWorktree, requireWorktree, safeAbsolute, sameFile, validateRepository, verifyBaseline, verifyWorktree, WorktreeBlocked } from "./git-worktree-driver.ts";
import type { SandboxAuthority, SandboxExecutionSnapshot } from "../contracts/sandbox-execution";
import type { FileIdentity, WorktreeContext, WorktreeDecision, WorktreeEvidence, WorktreeEvidenceKind, WorktreeIdentity, WorktreeLease, WorktreeOperation, WorktreePort, WorktreeReason, WorktreeRecord, WorktreeStoragePort } from "./worktree-port";

const equal = (a: unknown, b: unknown) => isDeepStrictEqual(boundedData(a), boundedData(b));
const frozen = <T>(value: T): T => freezeDeep(structuredClone(value));
const identifier = (value: unknown) => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value);
const integer = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
function operation(input: unknown): WorktreeOperation {
  const o = exactRecord(boundedData(input), ["workspaceId", "projectId", "executionId", "resourceGeneration", "specFingerprint", "expectedRevision", "fence"]);
  requireWorktree([o.workspaceId, o.projectId, o.executionId].every(identifier)
    && integer(o.resourceGeneration, 1, 1000000) && typeof o.specFingerprint === "string" && /^[a-f0-9]{64}$/u.test(o.specFingerprint)
    && integer(o.expectedRevision, 1, 64) && integer(o.fence, 0, 1000000), "identity_conflict");
  return o as WorktreeOperation;
}
function identity(o: WorktreeIdentity): WorktreeIdentity {
  return { workspaceId: o.workspaceId, projectId: o.projectId, executionId: o.executionId, resourceGeneration: o.resourceGeneration, specFingerprint: o.specFingerprint };
}
// Generation separates resources; fingerprint is deliberately NOT in the key: a
// changed payload for the same generation must collide, not get another checkout.
function resourceId(o: WorktreeIdentity): string { return sha256(JSON.stringify([o.workspaceId, o.projectId, o.executionId, o.resourceGeneration])); }
function bind(context: WorktreeContext, o: WorktreeOperation): SandboxExecutionSnapshot {
  const validation = context.contract.validateSnapshot(context.snapshot), s = validation.snapshot;
  requireWorktree(validation.ok && s, "stale_authority");
  requireWorktree(equal(identity(o), { workspaceId: s.spec.workspaceId, projectId: s.spec.projectId, executionId: s.spec.executionId,
    resourceGeneration: s.spec.checkout.resourceGeneration, specFingerprint: s.specFingerprint }), "identity_conflict");
  requireWorktree(s.revision === o.expectedRevision && s.fence === o.fence, "stale_authority"); return s;
}
function authorizeCreation(context: WorktreeContext, o: WorktreeOperation): SandboxExecutionSnapshot {
  const s = bind(context, o), a = context.authority as SandboxAuthority;
  requireWorktree(!("resourceGeneration" in a) && a.active && a.generation === s.authorityGeneration
    && a.now >= s.updatedAt && a.now < a.expiresAt && s.owner?.workerId === a.actorId && a.now < s.owner.expiresAt
    && (s.state === "preparing" || s.state === "ready"), "stale_authority"); // M8
  const prepare = s.events.find(e => e.action.type === "prepare");
  requireWorktree(prepare, "stale_authority");
  // Exact replay checks CURRENT policy/grants without inventing an evidence event
  // or persisting a domain transition. Historical snapshot validation alone cannot.
  const decision = context.contract.apply(s, { commandId: prepare.commandId, expectedRevision: prepare.expectedRevision,
    fence: prepare.fence, action: prepare.action }, a);
  requireWorktree(decision.verdict === "allow" && decision.authorityScope === "execution_contract", "stale_authority");
  return s;
}
function authorizeCleanup(context: WorktreeContext, o: WorktreeOperation, alreadyRemoved: boolean): SandboxExecutionSnapshot {
  const s = bind(context, o), a = context.authority, begin = s.events.findLast(e => e.action.type === "begin_cleanup");
  requireWorktree("resourceGeneration" in a && begin, "cleanup_identity_mismatch");
  const decision = context.contract.applyCleanup(s, { commandId: begin.commandId, expectedRevision: begin.expectedRevision,
    fence: begin.fence, action: begin.action }, a);
  requireWorktree(decision.verdict === "allow" && decision.authorityScope === "cleanup_only", "cleanup_identity_mismatch");
  requireWorktree(alreadyRemoved || (s.cleanup.status === "running" && s.owner?.workerId === a.actorId && a.now >= s.updatedAt && a.now < s.owner.expiresAt), "stale_authority");
  return s;
}
function checkRepository(context: WorktreeContext, s: SandboxExecutionSnapshot) {
  const r = context.repository;
  requireWorktree(r && r.workspaceId === s.spec.workspaceId && r.projectId === s.spec.projectId && r.repositoryId === s.spec.repository.id, "repository_invalid");
  requireWorktree(/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/u.test(s.spec.checkout.branch)
    && !r.protectedBranches.includes(s.spec.checkout.branch) && !["main", "master", "HEAD"].includes(s.spec.checkout.branch), "worktree_conflict"); // M5
  return frozen(boundedData(r)) as WorktreeContext["repository"] & {};
}
function checkRecord(record: WorktreeRecord, o: WorktreeOperation, root: string): void {
  // Trusted store integrity remains required; revalidate bounded schema and all
  // derived destructive targets even when the port accidentally returns bad data.
  exactRecord(boundedData(record), ["schemaVersion", "version", "identity", "resourceId", "worktreeId", "repository", "baselineCommit", "executionRef", "requestedBranch", "path", "slotIdentity", "directoryIdentity", "actualHead", "createdAt", "revision", "fence", "state", "cleanup", "reason"]);
  requireWorktree(record.schemaVersion === 1 && integer(record.version, 1, Number.MAX_SAFE_INTEGER)
    && record.resourceId === resourceId(o) && record.identity.workspaceId === o.workspaceId && record.identity.projectId === o.projectId
    && record.identity.executionId === o.executionId && record.identity.resourceGeneration === o.resourceGeneration // M3
    && record.identity.specFingerprint === o.specFingerprint, "cleanup_identity_mismatch");
  requireWorktree(record.path === join(root, record.resourceId, "checkout") && contains(root, record.path), "path_invalid"); // M4
  requireWorktree(record.executionRef === `detached:${record.resourceId}` && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(record.baselineCommit)
    && record.repository.workspaceId === o.workspaceId && record.repository.projectId === o.projectId
    && ["creating", "ready", "blocked", "removing", "removed"].includes(record.state), "resource_mismatch");
  const fileId = (v: FileIdentity | null) => v === null || (integer(v.device, 0, Number.MAX_SAFE_INTEGER) && integer(v.inode, 1, Number.MAX_SAFE_INTEGER));
  const reasons: readonly string[] = ["repository_invalid", "baseline_missing", "baseline_mismatch", "identity_conflict", "path_invalid", "worktree_conflict",
    "git_operation_failure", "verification_failure", "stale_authority", "cleanup_identity_mismatch", "cleanup_failure", "resource_missing", "resource_mismatch", "storage_unavailable"];
  requireWorktree(record.worktreeId === o.executionId && identifier(record.repository.repositoryId)
    && integer(record.createdAt, 0, Number.MAX_SAFE_INTEGER) && integer(record.revision, 1, 64) && integer(record.fence, 0, 1000000)
    && fileId(record.slotIdentity) && fileId(record.directoryIdentity)
    && ["not_started", "pending", "completed"].includes(record.cleanup)
    && (record.reason === null || reasons.includes(record.reason))
    && /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/u.test(record.requestedBranch)
    && (record.actualHead === null || record.actualHead === record.baselineCommit)
    && (record.state !== "ready" || (record.actualHead === record.baselineCommit && record.slotIdentity && record.directoryIdentity)), "resource_mismatch");
}

/** Local Git lifecycle ONLY. No production store, composition, generic runner or agent dispatch. */
export async function createGitWorktreeAdapter(options: Readonly<{ sandboxRoot: string; storage: WorktreeStoragePort }>): Promise<WorktreePort> {
  safeAbsolute(options.sandboxRoot);
  const root = options.sandboxRoot, rootIdentity = await directory(root), permissions = await lstat(root);
  requireWorktree(root.split("/").filter(Boolean).length >= 3 && (permissions.mode & 0o077) === 0
    && permissions.uid === process.getuid?.() && typeof options.storage?.withExclusive === "function", "path_invalid");
  const storage = options.storage;
  async function rootSafe() {
    const stat = await lstat(root);
    requireWorktree(sameFile(await directory(root), rootIdentity) && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.(), "path_invalid");
  }
  async function pathsSafe(record: WorktreeRecord, requireSlot = true) {
    await rootSafe();
    requireWorktree(!contains(record.repository.root, root) && !contains(root, record.repository.root)
      && root !== record.repository.root && !contains(record.repository.commonDirectory, root)
      && !contains(root, record.repository.commonDirectory) && root !== record.repository.commonDirectory, "path_invalid"); // M1
    if (requireSlot) requireWorktree(record.slotIdentity && sameFile(await directory(join(root, record.resourceId)), record.slotIdentity), "path_invalid");
    if (!(await absent(record.path))) {
      const actual = await directory(record.path);
      if (record.directoryIdentity) requireWorktree(sameFile(actual, record.directoryIdentity), "resource_mismatch");
    }
  }
  async function save(lease: WorktreeLease, before: WorktreeRecord | null, next: WorktreeRecord): Promise<WorktreeRecord> {
    const record = frozen({ ...next, version: (before?.version ?? 0) + 1 });
    try { await lease.save(record, before?.version ?? null); } catch { throw new WorktreeBlocked("storage_unavailable"); }
    return record;
  }
  async function fact(record: WorktreeRecord): Promise<string> {
    await pathsSafe(record);
    const rows = await inspectWorktrees(record.repository), found = rows.find(row => row.path === record.path);
    requireWorktree(found && !(await absent(record.path)), "resource_missing");
    const head = await verifyWorktree(record.repository, record.path);
    requireWorktree(head === record.baselineCommit, "baseline_mismatch"); // M2
    return head;
  }
  const reasonOf = (e: unknown, fallback: WorktreeReason): WorktreeReason => e instanceof WorktreeBlocked ? e.reason : fallback;
  function result(record: WorktreeRecord | null, status: WorktreeDecision["status"], reason: WorktreeReason | null, evidence: WorktreeEvidence[]): WorktreeDecision {
    return frozen({ verdict: reason === null ? "allow" : "deny", status, reason, resource: reason === null ? record : null, evidence, runtimeDispatchAllowed: false });
  }
  async function run(input: unknown, purpose: "create" | "cleanup" | "reconcile"): Promise<WorktreeDecision> {
    const evidence: WorktreeEvidence[] = []; let id = "unresolved";
    const event = (kind: WorktreeEvidenceKind, reason: WorktreeReason | null = null) => { evidence.push({ kind, resourceId: id, reason }); };
    try {
      const o = operation(input); id = resourceId(o);
      return await storage.withExclusive(root, async lease => {
        await rootSafe();
        const context = await lease.context(identity(o), purpose);
        const s = purpose === "create" ? authorizeCreation(context, o) : bind(context, o);
        const stored = await lease.read(id);
        let record = stored === null ? null : frozen(boundedData(stored)) as WorktreeRecord;
        if (record) checkRecord(record, o, root);
        if (purpose === "create") {
          event("create_requested"); const repository = checkRepository(context, s);
          await validateRepository(repository); event("repository_validated");
          await verifyBaseline(repository, s.spec.repository.baseline); event("baseline_validated");
          const path = join(root, id, "checkout");
          const proposed: WorktreeRecord = { schemaVersion: 1, version: 1, identity: identity(o), resourceId: id, worktreeId: s.spec.checkout.worktreeId,
            repository, baselineCommit: s.spec.repository.baseline, executionRef: `detached:${id}`, requestedBranch: s.spec.checkout.branch,
            path, slotIdentity: null, directoryIdentity: null, actualHead: null, createdAt: context.authority.now,
            revision: s.revision, fence: s.fence, state: "creating", cleanup: "not_started", reason: null };
          await pathsSafe(proposed, false);
          if (record) { // M6
            requireWorktree(equal(record.repository, repository) && record.baselineCommit === proposed.baselineCommit
              && record.worktreeId === proposed.worktreeId && record.requestedBranch === proposed.requestedBranch, "identity_conflict");
            requireWorktree(record.state === "ready", "worktree_conflict"); await fact(record);
            event("resource_ready"); return result(record, "idempotent", null, evidence);
          }
          const rows = await inspectWorktrees(repository);
          requireWorktree(rows.every(row => !contains(row.path, path) && !contains(path, row.path) && row.path !== path)
            && await absent(join(root, id)), "worktree_conflict");
          record = await save(lease, null, proposed); // Durable intent BEFORE any filesystem mutation.
          await mkdir(join(root, id), { mode: 0o700 });
          record = await save(lease, record, { ...record, slotIdentity: await directory(join(root, id)) });
          authorizeCreation(await lease.context(identity(o), "create"), o);
          await pathsSafe(record);
          await addWorktree(repository, path, record.baselineCommit); event("worktree_created");
          // Reread current lifecycle/clock after Git, still under exclusive operation ownership.
          authorizeCreation(await lease.context(identity(o), "create"), o);
          let actualHead: string;
          try {
            actualHead = await fact(record); // M7
            event("head_verified");
          } catch (error) {
            // Rollback ONLY this unpublished intent's exact, detached Git resource.
            // If any physical identity check fails, leave a blocked discoverable intent.
            try { await pathsSafe(record); await verifyWorktree(repository, path); await removeWorktree(repository, path); } catch { /* Manual reconciliation, never recursive fallback. */ }
            await save(lease, record, { ...record, state: "blocked", reason: reasonOf(error, "verification_failure"), cleanup: "pending" });
            throw error;
          }
          record = await save(lease, record, { ...record, state: "ready", actualHead,
            directoryIdentity: await directory(path) });
          event("resource_ready"); return result(record, "ready", null, evidence);
        }
        requireWorktree(record, "resource_missing");
        requireWorktree(record.worktreeId === s.spec.checkout.worktreeId && record.baselineCommit === s.spec.repository.baseline
          && record.repository.repositoryId === s.spec.repository.id && record.requestedBranch === s.spec.checkout.branch, "resource_mismatch");
        if (purpose === "cleanup") {
          event("cleanup_requested"); authorizeCleanup(context, o, record.state === "removed"); event("cleanup_authority_verified");
          await validateRepository(record.repository); await pathsSafe(record); const target = record.path;
          if (record.state === "removed") {
            requireWorktree(await absent(target) && !(await inspectWorktrees(record.repository)).some(row => row.path === target), "resource_mismatch");
            return result(record, "already_cleaned", null, evidence);
          }
          const rows = await inspectWorktrees(record.repository), found = rows.find(row => row.path === target);
          if (found) {
            requireWorktree(!(await absent(record.path)), "resource_missing");
            // Cleanup may remove owned changed files/commits; not a readiness assertion.
            // Detached ownership/common-dir/inode still MUST match, not just a path.
            await verifyWorktree(record.repository, record.path);
          } else requireWorktree(await absent(record.path), "resource_mismatch");
          record = await save(lease, record, { ...record, state: "removing", cleanup: "pending", revision: o.expectedRevision, fence: o.fence });
          authorizeCleanup(await lease.context(identity(o), "cleanup"), o, false);
          await pathsSafe(record);
          if (found) {
            try { await removeWorktree(record.repository, record.path); } catch { throw new WorktreeBlocked("cleanup_failure"); }
          }
          requireWorktree(await absent(target) && !(await inspectWorktrees(record.repository)).some(row => row.path === target), "cleanup_failure");
          record = await save(lease, record, { ...record, state: "removed", cleanup: "completed", reason: null });
          event("resource_removed"); return result(record, "removed", null, evidence);
        }
        // Reconciliation is historical inspection, NOT execution reauthorization.
        requireWorktree(context.repository && equal(context.repository, record.repository), "repository_invalid");
        await validateRepository(record.repository);
        if (record.state === "removed") {
          await pathsSafe(record); requireWorktree(await absent(record.path)
            && !(await inspectWorktrees(record.repository)).some(row => row.path === record!.path), "resource_mismatch");
          return result(record, "already_cleaned", null, evidence);
        }
        requireWorktree(record.state === "creating" || record.state === "ready", record.reason ?? "resource_mismatch");
        try {
          const actualHead = await fact(record);
          if (record.state !== "ready") record = await save(lease, record, { ...record, actualHead, directoryIdentity: await directory(record.path), state: "ready", reason: null });
          event("head_verified"); event("resource_ready"); return result(record, "ready", null, evidence);
        } catch (error) {
          const reason = reasonOf(error, "verification_failure");
          if (reason !== "storage_unavailable") await save(lease, record, { ...record, state: "blocked", reason, cleanup: "pending" });
          event("orphan_mismatch", reason); throw error;
        }
      });
    } catch (error) { const reason = reasonOf(error, "storage_unavailable"); event("failed_blocked", reason); return result(null, "blocked", reason, evidence); }
  }
  return Object.freeze({
    create: (input: unknown) => run(input, "create"), cleanup: (input: unknown) => run(input, "cleanup"), reconcile: (input: unknown) => run(input, "reconcile"),
    async discover(input: unknown) {
      try {
        const o = operation(input);
        return await storage.withExclusive(root, async lease => {
          await rootSafe(); const context = await lease.context(identity(o), "reconcile"), s = bind(context, o), repository = checkRepository(context, s);
          await validateRepository(repository);
          const records = await lease.list(); requireWorktree(records.length <= 256, "storage_unavailable");
          const scoped = records.filter(r => equal(r.repository, repository)).map(r => frozen(boundedData(r)) as WorktreeRecord);
          for (const record of scoped) {
            checkRecord(record, { ...record.identity, expectedRevision: record.revision, fence: record.fence }, root);
            if (record.state === "ready" || record.state === "creating") await fact(record);
            else if (record.state === "removed") {
              await pathsSafe(record); requireWorktree(await absent(record.path)
                && !(await inspectWorktrees(repository)).some(row => row.path === record.path), "resource_mismatch");
            }
          }
          const known = new Set(scoped.map(r => r.path));
          const orphans = (await inspectWorktrees(repository)).filter(r => contains(root, r.path) && !known.has(r.path))
            .map(r => ({ reference: sha256(r.path), reason: "resource_mismatch" as const })).sort((a, b) => a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0);
          return frozen({ verdict: "allow" as const, reason: null, resources: [...scoped].sort((a, b) => a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0), orphans, runtimeDispatchAllowed: false as const });
        });
      } catch (error) { return frozen({ verdict: "deny" as const, reason: reasonOf(error, "storage_unavailable"), resources: [], orphans: [], runtimeDispatchAllowed: false as const }); }
    },
  });
}
