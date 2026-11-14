import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { workload, unitExecution } from "./fixtures/executor-portability.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { seam, claudeFixture, fake, memoryClaude } from "./fixtures/claude-managed.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { frozen } from "./fixtures/executor-outcome.mts";
for (const provider of ["openai", "anthropic"] as const) {
  test(`D ${provider} same admission/task/plan/repository/scope and proposal semantics`, async () => {
    const f = workload(provider, "claude-work"), other = workload(provider === "openai" ? "anthropic" : "openai", "claude-work");
    for (const key of ["admission", "repository", "developmentRun"] as const) assert.deepEqual(f.configuration[key], other.configuration[key]);
    assert.deepEqual(f.invocation.allowedPaths, other.invocation.allowedPaths);
    const x = await unitExecution(provider, "success"); assert.equal(x.calls, 1); assert.equal(x.decision.verdict, "allow");
    const r = x.decision.normalizedResult!; assert.equal(r.ownerDecisionRequired, true); assert.equal(r.verificationStatus, "not_run"); assert.equal(r.automaticRetryAllowed, false); frozen(r);
    assert.equal(r.changes[0].content, "export const answer = 42;\n");
  });
  test(`D ${provider} malformed provider data cannot become a terminal proposal`, async () => {
    const x = await unitExecution(provider, "malformed"); assert.equal(x.decision.normalizedResult, null); assert.equal(x.calls, 1);
  });
  test(`D ${provider} policy refuses other provider, model/account/executor or context swaps`, () => {
    const f = workload(provider, "policy-isolation"), before = structuredClone(f.raw);
    for (const target of [{ ...f.target, providerId: provider === "openai" ? "anthropic" : "openai" }, { ...f.target, providerId: "claude" }])
      assert.equal(seam.prepareExecutorProviderRequest(f.policy, f.invocation, f.context, target, 10000, f.workspaceIdentity), null);
    assert.deepEqual(f.raw, before);
  });
}
test("D cross-provider normalized proposals equivalent except factual executor identity", async () => {
  const a = (await unitExecution("openai", "success")).decision.normalizedResult!, b = (await unitExecution("anthropic", "success")).decision.normalizedResult!;
  assert.notDeepEqual(a.identity, b.identity); assert.deepEqual({ ...a, identity: null }, { ...b, identity: null });
});
test("D known-ID read port has no mutation capability, even when probed adversarially", async () => {
  const f = claudeFixture(), provider = fake.createClaudeManagedFakeProvider(f.script), read = fake.openClaudeFakeRead(provider.retrieval)!;
  const forbidden = (read as unknown as Record<string, unknown>).createSession;
  if (typeof forbidden === "function") await forbidden();
  assert.equal(provider.stats().creates, 0); assert.deepEqual(Object.keys(read).sort(), ["listEvents", "retrieveSession"]);
});
test("D Claude changed executor, repository/context and hostile invocation cannot create provider work", async () => {
  for (const change of [(f: ReturnType<typeof claudeFixture>) => { f.raw.identity = { id: "openai-agents", version: "v1" }; },
    (f: ReturnType<typeof claudeFixture>) => { f.raw.repository = { ...f.raw.repository, baseline: "b".repeat(40) }; },
    (f: ReturnType<typeof claudeFixture>) => { f.context.files[0].content = "different context"; }]) {
    const f = claudeFixture(); change(f); const m = memoryClaude(f); assert.equal((await m.executor.execute(f.raw, m.startCapability)).normalizedResult, null); assert.equal(m.provider.stats().creates, 0);
  }
  let traps = 0; const m = memoryClaude(), hostile = new Proxy({}, { ownKeys() { traps++; throw Error("private-canary"); } });
  assert.equal((await m.executor.execute(hostile, m.startCapability)).verdict, "deny"); assert.equal(m.provider.stats().creates, 0); assert.equal(traps, 0);
});
test("D complete history must fit four pages; a final answer hidden behind the bound never escapes", async () => {
  const f = claudeFixture(), original = structuredClone(f.script.pages[0]);
  f.script.pages = Array.from({ length: 5 }, (_, n) => ({ sessionId: original.sessionId, after: n ? `cursor_${n}` : null,
    next: n === 4 ? null : `cursor_${n + 1}`, hasMore: n !== 4, events: [original.events[n === 0 ? 0 : n === 4 ? 2 : 1]] }));
  const m = memoryClaude(f); assert.equal((await m.executor.execute(f.raw, m.startCapability)).normalizedResult, null); assert.equal(m.provider.stats().creates, 1);
});
