# Private AI Cloud — Development Roadmap

**Version:** v1.4\
**Date:** 2026-10-01\
**Status:** AUTHORITATIVE / CURRENT\
**Canonical source:** `docs/ROADMAP.md`

> This Markdown file is the source of truth for the Private AI Cloud development roadmap. PDF versions are generated snapshots for reading, sharing, and review. If a PDF or an older roadmap conflicts with `docs/ROADMAP.md`, this file takes precedence until the Owner approves a newer roadmap version.

## 1. Purpose and roadmap governance

**Private AI Cloud is a vendor-neutral AI Engineering Control Plane.** PAC owns the engineering process; executors own the internal agent execution mechanism. PAC is not a wrapper around OpenAI, Anthropic, Dots or any other vendor, and it does not become a universal proprietary agent runtime, a Codex/Claude Code/Dots clone, a generic think/tool/observe harness, or a universal cloud sandbox provider (see §1.2 and `docs/architecture/control-plane-architecture-v1.0.md`).

Private AI Cloud is an AI Operations / Development Control Plane for Lemetti projects. Its goal is to evolve into an AI Development Operating System that can move through an approved product roadmap autonomously and stop only at predefined Owner approval gates, hard stops, or budget/risk limits.

The Owner defines product strategy and approves roadmap changes. Private AI Cloud plans and executes work within the approved scope, selects models/executors through replaceable contracts, performs QA/security verification, attempts bounded self-fix where policy allows, and escalates only when an Owner decision is required.

Roadmap changes are versioned. A strategic change must be represented as a Roadmap Change Request and requires Owner approval.

Important external actions remain separate approvals: accepting a result, allowing commit, allowing push, and allowing deploy are distinct decisions.

The development pipeline must not depend on one specific model, executor, or payment mechanism. API credits, subscription/CLI access, and self-hosted routes are implementation choices behind stable provider/backend contracts.

`ModelProvider` and `ExecutorAdapter` are separate integration layers. `ModelProvider` serves direct, bounded model calls (classification, structured transformation, analysis, planning, review). `ExecutorAdapter` serves managed engineering/agent execution (repository work, coding, tool execution, managed agent sessions, patch production). They are not collapsed into one interface even when one vendor offers both. Executors may use API credentials, provider credits, provider-supported subscription sessions, or self-hosted routes behind the same `ExecutorAdapter` contract. Changing executor, authentication or payment mode must not change FeaturePlan, QA, approval, audit, artifact, or recovery semantics. (v1.3 called the executor layer `ExecutionBackend`; v1.4 renames the planned concept to `ExecutorAdapter`. No code for either exists yet.)

Security, tenant isolation, budgets, idempotency, audit, and recovery remain system invariants.

Development is milestone-driven. We do not close technical debt merely because it exists; debt is pulled forward when it blocks the next real product capability.

### 1.1 Source-of-truth rule

- `docs/ROADMAP.md` is the canonical roadmap.
- PDF is a generated snapshot, not the authoritative editable source.
- Execution status should be updated in the Markdown roadmap when a roadmap item is completed, activated, blocked, or materially re-scoped.
- A code/task commit should update roadmap status when the task changes the actual execution state of a roadmap item.
- Later, when the executable-roadmap subsystem exists, machine-readable roadmap state may be added alongside this document, but this Markdown remains the human-readable strategic source until the Owner approves a replacement governance model.
- `docs/README.md` classifies every document as current, supporting, historical or QA evidence. Older strategic documents (v0.3 / v0.4 / v0.5, ADR-001 copy) are historical; where they conflict with this roadmap, this roadmap wins.
- The v1.4 decision record is `docs/ROADMAP_REBASE_V1.4.md`.

### 1.2 PAC-owned vs provider-owned (v1.4)

Target pipeline:

`Product Intent → FeaturePlan → Admission Policy → Task Graph → Executor Router → ExecutorAdapter (OpenAI / Anthropic / other) → Normalized Artifacts → Quality Gate → Security Gate → Corrective Loop → Human Approval → GitHub / PR → Production`

| PAC-owned (strategic, kept and strengthened) | Provider/executor-owned (not rebuilt by PAC) |
|---|---|
| Product Intent, FeaturePlan, Task Graph / waves | model inference and internal reasoning |
| Admission Policy (ALLOW / REQUIRE_APPROVAL / DENY) | agent tool loop (think → tool → observe) |
| Executor Router, Model Router | provider-native context management and compaction |
| Quality Gate, Security Policy, Security Gate | provider-native subagents |
| Corrective Controller (bounded corrective loop) | hosted sandbox implementation |
| Human Approval (result ≠ commit ≠ push ≠ deploy) | computer/browser execution |
| Audit / Evidence, cost/usage normalization | provider-native trace internals |
| Observability normalization | provider-specific retry/session mechanics |
| Project Knowledge, GitHub governance | specialized managed security research internals |
| Tenant / RBAC, secrets policy, budgets, idempotency, recovery | |

Shared boundary: `ExecutorAdapter`, normalized events, artifacts, usage, evidence, capabilities, execution-environment reference. Provider-specific SDK types never cross above the adapter boundary.

Removed from future PAC-owned scope in v1.4 (see §11, "Removed from PAC-owned scope"): generic agent loop, generic context compaction, mandatory own cloud sandbox / coding worker, generic browser/computer-use runtime, generic subagent runtime, proprietary replacement for managed security research.

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

`Request → FeaturePlan → Admission Policy & Budget → Executor Router → ExecutorAdapter → Quality & Security Gates → Corrective Loop → Owner Approval`

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
- **AI-037.1.2 Paid definitive failure fail-safe — DONE**
- **M1 Roadmap Review Gate — DONE**
- **Real Provider Gate — IN REVIEW** (M2.0 DONE, M2.1 DONE; M2.2 DEFERRED BY OWNER; M2 not done — see §7)
- **AI-037.7 Tenant-bound facade + pre-auth limits — DONE** (commit `50aeffb`; see §9)
- **AI-038.0 Owner Read Backend Bundle — DONE** (commit `ff6eac0`; see §9)
- **AI-038.1 Identity/Auth Boundary — DONE** (commit `a9f2435`; see §9)
- **AI-038.2a Auth.js GitHub Session Adapter — DONE** (commit `4e76afd`; see §9)
- **AI-038.2b Real GitHub OAuth Smoke — DONE** (commit `12212ad`; passed independent re-gate; **AI-038.2 DONE**; see §9)
- **AI-038.3 Owner Console Real Read Wiring + Mission Control UI Foundation — DONE** (commit `70f4039`; passed independent re-gate; see §9)
- **AI-038.3.1 Trusted Project Registry + Run Discovery Foundation — DONE** (commit `d7d1ca0`; passed independent re-gate; see §9)
- **AI-038.3.2 Trusted Project Context Routing + All Projects + Real Project Switcher — DONE** (commit `50cfed1`; passed independent re-gate; see §9)
- **AI-038.4 Owner Tasks — DONE**: **AI-038.4a Project Task Foundation + Read Surfaces — DONE** (`4a55f5b`); **AI-038.4b Quick Create + audited Task Mutation Binding — DONE** (`60b563b`) (see §9)
- **AI-038.5 Mission Control Visual Refinement — DONE** (`c7d9b26`)
- **AI-038.6 RU/EN Owner Console Localization — DONE** (`5af9f50`)
- **AI-038.7 Dynamic Ambient Shader Background — DONE** (`4cb0dc0`)
- **AI-039 Development Workflow Browser — DONE** (`b0e0bb8`)
- **AI-039.1 Ledger-backed AI FeaturePlan Planning — DONE** (see §9). Direct API-key live smoke deferred by Owner until API billing is available; no real paid call has been made, and M2.2 remains DEFERRED BY OWNER.
- **AI-039.2 ChatGPT Plan Access — IN PROGRESS** (Phase A connection implemented; eligibility checkpoint pending; see §9)
- **Roadmap Rebase v1.4 — vendor-neutral control plane — documentation only** (this version; `docs/ROADMAP_REBASE_V1.4.md`)

AI-037.1.1 passed independent re-gate and was committed/pushed through the Owner-approved repository workflow.

