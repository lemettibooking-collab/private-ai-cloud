# Development Controller v1 — B3

Status: IMPLEMENTED / READY FOR CONSOLIDATED INDEPENDENT RE-GATE, NOT DONE.
Internal implementation checkpoints A/B/C passed; independent acceptance remains
pending. Baseline: `f36d4ac923f12c5b61602c4cb0a950ad1602edcc`.
See [roadmap persistence](roadmap-autonomy-v1.md) and
[gate/approval semantics](development-approval-gates-v1.md).

## One bounded deterministic step

`ready roadmap work → trusted taskClass → exact approved FeaturePlan → durable
claim/admission → DevelopmentExecutionRun → ExecutorRouter → managed environment
policy → ExecutorAdapter → durable executor outcome → Quality → independent
Security/review → corrective/Owner gate → roadmap progress`.

The core performs at most one bounded control-plane transition/side-effect-intent
step per invocation. No unbounded `while(true)`, model-owned scheduler, generic
think/tool loop, context compactor, browser/computer/subagent runtime or provider
session engine. A future worker may repeatedly call the bounded core; that does
not authorize dispatch, a new long-lived controller lease or new API routes.

Every tick loads validated durable facts, selects one closed next action,
persists the necessary intent under CAS, invokes at most the bounded authorized
port outside the transaction and persists/reconciles evidence. Replay never
turns a historical intention into a new provider-start right.

`createDevelopmentController(...).advanceController(...)` implements that step;
`inspect(...)` reads factual state. The closed `ControllerNextAction` vocabulary is
declared in `development-controller-policy.ts`: claim/plan approval consumption,
start plan, create/start DevelopmentRun, select route, start/await executor,
run/report Quality/Security, corrective attempt, Owner/result acceptance,
completion, recovery/hard stop/none. No arbitrary command string gains authority.

## Reused factual pipeline

Existing admission validates the exact materialized approved FeaturePlan/task and
allowed paths. Trusted taskClass comes only from persisted ProjectTask type or
factual corrective attempt. Router is separate from ModelRouter, filters before
ranking and returns `dispatchAuthorized=false`, `runtimeDispatchAllowed=false`.
Managed environment selection is policy evidence, not allocation or enforcement.

The existing shared executor lifecycle owns authority, scope/full fingerprints,
budget/exposure reservation, predecessor barrier, provider-start fence, provider
identity, outcome, settlement and retrieval-only reconciliation. No controller
row, route fingerprint or executor return can substitute for those facts.
No separate Claude store, provider-specific controller or financial lifecycle.

Full `admissionFingerprint` remains per-attempt executor bound; stable
`admissionScopeFingerprint` permits only accepted adjacent corrective rebinds.
Same-attempt/legacy NULL-scope executor switching remains blocked. Unresolved
predecessors block successor reserve/prepare/start regardless of provider/account/
model change, authority generation or elapsed time. Definitive historical
settlement may clear the barrier without reviving old authority.
Corrective routing retains stable per-run admission binding while separately
re-checking current dynamic Admission/path conflicts. Route selection records no
executor authority/exposure; only the accepted fenced lifecycle can issue a
one-use start capability. Production blocked composition does not prepare/start
an executor.

Ephemeral executor returns are not durable terminal evidence. Controller progress
must reread existing outcome/settlement facts. Known provider identity permits
bounded retrieval/reconciliation only. Unknown identity after possible
transmission retains full exposure/recovery and never redispatches.

## Persisted state and restart

DevelopmentExecutionRun is the sole per-node corrective state machine. Persist
its canonical validated snapshot, fingerprint, exact plan/revision/task/run
bindings and monotonic revision. Every read revalidates snapshot and digest.
Every transition requires expected revision, commandId/intent fingerprint and
immutable journal result. Never accept arbitrary caller snapshot overwrite.

### Proven report-only analysis contract gap

B3's trusted mapping requires investigation/roadmap → analysis → `analysis_only`.
The accepted ExecutorAdapter requires report-only success to have `changes=[]`;
the prior AI-011 `submit_patch([])` correctly denied empty patches. Pretending a
report changed a repository path would fabricate evidence. New RED tests proved
the unsupported event and missing report-only lifecycle.

