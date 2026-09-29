# Private AI Cloud — Development Roadmap

**Version:** v1.2  
**Date:** 2026-09-29  
**Status:** AUTHORITATIVE / CURRENT  
**Canonical source:** `docs/ROADMAP.md`

> This Markdown file is the source of truth for the Private AI Cloud development roadmap. PDF versions are generated snapshots for reading, sharing, and review. If a PDF or an older roadmap conflicts with `docs/ROADMAP.md`, this file takes precedence until the Owner approves a newer roadmap version.

## 1. Purpose and roadmap governance

Private AI Cloud is an AI Operations / Development Control Plane for Lemetti projects. Its goal is to evolve into an AI Development Operating System that can move through an approved product roadmap autonomously and stop only at predefined Owner approval gates, hard stops, or budget/risk limits.

The Owner defines product strategy and approves roadmap changes. Private AI Cloud plans and executes work within the approved scope, selects models/executors through replaceable contracts, performs QA/security verification, attempts bounded self-fix where policy allows, and escalates only when an Owner decision is required.

Roadmap changes are versioned. A strategic change must be represented as a Roadmap Change Request and requires Owner approval.

Important external actions remain separate approvals: accepting a result, allowing commit, allowing push, and allowing deploy are distinct decisions.

The development pipeline must not depend on one specific model, executor, or payment mechanism. API credits, subscription/CLI access, and self-hosted routes are implementation choices behind stable provider/backend contracts.

Security, tenant isolation, budgets, idempotency, audit, and recovery remain system invariants.

Development is milestone-driven. We do not close technical debt merely because it exists; debt is pulled forward when it blocks the next real product capability.

### 1.1 Source-of-truth rule

- `docs/ROADMAP.md` is the canonical roadmap.
- PDF is a generated snapshot, not the authoritative editable source.
- Execution status should be updated in the Markdown roadmap when a roadmap item is completed, activated, blocked, or materially re-scoped.
- A code/task commit should update roadmap status when the task changes the actual execution state of a roadmap item.
- Later, when the executable-roadmap subsystem exists, machine-readable roadmap state may be added alongside this document, but this Markdown remains the human-readable strategic source until the Owner approves a replacement governance model.

## 2. Target product model

Private AI Cloud is not a CRM and not merely a chat interface. It is a control plane for projects, AI capabilities, development workflows, approvals, budgets, audit, infrastructure, and later business-operation departments.

| Level | Entity | Purpose |
|---|---|---|
| 1 | Workspace | Organizational and tenant boundary |
| 2 | Project | Product/system, e.g. Smart Algorithms, Private Exchange |
| 3 | Department | Pluggable project capability module |
| 4 | Function / Workflow | Repeatable managed process |
| 5 | Agent | Role/executor with policies, tools, and permissions |
| 6 | Model | Model selected by routing/policy |
| 7 | Run | Concrete execution with cost, QA, approval, and audit lifecycle |

Global registries include Agent Registry, Model Registry, Provider Registry, Policies, Infrastructure, and Security.

### 2.1 Departments are extensible capability boundaries

Departments are not agents and are not required to become top-level navigation items. They are capability modules enabled per Project.

Core/early departments may include:

- Development
- Product
- QA

Future business departments may include:

- Marketing
- Sales
- Support
- Legal / Compliance
- Finance
- Operations
- other project-specific modules

Different Projects may enable different Departments. Smart Algorithms may need Development, Product, QA, Marketing, Sales, and Support; Private Exchange may additionally require Compliance/Legal and Operations.

This preserves the long-term company-operations vision without turning the first product version into an ERP/CRM-style interface.

## 3. Development entry modes

Private AI Cloud supports three equal entry modes into one development pipeline:

| Mode | When used | Result |
|---|---|---|
| Develop Feature | Owner requests a specific feature | A FeaturePlan enters the shared execution/QA/approval pipeline |
| Continue Roadmap | Project develops continuously from approved roadmap | Roadmap Planner selects the next ready work until a gate |
| Fix / Investigate | Bug, security issue, technical debt, incident, corrective work | Bounded corrective/investigation plan with the same verification rules |

Manual Feature, Fix/Investigate, Roadmap Planner, and future Telegram requests converge into one pipeline:

