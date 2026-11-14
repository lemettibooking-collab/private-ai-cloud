# AI-042.1 — Sandbox Execution Contract v1

Status: **AI-042.1a IN REVIEW — corrective contract/policy foundation only**. Baseline:
`c9c04d94217847e6bbe5066f54f8d69897693862`. The Owner accepted AI-041.1
before this task. Production/live dispatch remains **BLOCKED**.

This narrow Owner-authorized slice supports the managed-first AI-042
ExecutionEnvironment direction. It neither mandates a PAC-owned agent runtime
nor implements Docker/Podman, a worktree adapter or a self-hosted worker.

## Model and trust boundary

`lib/contracts/sandbox-execution.ts` exports `createSandboxExecutionContract`
and readonly `SandboxExecutionSpec`, `SandboxExecutionSnapshot`,
`SandboxAuthority`, action, command, artifact, result and decision types.
The factory exposes `create`, `apply`, `applyCleanup`, `validateSnapshot`,
`evaluateCommand`, `evaluatePath` and `evaluateNetworkAccess`. There is no execute
method, IO or dispatch token. Network probes use native `BlockList`/`isIP` only
as in-process address classifiers; they never resolve a hostname or open a socket.

Trusted composition must supply a factual, current configuration: workspace,
execution grants, Project Registry repository IDs, known baseline commit hashes,
policy/approval references, command profiles and ephemeral-secret metadata.
`SandboxAuthority` supplies separately trusted current project/execution/actor,
generation, approval state, expiry and time. Execution grants also carry a
positive immutable `resourceGeneration`, bound to `spec.checkout`. These ordinary data types do NOT
authenticate a caller. Neither a model-produced spec nor caller-supplied IDs,
approval references, timestamps, journal or a self-created factory establish
authority. There is no public/runtime/UI adapter wired to this factory.
Future composition must resolve tenancy and authorization using existing PAC
boundaries before obtaining these inputs; it must not trust browser or executor
configuration. Known baseline membership is checked on current admission; no repository is read.

Input is descriptor-snapshotted with the existing bounded plain-data helper
before validation or hashing: depth 10, 10,000 nodes, 64 members per collection,
256 KiB aggregate string data. Proxies, accessors, cycles, exotic objects,
unknown fields, invalid numbers and over-limit inputs fail closed. No getters
are called. Canonical sorting operates only on that bounded snapshot; argv and
journal order remain meaningful. SHA-256 fingerprints detect replay collisions,
not authenticity. Inputs are not mutated. Successful outputs are fresh and
deeply frozen; denied outputs contain no snapshot, normalized command, CAS
condition or partial events, and do not echo invalid data or raw exceptions.
An invalid trusted configuration throws only `invalid_sandbox_configuration`.

The spec binds execution/workspace/project/repository/baseline,
`checkout.branch` and logical `worktreeId`, mode, path scope, command profiles,
fixed forbidden actions, network, resource and artifact budgets, secret refs,
cleanup policy, policy revision and approval reference. Worktree identity is
exactly the execution ID; branch is exactly configured prefix/execution ID and
must not be protected. Resource generation identifies one immutable incarnation;
it is independent of policy revision and the monotonic authority/fencing counters.
A new attempt needs a distinct trusted execution grant,
not a caller resetting state or changing policy in place.

## Lifecycle and evidence

```text
requested --admit--> admitted --claim--> admitted (owner + fence)
  --prepare--> preparing --ready(evidence)--> ready --start--> running
  --complete(result + passing verification)--> completed
  --fail(definitive evidence)---------------> failed
any nonterminal --cancel / block-----------> cancelled / blocked

each terminal --begin_cleanup--> cleanup.running
  --finish_cleanup--> cleanup.completed | cleanup.failed
```

Cleanup is a separate substate; it does not reopen the terminal execution.
`block(crashed)` represents crash recovery, not evidence of a clean process exit.
Unknown command outcome blocks the execution and is never automatic retry-ready.
`fail` cannot silently turn an unresolved running command into definitive failure.
Cancellation/block invalidate ownership/fence and mark unresolved commands
`outcome_unknown`. They do not claim to have stopped a process.

