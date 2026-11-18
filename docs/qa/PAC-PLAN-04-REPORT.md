# PAC-PLAN-04 — Generated Plan Approval & Task Materialization

Author status: READY FOR INDEPENDENT REVIEW. READY FOR RE-GATE.
The author does not declare an independent gate passed.
runtimeDispatchAllowed=false.

## Baseline and scope

Branch feature/development-agent-module; baseline HEAD 2e1812685ba8c5fb616225db81fcddf9cc53cc46. Baseline working tree was clean. All changed paths are within the supplied AllowedWritePaths. No historical migration, financial control, credential store, shared runtime, executor, dependency or public route was changed. Existing security assertions were preserved; existing test edits are migration inventory/count changes only.

Changed paths:

- `app/projects/[projectId]/planning/actions.ts`
- `app/projects/[projectId]/planning/page.tsx`
- `components/domain/owner-console/project-planning-forms.tsx`
- `db/migrations/0028_project_planning_generated_drafts.sql`
- `docs/architecture/project-planning-v1.md`
- `docs/qa/PAC-PLAN-04-REPORT.md`
- `lib/composition/owner-project-planning-generation-action.ts`
- `lib/composition/owner-project-planning.server.ts`
- `lib/i18n/project-planning-copy.ts`
- `lib/planning/project-planning-form.ts`
- `lib/planning/project-planning-generation.ts`
- `lib/planning/project-planning.ts`
- `tests/deployment-foundation.test.mts`
- `tests/deployment-migrations.test.mts`
- `tests/pg/deployment-migrations.test.mts`
- `tests/pg/executor-provider-constraint.test.mts`
- `tests/pg/executor-provider-identity.test.mts`
- `tests/pg/project-planning-generated-approval.test.mts`
- `tests/project-planning-generated-approval.test.mts`

## Implementation and transaction boundaries

0028 is additive: historical drafts default to manual_import. Manual source fields remain mandatory for manual origin and mutually exclusive with generated provenance. Generated drafts bind tenant/project generation, original requester, request/output/normalized-plan fingerprints, canonical manifest, exact immutable generation sources, validation version and original expected revision. SQL guards check factual succeeded invocation/output hash, normalized output equivalence, source fingerprint and generated save/decision audit evidence. Existing immutable lifecycle and single-active uniqueness remain in force.

The existing historical generation evidence reader was extracted into same-client functions. Generated save uses the existing Owner/project transaction; it checks original identity and current Owner authority, active project, proposal_available, stored policy at original authorization time, immutable sources and raw result hash, and complete normalized proposal. It creates one ordinary pending project_plan_activation approval plus immutable draft/audit. No credentials/current consent/current provider policy/new model operation are needed. Generation records are unchanged.

Both origins share project locking, revision sequence, ordinary approval request/decision validation and existing task materialization. Save replay requires identical selector/fingerprint/original expected revision. Durable proposal reload returns that original revision if already saved. Latest pending approval, historical pending rejection, exact decision replay and one approved plan remain. Task collisions, audit failures and lost acknowledgments fail closed; replay reconciles factual commits. Approved immutable plan preserves descriptions, criteria, scope, dependencies and multi-source references. Validated links expose source-task to ProjectTask mapping. No dependencies are enrolled in Roadmap, and no execution enforcement is claimed.

Planning UI adds explicit save from both immediate and durable views, origin/multi-source display, fingerprints, existing approval controls and resulting task links. Save forms are separate from generation/read forms. Project/operation changes remount or hide stale save controls. EN/RU strings and escaped proposal content are covered by actual component rendering. No browser E2E claim is made. Production generation remains unbound; simulation is labelled.

## Verification evidence

- Initial unit RED: missing saveGenerated causes failure on unchanged baseline.
- Final behavioral PG RED: 0/12 on isolated original baseline copy plus final generated feature tests; all twelve fail without implementation. The later populated-upgrade compatibility test is GREEN-only, separately identified.
- Affected PostgreSQL regression: 135/135, no failures/skips. Suites: generated approval, manual planning, generation, fake OpenAI binding, full-chain migration/replay, executor provider constraint and identity inventory.
- Final generated PG suite: 13/13, including actual populated 0027 to 0028 upgrade with approved/pending manual rows, byte-identical historical fields and valid historical decision replay/rejection.
- Focused unit: 58/58 (Planning/generation plus migration inventory). Includes generated selector rejection, actual mutation invalidation and EN/RU immediate/durable component rendering with separate forms and escaped content.
- Full unit: 3533/3534; sole failure is existing Node metadata mismatch, actual 24.13.1 versus required 24.22.2. Not a full-unit PASS.
- Lint: PASS with existing unrelated unused-variable warning. Typecheck: PASS. git diff --check: PASS.
- Build: FAILED fetching Geist/Geist Mono from Google Fonts. No successful build is claimed.

