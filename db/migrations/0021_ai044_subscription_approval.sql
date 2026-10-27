-- AI-044 Phase S: typed ONE-SHOT consumption evidence in the existing approval queue.
-- This is not a financial reservation, subscription token store or generic runtime unlock.
begin;
create table ai044_subscription_approval_bindings (
  workspace_id uuid not null,
  approval_request_id uuid not null,
  project_key text not null,
  project_task_key text not null,
  plan_key text not null,
  plan_revision integer not null check (plan_revision between 1 and 1000000),
  development_run_id text not null check (development_run_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  attempt_number integer not null check (attempt_number between 1 and 3),
  intent_payload text not null check (octet_length(intent_payload) between 1 and 32768),
  intent_fingerprint text not null check (intent_fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null default 'ready' check (state in ('ready','consumed','started','completed','failed','outcome_unknown')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  decision_id uuid,
  owner_actor_id uuid references users(id),
  authority_generation integer,
  canonical_run_fingerprint text,
  admission_fingerprint text,
  started_at timestamptz,
  result_fingerprint text,
  normalized_result_payload text check(normalized_result_payload is null or octet_length(normalized_result_payload) between 1 and 262144),
  resolved_at timestamptz,
  primary key(workspace_id,approval_request_id),
  unique(workspace_id,intent_fingerprint),
  foreign key(workspace_id,approval_request_id) references approval_requests(workspace_id,id),
  foreign key(workspace_id,project_key,project_task_key) references project_tasks(workspace_id,project_key,task_key),
  foreign key(workspace_id,project_task_key,plan_key,plan_revision) references project_task_feature_plans(workspace_id,task_key,plan_key,revision),
  foreign key(workspace_id,development_run_id,authority_generation) references executor_authority_events(workspace_id,development_run_id,authority_generation),
  foreign key(decision_id) references approval_decisions(id),
  check(expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  check(jsonb_typeof(intent_payload::jsonb)='object'
    and (intent_payload::jsonb)->>'schemaVersion' is not distinct from '1'
    and (intent_payload::jsonb)->>'workspaceDatabaseId' is not distinct from workspace_id::text
    and (intent_payload::jsonb)->>'projectId' is not distinct from project_key
    and (intent_payload::jsonb)->>'projectTaskId' is not distinct from project_task_key
    and (intent_payload::jsonb)->>'planId' is not distinct from plan_key
    and (intent_payload::jsonb)->>'planRevision' is not distinct from plan_revision::text
    and (intent_payload::jsonb)->'attempt'->>'developmentRunId' is not distinct from development_run_id
    and (intent_payload::jsonb)->'attempt'->>'number' is not distinct from attempt_number::text
    and (intent_payload::jsonb)->>'accessMode' is not distinct from 'subscription_session'
    and (intent_payload::jsonb)->'executor'->>'id' is not distinct from 'chatgpt-plan-patch'
    and (intent_payload::jsonb)->'executor'->>'version' is not distinct from 'v1'
    -- FeaturePlan/current-authority bindings choose the exact repository and baseline;
    -- no cancelled feature SHA is built into this still-uncommitted migration.
    and jsonb_typeof((intent_payload::jsonb)->'repository') is not distinct from 'object'
    and coalesce((intent_payload::jsonb)->'repository'->>'id' ~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$',false)
    and coalesce((intent_payload::jsonb)->'repository'->>'baseline' ~ '^([a-f0-9]{40}|[a-f0-9]{64})$',false)
    and jsonb_typeof((intent_payload::jsonb)->'readContextPaths') is not distinct from 'array'
    and jsonb_array_length((intent_payload::jsonb)->'readContextPaths') between 1 and 20
    and jsonb_typeof((intent_payload::jsonb)->'allowedWritePaths') is not distinct from 'array'
    and jsonb_array_length((intent_payload::jsonb)->'allowedWritePaths') between 1 and 12
    and (intent_payload::jsonb)->'preflight'->>'creditsEnabled' is not distinct from 'false'
    and (intent_payload::jsonb)->'preflight'->>'automaticPurchaseReliedUpon' is not distinct from 'false'
    and (intent_payload::jsonb)->'preflight'->>'appLimitPercent' is not null
    and ((intent_payload::jsonb)->'preflight'->>'appLimitPercent')::int between 1 and 99
    and intent_fingerprint=encode(sha256(convert_to('["pac.ai044.subscription-intent.v1",'||intent_payload||']','UTF8')),'hex')),
  check((state='ready' and consumed_at is null and decision_id is null and owner_actor_id is null and authority_generation is null
      and canonical_run_fingerprint is null and admission_fingerprint is null and started_at is null and result_fingerprint is null and normalized_result_payload is null and resolved_at is null)
    or(state<>'ready' and consumed_at is not null and consumed_at>=created_at and consumed_at<expires_at
      and decision_id is not null and owner_actor_id is not null and authority_generation is not null and authority_generation between 1 and 1000000
      and canonical_run_fingerprint is not null and canonical_run_fingerprint ~ '^[a-f0-9]{64}$'
      and admission_fingerprint is not null and admission_fingerprint ~ '^[a-f0-9]{64}$'
      and ((state='consumed' and started_at is null and resolved_at is null and result_fingerprint is null and normalized_result_payload is null)
        or(state='started' and started_at is not null and started_at>=consumed_at and resolved_at is null and result_fingerprint is null and normalized_result_payload is null)
        or(state='outcome_unknown' and started_at is not null and resolved_at is not null and resolved_at>=started_at and result_fingerprint is null and normalized_result_payload is null)
        or(state in ('completed','failed') and resolved_at is not null and resolved_at>=consumed_at
          and result_fingerprint is not null and result_fingerprint ~ '^[a-f0-9]{64}$' and normalized_result_payload is not null and (state='failed' or started_at is not null))))),
  check(normalized_result_payload is null or(
    jsonb_typeof(normalized_result_payload::jsonb)='object' and result_fingerprint=encode(sha256(convert_to(normalized_result_payload,'UTF8')),'hex')
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
-- Across all approval requests, only one can ever consume the same factual attempt.
create unique index ai044_subscription_one_consumption on ai044_subscription_approval_bindings(workspace_id,development_run_id,attempt_number) where consumed_at is not null;
create index ai044_subscription_unresolved on ai044_subscription_approval_bindings(workspace_id,development_run_id,attempt_number) where state in ('consumed','started','outcome_unknown');

-- Paid and subscription writers serialize on their SAME existing Run authority.
-- This prevents distinct profile ledgers from creating two rights for one factual attempt.
create function ai044_subscription_cross_profile_guard() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME='executor_attempt_exposures' then
    perform 1 from executor_run_authorities where workspace_id=new.workspace_id and development_run_id=new.development_run_id for update;
    if exists(select 1 from ai044_subscription_approval_bindings s where s.workspace_id=new.workspace_id and s.development_run_id=new.development_run_id
      and s.attempt_number=new.attempt_number and s.consumed_at is not null)
    then raise exception using errcode='23514',message='Duplicate executor attempt right denied.';end if;
  elsif new.consumed_at is not null and old.consumed_at is null then
    perform 1 from executor_run_authorities where workspace_id=new.workspace_id and development_run_id=new.development_run_id for update;
    if exists(select 1 from executor_attempt_exposures e where e.workspace_id=new.workspace_id and e.development_run_id=new.development_run_id and e.attempt_number=new.attempt_number)
    then raise exception using errcode='23514',message='Duplicate executor attempt right denied.';end if;
  end if;return new;
end $$;
create trigger ai044_subscription_paid_attempt_guard before insert on executor_attempt_exposures for each row execute function ai044_subscription_cross_profile_guard();
create trigger ai044_subscription_consumption_guard before update on ai044_subscription_approval_bindings for each row execute function ai044_subscription_cross_profile_guard();

create function ai044_subscription_binding_guard() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception using errcode='55000',message='Subscription approval evidence is immutable.';end if;
  if TG_OP='INSERT' then
    if new.state<>'ready' then raise exception using errcode='23514',message='Subscription approval must begin unconsumed.';end if;
    return new;
  end if;
  if (to_jsonb(new)-array['state','consumed_at','decision_id','owner_actor_id','authority_generation','canonical_run_fingerprint','admission_fingerprint','started_at','result_fingerprint','normalized_result_payload','resolved_at'])
    is distinct from (to_jsonb(old)-array['state','consumed_at','decision_id','owner_actor_id','authority_generation','canonical_run_fingerprint','admission_fingerprint','started_at','result_fingerprint','normalized_result_payload','resolved_at'])
    or (old.consumed_at is not null and (new.consumed_at is distinct from old.consumed_at or new.decision_id is distinct from old.decision_id
      or new.owner_actor_id is distinct from old.owner_actor_id or new.authority_generation is distinct from old.authority_generation
      or new.canonical_run_fingerprint is distinct from old.canonical_run_fingerprint or new.admission_fingerprint is distinct from old.admission_fingerprint))
    or (old.started_at is not null and new.started_at is distinct from old.started_at)
    or not((old.state='ready' and new.state='consumed') or(old.state='consumed' and new.state in ('started','failed'))
      or(old.state='started' and new.state in ('completed','failed','outcome_unknown')))
  then raise exception using errcode='55000',message='Subscription approval transition denied.';end if;
  return new;
end $$;
create trigger ai044_subscription_binding_guard before insert or update or delete on ai044_subscription_approval_bindings for each row execute function ai044_subscription_binding_guard();

create function ai044_subscription_approval_integrity() returns trigger language plpgsql as $$
declare request_id uuid;r record;b record;d record;
begin
  if TG_TABLE_NAME='approval_requests' then request_id:=new.id;else request_id:=new.approval_request_id;end if;
  select * into r from approval_requests where id=request_id;
  if r.action_type<>'ai044_subscription_executor' then return null;end if;
  select * into b from ai044_subscription_approval_bindings where workspace_id=r.workspace_id and approval_request_id=r.id;
  if not found or r.original_payload->>'intentFingerprint' is distinct from b.intent_fingerprint
    or r.original_payload->>'projectId' is distinct from b.project_key or r.original_payload->>'projectTaskId' is distinct from b.project_task_key
  then raise exception using errcode='23514',message='Subscription approval binding mismatch.';end if;
  select * into d from approval_decisions where workspace_id=r.workspace_id and approval_request_id=r.id;
  if r.status='pending' then
    if found or r.approved_by is not null or r.rejected_by is not null or r.resolved_at is not null or b.state<>'ready'
    then raise exception using errcode='23514',message='Invalid pending subscription approval.';end if;
  elsif r.status in ('approved','rejected') then
    if not found or d.decision<>r.status or r.resolved_at is null
      or(r.status='approved' and(r.approved_by is null or r.rejected_by is not null or d.decided_by_actor_id<>r.approved_by::text))
      or(r.status='rejected' and(r.rejected_by is null or r.approved_by is not null or d.decided_by_actor_id<>r.rejected_by::text or b.state<>'ready'))
      or not exists(select 1 from audit_events a where a.workspace_id=r.workspace_id and a.entity_id=r.id and a.event_type='ai044.subscription_approval_decided'
        and a.actor_user_id::text=d.decided_by_actor_id and a.metadata->>'decision'=d.decision and a.metadata->>'intentFingerprint'=b.intent_fingerprint)
    then raise exception using errcode='23514',message='Subscription approval decision mismatch.';end if;
  else raise exception using errcode='23514',message='Invalid subscription approval status.';end if;
  if not exists(select 1 from audit_events a where a.workspace_id=r.workspace_id and a.entity_id=r.id and a.event_type='ai044.subscription_approval_requested' and a.metadata->>'intentFingerprint'=b.intent_fingerprint)
  then raise exception using errcode='23514',message='Missing subscription approval audit.';end if;
  if b.state<>'ready' then
    if r.status<>'approved' or b.decision_id<>d.id or b.owner_actor_id::text<>d.decided_by_actor_id
      or not exists(select 1 from executor_authority_events e where e.workspace_id=b.workspace_id and e.development_run_id=b.development_run_id
        and e.authority_generation=b.authority_generation and e.authority_status='active' and e.project_key=b.project_key and e.plan_id=b.plan_key
        and e.current_attempt_number=b.attempt_number and e.canonical_run_fingerprint=b.canonical_run_fingerprint and e.admission_fingerprint=b.admission_fingerprint)
      or not exists(select 1 from audit_events a where a.workspace_id=b.workspace_id and a.entity_id=b.approval_request_id and a.event_type='ai044.subscription_approval_consumed' and a.metadata->>'intentFingerprint'=b.intent_fingerprint)
    then raise exception using errcode='23514',message='Subscription consumption binding mismatch.';end if;
  end if;
  if b.state in ('started','completed','failed','outcome_unknown') and not exists(select 1 from audit_events a where a.workspace_id=b.workspace_id and a.entity_id=b.approval_request_id
    and a.event_type='ai044.subscription_'||b.state and a.metadata->>'intentFingerprint'=b.intent_fingerprint and (b.result_fingerprint is null or a.metadata->>'resultFingerprint'=b.result_fingerprint))
  then raise exception using errcode='23514',message='Missing subscription outcome audit.';end if;
  return null;
end $$;
create constraint trigger ai044_subscription_request_integrity after insert or update on approval_requests deferrable initially deferred for each row execute function ai044_subscription_approval_integrity();
create constraint trigger ai044_subscription_binding_integrity after insert or update on ai044_subscription_approval_bindings deferrable initially deferred for each row execute function ai044_subscription_approval_integrity();
create constraint trigger ai044_subscription_decision_integrity after insert on approval_decisions deferrable initially deferred for each row execute function ai044_subscription_approval_integrity();

create function ai044_subscription_queue_immutable() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME='approval_decisions' then
    if exists(select 1 from ai044_subscription_approval_bindings where approval_request_id=old.approval_request_id)
    then raise exception using errcode='55000',message='Subscription Owner decision is immutable.';end if;
  elsif old.action_type='ai044_subscription_executor' then
    if TG_OP='DELETE' or old.status<>'pending' or new.id<>old.id or new.workspace_id<>old.workspace_id or new.action_type<>old.action_type
      or new.risk_level<>old.risk_level or new.original_payload<>old.original_payload or new.requested_by is distinct from old.requested_by
      or new.allowed_approver_role_codes<>old.allowed_approver_role_codes or new.edited_payload is not null or new.final_payload is not null
    then raise exception using errcode='55000',message='Subscription approval identity is immutable.';end if;
  end if;if TG_OP='DELETE' then return old;else return new;end if;
end $$;
create trigger ai044_subscription_request_immutable before update or delete on approval_requests for each row execute function ai044_subscription_queue_immutable();
create trigger ai044_subscription_decision_immutable before update or delete on approval_decisions for each row execute function ai044_subscription_queue_immutable();
commit;
