import { randomUUID } from "node:crypto";
import type { WorkflowRuntimeSqlClient } from "./workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "./workflow-runtime-tenant";
import type { DevelopmentControllerState } from "./development-controller-store";
import type { RoadmapApprovalPurpose } from "../roadmap/roadmap-contract";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureRoadmapConfig, roadmapCommand, lockRoadmapProject } from "./roadmap-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { readDevelopmentControllerStateInTransaction, controllerResultAcceptanceFingerprint } from "./development-controller-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { roadmapFingerprint, isRoadmapFingerprint } from "../roadmap/roadmap-contract.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { capturedMethod, resolveUserId, lockOwnerAuthority, Conflict } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executeRoadmapOwnerCommand, replayRoadmapOwnerCommand, recordRoadmapOwnerCommand } from "../roadmap/roadmap-owner-commands.ts";

type Purpose = Exclude<RoadmapApprovalPurpose, "feature_plan_approval">;
export type ControllerOwnerGateResult = Readonly<{ status: "applied" | "replayed"; approvalRequestId: string; bindingFingerprint: string; purpose: Purpose }>
  | Readonly<{ status: "invalid_input" | "unauthenticated" | "conflict" | "unavailable" | "recovery_required" }>;
const status = <S extends string>(s: S) => Object.freeze({ status: s });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const purposes: readonly Purpose[] = ["scope_change", "budget_or_risk_increase", "architecture_change", "result_acceptance"];

function gateFingerprint(state: DevelopmentControllerState, purpose: Purpose) {
  return purpose === "result_acceptance" ? controllerResultAcceptanceFingerprint(state)
    : roadmapFingerprint(["pac.controller-owner-state.v1", purpose, controllerResultAcceptanceFingerprint(state)]);
}
function gatePermitted(state: DevelopmentControllerState, purpose: Purpose): boolean {
  if (state.task.status !== "waiting_owner" || !state.approvedPlan || state.runs.some(r => r.run.status === "blocked" || r.run.status === "cancelled")) return false;
  if (purpose === "result_acceptance") return state.runs.length === state.approvedPlan.plan.tasks.length && state.runs.every(r => r.run.status === "completed"
    && ["quality", "security"].every(kind => state.operations.some(o => o.developmentRunId === r.run.id && o.attemptNumber === r.run.currentAttemptNumber && o.kind === kind && o.status === "recorded" && (o.evidence as { outcome?: string })?.outcome === "pass")));
  if (purpose === "scope_change") return state.runs.some(r => r.run.status === "awaiting_owner_decision" && r.run.failures.some(f => f.attemptNumber === r.run.currentAttemptNumber && f.scopeExpansionRequired && !f.systemForbiddenPathViolation && !f.protectedPathViolation));
  // Risk/architecture requests are representable, but B3 has no autonomous producer
  // of new configuration authority. A future factual change binding is required.
  return false;
}
function binding(tenant: ResolvedWorkflowRuntimeTenant, state: DevelopmentControllerState, purpose: Purpose) {
  const stateFingerprint = gateFingerprint(state, purpose);
  const bindingFingerprint = roadmapFingerprint(["pac.controller-owner-binding.v1", { workspaceId: tenant.workspaceId, projectId: state.task.projectId,
    taskId: state.task.taskId, purpose, taskVersion: state.task.version, stateFingerprint }]);
  return { stateFingerprint, bindingFingerprint };
}
/** Caller holds project guard/task lock. Only exact current factual gates are returned. */
export async function readControllerOwnerGate(client: WorkflowRuntimeSqlClient, tenant: ResolvedWorkflowRuntimeTenant, state: DevelopmentControllerState, purpose: Purpose) {
  if (!gatePermitted(state, purpose)) return null;
  const expected = binding(tenant, state, purpose);
  const q = await client.query(`select b.approval_request_id::text,b.binding_fingerprint,r.status,d.decision,d.decided_by_actor_id,r.approved_by::text,r.rejected_by::text,r.resolved_at
    from controller_owner_gate_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
    left join approval_decisions d on d.workspace_id=r.workspace_id and d.approval_request_id=r.id
    where b.workspace_id=$1 and b.project_key=$2 and b.task_key=$3 and b.purpose=$4 and b.expected_task_version=$5 and b.state_fingerprint=$6
      and b.binding_fingerprint=$7 and r.action_type=$8`, [tenant.workspaceDatabaseId, state.task.projectId, state.task.taskId, purpose, state.task.version, expected.stateFingerprint, expected.bindingFingerprint, `development_${purpose}`]);
  if (q.rowCount !== 1) return null;
  const r = q.rows[0];
  if (r.status !== "pending" && (r.decision !== r.status || !r.resolved_at || (r.status === "approved" ? r.approved_by !== r.decided_by_actor_id || r.rejected_by !== null : r.status === "rejected" ? r.rejected_by !== r.decided_by_actor_id || r.approved_by !== null : true))) return null;
  return Object.freeze({ approvalRequestId: r.approval_request_id as string, bindingFingerprint: expected.bindingFingerprint, status: r.status as "pending" | "approved" | "rejected", purpose });
}

