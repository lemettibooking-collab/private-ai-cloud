# Executor provider request seam v1 — AI-041.2a

Status: **IN REVIEW**, not an independent gate PASS. Baseline:
`1acd52cf791d67e7dd63dbac0b9f75ed4608bfe3`.
`runtimeDispatchAllowed=false`; production/live dispatch **BLOCKED**.

## Ownership and dependency direction

`executor-start-store.ts` and `executor-provider-identity-store.ts` depend on
`executor-provider-request.ts`, never on a concrete executor or HTTP client.
The neutral module owns the small internal contract, bounded snapshots, closed
provider identity checks, generic digest/correlation verification and fresh frozen
projections. It contains no provider JSON schema, credential, SDK, URL or IO.

`openai-agents-request.ts` owns pure OpenAI context/path validation and byte
construction. The old `createOpenAIAgentsCanonicalRequest` export at
`openai-agents-executor.ts` remains compatible. The transport/reconciler retain
their accepted protocol, credentials boundary, observation and recovery behavior.

There is still one durable store, authority issuer, aggregate exposure counter,
identity journal and settlement path. No duplicate provider store/controller.

## Explicit trusted configuration

`PostgresExecutorConfiguration.requestPolicy` is required. Trusted composition
explicitly supplies `createOpenAIAgentsRequestPolicy()`. Missing, forged, cloned,
proxied or wrong-provider handles fail before DB work; no default-to-OpenAI.
The same captured policy is used for request binding and identity preparation.
Changing the original configuration object cannot replace it after construction.

`defineTrustedExecutorProviderRequestPolicy(providerId, prepare)` is an internal
definition helper for audited provider implementations and test fixtures, **not**
a caller/plugin registration endpoint. It captures a synchronous callback in a
private WeakMap and returns an immutable handle. Trusted code capable of defining
a policy is part of the server trust boundary; callback purity/wire honesty still
requires source review. A handle grants no admission, budget or start right.
There is no runtime registry, HTTP hook, SDK or arbitrary plugin discovery.

Only OpenAI is implemented/wired. The closed `openai | anthropic` identity set
allows a future policy and is tested with a synthetic identity-only callback;
that callback is not a Claude request, transport or financial implementation.

## Preparation contract

Arguments are the validated invocation, bounded context, exact target, reserved
integer exposure micros and resolver-owned workspace UUID. Context is snapped
before the transaction; the policy sees only fresh frozen data. Under existing
locks it reconstructs the request from the factual reservation, without IO.

Returned facts: provider, target, base/final canonical strings, SHA-256 base/final
digests, correlation digest and bounded provider-defense evidence. Each string is
at most 64 KiB; total snapshot depth/nodes/members/bytes use existing limits.
Unknown fields (including injected authority), accessors/proxies, malformed
digests, different provider/model/account, incorrect budget evidence or a Promise
fail closed. The neutral layer does not deserialize provider JSON.

The v1 correlation stays SHA-256 of the same LF-delimited domain/workspace/Run/
attempt/base-digest/provider/model/account/executor-ID/version tuple. The only
algorithm change is admitting the additional closed `anthropic` literal. No
normalization, new salt/preimage, unsafe identifier, hash cycle or historical
rewrite. Existing SQL 0016 already reconstructs the same bytes.

## Compatibility and finances

OpenAI retains exact instructions/property order, context ordering, nested payload,
`spend_control.limit`, metadata and hash semantics. Pre-change literal vectors
cover attempts 1–3, cap boundaries 10000/19999/20000 micros, both modes and context
ordering. They test final bytes (via fixed SHA-256/length), base/correlation
digests and metadata; they do not derive expected hashes from the new builder.

The existing durable cents fields and `floor(micros / 10000)` allocation are
legacy provider-defense evidence, not a universal remote hard-spend certificate.
No rounding-up, exact Anthropic billing claim, monetary migration, weaker
settlement or inferred usage release. Nullable OpenAI terminal evidence remains
accepted; missing usage is not newly forbidden. Financial policy for another
provider remains a separately reviewed prerequisite.

Reservation/start uniqueness, current authority/expiry checks, transaction lock
order, uncertain-COMMIT behavior, acknowledged one-use capability, historical
identity/retrieval and atomic outcome/audit/hold release remain in existing code.
No new provider dispatch or production enabling flag.

## Proof and next boundary

The RED test failed on baseline because Anthropic correlation returned null;
six OpenAI literal cases passed there. GREEN coverage adds hostile policy/output,
changed tuple/provider/model/account, reused correlation, frozen outputs,
immutability and static dependency checks. Six executing behavioral mutations
cover tuple provider/base omission, skipped provider and model/account checks,
OpenAI byte drift and unknown-provider fallback; no compile/import failures count.
Existing executor unit and real disposable-PG suites remain required.

No migration or Claude implementation in this task. Parent migration 0013 still
allows only OpenAI; a neutral TypeScript seam does not bypass that constraint.
The separately reviewed **predecessor-quiescence barrier + append-only provider
constraint migration** must precede real-store Claude proof. Network/config
TOCTOU, finance/quiescence, repository materialization, credentials and approved
live smoke remain live-readiness blockers. No real external calls are authorized.
