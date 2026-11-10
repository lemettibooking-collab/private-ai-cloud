import type { WorkflowRuntimeSqlClient } from "../db/workflow-runtime-store";
import type { ProjectOwnerContext, createProjectOwnerAccess } from "../projects/project-owner-access";
import type { ProjectPlan } from "./project-planning-contract";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { Conflict, Unavailable, exactOwnData, creationIntentFingerprint } from "../tasks/owner-task-mutations.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { timestamp } from "../tasks/project-task.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { isProjectKey } from "../projects/project-registry.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { isDocumentFilename, readProjectKnowledgeVersion } from "../projects/project-knowledge.ts";
// @ts-expect-error Direct Node TypeScript execution requires the extension.
import { planDigest, planningTaskKey, parseProjectPlanningDocument, validateProjectPlan, prepareProjectAIPlanning, projectAIPlanningCapability } from "./project-planning-contract.ts";

type Access = ReturnType<typeof createProjectOwnerAccess>;
type Row = Record<string,unknown>;
const hash = (v:unknown):v is string => typeof v==="string" && v.length===64 && /^[a-f0-9]{64}$/u.test(v);
function selector(input:unknown, fields:readonly string[]) {
  const f=exactOwnData(input,fields);
  return f&&isProjectKey(f.projectId)&&isDocumentFilename(f.filename)&&Number.isInteger(f.version)&&(f.version as number)>0&&(f.version as number)<=50&&hash(f.sourceSha256)?f:null;
}
const payload=(projectId:string,revision:number,planFingerprint:string,sourceFingerprint:string)=>({projectId,revision,planFingerprint,sourceFingerprint});
async function latestRevision(client:WorkflowRuntimeSqlClient,context:ProjectOwnerContext,projectId:string) {
  const rows=await client.query(`/* project-planning:latest */ select coalesce(max(revision),0)::int revision from project_planning_drafts where workspace_id=$1 and project_key=$2`,[context.workspaceId,projectId]);
  const n=rows.rows[0]?.revision;if(!Number.isInteger(n)||(n as number)<0||(n as number)>20)throw new Unavailable();return n as number;
}
async function source(client:WorkflowRuntimeSqlClient,context:ProjectOwnerContext,projectId:string,filename:string,version:number,sha256:string) {
  const value=await readProjectKnowledgeVersion(client,context,projectId,filename,version);
  if(value.document.sha256!==sha256)throw new Conflict();
  const id=await client.query(`/* project-planning:source */ select id::text from knowledge_documents where workspace_id=$1 and project_key=$2 and filename=$3 and status='active'`,[context.workspaceId,projectId,filename]);
  if(id.rowCount!==1)throw new Unavailable();
  return {documentId:id.rows[0].id,filename,version,sha256,content:value.content};
}
async function evidence(client:WorkflowRuntimeSqlClient,context:ProjectOwnerContext,row:Row,event:string) {
  const audit=await client.query(`/* project-planning:audit-read */ select actor_user_id::text,metadata from audit_events where workspace_id=$1 and event_type=$2 and entity_type='project_planning_draft' and entity_id=$3::uuid limit 2 for share`,[context.workspaceId,event,row.id]);
  const metadata=exactOwnData(audit.rows[0]?.metadata,["projectId","revision","planFingerprint","sourceFingerprint"]);
  if(audit.rowCount!==1||!metadata||Object.entries(payload(row.project_key as string,row.revision as number,row.plan_fingerprint as string,row.source_fingerprint as string)).some(([k,v])=>metadata[k]!==v))throw new Unavailable();
  return audit.rows[0].actor_user_id;
}
async function audit(client:WorkflowRuntimeSqlClient,context:ProjectOwnerContext,row:Row,event:string) {
  const inserted=await client.query(`/* project-planning:audit */ insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,$3,'project_planning_draft',$4::uuid,$5::jsonb) returning id`,[context.workspaceId,context.userId,event,row.id,JSON.stringify(payload(row.project_key as string,row.revision as number,row.plan_fingerprint as string,row.source_fingerprint as string))]);
  if(inserted.rowCount!==1)throw new Unavailable();
}
async function validateStored(client:WorkflowRuntimeSqlClient,context:ProjectOwnerContext,row:Row) {
  const original=await source(client,context,row.project_key as string,row.source_filename as string,row.source_version as number,row.source_sha256 as string);
  const parsed=parseProjectPlanningDocument(original.content,original.filename);
  if(original.documentId!==row.source_document_id||!parsed.plan||planDigest(parsed.plan)!==row.plan_fingerprint||planDigest(validateProjectPlan(row.plan_json).plan)!==row.plan_fingerprint
    ||row.source_fingerprint!==planDigest([row.project_key,original.filename,original.version,original.sha256]))throw new Unavailable();
  if(await evidence(client,context,row,"project.plan_draft_saved")!==row.created_by)throw new Unavailable();
  return parsed.plan;
}
async function requestEvidence(client:WorkflowRuntimeSqlClient,context:ProjectOwnerContext,row:Row,write=true) {
  const r=await client.query(`/* project-planning:request */ select * from approval_requests where workspace_id=$1 and id=$2::uuid for ${write?"update":"share"}`,[context.workspaceId,row.approval_request_id]);
  const a=r.rows[0];const original=exactOwnData(a?.original_payload,["projectId","revision","planFingerprint","sourceFingerprint"]);
  if(r.rowCount!==1||a.action_type!=="project_plan_activation"||a.workflow_run_id!==null||a.requested_by!==row.created_by||!original
    ||Object.entries(payload(row.project_key as string,row.revision as number,row.plan_fingerprint as string,row.source_fingerprint as string)).some(([k,v])=>original[k]!==v)
    ||JSON.stringify(a.allowed_approver_role_codes)!==JSON.stringify(["owner"]))throw new Unavailable();
  const pending=row.status==="draft"&&a.status==="pending"&&a.approved_by===null&&a.rejected_by===null&&a.resolved_at===null;
  const approved=row.status==="approved"&&a.status==="approved"&&typeof a.approved_by==="string"&&a.rejected_by===null&&timestamp(a.resolved_at)!==null;
  const rejected=row.status==="rejected"&&a.status==="rejected"&&typeof a.rejected_by==="string"&&a.approved_by===null&&timestamp(a.resolved_at)!==null;
  if(!pending&&!approved&&!rejected)throw new Unavailable();
  return a;
}
export function createProjectPlanning(access:Access) {
  return Object.freeze({
    sources(projectId:unknown){return access.run(projectId,false,async(client,context)=>{
      const rows=await client.query(`/* project-planning:sources */ select d.filename,v.version,v.sha256 from knowledge_documents d join knowledge_document_versions v on v.workspace_id=d.workspace_id and v.document_id=d.id where d.workspace_id=$1 and d.project_key=$2 and d.status='active' order by d.filename,v.version desc limit 5001`,[context.workspaceId,projectId]);
      if(rows.rowCount>5000||rows.rows.some(r=>!isDocumentFilename(r.filename)||!Number.isInteger(r.version)||Number(r.version)<1||Number(r.version)>50||!hash(r.sha256)))throw new Unavailable();
      return Object.freeze(rows.rows.map(r=>Object.freeze({filename:r.filename as string,version:r.version as number,sha256:r.sha256 as string})));
    });},
    preview(raw:unknown){
      const f=selector(raw,["projectId","filename","version","sourceSha256"]);if(!f)return Promise.resolve({status:"invalid_input" as const});
      return access.run(f.projectId,false,async(client,context)=>{
        const s=await source(client,context,f.projectId as string,f.filename as string,f.version as number,f.sourceSha256 as string);
        const validation=parseProjectPlanningDocument(s.content,s.filename);const sourceFingerprint=planDigest([f.projectId,s.filename,s.version,s.sha256]);
        return Object.freeze({validation,source:Object.freeze({filename:s.filename,version:s.version,sha256:s.sha256}),sourceFingerprint,
          previewFingerprint:planDigest([sourceFingerprint,validation.plan]),expectedRevision:await latestRevision(client,context,f.projectId as string)});
      });
    },
    save(raw:unknown){
      const f=selector(raw,["projectId","filename","version","sourceSha256","previewFingerprint","expectedRevision"]);
      if(!f||!hash(f.previewFingerprint)||!Number.isInteger(f.expectedRevision)||(f.expectedRevision as number)<0||(f.expectedRevision as number)>20)return Promise.resolve({status:"invalid_input" as const});
      return access.run(f.projectId,true,async(client,context)=>{
        const s=await source(client,context,f.projectId as string,f.filename as string,f.version as number,f.sourceSha256 as string);
        const parsed=parseProjectPlanningDocument(s.content,s.filename);const sf=planDigest([f.projectId,s.filename,s.version,s.sha256]);
        if(!parsed.plan||planDigest([sf,parsed.plan])!==f.previewFingerprint)throw new Conflict();
        const pf=planDigest(parsed.plan);
        const replay=await client.query(`/* project-planning:save-replay */ select * from project_planning_drafts where workspace_id=$1 and project_key=$2 and source_fingerprint=$3`,[context.workspaceId,f.projectId,sf]);
        if(replay.rowCount){const row=replay.rows[0],stored=await validateStored(client,context,row);await validateDecision(client,context,row,stored,true);if(row.plan_fingerprint!==pf||row.created_by!==context.userId)throw new Conflict();return {outcome:"replayed" as const,revision:row.revision as number};}
        const current=await latestRevision(client,context,f.projectId as string);if(current!==f.expectedRevision||current>=20)throw new Conflict();
        const revision=current+1;
        const request=await client.query(`/* project-planning:approval-create */ insert into approval_requests(workspace_id,action_type,status,risk_level,requested_by,allowed_approver_role_codes,original_payload) values($1,'project_plan_activation','pending','medium',$2,array['owner'],$3::jsonb) returning id::text`,[context.workspaceId,context.userId,JSON.stringify(payload(f.projectId as string,revision,pf,sf))]);
        if(request.rowCount!==1)throw new Unavailable();
        const inserted=await client.query(`/* project-planning:save */ insert into project_planning_drafts(workspace_id,project_key,revision,source_document_id,source_filename,source_version,source_sha256,source_fingerprint,plan_json,plan_fingerprint,approval_request_id,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) returning *`,[context.workspaceId,f.projectId,revision,s.documentId,s.filename,s.version,s.sha256,sf,JSON.stringify(parsed.plan),pf,request.rows[0].id,context.userId]);
        if(inserted.rowCount!==1)throw new Unavailable();await audit(client,context,inserted.rows[0],"project.plan_draft_saved");return {outcome:"saved" as const,revision};
      });
    },
    read(projectId:unknown,revision?:unknown){
      if(revision!==undefined&&(!Number.isInteger(revision)||(revision as number)<1||(revision as number)>20))return Promise.resolve({status:"invalid_input" as const});
      return access.run(projectId,false,async(client,context)=>{
        const rows=await client.query(`/* project-planning:read */ select * from project_planning_drafts where workspace_id=$1 and project_key=$2 order by revision desc limit 21`,[context.workspaceId,projectId]);
        if(rows.rowCount>20)throw new Unavailable();
        const row=rows.rows.find(r=>r.revision===(revision??rows.rows[0]?.revision));
        if(!row&&revision!==undefined)throw new Unavailable();
        const plan=row?await validateStored(client,context,row):null;
        if(row&&plan)await validateDecision(client,context,row,plan,false);
        return Object.freeze({history:Object.freeze(rows.rows.map(r=>Object.freeze({revision:r.revision as number,status:r.status as string}))),latestRevision:rows.rows[0]?.revision as number??0,
          selected:row&&plan?Object.freeze({revision:row.revision as number,status:row.status as "draft"|"approved"|"rejected",plan,planFingerprint:row.plan_fingerprint as string,sourceFingerprint:row.source_fingerprint as string,source:Object.freeze({filename:row.source_filename as string,version:row.source_version as number,sha256:row.source_sha256 as string}),tasks:Object.freeze(plan.tasks.map(t=>({sourceId:t.id,taskId:planningTaskKey(projectId as string,t.id)})))}):null});
      });
    },
    decide(raw:unknown){
      const f=exactOwnData(raw,["projectId","revision","planFingerprint","decision"]);
      if(!f||!isProjectKey(f.projectId)||!Number.isInteger(f.revision)||(f.revision as number)<1||(f.revision as number)>20||!hash(f.planFingerprint)||!["approved","rejected"].includes(f.decision as string))return Promise.resolve({status:"invalid_input" as const});
      return access.run(f.projectId,true,async(client,context)=>{
        const selected=await client.query(`/* project-planning:decision-lock */ select * from project_planning_drafts where workspace_id=$1 and project_key=$2 and revision=$3 for update`,[context.workspaceId,f.projectId,f.revision]);
        if(selected.rowCount!==1)throw new Unavailable();const row=selected.rows[0];const plan=await validateStored(client,context,row);
        if(row.plan_fingerprint!==f.planFingerprint)throw new Conflict();const request=await requestEvidence(client,context,row);
        const actor=await validateDecision(client,context,row,plan,true);
        if(row.status!=="draft"){
          if(row.status!==f.decision||actor!==context.userId)throw new Conflict();
          return {outcome:"replayed" as const,revision:row.revision as number};
        }
        if(request.status!=="pending"||(f.decision==="approved"&&await latestRevision(client,context,f.projectId as string)!==f.revision))throw new Conflict();
        if(f.decision==="approved"){
          const active=await client.query(`/* project-planning:active */ select id from project_planning_drafts where workspace_id=$1 and project_key=$2 and status='approved'`,[context.workspaceId,f.projectId]);if(active.rowCount)throw new Conflict();
          for(const task of plan.tasks)await materialize(client,context,f.projectId as string,row,task);
        }
        await client.query(`/* project-planning:approval-decision */ insert into approval_decisions(workspace_id,approval_request_id,decision,decided_by_actor_id,command_id) values($1,$2,$3,$4,$5)`,[context.workspaceId,row.approval_request_id,f.decision,context.userId,`plan-${(row.plan_fingerprint as string).slice(0,30)}`]);
        await client.query(`/* project-planning:approval-resolve */ update approval_requests set status=$3,resolved_at=now(),approved_by=case when $3='approved' then $4::uuid else null end,rejected_by=case when $3='rejected' then $4::uuid else null end where workspace_id=$1 and id=$2::uuid and status='pending'`,[context.workspaceId,row.approval_request_id,f.decision,context.userId]);
        const updated=await client.query(`/* project-planning:decision */ update project_planning_drafts set status=$4 where workspace_id=$1 and project_key=$2 and revision=$3 and status='draft' returning id`,[context.workspaceId,f.projectId,f.revision,f.decision]);if(updated.rowCount!==1)throw new Conflict();
        await audit(client,context,row,`project.plan_${f.decision}`);return {outcome:f.decision as "approved"|"rejected",revision:row.revision as number};
      });
    },
    prepareAI(raw:unknown){
      const f=selector(raw,["projectId","filename","version","sourceSha256"]);if(!f)return Promise.resolve({status:"invalid_input" as const});
      return access.run(f.projectId,false,async(client,context)=>{
        const s=await source(client,context,f.projectId as string,f.filename as string,f.version as number,f.sourceSha256 as string);
        const prepared=prepareProjectAIPlanning([{filename:s.filename,version:s.version,sha256:s.sha256,content:s.content}]);
        return Object.freeze({capability:projectAIPlanningCapability,source:Object.freeze({filename:s.filename,version:s.version,sha256:s.sha256}),requestFingerprint:prepared.fingerprint});
      });
    },
  });
}
async function materialize(client:WorkflowRuntimeSqlClient,context:ProjectOwnerContext,projectId:string,row:Row,task:ProjectPlan["tasks"][number]) {
  const taskKey=planningTaskKey(projectId,task.id),key=`planning:${planDigest([projectId,task.id])}`;
  const fp=creationIntentFingerprint({projectId,title:task.title,goal:task.goal,type:task.type,priority:task.priority,riskLevel:null});
  const inserted=await client.query(`/* project-planning:create-task */ insert into project_tasks(workspace_id,project_key,task_key,title,goal,task_type,status,priority,created_by,creation_idempotency_key,creation_intent_fingerprint) values($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10) returning id::text`,[context.workspaceId,projectId,taskKey,task.title,task.goal,task.type,task.priority,context.userId,key,fp]);
  if(inserted.rowCount!==1)throw new Unavailable();
  await client.query(`/* project-planning:task-link */ insert into project_planning_task_links(workspace_id,project_key,draft_id,source_task_id,task_key) values($1,$2,$3,$4,$5)`,[context.workspaceId,projectId,row.id,task.id,taskKey]);
  const audit=await client.query(`/* project-planning:task-audit */ insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata) values($1,$2,'task.created','project_task',$3::uuid,$4::jsonb) returning id`,[context.workspaceId,context.userId,inserted.rows[0].id,JSON.stringify({taskId:taskKey,projectId})]);if(audit.rowCount!==1)throw new Unavailable();
}
async function validateDecision(client:WorkflowRuntimeSqlClient,context:ProjectOwnerContext,row:Row,plan:ProjectPlan,write:boolean) {
  const request=await requestEvidence(client,context,row,write);
  const decisions=await client.query(`/* project-planning:decision-evidence */ select decision,decided_by_actor_id from approval_decisions where workspace_id=$1 and approval_request_id=$2`,[context.workspaceId,row.approval_request_id]);
  const links=await client.query(`/* project-planning:links */ select l.source_task_id,l.task_key,t.id::text as task_id,t.creation_idempotency_key,t.creation_intent_fingerprint from project_planning_task_links l join project_tasks t on t.workspace_id=l.workspace_id and t.project_key=l.project_key and t.task_key=l.task_key where l.workspace_id=$1 and l.project_key=$2 and l.draft_id=$3`,[context.workspaceId,row.project_key,row.id]);
  if(row.status==="draft"){if(request.status!=="pending"||decisions.rowCount||links.rowCount)throw new Unavailable();return null;}
  const actor=decisions.rows[0]?.decided_by_actor_id;
  if(!["approved","rejected"].includes(row.status as string)||request.status!==row.status||decisions.rowCount!==1||decisions.rows[0].decision!==row.status||request.resolved_at===null||await evidence(client,context,row,`project.plan_${row.status}`)!==actor
    ||(row.status==="approved"?request.approved_by:request.rejected_by)!==actor)throw new Unavailable();
  if(row.status==="rejected"){if(links.rowCount)throw new Unavailable();return actor;}
  if(links.rowCount!==plan.tasks.length)throw new Unavailable();
  for(const task of plan.tasks){const link=links.rows.find(l=>l.source_task_id===task.id);
    const expected=creationIntentFingerprint({projectId:row.project_key as string,title:task.title,goal:task.goal,type:task.type,priority:task.priority,riskLevel:null});
    if(!link||link.task_key!==planningTaskKey(row.project_key as string,task.id)||link.creation_idempotency_key!==`planning:${planDigest([row.project_key,task.id])}`||link.creation_intent_fingerprint!==expected)throw new Unavailable();
    const created=await client.query(`/* project-planning:task-audit-read */ select actor_user_id::text,metadata from audit_events where workspace_id=$1 and event_type='task.created' and entity_type='project_task' and entity_id=$2::uuid limit 2 for share`,[context.workspaceId,link.task_id]);
    const metadata=exactOwnData(created.rows[0]?.metadata,["taskId","projectId"]);
    if(created.rowCount!==1||created.rows[0].actor_user_id!==actor||metadata?.taskId!==link.task_key||metadata.projectId!==row.project_key)throw new Unavailable();
  }
  return actor;
}
