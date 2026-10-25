# AI-041.2D — Claude Managed Executor Implementation Design v1

Date: **2026-10-25**. Status: **DESIGN ONLY — independently reviewed for task authoring**.
This supporting design does not revise Roadmap v1.5 or authorize implementation.
`runtimeDispatchAllowed=false`; production/live dispatch remains **BLOCKED**.

Baseline: `feature/development-agent-module`, HEAD = origin tracking HEAD =
`c1d17cab779c97825405a2107a7a1f15f723fcf0`, divergence `0 0`, empty index.
Initially only the untracked [research report](../research/ai-041-2-claude-capability-access-research-v1.md)
was present. It was read completely. Its baseline SHA-256 is
`9cae98dc7666143e5fa36ad75c4e442d75a8a76bb2ce9a208d951f7ee4750a34`.
That report is not edited by this design task.

## 1. Decision

Select **ClaudeManagedAgentsExecutor**, Anthropic **provider_hosted cloud**,
`api_key` access, for a **fake-transport-first** portability implementation.
Workload identity is future access work; subscription-session access is not a
supported design assumption. No PAC-operated Claude CLI/Agent SDK/container.

**Provider-neutral extraction: YES. Decomposition: YES. Migration: YES for the
eventual shared PostgreSQL Claude proof, but NO identity-schema redesign.**
The necessary migration comes from the parent exposure table's OpenAI-only
constraint (§17), not a need for a fake Claude turn ID.

Keep one admitted task, FeaturePlan, trusted Run/attempt, authority, budget,
start/identity/result store, QA/security/approvals/audit and corrective controller.
Only canonical provider preparation, wire protocol and interpretation differ.
The pure `ExecutorAdapter` contract remains unchanged; its allow verdict is
validation, never permission to dispatch.

The first extraction task is authorable without account/network/quiescence live
proofs. Claude implementation is blocked until the extraction and narrow durable
preconditions pass independent gates. No new provider branches are to be buried
in the central store. Fake completion is not AI-041.2 production completion.

## 2. Trust boundaries

```text
trusted server composition / resolved tenant / factual DevelopmentRun
  → existing ExecutorAdapter + admission/attempt validation
  → ONE Durable Executor Core (authority, exposure, start, identity, settlement)
  → Provider Execution Port
      ├─ OpenAI: pure request policy + existing protocol/result/retrieval
      └─ Claude: pure request policy + fake managed protocol/result/retrieval
  → bounded generic artifacts/outcomes → unchanged PAC QA/Security/Owner gates
```

The shared core may consume a synchronous pure request policy through this
port, but must not import provider JSON builders or SDKs. Composition injects
closed, trusted implementations; this is not a public provider plugin registry.
Anthropic event/config objects never enter FeaturePlan, DevelopmentRun,
Admission, corrective controller, generic audit, Router or Owner UI.

Data trust is separate from authority. Provider IDs, metadata and text cannot
mint receipts, choose a workspace, advance an attempt, or authorize a tool.
Private same-process receipts remain provenance, not remotely signed attestation
and not protection against compromise of the trusted server.

Source/filesystem inputs use existing bounded descriptor snapshots, safe paths,
secret checks, fresh copies and deep freezing. No arbitrary unknown JSON
serialization. No provider/credential/network work inside a DB transaction.
The existing lock prefix remains workspace SHARE → Project SHARE → current
authority UPDATE (active operations only) → budget UPDATE → exposure UPDATE →
provider identity UPDATE. Historical reads/capture use the compatible subsequence.

## 3. Existing OpenAI coupling and factual gaps

Line references are to the baseline above, not proposed implementation lines.

| Source | Factual finding | Narrow response |
|---|---|---|
| `lib/db/executor-start-store.ts:20`, `:103`, `:253` | Imports OpenAI builder; rejects non-OpenAI; bindRequest builds provider body under lock | Inject synchronous bounded request policy; no copied store |
| Same file `:146`, `:240`, `:387` | Cap derived from exposure; settled consumed must not exceed it | Preserve compatibility; do not rebrand as universal hard cost guarantee |
| `lib/db/executor-provider-identity-store.ts:11`, `:104` | Rebuilds OpenAI request during correlation preparation | Inject the SAME policy/context snapshot as durable preparation |
| `lib/executors/executor-provider-identity.ts:20` | Correlation primitive rejects provider other than OpenAI | Closed two-provider identifier set; preserve exact v1 preimage |
| `lib/executors/openai-agents-executor.ts:176` | Pure builder co-located with concrete SSE/POST transport | Extract pure implementation behind compatibility export |
| `lib/executors/openai-agents-reconciliation.ts:63`, `:95`, `:122` | OpenAI session/turn schema, spend control and saved-input reconstruction | Remain provider-specific below port; no Claude branches |
| `lib/db/executor-current-authority-store.ts`, advance path | Checks factual predecessor/generation but does not prove old remote quiescence | New start barrier needed; generation advance is not stop evidence |
| `db/migrations/0013_executor_start_exposure.sql:32` | `provider_id = 'openai'` | Append-only exact two-provider constraint extension required |
| `db/migrations/0015_executor_outcome_settlement.sql:25` | Settled cost is nullable or <= stored cap; terminal result/audit atomicity | Keep existing OpenAI invariant; Claude unknown/overrun retains hold |
| `db/migrations/0016_executor_provider_execution_identity.sql:25` | Composite exposure FK, session-only state already possible | Reuse; no fake turn, rename or new identity table |

