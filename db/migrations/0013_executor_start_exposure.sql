-- AI-041.1b: executor-only durable financial/start authority. No provider dispatch wiring.
-- One record per factual AI-011 attempt, NEVER per caller-selected invocation/mode/target.
-- All writers lock workspace budget BEFORE attempt. Micros remain held after start/ambiguity.
create table executor_exposure_budgets (
  workspace_id uuid primary key references workspaces(id),
  maximum_exposure_usd_micros bigint not null check (maximum_exposure_usd_micros between 10000 and 1000000000),
  total_exposure_usd_micros bigint not null check (total_exposure_usd_micros between 10000 and 1000000000),
  reservation_ttl_ms integer not null check (reservation_ttl_ms between 1 and 60000),
  held_exposure_usd_micros bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (held_exposure_usd_micros between 0 and total_exposure_usd_micros),
  check (maximum_exposure_usd_micros <= total_exposure_usd_micros)
);

create table executor_attempt_exposures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references executor_exposure_budgets(workspace_id),
  project_key text not null,
  development_run_id text not null check (development_run_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  attempt_number integer not null check (attempt_number between 1 and 3),
  attempt_kind text not null,
  plan_id text not null check (plan_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  task_id text not null check (task_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  executor_id text not null check (executor_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  executor_version text not null check (executor_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  invocation_id text not null check (invocation_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  repository_id text not null check (repository_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  repository_baseline text not null check (repository_baseline ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  capability text not null,
  mode text not null,
  provider_id text not null check (provider_id = 'openai'),
  provider_model_id text not null check (provider_model_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  account_id text not null check (account_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  invocation_fingerprint text not null check (invocation_fingerprint ~ '^[a-f0-9]{64}$'),
  maximum_exposure_usd_micros bigint not null check (maximum_exposure_usd_micros between 10000 and 1000000000),
  provider_spend_limit_cents bigint not null,
  request_fingerprint text check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('reserved','prepared','start_committed','reconciliation_required','cancelled')),
  reconciliation text not null check (reconciliation in ('not_started','usage_unknown','partially_observed','reconciliation_required')),
  observed_input_tokens bigint,
  observed_output_tokens bigint,
  observed_total_tokens bigint,
  provider_consumed_cents bigint check (provider_consumed_cents between 0 and 1000000000),
  event_version integer not null check (event_version between 1 and 1000000),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null,
  prepared_at timestamptz,
  started_at timestamptz,
  constraint executor_attempt_unique unique (workspace_id, development_run_id, attempt_number),
  foreign key (workspace_id, project_key) references projects(workspace_id, project_key),
  check ((attempt_number = 1 and attempt_kind = 'initial') or (attempt_number in (2,3) and attempt_kind = 'corrective')),
  check ((capability = 'coding' and mode = 'patch_proposal') or (capability = 'repository_analysis' and mode = 'analysis_only')),
  check (provider_spend_limit_cents = maximum_exposure_usd_micros / 10000 and provider_spend_limit_cents > 0),
  check (created_at <= updated_at and expires_at > created_at and expires_at <= created_at + interval '60 seconds'),
  check (prepared_at is null or (prepared_at >= created_at and prepared_at <= updated_at)),
  check (started_at is null or (started_at >= prepared_at and started_at <= updated_at)),
  check ((state = 'reserved' and request_fingerprint is null and prepared_at is null and started_at is null)
    or (state = 'prepared' and request_fingerprint is not null and prepared_at is not null and started_at is null)
    or (state in ('start_committed','reconciliation_required') and request_fingerprint is not null and prepared_at is not null and started_at is not null)
    or (state = 'cancelled' and started_at is null and ((request_fingerprint is null and prepared_at is null) or (request_fingerprint is not null and prepared_at is not null)))),
  -- Explicit NULL tests: PostgreSQL CHECK accepts UNKNOWN, which must not admit partial usage.
  check ((observed_input_tokens is null and observed_output_tokens is null and observed_total_tokens is null)
    or (observed_input_tokens is not null and observed_output_tokens is not null and observed_total_tokens is not null
      and observed_input_tokens between 0 and 1000000000 and observed_output_tokens between 0 and 1000000000
      and observed_total_tokens between 0 and 1000000000 and observed_total_tokens = observed_input_tokens + observed_output_tokens)),
  check ((state in ('reserved','prepared','cancelled') and reconciliation = 'not_started' and observed_input_tokens is null and provider_consumed_cents is null)
    or (state = 'start_committed' and ((reconciliation = 'usage_unknown' and observed_input_tokens is null) or (reconciliation = 'partially_observed' and observed_input_tokens is not null)))
    or (state = 'reconciliation_required' and reconciliation = 'reconciliation_required'))
);
create index executor_attempt_held_idx on executor_attempt_exposures(workspace_id) where state <> 'cancelled';

-- Narrow immutable audit journal. Cyclic deferred FK requires the current state/version audit
-- in the SAME transaction, including reservation creation. No raw context/provider payloads.
create table executor_attempt_events (
  workspace_id uuid not null,
  development_run_id text not null,
  attempt_number integer not null,
  event_version integer not null check (event_version between 1 and 1000000),
  state text not null,
  operation text not null check (operation in ('reserve','prepare','start','cancel','reconcile','observe')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, development_run_id, attempt_number, event_version),
  unique (workspace_id, development_run_id, attempt_number, event_version, state),
  foreign key (workspace_id, development_run_id, attempt_number)
    references executor_attempt_exposures(workspace_id, development_run_id, attempt_number),
  check ((operation = 'reserve' and state = 'reserved') or (operation = 'prepare' and state = 'prepared')
    or (operation = 'start' and state = 'start_committed') or (operation = 'cancel' and state = 'cancelled')
    or (operation = 'reconcile' and state = 'reconciliation_required')
    or (operation = 'observe' and state in ('start_committed','reconciliation_required')))
);
alter table executor_attempt_exposures add constraint executor_attempt_current_audit_fk
  foreign key (workspace_id, development_run_id, attempt_number, event_version, state)
  references executor_attempt_events(workspace_id, development_run_id, attempt_number, event_version, state)
  deferrable initially deferred;

create function guard_executor_attempt_update() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode = '55000', message = 'Executor evidence is immutable'; end if;
  if (to_jsonb(new) - array['state','reconciliation','request_fingerprint','prepared_at','started_at','updated_at','event_version',
        'observed_input_tokens','observed_output_tokens','observed_total_tokens','provider_consumed_cents'])
    is distinct from (to_jsonb(old) - array['state','reconciliation','request_fingerprint','prepared_at','started_at','updated_at','event_version',
        'observed_input_tokens','observed_output_tokens','observed_total_tokens','provider_consumed_cents'])
    or new.event_version <> old.event_version + 1
    or (old.request_fingerprint is not null and new.request_fingerprint is distinct from old.request_fingerprint)
    or (old.prepared_at is not null and new.prepared_at is distinct from old.prepared_at)
    or (old.started_at is not null and new.started_at is distinct from old.started_at)
    or not ((old.state = 'reserved' and new.state in ('prepared','cancelled'))
      or (old.state = 'prepared' and new.state in ('start_committed','cancelled'))
      or (old.state = 'start_committed' and new.state in ('start_committed','reconciliation_required'))
      or (old.state = 'reconciliation_required' and new.state = 'reconciliation_required'))
    or (old.observed_input_tokens is not null and (new.observed_input_tokens is null or new.observed_input_tokens < old.observed_input_tokens or new.observed_output_tokens < old.observed_output_tokens))
    or (old.provider_consumed_cents is not null and (new.provider_consumed_cents is null or new.provider_consumed_cents < old.provider_consumed_cents))
  then raise exception using errcode = '55000', message = 'Executor transition denied'; end if;
  return new;
end $$;
create trigger executor_attempt_update_guard before update or delete on executor_attempt_exposures
  for each row execute function guard_executor_attempt_update();

create function guard_executor_journal() returns trigger language plpgsql as $$
begin raise exception using errcode = '55000', message = 'Executor audit is immutable'; end $$;
create trigger executor_journal_guard before update or delete on executor_attempt_events
  for each row execute function guard_executor_journal();

create function guard_executor_budget_policy() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['held_exposure_usd_micros','updated_at'])
    is distinct from (to_jsonb(old) - array['held_exposure_usd_micros','updated_at'])
  then raise exception using errcode = '55000', message = 'Executor budget policy is immutable'; end if;
  return new;
end $$;
create trigger executor_budget_policy_guard before update on executor_exposure_budgets
  for each row execute function guard_executor_budget_policy();
