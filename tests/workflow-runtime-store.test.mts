import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const storeContract = (await import(
  new URL("../lib/db/workflow-runtime-store.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-store");
const {
  PostgresWorkflowRuntimeStateStore,
  postgresWorkflowRuntimeStoreLimits,
} = storeContract;
const tenantContract = (await import(
  new URL("../lib/db/workflow-runtime-tenant.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-tenant");
const { createPostgresWorkflowRuntimeTenantResolver } = tenantContract;
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
const modelInvocationDatabaseId = "00000000-0000-4000-8000-000000000973";

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
    providerModelId: "provider/model:alias",
    providerRequestModelId: "provider/model:v1",
    providerModelVersion: "version-1",
    ...overrides,
  } as import("../lib/workflows/agent-step-runtime").AgentStepModelInvocationReservation;
}

function budgetReservation(overrides: Record<string, unknown> = {}) {
  return {
    ...invocationReservation(),
    departmentId: "department-one",
    workflowBindingId: "workflow-binding-one",
    workflowBindingVersion: 8,
    inputEnvelopeFingerprint: `sha256:${"e".repeat(64)}`,
    canonicalRequestFingerprint: `sha256:${"f".repeat(64)}`,
    inputTokenCount: 10,
    effectiveMaxOutputTokens: 4_000,
    reservedTotalTokens: 4_010,
    reservedCostUsdMicros: 8_010,
    dailyTokenBudget: 1_000_000,
    monthlyCostBudgetUsdMicros: 2_500_000_000,
    ...overrides,
  } as import("../lib/workflows/agent-step-runtime").AgentStepModelBudgetReservation;
}

function executionIdentityRow(overrides: Record<string, unknown> = {}) {
  return {
    workflow_execution_id: "00000000-0000-4000-8000-000000000971",
    db_run_id: dbRunId,
    execution_id: "runtime-one",
    step_id: "step-one",
    attempt_number: 1,
    expected_revision: "1",
    execution_status: "prepared",
    run_revision: "1",
    ...overrides,
  };
}

function invocationRow(overrides: Record<string, unknown> = {}) {
  return {
    model_invocation_id: modelInvocationDatabaseId,
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
    provider_model_id: "provider/model:alias",
    provider_request_model_id: "provider/model:v1",
    provider_model_version: "version-1",
    provider_identity_version: 2,
    execution_status: "running",
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

function budgetReservationRow(overrides: Record<string, unknown> = {}) {
  return {
    model_invocation_id: modelInvocationDatabaseId,
    status: "reserved",
    invocation_id: "invocation-one",
    project_id: "project-one",
    department_id: "department-one",
    workflow_id: "workflow-one",
    workflow_binding_id: "workflow-binding-one",
    workflow_binding_version: "8",
    request_fingerprint: invocationRequestFingerprint,
    input_envelope_fingerprint: `sha256:${"e".repeat(64)}`,
    canonical_request_fingerprint: `sha256:${"f".repeat(64)}`,
    provider_id: "provider-one",
    deployment_id: "deployment-one",
    provider_model_id: "provider/model:alias",
    provider_request_model_id: "provider/model:v1",
    provider_model_version: "version-1",
    input_token_count: "10",
    effective_max_output_tokens: "4000",
    reserved_total_tokens: "4010",
    reserved_cost_usd_micros: "8010",
    daily_token_budget: "1000000",
    monthly_cost_budget_usd_micros: "2500000000",
    daily_window_start: "2026-09-01",
    monthly_window_start: "2026-09-01",
    actual_total_tokens: null,
    actual_cost_usd_micros: null,
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
        if (tag === "workflow-runtime:audit-event"
          && this.steps[0]?.tag !== "workflow-runtime:audit-event") {
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

const tenant = await createPostgresWorkflowRuntimeTenantResolver({
  async connect() {
    return {
      async query() {
        return {
          rows: [{
            workspace_database_id: workspaceDatabaseId,
            domain_workspace_id: "workspace-primary",
            status: "active",
          }],
          rowCount: 1,
        };
      },
      release() {},
    };
  },
}).resolve("workspace-primary");
if (!tenant) throw new Error("Test tenant resolution failed.");
const resolvedTenant = tenant;

function createStore(
  database: ScriptedDatabase,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return new PostgresWorkflowRuntimeStateStore({
    database,
    tenant: resolvedTenant,
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

function auditResponseWithLastStepResult() {
  return {
    ...auditResponse(),
    status: "completed" as const,
    revision: 2,
    workflowStatus: "completed" as const,
    readyStepIds: [],
    lastStepResult: {
      stepId: "step-one",
      outcome: "succeeded" as const,
      finishReason: "stop" as const,
      providerId: "provider-one",
      providerModelId: "provider/model:alias",
      providerRequestModelId: "provider/model:pinned",
      providerModelVersion: "provider/model:returned",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      latencyMs: 7,
      costUsdMicros: 11,
    },
  };
}

function mutableAuditResponseWithLastStepResult() {
  const response = structuredClone(auditResponseWithLastStepResult()) as unknown as Record<string, unknown>;
  const lastStepResult = response.lastStepResult;
  assert.ok(typeof lastStepResult === "object" && lastStepResult !== null
    && !Array.isArray(lastStepResult));
  return { response, lastStepResult: lastStepResult as Record<string, unknown> };
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

test("runtime persistence rejects an independently paired domain workspace and DB UUID", () => {
  const database = new ScriptedDatabase([]);
  assert.throws(() => new PostgresWorkflowRuntimeStateStore({
    database,
    workspaceId: "workspace-a",
    workspaceDatabaseId: "00000000-0000-4000-8000-000000000002",
  } as never), /configuration is invalid/u);
});

test("migration 0007 defines a same-workspace document-to-collection relationship", () => {
  const migrationUrl = new URL(
    "../db/migrations/0007_workspace_tenant_integrity.sql",
    import.meta.url,
  );
  assert.equal(existsSync(migrationUrl), true);
  const migration = readFileSync(migrationUrl, "utf8").toLowerCase();
  assert.match(
    migration,
    /foreign key \(workspace_id, collection_id\)[\s\S]+references knowledge_collections \(workspace_id, id\)/u,
  );
});

test("migration 0007 preserves the complete Workspace tenant-integrity boundary", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0007_workspace_tenant_integrity.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  for (const token of [
    "domain_workspace_id text",
    "workspaces_domain_workspace_id_required",
    "workspaces_domain_workspace_id_unique",
    "knowledge_documents_collection_workspace_fk",
    "document_chunks_document_workspace_fk",
    "assistant_messages_thread_workspace_fk",
    "workflow_step_runs_run_workspace_fk",
    "workflow_runtime_commands_run_workspace_fk",
    "workflow_runtime_claims_run_workspace_fk",
    "workflow_runtime_executions_run_workspace_fk",
    "workflow_runtime_executions_claim_workspace_fk",
    "approval_requests_run_workspace_fk",
    "workflow_model_budget_reservations_invocation_workspace_fk",
    "audit_events_runtime_run_workspace_fk",
    "workflow_runs_approval_request_workspace_fk",
    "member_role_assignments_workspace_trigger",
    "roles_assignments_workspace_update_trigger",
    "workspace_members_assignments_workspace_update_trigger",
    "roles_global_system_check",
    "knowledge_collections_created_by_member_fk",
    "knowledge_documents_uploaded_by_member_fk",
    "assistant_threads_created_by_member_fk",
    "assistant_messages_created_by_member_fk",
    "workflow_runs_created_by_member_fk",
    "workflow_runs_assigned_to_member_fk",
    "approval_requests_requested_by_member_fk",
    "approval_requests_approved_by_member_fk",
    "approval_requests_rejected_by_member_fk",
    "audit_events_actor_user_member_fk",
  ]) assert.equal(migration.includes(token), true, token);
  assert.match(
    migration,
    /where id = '00000000-0000-4000-8000-000000000001'[\s\S]+slug = 'smart-algorithms-demo'/u,
  );
  assert.equal(migration.includes("lower(name)"), false);
  assert.equal(migration.includes("delete from"), false);
});

test("demo seed explicitly preserves the factual domain Workspace mapping across upgrade order", () => {
  const seed = readFileSync(
    new URL("../db/seeds/0001_seed_smart_algorithms_demo.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  assert.match(seed, /domain_workspace_id[\s\S]+smart-algorithms-demo/u);
  assert.match(seed, /information_schema\.columns/u);
});

test("migration rejects runtime audit identity when its Workspace is NULL", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0007_workspace_tenant_integrity.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  assert.match(
    migration,
    /audit_events_runtime_workspace_required[\s\S]+runtime_run_id is null or workspace_id is not null/u,
  );
});

test("migration preserves historical member attribution while allowing current assignment cleanup", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0007_workspace_tenant_integrity.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  for (const column of [
    "created_by",
    "requested_by",
    "approved_by",
    "rejected_by",
    "actor_user_id",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`on delete set null \\(${column}\\)`, "u"));
  }
  assert.match(
    migration,
    /workflow_runs_assigned_to_member_fk[\s\S]+on delete set null \(assigned_to\)/u,
  );
});

test("demo seed fails closed instead of rebinding its canonical Workspace identity", () => {
  const seed = readFileSync(
    new URL("../db/seeds/0001_seed_smart_algorithms_demo.sql", import.meta.url),
    "utf8",
  ).toLowerCase();
  assert.equal(seed.includes("on conflict (slug) do update"), false);
  assert.match(seed, /smart_algorithms_demo_workspace_identity/u);
  assert.match(seed, /domain_workspace_id = 'smart-algorithms-demo'[\s\S]+id <> '00000000-0000-4000-8000-000000000001'/u);
});

test("contradictory runtime audit collision rolls back its surrounding state mutation", async () => {
  const state = createWorkflowRuntimeStateFixture() as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:create-run", rows: [{ id: dbRunId }] },
    { tag: "workflow-runtime:create-step", rowCount: 1 },
    { tag: "workflow-runtime:audit-event", rowCount: 0 },
    {
      tag: "workflow-runtime:audit-event-existing",
      rows: [{
        workspace_id: workspaceDatabaseId,
        actor_kind: "workflow_runtime",
        actor_id: "workflow-runtime",
        event_type: "workflow.contradictory_event",
        entity_type: "workflow_runtime",
        runtime_run_id: "run-one",
        runtime_event_key: "run-one:created",
        metadata: { runId: "run-one", revision: 999 },
      }],
    },
  ]);
  await assert.rejects(createStore(database).create({ state }), /audit event collision/u);
  assert.deepEqual(database.transactions, ["begin", "rollback"]);
  database.done();
});

test("exact runtime audit replay is idempotent inside its state transaction", async () => {
  const state = createWorkflowRuntimeStateFixture() as RuntimeState;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:create-run", rows: [{ id: dbRunId }] },
    { tag: "workflow-runtime:create-step", rowCount: 1 },
    { tag: "workflow-runtime:audit-event", rowCount: 0 },
    {
      tag: "workflow-runtime:audit-event-existing",
      rows: [{
        workspace_id: workspaceDatabaseId,
        actor_kind: "workflow_runtime",
        actor_id: "workflow-runtime",
        event_type: "workflow.run_created",
        entity_type: "workflow_runtime",
        runtime_run_id: "run-one",
        runtime_event_key: "run-one:created",
        metadata: {
          runId: "run-one",
          projectId: state.snapshot.projectId,
          workflowId: state.snapshot.workflowId,
          revision: state.snapshot.revision,
        },
      }],
    },
  ]);
  await createStore(database).create({ state });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  database.done();
});

for (const [label, existingOverride] of [
  ["event type", { event_type: "workflow.changed" }],
  ["Run", { runtime_run_id: "run-other" }],
  ["actor", { actor_id: "owner-other" }],
  ["metadata", { metadata: { runId: "run-one", revision: 999 } }],
] as const) {
  test(`runtime audit same-key collision with changed ${label} fails closed`, async () => {
    const state = createWorkflowRuntimeStateFixture() as RuntimeState;
    const existing = Object.assign({
      workspace_id: workspaceDatabaseId,
      actor_kind: "workflow_runtime",
      actor_id: "workflow-runtime",
      event_type: "workflow.run_created",
      entity_type: "workflow_runtime",
      runtime_run_id: "run-one",
      runtime_event_key: "run-one:created",
      metadata: {
        runId: "run-one",
        projectId: state.snapshot.projectId,
        workflowId: state.snapshot.workflowId,
        revision: state.snapshot.revision,
      },
    }, existingOverride);
    const database = new ScriptedDatabase([
      { tag: "workflow-runtime:create-run", rows: [{ id: dbRunId }] },
      { tag: "workflow-runtime:create-step", rowCount: 1 },
      { tag: "workflow-runtime:audit-event", rowCount: 0 },
      { tag: "workflow-runtime:audit-event-existing", rows: [existing] },
    ]);
    await assert.rejects(createStore(database).create({ state }), /audit event collision/u);
    assert.deepEqual(database.transactions, ["begin", "rollback"]);
    database.done();
  });
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

test("legacy completed command replay represents missing pinned identity as factual null", async () => {
  const { response, lastStepResult } = mutableAuditResponseWithLastStepResult();
  delete lastStepResult.providerRequestModelId;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
    { tag: "workflow-runtime:begin-command", rowCount: 0 },
    { tag: "workflow-runtime:read-command", rows: [{
      fingerprint,
      expected_revision: "1",
      status: "completed",
      response_payload: response,
      lease_expires_at: "2026-09-01T10:01:00.000Z",
      effect_started_at: "2026-09-01T10:00:01.000Z",
    }] },
  ]);
  const result = await createStore(database).beginCommand(commandInput());
  assert.equal(result.status, "replay");
  assert.equal(result.status === "replay"
    ? result.response.lastStepResult?.providerRequestModelId
    : "not-replay", null);
  assert.equal(JSON.stringify(result).includes("provider/model:pinned"), false);
  assert.equal(JSON.stringify(result).includes("provider/model:alias"), true);
  assert.equal(JSON.stringify(result).includes("provider/model:returned"), true);
  assert.deepEqual(database.queries.map((query) => query.tag), [
    "workflow-runtime:command-run",
    "workflow-runtime:begin-command",
    "workflow-runtime:read-command",
  ]);
});

test("current completed command response round-trips its explicit pinned identity unchanged", async () => {
  const response = auditResponseWithLastStepResult();
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
    { tag: "workflow-runtime:begin-command", rowCount: 0 },
    { tag: "workflow-runtime:read-command", rows: [{
      fingerprint,
      expected_revision: "1",
      status: "completed",
      response_payload: response,
      lease_expires_at: "2026-09-01T10:01:00.000Z",
      effect_started_at: "2026-09-01T10:00:01.000Z",
    }] },
  ]);
  const result = await createStore(database).beginCommand(commandInput());
  assert.equal(result.status, "replay");
  assert.deepEqual(result.status === "replay" ? result.response : null, response);
});

test("only true pinned-field absence qualifies as a legacy completed response", async () => {
  for (const providerRequestModelId of ["", "   ", "unsafe\nmodel", 42, null, false]) {
    const { response, lastStepResult } = mutableAuditResponseWithLastStepResult();
    lastStepResult.providerRequestModelId = providerRequestModelId;
    const database = new ScriptedDatabase([
      { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
      { tag: "workflow-runtime:begin-command", rowCount: 0 },
      { tag: "workflow-runtime:read-command", rows: [{
        fingerprint,
        expected_revision: "1",
        status: "completed",
        response_payload: response,
        lease_expires_at: "2026-09-01T10:01:00.000Z",
        effect_started_at: "2026-09-01T10:00:01.000Z",
      }] },
    ]);
    await assert.rejects(
      createStore(database).beginCommand(commandInput()),
      /Stored Workflow runtime response is invalid/u,
    );
  }
});

test("changed command identity still conflicts before legacy response compatibility", async () => {
  const { response, lastStepResult } = mutableAuditResponseWithLastStepResult();
  delete lastStepResult.providerRequestModelId;
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:command-run", rows: [{ db_run_id: dbRunId }] },
    { tag: "workflow-runtime:begin-command", rowCount: 0 },
    { tag: "workflow-runtime:read-command", rows: [{
      fingerprint: "b".repeat(64),
      expected_revision: "1",
      status: "completed",
      response_payload: response,
      lease_expires_at: "2026-09-01T10:01:00.000Z",
      effect_started_at: "2026-09-01T10:00:01.000Z",
    }] },
  ]);
  assert.deepEqual(await createStore(database).beginCommand(commandInput()), {
    status: "conflict",
  });
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

test("provider-start fence atomically requires the exact running invocation reservation", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:read-execution",
      rows: [executionBoundaryRow()],
    },
    {
      tag: "workflow-runtime:provider-start-invocation",
      rows: [{ status: "running", budget_status: "reserved" }],
      inspect(values) {
        assert.deepEqual(values, [
          workspaceDatabaseId,
          "run-one",
          claimId,
          "runtime-one",
          "invocation-one",
          invocationRequestFingerprint,
          2,
          "step-one",
          1,
          "project-one",
          "workflow-one",
          "agent-one",
          "binding-agent-one",
          "model-one",
          "provider-one",
          "deployment-one",
          "provider/model:alias",
          "provider/model:v1",
          "version-1",
          "department-one",
          "workflow-binding-one",
          8,
          `sha256:${"e".repeat(64)}`,
          `sha256:${"f".repeat(64)}`,
          10,
          4_000,
          4_010,
          8_010,
          1_000_000,
          2_500_000_000,
        ]);
      },
    },
    { tag: "workflow-runtime:provider-start-prior-dispatch", rows: [{ prior_dispatch: false }] },
    { tag: "workflow-runtime:start-execution", rowCount: 1 },
  ]);
  assert.deepEqual(await createStore(database, { providerExecutionTiming: trustedTiming(10_000, 300_000) }).startExecution({
    runId: "run-one",
    claimId,
    providerStart: budgetReservation(),
  }), { status: "started", priorDispatch: false });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
  database.done();
});

