import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkflowRuntimeDatabase } from "../../lib/db/workflow-runtime-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { roadmapFixture, roadmapMetadata, roadmapPlan } from "../fixtures/roadmap.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { controllerPorts } from "../fixtures/development-controller.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const owner = await import(new URL("../../lib/roadmap/roadmap-owner-commands.ts", import.meta.url).href) as typeof import("../../lib/roadmap/roadmap-owner-commands");
const approval = await import(new URL("../../lib/db/roadmap-approvals.ts", import.meta.url).href) as typeof import("../../lib/db/roadmap-approvals");
const core = await import(new URL("../../lib/roadmap/development-controller.ts", import.meta.url).href) as typeof import("../../lib/roadmap/development-controller");
const readerModule = await import(new URL("../../lib/db/roadmap-owner-read.ts", import.meta.url).href) as typeof import("../../lib/db/roadmap-owner-read");
const db = await live.useLiveDatabase("roadmap_owner_read");
async function setup(label: string, withPlan = false) {
  const f = await roadmapFixture(db, label), task = await f.task("read", "feature", false);
  if (withPlan) { const plan = roadmapPlan(); plan.tasks[0].allowedPaths = ["src"]; assert.equal((await f.planWriter.saveDraftRevision({ idempotencyKey: `plan-${label}-read-000000`, taskId: task.taskId, plan })).status, "created"); }
  const writer = owner.createRoadmapOwnerCommands({ database: f.database, tenant: f.tenant, identitySource: f.identitySource });
  assert.equal((await writer.createMilestone({ commandId: "milestone", projectId: "project-a", milestoneId: "m1", title: "Delivery", goal: "Owner roadmap", priority: 1 })).status, "applied");
  assert.equal((await writer.enroll({ commandId: "enroll", projectId: "project-a", taskId: task.taskId, expectedVersion: 0, milestoneId: "m1", metadata: roadmapMetadata(), dependencyIds: [] })).status, "applied");
  assert.equal((await writer.changeState({ commandId: "ready", projectId: "project-a", taskId: task.taskId, expectedVersion: 1, nextStatus: "ready" })).status, "applied");
  const reader = () => readerModule.createRoadmapOwnerReader({ database: f.database, domainWorkspaceId: f.domain, identitySource: f.identitySource });
  return { ...f, createTask: f.task, task, writer, reader };
}
test("Owner read reconstructs real enrolled work and dependency readiness; legacy work stays manual", async () => {
  const f = await setup("readiness"), legacy = await f.createTask("legacy", "feature", false), dependent = await f.createTask("dependent", "fix", false);
  assert.equal((await f.writer.enroll({ commandId: "dependent-enroll", projectId: "project-a", taskId: dependent.taskId, expectedVersion: 0, milestoneId: "m1", metadata: roadmapMetadata(), dependencyIds: [f.task.taskId] })).status, "applied");
  assert.equal((await f.writer.changeState({ commandId: "dependent-ready", projectId: "project-a", taskId: dependent.taskId, expectedVersion: 1, nextStatus: "ready" })).status, "applied");
  const view = await f.reader().read(); assert.equal(view.state, "available"); if (view.state !== "available") return;
  assert.equal(view.tasks.length, 2); assert.ok(!view.tasks.some(t => t.taskId === legacy.taskId)); assert.equal(view.tasks.find(t => t.taskId === f.task.taskId)?.ready, true); assert.equal(view.tasks.find(t => t.taskId === dependent.taskId)?.ready, false);
  assert.equal(view.milestones[0].totalTasks, 2); assert.equal(view.milestones[0].completedTasks, 0); assert.equal(view.runtimeDispatchAllowed, false);
  const again = await f.reader().read(); assert.deepEqual(view, again); assert.notEqual(view, again); assert.ok(Object.isFrozen(view.tasks));
});
test("Owner project scope does not fall back or leak other tenant/project work", async () => {
  const f = await setup("scope"), other = await setup("other");
  for (const selector of ["missing", "archived", ["project-a"], ""]) assert.deepEqual(await f.reader().read(selector), { state: "project_unavailable" });
  const projectB = await f.reader().read("project-b"); assert.equal(projectB.state, "available"); if (projectB.state === "available") { assert.equal(projectB.tasks.length, 0); assert.equal(projectB.milestones.length, 0); }
  const view = await f.reader().read("project-a"); assert.equal(view.state, "available"); if (view.state === "available") assert.ok(!view.tasks.some(t => t.taskId === other.task.taskId));
});
for (const provider of ["openai", "anthropic"] as const) test(`Owner view projects ${provider} factual route/attempt/full gates/pending final acceptance without raw state`, async () => {
  const f = await setup(`pipeline-${provider}`, true);
  const ports = controllerPorts(f.database, f.tenant, f.task.taskId, { firstProvider: provider });
  const config = { database: f.database, tenant: f.tenant, repository: ports.repository, routingSource: ports.routingSource, contextSource: ports.contextSource, executorPort: ports.executorPort, qualityPort: ports.qualityPort, securityPort: ports.securityPort };
  for (let n = 1; n <= 25; n++) {
    const controller = core.createDevelopmentController(config), state = await controller.inspect("project-a", f.task.taskId); assert.ok(state);
    const d = await controller.advanceController({ commandId: `tick-${n}`, projectId: "project-a", taskId: f.task.taskId, expectedVersion: state.task.version, expectedControllerRevision: state.revision });
    assert.ok(!["invalid_input", "unavailable", "blocked", "conflict", "recovery_required"].includes(d.status), JSON.stringify(d));
    if (d.action === "require_plan_approval" && d.status === "waiting_owner") {
      const current = await controller.inspect("project-a", f.task.taskId); assert.ok(current);
      const row = (await db.admin.query(`select approval_request_id::text,binding_fingerprint from roadmap_approval_bindings where workspace_id=$1 and task_key=$2 and expected_task_version=$3`, [f.workspaceId, f.task.taskId, current.task.version])).rows[0]; assert.ok(row);
      assert.equal((await approval.createRoadmapOwnerApprovalDecisions({ database: f.database, tenant: f.tenant, identitySource: f.identitySource }).decide({ commandId: `approve-${n}`, projectId: "project-a", taskId: f.task.taskId, expectedVersion: current.task.version, approvalRequestId: row.approval_request_id, bindingFingerprint: row.binding_fingerprint, decision: "approved" })).status, "applied");
    }
    if (d.action === "require_result_acceptance") {
      const pending = await db.admin.query(`select approval_request_id from controller_owner_gate_bindings where workspace_id=$1 and task_key=$2 and purpose='result_acceptance'`, [f.workspaceId, f.task.taskId]);
      if (pending.rowCount === 1) break;
    }
  }
  const view = await f.reader().read(); assert.equal(view.state, "available"); if (view.state !== "available") return;
  const task = view.tasks.find(t => t.taskId === f.task.taskId); assert.ok(task); assert.equal(task.status, "waiting_owner"); assert.equal(task.completedNodes, 1); assert.equal(task.totalNodes, 1); assert.ok(task.controllerRevision > 0); assert.equal(task.nodes[0].attemptNumber, 1); assert.equal(task.nodes[0].selectedExecutor, provider === "openai" ? "openai-agents/v1" : "claude-managed-agents/v1"); assert.equal(task.nodes[0].quality, "pass"); assert.equal(task.nodes[0].security, "pass"); assert.deepEqual(task.pendingOwnerPurposes, ["result_acceptance"]); assert.equal(task.heldExposureUsdMicros, 0);
  assert.doesNotMatch(JSON.stringify(view), /configurationFingerprint|contextFingerprint|intentFingerprint|correlationFingerprint|sessionId|turnId|account-a|explicit-test-model|authorized test context|Unverified proposal/u);
  assert.equal(ports.stats.transmissions, 1);
});
test("Owner revocation is checked before any roadmap raw data read", async () => {
  const f = await setup("revoked"); await db.admin.query(`delete from member_role_assignments where member_id in(select id from workspace_members where workspace_id=$1 and user_id=$2)`, [f.workspaceId, f.ownerId]);
  let reads = 0; const wrapper: WorkflowRuntimeDatabase = { async connect() { const c = await f.database.connect(); return { async query(sql, values) { if (sql.includes("roadmap-owner:")) reads++; return c.query(sql, values); }, release(destroy) { c.release(destroy); } }; } };
  const reader = readerModule.createRoadmapOwnerReader({ database: wrapper, domainWorkspaceId: f.domain, identitySource: f.identitySource }); assert.deepEqual(await reader.read(), { state: "unavailable" }); assert.equal(reads, 0);
});
test("Owner read creates no guards/controller/approval/audit facts", async () => {
  const f = await setup("readonly");
  async function counts() { return (await db.admin.query(`select (select count(*)::int from roadmap_project_guards where workspace_id=$1) as guards,(select count(*)::int from controller_state_events where workspace_id=$1) as controller,(select count(*)::int from approval_requests where workspace_id=$1) as approvals,(select count(*)::int from audit_events where workspace_id=$1) as audit`, [f.workspaceId])).rows[0]; }
  const before = await counts(); let writes = 0;
  const database: WorkflowRuntimeDatabase = { async connect() { const c = await f.database.connect(); return { async query(sql, values) { if (/\b(?:insert\s+into|update\s+[a-z_]+\s+set|delete\s+from)\b/iu.test(sql)) writes++; return c.query(sql, values); }, release(destroy) { c.release(destroy); } }; } };
  const reader = readerModule.createRoadmapOwnerReader({ database, domainWorkspaceId: f.domain, identitySource: f.identitySource }); assert.equal((await reader.read()).state, "available"); assert.deepEqual(await counts(), before); assert.equal(writes, 0);
});
test("tampered stored execution fingerprint fails entire Owner view closed", async () => {
  const f = await setup("tamper");
  // Driver-boundary corruption simulates hostile/tampered durable data without weakening immutable DB constraints.
  const database: WorkflowRuntimeDatabase = { async connect() { const c = await f.database.connect(); return { async query<Row extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) { const r = await c.query<Row>(sql, values); if (sql.includes("roadmap:task-read") && r.rowCount) return { ...r, rows: r.rows.map(row => ({ ...row, roadmap_metadata_fingerprint: "f".repeat(64) })) as readonly Row[] }; return r; }, release(destroy) { c.release(destroy); } }; } };
  const reader = readerModule.createRoadmapOwnerReader({ database, domainWorkspaceId: f.domain, identitySource: f.identitySource }); assert.deepEqual(await reader.read(), { state: "unavailable" });
});
