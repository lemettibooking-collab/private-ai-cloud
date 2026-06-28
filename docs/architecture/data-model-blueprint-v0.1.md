# Private AI Cloud Data Model Blueprint v0.1

Date: 2026-06-28

Baseline: `481acf5a1f942d09f5c1b581723c8579a5f77c19`

## 1. Purpose

This document defines the first backend/data model blueprint for Private AI Cloud before database schema and backend implementation.

It translates the current frontend-only UI prototype, Product Blueprint v0.2, UI blueprint, workflow blueprint, and QA review into a stable domain model. It is not an implementation plan for code generation, migrations, auth, Docker, real RAG, or integrations.

## 2. Current Product State

- The project is a frontend-only UI prototype.
- The app uses Next.js App Router, TypeScript, Tailwind CSS, and mocked TypeScript data.
- The baseline UI commit is `481acf5a1f942d09f5c1b581723c8579a5f77c19`.
- There is no backend, database, auth, Docker runtime, real LLM/RAG, or live integration layer yet.
- The UI covers Dashboard, Knowledge Base, RAG Chat, AI Departments, Workflows, Approvals, Reports, Settings, and Roadmap.
- The next step after this document should be `database-schema-v0.1.md`, then backend foundation.

## 3. Data Model Principles

- Workspace-first: every business object belongs to a workspace.
- Tenant isolation: workspace data must not mix across clients.
- Approval-first: generated outputs and sensitive actions need explicit review records.
- Audit-first: important state changes, AI actions, document events, approvals, and integration attempts must produce audit events.
- RAG/source-grounded: answers and workflow outputs should store source references when produced from knowledge.
- External actions locked by default: publish, send, run, create external records, and local runner actions stay disabled until policy, approval, audit, and allowlists exist.
- Roles and permissions mandatory: UI permissions are only hints; backend enforcement is required later.
- MVP schema should support future departments without redesign.
- Do not build a full CRM in MVP; sales/customer success concepts should stay lightweight AI operations records until explicitly promoted.
- Smart Algorithms Demo is the first workspace and should be seed data.

## 4. Storage Boundaries

### PostgreSQL

Store structured product state:

- users;
- workspaces;
- workspace members;
- roles;
- permissions;
- departments;
- assistants;
- workflows;
- workflow runs;
- approvals;
- reports;
- document metadata;
- audit logs;
- integration metadata;
- settings.

### Object Storage

Store large or binary artifacts:

- uploaded files;
- generated markdown exports;
- report exports;
- attachments;
- future document versions.

Object storage should be referenced from PostgreSQL by URI/object key, never by copying binary content into relational tables.

### Vector Database

Store retrieval-oriented data:

- document chunks;
- embeddings;
- chunk metadata;
- source references.

First implementation can use `pgvector` if the team chooses Postgres-first simplicity. Qdrant or another dedicated vector store can be introduced later if scale or retrieval operations require it.

### Redis / Queue Later

Store transient/background execution state:

- background jobs;
- indexing queue;
- workflow execution queue;
- rate limits;
- temporary locks.

Redis should not be a source of truth for approvals, audit, workflow results, or document metadata.

### Local Config / TypeScript Config For MVP

Keep static prototype definitions in TypeScript until backend schema lands:

- static department definitions;
- workflow template definitions;
- status labels;
- UI navigation.

When backend v1 arrives, static config can seed relational tables.

## 5. Core Entities Overview

