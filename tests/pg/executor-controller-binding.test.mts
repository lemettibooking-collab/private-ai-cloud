import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import type { DevelopmentControllerState, DevelopmentControllerDecision } from "../../lib/db/development-controller-store";
const live = await import(new URL("./helpers/live-pg.ts", import.meta.url).href) as typeof import("./helpers/live-pg");
const fixture = await import(new URL("../fixtures/roadmap.mts", import.meta.url).href) as typeof import("../fixtures/roadmap.mts");
const owner = await import(new URL("../../lib/roadmap/roadmap-owner-commands.ts", import.meta.url).href) as typeof import("../../lib/roadmap/roadmap-owner-commands");
const roadmap = await import(new URL("../../lib/db/roadmap-store.ts", import.meta.url).href) as typeof import("../../lib/db/roadmap-store");
const approvals = await import(new URL("../../lib/db/roadmap-approvals.ts", import.meta.url).href) as typeof import("../../lib/db/roadmap-approvals");
const controllers = await import(new URL("../../lib/db/development-controller-store.ts", import.meta.url).href) as typeof import("../../lib/db/development-controller-store");
const binding = await import(new URL("../../lib/db/executor-controller-binding.ts", import.meta.url).href) as typeof import("../../lib/db/executor-controller-binding");
const start = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const authority = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const routing = await import(new URL("../fixtures/executor-routing.mts", import.meta.url).href) as typeof import("../fixtures/executor-routing.mts");
const requests = await import(new URL("../../lib/executors/openai-agents-request.ts", import.meta.url).href) as typeof import("../../lib/executors/openai-agents-request");
const adapter = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const outcome = await import(new URL("../../lib/executors/executor-outcome.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-outcome");
const transactions = await import(new URL("../../lib/tasks/owner-task-mutations.ts", import.meta.url).href) as typeof import("../../lib/tasks/owner-task-mutations");
const db = await live.useLiveDatabase("controllerbinding"), f = await fixture.roadmapFixture(db, "executor-binding");
const writer = owner.createRoadmapOwnerCommands({ database: f.database, tenant: f.tenant, identitySource: f.identitySource });
const requestStore = approvals.createRoadmapApprovalRequests({ database: f.database, tenant: f.tenant });
const decisionStore = approvals.createRoadmapOwnerApprovalDecisions({ database: f.database, tenant: f.tenant, identitySource: f.identitySource });
await writer.createMilestone({ commandId: "binding-milestone", projectId: "project-a", milestoneId: "binding-milestone", title: "Binding", goal: "Factual start fencing", priority: 1 });
let sequence = 0;
const commandId = () => `binding-command-${++sequence}`;
function applied(d: DevelopmentControllerDecision): DevelopmentControllerState {
  assert.ok(d.status === "applied" || d.status === "replayed", JSON.stringify(d)); return d.state;
}
async function setup(label: string) {
  const task = await f.task(label, "feature", false), projectId = task.projectId, projectTaskId = task.taskId;
  const draft = fixture.roadmapPlan(), path = `lib/feature/${label}`;
  const saved = await f.planWriter.saveDraftRevision({ idempotencyKey: `binding-plan-${label}-000000`, taskId: projectTaskId,
    plan: { ...draft, tasks: draft.tasks.map(t => ({ ...t, allowedPaths: [path] })) } });
  assert.ok(saved.status === "created" || saved.status === "replayed");
  const base = (version: number) => ({ commandId: commandId(), projectId, taskId: projectTaskId, expectedVersion: version });
  assert.equal((await writer.enroll({ ...base(0), milestoneId: "binding-milestone", metadata: fixture.roadmapMetadata(), dependencyIds: [] })).status, "applied");
  assert.equal((await writer.changeState({ ...base(1), nextStatus: "ready" })).status, "applied");
  assert.equal((await roadmap.createRoadmapStore({ database: f.database, tenant: f.tenant }).claimReady(base(2))).status, "applied");
  const approval = await requestStore.requestPlanApproval(base(3)); assert.equal(approval.status, "applied");
  if (approval.status !== "applied") throw Error("missing approval");
  assert.equal((await decisionStore.decide({ ...base(3), approvalRequestId: approval.approvalRequestId, bindingFingerprint: approval.bindingFingerprint, decision: "approved" })).status, "applied");
  const controller = controllers.createDevelopmentControllerStore({ database: f.database, tenant: f.tenant });
  let state = await controller.read(projectId, projectTaskId); assert.ok(state);
  const command = () => ({ ...base(state!.task.version), expectedControllerRevision: state!.revision });
  state = applied(await controller.consumePlanApproval({ ...command(), approvalRequestId: approval.approvalRequestId }));
  assert.ok(state.approvedPlan);
  const plan = state.approvedPlan.plan, developmentTaskId = plan.tasks[0].id, developmentRunId = `binding-${label}`;
  const admission = { plan, taskId: developmentTaskId, completedTaskIds: [], activeTaskIds: [], repositoryAllowlist: ["lib/feature"], taskOwnerApprovalGranted: true };
  state = applied(await controller.createRun({ ...command(), developmentRunId, developmentTaskId, admission }));
  state = applied(await controller.transitionRun({ ...command(), developmentRunId, expectedRunRevision: 0, event: { type: "start_attempt" } }));
  const run = state.runs.find(x => x.run.id === developmentRunId)!;
  const configuration = { identity: { id: "openai-agents", version: "v1" }, capabilities: { tasks: ["coding", "repository_analysis"],
    modes: ["patch_proposal", "analysis_only"], artifacts: ["patch", "report"] }, repository: { id: "repo-a", baseline: "a".repeat(40) }, admission, developmentRun: run.run };
  const invocation = { schemaVersion: 1, invocationId: `invocation-${label}`, identity: configuration.identity, planId: plan.id, taskId: developmentTaskId,
    repository: configuration.repository, capability: "coding", mode: "patch_proposal", attempt: { developmentRunId, number: 1, kind: "initial" } };
  const context = { files: [{ path: `${path}/a.ts`, content: "// bounded approved context" }] };
  const target = { providerId: "openai", accountId: "account-a", modelId: "explicit-test-model" }, requestPolicy = requests.createOpenAIAgentsRequestPolicy();
  const financialPolicy = { maximumExposureUsdMicros: 20000, totalExposureUsdMicros: 1000000000, reservationTtlMs: 60000 };
  const executionPolicy = binding.executorControllerExecutionPolicy(configuration, invocation, context, requestPolicy, target, financialPolicy, f.workspaceId); assert.ok(executionPolicy);
  const router = routing.routerModule.createExecutorRouter([routing.candidate()]).router; assert.ok(router);
  const route = { decision: router.select({ ...routing.requirement(), admission, developmentRun: run.run, repository: configuration.repository }), taskClass: "implementation" };
  assert.equal(route.decision.verdict, "allow");
  state = applied(await controller.saveAttemptIntent({ ...command(), developmentRunId, expectedRunRevision: run.revision, configuration, invocation, context, route, executionPolicy }));
  const intent = state.attempts.find(x => x.developmentRunId === developmentRunId)!; assert.ok(intent);
  const controllerBinding = { projectTaskId, intentFingerprint: intent.intentFingerprint };
  const config = { database: f.database, tenant: f.tenant, projectId, configuration, target, requestPolicy, financialPolicy, authorizeStart: () => true, controllerBinding };
  const authorityConfig = { database: f.database, tenant: f.tenant, projectId, configuration, controllerBinding };
  const authorityStore = authority.createPostgresExecutorCurrentAuthorityStore(authorityConfig), store = start.createPostgresExecutorStartStore(config);
  const cancel = () => writer.changeState({ ...base(state!.task.version), nextStatus: "cancelled" });
  return { projectId, projectTaskId, developmentRunId, controller, state, configuration, invocation, context, config, authorityConfig, authorityStore, store, cancel };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function prepared(label: string) {
  const x = await setup(label); assert.equal((await x.authorityStore.registerCurrentAuthority()).verdict, "allow");
  assert.equal((await x.store.reserve(x.invocation, { maximumExposureUsdMicros: 10000 })).status, "reserved");
  const prepared = await x.store.bindRequest(x.invocation, x.context); assert.ok(prepared.snapshot?.requestFingerprint);
  return { ...x, requestFingerprint: prepared.snapshot.requestFingerprint };
}
function denied(d: { verdict: string; snapshot: unknown; startCapability?: unknown }) {
  assert.equal(d.verdict, "deny"); assert.equal(d.snapshot, null); if ("startCapability" in d) assert.equal(d.startCapability, null);
}
async function facts(x: Fixture) {
  const run = (await db.admin.query(`select status,state_version from project_tasks where workspace_id=$1 and task_key=$2`, [f.workspaceId, x.projectTaskId])).rows[0];
  const a = (await db.admin.query(`select authority_status,authority_generation from executor_run_authorities where workspace_id=$1 and development_run_id=$2`, [f.workspaceId, x.developmentRunId])).rows;
  const e = (await db.admin.query(`select state from executor_attempt_exposures where workspace_id=$1 and development_run_id=$2`, [f.workspaceId, x.developmentRunId])).rows;
  return { run, authority: a, exposures: e };
}
test("B3 PG mapped Run requires exact intent binding, including through legacy authority/start factories", async () => {
  const x = await prepared("legacy");
  const { controllerBinding: _a, ...legacyAuthority } = x.authorityConfig;
  const { controllerBinding: _s, ...legacyConfig } = x.config;
  void _a; void _s;
  denied(await authority.createPostgresExecutorCurrentAuthorityStore(legacyAuthority).registerCurrentAuthority());
  denied(await start.createPostgresExecutorStartStore(legacyConfig).commitProviderStart(x.invocation, x.requestFingerprint));
  for (const controllerBinding of [{ projectTaskId: "other-owner-task", intentFingerprint: x.config.controllerBinding.intentFingerprint }, { ...x.config.controllerBinding, intentFingerprint: "f".repeat(64) }])
    denied(await start.createPostgresExecutorStartStore({ ...x.config, controllerBinding }).commitProviderStart(x.invocation, x.requestFingerprint));
  assert.equal((await facts(x)).exposures[0].state, "prepared");
});
test("B3 PG binding pins invocation, target account/model and financial policy before first reservation", async () => {
  const x = await setup("execution-policy"); assert.equal((await x.authorityStore.registerCurrentAuthority()).verdict, "allow");
  for (const target of [{ ...x.config.target, accountId: "account-b" }, { ...x.config.target, modelId: "changed-model" }])
    denied(await start.createPostgresExecutorStartStore({ ...x.config, target }).reserve(x.invocation, { maximumExposureUsdMicros: 10000 }));
  denied(await start.createPostgresExecutorStartStore({ ...x.config, financialPolicy: { ...x.config.financialPolicy, maximumExposureUsdMicros: 30000 } }).reserve(x.invocation, { maximumExposureUsdMicros: 10000 }));
  denied(await x.store.reserve({ ...x.invocation, invocationId: "different-invocation" }, { maximumExposureUsdMicros: 10000 }));
  assert.deepEqual((await facts(x)).exposures, []);
});
test("B3 PG cancellation before authority registration prevents late registration/reservation", async () => {
  const x = await setup("cancel-before-register"); assert.equal((await x.cancel()).status, "applied");
  denied(await x.authorityStore.registerCurrentAuthority()); denied(await x.store.reserve(x.invocation, { maximumExposureUsdMicros: 10000 }));
  const current = await facts(x); assert.equal(current.run.status, "cancelled"); assert.deepEqual(current.authority, []); assert.deepEqual(current.exposures, []);
});
test("B3 PG cancellation after reservation prevents start and atomically journals revocation", async () => {
  const x = await prepared("cancel-before-start"); assert.equal((await x.cancel()).status, "applied"); denied(await x.store.commitProviderStart(x.invocation, x.requestFingerprint));
  const current = await facts(x); assert.equal(current.run.status, "cancelled"); assert.equal(current.authority[0].authority_status, "revoked"); assert.equal(current.exposures[0].state, "prepared");
  assert.equal((await db.admin.query(`select count(*)::int n from executor_authority_events where workspace_id=$1 and development_run_id=$2 and operation='revoke'`, [f.workspaceId, x.developmentRunId])).rows[0].n, 1);
  assert.equal((await x.store.cancel(x.invocation)).status, "cancelled");
});
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function waiting() { for (let i = 0; i < 100; i++) { if ((await db.admin.query(`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`)).rows[0].n > 0) return; await live.sleep(10); } assert.fail("contender never waited for PostgreSQL lock"); }
for (const winner of ["cancel", "start"] as const) test(`B3 PG cancel/start race x10: ${winner} wins; no deadlock or duplicate provider right`, async () => {
  const pids = new Set<number>();
  for (let n = 0; n < 10; n++) {
    const x = await prepared(`race-${winner}-${n}`), entered = latch(), release = latch(), trace = live.installQueryInterceptor();
    trace.observe((_sql, c) => { if (c.processID) pids.add(c.processID); });
    trace.rules.push(live.rule("hold factual winner", live.sqlTag(winner === "start" ? "executor:controller-task" : "executor:controller-revoke-lock"), async (_c, cfg, values, send) => { entered.release(); await release.promise; return send(cfg, values); }));
    let startPromise: ReturnType<typeof x.store.commitProviderStart> | undefined, cancelPromise: ReturnType<typeof x.cancel> | undefined;
    try {
      if (winner === "start") startPromise = x.store.commitProviderStart(x.invocation, x.requestFingerprint); else cancelPromise = x.cancel();
      await entered.promise;
      if (winner === "start") cancelPromise = x.cancel(); else startPromise = x.store.commitProviderStart(x.invocation, x.requestFingerprint);
      await waiting(); release.release(); const [s, c] = await Promise.all([startPromise!, cancelPromise!]); assert.equal(c.status, "applied");
      if (winner === "start") assert.ok(s.startCapability); else denied(s);
      const current = await facts(x); assert.equal(current.run.status, "cancelled"); assert.equal(current.authority[0].authority_status, "revoked");
      assert.equal(current.exposures[0].state, winner === "start" ? "start_committed" : "prepared");
      denied(await start.createPostgresExecutorStartStore(x.config).commitProviderStart(x.invocation, x.requestFingerprint));
    } finally { release.release(); await Promise.allSettled([startPromise, cancelPromise].filter(Boolean)); trace.restore(); }
  }
  assert.ok(pids.size >= 2, "independent PostgreSQL sessions participated");
});
async function definitiveReceipt(x: Awaited<ReturnType<typeof prepared>>) {
  const contract = adapter.createExecutorAdapterContract(x.configuration).adapter!; const i = contract.validateInvocation(x.invocation).normalizedInvocation!;
  const content = "export const checked = true;\n", report = "Unverified bounded proposal. Owner review required.", hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const result = contract.evaluateResult(i, { schemaVersion: 1, identity: i.identity, invocationId: i.invocationId, status: "succeeded", failureCode: null,
    changes: [{ path: x.context.files[0].path, operation: "modify", content, sha256: hash(content) }], report: { content: report, sha256: hash(report) } }).normalizedResult; assert.ok(result);
  const capture = outcome.createExecutorOutcomeCapture(x.configuration, { capture: () => ({ terminality: "definitive_terminal", normalizedResult: result, usage: null, providerConsumedCents: 0 }) });
  return capture.capture(x.invocation, x.requestFingerprint);
}
async function settled(label: string) {
  const x = await prepared(label), started = await x.store.commitProviderStart(x.invocation, x.requestFingerprint); assert.ok(started.startCapability);
  assert.equal((await x.store.recordDefinitiveOutcomeAndSettle(x.invocation, x.requestFingerprint, await definitiveReceipt(x))).status, "settled");
  return x;
}
function reader(x: Fixture) { return start.createExecutorHistoricalOutcomeReader({ tenant: f.tenant, projectId: x.projectId,
  configuration: x.configuration, target: x.config.target, financialPolicy: x.config.financialPolicy }); }
test("B3 PG historical definitive settlement survives cancellation without altering cancelled parent", async () => {
  const x = await prepared("historical"), started = await x.store.commitProviderStart(x.invocation, x.requestFingerprint); assert.ok(started.startCapability);
  assert.equal((await x.cancel()).status, "applied");
  const receipt = await definitiveReceipt(x);
  const fresh = start.createPostgresExecutorStartStore(x.config); assert.equal((await fresh.recordDefinitiveOutcomeAndSettle(x.invocation, x.requestFingerprint, receipt)).status, "settled");
  assert.equal((await fresh.inspectOutcome(x.invocation)).normalizedResult?.status, "succeeded"); assert.equal((await facts(x)).run.status, "cancelled");
});
test("B3 PG borrowed historical reader reuses one owned transaction/client and exposes no start methods", async () => {
  const x = await settled("borrowed-reader"), r = reader(x), trace = live.installQueryInterceptor(), pids = new Set<number>(), statements: string[] = [];
  assert.deepEqual(Object.keys(r), ["inspectOutcomeInTransaction"]);
  trace.observe((sql, c) => { statements.push(sql); if (c.processID) pids.add(c.processID); });
  try {
    const read = await transactions.inTransaction(f.database, c => r.inspectOutcomeInTransaction(c, x.invocation));
    assert.equal(read.normalizedResult?.status, "succeeded"); assert.equal(read.startCapability, null);
    assert.equal(pids.size, 1); assert.equal(statements.filter(s => /\bbegin\s*$/iu.test(s)).length, 1);
    assert.equal(statements.filter(s => /\bcommit\s*$/iu.test(s)).length, 1);
    assert.ok(statements.some(s => s.includes("executor:held-integrity")) && statements.some(s => s.includes("executor:audit-integrity")) && statements.some(s => s.includes("executor:outcome-read")));
    assert.ok(!statements.some(s => s.includes("executor:authority-lock") || s.includes("executor:controller-guard") || s.includes("executor:start */")));
  } finally { trace.restore(); }
});
for (const corrupt of ["finance", "provenance", "audit"] as const) test(`B3 PG controller terminal transition reuses accepted ${corrupt} integrity validation`, async () => {
  const x = await settled(`borrowed-${corrupt}`), trace = live.installQueryInterceptor();
  const tag = corrupt === "finance" ? "executor:budget-lock" : corrupt === "provenance" ? "executor:outcome-read" : "executor:audit-integrity";
  const rule = live.rule("corrupt factual read", live.sqlTag(tag), async (_c, config, values, send) => {
    const r = await send(config, values); assert.equal(r.rowCount, 1);
    if (corrupt === "finance") r.rows[0].maximum_exposure_usd_micros = "999";
    if (corrupt === "provenance") r.rows[0].provenance = "ambiguous";
    if (corrupt === "audit") r.rows[0].count = 0;
    return r;
  });
  trace.rules.push(rule);
  try {
    const d = await x.controller.transitionRun({ commandId: commandId(), projectId: x.projectId, taskId: x.projectTaskId,
      expectedVersion: x.state.task.version, expectedControllerRevision: x.state.revision,
      developmentRunId: x.developmentRunId, expectedRunRevision: 1, event: { type: "submit_patch", changedPaths: [x.context.files[0].path] } });
    assert.equal(rule.fired, 1, "controller must call the accepted full outcome read, not a partial SQL copy");
    assert.equal(d.status, "unavailable"); assert.equal(d.state, null);
  } finally { trace.restore(); }
  const after = await x.controller.read(x.projectId, x.projectTaskId); assert.ok(after);
  assert.equal(after.runs[0].run.status, "implementing"); assert.equal(after.runs[0].revision, 1);
  assert.equal((await x.store.inspectOutcome(x.invocation)).normalizedResult?.status, "succeeded", "test corruption did not alter actual stored data");
});
