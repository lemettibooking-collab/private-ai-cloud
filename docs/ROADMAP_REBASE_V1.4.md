# Roadmap Rebase v1.4 — Decision Record

**Decision:** Private AI Cloud becomes a vendor-neutral AI Engineering Control Plane\
**Date:** 2026-10-01\
**Status:** Owner-approved strategic decision. This record documents the approved migration; it is not itself a roadmap.\
**Baseline:** `feature/development-agent-module` at `4e76afd` (`feat: add GitHub owner session adapter`)\
**Canonical roadmap:** `docs/ROADMAP.md` v1.4. This file records why and how the roadmap changed. If the two disagree, `docs/ROADMAP.md` wins.

## 1. Background

Roadmaps v1.2–v1.3 planned an M4 "Execution Platform" where PAC would build execution backends (`CodexBackend`, `ClaudeCodeBackend`) and an isolated coding worker (AI-042). Older strategic documents (v0.3–v0.5, ADR-001) went further: a separate orchestrator process, worker and coding-worker processes, one-time containers, Redis/BullMQ, and a headless Qwen runner.

Managed agent runtimes now provide the agent loop, context management, subagents and hosted sandboxes. Rebuilding those inside PAC would duplicate vendor work and tie PAC to one vendor's design. The Owner approved a narrower, stronger position:

> **PAC owns the engineering process. Executors own the internal agent execution mechanism.**

PAC is not a wrapper around OpenAI, Anthropic or Dots. It is not a universal proprietary agent runtime, nor a Codex, Claude Code or Dots clone. It is not a generic think/tool/observe harness or a universal cloud sandbox provider.

## 2. Current repository audit

Evidence comes from repository code at `4e76afd`, not from planning documents. The full census, with file references, is kept in the rebase report.

| Subsystem | Status | Evidence |
|---|---|---|
| FeaturePlan | IMPLEMENTED (contract) | `lib/contracts/development-plan.ts` — validation, statuses, priorities; not persisted in DB |
| Task graph / dependency waves | IMPLEMENTED (contract) | `buildDevelopmentTaskWaves`, `findEligibleDevelopmentTaskIds`. Waves are a logical grouping only and do not authorize execution. |
| Admission Policy | IMPLEMENTED (contract) | `lib/contracts/development-task-policy.ts` — `allow` / `require_approval` / `deny`, forbidden and sensitive paths, overlap |
| Development execution state | IMPLEMENTED (contract) | `lib/contracts/development-execution.ts` — pure state transitions; no commands, agents, Git or network |
| Corrective-attempt contract | IMPLEMENTED (contract) | attempt kinds `initial` / `corrective`, max attempts, `awaiting_correction`; no automatic controller |
| Workflow runtime | IMPLEMENTED | `lib/workflows/workflow-runtime-service.ts`, `lib/db/*`, migrations 0002–0007 |
| ModelProvider abstraction | IMPLEMENTED | `lib/contracts/model-provider-adapter.ts`, OpenAI adapter and deterministic mock |
| Model registry | IMPLEMENTED (contract) | `lib/contracts/model-provider-registry.ts` |
| Model routing (direct-model) | IMPLEMENTED (contract) | `lib/contracts/model-capability-routing-policy.ts` |
| Model invocation | IMPLEMENTED | `model-invocation*.ts`, invocation ledger |
| Usage / budget | IMPLEMENTED for API tokens / USD micros | budget windows and reservations (0006). Subscription quota and self-hosted accounting are PLANNED. |
| Provider-start fencing | IMPLEMENTED | M1 / AI-036.x |
| Audit / evidence | IMPLEMENTED for runtime state (`audit_events`) | Engineering-workflow evidence is PLANNED |
| Approval | IMPLEMENTED for runtime (`approval_requests` / `approval_decisions`) | Result, commit, push and deploy approvals are PLANNED |
| Tenant isolation | IMPLEMENTED | 0007, tenant resolver, AI-037.7 facade |
| Owner read boundary | IMPLEMENTED | AI-038.0 |
| Owner auth/session | IN PROGRESS | AI-038.1 and AI-038.2a are DONE; AI-038.2b is PLANNED |
| Quality Gate | PARTIAL | `.github/workflows/quality.yml` (lint, typecheck, unit tests, build) plus a manual adversarial re-gate |
| Security policy | PARTIAL | path policy, data-handling policy, runtime invariants |
| GitHub integration | IDENTITY ONLY | Auth.js GitHub OAuth (AI-038.2a); no repository or PR integration |
| Observability | PARTIAL | in-process operational signals (AI-037.4a) |
| Multi-project scheduling | IMPLEMENTED (contract) | `lib/contracts/multi-project-run-scheduler.ts` |
| Executor abstraction | PLANNED | no code |
| Sandbox / execution environment | PLANNED | no code |
| Browser / computer use | NOT PRESENT | will not be PAC-owned |
| Subagent execution | NOT PRESENT | will not be PAC-owned |
| Context compaction | NOT PRESENT | will not be PAC-owned |
| Generic agent loop | NOT PRESENT | `agent-step-runtime.ts` runs one bounded model invocation per step; tool-call proposals fail closed (`tool_runtime_unavailable`) |

