# AI-041.1e — Durable provider execution identity / recovery correlation

Status: **DONE / COMMITTED / PUSHED**, commit `780a005c96233be1572eb5592433a0e58b8d7869`. Implementation baseline: `c5299f5d19ae1addb38e5ef5335a24428b7074e4`. AI-041.1f [retrieval-only fake protocol/reconciler](executor-provider-reconciliation-v1.md) is IN REVIEW. The Live Readiness Review returned **BLOCKED**; AI-041.1 and production/live dispatch remain blocked/in review. No live provider/OAuth/inference, production retrieval, credential binding, controller or new public surface is implemented.

## Trust and schema

Migration `0016_executor_provider_execution_identity.sql` adds `executor_provider_executions`, keyed by `(workspace_id, development_run_id, attempt_number)`, plus immutable `executor_provider_identity_events`. Composite FK binds provider/model/account, executor/version and exact request fingerprint to the existing exposure. The row requires an already committed, authority-bound start and its start journal. No old migration is edited and no row/ID is backfilled. An account-scoped unique provider session index rejects attachment of the same session to multiple attempts/workspaces.

Only bounded non-secret IDs, digests, state/version and timestamps are stored. No raw context, provider body/SSE, reasoning, credential, header, SDK object or reusable bearer authority. IDs are safe ASCII ≤128 characters, with existing probable-secret checks. Account label binding does not prove account ↔ credential ownership; that is the next authorization task.

Knowledge is monotonic: `correlation_prepared → session_observed → turn_observed`. A turn requires the exact saved session. A sticky `recovery_required` bit is independent of knowledge progression: a lost response can be unresolved with no IDs, or unresolved with IDs already known. It is never automatically cleared. This is not an executor/Run lifecycle.

Session/turn writes are first-write-wins; exact replay is idempotent without a new journal version; conflicting IDs preserve the original and record recovery/incident state with full unsettled exposure. Multiple metadata matches are an integrity incident, never arbitrary first-match selection. AI-041.1f scans only through a bounded injected fake GET client, outside this identity module. Provider identity is historical evidence, not permission to start, settle, advance an attempt or apply a patch.

## Canonical correlation without a hash cycle

The request cannot contain its own final SHA-256 as an input to that same digest. The explicit two-stage construction is:

1. Build the existing capped canonical body **without metadata**; `baseRequestFingerprint = SHA256(base bytes)`.
2. Hash the newline-delimited, domain-separated ordered tuple: `pac.executor.provider-correlation.v1`, trusted workspace UUID, factual developmentRunId, attempt number in decimal, base request fingerprint, provider ID, model ID, account ID, executor ID, executor version. Every component is bounded ASCII without newlines. PostgreSQL independently checks this same digest.
3. Append exactly `metadata: { pac_execution: correlationFingerprint }`.
4. Compute `requestFingerprint = SHA256(final exact bytes)`. Bind that final digest to exposure/start and provider identity, together with base/correlation digests.

The tuple binds the entire pre-metadata request; the final digest binds the correlation back to exact transmitted bytes. No fixed-point hash is claimed. Provider metadata reveals only one opaque 64-character lowercase digest, not workspace/account IDs, Owner identity, task or repository content. This is deterministic correlation, not authentication, a secret or provider idempotency. Pure/legacy in-process test construction defaults to a `test-only` scope; durable preparation always supplies the branded tenant's actual workspace UUID. Caller input does not select it.

New canonical requests therefore have new fingerprints; historical prepared/started/result rows are never rewritten. An old request without this binding cannot be retroactively labelled as having sent the new metadata.

## Operations and capability sequence

The internal start store composes a small identity operations module with its existing validated historical transaction runner. It does not copy the financial/tenant/authority algorithm.

`reserve → bindRequest(exact metadata-bearing bytes) → commitProviderStart → prepareProviderCorrelation(context, genuine start capability) → acknowledged correlation capability → future transmission`.

`prepareProviderCorrelation` recomputes bytes from captured bounded context and trusted workspace/target, and checks the existing request/start. Creation consumes the genuine acknowledged start capability. A replay may inspect/confirm the existing correlation but never creates another transmission capability. Failed/uncertain creation burns the ordinary right conservatively; no fallback creates another request. The prepared capability is private-provenance, single-use and binds both acknowledged facts; shaped objects, clones, rows, local test tickets and fresh-process reads cannot mint it.

`createProviderIdentityObserver` is an internal port for later wiring, not a production issuer. Its `beforeTransmission` burns the private capability and re-reads exact durable correlation/start facts; missing/uncertain/incident state denies before credential access. The capability is bound to its issuing store instance: factory recreation cannot bypass that issuer's uncertainty latch. The production facade exposes neither start nor correlation issuer and still always denies. The separately named identity test transport uses fake fetch only; its old ticket remains test-only evidence, never future production financial authority.

`recordProviderSession` / `recordProviderTurn` accept only bounded exact request/correlation/target observations for a validated invocation and historical start. `inspectProviderIdentity` returns fresh deeply frozen data with no capability. `markProviderIdentityUnknown` retains identity and marks unsettled exposure reconciliation_required. No network operation or terminal settlement is performed by these methods.