The start store is 440 lines; identity store 183; OpenAI transport 272;
reconciler 150; start-boundary 214; outcome capture 121. Being below 1,000 lines
does not excuse a dependency violation. Roadmap §10 explicitly requires the
decomposition decision before integration scale-up. The AI-041.1 Owner exception
did not retrospectively pass that gate.

## 4. Provider-neutral request/correlation extraction

### Proposed internal request policy, not a public API

Conceptual signature, to be finalized within the first task's explicit file scope:

```ts
type ExecutorProviderId = "openai" | "anthropic";
type PreparedProviderRequest = Readonly<{
  providerId: ExecutorProviderId;
  target: ExecutorTarget;
  baseBody: string;
  body: string;
  baseRequestFingerprint: string;
  correlationFingerprint: string;
  requestFingerprint: string;
  providerBudgetDefenseEvidence: Readonly<{
    limitCents: number;
    enforcement: "provider_defense_only";
    inFlightOverrunPossible: boolean;
  }>;
}>;
// Internal, trusted, synchronous and pure; no credential, URL, SDK or store port.
interface ExecutorProviderRequestPolicy {
  readonly providerId: ExecutorProviderId;
  prepare(
    invocation: NormalizedExecutorInvocation,
    boundedContext: unknown,
    target: ExecutorTarget,
    maximumExposureUsdMicros: number,
    workspaceIdentity: string
  ): PreparedProviderRequest | null;
}
```

The signature follows the current builder's five arguments. Source validation,
canonical bytes and provider budget defense are provider preparation; workspace,
target and amount are supplied by the trusted core, not accepted from the body.
The adapter cannot return a new budget amount, authority or executable callback.

Core independently checks closed provider/target equality, bounds, UTF-8 byte
length, both SHA-256 digests and the shared correlation preimage. Budget limit
must match the core-derived allocation for this slice. It never parses provider
JSON to find `spend_control`, `budget`, `agent`, or `environment_id`.

The concrete policy remains trusted audited code. Types alone cannot prove that
a JavaScript callback is pure or honest. Use a closed factory/private provenance
for policy instances, capture own methods once, reject proxy/accessor/shape-only
policy injection, and expose no registration/enable endpoint. Only known OpenAI
policy is wired in the first extraction; Claude policy is introduced later in
fake-only composition. An arbitrary safe-looking provider string is not eligible.

Before locks, snapshot context/configuration. Under locks, bounded pure preparation
reconstructs the request from the row amount and tenant identity. Both
`bindRequest` and `prepareProviderCorrelation` use the same policy and compare all
fingerprints; a context change cannot bind a second body. No cached mutable
last-request slot. Do not pass raw provider bodies to audit or persist them in the
identity table. Restart requires original protected configuration/context evidence
or matching saved provider input, otherwise recovery_required.

### Dependency and compatibility shape

Place only the neutral internal interface/validation in a small execution-policy
module; put OpenAI byte construction in an OpenAI-specific pure module. Preserve
`createOpenAIAgentsCanonicalRequest` at its current import path as a compatibility
export/delegate. DB modules depend on the interface, not the concrete factory.
Trusted composition/fixtures inject the OpenAI policy explicitly. Updating this
internal configuration shape is allowed only in the future extraction task;
public ExecutorAdapter invocation/result types remain untouched.

Keep SQL lifecycle, audit and transaction algorithms in the existing store. Do
not create `ClaudeExecutorStartStore`, parallel reservation counters or a second
authority issuer. Do not move the 440-line store into a new file merely to hide
coupling. Core may grow a small generic check; provider parsing must not grow it.

### Exact common correlation rule

Retain the current domain-separated UTF-8 preimage, with LF separators:

```text
pac.executor.provider-correlation.v1
workspaceIdentity
developmentRunId
attemptNumber
baseRequestFingerprint
providerId
modelId
accountId
executorIdentity.id
executorIdentity.version
```

SHA-256 over these exact bytes. Change only the provider gate to the closed
literal set `openai | anthropic`; keep current bounded identifiers, secret checks,
attempt range and non-newline validation. Do not normalize case/whitespace into
another provider. In the store the workspace comes from the branded resolver's
canonical DB UUID, not caller text. Pure test-only workspace strings are not DB
authority. Project binding stays in the exposure/current-authority relations and
invocation evidence; do not add a preimage field and silently break old hashes.

Migration 0016 already reconstructs this same preimage with `concat_ws(chr(10),…)`.
It is safe only with the existing non-null bounded components. No new algorithm,
salt, random nonce, generic JSON serializer, double hash of the old digest, or
provider-specific correlation namespace. Base digest excludes execution correlation;
final body includes it. Do not create a hash-in-its-own-metadata fixed point.

## 5. Claude adapter / Provider Execution Port

The provider boundary owns pure request construction; pinned Agent/Environment/
Session mapping; identity extraction; bounded event/message/file parsing; usage
interpretation; provider errors; retrieval of an existing Session; and a stop
request when separately supported. Those responsibilities do not move into core.

