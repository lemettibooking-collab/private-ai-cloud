# Private AI Cloud DB Foundation Implementation Plan v0.1

Date: 2026-06-28

Status: planning document only. This does not add migrations, a database package, ORM, backend routes, auth, Docker, RAG, LLM calls, integrations, or UI changes.

## 1. Purpose

This document defines a safe implementation plan for moving Private AI Cloud from a mocked frontend prototype to the first backend/database foundation.

It should be reviewed before any real DB/backend patch is created. The goal is to avoid coupling the product to Docker, premature auth, premature integrations, or a schema that cannot support Product Blueprint v0.2.

## 2. Current State

- The project is a frontend-only prototype.
- Mocked product data lives in `lib/mock-data.ts`.
- Routes/pages already exist for Dashboard, Knowledge Base, RAG Chat, AI Departments, Workflows, Approvals, Reports, Settings, and Roadmap.
- UI prototype baseline exists at commit `481acf5a1f942d09f5c1b581723c8579a5f77c19`.
- `docs/architecture/data-model-blueprint-v0.1.md` exists.
- `docs/architecture/database-schema-v0.1.md` exists locally as the Database Schema Blueprint v0.1.
- Backend is absent.
- Auth is absent.
- Docker should not be used in the first DB foundation because it was previously a local blocker.
- Next step after this document: review this plan, then create the first DB foundation patch.

## 3. Recommended DB Strategy

### Option A - Local PostgreSQL Via Homebrew

Pros:

- No Docker dependency.
- Works locally on the current machine.
- Compatible with production PostgreSQL.
- Suitable for migrations and SQL review.

Cons:

- Requires local Postgres installation and service setup.
- Another developer/machine needs repeated local setup.

### Option B - Managed Postgres / Supabase

Pros:

- Fast to start.
- Managed auth/storage can be useful later.
- Does not require local database service.

Cons:

- May not be acceptable for RF contour or confidential client data in production.
- Depends on an external provider.
- Legal/data residency decision remains separate.

### Option C - SQLite For Prototype

Pros:

- Very fast.
- Simple.
- No server process.

Cons:

- Poor fit for future multi-tenant PostgreSQL/RLS strategy.
- Requires later migration to Postgres.
- Not suitable as the product foundation DB.

### Recommendation

Use a PostgreSQL-compatible approach for the first backend foundation.

Default local path: Homebrew PostgreSQL, because Docker is unavailable and SQLite would create the wrong long-term foundation.

Production decision, Supabase vs self-host/RF Postgres, remains an open question. The schema and migrations should remain provider-neutral PostgreSQL.

## 4. ORM / Migration Tool Decision

### Raw SQL Migrations

Pros:

- Full control over schema.
- Database Schema Blueprint already contains a SQL DDL draft.
- Compatible with any PostgreSQL deployment.
- Direct path to RLS, policies, extensions, indexes, and advanced SQL later.

Cons:

- More manual work.
- Requires discipline around migration naming, review, and rollback notes.

### Drizzle

Pros:

- TypeScript-friendly.
- Understandable migration workflow.
- Helps type query results and schema usage.

Cons:

- Adds dependency and migration discipline.
- Still needs raw SQL escape hatches for RLS, policies, and some Postgres features.

### Prisma

Pros:

- Excellent starter DX.
- Familiar schema workflow.

Cons:

- RLS and raw Postgres capabilities can be less direct.
- May be too heavy for approval/audit/RAG-oriented schema.
- Can encourage app-model coupling before DB boundaries are settled.

### Recommendation

Use Raw SQL migrations + a small typed query layer in TypeScript for the first DB milestone.

Rationale:

- `database-schema-v0.1.md` already contains accurate P0 DDL draft.
- Approval, audit, tenant isolation, and future RLS benefit from direct SQL control.
- The first API milestone should be read-only and small, so a full ORM is not required yet.

Drizzle can be reconsidered after P0 tables and read-only APIs are stable.

Do not install anything in this planning step.

## 5. First Backend Milestone Scope

The first backend milestone includes:

- database connection setup;
- environment variables;
- migrations folder;
- P0 tables;
- seed data;
- minimal read APIs for UI;
- no real auth yet;
- demo workspace context;
- no real RAG;
- no file upload;
- no LLM;
- no integrations.

P0 tables from schema:

- `workspaces`;
- `users`;
- `workspace_members`;
- `roles`;
- `permissions`;
- `role_permissions`;
- `member_role_assignments`;
- `knowledge_collections`;
- `knowledge_documents`;
- `document_chunks`;
- `assistant_threads`;
- `assistant_messages`;
- `workflow_templates`;
- `workflow_runs`;
- `workflow_step_runs`;
- `approval_requests`;
- `audit_events`.

