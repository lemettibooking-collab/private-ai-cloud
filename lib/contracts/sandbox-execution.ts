import { isDeepStrictEqual } from "node:util";
import { BlockList, isIP } from "node:net"; // Pure address parsing/classification; no socket or DNS operation.
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { boundedData, exactRecord, freezeDeep, sha256, safeRepositoryPath, parseVerificationCommand, findProbableSecrets, compare } from "../local-handoff/local-handoff-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isSystemForbiddenRepositoryPath, repositoryPathContains, systemForbiddenRepositoryPathPolicies } from "./development-task-policy.ts";

export const sandboxForbiddenActions = Object.freeze(["protected_branch_mutation", "merge", "force_push", "push", "tag", "release", "deploy",
  "git_credentials_mutation", "remote_mutation", "host_git_config_mutation", "live_trading", "financial_actions", "privilege_expansion"] as const);
export const sandboxProtectedZones = Object.freeze(["host_home", "global_filesystem", "other_repositories", "ssh_keys", "credential_stores", "production_secrets", "deployment_credentials"] as const);
export const sandboxExecutionPlatformLimits = Object.freeze({ wallClockMs: 3600000, cpuMillis: 8000, memoryMiB: 16384, diskMiB: 32768,
  commandMs: 120000, outputBytes: 8 * 1024 * 1024, artifactBytes: 8 * 1024 * 1024, maxFiles: 64, maxPathRules: 32, maxCommands: 16, maxEvents: 64, maxCleanupAttempts: 3 });
export const sandboxNetworkContractV1 = Object.freeze({ version: 1, scheme: "https", transport: "tcp_tls", redirects: "deny",
  ipLiterals: "deny", dns: "all_answers_public", connectedPeer: "validated_answer", rebinding: "deny", tls: "hostname_verified",
  additionalPlatformPolicyRequired: true, enforcement: "not_implemented" } as const);
/** These are requirements/proposals, NOT an OS sandbox, durable store, lease service or dispatch capability. */
export const sandboxExecutionCapabilities = Object.freeze({ runtimeEnforcement: "not_implemented", durableStore: "not_implemented",
  physicalCleanup: "not_implemented", networkEnforcement: "not_implemented", resourceEnforcement: "not_implemented", runtimeDispatchAllowed: false } as const);

export type SandboxState = "requested" | "admitted" | "preparing" | "ready" | "running" | "completed" | "failed" | "cancelled" | "blocked";
export type SandboxFailureCategory = "execution_failed" | "verification_failed" | "timeout" | "outcome_unknown" | "policy_blocked" | "crashed" | "cancelled";
export type SandboxResources = Readonly<{ wallClockMs: number; cpuMillis: number; memoryMiB: number; diskMiB: number; commandMs: number; outputBytes: number }>;
export type SandboxNetworkDestination = Readonly<{ scheme: "https"; hostname: string; port: number }>;
export type SandboxNetwork = Readonly<{ mode: "deny_all" | "allowlisted"; destinations: readonly SandboxNetworkDestination[] }>;
export type SandboxCommand = Readonly<{ id: string; executable: "npm" | "node" | "git"; args: readonly string[]; cwd: string;
  environment: Readonly<Record<string, string>>; timeoutMs: number; maxOutputBytes: number }>;
export type SandboxArtifactRef = Readonly<{ id: string; sha256: string; sizeBytes: number }>;
export type SandboxExecutionSpec = Readonly<{
  schemaVersion: 1; executionId: string; workspaceId: string; projectId: string;
  repository: Readonly<{ id: string; baseline: string }>; checkout: Readonly<{ branch: string; worktreeId: string; resourceGeneration: number }>;
  mode: "patch_proposal" | "analysis_only";
  filesystem: Readonly<{ readablePaths: readonly string[]; writablePaths: readonly string[]; forbiddenPaths: readonly string[]; hostAccess: "denied" }>;
  commands: readonly SandboxCommand[]; forbiddenActions: readonly string[]; network: SandboxNetwork;
  secrets: Readonly<{ mode: "none" | "ephemeral"; refs: readonly string[]; inheritEnvironment: false }>;
  resources: SandboxResources;
  artifacts: Readonly<{ maxFiles: number; maxBytes: number; maxLogBytes: number; requiredCommandIds: readonly string[] }>;
  cleanup: Readonly<{ mode: "always"; retainArtifacts: true }>;
  policyRef: string; policyRevision: number; approvalRef: string;
}>;
/** Trusted, already-resolved policy/registry facts. Never expose this factory as caller configuration. */
export type SandboxExecutionConfiguration = Readonly<{
  workspaceId: string;
  projects: readonly Readonly<{ projectId: string; repositoryId: string; baselines: readonly string[]; protectedBranches: readonly string[] }>[];
  grants: readonly Readonly<{ executionId: string; projectId: string; policyRef: string; approvalRef: string; policyRevision: number; resourceGeneration: number }>[];
  policy: Readonly<{ id: string; revision: number; branchPrefix: string; readablePaths: readonly string[]; writablePaths: readonly string[]; forbiddenPaths: readonly string[];
    commands: readonly SandboxCommand[]; network: SandboxNetwork; resources: SandboxResources;
    ephemeralSecrets: readonly Readonly<{ ref: string; executionId: string; expiresAt: number }>[] }>;
}>;
/** Current trusted orchestration facts, not self-attested execution authority. No public/DB adapter is wired. */
export type SandboxAuthority = Readonly<{ workspaceId: string; executionId: string; projectId: string; generation: number;
  actorId: string; active: boolean; now: number; expiresAt: number }>;
/** Separately trusted CURRENT resource ownership facts. No execution permissions, network, file or secret grants. */
export type SandboxCleanupAuthority = Readonly<{ workspaceId: string; executionId: string; projectId: string; generation: number;
  actorId: string; now: number; expiresAt: number; worktreeId: string; resourceGeneration: number; specFingerprint: string }>;
