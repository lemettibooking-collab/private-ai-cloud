import { isProxy } from "node:util/types";
import type { OwnerConsoleTaskDevelopment } from "./owner-console-read";
import type { FeaturePlanCandidate, CandidateRejection, PlanningModelPort } from "../development/feature-plan-planner";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { planningIdempotencyKeyPattern } from "../development/feature-plan-planning-requests.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { draftFeaturePlanCandidate } from "../development/feature-plan-planner.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { interviewLimits, validateInterviewAnswers } from "../development/planning-interview.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isTaskKey } from "../tasks/project-task.ts";

// AI-039 P-1 / AI-039.1 AI-assisted planning binding (server-side). Produces an UNSAVED FeaturePlan
// candidate for Owner review. It never creates a FeaturePlan revision and never changes the task; the
// only durable effects are those of the bound planning port (AI-039.1: the planning request, its
// audit events and the real planning Workflow Run with its ledger, budget and durable result).
//
//   "use server" action (app/tasks/[taskId]/development/draft-actions.ts)
//     → ./owner-feature-plan-draft.server (trusted workspace, request-scoped Auth.js read path)
//     → interview FormData → bounded raw answers
//     → loadOwnerTaskDevelopment(taskId) (AI-038.1 Owner check → AI-038.0 backend): task facts and
//       whether a new revision is allowed (draft task, active project, readable plans)
//     → answers validated against the interview of THIS task type
//     → the Owner's explicit data-egress approval (form consent) — required before anything is sent
//     → draftFeaturePlanCandidate (ONE bounded planning invocation; deterministic validation)
//
// The planning port is null whenever no valid `feature_plan_planning` policy and provider binding
// exist (server configuration): the honest outcome is then `planner_unavailable` and the Owner can
// use the manual technical editor.

export type FeaturePlanDraftFailure =
  | "planner_unavailable" | "budget_denied" | "provider_unavailable" | "planning_failed" | "recovery_required"
  | "egress_approval_required" | "conflict" | "invalid_input" | "not_plannable" | "unavailable" | "unauthenticated";

export type FeaturePlanDraftOutcome =
  | Readonly<{ status: "candidate"; candidate: FeaturePlanCandidate }>
  | Readonly<{ status: "candidate_rejected"; reason: CandidateRejection }>
  | Readonly<{ status: FeaturePlanDraftFailure }>;

export type OwnerFeaturePlanDraftDependencies = Readonly<{
  // The authenticated Owner read of one task's Development Workflow (server-side loader).
  loadDevelopment(taskId: string): Promise<OwnerConsoleTaskDevelopment>;
  // The bounded planning port, or null when no valid planning policy / provider is bound.
  planner: PlanningModelPort | null;
}>;

const answerFieldPattern = /^answer\.([A-Za-z]{1,32})$/u;
const maxEntries = 64;
const outcome = (status: FeaturePlanDraftFailure): FeaturePlanDraftOutcome => Object.freeze({ status });

export type PlanningFormInput = Readonly<{
  taskId: string;
  idempotencyKey: string;
  egressApproved: boolean;
  answers: Readonly<Record<string, readonly string[]>>;
}>;

// Untrusted interview FormData → bounded plain input or null. Accepted: `taskId` and `idempotencyKey`
// (exactly once each), `egressApproval` (at most once, only "yes"), `answer.<questionId>` (repeatable
// for multi-choice), plus React's `$ACTION_*` fields.
export function planningInputFromForm(form: unknown): PlanningFormInput | null {
  try {
    if (typeof FormData === "undefined" || !(form instanceof FormData) || isProxy(form)) return null;
    let taskId: string | null = null;
    let taskIdCount = 0;
    let idempotencyKey: string | null = null;
    let idempotencyKeyCount = 0;
    let egressApprovalCount = 0;
    const answers: Record<string, string[]> = {};
    let entries = 0;
    for (const [name, value] of form.entries()) {
      entries += 1;
      if (entries > maxEntries) return null;
      if (name.startsWith("$ACTION_")) continue;
      if (typeof value !== "string" || value.length > interviewLimits.maxTextLength + 64) return null;
      if (name === "taskId") {
        taskId = value;
        taskIdCount += 1;
        continue;
      }
      if (name === "idempotencyKey") {
        idempotencyKey = value;
        idempotencyKeyCount += 1;
        continue;
      }
      if (name === "egressApproval") {
        if (value !== "yes") return null;
        egressApprovalCount += 1;
        continue;
      }
      const match = answerFieldPattern.exec(name);
      if (!match) return null;
      answers[match[1]] = [...(answers[match[1]] ?? []), value];
    }
    if (taskIdCount !== 1 || !isTaskKey(taskId) || idempotencyKeyCount !== 1 || !planningIdempotencyKeyPattern.test(idempotencyKey ?? "")
      || egressApprovalCount > 1) return null;
    return Object.freeze({ taskId: taskId as string, idempotencyKey: idempotencyKey as string, egressApproved: egressApprovalCount === 1, answers: Object.freeze(answers) });
  } catch {
    return null;
  }
}

export function createOwnerFeaturePlanDraft(dependencies: OwnerFeaturePlanDraftDependencies) {
  const loadDevelopment = dependencies.loadDevelopment;
  const planner = dependencies.planner;
  return Object.freeze({
    async submit(form: unknown): Promise<FeaturePlanDraftOutcome> {
      const input = planningInputFromForm(form);
      if (!input) return outcome("invalid_input");
      let view: OwnerConsoleTaskDevelopment;
      try {
        view = await loadDevelopment(input.taskId);
      } catch {
        return outcome("unavailable");
      }
      if (view.state === "unauthenticated") return outcome("unauthenticated");
      if (view.state !== "available" || view.development.state !== "available") return outcome("unavailable");
      const { task, creationBlock } = view.development;
      if (task.taskId !== input.taskId) return outcome("unavailable");
      if (creationBlock !== null) return outcome("not_plannable");
      const answers = validateInterviewAnswers(task.type, input.answers);
      if (!answers) return outcome("invalid_input");
      if (!planner) return outcome("planner_unavailable");
      // Nothing leaves this server without the Owner's explicit approval of THIS planning request.
      if (!input.egressApproved) return outcome("egress_approval_required");
      const result = await draftFeaturePlanCandidate({
        task: { taskId: task.taskId, projectId: task.projectId, type: task.type, title: task.title, goal: task.goal, priority: task.priority, riskLevel: task.riskLevel },
        answers,
        context: { taskId: task.taskId, projectId: task.projectId, projectName: view.development.project?.displayName ?? task.projectId, idempotencyKey: input.idempotencyKey },
        model: planner,
      });
      if (result.status === "candidate") return Object.freeze({ status: "candidate" as const, candidate: result.candidate });
      if (result.status === "rejected") return Object.freeze({ status: "candidate_rejected" as const, reason: result.reason });
      return outcome(result.status === "unavailable" ? "planner_unavailable" : result.status === "failed" ? "planning_failed" : result.status);
    },
  });
}
