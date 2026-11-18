-- Generated plans reuse the ordinary immutable planning/approval lifecycle.
alter table project_planning_drafts
 add column origin text not null default 'manual_import',
 add column generation_id uuid,
 add column generation_request_fingerprint text,
 add column generation_output_fingerprint text,
 add column generation_manifest jsonb,
 add column validation_version text,
 add column save_expected_revision integer,
 alter column source_document_id drop not null,
 alter column source_filename drop not null,
 alter column source_version drop not null,
 alter column source_sha256 drop not null,
 add constraint planning_generated_generation_fk foreign key(workspace_id,project_key,generation_id)
 references project_planning_generations(workspace_id,project_key,id),
 add constraint planning_origin_fields check (
  (origin='manual_import' and source_document_id is not null and source_filename is not null and source_version is not null and source_sha256 is not null
   and generation_id is null and generation_request_fingerprint is null and generation_output_fingerprint is null and generation_manifest is null and validation_version is null and save_expected_revision is null)
  or (origin='ai_generated' and source_document_id is null and source_filename is null and source_version is null and source_sha256 is null
   and generation_id is not null and generation_request_fingerprint is not null and generation_output_fingerprint is not null and validation_version is not null and save_expected_revision is not null and generation_request_fingerprint ~ '^[a-f0-9]{64}$'
   and generation_output_fingerprint ~ '^sha256:[a-f0-9]{64}$' and generation_manifest is not null
   and jsonb_typeof(generation_manifest)='array' and jsonb_array_length(generation_manifest) between 1 and 4
   and validation_version='pac-project-plan/v1' and save_expected_revision between 0 and 19));
create unique index planning_generated_once on project_planning_drafts(workspace_id,project_key,generation_id) where origin='ai_generated';
create or replace function guard_project_planning_draft() returns trigger language plpgsql as $$
declare g project_planning_generations%rowtype; manifest jsonb; canonical_manifest text;
begin
 if TG_OP='DELETE' then raise exception using errcode='23514',message='Immutable planning draft'; end if;
 if TG_OP='UPDATE' then
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') or old.status<>'draft' or new.status not in ('approved','rejected') then
   raise exception using errcode='23514',message='Immutable planning draft'; end if;
 elsif new.status<>'draft' then raise exception using errcode='23514',message='Planning must start pending'; end if;
 if new.origin='manual_import' then
  if not exists(select 1 from knowledge_documents d join knowledge_document_versions v on v.workspace_id=d.workspace_id and v.document_id=d.id
    where d.workspace_id=new.workspace_id and d.project_key=new.project_key and d.id=new.source_document_id and d.filename=new.source_filename and v.version=new.source_version and v.sha256=new.source_sha256)
   then raise exception using errcode='23514',message='Invalid planning source'; end if;
 elsif new.origin='ai_generated' then
  select * into g from project_planning_generations where workspace_id=new.workspace_id and project_key=new.project_key and id=new.generation_id;
  if not found or g.status<>'proposal_available' or g.requested_by<>new.created_by
   or g.request_fingerprint is distinct from new.generation_request_fingerprint or g.output_fingerprint is distinct from new.generation_output_fingerprint
   or g.plan_fingerprint is distinct from new.plan_fingerprint or g.manifest_json is distinct from new.generation_manifest
   or g.validation_version is distinct from new.validation_version then raise exception using errcode='23514',message='Invalid generated provenance'; end if;
  select jsonb_agg(jsonb_build_object('filename',filename,'version',version,'sha256',sha256) order by source_index) into manifest
   from project_planning_generation_sources where workspace_id=g.workspace_id and project_key=g.project_key and generation_id=g.id;
  select '['||string_agg('{"filename":'||to_json(filename)::text||',"version":'||version::text||',"sha256":'||to_json(sha256)::text||'}',',' order by source_index)||']' into canonical_manifest
   from project_planning_generation_sources where workspace_id=g.workspace_id and project_key=g.project_key and generation_id=g.id;
  if new.source_fingerprint is distinct from encode(sha256(convert_to(format('["pac.generated-draft.v1","%s","%s","%s",%s,"%s"]',g.request_fingerprint,g.output_fingerprint,g.plan_fingerprint,canonical_manifest,g.validation_version),'UTF8')),'hex')
   or new.revision<>new.save_expected_revision+1 then raise exception using errcode='23514',message='Invalid generated fingerprint'; end if;
  if manifest is distinct from new.generation_manifest or not exists(
   select 1 from workflow_runs r join workflow_model_invocations i on i.workspace_id=r.workspace_id and i.workflow_run_id=r.id
   join workflow_model_invocation_results o on o.workspace_id=i.workspace_id and o.workflow_run_id=r.id and o.model_invocation_id=i.id
   where r.workspace_id=g.workspace_id and r.project_id=g.project_key and r.runtime_id=g.run_id and i.invocation_id=g.run_id||'-invocation'
    and i.status='succeeded' and i.outcome='succeeded' and i.request_fingerprint=g.runtime_request_fingerprint
    and o.output_text::jsonb || jsonb_build_object('tasks',(select jsonb_agg(item || jsonb_build_object('sourceReferences',(select jsonb_agg(ref order by ref) from jsonb_array_elements(item->'sourceReferences') ref)) order by ord) from jsonb_array_elements(o.output_text::jsonb->'tasks') with ordinality as tasks(item,ord))) = new.plan_json
    and o.output_fingerprint=g.output_fingerprint and 'sha256:'||encode(sha256(convert_to(o.output_text,'UTF8')),'hex')=g.output_fingerprint)
   then raise exception using errcode='23514',message='Generated result unavailable'; end if;
 else raise exception using errcode='23514',message='Invalid planning origin'; end if;
 return new;
end; $$;

-- Generated evidence and audit must survive the same commit as the ordinary lifecycle.
create function check_generated_draft_audit() returns trigger language plpgsql as $$
declare p project_planning_drafts%rowtype; expected jsonb;
begin
 select * into p from project_planning_drafts where id=new.id and workspace_id=new.workspace_id;
 if p.origin<>'ai_generated' then return null; end if;
 expected:=jsonb_build_object('projectId',p.project_key,'revision',p.revision,'planFingerprint',p.plan_fingerprint,'sourceFingerprint',p.source_fingerprint);
 if not exists(select 1 from audit_events where workspace_id=p.workspace_id and entity_id=p.id and entity_type='project_planning_draft'
   and event_type='project.plan_draft_saved' and actor_user_id=p.created_by and metadata=expected)
  or (p.status<>'draft' and not exists(select 1 from audit_events a join approval_decisions d on d.workspace_id=a.workspace_id and d.approval_request_id=p.approval_request_id
    where a.workspace_id=p.workspace_id and a.entity_id=p.id and a.entity_type='project_planning_draft' and a.event_type='project.plan_'||p.status
     and a.actor_user_id::text=d.decided_by_actor_id and a.metadata=expected)) then
  raise exception using errcode='23514',message='Generated draft audit unavailable'; end if;
 if TG_OP='UPDATE' and p.status='approved' and p.revision<>(select max(revision) from project_planning_drafts where workspace_id=p.workspace_id and project_key=p.project_key) then
  raise exception using errcode='23514',message='Stale generated approval'; end if;
 return null;
end; $$;
create constraint trigger generated_draft_audit after insert or update on project_planning_drafts
 deferrable initially deferred for each row execute function check_generated_draft_audit();
