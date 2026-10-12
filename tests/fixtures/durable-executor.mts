// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { withDevelopmentRun } from "./executor-attempt.mts";
export function executorConfiguration(number = 1, runId = "development-a") {
  const c = withDevelopmentRun({ identity: { id: "openai-agents", version: "v1" },
    capabilities: { tasks: ["coding", "repository_analysis"], modes: ["patch_proposal", "analysis_only"], artifacts: ["patch", "report"] },
    repository: { id: "repo-a", baseline: "a".repeat(40) },
    admission: { taskId: "task-a", completedTaskIds: [], activeTaskIds: [], repositoryAllowlist: ["src"], taskOwnerApprovalGranted: true,
      plan: { id: "plan-a", title: "Plan", goal: "Bounded proposal", status: "approved", tasks: [{ id: "task-a", sequence: 1,
        title: "Task", goal: "Proposal", scope: ["Source"], nonGoals: ["No external actions"], allowedPaths: ["src"],
        acceptanceCriteria: ["Owner review"], verificationCommands: ["npm test"], dependencyIds: [], riskLevel: "low", priority: "P3", requiresOwnerApproval: true }] } } }, number);
  c.developmentRun = { ...c.developmentRun, id: runId };
  return c;
}
export function executorRequest(number = 1, runId = "development-a", invocationId = "invocation-a") {
  const c = executorConfiguration(number, runId);
  return { schemaVersion: 1, invocationId, identity: c.identity, planId: "plan-a", taskId: "task-a", repository: c.repository,
    capability: "coding", mode: "patch_proposal", attempt: { developmentRunId: runId, number, kind: number === 1 ? "initial" : "corrective" } };
}
export const financialPolicy = () => ({ maximumExposureUsdMicros: 20000, totalExposureUsdMicros: 1000000000, reservationTtlMs: 60000 });
export const executorTarget = () => ({ providerId: "openai", modelId: "explicit-test-model", accountId: "account-a" });
export const context = () => ({ files: [{ path: "src/a.ts", content: "// authorized test context" }] });
