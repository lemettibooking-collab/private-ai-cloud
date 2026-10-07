import { createHash } from "node:crypto";
import type { DevelopmentTask } from "./development-plan";
import type { DevelopmentTaskAdmissionInput } from "./development-task-policy";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateAndNormalizeFeaturePlan } from "./development-plan.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateDevelopmentTaskAdmission, isSystemForbiddenRepositoryPath, repositoryPathContains } from "./development-task-policy.ts";
// Reuse ONLY pure bounded-data/path/evidence utilities, never the human handoff normalizer or IO.
// This dependency confers no handoff, executor, shell, Git or provider authority.
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, safeRepositoryPath, ensureSafeEvidence, freezeDeep, compare, localHandoffLimits } from "../local-handoff/local-handoff-policy.ts";

export const executorAdapterLimits = Object.freeze({
  maxIdLength: 64, maxVersionLength: 32, maxChanges: 64,
  maxContentBytes: 128 * 1024, maxReportBytes: 16 * 1024,
  maxDepth: localHandoffLimits.maxDepth, maxNodes: localHandoffLimits.maxNodes,
  maxMembers: localHandoffLimits.maxMembers, maxEnvelopeBytes: localHandoffLimits.maxSpecBytes,
});
export type ExecutorIdentity = Readonly<{ id: string; version: string }>;
export type ExecutorCapability = "coding" | "repository_analysis";
export type ExecutorExecutionMode = "patch_proposal" | "analysis_only";
export type ExecutorCapabilities = Readonly<{
  tasks: readonly ExecutorCapability[];
  modes: readonly ExecutorExecutionMode[];
  artifacts: readonly ("patch" | "report")[];
}>;
export type ExecutorRepositoryRef = Readonly<{ id: string; baseline: string }>;
/** Trusted composition input, not an API registration or invocation request. */
export type ExecutorAdapterConfiguration = Readonly<{
  identity: ExecutorIdentity; capabilities: ExecutorCapabilities;
  repository: ExecutorRepositoryRef; admission: DevelopmentTaskAdmissionInput;
}>;
export type ExecutorInvocationInput = Readonly<{
  schemaVersion: 1; invocationId: string; identity: ExecutorIdentity;
  planId: string; taskId: string; repository: ExecutorRepositoryRef;
  capability: ExecutorCapability; mode: ExecutorExecutionMode;
}>;
export type NormalizedExecutorInvocation = ExecutorInvocationInput & Readonly<{
  task: Pick<DevelopmentTask, "title" | "goal" | "scope" | "nonGoals" | "acceptanceCriteria">;
  allowedPaths: readonly string[];
  invocationAuthorized: false;
}>;
export type ExecutorChange = Readonly<{
  path: string; operation: "add" | "modify" | "delete";
  content: string | null; sha256: string | null;
}>;
export type ExecutorReport = Readonly<{ content: string; sha256: string }>;
export type ExecutorOutcome = "succeeded" | "rejected" | "failed" | "outcome_unknown";
export type ExecutorFailureCode = "unsupported" | "policy_rejected" | "timeout" | "provider_failure" | "execution_failure" | "ambiguous_outcome";
export type ExecutorResultInput = Readonly<{
  schemaVersion: 1; identity: ExecutorIdentity; invocationId: string; status: ExecutorOutcome;
  failureCode: ExecutorFailureCode | null; changes: readonly ExecutorChange[]; report: ExecutorReport | null;
}>;
export type NormalizedExecutorResult = ExecutorResultInput & Readonly<{
  repository: ExecutorRepositoryRef; planId: string; taskId: string;
  ownerDecisionRequired: true; verificationStatus: "not_run"; automaticRetryAllowed: false;
}>;
export type ExecutorReasonCode = "invalid_configuration" | "invalid_invocation" | "invalid_result" | "identity_mismatch"
  | "task_admission_denied" | "invocation_binding_mismatch" | "unsupported_capability" | "invalid_receipt"
  | "evidence_integrity_mismatch" | "evidence_path_denied" | "unsafe_evidence";
