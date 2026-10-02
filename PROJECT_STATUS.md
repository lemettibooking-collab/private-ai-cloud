# Project Status

## Current State (Roadmap v1.4, 2026-10-01)

Private AI Cloud is a **vendor-neutral AI Engineering Control Plane**. The canonical status lives in [`docs/ROADMAP.md`](docs/ROADMAP.md). This file is a short summary and does not override the roadmap.

| Milestone | Status |
|---|---|
| M1 Real Money Safety | DONE |
| M2 Direct Model Provider Capability | IN REVIEW (M2.0 and M2.1 DONE; M2.2 DEFERRED BY OWNER) |
| M3 Owner Product | ACTIVE: AI-037.7, AI-038.0, AI-038.1 and AI-038.2a DONE; AI-038.2b real GitHub OAuth smoke PLANNED / BLOCKED ON OWNER EXTERNAL CONFIG |
| M4 Vendor-Neutral Executor Platform | REBASED; first new task AI-041.0 Vendor-Neutral Executor Adapter Contract (PLANNED) |
| M5–M8 | PLANNED (M5 and M7 rebased in v1.4) |

**Next on the operational line:** AI-038.2b, then real read wiring for the Owner Console, then AI-039.\
**First implementation task created by the v1.4 rebase:** AI-041.0.

## What Exists

- A Next.js UI prototype for the AI Operations Center. Most of it is backed by mocked data; it is not yet wired to the runtime.
- A PostgreSQL 16 schema with raw SQL migrations `0001`–`0008` and the Smart Algorithms demo seed.
- A server-only workflow runtime:
  - command lifecycle, claims and executions;
  - approvals and the invocation ledger;
  - pre-spend budgets and the provider-start fence;
  - `outcome_unknown` / `recovery_required` recovery and a local Owner recovery tool;
  - tenant isolation, audit and operational signals.
- Domain contracts:
  - FeaturePlan and task waves;
  - development-task admission policy;
  - the development-execution state machine with corrective attempts;
  - the multi-project scheduler;
  - the model registry and routing policy.
- A `ModelProvider` abstraction with an OpenAI adapter, a deterministic mock and a real-provider composition root. No real paid call has been made.
- The Owner read backend bundle, the authenticated identity boundary, and the Auth.js GitHub session adapter. The adapter's only HTTP route is `/api/auth/[...nextauth]`.
- CI quality workflow: lint, typecheck, unit tests and build.

## Not Yet Implemented

- Real GitHub OAuth smoke, and UI wiring to real runtime data
- Runtime business APIs or server actions
- Executor integrations (ExecutorAdapter / ExecutorRouter / ExecutionEnvironment)
- Automated Quality/Security Gate on executor output, and the corrective controller
- RAG, real external integrations, staging/production deployment

## History

Earlier stages:
- the UI prototype and UI Refinement Patch 1;
- the data model and schema blueprints;
- the DB-01 scaffold, DB-02 P0 schema and DB-03 demo seed;
- AI-001…AI-036.7;
- the completed AI-037 items (AI-037.0, .1, .1.1, .6a, .4a, .1.2, .7). AI-037.2 / .3 / .5 / .6b / .8 remain deferred.

These are recorded in `docs/ROADMAP.md` §4 and in `docs/qa/`.

## Active Routes

- `/`
- `/dashboard`
- `/knowledge`
- `/knowledge/[documentId]`
- `/chat`
- `/departments`
- `/operations`
- `/projects`
- `/workflows`
- `/workflows/development-plan/run`
- `/workflows/development-execution/run`
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
- `/api/auth/[...nextauth]` (Auth.js authentication only; no business API)

## Verification

Run before reporting any change as done: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`. Use `npm run test:pg` when a task affects the database. Current results are recorded in each task's report, not in this file.
