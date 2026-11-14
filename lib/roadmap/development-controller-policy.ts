import type { DevelopmentControllerState, ControllerAttemptIntent } from "../db/development-controller-store";
import type { DevelopmentTaskAdmissionInput } from "../contracts/development-task-policy";
import type { ExecutorRepositoryRef } from "../contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateDevelopmentTaskAdmission } from "../contracts/development-task-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { buildDevelopmentTaskWaves } from "../contracts/development-plan.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { deriveRoadmapTaskClass, roadmapFingerprint } from "./roadmap-contract.ts";

export type ControllerNextAction = "claim_ready_task" | "require_plan_approval" | "consume_plan_approval" | "start_plan_execution"
  | "create_development_run" | "start_development_attempt" | "select_route" | "start_executor" | "await_executor_outcome"
  | "run_quality_gate" | "report_quality_gate" | "run_security_gate" | "report_security_gate" | "start_corrective_attempt"
  | "require_owner_decision" | "require_result_acceptance" | "complete_project_task" | "recovery_required" | "hard_stop" | "none";
export type ControllerNext = Readonly<{ action: ControllerNextAction; developmentRunId: string | null; developmentTaskId: string | null }>;
const next = (action: ControllerNextAction, developmentRunId: string | null = null, developmentTaskId: string | null = null): ControllerNext => Object.freeze({ action, developmentRunId, developmentTaskId });

/** Same Admission contract for planner and persisted execution. No model scheduler imitation. */
export function controllerAdmission(state: DevelopmentControllerState, taskId: string, repositoryAllowlist: readonly string[]): DevelopmentTaskAdmissionInput | null {
  if (!state.approvedPlan) return null;
  return Object.freeze({ plan: state.approvedPlan.plan, taskId,
    completedTaskIds: Object.freeze(state.runs.filter(r => r.run.status === "completed").map(r => r.run.taskId).sort()),
    activeTaskIds: Object.freeze(state.runs.filter(r => !["ready", "completed", "cancelled", "blocked"].includes(r.run.status)).map(r => r.run.taskId).sort()),
    repositoryAllowlist, taskOwnerApprovalGranted: true });
}

