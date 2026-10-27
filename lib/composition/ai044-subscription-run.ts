// Node/server internal use case. No HTTP action, UI, public issuer, env switch or background loop.
import type { ExecutorAdapterConfiguration, ExecutorInvocationInput } from "../contracts/executor-adapter";
import type { ChatGPTConnection } from "../integrations/chatgpt/chatgpt-connection";
import type { AI044SubscriptionContext, AI044ExactObjectPort } from "../executors/ai044-subscription-context";
import type { SubscriptionIntent } from "../executors/ai044-subscription-intent";
import type { ExecutorRouteCandidate } from "../executors/executor-router";
import type { ChatGPTPlanExecutionDecision } from "../executors/chatgpt-plan-patch-executor";
import type { ChatGPTSubscriptionAccess } from "../integrations/chatgpt/chatgpt-connection";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorAdapterContract } from "../contracts/executor-adapter.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, capturedMethod } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createAI044SubscriptionApprovals, subscriptionResultFingerprint } from "../db/ai044-subscription-approvals.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { captureAI044Data, ai044Fingerprint, ai044Hash, freezeAI044 } from "../executors/ai044-proof-binding.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { normalizeSubscriptionIntent, subscriptionIntentCurrent, subscriptionRegistrationFingerprint } from "../executors/ai044-subscription-intent.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createAI044SubscriptionContextSource, ai044SubscriptionContextManifest, ai044SubscriptionContextPath } from "../executors/ai044-subscription-context.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { repositoryPathContains } from "../contracts/development-task-policy.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { isChatGPTSubscriptionFacts } from "../integrations/chatgpt/chatgpt-credential-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createChatGPTPlanPatchExecutor } from "../executors/chatgpt-plan-patch-executor.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createExecutorRouter } from "../executors/executor-router.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { resolveSessionOwner } from "../integrations/chatgpt/chatgpt-owner-authority.ts";

export type AI044SubscriptionPrepared = Readonly<{ kind: "ai044_subscription_prepared" }>;
/** Trusted per-FeaturePlan configuration, never an arbitrary prepare/request-body allowlist.
 * Repository/task/attempt come from captured factual configuration; revision/hash must match. */
export type AI044SubscriptionReadPolicy = Readonly<{ planRevision: number; planFingerprint: string; referencePaths: readonly string[] }>;
const denied = (reason = "subscription_run_denied") => freezeAI044({ verdict: "deny" as const, reason, normalizedResult: null, proposal: null });
/** Factual connection provenance is required even for selection. Catalog presence is
 * NOT entitlement or quota evidence; unknown quota is not fabricated as available. */
export function createAI044SubscriptionRouter(facts: unknown) {
  if (!isChatGPTSubscriptionFacts(facts) || facts.status !== "active" || !facts.planUsageGranted || !facts.selectedModel) return null;
  const candidate: ExecutorRouteCandidate = { routeId: "ai044-chatgpt-plan", executor: { id: "chatgpt-plan-patch", version: "v1" }, providerId: "openai",
    capabilities: ["coding"], modes: ["patch_proposal"], artifacts: ["patch", "report"], taskClasses: ["implementation", "repair"], maxRisk: "high",
    repositoryFeatures: ["exact_baseline", "bounded_context", "allowed_paths", "patch_artifacts"], environment: { id: "ai044-no-environment", kind: "patch_proposal_only" },
    accessModes: ["subscription_session"], availability: { state: "available", fingerprint: ai044Fingerprint(facts) },
    quota: { state: "unknown", fingerprint: null }, estimatedCostUsdMicros: null, estimatedLatencyMs: null, quality: null };
  return createExecutorRouter([candidate]).router;
}
/** Trusted composition configuration only. All authority/Owner/current-plan checks are
 * real PostgreSQL checks; all secrets stay behind the existing SIWC foundation. */
