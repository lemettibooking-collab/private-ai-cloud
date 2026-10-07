import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

const contract = await import(new URL("../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../lib/contracts/executor-adapter");
const handoff = await import(new URL("../lib/local-handoff/local-handoff-policy.ts", import.meta.url).href) as typeof import("../lib/local-handoff/local-handoff-policy");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function config() {
  return {
    identity: { id: "test-executor", version: "1.0" },
    capabilities: { tasks: ["coding", "repository_analysis"], modes: ["patch_proposal", "analysis_only"], artifacts: ["patch", "report"] },
    repository: { id: "repo-a", baseline: "a".repeat(40) },
    admission: {
      taskId: "task-a", completedTaskIds: [] as string[], activeTaskIds: [] as string[], repositoryAllowlist: ["src"], taskOwnerApprovalGranted: true,
      plan: { id: "plan-a", title: "Plan A", goal: "Deliver a bounded change", status: "approved", tasks: [{
        id: "task-a", sequence: 1, title: "Task A", goal: "Deliver a bounded change", scope: ["Local source"], nonGoals: ["No external actions"],
        allowedPaths: ["src"], acceptanceCriteria: ["Review proposed changes"], verificationCommands: ["npm test"], dependencyIds: [] as string[],
        riskLevel: "low", priority: "P3", requiresOwnerApproval: true,
      }] },
    },
  };
}
function request() {
  return { schemaVersion: 1, invocationId: "invocation-a", identity: config().identity, planId: "plan-a", taskId: "task-a",
    repository: config().repository, capability: "coding", mode: "patch_proposal" };
}
function adapter(input: unknown = config()) {
  const decision = contract.createExecutorAdapterContract(input);
  assert.equal(decision.verdict, "allow");
  assert.ok(decision.adapter);
  return decision.adapter;
}
function invocation(a = adapter()) {
  const decision = a.validateInvocation(request());
  assert.equal(decision.verdict, "allow"); assert.ok(decision.normalizedInvocation);
  assert.equal(decision.invocationAuthorized, false);
  return decision.normalizedInvocation;
}
function success() {
  const content = "export const answer = 42;\n", report = "Proposed one bounded source change. Not independently verified.";
  return { schemaVersion: 1, identity: config().identity, invocationId: "invocation-a", status: "succeeded", failureCode: null,
    changes: [{ path: "src/answer.ts", operation: "add", content, sha256: hash(content) }], report: { content: report, sha256: hash(report) } };
}
function denied(decision: { verdict: string; adapter?: unknown; normalizedInvocation?: unknown; normalizedResult?: unknown; invocationAuthorized?: boolean }) {
  assert.equal(decision.verdict, "deny");
  if ("normalizedInvocation" in decision) assert.equal(decision.normalizedInvocation, null);
  if ("normalizedResult" in decision) assert.equal(decision.normalizedResult, null);
  if ("invocationAuthorized" in decision) assert.equal(decision.invocationAuthorized, false);
  if ("adapter" in decision) assert.equal(decision.adapter, null);
  frozen(decision);
}
function frozen(value: unknown) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) frozen(child);
}

