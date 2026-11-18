import { createHash } from "node:crypto";
import { types } from "node:util";
import type { FeaturePlan } from "../contracts/development-plan";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateAndNormalizeFeaturePlan } from "../contracts/development-plan.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { evaluateDevelopmentTaskAdmission, normalizeRepositoryPath, isSystemForbiddenRepositoryPath, repositoryPathContains } from "../contracts/development-task-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createCodexTaskArtifact } from "../codex-task-artifact.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { buildEffectiveCodexTaskInput } from "../codex-task-form-policy.ts";

// AI-040a local Node-only composition, separate from the AI-039 planning-only directory.
// No runtime, executor, provider or persistence dependency.
export const localHandoffLimits = Object.freeze({
  maxSpecBytes: 256 * 1024, maxDepth: 10, maxNodes: 10000, maxMembers: 64,
  maxChangedFiles: 64, maxFileBytes: 256 * 1024, maxPatchBytes: 2 * 1024 * 1024,
  maxReportBytes: 128 * 1024, maxLogBytes: 16 * 1024, maxCommands: 32, timeoutMs: 120000,
});
export const localHandoffPolicyVersion = "ai-040a.v1";
export class HandoffBlocked extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function block(code: string): never { throw new HandoffBlocked(code); }
export const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

// Snapshot BEFORE calling existing typed validators. Reject proxies/accessors, not invoke them.
// Work, nesting and total text are bounded independently; JSON.stringify never validates unknown.
export function boundedData(input: unknown): unknown {
  let nodes = 0, bytes = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > localHandoffLimits.maxNodes || depth > localHandoffLimits.maxDepth) block("input_limit_exceeded");
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value); if (bytes > localHandoffLimits.maxSpecBytes) block("input_limit_exceeded");
      return value;
    }
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
    if (!value || typeof value !== "object" || types.isProxy(value)) block("invalid_input");
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (proto !== Array.prototype || value.length > localHandoffLimits.maxMembers) block("input_limit_exceeded");
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1) block("invalid_input");
      const result: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !("value" in descriptor)) block("invalid_input");
        result.push(visit(descriptor.value, depth + 1));
      }
      return result;
    }
    if (proto !== Object.prototype && proto !== null) block("invalid_input");
    const keys = Reflect.ownKeys(value);
    if (keys.length > localHandoffLimits.maxMembers) block("input_limit_exceeded");
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string" || key.length > 128 || ["__proto__", "prototype", "constructor"].includes(key)) block("invalid_input");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) block("invalid_input");
      result[key] = visit(descriptor.value, depth + 1);
    }
    return result;
  };
  try { return visit(input, 0); } catch (error) { if (error instanceof HandoffBlocked) throw error; return block("invalid_input"); }
}
export function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) block("invalid_input");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || fields.some(key => !Object.hasOwn(record, key))) block("invalid_input");
  return record;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) block("invalid_input");
  return value.trim();
}
export function safeRepositoryPath(value: unknown): string {
  const normalized = normalizeRepositoryPath(value);
  if (!normalized.ok || !/^[A-Za-z0-9._/-]+$/u.test(normalized.value)) block("invalid_repository_path");
  return normalized.value;
}

export type VerificationCommand = Readonly<{ executable: "npm" | "git" | "node"; args: readonly string[]; display: string }>;
export function parseVerificationCommand(value: unknown): VerificationCommand | null {
  if (typeof value !== "string" || value.length > 1024) return null;
  const exact: Record<string, VerificationCommand> = {
    "npm run lint": { executable: "npm", args: ["run", "lint"], display: "npm run lint" },
    "npm run typecheck": { executable: "npm", args: ["run", "typecheck"], display: "npm run typecheck" },
    "npm test": { executable: "npm", args: ["test"], display: "npm test" },
    "npm run build": { executable: "npm", args: ["run", "build"], display: "npm run build" },
    "npm run test:pg": { executable: "npm", args: ["run", "test:pg"], display: "npm run test:pg" },
    "git diff --check": { executable: "git", args: ["diff", "--check"], display: "git diff --check" },
  };
  if (Object.hasOwn(exact, value)) return freezeDeep(exact[value]);
  if (!/^node --test tests\/[A-Za-z0-9._/-]+\.test\.mts(?: tests\/[A-Za-z0-9._/-]+\.test\.mts)*$/u.test(value)) return null;
  const paths = value.slice("node --test ".length).split(" ");
  try {
    if (paths.length > 16 || paths.some(path => safeRepositoryPath(path) !== path || isSystemForbiddenRepositoryPath(path))) return null;
  } catch { return null; }
  return freezeDeep({ executable: "node", args: ["--test", ...paths], display: value });
}

