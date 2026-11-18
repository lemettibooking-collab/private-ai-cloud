-- AI-041.1e. Identity knowledge for an ALREADY committed executor start, not a lifecycle.
-- No backfill: historical rows keep their original request/result and unknown remote IDs.
alter table executor_attempt_exposures add constraint executor_provider_start_binding_unique unique
  (workspace_id,development_run_id,attempt_number,provider_id,account_id,provider_model_id,executor_id,executor_version,request_fingerprint);
create table executor_provider_executions (
  workspace_id uuid not null,
  development_run_id text not null,
  attempt_number integer not null,
  provider_id text not null,
  account_id text not null,
  provider_model_id text not null,
  executor_id text not null,
  executor_version text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  base_request_fingerprint text not null check (base_request_fingerprint ~ '^[a-f0-9]{64}$'),
  correlation_fingerprint text not null check (correlation_fingerprint ~ '^[a-f0-9]{64}$'),
  session_id text check (session_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  turn_id text check (turn_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  identity_state text not null check (identity_state in ('correlation_prepared','session_observed','turn_observed')),
  recovery_required boolean not null default false,
  event_version integer not null check (event_version between 1 and 1000000),
  created_at timestamptz not null,
  updated_at timestamptz not null check (updated_at >= created_at),
  primary key (workspace_id,development_run_id,attempt_number),
  foreign key (workspace_id,development_run_id,attempt_number,provider_id,account_id,provider_model_id,executor_id,executor_version,request_fingerprint)
    references executor_attempt_exposures
    (workspace_id,development_run_id,attempt_number,provider_id,account_id,provider_model_id,executor_id,executor_version,request_fingerprint),
  check ((identity_state='correlation_prepared' and session_id is null and turn_id is null)
    or (identity_state='session_observed' and session_id is not null and turn_id is null)
    or (identity_state='turn_observed' and session_id is not null and turn_id is not null)),
  check (correlation_fingerprint=encode(sha256(convert_to(concat_ws(chr(10), 'pac.executor.provider-correlation.v1',
    workspace_id::text,development_run_id,attempt_number::text,base_request_fingerprint,provider_id,provider_model_id,account_id,executor_id,executor_version),'UTF8')),'hex'))
);
-- A provider session cannot silently become another PAC attempt/workspace on the same account.
create unique index executor_provider_session_unique on executor_provider_executions(provider_id,account_id,session_id) where session_id is not null;
create table executor_provider_identity_events (
  workspace_id uuid not null,
  development_run_id text not null,
  attempt_number integer not null,
  event_version integer not null,
  identity_state text not null,
  recovery_required boolean not null,
  session_id text,
  turn_id text,
  created_at timestamptz not null,
  primary key (workspace_id,development_run_id,attempt_number,event_version),
  unique (workspace_id,development_run_id,attempt_number,event_version,identity_state,recovery_required),
  foreign key (workspace_id,development_run_id,attempt_number) references executor_provider_executions(workspace_id,development_run_id,attempt_number)
);
alter table executor_provider_executions add constraint executor_provider_current_event_fk
  foreign key (workspace_id,development_run_id,attempt_number,event_version,identity_state,recovery_required)
  references executor_provider_identity_events(workspace_id,development_run_id,attempt_number,event_version,identity_state,recovery_required)
  deferrable initially deferred;
create trigger executor_provider_event_immutable before update or delete on executor_provider_identity_events
  for each row execute function guard_executor_journal();

create function guard_executor_provider_identity() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Executor provider identity is immutable'; end if;
  if tg_op='INSERT' then
    if new.identity_state<>'correlation_prepared' or new.event_version<>1 or new.recovery_required or new.updated_at<>new.created_at
      or not exists (select 1 from executor_attempt_exposures e where e.workspace_id=new.workspace_id
        and e.development_run_id=new.development_run_id and e.attempt_number=new.attempt_number
        and e.state='start_committed' and e.started_at is not null and e.authority_generation is not null and e.started_at<=new.created_at)
      or not exists (select 1 from executor_attempt_events j where j.workspace_id=new.workspace_id
        and j.development_run_id=new.development_run_id and j.attempt_number=new.attempt_number and j.operation='start' and j.state='start_committed')
    then raise exception using errcode='23514',message='Executor provider start binding required'; end if;
  elsif (to_jsonb(new)-array['session_id','turn_id','identity_state','recovery_required','updated_at','event_version'])
    is distinct from (to_jsonb(old)-array['session_id','turn_id','identity_state','recovery_required','updated_at','event_version'])
    or new.updated_at<old.updated_at or new.event_version<>old.event_version+1
    or (old.session_id is not null and new.session_id is distinct from old.session_id)
    or (old.turn_id is not null and new.turn_id is distinct from old.turn_id)
    or (old.recovery_required and not new.recovery_required)
    or not ((old.identity_state='correlation_prepared' and new.identity_state='session_observed')
      or (old.identity_state='session_observed' and new.identity_state='turn_observed')
      or (new.identity_state=old.identity_state and not old.recovery_required and new.recovery_required))
  then raise exception using errcode='55000',message='Executor provider identity transition denied'; end if;
  return new;
end $$;
create trigger executor_provider_identity_guard before insert or update or delete on executor_provider_executions
  for each row execute function guard_executor_provider_identity();
create function require_executor_provider_identity_event() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from executor_provider_executions p where p.workspace_id=new.workspace_id
    and p.development_run_id=new.development_run_id and p.attempt_number=new.attempt_number
    and p.event_version=new.event_version and p.identity_state=new.identity_state and p.recovery_required=new.recovery_required
    and p.session_id is not distinct from new.session_id and p.turn_id is not distinct from new.turn_id and p.updated_at=new.created_at)
  then raise exception using errcode='23514',message='Executor provider identity journal denied'; end if;
  return new;
end $$;
create trigger executor_provider_event_binding before insert on executor_provider_identity_events
  for each row execute function require_executor_provider_identity_event();
