# Project Status

## Current State (Roadmap v1.5, 2026-10-26)

Private AI Cloud is a **vendor-neutral AI Engineering Control Plane**. The canonical status lives in [`docs/ROADMAP.md`](docs/ROADMAP.md). This file is a short summary and does not override the roadmap.

**AI-044.1 — DONE:** subscription executor foundation integrated at
`c5658002aaf67a835e480e42f4ca0d1003b76af7`. **AI-044.2 — IN REVIEW:** narrow
[local Owner proof runner](docs/operations/ai-044-owner-production-proof.md), separate
PREPARE / queue request / APPROVE or REJECT / INVOKE actions, exact durable attempt,
manual preflight and existing one-shot fence. No real provider call or production
proof has been executed. AI-044 remains IN PROGRESS; generic dispatch remains BLOCKED,
`runtimeDispatchAllowed=false`; paid/hosted Phase L remains DENY-ONLY.

**Current integrated checkpoint:** `41c0a166180e610c5454ffd2456bee4edb051d55`
(AI-044 Phase L fail-closed readiness primitives, independently accepted and integrated;
B3 remains accepted within deterministic/fake-live-blocked scope). Documentation records
**v1.5 — Owner-approved private execution sequencing**, not an architecture rebase.
The v1.4 vendor-neutral/managed-first architecture is preserved; the latest Owner
decision defers the PAC-owned coding container/private runtime to AI-052 after
VPS and Telegram Owner Control through AI-051.

- **AI-041.1 — DONE:** implementation/review chain accepted at
  `c9c04d94217847e6bbe5066f54f8d69897693862`; managed transport, durable
  start/exposure, current authority, outcome capture, provider identity/recovery
  and reconciliation foundation. Not production/live dispatch readiness.
- **AI-042.1 / AI-042.1a — DONE:** accepted Sandbox Execution Contract at
  `f63e79b8cfb8e3ae1c369b7f31c00bf9944ca36e`; cleanup-only authority,
  maxFiles consistency, Network Contract v1 and mutation-sensitive regressions.
  Pure contract/persistence proposals, not physical enforcement.
- **AI-042.2 — DONE:** WorktreePort/local Git adapter at `47212635607c6c7a37f2af4a56f548c793af444a`;
  exact immutable baseline, detached HEAD, primary checkout/index/ref protection,
  generation/fingerprint/revision/fence ownership, cleanup-only physical removal,
  restart/discovery, partial-failure reconciliation and adversarial proof.
- **AI-042 overall — PARTIAL / IN PROGRESS, NOT DONE.** No production worktree
  storage adapter, cross-host/VPS-safe concurrency, OS/process containment,
  process-level file-scope enforcement, CPU/RAM/disk quotas, network/DNS
  enforcement, secrets injection/isolation or live runtime dispatch.

`runtimeDispatchAllowed=false`; production/live dispatch remains **BLOCKED**.
See [contract v1](docs/architecture/sandbox-execution-contract-v1.md) and
[worktree boundary and limits](docs/architecture/git-worktree-isolation-v1.md).

**AI-041.3 — DONE; AI-042 minimal managed closure — DONE:** integrated at
`f36d4ac923f12c5b61602c4cb0a950ad1602edcc` after consolidated independent PASS. Read-only policy selection,
not dispatch. AI-042 overall remains PARTIAL / IN PROGRESS.

**B3 / AI-043.0–AI-043.5 and AI-043 — DONE:** consolidated independent re-gate
and exact controlled integration completed at the checkpoint above. This proves
durable roadmap/controller/gates/correction/Owner reads and cooperative within-wave
executor progress with fake providers, not live authorization.

**Current: AI-044 — LIVE READINESS IN PROGRESS / NOT DONE.** Amended Phase L:
**LIVE READINESS PRIMITIVES INTEGRATED / PAID FINANCIAL GATE BLOCKED**.
Hosted profile/archive/ingestion/recovery and approval/QA
binding contracts are preparation only. Total finite enforceable exposure is
unproven; container maximum remains UNKNOWN. Live permit issuer is DENY-ONLY;
production composition has no credential/transport port. No numeric live spend
was approved, no provider call made. See [evidence and feature freeze](docs/architecture/ai-044-live-engineering-proof-v1.md).

