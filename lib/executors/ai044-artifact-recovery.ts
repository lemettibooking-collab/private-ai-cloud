import type { AI044ProofBinding } from "./ai044-proof-binding";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeAI044ProofBinding, captureAI044Data, exactAI044Record, freezeAI044, ai044Fingerprint, ai044Sha256, ai044Hash, ai044Id, ai044SafeText, ai044FeaturePath, ai044OutputLimits, ai044ProfileVersion } from "./ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { repositoryPathContains } from "../contracts/development-task-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { validateRetrievedTurn, retrievalUsage } from "./openai-agents-retrieval.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { ai044ArchiveLimits, normalizeAI044HostedConfiguration } from "./ai044-hosted-profile.ts";

const invalid = (): never => { throw new Error("ai044_artifact_unavailable"); };
const record = (raw: unknown, keys: readonly string[]) => exactAI044Record(captureAI044Data(raw), keys);
const safeId = (raw: unknown): string => { if (!ai044Id(raw)) invalid(); return raw as string; };
const safeHash = (raw: unknown): string => { if (!ai044Hash(raw)) invalid(); return raw as string; };
type Identity = Readonly<{ bindingFingerprint: string; profileFingerprint: string; sessionId: string; turnId: string }>;
function identity(raw: unknown, binding: AI044ProofBinding): Identity {
  const i = record(raw, ["bindingFingerprint", "profileFingerprint", "sessionId", "turnId"]);
  if (safeHash(i.bindingFingerprint) !== ai044Fingerprint(binding)) invalid();
  return freezeAI044({ bindingFingerprint: i.bindingFingerprint as string, profileFingerprint: safeHash(i.profileFingerprint), sessionId: safeId(i.sessionId), turnId: safeId(i.turnId) });
}
function permittedPath(path: unknown, binding: AI044ProofBinding): string {
  const p = ai044FeaturePath(path);
  if (!p || !binding.allowedPaths.some(parent => p === parent || (!parent.includes(".") && repositoryPathContains(parent, p)))
    || /(?:^|\/)(?:scanner|alerts|hot|events|market-?pulse)(?:\/|\.|$)/iu.test(p)
    || /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|\.npmrc|\.yarnrc(?:\.yml)?)$/iu.test(p)) invalid();
  return p as string;
}
function utf8Patch(raw: unknown): string {
  if (typeof raw !== "string" || !raw.length || Buffer.byteLength(raw) > ai044OutputLimits.patchBytes
    || Buffer.from(raw, "utf8").toString("utf8") !== raw || !raw.endsWith("\n") || raw.includes("\r")
    || !ai044SafeText(raw, ai044OutputLimits.patchBytes)) invalid();
  return raw as string;
}
/** Strict bounded git unified-text subset. Application against the exact baseline is a later trusted QA gate. */
function parsePatch(patch: string, binding: AI044ProofBinding) {
  const lines = patch.slice(0, -1).split("\n");
  if (lines.length > 12000 || lines.some(line => line.length > 16384)) invalid();
  let cursor = 0, addedLines = 0, removedLines = 0;
  const changedPaths: string[] = [];
  while (cursor < lines.length) {
    const diff = /^diff --git a\/([A-Za-z0-9._/-]+) b\/([A-Za-z0-9._/-]+)$/u.exec(lines[cursor++]);
    if (!diff || diff[1] !== diff[2]) invalid();
    const path = permittedPath(diff![1], binding);
    if (changedPaths.includes(path) || changedPaths.length >= ai044OutputLimits.files) invalid();
    changedPaths.push(path);
    let mode = "modify";
    if (/^(?:new file|deleted file) mode /u.test(lines[cursor] ?? "")) {
      const header = lines[cursor++];
      if (!/^(?:new file|deleted file) mode 100644$/u.test(header)) invalid();
      mode = header.startsWith("new") ? "new" : "delete";
    }
    if (lines[cursor]?.startsWith("index ")) {
      if (!/^index [a-f0-9]{7,40}\.\.[a-f0-9]{7,40}(?: 100644)?$/u.test(lines[cursor++])) invalid();
    }
    if (lines[cursor++] !== (mode === "new" ? "--- /dev/null" : `--- a/${path}`)
      || lines[cursor++] !== (mode === "delete" ? "+++ /dev/null" : `+++ b/${path}`)) invalid();
    let hunks = 0, oldEnd = -1, newEnd = -1, fileChanges = 0;
    while (cursor < lines.length && !lines[cursor].startsWith("diff --git ")) {
      const hunk = /^@@ -(\d{1,7})(?:,(\d{1,7}))? \+(\d{1,7})(?:,(\d{1,7}))? @@(?: .*)?$/u.exec(lines[cursor++]);
      if (!hunk || ++hunks > 256) invalid();
      const oldStart = Number(hunk![1]), oldCount = Number(hunk![2] ?? 1), newStart = Number(hunk![3]), newCount = Number(hunk![4] ?? 1);
      if (oldCount > 12000 || newCount > 12000 || oldStart < oldEnd || newStart < newEnd
        || (mode === "new" && (oldStart !== 0 || oldCount !== 0)) || (mode === "delete" && (newStart !== 0 || newCount !== 0))) invalid();
      oldEnd = oldStart + oldCount; newEnd = newStart + newCount;
      let oldSeen = 0, newSeen = 0, previousBody = false;
      while (cursor < lines.length && !lines[cursor].startsWith("@@ ") && !lines[cursor].startsWith("diff --git ")) {
        const line = lines[cursor++];
        if (line === "\\ No newline at end of file") { if (!previousBody) invalid(); previousBody = false; continue; }
        previousBody = true;
        if (line.startsWith(" ")) { oldSeen++; newSeen++; }
        else if (line.startsWith("+")) { addedLines++; newSeen++; fileChanges++; }
        else if (line.startsWith("-")) { removedLines++; oldSeen++; fileChanges++; }
        else invalid();
        if (oldSeen > oldCount || newSeen > newCount || addedLines + removedLines > ai044OutputLimits.changedLines) invalid();
      }
      if (oldSeen !== oldCount || newSeen !== newCount) invalid();
    }
    if (!hunks || !fileChanges) invalid();
  }
  if (!changedPaths.length) invalid();
  return { changedPaths: changedPaths.sort(), addedLines, removedLines, fileCount: changedPaths.length };
}
export type AI044Artifact = Readonly<Identity & { patch: string; patchSha256: string; changedPaths: readonly string[]; addedLines: number; removedLines: number; fileCount: number; manifestFingerprint: string }>;
export type AI044ArtifactDecision = Readonly<{ verdict: "allow" | "deny"; reason: "validated_artifact" | "artifact_unavailable"; artifact: AI044Artifact | null }>;
/** Remote verification claims are retained only as attempted commands, never as trusted QA. No filesystem/HTTP/application. */
export function ingestAI044Artifacts(bindingInput: unknown, manifestInput: unknown, patchInput: unknown, identityInput: unknown): AI044ArtifactDecision {
  try {
    const binding = normalizeAI044ProofBinding(bindingInput); if (!binding) invalid();
    const link = identity(identityInput, binding!), patch = utf8Patch(patchInput), facts = parsePatch(patch, binding!);
    const m = record(manifestInput, ["schemaVersion", "featureId", "repositoryId", "baseline", "archiveSha256", "bindingFingerprint", "profileFingerprint", "sessionId", "turnId", "patchSha256", "changedPaths", "addedLines", "removedLines", "verificationCommandsAttempted"]);
    if (Buffer.byteLength(JSON.stringify(m)) > ai044OutputLimits.manifestBytes || m.schemaVersion !== 1 || m.featureId !== "portfolio-analytics-v1"
      || m.repositoryId !== binding!.repository.id || m.baseline !== binding!.repository.baseline || m.archiveSha256 !== binding!.archiveSha256
      || Object.entries(link).some(([key, value]) => m[key] !== value) || m.patchSha256 !== ai044Sha256(patch)
      || m.addedLines !== facts.addedLines || m.removedLines !== facts.removedLines || !Array.isArray(m.changedPaths)
      || m.changedPaths.length !== facts.changedPaths.length || new Set(m.changedPaths).size !== m.changedPaths.length
      || [...m.changedPaths].sort().some((path, index) => path !== facts.changedPaths[index])
      || !Array.isArray(m.verificationCommandsAttempted) || m.verificationCommandsAttempted.length > binding!.verificationCommands.length
      || new Set(m.verificationCommandsAttempted).size !== m.verificationCommandsAttempted.length
      || m.verificationCommandsAttempted.some(command => !binding!.verificationCommands.includes(command))) invalid();
    return freezeAI044({ verdict: "allow", reason: "validated_artifact", artifact: { ...link, ...facts, patch, patchSha256: ai044Sha256(patch), manifestFingerprint: ai044Fingerprint(m) } });
  } catch { return freezeAI044({ verdict: "deny", reason: "artifact_unavailable", artifact: null }); }
}

