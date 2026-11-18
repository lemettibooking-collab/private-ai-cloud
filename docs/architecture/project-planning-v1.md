# Project planning import v1 — PAC-PLAN-01-02

Status: implementation candidate, IN REVIEW. No model, execution, repository or queue authority.
`runtimeDispatchAllowed=false`; AI-044 semantics remain unchanged.

## Reuse and persistence rationale

Project Registry, immutable Knowledge versions, the original GitHub identity/Owner
transaction helper, ProjectTask validation and creation fingerprints, the existing
Roadmap graph validator, and the approval_requests/approval_decisions tables are
reused. Existing task-level FeaturePlans hold at most 64 DevelopmentTasks and have
a required ProjectTask FK. A project backlog is a different stage, not a larger
FeaturePlan. Neither that limit nor its contract is changed.

Additive migration **0024_project_planning_drafts.sql** stores up to 20 immutable
project draft revisions and exact Knowledge document/version/SHA provenance.
The small task-link table is provenance into existing ProjectTasks, not another
task registry. It preserves the original case-sensitive source ID. SHA-derived
public Task IDs include project identity, avoiding workspace-wide source-ID clashes.
One approved plan per project is permitted. Replacement/replanning is deferred;
new proposals never overwrite approved requirements.

## Supported source schema

A file must already be an authorized uploaded project Knowledge version. No paste,
filesystem path, remote URL or client-supplied plan JSON is used for manual import.

- `.md`: exactly one fenced block labelled `pac-plan-v1`.
- `.yaml`/`.yml`: either a JSON object (YAML 1.2 subset) or the restricted mapping
  below: root scalar keys, `tasks:`, two-space `- ` task records and four-space
  fields. Strings should use JSON double quotes; list fields are JSON flow arrays.
  No aliases, tags, merge keys, multiline YAML blocks, implicit scalar conversions,
  arbitrary nesting or recovery from malformed input. Unsupported prose/backlog
  formats must be explicitly converted/re-uploaded by the Owner; PAC does not infer.

```yaml
schemaVersion: pac-project-plan/v1
title: "Project backlog"
tasks:
  - id: "CE-001"
    title: "Describe the intended behavior"
    goal: "Deliver a verifiable product outcome"
    description: "Approved source requirements, retained verbatim as task data."
    type: "feature"
    priority: "P2"
    dependencyIds: []
    acceptanceCriteria: ["A reviewer can verify the outcome"]
    scope: ["A proposed product boundary, not repository write authority"]
    sourceReferences: [0]
```

All fields shown are required; unknown/duplicate fields are refused. `type` reuses
feature/fix/investigation/roadmap; priority P0–P4. Titles <=200 chars, goals and
optional-empty descriptions <=4000. IDs are 1–64 ASCII letters/digits/dot/underscore/
hyphen, case-sensitive and path-free. Up to 128 tasks, 64 unique internal dependency
IDs/task, 32 nonempty acceptance criteria/scope items of <=400 chars each. Manual
import has one source: every sourceReferences array must be `[0]`. No external task
or cross-project dependencies are inferred. Source bytes <=256 KiB, lexical nesting
<=8; bounded capture rejects getters/Proxies/cycles and duplicate JSON/YAML keys.

Preview reports structurally accepted, rejected and pending records, code/path
findings, and warnings. Counts partition source records; unsupported schemas show
no fabricated record count. Any error, duplicate, unresolved dependency or cycle
makes the entire plan non-persistable. The existing Roadmap DAG validator is reused
with deterministic local ID mapping; no second scheduling algorithm is introduced.

## Explicit operations and approvals

Projects → Planning → choose exact filename/version/SHA → Preview (read only) →
Save draft (re-read source, verify preview fingerprint, CAS next revision) →
Owner approve/reject (separate action).

Save creates a pending existing approval request with project/revision/plan/source
fingerprints, plus one audit. No tasks exist until explicit approval. Approval
creates existing **draft** ProjectTasks and immutable source links, task.created
and plan decision audit in one transaction. Scope, descriptions, acceptance criteria
and dependencies stay in the approved immutable planning document; per-task
FeaturePlans and queue enrollment remain separate. Owner decisions are exposed on the project Planning page; the existing global
Owner approval list remains runtime-scoped and is not broadened by this package.
No milestone is enrolled or roadmap dependency table populated: those require the existing roadmap journal.