test("provider-start fence denies missing or terminal invocation authority without starting execution", async () => {
  for (const [rows, expected] of [
    [[], "conflict"],
    [[{ status: "outcome_unknown" }], "recovery_required"],
  ] as const) {
    const database = new ScriptedDatabase([
      { tag: "workflow-runtime:read-execution", rows: [executionBoundaryRow()] },
      { tag: "workflow-runtime:provider-start-invocation", rows },
    ]);
    assert.deepEqual(await createStore(database, { providerExecutionTiming: trustedTiming(10_000, 300_000) }).startExecution({
      runId: "run-one",
      claimId,
      providerStart: budgetReservation(),
    }), { status: expected });
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:start-execution"), false);
    database.done();
  }
});

test("provider-start fence binds the pinned request model and cannot authorize legacy identity", async () => {
  for (const providerStart of [
    budgetReservation({ providerRequestModelId: "provider/model:v2" }),
    budgetReservation(),
  ]) {
    const database = new ScriptedDatabase([
      { tag: "workflow-runtime:read-execution", rows: [executionBoundaryRow()] },
      {
        tag: "workflow-runtime:provider-start-invocation",
        rows: [],
        inspect(values) {
          assert.equal(values[17], providerStart.providerRequestModelId);
        },
      },
    ]);
    assert.deepEqual(await createStore(database, { providerExecutionTiming: trustedTiming(10_000, 300_000) }).startExecution({
      runId: "run-one",
      claimId,
      providerStart,
    }), { status: "conflict" });
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:start-execution"), false);
    database.done();
  }
  const source = readFileSync(
    new URL("../lib/db/workflow-runtime-store.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /provider_request_model_id = \$18[\s\S]+?provider_identity_version = 2/u);
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
  assert.match(source, /workflow-runtime:provider-start-invocation[\s\S]+?for update of invocation/u);
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

test("HD-12: a known outcome never turns a possibly dispatched execution into a retryable failure", () => {
  const source = readFileSync(
    new URL("../lib/db/workflow-runtime-store.ts", import.meta.url),
    "utf8",
  );
  const known = source.slice(
    source.indexOf("/* workflow-runtime:record-known-execution */"),
    source.indexOf("/* workflow-runtime:read-known-execution */"),
  );
  // Only a `running` execution is terminalized here; its fate is derived from the durable
  // invocation linked to that exact execution, not from the caller.
  assert.match(known, /and execution\.status = 'running'/u);
  assert.match(known, /set status = case when exists \(/u);
  assert.match(known, /from workflow_model_invocations as invocation/u);
  assert.match(known, /invocation\.workspace_id = \$1/u);
  assert.match(known, /invocation\.workflow_execution_id = execution\.id/u);
  // provider started (running), settled success, or ambiguous outcome → unresolved.
  assert.match(known, /invocation\.status in \('running', 'succeeded', 'outcome_unknown'\)/u);
  assert.match(known, /then 'outcome_unknown' else 'failed' end/u);
  // No other path may write a plain `failed` for a running execution.
  assert.equal(known.match(/'failed'/gu)?.length, 1);

  // The unresolved state is what blocks every later claim of the same Step attempt.
  const unresolved = source.slice(
    source.indexOf("/* workflow-runtime:read-unresolved-execution */"),
    source.indexOf("/* workflow-runtime:insert-claim */"),
  );
  assert.match(unresolved, /status in \('prepared', 'running', 'outcome_unknown'\)/u);
  assert.match(unresolved, /return \{ status: "recovery_required" as const, claimId: null \}/u);
  // Claim release keeps its prepared→failed / running→outcome_unknown split.
  assert.match(source, /set status = case when status = 'prepared' then 'failed' else 'outcome_unknown' end/u);
});

test("HD-12: a running execution whose invocation reached the provider is recorded in one guarded statement", async () => {
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:record-known-execution",
      rowCount: 1,
      inspect(values) {
        assert.deepEqual(values.slice(0, 3), [workspaceDatabaseId, "run-one", claimId]);
        assert.equal(values.length, 4);
      },
    },
  ]);
  await createStore(database).recordKnownExecutionOutcome({ runId: "run-one", claimId });
  assert.deepEqual(database.queries.map((query) => query.tag), ["workflow-runtime:record-known-execution"]);
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

test("migration 0005 preserves legacy identity and enforces explicit pinned version 2 writes", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0005_pinned_provider_request_model.sql", import.meta.url),
    "utf8",
  );
  for (const required of [
    "add column provider_request_model_id text",
    "add column provider_identity_version smallint",
    "set provider_identity_version = 1",
    "alter column provider_identity_version set default 2",
    "provider_identity_version in (1, 2)",
    "provider_identity_version = 1 and provider_request_model_id is null",
    "provider_identity_version = 2",
    "provider_request_model_id is not null",
    "provider_request_model_id = btrim(provider_request_model_id)",
  ]) assert.equal(migration.includes(required), true, required);
  for (const unsafeBackfill of [
    "provider_request_model_id = provider_model_id",
    "provider_request_model_id = provider_model_version",
    "__legacy__",
  ]) assert.equal(migration.includes(unsafeBackfill), false, unsafeBackfill);
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
        assert.equal(values[16], "provider/model:alias");
        assert.equal(values[17], "provider/model:v1");
        assert.equal(values[18], "version-1");
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

test("model invocation reservation is pre-provider authority and only accepts a prepared execution", async () => {
  const database = new ScriptedDatabase([{
    tag: "workflow-runtime:model-invocation-execution",
    rows: [executionIdentityRow({ execution_status: "running" })],
  }]);
  assert.deepEqual(
    await createStore(database).reserveModelInvocation(invocationReservation()),
    { status: "conflict" },
  );
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:reserve-model-invocation"), false);
  database.done();
});

test("durable invocation replay requires the same pinned identity and changed identity conflicts", async () => {
  for (const [reservation, expected] of [
    [invocationReservation(), "replay"],
    [invocationReservation({ requestFingerprint: `sha256:${"e".repeat(64)}` }), "conflict"],
    [invocationReservation({ providerRequestModelId: "provider/model:v2" }), "conflict"],
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

test("aggregate budget reservation uses trusted UTC windows and exact replay never double charges", async () => {
  const invocation = { ...invocationRow(), db_run_id: dbRunId };
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:budget-lock-invocation", rows: [invocation] },
    { tag: "workflow-runtime:read-budget-reservation", rows: [] },
    {
      tag: "workflow-runtime:budget-windows",
      rows: [{ daily_window_start: "2026-09-01", monthly_window_start: "2026-09-01" }],
    },
    { tag: "workflow-runtime:ensure-budget-windows", rowCount: 2 },
    { tag: "workflow-runtime:lock-budget-windows", rows: [
      { window_kind: "daily_tokens", reserved_amount: "0", consumed_amount: "0" },
      { window_kind: "monthly_cost", reserved_amount: "0", consumed_amount: "0" },
    ] },
    {
      tag: "workflow-runtime:insert-budget-reservation",
      rowCount: 1,
      inspect(values) {
        assert.deepEqual(values.slice(26, 28), ["2026-09-01", "2026-09-01"]);
      },
    },
    { tag: "workflow-runtime:charge-budget-reservation", rowCount: 2 },
    { tag: "workflow-runtime:budget-lock-invocation", rows: [invocation] },
    { tag: "workflow-runtime:read-budget-reservation", rows: [budgetReservationRow()] },
  ]);
  const store = createStore(database);
  assert.deepEqual(await store.reserveModelInvocationBudget(budgetReservation()), {
    status: "reserved",
  });
  assert.deepEqual(await store.reserveModelInvocationBudget(budgetReservation()), {
    status: "replay",
  });
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:charge-budget-reservation").length, 1);
  database.done();
});

test("aggregate daily and monthly ceilings deny before inserting a reservation", async () => {
  for (const rows of [
    [
      { window_kind: "daily_tokens", reserved_amount: "996000", consumed_amount: "0" },
      { window_kind: "monthly_cost", reserved_amount: "0", consumed_amount: "0" },
    ],
    [
      { window_kind: "daily_tokens", reserved_amount: "0", consumed_amount: "0" },
      { window_kind: "monthly_cost", reserved_amount: "2499995000", consumed_amount: "0" },
    ],
  ]) {
    const database = new ScriptedDatabase([
      { tag: "workflow-runtime:budget-lock-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
      { tag: "workflow-runtime:read-budget-reservation", rows: [] },
      {
        tag: "workflow-runtime:budget-windows",
        rows: [{ daily_window_start: "2026-09-01", monthly_window_start: "2026-09-01" }],
      },
      { tag: "workflow-runtime:ensure-budget-windows", rowCount: 2 },
      { tag: "workflow-runtime:lock-budget-windows", rows },
    ]);
    assert.deepEqual(await createStore(database).reserveModelInvocationBudget(budgetReservation()), {
      status: "budget_exceeded",
    });
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:insert-budget-reservation"), false);
    database.done();
  }
});

test("same invocation with a changed canonical request fingerprint conflicts", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:budget-lock-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    { tag: "workflow-runtime:read-budget-reservation", rows: [budgetReservationRow()] },
  ]);
  assert.deepEqual(await createStore(database).reserveModelInvocationBudget(budgetReservation({
    canonicalRequestFingerprint: `sha256:${"a".repeat(64)}`,
  })), { status: "conflict" });
  database.done();
});

test("pre-generation budget release is idempotent and never increases consumed totals", async () => {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-budget-release", rows: [budgetReservationRow()] },
    {
      tag: "workflow-runtime:release-budget-windows",
      rowCount: 2,
      inspect(values) { assert.deepEqual(values.slice(5), [4_010, 8_010]); },
    },
    {
      tag: "workflow-runtime:mark-budget-released",
      rowCount: 1,
      inspect(values) { assert.equal(values[1], modelInvocationDatabaseId); },
    },
    { tag: "workflow-runtime:lock-budget-release", rows: [budgetReservationRow({ status: "released" })] },
  ]);
  const store = createStore(database);
  assert.deepEqual(await store.releaseModelInvocationBudget(budgetReservation()), {
    status: "released",
  });
  assert.deepEqual(await store.releaseModelInvocationBudget(budgetReservation()), {
    status: "idempotent",
  });
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:release-budget-windows").length, 1);
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
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
    { tag: "workflow-runtime:reconcile-budget-windows", rowCount: 2 },
    { tag: "workflow-runtime:complete-budget-reservation", rowCount: 1 },
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
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
    { tag: "workflow-runtime:reconcile-budget-windows", rowCount: 2 },
    { tag: "workflow-runtime:complete-budget-reservation", rowCount: 1 },
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
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
    { tag: "workflow-runtime:hold-unknown-budget", rowCount: 1 },
    {
      tag: "workflow-runtime:complete-model-invocation",
      rowCount: 1,
      inspect(values) {
        assert.deepEqual(values.slice(4, 11), [null, null, null, null, null, null, null]);
      },
    },
    { tag: "workflow-runtime:read-model-invocation", rows: [terminal] },
    { tag: "workflow-runtime:read-model-budget-reservation", rows: [budgetReservationRow({
      status: "outcome_unknown",
    })] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(ambiguous), { status: "recorded" });
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:audit-event").length, 1);
  database.done();
});

test("definitive pre-generation failure terminalizes without a fabricated budget reservation", async () => {
  const failure = invocationOutcome({
    status: "failed", outcome: null, finishReason: null,
    inputTokens: null, outputTokens: null, totalTokens: null,
    latencyMs: null, costUsdMicros: null, errorCode: "provider_preflight_denied",
  });
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:lock-model-invocation",
      rows: [{ ...invocationRow({ execution_status: "prepared" }), db_run_id: dbRunId }],
    },
    { tag: "workflow-runtime:lock-terminal-budget", rows: [] },
    { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
  ]);
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(failure), {
    status: "recorded",
  });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:reconcile-budget-windows"), false);
  database.done();
});

