# Local developer handoff v1 — AI-040a (IN REVIEW)

This is a local Owner-operated CLI, not an executor, runtime, sandbox or approval system. It does not invoke Codex/Claude, OAuth, inference, providers, DB, Git writes or UI. The human hands the task artifact to the chosen executor, obtains a working-tree change and a report, then requests verification. Only an external Owner/reviewer decides what happens next. `ready_for_owner` is NOT approval.

Implementation lives in `lib/local-handoff`, separate from the AI-039 planning-only `lib/development` directory. Its only application entry point is the local script; planning/Owner UI imports remain unchanged.

## Usage

Run from the clean target repository (or pass `--repo`). The PAC script can also inspect an independent local repository. Output parents must exist; output directories must be new, outside the source repository, and not symlinked. Nothing is overwritten. Default names are deterministic temporary-directory names based on baseline HEAD and task ID; choose a fresh `--out` for repeated reviews.

```sh
npm run development:handoff -- prepare --spec /tmp/task-spec.json --out /tmp/pac-handoff
# Owner manually gives task-artifact.md to the selected human-operated executor.
# Executor edits the working tree only; it must not commit/stage or alter external evidence.
npm run development:handoff -- review --manifest /tmp/pac-handoff/handoff-manifest.json --report /tmp/executor-report.md --out /tmp/pac-review
```

CLI stdout contains only `{status,reasons}`. Exit 0: prepared/ready_for_owner; exit 2: blocked/invalid input. There is no execute stage. Reports are text evidence, never interpreted or trusted as verification.

## Spec v1

All keys below are required; unknown keys, proxies/accessors, cycles, unsafe paths and excessive input are rejected. Use the existing FeaturePlan schema, not a second planning system. Plan must already be approved/in_progress and the selected task eligible under `evaluateDevelopmentTaskAdmission`. `taskOwnerApprovalGranted` is an explicit LOCAL operator assertion for this handoff, not a DB-backed approval or future execution authority.

```json
{
  "schemaVersion": 1,
  "pathSelectionMode": "manual",
  "selectedExecutor": { "mode": "human_operated", "label": "codex" },
  "taskId": "task-a",
  "context": "Local implementation context",
  "expectedHandoff": "Patch and report; Owner decides",
  "repositoryAllowlist": ["lib", "tests"],
  "completedTaskIds": [],
  "activeTaskIds": [],
  "taskOwnerApprovalGranted": true,
  "plan": {
    "id": "plan-a", "title": "Plan A", "goal": "Deliver A", "status": "approved",
    "tasks": [{
      "id": "task-a", "sequence": 1, "title": "Task A", "goal": "Deliver a bounded change",
      "scope": ["One feature"], "nonGoals": ["No external calls"],
      "allowedPaths": ["lib/example.ts", "tests/example.test.mts"],
      "acceptanceCriteria": ["Tests pass"],
      "verificationCommands": ["npm run lint", "npm run typecheck", "npm test", "npm run build"],
      "dependencyIds": [], "riskLevel": "low", "priority": "P3", "requiresOwnerApproval": true
    }]
  }
}
```

Discovery mode is read-only: PREPARE denies it with `explicit_owner_approved_paths_required`. Paths reuse PAC normalization/containment/system-forbidden policies, plus a deliberately narrow portable filename alphabet `[A-Za-z0-9._/-]`. No absolute paths, glob, traversal, home alias, scheme or shell expansion. Forbidden paths include `.git`, dependency/build trees and credential files. Directory approvals include descendants; a file approval does not include a similarly prefixed sibling.

## Evidence schemas

`handoff-manifest.json` (schemaVersion 1, policyVersion `ai-040a.v1`) contains task identity, inert executor metadata, factual baseline branch/HEAD and SHA-256 of canonical local root + Git directory (no raw root), normalized paths, required command sequence, task artifact filename/hash/size, normalized spec, and `ownerDecisionRequired: true`. The existing `createCodexTaskArtifact` supplies `task-artifact.md`; its full output is re-derived and compared during REVIEW. This is integrity checking, NOT a signature. Owner must protect the entire external 0700 directory/0600 artifacts from executor access; an actor able to rewrite the manifest and artifact together is inside the trusted boundary.

