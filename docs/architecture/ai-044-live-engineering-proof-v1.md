# AI-044 Phase L — fail-closed readiness primitives and feature freeze

> **Owner target supersession — AI-044.1:** Portfolio Analytics and the frozen
> target/source/smoke/zero-write contract below are historical, not current
> requirements. The new product target is Smart Algorithms — Liquidity
> Intelligence Drawer v0.1, not implemented here. Its future Owner-approved
> FeaturePlan defines its own baseline, read context, admitted writes and
> acceptance. See the [AI-044.1 contract](ai-044-subscription-patch-executor-v1.md).
> Phase-L safety primitives and paid/hosted DENY-ONLY financial status remain
> unchanged. This notice grants no target fetch, write or inference.

Status: **LIVE READINESS PRIMITIVES: IMPLEMENTED / FINANCIAL GATE BLOCKED**.
Research checked 2026-10-26. No independent gate PASS is asserted.
Owner-amended mode: **LIVE READINESS PRIMITIVES / LIVE PERMIT IMPOSSIBLE**.

Phase L was independently accepted and integrated at
`41c0a166180e610c5454ffd2456bee4edb051d55`. The remaining sections preserve
that paid/hosted profile's evidence and blockers. The Owner's separate
[Phase S subscription patch executor](ai-044-subscription-patch-executor-v1.md)
reuses SIWC direct plan access without a hosted environment or API-key fallback;
it does not unlock or reinterpret this DENY-ONLY financial issuer.
Phase S is an unintegrated implementation candidate, not real inference or an
independent gate PASS. Generic production/live dispatch remains BLOCKED.

## Baseline and scope

PAC: `feature/development-agent-module` at
`4f64f5b5b519da855498d5d56131b94ee8601a26`; initial HEAD/origin tracking equal,
divergence `0 0`, clean worktree/index. That commit integrated independently
accepted AI-043.0–AI-043.5/B3, including factual within-wave cooperative starts.
AI-043 is DONE only in deterministic/fake-live-blocked scope. AI-042 overall
remains PARTIAL; broader AI-037 debt is not promoted.

This is a mandatory pre-live gate inside AI-044, not a new milestone. The task
requires a sufficient exact financial bound before a live permit can exist.
The initial research STOP is preserved as a financial hard blocker. The Owner
explicitly amended preparation scope to allow the pure primitives below while
making live permit issuance impossible. This is an evidence gap, **not proof
that the provider cannot offer a suitable bound**.

`runtimeDispatchAllowed=false`; generic production/live dispatch **BLOCKED**.
No provider API/key use, OAuth/WIF, inference, upload, session/environment/agent
creation, Git publication or production DB migration occurred. Documentation
GETs and authorized read-only GitHub inspection are not live executor calls.

## Current official API facts

Only current official OpenAI sources establish protocol claims. Historical PAC
fixtures/golden schemas are compatibility evidence, not current API authority.