No existing code is obsolete. `agent-step-runtime.ts` contains control-plane policy, routing, invocation and state-transition logic, and it stays. The rebase forbids growing it into a generic think/tool/observe loop.

## 3. Roadmap Diff

Decision values: KEEP, MODIFY, REPLACE_WITH_PROVIDER, DEFER, REMOVE, NEW.

| Existing item | Current purpose | Current status | Decision | Reason | Replacement | Dependencies |
|---|---|---|---|---|---|---|
| M2.0 | Real-provider composition root and runner | DONE | KEEP | Implemented history | — | — |
| M2.1 | Fake SDK below real adapter, live PG | DONE | KEEP | Implemented history | — | — |
| M2.2 | One Owner-approved paid call | DEFERRED BY OWNER | KEEP | Owner commercial sequencing is unchanged | — | Owner API billing |
| M2 Review Gate | Review M3–M8 after real provider | REQUIRED | MODIFY | Questions now ask about the first managed executor, not a CodexBackend | Executor-oriented questions | M2.2 |
| AI-038.2a | Auth.js GitHub session adapter | DONE (`4e76afd`) | KEEP | Passed re-gate and committed | — | — |
| AI-038.2b | Real GitHub OAuth smoke | PLANNED / BLOCKED ON OWNER EXTERNAL CONFIG | KEEP | Still required for AI-038.2 | — | Owner OAuth app config |
| AI-039 | Development Workflow Browser | PLANNED | KEEP | Owner view of FeaturePlan and risk is PAC-owned | Executor recommendation comes from ExecutorRouter once available | AI-038.2 |
| AI-040a | Local developer handoff | PLANNED | MODIFY | Must not grow a PAC agent loop or sandbox | Uses ExecutorAdapter concept once AI-041.0 exists | M2 gate or early M3 |
| AI-040b | Owner UI integration of handoff | LATER | KEEP | Same pipeline, UI client only | — | AI-040a, AI-038 |
| Architecture Decomposition Gate | Modular boundaries before scale-up | PLANNED | MODIFY | `execution` module becomes executor contracts; the gate must not block contract-only AI-041.0 | — | before AI-041.1+ |
| AI-041.0 | v1.3 Execution Backend Contract | PLANNED | MODIFY | Reframed as vendor-neutral ExecutorAdapter contract; first new task | Vendor-Neutral Executor Adapter Contract | — |
| AI-041.1 | v1.3 first backend (CodexBackend default) | PLANNED | MODIFY | Managed agent API preferred as first candidate | OpenAIAgentsExecutor (Agents API) | AI-041.0 gate |
| AI-041.2 | Second backend portability proof | PLANNED | KEEP (renamed concepts) | Portability proof is still the key test | ClaudeCodeExecutor preferred | AI-041.1 |
| Executor Router | Choose executor per task | implicit in v1.3 | NEW (AI-041.3) | Must stay separate from direct ModelRouter | — | AI-041.2 |
| AI-042 | Isolated Coding Worker | PLANNED | REPLACE_WITH_PROVIDER (+ conditional fallback) | Managed environments exist; own sandbox only when justified | ExecutionEnvironment abstraction | AI-041.0 |
| AI-037.2 | Durable Step result | DEFERRED | KEEP | Still needed before autonomy; also covers executor outcomes | — | AI-043.2 |
| AI-037.3 | Ambiguous COMMIT reconciliation | DEFERRED | KEEP | Control-plane correctness | — | autonomy/staging |
| AI-037.5 | TLS/config allowlist | DEFERRED | KEEP | Staging blocker | — | staging; earlier if non-loopback PG |
| AI-037.6b | Lease heartbeat | DEFERRED | KEEP | Long executor runs may pull it forward | — | evidence |
| AI-037.8 | Durable admission control | DEFERRED | KEEP | Needed before autonomous controller | — | AI-043.2 |
| AI-043.0 | Executable roadmap contract | PLANNED | KEEP | PAC-owned | — | — |
| AI-043.1 | Roadmap planner | PLANNED | KEEP | PAC-owned (task graph, waves) | — | AI-043.0 |
| AI-043.2 | Continuous Development Controller | PLANNED | MODIFY | Must be a deterministic, durable controller, not an LLM loop | Executor orchestration via ExecutorRouter/Adapter | AI-041.*, AI-037.2/.8 |
| AI-043.3 | Approval gate engine | PLANNED | KEEP | PAC-owned approval semantics | — | AI-043.0 |
| AI-043.4 | Autonomous self-fix loop | PLANNED | MODIFY | PAC owns corrective orchestration; executor does the fix | Autonomous Corrective Loop | AI-043.2, Quality Gate |
| AI-043.5 | Roadmap Owner UX | PLANNED | KEEP | — | — | AI-043.0 |
| AI-044 | Task → verified PR | PLANNED | MODIFY | Remove "isolated worker" step; add executor portability | Executor-neutral pipeline | M4, M5 |
| AI-045 | Production-like infrastructure | PLANNED | MODIFY | No assumed own coding worker or Redis/BullMQ by default | Control-plane hosting; queues on demand | AI-044 |
| AI-046 | Owner Control contract | PLANNED | KEEP | — | — | — |
| AI-047 | Secure Telegram bot | PLANNED | KEEP | Same control plane | — | AI-046 |
| AI-048 | Remote roadmap/run control | PLANNED | KEEP | — | — | AI-047 |
| AI-048.1 | Durable notifications | PLANNED | KEEP | Outbox worker is control-plane, not coding worker | — | AI-048 |
| AI-049 | Telegram approvals | PLANNED | KEEP | — | — | AI-048 |
| AI-050 | Commit/push approvals | PLANNED | KEEP | result ≠ commit ≠ push ≠ deploy | — | AI-049 |
| AI-051 | Telegram hardening | PLANNED | KEEP | — | — | AI-050 |
| Generic agent loop | PAC-owned think/tool/observe runtime (implicit in v0.x/v1.3) | not built | REMOVE | Provider-owned | Executor behind ExecutorAdapter | — |
| Generic context compaction | PAC-owned history compaction | not built | REMOVE | Provider-owned | PAC keeps Project Knowledge, evidence, audit | — |
| Generic sandbox / coding worker | PAC-owned universal sandbox | not built | REPLACE_WITH_PROVIDER | Managed first | ExecutionEnvironment + conditional self-hosted | AI-042 |
| Browser/computer-use runtime | PAC-owned browser agent | not built | REMOVE | Executor capability | PAC policy/permission/evidence only | — |
| Subagent runtime | spawn/wait/aggregate | not built | REMOVE | Provider-native | PAC Task Graph/waves | — |
| Security research agent | proprietary vuln researcher | not built | REPLACE_WITH_PROVIDER | Managed tools exist | SecurityEvidenceProvider (evidence only) | Security Gate |
| OpenAI Agents API | — | — | NEW (P1) | First managed executor candidate | AI-041.1 | AI-041.0 |
| Codex Cloud | — | — | NEW (P1 RESEARCH) | Interface suitability unverified | AI-041.R1 | — |
| Codex Security | — | — | NEW (P1/P2, future) | Evidence source | SecurityEvidenceProvider | Security Gate |
| Sign in with ChatGPT | — | — | NEW (P2 RESEARCH) | Plan usage is eligibility-limited | — | — |
| Dots | — | — | DEFER | No supported programmatic interface found | Benchmark; future DotExecutor only if an API appears | — |

