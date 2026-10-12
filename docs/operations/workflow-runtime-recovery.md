# Workflow runtime recovery: lost post-dispatch provider result

Local, Owner-operated tool. There is no HTTP route, UI or remote exposure.

## What each stage means

| Stage | Behaviour |
|---|---|
| **AI-037.1 / AI-037.1.2** (automatic, always on) | If a provider call may already have happened, or has a recorded result that may have cost money, but the Step result was not committed, the execution stays `outcome_unknown`. Every later advance of that Step attempt returns `recovery_required`. The runtime never retries it by itself, so there is no automatic second paid call. See "Which outcomes are protected" below. |
| **AI-037.1.1 / AI-037.1.2** (this tool, explicit) | For the two recoverable cases below, the Owner may abandon the unrecoverable result and permit a later, ordinary, **paid** retry. The tool itself never calls a provider. |
| **AI-037.2** (future) | Durable result storage should let the settled result be applied instead, so the succeeded case no longer needs a second paid call. |

## Which outcomes are protected

When the final Step result is lost after the provider-start fence, the durable invocation decides what happens to the execution:

| Invocation (durable facts) | Execution | Next ordinary advance |
|---|---|---|
| `running` or `outcome_unknown` (provider may have run; no result) | `outcome_unknown` | `recovery_required` |
| `succeeded` (paid result) | `outcome_unknown` | `recovery_required` |
| `failed`, `outcome = failed`, and **not** exactly 0 tokens and 0 cost (a billable definitive failure, for example a filtered response that was charged; missing usage counts as billable) | `outcome_unknown` | `recovery_required` |
| `failed`, `outcome = failed`, exactly **0 tokens and 0 cost** (a free definitive failure, for example a rejected or rate-limited request) | `failed` | ordinary retry (no money was spent) |
| `failed` with no provider result (`outcome` empty: denied before dispatch) | `failed` | ordinary retry |

A billable failure whose Step failure **was** committed is an ordinary terminal failure. It is not a recovery incident.

## Eligibility

All of the following must hold, checked under row locks in one transaction:

- the Run exists in the resolved workspace, is `running` and is not paused;
- the Step belongs to the Run and is `pending`;
- the execution belongs to that Run and Step and is `outcome_unknown`;
- its claim is not active, and no claim is active for the Step;
- the Run revision still equals the execution's expected revision;
- no other execution exists for the same Step attempt and revision;
- the linked invocation holds a recorded paid provider result, in one of exactly two cases:
  1. **succeeded** (HD-12), or
  2. **definitive billable failure** (AI-037.1.2): status `failed`, outcome `failed`, and not exactly 0 tokens and 0 cost;
- its budget is `settled`, with actual tokens and cost equal to the invocation's.

Anything else is denied:

- an invocation that is `running` or `outcome_unknown`, or `failed` without a provider result: `invocation_result_not_recorded`;
- a free definitive failure (0 tokens and 0 cost): `invocation_failure_not_billable`; it is already an ordinary retryable failure;
- a missing invocation, and any ambiguous or orphan state; those belong to later recovery work.

Recovery never reconstructs or commits the failed Step itself; that needs durable Step results (AI-037.2). It only permits a new, paid attempt.

## Concurrency

Recovery never waits on live runtime row locks; if it encounters contention it fails fast.

- A **read-only preflight** (plain reads, no row locks) denies clearly ineligible state without opening a locking transaction.
- Potentially eligible state is re-read and re-checked in a locking transaction where **every row lock is `NOWAIT`**.
- If a live writer holds any of those rows, recovery returns `denied` with `recovery_lock_unavailable` at once: the transaction rolls back and nothing is changed or audited. Retry later.
- Because recovery never waits for a lock, it cannot take part in a deadlock and cannot make a live writer fail.

## What authorization changes

In one transaction, the tool:

- moves the execution `outcome_unknown → failed`, which frees the Step attempt for a new claim;
- writes the audit event `workflow.execution_recovery_authorized`. Its metadata holds the Run, Step, execution, invocation, attempt, revision, old and new status, invocation status and outcome, invocation usage and cost, budget status, action and the acknowledgement. It never holds prompts, outputs, provider error text or credentials.

It does not touch anything else. The invocation keeps its recorded result (`succeeded` or `failed`) and the settled budget stays settled. No execution, invocation or budget is created. The next ordinary advance re-runs every normal admission, budget and provider-start check.

## Behaviour

- An exact repeat returns `idempotent`.
- Another operator gets `conflict`.
- An ambiguous COMMIT is reconciled from durable state (`authorized` or `recovery_required`) and is never re-sent.

## Usage

`DATABASE_URL` must be set; it is never printed. Output is JSON.

```sh
npm run workflow:recovery -- inspect \
  --workspace <domain> --run <runId> --step <stepId> --execution <executionId>

npm run workflow:recovery -- authorize-retry \
  --workspace <domain> --run <runId> --step <stepId> --execution <executionId> \
  --operator <operatorId> \
  --acknowledge-lost-provider-result-and-duplicate-cost-risk
```

| Exit code | Meaning |
|---|---|
| `0` | inspected, `authorized` or `idempotent` |
| `2` | `denied`, `conflict` or `recovery_required` |
| `1` | usage or configuration error |

## Authority

- The operator identity is recorded in the audit event (`actor_kind = owner`) but is **not authenticated**. The tool relies on local access to the database.
- Transport-level Owner authentication belongs to the future Owner Control boundary. It should call the same store contract (`authorizeRetryAfterLostProviderResult`) rather than duplicating its SQL.
