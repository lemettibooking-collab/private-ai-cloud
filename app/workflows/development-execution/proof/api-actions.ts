"use server";
import { redirect } from "next/navigation";
import { submitOwnerOpenAIApiProof } from "@/lib/composition/owner-openai-api-proof.server";
export async function ownerOpenAIApiProofAction(form:FormData):Promise<void> {
  await submitOwnerOpenAIApiProof(form);
  redirect("/workflows/development-execution/proof?mode=openai_api");
}
