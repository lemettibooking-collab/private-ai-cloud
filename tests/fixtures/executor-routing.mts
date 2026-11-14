import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import type { ExecutorRouteCandidate } from "../../lib/executors/executor-router";
import type { ExecutionEnvironment, ManagedEnvironmentRequirements } from "../../lib/execution-environment/execution-environment";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { executorConfiguration } from "./durable-executor.mts";
export const routerModule = await import(process.env.B2_ROUTER_MODULE ? pathToFileURL(process.env.B2_ROUTER_MODULE).href : new URL("../../lib/executors/executor-router.ts", import.meta.url).href) as typeof import("../../lib/executors/executor-router");
export const environmentModule = await import(process.env.B2_ENV_MODULE ? pathToFileURL(process.env.B2_ENV_MODULE).href : new URL("../../lib/execution-environment/managed-execution-environment-policy.ts", import.meta.url).href) as typeof import("../../lib/execution-environment/managed-execution-environment-policy");
const data = await import(new URL("../../lib/execution-environment/execution-environment.ts", import.meta.url).href) as typeof import("../../lib/execution-environment/execution-environment");
type Mutable<T> = T extends object ? { -readonly [P in keyof T]: Mutable<T[P]> } : T;
export const evidence = () => ({ state: "supported" as const, fingerprint: "b".repeat(64) });
/** Entirely SYNTHETIC policy evidence; makes NO real provider/compliance/access claim. */
export function environment(id = "environment-a"): Mutable<ExecutionEnvironment> {
  return { id, kind: "provider_hosted", programmaticInterface: evidence(),
    capabilities: Object.fromEntries(data.managedCapabilities.map(k => [k, evidence()])) as Mutable<ExecutionEnvironment["capabilities"]>,
    residency: { regions: ["eu-test"], evidence: evidence() },
    privacy: Object.fromEntries(data.privacyRequirements.map(k => [k, evidence()])) as Mutable<ExecutionEnvironment["privacy"]> };
}
export function candidate(provider: "openai" | "anthropic" = "openai", routeId = provider === "openai" ? "route-a" : "route-b"): Mutable<ExecutorRouteCandidate> & { environment: Mutable<ExecutionEnvironment> } {
  return { routeId, providerId: provider, executor: { id: provider === "openai" ? "openai-agents" : "claude-managed-agents", version: "v1" },
    taskClasses: ["implementation", "analysis", "repair", "refactor", "verification"],
    capabilities: ["coding", "repository_analysis"], modes: ["patch_proposal", "analysis_only"], artifacts: ["patch", "report"], maxRisk: "high",
    repositoryFeatures: ["exact_baseline", "bounded_context", "allowed_paths", "patch_artifacts", "repository_analysis"], environment: environment(`environment-${routeId}`),
    accessModes: ["api_key"], availability: { state: "available", fingerprint: "c".repeat(64) }, quota: { state: "available", fingerprint: "d".repeat(64) },
    estimatedCostUsdMicros: { value: 1000, fingerprint: "e".repeat(64) }, estimatedLatencyMs: { value: 100, fingerprint: "f".repeat(64) },
    quality: { scoreBasisPoints: 8000, sampleCount: 50, fingerprint: "a".repeat(64) } };
}
export const environmentRequirements = (): Mutable<ManagedEnvironmentRequirements> => ({ kinds: ["provider_hosted"], capabilities: [], residency: null, privacy: [] });
export function requirement() {
  const c = executorConfiguration();
  return { admission: c.admission, developmentRun: structuredClone(c.developmentRun) as Mutable<typeof c.developmentRun>, repository: c.repository, capability: "coding", mode: "patch_proposal", taskClass: "implementation",
    policy: { environment: environmentRequirements(), accessModes: ["api_key"], requireQuota: true,
      maxCostUsdMicros: null as number | null, maxLatencyMs: null as number | null, minQualityBasisPoints: null as number | null,
      requiredExecutorId: null as string | null, preferredExecutorIds: [] as string[] } };
}
export function select(candidates = [candidate()], input = requirement()) {
  const result = routerModule.createExecutorRouter(candidates); assert.equal(result.verdict, "allow"); assert.ok(result.router); return result.router.select(input);
}
export function assertDenied(candidates: ReturnType<typeof candidate>[], input: ReturnType<typeof requirement>, code?: string) {
  const d = select(candidates, input); assert.equal(d.verdict, "deny"); assert.equal(d.selectedRoute, null); assert.equal(d.routeFingerprint, null);
  assert.equal(d.dispatchAuthorized, false); assert.equal(d.runtimeDispatchAllowed, false); assert.deepEqual(d.ranking, []);
  if (code) assert.ok([...d.reasons, ...d.rejected.flatMap(x => x.reasons)].includes(code as never), JSON.stringify(d)); return d;
}
export function deeplyFrozen(v: unknown) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); for (const x of Object.values(v)) deeplyFrozen(x); } }
