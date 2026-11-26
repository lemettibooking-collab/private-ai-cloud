-- Review-only project proposals; no manual import provenance or task authorization is fabricated.
create table project_planning_generations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
 project_key text not null, operation_key text not null check(operation_key ~ '^pp-[a-f0-9]{32}$'),
 run_id text not null check(run_id ~ '^ppg-[a-f0-9]{20}$'),
 requested_by uuid not null, identity_fingerprint text not null check(identity_fingerprint ~ '^[a-f0-9]{64}$'),
 preparation_fingerprint text not null check(preparation_fingerprint ~ '^[a-f0-9]{64}$'),
 offer_fingerprint text not null check(offer_fingerprint ~ '^[a-f0-9]{64}$'),
 request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
 runtime_request_fingerprint text not null check(runtime_request_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
 validation_version text not null default 'pac-project-plan/v1' check(validation_version='pac-project-plan/v1'),
 policy_json jsonb not null check(jsonb_typeof(policy_json)='object'),
 manifest_json jsonb not null check(jsonb_typeof(manifest_json)='array' and jsonb_array_length(manifest_json) between 1 and 4),
 authorized_at timestamptz not null, expires_at timestamptz not null,
 status text not null default 'started' check(status in ('started','proposal_available','invalid_output','budget_denied','provider_unavailable','recovery_required','authorization_denied')),
 output_fingerprint text, plan_fingerprint text, settled_at timestamptz,
 constraint project_generation_lifetime check(expires_at>authorized_at and expires_at<=authorized_at+interval '10 minutes'),
 constraint project_generation_state check(
  (status='started' and settled_at is null and output_fingerprint is null and plan_fingerprint is null) or
  (status<>'started' and settled_at is not null and
   ((status in ('proposal_available','invalid_output'))=(output_fingerprint is not null)) and
   ((status='proposal_available')=(plan_fingerprint is not null)))),
 check(output_fingerprint is null or output_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
 check(plan_fingerprint is null or plan_fingerprint ~ '^[a-f0-9]{64}$'),
 unique(workspace_id,operation_key),unique(workspace_id,run_id),unique(workspace_id,project_key,id),
 foreign key(workspace_id,project_key) references projects(workspace_id,project_key) on delete restrict,
 foreign key(workspace_id,requested_by) references workspace_members(workspace_id,user_id) on delete restrict
);
create table project_planning_generation_sources (
 workspace_id uuid not null, project_key text not null, generation_id uuid not null,
 source_index integer not null check(source_index between 0 and 3), document_id uuid not null,
 filename text not null, version integer not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 primary key(generation_id,source_index), unique(generation_id,filename),
 foreign key(workspace_id,project_key,generation_id) references project_planning_generations(workspace_id,project_key,id) on delete restrict,
 foreign key(workspace_id,document_id,version) references knowledge_document_versions(workspace_id,document_id,version) on delete restrict
);
create function fence_project_generation() returns trigger language plpgsql as $$
begin
 if tg_op='INSERT' then
  if new.status<>'started' then raise exception using errcode='23514',message='Generation must start pending'; end if;
  return new;
 end if;
 if tg_op='DELETE' then raise exception using errcode='23514',message='Immutable generation'; end if;
 if old.status<>'started' or
 (to_jsonb(new)-array['status','output_fingerprint','plan_fingerprint','settled_at']) is distinct from
 (to_jsonb(old)-array['status','output_fingerprint','plan_fingerprint','settled_at']) or new.status='started' then
 raise exception using errcode='23514',message='Immutable generation'; end if;
 if new.status in ('proposal_available','invalid_output') and not exists(
 select 1 from workflow_runs r join workflow_model_invocations i on i.workspace_id=r.workspace_id and i.workflow_run_id=r.id
 join workflow_model_invocation_results o on o.workspace_id=i.workspace_id and o.workflow_run_id=r.id and o.model_invocation_id=i.id
 where r.workspace_id=new.workspace_id and r.project_id=new.project_key and r.runtime_id=new.run_id
 and i.request_fingerprint=new.runtime_request_fingerprint
 and i.provider_id=new.policy_json->'identity'->>'providerId' and i.deployment_id=new.policy_json->'identity'->>'deploymentId'
 and i.provider_model_id=new.policy_json->'identity'->>'providerModelId' and i.provider_request_model_id=new.policy_json->'identity'->>'providerRequestModelId' and i.provider_model_version=new.policy_json->'identity'->>'providerModelVersion'
 and i.invocation_id=new.run_id||'-invocation' and i.status='succeeded' and o.output_fingerprint=new.output_fingerprint
 ) then raise exception using errcode='23514',message='Generation result unavailable'; end if;
 return new;
end; $$;
create trigger project_generation_immutable before insert or update or delete on project_planning_generations for each row execute function fence_project_generation();
create function fence_project_generation_source() returns trigger language plpgsql as $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Immutable generation sources'; end if;
 if not exists(select 1 from knowledge_documents d join knowledge_document_versions v on v.workspace_id=d.workspace_id and v.document_id=d.id
 where d.workspace_id=new.workspace_id and d.project_key=new.project_key and d.id=new.document_id and d.filename=new.filename and v.version=new.version and v.sha256=new.sha256)
 then raise exception using errcode='23514',message='Invalid generation source'; end if;
 return new;
end; $$;
create trigger project_generation_source_fence before insert or update or delete on project_planning_generation_sources for each row execute function fence_project_generation_source();
-- Require complete canonical source evidence and transactional audit at every commit.
create function check_project_generation_evidence() returns trigger language plpgsql as $$
declare g project_planning_generations; manifest jsonb;
begin
 if tg_table_name='project_planning_generation_sources' then select * into g from project_planning_generations where id=new.generation_id;
 else select * into g from project_planning_generations where id=new.id; end if;
 select jsonb_agg(jsonb_build_object('filename',filename,'version',version,'sha256',sha256) order by source_index) into manifest
 from project_planning_generation_sources where generation_id=g.id and workspace_id=g.workspace_id and project_key=g.project_key;
 if (select min(source_index)<>0 or max(source_index)<>jsonb_array_length(g.manifest_json)-1 from project_planning_generation_sources where generation_id=g.id)
 or manifest is distinct from g.manifest_json or not exists(select 1 from audit_events a where a.workspace_id=g.workspace_id and a.entity_id=g.id and a.entity_type='project_planning_generation' and a.event_type='project.planning_generation_authorized' and a.actor_user_id=g.requested_by and a.metadata->>'requestFingerprint'=g.request_fingerprint)
 then raise exception using errcode='23514',message='Generation evidence unavailable'; end if;
 if g.status<>'started' and not exists(select 1 from audit_events a where a.workspace_id=g.workspace_id and a.entity_id=g.id and a.entity_type='project_planning_generation' and a.event_type='project.planning_generation_settled' and a.actor_user_id=g.requested_by and a.metadata->>'status'=g.status and a.metadata->>'requestFingerprint'=g.request_fingerprint)
 then raise exception using errcode='23514',message='Generation settlement unavailable'; end if;
 return null;
end; $$;
create constraint trigger project_generation_evidence after insert or update on project_planning_generations deferrable initially deferred for each row execute function check_project_generation_evidence();
create constraint trigger project_generation_sources_evidence after insert on project_planning_generation_sources deferrable initially deferred for each row execute function check_project_generation_evidence();
