# AI-041.1 — Managed executor transport and financial/start boundary

Status: **IN REVIEW**, not DONE. **Production/live dispatch: BLOCKED.**

Baseline: `bc9360eed0a4959fdbaca7ab787f3e511bb6336f`, branch `feature/development-agent-module`. The Owner explicitly excluded prerequisite AI-041.0 / Decomposition gates, without waiving security invariants, and authorized a separate executor budget/fence bridge. No prior gate is declared passed.

AI-041.1a corrective baseline: local HEAD and origin both `98a291533b1c953d1cac3b200847730688d35593` (`feat(executor): add AI-041.1 managed executor start boundary`). This is the factual pushed baseline despite the earlier report's no-commit/push claim; history is not rewritten. AI-041.1a passed independent re-gate and is DONE / COMMITTED / PUSHED as `fc924885781ed9e651fb8d5e47588fd6a5ea1773`. AI-041.1 remains IN REVIEW, not production-ready.

## AI-041.1b0 — Trusted Executor Attempt Identity — DONE / COMMITTED / PUSHED

Prerequisite discovered by the AI-041.1b STOP condition; internal decomposition/corrective, not roadmap expansion. AI-011 attempts already exist. The pure adapter now binds `{developmentRunId, number, kind}` to separately configured, fully validated canonical DevelopmentExecution state (`implementing`, `submit_patch_or_failure`, one current `in_progress` attempt; initial #1, corrective #2/#3). Run plan/task must match admission. The caller transports identity but cannot establish it. Result identity comes from the original receipt, not executor output; canonical request bytes and financial snapshots include it. See [trusted source and limitations](executor-adapter-contract-v1.md).

V1 permits at most one managed provider-start commitment per factual implementation attempt, not per invocation ID/capability/mode. There is no sub-dispatch model. B0 passed independent re-gate and was committed as `2109545f829dfe4e63a23e95301893c534e75947`; b0 itself added no migration or production enablement.

## AI-041.1b — Durable Executor Start & Exposure Fence — DONE / COMMITTED / PUSHED

Commit: `d72a439a456cb1370b49448fb354ea93b381907b`.

PostgreSQL is now the candidate future financial/start authority, not WeakMap/Set state. Migration `0013` adds a serialized workspace exposure budget, one durable record per workspace/development Run/attempt and an immutable transactional journal. The existing canonical capped-request builder is shared; provider bytes and AI-041.1a rounding are unchanged. A definitively committed prepared → start_committed winner alone receives an ephemeral single-use capability; no persisted bearer secret or restart reconstruction. Full exposure remains held after start or uncertainty. See [schema, operations, locking, crash semantics and residual debt](durable-executor-start-v1.md).

Production/live dispatch remains **BLOCKED**. The new server-only composition exposes reservation/preparation/cancellation/read operations, but no start issuer or credentials; its invoke method denies. The production transport accepts neither durable capabilities nor caller unlock flags. Live PostgreSQL verification uses no provider network.

## AI-041.1c — Current Run / Attempt Authority — DONE / COMMITTED / PUSHED

Commit: `bde59001b1a4bc28582bd6c76b6059d41cdcf74a`.

Migration `0014` adds narrow durable current authority, not a second AI-011 lifecycle. Reserve/prepare/start lock and validate the active current generation and canonical Run/admission grant; the exposure permanently binds these facts. Trusted revocation or canonical corrective advancement fences stale factories across processes. Full details and deferred cancellation/Owner integration: [current authority](executor-current-authority-v1.md). No production transport enablement, credentials, network, OAuth or inference is added.

## AI-041.1d — Durable outcome capture / exposure settlement — DONE / COMMITTED / PUSHED

Commit: `c5299f5d19ae1addb38e5ef5335a24428b7074e4`. The subsequent Live Readiness Review returned **BLOCKED**, not production-ready.

Migration `0015` and the unbound internal server-only outcome ingress capture a bounded canonical definitive proposal and close concurrent held exposure in the same acknowledged transaction. A restart read revalidates the full result through the existing adapter, exact attempt/invocation/repository/request bindings and its digest, without provider redispatch. Revoke/advance/pause/archive after start cannot discard historical output. Ambiguous transport decisions, including failed-shaped `session_budget_exceeded`, keep FULL exposure and no terminal result. The narrow transport observation bridge derives definitive evidence only for coherent success/rejection; failures stay conservative unless a separately trusted producer proves terminality. No existing transport classification is relaxed.

`settled` means exposure closed after a durable definitive terminal result, not exact cost or financial reconciliation. `observedCostUsdMicros` remains null. [Schema, lock graph, restart and future reconciliation limitations](executor-outcome-settlement-v1.md). Production/live dispatch remains BLOCKED; no actual provider reconciliation, Quality Gate, corrective attempt or AI-037.2/.3/.8/M4 completion is claimed.

## AI-041.1e — Durable provider identity / recovery correlation — DONE / COMMITTED / PUSHED

Commit `780a005c96233be1572eb5592433a0e58b8d7869`. Migration `0016` adds exact-start correlation, write-once session/turn IDs and a transactional identity journal. New capped canonical bodies include only opaque `metadata.pac_execution` before their final SHA-256. A base-request digest avoids a self-referential hash; durable construction supplies the trusted workspace. The bounded internal observer awaits identity persistence before parser success, with no DB in the parser. A genuine acknowledged start plus acknowledged correlation can produce one future transmission capability, never from a replay/row/local ticket. No current production transport accepts it. Known IDs survive restart. W2 without a proven ID remains unresolved and held; metadata is not provider Create idempotency. [Protocol sources, schema, W1–W5 and lock graph](executor-provider-identity-v1.md).

## AI-041.1f — Retrieval-only provider reconciliation — IN REVIEW

An isolated test-only client performs bounded GET/list/retrieve passes for saved sessions, turns and all items. Exactly one exhaustive correlation/root-turn match can be persisted through e; zero/incomplete/multiple matches never authorize redispatch. Item pagination uses opaque ConversationCursor last_id, not final-item-ID equality. Beta session errors are discard-only strings, distinct from structured turn errors. Retrieval may discard one first completed user input_text only when bound to the original request fingerprints; extra user/steering history is rejected and SSE user acceptance is unchanged. Only proven terminal output, validated through the shared assistant/reasoning conversion and ExecutorAdapter, can enter the existing d capture and atomic settlement. Failed/cancelled terminal turns use static failure codes, not raw provider errors. Historical recovery needs no revived current authority. The sticky incident flag stays set, even after factual terminal settlement.

No real GET, credential read, provider mutation, hidden retry, new ledger, migration, route or UI. The separate server-only production facade always denies; no caller/environment flag opens it. Account-to-credential authority, egress, financial approval and live proof remain deferred. [Protocol allowlist, evidence, bounds and residual risk](executor-provider-reconciliation-v1.md).

## Responsibilities

`ExecutorAdapter validation → bounded context/target → ExecutorBudgetAuthority → canonical capped request/fingerprint → ExecutorDispatchAuthority → ExecutorProviderStartFence → ConcreteExecutorTransport → Usage/Reconciliation`

- AI-041.0 validation receipts remain non-authorizing; b0 adds factual attempt binding only. Human-operated `selectedExecutor` stays inert. ModelInvocation and Workflow Run authority are not accepted.
- `executor-start-boundary.ts` creates three separate frozen facades around private provenance/state. Trusted composition owns the issuers; no route/action exposes them. Calling an issuer is an explicit trusted dispatch/financial decision, not a consequence of validation. Ordinary shaped/cloned objects cannot confer authority. This is not protection against arbitrary code execution inside the trusted server.
- `openai-agents-executor.ts` owns vendor protocol fields. No SDK/vendor shape enters core contracts. Prepared calls bind the exact factual receipt, target and SHA-256 of the exact canonical request bytes.
- `development-executor.server.ts` is a server-only, currently unbound composition root. It exposes no issuers and cannot prepare an unreserved request. Production transport is structurally locked: no fetch, enable flag, environment switch or credential can open it. The separately named test factory takes ONLY a trusted injected in-process fake; passing network code to that seam violates its contract.

## Financial admission and provider-side defense in depth

Execution permits and exposure reservations have independent private WeakMap provenance. Binding covers executor/version, invocation, plan/task, repository/baseline, capability/mode, provider/model/account and exact request fingerprint. Reservation identity is unique, monetary values are positive bounded integers, and issuer-clock expiry is captured, not caller time.

AI-041.1a financially reserves first with a null (unbound) request fingerprint. An unbound reservation cannot pass the fence. Preparation uses only that boundary's factual, active reservation for the exact receipt/target; it derives `floor(maximumExposureUsdMicros / 10000)` positive integer USD cents, constructs immutable request bytes including `spend_control: {limit}`, then hashes the complete bytes with SHA-256 and binds the reservation once. Rebinding to different bytes denies. Below 10,000 micros denies preparation on this route. The full micros amount, including any sub-cent remainder, stays held for local aggregate accounting. No caller-supplied spending override is accepted. The permit, reservation and ticket bind the capped fingerprint, and transport also requires the ticket's exact original reservation (including when two reservations yield identical cents/request bytes).

Hard **process-local** guarantees per boundary instance:

- maximum admitted exposure per reservation and aggregate held exposure are checked before start;
- reservation + permit eligibility/expiry/bindings are checked synchronously without an `await` between checks and consumption;
- exactly one process-local test start ticket may consume a reservation, and that ticket may be dispatched once;
- expiry/revocation are rechecked immediately before the fake call;
- started invocation IDs and factual development Run/attempt tuples are never automatically replayed, including under new invocation IDs or capability/mode changes;
- entry exhaustion denies; no eviction removes replay protection;
- clock failure/rollback denies; expiry never automatically frees a reservation;
- only a pre-start explicit cancellation releases exposure. Post-start failures, ambiguity, missing usage and even zero observed tokens do not release it.

These legacy process-local guarantees do **not** span processes, restarts, independent factory instances or machines. They remain test/defense-in-depth, not future production authority. AI-041.1b/c/d provide committed durable start, current-authority and terminal-settlement primitives; full lifecycle producers, provider retrieval/recovery and live enablement remain separate. The provider limit is defense in depth. Test-only tickets and durable capabilities never unlock the current production transport. Production/live dispatch must remain BLOCKED.

Observed usage is bounded nonnegative integer input/output/total token arithmetic, associated through the exact consumed ticket/reservation. It is best-effort accounting evidence, not financial authority. `observedCostUsdMicros` is always null: no token-derived fictional price or zero cost. Missing usage is `usage_unknown`, valid token evidence is `partially_observed`, malformed/contradictory/ambiguous evidence is `reconciliation_required`. Exposure remains held; the latter state is sticky. A future trusted durable reconciler, not this transport, must establish settlement.

## Provider protocol and evidence

Selected executor: the official **managed Agents API**, not the direct Responses ModelProvider and not PAC-owned generic agent execution. Installed `openai@7.5.0` has no `beta.agents` resource. This slice uses a small fetch-shaped seam; it does not upgrade packages.

Fixed protocol: `POST https://api.openai.com/v1/agents/sessions`, `OpenAI-Beta: agents=v1`, `redirect: error`, streaming, explicit configured model, `environment: {type: none}`, subagents disabled, programmatic tool calling disabled, no external/executable tools, vaults, previous session or conversation. There is no repository mount, shell, sandbox, filesystem crawl, patch application, provider tool handler or follow-up agent loop. PAC supplies only admitted task facts, allowed paths and Owner-authorized file excerpts.

Source checks (2026-10-07): [official quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart), [create request](https://developers.openai.com/api/reference/python/resources/beta/subresources/agents/subresources/sessions/methods/create), [agent configuration schema](https://developers.openai.com/api/reference/python/__sdk_schema?declaration=(resource)+beta.agents.sessions+%3E+(method)+create+%3E+(params)+default.non_streaming+%3E+(param)+agent+%3E+(schema)&selected=(resource)+beta.agents.sessions+%3E+(method)+create), [events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events), [completed item schema](https://developers.openai.com/api/reference/typescript/__sdk_schema?declaration=(resource)+beta.agents+%3E+(model)+agent_session_turn_item_done_event+%3E+(schema)&selected=(resource)+beta.agents), [message schema](https://developers.openai.com/api/reference/typescript/__sdk_schema?declaration=(resource)+beta.agents+%3E+(model)+agent_session_message+%3E+(schema)&selected=(resource)+beta.agents), [turn](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/subagents/subresources/turns/methods/retrieve).

Source re-check **2026-10-12**: the current [Create Agent Session contract](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create) exposes an optional `spend_control.limit` in positive whole USD cents (maximum 4,503,599,627,370,495); omission/null means unlimited. PAC now always supplies the reservation-derived limit. The returned session's `spend_control` must exist on this capped route, have exactly `limit` and `consumed`, and echo the exact requested limit; omission, null, malformed or different limits deny and require reconciliation. `consumed` is null or a nonnegative safe integer, best-effort recorded spend floored to cents, not settlement authority; it is never used to release exposure or fabricate USD cost. A transport timeout only stops local waiting; abort is NOT proof of remote cancellation.

Supported SSE subset is intentionally narrow, bounded and fail-closed; unknown events/fields/tool outputs reject. It requires a coherent session identity/model/no-tools configuration, completed assistant final-answer item and root terminal turn for the same session/turn. Reasoning is ignored and never projected. Several detailed terminal-event schema fetches were unavailable; current fixtures validate the known documented subset, not exhaustive beta compatibility. This limitation must be resolved alongside live/durable enablement, not hidden as a live compatibility proof.

The model supplies only `{changes, report}` JSON. The adapter computes UTF-8 SHA-256 integrity digests and ALWAYS calls the existing factual `evaluateResult` with its original receipt; core rechecks paths, operations, output mode, meaningful report, sizes and unsafe evidence. Hashes prove byte integrity, not correctness. All accepted results, including normalized failures, keep `verificationStatus: not_run`, `ownerDecisionRequired: true`, `automaticRetryAllowed: false`. No passing tests or Quality/Security Gate is inferred.

Credentials are captured from a trusted synchronous credential provider only, after provenance checks, and used only as the Authorization header. The endpoint cannot be caller redirected. Public outcomes use static codes; raw errors/provider bodies/credentials do not escape. Credential echoes and probable secret evidence are denied. No OAuth/ChatGPT credential reuse, environment serialization, public logs or UI wiring.

Bounds: context 8 files, 8 KiB each / 32 KiB total; request 64 KiB; response 256 KiB, 64 events, 4096 chunks; timeout 1–30000 ms. Existing bounded hostile-input snapshot depth/node/member/string limits are reused. Financial policy: monetary ceiling at most 1e9 USD micros, TTL at most 60 s, at most 1024 retained entries. Unknown usage counts are never fabricated; observed counts individually at most 1e9.

## Recovery and enablement

No automatic retry. Timeout/disconnect after possible transmission and unsupported failure states yield ambiguous outcome and retain exposure. Malformed success yields deny with no partial result and requires reconciliation. Late responses cannot replace a timed-out decision or settle held exposure. Explicit HTTP 400/401/403 policy rejection becomes a static rejected result; no raw body is read.

The [official turn errors](https://developers.openai.com/api/docs/guides/agents-api/errors), re-checked 2026-10-12, document `session_budget_exceeded`. Within the existing root terminal-event subset, a factual failed turn with that structured code maps to static `failed / provider_failure`, never its raw message. It cannot retry or release exposure; reconciliation is required. Unknown/malformed errors remain fail-closed; this is not exhaustive beta-event support.

LIVE EXECUTOR SMOKE NOT RUN: production start is prohibited by the financial/durable boundary regardless of credentials/entitlement. No real OAuth, executor or inference calls occurred. Fake tests are not live proof.

Before real dispatch: separately authorize a durable executor-specific atomic reservation/start/reconciliation implementation, tenant/account binding and cancellation/revision facts; define a sufficient financial exposure policy with the provider limit only as defense in depth; verify the complete current protocol with supported entitlement; pass independent re-gate and perform a separately bounded approved live smoke. There is no caller-facing unlock switch in this slice.

Deferred: router, payment/subscription selection, accounting platform, quotas/invoices/UI, durable execution lifecycle, queue/leases, sandbox/environment, Quality/Security Gate and corrective orchestration. This is not a complete Development Agent.
