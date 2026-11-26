-- Private AI Cloud
-- Migration: 0007_workspace_tenant_integrity
-- Purpose: Authoritative domain-to-database Workspace mapping, same-tenant relational
-- integrity, membership-aware user attribution, and runtime audit-to-Run coupling.

begin;

alter table workspaces
  add column domain_workspace_id text;

-- The only pre-0007 repository seed has this exact durable identity. No other
-- workspace is guessed from name, case folding, ordering, or a fuzzy match.
update workspaces
set domain_workspace_id = 'smart-algorithms-demo'
where id = '00000000-0000-4000-8000-000000000001'
  and slug = 'smart-algorithms-demo'
  and domain_workspace_id is null;

do $$
begin
  if exists (select 1 from workspaces where domain_workspace_id is null) then
    raise exception using
      errcode = '23514',
      constraint = 'workspaces_domain_workspace_id_required',
      message = 'Existing Workspace has no factual domain Workspace mapping.';
  end if;
end;
$$;

alter table workspaces
  alter column domain_workspace_id set not null,
  add constraint workspaces_domain_workspace_id_check check (
    domain_workspace_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  add constraint workspaces_domain_workspace_id_unique unique (domain_workspace_id);

alter table knowledge_collections
  add constraint knowledge_collections_workspace_id_id_unique unique (workspace_id, id);
alter table knowledge_documents
  add constraint knowledge_documents_workspace_id_id_unique unique (workspace_id, id);
alter table assistant_threads
  add constraint assistant_threads_workspace_id_id_unique unique (workspace_id, id);
alter table workflow_runtime_claims
  add constraint workflow_runtime_claims_workspace_run_id_unique unique (workspace_id, run_id, id);
alter table workflow_runs
  add constraint workflow_runs_workspace_runtime_id_unique unique (workspace_id, runtime_id);
alter table approval_requests
  add constraint approval_requests_workspace_run_id_unique
    unique (workspace_id, workflow_run_id, id);
alter table workflow_model_invocations
  add constraint workflow_model_invocations_workspace_run_id_unique
    unique (workspace_id, workflow_run_id, id);

do $$
begin
  if exists (
    select 1 from knowledge_documents as child
    join knowledge_collections as parent on parent.id = child.collection_id
    where child.collection_id is not null and child.workspace_id <> parent.workspace_id
  ) then raise exception using errcode = '23514', constraint = 'knowledge_documents_collection_workspace_fk',
    message = 'Cross-workspace Knowledge document-to-collection relationship exists.';
  end if;
  if exists (
    select 1 from document_chunks as child
    join knowledge_documents as parent on parent.id = child.document_id
    where child.workspace_id <> parent.workspace_id
  ) then raise exception using errcode = '23514', constraint = 'document_chunks_document_workspace_fk',
    message = 'Cross-workspace document chunk-to-document relationship exists.';
  end if;
  if exists (
    select 1 from assistant_messages as child
    join assistant_threads as parent on parent.id = child.thread_id
    where child.workspace_id <> parent.workspace_id
  ) then raise exception using errcode = '23514', constraint = 'assistant_messages_thread_workspace_fk',
    message = 'Cross-workspace assistant message-to-thread relationship exists.';
  end if;
  if exists (
    select 1 from workflow_step_runs as child
    join workflow_runs as parent on parent.id = child.run_id
    where child.workspace_id <> parent.workspace_id
  ) then raise exception using errcode = '23514', constraint = 'workflow_step_runs_run_workspace_fk',
    message = 'Cross-workspace Workflow Step-to-Run relationship exists.';
  end if;
  if exists (
    select 1 from workflow_runtime_commands as child
    join workflow_runs as parent on parent.id = child.run_id
    where child.workspace_id <> parent.workspace_id
  ) then raise exception using errcode = '23514', constraint = 'workflow_runtime_commands_run_workspace_fk',
    message = 'Cross-workspace runtime command-to-Run relationship exists.';
  end if;
  if exists (
    select 1 from workflow_runtime_claims as child
    join workflow_runs as parent on parent.id = child.run_id
    where child.workspace_id <> parent.workspace_id
  ) then raise exception using errcode = '23514', constraint = 'workflow_runtime_claims_run_workspace_fk',
    message = 'Cross-workspace runtime claim-to-Run relationship exists.';
  end if;
  if exists (
    select 1 from workflow_runtime_executions as child
    join workflow_runs as run on run.id = child.run_id
    join workflow_runtime_claims as claim on claim.id = child.claim_id
    where child.workspace_id <> run.workspace_id
      or child.workspace_id <> claim.workspace_id
      or child.run_id <> claim.run_id
  ) then raise exception using errcode = '23514', constraint = 'workflow_runtime_executions_claim_workspace_fk',
    message = 'Cross-workspace runtime execution relationship exists.';
  end if;
  if exists (
    select 1 from approval_requests as child
    join workflow_runs as parent on parent.id = child.workflow_run_id
    where child.workflow_run_id is not null and child.workspace_id <> parent.workspace_id
  ) then raise exception using errcode = '23514', constraint = 'approval_requests_run_workspace_fk',
    message = 'Cross-workspace approval-to-Run relationship exists.';
  end if;
  if exists (
    select 1 from workflow_model_budget_reservations as child
    join workflow_model_invocations as parent on parent.id = child.model_invocation_id
    where child.workspace_id <> parent.workspace_id
      or child.workflow_run_id <> parent.workflow_run_id
  ) then raise exception using errcode = '23514', constraint = 'workflow_model_budget_reservations_invocation_workspace_fk',
    message = 'Cross-workspace model budget-to-invocation relationship exists.';
  end if;
  if exists (
    select 1 from audit_events
    where runtime_run_id is not null and workspace_id is null
  ) then raise exception using errcode = '23514', constraint = 'audit_events_runtime_workspace_required',
    message = 'Runtime audit event must belong to a Workspace.';
  end if;
  if exists (
    select 1 from audit_events as child
    left join workflow_runs as parent
      on parent.workspace_id = child.workspace_id and parent.runtime_id = child.runtime_run_id
    where child.runtime_run_id is not null and parent.id is null
  ) then raise exception using errcode = '23514', constraint = 'audit_events_runtime_run_workspace_fk',
    message = 'Runtime audit event has no same-workspace Workflow Run.';
  end if;
  if exists (
    select 1 from workflow_runs as run
    left join approval_requests as approval
      on approval.workspace_id = run.workspace_id
     and approval.workflow_run_id = run.id
     and approval.id = run.approval_request_id
    where run.approval_request_id is not null and approval.id is null
  ) then raise exception using errcode = '23514', constraint = 'workflow_runs_approval_request_workspace_fk',
    message = 'Legacy Workflow Run approval pointer is not same-workspace and same-Run.';
  end if;
end;
$$;

alter table knowledge_documents
  drop constraint knowledge_documents_collection_id_fkey,
  add constraint knowledge_documents_collection_workspace_fk
    foreign key (workspace_id, collection_id)
    references knowledge_collections (workspace_id, id)
    on delete set null (collection_id);

alter table document_chunks
  drop constraint document_chunks_document_id_fkey,
  add constraint document_chunks_document_workspace_fk
    foreign key (workspace_id, document_id)
    references knowledge_documents (workspace_id, id) on delete cascade;

alter table assistant_messages
  drop constraint assistant_messages_thread_id_fkey,
  add constraint assistant_messages_thread_workspace_fk
    foreign key (workspace_id, thread_id)
    references assistant_threads (workspace_id, id) on delete cascade;

alter table workflow_step_runs
  drop constraint workflow_step_runs_run_id_fkey,
  add constraint workflow_step_runs_run_workspace_fk
    foreign key (workspace_id, run_id)
    references workflow_runs (workspace_id, id) on delete cascade;

alter table workflow_runtime_commands
  drop constraint workflow_runtime_commands_run_id_fkey,
  add constraint workflow_runtime_commands_run_workspace_fk
    foreign key (workspace_id, run_id)
    references workflow_runs (workspace_id, id) on delete cascade;

alter table workflow_runtime_claims
  drop constraint workflow_runtime_claims_run_id_fkey,
  add constraint workflow_runtime_claims_run_workspace_fk
    foreign key (workspace_id, run_id)
    references workflow_runs (workspace_id, id) on delete cascade;

alter table workflow_runtime_executions
  drop constraint workflow_runtime_executions_run_id_fkey,
  drop constraint workflow_runtime_executions_claim_id_fkey,
  add constraint workflow_runtime_executions_run_workspace_fk
    foreign key (workspace_id, run_id)
    references workflow_runs (workspace_id, id) on delete cascade,
  add constraint workflow_runtime_executions_claim_workspace_fk
    foreign key (workspace_id, run_id, claim_id)
    references workflow_runtime_claims (workspace_id, run_id, id) on delete restrict;

alter table approval_requests
  drop constraint approval_requests_workflow_run_id_fkey,
  add constraint approval_requests_run_workspace_fk
    foreign key (workspace_id, workflow_run_id)
    references workflow_runs (workspace_id, id)
    on delete set null (workflow_run_id);

alter table workflow_model_budget_reservations
  drop constraint workflow_model_budget_reservations_model_invocation_id_fkey,
  add constraint workflow_model_budget_reservations_invocation_workspace_fk
    foreign key (workspace_id, workflow_run_id, model_invocation_id)
    references workflow_model_invocations (workspace_id, workflow_run_id, id)
    on delete restrict;

alter table audit_events
  add constraint audit_events_runtime_workspace_required check (
    runtime_run_id is null or workspace_id is not null
  ),
  add constraint audit_events_runtime_run_workspace_fk
    foreign key (workspace_id, runtime_run_id)
    references workflow_runs (workspace_id, runtime_id) on delete restrict;

alter table workflow_runs
  add constraint workflow_runs_approval_request_workspace_fk
    foreign key (workspace_id, id, approval_request_id)
    references approval_requests (workspace_id, workflow_run_id, id)
    on delete set null (approval_request_id);

do $$
begin
  if exists (
    select 1 from member_role_assignments as assignment
    join workspace_members as member on member.id = assignment.member_id
    join roles as role on role.id = assignment.role_id
    where (role.workspace_id is not null and role.workspace_id <> member.workspace_id)
       or (role.workspace_id is null and not role.is_system)
  ) then raise exception using errcode = '23514', constraint = 'member_role_assignments_workspace_check',
    message = 'Invalid cross-workspace or non-system global role assignment exists.';
  end if;
  if exists (
    select 1 from roles where workspace_id is null and not is_system
  ) then raise exception using errcode = '23514', constraint = 'roles_global_system_check',
    message = 'Global roles must be explicit system roles.';
  end if;
end;
$$;

alter table roles
  add constraint roles_global_system_check check (workspace_id is not null or is_system);

create or replace function enforce_member_role_workspace_integrity()
returns trigger as $$
declare
  member_workspace_id uuid;
  role_workspace_id uuid;
  role_is_system boolean;
begin
  select workspace_id into strict member_workspace_id
  from workspace_members where id = new.member_id
  for update;
  select workspace_id, is_system into strict role_workspace_id, role_is_system
  from roles where id = new.role_id
  for update;
  if role_workspace_id is not null and role_workspace_id <> member_workspace_id then
    raise exception using errcode = '23514', constraint = 'member_role_assignments_workspace_check',
      message = 'Workspace member cannot receive a foreign Workspace role.';
  end if;
  if role_workspace_id is null and not role_is_system then
    raise exception using errcode = '23514', constraint = 'member_role_assignments_workspace_check',
      message = 'Only a global system role may be assigned across Workspaces.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger member_role_assignments_workspace_trigger
before insert or update of member_id, role_id on member_role_assignments
for each row execute function enforce_member_role_workspace_integrity();

create or replace function enforce_role_assignments_after_role_change()
returns trigger as $$
begin
  if exists (
    select 1 from member_role_assignments as assignment
    join workspace_members as member on member.id = assignment.member_id
    where assignment.role_id = new.id
      and ((new.workspace_id is not null and new.workspace_id <> member.workspace_id)
        or (new.workspace_id is null and not new.is_system))
  ) then
    raise exception using errcode = '23514', constraint = 'member_role_assignments_workspace_check',
      message = 'Role update would invalidate a Workspace role assignment.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger roles_assignments_workspace_update_trigger
before update of workspace_id, is_system on roles
for each row execute function enforce_role_assignments_after_role_change();

create or replace function enforce_role_assignments_after_member_change()
returns trigger as $$
begin
  if exists (
    select 1 from member_role_assignments as assignment
    join roles as role on role.id = assignment.role_id
    where assignment.member_id = new.id
      and ((role.workspace_id is not null and role.workspace_id <> new.workspace_id)
        or (role.workspace_id is null and not role.is_system))
  ) then
    raise exception using errcode = '23514', constraint = 'member_role_assignments_workspace_check',
      message = 'Workspace member update would invalidate a role assignment.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger workspace_members_assignments_workspace_update_trigger
before update of workspace_id on workspace_members
for each row execute function enforce_role_assignments_after_member_change();

do $$
begin
  if exists (
    select 1 from knowledge_collections as resource
    left join workspace_members as member
      on member.workspace_id = resource.workspace_id and member.user_id = resource.created_by
    where resource.created_by is not null and member.id is null
  ) then raise exception using errcode = '23514', constraint = 'knowledge_collections_created_by_member_fk',
    message = 'Knowledge collection creator is not a same-workspace member.';
  end if;
  if exists (
    select 1 from knowledge_documents as resource
    left join workspace_members as member
      on member.workspace_id = resource.workspace_id and member.user_id = resource.uploaded_by
    where resource.uploaded_by is not null and member.id is null
  ) then raise exception using errcode = '23514', constraint = 'knowledge_documents_uploaded_by_member_fk',
    message = 'Knowledge document uploader is not a same-workspace member.';
  end if;
  if exists (
    select 1 from assistant_threads as resource
    left join workspace_members as member
      on member.workspace_id = resource.workspace_id and member.user_id = resource.created_by
    where resource.created_by is not null and member.id is null
  ) then raise exception using errcode = '23514', constraint = 'assistant_threads_created_by_member_fk',
    message = 'Assistant thread creator is not a same-workspace member.';
  end if;
  if exists (
    select 1 from assistant_messages as resource
    left join workspace_members as member
      on member.workspace_id = resource.workspace_id and member.user_id = resource.created_by
    where resource.created_by is not null and member.id is null
  ) then raise exception using errcode = '23514', constraint = 'assistant_messages_created_by_member_fk',
    message = 'Assistant message creator is not a same-workspace member.';
  end if;
  if exists (
    select 1 from workflow_runs as resource
    left join workspace_members as creator
      on creator.workspace_id = resource.workspace_id and creator.user_id = resource.created_by
    left join workspace_members as assignee
      on assignee.workspace_id = resource.workspace_id and assignee.user_id = resource.assigned_to
    where (resource.created_by is not null and creator.id is null)
       or (resource.assigned_to is not null and assignee.id is null)
  ) then raise exception using errcode = '23514', constraint = 'workflow_runs_created_by_member_fk',
    message = 'Workflow Run user attribution is not same-workspace.';
  end if;
  if exists (
    select 1 from approval_requests as resource
    left join workspace_members as requester
      on requester.workspace_id = resource.workspace_id and requester.user_id = resource.requested_by
    left join workspace_members as approver
      on approver.workspace_id = resource.workspace_id and approver.user_id = resource.approved_by
    left join workspace_members as rejecter
      on rejecter.workspace_id = resource.workspace_id and rejecter.user_id = resource.rejected_by
    where (resource.requested_by is not null and requester.id is null)
       or (resource.approved_by is not null and approver.id is null)
       or (resource.rejected_by is not null and rejecter.id is null)
  ) then raise exception using errcode = '23514', constraint = 'approval_requests_requested_by_member_fk',
    message = 'Approval user attribution is not same-workspace.';
  end if;
  if exists (
    select 1 from audit_events as resource
    left join workspace_members as actor
      on actor.workspace_id = resource.workspace_id and actor.user_id = resource.actor_user_id
    where resource.workspace_id is not null
      and resource.actor_user_id is not null
      and actor.id is null
  ) then raise exception using errcode = '23514', constraint = 'audit_events_actor_user_member_fk',
    message = 'Audit actor user is not a same-workspace member.';
  end if;
end;
$$;

-- created_by/uploaded_by fields below are historical provenance. Membership
-- lifecycle uses status=disabled; deleting a referenced membership is rejected.
alter table knowledge_collections
  add constraint knowledge_collections_created_by_member_fk
    foreign key (workspace_id, created_by)
    references workspace_members (workspace_id, user_id)
    on delete restrict;
alter table knowledge_documents
  add constraint knowledge_documents_uploaded_by_member_fk
    foreign key (workspace_id, uploaded_by)
    references workspace_members (workspace_id, user_id)
    on delete restrict;
alter table assistant_threads
  add constraint assistant_threads_created_by_member_fk
    foreign key (workspace_id, created_by)
    references workspace_members (workspace_id, user_id)
    on delete restrict;
alter table assistant_messages
  add constraint assistant_messages_created_by_member_fk
    foreign key (workspace_id, created_by)
    references workspace_members (workspace_id, user_id)
    on delete restrict;
alter table workflow_runs
  add constraint workflow_runs_created_by_member_fk
    foreign key (workspace_id, created_by)
    references workspace_members (workspace_id, user_id)
    on delete restrict,
  -- assigned_to is a current assignment, not immutable historical provenance.
  add constraint workflow_runs_assigned_to_member_fk
    foreign key (workspace_id, assigned_to)
    references workspace_members (workspace_id, user_id)
    on delete set null (assigned_to);
-- Approval actors and audit actor_user_id are immutable historical provenance.
alter table approval_requests
  add constraint approval_requests_requested_by_member_fk
    foreign key (workspace_id, requested_by)
    references workspace_members (workspace_id, user_id)
    on delete restrict,
  add constraint approval_requests_approved_by_member_fk
    foreign key (workspace_id, approved_by)
    references workspace_members (workspace_id, user_id)
    on delete restrict,
  add constraint approval_requests_rejected_by_member_fk
    foreign key (workspace_id, rejected_by)
    references workspace_members (workspace_id, user_id)
    on delete restrict;
alter table audit_events
  add constraint audit_events_actor_user_member_fk
    foreign key (workspace_id, actor_user_id)
    references workspace_members (workspace_id, user_id)
    on delete restrict;

commit;
