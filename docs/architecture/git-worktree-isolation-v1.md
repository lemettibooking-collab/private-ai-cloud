# AI-042.2 — Local Git worktree lifecycle v1 (IN REVIEW)

Baseline: `f63e79b8cfb8e3ae1c369b7f31c00bf9944ca36e`, accepted
AI-042.1/042.1a. This slice is a Node-only **physical local Git adapter**,
not a sandbox runtime, execution permission or production composition.
All results retain `runtimeDispatchAllowed: false`; production/live dispatch
is **BLOCKED**. Independent adversarial re-gate is required.

## Boundaries and lifecycle

```text
trusted SandboxExecution admission → claim → preparing
  → WorktreePort.create(identity, expectedRevision, fence)
    → trusted WorktreeStoragePort.withExclusive(platformRoot)
      → current contract/authority + registered repository validation
      → immutable local commit validation
      → durable CAS creating intent
      → exclusive generation slot + durable slot identity
      → current authority reread
      → fixed git worktree add --detach <derived path> <exact commit>
      → current authority reread + factual HEAD/common-dir verification
      → durable CAS ready resource + structured evidence
  → caller may propose domain ready with truthful preparation evidence

terminal historical SandboxExecution → applyCleanup(begin_cleanup)
  → WorktreePort.cleanup(exact resource identity, current revision/fence)
    → cleanup-only replay/current owner + physical identity verification
    → durable CAS removing intent → authority reread
    → fixed git worktree remove --force <derived owned path>
    → factual absence verification → durable CAS removed
  → caller may propose finish_cleanup; execution outcome is unchanged
```

The adapter does not invent, persist or advance SandboxExecution lifecycle
events. An upstream trusted orchestrator must persist the existing contract's
claim/prepare and begin/finish-cleanup proposals with their CAS conditions.
Preparation/cleanup evidence returned here is not a grant to start an agent.
The pure contract has **no dependency on** process, fs, this adapter or its port;
its capability constants still describe pure contract proposals, not this adapter.
No new runtime/UI/HTTP/Server Action/composition entrypoint is wired.

## Identity, repository and exact baseline

The resource key hashes the tuple `(workspaceId, projectId, executionId,
resourceGeneration)`. The fingerprint is checked separately: a changed
fingerprint must collide, never allocate a second checkout. Records bind
worktreeId, specFingerprint, full baseline hash, registered repository ID,
canonical repository/common-directory paths and device/inode identities,
generation slot and checkout device/inode, logical execution ref, requested
branch, creation time, lifecycle revision/fence, storage version and cleanup state.

Only a trusted registry supplies filesystem repository identities. The adapter
checks the current admitted spec against that registry, `rev-parse` repository
facts, a local full 40/64-character **commit** hash and post-create factual HEAD.
It never substitutes HEAD/latest, follows a remote or fetches a missing commit.
Baseline mismatch blocks; verification failure attempts narrowly scoped rollback
of the unpublished detached checkout, never recursive filesystem deletion.

The physical Git model is **detached per-worktree HEAD**, with logical resource
reference `detached:<resourceId>`. `requestedBranch` remains admission metadata;
no shared/execution branch is created or moved. Registry-protected branches are
still rejected at admission. Primary main/feature HEAD, index and dirty/untracked
files are untouched. Removing a checkout removes only its per-worktree HEAD,
never a protected/shared ref. No broad worktree prune or branch deletion exists.

## Filesystem and Git safety boundary

- Preprovisioned configurable private canonical root, owner UID, mode 0700;
  rechecked device/inode/mode/owner before operations. No OS-dependent hardcoded
  home/Mac/VPS directory. The root must not overlap a repository or common Git
  directory. Factual worktree enumeration prevents nesting inside another tree.
- Resource slot is a hash, never raw project/execution path fragments; checkout
  is exactly `<root>/<resourceId>/checkout`. Relative-path containment is segment
  aware, not a string prefix. Caller operations have an exact bounded schema and
  contain **no path, branch or command argument**.
- Cleanup derives and compares the target from trusted records + root + identity;
  checks slot/check-out inodes, real paths, symlinks, Git common-dir, detached
  registration and current cleanup revision/fence/owner. It never uses `rm -rf`,
  broad prune, auto-adoption, reset, stash or a caller deletion path.
- Private `/usr/bin/git` operations use argv, `shell: false`, 15s timeout,
  SIGKILL on timeout and 1 MiB output bound. There is no general command runner.
  Environment is allowlisted, not inherited; global/system configuration is
  disabled. Hooks/fsmonitor/pager/external attributes, submodule recursion,
  credential prompts and all network protocols are disabled. Local config
  includes, filters, worktreeConfig/core.worktree and alternate/grafted object
  stores are refused. This deliberately excludes repositories requiring LFS
  smudge filters or custom checkout hooks; no silent fallback.
- Git stdout is parsed only for bounded config keys, repository/hash facts and
  porcelain worktree records. Raw stdout/stderr/driver exceptions never become
  decision reasons. Evidence contains only known kind/resource hash/reason.

## Storage, concurrency and authority: required, NOT implemented for production

