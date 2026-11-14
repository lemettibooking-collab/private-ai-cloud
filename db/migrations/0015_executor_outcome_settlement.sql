-- AI-041.1d: historical terminal proposal capture, NOT exact monetary reconciliation.
-- Existing rows/evidence are preserved; no legacy authority or result is invented.
alter table executor_attempt_exposures
  add column terminal_result_fingerprint text,
  add column settled_at timestamptz;

-- Replace only checks whose lifecycle vocabulary is extended. Find by expression rather
-- than relying on PostgreSQL's generated CHECK suffixes (old migrations stay immutable).
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='executor_attempt_exposures'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%state%'
  loop execute format('alter table executor_attempt_exposures drop constraint %I',c.conname); end loop;
end $$;
alter table executor_attempt_exposures
  add constraint executor_exposure_state_check check (state in ('reserved','prepared','start_committed','reconciliation_required','cancelled','settled')),
  add constraint executor_exposure_lifecycle_check check (
    (state='reserved' and request_fingerprint is null and prepared_at is null and started_at is null)
    or (state='prepared' and request_fingerprint is not null and prepared_at is not null and started_at is null)
    or (state in ('start_committed','reconciliation_required','settled') and request_fingerprint is not null and prepared_at is not null and started_at is not null)
    or (state='cancelled' and started_at is null and ((request_fingerprint is null and prepared_at is null) or (request_fingerprint is not null and prepared_at is not null)))),
  add constraint executor_exposure_reconciliation_check check (
    (state in ('reserved','prepared','cancelled') and reconciliation='not_started' and observed_input_tokens is null and provider_consumed_cents is null)
    or (state in ('start_committed','settled') and ((reconciliation='usage_unknown' and observed_input_tokens is null) or (reconciliation='partially_observed' and observed_input_tokens is not null)))
    or (state='reconciliation_required' and reconciliation='reconciliation_required')),
  add constraint executor_exposure_settlement_check check (
    (state='settled' and terminal_result_fingerprint is not null and terminal_result_fingerprint ~ '^[a-f0-9]{64}$'
      and settled_at is not null and started_at is not null and settled_at >= started_at and settled_at=updated_at
      and (provider_consumed_cents is null or provider_consumed_cents <= provider_spend_limit_cents))
    or (state<>'settled' and terminal_result_fingerprint is null and settled_at is null)),
  add constraint executor_exposure_terminal_unique unique (workspace_id,development_run_id,attempt_number,state,request_fingerprint,terminal_result_fingerprint);
create function reject_executor_settled_insert() returns trigger language plpgsql as $$
begin
  if new.state='settled' then raise exception using errcode='23514',message='Executor settlement requires a prior start'; end if;
  return new;
end $$;
create trigger executor_settled_insert_guard before insert on executor_attempt_exposures
  for each row execute function reject_executor_settled_insert();

create table executor_attempt_results (
  workspace_id uuid not null,
  development_run_id text not null,
  attempt_number integer not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  result_fingerprint text not null check (result_fingerprint ~ '^[a-f0-9]{64}$'),
  exposure_state text not null default 'settled' check (exposure_state='settled'),
  outcome text not null check (outcome in ('succeeded','rejected','failed')),
  failure_code text,
  payload text not null check (octet_length(payload) between 1 and 2097152),
  provenance text not null check (provenance in ('definitive_terminal','rejected_before_execution','not_transmitted')),
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, development_run_id, attempt_number),
  unique (workspace_id,development_run_id,attempt_number,request_fingerprint,result_fingerprint),
  foreign key (workspace_id,development_run_id,attempt_number,exposure_state,request_fingerprint,result_fingerprint)
    references executor_attempt_exposures(workspace_id,development_run_id,attempt_number,state,request_fingerprint,terminal_result_fingerprint)
    deferrable initially deferred,
  check ((outcome='succeeded' and failure_code is null)
    or (outcome='rejected' and failure_code is not null and failure_code in ('unsupported','policy_rejected'))
    or (outcome='failed' and failure_code is not null and failure_code in ('timeout','provider_failure','execution_failure'))),
  check ((provenance='definitive_terminal') or (provenance='rejected_before_execution' and outcome='rejected') or (provenance='not_transmitted' and outcome='failed')),
  check (jsonb_typeof(payload::jsonb)='object' and (payload::jsonb)->>'status'=outcome
    and ((payload::jsonb)->>'failureCode') is not distinct from failure_code)
);
alter table executor_attempt_exposures add constraint executor_settled_result_fk
  foreign key (workspace_id,development_run_id,attempt_number,request_fingerprint,terminal_result_fingerprint)
  references executor_attempt_results(workspace_id,development_run_id,attempt_number,request_fingerprint,result_fingerprint)
  deferrable initially deferred;
