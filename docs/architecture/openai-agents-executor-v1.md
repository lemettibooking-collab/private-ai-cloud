# AI-041.1 — Managed executor transport and financial/start boundary

Status: **IN REVIEW**, not DONE. **Production/live dispatch: BLOCKED.**

Baseline: `bc9360eed0a4959fdbaca7ab787f3e511bb6336f`, branch `feature/development-agent-module`. The Owner explicitly excluded prerequisite AI-041.0 / Decomposition gates, without waiving security invariants, and authorized a separate executor budget/fence bridge. No prior gate is declared passed.

## Responsibilities

`ExecutorAdapter validation → ExecutorDispatchAuthority → ExecutorBudgetAuthority → ExecutorProviderStartFence → ConcreteExecutorTransport → Usage/Reconciliation`

- AI-041.0 is unchanged: validation receipts are not dispatch permits. Human-operated `selectedExecutor` stays inert. ModelInvocation and Workflow Run authority are not accepted.
- `executor-start-boundary.ts` creates three separate frozen facades around private provenance/state. Trusted composition owns the issuers; no route/action exposes them. Calling an issuer is an explicit trusted dispatch/financial decision, not a consequence of validation. Ordinary shaped/cloned objects cannot confer authority. This is not protection against arbitrary code execution inside the trusted server.
- `openai-agents-executor.ts` owns vendor protocol fields. No SDK/vendor shape enters core contracts. Prepared calls bind the exact factual receipt, target and SHA-256 of the exact canonical request bytes.
- `development-executor.server.ts` is a server-only, currently unbound composition root. It exposes no issuers. Production transport is structurally locked: no fetch, enable flag, environment switch or credential can open it. The separately named test factory takes ONLY a trusted injected in-process fake; passing network code to that seam violates its contract.

## Financial admission, not a spending cap

Execution permits and exposure reservations have independent private WeakMap provenance. Binding covers executor/version, invocation, plan/task, repository/baseline, capability/mode, provider/model/account and exact request fingerprint. Reservation identity is unique, monetary values are positive bounded integers, and issuer-clock expiry is captured, not caller time.

Hard **process-local** guarantees per boundary instance:

- maximum admitted exposure per reservation and aggregate held exposure are checked before start;
- reservation + permit eligibility/expiry/bindings are checked synchronously without an `await` between checks and consumption;
- exactly one process-local test start ticket may consume a reservation, and that ticket may be dispatched once;
- expiry/revocation are rechecked immediately before the fake call;
- started invocation and task/repository/mode tuples are never automatically replayed, including under new invocation IDs;
- entry exhaustion denies; no eviction removes replay protection;
- clock failure/rollback denies; expiry never automatically frees a reservation;
- only a pre-start explicit cancellation releases exposure. Post-start failures, ambiguity, missing usage and even zero observed tokens do not release it.

These guarantees do **not** span processes, restarts, independent factory instances or machines. They do not cap actual provider spending. There is no durable cancellation/pause/revision fence, executor ledger, tenant DB integration or enforced maximum session bill. Test-only start tickets never authorize the production transport. Production/live dispatch must remain BLOCKED.

Observed usage is bounded nonnegative integer input/output/total token arithmetic, associated through the exact consumed ticket/reservation. It is best-effort accounting evidence, not financial authority. `observedCostUsdMicros` is always null: no token-derived fictional price or zero cost. Missing usage is `usage_unknown`, valid token evidence is `partially_observed`, malformed/contradictory/ambiguous evidence is `reconciliation_required`. Exposure remains held; the latter state is sticky. A future trusted durable reconciler, not this transport, must establish settlement.

## Provider protocol and evidence

Selected executor: the official **managed Agents API**, not the direct Responses ModelProvider and not PAC-owned generic agent execution. Installed `openai@7.5.0` has no `beta.agents` resource. This slice uses a small fetch-shaped seam; it does not upgrade packages.

Fixed protocol: `POST https://api.openai.com/v1/agents/sessions`, `OpenAI-Beta: agents=v1`, `redirect: error`, streaming, explicit configured model, `environment: {type: none}`, subagents disabled, programmatic tool calling disabled, no external/executable tools, vaults, previous session or conversation. There is no repository mount, shell, sandbox, filesystem crawl, patch application, provider tool handler or follow-up agent loop. PAC supplies only admitted task facts, allowed paths and Owner-authorized file excerpts.

