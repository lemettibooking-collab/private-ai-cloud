-- AI-041.2b2: schema eligibility only, NOT provider execution or financial parity.
-- One DO statement makes validation + replacement atomic even in autocommit runners.
do $$
declare
  provider_attribute smallint;
  provider_checks integer;
  old_check text;
begin
  lock table public.executor_attempt_exposures in access exclusive mode;
  select attnum into provider_attribute from pg_attribute
    where attrelid='public.executor_attempt_exposures'::regclass and attname='provider_id'
      and not attisdropped and attnotnull and atttypid='text'::regtype;
  if provider_attribute is null then
    raise exception using errcode='55000', message='Unexpected executor provider column';
  end if;

  -- Count ALL checks referencing this column: absent, duplicated or combined/drifted
  -- restrictions are not silently repaired. The original generated name is irrelevant.
  select count(*), min(conname::text) into provider_checks, old_check from pg_constraint
    where conrelid='public.executor_attempt_exposures'::regclass and contype='c'
      and provider_attribute=any(conkey);
  if provider_checks<>1 or not exists (
    select 1 from pg_constraint where conrelid='public.executor_attempt_exposures'::regclass
      and conname=old_check and contype='c' and conkey=array[provider_attribute]
      and convalidated and conislocal and coninhcount=0 and not connoinherit
      and not condeferrable and not condeferred
      and pg_get_expr(conbin,conrelid)='(provider_id = ''openai''::text)'
  ) then
    raise exception using errcode='55000', message='Unexpected executor provider constraint';
  end if;

  execute format('alter table public.executor_attempt_exposures drop constraint %I', old_check);
  alter table public.executor_attempt_exposures add constraint executor_exposure_provider_check
    check (provider_id in ('openai','anthropic'));
end $$;
