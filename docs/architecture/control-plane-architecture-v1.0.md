# Private AI Cloud — Control Plane Architecture v1.0

**Status:** CURRENT / target architecture (introduced with Roadmap v1.4)\
**Date:** 2026-10-01\
**Roadmap:** `docs/ROADMAP.md` v1.4 (canonical)\
**Decision record:** `docs/ROADMAP_REBASE_V1.4.md`\
**Related:** `docs/architecture/executor-adapter-strategy-v0.1.md`

This document describes the **target** architecture. It does not claim that every layer is implemented. The implementation status of each layer is listed in §17.

## 1. Product role

Private AI Cloud (PAC) is a **vendor-neutral AI Engineering Control Plane**.

- PAC owns the engineering process: intent, plan, policy, routing, verification, security, correction, approval, audit and cost.
- Executors own the internal agent execution mechanism: reasoning, the tool loop, context, subagents and hosted sandboxes.

PAC is not a wrapper around any vendor. It is not a universal proprietary agent runtime, a Codex, Claude Code or Dots clone, a generic think/tool/observe harness, or a universal cloud sandbox provider.

## 2. Architecture overview

```text
                    PRIVATE AI CLOUD
                 AI Engineering Control Plane
                           │
                    Product Intent
                           │
                      FeaturePlan
                           │
                    Admission Policy
                           │
                       Task Graph
                           │
                    Executor Router ───────── Model Router ── ModelProvider
                           │                  (direct bounded model calls)
                    ExecutorAdapter
          ┌────────────────┼────────────────┐
       OpenAI          Anthropic          Other
     Agents API       Claude Code     Qwen / DeepSeek
   (Codex Cloud?)                     Local / Future
          └────────────────┼────────────────┘
                  Normalized Artifacts / Events / Usage
                           │
                      Quality Gate  ◄── Verification Runner (PAC-run checks)
                           │
                     Security Gate  ◄── SecurityEvidenceProvider(s)
                           │
                    Corrective Loop (PAC-controlled; executor performs fix)
                           │
                    Human Approval  (result ≠ commit ≠ push ≠ deploy)
                           │
                       GitHub / PR
                           │
                       Production

   Cross-cutting PAC layers: Tenant/RBAC · Budgets · Idempotency · Audit/Evidence ·
   Observability · Project Knowledge · Secrets policy · Recovery semantics
```

## 3. PAC-owned layers

| Layer | Responsibility |
|---|---|
| Product Intent | Owner request, roadmap item or fix/investigate request |
| FeaturePlan | objective → tasks → dependencies → waves → scope/files → acceptance criteria → verification |
| Admission Policy | ALLOW / REQUIRE_APPROVAL / DENY from risk, paths, scope, architecture boundaries, overlap, executor/provider, permissions, production impact and security impact |
| Task Graph | dependencies, waves, ownership and path overlap; waves never authorize execution by themselves |
| Executor Router | selects an executor for a task (§6) |
| Model Router | selects a model deployment for direct bounded calls (existing) |
| Quality Gate | final verification verdict (§9) |
| Security Policy / Gate | final security verdict, informed by evidence (§8) |
| Corrective Controller | bounded corrective orchestration (§10) |
| Human Approval | approval semantics independent of provider (§11) |
| Audit / Evidence | canonical, provider-independent record (§12) |
| Cost / Usage normalization | §13 |
| Observability normalization | §14 |
| Project Knowledge | §15 |
| GitHub governance | branch/PR policy, commit and push approvals, merge stays manual unless the Owner changes it |
| Tenant / RBAC / secrets policy | workspace isolation, roles, secrets never leave the server or enter audit |

## 4. Provider-owned layers

- model inference and internal reasoning;
- the agent tool loop (think → tool → observe → recover);
- provider-native context management and compaction;
- provider-native subagents;
- hosted sandbox implementation;
- computer/browser execution;
- provider-native trace internals;
- provider-specific retry and session mechanics;
- specialized managed security-research internals.

PAC does not rebuild these. When a provider lacks a capability that a task needs, the router selects another executor or the task is denied. PAC does not build a generic replacement.

## 5. Ownership matrix