`Request → FeaturePlan → Policy & Budget → Execution Backend → QA & Security → Owner Approval`

FeaturePlan remains the execution-planning unit even when it is not directly shown in the simplified Owner UX.

## 4. Current development point

### Completed foundation

**AI-001…AI-036.7 — DONE**

- PostgreSQL foundation, migrations, tenant-aware persistence
- Workflow Runtime command lifecycle, claims, executions, approvals, invocation ledger
- ModelProvider abstraction and OpenAI adapter
- provider-start fencing
- model identity pinning
- token preflight
- aggregate and pre-spend budgets
- ambiguous provider outcome → `outcome_unknown` / recovery semantics
- authorization-safe read boundary
- tenant mapping and cross-workspace DB integrity
- audit collision protection
- one-snapshot Owner reads
- PostgreSQL pool/session hardening and adversarial re-gate

**AI-037 Technical Debt Census — DONE**

The census recorded the current hardening debt and moved development to milestone-driven prioritization. The nearest product objective is safe use of a real paid provider.

### Current AI-037 sequence

- **AI-037.0 Live PostgreSQL Regression Suite — DONE**
- **AI-037.1 HD-12 duplicate paid dispatch fail-safe — DONE**
- **AI-037.1.1 Minimal Owner Recovery — DONE**
- **AI-037.6a Provider timeout ≤ claim lease — DONE**
- **AI-037.4a Pool release guard + minimum metrics — DONE**
- **AI-037.1.2 Paid definitive failure fail-safe — IN REVIEW**
- **M1 Roadmap Review Gate — BLOCKED** pending independent re-gate (see §6)
- **Real Provider Gate — after M1 safety criteria pass**

AI-037.1.1 passed independent re-gate and was committed/pushed through the Owner-approved repository workflow.

## 5. Milestone map

| Milestone | Goal | Exit criterion |
|---|---|---|
| M1. Real Money Safety | Safely spend real money on model calls | No automatic duplicate paid dispatch; safe recovery path; timeout/lease guard; pool guard; minimum observability |
| M2. Real Provider | Connect a real model through provider abstraction | Real usage/cost/latency recorded; persistence failures do not silently create a second provider call |
| M3. Owner Product | Useful Projects-first Owner experience | Owner can understand projects, runs, approvals, blockers, cost and roadmap without tenant bypass |
| M4. Execution Platform | Replaceable coding executors + isolated execution | First backend works in production path; second backend proves portability without pipeline rewrite |
| M5. Roadmap Autonomy | System advances an executable roadmap | No manual “go next” between ordinary technical steps; Owner appears only at gates |
| M6. Automated Development | Feature → verified PR | Real Smart Algorithms feature passes the full automated pipeline |
| M7. Staging / Hardening | Production-like infrastructure | CI/CD, observability, TLS, backups, security and deployment gates |
| M8. Telegram Owner Control | Secure remote control | Roadmap/runs/approvals/commit/push controlled through the same Owner Control API |

## 6. M1 — Real Money Safety

Before autonomous development, a real model call must be payable, observable, and safe under database/connection failures.

### AI-037.0 — Live PostgreSQL Regression Suite — DONE

- permanent opt-in live PostgreSQL regression tests
- pool/session safety evidence
- HD-12 proofs
- tenant/snapshot/reconciliation evidence within task scope
- normal `npm test` remains DB-independent

### AI-037.1 — HD-12 duplicate paid dispatch fail-safe — DONE

If the provider has already run successfully but final state persistence is not confirmed, the execution does not become ordinary retryable failure.

Safe behavior:

`provider dispatched + final state not confirmed → outcome_unknown / recovery_required → automatic provider redispatch blocked`

### AI-037.1.1 — Minimal Owner Recovery — DONE

- local Owner-operated recovery for the narrow HD-12 case
- factual view of Run / Step / execution / invocation / budget / audit
- explicit Owner acknowledgement of lost-result and duplicate-cost risk before retry authorization
- recovery itself does not call the provider
- every recovery action is audited
- full reuse of the already returned provider output remains deferred to durable Step result recovery

### AI-037.6a — Provider timeout ≤ claim lease — DONE

Composition-time validation:

`provider timeout + safety margin <= claim lease`

Heartbeat/lease renewal remains deferred until there is evidence that a fixed lease is insufficient.

