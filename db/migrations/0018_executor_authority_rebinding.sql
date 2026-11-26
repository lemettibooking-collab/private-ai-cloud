-- AI-041.2 Phase R. Stable scope is factual only for NEW authorities; never backfill.
begin;
alter table executor_run_authorities add column admission_scope_fingerprint text
  check (admission_scope_fingerprint is null or admission_scope_fingerprint ~ '^[a-f0-9]{64}$');
alter table executor_authority_events add column admission_scope_fingerprint text
  check (admission_scope_fingerprint is null or admission_scope_fingerprint ~ '^[a-f0-9]{64}$');

create or replace function guard_executor_authority_update() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Executor authority is immutable'; end if;
  if (to_jsonb(new) - array['authority_generation','authority_status','current_attempt_number','current_attempt_kind','canonical_run_fingerprint','admission_fingerprint','updated_at','revoked_at'])
    is distinct from (to_jsonb(old) - array['authority_generation','authority_status','current_attempt_number','current_attempt_kind','canonical_run_fingerprint','admission_fingerprint','updated_at','revoked_at'])
    or new.authority_generation <> old.authority_generation + 1
    or new.updated_at < old.updated_at
    or not (
      (old.authority_status='active' and new.authority_status='revoked'
        and new.current_attempt_number=old.current_attempt_number and new.current_attempt_kind=old.current_attempt_kind
        and new.canonical_run_fingerprint=old.canonical_run_fingerprint
        and new.admission_fingerprint=old.admission_fingerprint)
      or (new.authority_status='active' and new.current_attempt_number=old.current_attempt_number+1
        and new.current_attempt_kind='corrective' and new.canonical_run_fingerprint<>old.canonical_run_fingerprint
        and (old.admission_scope_fingerprint is not null or new.admission_fingerprint=old.admission_fingerprint)))
  then raise exception using errcode='55000',message='Executor authority transition denied'; end if;
  return new;
end $$;

create or replace function guard_executor_authority_insert() returns trigger language plpgsql as $$
begin
  if new.authority_generation<>1 or new.authority_status<>'active' or new.created_at<>new.updated_at
    or new.admission_scope_fingerprint is null then
    raise exception using errcode='23514',message='Executor initial authority denied';
  end if;
  return new;
end $$;

create or replace function guard_executor_authority_event_insert() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from executor_run_authorities a where a.workspace_id=new.workspace_id and a.development_run_id=new.development_run_id
    and a.authority_generation=new.authority_generation and a.authority_status=new.authority_status and a.project_key=new.project_key
    and a.plan_id=new.plan_id and a.task_id=new.task_id and a.current_attempt_number=new.current_attempt_number
    and a.current_attempt_kind=new.current_attempt_kind and a.canonical_run_fingerprint=new.canonical_run_fingerprint
    and a.admission_fingerprint=new.admission_fingerprint and a.admission_scope_fingerprint is not distinct from new.admission_scope_fingerprint
    and a.updated_at=new.created_at)
    or not ((new.operation='register' and new.authority_generation=1)
      or (new.operation='advance' and new.authority_generation>1 and new.current_attempt_number>1)
      or (new.operation='revoke' and new.authority_generation>1))
  then raise exception using errcode='23514',message='Executor authority event denied'; end if;
  return new;
end $$;
commit;
