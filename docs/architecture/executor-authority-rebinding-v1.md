# Adjacent-attempt executor authority rebinding v1

AI-041.2 Completion Delivery Block, amended Phase R. Internal checkpoint passed;
implementation awaits the same consolidated independent re-gate as c/d. No
separate authority integration. Roadmap v1.5 and all live locks remain authoritative.

## Two distinct admission facts

The existing `admissionFingerprint` remains the complete, per-attempt trusted
`development_task_admission_v1` digest. Its preimage and bytes are unchanged:
normalized plan/task/paths/approval/sets/allowlist/repository **and** executor
identity/capabilities. Literal historical hashes remain pinned by tests. Current
attempt authority still requires this exact full hash, canonical Run hash,
workspace/Project/Run/plan/task/attempt identity and active status.

The new `admissionScopeFingerprint`, domain `development_task_admission_scope_v1`,
independently hashes all stable trusted admission facts: normalized FeaturePlan,
taskId, admitted paths, owner approval required/satisfied and explicit approval
fact, completed/active task sets, repository allowlist and exact repository
ID/baseline. Only executor identity/capability declaration is excluded. Canonical
sorting/snapshot bounds remain the existing implementation; no caller supplies
either digest. Stable equality is not an eligibility grant: new configuration
must pass the common ExecutorAdapter/task admission validators, and concrete
invocations must independently pass capability/mode/artifact validation as before.

## Exact transitions

| Operation | Required pinning |
| --- | --- |
| Current-attempt register/replay/start | Exact full hash and canonical Run; stable scope must also match when non-null |
| Adjacent v2 corrective advance | Same tenant/Project/Run/plan/task, next attempt only, factual predecessor Run hash, identical non-null stable scope; new valid full hash may differ |
| Legacy corrective advance | Same rules as before, including identical full hash; stored scope remains NULL |
| Revoke | No executor rebind; both hashes, attempt and canonical Run remain unchanged; active→revoked, generation+1 |

The new full hash becomes the current factual binding atomically with adjacent
advance and its audit event. Same-attempt executor/capability rewrite, skipped
attempts, changed repository/plan/paths/approval facts or forged history conflict.
No exposure row is ever rebound. Stale prepared OpenAI/Claude exposures cannot
start after a rebind: the existing active authority and exposure generation/full
hash checks remain unchanged in the start store.

## Append-only migration 0018

`0018_executor_authority_rebinding.sql` adds nullable SHA-256-shaped
`admission_scope_fingerprint` only to current authorities and authority events.
Existing rows/events acquire NULL, without UPDATE/backfill or invented evidence.
New registration requires non-null scope through the updated application and
DB insert guard. Legacy NULL cannot be upgraded in place; new implementation
can still perform legacy same-full-hash advance. Coordinate application/schema
versions before any future deployment; old registration code is not a new-scope
issuer. This task performs no production migration/deployment.

One explicit transaction adds the columns and narrowly replaces the existing
authority insert/update/event guards. Immutable-column comparison retains stable
scope; only the advance branch may change the full hash, and only for non-null
v2 scope. Revoke cannot change it. Event scope must equal current scope using
NULL-safe equality. Journal immutability, cyclic deferred integrity FKs and
existing exposure→generation/full-hash event bindings remain in force. No scope
column is needed on exposures: each attempt already pins its full fingerprint.
No identity/result/financial schema, provider constraint, budget or settlement
logic changes. Migrations 0001–0017 are immutable.

DB guards prove shape and transition consistency, not semantic correctness of a
hash preimage. Bounded trusted application derivation remains part of the boundary.
Historical reads/capture keep their existing compatible lock subsequence and do
not require or resurrect current execution authority. Lost COMMIT ACK still
latches the uncertain store closed and never returns a capability.

## Predecessor safety and evidence

Authority advance is factual lineage, not proof that prior remote work stopped.
OpenAI→Claude and Claude→OpenAI may advance, but existing unresolved started/
reconciliation-required predecessors still block successor reserve/prepare/start.
TTL, zero usage, account/model/provider change or a new authority generation do
not clear that barrier. Definitive historical settlement can clear it via the
unchanged common store. No provider/network wait occurs in application DB work.

Real disposable PG RED observed `conflict` in both directions before the fix;
GREEN uses different factual executor identities with equal scope/different full
hash. Tests cover populated 0017 upgrade (old values identical except NULL),
legacy non-switch behavior, direct SQL rebind/revoke/journal/shape attacks,
same-attempt conflicts, new eligible capability declarations, and start/rebind
linearizations across independent backends: two directions × two orders × ten
iterations. Eight executing mutations cover repository/paths scope omission,
ignored scope, same-attempt/legacy/revoke weakening, stale starts and barrier bypass.

Historical populated 0015/0016/0017 tests use a pinned pre-0018 application copy
in disposable DBs, not a downgrade/repair of the current runtime or schema. Their
old preservation assertions remain intact. Current-schema suites use the new
runtime and verify nullable scope/event integrity.

## Non-goals and next gate

Explicit trusted fixture/composition selection only; no Router or selection policy.
No second authority, budget, settlement, audit or corrective lifecycle. No real
provider calls, credentials, OAuth, inference or repository action. No live cost,
configuration-pinning or network enforcement claim. Scope equality cannot grant
any new provider right. `runtimeDispatchAllowed=false`; production/live dispatch
BLOCKED. R passed its internal checkpoint, then full C revalidation; AI-041.2
remains NOT DONE until consolidated independent acceptance and integration.
