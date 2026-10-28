import assert from "node:assert/strict";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration, executorRequest, context } from "./durable-executor.mts";
const contract = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const request = await import(new URL("../../lib/executors/claude-managed-request.ts", import.meta.url).href) as typeof import("../../lib/executors/claude-managed-request");
const seam = await import(new URL("../../lib/executors/executor-provider-request.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-provider-request");
const fake = await import(new URL("../../lib/executors/claude-managed-fake-provider.ts", import.meta.url).href) as typeof import("../../lib/executors/claude-managed-fake-provider");
const execution = await import(new URL("../../lib/executors/claude-managed-executor.ts", import.meta.url).href) as typeof import("../../lib/executors/claude-managed-executor");
const outcome = await import(new URL("../../lib/executors/executor-outcome.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-outcome");
export { request, seam, fake, execution, contract };
export const workspace = "00000000-0000-4000-8000-0000000000a1";
export function claudeFixture(id = "claude-work", n = 1, workspaceIdentity = workspace, accountId = "account-a") {
  const configuration: ReturnType<typeof executorConfiguration> = { ...executorConfiguration(n, id), identity: { ...request.claudeExecutorIdentity } };
  const raw = { ...executorRequest(n, id), identity: configuration.identity };
  const adapter = contract.createExecutorAdapterContract(configuration).adapter!;
  const invocation = adapter.validateInvocation(raw).normalizedInvocation; assert.ok(invocation);
  const approvedContext = context(), target = { providerId: "anthropic", modelId: "explicit-test-model", accountId };
  const profile = { providerId: "anthropic", modelId: target.modelId, accountId, workspaceMappingDigest: "b".repeat(64),
    agent: { id: "agent_fixture", version: 1, configurationDigest: "c".repeat(64) }, environment: { id: "environment_fixture", configurationDigest: "d".repeat(64) },
    repository: configuration.repository, contextManifestFingerprint: request.claudeContext(approvedContext, invocation).manifestFingerprint,
    toolProfile: "tools_off", networkProfile: "network_off", secretsProfile: "no_secrets", runtimeProfile: "provider_hosted_fake",
    apiProfile: "claude-managed-fake-v1", outputSchema: "pac-proposal-v1", maximumExposureUsdMicros: 20000 };
  const policy = request.createClaudeManagedRequestPolicy(profile);
  const prepared = seam.prepareExecutorProviderRequest(policy, invocation, approvedContext, target, 10000, workspaceIdentity); assert.ok(prepared);
  const body = JSON.parse(prepared.body);
  const script = { createOutcome: "reply", delayMs: 0, session: { id: `session_${id}`, providerId: "anthropic", accountId, modelId: target.modelId,
    requestFingerprint: prepared.requestFingerprint, correlationFingerprint: prepared.correlationFingerprint, configurationDigest: body.metadata.pac_configuration,
    initialInput: body.initial_events[0].content as string, status: "idle", stopReason: "end_turn" as string | null, quiescent: true, error: null as unknown,
    budgetOvershoot: false, tools: [] as unknown[], skills: [] as unknown[], mcp_servers: [] as unknown[] },
    pages: [{ sessionId: `session_${id}`, after: null as string | null, next: null as string | null, hasMore: false, events: [
      { id: "event_0", sequence: 0, type: "user.message", content: body.initial_events[0].content as string },
      { id: "event_1", sequence: 1, type: "agent.message", content: JSON.stringify({ changes: [{ path: "src/a.ts", operation: "add", content: "export const answer = 42;\n" }], report: "Unverified proposal. Owner review required." }) },
      { id: "event_2", sequence: 2, type: "session.end_turn", content: "" },
    ] }] };
  return { configuration, raw, adapter, invocation, target, profile, policy, prepared, context: approvedContext, workspaceIdentity, script };
}
export type ClaudeFixture = ReturnType<typeof claudeFixture>;
export function ports(f: ClaudeFixture, store: unknown, provider = fake.createClaudeManagedFakeProvider(f.script)) {
  const config = { configuration: f.configuration, profile: f.profile, context: f.context, workspaceIdentity: f.workspaceIdentity,
    store, readClient: provider.retrieval };
  return { provider, executor: execution.createClaudeManagedAgentsFakeExecutor({ ...config, startClient: provider.start }),
    inspector: execution.createClaudeManagedAgentsFakeInspector(config) };
}
/** Protocol unit stub ONLY: real durability, authority and settlement are tested on PostgreSQL. */
export function memoryClaude(f = claudeFixture()) {
  let state = "start_committed", sessionId: string | null = null, recovery = false, used = false;
  const startCapability = Object.freeze({ kind: "fixture_only_start" }), capability = Object.freeze({ kind: "fixture_only_provider" });
  const e = () => ({ ...f.invocation, target: f.target, maximumExposureUsdMicros: 10000, requestFingerprint: f.prepared.requestFingerprint, state, startedAt: 1 });
  const p = () => ({ attempt: f.invocation.attempt, executorIdentity: f.invocation.identity, target: f.target,
    requestFingerprint: f.prepared.requestFingerprint, baseRequestFingerprint: f.prepared.baseRequestFingerprint, correlationFingerprint: f.prepared.correlationFingerprint,
    sessionId, turnId: null, identityState: sessionId ? "session_observed" : "correlation_prepared", recoveryRequired: recovery });
  const observed = () => ({ verdict: "allow", snapshot: e(), providerIdentity: p() });
  const store = {
    inspect: async () => observed(), inspectProviderIdentity: async () => observed(),
    prepareProviderCorrelation: async (_raw: unknown, _context: unknown, start: unknown) => ({ ...observed(), providerCapability: start === startCapability && !used ? capability : null }),
    createProviderIdentityObserver: (_raw: unknown, c: unknown) => ({
      beforeTransmission: async (fp: string) => { if (c !== capability || used || fp !== f.prepared.requestFingerprint) return false; used = true; return true; },
      observe: async (value: { sessionId: string; turnId: null }) => { sessionId = value.sessionId; return value.turnId === null; },
      uncertain: async () => { recovery = true; state = "reconciliation_required"; },
    }),
    markProviderIdentityUnknown: async () => { recovery = true; state = "reconciliation_required"; return { verdict: "deny" }; },
  };
  return { f, store, startCapability, ...ports(f, store), facts: () => ({ sessionId, recovery, state, used }) };
}
/** Explicit TEST-OWNED exact evidence. No production Claude module can issue it. */
export async function syntheticClaudeReceipt(f: ClaudeFixture, result: import("../../lib/contracts/executor-adapter").NormalizedExecutorResult | null) {
  return outcome.createExecutorOutcomeCapture(f.configuration, { capture: () => ({ terminality: "definitive_terminal", normalizedResult: result,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, providerConsumedCents: 0 }) }).capture(f.raw, f.prepared.requestFingerprint);
}
