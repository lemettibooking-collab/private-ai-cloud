-- Private AI Cloud
-- Seed: 0001_seed_smart_algorithms_demo
-- Purpose: Demo seed data for Smart Algorithms AI Operations Center.
-- Notes:
-- - PostgreSQL target.
-- - Safe/idempotent seed.
-- - No destructive operations.
-- - No application DB connection is created by this file.

-- Workspace / identity

do $seed_workspace$
declare
  has_domain_mapping boolean;
  identity_conflict boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'workspaces'
      and column_name = 'domain_workspace_id'
  ) into has_domain_mapping;

  if has_domain_mapping then
    execute $sql$
      select exists (
        select 1 from workspaces
        where (domain_workspace_id = 'smart-algorithms-demo'
            and id <> '00000000-0000-4000-8000-000000000001')
           or (slug = 'smart-algorithms-demo'
            and id <> '00000000-0000-4000-8000-000000000001')
           or (id = '00000000-0000-4000-8000-000000000001'
            and (slug is distinct from 'smart-algorithms-demo'
              or domain_workspace_id is distinct from 'smart-algorithms-demo'))
      )
    $sql$ into identity_conflict;
    if identity_conflict then
      raise exception using
        errcode = '23514',
        constraint = 'smart_algorithms_demo_workspace_identity',
        message = 'Smart Algorithms demo Workspace identity is contradictory.';
    end if;
    execute $sql$
      insert into workspaces (
        id, domain_workspace_id, name, slug, type, region, status,
        plan_code, data_residency, settings
      ) values (
        '00000000-0000-4000-8000-000000000001',
        'smart-algorithms-demo',
        'Smart Algorithms Demo',
        'smart-algorithms-demo',
        'demo', 'RU', 'demo', 'internal-demo', 'RU',
        '{"external_actions_locked_by_default":true,"approval_first":true,"roadmap_phase":"v0.1","product":"Smart Algorithms AI Operations Center"}'::jsonb
      )
      on conflict (id) do update set
        name = excluded.name,
        type = excluded.type,
        region = excluded.region,
        status = excluded.status,
        plan_code = excluded.plan_code,
        data_residency = excluded.data_residency,
        settings = excluded.settings
    $sql$;
  else
    select exists (
      select 1 from workspaces
      where (slug = 'smart-algorithms-demo'
          and id <> '00000000-0000-4000-8000-000000000001')
         or (id = '00000000-0000-4000-8000-000000000001'
          and slug is distinct from 'smart-algorithms-demo')
    ) into identity_conflict;
    if identity_conflict then
      raise exception using
        errcode = '23514',
        constraint = 'smart_algorithms_demo_workspace_identity',
        message = 'Smart Algorithms demo Workspace identity is contradictory.';
    end if;
    execute $sql$
      insert into workspaces (
        id, name, slug, type, region, status, plan_code, data_residency, settings
      ) values (
        '00000000-0000-4000-8000-000000000001',
        'Smart Algorithms Demo',
        'smart-algorithms-demo',
        'demo', 'RU', 'demo', 'internal-demo', 'RU',
        '{"external_actions_locked_by_default":true,"approval_first":true,"roadmap_phase":"v0.1","product":"Smart Algorithms AI Operations Center"}'::jsonb
      )
      on conflict (id) do update set
        name = excluded.name,
        type = excluded.type,
        region = excluded.region,
        status = excluded.status,
        plan_code = excluded.plan_code,
        data_residency = excluded.data_residency,
        settings = excluded.settings
    $sql$;
  end if;
end;
$seed_workspace$;

insert into users (
  id,
  email,
  name,
  status
) values (
  '00000000-0000-4000-8000-000000000101',
  'owner@smartalgorithms.local',
  'Smart Algorithms Owner',
  'active'
)
on conflict (email) do update set
  name = excluded.name,
  status = excluded.status;

insert into workspace_members (
  id,
  workspace_id,
  user_id,
  status
) values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000101',
  'active'
)
on conflict (workspace_id, user_id) do update set
  status = excluded.status;

-- Roles / permissions