type EventAuthority = SandboxAuthority | SandboxCleanupAuthority;
export type SandboxResult = Readonly<{ changedPaths: readonly string[]; diff: SandboxArtifactRef | null; report: SandboxArtifactRef }>;
export type SandboxAction = Readonly<
  { type: "admit" } | { type: "claim" } | { type: "prepare" } | { type: "start" } | { type: "cancel" } | { type: "begin_cleanup" }
  | { type: "ready"; evidence: SandboxArtifactRef }
  | { type: "start_command"; requestId: string; commandPolicyId: string }
  | { type: "finish_command"; requestId: string; outcome: "passed" | "failed" | "timed_out" | "outcome_unknown";
    exitCode: number | null; stdout: SandboxArtifactRef | null; stderr: SandboxArtifactRef | null }
  | { type: "complete"; result: SandboxResult }
  | { type: "fail" | "block"; failureCategory: SandboxFailureCategory }
  | { type: "finish_cleanup"; worktreeId: string; outcome: "completed" | "failed" }>;
export type SandboxExecutionEvent = Readonly<{ commandId: string; expectedRevision: number | null; fence: number; authority: EventAuthority;
  action: SandboxAction | Readonly<{ type: "request" }>; requestFingerprint: string; kind: string; state: SandboxState }>;
export type SandboxCommandRecord = Readonly<{ requestId: string; commandPolicyId: string; startedAt: number; endedAt: number | null;
  outcome: "running" | "passed" | "failed" | "timed_out" | "outcome_unknown"; exitCode: number | null;
  stdout: SandboxArtifactRef | null; stderr: SandboxArtifactRef | null }>;
export type SandboxExecutionSnapshot = Readonly<{
  schemaVersion: 1; spec: SandboxExecutionSpec; specFingerprint: string; revision: number; authorityGeneration: number; state: SandboxState; fence: number;
  owner: Readonly<{ workerId: string; expiresAt: number }> | null;
  createdAt: number; updatedAt: number; startedAt: number | null; endedAt: number | null;
  admission: "pending" | "allowed"; failureCategory: SandboxFailureCategory | null; result: SandboxResult | null;
  commands: readonly SandboxCommandRecord[];
  cleanup: Readonly<{ status: "not_started" | "running" | "completed" | "failed"; attempts: number; startedAt: number | null; endedAt: number | null }>;
  events: readonly SandboxExecutionEvent[];
}>;
export type SandboxReason = "invalid_configuration" | "invalid_spec" | "invalid_authority" | "identity_conflict" | "scope_denied" | "command_denied"
  | "network_denied" | "secret_denied" | "limit_exceeded" | "stale_authority" | "stale_revision" | "stale_fence" | "invalid_transition"
  | "invalid_snapshot" | "invalid_artifact" | "verification_required" | "event_limit_exceeded";
