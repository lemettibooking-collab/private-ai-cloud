import assert from "node:assert/strict";
import { test } from "node:test";
import type { DevelopmentControllerState, ControllerDevelopmentRun, ControllerOperation, ControllerAttemptIntent } from "../lib/db/development-controller-store";
import type { DevelopmentExecutionRun } from "../lib/contracts/development-execution";
const policy = await import(process.env.B3_CONTROLLER_POLICY_MODULE ?? new URL("../lib/roadmap/development-controller-policy.ts", import.meta.url).href) as typeof import("../lib/roadmap/development-controller-policy");
const planContract = await import(new URL("../lib/contracts/development-plan.ts", import.meta.url).href) as typeof import("../lib/contracts/development-plan");
const execution = await import(new URL("../lib/contracts/development-execution.ts", import.meta.url).href) as typeof import("../lib/contracts/development-execution");
const admission = await import(new URL("../lib/contracts/development-task-policy.ts", import.meta.url).href) as typeof import("../lib/contracts/development-task-policy");
const roadmap = await import(new URL("../lib/roadmap/roadmap-contract.ts", import.meta.url).href) as typeof import("../lib/roadmap/roadmap-contract");
type MutableState = { -readonly [K in keyof DevelopmentControllerState]: DevelopmentControllerState[K] };
function state(overlap = false): MutableState {
  const task = (id: string, sequence: number, dependencyIds: string[], path = `src/${id}`) => ({ id, sequence, title: id, goal: "Implement approved scope", scope: ["Source change"], nonGoals: ["No deploy"], allowedPaths: [path], acceptanceCriteria: ["Checks pass"], verificationCommands: ["npm test"], dependencyIds, riskLevel: "low", priority: "P1", requiresOwnerApproval: false });
  const validated = planContract.validateAndNormalizeFeaturePlan({ id: "plan-a", title: "Approved plan", goal: "Bounded change", status: "approved", tasks: [task("a", 1, []), task("b", 2, [], overlap ? "src/a" : "src/b"), task("c", 3, ["a", "b"])] }); assert.ok(validated.ok);
  const metadata = roadmap.normalizeRoadmapMetadata({ scope: ["Source"], nonGoals: [], acceptanceCriteria: ["Checks"], artifacts: ["Patch"], requiredQuality: true, requiredSecurity: true, approvalPolicy: "owner", changeEvidence: "Owner approved roadmap" }); assert.ok(metadata);
  return { task: { projectId: "project-a", taskId: "owner-task-a", taskType: "feature", status: "running", version: 5, milestoneId: "milestone-a", metadata, metadataFingerprint: roadmap.roadmapFingerprint(metadata), dependencyIds: [], priority: "P1", risk: "low" }, revision: 4,
    approvedPlan: { plan: validated.value, planId: "plan-a", revision: 1, draftFingerprint: "a".repeat(64), executionFingerprint: "b".repeat(64), approvalRequestId: "approval-a", approvalTaskVersion: 3 }, runs: [], attempts: [], operations: [] };
}
function run(s: DevelopmentControllerState, taskId: string, status: DevelopmentExecutionRun["status"]): ControllerDevelopmentRun {
  const input = policy.controllerAdmission(s, taskId, ["src"]); assert.ok(input);
  const created = execution.createDevelopmentExecutionRun({ id: `run-${taskId}`, planId: "plan-a", taskId, admissionDecision: admission.evaluateDevelopmentTaskAdmission(input), requiredVerificationCommands: ["npm test"], protectedPaths: [] }); assert.ok(created.ok);
  let current = created.value, revision = 0;
  const step = (event: unknown) => { const next = execution.transitionDevelopmentExecutionRun(current, event); assert.ok(next.ok); current = next.value; revision++; };
  if (status !== "ready") step({ type: "start_attempt" });
  if (["verifying", "reviewing", "completed"].includes(status)) { const path = s.approvedPlan!.plan.tasks.find(t => t.id === taskId)!.allowedPaths[0]; step({ type: "submit_patch", changedPaths: [`${path}/change.ts`] }); }
  if (["reviewing", "completed"].includes(status)) step({ type: "verification_passed", checks: [{ command: "npm test", exitCode: 0 }] });
  if (status === "completed") step({ type: "review_passed" });
  if (["awaiting_correction", "awaiting_owner_decision", "blocked"].includes(status)) step({ type: "implementation_failed", failure: { phase: "implementation", code: "implementation_failed", fingerprint: "implementation-failure", summary: "Implementation requires correction.", retryable: status !== "blocked", scopeExpansionRequired: status === "awaiting_owner_decision", protectedPathViolation: false, systemForbiddenPathViolation: false } });
  if (status === "cancelled") step({ type: "cancel" });
  assert.equal(current.status, status); return { run: current, revision, fingerprint: roadmap.roadmapFingerprint(current) };
}
function intent(r: ControllerDevelopmentRun): ControllerAttemptIntent { return { developmentRunId: r.run.id, attemptNumber: r.run.currentAttemptNumber, projectTaskStateVersion: 5, runRevision: r.revision, configuration: {}, configurationFingerprint: "1".repeat(64), invocation: {}, invocationFingerprint: "2".repeat(64), context: {}, contextFingerprint: "3".repeat(64), route: { dispatchAuthorized: false, runtimeDispatchAllowed: false }, routeFingerprint: "4".repeat(64), executionPolicy: {}, executionPolicyFingerprint: "5".repeat(64), intentFingerprint: "6".repeat(64) }; }
function operation(r: ControllerDevelopmentRun, kind: ControllerOperation["kind"], status: ControllerOperation["status"]): ControllerOperation { return { operationId: `${kind}-operation`, developmentRunId: r.run.id, runRevision: r.revision, attemptNumber: r.run.currentAttemptNumber, kind, status, intentFingerprint: "a".repeat(64), evidence: null, evidenceFingerprint: null, outcomeFingerprint: null }; }
function onlyA(): MutableState { const s = state(); return { ...s, approvedPlan: { ...s.approvedPlan!, plan: { ...s.approvedPlan!.plan, tasks: [s.approvedPlan!.plan.tasks[0]] } } }; }