insert into roles (
  id,
  workspace_id,
  code,
  name,
  description,
  is_system
)
select *
from (
  values
    ('00000000-0000-4000-8000-000000000301'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'owner', 'Owner', 'Full workspace owner role.', true),
    ('00000000-0000-4000-8000-000000000302'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'admin', 'Admin', 'Workspace administrator role.', true),
    ('00000000-0000-4000-8000-000000000303'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'support_operator', 'Support Operator', 'Support workflow operator role.', true),
    ('00000000-0000-4000-8000-000000000304'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'marketing_operator', 'Marketing Operator', 'Marketing workflow operator role.', true),
    ('00000000-0000-4000-8000-000000000305'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'product_manager', 'Product Manager', 'Product planning and task creation role.', true),
    ('00000000-0000-4000-8000-000000000306'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'developer_reviewer', 'Developer / Reviewer', 'Development review and local runner role.', true),
    ('00000000-0000-4000-8000-000000000307'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'viewer', 'Viewer', 'Read-only workspace role.', true),
    ('00000000-0000-4000-8000-000000000308'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'demo_viewer', 'Demo Viewer', 'Limited demo viewer role.', true)
) as seed_roles(id, workspace_id, code, name, description, is_system)
where not exists (
  select 1
  from roles
  where roles.workspace_id = seed_roles.workspace_id
    and roles.code = seed_roles.code
);

insert into permissions (
  code,
  group_code,
  description
) values
  ('workspace.manage', 'workspace', 'Manage workspace settings.'),
  ('users.manage', 'users', 'Manage users and workspace members.'),
  ('roles.manage', 'roles', 'Manage roles and permissions.'),
  ('knowledge.upload', 'knowledge', 'Upload and manage knowledge sources.'),
  ('knowledge.view_collection', 'knowledge', 'View knowledge collections.'),
  ('rag_chat.run', 'rag_chat', 'Run RAG chat queries.'),
  ('assistants.manage', 'assistants', 'Manage assistant configuration.'),
  ('workflows.run', 'workflows', 'Run workflow templates.'),
  ('approvals.approve', 'approvals', 'Approve or reject approval requests.'),
  ('reports.view', 'reports', 'View reports.'),
  ('integrations.manage', 'integrations', 'Manage integrations.'),
  ('security.manage', 'security', 'Manage security settings.'),
  ('operator_console.view', 'operator_console', 'View operator console.'),
  ('codex.create_task', 'codex', 'Create Codex implementation tasks.'),
  ('codex.launch', 'codex', 'Launch Codex execution after approval.'),
  ('local_runner.run_checks', 'local_runner', 'Run local validation checks.'),
  ('external_actions.publish', 'external_actions', 'Publish external actions after approval.')
on conflict (code) do update set
  group_code = excluded.group_code,
  description = excluded.description;

