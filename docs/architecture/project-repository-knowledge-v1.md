# Project repository binding and versioned knowledge v1

PAC-ONB-02-KB-01 is an Owner-controlled metadata/document slice. It starts no
execution, model request, repository action, indexing or external fetch.

## Trust and interface

`/projects` links each project to `/projects/[projectId]` (repository) and
`/knowledge?project=…` (documents). Both pages use the server-resolved workspace,
one real Auth.js session snapshot per operation, and the original GitHub identity.
The two new Server Actions accept only resource selectors, bounded payloads,
expected revision/version and an opaque request key. Browser-supplied actor,
workspace, role, verification or credential fields are rejected.

The project-local C1 primitives are reused by project creation and these resource
operations: Owner user/member/workspace/role SHARE locks → original identity
SHARE lock → project UPDATE (mutation) or SHARE (read) → document/version/audit.
Null sessions cause zero database connections. Revoke-before-lock denies; a revoke
after a successful lock waits for the authorized operation to commit. All database
work uses one transaction connection. Authentication, file decoding and hashing
do not await an external service inside a transaction.

## Repository configuration, not GitHub access

Only bounded HTTPS `github.com/owner/repository` locators and existing PAC branch
syntax are accepted. Case is canonicalized and a clone `.git` suffix removed;
credentials, query/fragment, ports, percent encoding, extra path components and
other hosts/schemes are refused. This is a deliberately bounded locator subset,
not proof that the owner/repository or branch exists.

No trusted production GitHub repository connection exists in this slice. GitHub
login identifies the PAC user only; its session is not repository permission.
Every configured binding is **configured_unverified**, never **verified**; verified
baseline SHA is always null. There is no verification checkbox, submitted SHA,
credential resolver or HTTP client that can fabricate evidence or enable access.
A verified state requires a separately reviewed trusted connection/evidence path.

`projects.repository_revision` is a monotonically increasing CAS value. A database
trigger advances it for every repository URL/branch change, including direct SQL,
and rejects rollback/jumps. Owner writes compare the expected revision under the
project lock. The creation/replay audit binds actor, project, request key, exact
intent fingerprint and resulting revision (= expected + 1). Later configuration
changes make a historical binding retry conflict rather than undo later state.
The existing Project Creation retry still conflicts after a repository is bound.

## Exact documents and immutable versions

Existing `knowledge_documents` is reused. Nullable `project_key`/`filename` fields
leave legacy documents untouched and unscoped; no project provenance is inferred
from seed/demo content. The new project UI reads only explicitly scoped rows.
Scoped filename/project identity cannot be changed after creation.

`knowledge_document_versions` stores original bytea, exact SHA-256, sequential
version, creator, timestamp, request key and canonical intent fingerprint. The
existing parent current_version_id points to the latest application-created
version. Composite foreign keys bind versions to the same workspace/document and
historical creator membership. UPDATE/DELETE of version rows is rejected.

Uploads accept only ASCII basenames ending in lowercase .md/.yaml/.yml and fatal
UTF-8 decoding with byte-for-byte roundtrip (including BOM/newlines). Empty,
binary/control-bearing, malformed or oversized content is denied. YAML is never
deserialized, executed or treated as application configuration. Views render
literal text through React escaping, including HTML/script-like Markdown.

Limits: 256 KiB/file, 100 documents/project, 50 versions/document, 16 MiB/project
including historical versions. Quotas and next-version checks occur under the
project UPDATE lock, so separate workers cannot overrun them concurrently. The
same workspace/operation/request key plus exact actor/intent replays the immutable
original version even after later versions; a changed payload conflicts. Replay
also requires exactly one matching atomic upload audit. A new form/request key is
a new explicit upload intent, so identical content may form a new version. With
JavaScript disabled, uploading a new filename works; automatic expected-version
selection for an existing filename requires the client form.

Reads recheck Owner, exact identity and selected project on every request. Content
is selected by project/filename/version, with exact hash/UTF-8 validation and no
cross-workspace/project fallback. Public results contain summaries/content only;
internal UUIDs, actor identity, connection strings and raw driver errors stay
server-side. Audit contains no document content or credential material.

## Transactions, migration and recovery

Migration **0023_project_repository_knowledge_versions.sql** is additive. Migrations
0001–0022 and their bytes are unchanged. Existing repository metadata and unscoped
knowledge remain intact. No destructive DDL, seeds, automatic migration or
production database operation is introduced. Tests apply the migration only to
fresh disposable databases; the existing explicit deployment migration gate must
be separately authorized before production feature use.

Creation/version pointer changes and their audit commit atomically. Audit failure
rolls back all resource changes. Unknown COMMIT acknowledgement returns unavailable;
an explicit identical request can reconcile safely without another version/bind.
There is no automatic retry loop. Transaction session destruction/rollback follows
the existing PAC helper unchanged.

Back up and test restore before any separately approved production migration.
Reverting application code does not remove stored history; do not drop the version
table/columns to roll back code. Database rollback/data export/retention requires a
separate approved plan because immutable history and restrictive provenance FKs
intentionally block deletion of referenced documents/projects/members. Arbitrary
DB-owner trigger bypass and administrative direct content/pointer changes are not
an application API or supported recovery procedure.

## Explicitly deferred

Trusted GitHub verification/reads/writes, baseline materialization, ZIP/DOCX/PDF,
collections migration for legacy content, semantic parsing, chunks/embeddings,
vector search, AI document verification, repository ingestion, retention/deletion
and automatic engineering remain separate work. `runtimeDispatchAllowed=false`;
AI-044 approval/invocation semantics and generic production/live dispatch BLOCKED
remain unchanged. An uploaded document is **uploaded_unverified**, not indexed,
reviewed or accepted for model egress.
