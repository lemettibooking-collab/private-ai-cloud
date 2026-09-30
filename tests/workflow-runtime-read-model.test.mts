import assert from "node:assert/strict";
import test from "node:test";

const readContract = (await import(
  new URL("../lib/db/workflow-runtime-read-model.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-read-model");
const fixtureContract = (await import(
  new URL("./helpers/workflow-runtime-state-fixture.mts", import.meta.url).href
)) as {
  createWorkflowRuntimeStateFixture(): import("../lib/workflows/workflow-runtime-service").WorkflowRuntimeState;
};

const { PostgresWorkflowRuntimeReadModel, workflowRuntimeReadModelLimits } = readContract;
const tenantContract = (await import(
  new URL("../lib/db/workflow-runtime-tenant.ts", import.meta.url).href
)) as typeof import("../lib/db/workflow-runtime-tenant");
const { createPostgresWorkflowRuntimeTenantResolver } = tenantContract;
const workspaceDatabaseId = "00000000-0000-4000-8000-000000000001";

type SqlClient = import("../lib/db/workflow-runtime-store").WorkflowRuntimeSqlClient;
type Step = Readonly<{ tag: string; rows?: readonly Record<string, unknown>[]; fail?: boolean }>;

const begin = { tag: "workflow-runtime-read:snapshot-begin" } as const;
const commit = { tag: "workflow-runtime-read:snapshot-commit" } as const;
const rollback = { tag: "workflow-runtime-read:snapshot-rollback" } as const;
const driverSecret = "postgres://owner:driver-secret@db.internal:5432/runtime relation audit_events";

class ReadDatabase {
  readonly steps: Step[];
  readonly queries: Array<{ tag: string; text: string; values: readonly unknown[] }> = [];
  releases = 0;
  connections = 0;
  readonly destroyed: boolean[] = [];

  constructor(steps: readonly Step[]) { this.steps = [...steps]; }

  async connect(): Promise<SqlClient> {
    this.connections += 1;
    return {
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => {
        const match = text.match(/\/\* ([^*]+) \*\//u);
        assert.ok(match);
        const step = this.steps.shift();
        assert.ok(step, `Unexpected SQL operation ${match[1]}`);
        assert.equal(match[1], step.tag);
        this.queries.push({ tag: match[1], text, values });
        if (step.fail) throw new Error(driverSecret);
        return { rows: (step.rows ?? []) as readonly Row[], rowCount: step.rows?.length ?? 0 };
      },
      release: (destroy?: boolean) => { this.releases += 1; this.destroyed.push(destroy === true); },
    };
  }

  tags() { return this.queries.map((query) => query.tag.replace("workflow-runtime-read:", "")); }

  done() { assert.deepEqual(this.steps, []); }
}

function runRow() {
  const state = fixtureContract.createWorkflowRuntimeStateFixture();
  return {
    project_id: state.snapshot.projectId,
    workflow_id: state.snapshot.workflowId,
    status: state.snapshot.status,
    revision: String(state.snapshot.revision),
    runtime_snapshot: structuredClone(state.snapshot),
    created_at: "2026-09-02T08:00:00.000Z",
    started_at: null,
    completed_at: null,
  };
}

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "workflow.run_started",
    actor_kind: "workflow_runtime",
    actor_id: "workflow-runtime",
    runtime_run_id: "run-one",
    metadata: { runId: "run-one", revision: 1 },
    created_at: "2026-09-02T08:00:01.000Z",
    ...overrides,
  };
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

function usageRow(overrides: Record<string, unknown> = {}) {
  return {
    invocation_count: "1",
    succeeded_count: "1",
    failed_count: "0",
    ambiguous_count: "0",
    inconsistent_execution_count: "0",
    input_tokens: "10",
    output_tokens: "5",
    total_tokens: "15",
    total_cost_usd_micros: "11",
    last_provider_id: "provider-one",
    last_provider_model_id: "provider/model:alias",
    last_provider_request_model_id: "provider/model:v1",
    last_provider_model_version: "version-1",
    ...overrides,
  };
}

function model(database: ReadDatabase) {
  return new PostgresWorkflowRuntimeReadModel({ database, tenant: resolvedTenant });
}

test("Run overview is workspace scoped and exposes rejected approval without calling a provider", async () => {
  const state = fixtureContract.createWorkflowRuntimeStateFixture();
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:run-overview", rows: [{
      project_id: state.snapshot.projectId,
      workflow_id: state.snapshot.workflowId,
      status: state.snapshot.status,
      revision: String(state.snapshot.revision),
      runtime_snapshot: structuredClone(state.snapshot),
      created_at: "2026-09-02T08:00:00.000Z",
      started_at: null,
      completed_at: null,
    }] },
    { tag: "workflow-runtime-read:run-approval", rows: [{
      runtime_approval_id: "risk-approval-0123456789abcdef0123456789abcdef",
      step_id: "step-one",
      status: "rejected",
      risk_level: "high",
      requested_capability: "advanced_reasoning",
      requested_by_actor_id: "workflow-runtime",
      resolved_by_actor_id: "owner-one",
      requested_at: "2026-09-02T08:01:00.000Z",
      resolved_at: "2026-09-02T08:02:00.000Z",
    }] },
    { tag: "workflow-runtime-read:latest-model-invocation", rows: [{
      invocation_id: "invocation-one",
      step_id: "step-one",
      attempt_number: 1,
      status: "succeeded",
      provider_id: "provider-one",
      deployment_id: "deployment-one",
      provider_model_id: "provider/model:alias",
      provider_request_model_id: "provider/model:v1",
      provider_model_version: "version-1",
      provider_identity_version: 2,
      request_fingerprint: `sha256:${"a".repeat(64)}`,
      created_at: "2026-09-02T08:03:00.000Z",
      completed_at: "2026-09-02T08:03:01.000Z",
      execution_status: "completed",
    }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow()] },
    commit,
  ]);
  const decision = await model(database).getRunOverview("run-one");
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.data?.approval?.status, "rejected");
  assert.equal(decision.data?.modelUsage.totalCostUsdMicros, 11);
  assert.equal(decision.data?.latestModelInvocation?.requestFingerprint, `sha256:${"a".repeat(64)}`);
  assert.equal(JSON.stringify(decision).includes("messages"), false);
  assert.equal(Object.isFrozen(decision), true);
  assert.deepEqual(database.queries[1]?.values, [workspaceDatabaseId, "run-one"]);
  database.done();
});

