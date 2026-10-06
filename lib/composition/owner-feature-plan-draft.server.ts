// AI-039 P-1: application-facing entry for AI-assisted planning (server-only).
//
//   "use server" action → submitOwnerFeaturePlanDraft(FormData)
//     → loadOwnerTaskDevelopment (real Auth.js auth() of THIS request, trusted workspace)
//     → draftFeaturePlanCandidate with the bound planning model
//
// No planning provider is bound: a real ModelProvider binding needs the run-scoped invocation ledger
// and pre-spend budget reservation, which do not exist for planning yet (M2.2 deferred, no paid call
// approved). `planner: null` therefore makes the factual outcome `planner_unavailable`. Nothing here
// writes, and nothing is called on a provider, executor, GitHub or repository.
import "server-only";
import { loadOwnerTaskDevelopment } from "./owner-console-read.server";
import { createOwnerFeaturePlanDraft } from "./owner-feature-plan-draft";

export type { FeaturePlanDraftOutcome } from "./owner-feature-plan-draft";

const planningDraft = createOwnerFeaturePlanDraft({
  loadDevelopment: (taskId) => loadOwnerTaskDevelopment(taskId, undefined),
  planner: null,
});

export async function submitOwnerFeaturePlanDraft(form: FormData) {
  return planningDraft.submit(form);
}

// Whether AI-assisted planning can produce a candidate right now (presentation only).
export function isFeaturePlanPlannerAvailable(): boolean {
  return false;
}
