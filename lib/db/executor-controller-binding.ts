import { isDeepStrictEqual } from "node:util";
import type { WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
import type { ExecutorAuthorityFacts } from "../executors/executor-current-authority";
import type { NormalizedExecutorInvocation } from "../contracts/executor-adapter";
import type { ExecutorTarget } from "../executors/executor-start-boundary";
import type { ExecutorProviderRequestPolicy } from "../executors/executor-provider-request";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData } from "./executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { roadmapFingerprint, captureRoadmapData, isRoadmapFingerprint } from "../roadmap/roadmap-contract.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateAndNormalizeDevelopmentExecutionRun } from "../contracts/development-execution.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { prepareExecutorProviderRequest } from "../executors/executor-provider-request.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { lockExecutorAuthority } from "./executor-current-authority-store.ts";

/** Internal root-owned binding. It proves correspondence, never grants dispatch. */
export type ExecutorControllerBinding = Readonly<{ projectTaskId: string; intentFingerprint: string }>;
export type ExecutorControllerExecutionPolicy = Readonly<{ target: ExecutorTarget; financialPolicy: Readonly<{
  maximumExposureUsdMicros: number; totalExposureUsdMicros: number; reservationTtlMs: number }>; requestPolicyIdentity: string }>;
type ActiveExecution = Readonly<{ target: ExecutorTarget; financialPolicy: ExecutorControllerExecutionPolicy["financialPolicy"];
  requestPolicy: ExecutorProviderRequestPolicy; invocation: NormalizedExecutorInvocation }>;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(v);
function fact(value: unknown): asserts value { if (!value) throw Error("invalid_executor_controller_binding"); }
export function normalizeExecutorControllerBinding(raw: unknown): ExecutorControllerBinding {
  const r = exactOwnData(raw, ["projectTaskId", "intentFingerprint"]);
  if (!r || !id(r.projectTaskId) || !isRoadmapFingerprint(r.intentFingerprint)) throw Error("invalid_executor_controller_binding");
  return Object.freeze({ projectTaskId: r.projectTaskId, intentFingerprint: r.intentFingerprint });
}
/** Pure parity evidence from the accepted provider-neutral canonical request seam.
 * It contains hashes/configuration only, not provider request bytes or a start grant. */
export function executorControllerExecutionPolicy(configuration: unknown, invocation: unknown, context: unknown,
  requestPolicy: ExecutorProviderRequestPolicy, target: ExecutorTarget, financialPolicy: ExecutorControllerExecutionPolicy["financialPolicy"],
  workspaceIdentity: string): ExecutorControllerExecutionPolicy | null {
  try {
    const i = createExecutorAdapterContract(configuration).adapter?.validateInvocation(invocation).normalizedInvocation;
    if (!i) return null;
    const r = prepareExecutorProviderRequest(requestPolicy, i, context, target, financialPolicy.maximumExposureUsdMicros, workspaceIdentity);
    if (!r) return null;
    return captureRoadmapData({ target, financialPolicy, requestPolicyIdentity: roadmapFingerprint(["pac.executor.request-policy.v1",
      { providerId: r.providerId, baseRequestFingerprint: r.baseRequestFingerprint }]) }) as ExecutorControllerExecutionPolicy;
  } catch { return null; }
}

/** Active operations only; call AFTER workspace/project SHARE, BEFORE authority UPDATE.
 * All factories, including unbound legacy ones, take the guard before mapping discovery.
 * Mapping enrollment uses this same guard and rejects preexisting executor rights. Thus a
 * legacy no-mapping read cannot race a later enrollment and silently evade the binding.
 * No locks survive the short transaction; no start right is manufactured here. */
