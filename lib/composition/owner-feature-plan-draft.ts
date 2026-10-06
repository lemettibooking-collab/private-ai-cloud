import { isProxy } from "node:util/types";
import type { OwnerConsoleTaskDevelopment } from "./owner-console-read";
import type { FeaturePlanCandidate, CandidateRejection, PlanningModelPort } from "../development/feature-plan-planner";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { draftFeaturePlanCandidate } from "../development/feature-plan-planner.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { interviewLimits, validateInterviewAnswers } from "../development/planning-interview.ts";
// @ts-expect-error Node.js direct TypeScript execution requires the runtime extension.
import { isTaskKey } from "../tasks/project-task.ts";

// AI-039 P-1 AI-assisted planning binding (server-side). Produces an UNSAVED FeaturePlan candidate for
// Owner review; it never writes anything (no FeaturePlan revision, no audit, no task change).
//
//   "use server" action (app/tasks/[taskId]/development/draft-actions.ts)
//     → ./owner-feature-plan-draft.server (trusted workspace, request-scoped Auth.js read path)
//     → interview FormData → bounded raw answers
//     → loadOwnerTaskDevelopment(taskId) (AI-038.1 Owner check → AI-038.0 backend): task facts and
//       whether a new revision is allowed (draft task, active project, readable plans)
//     → answers validated against the interview of THIS task type
//     → draftFeaturePlanCandidate (ONE bounded planning completion; deterministic validation)
//
// The planning model port is null in production: no planning provider is bound (M2.2 deferred), so
// the honest outcome is `planner_unavailable` and the Owner can use the manual technical editor.

export type FeaturePlanDraftOutcome =
  | Readonly<{ status: "candidate"; candidate: FeaturePlanCandidate }>
  | Readonly<{ status: "candidate_rejected"; reason: CandidateRejection }>
  | Readonly<{ status: "planner_unavailable" | "planner_failed" | "invalid_input" | "not_plannable" | "unavailable" | "unauthenticated" }>;

export type OwnerFeaturePlanDraftDependencies = Readonly<{
  // The authenticated Owner read of one task's Development Workflow (server-side loader).
  loadDevelopment(taskId: string): Promise<OwnerConsoleTaskDevelopment>;
  // The bounded planning model, or null when no planning provider is bound.
  planner: PlanningModelPort | null;
}>;

const answerFieldPattern = /^answer\.([A-Za-z]{1,32})$/u;
const maxEntries = 64;
const outcome = (status: "planner_unavailable" | "planner_failed" | "invalid_input" | "not_plannable" | "unavailable" | "unauthenticated"): FeaturePlanDraftOutcome => Object.freeze({ status });

// Untrusted interview FormData → { taskId, raw answers } or null. Only `taskId` (once) and
// `answer.<questionId>` (repeatable for multi-choice) are accepted, plus React's `$ACTION_*` fields.
export function planningInputFromForm(form: unknown): Readonly<{ taskId: string; answers: Readonly<Record<string, readonly string[]>> }> | null {
  try {
    if (typeof FormData === "undefined" || !(form instanceof FormData) || isProxy(form)) return null;
    let taskId: string | null = null;
    let taskIdCount = 0;
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
      const match = answerFieldPattern.exec(name);
      if (!match) return null;
      answers[match[1]] = [...(answers[match[1]] ?? []), value];
    }
    if (taskIdCount !== 1 || !isTaskKey(taskId)) return null;
    return Object.freeze({ taskId: taskId as string, answers: Object.freeze(answers) });
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
      const result = await draftFeaturePlanCandidate({
        task: { taskId: task.taskId, projectId: task.projectId, type: task.type, title: task.title, goal: task.goal, priority: task.priority, riskLevel: task.riskLevel },
        answers,
        model: planner,
      });
      if (result.status === "candidate") return Object.freeze({ status: "candidate" as const, candidate: result.candidate });
      if (result.status === "rejected") return Object.freeze({ status: "candidate_rejected" as const, reason: result.reason });
      return outcome(result.status === "unavailable" ? "planner_unavailable" : "planner_failed");
    },
  });
}
