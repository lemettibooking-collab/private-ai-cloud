-- Additive cost evidence enforcement; preserve 0026 after its first disposable-cluster use.
begin;
create function check_project_planning_api_cost() returns trigger language plpgsql as $$
begin
 if not exists(select 1 from project_planning_generations g
 where g.workspace_id=new.workspace_id and g.id=new.generation_id
 and new.reserved_cost_usd_micros=ceil((g.policy_json->>'maxInputTokens')::numeric*(g.policy_json->>'inputCostUsdMicrosPerMillionTokens')::numeric/1000000)+ceil((g.policy_json->>'maxOutputTokens')::numeric*(g.policy_json->>'outputCostUsdMicrosPerMillionTokens')::numeric/1000000)+(g.policy_json->'api'->>'maxPreflightCostUsdMicros')::bigint)
 then raise exception using errcode='23514',message='Planning reservation cost mismatch';end if;
 if new.state='settled' and not exists(
 select 1 from project_planning_generations g join workflow_runs r on r.workspace_id=g.workspace_id and r.runtime_id=g.run_id
 join workflow_model_invocations i on i.workspace_id=r.workspace_id and i.workflow_run_id=r.id
 where g.workspace_id=new.workspace_id and g.id=new.generation_id and i.request_fingerprint=g.runtime_request_fingerprint and i.status='succeeded'
 and new.actual_cost_usd_micros=ceil(i.input_tokens::numeric*(g.policy_json->>'inputCostUsdMicrosPerMillionTokens')::numeric/1000000)+ceil(i.output_tokens::numeric*(g.policy_json->>'outputCostUsdMicrosPerMillionTokens')::numeric/1000000)+(g.policy_json->'api'->>'maxPreflightCostUsdMicros')::bigint) then
 raise exception using errcode='23514',message='Planning cost evidence unavailable';end if;
 return new;
end $$;
create trigger project_planning_api_cost_evidence before insert or update on project_planning_api_reservations for each row execute function check_project_planning_api_cost();
commit;
