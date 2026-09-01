import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeContract = (await import(
  new URL("../lib/db/workflow-runtime-store.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-store");
const {
  PostgresWorkflowRuntimeStateStore,
  postgresWorkflowRuntimeStoreLimits,
} = storeContract;
const fixtureContract = (await import(
  new URL("./helpers/workflow-runtime-state-fixture.mts", import.meta.url).href
)) as {
  createWorkflowRuntimeStateFixture(): import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeState;
  transitionRuntimeState(
    state: import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeState,
    kind: "run_started" | "run_cancelled",
  ): import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeState;
};
const {
  createWorkflowRuntimeStateFixture,
  transitionRuntimeState,
} = fixtureContract;

type SqlClient = import("../lib/db/workflow-runtime-store").WorkflowRuntimeSqlClient;
type RuntimeState = import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeState;

const workspaceDatabaseId = "00000000-0000-4000-8000-000000000001";
const dbRunId = "00000000-0000-4000-8000-000000000901";
const claimId = "00000000-0000-4000-8000-000000000951";
const recoveredClaimId = "00000000-0000-4000-8000-000000000952";
const commandOwnershipToken = "00000000-0000-4000-8000-000000000961";
const fingerprint = "a".repeat(64);
const approvalRequestFingerprint = "b".repeat(64);
const approvalPolicyFingerprint = "c".repeat(64);
const invocationRequestFingerprint = `sha256:${"d".repeat(64)}`;
const otherReservationToken = "00000000-0000-4000-8000-000000000972";

function invocationReservation(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace-primary",
    runId: "run-one",
    workflowExecutionId: "runtime-one",
    invocationId: "invocation-one",
    runRevision: 2,
    projectId: "project-one",
    workflowId: "workflow-one",
    agentId: "agent-one",
    agentBindingId: "binding-agent-one",
    stepId: "step-one",
    attemptNumber: 1,
    modelProfileId: "model-one",
    requestFingerprint: invocationRequestFingerprint,
    providerId: "provider-one",
    deploymentId: "deployment-one",
    providerModelId: "provider/model:v1",
    providerModelVersion: "version-1",
    ...overrides,
  } as import("../lib/workflows/agent-step-runtime").AgentStepModelInvocationReservation;
}

function executionIdentityRow() {
  return {
    workflow_execution_id: "00000000-0000-4000-8000-000000000971",
    db_run_id: dbRunId,
    execution_id: "runtime-one",
    step_id: "step-one",
    attempt_number: 1,
    expected_revision: "1",
    execution_status: "running",
    run_revision: "1",
  };
}

function invocationRow(overrides: Record<string, unknown> = {}) {
  return {
    workflow_execution_id: "00000000-0000-4000-8000-000000000971",
    reservation_token: otherReservationToken,
    invocation_id: "invocation-one",
    run_revision: "2",
    project_id: "project-one",
    workflow_id: "workflow-one",
    agent_id: "agent-one",
    agent_binding_id: "binding-agent-one",
    step_id: "step-one",
    attempt_number: 1,
    model_profile_id: "model-one",
    request_fingerprint: invocationRequestFingerprint,
    status: "running",
    provider_id: "provider-one",
    deployment_id: "deployment-one",
    provider_model_id: "provider/model:v1",
    provider_model_version: "version-1",
    outcome: null,
    finish_reason: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    latency_ms: null,
    cost_usd_micros: null,
    error_code: null,
    ...overrides,
  };
}

function invocationOutcome(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace-primary",
    runId: "run-one",
    invocationId: "invocation-one",
    requestFingerprint: invocationRequestFingerprint,
    status: "succeeded",
    outcome: "succeeded",
    finishReason: "stop",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    latencyMs: 7,
    costUsdMicros: 11,
    errorCode: null,
    ...overrides,
  } as import("../lib/workflows/agent-step-runtime").AgentStepModelInvocationOutcome;
}

function canonicalData(input: unknown): string {
  if (input === null) return "null";
  if (["string", "number", "boolean"].includes(typeof input)) {
    return typeof input === "string" ? JSON.stringify(input) : String(input);
  }
  if (Array.isArray(input)) return `[${input.map(canonicalData).join(",")}]`;
  const record = input as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalData(record[key])}`,
  ).join(",")}}`;
}

function riskPause(stepId = "step-one", approvalStatus: "pending" | "rejected" = "pending") {
  const scopeInput = {
    workspaceId: "workspace-primary",
    runId: "run-one",
    stepId,
    attemptNumber: 1,
    expectedRevision: 1,
    requestFingerprint: approvalRequestFingerprint,
    policyFingerprint: approvalPolicyFingerprint,
    requestedCapability: "advanced_reasoning",
    riskLevel: "high",
  };
  const scopeFingerprint = createHash("sha256").update(canonicalData(scopeInput)).digest("hex");
  return {
    kind: "risk_approval" as const,
    stepId,
    reasonCode: "approval_required" as const,
    approvalRequestId: `risk-approval-${scopeFingerprint.slice(0, 32)}`,
    approvalStatus,
  };
}

function riskScope(state: RuntimeState) {
  const pause = riskPause();
  const scopeInput = {
    workspaceId: state.snapshot.workspaceId,
    runId: state.snapshot.runId,
    stepId: pause.stepId,
    attemptNumber: 1,
    expectedRevision: state.snapshot.revision,
    requestFingerprint: approvalRequestFingerprint,
    policyFingerprint: approvalPolicyFingerprint,
    requestedCapability: "advanced_reasoning" as const,
    riskLevel: "high" as const,
  };
  const scopeFingerprint = createHash("sha256").update(canonicalData(scopeInput)).digest("hex");
  return {
    ...scopeInput,
    approvalRequestId: `risk-approval-${scopeFingerprint.slice(0, 32)}`,
    scopeFingerprint,
  };
}

type ScriptStep = {
  tag: string;
  rows?: readonly Record<string, unknown>[];
  rowCount?: number;
  inspect?: (values: readonly unknown[]) => void;
  error?: Error;
};

class ScriptedDatabase {
  readonly steps: ScriptStep[];
  readonly queries: Array<{ tag: string; values: readonly unknown[] }> = [];
  releases = 0;
  transactions: string[] = [];
  commitErrors = 0;

  constructor(steps: readonly ScriptStep[]) {
    this.steps = [...steps];
  }

  async connect(): Promise<SqlClient> {
    return {
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        const transaction = text.trim().toLowerCase();
        if (["begin", "commit", "rollback"].includes(transaction)) {
          this.transactions.push(transaction);
          if (transaction === "commit" && this.commitErrors > 0) {
            this.commitErrors -= 1;
            throw new Error("lost PostgreSQL COMMIT acknowledgement");
          }
          return { rows: [], rowCount: 0 } as import("../lib/db/workflow-runtime-store").WorkflowRuntimeSqlResult<Row>;
        }
        const match = text.match(/\/\* ([^*]+) \*\//u);
        assert.ok(match, `Missing SQL operation tag: ${text}`);
        const tag = match[1];
        if (tag === "workflow-runtime:audit-event") {
          this.queries.push({ tag, values });
          return { rows: [], rowCount: 1 } as import("../lib/db/workflow-runtime-store").WorkflowRuntimeSqlResult<Row>;
        }
        const step = this.steps.shift();
        assert.ok(step, `Unexpected SQL operation ${tag}`);
        assert.equal(tag, step.tag);
        this.queries.push({ tag, values });
        step.inspect?.(values);
        if (step.error) throw step.error;
        return {
          rows: (step.rows ?? []) as readonly Row[],
          rowCount: step.rowCount ?? step.rows?.length ?? 0,
        };
      },
      release: () => { this.releases += 1; },
    };
  }

  done(): void {
    assert.deepEqual(this.steps, []);
  }
}

function createStore(
  database: ScriptedDatabase,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return new PostgresWorkflowRuntimeStateStore({
    database,
    workspaceId: "workspace-primary",
    workspaceDatabaseId,
    now: () => new Date("2026-09-01T10:00:00.000Z"),
    ...overrides,
  });
}

function stateRows(state: RuntimeState) {
  return {
    run: {
      db_run_id: dbRunId,
      workspace_database_id: workspaceDatabaseId,
      runtime_id: state.snapshot.runId,
      status: state.snapshot.status,
      revision: String(state.snapshot.revision),
      runtime_snapshot: structuredClone(state.snapshot),
      runtime_pause: structuredClone(state.pause),
      project_registry: structuredClone(state.projectRegistry),
      model_provider_registry: structuredClone(state.modelProviderRegistry),
    },
    steps: state.snapshot.stepStates.map((step) => ({
      step_key: step.stepId,
      status: step.status,
      attempt_count: step.attemptCount,
      runtime_revision: String(state.snapshot.revision),
      state_payload: structuredClone(step),
    })),
  };
}

