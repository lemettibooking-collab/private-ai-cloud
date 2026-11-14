begin;

create table workflow_model_budget_windows (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id text not null,
  workflow_binding_id text not null,
  window_kind text not null,
  window_start date not null,
  reserved_amount bigint not null default 0,
  consumed_amount bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, project_id, workflow_binding_id, window_kind, window_start),
  constraint workflow_model_budget_windows_identity_check check (
    project_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and workflow_binding_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  constraint workflow_model_budget_windows_kind_check check (
    window_kind in ('daily_tokens', 'monthly_cost')
  ),
  constraint workflow_model_budget_windows_month_check check (
    window_kind <> 'monthly_cost' or extract(day from window_start) = 1
  ),
  constraint workflow_model_budget_windows_amount_check check (
    reserved_amount >= 0 and consumed_amount >= 0
  )
);

create table workflow_model_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  workflow_execution_id uuid not null references workflow_runtime_executions(id) on delete restrict,
  model_invocation_id uuid not null unique references workflow_model_invocations(id) on delete restrict,
  invocation_id text not null,
  project_id text not null,
  department_id text not null,
  workflow_id text not null,
  workflow_binding_id text not null,
  workflow_binding_version bigint not null,
  step_id text not null,
  attempt_number integer not null,
  request_fingerprint text not null,
  input_envelope_fingerprint text not null,
  canonical_request_fingerprint text not null,
  provider_id text not null,
  deployment_id text not null,
  provider_model_id text not null,
  provider_request_model_id text not null,
  provider_model_version text not null,
  input_token_count bigint not null,
  effective_max_output_tokens bigint not null,
  reserved_total_tokens bigint not null,
  reserved_cost_usd_micros bigint not null,
  daily_token_budget bigint not null,
  monthly_cost_budget_usd_micros bigint not null,
  daily_window_start date not null,
  monthly_window_start date not null,
  actual_total_tokens bigint,
  actual_cost_usd_micros bigint,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_model_budget_reservations_run_invocation_unique
    unique (workflow_run_id, invocation_id),
  constraint workflow_model_budget_reservations_workspace_run_fk
    foreign key (workspace_id, workflow_run_id)
    references workflow_runs (workspace_id, id) on delete cascade,
  constraint workflow_model_budget_reservations_workspace_execution_fk
    foreign key (workspace_id, workflow_run_id, workflow_execution_id)
    references workflow_runtime_executions (workspace_id, run_id, id) on delete restrict,
  constraint workflow_model_budget_reservations_identity_check check (
    invocation_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and project_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and department_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and workflow_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and workflow_binding_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and step_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    and workflow_binding_version >= 1
    and attempt_number >= 1
  ),
  constraint workflow_model_budget_reservations_fingerprint_check check (
    request_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and input_envelope_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and canonical_request_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint workflow_model_budget_reservations_provider_check check (
    char_length(provider_id) between 1 and 256
    and char_length(deployment_id) between 1 and 256
    and char_length(provider_model_id) between 1 and 256
    and char_length(provider_request_model_id) between 1 and 256
    and char_length(provider_model_version) between 1 and 256
  ),
  constraint workflow_model_budget_reservations_amount_check check (
    input_token_count >= 0
    and effective_max_output_tokens > 0
    and reserved_total_tokens = input_token_count + effective_max_output_tokens
    and reserved_cost_usd_micros >= 0
    and daily_token_budget >= 0
    and monthly_cost_budget_usd_micros >= 0
    and (actual_total_tokens is null or actual_total_tokens >= 0)
    and (actual_cost_usd_micros is null or actual_cost_usd_micros >= 0)
  ),
  constraint workflow_model_budget_reservations_window_check check (
    extract(day from monthly_window_start) = 1
  ),
  constraint workflow_model_budget_reservations_status_check check (
    status in ('reserved', 'settled', 'released', 'outcome_unknown')
  ),
  constraint workflow_model_budget_reservations_result_check check (
    (status = 'settled' and actual_total_tokens is not null and actual_cost_usd_micros is not null)
    or
    (status in ('reserved', 'released', 'outcome_unknown')
      and actual_total_tokens is null and actual_cost_usd_micros is null)
  )
);

create index workflow_model_budget_reservations_scope_status_idx
  on workflow_model_budget_reservations (
    workspace_id, project_id, workflow_binding_id, status, created_at
  );

commit;
