import type { NormalizedExecutorInvocation } from "../contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { defineTrustedExecutorProviderRequestPolicy } from "./executor-provider-request.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { deriveExecutorProviderCorrelation, validExecutorProviderId } from "./executor-provider-identity.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, ensureSafeEvidence, freezeDeep, safeRepositoryPath, sha256, compare } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { repositoryPathContains, isSystemForbiddenRepositoryPath } from "../contracts/development-task-policy.ts";

export const claudeExecutorIdentity = Object.freeze({ id: "claude-managed-agents", version: "v1" });
export function claudeInvalid(): never { throw Error("claude_fake_evidence_unavailable"); }
export function claudeSafe(text: string): void {
  ensureSafeEvidence(text);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)
    || /\b(?:authorization\s*:\s*(?:bearer|basic)|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[:=])/iu.test(text)) claudeInvalid();
}
const digest = (x: unknown): string => { if (typeof x !== "string" || !/^[a-f0-9]{64}$/u.test(x)) claudeInvalid(); return x; };
const id = (x: unknown): string => { if (!validExecutorProviderId(x)) claudeInvalid(); return x; };
/** Bounded explicit trusted configuration; not an Anthropic API or live-pinning claim. */
export function normalizeClaudeProfile(input: unknown) {
  const r = exactRecord(boundedData(input), ["providerId", "modelId", "accountId", "workspaceMappingDigest", "agent", "environment", "repository",
    "contextManifestFingerprint", "toolProfile", "networkProfile", "secretsProfile", "runtimeProfile", "apiProfile", "outputSchema", "maximumExposureUsdMicros"]);
  const a = exactRecord(r.agent, ["id", "version", "configurationDigest"]), e = exactRecord(r.environment, ["id", "configurationDigest"]), repo = exactRecord(r.repository, ["id", "baseline"]);
  if (r.providerId !== "anthropic" || r.toolProfile !== "tools_off" || r.networkProfile !== "network_off" || r.secretsProfile !== "no_secrets"
    || r.runtimeProfile !== "provider_hosted_fake" || r.apiProfile !== "claude-managed-fake-v1" || r.outputSchema !== "pac-proposal-v1"
    || !Number.isSafeInteger(a.version) || (a.version as number) < 1 || (a.version as number) > 1000000
    || typeof repo.baseline !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(repo.baseline)
    || !Number.isSafeInteger(r.maximumExposureUsdMicros) || (r.maximumExposureUsdMicros as number) < 10000 || (r.maximumExposureUsdMicros as number) > 1000000000) claudeInvalid();
  const result = { providerId: "anthropic" as const, modelId: id(r.modelId), accountId: id(r.accountId), workspaceMappingDigest: digest(r.workspaceMappingDigest),
    agent: { id: id(a.id), version: a.version as number, configurationDigest: digest(a.configurationDigest) },
    environment: { id: id(e.id), configurationDigest: digest(e.configurationDigest) }, repository: { id: id(repo.id), baseline: repo.baseline },
    contextManifestFingerprint: digest(r.contextManifestFingerprint), toolProfile: "tools_off", networkProfile: "network_off", secretsProfile: "no_secrets",
    runtimeProfile: "provider_hosted_fake", apiProfile: "claude-managed-fake-v1", outputSchema: "pac-proposal-v1", maximumExposureUsdMicros: r.maximumExposureUsdMicros as number };
  claudeSafe(JSON.stringify(result)); return freezeDeep(result);
}
export type ClaudeProfile = ReturnType<typeof normalizeClaudeProfile>;
export function claudeContext(input: unknown, invocation: NormalizedExecutorInvocation) {
  const c = exactRecord(boundedData(input), ["files"]);
  if (!Array.isArray(c.files) || c.files.length > 8) claudeInvalid();
  const seen = new Set<string>(); let bytes = 0;
  const files = c.files.map(value => {
    const f = exactRecord(value, ["path", "content"]), path = safeRepositoryPath(f.path);
    if (seen.has(path) || isSystemForbiddenRepositoryPath(path) || !invocation.allowedPaths.some(p => repositoryPathContains(p, path))
      || typeof f.content !== "string" || Buffer.byteLength(f.content) > 8192) claudeInvalid();
    seen.add(path); bytes += Buffer.byteLength(f.content); if (bytes > 32768) claudeInvalid(); claudeSafe(f.content);
    return { path, content: f.content };
  }).sort((a, b) => compare(a.path, b.path));
  const manifest = files.map(f => ({ path: f.path, bytes: Buffer.byteLength(f.content), sha256: sha256(f.content) }));
  return freezeDeep({ files, manifestFingerprint: sha256(JSON.stringify(manifest)) });
}
export function createClaudeManagedRequestPolicy(profileInput: unknown) {
  const profile = normalizeClaudeProfile(profileInput), configDigest = sha256(JSON.stringify(profile));
  return defineTrustedExecutorProviderRequestPolicy("anthropic", (i, contextInput, target, amount, workspace) => {
    if (target.providerId !== "anthropic" || target.modelId !== profile.modelId || target.accountId !== profile.accountId
      || i.identity.id !== claudeExecutorIdentity.id || i.identity.version !== claudeExecutorIdentity.version
      || i.repository.id !== profile.repository.id || i.repository.baseline !== profile.repository.baseline || amount > profile.maximumExposureUsdMicros) claudeInvalid();
    const context = claudeContext(contextInput, i); if (context.manifestFingerprint !== profile.contextManifestFingerprint) claudeInvalid();
    const input = JSON.stringify({ invocationId: i.invocationId, identity: i.identity, planId: i.planId, taskId: i.taskId, repository: i.repository,
      attempt: i.attempt, capability: i.capability, mode: i.mode, task: i.task, allowedPaths: i.allowedPaths, context: { files: context.files } });
    const base = { profile: profile.apiProfile, agent: profile.agent, environment: profile.environment, model: target.modelId,
      tools: [], skills: [], mcp_servers: [], initial_events: [{ type: "user.message", content: input }],
      configuration: profile, budget: { pacExposureUsdMicros: amount, providerDefense: "list_cost_observation_only" },
      metadata: { pac_configuration: configDigest } };
    const baseBody = JSON.stringify(base), baseRequestFingerprint = sha256(baseBody);
    const correlationFingerprint = deriveExecutorProviderCorrelation({ workspaceIdentity: workspace, developmentRunId: i.attempt.developmentRunId,
      attemptNumber: i.attempt.number, requestFingerprint: baseRequestFingerprint, ...target, executorIdentity: i.identity });
    if (!correlationFingerprint) claudeInvalid();
    const body = JSON.stringify({ ...base, metadata: { ...base.metadata, pac_execution: correlationFingerprint } });
    if (Buffer.byteLength(body) > 65536) claudeInvalid(); claudeSafe(body);
    return { providerId: "anthropic", target, body, baseBody, baseRequestFingerprint, correlationFingerprint, requestFingerprint: sha256(body),
      providerBudgetDefenseEvidence: { limitCents: Math.floor(amount / 10000), enforcement: "provider_defense_only", inFlightOverrunPossible: true } };
  });
}