function loadSteps(state: RuntimeState): ScriptStep[] {
  const rows = stateRows(state);
  const steps: ScriptStep[] = [
    { tag: "workflow-runtime:load-run", rows: [rows.run] },
    { tag: "workflow-runtime:load-steps", rows: rows.steps },
  ];
  if (state.pause) {
    const scopeInput = {
      workspaceId: state.snapshot.workspaceId,
      runId: state.snapshot.runId,
      stepId: state.pause.stepId,
      attemptNumber: 1,
      expectedRevision: state.snapshot.revision,
      requestFingerprint: approvalRequestFingerprint,
      policyFingerprint: approvalPolicyFingerprint,
      requestedCapability: "advanced_reasoning",
      riskLevel: "high",
    };
    steps.push({
      tag: "workflow-runtime:load-risk-approval",
      rows: [{
        runtime_approval_id: state.pause.approvalRequestId,
        status: state.pause.approvalStatus,
        step_id: state.pause.stepId,
        attempt_number: 1,
        expected_revision: String(state.snapshot.revision),
        request_fingerprint: approvalRequestFingerprint,
        policy_fingerprint: approvalPolicyFingerprint,
        scope_fingerprint: createHash("sha256").update(canonicalData(scopeInput)).digest("hex"),
        requested_capability: "advanced_reasoning",
        risk_level: "high",
        decision: state.pause.approvalStatus === "rejected" ? "rejected" : null,
      }],
    });
  }
  return steps;
}

function auditResponse() {
  return {
    verdict: "allow" as const,
    status: "running" as const,
    reasons: [],
    runId: "run-one",
    revision: 1,
    workflowStatus: "running" as const,
    currentStepIds: [],
    readyStepIds: ["step-one"],
    waitingApproval: null,
    retryPending: null,
    lastStepResult: null,
  };
}

function commandInput() {
  return {
    runId: "run-one",
    commandId: "command-one",
    fingerprint,
    expectedRevision: 1,
  };
}

function commandOwnershipInput() {
  return { ...commandInput(), ownershipToken: commandOwnershipToken };
}

test("migration adds canonical runtime columns and broadens legacy statuses without rewriting migration 0001", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0002_workflow_runtime_durability.sql", import.meta.url),
    "utf8",
  );
  for (const token of [
    "add column runtime_id text",
    "add column revision bigint",
    "add column runtime_snapshot jsonb",
    "add column runtime_pause jsonb",
    "'review'",
    "'completed'",
    "'blocked'",
    "workflow_step_runs_run_step_unique",
  ]) assert.equal(migration.includes(token), true, token);
  assert.equal(migration.includes("alter table workflow_runs alter column id"), false);
});

test("migration 0003 extends factual approvals with bounded runtime identity and immutable decisions", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0003_workflow_runtime_approvals.sql", import.meta.url),
    "utf8",
  );
  for (const token of [
    "alter table approval_requests",
    "runtime_approval_id",
    "request_fingerprint",
    "policy_fingerprint",
    "scope_fingerprint",
    "requested_by_actor_id",
    "create table approval_decisions",
    "unique (approval_request_id)",
    "references approval_requests (workspace_id, id) on delete restrict",
    "action_type <> 'runtime_risk_approval'",
    "action_type = 'runtime_risk_approval'",
    "runtime_approval_id is not null",
    "step_id is not null",
    "attempt_number is not null",
    "expected_revision is not null",
    "request_fingerprint is not null",
    "policy_fingerprint is not null",
    "scope_fingerprint is not null",
    "requested_capability is not null",
    "requested_by_actor_id is not null",
    "approval_requests_runtime_lifecycle_check",
    "status = 'pending' and resolved_by_actor_id is null and resolved_at is null",
    "status in ('approved', 'rejected', 'cancelled')",
    "resolved_by_actor_id is not null",
    "resolved_at is not null",
  ]) assert.equal(migration.includes(token), true, token);
  assert.equal(migration.includes("invocationDraft"), false);
  assert.equal(migration.includes("messages"), false);
  assert.equal(migration.includes("providerRequest"), false);
});

for (const [table, required] of [
  ["workflow_runtime_commands", ["workspace_id", "run_id", "command_id", "fingerprint", "response_payload"]],
  ["workflow_runtime_claims", ["workspace_id", "run_id", "step_id", "attempt_number", "lease_expires_at"]],
  ["workflow_runtime_executions", ["workspace_id", "run_id", "request_fingerprint", "outcome_unknown"]],
] as const) {
  test(`migration defines bounded workspace-linked ${table}`, () => {
    const migration = readFileSync(
      new URL("../db/migrations/0002_workflow_runtime_durability.sql", import.meta.url),
      "utf8",
    );
    assert.equal(migration.includes(`create table ${table}`), true);
    for (const token of required) assert.equal(migration.includes(token), true, token);
  });
}

test("migration encodes conditional command, active-claim, and unresolved-execution uniqueness", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0002_workflow_runtime_durability.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /unique \(run_id, command_id\)/u);
  assert.match(migration, /expected_revision bigint not null/u);
  assert.match(migration, /lease_token uuid not null default gen_random_uuid\(\)/u);
  assert.match(migration, /lease_expires_at timestamptz not null/u);
  assert.match(migration, /effect_started_at timestamptz/u);
  assert.match(migration, /workflow_runtime_claims_active_attempt_unique[\s\S]+where status = 'active'/u);
  assert.match(
    migration,
    /unique \(run_id, step_id, attempt_number, expected_revision, execution_id\)/u,
  );
  assert.match(migration, /workflow_runtime_executions_unresolved_attempt_unique[\s\S]+outcome_unknown/u);
});

test("create persists one canonical Run and its step projection in one transaction", async () => {
  const state = createWorkflowRuntimeStateFixture() as RuntimeState;
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:create-run",
      rows: [{ id: dbRunId }],
      inspect(values) {
        assert.equal(values[0], workspaceDatabaseId);
        assert.equal(values[2], "run-one");
        assert.equal(JSON.stringify(values).includes("DATABASE_URL"), false);
      },
    },
    { tag: "workflow-runtime:create-step", rowCount: 1 },
  ]);
  await createStore(database).create({ state });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  const audit = database.queries.find((query) => query.tag === "workflow-runtime:audit-event");
  assert.equal(audit?.values[3], "workflow.run_created");
  assert.equal(JSON.stringify(audit?.values).includes("messages"), false);
  database.done();
});

test("unsafe runtime history and secret-bearing registry fields are rejected before SQL", async () => {
  const base = createWorkflowRuntimeStateFixture() as RuntimeState;
  for (const state of [
    { ...base, existingRequests: [{}] },
    { ...base, modelProviderRegistry: { apiKey: "sensitive" } },
  ]) {
    const database = new ScriptedDatabase([]);
    await assert.rejects(createStore(database).create({ state: state as RuntimeState }), /safe for durable persistence/u);
    assert.equal(database.queries.length, 0);
  }
});

test("load validates canonical snapshot and synchronized step projection", async () => {
  const state = createWorkflowRuntimeStateFixture() as RuntimeState;
  const database = new ScriptedDatabase(loadSteps(state));
  const loaded = await createStore(database).load({ runId: "run-one" });
  assert.deepEqual(loaded, state);
  assert.notEqual(loaded, state);
  database.done();
});

test("recreated stores observe the same revision, steps, and runtime pause", async () => {
  const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
  const paused = {
    ...running,
    pause: riskPause(),
  } as RuntimeState;
  const database = new ScriptedDatabase([...loadSteps(paused), ...loadSteps(paused)]);
  const first = await createStore(database).load({ runId: "run-one" });
  const second = await createStore(database).load({ runId: "run-one" });
  assert.deepEqual(first, paused);
  assert.deepEqual(second, paused);
  assert.notEqual(first, second);
  database.done();
});

test("approved runtime risk lookup requires the exact workspace, Run, and full scope", async () => {
  const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
  const scope = riskScope(running);
  const approvalRow = {
    runtime_approval_id: scope.approvalRequestId,
    status: "approved",
    step_id: scope.stepId,
    attempt_number: scope.attemptNumber,
    expected_revision: String(scope.expectedRevision),
    request_fingerprint: scope.requestFingerprint,
    policy_fingerprint: scope.policyFingerprint,
    scope_fingerprint: scope.scopeFingerprint,
    requested_capability: scope.requestedCapability,
    risk_level: scope.riskLevel,
    decision: "approved",
  };
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:check-risk-approval",
      rows: [approvalRow],
      inspect(values) {
        assert.equal(values[0], workspaceDatabaseId);
        assert.equal(values[1], "run-one");
        assert.equal(values[2], scope.approvalRequestId);
      },
    },
  ]);
  const store = createStore(database);
  assert.deepEqual(await store.checkRiskApproval(scope), { approved: true });
  assert.deepEqual(await store.checkRiskApproval({ ...scope, runId: "run-two" }), { approved: false });
  assert.deepEqual(await store.checkRiskApproval({ ...scope, workspaceId: "workspace-other" }), {
    approved: false,
  });
  assert.equal(database.queries.length, 1);
  database.done();
});

