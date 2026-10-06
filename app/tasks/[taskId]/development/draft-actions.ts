"use server";

// AI-039 P-1 Planning Interview Server Action: turns the Owner's product answers into an UNSAVED
// FeaturePlan candidate for review (or an honest "planner unavailable"). It writes nothing: only the
// Owner's explicit "save draft revision" (./actions.ts) creates a FeaturePlan revision. No run, model
// spend, executor, GitHub or repository action.
import type { FeaturePlanCandidate } from "@/lib/development/feature-plan-planner";
import { submitOwnerFeaturePlanDraft } from "@/lib/composition/owner-feature-plan-draft.server";

export type FeaturePlanDraftState = Readonly<{
  status: "idle" | "candidate" | "candidate_rejected" | "planner_unavailable" | "planner_failed" | "invalid_input" | "not_plannable" | "unavailable" | "unauthenticated";
  candidate: FeaturePlanCandidate | null;
  reason: string | null;
}>;

export async function draftFeaturePlanAction(_previous: FeaturePlanDraftState, form: FormData): Promise<FeaturePlanDraftState> {
  try {
    const outcome = await submitOwnerFeaturePlanDraft(form);
    if (outcome.status === "candidate") return { status: "candidate", candidate: outcome.candidate, reason: null };
    if (outcome.status === "candidate_rejected") return { status: "candidate_rejected", candidate: null, reason: outcome.reason };
    return { status: outcome.status, candidate: null, reason: null };
  } catch {
    return { status: "unavailable", candidate: null, reason: null };
  }
}
