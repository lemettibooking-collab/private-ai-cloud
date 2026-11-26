# PAC-DEV-02 E-01 — Owner review candidate

Not executed; E-01 remains open. runtimeDispatchAllowed=false. No production binding.

The dedicated manual-only workflow uses Ubuntu24.04, exact Node24.22.2/npm11.8.0,
existing package-lock via npm ci, and runner-installed PostgreSQL16 binaries. It
creates its own Unix-only cluster as the runner user; no Docker, sudo/service
mutation, production DB, secrets, provider or executor integration is configured.
Only checkout and artifact access are used, with contents:read and no persisted
checkout credential. Dependency/font retrieval is normal CI network access.

## Original evidence, not substitute tests

Copied from the intact /private/tmp/PAC-DEV-02 author evidence (all34 manifest
entries and633 source hashes verified before packaging):

| Packaged file | Original | Exact SHA-256 |
|---|---|---|
| integration.original.txt | integration.test.mts | 10838a242e149b4be52bed5bdb4bed0d0e5303bf98eec57e99cc071f4b3d5211 |
| SOURCE.sha256 | SOURCE.sha256 | 62af90f961758fc18cf49c0c0ef11109efa4468aacbb1f1e01543f42b1312bc8 |
| focused-pg-command.txt | focused-pg-command.txt | 517e46f5a9feb2f45c22badb0ed9aaa531b53152f5199639da868cc6e83b519a |

The original harness is stored as .txt so lint/typecheck do not accidentally treat
its historical Mac-only imports as a new repository test. The runner verifies
all three pinned digests and all633 original source files (including29 unchanged
migrations), allows only this six-file CI bundle beyond baseline94306785, and
requires clean tracked/untracked/index state. Its only transformation is replacing
14 literal original Mac file-URL prefixes with the checkout file-URL prefix; a
reverse byte comparison is required. Test assertions, dynamic imports, fake ports
and server-only sentinel are untouched. Original and relocated digests/content
are saved. The unchanged original focused command runs the same eight PG suites.

## Evidence and cleanup

The runner records command argv/exit codes, exact toolchain, baseline/candidate/tree,
all npm logs, original/relocated harness, real6/129 test counts with no skips,
PostgreSQL identity and SQL database inventory. It runs lint/typecheck/unit/build
independently even if a prior check fails, then both original PG suites. A failing
suite/count is never PASS. Unexpected preparation failures stop execution and are
recorded. All child processes receive only an allowlist of ordinary process
settings; no production DATABASE_URL, LIVE_PG overrides, NODE_OPTIONS, provider/API
credentials or Actions token is inherited. No .env credential file is accepted.

An always() finalizer checks the owned test database inventory, stops the owned
cluster, deletes only owned data/socket directories after stop, records absent
resources, seals/validates ARTIFACTS.sha256, and fails if verification or cleanup
was incomplete. An always() upload retains evidence30days, including failure logs.
Hard runner termination/cancellation may prevent finalizer execution; absence of
cleanup.json or successful cleanup is NOT evidence of cleanup or acceptance. No
workflow step itself declares independent acceptance.

## Activation requires separate Owner authorization

This is a local review branch and uncommitted patch only. No push, workflow dispatch,
PR, merge or default-branch change is authorized by preparation. Review the patch
first. GitHub documents that workflow_dispatch requires the workflow on the default
branch; a new branch-only workflow may not be registered/discoverable. Publishing
or making this new manual workflow dispatchable requires a separate Owner-approved
release/registration decision. Do not silently merge it into main or add an automatic
push/PR trigger to work around that prerequisite. After it is registered and
approved, dispatch the reviewed branch/SHA and independently verify its artifact
manifest and gate/cleanup results. Until actual evidence exists, E-01 and final
PAC-DEV-02 acceptance remain CONDITIONAL. PAC-DEV-03 is not included.

References: GitHub [workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch),
[Ubuntu24.04 image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md),
[setup-node](https://github.com/actions/setup-node), [upload-artifact](https://github.com/actions/upload-artifact).