test("corrupted persisted snapshot or stale step projection fails closed", async () => {
  const state = createWorkflowRuntimeStateFixture() as RuntimeState;
  const corrupted = structuredClone(stateRows(state)) as unknown as {
    run: Record<string, unknown>;
    steps: readonly Record<string, unknown>[];
  };
  corrupted.run.runtime_snapshot = { runId: "run-one", status: "completed" };
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:load-run", rows: [corrupted.run] },
    { tag: "workflow-runtime:load-steps", rows: corrupted.steps },
  ]);
  await assert.rejects(createStore(database).load({ runId: "run-one" }), /state is not safe|inconsistent/u);
});

test("beginCommand atomically acquires a new command", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
    {
      tag: "workflow-runtime:begin-command",
      rows: [{ ownership_token: commandOwnershipToken }],
    },
  ]);
  const result = await createStore(database).beginCommand(commandInput());
  assert.deepEqual(result, { status: "acquired", ownershipToken: commandOwnershipToken });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  const insert = database.queries.find((query) => query.tag === "workflow-runtime:begin-command");
  assert.ok(insert);
  assert.equal((insert.values[6] as Date).getTime() - (insert.values[5] as Date).getTime(), 120_000);
});

for (const fixture of [
  {
    name: "in-progress",
    row: {
      fingerprint,
      expected_revision: "1",
      status: "in_progress",
      response_payload: null,
      lease_expires_at: "2026-09-01T10:01:00.000Z",
      effect_started_at: null,
    },
    expected: "in_progress",
  },
  {
    name: "collision",
    row: {
      fingerprint: "b".repeat(64),
      expected_revision: "1",
      status: "in_progress",
      response_payload: null,
      lease_expires_at: "2026-09-01T10:01:00.000Z",
      effect_started_at: null,
    },
    expected: "conflict",
  },
] as const) {
  test(`beginCommand returns ${fixture.expected} for ${fixture.name} identity`, async () => {
    const database = new ScriptedDatabase([
      { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
      { tag: "workflow-runtime:begin-command", rowCount: 0 },
      { tag: "workflow-runtime:read-command", rows: [fixture.row] },
    ]);
    const result = await createStore(database).beginCommand(commandInput());
    assert.equal(result.status, fixture.expected);
  });
}

test("stale safe command requires explicit server recovery policy", async () => {
  const staleRow = {
    fingerprint,
    expected_revision: "1",
    status: "in_progress",
    response_payload: null,
    lease_expires_at: "2026-09-01T09:59:00.000Z",
    effect_started_at: null,
  };
  const base = () => [
    { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
    { tag: "workflow-runtime:begin-command", rowCount: 0 },
    { tag: "workflow-runtime:read-command", rows: [staleRow] },
  ] satisfies ScriptStep[];
  assert.equal((await createStore(new ScriptedDatabase(base())).beginCommand(commandInput())).status,
    "recovery_required");
  const recoverable = new ScriptedDatabase([
    ...base(),
    {
      tag: "workflow-runtime:recover-stale-command",
      rows: [{ ownership_token: commandOwnershipToken }],
    },
  ]);
  assert.equal((await createStore(recoverable, { recoverStaleCommands: true }).beginCommand(
    commandInput(),
  )).status, "acquired");
});

test("stale effectful command is recovery_required and cannot be reacquired", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
    { tag: "workflow-runtime:begin-command", rowCount: 0 },
    {
      tag: "workflow-runtime:read-command",
      rows: [{
        fingerprint,
        expected_revision: "1",
        status: "in_progress",
        response_payload: null,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        effect_started_at: "2026-09-01T09:58:30.000Z",
      }],
    },
  ]);
  const result = await createStore(database, { recoverStaleCommands: true }).beginCommand(commandInput());
  assert.equal(result.status, "recovery_required");
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:recover-stale-command"), false);
});

test("command lease is server-owned and bounded", () => {
  assert.equal(Object.hasOwn(commandInput(), "leaseDurationMs"), false);
  for (const commandLeaseDurationMs of [
    postgresWorkflowRuntimeStoreLimits.minimumCommandLeaseDurationMs - 1,
    postgresWorkflowRuntimeStoreLimits.maximumCommandLeaseDurationMs + 1,
  ]) assert.throws(
    () => createStore(new ScriptedDatabase([]), { commandLeaseDurationMs }),
    /command lease policy/u,
  );
});

test("markCommandEffectful records only the exact leased command identity", async () => {
  const database = new ScriptedDatabase([{
    tag: "workflow-runtime:mark-command-effectful",
    rowCount: 1,
    inspect(values) {
      assert.deepEqual(values.slice(1), [
        "run-one", "command-one", fingerprint, 1, commandOwnershipToken,
      ]);
    },
  }]);
  await createStore(database).markCommandEffectful(commandOwnershipInput());
  assert.deepEqual(database.transactions, ["begin", "commit"]);
});

test("superseded command ownership token is fenced from the effect boundary", async () => {
  const database = new ScriptedDatabase([{
    tag: "workflow-runtime:mark-command-effectful",
    rowCount: 0,
  }]);
  await assert.rejects(
    createStore(database).markCommandEffectful(commandOwnershipInput()),
    /effect boundary failed closed/u,
  );
  assert.deepEqual(database.transactions, ["begin", "rollback"]);
});

test("completed command replay returns the exact stored audit-safe response after restart", async () => {
  const response = auditResponse();
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
    { tag: "workflow-runtime:begin-command", rowCount: 0 },
    {
      tag: "workflow-runtime:read-command",
      rows: [{
        fingerprint,
        expected_revision: "1",
        status: "completed",
        response_payload: response,
        lease_expires_at: "2026-09-01T10:01:00.000Z",
        effect_started_at: "2026-09-01T10:00:01.000Z",
      }],
    },
  ]);
  const result = await createStore(database).beginCommand(commandInput());
  assert.equal(result.status, "replay");
  assert.deepEqual(result.status === "replay" ? result.response : null, response);
});

test("abandoned command recovery requires explicit server policy and exact fingerprint", async () => {
  const baseSteps = () => [
    { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
    { tag: "workflow-runtime:begin-command", rowCount: 0 },
    {
      tag: "workflow-runtime:read-command",
      rows: [{
        fingerprint,
        expected_revision: "1",
        status: "abandoned",
        response_payload: null,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        effect_started_at: null,
      }],
    },
  ] satisfies ScriptStep[];
  const deniedDb = new ScriptedDatabase(baseSteps());
  assert.equal((await createStore(deniedDb).beginCommand(commandInput())).status, "recovery_required");
  const allowedDb = new ScriptedDatabase([
    ...baseSteps(),
    { tag: "workflow-runtime:recover-command", rows: [{ ownership_token: commandOwnershipToken }] },
  ]);
  assert.equal((await createStore(allowedDb, { recoverAbandonedCommands: true }).beginCommand(
    commandInput(),
  )).status, "acquired");
});

test("completeCommand conditionally records only an exact in-progress command", async () => {
  const database = new ScriptedDatabase([{ tag: "workflow-runtime:complete-command", rowCount: 1 }]);
  await createStore(database).completeCommand({
    ...commandOwnershipInput(), response: auditResponse(),
  });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
});

test("completeCommand zero-row update fails closed and rolls back", async () => {
  const database = new ScriptedDatabase([{ tag: "workflow-runtime:complete-command", rowCount: 0 }]);
  await assert.rejects(createStore(database).completeCommand({
    ...commandOwnershipInput(), response: auditResponse(),
  }), /completion failed closed/u);
  assert.deepEqual(database.transactions, ["begin", "rollback"]);
});

test("abandonCommand cannot mutate a completed command after lost completion acknowledgement", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:abandon-command", rowCount: 0 },
    { tag: "workflow-runtime:abandon-command-status", rows: [{ status: "completed" }] },
  ]);
  await createStore(database).abandonCommand(commandOwnershipInput());
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  assert.equal(database.queries[0].values[3], fingerprint);
});

function newClaimSteps(): ScriptStep[] {
  return [
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    { tag: "workflow-runtime:read-active-claim", rowCount: 0 },
    { tag: "workflow-runtime:read-existing-execution-identity", rowCount: 0 },
    { tag: "workflow-runtime:read-unresolved-execution", rowCount: 0 },
    { tag: "workflow-runtime:insert-claim", rows: [{ claim_id: claimId }] },
    { tag: "workflow-runtime:insert-execution", rowCount: 1 },
  ];
}

function executionBoundaryRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    status: "prepared",
    claim_status: "active",
    lease_expires_at: "2026-09-01T10:05:00.000Z",
    claim_expected_revision: "1",
    execution_expected_revision: "1",
    run_revision: "1",
    runtime_pause: null,
    run_status: "running",
    ...overrides,
  };
}

function claimInput(attemptNumber = 1) {
  return {
    runId: "run-one",
    stepId: "step-one",
    attemptNumber,
    expectedRevision: 1,
    executionId: `execution-${attemptNumber}`,
    requestFingerprint: fingerprint,
  };
}

