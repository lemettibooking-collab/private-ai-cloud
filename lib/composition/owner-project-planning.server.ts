import "server-only";
import { connection } from "next/server";
import { auth } from "../auth/next-auth.server";
import { createWorkflowRuntimePostgresDatabase } from "../db/postgres";
import { createProjectOwnerAccess } from "../projects/project-owner-access";
import { createRepositoryBinding } from "../projects/repository-binding";
import { createProjectPlanning } from "../planning/project-planning";
import { projectPlanningForm } from "../planning/project-planning-form";
async function withPlanning<T>(work:(planning:ReturnType<typeof createProjectPlanning>,repository:ReturnType<typeof createRepositoryBinding>)=>Promise<T>){
  const session=await auth();const database=createWorkflowRuntimePostgresDatabase({connectionString:process.env.DATABASE_URL,maxConnections:2});
  try{const access=createProjectOwnerAccess({database,domainWorkspaceId:process.env.APP_DEMO_WORKSPACE_SLUG??"",session});return await work(createProjectPlanning(access),createRepositoryBinding(access));}
  finally{await database.close().catch(()=>undefined);}
}
export async function loadProjectPlanning(projectId:unknown,revision:unknown){
  await connection();
  try{return await withPlanning(async(planning,repository)=>{
    const binding=await repository.read(projectId);if(binding.status!=="ok")return{status:binding.status};
    const sources=await planning.sources(projectId);if(sources.status!=="ok")return{status:sources.status};
    const n=revision===undefined?undefined:typeof revision==="string"&&/^[1-9][0-9]?$/u.test(revision)?Number(revision):NaN;
    const plans=await planning.read(projectId,n);if(plans.status!=="ok")return{status:plans.status};
    return{status:"available" as const,binding:binding.value,sources:sources.value,plans:plans.value};
  });}catch{return{status:"unavailable" as const};}
}
export async function submitProjectPlanning(operation:"preview"|"save"|"decide"|"prepareAI",form:FormData){
  try{const input=projectPlanningForm(form,operation);if(!input)return{status:"invalid_input" as const};
    return await withPlanning(async planning=>{
      if(operation==="preview"){const r=await planning.preview(input);return r.status==="ok"?{status:"preview" as const,preview:r.value}:r;}
      if(operation==="prepareAI"){const r=await planning.prepareAI(input);return r.status==="ok"?{status:"blocked" as const,prepared:r.value}:r;}
      const r=operation==="save"?await planning.save(input):await planning.decide(input);
      return r.status==="ok"?{status:r.value.outcome}:r;
    });
  }catch{return{status:"unavailable" as const};}
}
