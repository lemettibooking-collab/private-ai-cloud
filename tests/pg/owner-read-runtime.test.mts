/* eslint-disable @typescript-eslint/no-explicit-any -- live driver instrumentation crosses untyped pg boundaries */
// Live PostgreSQL: AI-038.0 Owner Read Backend Bundle composed for workspace A. Workspaces A and B
// each hold a Run with the SAME runtime id, a pending approval and a paid invocation; the bundle
// takes no workspace or actor argument, so there is no API that could retarget it to B.
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
const persistenceContract = (await import(
  new URL("../../lib/db/workflow-runtime-persistence.ts", import.meta.url).href
)) as typeof import("../../lib/db/workflow-runtime-persistence");
const bundle = (await import(
  new URL("../../lib/composition/owner-read-runtime.ts", import.meta.url).href
)) as typeof import("../../lib/composition/owner-read-runtime");

const db = await live.useLiveDatabase("ownerread");
await live.insertWorkspace(db.admin, live.primaryWorkspace);
await live.insertWorkspace(db.admin, live.secondaryWorkspace);
const A = live.primaryWorkspace;
const B = live.secondaryWorkspace;
const hex = (character: string) => character.repeat(64);

function stateFor(workspace: string, started: boolean, runId = "run-one") {
  const base = started
    ? fixtures.transitionRuntimeState(fixtures.createWorkflowRuntimeStateFixture(), "run_started")
    : fixtures.createWorkflowRuntimeStateFixture();
  const state = JSON.parse(JSON.stringify(base).replaceAll("\"workspace-primary\"", JSON.stringify(workspace)));
  state.snapshot.runId = runId;
  return state;
}

const database = postgres.createWorkflowRuntimePostgresDatabase({ connectionString: db.url, maxConnections: 4 });
const persistenceA = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: A.domain });
const persistenceB = await persistenceContract.createPostgresWorkflowRuntimePersistence({ database, domainWorkspaceId: B.domain });
assert.ok(persistenceA && persistenceB);
await persistenceA.stateStore.create({ state: stateFor(A.domain, true) });
await persistenceB.stateStore.create({ state: stateFor(B.domain, false) });
await persistenceB.stateStore.create({ state: stateFor(B.domain, false, "run-b-only") });

async function runDbId(workspaceUuid: string, runtimeId: string): Promise<string> {
  return (await db.admin.query("select id from workflow_runs where workspace_id = $1 and runtime_id = $2",
    [workspaceUuid, runtimeId])).rows[0].id;
}

// Pending runtime approval and one paid invocation per workspace, with distinguishable values.
async function seed(workspaceUuid: string, runtimeId: string, tag: string, revision: number, tokens: number) {
  const run = await runDbId(workspaceUuid, runtimeId);
  await db.admin.query(`insert into approval_requests (workspace_id, workflow_run_id, action_type, status, risk_level,
      runtime_approval_id, step_id, attempt_number, expected_revision, request_fingerprint, policy_fingerprint,
      scope_fingerprint, requested_capability, requested_by_actor_id)
    values ($1, $2, 'runtime_risk_approval', 'pending', 'high', $3, 'step-one', 1, $4, $5, $6, $7, 'reasoning', 'workflow-runtime')`,
  [workspaceUuid, run, `risk-approval-${tag.repeat(32)}`, revision, hex(tag), hex("e"), hex("f")]);
  const claim = (await db.admin.query(`insert into workflow_runtime_claims (workspace_id, run_id, step_id, attempt_number,
      expected_revision, execution_id, status, lease_expires_at, released_at)
    values ($1, $2, 'step-one', 1, $3, $4, 'released', now() + interval '5 minutes', now()) returning id`,
  [workspaceUuid, run, revision, `execution-${tag}`])).rows[0].id;
  const execution = (await db.admin.query(`insert into workflow_runtime_executions (workspace_id, run_id, claim_id,
      step_id, attempt_number, expected_revision, execution_id, request_fingerprint, status, started_at, completed_at)
    values ($1, $2, $3, 'step-one', 1, $4, $5, $6, 'completed', now(), now()) returning id`,
  [workspaceUuid, run, claim, revision, `execution-${tag}`, hex(tag)])).rows[0].id;
  await db.admin.query(`insert into workflow_model_invocations (workspace_id, workflow_run_id, workflow_execution_id,
      invocation_id, run_revision, project_id, workflow_id, agent_id, agent_binding_id, step_id, attempt_number,
      model_profile_id, request_fingerprint, reservation_token, status, provider_id, deployment_id, provider_model_id,
      provider_model_version, outcome, finish_reason, input_tokens, output_tokens, total_tokens, latency_ms,
      cost_usd_micros, started_at, completed_at, provider_request_model_id, provider_identity_version)
    values ($1, $2, $3, $4, $5, 'project-one', 'workflow-one', 'agent-one', 'agent-one-binding', 'step-one', 1,
      'model-shared', $6, $7, 'succeeded', $8, 'deployment-one', 'provider/model:alias', 'version-1', 'succeeded',
      'stop', $9, 0, $9, 5, $9, now(), now(), 'provider/model:v1', 2)`,
  [workspaceUuid, run, execution, `invocation-${tag}`, revision, `sha256:${hex(tag)}`, randomUUID(), `provider-${tag}`, tokens]);
}
await seed(A.id, "run-one", "a", 1, 11);
await seed(B.id, "run-one", "b", 0, 22);
await seed(B.id, "run-b-only", "c", 0, 33);