Only the latest pending revision can be approved. Historical pending drafts can
be explicitly rejected. Approved/rejected revisions cannot be changed. Exact
historical import/decision retries reconcile their immutable evidence; changed
payloads/decisions conflict. Identical source imports do not create new revisions,
even at the history cap. Natural import identity is project + immutable filename/
version/SHA (not an arbitrary caller operation key). Uncertain COMMIT returns
unavailable, never automatic retry, then exact Owner replay can reconcile safely.

C1/C2 consistency: every link INSERT also schedules a deferred lifecycle check.
Pending drafts commit with zero links/decisions and NULL approver, rejecter and
resolution time; rejected drafts commit with zero links and one matching rejection.
Approved drafts commit with the matching decision and complete source-to-task links,
including their existing derived identities and creation-time task payload. Temporary
pending state inside one atomic approval transaction is permitted. Read, save replay
and decision replay validate the same request/decision/link/audit evidence, including
task.created audits. Historical replay does not reset later legitimate task changes.

## Authority, locks and source integrity

Every read/preview/write resolves the server workspace and original session once.
Existing C1 authority locks → exact original active identity SHARE → project SHARE
(read) or UPDATE (save/decision) → source/draft/approval/task rows. An alternative
identity of the same user cannot substitute. Revoke-before-lock denies; revoke
after lock waits through commit. No second connection or network await in a
transaction. KB version reads reuse the extracted existing exact UTF-8/hash/history
reader, including latest-pointer validation, within that same transaction.

DB FKs bind workspace/project, exact source document/version, creator and ordinary
approval. Triggers protect source provenance, immutable proposal/link/decision
records and final approval consistency. A partial index permits one approved plan.
The same project lock serializes revision/import/approval races; all state/audit
writes commit or roll back together. Public projections omit internal UUIDs, actor
IDs, credentials and raw DB errors. UI uses escaped React text; YAML is never loaded
as executable configuration. Locale is presentation only.

## AI capability — factual BLOCKED

The same strict proposal validator accepts synthetic model output in tests.
Bounded preparation places authorized source content only inside a JSON user-data
message after fixed system instructions. It produces a fingerprint and a BLOCKED
capability; the browser receives no message body or completion. There is no fake
production planner, provider client, credential resolver or model invocation here.

Existing AI-039.1 supports one task interview → <=8-step FeaturePlan through a
policy/egress/budget/ledger-backed model runtime. It is not a project-document
backlog route, and credentials existing for AI-044 are not transferable authority.
A later separately reviewed binding must cover project-source egress approval,
ModelProvider/ModelRouter requirements, authoritative token/cost bounds and aggregate
reservation, native provider-start fencing, durable generation/result provenance,
current policy checks and ambiguity recovery. None is bypassed. Local deterministic
preparation/parsing is never described as completed AI generation.

The pure preparation seam bounds four sources / 32 KiB total, with the stricter
existing snapshot string bound of 16 KiB per document. This UI currently selects
one source per preparation. Oversized sources fail closed; splitting/truncating
content silently is not supported.

## Migration and deferred work

Migrations 0001–0023 are unchanged. 0024 is tested only in disposable PostgreSQL 16.
There is no production apply or auto-migration. Back up and test restore before any
separately approved rollout. Code rollback retains evidence; immutable history and
provenance FKs intentionally prevent destructive deletion. Export/retention/down-DDL
require a separate approved procedure.

The checked-in demonstration is synthetic (3 records; boundary tests also use 68
and 128). The real Smart Algorithms Copy Engine v0.4 backlog was not available in
this repository and was not imported or modified. Its actual schema/counts/approval
need a separate authorized real-document import. No generic PAC code hardcodes 68.

Deferred: live project-document AI generation, multi-source UI selection, arbitrary
Markdown/YAML conversion, approved-plan replacement, execution queue, FeaturePlan
materialization and real-feature proof. N1 legacy `/knowledge/[documentId]` remains
static prototype-only; removal/guarded deprecation/safe redirect is still mandatory
before production deployment. No N1 correction is mixed into this candidate.

## PAC-PLAN-03B.1 — deterministic project generation candidate

The server/test-only `createProjectPlanningGeneration` composition provides prepare,
explicit consent/generate, and authenticated read. It has no UI/HTTP binding and
accepts only an injected mock ModelProvider. `runtimeDispatchAllowed=false` remains
unchanged; real inference and generic development dispatch are not authorized.

