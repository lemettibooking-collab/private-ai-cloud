import type { ProjectTaskStatus } from '../tasks/project-task';
import type { createProjectOwnerAccess, ProjectOwnerContext } from '../projects/project-owner-access';
import type { WorkflowRuntimeSqlClient } from '../db/workflow-runtime-store';
import type { ResolvedWorkflowRuntimeTenant } from '../db/workflow-runtime-tenant';
// @ts-expect-error Direct Node execution requires extension.
import { readApprovedProjectPlanningInTransaction } from './project-planning.ts';
// @ts-expect-error Direct Node execution requires extension.
import { exactOwnData, Conflict, Unavailable } from '../tasks/owner-task-mutations.ts';
// @ts-expect-error Direct Node execution requires extension.
import { isTaskKey, isProjectTaskStatus } from '../tasks/project-task.ts';
// @ts-expect-error Direct Node execution requires extension.
import { normalizeRoadmapMetadata, roadmapFingerprint, validateRoadmapGraph } from '../roadmap/roadmap-contract.ts';
// @ts-expect-error Direct Node execution requires extension.
import { lockRoadmapProject, readRoadmapTaskInTransaction, transitionRoadmapTaskInTransaction } from '../db/roadmap-store.ts';
// @ts-expect-error Direct Node execution requires extension.
import { enrollRoadmapTaskInTransaction, replayRoadmapOwnerCommand, recordRoadmapOwnerCommand } from '../roadmap/roadmap-owner-commands.ts';
// @ts-expect-error Direct Node execution requires extension.
import { readLatestRoadmapPlan } from '../db/roadmap-approvals.ts';

type Access=ReturnType<typeof createProjectOwnerAccess>;
type Authority=Readonly<{domainWorkspaceId:string;identityFingerprint:string}>;
const selectorFields=['projectId','revision','planFingerprint','sourceFingerprint'];
const hash=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
export function projectRoadmapSelector(raw:unknown,extra:readonly string[]=[]){
 const f=exactOwnData(raw,[...selectorFields,...extra]);
 return f&&isTaskKey(f.projectId)&&Number.isInteger(f.revision)&&(f.revision as number)>=1&&(f.revision as number)<=20&&hash(f.planFingerprint)&&hash(f.sourceFingerprint)?f:null;
}
type Evidence=Awaited<ReturnType<typeof readApprovedProjectPlanningInTransaction>>;
function proposal(e:Evidence,projectId:string,actor:string){
 const milestoneId='backlog-'+roadmapFingerprint([projectId,e.revision,e.planFingerprint,e.sourceFingerprint]).slice(0,40);
 const tasks=e.plan.tasks.map(task=>{
  const mapping=e.mappings.find(m=>m.sourceId===task.id);if(!mapping)throw new Unavailable();
  const metadata=normalizeRoadmapMetadata({scope:task.scope,nonGoals:[],acceptanceCriteria:task.acceptanceCriteria,
   artifacts:['Policy requirement: Quality verification report','Policy requirement: independent Security review'],requiredQuality:true,requiredSecurity:true,approvalPolicy:'owner',
   changeEvidence:`Approved project plan revision ${e.revision}; plan ${e.planFingerprint}; source ${e.sourceFingerprint}; source task ${task.id}`});
  if(!metadata||metadata.scope.length!==task.scope.length||metadata.acceptanceCriteria.length!==task.acceptanceCriteria.length)throw new Conflict();
  const dependencyIds=task.dependencyIds.map(id=>{const dep=e.mappings.find(m=>m.sourceId===id);if(!dep)throw new Unavailable();return dep.taskId;}).sort();
  return Object.freeze({sourceId:task.id,taskId:mapping.taskId,dependencyIds:Object.freeze(dependencyIds),metadata,task});
 }).sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0);
 const intent=roadmapFingerprint(['pac.backlog-enrollment.v1',projectId,e.draftId,e.revision,e.planFingerprint,e.sourceFingerprint,actor,milestoneId,tasks]);
 return Object.freeze({milestoneId,tasks:Object.freeze(tasks),intent,commandId:'backlog-'+roadmapFingerprint([projectId,e.draftId]).slice(0,32),
  receipt:Object.freeze({status:'applied',kind:'project_backlog_enrollment',projectId,draftId:e.draftId,revision:e.revision,planFingerprint:e.planFingerprint,sourceFingerprint:e.sourceFingerprint,enrolledBy:actor,milestoneId,taskCount:tasks.length,dependencyCount:tasks.reduce((n,t)=>n+t.dependencyIds.length,0),mappingFingerprint:roadmapFingerprint(tasks)})});
}
type Proposal=ReturnType<typeof proposal>;
async function proposalFor(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,e:Evidence,projectId:string){
 const commandId='backlog-'+roadmapFingerprint([projectId,e.draftId]).slice(0,32);
 const saved=await client.query(`select result->>'enrolledBy' as actor from roadmap_owner_commands where workspace_id=$1 and command_id=$2`,[c.workspaceId,commandId]);
 const actor=saved.rowCount?saved.rows[0].actor:c.userId;
 if(saved.rowCount>1||typeof actor!=='string'||!(/^[a-f0-9-]{36}$/u.test(actor)))throw new Unavailable();
 // The original enrollment actor is immutable receipt evidence, independent of
 // current Owner authority. receipt() still verifies its full fingerprint/audit.
 return proposal(e,projectId,actor);
}