test("configured identity/capabilities and task admission normalize without dispatch authority", () => {
  const a = adapter(), normalized = invocation(a);
  assert.deepEqual(a.identity, config().identity); assert.deepEqual(normalized.allowedPaths, ["src"]);
  assert.equal(normalized.task.goal, config().admission.plan.tasks[0].goal);
  assert.ok(!("verificationCommands" in normalized.task));
  assert.ok(!("execute" in a)); assert.ok(!("invoke" in a)); frozen(a); frozen(normalized);
});
for (const identity of [null, "test-executor", {}, { id: "", version: "1" }, { id: "unknown", version: "1.0" }, { ...config().identity, provider: "vendor" }]) {
  test(`unknown/malformed request identity denied: ${JSON.stringify(identity)}`, () => denied(adapter().validateInvocation({ ...request(), identity })));
}
for (const field of ["apiKey", "authorization", "provider", "model", "sdk", "commands", "trustedOptions", "ownerApprovalGranted", "gitAuthority", "selectedExecutor"]) {
  test(`unexpected invocation field ${field} cannot grant authority`, () => denied(adapter().validateInvocation({ ...request(), [field]: "caller-controlled" })));
}
test("malformed identity/capabilities in composition configuration deny without partial adapter", () => {
  for (const input of [null, {}, { ...config(), identity: { id: "bad id", version: "1" } },
    { ...config(), capabilities: { ...config().capabilities, tasks: ["arbitrary_shell"] } },
    { ...config(), providerSdk: {} }]) {
    const d = contract.createExecutorAdapterContract(input); denied(d); assert.equal(d.adapter, null);
  }
});
test("capabilities are bounded and canonical without changing caller arrays", () => {
  const c = config(), before = structuredClone(c);
  const a = adapter(c); assert.deepEqual(c, before);
  const reverse = config(); reverse.capabilities.tasks.reverse(); reverse.capabilities.modes.reverse(); reverse.capabilities.artifacts.reverse();
  const b = adapter(reverse); assert.deepEqual(a.capabilities, b.capabilities);
  c.capabilities.tasks = ["coding"];
  assert.deepEqual(a.capabilities.tasks, ["coding", "repository_analysis"]);
  denied(contract.createExecutorAdapterContract({ ...config(), capabilities: { ...config().capabilities, tasks: Array(65).fill("coding") } }));
});
test("unsupported capability, mode and output support each deny", () => {
  const c = config(); c.capabilities.tasks = ["repository_analysis"];
  denied(adapter(c).validateInvocation(request()));
  c.capabilities.tasks = ["coding"]; c.capabilities.modes = ["analysis_only"];
  denied(adapter(c).validateInvocation(request()));
  c.capabilities.modes = ["patch_proposal"]; c.capabilities.artifacts = ["report"];
  denied(adapter(c).validateInvocation(request()));
  denied(adapter().validateInvocation({ ...request(), capability: "repository_analysis" }));
});
for (const replacement of [{ planId: "other-plan" }, { taskId: "other-task" }, { repository: { id: "repo-b", baseline: "a".repeat(40) } },
  { repository: { id: "repo-a", baseline: "b".repeat(40) } }, { schemaVersion: 2 }, { invocationId: "x".repeat(65) }]) {
  test(`invocation binding rejects ${JSON.stringify(replacement)}`, () => denied(adapter().validateInvocation({ ...request(), ...replacement })));
}
test("reuse factual admission: draft, approval, dependency, active and forbidden paths deny", () => {
  const draft = config(); draft.admission.plan.status = "draft";
  const approval = config(); approval.admission.taskOwnerApprovalGranted = false;
  const active = config(); active.admission.activeTaskIds = ["task-a"];
  const forbidden = config(); forbidden.admission.plan.tasks[0].allowedPaths = ["src/.env"];
  const outside = config(); outside.admission.plan.tasks[0].allowedPaths = ["other"];
  const dependency = config(); dependency.admission.plan.tasks[0].dependencyIds = ["missing"];
  for (const c of [draft, approval, active, forbidden, outside, dependency]) denied(contract.createExecutorAdapterContract(c));
});
test("human-operated handoff stays inert and is not an executor request/configuration", () => {
  const c = config();
  const spec = { ...c.admission, schemaVersion: 1, pathSelectionMode: "manual", selectedExecutor: { mode: "human_operated", label: "test-executor" },
    context: "Local handoff", expectedHandoff: "Patch and report" };
  const normalized = handoff.normalizeHandoffSpec(spec); assert.equal(normalized.ok, true);
  const before = structuredClone(spec);
  denied(contract.createExecutorAdapterContract(spec)); denied(adapter().validateInvocation(spec));
  denied(adapter().validateInvocation(spec.selectedExecutor));
  if (normalized.ok) denied(adapter().validateInvocation(normalized.value));
  assert.deepEqual(spec, before); assert.equal(handoff.normalizeHandoffSpec(spec).ok, true);
});
test("deterministic in-process fake produces validated proposal evidence, not Quality Gate approval", () => {
  const a = adapter(), i = invocation(a);
  const fake = () => a.evaluateResult(i, success());
  const first = fake(), second = fake();
  assert.equal(first.verdict, "allow"); assert.ok(first.normalizedResult);
  assert.equal(first.normalizedResult.status, "succeeded"); assert.equal(first.normalizedResult.ownerDecisionRequired, true);
  assert.equal(first.normalizedResult.verificationStatus, "not_run");
  assert.deepEqual(first, second); assert.notEqual(first.normalizedResult, second.normalizedResult); frozen(first); frozen(second);
});
test("analysis-only report works without patch and rejects file changes", () => {
  const a = adapter(), d = a.validateInvocation({ ...request(), capability: "repository_analysis", mode: "analysis_only" });
  assert.ok(d.normalizedInvocation);
  assert.equal(a.evaluateResult(d.normalizedInvocation, { ...success(), changes: [] }).verdict, "allow");
  denied(a.evaluateResult(d.normalizedInvocation, success()));
});
test("add/modify/delete evidence is scoped, hashed and canonically ordered", () => {
  const a = adapter(), i = invocation(a), r = success();
  r.changes.push({ path: "src/z.ts", operation: "delete", content: null as unknown as string, sha256: null as unknown as string });
  r.changes[0].operation = "modify";
  const before = structuredClone(r), first = a.evaluateResult(i, r);
  assert.equal(first.verdict, "allow"); r.changes.reverse();
  assert.deepEqual(first, a.evaluateResult(i, r)); r.changes.reverse(); assert.deepEqual(r, before);
});
for (const field of ["provider", "usage", "rawError", "authorization", "qualityGate", "approved", "gitActions"]) {
  test(`unexpected result field ${field} denied`, () => { const a = adapter(); denied(a.evaluateResult(invocation(a), { ...success(), [field]: true })); });
}
for (const replacement of [{ status: "success" }, { status: "succeeded", failureCode: "timeout" }, { changes: [] }, { report: null },
  { report: { content: " ", sha256: hash(" ") } }, { identity: { id: "other", version: "1.0" } }, { invocationId: "other" }]) {
  test(`claimed success requires factual validation: ${JSON.stringify(replacement)}`, () => { const a = adapter(); denied(a.evaluateResult(invocation(a), { ...success(), ...replacement })); });
}
test("malformed patch evidence cannot become successful execution", () => {
  const a = adapter(), i = invocation(a);
  for (const change of [{ ...success().changes[0], sha256: "b".repeat(64) }, { ...success().changes[0], path: "../escape" },
    { ...success().changes[0], path: "other/a.ts" }, { ...success().changes[0], path: "src/.env" },
    { ...success().changes[0], operation: "shell" }, { ...success().changes[0], command: "git push" },
    { ...success().changes[0], operation: "delete" }, { ...success().changes[0], content: "x".repeat(131073) }]) {
    denied(a.evaluateResult(i, { ...success(), changes: [change] }));
  }
  denied(a.evaluateResult(i, { ...success(), changes: [success().changes[0], success().changes[0]] }));
  denied(a.evaluateResult(i, { ...success(), report: { content: "Meaningful", sha256: "0".repeat(64) } }));
});
for (const [status, failureCode] of [["rejected", "unsupported"], ["rejected", "policy_rejected"], ["failed", "timeout"],
  ["failed", "provider_failure"], ["failed", "execution_failure"], ["outcome_unknown", "ambiguous_outcome"]]) {
  test(`${status}/${failureCode} stays non-successful with no evidence or retry permission`, () => {
    const a = adapter(), i = invocation(a), result = { ...success(), status, failureCode, changes: [], report: null };
    const d = a.evaluateResult(i, result); assert.equal(d.verdict, "allow"); assert.equal(d.normalizedResult?.status, status);
    assert.equal(d.normalizedResult?.automaticRetryAllowed, false); frozen(d);
    denied(a.evaluateResult(i, { ...result, changes: success().changes }));
    denied(a.evaluateResult(i, { ...result, failureCode: "unknown" }));
    denied(a.evaluateResult(i, { ...result, report: success().report }));
  });
}
test("receipt must originate from the same contract: shape/JSON clones and different adapters are not authority", () => {
  const a = adapter(), i = invocation(a);
  denied(a.evaluateResult(structuredClone(i), success()));
  denied(a.evaluateResult(JSON.parse(JSON.stringify(i)), success()));
  denied(adapter().evaluateResult(i, success()));
  denied(a.evaluateResult({ ...i, invocationAuthorized: true }, success()));
});
test("recognized credential content is denied without echoing it in any output", () => {
  const a = adapter(), i = invocation(a);
  for (const secret of ["sk-" + "x".repeat(48), "-----BEGIN PRIVATE KEY-----", "Authorization: Bearer abcdefghijklmnopqrstuv"]) {
    const c = config(); c.admission.plan.goal = secret;
    const cd = contract.createExecutorAdapterContract(c); denied(cd); assert.ok(!JSON.stringify(cd).includes(secret));
    const r = success(); r.report = { content: secret, sha256: hash(secret) };
    const rd = a.evaluateResult(i, r); denied(rd); assert.ok(!JSON.stringify(rd).includes(secret));
    r.report = success().report; r.changes[0].content = secret; r.changes[0].sha256 = hash(secret);
    denied(a.evaluateResult(i, r));
  }
});
test("known secret environment values never enter normalized evidence", () => {
  const previous = process.env.PAC_EXECUTOR_TEST_SECRET;
  try {
    process.env.PAC_EXECUTOR_TEST_SECRET = "private-test-value";
    const a = adapter(), r = success(); r.report = { content: "private-test-value", sha256: hash("private-test-value") };
    denied(a.evaluateResult(invocation(a), r));
  } finally { if (previous === undefined) delete process.env.PAC_EXECUTOR_TEST_SECRET; else process.env.PAC_EXECUTOR_TEST_SECRET = previous; }
});
test("credential-shaped identifiers/paths and nested provider fields also fail closed", () => {
  const a = adapter(), i = invocation(a), secret = "sk-" + "x".repeat(48);
  const d = a.validateInvocation({ ...request(), invocationId: secret }); denied(d);
  assert.ok(!JSON.stringify(d).includes(secret));
  const r = success(); r.changes[0].path = `src/${secret}`; denied(a.evaluateResult(i, r));
  denied(a.evaluateResult(i, { ...success(), report: { ...success().report, headers: { authorization: secret } } }));
  denied(a.validateInvocation({ ...request(), repository: { ...request().repository, path: "/tmp/work" } }));
  const c = config();
  denied(contract.createExecutorAdapterContract({ ...c, admission: { ...c.admission, workspaceId: "caller" } }));
  denied(contract.createExecutorAdapterContract({ ...c, admission: { ...c.admission, plan: { ...c.admission.plan, approved: true } } }));
});
test("fixed content/report and aggregate UTF-8 limits fail closed without partial evidence", () => {
  const a = adapter(), i = invocation(a), r = success();
  r.report.content = "x".repeat(contract.executorAdapterLimits.maxReportBytes + 1); r.report.sha256 = hash(r.report.content);
  denied(a.evaluateResult(i, r));
  r.report = success().report; r.changes[0].content = "é".repeat(contract.executorAdapterLimits.maxContentBytes); r.changes[0].sha256 = hash(r.changes[0].content);
  denied(a.evaluateResult(i, r));
  r.changes = Array.from({ length: 64 }, (_, n) => ({ ...success().changes[0], path: `src/${n}.ts`, content: "x".repeat(5000), sha256: hash("x".repeat(5000)) }));
  denied(a.evaluateResult(i, r));
});
test("hostile/accessor/proxy/cyclic/deep/wide boundaries never execute traps or throw raw errors", () => {
  let accessed = 0;
  const getter = Object.defineProperty(request(), "identity", { enumerable: true, get() { accessed++; throw Error("PRIVATE"); } });
  const proxy = new Proxy({}, { ownKeys() { accessed++; throw Error("PRIVATE"); } });
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  let deep: unknown = {}; for (let n = 0; n < 1000; n++) deep = { child: deep };
  const wide = Object.fromEntries(Array.from({ length: 65 }, (_, n) => [String(n), n]));
  const a = adapter(), i = invocation(a);
  for (const input of [getter, proxy, cyclic, deep, wide, Array(65).fill(null), { ...request(), identity: proxy }]) {
    assert.doesNotThrow(() => denied(a.validateInvocation(input)));
    assert.doesNotThrow(() => denied(a.evaluateResult(i, input)));
    assert.doesNotThrow(() => denied(contract.createExecutorAdapterContract(input)));
  }
  assert.equal(accessed, 0);
});
test("repeated decisions are deterministic, input untouched, outputs fresh/deeply frozen", () => {
  const c = config(), before = structuredClone(c), a = adapter(c), r = request(), rb = structuredClone(r);
  const d1 = a.validateInvocation(r), d2 = a.validateInvocation(r);
  assert.deepEqual(d1, d2); assert.notEqual(d1.normalizedInvocation, d2.normalizedInvocation); frozen(d1); frozen(d2);
  assert.deepEqual(c, before); assert.deepEqual(r, rb);
  r.identity.id = "other"; c.admission.plan.tasks[0].goal = "Changed";
  assert.equal(d1.normalizedInvocation?.identity.id, "test-executor"); assert.equal(d1.normalizedInvocation?.task.goal, before.admission.plan.tasks[0].goal);
  assert.throws(() => { (d1.normalizedInvocation!.allowedPaths as string[]).push("other"); });
  const result = success(), saved = structuredClone(result);
  const first = a.evaluateResult(d1.normalizedInvocation, result), second = a.evaluateResult(d1.normalizedInvocation, result);
  assert.deepEqual(first, second); assert.deepEqual(result, saved); frozen(first);
  result.changes[0].content = "modified";
  assert.equal(first.normalizedResult?.changes[0].content, saved.changes[0].content);
  assert.deepEqual(a.validateInvocation(r), a.validateInvocation(r));
});