## 6. What Stays Mocked

These remain mocked after DB foundation:

- AI generation;
- RAG retrieval;
- embeddings/vector DB;
- file upload parsing;
- Document Intelligence;
- workflow execution engine;
- approval execution side effects;
- Telegram/GitHub/local runner integrations;
- Operator Console metrics;
- Managed Service objects;
- real auth/session;
- billing;
- production deployment.

## 7. Seed Data Plan

### Workspace

- Name: `Smart Algorithms Demo`.
- Slug: `smart-algorithms-demo`.
- Type: `demo`.
- Region: `RU`.
- Data residency: `RU`.

### User

- Email: `owner@smartalgorithms.local`.
- Name: `Demo Owner`.
- Status: `active`.

### Roles

- Owner.
- Admin.
- Support Operator.
- Marketing Operator.
- Product Manager.
- Developer / Reviewer.
- Viewer.
- Demo Viewer.

### Permissions

Base permission set:

- `workspace.manage`;
- `users.manage`;
- `roles.manage`;
- `knowledge.upload`;
- `knowledge.view_collection`;
- `rag_chat.run`;
- `assistants.manage`;
- `workflows.run`;
- `approvals.approve`;
- `reports.view`;
- `integrations.manage`;
- `security.manage`;
- `operator_console.view`;
- `codex.create_task`;
- `codex.launch`;
- `local_runner.run_checks`;
- `external_actions.publish`.

### Collections

- Product.
- Support.
- Marketing.
- Engineering.
- Legal/Security.

### Workflow Templates

- Knowledge Base.
- Support Reply.
- Telegram Content.
- Product / Codex Task.
- QA / Review Report.

### Demo Approval Requests

- Telegram post publication.
- Support reply beyond FAQ.
- Codex task creation.
- Local runner locked action.

Seed data should be idempotent. Prefer stable slugs/codes over fixed UUIDs unless tests require deterministic IDs.

## 8. Environment Variables Plan

Initial:

```env
DATABASE_URL=
APP_DEMO_WORKSPACE_SLUG=smart-algorithms-demo
APP_DEMO_USER_EMAIL=owner@smartalgorithms.local
APP_ENV=development
```

Future:

```env
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET_KEY=
VECTOR_DB_URL=
LLM_PROVIDER=
LLM_API_KEY=
INTERNAL_API_TOKEN=
```

Security:

- `.env*` must remain ignored.
- Never commit secrets.
- Use `.env.example` with placeholder values.
- Do not add real credentials to docs, commits, CI logs, or build output.

## 9. Folder Structure Plan

Recommended structure: Raw SQL migrations + small typed query layer.

```text
db/
  migrations/
    0001_initial_p0_schema.sql
  seeds/
    seed_demo_workspace.sql
  README.md

lib/
  db/
    client.ts
    queries/
      workspaces.ts
      knowledge.ts
      workflows.ts
      approvals.ts
      reports.ts
```

Notes:

- `db/` should contain SQL and operational DB docs only.
- `lib/db/client.ts` should be server-only.
- Query modules should stay narrow and read-only in the first API milestone.
- Do not create this structure until Patch DB-01/DB-02.

## 10. API Routes Plan

Minimal read-only API routes first:

- `GET /api/demo/context`
- `GET /api/knowledge/documents`
- `GET /api/knowledge/collections`
- `GET /api/chat/threads`
- `GET /api/workflows/templates`
- `GET /api/workflows/runs`
- `GET /api/approvals`
- `GET /api/reports/weekly-owner`
- `GET /api/audit/events`

Rules:

- First APIs should be read-only.
- No writes until auth/permission guard is planned.
- Demo workspace context is hardcoded or env-based only in development.
- No external action APIs in the first patch.
- No publish/send/run/local-execute endpoints until approval and auth are real.

## 11. Mock-to-DB Migration Strategy

### Phase 1

- Keep `lib/mock-data.ts`.
- Add DB layer separately.
- No UI rewiring.

### Phase 2

- Add API routes reading from DB.
- Create dev-only route checks.
- Keep fallback mock data.

### Phase 3

Gradually rewire pages:

- approvals;
- knowledge;
- workflows;
- reports;
- chat threads.

### Phase 4

- Remove only duplicated mock data after DB-backed UI is stable.

Rule: UI must keep rendering if DB is unavailable during the early phase.

## 12. Auth Strategy Draft

No real auth in the first DB foundation.

For first demo backend:

- use development-only demo user/workspace resolver;
- do not expose public write APIs;
- do not deploy with dev bypass enabled;
- replace with real auth before writes/external actions.

