# Private AI Cloud Database Schema Blueprint v0.1

Date: 2026-06-28

Source: `docs/architecture/data-model-blueprint-v0.1.md`

Status: architecture draft only. This is not a migration file and does not add a database, ORM, backend route, auth, Docker, RAG, LLM, or integration implementation.

## 1. Purpose

This document defines the first database schema blueprint for Private AI Cloud before real migrations and backend foundation work.

It describes the intended PostgreSQL schema shape, table groups, columns, keys, constraints, indexes, tenant isolation strategy, RLS draft, object/vector storage boundaries, seed data, and migration order. The goal is to make the next implementation step deliberate rather than allowing backend tables to grow ad hoc from UI mocks.

## 2. Database Strategy Recommendation

- Primary DB: PostgreSQL.
- Tenant model: `workspace_id` on all tenant-scoped tables.
- MVP isolation: application-level workspace checks, with schema designed for future RLS.
- Production isolation: PostgreSQL RLS policies by `workspace_id`.
- Primary keys: `uuid`.
- Main timestamps: `created_at`, `updated_at`.
- Soft delete: `deleted_at` where recovery/audit-friendly deletion is needed.
- Flexible payloads/logs/config: `jsonb` fields named with `_payload`, `_config`, or `_metadata`.
- Files: object storage, referenced by URI/object key from PostgreSQL.
- Embeddings: keep `document_chunks.vector_id` abstract until `pgvector` vs Qdrant is decided.

This schema should be compatible with either Supabase managed Postgres or self-hosted Postgres. Do not hard-code a provider-specific auth model into the first schema.

## 3. Schema Principles

- Workspace-first.
- Tenant isolation mandatory.
- Approval-first.
- Audit-first.
- External actions locked by default.
- RAG/source-grounded outputs should keep source references.
- No full CRM in MVP.
- Schema must support all 10 AI Departments later.
- Smart Algorithms Demo is the first workspace and seed tenant.
- Merge is manual outside system, not an executable system action.

## 4. Naming Conventions

- Table names: `snake_case` plural.
- Primary key: `id uuid primary key`.
- Foreign keys: `<entity>_id`.
- Timestamps: `created_at`, `updated_at`, optional `deleted_at`.
- Statuses: start as `text` plus check constraints; convert to Postgres enums only after values stabilize.
- JSONB fields: suffix with `_payload`, `_config`, or `_metadata`.
- Index naming: `idx_<table>__<column_or_purpose>`.
- Unique index naming: `uniq_<table>__<column_or_purpose>`.
- Foreign key naming in future migrations: `fk_<table>__<referenced_table>`.

## 5. P0 Tables Overview

P0 tables are required for the first backend/database milestone.

| Table | Purpose | Tenant-scoped |
|---|---|---:|
| `workspaces` | Workspace/tenant/company boundary. | no |
| `users` | Global user profile/identity. | no |
| `workspace_members` | User membership in a workspace. | yes |
| `roles` | System or workspace-specific roles. | mixed |
| `permissions` | Stable permission registry. | no |
| `role_permissions` | Role-permission join table. | via role |
| `member_role_assignments` | Member-role join table. | via member |
| `knowledge_collections` | Knowledge source grouping and access boundary. | yes |
| `knowledge_documents` | Uploaded/source document metadata. | yes |
| `document_chunks` | Retrieval chunks and vector references. | yes |
| `assistant_threads` | RAG/chat threads. | yes |
| `assistant_messages` | Chat messages with source references. | yes |
| `workflow_templates` | Workflow definitions/templates. | no in MVP, can become workspace-scoped later |
| `workflow_runs` | One workflow execution attempt. | yes |
| `workflow_step_runs` | Per-step run state. | yes |
| `approval_requests` | Human review gate for outputs/actions. | yes |
| `audit_events` | Immutable-ish event log. | mostly yes; can include platform events |

## 6. P1 Tables Overview

P1 tables should follow after P0 persistence works.

