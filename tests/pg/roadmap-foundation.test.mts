import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
const live=await import(new URL("./helpers/live-pg.ts",import.meta.url).href) as typeof import("./helpers/live-pg");
const fixture=await import(new URL("../fixtures/roadmap.mts",import.meta.url).href) as typeof import("../fixtures/roadmap.mts");
const own=await import(new URL("../../lib/roadmap/roadmap-owner-commands.ts",import.meta.url).href) as typeof import("../../lib/roadmap/roadmap-owner-commands");
const stores=await import(new URL("../../lib/db/roadmap-store.ts",import.meta.url).href) as typeof import("../../lib/db/roadmap-store");
const approvals=await import(new URL("../../lib/db/roadmap-approvals.ts",import.meta.url).href) as typeof import("../../lib/db/roadmap-approvals");
const mutations=await import(new URL("../../lib/tasks/owner-task-mutations.ts",import.meta.url).href) as typeof import("../../lib/tasks/owner-task-mutations");
const db=await live.useLiveDatabase("roadmap_foundation"),f=await fixture.roadmapFixture(db,"foundation");
const store=stores.createRoadmapStore({database:f.database,tenant:f.tenant}),requests=approvals.createRoadmapApprovalRequests({database:f.database,tenant:f.tenant});
// Factories accept only declared trusted fields; fixtures contain other helpful data.
const ownConfig={database:f.database,tenant:f.tenant,identitySource:f.identitySource};
const writer=own.createRoadmapOwnerCommands(ownConfig),decisionWriter=approvals.createRoadmapOwnerApprovalDecisions(ownConfig);
await writer.createMilestone({commandId:"milestone-main",projectId:"project-a",milestoneId:"milestone-main",title:"Main milestone",goal:"Bounded delivery",priority:1});
let seq=0;
async function enrolled(label:string,dependencies:readonly string[]=[],ready=true,withPlan=true){
  const t=await f.task(label,"feature",withPlan),r=await writer.enroll({commandId:`enroll-${label}`,projectId:t.projectId,taskId:t.taskId,expectedVersion:0,milestoneId:"milestone-main",metadata:fixture.roadmapMetadata(),dependencyIds:dependencies});
  assert.equal(r.status,"applied",JSON.stringify(r));
  if(ready){const s=await writer.changeState({commandId:`ready-${label}`,projectId:t.projectId,taskId:t.taskId,expectedVersion:1,nextStatus:"ready"});assert.equal(s.status,"applied",JSON.stringify(s));}
  return {...t,version:ready?2:1};
}
const command=(t:Readonly<{taskId:string;projectId:string;version:number}>,prefix="claim")=>({commandId:`${prefix}-${++seq}`,projectId:t.projectId,taskId:t.taskId,expectedVersion:t.version});
async function rejected(sql:string,values:unknown[]=[]){try{await db.admin.query(sql,values);return false;}catch{return true;}}

