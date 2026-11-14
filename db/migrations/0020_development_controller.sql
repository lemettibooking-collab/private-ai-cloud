-- B3: transaction/CAS-owned controller facts. No lease, provider store, budget model or live authority.
begin;
create table controller_project_tasks (
  workspace_id uuid not null, project_key text not null, task_key text not null,
  controller_revision integer not null check(controller_revision>=1),
  plan_approval_request_id uuid, approval_task_version integer, plan_key text, plan_revision integer,
  draft_fingerprint text, approved_fingerprint text, plan_json jsonb,
  current_fingerprint text not null check(current_fingerprint ~ '^[a-f0-9]{64}$'),
  primary key(workspace_id,task_key), unique(workspace_id,project_key,task_key),
  foreign key(workspace_id,project_key,task_key) references project_tasks(workspace_id,project_key,task_key),
  foreign key(workspace_id,plan_approval_request_id) references roadmap_approval_bindings(workspace_id,approval_request_id),
  foreign key(workspace_id,task_key,plan_key,plan_revision) references project_task_feature_plans(workspace_id,task_key,plan_key,revision),
  check((plan_key is null and plan_revision is null and plan_approval_request_id is null and approval_task_version is null and draft_fingerprint is null and approved_fingerprint is null and plan_json is null)
    or(plan_key is not null and plan_revision is not null and plan_revision>=1 and plan_approval_request_id is not null
      and approval_task_version is not null and approval_task_version>=1 and draft_fingerprint is not null and draft_fingerprint ~ '^[a-f0-9]{64}$'
      and approved_fingerprint is not null and approved_fingerprint ~ '^[a-f0-9]{64}$' and plan_json is not null and jsonb_typeof(plan_json)='object'
      and (plan_json->>'id') is not distinct from plan_key and (plan_json->>'status') is not distinct from 'approved'))
);
create table controller_development_runs (
  workspace_id uuid not null, project_key text not null, project_task_key text not null, development_run_id text not null,
  plan_key text not null, plan_revision integer not null, draft_fingerprint text not null, approved_fingerprint text not null,
  run_revision integer not null check(run_revision>=0),run_snapshot jsonb not null,run_fingerprint text not null,
  primary key(workspace_id,development_run_id),unique(workspace_id,project_key,project_task_key,development_run_id),
  foreign key(workspace_id,project_key,project_task_key) references controller_project_tasks(workspace_id,project_key,task_key) deferrable initially deferred,
  foreign key(workspace_id,project_task_key,plan_key,plan_revision) references project_task_feature_plans(workspace_id,task_key,plan_key,revision),
  check(development_run_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  check(draft_fingerprint ~ '^[a-f0-9]{64}$' and approved_fingerprint ~ '^[a-f0-9]{64}$' and run_fingerprint ~ '^[a-f0-9]{64}$'),
  check(jsonb_typeof(run_snapshot)='object' and (run_snapshot->>'id') is not distinct from development_run_id
    and (run_snapshot->>'planId') is not distinct from plan_key and run_snapshot ? 'taskId'
    and jsonb_typeof(run_snapshot->'taskId')='string' and (run_snapshot->>'maxAttempts') is not distinct from '3' and octet_length(run_snapshot::text)<=1048576)
);
create unique index controller_task_run_unique on controller_development_runs(workspace_id,project_task_key,(run_snapshot->>'taskId'));
create table controller_development_events (
  workspace_id uuid not null,development_run_id text not null,run_revision integer not null,
  event_json jsonb not null,run_snapshot jsonb not null,run_fingerprint text not null,
  transaction_id bigint not null default txid_current(),created_at timestamptz not null default now(),
  primary key(workspace_id,development_run_id,run_revision),
  foreign key(workspace_id,development_run_id) references controller_development_runs(workspace_id,development_run_id),
  check(run_revision>=0),check(run_fingerprint ~ '^[a-f0-9]{64}$')
);
create trigger controller_development_events_immutable before update or delete on controller_development_events for each row execute function roadmap_immutable();
create table controller_attempt_intents (
  workspace_id uuid not null,development_run_id text not null,attempt_number integer not null check(attempt_number between 1 and 3),
  project_task_state_version integer not null check(project_task_state_version>=1),run_revision integer not null check(run_revision>=1),
  configuration_json jsonb not null,configuration_fingerprint text not null,
  invocation_json jsonb not null,invocation_fingerprint text not null,
  context_json jsonb not null,context_fingerprint text not null,
  route_json jsonb not null,route_fingerprint text not null,
  execution_policy_json jsonb not null,execution_policy_fingerprint text not null,
  intent_fingerprint text not null,created_at timestamptz not null default now(),
  primary key(workspace_id,development_run_id,attempt_number),
  foreign key(workspace_id,development_run_id,run_revision) references controller_development_events(workspace_id,development_run_id,run_revision),
  check(configuration_fingerprint ~ '^[a-f0-9]{64}$' and invocation_fingerprint ~ '^[a-f0-9]{64}$' and context_fingerprint ~ '^[a-f0-9]{64}$'
    and route_fingerprint ~ '^[a-f0-9]{64}$' and execution_policy_fingerprint ~ '^[a-f0-9]{64}$' and intent_fingerprint ~ '^[a-f0-9]{64}$')
);
create trigger controller_attempt_intents_immutable before update or delete on controller_attempt_intents for each row execute function roadmap_immutable();
create table controller_operations (
  workspace_id uuid not null,project_key text not null,project_task_key text not null,operation_id text not null,
  development_run_id text not null,run_revision integer not null,attempt_number integer not null,
  kind text not null check(kind in ('executor','quality','security')),status text not null check(status in ('pending','recorded')),
  outcome_fingerprint text,
  intent_fingerprint text not null,evidence_json jsonb,evidence_fingerprint text,created_at timestamptz not null default now(),
  primary key(workspace_id,operation_id),unique(workspace_id,development_run_id,run_revision,kind),
  foreign key(workspace_id,project_key,project_task_key,development_run_id) references controller_development_runs(workspace_id,project_key,project_task_key,development_run_id),
  foreign key(workspace_id,development_run_id,run_revision) references controller_development_events(workspace_id,development_run_id,run_revision),
  check(operation_id ~ '^operation-[a-f0-9]{32}$'),check(attempt_number between 1 and 3),check(intent_fingerprint ~ '^[a-f0-9]{64}$'),
  check((kind='executor' and outcome_fingerprint is null) or(kind in ('quality','security') and outcome_fingerprint is not null and outcome_fingerprint ~ '^[a-f0-9]{64}$')),
  check((status='pending' and evidence_json is null and evidence_fingerprint is null)
    or(status='recorded' and evidence_json is not null and evidence_fingerprint is not null and evidence_fingerprint ~ '^[a-f0-9]{64}$' and octet_length(evidence_json::text)<=1048576))
);
create table controller_state_events (
  workspace_id uuid not null,project_key text not null,task_key text not null,command_id text not null,
  intent_fingerprint text not null,controller_revision integer not null,result_state jsonb not null,state_fingerprint text not null,
  command_base_fingerprint text not null check(command_base_fingerprint ~ '^[a-f0-9]{64}$'),
  transaction_id bigint not null default txid_current(),created_at timestamptz not null default now(),
  primary key(workspace_id,command_id),unique(workspace_id,task_key,controller_revision),
  foreign key(workspace_id,project_key,task_key) references controller_project_tasks(workspace_id,project_key,task_key),
  check(command_id ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),check(intent_fingerprint ~ '^[a-f0-9]{64}$' and state_fingerprint ~ '^[a-f0-9]{64}$'),
  check(controller_revision>=1 and octet_length(result_state::text)<=8388608)
);
create trigger controller_state_events_immutable before update or delete on controller_state_events for each row execute function roadmap_immutable();
-- Typed projection into existing generic approvals for result/scope/risk/architecture gates.
create table controller_owner_gate_bindings (
  workspace_id uuid not null,project_key text not null,task_key text not null,approval_request_id uuid not null,
  purpose text not null,expected_task_version integer not null,state_fingerprint text not null,binding_fingerprint text not null,
  created_at timestamptz not null default now(),primary key(workspace_id,approval_request_id),
  unique(workspace_id,task_key,purpose,expected_task_version,state_fingerprint),
  foreign key(workspace_id,project_key,task_key) references project_tasks(workspace_id,project_key,task_key),
  foreign key(workspace_id,approval_request_id) references approval_requests(workspace_id,id),
  check(purpose in ('scope_change','budget_or_risk_increase','architecture_change','result_acceptance')),
  check(expected_task_version>=1),check(state_fingerprint ~ '^[a-f0-9]{64}$' and binding_fingerprint ~ '^[a-f0-9]{64}$')
);
create trigger controller_owner_gate_bindings_immutable before update or delete on controller_owner_gate_bindings for each row execute function roadmap_immutable();

create function controller_run_guard() returns trigger language plpgsql as $$
begin
  if TG_OP='INSERT' then
    insert into roadmap_project_guards(workspace_id,project_key) values(new.workspace_id,new.project_key) on conflict do nothing;
    perform project_key from roadmap_project_guards where workspace_id=new.workspace_id and project_key=new.project_key for update;
    if new.run_revision<>0 or exists(select 1 from executor_run_authorities where workspace_id=new.workspace_id and development_run_id=new.development_run_id)
      or exists(select 1 from executor_attempt_exposures where workspace_id=new.workspace_id and development_run_id=new.development_run_id)
    then raise exception using errcode='23514',message='Controller cannot adopt prior executor authority.';end if;
  elsif new.run_revision<>old.run_revision+1 or new.workspace_id<>old.workspace_id or new.project_key<>old.project_key
    or new.project_task_key<>old.project_task_key or new.development_run_id<>old.development_run_id or new.plan_key<>old.plan_key
    or new.plan_revision<>old.plan_revision or new.draft_fingerprint<>old.draft_fingerprint or new.approved_fingerprint<>old.approved_fingerprint
    or new.run_snapshot->>'taskId'<>old.run_snapshot->>'taskId'
  then raise exception using errcode='23514',message='Invalid controller run revision.';end if;
  return new;
end; $$;
create trigger controller_run_guard before insert or update on controller_development_runs for each row execute function controller_run_guard();
create function controller_run_journal_guard() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from controller_development_events e where e.workspace_id=new.workspace_id and e.development_run_id=new.development_run_id
    and e.run_revision=new.run_revision and e.run_fingerprint=new.run_fingerprint and e.run_snapshot=new.run_snapshot and e.transaction_id=txid_current())
  then raise exception using errcode='23514',message='Controller run requires same-transaction history.';end if;return null;
