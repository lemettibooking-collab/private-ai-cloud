# AI-036 Adversarial Security Re-Gate — Report

**Verdict: AI-036 ADVERSARIAL SECURITY RE-GATE — FAIL**

The gate fails on one new confirmed blocker family, a poisoned pooled connection (Attack O). Two findings share its root cause:

- **O / O6:** a pooled connection can be reused while its transaction is still open or aborted. The next unrelated request can then COMMIT a failed operation's partial writes, or receive a stale REPEATABLE READ snapshot as fact. This is reproduced with driver-boundary fault injection and also realistically, without injection, under client `query_timeout` plus lock contention.
- **O-CRASH:** when the database session of a checked-out client dies, the whole Node process crashes, because the error event has no listener.

All eleven original AI-036 findings re-tested as **closed**.

- Mode: read-only review and attack harnesses. No production source, test or migration was changed. Nothing was committed or pushed.
- Harnesses and raw JSON evidence: `/tmp/ai036-regate/` (outside the repository, removable).

---

## 1. Baseline

| Check | Result |
|---|---|
| Branch | `feature/development-agent-module` |
| HEAD | `a743ca2f502ce17f5f3cdc3904e0104271fd28b9` (`fix: make owner reads snapshot consistent`) |
| Worktree | clean |
| Divergence vs `origin/feature/development-agent-module` | `0 0` |
| AI-036 commits present | c2bdc68 (.1), 5f683ca (.2), 316da28 (.3C), 04a457e (.3D, includes the input-token preflight), 7f801d3 (.4), 75dd31a (.5), a743ca2 (.6) |
| Migrations | 0001–0007 present and unchanged |
| Live database | PostgreSQL 16.15 (Homebrew), temporary cluster on 127.0.0.1:55437. Fresh DB per harness with migrations 0001–0007 and the canonical seed. Two or more Workspaces for tenant cases. Stopped and deleted at the end. |
| Providers | No real OpenAI or provider calls. Real `createOpenAIModelProvider` with an injected fake SDK client; local-kind providers that follow the exact adapter contract. |

## 2. Architecture census (current code)

- **Provider dispatch path:** `WorkflowRuntimeService.advance` → `store.claim` → `executeAgentStep`. Inside it:
  - `ledger.reserve` (invocation row)
  - `executeModelInvocation.prepare`: `authorizePreflight` fence, then provider `preflight` (token count)
  - `authorizeGeneration`: `reserveBudget` (aggregate windows, FOR UPDATE), then `authorizeProviderStart` = `store.startExecution({providerStart})`, which locks the Run, claim, execution, invocation and budget rows and re-checks lease, revision, pause, Run status, pinned identity and budget, then sets the execution to `running` and COMMITs
  - `provider.run`
  - `recordOutcome` (settle, release or hold the budget)
  - CAS.
- **Durable authority rule:** remote deployments require durable authority (`requiresDurableRemoteAuthority`). The Postgres store always supplies all ledger methods.
- **Owner reads:** `AuthorizedWorkflowRuntimeAccess` (authorize first, then an explicit public projection) → `PostgresWorkflowRuntimeReadModel`. Multi-statement reads use `#withReadOnlySnapshot` (REPEATABLE READ READ ONLY).
- **Tenant:** `createPostgresWorkflowRuntimePersistence({database, domainWorkspaceId})` → the resolver produces a branded, frozen tenant → the store and read model accept only that branded object.
- **DB adapter:** `lib/db/postgres.ts` wraps `pg.Pool`. `release()` calls `client.release()` with no argument. `WorkflowRuntimeSqlClient.release(): void` cannot express "destroy".

## 3. Blocker matrix

### 3.1 Original findings: re-test

