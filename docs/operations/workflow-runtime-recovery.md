# Workflow runtime recovery: lost post-dispatch provider result

Local, Owner-operated tool. There is no HTTP route, UI or remote exposure.

## What each stage means

| Stage | Behaviour |
|---|---|
| **AI-037.1** (automatic, always on) | If a provider call may already have happened but the Step result was not committed, the execution stays `outcome_unknown`. Every later advance of that Step attempt returns `recovery_required`. The runtime never retries it by itself, so there is no automatic second paid call. |
| **AI-037.1.1** (this tool, explicit) | For the narrow case where the first call **succeeded and was settled**, the Owner may abandon that unrecoverable result and permit a later, ordinary, **paid** retry. The tool itself never calls a provider. |
| **AI-037.2** (future) | Durable result storage should let the settled result be applied instead, so this case no longer needs a second paid call. |

## Eligibility

All of the following must hold, checked under row locks in one transaction:

- the Run exists in the resolved workspace, is `running` and is not paused;
- the Step belongs to the Run and is `pending`;
- the execution belongs to that Run and Step and is `outcome_unknown`;
- its claim is not active, and no claim is active for the Step;
- the Run revision still equals the execution's expected revision;
- no other execution exists for the same Step attempt and revision;
- the linked invocation exists and is `succeeded`;
- its budget is `settled`, with actual usage equal to the invocation's.

Anything else is denied. That includes an invocation that is `running`, `outcome_unknown`, `failed` or missing, and any ambiguous or orphan state; those belong to later recovery work.

## Concurrency

Recovery never waits on live runtime row locks; if it encounters contention it fails fast.

- A **read-only preflight** (plain reads, no row locks) denies clearly ineligible state without opening a locking transaction.
- Potentially eligible state is re-read and re-checked in a locking transaction where **every row lock is `NOWAIT`**.
- If a live writer holds any of those rows, recovery returns `denied` with `recovery_lock_unavailable` at once: the transaction rolls back and nothing is changed or audited. Retry later.
- Because recovery never waits for a lock, it cannot take part in a deadlock and cannot make a live writer fail.

## What authorization changes

In one transaction, the tool:

- moves the execution `outcome_unknown → failed`, which frees the Step attempt for a new claim;
- writes the audit event `workflow.execution_recovery_authorized`. Its metadata holds the Run, Step, execution, invocation, attempt, revision, old and new status, invocation usage, budget status, action and the acknowledgement. It never holds prompts, outputs or credentials.

It does not touch anything else. The invocation stays `succeeded` and the settled budget stays settled. No execution, invocation or budget is created. The next ordinary advance re-runs every normal admission, budget and provider-start check.

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