test("lost pre-generation failure acknowledgement reconciles without a fabricated budget reservation", async () => {
  const failure = invocationOutcome({
    status: "failed", outcome: null, finishReason: null,
    inputTokens: null, outputTokens: null, totalTokens: null,
    latencyMs: null, costUsdMicros: null, errorCode: "provider_preflight_denied",
  });
  const terminal = invocationRow({
    status: "failed", outcome: null, finish_reason: null,
    input_tokens: null, output_tokens: null, total_tokens: null,
    latency_ms: null, cost_usd_micros: null, error_code: "provider_preflight_denied",
  });
  const database = new ScriptedDatabase([
    {
      tag: "workflow-runtime:lock-model-invocation",
      rows: [{ ...invocationRow({ execution_status: "prepared" }), db_run_id: dbRunId }],
    },
    { tag: "workflow-runtime:lock-terminal-budget", rows: [] },
    { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
    { tag: "workflow-runtime:read-model-invocation", rows: [terminal] },
    { tag: "workflow-runtime:read-model-budget-reservation", rows: [] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(failure), {
    status: "recorded",
  });
  assert.equal(database.queries.some(
    (query) => query.tag === "workflow-runtime:reconcile-budget-windows",
  ), false);
  database.done();
});

test("post-reservation failure without factual usage cannot release charged capacity", async () => {
  const failure = invocationOutcome({
    status: "failed", outcome: null, finishReason: null,
    inputTokens: null, outputTokens: null, totalTokens: null,
    latencyMs: null, costUsdMicros: null, errorCode: "invalid_provider_decision",
  });
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
  ]);
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(failure), {
    status: "recovery_required",
  });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:reconcile-budget-windows"), false);
  database.done();
});