test("legacy terminal invocation remains auditable without fabricating pinned identity", async () => {
  const state = fixtureContract.createWorkflowRuntimeStateFixture();
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:run-overview", rows: [{
      project_id: state.snapshot.projectId,
      workflow_id: state.snapshot.workflowId,
      status: state.snapshot.status,
      revision: String(state.snapshot.revision),
      runtime_snapshot: structuredClone(state.snapshot),
      created_at: "2026-09-02T08:00:00.000Z",
      started_at: null,
      completed_at: null,
    }] },
    { tag: "workflow-runtime-read:run-approval", rows: [] },
    { tag: "workflow-runtime-read:latest-model-invocation", rows: [{
      invocation_id: "invocation-legacy",
      step_id: "step-one",
      attempt_number: 1,
      status: "succeeded",
      provider_id: "provider-one",
      deployment_id: "deployment-one",
      provider_model_id: "provider/model:alias",
      provider_request_model_id: null,
      provider_model_version: "version-1",
      provider_identity_version: 1,
      request_fingerprint: `sha256:${"c".repeat(64)}`,
      created_at: "2026-09-02T08:03:00.000Z",
      completed_at: "2026-09-02T08:03:01.000Z",
      execution_status: "completed",
    }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow({
      last_provider_request_model_id: null,
    })] },
    commit,
  ]);
  const decision = await model(database).getRunOverview("run-one");
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.data?.latestModelInvocation?.providerIdentityVersion, 1);
  assert.equal(decision.data?.latestModelInvocation?.providerRequestModelId, null);
  assert.equal(decision.data?.modelUsage.lastProviderRequestModelId, null);
  assert.equal(JSON.stringify(decision).includes("provider/model:v1"), false);
  database.done();
});

