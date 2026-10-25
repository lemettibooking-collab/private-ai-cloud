import assert from "node:assert/strict";
import type { WorkflowRuntimeDatabase } from "../../lib/db/workflow-runtime-store";
import type { ResolvedWorkflowRuntimeTenant } from "../../lib/db/workflow-runtime-tenant";
import type { ControllerAttemptIntent } from "../../lib/db/development-controller-store";
import type { ExecutorAdapterConfiguration, ExecutorInvocationInput, NormalizedExecutorResult } from "../../lib/contracts/executor-adapter";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { workload, transmit, recover, settleCandidate } from "./executor-portability.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { candidate, requirement } from "./executor-routing.mts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { financialPolicy } from "./durable-executor.mts";
const core = await import(new URL("../../lib/db/executor-start-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-start-store");
const auth = await import(new URL("../../lib/db/executor-current-authority-store.ts", import.meta.url).href) as typeof import("../../lib/db/executor-current-authority-store");
const seam = await import(new URL("../../lib/executors/executor-provider-request.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-provider-request");
const claude = await import(new URL("../../lib/executors/claude-managed-request.ts", import.meta.url).href) as typeof import("../../lib/executors/claude-managed-request");
const binding = await import(new URL("../../lib/db/executor-controller-binding.ts", import.meta.url).href) as typeof import("../../lib/db/executor-controller-binding");
const contract = await import(new URL("../../lib/contracts/executor-adapter.ts", import.meta.url).href) as typeof import("../../lib/contracts/executor-adapter");
const gates = await import(new URL("../../lib/roadmap/development-gates.ts", import.meta.url).href) as typeof import("../../lib/roadmap/development-gates");

/** Test-only fake orchestration; all durable facts use the real PostgreSQL stores. */
export function controllerPorts(database: WorkflowRuntimeDatabase, tenant: ResolvedWorkflowRuntimeTenant, projectTaskId: string, options: {
  firstProvider?: "openai" | "anthropic"; correctiveProvider?: "openai" | "anthropic"; ambiguous?: boolean; failQualityAttempt?: number;
  qualityFailures?: readonly number[]; distinctQualityFailures?: boolean; securityOutcome?: "fail_retryable" | "fail_owner_required" | "hard_stop";
  skipSettlement?: boolean;
  deferOutcomes?: boolean;
  beforeStart?: () => Promise<void>; afterFence?: () => Promise<void>;
} = {}) {
  const stats = { starts: 0, transmissions: 0, retrievals: 0, quality: 0, security: 0, outcomeReads: 0, observedOutcomes: 0, providers: [] as string[], taskClasses: [] as string[] };
  // Explicit test-owned delayed provider delivery, NEVER controller durability or authority.
  // PostgreSQL still owns starts, identities and eventual accepted terminal settlement.
  const deferred = new Map<string, { intent: ControllerAttemptIntent; result: NormalizedExecutorResult }>();
  const policy = () => ({ ...financialPolicy(), maximumExposureUsdMicros: 10000 });
  const routing = { candidates: [candidate(options.firstProvider ?? "openai")], policy: requirement().policy };
  const pathFor = (paths: readonly string[]) => /\.[a-z0-9]+$/u.test(paths[0]) ? paths[0] : `${paths[0].replace(/\/$/u, "")}/a.ts`;
  function configured(input: { configuration: ExecutorAdapterConfiguration; invocation: ExecutorInvocationInput; context: unknown; route: unknown }) {
    const provider = (input.route as { decision: { selectedRoute: { providerId: "openai" | "anthropic" } } }).decision.selectedRoute.providerId;
    const f = workload(provider, input.configuration.developmentRun.id, input.configuration.developmentRun.currentAttemptNumber, tenant.workspaceDatabaseId);
    // Fixture broadens its base synthetic plan into the exact real roadmap-approved one.
    f.configuration = input.configuration as typeof f.configuration; f.raw = input.invocation as typeof f.raw;
    f.context = input.context as typeof f.context;
    f.adapter = contract.createExecutorAdapterContract(f.configuration).adapter!; assert.ok(f.adapter);
    f.invocation = f.adapter.validateInvocation(f.raw).normalizedInvocation!; assert.ok(f.invocation);
    if (provider === "anthropic") {
      f.profile = { ...f.profile, repository: f.configuration.repository, contextManifestFingerprint: claude.claudeContext(f.context, f.invocation).manifestFingerprint };
      f.policy = claude.createClaudeManagedRequestPolicy(f.profile);
    }
    f.prepared = seam.prepareExecutorProviderRequest(f.policy, f.invocation, f.context, f.target, policy().maximumExposureUsdMicros, tenant.workspaceDatabaseId)!; assert.ok(f.prepared);
    if (provider === "anthropic") {
      const body = JSON.parse(f.prepared.body);
      const sessionId = `${f.script.session.id}_a${f.raw.attempt.number}`;
      const proposal = { changes: f.raw.mode === "analysis_only" ? [] : [{ path: pathFor(f.invocation.allowedPaths), operation: "add", content: "export const answer = 42;\n" }], report: "Unverified proposal. Owner review required." };
      f.script = { ...f.script, session: { ...f.script.session, id: sessionId, requestFingerprint: f.prepared.requestFingerprint, correlationFingerprint: f.prepared.correlationFingerprint,
        configurationDigest: body.metadata.pac_configuration, initialInput: body.initial_events[0].content },
      pages: [{ ...f.script.pages[0], sessionId, events: [{ ...f.script.pages[0].events[0], content: body.initial_events[0].content }, { ...f.script.pages[0].events[1], content: JSON.stringify(proposal) }, ...f.script.pages[0].events.slice(2)] }] };
    }
    return f;
  }
  function stores(intent: ControllerAttemptIntent) {
    const f = configured(intent as unknown as Parameters<typeof configured>[0]);
    const controllerBinding = { projectTaskId, intentFingerprint: intent.intentFingerprint };
    const common = { database, tenant, projectId: "project-a", configuration: f.configuration, controllerBinding };
    return { f, authority: auth.createPostgresExecutorCurrentAuthorityStore(common), store: core.createPostgresExecutorStartStore({ ...common,
      target: f.target, requestPolicy: f.policy, financialPolicy: policy(), authorizeStart: () => true }) };
  }
  async function settleDeferred(developmentRunId?: string) {
    let settled = 0;
    for (const [key, held] of [...deferred]) {
      if (developmentRunId !== undefined && held.intent.developmentRunId !== developmentRunId) continue;
      const { f, store } = stores(held.intent), d = await settleCandidate(f, store, held.result);
      assert.equal(d.verdict, "allow", "controlled delayed delivery must use accepted durable settlement");
      deferred.delete(key); settled++;
    }
    return settled;
  }
  return { stats, routing, settleDeferred, pendingOutcomeRunIds: () => [...deferred.values()].map(v => v.intent.developmentRunId).sort(),
    repository: { repository: { id: "repo-a", baseline: "a".repeat(40) }, allowedPaths: ["src"] },
    routingSource: { read: () => structuredClone(routing) }, contextSource: { prepare: (input: { configuration: ExecutorAdapterConfiguration }) => ({ files: [{ path: pathFor(input.configuration.developmentRun.admittedAllowedPaths), content: "// authorized test context" }] }) },
    executorPort: { mode: "internal_fake" as const,
      prepare(input: Parameters<typeof configured>[0]) {
        const f = configured(input);
        return binding.executorControllerExecutionPolicy(f.configuration, f.raw, f.context, f.policy, f.target, policy(), tenant.workspaceDatabaseId);
      },
      async start(intent: ControllerAttemptIntent) {
        stats.starts++;
        const x = stores(intent), { f, store, authority } = x;
        const a = f.raw.attempt.number === 1 ? await authority.registerCurrentAuthority() : await authority.advanceCurrentAuthority();
        if (a.verdict !== "allow") return;
        if ((await store.reserve(f.raw, { maximumExposureUsdMicros: policy().maximumExposureUsdMicros })).verdict !== "allow") return;
        if ((await store.bindRequest(f.raw, f.context)).verdict !== "allow") return;
        if (options.beforeStart) await options.beforeStart();
        const started = await store.commitProviderStart(f.raw, f.prepared.requestFingerprint);
        if (!started.startCapability) return;
        if (options.afterFence) await options.afterFence();
        stats.providers.push(f.target.providerId); stats.taskClasses.push((intent.route as { taskClass: string }).taskClass);
        const proposal = { changes: f.raw.mode === "analysis_only" ? [] : [{ path: pathFor(f.invocation.allowedPaths), operation: "add", content: "export const answer = 42;\n" }], report: "Unverified proposal. Owner review required." };
        const sent = await transmit(f, store, started.startCapability, options.ambiguous ? "timeout" : "success", { identitySuffix: `_a${f.raw.attempt.number}`, proposal });
        stats.transmissions += sent.count();
        if (sent.decision.normalizedResult && !options.ambiguous) {
          if (options.deferOutcomes) deferred.set(`${intent.developmentRunId}:${intent.attemptNumber}`, { intent: structuredClone(intent), result: sent.decision.normalizedResult });
          else if (!options.skipSettlement) await settleCandidate(f, store, sent.decision.normalizedResult);
        }
        if (options.correctiveProvider) routing.candidates = [candidate(options.correctiveProvider)];
      },
      async observe(intent: ControllerAttemptIntent) {
        stats.outcomeReads++;
        const { f, store } = stores(intent), d = await store.inspectOutcome(f.raw);
        if (d.normalizedResult && d.resultFingerprint) { stats.observedOutcomes++; return { status: "settled", normalizedResult: d.normalizedResult, resultFingerprint: d.resultFingerprint }; }
        const p = (await store.inspectProviderIdentity(f.raw)).providerIdentity;
        return { status: p?.sessionId ? "known_identity" : "unknown", normalizedResult: null, resultFingerprint: null };
      },
      async reconcile(intent: ControllerAttemptIntent) {
        if (options.deferOutcomes && deferred.has(`${intent.developmentRunId}:${intent.attemptNumber}`)) return; // Controlled provider has not delivered terminal evidence yet.
        const { f, store } = stores(intent); const p = (await store.inspectProviderIdentity(f.raw)).providerIdentity; if (!p?.sessionId) return; stats.retrievals++; await recover(f, store);
      },
    },
    qualityPort: { run(input: { runId: string; attemptNumber: number; outcomeFingerprint: string; operationId: string; requiredCommands: readonly string[] }) {
      stats.quality++; const { requiredCommands, ...b } = input; const failed = options.failQualityAttempt === input.attemptNumber || options.qualityFailures?.includes(input.attemptNumber);
      return { ...b, checks: requiredCommands.map(command => ({ command, status: failed ? "failed" : "passed", exitCode: failed ? options.distinctQualityFailures ? input.attemptNumber : 1 : 0 })) };
    } },
    securityPort: { run(input: { producerExecutorId: string; runId: string; attemptNumber: number; outcomeFingerprint: string; operationId: string }) {
      stats.security++; const { producerExecutorId: _producer, ...b } = input; void _producer;
      const code = options.securityOutcome === "fail_retryable" ? "security_check_failed" : options.securityOutcome === "fail_owner_required" ? "scope_expansion_required" : options.securityOutcome === "hard_stop" ? "security_invariant_violation" : "review_passed";
      return { ...b, reviewerId: "independent-security", outcome: options.securityOutcome ?? "pass", code, summary: gates.developmentSecuritySummaries[code] };
    } },
  };
}