test("definitive factual zero-use failure releases its full reservation exactly once", async () => {
  const failure = invocationOutcome({
    status: "failed", outcome: "failed", finishReason: "error",
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    latencyMs: 7, costUsdMicros: 0, errorCode: "provider_rejected",
  });
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
    {
      tag: "workflow-runtime:reconcile-budget-windows",
      rowCount: 2,
      inspect(values) { assert.deepEqual(values.slice(7, 9), [0, 0]); },
    },
    {
      tag: "workflow-runtime:complete-budget-reservation",
      rowCount: 1,
      inspect(values) { assert.deepEqual(values.slice(2), ["released", null, null]); },
    },
    { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
  ]);
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(failure), {
    status: "recorded",
  });
  database.done();
});

test("factual usage above reservation is preserved and returns an invariant violation", async () => {
  const overage = invocationOutcome({
    inputTokens: 10,
    outputTokens: 4_001,
    totalTokens: 4_011,
    costUsdMicros: 8_011,
  });
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
    {
      tag: "workflow-runtime:reconcile-budget-windows",
      rowCount: 2,
      inspect(values) { assert.deepEqual(values.slice(7, 9), [4_011, 8_011]); },
    },
    { tag: "workflow-runtime:complete-budget-reservation", rowCount: 1 },
    { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
  ]);
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(overage), {
    status: "invariant_violation",
  });
  database.done();
});