`review-package.json` is canonical; `review-package.md` is a safe projection, not an HTML/Markdown rendering of executor claims. Package sections: identity, scope (approved/actual/unauthorized paths, policy result), artifact filenames/SHA-256/byte sizes, ordered verification records, security results/findings, sorted reason codes, outcome, and Owner gate. Artifact metadata is null where capture/scan did not succeed. Tracked and untracked text diffs, deletions and rename endpoints are captured without staging; rename evidence is deterministic delete/add. Binary/non-regular/symlink/hardlinked objects block. A staged index blocks. Invalid manifests return only a safe blocked result, since trustworthy package identity cannot be constructed.

Canonical JSON is written last; incomplete publication cannot leave a canonical ready package. Output failure stays blocked and may leave incomplete files for manual recovery; it never deletes caller data. Artifact hashes bind EXACT bytes. Required command order is stable, deduplicated and includes `git diff --check`. Files/paths/reasons are sorted. Durations use an injectable trusted clock; incidental native Node-test timing in logs is replaced by `[clock]`. Other subprocess output can contain its own time-dependent information; identical factual outputs and clock produce identical packages.

## Verification grammar and limits

Only exact `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:pg`, `git diff --check`, or `node --test tests/name.test.mts [tests/other.test.mts ...]` are supported. Targeted tests have at most 16 relative, normalized, non-forbidden paths under `tests/`. Operators, assignments, extra flags, shells and all other commands are unsupported and block. No fallback.

`spawn` uses fixed executable/argv and `shell: false`; timeout kills the verifier process group on POSIX. Required checks all must pass: passed/failed/timed_out/unsupported/not_run are distinct. Overflowed logs are withheld, not presented as complete. Native command failures cannot be overridden by report claims. Baseline is checked before each verifier and after all checks; final status/index/patch comparison blocks worktree changes during verification.

- JSON spec/manifest: 256 KiB, depth 10, 10,000 inspected nodes, 64 members per object/array.
- Changed files: 64; each current/baseline text file: 256 KiB; complete patch: 2 MiB.
- Executor report: 128 KiB; each stdout/stderr: 16 KiB; at most 32 checks (includes mandatory diff check).
- Verifier timeout: 120 seconds per command by default; trusted composition can bound it to 1–300,000 ms. Git evidence commands: 10 seconds.

Capture rejects NUL/invalid UTF-8 and unsafe filesystem objects; reads use no-follow/nonblocking opens, inode and size/mtime checks. A complete patch is never silently truncated. Probable-secret checks inspect high-confidence VALUES (private-key headers, known provider/GitHub/Slack token prefixes, credential URLs); field names like `access_token` do not match. Personal home paths also block public artifact capture. Matched secrets never enter diagnostics or copied change/report artifacts; only safe category/path/count metadata is returned. Filenames are scanned before scope metadata publication; secret-bearing filenames are withheld. Verifier logs redact inherited environment values and known secret patterns; truncated logs are withheld. This is NOT complete secret classification/DLP.

## Trust assumptions / deferred hardening

Stop other writers/executors while preparing/reviewing. Local root, toolchain (`git`, `node`, `npm`, PATH), plan/allowlist, clock and composition options are Owner-trusted. npm scripts and test code run locally and are NOT sandboxed; run only trusted checks. Fixed argv prevents shell injection, not side effects hidden inside scripts. Filesystem observation is not an atomic snapshot against a malicious concurrent local writer; checks fail on observed drift, but full isolation belongs to ExecutionEnvironment. Ignored generated files are not review evidence. No external credentials should be placed in the spec/report/source.

Deferred: ExecutorAdapter/Router (AI-041.0+), durable executor persistence, full Quality/Security Gate, isolated ExecutionEnvironment, concurrency across executors, AI-040b UI, DB-backed Owner decisions, commit/push approval and PRs, remote/VPS execution, subscription inference, and AI-039.2 initial `invalid_grant` recovery. M4 is not DONE.
