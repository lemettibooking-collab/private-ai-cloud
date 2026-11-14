# AI-044.4 — Owner-controlled OpenAI API access

This candidate requires independent re-gate. It provides one explicitly selected
Owner production-proof route, not a generic dispatcher or authorization for a real smoke.
`runtimeDispatchAllowed=false`; generic production/live dispatch remains BLOCKED.

## Implemented configuration boundary

Settings → Integrations has a separate OpenAI API card. ChatGPT Plan, its SIWC OAuth
flow, safe HTTP 403 diagnostics and subscription execution are unchanged. There is
no automatic fallback and no call to either provider from an API configuration action.

OpenAI API usage is billed separately from the ChatGPT subscription.

Each action resolves the current GitHub/Auth.js PAC Owner in the trusted workspace
before accessing local storage. Configuration requires an exact dated model snapshot,
context-byte and input-token limits, output-token limit, maximum invocation cost and
daily PAC API cost budget. Monetary inputs use integer USD microdollars.

The key is entered in a password field, submitted once, and never echoed in a public
view, action result, URL, log, audit or PostgreSQL query. No key prefix/suffix/hash is
displayed. “Connected” means saved locally, **not** account/model access verified.
Connect, change, disconnect and model selection do not perform model discovery or inference.

Credentials are separate from ChatGPT at:

`~/.config/private-ai-cloud/openai-api/credential.json`

The store uses 0700 directories, 0600 files, owner checks, symlink/hardlink rejection,
bounded reads, O_NOFOLLOW, O_EXCL atomic temporary files, fsync and rename. It
serializes all operations with `access.lock`; it never automatically steals a stale
lock. Contention fails closed immediately. Release checks inode and owner token.
Manual recovery may remove this lock **only while all PAC processes are stopped**:

`~/.config/private-ai-cloud/openai-api/access.lock`

The OS account and parent directories must be trusted; this is not protection against
another process with the same OS credentials. A random generation changes on key or
configuration replacement so historical receipts cannot silently use a different key.

## Pure financial calculation (not authority)

The candidate includes conservative integer arithmetic using the maximum input-token ceiling,
full uncached input pricing and maximum output tokens (including reasoning). Input and
output costs round upward independently. Evidence must name the exact dated model,
official pricing source, a non-future verification time and expiry within 24 hours.
Unknown, stale, unbounded or over-limit inputs deny.

The parser alone is not pricing authority. Production reads a separate protected
Owner/operator-maintained catalog, never browser fields or model output:

`~/.config/private-ai-cloud/openai-api-pricing.json`

It must be a regular single-link 0600 file owned by the PAC OS user, at most 16KiB,
with exact top-level keys `version` (1) and `prices` (1–20 unique exact models).
Each price has exactly these fields:

```text
model: exact dated model snapshot ID (no latest/approximate aliases)
inputUsdMicrosPerMillionTokens: positive integer standard uncached input price
outputUsdMicrosPerMillionTokens: positive integer full output price
verifiedAt: UTC epoch milliseconds when the operator verified the official rates
expiresAt: UTC epoch milliseconds, <= verifiedAt + 24 hours
source: https://developers.openai.com/api/docs/pricing
```

The operator must verify that both rates cover the exact model and this standard
text-only, no-tools request, including applicable context-size tiers. Use a rate no
lower than any applicable tier for the configured input/output bounds. No cached,
batch, promotional, credit or service-tier discount is assumed. Models whose complete
applicable rate cannot be verified must not be catalogued. Install updates atomically;
never extend a verification timestamp without actually rechecking pricing. The catalog
contains no key, is never editable by an invocation/form, and defaults to **no prices**.
No model/rate is invented or preselected by PAC. All entries must be fresh and valid;
duplicate, malformed, future or stale data fails closed. Pricing remains an operational
trust assumption, not a cryptographic guarantee that the provider will never change rates.

Changing pricing, key generation, model or limits invalidates an old approved intent.
The runner reloads exact pricing before consumption and again immediately before fence.

## Exact Owner-operated sequence

The existing runner `/workflows/development-execution/proof` first presents **ChatGPT
Plan** and **OpenAI API**. Missing/unknown mode never selects a route. API actions also
require the exact `openai_api` form mode. There is no fallback in either direction.

Both modes use the existing protected `ai044-production-proof.json` exact FeaturePlan
policy. API preparation reads the actual saved ProjectTask, approved FeaturePlan,
DevelopmentTask/Run/attempt and immutable Git objects, not a mutable checkout. It
reuses the context manifest, ExecutorAdapter contract, strict 12-file / 1200-line /
256KiB patch validator, controller intent, current authority and downstream QA/Security
pipeline. `readContextPaths` are explicit reference inputs, never write permission.
The complete provider payload must also fit the Owner's context-byte bound.