insert into role_permissions (
  role_id,
  permission_id
)
select roles.id, permissions.id
from (
  values
    ('owner', 'workspace.manage'),
    ('owner', 'users.manage'),
    ('owner', 'roles.manage'),
    ('owner', 'knowledge.upload'),
    ('owner', 'knowledge.view_collection'),
    ('owner', 'rag_chat.run'),
    ('owner', 'assistants.manage'),
    ('owner', 'workflows.run'),
    ('owner', 'approvals.approve'),
    ('owner', 'reports.view'),
    ('owner', 'integrations.manage'),
    ('owner', 'security.manage'),
    ('owner', 'operator_console.view'),
    ('owner', 'codex.create_task'),
    ('owner', 'codex.launch'),
    ('owner', 'local_runner.run_checks'),
    ('owner', 'external_actions.publish'),
    ('admin', 'workspace.manage'),
    ('admin', 'users.manage'),
    ('admin', 'roles.manage'),
    ('admin', 'knowledge.upload'),
    ('admin', 'knowledge.view_collection'),
    ('admin', 'rag_chat.run'),
    ('admin', 'assistants.manage'),
    ('admin', 'workflows.run'),
    ('admin', 'approvals.approve'),
    ('admin', 'reports.view'),
    ('admin', 'integrations.manage'),
    ('admin', 'security.manage'),
    ('admin', 'operator_console.view'),
    ('admin', 'codex.create_task'),
    ('support_operator', 'knowledge.view_collection'),
    ('support_operator', 'rag_chat.run'),
    ('support_operator', 'workflows.run'),
    ('support_operator', 'approvals.approve'),
    ('support_operator', 'reports.view'),
    ('marketing_operator', 'knowledge.view_collection'),
    ('marketing_operator', 'rag_chat.run'),
    ('marketing_operator', 'workflows.run'),
    ('marketing_operator', 'approvals.approve'),
    ('marketing_operator', 'reports.view'),
    ('product_manager', 'knowledge.view_collection'),
    ('product_manager', 'rag_chat.run'),
    ('product_manager', 'workflows.run'),
    ('product_manager', 'approvals.approve'),
    ('product_manager', 'reports.view'),
    ('product_manager', 'codex.create_task'),
    ('developer_reviewer', 'knowledge.view_collection'),
    ('developer_reviewer', 'rag_chat.run'),
    ('developer_reviewer', 'workflows.run'),
    ('developer_reviewer', 'reports.view'),
    ('developer_reviewer', 'local_runner.run_checks'),
    ('viewer', 'knowledge.view_collection'),
    ('viewer', 'rag_chat.run'),
    ('viewer', 'reports.view'),
    ('demo_viewer', 'rag_chat.run'),
    ('demo_viewer', 'reports.view')
) as mapping(role_code, permission_code)
join roles
  on roles.workspace_id = '00000000-0000-4000-8000-000000000001'
  and roles.code = mapping.role_code
join permissions
  on permissions.code = mapping.permission_code
on conflict do nothing;

insert into member_role_assignments (
  member_id,
  role_id
)
select
  '00000000-0000-4000-8000-000000000201'::uuid,
  roles.id
from roles
where roles.workspace_id = '00000000-0000-4000-8000-000000000001'
  and roles.code = 'owner'
on conflict do nothing;

-- Knowledge base

insert into knowledge_collections (
  id,
  workspace_id,
  name,
  slug,
  description,
  status,
  visibility,
  created_by
) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', 'Product', 'product', 'Roadmap, product decisions, feature scope and positioning.', 'active', 'workspace', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', 'Support', 'support', 'FAQ, onboarding answers and support guidance.', 'active', 'workspace', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001', 'Marketing', 'marketing', 'SEO strategy, Telegram content and growth notes.', 'active', 'workspace', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000001', 'Engineering', 'engineering', 'Architecture handoff, Codex task templates and QA notes.', 'active', 'restricted', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000001', 'Legal / Security', 'legal-security', 'Legal, security and compliance notes.', 'active', 'restricted', '00000000-0000-4000-8000-000000000101')
on conflict (workspace_id, slug) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  visibility = excluded.visibility,
  created_by = excluded.created_by;