**Current Phase S candidate:** [ChatGPT-plan patch executor](docs/architecture/ai-044-subscription-patch-executor-v1.md)
uses official `subscription_session` direct Responses access, reusing AI-039.2,
exact-SHA bounded context and the existing durable approval/authority/controller
foundation. No local coding tools/sandbox/API billing or credit fallback. A current
manual Owner receipt must attest selected app limit<100%, credits disabled and
no automatic-purchase reliance; token claims do not attest these settings.
One-shot approval/fence and ambiguous no-redispatch evidence are implemented for
independent re-gate, not self-approved or integrated. No real OAuth/credential
resolution/inference. Global `runtimeDispatchAllowed=false`, production/live
dispatch BLOCKED; AI-044 NOT DONE. Eligible local/open-source SIWC availability
is not blanket remotely hosted commercial eligibility; AI-045 must re-check it.

**AI-041.2a — DONE:** provider-neutral request/correlation seam and byte-compatible
OpenAI extraction integrated at `f782e1e438b4030efeba1bd70b90485ab71a52e3` after independent PASS.
**AI-041.2b1 — DONE**, integrated at `fca80a5a272ef734295cd250432f42ea2333db3b` after independent PASS:
[predecessor barrier](docs/architecture/executor-predecessor-quiescence-v1.md)
for reserve/prepare/start; factual authority advance and historical settlement remain allowed.
**AI-041.2b2 — DONE**, integrated at `45c55e56ed98df2e40822cee1e3c89ca90a54d1a` after independent PASS:
append-only [provider CHECK migration](docs/architecture/executor-provider-constraint-migration-v1.md)
`0017` permits exactly `openai, anthropic` in the shared parent row; no identity,
financial or production TypeScript changes in that prerequisite. AI-041.2b is DONE.
**AI-041.2 — DONE:** c Claude fake adapter, d portability/adversarial proof and
[authority rebind](docs/architecture/executor-authority-rebinding-v1.md) (`0018`)
independently accepted and atomically integrated at
`46456844aac0251763d41277decfa066cdfc65cf`.
[Portability evidence and limits](docs/architecture/executor-portability-proof-v1.md)
prove both directions over one shared lifecycle, not live Claude access.

**Integrated B2 foundation:** [ExecutorRouter](docs/architecture/executor-router-v1.md) reuses
factual Admission/current attempt, hard filters before deterministic ranking and
Owner hard/soft preference. [Managed environment policy](docs/architecture/managed-execution-environment-v1.md)
compares bounded evidence; required unknowns deny. No default supported routes,
credential/SDK/health checks, dispatch grants, persistence or new migration.
ModelRouter, current authority, financial and recovery lifecycles are unchanged.

**Intended execution path before AI-052:** managed Codex/OpenAI and Claude,
only through factually supported, policy-compliant provider-managed environments
and their applicable approval/security/live gates. Do not substitute an unmanaged
local Codex/Claude process on the PAC VPS. The intended route is not a claim of
current access or production readiness.

**Current critical path:** `AI-041.2 DONE → B2 (AI-041.3 Executor Router + AI-042
minimal managed closure DONE) → B3 / AI-043.* Roadmap-Driven Autonomy DONE
→ AI-044 LIVE READINESS IN PROGRESS (Phase L integrated; Phase S candidate; paid financial gate BLOCKED) / Verified PR → AI-045 VPS → AI-046 → AI-047 → AI-048
→ AI-048.1 → AI-049 → AI-050 → AI-051 Telegram Hardening → AI-052 Private
Execution Environment` (canonical detail: roadmap §18). AI-042.2 is a DONE prerequisite.

**Private execution target: AI-052 — PLANNED after AI-051.** Local coding,
vps_self_hosted coding and own/private AI coding execution remain **BLOCKED until
AI-052 passes its own security/readiness gates**. Worktree Isolation alone grants
no local execution authority. Factual privacy, repository, residency, network,
hardware, fallback, independence, provider security, model or cost needs do not
silently override this sequence. Earlier self-hosted implementation requires a
**new explicit Owner roadmap-change approval**; approval does not waive gates or
itself authorize dispatch. Self-hosted remains first-class conditional capability,
not cancelled, and is implemented at the later AI-052 stage by default.

