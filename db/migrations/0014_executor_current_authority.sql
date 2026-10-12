-- AI-041.1c. Narrow current start authority; NOT a persisted AI-011 lifecycle.
-- No ProjectTask FK: DevelopmentTask IDs are a different domain.
create table executor_run_authorities (
  workspace_id uuid not null references workspaces(id),
  development_run_id text not null check (development_run_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  authority_generation integer not null check (authority_generation between 1 and 1000000),
  authority_status text not null check (authority_status in ('active','revoked')),
  project_key text not null,
  plan_id text not null check (plan_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  task_id text not null check (task_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  current_attempt_number integer not null check (current_attempt_number between 1 and 3),
  current_attempt_kind text not null,
  canonical_run_fingerprint text not null check (canonical_run_fingerprint ~ '^[a-f0-9]{64}$'),
  admission_fingerprint text not null check (admission_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revoked_at timestamptz,
  primary key (workspace_id,development_run_id),
  foreign key (workspace_id,project_key) references projects(workspace_id,project_key),
  check ((current_attempt_number=1 and current_attempt_kind='initial') or (current_attempt_number in (2,3) and current_attempt_kind='corrective')),
  check (updated_at >= created_at),
  check ((authority_status='active' and revoked_at is null)
    or (authority_status='revoked' and revoked_at is not null and revoked_at=updated_at and revoked_at>=created_at))
);
create table executor_authority_events (
  workspace_id uuid not null,
  development_run_id text not null,
  authority_generation integer not null check (authority_generation between 1 and 1000000),
  authority_status text not null check (authority_status in ('active','revoked')),
  project_key text not null,
  plan_id text not null,
  task_id text not null,
  current_attempt_number integer not null check (current_attempt_number between 1 and 3),
  current_attempt_kind text not null,
  canonical_run_fingerprint text not null check (canonical_run_fingerprint ~ '^[a-f0-9]{64}$'),
  admission_fingerprint text not null check (admission_fingerprint ~ '^[a-f0-9]{64}$'),
  operation text not null check (operation in ('register','advance','revoke')),
  created_at timestamptz not null,
  primary key (workspace_id,development_run_id,authority_generation),
  unique (workspace_id,development_run_id,authority_generation,authority_status,project_key,plan_id,task_id,
    current_attempt_number,current_attempt_kind,canonical_run_fingerprint,admission_fingerprint),
  unique (workspace_id,development_run_id,authority_generation,project_key,plan_id,task_id,
    current_attempt_number,current_attempt_kind,canonical_run_fingerprint,admission_fingerprint),
  foreign key (workspace_id,development_run_id) references executor_run_authorities(workspace_id,development_run_id),
  check ((current_attempt_number=1 and current_attempt_kind='initial') or (current_attempt_number in (2,3) and current_attempt_kind='corrective')),
  check ((operation in ('register','advance') and authority_status='active') or (operation='revoke' and authority_status='revoked'))
);
alter table executor_run_authorities add constraint executor_authority_current_event_fk
  foreign key (workspace_id,development_run_id,authority_generation,authority_status,project_key,plan_id,task_id,
    current_attempt_number,current_attempt_kind,canonical_run_fingerprint,admission_fingerprint)
  references executor_authority_events(workspace_id,development_run_id,authority_generation,authority_status,project_key,plan_id,task_id,
    current_attempt_number,current_attempt_kind,canonical_run_fingerprint,admission_fingerprint) deferrable initially deferred;
create trigger executor_authority_journal_guard before update or delete on executor_authority_events
  for each row execute function guard_executor_journal();

create function guard_executor_authority_update() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Executor authority is immutable'; end if;
  if (to_jsonb(new) - array['authority_generation','authority_status','current_attempt_number','current_attempt_kind','canonical_run_fingerprint','updated_at','revoked_at'])
    is distinct from (to_jsonb(old) - array['authority_generation','authority_status','current_attempt_number','current_attempt_kind','canonical_run_fingerprint','updated_at','revoked_at'])
    or new.authority_generation <> old.authority_generation + 1
    or new.updated_at < old.updated_at
    or not (
      (old.authority_status='active' and new.authority_status='revoked'
        and new.current_attempt_number=old.current_attempt_number and new.current_attempt_kind=old.current_attempt_kind
        and new.canonical_run_fingerprint=old.canonical_run_fingerprint)
      or (new.authority_status='active' and new.current_attempt_number=old.current_attempt_number+1
        and new.current_attempt_kind='corrective' and new.canonical_run_fingerprint<>old.canonical_run_fingerprint))
  then raise exception using errcode='55000',message='Executor authority transition denied'; end if;
  return new;
end $$;
create trigger executor_authority_update_guard before update or delete on executor_run_authorities
  for each row execute function guard_executor_authority_update();
create function guard_executor_authority_insert() returns trigger language plpgsql as $$
begin
  if new.authority_generation<>1 or new.authority_status<>'active' or new.created_at<>new.updated_at then
    raise exception using errcode='23514',message='Executor initial authority denied';
  end if;
  return new;
end $$;
create trigger executor_authority_insert_guard before insert on executor_run_authorities
  for each row execute function guard_executor_authority_insert();
create function guard_executor_authority_event_insert() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from executor_run_authorities a where a.workspace_id=new.workspace_id and a.development_run_id=new.development_run_id
    and a.authority_generation=new.authority_generation and a.authority_status=new.authority_status and a.project_key=new.project_key
    and a.plan_id=new.plan_id and a.task_id=new.task_id and a.current_attempt_number=new.current_attempt_number
    and a.current_attempt_kind=new.current_attempt_kind and a.canonical_run_fingerprint=new.canonical_run_fingerprint
    and a.admission_fingerprint=new.admission_fingerprint and a.updated_at=new.created_at)
    or not ((new.operation='register' and new.authority_generation=1)
      or (new.operation='advance' and new.authority_generation>1 and new.current_attempt_number>1)
      or (new.operation='revoke' and new.authority_generation>1))
  then raise exception using errcode='23514',message='Executor authority event denied'; end if;
  return new;
end $$;
create trigger executor_authority_event_insert_guard before insert on executor_authority_events
  for each row execute function guard_executor_authority_event_insert();

-- Existing 0013 evidence is retained, NOT assigned fabricated authority. NULL legacy
-- bindings are quarantined from prepare/start; historical cancel/reconciliation remain possible.
alter table executor_attempt_exposures
  add column authority_generation integer,
  add column canonical_run_fingerprint text,
  add column admission_fingerprint text,
  add constraint executor_exposure_authority_shape check (
    (authority_generation is null and canonical_run_fingerprint is null and admission_fingerprint is null)
    or (authority_generation is not null and authority_generation between 1 and 1000000
      and canonical_run_fingerprint is not null and canonical_run_fingerprint ~ '^[a-f0-9]{64}$'
      and admission_fingerprint is not null and admission_fingerprint ~ '^[a-f0-9]{64}$')),
  add constraint executor_exposure_authority_event_fk foreign key
    (workspace_id,development_run_id,authority_generation,project_key,plan_id,task_id,attempt_number,attempt_kind,canonical_run_fingerprint,admission_fingerprint)
    references executor_authority_events
    (workspace_id,development_run_id,authority_generation,project_key,plan_id,task_id,current_attempt_number,current_attempt_kind,canonical_run_fingerprint,admission_fingerprint);
-- 0013's to_jsonb immutable-column guard also protects these three added columns.
create function guard_executor_exposure_authority() returns trigger language plpgsql as $$
begin
  if new.authority_generation is null and (tg_op='INSERT' or (new.state in ('prepared','start_committed') and new.state is distinct from old.state)) then
    raise exception using errcode='23514',message='Executor authority binding required';
  end if;
  return new;
end $$;
create trigger executor_exposure_authority_guard before insert or update on executor_attempt_exposures
  for each row execute function guard_executor_exposure_authority();
