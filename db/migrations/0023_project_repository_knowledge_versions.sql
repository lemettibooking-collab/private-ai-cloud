-- PAC-ONB-02-KB-01: additive metadata concurrency + project-scoped immutable document bytes.
-- Legacy knowledge rows stay unscoped; no automatic project inference/backfill or indexing.
alter table projects add column repository_revision integer not null default 0
  check (repository_revision between 0 and 1000000000);

-- Protect CAS even when another SQL writer changes metadata without supplying a revision.
-- Revision rollback/jumps are rejected; an explicit same-metadata bind may advance by one.
create function fence_project_repository_revision() returns trigger language plpgsql as $$
begin
  if new.repository_url is distinct from old.repository_url
    or new.default_branch is distinct from old.default_branch
    or new.repository_revision is distinct from old.repository_revision then
    if old.repository_revision >= 1000000000
      or new.repository_revision not in (old.repository_revision, old.repository_revision + 1) then
      raise exception using errcode='23514', message='Invalid repository revision';
    end if;
    new.repository_revision := old.repository_revision + 1;
  end if;
  return new;
end;
$$;
create trigger projects_repository_revision_fence before update of repository_url,default_branch,repository_revision on projects
  for each row execute function fence_project_repository_revision();

create unique index audit_events_repository_request_unique
  on audit_events (workspace_id, (metadata->>'requestId'))
  where event_type='project.repository_bound';

alter table knowledge_documents
  add column project_key text,
  add column filename text,
  add constraint knowledge_documents_project_fk foreign key (workspace_id, project_key)
    references projects (workspace_id, project_key) on delete restrict,
  add constraint knowledge_documents_project_filename_check check (
    (project_key is null and filename is null) or
    (project_key is not null and filename is not null and char_length(filename) between 4 and 128
      and filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.(md|yaml|yml)$' and filename !~ '[[:space:][:cntrl:]]' and position('..' in filename)=0)
  );
create unique index knowledge_documents_project_filename_unique
  on knowledge_documents (workspace_id, project_key, filename) where project_key is not null;

create function preserve_project_document_identity() returns trigger language plpgsql as $$
begin
  if old.project_key is not null and
     (new.project_key is distinct from old.project_key or new.filename is distinct from old.filename) then
    raise exception using errcode='23514', message='Immutable project document identity';
  end if;
  return new;
end;
$$;
create trigger project_document_identity_immutable before update of project_key,filename on knowledge_documents
  for each row execute function preserve_project_document_identity();

create table knowledge_document_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  version integer not null check (version between 1 and 50),
  content bytea not null check (octet_length(content) between 1 and 262144),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  upload_request_key text not null check (upload_request_key ~ '^[a-z0-9][a-z0-9._-]{7,95}$'),
  intent_fingerprint text not null check (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, document_id) references knowledge_documents (workspace_id, id) on delete restrict,
  foreign key (workspace_id, created_by) references workspace_members (workspace_id, user_id) on delete restrict,
  unique (workspace_id, document_id, version),
  unique (workspace_id, upload_request_key),
  unique (workspace_id, id)
);

-- Retention/deletion is a separate reviewed operation. Application writes cannot rewrite history.
create function reject_knowledge_version_mutation() returns trigger language plpgsql as $$
begin
  raise exception using errcode='23514', message='Immutable knowledge version';
end;
$$;
create trigger knowledge_document_versions_immutable before update or delete on knowledge_document_versions
  for each row execute function reject_knowledge_version_mutation();