`WorktreeStoragePort` is mandatory. No production durable adapter, migration,
in-memory fallback or VPS-ready service is supplied. Without a compliant trusted
port this subsystem must not be composed or used. The real Git implementation
is exercised with an external disposable on-disk **test fixture port only**.
This is not a claim that a Map or the fixture is a production store.

A production implementation MUST provide:

1. Protected persistent records and historical snapshots per resource generation;
   intent durably committed **before** directory/Git creation, atomic version CAS
   (`null` means absent), complete bounded list/read, ambiguous writes throw.
2. Exclusive root-scoped operation ownership shared by **all** processes and all
   resource, repository-registration and execution/cleanup-authority writers.
   It must remain exclusive until the callback **and Git child process** end.
   No automatic expired/stale-lock takeover while an old process could execute.
   A check-then-write lease or process-local mutex alone is insufficient.
3. Fresh trusted clock/lifecycle/current policy/registry resolution on `context`,
   authorization before reads, tenant-scoped identity resolution. No caller can
   choose its own policy, authority, root or repository registry.
4. No open DB transaction around filesystem/Git work. A future DB-backed port
   needs a separately reviewed durable operation protocol, not a long `FOR UPDATE`
   transaction spanning Git. New store integration requires its own PG/concurrency
   gate. Returned evidence is structured for future audit persistence; this slice
   does not claim an atomic production audit store.

Creation requires a historically valid snapshot **and** current live execution
authority/owner, exact revision/fence/generation and replay of the real `prepare`
event through the current contract. Historical validation alone is insufficient.
Cleanup uses `applyCleanup` and the real historical `begin_cleanup` event, never
the execution path. Current cleanup-only authority can remove an old resource
after execution policy/grants are revoked, but cannot create/resume/check out.
Generation-specific paths and records ensure cleanup A never overwrites/removes B.

## Restart, discovery and partial failures

`reconcile` is historical inspection, not current execution permission. A ready
record is reused without mutation only after factual detached HEAD/common-dir,
exact baseline, canonical path and inode checks. A creating intent with persisted
slot identity plus matching factual checkout may be completed after restart.
`create` itself never resumes a creating/blocked intent implicitly.

| State/evidence | Result/recovery |
|---|---|
| Expected ready + matching Git/resource | ready/replay, no second checkout |
| Creating intent + owned slot + matching Git, ready write lost | explicit reconcile can CAS ready |
| Expected resource missing | deny resource_missing, no fabricated readiness |
| Wrong HEAD or metadata/physical identity mismatch | block; cleanup/manual recovery, never adopt |
| Unexpected Git checkout under platform root | hashed orphan reference; never adopt/delete |
| Intent committed, slot not created | missing/blocked; trusted operator recovery |
| Slot created but slot-identity write lost | block, no inference of ownership from path |
| Git add failed/partially created directory | intent remains discoverable; explicit reconcile/cleanup only |
| Git created then process died / final write failed | persisted creating intent + factual Git reconciliation |
| HEAD verification failed | attempt owned rollback; blocked/pending record, no ready result |
| Cleanup Git failed | removing intent retained; no recursive fallback; outcome unchanged |
| Removal done but final metadata commit failed | removing intent + factual absence; cleanup may safely finish |
| Resource already removed | only after absence + no Git registration: removed/already_cleaned |

`discover` checks known ready/creating records against factual Git and returns
no resources on a missing/mismatched global decision. Unknown paths are reported
only as hashes, never as raw discovered paths. Enumeration is bounded at 256
worktrees/records and fails closed on overflow instead of truncating.
Partial directories without Git registration are never recursively removed or
adopted. The trusted intent is their discovery reference. Operator recovery of
such blocked resources requires all writers stopped and explicit ownership review.

### Limits that must not be mistaken for containment

This is for platform-controlled local roots/repositories with other writers
excluded by the required port. Symlinks and replaced root/slot/checkout inodes
are rejected, but Git is path-based: lstat/realpath and delete are not one atomic
descriptor-relative OS operation. A malicious same-UID/root process bypassing the
port can still race them; stronger OS isolation and/or descriptor-relative host
support is a future requirement. No claim of complete hostile-host TOCTOU closure,
cross-host/VPS locking, disk/inode exhaustion prevention or resource enforcement.
Factual worktree inspection is not authentication and cannot replace persistent
record integrity. Same-content commits in different repositories are bound by
trusted canonical repository/common-dir identity, not by hash uniqueness alone.

Not implemented: Docker/Podman, agent/coding process, generic shell, CPU/RAM/disk
enforcement, network/DNS enforcement, secret injection, provider inference or
dispatch, live/production execution and VPS deployment. Git checkout may consume
disk/work on a large trusted baseline; the subprocess bound is not an OS quota.

## Verification model

Tests create real disposable repositories with two fixture commits, dirty primary
changes, detached worktrees, independent fixture port instances, crash/metadata
failure injection and restart. They never mutate the PAC repository, use a remote,
authenticate or call a provider. All fixtures/mutant copies are removed afterward.
M1–M8 execute the same real Git probe GREEN against original code and RED with an
isolated security guard mutation; source production files are never mutated.
Results/counts/exit codes are in the implementation handoff. PG is N/A because no
DB schema/store implementation changed; a fixture JSON journal is not PostgreSQL
evidence. This document does not declare its author's security gate passed.
