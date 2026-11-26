# PAC-PLAN-03B.1 — deterministic project planning generation candidate

Baseline: `a4e91cd29fffb7f064e4272155e3210f320b4ec4`, branch `feature/development-agent-module`. Owner Amendments 01–04 applied. Author report, not an independent gate verdict.

## Result and changed files

Authorized exact Knowledge → reviewed offer → explicit Owner consent → immutable generation/source rows → existing persisted Workflow Runtime → ModelProvider health/preflight → existing ledger/reservation/provider-start fence → deterministic provider → atomic usage/raw-result persistence → strict project proposal validation → authorized durable read/replay.

New files:
- `lib/composition/project-planning-generation-config.ts`: deterministic-only finite policy validation, calendar-date checks and explicit ordered six-field identity fingerprint.
- `lib/composition/owner-project-planning-generation.ts`: server/test-only composition and non-renewable attempt evidence. No production/UI/HTTP binding or credential resolver.
- `lib/planning/project-planning-generation.ts`: project Owner boundary, canonical request/offer/source provenance, audited authorization/settlement and review-only projection.
- `lib/planning/project-planning-generation-run.ts`: one-step, one-attempt proposal-only workflow and canonical invocation fingerprint derivation using existing contracts.
- `db/migrations/0025_project_planning_generation.sql`: immutable request/manifest, exact source FKs, contiguous source indices, bounded consent lifetime, transactional evidence guards and pinned factual invocation/result binding.
- `tests/project-planning-generation.test.mts` and `tests/pg/project-planning-generation.test.mts`: policy/evidence/output and real-runtime deterministic-provider integration coverage.

Modified `lib/planning/project-planning.ts` only to extract authorized immutable preparation. Updated `docs/architecture/project-planning-v1.md`. Five existing migration test files changed exclusively as authorized in Amendments 01–02; historical names/hashes and all security assertions preserved. No shared runtime/auth/provider contracts or historical migrations changed.

## Authority and finance

Consent immutably records original identity, authorization/absolute-expiry timestamps, canonical manifest, reviewed offer, effective policy and factual invocation fingerprint. The offer covers every price/model/destination/token/cost change. Authorization re-reads sources and recomputes policy under the original identity/Owner/active-project locks. Current authority/policy are rechecked before advance and before evidence issuance.

Attempt evidence records first trusted attempt validation time; original authorization is not renewed. Original ten-minute consent lifetime is independently bounded; evidence expires exactly at the original expiry and is latched, never refreshed. Source/runtime fingerprints, full identity and run/revision/step/attempt/model-profile bindings are checked before delegation. Replay/restart cannot reconstruct invocation authority. No caller clock is exposed by the generation composition.

All spending logic is inherited from the existing runtime. Different generation operations share a stable workflow binding and cannot reset aggregate windows. The factual existing scope is workspace + project + workflow binding + UTC window; FeaturePlan accounting is a separate binding, not a shared cross-purpose cap. This is explicitly tested, not represented as a workspace-wide ceiling. Preflight is deterministic; real metered preflight is outside this candidate.

Output uses duplicate-aware JSON parsing and the unchanged strict `pac-project-plan/v1` validator against exact selected-source indices. Invalid output remains durably charged and never becomes a proposal. Normalized plan/raw-output fingerprints are rechecked on read. No approval, ProjectTask, queue, executor or repository mutation is introduced. Manual import/approval regressions remain passing.

## RED/GREEN and checks

Evidence directory: `/private/tmp/PAC-PLAN-03B.1/`.

- `red.log`: initial baseline test failed because generation module did not exist (scaffolding RED, not claimed behavioral proof).
- `behavioral-red.log`: relocated candidate with the original defective `decidedAt=authorizedAt` behavior fails the unchanged consent-before-attempt test on the timestamp assertion; no production source mutation. Actual shared-contract probe additionally demonstrates `evidence_before_attempt` for that original timestamp.
- `green-focused.log`: 42/42 focused generation/manual-planning/FeaturePlan/migration unit tests passed. `boundary-regression.log`: 43/43, including unchanged task-authority dependency assertions.
- New PG suite: 10/10. One/four sources, real runtime, exact replay/restart, current policy/identity/source refusal, malformed output, concurrent aggregate exhaustion, distinct cross-purpose accounting, unknown outcome, audit/result-write/settlement-ACK/snapshot faults, original identity substitution, immutable provenance, historical Knowledge versions and raw-result tamper detection.
- Existing affected PG suites: project planning 32/32; FeaturePlan planning 9/9; deployment migrations 8/8; executor identity 37/37; executor constraint 19/19.
- Final additive migration + generation combined verification: 18/18. `migration-integrity.log` proves all 24 historical SQL files equal baseline bytes and 25 contiguous migrations are discovered.
- `npm run lint`: exit 0, one pre-existing unused-variable warning in FeaturePlan revision tests.
- `npm run typecheck`: exit 0.
- `npm test` final: 3511/3512 passed. Sole failure is the unchanged runtime metadata assertion: local Node 24.13.1 versus required 24.22.2. Previous dependency-boundary failures were corrected without modifying their assertions; final full suite confirms they pass.
- `npm run build`: FAILED; existing next/font cannot fetch Google Geist/Geist Mono in the restricted environment. No font, runtime version, dependency or assertion workaround made.
- `git diff --check`: exit 0.

