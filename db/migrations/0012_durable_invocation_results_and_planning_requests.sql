-- AI-039.1: ledger-backed AI FeaturePlan planning.
--
-- 1. workflow_model_invocation_results — a narrow, generic pull-forward of AI-037.2 (Durable Step
--    Result). The validated text output of a SUCCEEDED model invocation is stored exactly once, in the
--    SAME transaction that settles the invocation's usage / cost / budget (the ledger's recordOutcome).
--    A result therefore survives a later Run snapshot commit failure, and no consumer ever needs a
--    second provider dispatch to recover it. Rows are immutable and bound to their invocation and Run
--    in the same workspace (composite FKs). output_fingerprint is sha256 of the UTF-8 text; readers
--    re-fingerprint and fail closed on any disagreement. No prompt, credential or provider payload is
--    stored here: only the provider-neutral output text of the invocation.
--
-- 2. project_task_planning_requests — the Owner's explicit request for ONE AI FeaturePlan candidate
--    for a ProjectTask. Idempotent by (workspace, idempotency_key) + request fingerprint (same key +
--    same request → replay, never a second dispatch; same key + different request → conflict). Each
--    request names the real persisted planning Workflow Run that performs the one bounded invocation
--    through the existing runtime lifecycle (no parallel ledger). A request is `started` and is
--    settled exactly once with the runtime outcome; settled rows are immutable. `completed` means the
--    Run produced a durable invocation result (output_fingerprint); whether that output is a valid
--    candidate is re-derived deterministically from the durable result on every read, so the candidate
--    is never stored twice. Nothing here changes the ProjectTask or creates a FeaturePlan revision.
-- * Nothing is seeded.

create table workflow_model_invocation_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workflow_run_id uuid not null,
  model_invocation_id uuid not null,
  output_text text not null,
  output_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint workflow_model_invocation_results_invocation_unique unique (model_invocation_id),
  constraint workflow_model_invocation_results_output_text_check
    check (char_length(output_text) between 1 and 131072),
  constraint workflow_model_invocation_results_output_fingerprint_check
    check (output_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint workflow_model_invocation_results_run_fk foreign key (workspace_id, workflow_run_id)
    references workflow_runs (workspace_id, id) on delete cascade,
  constraint workflow_model_invocation_results_invocation_fk foreign key (workspace_id, workflow_run_id, model_invocation_id)
    references workflow_model_invocations (workspace_id, workflow_run_id, id) on delete cascade
);

-- A result exists only for a succeeded invocation, written while that invocation is settled.
create function require_succeeded_model_invocation_result() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from workflow_model_invocations
    where id = new.model_invocation_id and workspace_id = new.workspace_id
      and workflow_run_id = new.workflow_run_id and status = 'succeeded' and outcome = 'succeeded'
  ) then
    raise exception using errcode = '23514', constraint = 'workflow_model_invocation_results_succeeded_check',
      message = 'A durable invocation result requires a succeeded invocation.';
  end if;
  return new;
end;
$$;

create trigger workflow_model_invocation_results_succeeded
before insert on workflow_model_invocation_results
for each row execute function require_succeeded_model_invocation_result();

create function reject_model_invocation_result_update() returns trigger
language plpgsql as $$
begin
  raise exception using errcode = '55000', message = 'Durable invocation results are immutable.';
end;
$$;

create trigger workflow_model_invocation_results_immutable
before update on workflow_model_invocation_results
for each row execute function reject_model_invocation_result_update();

create table project_task_planning_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_key text not null,
  task_key text not null,
  planning_key text not null,
  -- The real persisted planning Workflow Run (workflow_runs.runtime_id) of this request. The Run is
  -- created by the runtime's own transaction after this row commits, so the link is checked by the
  -- planning service and every reader joins on (workspace, project, runtime id), never trusting it.
  run_id text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  -- Trusted provider identity the Owner approved the data egress for (non-secret configuration).
  provider_id text not null,
  provider_model_id text not null,
  requested_by uuid references users(id) on delete set null,
  status text not null,
  outcome text,
  output_fingerprint text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint project_task_planning_requests_planning_key_check
    check (planning_key ~ '^fpp-[0-9a-f]{20}$'),
  constraint project_task_planning_requests_run_id_check
    check (run_id = planning_key),
  constraint project_task_planning_requests_idempotency_key_check
    check (idempotency_key ~ '^pl-[0-9a-f]{32}$'),
  constraint project_task_planning_requests_request_fingerprint_check
    check (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint project_task_planning_requests_provider_check
    check (char_length(provider_id) between 1 and 256 and char_length(provider_model_id) between 1 and 256),
  constraint project_task_planning_requests_status_check
    check (
      (status = 'started' and outcome is null and output_fingerprint is null and settled_at is null)
      or (status = 'settled' and settled_at is not null and outcome in (
            'completed', 'budget_denied', 'provider_unavailable', 'planning_failed', 'recovery_required')
          and ((outcome = 'completed') = (output_fingerprint is not null))
          and (output_fingerprint is null or output_fingerprint ~ '^sha256:[0-9a-f]{64}$'))
    ),
  constraint project_task_planning_requests_planning_key_unique unique (workspace_id, planning_key),
  constraint project_task_planning_requests_idempotency_unique unique (workspace_id, idempotency_key),
  -- Same-workspace, same-project ProjectTask (cross-tenant / cross-project requests are impossible).
  constraint project_task_planning_requests_task_fk foreign key (workspace_id, project_key, task_key)
    references project_tasks (workspace_id, project_key, task_key) on delete cascade
);

create index project_task_planning_requests_task_idx
  on project_task_planning_requests (workspace_id, task_key, created_at desc);

-- started → settled exactly once; identity columns never change; settled rows are immutable.
create function guard_project_task_planning_request_update() returns trigger
language plpgsql as $$
begin
  if old.status <> 'started' or new.status <> 'settled'
    or new.id <> old.id or new.workspace_id <> old.workspace_id or new.project_key <> old.project_key
    or new.task_key <> old.task_key or new.planning_key <> old.planning_key or new.run_id <> old.run_id
    or new.idempotency_key <> old.idempotency_key or new.request_fingerprint <> old.request_fingerprint
    or new.provider_id <> old.provider_id or new.provider_model_id <> old.provider_model_id
    or new.requested_by is distinct from old.requested_by or new.created_at <> old.created_at then
    raise exception using errcode = '55000', message = 'Planning requests settle exactly once.';
  end if;
  return new;
end;
$$;

create trigger project_task_planning_requests_settle_once
before update on project_task_planning_requests
for each row execute function guard_project_task_planning_request_update();

-- Exactly one audit event per started and per settled planning request (entity_id =
-- project_task_planning_requests.id): the last guard against a duplicate under any race.
create unique index audit_events_feature_plan_planning_event_unique on audit_events (workspace_id, event_type, entity_id)
  where event_type in ('task.feature_plan_planning_started', 'task.feature_plan_planning_settled');
