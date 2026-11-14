# AI-044.1 — FeaturePlan-driven subscription-session patch executor

Status: implementation candidate for independent re-gate; **AI-044 NOT DONE**.
PAC baseline: `41c0a166180e610c5454ffd2456bee4edb051d55`.
New Owner product target: **Smart Algorithms — Liquidity Intelligence Drawer v0.1**.
Portfolio Analytics is cancelled as the production-proof target. Its historical
Phase-L source set, SHA, smoke command and zero-write criteria are not executor
requirements. The future Owner-approved FeaturePlan chooses its own exact
repository/baseline, read/write context, verification and acceptance contracts.
This PAC correction implements no Liquidity Intelligence feature, reads/fetches
no Smart Algorithms context, changes no target source and performs no inference.

## Official access and the narrow exception

The current [SIWC overview](https://developers.openai.com/siwc/token-sharing-open-source)
and [quickstart](https://developers.openai.com/siwc/quickstart) describe eligible
Plus/Pro plan access for local/open-source clients and selected private clients.
This is not blanket authorization for remotely hosted commercial PAC.
AI-045/VPS deployment must re-check eligibility before moving this access mode.
Identity sign-in alone is insufficient: the existing validated grant must include
`chatgpt.tokens.use.direct`.

The [inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
uses OAuth bearer authentication at `POST https://api.openai.com/v1/responses`,
with `store:false`, `stream:true`, and an exact authenticated selected model.
The catalog is not entitlement or remaining-quota evidence. Only actual completed
inference would prove entitlement for that request; no such proof was attempted.

`ChatGPTPlanPatchExecutor` is an explicit engineering `ExecutorAdapter`, not the
AI-039.2 future generic `ModelProvider`/planner binding. It reuses the already
implemented AI-039.2 OAuth/PKCE/JWKS/issued-client/subject/rotating-refresh/lock/
protected-store foundation. There is no second OAuth subsystem or token store.
There is no API-key, credit, model or provider fallback, app-server, Agents API,
hosted sandbox, local/VPS coding environment, tool loop, shell, MCP, browser,
package manager, subagent or Git authority.

## Manual plan-only operational evidence

[Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
documents per-app plan/credit controls in ChatGPT Settings → Usage. Phase S
requires an explicit Owner operational receipt for the selected issued-client
registration: app limit **1–99%**, credit fallback disabled, and no reliance on
automatic credit purchase. Missing, stale, future-dated,100%, credits-enabled or
wrong-registration evidence denies. Zero is conservatively not admitted because
it supplies no usable plan allowance. Maximum receipt/approval window is15min;
an approval may expire earlier. The actual external configuration must be checked
by the Owner before a real attempt. No real settings were read or changed here.

This receipt is **manual Owner attestation, not cryptographic/provider
attestation**. The [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
does not expose app-limit/credit-switch state. PAC cannot detect an external
settings change between the Owner observation and request; that temporary pilot
limitation is explicit, not an automation/enforcement claim. A short receipt
window does not prove the external settings stayed unchanged.

The existing subscription fee is fixed account cost, not a per-run price.
API billing, hosted compute, paid tools and file workflows are structurally
absent from this request. PAC does **not** fabricate a zero-dollar metered
estimate or insert a fictional paid exposure. Plan allowance remains consumable.
The API-key/paid/hosted path's finite all-category financial bound remains
**UNPROVEN / BLOCKING**; its Phase-L issuer remains **DENY-ONLY**.

## Context, request and output

The trusted local exact-object reader uses only fixed read-only Git operations
against the admitted exact SHA: no checkout source bytes, shell, Git writes, external
filters, alternate objects, grafts, lazy fetch or remote access. It verifies
regular-blob identity and SHA-256, strict UTF-8, ancestor trees and explicit
absence for additions. Context is limited to20 entries,256KiB/file,1MiB total,
inside the admitted feature paths; recognizable secrets, env/package/binary/
symlink/submodule/Scanner paths are denied. The physical reader is configured for
one exact repository identity/root, never an arbitrary caller registration.
Bundle ordering and metadata bind repository/SHA, ProjectTask, immutable
FeaturePlan revision/fingerprint, DevelopmentTask/Run and attempt. Private
provenance cannot be reconstructed by hashing checkout text.
Trust still rests on the configured local Git object database: this is not signed
commit/tree provenance. Tests use synthetic isolated objects; no real target
context bundle was prepared during this implementation.

### Independent read and write capabilities

`allowedWritePaths` is exactly the FeaturePlan/Admission write envelope, never
derived from model context. `readContextPaths` is a bounded exact ordered file
set, not prefixes/globs or a repository crawl. Both vectors are immutable,
fingerprinted in context and explicit in the Owner approval intent.

Without additional policy, preparation may select exact read files only inside
the admitted writes. Additional read-only references require trusted per-plan
`readContextPolicy` configuration (exact revision/fingerprint and explicit finite
`referencePaths`). Repository/task/attempt are captured from the admitted
configuration. Policy bytes are snapshotted; caller prepare input cannot enlarge
the reference set. A reference entry is compared by exact equality, never as a
directory prefix. No target-specific reference list is built into the executor.
Future FeaturePlan preparation supplies this reviewed policy through the unwired
trusted root, not a public request body or new UI/API authority.

Context receipts and durable manifests preserve exact read order. The adapter
checks both vectors against intent and invocation; B3 persists/checks the same
binding. The strict patch parser receives **only allowedWritePaths**, never the
read set or context file list. A reference can appear in the prompt without
becoming patchable. A different read set changes context/intent fingerprints and
cannot reuse the prior one-shot Owner approval. The same generic parser core
retains the historical hosted profile's default path policy; only subscription
uses FeaturePlan-admitted paths rather than the cancelled Portfolio envelope.

Only model/input/store/stream are sent. There is no mutable
provider conversation or previous-response state. Prompt/input is deterministic
and bounded; tools are structurally absent. Stream bytes/events/depth/members,
deadline and output are bounded; native fetch performs one POST and no SDK retry.
Redirects are rejected. Reasoning is ignored, never returned. Every observed
output item must be supported no-tools assistant data. Only correlated,
state-consistent `response.completed` can yield the strict JSON proposal.

Protocol source checked2026-10-27:
[official SIWC Preview Limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
The preview does not support the request parameter `max_output_tokens`; PAC sends
no substitute and claims no hard provider-side per-response output-token cap.
Developer messages remain supported. Local request/stream/event/time/patch limits
are PAC enforcement boundaries, not a provider generation-token limit. ChatGPT
app usage allowance remains bounded by the Owner's external app limit; limit<100%
and credits disabled remain mandatory. This does not enable API-key billing or
credit fallback. The terminal `incomplete_details.reason=max_output_tokens` is
still handled as incomplete, never success; it is not an outgoing request field.

The shared strict unified-diff parser enforces12files/1200changedlines/256KiB
patch. Pure in-memory exact-hunk application checks old context and derives
generic `ExecutorChange` full contents (additional128KiB/file adapter limit).
No fuzzy repair, filesystem apply, binary/mode/rename/dependency/Scanner change
or self-QA claim is admitted. This initial subset requires LF/newline-terminated
source and rejects unsupported no-final-newline patches. Independent local QA
remains `not_run`, Owner decision required, automatic retry forbidden.

## Approval, secrets and durable fencing

The only new append-only migration is
`0021_ai044_subscription_approval.sql`;0001–0020 are unchanged.
It adds typed immutable evidence to the **existing** `approval_requests` /
`approval_decisions` queue, not a second queue or financial lifecycle. The
immutable intent binds tenant/workspace/project/ProjectTask/plan revision+hash/
DevelopmentTask/Run/attempt/invocation/profile/access mode/issued-client+hashed
validated subject/exact model/repository SHA/context hash/paths/patch bounds/
manual receipt/expiry, independent exact `readContextPaths` and
`allowedWritePaths`. Actual Owner actor and decision are durably linked.
Request existence is not approval. Consumption is one-shot and audited in the
same transaction; private capabilities issue only after acknowledged COMMIT.

No new table/approval lifecycle is needed for the split: existing immutable
intent payload/hash and context hash already cover both vectors. Migration0021
is still uncommitted and its former hard-coded Portfolio repository/SHA check
would reject the future FeaturePlan. It now checks bounded repository/hash shape
and read/write-array shape instead; factual equality with configured Admission,
approved plan, saved controller binding and current authority remains required.
This is the sole necessary schema correction; no0022, no changes to0001–0020,
expiry/consumption/audit/barrier/state/financial semantics are unchanged.

Ordering in the scoped server-only use case:

`Owner authorization → factual admission → subscription Router selection → exact
context → current plan-only receipt → exact durable Owner approval + current
authority → committed one-shot consume → token resolution/rotation → current
Owner/plan/authority/controller/receipt fence → one-use capability → one POST →
canonical outcome evidence`.

Routing reads only protected **nonsecret** `subscription-facts.json` inside the
existing credential directory. It never opens token records. Validated OAuth
completion establishes the PAC Owner/workspace mapping; registration writes
invalidate metadata before token replacement and publish refreshed facts last.
Missing legacy/corrupt/unmapped metadata is unavailable, never repaired by early
token reads. A future explicitly authorized existing connection-maintenance flow
can restore metadata; no re-login or credential migration was performed here.
Late access rechecks issued client, subject hash, Owner/workspace, granted scope,
selected model, token expiry and shared rotating refresh. The resulting short
one-use lease is private, opaque and not forgeable from an API key or JSON.
For dispatch, existing inter-process `refresh.lock` covers exact token resolution,
the short DB fence and synchronous POST initiation. Disconnect/model selection
cannot commit between them. Only a callback-active private dispatch lease is
usable; ordinary or escaped leases cannot authorize a POST. The lock releases
before waiting for the stream; no DB transaction spans provider IO.
Tokens never enter intent, database, audit, result, logs, controller or UI.

The shared authority/Owner/project locks are reused. Cross-profile same-attempt
DB guards and the shared predecessor predicate prevent paid/subscription overlap.
Unresolved consumed/started/unknown evidence cannot be replaced by another request,
restart, executor switch or next attempt. COMMIT-ACK uncertainty issues no right.
No provider/network await is inside a DB transaction.

## Failure, recovery and existing corrective lifecycle

EOF/timeout/network ambiguity, malformed/contradictory output, SSE `error` without
terminal evidence and5xx uncertainty retain `outcome_unknown`; no second POST.
Only a correlated factual terminal failure/incomplete or well-formed pre-stream
request rejection can produce a safe failure. Incomplete is never success.
Raw provider errors/refusals are never copied. Recognized
[SIWC failures](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
stop without billing/model fallback: usage exhausted, eligibility/capability
denied or reauthorization required. Usage-unavailable has a bounded advisory
backoff; no automatic request replay is implemented.

Once consumption commits, credential failure or authority loss may leave a
conservative unresolved hold even if no POST occurred. This is intentional
fail-closed availability debt: manual recovery/evidence is needed; expiry or a
new command cannot free it. With `store:false`, unknown Responses cannot be
recovered by speculative retrieval or another inference. There is no automatic
unknown-outcome settlement or manual-clearing bypass in this candidate.

Canonical terminal results are bounded, immutable and fingerprinted. Historical
capture never overwrites a cancelled Run. Existing AI-043 controller transitions,
local QA/Security and repair orchestration read these factual results; no new
retry lifecycle is introduced. Definitive predecessor closure is required before
repair, which requires trusted `repair` classification, Router reevaluation,
a new one-shot Owner approval and a current receipt. Max attempts remains3.

Future local acceptance remains exact-baseline isolated worktree → exact patch
apply/fingerprint → actual FeaturePlan verification commands/feature smoke →
independent Security → Owner acceptance. There is no mandatory Portfolio smoke
command or portfolio-specific zero-write assumption. The new Liquidity feature
defines its own acceptance later; no local target QA/smoke was executed here.

## Deployment and status

`ai044-subscription-run.server.ts` requires a factual saved AI-043 attempt binding
(no unmapped legacy execution) and is an unwired, exact local Owner-operated root,
not a public endpoint, UI action, generic controller live port or environment
unlock. It has no API-key credential source. No real credentials/settings,
OAuth, Responses request, inference or target repository mutation were used.

`runtimeDispatchAllowed=false`; generic production/live dispatch **BLOCKED**.
The separate Phase-L paid issuer remains DENY-ONLY. This unintegrated candidate
does not authorize its first real scoped attempt. That requires independent
PASS, exact controlled integration, current Owner operational preflight and
the exact one-shot live decision. AI-044 remains **NOT DONE**.

RED/GREEN, all17 behavioral mutants (including SIWC M15 and read/write M16/M17), focused/full unit/PG, scans, lint/typecheck/
build/diff-check and full review patch/hash are reported separately in
`/tmp/AI-044-1-report.md`. Tests are fake-transport only; PG uses disposable
databases. The author hands off **READY FOR INDEPENDENT RE-GATE**, not self-PASS.
