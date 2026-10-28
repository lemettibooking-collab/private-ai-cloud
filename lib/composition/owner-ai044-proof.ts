import { randomUUID } from "node:crypto";
import type { ExecutorAdapterConfiguration } from "../contracts/executor-adapter";
import type { AuthenticatedIdentitySource } from "./authenticated-owner-read-runtime";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../db/workflow-runtime-tenant";
import type { ChatGPTSubscriptionFacts } from "../integrations/chatgpt/chatgpt-credential-store";
import type { OwnerAI044ProofView } from "../../types/ai044-proof";
import type { createAI044SubscriptionRun } from "./ai044-subscription-run";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, inTransaction } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { resolveSessionOwner } from "../integrations/chatgpt/chatgpt-owner-authority.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockOwnerAuthority } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createDevelopmentControllerStore, readDevelopmentControllerStateInTransaction } from "../db/development-controller-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresExecutorCurrentAuthorityStore } from "../db/executor-current-authority-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { readAI044SubscriptionOutcomeInTransaction } from "../db/ai044-subscription-approvals.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { controllerAdmission, controllerInvocationId, controllerTaskClass } from "../roadmap/development-controller-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeSubscriptionIntent, subscriptionExecutorIdentity, subscriptionRegistrationFingerprint, subscriptionIntentFingerprint, subscriptionIntentCurrent, subscriptionReceiptMaximumAgeMs } from "../executors/ai044-subscription-intent.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeAI044SubscriptionContextManifest, ai044SubscriptionContextPath, normalizeSubscriptionRepository } from "../executors/ai044-subscription-context.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044Fingerprint, captureAI044Data, freezeAI044, ai044SafeText } from "../executors/ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isChatGPTSubscriptionFacts } from "../integrations/chatgpt/chatgpt-credential-store.ts";

/** Trusted LOCAL configuration, never request data. Pin one already approved plan,
 * one existing DevelopmentRun and a finite exact read set. No dispatch enable flag. */
export type OwnerAI044ProofPolicy = Readonly<{
  projectId: string; projectTaskId: string; developmentRunId: string;
  planRevision: number; planFingerprint: string;
  repository: Readonly<{ id: string; baseline: string }>; repositoryRoot: string;
  repositoryAllowlist: readonly string[]; readContextPaths: readonly string[];
}>;
export type { OwnerAI044ProofView } from "../../types/ai044-proof";
type Root = ReturnType<typeof createAI044SubscriptionRun>;
export type OwnerAI044ProofRootInput = Readonly<{
  database: WorkflowRuntimeDatabase; tenant: ResolvedWorkflowRuntimeTenant; projectId: string; projectTaskId: string;
  configuration: ExecutorAdapterConfiguration; identitySource: AuthenticatedIdentitySource; repositoryRoot: string;
  readContextPolicy: Readonly<{ planRevision: number; planFingerprint: string; referencePaths: readonly string[] }>;
}>;
export type OwnerAI044ProofDependencies = Readonly<{
  database: WorkflowRuntimeDatabase; domainWorkspaceId: string; identitySource: AuthenticatedIdentitySource;
  policy: OwnerAI044ProofPolicy; clock(): number;
  readSubscriptionFacts(): Promise<ChatGPTSubscriptionFacts | null>;
  preparation(input: OwnerAI044ProofRootInput): Pick<Root, "prepare">;
  execution(input: OwnerAI044ProofRootInput & Readonly<{ controllerBinding: Readonly<{ projectTaskId: string; intentFingerprint: string }> }>): Root;
}>;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(v);
const denied = (): OwnerAI044ProofView => Object.freeze({ status: "unavailable" });
function requireFact(v: unknown): asserts v { if (!v) throw Error("owner_proof_unavailable"); }
/** Strict bounded browser envelope; action metadata is never business authority. */
export function ownerAI044ProofInput(form: unknown): unknown | null {
  try {
    if (!(form instanceof FormData) || Object.getPrototypeOf(form) !== FormData.prototype) return null;
    const fields = ["action", "selection", "registration", "model", "appLimitPercent", "confirmed"], values = new Map<string, string>();
    let count = 0;
    for (const [key, value] of form) {
      if (++count > 32 || key.length > 256) return null;
      if (key.startsWith("$ACTION_")) continue;
      if (!fields.includes(key) || values.has(key) || typeof value !== "string" || value.length > 256) return null;
      values.set(key, value);
    }
    const action = values.get("action"), selection = values.get("selection");
    if (!["prepare", "request", "approve", "reject", "invoke"].includes(action ?? "") || !/^[a-f0-9]{64}$/u.test(selection ?? "")) return null;
    if (action === "prepare") {
      if (values.size !== 6 || !/^[1-9][0-9]?$/u.test(values.get("appLimitPercent") ?? "") || values.get("confirmed") !== "on") return null;
      return { action, selection, attestation: { registration: values.get("registration"), model: values.get("model"),
        appLimitPercent: Number(values.get("appLimitPercent")), confirmed: true } };
    }
    return values.size === 2 ? { action, selection, attestation: null } : null;
  } catch { return null; }
}
export function normalizeOwnerAI044ProofPolicy(raw: unknown): OwnerAI044ProofPolicy {
  const r = exactOwnData(captureAI044Data(raw), ["projectId", "projectTaskId", "developmentRunId", "planRevision", "planFingerprint", "repository", "repositoryRoot", "repositoryAllowlist", "readContextPaths"]);
  requireFact(r && [r.projectId, r.projectTaskId, r.developmentRunId].every(id) && Number.isSafeInteger(r.planRevision) && (r.planRevision as number) > 0
    && typeof r.planFingerprint === "string" && /^[a-f0-9]{64}$/u.test(r.planFingerprint) && normalizeSubscriptionRepository(r.repository)
    && typeof r.repositoryRoot === "string" && r.repositoryRoot.startsWith("/") && ai044SafeText(r.repositoryRoot, 1024));
  for (const [field, max] of [["repositoryAllowlist", 12], ["readContextPaths", 20]] as const) {
    const paths = r[field]; requireFact(Array.isArray(paths) && paths.length > 0 && paths.length <= max && new Set(paths).size === paths.length);
    paths.forEach(ai044SubscriptionContextPath);
  }
  return freezeAI044(r) as unknown as OwnerAI044ProofPolicy;
}

