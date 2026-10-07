begin;

alter table approval_requests
  add column runtime_approval_id text,
  add column step_id text,
  add column attempt_number integer,
  add column expected_revision bigint,
  add column request_fingerprint text,
  add column policy_fingerprint text,
  add column scope_fingerprint text,
  add column requested_capability text,
  add column requested_by_actor_id text,
  add column resolved_by_actor_id text,
  add constraint approval_requests_workspace_id_id_unique unique (workspace_id, id),
  add constraint approval_requests_runtime_shape_check check (
    (action_type <> 'runtime_risk_approval'
      and runtime_approval_id is null
      and step_id is null
      and attempt_number is null
      and expected_revision is null
      and request_fingerprint is null
      and policy_fingerprint is null
      and scope_fingerprint is null
      and requested_capability is null
      and requested_by_actor_id is null
      and resolved_by_actor_id is null)
    or
    (action_type = 'runtime_risk_approval'
      and workflow_run_id is not null
      and runtime_approval_id is not null
      and step_id is not null
      and attempt_number is not null
      and expected_revision is not null
      and request_fingerprint is not null
      and policy_fingerprint is not null
      and scope_fingerprint is not null
      and requested_capability is not null
      and requested_by_actor_id is not null
      and runtime_approval_id ~ '^risk-approval-[0-9a-f]{32}$'
      and step_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
      and attempt_number >= 1
      and expected_revision >= 0
      and request_fingerprint ~ '^[0-9a-f]{64}$'
      and policy_fingerprint ~ '^[0-9a-f]{64}$'
      and scope_fingerprint ~ '^[0-9a-f]{64}$'
      and requested_capability in (
        'deterministic', 'economy', 'reasoning', 'advanced_reasoning', 'coding'
      )
      and requested_by_actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$')
  ),
  add constraint approval_requests_runtime_resolver_actor_check check (
    resolved_by_actor_id is null
    or resolved_by_actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  ),
  add constraint approval_requests_runtime_lifecycle_check check (
    action_type <> 'runtime_risk_approval'
    or (
      (status = 'pending' and resolved_by_actor_id is null and resolved_at is null)
      or
      (status in ('approved', 'rejected', 'cancelled')
        and resolved_by_actor_id is not null
        and resolved_at is not null)
    )
  );

create unique index approval_requests_runtime_approval_id_unique
  on approval_requests (workspace_id, runtime_approval_id)
  where runtime_approval_id is not null;

create unique index approval_requests_runtime_scope_unique
  on approval_requests (
    workflow_run_id,
    step_id,
    attempt_number,
    expected_revision,
    request_fingerprint,
    policy_fingerprint
  )
  where runtime_approval_id is not null;

create table approval_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  approval_request_id uuid not null,
  decision text not null,
  decided_by_actor_id text not null,
  reason text,
  command_id text not null,
  created_at timestamptz not null default now(),
  constraint approval_decisions_request_fk
    foreign key (workspace_id, approval_request_id)
    references approval_requests (workspace_id, id) on delete restrict,
  constraint approval_decisions_request_unique unique (approval_request_id),
  constraint approval_decisions_decision_check check (decision in ('approved', 'rejected')),
  constraint approval_decisions_actor_check check (
    decided_by_actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  ),
  constraint approval_decisions_reason_check check (
    reason is null or char_length(reason) between 1 and 1024
  ),
  constraint approval_decisions_command_check check (
    command_id ~ '^[a-z0-9][a-z0-9._-]{0,39}$'
  )
);

create index approval_decisions_workspace_created_idx
  on approval_decisions (workspace_id, created_at);

commit;
