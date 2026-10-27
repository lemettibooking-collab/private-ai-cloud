import assert from "node:assert/strict";
import type { LiveDatabase } from "../pg/helpers/live-pg";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { roadmapFixture, roadmapMetadata, roadmapPlan } from "./roadmap.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { withDevelopmentRun } from "./executor-attempt.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionConfiguration, subscriptionIntent } from "./ai044-subscription-approval.mts";
const owners = await import(new URL("../../lib/roadmap/roadmap-owner-commands.ts", import.meta.url).href) as typeof import("../../lib/roadmap/roadmap-owner-commands");
const planApprovals = await import(new URL("../../lib/db/roadmap-approvals.ts", import.meta.url).href) as typeof import("../../lib/db/roadmap-approvals");
const controllers = await import(new URL("../../lib/db/development-controller-store.ts", import.meta.url).href) as typeof import("../../lib/db/development-controller-store");
const authorities = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const approvals = await import(new URL("../../lib/db/ai044-subscription-approvals.ts", import.meta.url).href) as typeof import("../../lib/db/ai044-subscription-approvals");
const intents = await import(new URL("../../lib/executors/ai044-subscription-intent.ts", import.meta.url).href) as typeof import("../../lib/executors/ai044-subscription-intent");
export async function subscriptionApprovalPgFixture(db: LiveDatabase, label: string, options: { registerAuthority?: boolean; repository?: { id: string; baseline: string }; writePaths?: string[] } = {}) {
  const f = await roadmapFixture(db, label), task = await f.task("subscription", "feature", false), draft = roadmapPlan(); draft.tasks[0].allowedPaths = options.writePaths ?? ["src/server/terminal/account"];
  const saved = await f.planWriter.saveDraftRevision({ idempotencyKey: `subscription-plan-${label}-000000`, taskId: task.taskId, plan: draft }); assert.equal(saved.status, "created");
  const base = { database: f.database, tenant: f.tenant }, owner = owners.createRoadmapOwnerCommands({ ...base, identitySource: f.identitySource });
  assert.equal((await owner.createMilestone({ commandId: "milestone", projectId: "project-a", milestoneId: "m1", title: "Subscription", goal: "Bounded proposal", priority: 1 })).status, "applied");
  assert.equal((await owner.enroll({ commandId: "enroll", projectId: "project-a", taskId: task.taskId, expectedVersion: 0, milestoneId: "m1", metadata: roadmapMetadata(), dependencyIds: [] })).status, "applied");
  assert.equal((await owner.changeState({ commandId: "ready", projectId: "project-a", taskId: task.taskId, expectedVersion: 1, nextStatus: "ready" })).status, "applied");
  const controller = controllers.createDevelopmentControllerStore(base); let sequence = 0;
  async function command() { const state = await controller.read("project-a", task.taskId); assert.ok(state); return { commandId: `state-${++sequence}`, projectId: "project-a", taskId: task.taskId, expectedVersion: state.task.version, expectedControllerRevision: state.revision }; }
  assert.equal((await controller.claimReady(await command())).status, "applied");
  const c = await command(), { expectedControllerRevision: unused, ...planCommand } = c; void unused;
  const asked = await planApprovals.createRoadmapApprovalRequests(base).requestPlanApproval(planCommand); assert.ok(asked.status === "applied");
  assert.equal((await planApprovals.createRoadmapOwnerApprovalDecisions({ ...base, identitySource: f.identitySource }).decide({ ...planCommand, commandId: "plan-decision", approvalRequestId: asked.approvalRequestId, bindingFingerprint: asked.bindingFingerprint, decision: "approved" })).status, "applied");
  assert.equal((await controller.consumePlanApproval({ ...await command(), approvalRequestId: asked.approvalRequestId })).status, "applied");
  assert.equal((await controller.changeTaskState({ ...await command(), nextStatus: "running" })).status, "applied");
  const state = await controller.read("project-a", task.taskId); assert.ok(state?.approvedPlan);
  const seed = { ...subscriptionConfiguration(), ...(options.repository ? { repository: options.repository } : {}) }, configuration = withDevelopmentRun({ ...seed, admission: { ...seed.admission, plan: state.approvedPlan.plan,
    ...(options.writePaths ? { repositoryAllowlist: [...options.writePaths] } : {}) } });
  configuration.developmentRun = { ...configuration.developmentRun, id: `subscription-${label}` };
  const i = subscriptionIntent(Date.now()); i.workspaceId = f.tenant.workspaceId; i.workspaceDatabaseId = f.tenant.workspaceDatabaseId; i.projectTaskId = task.taskId;
  i.planId = state.approvedPlan.planId; i.planRevision = state.approvedPlan.revision; i.planFingerprint = state.approvedPlan.draftFingerprint; i.attempt.developmentRunId = configuration.developmentRun.id; i.repository = configuration.repository;
  i.allowedWritePaths = [...configuration.developmentRun.admittedAllowedPaths];
  if (options.writePaths) i.readContextPaths = [...options.writePaths];
  const intent = intents.normalizeSubscriptionIntent(i); assert.ok(intent);
  const config = { ...base, projectId: "project-a", projectTaskId: task.taskId, configuration, identitySource: f.identitySource };
  const store = approvals.createAI044SubscriptionApprovals(config), authority = authorities.createPostgresExecutorCurrentAuthorityStore({ ...base, projectId: "project-a", configuration });
  if (options.registerAuthority !== false) assert.equal((await authority.registerCurrentAuthority()).verdict, "allow");
  async function approve(approvedIntent: unknown = intent) {
    const request = await store.request({ commandId: `request-${++sequence}`, intent: approvedIntent }); assert.equal(request.status, "requested", JSON.stringify(request)); assert.ok(request.approvalRequestId);
    const decision = await store.decide({ commandId: `decision-${++sequence}`, approvalRequestId: request.approvalRequestId, intentFingerprint: request.intentFingerprint, decision: "approved" }); assert.equal(decision.status, "approved", JSON.stringify(decision));
    return request.approvalRequestId;
  }
  const invocation = { schemaVersion: 1, invocationId: intent.invocationId, identity: intent.executor, planId: intent.planId, taskId: intent.taskId, repository: intent.repository, capability: "coding", mode: "patch_proposal", attempt: intent.attempt };
  return { ...f, task, configuration, intent, invocation, store, authority, config, approve, controller, command };
}
