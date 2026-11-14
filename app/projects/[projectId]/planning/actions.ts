"use server";
import { revalidatePath } from "next/cache";
import { submitProjectPlanning } from "@/lib/composition/owner-project-planning.server";
export async function previewProjectPlanAction(_previous:unknown,form:FormData){return submitProjectPlanning("preview",form);}
export async function prepareProjectAIPlanAction(_previous:unknown,form:FormData){return submitProjectPlanning("prepareAI",form);}
export async function saveProjectPlanAction(_previous:unknown,form:FormData){
  const r=await submitProjectPlanning("save",form);if(r.status==="saved"||r.status==="replayed")revalidatePath("/projects/[projectId]/planning","page");return{status:r.status};
}
export async function decideProjectPlanAction(_previous:unknown,form:FormData){
  const r=await submitProjectPlanning("decide",form);if(r.status==="approved"||r.status==="rejected"||r.status==="replayed"){revalidatePath("/projects/[projectId]/planning","page");revalidatePath("/tasks");revalidatePath("/approvals");}return{status:r.status};
}