Preparation reuses exact authorized Knowledge versions and the existing four-source
bounds. A versioned reviewed offer binds canonical preparation, all six pinned model
identity fields, destination, policy version, prices/date and per-call/aggregate limits.
Authorization recomputes that offer under original GitHub identity/Owner/project locks.
Migration 0025 stores immutable request/consent and ordered source evidence, with
transactional audit, composite source FKs, guarded settlement and factual result checks.
It does not change manual import drafts, approval requests or ProjectTasks.

Consent commits before Run creation. Attempt evidence validates that consent against
current authority/policy and exact canonical invocation fingerprint; its first trusted
attempt validation timestamp is latched. Its expiry is the original absolute consent
expiry, never a renewed allowance. Both the original ten-minute lifetime and the shared
attempt evidence checks remain enforced. Replay/restart only reads an existing result;
started or ambiguous requests require recovery and never dispatch again.

One project-specific single-step Run uses existing ModelProvider routing, ledger,
preflight, reservation, provider-start fence and durable usage/result settlement. There
is no parallel budget or ledger. Aggregate accounting is factually scoped to workspace,
project, workflow binding and UTC window. Project-document requests share the constant
`pac-project-document-plan-planning-binding`; the existing FeaturePlan binding has an
independent window. This is not a workspace-wide cross-purpose financial cap. Changing
that scope requires a separate shared-runtime design.

Successful provider text is not automatically a proposal: strict duplicate-aware JSON
parsing and `validateProjectPlan` use the exact immutable canonical source manifest.
Invalid output remains a charged durable invocation with no persistable proposal.
Readers recompute raw/normalized fingerprints and verify original source and audit
provenance. Runtime request fingerprints and pinned provider identity bind results to
the authorized generation. No generated proposal is saved into manual single-source
import history. Explicit generated-plan save/approval remains a later additive task.

Current-authority rechecks occur at dispatch admission and evidence issuance. Precise
project/identity revocation fencing at provider-start is not claimed. A real provider
binding, metered preflight authorization and smoke require separate acceptance. Server
policy prices remain configured assertions, not verified external billing guarantees.

## PAC-PLAN-03B.2 — Owner generation transport and review UI

The existing Planning page separates manual import from project generation. A bounded
exact FormData adapter admits only selectors, reviewed offer fingerprint, explicit
consent and an operation identifier. Server prepare issues `pp-` plus 32 hex characters;
this identifier conveys no authority. Owner/session/workspace remain server-resolved.
The server-only production composition deliberately supplies no generation backend,
provider or policy; prepare/generate return production_binding_unavailable after
Owner authorization. There is no environment bypass or public simulation route.
Only trusted tests inject the accepted deterministic backend.

A successful injected prepare displays canonical filenames/versions/SHA-256, preparation
and offer fingerprints, pinned model identity, destination and token/cost ceilings.
Accounting is explicitly simulated and scoped to project/workflow binding/UTC window,
not a global workspace financial limit. Consent starts unchecked. Source changes remount
the reviewed offer and consent. After authorization the selection and submit button lock;
backend idempotency remains authoritative. Pending means submission only.

Before submission the existing operation key is placed in the page URL. The read form
accepts that identifier after reload and performs only an authorized durable read.
Read never creates a Run or reconstructs dispatch authority. An uncertain operation
retains its key and is presented as recovery_required, without a regeneration button.
The UI does not automatically read or generate on render/reload. A later separate offer
must not be used to reconcile an earlier uncertain spend.

Validated proposals render escaped text with every task field and exact manifest
references. They remain review-only and never enter manual save/approval, ProjectTasks,
FeaturePlans, queues or repository operations. EN/RU state and consent copy is supplied.
`runtimeDispatchAllowed=false`; production/live provider binding remains unavailable.

### PAC-PLAN-03B.2 Corrective 01

Transport returns immediately when the bounded field helper rejects the form, before
any additional entries traversal or authorization. The Planning generation instance
is keyed by project at both the page and generation wrapper boundaries. Reviewed
prepare/authorization/read subtrees also include project and exact selected manifests
in their keys, so a project transition or changed selection cannot retain a previous
offer, consent, submission state or displayed proposal. Durable operation links keep
their original project path; retrieving them still requires server authorization.