| Table | Purpose | Relationships | When to implement |
|---|---|---|---|
| `departments` | Store 10 AI departments currently held as config. | referenced by assistants/templates | After first persisted workflows. |
| `assistants` | Workspace assistant profiles. | workspace, department, threads, runs | Before real assistant execution. |
| `document_versions` | Version history for documents. | document, chunks, analysis | Before real uploads/update cycles. |
| `rag_queries` | Store RAG question/answer attempts. | thread, user, source refs | With first real RAG. |
| `assistant_runs` | AI execution attempts. | thread, assistant, tool calls | With streaming/tool execution. |
| `assistant_tool_calls` | Tool invocation records. | assistant run | With tools/RAG/actions. |
| `reports` | Generated report header. | workspace, sections, metrics | Before persisted Owner Report. |
| `report_sections` | Report content blocks. | report | With reports backend. |
| `report_metrics` | Structured report metrics. | report | With reports dashboard. |
| `integration_connections` | Integration metadata/status. | workspace, external actions | Before real integrations. |
| `external_actions` | Requested/executed side-effect records. | approval, integration | Before any external execution. |
| `document_analysis_jobs` | Document Intelligence job records. | document/version | Before document intelligence backend. |
| `document_analysis_results` | Stored analysis outputs. | job/document/version | After analysis jobs exist. |

## 7. P2 / Future Tables Overview

These tables are not required for the first backend milestone, but P0/P1 schema should not block them.

| Table | Purpose |
|---|---|
| `infrastructure_environments` | Deployment/environment records. |
| `system_health_snapshots` | Operator console health snapshots. |
| `resource_usage_snapshots` | CPU/GPU/memory/storage/cost metrics. |
| `incidents` | Operational incidents and remediation. |
| `managed_service_accounts` | Managed service account configuration. |
| `client_audits` | Client-facing audit records/reviews. |
| `implementation_tasks` | Managed implementation tasks. |
| `sla_agreements` | SLA/service terms. |
| `sales_leads` | Lightweight planned lead records. |
| `customer_success_segments` | Planned CS/upsell segments. |
| `document_comparisons` | Version comparison results. |
| `document_risk_items` | Extracted document risks. |
| `extracted_obligations` | Dates, amounts, obligations. |
| `ai_request_logs` | Provider/model request logs. |
| `document_access_logs` | Document access audit records. |
| `integration_events` | Integration webhook/API event log. |

## 8. Detailed P0 Table Specs

### `workspaces`

Purpose: tenant/company boundary.

Columns:

- `id uuid primary key`
- `name text not null`
- `slug text not null unique`
- `type text not null`
- `region text not null`
- `status text not null`
- `plan_code text`
- `data_residency text`
- `settings jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Statuses: `demo`, `active`, `suspended`, `archived`.

Indexes:

- unique `slug`.
- `(status)`.

Tenant isolation: root tenant table; not workspace-scoped.

MVP/future notes: seed `Smart Algorithms Demo`.

### `users`

Purpose: global user identity/profile. Auth provider can be added later.

Columns:

- `id uuid primary key`
- `email text not null unique`
- `name text`
- `status text not null`
- `last_login_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Statuses: `invited`, `active`, `disabled`.

Indexes:

- unique `email`.
- `(status)`.

Tenant isolation: global table; workspace access comes through `workspace_members`.

### `workspace_members`

