import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
import type { ExecutorAuthorityFacts } from "../executors/executor-current-authority";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { deriveExecutorAuthorityFacts } from "../executors/executor-current-authority.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, capturedMethod, inTransaction } from "./executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, freezeDeep } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeExecutorControllerBinding, lockExecutorControllerBinding } from "./executor-controller-binding.ts";

export type ExecutorCurrentAuthoritySnapshot = Readonly<{
  projectId: string; developmentRunId: string; planId: string; taskId: string;
  generation: number; status: "active" | "revoked"; attemptNumber: number; attemptKind: "initial" | "corrective";
  canonicalRunFingerprint: string; admissionFingerprint: string; admissionScopeFingerprint: string | null; createdAt: number; updatedAt: number; revokedAt: number | null;
}>;
export type ExecutorCurrentAuthorityDecision = Readonly<{
  verdict: "allow" | "deny"; status: "registered" | "advanced" | "revoked" | "observed" | "idempotent" | "denied" | "conflict" | "recovery_required";
  snapshot: ExecutorCurrentAuthoritySnapshot | null;
}>;
const deny = (status: "denied" | "conflict" | "recovery_required" = "denied"): ExecutorCurrentAuthorityDecision => freezeDeep({ verdict: "deny", status, snapshot: null });
const allow = (status: ExecutorCurrentAuthorityDecision["status"], snapshot: ExecutorCurrentAuthoritySnapshot): ExecutorCurrentAuthorityDecision => freezeDeep({ verdict: "allow", status, snapshot });
const validId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(v);
const fingerprint = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const requireFact = (v: unknown) => { if (!v) throw Error("invalid_executor_authority_state"); };
function time(v: unknown): number { requireFact(typeof v === "string" && /^(?:0|[1-9][0-9]*)$/u.test(v)); const n = Number(v); requireFact(Number.isSafeInteger(n)); return n; }