Snapshots include revision, monotonic authority generation and fencing number,
owner/lease, start/end/update timestamps, admission, terminal failure/result,
command records with exit codes and stdout/stderr refs, cleanup attempts/result,
and the ordered audit journal. Required verification is the latest outcome for
each required profile, not a historical pass followed by failure. Completion
requires no pending command, meaningful report, and (patch mode) nonempty diff
reference plus writable changed paths; analysis mode has no diff or changes.
References are ID + SHA-256 + size, not URLs, filesystem locations or raw logs.
These are evidence proposals, not proof that referenced bytes exist, that a diff
matches them, or that verification ran in the correct physical sandbox. Future
artifact capture/Quality Gate must establish those facts independently.

Every successful transition proposes one journal event: request, admission,
ownership, preparation, ready, execution start, command allowed/finished,
terminal and cleanup start/completed/failed. A denied request returns only
sanitized static `auditEvidence` kind/reason. There is no secret-bearing free
text. No audit is actually persisted by this pure module.

## Filesystem, Git and commands

Repository-relative canonical ASCII paths only: no host roots, home paths,
traversal, wildcards, encoded paths or backslashes. Readable and writable paths
are separate, narrowed from trusted policy; writes must also be readable.
Explicit forbidden paths cannot overlap allowed paths in either direction.
Logical host-home/global-filesystem/other-repository/SSH/credential/production
secret/deployment zones are denied. Shared system protections are reused,
including nested `.git`, `node_modules`, `.next`, `.env` and `.npmrc`; credential
directory/key segments are denied too. No laptop-specific absolute paths exist.

Git mutation, protected-branch changes, merge/push/force-push/tag/release/deploy,
credential/remote/host-config changes, financial actions and privilege expansion
are fixed forbidden actions. Only existing restricted verification-command
grammar is accepted: exact allowlisted npm verification scripts, bounded
`node --test tests/...test.mts`, or `git diff --check`, further narrowed to exact
configured argv/cwd/environment/time/output profiles. No shell, eval, arbitrary
executable, runtime command expansion or model-selected flags. Environment is
explicit (`CI=1`, `NODE_ENV=test` only); inherited host environment is forbidden.

This is lexical admission, NOT containment: npm/test scripts can run arbitrary
code. Future runtime must pin/revalidate scripts and baseline, contain process
trees, prevent symlink/hardlink/mount escapes, protect Git and metadata, and
enforce real filesystem and executable access. Policy allow is never permission
to run these commands on the unisolated host.

## Network, secrets and limits

Network Contract v1 defaults to explicit `deny_all` with empty destinations.
Missing/malformed network policy denies. Canonical `allowlisted` is an allowlist,
never unrestricted Internet. Each destination is `{scheme:"https", hostname,
port}`. Only HTTPS over TCP/TLS is supported: HTTP, SSH, Git, FTP, UDP/QUIC and
all other schemes/transports deny until a separately versioned extension.
The field is a structured destination, not a URL, path or query authority.
Scheme must be exact lowercase `https`. Hostnames are ASCII DNS labels,
case-insensitive and normalized to lowercase; exactly one final DNS root dot is
removed. Empty labels, multiple trailing dots, wildcards, userinfo, URLs, paths,
invalid labels and all IP literals (including numeric aliases) deny. Matching is
exact host identity, not substring/suffix matching. Duplicate rules after
canonicalization deny. Omitted HTTPS port means 443; explicit port must be an
integer 1..65535. Port 8443 is a different destination requiring its own grant.

Redirects ALWAYS deny in v1, even to another allowlisted origin. Future adapters
MUST disable automatic redirects, including hidden SDK/library retries that
change destinations; they cannot inherit permission from an initial URL.
The exported `sandboxNetworkContractV1` fixes these normative rules; caller
fields cannot relax them.

For every connection, future adapters MUST authorize the destination, resolve
only that allowed hostname, validate ALL returned addresses, and pin/revalidate
the actual connected peer to that validated answer set. Mixed public/private
answers deny the whole request. Re-resolution, new connections and connection
reuse must not bypass this check. TLS certificate/hostname verification must
remain enabled; hostname/SNI must be the authorized canonical DNS name. DNS
rebinding, proxy CONNECT redirection and peer changes cannot grant internal
access. If resolution/peer/TLS evidence is missing, stale or ambiguous, deny.

