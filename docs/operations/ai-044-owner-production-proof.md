# AI-044.2 — Local Owner Production Proof Runner

Status: implementation candidate, READY FOR INDEPENDENT RE-GATE only after verification.
AI-044 remains IN PROGRESS; a real production proof has NOT been executed.

## Scope and prerequisites

Open `/workflows/development-execution/proof` (also linked from the execution simulator).
This is one local authenticated Owner workflow, not a generic executor API or a dispatch
enable flag. Every action resolves the current Auth.js GitHub session, existing PAC user,
workspace and Owner membership again. No browser-supplied actor/workspace/configuration
is accepted. Unauthorized and missing targets have the same unavailable projection.

The existing roadmap/controller must already hold an approved current FeaturePlan and
an `implementing` DevelopmentRun attempt for a `running` ProjectTask. This runner does
not create/approve plans, create attempts, tick the generic controller, or manufacture
task readiness. The target is product-neutral; it does not contain Portfolio Analytics
or Liquidity Intelligence defaults. Smart Algorithms is not modified by this task.

An Owner/operator selects exactly one factual attempt with the local **nonsecret**
policy file `~/.config/private-ai-cloud/ai044-production-proof.json` (mode 0600,
owned by the PAC process user, ordinary file, no final symlink, at most 32 KiB).
The file is never created or written by PAC and must not be checked into Git.
Stop competing local configuration writers before operating the runner.

Its exact schema is:

```json
{
  "projectId": "registered-project-key",
  "projectTaskId": "existing-project-task-key",
  "developmentRunId": "existing-development-run-key",
  "planRevision": 1,
  "planFingerprint": "<64 lowercase hex characters of the approved draft>",
  "repository": {
    "id": "trusted-repository-id",
    "baseline": "<exact immutable 40/64 lowercase hex Git commit>"
  },
  "repositoryRoot": "/absolute/owner-trusted/local/repository",
  "repositoryAllowlist": ["src/approved-feature"],
  "readContextPaths": ["src/approved-feature/file.ts", "src/readonly-reference.ts"]
}
```

Values above are placeholders, not executable production configuration. Never use
`HEAD`, branch names, a mutable checkout as context, secrets, credentials or package
files. The physical reader supports exact local SHA-1 Git objects; unsupported object
formats fail closed. A policy hash change invalidates a previously rendered selection.
Configuration does not grant dispatch authority: the factual plan/admission, current
attempt, exact one-shot approval, credential binding and final fence remain mandatory.

Read paths are ordered exact files, maximum 20. The allowlist is a separate finite
repository policy; actual `allowedWritePaths` comes from admitted durable state.
Read-only references NEVER become writable. PREPARE reads exact Git objects only;
there is no checkout write, patch application, shell/MCP or target build execution.

## Explicit Owner workflow

1. Read the factual selection, model, nonsecret account-registration fingerprint,
   read/write scopes and baseline. The account is the selected registration in the
   existing Sign in with ChatGPT connection; connection is NOT PAC authentication.
2. Check the corresponding external app/account: direct `chatgpt.tokens.use.direct`
   grant, exact model, app usage limit **1–99%**, credits disabled and no reliance on
   automatic credit purchases. Confirm these facts manually, then **PREPARE**.
   The server timestamps a receipt valid for at most the existing 15-minute limit.
   This is an operational attestation, NOT provider proof of external settings.
3. PREPARE builds configuration from the validated durable run/approved plan plus
   trusted repository policy, prepares exact context using the existing executor,
   saves the intent via the existing controller store and enrolls existing authority.
   Owner SHARE locks are taken inside those existing transactions on the same session;
   controller/authority journals and the Owner preparation audit commit atomically.
   **Zero provider calls and zero token reads.**
4. **Request Owner approval** separately. The existing subscription implementation
   writes `approval_requests` and its existing typed binding. PREPARED is not approval.
   The UI becomes AWAITING OWNER APPROVAL. **Zero provider calls.**
5. Explicit **APPROVE** or **REJECT** uses existing `approval_decisions`, exact intent
   fingerprint and current authority/receipt checks. **Zero provider calls.**
6. Only APPROVED exposes **INVOKE**. This is a distinct Owner action and the only
   action that may reach the real subscription transport in future approved operation.
   The bridge reconstructs a fresh private receipt from the saved intent and exact Git
   objects; intent and context manifest must match byte-canonical fingerprints. It
   never reconstructs a durable start capability. Existing one-shot consumption and
   acknowledged provider-start fence issue the ephemeral right, just once.
7. Rendering/reloading reads canonical durable status/result, never dispatches.
   COMPLETED means canonical `response.completed` proposal, **not QA success or code
   acceptance**. Only result status, paths, fingerprint and invariant flags are projected;
   source text, patch content, credentials, raw provider errors, SQL and private receipts
   are not returned. Isolated QA/Security/corrective handling remains downstream.

## Failure and recovery

- No approval, changed identity/model/context, stale receipt/selection or changed plan
  denies before dispatch; decisions and invocations re-resolve Owner server-side.
- Duplicate clicks/concurrent requests cannot consume the same attempt twice.
- `consumed` maps to RECOVERY_REQUIRED; `started` to INVOCATION STARTED (not completion).
  `outcome_unknown`, missing acknowledgement or incomplete evidence never becomes success.
- EOF/network/timeout/5xx ambiguity preserves the durable hold; no background worker,
  reload, new browser action or new process automatically dispatches again.
- If an action returns unavailable, reload durable status; **do not repeat INVOKE**.
  If enrollment/COMMIT acknowledgement was uncertain, do not infer authority from
  PREPARED. Existing stores/fences still deny. Recovery requires factual operator review.
- A rejected, expired or consumed receipt is not refreshed/replaced by this page.
  Another execution requires a factual new attempt, a new current receipt and approval.
- Owner revocation applies on every action, and inside mutation/start transactions.
- There is no API-key billing fallback, credit fallback, environment switch or global
  live enablement. Outgoing SIWC keys remain exactly `model,input,store,stream`,
  `store=false`, `stream=true`. No provider-side `max_output_tokens` cap is claimed;
  existing bounded bytes/SSE/time/12-file/1200-line/patch/context limits remain intact.

## Preserved boundaries

`runtimeDispatchAllowed=false`; **generic** production/live dispatch = BLOCKED.
The Phase L paid/hosted issuer remains DENY-ONLY; its financial/hosted-container blockers
are not solved by this runner. No new migration, package, approval subsystem, retry
lifecycle, shell/sandbox, provider SDK or generic route is introduced. No automatic
merge/deploy/commit/push. No live credentials, OAuth or inference are used in tests.
This coding task itself does not authorize connecting ChatGPT or a real proof run.

Independent re-gate must review the entire unstaged candidate. Actual future proof
still needs the Owner's explicit connection, preflight, exact approval and INVOKE.
