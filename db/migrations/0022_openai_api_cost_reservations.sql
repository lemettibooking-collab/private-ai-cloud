-- Narrow API proof: extend PAC's reserve -> fence -> factual settlement/unknown-hold model.
-- Keys and provider response bodies NEVER belong in this ledger. UTC days are DB facts.
begin;
create table openai_api_daily_budgets (
  workspace_id uuid not null references workspaces(id),
  budget_day date not null,
  limit_usd_micros bigint not null check(limit_usd_micros between 1 and 100000000),
  primary key(workspace_id,budget_day)
);
create table ai044_api_approval_bindings (
  workspace_id uuid not null,
  approval_request_id uuid not null,
  project_key text not null,
  project_task_key text not null,
  plan_key text not null,
  plan_revision integer not null check(plan_revision between 1 and 1000000),
  development_run_id text not null,
  attempt_number integer not null check(attempt_number between 1 and 3),
  intent_payload text not null check(octet_length(intent_payload) between 1 and 32768),
  intent_fingerprint text not null check(intent_fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null default 'ready' check(state in ('ready','consumed','started','completed','failed','outcome_unknown')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  decision_id uuid references approval_decisions(id),
  owner_actor_id uuid references users(id),
  authority_generation integer,
  canonical_run_fingerprint text,
  admission_fingerprint text,
  started_at timestamptz,
  resolved_at timestamptz,
  result_fingerprint text,
  normalized_result_payload text check(normalized_result_payload is null or octet_length(normalized_result_payload) between 1 and 262144),
  budget_day date,
  reserved_cost_usd_micros bigint check(reserved_cost_usd_micros between 1 and 10000000),
  actual_input_tokens bigint check(actual_input_tokens between 0 and 128000),
  actual_output_tokens bigint check(actual_output_tokens between 0 and 16384),
  actual_cost_usd_micros bigint check(actual_cost_usd_micros between 0 and 10000000),
  primary key(workspace_id,approval_request_id),
  unique(workspace_id,intent_fingerprint),
  foreign key(workspace_id,approval_request_id) references approval_requests(workspace_id,id),
  foreign key(workspace_id,project_key,project_task_key) references project_tasks(workspace_id,project_key,task_key),
  foreign key(workspace_id,project_task_key,plan_key,plan_revision) references project_task_feature_plans(workspace_id,task_key,plan_key,revision),
  foreign key(workspace_id,development_run_id,authority_generation) references executor_authority_events(workspace_id,development_run_id,authority_generation),
  foreign key(workspace_id,budget_day) references openai_api_daily_budgets(workspace_id,budget_day),
  check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
  check(started_at is null or started_at>=consumed_at),
  check(resolved_at is null or resolved_at>=coalesce(started_at,consumed_at)),
  check(actual_cost_usd_micros is null or coalesce(
    actual_input_tokens<=((intent_payload::jsonb)->'limits'->>'maxInputTokens')::bigint
    and actual_output_tokens<=((intent_payload::jsonb)->'limits'->>'maxOutputTokens')::bigint
    and actual_cost_usd_micros=
      floor((actual_input_tokens::numeric*((intent_payload::jsonb)->'pricing'->>'inputUsdMicrosPerMillionTokens')::numeric+999999)/1000000)
      +floor((actual_output_tokens::numeric*((intent_payload::jsonb)->'pricing'->>'outputUsdMicrosPerMillionTokens')::numeric+999999)/1000000),false)),
  check(jsonb_typeof(intent_payload::jsonb)='object'
    and (intent_payload::jsonb)->>'schemaVersion' is not distinct from '1'
    and (intent_payload::jsonb)->>'workspaceDatabaseId' is not distinct from workspace_id::text
    and (intent_payload::jsonb)->>'projectId' is not distinct from project_key
    and (intent_payload::jsonb)->>'projectTaskId' is not distinct from project_task_key
    and (intent_payload::jsonb)->>'planId' is not distinct from plan_key
    and (intent_payload::jsonb)->>'planRevision' is not distinct from plan_revision::text
    and (intent_payload::jsonb)->'attempt'->>'developmentRunId' is not distinct from development_run_id
    and (intent_payload::jsonb)->'attempt'->>'number' is not distinct from attempt_number::text
    and (intent_payload::jsonb)->>'accessMode' is not distinct from 'api_key'
    and (intent_payload::jsonb)->'executor'->>'id' is not distinct from 'openai-api-patch'
    and (intent_payload::jsonb)->'executor'->>'version' is not distinct from 'v1'
    and intent_fingerprint=encode(sha256(convert_to('["pac.ai044.api-intent.v1",'||intent_payload||']','UTF8')),'hex')),
  check((state='ready' and consumed_at is null and decision_id is null and owner_actor_id is null and authority_generation is null
      and canonical_run_fingerprint is null and admission_fingerprint is null and started_at is null and resolved_at is null
      and budget_day is null and reserved_cost_usd_micros is null and actual_cost_usd_micros is null
      and actual_input_tokens is null and actual_output_tokens is null and result_fingerprint is null and normalized_result_payload is null)
    or(state<>'ready' and consumed_at is not null and consumed_at>=created_at and consumed_at<expires_at
      and decision_id is not null and owner_actor_id is not null and authority_generation is not null
      and canonical_run_fingerprint is not null and admission_fingerprint is not null
      and budget_day is not null and reserved_cost_usd_micros is not null
      and reserved_cost_usd_micros::text is not distinct from (intent_payload::jsonb)->>'maximumCostUsdMicros'
      and ((state in ('consumed','started','outcome_unknown') and actual_input_tokens is null and actual_output_tokens is null and actual_cost_usd_micros is null
          and result_fingerprint is null and normalized_result_payload is null
          and ((state='consumed' and started_at is null and resolved_at is null)
            or(state='started' and started_at is not null and resolved_at is null)
            or(state='outcome_unknown' and started_at is not null and resolved_at is not null)))
        or(state in ('completed','failed') and actual_input_tokens is not null and actual_output_tokens is not null and actual_cost_usd_micros is not null
          and actual_cost_usd_micros<=reserved_cost_usd_micros and resolved_at is not null and result_fingerprint is not null and normalized_result_payload is not null
          and (started_at is not null or(state='failed' and actual_input_tokens=0 and actual_output_tokens=0 and actual_cost_usd_micros=0)))))),
  check(normalized_result_payload is null or(jsonb_typeof(normalized_result_payload::jsonb)='object'
    and result_fingerprint=encode(sha256(convert_to(normalized_result_payload,'UTF8')),'hex')
    and (normalized_result_payload::jsonb)->>'status' is not distinct from case when state='completed' then 'succeeded' else 'failed' end
    and (normalized_result_payload::jsonb)->>'invocationId' is not distinct from (intent_payload::jsonb)->>'invocationId'
    and (normalized_result_payload::jsonb)->>'planId' is not distinct from plan_key
    and (normalized_result_payload::jsonb)->>'taskId' is not distinct from (intent_payload::jsonb)->>'taskId'
    and (normalized_result_payload::jsonb)->'identity' is not distinct from (intent_payload::jsonb)->'executor'
    and (normalized_result_payload::jsonb)->'repository' is not distinct from (intent_payload::jsonb)->'repository'
    and (normalized_result_payload::jsonb)->'attempt' is not distinct from (intent_payload::jsonb)->'attempt'
    and (normalized_result_payload::jsonb)->>'ownerDecisionRequired' is not distinct from 'true'
    and (normalized_result_payload::jsonb)->>'verificationStatus' is not distinct from 'not_run'
    and (normalized_result_payload::jsonb)->>'automaticRetryAllowed' is not distinct from 'false'))
);
create unique index ai044_api_one_consumption on ai044_api_approval_bindings(workspace_id,development_run_id,attempt_number) where consumed_at is not null;
create index ai044_api_daily_cost on ai044_api_approval_bindings(workspace_id,budget_day) where consumed_at is not null;

create function openai_api_daily_guard() returns trigger language plpgsql as $$
declare used bigint;
begin
  if TG_OP='DELETE' or new.workspace_id<>old.workspace_id or new.budget_day<>old.budget_day then
    raise exception using errcode='55000',message='API budget identity immutable.';end if;
  select coalesce(sum(case when state in ('completed','failed') then actual_cost_usd_micros else reserved_cost_usd_micros end),0) into used
    from ai044_api_approval_bindings where workspace_id=new.workspace_id and budget_day=new.budget_day;
  if used>new.limit_usd_micros then raise exception using errcode='23514',message='API budget below committed exposure.';end if;
  return new;
end $$;
create trigger openai_api_daily_guard before update or delete on openai_api_daily_budgets for each row execute function openai_api_daily_guard();

create function ai044_api_guard() returns trigger language plpgsql as $$
declare b record;q record;d record;used bigint;lim bigint;
begin
  if TG_OP='DELETE' then raise exception using errcode='55000',message='API evidence is immutable.';end if;
  if TG_OP='INSERT' then
    if new.state<>'ready' then raise exception using errcode='23514',message='Invalid initial API state.';end if;return new;
  end if;
  if (to_jsonb(new)-array['state','consumed_at','decision_id','owner_actor_id','authority_generation','canonical_run_fingerprint','admission_fingerprint','started_at','resolved_at','result_fingerprint','normalized_result_payload','budget_day','reserved_cost_usd_micros','actual_input_tokens','actual_output_tokens','actual_cost_usd_micros'])
    is distinct from (to_jsonb(old)-array['state','consumed_at','decision_id','owner_actor_id','authority_generation','canonical_run_fingerprint','admission_fingerprint','started_at','resolved_at','result_fingerprint','normalized_result_payload','budget_day','reserved_cost_usd_micros','actual_input_tokens','actual_output_tokens','actual_cost_usd_micros'])
    or(old.consumed_at is not null and (new.consumed_at,new.decision_id,new.owner_actor_id,new.authority_generation,new.canonical_run_fingerprint,new.admission_fingerprint,new.budget_day,new.reserved_cost_usd_micros)
      is distinct from(old.consumed_at,old.decision_id,old.owner_actor_id,old.authority_generation,old.canonical_run_fingerprint,old.admission_fingerprint,old.budget_day,old.reserved_cost_usd_micros))
    or(old.started_at is not null and new.started_at is distinct from old.started_at)
    or not((old.state='ready' and new.state='consumed') or(old.state='consumed' and new.state in ('started','failed')) or(old.state='started' and new.state in ('completed','failed','outcome_unknown')))
  then raise exception using errcode='55000',message='Invalid API transition.';end if;
  perform 1 from executor_run_authorities where workspace_id=new.workspace_id and development_run_id=new.development_run_id for update;
  if old.state='ready' and (exists(select 1 from executor_attempt_exposures where workspace_id=new.workspace_id and development_run_id=new.development_run_id and attempt_number=new.attempt_number)
    or exists(select 1 from ai044_subscription_approval_bindings where workspace_id=new.workspace_id and development_run_id=new.development_run_id and attempt_number=new.attempt_number and consumed_at is not null))
  then raise exception using errcode='23514',message='Duplicate executor right.';end if;
  select * into q from approval_requests where workspace_id=new.workspace_id and id=new.approval_request_id;
  select * into d from approval_decisions where workspace_id=new.workspace_id and approval_request_id=new.approval_request_id;
  if q.status<>'approved' or d.decision<>'approved' or q.approved_by::text is distinct from d.decided_by_actor_id
    or d.id is distinct from new.decision_id or new.owner_actor_id::text is distinct from d.decided_by_actor_id
    or not exists(select 1 from executor_authority_events e where e.workspace_id=new.workspace_id and e.development_run_id=new.development_run_id and e.authority_generation=new.authority_generation
      and e.project_key=new.project_key and e.plan_id=new.plan_key and e.current_attempt_number=new.attempt_number and e.authority_status='active'
      and e.canonical_run_fingerprint=new.canonical_run_fingerprint and e.admission_fingerprint=new.admission_fingerprint)
  then raise exception using errcode='23514',message='Invalid API approval authority.';end if;
  select limit_usd_micros into lim from openai_api_daily_budgets where workspace_id=new.workspace_id and budget_day=new.budget_day for update;
  select coalesce(sum(case when state in ('completed','failed') then actual_cost_usd_micros else reserved_cost_usd_micros end),0) into used
    from ai044_api_approval_bindings where workspace_id=new.workspace_id and budget_day=new.budget_day and approval_request_id<>new.approval_request_id;
  if lim is null or used+(case when new.state in ('completed','failed') then new.actual_cost_usd_micros else new.reserved_cost_usd_micros end)>lim
  then raise exception using errcode='23514',message='API daily budget exceeded.';end if;
  return new;
end $$;
create trigger ai044_api_guard before insert or update or delete on ai044_api_approval_bindings for each row execute function ai044_api_guard();
create function ai044_api_cross_profile() returns trigger language plpgsql as $$
declare check_right boolean;
begin
  if TG_TABLE_NAME='executor_attempt_exposures' then check_right:=true;
  else check_right:=new.consumed_at is not null and old.consumed_at is null;end if;
  if check_right then
    perform 1 from executor_run_authorities where workspace_id=new.workspace_id and development_run_id=new.development_run_id for update;
    if exists(select 1 from ai044_api_approval_bindings where workspace_id=new.workspace_id and development_run_id=new.development_run_id and attempt_number=new.attempt_number and consumed_at is not null)
    then raise exception using errcode='23514',message='Duplicate API executor right.';end if;
  end if;return new;
end $$;
create trigger ai044_api_paid_guard before insert on executor_attempt_exposures for each row execute function ai044_api_cross_profile();
create trigger ai044_api_subscription_guard before update on ai044_subscription_approval_bindings for each row execute function ai044_api_cross_profile();

-- Deferred queue/binding/audit consistency; terminal facts cannot be forged by omitting audit.
create function ai044_api_integrity() returns trigger language plpgsql as $$
declare rid uuid;q record;b record;d record;
begin
  if TG_TABLE_NAME='approval_requests' then rid:=new.id;else rid:=new.approval_request_id;end if;
  select * into q from approval_requests where id=rid;
  if q.action_type<>'ai044_openai_api_executor' then return null;end if;
  select * into b from ai044_api_approval_bindings where workspace_id=q.workspace_id and approval_request_id=rid;
  if not found or q.original_payload->>'intentFingerprint' is distinct from b.intent_fingerprint
    or q.original_payload->>'projectId' is distinct from b.project_key or q.original_payload->>'projectTaskId' is distinct from b.project_task_key
    or not exists(select 1 from audit_events where workspace_id=b.workspace_id and entity_id=rid and event_type='ai044.api_approval_requested' and metadata->>'intentFingerprint'=b.intent_fingerprint)
  then raise exception using errcode='23514',message='API approval binding/audit missing.';end if;
  select * into d from approval_decisions where workspace_id=b.workspace_id and approval_request_id=rid;
  if q.status='pending' then
    if found or b.state<>'ready' or q.approved_by is not null or q.rejected_by is not null or q.resolved_at is not null then raise exception using errcode='23514',message='Invalid pending API approval.';end if;
  elsif q.status in ('approved','rejected') then
    if not found or d.decision<>q.status or q.resolved_at is null
      or(q.status='approved' and(q.approved_by::text is distinct from d.decided_by_actor_id or q.rejected_by is not null))
      or(q.status='rejected' and(q.rejected_by::text is distinct from d.decided_by_actor_id or q.approved_by is not null or b.state<>'ready'))
      or not exists(select 1 from audit_events where workspace_id=b.workspace_id and entity_id=rid and event_type='ai044.api_approval_decided' and metadata->>'decision'=d.decision and metadata->>'intentFingerprint'=b.intent_fingerprint)
    then raise exception using errcode='23514',message='Invalid API decision.';end if;
  else raise exception using errcode='23514',message='Invalid API queue status.';end if;
  if b.state<>'ready' and not exists(select 1 from audit_events where workspace_id=b.workspace_id and entity_id=rid and event_type='ai044.api_consumed' and metadata->>'intentFingerprint'=b.intent_fingerprint)
  then raise exception using errcode='23514',message='Missing API consumption audit.';end if;
  if b.state in ('started','completed','failed','outcome_unknown') and not exists(select 1 from audit_events where workspace_id=b.workspace_id and entity_id=rid and event_type='ai044.api_'||b.state and metadata->>'intentFingerprint'=b.intent_fingerprint and (b.result_fingerprint is null or metadata->>'resultFingerprint'=b.result_fingerprint))
  then raise exception using errcode='23514',message='Missing API result audit.';end if;
  return null;
end $$;
create constraint trigger ai044_api_request_integrity after insert or update on approval_requests deferrable initially deferred for each row execute function ai044_api_integrity();
create constraint trigger ai044_api_binding_integrity after insert or update on ai044_api_approval_bindings deferrable initially deferred for each row execute function ai044_api_integrity();
create constraint trigger ai044_api_decision_integrity after insert on approval_decisions deferrable initially deferred for each row execute function ai044_api_integrity();
create function ai044_api_queue_immutable() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME='approval_decisions' then
    if exists(select 1 from ai044_api_approval_bindings where approval_request_id=old.approval_request_id) then raise exception using errcode='55000',message='API decision immutable.';end if;
  elsif old.action_type='ai044_openai_api_executor' then
    if TG_OP='DELETE' or old.status<>'pending' or new.id<>old.id or new.workspace_id<>old.workspace_id or new.action_type<>old.action_type or new.original_payload<>old.original_payload
      or new.risk_level<>old.risk_level or new.allowed_approver_role_codes<>old.allowed_approver_role_codes or new.requested_by is distinct from old.requested_by or new.edited_payload is not null or new.final_payload is not null
    then raise exception using errcode='55000',message='API queue identity immutable.';end if;
  end if;if TG_OP='DELETE' then return old;else return new;end if;
end $$;
create trigger ai044_api_queue_immutable before update or delete on approval_requests for each row execute function ai044_api_queue_immutable();
create trigger ai044_api_decision_immutable before update or delete on approval_decisions for each row execute function ai044_api_queue_immutable();
commit;