create trigger executor_result_immutable before update or delete on executor_attempt_results
  for each row execute function guard_executor_journal();

create function require_executor_result_binding() returns trigger language plpgsql as $$
declare e executor_attempt_exposures; p jsonb; begin
  select * into e from executor_attempt_exposures where workspace_id=new.workspace_id
    and development_run_id=new.development_run_id and attempt_number=new.attempt_number;
  p := new.payload::jsonb;
  if e.id is null or e.state not in ('start_committed','reconciliation_required','settled')
    or e.started_at is null or new.recorded_at < e.started_at
    or not exists (select 1 from executor_attempt_events j where j.workspace_id=new.workspace_id
      and j.development_run_id=new.development_run_id and j.attempt_number=new.attempt_number
      and j.operation='start' and j.state='start_committed')
    or new.request_fingerprint is distinct from e.request_fingerprint
    or new.result_fingerprint <> encode(sha256(convert_to(new.payload,'UTF8')),'hex')
    or (p->>'schemaVersion') is distinct from '1'
    or (p->'identity'->>'id') is distinct from e.executor_id
    or (p->'identity'->>'version') is distinct from e.executor_version
    or (p->>'invocationId') is distinct from e.invocation_id
    or (p->>'planId') is distinct from e.plan_id or (p->>'taskId') is distinct from e.task_id
    or (p->'repository'->>'id') is distinct from e.repository_id
    or (p->'repository'->>'baseline') is distinct from e.repository_baseline
    or (p->'attempt'->>'developmentRunId') is distinct from e.development_run_id
    or (p->'attempt'->>'number') is distinct from e.attempt_number::text
    or (p->'attempt'->>'kind') is distinct from e.attempt_kind
    or (p->>'verificationStatus') is distinct from 'not_run'
    or (p->>'ownerDecisionRequired') is distinct from 'true'
    or (p->>'automaticRetryAllowed') is distinct from 'false'
  then raise exception using errcode='23514',message='Executor result binding denied'; end if;
  return new;
end $$;
create trigger executor_result_binding before insert on executor_attempt_results
  for each row execute function require_executor_result_binding();

do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='executor_attempt_events'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%operation%'
  loop execute format('alter table executor_attempt_events drop constraint %I',c.conname); end loop;
end $$;
alter table executor_attempt_events add constraint executor_event_operation_check check (
  (operation='reserve' and state='reserved') or (operation='prepare' and state='prepared')
  or (operation='start' and state='start_committed') or (operation='cancel' and state='cancelled')
  or (operation='reconcile' and state='reconciliation_required')
  or (operation='observe' and state in ('start_committed','reconciliation_required'))
  or (operation='settle' and state='settled'));
create unique index executor_one_settle_event on executor_attempt_events(workspace_id,development_run_id,attempt_number)
  where operation='settle';
