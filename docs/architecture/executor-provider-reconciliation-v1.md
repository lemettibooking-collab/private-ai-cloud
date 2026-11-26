# AI-041.1f — Retrieval-only provider reconciliation

Status: **IN REVIEW**, baseline `780a005c96233be1572eb5592433a0e58b8d7869` (AI-041.1e DONE / COMMITTED / PUSHED). AI-041.1 and M4 remain IN REVIEW / NOT DONE; production/live dispatch remains **BLOCKED**. AI-037.2/.3/.8 are not completed. No live compatibility/entitlement proof is claimed.

## Trust, protocol and production lock

This is an internal executor recovery composition, not a runtime/controller/route/UI. `createOpenAIAgentsRetrievalTestReconciler` captures trusted bounded ExecutorAdapter configuration, durable historical store methods and a private-provenance test client bound to provider/model/account. Caller invocation is revalidated before any read. Durable exposure/identity must match every invocation binding and trusted target before GET. Account labels are not credential ownership proof. The test factory accepts only an explicitly injected in-process fake, never global fetch, SDK or a network wrapper.

The server-only production composition exports a separate constant-deny facade. It has no client, credential resolver, start issuer, live/environment/caller flag or configurable transport. No production GET/POST, OAuth or inference is performed.

Fixed origin `https://api.openai.com`, GET allowlist only:

- `/v1/agents/sessions`
- `/v1/agents/sessions/{session_id}`
- `/v1/agents/sessions/{session_id}/turns`
- `/v1/agents/sessions/{session_id}/turns/{turn_id}`
- `/v1/agents/sessions/{session_id}/turns/{turn_id}/items`

The private read port exposes only these five operations; IDs are bounded safe ASCII and encoded as path segments. No arbitrary URL, credentials, Authorization/body, Create, message, new turn, cancel/resume, tool result, approval or other mutation is available. Redirects are errors. Exactly one bounded pass, no automatic GET retries.

## Recovery model / W2–W5

Known session+turn (W5): retrieve exact session and turn, then every item page for completed output. Session-only (W4): exhaust turn pages, require exactly one root turn, persist via e, then retrieve it exactly. Correlation-only (W2): exhaust session pages without metadata server filtering, compare exact opaque digest; exactly one fully validated match may be bound via e. Validate both the discovery and exact retrieval before writing session ID. Zero matches is **not absence proof**. Multiple matches/turns are incidents; incomplete scans remain unresolved. Neither a missing ID nor recovery state can create a new dispatch right.

Session `idle` alone is never success; `in_progress` defers the entire pass (even if a later turn could be terminal); `requires_action` is recovery-required with no response to the action. Failed session can recover only through a factual bound/discovered terminal turn; otherwise hold. For turn `queued/in_progress/waiting`, keep full exposure and no terminal result. `completed` requires exactly one valid meaningful final proposal; `failed` maps to static `failed/provider_failure`; `cancelled` maps to `failed/execution_failure`. Retrieval failure is unavailable, NOT execution failure.

Provider reads finish outside all DB transactions. Any new identity uses e operations; terminal evidence uses `createExecutorOutcomeCapture` then d `recordDefinitiveOutcomeAndSettle`. No SQL, new ledger, new migration, copied financial algorithm or current-authority requirement. Revoke/advance and Project pause/archive do not discard historical recovery. Lock ordering and once-only release remain d/e's responsibility. Uncertain acknowledgements return null partial outputs; a fresh store can inspect facts, never reconstruct a capability.

All unresolved passes mark the sticky identity incident and retain full unsettled exposure. It is never cleared. Existing 0016 does not classify its cause: a definitive exact-bound terminal outcome may close exposure through d while **the sticky integrity incident remains**. Settlement is not incident resolution or permission to retry. A current ambiguous discovery never supplies terminal evidence. First identity/result wins; contradictions cannot overwrite it. Settled rows cannot reopen or release again.

## Strict subset and bounds