test("claim atomically creates a server-leased claim and prepared execution intent", async () => {
  const database = new ScriptedDatabase(newClaimSteps());
  const result = await createStore(database).claim(claimInput());
  assert.deepEqual(result, { status: "acquired", claimId });
  const insert = database.queries.find((query) => query.tag === "workflow-runtime:insert-claim");
  assert.ok(insert);
  assert.equal((insert.values[7] as Date).getTime() - (insert.values[6] as Date).getTime(), 300_000);
});

test("caller cannot choose claim lease duration and store policy is bounded", () => {
  assert.equal(Object.hasOwn(claimInput(), "leaseDurationMs"), false);
  for (const leaseDurationMs of [
    postgresWorkflowRuntimeStoreLimits.minimumLeaseDurationMs - 1,
    postgresWorkflowRuntimeStoreLimits.maximumLeaseDurationMs + 1,
  ]) assert.throws(() => createStore(new ScriptedDatabase([]), { leaseDurationMs }), /lease policy/u);
});

test("active factual claim returns idempotent for same execution and conflict for another", async () => {
  for (const [executionId, status] of [["execution-1", "idempotent"], ["execution-other", "conflict"]] as const) {
    const database = new ScriptedDatabase([
      {
        tag: "workflow-runtime:claim-run",
        rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
      },
      {
        tag: "workflow-runtime:read-active-claim",
        rows: [{
          claim_id: claimId,
          execution_id: executionId,
          request_fingerprint: fingerprint,
          lease_expires_at: "2026-09-01T10:05:00.000Z",
          execution_status: "prepared",
        }],
      },
    ]);
    assert.equal((await createStore(database).claim(claimInput())).status, status);
  }
});

test("expired prepared execution receives new fenced ownership without a duplicate execution", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-1",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "prepared",
      }],
    },
    { tag: "workflow-runtime:expire-recovered-claim", rowCount: 1 },
    {
      tag: "workflow-runtime:insert-recovered-claim",
      rows: [{ claim_id: recoveredClaimId }],
    },
    {
      tag: "workflow-runtime:rebind-prepared-execution",
      rowCount: 1,
      inspect(values) {
        assert.deepEqual(values.slice(2), [
          claimId,
          recoveredClaimId,
          "step-one",
          1,
          1,
          "execution-1",
          fingerprint,
        ]);
      },
    },
  ]);
  assert.deepEqual(await createStore(database).claim(claimInput()), {
    status: "acquired",
    claimId: recoveredClaimId,
  });
  assert.notEqual(recoveredClaimId, claimId);
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-execution"), false);
  assert.equal(database.queries.filter(
    (query) => query.tag === "workflow-runtime:rebind-prepared-execution",
  ).length, 1);
});

test("prepared recovery fences the old claimant across start, outcome, release, and CAS", async () => {
  const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-1",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "prepared",
      }],
    },
    { tag: "workflow-runtime:expire-recovered-claim", rowCount: 1 },
    {
      tag: "workflow-runtime:insert-recovered-claim",
      rows: [{ claim_id: recoveredClaimId }],
    },
    { tag: "workflow-runtime:rebind-prepared-execution", rowCount: 1 },
    { tag: "workflow-runtime:read-execution", rowCount: 0 },
    { tag: "workflow-runtime:record-known-execution", rowCount: 0 },
    { tag: "workflow-runtime:read-known-execution", rowCount: 0 },
    {
      tag: "workflow-runtime:release-read",
      rows: [{ status: "expired" }],
      inspect(values) { assert.equal(values[2], claimId); },
    },
    {
      tag: "workflow-runtime:cas-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:cas-claim",
      rowCount: 0,
      inspect(values) { assert.equal(values[2], claimId); },
    },
    {
      tag: "workflow-runtime:read-execution",
      rows: [executionBoundaryRow()],
    },
    { tag: "workflow-runtime:start-execution", rowCount: 1 },
  ]);
  const store = createStore(database);
  assert.deepEqual(await store.claim(claimInput()), {
    status: "acquired",
    claimId: recoveredClaimId,
  });
  assert.deepEqual(await store.startExecution({ runId: "run-one", claimId }), {
    status: "conflict",
  });
  await assert.rejects(
    store.recordKnownExecutionOutcome({ runId: "run-one", claimId }),
    /outcome failed closed/u,
  );
  await store.releaseClaim({ runId: "run-one", claimId });
  await assert.rejects(store.compareAndSwap({
    runId: "run-one",
    expectedRevision: 1,
    expectedPause: null,
    nextState: running,
    claimId,
  }), /CAS claim is invalid/u);
  assert.deepEqual(await store.startExecution({ runId: "run-one", claimId: recoveredClaimId }), {
    status: "started",
  });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-execution"), false);
  assert.equal(database.queries.some((query) => (
    query.tag === "workflow-runtime:release-execution" || query.tag === "workflow-runtime:release-claim"
  )), false);
  database.done();
});

test("claim rejects a same-revision Agent execution when the factual Run is durably paused", async () => {
  const pause = riskPause();
  const database = new ScriptedDatabase([{
    tag: "workflow-runtime:claim-run",
    rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: pause }],
  }]);
  assert.deepEqual(await createStore(database).claim(claimInput()), {
    status: "conflict",
    claimId: null,
  });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:read-active-claim"), false);
});

test("expired prepared execution rejects a changed fingerprint for the same execution identity", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-1",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "prepared",
      }],
    },
  ]);
  const result = await createStore(database).claim({
    ...claimInput(),
    requestFingerprint: "b".repeat(64),
  });
  assert.deepEqual(result, { status: "conflict", claimId: null });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-execution"), false);
});

test("expired prepared claim is retired only for a genuinely new execution identity", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-old",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "prepared",
      }],
    },
    { tag: "workflow-runtime:expire-claim", rowCount: 1 },
    { tag: "workflow-runtime:expire-prepared-execution", rowCount: 1 },
    { tag: "workflow-runtime:read-existing-execution-identity", rowCount: 0 },
    { tag: "workflow-runtime:read-unresolved-execution", rowCount: 0 },
    { tag: "workflow-runtime:insert-claim", rows: [{ claim_id: claimId }] },
    { tag: "workflow-runtime:insert-execution", rowCount: 1 },
  ]);
  assert.equal((await createStore(database).claim(claimInput())).status, "acquired");
});

test("expired running claim becomes outcome_unknown and requires recovery without new intent", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-old",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "running",
      }],
    },
    { tag: "workflow-runtime:expire-claim", rowCount: 1 },
    { tag: "workflow-runtime:unknown-execution", rowCount: 1 },
  ]);
  assert.equal((await createStore(database).claim(claimInput())).status, "recovery_required");
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-execution"), false);
});

test("known failed outcome survives crash-before-release and exact retry is idempotent", async () => {
  const database = new ScriptedDatabase([
    ...newClaimSteps(),
    { tag: "workflow-runtime:read-execution", rows: [executionBoundaryRow()] },
    { tag: "workflow-runtime:start-execution", rowCount: 1 },
    { tag: "workflow-runtime:record-known-execution", rowCount: 1 },
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-1",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "failed",
      }],
    },
    { tag: "workflow-runtime:expire-claim", rowCount: 1 },
    {
      tag: "workflow-runtime:read-existing-execution-identity",
      rows: [{ request_fingerprint: fingerprint, status: "failed" }],
    },
  ]);
  const firstStore = createStore(database);
  assert.equal((await firstStore.claim(claimInput())).status, "acquired");
  assert.equal((await firstStore.startExecution({ runId: "run-one", claimId })).status, "started");
  await firstStore.recordKnownExecutionOutcome({ runId: "run-one", claimId });

  const recreatedStore = createStore(database);
  assert.deepEqual(await recreatedStore.claim(claimInput()), {
    status: "idempotent",
    claimId: null,
  });
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:insert-execution").length, 1);
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:unknown-execution"), false);
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:expire-claim"), true);
  database.done();
});

test("expired active completed execution retires its claim without losing terminal status", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-1",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "completed",
      }],
    },
    { tag: "workflow-runtime:expire-claim", rowCount: 1 },
    {
      tag: "workflow-runtime:read-existing-execution-identity",
      rows: [{ request_fingerprint: fingerprint, status: "completed" }],
    },
  ]);
  assert.deepEqual(await createStore(database).claim(claimInput()), {
    status: "idempotent",
    claimId: null,
  });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:unknown-execution"), false);
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-execution"), false);
});

test("terminal immutable identity without an active claim is resolved before INSERT", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    { tag: "workflow-runtime:read-active-claim", rowCount: 0 },
    {
      tag: "workflow-runtime:read-existing-execution-identity",
      rows: [{ request_fingerprint: fingerprint, status: "completed" }],
    },
  ]);
  assert.deepEqual(await createStore(database).claim(claimInput()), {
    status: "idempotent",
    claimId: null,
  });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-claim"), false);
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-execution"), false);
});

