"use server";

// AI-038.4b Quick Create Server Action: the ONLY Owner task write reachable from the UI.
// It forwards the untrusted FormData to the server-only Quick Create binding, which re-authenticates
// the Owner for THIS request and calls the audited AI-038.4a createTask. It creates a draft task
// intent only: no run, model, executor or GitHub action. attachRun is not exposed.
import { redirect } from "next/navigation";
import { submitOwnerQuickCreate } from "@/lib/composition/owner-task-create.server";

export type QuickCreateFormState = Readonly<{ status: "idle" | "invalid_input" | "conflict" | "unavailable" | "unauthenticated" }>;

export async function quickCreateTaskAction(_previous: QuickCreateFormState, form: FormData): Promise<QuickCreateFormState> {
  let outcome;
  try {
    outcome = await submitOwnerQuickCreate(form);
  } catch {
    return { status: "unavailable" };
  }
  // redirect() throws Next.js control flow, so it stays OUTSIDE the error handling above. The Task
  // Detail page reads the task again through the existing read path (no client-side task state).
  if (outcome.status === "redirect") redirect(outcome.href);
  return { status: outcome.status };
}