## Parser seam / failure

The parser receives no DB/store. A trusted bounded observer acknowledges the validated session immediately, then the first turn ID, before later output is accepted. On the observer-enabled route, echoed correlation metadata must match the exact request. Only session/turn identifiers cross this port; raw output, events and errors do not. The observer handles storage outside the parser; all DB transactions end before provider work continues.

False/throwing/unacknowledged persistence stops terminal success, returns no partial result, retains the financial hold and never retries Create. A timed-out parser cannot later convert a completed observation into terminal success. Connection/COMMIT uncertainty latches the store closed and destroys unsafe sessions through the existing transaction discipline. A fresh store reads factual committed identity but never reconstructs a dispatch capability. If the store was closed during a stream, local reconciliation is required even if the last DB exposure state remains start_committed with a full hold; fresh recovery must inspect it.

## Locks and historical settlement

Identity paths: workspace SHARE → Project SHARE (existence, not active) → budget UPDATE → exposure UPDATE → provider identity UPDATE → identity journal. Start retains workspace → Project → current authority UPDATE → budget → exposure. No identity → exposure inversion, second pooled connection, network in transaction or session-local state. Inspection follows the same historical prefix; no current-authority lock.

Identity writes/readback work after authority revoke/advance and Project pause/archive. AI-041.1d remains semantically unchanged: a trusted definitive historical terminal result can settle; identity remains intact; no current grant is revived. `settled` closes concurrent exposure, not exact billing. Unresolved identity, usage and provider budget/error uncertainty are never used as evidence to release a hold or open a corrective attempt.

## W1–W5 and limits

| Window | Safe behavior |
|---|---|
| W1: start committed, process dies before HTTP | Start right is burned; no new Create. Without acknowledged correlation there is no future transmission capability. Retain hold; do not infer no execution from missing IDs. |
| W2: HTTP may have created session, no observed ID | Correlation exists before any observer-enabled transmission; it remains unresolved/held with no retry. Future trusted retrieval may find a unique proven match, but zero/multiple matches are not permission to redispatch. |
| W3: session observed, before DB acknowledgement | Parser cannot proceed to success until session persistence ACK. If committed, fresh process reads it; rollback/unknown ACK retains hold. Physical crash between observation and durable write still reduces to lost-ID W2: no distributed atomicity is promised. |
| W4: session persisted, turn observed before DB acknowledgement | Saved session survives; parser waits for turn persistence. Fresh process reads any committed turn; otherwise future retrieval must discover it under the exact session. |
| W5: session+turn persisted, disconnect before terminal result | Exact IDs survive; AI-041.1f can retrieve saved terminal output through fake GET only, validate it and settle through AI-041.1d. Otherwise full exposure and no terminal row remain. |

This closes the previous unchecked observation/progression gap, not the fundamental remote-server/local-DB crash gap. Saved identity supports later reconciliation; it does not prove remote terminality or guarantee recovery availability.

## Official facts rechecked 2026-10-22

- [Create an agent session](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create): `POST /v1/agents/sessions`; metadata supports up to 16 string entries (key ≤64, value ≤512). No Create Session request-idempotency guarantee is documented in the inspected reference. No Idempotency-Key is sent by PAC.
- [Run and continue sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions): documented Idempotency-Key is for submitting a message to an existing known session. It does not establish Create Session idempotency.
- [List agent sessions](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/list): `GET /v1/agents/sessions`, pagination/agent/order filters, no documented metadata filtering or unique lookup by PAC digest. No absence/uniqueness guarantee inferred.
- [Retrieve session](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/retrieve): `GET /v1/agents/sessions/{session_id}`; states `idle`, `in_progress`, `requires_action`, `failed`.
- [List turns](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/turns/methods/list) and [retrieve turn](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/turns/methods/retrieve): `GET /v1/agents/sessions/{session_id}/turns[/{turn_id}]`; turn states `queued`, `in_progress`, `waiting`, `completed`, `failed`, `cancelled`.
- [List turn items](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/turns/subresources/items/methods/list): `GET /v1/agents/sessions/{session_id}/turns/{turn_id}/items` supports saved output inspection, with pagination.
- [Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events): disconnected-stream recovery uses saved state/items and item-ID merging, not a new Create or guaranteed replay of all transient events. Idle/EOF alone is not successful terminal evidence.

These are public documentation facts, not live compatibility or entitlement proof. The readiness review's spend_control reference-surface uncertainty remains separate; accepted conservative cap/error behavior is not weakened here.

## Deferred gates

AI-041.1f retrieval-only reconciler is IN REVIEW, not live enablement. Next: trusted account/credential and egress authorization/approved financial policy and isolated production composition. No live now: local development through AI-043.* → VPS transition gate → PostgreSQL/TLS/secrets/monitoring → deferred live gates → separately Owner-approved bounded executor smoke → AI-044. Full AI-037.2/.3/.8, AI-041.1 and M4 are not DONE.
