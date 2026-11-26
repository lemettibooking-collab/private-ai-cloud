import "server-only";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { exactOwnData, capturedMethod } from "../db/executor-start-transaction.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createDevelopmentController } from "../roadmap/development-controller.ts";
import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";

/** Trusted worker composition only, NOT a route/action, registration API or live flag.
 * Routing may plan a route; no executable provider/gate/credential port is wired here.
 * A future separately approved live slice must supply its own factual authority proof.
 */
export async function createBlockedDevelopmentControllerComposition(raw: unknown) {
  const c = exactOwnData(raw, ["database", "domainWorkspaceId", "repository", "routingSource"]), connect = c && capturedMethod(c.database, "connect");
  if (!c || !connect) return null;
  try {
    const database: WorkflowRuntimeDatabase = Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]> });
    const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(c.domainWorkspaceId); if (!tenant) return null;
    const controller = createDevelopmentController({ database, tenant, repository: c.repository, routingSource: c.routingSource,
      contextSource: Object.freeze({ prepare: () => null }),
      executorPort: Object.freeze({ mode: "blocked", prepare: () => null, start: async () => undefined,
        observe: async () => Object.freeze({ status: "unknown", normalizedResult: null, resultFingerprint: null }), reconcile: async () => undefined }),
      qualityPort: Object.freeze({ run: async () => null }), securityPort: Object.freeze({ run: async () => null }) });
    return Object.freeze({ advanceController: controller.advanceController, inspect: controller.inspect, runtimeDispatchAllowed: false as const, realDispatch: "blocked" as const });
  } catch { return null; }
}
