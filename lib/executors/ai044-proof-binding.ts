// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureRoadmapData } from "../roadmap/roadmap-contract.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactRecord, freezeDeep, sha256, findProbableSecrets } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeRepositoryPath, repositoryPathContains, isSystemForbiddenRepositoryPath } from "../contracts/development-task-policy.ts";

export const ai044Baseline = "ff8c035f8032417888a71c6a81aa9b9c26c816e8";
export const ai044Repository = "lemettibooking-collab/Smart-Algorithms";
export const ai044ProfileVersion = "pac.ai044.openai-hosted-coding.v1";
export const ai044RequiredVerification = Object.freeze(["npm run lint", "npm run typecheck", "npm run build",
  "node src/server/terminal/account/portfolio-analytics-smoke.mjs", "git diff --check"]);
export const ai044OutputLimits = Object.freeze({ files: 12, changedLines: 1200, patchBytes: 256 * 1024, manifestBytes: 32 * 1024 });
const envelope = Object.freeze(["src/server/terminal/account", "src/shared/model/terminal/contracts.ts", "src/shared/api/terminal",
  "app/api/terminal/portfolio-analytics", "src/widgets/terminal-bottom-panels"]);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/u;
export function ai044SafeText(value: unknown, maximum = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    && findProbableSecrets(value).length === 0
    && !/(?:\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]|authorization\s*:\s*(?:bearer|basic)|DATABASE_URL)/iu.test(value);
}
export const ai044Id = (value: unknown): value is string => typeof value === "string" && identifier.test(value) && ai044SafeText(value, 128);
export const ai044Hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export const ai044Integer = (value: unknown, maximum = 1_000_000_000): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
/** Existing bounded hostile-input snapshot, then canonical sorted keys. No env/IO/credentials. */
export function ai044Fingerprint(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return sha256(JSON.stringify(sort(captureRoadmapData(value))));
}
export { captureRoadmapData as captureAI044Data, exactRecord as exactAI044Record, freezeDeep as freezeAI044, sha256 as ai044Sha256 };
export function ai044Path(value: unknown): string | null {
  const p = normalizeRepositoryPath(value);
  return p.ok && p.value === value && /^[A-Za-z0-9._/-]+$/u.test(p.value) && !isSystemForbiddenRepositoryPath(p.value)
    && !p.value.split("/").some(s => [".git", "node_modules", ".next"].includes(s) || s === ".env" || s.startsWith(".env.")) ? p.value : null;
}
/** Maximum feature envelope is not admission or repository/executor authority. */
export function ai044FeaturePath(value: unknown): string | null {
  const path = ai044Path(value);
  return path && envelope.some(parent => parent.endsWith(".ts") ? path === parent : repositoryPathContains(parent, path)) ? path : null;
}
export type AI044ProofBinding = Readonly<{
  schemaVersion: 1; workspaceId: string; projectId: string; projectTaskId: string; planId: string; planRevision: number; planFingerprint: string;
  developmentTaskId: string; developmentRunId: string; invocationId: string; attemptNumber: number;
  executorIdentity: Readonly<{ id: "openai-agents"; version: "v1" }>;
  provider: Readonly<{ id: "openai"; accountId: string; modelId: string; credentialSourceId: string }>;
  repository: Readonly<{ id: typeof ai044Repository; baseline: typeof ai044Baseline }>;
  archiveSha256: string; allowedPaths: readonly string[]; acceptanceCriteria: readonly string[]; verificationCommands: readonly string[];
  modelSpendLimitCents: number; maximumExposureUsdMicros: number;
}>;
/** Structural preparation facts ONLY. These objects never confer admission/start/financial rights. */
export function normalizeAI044ProofBinding(raw: unknown): AI044ProofBinding | null {
  try {
    const b = exactRecord(captureRoadmapData(raw), ["schemaVersion", "workspaceId", "projectId", "projectTaskId", "planId", "planRevision", "planFingerprint",
      "developmentTaskId", "developmentRunId", "invocationId", "attemptNumber", "executorIdentity", "provider", "repository", "archiveSha256", "allowedPaths",
      "acceptanceCriteria", "verificationCommands", "modelSpendLimitCents", "maximumExposureUsdMicros"]);
    if (b.schemaVersion !== 1 || ![b.workspaceId, b.projectId, b.projectTaskId, b.planId, b.developmentTaskId, b.developmentRunId, b.invocationId].every(ai044Id)
      || !ai044Integer(b.planRevision, 1_000_000) || b.planRevision < 1 || !ai044Integer(b.attemptNumber, 3) || b.attemptNumber < 1
      || !ai044Hash(b.planFingerprint) || !ai044Hash(b.archiveSha256)) return null;
    const e = exactRecord(b.executorIdentity, ["id", "version"]), p = exactRecord(b.provider, ["id", "accountId", "modelId", "credentialSourceId"]), r = exactRecord(b.repository, ["id", "baseline"]);
    if (e.id !== "openai-agents" || e.version !== "v1" || p.id !== "openai" || ![p.accountId, p.modelId, p.credentialSourceId].every(ai044Id)
      || r.id !== ai044Repository || r.baseline !== ai044Baseline) return null;
    if (!Array.isArray(b.allowedPaths) || !b.allowedPaths.length || b.allowedPaths.length > 12
      || b.allowedPaths.some(path => !ai044FeaturePath(path)) || new Set(b.allowedPaths).size !== b.allowedPaths.length) return null;
    if (!Array.isArray(b.acceptanceCriteria) || !b.acceptanceCriteria.length || b.acceptanceCriteria.length > 16 || b.acceptanceCriteria.some(v => !ai044SafeText(v, 1000))) return null;
    if (!Array.isArray(b.verificationCommands) || b.verificationCommands.length !== ai044RequiredVerification.length
      || new Set(b.verificationCommands).size !== b.verificationCommands.length || !ai044RequiredVerification.every(c => (b.verificationCommands as string[]).includes(c))) return null;
    if (!ai044Integer(b.maximumExposureUsdMicros) || b.maximumExposureUsdMicros < 10000 || !ai044Integer(b.modelSpendLimitCents, 100000)
      || b.modelSpendLimitCents < 1 || b.modelSpendLimitCents * 10000 > b.maximumExposureUsdMicros) return null;
    return freezeDeep({ ...b, allowedPaths: [...b.allowedPaths].sort(), verificationCommands: [...ai044RequiredVerification] }) as unknown as AI044ProofBinding;
  } catch { return null; }
}