test("approval queue returns pending factual approvals only and enforces the maximum limit", async () => {
  const database = new ReadDatabase([{ tag: "workflow-runtime-read:approval-queue", rows: [{
    runtime_approval_id: "risk-approval-0123456789abcdef0123456789abcdef",
    runtime_id: "run-one",
    step_id: "step-one",
    status: "pending",
    risk_level: "critical",
    requested_capability: "coding",
    requested_by_actor_id: "workflow-runtime",
    resolved_by_actor_id: null,
    requested_at: "2026-09-02T08:01:00.000Z",
    resolved_at: null,
  }] }]);
  const readModel = model(database);
  const decision = await readModel.listApprovalQueue(10);
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.data?.map((item) => item.status), ["pending"]);
  assert.equal((await readModel.listApprovalQueue(workflowRuntimeReadModelLimits.maxLimit + 1)).reason, "invalid_input");
  assert.deepEqual(database.queries[0]?.values, [workspaceDatabaseId, 10]);
  database.done();
});

test("model usage is summed once and cross-workspace Run identifiers expose no data", async () => {
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow({
      invocation_count: "2", succeeded_count: "1", failed_count: "1",
      input_tokens: "20", output_tokens: "8", total_tokens: "28",
      total_cost_usd_micros: "19",
    })] },
    commit,
    begin,
    { tag: "workflow-runtime-read:usage-run", rows: [] },
    commit,
  ]);
  const readModel = model(database);
  const usage = await readModel.getRunModelUsage("run-one");
  assert.deepEqual(usage.data && {
    count: usage.data.invocationCount,
    total: usage.data.totalTokens,
    cost: usage.data.totalCostUsdMicros,
  }, { count: 2, total: 28, cost: 19 });
  const hidden = await readModel.getRunModelUsage("run-other");
  assert.deepEqual(hidden, { verdict: "deny", reason: "not_found", data: null });
  assert.deepEqual(database.queries.at(-2)?.values, [workspaceDatabaseId, "run-other"]);
  database.done();
});

test("audit timeline is newest-first, bounded, tenant-scoped, and rejects unsafe metadata", async () => {
  const rows = [{
    event_type: "workflow.run_started",
    actor_kind: "workflow_runtime",
    actor_id: "workflow-runtime",
    runtime_run_id: "run-one",
    metadata: { runId: "run-one", revision: 1 },
    created_at: "2026-09-02T08:00:01.000Z",
  }, {
    event_type: "workflow.run_created",
    actor_kind: "workflow_runtime",
    actor_id: "workflow-runtime",
    runtime_run_id: "run-one",
    metadata: { runId: "run-one", revision: 0 },
    created_at: "2026-09-02T08:00:00.000Z",
  }];
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:audit-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:audit-timeline", rows },
    commit,
    begin,
    { tag: "workflow-runtime-read:audit-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:audit-timeline", rows: [{
      ...rows[0], metadata: { prompt: "sensitive prompt sentinel" },
    }] },
    commit,
  ]);
  const readModel = model(database);
  const timeline = await readModel.getRunAuditTimeline("run-one", 2);
  assert.equal(timeline.verdict, "allow");
  assert.deepEqual(timeline.data?.map((item) => item.eventType), [
    "workflow.run_started", "workflow.run_created",
  ]);
  assert.deepEqual(database.queries[1]?.values, [workspaceDatabaseId, "run-one"]);
  assert.deepEqual(database.queries[2]?.values, [workspaceDatabaseId, "run-one", 2]);
  const unsafe = await readModel.getRunAuditTimeline("run-one", 1);
  assert.deepEqual(unsafe, { verdict: "deny", reason: "inconsistent_state", data: null });
  assert.equal((await readModel.getRunAuditTimeline("run-one", 101)).reason, "invalid_input");
  database.done();
});

test("M2 integration: the Owner recovery audit event (AI-037.1.1 / AI-037.1.2) is readable in the audit timeline", async () => {
  const recoveryMetadata = {
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
    invocationStatus: "failed",
    invocationOutcome: "failed",
    invocationTotalTokens: 105,
    invocationCostUsdMicros: 200,
    budgetStatus: "settled",
  };
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:audit-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:audit-timeline", rows: [{
      event_type: "workflow.execution_recovery_authorized",
      actor_kind: "owner",
      actor_id: "owner-one",
      runtime_run_id: "run-one",
      metadata: recoveryMetadata,
      created_at: "2026-09-02T08:05:00.000Z",
    }] },
    commit,
  ]);
  const timeline = await model(database).getRunAuditTimeline("run-one", 10);
  assert.equal(timeline.verdict, "allow", JSON.stringify(timeline));
  assert.deepEqual(timeline.data?.[0]?.metadata, recoveryMetadata);
  database.done();
});