/** Wrap EXISTING transaction owners, not a new transaction/lifecycle. Authenticate
 * inside their BEGIN on the SAME session; the Owner SHARE locks survive to COMMIT.
 * No second pooled connection, provider await, session SET or credentials here. */
function ownerCheckedDatabase(database: WorkflowRuntimeDatabase, tenant: ResolvedWorkflowRuntimeTenant, actor: string,
  policy: OwnerAI044ProofPolicy): WorkflowRuntimeDatabase {
  return Object.freeze({ async connect() {
    const client = await database.connect();
    return Object.freeze({
      async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
        if (/^(?:\/\*[^]*?\*\/\s*)?commit\s*$/iu.test(sql.trim())) {
          await client.query(`/* owner-proof:audit */ insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata)
            select $1,$2,'ai044.owner_preparation','project_task',id,$3::jsonb from project_tasks where workspace_id=$1 and project_key=$4 and task_key=$5`,
          [tenant.workspaceDatabaseId, actor, JSON.stringify({ developmentRunId: policy.developmentRunId, planRevision: policy.planRevision }), policy.projectId, policy.projectTaskId]);
        }
        const result = await client.query<T>(sql, values);
        if (/^(?:\/\*[^]*?\*\/\s*)?begin\s*$/iu.test(sql.trim())) await lockOwnerAuthority(client, tenant, actor);
        return result;
      },
      release(destroy?: boolean) { client.release(destroy); },
    });
  } });
}

/** Request-scoped application boundary. Browser submits only an opaque selection
 * fingerprint + action/attestation, NEVER configuration/intent/context/actor IDs.
 * Every action rebuilds from durable facts. No in-memory cross-request capability. */