### AI-037.4a — Pool release guard + minimum metrics — DONE

- FATAL/PANIC → session-breaking
- reusable release only when transaction status is safe
- minimum counters/signals: DB failures, destroyed sessions, `recovery_required`, `outcome_unknown`, ambiguous commit, provider redispatch

### AI-037.1.2 — Paid definitive failure fail-safe — IN REVIEW

Owner-approved corrective (RCR-1) for the M1 blocker found by the M1 Roadmap Review Gate.

- a definitive failed provider result that may have cost money (not exactly 0 tokens and 0 cost), followed by lost final Step persistence, keeps the execution `outcome_unknown`; the next ordinary advance returns `recovery_required`
- free definitive failures (0 tokens, 0 cost) keep ordinary retry semantics
- the existing explicit Owner recovery also covers this state, with the same duplicate-cost acknowledgement; recovery never calls the provider
- direct reconstruction of the failed Step remains deferred to durable Step result recovery

### M1 Roadmap Review Gate — BLOCKED

Status: the author review found one M1 blocker. A **paid** definitive provider failure (for example an OpenAI `content_filter` result, which is billed) followed by lost final Step persistence left the execution `failed`, not `outcome_unknown`, so the next ordinary advance paid again for the same Step attempt without Owner action. The Owner approved the corrective as AI-037.1.2 (IN REVIEW). The gate stays BLOCKED until AI-037.1.2 passes independent re-gate; the independent reviewer decides the gate verdict.


After M1 passes, stop implementation briefly and review:

- whether the M2 scope is still the minimum required for a real paid provider
- whether newly discovered debt changes the Real Provider gate
- whether any deferred item became a blocker
- whether the next milestone should be re-ordered

M1 is timeboxed operationally rather than by a hard calendar promise. The Owner should set or refresh the target window while M1 is active; if the window is exceeded materially, roadmap review is mandatory before scope expansion.

## 7. M2 — Real Provider Gate

The first real provider route remains OpenAI unless the Owner changes the routing decision, because the abstraction and adapter already exist.

| Check | Requirement |
|---|---|
| Credentials | Server-side only; no logs/UI leakage |
| Identity | Provider/model/request identity pinned |
| Usage | Real input/output tokens and cost |
| Budget | Pre-spend reservation and aggregate windows |
| Timeout / retry | No hidden provider retries; SDK retries controlled |
| Failures | 429/5xx/network ambiguity classified and audited |
| Recovery | Persistence failure does not silently trigger a second model call |
| Observability | Latency, cost, failures, recovery-required and redispatch visible |

**M2 gate:** Private AI Cloud performs a real paid model invocation through the provider abstraction, records usage/cost/state correctly, and does not create an unapproved second provider call after persistence failure.

### M2 Roadmap Review Gate — REQUIRED

After the first real-provider capability is proven, review the entire M3–M8 roadmap before scaling implementation.

The review must answer:

- Which UI surfaces are now actually needed?
- Is AI-040a ready to automate the current human handoff loop?
- Which executor should become the first production backend?
- Which second backend is the best portability proof?
- Which deferred technical debt now blocks autonomy or staging?
- Are the planned roadmap hierarchy and navigation still appropriate?
- Has the business scope expanded to Marketing/Sales/Support enough to change Department priorities?

This gate prevents distant roadmap assumptions from turning into premature implementation obligations.

## 8. Early self-development vertical slice

### AI-040a — Local Developer Handoff — EARLY / PLANNED

AI-040 is split so Private AI Cloud can begin helping build itself before the full Owner UI and execution platform are complete.

Minimal local/CLI flow:

`Task Artifact → Selected Executor → Patch/Report → Verification Runner → Review Package → Owner decision`

Requirements:

- no automatic commit/push
- bounded repository/path access
- capture patch/report/test evidence
- lint/typecheck/tests/build/security verification where applicable
- output a stable review package consumable by the Owner/reviewer
- reuse existing FeaturePlan/policy/audit concepts where available; do not create a parallel development pipeline

AI-040a may start after the Real Provider gate or in parallel with early M3 work if its dependencies are satisfied.

### AI-040b — Owner UI Integration — LATER

