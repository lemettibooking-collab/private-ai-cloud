import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { FeaturePlan } from "../../lib/contracts/development-plan";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { roadmapFixture, roadmapMetadata, roadmapPlan } from "../fixtures/roadmap.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { controllerPorts } from "../fixtures/development-controller.mts";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const owner = await import(new URL("../../lib/roadmap/roadmap-owner-commands.ts", import.meta.url).href) as typeof import("../../lib/roadmap/roadmap-owner-commands");
const approvals = await import(new URL("../../lib/db/roadmap-approvals.ts", import.meta.url).href) as typeof import("../../lib/db/roadmap-approvals");
const core = await import(process.env.B3_CONTROLLER_MODULE ? pathToFileURL(process.env.B3_CONTROLLER_MODULE).href : new URL("../../lib/roadmap/development-controller.ts", import.meta.url).href) as typeof import("../../lib/roadmap/development-controller");
const gates = await import(process.env.B3_CONTROLLER_APPROVALS_MODULE ? pathToFileURL(process.env.B3_CONTROLLER_APPROVALS_MODULE).href : new URL("../../lib/db/development-controller-approvals.ts", import.meta.url).href) as typeof import("../../lib/db/development-controller-approvals");
const db = await live.useLiveDatabase("development_controller");
async function setup(label: string, options: Parameters<typeof controllerPorts>[3] = {}, withPlan = true, taskType = "feature", inputPlan?: Pick<FeaturePlan, "title" | "goal" | "tasks">) {
  const f = await roadmapFixture(db, label), t = await f.task("feature", taskType, false);
  if (withPlan) {
    const draft = roadmapPlan(); draft.tasks[0].allowedPaths = ["src"]; const plan = inputPlan ?? draft;
    const p = await f.planWriter.saveDraftRevision({ idempotencyKey: `plan-${label}-000000`, taskId: t.taskId, plan }); assert.equal(p.status, "created");
  }
  const writer = owner.createRoadmapOwnerCommands({ database: f.database, tenant: f.tenant, identitySource: f.identitySource });
  assert.equal((await writer.createMilestone({ commandId: "milestone", projectId: "project-a", milestoneId: "m1", title: "Delivery", goal: "Approved bounded delivery", priority: 1 })).status, "applied");
  assert.equal((await writer.enroll({ commandId: "enroll", projectId: "project-a", taskId: t.taskId, expectedVersion: 0, milestoneId: "m1", metadata: roadmapMetadata(), dependencyIds: [] })).status, "applied");
  assert.equal((await writer.changeState({ commandId: "ready", projectId: "project-a", taskId: t.taskId, expectedVersion: 1, nextStatus: "ready" })).status, "applied");
  const p = controllerPorts(f.database, f.tenant, t.taskId, options);
  const config = { database: f.database, tenant: f.tenant, repository: p.repository, routingSource: p.routingSource, contextSource: p.contextSource,
    executorPort: p.executorPort, qualityPort: p.qualityPort, securityPort: p.securityPort };
  let controller = core.createDevelopmentController(config), n = 0;
  const read = () => controller.inspect("project-a", t.taskId);
  const command = async (commandId = `tick-${++n}`) => { const s = await read(); assert.ok(s); return { commandId, projectId: "project-a", taskId: t.taskId, expectedVersion: s.task.version, expectedControllerRevision: s.revision }; };
  const tick = async () => controller.advanceController(await command());
  async function approvePlan() {
    const s = await read(); assert.ok(s);
    const q = (await db.admin.query(`select approval_request_id::text,binding_fingerprint from roadmap_approval_bindings where workspace_id=$1 and task_key=$2 and expected_task_version=$3`, [f.workspaceId, t.taskId, s.task.version])).rows[0]; assert.ok(q);
    const d = await approvals.createRoadmapOwnerApprovalDecisions({ database: f.database, tenant: f.tenant, identitySource: f.identitySource }).decide({ commandId: `plan-decision-${++n}`, projectId: "project-a", taskId: t.taskId,
      expectedVersion: s.task.version, approvalRequestId: q.approval_request_id, bindingFingerprint: q.binding_fingerprint, decision: "approved" }); assert.equal(d.status, "applied");
  }
  async function decideResult(decision = "approved") {
    const s = await read(); assert.ok(s);
    const q = (await db.admin.query(`select approval_request_id::text,binding_fingerprint from controller_owner_gate_bindings where workspace_id=$1 and task_key=$2 and expected_task_version=$3 and purpose='result_acceptance'`, [f.workspaceId, t.taskId, s.task.version])).rows[0]; assert.ok(q);
    return gates.createControllerOwnerGateDecisions({ database: f.database, tenant: f.tenant, identitySource: f.identitySource }).decide({ commandId: `result-decision-${++n}`, projectId: "project-a", taskId: t.taskId,
      expectedVersion: s.task.version, approvalRequestId: q.approval_request_id, bindingFingerprint: q.binding_fingerprint, decision });
  }
  async function until(action: string, max = 24) {
    for (let i = 0; i < max; i++) {
      const d = await tick(); assert.ok(!["invalid_input", "conflict", "unavailable", "recovery_required", "blocked"].includes(d.status), JSON.stringify(d));
      if (d.action === action) return d;
      if (d.action === "require_plan_approval" && d.status === "waiting_owner") await approvePlan();
    }
    assert.fail(`Controller did not reach ${action}`);
  }
  return { ...f, ...p, t, writer, config, read, command, tick, approvePlan, decideResult, until, restart() { controller = core.createDevelopmentController(config); return controller; } };
}