| Entity | Purpose | Main fields | Relationships | Status |
|---|---|---|---|---|
| Workspace | Tenant/company boundary. | id, name, slug, type, region, status, plan_code, data_residency | has members, collections, workflows, approvals, reports | MVP P0 |
| User | Global human account. | id, email, name, status, locale, created_at | joins workspaces through WorkspaceMember | MVP P0 |
| WorkspaceMember | User membership in a workspace. | id, workspace_id, user_id, status, invited_by | has role assignments | MVP P0 |
| Role | Workspace role template. | id, workspace_id, code, name, description, is_system | maps to permissions | MVP P0 |
| Permission | Stable permission flag/action. | id, code, group, description | assigned through role_permissions | MVP P0 |
| Department | AI department/product lane. | id, code, title, description, status, roadmap_phase | owns assistants and workflow templates | MVP config, backend P1 |
| Assistant | AI assistant profile. | id, workspace_id, department_code, code, name, allowed_tools | used by threads, runs, workflows | MVP config, backend P1 |
| KnowledgeCollection | Logical source group. | id, workspace_id, name, description, visibility | has documents and access rules | MVP P0 |
| KnowledgeDocument | Source document metadata. | id, workspace_id, collection_id, title, status, file_uri | has versions and chunks | MVP P0 |
| DocumentVersion | Version of an uploaded/extracted document. | id, document_id, version, file_uri, checksum | has chunks and analysis results | P1 |
| DocumentChunk | Retrieval unit. | id, document_id, version_id, chunk_index, text, vector_id | linked to RAG source refs | MVP P0 |
| RAGQuery | Stored source-grounded question/answer. | id, workspace_id, thread_id, question, answer_status | belongs to thread; has source refs | P1 |
| AssistantThread | Chat thread. | id, workspace_id, assistant_id, title, status | has messages and runs | MVP P0 |
| AssistantMessage | Chat message. | id, thread_id, role, content, metadata | belongs to thread/run | MVP P0 |
| AssistantRun | AI execution attempt. | id, thread_id, assistant_id, status, usage | has tool calls and logs | P1 |
| AssistantToolCall | Tool invocation record. | id, run_id, tool_name, input, output_ref, status | belongs to assistant run | P1 |
| WorkflowTemplate | Human-facing workflow definition. | id, code, title, department_code, input_schema | has versions and runs | MVP P0 |
| WorkflowVersion | Frozen executable definition. | id, template_id, version, steps, status | used by workflow runs | P1 |
| WorkflowRun | One workflow execution attempt. | id, workspace_id, template_id, status, input_payload, output_payload | has step runs, approvals, audit events | MVP P0 |
| WorkflowStepRun | Step execution state. | id, run_id, step_key, type, status, input, output | has step logs | MVP P0 |
| WorkflowStepLog | Structured step log. | id, step_run_id, level, event_type, message, details | belongs to step run | P1 |
| ApprovalRequest | Review gate for output/action. | id, workspace_id, action_type, status, risk_level, payloads | has decisions, external action, audit | MVP P0 |
| ApprovalDecision | Reviewer action/comment. | id, approval_id, decision, decided_by, comment | belongs to approval | P1 |
| ExternalAction | Side-effect request/execution record. | id, workspace_id, approval_id, action_type, status | linked to approval and integration | P1 |
| Report | Generated summary/report. | id, workspace_id, report_type, title, status | has sections and metrics | P1 |
| ReportSection | Report content block. | id, report_id, title, content, order_index | belongs to report | P1 |
| IntegrationConnection | Workspace integration config metadata. | id, workspace_id, provider, status, config_metadata | used by external actions | P1 |
| AuditEvent | Immutable-ish event history. | id, workspace_id, actor_id, event_type, entity_ref, metadata | references any entity | MVP P0 |
| SystemHealthSnapshot | Operational status sample. | id, workspace_id, health_status, metrics, created_at | feeds dashboard/operator console | P2 |
| InfrastructureEnvironment | Deployment/environment record. | id, workspace_id, region, deployment_type, status | has health and usage snapshots | P2 |
| ManagedServiceAccount | Service relationship for client ops. | id, workspace_id, service_tier, owner, status | has SLA, tasks, support requests | P2 |

## 6. Workspace / Tenant Model

Workspace represents a client boundary/company context. Smart Algorithms Demo is the first workspace. Future client pilots should use separate workspaces. Enterprise clients may later map a workspace to a dedicated deployment/environment.

Data from different workspaces must not mix. Every workspace-scoped table should include `workspace_id` and use backend authorization checks. If Postgres RLS is chosen, `workspace_id` will be the primary tenant predicate.

Suggested `workspaces` fields:

- `id`;
- `name`;
- `slug`;
- `type`: `internal_demo`, `client_pilot`, `client_production`, `managed_service`;
- `region`;
- `status`: `active`, `paused`, `archived`;
- `plan_code`;
- `data_residency`;
- `created_at`;
- `updated_at`.