No successful build or completely passing full unit suite is claimed. Owner explicitly permits recording the known Node/font limitations; independent review must account for them.

## PostgreSQL isolation and cleanup

PostgreSQL 16.15, existing local binaries. Dedicated cluster `/private/tmp/PAC-PLAN-03B.1/pg-data`, role `pac_plan_test`, private socket and loopback-only port 55439. Before each regression invocation, the harness verified exact directory, stable system identifier, server version/port, expected maintenance role/database and actual loopback address/listener. Environment was cleared of application DB/provider secrets. Existing PG harness created only unique `aipc_pgtest_*` databases in that cluster and dropped them. Final inventory contained only postgres/template0/template1.

`pg-verification.log`, `pg-databases-before-cleanup.log` and `cleanup.log` preserve evidence. Cluster stopped; PID/socket absent; port successfully rebound and immediately closed; temporary data/socket directories removed. No existing PAC/dev/production target was used. No real provider, paid inference, dependency install, commit, push or deployment.

## Remaining limitations

Deterministic-only backend candidate; no UI action or live model binding. No claim of precise project/identity revocation fencing at provider-start; a real binding requires separate acceptance. No global cross-purpose financial cap. Prices are configured policy assertions, not externally verified billing guarantees. Ambiguous/crashed requests remain recovery_required; this package never automatically re-dispatches, reconciles uncertain commits into success, or introduces a new recovery executor. Existing durable results/ledger remain available for separately authorized operator recovery. Approval of a generated proposal and approved-plan replacement remain later tasks.

`runtimeDispatchAllowed=false`; generic production/live development dispatch remains BLOCKED. F2/F3 untouched.

READY FOR RE-GATE

READY FOR INDEPENDENT REVIEW

## Corrective 01 — initial INSERT lifecycle fence

Preliminary review identified that the original 0025 lifecycle trigger ran only for
UPDATE/DELETE. A direct terminal INSERT could satisfy state/source/audit constraints
without passing factual invocation/result validation. This was reproduced against the
approved candidate patch `df8ef5fd699a56d434ac0f0aca1756539484bbac322737c9ca3245f06a2614c5`.

Behavioral RED (`/private/tmp/PAC-PLAN-03B.1-CORRECTIVE-01/red.log`): unchanged SQL accepted
all six terminal statuses, including proposal_available and invalid_output, with valid
state fields, exact source FKs and both matching audit events but a nonexistent Run.
Six rejecting subtests failed; the started control committed. No triggers or constraints
were disabled for this attack. This demonstrates committed terminal insertion, not
merely a statement accepted before deferred validation.

Correction changes only unreleased migration 0025, its candidate PG test and this QA
report. The existing trigger now fires BEFORE INSERT OR UPDATE OR DELETE; its INSERT
branch requires status=started and returns through the existing state constraints and
deferred source/audit guards. All former UPDATE/DELETE and factual result checks remain
unchanged. Historical migrations 0001–0024 retain exact baseline bytes. No shared runtime,
contract or discovery logic changed.

GREEN: same unchanged lifecycle tests pass for started plus six rejected terminal
statuses (SQLSTATE 23514). Full generation PG suite 18/18 passes, including the ordinary
authorized one/four-source lifecycle. Deployment migrations 8/8 passes.
`tests/pg/workflow-runtime-real-provider.test.mts` WAS executed in Corrective 01:
44/44 passes using its injected fake SDK only. It was not in the original candidate's
recorded PG suite list; no earlier execution is claimed.

Corrective checks: lint exit 0 (same pre-existing warning); typecheck exit 0; full unit
3511/3512 passes, sole unchanged Node version mismatch (24.13.1 vs 24.22.2); build fails
on existing restricted Google Fonts fetch; diff-check passes. Known environment failures
are not counted as passing checks. No provider network, dependency changes or test
weakening. Current dispatch restrictions remain unchanged.

A fresh isolated PostgreSQL 16.15 cluster used role pac_plan_test, dedicated port 55439
and private socket in `/private/tmp/PAC-PLAN-03B.1-CORRECTIVE-01/`. Exact directory,
system identifier, version, role/database and loopback address/listener were verified
before each suite. Only unique temporary test databases were created; final maintenance
inventory contained postgres/template0/template1. Cleanup confirms stopped process,
absent PID/private socket, deleted cluster/data directory and a successful bind/close
proving port 55439 free. Cleanup and identity logs accompany the revised artifacts.

Corrective artifacts: `/private/tmp/PAC-PLAN-03B.1-CORRECTIVE-01/`. Updated full candidate
patch, external REPORT.md and ARTIFACTS.sha256 are also provided at the original
`/private/tmp/PAC-PLAN-03B.1/` delivery location. Patch digest is stored in the external
report/manifest to avoid a self-referential repository report hash.

READY FOR RE-GATE — author does not declare the independent gate passed.

READY FOR INDEPENDENT REVIEW