| ID | Original finding | Re-test | Result |
|---|---|---|---|
| AI033-P01 | aggregate budgets absent | E1, E2, E3 live | **PASS** |
| AI033-P02 | provider spend before request-time budget enforcement | E1–E4, A, F live | **PASS** |
| AI034-R1 | ambiguous completion → retryable failure | B runtime and adapter | **PASS** |
| AI034-R2 | stale executor / cancel-after-reservation reaches provider | A1–A5 live | **PASS** |
| AI034-R3 | Owner overview mixes snapshots | N live | **PASS** |
| AI035-A1 | denial discloses Run state | G live | **PASS** |
| AI035-A2 | domain workspace vs DB UUID mismatch | I live | **PASS** |
| AI035-A3 | no authorization-safe boundary | G and census | **PASS** (see HD-2) |
| AI035-D1 | cross-workspace relational substitution | J live | **PASS** |
| Audit collision | contradictory same key silently ignored | L live | **PASS** |
| ACK-loss | lost COMMIT ACK not exercised | F, driver-boundary simulation | **PASS** (not wire-level; see §9) |

### 3.2 New findings

| ID | Finding | Result |
|---|---|---|
| **O** | Pooled connection returned with an open or aborted transaction after ROLLBACK failure; the next borrower inherits the transaction, a stale snapshot, or COMMITs foreign partial writes | **CONFIRMED BLOCKER** |
| **O-CRASH** | Backend or socket death while a client is checked out raises an unhandled `'error'` event and the Node process exits | **CONFIRMED BLOCKER** (reliability; same root cause and corrective scope as O) |
| HD-1 … HD-11 | see §6 | HARDENING DEBT |

---

## 4. Attack O: poisoned pooled connection (new mandatory gate)

### Inspection

- **`lib/db/postgres.ts:60-62`:** `release(): void { client.release(); }`. No error or destroy argument exists, and the interface (`workflow-runtime-store.ts:42`, `workflow-runtime-tenant.ts:9`) has no way to request one.
- **`pg-pool@3.14.0` `_release`:** destroys a client only if `err || this.ending || !client._queryable || client._ending || maxUses`. **Transaction state is never checked.**
- **Write-side helper, `workflow-runtime-store.ts:391-420` (`rollback()` and `transaction()`):** a ROLLBACK error is swallowed ("original operation remains the only externally visible error"), and `client?.release()` returns the client to the pool as reusable.
- **Read-side helper, `workflow-runtime-read-model.ts` `#withReadOnlySnapshot`:** also swallows a ROLLBACK failure, and `#withClient` then calls `release()` normally.
- **Error listener:** pg-pool removes its idle `'error'` listener on acquire, and the adapter adds none while a client is checked out. `pg@8.23.0` `Client._handleErrorEvent` emits `'error'` → unhandled → process exit.

### Evidence

`attack-o.mts` and `attack-o6.mts` use the current adapter with `maxConnections: 1`, so the same physical client is reused deterministically.

| Case | Setup | Observed | Result |
|---|---|---|---|
| O1 | Normal rollback after `create()` fails post-INSERT | Same PID reused; `isolation=read committed`, `inherited_transaction=false`, no Run row | PASS |
| O2a | Backend terminated while the client is checked out and idle in transaction | **Process exits**: `Unhandled 'error' event … 57P01 terminating connection` | **O-CRASH** |
| O2b | Backend terminated during an active statement | The error reaches the statement, then the socket `'end'` raises an unhandled `'error'` ("Connection terminated unexpectedly"); captured only by the harness's `uncaughtException` recorder. The pool **did** destroy the dead client (new PID, clean session, no partial rows). | dead socket destroyed; still **O-CRASH** |
| O3-write | Driver-boundary injection: the data statement after the Run and Step INSERTs fails, then ROLLBACK rejects while the socket stays live | Caller gets `"Workflow runtime database operation failed."`. Next borrower: **same PID**, `inherited_transaction=true`, xid 862, `idle in transaction` holding RowExclusiveLock on `workflow_runs` and `workflow_step_runs`. The next unrelated request (`beginCommand` on another Run → `conflict`) **COMMITs**, after which Run=1 row, Step=1 row, **creation audit=0**, and `load()` returns the Run (revision 0). **A write reported as failed became durable without its audit.** | **BLOCKER** |
| O3-read | Driver-boundary injection: overview data statement fails, then snapshot ROLLBACK fails | Next borrower: `repeatable read`, `read_only=on`, inherited. After the writer committed revision 1 / `cancelled`, a raw single-statement read on that client returned **revision 0 / `queued`**, and `getRunOverview` returned **stale S1 as an `available` fact**. The session cleared only after that read's COMMIT. | **BLOCKER** (stale factual Owner read) |
| O5 | Real server-side error (duplicate Run) aborts the transaction, then ROLLBACK fails | Every later statement on the pooled client fails with `current transaction is aborted`; `listApprovalQueue` returns `read_failed` until some borrower issues ROLLBACK | availability impact, same root |
| **O6 (realistic, no injection)** | `DATABASE_URL …?query_timeout=400` (node-postgres client-side timeout; the adapter passes the URL through). Another session holds an uncommitted conflicting insert of `run-one` for 2 s. | `store.create()` INSERT waits on the lock → client-side timeout → ROLLBACK queued behind it → the ROLLBACK's own timeout splices it from the queue, so it **is never sent** → client released while the server-side INSERT is still waiting. After the lock holder rolls back, the orphan INSERT completes inside the open transaction; the client is `idle in transaction`. The next unrelated request COMMITs, leaving **Run row=1, step projections=0, creation audit=0**. `load()` then fails permanently with "Persisted Workflow runtime state is inconsistent". The caller was told the create failed. | **BLOCKER, realistically reachable** |
| O5 (session state) | Grep for session-local state in production | No `SET`, `SET LOCAL`, `LISTEN`, `PREPARE`, advisory locks or temp tables. The only state that bleeds over is **transaction state**: the open transaction, its snapshot, its row locks, uncommitted writes and aborted status. | — |