## 7. Users, Roles & Permissions

### Roles

Initial roles from the Product Blueprint:

- Owner;
- Admin;
- Support Operator;
- Marketing Operator;
- Product Manager;
- Developer / Reviewer;
- Viewer;
- Demo Viewer.

### Tables

- `users`: global identity/profile.
- `workspace_members`: membership and workspace actor state.
- `roles`: role definitions, system or workspace-specific.
- `permissions`: stable permission registry.
- `role_permissions`: role-to-permission mapping.
- `member_role_assignments`: member-to-role mapping.

### Permission Groups

- `workspace`;
- `knowledge`;
- `rag_chat`;
- `assistants`;
- `workflows`;
- `approvals`;
- `reports`;
- `integrations`;
- `security`;
- `operator_console`;
- `codex`;
- `local_runner`;
- `external_actions`.

### Mandatory Permissions

- `can_manage_workspace`;
- `can_manage_users`;
- `can_manage_roles`;
- `can_upload_documents`;
- `can_view_knowledge_collection`;
- `can_run_rag_chat`;
- `can_run_workflow`;
- `can_approve_action`;
- `can_publish_external`;
- `can_create_codex_task`;
- `can_launch_codex`;
- `can_run_local_checks`;
- `can_view_audit_logs`;
- `can_manage_integrations`;
- `can_view_operator_console`.

MVP can seed roles and permissions as static data. Backend must enforce these permissions server-side before any real action is added.

## 8. AI Departments Model

The product has 10 AI Departments:

1. AI Support Department.
2. AI Marketing & Growth Department.
3. AI Community Engagement Department.
4. AI Sales Department.
5. AI Customer Success / Upsell Department.
6. AI Product Department.
7. AI Development / Codex Orchestration Department.
8. AI QA / Code Review Department.
9. AI Executive Analytics Department.
10. AI Legal / Document Department.

Suggested `departments` fields:

- `id`;
- `code`;
- `title`;
- `description`;
- `status`: `mvp_active`, `v0_2_planned`, `future`;
- `primary_assistant_id`;
- `roadmap_phase`;
- `created_at`;
- `updated_at`.

MVP can keep departments as TypeScript config. Backend v1 can migrate them into a `departments` table or seed table. Workflow templates should reference `department_code` so templates remain stable even if department display names change.

## 9. Assistants Model

Initial assistant profiles:

- Support Assistant;
- Marketing Assistant;
- Community Engagement Assistant;
- Sales Assistant;
- Customer Success Assistant;
- Product Assistant;
- Dev Task Assistant;
- QA / Code Review Assistant;
- Executive Assistant;
- Legal / Document Assistant.

Suggested `assistants` fields:

- `id`;
- `workspace_id`;
- `department_code`;
- `code`;
- `name`;
- `description`;
- `system_prompt_version`;
- `allowed_tools`;
- `allowed_collections`;
- `status`;
- `created_at`;
- `updated_at`.

MVP assistants are mocked/static. Backend later should allow assistants to be configurable per workspace while preserving default system templates.

## 10. Knowledge Base / RAG Model

### KnowledgeCollection

Purpose: logical source grouping for permissions and retrieval scope.

Fields:

- `id`;
- `workspace_id`;
- `name`;
- `slug`;
- `description`;
- `visibility`;
- `created_by`;
- `created_at`;
- `updated_at`.

### KnowledgeDocument

Suggested `knowledge_documents` fields:

- `id`;
- `workspace_id`;
- `collection_id`;
- `title`;
- `source_type`: `upload`, `url`, `github`, `drive`, `yandex`, `s3`, `manual`;
- `file_uri`;
- `mime_type`;
- `status`;
- `indexing_status`;
- `uploaded_by`;
- `current_version_id`;
- `created_at`;
- `updated_at`.

Indexing statuses:

- `uploaded`;
- `parsing`;
- `chunking`;
- `embedding`;
- `indexed`;
- `failed`;
- `archived`.

### DocumentVersion

Purpose: preserve file/extracted text history.

Fields:

- `id`;
- `workspace_id`;
- `document_id`;
- `version_number`;
- `file_uri`;
- `text_uri`;
- `checksum`;
- `created_by`;
- `created_at`.

### DocumentChunk

Suggested `document_chunks` fields:

- `id`;
- `workspace_id`;
- `document_id`;
- `version_id`;
- `chunk_index`;
- `text`;
- `token_count`;
- `vector_id`;
- `metadata`;
- `created_at`.

### RAGQuery

Suggested `rag_queries` fields:

- `id`;
- `workspace_id`;
- `thread_id`;
- `question`;
- `selected_collection_ids`;
- `answer`;
- `answer_status`: `answered`, `no_sources`, `failed`, `cancelled`;
- `source_references`;
- `created_by`;
- `created_at`.

### SourceReference

Purpose: link AI output to source chunks/documents.

Fields:

- `id`;
- `workspace_id`;
- `entity_type`: `assistant_message`, `workflow_run`, `report_section`, `rag_query`;
- `entity_id`;
- `document_id`;
- `version_id`;
- `chunk_id`;
- `confidence`;
- `excerpt`;
- `metadata`;
- `created_at`.

## 11. Document Intelligence Model

Document Intelligence covers:

- document summary;
- key terms extraction;
- risk detection;
- version comparison;
- checklist review;
- deadlines / amounts / obligations extraction;
- document card generation;
- lawyer questions draft;
- convert document into tasks.

Suggested entities:

### `document_analysis_jobs`

Tracks background analysis work.

Fields: `id`, `workspace_id`, `document_id`, `version_id`, `analysis_type`, `status`, `requested_by`, `started_at`, `completed_at`, `error_message`, `created_at`.

### `document_analysis_results`

Stores structured analysis output.

Fields: `id`, `workspace_id`, `job_id`, `document_id`, `version_id`, `result_type`, `summary`, `structured_result`, `source_references`, `created_at`.

### `document_comparisons`

Compares document versions.

Fields: `id`, `workspace_id`, `document_id`, `base_version_id`, `target_version_id`, `status`, `diff_summary`, `risk_summary`, `created_by`, `created_at`.

### `document_risk_items`

Stores reviewable risks.

Fields: `id`, `workspace_id`, `document_id`, `version_id`, `risk_type`, `severity`, `title`, `description`, `source_reference`, `status`, `created_at`.

### `extracted_obligations`

Stores extracted dates, amounts, duties, and owner actions.

Fields: `id`, `workspace_id`, `document_id`, `version_id`, `obligation_type`, `description`, `due_date`, `amount`, `responsible_party`, `source_reference`, `status`, `created_at`.

MVP: visible in UI, not implemented. Future: backend jobs + stored results.

## 12. RAG Chat / Assistant Threads Model

Entities:

- `assistant_threads`;
- `assistant_messages`;
- `assistant_runs`;
- `assistant_tool_calls`;
- `assistant_evaluations`.

Suggested fields:

- `workspace_id`;
- `assistant_id`;
- `created_by`;
- `title`;
- `status`;
- `messages`;
- `sources`;
- `tool_calls`;
- `quality_rating`;
- `saved_answer`.

Message roles:

- `user`;
- `assistant`;
- `system`;
- `tool`.

`assistant_messages` should store content parts and metadata, not just plain text, so future citations, files, tool previews, workflow links, and approval request links can be represented.

## 13. Workflow Engine Model

Use the workflow engine blueprint as source of truth for workflow concepts.

Entities:

- `workflow_templates`;
- `workflow_versions`;
- `workflow_runs`;
- `workflow_step_runs`;
- `workflow_step_logs`;
- `workflow_actions`;
- `external_actions`.

Workflow statuses:

- `draft`;
- `queued`;
- `running`;
- `generated`;
- `waiting_approval`;
- `approved`;
- `rejected`;
- `executed`;
- `failed`;
- `cancelled`.

Step statuses:

- `pending`;
- `running`;
- `success`;
- `failed`;
- `skipped`;
- `waiting_approval`.

MVP workflow templates:

- Knowledge Base;
- Support Reply;
- Telegram Content;
- Product / Codex Task;
- QA / Review Report.

