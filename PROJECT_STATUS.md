# Project Status

## Current Milestone

DB-01 database foundation scaffold.

Private AI Cloud is currently a frontend-only MVP UI prototype for a closed AI Operations Center. It demonstrates the intended product surfaces, approval-first operating model, AI department map, mocked workflows, and Smart Algorithms roadmap without backend execution.

DB strategy selected for planning: PostgreSQL-compatible foundation, with local development via Homebrew PostgreSQL and no Docker requirement for DB-01. Raw SQL migrations are planned. DB-01 is scaffold only and does not add a runtime DB connection, backend routes, auth, ORM, or dependencies.

## Completed Stages

- Initial Next.js App Router prototype.
- Application shell with sidebar, topbar, main content, and contextual drawer.
- Blueprint-aligned navigation.
- Dashboard MVP as Owner decision center.
- Knowledge Base with mocked documents, indexing status, collections, tags, permissions, source management, and Document Intelligence block.
- RAG Chat with mocked chat history, sources, selected collections, no-data state, answer actions, and input placeholder.
- AI Departments page covering all 10 departments.
- Workflows catalog grouped by departments with MVP/planned/future/locked filtering.
- Approval queue and concrete approval detail example.
- Reports page with Weekly Owner Report - Current MVP.
- Settings pages for assistants, security, integrations, roles, and operator console.
- Dedicated Roadmap page for v0.1, v0.2, v0.3, v1.0, and v2.0.
- QA report: `docs/qa/ui-product-review-v0.1.md`.
- UI Refinement Patch 1 implementation notes added to QA report.
- Data Model Blueprint v0.1: `docs/architecture/data-model-blueprint-v0.1.md`.
- Database Schema Blueprint v0.1: `docs/architecture/database-schema-v0.1.md`.
- DB Foundation Implementation Plan v0.1: `docs/architecture/db-foundation-implementation-plan-v0.1.md`.
- DB-01 scaffold: `db/README.md`, `db/migrations`, `db/seeds`, and `.env.example`.

## Active Routes

- `/`
- `/dashboard`
- `/knowledge`
- `/knowledge/[documentId]`
- `/chat`
- `/departments`
- `/workflows`
- `/workflows/support-reply/run`
- `/workflows/telegram-content/run`
- `/workflows/codex-task/run`
- `/workflows/qa-review/run`
- `/workflows/runs/[runId]`
- `/approvals`
- `/approvals/[approvalId]`
- `/reports`
- `/roadmap`
- `/settings`
- `/settings/assistants`
- `/settings/integrations`
- `/settings/operator-console`
- `/settings/roles`
- `/settings/security`

## Verification Results

Latest baseline verification:

- `npm run lint`: passed.
- `npm run build`: passed.
- Route checks returned `200 OK` for `/dashboard`, `/knowledge`, `/chat`, `/departments`, `/workflows`, `/approvals`, `/reports`, `/settings`, and `/roadmap`.
- Approval detail route `/approvals/approval-501` returned `200 OK`.

## Next Recommended Stages

- DB-02 P0 SQL migration.
- DB-03 seed demo workspace.
- DB-04 DB client/query layer.
- DB-05 read-only API routes.
- Knowledge Base upload.
- RAG layer.
- Workflow engine backend.
- Approval persistence.