The narrow extension adds `submit_analysis { reportFingerprint }` (exact lowercase
SHA-256) and optional per-attempt `analysisReportFingerprint` only when explicitly
submitted. Existing states, attempt count and gates are reused. Analysis cannot
carry changed paths; verification/review/completion and failed history require
actual patch paths OR this explicit digest. Implementing/implementation-failure/
policy-block snapshots cannot carry premature report evidence. Legacy patch
snapshots retain their exact canonical shape; empty patch submission still denies.

The durable controller accepts the event only from a factual settled succeeded
`analysis_only` invocation with no changes and matching non-null report digest.
Historical predecessor rewind removes only this new optional submitted-output
field when reconstructing the old empty implementing attempt; legacy hash vectors
remain unchanged. No report text, path fabrication, second corrective state
machine or execution authority is introduced. Proof:
`tests/development-execution-analysis.test.mts` plus the original AI-011 suite and
analysis-only/corrective real-PG controller coverage.

Completed independent DevelopmentTasks remain completed across process restart;
dependent nodes cannot start until their factual DAG predecessors complete.
Within-wave parallelism still needs admission/path-conflict proof; otherwise
serialize or block deterministically. No second overlapping concurrency scheduler.

### Cooperative wave-frontier scheduling (B3 corrective)

Active-node coexistence is not proof of concurrent executor progress: two
`implementing` snapshots alone say nothing about independent committed starts.
The controller therefore selects across the entire current incomplete DAG wave,
not the first incomplete run's entire lifecycle. Admit missing compatible nodes
and activate persisted ready attempts (activation precedes another admission so
overlapping ready snapshots cannot stall). Then select corrective/initial attempt
pre-wait stages by phase: route every eligible sibling, then request/start each
executor operation. Only once those siblings reach the safe external-wait frontier
may an earlier run's outcome be consumed. Canonical wave task order is the stable
tie-break within each phase. Each tick still returns one bounded action, with no
background promise loop, new scheduler, queue, lease or concurrency table.

Task-level blocked/recovery and existing run hard-stop/Owner boundaries retain
precedence. Path Admission remains the final overlap veto; a conflicting sibling
cannot obtain an executor operation while the first node owns the active path.
Routing grants no authority: the same persisted intent/CAS, current authority,
budget/exposure, environment and provider-start fences still decide each start.
The frontier does not turn unknown outcomes into retry rights or clear a
predecessor barrier. Existing B3 migrations `0019`/`0020` are unchanged.

Proof uses delayed durable outcome ingestion, not merely active snapshot counts:
two disjoint nodes have distinct factual executor operations and committed start
evidence before either node's terminal outcome is consumed; both later pass the
normal gates/completion path. Restart after one start permits the other disjoint
start, restart after both starts duplicates neither. Independent controller
instances race through the same CAS/start fences; overlapping paths remain
serialized. M21 reintroduces first-started-run serialization and is killed by an
executed behavioral assertion. These are implementation proofs, not independent
acceptance; AI-043 remains NOT DONE pending consolidated re-gate.

| Restart boundary | Required factual reconstruction |
|---|---|
| Claim committed | Read command/task version; do not claim twice |
| Plan approved, not started | Validate exact current approval/revision, then bounded next step |
| Authority registered | Reuse factual binding; do not infer a start capability |
| Start committed, identity unknown | Recovery/full hold; never replay Create |
| Known provider identity | Retrieval-only inspection/reconciliation |
| Definitive executor outcome | Consume durable canonical settlement, not old in-memory return |
| Quality/Security evidence saved | Revalidate bound fingerprints; never fabricate skipped gate PASS |
| Waiting Owner | Read one factual pending/decided request; no duplicate gate |
| Owner decision committed | Consume only if exact state/version/fingerprints still match |
| Controller COMMIT ACK lost | Reconcile command/revision/intent; unknown means recovery |