**Classification: CONFIRMED BLOCKER.** The gate's criterion is met: an unsafe or unknown transaction connection returns to the pool and a later request borrows it. Impact:
- partial writes from an operation reported as failed are committed by an unrelated request (integrity and audit completeness);
- a stale snapshot is returned as fact;
- the lock is held indefinitely by a pooled idle client.

Reachability ranges from low (a pure ROLLBACK failure on a live socket) to realistic (a client `query_timeout` configured together with any lock wait). This is not wire-level TCP loss.

**O-CRASH classification: CONFIRMED BLOCKER (reliability).** It is deterministic, triggered by ordinary infrastructure events (failover, restart, `pg_terminate_backend`, network reset) during any checked-out window, and takes down the whole multi-tenant process. The consequence is fail-stop, with no integrity loss observed.

---

## 5. Evidence by attack

### A. Provider-start fence (live, two independent actors)
Worker A pauses immediately before `startExecution({providerStart})`, after the invocation and budget reservations.

| Case | Interference | A's provider dispatches | Result |
|---|---|---|---|
| A4 | none (valid ownership) | **1** | completed |
| A1 | Worker B, whose clock is past A's lease, runs the real `claim()`: expires A's claim, retires A's prepared execution, claims and completes | **0** (B: 1) | A `recovery_required`; A's budget released |
| A2 | Owner `cancel` committed (Run `cancelled`, revision 2) | **0** | `recovery_required` |
| A3 | revision bump / `runtime_pause` / claim released / claim lease expired / execution attempt changed / execution re-owned / Run not running / budget released | **0 each** | execution `failed` or `prepared`; budget `released` |
| A5 | A already past the fence (dispatch in flight); B claims with an expired lease | A 1, **B 0** | B `execution_recovery_required`; execution marked `outcome_unknown`; A's CAS refused |

The fence checks the durable authority under `FOR UPDATE` inside the same transaction that marks the execution `running`. **PASS.**

### B. Ambiguous provider outcome
- **Runtime:** provider returns deny after dispatch (`lose`), or throws ECONNRESET (`throw`). Result: invocation `outcome_unknown`, budget `outcome_unknown`, window still holding reserved tokens (4100) and cost (1000). Replay of the same command, retry with the same execution and retry with a new execution all return `recovery_required`. **Total dispatches 1.**
- **Real OpenAI adapter:** connection reset, timeout after dispatch, 500, generic transport error, malformed body, wrong model version and usage over the reservation all give **no normalized result**, which the runtime maps to `outcome_unknown` (budget held). 429 and 400 give a definite `failed` with cost 0 (the documented not-processed contract; see HD-10).
- **PASS.**