AI-042 closure before AI-043 is minimal **managed** ExecutionEnvironment capability/
policy closure, not a self-hosted container stack. PAC owns scope, policy, budgets,
QA/security, evidence, corrective orchestration, approvals and audit; executors
own agent loops/context/subagents/tools. `ModelProvider` and `ExecutorAdapter`
remain separate. AI-043 remains deterministic/durable orchestration; AI-044 still
proves a real Smart Algorithms feature reaches Verified PR. The Owner target is
now **Liquidity Intelligence Drawer v0.1**; Portfolio Analytics is cancelled.
AI-044.1 is a PAC-only FeaturePlan-driven read/write authority correction, not
feature implementation. A future approved plan selects its own SHA/read/write
sets and acceptance; no old Portfolio context/smoke/zero-write gate is required.

VPS is after AI-044 by default; earlier infrastructure needs separate Owner approval.
**AI-045 infrastructure containers ≠ AI-052 coding sandbox.** Containers for the
control plane, orchestration workers, PostgreSQL-related services, reverse proxy,
monitoring or infrastructure do not authorize a coding/executor containment runtime.

At that later stage, AI-052 is intended to use the engineering pipeline proven by
AI-043/AI-044, not to claim that autonomous development works today:
Owner-approved milestone → Roadmap Controller → FeaturePlans → managed Codex/OpenAI
/ Claude → QA → Security → bounded corrections → Owner approvals → Verified PRs.
Its targets are production WorktreeStoragePort/durable CAS/fencing/history and
coordination/recovery, isolated processes/commands, file containment, resource
limits, Network Contract v1 physical enforcement, scoped secrets, evidence and
SelfHostedExecutor/private models (including a future Lemetti-owned model and
zero-external-model-egress mode). None is implemented now. No automatic merge,
unapproved push, production deployment or active security-policy modification.

**AI-042.2 NON-BLOCKING DEBT:** on the next relevant worktree change, move M9,
M10a and M10b from external review harnesses into the checked-in regression/mutation
suite. No corrective implementation is part of this status patch.

| Milestone | Status |
|---|---|
| M1 Real Money Safety | DONE |
| M2 Direct Model Provider Capability | IN REVIEW (M2.0 and M2.1 DONE; M2.2 DEFERRED BY OWNER) |
| M3 Owner Product | ACTIVE / NOT DONE: AI-037.7, AI-038.0–AI-038.7, AI-039 and AI-039.1 DONE (direct API-key live smoke deferred by Owner); AI-039.2 Phase A committed, entitlement gate deferred by external supported-network blocker, Phase B blocked; AI-040a IN REVIEW |
| M4 Vendor-Neutral Executor Platform | IN PROGRESS: AI-041.1/041.2/041.3 and AI-042.1/042.1a/042.2/minimal managed closure DONE; AI-042 overall incomplete; AI-041.0 separate gate unchanged; production/live dispatch BLOCKED |
| M5 Roadmap-Driven Autonomy | B3 / AI-043 DONE in independently accepted deterministic/fake-live-blocked scope |
| M6 Automated Engineering Proof | AI-044 LIVE READINESS IN PROGRESS; Phase L integrated, Phase S candidate awaits independent re-gate; paid financial gate BLOCKED; no real run/Verified PR |
| M7–M8 | PLANNED (M7 rebased in v1.4) |
| Post-M8 Private Execution Environment | AI-052 PLANNED after AI-051; local/VPS/private coding blocked until its own gates |

**Other unchanged checkpoints:** AI-040a Local Developer Handoff and the separate AI-041.0 Vendor-Neutral Executor Adapter Contract gate remain IN REVIEW; this alignment does not declare those gates passed. AI-039.2 Phase B stays blocked, with no inference proof, and M2.2 remains DEFERRED BY OWNER. Current M4 order is in `docs/ROADMAP.md` §11 / §18.\
**First implementation task created by the v1.4 rebase:** AI-041.0.