Future options:

- custom auth;
- Supabase Auth;
- Lucia/Auth.js/custom session;
- enterprise SSO later.

Auth must be solved before any write API or external action API.

## 13. Tenant Isolation Plan

MVP:

- every query filtered by `workspace_id`;
- demo workspace resolver;
- no cross-workspace API;
- audit every sensitive action later.

Future:

- RLS;
- session variable or auth claim for workspace;
- object storage prefixes;
- vector namespace per workspace;
- dedicated deployment for enterprise.

## 14. Implementation Patch Sequence

### Patch DB-01 - Tooling And Env Scaffold

- Choose DB/migration tool.
- Add `.env.example`.
- Add DB README.
- Add placeholder folder structure.
- No runtime DB use.

### Patch DB-02 - P0 Migrations

- Add migration for P0 tables.
- Use raw SQL migration based on `database-schema-v0.1.md`.
- No UI changes.

### Patch DB-03 - Seed Smart Algorithms Demo

- Add seed script.
- Create workspace, demo owner, roles, permissions, collections, workflow templates, demo approvals.

### Patch DB-04 - Read-only DB Client And Queries

- Add DB client.
- Add query functions.
- Keep query modules server-only.
- No UI rewiring.

### Patch DB-05 - Read-only API Routes

- Add read APIs.
- Add development workspace context.
- Add route tests/checks.

### Patch DB-06 - Rewire First Page

- Start with `/approvals` or `/knowledge`.
- Keep mock fallback.
- Keep external actions locked.

### Patch DB-07 - Audit/Event Foundation

- Write audit events only for safe demo interactions if needed.
- Otherwise keep audit mocked until auth/write policy exists.

Do not implement these patches now.

## 15. Verification Plan

For every future backend patch:

```bash
npm run lint
npm run build
```

After DB is added:

- migration dry run;
- seed run;
- API smoke checks;
- two consecutive `npm run build` runs if build instability repeats;
- verify routes:
  - `/dashboard`;
  - `/knowledge`;
  - `/chat`;
  - `/departments`;
  - `/workflows`;
  - `/approvals`;
  - `/reports`;
  - `/settings`;
  - `/roadmap`.

## 16. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Docker unavailable locally | Blocks containerized DB. | Use Homebrew PostgreSQL for first local foundation. |
| DB choice inconsistent with RF contour | Rework or compliance issue. | Keep schema provider-neutral; defer production provider decision. |
| Supabase convenience vs data residency | Potential legal/data boundary issue. | Treat Supabase as dev/managed option only until residency is decided. |
| RLS too early without auth | Slows initial DB work. | Use app-level workspace checks first; design schema for later RLS. |
| Mock-to-DB drift | UI and DB data diverge. | Seed demo data from current mock concepts and rewire one page at a time. |
| Overbuilding before first client pilot | Too much backend before product validation. | Limit first milestone to P0 tables and read-only APIs. |
| External action APIs exposed too early | Product safety risk. | No write/external action APIs before auth, approvals, audit, and allowlists. |
| Secrets accidentally committed | Security incident. | Keep `.env*` ignored and use `.env.example` placeholders only. |
| Build instability after DB packages | Slower iteration. | Add dependencies in small patches and run lint/build after each. |
| Schema too broad for MVP | Migration complexity. | Implement P0 only; document P1/P2 without creating tables yet. |

## 17. Decisions Needed Before DB-01

1. Raw SQL vs Drizzle.
2. Local Homebrew Postgres vs managed dev Postgres.
3. Supabase/self-host Postgres deferred or selected.
4. Whether to add `.env.example`.
5. Whether seed data should be English, Russian, or i18n-key based.
6. Whether API routes should be Node runtime only.
7. Whether first DB-backed page should be `/approvals` or `/knowledge`.

## 18. Recommended Decision

Recommended default path:

- PostgreSQL.
- Local Homebrew Postgres for current machine if Docker is unavailable.
- Raw SQL migrations for P0 because SQL DDL draft already exists.
- Small typed query layer in TypeScript.
- Read-only APIs first.
- Rewire `/approvals` first because approval-first is central to the product.
- Keep mock fallback until DB-backed UI is stable.

## 19. Non-goals

This plan does not implement:

- real migrations;
- real DB connection;
- auth;
- writes;
- file upload;
- vector DB;
- LLM calls;
- RAG retrieval;
- integrations;
- Docker;
- billing;
- production deployment;
- external publish;
- automatic Codex launch;
- automatic merge.

## 20. Next Step

Next artifact after this document:

`db-01-tooling-env-scaffold-task.md`

Do not create it now unless explicitly requested.
