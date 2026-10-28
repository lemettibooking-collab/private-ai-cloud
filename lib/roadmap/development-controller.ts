import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
import type { DevelopmentControllerState, DevelopmentControllerDecision } from "../db/development-controller-store";
import type { ExecutorAdapterConfiguration, ExecutorInvocationInput } from "../contracts/executor-adapter";
import type { ExecutorRouteDecision } from "../executors/executor-router";
import type { ControllerRepository, ControllerNextAction } from "./development-controller-policy";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createDevelopmentControllerStore } from "../db/development-controller-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureRoadmapConfig, roadmapCommand, lockRoadmapProject } from "../db/roadmap-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createRoadmapApprovalRequests, readLatestRoadmapPlan } from "../db/roadmap-approvals.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, capturedMethod, inTransaction } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureRoadmapData, roadmapFingerprint } from "./roadmap-contract.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { planDevelopmentControllerStep, controllerAdmission, controllerDevelopmentRunId, controllerInvocationId, controllerIntent, controllerTaskClass } from "./development-controller-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorRouter } from "../executors/executor-router.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { developmentQualityEvent, developmentSecurityEvent } from "./development-gates.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateDevelopmentTaskAdmission } from "../contracts/development-task-policy.ts";
import type { DevelopmentQualityEvidence, DevelopmentSecurityEvidence } from "./development-gates";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateCorrectiveGate } from "./development-gates.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createControllerOwnerGateRequests, readControllerOwnerGate } from "../db/development-controller-approvals.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { readDevelopmentControllerStateInTransaction } from "../db/development-controller-store.ts";

/** These ports are server-internal trusted composition, never invocation input or UI.
 * B3 has only blocked production composition and explicitly internal fake test ports. */
export type ControllerExecutorObservation = Readonly<{ status: "settled" | "known_identity" | "unknown" | "not_started"; normalizedResult: unknown; resultFingerprint: string | null }>;
export type DevelopmentControllerResult = Readonly<{ status: DevelopmentControllerDecision["status"] | "waiting_owner" | "live_unavailable" | "none";
  action: ControllerNextAction; state: DevelopmentControllerState | null; runtimeDispatchAllowed: false }>;
const result = (status: DevelopmentControllerResult["status"], action: ControllerNextAction, state: DevelopmentControllerState | null): DevelopmentControllerResult => Object.freeze({ status, action, state, runtimeDispatchAllowed: false });