test("succeeded model ledger cannot override an outcome_unknown outer execution", async () => {
  const state = fixtureContract.createWorkflowRuntimeStateFixture();
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:run-overview", rows: [{
      project_id: state.snapshot.projectId,
      workflow_id: state.snapshot.workflowId,
      status: state.snapshot.status,
      revision: String(state.snapshot.revision),
      runtime_snapshot: structuredClone(state.snapshot),
      created_at: "2026-09-02T08:00:00.000Z",
      started_at: null,
      completed_at: null,
    }] },
    { tag: "workflow-runtime-read:run-approval", rows: [] },
    { tag: "workflow-runtime-read:latest-model-invocation", rows: [{
      invocation_id: "invocation-one", step_id: "step-one", attempt_number: 1,
      status: "succeeded", provider_id: "provider-one", deployment_id: "deployment-one",
      provider_model_id: "provider/model:alias", provider_request_model_id: "provider/model:v1", provider_model_version: "version-1", provider_identity_version: 2,
      request_fingerprint: `sha256:${"a".repeat(64)}`,
      created_at: "2026-09-02T08:03:00.000Z", completed_at: "2026-09-02T08:03:01.000Z",
      execution_status: "outcome_unknown",
    }] },
    commit,
  ]);
  assert.deepEqual(await model(database).getRunOverview("run-one"), {
    verdict: "deny", reason: "inconsistent_state", data: null,
  });
  database.done();
});

test("an older succeeded invocation with an ambiguous outer execution denies overview and usage", async () => {
  const state = fixtureContract.createWorkflowRuntimeStateFixture();
  const snapshotBefore = structuredClone(state.snapshot);
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:run-overview", rows: [{
      project_id: state.snapshot.projectId,
      workflow_id: state.snapshot.workflowId,
      status: state.snapshot.status,
      revision: String(state.snapshot.revision),
      runtime_snapshot: structuredClone(state.snapshot),
      created_at: "2026-09-02T08:00:00.000Z",
      started_at: null,
      completed_at: null,
    }] },
    { tag: "workflow-runtime-read:run-approval", rows: [] },
    { tag: "workflow-runtime-read:latest-model-invocation", rows: [{
      invocation_id: "invocation-two", step_id: "step-two", attempt_number: 1,
      status: "succeeded", provider_id: "provider-one", deployment_id: "deployment-one",
      provider_model_id: "provider/model:alias", provider_request_model_id: "provider/model:v1", provider_model_version: "version-1", provider_identity_version: 2,
      request_fingerprint: `sha256:${"b".repeat(64)}`,
      created_at: "2026-09-02T08:04:00.000Z", completed_at: "2026-09-02T08:04:01.000Z",
      execution_status: "completed",
    }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow({
      invocation_count: "2",
      succeeded_count: "2",
      input_tokens: "20",
      output_tokens: "10",
      total_tokens: "30",
      total_cost_usd_micros: "22",
      inconsistent_execution_count: "1",
    })] },
    commit,
    begin,
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow({
      invocation_count: "2",
      succeeded_count: "2",
      inconsistent_execution_count: "1",
    })] },
    commit,
  ]);
  const readModel = model(database);
  assert.deepEqual(await readModel.getRunOverview("run-one"), {
    verdict: "deny", reason: "inconsistent_state", data: null,
  });
  assert.deepEqual(await readModel.getRunModelUsage("run-one"), {
    verdict: "deny", reason: "inconsistent_state", data: null,
  });
  assert.deepEqual(state.snapshot, snapshotBefore);
  assert.equal(database.queries.every((query) => query.tag.startsWith("workflow-runtime-read:")), true);
  database.done();
});

const invocationRowOne = {
  invocation_id: "invocation-one", step_id: "step-one", attempt_number: 1,
  status: "succeeded", provider_id: "provider-one", deployment_id: "deployment-one",
  provider_model_id: "provider/model:alias", provider_request_model_id: "provider/model:v1",
  provider_model_version: "version-1", provider_identity_version: 2,
  request_fingerprint: `sha256:${"a".repeat(64)}`,
  created_at: "2026-09-02T08:03:00.000Z", completed_at: "2026-09-02T08:03:01.000Z",
  execution_status: "completed",
};