test("terminal immutable identity with a changed fingerprint conflicts without INSERT", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-1",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "failed",
      }],
    },
    { tag: "workflow-runtime:expire-claim", rowCount: 1 },
    {
      tag: "workflow-runtime:read-existing-execution-identity",
      rows: [{ request_fingerprint: fingerprint, status: "failed" }],
    },
  ]);
  assert.deepEqual(await createStore(database).claim({
    ...claimInput(),
    requestFingerprint: "b".repeat(64),
  }), { status: "conflict", claimId: null });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-execution"), false);
});

test("new execution identity may proceed after an expired known terminal outcome", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-old",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "failed",
      }],
    },
    { tag: "workflow-runtime:expire-claim", rowCount: 1 },
    { tag: "workflow-runtime:read-existing-execution-identity", rowCount: 0 },
    { tag: "workflow-runtime:read-unresolved-execution", rowCount: 0 },
    { tag: "workflow-runtime:insert-claim", rows: [{ claim_id: recoveredClaimId }] },
    { tag: "workflow-runtime:insert-execution", rowCount: 1 },
  ]);
  assert.deepEqual(await createStore(database).claim(claimInput()), {
    status: "acquired",
    claimId: recoveredClaimId,
  });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:unknown-execution"), false);
});

test("expired active outcome_unknown claim remains recovery_required without rewriting execution", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId,
        execution_id: "execution-1",
        request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z",
        execution_status: "outcome_unknown",
      }],
    },
    { tag: "workflow-runtime:expire-claim", rowCount: 1 },
  ]);
  assert.deepEqual(await createStore(database).claim(claimInput()), {
    status: "recovery_required",
    claimId: null,
  });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:unknown-execution"), false);
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-execution"), false);
});

test("a different factual attempt never inherits an older claim", async () => {
  const database = new ScriptedDatabase(newClaimSteps());
  const result = await createStore(database).claim(claimInput(2));
  assert.equal(result.status, "acquired");
  const activeRead = database.queries.find((query) => query.tag === "workflow-runtime:read-active-claim");
  assert.equal(activeRead?.values[3], 2);
});

test("startExecution transitions only an unexpired prepared intent to running", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:read-execution",
      rows: [executionBoundaryRow()],
    },
    { tag: "workflow-runtime:start-execution", rowCount: 1 },
  ]);
  assert.equal((await createStore(database).startExecution({ runId: "run-one", claimId })).status, "started");
});

for (const fixture of [
  {
    name: "factual Run revision advanced",
    overrides: { run_revision: "2" },
  },
  {
    name: "factual runtime pause appeared",
    overrides: {
      runtime_pause: {
        kind: "risk_approval",
        stepId: "step-one",
        reasonCode: "approval_required",
      },
    },
  },
  {
    name: "factual Run is no longer executable",
    overrides: { run_status: "cancelled" },
  },
] as const) {
  test(`startExecution conflicts when ${fixture.name}`, async () => {
    const database = new ScriptedDatabase([{
      tag: "workflow-runtime:read-execution",
      rows: [executionBoundaryRow(fixture.overrides)],
    }]);
    assert.deepEqual(await createStore(database).startExecution({ runId: "run-one", claimId }), {
      status: "conflict",
    });
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:start-execution"), false);
  });
}

test("startExecution locks and factually links Run, claim, and execution at one boundary", () => {
  const source = readFileSync(
    new URL("../lib/db/workflow-runtime-store.ts", import.meta.url),
    "utf8",
  );
  const startBoundary = source.slice(
    source.indexOf("/* workflow-runtime:read-execution */"),
    source.indexOf("/* workflow-runtime:start-execution */"),
  );
  assert.match(startBoundary, /claim\.run_id = execution\.run_id/u);
  assert.match(startBoundary, /run\.id = claim\.run_id/u);
  assert.match(startBoundary, /claim\.expected_revision = execution\.expected_revision/u);
  assert.match(startBoundary, /for update of run, claim, execution/u);
  assert.match(startBoundary, /run\.runtime_pause/u);
  assert.match(startBoundary, /run\.status as run_status/u);
});

test("already-running execution is recovery_required and is never started twice", async () => {
  const database = new ScriptedDatabase([{
    tag: "workflow-runtime:read-execution",
    rows: [executionBoundaryRow({ status: "running" })],
  }]);
  assert.equal((await createStore(database).startExecution({ runId: "run-one", claimId })).status, "recovery_required");
});

test("known normal AI-029 outcome terminalizes a running journal row as failed", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:record-known-execution",
      rowCount: 1,
      inspect(values) {
        assert.deepEqual(values.slice(0, 3), [workspaceDatabaseId, "run-one", claimId]);
      },
    },
  ]);
  await createStore(database).recordKnownExecutionOutcome({ runId: "run-one", claimId });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
});

test("known terminal execution is preserved instead of becoming outcome_unknown", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:record-known-execution", rowCount: 0 },
    { tag: "workflow-runtime:read-known-execution", rows: [{ status: "completed" }] },
  ]);
  await createStore(database).recordKnownExecutionOutcome({ runId: "run-one", claimId });
  const query = database.queries.find((candidate) => candidate.tag === "workflow-runtime:record-known-execution");
  assert.match(query?.tag ?? "", /record-known-execution/u);
});

test("completed execution remains terminal after store recreation", async () => {
  const database = new ScriptedDatabase([{
    tag: "workflow-runtime:read-execution",
    rows: [executionBoundaryRow({ status: "completed", claim_status: "released" })],
  }]);
  const recreated = createStore(database);
  assert.equal((await recreated.startExecution({ runId: "run-one", claimId })).status, "conflict");
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:start-execution"), false);
});

test("unresolved execution without an active claim blocks another intent for the same factual attempt", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:claim-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }],
    },
    { tag: "workflow-runtime:read-active-claim", rowCount: 0 },
    { tag: "workflow-runtime:read-existing-execution-identity", rowCount: 0 },
    { tag: "workflow-runtime:read-unresolved-execution", rowCount: 1 },
  ]);
  assert.equal((await createStore(database).claim(claimInput())).status, "recovery_required");
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-claim"), false);
});

test("releaseClaim durably closes the claim and converts a running ambiguity to outcome_unknown", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:release-read", rows: [{ status: "active" }] },
    { tag: "workflow-runtime:release-execution", rowCount: 1 },
    { tag: "workflow-runtime:release-claim", rowCount: 1 },
  ]);
  await createStore(database).releaseClaim({ runId: "run-one", claimId });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
});

test("releaseClaim leaves an already terminal known execution unchanged", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:release-read", rows: [{ status: "active" }] },
    { tag: "workflow-runtime:release-execution", rowCount: 0 },
    { tag: "workflow-runtime:release-claim", rowCount: 1 },
  ]);
  await createStore(database).releaseClaim({ runId: "run-one", claimId });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
});

test("CAS commits Run and Step projection in one transaction", async () => {
  const queued = createWorkflowRuntimeStateFixture() as RuntimeState;
  const running = transitionRuntimeState(queued as ReturnType<typeof createWorkflowRuntimeStateFixture>, "run_started") as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "0", runtime_pause: null }] },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
  ]);
  const result = await createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 0, expectedPause: null, nextState: running, claimId: null,
  });
  assert.equal(result.status, "committed");
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  assert.equal(database.queries.find((query) => query.tag === "workflow-runtime:audit-event")?.values[3], "workflow.run_started");
});

test("lost CAS COMMIT acknowledgement reconciles an exact persisted next state as committed", async () => {
  const queued = createWorkflowRuntimeStateFixture() as RuntimeState;
  const running = transitionRuntimeState(queued, "run_started") as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "0", runtime_pause: null }] },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
    ...loadSteps(running),
  ]);
  database.commitErrors = 1;
  const result = await createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 0, expectedPause: null, nextState: running, claimId: null,
  });
  assert.equal(result.status, "committed");
  assert.deepEqual(result.state, running);
  assert.deepEqual(database.transactions, ["begin", "commit", "rollback"]);
});

test("lost CAS acknowledgement with persisted old state does not fabricate commit", async () => {
  const queued = createWorkflowRuntimeStateFixture() as RuntimeState;
  const running = transitionRuntimeState(queued, "run_started") as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "0", runtime_pause: null }] },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
    ...loadSteps(queued),
  ]);
  database.commitErrors = 1;
  await assert.rejects(createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 0, expectedPause: null, nextState: running, claimId: null,
  }), /commit was not observed/u);
});

test("lost CAS acknowledgement yields newer factual state as conflict", async () => {
  const queued = createWorkflowRuntimeStateFixture() as RuntimeState;
  const running = transitionRuntimeState(queued, "run_started") as RuntimeState;
  const cancelled = transitionRuntimeState(running, "run_cancelled") as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "0", runtime_pause: null }] },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
    ...loadSteps(cancelled),
  ]);
  database.commitErrors = 1;
  const result = await createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 0, expectedPause: null, nextState: running, claimId: null,
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.state?.snapshot.status, "cancelled");
});