Connect the same handoff pipeline to Projects/Runs/Approvals in the web UI. No duplicate workflow logic is created for the UI.

## 9. M3 — Owner Product / simplified first UI

The Owner experience remains Projects-first. The first working UI must expose decisions, projects, runs, approvals, blockers and cost without exposing every future subsystem as primary navigation.

### 9.1 Primary navigation — MVP

Initial top-level navigation:

- **Dashboard** — Today for Owner, blockers, approvals, costs, active projects/runs
- **Projects** — Smart Algorithms, Private Exchange and following products
- **Runs** — active/recent execution lifecycle and evidence
- **Approvals** — unified Owner decision queue
- **Settings** — workspace/platform configuration

If product testing shows that Runs is clearer inside Projects, the top-level navigation may reduce further to Dashboard / Projects / Approvals / Settings.

### 9.2 Capabilities remain, but are grouped

The following are retained as product capabilities, not necessarily as first-level navigation:

**Platform / Settings**
- Agents
- Models / Providers
- Workspace / Roles / Permissions
- Budgets / Limits
- Integrations

**Operations surfaces**
- QA / Evidence
- Infrastructure
- Security / Audit

**Dashboard/Project surfaces**
- Reports / Weekly Owner Report
- cost/blocker/recommendation summaries

The interface should expose complexity progressively instead of presenting every future capability at once.

### 9.3 Project workspace

Inside each Project:

- Overview
- Roadmap
- Runs
- Approvals
- Departments
- Knowledge
- Activity

Departments are project-specific and may later include Marketing, Sales, Support, Legal/Compliance, Finance and Operations without expanding global navigation.

### 9.4 Run Detail

Run Detail should show:

| Block | Content |
|---|---|
| Identity | Project, Feature, Run ID, Agent, Model, Executor |
| Lifecycle | Task → Plan → Execution → Tests → Security → Review → Approval → Commit → Push |
| Economics | Tokens, cost, limits, duration |
| Evidence | Patch, tests, build, security, live-DB gates, review |
| State | running / waiting_owner / recovery_required / completed / failed |
| Audit | who/what/when changed state |

### 9.5 Approval Center

- goal and requested action
- diff/stat and evidence
- tests/security results
- cost and risk
- separate approvals for result / commit / push / deploy
- missing or unauthorized objects remain opaque
- every decision is audit-logged

### AI-038 — Unified Owner Console — PLANNED

Mock UI may continue in parallel. Backend wiring is allowed only after the tenant/transport boundary is safe.

### AI-037.7 — Tenant-bound facade + pre-auth limits — REQUIRED FOR WIRING

- facade bound to resolved tenant
- workspace mismatch blocked before raw read
- pre-auth body/shape/resource limits
- Proxy rejection and cheap structural gate

### AI-039 — Development Workflow Browser — PLANNED

Owner creates Development Request and sees FeaturePlan, dependencies, risk, executor recommendation and verification plan before repository mutation.

## 10. Architecture Decomposition Gate

Before expansion of the execution layer, perform controlled backend decomposition. Backend architecture follows modular-monolith domain/application/infrastructure boundaries, not literal frontend FSD.

| Module | Responsibility |
|---|---|
| workflow-runtime | domain, application/use-cases, policies, contracts, postgres infrastructure |
| model-invocation | routing, provider identity, invocation lifecycle |
| budgets | reservations, windows, reconciliation |
| approvals | approval policy/lifecycle |
| audit | immutable event contracts and queries |
| tenants | workspace resolution and isolation |
| execution | execution backend contracts and worker lifecycle |
| providers | provider adapters |
| shared | DB adapter, observability, validation primitives |

Dependency rule:

`API/Handler → Application/Use Case → Domain/Policy → Repository Contract → Infrastructure`

Additional rules:

- new functionality must not endlessly enlarge central runtime files
- file/class >1000 lines requires decomposition review
- large mechanical refactors are not mixed with critical correctness fixes
- decomposition gate happens before AI-041/042 scale-up

## 11. M4 — Execution Platform

### AI-041.0 — Execution Backend Contract — PLANNED

Define the minimal stable contract required by the control plane. Do not design five implementations in advance.

The contract must keep FeaturePlan, policies, budgets, QA, approvals and audit independent from the chosen executor.

### AI-041.1 — First Production Backend — PLANNED

