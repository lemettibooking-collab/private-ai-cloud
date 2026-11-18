import type { WorkflowRuntimeSqlClient } from './workflow-runtime-store';
/** Both purposes serialize on the same workspace/day row. Caller owns its transaction. */
export async function lockOpenAIApiDailyBudget(c:WorkflowRuntimeSqlClient,workspaceId:string,day:string,limit:number){
 await c.query(`insert into openai_api_daily_budgets(workspace_id,budget_day,limit_usd_micros) values($1,$2::date,$3) on conflict(workspace_id,budget_day) do nothing`,[workspaceId,day,limit]);
 await c.query(`select workspace_id from openai_api_daily_budgets where workspace_id=$1 and budget_day=$2::date for update`,[workspaceId,day]);
 const q=await c.query(`/* api:cross-purpose-usage */ select (
 (select coalesce(sum(case when state in ('completed','failed') then actual_cost_usd_micros else reserved_cost_usd_micros end),0) from ai044_api_approval_bindings where workspace_id=$1 and budget_day=$2::date)
 +(select coalesce(sum(case when state='settled' then actual_cost_usd_micros else reserved_cost_usd_micros end),0) from project_planning_api_reservations where workspace_id=$1 and budget_day=$2::date))::text as used`,[workspaceId,day]);
 const used=Number(q.rows[0]?.used);if(q.rowCount!==1||!Number.isSafeInteger(used)||used<0)throw Error('api_budget_unavailable');return used;
}
