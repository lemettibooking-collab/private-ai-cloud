# AI-036 Security Evidence

This directory contains the evidence trail for the AI-036 security corrective sprint.

## Artifacts

### 1. AI-036-adversarial-regate-report.md

Initial adversarial security re-gate.

Result: FAIL.

The gate confirmed the original security/correctness blockers and later identified
the pooled PostgreSQL connection lifecycle issue that led to AI-036.7.

### 2. AI-036.7-report.md

Corrective implementation and validation report for PostgreSQL connection lifecycle
reliability.

Scope included unsafe pooled connection disposal, rollback/commit uncertainty,
checked-out client errors, and query-timeout related transaction cleanup.

### 3. AI-036-regate-2-report.md

Independent adversarial re-gate after AI-036.7.

Final result:

AI-036 ADVERSARIAL SECURITY RE-GATE #2 — PASS

All original AI-036 blockers remained closed.

The PostgreSQL pooled-connection reuse invariant was also re-tested under the final
implementation.

## Final AI-036 status

AI-036.1 — Provider-start fencing — PASS
AI-036.2 — Ambiguous provider outcome — PASS
AI-036.3 — Model / budget correctness — PASS
AI-036.4 — Authorization-safe boundary — PASS
AI-036.5 — Tenant / DB integrity — PASS
AI-036.6 — One-snapshot Owner reads — PASS
AI-036.7 — PostgreSQL connection lifecycle — PASS

AI-036 security corrective sprint: CLOSED.

## Carry-forward

Hardening debt HD-1 through HD-17 is carried into AI-037 Technical Debt Census.

Priority review order:

1. HD-12 — duplicate paid provider execution after definitive post-dispatch CAS failure
2. HD-13 — ambiguous COMMIT / reconciliation race
3. HD-14 — pooled-session defensive release invariant
4. HD-15 — PostgreSQL TLS/configuration policy
5. HD-16 / HD-17 — observability and deployment compatibility