| Area | Fetched evidence and constrained conclusion |
|---|---|
| Create | [Python Create session reference](https://developers.openai.com/api/reference/python/resources/beta/subresources/agents/subresources/sessions/methods/create) describes `POST /v1/agents/sessions`, inline environment, initial input, metadata, stream and optional `spend_control`. Omitted/null spending control is unlimited, so it cannot be omitted on a future capped profile. |
| Spend shape | [Current SpendControl schema](https://developers.openai.com/api/reference/python/__sdk_schema?declaration=(resource)+beta.agents.sessions+%3E+(method)+create+%3E+(params)+default.non_streaming+%3E+(param)+spend_control+%3E+(schema)&selected=(resource)+beta.agents.sessions+%3E+(method)+create) describes positive integer USD cents, maximum `4503599627370495`. It does not establish all-category coverage or a quantitative overrun guarantee. |
| Hosted setup/network | [Hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted) supports inline `openai_hosted`, medium (2 vCPU/4 GB), input files and ordered setup commands. A failing setup command prevents agent start. Restricted network uses exact allowed hosts; wildcard/redirect/subdomain expansion is not implicit. |
| Inputs/artifacts | [Files and artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files) accepts uploaded `file_id` inputs or inline base64 under `/workspace`. Published `/workspace/outputs` artifacts are downloadable after environment expiry. No Agents-specific storage cost bound was established from this guide. |
| Scopes | [Quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart) requires application-key scopes `api.agents.read`, `api.agents.write`, `api.responses.write` and `OpenAI-Beta: agents=v1`. Application keys stay outside the sandbox. No key was acquired or tested. |
| Terminality | [Events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events) distinguishes root turn completion/failure/cancellation from idle and stream closure. Neither idle nor closed stream proves success; output inspection is still required. |
| Recovery binding | [Retrieve root turn](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/turns/methods/retrieve) binds a retrieved turn to its session. Recovery must use a known durable identity, never a heuristic latest-session lookup or another Create. |
| Cleanup | [Manage sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage) says session deletion may leave asynchronous physical cleanup. Deletion is not itself terminal/output/financial evidence. |
| Usage error | [Errors and recovery](https://developers.openai.com/api/docs/guides/agents-api/errors) documents `session_budget_exceeded`. This is not documentation of included sandbox/storage categories or a total hard financial ceiling. |

Reference variants differ: the generic Create rendering did not expose spending
control, while the current Python reference and linked SDK schema do. That
rendering discrepancy is not treated as removal of `spend_control`.
The separate preparation profile pins its own request golden and fingerprint
domain; it does not change accepted `environment:none` bytes. No real supported
model/account is selected or inferred from documentation examples. Fixture aliases
and numeric amounts are synthetic, not Owner approval or account/access proof.

## Financial blocker — exact distinction

The [Agents overview](https://developers.openai.com/api/docs/guides/agents-api/overview)
identifies separate model, tool and standard hosted-container charging. Current
[pricing](https://developers.openai.com/api/docs/pricing) lists 4 GB containers at
$0.12 per 20-minute session, with eligible minute-based billing/minimum rules.
This rate is research evidence, **not an approved amount or lifetime limit**.

The [October 9 changelog](https://developers.openai.com/api/docs/changelog) says
hosted compute is charged during active turns, not idle time between turns.
Therefore idle retention alone is **not** asserted to accumulate compute cost.
The unresolved requirement is a finite bound on **billable active work** and all
other applicable charge categories.

The hosted guide describes a nonconfigurable inactivity expiry after activity and
keep-alives stop, not a maximum active-turn duration. Closing a stream does not
cancel work; deletion can return `409`. A local timeout plus bounded cleanup
retries therefore does not prove an upper bound on remote active compute.

[Organization/project spend limits](https://developers.openai.com/api/docs/guides/spend-limits)
were checked as an alternative. Enforcement is asynchronous and recorded spend
can exceed the limit; no numerical excess ceiling is given. Such a cap alone
does not prove the exact maximum requested by this task.

The reviewed sources do not establish that session `spend_control` covers hosted
compute, Files input/output storage and every possible tool cost, nor quantify
their worst-case combined charge under disconnect/lost Create/cleanup failure.
An upload/artifact byte limit is not a storage cost guarantee. File Search or
ChatKit storage prices cannot be silently assigned to Agents artifacts.

Consequently, a finite PAC reservation cannot yet be justified as a sufficient
total maximum using these sources. Inventing a container amount, interpreting a
billing interval as an execution TTL, fabricating zero storage price, or accepting
an unverified shaped “financial evidence” object would not close that gap.
The live issuer always returns deny with null start capability/result/total
maximum/container maximum. No credential resolver, HTTP transport or migration is added.
Owner numeric live-spend approval remains **NOT YET GRANTED**, as required;
choosing an amount is not a substitute for enforcement evidence.

To resume live-authority implementation safely, obtain official evidence sufficient
to derive a finite all-category upper bound (including enforced active-work
lifetime/category coverage and any bounded overrun), or an explicitly amended
preparation-only scope. No amendment may waive tenant/budget/security invariants.
Any paid run still requires later independent PASS, exact controlled integration
and separate one-shot numeric Owner approval. No such approval is requested early.

### Implemented financial and approval boundary

`ai044-readiness.ts` models the closed categories `model_usage`, `hosted_container`,
`tools`, `file_storage`, `other_billable`. Every category is required exactly once.
Freshness/revision and exact binding/profile fingerprints are checked; negative,
fractional, nonfinite, overflow, missing/extra categories and hostile objects deny.
Unknown is never zero. Price rates, estimates, local timeouts and asynchronous
account hard limits cannot become an exact run maximum. Even all-numeric
`provider_assertion` claims have no vetted evidence source and still deny.

The one-attempt Owner approval **binding model** covers the entire binding/profile/
financial fingerprints, revision, actor, purpose, five-minute maximum window and
consumed-ID checks. It is not a durable approval issuer/consumer and grants no
admission/reservation/start authority. Changed account/model/archive/plan/amount/
attempt changes the binding and invalidates that evidence. No production credential
port or live dispatch flag exists; the server-only composition exports only the
blocked core. Valid keys/approval cannot unlock it. Any future implementation of
financial proof/credential transport needs a separate explicit approved scope.

## Frozen real feature — not implemented

Repository: `lemettibooking-collab/Smart-Algorithms`, branch `main`, exact SHA
`ff8c035f8032417888a71c6a81aa9b9c26c816e8`.
Authorized GitHub branch GET on 2026-10-26 returned that exact SHA. Before any
future live execution, read it again; a moved baseline means STOP/new Owner
approval, never automatic rebase.

Feature: **Portfolio Analytics v1 — Demo Trading Terminal**. Add a read-only
projection of existing `TerminalAccountSnapshot`, paper fills/positions, PnL,
equity and market-health facts; never duplicate reconciliation or trading logic.
Phase L must not implement this feature in the target repository.

Required DTO facts: exchange, equity/cash/locked USD, realized/unrealized/net PnL,
position/priced-position counts, gross exposure, exposure/equity ratio, pricing
coverage, largest position (symbol/value/share), top-three concentration, factual
market-health state/timestamp and analytics `updatedAt`.

| Metric | Frozen deterministic acceptance rule |
|---|---|
| net PnL | realized + unrealized PnL |
| gross exposure | Sum factual non-null priced-position market values |
| positions count | All factual open paper positions |
| priced count | Positions with factual non-null market value; missing mark is not zero |
| pricing coverage | `null` for zero positions; otherwise priced/all × 100 |
| exposure/equity | `null` for equity ≤ 0; otherwise exposure/equity × 100 |
| largest position | `null` when gross exposure ≤ 0; otherwise largest factual market value |
| largest share | position market value / gross exposure × 100 |
| top-three concentration | `null` when exposure ≤ 0; otherwise top-three sum / exposure × 100 |

Stable ties, numerical presentation, finite DTO numbers and state immutability
must be verified. No fake zero for unavailable data. No Sharpe/Sortino/VaR/beta,
drawdown/equity history, strategy attribution, prediction or AI recommendation.

Expected product surface is an Analytics tab in existing bottom panels and one
read-only `GET /api/terminal/portfolio-analytics?exchange=binance&tradeMode=paper`
endpoint (also `mexc`). Reuse account snapshot/domain facts, Node runtime/rate-limit
conventions and normalized errors. Reject other exchange/trade-mode values.
Calculations stay server/domain-side, not React/provider-payload parsing.

Maximum envelope from the Owner specification (not an admitted execution grant):

```text
src/server/terminal/account/**
src/shared/model/terminal/contracts.ts
src/shared/api/terminal/**
app/api/terminal/portfolio-analytics/**
src/widgets/terminal-bottom-panels/**
narrowly required test/verification files
one optional docs/ai/tasks/** feature note
```

A future exact FeaturePlan must narrow this envelope. Scanner, alerts/events/hot,
Market Pulse, marketing/SEO, auth, provider keys, DB/Redis, exchange adapters,
paper matching/fills and reconciliation changes are forbidden. No dependency or
folder restructuring. No target repository code was modified.

### Exact-baseline inspection and unresolved feature seam

Read-only GitHub file inspection at the frozen SHA established:

- [Snapshot DTO](https://github.com/lemettibooking-collab/Smart-Algorithms/blob/ff8c035f8032417888a71c6a81aa9b9c26c816e8/src/server/terminal/account/domain/terminal-account-snapshot.ts)
  already provides scope/version/updatedAt, health state/asOf, positions,
  realized/unrealized PnL and total/cash/locked equity.
- [Snapshot route](https://github.com/lemettibooking-collab/Smart-Algorithms/blob/ff8c035f8032417888a71c6a81aa9b9c26c816e8/app/api/terminal/account/snapshot/route.ts)
  is Node runtime, uses `rateLimitOr429` (120/10 minutes), validates only
  binance/mexc + paper and returns the existing normalized invalid-request 400.
- [Paper PnL](https://github.com/lemettibooking-collab/Smart-Algorithms/blob/ff8c035f8032417888a71c6a81aa9b9c26c816e8/src/server/terminal/core/paper-pnl.ts)
  derives positions from fills, including symbols with zero remaining quantity.
  Analytics must count factual **open** positions (`quantity > 0`), not every
  array entry. Preserve existing realized/unrealized totals and fill semantics.
- Existing UI seams are `src/widgets/terminal-bottom-panels/model/use-terminal-bottom-panels.ts`
  and `ui/TerminalBottomPanels.tsx`; typed no-store GET helpers are in
  `src/shared/api/terminal/read.ts`. UI demo/live mode is not the account API's
  paper query enum; do not conflate those vocabularies.

**Unresolved no-write requirement:** the snapshot route calls
`terminalAccountVersionRepo.ensure`; its
[version repository](https://github.com/lemettibooking-collab/Smart-Algorithms/blob/ff8c035f8032417888a71c6a81aa9b9c26c816e8/src/server/terminal/account/infrastructure/terminal-account-version-repo.ts)
issues `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE`. Even its `get` calls
table initialization. The
[snapshot builder](https://github.com/lemettibooking-collab/Smart-Algorithms/blob/ff8c035f8032417888a71c6a81aa9b9c26c816e8/src/server/terminal/account/application/build-terminal-account-snapshot.ts)
calls valuation → `listPaperBalances` →
[ensurePaperAccountSeeded](https://github.com/lemettibooking-collab/Smart-Algorithms/blob/ff8c035f8032417888a71c6a81aa9b9c26c816e8/src/server/terminal/repositories/paper-account-repository.ts#L58),
which attempts seeding INSERTs. Therefore unmodified snapshot reuse cannot be
certified as zero-DB-write merely because the endpoint is GET. The future feature
must either use a genuinely read-only account/analytics projection, or separately
prove initialization occurs outside analytics GET and that GET performs zero
writes. A narrow safe seam must be designed/proven without duplicating snapshot
construction or changing ledger/reconciliation semantics. If resolving it needs
underlying paper-repository paths outside the envelope, an Owner scope-change
gate is required; no such change is authorized or implemented here.

The builder/valuation also invokes market-data adapters and transport health.
Future deterministic calculation/API smoke needs trusted injected snapshot/market
fixtures and write counters. Calling the ordinary endpoint chain is not a safe
offline smoke and must not silently add Binance/MEXC to sandbox network access.

Candidate narrower plan paths, **proposals only**, not execution permission:

```text
src/server/terminal/account/domain/terminal-portfolio-analytics.ts
src/server/terminal/account/application/get-terminal-portfolio-analytics.ts
src/server/terminal/account/application/build-terminal-account-snapshot.ts
src/shared/model/terminal/contracts.ts
src/shared/api/terminal/read.ts
app/api/terminal/portfolio-analytics/route.ts
src/widgets/terminal-bottom-panels/model/use-terminal-bottom-panels.ts
src/widgets/terminal-bottom-panels/ui/TerminalBottomPanels.tsx
at most two exact deterministic verification files, still to be selected
```

`package.json` provides lint/typecheck/build, no test script/dedicated TS test
runner. A dependency-free deterministic fixture/smoke mechanism remains to be
proven. The preparation contract reserves the exact future script path
`node src/server/terminal/account/portfolio-analytics-smoke.mjs`; the script does
not exist yet and has NOT been executed. It must become a real approved feature
verification artifact before any feature acceptance, not a fabricated green check.
Lockfile v3 resolution
URLs name `registry.npmjs.org`, but native/install scripts (better-sqlite3, sharp,
protobufjs, unrs-resolver) have not been proven registry-only. Thus registry-only
installation and successful credential-free build are **NOT VERIFIED**. Inspected
layout/global CSS do not establish a Google-font requirement; no Google hostname
is granted. Full build-time import graph/extra egress remains unverified.

These findings freeze product requirements and identify prerequisite questions;
they are not an approved executable FeaturePlan or a live-readiness PASS.

## Implemented preparation contracts — no live authority

- `ai044-proof-binding.ts`: bounded hostile snapshot, exact Smart Algorithms
  repository/baseline, plan/task/attempt/account/model/archive/path/acceptance/check
  and amount **structural preparation** binding. It does not validate a factual
  stored FeaturePlan/AI-011 admission or replace the accepted executor boundary.
- `ai044-hosted-profile.ts`: bounded TAR/PAX parser (32 MiB archive, 4096 entries,
  2 MiB/file), checksums/termination, canonical SHA/manifest, regular files only,
  no traversal/symlinks/secret-like bytes/parent-file conflicts. A Git PAX commit
  comment plus caller-supplied hash is **not provenance**: trusted exact-SHA
  `git archive` preparation is still required. Tests use synthetic archives;
  no actual Smart Algorithms archive was generated/uploaded.
- Separate `pac.ai044.openai-hosted-coding.v1` canonical request: inline medium,
  desktop disabled, fixed SHA-check-before-extraction setup, no vault/env secrets,
  no tools/subagents/skills/plugins, restricted exact `registry.npmjs.org` only.
  [Current Create schema](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create)
  establishes authored fields. Network declaration is not proof native package
  installation/build works with it. No uploader/transport/allocation exists.
- `ai044-artifact-recovery.ts`: bounded strict UTF-8 unified text patch/manifest
  validation (12 files/1200 changed lines/256 KiB patch/32 KiB manifest), exact
  path/hash/session/turn/baseline binding. No Scanner/package/dependency changes,
  binary/mode/symlink/rename/traversal or recognizable secret output. This is not
  `git apply` truth: actual exact-baseline apply is a later trusted QA gate.
- Known identity recovery/artifact retrieval return bounded GET descriptors only;
  unknown Create returns no request/no redispatch. Exact linked terminal root turn
  uses the accepted official turn parser. Idle/timeout alone is not success.
  Session configuration checks observable returned fields against canonical
  preparation. Confidential setup/env are NOT echoed by GET; persisted request
  binding is not provider attestation. Account/session identity provenance remains
  a future trusted transport integration requirement. Exposure is **always retained**;
  no terminal observation grants settlement/start/quiescence authority. Cleanup is
  separate metadata and never executes deletion.
- `ai044-qa-handoff.ts`: exact-baseline local isolated-worktree/apply/command/smoke/
  zero-write/fixture handoff model and bounded structural evidence validator;
  Security reviewer differs from patch producer and QA operator. Remote “tests
  passed” is rejected. This does not authenticate shaped source/reviewer claims,
  execute QA, issue trusted receipts or claim actual feature verification;
  `verificationStatus=not_run`. Future integration must use trusted local runner
  and independent review facts, not accept raw caller evidence as authority.

All allow decisions above mean preparation/data structure validity only; every
dispatch flag is false. Only the readiness issuer could represent live authority,
and it has no allow branch. Accepted generic production composition and all
existing durable admission/authority/budget/predecessor/settlement paths are untouched.

## Future live prerequisites — NOT implemented or authorized

- Keep the accepted `environment:none` profile/golden bytes unchanged; hosted
  coding requires a separate explicit version/fingerprint domain.
- Trusted PAC/Owner preparation must `git archive` the exact SHA, reject secret,
  traversal and symlink entries, exclude `.git`/untracked/home/PAC files, bind
  archive SHA and verify it before sandbox extraction. Actual target archive/upload
  remains NOT GENERATED; passing synthetic validator tests is not that evidence.
- Inline explicit medium environment, no ambient template/prewarm mutation;
  restricted network only. Exact dependency/build hosts need factual lockfile
  and build evidence; no wildcard/default internet or exchange API grant.
- Application API key remains server-side. Sandbox vaults and business/GitHub/DB/
  exchange/PAC secrets: NONE. No pure-route credential lookup.
- Bind workspace/ProjectTask/exact plan revision/node/attempt/executor/provider/
  account/model/repository/baseline/archive/paths/acceptance/checks/output schema/
  network/environment/financial policy and output limits in the immutable request.
- One-shot authority must use accepted PAC admission, durable approval, reservation,
  authority/start/identity/outcome/recovery boundaries. No global boolean unlock,
  arbitrary task, second Create after ambiguity or new financial lifecycle.
- Required outputs: `/workspace/outputs/feature.patch` and `manifest.json`, bounded
  text-only patch, at most 12 files/1200 added+removed lines, no binaries/dependencies/
  forbidden paths or Git objects. Manifest must bind exact baseline/patch/path/
  verification/identity facts. Executor claims are not QA evidence.
- Artifact ingestion must validate sizes, strict UTF-8, hashes, path grammar,
  allowlists, traversal/symlinks, secrets and parser limits before local application.
  Preserve evidence durably before cleanup; cleanup is separate and bounded.
- Local exact-baseline isolated worktree is QA infrastructure, not a coding
  executor. Required checks: lint, typecheck, build and factual feature smoke for
  terminal render, both paper exchanges, invalid inputs, empty portfolio, finite
  numbers, no writes, priced/unpriced/equity/concentration/ties/no-mutation cases.
- Independent Security review follows trusted local QA; final Owner acceptance
  remains mandatory. Retryable correction reuses maxAttempts=3/full gates and
  settled-predecessor authority. Unknown outcome never creates another attempt.
- Future verified publication package binds baseline/patch/path/QA/review/Owner/
  intended branch/PR facts. Suggested branch: `pac/ai-044-portfolio-analytics-v1`;
  existing branch means STOP. Commit/push/PR need separate approvals; no merge/
  deploy. AI-044 is DONE only after actual unmerged PR diff equality evidence.

## Author handoff / independent checkpoint

Preparation primitives are implemented for independent re-gate, NOT declared gate
PASS by their author. Behavioral mutations execute relocated module copies outside
the repository, assert original GREEN/mutant RED, and remove copies. Coverage binds
financial categories/approval/credential ordering/provider reachability and archive/
network/secrets/ambiguity/idle/patch/QA/reviewer/global-block invariants. Focused and
full verification results, commands/exit codes, RED/GREEN evidence and full patch
SHA-256 are recorded in `/tmp/AI-044-phase-L-report.md`, not assumed from old B3 runs.

New migrations: NONE. Historical migrations `0001–0020`, packages, accepted
environment:none golden vectors, existing durable stores and generic blocked
composition remain unchanged. Full PG regression uses only disposable PostgreSQL
16.15 databases and existing migrations; cluster is cleaned afterward.
HEAD unchanged; index empty; one full unstaged candidate, including the initial
three documentation files, against `4f64f5b5b519da855498d5d56131b94ee8601a26`.

AI-044 **NOT DONE**. Finite total financial upper bound **UNPROVEN / BLOCKING**;
hosted container maximum **UNKNOWN / BLOCKING**; issuer **DENY-ONLY**;
`runtimeDispatchAllowed=false`; production/live dispatch **BLOCKED**.
Next only after independent PASS: resolve remaining financial-bound problem without
weakening PAC policy. No real provider call or credential resolution occurred.