Implement exactly one real backend first: the executor actually used by the current development workflow at that time.

Current default candidate: **CodexBackend**, unless the M2 Roadmap Review Gate selects another first backend based on actual usage and access model.

Exit criterion: real tasks can run through the backend contract without a parallel special-case pipeline.

### AI-041.2 — Second Backend / Portability Proof — PLANNED

Add a second genuinely different backend only after the first one works. A likely candidate is **ClaudeCodeBackend**.

The second implementation is the proof that the abstraction is correct.

Portability gate:

- same FeaturePlan contract
- same policies/budgets
- same QA/evidence shape
- same Owner approvals/audit
- backend can switch without pipeline redesign

### Deferred backends

- QwenBackend — deferred until there is a real use case
- SelfHostedBackend — deferred until self-hosted inference is operationally justified

These remain architectural extension points, not near-term implementation obligations.

### Verification Runner is not an AI backend

`LocalRunner` is separated conceptually from coding-model backends.

Its role is controlled verification/execution such as:

- lint
- typecheck
- unit/integration tests
- build
- security checks
- local deterministic tools

It may later be used by multiple executor backends.

### AI-042 — Isolated Coding Worker — PLANNED

- isolated worktree
- repository/path allowlist
- restricted filesystem/network/secrets
- timeout, budget and changed-file limits
- artifacts and verification outputs returned to the control plane

## 12. Deferred debt before autonomy/staging

| Package | Purpose | Required by |
|---|---|---|
| AI-037.2 | Durable Step result; recovery without provider redispatch | Before autonomous worker / after design review |
| AI-037.3 | Ambiguous COMMIT reconciliation + general recovery tooling | Before autonomous worker / staging |
| AI-037.5 | TLS/config allowlist + startup validation | Before staging |
| AI-037.6b | Lease heartbeat / DB clock if needed | Before multi-instance/autonomy when evidence requires it |
| AI-037.8 | Durable admission control | Before autonomous worker / transport create-run |

## 13. M5 — Roadmap-Driven Autonomy

Target behavior: the Owner does not send “go next” after each ordinary task. The roadmap becomes an executable state machine. The system proceeds until an Owner gate, hard stop, or budget/risk limit.

### 13.1 Roadmap hierarchy — progressive, not mandatory complexity

The long-term model remains capable of representing:

`Project → Roadmap → Release → Milestone → Epic → Feature → FeaturePlan → Task`

But only the following are mandatory for the first usable roadmap/autonomy UX:

`Project → Milestone → Feature → Task`

Rules:

- `Release` is optional and introduced only when release planning needs it.
- `Epic` is optional and introduced only when Features need grouping at scale.
- `FeaturePlan` remains an internal execution-planning entity and does not have to be shown as a permanent Owner navigation level.
- The system must not require empty placeholder Release/Epic objects just to satisfy a theoretical hierarchy.

### AI-043.0 — Executable Product Roadmap Contract — PLANNED

Roadmap item metadata includes as needed:

- Goal / Scope / Non-goals
- Dependencies
- Acceptance criteria
- Risk / Priority
- Estimated cost
- Allowed agents/repos
- Required QA/security
- Approval policy
- Artifacts/evidence
- Version/change history

Statuses include:

`blocked, ready, planning, approved, running, verifying, waiting_owner, completed, failed, recovery_required`

### AI-043.1 — Roadmap Planner — PLANNED

- finds ready work from dependencies
- forms execution waves
- allows independent tasks to run in parallel
- never starts blocked items

### AI-043.2 — Continuous Development Controller — PLANNED

Durable PostgreSQL worker loop:

`ready work → FeaturePlan → policies → executor → verify → self-fix or Owner gate → update roadmap → next work`

Restart resumes from durable state.

### AI-043.3 — Approval Gate Engine — PLANNED

**AUTO** examples:
- lint/typecheck/tests
- repeat verification after corrective patch
- bounded self-fix inside approved scope
- ordinary QA/security checks

**OWNER APPROVAL** examples:
- architecture change
- scope/roadmap change
- budget/risk increase
- high-risk migration
- real provider/credential changes
- code acceptance
- commit
- push
- deploy

**HARD STOP** examples:
- tenant/security invariant broken
- budget corruption
- unknown state without safe recovery
- inconsistent repository/runtime state