## 4. PAC-owned vs provider-owned

| PAC-owned | Provider-owned |
|---|---|
| Product Intent, FeaturePlan, Task Graph | model inference, internal reasoning |
| Admission Policy | agent tool loop |
| Executor Router (and separate direct-model router) | provider-native context management and compaction |
| Quality Gate | provider-native subagents |
| Security Policy and Security Gate | hosted sandbox implementation |
| Corrective Controller | computer/browser execution |
| Human Approval | provider-native trace internals |
| Audit / Evidence | provider-specific retry/session mechanics |
| Cost / usage normalization | specialized managed security research internals |
| Observability normalization | |
| Project Knowledge | |
| GitHub governance | |
| Tenant / RBAC, secrets policy | |

Shared boundary: `ExecutorAdapter`, normalized events, artifacts, usage, evidence, capabilities and the execution-environment reference. See `docs/architecture/control-plane-architecture-v1.0.md`.

## 5. Delete / Defer list

| Item | Decision |
|---|---|
| PAC-owned generic agent loop | REMOVE from future PAC scope |
| PAC-owned generic context compaction | REMOVE from future PAC scope |
| Mandatory own cloud sandbox / coding worker | REPLACE with ExecutionEnvironment; self-hosted fallback only when justified |
| Generic browser/computer-use product | REMOVE from future PAC scope |
| Generic subagent spawn/wait/aggregate | REMOVE from future PAC scope |
| Proprietary full vulnerability-research replacement | REMOVE; use SecurityEvidenceProvider |
| Redis/BullMQ as a default production requirement | DEFER until the control-plane workload requires queues |
| Headless Qwen runner as a PAC component | DEFER; QwenExecutor only when a real use case exists |
| Dots integration | DEFER / RESEARCH |