const readFailed = { verdict: "deny", reason: "read_failed", data: null };

test("run overview reads every factual SELECT inside one read-only repeatable-read snapshot", async () => {
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:run-overview", rows: [runRow()] },
    { tag: "workflow-runtime-read:run-approval", rows: [] },
    { tag: "workflow-runtime-read:latest-model-invocation", rows: [invocationRowOne] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow()] },
    commit,
  ]);
  const decision = await model(database).getRunOverview("run-one");
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(database.tags(), [
    "snapshot-begin", "run-overview", "run-approval", "latest-model-invocation", "model-usage", "snapshot-commit",
  ]);
  const beginSql = database.queries[0].text.toLowerCase().replace(/\s+/gu, " ");
  assert.match(beginSql, /\bbegin\b.*\bisolation level repeatable read\b/u);
  assert.match(beginSql, /\bread only\b/u);
  assert.equal(database.queries.some((query) => /for update|for share|advisory|lock table/iu.test(query.text)), false);
  assert.equal(database.connections, 1);
  assert.equal(database.releases, 1);
  database.done();
});

test("run overview data failure at any later SELECT rolls back, never commits, and releases once", async () => {
  const later = [
    { tag: "workflow-runtime-read:run-approval", rows: [] },
    { tag: "workflow-runtime-read:latest-model-invocation", rows: [invocationRowOne] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow()] },
  ];
  for (let failing = 0; failing < later.length; failing += 1) {
    const database = new ReadDatabase([
      begin,
      { tag: "workflow-runtime-read:run-overview", rows: [runRow()] },
      ...later.slice(0, failing),
      { ...later[failing], fail: true },
      rollback,
    ]);
    const decision = await model(database).getRunOverview("run-one");
    assert.deepEqual(decision, readFailed);
    assert.equal(database.tags().includes("snapshot-commit"), false);
    assert.equal(database.tags().at(-1), "snapshot-rollback");
    assert.equal(JSON.stringify(decision).includes("driver-secret"), false);
    assert.equal(database.releases, 1);
    database.done();
  }
});

test("snapshot begin, commit, and rollback failures fail closed and release exactly once", async () => {
  const beginFailure = new ReadDatabase([{ ...begin, fail: true }, rollback]);
  assert.deepEqual(await model(beginFailure).getRunOverview("run-one"), readFailed);
  assert.deepEqual(beginFailure.tags(), ["snapshot-begin", "snapshot-rollback"]);
  assert.equal(beginFailure.releases, 1);
  beginFailure.done();

  const commitFailure = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:run-overview", rows: [runRow()] },
    { tag: "workflow-runtime-read:run-approval", rows: [] },
    { tag: "workflow-runtime-read:latest-model-invocation", rows: [invocationRowOne] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow()] },
    { ...commit, fail: true },
    rollback,
  ]);
  const committed = await model(commitFailure).getRunOverview("run-one");
  assert.deepEqual(committed, readFailed);
  assert.equal(JSON.stringify(committed).includes("invocation-one"), false);
  assert.equal(commitFailure.releases, 1);
  commitFailure.done();

  const rollbackFailure = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", fail: true },
    { ...rollback, fail: true },
  ]);
  const rolledBack = await model(rollbackFailure).getRunModelUsage("run-one");
  assert.deepEqual(rolledBack, readFailed);
  assert.equal(JSON.stringify(rolledBack).includes("driver-secret"), false);
  assert.equal(rollbackFailure.releases, 1);
  rollbackFailure.done();

  const auditCommitFailure = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:audit-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:audit-timeline", rows: [auditRow()] },
    { ...commit, fail: true },
    { ...rollback, fail: true },
  ]);
  assert.deepEqual(await model(auditCommitFailure).getRunAuditTimeline("run-one"), readFailed);
  assert.equal(auditCommitFailure.releases, 1);
  auditCommitFailure.done();
});

test("model usage reads Run existence and aggregate in one read-only repeatable-read snapshot", async () => {
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow()] },
    commit,
  ]);
  const decision = await model(database).getRunModelUsage("run-one");
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(database.tags(), ["snapshot-begin", "usage-run", "model-usage", "snapshot-commit"]);
  assert.match(database.queries[0].text.toLowerCase(), /repeatable read[\s\S]*read only/u);
  assert.equal(database.connections, 1);
  assert.equal(database.releases, 1);
  database.done();
});