end; $$;
create constraint trigger controller_run_journal_guard after insert or update on controller_development_runs deferrable initially deferred for each row execute function controller_run_journal_guard();
create function controller_current_guard() returns trigger language plpgsql as $$
begin
  if TG_OP='INSERT' then if new.controller_revision<>1 then raise exception using errcode='23514',message='Invalid controller initial revision.';end if;
  elsif new.controller_revision<>old.controller_revision+1 or new.workspace_id<>old.workspace_id or new.project_key<>old.project_key or new.task_key<>old.task_key
    or(old.plan_approval_request_id is not null and (new.plan_approval_request_id is distinct from old.plan_approval_request_id or new.plan_json is distinct from old.plan_json
      or new.plan_key is distinct from old.plan_key or new.plan_revision is distinct from old.plan_revision or new.approval_task_version is distinct from old.approval_task_version
      or new.draft_fingerprint is distinct from old.draft_fingerprint or new.approved_fingerprint is distinct from old.approved_fingerprint))
  then raise exception using errcode='23514',message='Invalid controller state revision.';end if;return new;
end; $$;
create trigger controller_current_guard before insert or update on controller_project_tasks for each row execute function controller_current_guard();
create function controller_current_journal_guard() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from controller_state_events e where e.workspace_id=new.workspace_id and e.project_key=new.project_key and e.task_key=new.task_key
    and e.controller_revision=new.controller_revision and e.state_fingerprint=new.current_fingerprint and e.transaction_id=txid_current())
  then raise exception using errcode='23514',message='Controller state requires same-transaction history.';end if;return null;
