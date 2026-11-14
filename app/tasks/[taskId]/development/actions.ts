"use server";

// AI-039 Plan Builder Server Action: saves ONE draft FeaturePlan revision of a ProjectTask. It forwards
// the untrusted FormData to the server-only binding, which re-authenticates the Owner for THIS request
// and calls the audited saveDraftRevision contract. Planning data only: no run, model, executor,
// GitHub or repository action, and no ProjectTask status change.
import { redirect } from "next/navigation";
import { submitOwnerFeaturePlan } from "@/lib/composition/owner-feature-plan-save.server";

// Same shape as the Plan Builder's state: public plan errors are only code / field / step position.
export type FeaturePlanFormState = Readonly<{
  status: "idle" | "invalid_plan" | "invalid_input" | "not_plannable" | "conflict" | "unavailable" | "unauthenticated";
  errors: readonly Readonly<{ code: string; field: string; step: number | null }>[];
}>;

export async function saveFeaturePlanAction(_previous: FeaturePlanFormState, form: FormData): Promise<FeaturePlanFormState> {
  let outcome;
  try {
    outcome = await submitOwnerFeaturePlan(form);
  } catch {
    return { status: "unavailable", errors: [] };
  }
  // redirect() throws Next.js control flow, so it stays OUTSIDE the error handling above. The page
  // reads the persisted revision again through the read path (no optimistic client state).
  if (outcome.status === "redirect") redirect(outcome.href);
  return { status: outcome.status, errors: outcome.status === "invalid_plan" ? outcome.errors : [] };
}
