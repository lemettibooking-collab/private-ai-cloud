# Project Status

## Current State (Roadmap v1.4, 2026-10-07)

Private AI Cloud is a **vendor-neutral AI Engineering Control Plane**. The canonical status lives in [`docs/ROADMAP.md`](docs/ROADMAP.md). This file is a short summary and does not override the roadmap.

| Milestone | Status |
|---|---|
| M1 Real Money Safety | DONE |
| M2 Direct Model Provider Capability | IN REVIEW (M2.0 and M2.1 DONE; M2.2 DEFERRED BY OWNER) |
| M3 Owner Product | ACTIVE / NOT DONE: AI-037.7, AI-038.0–AI-038.7, AI-039 and AI-039.1 DONE (direct API-key live smoke deferred by Owner); AI-039.2 Phase A committed, entitlement gate deferred by external supported-network blocker, Phase B blocked; AI-040a IN REVIEW |
| M4 Vendor-Neutral Executor Platform | AI-041.0 IN REVIEW; AI-041.1 IN REVIEW (managed transport + process-local executor authority/exposure bridge; production dispatch BLOCKED) |
| M5–M8 | PLANNED (M5 and M7 rebased in v1.4) |

**Current local slices:** AI-040a Local Developer Handoff, AI-041.0 Vendor-Neutral Executor Adapter Contract and AI-041.1 executor transport/exposure bridge IN REVIEW (not DONE); AI-041.1 real dispatch and AI-039.2 Phase B stay blocked, with no inference proof. The full order is in `docs/ROADMAP.md` §9 / §11. M2.2 remains DEFERRED BY OWNER.\
**First implementation task created by the v1.4 rebase:** AI-041.0.

**Current AI-041.1 exception:** the Owner explicitly excluded the prerequisite independent AI-041.0 / Decomposition gates for this implementation. This is not a PASS declaration. Security invariants are unchanged. AI-041.1 is IN REVIEW; real executor dispatch remains BLOCKED pending a durable executor-specific financial/start boundary and a sufficient exposure policy.

## What Exists

- The Owner Console (RU / EN): Dashboard, My Attention, Projects, Tasks, Runs and Approvals read real runtime data read-only; the remaining prototype pages use mocked data.
- A PostgreSQL 16 schema with raw SQL migrations `0001`–`0012` and the Smart Algorithms demo seed.
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
- A `ModelProvider` abstraction with an OpenAI adapter, a deterministic mock and a real-provider composition root. No real paid call has been made (the AI-039.1 direct API-key live smoke is deferred by Owner).
- The Owner read backend bundle, the authenticated identity boundary, and the Auth.js GitHub session adapter. The adapter's only HTTP route is `/api/auth/[...nextauth]`; the only other route is the AI-039.2 Sign in with ChatGPT loopback callback.
- Two narrow Owner product-state writes, each through an audited server-side contract: Quick Create (a draft ProjectTask) and saving an immutable draft FeaturePlan revision of a ProjectTask (AI-039). Neither starts an execution or a model invocation.
- AI-039.1 adds one Owner-approved model-operation write, the Planning Interview. With a valid planning policy and the Owner's explicit per-request approval, it:
  - records a planning request;
  - runs ONE budget-bounded planning Workflow Run through the existing runtime (ledger, pre-spend budget, durable result), which starts one model invocation;
  - returns an unsaved candidate.

  It writes runtime and planning state. It never saves a FeaturePlan, never changes the ProjectTask status, and never invokes an executor, GitHub or a repository mutation.
- CI quality workflow: lint, typecheck, unit tests and build.
- AI-040a (IN REVIEW): local CLI PREPARE/REVIEW, external protected manifest, explicit paths, tracked/untracked patch and untrusted report capture, bounded fixed-command verification and provider-neutral Owner review package. Human-operated executor metadata only; no executor invocation, runtime/DB/UI wiring, automatic approval or Git mutation. See `docs/operations/local-developer-handoff.md`.
- AI-041.0 (IN REVIEW): separate pure ExecutorAdapter contract with configured identity/capabilities, existing FeaturePlan admission, immutable invocation validation and bounded hashed patch-proposal/report evidence. Rejected, failed and ambiguous outcomes remain distinct. No execute method, dispatch authority, real executor, provider, runtime/DB/UI binding or Git authority; AI-040a metadata remains inert. See [contract v1](docs/architecture/executor-adapter-contract-v1.md).
- AI-041.1 (IN REVIEW): separate managed Agents API protocol transport (`environment: none`, no executable tools/subagents), explicit dispatch authority, financial admission/exposure reservation, process-local single-consumer test fence and usage reconciliation. Fake transport evidence only. The server-only production composition cannot read credentials or dispatch; no caller flag enables it. No provider-side hard spending cap is claimed. See [boundary and limitations](docs/architecture/openai-agents-executor-v1.md).

## Not Yet Implemented

- Runtime business APIs, and any UI action that starts a run, model, executor or repository change (the only exception is the AI-039.1 Owner-approved planning Run)
- Enabled/live executor dispatch and durable executor financial/start authority, ExecutorRouter and ExecutionEnvironment (AI-041.1 supplies a locked transport and process-local test proof only)
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
- `/attention`
- `/tasks`
- `/tasks/new`
- `/tasks/[taskId]`
- `/tasks/[taskId]/development`
- `/runs`
- `/runs/[runId]`
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