### C. Provider identity pinning
- **C1:** the Run's registry alias changed mid-flight, yet the dispatch used the pinned `mock/model:v1`. Mutating the invocation's `provider_request_model_id` or version before the fence gives **0 dispatches**.
- **C2:** an unexpected response model gives `model_identity_mismatch`, so no result and `outcome_unknown`.
- **C3:** an invocation downgraded to legacy v1 with a null pinned identity is refused by the fence (which requires `provider_identity_version = 2`), with 0 dispatches. The legacy read path returns `null` with no fabrication (AI-036.3C unit tests and the N harness).
- **C4:** a caller draft that injects `providerRequestModelId` / `providerModelId` is rejected (route denied), with 0 dispatches and no invocation row. Generation requests with an extra identity field are rejected (`invalid_request`).
- **PASS.**

### D. Input-token preflight (real OpenAI adapter, fake SDK)
- **Binding:** count and create both use the pinned model. The create envelope equals the count envelope exactly, plus `store=false`, `stream=false`, `background=false` and `max_output_tokens` equal to the preflight's effective value, which is within the authorized limit.
- **Tampering:** changed input, changed instructions, changed alias, pinned model or version in the proof, inflated max output, understated input count, missing proof or an extra caller field all give `identity_mismatch` or `invalid_request`, with **0 create calls**.
- **Failure:** count throws, count returns a malformed or extra-field or over-authorized result: preflight is denied with 0 create calls. No heuristic fallback.
- **Runtime:** preflight authority fails, giving 0 dispatches.
- **PASS.**

### E. Pre-spend and aggregate budgets (live; windows keyed on workspace + project + workflow binding)

| Case | Setup | Durable result | Result |
|---|---|---|---|
| E1 daily tokens | limit 20 000; each reservation 12 000; two Runs | run-one dispatched, then settled consumed 8 005; run-two `budget_exceeded` → Run failed; **1 dispatch** | PASS |
| E2 monthly cost | limit 600 000 µ$; reservations 400 000; actual 350 000 | run-two denied; consumed 350 000; **1 dispatch** | PASS |
| E3 barrier concurrency | 6 Runs at once, limit 50 000, 12 000 each | in-flight reserved 48 000 (≤ 50 000); **exactly 4 dispatches**, 2 failed | PASS |
| E4 output cap | capability max output 3 000 | dispatched max output 3 000 = reservation `effective_max_output_tokens` | PASS |
| E5 exact replay | same command; store-level replays | command `idempotent`; ledger replay → `conflict` (safe; HD-7); windows unchanged | PASS |
| E6 changed identity, same key | changed fingerprint, model, amount or canonical fingerprint | all `conflict`; no second row | PASS |
| E7 actual < reserved | reserved 4 000 tok / 9 000 µ$; actual 1 020 / 1 040 | settled once; windows reserved 0, consumed 1 020 / 1 040 | PASS |
| E8 actual > reserved | provider over-uses | actual 1 510 > reserved 1 010 **recorded, not clamped**; consumed 1 510; response `recovery_required` (`invariant_violation`) | PASS |
| E9 outcome_unknown | see B | reservation held (`outcome_unknown`, window reserved) | PASS |
| E10 repeated terminal | outcome replay / contradictory outcome / release after settle | `idempotent` / `conflict` / `recovery_required`; windows unchanged | PASS |

### F. Lost COMMIT ACK (driver-boundary simulation)
Each case lets a real PostgreSQL COMMIT succeed, then rejects the caller with an injected ACK-loss error.

| COMMIT targeted | Dispatches | First response | Replay / retry | Final durable state | Result |
|---|---|---|---|---|---|
| claim (`insert-execution`) | 0 | denied | denied / conflict until lease expiry | claim active, no invocation | PASS (HD-6) |
| invocation reserve | 1 | completed (reconciled) | completed / completed | settled once, 105 tokens | PASS |
| budget reserve | 1 | completed (reconciled) | completed | settled once | PASS |
| provider-start fence | **0** | recovery_required | recovery_required | execution `running`, budget **released** (factually correct: no dispatch) | PASS (HD-6) |
| terminal accounting | 1 | completed (reconciled) | completed | settled once | PASS |
| final CAS | 1 | completed (reconciled) | completed | settled once | PASS |
| command completion | 1 | **denied** (`state_store_failed`) | completed | settled once | PASS (HD-5) |

