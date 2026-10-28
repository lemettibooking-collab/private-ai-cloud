import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { claudeFixture, memoryClaude, request, seam, fake, execution } from "./fixtures/claude-managed.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { frozen } from "./fixtures/executor-outcome.mts";
test("C canonical policy is deterministic, immutable, tools-off; all input/config facts bound", () => {
  const f = claudeFixture(), before = structuredClone(f.profile), body = JSON.parse(f.prepared.body);
  assert.deepEqual([body.tools, body.skills, body.mcp_servers], [[], [], []]); assert.equal(body.initial_events.length, 1);
  const again = seam.prepareExecutorProviderRequest(f.policy, f.invocation, f.context, f.target, 10000, f.workspaceIdentity);
  assert.deepEqual(again, f.prepared); assert.notEqual(again, f.prepared); frozen(again); assert.deepEqual(f.profile, before);
  assert.notEqual(body.agent.id, f.invocation.identity.id); assert.equal(body.profile, "claude-managed-fake-v1");
});
test("C one acknowledged start -> one fake Create; known-ID inspector is read-only and fresh", async () => {
  const m = memoryClaude(), before = structuredClone({ raw: m.f.raw, script: m.f.script });
  const first = await m.executor.execute(m.f.raw, m.startCapability); assert.equal(first.verdict, "allow");
  assert.equal(first.normalizedResult?.ownerDecisionRequired, true); assert.equal(first.normalizedResult?.verificationStatus, "not_run"); assert.equal(first.normalizedResult?.automaticRetryAllowed, false);
  assert.equal(m.provider.stats().transmittedFingerprint, m.f.prepared.requestFingerprint);
  const a = await m.inspector.inspect(m.f.raw), b = await m.inspector.inspect(m.f.raw); assert.deepEqual(a, b); assert.notEqual(a.normalizedResult, b.normalizedResult); frozen(a);
  assert.deepEqual(Object.keys(m.inspector).sort(), ["inspect", "realDispatch", "realRetrieval"]);
  assert.deepEqual(Object.keys(fake.openClaudeFakeRead(m.provider.retrieval)!).sort(), ["listEvents", "retrieveSession"]);
  assert.equal((await m.executor.execute(m.f.raw, m.startCapability)).normalizedResult, null); assert.equal(m.provider.stats().creates, 1);
  assert.deepEqual({ raw: m.f.raw, script: m.f.script }, before);
});
for (const mode of ["timeout", "error", "missing-id"]) test(`C ${mode} holds, null result, no second Create`, async () => {
  const f = claudeFixture(); if (mode === "missing-id") f.script.session.id = ""; else f.script.createOutcome = mode;
  const m = memoryClaude(f), d = await m.executor.execute(f.raw, m.startCapability);
  assert.equal(d.status, "recovery_required"); assert.equal(d.normalizedResult, null); assert.equal(d.automaticRetryAllowed, false);
  await m.executor.execute(f.raw, m.startCapability); assert.equal(m.provider.stats().creates, 1); assert.equal(m.facts().recovery, true);
  const reads = m.provider.stats().reads; assert.equal((await m.inspector.inspect(f.raw)).verdict, "deny"); assert.equal(m.provider.stats().reads, reads);
});
for (const capability of [null, {}, { kind: "fixture_only_start" }]) test(`C forged/cloned start ${JSON.stringify(capability)} cannot dispatch`, async () => {
  const m = memoryClaude(); assert.equal((await m.executor.execute(m.f.raw, capability)).verdict, "deny"); assert.equal(m.provider.stats().creates, 0);
});
const sessionAttacks: Record<string, (f: ReturnType<typeof claudeFixture>) => void> = {
  provider: f => { f.script.session.providerId = "openai"; }, account: f => { f.script.session.accountId = "account-b"; }, model: f => { f.script.session.modelId = "other-model"; },
  config: f => { f.script.session.configurationDigest = "e".repeat(64); }, input: f => { f.script.session.initialInput += "changed"; },
  correlation: f => { f.script.session.correlationFingerprint = "f".repeat(64); }, request: f => { f.script.session.requestFingerprint = "f".repeat(64); },
  tools: f => { f.script.session.tools = ["shell"]; }, skills: f => { f.script.session.skills = ["skill"]; }, mcp: f => { f.script.session.mcp_servers = ["mcp"]; },
  idle: f => { f.script.session.stopReason = null; }, running: f => { f.script.session.status = "running"; }, rescheduling: f => { f.script.session.status = "rescheduling"; }, terminated: f => { f.script.session.status = "terminated"; },
  action: f => { f.script.session.stopReason = "requires_action"; }, budget: f => { f.script.session.stopReason = "budget_reached"; }, overshoot: f => { f.script.session.budgetOvershoot = true; },
  quiescence: f => { f.script.session.quiescent = false; }, error: f => { f.script.session.error = "private-provider-error-canary"; },
};
for (const [label, change] of Object.entries(sessionAttacks)) test(`C session ${label}: no terminal result/raw leakage`, async () => {
  const f = claudeFixture(); change(f); const m = memoryClaude(f), d = await m.executor.execute(f.raw, m.startCapability);
  assert.equal(d.verdict, "deny"); assert.equal(d.normalizedResult, null); assert.equal(m.facts().recovery, true); assert.doesNotMatch(JSON.stringify(d), /private-provider-error-canary/u);
});
const eventAttacks: Record<string, (f: ReturnType<typeof claudeFixture>) => void> = {
  conflicting: f => { f.script.pages[0].events.push({ ...f.script.pages[0].events[1], content: "conflict" }); },
  missing: f => { f.script.pages[0].events.pop(); }, order: f => { f.script.pages[0].events.reverse(); },
  loop: f => { f.script.pages[0].hasMore = true; f.script.pages[0].next = "cursor"; f.script.pages.push({ ...f.script.pages[0], after: "cursor" }); },
  incomplete: f => { f.script.pages[0].hasMore = true; f.script.pages[0].next = "missing"; },
  unknown: f => { f.script.pages[0].events[1].type = "tool.call"; }, oversized: f => { f.script.pages[0].events = Array.from({ length: 65 }, () => f.script.pages[0].events[1]); },
  output: f => { f.script.pages[0].events[1].content = "x".repeat(262145); },
  secret: f => { f.script.pages[0].events[1].content = f.script.pages[0].events[1].content.replace("Owner review required.", "api_key=secret-canary"); },
  path: f => { f.script.pages[0].events[1].content = f.script.pages[0].events[1].content.replace("src/a.ts", ".env.local"); },
};
for (const [label, change] of Object.entries(eventAttacks)) test(`C history ${label}: fail closed`, async () => {
  const f = claudeFixture(); change(f);
  if (label === "output" || label === "oversized") { assert.throws(() => memoryClaude(f)); return; }
  const m = memoryClaude(f), d = await m.executor.execute(f.raw, m.startCapability); assert.equal(d.normalizedResult, null); assert.doesNotMatch(JSON.stringify(d), /secret-canary/u);
});
test("C exact duplicate observations are idempotent; conflicting duplicate cannot be chosen", async () => {
  const f = claudeFixture(); f.script.pages[0].events.push({ ...f.script.pages[0].events[1] });
  const m = memoryClaude(f); assert.equal((await m.executor.execute(f.raw, m.startCapability)).verdict, "allow");
});
test("C hostile profile/context/provider handles never invoke getters/proxies or external callbacks", () => {
  let traps = 0; const hostile = new Proxy({}, { ownKeys() { traps++; throw Error("private"); } });
  assert.throws(() => request.createClaudeManagedRequestPolicy(hostile)); assert.throws(() => fake.createClaudeManagedFakeProvider(hostile));
  assert.equal(fake.openClaudeFakeStart({ kind: "claude_fake_start" }), null); assert.equal(fake.openClaudeFakeRead({ kind: "claude_fake_read" }), null);
  const m = memoryClaude(); assert.throws(() => execution.createClaudeManagedAgentsFakeInspector({ ...m, readClient: { retrieveSession() { traps++; } } })); assert.equal(traps, 0);
});
for (const field of ["modelId", "accountId", "agent", "environment", "repository", "workspaceMappingDigest", "contextManifestFingerprint", "networkProfile", "toolProfile", "secretsProfile", "apiProfile", "maximumExposureUsdMicros"]) test(`C approved ${field} is bound or unsupported`, async () => {
  const f = claudeFixture(), profile = structuredClone(f.profile);
  const changes: Record<string, unknown> = { modelId: "other", accountId: "other", agent: { ...profile.agent, version: 2 }, environment: { ...profile.environment, configurationDigest: "e".repeat(64) },
    repository: { ...profile.repository, baseline: "b".repeat(40) }, workspaceMappingDigest: "e".repeat(64), contextManifestFingerprint: "e".repeat(64), networkProfile: "all", toolProfile: "shell", secretsProfile: "injected", apiProfile: "latest", maximumExposureUsdMicros: 10000 };
  Object.assign(profile, { [field]: changes[field] });
  let p; try { p = request.createClaudeManagedRequestPolicy(profile); } catch { return; }
  const changed = seam.prepareExecutorProviderRequest(p, f.invocation, f.context, f.target, 10000, f.workspaceIdentity);
  assert.notEqual(changed?.requestFingerprint, f.prepared.requestFingerprint);
});