async function approved(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,f:Record<string,unknown>,authority?:Authority){
 const e=await readApprovedProjectPlanningInTransaction(client,c,f.projectId as string,f.revision as number,authority);
 if(e.planFingerprint!==f.planFingerprint||e.sourceFingerprint!==f.sourceFingerprint)throw new Conflict();
 return e;
}
async function receipt(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,tenant:ResolvedWorkflowRuntimeTenant,p:Proposal,projectId:string){
 const r=await replayRoadmapOwnerCommand(client,tenant,p.commandId,p.intent);if(!r)return null;
 if(roadmapFingerprint({...r,status:'applied'})!==roadmapFingerprint(p.receipt))throw new Unavailable();
 const audit=await client.query(`select actor_user_id::text,metadata from audit_events where workspace_id=$1 and entity_id=$2 and entity_type='project_planning_draft' and event_type='project.backlog_enrolled'`,[c.workspaceId,p.receipt.draftId]);
 if(audit.rowCount!==1||audit.rows[0].actor_user_id!==p.receipt.enrolledBy||roadmapFingerprint(audit.rows[0].metadata)!==roadmapFingerprint({projectId,revision:p.receipt.revision,milestoneId:p.milestoneId,intentFingerprint:p.intent,taskCount:p.tasks.length}))throw new Unavailable();
 const milestone=await client.query(`select milestone_key from roadmap_milestones where workspace_id=$1 and project_key=$2 and milestone_key=$3`,[c.workspaceId,projectId,p.milestoneId]);if(milestone.rowCount!==1)throw new Unavailable();
 const currentTasks=[];
 for(const t of p.tasks){
  const event=await client.query(`select intent_fingerprint,result_task,actor_user_id::text from roadmap_task_events where workspace_id=$1 and project_key=$2 and task_key=$3 and command_id=$4 and event_kind='enrolled' and previous_version=0 and next_version=1 and previous_status='draft' and next_status='draft'`,[c.workspaceId,projectId,t.taskId,'enroll-'+roadmapFingerprint([p.commandId,t.taskId]).slice(0,32)]);
  const expected={projectId,taskId:t.taskId,taskType:t.task.type,status:'draft',version:1,milestoneId:p.milestoneId,metadata:t.metadata,metadataFingerprint:roadmapFingerprint(t.metadata),dependencyIds:t.dependencyIds,priority:t.task.priority,risk:null};
  if(event.rowCount!==1||event.rows[0].actor_user_id!==p.receipt.enrolledBy||event.rows[0].intent_fingerprint!==roadmapFingerprint([p.intent,t.taskId])||roadmapFingerprint(event.rows[0].result_task)!==roadmapFingerprint(expected))throw new Unavailable();
  // Verify present lifecycle through its existing journal, without rewriting evolved tasks.
  const current=await readRoadmapTaskInTransaction(client,tenant,projectId,t.taskId);if(!current||current.milestoneId!==p.milestoneId)throw new Unavailable();
  currentTasks.push(current);
 }
 return {receipt:r,currentTasks:Object.freeze(currentTasks)};
}
async function currentFeaturePlan(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,tenant:ResolvedWorkflowRuntimeTenant,projectId:string,taskId:string){
 const plan=await readLatestRoadmapPlan(client,tenant,projectId,taskId);if(!plan)return null;
 const audit=await client.query(`select a.actor_user_id::text,a.metadata,p.created_by::text from project_task_feature_plans p join audit_events a on a.workspace_id=p.workspace_id and a.entity_id=p.id and a.entity_type='project_task_feature_plan' and a.event_type='task.feature_plan_revision_created' where p.workspace_id=$1 and p.project_key=$2 and p.task_key=$3 and p.plan_key=$4 and p.revision=$5`,[c.workspaceId,projectId,taskId,plan.planId,plan.revision]);
 if(audit.rowCount!==1||audit.rows[0].actor_user_id!==audit.rows[0].created_by||roadmapFingerprint(audit.rows[0].metadata)!==roadmapFingerprint({taskId,projectId,planId:plan.planId,revision:plan.revision,planFingerprint:plan.draftFingerprint,taskCount:plan.draft.tasks.length}))throw new Unavailable();
 return plan;
}
export function createProjectRoadmapEnrollment(access:Access,authority?:Authority){
 async function mutate(f:Record<string,unknown>,work:(client:WorkflowRuntimeSqlClient,c:ProjectOwnerContext,tenant:ResolvedWorkflowRuntimeTenant,reconcile:boolean)=>Promise<Record<string,unknown>>){
  let completed=false;
  const result=await access.runActiveShare(f.projectId,async(client,c,tenant)=>{await lockRoadmapProject(client,tenant,f.projectId as string);const value=await work(client,c,tenant,false);completed=true;return value;});
  // The first connection is released. Reconcile by facts only; never repeat mutations.
  if(result.status==='unavailable'&&completed)return access.runActiveShare(f.projectId,async(client,c,tenant)=>{await lockRoadmapProject(client,tenant,f.projectId as string);return work(client,c,tenant,true);});
  return result;
 }
 return Object.freeze({
  preview(raw:unknown){const f=projectRoadmapSelector(raw);if(!f)return Promise.resolve({status:'invalid_input' as const});
   return access.runActiveShare(f.projectId,async(client,c,tenant)=>{
    if(c.project.status!=='active')throw new Unavailable();
    // Read an EXISTING guard only. Serialize the whole projection with legitimate
    // Roadmap graph/state writes without creating enrollment facts from preview.
    const guard=await client.query(`/* project-roadmap:preview-guard */ select project_key from roadmap_project_guards where workspace_id=$1 and project_key=$2 for share`,[c.workspaceId,f.projectId]);
    if(guard.rowCount>1)throw new Unavailable();
    const e=await approved(client,c,f,authority),p=await proposalFor(client,c,e,f.projectId as string);
    const enrolled=await receipt(client,c,tenant,p,f.projectId as string);
    if(enrolled&&guard.rowCount!==1)throw new Unavailable();
    const tasks=[];
    for(const t of p.tasks){
     const verified=enrolled?.currentTasks.find(task=>task.taskId===t.taskId);
     if(enrolled&&!verified)throw new Unavailable();
     let state:{status:string;version:number};
     if(verified)state={status:verified.status,version:verified.version};
     else{const q=await client.query(`select status,state_version from project_tasks where workspace_id=$1 and project_key=$2 and task_key=$3`,[c.workspaceId,f.projectId,t.taskId]);
      if(q.rowCount!==1||!isProjectTaskStatus(q.rows[0].status)||!Number.isSafeInteger(q.rows[0].state_version)||(q.rows[0].state_version as number)<0)throw new Unavailable();
      state={status:q.rows[0].status,version:q.rows[0].state_version as number};
     }
     const dependencyIds=verified?.dependencyIds??t.dependencyIds;
     const current=await currentFeaturePlan(client,c,tenant,f.projectId as string,t.taskId);
     const deps=await client.query(`/* project-roadmap:dependency-status */ select task_key,status from project_tasks where workspace_id=$1 and project_key=$2 and task_key=any($3::text[]) order by task_key`,[c.workspaceId,f.projectId,dependencyIds]);
     if(deps.rowCount!==dependencyIds.length||deps.rows.length!==dependencyIds.length||deps.rows.some(d=>!isTaskKey(d.task_key)||!isProjectTaskStatus(d.status)))throw new Unavailable();
     const predecessors=[...deps.rows].sort((a,b)=>(a.task_key as string)<(b.task_key as string)?-1:(a.task_key as string)>(b.task_key as string)?1:0);
     if(predecessors.some((d,index)=>d.task_key!==dependencyIds[index]))throw new Unavailable();
     tasks.push({sourceId:t.sourceId,taskId:t.taskId,originalDependencyIds:t.dependencyIds,dependencyIds,status:state.status,version:state.version,dependencies:predecessors.map(d=>({taskId:d.task_key as string,status:d.status as string})),featurePlan:current?{planId:current.planId,revision:current.revision,fingerprint:current.draftFingerprint}:null});
    }
    return {projectId:f.projectId as string,revision:e.revision,planFingerprint:e.planFingerprint,sourceFingerprint:e.sourceFingerprint,origin:e.origin,milestoneId:p.milestoneId,taskCount:p.tasks.length,dependencyCount:tasks.reduce((n,t)=>n+t.dependencyIds.length,0),originalDependencyCount:p.receipt.dependencyCount,previewFingerprint:p.intent,enrolled:!!enrolled,tasks};
   });
  },
  enroll(raw:unknown){const f=projectRoadmapSelector(raw,['previewFingerprint']);if(!f||!hash(f.previewFingerprint))return Promise.resolve({status:'invalid_input' as const});
   return mutate(f,async(client,c,tenant,reconcile)=>{
    const e=await approved(client,c,f,authority),p=await proposalFor(client,c,e,f.projectId as string);if(p.intent!==f.previewFingerprint)throw new Conflict();
    const replay=await receipt(client,c,tenant,p,f.projectId as string);if(replay)return replay.receipt;if(reconcile)throw new Unavailable();
    for(const t of p.tasks){const q=await client.query(`/* project-roadmap:task-lock */ select title,goal,task_type,priority,risk_level,status,state_version,milestone_key,roadmap_metadata,roadmap_metadata_fingerprint from project_tasks where workspace_id=$1 and project_key=$2 and task_key=$3 for update nowait`,[c.workspaceId,f.projectId,t.taskId]);const row=q.rows[0];
     if(q.rowCount!==1||row.status!=='draft'||row.state_version!==0||row.milestone_key!==null||row.roadmap_metadata!==null||row.roadmap_metadata_fingerprint!==null||row.risk_level!==null||row.title!==t.task.title||row.goal!==t.task.goal||row.task_type!==t.task.type||row.priority!==t.task.priority)throw new Conflict();
    }
    const graph=await client.query(`select t.task_key,t.status,t.priority,coalesce(array_agg(d.dependency_task_key order by d.dependency_task_key) filter(where d.dependency_task_key is not null),'{}') deps from project_tasks t left join roadmap_task_dependencies d on d.workspace_id=t.workspace_id and d.project_key=t.project_key and d.task_key=t.task_key where t.workspace_id=$1 and t.project_key=$2 group by t.task_key,t.status,t.priority order by t.task_key limit 257`,[c.workspaceId,f.projectId]);
    if(!validateRoadmapGraph(graph.rows.map(r=>({taskId:r.task_key as string,status:r.status as ProjectTaskStatus,priority:r.priority as string|null,dependencyIds:p.tasks.find(t=>t.taskId===r.task_key)?.dependencyIds??r.deps as string[]}))))throw new Conflict();
    await client.query(`insert into roadmap_milestones(workspace_id,project_key,milestone_key,title,goal,status,priority) values($1,$2,$3,$4,'Explicit Owner enrollment of approved project backlog','active',0)`,[c.workspaceId,f.projectId,p.milestoneId,e.plan.title]);
    for(const t of p.tasks)await enrollRoadmapTaskInTransaction(client,tenant,{commandId:'enroll-'+roadmapFingerprint([p.commandId,t.taskId]).slice(0,32),projectId:f.projectId as string,taskId:t.taskId,expectedVersion:0,milestoneId:p.milestoneId},roadmapFingerprint([p.intent,t.taskId]),t.metadata,t.dependencyIds,c.userId);
    const audited=await client.query(`/* project-roadmap:audit */ insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,'project.backlog_enrolled','project_planning_draft',$3,$4::jsonb)`,[c.workspaceId,c.userId,e.draftId,JSON.stringify({projectId:f.projectId,revision:e.revision,milestoneId:p.milestoneId,intentFingerprint:p.intent,taskCount:p.tasks.length})]);
    if(audited.rowCount!==1)throw new Unavailable();
    await recordRoadmapOwnerCommand(client,tenant,p.commandId,p.intent,p.receipt);return p.receipt;
   });
  },
  ready(raw:unknown){const f=projectRoadmapSelector(raw,['previewFingerprint','taskId','expectedVersion','featurePlanId','featurePlanRevision','featurePlanFingerprint']);
   if(!f||!hash(f.previewFingerprint)||!isTaskKey(f.taskId)||!isTaskKey(f.featurePlanId)||!hash(f.featurePlanFingerprint)||!Number.isSafeInteger(f.expectedVersion)||(f.expectedVersion as number)<1||!Number.isSafeInteger(f.featurePlanRevision)||(f.featurePlanRevision as number)<1)return Promise.resolve({status:'invalid_input' as const});
   return mutate(f,async(client,c,tenant,reconcile)=>{
    const e=await approved(client,c,f,authority),p=await proposalFor(client,c,e,f.projectId as string);if(p.intent!==f.previewFingerprint||!p.tasks.some(t=>t.taskId===f.taskId)||!await receipt(client,c,tenant,p,f.projectId as string))throw new Conflict();
    const commandId='ready-'+roadmapFingerprint([f.projectId,f.taskId,f.expectedVersion]).slice(0,32),intent=roadmapFingerprint(['pac.backlog-ready.v1',c.userId,f]);
    const replay=await replayRoadmapOwnerCommand(client,tenant,commandId,intent);
    if(replay){
     const expected={status:'replayed',kind:'project_backlog_ready',projectId:f.projectId,taskId:f.taskId,milestoneId:p.milestoneId,version:(f.expectedVersion as number)+1,featurePlanId:f.featurePlanId,featurePlanRevision:f.featurePlanRevision,featurePlanFingerprint:f.featurePlanFingerprint};
     const events=await client.query(`select e.intent_fingerprint,e.actor_user_id::text,e.result_task,p.plan_fingerprint from roadmap_task_events e join project_task_feature_plans p on p.workspace_id=e.workspace_id and p.project_key=e.project_key and p.task_key=e.task_key and p.plan_key=$4 and p.revision=$5 where e.workspace_id=$1 and e.project_key=$2 and e.task_key=$3 and e.command_id=$6 and e.previous_version=$7 and e.next_version=$7+1 and e.previous_status='draft' and e.next_status='ready' and e.event_kind='state_changed'`,[c.workspaceId,f.projectId,f.taskId,f.featurePlanId,f.featurePlanRevision,commandId,f.expectedVersion]);
     const event=events.rows[0],task=event?.result_task as Record<string,unknown>|undefined;
     if(roadmapFingerprint(replay)!==roadmapFingerprint(expected)||events.rowCount!==1||event.intent_fingerprint!==intent||event.actor_user_id!==c.userId||event.plan_fingerprint!==f.featurePlanFingerprint||task?.taskId!==f.taskId||task?.milestoneId!==p.milestoneId||task?.status!=='ready'||task?.version!==(f.expectedVersion as number)+1)throw new Unavailable();
     return replay;
    }
    if(reconcile)throw new Unavailable();
    // FeaturePlan's task-first path may queue project SHARE behind an unrelated
    // project UPDATE. Never wait on its task while holding our project SHARE.
    const taskLock=await client.query(`/* project-roadmap:ready-task-lock */ select task_key from project_tasks where workspace_id=$1 and project_key=$2 and task_key=$3 for update nowait`,[c.workspaceId,f.projectId,f.taskId]);
    if(taskLock.rowCount!==1)throw new Unavailable();
    const task=await readRoadmapTaskInTransaction(client,tenant,f.projectId as string,f.taskId as string,true);if(!task||task.status!=='draft'||task.version!==f.expectedVersion||task.milestoneId!==p.milestoneId)throw new Conflict();
    const milestone=await client.query(`select milestone_key from roadmap_milestones where workspace_id=$1 and project_key=$2 and milestone_key=$3 and status='active' for share`,[c.workspaceId,f.projectId,p.milestoneId]);if(milestone.rowCount!==1)throw new Conflict();
    const plan=await currentFeaturePlan(client,c,tenant,f.projectId as string,f.taskId as string);if(!plan||plan.planId!==f.featurePlanId||plan.revision!==f.featurePlanRevision||plan.draftFingerprint!==f.featurePlanFingerprint)throw new Conflict();
    const changed=await transitionRoadmapTaskInTransaction(client,tenant,{commandId,projectId:f.projectId as string,taskId:f.taskId as string,expectedVersion:f.expectedVersion as number},intent,task,'ready',c.userId);if(changed.status!=='applied')throw new Conflict();
    const result={status:'applied',kind:'project_backlog_ready',projectId:f.projectId,taskId:f.taskId,milestoneId:p.milestoneId,version:(f.expectedVersion as number)+1,featurePlanId:plan.planId,featurePlanRevision:plan.revision,featurePlanFingerprint:plan.draftFingerprint};
    await recordRoadmapOwnerCommand(client,tenant,commandId,intent,result);return result;
   });
  },
 });
}

export type ProjectRoadmapPreview=Extract<Awaited<ReturnType<ReturnType<typeof createProjectRoadmapEnrollment>['preview']>>,{status:'ok'}>['value'];
