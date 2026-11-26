import 'server-only';
import { auth } from '../auth/next-auth.server';
import { createWorkflowRuntimePostgresDatabase } from '../db/postgres';
import { createProjectOwnerAccess } from '../projects/project-owner-access';
import { projectPlanningGenerationAuthority } from '../planning/project-planning';
import { createProjectRoadmapEnrollment } from '../planning/project-roadmap-enrollment';
import { projectRoadmapForm, type ProjectRoadmapOperation } from '../planning/project-roadmap-form';
async function withRoadmap<T>(work:(service:ReturnType<typeof createProjectRoadmapEnrollment>,access:ReturnType<typeof createProjectOwnerAccess>)=>Promise<T>){
 const session=await auth(),domainWorkspaceId=process.env.APP_DEMO_WORKSPACE_SLUG??'',database=createWorkflowRuntimePostgresDatabase({connectionString:process.env.DATABASE_URL,maxConnections:2});
 try{const access=createProjectOwnerAccess({database,domainWorkspaceId,session});return await work(createProjectRoadmapEnrollment(access,projectPlanningGenerationAuthority(session,domainWorkspaceId)),access);}finally{await database.close().catch(()=>undefined);}
}
export async function submitProjectRoadmap(operation:ProjectRoadmapOperation,form:FormData){
 try{const f=projectRoadmapForm(form,operation);if(!f)return{status:'invalid_input'};
 return await withRoadmap(async service=>{
  if(operation==='preview'){const r=await service.preview(f);return r.status==='ok'?{status:'preview',preview:r.value}:r;}
  const r=operation==='enroll'?await service.enroll(f):await service.ready(f);
  return r.status==='ok'?{status:String(r.value.status)}:r;
 });}catch{return{status:'unavailable'};}
}
export async function loadTaskProjectRoadmap(projectId:string,taskId:string){
 try{return await withRoadmap(async(service,access)=>{
  const binding=await access.run(projectId,false,async(client,c)=>{
   const q=await client.query(`select p.revision,p.plan_fingerprint,p.source_fingerprint from project_planning_task_links l join project_planning_drafts p on p.workspace_id=l.workspace_id and p.project_key=l.project_key and p.id=l.draft_id where l.workspace_id=$1 and l.project_key=$2 and l.task_key=$3 and p.status='approved'`,[c.workspaceId,projectId,taskId]);
   if(q.rowCount!==1)return null;return{projectId,revision:q.rows[0].revision,planFingerprint:q.rows[0].plan_fingerprint,sourceFingerprint:q.rows[0].source_fingerprint};
  });
  if(binding.status!=='ok'||!binding.value)return null;const read=await service.preview(binding.value);return read.status==='ok'?read.value:null;
 });}catch{return null;}
}