test("unreadable state after lost CAS acknowledgement requires recovery", async () => {
  const queued = createWorkflowRuntimeStateFixture() as RuntimeState;
  const running = transitionRuntimeState(queued, "run_started") as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "0", runtime_pause: null }] },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
    { tag: "workflow-runtime:load-run", error: new Error("connection unavailable") },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(await createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 0, expectedPause: null, nextState: running, claimId: null,
  }), { status: "recovery_required", state: null });
});

test("claimed CAS synchronizes execution terminal status with Run and Step state", async () => {
  const queued = createWorkflowRuntimeStateFixture() as RuntimeState;
  const running = transitionRuntimeState(queued, "run_started") as RuntimeState;
  const paused = {
    ...running,
    pause: riskPause(),
  } as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }] },
    { tag: "workflow-runtime:cas-claim", rows: [{ step_id: "step-one" }] },
    { tag: "workflow-runtime:create-risk-approval", rowCount: 1 },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
    {
      tag: "workflow-runtime:finish-execution",
      rowCount: 1,
      inspect(values) { assert.equal(values[3], "failed"); },
    },
  ]);
  const result = await createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 1, expectedPause: null, nextState: paused, claimId,
    approvalMutation: {
      kind: "create",
      scope: riskScope(running),
      requestedByActorId: "workflow-runtime",
    },
  });
  assert.equal(result.status, "committed");
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  assert.equal(
    database.queries.filter((query) => query.tag === "workflow-runtime:audit-event")
      .some((query) => query.values[3] === "workflow.approval_requested"),
    true,
  );
});

test("lost claimed CAS acknowledgement reconciles Run, pause, Step, and terminal execution together", async () => {
  const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
  const paused = {
    ...running,
    pause: riskPause(),
  } as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }] },
    { tag: "workflow-runtime:cas-claim", rows: [{ step_id: "step-one" }] },
    { tag: "workflow-runtime:create-risk-approval", rowCount: 1 },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
    { tag: "workflow-runtime:finish-execution", rowCount: 1 },
    ...loadSteps(paused),
    {
      tag: "workflow-runtime:reconcile-risk-approval",
      rows: [{
        status: "pending",
        step_id: "step-one",
        attempt_number: 1,
        expected_revision: "1",
        request_fingerprint: approvalRequestFingerprint,
        policy_fingerprint: approvalPolicyFingerprint,
        scope_fingerprint: riskScope(running).scopeFingerprint,
        requested_capability: "advanced_reasoning",
        risk_level: "high",
        requested_by_actor_id: "workflow-runtime",
        resolved_by_actor_id: null,
        decision: null,
        decided_by_actor_id: null,
        reason: null,
        command_id: null,
      }],
    },
  ]);
  database.commitErrors = 1;
  const result = await createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 1, expectedPause: null, nextState: paused, claimId,
    approvalMutation: {
      kind: "create",
      scope: riskScope(running),
      requestedByActorId: "workflow-runtime",
    },
  });
  assert.equal(result.status, "committed");
  assert.deepEqual(result.state, paused);
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:finish-execution").length, 1);
});

test("stale CAS returns persisted conflict state and never overwrites a newer cancellation", async () => {
  const queued = createWorkflowRuntimeStateFixture() as RuntimeState;
  const running = transitionRuntimeState(queued as ReturnType<typeof createWorkflowRuntimeStateFixture>, "run_started") as RuntimeState;
  const cancelled = transitionRuntimeState(running as ReturnType<typeof createWorkflowRuntimeStateFixture>, "run_cancelled") as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "2", runtime_pause: null }] },
    ...loadSteps(cancelled),
  ]);
  const result = await createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 1, expectedPause: null, nextState: running, claimId: null,
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.state?.snapshot.status, "cancelled");
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:update-run"), false);
});

test("same-revision stale CAS cannot erase a newer factual runtime pause", async () => {
  const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
  const pause = riskPause();
  const paused = { ...running, pause } as RuntimeState;
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:cas-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: pause }],
    },
    ...loadSteps(paused),
  ]);
  const result = await createStore(database).compareAndSwap({
    runId: "run-one",
    expectedRevision: 1,
    expectedPause: null,
    nextState: running,
    claimId: null,
  });
  assert.equal(result.status, "conflict");
  assert.deepEqual(result.state?.pause, pause);
  assert.equal(result.state?.snapshot.revision, 1);
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:update-run"), false);
});

test("CAS permits canonical cancellation from the exact paused factual state", async () => {
  const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
  const pause = riskPause();
  const paused = { ...running, pause } as RuntimeState;
  const cancelled = transitionRuntimeState(running, "run_cancelled") as RuntimeState;
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:cas-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: pause }],
    },
    { tag: "workflow-runtime:cancel-risk-approval", rowCount: 1 },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
  ]);
  const result = await createStore(database).compareAndSwap({
    runId: "run-one",
    expectedRevision: 1,
    expectedPause: paused.pause,
    nextState: { ...cancelled, pause: null },
    claimId: null,
    approvalMutation: {
      kind: "cancel",
      approvalRequestId: pause.approvalRequestId,
      cancelledByActorId: "owner-one",
      commandId: "cancel-one",
    },
  });
  assert.equal(result.status, "committed");
  assert.equal(result.state.pause, null);
  assert.equal(result.state.snapshot.status, "cancelled");
  assert.deepEqual(
    database.queries.filter((query) => query.tag === "workflow-runtime:audit-event")
      .map((query) => query.values[3]),
    ["workflow.approval_cancelled", "workflow.run_cancelled"],
  );
});

for (const decision of ["approved", "rejected"] as const) {
  test(`CAS atomically persists immutable ${decision} decision and matching runtime pause`, async () => {
    const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
    const pause = riskPause();
    const paused = { ...running, pause } as RuntimeState;
    const nextPause = decision === "approved" ? null : riskPause("step-one", "rejected");
    const database = new ScriptedDatabase([
      {
        tag: "workflow-runtime:cas-run",
        rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: pause }],
      },
      {
        tag: "workflow-runtime:lock-risk-approval",
        rows: [{ approval_request_id: "00000000-0000-4000-8000-000000000991", status: "pending" }],
      },
      {
        tag: "workflow-runtime:create-approval-decision",
        rowCount: 1,
        inspect(values) {
          assert.equal(values[0], workspaceDatabaseId);
          assert.equal(values[2], decision);
          assert.equal(JSON.stringify(values).includes("providerRequest"), false);
        },
      },
      { tag: "workflow-runtime:resolve-risk-approval", rowCount: 1 },
      { tag: "workflow-runtime:update-run", rowCount: 1 },
      { tag: "workflow-runtime:update-step", rowCount: 1 },
      { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
    ]);
    const result = await createStore(database).compareAndSwap({
      runId: "run-one",
      expectedRevision: 1,
      expectedPause: paused.pause,
      nextState: { ...running, pause: nextPause },
      claimId: null,
      approvalMutation: {
        kind: "resolve",
        approvalRequestId: pause.approvalRequestId,
        decision,
        decidedByActorId: "owner-one",
        reason: decision === "rejected" ? "Bounded owner rejection." : null,
        commandId: `risk-${decision}`,
      },
    });
    assert.equal(result.status, "committed");
    assert.deepEqual(result.state.pause, nextPause);
    assert.deepEqual(database.transactions, ["begin", "commit"]);
    assert.equal(
      database.queries.filter((query) => query.tag === "workflow-runtime:audit-event")
        .some((query) => query.values[3] === `workflow.approval_${decision}`),
      true,
    );
  });
}

for (const decision of ["approved", "rejected"] as const) {
  test(`lost ${decision} COMMIT acknowledgement reconciles the exact decision and pause`, async () => {
    const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
    const pause = riskPause();
    const paused = { ...running, pause } as RuntimeState;
    const nextPause = decision === "approved" ? null : riskPause("step-one", "rejected");
    const nextState = { ...running, pause: nextPause } as RuntimeState;
    const reason = decision === "rejected" ? "Bounded owner rejection." : null;
    const commandId = `risk-lost-${decision}`;
    const database = new ScriptedDatabase([
      {
        tag: "workflow-runtime:cas-run",
        rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: pause }],
      },
      {
        tag: "workflow-runtime:lock-risk-approval",
        rows: [{ approval_request_id: "00000000-0000-4000-8000-000000000991", status: "pending" }],
      },
      { tag: "workflow-runtime:create-approval-decision", rowCount: 1 },
      { tag: "workflow-runtime:resolve-risk-approval", rowCount: 1 },
      { tag: "workflow-runtime:update-run", rowCount: 1 },
      { tag: "workflow-runtime:update-step", rowCount: 1 },
      { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
      ...loadSteps(nextState),
      {
        tag: "workflow-runtime:reconcile-risk-approval",
        rows: [{
          status: decision,
          resolved_by_actor_id: "owner-one",
          decision,
          decided_by_actor_id: "owner-one",
          reason,
          command_id: commandId,
        }],
      },
    ]);
    database.commitErrors = 1;
    const result = await createStore(database).compareAndSwap({
      runId: "run-one",
      expectedRevision: 1,
      expectedPause: paused.pause,
      nextState,
      claimId: null,
      approvalMutation: {
        kind: "resolve",
        approvalRequestId: pause.approvalRequestId,
        decision,
        decidedByActorId: "owner-one",
        reason,
        commandId,
      },
    });
    assert.equal(result.status, "committed");
    assert.deepEqual(result.state.pause, nextPause);
  });
}

