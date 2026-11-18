"use server";

import type { OwnerAI044ProofView } from "@/types/ai044-proof";
import { submitOwnerAI044Proof } from "@/lib/composition/owner-ai044-proof.server";

// Previous UI state is NOT authority. Every action resolves the session, durable
// attempt, exact saved intent and current one-shot Owner queue independently.
export async function ownerAI044ProofAction(_previous: OwnerAI044ProofView, form: FormData): Promise<OwnerAI044ProofView> {
  return submitOwnerAI044Proof(form);
}
