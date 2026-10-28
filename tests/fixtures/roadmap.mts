import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after } from "node:test";
import type { LiveDatabase } from "../pg/helpers/live-pg";
const postgres = await import(new URL("../../lib/db/postgres.ts", import.meta.url).href) as typeof import("../../lib/db/postgres");
const tenants = await import(new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href) as typeof import("../../lib/db/workflow-runtime-tenant");
const tasks = await import(new URL("../../lib/tasks/owner-task-mutations.ts", import.meta.url).href) as typeof import("../../lib/tasks/owner-task-mutations");
const plans = await import(new URL("../../lib/development/feature-plan-mutations.ts", import.meta.url).href) as typeof import("../../lib/development/feature-plan-mutations");
export const roadmapMetadata = () => ({ scope:["Implement approved scope"],nonGoals:["No deployment"],acceptanceCriteria:["Required checks pass"],artifacts:["Patch and bounded report"],requiredQuality:true as const,requiredSecurity:true as const,approvalPolicy:"owner" as const,changeEvidence:"Owner-authored initial roadmap revision" });
export const roadmapPlan = () => ({title:"Approved delivery",goal:"Deliver bounded change",tasks:[{id:"step-1",sequence:1,title:"Implementation",goal:"Implement approved change",scope:["Library update"],nonGoals:["No deployment"],allowedPaths:["lib/feature/"],acceptanceCriteria:["Tests pass"],verificationCommands:["npm test"],dependencyIds:[],riskLevel:"low",priority:"P2",requiresOwnerApproval:false}]});
export async function roadmapFixture(db:LiveDatabase,label:string){
  const workspaceId=randomUUID(),ownerId=randomUUID(),domain=`roadmap-${label}`;
  await db.admin.query(`insert into workspaces(id,name,slug,type,region,status,domain_workspace_id) values($1,$2,$2,'company','eu','active',$2)`,[workspaceId,domain]);
  await db.admin.query(`insert into users(id,email,name,status) values($1,$2,'Roadmap Owner','active')`,[ownerId,`${label}-${ownerId}@pac.test`]);
  const member=(await db.admin.query(`insert into workspace_members(workspace_id,user_id,status) values($1,$2,'active') returning id`,[workspaceId,ownerId])).rows[0].id;
  const role=(await db.admin.query(`insert into roles(workspace_id,code,name) values($1,'owner','Owner') returning id`,[workspaceId])).rows[0].id;
  await db.admin.query(`insert into member_role_assignments(member_id,role_id) values($1,$2)`,[member,role]);
  await db.admin.query(`insert into projects(workspace_id,project_key,display_name,status,repository_url,default_branch) values($1,'project-a','Project A','active','https://github.com/pac/example','main'),($1,'project-b','Project B','active',null,null)`,[workspaceId]);
  const database=postgres.createWorkflowRuntimePostgresDatabase({connectionString:db.url,maxConnections:8});after(()=>database.close());
  const tenant=await tenants.createPostgresWorkflowRuntimeTenantResolver(database).resolve(domain);assert.ok(tenant);
  const identitySource=Object.freeze({resolve:()=>({userId:ownerId})});
  const taskWriter=tasks.createOwnerTaskMutations({database,domainWorkspaceId:domain,identitySource}),planWriter=plans.createOwnerFeaturePlanMutations({database,domainWorkspaceId:domain,identitySource});
  async function task(key:string,type="feature",withPlan=true){
    const r=await taskWriter.createTask({idempotencyKey:`task-${label}-${key}-000000`,projectId:"project-a",title:`Roadmap ${key}`,goal:"Deliver approved intent",type,priority:"P1",riskLevel:"low"});assert.ok(r.status==="created"||r.status==="replayed");
    let planId:string|null=null;
    if(withPlan){const p=await planWriter.saveDraftRevision({idempotencyKey:`plan-${label}-${key}-000000`,taskId:r.task.taskId,plan:roadmapPlan()});assert.ok(p.status==="created"||p.status==="replayed");planId=p.revision.planId;}
    return Object.freeze({taskId:r.task.taskId,projectId:"project-a",planId});
  }
  return Object.freeze({database,tenant,workspaceId,ownerId,identitySource,task,planWriter,domain});
}