The first port has one start operation (private acknowledged one-use identity
observer required) and a separate **read-only known-session inspection** surface.
The inspector receives no start issuer and exposes no Create, Send, Resume,
budget update, confirmation, archive or delete method. Future stop is a separate
mutating capability, not a method smuggled into recovery. No universal plugin/
transport framework, provider HTTP routing DSL or Router implementation.

Start protocol: **one Session Create with exactly one `initial_events` user.message**.
This is officially supported: [Start a session](https://platform.claude.com/docs/en/managed-agents/sessions#seed-the-session-with-initial-events)
(rechecked 2026-10-25). It matches the existing one-start/one provider operation
shape better than two independent writes. Research's create→persist ID→send was
a proposal, not an accepted durability implementation: a single capability must
not authorize both writes. That alternative is deferred until a separately
approved durable per-operation intent/ack protocol exists.

No Create Agent/Environment, upload, tool confirmation, continuation, MCP or
automatic retries in the first slice. The fake uses preconfigured fixture
Agent/Environment and no real credential. `tools`, `skills`, `mcp_servers` are
explicitly empty; multiagent/workflows and memory absent. Effective cleared
configuration is part of the fixture and must be validated, not inferred from a
default. [Session overrides](https://platform.claude.com/docs/en/managed-agents/sessions#override-agent-configuration-for-a-session)
document clearing list fields; skills must also be cleared when tools are empty.

This remains managed harness patch-proposal execution, like the accepted OpenAI
proposal-only slice, not a direct Messages API loop. It proves neither tool-based
repository implementation nor tests running inside a real cloud sandbox.

## 6. Durable identity mapping

| Fact | Existing durable placement / proposed binding |
|---|---|
| PAC workspace / Project | Trusted tenant UUID; Project FK and locked current authority |
| Run / attempt / kind | Existing authority + exposure unique `(workspace, run, attempt)` |
| PAC executor / version | Existing executor identity; not Anthropic Agent version |
| Provider | Closed `anthropic` literal in target/exposure/correlation |
| Model/deployment | `provider_model_id` = explicit model identity; Agent is bound separately in request config |
| Account + Anthropic workspace | `account_id` = trusted non-secret scoped account alias; actual provider workspace/mapping fingerprint bound in request config |
| Repo ID + exact baseline | Existing exposure fields and canonical context manifest |
| Agent ID/version/config | Immutable executor configuration + canonical request/config fingerprint |
| Environment ID/config | Same; optional provider version only if factual, otherwise explicitly unavailable |
| Tool/network/secret/runtime/API profile | Canonical request/config evidence, never ambient names or caller claims |
| Final/base/correlation digests | Existing 0016 columns, composite FK to exposure request/target |
| Claude Session ID | `session_id`; write once, provider/account/session uniqueness |
| Claude work event ID | Adapter-local retrieval evidence; not an invented `turn_id` |
| Root turn | `turn_id=null`, final identity stage `session_observed` |
| Correlation metadata | Opaque hash, not raw tenant/Run IDs or authority |

`sessionId` is semantically correct for both providers. `turnId` remains optional
and OpenAI-specific where applicable; no cosmetic rename. Claude observer emits
session observations only. Core rejects turn observation for a session-only
policy. Session IDs cannot be moved to another attempt, workspace, account or
provider; identical textual IDs in independent provider/account namespaces do not
by themselves imply the same execution.

Use existing correlation journal, exact target/fingerprint checks, monotonic
recovery flag, row/COMMIT acknowledgements and unique session index. A response
without an ID after possible transmission is ambiguity, not a new ID to invent.
No same-key “latest Session” selection. None of the durable identity reads mint
a new one-use provider-start capability.

## 7. Financial semantics — choose B, preserve legacy evidence

**B: retain the current durable field layout and accepted OpenAI interpretation;
keep new provider-specific finance evidence below the port for the fake slice.**
Do not rename or reinterpret historical rows to suggest exact Anthropic billing.

`maximumExposureUsdMicros` and the atomic aggregate reservation are authoritative
PAC admission/accounting policy. They do not physically force a remote provider
to stop at that amount. For Claude live work, a sufficient external upper bound
or explicitly approved coverage policy is still missing: therefore live deny.

| Field / observation | Slice rule |
|---|---|
| `maximumExposureUsdMicros` | Existing integer amount, full hold on possible start/ambiguity |
| `providerSpendLimitCents` | Preserve `floor(amount/10000)` and stored values; legacy provider-defense allocation, not a universal hard-bound certificate |
| OpenAI `spend_control.limit` | Same wire field, amount and parser/settlement checks as baseline |
| Claude `budget.max_list_cost` | Derived integer-string cents in canonical request; defense only, may overshoot |
| `providerConsumedCents` | Keep accepted OpenAI observations; do NOT insert rounded Anthropic list cost as exact consumed spend |
| `observedCostUsdMicros` | Remains null; no inferred exact billing |
| Claude usage/list cost | Bounded provider-local evidence; validate cache accounting/cumulative snapshots; no direct release |

A usage snapshot, cap echo, HTTP success or successful proposal alone is not a
settlement receipt. For Claude, unknown cost/quiescence, cap overshoot or
insufficient financial coverage yields ambiguous evidence, no terminal result
row and full hold. Existing accepted OpenAI terminal settlement with null
usage/consumed evidence remains unchanged; this is not a new cross-provider
requirement to invent missing exact money.
**Do not null out a known overrun to pass the store's consumed<=cap check.**
Do not cast rounded list cost into micros and claim precision was restored.
Provider budget updates/removal/resume are unavailable.

Fake tests may use a separate explicitly synthetic, test-owned exact financial
observation to exercise existing terminal settlement. It must not masquerade as
an Anthropic API guarantee or a new production evidence issuer. Real Claude
observations cannot obtain that test provenance. The first Claude production
facade cannot call a provider or issue terminal finance receipts. Missing real
financial proof stays a live blocker, not a reason to weaken the shared store.

Preserve shared trusted outcome capture/revalidation and insert→settle→release→audit
atomicity, deferred cyclic FKs, digest checks and lost-COMMIT handling. Historical
terminal proposal settlement is not an invoice reconciliation claim. A future
live finance task must design persistence/precision/overrun policy explicitly;
this design does not authorize a new billing ledger or exact-cost migration.

## 8. Agent / Environment configuration binding

Trusted immutable Claude configuration contains account/workspace mapping,
explicit model, Agent ID + integer version + effective configuration digest,
Environment ID + cloud configuration digest, exact repository/context manifest,
tool/network/secrets/runtime profile, API/beta version, output schema and budget.
No raw credentials. An Environment **name** is not identity; no environment
version is fabricated where the API does not prove one.

Claude base body includes the supported session fields and an opaque config
digest in metadata; a pinned Agent reference/overrides selects exact effective
model/system/tool/skill/MCP values. The config digest covers Environment snapshot,
approved repository/manifest and all other security-relevant local expectations.
Compute base hash before `pac_execution`, add correlation metadata, then hash the
final body. Provider names/fields stay in this policy, not the DB core.

Same canonical bytes must be used by reserve-bound preparation, identity
preparation and fake start; header/profile choices must match the approved
configuration. No “latest Agent”, environment substitution, ambient base URL,
workspace or model fallback. Policy changes require a new admitted configuration,
not mutation of an already-bound request.

Hashing an expected Environment config does **not** enforce atomic provider
configuration pinning. GET→Create is a TOCTOU window. The fake may model coherent
frozen configuration and must reject simulated drift. Before live execution,
provider-supported immutable binding or a reviewed enforcement solution is
required; otherwise dispatch denies. An opaque metadata echo alone is not proof
that the provider ran that configuration.

On restart require the original protected configuration/context and recomputed
digests, or adequate exact saved-input evidence. If unavailable, hold. Do not
rebuild with today's latest Agent/Environment and rewrite old fingerprints.

## 9. Session / one-start lifecycle

| Phase | Factual action / permissible result |
|---|---|
| Admit / reserve | Existing contract/current authority; aggregate micros held |
| Prepare | Pure policy under row amount; one immutable request fingerprint |
| Commit start | Existing current-authority/expiry/Project/budget locks; one acknowledged COMMIT winner |
| Prepare correlation | Existing start capability consumed; immutable correlation row + audit; one private provider capability |
| Before transmission | Exact request/owner/identity observer acknowledgement; consume once; no right from clones/replay/rows |
| Single Create + initial message | One injected fake POST; no follow-up Send or retry |
| Observe Session | Await committed session-ID acknowledgement before successful output can escape |
| Read events/output | GET/stream observations only; bounded parsing/deduplication, no new work |
| Definitive safe terminal proof | Existing contract result + trusted outcome capture → existing atomic settlement |
| Possible transmission / missing ACK / parse failure | Reconciliation required; no partial success, full hold |

Failed BEGIN/COMMIT/ROLLBACK or connection uncertainty preserves current session
destruction/latching semantics. Lost start/correlation COMMIT acknowledgement
never recreates a start capability, even if the DB later shows a committed row.
If provider start capability was consumed but no transmission occurred, only
existing trusted not-transmitted evidence can permit settlement; do not guess.

Claude statuses remain provider-local `running/idle/rescheduling/terminated`.
`idle` by itself is not success. `budget_reached` / `requires_action` are blocked
or recovery-required, not ordinary retry_pending. Unknown states/events deny or
hold; `rescheduling` is provider-owned continuation, not a PAC second Create.
Unexpected tools/workflows in the tools-off profile prevent settlement.

## 10. Retrieval-only recovery

Known Session ID → read current trusted durable identity → inspect that exact
provider/account Session → bounded complete history/config/input/artifacts →
existing ExecutorAdapter result validation → trusted outcome receipt → existing
settlement store. Every read uses original request/target/attempt bindings.

No new Create, Send, Resume, budget change or authority issuance. Revoke/advance
does not invalidate collection of **historical** output, but it never restores
current Run authority or applies the proposal to a cancelled/new attempt.
Archive/deletion/expiry/missing output are not evidence of successful completion.

First Claude inspector supports **known IDs only**. Unknown-ID discovery is
deferred: absence, a list cursor cutoff or matching metadata cannot authorize
redispatch. Missing ID after Create remains held and requires manual/provider
recovery. Even later positive discovery must prove uniqueness and full bindings.

Stream reconnect is observational: open stream, list all bounded history pages,
then deduplicate IDs, not repeat the work message. Polling/read passes may be
repeated with bounded limits; mutating retries are forbidden. Conflicting content
for an existing event ID, cursor loop, overflow or incomplete history holds.

Terminal proof needs the exact initial user payload, coherent effective config,
one natural end_turn idle after the only submitted work, no outstanding action/
workflow, complete safe output and trusted quiescence/finance classification.
Transient errors or an idle caused by our interrupt cannot pass this predicate.
Current official docs do not prove all these live guarantees; the fake must model
them explicitly, and production inspection remains blocked until readiness review.

## 11. Timeout / stop / quiescence and overlap

PAC timeout/cancel ≠ HTTP abort ≠ guaranteed remote stop. A queued
`user.interrupt` acknowledgement does not prove tools or workflows ended. Do not
settle as not-transmitted, release a hold or launch a corrective attempt on it.
Stop is a separate future mutating capability; live cancel/stop is not required
to implement the fake protocol. A fake stop counter/latch can prove the policy.

Uncertain quiescence means full hold and recovery_required. Cancel-before-start
continues to release only existing unstarted reservation; after a committed start
the local cancel operation cannot pretend remote execution never began.

**Required shared-core barrier before Claude proof:** while any earlier started,
unsettled exposure exists for the same trusted workspace + DevelopmentRun,
reserve/prepare/start of a later attempt must deny recovery_required, regardless
of provider/account or available aggregate headroom. Check inside the existing
serialized budget transaction, before admitting new work. No new per-provider
retry list. Historical result/identity collection and definitive settlement must
remain usable so the barrier can actually clear.

Authority `advance` may still record the next factual generation; this alone
grants no start. Thus preserve existing start-versus-advance linearization tests:
a committed old start can be followed by advance, but the new start waits for
safe old completion. Pre-start old reservations cannot dispatch once superseded.
Only cancelled-before-start or definitively settled prior starts clear the barrier;
TTL, zero usage, a failed read or a replaced invocation ID do not.

This is a distinct shared safety change, not hidden in mechanical OpenAI
extraction (§16). Require its own RED/GREEN/concurrency evidence and independent
review. Current authority/exposure code does not establish this check today.
Cross-Run reissuing of the same task remains controlled by trusted admission/
controller lineage, never caller-generated Run IDs; no new-Run bypass route is
introduced. Production cross-Run overlap policy must be proven at live composition.

## 12. Repository input strategy

One trusted immutable context snapshot is selected from the admitted repository
ID + exact baseline SHA. Record a bounded canonical manifest of authorized paths,
file operation/type, byte length and SHA-256; reject symlinks, unsafe paths,
credentials, hidden instruction/config material and scope mismatch before egress.
No arbitrary source loader, local coding process or repository mutation added.

The minimum fake proof uses the same small approved context files as OpenAI,
embedded in the single initial message with baseline/manifest identity. This is
an exact **scoped context at that baseline**, not a claim of a complete mounted
working tree. The fake validates those bytes against trusted fixture source.
It must not claim that prose naming a SHA attests physical checkout.

Full repository mounting is a later profile: public trusted fixture resource with
explicit commit checkout, or separately approved protected file artifacts. Private
repo credentials, uploads and repository readiness verification are deferred.
Branch-only selection is insufficient; no fallback to default branch. Live
profile must prove that the exact approved baseline, not merely its label, was
materialized. All of this remains a live/expanded-profile blocker, not a reason
to invent IO/authority in the fake slice.

No bash/MCP/GitHub mutation tool, commit/push/merge/deploy credential or automatic
PR. Returned changes remain proposals. QA/security and Owner review use the same
PAC pipeline as OpenAI; file acceptance and any Git operation remain separate
approval work. AI-042.2 does not grant local coding authority.

## 13. Event / artifact / usage normalization

Claude raw objects remain below the port. Prefer bounded JSON final proposal in
`agent.message` for the tools-off profile; no Files API required to prove that
first profile. Download support is a later bounded read-only subprofile, not a
reason to implement the full product surface now.

| Observation | Normalization rule |
|---|---|
| running / thinking / model spans | Progress only, never tool or financial authority |
| user message history | Exact saved initial content; exactly one work submission |
| agent message | Untrusted candidate JSON; require one complete report/proposal |
| tool/MCP/custom request | Unexpected in first profile → hold; no confirmation callback |
| natural end_turn idle | Terminal candidate only with §10 proof; not success by string |
| budget/action idle, rescheduling, unknown | No ordinary retry or success; retained hold |
| usage snapshot | Validated cumulative observation; never sum repeated snapshots |
| artifact/file output | Bound size/count/path/hash; missing/late publication means wait/hold |
| provider error/refusal/raw logs | Static generic error classification only; no raw text in domain/audit |

Use existing `evaluateResult`, `revalidateExecutorOutcome`, evidence/hash/path/
secret checks and capture receipts; do not duplicate policy algorithms. Preserve
`verificationStatus:not_run`, `ownerDecisionRequired:true`,
`automaticRetryAllowed:false`. An evaluated succeeded proposal is not QA PASS.
No partial counters, changes or report escape a deny; ambiguous outcomes have no
terminal proposals/settlement. Raw reasoning is never an artifact.

Bounds for the first proposed profile do not exceed current OpenAI/common limits:
8 context files, 8 KiB/file, 32 KiB context, 64 KiB request, 256 KiB response,
64 observed events and 4 bounded history pages (64 total events), 4,096 chunks,
30 s pass deadline. Common result limits remain 64 changes, 128 KiB/file,
16 KiB report and the stricter existing cumulative 256 KiB envelope. Enforce
aggregate bytes before JSON parsing, descriptor bounds before unknown traversal,
and exact schema/state relations. No real session duration guarantee is inferred
from the local 30 s pass limit.

## 14. Cross-provider portability test matrix

One scenario suite takes a provider-specific fake factory and the SAME real
ExecutorAdapter/core/receipt paths; it must not compare two hand-written fake
stores. Account/tenant DB identity comes from the resolver even in PG fixtures.
Wire bytes/config IDs differ; domain semantics do not.

| Scenario | Required identical PAC assertion |
|---|---|
| Admit bounded task | Same plan/task/allowed paths; only executor identity differs as expected |
| Repository | Same repository ID/baseline/context manifest; changed baseline denied |
| Attempt | Same factual Run/number/kind; changed invocation cannot create a second right |
| Reservation | Same integer amount and aggregate hold; exact reserve replay idempotent |
| Start | One acknowledged winner; cloned/replayed capability and restart never mint another |
| Ambiguous Create/POST | One dispatch maximum, no second call, full hold, null terminal result |
| Terminal proposal | Same bounded changes/report validation; unchanged QA/Owner/retry flags |
| Usage alone | No terminal row, no release, no corrective dispatch |
| Known-ID recovery | Reads only; same once-only atomic settlement and exact replay result |
| Timeout/unknown stop | Full hold; successor start barred even after authority advance |
| Late historical result | Historical capture allowed, no current authority resurrection/application |
| Corrective after safe closure | New factual attempt admitted by the existing state machine, not provider auto-resume |
| Financial evidence | No unverified receipt or release; apply each provider's trusted coverage predicate, preserving OpenAI nullable terminal evidence and Claude hold on insufficient coverage |
| Freshness | Repeated decisions deep-equal; allow outputs fresh/deeply frozen; inputs unchanged |

PG gates in future approved disposable DB tasks: same-attempt start races x10,
aggregate-budget races, start/cancel/advance races, session uniqueness across
process/store recreation, unknown-COMMIT latches, outcome/hold/audit atomicity,
and shared quiescence barrier clearing after legitimate historical settlement.
No PG cluster or migration is run by this design task.

### OpenAI compatibility gate before Claude implementation

Baseline tests currently verify hashes dynamically, including metadata/base/final
relations in `tests/executor-provider-identity.test.mts`; no fixed historical
digest literal was found in the inspected request/identity/recovery tests. Do
not rely only on self-consistent new-builder tests. Before extraction, capture
golden bytes/hashes from baseline fixtures for both modes, attempts 1–3, context
ordering and cap boundaries; compare the new path byte-for-byte against them.

Pure read-only baseline diagnostic used `executorConfiguration(n)`,
`executorRequest(n)`, `context()`, `executorTarget()` from
`tests/fixtures/durable-executor.mts`, workspace
`00000000-0000-4000-8000-0000000000a1`:

| Attempt | Exposure micros | Body bytes | Final SHA-256 |
|---|---|---|---|
| 1 | 10000 | 1521 | `4ed4bbf33cb3eff434262fb3504932391f747b694e61fb9f3794bc6fa54497d9` |
| 1 | 20000 | 1521 | `548403702f35c97d8add828c2d863ec378ee331de997995011dbd95d91aefcd1` |
| 2 | 10000 | 1524 | `6b6e21d43cda8ee05f2f3d1432aadecbaf39ec931a5cc8becf82a75897785b5f` |
| 2 | 20000 | 1524 | `2529b7cc4b6ca8879825f6dfe593beeaade56750ba064c0eb7be794bcdc5f10d` |
| 3 | 10000 | 1524 | `28807d13e74181a73593f6eb64cb386ea4e6dc9baff0322253e9f73abebdd5c6` |
| 3 | 20000 | 1524 | `6e289b921da043c22f97f84f62e3d092a3bce8469f9a52f1893873940e944071` |

All six matched SHA-256(body), without credential/DB/network calls. Preserve
instructions, property order, nested payload serialization, context ordering,
spend_control, metadata placement, base/correlation digests and saved-input
reconstruction. Do not wrap old OpenAI bytes in a new universal envelope.
All existing unit and executor PG gates remain mandatory in implementation;
never update fixtures merely to bless unexpected fingerprint changes. Historical
rows and request/result bytes are not rewritten or backfilled.

## 15. Negative / adversarial matrix

| Attack / race | Expected invariant and evidence |
|---|---|
| Forged provider ID, unsafe/case variant | Closed set/provenance rejected before DB/provider work |
| Changed model/account/Agent/version | Request/config/correlation mismatch; no capability |
| Changed Environment/runtime/tool/network/secrets profile | Different config/base/final digest; drift holds; no silent latest fallback |
| Changed repository/baseline/context | Admission/path/manifest or bound-request conflict |
| Changed budget after reservation | Row amount controls policy; no new cap/exposure or budget raise |
| Changed request after preparation | Final digest mismatch; no start/rebind |
| Reused Session in another attempt/workspace | Composite binding/unique index conflict; no attach or release |
| Foreign account/provider Session | Target and credential/account mapping mismatch, opaque deny |
| Conflicting Session ID | Write-once identity conflict, sticky recovery, no newest-ID choice |
| Missing ID after possible Create | One call; unknown hold; no second Create/discovery-as-absence |
| Duplicate Create / replay after restart | No private acknowledged capability; zero new calls |
| Malformed/unknown/duplicate-conflicting event | Bounded fail-closed parse; no partial result |
| Oversized/deep/accessor/proxy/cyclic input | Existing bounded snapshot rejection; no getter/trap/error leakage |
| Oversized/missing/path-escaping file/report | No proposal acceptance; cap bytes/count before parse/download completion |
| Secret-like evidence / raw provider error | Static code/path, no payload in decision/audit/log |
| Rounded list cost / cap overrun | No forged exact consumed cost; hold even if provider says success |
| HTTP timeout or interrupt ACK without quiescence | No terminal financial receipt; successor start denied |
| Authority revoked/advanced after response | Historical evidence cannot become a new execution/apply right |
| Stale live config / two-phase create+send attempt | Live denied; no second mutation supported by first profile |
| Lost DB COMMIT / outcome replay | Destroy/latch uncertain session; no capability/partial output; settle once |

Future mutation gates must kill removing any fingerprint component, allowing an
unknown provider, changing either provider's request after binding, reissuing a
start capability from rows, accepting mismatched Session, treating interrupt/idle
as terminal, hiding cost overrun as null, removing predecessor barrier, allowing
recovery to Create, and bypassing result scope/secret checks. No mutants or
production changes are made during design.

## 16. Implementation decomposition / Decomposition Gate

**Extraction first is mandatory.** Direct Claude changes to the current
provider-coupled central store are BLOCKED. This design is not a retrospective
PASS for the broad roadmap gate or AI-041.0. A focused decomposition can proceed
without a wholesale runtime modular-monolith refactor.

Recommended provisional sequence (task authoring must give exact file scopes):

| Slice | Scope / independent exit gate |
|---|---|
| AI-041.2a | Pure provider request/correlation seam **and atomic OpenAI adaptation onto it**; remove concrete imports from both DB stores; preserve exact bytes/current behavior; no migration/Claude transport |
| AI-041.2b | Narrow durable prerequisites: separately review shared predecessor-quiescence guard, then append-only provider constraint extension; synthetic trusted test policy + real disposable-PG proof; no real Claude transport |
| AI-041.2c | Claude pure builder + fake managed start/known-ID inspector + bounded normalization, registered only in test composition; shared core, no duplicate lifecycle/finance algorithms |
| AI-041.2d | Shared two-provider unit/PG portability, adversarial and mutation gates; prove recovery/hold/once-only semantics; keep live blocked |

Combining the small extraction and OpenAI adaptation in a avoids an unused
parallel seam/intermediate mixed policy. b contains **two explicit sub-gates**,
not a license to mix safety fixes and broad refactoring. If ownership/review size
requires, author b1 guard and b2 constraint migration as separate focused tasks.
Do not start c while either prerequisite remains unresolved.

Expected ownership: execution-policy types are internal and provider-neutral;
pure provider builders/normalizers stay provider-local; existing store owns
transactions/counters/SQL; trusted composition wires them. Tests use the same
store and contract. No new generic framework, universal agent loop, second
controller/budget/approval/audit system, or public provider plugin mechanism.

## 17. Migration decision

**Migration required: YES for PostgreSQL Claude support. Identity redesign: NO.**
0016 can already represent `session_observed` with `turn_id=null`, immutable
correlation, one identity per attempt, session namespace uniqueness and event
binding. Keep its table, columns, state names and SHA-256 algorithm unchanged.

However its composite FK references an exposure row; 0013 restricts that parent
to `openai`. 0015's state-check replacement does not remove this independent
provider constraint. Relaxing only the TypeScript gate cannot make a factual
Anthropic row valid. Recording provider `openai` for Claude is forbidden.

Future explicitly authorized append-only migration (next free number, currently
0017) must replace **only the exact OpenAI-only parent provider check** with
`provider_id IN ('openai','anthropic')`, preserving NOT NULL and every other
constraint/index/FK/journal. Identify the expected check precisely and fail if
schema differs; do not copy a broad pattern-dropping migration. Existing rows
are unchanged. Consider a narrow additional child check enforcing Claude
`turn_id IS NULL`; no new identity stage/column/table is needed for it.

No financial-precision/settlement relaxation, new dispatch/send ledger or history
backfill in that migration. Test upgrade of populated baseline schema, exact old
row hashes/relations, allowed session-only state, wrong providers/turns, missing
audit, cross-tenant references and duplicate session/attempt rejection in an
approved disposable PostgreSQL database. No migration file is created/applied
by AI-041.2D. This factual requirement must be explicitly authorized in b's task;
until then the extraction remains OpenAI-only operationally.

## 18. Live-readiness blockers versus fake implementation prerequisites

| Item | Fake-only work | Live execution |
|---|---|---|
| Shared request/correlation seam + OpenAI compatibility | Required before Claude | Required |
| Parent provider constraint and quiescence barrier | Required before real-store Claude proof | Required |
| Real account/API key/workspace binding | Fixture only; no credential calls | Owner/provider eligibility and trusted credential mapping required |
| WIF | Not implemented | Optional separately scoped access path |
| Actual Agent/Environment IDs/config snapshots | Immutable fake fixtures | Protected factual version/config binding; no TOCTOU assumption |
| Network Contract v1 | Model expected policy; drift/unknown deny | Full proven compliance OR dispatch denied; not weakened |
| Financial overrun/rounding coverage | Synthetic evidence tests, production receipts blocked | Sufficient approved bound/reconciliation policy mandatory |
| Stop/quiescence | Fake latches prove retained hold/barrier | Adequate remote evidence required; timeout/ACK not enough |
| Repository baseline/materialization | Exact scoped fixture context | Prove full chosen live profile; credentials/skills/egress separately reviewed |
| Unknown create ID | Hold; no automatic Create | Same conservative behavior; stronger recovery needs factual provider evidence |
| Live provider smoke / egress approval | Forbidden | Separate Owner-approved bounded task after gates |

Provider-owned cloud container YES; PAC-owned coding container NO. Claude Code,
Agent SDK/self-hosted worker and local/VPS coding remain deferred to AI-052 after
AI-051. Lack of managed parity does not authorize a local fallback.

## 19. Non-goals / research disposition

No production implementation, migration, package, auth, endpoint, credential,
OAuth, inference, Agent/Environment/Session creation, network/tool execution or
runtime enablement in this task. Only public documentation retrieval and local
read-only inspection/pure diagnostics plus the design document. No Git stage,
commit, push, merge, release or deploy. No edits to roadmap/status, tests/source,
the sibling repository, review patches or stash.

**Research document assessment: READY FOR INTEGRATION as a research record,
subject to independent review.** Its factual claims retain explicit unknowns and
do not authorize live work. This design supersedes its provisional two-phase
start/minimum tool suggestions with a single-write, tools-off first profile;
that is a narrower design choice, not a correction to official API facts. The
new parent constraint/overlap findings are implementation investigation, not a
claim that the original research proved migration-free durability. No research
wording is silently rewritten. Independent reviewer verdict is recorded in §20.

## 20. Exact next implementation task / handoff

Author **AI-041.2a — Provider-neutral Request/Correlation Seam + OpenAI Compatibility**.
Do not implement it in this design task. Explicit future task boundaries:

- Small neutral request-policy module; pure OpenAI builder extraction behind the
  existing export; common closed two-provider correlation primitive.
- Minimal changes to `executor-start-store.ts` / `executor-provider-identity-store.ts`
  to consume a trusted policy, plus exact trusted composition and fixture wiring.
  No provider JSON or HTTP dependency in those core stores.
- Existing request/identity/start/outcome/retrieval tests plus focused seam tests;
  capture pre-change byte-level goldens; prove all existing OpenAI semantics.
- No Claude wire implementation, schema change, predecessor safety modification,
  new auth/network capability, public contract/UI/Router/controller change or live
  provider call. Those require subsequent separately reviewed scopes.
- Independent extraction/compatibility gate before authoring b's implementation;
  b must expressly authorize the safety guard and necessary append-only migration.

This design supplies task-authoring decisions, not an implementation grant.
Current dispatch stays blocked even if every fake test passes.

### Design-task verification and independent review

Fresh repository checks for this design task:

| Command | Observed result |
|---|---|
| `npm run lint` | Exit 0; existing unused `_sequence` warning at `tests/pg/feature-plan-revisions.test.mts:308`, unchanged |
| `npm run typecheck` | Exit 0 |
| `npm test` | Exit 0; 2635/2635 passed, 0 failed/skipped |
| `npm run build` | Exit 0 |
| `git diff --check` | Exit 0 |
| Per-file `git diff --no-index --check /dev/null …` | Exit 1 (new-file diff) for both documents; no whitespace diagnostics |

Logs live outside the repository at `/tmp/AI-041.2D-{lint,typecheck,test,build}.log`.
Tests used deterministic fakes/local loopback; build fetched public fonts. No
provider/OAuth/inference call or PG/migration run is part of this task. Ordinary
`git diff --stat` is empty because both documents are untracked; no-index stat
reports their complete new-file sizes. The research SHA-256 is unchanged.

The author does not self-certify a gate PASS. Owner authorized a separate
read-only reviewer with fresh context: `/root/ai0412d_independent_review`.
That reviewer independently confirmed **AI-041.2 IMPLEMENTATION DESIGN REVIEW:
PASS** and **RESEARCH DOCUMENT: READY FOR INTEGRATION**, including the explicit
OpenAI-nullable-finance clarification. No blocking findings. This verdict covers
implementation task authoring only, not implementation or live authorization.

READY FOR AI-041.2 IMPLEMENTATION TASK AUTHORING