/** Requests reuse the ONE approval_requests queue. There is deliberately no decide here. */
export function createControllerOwnerGateRequests(raw: unknown) {
  const { database, tenant } = captureRoadmapConfig(raw);
  async function request(input: unknown): Promise<ControllerOwnerGateResult> {
    const c = roadmapCommand(input, ["expectedControllerRevision", "purpose"]);
    if (!c || !purposes.includes(c.purpose as Purpose) || !Number.isSafeInteger(c.expectedControllerRevision) || (c.expectedControllerRevision as number) < 0) return status("invalid_input");
    const intent = roadmapFingerprint(["pac.controller-owner-request.v1", c]);
    return await executeRoadmapOwnerCommand(database, tenant, c.commandId, intent, async client => {
      await lockRoadmapProject(client, tenant, c.projectId);
      const replay = await replayRoadmapOwnerCommand(client, tenant, c.commandId, intent); if (replay) return replay;
      const state = await readDevelopmentControllerStateInTransaction(client, tenant, c.projectId, c.taskId), purpose = c.purpose as Purpose;
      if (state.task.version !== c.expectedVersion || state.revision !== c.expectedControllerRevision || !gatePermitted(state, purpose)) throw new Conflict();
      const old = await readControllerOwnerGate(client, tenant, state, purpose), b = binding(tenant, state, purpose), approvalRequestId = old?.approvalRequestId ?? randomUUID();
      if (!old) {
        await client.query(`insert into approval_requests(id,workspace_id,action_type,status,risk_level,allowed_approver_role_codes,original_payload)
          values($1,$2,$3,'pending',$4,array['owner'],$5::jsonb)`, [approvalRequestId, tenant.workspaceDatabaseId, `development_${purpose}`, state.task.risk ?? "high", JSON.stringify({ projectId: c.projectId, taskId: c.taskId, bindingFingerprint: b.bindingFingerprint })]);
        await client.query(`insert into controller_owner_gate_bindings(workspace_id,project_key,task_key,approval_request_id,purpose,expected_task_version,state_fingerprint,binding_fingerprint)
          values($1,$2,$3,$4,$5,$6,$7,$8)`, [tenant.workspaceDatabaseId, c.projectId, c.taskId, approvalRequestId, purpose, c.expectedVersion, b.stateFingerprint, b.bindingFingerprint]);
        await client.query(`insert into audit_events(workspace_id,event_type,entity_type,entity_id,metadata) values($1,'controller.approval_requested','approval_request',$2,$3::jsonb)`, [tenant.workspaceDatabaseId, approvalRequestId, JSON.stringify({ projectId: c.projectId, taskId: c.taskId, purpose })]);
      }
      const result = Object.freeze({ status: "applied", approvalRequestId, bindingFingerprint: b.bindingFingerprint, purpose });
      await recordRoadmapOwnerCommand(client, tenant, c.commandId, intent, result); return result;
    }) as ControllerOwnerGateResult;
  }
  return Object.freeze({ request });
}

