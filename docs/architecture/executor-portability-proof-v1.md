# Two-provider fake executor portability proof v1

AI-041.2 c + d, with Owner-amended Phase R. READY FOR CONSOLIDATED RE-GATE;
this author record is not an independent PASS or live-readiness claim.

## One PAC pipeline

```text
same admitted FeaturePlan / task / repository baseline / scoped context
 → trusted Run / attempt → current authority (full + stable scope)
 → shared PostgreSQL exposure reservation / predecessor barrier / start fence
 → existing trusted ExecutorProviderRequestPolicy
     ├─ OpenAI: existing canonical bytes + in-process fake SSE transport
     └─ Claude: canonical fake profile + branded deterministic session simulation
 → shared durable provider identity → common ExecutorAdapter result
 → shared outcome capture / settlement / audit → QA / Security / Owner boundary
```

There is no Claude store, second authority/budget/settlement algorithm, alternate
result contract, corrective controller or Router. Only test fixtures explicitly
choose providers. Accepted OpenAI source/bytes/base/final/correlation hashes,
metadata and spend_control are unchanged; literal compatibility vectors rerun.

The original C checkpoint passed before d. The original executor-switch proof
then correctly stopped at immutable full admission identity. Owner amended scope
with [Phase R](executor-authority-rebinding-v1.md) and exactly migration 0018.
After R internal PASS, full C revalidation passed on the new authority baseline;
only then did d resume. No phase was staged/integrated separately.

## Claude fake profile, not a live Anthropic transport

PAC executor identity is `claude-managed-agents/v1`, distinct from OpenAI and
from the explicit simulated Anthropic Agent ID/version. Trusted bounded profile
pins account alias, provider workspace mapping digest, model, Agent/effective
config digest, Environment/config digest, exact repository baseline, context
manifest, tool/network/secrets/runtime/API profile, output schema and budget.
No ambient latest lookup, credential, SDK, HTTP callback or fallback provider.

The canonical fake-profile JSON contains one Session Create with exactly one
initial user message and explicit empty tools/skills/mcp_servers. It models the
accepted design, not an independently verified live API schema. Provider input
and configuration echoes are checked, not trusted as execution authority.
Profile/config drift denies or retains the hold. Live Agent/Environment pinning
and configuration TOCTOU remain unresolved live-readiness concerns.

The start path consumes the shared one-use acknowledged durable start and
correlation capability via the existing identity observer. Clones, DB rows,
replays or fresh factories cannot recreate it. One fake Create is the sole work
mutation; no Create→Send pair, continuation, resume, tool confirmation, budget
change or unknown-outcome retry. Missing ID/timeout/malformed replies retain hold.

Fake transport handles are private-branded, bounded declarative scripts, not
caller-supplied functions. The separate read handle exposes only exact known
Session retrieval and bounded events; the inspector never receives a start port.
Unknown ID means no list/search/latest heuristic, no read-as-absence proof and
no new Create. Fresh provider/read/store instances can reconstruct historical
evidence solely from saved identity plus original protected profile/context.
Claude persists `session_id`, `turn_id=NULL`, `identity_state=session_observed`.
No identity-schema redesign or invented root turn.

## Normalization and financial truth

Descriptor snapshots reject proxies/accessors/cycles and limit unknown traversal.
Context ≤8 files, ≤8 KiB/file, ≤32 KiB total; request ≤64 KiB. Session/history
aggregate ≤256 KiB, ≤4 pages, ≤64 unique events, strict sequence/cursor progress.
Exact duplicate event content is idempotent; conflicting IDs, loops, incomplete
pages, unknown events/tools/workflows, secret-like text or oversized evidence
deny without partial terminal output. All pages are exhausted before a candidate.

Idle alone is not success. Only coherent idle + natural end_turn + explicit fake
quiescence + no overshoot + exact original input/config/session + complete safe
history can reach generic proposal validation. Running/rescheduling/terminated,
requires_action/budget_reached, error or interrupt are not ordinary success/retry.
Changes stay bounded path/hash-checked proposals, never applied work; common
result flags remain `ownerDecisionRequired=true`, `verificationStatus=not_run`,
`automaticRetryAllowed=false`. A fake success is not Quality Gate PASS.

PAC aggregate integer exposure is authoritative. Legacy provider defense cents
do not establish a hard Anthropic remote monetary cap or exact billing. Claude
source emits no exact cost receipt: only the explicitly synthetic TEST-owned
producer can exercise exact fixture settlement through existing capture/store.
Unknown finance, overshoot or unproven quiescence retains the hold. No approximate
list-cost→fabricated exact micros conversion. OpenAI nullable evidence semantics
are not weakened or falsely generalized into Claude live readiness.

## Executing proof matrix

| Proof | Boundary |
| --- | --- |
| Same workload / result flags | Parameterized unit and real PG fixtures |
| Reserve→prepare→one start→identity→proposal→settle | Both actual provider-specific fake adapters over the same real PG stores |
| Known historical recovery after restart/revoke | Fresh stores/read clients, zero new Create, settle/idempotent exactly once |
| Timeout/malformed/missing ID/overrun | One transmission, full hold, fresh instance cannot redispatch |
| Duplicate/conflicting identity | Idempotent exact observation; conflict never overwrites |
| Prepared request / repository / executor / context / target drift | Fail closed, no stale start |
| Provider switch in the same Run | Both directions; unresolved/reconciliation/zero usage block; definitive settlement permits next attempt |
| Current authority races | R two orders × two directions × ten independent-backend iterations; stale old exposure cannot start |
| Same-attempt ten-store race | Exactly one acknowledged provider right for each provider |
| Shared aggregate budget | Both providers reserve the same workspace budget; only shared definitive settlement releases it |
| Session namespace isolation | Same text in different provider/account namespaces is independent; foreign-workspace collision cannot cross-bind |
| Event/config/secret/hostile evidence | Claude adversarial unit/PG plus existing OpenAI suites |

All ten executing portability mutations must die by behavioral assertions: omitted
Claude provider correlation, OpenAI target accepted, unknown-outcome second Create,
read port gains mutation, missing ID retry, idle success, conflicting duplicate,
ignored config drift, provider-switch barrier bypass and weakened common result
flags. Eight additional Phase R mutations cover the authority prerequisite. Copies
run outside the repository; parse/import/timeout-only failures are not kills.

Two unfinished partial-harness issues were resolved without production changes:
the Claude fixture type was widened to the existing common configuration shape,
and OpenAI fake pass deadline changed from 30 ms to bounded 5 s to allow actual PG
identity ACK roundtrips. Timeout cases inject ambiguity instead of sleeping; no
production timeout or assertion was weakened. Full verification logs/counts and
the final consolidated SHA-256 are in the external implementation report.

## Explicit remaining limitations

No Anthropic/OpenAI live provider call, real credential/API key/OAuth/WIF,
Agent/Environment/Session creation, inference, remote Git, repository mutation,
deployment, generic agent framework or automatic executor selection. Fake state
is scripted simulation; it does not prove provider cloud tooling/repository
materialization, Network Contract v1, live quiescence or financial sufficiency.
Real access/config pinning/finance/egress/approved live smoke require separate
tasks. Production facades remain structurally unavailable, with no caller/env
unlock. `runtimeDispatchAllowed=false`; production/live dispatch BLOCKED.

c/d await one consolidated independent re-gate; AI-041.2 is NOT DONE. Only after
accepted integration may AI-041.3 Executor Router start, then minimal managed
ExecutionEnvironment closure. Local/VPS/private coding remains deferred to AI-052.
