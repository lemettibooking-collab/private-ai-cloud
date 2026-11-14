# AI-036 Adversarial Security Re-Gate #2 (after AI-036.7) — Report

**Summary.**
- **O / O6 / O-CRASH are closed**, re-verified with an independent harness. No blocker was found in the new attack surface (C–H).
- **All eleven original findings still hold**, with results identical to the previous gate. The only differences are race winners in E3 and timestamps.
- **The reuse invariant held with zero violations.** It was checked mechanically on pg-pool's release path: 16 353 pooled reuses and 1 492 destroys across every harness in this gate.
- **Six new hardening-debt items**, none reachable as an unsafe action today:
  - HD-12, a pre-existing step re-execution after a lost CAS;
  - HD-13, an in-flight-COMMIT reconciliation race;
  - HD-14, a classifier that ignores severity;
  - HD-15, the connection-string denylist;
  - HD-16, silent pool errors;
  - HD-17, deployment compatibility.

Mode: a read-only review with attack harnesses. No production code, test or migration was changed, and nothing was committed or pushed. Harnesses and evidence are in `/tmp/ai036-regate2/`, outside the repository.

---

## 1. Baseline

| Item | Value |
|---|---|
| Branch | `feature/development-agent-module` |
| HEAD | `0e7cda9be3da97b7f5a9b1fe1913515c6f612166` ("fix: destroy unsafe pooled connections"), parent `a743ca2`, as required |
| Worktree at start | clean |
| Divergence at start | `main...HEAD` = 0 / 39 |
| Inputs read | `/tmp/AI-036-adversarial-regate-report.md`, `/tmp/AI-036.7-report.md`, `git show 0e7cda9` (8 files: 4 `lib/db/*`, 4 tests) |
| Not used | `/tmp/ai0367-live/` (the fix author's harness). All O-family harnesses were written fresh. |
| Consulted and reused | Builders and A–R harnesses from `/tmp/ai036-regate/` (previous gate), with the port rewritten to 55440 |
| Database | PostgreSQL 16.15, throwaway cluster `127.0.0.1` / `::1` / Unix socket :55440, TLS enabled for C. Fresh DB per harness, migrations 0001–0007 plus the canonical seed. |
| Driver | `pg` 8.23.0, `pg-types` 2.2.0, a single `pg-protocol` copy in `node_modules`, Node v24.13.1 |
| Providers | No network. Real OpenAI adapter with a fake SDK (BCD harness); local mock provider for runtime flows. |

**Opening regression (HEAD 0e7cda9):**
- lint 0;
- typecheck 0;
- `npm test` **1633 / 1633** pass (0 fail, 0 cancelled, 0 skipped);
- build 0;
- `git diff --check` clean.

**Invariant monitor used throughout.** A hook on `pg-pool` `_release` records the driver's own `_txStatus`, the status from the last ReadyForQuery the server sent. Any client returned for **reuse** whose status is not `I`, or that has an active or queued query, is a violation. The same monitor was preloaded (`node --import`) into every A–R regression harness. It also recorded idle-in-transaction gaps and transaction durations.

## 2. O-family closure (independent harness `o-case.mts`, one process per case, real adapter, `maxConnections: 1`)

Every case recorded: backend PIDs, `inherited_transaction` (`now() <> statement_timestamp()`), isolation and read-only state, the old backend's `pg_stat_activity` and `pg_locks`, row counts, uncaught exceptions (`uncaughtExceptionMonitor`, which does not suppress crashes) and the process exit code.

| Case | Before (re-gate #1) | After (this gate) | Evidence |
|---|---|---|---|
| O1: real server error (22012) after the Run INSERT, ROLLBACK succeeds | same PID, clean | **same PID 19852 reused**, `inherited=false`, read committed, RW. Old backend `idle`, no xid, **0 locks**. Run/Step/audit 0/0/0. | `o-O1.json` |
| O2a: backend terminated while `idle in transaction` | **process exit** | exit **0**, 0 uncaught. PID 19856 → **19857** clean; old backend gone, 0 locks; 0/0/0 | `o-O2a.json` |
| O2b: backend terminated during an active statement | unhandled `'error'` | exit **0**, 0 uncaught. 19862 → **19863**; old backend gone; 0/0/0 | `o-O2b.json` |
| O3-write, plain driver error (ECONNRESET, carrying a secret sentinel) | same PID, inherited tx, orphan committed | 19866 → **19867** clean. The ROLLBACK **never reached the driver** (fail-fast, socket untouched). Old backend gone **immediately**, 0 locks. After an unrelated committing request: **0/0/0**; `load()` = null; **no sentinel in the error** | `o-O3w-plain.json` |
| O3-write, server-shaped `DatabaseError` XX000 on the data statement **and** the ROLLBACK (caller rule only) | — | ROLLBACK reached the driver (1) and was rejected, so the caller destroyed. 19870 → **19871**; old backend gone, 0 locks; after an unrelated commit **0/0/0**; no sentinel | `o-O3w-db.json` |
| O3-read: snapshot data read fails, then snapshot ROLLBACK rejects | stale S1 returned as `available` | `read_failed`. 19876 → **19877**, read committed, **not read-only**. After the writer committed rev 1 / `running`: raw read **rev 1 / running**; `getRunOverview` **allow, rev 1 / running** | `o-O3r.json` |
| O5: real 23505 aborts the transaction, then ROLLBACK rejects | `current transaction is aborted` persisted | 19880 → **19881** clean; `listApprovalQueue` **allow**; overview **allow** | `o-O5.json` |
| O6: `?query_timeout=400` | orphan Run committed | **REJECTED** at construction (`PostgreSQL configuration is invalid.`) | `o-O6-query_timeout.json` |
| O6: same lock scenario with `?statement_timeout=400` | — | create fails at 459 ms (57014); **0** idle-in-tx sessions (excluding the holder); **0** waiting on a lock; same PID reused clean. After the holder rolls back and an unrelated commit: **Run=0, steps=0, audit=0** | `o-O6-statement_timeout.json` |
| O6: same scenario with `?lock_timeout=400` (extra) | — | fails at 455 ms (55P03), same result, **0/0/0** | `o-O6-lock_timeout.json` |
| O-CRASH | process exit | **0 uncaught, 0 unhandled rejections, exit 0 in all 10 case processes.** Live sessions show `idle_in_transaction_session_timeout=30s` and `client_connection_check_interval=5s`. | all `o-*.json` |

**O, O6 and O-CRASH: CLOSED.**

## 3. New attack surface (C–H)

### C. Connection-string, configuration and environment bypasses (`c-vectors.mts`, `c-env-child.mts`, `c-tls.mts`)

For each vector the harness recorded the adapter's decision and what node-postgres **actually derives** for a pool built by the adapter (`ConnectionParameters` plus `getStartupConf()`). Accepted strings were also run live.

| Vector | Result | Classification |
|---|---|---|
| `query_timeout`: plain, `query%5Ftimeout`, fully percent-encoded, `QUERY_TIMEOUT`, `Query_Timeout`, empty value, no `=`, duplicate after a benign key, duplicated twice, tab or newline inside the name (URL-stripped), with a space or bad-% sequence that triggers pg-connection-string's `encodeURI` rewrite, `postgresql:` scheme, `POSTGRES:` uppercase scheme, leading space | all **rejected** | rejected |
| `query_timeout` in the fragment (`#query_timeout=`, `#?query_timeout=`), userinfo, password, `a;query_timeout=` value, `%26`-encoded `&`, `%3F` in the path, `%00` suffix on the name | accepted; the derived `query_timeout` is **false** in every case | accepted-and-safe |
| `options` (plain and `%6Fptions`), `idle_in_transaction_session_timeout`, `client_connection_check_interval` | **rejected** | rejected |
| `socket:` form, keyword/value (`host=… query_timeout=…`), bare socket path | **rejected** | rejected (fail-closed; documented in AI-036.7) |
| **Differential fuzz**: 200 000 generated query strings (encodings, separators, tabs, `%25` chains, `encodeURI` triggers); a bypass means the adapter accepts but `pg-connection-string` derives `query_timeout`, `options` or either adapter-owned key | 196 844 accepted, **0 bypasses** | — |
| `statement_timeout`, `lock_timeout` | accepted; live `st=400ms` / `lt=400ms`; backstops intact | accepted-and-safe (server-side) |
| `application_name`, `__proto__`/`constructor`, `host=/socket`, `%2F`-encoded socket host, `postgresql://` | accepted; live OK; backstops intact | accepted-and-safe |
| `binary=true`, `client_encoding=latin1` / `SQL_ASCII`, `keepAlive`, `keepalives`, `connectionTimeoutMillis` | accepted but **ignored** by pure-JS pg: `Client.binary` reads the raw pool config, the protocol parser hard-codes UTF-8, and keepAlive and connect timeout come from the pool config. Live UTF-8 (`é Ж 🙂`), int8, bool and jsonb round-trips are identical. | accepted-and-safe (dead parameters; HD-15) |
| `replication=database` / `PGREPLICATION=database` | accepted; the session becomes a walsender, and every parameterised query fails with `extended query protocol not supported`, sanitised; 0 uncaught | accepted, **fails closed**; total outage (HD-15) |
| `sslmode=no-verify`, `uselibpqcompat=true&sslmode=require` | accepted; live **TLS without certificate verification** | accepted, **weakens TLS** (operator configuration; HD-15) |
| `sslmode=disable`, `ssl=0` | accepted; plaintext | accepted, weakens TLS (HD-15) |
| Legitimate production forms | `verify-full` + `sslrootcert` against `localhost` **connects over TLS**; wrong CA and hostname mismatch are **refused**; `require` + `sslrootcert` works; host+port works; Unix socket (`?host=` and `%2F` host) works; a password with `@ : / #` percent-encoded works | legitimate URLs keep working |
| IPv6 literal `postgres://…@[::1]:port/db` | accepted by the adapter, but the connection fails (ENOTFOUND). **Plain `pg` fails identically**, a pg-connection-string limitation. `?host=::1` works. | compatibility note, not caused by the fix |
| **Environment**, with `DATABASE_URL` clean: `PGOPTIONS='-c idle_in_transaction_session_timeout=0 -c client_connection_check_interval=0 -c statement_timeout=1'`, `PGQUERY_TIMEOUT`, `PGSTATEMENT_TIMEOUT`, `PGIDLE_IN_TRANSACTION_SESSION_TIMEOUT`, `PGBINARY`, `PGCLIENT_ENCODING`, `PGCONNECT_TIMEOUT`, `PGTZ`/`PGDATESTYLE`, `PGHOST`/`PGPORT` | live sessions stay at **iitst=30s, ccci=5s, st=0**; `pg_sleep(0.3)` completes (no client timeout); create and overview work | accepted-and-safe. `options` is set by the adapter, so `PGOPTIONS` is never consulted; `query_timeout`, `statement_timeout` and the idle timeout have no env mapping in pg 8.23. |
| `PGSSLMODE=no-verify` / `disable` | honoured (TLS weakened or disabled) | environment-level TLS downgrade (HD-15) |
| `PGAPPNAME` | honoured | safe |
| `NODE_PG_FORCE_NATIVE=1` | module load fails at import (`pg-native` absent); fail-stop at startup, not at runtime | note |

**No vector yields a client-side `query_timeout` or overrides the adapter-owned session options, so O6 cannot be reproduced through configuration.**

### D. Error-classification bypasses (`d-errors.mts`, real callers, real server errors where PostgreSQL can produce them)

**Classifier table.**
- Non-breaking (the caller decides): `DatabaseError` with 23505, 25P02, 40001, 40P01 and 57014, and **FATAL-severity** 25P03, XX000 and 53200.
- Breaking (destroy):
  - 57P01, 57P05, 08006 and 08P01;
  - a lowercase `57p01`;
  - an undefined, numeric or empty code;
  - a **foreign `pg-protocol` copy** (duplicated dependency);
  - a plain object `{code, severity}`;
  - an `Error` with a string code;
  - `null` or a string.

`Object.create(DatabaseError.prototype)` counts as non-breaking. It is forgeable only by in-process code and is not reachable.

| Live case (store `create` or read-model snapshot) | Outcome | Next borrower |
|---|---|---|
| 25P02: a real 22012 swallowed by the injection, so the next statement gets a real 25P02 | fails; ROLLBACK acked | same PID, clean (reuse after ROLLBACK) |
| **25P03 real idle-in-transaction FATAL** (`SET LOCAL` 150 ms, idle 600 ms) | fails; `'error'` absorbed, adapter marked broken | **new PID**, clean; 0/0/0 |
| 40001, 40P01, 57014, XX000, 23505 raised by the server inside the transaction | fails; ROLLBACK acked | same PID, clean; 0/0/0 |
| 57014 from real `statement_timeout`, and from real `pg_cancel_backend` | fails at 219 / 221 ms | same PID, clean; 0/0/0 |
| Server-shaped FATAL XX000, socket live | ROLLBACK **really executes** (acked) | same PID, `I` state; safe |
| Server-shaped FATAL XX000 plus the backend really exits (what a real FATAL does) | ROLLBACK fails | **new PID** |
| Foreign `pg-protocol` `DatabaseError`; plain object; **synchronous throw from `query()`**; synchronous throw on ROLLBACK | adapter marks broken, destroy | **new PID**; 0/0/0 |
| Snapshot: 57014 or 40001 during a data read | `read_failed`; ROLLBACK acked, then "recovered" | same PID, read committed, **not read-only** |
| Snapshot: COMMIT rejects (40001); BEGIN rejects (53300) | `read_failed`, destroy | new PID |

Monitor: 72 reuses, 8 destroys, **0 violations**; 0 uncaught. **When a transaction is still open after any error, it is either destroyed or cleanly rolled back (with an acknowledgement from a live server) before reuse.** The FATAL-severity gap is hardening debt (HD-14).

### E. Lifecycle races (`e-lifecycle.mts`, real adapter plus real pg-pool)

| Race | Result |
|---|---|
| `release(true)` racing a pending `pool.connect()` waiter (max 1) | Waiter got a **new backend and a new client object**; the old backend was gone. Same result when broken by a driver error. Normal release hands the same client over, as expected. |
| Backend dies between the last query and `release()` (no destroy flag) | the adapter knew it was broken, so the next borrower gets a fresh PID |
| Backend kill and `release()` in the same tick | fresh PID; no unhandled event. Listener hand-over (adapter removes its listeners, pool attaches its idle listener) is synchronous, so there is no gap. |
| Reused idle client whose backend dies (adapter listeners already removed) | the pool idle listener absorbs the event and removes the client; fresh PID next |
| Synthetic `'error'` while checked out | later queries **fail fast** (`PostgreSQL query failed.`); next borrower fresh |
| Synthetic `'error'`/`'end'` on an idle reused client, and after destroy | absorbed; next borrower fresh; 0 uncaught |
| Triple `release()` (plain, destroy, plain) | pool saw **exactly 1** release; later query fails fast |
| Query after a broken release | fails fast; **0 bytes** sent for that backend after the break |
| `release()` after `pool.end()` started | no throw; `close()` resolved |
| 1 000 mixed reuse, destroy and driver-error cycles (max 2) | `'error'`/`'end'` listeners while checked out: **max 1 / 1**. After release: 1 / 0 on reused clients and 2 / 1 on destroyed ones, **flat over all 1 000 cycles**. No `MaxListenersExceededWarning`; 0 backends left. |

Monitor: 583 reuses, 435 destroys, **0 violations**; 0 uncaught.

### F. Server backstops (`fg-backstops.mts`, `f-static.mjs`, preloaded monitor)

- **Live settings.** Every adapter session in every harness shows `idle_in_transaction_session_timeout=30s` and `client_connection_check_interval=5s`.
- **No transaction waits on JS work.**
  - Static review: 15 `transaction(` callbacks in the store. Every `await` in them is `client.query` or `this.#appendAuditEvent(client, …)`, which itself awaits only `client.query`.
  - The read-model snapshot helper and the tenant resolver hold no transaction across other work.
  - No provider call, timer or network await sits inside a transaction.
- **Dynamic check across the full A–R suite (production paths).**
  - The longest idle-in-transaction gap was **28 ms**; that one was a deliberate writer interleave in the N harness. The next longest was 304 ms, from the harness's own concurrent-audit session in L8/L9.
  - **No gap reached 1 s.**
  - The longest store transaction took 50 ms.
  - **No legitimate path comes close to 30 s.**
- **Real 30 s idle kill.**
  - The store's session was held `idle in transaction` with a pending Run INSERT. The server killed it at **30 067 ms**.
  - The caller got the sanitised failure. The next borrower got a **new PID** with no inherited transaction.
  - Run/Step/audit **0/0/0**; 0 uncaught.
- **Lingering lock waiters.**
  - A backend blocked on a table lock for a destroyed client exited **4 757 ms** after the destroy.
  - Control: a plain session without `client_connection_check_interval` was still present after **15 s**, until the lock was released.
  - No row was committed by either session.

### F2. Ambiguous-COMMIT reconciliation after destroy, with the COMMIT still in flight (`f2-ambiguous*.mts`)

**Injection.** A deferred constraint trigger with `pg_sleep` runs inside COMMIT. The driver hook sends the real COMMIT, then reports a lost ACK after 100 ms. At the moment of reconciliation, the old backend was verified in **every** case as `active / PgSleep / commit`. Two variants were run: a 2 s delay, where the COMMIT lands after reconciliation, and an 8 s delay, where `client_connection_check_interval` aborts it. Each ran on HEAD, and on pre-fix `a743ca2` for comparison.

| Path | Reconciliation answer on HEAD (2 s and 8 s) | First response | Dispatches | Final state |
|---|---|---|---|---|
| invocation reserve | `recovery_required` | recovery_required | 1 in total (the retry's new invocation) | 2 s: the orphan invocation-one commits later as `running`, never dispatched. 8 s: never committed. |
| budget reserve | `recovery_required` | recovery_required | 1 in total | 2 s: the orphan reservation commits later as `reserved`, with **4 100 tokens / 500 µ$ held** (conservative leak) |
| budget release | `recovery_required` (never `released` on a pre-commit read) | recovery_required | 0 | 2 s: `released` after landing. 8 s: `reserved`, held. |
| outcome record | `recovery_required` | recovery_required | 1 | 2 s: settled once (105). 8 s: invocation `running`, budget held; replay and retry `recovery_required` |
| CAS | the store **throws** "Workflow CAS commit was not observed." | **denied / state_store_failed** | 2 s: **1**. 8 s: 2 (see HD-12) | 2 s: the CAS commits (rev 3), execution `completed`, retry `completed` with no dispatch. 8 s: the CAS was really aborted and the execution marked `failed`. |

**Result.** No reconciliation read produced `conflict`, `released`, a spurious success or a second settlement from a pre-commit read.
- **Ledger paths:** always `recovery_required`.
- **CAS path:** gives a fail-closed `state_store_failed`. The effect can land afterwards; follow-up `FOR UPDATE` writes queue behind the in-flight COMMIT, so state converges and no extra dispatch occurs.

This is the previously recorded HD-5 class ("failure reported though the effect committed") and is carried as **HD-13**.

**Comparison with pre-fix `a743ca2`.** It answered `reserved`, `released`, `recorded` or `committed` in this scenario only because the ROLLBACK queued behind the in-flight COMMIT on a live socket and waited for it. That is the same mechanism behind O6. It is not a guarantee: with a truly dead socket it does not hold. It should not be restored.

The 8 s CAS double dispatch is **not** caused by reconciliation. `cas-lost.mts` reproduces it **byte-identically on HEAD and on `a743ca2`** with a *definitive* server error (40001) on the post-dispatch CAS and no connection fault at all (HD-12).

Monitor on HEAD: 279 reuses, 14 destroys, **0 violations**; 0 uncaught.

### G. Availability under destroy storms (`fg-backstops.mts`, `g2b-restart.mts`)

| Test | Result |
|---|---|
| 1 000 failing single-statement reads (driver ECONNRESET), concurrency 20, pool 5 | 1 000 failures, **1 000 destroys** in 1.38 s. p50 6 ms, p99 681 ms, max 1 017 ms (< 5 000 ms connect timeout). **0 backends leaked.** The next read succeeded in 10 ms. |
| PostgreSQL `restart -m fast` under 10 concurrent loops (async) | restart window 228 ms: 199 of 245 in-window operations **failed closed** with sanitised errors. Max operation latency **48 ms** (no wedge). **First success 2 ms after the restart**, then 5 288 operations with 0 failures. Backends after = 5 (pool max, no leak). 0 uncaught. |
| Server stopped | load fails in 7 ms, the approval queue denies `read_failed` in 2 ms (no hang); after start, a load succeeds in 26 ms |

Monitor (F+G): 14 025 reuses, 1 014 destroys, **0 violations**.

### H. Deployment compatibility (report only; none reachable today, since no production composition root or deployment exists)

- **PostgreSQL ≤ 13.**
  - An unknown startup GUC in `options` fails at connect with `FATAL 42704`; this was emulated on PG16.
  - Every connection would therefore fail: fail-closed, total outage.
  - This is hardening debt (HD-17).
- **PgBouncer.**
  - Not installed locally, so not tested.
  - PgBouncer generally refuses startup parameters it does not track, including `options`, unless they are listed in `ignore_startup_parameters`. If they are listed, the backstops are **silently dropped**. In transaction pooling, per-session GUCs cannot be relied on anyway.
  - This is hardening debt (HD-17).
- **Denylist pass-through.** See C and HD-15. Parameters that pass through today:
  - `sslmode=no-verify`, `uselibpqcompat=true`, `ssl=0`, `sslmode=disable` (TLS);
  - `replication` (outage);
  - `sslrootcert`, `sslcert` and `sslkey` (file reads at parse);
  - `binary`, `client_encoding`, `keepAlive`, `keepalives` and `connectionTimeoutMillis`, which are currently ignored. None of these change result decoding in pg 8.23.
- **`pool.on("error", () => {})`.** Idle-client errors vanish without any signal (HD-16).

## 4. Regression matrix: the eleven original findings (previous gate's harnesses re-run twice, plain and monitored)

A JSON diff against `/tmp/ai036-regate/*.json` gave **0 differing leaf paths** for A, C/D-runtime, Q2, BCD, J/K/L/M (db, db2) and R. RT differs only in E3 race winners. GHI differs only in timestamps. N printed "LIVE PROOF: ALL ASSERTIONS PASSED".

| ID | Finding | Evidence this gate | Result |
|---|---|---|---|
| AI033-P01 | aggregate budgets | E1 1 dispatch, run-two denied; E2 1 dispatch; **E3 4 dispatches, in-flight 48 000 ≤ 50 000**, consumed 32 020 | **PASS** (identical) |
| AI033-P02 | spend before budget | E1–E4 (E4 max output 3 000 = reservation), A, F | **PASS** |
| AI034-R1 | ambiguous completion | B `lose` / `throw`: 1 dispatch, `outcome_unknown`, 3 retries `recovery_required`; real adapter matrix unchanged | **PASS** |
| AI034-R2 | stale executor | A4 1 dispatch; A1, A2 and all eight A3 cases **0** dispatches with the budget released; A5 A=1, B=0 | **PASS** |
| AI034-R3 | mixed Owner snapshots | N: S1 and S2 cleanly separated, repeatable read / read-only, AccessShareLock only | **PASS** |
| AI035-A1 | denial discloses state | G: denied equals missing byte for byte, 0 raw reads | **PASS** |
| AI035-A2 | workspace mapping | I: resolves exact and active only; hostile rows give `null`; forged, cloned or mutated tenants refused | **PASS** |
| AI035-A3 | auth boundary | G plus census unchanged (HD-2 unchanged) | **PASS** |
| AI035-D1 | cross-workspace substitution | J: every vector rejected by the tenant FK; controls succeed | **PASS** |
| Audit collision | L1–L9 | identical (L7: 0 invocations and 0 budgets for the Run) | **PASS** |
| ACK loss | F, all 7 points | claim denied / 0 dispatches; invocation, budget, terminal and CAS completed and settled once (105); fence `recovery_required` / 0 dispatches; command completion `denied`, then replay `completed` | **PASS** (identical) |
| C1–C4, D | identity pinning, token preflight | C1 pinned `mock/model:v1`; mutations before the fence give 0; C3 legacy gives 0; C4 injected fields give 0; BCD identical | **PASS** |
| H | public projection | no poison, `metadata` or `message` escapes; unknown reason gives `unavailable` | **PASS** |
| K | historical attribution | membership deletes give `REJECTED 23503` for every provenance field | **PASS** |
| M | canonical Workspace | seed idempotent; contradictions fail; the 0007 impostor fails | **PASS** |
| P | command-path mixed load | fail-closed `state_store_failed`, 0 dispatches (HD-4) | **PASS** |
| Q | idempotency matrix | identical, including concurrent 1 completed / 1 conflict, **1 dispatch** | **PASS** |
| R | bounded input | identical limits; the 6M-property probe is still rejected (HD-3) | **PASS** |
| §8 sentinel leakage | secret, URL and SQL sentinel | `anySentinel: false`; O3-write errors carry no sentinel; configuration errors never echo the URL; driver warnings contain no URL or credential | **PASS** |

Monitored re-run: 1 115 reuses, 7 destroys, **0 violations**, 0 uncaught across A–R. The legacy `attack-o6.mts` now exits 1 because construction throws `PostgreSQL configuration is invalid.` (the intended rejection).

**No regression.**

## 5. Hardening debt

### New in this gate

| ID | Item | Why it is not a blocker | Recommendation |
|---|---|---|---|
| **HD-12** | When the post-dispatch CAS fails **definitively**, the service marks the execution `failed` although its invocation is settled `succeeded`. The owner's next command re-executes the step: a second dispatch, fully budget-checked and accounted (210 tokens settled for two invocations), and the first output is discarded. | **Pre-existing:** byte-identical on `a743ca2`, independent of connection handling. Each dispatch passed the fence and the budget; no hidden spend; reachable only after a failed CAS. | When a settled `succeeded` invocation exists for the step, mark the execution `outcome_unknown` / `recovery_required` instead of `failed`, or apply the recorded result instead of re-dispatching |
| **HD-13** | An ambiguous COMMIT is reconciled on a fresh session **while the destroyed backend's COMMIT can still be in flight** (up to about `client_connection_check_interval`). CAS reconciliation throws "not observed", giving `state_store_failed` even when the COMMIT lands later (HD-5 class). Ledger reserves answer `recovery_required` and can then commit orphan `running` invocations or `reserved` budgets that hold capacity (HD-6 class). | Never a wrong definitive answer (no `conflict` or `released` and no double settlement from a pre-commit read). Follow-up `FOR UPDATE` writes serialise behind the in-flight COMMIT, so state converges. Fail-closed. | Add a reconciliation barrier: record the destroyed backend PID and wait, bounded (about 10 s), until it leaves `pg_stat_activity`, or use lock-taking probes that queue behind the in-flight transaction. Map CAS "not observed" to `recovery_required`. Add recovery tooling for orphan reservations. |
| **HD-14** | `isWorkflowRuntimeSessionBreakingError` ignores `severity`: FATAL/PANIC with a non-57P/08 code (for example 25P03, XX000, 53200) counts as non-breaking. Reuse also rests entirely on caller discipline. | A real FATAL is followed by socket close, so the ROLLBACK fails and the session is destroyed (D evidence). With a live socket the ROLLBACK really executes. 0 violations in 16 353 reuses. | Treat `severity` FATAL/PANIC as breaking. **Defence in depth:** at `release()`, destroy whenever `client.getTransactionStatus() !== "I"` (pg 8.23 tracks ReadyForQuery), independent of caller rules and future call sites. |
| **HD-15** | The connection-string check is a **denylist**. Accepted today: `sslmode=no-verify`, `uselibpqcompat=true&sslmode=require` (TLS without verification), `sslmode=disable` / `ssl=0` (plaintext), `replication=database` (walsender, total outage), `sslrootcert` / `sslcert` / `sslkey` (files read at parse), dead parameters (`binary`, `client_encoding`, `keepAlive`, `keepalives`, `connectionTimeoutMillis`). `PGSSLMODE=no-verify` silently weakens TLS from the environment. | Operator configuration, not attacker-controlled; does not reproduce O6; none changes result decoding in pg 8.23 | Switch to an **allowlist** (for example `sslmode ∈ {verify-full}` or `verify-ca` with `sslrootcert`, `sslrootcert`, `application_name`, `statement_timeout`, `lock_timeout`, socket `host`/`port`). Set `ssl` explicitly in the adapter so `PGSSLMODE` cannot downgrade it. Reject everything else. |
| **HD-16** | `pool.on("error", () => {})` hides idle-client failures, and destroys are also silent | No leakage (deliberately logs nothing) | Add sanitised counters or metrics (idle errors, destroys by reason class), with no message text |
| **HD-17** | Startup `options` require direct PostgreSQL ≥ 14: PG ≤ 13 gives `FATAL 42704` on every connect. Behind PgBouncer the parameter is refused, or silently ignored via `ignore_startup_parameters`, which drops the backstops. IPv6 literal URLs fail in pg-connection-string; `?host=::1` works. | No deployment exists; fails closed on PG ≤ 13 | Document PG ≥ 14 and direct connections. For poolers, set the timeouts per role or database (`ALTER ROLE … SET …`) and assert them at startup with `SHOW`, failing closed. Document IPv6 via `?host=`. |

### Carried HD-1 … HD-11 (status re-confirmed from the regression outputs, not re-tested in depth)

| ID | Status |
|---|---|
| HD-1 (user delete NULLs provenance) | open, unchanged (J/K identical) |
| HD-2 (facade not tenant-bound) | open. G mis-composition still shows `exposesTenantAData: true`. |
| HD-3 (6M-property normalisation cost) | open (R identical) |
| HD-4 (`load()` without a snapshot) | open. AI-036.7 now also **destroys** the session on these spurious failures (reconnect cost only). |
| HD-5 (command-completion ACK gives `denied`) | open (F identical); extended by HD-13 to CAS under an in-flight COMMIT |
| HD-6 (stuck claim or fence after ACK loss) | open; extended by HD-13 (orphan reserved rows) |
| HD-7 … HD-11 | open, unchanged (Q, BCD and E outputs identical) |

## 6. Not performed

- **Wire-level TCP loss or proxy injection.** Faults were injected at the driver boundary (`Client.prototype.query`), or were real server events: `pg_terminate_backend`, `pg_cancel_backend`, statement, lock and idle timeouts, a server restart, and a deferred trigger inside COMMIT.
- **PgBouncer** (not installed) and **PostgreSQL ≤ 13** (emulated with an unknown startup GUC on 16.15).
- **`pg-native`** (not installed; `NODE_PG_FORCE_NATIVE` fails at import).
- **Real OpenAI or network calls** (forbidden). The real adapter was exercised through a fake SDK.
- **HD-1 … HD-11 in depth** (as instructed).

## 7. Full regression

| Check | Start (HEAD 0e7cda9) | End |
|---|---|---|
| `npm run lint` | 0 | 0 |
| `npm run typecheck` | 0 | 0 |
| `npm test` | 1633 / 1633 pass, 0 fail / cancelled / skipped | 1633 / 1633 pass, 0 fail / cancelled / skipped |
| `npm run build` | 0 | 0 |
| `git diff --check` | clean | clean |

## 8. Final cleanliness

- HEAD is still `0e7cda9be3da97b7f5a9b1fe1913515c6f612166`. `git status --short --branch` gives `## feature/development-agent-module...origin/feature/development-agent-module` with divergence **0 0** at the end.
  - The AI-036.7 report said the commit was "ahead 1, not pushed". The remote-tracking ref now includes `0e7cda9`.
  - This review pushed nothing.
- **`AGENTS.md` shows as modified (`M`)**, with mtime 11:16:23 during this review.
  - The change rewrites the agent rules: security invariants, DB rules and the gate process.
  - **This review did not make that change.** Every harness writes only under `/tmp/ai036-regate2/`.
  - It was left untouched; the Owner should confirm its origin. It does not affect code, tests or the build: regression at the end is identical.
- **No repository file was changed by this review.** Nothing was committed or pushed.
- **The throwaway cluster (:55440, TLS material) was stopped and deleted.**
  - No postgres process remains, and nothing listens on :55440.
  - The temporary `a743ca2` source export and the duplicated `pg-protocol` copy were deleted.
- Harnesses and JSON evidence remain in `/tmp/ai036-regate2/`: `o-*.json`, `c-*.json`, `d-errors.json`, `e-lifecycle.json`, `f2-ambiguous-{head,prefix}.json`, `cas-lost.out`, `fg-backstops.json`, `g2b-restart.json`, and `regress/` including `monitor-*.json`.

---

Ready to proceed to AI-037 Technical Debt Census: YES. Carry HD-1 … HD-17 into the census, prioritising HD-13, HD-12 and HD-14.

**AI-036 ADVERSARIAL SECURITY RE-GATE #2 — PASS**
