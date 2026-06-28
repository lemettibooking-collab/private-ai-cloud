-- Private AI Cloud
-- Migration: 0001_initial_p0_schema
-- Purpose: Initial P0 schema for workspace, users, roles, knowledge, assistant threads,
-- workflows, approvals, and audit events.
-- Notes:
-- - PostgreSQL target.
-- - No RLS policies yet.
-- - No auth integration yet.
-- - No application DB connection yet.
-- - External actions remain locked by default at application/product layer.

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Workspace / identity

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  type text not null,
  region text not null,
  status text not null,
  plan_code text,
  data_residency text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_status_check
    check (status in ('demo', 'active', 'suspended', 'archived'))
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  status text not null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_status_check
    check (status in ('invited', 'active', 'disabled'))
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_members_workspace_user_unique unique (workspace_id, user_id),
  constraint workspace_members_status_check
    check (status in ('invited', 'active', 'disabled'))
);

-- Roles / permissions

create table roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  group_code text not null,
  description text
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table member_role_assignments (
  member_id uuid not null references workspace_members(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, role_id)
);

create unique index roles_global_code_unique
  on roles (code)
  where workspace_id is null;

create unique index roles_workspace_code_unique
  on roles (workspace_id, code)
  where workspace_id is not null;

-- Knowledge base

create table knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  status text not null,
  visibility text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_collections_workspace_slug_unique unique (workspace_id, slug),
  constraint knowledge_collections_status_check
    check (status in ('active', 'archived')),
  constraint knowledge_collections_visibility_check
    check (visibility in ('private', 'workspace', 'restricted'))
);

create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  collection_id uuid references knowledge_collections(id) on delete set null,
  title text not null,
  source_type text not null,
  file_uri text,
  mime_type text,
  status text not null,
  indexing_status text not null,
  uploaded_by uuid references users(id) on delete set null,
  current_version_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_source_type_check
    check (source_type in ('manual_upload', 'markdown', 'url', 'github', 'drive', 'api')),
  constraint knowledge_documents_status_check
    check (status in ('active', 'archived', 'deleted')),
  constraint knowledge_documents_indexing_status_check
    check (indexing_status in ('uploaded', 'parsing', 'chunking', 'embedding', 'indexed', 'failed', 'archived'))
);

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  version_id uuid,
  chunk_index integer not null,
  text text not null,
  token_count integer,
  vector_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint document_chunks_document_chunk_unique unique (document_id, chunk_index)
);

-- Assistant chat

create table assistant_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  assistant_code text,
  title text,
  status text not null,
  created_by uuid references users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_threads_status_check
    check (status in ('active', 'archived'))
);

create table assistant_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  thread_id uuid not null references assistant_threads(id) on delete cascade,
  role text not null,
  content text,
  parts jsonb not null default '[]'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint assistant_messages_role_check
    check (role in ('user', 'assistant', 'system', 'tool'))
);

-- Workflow engine

create table workflow_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  department_code text,
  title text not null,
  description text,
  status text not null,
  roadmap_phase text,
  requires_approval boolean not null default true,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  default_steps jsonb not null default '[]'::jsonb,
  allowed_role_codes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_templates_status_check
    check (status in ('mvp_active', 'planned', 'future', 'locked', 'archived'))
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  template_id uuid references workflow_templates(id) on delete set null,
  status text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  assigned_to uuid references users(id) on delete set null,
  approval_request_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_runs_status_check
    check (status in (
      'draft',
      'queued',
      'running',
      'generated',
      'waiting_approval',
      'approved',
      'rejected',
      'executed',
      'failed',
      'cancelled'
    ))
);

create table workflow_step_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  step_key text not null,
  type text not null,
  status text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  constraint workflow_step_runs_status_check
    check (status in ('pending', 'running', 'success', 'failed', 'skipped', 'waiting_approval'))
);

-- Approvals

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_run_id uuid references workflow_runs(id) on delete set null,
  action_type text not null,
  status text not null,
  risk_level text not null,
  requested_by uuid references users(id) on delete set null,
  approved_by uuid references users(id) on delete set null,
  rejected_by uuid references users(id) on delete set null,
  allowed_approver_role_codes text[] not null default '{}'::text[],
  original_payload jsonb not null default '{}'::jsonb,
  edited_payload jsonb,
  final_payload jsonb,
  risk_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'edited', 'expired', 'cancelled')),
  constraint approval_requests_risk_level_check
    check (risk_level in ('low', 'medium', 'high', 'critical'))
);

-- Audit

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- updated_at triggers

create trigger set_workspaces_updated_at
before update on workspaces
for each row execute function set_updated_at();

create trigger set_users_updated_at
before update on users
for each row execute function set_updated_at();

