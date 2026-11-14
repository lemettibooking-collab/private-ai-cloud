"use server";
import { revalidatePath } from "next/cache";
import { submitKnowledgeUpload } from "@/lib/composition/owner-project-resources.server";
export async function uploadKnowledgeAction(_previous: unknown, form: FormData) {
  const result = await submitKnowledgeUpload(form);
  if (result.status === "ok") { revalidatePath("/knowledge"); return { status: result.value.outcome }; }
  return { status: result.status };
}