test("unreadable approval decision reconciliation returns recovery_required", async () => {
  const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
  const pause = riskPause();
  const paused = { ...running, pause } as RuntimeState;
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:cas-run",
      rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: pause }],
    },
    {
      tag: "workflow-runtime:lock-risk-approval",
      rows: [{ approval_request_id: "00000000-0000-4000-8000-000000000991", status: "pending" }],
    },
    { tag: "workflow-runtime:create-approval-decision", rowCount: 1 },
    { tag: "workflow-runtime:resolve-risk-approval", rowCount: 1 },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 1 },
    { tag: "workflow-runtime:remove-extra-steps", rowCount: 0 },
    ...loadSteps(running),
    { tag: "workflow-runtime:reconcile-risk-approval", error: new Error("database unavailable") },
  ]);
  database.commitErrors = 1;
  const result = await createStore(database).compareAndSwap({
    runId: "run-one",
    expectedRevision: 1,
    expectedPause: paused.pause,
    nextState: running,
    claimId: null,
    approvalMutation: {
      kind: "resolve",
      approvalRequestId: pause.approvalRequestId,
      decision: "approved",
      decidedByActorId: "owner-one",
      reason: null,
      commandId: "risk-unreadable",
    },
  });
  assert.deepEqual(result, { status: "recovery_required", state: null });
});

test("pending approval pause cannot change without its matching atomic approval mutation", async () => {
  const running = transitionRuntimeState(createWorkflowRuntimeStateFixture(), "run_started") as RuntimeState;
  const paused = { ...running, pause: riskPause() } as RuntimeState;
  const database = new ScriptedDatabase([]);
  await assert.rejects(createStore(database).compareAndSwap({
    runId: "run-one",
    expectedRevision: 1,
    expectedPause: paused.pause,
    nextState: { ...running, pause: null },
    claimId: null,
  }), /CAS input is invalid/u);
  assert.equal(database.queries.length, 0);
});

test("step projection failure rolls back the factual Run update", async () => {
  const queued = createWorkflowRuntimeStateFixture() as RuntimeState;
  const running = transitionRuntimeState(queued as ReturnType<typeof createWorkflowRuntimeStateFixture>, "run_started") as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:cas-run", rows: [{ db_run_id: dbRunId, revision: "0", runtime_pause: null }] },
    { tag: "workflow-runtime:update-run", rowCount: 1 },
    { tag: "workflow-runtime:update-step", rowCount: 0 },
  ]);
  await assert.rejects(createStore(database).compareAndSwap({
    runId: "run-one", expectedRevision: 0, expectedPause: null, nextState: running, claimId: null,
  }), /synchronization failed closed/u);
  assert.deepEqual(database.transactions, ["begin", "rollback"]);
});

test("workspace-bound lookup returns not found and always uses trusted workspace database identity", async () => {
  const database = new ScriptedDatabase([{
    tag: "workflow-runtime:load-run",
    rowCount: 0,
    inspect(values) { assert.deepEqual(values, [workspaceDatabaseId, "run-one"]); },
  }]);
  assert.equal(await createStore(database).load({ runId: "run-one" }), null);
});

test("database failures are sanitized and never expose DATABASE_URL", async () => {
  const database = new ScriptedDatabase([{
    tag: "workflow-runtime:load-run",
    error: new Error("postgresql://secret-user:secret-password@production/runtime"),
  }]);
  await assert.rejects(
    createStore(database).load({ runId: "run-one" }),
    (error: Error) => !error.message.includes("secret-password") && error.message === "Workflow runtime database load failed.",
  );
});

test("stored command response rejects unknown secret-bearing fields before SQL", async () => {
  const database = new ScriptedDatabase([]);
  await assert.rejects(createStore(database).completeCommand({
    runId: "run-one",
    commandId: "command-one",
    fingerprint,
    ownershipToken: commandOwnershipToken,
    response: { ...auditResponse(), databaseUrl: "postgresql://secret" } as never,
  }), /response is invalid/u);
  assert.equal(database.queries.length, 0);
});

test("migration 0004 defines a bounded workspace-linked invocation ledger and idempotent runtime audit", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0004_workflow_runtime_observability.sql", import.meta.url),
    "utf8",
  );
  for (const token of [
    "create table workflow_model_invocations",
    "workflow_execution_id uuid not null references workflow_runtime_executions(id)",
    "unique (workflow_run_id, invocation_id)",
    "unique (workflow_execution_id)",
    "request_fingerprint ~ '^sha256:[0-9a-f]{64}$'",
    "reservation_token uuid not null",
    "unique (reservation_token)",
    "outcome_unknown",
    "runtime_event_key",
    "audit_events_workspace_runtime_event_unique",
  ]) assert.equal(migration.includes(token), true, token);
  for (const forbidden of [
    "messages", "prompt_text", "prepared_provider_request", "raw_model_output",
    "structured_output", "tool_call_arguments", "api_key", "credentials",
  ]) assert.equal(migration.includes(forbidden), false, forbidden);
});

test("migration 0004 makes runtime actor and invocation lifecycle NULL shapes explicit", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0004_workflow_runtime_observability.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  for (const required of [
    "runtime_event_key is not null",
    "actor_kind is not null",
    "actor_id is not null",
    "runtime_run_id is not null",
    "status = 'succeeded'",
    "outcome is not null",
    "outcome = 'succeeded'",
    "status = 'failed'",
    "outcome = 'failed'",
    "status = 'outcome_unknown'",
  ]) assert.equal(migration.includes(required), true, required);
  const resultCheck = migration.slice(
    migration.indexOf("constraint workflow_model_invocations_result_check"),
    migration.indexOf("constraint workflow_model_invocations_usage_check"),
  );
  assert.equal(resultCheck.includes("outcome in ('succeeded', 'failed')"), false);
  assert.match(
    migration,
    /status = 'succeeded'[\s\S]+?outcome is not null[\s\S]+?outcome = 'succeeded'/u,
  );
  assert.match(
    migration,
    /status = 'failed'[\s\S]+?outcome is not null[\s\S]+?outcome = 'failed'/u,
  );
});

test("model invocation reservation is factual, precedes any provider boundary, and stores no request bodies", async () => {
  let storedReservationToken: unknown;
  const reservation = invocationReservation();
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    {
      tag: "workflow-runtime:reserve-model-invocation",
      rowCount: 1,
      inspect(values) {
        storedReservationToken = values[13];
        const serialized = JSON.stringify(values);
        assert.equal(serialized.includes("sensitive prompt sentinel"), false);
        assert.equal(serialized.includes("messages"), false);
        assert.equal(values.includes(invocationRequestFingerprint), true);
      },
    },
  ]);
  assert.deepEqual(
    await createStore(database).reserveModelInvocation(reservation),
    { status: "reserved" },
  );
  assert.equal("reservationToken" in reservation, false);
  assert.match(storedReservationToken as string, /^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
  assert.equal(Object.values(reservation).includes(storedReservationToken as string), false);
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  const audit = database.queries.find((query) => query.tag === "workflow-runtime:audit-event");
  assert.ok(audit);
  assert.equal(JSON.stringify(audit.values).includes(storedReservationToken as string), false);
  const readModelSource = readFileSync(
    new URL("../lib/db/workflow-runtime-read-model.ts", import.meta.url),
    "utf8",
  );
  assert.equal(readModelSource.includes("reservation_token"), false);
  database.done();
});

test("durable invocation replay survives store recreation while changed fingerprint conflicts", async () => {
  for (const [reservation, expected] of [
    [invocationReservation(), "replay"],
    [invocationReservation({ requestFingerprint: `sha256:${"e".repeat(64)}` }), "conflict"],
  ] as const) {
    const database = new ScriptedDatabase([
      { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
      { tag: "workflow-runtime:reserve-model-invocation", rowCount: 0 },
      { tag: "workflow-runtime:read-reserved-model-invocation", rows: [
        invocationRow({ status: "succeeded", outcome: "succeeded", finish_reason: "stop",
          input_tokens: "10", output_tokens: "5", total_tokens: "15", latency_ms: "7",
          cost_usd_micros: "11" }),
      ] },
    ]);
    const recreated = createStore(database);
    assert.deepEqual(await recreated.reserveModelInvocation(reservation), { status: expected });
    database.done();
  }
});

test("two concurrent factual reservations have one winner and one recovery-required loser", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    { tag: "workflow-runtime:reserve-model-invocation", rowCount: 1 },
    { tag: "workflow-runtime:reserve-model-invocation", rowCount: 0 },
    { tag: "workflow-runtime:read-reserved-model-invocation", rows: [invocationRow()] },
  ]);
  const firstStore = createStore(database);
  const secondStore = createStore(database);
  const decisions = await Promise.all([
    firstStore.reserveModelInvocation(invocationReservation()),
    secondStore.reserveModelInvocation(invocationReservation()),
  ]);
  assert.deepEqual(decisions.map((decision) => decision.status).sort(), ["recovery_required", "reserved"]);
  assert.equal(decisions.filter((decision) => decision.status === "reserved").length, 1);
  database.done();
});

