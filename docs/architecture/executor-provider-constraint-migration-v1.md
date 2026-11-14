# Executor provider constraint migration v1

AI-041.2b2 — IN REVIEW. Implementation evidence is not an independent gate PASS.
Baseline: `fca80a5a272ef734295cd250432f42ea2333db3b`; Roadmap v1.5 remains authoritative.

## Exact schema change

Migration `0013` created `executor_attempt_exposures.provider_id text NOT NULL`
with an unnamed `CHECK (provider_id = 'openai')`. The provider-neutral trusted
request seam already represents `openai | anthropic`, but PostgreSQL still
rejected synthetic Anthropic parent rows. Migrations `0015` and `0016` did not
remove this independent restriction.

Append-only `0017_executor_provider_constraint.sql` replaces only that CHECK
with named `executor_exposure_provider_check`, permitting exactly
`provider_id IN ('openai','anthropic')`. Case variants, aliases, empty strings
and arbitrary providers remain invalid. Existing NOT NULL remains intact.
Migrations `0001`–`0016` are unchanged.

## Fail-closed identification and atomicity

Under an ACCESS EXCLUSIVE parent-table lock, the migration identifies the text,
NOT NULL column by catalog attribute. It requires exactly one CHECK referring
to that column, exactly the single-column, validated, local, inheritable,
nondeferrable original expression. The generated constraint name is not assumed;
the verified name is identifier-quoted when dropped. Absent, duplicate,
combined, unvalidated, non-inheritable, broadened or otherwise drifted shapes
fail with SQLSTATE `55000` before replacement. A renamed correct CHECK works.
Direct replay fails closed rather than silently masking migration history.

The repository PG harness sends each migration file as one `client.query(sql)`
(`tests/pg/helpers/live-pg.ts`); it does not supply a per-file BEGIN wrapper.
One PostgreSQL DO statement therefore contains validation, DROP and ADD.
Statement atomicity rolls back DROP if ADD fails, even under autocommit.
The table lock prevents writers from observing an unprotected intermediate
schema. There is no committed state without the provider CHECK. No network
or provider operation occurs inside the migration or a database transaction.

## Preservation and actual PostgreSQL evidence

The populated upgrade fixture applies `0001`–`0016`, creates factual OpenAI
authority, exposure, events, provider identity and settled result through shared
trusted stores, then applies `0017`. It compares row JSON bytes before/after
across budgets, exposures, attempt events/results, provider executions/identity
events and authority records/events. No UPDATE, backfill, identity regeneration,
timestamp change or fingerprint calculation is part of the migration.

Catalog comparison checks columns/types/defaults/NOT NULL, all other
constraints/FKs, indexes, triggers and table storage metadata. Only the provider
CHECK changes. An injected ADD failure proves rollback; a disposable delayed
migration copy proves concurrent catalog observers retain the old committed
CHECK while writers wait for atomic completion. These copies never replace
repository SQL.

Direct PG cases reject unknown providers and NULL. Actual child inserts exercise
the unchanged composite provider/account/model/request parent FK, cross-attempt
binding and workspace isolation. Provider/account/session uniqueness is retained.
OpenAI post-upgrade flow remains valid. A test-only synthetic trusted Anthropic
policy exercises reserve, prepare, committed fake start, correlation and
session-only identity (`turn_id=NULL`) through the same shared store, not a
Claude adapter. No fake Claude turn or provider-specific identity table is added.

Both OpenAI→Anthropic and Anthropic→OpenAI predecessor tests keep successor
execution blocked until definitive historical settlement. Authority advance
alone does not clear the provider-neutral barrier. Eight executing mutations
cover arbitrary/forgotten/removed provider validation, removed NOT NULL, wrong
constraint deletion, barrier bypass, weakened composite FK and rewritten data.
Each mutant must fail behavioral assertions after its original passes on PG.

## Unchanged boundaries and limitations

`executor_provider_executions`, identity events, `pac.executor.provider-correlation.v1`
and all correlation preimages remain unchanged. No identity or financial schema
redesign, new state, provider turn, lifecycle or production TypeScript change.
Exposure/spend-limit/consumption/settlement fields retain existing semantics;
synthetic Anthropic rows do not prove equivalent provider hard-budget guarantees.
Reservation, authority, start fencing, predecessor checks, holds and settlement
remain independently mandatory. This migration grants no admission or dispatch.

No Claude HTTP/SDK/credentials/Agent/Environment/Session creation, OAuth, inference,
provider request, remote Git, UI/controller/composition or package changes.
`runtimeDispatchAllowed=false`; production/live dispatch remains BLOCKED.

## Rollback and next gate

Do not edit applied migrations or automatically restore an OpenAI-only domain:
valid Anthropic rows may now exist. Any future downgrade requires a separately
reviewed append-only migration and factual data/hold assessment; deleting or
rewriting Anthropic evidence is not rollback policy. A failed `0017` statement
leaves the prior schema intact and requires investigation, not silent repair.

AI-041.2b1 is DONE. AI-041.2b2 is IN REVIEW; AI-041.2b and AI-041.2 are NOT DONE.
Only after independent acceptance may AI-041.2c — Claude Managed Agents Fake
Adapter begin. No live execution authorization is implied.
