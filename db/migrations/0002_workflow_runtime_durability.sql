-- Private AI Cloud
-- Migration: 0002_workflow_runtime_durability
-- Purpose: Durable AI-030 Workflow Runtime state, ownership, command idempotency,
-- and crash-recovery execution intent for PostgreSQL.
-- Notes:
-- - Explicit/manual migration only; it is never run during application import.
-- - workflow_runs.runtime_snapshot is the canonical runtime source of truth.
-- - workflow_step_runs is a transactionally synchronized projection.
-- - No credentials, provider payloads, approval evidence, or model output bodies belong here.

begin;

alter table workflow_runs
  drop constraint workflow_runs_status_check;

alter table workflow_runs
  add constraint workflow_runs_status_check
  check (status in (
    'draft',
    'queued',
    'running',
    'generated',
    'waiting_approval',
    'approved',
    'rejected',
    'review',
    'completed',
    'executed',
    'failed',
    'blocked',
    'cancelled'
  ));

alter table workflow_runs
  add column runtime_id text,
  add column project_id text,
  add column workflow_id text,
  add column revision bigint,
  add column runtime_snapshot jsonb,
  add column runtime_pause jsonb,
  add column project_registry jsonb,
  add column model_provider_registry jsonb,
  add constraint workflow_runs_runtime_id_check
    check (runtime_id is null or char_length(runtime_id) between 1 and 64),
  add constraint workflow_runs_runtime_revision_check
    check (revision is null or revision >= 0),
  add constraint workflow_runs_runtime_columns_check
    check (
      (runtime_id is null
        and project_id is null
        and workflow_id is null
        and revision is null
        and runtime_snapshot is null
        and runtime_pause is null
        and project_registry is null
        and model_provider_registry is null)
      or
      (runtime_id is not null
        and project_id is not null
        and workflow_id is not null
        and revision is not null
        and runtime_snapshot is not null
        and project_registry is not null
        and model_provider_registry is not null)
    );

create unique index workflow_runs_runtime_id_unique
  on workflow_runs (workspace_id, runtime_id)
  where runtime_id is not null;

create index workflow_runs_workspace_runtime_idx
  on workflow_runs (workspace_id, runtime_id);

alter table workflow_step_runs
  drop constraint workflow_step_runs_status_check;

alter table workflow_step_runs
  add constraint workflow_step_runs_status_check
  check (status in (
    'pending',
    'running',
    'success',
    'failed',
    'skipped',
    'waiting_approval',
    'blocked',
    'cancelled'
  ));

alter table workflow_step_runs
  add column attempt_count integer,
  add column agent_id text,
  add column agent_binding_id text,
  add column model_profile_id text,
  add column runtime_revision bigint,
  add column state_payload jsonb,
  add column updated_at timestamptz not null default now(),
  add constraint workflow_step_runs_attempt_count_check
    check (attempt_count is null or attempt_count >= 0),
  add constraint workflow_step_runs_runtime_revision_check
    check (runtime_revision is null or runtime_revision >= 0),
  add constraint workflow_step_runs_runtime_projection_check
    check (
      (runtime_revision is null and state_payload is null)
      or
      (runtime_revision is not null and attempt_count is not null and state_payload is not null)
    );

create unique index workflow_step_runs_run_step_unique
  on workflow_step_runs (run_id, step_key);

create index workflow_step_runs_run_revision_idx
  on workflow_step_runs (run_id, runtime_revision);

create table workflow_runtime_commands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  command_id text not null,
  fingerprint text not null,
  expected_revision bigint not null,
  lease_token uuid not null default gen_random_uuid(),
  status text not null,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  effect_started_at timestamptz,
  completed_at timestamptz,
  constraint workflow_runtime_commands_identity_unique
    unique (run_id, command_id),
  constraint workflow_runtime_commands_command_id_check
    check (char_length(command_id) between 1 and 40),
  constraint workflow_runtime_commands_fingerprint_check
    check (fingerprint ~ '^[0-9a-f]{64}$'),
  constraint workflow_runtime_commands_revision_check
    check (expected_revision >= 0),
  constraint workflow_runtime_commands_lease_check
    check (lease_expires_at >= created_at),
  constraint workflow_runtime_commands_status_check
    check (status in ('in_progress', 'completed', 'abandoned')),
  constraint workflow_runtime_commands_response_check
    check (
      (status = 'completed' and response_payload is not null and completed_at is not null)
      or
      (status <> 'completed' and response_payload is null and completed_at is null)
    )
);

create index workflow_runtime_commands_workspace_run_idx
  on workflow_runtime_commands (workspace_id, run_id);

create index workflow_runtime_commands_run_status_idx
  on workflow_runtime_commands (run_id, status);

create index workflow_runtime_commands_in_progress_lease_idx
  on workflow_runtime_commands (lease_expires_at)
  where status = 'in_progress';

create table workflow_runtime_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  step_id text not null,
  attempt_number integer not null,
  expected_revision bigint not null,
  execution_id text not null,
  status text not null default 'active',
  acquired_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  released_at timestamptz,
  constraint workflow_runtime_claims_attempt_check
    check (attempt_number > 0),
  constraint workflow_runtime_claims_revision_check
    check (expected_revision >= 0),
  constraint workflow_runtime_claims_status_check
    check (status in ('active', 'released', 'expired')),
  constraint workflow_runtime_claims_release_check
    check (
      (status = 'active' and released_at is null)
      or
      (status <> 'active' and released_at is not null)
    )
);

create unique index workflow_runtime_claims_active_attempt_unique
  on workflow_runtime_claims (run_id, step_id, attempt_number, expected_revision)
  where status = 'active';

create index workflow_runtime_claims_workspace_run_idx
  on workflow_runtime_claims (workspace_id, run_id);

create index workflow_runtime_claims_active_lease_idx
  on workflow_runtime_claims (lease_expires_at)
  where status = 'active';

create table workflow_runtime_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  claim_id uuid not null unique references workflow_runtime_claims(id) on delete restrict,
  step_id text not null,
  attempt_number integer not null,
  expected_revision bigint not null,
  execution_id text not null,
  request_fingerprint text not null,
  status text not null default 'prepared',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint workflow_runtime_executions_identity_unique
    unique (run_id, step_id, attempt_number, expected_revision, execution_id),
  constraint workflow_runtime_executions_attempt_check
    check (attempt_number > 0),
  constraint workflow_runtime_executions_revision_check
    check (expected_revision >= 0),
  constraint workflow_runtime_executions_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint workflow_runtime_executions_status_check
    check (status in ('prepared', 'running', 'completed', 'failed', 'outcome_unknown')),
  constraint workflow_runtime_executions_timestamps_check
    check (
      (status = 'prepared' and started_at is null and completed_at is null)
      or
      (status = 'running' and started_at is not null and completed_at is null)
      or
      (status in ('completed', 'failed', 'outcome_unknown') and completed_at is not null)
    )
);

create unique index workflow_runtime_executions_unresolved_attempt_unique
  on workflow_runtime_executions (run_id, step_id, attempt_number, expected_revision)
  where status in ('prepared', 'running', 'outcome_unknown');

create index workflow_runtime_executions_workspace_run_idx
  on workflow_runtime_executions (workspace_id, run_id);

create index workflow_runtime_executions_run_status_idx
  on workflow_runtime_executions (run_id, status);

commit;
