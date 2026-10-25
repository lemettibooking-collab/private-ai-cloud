# Minimal Managed ExecutionEnvironment Policy v1 — B2

Status: IMPLEMENTED / READY FOR CONSOLIDATED INDEPENDENT RE-GATE, not DONE.
AI-042 overall remains PARTIAL / IN PROGRESS. This is capability/policy closure,
not physical enforcement or a production execution environment.

## Domain and evidence

Kinds preserve roadmap vocabulary:
`provider_hosted | openai_hosted | codex_cloud_if_supported | local |
vps_self_hosted | future_provider`.

Potentially eligible kinds are provider_hosted/openai_hosted. Codex Cloud needs
explicit supported programmatic-interface evidence; product naming is never proof.
Router prevents Anthropic candidates claiming OpenAI-only kinds. local/VPS are
hard blocked until AI-052; future_provider is unsupported in v1. No managed failure
falls back to local/VPS or weakens scope. Worktree isolation is not coding runtime.

Each capability has `supported | unsupported | unknown` and a fingerprint or null.
Supported without fingerprint is malformed and globally denies; unknown and
unsupported cannot satisfy a required capability. A fingerprint identifies trusted
evidence, not physical proof or a grant. No provider legal/compliance claims are
hardcoded. All positive fixture descriptors are explicitly synthetic.

The model covers filesystem/repository isolation, path-scope enforcement, network
policy, secrets isolation, timeout, budget/resource bound, changed-file limit,
artifact collection, verification-output collection, residency and data handling.
The Router always requires the first nine. Additional required capabilities are
additive; environment policy itself compares the specified bounded requirement set.

Residency needs general residency support AND supported region evidence matching
an exact bounded region ID. Privacy needs general data-handling support AND
explicit matching private_network/ZDR/no_training/restricted_data evidence. Region
labels have no implicit geographic/legal meaning; trusted evidence assigns it.
Unknown fails matching requirements. Optional unknown facts are not fabricated.

## Boundary

`evaluateManagedExecutionEnvironment({environment, requirements})` validates fresh
bounded snapshots, then returns eligible/ineligible with safe bounded codes.
Ineligible has normalizedEnvironment=null. Every result keeps
`runtimeDispatchAllowed=false` and `dispatchAuthorized=false`, and is deeply frozen.
No provider, filesystem, DNS, network, process, environment creation, sandbox,
worktree allocation, secret access or health check occurs. No mutable provider
state or wall clock participates. No boolean support without provenance is accepted.

This records whether a trusted capability snapshot satisfies policy; it does not
claim PAC enforces provider-owned internals, Network Contract v1, resource limits
or file restrictions at runtime. Accepted Sandbox Contract and WorktreePort are
unchanged. self_hosted access is blocked separately by ExecutorRouter. Managed
policy cannot grant admission, financial reservation, start, settlement, approval,
repository mutation or Git rights.

## Closure and remaining stages

B2 supplies the managed selection abstraction needed before AI-043, subject to
consolidated independent re-gate/integration. It does not mark AI-042 overall DONE.
Private/local/VPS physical containment, containers/process/resource/network/secrets
enforcement, production worktree storage and private executors remain AI-052 after
AI-051. No new migration, route database, provider transport or dependency exists.

Production/live dispatch stays BLOCKED. Later live capability collectors must
prove exact account/environment/config identity, freshness/TOCTOU, repository
materialization, actual network and data handling, financial sufficiency and
remote quiescence under separately approved scope. AI-043 controller does not
inherit live permission from route selection. Self-development is not self-deploy.