/** Authenticated Owner decision. No start, roadmap-change or code-acceptance side effects. */
export function createControllerOwnerGateDecisions(raw: unknown) {
  const { database, tenant, fields } = captureRoadmapConfig(raw, ["identitySource"]), resolve = capturedMethod(fields.identitySource, "resolve");
  if (!resolve) throw Error("invalid_controller_owner_identity_source");
  async function decide(input: unknown): Promise<ControllerOwnerGateResult> {
    const c = roadmapCommand(input, ["approvalRequestId", "bindingFingerprint", "decision"]);
    if (!c || typeof c.approvalRequestId !== "string" || !uuid.test(c.approvalRequestId) || !isRoadmapFingerprint(c.bindingFingerprint) || !["approved", "rejected"].includes(c.decision as string)) return status("invalid_input");
    const user = await resolveUserId(resolve!); if (!user) return status("unauthenticated");
    const intent = roadmapFingerprint(["pac.controller-owner-decision.v1", c]);
    return await executeRoadmapOwnerCommand(database, tenant, c.commandId, intent, async client => {
      await lockOwnerAuthority(client, tenant, user); await lockRoadmapProject(client, tenant, c.projectId);
      const replay = await replayRoadmapOwnerCommand(client, tenant, c.commandId, intent); if (replay) return replay;
      const state = await readDevelopmentControllerStateInTransaction(client, tenant, c.projectId, c.taskId);
      if (state.task.version !== c.expectedVersion) throw new Conflict();
      const row = await client.query(`select purpose from controller_owner_gate_bindings where workspace_id=$1 and project_key=$2 and task_key=$3 and approval_request_id=$4`, [tenant.workspaceDatabaseId, c.projectId, c.taskId, c.approvalRequestId]);
      if (row.rowCount !== 1 || !purposes.includes(row.rows[0].purpose as Purpose)) throw new Conflict();
      const purpose = row.rows[0].purpose as Purpose, gate = await readControllerOwnerGate(client, tenant, state, purpose);
      if (!gate || gate.status !== "pending" || gate.approvalRequestId !== c.approvalRequestId || gate.bindingFingerprint !== c.bindingFingerprint) throw new Conflict();
      await client.query(`select id from approval_requests where workspace_id=$1 and id=$2 for update`, [tenant.workspaceDatabaseId, c.approvalRequestId]);
      await client.query(`insert into approval_decisions(workspace_id,approval_request_id,decision,decided_by_actor_id,command_id) values($1,$2,$3,$4,$5)`, [tenant.workspaceDatabaseId, c.approvalRequestId, c.decision, user, c.commandId]);
      await client.query(`update approval_requests set status=$3,resolved_at=clock_timestamp(),approved_by=case when $3='approved' then $4::uuid else null end,rejected_by=case when $3='rejected' then $4::uuid else null end where workspace_id=$1 and id=$2`, [tenant.workspaceDatabaseId, c.approvalRequestId, c.decision, user]);
      await client.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,'controller.approval_decided','approval_request',$3,$4::jsonb)`, [tenant.workspaceDatabaseId, user, c.approvalRequestId, JSON.stringify({ projectId: c.projectId, taskId: c.taskId, decision: c.decision, purpose })]);
      const result = Object.freeze({ status: "applied", approvalRequestId: gate.approvalRequestId, bindingFingerprint: gate.bindingFingerprint, purpose });
      await recordRoadmapOwnerCommand(client, tenant, c.commandId, intent, result); return result;
    }, client => lockOwnerAuthority(client, tenant, user)) as ControllerOwnerGateResult;
  }
  return Object.freeze({ decide });
}
