# AI-041.0 — ExecutorAdapter contract v1

Status: IN REVIEW. Supporting implementation document; `docs/ROADMAP.md` is authoritative. No real executor is connected.

## Boundary and trust

`lib/contracts/executor-adapter.ts` is a Node-only pure contract, separate from both the direct `ModelProvider` boundary and the human-operated AI-040a Local Handoff. It has no filesystem, process execution, provider SDK, network, persistence or UI port. It does not know vendor requests, model identities, credentials or billing.

Trusted composition calls `createExecutorAdapterContract(configuration)` with one declared adapter identity/capability set, a non-secret repository reference and a FeaturePlan/task admission snapshot. **Do not expose this factory as caller-controlled registration.** Identity means exact agreement with that configured adapter, not remote authentication. Capabilities are declarations, not independently discovered facts. This stage does not attest an executor's existence or honesty.

The factory reuses `validateAndNormalizeFeaturePlan` and `evaluateDevelopmentTaskAdmission`; draft plans, unapproved high-risk work, unfinished dependencies, active/completed tasks, overlaps and forbidden/out-of-scope paths fail closed under the existing policy. It reuses only the pure bounded-data, immutable, path and evidence utilities from `local-handoff-policy.ts`, not the handoff normalizer or IO. Extracting these utilities into a shared module belongs to the later decomposition gate; no existing Local Handoff code is changed here.

The caller may select only invocation ID, configured identity, admitted plan/task, exact repository baseline, task capability and execution mode. No commands, owner flags, credentials, arbitrary trusted options or provider payload fields are accepted. Task text is data, not executable authority. Verification commands are not forwarded as executable instructions.

## Public entry points and meaning

- `createExecutorAdapterContract(unknown)` → immutable configuration decision with an `ExecutorAdapter` or `adapter: null`.
- `adapter.validateInvocation(unknown)` → immutable decision with a fresh `NormalizedExecutorInvocation` or `normalizedInvocation: null`.
- `adapter.evaluateResult(invocation, unknown)` → immutable decision with a fresh `NormalizedExecutorResult` or `normalizedResult: null`.

The public identity, capabilities, configuration, invocation, change/report, outcome, reason and decision types are exported. Unknown keys are rejected at every object boundary. Reasons contain static codes/paths only; no raw payload or error messages are returned.

**An allow verdict means valid contract data, never permission to dispatch.** Every invocation decision and normalized invocation has `invocationAuthorized: false`. There is deliberately no execute/invoke/dispatch method or authority issuer. Future integration must separately authorize egress, budget, lease, tenant, repository/environment and invocation lifecycle from current trusted facts. Replaying this snapshot is not a substitute for that future authorization.

An in-memory private WeakSet records validation provenance. Result evaluation accepts only the exact frozen receipt issued by the same contract instance; JSON/shape clones, proxies, foreign instances and caller metadata cannot manufacture that provenance. The receipt is not an invocation permit and has no durable/idempotency meaning.

`selectedExecutor = { mode: "human_operated", label }` remains inert AI-040a metadata. Neither it nor a Local Handoff spec/manifest is a new configuration, invocation or receipt. No automatic migration or bridge exists.

## Capabilities and evidence

Task capabilities: `coding`, `repository_analysis`. Modes: `patch_proposal`, `analysis_only`. Artifact capabilities: `patch`, `report`. Lists are non-empty, unique, bounded by their enum size and canonical-sorted without mutating caller arrays. Coding requires patch-proposal mode plus patch/report support; analysis requires analysis-only mode plus report support.

Success contains a meaningful hashed report. Coding additionally requires at least one structured file proposal (`add`, `modify`, `delete`); analysis prohibits file proposals. Every proposal path must be normalized, unique, non-forbidden and within the admitted path scope. Add/modify content has a recomputed SHA-256; delete has null content/hash. Proposal rows are canonical-sorted on a fresh array. Identity and invocation ID must exactly match the receipt; repository baseline and plan/task are derived from it, not the result.

This is bounded factual **payload** integrity, not proof that an executor changed a repository or ran checks. File proposals are not an applied Git patch. Report prose is untrusted. `succeeded` cannot bypass schema/hash/scope validation, does not mark a PAC run complete and does not pass a Quality/Security Gate. Every normalized result has `verificationStatus: "not_run"`, `ownerDecisionRequired: true` and `automaticRetryAllowed: false`.

Other valid terminal outcomes are `rejected` (`unsupported`, `policy_rejected`), `failed` (`timeout`, `provider_failure`, `execution_failure`) and `outcome_unknown` (`ambiguous_outcome`). These require empty changes and a null report; raw error messages are not a field. Malformed/unrecognized results are denied, never converted to success. Validating a failure with `verdict: allow` does not change its non-success outcome.

## Bounds and secrets

Before typed validation, the reused descriptor-based snapshot rejects proxies, accessors, symbols, sparse/exotic arrays, cycles and exotic objects without executing getter/proxy traps. Limits: depth 10, nodes 10,000, members 64, cumulative string bytes 256 KiB. IDs ≤64 safe ASCII characters, version ≤32; repository baseline exactly lowercase 40/64 hex. At most 64 file proposals, each content ≤128 KiB UTF-8; report ≤16 KiB UTF-8, with the stricter cumulative envelope bound still applying.

No raw environment, credential/header object or provider SDK payload can enter the schema. Existing probable-secret and exact inherited-secret-value checks are reused, with an additional credential header/assignment rejection. Scanning covers configuration, invocation identifiers and evidence paths/content. Sensitive denials have only static codes/paths and null partial outputs.

Secret detection cannot prove that arbitrary text contains no novel, unrecognized secret. A future real executor needs separately authorized minimized context and a stronger data-classification/egress policy, not merely this scanner. No raw context loading or secret management is implemented here.

## Verification and deferred work

`tests/executor-adapter-contract.test.mts` contains a deterministic in-process fake/harness. It exercises identity binding, admission, capabilities, immutable provenance, hashes/scope, failure outcomes, secrets, hostile bounds and unchanged AI-040a semantics. No actual executor, provider, OAuth or network is involved. RED/GREEN, mutation and full-suite evidence are recorded in `/tmp/AI-041.0-report.md` for independent review, not self-certification.

Real adapter and invocation authorization, runtime/tenant binding, durable execution/idempotency/audit, budgets, cancel/resume/events, access/payment modes, context/environment loading, applied-patch verification, Quality/Security Gates, corrective/retry loops, router, billing and UI are deferred. AI-041.1 remains a separate future task after the contract gate; AI-040a remains IN REVIEW independently.