export type SandboxDecision = Readonly<{
  verdict: "allow" | "deny"; status: "created" | "recorded" | "idempotent" | "denied"; reason: SandboxReason | null;
  snapshot: SandboxExecutionSnapshot | null; normalizedCommand: SandboxCommand | null;
  writeCondition: Readonly<{ workspaceId: string; executionId: string; resourceGeneration: number; expectedRevision: number | null; expectedFingerprint: string | null }> | null;
  newEvents: readonly SandboxExecutionEvent[]; auditEvidence: Readonly<{ kind: string; reason: SandboxReason | null }>;
  authorityScope: "execution_contract" | "cleanup_only" | "policy_only" | null;
  runtimeDispatchAllowed: false;
}>;
class InvalidSandbox extends Error { readonly reason: SandboxReason; constructor(reason: SandboxReason) { super(reason); this.reason = reason; } }
function fail(reason: SandboxReason): never { throw new InvalidSandbox(reason); }
function requireFact(condition: unknown, reason: SandboxReason = "invalid_spec"): asserts condition { if (!condition) fail(reason); }
const rec = exactRecord;
const terminal = (state: SandboxState) => ["completed", "failed", "cancelled", "blocked"].includes(state);
function number(value: unknown, max: number, min = 1): number { requireFact(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max, "limit_exceeded"); return value; }
function id(value: unknown): string {
  requireFact(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value));
  requireFact(!findProbableSecrets(value).length); return value;
}
function list<T>(value: unknown, parse: (x: unknown) => T, min = 0, max = 32): T[] {
  requireFact(Array.isArray(value) && value.length >= min && value.length <= max, "limit_exceeded"); return value.map(parse);
}
function unique<T>(values: T[], key: (v: T) => string): T[] {
  requireFact(new Set(values.map(key)).size === values.length); return [...values].sort((a, b) => compare(key(a), key(b)));
}
function ids(value: unknown, min = 0) { return unique(list(value, id, min), x => x); }
function path(value: unknown): string {
  const p = safeRepositoryPath(value); requireFact(value === p, "scope_denied"); return p;
}
function protectedPath(p: string): boolean {
  return isSystemForbiddenRepositoryPath(p) || p.split("/").some(segment => systemForbiddenRepositoryPathPolicies.some(protectedSegment => segment === protectedSegment))
    || /(?:^|\/)(?:\.ssh|\.gnupg|\.aws|\.codex|\.config|id_rsa|id_ed25519)(?:\/|$)/u.test(p);
}
const overlaps = (a: string, b: string) => repositoryPathContains(a, b) || repositoryPathContains(b, a);
const within = (p: string, parents: readonly string[]) => parents.some(parent => repositoryPathContains(parent, p));
function paths(value: unknown, max: number = sandboxExecutionPlatformLimits.maxPathRules) { return unique(list(value, path, 0, max), x => x); }
/** Sorting only a bounded descriptor snapshot, never arbitrary unknown recursion. */
function digest(input: unknown): string {
  const snapshot = boundedData(input);
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => compare(a, b)).map(([k, x]) => [k, sort(x)])) : v;
  return sha256(JSON.stringify(sort(snapshot)));
}
function resources(input: unknown): SandboxResources {
  const r = rec(input, ["wallClockMs", "cpuMillis", "memoryMiB", "diskMiB", "commandMs", "outputBytes"]);
  const result = Object.fromEntries(Object.keys(r).map(key => [key, number(r[key], sandboxExecutionPlatformLimits[key as keyof SandboxResources])])) as SandboxResources;
  requireFact(result.commandMs <= result.wallClockMs); return result;
}
function destination(input: unknown): SandboxNetworkDestination {
  const d = rec(input, input && typeof input === "object" && Object.hasOwn(input, "port") ? ["scheme", "hostname", "port"] : ["scheme", "hostname"]);
  requireFact(d.scheme === "https" && typeof d.hostname === "string" && d.hostname.length <= 254, "network_denied");
  const hostname = d.hostname.toLowerCase().replace(/\.$/u, "");
  requireFact(hostname.length <= 253 && !isIP(hostname) && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(hostname), "network_denied");
  return { scheme: "https", hostname, port: Object.hasOwn(d, "port") ? number(d.port, 65535) : 443 };
}
function network(input: unknown): SandboxNetwork {
  const n = rec(input, ["mode", "destinations"]);
  requireFact(n.mode === "deny_all" || n.mode === "allowlisted", "network_denied");
  const destinations = unique(list(n.destinations, destination), d => `${d.scheme}://${d.hostname}:${d.port}`);
  requireFact(n.mode === "deny_all" ? !destinations.length : destinations.length > 0, "network_denied");
  return { mode: n.mode, destinations };
}
// Conservative public-address subset. Broader exceptions require a separately versioned contract.
const forbiddenPeers = new BlockList(), publicIPv6 = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) forbiddenPeers.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) forbiddenPeers.addSubnet(address, prefix, "ipv6");
forbiddenPeers.addAddress("168.63.129.16", "ipv4"); // Platform service address, not a public egress destination.
publicIPv6.addSubnet("2000::", 3, "ipv6");
function publicPeer(input: unknown): string {
  requireFact(typeof input === "string" && input.length <= 45 && !input.includes("%"), "network_denied");
  const family = isIP(input); requireFact(family !== 0, "network_denied");
  const type = family === 4 ? "ipv4" : "ipv6";
  requireFact(!forbiddenPeers.check(input, type) && (family === 4 || publicIPv6.check(input, "ipv6")), "network_denied");
  return family === 4 ? input : new URL(`http://[${input}]/`).hostname.slice(1, -1);
}
function command(input: unknown): SandboxCommand {
  const c = rec(input, ["id", "executable", "args", "cwd", "environment", "timeoutMs", "maxOutputBytes"]);
  requireFact(typeof c.executable === "string" && ["npm", "node", "git"].includes(c.executable), "command_denied");
  const args = list(c.args, v => { requireFact(typeof v === "string" && /^[A-Za-z0-9._/:-]{1,256}$/u.test(v), "command_denied"); return v; }, 1);
  const parsed = parseVerificationCommand(`${c.executable} ${args.join(" ")}`);
  requireFact(parsed && parsed.executable === c.executable && isDeepStrictEqual(parsed.args, args), "command_denied");
  requireFact(c.environment && typeof c.environment === "object" && !Array.isArray(c.environment), "command_denied");
  const environment: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.environment)) {
    requireFact((k === "CI" && v === "1") || (k === "NODE_ENV" && v === "test"), "command_denied"); environment[k] = v;
  }
  return { id: id(c.id), executable: c.executable as SandboxCommand["executable"], args, cwd: path(c.cwd), environment,
    timeoutMs: number(c.timeoutMs, sandboxExecutionPlatformLimits.commandMs), maxOutputBytes: number(c.maxOutputBytes, sandboxExecutionPlatformLimits.outputBytes) };
}
function configuration(input: unknown): SandboxExecutionConfiguration {
  const c = rec(boundedData(input), ["workspaceId", "projects", "grants", "policy"]), p = rec(c.policy,
    ["id", "revision", "branchPrefix", "readablePaths", "writablePaths", "forbiddenPaths", "commands", "network", "resources", "ephemeralSecrets"]);
  const projects = unique(list(c.projects, value => {
    const x = rec(value, ["projectId", "repositoryId", "baselines", "protectedBranches"]);
    return { projectId: id(x.projectId), repositoryId: id(x.repositoryId), baselines: unique(list(x.baselines, baseline, 1), x => x), protectedBranches: ids(x.protectedBranches, 1) };
  }), x => x.projectId);
  const grants = unique(list(c.grants, value => {
    const g = rec(value, ["executionId", "projectId", "policyRef", "approvalRef", "policyRevision", "resourceGeneration"]);
    requireFact(projects.some(x => x.projectId === g.projectId));
    requireFact(g.policyRef === p.id && g.policyRevision === p.revision);
    return { executionId: id(g.executionId), projectId: id(g.projectId), policyRef: id(g.policyRef), approvalRef: id(g.approvalRef), policyRevision: number(g.policyRevision, 1000000), resourceGeneration: number(g.resourceGeneration, 1000000) };
  }), g => g.executionId);
  const policy = { id: id(p.id), revision: number(p.revision, 1000000), branchPrefix: id(p.branchPrefix),
    readablePaths: paths(p.readablePaths), writablePaths: paths(p.writablePaths), forbiddenPaths: paths(p.forbiddenPaths),
    commands: unique(list(p.commands, command, 0, sandboxExecutionPlatformLimits.maxCommands), c => c.id), network: network(p.network), resources: resources(p.resources),
    ephemeralSecrets: unique(list(p.ephemeralSecrets, v => { const s = rec(v, ["ref", "executionId", "expiresAt"]); requireFact(grants.some(g => g.executionId === s.executionId));
      return { ref: id(s.ref), executionId: id(s.executionId), expiresAt: number(s.expiresAt, Number.MAX_SAFE_INTEGER) }; }), s => s.ref) };
  return freezeDeep({ workspaceId: id(c.workspaceId), projects, grants, policy });
}
function baseline(input: unknown): string { requireFact(typeof input === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(input)); return input; }
function authority(input: unknown): SandboxAuthority {
  const a = rec(boundedData(input), ["workspaceId", "executionId", "projectId", "generation", "actorId", "active", "now", "expiresAt"]);
  requireFact(typeof a.active === "boolean", "invalid_authority");
  return { workspaceId: id(a.workspaceId), executionId: id(a.executionId), projectId: id(a.projectId), generation: number(a.generation, 1000000), actorId: id(a.actorId),
    active: a.active, now: number(a.now, Number.MAX_SAFE_INTEGER - sandboxExecutionPlatformLimits.wallClockMs, 0), expiresAt: number(a.expiresAt, Number.MAX_SAFE_INTEGER) };
}
function cleanupAuthority(input: unknown): SandboxCleanupAuthority {
  const a = rec(boundedData(input), ["workspaceId", "executionId", "projectId", "generation", "actorId", "now", "expiresAt", "worktreeId", "resourceGeneration", "specFingerprint"]);
  requireFact(typeof a.specFingerprint === "string" && /^[a-f0-9]{64}$/u.test(a.specFingerprint), "invalid_authority");
  return { workspaceId: id(a.workspaceId), executionId: id(a.executionId), projectId: id(a.projectId), generation: number(a.generation, 1000000), actorId: id(a.actorId),
    now: number(a.now, Number.MAX_SAFE_INTEGER - sandboxExecutionPlatformLimits.wallClockMs, 0), expiresAt: number(a.expiresAt, Number.MAX_SAFE_INTEGER),
    worktreeId: id(a.worktreeId), resourceGeneration: number(a.resourceGeneration, 1000000), specFingerprint: a.specFingerprint };
}
function artifact(input: unknown, max: number): SandboxArtifactRef {
  const a = rec(input, ["id", "sha256", "sizeBytes"]);
  requireFact(typeof a.sha256 === "string" && /^[a-f0-9]{64}$/u.test(a.sha256), "invalid_artifact");
  return { id: id(a.id), sha256: a.sha256, sizeBytes: number(a.sizeBytes, max, 0) };
}
function deny(error: unknown, kind = "admission_denied"): SandboxDecision {
  const reason = error instanceof InvalidSandbox ? error.reason : "invalid_spec";
  return freezeDeep({ verdict: "deny", status: "denied", reason, snapshot: null, normalizedCommand: null, writeCondition: null, newEvents: [], auditEvidence: { kind, reason }, authorityScope: null, runtimeDispatchAllowed: false });
}
function allow(snapshot: SandboxExecutionSnapshot | null, status: "created" | "recorded" | "idempotent", before: SandboxExecutionSnapshot | null = null, normalizedCommand: SandboxCommand | null = null,
  authorityScope: NonNullable<SandboxDecision["authorityScope"]> = "execution_contract"): SandboxDecision {
  return freezeDeep({ verdict: "allow", status, reason: null, snapshot, normalizedCommand,
    writeCondition: snapshot && status !== "idempotent" ? { workspaceId: snapshot.spec.workspaceId, executionId: snapshot.spec.executionId, resourceGeneration: snapshot.spec.checkout.resourceGeneration,
      expectedRevision: before?.revision ?? null, expectedFingerprint: before ? digest(before) : null } : null,
    newEvents: snapshot && status !== "idempotent" ? [snapshot.events.at(-1)!] : [], auditEvidence: { kind: "policy_allowed", reason: null }, authorityScope, runtimeDispatchAllowed: false });
}