## PAC-PLAN-03B.3 — local OpenAI adapter integration (candidate)

The trusted generation composition now accepts a version-2 offer only in explicit
`fake_sdk_only` mode. It uses the existing OpenAI ModelProvider with a mandatory
injected SDK client, protected credential-store generation/limit checks and the
existing runtime. Production Server Actions remain unbound. No environment switch,
real SDK default, subscription fallback, task creation or executor dispatch is added.
`runtimeDispatchAllowed=false`.

The v2 fingerprint includes credential generation, complete normalized limits,
full fresh pricing evidence and a positive bounded preflight allowance. Sources,
purpose, exact dated model/version and official destination remain pinned. The
credential lock spans the operation. Count and create both enforce context-byte
bounds; native count remains authoritative. Create pins the default service tier
and rejects missing/changed response tier as ambiguous. Model discovery is denied.

Additive migrations 0026/0027 introduce a planner reservation referencing the exact
workspace/project/generation and the existing workspace/day budget serialization.
Both planner and API executor aggregate settled exposure plus unresolved full holds
from both purposes. Reserve precedes native count. No estimated token count grants
permission. A factual successful generation accounts separately rounded uncached
input/output usage plus the conservative preflight allowance; that allowance is
consumed at its full bound, not claimed as actual provider preflight billing. Count
failure, start denial and ambiguity retain the full reservation. Invalid proposal
text still accounts for factual generation usage. SQL fences protect immutable
identity, cost evidence and same-transaction financial audit.

An OpenAI project-planning start requires a DB-only extension inside the existing
provider-start transaction. It rechecks original GitHub identity, Owner membership,
active project, durable consent/provenance, runtime fingerprint, current reviewed
policy, reserved UTC day, expiry and financial exposure. Checks use the current
client and branded tenant, never a second connection or network/file await. The
financial start update checks consent and pricing expiry after lock waits. Existing
lease/revision/pause/identity/runtime budget checks remain mandatory, including a
lease recheck after extension locks. Missing extension fails closed.

This is local integration evidence, not a live-provider binding or a billing
certification. Before any live activation, separately review and authorize protected
current pricing/config revision authority (including concurrent replacement), exact
native-count charging evidence, bounded provider transport and response tier/usage,
real credential/access and complete staging recovery/financial gates. A positive
fake preflight allowance is not evidence of a live endpoint's billing maximum.
ChatGPT subscription access does not provide API financial or document-egress
permission. Paid inference and autonomous end-to-end smoke remain deferred to the
separately approved VPS staging phase. Generated proposal approval/save and downstream
Development Workflow integrations require their subsequent scoped tasks and gates.

### Corrective 02: UTC financial admission

Reservation admission uses PostgreSQL `clock_timestamp()` after the shared workspace/day lock, with day equality also in the INSERT. Provider-start repeats the day check after financial locks and includes UTC day equality in the atomic started UPDATE alongside consent/pricing expiry. Rollover denies and rolls back; reservations never migrate to another day.

The injected fake SDK count wrapper requires a final admission callback. It reuses request admission, current Owner/identity/project authority and the reviewed policy, locks the exact durable generation/reservation, then checks current database UTC day, original request/policy/Owner/project bindings and expiry after those locks. The transaction commits before SDK count; no network or SDK await occurs inside it. Existing unresolved exposure remains on denial; replay does not replace reservations or dispatch again.

Authoritative financial admission time is the current PostgreSQL clock evaluated by the final reservation INSERT, count-admission SELECT after locks, or provider-start UPDATE respectively. It is neither transaction start time nor physical network transmission time. No deliberate asynchronous work is inserted between completion of count admission and the injected count invocation. Commit, promise scheduling, process suspension and eventual network transmission cannot be made physically atomic by this check; future live activation must separately assess these timing limits. Production remains unbound and `runtimeDispatchAllowed=false`.

## PAC-PLAN-04 — explicit generated draft approval

A validated durable `proposal_available` operation may be explicitly saved as an
`ai_generated` planning draft. Generation itself remains review-only and production
model binding remains unavailable (`runtimeDispatchAllowed=false`). Saving is a
separate Owner action; approval is another separate Owner action.