test("lost overage COMMIT acknowledgement preserves invariant violation without a second mutation", async () => {
  const overage = invocationOutcome({
    inputTokens: 10,
    outputTokens: 4_001,
    totalTokens: 4_011,
    costUsdMicros: 8_011,
  });
  const terminal = invocationRow({
    status: "succeeded", outcome: "succeeded", finish_reason: "stop",
    input_tokens: "10", output_tokens: "4001", total_tokens: "4011",
    latency_ms: "7", cost_usd_micros: "8011",
  });
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
    { tag: "workflow-runtime:reconcile-budget-windows", rowCount: 2 },
    { tag: "workflow-runtime:complete-budget-reservation", rowCount: 1 },
    { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
    { tag: "workflow-runtime:read-model-invocation", rows: [terminal] },
    { tag: "workflow-runtime:read-model-budget-reservation", rows: [budgetReservationRow({
      status: "settled", actual_total_tokens: "4011", actual_cost_usd_micros: "8011",
    })] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(overage), {
    status: "invariant_violation",
  });
  assert.equal(database.queries.filter((query) => query.tag === "workflow-runtime:reconcile-budget-windows").length, 1);
  database.done();
});

test("lost normal settlement acknowledgement proves the terminal budget without an invariant violation", async () => {
  const terminal = invocationRow({
    status: "succeeded", outcome: "succeeded", finish_reason: "stop",
    input_tokens: "10", output_tokens: "5", total_tokens: "15",
    latency_ms: "7", cost_usd_micros: "11",
  });
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
    { tag: "workflow-runtime:reconcile-budget-windows", rowCount: 2 },
    { tag: "workflow-runtime:complete-budget-reservation", rowCount: 1 },
    { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
    { tag: "workflow-runtime:read-model-invocation", rows: [terminal] },
    { tag: "workflow-runtime:read-model-budget-reservation", rows: [budgetReservationRow({
      status: "settled", actual_total_tokens: "15", actual_cost_usd_micros: "11",
    })] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(invocationOutcome()), {
    status: "recorded",
  });
  database.done();
});

test("lost zero-use failure acknowledgement proves the released terminal budget", async () => {
  const failure = invocationOutcome({
    status: "failed", outcome: "failed", finishReason: "error",
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    latencyMs: 7, costUsdMicros: 0, errorCode: "provider_rejected",
  });
  const terminal = invocationRow({
    status: "failed", outcome: "failed", finish_reason: "error",
    input_tokens: "0", output_tokens: "0", total_tokens: "0",
    latency_ms: "7", cost_usd_micros: "0", error_code: "provider_rejected",
  });
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
    { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
    { tag: "workflow-runtime:reconcile-budget-windows", rowCount: 2 },
    { tag: "workflow-runtime:complete-budget-reservation", rowCount: 1 },
    { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
    { tag: "workflow-runtime:read-model-invocation", rows: [terminal] },
    { tag: "workflow-runtime:read-model-budget-reservation", rows: [budgetReservationRow({ status: "released" })] },
  ]);
  database.commitErrors = 1;
  assert.deepEqual(await createStore(database).recordModelInvocationOutcome(failure), {
    status: "recorded",
  });
  database.done();
});

test("ambiguous terminal outcome requires a mutually consistent terminal budget", async () => {
  const terminal = invocationRow({
    status: "succeeded", outcome: "succeeded", finish_reason: "stop",
    input_tokens: "10", output_tokens: "5", total_tokens: "15",
    latency_ms: "7", cost_usd_micros: "11",
  });
  for (const budgetRows of [
    [],
    [budgetReservationRow({ status: "settled", actual_total_tokens: "14", actual_cost_usd_micros: "11" })],
  ]) {
    const database = new ScriptedDatabase([
      { tag: "workflow-runtime:lock-model-invocation", rows: [{ ...invocationRow(), db_run_id: dbRunId }] },
      { tag: "workflow-runtime:lock-terminal-budget", rows: [budgetReservationRow()] },
      { tag: "workflow-runtime:reconcile-budget-windows", rowCount: 2 },
      { tag: "workflow-runtime:complete-budget-reservation", rowCount: 1 },
      { tag: "workflow-runtime:complete-model-invocation", rowCount: 1 },
      { tag: "workflow-runtime:read-model-invocation", rows: [terminal] },
      { tag: "workflow-runtime:read-model-budget-reservation", rows: budgetRows },
    ]);
    database.commitErrors = 1;
    assert.deepEqual(await createStore(database).recordModelInvocationOutcome(invocationOutcome()), {
      status: "recovery_required",
    });
    database.done();
  }
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

test("migration 0006 defines aggregate UTC budget windows and per-invocation reservations", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0006_model_invocation_budgets.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /workflow_model_budget_windows/u);
  assert.match(migration, /workflow_model_budget_reservations/u);
  assert.match(migration, /reserved_amount/u);
  assert.match(migration, /consumed_amount/u);
  assert.match(migration, /outcome_unknown/u);
});

type SessionFault = Readonly<{ begin?: boolean; commit?: boolean; rollback?: boolean; data?: Error }>;

class SessionDatabase {
  readonly releases: Array<boolean | undefined> = [];
  readonly statements: string[] = [];
  readonly fault: SessionFault;
  readonly dataRowCount: number;
  connections = 0;

  constructor(fault: SessionFault, dataRowCount = 1) {
    this.fault = fault;
    this.dataRowCount = dataRowCount;
  }

  async connect(): Promise<SqlClient> {
    this.connections += 1;
    return {
      query: async <Row extends Record<string, unknown>>(text: string) => {
        const control = text.trim().toLowerCase();
        const isControl = ["begin", "commit", "rollback"].includes(control);
        this.statements.push(isControl ? control : text.match(/\/\* ([^*]+) \*\//u)?.[1] ?? "untagged");
        if ((control === "begin" && this.fault.begin) || (control === "commit" && this.fault.commit)
          || (control === "rollback" && this.fault.rollback)) {
          throw new Error(`${control} failed postgres://owner:driver-secret@db.internal`);
        }
        if (!isControl && this.fault.data) throw this.fault.data;
        return { rows: [] as Row[], rowCount: this.dataRowCount };
      },
      release: (destroy?: boolean) => { this.releases.push(destroy); },
    };
  }
}

test("transaction reuses the session only after success or a successful ROLLBACK", async () => {
  const success = new SessionDatabase({});
  await createStore(success as never).abandonCommand(commandOwnershipInput());
  assert.deepEqual(success.statements, ["begin", "workflow-runtime:abandon-command", "commit"]);
  assert.deepEqual(success.releases, [false]);

  const serverError = new SessionDatabase({ data: new Error("duplicate key value violates unique constraint") });
  await assert.rejects(createStore(serverError as never).abandonCommand(commandOwnershipInput()),
    /^WorkflowRuntimePersistenceError: Workflow runtime database operation failed\.$/u);
  assert.deepEqual(serverError.statements, ["begin", "workflow-runtime:abandon-command", "rollback"]);
  assert.deepEqual(serverError.releases, [false]);
});

test("transaction destroys the session when ROLLBACK, COMMIT, or BEGIN fails", async () => {
  const rollbackFails = new SessionDatabase({ data: new Error("statement failed"), rollback: true });
  const rollbackError = await createStore(rollbackFails as never).abandonCommand(commandOwnershipInput())
    .then(() => null, (error: Error) => error);
  assert.equal(rollbackError?.message, "Workflow runtime database operation failed.");
  assert.equal(String(rollbackError).includes("driver-secret"), false);
  assert.deepEqual(rollbackFails.releases, [true]);

  const commitFails = new SessionDatabase({ commit: true });
  const commitError = await createStore(commitFails as never).abandonCommand(commandOwnershipInput())
    .then(() => null, (error: Error) => error);
  assert.equal(commitError?.name, "WorkflowRuntimeCommitAmbiguousError");
  assert.deepEqual(commitFails.statements, ["begin", "workflow-runtime:abandon-command", "commit", "rollback"]);
  assert.deepEqual(commitFails.releases, [true]);

  const beginFails = new SessionDatabase({ begin: true });
  await assert.rejects(createStore(beginFails as never).abandonCommand(commandOwnershipInput()),
    /^WorkflowRuntimePersistenceError: Workflow runtime database operation failed\.$/u);
  assert.deepEqual(beginFails.statements, ["begin", "rollback"]);
  assert.deepEqual(beginFails.releases, [true]);
});

test("single-statement reads destroy the session on failure and reuse it on success", async () => {
  const missing = new SessionDatabase({}, 0);
  assert.equal(await createStore(missing as never).load({ runId: "run-one" }), null);
  assert.deepEqual(missing.releases, [false]);

  const failing = new SessionDatabase({ data: new Error("socket hang up") });
  await assert.rejects(createStore(failing as never).load({ runId: "run-one" }),
    /^WorkflowRuntimePersistenceError: Workflow runtime database load failed\.$/u);
  assert.deepEqual(failing.releases, [true]);
  assert.equal(failing.connections, 1);
});

// ---------------------------------------------------------------------------------------------
// AI-037.1.1 minimal Owner recovery for the HD-12 state.
// ---------------------------------------------------------------------------------------------

const recoveryExecutionDbId = "00000000-0000-4000-8000-000000000971";
const recoveryTarget = { runId: "run-one", stepId: "step-one", executionId: "execution-step-one-one" };
const recoveryAcknowledged = { acknowledgeLostProviderResultAndDuplicateCostRisk: true as const };

const recoveryInvocationDbId = "00000000-0000-4000-8000-000000000981";

// Invocation row, then (only when it exists) its budget reservation as a separate statement.
// Budget fields may be overridden alongside the invocation fields; `budget_status: null` means
// the reservation is missing.
function recoveryInvocationSteps(invocation: Record<string, unknown> | null | undefined): ScriptStep[] {
  if (invocation === null) {
    return [{ tag: "workflow-runtime:recovery-invocation", rows: [] }];
  }
  const merged: Record<string, unknown> = {
    status: "succeeded", total_tokens: "105", cost_usd_micros: "200",
    budget_status: "settled", actual_total_tokens: "105", actual_cost_usd_micros: "200", ...invocation,
  };
  return [
    {
      tag: "workflow-runtime:recovery-invocation",
      rows: [{
        model_invocation_id: recoveryInvocationDbId, invocation_id: "invocation-step-one-one",
        status: merged.status, total_tokens: merged.total_tokens, cost_usd_micros: merged.cost_usd_micros,
      }],
      inspect(values) { assert.deepEqual(values, [workspaceDatabaseId, dbRunId, recoveryExecutionDbId]); },
    },
    {
      tag: "workflow-runtime:recovery-budget",
      rows: merged.budget_status === null ? [] : [{
        status: merged.budget_status,
        actual_total_tokens: merged.actual_total_tokens,
        actual_cost_usd_micros: merged.actual_cost_usd_micros,
      }],
      inspect(values) { assert.deepEqual(values, [workspaceDatabaseId, dbRunId, recoveryInvocationDbId]); },
    },
  ];
}

function recoveryFactSteps(overrides: Readonly<{
  run?: Record<string, unknown>;
  step?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  invocation?: Record<string, unknown> | null;
  occupancy?: Record<string, unknown>;
  audit?: Record<string, unknown> | null;
}> = {}): ScriptStep[] {
  return [
    {
      tag: "workflow-runtime:recovery-run",
      rows: [{ db_run_id: dbRunId, status: "running", revision: "1", runtime_pause: null, ...overrides.run }],
      inspect(values) { assert.deepEqual(values, [workspaceDatabaseId, "run-one"]); },
    },
    {
      tag: "workflow-runtime:recovery-step",
      rows: [{ status: "pending", attempt_count: 0, ...overrides.step }],
      inspect(values) { assert.deepEqual(values, [workspaceDatabaseId, dbRunId, "step-one"]); },
    },
    {
      tag: "workflow-runtime:recovery-execution",
      rows: [{
        id: recoveryExecutionDbId, status: "outcome_unknown", attempt_number: 1, expected_revision: "1",
        claim_status: "released", ...overrides.execution,
      }],
      inspect(values) { assert.deepEqual(values, [workspaceDatabaseId, dbRunId, "step-one", "execution-step-one-one"]); },
    },
    ...recoveryInvocationSteps(overrides.invocation),
    {
      tag: "workflow-runtime:recovery-attempt-occupancy",
      rows: [{ siblings: 0, active_claims: 0, ...overrides.occupancy }],
      inspect(values) {
        assert.deepEqual(values, [workspaceDatabaseId, dbRunId, "step-one", 1, 1, recoveryExecutionDbId]);
      },
    },
    {
      tag: "workflow-runtime:recovery-audit",
      rows: overrides.audit === null || overrides.audit === undefined ? [] : [overrides.audit],
      inspect(values) {
        assert.deepEqual(values, [workspaceDatabaseId, "run-one:execution-recovery:step-one:1:1:execution-step-one-one"]);
      },
    },
  ];
}

const recoveredAudit = {
  actor_id: "owner-one",
  metadata: {
    recoveryAction: "authorize_retry_after_lost_provider_result",
    runId: "run-one",
    stepId: "step-one",
    executionId: "execution-step-one-one",
  },
};

test("AI-037.1.1: the exact HD-12 state is recovered once, with the state change and audit in one transaction", async () => {
  const database = new ScriptedDatabase([
    ...recoveryFactSteps(), // read-only preflight
    ...recoveryFactSteps(), // re-read under locks
    {
      tag: "workflow-runtime:recovery-authorize-execution",
      rowCount: 1,
      inspect(values) { assert.deepEqual(values, [workspaceDatabaseId, recoveryExecutionDbId]); },
    },
    {
      tag: "workflow-runtime:audit-event",
      rowCount: 1,
      inspect(values) {
        assert.equal(values[1], "owner");
        assert.equal(values[2], "owner-one");
        assert.equal(values[3], "workflow.execution_recovery_authorized");
        assert.equal(values[5], "run-one:execution-recovery:step-one:1:1:execution-step-one-one");
        assert.deepEqual(values[6], {
          recoveryAction: "authorize_retry_after_lost_provider_result",
          duplicateCostRiskAcknowledged: "yes",
          runId: "run-one",
          stepId: "step-one",
          executionId: "execution-step-one-one",
          attemptNumber: 1,
          expectedRevision: 1,
          previousExecutionStatus: "outcome_unknown",
          newExecutionStatus: "failed",
          invocationId: "invocation-step-one-one",
          invocationStatus: "succeeded",
          invocationTotalTokens: 105,
          invocationCostUsdMicros: 200,
          budgetStatus: "settled",
        });
      },
    },
  ]);
  const decision = await createStore(database).authorizeRetryAfterLostProviderResult({
    ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged,
  });
  assert.deepEqual(decision, { status: "authorized", reasons: [] });
  // preflight transaction, then the locking transaction holding the mutation and the audit.
  assert.deepEqual(database.transactions, ["begin", "commit", "begin", "commit"]);
  database.done();
  const tags = database.queries.map((query) => query.tag);
  assert.ok(tags.indexOf("workflow-runtime:recovery-authorize-execution") < tags.indexOf("workflow-runtime:audit-event"));
});

test("AI-037.1.1: recovery without the explicit literal acknowledgement never touches the database", async () => {
  for (const acknowledgement of [undefined, false, "true", 1, {}]) {
    const database = new ScriptedDatabase([]);
    const decision = await createStore(database).authorizeRetryAfterLostProviderResult({
      ...recoveryTarget, operatorId: "owner-one", acknowledgeLostProviderResultAndDuplicateCostRisk: acknowledgement,
    } as never);
    assert.deepEqual(decision, { status: "denied", reasons: ["acknowledgement_required"] });
    assert.deepEqual(database.queries, []);
    assert.deepEqual(database.transactions, []);
  }
});

test("AI-037.1.1: only a succeeded invocation with a consistent settled budget is recoverable", async () => {
  const cases: Array<[Record<string, unknown> | null, string]> = [
    [{ status: "running", total_tokens: null, cost_usd_micros: null, budget_status: "reserved",
      actual_total_tokens: null, actual_cost_usd_micros: null }, "invocation_not_succeeded"],
    [{ status: "outcome_unknown", total_tokens: null, cost_usd_micros: null, budget_status: "outcome_unknown",
      actual_total_tokens: null, actual_cost_usd_micros: null }, "invocation_not_succeeded"],
    [{ status: "failed", total_tokens: "0", cost_usd_micros: "0" }, "invocation_not_succeeded"],
    [null, "invocation_missing"],
    [{ budget_status: null, actual_total_tokens: null, actual_cost_usd_micros: null }, "budget_missing"],
    [{ budget_status: "released" }, "budget_not_settled"],
    [{ actual_total_tokens: "104" }, "budget_inconsistent"],
  ];
  for (const [invocation, reason] of cases) {
    const database = new ScriptedDatabase(recoveryFactSteps({ invocation }));
    const decision = await createStore(database).authorizeRetryAfterLostProviderResult({
      ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged,
    });
    assert.equal(decision.status, "denied");
    assert.ok(decision.reasons.includes(reason as never), `${reason} in ${JSON.stringify(decision)}`);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:recovery-authorize-execution"), false);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:audit-event"), false);
    database.done();
  }
});

test("AI-037.1.1: execution, Step, Run, revision and attempt occupancy preconditions are all enforced", async () => {
  const cases: Array<[Parameters<typeof recoveryFactSteps>[0], string]> = [
    [{ execution: { status: "failed" } }, "execution_not_outcome_unknown"],
    [{ execution: { status: "running" } }, "execution_not_outcome_unknown"],
    [{ execution: { claim_status: "active" } }, "claim_active"],
    [{ occupancy: { active_claims: 1 } }, "claim_active"],
    [{ occupancy: { siblings: 1 } }, "newer_execution_exists"],
    [{ run: { revision: "2" } }, "revision_changed"],
    [{ run: { status: "cancelled" } }, "run_not_running"],
    [{ run: { runtime_pause: { kind: "risk_approval" } } }, "run_paused"],
    [{ step: { status: "success" } }, "step_not_pending"],
  ];
  for (const [overrides, reason] of cases) {
    const database = new ScriptedDatabase(recoveryFactSteps(overrides));
    const decision = await createStore(database).authorizeRetryAfterLostProviderResult({
      ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged,
    });
    assert.equal(decision.status, "denied", reason);
    assert.ok(decision.reasons.includes(reason as never), `${reason} in ${JSON.stringify(decision)}`);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:recovery-authorize-execution"), false);
    database.done();
  }
  const missingRun = new ScriptedDatabase([{ tag: "workflow-runtime:recovery-run", rows: [] }]);
  assert.deepEqual(
    await createStore(missingRun).authorizeRetryAfterLostProviderResult({
      ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged,
    }),
    { status: "denied", reasons: ["run_not_found"] },
  );
});

test("AI-037.1.1: an exact replay is idempotent and a different operator conflicts, without mutation", async () => {
  for (const [operatorId, expected] of [
    ["owner-one", { status: "idempotent", reasons: ["already_authorized"] }],
    ["owner-two", { status: "conflict", reasons: ["already_authorized_by_another_operator"] }],
  ] as const) {
    const recovered = { execution: { status: "failed" }, audit: recoveredAudit };
    const database = new ScriptedDatabase([...recoveryFactSteps(recovered), ...recoveryFactSteps(recovered)]);
    const decision = await createStore(database).authorizeRetryAfterLostProviderResult({
      ...recoveryTarget, operatorId, ...recoveryAcknowledged,
    });
    assert.deepEqual(decision, expected);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:recovery-authorize-execution"), false);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:audit-event"), false);
    database.done();
  }
});

