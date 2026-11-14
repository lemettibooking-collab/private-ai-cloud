"use server";

// AI-039 P-1 / AI-039.1 Planning Interview Server Action: turns the Owner's product answers into an
// UNSAVED FeaturePlan candidate for review (or an honest non-candidate outcome). With a valid planning
// policy it performs ONE Owner-approved, budget-bounded planning invocation through a real planning
// Workflow Run (lib/composition/owner-feature-plan-draft.server). It never creates a FeaturePlan
// revision and never changes the task: only the Owner's explicit "save draft revision" (./actions.ts)
// does. No executor, GitHub or repository action.
import type { FeaturePlanCandidate } from "@/lib/development/feature-plan-planner";
import { issuePlanningFormKey, submitOwnerFeaturePlanDraft } from "@/lib/composition/owner-feature-plan-draft.server";

export type FeaturePlanDraftState = Readonly<{
  status: "idle" | "candidate" | "candidate_rejected" | "planner_unavailable" | "budget_denied" | "provider_unavailable" | "planning_failed"
    | "recovery_required" | "egress_approval_required" | "conflict" | "invalid_input" | "not_plannable" | "unavailable" | "unauthenticated";
  candidate: FeaturePlanCandidate | null;
  reason: string | null;
  // A fresh planning idempotency key for the NEXT submission. A resubmission of the same form (lost
  // response, double submit) keeps the old key and replays instead of calling the model again.
  nextKey: string | null;
}>;

export async function draftFeaturePlanAction(_previous: FeaturePlanDraftState, form: FormData): Promise<FeaturePlanDraftState> {
  const nextKey = issuePlanningFormKey();
  try {
    const outcome = await submitOwnerFeaturePlanDraft(form);
    if (outcome.status === "candidate") return { status: "candidate", candidate: outcome.candidate, reason: null, nextKey };
    if (outcome.status === "candidate_rejected") return { status: "candidate_rejected", candidate: null, reason: outcome.reason, nextKey };
    return { status: outcome.status, candidate: null, reason: null, nextKey };
  } catch {
    // The planning port settles its own outcomes; an escaped exception cannot prove nothing was spent.
    return { status: "recovery_required", candidate: null, reason: null, nextKey };
  }
}
