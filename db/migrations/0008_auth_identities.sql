-- AI-038.2a: minimal mapping from an authenticated external identity (provider + stable provider
-- account subject) to an existing PAC user. Authentication only: authorization stays in the P0
-- users / workspace_members / roles / member_role_assignments model (AI-038.1).
--
-- * No Auth.js-owned User/Account/Session tables and no OAuth tokens are stored.
-- * The subject is the provider's stable account identifier (GitHub: numeric account id), never an
--   email, login or display name; email is not a mapping key.
-- * Rows are created explicitly by the Owner/operator; nothing is auto-provisioned or seeded.
-- * A mapping is revoked by status = 'disabled' or deletion.

create table auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_identities_provider_check
    check (provider ~ '^[a-z][a-z0-9-]{0,31}$'),
  constraint auth_identities_provider_subject_check
    check (
      char_length(provider_subject) between 1 and 255
      and provider_subject !~ '[[:space:][:cntrl:]@]'
    ),
  constraint auth_identities_status_check
    check (status in ('active', 'disabled')),
  constraint auth_identities_provider_subject_unique
    unique (provider, provider_subject)
);

create index auth_identities_user_id_idx on auth_identities (user_id);

create trigger set_auth_identities_updated_at
before update on auth_identities
for each row execute function set_updated_at();
