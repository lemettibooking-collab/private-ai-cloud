import { randomUUID } from "node:crypto";
import type { WorkflowRuntimeDatabase, WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
import type { SubscriptionIntent } from "../executors/ai044-subscription-intent";
import type { ExecutorCurrentAuthoritySnapshot } from "./executor-current-authority-store";
import type { NormalizedExecutorResult } from "../contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, sha256 } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeSubscriptionIntent, subscriptionIntentFingerprint, subscriptionIntentPayload, subscriptionIntentCurrent } from "../executors/ai044-subscription-intent.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044Fingerprint, ai044Hash, freezeAI044, captureAI044Data } from "../executors/ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, capturedMethod, inTransaction } from "./executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { resolveUserId, lockOwnerAuthority, Conflict } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockRoadmapProject, readRoadmapTaskInTransaction } from "./roadmap-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { readLatestRoadmapPlan } from "./roadmap-approvals.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { replayRoadmapOwnerCommand, recordRoadmapOwnerCommand } from "../roadmap/roadmap-owner-commands.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { deriveExecutorAuthorityFacts } from "../executors/executor-current-authority.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockExecutorWorkspaceProject, lockExecutorAuthority, executorAuthorityMatches } from "./executor-current-authority-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeExecutorControllerBinding, lockExecutorControllerBinding } from "./executor-controller-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorPredecessorsClear } from "./executor-predecessor-barrier.ts";

