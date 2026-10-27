// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { subscriptionRegistrationFingerprint, subscriptionExecutorIdentity } from "../../lib/executors/ai044-subscription-intent.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044Baseline } from "../../lib/executors/ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { withDevelopmentRun } from "./executor-attempt.mts";
export type SubscriptionFixtureConfiguration = Omit<ExecutorAdapterConfiguration, "admission"> & Readonly<{ admission: {
  plan: FeaturePlan; taskId: string; completedTaskIds: string[]; activeTaskIds: string[]; repositoryAllowlist: string[]; taskOwnerApprovalGranted: boolean;
} }>;
export function subscriptionConfiguration(number = 1, runId = "subscription-run"): SubscriptionFixtureConfiguration {
  const c = withDevelopmentRun<Omit<SubscriptionFixtureConfiguration, "developmentRun">>({ identity: { ...subscriptionExecutorIdentity }, capabilities: { tasks: ["coding"], modes: ["patch_proposal"], artifacts: ["patch", "report"] },
    repository: { id: "smart-algorithms", baseline: ai044Baseline }, admission: { taskId: "step-1", completedTaskIds: [], activeTaskIds: [],
      repositoryAllowlist: ["src/server/terminal/account"], taskOwnerApprovalGranted: true, plan: { id: "plan-a", title: "Approved feature", goal: "Portfolio Analytics proposal", status: "approved",
        tasks: [{ id: "step-1", sequence: 1, title: "Analytics", goal: "Propose analytics", scope: ["Read-only analytics"], nonGoals: ["No writes"], allowedPaths: ["src/server/terminal/account"],
          acceptanceCriteria: ["Owner reviews proposal"], verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "low", priority: "P2", requiresOwnerApproval: false }] } } }, number);
  return { ...c, developmentRun: { ...c.developmentRun, id: runId } };
}
export function subscriptionIntent(now = 1000) {
  const registration = { label: "chatgpt-0123456789abcdef", clientId: "issued-client", subjectHash: "a".repeat(64) };
  return { schemaVersion: 1, workspaceId: "workspace-primary", workspaceDatabaseId: "00000000-0000-4000-8000-0000000000a1", projectId: "project-a", projectTaskId: "owner-task-a", planId: "plan-a", planRevision: 1,
    planFingerprint: "b".repeat(64), taskId: "step-1", invocationId: "subscription-invocation", attempt: { developmentRunId: "subscription-run", number: 1, kind: "initial" }, executor: { ...subscriptionExecutorIdentity }, accessMode: "subscription_session",
    registration, model: "test-plan-model", repository: { id: "smart-algorithms", baseline: ai044Baseline }, contextFingerprint: "c".repeat(64), allowedWritePaths: ["src/server/terminal/account"], readContextPaths: ["src/server/terminal/account/analytics.ts"],
    patchBounds: { files: 12, changedLines: 1200 }, preflight: { receiptId: "manual-receipt", observedAt: now, expiresAt: now + 60000, appLimitPercent: 50, creditsEnabled: false, automaticPurchaseReliedUpon: false,
      registrationFingerprint: subscriptionRegistrationFingerprint(registration) }, expiresAt: now + 60000 };
}
import type { ExecutorAdapterConfiguration } from "../../lib/contracts/executor-adapter";
import type { FeaturePlan } from "../../lib/contracts/development-plan";
