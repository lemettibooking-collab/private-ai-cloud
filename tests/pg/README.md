# Live PostgreSQL regression suite (opt-in)

Database-level evidence that fakes cannot provide:
- pooled-session safety;
- HD-12;
- tenant constraints;
- snapshot reads;
- ambiguous-COMMIT reconciliation.

`npm test` never runs these tests and needs no database.

## Requirements

- PostgreSQL 14 or newer. PostgreSQL 16 is the target and the version the suite is verified on.
- A **throwaway** cluster that you own. The role in `TEST_DATABASE_URL` needs `CREATEDB`.
- No Docker, no network, no real model provider. Every Step runs against a local deterministic mock provider.

## Run

```sh
# example throwaway cluster on a non-default port
initdb -D /tmp/aipc-pg -U postgres -A trust
pg_ctl -D /tmp/aipc-pg -o "-p 55442 -k /tmp" -l /tmp/aipc-pg.log -w start

LIVE_PG_TESTS=1 \
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55442/postgres \
npm run test:pg

pg_ctl -D /tmp/aipc-pg -m fast -w stop && rm -rf /tmp/aipc-pg
```

| Variable | Meaning |
|---|---|
| `LIVE_PG_TESTS=1` | Required opt-in. Without it, every file fails immediately with a configuration error. |
| `TEST_DATABASE_URL` | Required. A maintenance database of the throwaway cluster. It must not equal `DATABASE_URL`, and it must be loopback or a Unix socket. |
| `LIVE_PG_ALLOW_NONLOCAL=1` | Optional. Allows a non-loopback host. |
| `LIVE_PG_KEEP_DATABASES=1` | Optional. Keeps the per-file databases for debugging. |

## Safety

- Each test file creates its own database, named `aipc_pgtest_<label>_<pid>_<random>`.
- It applies `db/migrations/*.sql` in order (the numbering must be contiguous), then `db/seeds/*.sql`.
- At the end it drops **only** the databases this process created. Existing databases are never touched.
- Migration failures stop the suite and report only the file name and SQLSTATE.
- Connection strings, credentials and SQL text are never printed.

## Files

| File | Invariant |
|---|---|
| `postgres-session-safety.test.mts` | A pooled session is reused only when idle; failed cleanup destroys the session; a terminated backend does not crash the process; server backstops are present; client `query_timeout` is rejected |
| `workflow-runtime-hd12.test.mts` | HD-12 fail-safe (AI-037.1): no second provider dispatch after a post-dispatch CAS failure (see below) |
| `workflow-runtime-tenant-integrity.test.mts` | Cross-workspace runtime relations and audit rows fail on their tenant constraints; the canonical Workspace mapping holds |
| `workflow-runtime-snapshot.test.mts` | `getRunOverview` reads one REPEATABLE READ, READ ONLY snapshot while another connection commits, and never blocks the writer |
| `workflow-runtime-reconciliation.test.mts` | Current fail-closed reconciliation of a COMMIT that is still in flight (HD-13 baseline for AI-037.3) |

## HD-12 (fixed in AI-037.1)

`workflow-runtime-hd12.test.mts` proves that the provider is never dispatched twice for the same logical Step when the provider call may already have happened but the post-dispatch CAS failed definitively (a real SQLSTATE 40001 is injected).

- The execution stays `outcome_unknown`.
- A replay returns the stored response.
- A new command, whether it reuses the execution id or brings a new one, gets `recovery_required`.
- There is exactly one dispatch and one settlement.

Boundary tests pin the semantics this fix must not change:
- an ambiguous provider outcome stays unresolved;
- a failure before dispatch, or a definitive provider failure, stays a retryable `failed`;
- with no CAS failure, the Step completes with one dispatch.

Recovery of an `outcome_unknown` execution is out of scope here (HD-6).
