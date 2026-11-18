import { createHash } from "node:crypto";
import type { DevelopmentExecutionRun } from "../contracts/development-execution";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateAndNormalizeDevelopmentExecutionRun } from "../contracts/development-execution.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateAndNormalizeFeaturePlan } from "../contracts/development-plan.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateDevelopmentTaskAdmission } from "../contracts/development-task-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, freezeDeep, compare } from "../local-handoff/local-handoff-policy.ts";

export type ExecutorAuthorityFacts = Readonly<{
  developmentRunId: string; planId: string; taskId: string; attemptNumber: number; attemptKind: "initial" | "corrective";
  canonicalRunFingerprint: string; admissionFingerprint: string; admissionScopeFingerprint: string; predecessorRunFingerprint: string | null;
}>;
// ONLY bounded, validated data reaches this serializer; no arbitrary unknown traversal.
function digest(value: unknown): string {
  const snapshot = boundedData(value);
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => compare(a, b)).map(([k, x]) => [k, canonical(x)]));
    return v;
  }
  return createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
}
/** Trusted configuration evidence, never a caller grant or a start permit. */
export function deriveExecutorAuthorityFacts(input: unknown): ExecutorAuthorityFacts {
  try {
    const c = boundedData(input) as import("../contracts/executor-adapter").ExecutorAdapterConfiguration;
    const contract = createExecutorAdapterContract(c);
    const normalized = validateAndNormalizeDevelopmentExecutionRun(c.developmentRun);
    const plan = validateAndNormalizeFeaturePlan(c.admission.plan);
    const admission = evaluateDevelopmentTaskAdmission(c.admission);
    if (!contract.adapter || !normalized.ok || !plan.ok || admission.verdict !== "allow") throw Error();
    const run = normalized.value;
    const paths = [...admission.normalizedAllowedPaths].sort(compare);
    if (JSON.stringify([...run.admittedAllowedPaths].sort(compare)) !== JSON.stringify(paths)) throw Error();
    let predecessorRunFingerprint: string | null = null;
    if (run.currentAttemptNumber > 1) {
      // An executable b0 snapshot has one empty in-progress attempt. Rewind only the
      // newly closed predecessor; hash ALL older history and invariant Run facts.
      // Validation of the supplied full Run proves the actual failure/correction path.
      const number = run.currentAttemptNumber - 1;
      const predecessor: DevelopmentExecutionRun = { ...run, currentAttemptNumber: number,
        status: "implementing", nextAction: "submit_patch_or_failure", blockingReasons: [],
        failures: run.failures.filter(f => f.attemptNumber < number),
        attempts: run.attempts.slice(0, number).map(a => {
          if (a.number !== number) return a;
          const rewound = { ...a, status: "in_progress" as const, changedPaths: [], failureFingerprints: [], verificationChecks: [],
            reviewStatus: "not_started" as const, closureKind: "none" as const };
          // Analysis output is no more initial implementing evidence than patch paths.
          // Remove ONLY the adjacent attempt's optional field; older history stays factual.
          delete rewound.analysisReportFingerprint;
          return rewound;
        }) };
      const p = validateAndNormalizeDevelopmentExecutionRun(predecessor);
      if (!p.ok) throw Error();
      predecessorRunFingerprint = digest(p.value);
    }
    return freezeDeep({ developmentRunId: run.id, planId: run.planId, taskId: run.taskId,
      attemptNumber: run.currentAttemptNumber, attemptKind: run.attempts.at(-1)!.kind,
      canonicalRunFingerprint: digest(run), predecessorRunFingerprint,
      admissionFingerprint: digest({ policy: "development_task_admission_v1", plan: plan.value,
        taskId: admission.taskId, admittedPaths: paths, ownerApprovalRequired: admission.ownerApprovalRequired,
        ownerApprovalSatisfied: admission.ownerApprovalSatisfied, taskOwnerApprovalGranted: c.admission.taskOwnerApprovalGranted,
        completedTaskIds: [...c.admission.completedTaskIds as string[]].sort(compare),
        activeTaskIds: [...c.admission.activeTaskIds as string[]].sort(compare),
        repositoryAllowlist: [...c.admission.repositoryAllowlist as string[]].sort(compare),
        identity: contract.adapter.identity, capabilities: contract.adapter.capabilities, repository: c.repository }),
      // Separate domain: preserve the historical FULL digest above byte-for-byte.
      // Stable admission excludes only the intentionally replaceable executor declaration.
      admissionScopeFingerprint: digest({ policy: "development_task_admission_scope_v1", plan: plan.value,
        taskId: admission.taskId, admittedPaths: paths, ownerApprovalRequired: admission.ownerApprovalRequired,
        ownerApprovalSatisfied: admission.ownerApprovalSatisfied, taskOwnerApprovalGranted: c.admission.taskOwnerApprovalGranted,
        completedTaskIds: [...c.admission.completedTaskIds as string[]].sort(compare),
        activeTaskIds: [...c.admission.activeTaskIds as string[]].sort(compare),
        repositoryAllowlist: [...c.admission.repositoryAllowlist as string[]].sort(compare), repository: c.repository }) });
  } catch { throw Error("invalid_executor_authority_configuration"); }
}