export type SecretFinding = Readonly<{ category: string; count: number }>;
const secretPatterns = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/gu],
  ["provider_token", /\b(?:sk-(?:proj-|ant-api\d\d-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/gu],
  ["credential_url", /\b(?:postgres(?:ql)?|https?):\/\/[^\s/:]+:[^\s/@]+@[^\s]+/gu],
  ["personal_path", /\/(?:Users|home)\/[^\s/]+(?:\/[^\s]*)?/gu],
] as const;
export function findProbableSecrets(value: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [category, expression] of secretPatterns) {
    const matches = value.match(expression); if (matches?.length) findings.push({ category, count: matches.length });
  }
  return findings.sort((a, b) => compare(a.category, b.category));
}
// Never serialize the environment. Redact exact inherited values as well as value patterns.
export function redactEvidence(value: string, environment: NodeJS.ProcessEnv): string {
  let safe = value;
  const values = [...new Set(Object.values(environment).filter((v): v is string => Boolean(v)))].sort((a, b) => b.length - a.length);
  for (const secret of values) safe = safe.split(secret).join("[redacted-env]");
  for (const [, pattern] of secretPatterns) safe = safe.replace(pattern, "[redacted]");
  return safe.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, "?");
}
export function ensureSafeEvidence(value: string): void {
  if (findProbableSecrets(value).length || Object.entries(process.env).some(([name, secret]) =>
    /TOKEN|SECRET|PASSWORD|CREDENTIAL|DATABASE_URL|API_KEY/u.test(name) && secret && value.includes(secret))) block("probable_secret");
}

export type HandoffSpec = Readonly<{
  schemaVersion: 1; pathSelectionMode: "manual"; selectedExecutor: Readonly<{ mode: "human_operated"; label: string }>;
  taskId: string; context: string; expectedHandoff: string; plan: FeaturePlan;
  repositoryAllowlist: readonly string[]; completedTaskIds: readonly string[]; activeTaskIds: readonly string[];
  taskOwnerApprovalGranted: boolean;
}>;
export type NormalizedHandoff = Readonly<{ spec: HandoffSpec; normalizedAllowedPaths: readonly string[]; verificationCommands: readonly string[]; artifact: string }>;
export function normalizeHandoffSpec(input: unknown): { ok: true; value: NormalizedHandoff } | { ok: false; reasons: readonly string[] } {
  try {
    const s = exactRecord(boundedData(input), ["schemaVersion", "pathSelectionMode", "selectedExecutor", "taskId", "context", "expectedHandoff", "plan", "repositoryAllowlist", "completedTaskIds", "activeTaskIds", "taskOwnerApprovalGranted"]);
    if (s.pathSelectionMode === "discover") block("explicit_owner_approved_paths_required");
    if (s.schemaVersion !== 1 || s.pathSelectionMode !== "manual" || typeof s.taskOwnerApprovalGranted !== "boolean") block("invalid_input");
    const executor = exactRecord(s.selectedExecutor, ["mode", "label"]);
    if (executor.mode !== "human_operated" || typeof executor.label !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(executor.label)) block("invalid_executor_metadata");
    const planData = exactRecord(s.plan, ["id", "title", "goal", "status", "tasks"]);
    if (!Array.isArray(planData.tasks)) block("invalid_plan");
    for (const task of planData.tasks) exactRecord(task, ["id", "sequence", "title", "goal", "scope", "nonGoals", "allowedPaths", "acceptanceCriteria", "verificationCommands", "dependencyIds", "riskLevel", "priority", "requiresOwnerApproval"]);
    const plan = validateAndNormalizeFeaturePlan(planData); if (!plan.ok) block("invalid_plan");
    const ids = (value: unknown): string[] => {
      if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id))) block("invalid_input");
      return [...new Set(value as string[])].sort(compare);
    };
    if (!Array.isArray(s.repositoryAllowlist) || !s.repositoryAllowlist.length) block("invalid_repository_allowlist");
    const allowlist = [...new Set(s.repositoryAllowlist.map(safeRepositoryPath))].sort(compare);
    if (allowlist.some(isSystemForbiddenRepositoryPath)) block("forbidden_repository_path");
    const normalizedSpec: HandoffSpec = {
      schemaVersion: 1, pathSelectionMode: "manual", selectedExecutor: { mode: "human_operated", label: executor.label },
      taskId: text(s.taskId, 64), context: text(s.context, 6000), expectedHandoff: text(s.expectedHandoff, 4000),
      plan: plan.value, repositoryAllowlist: allowlist, completedTaskIds: ids(s.completedTaskIds), activeTaskIds: ids(s.activeTaskIds),
      taskOwnerApprovalGranted: s.taskOwnerApprovalGranted,
    };
    const admission = evaluateDevelopmentTaskAdmission(normalizedSpec);
    if (admission.verdict !== "allow") block("task_admission_denied");
    const paths = admission.normalizedAllowedPaths.map(safeRepositoryPath).sort(compare);
    if (paths.some(path => isSystemForbiddenRepositoryPath(path) || !allowlist.some(parent => repositoryPathContains(parent, path)))) block("forbidden_repository_path");
    const task = plan.value.tasks.find(task => task.id === normalizedSpec.taskId)!;
    if (!task.verificationCommands.length || task.verificationCommands.length >= localHandoffLimits.maxCommands) block("verification_limit_exceeded");
    const commands = [...new Set([...task.verificationCommands, "git diff --check"])];
    const artifact = createCodexTaskArtifact(buildEffectiveCodexTaskInput({
      goal: task.goal, context: normalizedSpec.context, scope: task.scope.join("\n"), nonGoals: task.nonGoals.join("\n") || "No unapproved work",
      allowedPaths: paths.join("\n"), allowedCommands: commands.join("\n"), acceptanceCriteria: task.acceptanceCriteria.join("\n"),
      verificationCommands: commands.join("\n"), expectedHandoff: normalizedSpec.expectedHandoff,
      additionalForbiddenActions: "Do not modify the external handoff manifest or task artifact. No executor invocation. Owner decision remains external.",
    }, "manual"));
    if (!artifact.ok) block("invalid_task_artifact");
    ensureSafeEvidence(JSON.stringify(normalizedSpec)); ensureSafeEvidence(artifact.artifact.markdown);
    return { ok: true, value: freezeDeep({ spec: normalizedSpec, normalizedAllowedPaths: paths, verificationCommands: commands, artifact: artifact.artifact.markdown }) };
  } catch (error) { return { ok: false, reasons: [error instanceof HandoffBlocked ? error.code : "invalid_input"] }; }
}