export async function lockExecutorControllerBinding(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant,
  projectId: string, facts: ExecutorAuthorityFacts, configuration: unknown, binding: ExecutorControllerBinding | null, execution?: ActiveExecution): Promise<boolean> {
  const workspace = tenant.workspaceDatabaseId;
  await client.query(`/* executor:controller-guard-init */ insert into roadmap_project_guards(workspace_id,project_key) values($1,$2) on conflict do nothing`, [workspace, projectId]);
  const g = await client.query(`/* executor:controller-guard */ select project_key from roadmap_project_guards where workspace_id=$1 and project_key=$2 for update`, [workspace, projectId]);
  fact(g.rowCount === 1 && g.rows.length === 1 && g.rows[0].project_key === projectId);
  const m = await client.query(`/* executor:controller-mapping */ select project_key,project_task_key from controller_development_runs
    where workspace_id=$1 and development_run_id=$2`, [workspace, facts.developmentRunId]);
  fact(m.rowCount <= 1 && m.rows.length === m.rowCount);
  if (!m.rowCount) return binding === null;
  if (!binding || m.rows[0].project_key !== projectId || m.rows[0].project_task_key !== binding.projectTaskId) return false;
  const t = await client.query(`/* executor:controller-task */ select status,state_version from project_tasks
    where workspace_id=$1 and project_key=$2 and task_key=$3 for share`, [workspace, projectId, binding.projectTaskId]);
  if (t.rowCount !== 1 || t.rows.length !== 1 || t.rows[0].status !== "running") return false;
  const p = await client.query(`/* executor:controller-plan */ select plan_approval_request_id::text,plan_key,plan_revision,draft_fingerprint,approved_fingerprint,plan_json
    from controller_project_tasks where workspace_id=$1 and project_key=$2 and task_key=$3 for share`, [workspace, projectId, binding.projectTaskId]);
  if (p.rowCount !== 1 || p.rows.length !== 1) return false;
  const r = await client.query(`/* executor:controller-run */ select project_key,project_task_key,plan_key,plan_revision,draft_fingerprint,approved_fingerprint,
    run_revision,run_snapshot,run_fingerprint from controller_development_runs where workspace_id=$1 and development_run_id=$2 for share`, [workspace, facts.developmentRunId]);
  if (r.rowCount !== 1 || r.rows.length !== 1) return false;
  const a = await client.query(`/* executor:controller-intent */ select project_task_state_version,run_revision,configuration_json,configuration_fingerprint,
    invocation_json,invocation_fingerprint,context_json,context_fingerprint,route_json,route_fingerprint,execution_policy_json,execution_policy_fingerprint,intent_fingerprint
    from controller_attempt_intents where workspace_id=$1 and development_run_id=$2 and attempt_number=$3 for share`, [workspace, facts.developmentRunId, facts.attemptNumber]);
  if (a.rowCount !== 1 || a.rows.length !== 1) return false;
  const run = r.rows[0], intent = a.rows[0], plan = p.rows[0];
  const normalized = validateAndNormalizeDevelopmentExecutionRun(captureRoadmapData(run.run_snapshot));
  fact(normalized.ok); const snapshot = normalized.value;
  fact(isDeepStrictEqual(captureRoadmapData(run.run_snapshot), captureRoadmapData(snapshot))
    && run.run_fingerprint === roadmapFingerprint(["pac.controller-development-run.v1", snapshot]));
  if (snapshot.id !== facts.developmentRunId || snapshot.planId !== facts.planId || snapshot.taskId !== (configuration as { admission: { taskId: string } }).admission.taskId
    || snapshot.status !== "implementing" || snapshot.currentAttemptNumber !== facts.attemptNumber || run.run_revision !== intent.run_revision
    || run.project_key !== projectId || run.project_task_key !== binding.projectTaskId
    || run.plan_key !== plan.plan_key || run.plan_revision !== plan.plan_revision || run.draft_fingerprint !== plan.draft_fingerprint
    || run.approved_fingerprint !== plan.approved_fingerprint || plan.plan_key !== facts.planId
    || !Number.isSafeInteger(t.rows[0].state_version) || !Number.isSafeInteger(intent.project_task_state_version)
    || (t.rows[0].state_version as number) < (intent.project_task_state_version as number)) return false;
  fact(intent.configuration_fingerprint === roadmapFingerprint(intent.configuration_json)
    && intent.invocation_fingerprint === roadmapFingerprint(intent.invocation_json)
    && intent.context_fingerprint === roadmapFingerprint(intent.context_json)
    && intent.route_fingerprint === roadmapFingerprint(intent.route_json)
    && intent.execution_policy_fingerprint === roadmapFingerprint(intent.execution_policy_json));
  if (intent.configuration_fingerprint !== roadmapFingerprint(configuration)
    || !isDeepStrictEqual(captureRoadmapData((configuration as { developmentRun: unknown }).developmentRun), captureRoadmapData(snapshot))
    || !isDeepStrictEqual(captureRoadmapData((configuration as { admission: { plan: unknown } }).admission.plan), captureRoadmapData(plan.plan_json))) return false;
  const route = (captureRoadmapData(intent.route_json) as { decision: { verdict: unknown; routeFingerprint: unknown; selectedRoute: { executor: unknown; providerId: unknown } | null; dispatchAuthorized: unknown; runtimeDispatchAllowed: unknown } }).decision;
  if (route.verdict !== "allow" || !route.selectedRoute || !isRoadmapFingerprint(route.routeFingerprint)
    || route.dispatchAuthorized !== false || route.runtimeDispatchAllowed !== false
    || (execution !== undefined && execution.target.providerId !== route.selectedRoute.providerId)
    || !isDeepStrictEqual(captureRoadmapData(route.selectedRoute.executor), captureRoadmapData((configuration as { identity: unknown }).identity))) return false;
  const fingerprint = roadmapFingerprint(["pac.controller-attempt-intent.v1", { projectTaskId: binding.projectTaskId, developmentRunId: facts.developmentRunId,
    attemptNumber: facts.attemptNumber, projectTaskStateVersion: intent.project_task_state_version, runRevision: intent.run_revision,
    configuration: intent.configuration_json, invocation: intent.invocation_json, context: intent.context_json, route: intent.route_json, executionPolicy: intent.execution_policy_json }]);
  if (fingerprint !== intent.intent_fingerprint || fingerprint !== binding.intentFingerprint) return false;
  if (execution) {
    const invocation = createExecutorAdapterContract(configuration).adapter?.validateInvocation(intent.invocation_json).normalizedInvocation;
    if (!invocation || !isDeepStrictEqual(captureRoadmapData(invocation), captureRoadmapData(execution.invocation))) return false;
    const actual = executorControllerExecutionPolicy(configuration, intent.invocation_json, intent.context_json, execution.requestPolicy,
      execution.target, execution.financialPolicy, workspace);
    if (!actual || roadmapFingerprint(actual) !== intent.execution_policy_fingerprint) return false;
  }
  const approval = await client.query(`/* executor:controller-approval */ select b.approval_request_id from roadmap_approval_bindings b
    join approval_requests q on q.workspace_id=b.workspace_id and q.id=b.approval_request_id
    join approval_decisions d on d.workspace_id=q.workspace_id and d.approval_request_id=q.id
    join project_task_feature_plans f on f.workspace_id=b.workspace_id and f.project_key=b.project_key and f.task_key=b.task_key and f.plan_key=b.plan_key and f.revision=b.plan_revision
    where b.workspace_id=$1 and b.project_key=$2 and b.task_key=$3 and b.approval_request_id=$4 and b.purpose='feature_plan_approval'
      and b.plan_key=$5 and b.plan_revision=$6 and b.draft_fingerprint=$7 and b.execution_fingerprint=$8
      and q.status='approved' and d.decision='approved' and q.approved_by::text=d.decided_by_actor_id and q.resolved_at is not null
      and f.plan_fingerprint=$7 and not exists(select 1 from project_task_feature_plans newer where newer.workspace_id=f.workspace_id
        and newer.project_key=f.project_key and newer.task_key=f.task_key and newer.revision>f.revision)`,
  [workspace, projectId, binding.projectTaskId, plan.plan_approval_request_id, plan.plan_key, plan.plan_revision, plan.draft_fingerprint, plan.approved_fingerprint]);
  return approval.rowCount === 1 && approval.rows.length === 1;
}

