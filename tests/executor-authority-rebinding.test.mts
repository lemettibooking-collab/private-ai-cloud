import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest } from "./fixtures/durable-executor.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { claudeFixture } from "./fixtures/claude-managed.mts";
const facts = await import(new URL("../lib/executors/executor-current-authority.ts", import.meta.url).href) as typeof import("../lib/executors/executor-current-authority");
const contract = await import(new URL("../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../lib/contracts/executor-adapter");
test("R stable scope independently pins repository/paths/full policy preimage; old full hash unchanged", () => {
  const c = executorConfiguration(1, "lineage-proof"), a = facts.deriveExecutorAuthorityFacts(c), b = facts.deriveExecutorAuthorityFacts(claudeFixture("lineage-proof", 2).configuration);
  assert.equal(a.admissionFingerprint, "2d3e9c43d17079f63545de223828e40d1f4d71a3a35284b24ad32341ebb14b26");
  assert.equal(b.admissionFingerprint, "d217a4729c2b3ef801307806ba30103ceac385073ba9e196e72abac9847ebab6");
  assert.equal(a.admissionScopeFingerprint, b.admissionScopeFingerprint);
  // Independent canonical preimage includes normalized plan, approval facts and exact repository.
  const preimage = { policy: "development_task_admission_scope_v1", plan: { ...c.admission.plan, tasks: c.admission.plan.tasks.map(t => ({ ...t, allowedPaths: ["src"] })) },
    taskId: "task-a", admittedPaths: ["src"], ownerApprovalRequired: true, ownerApprovalSatisfied: true, taskOwnerApprovalGranted: true,
    completedTaskIds: [], activeTaskIds: [], repositoryAllowlist: ["src"], repository: c.repository };
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)])) : v;
  assert.equal(a.admissionScopeFingerprint, createHash("sha256").update(JSON.stringify(canonical(preimage))).digest("hex"));
});
test("R only executor declaration excluded; changed stable repository, plan, sets and allowlist never share scope", () => {
  const c = executorConfiguration(), before = structuredClone(c), a = facts.deriveExecutorAuthorityFacts(c);
  for (const change of [(x: typeof c) => { x.repository.baseline = "b".repeat(40); }, (x: typeof c) => { x.repository.id = "other-repo"; },
    (x: typeof c) => { x.admission.plan.goal = "Different task scope"; }, (x: typeof c) => { x.admission.completedTaskIds = ["other"] as never[]; },
    (x: typeof c) => { x.admission.activeTaskIds = ["other"] as never[]; }, (x: typeof c) => { x.admission.repositoryAllowlist = ["src", "docs"]; }]) {
    const x = structuredClone(c); change(x); let derived: ReturnType<typeof facts.deriveExecutorAuthorityFacts> | null = null;
    try { derived = facts.deriveExecutorAuthorityFacts(x); } catch (error) { assert.equal((error as Error).message, "invalid_executor_authority_configuration"); }
    if (derived) assert.notEqual(derived.admissionScopeFingerprint, a.admissionScopeFingerprint);
  }
  const x = structuredClone(c); x.capabilities.tasks = ["coding"]; assert.equal(facts.deriveExecutorAuthorityFacts(x).admissionScopeFingerprint, a.admissionScopeFingerprint);
  assert.notEqual(facts.deriveExecutorAuthorityFacts(x).admissionFingerprint, a.admissionFingerprint); assert.deepEqual(c, before);
});
test("R stable digest is not eligibility: insufficient executor still fails existing invocation contract", () => {
  const c = executorConfiguration(); c.capabilities.tasks = ["repository_analysis"]; c.capabilities.modes = ["analysis_only"]; c.capabilities.artifacts = ["report"];
  const a = contract.createExecutorAdapterContract(c).adapter; assert.ok(a); assert.equal(a.validateInvocation(executorRequest()).verdict, "deny");
});
