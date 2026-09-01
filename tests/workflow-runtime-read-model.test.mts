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
const workspaceDatabaseId = "00000000-0000-4000-8000-000000000001";

type SqlClient = import("../lib/db/workflow-runtime-store").WorkflowRuntimeSqlClient;
type Step = Readonly<{ tag: string; rows?: readonly Record<string, unknown>[] }>;

class ReadDatabase {
  readonly steps: Step[];
  readonly queries: Array<{ tag: string; values: readonly unknown[] }> = [];
  releases = 0;

  constructor(steps: readonly Step[]) { this.steps = [...steps]; }

  async connect(): Promise<SqlClient> {
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
        this.queries.push({ tag: match[1], values });
        return { rows: (step.rows ?? []) as readonly Row[], rowCount: step.rows?.length ?? 0 };
      },
      release: () => { this.releases += 1; },
    };
  }

  done() { assert.deepEqual(this.steps, []); }
}

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
    last_provider_model_id: "provider/model:v1",
    last_provider_model_version: "version-1",
    ...overrides,
  };
}

function model(database: ReadDatabase) {
  return new PostgresWorkflowRuntimeReadModel({ database, workspaceDatabaseId });
}

test("Run overview is workspace scoped and exposes rejected approval without calling a provider", async () => {
  const state = fixtureContract.createWorkflowRuntimeStateFixture();
  const database = new ReadDatabase([
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
      provider_model_id: "provider/model:v1",
      provider_model_version: "version-1",
      request_fingerprint: `sha256:${"a".repeat(64)}`,
      created_at: "2026-09-02T08:03:00.000Z",
      completed_at: "2026-09-02T08:03:01.000Z",
      execution_status: "completed",
    }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow()] },
  ]);
  const decision = await model(database).getRunOverview("run-one");
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.data?.approval?.status, "rejected");
  assert.equal(decision.data?.modelUsage.totalCostUsdMicros, 11);
  assert.equal(decision.data?.latestModelInvocation?.requestFingerprint, `sha256:${"a".repeat(64)}`);
  assert.equal(JSON.stringify(decision).includes("messages"), false);
  assert.equal(Object.isFrozen(decision), true);
  assert.deepEqual(database.queries[0]?.values, [workspaceDatabaseId, "run-one"]);
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
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow({
      invocation_count: "2", succeeded_count: "1", failed_count: "1",
      input_tokens: "20", output_tokens: "8", total_tokens: "28",
      total_cost_usd_micros: "19",
    })] },
    { tag: "workflow-runtime-read:usage-run", rows: [] },
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
  assert.deepEqual(database.queries.at(-1)?.values, [workspaceDatabaseId, "run-other"]);
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
    { tag: "workflow-runtime-read:audit-timeline", rows },
    { tag: "workflow-runtime-read:audit-timeline", rows: [{
      ...rows[0], metadata: { prompt: "sensitive prompt sentinel" },
    }] },
  ]);
  const readModel = model(database);
  const timeline = await readModel.getRunAuditTimeline("run-one", 2);
  assert.equal(timeline.verdict, "allow");
  assert.deepEqual(timeline.data?.map((item) => item.eventType), [
    "workflow.run_started", "workflow.run_created",
  ]);
  assert.deepEqual(database.queries[0]?.values, [workspaceDatabaseId, "run-one", 2]);
  const unsafe = await readModel.getRunAuditTimeline("run-one", 1);
  assert.deepEqual(unsafe, { verdict: "deny", reason: "inconsistent_state", data: null });
  assert.equal((await readModel.getRunAuditTimeline("run-one", 101)).reason, "invalid_input");
  database.done();
});

test("succeeded model ledger cannot override an outcome_unknown outer execution", async () => {
  const state = fixtureContract.createWorkflowRuntimeStateFixture();
  const database = new ReadDatabase([
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
      provider_model_id: "provider/model:v1", provider_model_version: "version-1",
      request_fingerprint: `sha256:${"a".repeat(64)}`,
      created_at: "2026-09-02T08:03:00.000Z", completed_at: "2026-09-02T08:03:01.000Z",
      execution_status: "outcome_unknown",
    }] },
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
      provider_model_id: "provider/model:v1", provider_model_version: "version-1",
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
    { tag: "workflow-runtime-read:usage-run", rows: [{ id: "db-run-one" }] },
    { tag: "workflow-runtime-read:model-usage", rows: [usageRow({
      invocation_count: "2",
      succeeded_count: "2",
      inconsistent_execution_count: "1",
    })] },
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