for (const status of ["draft", "completed", "failed", "cancelled"] as const) test(`task ${status} never chooses execution`, () => { const s = state(); s.task = { ...s.task, status }; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, "none"); });
for (const [status, action] of [["ready", "claim_ready_task"], ["blocked", "hard_stop"], ["recovery_required", "recovery_required"], ["approved", "start_plan_execution"]] as const) test(`task ${status} selects one ${action}`, () => { const s = state(); s.task = { ...s.task, status }; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, action); });
test("missing plan never invented or auto-approved", () => { const s = state(); s.task = { ...s.task, status: "planning" }; s.approvedPlan = null; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, "require_plan_approval"); assert.equal(policy.controllerAdmission(s, "a", ["src"]), null); });
test("initial missing wave node selected deterministically with no side effect", () => { const s = state(); const before = structuredClone(s); assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "create_development_run", developmentRunId: null, developmentTaskId: "a" }); assert.deepEqual(s, before); });
test("persisted ready node activates before another overlapping node can stall on admission", () => { const s = state(true); s.runs = [run(s, "a", "ready")]; assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "start_development_attempt", developmentRunId: "run-a", developmentTaskId: "a" }); });
test("independent disjoint node admitted while another wave node is active", () => { const s = state(); s.runs = [run(s, "a", "implementing")]; assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "create_development_run", developmentRunId: null, developmentTaskId: "b" }); });
test("independent overlapping paths serialize through existing Admission", () => { const s = state(true); s.runs = [run(s, "a", "implementing")]; assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "select_route", developmentRunId: "run-a", developmentTaskId: "a" }); assert.equal(admission.evaluateDevelopmentTaskAdmission(policy.controllerAdmission(s, "b", ["src"])!).verdict, "deny"); });
test("dependent task cannot start until entire preceding wave completed", () => { const s = state(); const a = run(s, "a", "completed"), b = run(s, "b", "implementing"); s.runs = [a, b]; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).developmentTaskId, "b"); assert.notEqual(policy.planDevelopmentControllerStep(s, ["src"]).developmentTaskId, "c"); });
test("completed independent node never reruns after controller restart", () => { const s = state(); s.runs = [run(s, "a", "completed")]; const restarted = structuredClone(s); assert.equal(policy.planDevelopmentControllerStep(restarted, ["src"]).developmentTaskId, "b"); assert.equal(policy.planDevelopmentControllerStep(restarted, ["src"]).action, "create_development_run"); });
test("completed wave unlocks only factual admitted dependent node", () => { const s = state(); s.runs = [run(s, "a", "completed"), run(s, "b", "completed")]; assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "create_development_run", developmentRunId: null, developmentTaskId: "c" }); });
test("all completed nodes require final Owner acceptance, not automatic completion", () => { const s = state(); const a = run(s, "a", "completed"), b = run(s, "b", "completed"); s.runs = [a, b]; s.runs = [a, b, run(s, "c", "completed")]; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, "require_result_acceptance"); });
for (const [status, action] of [["ready", "start_development_attempt"], ["implementing", "select_route"], ["awaiting_correction", "start_corrective_attempt"], ["awaiting_owner_decision", "require_owner_decision"], ["blocked", "hard_stop"]] as const) test(`run ${status} selects ${action}`, () => { const s = onlyA(); s.runs = [run(s, "a", status)]; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, action); });
test("route result is only selection intent, never returned dispatch authority", () => { const s = onlyA(), a = run(s, "a", "implementing"); s.runs = [a]; s.attempts = [intent(a)]; const selected = policy.planDevelopmentControllerStep(s, ["src"]); assert.equal(selected.action, "start_executor"); assert.deepEqual(Object.keys(selected).sort(), ["action", "developmentRunId", "developmentTaskId"].sort()); assert.equal("startCapability" in selected, false); assert.equal("dispatchAuthorized" in selected, false); });
test("persisted executor operation awaits factual outcome, never redispatches", () => { const s = onlyA(), a = run(s, "a", "implementing"); s.runs = [a]; s.attempts = [intent(a)]; for (const status of ["pending", "recorded"] as const) { s.operations = [operation(a, "executor", status)]; assert.equal(policy.planDevelopmentControllerStep(structuredClone(s), ["src"]).action, "await_executor_outcome"); } });
for (const [status, kind] of [["verifying", "quality"], ["reviewing", "security"]] as const) test(`${status} gate must run before it can be reported`, () => { const s = onlyA(), a = run(s, "a", status); s.runs = [a]; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, `run_${kind}_gate`); s.operations = [operation(a, kind, "recorded")]; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, `report_${kind}_gate`); });
test("stale operation/route from an earlier attempt cannot advance current corrective attempt", () => { const s = onlyA(); const a = run(s, "a", "awaiting_correction"); const started = execution.transitionDevelopmentExecutionRun(a.run, { type: "start_attempt" }); assert.ok(started.ok); s.runs = [{ ...a, run: started.value }]; s.attempts = [intent(a)]; s.operations = [operation(a, "executor", "recorded")]; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, "select_route"); });
test("task class is trusted persisted type and correction always repair", () => { const s = state(); for (const [taskType, expected] of [["feature", "implementation"], ["fix", "repair"], ["investigation", "analysis"], ["roadmap", "analysis"]] as const) { s.task = { ...s.task, taskType }; assert.equal(policy.controllerTaskClass(s, 1), expected); assert.equal(policy.controllerTaskClass(s, 2), "repair"); } });
test("stable run/invocation IDs bind exact project/task/approved fingerprint, deterministic and no clocks", () => { const s = state(), before = structuredClone(s); const first = policy.controllerDevelopmentRunId(s, "a"); assert.equal(first, policy.controllerDevelopmentRunId(structuredClone(s), "a")); assert.notEqual(first, policy.controllerDevelopmentRunId(s, "b")); const changed = { ...s, approvedPlan: { ...s.approvedPlan!, executionFingerprint: "c".repeat(64) } }; assert.notEqual(first, policy.controllerDevelopmentRunId(changed, "a")); assert.equal(policy.controllerInvocationId(first, 1), policy.controllerInvocationId(first, 1)); assert.notEqual(policy.controllerInvocationId(first, 1), policy.controllerInvocationId(first, 2)); assert.deepEqual(s, before); });
test("current attempt intent resolved exactly, no fallback to different run/attempt", () => { const s = onlyA(), a = run(s, "a", "implementing"); s.runs = [a]; const correct = intent(a); s.attempts = [{ ...correct, attemptNumber: 2 }, { ...correct, developmentRunId: "different" }, correct]; assert.equal(policy.controllerIntent(s, a.run.id), correct); assert.equal(policy.controllerIntent(s, "missing"), null); });
test("admission excludes terminal/ready nodes from active scopes and records only factual completions", () => { const s = state(); s.runs = [run(s, "a", "completed"), run(s, "b", "ready")]; const value = policy.controllerAdmission(s, "c", ["src"]); assert.ok(value); assert.deepEqual(value.completedTaskIds, ["a"]); assert.deepEqual(value.activeTaskIds, []); assert.equal(admission.evaluateDevelopmentTaskAdmission(value).verdict, "deny", "Ready predecessor is not completed"); });
test("unknown task state cannot select execution", () => { const s = state(); s.task = { ...s.task, status: "unknown" as never }; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, "hard_stop"); });

