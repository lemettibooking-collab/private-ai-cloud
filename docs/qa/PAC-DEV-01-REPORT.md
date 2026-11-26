# PAC-DEV-01 — approved backlog enrollment and explicit readiness

READY FOR INDEPENDENT REVIEW / READY FOR RE-GATE (author status only).
`runtimeDispatchAllowed=false`.

The Planning page now offers separate reviewed Owner enrollment of an already
committed approved manual/generated plan. Existing draft ProjectTasks are enrolled
in one deterministic milestone with exact translated dependencies, existing
Roadmap metadata and immutable per-task journals. A compact batch receipt and
summary audit commit atomically. No task is duplicated or automatically readied.
The task Development page exposes provenance, dependency facts and a separate
ready action for the exact current saved FeaturePlan displayed to the Owner.

The ADR distinguishes unchanged 0024 initial materialization checks from durable
planning provenance and subsequent 0019/0020 Roadmap lifecycle. Existing validation
and task-creation audit/fingerprint checks are reused transaction-locally. No
migration, controller policy, executor lifecycle, financial control or provider
adapter is changed. Model scope never becomes a trusted filesystem allowlist.

A real-PG baseline race proved that ordinary task creation could grow a guarded
256-node graph to 257 nodes. The Owner explicitly expanded scope to
lib/tasks/owner-task-mutations.ts: creators now join the guard and enforce capacity
for managed projects, preserving exact replay at capacity. Unmanaged tasks retain
their existing creation semantics. The Owner separately authorized exact inventory
and fixture updates in tests/owner-console-visual.test.mts,
tests/owner-task-create.test.mts and tests/project-planning.test.mts; safety
assertions are retained and extended, never skipped.

Lock order is Owner/identity → workspace/project SHARE → roadmap guard → task.
New task locks use NOWAIT to avoid a wait cycle with task-first FeaturePlan save
and queued project UPDATE/approval replay. Contention denies without mutation.
Lost COMMIT acknowledgment is reconciled through factual receipts after the first
connection is released, never by repeating mutations. Historical replay does not
revert progressed tasks. The original enrollment actor remains pinned separately
from current Owner authority; original generation identity remains mandatory.

Behavioral evidence covers both origins, exact dependencies, pending/rejected and
tenant/authority denials, original identity, concurrency/CAS/replay, graph bounds,
metadata and milestone conflicts, partial rollback, immutable creation evidence,
FeaturePlan save/readiness races, historical reads/approval replay after evolution,
unjournaled SQL denial, mandatory typed FeaturePlan approval and dependency claim
blocking through the existing AI-043 controller fixture. EN/RU tests exercise real
controls/actions, escaping, form bounds and stale displayed FeaturePlans.

Full commands, counts, initial failed attempts, RED/GREEN, exact patch hash,
whitespace verification and disposable PostgreSQL cleanup are recorded under
/private/tmp/PAC-DEV-01/REPORT.md and FINAL-VERIFICATION.md. Environmental Node
contract mismatch and Google Fonts build failures must remain disclosed; no
successful full build, browser E2E or live execution is claimed.

## Corrective 01 — current dependency projection

READY FOR TARGETED INDEPENDENT RE-GATE (author status only).
The independent P2 finding is corrected: enrolled previews use journal-verified
current dependency IDs, versions and predecessor statuses. Original approved-plan
and initial enrollment evidence remains immutable and is projected separately.
EN/RU labels distinguish current, original and unenrolled proposed dependencies.
Real PostgreSQL regressions exercise actual authorized metadata_changed removals,
additions and repeated edits, stale/conflicting commands, exact enrollment replay,
unchanged historical evidence and fail-closed malformed/missing current facts.
Corrective evidence and full candidate SHA-256:
/private/tmp/PAC-DEV-01-CORRECTIVE-01/REPORT.md.
No migration, controller/claim policy, authorization, financial or execution change.
`runtimeDispatchAllowed=false`.