export type ExecutorReason = Readonly<{ code: ExecutorReasonCode; path: string }>;
export type ExecutorInvocationDecision = Readonly<{
  verdict: "allow" | "deny"; reasons: readonly ExecutorReason[];
  invocationAuthorized: false; normalizedInvocation: NormalizedExecutorInvocation | null;
}>;
export type ExecutorResultDecision = Readonly<{
  verdict: "allow" | "deny"; reasons: readonly ExecutorReason[]; normalizedResult: NormalizedExecutorResult | null;
}>;
/** Contract validation ONLY. There deliberately is no execute/invoke/dispatch method or authority issuer. */
export type ExecutorAdapter = Readonly<{
  identity: ExecutorIdentity; capabilities: ExecutorCapabilities;
  validateInvocation(input: unknown): ExecutorInvocationDecision;
  evaluateResult(invocation: unknown, result: unknown): ExecutorResultDecision;
}>;
export type ExecutorAdapterConfigurationDecision = Readonly<{
  verdict: "allow" | "deny"; reasons: readonly ExecutorReason[]; adapter: ExecutorAdapter | null;
}>;

class InvalidContract extends Error {
  readonly code: ExecutorReasonCode;
  readonly path: string;
  constructor(code: ExecutorReasonCode, path: string) { super(code); this.code = code; this.path = path; }
}
function reject(code: ExecutorReasonCode, path: string): never { throw new InvalidContract(code, path); }
function reason(error: unknown, fallback: ExecutorReasonCode): readonly ExecutorReason[] {
  return [{ code: error instanceof InvalidContract ? error.code : fallback, path: error instanceof InvalidContract ? error.path : "$" }];
}
function record(input: unknown, fields: readonly string[], path: string, code: ExecutorReasonCode): Record<string, unknown> {
  try { return exactRecord(input, fields); } catch { return reject(code, path); }
}
function identifier(value: unknown, path: string, code: ExecutorReasonCode): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)) reject(code, path);
  return value;
}
function identity(input: unknown, path: string, code: ExecutorReasonCode): ExecutorIdentity {
  const r = record(input, ["id", "version"], path, code);
  if (typeof r.version !== "string" || !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(r.version)) reject(code, `${path}.version`);
  return { id: identifier(r.id, `${path}.id`, code), version: r.version };
}
function repository(input: unknown, path: string, code: ExecutorReasonCode): ExecutorRepositoryRef {
  const r = record(input, ["id", "baseline"], path, code);
  if (typeof r.baseline !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(r.baseline)) reject(code, `${path}.baseline`);
  return { id: identifier(r.id, `${path}.id`, code), baseline: r.baseline };
}
function enumList<const T extends string>(input: unknown, values: readonly T[], path: string): T[] {
  if (!Array.isArray(input) || !input.length || input.length > values.length || input.some(item => !values.includes(item))) reject("invalid_configuration", path);
  if (new Set(input).size !== input.length) reject("invalid_configuration", path);
  return [...input].sort(compare);
}
function safeEvidence(text: string, path: string): void {
  try { ensureSafeEvidence(text); } catch { reject("unsafe_evidence", path); }
  // Credential headers/assignments are not an artifact format; reject rather than serialize them.
  if (/\b(?:authorization\s*:\s*(?:bearer|basic)|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[:=])/iu.test(text)) reject("unsafe_evidence", path);
}
function evidenceText(value: unknown, maxBytes: number, path: string, meaningful: boolean): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > maxBytes || (meaningful && !value.trim())
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) reject("invalid_result", path);
  safeEvidence(value, path); return value;
}
function digest(content: string, claimed: unknown, path: string): string {
  const actual = createHash("sha256").update(content).digest("hex");
  if (claimed !== actual) reject("evidence_integrity_mismatch", path);
  return actual;
}
const sameIdentity = (a: ExecutorIdentity, b: ExecutorIdentity) => a.id === b.id && a.version === b.version;

/**
 * Trusted composition declares one known adapter and a task-policy snapshot. Never expose
 * this factory as a caller-controlled registration endpoint. Capabilities are declarations,
 * not remotely verified claims. Neither this factory nor an allow verdict authorizes dispatch.
 * The private receipt is validation provenance ONLY, not an invocation permit.
 */
