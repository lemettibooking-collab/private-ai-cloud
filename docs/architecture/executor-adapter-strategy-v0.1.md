# Executor Adapter Strategy v0.1

**Status:** DESIGN INPUT for AI-041.0. Pre-contract architecture; not a finalized code contract.\
**Date:** 2026-10-01\
**Roadmap:** `docs/ROADMAP.md` v1.4, §11\
**Architecture:** `docs/architecture/control-plane-architecture-v1.0.md`

The names below are conceptual. The concrete TypeScript shapes, field names, limits and state machine are decided and gated in AI-041.0. They are not fixed by this document. Nothing here is implemented.

## 1. Purpose

`ExecutorAdapter` is the single boundary between PAC and any managed or self-hosted agent/coding executor. Above the boundary, PAC owns:
- FeaturePlan;
- Admission Policy;
- routing;
- the Quality and Security Gates;
- the corrective controller;
- approvals;
- audit;
- cost normalization.

Below it, the executor owns:
- reasoning and the tool loop;
- context and compaction;
- subagents;
- its sandbox.

## 2. Core distinctions

| Not the same thing | Why it matters |
|---|---|
| `ModelProvider` ≠ `ExecutorAdapter` | A `ModelProvider` makes one bounded model call. An executor runs a multi-step agent session that changes a repository or environment. They have different routers, different accounting, different risk and different failure modes. |
| Security scanner ≠ final Security Policy | Scanners and managed security agents produce evidence. The PAC Security Policy decides. |
| Provider trace ≠ canonical PAC audit | Traces may be incomplete, retained by the vendor, or changed by the vendor. PAC audit is transactional and provider-independent. |
| Provider session ≠ PAC workflow state | A session ID is an opaque external reference. PAC run, attempt, approval and budget state stay in PAC's durable store. |
| Executor success claim ≠ Quality Gate PASS | PAC re-runs verification itself. |

**Hard rule: no provider-specific SDK types, enums, errors or event objects above the adapter boundary.** The adapter translates both ways and fails closed on anything it cannot translate.

## 3. Conceptual elements

### ExecutorAdapter
- `describe` → `ExecutorCapabilities` (static plus runtime availability)
- `start(ExecutorRequest)` → `ExecutorRunIdentity`
- `status` / `events` (pull or push) → normalized `ExecutorEvent`s
- `cancel` (if supported)
- `resume` / `continue` (only if supported)
- `collect` → `ExecutorArtifact`s, `ExecutorUsage` and `ExecutorOutcome`

Starting a run is a spend-bearing dispatch. It follows the M1 rules:
- reserve the budget first;
- re-check under the provider-start fence;
- on an ambiguous start or outcome, record `outcome_unknown` and never dispatch a second time.

### ExecutorRequest
A bounded task derived from an admitted FeaturePlan task:
- task identity;
- objective and acceptance criteria;
- repository and path scope (allowlist);
- verification expectations;
- limits (time, tokens/cost/quota, changed files, attempts);
- the required environment policy;
- the permitted data, under data-handling policy;
- an idempotency key.

It carries no secrets, unless a separately approved secret mechanism exists.

### ExecutorCapabilities
What the executor factually supports. Each item is detected, never assumed:
- repository read/write;
- patch output and branch/PR creation;
- supported environments;
- network control;
- cancel, resume, streaming and webhooks;
- supported access modes;
- usage reporting granularity;
- data-retention properties (e.g. ZDR eligibility);
- maximum run duration.

### ExecutorAccessMode
- `subscription_session`
- `api_key`
- `provider_credits`
- `self_hosted`
- future supported mode

The access mode is configuration and never changes workflow semantics. PAC never stores passwords, browser cookies or raw interactive session tokens, and never scrapes access.

### ExecutionEnvironmentRef
A reference to one of:
- `provider_hosted`
- `openai_hosted`
- `codex_cloud_if_supported`
- `local`
- `vps_self_hosted`
- `future_provider`

It comes with the environment policy the environment must satisfy:
- filesystem restriction;
- path allowlist;
- network policy;
- secrets isolation;
- timeouts;
- budgets;
- artifact collection.

### ExecutorRunIdentity
The PAC run and attempt identity, executor identity, and model/version if known. It also carries opaque provider references (session or task IDs) that are stored as data only and never parsed above the adapter.

### ExecutorEvent
Normalized and bounded:
- `accepted`, `running`, `progress` (bounded text/metadata);
- `needs_input` / `approval_requested` (routed to PAC approval; never auto-approved);
- `artifact_available`;
- `completed`, `failed`, `cancelled`, `unknown`.

Unknown or malformed provider events map to a fail-closed state.

### ExecutorArtifact
Patch/diff, report, logs, verification outputs and changed-file list. Each artifact comes with its content hash, size limit and provenance. Artifacts are untrusted input: PAC validates them and re-verifies the work. It never executes an artifact as instructions.

### ExecutorUsage
- `metered_api`: tokens; actual cost if reported
- `subscription`: quota/allowance; cost only if factually exposed
- `provider_credits`: tokens/credits consumed
- `self_hosted`: compute/resource usage

When a figure is unknown, PAC records it as unknown and never invents one.

### ExecutorOutcome
- `succeeded` (executor claim, which must still pass the Quality Gate)
- `failed` (definitive, with failure class)
- `cancelled`
- `outcome_unknown` (ambiguous → recovery semantics; no automatic redispatch)

## 4. Candidate adapters

| Adapter | Status | Notes |
|---|---|---|
| `OpenAIAgentsExecutor` | P1 candidate (AI-041.1) | OpenAI Agents API (public beta at rebase time). Hosted or self-hosted environments; streaming/webhooks. Capabilities must be re-verified from official docs at implementation. |
| `ClaudeCodeExecutor` | preferred second-vendor portability proof (AI-041.2) | Claude Code via supported subscription access or Anthropic API, selected by policy |
| `QwenExecutor` | deferred | only when there is a real use case |
| `DeepSeekExecutor` | deferred | only when there is a real use case |
| `LocalExecutor` | deferred | self-hosted/local, only with factual justification (privacy, residency, cost, fallback) |
| Codex Cloud–based executor or environment | research (AI-041.R1) | only if a supported control-plane interface is confirmed |
| `DotExecutor` | deferred | only if an appropriate official programmatic interface appears |

A deterministic fake executor (test-only) is part of AI-041.0. It proves the contract without network access.

## 5. Contract test expectations for AI-041.0 (guidance)

- Provider-specific types cannot appear in contract outputs. Unknown fields are rejected.
- Malformed, oversized, Proxy, accessor or thenable inputs are rejected without executing them, following existing project patterns.
- An ambiguous start or outcome produces `outcome_unknown`, and no second start occurs.
- An idempotent replay returns the same identity; the same key with a different request is a conflict.
- A capability or access-mode mismatch is denied before dispatch.
- Usage is never fabricated; an unknown cost stays unknown.
- A `needs_input` or approval request is never auto-approved.

## 6. Out of scope for AI-041.0

- SDKs and dependencies;
- real provider calls;
- Agents API code;
- migrations, unless explicitly scoped;
- HTTP routes and UI wiring;
- the Executor Router (AI-041.3);
- environment implementations (AI-042).
