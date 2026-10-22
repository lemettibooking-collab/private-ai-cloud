# AI-041.1d — Durable executor outcome / exposure settlement

Status: IN REVIEW, baseline `bde59001b1a4bc28582bd6c76b6059d41cdcf74a` (AI-041.1c DONE / COMMITTED / PUSHED). Production/live dispatch remains BLOCKED. This is an executor-only pull-forward of AI-037.2, not completion of AI-037.2/.3/.8, AI-041.1 or M4.

## Trust and canonical result

The unbound `executor-outcome.server.ts` ingress is internal trusted server configuration, never a UI, route, action or public writer. Its transport/reconciler producer supplies terminality; a caller cannot authorize settlement by supplying a flag or a cloned receipt. Capture completes outside the DB transaction. Private receipt provenance protects initial ingress, not restart reads or against trusted-server code compromise. No production producer is wired and there is no provider polling/retrieval.

Both initial capture and restart reconstruct a new ExecutorAdapter validation receipt from trusted historical configuration and the exact invocation. They evaluate the seven raw result fields, then compare EVERY full persisted normalized field (including derived repository/attempt/plan/task and verification flags), not just a subset. The adapter fixes field order and sorts changes deterministically. SHA-256 of UTF-8 canonical JSON binds identity, invocation, attempt, plan/task, repository/baseline, status/failure, complete changes and report. Stored JSON must match those exact canonical bytes and digest.

Existing limits are unchanged: cumulative strings 256 KiB, depth 10, 10,000 nodes, 64 members/changes, each file 128 KiB and report 16 KiB. JSON escaping is at most six ASCII bytes per source byte; bounded structural overhead fits below the explicit 2 MiB envelope. The DB enforces 2 MiB text size; readers check bytes before parsing, then apply the existing hostile-input snapshot and result validators. Nothing is truncated. No raw SSE, CoT, provider body/error, credentials or SDK metadata is stored.

## Definitive versus ambiguous

Validated `succeeded`, `rejected`, `failed` are eligible ONLY with trusted `definitive_terminal`, compatible `rejected_before_execution` or `not_transmitted` evidence. A valid failed result alone is insufficient. `outcome_unknown`, transmitted timeout/disconnect, 429/5xx, malformed transmitted output and `session_budget_exceeded` remain ambiguous: reconciliation_required, FULL exposure, NO terminal row, NO automatic retry/start/corrective attempt.

The narrow trusted transport observation bridge accepts coherent success/rejection with non-ambiguous accounting state; all failure-shaped transport results remain conservative. A future trusted reconciler can close a historical ambiguous start only after independently obtaining definitive evidence for that exact start through the same ingress. Observed session/turn IDs are currently internal to transport, not persisted and not proven retrievable: provider-specific identity/retrieval support remains debt, never fabricated.

## PostgreSQL and locking

Migration 0015 is append-only; 0013/0014 are untouched. `executor_attempt_results` primary key is `(workspace_id, development_run_id, attempt_number)`. It binds exact request/result fingerprints, terminal status/failure, canonical payload, bounded provenance class and recorded timestamp. Cyclic deferred FKs require the matching settled exposure and result. Immutable guards prohibit result update/delete/rebinding, settled exposure mutation/backwards transition and journal rewrite. Direct SQL verifies payload SHA-256 and factual identities. Deferred aggregate integrity checks enforce held = SUM of all non-cancelled/non-settled exposure rows.

Historical lock graph: workspace SHARE → Project SHARE (existence, not active) → budget UPDATE → exposure UPDATE → result/journal. Start uses the compatible prefix workspace → Project → authority UPDATE → budget → exposure. No historical current-authority lock; a revoked/advanced authority or paused/archived Project cannot discard a paid historical result. Tenant brand, domain and workspace/project identity still apply.

One transaction inserts terminal result, updates exposure to settled with exact result digest/timestamp, subtracts its FULL maximum micros once, and inserts immutable settle event. Deferred constraints require all facts at COMMIT. Exact replay returns the durable result idempotently, without release/event. A different result conflicts, never overwrites. Independent sessions serialize on budget then exposure. Reconciliation-first may later settle; settlement-first cannot reopen.

`settled` means **concurrent exposure closed after a durable definitive terminal result**, NOT exact monetary reconciliation. Optional usage is bounded, arithmetic and monotonic; missing fields preserve old observations, factual zero is allowed. Consumed cents cannot exceed the provider cap or decrease; contradictions retain full exposure/reconciliation. No token pricing and no conversion of consumed cents to USD cost: observedCostUsdMicros stays null. Additional usage after settlement is denied (exact replay may repeat the same observation); no hold/release is repeated.

## Recovery and limits

Only acknowledged COMMIT returns settled success. Lost acknowledgement latches that store closed and returns recovery_required with null snapshot/result/capability. A fresh store revalidates and reads the committed result, never redispatches. A definite pre-COMMIT rollback preserves prior state/full hold and no result. Reads are fresh/deeply frozen and never mint a start capability. A normal succeeded proposal still has verificationStatus=not_run, ownerDecisionRequired=true, automaticRetryAllowed=false; no AI-011 transition or repository action occurs.

Legacy populated 0013 upgrades retain reserved/prepared/started/reconciliation/cancelled rows, journals and counters through 0014/0015, with NULL authority/result bindings. No authority/result backfill; legacy unsafe prepare/start remains quarantined. Migration compatibility is covered by disposable live PostgreSQL tests.

Still separate: production producer wiring, tenant/account authorization and sufficient financial policy, provider reconciliation/opaque retrieval identity, general ambiguous-COMMIT tooling and Step recovery, autonomous controller, Quality/Security Gate, Owner acceptance and separately approved live smoke. No OAuth/inference/network is enabled by this slice.
