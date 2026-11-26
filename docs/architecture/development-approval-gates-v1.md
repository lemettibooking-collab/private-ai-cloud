# Development Approval and Verification Gates v1 — B3

Status: IMPLEMENTED / READY FOR CONSOLIDATED INDEPENDENT RE-GATE, NOT DONE.
Internal implementation checkpoints passed; independent acceptance is pending.
Baseline: `f36d4ac923f12c5b61602c4cb0a950ad1602edcc`.

## One approval system, three deterministic classes

Reuse generic `approval_requests` for the Owner queue and decisions. Any new
typed development binding is a narrow authority/integrity adapter referencing
that queue, not a second approval subsystem or arbitrary JSON authority.

| Class | Examples | Boundary |
|---|---|---|
| AUTO | readiness, route selection, already-authorized verification, bounded repair inside exact scope/risk/budget | Never dispatch authority or approval to increase limits |
| OWNER | exact FeaturePlan approval, scope/architecture/roadmap change, budget/risk increase, final result acceptance | Current exact typed binding required; does not waive hard stops |
| HARD STOP | tenant/security invariant, forbidden path, corrupt exposure, impossible fingerprint/revision, unsafe unknown outcome, tampered evidence | Cannot be converted to ordinary overridable Owner approval |

Commit/push/deploy classify as OWNER but remain unavailable (`available=false`,
no B3 purpose/operation grant). New live provider/
credential/configuration, high-risk migrations and physical/private execution
are not enabled by B3 approval records. No model-proposed roadmap mutation is
automatically accepted.

## Exact immutable plan approval

Saved FeaturePlan revisions remain draft and immutable. Approval binds workspace,
Project, ProjectTask, plan key/exact revision, stored draft fingerprint,
deterministically materialized approved execution-plan fingerprint, admitted scope/
paths, risk, purpose, Owner actor and request/decision identity. Materialization
with approved status must not overwrite the stored historical draft JSON.

Changed plan revision, task/roadmap state or approved fingerprint requires a fresh
binding. Same factual gate must create one request across restart/concurrent
ticks. Request existence is not approval; old approval is not authority over new
state. Unknown/malformed binding denies without partial executable output.

The bounded classifier/typed-binding domain covers `feature_plan_approval`,
`scope_change`, `budget_or_risk_increase`, `architecture_change`, and
`result_acceptance`. B3 automatically creates only factual plan, scope and final
result requests. Budget/risk and architecture changes classify as OWNER, but no
new configuration/change-authority producer is invented: without its factual
binding, request creation remains unavailable. Scope
changes cannot silently become repair within the old approval. Exact concrete
purposes use typed `roadmap_approval_bindings` / `controller_owner_gate_bindings`
into the existing queue, with immutable command journals and same-transaction
request/decision/Owner actor/audit coherence enforced by migrations `0019`/`0020`.

## Quality evidence boundary

Controller consumes normalized bounded factual evidence, never executor text
claiming checks passed. Required commands come from the existing
DevelopmentExecutionRun.requiredVerificationCommands. PASS requires factual PASS
for every required command/check. Missing, failed, timed-out, truncated or
unsupported required evidence is not PASS and must follow deterministic fail/
hard-stop policy. Evidence is attempt/run/plan/fingerprint bound and sanitized;
no secrets/raw provider errors or unbounded logs.

`lib/local-handoff/local-verification-runner.ts` is QA, not an executor or general
shell runner. It can be used only with trusted repository/worktree facts and
approved commands. B3 fake proofs use deterministic gate ports when no trusted
materialization exists; never fabricate one from provider output.

## Independent Security/review

Security/review is separate from the patch-producing executor. Minimum normalized
outcomes are pass, retryable failure, Owner-required failure and hard stop.
Bounded/fingerprinted evidence binds reviewer provenance to the exact execution
result. Executor success cannot self-certify Security PASS. Independent review
does not waive missing Quality evidence or final Owner acceptance.

DevelopmentExecutionRun remains the single state machine: Quality maps to
verification_passed/verification_failed and independent review to review_passed/
review_failed. Scope expansion uses existing Owner-decision behavior; bounded
retryable failure uses existing correction behavior; repeated/max/nonretryable
failure uses existing blocking behavior. Controller stores additional gate
evidence around this contract rather than inventing another lifecycle.

## Corrective and final acceptance constraints

After failure, persist bounded evidence before classifying. AUTO is allowed only
inside approved scope/risk/budget and existing maxAttempts=3. Predecessor must be
definitively settled; unknown transmission/outcome never permits redispatch.
Derive repair taskClass from factual attempt, reroute, re-enter existing authority/
reservation/start lifecycle and rerun full Quality plus Security after any fix.
Affected-check success alone cannot complete a task.