Nothing in the repository is deleted. Historical documents are kept and marked superseded where they conflict.

## 6. New integrations

| Integration | Priority | Role | Status |
|---|---|---|---|
| OpenAI Agents API | P1 | First managed executor candidate (`OpenAIAgentsExecutor`) | Planned after the AI-041.0 gate |
| Codex Cloud | P1 | Possible executor or environment | RESEARCH (AI-041.R1); not a dependency |
| Codex Security | P1/P2 | `SecurityEvidenceProvider` / security executor | Future; evidence only |
| Sign in with ChatGPT | P2 | Identity / possible plan-usage access mode | RESEARCH; not mandatory |
| Dots | — | Benchmark; possible `DotExecutor` | DEFERRED / RESEARCH |

## 7. Migration plan

1. **Documentation (this rebase).** Update the canonical roadmap to v1.4, add the architecture and strategy documents, add the docs index, and correct stale root documents and AGENTS.md project state. Mark legacy strategic documents as superseded. No code, test, migration or package changes.
2. **Operational line continues unchanged:** AI-038.2b, then Owner Console real read wiring (AI-038.3, to be scoped), then AI-039.
3. **AI-041.0:** the vendor-neutral ExecutorAdapter contract and contract tests only, with a deterministic fake executor and no SDK.
4. **AI-041.1:** the OpenAIAgentsExecutor, after re-verifying the Agents API capabilities from full official documentation.
5. **AI-041.2 and AI-041.3:** the second-vendor portability proof, then the ExecutorRouter.
6. **AI-042:** the ExecutionEnvironment abstraction, plus a self-hosted environment only with factual justification.
7. **M5, then M6:** the deterministic controller and corrective loop, then the Smart Algorithms verified PR.

## 8. Compatibility with implemented code

- No code is renamed, removed or invalidated. All completed AI stages keep their numbers and status.
- `ModelProvider`, the model registry and the model routing policy stay as the direct-model layer. The future `ExecutorAdapter` is a separate layer and does not replace them.
- FeaturePlan, Admission Policy, DevelopmentExecution (including corrective attempts) and the multi-project scheduler are exactly the PAC-owned contracts the new architecture needs. Later tasks build on them.
- Workflow-runtime invariants carry over to executor runs: tenant isolation, budget-before-spend, provider-start fencing, `outcome_unknown`, idempotency and audit.
- `agent-step-runtime.ts` stays. Its fail-closed refusal to execute tool-call proposals matches v1.4 (no PAC-owned tool loop).
- `ExecutionBackend`, `CodexBackend` and `ClaudeCodeBackend` existed only in documents. The rename to `ExecutorAdapter`, `OpenAIAgentsExecutor` and `ClaudeCodeExecutor` does not affect code.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Vendor capability drift: the Agents API is in public beta, and Codex Cloud is partly experimental | Capabilities are re-verified at each adapter task; capability detection fails closed; a second vendor proves portability |
| Leaking provider types into PAC | A hard rule that no provider SDK types appear above the adapter boundary, enforced in AI-041.0 contract tests |
| Over-trusting provider traces or scanners | Provider data is evidence; PAC audit and PAC Security Policy stay authoritative |
| Subscription cost opacity | No fabricated USD; quota is tracked as a separate signal |
| Managed environments that do not meet data-residency, ZDR or private-network needs | Conditional self-hosted ExecutionEnvironment |
| Agents reading v0.x documents as current | Supersession notices and the `docs/README.md` authority index |
| Unfinished AI-038 work forgotten | AI-038.2b stays explicitly on the operational line |
| External facts verified only through official-domain search evidence (direct page fetch failed during the rebase) | All provider-specific details are marked for re-verification before implementation |