export function createAI044SubscriptionRun(raw: unknown) {
  if (typeof window !== "undefined") throw Error("subscription_server_only");
  const fields = ["database", "tenant", "projectId", "projectTaskId", "configuration", "identitySource", "connection", "contextSource", "transport", "clock"];
  const c = exactOwnData(raw, fields) ?? exactOwnData(raw, [...fields, "controllerBinding"])
    ?? exactOwnData(raw, [...fields, "readContextPolicy"]) ?? exactOwnData(raw, [...fields, "controllerBinding", "readContextPolicy"]);
  const readFacts = c && capturedMethod(c.connection, "readSubscriptionFacts"), withAccess = c && capturedMethod(c.connection, "withSubscriptionAccess");
  const resolve = c && capturedMethod(c.identitySource, "resolve");
  const connect = c && capturedMethod(c.database, "connect");
  if (!c || !readFacts || !withAccess || !resolve || !connect || typeof c.transport !== "function" || typeof c.clock !== "function") throw Error("invalid_subscription_run_configuration");
  const database: import("../db/workflow-runtime-store").WorkflowRuntimeDatabase = Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<import("../db/workflow-runtime-store").WorkflowRuntimeDatabase["connect"]> });
  const clock = c.clock as () => number;
  const configuration = freezeAI044(captureAI044Data(c.configuration)) as ExecutorAdapterConfiguration;
  const adapter = createExecutorAdapterContract(configuration).adapter;
  if (!adapter || configuration.identity.id !== "chatgpt-plan-patch" || configuration.identity.version !== "v1") throw Error("invalid_subscription_run_configuration");
  let readPolicy: AI044SubscriptionReadPolicy | null = null;
  if (Object.hasOwn(c, "readContextPolicy")) {
    const policy = exactOwnData(captureAI044Data(c.readContextPolicy), ["planRevision", "planFingerprint", "referencePaths"]);
    if (!policy || !Number.isSafeInteger(policy.planRevision) || (policy.planRevision as number) < 1 || (policy.planRevision as number) > 1_000_000 || !ai044Hash(policy.planFingerprint)
      || !Array.isArray(policy.referencePaths) || policy.referencePaths.length > 20 || new Set(policy.referencePaths).size !== policy.referencePaths.length) throw Error("invalid_subscription_read_policy");
    readPolicy = freezeAI044({ planRevision: policy.planRevision as number, planFingerprint: policy.planFingerprint,
      referencePaths: policy.referencePaths.map(ai044SubscriptionContextPath) });
  }
  const approvals = createAI044SubscriptionApprovals({ database, tenant: c.tenant, projectId: c.projectId, projectTaskId: c.projectTaskId,
    configuration, identitySource: c.identitySource, ...(Object.hasOwn(c, "controllerBinding") ? { controllerBinding: c.controllerBinding } : {}) });
  const source = createAI044SubscriptionContextSource(c.contextSource as AI044ExactObjectPort);
  const executor = createChatGPTPlanPatchExecutor(configuration, c.transport as typeof fetch, clock);
  const prepared = new WeakMap<object, { intent: SubscriptionIntent; context: AI044SubscriptionContext; ownerUserId: string;
    invocation: ExecutorInvocationInput; request: NonNullable<ReturnType<typeof executor.prepare>["request"]>; routeFingerprint: string }>();
  const requirements = () => ({ admission: configuration.admission, developmentRun: configuration.developmentRun, repository: configuration.repository,
    capability: "coding", mode: "patch_proposal", taskClass: configuration.developmentRun.currentAttemptNumber === 1 ? "implementation" : "repair",
    policy: { environment: { kinds: ["patch_proposal_only"], capabilities: [], residency: null, privacy: [] }, accessModes: ["subscription_session"],
      requireQuota: false, maxCostUsdMicros: null, maxLatencyMs: null, minQualityBasisPoints: null, requiredExecutorId: "chatgpt-plan-patch", preferredExecutorIds: [] } });
  async function facts() { return Reflect.apply(readFacts!, undefined, []) as ReturnType<ChatGPTConnection["readSubscriptionFacts"]>; }
  async function owner() {
    const tenant = c!.tenant as { workspaceId: string };
    const result = await resolveSessionOwner(database, tenant.workspaceId,
      { resolve: () => Reflect.apply(resolve!, undefined, []) as ReturnType<import("./authenticated-owner-read-runtime").AuthenticatedIdentitySource["resolve"]> });
    return result.status === "owner" ? result.ownerUserId : null;
  }
  async function prepare(input: unknown) {
    try {
      const r = exactOwnData(input, ["invocationId", "planRevision", "planFingerprint", "contextPaths", "preflight", "expiresAt"]); if (!r) return denied();
      const actor = await owner(); if (!actor) return denied();
      const f = await facts(); const router = createAI044SubscriptionRouter(f); if (!f || !router) return denied("subscription_connection_unavailable");
      const tenant = c!.tenant as { workspaceId: string; workspaceDatabaseId: string };
      if (f.domainWorkspaceId !== tenant.workspaceId || f.ownerUserId !== actor) return denied();
      const route = router.select(requirements()); if (route.verdict !== "allow" || !route.routeFingerprint) return denied("subscription_route_unavailable");
      const run = configuration.developmentRun, current = run.attempts.find(a => a.number === run.currentAttemptNumber)!;
      const attempt = { developmentRunId: run.id, number: run.currentAttemptNumber, kind: current.kind };
      const invocation: ExecutorInvocationInput = { schemaVersion: 1, invocationId: r.invocationId as string, identity: configuration.identity,
        planId: run.planId, taskId: run.taskId, repository: configuration.repository, capability: "coding", mode: "patch_proposal", attempt };
      if (!adapter!.validateInvocation(invocation).normalizedInvocation) return denied();
      const paths = captureAI044Data(r.contextPaths);
      if (!Array.isArray(paths) || !paths.length || paths.length > 20 || new Set(paths).size !== paths.length) return denied("subscription_context_denied");
      const readContextPaths = paths.map(ai044SubscriptionContextPath);
      if (readPolicy && (r.planRevision !== readPolicy.planRevision || r.planFingerprint !== readPolicy.planFingerprint)) return denied("subscription_context_denied");
      if (readContextPaths.some(path => !run.admittedAllowedPaths.some(parent => repositoryPathContains(parent, path))
        && !readPolicy?.referencePaths.includes(path))) return denied("subscription_context_denied");
      const context = (await source.prepare({ repository: configuration.repository, projectTaskId: c!.projectTaskId,
        planId: run.planId, planRevision: r.planRevision, planFingerprint: r.planFingerprint, taskId: run.taskId, attempt,
        allowedWritePaths: run.admittedAllowedPaths, readContextPaths }, readContextPaths)).context;
      if (!context) return denied("subscription_context_denied");
      const intent = normalizeSubscriptionIntent({ schemaVersion: 1, workspaceId: tenant.workspaceId, workspaceDatabaseId: tenant.workspaceDatabaseId,
        projectId: c!.projectId, projectTaskId: c!.projectTaskId, planId: run.planId, planRevision: r.planRevision, planFingerprint: r.planFingerprint,
        taskId: run.taskId, invocationId: r.invocationId, attempt, executor: configuration.identity, accessMode: "subscription_session", registration: f.registration,
        model: f.selectedModel, repository: configuration.repository, contextFingerprint: context.fingerprint, allowedWritePaths: run.admittedAllowedPaths, readContextPaths,
        patchBounds: { files: 12, changedLines: 1200 }, preflight: r.preflight, expiresAt: r.expiresAt });
      if (!intent || !subscriptionIntentCurrent(intent, clock()) || intent.preflight.registrationFingerprint !== subscriptionRegistrationFingerprint(f.registration)) return denied("subscription_preflight_denied");
      const p = executor.prepare(invocation, context, intent, f.ownerUserId); if (!p.request) return denied();
      const receipt: AI044SubscriptionPrepared = Object.freeze({ kind: "ai044_subscription_prepared" });
      prepared.set(receipt, { intent, context, ownerUserId: f.ownerUserId, invocation, request: p.request, routeFingerprint: route.routeFingerprint });
      return freezeAI044({ verdict: "allow" as const, prepared: receipt, intent, contextManifest: ai044SubscriptionContextManifest(context),
        route, executionPolicy: { profile: "ai044_subscription", intent }, financialClassification: "subscription-plan-only" as const,
        dispatchAuthorized: false, runtimeDispatchAllowed: false });
    } catch { return denied(); }
  }
  async function requestApproval(input: unknown) {
    const r = exactOwnData(input, ["prepared", "commandId"]), p = r?.prepared && typeof r.prepared === "object" ? prepared.get(r.prepared) : null;
    if (!r || !p) return denied(); return approvals.request({ commandId: r.commandId, intent: p.intent });
  }
  async function invoke(input: unknown) {
    const r = exactOwnData(input, ["prepared", "approvalRequestId"]), p = r?.prepared && typeof r.prepared === "object" ? prepared.get(r.prepared) : null;
    if (!r || !p || !subscriptionIntentCurrent(p.intent, clock())) return denied();
    try {
      const actor = await owner(); if (!actor || actor !== p.ownerUserId) return denied();
      const f = await facts(), router = createAI044SubscriptionRouter(f), route = router?.select(requirements());
      if (!f || !route || route.verdict !== "allow" || route.routeFingerprint !== p.routeFingerprint || f.ownerUserId !== p.ownerUserId
        || f.domainWorkspaceId !== p.intent.workspaceId || f.selectedModel !== p.intent.model
        || subscriptionRegistrationFingerprint(f.registration) !== subscriptionRegistrationFingerprint(p.intent.registration)) return denied();
      // No token read until the exact Owner decision, plan, receipt and current authority
      // have all been locked/validated, and the one-shot consumption COMMIT is acknowledged.
      const consumed = await approvals.consume({ approvalRequestId: r.approvalRequestId, intent: p.intent });
      if (!consumed.approvalCapability) return denied(consumed.status);
      const binding = { registration: p.intent.registration, ownerUserId: p.ownerUserId, domainWorkspaceId: p.intent.workspaceId, modelId: p.intent.model };
      // Reuse the existing inter-process refresh lock through exact credential checks,
      // final DB fence and SYNCHRONOUS POST initiation. Disconnect/model-selection cannot
      // commit between them. The wrapper releases the lock before awaiting the stream.
      const dispatched = await Reflect.apply(withAccess!, undefined, [binding, async (access: ChatGPTSubscriptionAccess) => {
        const started = await approvals.fence({ approvalCapability: consumed.approvalCapability });
        return { pending: started.startCapability ? executor.execute(p.request, started.startCapability, access) : Promise.resolve(null) };
      }]) as { ok: true; pending: Promise<ChatGPTPlanExecutionDecision | null> } | { ok: false; reason: string };
      if (!dispatched.ok) return denied("subscription_credential_unavailable");
      const result = await dispatched.pending;
      if (!result) return denied("recovery_required");
      const state = result.state === "completed" || result.state === "failed" ? result.state : "outcome_unknown";
      const recorded = await approvals.recordOutcome({ approvalRequestId: r.approvalRequestId, intent: p.intent, state,
        resultFingerprint: result.normalizedResult ? subscriptionResultFingerprint(result.normalizedResult) : null, normalizedResult: result.normalizedResult });
      if (recorded.verdict !== "allow") return denied("recovery_required");
      return result;
    } catch { return denied("recovery_required"); }
  }
  return Object.freeze({ prepare, requestApproval, decideApproval: approvals.decide, invoke,
    runtimeDispatchAllowed: false as const, productionLiveDispatch: "BLOCKED" as const });
}
