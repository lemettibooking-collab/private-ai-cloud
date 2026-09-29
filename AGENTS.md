# AGENTS.md

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Private AI Cloud — rules for coding agents (Codex, Claude Code)

### Project state

- **UI** (`app/`, `components/`): a prototype on mocked data. It has no transport to the backend, no routes or server actions that call the runtime, and no auth.
- **Backend runtime layer** (server-only, reachable only from tests today):
  - `lib/contracts/`: domain contracts;
  - `lib/workflows/`: runtime service, authorized access facade, API;
  - `lib/providers/`: model provider adapters;
  - `lib/db/`: PostgreSQL store, read model, tenant resolver, `pg` adapter;
  - `db/migrations/`, `db/seeds/`: raw SQL, PostgreSQL 16.
- **Work is tracked as numbered tasks (`AI-0xx`).** Security-relevant stages pass an adversarial gate before the next stage starts (see "Task and gate process").

### Scope

- Work only inside `private-ai-cloud`. Do not modify the sibling `twenty` repository, and do not copy Twenty code, styles, components, schemas, assets or product text. Use it only as an architectural reference.
- Change backend, database or provider code only within an explicit task that names that scope. Do not extend a task's scope on your own. Record out-of-scope findings as hardening debt instead.
- Do not add without a separate explicit task:
  - Docker;
  - end-user auth;
  - RAG;
  - real integrations;
  - HTTP routes or server actions that expose the runtime;
  - UI wiring to the backend;
  - new dependencies.
- Never make real LLM or provider network calls in tests or harnesses. Use the deterministic mock provider or the real adapter with an injected fake SDK.
- Keep Product Blueprint alignment across Dashboard, Knowledge Base, RAG Chat, AI Departments, Workflows, Approvals, Reports, Settings and Roadmap.

### Security invariants (must never regress)

- **Approval-first, locked by default.** Publish, send, run, integration, code acceptance and merge flows need an explicit human approval. External actions stay locked by default.
- **Fail closed.** When state is unknown or ambiguous, deny, return `recovery_required` or mark `outcome_unknown`. Never guess, auto-retry a provider dispatch, or report success.
- **Tenant isolation:**
  - The DB workspace ID comes only from the branded, frozen tenant produced by the trusted resolver. Never accept a caller-supplied workspace ID.
  - Every query filters by workspace, and cross-workspace references are rejected by DB constraints.
- **Authorization before reads.** Denied reads must be indistinguishable from missing objects and perform zero raw reads. Responses go out only through explicit public projections; internal fields never leave.
- **Budgets and dispatch:**
  - Reserve the budget before any provider spend.
  - Re-check lease, revision, pause, status, pinned model identity and budget under `FOR UPDATE` in the provider-start fence.
  - Ambiguous outcomes hold the budget, and there is never a second dispatch.
- **Idempotency.** An exact replay is idempotent, and the same key with a changed payload is a conflict.
- **Audit completeness.** State changes and their audit events commit in the same transaction. A contradictory audit record is rejected, never ignored.
- **No secret leakage.** `DATABASE_URL`, credentials, SQL text and raw driver or provider errors never appear in responses, error messages, logs or audit metadata.

### Database rules

- Migrations are append-only (`db/migrations/NNNN_*.sql`). Never edit an applied migration; add a new one.
- Use the transaction helpers. A pooled session may be reused **only** after every statement succeeded, or after a failure followed by a **successful** ROLLBACK. Destroy it (`release(true)`) after:
  - a failed BEGIN;
  - an attempted COMMIT that did not succeed;
  - a failed ROLLBACK;
  - any non-SQLSTATE or connection-class error.
- Never add a node-postgres client-side `query_timeout`. Use server-side `statement_timeout`. Session options (`options`, `idle_in_transaction_session_timeout`, `client_connection_check_interval`) belong to `lib/db/postgres.ts` only.
- Never await provider, network or other slow non-DB work inside an open transaction. Sessions idle in a transaction for more than 30 s are terminated.
- Do not introduce session-local state: `SET`, `LISTEN`, `PREPARE`, advisory locks or temp tables.
- Never acquire a second pooled connection while holding one inside a transaction.

### Verification (run all before reporting done)

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `git diff --check`

Never weaken, skip or delete an existing test to make a change pass. For a bug fix, show that the new tests fail on the old code (RED) and pass on the fix (GREEN).

### Task and gate process

- **Fix or feature task:** implement, write a report (files changed, evidence, residual risk) and end with **READY FOR RE-GATE** or **NOT READY**. The author of a change never declares its own gate passed.
- **Gate task:** read-only review with attack harnesses. Change no production code, tests or migrations. End with an explicit **PASS** or **FAIL** verdict.
- A FAIL blocks the next stage until a corrective task lands and an independent re-gate passes.
- Harnesses and throwaway PostgreSQL clusters live outside the repo (for example `/tmp/...`). Stop and delete clusters when done. Copy final reports to `docs/qa/` when the Owner asks.

### Git

- Use Conventional Commits (`fix:`, `feat:`, `chore:`, `docs:`, `refactor:`), one focused commit per task unless the task says otherwise.
- Do not push unless the user explicitly asks.
