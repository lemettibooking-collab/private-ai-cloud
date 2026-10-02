# Documentation index and authority

This file tells humans and coding agents which documents are authoritative. **`docs/ROADMAP.md` is the roadmap source of truth.** If documents conflict, the higher class below wins. Within a class, the newer version wins.

Private AI Cloud is a **vendor-neutral AI Engineering Control Plane**: PAC owns the engineering process, and executors own the internal agent execution mechanism. Any document that plans a PAC-owned generic agent loop, a generic context-compaction runtime, a mandatory own coding worker or sandbox, or a generic browser or subagent runtime is historical where it conflicts with v1.4.

## CURRENT / CANONICAL

| Document | Role |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | Canonical roadmap (v1.4) and execution status |
| [`../AGENTS.md`](../AGENTS.md) | Rules for coding agents: scope, security invariants, DB rules, verification, gate process |

## CURRENT / SUPPORTING

| Document | Role |
|---|---|
| [`ROADMAP_REBASE_V1.4.md`](ROADMAP_REBASE_V1.4.md) | Decision record for the v1.4 rebase (why and how the roadmap changed) |
| [`architecture/control-plane-architecture-v1.0.md`](architecture/control-plane-architecture-v1.0.md) | Target architecture and the PAC-owned vs provider-owned matrix |
| [`architecture/executor-adapter-strategy-v0.1.md`](architecture/executor-adapter-strategy-v0.1.md) | Design input for AI-041.0; not a finalized contract |
| [`architecture/data-model-blueprint-v0.1.md`](architecture/data-model-blueprint-v0.1.md) | Domain data model. Still valid for the data model; its "current context" section describes the DB-01-era frontend-only state and is historical. |
| [`architecture/database-schema-v0.1.md`](architecture/database-schema-v0.1.md) | Schema blueprint. Applied migrations in `db/migrations/` are the factual schema. |
| [`architecture/db-foundation-implementation-plan-v0.1.md`](architecture/db-foundation-implementation-plan-v0.1.md) | DB foundation plan. Its context section is historical (DB-01 era). |
| [`operations/workflow-runtime-recovery.md`](operations/workflow-runtime-recovery.md) | Owner-operated recovery procedure |
| [`../db/README.md`](../db/README.md) | DB scaffold notes. Its "no backend routes / no auth" lines predate AI-038.2a and are outdated (see `../PROJECT_STATUS.md`). |
| [`../README.md`](../README.md), [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) | Short project overview and current state |

## HISTORICAL / SUPERSEDED

These are kept as history. They are not current architecture where they conflict with v1.4. They include assumptions that v1.4 no longer requires: a separate orchestrator process, worker and coding-worker processes, one-time containers or a mandatory sandbox, Redis/BullMQ for execution, and a PAC-run headless Qwen runner.

| Document | Note |
|---|---|
| [`AI_Infrastructure_Architecture_Decision_Orchestrator — копия.md` (the filename has a non-breaking space before the dash)](AI_Infrastructure_Architecture_Decision_Orchestrator%C2%A0%E2%80%94%20%D0%BA%D0%BE%D0%BF%D0%B8%D1%8F.md) | ADR-001 (2026-08-14). The multi-provider and approval principles still hold; the orchestrator/worker topology is historical. |
| [`AI_Infrastructure_Technical_Specification_v0.3.md`](AI_Infrastructure_Technical_Specification_v0.3.md) | Early MVP specification |
| [`AI_Infrastructure_Roadmap_v0.3.md`](AI_Infrastructure_Roadmap_v0.3.md) | Early phase roadmap |
| [`AI_Infrastructure_Development_Master_Plan_v0.4.md`](AI_Infrastructure_Development_Master_Plan_v0.4.md) | Early development plan |
| [`AI_Infrastructure_Execution_Plan_v0.5_Post_Audit.md`](AI_Infrastructure_Execution_Plan_v0.5_Post_Audit.md) and copies `(2)`, `(3)` | Post-audit execution plan (August 2026) |

## QA / EVIDENCE

These are point-in-time evidence and are never rewritten.

| Location | Content |
|---|---|
| [`qa/ai-036/`](qa/ai-036/) | AI-036 gate and re-gate reports |
| [`qa/db-03-5-local-sql-validation.md`](qa/db-03-5-local-sql-validation.md) | DB-03.5 SQL validation |
| [`qa/ui-product-review-v0.1.md`](qa/ui-product-review-v0.1.md) | UI product review of the frontend prototype |

## Rules for agents

1. Read `ROADMAP.md` and `../AGENTS.md` first. Treat v0.3, v0.4 and v0.5 documents as context only.
2. Repository code is the evidence for implementation status. A planning document is not.
3. Do not edit QA reports or applied migrations. Do not rewrite historical documents beyond their supersession notice.
4. A strategic change requires a new roadmap version approved by the Owner.