Purpose: connects users to workspaces.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `user_id uuid not null references users(id)`
- `status text not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Unique:

- `(workspace_id, user_id)`.

Indexes:

- `(workspace_id)`.
- `(user_id)`.
- `(workspace_id, status)`.

Tenant isolation: member row is workspace-scoped.

### `roles`

Purpose: system and workspace roles.

Columns:

- `id uuid primary key`
- `workspace_id uuid references workspaces(id)`
- `code text not null`
- `name text not null`
- `description text`
- `is_system boolean not null default false`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Unique:

- `(workspace_id, code)` for workspace roles.
- global system roles can use null `workspace_id`.

Roles:

- `owner`
- `admin`
- `support_operator`
- `marketing_operator`
- `product_manager`
- `developer_reviewer`
- `viewer`
- `demo_viewer`

Indexes:

- `(workspace_id)`.
- `(code)`.

Tenant isolation: system roles are global; workspace roles are scoped.

### `permissions`

Purpose: stable permission/action registry.

Columns:

- `id uuid primary key`
- `code text not null unique`
- `group_code text not null`
- `description text`

Permission examples:

- `workspace.manage`
- `users.manage`
- `roles.manage`
- `knowledge.upload`
- `knowledge.view_collection`
- `rag_chat.run`
- `assistants.manage`
- `workflows.run`
- `approvals.approve`
- `reports.view`
- `integrations.manage`
- `security.manage`
- `operator_console.view`
- `codex.create_task`
- `codex.launch`
- `local_runner.run_checks`
- `external_actions.publish`

Indexes:

- unique `code`.
- `(group_code)`.

Tenant isolation: global registry.

### `role_permissions`

Purpose: maps roles to permissions.

Columns:

- `role_id uuid not null references roles(id)`
- `permission_id uuid not null references permissions(id)`
- `created_at timestamptz not null default now()`

Primary key:

- `(role_id, permission_id)`.

Indexes:

- `(permission_id)`.

Tenant isolation: follows role scope.

### `member_role_assignments`

Purpose: assigns workspace members to roles.

Columns:

- `member_id uuid not null references workspace_members(id)`
- `role_id uuid not null references roles(id)`
- `created_at timestamptz not null default now()`

Primary key:

- `(member_id, role_id)`.

Indexes:

- `(role_id)`.

Tenant isolation: follows workspace member and role.

### `knowledge_collections`

Purpose: collection boundary for documents, RAG scope, and permissions.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `name text not null`
- `slug text not null`
- `description text`
- `status text not null`
- `visibility text not null`
- `created_by uuid references users(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Unique:

- `(workspace_id, slug)`.

Indexes:

- `(workspace_id)`.
- `(workspace_id, status)`.
- `(workspace_id, visibility)`.

Tenant isolation: must always filter by `workspace_id`.

### `knowledge_documents`

Purpose: document/source metadata.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `collection_id uuid references knowledge_collections(id)`
- `title text not null`
- `source_type text not null`
- `file_uri text`
- `mime_type text`
- `status text not null`
- `indexing_status text not null`
- `uploaded_by uuid references users(id)`
- `current_version_id uuid`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexing statuses:

- `uploaded`
- `parsing`
- `chunking`
- `embedding`
- `indexed`
- `failed`
- `archived`

Indexes:

- `(workspace_id)`.
- `(workspace_id, collection_id, indexing_status)`.
- `(workspace_id, status)`.
- `(uploaded_by)`.

Tenant isolation: must always filter by `workspace_id`.

MVP/future notes: `current_version_id` can remain nullable until `document_versions` exists.

### `document_chunks`

Purpose: retrieval chunks and vector references.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `document_id uuid not null references knowledge_documents(id)`
- `version_id uuid`
- `chunk_index integer not null`
- `text text not null`
- `token_count integer`
- `vector_id text`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`

Indexes:

- `(workspace_id, document_id)`.
- `(workspace_id, vector_id)`.
- `(workspace_id, document_id, chunk_index)`.

Unique:

- `(document_id, version_id, chunk_index)` when `version_id` is available.

Tenant isolation: must always filter by `workspace_id`.

### `assistant_threads`

Purpose: RAG Chat / assistant conversation thread.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `assistant_code text`
- `title text`
- `status text not null`
- `created_by uuid references users(id)`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:

- `(workspace_id)`.
- `(workspace_id, status)`.
- `(workspace_id, created_at)`.
- `(created_by)`.

Tenant isolation: must always filter by `workspace_id`.

### `assistant_messages`

Purpose: chat messages with rich parts and source references.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `thread_id uuid not null references assistant_threads(id)`
- `role text not null`
- `content text`
- `parts jsonb not null default '[]'`
- `source_references jsonb not null default '[]'`
- `created_by uuid references users(id)`
- `created_at timestamptz not null default now()`

Roles:

- `user`
- `assistant`
- `system`
- `tool`

Indexes:

- `(workspace_id, thread_id, created_at)`.
- `(workspace_id, role)`.

Tenant isolation: duplicate `workspace_id` intentionally for faster RLS/indexes.

### `workflow_templates`

Purpose: stable workflow catalog/template definitions.

Columns:

- `id uuid primary key`
- `code text not null unique`
- `department_code text`
- `title text not null`
- `description text`
- `status text not null`
- `roadmap_phase text`
- `requires_approval boolean not null default true`
- `input_schema jsonb not null default '{}'`
- `output_schema jsonb not null default '{}'`
- `default_steps jsonb not null default '[]'`
- `allowed_role_codes text[]`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:

- unique `code`.
- `(department_code)`.
- `(status)`.
- `(roadmap_phase)`.

Tenant isolation: global in MVP. Future can add `workspace_id` for customized templates.

### `workflow_runs`

Purpose: one workflow execution attempt.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `template_id uuid references workflow_templates(id)`
- `status text not null`
- `input_payload jsonb not null default '{}'`
- `output_payload jsonb not null default '{}'`
- `created_by uuid references users(id)`
- `assigned_to uuid references users(id)`
- `approval_request_id uuid`
- `started_at timestamptz`
- `completed_at timestamptz`
- `failed_at timestamptz`
- `error_message text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Statuses:

- `draft`
- `queued`
- `running`
- `generated`
- `waiting_approval`
- `approved`
- `rejected`
- `executed`
- `failed`
- `cancelled`

Indexes:

- `(workspace_id)`.
- `(workspace_id, status, created_at)`.
- `(workspace_id, template_id)`.
- `(created_by)`.

Tenant isolation: must always filter by `workspace_id`.

### `workflow_step_runs`

Purpose: per-step execution state.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `run_id uuid not null references workflow_runs(id)`
- `step_key text not null`
- `type text not null`
- `status text not null`
- `input_payload jsonb not null default '{}'`
- `output_payload jsonb not null default '{}'`
- `started_at timestamptz`
- `completed_at timestamptz`
- `error_message text`
- `created_at timestamptz not null default now()`

Step statuses:

- `pending`
- `running`
- `success`
- `failed`
- `skipped`
- `waiting_approval`

Indexes:

- `(workspace_id, run_id)`.
- `(workspace_id, status)`.
- `(run_id, step_key)`.

Tenant isolation: must always filter by `workspace_id`.

### `approval_requests`

Purpose: human review object for generated outputs and sensitive actions.

Columns:

- `id uuid primary key`
- `workspace_id uuid not null references workspaces(id)`
- `workflow_run_id uuid references workflow_runs(id)`
- `action_type text not null`
- `status text not null`
- `risk_level text not null`
- `requested_by uuid references users(id)`
- `approved_by uuid references users(id)`
- `rejected_by uuid references users(id)`
- `allowed_approver_role_codes text[]`
- `original_payload jsonb not null default '{}'`
- `edited_payload jsonb`
- `final_payload jsonb`
- `risk_notes text`
- `resolved_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Statuses:

- `pending`
- `approved`
- `rejected`
- `edited`
- `expired`
- `cancelled`

Risk levels:

- `low`
- `medium`
- `high`
- `critical`

Indexes:

- `(workspace_id, status, risk_level, created_at)`.
- `(workspace_id, action_type)`.
- `(workflow_run_id)`.
- `(requested_by)`.

Tenant isolation: must always filter by `workspace_id`.

Important: merge is not an executable external action. Store merge-related approval as recommendation/audit only.

### `audit_events`

Purpose: immutable-ish event stream for security, operational history, approvals, AI outputs, and settings changes.

Columns:

- `id uuid primary key`
- `workspace_id uuid references workspaces(id)`
- `actor_user_id uuid references users(id)`
- `event_type text not null`
- `entity_type text`
- `entity_id uuid`
- `metadata jsonb not null default '{}'`
- `ip_address text`
- `user_agent text`
- `created_at timestamptz not null default now()`

Event examples:

- `document.uploaded`
- `document.indexed`
- `rag.answer_generated`
- `workflow.run_created`
- `workflow.output_generated`
- `approval.requested`
- `approval.approved`
- `approval.rejected`
- `approval.edited`
- `external_action.blocked`
- `external_action.executed`
- `permission.denied`
- `settings.changed`

Indexes:

- `(workspace_id, created_at)`.
- `(entity_type, entity_id)`.
- `(event_type, created_at)`.
- `(actor_user_id, created_at)`.

Tenant isolation: workspace events are scoped; platform events can use null `workspace_id`.

## 9. Index Strategy

- All tenant tables should index `workspace_id`.
- Frequently queried statuses should have `(workspace_id, status)`.
- Documents: `(workspace_id, collection_id, indexing_status)`.
- Messages: `(workspace_id, thread_id, created_at)`.
- Workflow runs: `(workspace_id, status, created_at)`.
- Approvals: `(workspace_id, status, risk_level, created_at)`.
- Audit events: `(workspace_id, created_at)`, `(entity_type, entity_id)`.
- Keep indexes focused in P0; avoid speculative indexes until query patterns are real.

## 10. Tenant Isolation Strategy

MVP:

- Every workspace-scoped table has `workspace_id`.
- API must always filter by authenticated member workspace.
- No cross-workspace query without operator permission.

Future production:

- PostgreSQL RLS policies.
- Workspace context via session variable or auth claims.
- Dedicated deployment for enterprise clients.
- Separate object storage prefixes per workspace.
- Separate vector namespace per workspace.

## 11. RLS Draft

Conceptual RLS rules:

- Users can see only workspaces where they are members.
- Members can access only rows with their active `workspace_id`.
- Owner/Admin can manage workspace settings and members.
- Collection permissions restrict knowledge collection and document access.
- Approval permissions restrict approve/reject/edit actions.
- External actions require explicit permission and approved approval request.
- Operator console is limited to platform operators.

Possible future session context:

- `app.current_user_id`
- `app.current_workspace_id`
- `app.current_permissions`

RLS should not replace service-layer checks; it should be a second guardrail.

## 12. Object Storage Boundary

Recommended object key layout:

```text
/workspaces/{workspace_id}/documents/{document_id}/original/{filename}
/workspaces/{workspace_id}/documents/{document_id}/versions/{version_id}/{filename}
/workspaces/{workspace_id}/exports/reports/{report_id}.md
/workspaces/{workspace_id}/exports/workflows/{workflow_run_id}.md
/workspaces/{workspace_id}/attachments/{attachment_id}/{filename}
```

Rules:

- Store only object keys/URIs in DB.
- Prefix all objects by workspace.
- Never store secrets in object keys.
- Preserve original uploads separately from extracted text and generated exports.

## 13. Vector Storage Boundary

Option A: `pgvector` in Postgres for MVP.

- Simpler deployment.
- Easier joins with document metadata.
- May be enough for first demo.

Option B: Qdrant later.

- Better for scaling vector search.
- Separate vector namespaces per workspace.
- More operational complexity.

Recommendation:

- Keep `document_chunks.vector_id` abstract.
- Do not hard-bind schema to either option in P0.
- If `pgvector` is chosen, add embedding column later or create a separate `document_chunk_embeddings` table.

## 14. Seed Data Recommendation

Seed data for first backend milestone:

- workspace: `Smart Algorithms Demo`;
- user: demo owner;
- roles: 8 system roles;
- permissions: base permission set;
- AI departments as config or seed;
- workflow templates:
  - Knowledge Base;
  - Support Reply;
  - Telegram Content;
  - Product / Codex Task;
  - QA / Review Report;
- knowledge collections:
  - Product;
  - Support;
  - Marketing;
  - Engineering;
  - Legal/Security;
- mock approvals for demo.

## 15. Migration Order

1. Extensions / UUID helper.
2. `workspaces`.
3. `users`.
4. Roles / permissions / members.
5. Knowledge collections / documents / chunks.
6. Assistant threads / messages.
7. Workflow templates / runs / steps.
8. Approvals.
9. Audit events.
10. Reports / integrations later.

## 16. ERD Text Diagram

```text
workspaces
  ├─ workspace_members ─ users
  │    └─ member_role_assignments ─ roles ─ role_permissions ─ permissions
  ├─ knowledge_collections ─ knowledge_documents ─ document_chunks
  ├─ assistant_threads ─ assistant_messages
  ├─ workflow_runs ─ workflow_step_runs
  │    └─ approval_requests
  ├─ audit_events
  ├─ reports ─ report_sections / report_metrics        (P1)
  ├─ integration_connections ─ external_actions         (P1)
  ├─ infrastructure_environments ─ system_health_snapshots (P2)
  └─ managed_service_accounts                           (P2)

workflow_templates
  └─ workflow_runs

departments                                            (P1)
  ├─ assistants
  └─ workflow_templates
```

## 17. SQL DDL Draft

This is a draft for future migrations, not an executable migration file.

```sql
-- Extensions / helpers
create extension if not exists pgcrypto;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  type text not null,
  region text not null,
  status text not null check (status in ('demo', 'active', 'suspended', 'archived')),
  plan_code text,
  data_residency text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_workspaces__status on workspaces (status);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  status text not null check (status in ('invited', 'active', 'disabled')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_users__status on users (status);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references users(id),
  status text not null check (status in ('invited', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_workspace_members__workspace_user unique (workspace_id, user_id)
);

create index idx_workspace_members__workspace_id on workspace_members (workspace_id);
create index idx_workspace_members__user_id on workspace_members (user_id);
create index idx_workspace_members__workspace_status on workspace_members (workspace_id, status);

create table roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id),
  code text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_roles__workspace_code unique (workspace_id, code)
);

create index idx_roles__workspace_id on roles (workspace_id);
create index idx_roles__code on roles (code);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  group_code text not null,
  description text
);