M1 Real Money Safety is DONE. The M1 Roadmap Review Gate first found one blocker (F-1: a paid definitive provider failure plus lost final persistence could be dispatched again without Owner action). The Owner approved the corrective (RCR-1 / AI-037.1.2), implemented in commit `27a1f6d`, which passed independent re-gate.

## 5. Milestone map

| Milestone | Status (v1.4) | Goal | Exit criterion |
|---|---|---|---|
| M1. Real Money Safety | DONE | Safely spend real money on model calls | No automatic duplicate paid dispatch; safe recovery path; timeout/lease guard; pool guard; minimum observability |
| M2. Direct Model Provider Capability | IN REVIEW (M2.2 deferred by Owner) | Connect a real model through the `ModelProvider` abstraction | Real usage/cost/latency recorded; persistence failures do not silently create a second provider call |
| M3. Owner Product | ACTIVE | Useful Projects-first Owner experience | Owner can understand projects, runs, approvals, blockers, cost and roadmap without tenant bypass |
| M4. Vendor-Neutral Executor Platform | REBASED in v1.4 | Replaceable managed executors behind `ExecutorAdapter`, routed by `ExecutorRouter`, over an `ExecutionEnvironment` abstraction | First executor works in the production path; a second, different executor proves portability without pipeline change |
| M5. Roadmap-Driven Autonomy | REBASED in v1.4 | Deterministic control-plane controller advances an executable roadmap through executors (no PAC-owned generic agent loop) | No manual “go next” between ordinary technical steps; Owner appears only at gates |
| M6. Automated Engineering Proof | PLANNED | Real Smart Algorithms feature → verified PR | Full pipeline passes; switching executor needs no pipeline change |
| M7. Staging / Hardening | PLANNED (REBASED) | Production-like control-plane infrastructure | CI/CD, observability, TLS, backups, security and deployment gates |
| M8. Remote Owner Control | PLANNED | Secure remote control (Telegram first) | Roadmap/runs/approvals/commit/push controlled through the same Owner Control API |

## 6. M1 — Real Money Safety — DONE

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

### AI-037.1.2 — Paid definitive failure fail-safe — DONE

Owner-approved corrective (RCR-1) for the M1 blocker F-1; commit `27a1f6d`.

- potentially billable failed provider result + lost final persistence → `outcome_unknown` → ordinary redispatch blocked
- retry requires explicit Owner duplicate-cost acknowledgement
- exact free (0 tokens, 0 cost) definitive failures keep ordinary retry behavior

### M1 Roadmap Review Gate — DONE

Outcome:

- the original F-1 blocker is resolved by AI-037.1.2, which passed independent re-gate
- AI-037.2 / .3 / .5 / .6b / .8 remain deferred (§12); none is required before the first controlled M2 real-provider call
- AI-037.5 becomes mandatory earlier only if PostgreSQL for M2 is non-loopback

The gate reviewed:

- whether the M2 scope is still the minimum required for a real paid provider
- whether newly discovered debt changes the Real Provider gate
- whether any deferred item became a blocker
- whether the next milestone should be re-ordered

M1 is timeboxed operationally rather than by a hard calendar promise. The Owner should set or refresh the target window while M1 is active; if the window is exceeded materially, roadmap review is mandatory before scope expansion.

## 7. M2 — Direct Model Provider Capability (Real Provider Gate)

The first real provider route remains OpenAI unless the Owner changes the routing decision, because the abstraction and adapter already exist.

Status: IN REVIEW. M2 is NOT DONE; the M2 Roadmap Review Gate is not complete.

- **M2.0 — DONE.** Real-provider composition root and local runner.
- **M2.1 — DONE.** Fake OpenAI SDK below the real adapter, against live PostgreSQL.
- **M2.2 — DEFERRED BY OWNER**, awaiting intentional API billing activation. This is commercial/API sequencing, not a technical blocker in M2.0/M2.1. No real provider call has been made. When API use becomes useful, provider routes will be tested intentionally under their proper gates. Before the one Owner-approved paid call, the Owner verifies the configured model prices against the provider's current pricing and confirms that the provider-reported input tokens equal the preflight count.

M2 proves the direct API-backed `ModelProvider` path. Managed executors (OpenAI Agents API, Claude Code, others) and subscription-backed **executor** access are an `ExecutorAdapter` concern in M4 and do not replace the M2 real-provider proof. Subscription-backed **bounded model** access (ChatGPT plan via Sign in with ChatGPT) is a `ModelProvider` concern, implemented by AI-039.2; it does not replace or complete the M2 API-key gate. v1.4 does not change M2 scope.

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
- Is OpenAI Agents API still the right first managed executor (AI-041.1), given its status at that time?
- Which access/payment modes are factually available for that executor at implementation time: subscription session, API key/provider credits, or self-hosted?
- Which second executor is the best portability proof (default candidate: Claude Code)?
- Which deferred technical debt now blocks autonomy or staging?
- Are the planned roadmap hierarchy and navigation still appropriate?
- Has the business scope expanded to Marketing/Sales/Support enough to change Department priorities?

This gate prevents distant roadmap assumptions from turning into premature implementation obligations.

## 8. Early self-development vertical slice

### AI-040a — Local Developer Handoff — EARLY / PLANNED

AI-040 is split so Private AI Cloud can begin helping build itself before the full Owner UI and execution platform are complete.

Minimal local/CLI flow:

`Task Artifact → Selected Executor → Patch/Report → Verification Runner → Review Package → Owner decision`

v1.4: the selected executor is reached through the same `ExecutorAdapter` concept as M4 once AI-041.0 exists; until then AI-040a may use the current human-operated executor handoff. AI-040a must not build a PAC-owned agent loop or sandbox.

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

### AI-038 — Unified Owner Console — PLANNED (active M3 umbrella; not DONE)

Mock UI may continue in parallel. Backend wiring is allowed only after the tenant/transport boundary is safe.

#### AI-038.0 — Owner Read Backend Bundle — DONE

Passed independent re-gate; commit `ff6eac0`.

- server-only Owner read bundle (`lib/composition/owner-read-runtime.server.ts`)
- workspace and Owner principal fixed during trusted composition
- the caller can pass only `runId` / `limit`; four read operations only; no write or command surface
- live tenant isolation passed
- no authentication was implemented in AI-038.0

#### AI-038.1 — Identity/Auth Boundary — DONE

Passed independent re-gate; commit `a9f2435`.

- a provider-neutral `AuthenticatedIdentitySource` exists; identity is request-scoped
- PAC verifies the active internal user, active membership in the configured tenant, and the factual Owner role in that tenant
- user, membership and role revocation applies on the next request
- the browser cannot claim a user, workspace or role
- no concrete authentication existed in AI-038.1

#### AI-038.2 — Concrete Owner Session Adapter — DONE

Decomposed as follows.

##### AI-038.2a — Auth.js GitHub Session Adapter — DONE

Passed independent re-gate; commit `4e76afd`.

- Auth.js (`next-auth` pinned `5.0.0-beta.32`) with GitHub as the only provider, stateless JWT sessions, and no Auth.js database adapter or Auth.js-owned tables
- migration `0008_auth_identities`: provider + stable provider account subject → existing PAC user; revocable (`active` / `disabled` / delete); no email mapping, no auto-provisioning, nothing seeded
- the session and JWT carry only `{ provider, providerSubject }`; OAuth tokens, email, login and the Auth.js user id are never copied
- the concrete identity source returns only `{ userId }` to AI-038.1, which still decides membership and the Owner role per tenant
- one authentication HTTP surface (`app/api/auth/[...nextauth]`); no proxy/middleware, no business API, no UI wiring

##### AI-038.2b — Real GitHub OAuth Smoke — DONE

Passed independent re-gate; commit `12212ad`.

The author-side real external smoke ran on 2026-10-01 under the AGENTS.md exception for Owner-approved external smokes:
- a local GitHub OAuth App, with credentials kept outside git;
- a throwaway PostgreSQL 16 database;
- a temporary local proof route, deleted afterwards.