export type AI044SubscriptionApprovalCapability = Readonly<{ kind: "ai044_subscription_approval" }>;
export type AI044SubscriptionStartCapability = Readonly<{ kind: "ai044_subscription_start" }>;
export type AI044SubscriptionApprovalDecision = Readonly<{
  verdict: "allow" | "deny"; status: "requested" | "approved" | "rejected" | "ready" | "consumed" | "started" | "completed" | "failed" | "outcome_unknown" | "idempotent" | "denied" | "conflict" | "recovery_required" | "unauthenticated";
  approvalRequestId: string | null; intentFingerprint: string | null;
  approvalCapability: AI044SubscriptionApprovalCapability | null; startCapability: AI044SubscriptionStartCapability | null;
}>;
type CapabilityEvidence = { owner: object; approvalRequestId: string; intent: SubscriptionIntent; used: boolean };
const approvalCapabilities = new WeakMap<object, CapabilityEvidence>();
const startCapabilities = new WeakMap<object, { intent: SubscriptionIntent; approvalRequestId: string; used: boolean }>();
const deny = (status: AI044SubscriptionApprovalDecision["status"] = "denied"): AI044SubscriptionApprovalDecision => freezeAI044({ verdict: "deny", status, approvalRequestId: null, intentFingerprint: null, approvalCapability: null, startCapability: null });
const allow = (status: AI044SubscriptionApprovalDecision["status"], approvalRequestId: string, intent: SubscriptionIntent): AI044SubscriptionApprovalDecision => freezeAI044({ verdict: "allow", status, approvalRequestId, intentFingerprint: subscriptionIntentFingerprint(intent), approvalCapability: null, startCapability: null });
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const commandId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,39}$/u.test(v);
const fact = (v: unknown): void => { if (!v) throw new Conflict(); };
function canonicalResultPayload(raw: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, value]) => [k, sort(value)])) : v;
  return JSON.stringify(sort(boundedData(raw)));
}
/** For an already validated canonical result. Bounded independently from the small intent envelope. */
export const subscriptionResultFingerprint = (raw: unknown): string => sha256(canonicalResultPayload(raw));
function validateCanonicalResult(configuration: unknown, invocation: unknown, raw: unknown): NormalizedExecutorResult | null {
  try {
    const snapshot = boundedData(raw) as NormalizedExecutorResult, adapter = createExecutorAdapterContract(configuration).adapter;
    const receipt = adapter?.validateInvocation(invocation).normalizedInvocation;
    const result = receipt && adapter?.evaluateResult(receipt, { schemaVersion: snapshot.schemaVersion, identity: snapshot.identity, invocationId: snapshot.invocationId,
      status: snapshot.status, failureCode: snapshot.failureCode, changes: snapshot.changes, report: snapshot.report }).normalizedResult;
    return result && canonicalResultPayload(result) === canonicalResultPayload(snapshot) ? result : null;
  } catch { return null; }
}
/** Historical read ONLY. No current authority, credential, approval consumption or start issuer. */
export async function readAI044SubscriptionOutcomeInTransaction(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant,
  input: Readonly<{ projectId: string; projectTaskId: string; configuration: unknown; invocation: unknown; intentFingerprint: string }>): Promise<Readonly<{ normalizedResult: NormalizedExecutorResult; resultFingerprint: string }> | null> {
  if (!isResolvedWorkflowRuntimeTenant(tenant) || !ai044Hash(input.intentFingerprint)) return null;
  try {
    const adapter = createExecutorAdapterContract(input.configuration).adapter, invocation = adapter?.validateInvocation(input.invocation).normalizedInvocation;
    if (!invocation || invocation.identity.id !== "chatgpt-plan-patch" || invocation.identity.version !== "v1") return null;
    const q = await client.query(`/* subscription:historical-result */ select b.state,b.intent_payload,b.intent_fingerprint,b.normalized_result_payload,b.result_fingerprint,b.started_at,
      exists(select 1 from audit_events a where a.workspace_id=b.workspace_id and a.entity_id=b.approval_request_id and a.event_type='ai044.subscription_'||b.state
        and a.metadata->>'intentFingerprint'=b.intent_fingerprint and a.metadata->>'resultFingerprint'=b.result_fingerprint) as audited
      from ai044_subscription_approval_bindings b where b.workspace_id=$1 and b.project_key=$2 and b.project_task_key=$3 and b.development_run_id=$4 and b.attempt_number=$5 and b.consumed_at is not null`,
    [tenant.workspaceDatabaseId, input.projectId, input.projectTaskId, invocation.attempt.developmentRunId, invocation.attempt.number]);
    if (q.rowCount !== 1) return null; const b = q.rows[0];
    if (!["completed", "failed"].includes(b.state as string) || b.audited !== true || b.intent_fingerprint !== input.intentFingerprint
      || typeof b.normalized_result_payload !== "string" || Buffer.byteLength(b.normalized_result_payload) > 256 * 1024) return null;
    const i = normalizeSubscriptionIntent(JSON.parse(b.intent_payload as string));
    if (!i || subscriptionIntentFingerprint(i) !== input.intentFingerprint || i.invocationId !== invocation.invocationId || i.planId !== invocation.planId || i.taskId !== invocation.taskId
      || i.workspaceId !== tenant.workspaceId || i.workspaceDatabaseId !== tenant.workspaceDatabaseId || i.projectId !== input.projectId || i.projectTaskId !== input.projectTaskId
      || ai044Fingerprint(i.attempt) !== ai044Fingerprint(invocation.attempt) || ai044Fingerprint(i.repository) !== ai044Fingerprint(invocation.repository)) return null;
    const result = validateCanonicalResult(input.configuration, input.invocation, JSON.parse(b.normalized_result_payload));
    if (!result || subscriptionResultFingerprint(result) !== b.result_fingerprint || canonicalResultPayload(result) !== b.normalized_result_payload
      || (b.state === "completed" ? result.status !== "succeeded" || b.started_at === null : result.status !== "failed")) return null;
    return freezeAI044({ normalizedResult: result, resultFingerprint: b.result_fingerprint as string });
  } catch { return null; }
}
/** The transport can consume only the private acknowledged fence reference, once. */
export function consumeAI044SubscriptionStartCapability(raw: unknown): Readonly<{ approvalRequestId: string; intent: SubscriptionIntent }> | null {
  const e = raw && typeof raw === "object" ? startCapabilities.get(raw) : null;
  if (!e || e.used) return null; e.used = true;
  return freezeAI044({ approvalRequestId: e.approvalRequestId, intent: normalizeSubscriptionIntent(e.intent)! });
}