export function createOwnerAI044Proof(dependencies: OwnerAI044ProofDependencies) {
  const d = dependencies, p = normalizeOwnerAI044ProofPolicy(d.policy);
  async function authorized() {
    const owner = await resolveSessionOwner(d.database, d.domainWorkspaceId, d.identitySource);
    requireFact(owner.status === "owner");
    const tenant = await createPostgresWorkflowRuntimeTenantResolver(d.database).resolve(d.domainWorkspaceId); requireFact(tenant);
    return { tenant, actor: owner.ownerUserId };
  }
  async function snapshot() {
    const { tenant, actor } = await authorized();
    const state = await inTransaction(d.database, async client => {
      await lockOwnerAuthority(client, tenant, actor);
      const guard = await client.query(`/* owner-proof:guard */ select project_key from roadmap_project_guards where workspace_id=$1 and project_key=$2 for share`, [tenant.workspaceDatabaseId, p.projectId]);
      requireFact(guard.rowCount === 1);
      return readDevelopmentControllerStateInTransaction(client, tenant, p.projectId, p.projectTaskId, true, undefined, undefined, false);
    });
    requireFact(state.approvedPlan && state.approvedPlan.revision === p.planRevision && state.approvedPlan.draftFingerprint === p.planFingerprint);
    const record = state.runs.find(r => r.run.id === p.developmentRunId); requireFact(record);
    const run = record.run, stored = state.attempts.find(a => a.developmentRunId === run.id && a.attemptNumber === run.currentAttemptNumber);
    requireFact(controllerTaskClass(state, run.currentAttemptNumber) === (run.currentAttemptNumber === 1 ? "implementation" : "repair"));
    let configuration: ExecutorAdapterConfiguration;
    if (stored) configuration = captureAI044Data(stored.configuration) as ExecutorAdapterConfiguration;
    else {
      const previous = state.attempts.find(a => a.developmentRunId === run.id);
      const admission = previous ? (previous.configuration as ExecutorAdapterConfiguration).admission : controllerAdmission(state, run.taskId, p.repositoryAllowlist);
      requireFact(admission);
      requireFact(Array.isArray(admission.activeTaskIds));
      configuration = { identity: subscriptionExecutorIdentity, capabilities: { tasks: ["coding"], modes: ["patch_proposal"], artifacts: ["patch", "report"] },
        repository: p.repository, admission: { ...admission, activeTaskIds: admission.activeTaskIds.filter(t => t !== run.taskId) }, developmentRun: run };
    }
    requireFact(configuration.identity.id === "chatgpt-plan-patch" && configuration.identity.version === "v1"
      && ai044Fingerprint(configuration.repository) === ai044Fingerprint(p.repository)
      && ai044Fingerprint(configuration.admission.plan) === ai044Fingerprint(state.approvedPlan.plan));
    if (run.status === "implementing") requireFact(ai044Fingerprint(configuration.developmentRun) === ai044Fingerprint(run));
    const execution = stored ? exactOwnData(stored.executionPolicy, ["profile", "intent"]) : null;
    const intent = execution?.profile === "ai044_subscription" ? normalizeSubscriptionIntent(execution.intent) : null;
    if (stored) requireFact(normalizeAI044SubscriptionContextManifest(stored.context) && intent && intent.projectId === p.projectId && intent.projectTaskId === p.projectTaskId
      && intent.attempt.developmentRunId === run.id && intent.attempt.number === run.currentAttemptNumber
      && ai044Fingerprint(intent.readContextPaths) === ai044Fingerprint(p.readContextPaths));
    const selection = ai044Fingerprint(["pac.owner-proof.selection.v1", tenant.workspaceDatabaseId, actor, p, state.task.version, record, stored?.intentFingerprint ?? null]);
    const input: OwnerAI044ProofRootInput = { database: d.database, tenant, projectId: p.projectId, projectTaskId: p.projectTaskId, configuration,
      identitySource: d.identitySource, repositoryRoot: p.repositoryRoot, readContextPolicy: { planRevision: p.planRevision, planFingerprint: p.planFingerprint, referencePaths: p.readContextPaths } };
    return { tenant, actor, state, record, stored, intent, selection, input };
  }
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  async function facts(s: Snapshot) {
    const f = await d.readSubscriptionFacts();
    requireFact(isChatGPTSubscriptionFacts(f) && f.status === "active" && f.planUsageGranted && f.selectedModel
      && f.ownerUserId === s.actor && f.domainWorkspaceId === s.tenant.workspaceId);
    return f;
  }
  async function ledger(s: Snapshot) {
    if (!s.intent) return null;
    return inTransaction(d.database, async client => {
      await lockOwnerAuthority(client, s.tenant, s.actor);
      const q = await client.query(`/* owner-proof:approval */ select b.approval_request_id::text,b.intent_payload,b.intent_fingerprint,b.state,r.status
        from ai044_subscription_approval_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
        where b.workspace_id=$1 and b.project_key=$2 and b.project_task_key=$3 and b.intent_fingerprint=$4`,
      [s.tenant.workspaceDatabaseId, p.projectId, p.projectTaskId, subscriptionIntentFingerprint(s.intent!)]);
      requireFact(q.rowCount <= 1); if (!q.rowCount) return null;
      const row = q.rows[0], i = typeof row.intent_payload === "string" && row.intent_payload.length < 32768 ? normalizeSubscriptionIntent(JSON.parse(row.intent_payload)) : null;
      requireFact(i && subscriptionIntentFingerprint(i) === subscriptionIntentFingerprint(s.intent!));
      const historical = ["completed", "failed"].includes(row.state as string) ? await readAI044SubscriptionOutcomeInTransaction(client, s.tenant,
        { projectId: p.projectId, projectTaskId: p.projectTaskId, configuration: s.input.configuration, invocation: s.stored!.invocation, intentFingerprint: subscriptionIntentFingerprint(i) }) : null;
      if (["completed", "failed"].includes(row.state as string)) requireFact(historical);
      return { id: row.approval_request_id as string, state: row.state as string, approval: row.status as string, historical };
    });
  }
  async function view(s: Snapshot): Promise<OwnerAI044ProofView> {
    const l = await ledger(s), i = s.intent;
    let phase: Extract<OwnerAI044ProofView, { status: "available" }>["phase"] = i ? "PREPARED" : "NOT_PREPARED";
    if (l) {
      if (l.state === "completed") phase = "COMPLETED";
      else if (l.state === "failed") phase = "FAILED";
      else if (l.state === "started") phase = "INVOCATION_STARTED";
      else if (l.state !== "ready") phase = "RECOVERY_REQUIRED";
      else if (l.approval === "approved") phase = "APPROVED";
      else if (l.approval === "rejected") phase = "REJECTED";
      else if (l.approval === "pending") phase = "AWAITING_OWNER_APPROVAL";
      else phase = "RECOVERY_REQUIRED";
    }
    if (i && !["COMPLETED", "FAILED", "REJECTED", "INVOCATION_STARTED"].includes(phase) && !subscriptionIntentCurrent(i, d.clock())) phase = "RECOVERY_REQUIRED";
    let f: Awaited<ReturnType<typeof facts>> | null = null; try { f = await facts(s); } catch { /* Missing connection never authorizes dispatch. */ }
    const result = l?.historical;
    return freezeAI044({ status: "available", phase, selection: s.selection, projectId: p.projectId, projectTaskId: p.projectTaskId,
      developmentTaskId: s.record.run.taskId, attemptNumber: s.record.run.currentAttemptNumber, planRevision: p.planRevision, baseline: p.repository.baseline,
      model: i?.model ?? f?.selectedModel ?? null, registration: i ? subscriptionRegistrationFingerprint(i.registration) : f ? subscriptionRegistrationFingerprint(f.registration) : null,
      readContextPaths: p.readContextPaths, allowedWritePaths: s.record.run.admittedAllowedPaths, expiresAt: i?.expiresAt ?? null,
      intentFingerprint: i ? subscriptionIntentFingerprint(i) : null, approvalRequestId: l?.id ?? null,
      result: result ? { status: result.normalizedResult.status, changedPaths: result.normalizedResult.changes.map(c => c.path), fingerprint: result.resultFingerprint,
        ownerDecisionRequired: true, verificationStatus: "not_run", automaticRetryAllowed: false } : null,
      runtimeDispatchAllowed: false, productionLiveDispatch: "BLOCKED" });
  }
  async function rebuild(s: Snapshot) {
    requireFact(s.stored && s.intent && s.state.task.status === "running" && s.record.run.status === "implementing" && subscriptionIntentCurrent(s.intent, d.clock()));
    const root = d.execution({ ...s.input, controllerBinding: { projectTaskId: p.projectTaskId, intentFingerprint: s.stored.intentFingerprint } });
    const i = s.intent;
    const prepared = await root.prepare({ invocationId: i.invocationId, planRevision: i.planRevision, planFingerprint: i.planFingerprint,
      contextPaths: i.readContextPaths, preflight: i.preflight, expiresAt: i.expiresAt });
    requireFact("prepared" in prepared && subscriptionIntentFingerprint(prepared.intent) === subscriptionIntentFingerprint(i)
      && ai044Fingerprint(prepared.contextManifest) === ai044Fingerprint(s.stored.context));
    return { root, prepared };
  }
  async function act(raw: unknown): Promise<OwnerAI044ProofView> {
    try {
      const r = exactOwnData(raw, ["action", "selection", "attestation"]); requireFact(r && ["prepare", "request", "approve", "reject", "invoke"].includes(r.action as string));
      const s = await snapshot(); requireFact(r.selection === s.selection);
      if (r.action === "prepare") {
        requireFact(!s.stored && s.state.task.status === "running" && s.record.run.status === "implementing");
        const a = exactOwnData(r.attestation, ["registration", "model", "appLimitPercent", "confirmed"]), f = await facts(s);
        requireFact(a && a.confirmed === true && a.registration === subscriptionRegistrationFingerprint(f.registration) && a.model === f.selectedModel
          && Number.isSafeInteger(a.appLimitPercent) && (a.appLimitPercent as number) >= 1 && (a.appLimitPercent as number) <= 99);
        const now = d.clock(), expiresAt = now + subscriptionReceiptMaximumAgeMs;
        const initial = d.preparation(s.input), prepared = await initial.prepare({ invocationId: controllerInvocationId(s.record.run.id, s.record.run.currentAttemptNumber),
          planRevision: p.planRevision, planFingerprint: p.planFingerprint, contextPaths: p.readContextPaths, expiresAt,
          preflight: { receiptId: `receipt-${randomUUID()}`, observedAt: now, expiresAt, appLimitPercent: a.appLimitPercent,
            creditsEnabled: false, automaticPurchaseReliedUpon: false, registrationFingerprint: a.registration } });
        requireFact("prepared" in prepared);
        const database = ownerCheckedDatabase(d.database, s.tenant, s.actor, p), controller = createDevelopmentControllerStore({ database, tenant: s.tenant });
        const invocation = { schemaVersion: 1, invocationId: prepared.intent.invocationId, identity: subscriptionExecutorIdentity,
          planId: prepared.intent.planId, taskId: prepared.intent.taskId, repository: p.repository, capability: "coding", mode: "patch_proposal", attempt: prepared.intent.attempt };
        const saved = await controller.saveAttemptIntent({ commandId: `proof-${randomUUID()}`.slice(0, 40), projectId: p.projectId, taskId: p.projectTaskId,
          expectedVersion: s.state.task.version, expectedControllerRevision: s.state.revision, developmentRunId: s.record.run.id, expectedRunRevision: s.record.revision,
          configuration: s.input.configuration, invocation, context: prepared.contextManifest,
          route: { decision: prepared.route, taskClass: controllerTaskClass(s.state, s.record.run.currentAttemptNumber) }, executionPolicy: prepared.executionPolicy });
        requireFact(saved.state);
        const stored = saved.state.attempts.find(a => a.developmentRunId === s.record.run.id && a.attemptNumber === s.record.run.currentAttemptNumber); requireFact(stored);
        const authority = createPostgresExecutorCurrentAuthorityStore({ database, tenant: s.tenant, projectId: p.projectId, configuration: s.input.configuration,
          controllerBinding: { projectTaskId: p.projectTaskId, intentFingerprint: stored.intentFingerprint } });
        const registered = s.record.run.currentAttemptNumber === 1 ? await authority.registerCurrentAuthority() : await authority.advanceCurrentAuthority();
        requireFact(registered.verdict === "allow");
      } else {
        requireFact(r.attestation === null);
        const before = await view(s); requireFact(before.status === "available");
        const { root, prepared } = await rebuild(s);
        const commandId = `proof-${randomUUID()}`.slice(0, 40);
        if (r.action === "request") {
          requireFact(before.phase === "PREPARED"); const decision = await root.requestApproval({ prepared: prepared.prepared, commandId }); requireFact(decision.verdict === "allow");
        } else if (r.action === "approve" || r.action === "reject") {
          requireFact(before.phase === "AWAITING_OWNER_APPROVAL");
          const decision = await root.decideApproval({ commandId, approvalRequestId: before.approvalRequestId, intentFingerprint: before.intentFingerprint,
            decision: r.action === "approve" ? "approved" : "rejected" }); requireFact(decision.verdict === "allow");
        } else {
          requireFact(before.phase === "APPROVED");
          // Exact one-shot existing consume/fence; NEVER retry, even when ACK is lost.
          await root.invoke({ prepared: prepared.prepared, approvalRequestId: before.approvalRequestId });
        }
      }
      return await view(await snapshot());
    } catch { return denied(); }
  }
  return Object.freeze({ async load(): Promise<OwnerAI044ProofView> { try { return await view(await snapshot()); } catch { return denied(); } }, act });
}