const composed = await bundle.createOwnerReadRuntime({ database, domainWorkspaceId: A.domain, ownerActorId: "owner-one" });
assert.equal(composed.verdict, "allow", JSON.stringify(composed));
const ownerA = composed.backend!;
const outputs: string[] = [];
const record = <T,>(value: T): T => { outputs.push(JSON.stringify(value)); return value; };

test("AI-038.0 live: the Owner bundle for A reads only A's Run for the shared runtime id", async () => {
  const overview = record(await ownerA.getRunOverview("run-one"));
  assert.equal(overview.status, "available", JSON.stringify(overview));
  assert.deepEqual([overview.data?.status, overview.data?.revision], ["running", 1], "A's started Run, never B's queued one");
  assert.equal(overview.data?.latestModelInvocation?.invocationId, "invocation-a");
  assert.equal(overview.data?.modelUsage.totalTokens, 11);
});

test("AI-038.0 live: usage, audit timeline and approval queue contain only A", async () => {
  const usage = record(await ownerA.getRunModelUsage("run-one"));
  assert.deepEqual([usage.status, usage.data?.invocationCount, usage.data?.totalTokens, usage.data?.lastProviderId],
    ["available", 1, 11, "provider-a"]);
  const timeline = record(await ownerA.getRunAuditTimeline("run-one", 50));
  assert.equal(timeline.status, "available");
  const aAudit = (await db.admin.query(`select count(*)::int as n from audit_events
    where workspace_id = $1 and runtime_run_id = 'run-one' and runtime_event_key is not null`, [A.id])).rows[0].n;
  assert.equal(timeline.data?.length, aAudit, "exactly A's audit rows for the shared runtime id");
  assert.ok(aAudit > 0);
  const queue = record(await ownerA.listApprovalQueue(100));
  assert.equal(queue.status, "available");
  assert.deepEqual(queue.data?.map((item) => [item.approvalRequestId, item.runId]), [[`risk-approval-${"a".repeat(32)}`, "run-one"]]);
});

test("AI-038.0 live: a Run that exists only in B is unavailable from A, identical to a missing Run", async () => {
  const foreign = record(await ownerA.getRunOverview("run-b-only"));
  const missing = record(await ownerA.getRunOverview("run-never-created"));
  assert.deepEqual(foreign, { verdict: "deny", status: "unavailable", data: null });
  assert.deepEqual(foreign, missing);
  assert.deepEqual(record(await ownerA.getRunModelUsage("run-b-only")), missing);
  assert.deepEqual(record(await ownerA.getRunAuditTimeline("run-b-only")), missing);
});

test("AI-038.0 live: there is no API to retarget the bundle — no identity parameter exists and envelopes are rejected", async () => {
  assert.deepEqual(Reflect.ownKeys(ownerA).sort(), ["getRunAuditTimeline", "getRunModelUsage", "getRunOverview", "getTask", "listApprovalQueue", "listProjectTasks", "listProjects", "listRuns", "listTasks"]);
  const attempt: any = ownerA.getRunOverview;
  const retarget = record(await attempt({ workspaceId: B.domain, actorId: "owner-one", runId: "run-b-only" }));
  assert.equal(retarget.status, "invalid_input");
  const withExtra: any = ownerA.getRunModelUsage;
  const stillA = record(await withExtra("run-one", { workspaceId: B.domain }));
  assert.equal(stillA.data?.totalTokens, 11, "extra arguments are ignored; still A");
});

test("AI-038.0 live: a bundle for B sees only B, and a missing or inactive workspace cannot be composed", async () => {
  const composedB = await bundle.createOwnerReadRuntime({ database, domainWorkspaceId: B.domain, ownerActorId: "owner-one" });
  assert.equal(composedB.verdict, "allow");
  const overviewB = record(await composedB.backend!.getRunOverview("run-one"));
  assert.deepEqual([overviewB.data?.status, overviewB.data?.revision, overviewB.data?.modelUsage.totalTokens], ["queued", 0, 22]);
  assert.deepEqual(await bundle.createOwnerReadRuntime({ database, domainWorkspaceId: "workspace-missing", ownerActorId: "owner-one" }),
    { verdict: "deny", reason: "workspace_unavailable", backend: null });
  for (const [id, status] of [["00000000-0000-4000-8000-0000000000c3", "archived"], ["00000000-0000-4000-8000-0000000000c4", "suspended"]]) {
    const domain = `workspace-${status}`;
    await db.admin.query(`insert into workspaces (id, name, slug, type, region, status, domain_workspace_id)
      values ($1, $2, $2, 'company', 'eu', $3, $2)`, [id, domain, status]);
    assert.equal((await db.admin.query("select status from workspaces where domain_workspace_id = $1", [domain])).rows[0].status, status);
    assert.deepEqual(await bundle.createOwnerReadRuntime({ database, domainWorkspaceId: domain, ownerActorId: "owner-one" }),
      { verdict: "deny", reason: "workspace_unavailable", backend: null }, `${status} workspace`);
  }
});

test("AI-038.0 live: no raw workspace database UUID and no connection string appears in any result", () => {
  const text = outputs.join("\n");
  assert.equal(outputs.length, 11, "every recorded result is scanned");
  assert.equal(text.includes(A.id), false);
  assert.equal(text.includes(B.id), false);
  assert.equal(/postgres(ql)?:\/\//u.test(text), false);
});

test("AI-038.0 live teardown", async () => {
  await database.close();
});
