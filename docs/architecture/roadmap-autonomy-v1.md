# Executable Roadmap Autonomy v1 — B3

Status: IMPLEMENTED / READY FOR CONSOLIDATED INDEPENDENT RE-GATE, NOT DONE.
Internal implementation checkpoints A/B/C passed; independent acceptance and
controlled integration remain pending. No author-issued independent PASS.
Baseline: `f36d4ac923f12c5b61602c4cb0a950ad1602edcc` (B2 integrated).
Authority: [Roadmap v1.5](../ROADMAP.md), B3 approved delivery scope.

## Ownership and hierarchy

`Project → Milestone → ProjectTask → FeaturePlan → DevelopmentTask`.

Project is the registered tenant-bound PAC Project. Milestone is a minimal
project-scoped roadmap grouping. ProjectTask remains the existing Owner-level
intent (`feature`, `fix`, `investigation`, `roadmap`), not a new Feature table.
FeaturePlan remains an immutable saved revision; DevelopmentTask remains the
executable node inside that revision. Release/Epic are not required placeholders.
Legacy ProjectTasks without explicit enrollment/milestone remain manual.

The Markdown roadmap remains the strategic source of truth. Executable roadmap
rows represent approved control-plane facts, not a model's interpretation of this
document. Models/executors may propose roadmap changes; they cannot directly
authorize dependency, plan or policy mutations.

## Contract and readiness requirements

The bounded roadmap representation references existing task/plan facts rather
than copying a second task/FeaturePlan model. It must represent milestone goal,
priority and status, explicit task enrollment, same-project dependency edges,
required gates and bounded evidence/version bindings. Milestone statuses are
`planned | active | blocked | completed | cancelled`.

Existing ProjectTask statuses remain canonical:
`draft | ready | planning | approved | running | verifying | waiting_owner |
blocked | recovery_required | completed | failed | cancelled`.

Readiness requires active Project and milestone, explicitly enrolled ready task,
all dependencies completed, no conflicting active scope and an exact permitted
plan path or deterministic Owner planning gate. No readiness model/provider call.
Missing/unresolved dependencies never count as completed. Dependency edges must
be same-workspace/project, unique, non-self, referentially valid and acyclic.
Dependency mutation after editable pre-execution state requires an Owner-approved
new version/change event; never silently rewrite a running task's graph.

Planner output is deterministic Current/Next/Blocked facts ordered by priority
then stable IDs. Inside a plan, `buildDevelopmentTaskWaves` owns DAG waves;
existing `evaluateDevelopmentTaskAdmission` owns final scope/path compatibility.
Parallel wave membership does not itself prove non-overlapping paths. Completed
nodes never rerun after restart; failed/recovery predecessors block dependents.

AI-043.1 within-wave acceptance requires actual concurrent executor progress,
not just coexistence of active node snapshots. The deterministic controller
frontier brings all currently admission-compatible siblings through attempt,
route and executor-start stages before waiting on the first run's outcome.
Repeated one-action ticks provide cooperative parallelism; canonical wave order
breaks phase ties. Overlapping admitted paths still serialize until the prior
node factually completes/releases Admission's conflict. Delayed-outcome real-PG
proofs assert distinct committed start/operation facts before either outcome is
consumed, restart with one/multiple in-flight runs and concurrent-controller
deduplication. The inverse overlap proof and M21 serialization mutant prevent
substituting snapshot coexistence for this requirement. No new scheduler, lease,
queue/table, migration or authority lifecycle is involved; task hard stops,
recovery/Owner gates and all accepted executor fences remain stronger.

The existing multi-project scheduler remains authoritative where workspace and
Project concurrency/fairness semantics apply. Roadmap readiness is not a second
competing scheduler; profile-specific model-request semantics must not be forced
onto executor work. The concrete adapter/ownership audit is checkpoint evidence,
not an implied new scheduling grant.

## Trusted task classification

| Trusted persisted ProjectTask type | Initial executor taskClass |
|---|---|
| feature | implementation |
| fix | repair |
| investigation | analysis |
| roadmap | analysis |
| factual corrective attempt | repair |

The mapping is deterministic/exhaustive and derives from validated control-plane
facts, never caller route-selection input. Quality and Security/review are gate
phases, not executor task classes. B3 never emits `refactor` or `verification`
without a later explicitly approved trusted persisted metadata extension.
ExecutorRouter's task-class hard filter remains final; Owner preference cannot
bypass eligibility.

## Durability and transaction requirements

Exactly two append-only migrations are in this candidate:
`0019_roadmap_foundation.sql` and `0020_development_controller.sql`. Historical
migrations `0001–0018` remain byte-identical. No production migration execution.

`0019` adds `roadmap_milestones`, short-transaction `roadmap_project_guards`,
nullable explicit ProjectTask enrollment/metadata and monotonic `state_version`,
same-project `roadmap_task_dependencies`, immutable `roadmap_task_events`,
`roadmap_owner_commands` and typed `roadmap_approval_bindings` into the existing
approval queue. Owner commands are an idempotency journal, not an approval queue.
Legacy tasks get no invented milestone or approval.

`0020` adds `controller_project_tasks` (exact approved-plan/current revision),
`controller_development_runs`, immutable `controller_development_events`,
per-attempt `controller_attempt_intents`, ack-before-port `controller_operations`,
immutable `controller_state_events` and typed `controller_owner_gate_bindings`.
These persist the existing lifecycle, not a replacement corrective/financial
state machine. DB constraints/triggers reject unjournaled/stale revisions,
incoherent approval decisions, execution reset and completion without full gates.

