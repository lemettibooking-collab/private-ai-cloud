# PAC-PLAN-03B.2 — Owner UI & Project Planning Integration

Baseline: feature/development-agent-module, HEAD 3a2a07e571713afb0e56184379b9e8602a1bdd7b.
Author implementation report; independent gate has not been declared passed.

## Delivered behavior

Existing Planning page now separates manual import from a generation section without navigation changes. The existing multi-source selector is shared. Trusted injected tests exercise canonical Knowledge selection -> prepare -> server-generated operation key -> reviewed offer -> explicit consent -> accepted persisted deterministic runtime -> strict validated proposal -> durable read/reload. Production composition supplies no backend/provider/policy for generation, has no environment bypass and fails closed after server-resolved Owner authority. Production can perform authorized durable reads through the accepted request service without constructing a provider.

FormData allows only exact operation-specific fields; rejects duplicate application fields, files, unknown/authority/provider/body fields, invalid IDs, fingerprints/keys and duplicate-aware malformed JSON selectors. Source selectors retain the existing 2048-byte/four-source bounds; every application field is <=2048 UTF-8 bytes, metadata values <=16384 and total text keys/values <=32768. Framework action metadata never becomes domain input. The existing form helper bounds entry counts/names. Original session and workspace are obtained on the server. Operation keys are random pp-[32 hex] identifiers, not access credentials.

Successful injected prepare returns only reviewed public offer data. UI displays exact canonical filename/version/SHA, preparation/offer fingerprints, all six pinned identity fields, simulation status, destination, token/cost ceilings and project/workflow/UTC-window allowance scope. It explicitly distinguishes simulated accounting from paid inference and from a global workspace cap. Consent is unchecked and disabled submission until checked. Selection remounts the offer and consent. Submission disables further generation and freezes selection; idempotency remains enforced by the accepted backend. Pending does not assert provider execution.

The same operation key is retained in submission/result/read forms and written into the current page URL before generation dispatch. A reload pre-fills an explicit read-only retrieval form; render/reload never invokes generation (nor implicitly reads). Uncertain operations show recovery_required with a read path, without an automatic retry/new-key/regeneration action. Read reauthorizes the same project and returns existing validated durable state only. Operation identifiers cannot bypass Owner/project/original-identity checks.

Proposal title, count and all task fields render escaped text; references resolve against stored canonical filename/version/hash manifest. Failure states and consent have EN/RU copy. Generated proposals never call manual save/approve, create tasks, approval requests, FeaturePlans, business queues or repository operations. Existing manual actions and assertions remain unchanged. runtimeDispatchAllowed=false.

## Exact changed paths

- app/projects/[projectId]/planning/page.tsx
- app/projects/[projectId]/planning/actions.ts
- components/domain/owner-console/project-planning-forms.tsx
- lib/composition/owner-project-planning.server.ts
- lib/composition/owner-project-planning-generation-action.ts (new trusted transport seam)
- lib/planning/project-planning-form.ts
- lib/i18n/project-planning-copy.ts
- tests/project-planning-generation-ui.test.mts (new)
- tests/pg/project-planning-generation-ui.test.mts (new)
- docs/architecture/project-planning-v1.md
- docs/qa/PAC-PLAN-03B.2-REPORT.md (this report)

No migrations, accepted generation lifecycle, shared runtime/security, dependencies, historical tests or navigation changed. Public types live with planning transport; client code has no composition import. New forms are in the existing component module to preserve the existing direct TypeScript/React harness and its import boundary, without changing tests.

## RED / GREEN and UI evidence

External evidence directory: /private/tmp/PAC-PLAN-03B.2/.

Initial tests were written before implementation. red.log records the missing transport/composition module (scaffolding RED only). Behavioral-red evidence additionally runs the unchanged production-unbound behavioral test against an isolated copy with its production-unbound guard removed: expected production_binding_unavailable becomes recovery_required and the assertion fails. behavioral-red.log plus the isolated mutated source/test preserve that probe; repository production code was never mutated for RED.

focused.log: 97/97 pass, including unchanged manual planning, accepted generation policy, auth boundary, localization inventory and Owner read boundary tests. The new suite executes actual transport, trusted seam and compiled Server Actions/production composition, not just string assertions. React renders actual proposal/state components in both locales with malicious HTML and checks escaping and exact references. Callback tests exercise unchecked/checked consent, submit locking, persistent URL key and selection-driven remount. No action executes on render. Unknown internal/raw fields are omitted by explicit projections; all bounded failure statuses and thrown errors are sanitized.

New PG suite: 4/4 pass. It runs the real accepted project generation service with the existing PostgreSQL runtime and injected deterministic provider, through the new form/seam. One/four-source prepare creates no generation or provider call; double submission/exact replay invokes once; durable reload/read invokes no provider; changed offer/selection/policy, missing consent and foreign project fail closed. Production-unbound/denied session creates zero Run/provider calls. Invalid output and unknown outcomes remain terminal/recovery on read/replay. It checks no task/manual draft/approval/FeaturePlan or queued Run is introduced. Final raw evidence: pg-project-planning-generation-ui.log.

Affected existing PG regressions, final UTF-8 cluster:
- project-planning-generation: 18/18
- project-planning: 32/32
- feature-plan-planning: 9/9, injected fake SDK only