for (const provider of ["openai", "anthropic"] as const) test(`B3 checkpoint B ${provider}: actual durable pipeline to settled result, fresh controller each tick`, async () => {
  const x = await setup(`pipeline-${provider}`, { firstProvider: provider });
  for (let i = 0; i < 18; i++) {
    x.restart(); const d = await x.tick(); assert.ok(!["invalid_input", "conflict", "unavailable", "recovery_required", "blocked"].includes(d.status), JSON.stringify(d));
    if (d.action === "require_plan_approval" && d.status === "waiting_owner") await x.approvePlan();
    if (d.state?.runs.some(r => r.run.status === "verifying")) break;
  }
  const state = await x.read(); assert.ok(state); assert.equal(state.runs[0]?.run.status, "verifying", JSON.stringify(state));
  assert.equal(x.stats.starts, 1); assert.equal(x.stats.transmissions, 1); assert.deepEqual(x.stats.providers, [provider]);
  assert.equal(state.attempts[0].route && (state.attempts[0].route as { taskClass: string }).taskClass, "implementation");
  const facts = (await db.admin.query(`select e.state,(select count(*)::int from executor_attempt_results r where r.workspace_id=e.workspace_id and r.development_run_id=e.development_run_id) as results
    from executor_attempt_exposures e where e.workspace_id=$1`, [x.workspaceId])).rows;
  assert.equal(facts.length, 1); assert.equal(facts[0].state, "settled"); assert.equal(facts[0].results, 1);
});
test("B3 exact tick replay returns historical committed state and never calls executor twice", async () => {
  const x = await setup("tick-replay"); await x.until("select_route");
  const cmd = await x.command("one-start"), first = await core.createDevelopmentController(x.config).advanceController(cmd); assert.equal(first.status, "applied");
  const again = await core.createDevelopmentController(x.config).advanceController(cmd); assert.equal(again.status, "replayed"); assert.deepEqual(again.state, first.state);
  assert.equal(x.stats.transmissions, 1);
  const changed = await core.createDevelopmentController(x.config).advanceController({ ...cmd, expectedVersion: cmd.expectedVersion + 1 }); assert.equal(changed.status, "conflict");
});
test("B3 Router selection is not start authority and creates zero executor rights", async () => {
  const x = await setup("route-boundary"); await x.until("select_route"); assert.equal(x.stats.starts, 0); assert.equal(x.stats.transmissions, 0);
  const s = await x.read(); assert.ok(s); const route = (s.attempts[0].route as { decision: { dispatchAuthorized: boolean; runtimeDispatchAllowed: boolean } }).decision;
  assert.equal(route.dispatchAuthorized, false); assert.equal(route.runtimeDispatchAllowed, false);
  const facts = (await db.admin.query(`select (select count(*)::int from executor_run_authorities where workspace_id=$1) as authorities,
    (select count(*)::int from executor_attempt_exposures where workspace_id=$1) as exposures`, [x.workspaceId])).rows[0]; assert.deepEqual(facts, { authorities: 0, exposures: 0 });
});
test("B3 concurrent attempt start: one persisted operation, one fence winner, one provider transmission", async () => {
  const x = await setup("start-race"); await x.until("select_route"); const cmd = await x.command("contender");
  const decisions = await Promise.all(Array.from({ length: 8 }, (_, i) => core.createDevelopmentController(x.config).advanceController({ ...cmd, commandId: `contender-${i}` })));
  assert.equal(decisions.filter(d => d.status === "applied").length, 1); assert.equal(x.stats.transmissions, 1);
  assert.equal((await x.read())?.operations.filter(o => o.kind === "executor").length, 1);
});
test("B3 ambiguous transmission cannot be retried by exact replay, new command, restart or executor switch", async () => {
  const x = await setup("ambiguous", { ambiguous: true, correctiveProvider: "anthropic" }); await x.until("start_executor"); assert.equal(x.stats.transmissions, 1);
  x.restart(); const d = await x.tick(); assert.equal(d.state?.task.status, "recovery_required");
  for (let i = 0; i < 5; i++) { x.restart(); const r = await x.tick(); assert.equal(r.action, "recovery_required"); }
  assert.equal(x.stats.starts, 1); assert.equal(x.stats.transmissions, 1); assert.equal(x.stats.retrievals, 0);
  const facts = (await db.admin.query(`select e.state,b.held_exposure_usd_micros::text as held from executor_attempt_exposures e join executor_exposure_budgets b on b.workspace_id=e.workspace_id where e.workspace_id=$1`, [x.workspaceId])).rows;
  assert.equal(facts.length, 1); assert.equal(facts[0].state, "reconciliation_required"); assert.equal(facts[0].held, "10000");
});
test("B3 missing immutable plan enters Owner planning boundary with zero executor operations", async () => {
  const x = await setup("missing-plan", {}, false); assert.equal((await x.tick()).action, "claim_ready_task"); assert.equal((await x.tick()).action, "require_plan_approval");
  x.restart(); assert.equal((await x.tick()).status, "waiting_owner"); assert.equal((await x.read())?.task.status, "waiting_owner"); assert.equal(x.stats.starts, 0);
  assert.equal((await db.admin.query(`select count(*)::int as n from approval_requests where workspace_id=$1`, [x.workspaceId])).rows[0].n, 0);
});
test("B3 caller cannot choose taskClass/provider/executor or smuggle getter into controller command", async () => {
  const x = await setup("hostile"); const cmd = await x.command(); const controller = core.createDevelopmentController(x.config);
  for (const extra of [{ taskClass: "analysis" }, { providerId: "anthropic" }, { executor: "openai-agents" }]) assert.equal((await controller.advanceController({ ...cmd, ...extra })).status, "invalid_input");
  let reads = 0; assert.equal((await controller.advanceController({ ...cmd, get taskClass() { reads++; return "analysis"; } })).status, "invalid_input"); assert.equal(reads, 0); assert.equal(x.stats.starts, 0);
});
for (const provider of ["openai", "anthropic"] as const) test(`B3 C ${provider}: full QA, independent Security, final Owner acceptance, one completion`, async () => {
  const x = await setup(`complete-${provider}`, { firstProvider: provider });
  await x.until("report_security_gate"); assert.equal((await x.read())?.runs[0].run.status, "completed"); assert.notEqual((await x.read())?.task.status, "completed");
  assert.equal((await x.tick()).action, "require_result_acceptance"); assert.equal((await x.read())?.task.status, "waiting_owner");
  await x.tick(); assert.equal((await x.tick()).status, "waiting_owner");
  assert.equal(x.stats.quality, 1); assert.equal(x.stats.security, 1); assert.equal(x.stats.transmissions, 1);
  assert.equal((await x.decideResult()).status, "applied"); x.restart();
  const cmd = await x.command("complete-once"), d = await core.createDevelopmentController(x.config).advanceController(cmd); assert.equal(d.action, "complete_project_task"); assert.equal(d.state?.task.status, "completed");
  const replay = await core.createDevelopmentController(x.config).advanceController(cmd); assert.equal(replay.status, "replayed"); assert.deepEqual(replay.state, d.state);
  assert.equal((await x.tick()).action, "none"); assert.equal(x.stats.transmissions, 1);
  const facts = (await db.admin.query(`select status,completed_at is not null as completed from project_tasks where workspace_id=$1 and task_key=$2`, [x.workspaceId, x.t.taskId])).rows[0]; assert.deepEqual(facts, { status: "completed", completed: true });
});
for (const [from, to] of [["openai", "anthropic"], ["anthropic", "openai"]] as const) test(`B3 C corrective ${from}→${to}: repair routing, shared authority, full QA/Security rerun`, async () => {
  const x = await setup(`corrective-${from}`, { firstProvider: from, correctiveProvider: to, failQualityAttempt: 1 });
  await x.until("report_quality_gate"); let s = await x.read(); assert.equal(s?.runs[0].run.status, "awaiting_correction");
  x.restart(); await x.until("report_security_gate"); s = await x.read(); assert.equal(s?.runs[0].run.currentAttemptNumber, 2); assert.equal(s?.runs[0].run.status, "completed");
  assert.deepEqual(x.stats.providers, [from, to]); assert.deepEqual(x.stats.taskClasses, ["implementation", "repair"]); assert.equal(x.stats.quality, 2); assert.equal(x.stats.security, 1);
  await x.tick(); await x.tick(); assert.equal((await x.decideResult()).status, "applied"); assert.equal((await x.tick()).state?.task.status, "completed");
  const q = (await db.admin.query(`select current_attempt_number,authority_generation from executor_run_authorities where workspace_id=$1`, [x.workspaceId])).rows[0]; assert.equal(q.current_attempt_number, 2); assert.equal(q.authority_generation, 3); // Final Owner boundary revoked the settled current authority.
});
test("B3 C repeated failure stops at attempt two; distinct failures stop at maximum three", async () => {
  for (const distinct of [false, true]) {
    const x = await setup(`limits-${distinct}`, { qualityFailures: [1, 2, 3], distinctQualityFailures: distinct });
    for (let i = 0; i < 48; i++) { const d = await x.tick(); if (d.action === "require_plan_approval" && d.status === "waiting_owner") await x.approvePlan(); if (d.state?.task.status === "blocked") break; assert.ok(!["invalid_input", "conflict", "unavailable", "recovery_required"].includes(d.status), JSON.stringify(d)); }
    const s = await x.read(); assert.equal(s?.task.status, "blocked"); assert.equal(s?.runs[0].run.currentAttemptNumber, distinct ? 3 : 2); assert.equal(x.stats.transmissions, distinct ? 3 : 2);
    assert.ok(s?.runs[0].run.blockingReasons.some(r => r.code === (distinct ? "attempt_budget_exhausted" : "repeated_failure")));
    x.restart(); await x.tick(); assert.equal(x.stats.transmissions, distinct ? 3 : 2);
  }
});
test("B3 C final Owner rejection blocks; technical completion is not acceptance", async () => {
  const x = await setup("owner-rejection"); await x.until("report_security_gate"); await x.tick(); await x.tick(); assert.equal((await x.decideResult("rejected")).status, "applied");
  const d = await x.tick(); assert.equal(d.state?.task.status, "blocked"); assert.equal(x.stats.transmissions, 1);
});
test("B3 C scope expansion creates one Owner gate; hard stop cannot create an overridable gate", async () => {
  for (const outcome of ["fail_owner_required", "hard_stop"] as const) {
    const x = await setup(`scope-${outcome}`, { securityOutcome: outcome }); await x.until("report_security_gate");
    const before = await x.read(); assert.equal(before?.task.status, outcome === "hard_stop" ? "blocked" : "waiting_owner");
    await x.tick(); x.restart(); await x.tick();
    const q = (await db.admin.query(`select count(*)::int as n from controller_owner_gate_bindings where workspace_id=$1`, [x.workspaceId])).rows[0]; assert.equal(q.n, outcome === "hard_stop" ? 0 : 1); assert.equal(x.stats.transmissions, 1);
  }
});
test("B3 C known session recovery uses retrieval only; crash after fence before identity never regains start", async () => {
  const known = await setup("known-recovery", { firstProvider: "anthropic", skipSettlement: true }); await known.until("start_executor"); known.restart();
  assert.equal((await known.tick()).status, "recovery_required"); assert.equal(known.stats.retrievals, 1); assert.equal(known.stats.transmissions, 1);
  assert.equal((await known.tick()).state?.runs[0].run.status, "verifying"); assert.equal(known.stats.starts, 1);
  const unknown = await setup("lost-capability", { afterFence: async () => { throw Error("controlled crash after fence"); } }); await unknown.until("start_executor");
  unknown.restart(); assert.equal((await unknown.tick()).state?.task.status, "recovery_required"); assert.equal(unknown.stats.transmissions, 0); assert.equal(unknown.stats.starts, 1);
  for (let i = 0; i < 3; i++) { unknown.restart(); await unknown.tick(); } assert.equal(unknown.stats.starts, 1);
});
test("B3 C exact final gate request and Owner decision races have one factual queue/decision/completion", async () => {
  const x = await setup("owner-races"); await x.until("report_security_gate"); await x.tick();
  const s = await x.read(); assert.ok(s);
  const request = gates.createControllerOwnerGateRequests({ database: x.database, tenant: x.tenant });
  const pending = await Promise.all(Array.from({ length: 8 }, (_, i) => request.request({ commandId: `request-${i}`, projectId: "project-a", taskId: x.t.taskId, expectedVersion: s.task.version, expectedControllerRevision: s.revision, purpose: "result_acceptance" })));
  assert.ok(pending.every(d => d.status === "applied")); assert.equal(new Set(pending.flatMap(d => "approvalRequestId" in d ? [d.approvalRequestId] : [])).size, 1);
  const first = pending[0]; assert.ok("approvalRequestId" in first);
  const deciding = gates.createControllerOwnerGateDecisions({ database: x.database, tenant: x.tenant, identitySource: x.identitySource });
  const decisions = await Promise.all(Array.from({ length: 8 }, (_, i) => deciding.decide({ commandId: `decision-${i}`, projectId: "project-a", taskId: x.t.taskId, expectedVersion: s.task.version,
    approvalRequestId: first.approvalRequestId, bindingFingerprint: first.bindingFingerprint, decision: i % 2 ? "rejected" : "approved" })));
  assert.equal(decisions.filter(d => d.status === "applied").length, 1);
  const factual = (await db.admin.query(`select decision from approval_decisions where workspace_id=$1 and approval_request_id=$2`, [x.workspaceId, first.approvalRequestId])).rows; assert.equal(factual.length, 1);
  const cmd = await x.command(); const completions = await Promise.all(Array.from({ length: 8 }, (_, i) => core.createDevelopmentController(x.config).advanceController({ ...cmd, commandId: `completion-${i}` })));
  assert.equal(completions.filter(d => d.status === "applied").length, 1); assert.equal((await x.read())?.task.status, factual[0].decision === "approved" ? "completed" : "blocked");
});
test("B3 C cancellation invalidates pending exact Owner result approval; no stale override", async () => {
  const x = await setup("stale-result"); await x.until("report_security_gate"); await x.tick(); await x.tick(); const s = await x.read(); assert.ok(s);
  const q = (await db.admin.query(`select approval_request_id::text,binding_fingerprint from controller_owner_gate_bindings where workspace_id=$1`, [x.workspaceId])).rows[0];
  assert.equal((await x.writer.changeState({ commandId: "cancel-owner", projectId: "project-a", taskId: x.t.taskId, expectedVersion: s.task.version, nextStatus: "cancelled" })).status, "applied");
  const d = await gates.createControllerOwnerGateDecisions({ database: x.database, tenant: x.tenant, identitySource: x.identitySource }).decide({ commandId: "stale-decision", projectId: "project-a", taskId: x.t.taskId, expectedVersion: s.task.version,
    approvalRequestId: q.approval_request_id, bindingFingerprint: q.binding_fingerprint, decision: "approved" }); assert.equal(d.status, "conflict"); assert.equal((await x.read())?.task.status, "cancelled");
});
test("B3 C missing or self-certified QA/Security evidence never advances the execution", async () => {
  for (const kind of ["quality", "security"] as const) {
    const x = await setup(`bad-${kind}`); await x.until(kind === "quality" ? "await_executor_outcome" : "report_quality_gate");
    const badPort = { run: () => ({ outcome: "pass", summary: "Executor says everything is safe.", secret: "sk-test-secret-canary-never-real" }) };
    const controller = core.createDevelopmentController({ ...x.config, ...(kind === "quality" ? { qualityPort: badPort } : { securityPort: badPort }) });
    const before = await x.read(); assert.ok(before); const d = await controller.advanceController(await x.command()); assert.equal(d.status, "conflict"); assert.equal(d.state, null);
    assert.equal((await x.read())?.runs[0].run.status, before.runs[0].run.status); assert.equal(JSON.stringify(d).includes("canary"), false);
    const after = await x.tick(); assert.equal(after.state?.task.status, "recovery_required"); assert.equal(x.stats.transmissions, 1);
  }
});
test("B3 C changed candidate availability after selection blocks actual start", async () => {
  const x = await setup("stale-route"); await x.until("select_route"); x.routing.candidates[0].availability.state = "unavailable";
  const d = await x.tick(); assert.equal(d.state?.task.status, "blocked"); assert.equal(x.stats.transmissions, 0); assert.equal(x.stats.starts, 0);
});
test("B3 C analysis-only report uses factual report evidence and still requires full gates/Owner acceptance", async () => {
  const x = await setup("analysis", { firstProvider: "anthropic" }, true, "investigation"); await x.until("report_security_gate");
  const s = await x.read(); assert.ok(s); assert.deepEqual(s.runs[0].run.attempts[0].changedPaths, []); assert.match(s.runs[0].run.attempts[0].analysisReportFingerprint!, /^[a-f0-9]{64}$/u);
  assert.deepEqual(x.stats.taskClasses, ["analysis"]); await x.tick(); await x.tick(); await x.decideResult(); assert.equal((await x.tick()).state?.task.status, "completed");
});
test("B3 C analysis correction remains report-only across provider switch while trusted class becomes repair", async () => {
  const x = await setup("analysis-correction", { firstProvider: "anthropic", correctiveProvider: "openai", failQualityAttempt: 1 }, true, "investigation");
  await x.until("report_quality_gate"); x.restart(); await x.until("report_security_gate"); const s = await x.read(); assert.ok(s);
  assert.equal(s.runs[0].run.currentAttemptNumber, 2); assert.equal(s.runs[0].run.status, "completed"); assert.deepEqual(x.stats.taskClasses, ["analysis", "repair"]);
  assert.deepEqual(x.stats.providers, ["anthropic", "openai"]); assert.ok(s.runs[0].run.attempts.every(a => a.changedPaths.length === 0 && /^[a-f0-9]{64}$/u.test(a.analysisReportFingerprint!)));
  assert.ok(s.attempts.every(a => (a.invocation as { mode: string }).mode === "analysis_only")); assert.equal(x.stats.quality, 2);
});
for (const overlap of [false, true]) test(`B3 C plan waves ${overlap ? "overlap serializes" : "disjoint nodes coexist"}; completed nodes never rerun`, async () => {
  const plan = roadmapPlan(), a = { ...plan.tasks[0], id: "step-a", allowedPaths: ["src/a"] }, b = { ...plan.tasks[0], id: "step-b", sequence: 2, allowedPaths: [overlap ? "src/a" : "src/b"] }, c = { ...plan.tasks[0], id: "step-c", sequence: 3, allowedPaths: ["src/c"], dependencyIds: ["step-a", "step-b"] };
  const x = await setup(`waves-${overlap}`, {}, true, "feature", { ...plan, tasks: [a, b, c] } as Pick<FeaturePlan, "title" | "goal" | "tasks">);
  let coexisted = false;
  for (let i = 0; i < 72; i++) {
    x.restart(); const d = await x.tick(); assert.ok(!["invalid_input", "conflict", "unavailable", "recovery_required", "blocked"].includes(d.status), `${d.action}:${d.status}`);
    if (d.action === "require_plan_approval" && d.status === "waiting_owner") await x.approvePlan();
    const s = await x.read(); assert.ok(s); const active = s.runs.filter(r => !["completed", "ready"].includes(r.run.status)); if (active.length > 1) coexisted = true;
    const dependent = s.runs.find(r => r.run.taskId === "step-c"); if (dependent) assert.ok(["step-a", "step-b"].every(id => s.runs.some(r => r.run.taskId === id && r.run.status === "completed")));
    if (s.task.status === "waiting_owner" && s.runs.length === 3 && s.runs.every(r => r.run.status === "completed")) break;
  }
  assert.equal(coexisted, !overlap); await x.tick(); await x.decideResult(); assert.equal((await x.tick()).state?.task.status, "completed"); assert.equal(x.stats.transmissions, 3); assert.equal(x.stats.quality, 3); assert.equal(x.stats.security, 3);
});
test("B3 C same corrective attempt race has one factual attempt transition and no duplicate dispatch", async () => {
  const x = await setup("corrective-race", { failQualityAttempt: 1, correctiveProvider: "anthropic" }); await x.until("report_quality_gate"); const cmd = await x.command();
  const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => core.createDevelopmentController(x.config).advanceController({ ...cmd, commandId: `corrective-${i}` })));
  assert.equal(attempts.filter(d => d.status === "applied").length, 1); assert.equal((await x.read())?.runs[0].run.currentAttemptNumber, 2); assert.equal(x.stats.transmissions, 1);
  x.restart(); await x.until("report_security_gate"); assert.equal(x.stats.transmissions, 2);
});
test("B3 C final Owner decision racing cancellation never completes a cancelled task", async () => {
  const x = await setup("cancel-decision-race"); await x.until("report_security_gate"); await x.tick(); await x.tick(); const s = await x.read(); assert.ok(s);
  const q = (await db.admin.query(`select approval_request_id::text,binding_fingerprint from controller_owner_gate_bindings where workspace_id=$1`, [x.workspaceId])).rows[0];
  const decisions = gates.createControllerOwnerGateDecisions({ database: x.database, tenant: x.tenant, identitySource: x.identitySource });
  const [cancel, decision] = await Promise.all([x.writer.changeState({ commandId: "cancel-race", projectId: "project-a", taskId: x.t.taskId, expectedVersion: s.task.version, nextStatus: "cancelled" }),
    decisions.decide({ commandId: "approve-race", projectId: "project-a", taskId: x.t.taskId, expectedVersion: s.task.version, approvalRequestId: q.approval_request_id, bindingFingerprint: q.binding_fingerprint, decision: "approved" })]);
  assert.equal(cancel.status, "applied"); assert.ok(["applied", "conflict"].includes(decision.status)); assert.equal((await x.read())?.task.status, "cancelled"); assert.equal((await x.tick()).action, "none"); assert.equal(x.stats.transmissions, 1);
});
test("B3 C only Owner-accepted completion unlocks the next roadmap ProjectTask", async () => {
  const x = await setup("next-roadmap"), t = await x.task("next", "feature", false);
  assert.equal((await x.writer.enroll({ commandId: "enroll-next", projectId: "project-a", taskId: t.taskId, expectedVersion: 0, milestoneId: "m1", metadata: roadmapMetadata(), dependencyIds: [x.t.taskId] })).status, "applied");
  assert.equal((await x.writer.changeState({ commandId: "ready-next", projectId: "project-a", taskId: t.taskId, expectedVersion: 1, nextStatus: "ready" })).status, "applied");
  const controller = core.createDevelopmentController(x.config);
  assert.notEqual((await controller.advanceController({ commandId: "early-next", projectId: "project-a", taskId: t.taskId, expectedVersion: 2, expectedControllerRevision: 0 })).status, "applied");
  await x.until("report_security_gate"); await x.tick(); await x.tick();
  assert.notEqual((await controller.advanceController({ commandId: "technical-not-owner", projectId: "project-a", taskId: t.taskId, expectedVersion: 2, expectedControllerRevision: 0 })).status, "applied");
  await x.decideResult(); assert.equal((await x.tick()).state?.task.status, "completed");
  const next = await controller.advanceController({ commandId: "next-after-accepted", projectId: "project-a", taskId: t.taskId, expectedVersion: 2, expectedControllerRevision: 0 }); assert.equal(next.status, "applied"); assert.equal(next.state?.task.status, "planning"); assert.equal(x.stats.transmissions, 1);
});
test("B3 blocked production mode cannot invoke context, prepare, provider or gate ports", async () => {
  const x = await setup("blocked-production"); await x.until("start_development_attempt");
  let forbidden = 0; const port = () => { forbidden++; throw Error("port must stay unavailable"); };
  const controller = core.createDevelopmentController({ ...x.config, contextSource: { prepare: port }, executorPort: { mode: "blocked", prepare: port, start: port, observe: port, reconcile: port }, qualityPort: { run: port }, securityPort: { run: port } });
  const d = await controller.advanceController(await x.command()); assert.equal(d.status, "live_unavailable"); assert.equal(d.runtimeDispatchAllowed, false); assert.equal(forbidden, 0); assert.equal(x.stats.transmissions, 0);
  assert.equal((await x.read())?.attempts.length, 0);
});
test("B3 approval-request ticks replay their exact immutable state and reject changed revision", async () => {
  const x = await setup("approval-tick-replay"); await x.tick(); await x.tick();
  const cmd = await x.command("plan-request-tick"), first = await core.createDevelopmentController(x.config).advanceController(cmd); assert.equal(first.status, "applied");
  const repeated = await core.createDevelopmentController(x.config).advanceController(cmd); assert.equal(repeated.status, "replayed"); assert.deepEqual(repeated.state, first.state);
  assert.equal((await core.createDevelopmentController(x.config).advanceController({ ...cmd, expectedControllerRevision: cmd.expectedControllerRevision + 1 })).status, "conflict");
  await x.approvePlan(); await x.until("report_security_gate"); await x.tick();
  const finalCmd = await x.command("final-request-tick"), final = await core.createDevelopmentController(x.config).advanceController(finalCmd); assert.equal(final.status, "applied");
  await x.decideResult(); await x.tick();
  const old = await core.createDevelopmentController(x.config).advanceController(finalCmd); assert.equal(old.status, "replayed"); assert.deepEqual(old.state, final.state); assert.equal(old.state?.task.status, "waiting_owner");
  assert.equal(x.stats.transmissions, 1);
});