No production code changed. It awaits independent re-gate. Author-side results:
- a real GitHub sign-in and callback produced an Auth.js JWT session carrying only `pacIdentity { provider, providerSubject }`;
- with no `auth_identities` row, PAC denied (`unauthenticated`);
- a temporary mapping from the factual subject to the seeded Owner enabled the real request-scoped `auth()` → AI-038.1 → AI-038.0 path, and one real `getRunOverview` read succeeded;
- on the same live GitHub session, disabling or deleting the mapping denied, and disabling membership or removing the Owner role denied (`unavailable`); restoring state restored access, with no restart and no re-login;
- caller-supplied workspace, actor, role and user claims were ignored, and a foreign-tenant run stayed invisible;
- a real sign-out removed the session cookie, and later requests were denied;
- after an Owner-reported local exposure of a session cookie, `AUTH_SECRET` was rotated, which invalidates every earlier JWT. A fresh real sign-in then succeeded. The public `/api/auth/session` contained exactly `expires` and `pacIdentity { provider, providerSubject }`, and sign-out removed both the identity and the session cookie.

Findings:
- Server-side `auth()` in `next-auth` v5 adds `user` = the decoded JWT, which holds only `pacIdentity`. The public `/api/auth/session` does not include it, and the identity adapter ignores it.
- With stateless JWT, sign-out does not revoke an issued token. A leaked token stays valid until expiry or `AUTH_SECRET` rotation, while PAC authorization (mapping, membership, role) remains revocable per request.

AI-038.2 is DONE: both AI-038.2a and AI-038.2b passed independent re-gate.

**UI → real private runtime data** was locked until AI-038.2 passed (intentional fail-closed sequencing). It is now unlocked **for read-only wiring only**, through AI-038.3. Writes still require a separate, explicitly approved write boundary.

#### AI-038.3 — Owner Console Real Read Wiring + Mission Control UI Foundation — DONE

Passed independent re-gate; commit `70f4039`.

- **Read path:** a server-only Owner Console loader (`lib/composition/owner-console-read.server.ts`) → `createRequestOwnerReadRuntime` (real Auth.js `auth()` → AI-038.1 → AI-038.0) → PostgreSQL. The workspace comes only from trusted server configuration. No business HTTP API, no Server Action, no write.
- **Real data:**
  - the Dashboard (attention metrics, approval queue, approval-linked runs);
  - Approvals (read-only queue, no decision controls);
  - Runs (approval-linked runs only; global run discovery is not connected);
  - Run Detail (overview, steps, approval, usage/cost, audit);
  - Projects (the current trusted project only).
- **Mission Control shell:** Projects-first navigation, a top bar with a project switcher that shows only the trusted current project, a real pending-approval indicator and an Owner state. Fonts stay Geist / Geist Mono.
- **Not included:** global `listRuns`, a trusted multi-project registry, task creation, approve/reject, and the full My Attention / Tasks UX.
- **Owner visual checkpoint: ACCEPTED** as the UX foundation (Projects-first, Owner-attention-first, task/run-centric). Visual refinement is deferred to AI-038.5.

#### AI-038.3.1 — Trusted Project Registry + Run Discovery Foundation — DONE

Passed independent re-gate (including the run-snapshot consistency corrective); commit `d7d1ca0`. Backend and read foundation only.

- **Model:** Workspace (tenant / security boundary) → Project (a product/system inside it) → Runs. A Project is not a folder, checkout, VPS directory, executor session, environment or branch.
  - Git repositories are the canonical code source; PAC is the control plane.
  - Managed executors, VPS runners and the Local Runner are execution environments.
  - Local Mac folders and VPS checkouts are temporary working copies.
  - The same Project ID works wherever execution happens.
- **Registry:** migration `0009_project_registry` adds `projects`: workspace-scoped `project_key` (the Owner-facing Project ID, same stable-id rule as `workflow_runs.project_id`), display name, `active` / `paused` / `archived`, and optional non-secret HTTPS `repository_url` + `default_branch`.
  - Strict CHECK constraints reject credentials, query strings, fragments, ssh/file URLs and local paths.
  - It stores no filesystem path, no executor/environment/deployment policy and no secrets profile. Those wait for the typed M4 contracts (AI-041 / AI-042).
  - Nothing is seeded.
- **Owner reads:** `listProjects(limit?)` returns active and paused projects; archived ones are excluded. `listRuns(projectId, limit?)` is one bounded statement scoped by workspace AND project, newest first.
  - Both go through AI-038.1 → AI-038.0 → the tenant facade → authorized access, with new read actions `list_projects` / `list_project_runs`.
  - `projectId` is an untrusted selector resolved only inside the already-authorized workspace. An unknown, foreign, archived or malformed project gives the same opaque `unavailable`.
- **Not included:** UI project switching (AI-038.3.2), repository clone/checkout, GitHub API, project writes/onboarding, and a foreign key from `workflow_runs.project_id` to the registry (hardening debt: existing runtime rows have no factual registry backfill).

#### AI-038.3.2 — Trusted Project Context Routing + All Projects + Real Project Switcher — DONE

Passed independent re-gate; commit `50cfed1`. Owner-approved model:
- **All Projects is the default scope.** It is the absence of a `?project=` selector: a UI/query scope, not a registry row. `/dashboard` is the global Mission Control home.
- **Real Project Switcher** (All Projects + the authenticated `listProjects()` results) switches PROJECT context only and stays on the same major page. Dashboard, Runs and Approvals become project-scoped, and sidebar navigation preserves the selected project.
- **Selector validation:** `?project=` is an untrusted selector. It is honoured only if the structure is valid **and** the authenticated registry of the trusted workspace lists it. Malformed, duplicate, unknown, foreign and archived values all give one opaque "Project unavailable" and never fall back to All Projects. The workspace still comes only from trusted server configuration; there is no cookie or storage authority.
- **Dashboard:** global (projects, workspace approvals, active work across projects, per-project activity) or per project (identity, repository, runs, project approvals).
- **Runs:** global bounded aggregation over registry projects via `listRuns` (application fan-out, documented bounds) or per project.
- **Approvals:** the workspace queue, or per project classified by the factual run project (`listRuns` membership + bounded `getRunOverview`); unresolved approvals are never assigned.
- **Bell:** the top-bar approval bell stays workspace-global.
- **Run Detail:** never presents a run under a selected project it does not factually belong to.
- **Tasks** do not exist yet: current work is shown as Runs.

#### AI-038.4 — Owner Tasks — DONE

Split so that task persistence/read semantics and the first task write boundary are never introduced in one security-sensitive change.

##### AI-038.4a — Project Task Foundation + Read Surfaces — DONE (`4a55f5b`)

Implemented with corrective and passed the independent re-gate (committed `4a55f5b`). The application UI is read-only; the only writes are the narrow server-side mutation contract below, which has no UI, route or Server Action.

- **Model:** a persistent **ProjectTask** (`project_tasks`, migration `0010`) is the Owner objective ("what needs to be done"). It is distinct from the FeaturePlan `DevelopmentTask` (an in-memory node inside a FeaturePlan; FeaturePlan persistence and linking stay deferred).
- **Identity and lifecycle:**
  - stable public `task_key` (unique per workspace; the uuid is internal);
  - type `feature` / `fix` / `investigation` / `roadmap`;
  - a 12-state lifecycle (draft; active: ready, planning, approved, running, verifying; attention: waiting_owner, blocked, recovery_required, failed; terminal: completed, cancelled);
  - nullable P0–P4 priority and low–critical risk (never defaulted);
  - `completed ⇔ completed_at`.

  Task status is persisted task state, never derived from runs.