/** One bounded transition/intent. No timers, singleton loop, automatic retry or lease. */
export function createDevelopmentController(raw: unknown) {
  const { database, tenant, fields } = captureRoadmapConfig(raw, ["repository", "routingSource", "contextSource", "executorPort", "qualityPort", "securityPort"]);
  const readRouting = capturedMethod(fields.routingSource, "read"), prepareContext = capturedMethod(fields.contextSource, "prepare");
  const prepare = capturedMethod(fields.executorPort, "prepare"), start = capturedMethod(fields.executorPort, "start"), observe = capturedMethod(fields.executorPort, "observe"), reconcile = capturedMethod(fields.executorPort, "reconcile");
  const quality = capturedMethod(fields.qualityPort, "run"), security = capturedMethod(fields.securityPort, "run");
  const mode = exactOwnData(fields.executorPort, ["mode", "prepare", "start", "observe", "reconcile"]);
  if (!readRouting || !prepareContext || !prepare || !start || !observe || !reconcile || !quality || !security || !mode || !["internal_fake", "blocked"].includes(mode.mode as string)) throw Error("invalid_development_controller_configuration");
  const executionMode = mode.mode;
  const repository = captureRoadmapData(fields.repository) as ControllerRepository;
  if (!repository || !exactOwnData(repository, ["repository", "allowedPaths"]) || !Array.isArray(repository.allowedPaths) || repository.allowedPaths.length < 1 || repository.allowedPaths.length > 64) throw Error("invalid_development_controller_configuration");
  const store = createDevelopmentControllerStore({ database, tenant });
  const approvals = createRoadmapApprovalRequests({ database, tenant });
  const ownerGates = createControllerOwnerGateRequests({ database, tenant });
  const call = (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Reflect.apply(fn, undefined, args);
  async function route(state: DevelopmentControllerState, runId: string) {
    const run = state.runs.find(r => r.run.id === runId)?.run;
    if (!run) return null;
    const admission = controllerAdmission(state, run.taskId, repository.allowedPaths);
    if (!admission) return null;
    const dynamicAdmission = { ...admission, activeTaskIds: (admission.activeTaskIds as string[]).filter(id => id !== run.taskId) };
    if (evaluateDevelopmentTaskAdmission(dynamicAdmission).verdict !== "allow") return null;
    // The active current task must not conflict with itself in Admission. Preserve the
    // original admission set throughout corrective attempts (scope fingerprint).
    const previous = state.attempts.find(i => i.developmentRunId === runId);
    const currentAdmission = previous ? (previous.configuration as ExecutorAdapterConfiguration).admission : dynamicAdmission;
    const source = exactOwnData(captureRoadmapData(await call(readRouting!, { projectId: state.task.projectId, taskId: state.task.taskId })), ["candidates", "policy"]);
    if (!source) return null;
    const router = createExecutorRouter(source.candidates).router; if (!router) return null;
    const taskClass = controllerTaskClass(state, run.currentAttemptNumber);
    // Corrective taskClass is repair, not a grant to turn a report-only task into
    // repository mutation. Preserve the initial execution mode/capability.
    const analysis = previous ? (previous.invocation as ExecutorInvocationInput).mode === "analysis_only" : taskClass === "analysis";
    const decision: ExecutorRouteDecision = router.select({ admission: currentAdmission, developmentRun: run, repository: repository.repository,
      capability: analysis ? "repository_analysis" : "coding", mode: analysis ? "analysis_only" : "patch_proposal", taskClass, policy: source.policy });
    if (decision.verdict !== "allow" || !decision.selectedRoute) return null;
    const selectedCandidate = (source.candidates as Array<{ routeId: string; capabilities: ExecutorAdapterConfiguration["capabilities"]["tasks"]; modes: ExecutorAdapterConfiguration["capabilities"]["modes"]; artifacts: ExecutorAdapterConfiguration["capabilities"]["artifacts"] }>).find(c => c.routeId === decision.selectedRoute!.routeId);
    if (!selectedCandidate) return null;
    const configuration: ExecutorAdapterConfiguration = { identity: decision.selectedRoute.executor,
      capabilities: { tasks: selectedCandidate.capabilities, modes: selectedCandidate.modes, artifacts: selectedCandidate.artifacts },
      repository: repository.repository, admission: currentAdmission, developmentRun: run };
    const invocation: ExecutorInvocationInput = { schemaVersion: 1, invocationId: controllerInvocationId(run.id, run.currentAttemptNumber), identity: configuration.identity,
      planId: run.planId, taskId: run.taskId, repository: repository.repository, capability: analysis ? "repository_analysis" : "coding", mode: analysis ? "analysis_only" : "patch_proposal",
      attempt: { developmentRunId: run.id, number: run.currentAttemptNumber, kind: run.currentAttemptNumber === 1 ? "initial" : "corrective" } };
    return { configuration, invocation, route: { decision, taskClass } };
  }
  async function planning(command: ReturnType<typeof roadmapCommand> & object, state: DevelopmentControllerState): Promise<DevelopmentControllerResult> {
    if (state.task.status === "planning") {
      const d = await store.changeTaskState({ ...command, nextStatus: "waiting_owner" }); return result(d.status, "require_plan_approval", d.state);
    }
    const facts = await inTransaction(database as WorkflowRuntimeDatabase, async c => {
      const plan = await readLatestRoadmapPlan(c, tenant, state.task.projectId, state.task.taskId);
      const requests = await c.query(`select b.approval_request_id::text,r.status from roadmap_approval_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
        where b.workspace_id=$1 and b.project_key=$2 and b.task_key=$3 and b.expected_task_version=$4 and b.purpose='feature_plan_approval' order by b.approval_request_id`, [tenant.workspaceDatabaseId, state.task.projectId, state.task.taskId, state.task.version]);
      return { plan, requests: requests.rows };
    });
    if (!facts.plan) return result("waiting_owner", "require_plan_approval", state);
    const approved = facts.requests.find(r => r.status === "approved");
    if (approved) { const d = await store.consumePlanApproval({ ...command, approvalRequestId: approved.approval_request_id }); return result(d.status, "consume_plan_approval", d.state); }
    if (facts.requests.some(r => r.status === "rejected")) { const d = await store.changeTaskState({ ...command, nextStatus: "blocked" }); return result(d.status, "hard_stop", d.state); }
    if (facts.requests.some(r => r.status === "pending")) return result("waiting_owner", "require_plan_approval", state);
    const d = await approvals.requestPlanApproval(command);
    return result(d.status === "unauthenticated" ? "unavailable" : d.status, "require_plan_approval", "approvalRequestId" in d ? state : null);
  }
  async function replayApprovalTick(command: NonNullable<ReturnType<typeof roadmapCommand>>): Promise<DevelopmentControllerResult | null> {
    // Approval request and its command evidence commit together in the existing
    // Owner-command journal. Read it before deciding a new action on a replay.
    const q = await inTransaction(database, client => client.query(`select intent_fingerprint from roadmap_owner_commands where workspace_id=$1 and command_id=$2`, [tenant.workspaceDatabaseId, command.commandId]));
    if (!q.rowCount) return null;
    let action: ControllerNextAction | null = null;
    if (q.rows[0].intent_fingerprint === roadmapFingerprint(["roadmap.plan-approval-request.v1", command])) action = "require_plan_approval";
    for (const purpose of ["scope_change", "result_acceptance"] as const) if (q.rows[0].intent_fingerprint === roadmapFingerprint(["pac.controller-owner-request.v1", { ...command, purpose }])) action = purpose === "scope_change" ? "require_owner_decision" : "require_result_acceptance";
    if (!action) return result("conflict", "none", null);
    // The first connection is already released. No nested transaction/second pooled
    // connection is acquired while a session is owned. History is immutable.
    const state = await store.readRevision(command.projectId, command.taskId, command.expectedControllerRevision as number);
    if (!state || state.task.version !== command.expectedVersion) return result("recovery_required", "recovery_required", null);
    return result("replayed", action, state);
  }
  async function advanceController(input: unknown): Promise<DevelopmentControllerResult> {
    const command = roadmapCommand(input, ["expectedControllerRevision"]);
    if (!command || !Number.isSafeInteger(command.expectedControllerRevision) || (command.expectedControllerRevision as number) < 0) return result("invalid_input", "none", null);
    try {
      const replay = await store.replay(command); if (replay) return result(replay.status, "none", replay.state);
      const requestReplay = await replayApprovalTick(command); if (requestReplay) return requestReplay;
      const state = await store.read(command.projectId, command.taskId);
      if (!state) return result("unavailable", "none", null);
      if (state.task.version !== command.expectedVersion || state.revision !== command.expectedControllerRevision) return result("conflict", "none", null);
      const selected = planDevelopmentControllerStep(state, repository.allowedPaths), action = selected.action;
      const done = (d: DevelopmentControllerDecision) => result(d.status, action, d.state);
      if (action === "none" || action === "hard_stop" || action === "recovery_required") return result(action === "none" ? "none" : action === "hard_stop" ? "blocked" : "recovery_required", action, state);
      if (action === "claim_ready_task") return done(await store.claimReady(command));
      if (action === "require_plan_approval") return await planning(command, state);
      if (action === "start_plan_execution") return done(await store.changeTaskState({ ...command, nextStatus: "running" }));
      if (action === "create_development_run") return done(await store.createRun({ ...command, developmentRunId: controllerDevelopmentRunId(state, selected.developmentTaskId!), developmentTaskId: selected.developmentTaskId, admission: controllerAdmission(state, selected.developmentTaskId!, repository.allowedPaths) }));
      const record = state.runs.find(r => r.run.id === selected.developmentRunId), run = record?.run;
      const transition = (event: unknown) => store.transitionRun({ ...command, developmentRunId: run!.id, expectedRunRevision: record!.revision, event });
      if (action === "start_corrective_attempt") {
        const failure = run!.failures.find(f => f.attemptNumber === run!.currentAttemptNumber);
        if (!failure) return done(await store.changeTaskState({ ...command, nextStatus: "blocked" }));
        const gate = evaluateCorrectiveGate({ attemptNumber: run!.currentAttemptNumber, retryable: failure.retryable, scopeExpansionRequired: failure.scopeExpansionRequired,
          protectedPathViolation: failure.protectedPathViolation, systemForbiddenPathViolation: failure.systemForbiddenPathViolation,
          repeatedFailure: run!.failures.filter(f => f.fingerprint === failure.fingerprint).length > 1, withinApprovedRiskBudget: true });
        if (gate.category !== "AUTO") return done(await store.changeTaskState({ ...command, nextStatus: gate.category === "OWNER" ? "waiting_owner" : "blocked" }));
        return done(await transition({ type: "start_attempt" }));
      }
      if (action === "start_development_attempt") return done(await transition({ type: "start_attempt" }));
      if (action === "select_route") {
        const candidate = await route(state, run!.id); if (!candidate) return done(await store.changeTaskState({ ...command, nextStatus: "blocked" }));
        if (executionMode !== "internal_fake") return result("live_unavailable", action, state);
        const context = captureRoadmapData(await call(prepareContext!, { projectId: state.task.projectId, taskId: state.task.taskId, configuration: candidate.configuration }));
        const executionPolicy = captureRoadmapData(await call(prepare!, { ...candidate, context }));
        if (!executionPolicy) return result("live_unavailable", action, state);
        return done(await store.saveAttemptIntent({ ...command, developmentRunId: run!.id, expectedRunRevision: record!.revision, ...candidate, context, executionPolicy }));
      }
      const intent = run && controllerIntent(state, run.id);
      if (action === "start_executor") {
        if (executionMode !== "internal_fake" || !intent) return result("live_unavailable", action, state);
        const fresh = await route(state, run!.id);
        if (!fresh || roadmapFingerprint(fresh.route) !== roadmapFingerprint(intent.route)) return done(await store.changeTaskState({ ...command, nextStatus: "blocked" }));
        const d = await store.requestOperation({ ...command, developmentRunId: run!.id, expectedRunRevision: record!.revision, kind: "executor" });
        if (d.status !== "applied" || !d.state) return done(d);
        // Never consume the ephemeral return as terminal truth. Acknowledged intent is
        // not a start capability; the port must win the accepted durable start fence.
        try { await call(start!, intent); } catch { /* Possible transmission: next tick inspects facts only. */ }
        return done(d);
      }
      if (action === "await_executor_outcome") {
        if (!intent) return result("recovery_required", action, state);
        const observation = captureRoadmapData(await call(observe!, intent)) as ControllerExecutorObservation;
        if (observation.status === "known_identity") {
          // Retrieval only; this closed port has no start/create input or fallback.
          await call(reconcile!, intent); return result("recovery_required", action, state);
        }
        if (observation.status !== "settled") return done(await store.changeTaskState({ ...command, nextStatus: "recovery_required" }));
        const terminal = exactOwnData(observation.normalizedResult, ["schemaVersion", "identity", "invocationId", "status", "failureCode", "changes", "report", "repository", "planId", "taskId", "attempt", "ownerDecisionRequired", "verificationStatus", "automaticRetryAllowed"]);
        if (!terminal) return done(await store.changeTaskState({ ...command, nextStatus: "recovery_required" }));
        // Store independently re-reads the durable settled result and compares event.
        if (terminal.status === "succeeded") return done(await transition((intent.invocation as ExecutorInvocationInput).mode === "analysis_only"
          ? { type: "submit_analysis", reportFingerprint: (terminal.report as { sha256: string }).sha256 }
          : { type: "submit_patch", changedPaths: (terminal.changes as Array<{ path: string }>).map(c => c.path) }));
        return done(await transition({ type: "implementation_failed", failure: { phase: "implementation", code: "executor_failed", fingerprint: roadmapFingerprint(["pac.controller.executor-failure.v1", terminal.failureCode]), summary: "Executor returned a definitive failure.", retryable: terminal.status === "failed", scopeExpansionRequired: false, protectedPathViolation: false, systemForbiddenPathViolation: false } }));
      }
      if (action === "run_quality_gate" || action === "run_security_gate") {
        if (!intent) return result("recovery_required", action, state);
        const kind = action === "run_quality_gate" ? "quality" : "security";
        const old = state.operations.find(o => o.developmentRunId === run!.id && o.attemptNumber === run!.currentAttemptNumber && o.kind === kind);
        if (old) return done(await store.changeTaskState({ ...command, nextStatus: "recovery_required" })); // Lost gate ACK never fabricated as PASS.
        const d = await store.requestOperation({ ...command, developmentRunId: run!.id, expectedRunRevision: record!.revision, kind });
        if (d.status !== "applied" || !d.state) return done(d);
        const op = d.state.operations.find(o => o.developmentRunId === run!.id && o.attemptNumber === run!.currentAttemptNumber && o.kind === kind)!;
        const binding = { runId: run!.id, attemptNumber: run!.currentAttemptNumber, outcomeFingerprint: op.outcomeFingerprint, operationId: op.operationId };
        let evidence: unknown = null;
        try { evidence = await call(kind === "quality" ? quality! : security!, kind === "quality" ? { ...binding, requiredCommands: run!.requiredVerificationCommands } : { ...binding, producerExecutorId: (intent.configuration as ExecutorAdapterConfiguration).identity.id }); } catch { /* Missing evidence is not PASS. */ }
        const completed = await store.recordOperationEvidence({ commandId: `e-${roadmapFingerprint([op.operationId, "evidence"]).slice(0, 36)}`, projectId: command.projectId, taskId: command.taskId,
          expectedVersion: d.state.task.version, expectedControllerRevision: d.state.revision, operationId: op.operationId, evidence });
        return done(completed);
      }
      if (action === "report_quality_gate" || action === "report_security_gate") {
        const kind = action === "report_quality_gate" ? "quality" : "security";
        const evidence = state.operations.find(o => o.developmentRunId === run!.id && o.attemptNumber === run!.currentAttemptNumber && o.kind === kind)?.evidence;
        return done(await transition(kind === "quality" ? developmentQualityEvent(evidence as DevelopmentQualityEvidence) : developmentSecurityEvent(evidence as DevelopmentSecurityEvidence)));
      }
      if (action === "require_result_acceptance" || action === "require_owner_decision") {
        if (state.task.status !== "waiting_owner") return done(await store.changeTaskState({ ...command, nextStatus: "waiting_owner" }));
        const purpose = action === "require_result_acceptance" ? "result_acceptance" : "scope_change";
        const current = await inTransaction(database, async client => {
          await lockRoadmapProject(client, tenant, command.projectId);
          const factual = await readDevelopmentControllerStateInTransaction(client, tenant, command.projectId, command.taskId);
          if (factual.task.version !== command.expectedVersion || factual.revision !== command.expectedControllerRevision) return null;
          return readControllerOwnerGate(client, tenant, factual, purpose);
        });
        if (!current) {
          const d = await ownerGates.request({ ...command, purpose });
          return result(d.status === "unauthenticated" ? "unavailable" : d.status, action, "approvalRequestId" in d ? state : null);
        }
        if (current.status === "rejected") return done(await store.changeTaskState({ ...command, nextStatus: "blocked" }));
        if (purpose === "result_acceptance" && current.status === "approved") {
          const d = await store.completeProjectTask({ ...command, resultApprovalRequestId: current.approvalRequestId });
          return result(d.status, "complete_project_task", d.state);
        }
        // Scope approval cannot rewrite an immutable plan or revive an AI-011 stop.
        // A new factual approved plan/admission is required; normal Owner approval is
        // never an override of a hard-stop/system invariant.
        return result("waiting_owner", action, state);
      }
      return result("waiting_owner", action, state);
    } catch { return result("recovery_required", "recovery_required", null); }
  }
  return Object.freeze({ advanceController, inspect: store.read, runtimeDispatchAllowed: false as const });
}