type WaveExecutionFact = { development_run_id: string; task_id: string; state: string; started: boolean; identity_state: string;
  session_id: string; turn_id: string | null; identity_recovery: boolean; start_journals: number; controller_operations: number; result_count: number };
async function waveExecutionFacts(workspaceId: string): Promise<WaveExecutionFact[]> {
  return (await db.admin.query(`select e.development_run_id,e.task_id,e.state,e.started_at is not null as started,
    p.identity_state,p.session_id,p.turn_id,p.recovery_required as identity_recovery,
    (select count(*)::int from executor_attempt_events j where j.workspace_id=e.workspace_id and j.development_run_id=e.development_run_id
      and j.attempt_number=e.attempt_number and j.operation='start' and j.state='start_committed') as start_journals,
    (select count(*)::int from controller_operations o where o.workspace_id=e.workspace_id and o.development_run_id=e.development_run_id
      and o.attempt_number=e.attempt_number and o.kind='executor') as controller_operations,
    (select count(*)::int from executor_attempt_results r where r.workspace_id=e.workspace_id and r.development_run_id=e.development_run_id
      and r.attempt_number=e.attempt_number) as result_count
    from executor_attempt_exposures e left join executor_provider_executions p on p.workspace_id=e.workspace_id
      and p.development_run_id=e.development_run_id and p.attempt_number=e.attempt_number
    where e.workspace_id=$1 order by e.task_id`, [workspaceId])).rows as WaveExecutionFact[];
}
function twoNodeWave(overlap = false): Pick<FeaturePlan, "title" | "goal" | "tasks"> {
  const plan = roadmapPlan(), a = { ...plan.tasks[0], id: "step-a", allowedPaths: ["src/a"] },
    b = { ...plan.tasks[0], id: "step-b", sequence: 2, allowedPaths: [overlap ? "src/a" : "src/b"] };
  return { ...plan, tasks: [a, b] } as Pick<FeaturePlan, "title" | "goal" | "tasks">;
}
async function assertTwoInFlight(x: Awaited<ReturnType<typeof setup>>) {
  const facts = await waveExecutionFacts(x.workspaceId); assert.equal(facts.length, 2);
  assert.deepEqual(facts.map(f => f.task_id), ["step-a", "step-b"]);
  assert.equal(new Set(facts.map(f => f.development_run_id)).size, 2); assert.equal(new Set(facts.map(f => f.session_id)).size, 2);
  for (const fact of facts) {
    assert.equal(fact.state, "start_committed"); assert.equal(fact.started, true); assert.ok(fact.session_id);
    assert.ok(["session_observed", "turn_observed"].includes(fact.identity_state)); assert.equal(fact.identity_recovery, false);
    assert.equal(fact.start_journals, 1); assert.equal(fact.controller_operations, 1); assert.equal(fact.result_count, 0);
  }
  assert.equal(x.stats.starts, 2); assert.equal(x.stats.transmissions, 2); assert.equal(x.stats.observedOutcomes, 0);
  assert.equal(x.pendingOutcomeRunIds().length, 2);
  const state = await x.read(); assert.ok(state); assert.ok(state.runs.every(r => r.run.status === "implementing" && r.run.currentAttemptNumber === 1));
  const budget = (await db.admin.query(`select held_exposure_usd_micros::text as held from executor_exposure_budgets where workspace_id=$1`, [x.workspaceId])).rows[0];
  assert.equal(budget.held, "20000");
}
async function completeDeferredWave(x: Awaited<ReturnType<typeof setup>>, pendingCount = 2) {
  assert.equal(await x.settleDeferred(), pendingCount);
  await x.until("require_result_acceptance", 60); await x.tick(); assert.equal((await x.decideResult()).status, "applied");
  assert.equal((await x.tick()).state?.task.status, "completed");
  assert.equal(x.stats.starts, 2); assert.equal(x.stats.transmissions, 2); assert.equal(x.stats.quality, 2); assert.equal(x.stats.security, 2);
  assert.ok((await waveExecutionFacts(x.workspaceId)).every(f => f.state === "settled" && f.start_journals === 1 && f.result_count === 1));
}
for (const provider of ["openai", "anthropic"] as const) test(`B3 corrective frontier disjoint ${provider}: two factual starts before either terminal outcome, restart one/both and complete`, async () => {
  const x = await setup(`frontier-${provider}`, { firstProvider: provider, deferOutcomes: true }, true, "feature", twoNodeWave());
  let restartedOne = false;
  for (let n = 0; n < 40 && x.stats.transmissions < 2; n++) {
    const d = await x.tick(); assert.ok(!["invalid_input", "conflict", "unavailable", "recovery_required", "blocked"].includes(d.status), `${d.action}:${d.status}`);
    if (d.action === "require_plan_approval" && d.status === "waiting_owner") await x.approvePlan();
    assert.notEqual(d.action, "await_executor_outcome", "a started disjoint sibling must not monopolize the wave before the second legitimate start");
    if (x.stats.transmissions === 1 && !restartedOne) {
      const facts = await waveExecutionFacts(x.workspaceId); assert.equal(facts.length, 1); assert.equal(facts[0].state, "start_committed"); assert.ok(facts[0].session_id); assert.equal(facts[0].result_count, 0);
      x.restart(); restartedOne = true; assert.equal(x.stats.transmissions, 1);
    }
  }
  assert.equal(restartedOne, true); assert.equal(x.stats.outcomeReads, 0, "no first result is even polled before both starts");
  await assertTwoInFlight(x); x.restart();
  for (let n = 0; n < 3; n++) {
    const d = await x.tick(); assert.equal(d.action, "await_executor_outcome");
    assert.equal(d.state?.task.status, "running"); x.restart(); await assertTwoInFlight(x);
  }
  await completeDeferredWave(x);
});
test("B3 corrective frontier overlap: second start remains blocked through first implementation and full gates", async () => {
  const x = await setup("frontier-overlap", { deferOutcomes: true }, true, "feature", twoNodeWave(true));
  await x.until("start_executor"); const first = (await waveExecutionFacts(x.workspaceId))[0]; assert.equal(first.task_id, "step-a");
  for (let n = 0; n < 3; n++) {
    x.restart(); assert.equal((await x.tick()).action, "await_executor_outcome");
    const facts = await waveExecutionFacts(x.workspaceId); assert.equal(facts.length, 1); assert.equal(facts[0].state, "start_committed"); assert.equal(facts[0].result_count, 0);
    assert.equal(x.stats.starts, 1); assert.equal(x.stats.transmissions, 1);
  }
  assert.equal(await x.settleDeferred(first.development_run_id), 1);
  let secondStarted = false;
  for (let n = 0; n < 32; n++) {
    const before = await x.read(); assert.ok(before); const d = await x.tick();
    assert.ok(!["invalid_input", "conflict", "unavailable", "recovery_required", "blocked"].includes(d.status), `${d.action}:${d.status}`);
    if (x.stats.transmissions === 2) { assert.equal(before.runs.find(r => r.run.taskId === "step-a")?.run.status, "completed"); secondStarted = true; break; }
    assert.equal(x.stats.transmissions, 1); x.restart();
  }
  assert.equal(secondStarted, true); const facts = await waveExecutionFacts(x.workspaceId);
  assert.deepEqual(facts.map(f => f.state), ["settled", "start_committed"]); assert.ok(facts.every(f => f.start_journals === 1 && f.controller_operations === 1));
  assert.equal(x.stats.quality, 1); assert.equal(x.stats.security, 1);
  await completeDeferredWave(x, 1);
});
test("B3 corrective frontier concurrent controllers: each disjoint node has one legitimate start and one operation", async () => {
  const x = await setup("frontier-race", { firstProvider: "anthropic", deferOutcomes: true }, true, "feature", twoNodeWave());
  await x.until("select_route"); const a = core.createDevelopmentController(x.config), b = core.createDevelopmentController(x.config);
  const trace = live.installQueryInterceptor(), pids = new Set<number>(); trace.observe((_sql, c) => { if (c.processID) pids.add(c.processID); });
  try {
    for (let n = 0; n < 20 && x.stats.transmissions < 2; n++) {
      const cmd = await x.command(), decisions = await Promise.all([a.advanceController({ ...cmd, commandId: `wave-a-${n}` }), b.advanceController({ ...cmd, commandId: `wave-b-${n}` })]);
      assert.equal(decisions.filter(d => d.status === "applied").length, 1); assert.ok(decisions.every(d => ["applied", "conflict"].includes(d.status)));
      assert.ok(decisions.every(d => d.action !== "await_executor_outcome"), "another controller must still advance the independent pre-wait frontier");
    }
  } finally { trace.restore(); }
  assert.ok(pids.size >= 2, "independent PostgreSQL sessions execute concurrent controller CAS operations");
  assert.equal(x.stats.outcomeReads, 0); await assertTwoInFlight(x); x.restart(); await assertTwoInFlight(x);
  await completeDeferredWave(x);
});