end; $$;
create constraint trigger controller_current_journal_guard after insert or update on controller_project_tasks deferrable initially deferred for each row execute function controller_current_journal_guard();
create function controller_operation_guard() returns trigger language plpgsql as $$
begin
  if new.workspace_id<>old.workspace_id or new.project_key<>old.project_key or new.project_task_key<>old.project_task_key or new.operation_id<>old.operation_id
    or new.development_run_id<>old.development_run_id or new.run_revision<>old.run_revision or new.attempt_number<>old.attempt_number or new.kind<>old.kind
    or new.intent_fingerprint<>old.intent_fingerprint or new.outcome_fingerprint is distinct from old.outcome_fingerprint or old.status<>'pending' or new.status<>'recorded'
  then raise exception using errcode='23514',message='Controller operation is immutable after recording.';end if;return new;
end; $$;
create trigger controller_operation_guard before update on controller_operations for each row execute function controller_operation_guard();
create trigger controller_operation_delete_guard before delete on controller_operations for each row execute function roadmap_immutable();

-- DB backstops: neither a crafted journal nor an Owner reset can bypass execution/approval facts.
create function controller_task_authority_guard() returns trigger language plpgsql as $$
begin
  if new.milestone_key is null then return null;end if;
  if new.status='draft' and old.status<>'draft' and exists(select 1 from controller_development_runs where workspace_id=new.workspace_id and project_task_key=new.task_key)
  then raise exception using errcode='23514',message='Executed task cannot return to draft.';end if;
  if new.status='approved' and old.status<>'approved' and not exists(
    select 1 from controller_project_tasks c join roadmap_approval_bindings b on b.workspace_id=c.workspace_id and b.approval_request_id=c.plan_approval_request_id
      join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
      join approval_decisions d on d.workspace_id=r.workspace_id and d.approval_request_id=r.id
    where c.workspace_id=new.workspace_id and c.project_key=new.project_key and c.task_key=new.task_key
      and c.approval_task_version=old.state_version and b.expected_task_version=old.state_version and b.purpose='feature_plan_approval'
      and b.plan_key=c.plan_key and b.plan_revision=c.plan_revision and b.draft_fingerprint=c.draft_fingerprint and b.execution_fingerprint=c.approved_fingerprint
      and r.status='approved' and d.decision='approved' and d.decided_by_actor_id=r.approved_by::text and r.resolved_at is not null
  ) then raise exception using errcode='23514',message='Task approval requires exact Owner plan evidence.';end if;
  if new.status='completed' and old.status<>'completed' then
    if old.status<>'waiting_owner' or not exists(select 1 from controller_project_tasks c where c.workspace_id=new.workspace_id and c.task_key=new.task_key
      and c.plan_json is not null and jsonb_array_length(c.plan_json->'tasks')=(select count(*) from controller_development_runs x
        where x.workspace_id=c.workspace_id and x.project_task_key=c.task_key and x.run_snapshot->>'status'='completed'))
      or exists(select 1 from controller_development_runs x join executor_attempt_exposures e on e.workspace_id=x.workspace_id and e.development_run_id=x.development_run_id
        where x.workspace_id=new.workspace_id and x.project_task_key=new.task_key and e.state not in ('settled','cancelled'))
      or exists(select 1 from controller_development_runs x where x.workspace_id=new.workspace_id and x.project_task_key=new.task_key and (
        not exists(select 1 from controller_operations o where o.workspace_id=x.workspace_id and o.development_run_id=x.development_run_id
          and o.attempt_number=(x.run_snapshot->>'currentAttemptNumber')::int and o.kind='quality' and o.status='recorded' and o.evidence_json->>'outcome'='pass')
        or not exists(select 1 from controller_operations o where o.workspace_id=x.workspace_id and o.development_run_id=x.development_run_id
          and o.attempt_number=(x.run_snapshot->>'currentAttemptNumber')::int and o.kind='security' and o.status='recorded' and o.evidence_json->>'outcome'='pass')))
      or not exists(select 1 from controller_owner_gate_bindings b join approval_requests r on r.workspace_id=b.workspace_id and r.id=b.approval_request_id
        join approval_decisions d on d.workspace_id=r.workspace_id and d.approval_request_id=r.id
        where b.workspace_id=new.workspace_id and b.project_key=new.project_key and b.task_key=new.task_key and b.purpose='result_acceptance'
          and b.expected_task_version=old.state_version and r.status='approved' and d.decision='approved' and d.decided_by_actor_id=r.approved_by::text and r.resolved_at is not null)
    then raise exception using errcode='23514',message='Task completion requires full gates and final Owner acceptance.';end if;
  end if;
  return null;