export type AI044RecoveryDecision = Readonly<{ status: "recovery_required" | "terminal"; reason: "create_outcome_unknown" | "retrieval_unavailable" | "nonterminal" | "terminal_completed" | "terminal_failed" | "terminal_cancelled";
  terminal: Readonly<{ sessionId: string; turnId: string; status: "completed" | "failed" | "cancelled" }> | null; retainExposure: true; automaticRetryAllowed: false; dispatchAuthorized: false; runtimeDispatchAllowed: false }>;
/** Descriptors ONLY: no fetch, token resolver, client, Create/list/search fallback or cleanup execution exists. */
export function planAI044RecoveryRetrieval(raw: unknown) {
  try {
    const r = record(raw, ["sessionId", "turnId", "createMayHaveTransmitted"]);
    if (typeof r.createMayHaveTransmitted !== "boolean") invalid();
    if (r.sessionId === null) return freezeAI044({ status: "recovery_required" as const, reason: "create_outcome_unknown" as const, requests: [], redispatchAllowed: false as const });
    const session = safeId(r.sessionId), turn = safeId(r.turnId);
    return freezeAI044({ status: "retrieval_only" as const, reason: "known_identity" as const,
      requests: [{ method: "GET" as const, path: `/v1/agents/sessions/${encodeURIComponent(session)}` },
        { method: "GET" as const, path: `/v1/agents/sessions/${encodeURIComponent(session)}/turns/${encodeURIComponent(turn)}` }], redispatchAllowed: false as const });
  } catch { return freezeAI044({ status: "recovery_required" as const, reason: "retrieval_unavailable" as const, requests: [], redispatchAllowed: false as const }); }
}
/** PAC descriptor contract, NOT a provider response schema or an authenticated downloader. */
export function planAI044ArtifactRetrieval(bindingInput: unknown, identityInput: unknown, resourcesInput: unknown) {
  try {
    const binding = normalizeAI044ProofBinding(bindingInput); if (!binding) invalid();
    const link = identity(identityInput, binding!), resources = captureAI044Data(resourcesInput);
    if (!Array.isArray(resources) || resources.length !== 2) invalid();
    const names = new Set<string>(), ids = new Set<string>();
    const requests = (resources as unknown[]).map(input => {
      const resource = exactAI044Record(input, ["artifactId", "sessionId", "turnId", "outputPath", "sizeBytes", "sha256"]);
      const artifactId = safeId(resource.artifactId), outputPath = resource.outputPath;
      if (resource.sessionId !== link.sessionId || resource.turnId !== link.turnId || !["/workspace/outputs/feature.patch", "/workspace/outputs/manifest.json"].includes(outputPath as string)
        || ids.has(artifactId) || names.has(outputPath as string) || !Number.isSafeInteger(resource.sizeBytes) || (resource.sizeBytes as number) < 1
        || (resource.sizeBytes as number) > (outputPath === "/workspace/outputs/feature.patch" ? ai044OutputLimits.patchBytes : ai044OutputLimits.manifestBytes)) invalid();
      ids.add(artifactId); names.add(outputPath as string); safeHash(resource.sha256);
      return { method: "GET" as const, path: `/v1/agents/sessions/${encodeURIComponent(link.sessionId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
        outputPath: outputPath as string, maximumBytes: resource.sizeBytes as number, expectedSha256: resource.sha256 as string };
    }).sort((a, b) => a.outputPath < b.outputPath ? -1 : 1);
    return freezeAI044({ verdict: "allow" as const, requests, dispatchAuthorized: false as const, runtimeDispatchAllowed: false as const });
  } catch { return freezeAI044({ verdict: "deny" as const, requests: [], dispatchAuthorized: false as const, runtimeDispatchAllowed: false as const }); }
}
function hostedConfiguration(s: Record<string, unknown>, expected: Record<string, unknown>, binding: AI044ProofBinding) {
  const agentConfig = exactAI044Record(expected.agentConfig, ["model", "instructions", "multi_agent", "tools", "text"]);
  const environmentConfig = exactAI044Record(expected.environmentConfig, ["type", "container_size", "files", "packages", "env", "network", "setup_commands", "skills", "plugins", "capability_directories", "desktop"]);
  if (ai044Fingerprint(agentConfig) !== expected.agentFingerprint || ai044Fingerprint(environmentConfig) !== expected.environmentFingerprint) invalid();
  if (!Array.isArray(environmentConfig.files) || environmentConfig.files.length !== 1) invalid();
  const inputFile = exactAI044Record((environmentConfig.files as unknown[])[0], ["type", "file_id", "path"]);
  const canonical = normalizeAI044HostedConfiguration(binding, inputFile.file_id);
  if (!canonical || ai044Fingerprint(canonical.agent) !== expected.agentFingerprint || ai044Fingerprint(canonical.environment) !== expected.environmentFingerprint) invalid();
  const agent = exactAI044Record(s.agent, ["id", "model", "instructions", "multi_agent", "tools", "text", "name", "reasoning", "service_tier"]);
  const multi = exactAI044Record(agent.multi_agent, ["enabled", "max_concurrent_subagents"]);
  const reasoning = exactAI044Record(agent.reasoning, ["effort", "summary"]);
  const projectedAgent = { model: agent.model, instructions: agent.instructions, multi_agent: { enabled: multi.enabled }, tools: agent.tools, text: agent.text };
  if (agent.id !== expected.agentId || agent.model !== binding.provider.modelId || multi.enabled !== false || multi.max_concurrent_subagents !== null
    || agent.name !== null || reasoning.effort !== null || reasoning.summary !== null || agent.service_tier !== "auto"
    || !Array.isArray(agent.tools) || agent.tools.length || ai044Fingerprint(projectedAgent) !== expected.agentFingerprint) invalid();
  const e = exactAI044Record(s.environment, ["id", "type", "container_size", "files", "packages", "network", "skills", "plugins", "capability_directories", "desktop"]);
  safeId(e.id);
  if (e.type !== "openai_hosted" || e.container_size !== "medium" || exactAI044Record(e.desktop, ["enabled"]).enabled !== false) invalid();
  const network = exactAI044Record(e.network, ["access", "allowed_domains"]), packages = exactAI044Record(e.packages, ["npm", "python", "system"]);
  if (network.access !== "restricted" || !Array.isArray(network.allowed_domains) || network.allowed_domains.length !== 1 || network.allowed_domains[0] !== "registry.npmjs.org"
    || Object.values(packages).some(values => !Array.isArray(values) || values.length) || Object.keys(exactAI044Record(environmentConfig.env, [])).length
    || !Array.isArray(e.skills) || e.skills.length || !Array.isArray(e.plugins) || e.plugins.length || !Array.isArray(e.capability_directories) || e.capability_directories.length) invalid();
  if (!Array.isArray(e.files) || e.files.length !== 1 || !Array.isArray(environmentConfig.files) || environmentConfig.files.length !== 1) invalid();
  const file = exactAI044Record((e.files as unknown[])[0], ["id", "type", "file_id", "path", "size_bytes"]);
  safeId(file.id); safeId(file.file_id);
  if (file.type !== "file_id" || file.path !== "/workspace/repository.tar" || !Number.isSafeInteger(file.size_bytes) || (file.size_bytes as number) < 1536 || (file.size_bytes as number) > ai044ArchiveLimits.bytes) invalid();
  const projectedEnvironment = { type: e.type, container_size: e.container_size, network: e.network, packages: e.packages, skills: e.skills, plugins: e.plugins,
    capability_directories: e.capability_directories, desktop: e.desktop, files: [{ type: file.type, file_id: file.file_id, path: file.path }], env: environmentConfig.env, setup_commands: environmentConfig.setup_commands };
  // Confidential setup/env are NOT echoed by GET. Their binding is persisted request evidence, not a provider attestation.
  // This projection cannot authorize settlement/start or prove remote quiescence; exposure is retained below.
  if (ai044Fingerprint(projectedEnvironment) !== expected.environmentFingerprint) invalid();
}
/** Retrieval evidence is an already-fetched bounded snapshot; it grants neither settlement nor a new start right. */
export function reconcileAI044HostedEvidence(bindingInput: unknown, expectedInput: unknown, raw: unknown): AI044RecoveryDecision {
  const deny = (reason: AI044RecoveryDecision["reason"]): AI044RecoveryDecision => freezeAI044({ status: "recovery_required", reason, terminal: null, retainExposure: true, automaticRetryAllowed: false, dispatchAuthorized: false, runtimeDispatchAllowed: false });
  try {
    const binding = normalizeAI044ProofBinding(bindingInput); if (!binding) invalid();
    const expected = record(expectedInput, ["bindingFingerprint", "profileFingerprint", "sessionId", "turnId", "agentId", "agentFingerprint", "environmentFingerprint", "agentConfig", "environmentConfig"]);
    const link = identity({ bindingFingerprint: expected.bindingFingerprint, profileFingerprint: expected.profileFingerprint, sessionId: expected.sessionId, turnId: expected.turnId }, binding!);
    safeId(expected.agentId); safeHash(expected.agentFingerprint); safeHash(expected.environmentFingerprint);
    const evidence = record(raw, ["accountId", "modelId", "profileFingerprint", "session", "turn", "artifactsDurable", "cleanupStatus"]);
    if (evidence.accountId !== binding!.provider.accountId || evidence.modelId !== binding!.provider.modelId || evidence.profileFingerprint !== link.profileFingerprint
      || evidence.artifactsDurable !== true || !["not_attempted", "pending", "complete", "failed"].includes(evidence.cleanupStatus as string)) invalid();
    const s = exactAI044Record(evidence.session, ["id", "object", "agent", "environment", "error", "status", "required_actions", "vault_ids", "usage", "created_at", "last_active_at", "metadata", "spend_control"]);
    if (s.id !== link.sessionId || s.object !== "agent.session" || !["idle", "in_progress", "requires_action", "failed"].includes(s.status as string)
      || (s.status !== "failed" && s.error !== null) || (s.error !== null && (typeof s.error !== "string" || s.error.length > 4096))
      || !Array.isArray(s.required_actions) || s.required_actions.length || !Array.isArray(s.vault_ids) || s.vault_ids.length) invalid();
    hostedConfiguration(s, expected, binding!);
    const metadata = exactAI044Record(s.metadata, ["pac_profile", "pac_binding"]);
    if (metadata.pac_profile !== ai044ProfileVersion || metadata.pac_binding !== link.bindingFingerprint) invalid();
    const spend = exactAI044Record(s.spend_control, ["limit", "consumed"]);
    if (spend.limit !== binding!.modelSpendLimitCents || !(spend.consumed === null || (Number.isSafeInteger(spend.consumed) && (spend.consumed as number) >= 0 && (spend.consumed as number) <= binding!.modelSpendLimitCents))) invalid();
    if (!Number.isSafeInteger(s.created_at) || (s.created_at as number) < 0 || !Number.isSafeInteger(s.last_active_at) || (s.last_active_at as number) < (s.created_at as number)
      || (s.last_active_at as number) > 1_000_000_000_000_000) invalid();
    retrievalUsage(s.usage);
    const turn = validateRetrievedTurn(evidence.turn as Record<string, unknown>, link.sessionId, expected.agentId as string, link.turnId);
    if (!["completed", "failed", "cancelled"].includes(turn.status)) return deny("nonterminal");
    if (!["idle", "failed"].includes(s.status as string) || (s.status === "failed" && turn.status !== "failed")) invalid();
    return freezeAI044({ status: "terminal", reason: `terminal_${turn.status}` as AI044RecoveryDecision["reason"],
      terminal: { sessionId: link.sessionId, turnId: link.turnId, status: turn.status as "completed" | "failed" | "cancelled" },
      retainExposure: true, automaticRetryAllowed: false, dispatchAuthorized: false, runtimeDispatchAllowed: false });
  } catch { return deny("retrieval_unavailable"); }
}