create function require_executor_settle_event() returns trigger language plpgsql as $$
begin
  if new.operation='settle' and not exists (select 1 from executor_attempt_exposures e
    join executor_attempt_results r on r.workspace_id=e.workspace_id and r.development_run_id=e.development_run_id
      and r.attempt_number=e.attempt_number and r.result_fingerprint=e.terminal_result_fingerprint
    where e.workspace_id=new.workspace_id and e.development_run_id=new.development_run_id
      and e.attempt_number=new.attempt_number and e.event_version=new.event_version and e.state='settled') then
    raise exception using errcode='23514',message='Executor settlement journal denied';
  end if;
  return new;
end $$;
create trigger executor_settle_event_binding before insert on executor_attempt_events
  for each row execute function require_executor_settle_event();

create or replace function guard_executor_attempt_update() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Executor evidence is immutable'; end if;
  if (to_jsonb(new) - array['state','reconciliation','request_fingerprint','prepared_at','started_at','updated_at','event_version',
        'observed_input_tokens','observed_output_tokens','observed_total_tokens','provider_consumed_cents','terminal_result_fingerprint','settled_at'])
    is distinct from (to_jsonb(old) - array['state','reconciliation','request_fingerprint','prepared_at','started_at','updated_at','event_version',
        'observed_input_tokens','observed_output_tokens','observed_total_tokens','provider_consumed_cents','terminal_result_fingerprint','settled_at'])
    or new.event_version <> old.event_version + 1 or new.updated_at < old.updated_at
    or (old.request_fingerprint is not null and new.request_fingerprint is distinct from old.request_fingerprint)
    or (old.prepared_at is not null and new.prepared_at is distinct from old.prepared_at)
    or (old.started_at is not null and new.started_at is distinct from old.started_at)
    or not ((old.state='reserved' and new.state in ('prepared','cancelled'))
      or (old.state='prepared' and new.state in ('start_committed','cancelled'))
      or (old.state='start_committed' and new.state in ('start_committed','reconciliation_required','settled'))
      or (old.state='reconciliation_required' and new.state in ('reconciliation_required','settled')))
    or (old.observed_input_tokens is not null and (new.observed_input_tokens is null or new.observed_input_tokens < old.observed_input_tokens or new.observed_output_tokens < old.observed_output_tokens))
    or (old.provider_consumed_cents is not null and (new.provider_consumed_cents is null or new.provider_consumed_cents < old.provider_consumed_cents))
    or (new.state='settled' and new.provider_consumed_cents > new.provider_spend_limit_cents)
  then raise exception using errcode='55000',message='Executor transition denied'; end if;
  return new;
end $$;

-- Enforce the final aggregate, not an intermediate statement order. Together with the
-- cyclic result and journal FKs this rejects release-without-result, even via direct SQL.
create function require_executor_held_integrity() returns trigger language plpgsql as $$
declare held bigint; actual bigint; begin
  select held_exposure_usd_micros into held from executor_exposure_budgets where workspace_id=new.workspace_id for update;
  select coalesce(sum(maximum_exposure_usd_micros),0) into actual from executor_attempt_exposures
    where workspace_id=new.workspace_id and state not in ('cancelled','settled');
  if held is distinct from actual then raise exception using errcode='23514',message='Executor held integrity denied'; end if;
  if tg_table_name='executor_attempt_exposures' then
    if new.state='settled' and not exists (select 1 from executor_attempt_results r where r.workspace_id=new.workspace_id
      and r.development_run_id=new.development_run_id and r.attempt_number=new.attempt_number
      and r.result_fingerprint=new.terminal_result_fingerprint and r.recorded_at=new.settled_at) then
      raise exception using errcode='23514',message='Executor settlement evidence denied';
    end if;
  end if;
  return null;
end $$;
create constraint trigger executor_budget_held_integrity after insert or update on executor_exposure_budgets
  deferrable initially deferred for each row execute function require_executor_held_integrity();
create constraint trigger executor_exposure_held_integrity after insert or update on executor_attempt_exposures
  deferrable initially deferred for each row execute function require_executor_held_integrity();
drop index executor_attempt_held_idx;
create index executor_attempt_held_idx on executor_attempt_exposures(workspace_id) where state not in ('cancelled','settled');