**AI-041.1 implementation acceptance is not live enablement:** the Owner explicitly excluded the prerequisite independent AI-041.0 / Decomposition gates; their status is not changed here. The historical Live Readiness Review at `c5299f5d19ae1addb38e5ef5335a24428b7074e4` returned BLOCKED. The subsequent implementation/review chain is DONE, but production/live dispatch still needs trusted authority/account/transport/egress composition, sufficient approved financial policy and a separately approved live smoke. Security invariants are unchanged.

## What Exists

- The Owner Console (RU / EN): Dashboard, My Attention, Projects, Tasks, Runs and Approvals read real runtime data read-only; the remaining prototype pages use mocked data.
- A PostgreSQL 16 schema with raw SQL migrations `0001`–`0020` committed, plus the Smart Algorithms demo seed. Phase L adds no migration; historical files stay unchanged, and no production migration execution is authorized.
- Accepted B3 durable roadmap/controller: explicit milestone enrollment/dependencies, atomic task claim/CAS and command journals, exact immutable FeaturePlan approval, canonical DevelopmentExecutionRun histories, existing Router/environment/executor outcome integration, independent gate ports, bounded correction and final Owner acceptance. `/roadmap` reads real authorized data without starting a controller or creating guard/approval rows. [Architecture](docs/architecture/development-controller-v1.md).
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
- AI-041.1 (DONE) / AI-041.1a corrective (DONE / COMMITTED / PUSHED): separate managed Agents API protocol transport (`environment: none`, no executable tools/subagents), explicit dispatch authority, financial admission/exposure reservation, process-local single-consumer test fence and the durable prerequisites below. At the reviewed 2026-10-12 checkpoint the Agents API `spend_control.limit` was in whole USD cents. PAC binds the reservation-derived, rounded-down cap into exact fingerprinted request bytes; full local micros remain held. Returned consumption is best-effort evidence, never settlement. This provider-side defense in depth does not replace durable PAC reservation/fence, aggregate budget, replay protection, Owner authorization or tenant/account binding. Fake/local-PG implementation proof is not live inference proof. Production/live dispatch remains BLOCKED; server composition cannot read credentials or dispatch and no caller flag enables it. See [boundary, official sources and limitations](docs/architecture/openai-agents-executor-v1.md).

- AI-041.1b0 Trusted Executor Attempt Identity — DONE / COMMITTED / PUSHED as `2109545f829dfe4e63a23e95301893c534e75947` after independent re-gate. Existing AI-011 attempt identity is derived from separately trusted canonical implementation state; invocation ID remains correlation only.
- AI-041.1b Durable Executor Start & Exposure Fence — DONE / COMMITTED / PUSHED as `d72a439a456cb1370b49448fb354ea93b381907b`: durable reservation, aggregate serialization, immutable request/attempt journal and conservative holds. See [durable boundary](docs/architecture/durable-executor-start-v1.md).
- AI-041.1c Durable Current Run / Attempt Authority Binding — DONE / COMMITTED / PUSHED as `bde59001b1a4bc28582bd6c76b6059d41cdcf74a`: migration `0014`, trusted register/adjacent-corrective advance/revoke, monotonic durable generation, canonical Run/admission fingerprints and same-transaction current-authority start recheck. Stale factories cannot override revoked/superseded authority. No durable AI-011 lifecycle, autonomous cancellation integration or Owner mutation UX is claimed. See [current-authority boundary](docs/architecture/executor-current-authority-v1.md).
- AI-041.1d Durable Executor Outcome Capture & Exposure Settlement — DONE / COMMITTED / PUSHED as `c5299f5d19ae1addb38e5ef5335a24428b7074e4`: migration `0015`, bounded canonical terminal proposal, restart revalidation, atomic result + settled exposure + one held-counter release + journal. Ambiguous/unknown outcomes retain full exposure with no terminal result. Historical settlement works after authority revoke/advance or Project pause/archive. `settled` means concurrent exposure closed after a durable definitive terminal result, NOT exact monetary cost; observedCostUsdMicros stays null. This pulls forward only executor-specific AI-037.2 recovery; AI-037.2/.3/.8 and M4 remain unfinished. [Outcome boundary and residual debt](docs/architecture/executor-outcome-settlement-v1.md). Production/live dispatch remains BLOCKED.
- AI-041.1e Durable Provider Execution Identity & Recovery Correlation — DONE / COMMITTED / PUSHED as `780a005c96233be1572eb5592433a0e58b8d7869`: migration `0016`, exact-start correlation and write-once session/turn IDs, transactional identity journal, acknowledged correlation capability and bounded parser observer. No Create Session idempotency assumption, credential binding or production transport hookup. W2 uncertainty retains full exposure with no redispatch. [Identity and crash windows](docs/architecture/executor-provider-identity-v1.md).
- AI-041.1f OpenAI Agents Retrieval-Only Provider Reconciler — DONE at `c9c04d94217847e6bbe5066f54f8d69897693862`: independent final corrective re-gate and integration complete; bounded fake GET-only saved session/turn/item recovery, exhaustive unique discovery, shared proposal validation and existing atomic terminal settlement. No Create/message/new turn, redispatch, production GET, credential read, live inference, new ledger or migration. Unknown/ambiguous state retains the hold; settlement never clears the sticky integrity flag. [Retrieval trust and limitations](docs/architecture/executor-provider-reconciliation-v1.md).
- AI-042.1/042.1a (DONE) is the pure Sandbox Contract foundation; AI-042.2 (DONE) supplies the local physical Git worktree slice, not a production store or process sandbox. Focused 249/249 and full suite 2635/2635 passed in its independent gate; mutations and original attack probes cover the reviewed local boundary. [Physical lifecycle and limitations](docs/architecture/git-worktree-isolation-v1.md).