Future workflow templates:

- Marketing Hook / Pain Mining;
- Sales / Lead Assistant;
- Customer Success / Upsell;
- Community Engagement;
- Legal / Document;
- Executive Analytics.

Important model rule: a workflow run can generate output without executing an external action. Execution requires approval and, later, integration policy checks.

## 14. Approval Model

Entities:

- `approval_requests`;
- `approval_decisions`;
- optional `approval_reviewers` or allowed approver rules;
- linked `external_actions` for side effects.

Approval statuses:

- `pending`;
- `approved`;
- `rejected`;
- `edited`;
- `expired`;
- `cancelled`.

`approval_requests` should store:

- requested action type;
- requested by;
- allowed approvers;
- risk level;
- status;
- original AI payload;
- edited payload;
- final payload;
- source documents/source references;
- risk notes;
- linked workflow run;
- linked external action if applicable;
- created/resolved timestamps.

Approval examples:

- Telegram post publication;
- support reply beyond FAQ;
- lead follow-up;
- Codex task creation;
- Codex launch;
- local checks run;
- external integration action;
- code acceptance;
- merge manual outside system.

Merge must not be an external action inside the system. Merge is manual outside the system. The system can only record an audit note, recommendation, or acceptance/rejection decision.

## 15. Reports Model

Entities:

- `reports`;
- `report_sections`;
- `report_metrics`;
- `report_recommendations`;
- `owner_decision_points`.

Report types:

- Weekly Owner Report;
- Daily Report planned;
- Support Summary;
- Leads Summary;
- Marketing Summary;
- Product Summary;
- Development Summary;
- QA / Code Review Summary;
- System Usage Summary.

Suggested `reports` fields:

- `id`;
- `workspace_id`;
- `report_type`;
- `title`;
- `status`;
- `generated_by_assistant_id`;
- `period_start`;
- `period_end`;
- `created_by`;
- `created_at`;
- `updated_at`.

Owner reports should link back to approvals, workflow runs, documents, and source references where possible.

## 16. Integrations Model

Entities:

- `integration_connections`;
- `integration_events`;
- `external_actions`.

Integrations:

- Telegram;
- website/forms;
- email;
- GitHub/GitLab;
- local runner;
- CRM Bitrix24/amoCRM;
- user product database;
- webhooks;
- file storage;
- YouTube;
- MAX;
- Instagram later/careful.

Statuses:

- `not_connected`;
- `planned`;
- `connected`;
- `locked`;
- `error`;
- `disabled`.

Integration secrets should not be stored directly in connection rows. Store secret references/metadata only, with real secret storage decided separately.

## 17. Security, Audit & Compliance Model

Entities:

- `audit_events`;
- `access_logs`;
- `ai_request_logs`;
- `document_access_logs`;
- `approval_audit_logs`;
- `api_key_secret_metadata`.

Audit event examples:

- document uploaded;
- document indexed;
- RAG answer generated;
- workflow run created;
- AI output generated;
- approval requested;
- approval approved/rejected/edited;
- external action executed;
- integration error;
- permission denied;
- settings changed.

Audit events should include workspace, actor, event type, entity type/id, risk level when relevant, IP/user agent later, and structured metadata.

## 18. Infrastructure / Operator Console Model

Entities:

- `infrastructure_environments`;
- `system_health_snapshots`;
- `resource_usage_snapshots`;
- `incidents`;
- `sla_statuses`.

MVP: mocked status. Future: real monitoring.

Suggested fields:

- `environment_id`;
- `workspace_id`;
- `region`;
- `deployment_type`;
- `cpu_usage`;
- `gpu_usage`;
- `memory_usage`;
- `storage_usage`;
- `latency`;
- `errors_count`;
- `health_status`;
- `created_at`.

The operator console should read from snapshots and incidents, not from live service calls in page render paths.

## 19. Managed Service Model

Entities:

- `managed_service_accounts`;
- `client_audits`;
- `implementation_tasks`;
- `sla_agreements`;
- `support_requests`;
- `optimization_recommendations`.

MVP: visible in settings/roadmap only. Future: used for client pilots.