No second dispatch, no second settlement or release, and no duplicate terminal mutation. **Not wire-level:** no TCP proxy or packet loss was used; that is optional per the task.

### G. Authorization opacity (live read model, real service)
- **Object operations** (overview, audit, usage, command `get`, command `cancel`):
  - authorized + existing → available;
  - unauthorized + existing → byte-identical to authorized + missing;
  - denied → **0 raw reads**.
- **Denied collection read:** the approval queue returns 0 raw reads.
- **Always denied** (identical deny object, 0 raw reads):
  - Authorizer variants: throws or rejects (with a sentinel), extra field, bare string, uppercase verdict, `true`, getter verdict.
  - Hostile contexts: getter, extra field, non-string, prototype-carried, `toJSON` trick, `null`.
- **Accepted:** a transparent Proxy context or Proxy authorizer result that carries allow-equivalent values. It is snapshotted once, and a flipping-proxy TOCTOU (owner first, intruder later) had no effect, since the value is read once through descriptors. See HD-9.
- **PASS**, with HD-2.

### H. Public projection
Hostile or future fields were injected into real DTOs: top-level and nested overview fields, invocation `reservationToken` and `messages`, usage, audit `metadata` and `internalTrace`, approval queue item, command response `debug`/`stack`, reason `path`/`message`, `waitingApproval`, `retryPending`, `lastStepResult.outputText`. None escaped, and neither `metadata` nor `message` appears. An unknown internal reason code (`sql_error_detail`) gives `unavailable` (fail closed). **PASS.**

### I. Workspace mapping
- **Resolves only exact, active or demo domains:** `workspace-primary` → A UUID; `tenant-b` → B UUID; `smart-algorithms-demo` → the canonical UUID.
- **Returns `null`:** suspended, archived, missing, case variant, name-like, empty, over-length, `../etc`, leading space, number, object with `toString`, `String` object, Proxy.
- **Duplicate domain insert:** rejected (`23505 workspaces_domain_workspace_id_unique`).
- **Hostile DB responses:** another tenant's row, two rows or a malformed UUID → `null`, with no first-row fallback. A DB error → `null`.
- **Persistence factory:** a caller-supplied `workspaceDatabaseId` → `null`; a getter domain → `null`; a DB error → `null`.
- **Branded tenant:** a forged or cloned tenant is refused by both the store and read-model constructors, and mutating the real branded tenant throws a `TypeError` because it is frozen.
- **PASS.**

### J. Cross-workspace DB substitution (live)
- **Rejected at DB level**, with SQLSTATE and constraint:
  - member A → role B, and role or member re-homed while assigned (`member_role_assignments_workspace_check`)
  - document A → collection B, on insert and update (`knowledge_documents_collection_workspace_fk`)
  - chunk A → document B; message A → thread B
  - step, command and claim A → Run B
  - execution A → Run B (`…executions_run_workspace_fk`); execution A → claim B (`…executions_claim_workspace_fk`)
  - invocation A → execution B (`…invocations_workspace_execution_fk`) and → Run B (`…workspace_run_fk`)
  - approval A → Run B (`approval_requests_run_workspace_fk`); decision A → approval B (`approval_decisions_request_fk`)
  - budget A → invocation B (`…budget_reservations_invocation_workspace_fk`)
  - audit A → Run B's `runtime_run_id` (`audit_events_runtime_run_workspace_fk`)
  - legacy Run approval pointer → approval B (`workflow_runs_approval_request_workspace_fk`)
  - attribution through a B-only member: Run `created_by`, approval `requested_by`, audit `actor_user`, collection `created_by`
  - Run A re-homed to B while it has children
  - a non-system global role (`roles_global_system_check`)
- **Every same-workspace control succeeded.** A global system role assignment succeeded (intended).
- Vectors that first hit an unrelated uniqueness constraint were re-run with isolated fixtures and then failed on the tenant FK.
- **PASS.**