## 10. First post-rebase implementation task

**AI-041.0 — Vendor-Neutral Executor Adapter Contract — PLANNED.**

The task defines only the PAC-owned contract and its contract tests:
- request;
- capabilities;
- access mode;
- environment reference;
- run identity;
- events;
- artifacts;
- usage;
- outcome;
- status, cancel, and resume where supported.

It uses a deterministic fake executor. Out of scope: SDKs, provider adapters, network calls and Agents API code. Design input: `docs/architecture/executor-adapter-strategy-v0.1.md`.

## 11. External capability assumptions

Method and limits: these facts come from web searches restricted to official OpenAI domains (developers.openai.com, openai.com, help.openai.com) on 2026-10-01. Direct page fetches failed during the rebase because of local DNS resolution. The facts are therefore summaries of official pages and have not been read in full. **They must be re-verified from the full official pages before AI-041.1 or any integration task relies on them.** No blogs, forums or vendor comparisons were used.

| Capability | Classification | Architecture-relevant facts | Official sources |
|---|---|---|---|
| OpenAI Agents API | VERIFIED CURRENT CAPABILITY (public beta) | Managed API exposing the Codex harness. OpenAI manages sessions, orchestration, context compaction and recovery; the application provides tools and chooses the environment (`openai_hosted`, `self_hosted`, `none`). Progress arrives by streaming events and/or webhooks. Billed at model/tool/container rates. | developers.openai.com/api/docs/guides/agents-api/overview; openai.com/index/introducing-the-agents-api |
| Agents API details: event schema, cancel, artifacts, usage granularity, ZDR | ROADMAP RESEARCH TARGET | Not verified | — |
| Codex Cloud | ROADMAP RESEARCH TARGET | Reusable cloud environments with isolated per-task workspaces; review, follow-up and PR from the UI. The `codex cloud` CLI is experimental. The Codex SDK controls **local** Codex threads. A supported server-side control-plane API for cloud tasks was **not** confirmed. | developers.openai.com/codex/cloud; /codex/cli/reference; /codex/sdk |
| Codex Security | VERIFIED CURRENT CAPABILITY (research preview) | Builds a threat model, scans a repository or commits, validates in an isolated environment and proposes patches. Plans: Enterprise, Edu, Business, Pro. Plugin, CLI, TypeScript SDK and cloud are mentioned. Machine-readable export: TO VERIFY. | developers.openai.com/codex/security; help.openai.com (Codex Security) |
| Sign in with ChatGPT | VERIFIED CURRENT CAPABILITY (limited) | Sign-in for participating apps. Using plan usage in other apps is limited to Plus and Pro, with user-set weekly per-app limits. Partner (form) and open-source routes exist. Eligibility of a private control plane: TO VERIFY. | developers.openai.com/siwc; help.openai.com "Using your ChatGPT plan in other apps and sites" |
| Dots | No developer API found | An always-on agent inside ChatGPT (Pro outside EEA/CH/UK; Business Premium). No official programmatic interface was found. | openai.com/index/introducing-dots; help.openai.com "Getting started with your dot" |

## 12. Owner approval record

- The Owner (Максим) approved the strategic direction: a vendor-neutral AI Engineering Control Plane, the PAC-owned vs provider-owned boundary, and the remove/replace decisions in §5. The approval was given in the Roadmap Rebase v1.4 task brief dated 2026-10-01.
- `docs/ROADMAP.md` is the only canonical roadmap. This record explains the approved migration and does not override it.
- Every implementation or code task that follows from this decision (starting with AI-041.0) still requires its own scope, verification and independent gate.
- Any later strategic change requires a new Roadmap Change Request and Owner approval.