test("AI-037.1.1: an ambiguous recovery COMMIT is reconciled from durable state, never retried", async () => {
  for (const [audit, expected] of [
    [null, { status: "recovery_required", reasons: ["commit_outcome_unknown"] }],
    [recoveredAudit, { status: "authorized", reasons: [] }],
  ] as const) {
    const database = new ScriptedDatabase([
      ...recoveryFactSteps(),
      ...recoveryFactSteps(),
      { tag: "workflow-runtime:recovery-authorize-execution", rowCount: 1 },
      { tag: "workflow-runtime:audit-event", rowCount: 1 },
      ...recoveryFactSteps({ execution: { status: audit ? "failed" : "outcome_unknown" }, audit }),
    ]);
    // Lose the acknowledgement of the second COMMIT: the recovery transaction (the first COMMIT
    // belongs to the read-only preflight).
    let commits = 0;
    const lossyDatabase = {
      async connect() {
        const client = await database.connect();
        return {
          query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
            if (text.trim().toLowerCase() === "commit") {
              commits += 1;
              if (commits === 2) {
                await client.query<Row>(text, values);
                throw new Error("lost PostgreSQL COMMIT acknowledgement");
              }
            }
            return client.query<Row>(text, values);
          },
          release: (destroy?: boolean) => client.release(destroy),
        };
      },
    };
    const decision = await new PostgresWorkflowRuntimeStateStore({ database: lossyDatabase as never, tenant: resolvedTenant })
      .authorizeRetryAfterLostProviderResult({ ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged });
    assert.deepEqual(decision, expected);
    assert.equal(
      database.queries.filter((query) => query.tag === "workflow-runtime:recovery-authorize-execution").length, 1,
      "the mutation is never re-sent",
    );
    database.done();
  }
});

test("AI-037.1.1: inspection is read-only and reports eligibility with sanitized facts", async () => {
  const database = new ScriptedDatabase(recoveryFactSteps());
  const inspection = await createStore(database).inspectExecutionRecovery(recoveryTarget);
  assert.equal(inspection.eligible, true);
  assert.deepEqual(inspection.reasons, []);
  assert.equal(inspection.recoveryAuthorizedBy, null);
  assert.deepEqual(inspection.execution, {
    executionId: "execution-step-one-one", status: "outcome_unknown", attemptNumber: 1, expectedRevision: 1,
    claimStatus: "released",
  });
  assert.equal(JSON.stringify(inspection).includes(recoveryExecutionDbId), false);
  assert.equal(JSON.stringify(inspection).includes(dbRunId), false);
  assert.equal(database.queries.some((query) => query.tag.includes("authorize") || query.tag.includes("audit-event")), false);
  database.done();
  const invalid = new ScriptedDatabase([]);
  const rejected = await createStore(invalid).inspectExecutionRecovery({ ...recoveryTarget, runId: "Run One" });
  assert.equal(rejected.eligible, false);
  assert.deepEqual(rejected.reasons, ["invalid_target"]);
  assert.deepEqual(invalid.queries, []);
});

// Records the SQL text sent through a ScriptedDatabase so row-lock clauses can be asserted.
function recordingSql(database: ScriptedDatabase) {
  const statements: Array<{ tag: string; text: string }> = [];
  return {
    statements,
    database: {
      async connect() {
        const client = await database.connect();
        return {
          query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
            const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1];
            if (tag) statements.push({ tag, text: text.replace(/\s+/gu, " ").trim() });
            return client.query<Row>(text, values);
          },
          release: (destroy?: boolean) => client.release(destroy),
        };
      },
    },
  };
}

