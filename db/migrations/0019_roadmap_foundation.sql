-- B3 checkpoint A. Legacy tasks remain manual (NULL milestone/metadata); no fabricated approvals.
begin;
create table roadmap_milestones (
  workspace_id uuid not null references workspaces(id), project_key text not null, milestone_key text not null,
  title text not null, goal text not null, status text not null, priority integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  primary key (workspace_id, project_key, milestone_key),
  foreign key (workspace_id, project_key) references projects(workspace_id, project_key),
  check (milestone_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  check (char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'),
  check (char_length(goal) between 1 and 1000 and goal !~ '[[:cntrl:]]'),
  check (status in ('planned','active','blocked','completed','cancelled')),
  check (priority between 0 and 1000000), check ((status = 'completed') = (completed_at is not null))
);
-- One short transaction guard per project. Not a scheduler, lease or lock spanning slow work.
create table roadmap_project_guards (
  workspace_id uuid not null, project_key text not null,
  primary key (workspace_id, project_key),
  foreign key (workspace_id, project_key) references projects(workspace_id, project_key)
);
alter table project_tasks
  add column milestone_key text,
  add column state_version integer not null default 0 check (state_version >= 0),
  add column roadmap_metadata jsonb,
  add column roadmap_metadata_fingerprint text,
  add constraint project_tasks_milestone_fk foreign key (workspace_id, project_key, milestone_key)
    references roadmap_milestones(workspace_id, project_key, milestone_key),
  add constraint project_tasks_roadmap_enrollment_check check (
    (milestone_key is null and roadmap_metadata is null and roadmap_metadata_fingerprint is null)
    or (milestone_key is not null and roadmap_metadata is not null and jsonb_typeof(roadmap_metadata) = 'object'
      and roadmap_metadata_fingerprint is not null and roadmap_metadata_fingerprint ~ '^[a-f0-9]{64}$')
  );
create table roadmap_task_dependencies (
  workspace_id uuid not null, project_key text not null, task_key text not null, dependency_task_key text not null,
  primary key (workspace_id, project_key, task_key, dependency_task_key), check(task_key <> dependency_task_key),
  foreign key(workspace_id, project_key, task_key) references project_tasks(workspace_id, project_key, task_key),
  foreign key(workspace_id, project_key, dependency_task_key) references project_tasks(workspace_id, project_key, task_key)
);
create table roadmap_task_events (
  workspace_id uuid not null, project_key text not null, task_key text not null,
  command_id text not null, intent_fingerprint text not null, previous_version integer not null, next_version integer not null,
  previous_status text not null, next_status text not null, event_kind text not null,
  result_task jsonb not null check(jsonb_typeof(result_task)='object'),
  actor_user_id uuid references users(id), created_at timestamptz not null default now(),
  transaction_id bigint not null default txid_current(),
  primary key(workspace_id, command_id), unique(workspace_id, task_key, next_version),
  foreign key(workspace_id, project_key, task_key) references project_tasks(workspace_id, project_key, task_key),
  check(command_id ~ '^[a-z0-9][a-z0-9._-]{0,39}$'), check(intent_fingerprint ~ '^[a-f0-9]{64}$'),
  check(next_version = previous_version + 1), check(event_kind in ('enrolled','metadata_changed','claimed','state_changed','owner_replanning'))
);
create function roadmap_immutable() returns trigger language plpgsql as $$
begin raise exception using errcode='55000', message='Roadmap evidence is immutable.'; end; $$;
create trigger roadmap_events_immutable before update or delete on roadmap_task_events for each row execute function roadmap_immutable();
-- Idempotency journal only, NOT an approval queue. Decisions remain in approval_decisions.
create table roadmap_owner_commands (
  workspace_id uuid not null references workspaces(id), command_id text not null, intent_fingerprint text not null,
  result jsonb not null, created_at timestamptz not null default now(), primary key(workspace_id,command_id),
  check(command_id ~ '^[a-z0-9][a-z0-9._-]{0,39}$'), check(intent_fingerprint ~ '^[a-f0-9]{64}$'),
  check(jsonb_typeof(result)='object' and octet_length(result::text)<8192)
);
create trigger roadmap_owner_commands_immutable before update or delete on roadmap_owner_commands for each row execute function roadmap_immutable();

-- A task transition and its factual journal are inseparable at COMMIT, including direct SQL.
create function roadmap_task_version_guard() returns trigger language plpgsql as $$
begin
  if TG_OP='INSERT' then
    if new.milestone_key is not null or new.state_version <> 0 then raise exception using errcode='23514',message='Roadmap enrollment requires versioned update.';end if;
    return new;
  end if;
  if old.milestone_key is not null or new.milestone_key is not null then
    if new.state_version <> old.state_version + 1 or new.workspace_id <> old.workspace_id or new.project_key <> old.project_key
      or new.task_key <> old.task_key or new.task_type <> old.task_type or (old.milestone_key is not null and new.milestone_key is distinct from old.milestone_key)
    then raise exception using errcode='23514',message='Invalid roadmap task revision.'; end if;
    if old.status <> new.status and not (
      (old.status='draft' and new.status in ('ready','cancelled')) or
      (old.status='ready' and new.status in ('planning','draft','blocked','cancelled')) or
      (old.status='planning' and new.status in ('approved','waiting_owner','draft','blocked','recovery_required','cancelled')) or
      (old.status='approved' and new.status in ('running','waiting_owner','blocked','recovery_required','cancelled')) or
      (old.status='running' and new.status in ('verifying','waiting_owner','blocked','recovery_required','failed','cancelled')) or
      (old.status='verifying' and new.status in ('running','waiting_owner','blocked','recovery_required','failed','cancelled')) or
      (old.status='waiting_owner' and new.status in ('draft','approved','running','blocked','recovery_required','completed','failed','cancelled')) or
      (old.status='blocked' and new.status in ('draft','cancelled')) or
      (old.status='recovery_required' and new.status in ('waiting_owner','blocked','cancelled'))
    ) then raise exception using errcode='23514',message='Invalid roadmap task transition.'; end if;
    if (new.roadmap_metadata is distinct from old.roadmap_metadata or new.priority is distinct from old.priority
      or new.risk_level is distinct from old.risk_level or new.goal is distinct from old.goal or new.title is distinct from old.title)
      and old.status not in ('draft','ready') then raise exception using errcode='23514',message='Executing roadmap intent is immutable.'; end if;
  elsif new.state_version <> old.state_version then raise exception using errcode='23514',message='Manual task has no roadmap revision.';
  end if;
  return new;
end; $$;
create trigger roadmap_task_version_guard before insert or update on project_tasks for each row execute function roadmap_task_version_guard();
create function roadmap_task_journal_guard() returns trigger language plpgsql as $$
begin
  if (old.milestone_key is not null or new.milestone_key is not null) and not exists (
    select 1 from roadmap_task_events e where e.workspace_id=new.workspace_id and e.project_key=new.project_key
      and e.task_key=new.task_key and e.previous_version=old.state_version and e.next_version=new.state_version
      and e.previous_status=old.status and e.next_status=new.status
      and e.transaction_id=txid_current() and e.result_task->>'taskId'=new.task_key and e.result_task->>'projectId'=new.project_key
      and e.result_task->>'status'=new.status and (e.result_task->>'version')::integer=new.state_version
      and e.result_task->>'metadataFingerprint'=new.roadmap_metadata_fingerprint and e.result_task->'metadata'=new.roadmap_metadata
  ) then raise exception using errcode='23514',message='Roadmap transition requires journal.'; end if;
  return null;
end; $$;
create constraint trigger roadmap_task_journal_guard after update on project_tasks deferrable initially deferred
for each row execute function roadmap_task_journal_guard();
create function roadmap_dependency_guard() returns trigger language plpgsql as $$
declare item record;
begin
  if TG_OP='DELETE' then item:=old; else item:=new; end if;
  if not exists(select 1 from project_tasks t where t.workspace_id=item.workspace_id and t.project_key=item.project_key
    and t.task_key=item.task_key and t.milestone_key is not null and t.status in ('draft','ready'))
  then raise exception using errcode='23514',message='Roadmap dependencies are immutable after claim.'; end if;
  if TG_OP='UPDATE' then raise exception using errcode='23514',message='Replace dependency edges explicitly.'; end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end; $$;
create trigger roadmap_dependency_guard before insert or update or delete on roadmap_task_dependencies
for each row execute function roadmap_dependency_guard();
create function roadmap_dependency_journal_guard() returns trigger language plpgsql as $$
declare item record;
begin
  if TG_OP='DELETE' then item:=old; else item:=new; end if;
  if not exists(select 1 from project_tasks t join roadmap_task_events e on e.workspace_id=t.workspace_id
      and e.project_key=t.project_key and e.task_key=t.task_key and e.next_version=t.state_version
    where t.workspace_id=item.workspace_id and t.project_key=item.project_key and t.task_key=item.task_key
      and e.transaction_id=txid_current() and e.event_kind in ('enrolled','metadata_changed'))
  then raise exception using errcode='23514',message='Dependency changes require versioned roadmap evidence.';end if;
  return null;
end; $$;
create constraint trigger roadmap_dependency_journal_guard after insert or update or delete on roadmap_task_dependencies
deferrable initially deferred for each row execute function roadmap_dependency_journal_guard();

-- Typed bindings into the ONE existing Approval queue. No parallel approval lifecycle/status table.
create table roadmap_approval_bindings (
  workspace_id uuid not null, project_key text not null, task_key text not null,
  approval_request_id uuid not null, purpose text not null, expected_task_version integer not null,
  plan_key text not null, plan_revision integer not null, draft_fingerprint text not null, execution_fingerprint text not null,
  allowed_paths text[] not null, risk_level text not null, binding_fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id, approval_request_id),
  unique(workspace_id, task_key, purpose, expected_task_version, binding_fingerprint),
  foreign key(workspace_id, approval_request_id) references approval_requests(workspace_id,id),
  foreign key(workspace_id, project_key, task_key) references project_tasks(workspace_id,project_key,task_key),
  foreign key(workspace_id, task_key, plan_key, plan_revision) references project_task_feature_plans(workspace_id,task_key,plan_key,revision),
  check(purpose in ('feature_plan_approval','scope_change','budget_or_risk_increase','architecture_change','result_acceptance')),
  check(expected_task_version >= 0 and plan_revision >= 1),
  check(draft_fingerprint ~ '^[a-f0-9]{64}$' and execution_fingerprint ~ '^[a-f0-9]{64}$' and binding_fingerprint ~ '^[a-f0-9]{64}$'),
  check(cardinality(allowed_paths) between 1 and 4096), check(risk_level in ('low','medium','high','critical'))
);
create trigger roadmap_approvals_immutable before update or delete on roadmap_approval_bindings for each row execute function roadmap_immutable();
-- Narrow integrity for B3's typed usage of the existing queue/decisions, not another lifecycle.
create function roadmap_approval_integrity() returns trigger language plpgsql as $$
declare request_id uuid; r record; b record; d record;
begin
  if TG_TABLE_NAME='approval_requests' then request_id:=new.id; else request_id:=new.approval_request_id;end if;
  select * into r from approval_requests where id=request_id;
  if r.action_type <> 'development_feature_plan_approval' then return null;end if;
  select * into b from roadmap_approval_bindings where workspace_id=r.workspace_id and approval_request_id=r.id;
  if not found or b.purpose <> 'feature_plan_approval' or r.risk_level<>b.risk_level
    or r.original_payload->>'bindingFingerprint' is distinct from b.binding_fingerprint
    or r.original_payload->>'projectId' is distinct from b.project_key or r.original_payload->>'taskId' is distinct from b.task_key
  then raise exception using errcode='23514',message='Development approval binding mismatch.';end if;
  select * into d from approval_decisions where workspace_id=r.workspace_id and approval_request_id=r.id;
  if r.status='pending' then
    if found or r.approved_by is not null or r.rejected_by is not null or r.resolved_at is not null
    then raise exception using errcode='23514',message='Invalid pending development approval.';end if;
  elsif r.status in ('approved','rejected') then
    if not found or d.decision<>r.status or r.resolved_at is null
      or (r.status='approved' and (r.approved_by is null or r.rejected_by is not null or d.decided_by_actor_id<>r.approved_by::text))
      or (r.status='rejected' and (r.rejected_by is null or r.approved_by is not null or d.decided_by_actor_id<>r.rejected_by::text))
      or not exists(select 1 from audit_events a where a.workspace_id=r.workspace_id and a.entity_id=r.id
        and a.event_type='roadmap.approval_decided' and a.actor_user_id::text=d.decided_by_actor_id and a.metadata->>'decision'=d.decision)
    then raise exception using errcode='23514',message='Development approval decision mismatch.';end if;
  else raise exception using errcode='23514',message='Invalid development approval state.';
  end if;
  return null;
end; $$;
create constraint trigger roadmap_approval_request_integrity after insert or update on approval_requests
deferrable initially deferred for each row execute function roadmap_approval_integrity();
create constraint trigger roadmap_approval_binding_integrity after insert on roadmap_approval_bindings
deferrable initially deferred for each row execute function roadmap_approval_integrity();
create constraint trigger roadmap_approval_decision_integrity after insert on approval_decisions
deferrable initially deferred for each row execute function roadmap_approval_integrity();
create function roadmap_bound_approval_immutable() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME='approval_decisions' then
    if exists(select 1 from roadmap_approval_bindings where approval_request_id=old.approval_request_id)
    then raise exception using errcode='55000',message='Development approval decision is immutable.';end if;
  elsif old.action_type='development_feature_plan_approval' then
    if TG_OP='DELETE' or old.status<>'pending' or new.workspace_id<>old.workspace_id or new.id<>old.id
      or new.action_type<>old.action_type or new.risk_level<>old.risk_level or new.original_payload<>old.original_payload
      or new.requested_by is distinct from old.requested_by or new.allowed_approver_role_codes<>old.allowed_approver_role_codes
      or new.edited_payload is not null or new.final_payload is not null
    then raise exception using errcode='55000',message='Development approval identity is immutable.';end if;
  end if;
  if TG_OP='DELETE' then return old;else return new;end if;
end; $$;
create trigger roadmap_bound_request_immutable before update or delete on approval_requests for each row execute function roadmap_bound_approval_immutable();
create trigger roadmap_bound_decision_immutable before update or delete on approval_decisions for each row execute function roadmap_bound_approval_immutable();
create index roadmap_ready_tasks on project_tasks(workspace_id,project_key,status,priority,task_key) where milestone_key is not null;
commit;
