begin;

alter table workflow_model_invocations
  add column provider_request_model_id text,
  add column provider_identity_version smallint;

-- Rows created under migrations 0001-0004 have no factual pinned request identity.
-- Preserve that absence explicitly; never manufacture it from an alias or result version.
update workflow_model_invocations
set provider_identity_version = 1
where provider_identity_version is null;

alter table workflow_model_invocations
  alter column provider_identity_version set default 2,
  alter column provider_identity_version set not null,
  add constraint workflow_model_invocations_provider_identity_version_check check (
    provider_identity_version in (1, 2)
  ),
  add constraint workflow_model_invocations_provider_request_identity_check check (
    (provider_identity_version = 1 and provider_request_model_id is null)
    or
    (provider_identity_version = 2
      and provider_request_model_id is not null
      and char_length(provider_request_model_id) between 1 and 256
      and provider_request_model_id = btrim(provider_request_model_id)
      and provider_request_model_id ~ '^[A-Za-z0-9][A-Za-z0-9/:@._-]*$'
      and provider_request_model_id !~ '[[:cntrl:]]')
  );

commit;