Short transaction/CAS ownership avoids a lease spanning slow work. No pooled
connection is held during provider/verification/network work, no second pooled
connection is acquired inside a transaction, and no session-local/advisory locks
are introduced. Existing transaction error/release rules remain mandatory.

## Corrective orchestration

`failure evidence → classify AUTO/OWNER/HARD STOP → factual predecessor settlement
→ repair taskClass → Router rerun → permitted authority advance/rebind → next
DevelopmentExecutionRun attempt → affected checks → FULL required Quality →
independent Security/review → final Owner acceptance`.

Use existing `maxAttempts=3`, failure fingerprint repetition and nonretryable/
scope-expanded events; no second corrective attempt counter/state machine.
Quality failure/success maps to verification_failed/verification_passed;
Security/review failure/success maps to review_failed/review_passed. Missing gate
evidence never advances the state. Protected/system-forbidden failures are hard
stops, not normal Owner-overridable approvals. Unknown outcomes cannot be retried.

ProjectTask completion requires every required plan node completed, no unresolved
executor outcome/exposure, full required Quality and independent Security PASS,
exact fresh final Owner acceptance and coherent durable fingerprints. Executor
success or technical PASS alone is insufficient. No result acceptance authorizes
commit, push, merge or deploy.

## Controller race primitives

The checked-in proof suites exercise these primitives; consolidated report records
final exact counts and commands. Internal proof is not independent acceptance.

| State change | Shared resource | Race | Primitive | Proof requirement |
|---|---|---|---|---|
| Reserve node attempt intent | task/node/run revision | duplicate tick/start | unique node/attempt intent, short lock/CAS/journal | two independent PG stores, one right |
| Persist node transition | canonical snapshot/current pointer | stale writer, completion vs cancellation | validated snapshot, revision CAS, exact command intent | impossible revision/fingerprint attacks |
| Dispatch bounded fake port | existing start/exposure | duplicate transmission, restart | accepted one-use provider-start fence, predecessor barrier | no redispatch after ambiguous outcome |
| Consume executor outcome | exposure/terminal row | returned transient success vs missing settlement | durable outcome revalidation, same factual identity | restart after terminal/unknown result |
| Persist gate evidence | run/node/attempt/digest | duplicate gate, stale evidence | bounded normalized fingerprinted evidence + command/CAS | tamper/missing/stale and duplicate tick |
| Advance corrective attempt | previous outcome/current authority | two corrections or provider switch before settlement | existing adjacent-attempt contract + barrier + CAS | both provider directions, max/repeated failures |
| Advance DAG wave | required node completions | dependent start early, old completed node rerun | factual wave derivation and unique persisted node identity | dependent/restart behavioral mutants |
| Complete task | all nodes/approvals/current version | concurrent acceptance/completion/cancel | transaction/CAS + fresh final binding | exactly one completion, Owner gate required |

## Production boundary and proof plan

Production composition may select/reconcile facts but must stop at factual
live-unavailable/blocked state; no hidden env flag or public option unlocks an
executor. Test/internal ports provide deterministic fake executor and gate
evidence only. No shell command is taken from executor text; local verification
is reused only with trusted materialized repository/worktree and approved command.
Without one, deterministic test QualityGatePort is required.

Checkpoint A preceded controller implementation; B proved durable controller,
restart/no-redispatch/races; C proved gates/corrective/Owner acceptance before
the read-only Owner UX was added. Core proof includes both-provider successful/
corrective/hard-stop E2Es, real disposable PG races, hostile input, lost ACK and
behavioral mutations. Pure policy tests prove disjoint/overlapping scopes,
dependency waves and completed-node restart behavior. Concrete suites:
`tests/development-controller-policy*.test.mts`,
`tests/pg/development-controller*.test.mts` and
`tests/pg/roadmap-owner-read.test.mts`. Final regression/full verification counts
remain in the consolidated report; AI-043 is NOT DONE until independent acceptance.

`runtimeDispatchAllowed=false`; production/live dispatch BLOCKED. This is not
AI-044 live feature proof or AI-052 physical/private execution closure.
