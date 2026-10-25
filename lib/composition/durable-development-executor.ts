import type { WorkflowRuntimeDatabase } from "../db/workflow-runtime-store";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresExecutorStartStore } from "../db/executor-start-store.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createOpenAIAgentsRequestPolicy } from "../executors/openai-agents-request.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { createPostgresWorkflowRuntimeTenantResolver } from "../db/workflow-runtime-tenant.ts";
// @ts-expect-error Node direct TypeScript requires the runtime extension.
import { capturedMethod, exactOwnData } from "../db/executor-start-transaction.ts";

/** Implementation behind the server-only root. Trusted configuration only; no caller-facing issuer. */
export async function createDurableDevelopmentExecutorComposition(input: unknown) {
  if (typeof window !== "undefined") return null;
  const c = exactOwnData(input, ["database", "domainWorkspaceId", "projectId", "configuration", "target", "financialPolicy"]);
  const connect = c && capturedMethod(c.database, "connect");
  if (!c || !connect) return null;
  try {
    const database: WorkflowRuntimeDatabase = Object.freeze({ connect: () => Reflect.apply(connect, undefined, []) as ReturnType<WorkflowRuntimeDatabase["connect"]> });
    const tenant = await createPostgresWorkflowRuntimeTenantResolver(database).resolve(c.domainWorkspaceId);
    if (!tenant) return null;
    const store = createPostgresExecutorStartStore({ database, tenant, projectId: c.projectId, configuration: c.configuration,
      target: c.target, requestPolicy: createOpenAIAgentsRequestPolicy(), financialPolicy: c.financialPolicy, authorizeStart: () => false });
    return Object.freeze({ realDispatch: "blocked" as const,
      reserve: store.reserve, prepare: store.bindRequest, cancel: store.cancel, inspect: store.inspect,
      // No start issuer/capability or credentials leave this production facade.
      invoke() { return Object.freeze({ verdict: "deny" as const, reason: "executor_live_dispatch_blocked", normalizedResult: null }); },
    });
  } catch { return null; }
}