test("lost reservation COMMIT acknowledgement reconciles only this caller's reservation token", async () => {
  const ownRow = invocationRow();
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    {
      tag: "workflow-runtime:reserve-model-invocation",
      rowCount: 1,
      inspect(values) { ownRow.reservation_token = values[13] as string; },
    },
    { tag: "workflow-runtime:read-model-invocation", rows: [ownRow] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(
    await createStore(database).reserveModelInvocation(invocationReservation()),
    { status: "reserved" },
  );
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:reserve-model-invocation").length, 1);
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:audit-event").length, 1);
  database.done();
});

test("ambiguous rolled-back contender cannot claim a different token owner's reservation", async () => {
  let winnerToken = "";
  const winnerDatabase = new ScriptedDatabase([
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    {
      tag: "workflow-runtime:reserve-model-invocation",
      rowCount: 1,
      inspect(values) { winnerToken = values[13] as string; },
    },
  ]);
  const winner = await createStore(winnerDatabase).reserveModelInvocation(invocationReservation());
  assert.deepEqual(winner, { status: "reserved" });
  winnerDatabase.done();

  let contenderToken = "";
  const contenderDatabase = new ScriptedDatabase([
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    {
      tag: "workflow-runtime:reserve-model-invocation",
      rowCount: 1,
      inspect(values) { contenderToken = values[13] as string; },
    },
    {
      tag: "workflow-runtime:read-model-invocation",
      rows: [invocationRow({ reservation_token: winnerToken })],
    },
  ]);
  contenderDatabase.commitErrors = 1;
  const contender = await createStore(contenderDatabase)
    .reserveModelInvocation(invocationReservation());
  assert.notEqual(contenderToken, winnerToken);
  assert.deepEqual(contender, { status: "recovery_required" });
  assert.deepEqual([winner.status, contender.status].sort(), ["recovery_required", "reserved"]);
  contenderDatabase.done();
});

test("ambiguous reservation sees an exact terminal row as replay regardless of token", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    { tag: "workflow-runtime:reserve-model-invocation", rowCount: 1 },
    { tag: "workflow-runtime:read-model-invocation", rows: [invocationRow({
      reservation_token: otherReservationToken,
      status: "succeeded",
      outcome: "succeeded",
      finish_reason: "stop",
      input_tokens: "10",
      output_tokens: "5",
      total_tokens: "15",
      latency_ms: "7",
      cost_usd_micros: "11",
    })] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(
    await createStore(database).reserveModelInvocation(invocationReservation()),
    { status: "replay" },
  );
  database.done();
});

test("ambiguous reservation with an unknown stored lifecycle fails closed", async () => {
  const unknownRow = invocationRow({ status: "corrupted" });
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    {
      tag: "workflow-runtime:reserve-model-invocation",
      rowCount: 1,
      inspect(values) { unknownRow.reservation_token = values[13] as string; },
    },
    { tag: "workflow-runtime:read-model-invocation", rows: [unknownRow] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(
    await createStore(database).reserveModelInvocation(invocationReservation()),
    { status: "recovery_required" },
  );
  database.done();
});

test("unreadable lost reservation or terminal acknowledgement requires recovery", async () => {
  const reservationDatabase = new ScriptedDatabase([
    { tag: "workflow-runtime:model-invocation-execution", rows: [executionIdentityRow()] },
    { tag: "workflow-runtime:reserve-model-invocation", rowCount: 1 },
    { tag: "workflow-runtime:read-model-invocation", error: new Error("unreadable") },
  ]);
  reservationDatabase.commitErrors = 1;
  assert.deepEqual(
    await createStore(reservationDatabase).reserveModelInvocation(invocationReservation()),
    { status: "recovery_required" },
  );

  const outcomeDatabase = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
    { tag: "workflow-runtime:read-model-invocation", error: new Error("unreadable") },
  ]);
  outcomeDatabase.commitErrors = 1;
  assert.deepEqual(
    await createStore(outcomeDatabase).recordModelInvocationOutcome(invocationOutcome()),
    { status: "recovery_required" },
  );
  reservationDatabase.done();
  outcomeDatabase.done();
});

test("model invocation terminal usage is exact-once and conflicting terminal data fails closed", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    {
      tag: "workflow-runtime:complete-model-invocation",
      rowCount: 1,
      inspect(values) {
        assert.equal(values[6], 10);
        assert.equal(values[8], 15);
        assert.equal(values[10], 11);
      },
    },
    { tag: "workflow-runtime:lock-model-invocation", rows: [{
      ...invocationRow({ status: "succeeded", outcome: "succeeded", finish_reason: "stop",
        input_tokens: "10", output_tokens: "5", total_tokens: "15", latency_ms: "7",
        cost_usd_micros: "11" }), db_run_id: dbRunId,
    }] },
    { tag: "workflow-runtime:lock-model-invocation", rows: [{
      ...invocationRow({ status: "succeeded", outcome: "succeeded", finish_reason: "stop",
        input_tokens: "10", output_tokens: "5", total_tokens: "15", latency_ms: "7",
        cost_usd_micros: "11" }), db_run_id: dbRunId,
    }] },
  ]);
  const store = createStore(database);
  assert.deepEqual(await store.recordModelInvocationOutcome(invocationOutcome()), { status: "recorded" });
  assert.deepEqual(await store.recordModelInvocationOutcome(invocationOutcome()), { status: "idempotent" });
  assert.deepEqual(
    await store.recordModelInvocationOutcome(invocationOutcome({ costUsdMicros: 12 })),
    { status: "conflict" },
  );
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:complete-model-invocation").length, 1);
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:audit-event").length, 1);
  database.done();
});

test("ambiguous model outcome stores no fabricated usage and lost terminal COMMIT reconciles", async () => {
  const ambiguous = invocationOutcome({
    status: "outcome_unknown", outcome: null, finishReason: null,
    inputTokens: null, outputTokens: null, totalTokens: null,
    latencyMs: null, costUsdMicros: null, errorCode: "provider_exception",
  });
  const terminal = invocationRow({
    status: "outcome_unknown", error_code: "provider_exception",
  });
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    {
      tag: "workflow-runtime:complete-model-invocation",
      rowCount: 1,
      inspect(values) {
        assert.deepEqual(values.slice(4, 11), [null, null, null, null, null, null, null]);
      },
    },
    { tag: "workflow-runtime:read-model-invocation", rows: [terminal] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(ambiguous), { status: "recorded" });
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:audit-event").length, 1);
  database.done();
});

test("model invocation operations are workspace isolated and reject invalid identity before SQL", async () => {
  const database = new ScriptedDatabase([]);
  const store = createStore(database);
  assert.deepEqual(
    await store.reserveModelInvocation(invocationReservation({ workspaceId: "workspace-other" })),
    { status: "conflict" },
  );
  assert.deepEqual(
    await store.recordModelInvocationOutcome(invocationOutcome({ workspaceId: "workspace-other" })),
    { status: "conflict" },
  );
  assert.equal(database.queries.length, 0);
});

test("application outcome validation rejects NULL success and failed-plus-succeeded lifecycle shapes", async () => {
  const database = new ScriptedDatabase([]);
  const store = createStore(database);
  assert.deepEqual(await store.recordModelInvocationOutcome(invocationOutcome({
    outcome: null,
  })), { status: "conflict" });
  assert.deepEqual(await store.recordModelInvocationOutcome(invocationOutcome({
    status: "failed",
    outcome: "succeeded",
    errorCode: "provider_failed",
  })), { status: "conflict" });
  assert.equal(database.queries.length, 0);
});

test("production DB source is server-only, bounded, manual-migration-only, and contains no prohibited persistence stack", () => {
  const connectionSource = readFileSync(new URL("../lib/db/postgres.ts", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../lib/db/workflow-runtime-store.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../db/migrations/0002_workflow_runtime_durability.sql", import.meta.url),
    "utf8",
  );
  assert.equal(connectionSource.includes("process.env.DATABASE_URL"), true);
  assert.equal(connectionSource.includes("typeof window"), true);
  assert.equal(connectionSource.includes("console."), false);
  assert.equal(connectionSource.includes("migration"), false);
  for (const source of [connectionSource, storeSource, migration]) {
    for (const token of [
      "Prisma", "Drizzle", "Sequelize", "TypeORM", "Supabase", "SQLite",
      "Redis", "BullMQ", "fetch(", "app/api", "Coding Worker", "Qwen", "Codex",
    ]) assert.equal(source.includes(token), false, token);
  }
  for (const token of ["prepared_provider_request", "api_key", "credential_value", "approval_evidence"]) {
    assert.equal(migration.includes(token), false, token);
  }
});
