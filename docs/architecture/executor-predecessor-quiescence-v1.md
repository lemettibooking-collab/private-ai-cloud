# Executor predecessor quiescence barrier v1 — AI-041.2b1

Status: **IN REVIEW**. Baseline `f782e1e438b4030efeba1bd70b90485ab71a52e3`.
Implementation is ready for independent re-gate, not an author-issued PASS.
`runtimeDispatchAllowed=false`; production/live dispatch **BLOCKED**.

## Threat and invariant

Current-authority advance proves factual adjacent canonical Run/attempt history,
not termination of earlier remote work. Without a separate admission barrier,
started attempt N and corrective attempt N+1 could both have committed starts.

For the same trusted **workspace + DevelopmentRun**, any earlier committed start
without definitive settlement blocks successor **reserve, prepare and start**
with `deny / recovery_required`, null snapshot and null start capability. The
barrier precedes idempotent/replay responses and adds no successor hold or write.
It does not consider provider/model/account/executor/invocation changes or spare
aggregate budget. It is not a provider stop mechanism.

## Ownership, state and bounds

`lib/db/executor-predecessor-barrier.ts` is a small internal SQL predicate called
from the existing start store's shared active transaction runner. No second
controller, lifecycle, registry, quiescence table/boolean or new authority issuer.

The query binds resolver-owned workspace, validated Run ID and current attempt.
It reads only smaller attempt numbers, ordered, limit 3; at most two predecessors
are valid because attempts are bounded to 1–3. Attempt 1 performs no predecessor
query. No workspace-wide history scan or cross-Run task-deduplication policy.

| Predecessor state | Interpretation |
|---|---|
| reserved / prepared | Never started; no remote-overlap barrier; existing budget still held |
| cancelled | Cancelled before start; no barrier |
| start_committed / reconciliation_required | Committed start; successor blocked |
| settled | Clear only with start/settlement fields, matching immutable result binding and current audit event |
| malformed/unknown/incoherent | Throw into existing transaction uncertainty latch; no admission |

No result-body interpretation with the successor's potentially different executor
configuration. Existing definitive capture/validation, immutable result/exposure
relations and audit constraints establish accepted settlement; the predicate
checks exact request/result/timestamp and journal relationships. It neither
creates a terminal result nor releases money. All rows are bounded snapshots.

Expiry, zero/missing usage, timeout/disconnect, process death, changed invocation,
authority generation or recovery_required status never prove quiescence. A
started predecessor clears only through existing definitive settlement. Ordinary
aggregate/expiry/auth checks still apply after the barrier clears.

## Locks and race linearization

Active operations retain the existing order:

`workspace SHARE → Project SHARE → current authority UPDATE → workspace budget UPDATE → predecessor read → current exposure UPDATE`.

The shared predicate executes **after** acquiring the budget serialization lock,
before current-attempt reads/mutations or active replay responses. It takes no
predecessor row lock and introduces no inversion. All cooperating exposure and
settlement writers already serialize on that same budget row. The existing
READ COMMITTED transaction sees a settlement committed while it waited. No
provider/network await, new connection, advisory lock or session-local state.

Start wins authority lock: old start commits; authority may then advance, but
successor sees the durable unsettled predecessor and denies. Advance wins: old
start fails existing current-authority checks; unstarted old exposure does not
block successor. Neither ordering permits both starts to commit.

Settlement wins budget lock: exact terminal/result/release/audit commit first,
then successor may reserve. Successor wins: it sees unresolved start and denies;
historical settlement can follow and the next explicit admission may succeed.
There is no special barrier release/counter update.

## Historical recovery, failure and boundary

Authority advance remains unchanged and allowed. Historical inspect, identity
inspection/observation, evidence, reconciliation and settlement use their existing
compatible workspace/Project/budget/exposure lock subsequence, without current
authority or this active-work barrier. They cannot revive old execution authority.
Paid historical output remains recoverable; release is exactly once.

Normal blocking does not latch the instance: legitimate settlement can unblock
it. DB errors, malformed facts or uncertain COMMIT retain the existing latched
recovery behavior and null outputs. A fresh trusted inspection derives facts from
durable state, not an in-memory blocker list. Lost settlement ACK does not return
success; factual committed settlement can be independently inspected later.

This is an **application/store invariant**, not a new schema constraint against
DB-owner direct writes. A disposable test restores a valid baseline-compatible
prepared-successor snapshot with matching authority/events/counter (no existing
row or constraint rewritten) to prove replay/prepare/start rechecks. Such states
were admitted before b1; the fixed API cannot create that overlap naturally.

Real PostgreSQL tests force both race orders x10, verify zero deadlocks/duplicate
rights, full holds, historical retrieval settlement, account/model independence,
workspace/Run isolation, restart, expiry/usage and uncertainty. M1–M8 execute on
temporary module copies against real disposable DBs; compile/import failures do
not count as killed mutants. Existing executor/seam/byte-compatibility gates stay.

## Deferred work

For this fake/durable slice, definitively settled is quiescent enough for the
successor. This does **not** prove physical remote tool/process death for a live
provider; live evidence/finance/network/configuration gates remain required.
No migration, provider constraint change, Claude, credentials, OAuth, inference,
remote Git or dispatch enablement. Next prerequisite is independently gated
**AI-041.2b2 — Append-Only Provider Constraint Migration**. Overall AI-041.2 remains
NOT DONE; roadmap sequencing and the managed-before-AI-052 decision are unchanged.
