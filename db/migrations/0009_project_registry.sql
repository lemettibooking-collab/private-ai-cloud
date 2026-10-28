-- AI-038.3.1: tenant-scoped Project Registry (identity + canonical source metadata only).
--
-- * Workspace stays the tenant/security boundary; a Project is a product/system INSIDE one workspace.
--   The same project_key may exist in different workspaces and stays isolated by workspace_id.
-- * project_key is the Owner-facing Project ID and uses the same stable-id rule as the runtime's
--   workflow_runs.project_id, so registry keys and runtime project ids are directly comparable.
--   The internal uuid is never an Owner-facing selector.
-- * repository_url / default_branch describe where canonical code lives (non-secret SCM locator):
--   HTTPS only, no userinfo, query, fragment or percent-encoding, so credentials cannot be embedded.
-- * NO local or VPS filesystem path, checkout location, executor/environment/deployment policy or
--   secrets profile is stored here: those belong to typed M4 contracts (AI-041 / AI-042).
-- * No foreign key from workflow_runs.project_id: existing runtime rows reference project ids that
--   have no registry row and there is no factual backfill. Project-scoped reads join this registry.
-- * Rows are created explicitly by the Owner/operator; nothing is seeded.

create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_key text not null,
  display_name text not null,
  status text not null default 'active',
  repository_url text,
  default_branch text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_project_key_check
    check (project_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint projects_display_name_check
    check (
      char_length(display_name) between 1 and 120
      and display_name = btrim(display_name)
      and display_name !~ '[[:cntrl:]]'
    ),
  constraint projects_status_check
    check (status in ('active', 'paused', 'archived')),
  constraint projects_repository_url_check
    check (
      repository_url is null
      or (
        char_length(repository_url) <= 300
        and repository_url ~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){1,8}$'
        and repository_url !~ '(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-)'
      )
    ),
  constraint projects_default_branch_check
    check (
      default_branch is null
      or (
        char_length(default_branch) between 1 and 200
        and default_branch ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
        and default_branch !~ '(\.\.|//|/$|\.$|\.lock$|/\.)'
      )
    ),
  constraint projects_default_branch_requires_repository_check
    check (default_branch is null or repository_url is not null),
  constraint projects_workspace_project_key_unique
    unique (workspace_id, project_key)
);

create index projects_workspace_status_key_idx on projects (workspace_id, status, project_key);

-- Project-scoped run discovery: bounded, newest first, inside one workspace and one project.
create index workflow_runs_workspace_project_created_idx
  on workflow_runs (workspace_id, project_id, created_at desc, runtime_id desc)
  where runtime_id is not null;

create trigger set_projects_updated_at
before update on projects
for each row execute function set_updated_at();