Session validates exact ID, opaque metadata, model/root agent ID, disabled multi-agent/programmatic tools, environment none, no actions/vaults, exact reservation-derived cents cap, bounded usage/error/timestamps and known status. Beta session.error is null or a string (≤4096 UTF-8 bytes), with non-null accepted only for failed sessions. Turn.error has its separate bounded structured SessionTurnError code/message parser, with non-null accepted ONLY when the turn is failed. Cancelled is factual terminal evidence but MUST carry error=null, as must completed/queued/in_progress/waiting. Failed permits null or a valid bounded structured error. Terminal mappings remain failed/provider_failure and cancelled/execution_failure. Turn validates exact session/agent/ID, root only, object/status/error, timestamp ordering and integer usage arithmetic. Unknown material fields fail closed. All error text is discard-only, never logged/stored/projected. A failed session string does not prevent recovery from its factual exact completed turn.

Stream and retrieval share assistant/reasoning conversion. A retrieval-only inert branch permits at most one first saved user message: exact turn, completed, phase=null, one input_text matching PAC's single initial string. Its content must reconstruct the same canonical input, base request digest and final request digest using the stored correlation; arbitrary replacement text is not accepted. Text is bounded by the existing 64 KiB request envelope, discarded and never fed to result evaluation/audit/output. Extra/late user messages, images, multiple content parts, legacy null IDs and unsupported history fail closed. This does not add user-item acceptance to SSE.

Reasoning/commentary remain discard-only. Exactly one completed root assistant final_answer with one output_text is decoded into raw proposal fields and passed through unchanged ExecutorAdapter path/hash/secret/evidence validation. Tool/function/computer/subagent/unknown items still fail closed. The strict supported subset can reject richer legitimate histories; no CoT is needed or persisted.

Pagination uses explicit order=asc and page size16. Session/turn resource pages retain ID cursor validation. Turn-item ConversationCursor pages independently validate unique item IDs and a nonempty printable-ASCII opaque last_id (≤1024 bytes), NOT equality with the final item ID. Reserved characters are URL-encoded only as query data; the exact returned cursor becomes after. When has_more=true, a non-null usable cursor is mandatory. Repeated/looped cursors, duplicate IDs, malformed envelopes and incomplete pages fail closed; no partial pages are used. Empty has_more pages remain conservatively unavailable.

Bounds unchanged: 4 session pages/64 sessions; 4 turn pages/32 turns; 8 item pages/128 items; 18 GETs/pass. JSON bytes/response ≤2 MiB, chunks ≤4096, GET deadline ≤1000 ms, decoded snapshot depth10/nodes10k/members64/cumulative string256 KiB, aggregate saved-output envelope ≤256 KiB. No truncation or arbitrary account scan.

Usage is optional best-effort evidence; counts ≤1e9, integer sum and cached/reasoning detail bounds checked. Consumed cents must fit exact cap and not regress under d's lock. Missing evidence never fabricates zero or erases old observations. Cost remains null, not derived from tokens/consumed cents. `settled` closes concurrent exposure, not exact billing.

## Official contract rechecked 2026-10-22

- [Session retrieve](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/retrieve) and [Go session schema](https://developers.openai.com/api/reference/go/resources/beta/subresources/agents/subresources/sessions/methods/retrieve): saved state, metadata, usage and optional spend_control evidence. PAC's capped subset requires the exact cap; absent/unknown shape denies.
- [Session list](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/list): bounded cursor/order listing, no documented metadata filter or absence/idempotency guarantee.
- [Turn list](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/turns/methods/list) / [turn retrieve](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/turns/methods/retrieve): root identity and terminal versus queued/running/waiting states.
- [Saved items](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/turns/subresources/items/methods/list) / [events guide](https://developers.openai.com/api/docs/guides/agents-api/sessions/events): saved paginated items, not guaranteed stream replay; terminal turn evidence is distinct from idle session state.
- Corrective recheck: [Go item-list signature](https://developers.openai.com/api/reference/go/resources/beta/subresources/agents/subresources/sessions/subresources/turns/subresources/items/methods/list) uses ConversationCursorPage, unlike ordinary resource paging. Generic HTTP envelope prose is not used to impose item-ID equality. [Beta errors guide](https://developers.openai.com/api/docs/guides/agents-api/errors) distinguishes session string errors. [Create Session input](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create) defines string input as one user message; saved-item field definitions, not inconsistent autogenerated examples, define its null phase/completed/input_text shape. The implementation pins only that supported form and additionally verifies the original request digest.

No large SDK schema copied. Cross-reference surface differences and future provider schema evolution do not permit relaxing the cap or unknown-state checks. Trusted account/credential ownership, egress authorization, policy approval, controller integration and separately approved live smoke remain later gates.
