"use server";
import { revalidatePath } from "next/cache";
import { submitRepositoryBinding } from "@/lib/composition/owner-project-resources.server";
export async function bindRepositoryAction(_previous: unknown, form: FormData) {
  const result = await submitRepositoryBinding(form);
  if (result.status === "ok") { revalidatePath("/projects"); revalidatePath("/projects/[projectId]", "page"); return { status: result.value.outcome }; }
  return { status: result.status };
}