Only public unicast peers are eligible. Loopback, link-local, unspecified,
multicast, private/ULA, CGNAT, documentation, benchmark, reserved, IPv4-mapped
IPv6 and translation/tunnel addresses deny. The pure probe uses a conservative
IPv4 subset (excludes 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12,
192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24,
203.0.113/24, 224/4 and 240/4), and IPv6 only within 2000::/3 excluding
2001::/23, 2001:db8::/32, 2002::/16 and 3fff::/20. The Azure platform service
address 168.63.129.16 also denies. This intentionally excludes some otherwise
routable special-purpose addresses; exceptions require explicit contract review.
Future platform policy MUST additionally deny its own metadata/internal-service
addresses and destinations, including globally formatted addresses. The fixed
table is a safety floor, not a substitute for that current platform policy.

`evaluateNetworkAccess(spec, destination, evidence)` is a pure contract probe.
Evidence is separately trusted adapter data: all resolved addresses, actual
connected address, `redirected:false`, `tlsHostnameVerified:true`, and current
`platformPolicyAllows:true`. There is NO default-true platform/TLS assessment.
The probe normalizes IP spellings and requires the peer in the validated set;
it does no DNS/TLS/connection work. Caller/model-supplied booleans are not proof.
Even an allow is `policy_only`, `runtimeDispatchAllowed:false`, not egress
authority. Physical enforcement, freshness, authenticated evidence, pinning and
atomic connection checks remain future adapter obligations, not implemented here.

Secrets are `none` or explicit refs to trusted execution-scoped, unexpired
ephemeral metadata. No values, host environment, automatic `.env`, production
DB/provider/deployment or exchange credentials. Approval cannot upgrade a ref
into production credential access. Future composition is responsible for
classifying/issuing refs and safe injection; this module never reads a secret.

Numeric ceilings (also narrowed by policy) are wall-clock 3,600,000 ms,
CPU 8,000 milliCPU, RAM 16,384 MiB, disk 32,768 MiB, command 120,000 ms,
aggregate log/output 8 MiB and diff/report total 8 MiB. Per-command timeout/output
and run-wide aggregate log limits are checked on recorded evidence. At most
16 command records, 64 journal events and 3 cleanup attempts. These are bounded
contract limits, not OS enforcement. `sandboxExecutionCapabilities` explicitly
reports runtime, store, physical cleanup, network and resource enforcement
`not_implemented`; **every decision has `runtimeDispatchAllowed: false`**.

Changed-file count has one normative maximum:
`sandboxExecutionPlatformLimits.maxFiles=64`. Requested `artifacts.maxFiles`
must be 1..64 and is admitted unchanged as the effective execution limit.
Completion parses/checks observed paths against THAT effective limit, not a
separate 32-item collection default: 64/64 is valid, 65/64 denies, 13/12 denies.
`maxPathRules=32` separately bounds scope-rule collections, not changed files.
Nothing truncates an over-limit result or widens an undersized requested budget.

## Persistence, concurrency and replay

The entire versioned snapshot (including immutable spec, admission, journal,
commands, terminal result and cleanup) is the proposed durable unit. Restart
validation replays every bounded event and compares the whole rebuilt snapshot;
tampering with state, command records, revision or fencing alone is rejected.
Trusted storage integrity is still required: a fully fabricated but internally
consistent journal is not authenticated by a hash. Historical restore checks
schema/canonical spec, event coherence, recorded authority/time/generation,
revision and fencing; it does NOT re-admit the historical spec against today's
policy/grants/baselines/secret registry. It remains scoped to the factory workspace.
This preserves trusted recorded history after policy rotation or removal of
active projects/grants/commands/secrets. A trusted store must preserve original
admission evidence and resource-generation ownership; restore alone does not
prove original policy authorization. The unshipped pre-corrective candidate
snapshot shape is not a persisted compatibility contract or a migration target.

Every live `create` or execution `apply` (including an exact replay) checks
CURRENT admission plus active execution authority before returning an execution
proposal. Historical validation is NEVER execution permission. Policy/approval
revision changes or narrowed scope deny continuation and policy helpers. Current
control authority can cancel/block without restoring execution permissions.