test("audit timeline itself distinguishes missing Run from an existing Run with no events in one snapshot", async () => {
  const missing = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:audit-run", rows: [] },
    commit,
  ]);
  assert.deepEqual(await model(missing).getRunAuditTimeline("run-missing", 10), {
    verdict: "deny", reason: "not_found", data: null,
  });
  assert.deepEqual(missing.queries[1]?.values, [workspaceDatabaseId, "run-missing"]);
  assert.equal(missing.releases, 1);
  missing.done();

  const empty = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:audit-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:audit-timeline", rows: [] },
    commit,
  ]);
  const emptyDecision = await model(empty).getRunAuditTimeline("run-one", 10);
  assert.equal(emptyDecision.verdict, "allow");
  assert.deepEqual(emptyDecision.data, []);
  assert.deepEqual(empty.tags(), ["snapshot-begin", "audit-run", "audit-timeline", "snapshot-commit"]);
  assert.match(empty.queries[0].text.toLowerCase(), /repeatable read[\s\S]*read only/u);
  assert.equal(empty.connections, 1);
  assert.equal(empty.releases, 1);
  empty.done();

  const duplicate = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:audit-run", rows: [{ id: "db-run-one" }, { id: "db-run-two" }] },
    commit,
  ]);
  assert.deepEqual(await model(duplicate).getRunAuditTimeline("run-one", 10), {
    verdict: "deny", reason: "inconsistent_state", data: null,
  });
  duplicate.done();
});

test("approval queue remains exactly one factual SELECT without transaction control", async () => {
  const database = new ReadDatabase([{ tag: "workflow-runtime-read:approval-queue", rows: [] }]);
  const decision = await model(database).listApprovalQueue();
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(database.tags(), ["approval-queue"]);
  assert.deepEqual(database.queries[0]?.values, [workspaceDatabaseId, workflowRuntimeReadModelLimits.defaultLimit]);
  assert.equal(database.connections, 1);
  assert.equal(database.releases, 1);
  database.done();
});

test("snapshot ROLLBACK, COMMIT, or BEGIN failure destroys the session and the next read gets a fresh one", async () => {
  const rollbackFails = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", fail: true },
    { ...rollback, fail: true },
    { tag: "workflow-runtime-read:approval-queue", rows: [] },
  ]);
  const readModel = model(rollbackFails);
  assert.deepEqual(await readModel.getRunModelUsage("run-one"), readFailed);
  assert.equal((await readModel.listApprovalQueue()).verdict, "allow");
  assert.equal(rollbackFails.connections, 2);
  assert.deepEqual(rollbackFails.destroyed, [true, false]);
  rollbackFails.done();

  const commitFails = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:audit-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:audit-timeline", rows: [] },
    { ...commit, fail: true },
    rollback,
  ]);
  assert.deepEqual(await model(commitFails).getRunAuditTimeline("run-one"), readFailed);
  assert.deepEqual(commitFails.destroyed, [true]);
  commitFails.done();

  const beginFails = new ReadDatabase([{ ...begin, fail: true }, rollback]);
  assert.deepEqual(await model(beginFails).getRunOverview("run-one"), readFailed);
  assert.deepEqual(beginFails.destroyed, [true]);
  beginFails.done();
});

test("snapshot data failure followed by a successful ROLLBACK reuses the session", async () => {
  const database = new ReadDatabase([
    begin,
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", fail: true },
    rollback,
    begin,
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow()] },
    commit,
  ]);
  const readModel = model(database);
  assert.deepEqual(await readModel.getRunModelUsage("run-one"), readFailed);
  assert.equal((await readModel.getRunModelUsage("run-one")).verdict, "allow");
  assert.deepEqual(database.destroyed, [false, false]);
  database.done();
});

test("single-statement approval queue failure destroys the session", async () => {
  const database = new ReadDatabase([{ tag: "workflow-runtime-read:approval-queue", fail: true }]);
  assert.deepEqual(await model(database).listApprovalQueue(), readFailed);
  assert.deepEqual(database.destroyed, [true]);
  database.done();
});
