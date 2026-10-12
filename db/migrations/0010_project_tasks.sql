-- AI-038.4a: persistent Owner / Project Task ("what needs to be done") and its link to runtime Runs.
--
-- * project_tasks is NOT the FeaturePlan DevelopmentTask (lib/contracts/development-plan.ts), which is
--   an in-memory node inside a FeaturePlan. A ProjectTask may later own FeaturePlans; that link is
--   deferred (no FeaturePlan is persisted yet).
-- * task_key is the Owner-facing stable Task ID (unique per workspace); the uuid is internal only.
-- * Every task belongs to exactly one registered project of the SAME workspace (composite FK).
-- * Task status is factual persisted task state; it is never derived from run status here.
-- * project_task_runs links a task to 0..N runtime runs of the SAME workspace AND project (composite
--   FKs on both sides); a run is linked to at most one task; links carry no payloads or evidence.
-- * Writes go only through the narrow server-side Owner task mutation contract (lib/tasks/
--   owner-task-mutations.ts): createTask (idempotent by creation_idempotency_key + immutable intent
--   fingerprint) and attachRun. Each writes exactly one audit event in the same transaction.
-- * Nothing is seeded.

-- Composite key that the task→run link references. (workspace_id, runtime_id) is already unique, so
-- this is implied by existing data and cannot fail; legacy non-runtime rows have NULLs and stay valid.
alter table workflow_runs
  add constraint workflow_runs_workspace_project_runtime_unique unique (workspace_id, project_id, runtime_id);

create table project_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_key text not null,
  task_key text not null,
  title text not null,
  goal text,
  task_type text not null,
  status text not null,
  priority text,
  risk_level text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  -- Owner-supplied idempotency key of the createTask call + sha256 of the immutable creation intent
  -- (project, title, goal, type, priority, risk). Same key + same intent → same task; same key +
  -- different intent → conflict. Both are absent for tasks not created through createTask.
  creation_idempotency_key text,
  creation_intent_fingerprint text,
  constraint project_tasks_task_key_check
    check (task_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint project_tasks_title_check
    check (char_length(title) between 1 and 200 and title = btrim(title) and title !~ '[[:cntrl:]]'),
  constraint project_tasks_goal_check
    check (goal is null or (char_length(goal) between 1 and 4000 and goal !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')),
  constraint project_tasks_type_check
    check (task_type in ('feature', 'fix', 'investigation', 'roadmap')),
  constraint project_tasks_status_check
    check (status in ('draft', 'ready', 'planning', 'approved', 'running', 'verifying', 'waiting_owner',
                      'blocked', 'recovery_required', 'completed', 'failed', 'cancelled')),
  constraint project_tasks_priority_check
    check (priority is null or priority in ('P0', 'P1', 'P2', 'P3', 'P4')),
  constraint project_tasks_risk_level_check
    check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical')),
  -- completed ⇔ completed_at present (never derived from a run).
  constraint project_tasks_completed_at_check
    check ((status = 'completed') = (completed_at is not null)),
  constraint project_tasks_creation_idempotency_key_check
    check (creation_idempotency_key is null or creation_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint project_tasks_creation_intent_fingerprint_check
    check (creation_intent_fingerprint is null or creation_intent_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint project_tasks_creation_idempotency_pair_check
    check ((creation_idempotency_key is null) = (creation_intent_fingerprint is null)),
  constraint project_tasks_workspace_task_key_unique unique (workspace_id, task_key),
  -- Referenced by project_task_runs so a link can only name a task of the same project.
  constraint project_tasks_workspace_project_task_key_unique unique (workspace_id, project_key, task_key),
  -- Same-workspace registered project; NO ACTION so tasks are never silently dropped with a project
  -- (a workspace delete still cascades through both tables in one statement).
  constraint project_tasks_project_fk foreign key (workspace_id, project_key)
    references projects (workspace_id, project_key)
);

-- listTasks(all) / listProjectTasks(all): newest updated first.
create index project_tasks_workspace_updated_idx on project_tasks (workspace_id, updated_at desc, task_key desc);
create index project_tasks_workspace_project_updated_idx on project_tasks (workspace_id, project_key, updated_at desc, task_key desc);
-- current / attention views filter by status.
create index project_tasks_workspace_status_updated_idx on project_tasks (workspace_id, status, updated_at desc);
-- Recently Completed: completed tasks by factual completed_at.
create index project_tasks_workspace_completed_idx on project_tasks (workspace_id, completed_at desc, task_key desc)
  where status = 'completed';

-- One task per (workspace, creation idempotency key); the race guard behind createTask.
create unique index project_tasks_workspace_creation_key_unique on project_tasks (workspace_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

create trigger set_project_tasks_updated_at
before update on project_tasks
for each row execute function set_updated_at();

create table project_task_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_key text not null,
  task_key text not null,
  run_id text not null,
  linked_at timestamptz not null default now(),
  constraint project_task_runs_run_id_check
    check (run_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  -- A runtime run belongs to at most one task in AI-038.4a; duplicate links are impossible.
  constraint project_task_runs_workspace_run_unique unique (workspace_id, run_id),
  -- The task must be in the same workspace AND project as the link.
  constraint project_task_runs_task_fk foreign key (workspace_id, project_key, task_key)
    references project_tasks (workspace_id, project_key, task_key) on delete cascade,
  -- The run must be in the same workspace AND carry the same project id.
  constraint project_task_runs_run_fk foreign key (workspace_id, project_key, run_id)
    references workflow_runs (workspace_id, project_id, runtime_id) on delete cascade
);

-- Task → linked runs.
create index project_task_runs_workspace_task_idx on project_task_runs (workspace_id, task_key);

-- Exactly one audit event per created task and per attached link: the last guard against a duplicate
-- task.created / task.run_attached under any race (entity_id = project_tasks.id / project_task_runs.id).
create unique index audit_events_task_event_unique on audit_events (workspace_id, event_type, entity_id)
  where event_type in ('task.created', 'task.run_attached');
