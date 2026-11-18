# AI-041.2R — Claude Capability / Access Research v1

Research date: **2026-10-25, Europe/Moscow** (retrieval session includes
2026-10-24 22:07 UTC). Status: **research complete; decision B — viable with
blockers**. Supporting architecture research, not a roadmap revision, a security
gate PASS, an access entitlement, or dispatch authorization.

## 1. Executive decision

Preferred implementation-design candidate: **ClaudeManagedAgentsExecutor**,
`provider_hosted`, using a workspace-bound **API key**, or **Workload Identity
Federation** when an approved IdP/service-account setup exists. Managed Agents
hosts the harness; cloud environments host tools. This is the relevant executor
surface, unlike a direct Messages call. [S1](https://platform.claude.com/docs/en/managed-agents/overview),
[S2](https://platform.claude.com/docs/en/managed-agents/choosing-an-environment),
[S18](https://platform.claude.com/docs/en/manage-claude/wif-reference).

**Not yet eligible for live PAC execution.** A provider-hosted design is eligible
for consideration before AI-052, not automatically compliant. Network equivalence,
financial overrun bounds, cancellation/terminality, uncertain writes, account
access and existing OpenAI-specific durable bindings must be resolved in design.
Start with fake-only protocol/portability work after Owner design approval.

No documented Managed Agents subscription-session authentication was established.
Do not transfer Pro/Max/Team/Enterprise Claude Code tokens into this route.
No PAC-owned container is required for the preferred **cloud** route; choosing a
self-hosted Managed Agents worker instead would change that classification.
Local Claude Code/Agent SDK coding remains blocked before AI-052.

Baseline guard passed before any edit:

| Fact | Observed |
|---|---|
| Repository / branch | private-ai-cloud / feature/development-agent-module |
| HEAD and origin tracking HEAD | `c1d17cab779c97825405a2107a7a1f15f723fcf0` |
| Divergence | `0 0` |
| Worktree / index | Clean / empty |
| Roadmap | v1.5 CURRENT / AUTHORITATIVE |
| Diff check | Exit 0 |

This task adds only this report. Documentation policy (`docs/README.md`) permits
supporting material and does not prohibit research documents. It does not acquire
canonical authority. The index's stale v1.4 label is out-of-scope documentation
debt; the canonical v1.5 roadmap wins. No implementation or policy was corrected.

## 2. Official sources and evidence limits

All sources below were retrieved during this research on the date above. Titles
are the official page titles; no publication date is inferred for mutable docs.
Current guides and API references were checked, including references labelled
API version `2026-10-21`. Re-check and pin SDK/API/beta versions at implementation.
The beta header shown is `managed-agents-2026-04-01`; no package was installed.

| ID | Official title / URL | Decision evidence |
|---|---|---|
| S1 | [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview) | Harness, beta/access, compaction |
| S2 | [Choosing an agent environment](https://platform.claude.com/docs/en/managed-agents/choosing-an-environment) | Cloud versus self-hosted responsibility |
| S3 | [Define your agent](https://platform.claude.com/docs/en/managed-agents/agent-setup) | Versioned configuration |
| S4 | [Cloud environment setup](https://platform.claude.com/docs/en/managed-agents/environments) | Packages, networking and exceptions |
| S5 | [Cloud sandbox reference](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference) | Runtime inventory and defaults |
| S6 | [Start a session](https://platform.claude.com/docs/en/managed-agents/sessions) | Version pin, create versus start |
| S7 | [Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations) | Status, retrieve, archive/delete |
| S8 | [Session event stream](https://platform.claude.com/docs/en/managed-agents/events-and-streaming) | Replay/reconnect, interrupt, continuation |
| S9 | [Reference](https://platform.claude.com/docs/en/managed-agents/reference) | Event types and rate limits |
| S10 | [Accessing GitHub](https://platform.claude.com/docs/en/managed-agents/github) | Checkout SHA, credentials, skills |
| S11 | [Adding files](https://platform.claude.com/docs/en/managed-agents/files) | Input mounts and output download |
| S12 | [Tools](https://platform.claude.com/docs/en/managed-agents/tools) | Built-ins, disabled-by-default configuration |
| S13 | [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies) | Client confirmation versus server auto |
| S14 | [MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector) | MCP connectivity/auth boundary |
| S15 | [Secure your Managed Agents deployment](https://platform.claude.com/docs/en/managed-agents/secure-deployment) | Credential isolation and stopping limitations |
| S16 | [Security risks and sandbox boundaries](https://platform.claude.com/docs/en/managed-agents/secure-deployment-risks) | Actual trust boundaries |
| S17 | [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication) | API credential types and workspace binding |
| S18 | [WIF reference](https://platform.claude.com/docs/en/manage-claude/wif-reference) | Managed Agents scope |
| S19 | [Workload Identity Federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation) | IdP/token lifecycle |
| S20 | [Session budgets](https://platform.claude.com/docs/en/managed-agents/budgets) | Cap, overshoot, integer units |
| S21 | [Inspect sessions and track usage](https://platform.claude.com/docs/en/managed-agents/session-observability) | Usage and workspace-visible evidence |
| S22 | [Pricing](https://platform.claude.com/docs/en/about-claude/pricing#claude-managed-agents-pricing) | Runtime and token billing |
| S23 | [Authenticate with vaults](https://platform.claude.com/docs/en/managed-agents/vaults) | Secret placement and rotation |
| S24 | [Review and monitor agent sessions](https://platform.claude.com/docs/en/managed-agents/secure-deployment-monitoring) | Retention durations |
| S25 | [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) | ZDR exclusion |
| S26 | [Create Session](https://platform.claude.com/docs/en/api/typescript/beta/sessions/create) | Actual create fields; no documented idempotency parameter |
| S27 | [List Sessions](https://platform.claude.com/docs/en/api/typescript/beta/sessions/list) | Discovery filters, pagination |
| S28 | [Send Events](https://platform.claude.com/docs/en/api/typescript/beta/sessions/events/send) | No documented general send idempotency |
| S29 | [List Events](https://platform.claude.com/docs/en/api/typescript/beta/sessions/events/list) | Event pagination/order |
| S30 | [Claude API errors](https://platform.claude.com/docs/en/api/errors) | Request IDs, not execution idempotency |
| S31 | [Official TypeScript SDK client source](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts) | Default retries and timeout configuration |
| S32 | [Update Environment](https://platform.claude.com/docs/en/api/typescript/beta/environments/update) | Mutable environment, no proven version selector |
| S33 | [Multiagent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) | Subagents, dynamic workflows, advisor |
| S34 | [Workflow runs](https://platform.claude.com/docs/en/managed-agents/workflow-runs) | Work-completion predicate |
| S35 | [Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory) | Shared memory versus isolated session files |
| S36 | [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) | CLI, stream output, resume, tool semantics |
| S37 | [Authentication — Claude Code](https://code.claude.com/docs/en/authentication) | Subscription login for that product |
| S38 | [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) | CLI/SDK naming and product boundary |
| S39 | [Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting) | Operator-owned subprocess |
| S40 | [Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) | Authentication restriction |
| S41 | [Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions) | SDK tools and callbacks |
| S42 | [Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking) | Estimates are not authoritative billing |
| S43 | [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions) | Runner, access, workflow integration |
| S44 | [Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces) | Workspace rates/spend |
| S45 | [Supported Regions Policy](https://www.anthropic.com/legal/supported-regions) | Access eligibility must be established |
| S46 | [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) | Hosting terms; not a Managed Agents grant |

Evidence levels: **documented** means a published surface, not tested entitlement
or independently proven enforcement. **Unknown** means the reviewed sources do
not establish the property; it is not proof of absence. Matrices below are PAC
design assessments. Nothing here claims a paid/provider smoke passed.

One direct, unauthenticated documentation fetch redirected to an
“App unavailable in region” page; official docs were otherwise readable through
the documentation research tool. This proves neither PAC account eligibility nor
ineligibility. Do not infer location from the Owner's language/timezone, and do
not work around access restrictions. Owner/provider confirmation remains needed.

## 3. Candidate surfaces

| Surface | Execution owner / PAC classification | Pre-AI-052 decision |
|---|---|---|
| Managed Agents + cloud environment | Anthropic harness and tool sandbox; ExecutorAdapter candidate | Conditional design candidate, not live permission |
| Managed Agents + self-hosted environment | Anthropic harness, PAC-operated tool worker | DEFERRED TO AI-052 for coding |
| Claude Code CLI / historical Claude Code SDK | Operator-run CLI / current Agent SDK family | NOT ELIGIBLE for PAC local/VPS coding |
| Claude Agent SDK (TS/Python) | Runs Claude Code binary in an operator process | DEFERRED TO AI-052 for coding |
| Messages API / client SDK | Direct model call; tools/loop are not a managed coding executor | ModelProvider, not portability proof by itself |
| Claude Code GitHub Actions | Claude Code on a CI runner | Optional separately designed fallback, not selected |

The product distinction is explicit in [S38](https://code.claude.com/docs/en/agent-sdk/overview).
This classification does not authorize a PAC generic agent loop.

## 4. Managed Agents capabilities

Agent configuration includes model/system/tools/MCP/skills; updates increment
`version`, and sessions can pin an agent version. Environment is a separate
configuration resource. Session creation can omit `initial_events`: this starts
sandbox provisioning but not agent work. Sending a user event starts work;
`initial_events` combines those operations. [S3](https://platform.claude.com/docs/en/managed-agents/agent-setup),
[S6](https://platform.claude.com/docs/en/managed-agents/sessions).

Capabilities to keep inside the adapter, not implement in PAC:

- Subagents, dynamic workflows and an advisor are documented provider-owned
  orchestration. A session remains one PAC execution attempt, not many PAC runs.
  [S33](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration).
- Compaction is harness-owned; persisted context/continuation does not require a
  PAC context engine. [S1](https://platform.claude.com/docs/en/managed-agents/overview).
- Memory stores are optional independent resources. Read-only mounts exist;
  writable shared stores explicitly propagate changes between sessions. Omit
  them from the first proof. [S35](https://platform.claude.com/docs/en/managed-agents/memory).

No published numeric session execution deadline was established in the reviewed
create surface. A client HTTP timeout is not a server execution timeout.
Archive/delete are lifecycle operations, not inferred force-kill endpoints (§14).

## 5. Claude Code / SDK classification

`claude -p` is noninteractive execution; JSON/stream-JSON, structured responses,
session IDs and `--continue`/`--resume` are supported. `--allowedTools` means
automatic approval, **not an exclusive available-tool allowlist**; unlisted tools
may still execute when they need no approval. Costs in JSON are estimates.
[S36](https://code.claude.com/docs/en/headless).

Claude Code documents Pro/Max and Team/Enterprise login, as well as Console/cloud
credentials. Those permissions apply to Claude Code, not automatically to Managed
Agents. [S37](https://code.claude.com/docs/en/authentication).

Ordinary local CLI use executes filesystem/shell tools in its operating process.
Therefore **PRE-AI-052 CODING EXECUTOR = NOT ELIGIBLE**, regardless of resume or
stream quality. It can remain a human developer tool or future AI-052 research;
this report does not enable it, including as an emergency automatic fallback.
Cloud-facing CLI features are not presumed equivalent to a Managed Agents API.

## 6. Agent SDK classification

The TypeScript/Python Agent SDK supervises a `claude` subprocess over stdio; it
owns a working directory, shell and disk session transcripts. Hosting means
operating and isolating that stateful process, not just an HTTP wrapper.
[S39](https://code.claude.com/docs/en/agent-sdk/hosting).

It offers permissions/hooks/`canUseTool`; these do not themselves prove OS
containment. [S41](https://code.claude.com/docs/en/agent-sdk/permissions).
**DEFERRED TO AI-052** for PAC-controlled coding. The former Claude Code SDK and
current Agent SDK are not two independent vendors or two independent proofs.

## 7. Authentication / access

| Researched route | managed_agents_access_mode | Finding |
|---|---|---|
| Workspace-bound Console API key | `api_key` | Documented; personal/service-account identity-backed keys and legacy workspace keys exist |
| Approved WIF service account | `workload_identity` | `workspace:developer` includes Managed Agents/sessions; `workspace:inference` does not |
| Pro subscription login | `unsupported` | No official Managed Agents session-auth route established |
| Max subscription login | `unsupported` | Same; do not reuse a CLI token |
| Team/Enterprise Claude subscription login | `unsupported` | Not interchangeable with API organization/workspace access |
| PAC account/region entitlement | `unknown` | Not accessed or verified in this task |

The key types/workspace scoping are documented in
[S17](https://platform.claude.com/docs/en/manage-claude/authentication).
WIF short-lived tokens bind to a service account, federation rule and workspace;
do not request organization-admin scope. Fine-grained read/write/resource scopes
are not available in the cited WIF contract.
[S18](https://platform.claude.com/docs/en/manage-claude/wif-reference),
[S19](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation).

Managed Agents beta access is described as enabled by default for API accounts;
that is not proof that this Owner has a funded eligible account.
[S1](https://platform.claude.com/docs/en/managed-agents/overview).
For the selected route, **subscription usable = NO documented supported route**,
not a prediction about private provider agreements.

SDK quickstart says third-party products cannot offer claude.ai login/rate limits
without prior approval. The broader hosting-terms page describes customer-key/
subscription conditions. Do not resolve that wording difference in favor of
subscription reuse; seek provider clarification if revisiting SDK hosting.
[S40](https://code.claude.com/docs/en/agent-sdk/quickstart),
[S46](https://code.claude.com/docs/en/legal-and-compliance).

## 8. Billing / budgets

Managed Agents bills model tokens plus session runtime ($0.08/session-hour while
`running`, metered to milliseconds); web search has separate usage charges.
These are retrieval-time rates, not a pinned PAC tariff.
[S22](https://platform.claude.com/docs/en/about-claude/pricing#claude-managed-agents-pricing).

Session budget: `type: limit`, `max_list_cost: {amount, currency: USD}`; amount is
a positive integer string in cents. It must be attached at creation. Enforcement
is between model requests: already-admitted requests finish and their tools still
run. Overshoot includes up to one model request per thread, plus tool/runtime
cost. Reported list cost is rounded to nearest cent; enforcement is unrounded.
Budget exhaustion pauses, not terminates. Raising/removing a cap resumes work;
removal cannot be reversed by adding a cap again.
[S20](https://platform.claude.com/docs/en/managed-agents/budgets).

Usage includes token/cache breakdowns, tool use, active time and cumulative
`list_cost`; it is list-price consumption, not necessarily the invoice. Console
session visibility includes Developers/Admins in the workspace.
[S21](https://platform.claude.com/docs/en/managed-agents/session-observability).
Use session usage, not the sum of independently rounded thread costs or
`stats.active_seconds`: usage active time counts overlapping threads once.
Usage events arrive on idle transitions, not a continuous spend timer.
Organization create/read limits are respectively 300/1,200 requests/minute;
organization spend and usage-tier limits also apply.
[S9](https://platform.claude.com/docs/en/managed-agents/reference).
Workspace monthly spend and model rate limits exist, not PAC per-attempt ceilings.
[S44](https://platform.claude.com/docs/en/manage-claude/workspaces).

PAC design consequence: reserve aggregate exposure **before any potentially paid
operation**, bind cap to the reservation, fence start with current trusted facts,
and never automatically raise/remove the provider budget. Do not equate cap with
maximum spend or rounded list cost with exact settlement. Before live work,
establish a conservative approved overrun allowance and authoritative settlement
source/rounding rule, or stay blocked. Integer cents convert exactly to micros
only as units; conversion does not recover lost sub-cent precision.

Ambiguity retains the hold (`outcome_unknown`); budget-paused sessions cannot be
settled as completed or ordinary retry-ready. SDK cost estimates do not solve this
financial gap. [S42](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

## 9. Execution environment

Cloud Environment configuration is reusable, but each Session gets a fresh
isolated Linux container. Package caches may be reused; this is not a shared
session filesystem. Configurable installers include apt/cargo/gem/go/npm/pip.
API-created environments default to unrestricted networking: never accept that
default. [S4](https://platform.claude.com/docs/en/managed-agents/environments),
[S5](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference).

Published inventory includes Python, Node (22 default), Go, Rust, Java, Ruby,
PHP, C/C++, git and utilities; this does not guarantee compatibility with PAC's
Node 24.13.x engine. [S5](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference).
Do not install packages or loosen network controls merely to match local tests.

Idle checkpoints preserve filesystem/packages for continuation. History persists
until deletion; sandbox state is kept for 30 days **after creation**, not a proven
sliding idle timeout. Produced files die with the session; independent uploaded
files/vaults/memory need separate deletion.
[S8](https://platform.claude.com/docs/en/managed-agents/events-and-streaming),
[S24](https://platform.claude.com/docs/en/managed-agents/secure-deployment-monitoring).

Environment update exists, but an immutable version selector and effects of
concurrent updates on provisioning were not established.
[S32](https://platform.claude.com/docs/en/api/typescript/beta/environments/update).
Design must fingerprint and protect approved configuration; a read-then-create
check alone is not an atomic pin. Do not claim Agent versioning covers Environment.

## 10. Repository / Git

GitHub resource supports HTTPS repository URL, `/workspace` mount and explicit
`checkout: {type: commit, sha: ...}` or branch. Private cloning needs credentials;
the authorization token can also enable push and is not echoed. Repositories can
be cached. Attached root `.claude/skills` loads automatically. Without a token,
public clone can commit locally but cannot push through that credential path.
[S10](https://platform.claude.com/docs/en/managed-agents/github).
Private clone failure can occur after Session creation; its acknowledgement is
not proof that the requested repository is ready or at the expected baseline.
The documented mount path is not a promise that every tool starts with that
repository as its working directory. A general configurable session `cwd` and
cross-tool working-directory guarantees were not established; future commands
must bind paths explicitly rather than infer them from the mount.

No dedicated immutable changed-files/diff API was established. Derive bounded
patch proposals inside the sandbox and download output files; do not treat a
provider's prose or diff as proof of full repository state. Files API mounts and
session-scoped output listing/download are documented (500 input files/session).
Output publication may lag idle by seconds.
[S11](https://platform.claude.com/docs/en/managed-agents/files).

Minimum proof design: upload only approved fixture files from a verified baseline,
with manifest hashes, or select an exact public fixture commit. Prefer no GitHub
credential, no MCP, no shell. No `.git`, `.env`, hidden skills or other-project data
in an uploaded fixture. Private-repository credentials are a separate blocker:
the example's broad `repo` scope is not PAC approval for it. Require service-side
read-only, exact-repository permission evidence if introducing credentials.

With shell disabled and no remote mutation tools/credentials, commit/push/PR/
merge/deploy capabilities can be omitted from the proof surface. Client-reviewed
file writes must reject `.git` and out-of-scope paths. If bash is enabled later,
Git is available: a system prompt alone cannot deny commit or external mutation.
GitHub MCP PR support is a capability to **omit**, not portability acceptance.

## 11. Tool / security boundary

Built-ins: bash, read, write, edit, glob, grep, web_search, web_fetch. MCP and
application-executed custom tools are separate. Configure toolset
`default_config.enabled=false`, explicitly enable only needed file tools and
disable shell/web; also explicitly set
`default_config.permission_policy.type=always_ask`. No MCP/custom tools in the first slice.
[S12](https://platform.claude.com/docs/en/managed-agents/tools).

`always_allow` executes without confirmation (agent-toolset default).
`always_ask` pauses for client confirmation. `auto` is a server classifier, not
an Owner gate. PAC must persist/match each requested tool ID and deny unless a
specific approved bounded operation is permitted. Never acknowledge all calls.
Confirmation waits can be indefinite. Custom tools are not governed by these permission policies.
[S13](https://platform.claude.com/docs/en/managed-agents/permission-policies).

MCP connects from outside the sandbox and uses its own credentials; an unreachable
or unauthenticated server can emit an error without preventing the session.
[S14](https://platform.claude.com/docs/en/managed-agents/mcp-connector).
Omission, not hopeful auth failure, is the safe first-proof boundary.

General shell parsing, symlinks and per-path tool enforcement are not proven by
tool names. Unknown tool/event/config must fail closed. Provider sandbox isolation
protects sessions, not automatically PAC admitted paths inside a session.
The cloud `read` tool can load directory/parent `CLAUDE.md` and `AGENTS.md`
instructions and referenced files; the security guide says only disabling `read`
turns that behavior off. Review/sanitize fixture instructions and references;
ordinary repository content is not trusted control-plane policy.
[S15](https://platform.claude.com/docs/en/managed-agents/secure-deployment).

## 12. Network comparison with PAC Network Contract v1

PAC source: `docs/architecture/sandbox-execution-contract-v1.md`, Network/secrets
section, and `lib/contracts/sandbox-execution.ts`. The following is a **design
comparison**, not certified enforcement equivalence.

| PAC requirement | Managed cloud evidence | Comparison / gate |
|---|---|---|
| Explicit deny-all default | `limited` with no hosts/extra flags denies hosts; API default is unrestricted | compatible only when explicitly configured; default weaker |
| Exact host allowlist | Bare host exact; provider also accepts wildcards | compatible subset if PAC rejects wildcards |
| HTTPS-only and exact port grants | Provider host rules exclude scheme/port | weaker expressiveness; required enforcement unknown |
| No package/Git host bypass | Package flag adds provider-maintained registry/code-host list | weaker when enabled; keep false |
| No MCP bypass | MCP flag can add declared server endpoints | weaker when enabled; omit MCP/keep false |
| Consistent web boundary | Limited hosts also constrain server web tools | partial compatibility; disable both for proof |
| Never follow redirects | No matching cloud-tool guarantee established | UNKNOWN; blocker, no inferred equivalence |
| Validate all DNS answers; pin connected peer | No matching documented per-connection guarantee found | UNKNOWN; blocker |
| Deny mixed/private/internal/metadata/reserved addresses | No PAC-equivalent address matrix/enforcement evidence | UNKNOWN; blocker |
| TLS hostname/SNI and trusted freshness evidence | Not established at PAC's required detail | UNKNOWN; blocker |
| Host grant is not mutation/upload permission | Provider explicitly grants any operation to allowed host | weaker than an operation gate; independent mutation policy needed |

Provider network facts above: [S4](https://platform.claude.com/docs/en/managed-agents/environments).
The narrow proof recommendation is `limited`, empty hosts, both exceptions false,
no web/MCP/bash and no package installation. Mounted inputs remain available.
This **reduces** exposure; it does not prove all undocumented DNS/loopback/metadata
properties or permit faking PAC network evidence. No row is claimed stronger.
Provider guarantees, an independently approved compatible design or a scoped
future contract decision are needed before treating this as PAC Network v1 allow.
Controls documented for WIF, telemetry or a different browser product cannot be
transferred to the sandbox without evidence.

## 13. Secrets

Vaults are workspace-scoped; other keys with workspace access can reference
them. MCP credentials stay outside the sandbox. Environment-variable credentials
appear as opaque placeholders; egress substitutes real values only at approved
hosts/locations. Values are write-only in API responses. Header-only substitution
is narrower than body substitution; returned exchanged tokens are not redacted.
Credentials re-resolve periodically on rotation/deletion; no immediate revocation
latency guarantee was found. [S23](https://platform.claude.com/docs/en/managed-agents/vaults).

PAC mapping: a trusted execution-scoped `SecretRef` resolves server-side to a
specific account/workspace/vault credential, grant, allowed hosts and lifetime.
Never store raw keys in Run/audit, prompts, code fixtures, metadata or reports.
Never put the Anthropic API credential in the sandbox; it could bypass the
session's tool policy and budget. Separate workloads by provider workspace;
vault ID alone is not PAC tenant authority.
[S15](https://platform.claude.com/docs/en/managed-agents/secure-deployment).

First slice: **no vault, no environment secrets, no MCP auth, no repository token**.
Cloud credentials are not automatically execution-ephemeral PAC SecretRefs;
future provisioning/revocation/retention proofs are needed. Session deletion does
not imply vault deletion (§9).

## 14. Lifecycle / recovery / idempotency

### Documented lifecycle, not an invented OpenAI turn schema

Statuses: `idle`, `running`, `rescheduling`, `terminated`. Finished work normally
goes idle; termination can also mean archival/error. Retrieve/list/archive/delete
exist. Running sessions cannot simply be deleted/archived; stop work first.
Deletion is permanent and removes session events/sandbox.
[S7](https://platform.claude.com/docs/en/managed-agents/session-operations).

SSE is live-only. Reconnect by opening stream first, listing history, then
deduplicating IDs. Idle `requires_action` and `budget_reached` are not completion.
An interrupt queues asynchronously, can wait for a running tool, and shares
`end_turn` with natural completion. Sending another message resumes/continues and
can spend again; retrieval must not do this.
[S8](https://platform.claude.com/docs/en/managed-agents/events-and-streaming).

If workflows are enabled, completion additionally needs every observed run's
`status_ended` and subsequent natural `end_turn` idle; interruption alone ends no
workflow run. [S34](https://platform.claude.com/docs/en/managed-agents/workflow-runs).
Disable multiagent/workflows in the minimum design; still validate no unexpected
open runs. No documented immediate cancellation/force-kill or hard wall-clock
termination guarantee was established. A PAC deadline triggers stop/reconciliation,
not fictional terminal settlement. Late results cannot override PAC cancellation.

### Uncertain writes

Create accepts provider-issued identity, metadata (16 pairs, bounded), agent,
environment, resources, budget and initial events. No client-chosen session ID or
documented idempotency-key guarantee was found. Repeating create is **not proven
idempotent**. [S26](https://platform.claude.com/docs/en/api/typescript/beta/sessions/create).
List provides agent/version/time/status/deployment filters and cursors, not a
documented unique metadata lookup/uniqueness constraint.
[S27](https://platform.claude.com/docs/en/api/typescript/beta/sessions/list).

Likewise no general idempotent user-message send guarantee was established.
[S28](https://platform.claude.com/docs/en/api/typescript/beta/sessions/events/send).
An API `request-id` is support correlation, not an idempotency key or a receipt
available when the response was lost.
[S30](https://platform.claude.com/docs/en/api/errors).
The official TypeScript client defaults to two retries for temporary failures;
future write clients must explicitly enforce `maxRetries: 0`, bounded timeouts and
no hidden retries. No SDK exists in this repository for Claude yet.
[S31](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts).

Proposed conservative protocol (design, **not implemented**):

1. Persist trusted tenant/attempt intent, complete request/config fingerprints,
   account and reservation before provider I/O.
2. Create a session **without initial work**; persist returned session ID before
   sending any user message. Provisioning is not assumed free.
3. Fence each spend-capable boundary against the same durable authority/exposure.
   Persist send intent; transmit at most once. Do not blindly replay uncertain
   create/send/confirm/update requests.
4. If ID known, restart using GET/history/files, never create/send to “recover”.
   Bind every observation to original account/agent/config/session/attempt.
5. If ID lost, bounded read-only list/retrieve plus exact metadata/payload evidence
   may locate a **positive** candidate. Multiple, truncated, missing or inconsistent
   matches keep `outcome_unknown`/full hold. Absence is not proof of non-dispatch;
   metadata is not an authenticated uniqueness primitive.
6. Settle once only from validated terminal work, complete bounded artifacts and
   adequate usage/cost evidence. Expiry/deletion/missing history is recovery-required,
   never permission for another paid execution.

Answer to crash-window question: **UNKNOWN / requires conservative outcome_unknown
handling** when identity/acknowledgement was lost. Known-ID crash→retrieve→settle
is architecturally plausible, conditional on factual outcome/financial validation.
History pagination uses `page`/`next_page`, ordered by `processed_at`; bound pages,
events, bytes and replay deduplication. [S29](https://platform.claude.com/docs/en/api/typescript/beta/sessions/events/list).

## 15. Event / artifact mapping

These are conceptual adapter-local observations, not new public PAC event types.
Concrete provider strings are documented in [S9](https://platform.claude.com/docs/en/managed-agents/reference).

| Provider observation | PAC-neutral interpretation / restriction |
|---|---|
| `session.status_running` | started/progress only after identity/start binding |
| `agent.thinking`, model span start/end | progress; no raw thinking exported |
| `agent.tool_use`, `agent.mcp_tool_use`, `agent.custom_tool_use` | tool request; not authority to execute |
| `agent.tool_result`, `agent.mcp_tool_result` | bounded/redacted tool-result evidence |
| `agent.message` | untrusted message, never success by itself |
| Session Files API output | artifact candidate; download, hash, parse, validate paths |
| `session.usage`, model span end | cumulative/model usage observations; deduplicate, don't sum snapshots |
| Natural `end_turn` idle plus no open work and valid result | candidate completed, then PAC verification still required |
| `budget_reached` / `requires_action` | paused/blocked, not failed/succeeded settlement |
| Typed session/workflow error + proven end | candidate failed; transient `rescheduling` is not terminal |
| Persisted PAC cancel + acknowledged quiescence | cancelled control state; no invented provider cancelled status |
| Lost identity, unknown state/event, incomplete evidence | unknown/recovery_required; no partial success |

There is no established native changed-file manifest or patch attestation. Future
adapter must require an explicit bounded report + structured changes with hashes,
including deletions, compare baseline/path scope, and independently run QA/security.
Do not persist raw event objects, provider errors, credentials or unsanitized logs
in domain/audit/UI. Preview deltas are not authoritative persisted history.

## 16. Data handling map

Provider boundary facts: [S2](https://platform.claude.com/docs/en/managed-agents/choosing-an-environment),
[S16](https://platform.claude.com/docs/en/managed-agents/secure-deployment-risks).

| Data | PAC | Anthropic control plane/model | Anthropic cloud sandbox | Other recipient |
|---|---|---|---|---|
| Task prompt / scoped instructions | Minimized approved source | Receives, processes and stores history | Tool inputs may contain it | Only if explicitly authorized tools transmit it |
| Repository / uploaded files | Select baseline, minimize/hash | Cloud state and tool-visible content are provider data | Selected files/checkouts | GitHub if attached; no credential in first proof |
| Tool input/results and history | Only bounded safe projections | Persisted events; content may reach model | Local file/shell tool state | MCP/service if configured; omitted initially |
| Artifacts / logs | Download, scan, hash, redact | Provider retains events/files | Generated outputs | No automatic GitHub push/upload |
| Secrets | Trusted SecretRef resolver only | API auth; vault holds secret if separately enabled | No real vault value intended; env placeholder | Approved endpoint receives substituted value |
| Third-party/MCP credentials | No task/audit values | MCP auth outside sandbox | Not normally MCP credential storage | MCP server receives credential/data |

No claim that data stays exclusively inside the sandbox: agent responses and
tool results are egress channels. Cloud files/state, skills and optional memory
reach Anthropic; GitHub and third-party services add separate processors.
No ZDR claim: Managed Agents is excluded from API ZDR.
[S25](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention).

First proof must use non-sensitive fixtures only. Owner must approve retention,
per-workspace access, data geography and any downstream processors before private
code. Keep raw logs transient/bounded; store safe evidence, not complete transcripts.

## 17. PAC contract fit and security matrix

Local sources inspected: `lib/contracts/executor-adapter.ts`,
`lib/executors/executor-start-boundary.ts`, `executor-provider-identity.ts`,
`executor-outcome.ts`, `openai-agents-reconciliation.ts`, Sandbox/Executor contract
architecture docs, and migration 0016 identity shape (read-only).

```text
same admitted DevelopmentTask / FeaturePlan / trusted attempt
  → existing ExecutorAdapter contract validation (not dispatch authority)
  → proposed ClaudeExecutorAdapter
  → pinned Anthropic Agent + approved cloud Environment configuration
  → one Session, one bounded work submission
  → provider-owned tools/context + bounded validated observations
  → ExecutorArtifacts / ExecutorOutcome → unchanged PAC QA / Security / Owner gates
```

Internal identity proposal: providerId=`anthropic`; deployment/agent ID + version;
environment ID/config fingerprint; provider account/workspace; session ID; original
work-event ID when observed; request IDs as auxiliary correlation. All bind to
existing invocation/plan/task/repository-baseline/attempt and canonical request
fingerprint. Do not label an Anthropic event ID an OpenAI turn ID.

The generic contract already expresses identity, attempt, patch/report, safe
failures and outcome_unknown. No public contract change is proven necessary.
But current durable correlation/reconciliation code explicitly restricts OpenAI
and assumes session/turn identity stages. **Existing storage is not already a
Claude implementation.** A scoped internal provider-identity design is needed;
no migration/relaxation is authorized here.

Matrix legend: PASS = documented primitive fits that row at design level;
PARTIAL = additional proof/controls needed; FAIL = unsuitable route as described;
UNKNOWN = evidence absent. No PASS is a production gate.
“Code/SDK” includes CLI/former SDK; Agent SDK column makes hosting explicit.

| Requirement | PAC requirement | Managed Agents cloud | Claude Code/SDK | Agent SDK | Verdict |
|---|---|---|---|---|---|
| Process isolation | No PAC unmanaged coding | PASS cloud ownership (§9) | FAIL local process | FAIL operator subprocess | Cloud candidate only |
| Filesystem isolation | Session separation + admitted scope | PARTIAL container, no proven path grant | PARTIAL needs OS sandbox | PARTIAL operator hardening | Scope proof required |
| Exact repo scope | Immutable baseline, allowed files | PARTIAL SHA/input manifests (§10) | PARTIAL checkout not confinement | PARTIAL cwd not confinement | No full-repo implicit grant |
| Network allowlist | Full Network v1 | PARTIAL / UNKNOWN (§12) | UNKNOWN host setup | UNKNOWN host setup | Live blocker |
| Secrets isolation | Execution-scoped refs, no leaks | PARTIAL vault (§13) | PARTIAL local auth/env | PARTIAL local auth/env | No secrets first proof |
| Tool restriction | Deny default / explicit grant | PASS primitive; configure explicitly (§11) | PARTIAL rules, not just allowedTools | PARTIAL callbacks/rules | Provider defaults unsafe |
| External mutations | No implicit commit/push/merge/deploy | PARTIAL omit bash/MCP/credentials | PARTIAL deny tools/credentials | PARTIAL deny tools/credentials | No generic shell initially |
| Timeout/cancel | Quiescence before settlement | UNKNOWN hard deadline/stop (§14) | PARTIAL subprocess termination | PARTIAL process supervision | Deadline is not terminal proof |
| Cost cap | Reserved worst-case exposure | PARTIAL cap with overrun (§8) | PARTIAL estimates | PARTIAL estimates | Financial blocker |
| Session identity | Exact correlation, no duplicate start | PARTIAL IDs, UNKNOWN write idempotency | PARTIAL local IDs | PARTIAL local persistence | Hold ambiguous writes |
| Recovery | Retrieve only, no redispatch | PARTIAL known-ID history/files | PARTIAL persisted local state | PARTIAL same | No inferred exactly-once |
| Artifact collection | Bounded hashed patch/report | PARTIAL files; validate extraction | PARTIAL local files | PARTIAL local files | Output lag/missing = hold |
| Audit evidence | Safe normalized events | PARTIAL adapter projection needed | PARTIAL transcript projection | PARTIAL transcript projection | No raw payload audit |
| Data egress | Explicit minimized approval | PARTIAL Anthropic retains data | PARTIAL model/tool egress | PARTIAL model/tool egress | Privacy route not satisfied |
| Repo credentials | Exact repo, minimum permissions | PARTIAL clone token also push-capable | PARTIAL local secrets | PARTIAL local secrets | No credential by default |

Matrix evidence is §§4–16 and their cited official sources, not a second claim
of stronger provider guarantees. All three coding routes lack proven full PAC
Network v1 compliance; local alternatives also violate v1.5 sequencing.

## 18. Gap analysis and optional GitHub Actions fallback

| Gap | Required resolution before crossing boundary |
|---|---|
| Access/region/organization | Owner supplies legitimate supported account/workspace/billing evidence; no login/key creation here |
| Config immutability | Pin agent/API/model; protect environment and session tool policy against concurrent drift |
| Network v1 | Provider evidence / scoped compatible design; no optimistic mapping of host allowlist |
| Financial ceiling | Conservative approved maximum including in-flight/tool/runtime overrun and rounded observations |
| Idempotency | Treat unknown creates/sends as held; provider clarification if stronger recovery is required |
| Cancel/timeout | Define quiescence proof, bounded wait and retained holds; no force-kill invention |
| Identity/store | Design second-provider internal binding; OpenAI-only guards must not be blindly generalized |
| Artifacts | Bounded complete proposals, publication lag, origin/baseline/path verification |
| SDK/API drift | Pin/review exact transport shapes and retries; no dependency selection/install in research |
| Private data/secrets | Data-handling, retention, tenant/account mapping and credential policy approval |

GitHub Actions is real official integration on GitHub-hosted runners with API-key
or subscription OAuth options; WIF is also documented. Workflow timeouts/turn
limits, GitHub permissions, logs/artifacts and run identity are useful primitives.
It is not Anthropic-hosted sandbox execution. [S43](https://code.claude.com/docs/en/github-actions).

Design assessment: a GitHub-hosted runner could avoid a PAC-VPS process, but PAC
would still configure a CI coding environment. Whether that satisfies the Owner's
managed-execution rule needs explicit architecture approval; it cannot silently
bypass AI-052. The integration naturally supports commits/PRs, so defaults do not
match patch-proposal-only authority. CI reruns, cancellation, runner credentials,
provider spend and artifact retention need a separate durable correlation/fence
design. GitHub job recovery is not proven retrieval of the same Claude execution.
No fallback is selected or enabled. Self-hosted runners remain ineligible before
AI-052; no workflow file changes are proposed here.

## 19. Portability proof design

Smallest useful **implementation proposal**, after design approval:

1. One non-sensitive admitted coding DevelopmentTask, exact FeaturePlan and
   trusted current attempt, same path scope as existing executor contract.
2. Injected fake HTTP/SDK port reflecting the official cloud protocol, no Claude
   binary and no external requests. Pin agent version/environment config/model.
3. Two-phase create/persist identity/send; zero automatic write retries, no initial
   events, no custom/MCP/web/shell tools, multiagent/memory omitted, budget required.
4. Bounded file input and structured patch/report output validation through the
   existing contract; unsafe/unknown/missing evidence has no partial success.
5. Prove same reservation/exposure/hold/settlement **policy**, not a pretend provider
   hard cap; opaque account/tenant/attempt binding and once-only start/settlement.
6. Reuse unchanged QA, Security Gate, Owner approvals, audit and bounded corrective
   orchestration. A corrective attempt needs new factual authority, not a blind
   provider continuation/retry. Result validation never applies/commits the patch.

Required fake tests: exact replay versus changed payload; unknown create/send;
duplicate/mismatched account/session/event; crash before/after identity storage;
history gaps/pagination/reordered duplicates; rescheduling; idle requires_action;
budget stop/overshoot; interrupt sharing end_turn; late result after PAC cancel;
forged terminality; missing/oversized/late artifacts; secrets/path/symlink scope;
malformed usage/rounded cost; config drift; unexpected tools or open workflows;
fresh frozen outputs/input immutability; no second provider dispatch.

This proves contract/protocol portability against a faithful fake, **not real
Claude availability or enforcement**. A real independent-provider proof needs a
later separately Owner-approved, bounded integration smoke after blockers/gates;
do not call a fake-only exercise full production portability or AI-041.2 DONE.

## 20. Recommended AI-041.2 implementation slice

Next task: **AI-041.2 Implementation Design Review — Claude Managed Agents cloud,
fake-first, dispatch disabled**. Review the gap table and identity/financial/stop
protocol before adapter code. Only then authorize an explicit implementation
scope. No changes to generic FeaturePlan/admission/controller/audit/UI/Router
types just to carry Anthropic objects. Provider-owned orchestration remains hidden.

Design-review acceptance: candidate B is explicit; every unresolved guarantee
denies/holds; no local/VPS CLI fallback; no false Network v1/cost/idempotency claim;
same admitted task/evidence/QA/security/approval semantics; no live enablement.

## 21. Explicit non-goals and verification

No adapter/runtime/test/migration/package/API/UI/composition implementation. No
Claude CLI launch, SDK install, login, key/vault/Agent/Environment/Session creation,
paid inference, GitHub mutation or live dispatch. Documentation HTTP reads only;
no Anthropic execution endpoint was called. No database action. No staging,
commit or push. `runtimeDispatchAllowed=false`; production/live dispatch BLOCKED.

Repository verification (unchanged application, not provider capability or live
integration evidence):

| Check | Observed result |
|---|---|
| `npm run lint` | Exit 0; existing `_sequence` unused warning at tests/pg/feature-plan-revisions.test.mts:308 |
| `npm run typecheck` | Exit 0 |
| `npm test` in default sandbox | Exit 1; 2627/2635 passed, 8 failures from denied `listen 127.0.0.1` (`EPERM`) |
| `npm test` with loopback permission | Exit 0; **2635/2635**, 0 failures/cancelled/skipped |
| `npm run build` in default sandbox | Exit 1; could not fetch public Geist/Geist Mono fonts |
| `npm run build` with public-font access | Exit 0 |
| `git diff --check` | Exit 0; tracked files unchanged |
| No-index whitespace check of this new report | Exit 1 for the expected new-file delta; no whitespace diagnostics |
| Report structure/source/scope check | Exit 0; 22 sections, 46 unique official URLs; only this report added |

Raw regression logs live outside the repository at `/tmp/AI-041.2R-{lint,typecheck,test,test-loopback,build,build-fonts}.log`.
The sandbox failures were permission/dependency-access failures, not repaired in
source. The reruns permitted fake loopback servers and public font downloads,
not real provider calls. No PostgreSQL integration run or migration was needed.
Final HEAD/origin remain the baseline, divergence `0 0`, tracked worktree unchanged,
index empty; this report is untracked and unstaged. Ordinary `git diff --stat` is
empty because it does not show the new file.

## 22. Remaining Owner decisions / handoff

Owner decisions required: approved API-key versus WIF account/workspace; permitted
non-sensitive fixture and data retention; provider response to network/stop/
financial/idempotency unknowns; acceptance of conservative recovery holds; precise
future implementation scope and subsequent independent review. Any live smoke,
private repository credentials or policy change needs separate authorization.
Do not obtain subscription tokens or relax v1.5 as a shortcut.

```text
AI-041.2 CAPABILITY / ACCESS RESEARCH: PASS (research coverage only)
Decision: B — viable with blockers; no live eligibility granted
Preferred executor: ClaudeManagedAgentsExecutor
Execution environment: provider_hosted / Anthropic cloud
Access mode: api_key; workload_identity is a documented alternative
Subscription usable for this route: NO documented supported route
PAC-owned container required: NO for cloud (YES/extra responsibility if self-hosted)
Eligible before AI-052: YES as a conditional managed design; NO live authorization
Provider-side sandbox: documented isolated per-session Linux container
Budget support: session list-cost cap; in-flight/tool/runtime overshoot; not PAC maximum
Recovery support: known-ID retrieval/history/files; conditional terminal settlement
Idempotency status: UNKNOWN; conservative outcome_unknown for uncertain writes
Repository integration: commit-SHA GitHub mount or approved file uploads; no push grant
Security gaps: network parity, stop/quiescence, scope, secrets, financial precision
Implementation blockers: account access and approved gap/identity/protocol design
Recommended next task: AI-041.2 Implementation Design Review, fake-first, dispatch disabled
```

READY FOR AI-041.2 IMPLEMENTATION DESIGN REVIEW