test("milestone Owner-only, one idempotent write/audit; changed intent conflicts",async()=>{
  const input={commandId:"milestone-proof",projectId:"project-a",milestoneId:"milestone-proof",title:"Proof",goal:"Goal",priority:2};
  assert.equal((await writer.createMilestone(input)).status,"applied");assert.equal((await writer.createMilestone(input)).status,"replayed");assert.equal((await writer.createMilestone({...input,title:"Changed"})).status,"conflict");
  const denied=own.createRoadmapOwnerCommands({...ownConfig,identitySource:{resolve:()=>({userId:"00000000-0000-4000-8000-000000000099"})}});
  assert.equal((await denied.createMilestone({...input,commandId:"denied-milestone"})).status,"unavailable");
  const trace=live.installQueryInterceptor();const reads:string[]=[];trace.observe(sql=>{if(sql.includes("roadmap"))reads.push(sql);});try{assert.equal((await denied.createMilestone(input)).status,"unavailable");assert.deepEqual(reads,[],"denied Owner must perform zero roadmap reads, including replay evidence");}finally{trace.restore();}
});
test("legacy tasks remain unenrolled/readable/manual, cannot claim",async()=>{
  const t=await f.task("manual");const row=(await db.admin.query(`select milestone_key,state_version,roadmap_metadata from project_tasks where workspace_id=$1 and task_key=$2`,[f.workspaceId,t.taskId])).rows[0];assert.deepEqual(row,{milestone_key:null,state_version:0,roadmap_metadata:null});assert.equal(await store.readTask(t.projectId,t.taskId),null);assert.equal((await store.claimReady({...command({...t,version:0})})).status,"unavailable");
});
test("enrollment metadata version/journal immutable and same command changed payload conflicts",async()=>{
  const t=await f.task("enrollment"),input={...command({...t,version:0},"enroll"),milestoneId:"milestone-main",metadata:fixture.roadmapMetadata(),dependencyIds:[]};
  const a=await writer.enroll(input),b=await writer.enroll(input);assert.equal(a.status,"applied");assert.equal(b.status,"replayed");if(a.status==="applied"&&b.status==="replayed")assert.deepEqual(a.task,b.task);
  assert.equal((await writer.enroll({...input,metadata:{...fixture.roadmapMetadata(),scope:["Changed scope"]}})).status,"conflict");
  assert.ok(await rejected(`update roadmap_task_events set next_status='running' where workspace_id=$1 and command_id=$2`,[f.workspaceId,input.commandId]));
});
test("trusted task class comes from persisted type; taskClass injection denied",async()=>{
  const t=await enrolled("injection");assert.equal((await store.claimReady({...command(t),taskClass:"repair"})).status,"invalid_input");assert.equal((await store.readTask(t.projectId,t.taskId))?.taskType,"feature");
});
test("atomic claim across independent stores: exactly one winner/event",async()=>{
  const t=await enrolled("race"),other=stores.createRoadmapStore({database:f.database,tenant:f.tenant}),a=command(t,"race-a"),b=command(t,"race-b");
  const results=await Promise.all([store.claimReady(a),other.claimReady(b)]);assert.deepEqual(results.map(r=>r.status).sort(),["applied","conflict"]);
  assert.equal((await store.readTask(t.projectId,t.taskId))?.version,3);
  assert.equal((await db.admin.query(`select count(*)::int n from roadmap_task_events where workspace_id=$1 and task_key=$2 and event_kind='claimed'`,[f.workspaceId,t.taskId])).rows[0].n,1);
});
test("claim replay exact snapshot, stale CAS and changed command intent rejected",async()=>{
  const t=await enrolled("replay"),c=command(t),a=await store.claimReady(c),b=await store.claimReady(c);assert.equal(a.status,"applied");assert.equal(b.status,"replayed");if(a.status==="applied"&&b.status==="replayed")assert.deepEqual(a.task,b.task);
  assert.equal((await store.claimReady({...c,expectedVersion:999})).status,"conflict");assert.equal((await store.claimReady(command(t))).status,"conflict");
});
test("stale expected version while task still ready never claims",async()=>{const t=await enrolled("stale-ready");assert.equal((await store.claimReady({...command(t),expectedVersion:999})).status,"conflict");assert.equal((await store.readTask(t.projectId,t.taskId))?.version,2);});
test("dependency incomplete/failed/recovery_required blocks claim; no event",async()=>{
  for(const status of ["draft","failed","recovery_required"]){const dep=await f.task(`dep-${status}`);if(status!=="draft")await db.admin.query(`update project_tasks set status=$3 where workspace_id=$1 and task_key=$2`,[f.workspaceId,dep.taskId,status]);const t=await enrolled(`dependent-${status}`,[dep.taskId]);assert.equal((await store.claimReady(command(t))).status,"blocked");assert.equal((await store.readTask(t.projectId,t.taskId))?.status,"ready");}
});
test("completed dependency permits claim; ready missing plan is claimed without invented approval",async()=>{
  const dep=await f.task("dep-done");await db.admin.query(`update project_tasks set status='completed',completed_at=now() where workspace_id=$1 and task_key=$2`,[f.workspaceId,dep.taskId]);
  const t=await enrolled("dep-pass",[dep.taskId],true,false);assert.equal((await store.claimReady(command(t))).status,"applied");
  assert.equal((await db.admin.query(`select count(*)::int n from roadmap_approval_bindings where workspace_id=$1 and task_key=$2`,[f.workspaceId,t.taskId])).rows[0].n,0);
});
test("service rejects dependency cycle without partial version or edge change",async()=>{
  const a=await enrolled("cycle-a",[],false),b=await enrolled("cycle-b",[a.taskId],false);
  const result=await writer.enroll({...command(a,"cycle"),milestoneId:"milestone-main",metadata:fixture.roadmapMetadata(),dependencyIds:[b.taskId]});assert.equal(result.status,"conflict");assert.deepEqual((await store.readTask(a.projectId,a.taskId))?.dependencyIds,[]);assert.equal((await store.readTask(a.projectId,a.taskId))?.version,1);
});
test("same-project and tenant dependency integrity enforced by DB/service",async()=>{
  const t=await enrolled("isolation",[],false);await db.admin.query(`insert into project_tasks(workspace_id,project_key,task_key,title,task_type,status) values($1,'project-b','foreign-task','Foreign','feature','draft')`,[f.workspaceId]);
  assert.equal((await writer.enroll({...command(t,"foreign"),milestoneId:"milestone-main",metadata:fixture.roadmapMetadata(),dependencyIds:["foreign-task"]})).status,"conflict");
  assert.ok(await rejected(`insert into roadmap_task_dependencies(workspace_id,project_key,task_key,dependency_task_key) values($1,'project-a',$2,'foreign-task')`,[f.workspaceId,t.taskId]));
  const foreign=await fixture.roadmapFixture(db,"foreign");assert.equal(await stores.createRoadmapStore({database:foreign.database,tenant:foreign.tenant}).readTask(t.projectId,t.taskId),null);
});
test("direct SQL dependency mutation requires fresh same-transaction task journal/version",async()=>{
  const dep=await f.task("sql-dep"),t=await enrolled("sql-edges",[],false);
  assert.ok(await rejected(`insert into roadmap_task_dependencies(workspace_id,project_key,task_key,dependency_task_key) values($1,'project-a',$2,$3)`,[f.workspaceId,t.taskId,dep.taskId]));
  assert.deepEqual((await store.readTask(t.projectId,t.taskId))?.dependencyIds,[]);
});
test("direct SQL state/version change without journal and enrolled INSERT both rejected",async()=>{
  const t=await enrolled("sql-state");assert.ok(await rejected(`update project_tasks set status='planning',state_version=state_version+1 where workspace_id=$1 and task_key=$2`,[f.workspaceId,t.taskId]));
  assert.ok(await rejected(`insert into project_tasks(workspace_id,project_key,task_key,title,task_type,status,state_version,milestone_key,roadmap_metadata,roadmap_metadata_fingerprint) select workspace_id,project_key,'injected','Injected','feature','completed',1,milestone_key,roadmap_metadata,roadmap_metadata_fingerprint from project_tasks where workspace_id=$1 and task_key=$2`,[f.workspaceId,t.taskId]));
});
test("paused project and blocked milestone cannot claim",async()=>{
  const t=await enrolled("inactive");await db.admin.query(`update roadmap_milestones set status='blocked' where workspace_id=$1 and milestone_key='milestone-main'`,[f.workspaceId]);assert.equal((await store.claimReady(command(t))).status,"blocked");await db.admin.query(`update roadmap_milestones set status='active' where workspace_id=$1 and milestone_key='milestone-main'`,[f.workspaceId]);
  await db.admin.query(`update projects set status='paused' where workspace_id=$1 and project_key='project-a'`,[f.workspaceId]);assert.equal((await store.claimReady(command(t))).status,"unavailable");await db.admin.query(`update projects set status='active' where workspace_id=$1 and project_key='project-a'`,[f.workspaceId]);
});
test("generic existing approval queue binds exact draft/materialized plan and Owner decision",async()=>{
  const t=await enrolled("approval"),claimed=await store.claimReady(command(t));assert.equal(claimed.status,"applied");const c=command({...t,version:3},"approval"),a=await requests.requestPlanApproval(c);assert.equal(a.status,"applied",JSON.stringify(a));if(a.status!=="applied")return;
  const row=(await db.admin.query(`select r.action_type,r.status,r.runtime_approval_id,b.plan_revision,b.expected_task_version,p.plan_json->>'status' draft_status from roadmap_approval_bindings b join approval_requests r on r.id=b.approval_request_id join project_task_feature_plans p on p.workspace_id=b.workspace_id and p.task_key=b.task_key and p.revision=b.plan_revision where b.workspace_id=$1 and b.approval_request_id=$2`,[f.workspaceId,a.approvalRequestId])).rows[0];assert.deepEqual(row,{action_type:"development_feature_plan_approval",status:"pending",runtime_approval_id:null,plan_revision:1,expected_task_version:3,draft_status:"draft"});
  const decision={...command({...t,version:3},"decision"),approvalRequestId:a.approvalRequestId,bindingFingerprint:a.bindingFingerprint,decision:"approved"};assert.equal((await decisionWriter.decide(decision)).status,"applied");assert.equal((await decisionWriter.decide(decision)).status,"replayed");
  const bound=await mutations.inTransaction(f.database,c=>approvals.readRoadmapPlanApproval(c,f.tenant,t.projectId,t.taskId,a.approvalRequestId,3));assert.ok(bound);assert.equal(bound.plan.status,"approved");assert.equal(bound.ownerActorId,f.ownerId);
});
test("concurrent duplicate approval creation/decision exactly once",async()=>{
  const t=await enrolled("approval-race"),c=command(t,"req-race"),other=approvals.createRoadmapApprovalRequests({database:f.database,tenant:f.tenant});const [a,b]=await Promise.all([requests.requestPlanApproval(c),other.requestPlanApproval({...c,commandId:`${c.commandId}-b`})]);assert.equal(a.status,"applied");assert.equal(b.status,"applied");if(a.status!=="applied"||b.status!=="applied")return;assert.equal(a.approvalRequestId,b.approvalRequestId);
  const d={...command(t,"dec-race"),approvalRequestId:a.approvalRequestId,bindingFingerprint:a.bindingFingerprint,decision:"approved"};const decisions=await Promise.all([decisionWriter.decide(d),decisionWriter.decide({...d,commandId:`${d.commandId}-b`,decision:"rejected"})]);assert.deepEqual(decisions.map(x=>x.status).sort(),["applied","conflict"]);
  assert.equal((await db.admin.query(`select count(*)::int n from approval_decisions where workspace_id=$1 and approval_request_id=$2`,[f.workspaceId,a.approvalRequestId])).rows[0].n,1);
});
test("task changed while approval pending invalidates Owner decision",async()=>{
  const t=await enrolled("stale-version"),a=await requests.requestPlanApproval(command(t,"req"));assert.ok(a.status==="applied");await store.claimReady(command(t));assert.equal((await decisionWriter.decide({...command({...t,version:3},"stale"),approvalRequestId:a.approvalRequestId,bindingFingerprint:a.bindingFingerprint,decision:"approved"})).status,"conflict");
});
test("latest plan revision invalidates historical pending approval even without task version change",async()=>{
  const t=await enrolled("stale-plan",[],false),a=await requests.requestPlanApproval(command(t,"req"));assert.ok(a.status==="applied");
  const saved=await f.planWriter.saveDraftRevision({idempotencyKey:"roadmap-stale-plan-next",taskId:t.taskId,plan:{...fixture.roadmapPlan(),title:"Changed exact revision"}});assert.equal(saved.status,"created");
  assert.equal((await decisionWriter.decide({...command(t,"stale-plan"),approvalRequestId:a.approvalRequestId,bindingFingerprint:a.bindingFingerprint,decision:"approved"})).status,"conflict");
});
test("Owner replanning returns claimed task to draft for existing immutable plan save",async()=>{
  const t=await enrolled("replan",[],true,false);await store.claimReady(command(t));assert.equal((await writer.changeState({...command({...t,version:3},"reset"),nextStatus:"draft"})).status,"applied");
  assert.equal((await f.planWriter.saveDraftRevision({idempotencyKey:"roadmap-replan-save",taskId:t.taskId,plan:fixture.roadmapPlan()})).status,"created");
});
test("lost COMMIT ACK reconciles by command evidence, no blind second write",async()=>{
  const t=await enrolled("lost-ack"),c=command(t,"lost-ack"),interceptor=live.installQueryInterceptor();let writes=0;interceptor.observe(sql=>{if(sql.includes("/* roadmap:project-lock */"))writes++;});try{
    interceptor.rules.push(live.rule("lost ACK",live.sqlTag("executor-transaction:commit"),async(_client,config,values,send)=>{await send(config,values);throw Error("simulated connection loss");}));
    const r=await store.claimReady(c);assert.equal(r.status,"replayed",JSON.stringify(r));assert.equal(interceptor.rules[0].fired,1);assert.equal(writes,1,"ambiguous ACK must only read evidence, not re-enter write work");assert.equal((await store.readTask(t.projectId,t.taskId))?.version,3);
  }finally{interceptor.restore();}
});
test("unknown commit outcome fails closed and produces no claim",async()=>{
  const t=await enrolled("unknown-ack"),interceptor=live.installQueryInterceptor();try{
    interceptor.rules.push(live.rule("lost before commit",live.sqlTag("executor-transaction:commit"),async()=>{throw Error("connection ambiguity");}));
    const r=await store.claimReady(command(t,"unknown-ack"));assert.equal(r.status,"recovery_required");assert.equal((await store.readTask(t.projectId,t.taskId))?.version,2);
  }finally{interceptor.restore();}
});
test("connection-class08 failure destroys the session even after successful ROLLBACK",async()=>{
  const t=await enrolled("connection08"),interceptor=live.installQueryInterceptor(),monitor=live.installReuseMonitor();try{
    interceptor.rules.push(live.rule("connection08",live.sqlTag("roadmap:task-read"),async()=>{throw live.serverError("08006");}));
    const d=await store.claimReady(command(t,"connection08"));assert.equal(d.status,"unavailable");assert.equal(interceptor.rules[0].fired,1);assert.ok(monitor.stats.destroyed>=1,"connection-class session must be destroyed, never released for reuse");assert.deepEqual(monitor.stats.violations,[]);
  }finally{monitor.restore();interceptor.restore();}
});
test("forged tenant config rejected, hostile mutation inputs do not execute getters",async()=>{
  assert.throws(()=>stores.createRoadmapStore({database:f.database,tenant:{...f.tenant}}));let calls=0;const c=Object.defineProperty({},"commandId",{get(){calls++;throw Error("secret");}});assert.equal((await store.claimReady(c)).status,"invalid_input");assert.equal(calls,0);
});
test("direct SQL generic approval cannot fake decision, actor, payload or immutable binding",async()=>{
  const t=await enrolled("approval-sql"),a=await requests.requestPlanApproval(command(t,"sql-request"));assert.ok(a.status==="applied");
  assert.ok(await rejected(`update approval_requests set status='approved',approved_by=$3,resolved_at=now() where workspace_id=$1 and id=$2`,[f.workspaceId,a.approvalRequestId,f.ownerId]));
  assert.ok(await rejected(`update approval_requests set original_payload='{}'::jsonb where workspace_id=$1 and id=$2`,[f.workspaceId,a.approvalRequestId]));
  assert.ok(await rejected(`update roadmap_approval_bindings set plan_revision=99 where workspace_id=$1 and approval_request_id=$2`,[f.workspaceId,a.approvalRequestId]));
});
test("migration0019 populated0018 preserves legacy task/plan rows and creates zero authority backfill",async t=>{
  const name=`aipc_pgtest_roadmap_upgrade_${randomUUID().replaceAll("-","")}`;await db.admin.query(`create database "${name}"`);const admin=live.adminClient(live.databaseUrl(name));await admin.connect();
  t.after(async()=>{await admin.end();await db.admin.query(`drop database "${name}" with(force)`);});
  const directory=new URL("../../db/migrations/",import.meta.url),files=readdirSync(directory).filter(x=>/^\d{4}_.*\.sql$/u.test(x)).sort();
  for(const name of files.slice(0,18))await admin.query(readFileSync(new URL(name,directory),"utf8"));
  await live.insertWorkspace(admin,live.primaryWorkspace);await admin.query(`insert into projects(workspace_id,project_key,display_name) values($1,'legacy','Legacy')`,[live.primaryWorkspace.id]);
  await admin.query(`insert into project_tasks(workspace_id,project_key,task_key,title,task_type,status) values($1,'legacy','legacy-task','Legacy intent','feature','draft')`,[live.primaryWorkspace.id]);
  const revision=await import(new URL("../../lib/development/feature-plan-revision.ts",import.meta.url).href) as typeof import("../../lib/development/feature-plan-revision"),normalized=revision.normalizeDraftPlan(fixture.roadmapPlan(),"plan-00000000000000000001");assert.ok(normalized.ok);
  await admin.query(`insert into project_task_feature_plans(workspace_id,project_key,task_key,plan_key,revision,plan_json,plan_fingerprint,creation_idempotency_key,creation_intent_fingerprint) values($1,'legacy','legacy-task',$2,1,$3::jsonb,$4,'legacy-plan-000000',$4)`,[live.primaryWorkspace.id,normalized.plan.id,JSON.stringify(normalized.plan),revision.featurePlanFingerprint(normalized.plan)]);
  const beforeTasks=(await admin.query(`select to_jsonb(t) value from project_tasks t`)).rows,beforePlans=(await admin.query(`select to_jsonb(t) value from project_task_feature_plans t`)).rows;
  await admin.query(readFileSync(new URL("0019_roadmap_foundation.sql",directory),"utf8"));
  assert.deepEqual((await admin.query(`select to_jsonb(t)-'milestone_key'-'state_version'-'roadmap_metadata'-'roadmap_metadata_fingerprint' value from project_tasks t`)).rows,beforeTasks);
  assert.deepEqual((await admin.query(`select to_jsonb(t) value from project_task_feature_plans t`)).rows,beforePlans);
  for(const table of ["roadmap_milestones","roadmap_task_dependencies","roadmap_task_events","roadmap_approval_bindings","roadmap_owner_commands"])assert.equal((await admin.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
  assert.deepEqual((await admin.query(`select milestone_key,state_version,roadmap_metadata from project_tasks`)).rows,[{milestone_key:null,state_version:0,roadmap_metadata:null}]);
});
