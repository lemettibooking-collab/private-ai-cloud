# Approved project backlog → managed Roadmap — PAC-DEV-01

Status: implementation candidate, READY FOR INDEPENDENT REVIEW only after saved
verification is complete. No author-issued gate PASS. `runtimeDispatchAllowed=false`.

## Authority and temporal boundary

Project-plan approval and Roadmap enrollment are separate committed Owner actions.
The original 0024 `project_planning_approval_integrity()` draft/NULL milestone
predicates validate **initial materialization in the approval transaction**. They
are not perpetual ProjectTask lifecycle requirements. No trigger is disabled,
replaced or reinvoked against evolved tasks; no migration is introduced. Approval
replay validates factual historical evidence and never materializes tasks again.
The earlier external diagnostic probe illustrates this temporal distinction only.

`readApprovedProjectPlanningInTransaction` narrowly reuses validateStored,
validateDecision, generation evidence, exact creation intent fingerprints, immutable
links and task-created audits on the caller's existing authorized client. These
prove historical provenance independently of later Roadmap status. Original AI
requester/identity and current Owner/active identity remain mandatory. Tenant
comes from the branded resolver, not form data. Callers provide selectors only.

## Explicit enrollment

Planning UI → bounded selector-only Server Action → authenticated server composition
→ active-project SHARE scope → roadmap guard → existing task rows. Preview sends
nothing and creates no journal/guard. Enrollment requires an already committed,
factually approved plan, exact revision and fingerprints and reviewed intent.

One deterministic milestone groups the existing materialized ProjectTasks. No new
task is created. Initial admission requires original title, goal, type, priority,
null risk, draft status, version zero and no conflicting milestone/metadata.
Source dependency IDs resolve only through exact immutable planning links. The
complete final graph includes unrelated project tasks and uses existing 256-node,
64-dependency and acyclicity validation. Metadata uses the existing canonical
Roadmap normalizer; incompatible requirements deny the entire operation. Scope and
criteria are retained without truncation, canonicalized as the existing metadata
contract specifies. The immutable approved plan retains description, original
source manifest, scope, criteria and references. Proposed scope is never a trusted
filesystem allowlist.

Artifact labels explicitly describe policy requirements for Quality and independent
Security reports, not factual execution evidence. Both gates and Owner approval
policy remain required. Batch receipt stores compact fingerprints/counts under the
existing <8192-byte owner-command bound. Detailed task snapshots and dependencies
remain in existing per-task journals. Existing transaction-local enrollment logic
is extracted from roadmap-owner-commands; public wrappers are never called inside
an open transaction. Milestone, task updates, edges, journals, audits and receipt
commit atomically. Any collision/incompatible metadata/audit failure rolls back.

## Concurrency and replay

Order: Owner/identity → workspace/project SHARE → roadmap guard UPDATE → task rows.
New enrollment/readiness task locks use NOWAIT. This prevents waiting for a
FeaturePlan task-first writer while its project SHARE could be queued behind an
unrelated project UPDATE (including approval replay). Contention denies without
mutation; the Owner can reload/retry. No project lock upgrade, nested transaction,
second connection while owning a transaction, provider or slow network await occurs.

Ordinary createTask joins the same project guard, including before the first
milestone exists. Projects without a Roadmap milestone retain prior creation
semantics. Once managed, creation checks the 256-node bound under that guard;
exact idempotent replay remains possible at capacity. This is necessary because
project SHARE alone permits concurrent inserts and cannot protect a bounded graph
snapshot. The pre-fix diagnostic proves a 256-node snapshot followed by concurrent
ordinary creation could commit an unusable 257-node graph. No competing scheduler,
queue or task model is added. The existing guard row is short-transaction metadata.

Exact enrollment replay verifies the immutable batch receipt, per-task enrolled
snapshots, actor, and current Roadmap journal, then returns historical committed
facts without re-enrollment or reverting progressed tasks. Changed intent conflicts.
Readiness replay additionally binds the ready journal and exact saved FeaturePlan.
Lost COMMIT acknowledgment returns through a separate reauthorized transaction after
the first session is released, reading receipts only; mutation is never repeated.
Unknown or unverifiable outcomes deny; no success is guessed.

## Explicit readiness

An enrolled task stays draft, so existing FeaturePlan saving continues to work.
The Development page shows approved-plan provenance, enrollment, dependency status
and a separate readiness form only with a saved plan. The action binds task state
version, current FeaturePlan ID/revision/fingerprint and approved backlog intent.
Under the guard and task lock it rechecks the active milestone, exact latest
canonical saved FeaturePlan, task DAG and creation audit, then uses the existing
journaled draft→ready transition. It does not approve the FeaturePlan.

Ready means Owner readiness admission, not completed predecessors or execution
permission. Existing Roadmap claim logic still blocks incomplete dependencies.
AI-043's deterministic controller remains authoritative and still requires typed
`development_feature_plan_approval`, Quality/Security, Owner result acceptance and
all runtime/financial/executor fences. Enrollment/readiness never claim, tick a
controller, call a provider/executor, modify a repository or enroll an execution.
Production binding remains blocked.

## UI and verification

The existing Planning and task Development pages are extended, with shared EN/RU
controls, escaped content, factual milestone/task mapping, scoped Roadmap links and
selector-only bounded forms. Duplicate, unknown, oversized and stale inputs deny.
Server Actions reauthenticate per request and invalidate relevant factual views.
No additional dashboard or scheduler UI is introduced.

Behavioral evidence and limitations are recorded in docs/qa/PAC-DEV-01-REPORT.md
and /private/tmp/PAC-DEV-01/. Only disposable PostgreSQL and deterministic/fake
ports are used. No live-provider or browser E2E proof is implied by unit rendering.

## Corrective 01 — current dependencies versus immutable provenance

An enrolled preview retains the current Roadmap snapshots already checked against
the latest per-task journal. `dependencyIds`, predecessor `dependencies` statuses,
task status/version and `dependencyCount` describe those current facts. Original
approved-plan mappings remain separately exposed as `originalDependencyIds` and
`originalDependencyCount`. The enrollment intent, initial receipt, initial journal,
approved plan and fingerprints are never rewritten by this projection.

Preview takes SHARE on an existing project guard, without inserting it, so the
whole projection is coherent with authorized graph/state writers. An enrolled
receipt without that guard, invalid/missing current journal, malformed predecessor
status or missing predecessor denies. IDs and status rows are bounded and sorted
with the existing locale-independent identifier order, independent of DB collation.

Planning labels distinguish current Roadmap dependencies from original approved
plan counts. Before enrollment, mapping/status is explicitly proposed, not a
committed current graph. Development's EN/RU current dependency status comes only
from the current verified list after enrollment. These facts do not infer
completion, readiness or execution permission; the existing admission/claim gates
remain authoritative. Authorized `metadata_changed` dependency additions/removals
remain supported, and exact enrollment replay preserves that evolved graph.