### AI-043.4 — Autonomous Self-Fix Loop — PLANNED

`Code → tests/security → FAIL → AI Reviewer → Corrective Plan → Developer Agent → Patch → gates again`

Bounded by:

- max attempts
- max tokens/cost
- max duration
- max changed files
- risk ceiling

### AI-043.5 — Roadmap Owner UX — PLANNED

- milestone progress
- Current / Next / Blocked
- active agents/runs
- spend today / budget window
- Owner decisions required
- roadmap change requests with impact/cost/risk

## 14. M6 — Full Automated Development Run

### AI-044 — Task → Verified PR — PLANNED

Primary production proof:

`Smart Algorithms roadmap feature → FeaturePlan → task graph → execution backend → isolated worker → patch → QA/security → bounded self-fix until PASS → Owner approval → verified PR`

- Owner intervenes only at policy gates
- recoverable FAIL is automatically analyzed and may re-enter self-fix
- merge remains manual until separately approved
- after a successful Smart Algorithms case, Private Exchange becomes the second higher-risk production case

## 15. M7 — Staging / Hardening

### AI-045 — Production-like Infrastructure — PLANNED

- VPS/deployment environments
- Docker/containers where they improve reproducibility
- reverse proxy and TLS
- secrets management
- PostgreSQL backups and restore drill
- migrations gate
- CI/CD and deployment approvals
- health/readiness checks
- metrics and structured logs
- alerting
- rate limiting / WAF where appropriate
- worker/resource monitoring
- queue/backpressure
- security monitoring and incident evidence

Before staging, close the technical-debt packages that are actual staging blockers at that time.

## 16. M8 — Remote Owner Control through Telegram

Telegram does not get a separate backend or separate security rules. Web UI, Telegram and future clients use one Owner Control API, policies, approvals and audit.

### AI-046 — Owner Control Contract — PLANNED

Universal commands include:

- listProjects
- getProjectStatus
- listRuns / getRun
- createDevelopmentRun
- pause/cancel
- listApprovals / approve/reject
- requestRecovery
- getCosts
- roadmap status / roadmap change request

### AI-047 — Secure Telegram Bot — PLANNED

- whitelist/account binding/Owner role
- replay protection and rate limiting
- no arbitrary shell/SQL
- no secrets in messages
- every command/callback audit-logged

### AI-048 — Remote Roadmap / Run Control — PLANNED

Owner can create Development Run, select Project, inspect plan/risk/cost, approve execution, pause a project, or open evidence from a phone.

### AI-048.1 — Durable Owner Notifications — PLANNED

PostgreSQL outbox → worker → Telegram + Email.

Events include:

- Run started/completed/blocked
- approval required
- security gate failed
- budget limit/cost anomaly
- `recovery_required`
- PR ready
- roadmap change request

### AI-049 — Telegram Approvals — PLANNED

Use the same policy/audit contract as Web UI.

### AI-050 — Commit / Push Approvals — PLANNED

Code accepted ≠ commit allowed ≠ push allowed. Merge remains manual until separately changed by Owner decision.

### AI-051 — Telegram Hardening — PLANNED

- duplicate webhook/retries
- forged/expired callback
- wrong user/workspace
- Run changed after approval
- concurrent Web + Telegram decision
- bot token rotation
- notification durability
- audit completeness

## 17. Autonomy and Owner intervention model

| Event | Mode |
|---|---|
| Lint/typecheck/unit tests | AUTO |
| Repeat test after fix | AUTO |
| Bounded self-fix in approved scope | AUTO |
| QA/security verification | AUTO |
| New scope / roadmap change | OWNER APPROVAL |
| Architecture change | OWNER APPROVAL |
| Budget/risk ceiling increase | OWNER APPROVAL |
| High-risk migration | OWNER APPROVAL |
| Real provider / new credentials | OWNER APPROVAL |
| Code acceptance | OWNER APPROVAL |
| Commit | OWNER APPROVAL |
| Push | OWNER APPROVAL |
| Deploy | OWNER APPROVAL |
| Tenant/security invariant broken | HARD STOP |
| Unknown state without safe recovery | HARD STOP |

## 18. Execution order and parallelism