A preliminary new-PG test accidentally substituted an identical selector from another fixture; it was corrected to substitute a different SHA. The final assertion still rejects changed selectors. Existing assertions were not changed. A preliminary cluster initialized with locale C defaulted to SQL_ASCII; the existing Russian FeaturePlan fixture then failed its title check. Recreated only the disposable cluster with explicit UTF8 and reran all affected suites unchanged; all pass. initial-* evidence distinguishes that environment failure from final results.

## Verification and limits

- lint-final.log: exit 0, only the pre-existing unused-variable warning in FeaturePlan revision tests.
- typecheck-final.log: exit 0.
- unit-final.log: 3521/3522; sole failure is unchanged runtime metadata requiring Node 24.22.2 while local Node is 24.13.1. Not claimed PASS. Earlier sandbox run also hit loopback EPERM; final suite ran in a cleared environment with authorized loopback.
- build.log: FAILED on existing Geist/Geist Mono Google Fonts fetch. No font/dependency/test workaround. Not claimed PASS.
- diff-check.log: git diff --check exit 0.

No browser tooling was installed. UI evidence uses actual TypeScript-transpiled React render and callback harnesses, not a browser engine: browser layout, focus traversal, responsive viewport and actual browser FormData/React action scheduling were not independently exercised. Semantic labels, keyboard-native controls and live status announcements are present. This limitation and known Node/font failures remain for independent review; no successful production build is asserted.

The accepted backend's existing constraints remain: deterministic-only trusted injection, no exact project revocation fence at provider-start, configured simulated prices, workflow-scoped rather than global aggregate accounting, conservative recovery without redispatch. This task does not extend those guarantees or authorize a real model binding.

## PostgreSQL isolation and cleanup

Owner-authorized PostgreSQL 16 disposable target /private/tmp/PAC-PLAN-03B.2/pg-data, private socket, role pac_plan_test, loopback-only port 55440. verify-pg.py records exact data directory, stable system identifier per cluster, role/database, server version/port, loopback address/listener and final UTF8 before suites. Application/provider environment cleared. Existing harness creates/drops only unique aipc_pgtest_* databases. Final inventory is postgres/template0/template1. cleanup.log confirms stopped process, absent PID/socket, deleted data/socket directories and successful bind/close proving port free. Both initial and final disposable clusters stopped/deleted. No existing PAC DB was used.

No credential reads by the agent, real provider/OAuth calls, paid inference, dependency installation, VPS/production DB access, commit, push or deployment. Build only attempted its existing font fetch. F2/F3 deferred. runtimeDispatchAllowed=false.

READY FOR RE-GATE

READY FOR INDEPENDENT REVIEW

## Corrective 01 — early transport rejection and project lifecycle

Preserved candidate SHA-256 c5a9fadd11180b95811babb1786ed4a44ba7b7d6224bb66eb627be967bb04f99;
HEAD remains 3a2a07e571713afb0e56184379b9e8602a1bdd7b. Changes relative to that candidate
are limited to project-planning-form.ts, Planning page, existing planning forms,
new generation UI test and this candidate's architecture/QA documentation.

C1: projectGenerationForm now returns immediately on projectResourceFields rejection.
Behavioral tests instrument FormData.prototype.entries and assert zero subsequent
traversals, authorization and backend operations for 100 excess fields, null, plain
objects, proxy FormData and malformed branded-prototype inputs. Instrumentation is
restored in finally; no existing test was weakened.

C2: the page and generation wrapper key the generation instance by projectId.
Prepare keys include projectId and exact chosen source descriptors, authorization
keys include project/manifest/operation/offer, and read keys include project and
manifest/operation. React remounts discard old selection/locked state and descendant
offer/consent/submission/result state across project changes. Exact version/hash
changes invalidate the reviewed subtree even when selector state itself is retained.
Original operation links and their project IDs remain intact; identifiers in a new
project's read form confer no cross-project authority.

New regression tests execute actual compiled components and handlers, checking key
replacement with identical selectors across two projects, fresh unchecked/empty UI,
original-project durable links/read fields, project-scoped read identity, and changed
source version/SHA invalidating the reviewed subtree. These are React-element and
hook/render harnesses, not a browser reconciliation engine; browser navigation and
layout were not independently exercised. React's keyed remount semantics provide
the lifecycle reset. The existing selector/consent/submission/escaped-result tests
remain unchanged and passing.

Evidence: /private/tmp/PAC-PLAN-03B.2-CORRECTIVE-01/red.log records the same three new
tests failing on the preserved candidate (3 failures): 8 forbidden entries traversals,
identical null project keys, and an unchanged prepare key on source revision change.
green.log records 100/100 focused tests passing after correction, including unchanged
manual planning, generation, auth boundary, localization and Owner-read regressions.
Lint and typecheck exit 0; lint retains only the pre-existing FeaturePlan revision
unused-variable warning. git diff --check exits 0.

Full unit, PostgreSQL and build were not rerun for this bounded correction. Their
prior results above remain historical evidence, not new corrective PASS claims:
3521/3522 unit (known Node mismatch), PG 63/63, build FAILED on font fetch. No cluster
was started and no DB/provider calls occurred during Corrective 01; previous cleanup
remains valid. No dependencies, migrations, backend/security contract changes, commit,
push or deployment. runtimeDispatchAllowed=false.

READY FOR RE-GATE

READY FOR INDEPENDENT REVIEW
