import type { WorkflowRuntimeSqlClient } from './workflow-runtime-store';
import type { ProjectOwnerContext } from '../projects/project-owner-access';
import type { ProjectGenerationPolicy } from '../composition/project-planning-generation-config';
// @ts-expect-error Direct Node execution requires extension.
import { lockOpenAIApiDailyBudget } from './openai-api-daily-budget.ts';
// @ts-expect-error Direct Node execution requires extension.
import { openAIApiMaximumCost } from '../integrations/openai-api/openai-api-policy.ts';
const fact=(v:unknown)=>{if(!v)throw Error('planning_api_unavailable');};
async function clock(c:WorkflowRuntimeSqlClient){const q=await c.query(`select (clock_timestamp() at time zone 'UTC')::date::text as day`);fact(q.rowCount===1);return q.rows[0].day as string;}
async function audit(c:WorkflowRuntimeSqlClient,o:ProjectOwnerContext,id:unknown,state:string,reserved:number,actual?:number){await c.query(`insert into audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,metadata)values($1,$2,$3,'project_planning_generation',$4,$5::jsonb)`,[o.workspaceId,o.userId,'project.planning_api_'+state,id,JSON.stringify({reservedCostUsdMicros:reserved,...(actual===undefined?{}:{actualCostUsdMicros:actual})})]);}
export async function reservePlanningApi(c:WorkflowRuntimeSqlClient,o:ProjectOwnerContext,row:Record<string,unknown>,p:ProjectGenerationPolicy){
 const a=p.api;fact(a);const maximum=openAIApiMaximumCost(a!.limits,a!.pricing,a!.limits.maxInputTokens,Date.now());fact(maximum);
 const reserved=maximum!.maximumCostUsdMicros+a!.maxPreflightCostUsdMicros;fact(reserved<=a!.limits.maxInvocationCostUsdMicros);
 const day=await clock(c),used=await lockOpenAIApiDailyBudget(c,o.workspaceId,day,a!.limits.dailyBudgetUsdMicros);fact(used+reserved<=a!.limits.dailyBudgetUsdMicros);fact(day===await clock(c));
 const inserted=await c.query(`insert into project_planning_api_reservations(workspace_id,generation_id,project_key,budget_day,reserved_cost_usd_micros,state)select $1,$2,$3,$4::date,$5,'reserved' where $4::date=(clock_timestamp() at time zone 'UTC')::date`,[o.workspaceId,row.id,row.project_key,day,reserved]);fact(inserted.rowCount===1);await audit(c,o,row.id,'reserved',reserved);
}
export async function startPlanningApi(c:WorkflowRuntimeSqlClient,o:ProjectOwnerContext,row:Record<string,unknown>,p:ProjectGenerationPolicy,current:()=>boolean){
 const a=p.api;fact(a);const q=await c.query(`select *,budget_day::text as day from project_planning_api_reservations where workspace_id=$1 and generation_id=$2 for update`,[o.workspaceId,row.id]);fact(q.rowCount===1);const r=q.rows[0];fact(r.state==='reserved'&&r.day===await clock(c));
 const used=await lockOpenAIApiDailyBudget(c,o.workspaceId,r.day as string,a!.limits.dailyBudgetUsdMicros);fact(used<=a!.limits.dailyBudgetUsdMicros);fact(r.day===await clock(c));
 fact(current());
 const started=await c.query(`update project_planning_api_reservations set state='started' where workspace_id=$1 and generation_id=$2 and budget_day=(clock_timestamp() at time zone 'UTC')::date and clock_timestamp()<$3::timestamptz and clock_timestamp()<to_timestamp($4::double precision/1000)`,[o.workspaceId,row.id,row.expires_at,a!.pricing.expiresAt]);fact(started.rowCount===1);await audit(c,o,row.id,'started',Number(r.reserved_cost_usd_micros));
}
// Factual success only. Count/preflight failures and all ambiguity conservatively retain full hold.
export async function settlePlanningApi(c:WorkflowRuntimeSqlClient,o:ProjectOwnerContext,row:Record<string,unknown>,generationCost:number,p:ProjectGenerationPolicy){
 const q=await c.query(`select * from project_planning_api_reservations where workspace_id=$1 and generation_id=$2 for update`,[o.workspaceId,row.id]);fact(q.rowCount===1);const r=q.rows[0],actual=generationCost+p.api!.maxPreflightCostUsdMicros;fact(r.state==='started'&&Number.isSafeInteger(actual)&&actual>=0&&actual<=Number(r.reserved_cost_usd_micros));
 await c.query(`update project_planning_api_reservations set state='settled',actual_cost_usd_micros=$3 where workspace_id=$1 and generation_id=$2`,[o.workspaceId,row.id,actual]);await audit(c,o,row.id,'settled',Number(r.reserved_cost_usd_micros),actual);
}

/** Final native-count admission; caller commits before invoking the injected SDK. */
export async function admitPlanningApiCount(c:WorkflowRuntimeSqlClient,o:ProjectOwnerContext,row:Record<string,unknown>,p:ProjectGenerationPolicy){
 await c.query(`/* planning-api:count-lock */ select r.generation_id from project_planning_api_reservations r join project_planning_generations g on g.workspace_id=r.workspace_id and g.id=r.generation_id where r.workspace_id=$1 and r.generation_id=$2 for update of r,g`,[o.workspaceId,row.id]);
 const q=await c.query(`/* planning-api:count-admission */ select r.generation_id from project_planning_api_reservations r join project_planning_generations g on g.workspace_id=r.workspace_id and g.id=r.generation_id and g.project_key=r.project_key where r.workspace_id=$1 and r.project_key=$2 and r.generation_id=$3 and r.state='reserved' and g.status='started' and g.requested_by=$4 and g.request_fingerprint=$5 and g.policy_json=$6::jsonb and r.budget_day=(clock_timestamp() at time zone 'UTC')::date and clock_timestamp()<g.expires_at and clock_timestamp()<to_timestamp($7::double precision/1000) `,[o.workspaceId,row.project_key,row.id,o.userId,row.request_fingerprint,JSON.stringify(p),p.api!.pricing.expiresAt]);
 fact(q.rowCount===1);
}
