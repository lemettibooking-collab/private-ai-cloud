begin;

alter table audit_events
  add column actor_kind text,
  add column actor_id text,
  add column runtime_run_id text,
  add column runtime_event_key text,
  add constraint audit_events_runtime_actor_check check (
    (runtime_event_key is null and actor_kind is null and actor_id is null and runtime_run_id is null)
    or
    (runtime_event_key is not null
      and actor_kind is not null
      and actor_id is not null
      and runtime_run_id is not null
      and actor_kind in ('owner', 'workflow_runtime', 'agent_runtime')
      and actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
      and runtime_run_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
      and runtime_event_key ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$')
  );

create unique index audit_events_workspace_runtime_event_unique
  on audit_events (workspace_id, runtime_event_key)
  where runtime_event_key is not null;

create index audit_events_workspace_runtime_run_created_idx
  on audit_events (workspace_id, runtime_run_id, created_at desc)
  where runtime_run_id is not null;

alter table workflow_runs
  add constraint workflow_runs_workspace_id_id_unique unique (workspace_id, id);

alter table workflow_runtime_executions
  add constraint workflow_runtime_executions_workspace_run_id_unique
    unique (workspace_id, run_id, id);

create table workflow_model_invocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  workflow_execution_id uuid not null references workflow_runtime_executions(id) on delete restrict,
  invocation_id text not null,
  run_revision bigint not null,
  project_id text not null,
  workflow_id text not null,
  agent_id text not null,
  agent_binding_id text not null,
  step_id text not null,
  attempt_number integer not null,
  model_profile_id text not null,
  request_fingerprint text not null,
  reservation_token uuid not null,
  status text not null,
  provider_id text not null,
  deployment_id text not null,
  provider_model_id text not null,
  provider_model_version text not null,
  outcome text,
  finish_reason text,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  latency_ms bigint,
  cost_usd_micros bigint,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint workflow_model_invocations_run_invocation_unique
    unique (workflow_run_id, invocation_id),
  constraint workflow_model_invocations_execution_unique
    unique (workflow_execution_id),
  constraint workflow_model_invocations_reservation_token_unique
    unique (reservation_token),
  constraint workflow_model_invocations_workspace_run_fk
    foreign key (workspace_id, workflow_run_id)
    references workflow_runs (workspace_id, id) on delete cascade,
  constraint workflow_model_invocations_workspace_execution_fk
    foreign key (workspace_id, workflow_run_id, workflow_execution_id)
    references workflow_runtime_executions (workspace_id, run_id, id) on delete restrict,
  constraint workflow_model_invocations_identity_check check (
    invocation_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and project_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and workflow_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and agent_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and agent_binding_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and step_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and model_profile_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and char_length(provider_id) between 1 and 256
    and char_length(deployment_id) between 1 and 256
    and char_length(provider_model_id) between 1 and 256
    and char_length(provider_model_version) between 1 and 256
  ),
  constraint workflow_model_invocations_revision_check check (run_revision >= 0),
  constraint workflow_model_invocations_attempt_check check (attempt_number >= 1),
  constraint workflow_model_invocations_fingerprint_check check (
    request_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint workflow_model_invocations_status_check check (
    status in ('running', 'succeeded', 'failed', 'outcome_unknown')
  ),
  constraint workflow_model_invocations_result_check check (
    (status = 'running'
      and completed_at is null
      and outcome is null
      and finish_reason is null
      and input_tokens is null
      and output_tokens is null
      and total_tokens is null
      and latency_ms is null
      and cost_usd_micros is null
      and error_code is null)
    or
    (status = 'succeeded'
      and completed_at is not null
      and outcome is not null
      and outcome = 'succeeded'
      and finish_reason is not null
      and input_tokens is not null
      and output_tokens is not null
      and total_tokens is not null
      and latency_ms is not null
      and cost_usd_micros is not null
      and error_code is null)
    or
    (status = 'failed'
      and completed_at is not null
      and outcome is not null
      and outcome = 'failed'
      and finish_reason is not null
      and input_tokens is not null
      and output_tokens is not null
      and total_tokens is not null
      and latency_ms is not null
      and cost_usd_micros is not null)
    or
    (status = 'failed'
      and completed_at is not null
      and outcome is null
      and finish_reason is null
      and input_tokens is null
      and output_tokens is null
      and total_tokens is null
      and latency_ms is null
      and cost_usd_micros is null
      and error_code is not null)
    or
    (status = 'outcome_unknown'
      and completed_at is not null
      and outcome is null
      and finish_reason is null
      and input_tokens is null
      and output_tokens is null
      and total_tokens is null
      and latency_ms is null
      and cost_usd_micros is null
      and error_code is not null)
  ),
  constraint workflow_model_invocations_usage_check check (
    (input_tokens is null or input_tokens between 0 and 9000000000)
    and (output_tokens is null or output_tokens between 0 and 9000000000)
    and (total_tokens is null or total_tokens between 0 and 9000000000)
    and (latency_ms is null or latency_ms between 0 and 86400000)
    and (cost_usd_micros is null or cost_usd_micros between 0 and 9000000000000)
    and (error_code is null or char_length(error_code) between 1 and 128)
  ),
  constraint workflow_model_invocations_usage_arithmetic_check check (
    total_tokens is null or total_tokens = input_tokens + output_tokens
  ),
  constraint workflow_model_invocations_enums_check check (
    outcome is null or outcome in ('succeeded', 'failed')
  ),
  constraint workflow_model_invocations_finish_reason_check check (
    finish_reason is null or finish_reason in ('stop', 'length', 'tool_calls', 'content_filter', 'error')
  ),
  constraint workflow_model_invocations_timestamps_check check (
    started_at >= created_at and (completed_at is null or completed_at >= started_at)
  )
);

create index workflow_model_invocations_workspace_run_created_idx
  on workflow_model_invocations (workspace_id, workflow_run_id, created_at desc);

create index workflow_model_invocations_workspace_status_created_idx
  on workflow_model_invocations (workspace_id, status, created_at desc);

commit;