test("AI-037.1.1: authorization locks every eligibility fact in order Run → Step → execution/claim → invocation → budget → audit; inspection takes no locks", async () => {
  const lockOf = (text: string) => text.match(/ for (update( of [a-z, ]+?)?|share)( nowait)?$/u)?.[0].trim() ?? null;

  const authorizing = recordingSql(new ScriptedDatabase([
    ...recoveryFactSteps(),
    ...recoveryFactSteps(),
    { tag: "workflow-runtime:recovery-authorize-execution", rowCount: 1 },
    { tag: "workflow-runtime:audit-event", rowCount: 1 },
  ]));
  const decision = await new PostgresWorkflowRuntimeStateStore({
    database: authorizing.database as never,
    tenant: resolvedTenant,
  }).authorizeRetryAfterLostProviderResult({ ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged });
  assert.deepEqual(decision, { status: "authorized", reasons: [] });
  const factStatements = authorizing.statements.filter((statement) => statement.tag !== "workflow-runtime:recovery-attempt-occupancy"
    && statement.tag.startsWith("workflow-runtime:recovery-") && statement.tag !== "workflow-runtime:recovery-authorize-execution");
  // The read-only preflight requests no row locks at all.
  assert.deepEqual(factStatements.slice(0, 6).map((statement) => [statement.tag, lockOf(statement.text)]), [
    ["workflow-runtime:recovery-run", null],
    ["workflow-runtime:recovery-step", null],
    ["workflow-runtime:recovery-execution", null],
    ["workflow-runtime:recovery-invocation", null],
    ["workflow-runtime:recovery-budget", null],
    ["workflow-runtime:recovery-audit", null],
  ]);
  // The locking transaction takes every lock NOWAIT, in order Run → … → audit.
  assert.deepEqual(factStatements.slice(6).map((statement) => [statement.tag, lockOf(statement.text)]), [
    ["workflow-runtime:recovery-run", "for update nowait"],
    ["workflow-runtime:recovery-step", "for update nowait"],
    ["workflow-runtime:recovery-execution", "for update of execution, claim nowait"],
    ["workflow-runtime:recovery-invocation", "for update of invocation nowait"],
    ["workflow-runtime:recovery-budget", "for update of budget nowait"],
    ["workflow-runtime:recovery-audit", "for share nowait"],
  ]);
  const budget = authorizing.statements.find((statement) => statement.tag === "workflow-runtime:recovery-budget"
    && lockOf(statement.text) !== null);
  assert.ok(budget);
  assert.match(budget.text, /from workflow_model_budget_reservations as budget/u);
  assert.match(budget.text, /budget\.model_invocation_id = \$3::uuid/u);
  // The invocation statement no longer joins the budget; the budget has its own row lock.
  const invocation = authorizing.statements.find((statement) => statement.tag === "workflow-runtime:recovery-invocation"
    && lockOf(statement.text) !== null);
  assert.ok(invocation);
  assert.equal(/budget/u.test(invocation.text), false);
  const tags = authorizing.statements.map((statement) => statement.tag);
  assert.ok(tags.lastIndexOf("workflow-runtime:recovery-budget") < tags.indexOf("workflow-runtime:recovery-authorize-execution"));

  const inspecting = recordingSql(new ScriptedDatabase(recoveryFactSteps()));
  const inspection = await new PostgresWorkflowRuntimeStateStore({
    database: inspecting.database as never,
    tenant: resolvedTenant,
  }).inspectExecutionRecovery(recoveryTarget);
  assert.equal(inspection.eligible, true);
  assert.ok(inspecting.statements.some((statement) => statement.tag === "workflow-runtime:recovery-budget"));
  assert.deepEqual(inspecting.statements.filter((statement) => lockOf(statement.text) !== null), []);
});

test("AI-037.1.1: a clearly ineligible state is denied by the read-only preflight without a locking transaction", async () => {
  const recorded = recordingSql(new ScriptedDatabase(recoveryFactSteps({
    execution: { status: "running", claim_status: "active" },
    invocation: { status: "running", total_tokens: null, cost_usd_micros: null, budget_status: "reserved",
      actual_total_tokens: null, actual_cost_usd_micros: null },
  })));
  const scripted = recorded.database;
  const decision = await new PostgresWorkflowRuntimeStateStore({ database: scripted as never, tenant: resolvedTenant })
    .authorizeRetryAfterLostProviderResult({ ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged });
  assert.equal(decision.status, "denied");
  assert.ok(decision.reasons.includes("claim_active"));
  assert.ok(decision.reasons.includes("invocation_not_succeeded"));
  assert.deepEqual(recorded.statements.filter((statement) => / for (update|share)/u.test(statement.text)), [],
    "no row lock was requested");
  assert.equal(recorded.statements.some((statement) => statement.tag === "workflow-runtime:recovery-authorize-execution"), false);
});

test("AI-037.1.1: a lock held by a live writer (55P03) denies recovery as retryable, rolls back, and writes nothing", async () => {
  const lockUnavailable = Object.assign(new Error("could not obtain lock on row"), { code: "55P03", severity: "ERROR" });
  for (const lockedTag of [
    "workflow-runtime:recovery-run",
    "workflow-runtime:recovery-execution",
    "workflow-runtime:recovery-invocation",
    "workflow-runtime:recovery-budget",
  ]) {
    const locked = recoveryFactSteps();
    const index = locked.findIndex((step) => step.tag === lockedTag);
    const database = new ScriptedDatabase([
      ...recoveryFactSteps(),
      ...locked.slice(0, index),
      { tag: lockedTag, error: lockUnavailable },
    ]);
    const decision = await createStore(database).authorizeRetryAfterLostProviderResult({
      ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged,
    });
    assert.deepEqual(decision, { status: "denied", reasons: ["recovery_lock_unavailable"] }, lockedTag);
    assert.deepEqual(database.transactions, ["begin", "commit", "begin", "rollback"], lockedTag);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:recovery-authorize-execution"), false);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:audit-event"), false);
    assert.equal(JSON.stringify(decision).includes("could not obtain"), false, "no driver detail leaks");
    database.done();
  }
});

test("AI-037.1.1: the re-check under locks rejects a state that changed after the preflight", async () => {
  for (const [changed, reason] of [
    [{ execution: { status: "failed" } }, "execution_not_outcome_unknown"],
    [{ occupancy: { siblings: 1 } }, "newer_execution_exists"],
    [{ run: { revision: "2" } }, "revision_changed"],
    [{ invocation: { budget_status: "released" } }, "budget_not_settled"],
  ] as const) {
    const database = new ScriptedDatabase([
      ...recoveryFactSteps(), // preflight: eligible
      ...recoveryFactSteps(changed as Parameters<typeof recoveryFactSteps>[0]), // under locks: changed
    ]);
    const decision = await createStore(database).authorizeRetryAfterLostProviderResult({
      ...recoveryTarget, operatorId: "owner-one", ...recoveryAcknowledged,
    });
    assert.equal(decision.status, "denied", reason);
    assert.ok(decision.reasons.includes(reason), `${reason} in ${JSON.stringify(decision)}`);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:recovery-authorize-execution"), false);
    assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:audit-event"), false);
    database.done();
  }
});

// ---------------------------------------------------------------------------------------------
// AI-037.6a: provider timeout + safety margin <= claim lease.
// ---------------------------------------------------------------------------------------------

test("AI-037.6a: the store exposes its factual, immutable claim lease for timing composition", () => {
  assert.equal(createStore(new ScriptedDatabase([])).claimLeaseDurationMs, postgresWorkflowRuntimeStoreLimits.defaultLeaseDurationMs);
  const store = createStore(new ScriptedDatabase([]), { leaseDurationMs: postgresWorkflowRuntimeStoreLimits.minimumLeaseDurationMs });
  assert.equal(store.claimLeaseDurationMs, 30_000);
  assert.throws(() => { (store as { claimLeaseDurationMs: number }).claimLeaseDurationMs = 900_000; });
  assert.equal(store.claimLeaseDurationMs, 30_000);
});

const leasePolicy = (await import(
  new URL("../lib/contracts/provider-claim-lease-policy.ts", import.meta.url).href
)) as typeof import("../lib/contracts/provider-claim-lease-policy");

// Trusted timing produced by the composition policy (the same object the provider factory uses).
function trustedTiming(providerTimeoutMs: number, claimLeaseDurationMs: number) {
  const decision = leasePolicy.validateProviderClaimLeaseTiming({ providerTimeoutMs, claimLeaseDurationMs });
  assert.equal(decision.verdict, "allow");
  return decision.timing as NonNullable<typeof decision.timing>;
}

// Claim acquired at 10:00:00.000 with a 30 s lease; provider timeout 10 s + 10 s margin, so the
// provider-start fence needs at least 20 000 ms of remaining lease.
const claimAcquiredAt = Date.parse("2026-09-01T10:00:00.000Z");
const leaseRow = () => executionBoundaryRow({ lease_expires_at: new Date(claimAcquiredAt + 30_000).toISOString() });

async function providerStartAt(elapsedMs: number, options: Readonly<Record<string, unknown>> = {}) {
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:read-execution", rows: [leaseRow()] },
    { tag: "workflow-runtime:provider-start-invocation", rows: [{ status: "running", budget_status: "reserved" }] },
    { tag: "workflow-runtime:provider-start-prior-dispatch", rows: [{ prior_dispatch: false }] },
    { tag: "workflow-runtime:start-execution", rowCount: 1 },
  ]);
  const store = createStore(database, {
    providerExecutionTiming: trustedTiming(10_000, 30_000),
    now: () => new Date(claimAcquiredAt + elapsedMs),
    ...options,
  });
  const decision = await store.startExecution({ runId: "run-one", claimId, providerStart: budgetReservation() });
  return {
    decision,
    tags: database.queries.map((query) => query.tag),
    transactions: database.transactions,
  };
}

test("AI-037.6a: the provider-start fence requires remaining lease >= provider timeout + safety margin", async () => {
  // remaining 30 000 / 20 001 / 20 000 (exact boundary) → allow
  for (const elapsed of [0, 9_999, 10_000]) {
    const result = await providerStartAt(elapsed);
    assert.deepEqual(result.decision, { status: "started", priorDispatch: false }, `elapsed ${elapsed}`);
    assert.ok(result.tags.includes("workflow-runtime:start-execution"));
  }
  // remaining 19 999 (boundary - 1 ms), a long preflight leaving 5 s, the last live millisecond,
  // exact expiry and an expired claim → deny before any mutation.
  for (const elapsed of [10_001, 25_000, 29_999, 30_000, 31_000]) {
    const result = await providerStartAt(elapsed);
    assert.deepEqual(result.decision, { status: "conflict" }, `elapsed ${elapsed}`);
    assert.deepEqual(result.tags, ["workflow-runtime:read-execution"], `elapsed ${elapsed}: no invocation re-check, no start`);
    assert.deepEqual(result.transactions, ["begin", "commit"]);
  }
});