Required narrow persistence surrounds existing contracts: milestone/enrollment/
dependencies, monotonic ProjectTask state version, immutable controller commands
and transition evidence, exact plan/approval bindings and canonical validated
DevelopmentExecutionRun snapshots. No second approval queue, executor financial
ledger, current-authority model or corrective state machine.

Claim is one short transaction: re-check Project/milestone/task/dependencies,
`ready → planning`, expected-version CAS, exactly +1 version, one immutable
command/journal/audit result. Only one concurrent claimant wins. Every mutation
binds commandId, immutable intent fingerprint and expected revision. Exact replay
returns factual committed state; changed intent conflicts. Lost COMMIT ACK is
reconciled by durable command/revision/fingerprint, not blind mutation retry.
Unknowable outcome yields `recovery_required`.

Lock order: Owner authority rows (Owner operations only) → workspace/Project SHARE
→ per-project roadmap guard UPDATE → ProjectTask UPDATE → milestone/dependency
SHARE; controller/current rows follow inside that short protected transaction.
No provider, executor, verification, network or Git await inside a transaction.
Ownership is transaction/CAS based, not a long-lived controller lease. Existing
executor start, financial, predecessor and recovery fences remain independent.
New B3 mutations reuse the accepted `executor-start-transaction.ts` helper:
uncertain BEGIN/COMMIT/ROLLBACK and session-breaking connection errors destroy
the session. ACK reconciliation happens only after its connection is released;
there is no second pooled connection held inside a transaction.

## Required race-safety matrix

Proofs use the checked-in suites below over disposable PostgreSQL. Exact final
counts/commands and mutation evidence live in the consolidated implementation
report; this matrix records primitive ownership, not independent gate acceptance.

| State change | Shared resource | Race | Required primitive | Required proof |
|---|---|---|---|---|
| Create milestone | workspace/Project/milestone | duplicate command/key, changed intent, cross-tenant binding | transaction, scoped FK/unique constraints, Owner command journal | PG Owner-only create/replay/conflicting intent |
| Enroll roadmap task | ProjectTask/milestone | legacy/manual task silently claimed, concurrent edit | typed FK, row lock/CAS, immutable enrollment intent | PG unenrolled denial and version/journal integrity |
| Add dependency | same-Project graph | cycle, missing/cross-Project edge, graph edit vs claim | FK/unique/check, serialized graph validation and transaction | PG cycle/cross-tenant/edit-vs-claim |
| Claim ready task | ProjectTask/readiness dependencies | two controllers claim or predecessor changes | row locks/atomic UPDATE, expected version, one command journal | independent-store concurrent claim |
| Advance task state | ProjectTask/version | stale tick, cancel vs progress | whitelist, expected version/CAS +1, transaction/audit | stale/cancel race and direct SQL rejection |
| Replay command | command/intent/result | same ID with changed payload, lost COMMIT ACK | unique idempotency key, immutable intent/result, reconciliation read | changed-intent conflict and ACK-loss harness |
| Bind approved plan | immutable FeaturePlan/approval | plan revision changes during approval | exact revision/draft/execution fingerprints, scoped FK, state binding | stale-plan/approval race |
| Persist execution transition | DevelopmentExecutionRun/current revision | duplicate start/correction, restart after commit | canonical snapshot fingerprint, revision CAS, append-only command journal | concurrent start/correction and restart |
| Request/consume Owner gate | approval_requests + typed binding | duplicate request/decision, cancellation | factual unique gate key, transaction, state/fingerprint binding | concurrent creation/decision/cancel |
| Complete ProjectTask | task/all required nodes/result approval | double completion, unfinished node, stale acceptance | locked/CAS transition, exact final evidence, owner decision binding | concurrent complete and skipped-gate mutants |

Concrete proof suites: `tests/roadmap-contract.test.mts`,
`tests/pg/roadmap-foundation.test.mts`,
`tests/pg/roadmap-foundation-mutations.test.mts`,
`tests/pg/development-controller-store.test.mts`,
`tests/pg/development-controller-integrity.test.mts` and
`tests/pg/development-controller.test.mts`. Direct SQL tests cover enrolled INSERT
bypass, null-required fields, same-transaction coherent journal, cross-tenant/
Project edges and exact Owner decision/audit coupling. Mutations must import/run
and fail behavioral assertions, not merely fail compilation.

## Operational migration and rollback notes

Verification uses disposable PostgreSQL only: fresh full chain and populated
`0018 → B3` upgrade, existing row preservation, legacy/manual task readability,
no fabricated membership/approval/evidence and direct SQL attacks. Constraints and
triggers must enforce new invariants without silently backfilling unknown facts.
Operators must not apply new schema to production as part of this task.

Application rollback means disabling the B3 composition and preserving new
durable rows for recovery/audit. Never edit historical migrations or drop a new
table containing unresolved execution/approval history to simulate rollback.
A future approved operational migration is required for destructive schema
reversal; B3 supplies no such authorization.

## Debt and live boundaries

AI-037.2 executor terminal capture/identity/retrieval is integrated; B3 implements
only the controller-required canonical DevelopmentExecutionRun recovery slice,
pending independent acceptance.
Generic Step recovery/tooling remains outside that claim. AI-037.3 controller
COMMIT reconciliation and AI-037.8 task claim/admission are narrow prerequisite
slices implemented and internally verified; broader historical packages remain
PARTIAL/deferred, not DONE. AI-037.6b stays
deferred if no long-lived controller lease is introduced.

`runtimeDispatchAllowed=false`; production/live dispatch BLOCKED. No real provider
calls, credentials/API keys/OAuth/WIF, inference, managed Agent/Environment/Session
creation, remote Git, commit/push/merge/deploy or private execution are authorized.
Local/VPS/self-hosted coding remains blocked before AI-052. AI-044 is the later
separately approved real feature proof, not satisfied by this fake controller.