export type Baseline = Readonly<{ branch: string; head: string; repositoryFingerprint: string }>;
export type HandoffManifest = Readonly<{
  schemaVersion: 1; policyVersion: typeof localHandoffPolicyVersion; ownerDecisionRequired: true;
  task: Readonly<{ id: string; label: string }>; selectedExecutor: HandoffSpec["selectedExecutor"];
  baseline: Baseline; normalizedAllowedPaths: readonly string[]; verificationCommands: readonly string[];
  taskArtifact: Readonly<{ filename: string; sha256: string; sizeBytes: number }>; spec: HandoffSpec;
}>;
export type VerificationRecord = Readonly<{
  command: string; status: "passed" | "failed" | "timed_out" | "unsupported" | "not_run";
  exitCode: number | null; durationMs: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean;
}>;
export const notRun = (command: string): VerificationRecord => ({ command, status: "not_run", exitCode: null, durationMs: 0, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false });
export type ArtifactMetadata = Readonly<{ filename: string; sha256: string; sizeBytes: number }>;
export const artifactMetadata = (filename: string, data: Buffer | string): ArtifactMetadata => ({ filename, sha256: sha256(data), sizeBytes: Buffer.byteLength(data) });
export type ReviewPackage = Readonly<{
  schemaVersion: 1; policyVersion: string; outcome: "ready_for_owner" | "blocked"; ownerDecisionRequired: true;
  identity: Readonly<{ task: HandoffManifest["task"]; selectedExecutor: HandoffSpec["selectedExecutor"]; baseline: Baseline }>;
  scope: Readonly<{ approvedPaths: readonly string[]; actualChangedPaths: readonly string[]; unauthorizedPaths: readonly string[]; pathPolicy: "passed" | "failed" | "not_run" }>;
  artifacts: Readonly<{ taskArtifact: ArtifactMetadata; patch: ArtifactMetadata | null; executorReport: ArtifactMetadata | null }>;
  verification: readonly VerificationRecord[];
  security: Readonly<{ baseline: string; forbiddenPaths: string; secretScan: string; whitespace: string; findings: readonly Readonly<{ path: string; category: string; count: number }>[] }>;
  reasons: readonly string[];
}>;