After all required nodes and technical gates pass, task waits for final Owner
result acceptance. Approval is consumed only for the exact current state and
result fingerprints. Rejection follows deterministic bounded corrective policy
only when scope/attempt/risk/budget permit; otherwise stop. Completion also
requires no unresolved outcome/exposure. No automatic repository/Git mutation.

In this slice, final rejection blocks the ProjectTask: the technically completed
AI-011 node is terminal and is never rewound to fabricate another attempt. A scope
decision likewise cannot rewrite the immutable approved plan or resume a stopped
node with wider permissions. New scope/configuration needs a new factual approved
plan/admission path; ordinary Owner approval cannot override system hard stops.

## Approval/gate race-safety matrix

Proof suites: `tests/development-gates.test.mts`,
`tests/development-gates-mutations.test.mts`,
`tests/pg/development-controller.test.mts`,
`tests/pg/development-controller-integrity.test.mts` and
`tests/pg/development-controller-mutations.test.mts`. Behavioral mutations cover
missing QA/Security, automatic scope expansion, repeated/max attempts, hard-stop
override, skipped final acceptance and stale Owner decisions. Layered service/DB
backstops remain checked separately; compile/import-only failures are not kills.

| State change | Shared resource | Race | Primitive | Required proof |
|---|---|---|---|---|
| Create gate request | approval queue/factual gate binding | restart/two ticks duplicate request | unique factual gate identity + one transaction/idempotent command | concurrent create yields one request |
| Bind exact plan | immutable revision/task version | revision changes before approval | typed exact revision/digests, lock/CAS and scoped FK | stale approved revision denied |
| Decide Owner request | request/decision/current binding | approve vs reject, two decisions | one-winner existing queue decision + transaction/version | independent-store Owner decision race |
| Consume decision | task/controller version/fingerprints | tick vs cancel/plan edit | current-state fingerprint/revision equality under CAS | approval cannot authorize changed state |
| Save Quality evidence | attempt/required command set | missing result treated PASS, duplicate command | normalized complete required set, digest, immutable journal | missing/timeout/truncation mutants |
| Save Security evidence | same result/independent reviewer | executor self-review, skipped gate | separate trusted port, exact provenance/result digest | skip/self-certification/tamper denial |
| Start correction | failure/scope/budget/predecessor | scope expansion auto-approved, unresolved prior executor | hard classifier, existing attempts/barrier and fresh admission | max/repeated/scope/barrier mutants |
| Accept final result | all nodes/final Owner request | technical PASS mistaken Owner acceptance, double complete | exact final approval + CAS/task completion transaction | skipped Owner mutant and completion race |

## Read-only Owner projection

Minimal real reads must distinguish ready/running/verifying/waiting_owner/blocked/
recovery_required/completed, and show factual milestone/task/node progress, route
selection, current attempt, pending Owner decisions and latest gate summary.
Selected route is not a started executor; approval request is not a decision;
technical PASS is not Owner acceptance. No fake live availability, new B3 UI write
action or sensitive/raw evidence projection. Locale is presentation-only.

The implemented `/roadmap` uses a request-time Server Component and server-only
`loadOwnerRoadmap`. Trusted workspace resolution + existing GitHub session
identity precedes the existing Owner-role predicate held with SHARE locks. Denial
performs zero raw roadmap reads. Project selectors narrow only registered active/
paused Projects; malformed/unknown/foreign selectors never fall back to workspace.
Existing per-project guards are selected FOR SHARE, never upserted by a GET.
The shared canonical controller/history reader uses its no-row-write-lock mode;
no controller mutation/dispatch method is invoked. The public DTO exposes only
bounded milestones/tasks/nodes, closed gate/status labels, selected executor,
attempt/revision, pending purposes and factual held exposure (not invented spend).
It excludes raw context, reports, paths, digests and provider/account/session/model
identity. Malformed canonical state fails the entire view closed.

Real PG reads and unit/server-component render tests prove authorization-before-
read, tenant/Project scoping, real readiness/gate projection for both fake
providers, no read-created guard/controller/approval/audit rows, no raw driver
disclosure and RU/EN read-only presentation. Relevant Next guides were read from
the installed dependency. `connection()` remains outside generic error handling;
page searchParams is awaited. Full Next build verification is in the report.

`runtimeDispatchAllowed=false`; production/live dispatch BLOCKED. Real accounts,
credentials, provider access, live TOCTOU/network/materialization, real sufficient
financial bounds/reconciliation, remote quiescence and approved live smoke remain
separate blockers. Fake gate/executor proof does not resolve them.