test("AI-037.6a: provider start fails closed when no trusted provider timing is bound to the store", async () => {
  const database = new ScriptedDatabase([{ tag: "workflow-runtime:read-execution", rows: [leaseRow()] }]);
  const store = createStore(database, { now: () => new Date(claimAcquiredAt) });
  assert.deepEqual(await store.startExecution({ runId: "run-one", claimId, providerStart: budgetReservation() }),
    { status: "conflict" });
  assert.equal(database.queries.some((query) => query.tag === "workflow-runtime:start-execution"), false);
  database.done();
});

test("AI-037.6a: the store binds its claim lease to the trusted timing and rejects forged or drifting timing", () => {
  const timing = trustedTiming(10_000, 30_000);
  assert.equal(createStore(new ScriptedDatabase([]), { providerExecutionTiming: timing }).claimLeaseDurationMs, 30_000);
  assert.equal(createStore(new ScriptedDatabase([]), { providerExecutionTiming: timing, leaseDurationMs: 30_000 })
    .claimLeaseDurationMs, 30_000);
  const forged = [
    { providerTimeoutMs: 1, claimLeaseDurationMs: 30_000, safetyMarginMs: 10_000 },
    Object.freeze({ ...timing }),
    { ...timing, providerTimeoutMs: 1 },
    new Proxy(timing, {}),
    "timing",
  ];
  for (const value of forged) {
    assert.throws(() => createStore(new ScriptedDatabase([]), { providerExecutionTiming: value }),
      { message: "Workflow runtime provider timing is invalid." });
  }
  // A lease that differs from the one the provider timeout was validated against is rejected.
  assert.throws(() => createStore(new ScriptedDatabase([]), { providerExecutionTiming: timing, leaseDurationMs: 300_000 }),
    { message: "Workflow runtime provider timing is invalid." });
  // A trusted timing whose lease is outside the store's lease bounds is rejected by the store.
  assert.throws(() => createStore(new ScriptedDatabase([]), { providerExecutionTiming: trustedTiming(10_000, 20_000) }),
    { message: "Workflow runtime lease policy is invalid." });
});

// The provider-start invocation/budget FOR UPDATE can wait behind a live writer while the lease keeps
// running down. The clock below advances exactly while that statement executes.
async function providerStartWithLockWait(earlyElapsedMs: number, finalElapsedMs: number) {
  const clock = { elapsedMs: earlyElapsedMs };
  const startValues: unknown[][] = [];
  const database = new ScriptedDatabase([
    { tag: "workflow-runtime:read-execution", rows: [leaseRow()] },
    {
      tag: "workflow-runtime:provider-start-invocation",
      rows: [{ status: "running", budget_status: "reserved" }],
      inspect() { clock.elapsedMs = finalElapsedMs; },
    },
    { tag: "workflow-runtime:provider-start-prior-dispatch", rows: [{ prior_dispatch: false }] },
    { tag: "workflow-runtime:start-execution", rowCount: 1, inspect(values) { startValues.push([...values]); } },
  ]);
  const store = createStore(database, {
    providerExecutionTiming: trustedTiming(10_000, 30_000),
    now: () => new Date(claimAcquiredAt + clock.elapsedMs),
  });
  const decision = await store.startExecution({ runId: "run-one", claimId, providerStart: budgetReservation() });
  return { decision, tags: database.queries.map((query) => query.tag), startValues, database };
}

test("AI-037.6a: the authoritative remaining-lease check runs after the invocation/budget locks, on a fresh clock", async () => {
  // Early check sees 20 500 ms (passes); the invocation/budget lock waits 3 s → 17 500 ms remain.
  const waited = await providerStartWithLockWait(9_500, 12_500);
  assert.deepEqual(waited.decision, { status: "conflict" });
  assert.equal(waited.tags.includes("workflow-runtime:provider-start-invocation"), true, "authority was verified first");
  assert.equal(waited.tags.includes("workflow-runtime:start-execution"), false, "no start-execution");

  // Final boundary: exactly timeout + margin remaining → allowed; one millisecond less → denied.
  const boundary = await providerStartWithLockWait(0, 10_000);
  assert.deepEqual(boundary.decision, { status: "started", priorDispatch: false });
  // started_at is the fresh time of the final authorization, not the early read.
  assert.deepEqual(boundary.startValues, [[workspaceDatabaseId, new Date(claimAcquiredAt + 10_000), claimId]]);
  boundary.database.done();

  const short = await providerStartWithLockWait(0, 10_001);
  assert.deepEqual(short.decision, { status: "conflict" });
  assert.equal(short.tags.includes("workflow-runtime:start-execution"), false);
});

// ---------------------------------------------------------------------------------------------
// AI-037.4a: store-owned operational signals (ambiguous_commit, outcome_unknown).
// ---------------------------------------------------------------------------------------------

const runtimeSignals = (await import(
  new URL("../lib/contracts/runtime-operational-signals.ts", import.meta.url).href
)) as typeof import("../lib/contracts/runtime-operational-signals");

function signalStore(steps: ScriptStep[], commitErrors = 0) {
  const collector = runtimeSignals.createRuntimeOperationalSignalCollector();
  const database = new ScriptedDatabase(steps);
  database.commitErrors = commitErrors;
  return { database, collector, store: createStore(database, { signals: collector.sink }) };
}

const releaseSteps = (retired: string | null, claimReleased = 1): ScriptStep[] => [
  { tag: "workflow-runtime:release-read", rows: [{ status: "active" }] },
  { tag: "workflow-runtime:release-execution", rows: retired ? [{ status: retired }] : [] },
  { tag: "workflow-runtime:release-claim", rowCount: claimReleased },
];

test("AI-037.4a: outcome_unknown is emitted once per durable execution transition, only after COMMIT", async () => {
  const running = signalStore(releaseSteps("outcome_unknown"));
  await running.store.releaseClaim({ runId: "run-one", claimId });
  assert.equal(running.collector.snapshot().outcome_unknown, 1);

  const prepared = signalStore(releaseSteps("failed"));
  await prepared.store.releaseClaim({ runId: "run-one", claimId });
  assert.equal(prepared.collector.snapshot().outcome_unknown, 0, "prepared → failed is not an unknown outcome");

  const alreadyTerminal = signalStore(releaseSteps(null));
  await alreadyTerminal.store.releaseClaim({ runId: "run-one", claimId });
  assert.equal(alreadyTerminal.collector.snapshot().outcome_unknown, 0, "no transition, no signal");

  // The transition is rolled back when a later statement fails: nothing durable, no signal.
  const rolledBack = signalStore(releaseSteps("outcome_unknown", 0));
  await assert.rejects(rolledBack.store.releaseClaim({ runId: "run-one", claimId }));
  assert.deepEqual(rolledBack.database.transactions, ["begin", "rollback"]);
  assert.equal(rolledBack.collector.snapshot().outcome_unknown, 0);

  for (const [status, expected] of [["outcome_unknown", 1], ["failed", 0]] as const) {
    const known = signalStore([{ tag: "workflow-runtime:record-known-execution", rows: [{ status }] }]);
    await known.store.recordKnownExecutionOutcome({ runId: "run-one", claimId });
    assert.equal(known.collector.snapshot().outcome_unknown, expected, `record-known → ${status}`);
  }

  const expired = signalStore([
    { tag: "workflow-runtime:claim-run", rows: [{ db_run_id: dbRunId, revision: "1", runtime_pause: null }] },
    {
      tag: "workflow-runtime:read-active-claim",
      rows: [{
        claim_id: claimId, execution_id: "execution-old", request_fingerprint: fingerprint,
        lease_expires_at: "2026-09-01T09:59:00.000Z", execution_status: "running",
      }],
    },
    { tag: "workflow-runtime:expire-claim", rowCount: 1 },
    { tag: "workflow-runtime:unknown-execution", rowCount: 1 },
  ]);
  assert.equal((await expired.store.claim(claimInput())).status, "recovery_required");
  assert.equal(expired.collector.snapshot().outcome_unknown, 1, "expired running claim");
});

test("AI-037.4a: an unacknowledged COMMIT emits ambiguous_commit once and no transition signal", async () => {
  const ambiguous = signalStore(releaseSteps("outcome_unknown"), 1);
  await assert.rejects(ambiguous.store.releaseClaim({ runId: "run-one", claimId }), {
    name: "WorkflowRuntimeCommitAmbiguousError",
  });
  assert.deepEqual(ambiguous.collector.snapshot(), {
    db_failure: 0, db_session_destroyed: 0, recovery_required: 0,
    outcome_unknown: 0, ambiguous_commit: 1, provider_redispatch: 0,
  });
  // A failure before COMMIT is not an ambiguous commit.
  const early = signalStore(releaseSteps("outcome_unknown", 0));
  await assert.rejects(early.store.releaseClaim({ runId: "run-one", claimId }));
  assert.equal(early.collector.snapshot().ambiguous_commit, 0);
});

test("AI-037.4a: a throwing signal sink never changes a store result", async () => {
  const database = new ScriptedDatabase(releaseSteps("outcome_unknown"));
  const store = createStore(database, { signals: { emit() { throw new Error("sink down"); } } });
  await store.releaseClaim({ runId: "run-one", claimId });
  assert.deepEqual(database.transactions, ["begin", "commit"]);
});