end; $$;
create constraint trigger controller_task_authority_guard after update on project_tasks deferrable initially deferred for each row execute function controller_task_authority_guard();
create function controller_owner_approval_integrity() returns trigger language plpgsql as $$
declare request_id uuid;r record;b record;d record;
begin
  if TG_TABLE_NAME='approval_requests' then request_id:=new.id;else request_id:=new.approval_request_id;end if;
  select * into r from approval_requests where id=request_id;
  if r.action_type not in ('development_scope_change','development_budget_or_risk_increase','development_architecture_change','development_result_acceptance') then return null;end if;
  select * into b from controller_owner_gate_bindings where workspace_id=r.workspace_id and approval_request_id=r.id;
  if not found or r.action_type is distinct from 'development_'||b.purpose
    or r.original_payload->>'projectId' is distinct from b.project_key or r.original_payload->>'taskId' is distinct from b.task_key
    or r.original_payload->>'bindingFingerprint' is distinct from b.binding_fingerprint
  then raise exception using errcode='23514',message='Controller approval binding mismatch.';end if;
  select * into d from approval_decisions where workspace_id=r.workspace_id and approval_request_id=r.id;
  if r.status='pending' then
    if found or r.approved_by is not null or r.rejected_by is not null or r.resolved_at is not null
    then raise exception using errcode='23514',message='Invalid pending controller approval.';end if;
  elsif r.status in ('approved','rejected') then
    if not found or d.decision<>r.status or r.resolved_at is null
      or(r.status='approved' and(r.approved_by is null or r.rejected_by is not null or d.decided_by_actor_id<>r.approved_by::text))
      or(r.status='rejected' and(r.rejected_by is null or r.approved_by is not null or d.decided_by_actor_id<>r.rejected_by::text))
      or not exists(select 1 from audit_events a where a.workspace_id=r.workspace_id and a.entity_id=r.id and a.event_type='controller.approval_decided'
        and a.actor_user_id::text=d.decided_by_actor_id and a.metadata->>'decision'=d.decision)
    then raise exception using errcode='23514',message='Controller approval decision mismatch.';end if;
  else raise exception using errcode='23514',message='Invalid controller approval state.';end if;return null;