Managed service data should be separated from client workspace operational data but linked by `workspace_id` and service account identifiers.

## 20. Roadmap Phase Mapping

| Entity / Module | v0.1 Smart Algorithms Internal Demo | v0.2 Operations MVP | v0.3 First Client Pilot | v1.0 Productized Platform | v2.0 Own AI Infrastructure Layer |
|---|---|---|---|---|---|
| Workspace | Smart Algorithms Demo seed | Internal operations workspace | Separate client workspace | Multi-tenant workspaces | Dedicated environments |
| Users/Roles/Permissions | Static roles, demo owner | Enforced RBAC | Demo Viewer/client roles | Scalable permission admin | Infra/operator roles |
| Knowledge Base | Metadata + mocked docs | Upload/index backend | Client document upload | Multi-tenant source management | Dedicated storage controls |
| RAG Chat | UI + mocked sources | Real retrieval for selected collections | Client RAG pilot | Package-level RAG modules | Centralized inference/RAG ops |
| AI Departments | Static 10 department map | More active departments | 2-3 selected packages | Packaged AI modules | Dedicated client environments |
| Workflows | MVP templates | Workflow persistence | Client pilot workflows | Versioned workflow engine | Workflow execution at infra scale |
| Approvals | UI + mocked queue | Persisted approval records | Client approval audit | Policy-driven approvals | Enterprise audit controls |
| Reports | Weekly Owner Report UI | Stored reports | Client pilot reports | Usage/report analytics | Cost/infra analytics |
| Integrations | Locked metadata | Telegram/site support planned | Limited pilot integrations | Integration hub | Infra-level integration controls |
| Audit | Mocked timeline | Stored audit events | Client audit export | Compliance reporting | Dedicated environment audit |
| Infrastructure | Mock status | Operator console planning | Managed rented RF deployment | Deployment templates | Own GPU colocation |
| Managed Service | Roadmap/settings only | Service model planning | Client pilot operations | SLA/service tiers | Reserved capacity management |

## 21. First Database Schema Recommendation

### P0 Tables

- `workspaces`;
- `users`;
- `workspace_members`;
- `roles`;
- `permissions`;
- `role_permissions`;
- `knowledge_collections`;
- `knowledge_documents`;
- `document_chunks`;
- `assistant_threads`;
- `assistant_messages`;
- `workflow_templates`;
- `workflow_runs`;
- `workflow_step_runs`;
- `approval_requests`;
- `audit_events`.

### P1 Tables

- `assistants`;
- `departments`;
- `document_versions`;
- `rag_queries`;
- `assistant_runs`;
- `assistant_tool_calls`;
- `reports`;
- `report_sections`;
- `integration_connections`.

### P2 / Future Tables

- `infrastructure_snapshots`;
- `managed_service_accounts`;
- `incidents`;
- `document_analysis_jobs`;
- `document_analysis_results`;
- `customer_success_segments`;
- `sales_leads`.

P0 should be enough to move from mocked UI to a minimal persisted backend while keeping external actions locked.

## 22. Open Questions

- Use Supabase/Postgres or self-host Postgres?
- Use `pgvector` or a separate Qdrant deployment?
- Use schema-per-tenant or `workspace_id` + RLS for tenant isolation?
- How should uploaded files be stored: local object storage, S3-compatible storage, or provider-specific storage?
- How should secrets be stored and referenced?
- Which integrations come first: Telegram, GitHub, website forms, email, or local runner?
- How will auth be implemented?
- Which roles are required in the first demo backend?
- Is Russian localization required in stored seed data, enum labels, or only UI copy?
- How should audit log retention be handled?
- Do workflow definitions need a visual editor soon, or only template config?
- Which AI provider/model policy is acceptable for first RAG testing?

## 23. Non-goals

Currently not designing:

- full CRM;
- billing;
- autonomous bots;
- model marketplace;
- public GPU panel;
- automatic merge;
- external publishing without approval;
- full no-code workflow builder.

## 24. Next Step

Create the next architecture artifact:

`database-schema-v0.1.md`

That document should convert the P0/P1 table recommendations into concrete schema definitions, indexes, enum choices, relationship constraints, and migration order. Do not create it as part of this task.