## Not Yet Implemented

- Runtime business APIs, and any UI action that starts a run, model, executor or repository change (the only exception is the AI-039.1 Owner-approved planning Run)
- Enabled/live executor dispatch and production authority/account/transport/egress/recovery composition (AI-041.1 implementation/reconciliation foundation is DONE, not live enablement)
- AI-044 financial-bound proof, future trusted live-source integration and real Owner-approved Liquidity Intelligence Verified PR. Preparation contracts are not a live permit, financial guarantee or live gate PASS. AI-044.1 independently binds read context and admitted writes; it does not implement the target. Portfolio-specific source/smoke/zero-write assumptions are cancelled as requirements. Accepted B3 autonomy does not remove applicable gates; AI-042 overall remains incomplete.
- AI-052 private/self-hosted coding runtime, deferred until after VPS + Telegram hardening: production worktree storage/CAS, cross-host concurrency, OS/process/file containment, CPU/RAM/disk/process/duration limits, network/DNS enforcement, scoped secrets, evidence/recovery and private executor/models; physical local Git worktrees alone provide none of these
- Production/live executor-backed QA/security and corrective execution; B3 proves deterministic internal fake ports over the real durable lifecycle, not live provider readiness
- RAG, real external integrations, staging/production deployment

## History

Earlier stages:
- the UI prototype and UI Refinement Patch 1;
- the data model and schema blueprints;
- the DB-01 scaffold, DB-02 P0 schema and DB-03 demo seed;
- AI-001…AI-036.7;
- the completed AI-037 items (AI-037.0, .1, .1.1, .6a, .4a, .1.2, .7). AI-037.2 / .3 / .5 / .6b / .8 remain deferred.

These are recorded in `docs/ROADMAP.md` §4 and in `docs/qa/`.

### B3 prerequisite/debt accounting

AI-037.2 executor terminal capture/identity/retrieval foundation is integrated;
durable DevelopmentExecutionRun snapshot recovery is implemented in the B3-required
slice, accepted through B3 integration. General Step recovery/tooling
remains outside this slice.
AI-037.3 controller command/revision/fingerprint COMMIT reconciliation and
AI-037.8 atomic roadmap task admission/claim are implemented controller-required
slices, not claims that either historical package is DONE. Broader packages remain PARTIAL/deferred
pending their own factual acceptance criteria. AI-037.5 remains deferred.
AI-037.6b is not pulled forward: the controller uses short transaction/CAS
steps, no long-lived controller lease; existing executor fences remain separate.

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