create index idx_permissions__group_code on permissions (group_code);

create table role_permissions (
  role_id uuid not null references roles(id),
  permission_id uuid not null references permissions(id),
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index idx_role_permissions__permission_id on role_permissions (permission_id);

create table member_role_assignments (
  member_id uuid not null references workspace_members(id),
  role_id uuid not null references roles(id),
  created_at timestamptz not null default now(),
  primary key (member_id, role_id)
);

create index idx_member_role_assignments__role_id on member_role_assignments (role_id);

create table knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  name text not null,
  slug text not null,
  description text,
  status text not null check (status in ('active', 'archived')),
  visibility text not null check (visibility in ('workspace', 'restricted', 'private')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_knowledge_collections__workspace_slug unique (workspace_id, slug)
);

create index idx_knowledge_collections__workspace_id on knowledge_collections (workspace_id);
create index idx_knowledge_collections__workspace_status on knowledge_collections (workspace_id, status);
create index idx_knowledge_collections__workspace_visibility on knowledge_collections (workspace_id, visibility);

create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  collection_id uuid references knowledge_collections(id),
  title text not null,
  source_type text not null,
  file_uri text,
  mime_type text,
  status text not null check (status in ('active', 'archived', 'deleted')),
  indexing_status text not null check (indexing_status in ('uploaded', 'parsing', 'chunking', 'embedding', 'indexed', 'failed', 'archived')),
  uploaded_by uuid references users(id),
  current_version_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_knowledge_documents__workspace_id on knowledge_documents (workspace_id);
create index idx_knowledge_documents__workspace_collection_indexing on knowledge_documents (workspace_id, collection_id, indexing_status);
create index idx_knowledge_documents__workspace_status on knowledge_documents (workspace_id, status);
create index idx_knowledge_documents__uploaded_by on knowledge_documents (uploaded_by);

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  document_id uuid not null references knowledge_documents(id),
  version_id uuid,
  chunk_index integer not null,
  text text not null,
  token_count integer,
  vector_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_document_chunks__workspace_document on document_chunks (workspace_id, document_id);
create index idx_document_chunks__workspace_vector_id on document_chunks (workspace_id, vector_id);
create index idx_document_chunks__document_chunk_index on document_chunks (document_id, chunk_index);

create table assistant_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  assistant_code text,
  title text,
  status text not null check (status in ('active', 'archived')),
  created_by uuid references users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_assistant_threads__workspace_id on assistant_threads (workspace_id);
create index idx_assistant_threads__workspace_status on assistant_threads (workspace_id, status);
create index idx_assistant_threads__workspace_created_at on assistant_threads (workspace_id, created_at);
create index idx_assistant_threads__created_by on assistant_threads (created_by);

create table assistant_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  thread_id uuid not null references assistant_threads(id),
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text,
  parts jsonb not null default '[]'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index idx_assistant_messages__workspace_thread_created_at on assistant_messages (workspace_id, thread_id, created_at);
create index idx_assistant_messages__workspace_role on assistant_messages (workspace_id, role);

create table workflow_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  department_code text,
  title text not null,
  description text,
  status text not null check (status in ('mvp_active', 'planned', 'future', 'disabled')),
  roadmap_phase text,
  requires_approval boolean not null default true,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  default_steps jsonb not null default '[]'::jsonb,
  allowed_role_codes text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_workflow_templates__department_code on workflow_templates (department_code);
create index idx_workflow_templates__status on workflow_templates (status);
create index idx_workflow_templates__roadmap_phase on workflow_templates (roadmap_phase);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  template_id uuid references workflow_templates(id),
  status text not null check (status in ('draft', 'queued', 'running', 'generated', 'waiting_approval', 'approved', 'rejected', 'executed', 'failed', 'cancelled')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  assigned_to uuid references users(id),
  approval_request_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_workflow_runs__workspace_id on workflow_runs (workspace_id);
create index idx_workflow_runs__workspace_status_created_at on workflow_runs (workspace_id, status, created_at);
create index idx_workflow_runs__workspace_template on workflow_runs (workspace_id, template_id);
create index idx_workflow_runs__created_by on workflow_runs (created_by);

create table workflow_step_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  run_id uuid not null references workflow_runs(id),
  step_key text not null,
  type text not null,
  status text not null check (status in ('pending', 'running', 'success', 'failed', 'skipped', 'waiting_approval')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index idx_workflow_step_runs__workspace_run on workflow_step_runs (workspace_id, run_id);
create index idx_workflow_step_runs__workspace_status on workflow_step_runs (workspace_id, status);
create index idx_workflow_step_runs__run_step_key on workflow_step_runs (run_id, step_key);

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  workflow_run_id uuid references workflow_runs(id),
  action_type text not null,
  status text not null check (status in ('pending', 'approved', 'rejected', 'edited', 'expired', 'cancelled')),
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  requested_by uuid references users(id),
  approved_by uuid references users(id),
  rejected_by uuid references users(id),
  allowed_approver_role_codes text[],
  original_payload jsonb not null default '{}'::jsonb,
  edited_payload jsonb,
  final_payload jsonb,
  risk_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_approval_requests__workspace_status_risk_created_at on approval_requests (workspace_id, status, risk_level, created_at);
create index idx_approval_requests__workspace_action_type on approval_requests (workspace_id, action_type);
create index idx_approval_requests__workflow_run_id on approval_requests (workflow_run_id);
create index idx_approval_requests__requested_by on approval_requests (requested_by);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id),
  actor_user_id uuid references users(id),
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_audit_events__workspace_created_at on audit_events (workspace_id, created_at);
create index idx_audit_events__entity_ref on audit_events (entity_type, entity_id);
create index idx_audit_events__event_type_created_at on audit_events (event_type, created_at);
create index idx_audit_events__actor_created_at on audit_events (actor_user_id, created_at);
```

## 18. Open Questions Before Real DB

- Supabase managed Postgres or self-host Postgres?
- Supabase Auth or custom auth?
- `pgvector` in MVP or Qdrant immediately?
- RLS in first migration or after auth is implemented?
- First object storage: S3-compatible, Yandex Object Storage, or local dev storage?
- How should secrets/integration tokens be stored?
- Deployment model: single-tenant first or multi-tenant first?
- Do RU contour and future international contour need deployment-level separation?
- Data localization: RU labels in seed data or i18n keys?
- Soft delete for all tenant entities or only selected tables?
- Should `workflow_templates` be global only in MVP, or workspace-customizable from day one?
- How should long AI/tool outputs be spilled into object storage?

## 19. Non-goals

This document does not implement:

- backend;
- migrations;
- auth;
- real RAG;
- file upload;
- vector DB;
- integrations;
- billing;
- full CRM;
- autonomous bots;
- automatic merge;
- external publish without approval.

## 20. Next Step

Recommended sequence:

1. Review this document as `database-schema-v0.1.md`.
2. Create `database-schema-review-v0.1.md` if stakeholders need formal review notes.
3. Create `db-foundation-implementation-plan-v0.1.md`.
4. Only then create real migrations.