end; $$;
create constraint trigger controller_owner_request_integrity after insert or update on approval_requests deferrable initially deferred for each row execute function controller_owner_approval_integrity();
create constraint trigger controller_owner_binding_integrity after insert on controller_owner_gate_bindings deferrable initially deferred for each row execute function controller_owner_approval_integrity();
create constraint trigger controller_owner_decision_integrity after insert on approval_decisions deferrable initially deferred for each row execute function controller_owner_approval_integrity();
create function controller_bound_approval_immutable() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME='approval_decisions' then
    if exists(select 1 from controller_owner_gate_bindings where approval_request_id=old.approval_request_id)
    then raise exception using errcode='55000',message='Controller Owner decision is immutable.';end if;
  elsif old.action_type in ('development_scope_change','development_budget_or_risk_increase','development_architecture_change','development_result_acceptance') then
    if TG_OP='DELETE' or old.status<>'pending' or new.id<>old.id or new.workspace_id<>old.workspace_id
      or new.action_type<>old.action_type or new.risk_level<>old.risk_level or new.original_payload<>old.original_payload
      or new.requested_by is distinct from old.requested_by or new.allowed_approver_role_codes<>old.allowed_approver_role_codes
      or new.edited_payload is not null or new.final_payload is not null
    then raise exception using errcode='55000',message='Controller approval identity is immutable.';end if;
  end if;if TG_OP='DELETE' then return old;else return new;end if;
end; $$;
create trigger controller_bound_request_immutable before update or delete on approval_requests for each row execute function controller_bound_approval_immutable();
create trigger controller_bound_decision_immutable before update or delete on approval_decisions for each row execute function controller_bound_approval_immutable();
commit;