/** Deterministic one-step selection, not execution authority and not a process loop. */
export function planDevelopmentControllerStep(state: DevelopmentControllerState, repositoryAllowlist: readonly string[]): ControllerNext {
  const status = state.task.status;
  if (!["draft", "ready", "planning", "approved", "running", "verifying", "waiting_owner", "blocked", "recovery_required", "completed", "failed", "cancelled"].includes(status)) return next("hard_stop");
  if (status === "completed" || status === "cancelled" || status === "failed" || status === "draft") return next("none");
  if (status === "blocked") return next("hard_stop");
  if (status === "recovery_required") return next("recovery_required");
  if (status === "ready") return next("claim_ready_task");
  if (!state.approvedPlan) return next("require_plan_approval");
  if (status === "approved") return next("start_plan_execution");
  const plan = state.approvedPlan.plan;
  if (state.runs.length === plan.tasks.length && state.runs.every(r => r.run.status === "completed")) return next("require_result_acceptance");
  const hard = state.runs.find(r => r.run.status === "blocked");
  if (hard) return next("hard_stop", hard.run.id, hard.run.taskId);
  const owner = state.runs.find(r => r.run.status === "awaiting_owner_decision");
  if (owner) return next("require_owner_decision", owner.run.id, owner.run.taskId);
  const waves = buildDevelopmentTaskWaves(plan);
  if (!waves.ok) return next("hard_stop");
  // Current incomplete wave only. Independent disjoint nodes may be admitted while
  // another node in this wave is active. Overlap remains the existing Admission's veto.
  const wave = waves.value.find(w => w.some(t => !state.runs.some(r => r.run.taskId === t.id && r.run.status === "completed")));
  if (!wave) return next("hard_stop");
  // Activate a newly persisted node before proposing another one. Otherwise two
  // overlapping ready snapshots can repeatedly propose an admission the store vetoes.
  const pending = wave.map(t => state.runs.find(r => r.run.taskId === t.id)).find(r => r?.run.status === "ready");
  if (pending) return next("start_development_attempt", pending.run.id, pending.run.taskId);
  for (const task of wave) {
    if (state.runs.some(r => r.run.taskId === task.id)) continue;
    const admission = controllerAdmission(state, task.id, repositoryAllowlist);
    if (admission && evaluateDevelopmentTaskAdmission(admission).verdict === "allow") return next("create_development_run", null, task.id);
  }
  const frontier: ControllerNext[] = [];
  for (const task of wave) {
    const r = state.runs.find(r => r.run.taskId === task.id); if (!r || r.run.status === "completed") continue;
    const run = r.run;
    if (run.status === "ready") { frontier.push(next("start_development_attempt", run.id, run.taskId)); continue; }
    if (run.status === "awaiting_correction") { frontier.push(next("start_corrective_attempt", run.id, run.taskId)); continue; }
    const intent = state.attempts.find(a => a.developmentRunId === run.id && a.attemptNumber === run.currentAttemptNumber);
    if (run.status === "implementing") {
      if (!intent) { frontier.push(next("select_route", run.id, run.taskId)); continue; }
      const operation = state.operations.find(o => o.developmentRunId === run.id && o.attemptNumber === run.currentAttemptNumber && o.kind === "executor");
      frontier.push(next(operation ? "await_executor_outcome" : "start_executor", run.id, run.taskId));
      continue;
    }
    if (run.status === "verifying" || run.status === "reviewing") {
      const kind = run.status === "verifying" ? "quality" : "security";
      const op = state.operations.find(o => o.developmentRunId === run.id && o.attemptNumber === run.currentAttemptNumber && o.kind === kind);
      frontier.push(next(op?.status === "recorded" ? kind === "quality" ? "report_quality_gate" : "report_security_gate" : kind === "quality" ? "run_quality_gate" : "run_security_gate", run.id, run.taskId));
      continue;
    }
    return next("hard_stop", run.id, run.taskId);
  }
  // Cooperative wave frontier: bring all eligible siblings to their external-wait
  // boundary before consuming an earlier outcome. Each tick still selects ONE
  // action; stable canonical wave order breaks ties within a phase. Admission
  // above and all existing store/start fences remain authoritative, not this list.
  for (const phase of ["start_development_attempt", "start_corrective_attempt", "select_route", "start_executor"] as const) {
    const candidate = frontier.find(item => item.action === phase);
    if (candidate) return candidate;
  }
  return frontier[0] ?? next("hard_stop");
}

/** Stable IDs never use clocks or random caller choices to recreate a side effect. */
export function controllerDevelopmentRunId(state: DevelopmentControllerState, developmentTaskId: string): string {
  return `dev-${roadmapFingerprint(["pac.roadmap-development-run.v1", state.task.projectId, state.task.taskId, state.approvedPlan?.executionFingerprint, developmentTaskId]).slice(0, 40)}`;
}
export function controllerInvocationId(runId: string, attemptNumber: number): string { return `inv-${roadmapFingerprint(["pac.controller-invocation.v1", runId, attemptNumber]).slice(0, 40)}`; }
export function controllerTaskClass(state: DevelopmentControllerState, attemptNumber: number) { return deriveRoadmapTaskClass(state.task.taskType, attemptNumber > 1); }
export function controllerIntent(state: DevelopmentControllerState, runId: string): ControllerAttemptIntent | null {
  const run = state.runs.find(r => r.run.id === runId)?.run;
  return run ? state.attempts.find(a => a.developmentRunId === runId && a.attemptNumber === run.currentAttemptNumber) ?? null : null;
}
export type ControllerRepository = Readonly<{ repository: ExecutorRepositoryRef; allowedPaths: readonly string[] }>;