### K. Historical attribution
Each field was tested with a dedicated member. Deleting the membership is `REJECTED 23503` by the corresponding `*_member_fk`, and the provenance rows stay intact, for: audit actor, Run creator, approval requester, approver, rejecter, collection creator, document uploader, thread creator and message creator. `assigned_to` clears to NULL (intended current-assignment semantics). Disabling a membership preserves all history. **PASS for membership deletion.** Deleting the **user row** is a separate path; see HD-1.

### L. Runtime audit integrity (live)
- **L1** platform audit with null workspace and null runtime fields: accepted.
- **L2** `runtime_run_id` with a null workspace: rejected (`audit_events_runtime_workspace_required`).
- **L3** same workspace: accepted.
- **L4** A workspace with a B Run: rejected (`audit_events_runtime_run_workspace_fk`).
- **L5** exact replay: `idempotent`, one row.
- **L6** changed event type, actor, Run or metadata: collision, rejected.
- **L7** through the real store: a contradictory audit row was planted under the reservation's event key. The advance was denied, with 0 dispatches and **no invocation or budget rows for the Run** (whole transaction rolled back).
- **L8** concurrent exact replay: the second session waited on the first, then returned `idempotent`, one row.
- **L9** concurrent contradictory: the second session waited, then was rejected as a collision; exactly one factual version was committed.
- L5–L9 ran the store's exact SQL text in two concurrent sessions; L7 used the real store.
- **PASS.**

### M. Canonical Workspace identity
- Re-running the seed is idempotent: exactly one canonical row.
- A seed run against same slug with a different UUID, same domain with a different UUID, the expected UUID with a contradictory slug, or the expected UUID with a contradictory domain fails every time with `Smart Algorithms demo Workspace identity is contradictory.`
- Migration 0007 applied over a pre-0007 impostor slug fails with `Existing Workspace has no factual domain Workspace mapping.`, so there is no rebinding.
- **PASS.**

### N. One-snapshot Owner reads (live, at HEAD a743ca2)
- **Overview:** the reader paused after its first SELECT and the writer committed S2 in 15 ms without being blocked. The first read was entirely S1 (revision 0, approval `aaaa`, invocation-a, 1 invocation, 15 tokens); a fresh read was entirely S2.
- **Usage:** S1 `{1,15,11}`, then S2 `{2,165,88}`.
- **Audit:** S1 `[event_a]`, then `[event_b, event_a]`. An existing empty Run gives `allow []`; a missing Run gives `not_found` (public `available []` versus `unavailable`).
- **Isolation**, measured in the reader's session: `transaction_isolation=repeatable read`, `transaction_read_only=on`, `backend_xmin` held. Locks: `AccessShareLock` only (no FOR UPDATE, advisory or table lock).
- **Approval queue:** exactly one statement, no transaction control.
- **Two workspaces:** no cross-tenant facts.
- **PASS.** Note that the snapshot helper is itself affected by Attack O when its ROLLBACK fails.

### P. Command-path mixed load
The reader paused between `load-run` and `load-steps` while the writer committed an Owner cancel (a CAS on both the Run and its Steps). `load()` threw "Persisted Workflow step projection is inconsistent", the service returned `state_store_failed`, and there were **0 dispatches**. A direct `load()` interleaved with a start transition gave the same fail-closed result. Even if a mixed read were accepted, `claim()` and the provider-start fence re-check revision, pause and status under `FOR UPDATE`, so a mixed read cannot reach the provider. **HARDENING DEBT (HD-4):** a spurious failure only.

### Q. Idempotency and replay matrix (live)

| Case | Result |
|---|---|
| same command + same payload | `idempotent` (start, advance, approve, reject) |
| same command ID + changed payload | `conflict` / `idempotency_conflict` (start, advance, approve, reject) |
| same invocation replay | no second reservation (command `idempotent`; ledger `conflict`, HD-7) |
| same invocation ID + changed fingerprint or identity | `conflict` |
| approval replay | `idempotent`, one decision row |
| contradictory approval (reject after approve, approve after reject, forged ID) | `approval_mismatch`, no change |
| exact risk resume after approval | 1 dispatch, completed; replay `idempotent` |
| concurrent execution reservation (two advances, same attempt) | 1 completed / 1 conflict; **1 dispatch** |
| stale revision | `stale_revision`, 0 claims |
| repeated terminal reconciliation | `idempotent`, windows unchanged |

