# Executor Router v1 — PAC Delivery Block B2

Status: IMPLEMENTED / READY FOR CONSOLIDATED INDEPENDENT RE-GATE, not DONE.
Baseline: `46456844aac0251763d41277decfa066cdfc65cf` (AI-041.2 integrated).

## Ownership and trust

`trusted admitted task + trusted immutable route registry → managed environment
eligibility → hard filters → deterministic ranking → selection evidence`.

Admission answers whether the task may execute. ExecutorRouter chooses an eligible
engineering executor/environment/access candidate. The existing direct-model
ModelRouter remains separate and unchanged. Neither selection nor a fingerprint
confers authority: every decision has `dispatchAuthorized=false` and
`runtimeDispatchAllowed=false`. Production/live dispatch remains BLOCKED.

`createExecutorRouter` is an internal trusted-server-configuration factory, NOT
a public registration endpoint. No production registry/default provider claims,
dynamic plugin API, HTTP route, UI write or environment-variable loader is added.
Composition MUST authenticate/authorize and tenant-bind upstream facts; a
structurally valid JS object is not proof of source authority. There is no route
DB store or route persistence. AI-043 may later persist orchestration evidence.

The captured candidate registry is bounded, copied, validated and deeply frozen.
Per-call requirements are snapshotted and frozen. Proxies/accessors/functions,
sparse/augmented arrays, symbols, cycles, excessive depth/nodes/bytes and unknown
fields deny without invoking getters or toJSON. No raw text/error or credentials
are emitted. Candidate metadata is closed data, not callbacks or SDK objects.
IDs use lowercase safe atoms; probable-secret patterns and personal paths deny.

Limits: at most 32 candidates; dimension lists/preferences/regions at most 16;
IDs at most 64 (version/region 32); inherited snapshot limits depth 10, nodes
10000, 64 members per collection, 256 KiB text. Monetary estimates are integer
USD micros 0..10^12, latency integer ms 0..86400000, quality 0..10000 basis points
with 1..1000000 samples. Evidence fingerprints are lowercase SHA-256-shaped IDs.
Evidence truth is trusted configuration's responsibility, not proven by shape.

## Facts and normalization

Requirements reuse factual DevelopmentTask admission and canonical AI-011 current
attempt validation. Risk comes from the validated FeaturePlan task, not a second
caller risk field. Run/plan/task/admitted paths must agree. Exact repository
ID/baseline, current attempt identity and admitted paths are bound to selection.
The Router opens no repository and loads no context. Task class is a closed
trusted planning label; capability/mode retain the accepted coding/patch_proposal
and repository_analysis/analysis_only pairs.

Candidate provider domain is closed to `openai` and `anthropic`, paired with
`openai-agents/v1` and `claude-managed-agents/v1`. No brand implies quality,
residency, privacy, subscription or quota. Tests use synthetic evidence only.
Duplicate route IDs and indistinguishable routes deny. The same executor
identity cannot advertise conflicting static capability/task-class/risk/repository facts.
Distinct routes may have different environment/access/availability/estimates;
the same environment ID cannot carry conflicting environment facts.

Supported access modes: `subscription_session`, `api_key`, `provider_credits`,
`self_hosted`. The last is always ineligible before AI-052. Required access modes
form a normalized set: first lexical eligible intersection is selected. This is
not an auth preference or permission to obtain credentials. Subscription support
must be explicit; unknown subscription cost never becomes $0.

## Hard filters, then ranking

Task class is a HARD routing dimension, not merely fingerprint-bound evidence or
a ranking preference. Required non-empty candidate `taskClasses` uses exactly
`implementation | analysis | repair | refactor | verification`; unknown/duplicate
values deny, sets normalize deterministically and are immutable/fingerprint-bound.
An unsupported requirement rejects the candidate with `task_class_mismatch`
BEFORE ranking. Neither Owner hard pin nor soft preference can override this.
Conflicting static task-class facts for one executor identity invalidate registry.
Synthetic tests split OpenAI implementation/repair/refactor from Claude analysis/
verification, without claiming actual vendor capabilities. Shared-class candidates
still use the unchanged preference/quality/cost/latency ranking below.

Reject candidates failing capability, task class, mode/artifact, max risk, managed environment,
access, availability, required quota, exact-baseline/context/path/artifact support,
residency, privacy, required cost/latency/quality bounds or hard Owner executor pin.
Availability must always be factually `available`; quota must be available when
required. Missing evidence never means unlimited quota, safe handling or best
performance. Required cost/latency/quality with missing estimates fails closed.

Core managed safety capabilities are additive and cannot be removed by an empty
policy capability list. See [managed policy](managed-execution-environment-v1.md).
Hard pin absent or ineligible denies; no silent fallback. Soft preference is an
ordered list of executor IDs, applied ONLY to eligible candidates. Unknown soft
preference IDs/duplicate preferences deny as invalid requirements.

Ranking is lexicographic: eligible Owner preference position, higher quality,
lower cost, lower latency, lexical routeId. Missing optional metrics rank after
known values. Quality sample counts and provenance are evidence, not fabricated
scores or extra weighting. No random, wall-clock or model-dependent tie-break.
Canonical candidate/list ordering makes decisions independent of input ordering
(except intentionally ordered soft preference). Repeated results are fresh and
deeply frozen; caller mutation cannot alter an already-created router/decision.

Bounded reason codes and route IDs explain rejection; no least-bad candidate is
selected. Deny has null selected route/fingerprints and empty ranking. Rejection
summaries contain only validated IDs/codes. No partial executable payload exists.

## Evidence, not authority

Domain-separated SHA-256 decision fingerprints bind policy version, normalized
requirements, the complete normalized candidate/evidence snapshot, selected
route, environment and access mode. Separate requirements/candidate fingerprints
aid comparison. No nonce/time/credential/provider payload is included.

A route cannot reserve budget, mint permits/capabilities/receipts, start providers,
advance current authority, settle outcomes or mutate repositories. Route cost is
planning evidence, not exact accounting or a provider spend cap. A later trusted
composition must independently enter the EXISTING PAC authority → exposure →
predecessor barrier → start/identity → outcome/settlement lifecycle. Adjacent
executor selection never bypasses full/scope fingerprints or legacy restrictions.
Owner result flags and independent QA/Security/approval boundaries remain intact.

## Verification and residual limitations

Checked-in unit/adversarial/mutation suites cover hard/soft Owner rules, both
providers, all hard filters, optional unknown ranking, hostile input, determinism,
immutability and authority absence. Behavioral mutants cover risk, soft bypass,
cost/quality/latency unknowns, availability/quota, local/VPS/self_hosted, privacy,
residency, ordering, dispatch flag, unknown capabilities and hard pin fallback.
Real disposable-PG isolation probes show selection creates no exposure/start or
authority advance. Existing executor/financial/authority/recovery and sandbox/
worktree suites remain required. Exact counts/results live in the external B2
implementation report; author checkpoint is not independent acceptance.

Live blockers remain real account/access and credential mapping, immutable
Agent/Environment configuration pinning, live TOCTOU/network/repository proof,
sufficient financial upper bounds/reconciliation, remote quiescence, and an
Owner-approved live smoke. None is implemented/authorized here. No Router,
environment model or fake evidence makes live execution eligible by itself.