/** Narrow server/internal approval binding. No token source, provider, financial policy or live switch exists here. */
export function createAI044SubscriptionApprovals(raw: unknown) {
  const fields = ["database", "tenant", "projectId", "projectTaskId", "configuration", "identitySource"];
  const c = exactOwnData(raw, fields) ?? exactOwnData(raw, [...fields, "controllerBinding"]);
  const connect = c && capturedMethod(c.database, "connect"), resolve = c && capturedMethod(c.identitySource, "resolve");
  if (!c || !connect || !resolve || !isResolvedWorkflowRuntimeTenant(c.tenant) || typeof c.projectId !== "string" || typeof c.projectTaskId !== "string") throw Error("invalid_subscription_approval_configuration");
  const tenant: ResolvedWorkflowRuntimeTenant = c.tenant, projectId = c.projectId, projectTaskId = c.projectTaskId;
  const configuration = freezeAI044(captureAI044Data(c.configuration)) as import("../contracts/executor-adapter").ExecutorAdapterConfiguration;
  const authorityFacts = deriveExecutorAuthorityFacts(configuration);
  const controllerBinding = Object.hasOwn(c, "controllerBinding") ? normalizeExecutorControllerBinding(c.controllerBinding) : null;
  if (configuration.identity.id !== "chatgpt-plan-patch" || configuration.identity.version !== "v1") throw Error("invalid_subscription_approval_configuration");
  const database: WorkflowRuntimeDatabase = Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]> });
  const owner = Object.freeze({}); let uncertain = false;
  const bound = (i: SubscriptionIntent): boolean => i.workspaceId === tenant.workspaceId && i.workspaceDatabaseId === tenant.workspaceDatabaseId
    && i.projectId === projectId && i.projectTaskId === projectTaskId && i.planId === authorityFacts.planId && i.taskId === authorityFacts.taskId
    && i.attempt.developmentRunId === authorityFacts.developmentRunId && i.attempt.number === authorityFacts.attemptNumber && i.attempt.kind === authorityFacts.attemptKind
    && i.repository.id === configuration.repository.id && i.repository.baseline === configuration.repository.baseline
    && ai044Fingerprint(i.allowedWritePaths) === ai044Fingerprint([...configuration.developmentRun.admittedAllowedPaths].sort());
  async function now(client: WorkflowRuntimeSqlClient): Promise<number> {
    const r = await client.query(`/* subscription:clock */ select floor(extract(epoch from clock_timestamp())*1000)::text as now_ms`);
    const n = Number(r.rows[0]?.now_ms); fact(r.rowCount === 1 && Number.isSafeInteger(n) && n >= 0); return n;
  }
  async function audit(client: WorkflowRuntimeSqlClient, actor: string, approvalRequestId: string, event: string, i: SubscriptionIntent, resultFingerprint?: string | null) {
    await client.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,$3,'approval_request',$4,$5::jsonb)`,
      [tenant.workspaceDatabaseId, actor, `ai044.subscription_${event}`, approvalRequestId, JSON.stringify({ intentFingerprint: subscriptionIntentFingerprint(i), projectId, projectTaskId, ...(resultFingerprint ? { resultFingerprint } : {}) })]);
  }
  async function active(client: WorkflowRuntimeSqlClient, actor: string, i: SubscriptionIntent): Promise<ExecutorCurrentAuthoritySnapshot> {
    fact(bound(i)); await lockOwnerAuthority(client, tenant, actor);
    fact(await lockExecutorWorkspaceProject(client, tenant, projectId, true)); await lockRoadmapProject(client, tenant, projectId);
    const task = await readRoadmapTaskInTransaction(client, tenant, projectId, projectTaskId, true);
    fact(task?.status === "running");
    const latest = await readLatestRoadmapPlan(client, tenant, projectId, projectTaskId);
    fact(latest && latest.planId === i.planId && latest.revision === i.planRevision && latest.draftFingerprint === i.planFingerprint
      && ai044Fingerprint(latest!.plan) === ai044Fingerprint(configuration.admission.plan));
    fact(await lockExecutorControllerBinding(client, tenant, projectId, authorityFacts, configuration, controllerBinding));
    const a = await lockExecutorAuthority(client, tenant.workspaceDatabaseId, i.attempt.developmentRunId);
    fact(a && a.status === "active" && executorAuthorityMatches(a!, projectId, authorityFacts));
    // Existing paid writers take this same lock after current authority. No budget is created or charged.
    await client.query(`/* subscription:budget-serialization */ select workspace_id from executor_exposure_budgets where workspace_id=$1 for update`, [tenant.workspaceDatabaseId]);
    fact(await executorPredecessorsClear(client, tenant.workspaceDatabaseId, i.attempt.developmentRunId, i.attempt.number));
    fact(subscriptionIntentCurrent(i, await now(client))); return a!;
  }
  async function row(client: WorkflowRuntimeSqlClient, approvalRequestId: string, i: SubscriptionIntent) {
    const r = await client.query(`/* subscription:approval-lock */ select b.*,r.status as approval_status,r.action_type,r.approved_by::text,r.rejected_by::text,r.resolved_at as approval_resolved,
      d.id::text as actual_decision_id,d.decision,d.decided_by_actor_id from ai044_subscription_approval_bindings b
      join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
      left join approval_decisions d on d.workspace_id=r.workspace_id and d.approval_request_id=r.id
      where b.workspace_id=$1 and b.approval_request_id=$2 for update of b,r`, [tenant.workspaceDatabaseId, approvalRequestId]);
    fact(r.rowCount === 1); const b = r.rows[0];
    fact(b.intent_fingerprint === subscriptionIntentFingerprint(i) && b.intent_payload === subscriptionIntentPayload(i)
      && b.project_key === projectId && b.project_task_key === projectTaskId && b.action_type === "ai044_subscription_executor"); return b;
  }
  const approved = (b: Record<string, unknown>, actor: string): boolean => b.approval_status === "approved" && b.decision === "approved" && uuid(b.actual_decision_id)
    && b.decided_by_actor_id === actor && b.approved_by === actor && b.rejected_by === null && b.approval_resolved !== null;
  async function execute(work: (client: WorkflowRuntimeSqlClient, actor: string) => Promise<AI044SubscriptionApprovalDecision>): Promise<AI044SubscriptionApprovalDecision> {
    if (uncertain) return deny("recovery_required"); const actor = await resolveUserId(resolve!); if (!actor) return deny("unauthenticated");
    try { return await inTransaction(database, client => work(client, actor)); }
    catch (error) { if (error instanceof Conflict) return deny("conflict"); uncertain = true; return deny("recovery_required"); }
  }
  async function request(raw: unknown): Promise<AI044SubscriptionApprovalDecision> {
    const r = exactOwnData(raw, ["commandId", "intent"]), i = r && normalizeSubscriptionIntent(r.intent);
    if (!r || !commandId(r.commandId) || !i || !bound(i)) return deny();
    const command = r.commandId, fp = ai044Fingerprint(["pac.ai044.subscription-request.v1", i]);
    return execute(async (client, actor) => {
      await active(client, actor, i);
      const replay = await replayRoadmapOwnerCommand(client, tenant, command, fp);
      if (replay) { fact(uuid(replay.approvalRequestId)); return allow("idempotent", replay.approvalRequestId as string, i); }
      const old = await client.query(`select approval_request_id::text from ai044_subscription_approval_bindings where workspace_id=$1 and intent_fingerprint=$2`, [tenant.workspaceDatabaseId, subscriptionIntentFingerprint(i)]);
      fact(old.rowCount <= 1); const approvalRequestId = old.rowCount ? old.rows[0].approval_request_id as string : randomUUID();
      if (!old.rowCount) {
        await client.query(`insert into approval_requests(id,workspace_id,action_type,status,risk_level,allowed_approver_role_codes,original_payload) values($1,$2,'ai044_subscription_executor','pending','high',array['owner'],$3::jsonb)`,
          [approvalRequestId, tenant.workspaceDatabaseId, JSON.stringify({ projectId, projectTaskId, intentFingerprint: subscriptionIntentFingerprint(i) })]);
        await client.query(`insert into ai044_subscription_approval_bindings(workspace_id,approval_request_id,project_key,project_task_key,plan_key,plan_revision,development_run_id,attempt_number,intent_payload,intent_fingerprint,expires_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11::double precision/1000))`, [tenant.workspaceDatabaseId, approvalRequestId, projectId, projectTaskId,
          i.planId, i.planRevision, i.attempt.developmentRunId, i.attempt.number, subscriptionIntentPayload(i), subscriptionIntentFingerprint(i), i.expiresAt]);
        await audit(client, actor, approvalRequestId, "approval_requested", i);
      }
      const result = allow("requested", approvalRequestId, i); await recordRoadmapOwnerCommand(client, tenant, command, fp, result); return result;
    });
  }
  async function decide(raw: unknown): Promise<AI044SubscriptionApprovalDecision> {
    const r = exactOwnData(raw, ["commandId", "approvalRequestId", "intentFingerprint", "decision"]);
    if (!r || !commandId(r.commandId) || !uuid(r.approvalRequestId) || !ai044Hash(r.intentFingerprint) || !["approved", "rejected"].includes(r.decision as string)) return deny();
    const command = r.commandId, approvalRequestId = r.approvalRequestId;
    return execute(async (client, actor) => {
      await lockOwnerAuthority(client, tenant, actor); await lockRoadmapProject(client, tenant, projectId);
      const q = await client.query(`select intent_payload from ai044_subscription_approval_bindings where workspace_id=$1 and approval_request_id=$2 and project_key=$3 and project_task_key=$4`, [tenant.workspaceDatabaseId, approvalRequestId, projectId, projectTaskId]);
      fact(q.rowCount === 1); const i = normalizeSubscriptionIntent(JSON.parse(q.rows[0].intent_payload as string)); fact(i && subscriptionIntentFingerprint(i) === r.intentFingerprint);
      await active(client, actor, i!); const fp = ai044Fingerprint(["pac.ai044.subscription-decision.v1", r]);
      const replay = await replayRoadmapOwnerCommand(client, tenant, command, fp); if (replay) return allow("idempotent", approvalRequestId, i!);
      const b = await row(client, approvalRequestId, i!); fact(b.approval_status === "pending" && b.state === "ready");
      await client.query(`insert into approval_decisions(workspace_id,approval_request_id,decision,decided_by_actor_id,command_id) values($1,$2,$3,$4,$5)`, [tenant.workspaceDatabaseId, approvalRequestId, r.decision, actor, command]);
      await client.query(`update approval_requests set status=$3,resolved_at=clock_timestamp(),approved_by=case when $3='approved' then $4::uuid else null end,rejected_by=case when $3='rejected' then $4::uuid else null end where workspace_id=$1 and id=$2`, [tenant.workspaceDatabaseId, approvalRequestId, r.decision, actor]);
      await client.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,'ai044.subscription_approval_decided','approval_request',$3,$4::jsonb)`, [tenant.workspaceDatabaseId, actor, approvalRequestId, JSON.stringify({ projectId, projectTaskId, decision: r.decision, intentFingerprint: r.intentFingerprint })]);
      const result = allow(r.decision as "approved" | "rejected", approvalRequestId, i!); await recordRoadmapOwnerCommand(client, tenant, command, fp, result); return result;
    });
  }
  async function inspectOrConsume(raw: unknown, consume: boolean): Promise<AI044SubscriptionApprovalDecision> {
    const r = exactOwnData(raw, ["approvalRequestId", "intent"]), i = r && normalizeSubscriptionIntent(r.intent);
    if (!r || !uuid(r.approvalRequestId) || !i || !bound(i)) return deny(); const approvalRequestId = r.approvalRequestId;
    const result = await execute(async (client, actor) => {
      const a = await active(client, actor, i); const b = await row(client, approvalRequestId, i);
      fact(approved(b, actor)); if (b.state !== "ready") return deny("recovery_required");
      if (!consume) return allow("ready", approvalRequestId, i);
      const paid = await client.query(`/* subscription:current-paid-attempt */ select development_run_id from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 limit 1`, [tenant.workspaceDatabaseId, i.attempt.developmentRunId, i.attempt.number]);
      if (paid.rowCount !== 0) return deny("recovery_required");
      await client.query(`/* subscription:consume */ update ai044_subscription_approval_bindings set state='consumed',consumed_at=clock_timestamp(),decision_id=$3,owner_actor_id=$4,authority_generation=$5,canonical_run_fingerprint=$6,admission_fingerprint=$7 where workspace_id=$1 and approval_request_id=$2 and state='ready'`,
        [tenant.workspaceDatabaseId, approvalRequestId, b.actual_decision_id, actor, a.generation, a.canonicalRunFingerprint, a.admissionFingerprint]);
      await audit(client, actor, approvalRequestId, "approval_consumed", i); return allow("consumed", approvalRequestId, i);
    });
    // A COMMIT failure never reaches this issuer; another request cannot reconstruct it.
    if (consume && result.verdict === "allow" && result.status === "consumed") {
      const capability = Object.freeze({ kind: "ai044_subscription_approval" as const }); approvalCapabilities.set(capability, { owner, approvalRequestId, intent: i, used: false });
      return freezeAI044({ ...result, approvalCapability: capability });
    }
    return result;
  }
  async function fence(raw: unknown): Promise<AI044SubscriptionApprovalDecision> {
    const r = exactOwnData(raw, ["approvalCapability"]), e = r?.approvalCapability && typeof r.approvalCapability === "object" ? approvalCapabilities.get(r.approvalCapability) : null;
    if (!e || e.owner !== owner || e.used) return deny(); e.used = true;
    const result = await execute(async (client, actor) => {
      const a = await active(client, actor, e.intent), b = await row(client, e.approvalRequestId, e.intent);
      fact(approved(b, actor) && b.state === "consumed" && b.authority_generation === a.generation && b.canonical_run_fingerprint === a.canonicalRunFingerprint && b.admission_fingerprint === a.admissionFingerprint);
      await client.query(`/* subscription:fence */ update ai044_subscription_approval_bindings set state='started',started_at=clock_timestamp() where workspace_id=$1 and approval_request_id=$2 and state='consumed'`, [tenant.workspaceDatabaseId, e.approvalRequestId]);
      await audit(client, actor, e.approvalRequestId, "started", e.intent); return allow("started", e.approvalRequestId, e.intent);
    });
    if (result.verdict === "allow" && result.status === "started") {
      const capability = Object.freeze({ kind: "ai044_subscription_start" as const }); startCapabilities.set(capability, { approvalRequestId: e.approvalRequestId, intent: e.intent, used: false });
      return freezeAI044({ ...result, startCapability: capability });
    }
    return result;
  }
  async function recordOutcome(raw: unknown): Promise<AI044SubscriptionApprovalDecision> {
    const r = exactOwnData(raw, ["approvalRequestId", "intent", "state", "resultFingerprint", "normalizedResult"]), i = r && normalizeSubscriptionIntent(r.intent);
    if (!r || !uuid(r.approvalRequestId) || !i || !bound(i) || !["completed", "failed", "outcome_unknown"].includes(r.state as string)
      || (r.state === "outcome_unknown" ? r.resultFingerprint !== null || r.normalizedResult !== null : !ai044Hash(r.resultFingerprint))) return deny();
    let resultPayload: string | null = null;
    if (r.state !== "outcome_unknown") {
      const invocation = { schemaVersion: 1, invocationId: i.invocationId, identity: i.executor, planId: i.planId, taskId: i.taskId, repository: i.repository,
        capability: "coding", mode: "patch_proposal", attempt: i.attempt };
      const result = validateCanonicalResult(configuration, invocation, r.normalizedResult);
      if (!result || subscriptionResultFingerprint(result) !== r.resultFingerprint || (r.state === "completed" ? result.status !== "succeeded" : result.status !== "failed")) return deny();
      resultPayload = canonicalResultPayload(result);
    }
    const approvalRequestId = r.approvalRequestId;
    return execute(async (client, actor) => {
      // Historical terminal capture can close an old attempt, but cannot issue a new start.
      await lockOwnerAuthority(client, tenant, actor); fact(await lockExecutorWorkspaceProject(client, tenant, projectId, false)); await lockRoadmapProject(client, tenant, projectId);
      await lockExecutorAuthority(client, tenant.workspaceDatabaseId, i.attempt.developmentRunId);
      await client.query(`/* subscription:budget-serialization */ select workspace_id from executor_exposure_budgets where workspace_id=$1 for update`, [tenant.workspaceDatabaseId]);
      const b = await row(client, approvalRequestId, i); fact(approved(b, actor));
      if (b.state === r.state && b.result_fingerprint === r.resultFingerprint) return allow("idempotent", approvalRequestId, i);
      fact(b.state === "started" || b.state === "consumed" && r.state === "failed");
      await client.query(`/* subscription:outcome */ update ai044_subscription_approval_bindings set state=$3,result_fingerprint=$4,normalized_result_payload=$5,resolved_at=clock_timestamp() where workspace_id=$1 and approval_request_id=$2`, [tenant.workspaceDatabaseId, approvalRequestId, r.state, r.resultFingerprint, resultPayload]);
      await audit(client, actor, approvalRequestId, r.state as string, i, r.resultFingerprint as string | null);
      return allow(r.state as "completed" | "failed" | "outcome_unknown", approvalRequestId, i);
    });
  }
  return Object.freeze({ request, decide, check: (raw: unknown) => inspectOrConsume(raw, false), consume: (raw: unknown) => inspectOrConsume(raw, true), fence, recordOutcome });
}
