# AGENTS.md

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Private AI Cloud — rules for coding agents (Codex, Claude Code)

### Project state

- **Product role:** Private AI Cloud is a vendor-neutral AI Engineering Control Plane.
  - PAC owns the engineering process; executors own the internal agent execution.
  - Do not build PAC-owned generic agent loops, context compaction, sandboxes, or browser or subagent runtimes unless the roadmap explicitly calls for them.
  - Canonical roadmap: `docs/ROADMAP.md`. Document authority: `docs/README.md`. Treat v0.3/v0.4/v0.5 strategy documents as historical.
- **UI** (`app/`, `components/`): a prototype that is still mostly on mocked data. It has no transport to the runtime and no routes or server actions that call the runtime, and pages do not consume a session.
- **Auth:** Auth.js with GitHub as the only provider (AI-038.2a), wired to the server-only Owner identity boundary (`lib/auth/`, `lib/composition/*owner-read*`).
  - The only HTTP route is the Auth.js route `app/api/auth/[...nextauth]`. There is no business API.
  - The real GitHub OAuth smoke (AI-038.2b) is not complete.
- **Backend runtime layer** (server-only; no runtime business API is exposed):
  - `lib/contracts/`: domain contracts;
  - `lib/workflows/`: runtime service, authorized access facade, tenant facade, API;
  - `lib/providers/`: model provider adapters;
  - `lib/composition/`: server-only composition roots (real provider, Owner read, authenticated Owner read);
  - `lib/db/`: PostgreSQL store, read model, tenant resolver, `pg` adapter;
  - `db/migrations/`, `db/seeds/`: raw SQL, PostgreSQL 16.
- **Work is tracked as numbered tasks (`AI-0xx`).** Security-relevant stages pass an adversarial gate before the next stage starts (see "Task and gate process").

### Scope

- Work only inside `private-ai-cloud`. Do not modify the sibling `twenty` repository, and do not copy Twenty code, styles, components, schemas, assets or product text. Use it only as an architectural reference.
- Change backend, database or provider code only within an explicit task that names that scope. Do not extend a task's scope on your own. Record out-of-scope findings as hardening debt instead.
- Do not add or extend the following without a separate explicit task that authorizes it. One approved Auth.js route existing does not authorize more:
  - Docker;
  - end-user auth, or changes to the existing auth/session surface;
  - RAG;
  - real integrations, including executor or provider SDKs;
  - HTTP routes or server actions that expose the runtime;
  - UI wiring to the backend;
  - new dependencies.
- Automated tests and ordinary harnesses never make real LLM, provider, executor or OAuth network calls. They must use the deterministic mock provider, or the real adapter with an injected fake SDK.
- A real external call is allowed only in a separately scoped integration smoke task (for example AI-038.2b Real GitHub OAuth Smoke). That task must:
  - explicitly authorize that exact external integration smoke;
  - have Owner approval;
  - keep credentials outside git;
  - stay outside the automated test suite (`npm test`, `npm run test:pg`, CI);
  - sanitize logs and evidence (no secrets, tokens, cookies or raw provider errors);
  - perform only the bounded external action approved by the task.
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
