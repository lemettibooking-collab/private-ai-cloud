import assert from "node:assert/strict";
const execution = await import(new URL("../../lib/contracts/development-execution.ts", import.meta.url).href) as typeof import("../../lib/contracts/development-execution");
const policy = await import(new URL("../../lib/contracts/development-task-policy.ts", import.meta.url).href) as typeof import("../../lib/contracts/development-task-policy");

export function transition(run: unknown, event: unknown) {
  const d = execution.transitionDevelopmentExecutionRun(run, event);
  assert.ok(d.ok, JSON.stringify(d));
  return d.value;
}
export function withDevelopmentRun<T extends { admission: { plan: { id: string }; taskId: string } }>(configuration: T, number = 1) {
  const d = execution.createDevelopmentExecutionRun({ id: "development-a", planId: configuration.admission.plan.id,
    taskId: configuration.admission.taskId, admissionDecision: policy.evaluateDevelopmentTaskAdmission(configuration.admission),
    requiredVerificationCommands: ["npm test"], protectedPaths: [] });
  assert.ok(d.ok, JSON.stringify(d));
  let run = transition(d.value, { type: "start_attempt" });
  for (let i = 1; i < number; i++) {
    run = transition(run, { type: "implementation_failed", failure: { phase: "implementation", code: "implementation_failed",
      fingerprint: `implementation:${i}`, summary: "Implementation needs correction", retryable: true,
      scopeExpansionRequired: false, protectedPathViolation: false, systemForbiddenPathViolation: false } });
    run = transition(run, { type: "start_attempt" });
  }
  return { ...configuration, developmentRun: structuredClone(run) };
}
export const initialAttempt = () => ({ developmentRunId: "development-a", number: 1, kind: "initial" });
