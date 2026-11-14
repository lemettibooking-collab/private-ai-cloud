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