Migration 0028 adds mutually exclusive `manual_import` / `ai_generated` provenance.
Existing rows retain manual provenance. Generated drafts reference the exact
workspace/project generation and its immutable source rows; they never fabricate a
single uploaded planning document. Request, output and normalized plan fingerprints,
canonical source manifest, validation version and original save revision are pinned.
SQL guards recheck factual result/hash, source manifest and normalized stored output;
immutable lifecycle, ordinary approval integrity, unique active plan and task links
remain shared with manual imports. Generated save/decision audits are commit-bound.

Save accepts only project ID, operation key, reviewed plan fingerprint and expected
revision. A transaction-local extraction of existing historical generation evidence
checks original Owner identity, exact Knowledge versions/hashes, request evidence,
factual succeeded invocation, raw output hash and complete normalized plan. This
uses the existing authorized project transaction, without credentials, new consent,
provider calls, nested transactions or another pool connection. Historical policy is
validated at original authorization time. Invalid/unknown/recovery outcomes cannot
be saved. Identical save parameters replay factual state; changed parameters conflict.
Durable reads preserve the original expected revision for exact save replay.

Both origins share project-locked revision allocation and the existing decision
lifecycle. Only the latest pending revision can be approved; historical pending
rejection remains supported. Approval atomically creates ordinary draft ProjectTasks,
links, decision and audits. Collision or audit/transaction failure rolls everything
back. Approved immutable plan JSON retains descriptions, criteria, scope, dependency
IDs and multi-source references. Links expose exact source-task ID to ProjectTask ID
mapping. Dependencies are preserved proposal data: they are not execution enforcement
and do not populate the independent Roadmap journal. No queue/executor/FeaturePlan or
repository mutation is authorized.

The existing Planning page supports explicit save from immediate and durable proposal
views, separate forms, origin/provenance, revisions/fingerprints, ordinary decision
controls and links after materialization. EN/RU content is escaped. Simulated origin
is explicit; this stage establishes no live-provider or physical dispatch guarantee.

### PAC-PLAN-04 Corrective 01: numeric normalization

Migration 0029 preserves migrations 0001–0028 and replaces only generated-output comparison in the draft guard. Source references are parsed through PostgreSQL `json` to retain numeric lexemes before conversion to JSONB. A narrow normalizer recognizes the exact binary64 rounding cells of indices 0–3, including ties to even, signed zero and underflow. Decimal constants describe exact cell endpoints; no float cast, epsilon or arbitrary integer rounding is used.

Exponent magnitude is classified before decimal expansion. After decimal-order classification, 2000 significant digits plus a sticky digit preserve the side of every finite cell endpoint (all require at most 1075 fractional places). Numeric work therefore stays bounded even for huge exponents or long mantissas within the existing 262144-byte proposal limit. References outside the source count, duplicates after normalization and nonnumeric values are rejected; canonical sorting and comparison of the complete proposal remain mandatory. This helper is not a second general proposal validator. Exact output bytes/hash, normalized plan fingerprint and historical generation evidence remain unchanged; save and approval invoke no provider.

### PAC-PLAN-04 Corrective 02: Unicode persistence eligibility

Current validation rejects unpaired UTF-16 surrogates in the root proposal title,
using the same lossless UTF-8 round-trip criterion already applied to free-text
 task fields. It preserves the exact text, valid surrogate pairs, supplementary
characters and multilingual titles; no replacement or Unicode normalization occurs.
Identifier and enum fields already have closed ASCII domains. Existing title
length, trimming and control-character rules remain unchanged.

New unsupported output settles as `invalid_output`, with bounded findings. Raw
invocation output and its output fingerprint remain exact; factual incurred cost
still settles through the existing financial path. No regeneration is attempted.

Historical `proposal_available` evidence is verified using its original v1 plan
fingerprint before current persistence eligibility is applied. The narrowly scoped
compatibility helper returns only a fingerprint, never a legacy-valid proposal or
save capability. Verified historical output with unsupported title encoding is
projected as `proposal_encoding_unsupported`, with `storedStatus: proposal_available`
and no proposal. Stored generation status, output, fingerprints, audit and financial
evidence remain immutable. Tampered evidence fails closed, rather than receiving
that projection. Generated save requires a current-valid proposal before creating
an approval or draft. EN/RU read views explain the limitation and offer no save;
a new generation would require separate explicit Owner authorization. Production
remains unbound and `runtimeDispatchAllowed=false`.