`PREPARE → REQUEST APPROVAL → OWNER APPROVE/REJECT` makes **zero provider calls**.
Only explicit `INVOKE` may perform native count and generation. It checks the exact
key generation under the inter-process credential lock and durably consumes the
approved attempt while reserving the full maximum cost. A private acknowledged-commit
receipt permits one executor preflight. Native `/v1/responses/input_tokens` receives
the same immutable `model,input` used for inference; count/shape/size failures cannot
dispatch. No heuristic count fallback exists.

After count, the provider-start fence rechecks Owner, task/plan/controller, active
authority generation and fingerprints, expiry, exact price evidence, predecessor and
budget under the existing locks. Only its acknowledged private one-shot capability
can initiate the inference POST. A fabricated receipt cannot count or generate.

The fixed official `/v1/responses` request has exactly `model,input,store,stream,
max_output_tokens,service_tier`: `store=false`, `stream=false`, `service_tier=default`, the exact selected model and output
ceiling. It uses Bearer authentication, no tools, shell, MCP, container, conversation,
previous response, redirects, cookies, API-key environment fallback or retries.
HTTP transport is the injected fetch seam, not an SDK with implicit retries. Responses
are byte-bounded before JSON parsing (512KiB) with a 120-second timeout per count/create.
Pinning the default tier prevents inherited project priority/fast settings from
invalidating standard-rate arithmetic; actual response tier must also be `default`.
Tier changes/omissions produce an unresolved hold, never a guessed discounted settlement.
Protocol decoding reuses the existing bounded OpenAI decoder; raw error/refusal text
never enters a decision. Usage must match count, sum correctly and fit all ceilings.

## Durable cost reservation and recovery

Migration **0022_openai_api_cost_reservations.sql** is necessary: the prior model
windows are daily **tokens** and monthly **cost** scoped to a binding, not a daily
workspace API cost ceiling. The SIWC 0021 approval binding is deliberately subscription-
only and is never impersonated with a synthetic OAuth registration or paid policy.

0022 extends PAC's existing approval queue and reserve/fence/settle/unknown-hold model
with typed API cost reservation evidence and one workspace/UTC-day serialization row.
It stores only bounded nonsecret intent/result/usage, never credentials. All migrations
0001–0021 are unchanged. No production migration is executed by this task.

Reservation = ceiling(maxInputTokens × verified input rate) + ceiling(maxOutputTokens ×
verified output rate), with each component rounded up to integer USD microdollars.
Per-call or remaining daily overflow denies **before even native count**. Under the
workspace/day UPDATE lock, sums include actual settled costs plus full unresolved
reservations across all API tasks/projects. Concurrent requests cannot double-spend
the same daily capacity. UTC day comes from PostgreSQL, not browser or process time.
The start fence denies midnight rollover rather than moving a hold to an unreserved day.
Reservations are attributed to their dispatch UTC day; unresolved old-day holds remain
historical holds, never implicitly released at rollover.

After a factual bounded response, actual validated usage settles cost and frees the
unused maximum, even if the patch is rejected or the Run was cancelled after start.
A factual count/preflight failure before start may settle zero; that evidence cannot
settle a started invocation. Ambiguous dispatch/response/usage, lost COMMIT ACK, crash
or failed capture retains the reservation and yields recovery_required. No automatic
retry, new command or process reconstruction can create a second right. Consumed or
started unresolved predecessors block successor execution across access/provider modes.
Historical definitive settlement clears the existing barrier; current authority is
never reconstructed from historical success. No provider quiescence is inferred from TTL.

Queue decisions, intent identity, reservation, terminal result and audit are constrained
and immutable. State changes and audit commit together. No network awaits occur in
transactions. Existing transaction helpers destroy uncertain sessions. Private caps
are issued only after acknowledged COMMIT. Cross-profile DB guards prevent paid,
subscription and API rights from consuming the same factual attempt.

## Result boundary

An API result is only a patch proposal: `ownerDecisionRequired=true`,
`verificationStatus=not_run`, `automaticRetryAllowed=false`. It never applies a patch,
advances QA, accepts code, merges or deploys. The existing controller consumes factual
historical results for subsequent independent QA/Security; a late result cannot rewrite
a cancelled DevelopmentRun. Generic dispatch and the Phase-L paid/hosted route remain
blocked. Live access/credentials and a real smoke require separate explicit Owner actions.

The first intended future feature remains Smart Algorithms — Liquidity Intelligence
Drawer v0.1. This candidate does not implement it or modify Smart Algorithms.

References checked for design only (not a live pricing authorization):
[native token counting](https://developers.openai.com/api/docs/guides/token-counting),
[official pricing](https://developers.openai.com/api/docs/pricing).