/** Pure contract only. A future store MUST atomically CAS snapshot + newEvents with the supplied condition.
 * Returning a proposal does not acquire a lock, create an environment or authorize command dispatch. */
export function createSandboxExecutionContract(configurationInput: unknown) {
  let config: SandboxExecutionConfiguration;
  try { config = configuration(configurationInput); } catch { throw Error("invalid_sandbox_configuration"); }
  function spec(input: unknown): SandboxExecutionSpec {
    const s = rec(boundedData(input), ["schemaVersion", "executionId", "workspaceId", "projectId", "repository", "checkout", "mode", "filesystem", "commands", "forbiddenActions", "network", "secrets", "resources", "artifacts", "cleanup", "policyRef", "policyRevision", "approvalRef"]);
    requireFact(s.schemaVersion === 1);
    const executionId = id(s.executionId), projectId = id(s.projectId), workspaceId = id(s.workspaceId);
    const r = rec(s.repository, ["id", "baseline"]), checkout = rec(s.checkout, ["branch", "worktreeId", "resourceGeneration"]);
    requireFact(checkout.worktreeId === executionId && typeof checkout.branch === "string"
      && checkout.branch.split("/").length === 2 && checkout.branch.split("/")[1] === executionId
      && !checkout.branch.includes(".."), "scope_denied"); id(checkout.branch.split("/")[0]);
    requireFact(s.mode === "patch_proposal" || s.mode === "analysis_only");
    const f = rec(s.filesystem, ["readablePaths", "writablePaths", "forbiddenPaths", "hostAccess"]);
    const readablePaths = paths(f.readablePaths), writablePaths = paths(f.writablePaths), forbiddenPaths = paths(f.forbiddenPaths);
    requireFact(f.hostAccess === "denied" && readablePaths.length && (s.mode === "analysis_only" ? !writablePaths.length : writablePaths.length > 0), "scope_denied");
    requireFact(writablePaths.every(p => within(p, readablePaths)), "scope_denied");
    requireFact([...readablePaths, ...writablePaths].every(p => !protectedPath(p) && !forbiddenPaths.some(q => overlaps(p, q))), "scope_denied");
    const rs = resources(s.resources);
    const commands = unique(list(s.commands, command, 1, sandboxExecutionPlatformLimits.maxCommands), c => c.id);
    requireFact(commands.every(c => within(c.cwd, readablePaths) && !protectedPath(c.cwd)
      && !forbiddenPaths.some(p => overlaps(c.cwd, p)) && c.timeoutMs <= rs.commandMs && c.maxOutputBytes <= rs.outputBytes), "command_denied");
    const forbidden = ids(s.forbiddenActions); requireFact(isDeepStrictEqual(forbidden, [...sandboxForbiddenActions].sort(compare)), "scope_denied");
    const n = network(s.network);
    const secret = rec(s.secrets, ["mode", "refs", "inheritEnvironment"]), refs = ids(secret.refs);
    requireFact(secret.inheritEnvironment === false && ((secret.mode === "none" && !refs.length) || (secret.mode === "ephemeral" && refs.length > 0)), "secret_denied");
    const a = rec(s.artifacts, ["maxFiles", "maxBytes", "maxLogBytes", "requiredCommandIds"]), requiredCommandIds = ids(a.requiredCommandIds, 1);
    requireFact(requiredCommandIds.every(id => commands.some(c => c.id === id)), "verification_required");
    const cleanup = rec(s.cleanup, ["mode", "retainArtifacts"]); requireFact(cleanup.mode === "always" && cleanup.retainArtifacts === true);
    return freezeDeep({ schemaVersion: 1, executionId, workspaceId, projectId, repository: { id: id(r.id), baseline: baseline(r.baseline) },
      checkout: { branch: checkout.branch, worktreeId: executionId, resourceGeneration: number(checkout.resourceGeneration, 1000000) }, mode: s.mode,
      filesystem: { readablePaths, writablePaths, forbiddenPaths, hostAccess: "denied" }, commands, forbiddenActions: [...sandboxForbiddenActions], network: n,
      secrets: { mode: secret.mode as "none" | "ephemeral", refs, inheritEnvironment: false }, resources: rs,
      artifacts: { maxFiles: number(a.maxFiles, sandboxExecutionPlatformLimits.maxFiles), maxBytes: number(a.maxBytes, sandboxExecutionPlatformLimits.artifactBytes), maxLogBytes: number(a.maxLogBytes, rs.outputBytes), requiredCommandIds },
      cleanup: { mode: "always", retainArtifacts: true }, policyRef: id(s.policyRef), policyRevision: number(s.policyRevision, 1000000), approvalRef: id(s.approvalRef) });
  }
  /** Current execution admission, NEVER used to reinterpret historical facts or grant cleanup. */
  function authorizeSpec(s: SandboxExecutionSpec) {
    const g = config.grants.find(g => g.executionId === s.executionId), p = config.projects.find(p => p.projectId === s.projectId);
    requireFact(g && p && g.projectId === s.projectId && s.workspaceId === config.workspaceId, "identity_conflict");
    requireFact(g.policyRef === s.policyRef && g.policyRevision === s.policyRevision && g.approvalRef === s.approvalRef, "stale_authority");
    requireFact(g.resourceGeneration === s.checkout.resourceGeneration && p.repositoryId === s.repository.id && p.baselines.includes(s.repository.baseline), "identity_conflict");
    requireFact(s.checkout.branch === `${config.policy.branchPrefix}/${s.executionId}` && !p.protectedBranches.includes(s.checkout.branch), "scope_denied");
    requireFact(config.policy.forbiddenPaths.every(p => s.filesystem.forbiddenPaths.some(q => repositoryPathContains(q, p))), "scope_denied");
    requireFact(s.filesystem.readablePaths.every(p => within(p, config.policy.readablePaths)) && s.filesystem.writablePaths.every(p => within(p, config.policy.writablePaths)), "scope_denied");
    requireFact(Object.keys(s.resources).every(k => s.resources[k as keyof SandboxResources] <= config.policy.resources[k as keyof SandboxResources]), "limit_exceeded");
    requireFact(s.commands.every(c => config.policy.commands.some(p => isDeepStrictEqual(c, p))), "command_denied");
    requireFact(s.network.mode === "deny_all" || (config.policy.network.mode === "allowlisted" && s.network.destinations.every(d => config.policy.network.destinations.some(p => isDeepStrictEqual(p, d)))), "network_denied");
    requireFact(s.secrets.refs.every(ref => config.policy.ephemeralSecrets.some(p => p.ref === ref && p.executionId === s.executionId)), "secret_denied");
  }
  function context(s: SandboxExecutionSpec, a: SandboxAuthority, generation: number, live: boolean, historical = false) {
    requireFact(a.workspaceId === s.workspaceId && a.projectId === s.projectId && a.executionId === s.executionId, "invalid_authority");
    requireFact(live ? a.generation === generation && a.active && a.now < a.expiresAt : a.generation >= generation, "stale_authority");
    if (live && !historical) {
      authorizeSpec(s);
      requireFact(s.secrets.refs.every(ref => config.policy.ephemeralSecrets.some(x => x.ref === ref && x.executionId === s.executionId && x.expiresAt > a.now)), "secret_denied");
    }
  }
  function cleanupContext(s: SandboxExecutionSnapshot, a: SandboxCleanupAuthority) {
    requireFact(a.workspaceId === config.workspaceId && a.workspaceId === s.spec.workspaceId && a.projectId === s.spec.projectId && a.executionId === s.spec.executionId, "invalid_authority");
    requireFact(a.worktreeId === s.spec.checkout.worktreeId && a.resourceGeneration === s.spec.checkout.resourceGeneration && a.specFingerprint === s.specFingerprint, "identity_conflict");
    requireFact(a.generation >= s.authorityGeneration && a.now < a.expiresAt, "stale_authority");
  }
  const requestFingerprint = (commandId: string, expectedRevision: number | null, fence: number, action: unknown, a: EventAuthority, specFingerprint: string) =>
    digest({ commandId, expectedRevision, fence, action, actorId: a.actorId, generation: a.generation, specFingerprint,
      cleanupResource: "resourceGeneration" in a ? { worktreeId: a.worktreeId, resourceGeneration: a.resourceGeneration, specFingerprint: a.specFingerprint } : null });
  function initial(s: SandboxExecutionSpec, commandId: string, a: SandboxAuthority, historical = false): SandboxExecutionSnapshot {
    context(s, a, a.generation, true, historical); const specFingerprint = digest(s);
    const event: SandboxExecutionEvent = { commandId, expectedRevision: null, fence: 0, authority: a, action: { type: "request" },
      requestFingerprint: requestFingerprint(commandId, null, 0, { type: "request" }, a, specFingerprint), kind: "sandbox_requested", state: "requested" };
    return freezeDeep({ schemaVersion: 1, spec: s, specFingerprint, revision: 1, authorityGeneration: a.generation, state: "requested", fence: 0, owner: null,
      createdAt: a.now, updatedAt: a.now, startedAt: null, endedAt: null, admission: "pending", failureCategory: null, result: null, commands: [],
      cleanup: { status: "not_started", attempts: 0, startedAt: null, endedAt: null }, events: [event] });
  }
  function pathAllowed(s: SandboxExecutionSpec, p: string, access: "read" | "write") {
    requireFact(!protectedPath(p) && !s.filesystem.forbiddenPaths.some(q => overlaps(p, q))
      && within(p, access === "read" ? s.filesystem.readablePaths : s.filesystem.writablePaths), "scope_denied");
  }
  function action(input: unknown, s: SandboxExecutionSpec): SandboxAction {
    requireFact(input && typeof input === "object" && !Array.isArray(input)); const a = input as Record<string, unknown>;
    switch (a.type) {
      case "admit": case "claim": case "prepare": case "start": case "cancel": case "begin_cleanup": rec(a, ["type"]); return { type: a.type };
      case "ready": rec(a, ["type", "evidence"]); return { type: "ready", evidence: artifact(a.evidence, s.artifacts.maxBytes) };
      case "start_command": rec(a, ["type", "requestId", "commandPolicyId"]); return { type: a.type, requestId: id(a.requestId), commandPolicyId: id(a.commandPolicyId) };
      case "finish_command": {
        rec(a, ["type", "requestId", "outcome", "exitCode", "stdout", "stderr"]);
        requireFact(["passed", "failed", "timed_out", "outcome_unknown"].includes(a.outcome as string));
        requireFact(a.outcome === "passed" ? a.exitCode === 0 : a.outcome === "failed"
          ? typeof a.exitCode === "number" && Number.isSafeInteger(a.exitCode) && a.exitCode !== 0 && a.exitCode >= -255 && a.exitCode <= 255 : a.exitCode === null);
        const stdout = a.stdout === null ? null : artifact(a.stdout, s.artifacts.maxLogBytes), stderr = a.stderr === null ? null : artifact(a.stderr, s.artifacts.maxLogBytes);
        requireFact((stdout?.sizeBytes ?? 0) + (stderr?.sizeBytes ?? 0) <= s.artifacts.maxLogBytes, "limit_exceeded");
        return { type: a.type, requestId: id(a.requestId), outcome: a.outcome as "passed" | "failed" | "timed_out" | "outcome_unknown", exitCode: a.exitCode as number | null, stdout, stderr };
      }
      case "complete": {
        rec(a, ["type", "result"]); const r = rec(a.result, ["changedPaths", "diff", "report"]), changedPaths = paths(r.changedPaths, s.artifacts.maxFiles);
        requireFact(changedPaths.length <= s.artifacts.maxFiles && (s.mode === "analysis_only" ? !changedPaths.length && r.diff === null : changedPaths.length > 0 && r.diff !== null), "invalid_artifact");
        changedPaths.forEach(p => pathAllowed(s, p, "write"));
        const diff = r.diff === null ? null : artifact(r.diff, s.artifacts.maxBytes), report = artifact(r.report, s.artifacts.maxBytes);
        requireFact(report.sizeBytes > 0 && (diff === null || diff.sizeBytes > 0) && report.sizeBytes + (diff?.sizeBytes ?? 0) <= s.artifacts.maxBytes, "limit_exceeded");
        return { type: a.type, result: { changedPaths, diff, report } };
      }
      case "fail": case "block": rec(a, ["type", "failureCategory"]);
        requireFact((a.type === "fail" ? ["execution_failed", "verification_failed", "timeout"] : ["crashed", "timeout", "outcome_unknown", "policy_blocked"]).includes(a.failureCategory as string));
        return { type: a.type, failureCategory: a.failureCategory as SandboxFailureCategory };
      case "finish_cleanup": rec(a, ["type", "worktreeId", "outcome"]); requireFact(a.outcome === "completed" || a.outcome === "failed");
        requireFact(a.worktreeId === s.checkout.worktreeId, "identity_conflict"); return { type: a.type, worktreeId: s.checkout.worktreeId, outcome: a.outcome };
      default: return fail("invalid_transition");
    }
  }
  function advance(before: SandboxExecutionSnapshot, commandId: string, expectedRevision: number, fence: number, act: SandboxAction, a: EventAuthority, historical = false): SandboxExecutionSnapshot {
    requireFact(expectedRevision === before.revision, "stale_revision"); requireFact(fence === before.fence, "stale_fence");
    requireFact(a.now >= before.updatedAt, "invalid_authority");
    const control = ["cancel", "block", "begin_cleanup", "finish_cleanup"].includes(act.type);
    if (act.type === "begin_cleanup" || act.type === "finish_cleanup") cleanupContext(before, a as SandboxCleanupAuthority);
    else context(before.spec, a as SandboxAuthority, before.authorityGeneration, !control, historical);
    const s = structuredClone(before) as { -readonly [K in keyof SandboxExecutionSnapshot]: SandboxExecutionSnapshot[K] };
    s.authorityGeneration = a.generation;
    const own = () => { requireFact(s.owner?.workerId === a.actorId && a.now < s.owner.expiresAt, "stale_fence"); };
    const end = (state: "completed" | "failed" | "cancelled" | "blocked", failure: SandboxFailureCategory | null) => {
      s.state = state; s.failureCategory = failure; s.endedAt = a.now; s.owner = null; s.fence++;
      s.commands = s.commands.map(c => c.outcome === "running" ? { ...c, endedAt: a.now, outcome: "outcome_unknown", exitCode: null } : c);
    };
    let kind = "";
    switch (act.type) {
      case "admit": requireFact(s.state === "requested", "invalid_transition"); s.state = "admitted"; s.admission = "allowed"; kind = "admission_allowed"; break;
      case "claim": requireFact(s.state === "admitted" && s.owner === null, "invalid_transition");
        s.fence++; s.owner = { workerId: a.actorId, expiresAt: Math.min(a.now + s.spec.resources.wallClockMs, a.expiresAt) }; kind = "ownership_claimed"; break;
      case "prepare": own(); requireFact(s.state === "admitted", "invalid_transition"); s.state = "preparing"; kind = "preparation_started"; break;
      case "ready": own(); requireFact(s.state === "preparing", "invalid_transition"); s.state = "ready"; kind = "sandbox_ready"; break;
      case "start": own(); requireFact(s.state === "ready", "invalid_transition"); s.state = "running"; s.startedAt = a.now; kind = "execution_started"; break;
      case "start_command": {
        own(); requireFact(s.state === "running" && s.startedAt !== null && a.now < s.startedAt + s.spec.resources.wallClockMs, "invalid_transition");
        requireFact(!s.commands.some(c => c.outcome === "running" || c.requestId === act.requestId) && s.commands.length < sandboxExecutionPlatformLimits.maxCommands, "command_denied");
        requireFact(s.spec.commands.some(c => c.id === act.commandPolicyId), "command_denied");
        s.commands = [...s.commands, { requestId: act.requestId, commandPolicyId: act.commandPolicyId, startedAt: a.now, endedAt: null, outcome: "running", exitCode: null, stdout: null, stderr: null }]; kind = "command_allowed"; break;
      }
      case "finish_command": {
        own(); requireFact(s.state === "running", "invalid_transition"); const c = s.commands.find(c => c.requestId === act.requestId && c.outcome === "running");
        requireFact(c, "invalid_transition"); const profile = s.spec.commands.find(p => p.id === c.commandPolicyId)!;
        requireFact((act.outcome === "timed_out" || act.outcome === "outcome_unknown") || a.now - c.startedAt <= profile.timeoutMs, "limit_exceeded");
        requireFact((act.stdout?.sizeBytes ?? 0) + (act.stderr?.sizeBytes ?? 0) <= profile.maxOutputBytes, "limit_exceeded");
        const previousBytes = s.commands.reduce((n, x) => n + (x.stdout?.sizeBytes ?? 0) + (x.stderr?.sizeBytes ?? 0), 0);
        requireFact(previousBytes + (act.stdout?.sizeBytes ?? 0) + (act.stderr?.sizeBytes ?? 0) <= s.spec.resources.outputBytes, "limit_exceeded");
        s.commands = s.commands.map(x => x.requestId === c.requestId ? { ...x, ...act, endedAt: a.now } : x).map(x => {
          const { requestId, commandPolicyId, startedAt, endedAt, outcome, exitCode, stdout, stderr } = x;
          return { requestId, commandPolicyId, startedAt, endedAt, outcome, exitCode, stdout, stderr };
        });
        if (act.outcome === "outcome_unknown") end("blocked", "outcome_unknown"); kind = act.outcome === "outcome_unknown" ? "execution_terminal" : "command_finished"; break;
      }
      case "complete": own(); requireFact(s.state === "running" && s.startedAt !== null && a.now < s.startedAt + s.spec.resources.wallClockMs && !s.commands.some(c => c.outcome === "running"), "invalid_transition");
        requireFact(s.spec.artifacts.requiredCommandIds.every(id => s.commands.filter(c => c.commandPolicyId === id).at(-1)?.outcome === "passed"), "verification_required");
        s.result = act.result; end("completed", null); kind = "execution_terminal"; break;
      case "fail": own(); requireFact(s.state === "running" && !s.commands.some(c => c.outcome === "running"), "invalid_transition");
        end("failed", act.failureCategory); kind = "execution_terminal"; break;
      case "cancel": case "block": requireFact(!terminal(s.state), "invalid_transition"); end(act.type === "cancel" ? "cancelled" : "blocked", act.type === "cancel" ? "cancelled" : act.failureCategory); kind = "execution_terminal"; break;
      case "begin_cleanup": requireFact(terminal(s.state) && ["not_started", "failed"].includes(s.cleanup.status) && s.cleanup.attempts < sandboxExecutionPlatformLimits.maxCleanupAttempts, "invalid_transition");
        s.fence++; s.owner = { workerId: a.actorId, expiresAt: Math.min(a.now + s.spec.resources.wallClockMs, a.expiresAt) }; s.cleanup = { status: "running", attempts: s.cleanup.attempts + 1, startedAt: a.now, endedAt: null }; kind = "cleanup_started"; break;
      case "finish_cleanup": own(); requireFact(terminal(s.state) && s.cleanup.status === "running", "invalid_transition");
        s.cleanup = { ...s.cleanup, status: act.outcome, endedAt: a.now }; s.owner = null; s.fence++; kind = act.outcome === "completed" ? "cleanup_completed" : "cleanup_failed"; break;
    }
    const event: SandboxExecutionEvent = { commandId, expectedRevision, fence, authority: a, action: act,
      requestFingerprint: requestFingerprint(commandId, expectedRevision, fence, act, a, s.specFingerprint), kind, state: s.state };
    requireFact(s.events.length < sandboxExecutionPlatformLimits.maxEvents, "event_limit_exceeded");
    s.revision++; s.updatedAt = a.now; s.events = [...s.events, event]; return freezeDeep(s);
  }
  function restore(input: unknown): SandboxExecutionSnapshot {
    const raw = boundedData(input) as SandboxExecutionSnapshot;
    requireFact(raw && raw.schemaVersion === 1 && Array.isArray(raw.events) && raw.events.length > 0 && raw.events.length <= sandboxExecutionPlatformLimits.maxEvents, "invalid_snapshot");
    const normalized = spec(raw.spec), first = raw.events[0];
    requireFact(normalized.workspaceId === config.workspaceId, "invalid_snapshot");
    requireFact(first.action.type === "request" && first.expectedRevision === null && first.fence === 0, "invalid_snapshot");
    let rebuilt = initial(normalized, id(first.commandId), authority(first.authority), true);
    requireFact(isDeepStrictEqual(boundedData(rebuilt.events[0]), first), "invalid_snapshot");
    for (const e of raw.events.slice(1)) {
      const act = action(e.action, normalized), a = act.type === "begin_cleanup" || act.type === "finish_cleanup" ? cleanupAuthority(e.authority) : authority(e.authority), commandId = id(e.commandId);
      requireFact(!rebuilt.events.some(p => p.commandId === commandId), "identity_conflict");
      rebuilt = advance(rebuilt, commandId, number(e.expectedRevision, sandboxExecutionPlatformLimits.maxEvents), number(e.fence, 1000000, 0), act, a, true);
      requireFact(isDeepStrictEqual(boundedData(rebuilt.events.at(-1)), e), "invalid_snapshot");
    }
    requireFact(isDeepStrictEqual(raw, boundedData(rebuilt)), "invalid_snapshot"); return rebuilt;
  }
  return Object.freeze({ capabilities: sandboxExecutionCapabilities,
    create(input: unknown, authorityInput: unknown, existing: unknown = null): SandboxDecision {
      try {
        const c = rec(boundedData(input), ["commandId", "spec"]), commandId = id(c.commandId), normalized = spec(c.spec), a = authority(authorityInput);
        context(normalized, a, a.generation, true);
        if (existing !== null) { const saved = restore(existing); requireFact(saved.specFingerprint === digest(normalized) && saved.events[0].commandId === commandId
          && saved.events[0].requestFingerprint === requestFingerprint(commandId, null, 0, { type: "request" }, a, saved.specFingerprint), "identity_conflict"); return allow(saved, "idempotent"); }
        return allow(initial(normalized, commandId, a), "created");
      } catch (error) { return deny(error); }
    },
    apply(input: unknown, commandInput: unknown, authorityInput: unknown): SandboxDecision {
      let denialKind = "transition_denied";
      try {
        const saved = restore(input), c = rec(boundedData(commandInput), ["commandId", "expectedRevision", "fence", "action"]), commandId = id(c.commandId), a = authority(authorityInput);
        context(saved.spec, a, saved.authorityGeneration, false);
        const expectedRevision = number(c.expectedRevision, sandboxExecutionPlatformLimits.maxEvents), fence = number(c.fence, 1000000, 0), act = action(c.action, saved.spec);
        if (act.type === "admit") denialKind = "admission_denied";
        if (act.type === "start_command" || act.type === "finish_command") denialKind = "command_denied";
        requireFact(act.type !== "begin_cleanup" && act.type !== "finish_cleanup", "invalid_authority");
        if (act.type !== "cancel" && act.type !== "block") context(saved.spec, a, saved.authorityGeneration, true);
        const replay = saved.events.find(e => e.commandId === commandId);
        if (replay) { requireFact(replay.requestFingerprint === requestFingerprint(commandId, expectedRevision, fence, act, a, saved.specFingerprint), "identity_conflict"); return allow(saved, "idempotent"); }
        return allow(advance(saved, commandId, expectedRevision, fence, act, a), "recorded", saved);
      } catch (error) { return deny(error, denialKind); }
    },
    applyCleanup(input: unknown, commandInput: unknown, authorityInput: unknown): SandboxDecision {
      try {
        const saved = restore(input), c = rec(boundedData(commandInput), ["commandId", "expectedRevision", "fence", "action"]), commandId = id(c.commandId), a = cleanupAuthority(authorityInput);
        cleanupContext(saved, a);
        const expectedRevision = number(c.expectedRevision, sandboxExecutionPlatformLimits.maxEvents), fence = number(c.fence, 1000000, 0), act = action(c.action, saved.spec);
        requireFact(act.type === "begin_cleanup" || act.type === "finish_cleanup", "invalid_authority");
        const replay = saved.events.find(e => e.commandId === commandId);
        if (replay) { requireFact(replay.requestFingerprint === requestFingerprint(commandId, expectedRevision, fence, act, a, saved.specFingerprint), "identity_conflict"); return allow(saved, "idempotent", null, null, "cleanup_only"); }
        return allow(advance(saved, commandId, expectedRevision, fence, act, a), "recorded", saved, null, "cleanup_only");
      } catch (error) { return deny(error, "cleanup_denied"); }
    },
    validateSnapshot(input: unknown): Readonly<{ ok: boolean; snapshot: SandboxExecutionSnapshot | null }> {
      try { return freezeDeep({ ok: true, snapshot: restore(input) }); } catch { return freezeDeep({ ok: false, snapshot: null }); }
    },
    evaluateCommand(specInput: unknown, input: unknown): SandboxDecision {
      try { const s = spec(specInput), c = command(boundedData(input)); authorizeSpec(s); requireFact(s.commands.some(p => isDeepStrictEqual(c, p)), "command_denied"); return allow(null, "recorded", null, c, "policy_only"); }
      catch (error) { return deny(error, "command_denied"); }
    },
    evaluatePath(specInput: unknown, input: unknown): SandboxDecision {
      try { const s = spec(specInput), p = rec(boundedData(input), ["path", "access"]); authorizeSpec(s); requireFact(p.access === "read" || p.access === "write", "scope_denied"); pathAllowed(s, path(p.path), p.access); return allow(null, "recorded", null, null, "policy_only"); }
      catch (error) { return deny(error, "path_denied"); }
    },
    /** Pure trusted adapter-evidence probe, NOT DNS, TLS verification, a socket or egress permission. */
    evaluateNetworkAccess(specInput: unknown, destinationInput: unknown, evidenceInput: unknown): SandboxDecision {
      try {
        const s = spec(specInput), d = destination(boundedData(destinationInput)); authorizeSpec(s);
        requireFact(s.network.mode === "allowlisted" && s.network.destinations.some(p => isDeepStrictEqual(p, d)), "network_denied");
        const e = rec(boundedData(evidenceInput), ["resolvedAddresses", "connectedAddress", "redirected", "tlsHostnameVerified", "platformPolicyAllows"]);
        requireFact(e.redirected === false && e.tlsHostnameVerified === true && e.platformPolicyAllows === true, "network_denied");
        const addresses = unique(list(e.resolvedAddresses, publicPeer, 1), x => x), peer = publicPeer(e.connectedAddress);
        requireFact(addresses.includes(peer), "network_denied"); return allow(null, "recorded", null, null, "policy_only");
      } catch (error) { return deny(error, "network_denied"); }
    },
  });
}