Successful creation/transition returns `writeCondition` with workspace/execution,
resource generation, expected revision and expected prior-snapshot fingerprint (null means absence),
plus `newEvents`. A future PostgreSQL adapter MUST reuse PAC transaction helpers,
row locks/conditional updates, tenant boundaries and uniqueness constraints to
atomically commit exactly that snapshot plus audit under that condition. Unique
workspace/execution and scoped worktree ownership are required. Do not use Redis
as source of truth, introduce advisory/session-local locks, perform external work
inside a transaction, or acquire a second pooled connection inside one.
Admission-denied evidence must also be durably attributed to the authenticated
request without persisting hostile input. No migration or adapter is added here.

Two workers evaluating the same prior snapshot can both receive proposals with
the SAME CAS condition; these are NOT acquired leases. Only one may commit.
The loser must reload and fail closed, never execute its uncommitted proposal.
Matching owner, revision, fence, active authority and unexpired lease are required
for execution-worker transitions. Control cancellation/block can use newer revoked
authority; generation cannot regress. Cleanup uses a separate authority below.
No automatic takeover or renewal is implemented.

Command IDs bind full canonical action, expected revision, fence, spec fingerprint,
actor and generation (trusted evaluation time may advance). Exact replay returns
the current restored snapshot without a write condition/new event; changed
payload under that ID conflicts. Replays never authorize redispatch. Factories
have no mutable execution registry; future store uniqueness, not factory memory,
prevents duplicate environments. Restart, controller retries and worker races
require reloading the authoritative stored snapshot and current orchestration
facts. There is no automatic replay of an unresolved command.

## Cleanup and next gate

`cleanup.mode=always` applies to every terminal state. Claim/finish are bound to
exact logical worktree, owner and fence. Repeated identical finish is a no-op;
wrong execution/worktree or old fence denies. At most three explicit attempts
after factual cleanup failure; no takeover of a running cleanup after a clock
jump. A crash during cleanup requires separately designed recovery/manual
reconciliation, never guessing that deletion finished.

`applyCleanup` accepts ONLY begin/finish cleanup. `SandboxCleanupAuthority` is
separately obtained from CURRENT trusted resource ownership facts: exact
workspace/project/execution/worktree, immutable `resourceGeneration`, original
spec fingerprint, actor, monotonic control generation and expiry/time. It does
not carry execution-active flags, policy grants, file/network access or secrets.
The execution `apply` method rejects cleanup actions and rejects cleanup-authority
objects; the cleanup API rejects all execution/control actions. Success is tagged
`authorityScope:"cleanup_only"`, with no normalized command or runtime capability.

Cleanup-only restore remains usable under policy v2 for resources created under
v1, even if active grants disappeared. A nonterminal execution must first be
cancelled/blocked via current control authority; cleanup cannot rewrite its
outcome. `completed + cleanup_failed` remains completed, with the same result
and terminal timestamp. Scope/rules from a returned historical snapshot are NOT
new execution permissions. Resource-generation or fingerprint mismatch denies,
including an old cleanup request targeting a reused worktree/new attempt.
Cleanup also requires current revision/fence, exact worker ownership on finish,
unexpired cleanup authority and monotonic control generation. Replay binds the
cleanup resource proof and emits no new write/event.

Future store/start/delete fences MUST obtain fresh authoritative resource records
and compare current generation/owner/fingerprint under the CAS transaction before
any physical stop/delete. A stale previously issued cleanup decision is not a
delete capability. The contract does not authenticate the plain authority object
or implement that store/fence. Resource generations must not be reused for the
same logical worktree within a workspace. No physical resource paths/IDs are
accepted from model output, and no cleanup authority creates a new environment.

Future physical cleanup must prove containment and process termination, retain
bounded evidence outside the disposable worktree, and never delete another
execution. Current `cleanup.completed` is validated evidence supplied by trusted
composition, not a filesystem operation. Contract/schema persistence, physical
worktree/container launch, resource/network enforcement, secrets injection,
artifact inspection, durable leases and crash recovery remain unimplemented and
require separate tasks/gates. AI-042.2 worktree work is not started by this slice.

No existing executor/provider/tenant/auth/API/UI behavior changes. No provider,
OAuth, inference, deployment, Git mutation or production dispatch is enabled.
