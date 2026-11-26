# AI-041.1c — Durable current executor authority

Status: IN REVIEW. Baseline: `d72a439a456cb1370b49448fb354ea93b381907b` (AI-041.1b DONE / COMMITTED / PUSHED). AI-041.1 remains IN REVIEW; production/live dispatch remains BLOCKED.

## Trust and scope

B0 validates a canonical AI-011 snapshot, but a stale factory is not evidence that this attempt is authorized now. The internal authority store accepts only a branded tenant, trusted Project and ExecutorAdapter configuration. Its server-only export has no route, Action, UI, invocation authority fields or start issuer. Caller invocation identity remains serializable correlation/consistency evidence, never a grant. No credential reads, network, OAuth or inference.

AI-011 has cancellation but no paused status or durable lifecycle. This slice persists only current executor permission, not a second lifecycle. Project active/paused/archived remains exclusively in the Registry. There is no DevelopmentTask → ProjectTask FK; the authority's Project relation is tenant-scoped.

## State, identity and fingerprints

Migration `0014` adds `executor_run_authorities`, keyed by `(workspace_id, development_run_id)`, with active/revoked status, generation, Project/plan/task, current attempt number/kind, two SHA-256 fingerprints and timestamps. Immutable `executor_authority_events` records register/advance/revoke with the same facts. A deferred composite FK forces each current generation and exact state/grant to have a matching event in the same transaction. Constraints/triggers forbid invalid shapes, deletion, generation reuse/rollback, same-attempt reactivation and identity/admission rewrites. DB-owner arbitrary bypass remains outside the application trust model.

`canonicalRunFingerprint` hashes the entire validated normalized AI-011 Run (including current attempt, admitted paths, verification/protected facts and all previous history). A bounded descriptor snapshot rejects hostile inputs before validation; canonical key sorting operates only on that bounded snapshot, never arbitrary unknown input.

`admissionFingerprint` hashes explicit policy identity `development_task_admission_v1`, normalized FeaturePlan, admitted task/path decision, existing Owner-required/satisfied flags and trusted `taskOwnerApprovalGranted`, sorted completed/active task IDs and repository allowlist, normalized executor identity/capabilities and repository binding. No invented Owner identity, authenticated approval history or invocation ID. This is a fingerprint of the existing trusted grant, not proof of an unimplemented Owner ceremony.

## Trusted operations

Register requires canonical implementing / submit_patch_or_failure, exactly one matching in_progress attempt, #1 initial or #2/#3 corrective, admitted plan/task and matching admitted paths. Generation starts at 1, even when registering an already canonical corrective snapshot; exact active replay is idempotent, conflicting/revoked facts never overwrite.

Advance takes a separately trusted complete executable corrective Run. It must be adjacent to the locked current attempt and preserve plan/task/admission. To compare all earlier history without persisting a second lifecycle, reconstruct the predecessor's canonical executable snapshot: remove only the new attempt and the predecessor's new closure/failure, reset that predecessor to empty in_progress, then validate/hash. That fingerprint must equal the stored predecessor Run fingerprint. Older histories and invariant Run facts cannot be repaired, skipped or silently changed. Advance increments generation once, including from revoked to the next factual corrective attempt. Replaying the same active target is idempotent.

Revoke requires the configured facts still match the current authority, atomically increments generation and journals revoked state. Repeated revoke is idempotent; a stale attempt cannot revoke its successor. No same-attempt reactivation exists. Inspect returns a fresh frozen explicit snapshot, never a capability.

## Exposure, locks and races

New exposure rows permanently bind `authority_generation`, `canonical_run_fingerprint`, `admission_fingerprint` to the matching historical event; existing immutable-column guards prevent rebinding. Legacy 0013 rows retain NULL bindings, cannot prepare/start, and are not fabricated/backfilled into authority. Historical cancel/evidence/read remain usable after revocation/advancement; these operations never reactivate a grant or release post-start exposure.

One connection/transaction: workspace FOR SHARE → Project FOR SHARE → current authority FOR UPDATE → budget FOR UPDATE → exposure FOR UPDATE. Authority mutations use the same workspace/Project/authority prefix; none takes budget before authority. Same-Run concurrent first registration serializes through the unique key with INSERT ON CONFLICT, then locks/rechecks the winner. No provider/network work occurs while locks are held.

Reserve, bind and start all require current active authority matching trusted configured workspace/Project/Run/plan/task/attempt/kind and both fingerprints. Existing exposure must match current generation and both fingerprints; all b financial, invocation, target, expiry and audit predicates remain. Only an acknowledged prepared → start_committed transaction mints the existing ephemeral single-use capability. Reading/restarting never mints one.

Revoke/advance wins authority lock: stale bind/start denies, no capability. Start wins first: historical commitment remains valid and exposure held; a later mutation cannot rewrite it. Acknowledgement can arrive after a later revoke, but the historical start transaction was serialized before it; no new right is minted from stale pre-lock facts. Tests force both orders, 10 iterations each for revoke and advance, with independent PostgreSQL backends. Project pause committed during a Project lock wait is re-evaluated and denies; archive also denies.

Any DB/COMMIT ambiguity closes that store instance permanently with null output and recovery_required, using the executor transaction session-disposition rules. No automatic replay/reopening. A fresh trusted inspection observes persisted generation/state; it cannot resurrect an old generation or reconstruct a start capability. Budgets remain conservative through uncertainty.

## Deferred integration and enablement

There is no factual durable AI-011 controller or authenticated Owner revoke producer today. A future trusted controller must call revoke when AI-011 is cancelled or approval/policy authority is revoked, and advance only from factual canonical corrective history. Until that integration and the remaining financial/reconciliation/live gates are approved, production dispatch stays structurally locked. AI-043, full AI-037.8 admission, settlement, outcome recovery, live compatibility, Owner UX and distributed exactly-once are not implemented or claimed. AI-037.2/.3/.8 and M4 remain incomplete.