| Concern | PAC-owned | Provider-owned | Shared boundary |
|---|---|---|---|
| What to build and why | ✔ | | |
| Plan, tasks, dependencies, waves | ✔ | | |
| Whether a task may run (admission) | ✔ | | |
| Which executor/model runs it | ✔ | | capabilities |
| How the agent reasons and loops | | ✔ | |
| Context window and compaction | | ✔ | |
| Internal subagents | | ✔ | |
| Where code runs | policy ✔ | implementation (managed) ✔ | environment reference |
| Patch / report output | normalization ✔ | production ✔ | artifacts |
| Progress | normalization ✔ | native events ✔ | normalized events |
| Usage and cost | normalization ✔ | reporting ✔ | usage |
| Verification verdict | ✔ | | evidence |
| Security verdict | ✔ | findings (evidence) | evidence |
| Corrective decision | ✔ | fix implementation ✔ | `ExecutorAdapter` |
| Approval | ✔ | | |
| Audit | canonical ✔ | trace (evidence) | evidence |

## 6. ModelProvider vs ExecutorAdapter

These are **separate** layers, even when one vendor offers both.

| | `ModelProvider` (existing) | `ExecutorAdapter` (planned, AI-041.0) |
|---|---|---|
| Purpose | direct, bounded model calls: classification, structured transformation, analysis, planning, review, other bounded inference | managed engineering and agent execution: repository work, coding, tool execution, managed agent sessions, patch production, environment-backed tasks |
| Who loops | nobody; one bounded invocation | the executor, internally |
| Router | Model Router (`model-capability-routing-policy.ts`) | Executor Router (AI-041.3) |
| Safety | preflight, budget reservation, provider-start fence, `outcome_unknown` | same invariants, applied to executor runs |

**Executor Router inputs:**
- capability;
- task class;
- risk;
- cost;
- latency;
- availability;
- data residency;
- privacy;
- context and repository needs;
- execution environment;
- access/payment mode;
- provider quotas and limits;
- historical eval quality;
- Owner preference.

Detection fails closed: an executor that cannot satisfy every requirement is not eligible.

## 7. ExecutionEnvironment

```text
ExecutionEnvironment
├── provider_hosted
├── openai_hosted
├── codex_cloud_if_supported
├── local
├── vps_self_hosted
└── future_provider
```

**Decision rule — managed vs self-hosted.** Use a managed environment by default when it satisfies the task's environment policy. A PAC-operated (local or VPS self-hosted) environment is justified only by one or more of the following:
- privacy;
- data residency;
- ZDR requirements;
- private network access;
- special hardware;
- vendor independence;
- provider outage/fallback;
- cost;
- security-boundary requirements.

Every environment, managed or self-hosted, must satisfy or be denied on:
- filesystem restriction / isolated worktree;
- repository/path allowlist;
- network policy;
- secrets isolation;
- timeouts;
- budgets and changed-file limits;
- artifact and verification-output collection.

## 8. SecurityEvidenceProvider and Security Policy

Evidence sources:
- deterministic scanners;
- dependency scanners;
- secret scanners;
- SAST;
- managed security agents (e.g. Codex Security);
- future external security executors.

**PAC Security Policy consumes evidence; it never delegates the final ALLOW/DENY to a scanner or provider.** PAC keeps:
- secrets policy;
- forbidden-path policy;
- dependency policy;
- auth/security requirements;
- network policy;
- security gates;
- human approval;
- audit.

## 9. Quality Gate

```text
implementation
  → format → lint → typecheck → unit tests → contract tests → integration tests → build
  → secret scan → dependency scan → architecture checks → acceptance checks → regression
  → security evidence
  → PASS / FAIL
```

The Verification Runner (PAC-run, deterministic) executes the checks on executor output. Provider execution never owns the final Quality Gate. An executor's own claims of success count as evidence, not as a verdict.

## 10. Corrective Loop

```text
FAIL → collect evidence → classify root cause → select executor → create bounded corrective task
     → executor performs fix → rerun affected checks → rerun full required Quality Gate
```

PAC owns the loop, its bounds and its decisions:
- max attempts;
- tokens/cost/quota;
- duration;
- changed files;
- risk ceiling.

The executor owns the implementation reasoning. The loop builds on the existing corrective-attempt contract (`development-execution.ts`).

## 11. Human Approval

| Change class | Default policy |
|---|---|
| documentation | may auto-pass by policy |
| ordinary code | may progress after gates according to policy |
| auth | security review |
| DB migration | Owner approval |
| production | Owner approval |
| secrets | DENY unless a separately approved secret-management operation exists |