/** Shared lock prefix. Project status is factual, not duplicated in authority. */
export async function lockExecutorWorkspaceProject(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, projectId: string, active: boolean): Promise<boolean> {
  const w = await client.query(`/* executor:workspace */ select domain_workspace_id, status from workspaces where id = $1 for share`, [tenant.workspaceDatabaseId]);
  if (w.rowCount !== 1 || w.rows[0].domain_workspace_id !== tenant.workspaceId || !["active", "demo"].includes(w.rows[0].status as string)) return false;
  const p = await client.query(`/* executor:project */ select status from projects where workspace_id = $1 and project_key = $2 for share`, [tenant.workspaceDatabaseId, projectId]);
  return p.rowCount === 1 && (!active || p.rows[0].status === "active");
}
/** Only call after workspace/Project locks, BEFORE any budget/exposure lock. */
export async function lockExecutorAuthority(client: WorkflowRuntimeSqlClient, workspace: string, runId: string): Promise<ExecutorCurrentAuthoritySnapshot | null> {
  const r = await client.query(`/* executor:authority-lock */ select project_key, development_run_id, plan_id, task_id,
    authority_generation, authority_status, current_attempt_number, current_attempt_kind, canonical_run_fingerprint, admission_fingerprint, admission_scope_fingerprint,
    floor(extract(epoch from created_at)*1000)::text as created_ms, floor(extract(epoch from updated_at)*1000)::text as updated_ms,
    floor(extract(epoch from revoked_at)*1000)::text as revoked_ms
    from executor_run_authorities where workspace_id = $1 and development_run_id = $2 limit 2 for update`, [workspace, runId]);
  requireFact(r.rowCount <= 1 && r.rows.length === r.rowCount);
  if (!r.rowCount) return null;
  const a = boundedData(r.rows[0]) as Record<string, unknown>;
  requireFact([a.project_key, a.development_run_id, a.plan_id, a.task_id].every(validId) && a.development_run_id === runId
    && Number.isInteger(a.authority_generation) && (a.authority_generation as number) >= 1 && (a.authority_generation as number) <= 1000000
    && ((a.current_attempt_number === 1 && a.current_attempt_kind === "initial") || ([2, 3].includes(a.current_attempt_number as number) && a.current_attempt_kind === "corrective"))
    && fingerprint(a.canonical_run_fingerprint) && fingerprint(a.admission_fingerprint)
    && (a.admission_scope_fingerprint === null || fingerprint(a.admission_scope_fingerprint)));
  const createdAt = time(a.created_ms), updatedAt = time(a.updated_ms), revokedAt = a.revoked_ms === null ? null : time(a.revoked_ms);
  requireFact(updatedAt >= createdAt && ((a.authority_status === "active" && revokedAt === null)
    || (a.authority_status === "revoked" && revokedAt !== null && revokedAt >= createdAt && revokedAt === updatedAt)));
  const j = await client.query(`/* executor:authority-journal-integrity */ select count(*)::int as count from executor_authority_events
    where workspace_id=$1 and development_run_id=$2 and authority_generation=$3 and authority_status=$4
    and project_key=$5 and plan_id=$6 and task_id=$7 and current_attempt_number=$8 and current_attempt_kind=$9
    and canonical_run_fingerprint=$10 and admission_fingerprint=$11 and admission_scope_fingerprint is not distinct from $12`, [workspace, runId, a.authority_generation, a.authority_status,
    a.project_key, a.plan_id, a.task_id, a.current_attempt_number, a.current_attempt_kind, a.canonical_run_fingerprint, a.admission_fingerprint, a.admission_scope_fingerprint]);
  requireFact(j.rowCount === 1 && j.rows[0].count === 1);
  return freezeDeep({ projectId: a.project_key as string, developmentRunId: runId, planId: a.plan_id as string, taskId: a.task_id as string,
    generation: a.authority_generation as number, status: a.authority_status as "active" | "revoked", attemptNumber: a.current_attempt_number as number,
    attemptKind: a.current_attempt_kind as "initial" | "corrective", canonicalRunFingerprint: a.canonical_run_fingerprint as string,
    admissionFingerprint: a.admission_fingerprint as string, admissionScopeFingerprint: a.admission_scope_fingerprint as string | null, createdAt, updatedAt, revokedAt });
}
export function executorAuthorityMatches(a: ExecutorCurrentAuthoritySnapshot, projectId: string, f: ExecutorAuthorityFacts): boolean {
  return a.projectId === projectId && a.developmentRunId === f.developmentRunId && a.planId === f.planId && a.taskId === f.taskId
    && a.attemptNumber === f.attemptNumber && a.attemptKind === f.attemptKind
    && a.canonicalRunFingerprint === f.canonicalRunFingerprint && a.admissionFingerprint === f.admissionFingerprint
    && (a.admissionScopeFingerprint === null || a.admissionScopeFingerprint === f.admissionScopeFingerprint);
}
/** Internal trusted control-plane port. No invocation, generation, status or approval parameters. */
export function createPostgresExecutorCurrentAuthorityStore(input: unknown) {
  const fields = ["database", "tenant", "projectId", "configuration"];
  const c = exactOwnData(input, fields) ?? exactOwnData(input, [...fields, "controllerBinding"]);
  const connect = c && capturedMethod(c.database, "connect");
  if (!c || !connect || !isResolvedWorkflowRuntimeTenant(c.tenant) || !validId(c.projectId)) throw Error("invalid_executor_authority_configuration");
  const tenant = c.tenant, projectId = c.projectId, configuration = freezeDeep(boundedData(c.configuration)), f = deriveExecutorAuthorityFacts(configuration);
  const controllerBinding = Object.hasOwn(c, "controllerBinding") ? normalizeExecutorControllerBinding(c.controllerBinding) : null;
  const database: WorkflowRuntimeDatabase = Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]> });
  const key = [tenant.workspaceDatabaseId, f.developmentRunId];
  let uncertain = false;
  async function journal(client: WorkflowRuntimeSqlClient, operation: string) {
    const r = await client.query(`/* executor:authority-journal */ insert into executor_authority_events
      (workspace_id,development_run_id,authority_generation,authority_status,project_key,plan_id,task_id,current_attempt_number,
       current_attempt_kind,canonical_run_fingerprint,admission_fingerprint,admission_scope_fingerprint,operation,created_at)
      select workspace_id,development_run_id,authority_generation,authority_status,project_key,plan_id,task_id,current_attempt_number,
       current_attempt_kind,canonical_run_fingerprint,admission_fingerprint,admission_scope_fingerprint,$3,updated_at from executor_run_authorities
      where workspace_id=$1 and development_run_id=$2`, [...key, operation]); requireFact(r.rowCount === 1);
  }
  async function run(operation: "register" | "advance" | "revoke" | "inspect"): Promise<ExecutorCurrentAuthorityDecision> {
    if (uncertain) return deny("recovery_required");
    try { return await inTransaction(database, async client => {
      if (!await lockExecutorWorkspaceProject(client, tenant, projectId, operation === "register" || operation === "advance")) return deny();
      if ((operation === "register" || operation === "advance")
        && !await lockExecutorControllerBinding(client, tenant, projectId, f, configuration, controllerBinding)) return deny("conflict");
      if (uncertain) return deny("recovery_required");
      if (operation === "register") {
        const inserted = await client.query(`/* executor:authority-register */ insert into executor_run_authorities
          (workspace_id,development_run_id,authority_generation,authority_status,project_key,plan_id,task_id,current_attempt_number,
           current_attempt_kind,canonical_run_fingerprint,admission_fingerprint,admission_scope_fingerprint,created_at,updated_at)
          select $1,$2,1,'active',$3,$4,$5,$6,$7,$8,$9,$10,stamp.time,stamp.time from (select clock_timestamp() as time) stamp
          on conflict (workspace_id,development_run_id) do nothing`, [...key, projectId, f.planId, f.taskId, f.attemptNumber, f.attemptKind, f.canonicalRunFingerprint, f.admissionFingerprint, f.admissionScopeFingerprint]);
        if (inserted.rowCount === 1) { await journal(client, "register"); const a = await lockExecutorAuthority(client, ...key as [string, string]); requireFact(a); return allow("registered", a!); }
      }
      const a = await lockExecutorAuthority(client, ...key as [string, string]);
      if (!a) return deny();
      const same = executorAuthorityMatches(a, projectId, f);
      if (operation === "inspect") return a.projectId === projectId ? allow("observed", a) : deny();
      if (operation === "register") return same && a.status === "active" ? allow("idempotent", a) : deny("conflict");
      if (operation === "revoke") {
        if (!same) return deny("conflict");
        if (a.status === "revoked") return allow("idempotent", a);
      } else {
        if (same) return a.status === "active" ? allow("idempotent", a) : deny("conflict");
        const stableMatches = a.admissionScopeFingerprint === null ? a.admissionFingerprint === f.admissionFingerprint : a.admissionScopeFingerprint === f.admissionScopeFingerprint;
        if (a.projectId !== projectId || a.planId !== f.planId || a.taskId !== f.taskId || !stableMatches
          || f.attemptNumber !== a.attemptNumber + 1 || f.predecessorRunFingerprint !== a.canonicalRunFingerprint) return deny("conflict");
      }
      if (a.generation >= 1000000) return deny();
      const updated = operation === "revoke"
        ? await client.query(`/* executor:authority-revoke */ update executor_run_authorities set authority_generation=authority_generation+1,
            authority_status='revoked',revoked_at=statement_timestamp(),updated_at=statement_timestamp()
            where workspace_id=$1 and development_run_id=$2 and authority_generation=$3 and authority_status='active'`, [...key, a.generation])
        : await client.query(`/* executor:authority-advance */ update executor_run_authorities set authority_generation=authority_generation+1,
            authority_status='active',revoked_at=null,updated_at=statement_timestamp(),current_attempt_number=$4,current_attempt_kind=$5,
            canonical_run_fingerprint=$6,admission_fingerprint=$7 where workspace_id=$1 and development_run_id=$2 and authority_generation=$3`,
          [...key, a.generation, f.attemptNumber, f.attemptKind, f.canonicalRunFingerprint, f.admissionFingerprint]);
      requireFact(updated.rowCount === 1); await journal(client, operation);
      const fresh = await lockExecutorAuthority(client, ...key as [string, string]); requireFact(fresh);
      return allow(operation === "revoke" ? "revoked" : "advanced", fresh!);
    }); } catch { uncertain = true; return deny("recovery_required"); }
  }
  return Object.freeze({ registerCurrentAuthority: () => run("register"), advanceCurrentAuthority: () => run("advance"),
    revokeCurrentAuthority: () => run("revoke"), inspectCurrentAuthority: () => run("inspect") });
}