Roadmap does not imply strictly serial development. Parallel work is allowed only when dependencies and file/DB ownership do not create unsafe conflicts.

### Current critical line

`AI-037.0 DONE → AI-037.1 DONE → AI-037.1.1 DONE → AI-037.6a DONE → AI-037.4a DONE → AI-037.1.2 IN REVIEW → M1 Review Gate BLOCKED → Real Provider Gate → M2 Review Gate`

### Early development automation

`AI-040a` may begin after the Real Provider gate or in parallel with early M3 work when dependencies are satisfied.

### UI

AI-038 mock UI may proceed in parallel. Backend wiring only after AI-037.7.

### Execution platform

`Decomposition Gate → AI-041.0 → AI-041.1 → AI-041.2 portability proof → AI-042 → AI-043.* → AI-044`

Qwen and SelfHosted backends remain deferred until an actual product need appears.

### Store/recovery debt

AI-037.2/.3/.6b/.8 are pulled forward by autonomy/staging gates, not merely by numbering.

### Infrastructure

AI-045 follows a proven automated development case, unless an earlier deployment need is explicitly approved by the Owner.

### Remote control

`AI-046 → AI-047 → AI-048 → AI-048.1 → AI-049 → AI-050 → AI-051`

## 19. Milestone definitions of done

| Milestone | Definition of Done |
|---|---|
| Real Money Safety | No automatic duplicate paid dispatch; failure enters safe recovery; timeout/lease and pool lifecycle are safe; minimum observability exists |
| Real Provider | Real provider works through abstraction; usage/cost/audit are trustworthy |
| Owner Product | Projects-first interface exposes real runs/approvals/roadmap without tenant bypass and without unnecessary top-level complexity |
| Execution Platform | First executor works; second executor proves backend portability without pipeline redesign; worker is isolated |
| Roadmap Autonomy | System selects next ready work and does not require manual “go next” between normal technical steps |
| Automated Development | Real Smart Algorithms feature reaches verified PR |
| Staging | Production-like deployment with observability, backups, TLS, CI/CD and security gates |
| Telegram Owner | Owner safely manages roadmap/runs/approvals through the same control plane from mobile |

## 20. Final target state

The Owner defines or approves the product roadmap once. Private AI Cloud then plans and executes allowed work, selects an executor/model, manages budgets, performs QA/security, applies bounded recoverable self-fix, and continues through the roadmap. The Owner appears only at predefined approval gates, blockers, strategy changes, risk/budget escalation, and critical external actions.

The system must remain one managed process in which executors and payment methods can change without rebuilding the pipeline.

It must support both:

- autonomous Roadmap Mode
- manual Feature Mode
- Fix / Investigate mode

The key production proof remains a real Smart Algorithms feature moving from executable roadmap to verified PR. Private Exchange then becomes the second, higher-risk production proof.

## 21. Version management

| Field | Value |
|---|---|
| Document | Private AI Cloud Development Roadmap |
| Version | v1.2 |
| Status | Current / Authoritative |
| Canonical source | `docs/ROADMAP.md` |
| PDF | Generated snapshot only |
| Change control | New strategic version requires Owner approval |
| Priority | v1.2 supersedes roadmap v1.1 and earlier roadmap descriptions where they conflict |

### v1.2 change summary

- `docs/ROADMAP.md` becomes the canonical source of truth; PDF becomes a generated snapshot.
- v1.2 introduced repository-tracked execution status for the active AI-037 hardening sequence.
- Added mandatory Roadmap Review Gates after M1 and M2.
- Split AI-040 into early `AI-040a Local Developer Handoff` and later `AI-040b Owner UI Integration`.
- Simplified first Owner navigation to Dashboard / Projects / Runs / Approvals / Settings.
- Retained Marketing, Sales, Support, Legal, Finance and other future business capabilities as Project Departments rather than global primary navigation.
- AI-041 now builds one production backend first and uses the second implementation as the portability proof; Qwen/SelfHosted are deferred.
- LocalRunner is separated from AI executor backends and treated as a deterministic Verification Runner.
- Roadmap hierarchy remains extensible, but Release/Epic are optional and the initial Owner UX uses Project → Milestone → Feature → Task.
- Long-term architecture remains extensible; implementation complexity is paid only when the next product capability requires it.