Result acceptance, commit approval, push approval and deploy approval are four separate decisions. Approval semantics do not depend on which executor or provider was used.

## 12. Audit and evidence

Every engineering workflow eventually retains these provider-independent facts:
- who created it;
- FeaturePlan and task graph;
- executor, provider, and model/version if known;
- access/payment mode;
- environment;
- tools/capabilities;
- changed files and artifacts;
- verification commands and results;
- security evidence;
- approvals;
- failures, retries and corrective actions;
- PR;
- usage, cost/quota, latency/duration.

State changes and their audit events commit together (existing invariant). Provider traces may be attached as evidence. They are never PAC's canonical audit.

## 13. Cost and usage

| Access mode | What is factually knowable |
|---|---|
| `api_key` / metered API | tokens and actual cost, where the provider reports them |
| `provider_credits` | same as API; the funding source differs |
| `subscription_session` | quota/allowance; monetary cost only if the provider factually exposes it |
| `self_hosted` | compute/resource cost |
| future supported mode | whatever the provider factually reports |

Workflow semantics never depend on the funding mechanism. PAC normalizes what is knowable and **never fabricates** a monetary figure. Budget-before-spend applies wherever spend is metered.

## 14. Observability

PAC-level observability covers:
- logs;
- metrics;
- traces;
- runs, failures and retries;
- provider/executor errors;
- latency;
- token usage, spend and quota;
- security events;
- corrective loops.

PAC can ingest provider-native tracing as evidence, but it must never become PAC's only source of truth. The existing operational signals (AI-037.4a) are the first, in-process piece.

## 15. Project Knowledge

PAC owns durable project knowledge:
- policies;
- decisions;
- FeaturePlans;
- artifacts;
- evidence;
- audit.

The executor receives a bounded, policy-filtered projection of this knowledge per task. How the executor manages it in its own context window (including compaction) is provider-owned.

## 16. Provider independence and trust boundaries

**Provider independence:**
- No provider SDK types above the adapter boundary.
- Every executor must be replaceable without changing the FeaturePlan, the policies, the gates, approvals or audit. The second-vendor portability proof (AI-041.2) demonstrates this.

**Trust boundaries:**
1. **Browser → PAC:** untrusted. Identity comes only from the verified server session; workspace and role are decided by PAC (AI-038.1/2a).
2. **PAC → executor:**
   - the executor receives only the admitted, bounded task and the minimum data allowed by data-handling policy;
   - secrets are not passed unless a separately approved mechanism exists.
3. **Executor → PAC:**
   - all executor output is untrusted input: artifacts, events, usage and claims of success;
   - it is validated, normalized, size-limited, re-verified by the Quality Gate, and never executed by PAC as instructions.
4. **Evidence providers → PAC:** findings are evidence, not decisions.
5. **PAC → GitHub/production:** only after the corresponding separate human approval.

Existing invariants apply throughout:
- fail closed;
- tenant isolation;
- authorization before reads;
- budget before spend;
- no second dispatch on an ambiguous outcome;
- idempotency;
- complete audit;
- no secret leakage.

## 17. Implementation status (at 2026-10-01, commit `4e76afd`)

| Layer | Status |
|---|---|
| FeaturePlan, Task Graph, Admission Policy, DevelopmentExecution (incl. corrective attempts), multi-project scheduler | contracts implemented; not persisted or exposed |
| Workflow runtime, budgets, provider-start fence, recovery, tenant isolation, runtime approvals, runtime audit | implemented (PostgreSQL) |
| ModelProvider, registry, Model Router, model invocation | implemented (OpenAI adapter and deterministic mock) |
| Owner read boundary, identity boundary, Auth.js GitHub session adapter | implemented (AI-038.0/.1/.2a); real OAuth smoke pending (AI-038.2b) |
| Quality Gate | partial (CI: lint, typecheck, unit tests, build; manual re-gate) |
| Security Gate, SecurityEvidenceProvider | planned |
| ExecutorAdapter, Executor Router, ExecutionEnvironment | planned (AI-041.0, AI-041.3, AI-042) |
| Corrective Controller, deterministic roadmap controller | planned (AI-043.2/.4) |
| Observability export, engineering-workflow evidence, GitHub repo/PR integration | planned |