**PASS.**

### R. Bounded input and resources
Limits: 600k properties, depth 64, arrays of 4 096, strings of 131 072 characters, 2 097 152 total string characters, 2 048 events, 128 agent inputs, 128 steps.

| Probe | Time | RSS Δ | Result |
|---|---|---|---|
| envelope at property limit | 706 ms | 122 MB | accepted |
| envelope with 6M properties | **5 559 ms** | **346 MB** | rejected (limited), HD-3 |
| depth 10k / 40k array / 64 MB string / 64×128 KB strings / cycle | ≤ 8 ms | ≤ 3 MB | rejected |
| public `executeCommand` (denied): 128 inputs; ~16 MB; 129 inputs; ~50 MB strings | 6 / 19 / 1.7 / 0.4 ms | ≤ 1 MB | unavailable |
| snapshot with 2 048 / 2 049 events | 2 / 1 ms | ~0 | deny |
| 128-step DAG with 32 dependencies per step: create / validate | 81 / 29 ms | ~1 MB | allow; 129 steps deny |
| advance iteration bound | 3 × 128 + 4 = 388 | — | bounded |

**HARDENING DEBT (HD-3).**

---

## 6. Hardening debt (not currently reachable as an unsafe action)

| ID | Item | Why not a blocker now | Recommendation |
|---|---|---|---|
| HD-1 | Deleting a **user** row NULLs provenance: Run creator, audit actor, approval requester and approver all went NULL (single-column `*_fkey ON DELETE SET NULL` from 0001; memberships cascade) | No user-deletion path exists in `lib/` or `app/`; the user lifecycle is `status='disabled'` | RESTRICT user FKs or forbid hard deletes |
| HD-2 | `AuthorizedWorkflowRuntimeAccess` is not tenant-bound. Composed with A's read model, a correctly authorized B owner read A's Run (`available`). | No production composition root exists (facade used only in tests; API forwards to it) | Bind the facade to the resolved tenant; reject a context workspace that differs from the tenant before the authorizer runs |
| HD-3 | Command normalization before authorization: a 6M-property envelope costs 5.5 s and 346 MB before rejection | No transport exists | Enforce a transport body-size limit; consider a cheap pre-check |
| HD-4 | `store.load()` reads Run and Steps without a snapshot; a concurrent CAS causes a spurious `state_store_failed` | Fails closed; fences re-validate | Wrap `load()` in the read-only snapshot helper (after O is fixed) |
| HD-5 | ACK loss on command completion returns `denied` to the first caller although the effect committed | Replay converges; no duplicate effect | Map commit ambiguity to `recovery_required` / unknown |
| HD-6 | ACK loss on claim or on the provider-start fence leaves the claim or execution stuck until lease expiry or manual recovery | No dispatch, no double accounting | Recovery tooling |
| HD-7 | Store-level exact ledger replay after terminal returns `conflict` instead of `replay` | No second reservation | Semantic clean-up |
| HD-8 | Local deployments may execute without the durable ledger if an injected store lacks ledger methods | Remote requires durable authority; the Postgres store always supplies the ledger | Document or enforce |
| HD-9 | Facade accepts transparent Proxy contexts and authorizer results; the runtime rejects proxies | Snapshotted once; no TOCTOU | Make the facade consistent with the runtime |
| HD-10 | OpenAI 429 and 400 are treated as definite `failed`, cost 0, 429 retryable | Documented not-processed contract | Confirm with provider semantics |
| HD-11 | Aggregate `budget_exceeded` fails the Run terminally | Safe | Product decision |

## 7. Bypass census