Behavioral evidence covers one/four sources, exact historical Knowledge hashes, sorted multi-source references and dependencies, invalid/unknown outcomes, forged project/fingerprint/source/output, original identity/current membership/project restrictions, save/decision races, mixed manual/generated revisions, stale approval and historical rejection, collision rollback, failed audit, lost commit acknowledgment, immutable SQL origin/provenance/terminal attacks and no duplicate tasks. Save/read/approval use no provider dependency; deterministic runtime invocation counters remain unchanged. Existing production-unbound regression coverage remains.

## Isolation and remaining limitations

All PG testing used an owned PostgreSQL 16 UTF8 cluster at loopback port 55446 under /private/tmp/PAC-PLAN-04. Identity, init/stop and cleanup evidence are retained. Harness databases from successful tests were dropped. One database from the initial migration syntax failure remained before shutdown; the entire owned cluster/data directory was then stopped and deleted, including that failed fixture. No existing PAC database was used. No production clock override, real credential, provider/OAuth call, paid inference, commit, push, deployment or VPS action occurred.

SQL provenance checking complements the application validator; it does not introduce a second general planning validator. Current project metadata/source availability and original identity requirements of existing generation evidence remain fail-closed. Dependency scheduling, clarification/plan replacement and live activation remain follow-up work. Physical provider dispatch timing and live-provider financial/security guarantees are outside this stage.

The complete review.patch and its SHA-256 are recorded in the external report and ARTIFACTS.sha256, avoiding a self-referential hash in this repository report.

READY FOR INDEPENDENT REVIEW
READY FOR RE-GATE
runtimeDispatchAllowed=false.

## Corrective 01 — generated numeric normalization (2026-11-18)

Owner authorized the former reviewer to implement this correction. A different independent reviewer must perform re-gate.

Added migration 0029 only; migrations 0001–0028 retain their original SHA-256 values. The generated draft guard now compares the full proposal after exact bounded source-reference binary64 normalization. No application validator, runtime, authority, financial, task materialization or provider path changed. Existing migration inventory assertions are extended to 0029 while preserving the 0028 assertion.

RED on the original candidate reproduces unavailable save for accepted `1.0000000000000001`. Final combined PG regression: 140/140; focused unit: 59/59. Tests include real deterministic generation, durable read, save, approval, replay, fingerprints, signed underflow/zero, midpoint rounding, huge exponents, long mantissas, duplicate/domain rejection, sorting, forged SQL references and populated 0028→0029 upgrade with old durable generation. Lint/typecheck/diff-check pass. Full unit with loopback permitted: 3534/3535, sole failure Node 24.13.1 versus required 24.22.2. Build FAILED fetching Geist/Geist Mono from Google Fonts. Earlier sandbox unit runs also failed local socket permissions; these logs are preserved, not counted as passing.

External evidence: `/private/tmp/PAC-PLAN-04-CORRECTIVE-01/`. Owned PG16 loopback cluster 55447 was stopped and deleted; no production DB or real provider used. No browser E2E or live-provider guarantee. Numeric helper is deliberately limited to indices 0–3 and the existing proposal byte bound; any future source-index/domain change requires revisiting the rounding cells.

READY FOR INDEPENDENT REVIEW
READY FOR RE-GATE
runtimeDispatchAllowed=false.

## Corrective 02 — Unicode persistence compatibility

Root title validation now rejects lone UTF-16 surrogates without altering valid
Unicode, existing title semantics or Corrective 01 numeric normalization. Historical
v1 fingerprint verification is separated from current persistence eligibility;
verified unsupported historical output returns a distinct non-saveable projection.
Raw output, generation status, original fingerprints and financial/audit evidence
are never rewritten. New invalid output uses ordinary invalid_output settlement.
Full evidence and environmental limitations: /private/tmp/PAC-PLAN-04-CORRECTIVE-02/REPORT.md.
READY FOR RE-GATE; author does not declare the gate passed.
