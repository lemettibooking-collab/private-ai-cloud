import assert from "node:assert/strict";
import { test } from "node:test";
const domain = await import(new URL("../lib/contracts/sandbox-execution.ts", import.meta.url).href) as typeof import("../lib/contracts/sandbox-execution");
const hash = "a".repeat(64), baseline = "b".repeat(40);
const artifact = (id = "artifact-a", sizeBytes = 10) => ({ id, sha256: hash, sizeBytes });
function fixture() {
  const command = { id: "tests", executable: "npm", args: ["test"], cwd: "tests", environment: { CI: "1" }, timeoutMs: 120000, maxOutputBytes: 65536 };
  const resources = { wallClockMs: 300000, cpuMillis: 1000, memoryMiB: 512, diskMiB: 1024, commandMs: 120000, outputBytes: 65536 };
  const config = { workspaceId: "workspace-a", projects: [{ projectId: "project-a", repositoryId: "repo-a", baselines: [baseline], protectedBranches: ["main", "master"] }],
    grants: [{ executionId: "exec-a", projectId: "project-a", policyRef: "policy-a", approvalRef: "approval-a", policyRevision: 1, resourceGeneration: 1 }],
    policy: { id: "policy-a", revision: 1, branchPrefix: "sandbox", readablePaths: ["src", "tests"], writablePaths: ["src"], forbiddenPaths: ["secrets"],
      commands: [command], network: { mode: "deny_all", destinations: [] as { scheme: string; hostname: string; port: number }[] }, resources,
      ephemeralSecrets: [{ ref: "test-db", executionId: "exec-a", expiresAt: 900000 }] } };
  const spec = { schemaVersion: 1, executionId: "exec-a", workspaceId: "workspace-a", projectId: "project-a", repository: { id: "repo-a", baseline },
    checkout: { branch: "sandbox/exec-a", worktreeId: "exec-a", resourceGeneration: 1 }, mode: "patch_proposal",
    filesystem: { readablePaths: ["src", "tests"], writablePaths: ["src"], forbiddenPaths: ["secrets"], hostAccess: "denied" },
    commands: [structuredClone(command)], forbiddenActions: [...domain.sandboxForbiddenActions], network: { mode: "deny_all", destinations: [] as { scheme: string; hostname: string; port: number }[] },
    secrets: { mode: "none", refs: [] as string[], inheritEnvironment: false }, resources: { ...resources },
    artifacts: { maxFiles: 16, maxBytes: 1048576, maxLogBytes: 65536, requiredCommandIds: ["tests"] },
    cleanup: { mode: "always", retainArtifacts: true }, policyRef: "policy-a", policyRevision: 1, approvalRef: "approval-a" };
  const authority = { workspaceId: "workspace-a", projectId: "project-a", executionId: "exec-a", generation: 1, actorId: "worker-a", active: true, now: 1000, expiresAt: 1000000 };
  return { config, spec, authority, contract: domain.createSandboxExecutionContract(config) };
}
function created(f = fixture()) { const d = f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority); assert.equal(d.verdict, "allow"); assert.ok(d.snapshot);
  return { ...f, snapshot: d.snapshot, resource: { worktreeId: f.spec.checkout.worktreeId, resourceGeneration: f.spec.checkout.resourceGeneration, specFingerprint: d.snapshot.specFingerprint } }; }
function cleanupAuthority(f: ReturnType<typeof created>) {
  const { workspaceId, projectId, executionId, generation, actorId, now, expiresAt } = f.authority;
  return { workspaceId, projectId, executionId, generation, actorId, now, expiresAt, ...f.resource };
}
function step(f: ReturnType<typeof created>, action: Record<string, unknown>, commandId = `op-${f.snapshot.revision}`) {
  const command = { commandId, expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action }, now = f.authority.now + f.snapshot.revision;
  const d = action.type === "begin_cleanup" || action.type === "finish_cleanup"
    ? f.contract.applyCleanup(f.snapshot, command, { ...cleanupAuthority(f), now }) : f.contract.apply(f.snapshot, command, { ...f.authority, now });
  assert.equal(d.verdict, "allow", JSON.stringify(d)); assert.ok(d.snapshot); f.snapshot = d.snapshot; return d;
}
function running() { const f = created(); for (const type of ["admit", "claim", "prepare"]) step(f, { type }); step(f, { type: "ready", evidence: artifact("prepared") }); step(f, { type: "start" }); return f; }
function verified() { const f = running(); step(f, { type: "start_command", requestId: "command-a", commandPolicyId: "tests" }); step(f, { type: "finish_command", requestId: "command-a", outcome: "passed", exitCode: 0, stdout: artifact("log"), stderr: null }); return f; }
function denied(d: { verdict: string; snapshot: unknown; writeCondition: unknown; runtimeDispatchAllowed: boolean }) { assert.equal(d.verdict, "deny"); assert.equal(d.snapshot, null); assert.equal(d.writeCondition, null); assert.equal(d.runtimeDispatchAllowed, false); }
function frozen(value: unknown) { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }

test("valid admission is deterministic, frozen and grants no physical sandbox/runtime capability", () => {
  const f = created(), input = structuredClone({ config: f.config, spec: f.spec, authority: f.authority });
  const d = step(f, { type: "admit" }); assert.equal(f.snapshot.state, "admitted"); assert.equal(d.runtimeDispatchAllowed, false);
  assert.equal(d.writeCondition?.expectedRevision, 1); assert.equal(d.newEvents.length, 1); frozen(d);
  assert.deepEqual({ config: f.config, spec: f.spec, authority: f.authority }, input);
  assert.equal(domain.sandboxExecutionCapabilities.runtimeEnforcement, "not_implemented");
});
for (const [name, mutate] of [
  ["unknown execution", (s: ReturnType<typeof fixture>["spec"]) => { s.executionId = "unknown"; }],
  ["unknown project", (s: ReturnType<typeof fixture>["spec"]) => { s.projectId = "foreign"; }],
  ["repository mismatch", (s: ReturnType<typeof fixture>["spec"]) => { s.repository.id = "foreign"; }],
  ["unknown baseline", (s: ReturnType<typeof fixture>["spec"]) => { s.repository.baseline = "c".repeat(40); }],
  ["invalid baseline", (s: ReturnType<typeof fixture>["spec"]) => { s.repository.baseline = "main"; }],
  ["protected branch", (s: ReturnType<typeof fixture>["spec"]) => { s.checkout.branch = "main"; }],
  ["worktree identity", (s: ReturnType<typeof fixture>["spec"]) => { s.checkout.worktreeId = "other"; }],
  ["empty writable scope", (s: ReturnType<typeof fixture>["spec"]) => { s.filesystem.writablePaths = []; }],
  ["outside writable grant", (s: ReturnType<typeof fixture>["spec"]) => { s.filesystem.writablePaths = ["tests"]; }],
  ["forbidden ancestor", (s: ReturnType<typeof fixture>["spec"]) => { s.filesystem.forbiddenPaths.push("src"); }],
  ["forbidden descendant", (s: ReturnType<typeof fixture>["spec"]) => { s.filesystem.forbiddenPaths.push("src/private"); }],
  ["host access", (s: ReturnType<typeof fixture>["spec"]) => { s.filesystem.hostAccess = "allowed"; }],
  ["unrestricted network", (s: ReturnType<typeof fixture>["spec"]) => { s.network.mode = "allow_all"; }],
  ["denied network with destinations", (s: ReturnType<typeof fixture>["spec"]) => { s.network.destinations.push({ scheme: "https", hostname: "example.test", port: 443 }); }],
  ["production secret reference", (s: ReturnType<typeof fixture>["spec"]) => { s.secrets.mode = "ephemeral"; s.secrets.refs = ["production-db"]; }],
  ["host environment", (s: ReturnType<typeof fixture>["spec"]) => { s.secrets.inheritEnvironment = true; }],
  ["missing forbidden actions", (s: ReturnType<typeof fixture>["spec"]) => { s.forbiddenActions.pop(); }],
  ["approval substitution", (s: ReturnType<typeof fixture>["spec"]) => { s.approvalRef = "forged"; }],
  ["policy revision", (s: ReturnType<typeof fixture>["spec"]) => { s.policyRevision++; }],
] as const) test(`admission fail closed: ${name}`, () => {
  const f = fixture(); mutate(f.spec); const before = structuredClone(f.spec); const d = f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority); denied(d); assert.deepEqual(f.spec, before);
});
for (const path of [".env", ".git/config", "src/.env.local", ".ssh/id_rsa", "../other-repo", "/etc", "~", "src/../tests", ".", "src\\file", "src/*", "src/%2e%2e"]) test(`protected/hostile filesystem path: ${path}`, () => {
  const f = fixture(); f.spec.filesystem.writablePaths = [path]; denied(f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority));
});
for (const key of ["wallClockMs", "cpuMillis", "memoryMiB", "diskMiB", "commandMs", "outputBytes"] as const) for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) test(`resource ${key} invalid ${value}`, () => {
  const f = fixture(); f.spec.resources[key] = value; denied(f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority));
});
test("analysis-only can be read-only and never produce a patch", () => {
  const f = fixture(); f.spec.mode = "analysis_only"; f.spec.filesystem.writablePaths = []; const d = f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority); assert.equal(d.verdict, "allow");
  denied(f.contract.evaluatePath(d.snapshot!.spec, { path: "src/a.ts", access: "write" }));
});
test("network requires exact explicit grant; canonical case/dot, no wildcard, URL, credentials or extra port", () => {
  const f = fixture(); f.config.policy.network = { mode: "allowlisted", destinations: [{ scheme: "https", hostname: "example.test", port: 443 }] };
  const c = domain.createSandboxExecutionContract(f.config); f.spec.network = structuredClone(f.config.policy.network);
  assert.equal(c.create({ commandId: "create-a", spec: f.spec }, f.authority).verdict, "allow");
  for (const hostname of ["EXAMPLE.test", "example.test."]) { f.spec.network.destinations[0].hostname = hostname; assert.equal(c.create({ commandId: "create-a", spec: f.spec }, f.authority).verdict, "allow"); }
  for (const hostname of ["*.test", "https://example.test", "user@example.test", "example.test/path", "other.test"]) { f.spec.network.destinations[0].hostname = hostname; denied(c.create({ commandId: "create-a", spec: f.spec }, f.authority)); }
});
test("ephemeral references only, never values or inherited environment", () => {
  const f = fixture(); f.spec.secrets = { mode: "ephemeral", refs: ["test-db"], inheritEnvironment: false };
  assert.equal(f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority).verdict, "allow");
  denied(f.contract.create({ commandId: "create-a", spec: { ...f.spec, secrets: { ...f.spec.secrets, values: { secret: "canary" } } } }, f.authority));
  denied(f.contract.create({ commandId: "create-a", spec: f.spec }, { ...f.authority, now: 900001 }));
});
for (const args of [["push"], ["merge", "main"], ["tag", "v1"], ["remote", "set-url"], ["config", "--global"], ["test", ";", "deploy"], ["-e", "process.exit()"]]) test(`forbidden command argv ${args.join(" ")}`, () => {
  const f = fixture(); f.spec.commands[0].args = args; denied(f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority));
});
test("command profile binds exact executable/argv/cwd/environment/time/output, no shell patterns", () => {
  const f = created(); assert.equal(f.contract.evaluateCommand(f.snapshot.spec, f.spec.commands[0]).verdict, "allow");
  for (const command of [{ ...f.spec.commands[0], executable: "sh" }, { ...f.spec.commands[0], cwd: "/tmp" }, { ...f.spec.commands[0], args: ["run", "deploy"] },
    { ...f.spec.commands[0], environment: { NODE_OPTIONS: "--require=evil" } }, { ...f.spec.commands[0], timeoutMs: 120001 }, { ...f.spec.commands[0], maxOutputBytes: 65537 }]) denied(f.contract.evaluateCommand(f.snapshot.spec, command));
});
test("invalid lifecycle transitions cannot skip preparation or return from terminal", () => {
  const f = created(); denied(f.contract.apply(f.snapshot, { commandId: "bad", expectedRevision: 1, fence: 0, action: { type: "start" } }, f.authority));
  step(f, { type: "cancel" }); assert.equal(f.snapshot.state, "cancelled");
  denied(f.contract.apply(f.snapshot, { commandId: "bad2", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "admit" } }, f.authority));
});
test("duplicate creation/controller/admission replay is no-op; changed payload conflicts", () => {
  const f = created(), replay = f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority, f.snapshot); assert.equal(replay.status, "idempotent"); assert.equal(replay.writeCondition, null);
  denied(f.contract.create({ commandId: "create-a", spec: { ...f.spec, mode: "analysis_only", filesystem: { ...f.spec.filesystem, writablePaths: [] } } }, f.authority, f.snapshot));
  const command = { commandId: "admit-a", expectedRevision: 1, fence: 0, action: { type: "admit" } }; const d = f.contract.apply(f.snapshot, command, f.authority); assert.ok(d.snapshot);
  const again = f.contract.apply(d.snapshot, command, { ...f.authority, now: 1001 }); assert.equal(again.status, "idempotent"); assert.deepEqual(again.snapshot, d.snapshot); assert.equal(again.newEvents.length, 0);
  denied(f.contract.apply(d.snapshot, { ...command, action: { type: "cancel" } }, f.authority));
});
test("stale authority/revision/fence/worker deny, duplicate workers require the same atomic store CAS", () => {
  const f = running();
  for (const auth of [{ ...f.authority, generation: 2 }, { ...f.authority, active: false }, { ...f.authority, actorId: "worker-b" }, { ...f.authority, workspaceId: "other" }, { ...f.authority, now: 1000001 }]) denied(f.contract.apply(f.snapshot, { commandId: "new", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "start_command", requestId: "cmd", commandPolicyId: "tests" } }, auth));
  for (const delta of [{ expectedRevision: 1 }, { fence: 0 }]) denied(f.contract.apply(f.snapshot, { commandId: "stale", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, ...delta, action: { type: "fail", failureCategory: "execution_failed" } }, f.authority));
  const a = created(); step(a, { type: "admit" }); const request = { commandId: "claim-a", expectedRevision: a.snapshot.revision, fence: 0, action: { type: "claim" } };
  const auth = { ...a.authority, now: a.snapshot.updatedAt + 1 };
  const x = a.contract.apply(a.snapshot, request, auth), y = a.contract.apply(a.snapshot, { ...request, commandId: "claim-b" }, { ...auth, actorId: "worker-b" });
  assert.equal(x.verdict, "allow"); assert.equal(y.verdict, "allow");
  assert.deepEqual(x.writeCondition, y.writeCondition); assert.equal(x.writeCondition?.expectedRevision, 2);
  denied(a.contract.apply(x.snapshot, { ...request, commandId: "claim-b" }, { ...a.authority, actorId: "worker-b" }));
});
test("command audit, artifacts, verification and completed result form a restart-validated snapshot", () => {
  const f = verified(); step(f, { type: "complete", result: { changedPaths: ["src/a.ts"], diff: artifact("diff"), report: artifact("report") } });
  assert.equal(f.snapshot.state, "completed"); assert.equal(f.snapshot.commands[0].exitCode, 0); assert.ok(f.snapshot.startedAt); assert.ok(f.snapshot.endedAt);
  const reload = domain.createSandboxExecutionContract(structuredClone(f.config)); assert.equal(reload.validateSnapshot(JSON.parse(JSON.stringify(f.snapshot))).ok, true);
  assert.ok(f.snapshot.events.some(e => e.kind === "command_allowed")); assert.ok(f.snapshot.events.some(e => e.kind === "execution_terminal"));
});
test("completed requires verification and path-bounded nonempty diff; raw outputs/URLs never artifacts", () => {
  const f = running(); const result = { changedPaths: ["src/a.ts"], diff: artifact(), report: artifact() };
  denied(f.contract.apply(f.snapshot, { commandId: "end", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "complete", result } }, f.authority));
  const g = verified();
  for (const wrong of [{ ...result, changedPaths: ["secrets/key"] }, { ...result, diff: null }, { ...result, report: { ...artifact(), url: "https://example.test/raw" } }, { ...result, stdout: "raw-output" }]) denied(g.contract.apply(g.snapshot, { commandId: "end", expectedRevision: g.snapshot.revision, fence: g.snapshot.fence, action: { type: "complete", result: wrong } }, g.authority));
});
test("unknown command outcome blocks execution, never ordinary automatic retry", () => {
  const f = running(); step(f, { type: "start_command", requestId: "cmd-a", commandPolicyId: "tests" });
  step(f, { type: "finish_command", requestId: "cmd-a", outcome: "outcome_unknown", exitCode: null, stdout: null, stderr: null });
  assert.equal(f.snapshot.state, "blocked"); assert.equal(f.snapshot.failureCategory, "outcome_unknown");
  denied(f.contract.apply(f.snapshot, { commandId: "again", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "start_command", requestId: "cmd-b", commandPolicyId: "tests" } }, f.authority));
});
for (const terminal of ["cancel", "block", "fail", "complete"]) test(`cleanup mandatory/idempotent after ${terminal}, bound to exact worktree and fence`, () => {
  const f = verified(); step(f, terminal === "complete" ? { type: "complete", result: { changedPaths: ["src/a.ts"], diff: artifact(), report: artifact() } } : terminal === "block" ? { type: terminal, failureCategory: "crashed" } : terminal === "fail" ? { type: terminal, failureCategory: "execution_failed" } : { type: terminal });
  step(f, { type: "begin_cleanup" });
  const c = { commandId: "cleanup-end", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "finish_cleanup", worktreeId: "exec-a", outcome: "completed" } };
  denied(f.contract.applyCleanup(f.snapshot, { ...c, action: { ...c.action, worktreeId: "exec-b" } }, { ...cleanupAuthority(f), now: f.snapshot.updatedAt }));
  const auth = { ...cleanupAuthority(f), now: f.snapshot.updatedAt + 1 };
  const d = f.contract.applyCleanup(f.snapshot, c, auth); assert.equal(d.snapshot?.cleanup.status, "completed"); assert.ok(d.snapshot);
  assert.equal(f.contract.applyCleanup(d.snapshot, c, auth).status, "idempotent");
});
test("cleanup survives approval revocation; no automatic takeover of a running owner", () => {
  const f = running(); const stale = f.snapshot;
  step(f, { type: "block", failureCategory: "crashed" }); f.authority.active = false; f.authority.generation = 2; f.authority.actorId = "recovery-worker";
  step(f, { type: "begin_cleanup" });
  denied(f.contract.applyCleanup(f.snapshot, { commandId: "old", expectedRevision: f.snapshot.revision, fence: stale.fence, action: { type: "finish_cleanup", worktreeId: "exec-a", outcome: "completed" } }, { ...cleanupAuthority(f), actorId: "worker-a", now: f.snapshot.updatedAt }));
  step(f, { type: "finish_cleanup", worktreeId: "exec-a", outcome: "completed" });
});
for (const field of ["revision", "fence", "state", "commands", "specFingerprint", "events"] as const) test(`tampered restart snapshot ${field} fails closed`, () => {
  const f = verified(), bad = structuredClone(f.snapshot) as unknown as Record<string, unknown>;
  bad[field] = field === "state" ? "completed" : field === "commands" || field === "events" ? [] : field === "specFingerprint" ? "c".repeat(64) : 999;
  assert.equal(f.contract.validateSnapshot(bad).ok, false);
});
test("hostile accessors/proxies/cycles/oversize never execute getters or leak input", () => {
  const f = fixture(); let reads = 0; const getter = Object.defineProperty({}, "schemaVersion", { enumerable: true, get() { reads++; throw Error("private-canary"); } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const spec of [null, getter, new Proxy({}, { ownKeys() { reads++; throw Error("private-canary"); } }), cycle, { ...f.spec, extra: "private-canary" }, { ...f.spec, executionId: "x".repeat(300000) }]) {
    const d = f.contract.create({ commandId: "new", spec }, f.authority); denied(d); assert.ok(!JSON.stringify(d).includes("private-canary"));
  }
  assert.equal(reads, 0);
});
test("reordered set-like grants/spec paths normalize deterministically without mutating caller input", () => {
  const a = fixture(), b = fixture(); b.spec.filesystem.readablePaths.reverse(); b.config.policy.readablePaths.reverse();
  const before = structuredClone({ spec: b.spec, config: b.config, authority: b.authority });
  const x = a.contract.create({ commandId: "create-a", spec: a.spec }, a.authority), y = domain.createSandboxExecutionContract(b.config).create({ commandId: "create-a", spec: b.spec }, b.authority);
  assert.deepEqual(x, y); assert.deepEqual(b.spec, before.spec);
});
test("read and write grants remain distinct, with segment boundaries and protected descendants", () => {
  const f = created(); assert.equal(f.contract.evaluatePath(f.snapshot.spec, { path: "tests/a.test.mts", access: "read" }).verdict, "allow");
  assert.equal(f.contract.evaluatePath(f.snapshot.spec, { path: "src/a.ts", access: "write" }).verdict, "allow");
  for (const path of ["tests/a.test.mts", "src2/a.ts", "src/.git/config", "src/node_modules/a.js", "src/.next/a.js", "src/.env", "secrets/a"]) denied(f.contract.evaluatePath(f.snapshot.spec, { path, access: "write" }));
});
test("captured configuration cannot be expanded by later caller mutation", () => {
  const f = created(), before = structuredClone(f.snapshot);
  f.config.policy.writablePaths.push("secrets"); f.spec.filesystem.writablePaths = ["secrets"]; f.spec.filesystem.readablePaths.push("secrets");
  denied(f.contract.create({ commandId: "create-b", spec: f.spec }, f.authority)); assert.deepEqual(f.snapshot, before);
});
test("fresh deeply frozen outputs and independent factory calls", () => {
  const f = fixture(), a = f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority), b = f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority);
  assert.deepEqual(a, b); assert.notEqual(a.snapshot, b.snapshot); assert.notEqual(a.snapshot?.spec, b.snapshot?.spec); frozen(a); frozen(b);
  assert.deepEqual(domain.createSandboxExecutionContract(f.config).create({ commandId: "create-a", spec: f.spec }, f.authority), a);
});
for (const generation of [0, -1, 1.1, 1000001]) test(`malformed authority generation ${generation}`, () => {
  const f = fixture(); denied(f.contract.create({ commandId: "create-a", spec: f.spec }, { ...f.authority, generation }));
});
test("expired/revoked admission and foreign project/workspace authority deny with null partial outputs", () => {
  const f = fixture();
  for (const auth of [{ ...f.authority, active: false }, { ...f.authority, expiresAt: 1000 }, { ...f.authority, workspaceId: "foreign" }, { ...f.authority, projectId: "foreign" }]) denied(f.contract.create({ commandId: "create-a", spec: f.spec }, auth));
});
test("wall-clock/owner lease exhaustion denies late command/result, control can still block and clean", () => {
  const f = running(), auth = { ...f.authority, now: f.snapshot.owner!.expiresAt };
  denied(f.contract.apply(f.snapshot, { commandId: "late", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "start_command", requestId: "late", commandPolicyId: "tests" } }, auth));
  const d = f.contract.apply(f.snapshot, { commandId: "stop", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "block", failureCategory: "timeout" } }, { ...auth, active: false, generation: 2 });
  assert.equal(d.snapshot?.state, "blocked"); assert.equal(d.snapshot?.owner, null);
});
test("one pending command, unique request IDs and bounded command history", () => {
  const f = running(); step(f, { type: "start_command", requestId: "r0", commandPolicyId: "tests" });
  const deniedRequest = f.contract.apply(f.snapshot, { commandId: "extra", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "start_command", requestId: "r1", commandPolicyId: "tests" } }, { ...f.authority, now: f.snapshot.updatedAt });
  denied(deniedRequest); assert.equal(deniedRequest.auditEvidence.kind, "command_denied");
  step(f, { type: "finish_command", requestId: "r0", outcome: "passed", exitCode: 0, stdout: null, stderr: null });
  for (let n = 1; n < domain.sandboxExecutionPlatformLimits.maxCommands; n++) {
    step(f, { type: "start_command", requestId: `r${n}`, commandPolicyId: "tests" });
    step(f, { type: "finish_command", requestId: `r${n}`, outcome: "passed", exitCode: 0, stdout: null, stderr: null });
  }
  denied(f.contract.apply(f.snapshot, { commandId: "overflow", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "start_command", requestId: "overflow", commandPolicyId: "tests" } }, { ...f.authority, now: f.snapshot.updatedAt }));
  step(f, { type: "complete", result: { changedPaths: ["src/a.ts"], diff: artifact(), report: artifact() } });
  step(f, { type: "begin_cleanup" }); step(f, { type: "finish_cleanup", worktreeId: "exec-a", outcome: "completed" });
  assert.equal(f.contract.validateSnapshot(f.snapshot).ok, true); assert.ok(f.snapshot.events.length < domain.sandboxExecutionPlatformLimits.maxEvents);
});
test("latest verification must pass; historical success cannot hide a newer failure", () => {
  const f = verified(); step(f, { type: "start_command", requestId: "second", commandPolicyId: "tests" });
  step(f, { type: "finish_command", requestId: "second", outcome: "failed", exitCode: 1, stdout: null, stderr: null });
  const d = f.contract.apply(f.snapshot, { commandId: "end", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence,
    action: { type: "complete", result: { changedPaths: ["src/a.ts"], diff: artifact(), report: artifact() } } }, { ...f.authority, now: f.snapshot.updatedAt });
  denied(d); assert.equal(d.reason, "verification_required");
});
for (const [outcome, exitCode] of [["passed", 1], ["failed", 0], ["timed_out", 1], ["outcome_unknown", 0], ["failed", 1.5]] as const) test(`incoherent command outcome ${outcome}/${exitCode}`, () => {
  const f = running(); step(f, { type: "start_command", requestId: "r", commandPolicyId: "tests" });
  denied(f.contract.apply(f.snapshot, { commandId: "finish", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "finish_command", requestId: "r", outcome, exitCode, stdout: null, stderr: null } }, { ...f.authority, now: f.snapshot.updatedAt }));
});
test("aggregate log budget is run-wide, not reset by each command", () => {
  const f = running(); step(f, { type: "start_command", requestId: "first", commandPolicyId: "tests" });
  step(f, { type: "finish_command", requestId: "first", outcome: "passed", exitCode: 0, stdout: artifact("full-log", 65536), stderr: null });
  step(f, { type: "start_command", requestId: "second", commandPolicyId: "tests" });
  const d = f.contract.apply(f.snapshot, { commandId: "end", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence,
    action: { type: "finish_command", requestId: "second", outcome: "passed", exitCode: 0, stdout: artifact("extra-log", 1), stderr: null } }, { ...f.authority, now: f.snapshot.updatedAt });
  denied(d); assert.equal(d.reason, "limit_exceeded");
});
test("late successful command is not accepted as on-time verification", () => {
  const f = running(); step(f, { type: "start_command", requestId: "r", commandPolicyId: "tests" });
  denied(f.contract.apply(f.snapshot, { commandId: "late-result", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence,
    action: { type: "finish_command", requestId: "r", outcome: "passed", exitCode: 0, stdout: null, stderr: null } }, { ...f.authority, now: f.snapshot.updatedAt + 120001 }));
});
test("cleanup failure is recorded, retries fenced/bounded, exact replay is no-op", () => {
  const f = running(); step(f, { type: "cancel" });
  for (let n = 0; n < domain.sandboxExecutionPlatformLimits.maxCleanupAttempts; n++) {
    step(f, { type: "begin_cleanup" }); const old = f.snapshot.fence;
    step(f, { type: "finish_cleanup", worktreeId: "exec-a", outcome: "failed" }); assert.ok(f.snapshot.fence > old);
  }
  denied(f.contract.applyCleanup(f.snapshot, { commandId: "too-many", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "begin_cleanup" } }, { ...cleanupAuthority(f), now: f.snapshot.updatedAt }));
  assert.equal(f.snapshot.cleanup.status, "failed"); assert.equal(f.snapshot.cleanup.attempts, 3);
});
test("cleanup in progress cannot be taken over by a second worker or a clock jump", () => {
  const f = running(); step(f, { type: "block", failureCategory: "crashed" }); step(f, { type: "begin_cleanup" });
  denied(f.contract.applyCleanup(f.snapshot, { commandId: "takeover", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "begin_cleanup" } }, { ...cleanupAuthority(f), actorId: "worker-b", now: f.snapshot.owner!.expiresAt + 1 }));
});
test("unknown command policy is denied with sanitized audit evidence, never shell or raw output", () => {
  const f = running(); const d = f.contract.apply(f.snapshot, { commandId: "unapproved", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence,
    action: { type: "start_command", requestId: "r", commandPolicyId: "deploy" } }, { ...f.authority, now: f.snapshot.updatedAt });
  denied(d); assert.equal(d.auditEvidence.kind, "command_denied"); assert.ok(!JSON.stringify(d).includes("deploy"));
});
for (const key of ["unknown", "provider", "runtime", "container", "hostRoot"]) test(`unknown configuration field ${key} rejected`, () => {
  const f = fixture(); assert.throws(() => domain.createSandboxExecutionContract({ ...f.config, [key]: "caller-selected" }), /^Error: invalid_sandbox_configuration$/u);
});
test("revocation generation cannot regress through subsequent terminal cleanup controls", () => {
  const f = running();
  const d = f.contract.apply(f.snapshot, { commandId: "revoke", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence,
    action: { type: "block", failureCategory: "policy_blocked" } }, { ...f.authority, now: f.snapshot.updatedAt, generation: 2, active: false });
  assert.ok(d.snapshot); assert.equal(d.snapshot.authorityGeneration, 2);
  denied(f.contract.applyCleanup(d.snapshot, { commandId: "stale-cleanup", expectedRevision: d.snapshot.revision, fence: d.snapshot.fence,
    action: { type: "begin_cleanup" } }, { ...cleanupAuthority(f), now: d.snapshot.updatedAt }));
});
test("unresolved command cannot be reclassified as an ordinary definitive failure", () => {
  const f = running(); step(f, { type: "start_command", requestId: "pending", commandPolicyId: "tests" });
  denied(f.contract.apply(f.snapshot, { commandId: "guess-failure", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence,
    action: { type: "fail", failureCategory: "execution_failed" } }, { ...f.authority, now: f.snapshot.updatedAt }));
  step(f, { type: "block", failureCategory: "outcome_unknown" });
  assert.equal(f.snapshot.commands[0].outcome, "outcome_unknown"); assert.equal(f.snapshot.failureCategory, "outcome_unknown");
});
for (const ref of ["production-db", "provider-credentials", "deployment-key", "exchange-key"]) test(`ungranted production credential reference ${ref} denied`, () => {
  const f = fixture(); f.spec.secrets = { mode: "ephemeral", refs: [ref], inheritEnvironment: false };
  const d = f.contract.create({ commandId: "create-a", spec: f.spec }, f.authority); denied(d); assert.equal(d.reason, "secret_denied");
  assert.ok(!JSON.stringify(d).includes(ref));
});
test("valid platform numbers still cannot expand policy resources or inherit host environment", () => {
  const f = fixture(); f.spec.resources.memoryMiB = 1024;
  const d = f.contract.create({ commandId: "expand", spec: f.spec }, f.authority); denied(d); assert.equal(d.reason, "limit_exceeded");
  f.spec.resources.memoryMiB = 512; f.spec.secrets.inheritEnvironment = true;
  denied(f.contract.create({ commandId: "inherit", spec: f.spec }, f.authority));
});
test("M-NET: explicit deny-all survives normalization exactly; missing/malformed policy denies", () => {
  const f = created(); assert.deepEqual(f.snapshot.spec.network, { mode: "deny_all", destinations: [] });
  for (const network of [undefined, null, {}, { mode: "allowlisted", destinations: [] }]) {
    const spec = { ...f.spec, network }; denied(f.contract.create({ commandId: "bad-network", spec }, f.authority));
  }
});
test("M-REV: stale revision alone denies with valid time, owner, identity and fence", () => {
  const f = running(), before = structuredClone(f.snapshot), auth = { ...f.authority, now: f.snapshot.updatedAt + 1 };
  const command = { commandId: "old-revision", expectedRevision: f.snapshot.revision - 1, fence: f.snapshot.fence, action: { type: "fail", failureCategory: "execution_failed" } };
  const d = f.contract.apply(f.snapshot, command, auth); denied(d); assert.equal(d.reason, "stale_revision");
  assert.deepEqual(d, f.contract.apply(f.snapshot, command, auth)); assert.deepEqual(f.snapshot, before);
});
test("M-LIFE: an owned admitted/preparing execution cannot skip ready", () => {
  const f = created(); step(f, { type: "admit" }); step(f, { type: "claim" });
  for (const preparing of [false, true]) {
    if (preparing) step(f, { type: "prepare" });
    const d = f.contract.apply(f.snapshot, { commandId: "skip-ready", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "start" } }, { ...f.authority, now: f.snapshot.updatedAt + 1 });
    denied(d); assert.equal(d.reason, "invalid_transition");
  }
});
test("M-RAM: normative platform max 16384 admits; trusted policy max+1 is invalid", () => {
  const f = fixture(); f.config.policy.resources.memoryMiB = 16384; f.spec.resources.memoryMiB = 16384;
  assert.equal(domain.createSandboxExecutionContract(f.config).create({ commandId: "at-max", spec: f.spec }, f.authority).verdict, "allow");
  f.config.policy.resources.memoryMiB = 16385; f.spec.resources.memoryMiB = 16385;
  assert.throws(() => domain.createSandboxExecutionContract(f.config), /invalid_sandbox_configuration/u);
});
test("historical restore and cleanup-only survive policy/approval rotation without resuming execution", () => {
  const f = running(); step(f, { type: "cancel" }); const saved = structuredClone(f.snapshot), config = structuredClone(f.config);
  config.policy.revision = 2; config.grants[0].policyRevision = 2; config.grants[0].approvalRef = "new-approval";
  config.policy.writablePaths = []; config.policy.readablePaths = ["tests"]; config.policy.ephemeralSecrets = [];
  const contract = domain.createSandboxExecutionContract(config); assert.equal(contract.validateSnapshot(saved).ok, true);
  const current = { ...f.authority, now: saved.updatedAt + 1, generation: 2, active: false };
  denied(contract.apply(saved, { commandId: "resume", expectedRevision: saved.revision, fence: saved.fence, action: { type: "start" } }, current));
  const command = { commandId: "cleanup", expectedRevision: saved.revision, fence: saved.fence, action: { type: "begin_cleanup" } };
  const d = contract.applyCleanup(saved, command, { ...cleanupAuthority(f), generation: 2, now: current.now });
  assert.equal(d.verdict, "allow"); assert.equal(d.authorityScope, "cleanup_only"); assert.equal(d.snapshot?.state, "cancelled"); assert.ok(d.snapshot);
  const done = contract.applyCleanup(d.snapshot, { commandId: "cleanup-end", expectedRevision: d.snapshot.revision, fence: d.snapshot.fence,
    action: { type: "finish_cleanup", worktreeId: "exec-a", outcome: "completed" } }, { ...cleanupAuthority(f), generation: 2, now: current.now + 1 });
  assert.equal(done.snapshot?.cleanup.status, "completed"); assert.equal(done.snapshot?.state, "cancelled"); assert.equal(contract.validateSnapshot(done.snapshot).ok, true);
  assert.deepEqual(saved, f.snapshot);
});
for (const maxFiles of [1, 31, 32, 33, 63, 64]) test(`effective maxFiles ${maxFiles} accepts exactly its boundary`, () => {
  const input = fixture(); input.spec.artifacts.maxFiles = maxFiles; const f = created(input);
  for (const type of ["admit", "claim", "prepare"]) step(f, { type }); step(f, { type: "ready", evidence: artifact() }); step(f, { type: "start" });
  step(f, { type: "start_command", requestId: "verify", commandPolicyId: "tests" }); step(f, { type: "finish_command", requestId: "verify", outcome: "passed", exitCode: 0, stdout: null, stderr: null });
  step(f, { type: "complete", result: { changedPaths: Array.from({ length: maxFiles }, (_, n) => `src/file-${n}.ts`), diff: artifact(), report: artifact() } });
  assert.equal(f.snapshot.result?.changedPaths.length, maxFiles); assert.equal(f.contract.validateSnapshot(f.snapshot).ok, true);
});
for (const maxFiles of [0, 65, -1, 1.5]) test(`invalid requested maxFiles ${maxFiles}`, () => {
  const f = fixture(); f.spec.artifacts.maxFiles = maxFiles; denied(f.contract.create({ commandId: "bad-limit", spec: f.spec }, f.authority));
});
for (const limit of [12, 64]) test(`observed files cannot exceed admitted ${limit}; no silent truncation`, () => {
  const input = fixture(); input.spec.artifacts.maxFiles = limit; const f = created(input);
  for (const type of ["admit", "claim", "prepare"]) step(f, { type }); step(f, { type: "ready", evidence: artifact() }); step(f, { type: "start" });
  step(f, { type: "start_command", requestId: "verify", commandPolicyId: "tests" }); step(f, { type: "finish_command", requestId: "verify", outcome: "passed", exitCode: 0, stdout: null, stderr: null });
  const result = (count: number) => ({ changedPaths: Array.from({ length: count }, (_, n) => `src/file-${n}.ts`), diff: artifact(), report: artifact() });
  denied(f.contract.apply(f.snapshot, { commandId: "overflow", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "complete", result: result(limit + 1) } }, { ...f.authority, now: f.snapshot.updatedAt }));
  step(f, { type: "complete", result: result(limit) }); assert.equal(f.snapshot.result?.changedPaths.length, limit);
});
for (const [key, value] of [["workspaceId", "foreign"], ["projectId", "foreign"], ["executionId", "foreign"], ["worktreeId", "foreign"], ["resourceGeneration", 2], ["specFingerprint", "c".repeat(64)]] as const) test(`cleanup-only rejects foreign/reused resource ${key}`, () => {
  const f = running(); step(f, { type: "cancel" });
  const d = f.contract.applyCleanup(f.snapshot, { commandId: "cleanup", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "begin_cleanup" } }, { ...cleanupAuthority(f), now: f.snapshot.updatedAt, [key]: value });
  denied(d); assert.equal(d.authorityScope, null);
});
test("old cleanup cannot target a reused worktree generation even with current revision/fence", () => {
  const old = running(); step(old, { type: "cancel" }); const stale = cleanupAuthority(old);
  const input = fixture(); input.config.grants[0].resourceGeneration = 2; input.spec.checkout.resourceGeneration = 2; input.contract = domain.createSandboxExecutionContract(input.config);
  const next = created(input); step(next, { type: "cancel" });
  denied(next.contract.applyCleanup(next.snapshot, { commandId: "delete-reused", expectedRevision: next.snapshot.revision, fence: next.snapshot.fence,
    action: { type: "begin_cleanup" } }, { ...stale, now: next.snapshot.updatedAt + 1, generation: 2 }));
  const d = step(next, { type: "begin_cleanup" }); assert.equal(d.writeCondition?.resourceGeneration, 2);
});
test("cleanup authority is not execution authority; only cleanup methods/actions accept it", () => {
  const f = running(); step(f, { type: "cancel" }); const auth = { ...cleanupAuthority(f), now: f.snapshot.updatedAt + 1 };
  for (const action of [{ type: "admit" }, { type: "claim" }, { type: "prepare" }, { type: "start" }, { type: "cancel" }, { type: "block", failureCategory: "crashed" },
    { type: "start_command", requestId: "evil", commandPolicyId: "tests" }, { type: "complete", result: { changedPaths: ["src/a.ts"], diff: artifact(), report: artifact() } }]) {
    const command = { commandId: "not-cleanup", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action };
    denied(f.contract.applyCleanup(f.snapshot, command, auth)); denied(f.contract.apply(f.snapshot, command, auth));
  }
  denied(f.contract.apply(f.snapshot, { commandId: "wrong-path", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "begin_cleanup" } }, { ...f.authority, now: auth.now }));
});
test("stale cleanup revision/fence and expired authority deny in isolation; replay has no new write", () => {
  const f = running(); step(f, { type: "cancel" }); const command = { commandId: "cleanup", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "begin_cleanup" } };
  const auth = { ...cleanupAuthority(f), now: f.snapshot.updatedAt + 1 };
  for (const change of [{ expectedRevision: command.expectedRevision - 1 }, { fence: command.fence - 1 }]) denied(f.contract.applyCleanup(f.snapshot, { ...command, ...change }, auth));
  denied(f.contract.applyCleanup(f.snapshot, command, { ...auth, expiresAt: auth.now }));
  const d = f.contract.applyCleanup(f.snapshot, command, auth); assert.ok(d.snapshot); frozen(d); assert.equal(d.authorityScope, "cleanup_only"); assert.equal(d.normalizedCommand, null);
  const replay = f.contract.applyCleanup(d.snapshot, command, { ...auth, now: auth.now + 1 }); assert.equal(replay.status, "idempotent"); assert.equal(replay.writeCondition, null); assert.deepEqual(replay.newEvents, []);
  assert.notEqual(replay.snapshot, d.snapshot); frozen(replay);
});
test("policy rotation denies running progression, old exact replay, path/command helpers; permits cancel then cleanup", () => {
  const f = running(), config = structuredClone(f.config); config.policy.revision = 2; config.grants[0].policyRevision = 2;
  const contract = domain.createSandboxExecutionContract(config), auth = { ...f.authority, now: f.snapshot.updatedAt + 1 };
  const current = { commandId: "continue", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "start_command", requestId: "new", commandPolicyId: "tests" } };
  const d = contract.apply(f.snapshot, current, auth); denied(d); assert.equal(d.reason, "stale_authority");
  const e = f.snapshot.events.at(-1)!;
  denied(contract.apply(f.snapshot, { commandId: e.commandId, expectedRevision: e.expectedRevision, fence: e.fence, action: e.action }, auth));
  denied(contract.evaluateCommand(f.snapshot.spec, f.spec.commands[0])); denied(contract.evaluatePath(f.snapshot.spec, { path: "src/a.ts", access: "read" }));
  const stopped = contract.apply(f.snapshot, { ...current, commandId: "stop", action: { type: "cancel" } }, { ...auth, active: false, generation: 2 }); assert.ok(stopped.snapshot);
  const clean = contract.applyCleanup(stopped.snapshot, { commandId: "cleanup", expectedRevision: stopped.snapshot.revision, fence: stopped.snapshot.fence, action: { type: "begin_cleanup" } }, { ...cleanupAuthority(f), now: auth.now + 1, generation: 2 });
  assert.equal(clean.verdict, "allow"); assert.equal(clean.authorityScope, "cleanup_only"); assert.equal(contract.validateSnapshot(clean.snapshot).ok, true);
});
test("historical restore remains tenant scoped and does not authenticate forged admission", () => {
  const f = running(), config = structuredClone(f.config); config.workspaceId = "other-workspace";
  assert.equal(domain.createSandboxExecutionContract(config).validateSnapshot(f.snapshot).ok, false);
  const bad = { ...structuredClone(f.snapshot), spec: { ...f.snapshot.spec, checkout: { ...f.snapshot.spec.checkout, resourceGeneration: 2 } } };
  assert.equal(f.contract.validateSnapshot(bad).ok, false);
});
test("cleanup survives removal of active project/grant/command/secret permissions", () => {
  const f = running(); step(f, { type: "cancel" }); const config = structuredClone(f.config);
  config.projects = []; config.grants = []; config.policy.commands = []; config.policy.ephemeralSecrets = [];
  config.policy.readablePaths = []; config.policy.writablePaths = []; config.policy.revision = 2;
  const current = domain.createSandboxExecutionContract(config); assert.equal(current.validateSnapshot(f.snapshot).ok, true);
  const d = current.applyCleanup(f.snapshot, { commandId: "cleanup-no-active-grant", expectedRevision: f.snapshot.revision, fence: f.snapshot.fence, action: { type: "begin_cleanup" } },
    { ...cleanupAuthority(f), generation: 2, now: f.snapshot.updatedAt + 1 });
  assert.equal(d.verdict, "allow"); assert.equal(d.authorityScope, "cleanup_only");
  denied(current.create({ commandId: "no-create", spec: f.spec }, { ...f.authority, now: f.snapshot.updatedAt + 1 }));
  denied(current.evaluatePath(f.spec, { path: "src/a.ts", access: "write" }));
});
for (const outcome of ["completed", "failed"] as const) test(`${outcome} + cleanup_failed preserves exact execution outcome/result`, () => {
  const f = verified(); step(f, outcome === "completed" ? { type: "complete", result: { changedPaths: ["src/a.ts"], diff: artifact("diff"), report: artifact("report") } } : { type: "fail", failureCategory: "verification_failed" });
  const before = { state: f.snapshot.state, result: f.snapshot.result, failureCategory: f.snapshot.failureCategory, endedAt: f.snapshot.endedAt };
  step(f, { type: "begin_cleanup" }); step(f, { type: "finish_cleanup", worktreeId: "exec-a", outcome: "failed" });
  assert.deepEqual({ state: f.snapshot.state, result: f.snapshot.result, failureCategory: f.snapshot.failureCategory, endedAt: f.snapshot.endedAt }, before);
  assert.equal(f.snapshot.cleanup.status, "failed"); assert.equal(f.contract.validateSnapshot(f.snapshot).ok, true);
});
function networkFixture() {
  const f = fixture(); f.config.policy.network = { mode: "allowlisted", destinations: [{ scheme: "https", hostname: "example.test", port: 443 }] };
  f.spec.network = structuredClone(f.config.policy.network); f.contract = domain.createSandboxExecutionContract(f.config); return f;
}
const peerEvidence = () => ({ resolvedAddresses: ["8.8.8.8"], connectedAddress: "8.8.8.8", redirected: false, tlsHostnameVerified: true, platformPolicyAllows: true });
for (const hostname of ["example.test", "EXAMPLE.TEST", "Example.Test."]) test(`HTTPS destination canonical hostname ${hostname}`, () => {
  const f = networkFixture(), request = { scheme: "https", hostname }, evidence = peerEvidence(), before = structuredClone({ request, evidence, spec: f.spec });
  const d = f.contract.evaluateNetworkAccess(f.spec, request, evidence); assert.equal(d.verdict, "allow"); assert.equal(d.authorityScope, "policy_only"); assert.equal(d.runtimeDispatchAllowed, false); frozen(d);
  assert.deepEqual(d, f.contract.evaluateNetworkAccess(f.spec, { ...request, port: 443 }, evidence)); assert.deepEqual({ request, evidence, spec: f.spec }, before);
});
for (const hostname of ["evil-example.test", "example.test.evil", "*.example.test", "example.test..", "bad-.test", "example.-test", "user@example.test", "example.test/path", "example.test?x", "127.0.0.1", "127.1", "2130706433", "0x7f000001", "[::1]", "::1", "localhost"]) test(`network destination rejects ${hostname}`, () => {
  const f = networkFixture(); denied(f.contract.evaluateNetworkAccess(f.spec, { scheme: "https", hostname, port: 443 }, peerEvidence()));
});
for (const scheme of ["http", "ssh", "git", "ftp", "file", "javascript", "https:", "HTTPS"]) test(`unsupported network scheme ${scheme}`, () => {
  const f = networkFixture(); denied(f.contract.evaluateNetworkAccess(f.spec, { scheme, hostname: "example.test", port: 443 }, peerEvidence()));
});
test("HTTPS ports are exact authority; canonical destination rules dedup after normalization", () => {
  const f = networkFixture(); denied(f.contract.evaluateNetworkAccess(f.spec, { scheme: "https", hostname: "example.test", port: 8443 }, peerEvidence()));
  f.config.policy.network.destinations.push({ scheme: "https", hostname: "example.test", port: 8443 }); f.spec.network = structuredClone(f.config.policy.network); f.contract = domain.createSandboxExecutionContract(f.config);
  assert.equal(f.contract.evaluateNetworkAccess(f.spec, { scheme: "https", hostname: "example.test", port: 8443 }, peerEvidence()).verdict, "allow");
  f.spec.network.destinations.push({ scheme: "https", hostname: "EXAMPLE.TEST.", port: 443 }); denied(f.contract.create({ commandId: "duplicate", spec: f.spec }, f.authority));
});
for (const address of ["0.0.0.0", "10.1.2.3", "100.100.100.200", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "168.63.129.16", "::", "::1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002:0808:0808::1", "3fff::1", "fe80::1%lo0", "not-an-ip"]) test(`pure DNS/peer probe denies special address ${address}`, () => {
  const f = networkFixture(), d = f.contract.evaluateNetworkAccess(f.spec, { scheme: "https", hostname: "example.test" }, { ...peerEvidence(), resolvedAddresses: [address], connectedAddress: address }); denied(d);
});
test("all DNS answers and actual peer must remain authorized; rebinding, redirects, TLS/platform ambiguity deny", () => {
  const f = networkFixture(), request = { scheme: "https", hostname: "example.test", port: 443 };
  for (const evidence of [{ ...peerEvidence(), resolvedAddresses: ["8.8.8.8", "10.0.0.1"] }, { ...peerEvidence(), connectedAddress: "1.1.1.1" },
    { ...peerEvidence(), connectedAddress: "127.0.0.1" }, { ...peerEvidence(), redirected: true }, { ...peerEvidence(), tlsHostnameVerified: false },
    { ...peerEvidence(), platformPolicyAllows: false }, { ...peerEvidence(), platformPolicyAllows: undefined }, { ...peerEvidence(), resolvedAddresses: [] }]) denied(f.contract.evaluateNetworkAccess(f.spec, request, evidence));
  for (const address of ["1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(f.contract.evaluateNetworkAccess(f.spec, request, { ...peerEvidence(), resolvedAddresses: [address], connectedAddress: address }).verdict, "allow");
  const denyAll = fixture(); denied(denyAll.contract.evaluateNetworkAccess(denyAll.spec, request, peerEvidence()));
  assert.equal(domain.sandboxNetworkContractV1.enforcement, "not_implemented"); assert.equal(domain.sandboxNetworkContractV1.redirects, "deny");
});
