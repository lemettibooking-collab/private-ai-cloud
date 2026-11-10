-- Project-level backlog proposals; existing FeaturePlans remain task-scoped and unchanged.
-- Only explicit Owner approval materializes ordinary draft ProjectTasks. No queue enrollment.
create table project_planning_drafts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_key text not null,
  revision integer not null check(revision between 1 and 20),
  source_document_id uuid not null, source_filename text not null,
  source_version integer not null, source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{64}$'),
  plan_json jsonb not null check(jsonb_typeof(plan_json)='object' and octet_length(plan_json::text)<=524288),
  plan_fingerprint text not null check(plan_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft' check(status in ('draft','approved','rejected')),
  approval_request_id uuid not null, created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,project_key) references projects(workspace_id,project_key),
  foreign key(workspace_id,source_document_id,source_version) references knowledge_document_versions(workspace_id,document_id,version),
  foreign key(workspace_id,approval_request_id) references approval_requests(workspace_id,id),
  foreign key(workspace_id,created_by) references workspace_members(workspace_id,user_id),
  unique(workspace_id,project_key,revision), unique(workspace_id,project_key,source_fingerprint),
  unique(approval_request_id), unique(workspace_id,project_key,id)
);
create unique index project_planning_single_active on project_planning_drafts(workspace_id,project_key) where status='approved';
create table project_planning_task_links (
  workspace_id uuid not null, project_key text not null, draft_id uuid not null,
  source_task_id text not null check(source_task_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'), task_key text not null,
  primary key(workspace_id,project_key,draft_id,source_task_id), unique(workspace_id,task_key),
  foreign key(workspace_id,project_key,draft_id) references project_planning_drafts(workspace_id,project_key,id),
  foreign key(workspace_id,project_key,task_key) references project_tasks(workspace_id,project_key,task_key)
);
create trigger project_planning_links_immutable before update or delete on project_planning_task_links
  for each row execute function roadmap_immutable();
create function guard_project_planning_draft() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception using errcode='23514',message='Immutable planning draft'; end if;
  if TG_OP='UPDATE' then
    if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') or old.status<>'draft' or new.status not in ('approved','rejected') then
      raise exception using errcode='23514',message='Immutable planning draft';
    end if;
  elsif new.status<>'draft' or not exists (
    select 1 from knowledge_documents d join knowledge_document_versions v on v.workspace_id=d.workspace_id and v.document_id=d.id
    where d.workspace_id=new.workspace_id and d.project_key=new.project_key and d.id=new.source_document_id
      and d.filename=new.source_filename and v.version=new.source_version and v.sha256=new.source_sha256
  ) then raise exception using errcode='23514',message='Invalid planning source'; end if;
  return new;
end; $$;
create trigger project_planning_draft_guard before insert or update or delete on project_planning_drafts
  for each row execute function guard_project_planning_draft();
-- Keep ordinary approval_requests / approval_decisions as the only Owner decision evidence.
-- Deferred checks allow pending request + immutable draft, or decision + links, to commit atomically.
create function project_planning_approval_integrity() returns trigger language plpgsql as $$
declare request_id uuid; p project_planning_drafts%rowtype; a approval_requests%rowtype; d approval_decisions%rowtype; links integer; item jsonb; task_hash text;
begin
  if TG_TABLE_NAME='project_planning_drafts' then request_id:=new.approval_request_id;
  elsif TG_TABLE_NAME='project_planning_task_links' then
    select approval_request_id into request_id from project_planning_drafts
      where workspace_id=new.workspace_id and project_key=new.project_key and id=new.draft_id;
    if not found then raise exception using errcode='23514',message='Invalid planning link binding'; end if;
  elsif TG_TABLE_NAME='approval_requests' then request_id:=new.id;
  else request_id:=new.approval_request_id; end if;
  select * into a from approval_requests where id=request_id;
  if TG_TABLE_NAME='project_planning_task_links' and (not found or a.action_type is distinct from 'project_plan_activation') then
    raise exception using errcode='23514',message='Invalid planning link approval'; end if;
  if not found or a.action_type<>'project_plan_activation' then return null; end if;
  select * into p from project_planning_drafts where approval_request_id=request_id;
  if not found or a.workspace_id<>p.workspace_id or a.workflow_run_id is not null
    or a.original_payload<>jsonb_build_object('projectId',p.project_key,'revision',p.revision,'planFingerprint',p.plan_fingerprint,'sourceFingerprint',p.source_fingerprint)
    or a.allowed_approver_role_codes<>array['owner']::text[] or a.requested_by<>p.created_by then
    raise exception using errcode='23514',message='Invalid planning approval binding'; end if;
  select * into d from approval_decisions where approval_request_id=request_id and workspace_id=p.workspace_id;
  select count(*) into links from project_planning_task_links where workspace_id=p.workspace_id and draft_id=p.id;
  if (p.status='draft' and (a.status<>'pending' or d.id is not null or links<>0
      or a.approved_by is not null or a.rejected_by is not null or a.resolved_at is not null))
    or (p.status<>'draft' and (a.status<>p.status or d.id is null or d.decision<>p.status or a.resolved_at is null))
    or (p.status='approved' and (a.approved_by is null or d.decided_by_actor_id<>a.approved_by::text or a.rejected_by is not null))
    or (p.status='rejected' and (a.rejected_by is null or d.decided_by_actor_id<>a.rejected_by::text or a.approved_by is not null))
    or (p.status='approved' and links<>jsonb_array_length(p.plan_json->'tasks'))
    or (p.status='rejected' and links<>0) then
    raise exception using errcode='23514',message='Invalid planning decision'; end if;
  if p.status='approved' then
    if jsonb_typeof(p.plan_json->'tasks') is distinct from 'array'
      or jsonb_array_length(p.plan_json->'tasks') not between 1 and 128 then
      raise exception using errcode='23514',message='Invalid planning task links'; end if;
    for item in select value from jsonb_array_elements(p.plan_json->'tasks') loop
      if jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        or item->>'id' ~ '[[:space:][:cntrl:]]' then
        raise exception using errcode='23514',message='Invalid planning task identity'; end if;
      -- Both IDs are closed ASCII tokens: this tuple is exactly the existing JS JSON encoding.
      task_hash:=encode(sha256(convert_to(format('["%s","%s"]',p.project_key,item->>'id'),'UTF8')),'hex');
      if not exists (
        select 1 from project_planning_task_links l join project_tasks t
          on t.workspace_id=l.workspace_id and t.project_key=l.project_key and t.task_key=l.task_key
        where l.workspace_id=p.workspace_id and l.project_key=p.project_key and l.draft_id=p.id
          and l.source_task_id=item->>'id' and l.task_key='import-'||substr(task_hash,1,40)
          and t.creation_idempotency_key='planning:'||task_hash and t.creation_intent_fingerprint is not null
          and t.created_by::text=d.decided_by_actor_id and t.status='draft' and t.milestone_key is null
          and t.title is not distinct from item->>'title' and t.goal is not distinct from item->>'goal'
          and t.task_type is not distinct from item->>'type' and t.priority is not distinct from item->>'priority'
      ) then raise exception using errcode='23514',message='Invalid planning task links'; end if;
    end loop;
  end if;
  return null;
end; $$;
create constraint trigger project_planning_draft_integrity after insert or update on project_planning_drafts
  deferrable initially deferred for each row execute function project_planning_approval_integrity();
create constraint trigger project_planning_request_integrity after insert or update on approval_requests
  deferrable initially deferred for each row execute function project_planning_approval_integrity();
create constraint trigger project_planning_decision_integrity after insert on approval_decisions
  deferrable initially deferred for each row execute function project_planning_approval_integrity();
create constraint trigger project_planning_link_integrity after insert on project_planning_task_links
  deferrable initially deferred for each row execute function project_planning_approval_integrity();
create unique index audit_events_project_plan_unique on audit_events(workspace_id,event_type,entity_id)
  where event_type in ('project.plan_draft_saved','project.plan_approved','project.plan_rejected');
create function project_planning_bound_approval_guard() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME='approval_requests' then
    if exists(select 1 from project_planning_drafts where approval_request_id=old.id) then
      if TG_OP='DELETE' then raise exception using errcode='23514',message='Immutable planning approval'; end if;
      if old.status<>'pending' or (to_jsonb(new)-array['status','resolved_at','approved_by','rejected_by','updated_at']) is distinct from
        (to_jsonb(old)-array['status','resolved_at','approved_by','rejected_by','updated_at']) then
        raise exception using errcode='23514',message='Immutable planning approval'; end if;
    end if;
  elsif exists(select 1 from project_planning_drafts where approval_request_id=old.approval_request_id) then
    raise exception using errcode='23514',message='Immutable planning decision';
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end; $$;
create trigger project_planning_request_guard before update or delete on approval_requests
  for each row execute function project_planning_bound_approval_guard();
create trigger project_planning_decision_guard before update or delete on approval_decisions
  for each row execute function project_planning_bound_approval_guard();
create function project_planning_link_guard() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from project_planning_drafts where workspace_id=new.workspace_id and project_key=new.project_key and id=new.draft_id and status='draft') then
    raise exception using errcode='23514',message='Planning links require pending decision'; end if;
  return new;
end; $$;
create trigger project_planning_link_guard before insert on project_planning_task_links
  for each row execute function project_planning_link_guard();