- **Integrity:** every task belongs to one registered project of the same workspace (composite FK). **Task ↔ Run** (`project_task_runs`): 0..N runs per task, a run linked to at most one task, and the same workspace and project enforced by composite FKs on both sides.
- **Reads:** `OwnerReadBackend.listTasks(view)`, `listProjectTasks(projectId, view)` and `getTask(taskId)`. Each is one bounded SQL statement, gated by the Project Registry (archived projects are undiscoverable), with linked runs snapshot-validated.
- **Owner Console:**
  - Tasks, Task Detail and a factual Task Result (aggregation only, no agent report);
  - My Attention (attention-status tasks + pending approvals, project-narrowed via the AI-038.3.2 classification);
  - Recently Completed (by the task's `completed_at`);
  - Dashboard Current Tasks, global and per project.

  Runs stay runs (attempts). `+ New Task` stays disabled.
- **Task mutation contract (corrective):** `lib/tasks/owner-task-mutations.ts`, kept separate from `OwnerReadBackend`. It is server-side only, with no UI, route or Server Action binding.
  - `createTask` (authenticated active Owner → trusted workspace → active project):
    - one transaction; Owner authority and project rows held `FOR SHARE` until commit, so a concurrent pause or archive cannot slip through;
    - the server generates the task ID, and the task starts as `draft`;
    - `creation_idempotency_key` + immutable intent fingerprint: same key and same intent → the same task; same key and any changed intent → generic conflict.
  - `attachRun`:
    - same-tenant, same-project run, with canonical snapshot validation before linking; a corrupted column or snapshot fails closed;
    - the same task again → idempotent success; a run owned by another task → conflict.
  - Exactly one `task.created` / `task.run_attached` audit event, written in the same transaction; DB unique indexes on links, keys and task audits are the last race guards.
  - No run start, model, executor or GitHub action.

##### AI-038.4b — Quick Create + audited Task Mutation Binding — DONE (`60b563b`)

Implemented and passed the independent re-gate (committed `60b563b`). It is the first Owner-facing task write: Quick Create wired to the AI-038.4a `createTask` contract. No new mutation engine and no schema change (0010 is immutable). It creates task **intent** only and must NOT automatically execute a run, call a model or an executor, mutate GitHub, commit, push or deploy.

- **Path:** `+ New Task` (top bar, project-scoped when a project is selected) → `/tasks/new` → `"use server"` action `app/tasks/new/actions.ts` → server-only `lib/composition/owner-task-create.server.ts` (real Auth.js `auth()`, trusted `APP_DEMO_WORKSPACE_SLUG`, per-request pool) → `lib/composition/owner-task-create.ts`.
  - That module is the only importer of `owner-task-mutations`, and it exposes `createTask` only.
  - It calls the AI-038.4a `createTask` (transaction, Owner and project locks, audit).
- **Form:**
  - fields: project, title, goal, type, priority, risk;
  - any other field (task ID, workspace, actor, status, run, …) → `invalid_input`;
  - only **active** projects are offered: All Projects shows a selector; a project context preselects; a paused project shows "creation unavailable"; archived or unknown selectors keep the opaque state;
  - the backend re-checks everything.
- **Idempotency:**
  - the server issues one opaque CSPRNG key per rendered form (hidden field, never in the URL, the audit or a projection);
  - retries and double submits of that form replay to the same task;
  - a changed intent with the same key → generic conflict;
  - the pending-disabled button is only UX.
- **Outcome:**
  - created / replayed → redirect to the factual Task Detail (`/tasks/<taskId>?project=<projectId>`), read again through the existing read path;
  - otherwise a generic `invalid_input` / `conflict` / `unavailable` / `unauthenticated` message.
- `attachRun` stays unbound (no UI, action or route). Task ↔ Run binding is for a later orchestrator task (AI-040+).

#### AI-038.5 — Mission Control Visual Refinement — DONE (`c7d9b26`; deferred from the AI-038.3 Owner checkpoint)

Implemented, accepted by the Owner and passed the independent re-gate (committed `c7d9b26`). The AI-038.3 foundation is accepted but less refined than the approved Mission Control reference. Scope:
- a stronger Mission Control character and a more distinctive panel hierarchy;
- tighter premium typography and spacing, and a better information-density rhythm;
- telemetry- or instrument-like presentation where useful, and less of a generic card-grid feel;
- a refined sidebar and top bar, and a stronger visual hierarchy for operational status;
- restrained custom iconography, and polished hover, focus and selected states;
- desktop composition at 1440, 1728 and 1920 px.

This is visual work only: no new data capability, write action or API.

Implementation notes:
- refined tokens, a global focus-visible ring, and shared panel / table / instrument primitives;
- one semantic status-tone map (neutral / active / success / attention / danger / muted) for task, run, project, approval and risk badges;
- control-plane sidebar and top bar (workspace context, project context selector, workspace-global approval indicators, `+ New Task`, session);
- an attention-first Dashboard instrument strip; My Attention grouped by severity; inspection-style Task and Run detail; grouped Quick Create form;
- every value is existing factual read data; there is no new telemetry.

#### AI-038.6 — RU/EN Owner Console Localization — DONE (`5af9f50`)

Implemented and passed the independent re-gate (committed `5af9f50`). This is presentation only: no domain, storage, auth, routing or write-semantics change.

- **Locales:** `ru` (default) and `en` only.
  - The `pac_locale` cookie holds exactly `ru` / `en` (Path=/, SameSite=Lax, ~1 year, Secure on HTTPS, not HttpOnly).
  - Anything else falls back to `ru`.
  - No locale routing (`/ru/...`), no locale query, no browser-language detection.
- **Resolution:**
  - `lib/i18n/locale.server.ts` is the one canonical server-side resolver (`cookies()`, cached per request);
  - `<html lang>` follows it;
  - Geist / Geist Mono request the `cyrillic` subset.
- **Dictionaries** (`lib/i18n/messages.ts`):
  - typed RU / EN with exact key parity and no per-key fallback;
  - exhaustive label maps for task / run / approval / project status, risk, task type, capability and model-invocation status;
  - domain values stay canonical English tokens; identifiers, stored content and brand names are never translated.
  - Prototype Roadmap / Settings copy is mirrored 1:1 in `lib/i18n/prototype-content.ts`.
- **Switcher:**
  - a small client component `components/shell/locale-switcher.tsx` in the top bar, just before the account block (`🇷🇺 RU` / `🇬🇧 EN`);
  - it writes only the cookie and calls `router.refresh()`, so the path and `?project=` context are unchanged;
  - no route, Server Action or DB write.
- **The locale never takes part in** auth, tenancy, Project Registry trust, reads, Quick Create payload / idempotency, audit or approvals.
- **Corrective L10N-1:** every human-facing `app/**/page.tsx` is covered by a test-enforced inventory: Owner pages, prototype pages via `lib/i18n/prototype-{pages,mock,content}.ts`, and Russian-native simulators with their English remnants localized. Internal links from localized pages (for example Settings → `/knowledge`) reach only covered routes.

#### AI-038.7 — Dynamic Ambient Shader Background — DONE (`4cb0dc0`)

Implemented, accepted by the Owner and passed the independent re-gate (committed `4cb0dc0`). Visual-only Mission Control refinement: no product, runtime, data or i18n semantics.

- **Renderer:** a native WebGL 1 ambient shader (`components/shell/ambient-renderer.ts`, no library) behind one small prop-less client component (`components/shell/ambient-shader-background.tsx`). `AppShell` stays a Server Component.
- **Look:** a fluid luminous band that bends, widens and narrows through the middle-lower viewport over a deeper ocean / teal field, inspired by the React Bits HeroBand motion (own shader, not a copy). PAC palette only; no status colors.
- **Fallback:** the AI-038.5 CSS ambient mesh stays the server-rendered background. It is used before hydration, without (hardware) WebGL, on shader compile / link failure and after a context loss (until reload). While the shader runs, the mesh fades out and its animations pause, so there is one moving layer. The static haze / vignette stays above both.
- **Lifecycle / performance:**
  - ~30 FPS cap on requestAnimationFrame;
  - drawing buffer at 1 pixel per CSS pixel (DPR 1);
  - resize only on real size changes;
  - paused in hidden tabs, resuming without a time jump;
  - under `prefers-reduced-motion` the shader never starts (static CSS frame);
  - no pointer interaction;
  - full cleanup on unmount.
- **Never** a telemetry signal: the shader receives only size and time.

### AI-037.7 — Tenant-bound facade + pre-auth limits — DONE

Passed independent re-gate; commit `50aeffb`.

- trusted resolved-tenant binding
- a foreign workspace is rejected before authorization or read
- pre-auth structural/resource gate
- Proxy/accessor defenses
- the caller-owned dependency receiver-mutation corrective passed
- live PostgreSQL tenant isolation passed

Runtime command/write wiring remains deferred to a later write boundary.

- facade bound to resolved tenant
- workspace mismatch blocked before raw read
- pre-auth body/shape/resource limits
- Proxy rejection and cheap structural gate

### AI-039 — Development Workflow Browser — DONE (`b0e0bb8`)

Owner creates Development Request and sees FeaturePlan, dependencies, risk, executor recommendation and verification plan before repository mutation.

A planning boundary only: no repository mutation, run, model, executor or GitHub action. (AI-039.1 below binds the planning port.)

- **Development Request = ProjectTask.** There is no separate request entity: `ProjectTask → FeaturePlan revisions → DevelopmentTask[] → (future) Runs`.
- **Durable, immutable FeaturePlan revisions** (migration `0011`, `project_task_feature_plans`):
  - one plan lineage per task, revisions 1..N, never updated (trigger), editing saves revision N+1;
  - composite FK to the ProjectTask of the same workspace and project;
  - the stored plan is the canonical `validateAndNormalizeFeaturePlan` output with a sha256 fingerprint;
  - draft status only; the ProjectTask status is never changed.
- **Owner flow (corrective P-1):** `ProjectTask → Owner Planning Interview → AI-assisted candidate FeaturePlan → deterministic validation → Owner review / edit → immutable saved FeaturePlan revision`.
  - The interview asks product questions only (desired result, where behavior changes, what must not break, how success is recognized, constraints), task-type aware, with "Not sure" as a valid answer. It never asks for files, paths, commands, step ids or dependencies.
  - Planning is ONE bounded structured completion through a provider-neutral planning port in the ModelProvider vocabulary — not an executor task, no tools or agent loop. The candidate is untrusted: it is rejected (never repaired) unless `validateAndNormalizeFeaturePlan` and `buildDevelopmentTaskWaves` accept it.
  - The candidate is never saved by AI; only the Owner's explicit "save draft revision" creates a revision.
  - The Project Registry holds no repository contents, so the planner never names repository paths: a candidate's allowed paths are marked as needing technical clarification and must be filled before saving.
  - At AI-039 no planning provider was bound, so production showed a factual "AI planner unavailable" state. AI-039.1 binds the port through a real planning Run (below); without a valid planning policy the state stays "unavailable".
- **Plan Builder (advanced editor / fallback)** at `/tasks/[taskId]/development` (from Task Detail; no new navigation item):
  - steps with stable ids, dependencies chosen from other steps, risk, priority, Owner-approval flag and one-per-line scope / paths / criteria / commands;
  - a bounded FormData parser and one Server Action → the server-only save contract (`lib/development/feature-plan-mutations.ts`);
  - Owner + task + project locks, idempotent by an opaque form key + intent fingerprint, exactly one `task.feature_plan_revision_created` audit event;
  - only a `draft` task of an `active` project can receive a revision.
- **Browser** (read through the existing AI-038.0 / AI-038.1 chain, new read action `read_task_feature_plans`):
  - development request, plan and bounded revision history;
  - dependency waves from `buildDevelopmentTaskWaves` (logical readiness only), aggregate risk = max step risk;
  - verification plan = exactly the commands written in the plan.
  - Stored plans are re-validated and re-fingerprinted on every read and fail closed when corrupted.
- **Executor recommendation:** factually unavailable until ExecutorRouter (AI-041.3); no executor is shown or implied.
- **Follow-up (Owner decision):** adaptive, task-specific interview questions proposed by the planning model (on top of the fixed task-type questions, product-only, each with "Not sure") — after a real planning provider is bound.
- **Repository changes:** factually not started.

### AI-039.1 — Ledger-backed AI FeaturePlan Planning — DONE

The AI-039 planning port bound to a REAL bounded model invocation, through the existing runtime.

**DONE means:** implementation, deterministic / fake-SDK / live-PostgreSQL verification and the independent architecture review are complete.

**It does not mean** that a real API-key paid call was performed, that API billing was verified live, or that M2.2 is complete.

**Direct API-key live smoke deferred by Owner until API billing is available.** The API-key path is kept as implemented. The one Owner-approved paid planning call remains a separate gated step, and M2.2 remains DEFERRED BY OWNER.

- **Seam:** one real persisted single-step planning Workflow Run per planning request, through the existing lifecycle (`create → start → advance`).
  - It inherits route, data-handling permit, invocation ledger, preflight, pre-spend budget reservation, provider-start fence, usage / cost settlement, `outcome_unknown`, recovery, audit and observability.
  - No second ledger, no synthetic run / workflow / agent / step identity. The planning Run is visible on the Runs page.
  - The Run's policy snapshot is a versioned built-in planning workflow (`pac-feature-plan-planning`, agent `pac-feature-planner`, step `feature-plan`, `proposal_only`, no tools, `maxAttempts` 1) for the task's real Project Registry project.
- **Durable step result** (narrow, generic pull-forward of AI-037.2; migration `0012`):
  - the output text of a succeeded invocation is stored in `workflow_model_invocation_results` in the same transaction as the ledger's usage / cost / budget settlement, sha256-fingerprinted;
  - rows are immutable and tenant-bound (composite FKs); readers re-fingerprint and fail closed.
  - A result therefore survives a later snapshot commit failure without a second dispatch.
- **Planning request** (`project_task_planning_requests`, migration `0012`):
  - Owner + task + project locks (the AI-039 plannability rule);
  - idempotency key + request fingerprint: exact replay never dispatches again; the same key with a different request is a conflict;
  - settled exactly once with the runtime outcome; one audit event each for started and settled.
  - The candidate is re-derived from the durable result, never stored twice.
- **Budget policy `feature_plan_planning`** from trusted server configuration (`PAC_PLANNER_*`):
  - pinned identity, verified prices, per-call input / output / cost ceilings, daily-token and monthly-cost windows;
  - fails closed, and the windows must hold one call.
  - Production binding only when the policy, the credential and the trusted workspace are valid (loopback PostgreSQL until AI-037.5).
- **Data handling:** project egress mode `approved_minimum`. Every planning request needs the Owner's explicit, unchecked-by-default consent in the form, turned into one-shot evidence bound to exactly that invocation.
- **Strict output:** the whole output text must be one JSON object (no fences, no repair), then the AI-039 candidate validator. Non-empty `allowedPaths` still reject the candidate.
- **Outcomes:** `candidate`, `candidate_rejected`, `planner_unavailable`, `budget_denied`, `provider_unavailable`, `planning_failed`, `recovery_required`, plus `egress_approval_required` and `conflict`.
- **Unchanged:** no auto-save, no task status change, no repository execution; provider SDK retries 0; the credential stays server-side only.

### AI-039.2 — ChatGPT Plan Access — IN PROGRESS (Phase A: connection, before the eligibility checkpoint)

Phase A (implemented; awaiting the Owner eligibility checkpoint): Sign in with ChatGPT connection in Settings → Integrations — public-client OAuth (dynamic registration, PKCE S256, state, nonce, 127.0.0.1 loopback callback), JWKS-validated ID token, local protected credential store, serialized rotating refresh, revocation on disconnect, account-specific model discovery. **No inference.** Phase B (subscription accounting, adapter, planner binding) starts only if the official grant includes `chatgpt.tokens.use.direct`. Eligibility is determined by that official OAuth grant; a private PAC installation is not guaranteed ChatGPT-plan direct access.

Purpose: use official Sign in with ChatGPT / ChatGPT plan usage as a second `ModelProvider` access mode for bounded FeaturePlan planning.

```
ModelProvider
  ├── api_key               (AI-039.1, preserved)
  └── subscription_session  (AI-039.2)
```

Both access modes feed the same flow: `Planning Interview → ledger / policy → candidate → deterministic validation → Owner review`. `ModelProvider` is NOT collapsed into `ExecutorAdapter`.

Approved architecture direction (only this is recorded):

- the official Sign in with ChatGPT OAuth path;
- ChatGPT-plan usage for eligible Responses API requests;
- access mode `subscription_session`, with no API key required for this route;
- OAuth credentials protected server / local only; no tokens in browser storage;
- the existing `api_key` path preserved;
- no fake $0 cost: subscription usage / quota is represented separately from metered API cost;
- no repository execution, and no ExecutorAdapter work yet.

Actual availability / eligibility and the supported request contract must be re-verified against official OpenAI documentation during AI-039.2.

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
| execution | `ExecutorAdapter` / `ExecutorRouter` / `ExecutionEnvironment` contracts and normalized artifacts/events (no PAC-owned agent loop or sandbox) |
| providers | provider adapters |
| shared | DB adapter, observability, validation primitives |

Dependency rule:

`API/Handler → Application/Use Case → Domain/Policy → Repository Contract → Infrastructure`

Additional rules:

- new functionality must not endlessly enlarge central runtime files
- file/class >1000 lines requires decomposition review
- large mechanical refactors are not mixed with critical correctness fixes
- decomposition gate happens before AI-041/042 scale-up
- v1.4: the gate must not block AI-041.0, which is a new, isolated contract module; it applies before executor integrations scale up (AI-041.1+)

## 11. M4 — Vendor-Neutral Executor Platform — REBASED (v1.4)

M4 builds the executor platform, not an agent runtime. PAC owns the request, policy, routing, evidence, quality, security, approval and audit around execution. The selected executor owns how it reasons, which tools it calls in its own loop, its context management, its subagents and (when managed) its sandbox. Design input: `docs/architecture/executor-adapter-strategy-v0.1.md`.

`PAC → ExecutorRouter → ExecutorAdapter → { OpenAIAgentsExecutor | ClaudeCodeExecutor | QwenExecutor | DeepSeekExecutor | LocalExecutor | future }`

Rules:

- Provider-specific SDK objects, events and errors stop at the adapter boundary. No provider-specific types appear in FeaturePlan, policy, routing, runtime state, audit or UI.
- A provider session is not PAC workflow state; a provider trace is not PAC audit; a provider scanner verdict is not PAC security policy.
- Capability detection fails closed: an executor that cannot satisfy the requested capability, environment, access mode or data-handling requirement is not selected.
- No second dispatch on an ambiguous outcome; existing M1 invariants (budget-before-spend, `outcome_unknown`, idempotency, audit) apply to executor runs.

### AI-041.0 — Vendor-Neutral Executor Adapter Contract — PLANNED (first new implementation task created by v1.4)

Define only the PAC-owned contract and its contract tests. No SDK, no provider adapter, no network, no migration unless the task explicitly scopes one.

Conceptual coverage (final shapes are decided in the task, not here):

- `ExecutorRequest` — bounded task derived from an admitted FeaturePlan task (scope/paths, acceptance criteria, verification plan, limits)
- `ExecutorCapabilities` — what an executor factually supports
- `ExecutorAccessMode` — `subscription_session`, `api_key`, `provider_credits`, `self_hosted`, future supported mode
- `ExecutionEnvironmentRef` — reference to the environment that runs the work
- `ExecutorRunIdentity` — PAC run identity plus opaque provider references
- `ExecutorEvent` — normalized progress/status events
- `ExecutorArtifact` — normalized patch/report/log artifacts
- `ExecutorUsage` — `metered_api` (tokens, actual cost), `subscription` (quota/allowance; cost only if factually exposed), `provider_credits`, `self_hosted` (compute/resource)
- `ExecutorOutcome` — terminal outcome including `outcome_unknown`
- status, cancel, and resume where the executor supports it

Exit: contract and adversarial contract tests pass; a deterministic fake executor satisfies the contract; nothing calls a real provider.

### AI-041.1 — OpenAI Agents API Adapter (`OpenAIAgentsExecutor`) — PLANNED (P1 candidate)

First managed executor implementation candidate, started only after the AI-041.0 contract passes its gate. Uses the official OpenAI Agents API. PAC remains responsible for FeaturePlan, policy, routing, quality, security, audit, cost normalization, approval and corrective orchestration; the Agents API may own session execution, the agent loop, tools, context runtime, subagents and hosted execution. Only capabilities confirmed by current official documentation at implementation time may be relied on (see `docs/ROADMAP_REBASE_V1.4.md` §External capability assumptions; status at rebase: public beta).

Replaces the v1.3 default "CodexBackend via Codex CLI subscription session". Codex CLI/SDK/Cloud routes remain possible future executors or environments if a supported control-plane interface is confirmed (see AI-041.R1).

Exit: real tasks run through the contract without a parallel special-case pipeline, and changing the supported access/payment mode does not change FeaturePlan, QA, evidence, Owner approvals or audit semantics.

### AI-041.2 — Second Vendor / Portability Proof — PLANNED

Preferred candidate: **Claude Code** (`ClaudeCodeExecutor`), unless later capability research changes it. Same access abstraction: supported Claude/Claude Code subscription access or Anthropic API, selected by policy.

Portability gate — with a different executor, PAC keeps:

- same FeaturePlan
- same Admission Policy
- same Quality Gate
- same Security Gate
- same evidence
- same approvals
- same audit
- same corrective controller

### AI-041.3 — Executor Router — PLANNED

Separate from the existing direct-model `ModelRouter` (`model-capability-routing-policy.ts`), which keeps serving `ModelProvider` calls. Routing inputs: capability, task class, risk, cost, latency, availability, data residency, privacy, context/repository needs, execution environment, access/payment mode, provider quotas/limits, historical eval quality, Owner preference. Introduced when there are at least two executors to choose between (no earlier than AI-041.2).

### Research / integration targets (not implementation tasks yet)

| Item | Priority | Status | Note |
|---|---|---|---|
| AI-041.R1 Codex Cloud capability investigation | P1 | RESEARCH | Programmatic interface suitability, repository access, environment lifecycle, reusable environments, task lifecycle, artifacts, branch/PR workflow, logs, limits, cost, security boundary, identity/access. Not a dependency until a supported control-plane interface is confirmed. |
| Codex Security as `SecurityEvidenceProvider` | P1/P2 | FUTURE | Evidence source only; does not replace lint, tests, SAST, dependency/secret scanning, architecture checks, PAC policies or human review. |
| Sign in with ChatGPT | P2 | RESEARCH | Identity, eligible plan usage (Plus/Pro), credits, commercial/private eligibility, limits, quota visibility. Not mandatory; not assumed available for every deployment. |
| Dots | — | DEFERRED / RESEARCH | Architecture/UX/automation benchmark. A future `DotExecutor` only if an officially supported programmatic interface appropriate for PAC appears. PAC is not a wrapper around Dots. |

### Executor access / authentication / payment modes

Execution access and payment are replaceable runtime configuration, not workflow semantics. The control plane may select among supported modes according to Owner policy, availability, quota, security, and cost.

| Mode | Intended use | Accounting / security rule |
|---|---|---|
| `subscription_session` | Provider-supported subscription access, e.g. eligible ChatGPT plan usage or Claude/Claude Code subscription where officially supported | PAC stores only status and policy facts needed for orchestration; it does not copy raw interactive session secrets into Run state or audit. Quota/allowance is tracked separately from API token spend. |
| `api_key` | Direct provider API credential | Secret remains server-side; exact usage/cost/budget rules apply where provider reporting supports them. |
| `provider_credits` | API-funded route using provider account credits/balance | Same execution contract as API key mode; funding source must not change workflow semantics. |
| `self_hosted` | Local/private inference or executor infrastructure | No provider subscription dependency; compute/resource accounting is separate from provider token billing. |
| future supported mode | Any later officially supported mode | Added only behind the same contract. |

Rules:

- Executors are not substitutes for the direct `ModelProvider` API abstraction.
- An executor may support more than one access mode; runtime capability detection must fail closed when a requested mode is unavailable.
- Switching subscription ↔ API ↔ credits ↔ self-hosted must not change FeaturePlan, repository scope, QA, evidence, approval, audit, or recovery contracts.
- No fabricated USD per-call cost is recorded for subscription mode unless the provider exposes a trustworthy monetary figure.
- API mode continues to use explicit token/cost budgets and provider-spend controls.
- Private AI Cloud never obtains subscription access by scraping browser state or copying unsupported credentials, and never stores passwords, browser cookies or raw interactive session tokens.
- Provider-specific login/session lifecycle remains inside the adapter and the provider-supported session store.

### Deferred executors

- QwenExecutor, DeepSeekExecutor — deferred until there is a real use case
- LocalExecutor / self-hosted inference — deferred until operationally justified

These remain extension points, not near-term obligations.

### Verification Runner is not an AI executor

`LocalRunner` is separated conceptually from executors. It runs PAC's own Quality Gate checks (lint, typecheck, unit/contract/integration tests, build, secret/dependency scans, architecture checks, local deterministic tools) on executor output. The executor does not own the final Quality Gate.

### AI-042 — Execution Environment Abstraction + Conditional Self-Hosted Fallback — PLANNED (REBASED from "Isolated Coding Worker")

v1.3 required PAC to build an isolated universal Coding Worker. v1.4 replaces that with an `ExecutionEnvironment` abstraction, managed execution first:

`ExecutionEnvironment = provider_hosted | openai_hosted | codex_cloud_if_supported | local | vps_self_hosted | future_provider`

A PAC-owned sandbox/self-hosted environment is built only with a factual need: privacy, data residency, ZDR requirements, private network access, special hardware, vendor independence, provider outage/fallback, cost, or security-boundary requirements.

The safety requirements are kept as environment capability/policy requirements that every environment (managed or self-hosted) must satisfy or be denied:

- filesystem restriction / isolated worktree
- repository/path allowlist
- network policy
- secrets isolation
- timeouts
- budgets and changed-file limits
- artifact and verification-output collection back to the control plane

### Removed from PAC-owned scope (v1.4)

| Former/implicit plan | v1.4 decision | Where it lives instead |
|---|---|---|
| PAC-owned generic agent loop (prompt → think → tool → observe → recover) | REMOVE from PAC scope | Executor, behind `ExecutorAdapter`. The existing `agent-step-runtime` (one bounded model invocation per step; tool-call proposals fail closed) stays as control-plane logic and is not grown into a generic loop. |
| Generic context compaction (history → summarize → compact → restore) | REMOVE from PAC scope | Provider-owned. PAC owns Project Knowledge, policies, decisions, FeaturePlans, artifacts, evidence and durable audit. |
| Mandatory own cloud sandbox / coding worker | REPLACE_WITH_PROVIDER + conditional fallback | AI-042 `ExecutionEnvironment`; self-hosted only when justified. |
| Generic browser/computer-use runtime | REMOVE from PAC scope | Executor capability. PAC owns task, permission, policy, allowed origins/resources, approval, evidence, audit. |
| Generic subagent spawn/wait/aggregate runtime | REMOVE from PAC scope | Provider-native subagents are executor internals. PAC keeps Task Graph, dependencies, waves, routing, ownership, policy, evidence. |
| Proprietary full replacement for managed vulnerability research | REMOVE from PAC scope | Managed tools (e.g. Codex Security) may become a `SecurityEvidenceProvider`; PAC Security Policy keeps final authority. |

## 12. Deferred debt before autonomy/staging

| Package | Purpose | Required by |
|---|---|---|
| AI-037.2 | Durable Step result; recovery without provider redispatch | Before autonomous controller (AI-043.2) / after design review; v1.4: also covers durable executor-outcome capture. AI-039.1 pulled forward one narrow part: the output text of a succeeded model invocation is stored with its settlement (`workflow_model_invocation_results`). Snapshot-level step results, structured output, recovery tooling and executor outcomes remain deferred. |
| AI-037.3 | Ambiguous COMMIT reconciliation + general recovery tooling | Before autonomous controller / staging |
| AI-037.5 | TLS/config allowlist + startup validation | Before staging (earlier if M2 PostgreSQL is non-loopback) |
| AI-037.6b | Lease heartbeat / DB clock if needed | Before multi-instance/autonomy when evidence requires it; long-running executor runs may pull it forward |
| AI-037.8 | Durable admission control | Before autonomous controller / transport create-run |

v1.4 does not change these packages' scope; "autonomous worker" in v1.3 meant the control-plane controller, not a PAC-owned coding worker.

## 13. M5 — Roadmap-Driven Autonomy — REBASED (v1.4)

v1.4: autonomy is orchestration of executors by a deterministic, durable control-plane controller. It is not a PAC-owned generic LLM think/tool loop.

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

### AI-043.2 — Continuous Development Controller — PLANNED (MODIFIED in v1.4)

Deterministic, durable control-plane controller (PostgreSQL state):

`ready task → FeaturePlan → Admission Policy → ExecutorRouter → ExecutorAdapter → artifacts/evidence → Quality/Security Gates → corrective or approval → update roadmap → next work`

Restart resumes from durable state. The controller's decisions are deterministic policy/state transitions; any LLM reasoning happens inside an executor or a bounded `ModelProvider` call. It must not become a proprietary generic think/tool loop.

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

### AI-043.4 — Autonomous Corrective Loop — PLANNED (MODIFIED in v1.4)

PAC owns the corrective orchestration; the selected executor performs the corrective coding/reasoning.

`FAIL → collect evidence → classify root cause → select executor → create bounded corrective task → executor performs fix → rerun affected checks → rerun full required Quality Gate`

Builds on the existing corrective-attempt contract in `development-execution.ts` (attempt kinds, max attempts, `awaiting_correction`).

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

## 14. M6 — Automated Engineering Proof

### AI-044 — Task → Verified PR — PLANNED

Primary production proof — a REAL Smart Algorithms feature moves through:

`Product request → FeaturePlan → Admission Policy → Task Graph → Executor selection → Implementation → Automated verification → Corrective loop if needed → Security review → Human review → Verified PR`

- the executor may be OpenAI, Claude, Qwen or another provider; switching executor must not require changing the engineering pipeline

- Owner intervenes only at policy gates
- recoverable FAIL is automatically analyzed and may re-enter self-fix
- merge remains manual until separately approved
- after a successful Smart Algorithms case, Private Exchange becomes the second higher-risk production case

## 15. M7 — Staging / Hardening

### AI-045 — Production-like Infrastructure — PLANNED

- VPS/deployment environments
- control-plane hosting (VPS) and PostgreSQL
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
- control-plane resource monitoring
- queue/backpressure when the control-plane workload actually requires it (Redis/BullMQ is not required merely because older documents assumed a PAC-owned agent worker)
- security monitoring and incident handling/evidence

v1.4: production PAC does not necessarily deploy its own cloud coding worker. A self-hosted execution environment may exist only as one `ExecutionEnvironment` implementation (AI-042).

Before staging, close the technical-debt packages that are actual staging blockers at that time.

## 16. M8 — Remote Owner Control through Telegram

Telegram is another client of the same PAC Control Plane. Telegram does not get a separate backend or separate security rules. Web UI, Telegram and future clients use one Owner Control API, policies, approvals and audit.

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
| Bounded corrective attempt in approved scope (executor performs fix, PAC re-gates) | AUTO |
| Documentation-only change | AUTO by policy |
| Auth / security-sensitive change | SECURITY REVIEW + OWNER APPROVAL |
| Secrets | DENY unless a separately approved secret-management operation exists |
| QA/security verification | AUTO |
| New scope / roadmap change | OWNER APPROVAL |
| Architecture change | OWNER APPROVAL |
| Budget/risk ceiling increase | OWNER APPROVAL |
| DB migration | OWNER APPROVAL |
| Real provider / new executor / new credentials | OWNER APPROVAL |
| Code acceptance | OWNER APPROVAL |
| Commit | OWNER APPROVAL |
| Push | OWNER APPROVAL |
| Deploy | OWNER APPROVAL |
| Tenant/security invariant broken | HARD STOP |
| Unknown state without safe recovery | HARD STOP |

## 18. Execution order and parallelism

Roadmap does not imply strictly serial development. Parallel work is allowed only when dependencies and file/DB ownership do not create unsafe conflicts.

### Current critical line

`AI-037.0 DONE → AI-037.1 DONE → AI-037.1.1 DONE → AI-037.6a DONE → AI-037.4a DONE → AI-037.1.2 DONE → M1 Review Gate DONE → Real Provider Gate IN REVIEW (M2.0 DONE, M2.1 DONE, M2.2 DEFERRED BY OWNER) → M2 Review Gate`

### A. Current operational line (unchanged by the rebase)

While M2.2 is deferred: `AI-037.7 DONE → AI-038.0 DONE → AI-038.1 DONE → AI-038.2a DONE → AI-038.2b DONE → AI-038.3 DONE → AI-038.3.1 DONE → AI-038.3.2 DONE → AI-038.4a Project Task Foundation + read surfaces DONE → AI-038.4b Quick Create / task mutation binding DONE → AI-038.5 Mission Control Visual Refinement DONE → AI-038.6 RU/EN Owner Console Localization DONE → AI-038.7 Dynamic Ambient Shader Background DONE → AI-039 Development Workflow Browser DONE → AI-039.1 Ledger-backed AI FeaturePlan Planning DONE (direct API-key live smoke deferred by Owner) → AI-039.2 ChatGPT Plan Access (NEXT) → AI-040a (PLANNED)` (M3 Owner path, §9). AI-038.2 passed; the Owner Console reads real runtime data through AI-038.3, read-only. The rebase does not cancel or skip any unfinished AI-038 work.

### B. First new architecture implementation introduced by v1.4

`AI-041.0 Vendor-Neutral Executor Adapter Contract` (PLANNED). It is a contract-only task and may be scheduled in parallel with line A when the Owner chooses; it does not depend on AI-038.2b.

### Early development automation

`AI-040a` may begin after the Real Provider gate or in parallel with early M3 work when dependencies are satisfied.

### UI

AI-038.2, AI-038.3, AI-038.3.1 and AI-038.3.2 are DONE: the Owner Console reads real runtime data with All Projects and real project switching, read-only. AI-038.4a (DONE) adds persistent Owner Tasks as read surfaces; AI-038.4b (DONE) adds Quick Create, the only UI write (draft task intent through the audited `createTask`). AI-039 (DONE) adds the second UI write: saving immutable draft FeaturePlan revisions of a ProjectTask, with no execution. AI-039.1 (DONE; direct API-key live smoke deferred by Owner) adds the Owner-approved planning request, which runs one budget-bounded planning Run and never saves a plan or changes the task. Other UI write actions need separate tasks.

### Execution platform

`AI-041.0 contract → Decomposition Gate (before integrations scale) → AI-041.1 OpenAIAgentsExecutor → AI-041.2 second-vendor portability proof → AI-041.3 ExecutorRouter → AI-042 ExecutionEnvironment (+ conditional self-hosted) → AI-043.* → AI-044`

Qwen/DeepSeek/Local executors remain deferred until an actual product need appears. Codex Cloud, Codex Security, Sign in with ChatGPT and Dots are research items (§11) and are not on the critical line.

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
| Vendor-Neutral Executor Platform | First managed executor works through `ExecutorAdapter`; a second, different executor proves portability without pipeline change; every execution environment satisfies the environment safety policy |
| Roadmap Autonomy | System selects next ready work and does not require manual “go next” between normal technical steps |
| Automated Engineering Proof | Real Smart Algorithms feature reaches verified PR; switching executor needs no pipeline change |
| Staging | Production-like deployment with observability, backups, TLS, CI/CD and security gates |
| Telegram Owner | Owner safely manages roadmap/runs/approvals through the same control plane from mobile |

## 20. Final target state

The Owner defines or approves the product roadmap once. Private AI Cloud then plans allowed work, routes it to a selected executor/model, manages budgets, runs its own Quality and Security Gates, orchestrates bounded corrective attempts performed by executors, and continues through the roadmap. PAC remains a vendor-neutral control plane: executors do the internal agent work; PAC owns the engineering process. The Owner appears only at predefined approval gates, blockers, strategy changes, risk/budget escalation, and critical external actions.

The system must remain one managed process in which executors and payment methods can change without rebuilding the pipeline. Supported access modes include provider API credentials/credits, provider-supported subscription CLI sessions, and self-hosted routes; the workflow must remain independent from those choices.

It must support both:

- autonomous Roadmap Mode
- manual Feature Mode
- Fix / Investigate mode

The key production proof remains a real Smart Algorithms feature moving from executable roadmap to verified PR. Private Exchange then becomes the second, higher-risk production proof.

## 21. Version management

| Field | Value |
|---|---|
| Document | Private AI Cloud Development Roadmap |
| Version | v1.4 |
| Status | Current / Authoritative |
| Canonical source | `docs/ROADMAP.md` |
| PDF | Generated snapshot only |
| Change control | New strategic version requires Owner approval |
| Priority | v1.4 supersedes roadmap v1.3 and earlier roadmap descriptions where they conflict |
| Decision record | `docs/ROADMAP_REBASE_V1.4.md` |
| Document index | `docs/README.md` |

### v1.4 change summary

- PAC reframed as a **vendor-neutral AI Engineering Control Plane**: PAC owns the engineering process; executors own the internal agent execution mechanism.
- Explicit PAC-owned vs provider-owned boundary (§1.2; `docs/architecture/control-plane-architecture-v1.0.md`).
- Managed executor first; `ExecutionBackend` concept renamed/reframed as `ExecutorAdapter` plus a separate `ExecutorRouter`; direct `ModelProvider` and its router preserved and kept separate.
- Removed from PAC-owned future scope: generic agent loop, generic context compaction, generic browser/computer-use runtime, generic subagent runtime, proprietary managed-security-research replacement.
- AI-042 rebased from "Isolated Coding Worker" to a managed-first `ExecutionEnvironment` abstraction with a conditional self-hosted fallback; safety requirements kept as environment policy.
- Codex Security treated as a future `SecurityEvidenceProvider`; PAC Security Policy keeps final authority.
- FeaturePlan, Admission Policy, Quality Gate, Corrective Loop, Security Policy, Human Approval, Audit/Evidence, cost/usage normalization and observability preserved and strengthened as PAC-owned.
- OpenAI Agents API added as the P1 first managed executor candidate (AI-041.1 `OpenAIAgentsExecutor`), replacing the v1.3 CodexBackend default; Claude Code remains the preferred second-vendor portability proof.
- Codex Cloud added as P1 research (AI-041.R1), not a dependency; Codex Security P1/P2 evidence provider; Sign in with ChatGPT P2 research, not mandatory; Dots deferred as benchmark / possible future adapter.
- AI-041.0 Vendor-Neutral Executor Adapter Contract is the first new implementation task created by the rebase.
- AI-043.2 restated as a deterministic durable controller; AI-043.4 as a PAC-owned corrective loop with executor-performed fixes.
- M6 exit criterion preserved and extended with executor portability; M7 no longer assumes a PAC-owned coding worker or Redis/BullMQ by default; M8 unchanged in concept.
- AI-038.2a marked DONE (commit `4e76afd`); AI-038.2b, AI-038.2, M2 and M3 remain not done; M2.2 remains DEFERRED BY OWNER.
- All completed stages are preserved without renumbering: AI-001…AI-036.7; AI-037.0, AI-037.1, AI-037.1.1, AI-037.6a, AI-037.4a, AI-037.1.2, AI-037.7; the M1 Roadmap Review Gate; AI-038.0, AI-038.1, AI-038.2a; M2.0, M2.1 (see §4). AI-037.2 / .3 / .5 / .6b / .8 remain DEFERRED (§12).

### v1.3 change summary

- Formalized the separation between direct `ModelProvider` API routes and coding `ExecutionBackend` routes.
- Added executor access/payment abstraction: `subscription_session`, `api_key`, `provider_credits`, and `self_hosted`.
- Required `CodexBackend` to support provider-supported Codex CLI subscription-session access when available, alongside an OpenAI API/API-credit route.
- Required `ClaudeCodeBackend` to support provider-supported Claude Code subscription-session access when available, alongside an Anthropic API/API-credit route.
- Prohibited copying passwords, browser cookies, or raw interactive subscription/session credentials into workflow state, audit, or generic PAC storage.
- Made FeaturePlan, QA, evidence, approvals, audit, and recovery invariant across executor payment/authentication modes.
- Distinguished subscription quota/availability accounting from exact API token/cost accounting; no synthetic per-call USD cost is invented for subscription mode.
- Clarified that M2 still proves the direct API-backed `ModelProvider` path; subscription-backed coding executors are implemented in M4.

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