Source checks (2026-10-07): [official quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart), [create request](https://developers.openai.com/api/reference/python/resources/beta/subresources/agents/subresources/sessions/methods/create), [agent configuration schema](https://developers.openai.com/api/reference/python/__sdk_schema?declaration=(resource)+beta.agents.sessions+%3E+(method)+create+%3E+(params)+default.non_streaming+%3E+(param)+agent+%3E+(schema)&selected=(resource)+beta.agents.sessions+%3E+(method)+create), [events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events), [completed item schema](https://developers.openai.com/api/reference/typescript/__sdk_schema?declaration=(resource)+beta.agents+%3E+(model)+agent_session_turn_item_done_event+%3E+(schema)&selected=(resource)+beta.agents), [message schema](https://developers.openai.com/api/reference/typescript/__sdk_schema?declaration=(resource)+beta.agents+%3E+(model)+agent_session_message+%3E+(schema)&selected=(resource)+beta.agents), [turn](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/subagents/subresources/turns/methods/retrieve).

The checked request schemas do not establish an adjustable per-session token/cost hard cap. The documented `session_budget_exceeded` code alone does not establish one. A transport timeout only stops local waiting; abort is NOT proof of remote cancellation or bounded remote spending.

Supported SSE subset is intentionally narrow, bounded and fail-closed; unknown events/fields/tool outputs reject. It requires a coherent session identity/model/no-tools configuration, completed assistant final-answer item and root terminal turn for the same session/turn. Reasoning is ignored and never projected. Several detailed terminal-event schema fetches were unavailable; current fixtures validate the known documented subset, not exhaustive beta compatibility. This limitation must be resolved alongside live/durable enablement, not hidden as a live compatibility proof.

The model supplies only `{changes, report}` JSON. The adapter computes UTF-8 SHA-256 integrity digests and ALWAYS calls the existing factual `evaluateResult` with its original receipt; core rechecks paths, operations, output mode, meaningful report, sizes and unsafe evidence. Hashes prove byte integrity, not correctness. All accepted results, including normalized failures, keep `verificationStatus: not_run`, `ownerDecisionRequired: true`, `automaticRetryAllowed: false`. No passing tests or Quality/Security Gate is inferred.

Credentials are captured from a trusted synchronous credential provider only, after provenance checks, and used only as the Authorization header. The endpoint cannot be caller redirected. Public outcomes use static codes; raw errors/provider bodies/credentials do not escape. Credential echoes and probable secret evidence are denied. No OAuth/ChatGPT credential reuse, environment serialization, public logs or UI wiring.

Bounds: context 8 files, 8 KiB each / 32 KiB total; request 64 KiB; response 256 KiB, 64 events, 4096 chunks; timeout 1–30000 ms. Existing bounded hostile-input snapshot depth/node/member/string limits are reused. Financial policy: monetary ceiling at most 1e9 USD micros, TTL at most 60 s, at most 1024 retained entries. Unknown usage counts are never fabricated; observed counts individually at most 1e9.

## Recovery and enablement

No automatic retry. Timeout/disconnect after possible transmission and unsupported failure states yield ambiguous outcome and retain exposure. Malformed success yields deny with no partial result and requires reconciliation. Late responses cannot replace a timed-out decision or settle held exposure. Explicit HTTP 400/401/403 policy rejection becomes a static rejected result; no raw body is read.

LIVE EXECUTOR SMOKE NOT RUN: production start is prohibited by the financial/durable boundary regardless of credentials/entitlement. No real OAuth, executor or inference calls occurred. Fake tests are not live proof.

Before real dispatch: separately authorize a durable executor-specific atomic reservation/start/reconciliation implementation, tenant/account binding and cancellation/revision facts; define a sufficient financial exposure policy despite missing provider hard caps; verify the complete current protocol with supported entitlement; pass independent re-gate and perform a separately bounded approved live smoke. There is no caller-facing unlock switch in this slice.

Deferred: router, payment/subscription selection, accounting platform, quotas/invoices/UI, durable execution lifecycle, queue/leases, sandbox/environment, Quality/Security Gate and corrective orchestration. This is not a complete Development Agent.
