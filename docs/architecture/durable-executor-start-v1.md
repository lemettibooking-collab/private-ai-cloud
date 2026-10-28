# AI-041.1b — Durable executor start and exposure boundary

AI-041.1b: DONE / COMMITTED / PUSHED as `d72a439a456cb1370b49448fb354ea93b381907b`. B0 commit: `2109545f829dfe4e63a23e95301893c534e75947`. AI-041.1c: DONE / COMMITTED / PUSHED as `bde59001b1a4bc28582bd6c76b6059d41cdcf74a`. AI-041.1d: DONE / COMMITTED / PUSHED as `c5299f5d19ae1addb38e5ef5335a24428b7074e4`. AI-041.1e provider identity: IN REVIEW. The Live Readiness Review returned BLOCKED. AI-041.1 remains IN REVIEW. Production/live dispatch is BLOCKED. No distributed exactly-once provider execution claim.

AI-041.1e adds an executor-internal historical provider identity port using the same transaction runner/lock prefix, not another financial algorithm. New request preparation derives opaque metadata with the trusted workspace identity, before the final request digest. The acknowledged start winner can consume its capability to prepare durable correlation; only acknowledged correlation creation mints a separate single-use start+correlation capability. Replays/restart reads cannot mint it. Neither capability unlocks the production facade. [Identity schema, metadata and crash windows](executor-provider-identity-v1.md).

## Trusted inputs and storage

`createPostgresExecutorStartStore` is an internal trusted-server port, not a public issuer. Tenant branding comes from the existing PostgreSQL resolver; workspace database IDs are never invocation fields. Trusted configuration supplies the separately validated AI-011 canonical Run/current attempt, Project, executor/repository, provider/model/account and bounded financial policy. B0 identity and approvals are reused, not redesigned. The immutable invocation fingerprint includes admitted task grants.

Migration `0013` adds `executor_exposure_budgets`, `executor_attempt_exposures`, and `executor_attempt_events`. Unique key: `(workspace_id, development_run_id, attempt_number)`, with #1 initial and #2/#3 corrective. Invocation ID is correlation only. All other binding fields must match before any replay/read/mutation. The composite Project FK uses factual Project Registry support; `task_id` is the DevelopmentTask identity, NOT a ProjectTask FK. No durable DevelopmentExecution Run table is fabricated.

The budget policy is persisted immutably on first reserve; replacement policy fails closed. Micros are bounded integers (at most 1e9), with `maximum <= total`; expiry TTL is at most 60 seconds. The dedicated immutable journal and deferred current-state/version FK require the state mutation and its event in the same transaction. CHECKs constrain money, attempt, state/timestamps and all-or-none usage; transition triggers forbid deletion, rebinding, backwards transitions and evidence erasure. No raw context, provider body, credential or reusable bearer token is stored.

## Financial and request sequence

Trusted factual attempt → reserve full micros → derive `floor(micros / 10000)` cents → shared pure canonical request builder → SHA-256 of exact bytes → one-way fingerprint binding → trusted dispatch authorization → atomic start commitment → ephemeral capability. Sub-cent OpenAI exposure is denied. Full micros including remainders stay held; provider `consumed` is only bounded best-effort evidence. Observed cost is always null, never invented from tokens.

The process-local bridge remains useful test/defense-in-depth; its WeakMaps/Sets are not durable financial/start authority. The new WeakMap holds only ephemeral capability provenance after a successful DB COMMIT, never factual attempts or held counters.

## Serialization and operation analysis

Every operation uses one connection and one transaction. Reserve/prepare/start order is workspace SHARE → Project SHARE → current authority UPDATE → workspace budget UPDATE → factual attempt UPDATE. Historical cancel/evidence/read/settlement use the compatible subsequence workspace SHARE → Project SHARE → budget UPDATE → exposure UPDATE, without current-authority lock or active Project predicate. Workspace/domain/status and Project existence remain required. A fresh DB clock is read after waiting for start locks; the start UPDATE also checks expiry. No provider/network work occurs in a transaction.