test("wave frontier routes every disjoint sibling before awaiting the first started executor", () => {
  const s = state(), a = run(s, "a", "implementing"), b = run(s, "b", "implementing");
  s.runs = [a, b]; s.attempts = [intent(a)]; s.operations = [operation(a, "executor", "pending")];
  const before = structuredClone(s);
  assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "select_route", developmentRunId: b.run.id, developmentTaskId: "b" });
  assert.deepEqual(s, before);
  s.attempts = [intent(a), intent(b)];
  assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "start_executor", developmentRunId: b.run.id, developmentTaskId: "b" });
  s.operations = [operation(a, "executor", "pending"), operation(b, "executor", "pending")];
  assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "await_executor_outcome", developmentRunId: a.run.id, developmentTaskId: "a" });
});
test("wave frontier phase order is stable across caller run/intent order and repeated restart", () => {
  const s = state(), a = run(s, "a", "implementing"), b = run(s, "b", "implementing");
  s.runs = [b, a]; s.attempts = [intent(a)];
  const first = policy.planDevelopmentControllerStep(s, ["src"]);
  assert.equal(first.action, "select_route"); assert.equal(first.developmentTaskId, "b", "route phase precedes a's start phase");
  s.attempts = [intent(b), intent(a)];
  const selected = policy.planDevelopmentControllerStep(s, ["src"]);
  assert.equal(selected.action, "start_executor"); assert.equal(selected.developmentTaskId, "a");
  assert.deepEqual(selected, policy.planDevelopmentControllerStep({ ...structuredClone(s), runs: [a, b] }, ["src"]));
});
test("wave frontier activates a sibling ready attempt before waiting on an in-flight executor", () => {
  const s = state(), a = run(s, "a", "implementing"), b = run(s, "b", "ready");
  s.runs = [a, b]; s.attempts = [intent(a)]; s.operations = [operation(a, "executor", "pending")];
  assert.deepEqual(policy.planDevelopmentControllerStep(s, ["src"]), { action: "start_development_attempt", developmentRunId: b.run.id, developmentTaskId: "b" });
});
test("overlapping admission still waits for the only started executor, never creates its conflicting sibling", () => {
  const s = state(true), a = run(s, "a", "implementing");
  s.runs = [a]; s.attempts = [intent(a)]; s.operations = [operation(a, "executor", "pending")];
  assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, "await_executor_outcome");
  assert.equal(admission.evaluateDevelopmentTaskAdmission(policy.controllerAdmission(s, "b", ["src"])!).verdict, "deny");
});
test("factual blocking state remains stronger than disjoint wave-frontier progress", () => {
  for (const [status, action] of [["blocked", "hard_stop"], ["awaiting_owner_decision", "require_owner_decision"]] as const) {
    const s = state(), a = run(s, "a", "implementing"), b = run(s, "b", status);
    s.runs = [a, b]; assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, action);
  }
  for (const [status, action] of [["blocked", "hard_stop"], ["recovery_required", "recovery_required"]] as const) {
    const s = state(); s.task = { ...s.task, status }; s.runs = [run(s, "a", "implementing"), run(s, "b", "implementing")];
    assert.equal(policy.planDevelopmentControllerStep(s, ["src"]).action, action);
  }
});
