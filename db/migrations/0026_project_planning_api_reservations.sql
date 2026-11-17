-- Local fake-SDK integration only; no live credential or activation authority.
begin;
create table project_planning_api_reservations (
 workspace_id uuid not null,
 generation_id uuid not null,
 project_key text not null,
 budget_day date not null,
 reserved_cost_usd_micros bigint not null check(reserved_cost_usd_micros between 1 and 11000000),
 state text not null check(state in ('reserved','started','settled')),
 actual_cost_usd_micros bigint,
 primary key(workspace_id,generation_id),
 foreign key(workspace_id,project_key,generation_id) references project_planning_generations(workspace_id,project_key,id),
 foreign key(workspace_id,budget_day) references openai_api_daily_budgets(workspace_id,budget_day),
 check((state='settled' and actual_cost_usd_micros between 0 and reserved_cost_usd_micros) or (state<>'settled' and actual_cost_usd_micros is null))
);
create function fence_project_planning_api_reservation() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='Immutable planning reservation';end if;
 if tg_op='INSERT' then
  if new.state<>'reserved' or not exists(select 1 from project_planning_generations g where g.workspace_id=new.workspace_id and g.id=new.generation_id and g.project_key=new.project_key and g.status='started' and g.policy_json->'api'->>'mode'='fake_sdk_only') then raise exception using errcode='23514',message='Invalid planning reservation';end if;
 elsif (to_jsonb(new)-array['state','actual_cost_usd_micros']) is distinct from (to_jsonb(old)-array['state','actual_cost_usd_micros']) or not(old.state='reserved' and new.state='started' or old.state='started' and new.state='settled') then
 raise exception using errcode='23514',message='Invalid planning reservation transition';end if;
 return new;
end $$;
create trigger project_planning_api_reservation_fence before insert or update or delete on project_planning_api_reservations for each row execute function fence_project_planning_api_reservation();
create function check_project_planning_api_audit() returns trigger language plpgsql as $$
begin
 if (select count(*) from audit_events where workspace_id=new.workspace_id and entity_id=new.generation_id and event_type='project.planning_api_'||new.state)<>1 or not exists(
 select 1 from audit_events a join project_planning_generations g on g.workspace_id=a.workspace_id and g.id=a.entity_id
 where a.workspace_id=new.workspace_id and a.entity_id=new.generation_id and a.event_type='project.planning_api_'||new.state and a.actor_user_id=g.requested_by and a.entity_type='project_planning_generation'
 and a.metadata=jsonb_build_object('reservedCostUsdMicros',new.reserved_cost_usd_micros)||case when new.state='settled' then jsonb_build_object('actualCostUsdMicros',new.actual_cost_usd_micros) else '{}'::jsonb end) then raise exception using errcode='23514',message='Missing planning financial audit';end if;
 return null;
end $$;
create constraint trigger project_planning_api_audit after insert or update on project_planning_api_reservations deferrable initially deferred for each row execute function check_project_planning_api_audit();
commit;