| Operation | Protection and replay behavior |
|---|---|
| reserve | Budget row lock + conditional held-counter UPDATE + unique factual attempt + transaction/FKs/audit. Exact replay returns existing; changed correlation/bindings/exposure conflict. |
| bindRequest | Same locks + conditional reserved/null-fingerprint UPDATE + immutable fingerprint trigger + audit. Exact canonical bytes replay; different bytes conflict. |
| commitProviderStart | Same locks + exact bindings/fingerprint, active/unexpired held reservation + conditional prepared UPDATE + audit. Only after acknowledged COMMIT is one capability minted. |
| cancel | Same locks + conditional reserved/prepared UPDATE and counter subtraction in same transaction. Idempotent cancelled replay; no post-start release. |
| markReconciliationRequired | Same locks + conditional start_committed UPDATE + sticky transition trigger + audit. Holds full exposure. |
| recordEvidence | Same locks + bounded arithmetic and monotonic evidence check + conditional started-state UPDATE + audit. No settlement or release. |

The sum of all non-cancelled attempt exposures is checked against the held counter under the SAME budget lock. No unlocked SUM/JS/INSERT admission. Conditional updates and DB bounds are additional defenses. Consistent lock order prevents these operations from deadlocking with one another; other writers must follow that order. The current event/state is also checked when reading, not repaired on mismatch.

## State, cancellation and crash behavior

`reserved → prepared → start_committed → reconciliation_required`. Only reserved/prepared can become cancelled, releasing exactly once. Concurrent cancel/start serialize: cancelled winner means no capability; start winner means cancellation cannot release. Expiry alone never releases. Missing/zero usage, best-effort spend, timeout, malformed/ambiguous outcomes alone never settle. AI-041.1d adds `start_committed/reconciliation_required → settled` ONLY with a durably captured valid terminal result and separately trusted definitive evidence. Result, state, held release and audit commit together; settled/cancelled contribute zero held micros. No automatic retryable/backwards transition exists. See [outcome settlement](executor-outcome-settlement-v1.md).

Reservation/fingerprint survive factory AND OS-process restart. A committed start burns the ordinary right even if the process exits before any provider call. The opaque winner capability is process-local, fresh/frozen and single-use; reading a row, cloning a capability or restarting cannot recreate it. A conservative possibly-started hold can remain indefinitely pending future trusted reconciliation.

On DB/COMMIT uncertainty, return only recovery_required with null snapshot/capability, destroy unsafe sessions and permanently close that store instance. No automatic retry, fallback or second reservation is scheduled. A lost acknowledgement after actual COMMIT leaves the durable start row fencing every new process. A rollback/no-write failure issues no capability either. Operators must not use factory recreation as an automatic uncertainty retry mechanism; general recovery orchestration is not implemented here.

## Production lock and remaining prerequisites

`durable-development-executor.server.ts` is server-only. Its trusted facade has no start issuer, always-false start authorization and an invoke method that denies. The existing production `createOpenAIAgentsTransport` stays structurally locked before credentials or network, without environment/caller bypass. Controlled tests never dispatch real OAuth/OpenAI/inference.

AI-041.1c binds b0 setup evidence to [durable current authority](executor-current-authority-v1.md); snapshot validity alone cannot authorize reserve/prepare/start. Migration `0014` permanently binds authority generation and both fingerprints into new exposures. Legacy `0013` rows are not backfilled with invented grants: NULL-authority rows cannot prepare/start, but historical cancellation/reconciliation remains possible. This is not AI-011 lifecycle persistence (there is no AI-011 paused state); Project pause remains factual Registry state. AI-041.1d supplies committed internal durable result/settlement. AI-041.1e identity primitives are IN REVIEW, not a provider reconciler. Live transport hookup, a trusted future cancellation/approval-revocation producer, sufficient financial-policy approval, account/credential and egress authority, complete provider protocol compatibility and an explicitly approved live smoke remain prerequisites. AI-037.2/.3/.8 and M4 are not completed by these slices.