/** Caller already owns project guard + task UPDATE. Existing authority lifecycle/journal
 * only: this is cancellation fencing, never a parallel authority or settlement model. */
export async function revokeControllerExecutorAuthorities(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant,
  projectId: string, projectTaskId: string): Promise<void> {
  const values = [tenant.workspaceDatabaseId, projectId, projectTaskId];
  const rows = await client.query(`/* executor:controller-revoke-lock */ select a.development_run_id,a.authority_generation,a.authority_status
    from executor_run_authorities a join controller_development_runs r on r.workspace_id=a.workspace_id and r.development_run_id=a.development_run_id
    where r.workspace_id=$1 and r.project_key=$2 and r.project_task_key=$3 order by a.development_run_id for update of a`, values);
  for (const row of rows.rows) {
    fact(id(row.development_run_id) && Number.isSafeInteger(row.authority_generation) && ["active", "revoked"].includes(row.authority_status as string));
    const current = await lockExecutorAuthority(client, tenant.workspaceDatabaseId, row.development_run_id);
    fact(current && current.projectId === projectId && current.generation === row.authority_generation && current.status === row.authority_status);
    if (row.authority_status === "revoked") continue;
    fact((row.authority_generation as number) < 1000000);
    const u = await client.query(`/* executor:controller-revoke */ update executor_run_authorities set authority_generation=authority_generation+1,
      authority_status='revoked',revoked_at=statement_timestamp(),updated_at=statement_timestamp()
      where workspace_id=$1 and development_run_id=$2 and authority_status='active' and authority_generation=$3`, [values[0], row.development_run_id, row.authority_generation]);
    fact(u.rowCount === 1);
    const j = await client.query(`/* executor:controller-revoke-journal */ insert into executor_authority_events
      (workspace_id,development_run_id,authority_generation,authority_status,project_key,plan_id,task_id,current_attempt_number,current_attempt_kind,
       canonical_run_fingerprint,admission_fingerprint,admission_scope_fingerprint,operation,created_at)
      select workspace_id,development_run_id,authority_generation,authority_status,project_key,plan_id,task_id,current_attempt_number,current_attempt_kind,
        canonical_run_fingerprint,admission_fingerprint,admission_scope_fingerprint,'revoke',updated_at
      from executor_run_authorities where workspace_id=$1 and development_run_id=$2`, [values[0], row.development_run_id]);
    fact(j.rowCount === 1);
  }
}