create trigger set_workspace_members_updated_at
before update on workspace_members
for each row execute function set_updated_at();

create trigger set_roles_updated_at
before update on roles
for each row execute function set_updated_at();

create trigger set_knowledge_collections_updated_at
before update on knowledge_collections
for each row execute function set_updated_at();

create trigger set_knowledge_documents_updated_at
before update on knowledge_documents
for each row execute function set_updated_at();

create trigger set_assistant_threads_updated_at
before update on assistant_threads
for each row execute function set_updated_at();

create trigger set_workflow_templates_updated_at
before update on workflow_templates
for each row execute function set_updated_at();

create trigger set_workflow_runs_updated_at
before update on workflow_runs
for each row execute function set_updated_at();

create trigger set_approval_requests_updated_at
before update on approval_requests
for each row execute function set_updated_at();

-- Indexes

create index workspaces_status_idx on workspaces (status);
create index users_status_idx on users (status);
create index workspace_members_workspace_id_idx on workspace_members (workspace_id);
create index workspace_members_user_id_idx on workspace_members (user_id);
create index workspace_members_workspace_status_idx on workspace_members (workspace_id, status);
create index roles_workspace_id_idx on roles (workspace_id);
create index roles_code_idx on roles (code);
create index permissions_group_code_idx on permissions (group_code);
create index role_permissions_permission_id_idx on role_permissions (permission_id);
create index member_role_assignments_role_id_idx on member_role_assignments (role_id);

create index knowledge_collections_workspace_id_idx on knowledge_collections (workspace_id);
create index knowledge_collections_workspace_status_idx on knowledge_collections (workspace_id, status);
create index knowledge_collections_workspace_visibility_idx on knowledge_collections (workspace_id, visibility);
create index knowledge_documents_workspace_id_idx on knowledge_documents (workspace_id);
create index knowledge_documents_workspace_collection_indexing_idx on knowledge_documents (workspace_id, collection_id, indexing_status);
create index knowledge_documents_workspace_status_idx on knowledge_documents (workspace_id, status);
create index knowledge_documents_uploaded_by_idx on knowledge_documents (uploaded_by);
create index document_chunks_workspace_id_idx on document_chunks (workspace_id);
create index document_chunks_workspace_document_idx on document_chunks (workspace_id, document_id);
create index document_chunks_workspace_vector_idx on document_chunks (workspace_id, vector_id);

create index assistant_threads_workspace_id_idx on assistant_threads (workspace_id);
create index assistant_threads_workspace_status_idx on assistant_threads (workspace_id, status);
create index assistant_threads_workspace_created_idx on assistant_threads (workspace_id, created_at);
create index assistant_threads_created_by_idx on assistant_threads (created_by);
create index assistant_messages_workspace_id_idx on assistant_messages (workspace_id);
create index assistant_messages_workspace_thread_created_idx on assistant_messages (workspace_id, thread_id, created_at);
create index assistant_messages_workspace_role_idx on assistant_messages (workspace_id, role);

create index workflow_templates_department_code_idx on workflow_templates (department_code);
create index workflow_templates_status_idx on workflow_templates (status);
create index workflow_templates_roadmap_phase_idx on workflow_templates (roadmap_phase);
create index workflow_runs_workspace_id_idx on workflow_runs (workspace_id);
create index workflow_runs_workspace_status_created_idx on workflow_runs (workspace_id, status, created_at);
create index workflow_runs_workspace_template_idx on workflow_runs (workspace_id, template_id);
create index workflow_runs_created_by_idx on workflow_runs (created_by);
create index workflow_step_runs_workspace_id_idx on workflow_step_runs (workspace_id);
create index workflow_step_runs_workspace_run_idx on workflow_step_runs (workspace_id, run_id);
create index workflow_step_runs_workspace_status_idx on workflow_step_runs (workspace_id, status);
create index workflow_step_runs_run_step_idx on workflow_step_runs (run_id, step_key);

create index approval_requests_workspace_id_idx on approval_requests (workspace_id);
create index approval_requests_workspace_status_risk_created_idx on approval_requests (workspace_id, status, risk_level, created_at);
create index approval_requests_workspace_action_type_idx on approval_requests (workspace_id, action_type);
create index approval_requests_workflow_run_id_idx on approval_requests (workflow_run_id);
create index approval_requests_requested_by_idx on approval_requests (requested_by);

create index audit_events_workspace_id_idx on audit_events (workspace_id);
create index audit_events_workspace_created_idx on audit_events (workspace_id, created_at);
create index audit_events_entity_idx on audit_events (entity_type, entity_id);
create index audit_events_event_type_created_idx on audit_events (event_type, created_at);
create index audit_events_actor_user_created_idx on audit_events (actor_user_id, created_at);