insert into knowledge_documents (
  id,
  workspace_id,
  collection_id,
  title,
  source_type,
  mime_type,
  status,
  indexing_status,
  uploaded_by,
  metadata
) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', 'Smart Algorithms Roadmap', 'manual_upload', 'text/markdown', 'active', 'indexed', '00000000-0000-4000-8000-000000000101', '{"demo": true, "source": "seed", "rag_ready": true}'::jsonb),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', 'Scanner MVP Checklist', 'manual_upload', 'text/markdown', 'active', 'indexed', '00000000-0000-4000-8000-000000000101', '{"demo": true, "source": "seed", "rag_ready": true}'::jsonb),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000402', 'Support FAQ', 'manual_upload', 'text/markdown', 'active', 'indexed', '00000000-0000-4000-8000-000000000101', '{"demo": true, "source": "seed", "rag_ready": true}'::jsonb),
  ('00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000403', 'SEO Strategy', 'manual_upload', 'text/markdown', 'active', 'indexed', '00000000-0000-4000-8000-000000000101', '{"demo": true, "source": "seed", "rag_ready": true}'::jsonb),
  ('00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000404', 'Codex Task Template', 'manual_upload', 'text/markdown', 'active', 'indexed', '00000000-0000-4000-8000-000000000101', '{"demo": true, "source": "seed", "rag_ready": true}'::jsonb),
  ('00000000-0000-4000-8000-000000000506', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000405', 'Legal and Security Notes', 'manual_upload', 'text/markdown', 'active', 'indexed', '00000000-0000-4000-8000-000000000101', '{"demo": true, "source": "seed", "rag_ready": false}'::jsonb)
on conflict (id) do update set
  collection_id = excluded.collection_id,
  title = excluded.title,
  source_type = excluded.source_type,
  mime_type = excluded.mime_type,
  status = excluded.status,
  indexing_status = excluded.indexing_status,
  uploaded_by = excluded.uploaded_by,
  metadata = excluded.metadata;

insert into document_chunks (
  id,
  workspace_id,
  document_id,
  chunk_index,
  text,
  token_count,
  vector_id,
  metadata
) values
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000501', 0, 'Roadmap v0.1 focuses on a closed AI Operations Center with dashboard, knowledge base, RAG chat, workflows, approvals and reports.', 24, 'demo-roadmap-0', '{"demo": true, "source": "seed"}'::jsonb),
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000501', 1, 'External actions stay locked by default and require approval-first controls before publication or execution.', 14, 'demo-roadmap-1', '{"demo": true, "source": "seed"}'::jsonb),
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000502', 0, 'Scanner MVP checklist tracks alert quality, owner review flow and careful handoff into implementation tasks.', 14, 'demo-scanner-0', '{"demo": true, "source": "seed"}'::jsonb),
  ('00000000-0000-4000-8000-000000000604', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000503', 0, 'Support answers should use approved FAQ guidance and escalate anything outside documented scope.', 12, 'demo-support-0', '{"demo": true, "source": "seed"}'::jsonb),
  ('00000000-0000-4000-8000-000000000605', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000504', 0, 'Marketing content should explain alert usefulness without investment promises or direct buy and sell signals.', 14, 'demo-marketing-0', '{"demo": true, "source": "seed"}'::jsonb),
  ('00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000505', 0, 'Codex tasks should describe scope, constraints, verification commands and approval requirements clearly.', 12, 'demo-codex-0', '{"demo": true, "source": "seed"}'::jsonb),
  ('00000000-0000-4000-8000-000000000607', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000506', 0, 'Security notes require restricted visibility and human approval for sensitive or external actions.', 12, 'demo-legal-security-0', '{"demo": true, "source": "seed"}'::jsonb)
on conflict (document_id, chunk_index) do update set
  text = excluded.text,
  token_count = excluded.token_count,
  vector_id = excluded.vector_id,
  metadata = excluded.metadata;

-- Workflow engine

insert into workflow_templates (
  id,
  code,
  department_code,
  title,
  description,
  status,
  roadmap_phase,
  requires_approval,
  input_schema,
  output_schema,
  default_steps,
  allowed_role_codes
) values
  ('00000000-0000-4000-8000-000000000701', 'knowledge-base-answer', 'core_platform', 'Knowledge Base Answer', 'Answer from approved knowledge sources.', 'mvp_active', 'v0.1', false, '{"type": "object", "required": ["question"]}'::jsonb, '{"type": "object", "required": ["answer", "sources"]}'::jsonb, '["input", "sources", "ai_output", "export"]'::jsonb, '{owner,admin,viewer,demo_viewer}'::text[]),
  ('00000000-0000-4000-8000-000000000702', 'support-reply', 'support', 'Support Reply', 'Draft support reply from FAQ and knowledge base.', 'mvp_active', 'v0.1', true, '{"type": "object", "required": ["customer_question"]}'::jsonb, '{"type": "object", "required": ["draft", "sources"]}'::jsonb, '["input", "sources", "ai_output", "risk_check", "approval"]'::jsonb, '{owner,admin,support_operator}'::text[]),
  ('00000000-0000-4000-8000-000000000703', 'telegram-content', 'marketing_growth', 'Telegram Content', 'Draft Telegram post from approved positioning.', 'mvp_active', 'v0.1', true, '{"type": "object", "required": ["topic"]}'::jsonb, '{"type": "object", "required": ["draft", "risk_notes"]}'::jsonb, '["input", "sources", "ai_output", "risk_check", "approval"]'::jsonb, '{owner,admin,marketing_operator}'::text[]),
  ('00000000-0000-4000-8000-000000000704', 'product-codex-task', 'development_codex', 'Product / Codex Task', 'Prepare implementation task for Codex after product review.', 'mvp_active', 'v0.1', true, '{"type": "object", "required": ["request"]}'::jsonb, '{"type": "object", "required": ["task_summary", "constraints"]}'::jsonb, '["input", "sources", "ai_output", "risk_check", "approval"]'::jsonb, '{owner,admin,product_manager,developer_reviewer}'::text[]),
  ('00000000-0000-4000-8000-000000000705', 'qa-review-report', 'qa_code_review', 'QA / Review Report', 'Summarize QA findings and recommended next action.', 'mvp_active', 'v0.1', false, '{"type": "object", "required": ["logs"]}'::jsonb, '{"type": "object", "required": ["recommendation"]}'::jsonb, '["input", "sources", "ai_output", "export"]'::jsonb, '{owner,admin,developer_reviewer}'::text[]),
  ('00000000-0000-4000-8000-000000000706', 'marketing-hook-pain-mining', 'marketing_growth', 'Marketing Hook Pain Mining', 'Mine customer pains and hooks for content planning.', 'planned', 'v0.2', true, '{"type": "object"}'::jsonb, '{"type": "object"}'::jsonb, '["input", "sources", "ai_output", "approval"]'::jsonb, '{owner,marketing_operator}'::text[]),
  ('00000000-0000-4000-8000-000000000707', 'sales-lead-qualification', 'sales', 'Sales Lead Qualification', 'Qualify leads from planned sales inputs.', 'planned', 'v0.2', true, '{"type": "object"}'::jsonb, '{"type": "object"}'::jsonb, '["input", "sources", "ai_output", "approval"]'::jsonb, '{owner,admin}'::text[]),
  ('00000000-0000-4000-8000-000000000708', 'customer-success-upsell', 'customer_success', 'Customer Success Upsell', 'Identify expansion opportunities from account context.', 'planned', 'v0.2', true, '{"type": "object"}'::jsonb, '{"type": "object"}'::jsonb, '["input", "sources", "ai_output", "approval"]'::jsonb, '{owner,admin}'::text[]),
  ('00000000-0000-4000-8000-000000000709', 'legal-document-review', 'legal_security', 'Legal Document Review', 'Review legal documents and surface risks.', 'future', 'v1.0', true, '{"type": "object"}'::jsonb, '{"type": "object"}'::jsonb, '["input", "sources", "ai_output", "approval"]'::jsonb, '{owner,admin}'::text[])
on conflict (code) do update set
  department_code = excluded.department_code,
  title = excluded.title,
  description = excluded.description,
  status = excluded.status,
  roadmap_phase = excluded.roadmap_phase,
  requires_approval = excluded.requires_approval,
  input_schema = excluded.input_schema,
  output_schema = excluded.output_schema,
  default_steps = excluded.default_steps,
  allowed_role_codes = excluded.allowed_role_codes;

insert into workflow_runs (
  id,
  workspace_id,
  template_id,
  status,
  input_payload,
  output_payload,
  created_by,
  assigned_to
) values
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000703', 'waiting_approval', '{"topic": "How alerts help before trading session"}'::jsonb, '{"draft_summary": "Explain how pre-session alerts help teams prepare without making investment promises."}'::jsonb, '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000704', 'waiting_approval', '{"request": "Improve approval queue detail"}'::jsonb, '{"task_summary": "Refine approval detail UX with risk, payload diff and audit context."}'::jsonb, '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000705', 'generated', '{"logs_summary": "lint passed, build passed, route smoke passed"}'::jsonb, '{"recommendation": "revise", "summary": "Prototype is stable, approval detail can be improved next."}'::jsonb, '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101')
on conflict (id) do update set
  template_id = excluded.template_id,
  status = excluded.status,
  input_payload = excluded.input_payload,
  output_payload = excluded.output_payload,
  created_by = excluded.created_by,
  assigned_to = excluded.assigned_to;

insert into workflow_step_runs (
  id,
  workspace_id,
  run_id,
  step_key,
  type,
  status,
  input_payload,
  output_payload
) values
  ('00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000901', 'input', 'input', 'success', '{"topic": "How alerts help before trading session"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000912', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000901', 'sources', 'retrieval', 'success', '{}'::jsonb, '{"documents": ["SEO Strategy", "Smart Algorithms Roadmap"]}'::jsonb),
  ('00000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000901', 'ai_output', 'generation', 'success', '{}'::jsonb, '{"draft": "Pre-session alerts help teams prepare context before the market opens."}'::jsonb),
  ('00000000-0000-4000-8000-000000000914', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000901', 'risk_check', 'review', 'success', '{}'::jsonb, '{"risk_level": "medium"}'::jsonb),
  ('00000000-0000-4000-8000-000000000915', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000901', 'approval', 'approval', 'waiting_approval', '{}'::jsonb, '{"approval_required": true}'::jsonb),
  ('00000000-0000-4000-8000-000000000921', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000902', 'input', 'input', 'success', '{"request": "Improve approval queue detail"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000922', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000902', 'sources', 'retrieval', 'success', '{}'::jsonb, '{"documents": ["Codex Task Template", "Smart Algorithms Roadmap"]}'::jsonb),
  ('00000000-0000-4000-8000-000000000923', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000902', 'ai_output', 'generation', 'success', '{}'::jsonb, '{"task": "Improve approval detail with evidence and risk context."}'::jsonb),
  ('00000000-0000-4000-8000-000000000924', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000902', 'risk_check', 'review', 'success', '{}'::jsonb, '{"risk_level": "high"}'::jsonb),
  ('00000000-0000-4000-8000-000000000925', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000902', 'approval', 'approval', 'waiting_approval', '{}'::jsonb, '{"approval_required": true}'::jsonb),
  ('00000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000903', 'input', 'input', 'success', '{"logs_summary": "lint passed, build passed"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000932', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000903', 'sources', 'retrieval', 'success', '{}'::jsonb, '{"documents": ["QA notes", "Roadmap"]}'::jsonb),
  ('00000000-0000-4000-8000-000000000933', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000903', 'ai_output', 'generation', 'success', '{}'::jsonb, '{"recommendation": "revise"}'::jsonb),
  ('00000000-0000-4000-8000-000000000934', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000903', 'export', 'export', 'skipped', '{}'::jsonb, '{"reason": "No backend export in DB-03."}'::jsonb)
on conflict (id) do update set
  step_key = excluded.step_key,
  type = excluded.type,
  status = excluded.status,
  input_payload = excluded.input_payload,
  output_payload = excluded.output_payload;

-- Assistant chat

insert into assistant_threads (
  id,
  workspace_id,
  assistant_code,
  title,
  status,
  created_by,
  metadata
) values (
  '00000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000001',
  'owner_analyst',
  'Weekly Owner Report prep',
  'active',
  '00000000-0000-4000-8000-000000000101',
  '{"demo": true, "source": "seed"}'::jsonb
)
on conflict (id) do update set
  assistant_code = excluded.assistant_code,
  title = excluded.title,
  status = excluded.status,
  created_by = excluded.created_by,
  metadata = excluded.metadata;

insert into assistant_messages (
  id,
  workspace_id,
  thread_id,
  role,
  content,
  parts,
  source_references,
  created_by
) values
  ('00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000801', 'user', 'Prepare a concise weekly summary for the owner dashboard.', '[]'::jsonb, '[]'::jsonb, '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000801', 'assistant', 'This week the prototype stabilized around dashboard, knowledge, workflows and approval-first controls. Recommended next step: seed data validation and DB query layer planning.', '[]'::jsonb, '[{"document_id": "00000000-0000-4000-8000-000000000501", "title": "Smart Algorithms Roadmap"}, {"document_id": "00000000-0000-4000-8000-000000000503", "title": "Support FAQ"}, {"document_id": "00000000-0000-4000-8000-000000000505", "title": "Codex Task Template"}]'::jsonb, '00000000-0000-4000-8000-000000000101')
on conflict (id) do update set
  role = excluded.role,
  content = excluded.content,
  parts = excluded.parts,
  source_references = excluded.source_references,
  created_by = excluded.created_by;

-- Approvals

insert into approval_requests (
  id,
  workspace_id,
  workflow_run_id,
  action_type,
  status,
  risk_level,
  requested_by,
  allowed_approver_role_codes,
  original_payload,
  risk_notes
) values
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000901', 'telegram_publish', 'pending', 'medium', '00000000-0000-4000-8000-000000000101', '{owner,marketing_operator}'::text[], '{"draft": "Pre-session alerts help teams prepare context before the market opens."}'::jsonb, 'No investment promises, no buy/sell signal, approval required before external publication.'),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000001', null, 'support_reply_send', 'pending', 'medium', '00000000-0000-4000-8000-000000000101', '{owner,support_operator}'::text[], '{"reply": "This answer goes beyond the current FAQ and needs human approval."}'::jsonb, 'Support reply exceeds documented FAQ coverage and needs review before sending.'),
  ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000902', 'codex_task_create', 'pending', 'high', '00000000-0000-4000-8000-000000000101', '{owner,product_manager}'::text[], '{"task": "Improve approval queue detail with risk and audit context."}'::jsonb, 'Creates implementation work for Codex. Merge remains manual outside the system.'),
  ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000001', null, 'local_runner_execute', 'pending', 'high', '00000000-0000-4000-8000-000000000101', '{owner,developer_reviewer}'::text[], '{"command": "npm run build"}'::jsonb, 'Local runner execution remains locked until explicit human approval.')
on conflict (id) do update set
  workflow_run_id = excluded.workflow_run_id,
  action_type = excluded.action_type,
  status = excluded.status,
  risk_level = excluded.risk_level,
  requested_by = excluded.requested_by,
  allowed_approver_role_codes = excluded.allowed_approver_role_codes,
  original_payload = excluded.original_payload,
  risk_notes = excluded.risk_notes;

update workflow_runs
set approval_request_id = approval_requests.id
from approval_requests
where workflow_runs.id = approval_requests.workflow_run_id
  and workflow_runs.workspace_id = '00000000-0000-4000-8000-000000000001';

-- Audit

insert into audit_events (
  id,
  workspace_id,
  actor_user_id,
  event_type,
  entity_type,
  entity_id,
  metadata
) values
  ('00000000-0000-4000-8000-000000001101', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'workspace.seeded', 'workspace', '00000000-0000-4000-8000-000000000001', '{"demo": true, "source": "seed"}'::jsonb),
  ('00000000-0000-4000-8000-000000001102', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'document.uploaded', 'knowledge_document', '00000000-0000-4000-8000-000000000501', '{"title": "Smart Algorithms Roadmap", "demo": true}'::jsonb),
  ('00000000-0000-4000-8000-000000001103', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'document.indexed', 'knowledge_document', '00000000-0000-4000-8000-000000000501', '{"indexing_status": "indexed", "demo": true}'::jsonb),
  ('00000000-0000-4000-8000-000000001104', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'workflow.run_created', 'workflow_run', '00000000-0000-4000-8000-000000000901', '{"template": "telegram-content", "demo": true}'::jsonb),
  ('00000000-0000-4000-8000-000000001105', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'workflow.output_generated', 'workflow_run', '00000000-0000-4000-8000-000000000901', '{"template": "telegram-content", "demo": true}'::jsonb),
  ('00000000-0000-4000-8000-000000001106', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'approval.requested', 'approval_request', '00000000-0000-4000-8000-000000001001', '{"action_type": "telegram_publish", "demo": true}'::jsonb),
  ('00000000-0000-4000-8000-000000001107', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'external_action.blocked', 'approval_request', '00000000-0000-4000-8000-000000001004', '{"action_type": "local_runner_execute", "reason": "approval_required", "demo": true}'::jsonb)
on conflict (id) do update set
  actor_user_id = excluded.actor_user_id,
  event_type = excluded.event_type,
  entity_type = excluded.entity_type,
  entity_id = excluded.entity_id,
  metadata = excluded.metadata;