| Symbol | Production locations | Classification |
|---|---|---|
| `PostgresWorkflowRuntimeStateStore` / `PostgresWorkflowRuntimeReadModel` construction | `lib/db/workflow-runtime-persistence.ts` only | trusted persistence composition (resolver-owned tenant) |
| `createPostgresWorkflowRuntimePersistence` | definition only | no production caller yet |
| `workspaceDatabaseId` | store, read model, tenant resolver | only from the branded resolved tenant; no caller-supplied path (the factory rejects extra keys) |
| `createAuthorizedWorkflowRuntimeAccess` / `handleWorkflowRuntimeCommand` | definition and API (forwards to facade) | authorized boundary; no route, server action or `app/` import |
| `provider.run` | `lib/contracts/model-invocation-execution.ts:1509` only | after `authorizeGeneration` when authority is present; remote requires authority |
| OpenAI SDK (`new OpenAI`, `from "openai"`) | `lib/providers/openai-model-provider.ts` only | intended adapter layer |
| Budget methods | store and service ledger wiring only | behind the fence |
| `app/`, `components/` | none of the above | UI is mock-only; no transport bypass |
| Tests | construct raw store, read model and facade | test-only (trusted) |

## 8. Secret and error leakage
A sentinel containing a connection string, a password and SQL text was injected into:
- read-model methods and the service;
- the real read-model snapshot transaction (COMMIT and usage queries);
- the real store (`load-run`, budget window lock);
- the provider adapter (the throw propagates through the real service);
- the tenant resolver DB;
- the persistence factory `connect()`;
- the authorizer (throw and rejection).

**The sentinel appears in no public response, no raw read-model decision, no store error message (`"Workflow runtime database load failed."`), no internal service response and no persisted audit metadata.** **PASS.**

## 9. What was not performed
- **Wire-level TCP packet loss** and proxy injection (optional per the task). All ACK-loss evidence is a driver-boundary simulation (real COMMIT, then an injected error).
- Real OpenAI or network calls (forbidden). The real adapter was exercised through an injected fake SDK client.

## 10. Full regression
Run at the start and again at the end, on HEAD `a743ca2`:
- `npm run lint`: 0
- `npm run typecheck`: 0
- `npm test`: **1619 tests, 1619 pass, 0 fail**, 0 cancelled, 0 skipped
- `npm run build`: 0
- `git diff --check`: clean

## 11. Final cleanliness
- `git status --short --branch`: `## feature/development-agent-module...origin/feature/development-agent-module`, clean.
- Divergence `0 0`; HEAD `a743ca2f502ce17f5f3cdc3904e0104271fd28b9`.
- No repository file changed. Scratch harnesses stay in `/tmp/ai036-regate/`.
- Temporary PostgreSQL clusters (the re-gate cluster on :55437 and the AI-036.6 scratch cluster) were **stopped and deleted**.

---

## 12. Smallest corrective recommendation (do not implement in this task)

**AI-036.7: connection-safety corrective.**

1. Extend `WorkflowRuntimeSqlClient.release` to accept a destroy signal (for example `release(destroy?: boolean)`). In `lib/db/postgres.ts`, map it to `client.release(err)` so pg-pool destroys the physical connection.
2. In the store `transaction()` and the read-model `#withReadOnlySnapshot`, whenever ROLLBACK fails, COMMIT is ambiguous, or the session state is otherwise unknown, **destroy** the client instead of returning it to the pool. The public error semantics stay unchanged.
3. In `postgres.ts` `connect()`, attach a per-checkout `'error'` listener that marks the client broken and forces destroy on release. This removes O-CRASH.
4. Treat node-postgres client-side `query_timeout` as session-unknown (destroy), or reject it in adapter config in favor of a server-side `statement_timeout`.
5. Add regression coverage:
   - unit tests with a fake client for destroy on rollback failure, commit ambiguity and client `'error'`;
   - a live PG harness equivalent to O1, O2a, O2b, O3-write, O3-read, O5 and O6 (next borrower gets a fresh PID with `inherited_transaction=false`; no process exit; no orphan commit).

Out of scope for AI-036.7, backlog for AI-037: HD-1 … HD-11.

**Ready to proceed to AI-037 Technical Debt Census: NO**, not until AI-036.7 closes O and O-CRASH and this gate is re-run.

**AI-036 ADVERSARIAL SECURITY RE-GATE — FAIL**
