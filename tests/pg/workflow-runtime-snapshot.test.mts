/* eslint-disable @typescript-eslint/no-explicit-any -- live SQL fixtures cross untyped pg boundaries */
// Live PostgreSQL: a multi-statement Owner read (getRunOverview) observes exactly one
// REPEATABLE READ, READ ONLY snapshot while another connection commits S2, and never blocks the
// writer. Derived from the AI-036.6 / re-gate harness attack-n.mts (overview interleave).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const live = (await import(
  new URL("./helpers/live-pg.ts", import.meta.url).href
)) as typeof import("./helpers/live-pg");
const fixtures = (await import(
  new URL("./helpers/runtime-fixtures.ts", import.meta.url).href
)) as typeof import("./helpers/runtime-fixtures");

const postgres = (await import(
  new URL("../../lib/db/postgres.ts", import.meta.url).href
)) as typeof import("../../lib/db/postgres");
const tenantContract = (await import(
  new URL("../../lib/db/workflow-runtime-tenant.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-tenant");
const readModelContract = (await import(
  new URL("../../lib/db/workflow-runtime-read-model.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-read-model");

const db = await live.useLiveDatabase("snapshot");
const workspace = live.primaryWorkspace;
await live.insertWorkspace(db.admin, workspace);

const S1 = fixtures.createWorkflowRuntimeStateFixture();
const S2 = fixtures.transitionRuntimeState(S1, "run_started");
const hex = (character: string) => character.repeat(64);

async function insertApproval(client: any, runDbId: string, tag: string, revision: number, at: string) {
  await client.query(`insert into approval_requests (workspace_id, workflow_run_id, action_type, status, risk_level,
      runtime_approval_id, step_id, attempt_number, expected_revision, request_fingerprint, policy_fingerprint,
      scope_fingerprint, requested_capability, requested_by_actor_id, created_at)
    values ($1, $2, 'runtime_risk_approval', 'pending', 'high', $3, 'step-one', 1, $4, $5, $6, $7, 'reasoning',
      'workflow-runtime', $8)`,
  [workspace.id, runDbId, `risk-approval-${tag.repeat(32)}`, revision, hex(tag), hex("e"), hex("f"), at]);
}

async function insertInvocation(client: any, runDbId: string, tag: string, revision: number, tokens: number, at: string) {
  const claim = (await client.query(`insert into workflow_runtime_claims (workspace_id, run_id, step_id, attempt_number,
      expected_revision, execution_id, status, acquired_at, lease_expires_at, released_at)
    values ($1, $2, 'step-one', 1, $3, $4, 'released', $5, $5::timestamptz + interval '5 minutes', $5) returning id`,
  [workspace.id, runDbId, revision, `execution-${tag}`, at])).rows[0].id;
  const execution = (await client.query(`insert into workflow_runtime_executions (workspace_id, run_id, claim_id,
      step_id, attempt_number, expected_revision, execution_id, request_fingerprint, status, created_at, started_at,
      completed_at)
    values ($1, $2, $3, 'step-one', 1, $4, $5, $6, 'completed', $7, $7, $7) returning id`,
  [workspace.id, runDbId, claim, revision, `execution-${tag}`, hex(tag), at])).rows[0].id;
  await client.query(`insert into workflow_model_invocations (workspace_id, workflow_run_id, workflow_execution_id,
      invocation_id, run_revision, project_id, workflow_id, agent_id, agent_binding_id, step_id, attempt_number,
      model_profile_id, request_fingerprint, reservation_token, status, provider_id, deployment_id, provider_model_id,
      provider_model_version, outcome, finish_reason, input_tokens, output_tokens, total_tokens, latency_ms,
      cost_usd_micros, created_at, started_at, completed_at, provider_request_model_id, provider_identity_version)
    values ($1, $2, $3, $4, $5, 'project-one', 'workflow-one', 'agent-one', 'agent-one-binding', 'step-one', 1,
      'model-shared', $6, $7, 'succeeded', $8, 'deployment-one', 'provider/model:alias', 'version-1', 'succeeded',
      'stop', $9, 0, $9, 5, 0, $10, $10, $10, 'provider/model:v1', 2)`,
  [workspace.id, runDbId, execution, `invocation-${tag}`, revision, `sha256:${hex(tag)}`, randomUUID(),
    `provider-${tag}`, tokens, at]);
}

// S1: Run revision 0 (queued) + approval "a" + invocation "a" (15 tokens).
async function seedS1(): Promise<string> {
  await db.admin.query("delete from workflow_model_invocations");
  await db.admin.query("delete from workflow_runtime_executions");
  await db.admin.query("delete from workflow_runtime_claims");
  await db.admin.query("delete from approval_requests where action_type = 'runtime_risk_approval'");
  await db.admin.query("delete from workflow_runs where runtime_id is not null");
  const snapshot = S1.snapshot;
  const runDbId = (await db.admin.query(`insert into workflow_runs (workspace_id, status, runtime_id, project_id,
      workflow_id, revision, runtime_snapshot, project_registry, model_provider_registry, created_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '2026-09-29T08:00:00.000Z') returning id`,
  [workspace.id, snapshot.status, snapshot.runId, snapshot.projectId, snapshot.workflowId, snapshot.revision,
    JSON.stringify(snapshot), JSON.stringify(S1.projectRegistry), JSON.stringify(S1.modelProviderRegistry)])).rows[0].id;
  await insertApproval(db.admin, runDbId, "a", 0, "2026-09-29T08:01:00.000Z");
  await insertInvocation(db.admin, runDbId, "a", 0, 15, "2026-09-29T08:02:00.000Z");
  return runDbId;
}

// S2 on its own connection: Run revision 1 (running) + approval "b" + invocation "b" (150 tokens).
async function commitS2(runDbId: string) {
  const writer = live.adminClient(db.url);
  await writer.connect();
  const started = Date.now();
  try {
    await writer.query("set lock_timeout = '2s'");
    await writer.query("begin");
    await writer.query(`update workflow_runs set status = $2, revision = $3, runtime_snapshot = $4,
        started_at = '2026-09-29T08:10:00.000Z' where id = $1`,
    [runDbId, S2.snapshot.status, S2.snapshot.revision, JSON.stringify(S2.snapshot)]);
    await insertApproval(writer, runDbId, "b", 1, "2026-09-29T08:11:00.000Z");
    await insertInvocation(writer, runDbId, "b", 1, 150, "2026-09-29T08:12:00.000Z");
    await writer.query("commit");
    return { committed: true, ms: Date.now() - started };
  } finally {
    await writer.end();
  }
}

// Wraps the real adapter so the reader pauses right after its FIRST factual statement inside the
// snapshot transaction; `onPause` runs while the reader holds that snapshot.
function pausingDatabase(base: any, onPause: (client: any) => Promise<void>) {
  const tags: string[] = [];
  return {
    tags,
    database: {
      async connect() {
        const client = await base.connect();
        let paused = false;
        return {
          async query(text: string, values?: readonly unknown[]) {
            const result = await client.query(text, values);
            const tag = text.match(/\/\* ([^*]+) \*\//u)?.[1] ?? "untagged";
            tags.push(tag);
            if (!paused && !/snapshot-(begin|commit|rollback)|live-probe/u.test(tag)) {
              paused = true;
              await onPause(client);
            }
            return result;
          },
          release(destroy?: boolean) { client.release(destroy); },
        };
      },
    },
  };
}

const overviewFacts = (decision: any) => decision.data && {
  revision: decision.data.revision,
  status: decision.data.status,
  approval: decision.data.approval?.approvalRequestId.slice(-4),
  invocation: decision.data.latestModelInvocation?.invocationId,
  usageCount: decision.data.modelUsage.invocationCount,
  usageTokens: decision.data.modelUsage.totalTokens,
};

test("getRunOverview returns one REPEATABLE READ snapshot while S2 commits concurrently", async () => {
  const base = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
  try {
    const tenant = await tenantContract.createPostgresWorkflowRuntimeTenantResolver(base).resolve(workspace.domain);
    assert.ok(tenant);
    const runDbId = await seedS1();
    let reader: any = null;
    let writer: any = null;
    const paused = pausingDatabase(base, async (client) => {
      reader = (await client.query(`/* live-probe */ select pg_backend_pid() as pid,
          current_setting('transaction_isolation') as isolation,
          current_setting('transaction_read_only') as read_only,
          (now() <> statement_timestamp()) as in_transaction`)).rows[0];
      writer = await commitS2(runDbId);
      reader.lockModes = (await db.admin.query(`select distinct mode from pg_locks where pid = $1
          and locktype in ('relation', 'tuple', 'transactionid', 'advisory') order by mode`, [reader.pid])).rows
        .map((row: any) => row.mode);
      reader.holdsSnapshot = (await db.admin.query(`select backend_xmin is not null as held from pg_stat_activity
          where pid = $1`, [reader.pid])).rows[0].held;
    });
    const first = await new readModelContract.PostgresWorkflowRuntimeReadModel({ database: paused.database as any, tenant })
      .getRunOverview(fixtures.runId);
    const fresh = await new readModelContract.PostgresWorkflowRuntimeReadModel({ database: base, tenant })
      .getRunOverview(fixtures.runId);

    assert.deepEqual(paused.tags.slice(0, 2), ["workflow-runtime-read:snapshot-begin", "workflow-runtime-read:run-overview"]);
    assert.equal(first.verdict, "allow");
    assert.deepEqual(overviewFacts(first), {
      revision: 0, status: "queued", approval: "aaaa", invocation: "invocation-a", usageCount: 1, usageTokens: 15,
    });
    assert.deepEqual(overviewFacts(fresh), {
      revision: 1, status: "running", approval: "bbbb", invocation: "invocation-b", usageCount: 2, usageTokens: 165,
    });
    assert.equal(reader.isolation, "repeatable read");
    assert.equal(reader.read_only, "on");
    assert.equal(reader.in_transaction, true);
    assert.equal(reader.holdsSnapshot, true);
    assert.deepEqual(reader.lockModes.filter((mode: string) => mode !== "AccessShareLock"), [], "no writer-blocking locks");
    assert.equal(writer.committed, true);
    assert.ok(writer.ms < 2_000, "the writer was not blocked by the reader");
  } finally {
    await base.close();
  }
});
