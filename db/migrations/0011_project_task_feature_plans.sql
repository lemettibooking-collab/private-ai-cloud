-- AI-039: durable, immutable FeaturePlan revisions of a ProjectTask (Development Workflow Browser).
--
-- * ProjectTask IS the Owner-level development request; this table persists its FeaturePlans:
--   ProjectTask → FeaturePlan revision 1..N (each row immutable) → DevelopmentTask[] (inside plan_json).
-- * plan_json is the canonical, validated FeaturePlan (lib/contracts/development-plan.ts) exactly as
--   the server saved it; plan_fingerprint is sha256 of its canonical serialization. Readers re-validate
--   and re-fingerprint every row they present and fail closed on any disagreement (never repaired).
-- * One plan lineage per task: plan_key is server-generated at revision 1 and reused by every later
--   revision of the same task; editing creates revision N+1, an existing row is never updated.
-- * Every revision belongs to a ProjectTask of the SAME workspace AND project (composite FK).
-- * Writes go only through the narrow server-side contract lib/development/feature-plan-mutations.ts
--   (saveDraftRevision): Owner + task + project locks, idempotent by creation_idempotency_key +
--   immutable intent fingerprint, exactly one audit event in the same transaction.
-- * AI-039 stores draft plans only; it never starts a run, model, executor or repository action.
-- * Nothing is seeded.

create table project_task_feature_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_key text not null,
  task_key text not null,
  plan_key text not null,
  revision integer not null,
  -- Constant 1: lets every revision reference revision 1 of the same task and plan lineage (below).
  root_revision integer not null default 1,
  plan_json jsonb not null,
  plan_fingerprint text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Form idempotency key of the save call + sha256 of the immutable save intent (task + canonical plan
  -- content). Same key + same intent → the same revision; same key + different intent → conflict.
  creation_idempotency_key text not null,
  creation_intent_fingerprint text not null,
  constraint project_task_feature_plans_plan_key_check
    check (plan_key ~ '^plan-[0-9a-f]{20}$'),
  constraint project_task_feature_plans_revision_check
    check (revision >= 1),
  constraint project_task_feature_plans_root_revision_check
    check (root_revision = 1),
  -- The stored plan is an object whose id IS the plan key and whose status is draft (AI-039 scope).
  constraint project_task_feature_plans_plan_json_check
    check (jsonb_typeof(plan_json) = 'object' and plan_json ->> 'id' = plan_key and plan_json ->> 'status' = 'draft'
           and jsonb_typeof(plan_json -> 'tasks') = 'array'),
  constraint project_task_feature_plans_plan_fingerprint_check
    check (plan_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint project_task_feature_plans_creation_idempotency_key_check
    check (creation_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint project_task_feature_plans_creation_intent_fingerprint_check
    check (creation_intent_fingerprint ~ '^[0-9a-f]{64}$'),
  -- One revision number per task; the race guard behind revision allocation.
  constraint project_task_feature_plans_task_revision_unique unique (workspace_id, task_key, revision),
  -- A plan key's revision 1 exists once per workspace, so a plan key belongs to exactly one task.
  constraint project_task_feature_plans_plan_revision_unique unique (workspace_id, plan_key, revision),
  -- Target of the lineage self-reference below.
  constraint project_task_feature_plans_lineage_unique unique (workspace_id, task_key, plan_key, revision),
  -- Same-workspace, same-project ProjectTask (cross-tenant / cross-project plans are impossible).
  constraint project_task_feature_plans_task_fk foreign key (workspace_id, project_key, task_key)
    references project_tasks (workspace_id, project_key, task_key) on delete cascade,
  -- Every revision references revision 1 of the SAME task with the SAME plan key: together with the
  -- task/revision unique key, a task has exactly one plan lineage.
  constraint project_task_feature_plans_lineage_fk foreign key (workspace_id, task_key, plan_key, root_revision)
    references project_task_feature_plans (workspace_id, task_key, plan_key, revision) on delete cascade
);

-- One revision per (workspace, form idempotency key); the race guard behind exact replay.
create unique index project_task_feature_plans_workspace_creation_key_unique
  on project_task_feature_plans (workspace_id, creation_idempotency_key);

-- Revisions are immutable: no UPDATE of any column, ever (a new revision is a new row). Rows only
-- disappear with their task / workspace (cascade).
create function reject_project_task_feature_plan_update() returns trigger
language plpgsql as $$
begin
  raise exception using errcode = '55000', message = 'FeaturePlan revisions are immutable.';
end;
$$;

create trigger project_task_feature_plans_immutable
before update on project_task_feature_plans
for each row execute function reject_project_task_feature_plan_update();

-- Exactly one audit event per saved revision: the last guard against a duplicate
-- task.feature_plan_revision_created under any race (entity_id = project_task_feature_plans.id).
create unique index audit_events_feature_plan_event_unique on audit_events (workspace_id, event_type, entity_id)
  where event_type = 'task.feature_plan_revision_created';