export function createExecutorAdapterContract(input: unknown): ExecutorAdapterConfigurationDecision {
  try {
    const c = record(boundedData(input), ["identity", "capabilities", "repository", "admission"], "$", "invalid_configuration");
    const configuredIdentity = identity(c.identity, "identity", "invalid_configuration");
    const configuredRepository = repository(c.repository, "repository", "invalid_configuration");
    const caps = record(c.capabilities, ["tasks", "modes", "artifacts"], "capabilities", "invalid_configuration");
    const capabilities: ExecutorCapabilities = {
      tasks: enumList(caps.tasks, ["coding", "repository_analysis"], "capabilities.tasks"),
      modes: enumList(caps.modes, ["patch_proposal", "analysis_only"], "capabilities.modes"),
      artifacts: enumList(caps.artifacts, ["patch", "report"], "capabilities.artifacts"),
    };
    const admission = record(c.admission, ["plan", "taskId", "completedTaskIds", "activeTaskIds", "repositoryAllowlist", "taskOwnerApprovalGranted"], "admission", "invalid_configuration");
    const planInput = record(admission.plan, ["id", "title", "goal", "status", "tasks"], "admission.plan", "invalid_configuration");
    if (!Array.isArray(planInput.tasks)) reject("invalid_configuration", "admission.plan.tasks");
    for (const [i, task] of planInput.tasks.entries()) {
      record(task, ["id", "sequence", "title", "goal", "scope", "nonGoals", "allowedPaths", "acceptanceCriteria", "verificationCommands", "dependencyIds", "riskLevel", "priority", "requiresOwnerApproval"], `admission.plan.tasks[${i}]`, "invalid_configuration");
    }
    const validation = validateAndNormalizeFeaturePlan(planInput);
    if (!validation.ok) reject("invalid_configuration", "admission.plan");
    const taskAdmission = evaluateDevelopmentTaskAdmission(admission);
    if (taskAdmission.verdict !== "allow") reject("task_admission_denied", "admission");
    // Inspect the bounded snapshot, never arbitrary unknown or a caller-owned live object.
    safeEvidence(JSON.stringify(c), "$configuration");
    const paths = taskAdmission.normalizedAllowedPaths.map(safeRepositoryPath).sort(compare);
    const taskId = identifier(admission.taskId, "admission.taskId", "invalid_configuration");
    const task = validation.value.tasks.find(t => t.id === taskId)!;
    const taskData = { title: task.title, goal: task.goal, scope: [...task.scope], nonGoals: [...task.nonGoals], acceptanceCriteria: [...task.acceptanceCriteria] };
    // Do not forward verificationCommands as executable instructions or caller trusted options.
    const receipts = new WeakSet<object>();

    const validateInvocation = (input: unknown): ExecutorInvocationDecision => {
      try {
        const r = record(boundedData(input), ["schemaVersion", "invocationId", "identity", "planId", "taskId", "repository", "capability", "mode"], "$", "invalid_invocation");
        if (r.schemaVersion !== 1) reject("invalid_invocation", "schemaVersion");
        const requestedIdentity = identity(r.identity, "identity", "invalid_invocation");
        if (!sameIdentity(requestedIdentity, configuredIdentity)) reject("identity_mismatch", "identity");
        const requestedRepository = repository(r.repository, "repository", "invalid_invocation");
        if (r.planId !== validation.value.id || r.taskId !== taskId || requestedRepository.id !== configuredRepository.id || requestedRepository.baseline !== configuredRepository.baseline) reject("invocation_binding_mismatch", "$binding");
        if (!capabilities.tasks.includes(r.capability as ExecutorCapability) || !capabilities.modes.includes(r.mode as ExecutorExecutionMode)
          || !capabilities.artifacts.includes("report") || (r.mode === "patch_proposal" && !capabilities.artifacts.includes("patch"))
          || !((r.capability === "coding" && r.mode === "patch_proposal") || (r.capability === "repository_analysis" && r.mode === "analysis_only"))) reject("unsupported_capability", "capability");
        safeEvidence(JSON.stringify(r), "$invocation");
        const normalizedInvocation: NormalizedExecutorInvocation = freezeDeep({
          schemaVersion: 1, invocationId: identifier(r.invocationId, "invocationId", "invalid_invocation"), identity: requestedIdentity,
          planId: validation.value.id, taskId, repository: requestedRepository,
          capability: r.capability as ExecutorCapability, mode: r.mode as ExecutorExecutionMode,
          task: { title: taskData.title, goal: taskData.goal, scope: [...taskData.scope], nonGoals: [...taskData.nonGoals], acceptanceCriteria: [...taskData.acceptanceCriteria] },
          allowedPaths: [...paths], invocationAuthorized: false,
        });
        receipts.add(normalizedInvocation);
        return freezeDeep({ verdict: "allow", reasons: [], invocationAuthorized: false, normalizedInvocation });
      } catch (error) { return freezeDeep({ verdict: "deny", reasons: reason(error, "invalid_invocation"), invocationAuthorized: false, normalizedInvocation: null }); }
    };

    const evaluateResult = (invocation: unknown, input: unknown): ExecutorResultDecision => {
      try {
        if (!invocation || typeof invocation !== "object" || !receipts.has(invocation)) reject("invalid_receipt", "invocation");
        const receipt = invocation as NormalizedExecutorInvocation;
        const r = record(boundedData(input), ["schemaVersion", "identity", "invocationId", "status", "failureCode", "changes", "report"], "$", "invalid_result");
        if (r.schemaVersion !== 1) reject("invalid_result", "schemaVersion");
        const resultIdentity = identity(r.identity, "identity", "invalid_result");
        if (!sameIdentity(resultIdentity, receipt.identity)) reject("identity_mismatch", "identity");
        if (r.invocationId !== receipt.invocationId) reject("invocation_binding_mismatch", "invocationId");
        if (!Array.isArray(r.changes) || r.changes.length > executorAdapterLimits.maxChanges) reject("invalid_result", "changes");
        const status = r.status;
        let changes: ExecutorChange[] = [], report: ExecutorReport | null = null;
        if (status === "succeeded") {
          if (r.failureCode !== null || r.report === null || (receipt.mode === "patch_proposal" ? !r.changes.length : r.changes.length > 0)) reject("invalid_result", "status");
          const seen = new Set<string>();
          changes = r.changes.map((value, index): ExecutorChange => {
            const p = `changes[${index}]`, change = record(value, ["path", "operation", "content", "sha256"], p, "invalid_result");
            let path: string;
            try { path = safeRepositoryPath(change.path); } catch { return reject("evidence_path_denied", `${p}.path`); }
            safeEvidence(path, `${p}.path`);
            if (seen.has(path) || isSystemForbiddenRepositoryPath(path) || !receipt.allowedPaths.some(parent => repositoryPathContains(parent, path))) reject("evidence_path_denied", `${p}.path`);
            seen.add(path);
            if (change.operation === "delete") {
              if (change.content !== null || change.sha256 !== null) reject("invalid_result", p);
              return { path, operation: "delete", content: null, sha256: null };
            }
            if (change.operation !== "add" && change.operation !== "modify") reject("invalid_result", `${p}.operation`);
            const content = evidenceText(change.content, executorAdapterLimits.maxContentBytes, `${p}.content`, false);
            return { path, operation: change.operation, content, sha256: digest(content, change.sha256, `${p}.sha256`) };
          }).sort((a, b) => compare(a.path, b.path));
          const reportData = record(r.report, ["content", "sha256"], "report", "invalid_result");
          const content = evidenceText(reportData.content, executorAdapterLimits.maxReportBytes, "report.content", true);
          report = { content, sha256: digest(content, reportData.sha256, "report.sha256") };
        } else {
          const validFailure = (status === "rejected" && ["unsupported", "policy_rejected"].includes(r.failureCode as string))
            || (status === "failed" && ["timeout", "provider_failure", "execution_failure"].includes(r.failureCode as string))
            || (status === "outcome_unknown" && r.failureCode === "ambiguous_outcome");
          if (!validFailure || r.changes.length || r.report !== null) reject("invalid_result", "status");
        }
        const normalizedResult: NormalizedExecutorResult = {
          schemaVersion: 1, identity: resultIdentity, invocationId: receipt.invocationId,
          status: status as ExecutorOutcome, failureCode: r.failureCode as ExecutorFailureCode | null, changes, report,
          repository: { id: receipt.repository.id, baseline: receipt.repository.baseline }, planId: receipt.planId, taskId: receipt.taskId,
          ownerDecisionRequired: true, verificationStatus: "not_run", automaticRetryAllowed: false,
        };
        return freezeDeep({ verdict: "allow", reasons: [], normalizedResult });
      } catch (error) { return freezeDeep({ verdict: "deny", reasons: reason(error, "invalid_result"), normalizedResult: null }); }
    };
    Object.freeze(validateInvocation); Object.freeze(evaluateResult);
    return freezeDeep({ verdict: "allow", reasons: [], adapter: { identity: configuredIdentity, capabilities, validateInvocation, evaluateResult } });
  } catch (error) { return freezeDeep({ verdict: "deny", reasons: reason(error, "invalid_configuration"), adapter: null }); }
}
