"use server";

import { revalidatePath } from "next/cache";
import { submitOwnerProjectCreate } from "@/lib/composition/owner-project-create.server";

export async function createProjectAction(_previous: unknown, form: FormData) {
  try {
    const result = await submitOwnerProjectCreate(form);
    if (result.status === "created" || result.status === "replayed") {
      revalidatePath("/projects");
      return { status: result.status, projectId: result.project.projectId };
    }
    return { status: result.status, projectId: null };
  } catch { return { status: "unavailable" as const, projectId: null }; }
}
